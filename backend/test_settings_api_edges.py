import pytest
from sqlalchemy import select
import json
import re
from pathlib import Path

from app.api.settings import ensure_tenant_admin_async
from app.core.config import settings
from app.models.config import Tenant


def _collect_keys(value):
    if isinstance(value, dict):
        keys = set(value.keys())
        for nested in value.values():
            keys.update(_collect_keys(nested))
        return keys
    if isinstance(value, list):
        keys = set()
        for nested in value:
            keys.update(_collect_keys(nested))
        return keys
    return set()


def _set_frontend_env_file(monkeypatch, tmp_path: Path, api_base_value: str):
    env_file = tmp_path / "frontend-test.env"
    env_file.write_text(f'VITE_API_BASE_URL={api_base_value}\n', encoding="utf-8")
    monkeypatch.setattr(settings, "FRONTEND_ENV_FILE_PATH", str(env_file))


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("api_base_value", "expected_origin", "expected_valid"),
    [
        ("https://api.example.com/api/v1", "https://api.example.com", True),
        ("https://api.example.com:8443/api/v1", "https://api.example.com:8443", True),
        ("https://user:pass@api.example.com/api/v1?token=abc#frag", "https://api.example.com", True),
        ("https://api.example.com/api/v1?token=abc#frag", "https://api.example.com", True),
        ("not a valid url", None, False),
    ],
)
async def test_startup_check_strictly_sanitizes_configured_origin(
    seeded_admin_tenant,
    setup_db,
    monkeypatch,
    tmp_path,
    api_base_value,
    expected_origin,
    expected_valid,
):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id), "Origin": "https://frontend.example.com"}
    await _ensure_admin(seeded_admin_tenant, setup_db)
    _set_frontend_env_file(monkeypatch, tmp_path, api_base_value)

    response = await client.get("/api/v1/settings/startup-check", headers=headers)
    assert response.status_code == 200, response.text
    payload = response.json()
    serialized = json.dumps(payload)

    assert payload["api"]["configured_origin"] == expected_origin
    assert payload["api"]["configured_api_origin_valid"] is expected_valid
    assert payload["api"]["vite_api_base_url_configured"] is True

    assert "user:pass@" not in serialized
    assert "token=abc" not in serialized
    assert "#frag" not in serialized
    assert "not a valid url" not in serialized
    assert "api/v1?token" not in serialized


async def _ensure_admin(seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant["tenant_id"]
    async with setup_db[1]() as config_db:
        tenant_res = await config_db.execute(select(Tenant).filter(Tenant.id == tenant_id))
        tenant = tenant_res.scalar_one()
    await ensure_tenant_admin_async(
        tenant_db_url=tenant.db_url,
        admin_user="admin_root",
        full_name="Admin Root",
        email="admin_root@test.com",
        department="IT",
    )


@pytest.mark.anyio
async def test_settings_user_profile_env_and_global_edges(seeded_admin_tenant, setup_db, monkeypatch):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant, setup_db)

    save_res = await client.post(
        "/api/v1/settings/user/settings",
        json={"theme": {"mode": "dark"}, "pinnedViews": ["dashboard", "monitoring"]},
        headers=headers,
    )
    assert save_res.status_code == 200, save_res.text

    settings_res = await client.get("/api/v1/settings/user/settings", headers=headers)
    assert settings_res.status_code == 200, settings_res.text
    assert settings_res.json()["theme"] == {"mode": "dark"}
    assert settings_res.json()["pinnedViews"] == ["dashboard", "monitoring"]

    update_again_res = await client.patch(
        "/api/v1/settings/user/settings",
        json={"theme": {"mode": "light"}, "monitoring_ui_state": None},
        headers=headers,
    )
    assert update_again_res.status_code == 200, update_again_res.text

    settings_updated_res = await client.get("/api/v1/settings/user/settings", headers=headers)
    assert settings_updated_res.status_code == 200, settings_updated_res.text
    updated_settings = settings_updated_res.json()
    assert updated_settings["theme"] == {"mode": "light"}
    assert updated_settings["monitoring_ui_state"] is None

    profile_res = await client.get("/api/v1/settings/user/profile", headers=headers)
    assert profile_res.status_code == 200, profile_res.text
    profile = profile_res.json()
    assert profile["username"] == "admin_root"
    assert profile["access_mode"] == "assigned"
    assert profile["role"] == "Admin"

    monkeypatch.setenv("API_KEY", "super-secret")
    monkeypatch.setenv("SAFE_NAME", "visible")
    monkeypatch.setenv("VITE_UI_DEBUG_LOGGING", "true")
    monkeypatch.setenv("HTTP_X_FORWARDED_FOR", "1.1.1.1")
    env_res = await client.get("/api/v1/settings/user/env-vars", headers=headers)
    assert env_res.status_code == 200, env_res.text
    env_payload = env_res.json()
    assert env_payload["API_KEY"] == "********"
    assert env_payload["SAFE_NAME"] == "********"
    assert env_payload["USER_ID"] == "admin_root"
    assert env_payload["SESSION_TYPE"] == "PROXIED"
    assert env_payload["DEBUG_MODE"] == "True"

    protected_res = await client.post("/api/v1/settings/global", json={"DATABASE_URL": "sqlite://blocked"}, headers=headers)
    assert protected_res.status_code == 400
    assert "deploy-time setting" in protected_res.json()["detail"]

    update_global = await client.post(
        "/api/v1/settings/global",
        json={"VITE_ORG_NAME": "SysGrid QA", "PORT": 9000},
        headers=headers,
    )
    assert update_global.status_code == 200, update_global.text

    global_res = await client.get("/api/v1/settings/global", headers=headers)
    assert global_res.status_code == 200, global_res.text
    global_payload = global_res.json()
    assert global_payload["VITE_ORG_NAME"] == "SysGrid QA"
    assert global_payload["PORT"] == "9000"
    assert "backend" in global_payload["_raw_env"]
    assert "frontend" in global_payload["_raw_env"]

    bootstrap_res = await client.get("/api/v1/settings/bootstrap")
    assert bootstrap_res.status_code == 200, bootstrap_res.text
    assert bootstrap_res.json()["VITE_ORG_NAME"] == "SysGrid QA"

    startup_res = await client.get(
        "/api/v1/settings/startup-check",
        headers={**headers, "Origin": "http://frontend.example.com"},
    )
    assert startup_res.status_code == 200, startup_res.text
    startup_payload = startup_res.json()
    serialized_startup_payload = json.dumps(startup_payload)
    startup_keys = _collect_keys(startup_payload)
    assert startup_payload["api"]["request_origin"] == "http://frontend.example.com"
    assert startup_payload["api"]["api_prefix"] == "/api/v1"
    assert "configured_origin" in startup_payload["api"]
    assert "configured_api_origin_valid" in startup_payload["api"]
    assert "request_base_origin" in startup_payload["api"]
    assert isinstance(startup_payload["api"]["vite_api_base_url_configured"], bool)
    assert isinstance(startup_payload["api"]["vite_api_base_url_includes_api_v1"], bool)
    assert startup_payload["cors"]["allows_request_origin"] is True
    assert isinstance(startup_payload["cors"]["configured_origin_count"], int)
    assert startup_payload["runtime"]["environment_mode"]
    assert startup_payload["runtime"]["frontend_build_version_hint"]
    assert isinstance(startup_payload["runtime"]["default_user_id_is_fallback"], bool)
    assert isinstance(startup_payload["runtime"]["user_id_env_value_present"], bool)
    assert startup_payload["contracts"]["external_schema_version"] == "2026-06-external-v1"
    assert startup_payload["tenant"]["selected_tenant_present"] is True
    assert startup_payload["tenant"]["accessible_tenant_count"] >= 1
    assert isinstance(startup_payload["warnings"], list)
    forbidden_keys = {
        "database_url",
        "config_database_url",
        "selected_tenant_db_url",
        "tenant_storage_root",
        "backend_env_file_path",
        "frontend_env_file_path",
        "db_url",
    }
    assert forbidden_keys.isdisjoint(startup_keys)
    forbidden_patterns = [
        r"sqlite:///",
        r"postgres://",
        r"postgresql://",
        r"mysql://",
        r"mssql://",
        r"/Users/",
        r"/home/",
        r"C:\\\\",
        r"\.env",
        r"https?://[^/\"]+:[^/\"]+@",
    ]
    for pattern in forbidden_patterns:
        assert re.search(pattern, serialized_startup_payload, flags=re.IGNORECASE) is None


@pytest.mark.anyio
async def test_settings_options_and_ui_constraints(seeded_admin_tenant, setup_db):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant, setup_db)

    device_res = await client.post(
        "/api/v1/devices",
        json={
            "name": "OWNER-EDGE-01",
            "system": "OWNER-EDGE",
            "status": "Active",
            "type": "Physical",
            "serial_number": "OWNER-EDGE-SN",
            "asset_tag": "OWNER-EDGE-AT",
            "owner": "LegacyOwner",
        },
        headers=headers,
    )
    assert device_res.status_code == 200, device_res.text
    device = device_res.json()

    create_option = await client.post(
        "/api/v1/settings/options",
        json={"category": "Owner", "label": "Legacy Owner", "value": "LegacyOwner", "description": "Old owner"},
        headers=headers,
    )
    assert create_option.status_code == 200, create_option.text
    option = create_option.json()

    list_owner = await client.get("/api/v1/settings/options?category=Owner", headers=headers)
    assert list_owner.status_code == 200, list_owner.text
    assert any(item["id"] == option["id"] for item in list_owner.json())

    relational = await client.get("/api/v1/settings/options?category=MonitoringTeam", headers=headers)
    assert relational.status_code == 200
    assert relational.json() == []

    locked_res = await client.post(
        "/api/v1/settings/options",
        json={"category": "MonitoringSeverity", "label": "Critical", "value": "Critical"},
        headers=headers,
    )
    assert locked_res.status_code == 400

    relational_create = await client.post(
        "/api/v1/settings/options",
        json={"category": "MonitoringTeam", "label": "Ops", "value": "Ops"},
        headers=headers,
    )
    assert relational_create.status_code == 400

    rename_res = await client.put(
        f"/api/v1/settings/options/{option['id']}",
        json={"label": "Current Owner", "value": "CurrentOwner"},
        headers=headers,
    )
    assert rename_res.status_code == 200, rename_res.text

    devices_res = await client.get("/api/v1/devices", headers=headers)
    assert devices_res.status_code == 200, devices_res.text
    renamed_device = next(item for item in devices_res.json() if item["id"] == device["id"])
    assert renamed_device["owner"] == "CurrentOwner"

    delete_in_use = await client.delete(f"/api/v1/settings/options/{option['id']}", headers=headers)
    assert delete_in_use.status_code == 400
    assert "currently in use" in delete_in_use.json()["detail"]

    ui_default = await client.get("/api/v1/settings/ui", headers=headers)
    assert ui_default.status_code == 200, ui_default.text
    assert ui_default.json()["status_badged"] is True

    ui_update = await client.post(
        "/api/v1/settings/ui",
        json={"status_badged": False, "status_colors": {"Active": "#000000", "Planned": "#ffffff"}},
        headers=headers,
    )
    assert ui_update.status_code == 200, ui_update.text

    ui_after = await client.get("/api/v1/settings/ui", headers=headers)
    assert ui_after.status_code == 200, ui_after.text
    assert ui_after.json()["status_badged"] is False
    assert ui_after.json()["status_colors"]["Active"] == "#000000"
