"""Asset guards preserve a populated parent table and its cascading dependants."""
import importlib.util
from pathlib import Path
import re

from alembic.migration import MigrationContext
from alembic.operations import Operations
import pytest
import sqlalchemy as sa


def test_asset_migration_is_additive_with_foreign_keys_enabled(tmp_path):
    path = Path(__file__).parent / 'alembic/versions/a7c4e9b216d0_add_asset_write_guards.py'
    spec = importlib.util.spec_from_file_location('asset_guard_migration', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert migration.down_revision == 'b4a9d8e17c23'
    engine = sa.create_engine('sqlite:///' + str(tmp_path / 'isolated-asset-migration.db'))
    with engine.begin() as connection:
        connection.exec_driver_sql('PRAGMA foreign_keys=ON')
        connection.exec_driver_sql('CREATE TABLE devices (id INTEGER PRIMARY KEY, name TEXT, owner TEXT, tenant_id INTEGER, is_deleted BOOLEAN, updated_at TEXT)')
        connection.exec_driver_sql('CREATE TABLE retained_children (id INTEGER PRIMARY KEY, device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE, value TEXT)')
        connection.exec_driver_sql('CREATE INDEX retained_device_name ON devices(name)')
        connection.exec_driver_sql("INSERT INTO devices VALUES (1, 'Legacy active', NULL, 1, 0, '2020-01-01 12:34:56'), (2, 'Legacy archived', 'Retained owner', 1, 1, '2020-02-02T01:02:03.123456')")
        connection.exec_driver_sql("INSERT INTO retained_children VALUES (1, 1, 'Preserved child'), (2, 2, 'Preserved archived history')")
        before = connection.exec_driver_sql('SELECT * FROM devices ORDER BY id').all()
        children = connection.exec_driver_sql('SELECT * FROM retained_children ORDER BY id').all()
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            assert connection.exec_driver_sql('SELECT id,name,owner,tenant_id,is_deleted,updated_at FROM devices ORDER BY id').all() == before
            assert connection.exec_driver_sql('SELECT * FROM retained_children ORDER BY id').all() == children
            assert connection.exec_driver_sql('PRAGMA foreign_key_check').all() == []
            assert 'retained_device_name' in {row[1] for row in connection.exec_driver_sql('PRAGMA index_list(devices)')}
            revisions = [row[0] for row in connection.exec_driver_sql('SELECT edit_revision FROM devices')]
            assert len(set(revisions)) == 2 and all(re.fullmatch('[0-9a-f]{32}', value) for value in revisions)
            connection.exec_driver_sql("INSERT INTO devices (id,name,tenant_id,is_deleted) VALUES (3,'Legacy writer',1,0)")
            inserted = connection.scalar(sa.text('SELECT edit_revision FROM devices WHERE id=3'))
            assert re.fullmatch('[0-9a-f]{32}', inserted)
            connection.exec_driver_sql("UPDATE devices SET owner='Peer' WHERE id=3")
            assert connection.scalar(sa.text('SELECT edit_revision FROM devices WHERE id=3')) != inserted
            with pytest.raises(RuntimeError, match='history must be preserved'):
                migration.downgrade()
            assert connection.exec_driver_sql('SELECT * FROM retained_children ORDER BY id').all() == children
    engine.dispose()
