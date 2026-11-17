# v0.2.3 — Codex portability finding and resolution

**Evidence origin:** Local SysGrid Codex reported 110 tests run with two errors on v0.2.2 due to browser startup/capability limitations. This is an actual receiving-environment qualification failure, not a difference in how to report a passing test suite. No SysGrid source/Constitution changes were requested or made.

| Codex report | Root cause | v0.2.3 change | Evidence scope |
|---|---|---|---|
| `test_reject_self_comparison_baseline` unexpectedly returns `BLOCKED_*` when Chromium unavailable | A deterministic baseline-safety invariant was checked only after launching Chromium | `_baseline_preflight_failure()` enforces baseline directory containment and expected digest before Playwright import; invalid config returns `FAIL` plus `BLOCKED_BASELINE_INSIDE_OUTPUT_DIR` in `report.json` | Unit tests can enforce absence of browser import and invalid baseline rejection; not app qualification |
| `test_rendered_vertical_clipping_when_browser_available` gets `BLOCKED` without Chromium or socket routing capability | Browser fixture runtime requirement was conflated with portable unit-test success | Optional rendered fixtures report `skipped` only for known missing browser capabilities, never a fabricated PASS; deterministic clipping arithmetic tests always run | Browser suite cannot be counted as complete if optional fixture skipped |
| Browser-only checks might silently disappear from acceptance | No separate hard requirement to execute browser fixture on target | `devtools/browser_capability_gate.py` requires actual Chromium launch and installed WebSocket denial before rendering a fixture; exit 3 on `BLOCKED` | Fixture capability gate only; real SysGrid route and CI gates remain NOT_RUN |
| Launch failures sometimes had no serialized evidence | Early return omitted report file | Write `report.json` with blocked state on missing browser or Playwright | Captures blocker reason; never claims screen capture |

**Unchanged:** 14 universal candidate patterns, 9 skills, 24 unexecuted paper challenges, 3 authority planes, non-final project adapter, installer safety, local/offline behavior, owner-approved profile and independent release requirements.

**Open:** Independent actual Codex/OpenCode client compatibility, approved SysGrid project profile and baselines, real route/browser/AT results, security release provenance, and total TAT pilot. A green unit suite, with or without skips, is not app qualification. SysGrid Constitution v0.2.1 remains NON_FINAL and unchanged with 44 NOT_RUN; Round 36 CONTINUE_PROVISIONAL.
