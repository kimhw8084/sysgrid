---
name: ui-pattern-resolution
description: "Resolve approved UI interaction patterns using the 14 canonical contracts and project components."
license: "Internal use subject to company approval"
---
# ui-pattern-resolution

## Scope
Resolve approved UI interaction patterns using the 14 canonical contracts and project components. Use only when the current UI task materially requires this skill. This package is a candidate implementation, not a signed organizational grant or proven source-level UI result.

## Source of truth
Work within the **separate** existing Golden Engineering Standard, trusted company/repository controls, and the approved project adapter. UI pattern contracts live in `.golden-uiux/data/patterns.json`; normative rationale and seven P0/P1 corrections are in `.golden-uiux/source_spec`. If files are missing, do not reconstruct rules from memory. All applicable mandatory rules remain in scope even when not loaded into the model context.

## Procedure
1. Inspect existing UI patterns and project adapter before suggesting new interface structure.
2. Read relevant contract text with `python3 .golden-uiux/uiux.py pattern Pxx`; include use/avoid conditions, required states, proofs, and stop triggers.
3. Create 1–3 viable alternatives. Reject any that violate security, approved accessibility, semantic behavior, existing user work, or project conventions.
4. Prefer an approved existing component, then an approved variant. For a new application require a real approved starter; never copy SysGrid styles or invent a brand.
5. Describe selection and rejected alternatives, keyboard behavior, failure/recovery paths, source-linked acceptance cases, and unresolved questions.
6. Any change to scope or code still requires trusted engineering grant. A pattern resolution is advisory design input only.

## Escalation boundary
Stop affected choices if no approved component or starter can satisfy a mandatory behavioral requirement; do not fabricate approval.

## Required output
Return compact, auditable information: pattern IDs, source/profile/catalog versions, proposed approved component choices, state matrix, accessibility and geometry requirements, acceptance probes, exact proof and authorization statuses, and minimal next safe action.

## Never claim
No invented independent test PASS, legal certification, human review, actual Git publication, approved company policy, or guaranteed perfection. A read-only MCP cannot grant or exercise file/Git privileges. Use the separate authorized engineering workflow for changes.
