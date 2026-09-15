# CHG-17 operational action R3 FIX evidence

Run date: 2026-09-14 (America/Chicago)

## Binding and scope

- Repository: `kimhw8084/sysgrid`
- Work branch: `codex/sysgrid-operational-action-idempotency-conflict-race-fix-v3`
- Bound target `main`: `e15dc975cc62c6f808a253ca83bef95aa6db8f3a`
- Exact preserved R2 predecessor: `7266ae988dc6d409a6ac127e62f09a6a41583edf`
- R2 predecessor branch: `fix/sysgrid-operational-action-recovery-concurrency-r2`
- Exact R1 ancestor: `0d159d5595d06b6349340486c3aeccb8cb63b08c`
- R1 direct parent: `e15dc975cc62c6f808a253ca83bef95aa6db8f3a`
- R1 tree: `efed8d15612eac1c3d412e7ca04f908402d8d1d6`

The work branch was independently verified clean at the bound `main` commit,
then fast-forwarded to the exact R2 predecessor before this FIX. R2 remains an
ancestor; `main` was not moved or modified. The R3 delta is limited to the
idempotency conflict semantic correction, decisive concurrency coverage, and
this evidence update. No new migration or schema change was introduced.

All valid R1/R2 behavior remains in place: durable execution/rollback attempt
ownership, interruption reconciliation, recovery-required behavior, replay
safety, additive R2 migration, simulation-only adapter, tenant isolation,
actor binding, authorization seam, preview freshness, risk/approval facts,
secret safety, Device/Maintenance context, and the existing lifecycle/state
machine behavior. CHG-13 and CHG-15 remain accepted-but-unintegrated seams.
P06 scheduling/cache/cancellation behavior and P09/P12/P13/P14 fixtures and
rules were not changed. P13/P14 were not run, P12 success is not claimed, and
no merge, integration, release, or whole-product readiness claim is made.

## Historical R2 finding retained honestly

R2 placed `_append_event`, flush, audit insertion, and commit inside the
deliberate `IntegrityError` boundary and re-read the durable action after
rollback. Its focused test was green and correctly covered identical-payload
convergence, but its second race reused the `race-key` created by the first
race. Consequently, the conflicting-payload assertion took the ordinary
already-existing-row lookup and did not prove the absent-key database
uniqueness race or post-`IntegrityError` recovery. R2's evidence statement
that this test proved a conflicting race returning `IDEMPOTENCY_KEY_REUSE` is
therefore not treated as established proof.

An intermediate R3 diagnostic made that gap decisive: after the test was
changed to use a fresh conflicting key but before the service correction, the
test failed with `ACTION_RECORD_CONFLICT` instead of
`IDEMPOTENCY_KEY_REUSE`. This was a deliberate red reproduction, not a final
validation result.

For audit continuity, the historical R2 record reported 15 passed in the
focused operational-action suite, 36 passed in the existing regression set,
and 342 passed with 1 unrelated P09 failure in the broad backend suite. It
also recorded the additive migration round trip from `c17a9e5b2f01` through
`d28f17a4c9e1`, downgrade and re-upgrade, compile/static checks, and the same
P09 freshness classification. Those historical results remain part of the
lineage; the R3 results below are the final validation for this candidate.

## R3 root cause and correction

The normal pre-insert existing-row path already raised the explicit
`IDEMPOTENCY_KEY_REUSE` conflict when the canonical request hash differed. In
the R2 post-rollback recovery path, a durable row with a different hash was
instead treated the same as an unreconciled persistence failure and mapped to
`ACTION_RECORD_CONFLICT`.

R3 now applies the same explicit semantics after rollback and re-read:

1. A durable row with the same `(tenant_id, actor_id, idempotency_key)` and
   the same canonical request hash is returned exactly as before.
2. A durable row with that key and a different request hash raises
   `IDEMPOTENCY_KEY_REUSE`, matching the normal existing-row path.
3. `ACTION_RECORD_CONFLICT` remains the explicit persistence-failure result
   only when the uniqueness/persistence exception occurs and no durable row
   can be safely reconciled.

The database uniqueness constraint was not weakened or removed. No production
timing hook, lock, scheduler, broker, external state store, remote execution,
machine command, or credential/secret storage was added. The simulation
adapter remains `production_capable=false` and external-system-free.

## Decisive fresh-key concurrency proof

`backend/test_operational_actions.py::test_concurrent_idempotent_creates_converge_and_conflicts_fail_deterministically`
now uses two distinct keys that are asserted absent from the durable action
list before each race:

- `race-identical-key`: two separate concurrent HTTP requests with identical
  normalized payloads.
- `race-conflicting-key`: two separate concurrent HTTP requests with the same
  tenant, actor, target, and key but different normalized `parameters` and
  request hashes.

Each `client.post` is a separate request path and the application creates a
separate tenant `AsyncSession` for each request. A test-only wrapper around
`service._append_event` counts arrivals for the `requested` event and holds a
barrier until both requests have completed their initial absent-key lookup and
reached the insert/flush persistence boundary. No sleep or timing assumption
is used. The test also temporarily instruments `AsyncSession.rollback` and
asserts exactly one recovery rollback for each race, while asserting two
persistence-boundary arrivals. This directly distinguishes the true
post-`IntegrityError` path from the initial existing-row fast path.

For the identical fresh-key race, both callers return HTTP 200 for one action,
with one canonical history event and one action row. For the conflicting
fresh-key race, exactly one caller returns HTTP 200 and the other returns HTTP
409 with `IDEMPOTENCY_KEY_REUSE`. The winner is allowed to be either payload;
the test derives the expected winner payload from the successful response and
checks the persisted request hash and normalized parameters against it. It
also checks one action row for each fresh key, one requested history event,
and exactly one durable `REQUEST` audit row for the conflicting winner.

## Final validation results

| Check | Result | Classification |
| --- | ---: | --- |
| Fresh-key identical + conflicting synchronized race, repeated 10 times | 10 passed, 0 failed, 0 errors | Final deterministic race proof; each invocation ran both fresh-key cases |
| Focused `backend/test_operational_actions.py` | 15 passed, 0 failed, 0 errors | Full CHG-17 operational-action suite, including R2 interruption/reconciliation, rollback ownership/replay, lifecycle, and fresh-key races |
| Focused existing regressions (`test_main.py`, `test_devices_api_edges.py`, `test_asset_vendor_bulk_workflows.py`, `test_tenant_isolation.py`, `test_p13_audit_remediation.py`, `test_startup_migrations.py`) | 36 passed, 0 failed, 0 errors | Main/devices/assets/tenant/audit/startup regression set; startup migration path remains green |
| Broad backend suite (`pytest -q -c backend/pytest.ini backend`) | 342 passed, 1 failed, 0 errors, 5 warnings | Broadest practical backend run; not a clean full-suite pass because of the unrelated P09 failure below |

The sole broad-suite failure is:

`backend/test_p09_outcomes_delivery_value.py::test_journey_6_delivery_is_independent_and_two_verified_adoption_periods_qualify`

It is unrelated to CHG-17 R3. The test's final `outcomes.close` returned
`422 VALIDATION_FAILED`; the qualification details reported `status: Stale`,
`reason: "The latest period is beyond its freshness deadline."`, and
`freshness_deadline: "2026-09-12"` while this run date was 2026-09-14. No P09
date, freshness, arithmetic, sample count, budget, sequencing, fixture, or
semantic code was changed. The five broad-run warnings are existing
Starlette deprecations: `pv1_communication.py:12`, `fastapi/testclient.py:1`,
`pv1/domain.py:380`, and `workspaces.py:583` (the last was emitted for two
parametrized saved-view tests).

## Migration and static checks

- No migration was added or rewritten. The existing startup migration sanity
  path passed as part of the 36-test regression set.
- `python -m compileall -q` for `backend/app`, the operational-action test,
  and both existing operational-action migration files: passed.
- `git diff --check`: passed.
- Forbidden-command scan over the changed operational-action production/test
  paths: passed; no shell/SSH/WinRM/PowerShell/Ansible/Redfish/Kubernetes,
  subprocess, OS command, or external execution hook matched.
- Repository-configured linter: unavailable in the validation environment;
  `ruff` was not installed (`No module named ruff`). It is not reported as
  passed.
