# CHG-17 operational action R2 FIX evidence

Run date: 2026-09-14

## Binding and scope

- Repository: `kimhw8084/sysgrid`
- Work branch: `fix/sysgrid-operational-action-recovery-concurrency-r2`
- Bound target `main`: `e15dc975cc62c6f808a253ca83bef95aa6db8f3a`
- Exact R1 ancestor: `0d159d5595d06b6349340486c3aeccb8cb63b08c`
- R1 direct parent: `e15dc975cc62c6f808a253ca83bef95aa6db8f3a`
- R1 tree: `efed8d15612eac1c3d412e7ca04f908402d8d1d6`

The R2 delta is limited to durable execution/rollback attempt ownership and
outcome-unknown reconciliation, idempotency conflict-boundary repair, atomic
rollback claim/replay safety, the additive repair migration, decisive tests,
and this evidence update. No main, R1 branch, CHG-13 capability seam, CHG-15
traceability, P06 behavior, P09 fixtures/semantics, or P12/P13/P14 gate code
was changed.

## FIX coverage

- Forward execution has a durable `EXECUTION` attempt with `CLAIMED` and
  `COMPLETED`/`OUTCOME_UNKNOWN` states. A conditional claim persists the
  attempt before adapter invocation; retries of `EXECUTING` or reconciled
  outcome-unknown execution never invoke the adapter again.
- Rollback has a durable `ROLLBACK` attempt and conditional ownership claim.
  Same-attempt replays are replay-safe, completed attempts are not replayed,
  and a new rollback attempt after failure or outcome-unknown requires a new
  explicit `attempt_id`.
- `POST /api/v1/operational-actions/{action_id}/reconcile` is tenant-safe,
  actor-bound, role-authorized, auditable, and adapter-free for both phases.
  It records `OUTCOME_UNKNOWN` and moves the action to `RECOVERY_REQUIRED`.
- `_append_event` and all create persistence through commit are inside the
  explicit `IntegrityError` boundary. Rollback re-reads the durable action and
  compares the canonical request hash; identical races converge and
  conflicting key reuse returns `IDEMPOTENCY_KEY_REUSE`.
- The simulation adapter remains deterministic and `production_capable=false`;
  no external-system or machine protocol was added.

## Validation counts

| Check | Result | Classification |
| --- | ---: | --- |
| `pytest -q -c backend/pytest.ini backend/test_operational_actions.py` | 15 passed, 0 failed | CHG-17 R2 focused suite, including interruption/reconciliation and separate-session races |
| Focused existing regressions (`test_main.py`, `test_devices_api_edges.py`, `test_asset_vendor_bulk_workflows.py`, `test_tenant_isolation.py`, `test_p13_audit_remediation.py`, `test_startup_migrations.py`) | 36 passed, 0 failed | Assets/Maintenance/audit/tenant/startup regression set |
| Broad backend suite (`pytest -q -c backend/pytest.ini backend`) | 342 passed, 1 failed | Broadest practical backend run; one unrelated known P09 failure |
| Failing test | `backend/test_p09_outcomes_delivery_value.py::test_journey_6_delivery_is_independent_and_two_verified_adoption_periods_qualify` | Unrelated date-sensitive P09 freshness failure |

The sole broad-suite failure is P09-only: its latest qualification period has
freshness deadline `2026-09-12`, while the run date is `2026-09-14`. The
failure reports `422 VALIDATION_FAILED` with “The latest period is beyond its
freshness deadline.” No P09 fixture, date, arithmetic, sample count, budget,
sequencing, or semantics was changed. The run is not claimed as a clean full
suite.

## Migration and static checks

- Additive migration: `d28f17a4c9e1`, down revision `c17a9e5b2f01`.
- R1 schema `c17a9e5b2f01` → repaired head `d28f17a4c9e1`: passed on disposable
  SQLite.
- Downgrade only `d28f17a4c9e1` → `c17a9e5b2f01`: passed; R1 operational tables
  and schema remain intact.
- Re-upgrade to `d28f17a4c9e1`: passed; `operational_action_attempts`,
  `execution_attempt_id`, and `rollback_attempt_id` are present.
- Normal startup migration path: covered by the startup migration regression
  set and the seeded-tenant head migration used by the focused suite.
- `python -m compileall`: passed.
- `git diff --check`: passed.
- Changed operational-action source forbidden-command scan: passed; no shell,
  AI-agent, remote-machine, or external-system execution path.
- Repository-configured `ruff`: unavailable in the validation environment
  (`No such file or directory`).

P13/P14 were not run, P12 success is not claimed, and no merge, integration,
release, or whole-product readiness claim is made.
