"""Execute the six registered gate validators from exact, hash-bound inputs.

This offline dispatcher invokes validators; it is not a trusted runner,
application browser, source-lock verifier, approval authority, or release gate.
The existing aggregator remains the final local evidence-integrity check and
continues to block qualification without independently authenticated execution.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
import re
from typing import Any, Mapping

from . import accessibility_gates as a11y
from . import data_api_gates as data
from . import backend_contracts as backend_api
from . import geometry_gates as geometry
from . import skill_delivery_gates as skills
from .core import catalog_digest
from .gate_envelope import adapt_gate_result
from .hard_gates import SIX_GATE_IDS, evaluate_six_gate_records
from .gate_ids import (
    GATE_DESCRIPTIONS, G1_DATA_TRUTH, G2_API_CONTRACT, G3_ACCESSIBILITY, G4_RENDERED_CONTRAST,
    G5_ELEMENT_GEOMETRY, G6_EVIDENCE_AND_RULE_DELIVERY,
)

SCHEMA = "golden-uiux.executable-gate-request.v1"
RESULT_SCHEMA = "golden-uiux.executable-gate-run.v1"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
MODULE_FILES = (
    "uiux.py", "golden_uiux/cli.py", "golden_uiux/core.py",
    "golden_uiux/design_workflow.py", "golden_uiux/design_execution.py", "golden_uiux/mcp.py",
    "data/proof_schema.json", "data/adapter_schema.json",
    "golden_uiux/gate_pipeline.py",
    "golden_uiux/hard_gates.py", "golden_uiux/candidate_gates.py",
    "golden_uiux/gate_ids.py",
    "golden_uiux/gate_envelope.py", "golden_uiux/data_api_gates.py",
    "golden_uiux/backend_contracts.py", "golden_uiux/navigation_gates.py",
    "golden_uiux/patch_integrity.py", "golden_uiux/accessibility_gates.py",
    "golden_uiux/geometry_gates.py", "golden_uiux/skill_delivery_gates.py",
)
_RULES = {
    G1_DATA_TRUTH: [G1_DATA_TRUTH, "data.required-field-provenance"],
    G2_API_CONTRACT: [G2_API_CONTRACT, "api.exact-client-server-contract", "api.backend-openapi-semantics"],
    G3_ACCESSIBILITY: [G3_ACCESSIBILITY, "a11y.native-keyboard-and-name"],
    G4_RENDERED_CONTRAST: [G4_RENDERED_CONTRAST, "a11y.rendered-contrast"],
    G5_ELEMENT_GEOMETRY: [G5_ELEMENT_GEOMETRY, "geometry.clipping-ancestors"],
    G6_EVIDENCE_AND_RULE_DELIVERY: [G6_EVIDENCE_AND_RULE_DELIVERY, "evidence.skill-delivery-trace"],
}
_G3_FUNCS = {
    "focus": a11y.evaluate_focus,
    "accessible_name": a11y.evaluate_accessible_name,
    "dialog_focus": a11y.evaluate_dialog_focus,
    "skip_link": a11y.evaluate_skip_link,
}


def checker_digest(package_root: str | Path | None = None) -> str:
    """Hash the exact entrypoint, dispatcher, registry, envelope and validators."""
    root = Path(package_root) if package_root else Path(__file__).resolve().parent.parent
    entries = []
    for relative in MODULE_FILES:
        path = root / relative
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"checker component missing or unsafe: {relative}")
        entries.append({"path": relative, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    raw = json.dumps(entries, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _digest(value: Any) -> bool:
    return isinstance(value, str) and SHA256.fullmatch(value) is not None


def _resolve_artifact(root: Path, artifact: Any, *, parse_json: bool = False) -> tuple[dict | None, Any, str | None]:
    if not isinstance(artifact, Mapping):
        return None, None, "artifact reference is not an object"
    rel, expected = artifact.get("path"), artifact.get("sha256")
    if not isinstance(rel, str) or not rel or "\\" in rel or "\x00" in rel or not _digest(expected):
        return None, None, "artifact requires a relative path and lowercase SHA-256"
    posix = PurePosixPath(rel)
    if posix.is_absolute() or ".." in posix.parts or not posix.parts:
        return None, None, "artifact path must remain inside evidence_root"
    target = (root / Path(*posix.parts)).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError:
        return None, None, "artifact symlink escapes evidence_root"
    if not target.is_file() or target.stat().st_size > 3_000_000:
        return None, None, "artifact is missing, not a regular file, or exceeds 3 MB"
    data_bytes = target.read_bytes()
    actual = hashlib.sha256(data_bytes).hexdigest()
    if actual != expected:
        return None, None, "artifact digest mismatch"
    parsed = None
    if parse_json:
        try:
            parsed = json.loads(data_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None, None, "input artifact is not valid UTF-8 JSON"
    return {"path": posix.as_posix(), "sha256": actual}, parsed, None


def _source_bindings(request: Any, expected_bindings: Any,
                     expected_checker: str) -> tuple[dict | None, dict | None, str | None]:
    if not isinstance(request, Mapping):
        return None, None, "request must be a JSON object"
    binding = request.get("source_binding")
    if "expected_bindings" in request:
        return None, None, "expected_bindings must be supplied separately by the CLI operator"
    if not isinstance(binding, Mapping) or not isinstance(expected_bindings, Mapping):
        return None, None, "source_binding and separately supplied expected_bindings are required objects"
    source_rev = binding.get("source_revision")
    catalog = binding.get("catalog")
    profile = binding.get("project_profile")
    environment = binding.get("environment")
    checker = binding.get("checker")
    if not isinstance(source_rev, Mapping) or not _digest(source_rev.get("sha256")):
        return None, None, "source revision binding is incomplete"
    if not isinstance(catalog, Mapping) or not _digest(catalog.get("sha256")):
        return None, None, "catalog binding is incomplete"
    if catalog.get("sha256") != catalog_digest():
        return None, None, "catalog digest does not match the executed package catalog"
    if not isinstance(profile, Mapping) or profile.get("status") != "BOUND" or not _digest(profile.get("sha256")):
        return None, None, "a bound project profile digest is required"
    if not isinstance(environment, Mapping) or not isinstance(environment.get("mode"), str) or not environment["mode"].strip():
        return None, None, "environment mode binding is incomplete"
    if not isinstance(checker, Mapping) or checker.get("sha256") != expected_checker:
        return None, None, "checker digest does not match the executed gate pipeline"
    flattened = {
        "source_revision.sha256": source_rev["sha256"],
        "catalog.sha256": catalog["sha256"],
        "project_profile.sha256": profile["sha256"],
        "environment.mode": environment["mode"],
        "checker.sha256": checker["sha256"],
    }
    if dict(expected_bindings) != flattened:
        return None, None, "source_binding differs from separately supplied expected_bindings"
    return dict(binding), flattened, None


def _module_binding(binding: Mapping, gate_id: str, artifacts: list[Mapping],
                    run_id: str, command: str, started: str, completed: str) -> dict:
    profile_digest = binding["project_profile"]["sha256"]
    first_artifact = artifacts[0]["sha256"] if artifacts else hashlib.sha256(b"no-evidence").hexdigest()
    return {
        "source_revision": binding["source_revision"]["sha256"],
        "source_tree_digest": binding["source_revision"]["sha256"],
        "catalog_digest": binding["catalog"]["sha256"],
        "profile_digest": profile_digest,
        "environment": {"kind": binding["environment"]["mode"]},
        "checker_version": binding["checker"]["sha256"],
        "artifact_digest": first_artifact,
        "runner": "golden-uiux.evaluate-gates",
        "case_id": f"{run_id}:{gate_id}",
        "started_at_utc": started,
        "completed_at_utc": completed,
    }


def _raw_result(gate_id: str, status: str, findings: list[Any], evidence: Any = None) -> dict:
    return {"schema": "golden-uiux.gate-result.v1", "gate_id": gate_id,
            "gate_description": GATE_DESCRIPTIONS[gate_id],
            "status": status, "applicability": {"status": "APPLICABLE"},
            "rule_ids": _RULES[gate_id], "findings": findings,
            "evidence": evidence if isinstance(evidence, Mapping) else {}}


def _missing_result(gate_id: str, reason: str) -> dict:
    return _raw_result(gate_id, "NOT_RUN", [{"status": "NOT_RUN", "summary": reason}])


def _bind_digest(value: Any, artifact_digests: set[str]) -> bool:
    return _digest(value) and value in artifact_digests


def _check_gate_evidence(artifacts: Any, root: Path) -> tuple[list[dict], str | None]:
    if not isinstance(artifacts, list) or not artifacts:
        return [], "each gate requires hash-addressed input/evidence artifacts"
    resolved: list[dict] = []
    for raw in artifacts:
        normalized, _, error = _resolve_artifact(root, raw)
        if error:
            return [], error
        resolved.append(normalized)
    return resolved, None


def _evaluate_one(gate_id: str, data_input: Any, artifacts: list[Mapping],
                  module_binding: dict, global_source_binding: dict,
                  g6_expected: Any = None) -> tuple[dict, list[str]]:
    invocations: list[str] = []
    if gate_id == G1_DATA_TRUTH:
        invocations.append("golden_uiux.data_api_gates.evaluate_data_truth")
        if not isinstance(data_input, Mapping):
            result = {"status": "NOT_RUN", "reasons": ["data-truth input is absent or malformed"]}
        else:
            result = data.evaluate_data_truth(
                data_input.get("contract"), data_input.get("api_records"),
                data_input.get("rendered_record"), data_input.get("identity"),
                data_input.get("selected_id"),
            )
        wrapped = data.to_envelope(result, gate_id, {"status": "APPLICABLE"}, _RULES[gate_id], list(artifacts), global_source_binding)
        return wrapped, invocations

    if gate_id == G2_API_CONTRACT:
        invocations.extend(["golden_uiux.backend_contracts.evaluate_backend_openapi_contract",
                            "golden_uiux.data_api_gates.evaluate_api_contract"])
        if not isinstance(data_input, Mapping):
            result = {"status": "NOT_RUN", "reasons": ["API-contract input is absent or malformed"]}
        elif "openapi_document" not in data_input:
            result = {"status": "BLOCKED", "reasons": ["G2 requires backend-generated OpenAPI; a hand-authored server_route is insufficient"]}
        else:
            backend_result = backend_api.evaluate_backend_openapi_contract(
                data_input.get("contract"), data_input.get("client_route"),
                data_input.get("openapi_document"))
            if backend_result.get("status") != "PASS":
                result = {"status": backend_result.get("status", "BLOCKED"),
                          "reasons": backend_result.get("reasons", []),
                          "backend_route_contract": backend_result}
            else:
                request_result = data.evaluate_api_contract(
                    data_input.get("contract"), data_input.get("client_route"),
                    backend_result.get("server_route"), data_input.get("observed"),
                    data_input.get("expected_identity"),
                )
                combined = data.combine(backend_result, request_result)
                result = {"status": combined["status"], "reasons": combined["reasons"],
                          "backend_route_contract": backend_result,
                          "request_observation": request_result}
        wrapped = data.to_envelope(result, gate_id, {"status": "APPLICABLE"}, _RULES[gate_id], list(artifacts), global_source_binding)
        return wrapped, invocations

    if gate_id == G3_ACCESSIBILITY:
        if not isinstance(data_input, Mapping):
            data_input = {}
        results = []
        for key, evaluator in _G3_FUNCS.items():
            invocations.append(f"golden_uiux.accessibility_gates.evaluate_{key}")
            record = data_input.get(key)
            if isinstance(record, Mapping):
                record = dict(record)
                record["source_binding"] = module_binding
                if key == "focus" and isinstance(record.get("samples"), list):
                    invocations.append("golden_uiux.geometry_gates.evaluate_geometry_case (focus-indicator clipping)")
                if key == "skip_link":
                    invocations.append("golden_uiux.navigation_gates.evaluate_navigation_continuity")
                if key == "focus":
                    samples = record.get("samples")
                    if isinstance(samples, list):
                        for sample in samples:
                            if isinstance(sample, dict) and not _bind_digest(sample.get("capture_digest"), {a["sha256"] for a in artifacts}):
                                sample["capture_digest"] = None
                if key == "accessible_name" and not _bind_digest(record.get("tree_capture_digest"), {a["sha256"] for a in artifacts}):
                    record["tree_capture_digest"] = None
                if key == "dialog_focus":
                    digest_set = {a["sha256"] for a in artifacts}
                    for field in ("keyboard_trace_digest", "tree_capture_digest"):
                        if not _bind_digest(record.get(field), digest_set):
                            record[field] = None
                if key == "skip_link":
                    artifact_digests = {a["sha256"] for a in artifacts}
                    if not _bind_digest(record.get("keyboard_trace_digest"), artifact_digests):
                        record["keyboard_trace_digest"] = None
                    continuity = record.get("state_continuity")
                    if isinstance(continuity, dict) and not _bind_digest(continuity.get("state_capture_digest"), artifact_digests):
                        continuity["state_capture_digest"] = None
            results.append(evaluator(record))
        combined = data.combine(*results)
        details = {key: result for key, result in zip(_G3_FUNCS, results)}
        findings = [f for result in results for f in result.get("findings", [])]
        raw = _raw_result(gate_id, combined["status"], findings, {"subchecks": details})
        return raw, invocations

    if gate_id == G4_RENDERED_CONTRAST:
        invocations.append("golden_uiux.accessibility_gates.evaluate_contrast")
        record = dict(data_input) if isinstance(data_input, Mapping) else None
        if record is not None:
            record["source_binding"] = module_binding
            cross = record.get("rendered_crosscheck")
            if isinstance(cross, dict) and not _bind_digest(cross.get("artifact_digest"), {a["sha256"] for a in artifacts}):
                cross["artifact_digest"] = None
        result = a11y.evaluate_contrast(record)
        raw = _raw_result(gate_id, result["status"], result.get("findings", []), result.get("evidence", {}))
        return raw, invocations

    if gate_id == G5_ELEMENT_GEOMETRY:
        invocations.append("golden_uiux.geometry_gates.evaluate_geometry_case")
        if isinstance(data_input, Mapping):
            observation = data_input.get("observation")
            policy = data_input.get("policy")
            if isinstance(observation, Mapping):
                observation = dict(observation)
                observation["source_binding"] = {
                    "source_tree_sha256": global_source_binding["source_revision"]["sha256"],
                    "profile_sha256": global_source_binding["project_profile"]["sha256"],
                    "environment_sha256": hashlib.sha256(global_source_binding["environment"]["mode"].encode()).hexdigest(),
                    "test_selector": data_input.get("test_selector", "cli.evaluate-gates.geometry"),
                    "checker_version": module_binding["checker_version"],
                }
                observation["evidence_refs"] = list(artifacts)
                observation["evidence_hashes_verified"] = bool(artifacts)
            else:
                observation = None
        else:
            observation, policy = None, None
        result = geometry.evaluate_geometry_case(observation, policy)
        return result, invocations

    if gate_id == G6_EVIDENCE_AND_RULE_DELIVERY:
        invocations.append("golden_uiux.skill_delivery_gates.evaluate_delivery_trace")
        trace = data_input.get("trace") if isinstance(data_input, Mapping) else None
        expected = g6_expected if isinstance(g6_expected, Mapping) else None
        if expected is not None:
            expected = dict(expected)
            expected["catalog_sha256"] = global_source_binding["catalog"]["sha256"]
            expected["source_tree_sha256"] = global_source_binding["source_revision"]["sha256"]
            expected["profile_sha256"] = global_source_binding["project_profile"]["sha256"]
        result = skills.evaluate_delivery_trace(trace, expected=expected or {})
        raw = _raw_result(gate_id, result["status"], result.get("findings", []), result.get("evidence", {}))
        raw["delivery_authenticity"] = result.get("delivery_authenticity", "UNKNOWN")
        raw["trace_consistency"] = result.get("trace_consistency", "UNKNOWN")
        raw["promotion_permitted"] = False
        return raw, invocations

    return _missing_result(gate_id, "unregistered gate ID"), invocations


def evaluate_request(request: Any, *, evidence_root: str | Path, command: str,
                     expected_bindings: Any, expected_bindings_sha256: str) -> dict:
    """Dispatch all six fixed validators, then aggregate source-bound outputs."""
    root = Path(evidence_root).resolve()
    started = _now()
    if not root.is_dir():
        raise ValueError("evidence_root must be an existing directory")
    if not isinstance(request, Mapping) or request.get("schema") != SCHEMA:
        raise ValueError(f"request schema must be {SCHEMA}")
    if set(request) != {"schema", "run_id", "source_binding", "gates"}:
        raise ValueError("request must contain only schema, run_id, source_binding, and gates; status claims are not inputs")
    run_id = request.get("run_id")
    if not isinstance(run_id, str) or not run_id.strip():
        raise ValueError("run_id is required")
    runner = checker_digest()
    expected_keys = {
        "source_revision.sha256", "catalog.sha256", "project_profile.sha256",
        "environment.mode", "checker.sha256",
    }
    if not isinstance(expected_bindings, Mapping) or set(expected_bindings) != expected_keys:
        raise ValueError("separate expected-bindings file must contain exactly the five binding fields")
    for key in expected_keys - {"environment.mode"}:
        if not _digest(expected_bindings.get(key)):
            raise ValueError(f"separate expected binding is not a lowercase SHA-256: {key}")
    if not isinstance(expected_bindings.get("environment.mode"), str) or not expected_bindings["environment.mode"].strip():
        raise ValueError("separate expected environment.mode must be a non-empty string")
    if not _digest(expected_bindings_sha256):
        raise ValueError("expected-bindings artifact SHA-256 is required")
    binding, expected, binding_error = _source_bindings(request, expected_bindings, runner)
    if binding_error:
        # Fail closed without calling any module using untrusted/stale bindings.
        aggregation = evaluate_six_gate_records([], expected_bindings=expected or {}, evidence_root=root)
        return {"schema": RESULT_SCHEMA, "status": "BLOCKED", "evidence_record_status": "BLOCKED",
                "promotion_permitted": False, "runner_signature_verified": False,
                "binding_error": binding_error, "aggregation": aggregation,
                "gate_results": [], "invocations": [], "started_at": started, "completed_at": _now(),
                "runner_sha256": runner, "expected_bindings_sha256": expected_bindings_sha256,
                "binding_verification": "MISMATCH", "expected_bindings_provenance": "operator-supplied; not authenticated"}
    gates = request.get("gates")
    if not isinstance(gates, Mapping) or set(gates) - set(SIX_GATE_IDS):
        raise ValueError("gates must be an object containing only the six registered gate IDs")

    records: list[dict] = []
    invocation_log: list[dict] = []
    for gate_id in SIX_GATE_IDS:
        gate_started = _now()
        entry = gates.get(gate_id)
        if entry is None:
            raw = _missing_result(gate_id, "required gate input was not supplied")
            artifacts: list[dict] = []
            invoked: list[str] = []
        elif not isinstance(entry, Mapping) or set(entry) != {"input_artifact", "evidence"}:
            raw = _raw_result(gate_id, "BLOCKED", [{"summary": "gate entry must contain only input_artifact and evidence"}])
            artifacts = []
            invoked = []
        else:
            artifacts, evidence_error = _check_gate_evidence(entry.get("evidence"), root)
            input_artifact, data_input, input_error = _resolve_artifact(root, entry.get("input_artifact"), parse_json=True)
            if not input_error and (input_artifact is None or input_artifact not in artifacts):
                input_error = "input_artifact must also appear unchanged in the gate evidence list"
            error = evidence_error or input_error
            if error:
                raw = _raw_result(gate_id, "BLOCKED", [{"summary": error}])
                artifacts = artifacts if not evidence_error else []
                invoked = []
            else:
                data_input = data_input if isinstance(data_input, Mapping) else None
                module_start = _now()
                mb = _module_binding(binding, gate_id, artifacts, run_id, command, module_start, module_start)
                invoked_g6_expected = data_input.get("expected") if gate_id == G6_EVIDENCE_AND_RULE_DELIVERY and data_input else None
                try:
                    raw, invoked = _evaluate_one(gate_id, data_input, artifacts, mb, binding, invoked_g6_expected)
                except Exception as exc:
                    raw, invoked = _raw_result(gate_id, "BLOCKED", [{"summary": f"validator exception ({type(exc).__name__})"}]), ["validator-exception"]
        completed = _now()
        execution = {
            "check_id": f"{run_id}:{gate_id}", "command": command,
            "runner_sha256": runner, "started_at": gate_started, "completed_at": completed,
        }
        wrapped = adapt_gate_result(raw, source_binding=binding, evidence_artifacts=artifacts, execution=execution)
        records.append(wrapped)
        invocation_log.append({"gate_id": gate_id, "invoked": invoked,
                               "status": wrapped["status"], "started_at": gate_started,
                               "completed_at": completed})

    aggregation = evaluate_six_gate_records(records, expected_bindings=expected, evidence_root=root)
    return {
        "schema": RESULT_SCHEMA,
        "status": aggregation["status"],
        "evidence_record_status": aggregation["evidence_record_status"],
        "promotion_permitted": False,
        "runner_signature_verified": False,
        "required_gate_ids": list(SIX_GATE_IDS),
        "gate_results": records,
        "invocations": invocation_log,
        "aggregation": aggregation,
        "source_binding": binding,
        "started_at": started,
        "completed_at": _now(),
        "runner_sha256": runner,
        "expected_bindings_sha256": expected_bindings_sha256,
        "binding_verification": "MATCH",
        "expected_bindings_provenance": "operator-supplied; not authenticated",
        "limitations": [
            "This command invokes validators but does not authenticate an external runner, browser, application, source checkout, synthetic identity, or live skill delivery.",
            "The local aggregator verifies referenced evidence bytes and bindings, but promotion remains BLOCKED until a trusted execution verifier authenticates runtime provenance.",
        ],
    }
