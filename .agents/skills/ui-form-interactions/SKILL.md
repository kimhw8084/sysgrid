---
name: ui-form-interactions
description: "Design accessible editing, forms, dialogs, actions, persistence, conflict and recovery."
license: "Internal use subject to company approval"
---
# ui-form-interactions

## Scope
Design accessible editing, forms, dialogs, actions, persistence, conflict and recovery. Use only when the current UI task materially requires this skill. This package is a candidate implementation, not a signed organizational grant or proven source-level UI result.

## Source of truth
Work within the **separate** existing Golden Engineering Standard, trusted company/repository controls, and the approved project adapter. UI pattern contracts live in `.golden-uiux/data/patterns.json`; normative rationale and seven P0/P1 corrections are in `.golden-uiux/source_spec`. If files are missing, do not reconstruct rules from memory. All applicable mandatory rules remain in scope even when not loaded into the model context.

## Procedure
1. Inspect actual form/data owner and app components. Apply P04, P05, P06, P09 and P13 whenever relevant.
2. Explicitly cover pristine, dirty, pending, invalid, denied, server error, conflict, cancelled, successfully persisted, and reopened states when applicable.
3. Use native labels and appropriate error association; define focus before/after dialogs, keyboard activation, and restore focus.
4. Distinguish optimistic UI from committed server persistence. Preserve drafts during failure; avoid duplicate non-idempotent submits and silent conflict overwrite.
5. Assess action scope and destructive risk. Unapproved irreversible workflows and consent require owner decision; merely adding confirmation does not grant permission.
6. Create source-bound test cases including keyboard-only success, invalid data, async conflict, permission denial, timeout, duplicate click and dirty-close.

## Escalation boundary
Never mark an operation saved solely because a model predicted it; never discard user edits to make UI tests pass.

## Required output
Return compact, auditable information: pattern IDs, source/profile/catalog versions, proposed approved component choices, state matrix, accessibility and geometry requirements, acceptance probes, exact proof and authorization statuses, and minimal next safe action.

## Never claim
No invented independent test PASS, legal certification, human review, actual Git publication, approved company policy, or guaranteed perfection. A read-only MCP cannot grant or exercise file/Git privileges. Use the separate authorized engineering workflow for changes.
