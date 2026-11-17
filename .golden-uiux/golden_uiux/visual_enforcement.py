"""Invoke the independent local Playwright visual constraint runner.

This module provides a dependency-free Python CLI boundary. Browser collection
is performed by the separately hashed Node runner; it never starts a browser
unless the caller explicitly invokes this command.
"""
from __future__ import annotations

import json
import gzip
import hashlib
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any


def _read_json(path: Path) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size > 2_000_000:
        raise ValueError("visual request must be an existing JSON file under 2 MB")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("visual request must be a JSON object")
    return data


def _read_runner_report(output: Path) -> dict[str, Any] | None:
    report_path = output / "report.json"
    if not report_path.is_file():
        return None
    report = json.loads(report_path.read_text(encoding="utf-8"))
    compressed = report.get("full_report")
    if not compressed:
        return report
    if compressed.get("path") != "report.json.gz":
        raise ValueError("compressed visual report path is not the expected sibling artifact")
    full_path = output / "report.json.gz"
    payload = full_path.read_bytes()
    if hashlib.sha256(payload).hexdigest() != compressed.get("sha256"):
        raise ValueError("compressed visual report digest mismatch")
    with gzip.open(full_path, "rt", encoding="utf-8") as stream:
        full = json.load(stream)
    if full.get("schema") != report.get("schema") or full.get("status") != report.get("status"):
        raise ValueError("compressed visual report does not match its index")
    return full


def run_visual_enforcement(spec_path: Path, output: Path, *, allow_remote: bool = False,
                           allow_interactions: bool = False, allow_writes: bool = False,
                           playwright_module: str | None = None,
                           browser_executable: str | None = None,
                           gzip_evidence: bool = False) -> dict[str, Any]:
    spec_path = Path(spec_path).resolve(strict=True)
    spec = _read_json(spec_path)
    if spec.get("schema") != "golden.visual-enforcement.v1":
        raise ValueError("unsupported visual-enforcement request schema")
    if not isinstance(spec.get("source_root"), str):
        raise ValueError("source_root is required for candidate isolation and evidence binding")
    source_root = (spec_path.parent / spec["source_root"]).resolve(strict=True)
    if not source_root.is_dir():
        raise ValueError("source_root must be a directory")
    output = Path(output).resolve(strict=False)
    if output == source_root or output.is_relative_to(source_root):
        raise ValueError("evidence output must be outside application source_root")
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise ValueError("evidence output must be new or empty; existing evidence is never overwritten")
    if allow_writes and not allow_interactions:
        raise ValueError("--allow-writes requires --allow-interactions")
    if allow_writes and spec.get("isolated_nonproduction") is not True:
        raise ValueError("--allow-writes requires isolated_nonproduction=true")
    node = shutil.which(os.environ.get("GOLDEN_NODE_BINARY", "node"))
    if not node:
        return {"status": "BLOCKED", "reason": "Node.js runtime is unavailable", "browser": "NOT_RUN"}
    runner = Path(__file__).resolve().parents[1] / "devtools" / "visual_enforcer.mjs"
    if not runner.is_file():
        return {"status": "BLOCKED", "reason": "visual enforcement runner is missing", "browser": "NOT_RUN"}
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [node, str(runner), "--spec", str(spec_path), "--output", str(output)]
    if allow_remote:
        command.append("--allow-remote")
    if allow_interactions:
        command.append("--allow-interactions")
    if allow_writes:
        command.append("--allow-writes")
    if gzip_evidence:
        command.append("--gzip-evidence")
    if playwright_module:
        command.extend(["--playwright-module", playwright_module])
    if browser_executable:
        command.extend(["--browser-executable", browser_executable])
    result = subprocess.run(command, cwd=source_root, text=True, capture_output=True, check=False)
    report = _read_runner_report(output)
    if report is not None:
        report["process"] = {"exit_code": result.returncode, "stdout": result.stdout.strip()[-2000:],
                             "stderr": result.stderr.strip()[-2000:]}
        return report
    tail = (result.stderr or result.stdout).strip()[-2000:]
    try:
        parsed = json.loads(tail.splitlines()[-1])
    except (json.JSONDecodeError, IndexError):
        parsed = {"error": tail or "browser process returned no report"}
    return {"status": parsed.get("status", "BLOCKED"), "reason": parsed.get("error", "browser evidence unavailable"),
            "browser": "NOT_RUN", "process": {"exit_code": result.returncode, "stderr": tail}}
