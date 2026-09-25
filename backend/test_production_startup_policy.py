from pathlib import Path
import tempfile

from app.core.config import PRODUCTION_REQUIRED_ENV, Settings


def safe_production_values():
    data_root = Path(tempfile.gettempdir()) / "sysgrid-production-contract-fixture"
    values = {name: "configured" for name in PRODUCTION_REQUIRED_ENV}
    values.update({
        "ENVIRONMENT": "production",
        "BACKEND_CORS_ORIGINS": "https://frontend.invalid",
        "ALLOWED_HOSTS": "backend.invalid",
        "IDENTITY_MODE": "trusted_proxy",
        "TRUSTED_PROXY_USER_HEADER": "X-Authenticated-User",
        "DATABASE_URL": f"sqlite+aiosqlite:///{data_root / 'default.db'}",
        "CONFIG_DATABASE_URL": f"sqlite+aiosqlite:///{data_root / 'config.db'}",
        "TENANT_STORAGE_ROOT": str(data_root / "tenants"),
        "PUBLIC_READONLY_ENABLED": False,
        "ALLOW_PUBLIC_READONLY_IN_PRODUCTION": False,
        "DEFAULT_USER_ID": "svc-sysgrid",
        "AUTO_ADMIN_USER_IDS": "",
        "ALLOW_AUTO_ADMIN_IN_PRODUCTION": False,
        "CONTROL_PLANE_ADMIN_USER_IDS": "ops-admin",
        "CONTROL_PLANE_BOOTSTRAP_ENABLED": False,
        "CONTROL_PLANE_BOOTSTRAP_USER_ID": "",
        "SYSTEM_ROOT_USER_IDS": "system-root",
        "SCHEDULE_PREVIEW_SIGNING_KEY": "synthetic-deployment-key-0123456789abcdef",
        "PV1_RELEASE_CANDIDATE_SHA": "a" * 64,
        "PV1_RELEASE_ID": "synthetic-release-1",
        "AUTO_MIGRATE_ON_STARTUP": False,
        "ALLOW_AUTO_MIGRATE_IN_PRODUCTION": False,
    })
    return values


def test_development_keeps_automatic_startup_schema_management():
    configured = Settings(ENVIRONMENT="development")
    assert configured.startup_schema_management_enabled is True
    assert configured.startup_schema_policy == "automatic"


def test_production_disables_startup_schema_mutation_by_default():
    configured = Settings(ENVIRONMENT="production")
    assert configured.startup_schema_management_enabled is False
    assert configured.startup_schema_policy == "operator_managed"


def test_production_requires_explicit_auto_migration_acknowledgement():
    configured = Settings(
        ENVIRONMENT="production",
        AUTO_MIGRATE_ON_STARTUP=True,
        ALLOW_AUTO_MIGRATE_IN_PRODUCTION=True,
    )
    assert configured.startup_schema_management_enabled is True
    assert configured.startup_schema_policy == "automatic"


def test_global_startup_migration_switch_preserves_operator_control():
    configured = Settings(
        ENVIRONMENT="development",
        AUTO_MIGRATE_ON_STARTUP=False,
        ALLOW_AUTO_MIGRATE_IN_PRODUCTION=True,
    )
    assert configured.startup_schema_management_enabled is False


def test_complete_explicit_production_contract_is_accepted(monkeypatch):
    monkeypatch.delenv("TESTING", raising=False)
    configured = Settings(_env_file=None, **safe_production_values())
    assert configured.production_guard_errors() == []
    assert configured.startup_schema_policy == "operator_managed"


def test_production_contract_rejects_missing_explicit_release_identity(monkeypatch):
    monkeypatch.delenv("TESTING", raising=False)
    values = safe_production_values()
    values.pop("PV1_RELEASE_ID")
    errors = Settings(_env_file=None, **values).production_guard_errors()
    assert any("PV1_RELEASE_ID must be explicitly configured" in error for error in errors)
    assert any("PV1_RELEASE_ID must identify" in error for error in errors)


def test_production_contract_rejects_unresolved_example_values(monkeypatch):
    monkeypatch.delenv("TESTING", raising=False)
    values = safe_production_values()
    values["SCHEDULE_PREVIEW_SIGNING_KEY"] = "inject-from-secret-manager-at-runtime"
    errors = Settings(_env_file=None, **values).production_guard_errors()
    assert any("SCHEDULE_PREVIEW_SIGNING_KEY must be a deployment-specific secret" in error for error in errors)


def test_production_auto_migration_requires_visible_acknowledgement(monkeypatch):
    monkeypatch.delenv("TESTING", raising=False)
    values = safe_production_values()
    values["AUTO_MIGRATE_ON_STARTUP"] = True
    errors = Settings(_env_file=None, **values).production_guard_errors()
    assert any("requires ALLOW_AUTO_MIGRATE_IN_PRODUCTION=true" in error for error in errors)


def test_production_contract_rejects_relative_or_non_sqlite_persistent_paths(monkeypatch):
    monkeypatch.delenv("TESTING", raising=False)
    values = safe_production_values()
    values["DATABASE_URL"] = "sqlite+aiosqlite:///relative/system_grid.db"
    values["CONFIG_DATABASE_URL"] = "postgresql://db.invalid/sysgrid"
    values["TENANT_STORAGE_ROOT"] = "./tenants"
    errors = Settings(_env_file=None, **values).production_guard_errors()
    assert any("DATABASE_URL must point to an absolute persistent SQLite file path" in error for error in errors)
    assert any("CONFIG_DATABASE_URL must use a file-backed sqlite+aiosqlite URL" in error for error in errors)
    assert any("TENANT_STORAGE_ROOT must be an absolute persistent directory" in error for error in errors)


def test_production_contract_rejects_checkout_storage_and_shared_database_files(monkeypatch):
    monkeypatch.delenv("TESTING", raising=False)
    values = safe_production_values()
    checkout = Path(__file__).resolve().parents[1] / "backend"
    shared_database = checkout / "production-data-must-not-be-here.db"
    values["DATABASE_URL"] = f"sqlite+aiosqlite:///{shared_database}"
    values["CONFIG_DATABASE_URL"] = f"sqlite+aiosqlite:///{shared_database}"
    values["TENANT_STORAGE_ROOT"] = str(checkout / "tenants")
    errors = Settings(_env_file=None, **values).production_guard_errors()
    assert any("DATABASE_URL must not store production data inside the application checkout" in error for error in errors)
    assert any("TENANT_STORAGE_ROOT must not store production data inside the application checkout" in error for error in errors)
    assert any("must identify distinct persistent SQLite files" in error for error in errors)
