"""Normalize candidate gate outputs without strengthening their conclusions.

This adapter is intentionally an evidence-shape boundary. It does not verify
that a runner executed the declared check; candidate_gates performs local
artifact-byte checks, and a separately trusted verifier must authenticate the
runner and execution before qualification can be claimed.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from .gate_ids import GATE_DESCRIPTIONS, GATE_IDS

ALLOWED = {"PASS", "FAIL", "BLOCKED", "NOT_RUN", "UNKNOWN", "NOT_APPLICABLE", "WAIVED"}


def adapt_gate_result(
    result: Mapping[str, Any],
    *,
    source_binding: Mapping[str, Any],
    evidence_artifacts: list[Mapping[str, str]],
    execution: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Return the shared envelope, only downgrading unsupported PASS claims.

    `evidence_artifacts` must be supplied by the caller and later verified under
    the aggregation evidence root. The module's explanatory evidence values
    remain in `details`; they are never treated as artifact proof by themselves.
    """
    status = result.get("status")
    if status not in ALLOWED:
        status = "BLOCKED"
        findings = [{"id": "invalid-status", "status": "BLOCKED", "summary": "Module returned an unsupported status."}]
    else:
        raw = result.get("findings", [])
        if not isinstance(raw, list):
            raw = ["Module findings were malformed."]
            status = "BLOCKED"
        findings = []
        for index, finding in enumerate(raw):
            if isinstance(finding, Mapping):
                findings.append(dict(finding))
            else:
                findings.append({"id": f"finding-{index + 1}", "status": status, "summary": str(finding)})

    gate_id = result.get("gate_id")
    rules = result.get("rule_ids")
    applicability = result.get("applicability")
    if isinstance(applicability, str):
        applicability = {"status": applicability}
    if not isinstance(gate_id, str) or gate_id not in GATE_IDS or not isinstance(rules, list) or not rules or not isinstance(applicability, Mapping):
        status = "BLOCKED"
        findings.append({"id": "envelope-incomplete", "status": "BLOCKED", "summary": "Canonical gate identity, rules, or applicability are missing or invalid."})
        gate_id = gate_id if isinstance(gate_id, str) and gate_id else "UNKNOWN_GATE"
        rules = rules if isinstance(rules, list) else []
        applicability = applicability if isinstance(applicability, Mapping) else {"status": "UNKNOWN"}

    artifacts = []
    if isinstance(evidence_artifacts, list):
        artifacts = [dict(item) for item in evidence_artifacts if isinstance(item, Mapping)]
    if status == "PASS":
        if not artifacts or any(not isinstance(item.get("path"), str) or not item.get("path") or not isinstance(item.get("sha256"), str) for item in artifacts):
            status = "BLOCKED"
            findings.append({"id": "evidence-reference-missing", "status": "BLOCKED", "summary": "PASS requires hash-addressed evidence files; module assertions are insufficient."})
        if not isinstance(source_binding, Mapping) or not source_binding:
            status = "BLOCKED"
            findings.append({"id": "source-binding-missing", "status": "BLOCKED", "summary": "PASS requires the common source-binding envelope."})

    run = execution if isinstance(execution, Mapping) else {}
    if status == "PASS" and any(not isinstance(run.get(key), str) or not run.get(key) for key in ("check_id", "command", "runner_sha256", "started_at", "completed_at")):
        status = "BLOCKED"
        findings.append({"id": "execution-metadata-missing", "status": "BLOCKED", "summary": "PASS requires bound runner, check, command, and timestamps."})

    # Preserve non-PASS states exactly; never turn UNKNOWN/NOT_RUN/FAIL into PASS.
    return {
        "schema": "golden-uiux.hard-gate-result.v1",
        "gate_id": gate_id,
        "gate_description": GATE_DESCRIPTIONS.get(gate_id, "Invalid gate ID; must use the canonical G1–G6 mapping."),
        "status": status,
        "applicability": dict(applicability),
        "rule_ids": list(rules),
        "findings": findings,
        "evidence": artifacts,
        "source_binding": dict(source_binding) if isinstance(source_binding, Mapping) else {},
        "details": result.get("evidence", {}),
        "check_id": run.get("check_id"),
        "command": run.get("command"),
        "runner_sha256": run.get("runner_sha256"),
        "started_at": run.get("started_at"),
        "completed_at": run.get("completed_at"),
    }
