import importlib.util
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location('production_operations', SCRIPTS / 'production-operations.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class OperationsTests(unittest.TestCase):
    def test_asset_replay_history_is_counted_and_never_deleted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'tenant.db'
            with sqlite3.connect(path) as db:
                db.executescript("CREATE TABLE asset_write_receipts (id TEXT); INSERT INTO asset_write_receipts VALUES ('retained-command');")
            before = path.read_bytes()
            result = MODULE.inspect_database(path, 0)
            self.assertEqual(result['status'], 'PASS')
            self.assertEqual(result['counts']['asset_command_records'], 1)
            self.assertEqual(path.read_bytes(), before)

    def test_preserves_expired_deduplication_history_and_unresolved_attempts(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'tenant.db'
            with sqlite3.connect(path) as db:
                db.executescript("""
                    CREATE TABLE operational_action_attempts (finished_at TEXT, status TEXT);
                    INSERT INTO operational_action_attempts VALUES (NULL, 'OUTCOME_UNKNOWN'), ('2026-01-01', 'COMPLETED');
                    CREATE TABLE pv1_idempotency_keys (expires_at TEXT);
                    INSERT INTO pv1_idempotency_keys VALUES ('2000-01-01');
                    CREATE TABLE audit_logs (private_value TEXT);
                    INSERT INTO audit_logs VALUES ('private-preserved-value');
                """)
            before = path.read_bytes()
            result = MODULE.inspect_database(path, 0)
            self.assertEqual(result['status'], 'FAIL')
            self.assertEqual(result['counts'], {'unfinished_attempts': 1, 'unknown_outcomes': 1, 'expired_command_records': 1, 'audit_records': 1})
            self.assertEqual(path.read_bytes(), before)
            self.assertNotIn('private-preserved-value', str(result))

    def test_live_attempt_is_reported_without_being_declared_stuck(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'tenant.db'
            with sqlite3.connect(path) as db:
                db.executescript("CREATE TABLE operational_action_attempts (finished_at TEXT, status TEXT); INSERT INTO operational_action_attempts VALUES (NULL, 'CLAIMED');")
            result = MODULE.inspect_database(path, 0)
            self.assertEqual(result['status'], 'PASS')
            self.assertEqual(result['counts'], {'unfinished_attempts': 1, 'unknown_outcomes': 0})

    def test_missing_corrupt_and_low_capacity_are_failures_without_path_disclosure(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'private.db'
            self.assertEqual(MODULE.inspect_database(path, 0)['reason'], 'database_missing')
            self.assertFalse(path.exists())
            path.write_bytes(b'not a database')
            result = MODULE.inspect_database(path, 0)
            self.assertEqual(result['status'], 'FAIL')
            self.assertNotIn(directory, str(result))
            path.unlink()
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE retained (value TEXT)')
            result = MODULE.inspect_database(path, 10**30)
            self.assertEqual(result['reason'], 'storage_below_free_space_floor')
            self.assertEqual(MODULE.inspect_database(path, 0)['status'], 'PASS')
            self.assertEqual(MODULE.inspect_database(path, 0, ('audit_logs',))['reason'], 'required_schema_missing')


if __name__ == '__main__':
    unittest.main()
