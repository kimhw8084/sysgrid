#!/usr/bin/env python3
"""Read-only, bounded storage and unresolved-operation checks for a platform scheduler.

History, command deduplication records and backups are preserved. This job never
retries an operational action or infers its outcome from elapsed time.
"""
from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import sqlite3
import sys
import time

import production_data_guard as guard

ROOT = Path(__file__).resolve().parents[1]
COUNTS = {
    'audit_records': ('audit_logs', 'SELECT COUNT(*) FROM audit_logs'),
    'unfinished_attempts': ('operational_action_attempts', "SELECT COUNT(*) FROM operational_action_attempts WHERE finished_at IS NULL"),
    'unknown_outcomes': ('operational_action_attempts', "SELECT COUNT(*) FROM operational_action_attempts WHERE status = 'OUTCOME_UNKNOWN'"),
    'pending_outbox': ('pv1_outbox_events', 'SELECT COUNT(*) FROM pv1_outbox_events WHERE published_at IS NULL'),
    'expired_command_records': ('pv1_idempotency_keys', "SELECT COUNT(*) FROM pv1_idempotency_keys WHERE expires_at < CURRENT_TIMESTAMP"),
    'expired_architecture_commands': ('pv1_architecture_commands', "SELECT COUNT(*) FROM pv1_architecture_commands WHERE expires_at < CURRENT_TIMESTAMP"),
}


def inspect_database(path: Path, min_free_bytes: int, required_tables: tuple[str, ...] = ()) -> dict:
    report: dict = {'status': 'FAIL', 'counts': {}}
    try:
        if not path.is_file():
            return {**report, 'reason': 'database_missing'}
        report['database_bytes'] = path.stat().st_size
        wal = Path(str(path) + '-wal')
        report['wal_bytes'] = wal.stat().st_size if wal.is_file() else 0
        report['free_bytes'] = shutil.disk_usage(path.parent).free
        deadline = time.monotonic() + 2
        with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=1)) as db:
            db.execute('PRAGMA query_only=ON')
            db.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
            db.execute('BEGIN')
            if db.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                return {**report, 'reason': 'integrity_failed'}
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not set(required_tables) <= tables:
                return {**report, 'reason': 'required_schema_missing'}
            for key, (table, query) in COUNTS.items():
                if table in tables:
                    report['counts'][key] = db.execute(query).fetchone()[0]
            db.rollback()
        report['status'] = 'PASS'
        if report['free_bytes'] < min_free_bytes:
            report.update(status='FAIL', reason='storage_below_free_space_floor')
        if report['counts'].get('unknown_outcomes', 0):
            report.update(status='FAIL', reason='unknown_outcomes_require_operator_review')
    except (OSError, sqlite3.Error):
        report.update(status='FAIL', reason='database_unverifiable')
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--min-free-mib', type=int, default=1024)
    parser.add_argument('--max-databases', type=int, default=100)
    args = parser.parse_args()
    if args.min_free_mib < 0 or not 1 <= args.max_databases <= 1000:
        parser.error('free-space floor must be nonnegative; database bound must be 1..1000')
    report: dict = {'schema': 'sysgrid.production.operations.v1', 'at': datetime.now(timezone.utc).isoformat(),
        'status': 'FAIL', 'automatic_deletion': False, 'automatic_action_retry': False, 'databases': []}
    try:
        sys.path.insert(0, str(ROOT / 'backend'))
        from app.core.config import Settings
        configured = Settings(_env_file=None)
        if not configured.is_production or configured.production_guard_errors():
            raise guard.DataGuardError('unsafe_configuration')
        audit = guard.audit_registry(config_db_url=configured.CONFIG_DATABASE_URL,
            default_db_url=configured.DATABASE_URL, backend_root=ROOT / 'backend')
        if audit['blocker_count']:
            raise guard.DataGuardError('registry_unverifiable')
        inventory = guard.discover_database_inventory(config_db_url=configured.CONFIG_DATABASE_URL,
            default_db_url=configured.DATABASE_URL, backend_root=ROOT / 'backend')['databases']
        if len(inventory) > args.max_databases:
            raise guard.DataGuardError('database_bound_exceeded')
        for entry in inventory:
            required = ('tenants', 'user_tenant_access') if entry['roles'] == ['config'] else ('audit_logs', 'operational_action_attempts')
            report['databases'].append(inspect_database(entry['source_path'], args.min_free_mib * 1024 * 1024, required))
        report['database_count'] = len(inventory)
        report['status'] = 'PASS' if report['databases'] and all(row['status'] == 'PASS' for row in report['databases']) else 'FAIL'
    except Exception as exc:
        # Errors must not disclose connection strings, identities, SQL or paths.
        report['reason'] = type(exc).__name__
    print(json.dumps(report, sort_keys=True))
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
