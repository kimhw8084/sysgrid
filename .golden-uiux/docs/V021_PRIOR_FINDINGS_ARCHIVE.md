# Historical v0.2.1 critique record — superseded by v0.2.2

This file documents earlier review findings. For the current candidate, see V022_CRITIQUE_RESPONSE_AND_OPEN_GATES.md.

# v0.2.1 — Second Codex Critique: Defend, Absorb, Improve

**Status: isolated-tested candidate, NOT adopted/qualified.** This file supersedes only the response to the second critique; previous v0.2.0 report remains historical.

| Finding | Correction | Tests / limitation |
|---|---|---|
| P0 remote resource allowlist | `allowed_origins` validated against loopback unless explicit `--allow-remote`; strict bare-origin parser and request-time origin gating. | Negative remote-origin, credentials and URL fragment cases. Not production network isolation. |
| P0 side-effects | Default denies click/fill/press; default denies non-GET/HEAD/OPTIONS; explicitly opt in to interactions, and separately to HTTP writes; service workers and WebSockets blocked. Changed description to *not inherently read-only*. | Direct request-gate and controlled inline Chromium interaction tests. A GET handler or loaded script can still modify state: use disposable isolated app only. |
| P1 optimized preflight | Removed `assert`, replaced with explicit `require`/`RuntimeError` checks. | `python -O` successful and sabotaged-catalog negative cases. |
| P1 proof completeness | Runtime required fields match `data/proof_schema.json` including environment, test command, timestamps, reviewer independence and exact source metadata; reject unknown fields and malformed timestamps. | Metadata complete only when strict fields present, never grants real reviewer authority. |
| P1 geometric shrink regression | Every metric needs a prior explicit directional policy and increase/decrease budgets; shrinking panels/targets now detected. | Regression tests for panel width/target size/toolbar shrink, missing rules, NaN. Browser clipping still separate. |
| P1 release drift | One `data/release_identity.json` drives package manifest/runtime version; corrected master labels Round 48, retained Round 47 historical lineage and removed stale hardcoded counts. | Optimized preflight checks identity, runtime, proof schema and pattern rendering. |

**P0 adoption blockers still open:** actual Codex/OpenCode clients must be tested; owner-approved SysGrid profile and source-bound baselines; browser flow testing against SysGrid plus independent accessibility and full CI; cross-project pilot and measured TAT; real release signature/SBOM transitive coverage and platform authorization. None is claimed by this patch. SysGrid Constitution v0.2.1 remains NON-FINAL, unchanged, 44 NOT_RUN, Round 36 CONTINUE_PROVISIONAL.
