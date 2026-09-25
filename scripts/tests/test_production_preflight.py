from __future__ import annotations

from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import tempfile
import unittest
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "production-preflight.py"
SPEC = importlib.util.spec_from_file_location("production_preflight", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def safe_environment() -> dict[str, str]:
    data_root = Path(tempfile.gettempdir()) / "sysgrid-preflight-contract-fixture"
    return {
        "ENVIRONMENT": "production",
        "BACKEND_CORS_ORIGINS": "https://frontend.invalid",
        "ALLOWED_HOSTS": "backend.invalid",
        "IDENTITY_MODE": "trusted_proxy",
        "TRUSTED_PROXY_USER_HEADER": "X-Authenticated-User",
        "DATABASE_URL": f"sqlite+aiosqlite:///{data_root / 'default.db'}",
        "CONFIG_DATABASE_URL": f"sqlite+aiosqlite:///{data_root / 'config.db'}",
        "TENANT_STORAGE_ROOT": str(data_root / "tenants"),
        "PUBLIC_READONLY_ENABLED": "false",
        "ALLOW_PUBLIC_READONLY_IN_PRODUCTION": "false",
        "DEFAULT_USER_ID": "svc-sysgrid",
        "AUTO_ADMIN_USER_IDS": "",
        "ALLOW_AUTO_ADMIN_IN_PRODUCTION": "false",
        "CONTROL_PLANE_ADMIN_USER_IDS": "ops-admin",
        "CONTROL_PLANE_BOOTSTRAP_ENABLED": "false",
        "CONTROL_PLANE_BOOTSTRAP_USER_ID": "",
        "SYSTEM_ROOT_USER_IDS": "system-root",
        "SCHEDULE_PREVIEW_SIGNING_KEY": "synthetic-deployment-key-0123456789abcdef",
        "PV1_RELEASE_CANDIDATE_SHA": "a" * 64,
        "PV1_RELEASE_ID": "synthetic-release-1",
        "AUTO_MIGRATE_ON_STARTUP": "false",
        "ALLOW_AUTO_MIGRATE_IN_PRODUCTION": "false",
    }


class ProductionPreflightTests(unittest.TestCase):
    def setUp(self) -> None:
        MODULE.CHECKS.clear()
        MODULE.QUIET = False

    def test_synthetic_safe_production_configuration_passes(self) -> None:
        with patch.dict(os.environ, safe_environment()):
            os.environ.pop("TESTING", None)
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertTrue(MODULE.validate_production_configuration())
        self.assertIn("PASS: production configuration (operator_managed)", output.getvalue())

    def test_unsafe_configuration_fails_without_echoing_secret_values(self) -> None:
        environment = safe_environment()
        environment["SCHEDULE_PREVIEW_SIGNING_KEY"] = "SENSITIVE-TEST-VALUE-DO-NOT-PRINT"
        environment["PV1_RELEASE_CANDIDATE_SHA"] = "invalid"
        with patch.dict(os.environ, environment):
            os.environ.pop("TESTING", None)
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertFalse(MODULE.validate_production_configuration())
        self.assertIn("Settings guard error(s)", output.getvalue())
        self.assertNotIn("SENSITIVE-TEST-VALUE-DO-NOT-PRINT", output.getvalue())

    def test_json_mode_emits_one_machine_readable_document(self) -> None:
        output = io.StringIO()
        with patch.object(MODULE, "validate_production_configuration", return_value=True), \
                patch.object(MODULE, "check_lockfiles", return_value=True), \
                patch.object(MODULE, "run", return_value=True), \
                redirect_stdout(output):
            self.assertEqual(MODULE.main(["--json"]), 0)
        report = json.loads(output.getvalue())
        self.assertEqual(report["status"], "PASS")

    def test_backend_tests_receive_synthetic_test_mode_not_production_secrets(self) -> None:
        sentinel = "SYNTHETIC-SECRET-MUST-NOT-CROSS-TEST-BOUNDARY"
        with patch.dict(os.environ, {
            **safe_environment(),
            "SCHEDULE_PREVIEW_SIGNING_KEY": sentinel,
            "CONTROL_PLANE_ADMIN_USER_IDS": sentinel,
        }):
            with tempfile.TemporaryDirectory(prefix="preflight-test-env-") as isolated_root:
                test_environment = MODULE.backend_test_environment(Path(isolated_root))
        self.assertEqual(test_environment["ENVIRONMENT"], "test")
        self.assertEqual(test_environment["TESTING"], "1")
        self.assertEqual(test_environment["IDENTITY_MODE"], "development")
        self.assertNotIn("PV1_RELEASE_CANDIDATE_SHA", test_environment)
        self.assertNotIn("PV1_RELEASE_ID", test_environment)
        self.assertNotIn("CONTROL_PLANE_ADMIN_USER_IDS", test_environment)
        self.assertNotIn("SYSTEM_ROOT_USER_IDS", test_environment)
        self.assertNotIn(sentinel, json.dumps(test_environment))
        self.assertIn("preflight-test-env-", test_environment["CONFIG_DATABASE_URL"])
        self.assertIn("preflight-test-env-", test_environment["TENANT_STORAGE_ROOT"])

    def test_frontend_checks_receive_only_public_build_configuration(self) -> None:
        sentinel = "SYNTHETIC-SECRET-MUST-NOT-CROSS-FRONTEND-BOUNDARY"
        with patch.dict(os.environ, {
            **safe_environment(),
            "SCHEDULE_PREVIEW_SIGNING_KEY": sentinel,
            "VITE_API_BASE_URL": "https://backend.invalid",
            "VITE_IDENTITY_MODE": "trusted_proxy",
        }):
            frontend_environment = MODULE.frontend_check_environment()
        self.assertEqual(frontend_environment["VITE_IDENTITY_MODE"], "trusted_proxy")
        self.assertNotIn(sentinel, json.dumps(frontend_environment))

    def test_frontend_unit_tests_do_not_receive_build_configuration(self) -> None:
        frontend_environment = MODULE.frontend_unit_environment()
        self.assertNotIn("VITE_API_BASE_URL", frontend_environment)
        self.assertNotIn("VITE_IDENTITY_MODE", frontend_environment)


if __name__ == "__main__":
    unittest.main()
