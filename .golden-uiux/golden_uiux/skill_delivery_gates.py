"""Offline validator for a requirement-to-rule-to-skill delivery trace.

This checks a supplied trace's internal consistency; it does not attest that
an agent's live context contained the declared content. A trusted launcher must
bind and authenticate the delivery receipt before this gate can be relied upon.
"""
from __future__ import annotations

import re
from datetime import datetime
from .gate_ids import G6_EVIDENCE_AND_RULE_DELIVERY, GATE_DESCRIPTIONS
from typing import Mapping

SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")


def _sha(value: object) -> bool:
    return isinstance(value, str) and SHA256.fullmatch(value) is not None


def _time(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None and parsed.utcoffset() is not None


def evaluate_delivery_trace(trace: Mapping | None, *, expected: Mapping) -> dict:
    """Validate complete coverage and receipts without trusting file presence.

    Expected keys: ``catalog_sha256``, ``source_tree_sha256``,
    ``profile_sha256`` (may be ``None`` only when profile is explicitly N/A),
    and ``recipient_id``. Trace keys include ``requirements`` (rule→patterns),
    ``rule_to_skills``, ``skills`` (id→digest), ``selected_patterns``,
    ``receipts``, ``decisions`` and ``proofs``.
    """
    issues: list[str] = []
    if not isinstance(trace, Mapping):
        return _result("BLOCKED", ["delivery trace is missing or not an object"])
    for key in ("catalog_sha256", "source_tree_sha256"):
        if not _sha(expected.get(key)):
            issues.append(f"expected.{key} is not a SHA-256")
        if trace.get(key) != expected.get(key):
            issues.append(f"stale or missing {key}")
    expected_profile = expected.get("profile_sha256")
    if expected_profile is None:
        reason = expected.get("profile_not_applicable_reason")
        authority = expected.get("profile_not_applicable_authority")
        if not isinstance(reason, str) or not reason.strip() or not isinstance(authority, str) or not authority.strip():
            issues.append("profile_sha256 may be absent only with an explicit N/A reason and authority")
        elif (trace.get("profile_status") != "NOT_APPLICABLE"
              or trace.get("profile_not_applicable_reason") != reason
              or trace.get("profile_not_applicable_authority") != authority):
            issues.append("trace does not match the authorized NOT_APPLICABLE profile decision")
    elif not _sha(expected_profile) or trace.get("profile_sha256") != expected_profile:
        issues.append("stale or missing profile_sha256")
    recipient = expected.get("recipient_id")
    if not isinstance(recipient, str) or not recipient:
        issues.append("expected.recipient_id is required")
    elif trace.get("recipient_id") != recipient:
        issues.append("delivery recipient does not match the task agent")

    requirements = trace.get("requirements")
    rule_to_skills = trace.get("rule_to_skills")
    skills = trace.get("skills")
    selected = trace.get("selected_patterns")
    if not isinstance(requirements, Mapping) or not requirements:
        issues.append("applicable requirements are missing")
        requirements = {}
    if not isinstance(rule_to_skills, Mapping):
        issues.append("rule-to-skill coverage map is missing")
        rule_to_skills = {}
    if not isinstance(skills, Mapping):
        issues.append("skill catalog digest map is missing")
        skills = {}
    if not isinstance(selected, list):
        issues.append("selected pattern list is missing")
        selected = []
    selected_set = set(x for x in selected if isinstance(x, str))

    required_skills: set[str] = set()
    for rule_id, patterns in requirements.items():
        if not isinstance(rule_id, str) or not rule_id or not isinstance(patterns, list):
            issues.append("each applicable requirement needs a rule ID and pattern list")
            continue
        missing_patterns = [p for p in patterns if p not in selected_set]
        if missing_patterns:
            issues.append(f"{rule_id}: applicable pattern(s) not selected: {', '.join(map(str, missing_patterns))}")
        mapped = rule_to_skills.get(rule_id)
        if not isinstance(mapped, list) or not mapped:
            issues.append(f"{rule_id}: mandatory rule has no delivery skill mapping")
            continue
        required_skills.update(s for s in mapped if isinstance(s, str) and s)

    for skill_id in required_skills:
        if not _sha(skills.get(skill_id)):
            issues.append(f"{skill_id}: applicable skill digest missing or invalid")

    receipts = trace.get("receipts")
    if not isinstance(receipts, list):
        issues.append("skill delivery receipts are missing")
        receipts = []
    receipt_by_skill: dict[str, Mapping] = {}
    for receipt in receipts:
        if not isinstance(receipt, Mapping):
            issues.append("receipt must be an object")
            continue
        skill_id = receipt.get("skill_id")
        if not isinstance(skill_id, str) or not skill_id:
            issues.append("receipt skill_id is missing")
            continue
        if skill_id in receipt_by_skill:
            issues.append(f"{skill_id}: duplicate delivery receipt")
            continue
        receipt_by_skill[skill_id] = receipt
        if skill_id not in required_skills:
            issues.append(f"{skill_id}: receipt is outside the applicable skill set")
        if receipt.get("skill_sha256") != skills.get(skill_id) or not _sha(receipt.get("skill_sha256")):
            issues.append(f"{skill_id}: delivered skill digest does not match catalog")
        if receipt.get("recipient_id") != recipient:
            issues.append(f"{skill_id}: receipt recipient mismatch")
        if receipt.get("status") != "DELIVERED":
            issues.append(f"{skill_id}: receipt is not DELIVERED")
        if not _sha(receipt.get("delivery_event_sha256")):
            issues.append(f"{skill_id}: delivery event digest missing")
        if not _time(receipt.get("delivered_at")):
            issues.append(f"{skill_id}: delivery timestamp invalid")

    for skill_id in sorted(required_skills):
        if skill_id not in receipt_by_skill:
            issues.append(f"{skill_id}: applicable skill has no delivery receipt")

    decisions = trace.get("decisions")
    if not isinstance(decisions, Mapping):
        issues.append("rule decision trace is missing")
        decisions = {}
    proofs = trace.get("proofs")
    if not isinstance(proofs, Mapping):
        issues.append("rule proof map is missing")
        proofs = {}
    for rule_id in requirements:
        decision = decisions.get(rule_id)
        if not isinstance(decision, Mapping) or not decision.get("decision_id") or not decision.get("choice"):
            issues.append(f"{rule_id}: agent design decision was not recorded")
        proof = proofs.get(rule_id)
        if not isinstance(proof, Mapping):
            issues.append(f"{rule_id}: implementation/verification proof is missing")
            continue
        if proof.get("status") not in {"PASS", "FAIL", "BLOCKED", "NOT_RUN", "UNKNOWN"}:
            issues.append(f"{rule_id}: proof status is missing or unsupported")
        if proof.get("status") == "PASS" and not _sha(proof.get("artifact_sha256")):
            issues.append(f"{rule_id}: PASS lacks a hashed proof artifact")

    if issues:
        return _result("BLOCKED", issues)
    # This module validates declared receipt consistency only. It cannot prove
    # that a client actually delivered those bytes to the model context.
    return {
        **_result("UNKNOWN", ["trace is structurally complete, but delivery and execution authenticity are not attested"]),
        "trace_consistency": "PASS",
        "delivery_authenticity": "UNKNOWN",
        "promotion_permitted": False,
        "limitations": [
            "A hash-valid receipt is not proof that an agent runtime received or read the skill body.",
            "A trusted launcher must authenticate the delivery event and bind it to the live agent context.",
            "This module does not grant write, integration, publication, approval or execution authority.",
        ],
    }


def _result(status: str, issues: list[str]) -> dict:
    return {
        "schema": "golden-uiux.skill-delivery-trace.v1",
        "gate_id": G6_EVIDENCE_AND_RULE_DELIVERY,
        "gate_description": GATE_DESCRIPTIONS[G6_EVIDENCE_AND_RULE_DELIVERY],
        "status": status,
        "applicability": "APPLICABLE",
        "rule_ids": [],
        "findings": [{"status": status, "summary": issue} for issue in issues],
        "evidence": [],
        "source_binding": {},
        "issues": issues,
        "promotion_permitted": False,
    }
