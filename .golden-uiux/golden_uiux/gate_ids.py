"""Canonical experimental G1–G6 IDs shared by contracts and validators.

Promotion prerequisites such as authority, integration, independent review and
publication remain mandatory where applicable, but are named controls rather
than alternate G identifiers. This prevents reports from silently remapping a
failed check to a different gate.
"""

G1_DATA_TRUTH = "G1_DATA_TRUTH"
G2_API_CONTRACT = "G2_API_CONTRACT"
G3_ACCESSIBILITY = "G3_ACCESSIBILITY"
G4_RENDERED_CONTRAST = "G4_RENDERED_CONTRAST"
G5_ELEMENT_GEOMETRY = "G5_ELEMENT_GEOMETRY"
G6_EVIDENCE_AND_RULE_DELIVERY = "G6_EVIDENCE_AND_RULE_DELIVERY"

GATE_IDS = (
    G1_DATA_TRUTH,
    G2_API_CONTRACT,
    G3_ACCESSIBILITY,
    G4_RENDERED_CONTRAST,
    G5_ELEMENT_GEOMETRY,
    G6_EVIDENCE_AND_RULE_DELIVERY,
)

GATE_DESCRIPTIONS = {
    G1_DATA_TRUTH: "Rendered and persisted user-visible data is truthful to its selected source record.",
    G2_API_CONTRACT: "Frontend requests and backend route/method/schema contracts agree.",
    G3_ACCESSIBILITY: "Applicable semantics, names, keyboard operation, focus and recovery are verified.",
    G4_RENDERED_CONTRAST: "Rendered foreground/background pairs meet applicable contrast requirements.",
    G5_ELEMENT_GEOMETRY: "Element-level bounds, clipping, text completeness and hit targets are verified.",
    G6_EVIDENCE_AND_RULE_DELIVERY: "Source-bound evidence and rule-delivery claims are traceable; live authenticity may remain UNKNOWN.",
}

# These are promotion controls, not numbered gates and not substitutes for G1–G6.
PROMOTION_CONTROLS = (
    "authorization_preflight",
    "structural_review",
    "behavioral_review",
    "integration_review",
    "independent_review",
    "publication_review",
)
