---
name: ui-content-localization
description: "Specify accurate user-facing copy, multilingual formatting and feedback without claiming unverified success."
license: "Internal use subject to company approval"
---
# ui-content-localization

## Scope
Specify accurate user-facing copy, multilingual formatting and feedback without claiming unverified success. Use only when the current UI task materially requires this skill. This package is a candidate implementation, not a signed organizational grant or proven source-level UI result.

## Source of truth
Work within the **separate** existing Golden Engineering Standard, trusted company/repository controls, and the approved project adapter. UI pattern contracts live in `.golden-uiux/data/patterns.json`; normative rationale and seven P0/P1 corrections are in `.golden-uiux/source_spec`. If files are missing, do not reconstruct rules from memory. All applicable mandatory rules remain in scope even when not loaded into the model context.

## Procedure
1. Inspect product terms, supported locales, regulatory restrictions and copy owner.
2. Choose user-action verbs that match actual consequences; specifically distinguish Delete, Archive, Cancel, Save and Undo.
3. Specify errors, status and permission feedback with clear next action, accurate server state and accessible announcement when warranted.
4. Use approved ICU/i18n message tools for plural, gender, date, units and numbers where applicable; avoid manually embedding unescaped dynamic text.
5. Test long strings, 200% text, RTL if supported, locale numbering and overflow in approved geometry.
6. Legal/regulated or consequential copy cannot be invented by a language model without actual product approval.

## Escalation boundary
Never announce Success before an authoritative operation acknowledgment; never overwrite approved product terminology.

## Required output
Return compact, auditable information: pattern IDs, source/profile/catalog versions, proposed approved component choices, state matrix, accessibility and geometry requirements, acceptance probes, exact proof and authorization statuses, and minimal next safe action.

## Never claim
No invented independent test PASS, legal certification, human review, actual Git publication, approved company policy, or guaranteed perfection. A read-only MCP cannot grant or exercise file/Git privileges. Use the separate authorized engineering workflow for changes.
