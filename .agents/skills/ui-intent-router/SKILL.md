---
name: ui-intent-router
description: "Classify UI feature requests into traceable pattern obligations while preserving mandatory cross-cutting requirements."
license: "Internal use subject to company approval"
---
# ui-intent-router

## Scope
Classify UI feature requests into traceable pattern obligations while preserving mandatory cross-cutting requirements. Use only when the current UI task materially requires this skill. This package is a candidate implementation, not a signed organizational grant or proven source-level UI result.

## Source of truth
Work within the **separate** existing Golden Engineering Standard, trusted company/repository controls, and the approved project adapter. UI pattern contracts live in `.golden-uiux/data/patterns.json`; normative rationale and seven P0/P1 corrections are in `.golden-uiux/source_spec`. If files are missing, do not reconstruct rules from memory. All applicable mandatory rules remain in scope even when not loaded into the model context.

## Procedure
1. Understand the user goal and affected journey. Identify who uses the UI, data types, authorization scope, supported viewports, user preferences, and risk class.
2. Build a structured `intent_spec` from verified workflow and component evidence: `intent_id`, `workflow_steps`, `component_needs`, and `constraints`. Run `python3 .golden-uiux/uiux.py route "<task>" --intent-spec <intent.json>` or use `uiux_route_task` with the same fields. Task keyword hits are diagnostics only and never choose patterns.
3. Independently inspect actual app structure to confirm the intent and component needs. For example, a Rack spatial inventory needs P02 when records/search/selection are present, P03 for the rack/asset inspector, and P10/P12 when responsive and keyboard requirements are declared. Load only the returned patterns; irrelevant explicit IDs are rejected. Add cross-cutting patterns only when a concrete component need or constraint requires them.
4. Write a compact decision table: user outcome, selected pattern IDs, other required patterns, existing approved components, unresolved authority, states, and proof cases. Document any override of automated routing.
5. Only proceed to implementation if the existing Golden Engineering Standard and project owner have granted actual task authority. Never infer privileges from catalog text.

## Escalation boundary
Stop on ambiguous destructive task, unclear tenancy or role, absent project policy for the affected decision, or conflicting high-priority constraints.

## Required output
Return compact, auditable information: pattern IDs, source/profile/catalog versions, proposed approved component choices, state matrix, accessibility and geometry requirements, acceptance probes, exact proof and authorization statuses, and minimal next safe action.

## Never claim
No invented independent test PASS, legal certification, human review, actual Git publication, approved company policy, or guaranteed perfection. A read-only MCP cannot grant or exercise file/Git privileges. Use the separate authorized engineering workflow for changes.
