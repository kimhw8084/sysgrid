---
name: ui-responsive-geometry
description: "Preserve approved geometry/density and validate responsive/zoom behavior with paired measurements."
license: "Internal use subject to company approval"
---
# ui-responsive-geometry

## Scope
Preserve approved geometry/density and validate responsive/zoom behavior with paired measurements. Use only when the current UI task materially requires this skill. This package is a candidate implementation, not a signed organizational grant or proven source-level UI result.

## Source of truth
Work within the **separate** existing Golden Engineering Standard, trusted company/repository controls, and the approved project adapter. UI pattern contracts live in `.golden-uiux/data/patterns.json`; normative rationale and seven P0/P1 corrections are in `.golden-uiux/source_spec`. If files are missing, do not reconstruct rules from memory. All applicable mandatory rules remain in scope even when not loaded into the model context.

## Procedure
1. Freeze baseline and candidate context: viewport width/height, browser/version, font/zoom, data, page state, locale, user preferences and route.
2. Specify measured component width/height, grid row height, toolbar height, panel widths, modal footprint, scroll, clipping and visible work capacity.
3. Use `python3 .golden-uiux/uiux.py geometry <before.json> <after.json>` to flag numeric expansion; tool does NOT replace browser inspection or independent approval.
4. Color-only tasks preserve unchanged dimensions. For necessary accessibility changes, record scope, minimum compliant accommodation and approved exception instead of silently enlarging.
5. Test narrow/intermediate/wide, supported zoom/reflow, long translations, touch and keyboard focus; preserve saved requested density and font preference.
6. Treat unmatched baseline context or unapproved tolerances as BLOCKED, not proof of no regression.

## Escalation boundary
A row height alone never proves a WCAG target-size violation. Apply actual criteria and allowed exceptions; never use compactness to defeat accessibility.

## Required output
Return compact, auditable information: pattern IDs, source/profile/catalog versions, proposed approved component choices, state matrix, accessibility and geometry requirements, acceptance probes, exact proof and authorization statuses, and minimal next safe action.

## Never claim
No invented independent test PASS, legal certification, human review, actual Git publication, approved company policy, or guaranteed perfection. A read-only MCP cannot grant or exercise file/Git privileges. Use the separate authorized engineering workflow for changes.
