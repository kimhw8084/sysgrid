from pathlib import Path
from contextlib import closing
import sqlite3

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.config import Tenant


def _sqlite_path(url: str) -> Path:
    prefix = "sqlite+aiosqlite:///"
    raw = url.removeprefix(prefix)
    return Path(raw).expanduser().resolve()


def _schema_definition(connection):
    result = []
    for kind, name, table, sql in connection.execute(
        "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name"
    ):
        if kind == "table" and sql:
            # Alembic/SQLAlchemy may emit table constraints in a different order
            # across processes. Preserve column order and every constraint's
            # complete definition; only the order of whole constraints differs.
            columns, constraints = [], []
            for line in sql.splitlines():
                if line.strip().startswith(("CONSTRAINT ", "FOREIGN KEY", "UNIQUE (", "PRIMARY KEY", "CHECK (")):
                    constraints.append(line.strip().rstrip(","))
                else:
                    columns.append(line)
            sql = (columns, sorted(constraints))
        result.append((kind, name, table, sql))
    return result


@pytest.mark.parametrize("alteration", ["column_order", "default", "foreign_key", "index"])
def test_schema_comparison_detects_changed_definitions(alteration):
    baseline = """CREATE TABLE sample (
        id INTEGER,
        peer_id INTEGER DEFAULT 0,
        PRIMARY KEY (id),
        FOREIGN KEY(peer_id) REFERENCES peer(id)
    )"""
    changed = {
        "column_order": baseline.replace("id INTEGER,\n        peer_id INTEGER DEFAULT 0,", "peer_id INTEGER DEFAULT 0,\n        id INTEGER,"),
        "default": baseline.replace("DEFAULT 0", "DEFAULT 1"),
        "foreign_key": baseline.replace("REFERENCES peer(id)", "REFERENCES other(id)"),
        "index": baseline,
    }[alteration]
    with closing(sqlite3.connect(":memory:")) as reference, closing(sqlite3.connect(":memory:")) as candidate:
        reference.execute(baseline)
        candidate.execute(changed)
        if alteration == "index":
            candidate.execute("CREATE INDEX ix_sample_peer ON sample(peer_id)")
        assert _schema_definition(reference) != _schema_definition(candidate)


def test_backend_tests_bind_settings_before_application_import_to_disposable_namespace():
    config_path = _sqlite_path(settings.CONFIG_DATABASE_URL)
    database_path = _sqlite_path(settings.DATABASE_URL)
    tenant_root = Path(settings.TENANT_STORAGE_ROOT).resolve()

    assert config_path.parent == database_path.parent == tenant_root.parent
    assert config_path.parent.name.startswith("sysgrid-pytest-")
    assert config_path.name == "config.db"
    assert database_path.name == "tenant.db"
    assert not config_path.is_relative_to(Path(__file__).resolve().parents[1])


@pytest.fixture(scope="module")
def prior_fixture_databases():
    return []


@pytest.mark.parametrize("iteration", range(3))
async def test_seeded_tenants_isolate_rows_schema_and_registry(
    seeded_admin_tenant, setup_db, migrated_tenant_template, prior_fixture_databases, iteration,
):
    async with setup_db[1]() as registry:
        tenants = (await registry.scalars(select(Tenant))).all()
        assert len(tenants) == 1
        assert tenants[0].id == seeded_admin_tenant["tenant_id"]
        path = _sqlite_path(tenants[0].db_url)
    assert path != migrated_tenant_template
    assert path not in prior_fixture_databases
    with closing(sqlite3.connect(path)) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute(
            "SELECT name FROM sqlite_master WHERE name = 'fixture_isolation_sentinel'"
        ).fetchall() == []
        assert connection.execute("SELECT COUNT(*) FROM operators").fetchone() == (1,)
        assert connection.execute("SELECT full_name FROM operators").fetchone() == ("Admin Root",)
        connection.execute("CREATE TABLE fixture_isolation_sentinel (value INTEGER NOT NULL)")
        connection.execute("INSERT INTO fixture_isolation_sentinel VALUES (?)", (iteration,))
        connection.execute("UPDATE operators SET full_name = 'mutated fixture'")
        connection.commit()
    for previous in prior_fixture_databases:
        with closing(sqlite3.connect(previous)) as connection:
            assert connection.execute("SELECT COUNT(*) FROM fixture_isolation_sentinel").fetchone() == (1,)
    with closing(sqlite3.connect(f"{migrated_tenant_template.as_uri()}?mode=ro", uri=True)) as template:
        assert template.execute("SELECT COUNT(*) FROM operators").fetchone() == (0,)
        assert template.execute(
            "SELECT name FROM sqlite_master WHERE name = 'fixture_isolation_sentinel'"
        ).fetchall() == []
    prior_fixture_databases.append(path)


def test_template_matches_an_independent_fresh_migration(migrated_tenant_template, tmp_path):
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from app.api.tenants import run_alembic_upgrade

    fresh = tmp_path / "independent-migration.db"
    success, error = run_alembic_upgrade(f"sqlite+aiosqlite:///{fresh}")
    assert success, error
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    heads = ScriptDirectory.from_config(config).get_heads()
    with closing(sqlite3.connect(fresh)) as reference, closing(
        sqlite3.connect(f"{migrated_tenant_template.as_uri()}?mode=ro", uri=True)
    ) as template:
        assert _schema_definition(template) == _schema_definition(reference)
        assert template.execute("SELECT version_num FROM alembic_version").fetchall() == [(heads[0],)]
        assert template.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert template.execute("PRAGMA foreign_key_check").fetchall() == []
