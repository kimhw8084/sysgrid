"""Offline, fail-closed geometry evaluator for project-bound observations.

Coordinates are CSS pixels relative to the current viewport.  This module
evaluates captured browser measurements; it does not itself drive a browser,
infer text completeness, or authenticate the collector that supplied them.
"""

from __future__ import annotations

from math import isfinite
from typing import Any
import re
from .gate_ids import G5_ELEMENT_GEOMETRY, GATE_DESCRIPTIONS

SCHEMA = "golden.element-geometry-observation.v1"
GATE_ID = G5_ELEMENT_GEOMETRY
CHECKER_VERSION = "0.1.0-candidate"
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_CLIPPING = {"hidden", "clip", "scroll", "auto"}
_ALLOWED = {"PASS", "FAIL", "BLOCKED", "NOT_RUN", "UNKNOWN"}


def _rect(value: Any) -> tuple[float, float, float, float] | None:
    if not isinstance(value, dict):
        return None
    raw = tuple(value.get(k) for k in ("x", "y", "width", "height"))
    # bool is a Python int subclass but is never a valid CSS-pixel measurement.
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in raw):
        return None
    try:
        x, y, w, h = (float(v) for v in raw)
    except (OverflowError, TypeError, ValueError):
        return None
    if not all(isfinite(v) for v in (x, y, w, h)) or w < 0 or h < 0:
        return None
    return (x, y, x + w, y + h)


def _intersect(a: tuple[float, float, float, float],
               b: tuple[float, float, float, float],
               clip_x: bool, clip_y: bool) -> tuple[float, float, float, float]:
    return (
        max(a[0], b[0]) if clip_x else a[0],
        max(a[1], b[1]) if clip_y else a[1],
        min(a[2], b[2]) if clip_x else a[2],
        min(a[3], b[3]) if clip_y else a[3],
    )


def _within(inner: tuple[float, float, float, float],
            outer: tuple[float, float, float, float], tolerance: float) -> bool:
    return (inner[0] >= outer[0] - tolerance and inner[1] >= outer[1] - tolerance
            and inner[2] <= outer[2] + tolerance and inner[3] <= outer[3] + tolerance)


def _valid_binding(binding: Any) -> bool:
    if not isinstance(binding, dict):
        return False
    for key in ("source_tree_sha256", "profile_sha256", "environment_sha256"):
        if not isinstance(binding.get(key), str) or not _SHA256.fullmatch(binding[key]):
            return False
    return bool(binding.get("test_selector")) and bool(binding.get("checker_version"))


def _result(status: str, case_id: str, findings: list[dict[str, Any]],
            binding: Any, evidence: Any, applicability: str = "APPLICABLE") -> dict[str, Any]:
    assert status in _ALLOWED
    return {
        "schema": SCHEMA,
        "gate_id": GATE_ID,
        "gate_description": GATE_DESCRIPTIONS[GATE_ID],
        "status": status,
        "applicability": applicability,
        "rule_ids": ["geometry.viewport-intersection", "geometry.clipping-ancestors",
                     "geometry.content-completeness", "geometry.interactive-hit-test"],
        "case_id": case_id,
        "findings": findings,
        "evidence": evidence if isinstance(evidence, dict) else {},
        "source_binding": binding if isinstance(binding, dict) else {},
        "checker_version": CHECKER_VERSION,
        "limitations": [
            "A pure measurement evaluator cannot prove that the browser collector is authentic.",
            "Text truncation, occlusion and keyboard auto-scroll must be measured by the caller; absent measurements do not pass.",
            "CSS pixel geometry is browser-rendered evidence only when the source-bound collector and raw artifacts are independently verified.",
        ],
    }


def _known_failure(findings: list[dict[str, Any]]) -> bool:
    fail_codes = {
        "TARGET_OUTSIDE_VIEWPORT", "TARGET_CLIPPED_BY_ANCESTOR",
        "IMPORTANT_TEXT_TRUNCATED_WITHOUT_VERIFIED_DISCLOSURE",
        "INTERACTIVE_TARGET_NOT_HIT_TESTABLE", "HIT_TARGET_BELOW_PROFILE_MINIMUM",
        "PAGE_OVERFLOW_FORBIDDEN",
    }
    return any(f.get("code") in fail_codes for f in findings)


def evaluate_geometry_case(observation: Any, policy: Any) -> dict[str, Any]:
    """Evaluate one rendered target against the viewport and clipping chain.

    Required observation keys: executed=True, case_id, rect_space="viewport-css-px",
    transforms_applied=True, viewport, target_bounds, clip_ancestors, target_kind,
    text_completeness for text, hit_testable for interactive targets, source_binding,
    evidence_refs, evidence_hashes_verified=True.  A caller must only set the
    latter after verifying the referenced evidence bytes independently.
    """
    if not isinstance(observation, dict) or observation.get("executed") is not True:
        return _result("NOT_RUN", "unknown", [{"code": "OBSERVATION_NOT_EXECUTED"}], {}, {})
    case_id = str(observation.get("case_id", "unknown"))
    binding = observation.get("source_binding", {})
    evidence = {"refs": observation.get("evidence_refs", [])}
    findings: list[dict[str, Any]] = []
    if not isinstance(policy, dict):
        return _result("BLOCKED", case_id, [{"code": "POLICY_MISSING"}], binding, evidence)
    if not _valid_binding(binding):
        findings.append({"code": "SOURCE_BINDING_MISSING_OR_INVALID"})
        return _result("BLOCKED", case_id, findings, binding, evidence)
    if observation.get("evidence_hashes_verified") is not True:
        findings.append({"code": "EVIDENCE_BYTES_NOT_VERIFIED"})
        return _result("BLOCKED", case_id, findings, binding, evidence)
    refs = observation.get("evidence_refs")
    if (not isinstance(refs, list) or not refs or any(
        not isinstance(ref, dict) or not ref.get("path") or
        not isinstance(ref.get("sha256"), str) or not _SHA256.fullmatch(ref["sha256"])
        for ref in refs
    )):
        findings.append({"code": "EVIDENCE_REFERENCE_MISSING_OR_INVALID"})
        return _result("BLOCKED", case_id, findings, binding, evidence)
    if observation.get("rect_space") != "viewport-css-px":
        findings.append({"code": "UNSUPPORTED_COORDINATE_SPACE"})
        return _result("UNKNOWN", case_id, findings, binding, evidence)
    if observation.get("transforms_applied") is not True:
        findings.append({"code": "TRANSFORMED_BOUNDS_UNRESOLVED"})
        return _result("UNKNOWN", case_id, findings, binding, evidence)

    viewport = _rect(observation.get("viewport"))
    target = _rect(observation.get("target_bounds"))
    if viewport is None or target is None or viewport[2] <= viewport[0] or viewport[3] <= viewport[1]:
        findings.append({"code": "VIEWPORT_OR_TARGET_GEOMETRY_MISSING"})
        return _result("UNKNOWN", case_id, findings, binding, evidence)
    if target[2] <= target[0] or target[3] <= target[1]:
        findings.append({"code": "TARGET_HAS_ZERO_VISIBLE_AREA"})
        return _result("UNKNOWN", case_id, findings, binding, evidence)

    tolerance = policy.get("tolerance_css_px", 0)
    if isinstance(tolerance, bool) or not isinstance(tolerance, (int, float)) or not isfinite(tolerance) or tolerance < 0:
        findings.append({"code": "GEOMETRY_TOLERANCE_INVALID"})
        return _result("BLOCKED", case_id, findings, binding, evidence)
    if not _within(target, viewport, float(tolerance)):
        findings.append({"code": "TARGET_OUTSIDE_VIEWPORT", "target": list(target), "viewport": list(viewport)})

    ancestors = observation.get("clip_ancestors")
    if not isinstance(ancestors, list):
        findings.append({"code": "CLIPPING_ANCESTOR_CHAIN_MISSING"})
        return _result("UNKNOWN", case_id, findings, binding, evidence)
    effective = viewport
    chain = []
    for ancestor in ancestors:
        if not isinstance(ancestor, dict):
            findings.append({"code": "CLIPPING_ANCESTOR_INVALID"})
            return _result("UNKNOWN", case_id, findings, binding, evidence)
        overflow_x, overflow_y = ancestor.get("overflow_x"), ancestor.get("overflow_y")
        supported_overflow = {"visible", "hidden", "clip", "scroll", "auto"}
        if (not isinstance(overflow_x, str) or overflow_x not in supported_overflow or
                not isinstance(overflow_y, str) or overflow_y not in supported_overflow):
            findings.append({"code": "OVERFLOW_MODE_UNSUPPORTED", "ancestor": ancestor.get("id")})
            return _result("UNKNOWN", case_id, findings, binding, evidence)
        clip_x, clip_y = overflow_x in _CLIPPING, overflow_y in _CLIPPING
        if not clip_x and not clip_y:
            continue
        ancestor_rect = _rect(ancestor.get("rect"))
        if ancestor_rect is None:
            findings.append({"code": "CLIPPING_ANCESTOR_RECT_MISSING", "ancestor": ancestor.get("id")})
            return _result("UNKNOWN", case_id, findings, binding, evidence)
        effective = _intersect(effective, ancestor_rect, clip_x, clip_y)
        chain.append({"id": ancestor.get("id"), "rect": list(ancestor_rect),
                      "overflow_x": overflow_x, "overflow_y": overflow_y,
                      "clips_x": clip_x, "clips_y": clip_y})
    if effective[2] < effective[0] or effective[3] < effective[1]:
        effective = (effective[0], effective[1], effective[0], effective[1])
    evidence["effective_visible_bounds"] = list(effective)
    evidence["clipping_chain"] = chain
    if not _within(target, effective, float(tolerance)):
        findings.append({"code": "TARGET_CLIPPED_BY_ANCESTOR", "target": list(target),
                         "effective_visible_bounds": list(effective)})

    kind = observation.get("target_kind")
    if kind == "text":
        complete = observation.get("text_completeness")
        if complete is False:
            disclosure = observation.get("disclosure")
            if policy.get("text_visibility") != "disclosure_allowed" or not isinstance(disclosure, dict) or not all(
                disclosure.get(k) is True for k in ("exact_content_available", "keyboard_discoverable", "accessible_name_matches")
            ):
                findings.append({"code": "IMPORTANT_TEXT_TRUNCATED_WITHOUT_VERIFIED_DISCLOSURE"})
        elif complete is not True:
            findings.append({"code": "TEXT_COMPLETENESS_UNKNOWN"})
            return _result("FAIL" if _known_failure(findings) else "UNKNOWN", case_id, findings, binding, evidence)
    elif kind == "interactive":
        hit_testable = observation.get("hit_testable")
        if hit_testable is False:
            findings.append({"code": "INTERACTIVE_TARGET_NOT_HIT_TESTABLE"})
        elif hit_testable is not True:
            findings.append({"code": "HIT_TESTABILITY_UNKNOWN"})
            return _result("FAIL" if _known_failure(findings) else "UNKNOWN", case_id, findings, binding, evidence)
        min_area = policy.get("minimum_hit_target_css_px")
        if min_area is not None:
            if (not isinstance(min_area, dict) or any(
                isinstance(min_area.get(k), bool) or not isinstance(min_area.get(k), (int, float)) or
                not isfinite(min_area[k]) or min_area[k] <= 0 for k in ("width", "height")
            )):
                findings.append({"code": "HIT_TARGET_POLICY_INVALID"})
                return _result("BLOCKED", case_id, findings, binding, evidence)
            if target[2] - target[0] < min_area["width"] or target[3] - target[1] < min_area["height"]:
                findings.append({"code": "HIT_TARGET_BELOW_PROFILE_MINIMUM", "target_size": [target[2]-target[0], target[3]-target[1]], "minimum": [min_area["width"], min_area["height"]]})
    else:
        findings.append({"code": "TARGET_KIND_UNSUPPORTED"})
        return _result("UNKNOWN", case_id, findings, binding, evidence)

    # A captured page-overflow measurement is evaluated only when the project
    # profile explicitly forbids it; nested component scrolling is otherwise valid.
    if policy.get("page_overflow") == "forbid":
        overflow = observation.get("page_overflow_css_px")
        if isinstance(overflow, bool) or not isinstance(overflow, (int, float)) or not isfinite(overflow):
            findings.append({"code": "PAGE_OVERFLOW_MEASUREMENT_MISSING"})
            return _result("UNKNOWN", case_id, findings, binding, evidence)
        if overflow > float(tolerance):
            findings.append({"code": "PAGE_OVERFLOW_FORBIDDEN", "overflow_css_px": overflow})
    elif policy.get("page_overflow") is not None and (
        not isinstance(policy.get("page_overflow"), str) or
        policy.get("page_overflow") != "allow_configured"
    ):
        findings.append({"code": "PAGE_OVERFLOW_POLICY_INVALID"})
        return _result("BLOCKED", case_id, findings, binding, evidence)

    status = "FAIL" if findings else "PASS"
    if not findings:
        findings.append({"code": "TARGET_WITHIN_APPROVED_GEOMETRY", "case_id": case_id})
    return _result(status, case_id, findings, binding, evidence)
