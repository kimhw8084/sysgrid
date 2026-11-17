"""Source-bound design-session handoff and evidence orchestration.

The CLI prepares an isolated implementation workspace, routes the applicable
patterns and skill bodies into an agent task, compares submitted implementation
bytes with the frozen starter, and invokes the existing six-gate dispatcher.
It does not generate UI code or authenticate the agent/client that receives it.
"""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path, PurePosixPath
from typing import Any

from . import core
from .design_workflow import BASE_SKILLS, PATTERN_SKILLS, _verify_source_refs
from .gate_pipeline import checker_digest, evaluate_request

SESSION_SCHEMA = "golden-uiux.design-session-request.v1"
SUBMISSION_SCHEMA = "golden-uiux.design-session-submission.v1"
GATE_STATES = {"PASS", "FAIL", "BLOCKED", "UNKNOWN", "NOT_RUN"}
FIT_STATES = {"strong_fit", "mixed_fit", "weak_fit", "unknown"}
SESSION_CRITERIA = (
    "task_fit", "information_hierarchy", "readability", "density", "composition",
    "interaction_efficiency", "identity_fit", "responsive_composition",
    "distinctiveness_within_product_context",
)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _file_sha(path: Path) -> str:
    return _sha(path.read_bytes())


def _json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def _relative(value: Any, label: str) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise ValueError(f"{label} must be a nonempty POSIX relative path")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ValueError(f"{label} must stay inside the session")
    return path


def _safe_file(root: Path, rel: PurePosixPath, label: str) -> Path:
    root = root.resolve(strict=True)
    path = root
    for part in rel.parts:
        path = path / part
        if path.is_symlink():
            raise ValueError(f"{label} must not traverse symlinks: {rel.as_posix()}")
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise ValueError(f"{label} must be a regular file inside the session: {rel.as_posix()}")
    return resolved


def _tree(root: Path) -> dict:
    files = []
    for path in sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix()):
        if path.is_symlink():
            raise ValueError(f"Session contains an unsupported symlink: {path.relative_to(root)}")
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        digest = _file_sha(path)
        files.append({"path": rel, "bytes": path.stat().st_size, "sha256": digest})
    canonical = "".join(f"{item['path']}\0{item['bytes']}\0{item['sha256']}\n" for item in files).encode()
    return {"files": files, "file_count": len(files), "tree_sha256": _sha(canonical)}


def _verify_tree_manifest(root: Path, expected: dict) -> None:
    actual = _tree(root)
    if actual != expected:
        raise ValueError(f"Frozen session baseline changed: {root.name}")


def _skill_and_pattern_context(spec: dict, package_root: Path) -> tuple[dict, list[dict], list[dict]]:
    product = spec.get("product_context")
    if not isinstance(product, dict):
        raise ValueError("product_context is required")
    refs = product.get("source_references")
    if not isinstance(refs, list) or not refs:
        raise ValueError("At least one hash-bound source reference is required")
    source_revision = product.get("source_revision_sha256")
    if not isinstance(source_revision, str) or len(source_revision) != 64 or any(c not in "0123456789abcdef" for c in source_revision):
        raise ValueError("product_context.source_revision_sha256 must be a lowercase SHA-256")
    if not isinstance(spec.get("task"), str) or not spec["task"].strip():
        raise ValueError("task must describe the user workflow")
    intent = spec.get("intent_spec")
    if not isinstance(intent, dict) or not intent.get("intent_id") or not intent.get("workflow_steps") or not intent.get("component_needs"):
        raise ValueError("intent_spec requires intent_id, workflow_steps, and component_needs")
    intent = dict(intent)
    intent["scope_mode"] = "isolated_prototype"
    route = core.route_task(spec["task"], spec.get("project_profile"), spec.get("explicit_patterns"), intent)
    if route["intent_decision"] != "ROUTED_FROM_STRUCTURED_INTENT" or not route["all_relevant_pattern_ids"]:
        raise ValueError(f"Pattern routing blocked: {route['intent_decision']}")
    skill_ids = set(BASE_SKILLS)
    for pattern_id in route["all_relevant_pattern_ids"]:
        skill_ids.update(PATTERN_SKILLS[pattern_id])
    skill_ids.add("ui-evidence-gate")
    skills = []
    skills_root = package_root / "opencode_skills"
    for skill_id in sorted(skill_ids):
        path = skills_root / skill_id / "SKILL.md"
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(skills_root.resolve()):
            raise ValueError(f"Applicable skill is missing or unsafe: {skill_id}")
        skills.append({"id": skill_id, "sha256": _file_sha(path), "body": path.read_text(encoding="utf-8")})
    patterns = [core.get_pattern(pattern_id) for pattern_id in route["all_relevant_pattern_ids"]]
    return route, patterns, skills


def _context_markdown(spec: dict, route: dict, patterns: list[dict], skills: list[dict], refs: list[dict]) -> str:
    product = spec["product_context"]
    lines = [
        f"# Golden design-session context — {product.get('name', spec['context_id'])}", "",
        "> Locally assembled, byte-bound project context. This file alone is not evidence that a native client received it; G6 remains UNKNOWN.", "",
        "## User intent", product["purpose"], "", spec["task"], "",
        "## Observed product conventions", *[f"- {item}" for item in product.get("observed_identity", [])], "",
        "## Workflow and needs", *[f"- {item}" for item in spec["intent_spec"]["workflow_steps"]],
        *[f"- Component need: {item}" for item in spec["intent_spec"]["component_needs"]], "",
        "## Verified source references", *[f"- `{item['path']}` — sha256:{item['sha256']}" for item in refs], "",
        "## Routed patterns", *[f"- {item['id']} — {item['family']}: {'; '.join(route['pattern_reasons'][item['id']])}" for item in patterns], "",
        "## Profile boundary", f"- {route['profile_policy']['state']} / {route['profile_policy']['scope_mode']}",
        *[f"- Safe default: {item}" for item in route["profile_policy"]["safe_defaults"]],
        *[f"- Must block until authority/profile exists: {item}" for item in route["profile_policy"]["blocked_requirements"]],
    ]
    for pattern in patterns:
        lines += ["", f"## Pattern {pattern['id']} — {pattern['family']}",
                  "Select: " + json.dumps(pattern["select"], ensure_ascii=False),
                  "Avoid: " + json.dumps(pattern["avoid"], ensure_ascii=False),
                  "Required states: " + json.dumps(pattern["states"], ensure_ascii=False),
                  "Acceptance: " + json.dumps(pattern["accept"], ensure_ascii=False)]
    for skill in skills:
        lines += ["", f"## Skill body: {skill['id']} (sha256:{skill['sha256']})", skill["body"].rstrip()]
    return "\n".join(lines) + "\n"


def _agent_task(spec: dict, route: dict, refs: list[dict], skills: list[dict]) -> str:
    alternatives = spec.get("existing_alternatives", [])
    seed_text = "\n".join(f"- {item.get('id')}: {item.get('name')} — {item.get('composition')} Tradeoff: {item.get('tradeoffs')}" for item in alternatives if isinstance(item, dict))
    return f"""# Implement this Golden UI/UX design task

This is an actionable coding task, not a proposal-only exercise. Work only in `candidate/`; `baseline/` is immutable. Do not touch the original project or production. The source-bound contracts and skill bodies are in `agent-context.md`.

## Product and user task

Product: {spec['product_context'].get('name', spec['context_id'])}
Purpose: {spec['product_context']['purpose']}
Task: {spec['task']}

## Required sequence

1. Inspect the staged source files and surrounding conventions; verify the observed identity and user workflow from the bound references. Do not invent data, behavior, product identity, or permissions.
2. Inspect the actual task and source context, then classify the composition decision as ROUTINE or CONSEQUENTIAL and justify that choice from the user workflow and existing product conventions. For ROUTINE adjustments, submit one direction; do not manufacture alternatives. For a consequential or materially uncertain composition choice, submit two or three genuinely distinct feasible directions.
3. Compare every submitted direction against all six qualitative fields: {', '.join(SESSION_CRITERIA)}. Use source-bound evidence and state tradeoffs; do not manufacture a universal numeric beauty score.
4. Select one direction with product-specific rationale. Preserve observed identity; colors, type, spacing, density and components remain context-specific choices, not universal recipes.
5. Implement the selected direction as working UI in `candidate/`. Preserve `baseline/` and source references. A direction record alone is incomplete.
6. Run the cheapest relevant checks first. Reuse passing evidence only when its source and dependencies are unchanged; avoid rerunning unrelated suites and repeated environment setup. Use one accountable implementation agent by default; parallelize only genuinely independent critical-path work. Run functional, data/API, keyboard/accessibility, theme, responsive geometry and regression checks for changed behavior; do not omit mandatory gates for speed. Save commands, exit codes and outputs under `evidence/`.
7. Run `golden-uiux evaluate-gates` with `gate-request.json` and `expected-bindings.json`. Missing inputs remain NOT_RUN; UNKNOWN, FAIL or NOT_RUN never pass. G6 requires authenticated client-observed delivery and cannot be claimed from this packet.
8. If an authorized browser is available, inspect the rendered implementation under the same data, viewport, theme and state as baseline. Capture bound screenshots/DOM and refine concrete defects. If unavailable, mark rendered review NOT_RUN; source or fixture checks are not visual evidence.
9. Write `submission.json` using `workflow-state.json`, then run `golden-uiux design-session finish <session> --submission submission.json`. Review all unresolved evidence.

## Routed contract payload

Pattern IDs: {', '.join(route['all_relevant_pattern_ids'])}
Applicable skills: {', '.join(item['id'] for item in skills)}

## Existing alternatives from this context

{seed_text or '- No alternatives supplied; derive only evidence-based options.'}

## Completion requirements

The implementation must change at least one candidate file. The finish command verifies the byte-level candidate diff, hashes test artifacts, and executes the fixed gate pipeline. It does not approve the work, authenticate an agent, or declare aesthetics correct.
"""


def prepare_session(spec: Any, source_root: Path, output_dir: Path, *, package_root: Path | None = None) -> dict:
    if not isinstance(spec, dict) or spec.get("schema") != SESSION_SCHEMA:
        raise ValueError(f"request schema must be {SESSION_SCHEMA}")
    package_root = Path(package_root or core.ROOT).resolve()
    source_root = Path(source_root).resolve(strict=True)
    output_dir = Path(output_dir)
    if output_dir.exists() or output_dir.is_symlink():
        raise ValueError("session output must be a new directory")
    target = output_dir.resolve(strict=False)
    if target == source_root or target.is_relative_to(source_root):
        raise ValueError("session output must be outside the source project to preserve its contents")
    product = spec.get("product_context")
    if not isinstance(product, dict):
        raise ValueError("product_context is required")
    raw_refs = product.get("source_references")
    if not isinstance(raw_refs, list):
        raise ValueError("source_references must be a list")
    refs = _verify_source_refs(raw_refs, source_root)
    input_paths = spec.get("implementation_inputs")
    if not isinstance(input_paths, list) or not input_paths:
        raise ValueError("implementation_inputs must list at least one source file to copy into the isolated workspace")
    verified_paths = {item["path"] for item in refs}
    inputs = []
    for raw in input_paths:
        rel = _relative(raw, "implementation input").as_posix()
        if rel not in verified_paths:
            raise ValueError(f"Implementation input must also be a verified source reference: {rel}")
        source = source_root / rel
        if source.is_symlink() or not source.is_file():
            raise ValueError(f"Implementation input is missing or unsafe: {rel}")
        inputs.append(rel)
    if not isinstance(spec.get("context_id"), str) or not spec["context_id"].strip():
        raise ValueError("context_id is required")
    route, patterns, skills = _skill_and_pattern_context(spec, package_root)
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=False, exist_ok=False)
    baseline = output_dir / "baseline"
    candidate = output_dir / "candidate"
    evidence = output_dir / "evidence"
    for root in (baseline, candidate, evidence):
        root.mkdir()
    for rel in inputs:
        src = source_root / rel
        for dest_root in (baseline, candidate):
            dest = dest_root / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dest)
    baseline_manifest = _tree(baseline)
    candidate_manifest = _tree(candidate)
    if baseline_manifest != candidate_manifest:
        raise ValueError("Baseline and candidate starter copies must be byte-identical")
    profile_payload = spec.get("project_profile")
    profile_state = "UNAPPROVED_PROFILE_BOUND" if isinstance(profile_payload, dict) else "UNAPPROVED_SAFE_DEFAULTS_ONLY"
    profile_digest = _sha(json.dumps(profile_payload if isinstance(profile_payload, dict) else {
        "context_id": spec["context_id"], "policy": "SAFE_DEFAULTS_ONLY", "approved": False,
    }, sort_keys=True, separators=(",", ":")).encode())
    binding = {
        "source_revision": {"sha256": product["source_revision_sha256"], "verification": "DECLARED_CONTEXT_REVISION_REFERENCED_FILES_ONLY"},
        "catalog": {"sha256": core.catalog_digest()},
        "project_profile": {"status": "BOUND", "sha256": profile_digest, "approval": profile_state},
        "environment": {"mode": "isolated-design-session"},
        "checker": {"sha256": checker_digest(package_root)},
    }
    expected = {
        "source_revision.sha256": binding["source_revision"]["sha256"],
        "catalog.sha256": binding["catalog"]["sha256"],
        "project_profile.sha256": profile_digest,
        "environment.mode": binding["environment"]["mode"],
        "checker.sha256": binding["checker"]["sha256"],
    }
    context_md = _context_markdown(spec, route, patterns, skills, refs)
    task_md = _agent_task(spec, route, refs, skills)
    context = {
        "schema": "golden-uiux.design-session-context.v1", "context_id": spec["context_id"],
        "task": spec["task"], "source_revision_declared": product["source_revision_sha256"],
        "source_tree_digest_verified": False, "source_references": refs,
        "route": route, "pattern_ids": route["all_relevant_pattern_ids"],
        "pattern_contracts": patterns,
        "skills": [{"id": item["id"], "sha256": item["sha256"]} for item in skills],
        "g6_authenticated_delivery": "UNKNOWN", "profile_policy": route["profile_policy"],
    }
    state = {
        "schema": "golden-uiux.design-session-state.v1", "context_id": spec["context_id"],
        "status": "READY_FOR_AGENT_IMPLEMENTATION", "request": spec, "context": context,
        "source_root": str(source_root), "implementation_inputs": inputs,
        "baseline_manifest": baseline_manifest, "candidate_starter_manifest": candidate_manifest,
        "source_references": refs, "source_binding": binding, "expected_bindings": expected,
        "profile_state": profile_state, "hard_gates": {key: "NOT_RUN" for key in core.GATE_IDS},
        "g6_authenticated_delivery": "UNKNOWN", "rendered_review": "NOT_RUN",
    }
    (output_dir / "agent-context.md").write_text(context_md, encoding="utf-8")
    (output_dir / "agent-task.md").write_text(task_md, encoding="utf-8")
    _write_json(output_dir / "workflow-state.json", state)
    _write_json(output_dir / "expected-bindings.json", expected)
    _write_json(output_dir / "gate-request.template.json", {
        "schema": "golden-uiux.executable-gate-request.v1",
        "run_id": spec["context_id"] + "-design-session",
        "source_binding": binding,
        "gates": {},
    })
    _write_json(output_dir / "baseline-manifest.json", baseline_manifest)
    _write_json(output_dir / "candidate-starter-manifest.json", candidate_manifest)
    return {
        "status": "READY_FOR_AGENT_IMPLEMENTATION", "session_dir": str(output_dir.resolve()),
        "context_id": spec["context_id"], "patterns": context["pattern_ids"],
        "skills": context["skills"], "baseline_sha256": baseline_manifest["tree_sha256"],
        "candidate_starter_sha256": candidate_manifest["tree_sha256"],
        "authenticated_delivery": False, "g6_status": "UNKNOWN", "rendered_review": "NOT_RUN",
    }


def _validate_submission(submission: Any, state: dict, refs: list[dict]) -> None:
    if not isinstance(submission, dict) or submission.get("schema") != SUBMISSION_SCHEMA:
        raise ValueError(f"submission schema must be {SUBMISSION_SCHEMA}")
    forbidden = {"gate_status", "hard_gate_status", "gate_results", "gates"} & set(submission)
    if forbidden:
        raise ValueError("Gate outcomes must come from the CLI gate dispatcher, not submission claims")
    if submission.get("context_id") != state["context_id"]:
        raise ValueError("submission context_id differs from the frozen session")
    materiality = submission.get("composition_materiality")
    rationale = submission.get("materiality_rationale")
    if materiality not in {"ROUTINE", "CONSEQUENTIAL"} or not isinstance(rationale, str) or not rationale.strip():
        raise ValueError("composition_materiality must be ROUTINE or CONSEQUENTIAL with source/task rationale")
    alternatives = submission.get("alternatives")
    if not isinstance(alternatives, list) or not alternatives or len(alternatives) > 3:
        raise ValueError("Agent must submit one to three feasible directions")
    if materiality == "ROUTINE" and len(alternatives) != 1:
        raise ValueError("routine changes use one direction to avoid manufactured alternatives")
    if materiality == "CONSEQUENTIAL" and len(alternatives) < 2:
        raise ValueError("consequential composition choices require at least two alternatives")
    ids = []
    for item in alternatives:
        if not isinstance(item, dict):
            raise ValueError("Every alternative must be an object")
        for key in ("id", "name", "composition", "workflow", "tradeoffs"):
            if not isinstance(item.get(key), str) or not item[key].strip():
                raise ValueError(f"Alternative requires {key}")
        ids.append(item["id"])
    if len(set(ids)) != len(ids):
        raise ValueError("Alternative IDs must be unique")
    chosen = submission.get("selected_alternative_id")
    if chosen not in ids:
        raise ValueError("Selected direction must name one submitted alternative")
    if not isinstance(submission.get("selection_rationale"), str) or not submission["selection_rationale"].strip():
        raise ValueError("Selection rationale is required")
    comparisons = submission.get("comparisons")
    if not isinstance(comparisons, dict) or set(comparisons) != set(ids):
        raise ValueError("Every alternative must be compared using the same criteria")
    valid_refs = {item["path"] for item in refs}
    for alt_id, comparison in comparisons.items():
        if not isinstance(comparison, dict) or set(comparison) != set(SESSION_CRITERIA):
            raise ValueError(f"{alt_id} must compare every declared qualitative criterion")
        for criterion, result in comparison.items():
            if not isinstance(result, dict) or result.get("fit") not in FIT_STATES:
                raise ValueError(f"{alt_id}.{criterion} must use a qualitative fit state")
            if not isinstance(result.get("basis"), str) or not result["basis"].strip():
                raise ValueError(f"{alt_id}.{criterion} requires a rationale")
            evidence = result.get("evidence_refs")
            if not isinstance(evidence, list) or not evidence or any(ref not in valid_refs for ref in evidence):
                raise ValueError(f"{alt_id}.{criterion} requires source-bound evidence references")
    if not isinstance(submission.get("implementation_summary"), str) or not submission["implementation_summary"].strip():
        raise ValueError("Implementation summary is required")
    tests = submission.get("test_evidence")
    if not isinstance(tests, list):
        raise ValueError("test_evidence must be a list; use NOT_RUN when no checks were executed")
    for item in tests:
        if not isinstance(item, dict) or item.get("status") not in GATE_STATES:
            raise ValueError("Each test evidence record requires an explicit execution status")
        if item.get("status") == "PASS" and not all(item.get(key) for key in ("command", "artifact_path", "artifact_sha256")):
            raise ValueError("A reported test PASS requires its command and hash-addressed output artifact")
    rendered = submission.get("rendered_review")
    if not isinstance(rendered, dict) or rendered.get("status") not in GATE_STATES:
        raise ValueError("rendered_review must record PASS/FAIL/BLOCKED/UNKNOWN/NOT_RUN explicitly")
    if rendered.get("status") == "PASS" and not rendered.get("evidence"):
        raise ValueError("Rendered review PASS requires evidence references")


def finish_session(session_dir: Path, submission_path: Path, *, gate_request_path: Path | None = None,
                   package_root: Path | None = None) -> dict:
    raw_session = Path(session_dir)
    if raw_session.is_symlink():
        raise ValueError("session_dir must not be a symlink")
    session_dir = raw_session.resolve(strict=True)
    if not session_dir.is_dir():
        raise ValueError("session_dir must be a regular directory")
    package_root = Path(package_root or core.ROOT).resolve()
    state = _json(session_dir / "workflow-state.json")
    refs = state["source_references"]
    submission_path = Path(submission_path)
    if not submission_path.is_absolute():
        submission_path = session_dir / submission_path
    if submission_path.is_symlink():
        raise ValueError("submission must not be a symlink")
    submission_path = submission_path.resolve(strict=True)
    try:
        submission_rel = submission_path.relative_to(session_dir)
    except ValueError as exc:
        raise ValueError("submission must be a regular file inside the session") from exc
    submission_path = _safe_file(session_dir, PurePosixPath(submission_rel.as_posix()), "submission")
    submission = _json(submission_path)
    _validate_submission(submission, state, refs)
    baseline = session_dir / "baseline"
    candidate = session_dir / "candidate"
    _verify_tree_manifest(baseline, state["baseline_manifest"])
    before = _tree(baseline)
    after = _tree(candidate)
    before_files = {item["path"]: item["sha256"] for item in before["files"]}
    after_files = {item["path"]: item["sha256"] for item in after["files"]}
    changed = sorted(path for path in set(before_files) | set(after_files) if before_files.get(path) != after_files.get(path))
    if not changed:
        raise ValueError("Implementation candidate is byte-identical to baseline; a written direction is not an implementation")
    report_path = session_dir / "evidence" / "design-session-review.json"
    if report_path.exists() or report_path.is_symlink():
        raise ValueError("design session review already exists; preserve it and start a new session for another run")
    expected_path = session_dir / "expected-bindings.json"
    expected = _json(expected_path)
    if expected != state["expected_bindings"]:
        raise ValueError("Session gate bindings changed after preparation")
    if gate_request_path is None:
        request = _json(session_dir / "gate-request.template.json")
    else:
        rel = _relative(str(gate_request_path), "gate request path")
        request_path = _safe_file(session_dir, rel, "gate request")
        request = _json(request_path)
    gate_run = evaluate_request(
        request, evidence_root=session_dir / "evidence",
        command="golden-uiux design-session finish",
        expected_bindings=expected,
        expected_bindings_sha256=_file_sha(expected_path),
    )
    test_evidence = submission.get("test_evidence", [])
    checked_tests = []
    for item in test_evidence:
        record = dict(item)
        if record.get("artifact_path"):
            rel = _relative(record["artifact_path"], "test artifact path")
            path = _safe_file(session_dir / "evidence", rel, "test evidence")
            if _file_sha(path) != record.get("artifact_sha256"):
                raise ValueError(f"Test evidence hash mismatch or missing output: {rel.as_posix()}")
            record["artifact_verification"] = "BYTES_HASH_MATCHED_EXECUTION_NOT_AUTHENTICATED"
        checked_tests.append(record)
    rendered_evidence = _verify_artifact_refs(session_dir / "evidence", submission["rendered_review"].get("evidence", []))
    report = {
        "schema": "golden-uiux.design-session-review.v1",
        "context_id": state["context_id"],
        "status": "IMPLEMENTATION_CAPTURED_PENDING_EVIDENCE_REVIEW",
        "source_revision_declared": state["source_binding"]["source_revision"]["sha256"],
        "source_tree_digest_verified": False,
        "baseline_manifest": before,
        "candidate_manifest": after,
        "changed_files": [{"path": path, "baseline_sha256": before_files.get(path), "candidate_sha256": after_files.get(path)} for path in changed],
        "design_decision": {key: submission.get(key) for key in (
            "composition_materiality", "materiality_rationale", "alternatives",
            "selected_alternative_id", "selection_rationale", "comparisons")},
        "implementation_summary": submission["implementation_summary"],
        "test_evidence": checked_tests,
        "gate_run": gate_run,
        "gates": {item["gate_id"]: item["status"] for item in gate_run.get("gate_results", [])},
        "g6_authenticated_delivery": "UNKNOWN",
        "rendered_review": {**submission["rendered_review"], "verified_artifacts": rendered_evidence,
                             "reporting_boundary": "agent-submitted status; evidence bytes hash-checked, renderer/authorship not authenticated"},
        "visual_quality": "NOT_ASSESSED" if submission["rendered_review"]["status"] != "PASS" else "OWNER/EXPERT REVIEW REQUIRED",
        "promotion_permitted": False,
        "limitations": [
            "This CLI records an agent-submitted decision and hashes changed bytes; it does not prove who authored or received the submission.",
            "Gate execution is only as trustworthy as its local inputs; the gate pipeline itself does not authenticate a browser or client.",
            "G6 remains UNKNOWN unless an authenticated native-client delivery trace is verified.",
            "No rendered quality is claimed without valid rendered evidence and subsequent visual review.",
        ],
    }
    _write_json(report_path, report)
    return {"status": report["status"], "report_path": str(report_path), "changed_files": changed,
            "gate_statuses": report["gates"], "g6_status": "UNKNOWN",
            "rendered_review": report["rendered_review"]["status"], "promotion_permitted": False}


def _verify_artifact_refs(root: Path, artifacts: Any) -> list[dict]:
    if not isinstance(artifacts, list):
        raise ValueError("rendered_review.evidence must be an array of hash-addressed artifacts")
    verified = []
    for item in artifacts:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise ValueError("each rendered evidence reference requires path and sha256")
        rel = _relative(item["path"], "rendered evidence path")
        path = _safe_file(root, rel, "rendered evidence")
        if _file_sha(path) != item.get("sha256"):
            raise ValueError(f"rendered evidence is missing or its digest does not match: {rel.as_posix()}")
        verified.append({"path": rel.as_posix(), "sha256": item["sha256"],
                         "verification": "BYTES_HASH_MATCHED_RENDERER_NOT_AUTHENTICATED"})
    return verified
