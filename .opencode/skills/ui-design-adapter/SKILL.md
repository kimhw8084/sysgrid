---
name: ui-design-adapter
description: "Validate project design adapter identity and preserve brownfield tokens, density, components, and user preferences."
license: "Internal use subject to company approval"
---
# ui-design-adapter

## Scope
Validate project design adapter identity and preserve brownfield tokens, density, components, and user preferences. Use only when the current UI task materially requires this skill. This package is a candidate implementation, not a signed organizational grant or proven source-level UI result.

## Source of truth
Work within the **separate** existing Golden Engineering Standard, trusted company/repository controls, and the approved project adapter. UI pattern contracts live in `.golden-uiux/data/patterns.json`; normative rationale and seven P0/P1 corrections are in `.golden-uiux/source_spec`. If files are missing, do not reconstruct rules from memory. All applicable mandatory rules remain in scope even when not loaded into the model context.

## Procedure
1. Read the approved project adapter or, if absent, inventory current components for a proposed adapter without asserting approval.
2. Run `python3 .golden-uiux/uiux.py profile <path>` to check required fields, canonical digest and declared status. Remember that the tool cannot authenticate the human reviewer.
3. Map each semantic UI requirement to a real existing component and actual design tokens. Preserve user-selected settings; never replace a user’s requested font or row density globally.
4. A brownfield color-only change must preserve geometry. A new project needs explicitly approved design starter and owner-approved tokens.
5. Bind the adapter profile/digest and source baseline into the evidence plan; stop on missing or incompatible design authority.
6. Document which differences are functional, visual, or accessibility exceptions, with owner approval before the affected implementation.

## Escalation boundary
A PROPOSED profile or locally self-asserted APPROVED field is not verified organizational authority; request external accountable review.

## Required output
Return compact, auditable information: pattern IDs, source/profile/catalog versions, proposed approved component choices, state matrix, accessibility and geometry requirements, acceptance probes, exact proof and authorization statuses, and minimal next safe action.

## Never claim
No invented independent test PASS, legal certification, human review, actual Git publication, approved company policy, or guaranteed perfection. A read-only MCP cannot grant or exercise file/Git privileges. Use the separate authorized engineering workflow for changes.

## v0.2.6 experimental composition and effort rule

Derive the design direction from observed product purpose, workflow, conventions, data density, and component behavior. Product-specific visual choices stay local; do not apply universal palettes or layout recipes. Record composition materiality: a routine local adjustment uses one justified direction, while a consequential/uncertain layout choice compares two or three genuinely distinct feasible compositions against the qualitative criteria. Avoid manufactured alternatives and universal numeric beauty scores. Use one accountable implementation agent by default; add parallel work only when it is independent and shortens the critical path. Run the cheapest relevant checks first, reuse evidence only when dependencies match, and never omit a required gate to save time.
