"""Prepare a source-bound design decision and implementation context packet.

This is an offline preparation tool. It makes applicable contracts and skill
bodies available in the generated context, but it cannot attest that a live
Codex/OpenCode client discovered, loaded, or followed them (G6 stays UNKNOWN).
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from pathlib import PurePosixPath
from typing import Any

from . import core

SKILLS_DIR = "opencode_skills"
BASE_SKILLS = ("ui-intent-router", "ui-pattern-resolution")
PATTERN_SKILLS = {
    "P01": ("ui-design-adapter",),
    "P02": ("ui-data-and-status",),
    "P03": ("ui-data-and-status",),
    "P04": ("ui-form-interactions", "ui-accessibility-contract"),
    "P05": ("ui-pattern-resolution",),
    "P06": ("ui-form-interactions", "ui-accessibility-contract"),
    "P07": ("ui-data-and-status",),
    "P08": ("ui-data-and-status", "ui-content-localization"),
    "P09": ("ui-data-and-status", "ui-evidence-gate"),
    "P10": ("ui-responsive-geometry",),
    "P11": ("ui-design-adapter",),
    "P12": ("ui-accessibility-contract",),
    "P13": ("ui-form-interactions", "ui-data-and-status"),
    "P14": ("ui-content-localization",),
}
DESIGN_CRITERIA = (
    "task_fit", "information_hierarchy", "identity_fit", "responsive_composition",
    "interaction_efficiency", "distinctiveness_within_product_context",
)
QUALITATIVE_STATES = {"strong_fit", "mixed_fit", "weak_fit", "unknown"}
NONPASS_STATES = {"NOT_RUN", "UNKNOWN", "BLOCKED", "FAIL"}


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _safe_text(value: Any, label: str, *, required: bool = True) -> str:
    if not isinstance(value, str) or (required and not value.strip()) or len(value) > 20_000:
        raise ValueError(f"{label} must be a nonempty string no longer than 20000 characters")
    return value


def _hash(value: Any, label: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
        raise ValueError(f"{label} must be a lowercase SHA-256 digest")
    return value


def _load_skill(root: Path, skill_id: str) -> tuple[str, str]:
    if skill_id not in {p.name for p in (root / SKILLS_DIR).iterdir() if p.is_dir()}:
        raise ValueError(f"Required project-local skill is missing: {skill_id}")
    path = root / SKILLS_DIR / skill_id / "SKILL.md"
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to((root / SKILLS_DIR).resolve()):
        raise ValueError(f"Required skill path is unsafe or missing: {skill_id}")
    return path.read_text(encoding="utf-8"), _sha(path)


def _verify_source_refs(refs: list[dict], source_root: Path) -> list[dict]:
    root = Path(source_root).resolve(strict=True)
    verified = []
    for ref in refs:
        posix = PurePosixPath(ref["path"])
        if posix.is_absolute() or ".." in posix.parts or "\\" in ref["path"] or not posix.parts:
            raise ValueError("Source reference must be a relative path inside source_root")
        path = root.joinpath(*posix.parts)
        probe = root
        for part in posix.parts:
            probe = probe / part
            if probe.is_symlink():
                raise ValueError("Source reference symlinks are not accepted")
        resolved = path.resolve(strict=True)
        if not resolved.is_relative_to(root) or not resolved.is_file():
            raise ValueError("Source reference must resolve to a regular file inside source_root")
        actual = _sha(resolved)
        if actual != ref["sha256"]:
            raise ValueError(f"Source reference digest mismatch: {ref['path']}")
        verified.append({"path": ref["path"], "sha256": actual, "verification": "BYTES_HASH_VERIFIED"})
    return verified


def prepare_design_workflow(spec: object, *, package_root: Path | None = None,
                            source_root: Path | None = None) -> dict:
    """Resolve patterns, assess two supplied directions and prepare skill context.

    The caller supplies two existing alternatives and evidence references. This
    function rejects malformed or missing comparisons; it never generates a
    product palette, component library, or aesthetic score on its own.
    """
    if not isinstance(spec, dict):
        raise ValueError("Design workflow request must be a JSON object")
    package_root = Path(package_root or core.ROOT).resolve()
    context_id = _safe_text(spec.get("context_id"), "context_id")
    product = spec.get("product_context")
    if not isinstance(product, dict):
        raise ValueError("product_context must be an object grounded in observed source evidence")
    product_name = _safe_text(product.get("name"), "product_context.name")
    purpose = _safe_text(product.get("purpose"), "product_context.purpose")
    identity = product.get("observed_identity")
    if not isinstance(identity, list) or not identity or any(not isinstance(x, str) or not x.strip() for x in identity):
        raise ValueError("product_context.observed_identity must be a nonempty list of source-observed conventions")
    context_refs = product.get("source_references")
    if not isinstance(context_refs, list) or not context_refs:
        raise ValueError("product_context.source_references must bind the observed context")
    for ref in context_refs:
        if not isinstance(ref, dict):
            raise ValueError("Each source reference must be an object")
        _safe_text(ref.get("path"), "source reference path")
        _hash(ref.get("sha256"), "source reference sha256")
    if source_root is None:
        raise ValueError("source_root is required to verify the provided context references")
    verified_refs = _verify_source_refs(context_refs, Path(source_root))
    declared_revision = _hash(product.get("source_revision_sha256"), "product_context.source_revision_sha256")

    task = _safe_text(spec.get("task"), "task")
    intent_spec = spec.get("intent_spec")
    if not isinstance(intent_spec, dict):
        raise ValueError("intent_spec is required; keyword-only routing is not accepted")
    intent_spec = dict(intent_spec)
    intent_spec["scope_mode"] = "isolated_prototype"
    route = core.route_task(task, spec.get("project_profile"), spec.get("explicit_patterns"), intent_spec)
    if route["intent_decision"] != "ROUTED_FROM_STRUCTURED_INTENT":
        raise ValueError(f"Pattern routing did not produce an executable selection: {route['intent_decision']}")
    pattern_ids = route["all_relevant_pattern_ids"]
    if not pattern_ids:
        raise ValueError("Structured intent selected no patterns")

    alternatives = spec.get("existing_alternatives")
    if not isinstance(alternatives, list) or len(alternatives) != 2:
        raise ValueError("Exactly two existing alternatives are required; this tool does not invent new directions")
    alternative_ids = []
    for alternative in alternatives:
        if not isinstance(alternative, dict):
            raise ValueError("Each existing alternative must be an object")
        alternative_ids.append(_safe_text(alternative.get("id"), "alternative.id"))
        _safe_text(alternative.get("name"), "alternative.name")
        _safe_text(alternative.get("composition"), "alternative.composition")
        _safe_text(alternative.get("tradeoffs"), "alternative.tradeoffs")
    if len(set(alternative_ids)) != 2:
        raise ValueError("Alternative IDs must be distinct")

    selection = spec.get("selection")
    if not isinstance(selection, dict):
        raise ValueError("selection rationale and evidence are required")
    chosen = _safe_text(selection.get("selected_alternative_id"), "selection.selected_alternative_id")
    if chosen not in alternative_ids:
        raise ValueError("Selected alternative must be one of the two supplied directions")
    rationale = _safe_text(selection.get("rationale"), "selection.rationale")
    comparisons = selection.get("comparisons")
    if not isinstance(comparisons, dict) or set(comparisons) != set(alternative_ids):
        raise ValueError("Each alternative must be evaluated against the same design criteria")
    for alternative_id, evaluation in comparisons.items():
        if not isinstance(evaluation, dict) or set(evaluation) != set(DESIGN_CRITERIA):
            raise ValueError(f"{alternative_id} must assess all and only the declared design criteria")
        for criterion, result in evaluation.items():
            if not isinstance(result, dict) or result.get("fit") not in QUALITATIVE_STATES:
                raise ValueError(f"{alternative_id}.{criterion} requires a qualitative fit state")
            _safe_text(result.get("basis"), f"{alternative_id}.{criterion}.basis")
            refs = result.get("evidence_refs")
            if not isinstance(refs, list) or not refs or any(x not in [r["path"] for r in context_refs] for x in refs):
                raise ValueError(f"{alternative_id}.{criterion} requires source-bound evidence references")

    hard_gate_status = spec.get("hard_gate_status")
    if hard_gate_status is None:
        hard_gate_status = {"functional": "NOT_RUN", "data_truth": "NOT_RUN", "accessibility": "NOT_RUN", "theme": "NOT_RUN", "responsive_geometry": "NOT_RUN", "rendered_visual_review": "NOT_RUN"}
    if not isinstance(hard_gate_status, dict) or any(value not in NONPASS_STATES for value in hard_gate_status.values()):
        raise ValueError("Design selection cannot self-assert hard-gate PASS; supply only NOT_RUN/UNKNOWN/BLOCKED/FAIL records here")

    skill_ids = set(BASE_SKILLS)
    for pattern_id in pattern_ids:
        skill_ids.update(PATTERN_SKILLS[pattern_id])
    skill_ids.add("ui-evidence-gate")
    skills = []
    for skill_id in sorted(skill_ids):
        body, digest = _load_skill(package_root, skill_id)
        skills.append({"id": skill_id, "sha256": digest, "body": body})

    contracts = [core.get_pattern(pattern_id) for pattern_id in pattern_ids]
    design_context = {
        "schema": "golden-uiux.design-selection.v1",
        "context_id": context_id,
        "product": {"name": product_name, "purpose": purpose, "observed_identity": identity,
                    "source_revision_sha256": declared_revision,
                    "source_tree_digest_verified_by_this_command": False,
                    "source_references": verified_refs},
        "task": task,
        "intent_spec": intent_spec,
        "routing": route,
        "alternatives": alternatives,
        "selection": {"selected_alternative_id": chosen, "rationale": rationale,
                      "criteria": list(DESIGN_CRITERIA), "comparisons": comparisons,
                      "assessment_kind": "AGENT_AUTHORED_QUALITATIVE_DESIGN_DECISION",
                      "independent_aesthetic_review": "NOT_RUN",
                      "rendered_visual_quality": "NOT_ASSESSED"},
        "hard_gate_status": hard_gate_status,
        "pattern_contracts": contracts,
        "skill_sources": [{"id": s["id"], "sha256": s["sha256"]} for s in skills],
        "delivery_state": "CONTEXT_PACKET_PREPARED_NOT_AUTHENTICATED",
        "g6_status": "UNKNOWN",
        "rendered_visual_qa": "NOT_RUN",
        "visual_quality_claim": "NONE",
        "profile_policy": route["profile_policy"],
        "authorization_state": "NOT_GRANTED_BY_TOOL",
    }
    canonical_plan = json.dumps(design_context, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    context_lines = [
        f"# Implementation context: {product_name}",
        "",
        "> Prepared from source-bound project observations. This file proves only that these bytes were assembled locally; it is not proof a client or agent received/read them. G6 remains UNKNOWN.",
        "",
        "## Product goal and observed design conventions",
        purpose,
        "",
        *[f"- {x}" for x in identity],
        "",
        "## Task and workflow",
        task,
        "",
        *[f"- {step}" for step in intent_spec["workflow_steps"]],
        "",
        "## Selected direction",
        f"{chosen}: {rationale}",
        "",
        "## Pattern selection from structured intent and component needs",
        *[f"- {p['id']} — {p['family']}: {'; '.join(route['pattern_reasons'][p['id']])}" for p in contracts],
        "",
        "## Profile boundary",
        f"Profile state: {route['profile_policy']['state']}. Scope mode: {route['profile_policy']['scope_mode']}.",
        *[f"- Safe default: {item}" for item in route["profile_policy"]["safe_defaults"]],
        *[f"- Block until an approved profile/authority exists: {item}" for item in route["profile_policy"]["blocked_requirements"]],
        "",
        "## Hard-gate status",
        *[f"- {key}: {value}" for key, value in hard_gate_status.items()],
        "Do not treat a missing observation as PASS. A design choice cannot waive these checks.",
    ]
    for contract in contracts:
        context_lines.extend(["", f"## {contract['id']} pattern contract — {contract['family']}",
                              "Select when: " + json.dumps(contract["select"], ensure_ascii=False),
                              "Avoid when: " + json.dumps(contract["avoid"], ensure_ascii=False),
                              "Required states: " + json.dumps(contract["states"], ensure_ascii=False),
                              "Acceptance: " + json.dumps(contract["accept"], ensure_ascii=False),
                              "Probes: " + json.dumps(contract["probes"], ensure_ascii=False)])
    for skill in skills:
        context_lines.extend(["", f"## Native skill: {skill['id']} (sha256:{skill['sha256']})", skill["body"].rstrip()])
    context_lines.extend(["", "## Evidence boundary", "Pattern and skill bodies above were included in this locally assembled context packet. This is not authenticated native-client delivery. G6 remains UNKNOWN; rendered visual QA is NOT_RUN."])
    context_bytes = ("\n".join(context_lines) + "\n").encode("utf-8")
    return {
        "plan": design_context,
        "plan_sha256": hashlib.sha256(canonical_plan).hexdigest(),
        "agent_context_markdown": context_bytes.decode("utf-8"),
        "agent_context_sha256": hashlib.sha256(context_bytes).hexdigest(),
        "delivery_manifest": {
            "schema": "golden-uiux.prepared-context-manifest.v1",
            "context_id": context_id,
            "recipient": "NOT_BOUND_TO_A_LIVE_CLIENT",
            "referenced_files_verified": True,
            "source_tree_digest_verified_by_this_command": False,
            "source_bound_skill_bodies": [{"id": s["id"], "sha256": s["sha256"]} for s in skills],
            "source_bound_pattern_ids": pattern_ids,
            "plan_sha256": hashlib.sha256(canonical_plan).hexdigest(),
            "agent_context_sha256": hashlib.sha256(context_bytes).hexdigest(),
            "authenticated_delivery": False,
            "g6_status": "UNKNOWN",
            "visual_review_status": "NOT_RUN",
        },
    }


def write_design_workflow(spec: object, output_dir: Path, *, package_root: Path | None = None,
                          source_root: Path | None = None) -> dict:
    """Create a new output directory and never overwrite an earlier packet."""
    output_dir = Path(output_dir)
    if output_dir.exists() or output_dir.is_symlink():
        raise ValueError("Output directory already exists or is a symlink; use a new destination")
    result = prepare_design_workflow(spec, package_root=package_root, source_root=source_root)
    output_dir.mkdir(parents=True, exist_ok=False)
    (output_dir / "design-plan.json").write_text(json.dumps(result["plan"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "agent-context.md").write_text(result["agent_context_markdown"], encoding="utf-8")
    (output_dir / "delivery-manifest.json").write_text(json.dumps(result["delivery_manifest"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    result["output_dir"] = str(output_dir.resolve())
    return result
