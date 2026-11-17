"""Experimental six-gate registry and fail-closed integration entry point."""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from pathlib import Path

from .candidate_gates import aggregate_gate_results
from .gate_ids import (
    GATE_IDS, G1_DATA_TRUTH, G2_API_CONTRACT, G3_ACCESSIBILITY,
    G4_RENDERED_CONTRAST, G5_ELEMENT_GEOMETRY, G6_EVIDENCE_AND_RULE_DELIVERY,
)

SIX_GATE_IDS = GATE_IDS

# Registry describes portable coverage families; the project profile supplies
# the concrete applicable cases and expected data/routes. It is not a design theme.
GATE_REGISTRY = {
    G1_DATA_TRUTH: ("data_api_gates.evaluate_data_truth",),
    G2_API_CONTRACT: ("backend_contracts.evaluate_backend_openapi_contract", "data_api_gates.evaluate_api_contract"),
    G3_ACCESSIBILITY: (
        "accessibility_gates.evaluate_focus",
        "accessibility_gates.evaluate_accessible_name",
        "accessibility_gates.evaluate_dialog_focus",
        "accessibility_gates.evaluate_skip_link",
        "navigation_gates.evaluate_navigation_continuity",
        "geometry_gates.evaluate_geometry_case (focus-indicator clipping)",
    ),
    G4_RENDERED_CONTRAST: ("accessibility_gates.evaluate_contrast",),
    G5_ELEMENT_GEOMETRY: ("geometry_gates.evaluate_geometry_case",),
    G6_EVIDENCE_AND_RULE_DELIVERY: (
        "skill_delivery_gates.evaluate_delivery_trace",
        "candidate_gates.aggregate_gate_results",
        "independent adversarial evaluator receipt",
    ),
}


def evaluate_six_gate_records(
    records: Iterable[Mapping],
    *,
    expected_bindings: Mapping[str, str],
    evidence_root: str | Path,
) -> dict:
    """Evaluate exactly six profile-bound group records, never a caller-chosen subset."""
    return aggregate_gate_results(
        records,
        required_gate_ids=SIX_GATE_IDS,
        expected_bindings=expected_bindings,
        evidence_root=evidence_root,
    )
