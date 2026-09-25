from __future__ import annotations

from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
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

    def test_backend_deployment_command_is_an_explicit_bounded_test_set(self) -> None:
        expected = (
            "test_production_startup_policy.py",
            "test_startup_migrations.py",
            "test_migration_graph.py",
            "test_p11_legacy_migration.py",
        )
        self.assertEqual(MODULE.BACKEND_DEPLOYMENT_TESTS, expected)
        self.assertEqual(
            MODULE.backend_deployment_test_command(),
            [sys.executable, "-m", "pytest", "-q", *expected],
        )
        self.assertNotEqual(
            MODULE.backend_deployment_test_command(),
            [sys.executable, "-m", "pytest", "-q"],
        )

    def test_backend_tests_receive_synthetic_test_mode_not_production_secrets(self) -> None:
        sentinel = "SYNTHETIC-SECRET-MUST-NOT-CROSS-TEST-BOUNDARY"
        caller_environment = {
            "PATH": "/synthetic/bin",
            "ENVIRONMENT": "production",
            "TESTING": "0",
            "DATABASE_URL": "sqlite:////production/default.db",
            "CONFIG_DATABASE_URL": "sqlite:////production/config.db",
            "TENANT_STORAGE_ROOT": "/production/tenant-data",
            "IDENTITY_MODE": "trusted_proxy",
            "DEFAULT_USER_ID": "production-service-identity",
            "AUTO_ADMIN_USER_IDS": "production-admin",
            "SCHEDULE_PREVIEW_SIGNING_KEY": sentinel,
            "CONTROL_PLANE_ADMIN_USER_IDS": sentinel,
            "SYSTEM_ROOT_USER_IDS": sentinel,
            "PV1_RELEASE_CANDIDATE_SHA": sentinel,
            "PV1_RELEASE_ID": sentinel,
            "AWS_SECRET_ACCESS_KEY": sentinel,
            "ARBITRARY_ENV_SENTINEL": sentinel,
        }
        with patch.dict(os.environ, caller_environment, clear=True):
            with tempfile.TemporaryDirectory(prefix="preflight-test-env-") as isolated_root:
                test_environment = MODULE.backend_test_environment(Path(isolated_root))
        self.assertEqual(test_environment["ENVIRONMENT"], "test")
        self.assertEqual(test_environment["TESTING"], "1")
        self.assertEqual(test_environment["IDENTITY_MODE"], "development")
        self.assertEqual(test_environment["DEFAULT_USER_ID"], "admin_root")
        self.assertEqual(test_environment["AUTO_ADMIN_USER_IDS"], "admin_root")
        self.assertNotEqual(test_environment["DATABASE_URL"], caller_environment["DATABASE_URL"])
        self.assertNotEqual(test_environment["CONFIG_DATABASE_URL"], caller_environment["CONFIG_DATABASE_URL"])
        for name in (
            "PV1_RELEASE_CANDIDATE_SHA",
            "PV1_RELEASE_ID",
            "CONTROL_PLANE_ADMIN_USER_IDS",
            "SYSTEM_ROOT_USER_IDS",
            "AWS_SECRET_ACCESS_KEY",
            "ARBITRARY_ENV_SENTINEL",
        ):
            self.assertNotIn(name, test_environment)
        self.assertNotIn(sentinel, json.dumps(test_environment))
        self.assertIn("preflight-test-env-", test_environment["CONFIG_DATABASE_URL"])
        self.assertIn("preflight-test-env-", test_environment["TENANT_STORAGE_ROOT"])

    def test_backend_deployment_failure_fails_preflight_without_leaking_output_or_environment(self) -> None:
        secret = "SYNTHETIC-PRODUCTION-SECRET-DO-NOT-PRINT"
        child_stdout = "CHILD-STDOUT-MUST-NOT-PRINT"
        child_stderr = "CHILD-STDERR-MUST-NOT-PRINT"
        arbitrary_value = "ARBITRARY-ENV-MUST-NOT-PRINT"
        backend_command = MODULE.backend_deployment_test_command()
        backend_calls: list[dict[str, object]] = []

        def fake_run(command, *, cwd, env, capture_output, text, check):
            self.assertTrue(capture_output)
            self.assertTrue(text)
            self.assertFalse(check)
            if command == backend_command:
                backend_calls.append({"cwd": cwd, "env": env})
                return subprocess.CompletedProcess(command, 17, stdout=child_stdout, stderr=child_stderr)
            return subprocess.CompletedProcess(command, 0, stdout=child_stdout, stderr=child_stderr)

        output = io.StringIO()
        with patch.dict(os.environ, {
            "PATH": "/synthetic/bin",
            "SCHEDULE_PREVIEW_SIGNING_KEY": secret,
            "PV1_RELEASE_CANDIDATE_SHA": secret,
            "ARBITRARY_ENV_SENTINEL": arbitrary_value,
        }, clear=True), \
                patch.object(MODULE, "validate_production_configuration", return_value=True), \
                patch.object(MODULE, "check_lockfiles", return_value=True), \
                patch.object(MODULE.subprocess, "run", side_effect=fake_run), \
                redirect_stdout(output):
            self.assertEqual(MODULE.main(["--json"]), 1)

        report_text = output.getvalue()
        report = json.loads(report_text)
        self.assertEqual(report["status"], "FAIL")
        backend_check = next(check for check in report["checks"] if check["name"] == "Backend deployment tests")
        self.assertEqual(backend_check["status"], "FAIL")
        self.assertEqual(backend_check["detail"], "exit_17")
        self.assertEqual(len(backend_calls), 1)
        self.assertEqual(backend_calls[0]["cwd"], MODULE.ROOT / "backend")
        self.assertEqual(backend_calls[0]["env"]["ENVIRONMENT"], "test")
        for value in (secret, child_stdout, child_stderr, arbitrary_value):
            self.assertNotIn(value, report_text)

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
