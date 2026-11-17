# Independent UI/UX Quality Gates — NON-FINAL

**Status: NON-FINAL candidate contract.** The following names are the single canonical G1–G6 evidence identifiers used by this pilot's schema, executable validators and reports. They do not grant authority, and generated results are not authenticated proof. The standard MAY NOT report its own generated output as passed.

## Canonical evidence gates

| Gate ID | Check / evidence | Promotion behavior |
|---|---|---|---|
| `G1_DATA_TRUTH` | User-visible and persisted values match the selected source record and required field provenance. | Any applicable FAIL/UNKNOWN/BLOCKED or NOT_RUN proof blocks promotion. |
| `G2_API_CONTRACT` | Frontend URL, method, query, request/response schema and backend route agree. | Any applicable contract failure blocks the affected candidate. |
| `G3_ACCESSIBILITY` | Applicable names, semantics, keyboard operations, focus visibility/return, and recovery behavior. | Unknown required checks do not pass; applicable failures block. |
| `G4_RENDERED_CONTRAST` | Actual rendered foreground/background pair and alpha-composited contrast. | Unsupported or unmeasurable color is UNKNOWN, never PASS. |
| `G5_ELEMENT_GEOMETRY` | Element bounds, clipping ancestors, text completeness, viewport and hit-target evidence. | Missing element/ancestor measurements remain UNKNOWN. |
| `G6_EVIDENCE_AND_RULE_DELIVERY` | Source-bound evidence integrity and rule/skill-delivery trace. A local packet is not authenticated client delivery. | Live authenticity can remain UNKNOWN; local routing or a hash receipt alone is insufficient. |

## Additional promotion controls (not G identifiers)

Authority, structural review, behavioral review, integration, independent evaluation and Git/publication remain applicable promotion controls. They are not additional numbered evidence gates and must not be renamed as G1–G6.

| Control | Preserved requirement | When it blocks |
|---|---|---|
| `authorization_preflight` | Task grant, source classification, exact scope, pinned inputs and profile policy. | Missing or incompatible authority stops the affected action. |
| `structural_review` | Approved components where required, semantic DOM, lint, typings, static security and unsafe API checks. | An applicable hard failure stops the candidate. |
| `behavioral_review` | Pattern-specific states, keyboard, permissions, persistence and failure/recovery cases. | A failed mandatory behavior stops the candidate. |
| `integration_review` | Applicable integration, browser, performance and negative-path checks. | Missing required evidence blocks promotion. |
| `independent_review` | Risk-targeted cold evaluation of high-consequence claims by an authorized separate reviewer/system. | An unresolved critical finding blocks promotion when review is required. |
| `publication_review` | Actual commit/tree identity, required CI statuses, branch protection and publication authority. | No guessed or bypassed merge/approval. |

The older shorthand that called these stages G0–G7 is retired in this candidate. Its requirements are preserved in the named controls above; the canonical G1–G6 evidence definitions and their acceptance requirements are not weakened or relabeled as passes.

**Gate logic:** Use P0-02 (design eligibility vs promotion), P1-02 (canonical evidence states), P1-03 (dependency-aware validity) and P0-03 (actual independent authority). Every applicable mandatory promotion requirement needs an authorized current PASS, reviewed NOT_APPLICABLE, or valid permitted WAIVED state. Never treat an unexecuted design plan or model self-assessment as PASS.

**Evidence independence and approval authority**

An automated check constitutes valid machine evidence only when executed by a trusted runner against the identified candidate revision, using the required test configuration, and producing independently inspectable results.

Model-generated explanations, self-assessments, predicted test outcomes, and advisory MCP responses MUST NOT count as executed proof.

Independent human or separately accountable reviewer approval is mandatory only when required by applicable organizational policy, repository protections, risk classification, or the approved evaluation protocol.

The implementing agent MUST NOT impersonate a required independent reviewer or approve its own consequential changes.

Routine changes with complete mandatory automated evidence MAY proceed without additional per-edit or per-commit human review when the trusted authorization and publication policy explicitly permits that workflow.

Where independent review is required, the evidence record MUST identify the reviewer or authorized review system, the exact reviewed artifact revision, the decision, and any unresolved conditions.

Submission of an artifact for review MUST NOT count as acceptance. An approval MUST originate from the authorized external review mechanism.

**Canonical evidence-state contract**

Every applicable verification obligation MUST have exactly one current recorded status:

- `NOT_RUN`: the required check has not been executed.
- `PASS`: the check has executed successfully with valid, current, source-bound evidence.
- `FAIL`: the check has executed and identified a requirement violation.
- `BLOCKED`: the check cannot currently execute because an explicit prerequisite is unavailable.
- `NOT_APPLICABLE`: an authorized applicability assessment establishes that the requirement does not apply, with documented rationale.
- `WAIVED`: an accountable authority has explicitly accepted a permitted exception within a documented scope and validity period.

`UNKNOWN` describes unresolved information or assessment uncertainty. It MUST NOT be converted automatically to any successful evidence state.

`NOT_RUN`, `BLOCKED`, `FAIL`, and `UNKNOWN` cannot satisfy a mandatory promotion gate.

`WAIVED` MUST remain distinguishable from `PASS`. A waiver MUST identify its authorized owner, rule, rationale, affected scope, expiration or review trigger, and compensating measures where required.

Waivers MUST NOT override legal obligations, externally enforced security boundaries, or other non-waivable requirements.

Every evidence result MUST be bound to its applicable source revision, catalog version, project-profile version, test environment, check identity, result artifact, and required reviewer authority.

**Dependency-aware evidence validity**

A change to source code, design contracts, project-profile versions, test configuration, or execution environment MUST trigger an evidence-dependency assessment.

Previously collected evidence MAY be reused only when an independently verifiable dependency record demonstrates that the changed inputs cannot affect the requirement, tested behavior, execution conditions, or proof validity.

Evidence whose dependencies have changed or cannot be established MUST be invalidated and regenerated.

Every mandatory promotion gate MUST evaluate the current candidate source and the appropriate integration or merge revision required by repository policy.

Scoped evidence reuse MUST NOT weaken mandatory checks, conceal changed requirements, or permit stale results to qualify a different candidate.

The system SHOULD minimize unnecessary reruns through deterministic dependency analysis, caching, and applicable-test selection, while retaining complete required qualification before promotion.

## Geometry and visual proof are distinct

**Geometry preservation and accessibility accommodation**

For existing applications, the agent MUST preserve approved component geometry, spacing, density, information capacity, and user preferences unless the authorized feature scope explicitly requires a change or an applicable higher-priority safety or accessibility requirement necessitates an accommodation.

A visual-only change MUST NOT alter unrelated layout geometry.

Geometry comparisons MUST use equivalent viewport, browser environment, zoom, data state, theme, effective preferences, and relevant interaction state.

Measured changes outside preapproved tolerances MUST be reported as regressions unless covered by an authorized, documented exception.

Accessibility accommodations MUST NOT be rejected solely because they alter an existing compact dimension. Such changes MUST use the smallest effective, compliant adjustment, preserve the stored user preference where possible, and provide separately reviewable before/after evidence.

The agent MUST NOT infer accessibility compliance or failure from row height or font size alone. Actual target dimensions, spacing, keyboard accessibility, focus behavior, reflow, applicable WCAG exceptions, and assistive-technology requirements MUST be evaluated.

A project-specific compactness standard MUST NOT become a universal requirement for other applications.


**Geometry vector** at frozen state = [viewport W/H, font/zoom, component bounding rectangles, header/toolbar heights, grid row height, visible rows, panel widths, modal footprint, padding/gaps, text overflow, scroll position and focus target]. Compare baseline and candidate for the *same* task state and user preferences. Any tolerance or approved exception must be documented **before** the comparison. Exact 0px tolerance may be appropriate for unchanged components, but font raster and browser platform differences require calibrated pixel tolerances rather than universal exact screenshot equality.

**Visual vector** = [semantic token pairs, foreground/background contrast, hierarchy, label wrapping, state differentiation, theme/forced-colors/reduced-motion]. Changing a color is not permission to change size. A change to an approved density default is *intentional* only within the affected project and its reviewed exception. Preserve user-requested preference even when the safe effective minimum is larger.

**Accessibility:** WCAG 2.2 2.5.8 has explicit exceptions/spacing alternatives: a 24px compact grid row is not itself evidence of failure or compliance. Inspect real target bounding boxes and relevant criterion exceptions. Native HTML has precedence over gratuitous custom ARIA. Automated scanner PASS is insufficient for focus/announcement quality.

## Source-bound evidence schema

Each required proof record MUST have: `rule_or_pattern_id`, `applicability`, `acceptance_gate`, `source_commit`, `source_tree_digest`, `catalog_digest`, `profile_digest`, `environment`, `test_command_or_case`, `runner`, `started_at`, `completed_at`, `result` (NOT_RUN/PASS/FAIL/BLOCKED/NOT_APPLICABLE/WAIVED), `artifact_digest`, `evidence_location`, `reviewer_independence`, `exception_id`, and `waiver_authority`. `UNKNOWN` is an assessment uncertainty requiring resolution and is never PASS; unexecuted stays NOT_RUN. A reviewer must distinguish tool success, test success, user acceptance, and actual remote Git publication.

## Risk-based review (human remains accountable for consequential approval)

Independent approval applies when required by organizational policy, repository protection, risk classification or the approved evaluation protocol, according to P0-03. Risk-based independent review triggers include: auth/permissions, secrets, personal information, unsafe irreversible action, persistent data/schema changes, cross-tenant access, loss of unsaved work, major shared navigation/geometry, complex custom ARIA and source-publication controls. Ordinary validated presentational edits can follow existing company controls without repeating human approvals, provided no policy requires it. Up to 2 safe and independently checked repair rounds per defect; collect *all* failures at the current stage before repair. Hard-stop for security/privacy/data-integrity/unauthorized scope events.

## Ten universal dimensions (measure, do not fabricate)

1. Task correctness and information architecture — task success, required hierarchy and journey.
2. Visual hierarchy/clarity — independent rubric with calibrated examples, not model self-score.
3. Design system compliance — component/token ownership and diff.
4. Geometry/density — paired measured capacity and approved exceptions.
5. Responsive/zoom — no lost key content or inaccessible controls.
6. Interaction correctness — keyboard, focus, menus, forms, tables, dialogs.
7. Complete states — applicable loading/empty/error/denial/conflict/cancel/recovery.
8. Accessibility — applicable WCAG 2.2, AT evaluation where mandated.
9. Persistence/data safety — no silent draft loss, privilege overreach or duplicate effects.
10. Evidence integrity/independence — current exact source with reproducible records.

Illustrative evaluator may assign 0–4 for *noncritical qualitative characteristics* only AFTER independent calibration; scores MUST NOT override any hard FAIL/UNKNOWN. Declared thresholds and weights are project-specific and pre-registered.
