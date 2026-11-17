#!/usr/bin/env python3
"""Run the independent Golden visual gate on a self-contained local fixture."""
from __future__ import annotations

import argparse
import hashlib
import http.server
import json
import os
import stat
import subprocess
import sys
import threading
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "examples" / "visual-enforcement" / "fixture"
PROFILE = FIXTURE / "visual-profile.json"
HTML = FIXTURE / "index.html"
REQUIRED = ["collisions", "clipping", "controls", "scrolling", "page_overflow", "contrast",
            "geometry", "images", "focus", "temporal", "positioned_surfaces", "design_tokens"]
EXPECTED_DEFECTS = {
    "TEXT_TEXT_COLLISION", "TEXT_CONTROL_COLLISION", "TEXT_CLIPPED_BY_ANCESTOR",
    "TEXT_TRUNCATION_WITHOUT_DISCLOSURE", "REQUIRED_CONTROL_UNREACHABLE",
    "COMPONENT_GEOMETRY_CONSTRAINT", "CONTRAST_BELOW_PROFILE_THRESHOLD",
    "SCROLL_CONTAINMENT_FAILURE", "IMAGE_ASPECT_DISTORTION", "VIEWPORT_HORIZONTAL_OVERFLOW",
    "UNEXPECTED_LAYOUT_MOVEMENT", "FORBIDDEN_TRANSIENT_OVERLAY",
}


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        pass


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-root", required=True, help="New evidence directory; existing paths are refused")
    parser.add_argument("--playwright-module", required=True, help="Approved existing Node Playwright module")
    parser.add_argument("--browser-executable", required=True, help="Approved installed Chromium executable")
    args = parser.parse_args()
    out = Path(args.output_root).resolve()
    if out.exists():
        raise SystemExit("Refusing to overwrite evidence: " + str(out))
    if not FIXTURE.is_dir() or not PROFILE.is_file() or not HTML.is_file():
        raise SystemExit("visual fixture/profile is incomplete")
    module_dir = Path(args.playwright_module).resolve(strict=True)
    browser_file = Path(args.browser_executable).resolve(strict=True)
    if not module_dir.is_dir() or not (module_dir / "package.json").is_file() or not browser_file.is_file():
        raise SystemExit("approved Playwright module directory and Chromium executable file are required")
    module_probe = subprocess.run(["node", "-e", "console.log(require.resolve(process.argv[1]))", str(module_dir)],
                                  cwd=ROOT, text=True, capture_output=True, check=True)
    module_entry = Path(module_probe.stdout.strip()).resolve(strict=True)
    playwright_version = json.loads((module_dir / "package.json").read_text(encoding="utf-8"))["version"]
    node_version = subprocess.run(["node", "--version"], cwd=ROOT, text=True, capture_output=True, check=True).stdout.strip()
    out.mkdir(parents=True, mode=0o700)
    handler = lambda *a, **kw: QuietHandler(*a, directory=str(FIXTURE), **kw)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, name="golden-fixture-loopback", daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        routes = []
        for width, height in ((1280, 800), (1024, 768), (390, 844)):
            for theme in ("light", "dark"):
                for case_name in ("defective", "corrected", "intentional"):
                    name = f"{case_name}-{theme}-{width}"
                    render_case = "corrected" if case_name == "intentional" else case_name
                    query = urlencode({"case": render_case, "theme": theme})
                    route = {
                        "name": name,
                        "path": "/?" + query,
                        "theme": theme,
                        "state_contract": "default",
                        "viewport": {"width": width, "height": height},
                        "focus_sequence": [
                            {"start": "#start", "key": "Tab", "selector": "#focus-target"},
                            {"start": "#open-dialog", "key": "Shift+Tab", "selector": "#tooltip-trigger"},
                            {"start": "#tooltip-trigger", "key": "Shift+Tab", "selector": "#intentional-trunc"},
                        ],
                        "scroll_containment": [{"container": "#scroll-area", "target": "#scroll-target", "axis": "y", "method": "wheel", "wheel_delta": 230, "minimum_scroll_delta": 1}],
                        "temporal": {"duration_ms": 760, "sample_interval_ms": 20,
                                      "trigger_action": {"type": "click", "selector": "#simulate-action"},
                                      "watch": [{"selector": "#shifter", "max_movement_css_px": 2}],
                                      "forbid_transient": ["#flash"]},
                    }
                    if case_name == "intentional":
                        route["actions"] = []
                        route["actions"].append({"type": "hover", "selector": "#tooltip-trigger"})
                    routes.append(route)
        for theme in ("light", "dark"):
            routes.append({
                "name": f"intentional-dialog-{theme}", "path": "/?" + urlencode({"case": "corrected", "theme": theme}),
                "theme": theme, "state_contract": "dialog", "viewport": {"width": 1280, "height": 800},
                "actions": [{"type": "click", "selector": "#open-dialog"}],
                "focus_sequence": [{"start": "#review-details", "key": "Tab", "selector": "#close-dialog"}],
                "temporal": {"duration_ms": 360, "sample_interval_ms": 20, "capture_route_actions": True,
                              "watch": [{"selector": "dialog[open]", "max_movement_css_px": 2}],
                              "forbid_transient": ["#flash"]},
            })
            routes.append({
                "name": f"dialog-focus-return-{theme}", "path": "/?" + urlencode({"case": "corrected", "theme": theme}),
                "theme": theme, "state_contract": "default", "viewport": {"width": 1280, "height": 800},
                "actions": [{"type": "click", "selector": "#open-dialog"},
                            {"type": "press", "selector": "#close-dialog", "key": "Escape"}],
                "scroll_containment": [{"container": "#scroll-area", "target": "#scroll-target", "axis": "y", "method": "wheel", "wheel_delta": 230, "minimum_scroll_delta": 1}],
                "focus_restoration": [{"selector": "#open-dialog"}],
                "focus_sequence": [
                    {"start": "#open-dialog", "key": "Shift+Tab", "selector": "#tooltip-trigger"},
                    {"start": "#tooltip-trigger", "key": "Shift+Tab", "selector": "#intentional-trunc"},
                ],
                "temporal": {"duration_ms": 760, "sample_interval_ms": 20, "capture_route_actions": True,
                              "watch": [{"selector": "#panel", "max_movement_css_px": 2}],
                              "forbid_transient": ["#flash"]},
            })
        request = {
            "schema": "golden.visual-enforcement.v1",
            "source_root": str(FIXTURE),
            "project_root": str(ROOT),
            "profile_path": str(PROFILE),
            "profile_sha256": sha(PROFILE),
            "source_files_sha256": {"index.html": {"sha256": sha(HTML), "mode": stat.S_IMODE(HTML.stat().st_mode)}},
            "base_url": origin,
            "allowed_origins": [origin],
            "required_checks": REQUIRED,
            "routes": routes,
            "runtime": {"node_version": node_version,
                        "playwright_module": str(module_dir),
                        "playwright_entry_sha256": sha(module_entry),
                        "playwright_version": playwright_version,
                        "browser_executable": str(browser_file),
                        "browser_executable_sha256": sha(browser_file)},
        }
        request_path = out / "request.json"
        request_path.write_text(json.dumps(request, indent=2) + "\n", encoding="utf-8")
        evidence = out / "browser-evidence"
        command = [sys.executable, str(ROOT / "uiux.py"), "visual-enforce", str(request_path),
                   "--output", str(evidence), "--allow-interactions",
                   "--playwright-module", args.playwright_module,
                   "--browser-executable", args.browser_executable]
        completed = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=False)
        if not (evidence / "report.json").is_file():
            print(json.dumps({"status": "BLOCKED", "exit_code": completed.returncode,
                              "stdout": completed.stdout[-2000:], "stderr": completed.stderr[-2000:]}, indent=2))
            return 5
        report = json.loads((evidence / "report.json").read_text(encoding="utf-8"))
        security = {}
        for name, mutate in (
            ("request_cannot_weaken_policy", lambda r: r.update(policy={"contrast": []})),
            ("remote_origin_denied", lambda r: r.update(base_url="https://example.com", allowed_origins=["https://example.com"])),
            ("unlisted_origin_denied", lambda r: r.update(allowed_origins=["https://example.com"])),
            ("stale_source_hash_denied", lambda r: r.update(source_files_sha256={"index.html": "0" * 64})),
            ("stale_node_version_denied", lambda r: r["runtime"].update(node_version="v0.0.0")),
        ):
            bad_request = dict(request)
            mutate(bad_request)
            bad_spec = out / f"negative-{name}.json"
            bad_spec.write_text(json.dumps(bad_request, indent=2) + "\n", encoding="utf-8")
            bad_out = out / f"negative-{name}-output"
            bad = subprocess.run([sys.executable, str(ROOT / "uiux.py"), "visual-enforce", str(bad_spec),
                                  "--output", str(bad_out), "--playwright-module", args.playwright_module,
                                  "--browser-executable", args.browser_executable, "--allow-interactions"],
                                 cwd=ROOT, text=True, capture_output=True, check=False)
            try:
                result = json.loads(bad.stdout)
            except json.JSONDecodeError:
                result = {"status": "UNKNOWN", "detail": bad.stderr[-500:]}
            security[name] = {"status": result.get("status"), "reason": result.get("reason") or result.get("error"),
                              "exit_code": bad.returncode}
        outcomes = {route["name"]: route["status"] for route in report["routes"]}
        defects = set()
        for route in report["routes"]:
            if route["name"].startswith("defective-"):
                defects.update(f["code"] for f in route["findings"])
        intended = [name for name, status in outcomes.items() if name.startswith(("corrected-", "intentional-", "dialog-focus-return-")) and status != "PASS"]
        defective_passed = [name for name, status in outcomes.items() if name.startswith("defective-") and status not in {"FAIL", "UNKNOWN"}]
        missing = sorted(EXPECTED_DEFECTS - defects)
        summary = {
            "status": "PENDING",
            "runner_status": report["status"],
            "actual_browser": report.get("runtime"),
            "route_count": len(outcomes),
            "defective_routes_rejected": len([n for n in outcomes if n.startswith("defective-") and outcomes[n] in {"FAIL", "UNKNOWN"}]),
            "corrected_and_intentional_routes_passed": len([n for n in outcomes if n.startswith(("corrected-", "intentional-", "dialog-focus-return-")) and outcomes[n] == "PASS"]),
            "expected_defect_codes_observed": sorted(defects & EXPECTED_DEFECTS),
            "missing_expected_defect_codes": missing,
            "unexpected_valid_route_failures": intended,
            "defective_routes_not_rejected": defective_passed,
            "route_statuses": outcomes,
            "negative_policy_and_source_controls": security,
            "report": str(evidence / "report.json"),
            "screenshots_and_dom": "Each route has a SHA-256 bound PNG and DOM JSON; temporal traces are in report.json.",
            "http_policy": "127.0.0.1 fixture only; GET-only; runner blocks external origins, WebSockets, service workers and writes.",
            "stdout": completed.stdout[-1000:],
            "stderr": completed.stderr[-1000:],
        }
        security_failed = any(item.get("status") != "BLOCKED" or item.get("exit_code") == 0 for item in security.values())
        summary["status"] = "PASS" if not intended and not defective_passed and not missing and not security_failed else "FAIL"
        (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(summary, indent=2))
        return 0 if summary["status"] == "PASS" else 3
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


if __name__ == "__main__":
    raise SystemExit(main())
