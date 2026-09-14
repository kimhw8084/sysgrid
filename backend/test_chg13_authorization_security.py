from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.authorization import (
    has_capability,
    merge_operator_permissions,
    require_capability,
    resolve_current_operator,
)
from app.core.config import Settings, settings
from app.database import get_tenant_engine
from app.models import models
from app.models.config import Tenant, UserTenantAccess


async def _grant_access(setup_db, *, tenant_id: int, user_id: str, role: str) -> None:
    async with setup_db[1]() as config_db:
        config_db.add(UserTenantAccess(
            user_id=user_id,
            tenant_id=tenant_id,
            role=role,
            is_selected=False,
        ))
        await config_db.commit()


async def _tenant_url(setup_db, tenant_id: int) -> str:
    async with setup_db[1]() as config_db:
        return await config_db.scalar(select(Tenant.db_url).where(Tenant.id == tenant_id))


@asynccontextmanager
async def _tenant_db(setup_db, tenant_id: int):
    engine = get_tenant_engine(await _tenant_url(setup_db, tenant_id))
    session_factory = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with session_factory() as tenant_db:
        yield tenant_db


async def _seed_operator(
    setup_db,
    tenant_id: int,
    user_id: str,
    *,
    role_permissions: dict | None = None,
    custom_permissions: dict | None = None,
    is_admin: bool = False,
) -> None:
    async with _tenant_db(setup_db, tenant_id) as tenant_db:
        role = models.Role(
            name=f"role-{user_id}-{uuid4().hex}",
            permissions=role_permissions or {},
        )
        tenant_db.add(role)
        await tenant_db.flush()
        tenant_db.add(models.Operator(
            external_id=user_id,
            username=user_id,
            role_id=role.id,
            custom_permissions=custom_permissions or {},
            is_admin=is_admin,
        ))
        await tenant_db.commit()


@pytest.mark.parametrize("tenant_role", ["EDITOR", "ADMIN"])
@pytest.mark.anyio
async def test_tenant_roles_cannot_access_global_control_plane(
    seeded_admin_tenant,
    setup_db,
    tenant_role,
):
    tenant_id = seeded_admin_tenant["tenant_id"]
    user_id = f"tenant-{tenant_role.lower()}"
    await _grant_access(setup_db, tenant_id=tenant_id, user_id=user_id, role=tenant_role)

    response = await seeded_admin_tenant["client"].get(
        "/api/v1/tenants/admin/settings",
        headers={"X-User-Id": user_id},
    )

    assert response.status_code == 403
    assert "control-plane" in response.json()["detail"]


@pytest.mark.anyio
async def test_explicit_control_plane_admin_succeeds(seeded_admin_tenant, monkeypatch):
    monkeypatch.setattr(settings, "CONTROL_PLANE_ADMIN_USER_IDS", "control-plane-admin")

    response = await seeded_admin_tenant["client"].get(
        "/api/v1/tenants/admin/settings",
        headers={"X-User-Id": "control-plane-admin"},
    )

    assert response.status_code == 200, response.text


@pytest.mark.anyio
async def test_explicit_first_install_bootstrap_expires_after_first_tenant(client, setup_db, monkeypatch):
    monkeypatch.setattr(settings, "CONTROL_PLANE_ADMIN_USER_IDS", "")
    monkeypatch.setattr(settings, "CONTROL_PLANE_BOOTSTRAP_ENABLED", True)
    monkeypatch.setattr(settings, "CONTROL_PLANE_BOOTSTRAP_USER_ID", "first-install-admin")
    headers = {"X-User-Id": "first-install-admin"}

    first_install = await client.get("/api/v1/tenants/admin/settings", headers=headers)
    assert first_install.status_code == 200, first_install.text

    async with setup_db[1]() as config_db:
        config_db.add(Tenant(name="Existing tenant", db_url="sqlite+aiosqlite:////tmp/existing.db"))
        await config_db.commit()

    steady_state = await client.get("/api/v1/tenants/admin/settings", headers=headers)
    assert steady_state.status_code == 403


@pytest.mark.anyio
async def test_missing_trusted_identity_fails_closed(client, seeded_admin_tenant, monkeypatch):
    monkeypatch.setattr(settings, "IDENTITY_MODE", "trusted_proxy")
    monkeypatch.setattr(settings, "CONTROL_PLANE_ADMIN_USER_IDS", "control-plane-admin")

    response = await client.get(
        "/api/v1/tenants/admin/settings",
        headers={"X-User-Id": "control-plane-admin"},
    )

    assert response.status_code == 401
    assert "identity" in response.json()["detail"].lower()


def test_production_requires_explicit_control_plane_configuration():
    unconfigured = Settings(
        ENVIRONMENT="production",
        CONTROL_PLANE_ADMIN_USER_IDS="",
        CONTROL_PLANE_BOOTSTRAP_ENABLED=False,
        CONTROL_PLANE_BOOTSTRAP_USER_ID="",
    )
    assert any("CONTROL_PLANE_ADMIN_USER_IDS" in error for error in unconfigured.production_guard_errors())

    bootstrap_enabled = Settings(
        ENVIRONMENT="production",
        CONTROL_PLANE_ADMIN_USER_IDS="deployment-admin",
        CONTROL_PLANE_BOOTSTRAP_ENABLED=True,
        CONTROL_PLANE_BOOTSTRAP_USER_ID="first-install-admin",
    )
    errors = bootstrap_enabled.production_guard_errors()
    assert any("CONTROL_PLANE_BOOTSTRAP_ENABLED" in error for error in errors)
    assert any("CONTROL_PLANE_BOOTSTRAP_USER_ID" in error for error in errors)


def test_capability_uses_existing_permission_vocabulary_and_overrides():
    role = SimpleNamespace(permissions={"services": "edit", "secrets": 3})
    operator = SimpleNamespace(
        role=role,
        custom_permissions={"services": "none", "monitoring": True},
        is_admin=False,
    )

    assert merge_operator_permissions(operator) == {
        "monitoring": 1,
        "secrets": 3,
        "services": 0,
    }
    assert has_capability(operator, "secrets", 3) is True
    assert has_capability(operator, "services", 1) is False
    assert has_capability(operator, "monitoring", 1) is True


def test_capability_preserves_is_admin_and_all_compatibility():
    is_admin = SimpleNamespace(role=None, custom_permissions={}, is_admin=True)
    all_grant = SimpleNamespace(
        role=SimpleNamespace(permissions={"all": 3}),
        custom_permissions={},
        is_admin=False,
    )
    insufficient = SimpleNamespace(
        role=SimpleNamespace(permissions={"secrets": 2}),
        custom_permissions={},
        is_admin=False,
    )

    assert has_capability(is_admin, "secrets", 3) is True
    assert has_capability(all_grant, "unlisted-capability", 3) is True
    assert has_capability(insufficient, "secrets", 3) is False


@pytest.mark.anyio
async def test_capability_dependency_denies_missing_operator(setup_db, seeded_admin_tenant):
    request = SimpleNamespace(headers={"X-User-Id": "no-operator"})
    async with _tenant_db(setup_db, seeded_admin_tenant["tenant_id"]) as tenant_db:
        assert await resolve_current_operator(request, tenant_db) is None
        dependency = require_capability("secrets", 3)
        with pytest.raises(HTTPException) as exc:
            await dependency(request, db=tenant_db)

    assert exc.value.status_code == 403


@pytest.mark.anyio
async def test_logical_service_reads_never_return_legacy_passwords(
    seeded_admin_tenant,
    setup_db,
):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    admin_headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    service_response = await client.post(
        "/api/v1/logical-services",
        json={"name": "Secret boundary service", "service_type": "Database"},
        headers=admin_headers,
    )
    assert service_response.status_code == 200, service_response.text
    service_id = service_response.json()["id"]

    legacy_value = f"legacy-{uuid4().hex}"
    async with _tenant_db(setup_db, tenant_id) as tenant_db:
        tenant_db.add(models.ServiceSecret(
            service_id=service_id,
            username="legacy-user",
            password=legacy_value,
            note="migration-only row",
        ))
        await tenant_db.commit()

    for query in ("", "?include_secret_values=true"):
        response = await client.get(
            f"/api/v1/logical-services{query}",
            headers=admin_headers,
        )
        assert response.status_code == 200, response.text
        payload = next(item for item in response.json() if item["id"] == service_id)
        assert payload["secrets"][0]["has_password"] is True
        assert payload["secrets"][0]["password"] is None
        assert legacy_value not in response.text


@pytest.mark.anyio
async def test_viewer_and_editor_cannot_reveal_legacy_service_secret(
    seeded_admin_tenant,
    setup_db,
):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    admin_headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    service_response = await client.post(
        "/api/v1/logical-services",
        json={"name": "Role boundary service", "service_type": "Web"},
        headers=admin_headers,
    )
    service_id = service_response.json()["id"]
    async with _tenant_db(setup_db, tenant_id) as tenant_db:
        secret = models.ServiceSecret(
            service_id=service_id,
            username="legacy-viewer",
            password=f"legacy-{uuid4().hex}",
        )
        tenant_db.add(secret)
        await tenant_db.commit()
        secret_id = secret.id

    for user_id, tenant_role in (("service-viewer", "VIEWER"), ("service-editor", "EDITOR")):
        await _grant_access(setup_db, tenant_id=tenant_id, user_id=user_id, role=tenant_role)
        response = await client.get(
            "/api/v1/logical-services?include_secret_values=true",
            headers={"X-User-Id": user_id, "X-Tenant-Id": str(tenant_id)},
        )
        assert response.status_code == 200, response.text
        assert all(secret_payload["password"] is None for item in response.json() for secret_payload in item["secrets"])

        reveal_attempt = await client.get(
            f"/api/v1/logical-services/{service_id}/secrets/{secret_id}",
            headers={"X-User-Id": user_id, "X-Tenant-Id": str(tenant_id)},
        )
        assert reveal_attempt.status_code in {404, 405}


@pytest.mark.anyio
async def test_new_plaintext_service_secret_write_fails_closed(
    seeded_admin_tenant,
    setup_db,
):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    admin_user = "secret-administrator"
    await _grant_access(setup_db, tenant_id=tenant_id, user_id=admin_user, role="ADMIN")
    await _seed_operator(setup_db, tenant_id, admin_user, is_admin=True)

    service_response = await client.post(
        "/api/v1/logical-services",
        json={"name": "Write boundary service", "service_type": "Middleware"},
        headers={"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)},
    )
    service_id = service_response.json()["id"]
    rejected_value = f"rejected-{uuid4().hex}"

    response = await client.post(
        f"/api/v1/logical-services/{service_id}/secrets",
        json={"username": "new-user", "password": rejected_value},
        headers={"X-User-Id": admin_user, "X-Tenant-Id": str(tenant_id)},
    )

    assert response.status_code == 400
    assert "future secret-provider boundary" in response.json()["detail"]
    async with _tenant_db(setup_db, tenant_id) as tenant_db:
        assert await tenant_db.scalar(
            select(models.ServiceSecret.id).where(models.ServiceSecret.service_id == service_id)
        ) is None


@pytest.mark.anyio
async def test_editor_cannot_mutate_service_secrets_without_manage_capability(
    seeded_admin_tenant,
    setup_db,
):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    editor_user = "service-editor"
    await _grant_access(setup_db, tenant_id=tenant_id, user_id=editor_user, role="EDITOR")
    await _seed_operator(
        setup_db,
        tenant_id,
        editor_user,
        role_permissions={"services": 3, "secrets": 2},
    )
    service_response = await client.post(
        "/api/v1/logical-services",
        json={"name": "Editor boundary service", "service_type": "ToolStack"},
        headers={"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)},
    )
    service_id = service_response.json()["id"]

    response = await client.post(
        f"/api/v1/logical-services/{service_id}/secrets",
        json={"username": "metadata-only"},
        headers={"X-User-Id": editor_user, "X-Tenant-Id": str(tenant_id)},
    )

    assert response.status_code == 403
