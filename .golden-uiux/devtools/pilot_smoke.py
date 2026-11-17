#!/usr/bin/env python3
"""Offline package and disposable project-layout smoke test (Python stdlib only)."""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from pathlib import PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
TIMEOUT = 30
sys.path.insert(0, str(ROOT))


def run(args: list[str], *, cwd: Path = ROOT, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, cwd=cwd, input=input_text, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=TIMEOUT, check=False)
    if result.returncode:
        raise RuntimeError(
            f"command failed ({result.returncode}): {' '.join(args)}\n"
            f"stdout:\n{result.stdout[-2500:]}\nstderr:\n{result.stderr[-2500:]}"
        )
    return result


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def check_mcp() -> dict:
    requests = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
            "name": "uiux_list_patterns", "arguments": {}}},
    ]
    result = run([sys.executable, "uiux.py", "mcp"],
                 input_text="".join(json.dumps(x) + "\n" for x in requests))
    replies = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    if len(replies) != 3:
        raise RuntimeError(f"MCP returned {len(replies)} replies for three requests")
    tool_names = {x["name"] for x in replies[1]["result"]["tools"]}
    expected = {"uiux_list_patterns", "uiux_get_pattern", "uiux_route_task",
                "uiux_feature_intake", "uiux_check_plan", "uiux_audit_proof_metadata",
                "uiux_compare_geometry"}
    if tool_names != expected:
        raise RuntimeError("MCP tool inventory differs from the read-only contract")
    patterns = replies[2]["result"]["structuredContent"]["patterns"]
    if len(patterns) != 14:
        raise RuntimeError(f"MCP returned {len(patterns)} patterns, expected 14")
    return {"status": "PASS", "tools": len(tool_names), "patterns": len(patterns),
            "network": "not used", "writes": "none"}


def check_client_layout(client: str, skill_ids: list[str]) -> dict:
    with tempfile.TemporaryDirectory(prefix=f"golden-uiux-{client}-") as temp:
        target = Path(temp) / "disposable-project"
        target.mkdir()
        base = [sys.executable, "install.py", "--target", str(target), "--client", client]

        # The default preview must leave an empty target untouched.
        run(base)
        if list(target.iterdir()):
            raise RuntimeError(f"{client} dry run modified the disposable project")

        run(base + ["--apply"])
        receipt_path = target / ".golden-uiux" / "install_receipt.json"
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        identity = json.loads((ROOT / "data" / "release_identity.json").read_text(encoding="utf-8"))
        expected_package = "golden-uiux-" + identity["version"]
        if receipt.get("package_id") != expected_package:
            raise RuntimeError(f"{client} receipt has unexpected package identity")
        skill_root = ".agents/skills" if client == "codex" else ".opencode/skills"
        for skill_id in skill_ids:
            skill_file = target / skill_root / skill_id / "SKILL.md"
            if not skill_file.is_file() or skill_file.is_symlink():
                raise RuntimeError(f"{client} skill missing or unsafe: {skill_id}")
        if not (target / ".golden-uiux" / "data" / "patterns.json").is_file():
            raise RuntimeError(f"{client} project-local runtime data was not installed")
        for owned in receipt["created_files"]:
            file = target / owned["path"]
            if not file.is_file() or digest(file) != owned["sha256"]:
                raise RuntimeError(f"{client} installed file does not match ownership receipt")

        uninstall = base + ["--uninstall"]
        owned_hashes = {x["path"]: x["sha256"] for x in receipt["created_files"]}
        run(uninstall)  # rollback preview is also non-mutating
        if not receipt_path.is_file():
            raise RuntimeError(f"{client} rollback preview changed the receipt")
        for rel, expected_hash in owned_hashes.items():
            if not (target / rel).is_file() or digest(target / rel) != expected_hash:
                raise RuntimeError(f"{client} rollback preview altered owned file: {rel}")
        run(uninstall + ["--apply"])
        if list(target.iterdir()):
            raise RuntimeError(f"{client} rollback left files in the disposable project")
        return {"status": "PASS", "skills": len(skill_ids), "dry_run": "PASS",
                "install": "PASS", "receipt_hash_checks": "PASS",
                "rollback_preview": "PASS", "rollback": "PASS", "target": "disposable temporary directory"}


def main() -> int:
    started = time.monotonic()
    run([sys.executable, "install.py", "--verify-only"])
    manifest = json.loads((ROOT / "PACKAGE_SHA256.json").read_text(encoding="utf-8"))
    files = manifest.get("files", [])
    if not files:
        raise RuntimeError("package manifest is empty")
    expected_paths: set[str] = set()
    for item in files:
        name = item.get("path")
        if not isinstance(name, str) or "\\" in name:
            raise RuntimeError("manifest contains a malformed path")
        rel = PurePosixPath(name)
        if rel.is_absolute() or ".." in rel.parts or name in expected_paths:
            raise RuntimeError(f"manifest contains an unsafe or duplicate path: {name}")
        expected_paths.add(name)
        path = ROOT.joinpath(*rel.parts)
        if path.is_symlink() or not path.is_file() or digest(path) != item["sha256"]:
            raise RuntimeError(f"package inventory mismatch: {item['path']}")
    actual_paths = set()
    for path in ROOT.rglob("*"):
        if path.is_symlink():
            raise RuntimeError(f"package contains an unmanifested symlink: {path.relative_to(ROOT)}")
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT).as_posix()
        if rel == "PACKAGE_SHA256.json" or "/__pycache__/" in "/" + rel or rel.endswith((".pyc", ".pyo")):
            continue
        actual_paths.add(rel)
    if actual_paths != expected_paths:
        missing = sorted(actual_paths - expected_paths)
        extra = sorted(expected_paths - actual_paths)
        raise RuntimeError(f"manifest inventory differs; missing={missing}, extra={extra}")

    identity = json.loads((ROOT / "data" / "release_identity.json").read_text(encoding="utf-8"))
    sbom = json.loads((ROOT / "docs" / "SBOM.cdx.json").read_text(encoding="utf-8"))
    if manifest.get("version") != identity.get("version") or sbom["metadata"]["component"].get("version") != identity.get("version"):
        raise RuntimeError("package, release identity and SBOM versions disagree")
    guide = (ROOT / "PILOT_OWNER_GUIDE.html").read_text(encoding="utf-8")
    for href in re.findall(r'href="([^"#?]+)', guide):
        if href.startswith(("https://", "http://", "mailto:")):
            continue
        if not (ROOT / href).is_file():
            raise RuntimeError(f"owner guide link does not resolve inside package: {href}")

    from golden_uiux.core import patterns_index
    patterns = patterns_index()["patterns"]
    skill_dirs = sorted((ROOT / "opencode_skills").iterdir())
    skill_ids = [p.name for p in skill_dirs if p.is_dir() and (p / "SKILL.md").is_file()]
    if len(patterns) != 14 or len(skill_ids) != 9:
        raise RuntimeError(f"expected 14 patterns and 9 skills; got {len(patterns)} / {len(skill_ids)}")

    version = run([sys.executable, "uiux.py", "--version"]).stdout.strip()
    if version != manifest["version"]:
        raise RuntimeError("CLI and package manifest versions differ")
    listed = json.loads(run([sys.executable, "uiux.py", "patterns"]).stdout)
    if len(listed["patterns"]) != 14:
        raise RuntimeError("CLI pattern inventory is incomplete")
    p10 = json.loads(run([sys.executable, "uiux.py", "pattern", "P10"]).stdout)
    if p10.get("id") != "P10":
        raise RuntimeError("single-pattern command failed")
    route = json.loads(run([sys.executable, "uiux.py", "route",
                            "Rack spatial inventory and mounted asset inspection",
                            "--intent-spec", "examples/rack_spatial_intent.json"]).stdout)
    if route.get("intent_decision") != "ROUTED_FROM_STRUCTURED_INTENT" or not {"P02", "P03", "P10", "P12"}.issubset(route.get("all_relevant_pattern_ids", [])):
        raise RuntimeError("structured Rack route failed to select the source-supported pattern set")
    keyword_only = json.loads(run([sys.executable, "uiux.py", "route", "Rack spatial elevation search"]).stdout)
    if keyword_only.get("decision") != "NEEDS_STRUCTURED_INTENT" or keyword_only.get("all_relevant_pattern_ids"):
        raise RuntimeError("keyword-only task unexpectedly selected patterns")
    for subcommand in ("evaluate-gates", "gate-evidence", "api-contract",
                       "patch-manifest", "patch-replay", "navigation-continuity"):
        run([sys.executable, "uiux.py", subcommand, "--help"])

    result = {
        "package_version": version,
        "manifest_file_count": len(files),
        "manifest_sha256": digest(ROOT / "PACKAGE_SHA256.json"),
        "owner_guide_local_links": "PASS",
        "identity_sbom_version_consistency": "PASS",
        "cli": {"status": "PASS", "patterns": 14, "pattern_read": "PASS",
                "routing": "PASS", "gate_entrypoints": "PASS",
                "new_gate_entrypoints": "PASS"},
        "mcp": check_mcp(),
        "codex_project_local": check_client_layout("codex", skill_ids),
        "opencode_project_local": check_client_layout("opencode", skill_ids),
        "gates": {"G1_DATA_TRUTH": "validator available; no project proof",
                  "G2_API_CONTRACT": "validator available; no project proof",
                  "G3_ACCESSIBILITY": "validator available; no project proof",
            "G4_RENDERED_CONTRAST": "not executed by installer smoke; bounded SysGrid matrix evidence is separate",
            "G5_ELEMENT_GEOMETRY": "not executed by installer smoke; bounded SysGrid matrix evidence is separate",
                  "G6_EVIDENCE_AND_RULE_DELIVERY": "UNKNOWN — live client delivery is unauthenticated"},
        "rendered_browser_qualification": "NOT_RUN_BY_INSTALLER_SMOKE; see source-bound browser evidence separately",
        "sysgrid_qualification": "NOT_RUN_BY_INSTALLER_SMOKE; see bounded 32-state SysGrid matrix separately",
        "production_readiness": "NOT_ASSESSED",
        "elapsed_process_seconds": round(time.monotonic() - started, 3),
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, indent=2), file=sys.stderr)
        raise SystemExit(1)
