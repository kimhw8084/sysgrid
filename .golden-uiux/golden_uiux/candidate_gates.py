"""Experimental fail-closed aggregator for source-bound hard-gate evidence.

This validates record structure and artifact hashes only; it does not grant authority,
attest that a test was executed by a trusted CI system, or certify product quality.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path, PurePosixPath
from datetime import datetime
from typing import Iterable, Mapping

from .gate_ids import GATE_IDS

STATUSES = {"PASS", "FAIL", "BLOCKED", "NOT_RUN", "UNKNOWN", "NOT_APPLICABLE", "WAIVED"}
UTC_REQUIRED = ("started_at", "completed_at")
PASS_REQUIRED = ("gate_id", "rule_ids", "applicability", "check_id", "command", "runner_sha256", "source_binding", *UTC_REQUIRED)


def _valid_sha256(value: object) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-fA-F]{64}", value) is not None


def _valid_aware_datetime(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None and parsed.utcoffset() is not None


def _binding_value(binding: Mapping, name: str):
    """Read the common v0.2.3 envelope's nested binding representation."""
    node = binding
    for part in name.split("."):
        if not isinstance(node, Mapping) or part not in node:
            return None
        node = node[part]
    return node


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_evidence_file(root: Path, artifact: Mapping) -> tuple[bool, str]:
    rel = artifact.get("path")
    expected = artifact.get("sha256")
    if not isinstance(rel, str) or not rel or "\\" in rel or "\x00" in rel or not _valid_sha256(expected):
        return False, "evidence entry requires relative path and SHA-256"
    posix = PurePosixPath(rel)
    if posix.is_absolute() or ".." in posix.parts or not posix.parts:
        return False, "evidence path must remain beneath evidence_root"
    target = (root / Path(*posix.parts)).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError:
        return False, "evidence symlink escapes evidence_root"
    if not target.is_file():
        return False, "evidence artifact is missing"
    actual = _sha256(target)
    if actual != expected:
        return False, "evidence artifact digest mismatch"
    return True, "verified"


def aggregate_gate_results(
    records: Iterable[Mapping],
    *,
    required_gate_ids: Iterable[str],
    expected_bindings: Mapping[str, str],
    evidence_root: str | Path,
    waiver_allowlist: Iterable[str] = (),
) -> dict:
    """Aggregate records without allowing absent, stale, UNKNOWN or unverified proof to pass.

    A structurally valid PASS is accepted only when every source binding matches and each
    evidence file exists under evidence_root with the declared SHA-256. This remains local
    integrity checking, not cryptographic signature verification of the runner identity.
    """
    required = tuple(required_gate_ids)
    root = Path(evidence_root)
    issues: list[str] = []
    if (not required or any(not isinstance(gate_id, str) for gate_id in required)
            or len({gate_id for gate_id in required if isinstance(gate_id, str)}) != len(required)):
        issues.append("required_gate_ids must be a non-empty unique subset of the canonical G1–G6 mapping")
    if any(gate_id not in GATE_IDS for gate_id in required):
        issues.append("required_gate_ids contains an identifier outside the canonical G1–G6 mapping")
    if not isinstance(expected_bindings, Mapping) or not expected_bindings:
        issues.append("expected source/catalog/profile/environment/checker bindings are missing")
    else:
        required_binding_keys = {
            "source_revision.sha256", "catalog.sha256", "environment.mode", "checker.sha256"
        }
        missing_bindings = sorted(key for key in required_binding_keys
                                  if not _valid_sha256(expected_bindings.get(key))
                                  and key != "environment.mode")
        if not isinstance(expected_bindings.get("environment.mode"), str) or not expected_bindings.get("environment.mode", "").strip():
            missing_bindings.append("environment.mode")
        profile_digest = expected_bindings.get("project_profile.sha256")
        if not _valid_sha256(profile_digest):
            profile_na = expected_bindings.get("project_profile.status") == "NOT_APPLICABLE"
            if not profile_na or not all(
                isinstance(expected_bindings.get(key), str) and expected_bindings.get(key, "").strip()
                for key in ("project_profile.reason", "project_profile.authority")
            ):
                missing_bindings.append("project_profile.sha256 (or justified NOT_APPLICABLE profile binding)")
        if missing_bindings:
            issues.append("expected bindings incomplete or invalid: " + ", ".join(sorted(set(missing_bindings))))
    normalized: dict[str, dict] = {}
    errors: dict[str, list[str]] = {}
    for index, raw in enumerate(records):
        label = f"record[{index}]"
        if not isinstance(raw, Mapping):
            issues.append(f"{label}: record must be an object")
            continue
        gate = raw.get("gate_id")
        if not isinstance(gate, str) or not gate:
            issues.append(f"{label}: gate_id missing")
            continue
        if gate not in GATE_IDS:
            issues.append(f"{label}: gate_id must use the canonical G1–G6 mapping")
            continue
        if gate in normalized:
            issues.append(f"{gate}: duplicate result")
            errors.setdefault(gate, []).append("duplicate result")
            continue
        rec = dict(raw)
        normalized[gate] = rec
        problems: list[str] = []
        status = rec.get("status")
        applicability = rec.get("applicability")
        applicability_status = applicability.get("status") if isinstance(applicability, Mapping) else None
        if status not in STATUSES:
            problems.append("unsupported or missing status")
        if applicability_status not in ("APPLICABLE", "NOT_APPLICABLE", "UNKNOWN"):
            problems.append("invalid applicability")
        if status == "PASS":
            for field in PASS_REQUIRED:
                if field not in rec or rec[field] in (None, "", [], {}):
                    problems.append(f"missing {field}")
            if applicability_status != "APPLICABLE":
                problems.append("PASS requires APPLICABLE")
            if not isinstance(rec.get("rule_ids"), list) or not rec.get("rule_ids") or not all(isinstance(rule, str) and rule for rule in rec.get("rule_ids", [])):
                problems.append("PASS requires non-empty rule identifiers")
            if not isinstance(rec.get("check_id"), str) or not rec.get("check_id") or not isinstance(rec.get("command"), str) or not rec.get("command"):
                problems.append("PASS requires a check ID and reproducible command")
            if not _valid_sha256(rec.get("runner_sha256")):
                problems.append("runner_sha256 must be a SHA-256")
            binding = rec.get("source_binding")
            if not isinstance(binding, Mapping):
                problems.append("source_binding must be an object")
                binding = {}
            for field, expected in expected_bindings.items():
                actual = _binding_value(binding, field)
                if actual != expected:
                    problems.append(f"stale or mismatched source_binding.{field}")
            for field in ("source_revision.sha256", "catalog.sha256", "checker.sha256"):
                if not _valid_sha256(_binding_value(binding, field)):
                    problems.append(f"source_binding.{field} must be a SHA-256")
            if not isinstance(_binding_value(binding, "project_profile"), Mapping):
                problems.append("source_binding.project_profile must be an object")
            else:
                profile = _binding_value(binding, "project_profile")
                if profile.get("status") == "BOUND" and not _valid_sha256(profile.get("sha256")):
                    problems.append("bound project profile must include a SHA-256")
                elif profile.get("status") == "NOT_APPLICABLE" and not profile.get("reason"):
                    problems.append("unbound project profile requires a reason")
                elif profile.get("status") not in {"BOUND", "NOT_APPLICABLE"}:
                    problems.append("project profile status must be BOUND or NOT_APPLICABLE")
            if not isinstance(_binding_value(binding, "environment.mode"), str) or not _binding_value(binding, "environment.mode"):
                problems.append("source_binding.environment.mode is required")
            started, completed = rec.get("started_at"), rec.get("completed_at")
            if not _valid_aware_datetime(started) or not _valid_aware_datetime(completed):
                problems.append("timestamps must be valid timezone-aware ISO-8601")
            elif datetime.fromisoformat(completed.replace("Z", "+00:00")) < datetime.fromisoformat(started.replace("Z", "+00:00")):
                problems.append("completed_at must not precede started_at")
            artifacts = rec.get("evidence")
            if not isinstance(artifacts, list) or not artifacts:
                problems.append("PASS requires at least one evidence artifact")
            else:
                for artifact_index, artifact in enumerate(artifacts):
                    if not isinstance(artifact, Mapping):
                        problems.append(f"evidence[{artifact_index}] must be an object")
                        continue
                    ok, reason = _safe_evidence_file(root, artifact)
                    if not ok:
                        problems.append(f"evidence[{artifact_index}]: {reason}")
        elif status == "NOT_APPLICABLE":
            authority = applicability.get("authority") if isinstance(applicability, Mapping) else None
            if applicability_status != "NOT_APPLICABLE" or not applicability.get("justification") or not isinstance(authority, Mapping) or not authority.get("reference"):
                problems.append("NOT_APPLICABLE requires independent rationale and authority")
        elif status == "WAIVED":
            if gate not in set(waiver_allowlist):
                problems.append("waiver not permitted for this gate")
            waiver = rec.get("waiver")
            if not isinstance(waiver, Mapping) or not all(waiver.get(k) for k in ("owner", "authority", "scope", "reason", "expires_at")):
                problems.append("WAIVED requires bounded authority, scope, reason and expiry")
        if problems:
            errors[gate] = problems

    for gate in required:
        if gate not in normalized:
            issues.append(f"{gate}: required result missing")
    unexpected = sorted(set(normalized) - set(required))
    if unexpected:
        issues.append(f"unexpected gate results: {unexpected}")
    for gate, problems in errors.items():
        issues.extend(f"{gate}: {problem}" for problem in problems)
    failing = [g for g in required if g in normalized and normalized[g].get("status") == "FAIL"]
    unresolved = [g for g in required if g not in normalized or normalized[g].get("status") in {"BLOCKED", "NOT_RUN", "UNKNOWN"} or errors.get(g)]
    satisfied_exceptions = [g for g in required if g in normalized and normalized[g].get("status") in {"NOT_APPLICABLE", "WAIVED"} and not errors.get(g)]
    if failing:
        evidence_status = "FAIL"
    elif unresolved or satisfied_exceptions or unexpected or issues:
        evidence_status = "BLOCKED"
    elif required and all(normalized[g].get("status") == "PASS" for g in required):
        evidence_status = "PASS"
    else:
        evidence_status = "BLOCKED"
    # This local aggregator can verify record shape and evidence bytes, but cannot
    # authenticate who ran the checks. Keep qualification/promotion blocked until
    # a separately trusted verifier validates runner provenance and execution.
    overall = "FAIL" if evidence_status == "FAIL" else "BLOCKED"
    return {
        "schema": "golden-uiux.hard-gate-aggregation.v1",
        "status": overall,
        "evidence_record_status": evidence_status,
        "promotion_permitted": False,
        "metadata_validation_only": True,
        "runner_signature_verified": False,
        "required_gate_ids": list(required),
        "observed_gate_ids": sorted(normalized),
        "status_counts": {state: sum(1 for g in required if g in normalized and normalized[g].get("status") == state) for state in sorted(STATUSES)},
        "satisfied_exception_gate_ids": satisfied_exceptions,
        "issues": issues,
        "gate_errors": errors,
        "limitations": ["Local SHA-256 checks detect content drift but do not authenticate a runner or prove a command was honestly executed.", "Qualification remains BLOCKED until an independently trusted execution verifier authenticates runner provenance; this module never grants promotion or owner authorization."],
    }
