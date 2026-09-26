# CHG-255 R4 compact verification report

**Conclusion: `GO_READY_EVIDENCE`**

## Candidate and immutability

- Candidate: `ecad9edd993c4022f4716e1e4099bc2dad29c4a0` — tree `15332211fe6c39f5f3926ebc970a3c0ece362d83`.
- Exact parent: `31ee72386876b2ef877a72236c44d7e1895c2ed2`; parent tree `dfa8c00c9b9a39a34160fa265bf3daa4072954bf`; base: `main@ae5aa4c2bbd7226b6a08e2b3b4464a7fe0da18e3`.
- R4 work head stayed on the existing candidate commit. No Product/test commit or source mutation was made; the Product worktree is clean.
- Remote `main` was observed at the required base before diagnostics and again after the full run.

## Settings state-coincident proof

All four JSON/PNG pairs use the normal-v1 authorized identity `haewon.kim`, selected tenant 1 (`Playwright Gate`), 390×844 viewport, DPR 1, and the same settled readiness checks. The text-pressure cases use the R3 method `document.documentElement.style.setProperty("font-size", "200%", "important")`. PNG iTXt metadata embeds the same proof ID and exact state/scroll metadata as its JSON sidecar; the pair manifest independently read back and verified each SHA-256 and unchanged PNG pixel data.

- **header** `settings-parameters-header-390x844-default-control.png` / `settings-parameters-header-390x844-default-control.json` — proof `CHG255-R4-SETTINGS-PARAMETERS-HEADER-390X844-DEFAULT-CONTROL-3c0d4289-5005-4e28-9a15-153c84bfbe09`; JSON SHA-256 `7ecac46e6879a6f54d00893e2f66a27da2c12706263794fc9d71ec2cfbc6262e`, PNG SHA-256 `47e3ea35a2d2ac787f45a56f8456cab9e4da3c4d49086d22daa05fd09da7813f`; accepted=true, viewport 390×844 DPR 1, text=default browser root text size; no override, active tab `environments`.
- **header** `settings-parameters-header-390x844-text-200.png` / `settings-parameters-header-390x844-text-200.json` — proof `CHG255-R4-SETTINGS-PARAMETERS-HEADER-390X844-TEXT-200-3da245f1-4457-4e7a-b8d0-af20e61f9d32`; JSON SHA-256 `a330a6c3fc30c4cb37f1eefc6a1fa5c13e5e73d2c9159bc1b5a106a9a0647ece`, PNG SHA-256 `cde9a78da970aa4c54f5dc43879573fbd849376ee38dc5ed5cb36ed01872f575`; accepted=true, viewport 390×844 DPR 1, text=document.documentElement.style.setProperty("font-size", "200%", "important"), active tab `environments`.
- **wayfinding** `settings-parameters-wayfinding-390x844-text-200.png` / `settings-parameters-wayfinding-390x844-text-200.json` — proof `CHG255-R4-SETTINGS-PARAMETERS-WAYFINDING-390X844-TEXT-200-3e616cf0-918e-4492-aee5-580e31e4dcd4`; JSON SHA-256 `93325a72ba12d487846b7b537f00520892f6cb896d6c39e0158c298e9d057a4a`, PNG SHA-256 `20b14d9c80a632e5ba9bd273ff4fe05c659896372ea25ac1c35337ffc397c54d`; accepted=true, viewport 390×844 DPR 1, text=document.documentElement.style.setProperty("font-size", "200%", "important"), active tab `environments`.
- **task** `settings-parameters-task-390x844-text-200.png` / `settings-parameters-task-390x844-text-200.json` — proof `CHG255-R4-SETTINGS-PARAMETERS-TASK-390X844-TEXT-200-f1ae06d1-2a86-462b-8417-6c14300284e0`; JSON SHA-256 `fdebd1c62f6aa0f934580cd474e7b35acd8341aa20e9ffef3a679e25d76c88ef`, PNG SHA-256 `00ab4c6742810fe81048feeffaafcc9b7d14ebdc3909bc2b9e8f85051daa529e`; accepted=true, viewport 390×844 DPR 1, text=document.documentElement.style.setProperty("font-size", "200%", "important"), active tab `environments`.

The 200% header pair shows both Golden Template and Force Hot Reload fully in view, readable, pointer/keyboard/touch reachable. The 200% wayfinding pair shows all six authorized tabs in two wrapped rows and reachable. The 200% Parameters task pair shows the first active-tab task action (`Light`) reachable. All four records report body and document widths of 375px within the 390px viewport, with no horizontal overflow. The ordinary header control pair is state-coincident and accepted.

## Monitoring classification

The exact R3 failure passed on R4 in a fresh isolated run, passed after the Settings action-closure test immediately before it in one worker, and passed at test 26 in one fresh full normal-v1 suite (75 passed, 2 profile skips, 0 failed). The isolated and adjacent runs each began with zero monitoring rows and recorded the fixture ID, final server title/purpose, and a cold UI route showing both updated values. No predecessor run was required because the failure did not reproduce. Classify the R3 result as a non-Product transient/harness event; its original cause remains unidentified. No candidate-specific defect is established.

## Root-preview reuse and preserved carriers

R2 carrier `70101ea3bfa81d73f4285629ed418a80f9c7dc76` records 2 passing root-preview tests on exact predecessor `31ee72386876b2ef877a72236c44d7e1895c2ed2`. The post-R2 candidate diff is limited to Settings, ConfigRegistry, and their responsive/privilege tests; a mechanical path check found no changes to Architecture, Knowledge, or shared LayoutPrimitives/PageHeader/ToolbarSegmented owners. R4 did not rerun root-preview because `SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID` is unavailable; no identity was invented.

R2/R3 carriers remain unchanged. R3 carrier is `72712e2bded0f49f2040715786e2f3133b622eb8`; AR-84 remains rejected as decisive acceptance evidence, not as proof of a Product defect.

