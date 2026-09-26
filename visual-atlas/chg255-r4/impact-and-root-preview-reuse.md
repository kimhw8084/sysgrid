# CHG-255 R4 source impact and root-preview reuse

## Candidate scope

R4 verifies candidate `ecad9edd993c4022f4716e1e4099bc2dad29c4a0` (tree `15332211fe6c39f5f3926ebc970a3c0ece362d83`), whose exact parent is the R2 candidate `31ee72386876b2ef877a72236c44d7e1895c2ed2`.

The mechanical R2-to-R3 path list contains exactly:

- `frontend/src/components/ConfigRegistry.tsx`
- `frontend/src/components/Settings.tsx`
- `frontend/tests/golden-ui-v3-responsive.spec.ts`
- `frontend/tests/settings-privilege.spec.ts`

A `git diff --quiet` owner-path check returned exit 0 for the R2-to-R3 diff across ArchitectureHost, ArchitectureWorkspace, DataFlowDesigner, Knowledge, and `shared/LayoutPrimitives.tsx`. The R3 change therefore leaves the Architecture/Knowledge UI owners and shared PageHeader/ToolbarSegmented implementation unchanged. R3's source-impact record also documents `ConfigSection.wrapHeaderOnMobile` as opt-in with default `false`; Monitoring's ConfigRegistryModal consumers do not pass the option.

## Reused root-preview proof

R2 carrier `refs/heads/project-os-artifacts/sysgrid/sysgrid-golden-ui-v3-atlas-blockers-fix-v2` at `70101ea3bfa81d73f4285629ed418a80f9c7dc76` contains `visual-atlas/chg255-r2/task-and-test-results.json`. That record binds root-preview results to exact candidate `31ee72386876b2ef877a72236c44d7e1895c2ed2`: 2 passed, 0 failed, and the identity gate asserted `identity.system_root === true`. The root-preview actions cover Architecture v2, legacy Architecture, and Knowledge.

R4 did not rerun root-preview because `SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID` is unavailable in this environment; no System Root identity was inferred. Since the post-R2 diff leaves those root-preview owners and their shared authority unchanged, the exact R2 evidence remains applicable as unaffected predecessor proof.

## Preserved R3 references

R3 artifact carrier remains `refs/heads/project-os-artifacts/sysgrid/sysgrid-golden-ui-v3-atlas-blockers-fix-v3` at `72712e2bded0f49f2040715786e2f3133b622eb8`. R3 Artifact Run AR-84 remains classified as rejected as decisive acceptance evidence, not as proof of a Product defect. R4 adds separate evidence and does not replace or rewrite either R2 or R3 carrier.
