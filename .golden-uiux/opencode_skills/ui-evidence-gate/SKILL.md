---
name: ui-evidence-gate
description: "Map UI/UX scope to independent source-bound tests and release gates without model self-approval."
license: "Internal use subject to company approval"
---
# ui-evidence-gate

## Scope
Map UI/UX scope to independent source-bound tests and release gates without model self-approval. Use only when the current UI task materially requires this skill. This package is a candidate implementation, not a signed organizational grant or proven source-level UI result.

## Source of truth
Work within the **separate** existing Golden Engineering Standard, trusted company/repository controls, and the approved project adapter. UI pattern contracts live in `.golden-uiux/data/patterns.json`; normative rationale and seven P0/P1 corrections are in `.golden-uiux/source_spec`. If files are missing, do not reconstruct rules from memory. All applicable mandatory rules remain in scope even when not loaded into the model context.

## Procedure
1. For each scoped pattern identify applicable canonical gates `G1_DATA_TRUTH` through `G6_EVIDENCE_AND_RULE_DELIVERY`, applicability reasons, proof owners, test fixtures, source commit/tree and project-profile digest. Track authorization, structural, behavioral, integration, independent-review and publication requirements as separately named promotion controls, never as alternate G IDs.
2. During development use focused checks and collect all stage failures before bounded repair. Before publication require every applicable mandatory exact-source CI and reviewer rule.
3. Run `python3 .golden-uiux/uiux.py proofs <records.json> --source-revision <SHA>` for metadata audit; the result cannot authenticate external CI, human identity or legal waivers.
4. Statuses MUST be honest: NOT_RUN, FAIL, BLOCKED, PASS with independently verifiable evidence, NOT_APPLICABLE with competent review, or WAIVED where legally allowed and owner-approved.
5. Never treat plan completeness, screenshot existence, local SHA match, MCP receipt, or agent self-score as independently qualified PASS.
6. Record actual final remote branch/PR result only when trusted GitHub reports it; publication != production deployment.

## Escalation boundary
A missing mandatory proof, stale source binding, unauthorized reviewer or untrusted waiver blocks promotion; preserve prior valid state.

## Required output
Return compact, auditable information: pattern IDs, source/profile/catalog versions, proposed approved component choices, state matrix, accessibility and geometry requirements, acceptance probes, exact proof and authorization statuses, and minimal next safe action.

## Never claim
No invented independent test PASS, legal certification, human review, actual Git publication, approved company policy, or guaranteed perfection. A read-only MCP cannot grant or exercise file/Git privileges. Use the separate authorized engineering workflow for changes.
