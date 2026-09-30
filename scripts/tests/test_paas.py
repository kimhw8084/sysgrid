"""The one-app deployment must preserve data on repeat starts and refuse drift."""

from __future__ import annotations

import argparse
from contextlib import closing
import importlib.util
import sqlite3
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "paas.py"
SPEC = importlib.util.spec_from_file_location("sysgrid_paas", SCRIPT)
assert SPEC and SPEC.loader
PAAS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PAAS)


class PaasTests(unittest.TestCase):
    def test_first_install_preserves_records_on_repeated_start(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sysgrid-paas-test-") as temporary:
            root = Path(temporary)
            frontend = root / "frontend"
            (frontend / "dist").mkdir(parents=True)
            (frontend / "dist" / "index.html").write_text("<html>test</html>")
            with patch.object(PAAS, "data_root", return_value=root), \
                    patch.object(PAAS, "FRONTEND", frontend):
                PAAS.configure(argparse.Namespace(
                    url="https://sysgrid.invalid", admin="owner", system_root="root-operator",
                    identity_header="X-Authenticated-User",
                ))
                config = PAAS.read_config()
                env = PAAS.runtime_env(config)
                PAAS.validate_runtime(env)
                PAAS.initialize(env)

                tenant_path = root / "sysgrid" / "tenants" / "sysgrid.db"
                with closing(sqlite3.connect(tenant_path)) as database, database:
                    database.execute("CREATE TABLE paas_preservation_probe (value TEXT)")
                    database.execute("INSERT INTO paas_preservation_probe VALUES ('retained')")
                PAAS.initialize(env)
                with closing(sqlite3.connect(tenant_path)) as database:
                    self.assertEqual(database.execute("SELECT value FROM paas_preservation_probe").fetchone()[0], "retained")
                with closing(sqlite3.connect(root / "sysgrid" / "config.db")) as database:
                    self.assertEqual(database.execute("SELECT count(*) FROM tenants").fetchone()[0], 1)
                self.assertEqual(PAAS.config_path().stat().st_mode & 0o777, 0o600)

                with closing(sqlite3.connect(root / "sysgrid" / "default.db")) as database, database:
                    database.execute("DELETE FROM alembic_version")
                with self.assertRaises(SystemExit):
                    PAAS.initialize(env)

    def test_setup_refuses_insecure_or_incomplete_input(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sysgrid-paas-test-") as temporary:
            root = Path(temporary)
            with patch.object(PAAS, "data_root", return_value=root):
                with self.assertRaises(SystemExit):
                    PAAS.configure(argparse.Namespace(
                        url="http://sysgrid.invalid", admin="owner", system_root="root-operator",
                        identity_header="X-Authenticated-User",
                    ))
                with self.assertRaises(SystemExit):
                    PAAS.configure(argparse.Namespace(
                        url="https://sysgrid.invalid", admin="owner", system_root="owner",
                        identity_header="X-Authenticated-User",
                    ))
                self.assertFalse(PAAS.config_path().exists())


if __name__ == "__main__":
    unittest.main()
