# Scientific Evaluation, Falsification and TAT — NON-FINAL

**No study has been run. There is no demonstrated performance improvement.** This is a proposed pre-registration contract for later independent and separately authorized evaluation.

## Main objective, estimands and no-loss gates

Treat approval as a **constrained, multiobjective** decision, not an LLM beauty score. Let M be applicable mandatory obligations at the relevant lifecycle stage. A design-stage candidate may carry future `NOT_RUN` obligations and must never be called qualified. For actual promotion, each obligation must be current source-bound `PASS` or independently reviewed `NOT_APPLICABLE` or valid permitted `WAIVED`; `FAIL`, `BLOCKED`, `NOT_RUN`, and `UNKNOWN` cannot promote. `coverage = independently verified PASS / applicable mandatory checks` is descriptive only, must retain waiver/N/A counts separately, and MUST NOT convert partial coverage into promotion authority. See canonical P0-02, P0-03 and P1-02.

For acceptable candidates, primary performance estimand is the paired change in total end-to-end human+system turnaround under matched tasks:

`T_total = active implementation + tests/debugging + corrections + independent review + human wait and coordination + delivery/publication handling` (mutually exclusive time accounting; clock timeline to avoid overlap). Median paired difference is informative; p90/p95 and failure tail matter. Additional metrics: authorized task success, corrections per task, human active rework, tool/model calls, input/output tokens, unnecessary design escalations, visual/geometry regressions, critical failures and variance across repeat runs.

The pilot goal **≥40% fewer correction prompts** and **≥25% less active human rework** remains a provisional SysGrid-local hypothesis from older rounds, not universal performance truth. Cross-project adoption thresholds must be frozen before outcome review and cannot be picked after seeing results.

## Task/sample construction

- Prepare at least 2 genuinely different project profiles (e.g. existing dense operations workspace and a customer-facing service workflow), with independent owners and approved data.
- Use blocked/matched tasks within project and complexity strata, randomized order where possible, same model/provider hardware and frozen tool versions. If a parallel model budget changes, explicitly record it.
- Include every P01–P14 family across the full catalog coverage matrix, not necessarily every family in each task.
- Challenge at least: keyboard-only modal, invalid form + async conflict, 403 vs empty, stale server status, pagination selection, extreme zoom/translation, theme-only geometry regression, destructive action denial, offline catalog fallback, prompt-injected tool result, protected main and independent review mismatch.
- Predeclare gold rubrics and cases; reviewer should not receive the agent's justification as ground truth. Store independent labels and source hashes, separate training/examples from held-out cases.
- Existing suggested design: 12 paired tasks and 8–12 shadow observations is **exploratory**; it does not guarantee adequate statistical power for small differences or rare safety failures. A larger sample plan and power/precision calculation must precede broad claims.
- Re-run selected identical cases from clean state at least twice (repetitions are a proposed sampling approach, not a universal standard) and document nondeterminism/variance. Never claim bit-exact model reproducibility absent actual proof.

## Statistical decision rules

- Report per-project and overall paired differences, confidence/uncertainty intervals and observed denominators.
- For proportions, prefer interval estimates (e.g., Wilson interval) over a single percentage; report all critical event counts separately.
- For time, calculate per-task matched change; report median, dispersion, tail, and bootstrap intervals where sample supports them, acknowledging small-sample uncertainty.
- Test non-inferiority of noncritical quality against a **pre-registered justified margin**; safety/security/a11y/data-integrity critical failures have no quality tradeoff permitted.
- Never interpret absence of observed serious failures in a small study as proof of safety. The qualification and separate enterprise controls still apply.
- Pre-register stop rules: any critical authorization/data-loss/security/privacy breach, unexplained discrepancy in exact-source evidence, repeated unauthorized geometry change, or reviewer independence failure stops the affected trial/promotion.

## TAT versus model-request efficiency

Requests/minute quotas and tokens are budgets, not an objective override. Reuse cached approved read-only catalogs, hash/digest decision profiles, start with 1–3 primary pattern IDs while retrieving every additional applicable mandatory cross-cutting/dependency contract, make deterministic choices without an LLM when possible, stage cheap tests before expensive ones, and batch read-only independent queries when beneficial. Avoid coordinator/swarms without measured positive gain after coordination. Budget total active engineering time plus rework, not isolated inference speed.

**Proof tier:** `DOC_SPECIFIED` -> `ARTIFACT_VALIDATED` -> `SOURCE_TESTED` -> `INDEPENDENTLY_REPRODUCED` -> `PILOT_MEASURED` -> `TEAM_APPROVED`. Each tier requires its own real source-linked artifacts. Current consolidated Round 48 status is DOCUMENT/SPEC only (plus package integrity); all actual application proofs remain NOT_RUN. Never automatically promote a tier.

## Negative controls / refutation

The standard fails its intended goal if: a new feature overrides approved project styling; an agent alters existing geometry without approval; keyboard or AT access regresses; required proof falsely becomes PASS; an out-of-scope edit lands; an approval receipt is misread as approval; a safe local fallback silently downgrades authority; or measured total TAT worsens without compensating, pre-registered quality benefit. Each violation gets a traceable counterexample and targeted correction proposal (not unbounded prompt accretion).
