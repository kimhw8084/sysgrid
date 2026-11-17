---
name: ui-accessibility-contract
description: "Specify keyboard, semantic HTML, focus, naming and applicable WCAG 2.2 accessibility proof."
license: "Internal use subject to company approval"
---
# ui-accessibility-contract

## Scope
Specify keyboard, semantic HTML, focus, naming and applicable WCAG 2.2 accessibility proof. Use only when the current UI task materially requires this skill. This package is a candidate implementation, not a signed organizational grant or proven source-level UI result.

## Source of truth
Work within the **separate** existing Golden Engineering Standard, trusted company/repository controls, and the approved project adapter. UI pattern contracts live in `.golden-uiux/data/patterns.json`; normative rationale and seven P0/P1 corrections are in `.golden-uiux/source_spec`. If files are missing, do not reconstruct rules from memory. All applicable mandatory rules remain in scope even when not loaded into the model context.

## Procedure
1. Inspect existing semantic HTML and approved component. Prefer correct native elements before building custom ARIA roles.
2. Select relevant WAI-ARIA APG pattern for genuine composite widgets and define focus order, arrow/Escape keys, screen-reader labels, states, errors and announcements.
3. Enumerate applicable WCAG 2.2 AA criteria or approved stricter project policy and document allowed exceptions; do not universalize optional requirements.
4. Automated accessibility checks may identify defects but cannot establish all assistive technology behavior. Include manual keyboard and actual AT review when relevant.
5. Use explicit contrast and target measurement on rendered elements; 24px row height is not a universal touch-target test.
6. Attach findings to exact candidate revision and record independent proof as NOT_RUN until actually executed.

## Escalation boundary
Mandatory failure/unknown must block promotion; no model self-certification or accessibility-exception invention.

## Required output
Return compact, auditable information: pattern IDs, source/profile/catalog versions, proposed approved component choices, state matrix, accessibility and geometry requirements, acceptance probes, exact proof and authorization statuses, and minimal next safe action.

## Never claim
No invented independent test PASS, legal certification, human review, actual Git publication, approved company policy, or guaranteed perfection. A read-only MCP cannot grant or exercise file/Git privileges. Use the separate authorized engineering workflow for changes.

## v0.2.6 experimental focus and navigation checks

For each keyboard-focused control, capture the native key path, transition-settled computed visibility, own focus-indicator perceptibility, and same-state focus-indicator bounds plus clipping ancestors. The G3 focus validator now returns UNKNOWN when that geometry is absent and FAIL when the indicator is clipped. Do not use programmatic focus as reachability evidence.

A skip-link check must include before/after values for the route and any user context the workflow promises to preserve (for example filters, grouping, selection, or a draft), plus hash-addressed state-capture evidence. Run `golden-uiux navigation-continuity <record.json>` for a focused diagnostic and include the state record in G3 `skip_link`; G3 never passes a skip-link check with absent state evidence.
