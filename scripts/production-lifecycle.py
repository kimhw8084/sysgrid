#!/usr/bin/env python3
"""Source-side production qualification and explicit runtime readiness probe."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import corporate_publishability_guard  # noqa: E402
import production_data_guard  # noqa: E402

STARTUP_WAIT_SECONDS = 20
STARTUP_POLL_SECONDS = 0.25


class LifecycleFailure(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _record(checks: list[dict[str, Any]], name: str, status: str, **detail: Any) -> None:
    checks.append({"name": name, "status": status, **detail})


def _runtime_versions() -> tuple[bool, dict[str, int]]:
    versions: dict[str, int] = {"python_major": sys.version_info.major, "python_minor": sys.version_info.minor}
    if sys.version_info < (3, 11):
        return False, versions
    for binary, key, minimum in (("node", "node_major", 20), ("npm", "npm_major", 9)):
        executable = shutil.which(binary)
        if not executable:
            return False, versions
        completed = subprocess.run(
            [executable, "--version"], capture_output=True, text=True, check=False
        )
        match = re.search(r"(?:v)?(\d+)", completed.stdout.strip()) if completed.returncode == 0 else None
        if not match:
            return False, versions
        versions[key] = int(match.group(1))
        if versions[key] < minimum:
            return False, versions
    return True, versions


def _production_settings() -> Any:
    if str(BACKEND) not in sys.path:
        sys.path.insert(0, str(BACKEND))
    current_directory = Path.cwd()
    with tempfile.TemporaryDirectory(prefix="sysgrid-lifecycle-config-") as isolated_cwd:
        os.chdir(isolated_cwd)
        try:
            from app.core.config import Settings
        finally:
            os.chdir(current_directory)

    return Settings(_env_file=None)


def _identity() -> dict[str, str] | None:
    return production_data_guard.source_identity_from_environment()


def _logical_fingerprints(config_url: str, default_url: str) -> dict[str, str]:
    inventory = production_data_guard.discover_database_inventory(
        config_db_url=config_url,
        default_db_url=default_url,
        backend_root=BACKEND,
    )
    result: dict[str, str] = {}
    for entry in inventory["databases"]:
        role_key = ",".join(entry["roles"])
        result[role_key] = production_data_guard.sqlite_logical_fingerprint(entry["source_path"])
    return result


def _synthetic_service_env(data_root: Path, port: int, backend_root: Path) -> dict[str, str]:
    data_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    tenant_root = data_root / "tenants"
    tenant_root.mkdir(mode=0o700, exist_ok=True)
    candidate_sha = os.getenv("PV1_RELEASE_CANDIDATE_SHA", "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", candidate_sha):
        candidate_sha = "a" * 64
    release_id = os.getenv("PV1_RELEASE_ID", "").strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", release_id):
        release_id = "synthetic-local-readiness"
    environment = {
        "PATH": os.environ.get("PATH", os.defpath),
        "PYTHONPATH": str(backend_root),
        **({"SYSTEMROOT": os.environ["SYSTEMROOT"]} if os.name == "nt" and "SYSTEMROOT" in os.environ else {}),
        "ENVIRONMENT": "production",
        "PORT": str(port),
        "BACKEND_CORS_ORIGINS": "https://frontend.invalid",
        "ALLOWED_HOSTS": "localhost,127.0.0.1",
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
        "SCHEDULE_PREVIEW_SIGNING_KEY": "synthetic-lifecycle-key-0123456789abcdef",
        "PV1_RELEASE_CANDIDATE_SHA": candidate_sha,
        "PV1_RELEASE_ID": release_id,
        "AUTO_MIGRATE_ON_STARTUP": "false",
        "ALLOW_AUTO_MIGRATE_IN_PRODUCTION": "false",
        "LOG_LEVEL": "WARNING",
    }
    return environment


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _get_json(opener: Any, url: str, timeout: float) -> tuple[int, dict[str, Any] | None]:
    request = Request(url, headers={"Accept": "application/json"}, method="GET")
    try:
        with opener.open(request, timeout=timeout) as response:
            status = int(response.status)
            content_type = response.headers.get("content-type", "").lower()
            if status != 200 or "application/json" not in content_type:
                return status, None
            payload = json.loads(response.read().decode("utf-8"))
            return status, payload if isinstance(payload, dict) else None
    except HTTPError as exc:
        return int(exc.code), None
    except (URLError, TimeoutError, OSError, UnicodeDecodeError, json.JSONDecodeError):
        return 0, None


def probe_readiness(base_url: str, *, timeout: float = 5.0) -> dict[str, Any]:
    parsed = urlsplit(base_url.strip())
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        return {"status": "FAIL", "reason": "invalid_runtime_origin"}

    origin = urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))
    opener = build_opener(_NoRedirect())
    health_status, health = _get_json(opener, f"{origin}/api/v1/health", timeout)
    if health_status != 200 or not health or health.get("alive") is not True or health.get("status") != "online":
        return {"status": "FAIL", "reason": "health_check_failed", "http_status": health_status}

    readiness_status, readiness = _get_json(opener, f"{origin}/api/v1/readiness", timeout)
    dependencies = readiness.get("dependencies") if readiness else None
    ready = (
        readiness_status == 200
        and readiness is not None
        and readiness.get("status") == "ready"
        and isinstance(dependencies, dict)
        and {"config_database", "default_database", "production_guard"}.issubset(dependencies)
        and all(
            isinstance(dependencies[key], dict) and dependencies[key].get("ready") is True
            for key in ("config_database", "default_database", "production_guard")
        )
    )
    if not ready:
        return {"status": "FAIL", "reason": "readiness_check_failed", "http_status": readiness_status}
    return {"status": "PASS", "health_http_status": health_status, "readiness_http_status": readiness_status}


def _local_startup_probe(repo_root: Path, temporary_root: Path) -> dict[str, Any]:
    probe_root = temporary_root / "local-service"
    probe_root.mkdir(mode=0o700)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = int(listener.getsockname()[1])

    child_env = _synthetic_service_env(probe_root / "data", port, repo_root / "backend")
    command = [
        sys.executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
        "--log-level",
        "warning",
    ]
    process = subprocess.Popen(
        command,
        cwd=str(temporary_root),
        env=child_env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.monotonic() + STARTUP_WAIT_SECONDS
        last_result: dict[str, Any] = {"status": "FAIL", "reason": "startup_deadline_exceeded"}
        while time.monotonic() < deadline:
            if process.poll() is not None:
                return {"status": "FAIL", "reason": "service_process_exited"}
            last_result = probe_readiness(f"http://127.0.0.1:{port}", timeout=1.0)
            if last_result["status"] == "PASS":
                return {"status": "PASS", "health_http_status": 200, "readiness_http_status": 200}
            if last_result.get("http_status") not in (None, 0):
                return last_result
            time.sleep(STARTUP_POLL_SECONDS)
        return last_result
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def qualify(*, repo_root: Path, backup_root: Path) -> dict[str, Any]:
    repo_root = repo_root.expanduser().resolve()
    backup_root = backup_root.expanduser().resolve()
    checks: list[dict[str, Any]] = []
    blockers: list[str] = []
    report: dict[str, Any] = {
        "schema_version": 1,
        "scope": "source_side_only",
        "company_domain_proof": "NOT_PROVEN",
        "source_identity": None,
        "checks": checks,
        "blockers": blockers,
    }
    phase = "source_runtime_prerequisites"
    try:
        identity = _identity()
        report["source_identity"] = identity
        versions_ok, versions = _runtime_versions()
        required_paths = (
            "backend/requirements.lock",
            "backend/requirements.txt",
            "frontend/package.json",
            "frontend/package-lock.json",
        )
        missing_paths = [path for path in required_paths if not (repo_root / path).is_file()]
        if not versions_ok or missing_paths:
            raise LifecycleFailure("runtime_or_source_prerequisites_failed")
        _record(checks, phase, "PASS", versions=versions)

        phase = "corporate_publish_contract"
        guard = corporate_publishability_guard.Guard(repo_root)
        guard_results = guard.run()
        failures = sum(result.status == "FAIL" for result in guard_results)
        warnings = sum(result.status == "WARN" for result in guard_results)
        if failures:
            raise LifecycleFailure("corporate_publishability_guard_failed")
        _record(checks, "lock_and_publish_contract", "PASS", warning_count=warnings)

        phase = "production_configuration"
        configured = _production_settings()
        if not configured.is_production:
            raise LifecycleFailure("production_mode_required")
        config_errors = configured.production_guard_errors()
        if config_errors:
            raise LifecycleFailure("production_settings_guard_failed")
        _record(checks, phase, "PASS", startup_schema_policy=configured.startup_schema_policy)

        config_url = os.getenv("CONFIG_DATABASE_URL", "").strip()
        default_url = os.getenv("DATABASE_URL", "").strip()
        if not config_url or not default_url:
            raise LifecycleFailure("persistent_database_configuration_missing")

        phase = "tenant_registry_audit"
        audit = production_data_guard.audit_registry(
            config_db_url=config_url,
            default_db_url=default_url,
            backend_root=repo_root / "backend",
        )
        if audit["blocker_count"]:
            raise LifecycleFailure("tenant_registry_audit_failed")
        _record(checks, phase, "PASS", registry_entry_count=audit["registry_entry_count"],
                omitted_inactive_count=audit["omittable_inactive_count"])

        phase = "live_source_fingerprint_before"
        fingerprints_before = _logical_fingerprints(config_url, default_url)
        _record(checks, "live_source_fingerprint_before", "PASS", database_count=len(fingerprints_before))

        operation_id = production_data_guard.new_operation_id()
        report["operation_id"] = operation_id
        phase = "transaction_consistent_snapshot"
        snapshot = production_data_guard.create_snapshot(
            output_root=backup_root,
            config_db_url=config_url,
            default_db_url=default_url,
            backend_root=repo_root / "backend",
            operation_id=operation_id,
        )
        manifest = production_data_guard.load_and_validate_manifest(snapshot)
        if manifest.get("source_identity") != identity:
            raise LifecycleFailure("snapshot_source_identity_mismatch")
        _record(checks, phase, "PASS", database_count=manifest["database_count"], snapshot_id=snapshot.name)
        report["snapshot_id"] = snapshot.name

        phase = "isolated_restore_integrity"
        with tempfile.TemporaryDirectory(prefix="sysgrid-lifecycle-") as temporary:
            isolated_root = Path(temporary)
            restore_target = isolated_root / "restore"
            restored = production_data_guard.restore_snapshot(snapshot_dir=snapshot, target_root=restore_target)
            restore_record = json.loads((restored / "restore-record.json").read_text(encoding="utf-8"))
            if restore_record.get("source_identity") != identity:
                raise LifecycleFailure("restore_source_identity_mismatch")
            _record(checks, phase, "PASS", database_count=manifest["database_count"])

            phase = "migration_rehearsal"
            migration_root = isolated_root / "migration-rehearsal"
            migration_report = production_data_guard.rehearse_migrations(
                snapshot_dir=snapshot,
                backend_root=repo_root / "backend",
                work_root=migration_root,
            )
            if migration_report.get("source_identity") != identity:
                raise LifecycleFailure("migration_source_identity_mismatch")
            _record(checks, phase, "PASS", database_count=migration_report["restored_database_count"],
                    migration_count=sum(item["status"] == "passed" for item in migration_report["results"]))

            phase = "rollback_recovery_preparation"
            rollback_root = isolated_root / "rollback-target"
            rollback = production_data_guard.prepare_recovery_root(
                snapshot_dir=snapshot,
                target_root=rollback_root,
                backend_root=repo_root / "backend",
            )
            if (
                rollback.get("status") != "PASS"
                or rollback.get("source_identity") != identity
                or not rollback.get("isolated_target_prepared")
                or rollback.get("live_overwrite_supported")
            ):
                raise LifecycleFailure("rollback_source_identity_mismatch")
            _record(checks, phase, "PASS", isolated_target_prepared=True, live_overwrite="unsupported",
                    rebound_tenant_count=rollback["rebound_tenant_count"])

            phase = "startup_readiness_contract"
            startup = _local_startup_probe(repo_root, isolated_root)
            if startup["status"] != "PASS":
                raise LifecycleFailure(str(startup.get("reason") or "local_startup_readiness_failed"))
            _record(checks, phase, "PASS", local_synthetic_runtime=True,
                    health_http_status=startup["health_http_status"],
                    readiness_http_status=startup["readiness_http_status"])

        phase = "live_source_invariance"
        fingerprints_after = _logical_fingerprints(config_url, default_url)
        unchanged = fingerprints_before == fingerprints_after
        if not unchanged:
            raise LifecycleFailure("live_source_logical_fingerprint_changed")
        _record(checks, phase, "PASS", database_count=len(fingerprints_after), unchanged=True)
        report["status"] = "PASS"
        report["runtime_probe_required_for_deployment"] = True
    except Exception as exc:
        blockers.append(exc.code if isinstance(exc, LifecycleFailure) else f"{phase}_{exc.__class__.__name__}")
        _record(checks, phase, "FAIL", error_type=exc.__class__.__name__)
        report["status"] = "FAIL"
    return report


def _write_report(path: Path | None, payload: dict[str, Any]) -> None:
    if path is None:
        return
    path = path.expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.chmod(0o600)
    os.replace(temporary, path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    qualify_parser = subparsers.add_parser("qualify", help="run source-side production qualification and data recovery drill")
    qualify_parser.add_argument("--repo-root", type=Path, default=ROOT)
    qualify_parser.add_argument("--backup-root", type=Path, required=True)
    qualify_parser.add_argument("--report", type=Path)
    readiness_parser = subparsers.add_parser("readiness", help="probe a started backend's health and readiness endpoints")
    readiness_parser.add_argument("--base-url", required=True)
    readiness_parser.add_argument("--report", type=Path)
    args = parser.parse_args(argv)

    if args.command == "qualify":
        payload = qualify(repo_root=args.repo_root, backup_root=args.backup_root)
    else:
        identity = None
        blockers: list[str] = []
        checks: list[dict[str, Any]] = []
        try:
            identity = _identity()
            result = probe_readiness(args.base_url)
            if result["status"] == "PASS":
                _record(checks, "startup_readiness", "PASS", **{key: value for key, value in result.items() if key != "status"})
            else:
                blockers.append(str(result.get("reason", "readiness_probe_failed")))
                _record(checks, "startup_readiness", "FAIL", **{key: value for key, value in result.items() if key != "status"})
        except Exception as exc:
            blockers.append(f"readiness_probe_{exc.__class__.__name__}")
            _record(checks, "startup_readiness", "FAIL", error_type=exc.__class__.__name__)
        payload = {
            "schema_version": 1,
            "scope": "runtime_probe",
            "source_identity": identity,
            "status": "PASS" if not blockers else "FAIL",
            "checks": checks,
            "blockers": blockers,
        }
    try:
        _write_report(args.report, payload)
    except Exception as exc:
        payload["status"] = "FAIL"
        payload.setdefault("blockers", []).append(f"report_write_{exc.__class__.__name__}")
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
    return 0 if payload.get("status") == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
