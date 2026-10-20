"""Legacy Service definitions, children and audit receipts survive revision backfill."""
import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


@pytest.mark.parametrize('count', [0, 1, 1001])
def test_service_backfill_restart_and_downgrade_preserve_existing_data(tmp_path, monkeypatch, count):
    source = Path(__file__).parent / 'alembic/versions/f6c2a9d4e8b1_add_service_edit_revision.py'
    spec = importlib.util.spec_from_file_location('service_edit_revision_migration', source)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    url = f"sqlite:///{tmp_path / 'legacy-services.db'}"
    engine = sa.create_engine(url)
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql('CREATE TABLE logical_services (id INTEGER PRIMARY KEY, name TEXT NOT NULL, version TEXT, config_json TEXT, license_key TEXT, is_deleted BOOLEAN NOT NULL DEFAULT 0)')
            connection.exec_driver_sql('CREATE UNIQUE INDEX ix_fixture_active_service ON logical_services(name) WHERE is_deleted = 0')
            connection.exec_driver_sql('CREATE TABLE service_secrets (id INTEGER PRIMARY KEY, service_id INTEGER NOT NULL REFERENCES logical_services(id) ON DELETE CASCADE, username TEXT, password BLOB)')
            connection.exec_driver_sql('CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, target_id TEXT, changes TEXT)')
            for identity in range(1, count + 1):
                connection.exec_driver_sql('INSERT INTO logical_services VALUES (?,?,?,?,?,?)',
                    (identity, f'Existing {identity}', 'legacy business version', '{"preserved":true}', 'synthetic fixture license', identity % 2))
                connection.exec_driver_sql('INSERT INTO service_secrets VALUES (?,?,?,?)', (identity, identity, 'Existing account', b'synthetic fixture bytes'))
                connection.exec_driver_sql('INSERT INTO audit_logs VALUES (?,?,?)', (identity, str(identity), '{"original":"receipt"}'))
            before = {table: connection.exec_driver_sql(f'SELECT * FROM {table} ORDER BY id').all()
                      for table in ('logical_services', 'service_secrets', 'audit_logs')}
            def indexes():
                return [(entry['name'], entry['column_names'], entry['unique'], str(entry['dialect_options'].get('sqlite_where', '')))
                        for entry in sa.inspect(connection).get_indexes('logical_services')]
            before_indexes = indexes()
            monkeypatch.setattr(migration, 'op', Operations(MigrationContext.configure(connection)))
            migration.upgrade()
            records = connection.exec_driver_sql('SELECT * FROM logical_services ORDER BY id').all()
            assert [tuple(row[:-1]) for row in records] == [tuple(row) for row in before['logical_services']]
            revisions = [row.edit_revision for row in records]
            assert len(set(revisions)) == count
            assert all(len(value) == 32 and all(char in '0123456789abcdef' for char in value) for value in revisions)
            assert next(column for column in sa.inspect(connection).get_columns('logical_services') if column['name'] == 'edit_revision')['nullable'] is False
            for table in ('service_secrets', 'audit_logs'):
                assert connection.exec_driver_sql(f'SELECT * FROM {table} ORDER BY id').all() == before[table]
            assert indexes() == before_indexes
            assert connection.exec_driver_sql('PRAGMA foreign_key_check').all() == []
            assert connection.exec_driver_sql('PRAGMA quick_check').scalar_one() == 'ok'
        engine.dispose()
        # A genuinely reopened engine must read identical opaque revisions.
        engine = sa.create_engine(url)
        with engine.begin() as connection:
            assert connection.exec_driver_sql('SELECT * FROM logical_services ORDER BY id').all() == records
            connection.exec_driver_sql('PRAGMA foreign_keys=ON')
            assert connection.exec_driver_sql('PRAGMA foreign_key_check').all() == []
            connection.exec_driver_sql('PRAGMA foreign_keys=OFF')
            monkeypatch.setattr(migration, 'op', Operations(MigrationContext.configure(connection)))
            migration.downgrade()
            for table, rows in before.items():
                assert connection.exec_driver_sql(f'SELECT * FROM {table} ORDER BY id').all() == rows
            assert indexes() == before_indexes
            assert connection.exec_driver_sql('PRAGMA foreign_key_check').all() == []
            assert connection.exec_driver_sql('PRAGMA quick_check').scalar_one() == 'ok'
    finally:
        engine.dispose()
