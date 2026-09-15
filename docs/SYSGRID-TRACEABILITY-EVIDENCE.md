# SysGrid asset / Architecture / PV1 traceability evidence

## Bound change

- Repository: `kimhw8084/sysgrid`
- Branch: `build/sysgrid-asset-architecture-traceability`
- Required base: `e15dc975cc62c6f808a253ca83bef95aa6db8f3a`
- Architecture migration head after this slice: `9a7b6c5d4e3f`
- Main, CHG-7/P12 qualification lineage, and accepted CHG-13 were not edited.
- Legacy Data Flow Designer and the P06 scheduling graph authority were not edited.

## Normalized authority

`pv1_architecture_device_links` is the tenant-scoped Device ↔ canonical ArchitectureObject spine. It has a unique target pair, restricted foreign keys, Active/Retired lifecycle, audit columns, positive revisions, and model-revision Architecture events.

`pv1_traceability_links` is the extensible tenant-scoped PV1/Architecture work-to-target spine. It supports one normalized Device or ArchitectureObject target per link and has indexed reverse lookups by entity, project, Device, and ArchitectureObject. Its uniqueness key is `(tenant_id, entity_kind, entity_id, target_kind, target_key, relationship_type)`.

Supported canonical entity kinds are:

- `Project`
- `Task`
- `OutcomeAcceptance`
- `DeliveryAcceptance`
- `OutcomeCheckpoint`
- `ArchitectureChangeSet`

The read projections are available in both directions at `/api/v2/architecture/traceability/devices/{id}`, `/api/v2/architecture/traceability/architecture-objects/{id}`, and `/api/v2/architecture/traceability/work/{entity_kind}/{id}`. Device projections include linked ArchitectureObject/model projections and work reached through those objects.

Writes require the existing tenant routing, PV1 project role, and Architecture model access checks. Missing, cross-tenant, retired-current, and dangling targets fail closed. Link retirement is non-destructive and `include_retired=true` preserves historical navigation. Device hard purge is blocked whenever normalized traceability exists; ordinary Device soft delete remains available.

## Compatibility and migration

Migration `9a7b6c5d4e3f` is additive and down-revises from `f1a2b3c4d5e6`. Existing `ArchitectureAssociation.object_ids` selections are deterministically backfilled to normalized Project → ArchitectureObject links. Duplicate selections are collapsed without changing the source JSON. Malformed, missing, retired, cross-tenant, and wrong-model selections are recorded in `pv1_traceability_backfill_issues` with the original association snapshot; source `object_ids` and `relation_ids` are never rewritten or deleted.

Project Architecture reads and writes use normalized object links as authority and expose the existing JSON values as `legacy_projection`. `relation_ids` remain only as the compatibility projection for legacy relation selections because the bounded traceability target is the canonical ArchitectureObject, not a new relation/work domain.

There is no stable generic canonical PV1 `Change` aggregate in this repository. No parallel change domain was invented. The existing canonical `ArchitectureChangeSet` is supported explicitly; generic PV1 Change coverage remains the exact gap for a future bounded workstream.

Traceability writes advance PV1 `Project.revision` and do not advance `graph_revision`, preserving accepted P06 scheduling semantics.

## Validation record

Commands were run from `backend` with the repository test isolation fixtures and SQLAlchemy 2.0.51 supplied from `/tmp/sysgrid-sqlalchemy` because the host environment's installed 2.0.25 rejects the repository's existing SQLite engine options.

- `pytest -q test_asset_architecture_traceability.py test_p07_architecture_engine.py`: **8 passed**
- `pytest -q test_asset_architecture_traceability.py test_p07_architecture_engine.py test_devices_api_edges.py`: **16 passed**
- Relevant regression set excluding the date-sensitive P09 journey: **42 passed**
- Full backend suite: **198 passed; 12 failed; 121 errors**. The errors were the repository's subprocess-based migration fixture exhausting the process file-descriptor limit after extended parallel parameterized execution. The one observed P09 failure is freshness-date sensitive: its fixture data ends 2026-08-29, the existing freshness deadline is 2026-09-12, and the bound environment date is 2026-09-14. No traceability test failed in that run.
- `alembic heads`: **9a7b6c5d4e3f (head)**
- `git diff --check`: **passed**
- Python `compileall` over application, migration, and traceability test files: **passed**

Final SHA-256 fingerprints for the changed executable/test artifacts:

```text
backend/app/api/devices.py df6ae5df60d80491254d61074ef0013344d53fc3bbb996d4ad35716c783e2f74
backend/app/architecture/api.py 42658ddecc11c571239be882537c89c110d75b154a222a58813896682ee714ba
backend/app/architecture/domain.py 04ef7a7d0145d0bbe066a1c6250f62034f715d059bf2f7b4fc3c7cc971ed8a6a
backend/app/architecture/models.py 83f909d6431b53cc2865696500645511a01dc8d0b85645bea8d2f49b8bcc27a4
backend/app/architecture/traceability.py 75dc999925556f5a9eaf50fc6aa2019c7f35436af0f7b463a298b9428051d76d
backend/app/pv1/models.py 9476ddd2f8d03be7683d9bd148262d57ba2790afb392909074b4e4c7ee821441
backend/alembic/versions/9a7b6c5d4e3f_add_normalized_asset_architecture_traceability.py 876d850c7e8f69740e2412f9530e8b8238af2d83e1b66fa2145aa64c1dff4a4f
backend/test_asset_architecture_traceability.py e4f0c97a072a38e23533730df4e2660e6944477ab1beee022284fd26d5b2cddd
```
