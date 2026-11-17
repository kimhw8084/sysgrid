# v0.2.2 — Independent Codex critique response and open gates

Status: **ISOLATED-TESTED IMPLEMENTATION CANDIDATE, NOT PRODUCTION-QUALIFIED**.

| Finding | Change | Regression evidence | Honest limitation |
|---|---|---|---|
| P1 WebSocket blocking fail-open | Require callable Playwright `context.route_web_socket`, install denial route before page creation; if missing/failing, block affected route/run without navigation. Only report `BLOCKED_BY_INSTALLED_ROUTING` on successful installation on all routes. | Browser unit tests for absent API, setup exception, early installation and actual local Chromium fixture. | Real SysGrid WebSocket behavior and controlled outbound network isolation remain untested. |
| P1 MCP symlink profile escape | Fixed root-only profile, reject any symlink, resolve strict containment, require regular file, cap bytes, open with `O_NOFOLLOW` and verify inode. Unsupported no-follow platform fails closed (profile unavailable). | Tests cover regular file, symlink to external file, symlink within root, directory, oversized file and prevention of component registry content leakage. | A local attacker with arbitrary write access to the trusted package root remains outside the intended threat boundary; use signed provenance and access controls. |
| P2 Vertical clipping | Measure computed `overflowY` and element scroll/client heights, flag hidden/clip loss and explicitly forbidden internal vertical overflow; intentional scroll remains valid. | Deterministic policy tests and rendered local Chromium fixture. | Only configured elements measured; no universal screenshot/DOM proof of every clipping scenario. |
| P2 README wording | Remove `Optional optional` and `passive observations only`; clearly distinguish passive-by-default probes from intrinsically read-only execution. | Documentation grep and package manifest consistency checks. | Browser navigation can have state-changing effects even with GET requests. |

**Preserved:** 14 pattern contracts, nine skills, 24 unexecuted paper cases, separate Golden Engineering Standard, read-only design MCP, explicit side-effect browser gates, existing-v0.1 ownership warning, Codex/OpenCode separate qualification, offline-first approved snapshots, protected Git and independent app acceptance. SysGrid Constitution v0.2.1 remains NON-FINAL, unchanged, 44 NOT_RUN; Round 36 CONTINUE_PROVISIONAL.

**Still NOT_RUN:** actual Codex/OpenCode clients, owner-approved SysGrid profile and baselines, live SysGrid browser workflows, independent accessibility review, total-TAT pilot, complete signed publisher provenance and transitive SBOM. No source repository or Constitution changes made.
