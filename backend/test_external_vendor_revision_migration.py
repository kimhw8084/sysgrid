"""External and Vendor revision backfills preserve existing rows and relationships."""
import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


@pytest.mark.parametrize("count", [0, 1, 1001])
def test_external_vendor_revision_backfill_preserves_existing_data(tmp_path, monkeypatch, count):
    source = Path(__file__).parent / "alembic/versions/b760f1d294a3_add_external_vendor_edit_revisions.py"
    spec = importlib.util.spec_from_file_location("external_vendor_revision_migration", source)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'legacy-modules.db'}")
    tables = ("external_entities", "external_links", "vendors", "vendor_personnel", "vendor_contracts")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE external_entities (id INTEGER PRIMARY KEY, name TEXT NOT NULL, is_deleted BOOLEAN NOT NULL DEFAULT 0)")
            connection.exec_driver_sql("CREATE TABLE external_links (id INTEGER PRIMARY KEY, external_entity_id INTEGER REFERENCES external_entities(id), purpose TEXT NOT NULL)")
            connection.exec_driver_sql("CREATE TABLE vendors (id INTEGER PRIMARY KEY, name TEXT NOT NULL, is_deleted BOOLEAN NOT NULL DEFAULT 0)")
            connection.exec_driver_sql("CREATE TABLE vendor_personnel (id INTEGER PRIMARY KEY, vendor_id INTEGER REFERENCES vendors(id), name TEXT NOT NULL, is_deleted BOOLEAN NOT NULL DEFAULT 0)")
            connection.exec_driver_sql("CREATE TABLE vendor_contracts (id INTEGER PRIMARY KEY, vendor_id INTEGER REFERENCES vendors(id), title TEXT NOT NULL, is_deleted BOOLEAN NOT NULL DEFAULT 0)")
            connection.exec_driver_sql("CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, target_id TEXT, changes TEXT)")
            for identity in range(1, count + 1):
                connection.exec_driver_sql("INSERT INTO external_entities VALUES (?,?,?)", (identity, f"External {identity}", identity % 2))
                connection.exec_driver_sql("INSERT INTO external_links VALUES (?,?,?)", (identity, identity, f"Link {identity}"))
                connection.exec_driver_sql("INSERT INTO vendors VALUES (?,?,?)", (identity, f"Vendor {identity}", identity % 2))
                connection.exec_driver_sql("INSERT INTO vendor_personnel VALUES (?,?,?,?)", (identity, identity, f"Person {identity}", identity % 2))
                connection.exec_driver_sql("INSERT INTO vendor_contracts VALUES (?,?,?,?)", (identity, identity, f"Contract {identity}", identity % 2))
                connection.exec_driver_sql("INSERT INTO audit_logs VALUES (?,?,?)", (identity, str(identity), "unchanged audit"))
            before = {table: connection.exec_driver_sql(f"SELECT * FROM {table} ORDER BY id").all() for table in (*tables, "audit_logs")}
            monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
            migration.upgrade()

            for table in tables:
                rows = connection.exec_driver_sql(f"SELECT * FROM {table} ORDER BY id").all()
                assert [tuple(row[:-1]) for row in rows] == [tuple(row) for row in before[table]]
                revisions = [row.edit_revision for row in rows]
                assert len(set(revisions)) == count
                assert all(len(value) == 32 and all(char in "0123456789abcdef" for char in value) for value in revisions)
                assert next(column for column in sa.inspect(connection).get_columns(table) if column["name"] == "edit_revision")["nullable"] is False
            assert connection.exec_driver_sql("SELECT * FROM audit_logs ORDER BY id").all() == before["audit_logs"]
            assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
            assert connection.exec_driver_sql("PRAGMA quick_check").scalar_one() == "ok"
            receipt_columns = {column["name"] for column in sa.inspect(connection).get_columns("module_bulk_receipts")}
            assert {"module", "target", "tenant_id", "actor_id", "operation_id", "request_hash", "result", "before_state", "post_state", "undo_result"} <= receipt_columns

            if count:
                prior = connection.exec_driver_sql("SELECT edit_revision FROM vendors WHERE id=1").scalar_one()
                connection.exec_driver_sql("UPDATE vendors SET name='Updated by a legacy writer' WHERE id=1")
                current = connection.exec_driver_sql("SELECT edit_revision FROM vendors WHERE id=1").scalar_one()
                assert current != prior
            connection.exec_driver_sql("INSERT INTO vendors (name) VALUES ('Inserted by a legacy writer')")
            inserted_revision = connection.exec_driver_sql("SELECT edit_revision FROM vendors WHERE name='Inserted by a legacy writer'").scalar_one()
            assert len(inserted_revision) == 32
            with pytest.raises(RuntimeError, match="must be preserved"):
                migration.downgrade()
            assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
            assert connection.exec_driver_sql("PRAGMA quick_check").scalar_one() == "ok"
    finally:
        engine.dispose()
