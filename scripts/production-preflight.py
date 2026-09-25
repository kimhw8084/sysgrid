#!/usr/bin/env python3
"""Run the production configuration and source validation gate without echoing env values."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CHECKS: list[dict[str, object]] = []
QUIET = False


def message(value: str) -> None:
    if not QUIET:
        print(value)


def record(name: str, passed: bool, detail: str) -> bool:
    CHECKS.append({"name": name, "status": "PASS" if passed else "FAIL", "detail": detail})
    return passed


def run(label: str, command: list[str], cwd: Path, *, env: dict[str, str] | None = None) -> bool:
    completed = subprocess.run(
        command,
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    passed = completed.returncode == 0
    if passed:
        message(f"PASS: {label}")
        detail = "completed"
    else:
        message(f"FAIL: {label} (exit {completed.returncode})")
        detail = f"exit_{completed.returncode}"
    return record(label, passed, detail)


def validate_production_configuration() -> bool:
    if str(ROOT / "backend") not in sys.path:
        sys.path.insert(0, str(ROOT / "backend"))
    try:
        current_directory = Path.cwd()
        with tempfile.TemporaryDirectory(prefix="sysgrid-config-preflight-") as isolated_cwd:
            os.chdir(isolated_cwd)
            try:
                from app.core.config import Settings
            finally:
                os.chdir(current_directory)

        configured = Settings(_env_file=None)
    except Exception as exc:
        message(f"FAIL: production configuration could not be loaded ({exc.__class__.__name__})")
        return record("production-configuration", False, f"load_error_{exc.__class__.__name__}")

    if not configured.is_production:
        message("FAIL: production configuration requires ENVIRONMENT=production")
        return record("production-configuration", False, "production_mode_required")

    errors = configured.production_guard_errors()
    if errors:
        message(f"FAIL: production configuration has {len(errors)} Settings guard error(s)")
        return record("production-configuration", False, f"settings_guard_errors_{len(errors)}")

    message(f"PASS: production configuration ({configured.startup_schema_policy})")
    return record("production-configuration", True, configured.startup_schema_policy)


def check_lockfiles() -> bool:
    missing = [
        relative for relative in ("frontend/package-lock.json", "backend/requirements.lock")
        if not (ROOT / relative).is_file()
    ]
    if missing:
        message("FAIL: deterministic dependency lock is missing")
        return record("dependency-locks", False, "missing_required_lock")
    message("PASS: deterministic dependency locks are present")
    return record("dependency-locks", True, "present")


def backend_test_environment(test_data_root: Path) -> dict[str, str]:
    environment = {
        name: os.environ[name]
        for name in ("PATH", "SYSTEMROOT")
        if name in os.environ
    }
    environment.update({
        "PYTHONPATH": str(ROOT / "backend"),
        "ENVIRONMENT": "test",
        "TESTING": "1",
        "BACKEND_CORS_ORIGINS": "*",
        "ALLOWED_HOSTS": "localhost,127.0.0.1,test,testserver",
        "IDENTITY_MODE": "development",
        "TRUSTED_PROXY_USER_HEADER": "X-Authenticated-User",
        "DATABASE_URL": f"sqlite+aiosqlite:///{test_data_root / 'default.db'}",
        "CONFIG_DATABASE_URL": f"sqlite+aiosqlite:///{test_data_root / 'config.db'}",
        "TENANT_STORAGE_ROOT": str(test_data_root / "tenants"),
        "PUBLIC_READONLY_ENABLED": "true",
        "ALLOW_PUBLIC_READONLY_IN_PRODUCTION": "false",
        "DEFAULT_USER_ID": "admin_root",
        "AUTO_ADMIN_USER_IDS": "admin_root",
        "ALLOW_AUTO_ADMIN_IN_PRODUCTION": "false",
        "SCHEDULE_PREVIEW_SIGNING_KEY": "development-only-schedule-preview-key",
        "AUTO_MIGRATE_ON_STARTUP": "true",
        "ALLOW_AUTO_MIGRATE_IN_PRODUCTION": "false",
        "LOG_LEVEL": "WARNING",
    })
    return environment


def frontend_check_environment() -> dict[str, str]:
    environment = {
        name: os.environ[name]
        for name in ("PATH", "SYSTEMROOT")
        if name in os.environ
    }
    environment.update({
        "VITE_API_BASE_URL": os.getenv("VITE_API_BASE_URL", "https://backend.invalid"),
        "VITE_IDENTITY_MODE": os.getenv("VITE_IDENTITY_MODE", "trusted_proxy"),
    })
    return environment


def frontend_unit_environment() -> dict[str, str]:
    return {
        name: os.environ[name]
        for name in ("PATH", "SYSTEMROOT")
        if name in os.environ
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="emit a sanitized machine-readable result")
    parser.add_argument("--config-only", action="store_true", help="validate Settings production policy without running build or tests")
    args = parser.parse_args(argv)

    CHECKS.clear()
    global QUIET
    QUIET = args.json
    config_ok = validate_production_configuration()
    if args.config_only:
        if args.json:
            print(json.dumps({
                "schema_version": 1,
                "status": "PASS" if config_ok else "FAIL",
                "checks": CHECKS,
            }, sort_keys=True))
        else:
            print("PRODUCTION CONFIGURATION PASSED" if config_ok else "UNSAFE PRODUCTION CONFIGURATION")
        return 0 if config_ok else 1

    locks_ok = check_lockfiles()
    frontend_env = frontend_check_environment()
    checks = [
        run("Frontend typecheck", ["npm", "run", "typecheck"], ROOT / "frontend", env=frontend_env),
        run("Frontend build", ["npm", "run", "build"], ROOT / "frontend", env=frontend_env),
        run("Operational contracts", ["npm", "run", "check:operational-contracts"], ROOT / "frontend", env=frontend_env),
        run(
            "Frontend unit tests",
            ["npm", "run", "test:unit"],
            ROOT / "frontend",
            env=frontend_unit_environment(),
        ),
    ]
    with tempfile.TemporaryDirectory(prefix="sysgrid-preflight-backend-") as backend_data:
        checks.append(run(
            "Backend tests",
            [sys.executable, "-m", "pytest", "-q"],
            ROOT / "backend",
            env=backend_test_environment(Path(backend_data)),
        ))

    success = config_ok and locks_ok and all(checks)
    if args.json:
        print(json.dumps({
            "schema_version": 1,
            "status": "PASS" if success else "FAIL",
            "checks": CHECKS,
        }, sort_keys=True))
    elif success:
        print("PRODUCTION PRE-FLIGHT PASSED. Complete the isolated snapshot, restore, migration and readiness lifecycle.")
    else:
        print("NOT READY FOR PRODUCTION")
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())
