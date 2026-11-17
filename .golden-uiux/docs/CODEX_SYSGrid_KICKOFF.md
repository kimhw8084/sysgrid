# Local Codex kickoff — Golden Universal UI/UX v0.2.3 candidate

**Role:** Read and follow the separate Golden Engineering Standard and all current SysGrid project/Constitution safeguards. You may inspect locally and ask for separately scoped authorization before repository writes. No bypass of branch protections or human review required by company policy.

## Steps

1. Verify package SHA inventory and candidate tests in an isolated extracted copy: `python3 install.py --verify-only`, `python3 devtools/render_patterns.py --check`, `python3 -m unittest discover -s tests -v`. These are NOT SysGrid application tests.
2. Inspect SysGrid `HEAD`, working tree and current owner-approved rules; preserve unrelated edits. Compare observed read-only GitHub draft `examples/sysgrid_profile_SOURCE_OBSERVED_NOT_APPROVED.json` against actual source and current Git revision. **Do not change approval_status to APPROVED yourself.** Collect project owner approval and document source revision, token rules, exact supported desktop widths, density/typography preferences, page shell and routing.
3. Inventory existing components, interactive tables, overlays, charts, saved-view behavior, theme variants and project Playwright/CI checks. Prefer the existing TS/Playwright app test scripts and independent UI evidence rather than introducing an unnecessary second framework.
4. Choose client layout. For Codex + compatible OpenCode, preview `python3 install.py --target <sysgrid-root> --client shared`; alternatively install client-specific paths only after verifying actual version precedence. Inspect unchanged files/conflicts and journal recovery semantics before `--apply`. **No forceful overwrite or migration of v0.1 install**.
5. Test Codex skill discovery and OpenCode skill discovery **separately** in actual clients. After approved manual MCP registration test `initialize`, read-only tools including `uiux_feature_intake`, and offline behavior in the real OpenCode client.
6. Take a bounded, authorized SysGrid feature task with user/job/data/permissions/consequential behavior/success brief; choose approved patterns/components, preserve density/desktop-only support, record all required states and acceptance probes.
7. With separate authorized development grant, implement the smallest coherent change, run cheap affected checks, actual route/state browser evidence, applicable WCAG/keyboard/AT requirements, full mandatory exact-source CI, and independent review where required. Only then publish through approved Git protections. Record real total TAT and correction effort. No unsupported perfection claim.

**Initial controlled use case candidates:** existing table bulk selection/column geometry/saved widths and dashboard chart truth. Owner chooses actual scope and representative fixtures; don't make spontaneous destructive changes or change SysGrid Constitution v0.2.1 (NON-FINAL with 44 NOT_RUN proofs, Round 36 CONTINUE_PROVISIONAL).

## Copy-paste task brief to start

> Inspect my current SysGrid working tree read-only and reconcile the Golden UI/UX v0.2.3 candidate against existing Golden Engineering Standard, SysGrid Constitution and current component/theme code. Return a discrepancy-first, source-cited integration plan: actual Codex and OpenCode versions, proposed approved desktop-only SysGrid adapter, tested installer dry-run, chosen skill-discovery layout, actual existing Playwright/CI gates and minimum representative pilot. Do not modify the repository or approve any policy until the separate allowed scope has been confirmed. Do not confuse the isolated package test totals reported in TEST_REPORT.txt with SysGrid qualification.

## Required v0.2.3 portability verification

1. From the extracted ZIP, verify SHA manifest and run portable tests. Record `Ran`, `skipped`, and `errors` separately; a skipped browser test is NOT a browser PASS.
2. Run `python3 devtools/browser_capability_gate.py --output <writable-local-evidence-path>`; if exit code != 0, mark browser runtime **BLOCKED** and do not call the app-browser gate qualified. No automatic downloads of browser dependencies.
3. Verify a screenshot baseline inside its own writable evidence output directory fails in pre-browser validation, even when Playwright is missing.
4. Run real application browser qualification only after approved SysGrid profile, disposable source-bound test environment and requisite owner authorization are available.
5. Record exact source/profile/release revision; do not conflate fixture qualification, app qualification, or company adoption approval.
