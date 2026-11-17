# SysGrid Codex critique — defended, absorbed, improved (v0.2 candidate)

**Scope:** Package only. No SysGrid file changes or Git operations. This is NOT evidence that SysGrid itself passed application review.

## A. Defend: intentional architectural boundaries

The critique correctly notes that the read-only MCP doesn't render or implement an app. That **is not a defect in the read-only design MCP trust boundary**: it supplies the versioned design authority, while authorized Codex/OpenCode executors implement and browser/CI check actual code. Making the design MCP a source-write super-tool would collapse design advice, credentials and independent release gates.

Other sound original choices remain: 14 distinct pattern families; nine lazy-loaded, reusable skills; project adapters rather than a mandatory universal theme; staged checks and exact-source evidence; zero remote runtime dependency for reference tools; no model self-approval; no claim of arbitrary numerical aesthetics or universal speed guarantee. This division is more reproducible and appropriate for protected Git delivery than promising an omnipotent MCP.

## B. Absorb and corrective implementation

| Critique | Action taken | Proof / remaining gap |
|---|---|---|
| Pre-existing identical file could be uninstalled | Fixed receipt to store only created files; dry-run/apply check unchanged ownership; conservative uninstall | Targeted regression test passes. v0.1 receipts need separate migration review |
| Partial writes/interruption | Atomic staged + fsynced no-clobber hardlink, rollback on failure, pending transaction journal, explicit recovery | Disk failure, KeyboardInterrupt, pending journal cases tested; forced kill/power loss only recoverable, not proven atomic across whole tree |
| Numeric geometry insufficient | Added optional actual Chromium screenshot/DOM/overflow/contrast/focus/interaction runner | Isolated local fixture tested, NOT SysGrid; optional Playwright/Chromium/Pillow required |
| SysGrid empty profile | Populated observed component/theme/preference source metadata at SHA 36a34cb..., marked PROPOSED | Real local source, browser baselines and owner approval still required |
| Duplicate/inconsistent rule docs | `data/patterns.json` canonical; generated human-readable contract checked for drift; missing referenced source-spec docs included | Drift check tested; all policy semantics still need external review |
| Codex vs OpenCode | `--client codex/opencode/shared/both` installations and distinct validation docs | Filesystem install tested; actual clients not installed here, hence not proven |
| Real pilot | Added browser collector and test protocols, kept all app evidence NOT_RUN | Must execute in actual project; no claimed performance gains |

## C. Other one-for-all enhancements

- Structured feature intake avoids asking developer for button margins; requests user/job/data/permission/outcome/consequences/success criteria.
- Canonical pattern additions cover shell/gutters/scroll/overflow, table resizing/pinning/saved widths, anchor collision, chart truth, live status, desktop-only support matrices, semantic theme tokens, data conflict/retry.
- Existing app library and project owner remain authoritative. Browser collector supports declared nonproduction routes and viewport-dependent evidence, captures screenshots and never writes approved baselines.
- The CLI and MCP remain non-authorizing. Form, keyboard, accessibility, storage, security and CI gates still require real application evidence.

## D. Mandatory adoption blockers

1. Owner-approve a source-verified SysGrid profile after local checkout inspection, including supported **desktop** widths, full theme token map, saved preferences, baseline states and non-waivable accessibility obligations.
2. Test Codex and OpenCode separately in their actual versions, with real skill triggering, MCP discovery and protected tool permissions.
3. Run real SysGrid app/browser/a11y/large-data/persistence flows with current authorized fixtures, exact source SHA and independent outcome review.
4. Evaluate repeated task pairs (including failure cases) and actual TAT/rework/defect rates before declaring performance improvement or release readiness.
5. Apply company provenance signing/attestations, identity approvals, dependency SBOM, versioned migration and distribution policy before production rollout.

**Do not confuse package unit-test PASS with app qualification PASS.**
