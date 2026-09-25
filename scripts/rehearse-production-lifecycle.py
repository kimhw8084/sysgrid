#!/usr/bin/env python3
"""Exercise the production lifecycle against disposable SQLite data and synthetic identities."""
from __future__ import annotations

from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile

import production_data_guard

ROOT = Path(__file__).resolve().parents[1]
LIFECYCLE = ROOT / "scripts" / "production-lifecycle.py"


def _production_environment(data_root: Path) -> dict[str, str]:
    data_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    tenant_root = data_root / "tenants"
    tenant_root.mkdir(mode=0o700)
    environment = {
        "PATH": os.environ.get("PATH", os.defpath),
        "PYTHONPATH": str(ROOT / "backend"),
        "ENVIRONMENT": "production",
        "BACKEND_CORS_ORIGINS": "https://frontend.invalid",
        "ALLOWED_HOSTS": "backend.invalid",
        "IDENTITY_MODE": "trusted_proxy",
        "TRUSTED_PROXY_USER_HEADER": "X-Authenticated-User",
        "DATABASE_URL": production_data_guard.sqlite_url_for_path(data_root / "default.db"),
        "CONFIG_DATABASE_URL": production_data_guard.sqlite_url_for_path(data_root / "config.db"),
        "TENANT_STORAGE_ROOT": str(tenant_root),
        "PUBLIC_READONLY_ENABLED": "false",
        "ALLOW_PUBLIC_READONLY_IN_PRODUCTION": "false",
        "DEFAULT_USER_ID": "svc-sysgrid-rehearsal",
        "AUTO_ADMIN_USER_IDS": "",
        "ALLOW_AUTO_ADMIN_IN_PRODUCTION": "false",
        "CONTROL_PLANE_ADMIN_USER_IDS": "synthetic-ops-admin",
        "CONTROL_PLANE_BOOTSTRAP_ENABLED": "false",
        "CONTROL_PLANE_BOOTSTRAP_USER_ID": "",
        "SYSTEM_ROOT_USER_IDS": "synthetic-system-root",
        "SCHEDULE_PREVIEW_SIGNING_KEY": "synthetic-rehearsal-key-0123456789abcdef",
        "PV1_RELEASE_CANDIDATE_SHA": hashlib.sha256(b"synthetic CHG-56 rehearsal source").hexdigest(),
        "PV1_RELEASE_ID": "synthetic-chg56-rehearsal-1",
        "AUTO_MIGRATE_ON_STARTUP": "false",
        "ALLOW_AUTO_MIGRATE_IN_PRODUCTION": "false",
    }
    return environment


def _create_synthetic_databases(data_root: Path, environment: dict[str, str]) -> list[Path]:
    default_path = data_root / "default.db"
    config_path = data_root / "config.db"
    tenant_path = data_root / "tenants" / "tenant-1.db"
    for path in (default_path, tenant_path):
        with closing(sqlite3.connect(path)) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("CREATE TABLE rehearsal_fixture (value TEXT NOT NULL)")
            connection.execute("INSERT INTO rehearsal_fixture(value) VALUES ('synthetic-only')")
            connection.commit()
    with closing(sqlite3.connect(config_path)) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute(
            "CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT, db_url TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1)"
        )
        connection.execute(
            "INSERT INTO tenants(id, name, db_url, is_active) VALUES (?, ?, ?, ?)",
            (1, "Synthetic Tenant", production_data_guard.sqlite_url_for_path(tenant_path), 1),
        )
        connection.commit()
    return [config_path, default_path, tenant_path]


def _invoke_qualification(environment: dict[str, str], backup_root: Path) -> tuple[int, dict[str, object]]:
    completed = subprocess.run(
        [
            sys.executable,
            str(LIFECYCLE),
            "qualify",
            "--backup-root",
            str(backup_root),
        ],
        cwd=str(ROOT),
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    try:
        payload = json.loads(completed.stdout.strip())
    except json.JSONDecodeError:
        payload = {"status": "FAIL", "blockers": ["lifecycle_report_invalid"]}
    return completed.returncode, payload


def run_rehearsal() -> dict[str, object]:
    checks: list[dict[str, object]] = []
    with tempfile.TemporaryDirectory(prefix="sysgrid-production-lifecycle-rehearsal-") as temporary:
        root = Path(temporary)
        data_root = root / "synthetic-data"
        environment = _production_environment(data_root)
        live_databases = _create_synthetic_databases(data_root, environment)
        fingerprints_before = {
            path.name: production_data_guard.sqlite_logical_fingerprint(path)
            for path in live_databases
        }
        backup_root = root / "backups"

        first_code, first = _invoke_qualification(environment, backup_root)
        second_code, second = _invoke_qualification(environment, backup_root)
        if first_code or second_code or first.get("status") != "PASS" or second.get("status") != "PASS":
            raise RuntimeError("synthetic_qualification_failed")
        if first.get("snapshot_id") == second.get("snapshot_id"):
            raise RuntimeError("repeated_snapshot_identity_not_unique")
        for payload in (first, second):
            text = json.dumps(payload)
            if str(root) in text or "sqlite+aiosqlite" in text or "synthetic-rehearsal-key" in text:
                raise RuntimeError("lifecycle_report_contains_sensitive_fixture_material")
            if payload.get("company_domain_proof") != "NOT_PROVEN":
                raise RuntimeError("source_qualification_claimed_field_proof")
        _record = [
            "transaction_consistent_snapshot",
            "isolated_restore_integrity",
            "migration_rehearsal",
            "rollback_recovery_preparation",
            "startup_readiness_contract",
            "live_source_invariance",
        ]
        for check_name in _record:
            for payload in (first, second):
                if not any(item.get("name") == check_name and item.get("status") == "PASS"
                           for item in payload.get("checks", [])):
                    raise RuntimeError("required_lifecycle_step_missing")
        snapshots = sorted(path for path in backup_root.iterdir() if path.name.startswith("snapshot-"))
        if len(snapshots) != 2:
            raise RuntimeError("repeat_rehearsal_snapshot_count_mismatch")
        if list(backup_root.glob("*.partial")) or list(backup_root.glob("*.tmp")):
            raise RuntimeError("rehearsal_left_partial_artifacts")
        if any((snapshot / "manifest.json").is_file() is False for snapshot in snapshots):
            raise RuntimeError("rehearsal_snapshot_manifest_missing")
        _record.append("repeat_rehearsal_and_cleanup")
        checks.extend({"name": name, "status": "PASS"} for name in _record)

        unsafe_environment = dict(environment)
        unsafe_environment["TRUSTED_PROXY_USER_HEADER"] = "X-User-Id"
        unsafe_backup_root = root / "unsafe-backups"
        unsafe_code, unsafe = _invoke_qualification(unsafe_environment, unsafe_backup_root)
        if unsafe_code == 0 or unsafe.get("status") != "FAIL" or unsafe_backup_root.exists():
            raise RuntimeError("unsafe_configuration_did_not_fail_before_snapshot")
        if environment["SCHEDULE_PREVIEW_SIGNING_KEY"] in json.dumps(unsafe):
            raise RuntimeError("unsafe_configuration_report_exposed_synthetic_secret")
        checks.append({"name": "unsafe_configuration_fail_closed", "status": "PASS"})

        manifest = json.loads((snapshots[0] / "manifest.json").read_text(encoding="utf-8"))
        damaged_entry = manifest["databases"][0]
        damaged_path = snapshots[0] / damaged_entry["relative_path"]
        damaged_path.write_bytes(damaged_path.read_bytes() + b"tamper")
        target_root = root / "tampered-restore-target"
        try:
            production_data_guard.restore_snapshot(snapshot_dir=snapshots[0], target_root=target_root)
        except production_data_guard.DataGuardError:
            pass
        else:
            raise RuntimeError("tampered_restore_material_was_accepted")
        if target_root.exists() or target_root.with_name(target_root.name + ".partial").exists():
            raise RuntimeError("tampered_restore_created_ambiguous_target")
        checks.append({"name": "tampered_restore_fail_closed", "status": "PASS"})

        fingerprints_after = {
            path.name: production_data_guard.sqlite_logical_fingerprint(path)
            for path in live_databases
        }
        if fingerprints_before != fingerprints_after:
            raise RuntimeError("synthetic_live_source_logical_fingerprint_changed")
        checks.append({"name": "rehearsal_fixture_source_invariance", "status": "PASS"})

    return {
        "schema_version": 1,
        "status": "PASS",
        "scope": "synthetic_temporary_data_only",
        "company_domain_proof": "NOT_PROVEN",
        "checks": checks,
    }


def main() -> int:
    try:
        payload = run_rehearsal()
    except Exception as exc:
        payload = {
            "schema_version": 1,
            "status": "FAIL",
            "scope": "synthetic_temporary_data_only",
            "company_domain_proof": "NOT_PROVEN",
            "blockers": [f"rehearsal_{exc.__class__.__name__}"],
        }
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
    return 0 if payload["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
