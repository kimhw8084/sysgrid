# CHG-255 R2 candidate-bound responsive QA

- Product candidate: `31ee72386876b2ef877a72236c44d7e1895c2ed2` (tree `dfa8c00c9b9a39a34160fa265bf3daa4072954bf`), direct parent `ae5aa4c2bbd7226b6a08e2b3b4464a7fe0da18e3`.
- Required base: `ae5aa4c2bbd7226b6a08e2b3b4464a7fe0da18e3` (tree `376906e0c9079f2281732fbbc31eec0d754ec30e`).
- Work branch: `codex/sysgrid-golden-ui-v3-atlas-blockers-fix-v2`.
- Artifact ref: `refs/heads/project-os-artifacts/sysgrid/sysgrid-golden-ui-v3-atlas-blockers-fix-v2`.
- Before evidence: CHG-71 R5 artifact commit `7c5871b1ffce9ecfed10469a4a3030546658a943`, whose source SHA/tree match the required base. Each before image hash is checked against that R5 reader index.
- Package scope: all 11 established blocker anchors, before/after pixels, paired structured DOM/geometry captures, 1440x900 counterparts/holdouts, 390x600 and 200% text-pressure checks, shared Racks ToolbarSegmented consumer, and canonical Monitoring mobile/desktop holdouts.

## Read order

1. `claim-matrix.json` pairs each defect reference to candidate route/profile, owner, required task, geometry, screenshot, and result.
2. `candidate/captures/` retains all raw Playwright JSON and PNG bytes.
3. `geometry-results.json`, `task-and-test-results.json`, `shared-consumer-and-monitoring-holdouts.json`, and `contrast-results.json` summarize structured assertions.
4. `changed-file-manifest.json` binds the bounded Product files to the candidate commit. `candidate-binding.json` records parent/base lineage.
5. `SHA256SUMS.json` hashes the carrier files and bundle; it is excluded from `artifact-bundle.zip` to avoid self-reference.

All generated evidence is outside the Product tree. Native Fabric evidence remains Fabric-owned at `refs/heads/codex-fabric/evidence/sysgrid/sysgrid-golden-ui-v3-atlas-blockers-fix-v2` and is not authored by this package.
