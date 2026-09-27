# CHG-52 R2 candidate verification

Candidate `c3beb230dce1f1f16cafb1e4eade5c3daa6124ea` (tree `db8e2cfb02fdaeb21882cd5195a041262e806259`) has exact parent `f31fd16711f0234aa058be854c2639afd2f02c4d`. The work branch is `codex/sysgrid-lifecycle-device-authority-fix-v2`; `main` remains at the requested base.

## Backend lifecycle proof

- Strict `dry_run`: omitted and boolean values follow execution/preview semantics; strings `true`/`false`, numbers `0`/`1`, null, array and object each return 400 without a lifecycle transition.
- Archive and restore previews return 200/`preview` without mutation or added audit. Executions return 200/`success`, add one durable lifecycle audit, and retries return 200/`no_op` without a duplicate audit.
- Single DELETE archives once and records one `ARCHIVE`; retry is `no_op` with one row retained.
- Duplicate-hostname restore, missing-ID execution, protected-lineage purge and preview-to-execution traceability race all fail with HTTP 409. Captured database state shows no blocked mutation or new audit.
- Purge preview and receipt report current FK-derived delete/cascade and detach counts. The synthetic impact fixture previewed 13 deletes and 2 detach groups; execution receipt equaled preview, dependents were removed/detached, and `PURGE` audit survived Device removal.
- Secret hygiene check found no sentinel or encrypted payload in captured API, impact or audit evidence.

## User-visible Assets proof

The normal-v1 Assets archive scope reads `Archived (2)`. Desktop 1440×900 and mobile 390×844 captured both the permanent purge confirmation preview and its settled execution receipt from the same viewport-specific state. Preview names irreversibility and unsupported recovery, lists impact and blockers; receipt displays execution impact with no generic Undo/Revert. The captured preview inventory includes one Device and one Hardware component delete.

## Tests and affected consumers

- Full verifier backend: 205 passed. Focused Device/traceability/audit tests: 22 passed. Additional lifecycle capture cases: 10 passed.
- Frontend operational contract checks, typecheck and production build passed; full unit coverage: 141 files, 722 tests passed.
- Targeted Assets/Vendors browser tests: 2 passed. Normal-v1 browser suite: 75 passed, 2 skipped.
- Shared preview modal direct consumers are Assets, External, Vendors, FAR, Services and Network. Full normal-v1 browser and frontend unit suites passed; Monitoring remains intentionally outside this changed contract.
- Additional consumer attempt: External/Services plus FAR workflows yielded 0/5 in normal-v1. The External/Services spec failed before opening its existing Services preview because its Bulk Actions control was absent; the same assertion reproduced on exact base `f31fd167` with the same Node 20.19.4 runtime. FAR/Research tests returned `SYSTEM_ROOT_REQUIRED`, which matches the normal-v1 release policy. Shared modal optional-prop unit tests and all in-profile suites passed; no privileged identity was supplied.
- `scripts/verify-app.sh` completed all normal-v1 gates, then returned 1 at the separate System Root preview gate because `SYSGRID_VERIFY_SYSTEM_ROOT_USER_ID` was unset. No identity was inferred for this Assets slice.
- Existing warnings: Starlette 422 deprecation, esbuild/oxc notices and stale browserslist data.
