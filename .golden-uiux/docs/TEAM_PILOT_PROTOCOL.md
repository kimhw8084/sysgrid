# SysGrid and cross-project pilot — separately authorized, NOT_RUN

## Objective

Measure whether the standard improves verified user task completion and UI consistency while reducing **total end-to-end TAT** and active human correction burden, without weakening safety, accessibility, data integrity or release protections. Pilot is not authorized merely by receiving this package.

## Frozen cohort and comparisons

Use a pre-registered set of routine UI tasks on SysGrid, then at least one different approved product profile. Match task complexity and experience across baseline (current engineering workflow) and candidate (Golden UI/UX v0.2). Randomize/counterbalance task order where possible, record actual model and tool versions and independent reviewer identity, keep held-out cases separate from training examples. Avoid conflating trial run and production rollout.

Recommended SysGrid task families after source review: table selection/width persistence, safe forms and dirty drafts, overlay keyboard/collision, dashboard chart truth, theme-only geometry preservation, saved preference migration, 403 vs empty, zoom/keyboard and read-only archived records.

## Required evidence matrix

- Approved profile/source revisions, desktop-supported viewport matrix, themes, fonts, density and preference state.
- Happy, error, empty, filtered-empty, denied, offline, pending, conflict and recovered states **only when applicable**.
- Browser screenshots against independently reviewed baselines, DOM bounds, overflow/clipping, keyboard navigation, contrast and genuine assistive-tech review for risk-relevant flows.
- Large representative data for tables/charts and measured input/action latency and rerenders; set budgets based on baseline/user context before interpreting results.
- Deterministic/independent test results and Git CI required checks bound to exact tested source/merge revision.
- Separate counts for code defects, user correction prompts, escaped defects, wrong tool selections, compliance failures, model requests/tokens, retries, human active rework and total elapsed TAT (including reviewers and waiting).
- Repeat representative frozen tasks and report distribution, median/tail, and outcome variance; predeclare pass/fail and sample-precision conditions rather than picking them after results.

## Stop criteria

Authorization bypass, privacy/security violation, loss of work, fabricated PASS, mandatory accessibility regression or unapproved geometry change -> block affected candidate and report incident under existing standards. A nonzero problem frequency in a small pilot does not imply global pass rate; absence of incidents does not prove perfection.

## Performance objective

Among independently qualified outputs, minimize total TAT. Do not count 'shorter model output' or 'fewer MCP calls' as success when review, rework or escaped defects increase. Compare against actual baseline and report uncertainty. All targets still UNMEASURED.
