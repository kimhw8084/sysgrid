"""Existing monitors, child history and constraints survive revision backfill."""
import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


@pytest.mark.parametrize('count', [0, 1, 1001])
def test_revision_backfill_and_downgrade_preserve_existing_data(tmp_path, monkeypatch, count):
    source = Path(__file__).parent / 'alembic/versions/d4a7b2c8e1f0_add_monitoring_edit_revision.py'
    spec = importlib.util.spec_from_file_location('monitoring_edit_revision_migration', source)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'existing.db'}")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql('CREATE TABLE monitoring_items (id INTEGER PRIMARY KEY, title TEXT NOT NULL, version INTEGER NOT NULL, is_deleted BOOLEAN NOT NULL DEFAULT 0)')
            connection.exec_driver_sql('CREATE UNIQUE INDEX ix_fixture_active_title ON monitoring_items(title) WHERE is_deleted = 0')
            connection.exec_driver_sql('CREATE TABLE monitoring_history (id INTEGER PRIMARY KEY, monitoring_item_id INTEGER NOT NULL REFERENCES monitoring_items(id) ON DELETE CASCADE, snapshot TEXT NOT NULL)')
            connection.exec_driver_sql('CREATE TABLE monitoring_owners (id INTEGER PRIMARY KEY, monitoring_item_id INTEGER NOT NULL REFERENCES monitoring_items(id) ON DELETE CASCADE, name TEXT NOT NULL)')
            for identity in range(1, count + 1):
                connection.exec_driver_sql('INSERT INTO monitoring_items(id,title,version) VALUES (?,?,?)', (identity, f'Existing {identity}', 7))
                connection.exec_driver_sql('INSERT INTO monitoring_history VALUES (?,?,?)', (identity, identity, 'Historical snapshot unchanged'))
                connection.exec_driver_sql('INSERT INTO monitoring_owners VALUES (?,?,?)', (identity, identity, 'Existing owner'))
            before = {table: connection.exec_driver_sql(f'SELECT * FROM {table} ORDER BY id').all()
                      for table in ('monitoring_items', 'monitoring_history', 'monitoring_owners')}
            def index_definitions():
                return [(index['name'], index['column_names'], index['unique'], str(index['dialect_options'].get('sqlite_where', '')))
                        for index in sa.inspect(connection).get_indexes('monitoring_items')]
            indexes = index_definitions()
            monkeypatch.setattr(migration, 'op', Operations(MigrationContext.configure(connection)))
            migration.upgrade()
            records = connection.exec_driver_sql('SELECT id,title,version,is_deleted,edit_revision FROM monitoring_items ORDER BY id').all()
            assert [tuple(row[:4]) for row in records] == [tuple(row) for row in before['monitoring_items']]
            revisions = [row.edit_revision for row in records]
            assert len(set(revisions)) == count
            assert all(len(value) == 32 and all(char in '0123456789abcdef' for char in value) for value in revisions)
            assert next(column for column in sa.inspect(connection).get_columns('monitoring_items') if column['name'] == 'edit_revision')['nullable'] is False
            for table in ('monitoring_history', 'monitoring_owners'):
                assert connection.exec_driver_sql(f'SELECT * FROM {table} ORDER BY id').all() == before[table]
            assert connection.exec_driver_sql('PRAGMA foreign_key_check').all() == []
            assert connection.exec_driver_sql('PRAGMA quick_check').scalar_one() == 'ok'
            assert index_definitions() == indexes
            if count:
                with connection.begin_nested(), pytest.raises(sa.exc.IntegrityError, match='UNIQUE constraint failed'):
                    connection.exec_driver_sql('INSERT INTO monitoring_items(title,version,edit_revision) VALUES (?,?,?)', ('Existing 1', 1, 'a' * 32))
            migration.downgrade()
            for table, rows in before.items():
                assert connection.exec_driver_sql(f'SELECT * FROM {table} ORDER BY id').all() == rows
            assert connection.exec_driver_sql('PRAGMA foreign_key_check').all() == []
            assert 'edit_revision' not in {column['name'] for column in sa.inspect(connection).get_columns('monitoring_items')}
            assert index_definitions() == indexes
    finally:
        engine.dispose()
