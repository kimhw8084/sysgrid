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

## Product-independent rendered visual gate

When a web UI is in scope and an approved local browser runtime is available, invoke the existing `golden-uiux visual-enforce <request.json> --output <new-evidence-dir>` command after implementation. This is the independent evaluator for profile-declared hard constraints; do not substitute screenshots, source inspection, or an agent self-review.

1. The request must bind the exact project profile and relevant source files by SHA-256 (and mode where the project profile records it). The profile must declare `visual_enforcement`, its mandatory check categories and thresholds. Route requests can add test states but cannot override project acceptance policy. Missing profile rules block rather than silently pass.
2. Use a pre-approved local Playwright module and browser. The default allows only the listed loopback origin. External requests, WebSockets, service workers, popups and mutating HTTP requests are blocked. `--allow-interactions` is required for declared UI interactions; `--allow-writes` separately requires an isolated nonproduction context. Never use production data or credentials.
3. The runner emits a hash-bound report, DOM geometry and text-fragment bounds, clipping chains, control hit tests, scroll containment, computed CSS contrast, declared token/geometry comparisons, focus traversal/restoration, temporal samples, and screenshots with selector-specific reproduction steps. It accounts for intentional overlap, overlays and truncation only when the project profile explicitly declares them. A geometric intersection alone is not sufficient for failure.
4. Generate → validate → repair → retest: make a working implementation; run the evaluator; repair the actual source for confirmed failures; rerun the affected routes/states. Limit repairs to three targeted iterations. If the same failure persists twice, stop with its measurements and reproduction steps. Do not lower thresholds, edit the profile to excuse a defect, or loop indefinitely.
5. PASS applies only to declared source, profile, runtime, routes, viewports, themes and states. `UNKNOWN`, `BLOCKED`, `FAIL` and `NOT_RUN` block any gate that requires that evidence. Unsupported background compositing, missing states or unavailable browser capability remain UNKNOWN/NOT_RUN. Human visual critique, screen-reader use, cross-browser coverage, delivery authentication and G6 remain separate.

The unrelated executable positive/negative fixture is in `examples/visual-enforcement/fixture/`; run it with `python3 devtools/run_visual_fixture.py --output-root <new-path> --playwright-module <approved-module> --browser-executable <approved-chromium>`. It demonstrates the command path, not universal aesthetic superiority or live Codex/OpenCode skill authentication.

## v0.2.6 experimental source-patch proof

Before a source patch is applied, create a complete byte-and-mode inventory with `golden-uiux patch-manifest --before-root ... --after-root ... --output ...`. Verify that the manifest covers the entire source-tree diff. In a disposable copy, use `golden-uiux patch-replay <manifest> --before-root ... --after-root ... --scratch-root <new-path>` to prove postimages and exact reversal. The tool refuses preimage drift, missing/unlisted file changes, permission mismatches, unsafe paths, existing scratch targets, and diverged rollback files. It writes only to the new scratch tree; it does not authorize applying the patch to the real project.
