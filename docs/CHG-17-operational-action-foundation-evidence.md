# CHG-17 operational action foundation evidence

Run date: 2026-09-14

Repository binding at inspection and final sanity check:

- Branch: `build/sysgrid-operational-action-foundation`
- Base/head: `e15dc975cc62c6f808a253ca83bef95aa6db8f3a`
- Working tree was clean before authoring; no main, CHG-7/P12, CHG-13, or CHG-15 lineage was changed or integrated.

## Validation counts

| Check | Result | Classification |
| --- | ---: | --- |
| `pytest -q -c backend/pytest.ini backend/test_operational_actions.py` | 8 passed, 0 failed | CHG-17 focused suite |
| Focused existing regressions (`test_main.py`, `test_devices_api_edges.py`, `test_asset_vendor_bulk_workflows.py`, `test_tenant_isolation.py`, `test_p13_audit_remediation.py`, `test_startup_migrations.py`) | 43 passed, 0 failed | Assets/Maintenance/audit/tenant/startup regression set |
| Broad backend suite excluding only `test_p09_outcomes_delivery_value.py` | 331 passed, 0 failed | Broadest clean backend count |
| Isolated `test_p09_outcomes_delivery_value.py` | 4 passed, 1 failed | Unrelated existing qualification fixture/date failure |

The final-equivalent backend total is therefore 335 passed and 1 failed. The one failure is the existing P09 delivery-realization test: its latest measurement is reported stale because the fixture freshness deadline is `2026-09-12` while this run date is `2026-09-14`. The failure is outside CHG-17 files and no P09 arithmetic, fixture, sample count, budget, sequencing, or gate semantics were changed.

Migration round-trip evidence on a disposable SQLite database:

- `alembic upgrade f1a2b3c4d5e6` → `alembic upgrade head`: all four operational-action tables present.
- `alembic downgrade f1a2b3c4d5e6`: all four operational-action tables absent.
- `alembic upgrade head`: exact version `c17a9e5b2f01`.

Static checks:

- `python -m compileall`: passed.
- `git diff --check`: passed.
- Changed action source forbidden-command scan: no subprocess, AI-agent, or remote-machine execution path.
- `ruff`: unavailable in the validation environment (`No such file or directory`); no substitute formatter/linter was installed.

