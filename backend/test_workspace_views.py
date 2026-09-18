import asyncio
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from app.api.tenants import run_alembic_upgrade
from app.api.settings import ensure_tenant_admin_async
from app.database import get_tenant_engine
from app.models import models
from app.models.config import Tenant, UserTenantAccess


MONITORING_VIEW = {
    "name": "Critical monitors",
    "scope": "personal",
    "definition": {
        "fontSize": 99,
        "rowDensity": -10,
        "hiddenColumns": ["title", "unknown", "title"],
        "groupBy": "severity",
        "showFilterBar": True,
        "quickFilter": "  thermal  ",
        "quickFilters": {"status": ["Existing", "Existing", 3]},
        "filterModel": {
            "status": {"filterType": "set", "values": ["Existing"]},
            "not_a_column": {"filterType": "text", "filter": "x"},
        },
        "sortModel": [
            {"colId": "severity", "sort": "desc"},
            {"colId": "missing", "sort": "asc"},
        ],
        "columnLayoutState": [
            {"colId": "title", "width": 310},
            {"colId": "missing", "width": 500},
        ],
        "unknownTopLevel": "drop me",
    },
    "schema_version": 1,
}


def headers(user_id: str, tenant_id: int) -> dict[str, str]:
    return {"X-User-Id": user_id, "X-Tenant-Id": str(tenant_id)}


async def add_user_access(config_session_factory, *, user_id: str, tenant_id: int, role: str = "ADMIN"):
    async with config_session_factory() as db:
        db.add(UserTenantAccess(user_id=user_id, tenant_id=tenant_id, role=role, is_selected=True))
        await db.commit()


async def add_workspace_reader(config_session_factory, *, user_id: str, tenant_id: int, tenant_db_url: str):
    engine = get_tenant_engine(tenant_db_url)
    session_factory = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with session_factory() as db:
        role = models.Role(name=f"workspace-reader-{user_id}", permissions={"services": 1})
        db.add(role)
        await db.flush()
        db.add(models.Operator(
            external_id=user_id,
            username=user_id,
            role_id=role.id,
            custom_permissions={},
            is_admin=False,
        ))
        await db.commit()


@pytest.mark.anyio
async def test_workspace_definition_registry_is_complete_and_typed(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    response = await client.get("/api/v1/workspaces/definitions")
    assert response.status_code == 200, response.text
    definitions = response.json()["definitions"]
    by_key = {entry["key"]: entry for entry in definitions}
    assert set(by_key) == {"monitoring", "assets", "services", "external", "network", "far", "research", "projects", "vendors"}
    assert by_key["network"]["archetype"] == "topology_hybrid"
    assert by_key["far"]["archetype"] == "investigation"
    assert by_key["research"]["archetype"] == "research"
    assert "column_state" in by_key["monitoring"]["capabilities"]
    assert "restore" in by_key["monitoring"]["lifecycle_actions"]
    assert "state_schema" in by_key["services"]
    assert "primary_ip" in by_key["assets"]["state_schema"]["column_ids"]
    assert by_key["assets"]["state_schema"]["quick_filter_keys"] == ["status", "system", "type", "owner"]
    assert "primary_personnel_email" in by_key["vendors"]["state_schema"]["column_ids"]
    assert by_key["vendors"]["state_schema"]["group_by"] == ["raw", "country"]
    assert by_key["projects"]["route"] == "/projects"
    assert "deep_links" in by_key["projects"]["capabilities"]


@pytest.mark.anyio
async def test_personal_saved_view_crud_sanitization_and_conflicts(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    request_headers = headers("admin_root", tenant_id)

    create = await client.post(
        "/api/v1/workspaces/monitoring/views",
        json=MONITORING_VIEW,
        headers=request_headers,
    )
    assert create.status_code == 201, create.text
    created = create.json()
    assert created["revision"] == 1
    assert created["scope"] == "personal"
    assert created["definition"]["fontSize"] == 18
    assert created["definition"]["rowDensity"] == 0
    assert created["definition"]["hiddenColumns"] == ["title"]
    assert created["definition"]["quickFilter"] == "thermal"
    assert set(created["definition"]["filterModel"]) == {"status"}
    assert created["definition"]["sortModel"] == [{"colId": "severity", "sort": "desc"}]
    assert created["definition"]["columnLayoutState"] == [{"colId": "title", "width": 310}]
    assert "unknownTopLevel" not in created["definition"]

    list_response = await client.get(
        "/api/v1/workspaces/monitoring/views",
        headers=request_headers,
    )
    assert list_response.status_code == 200, list_response.text
    assert [entry["id"] for entry in list_response.json()["views"]] == [created["id"]]

    updated_body = {
        **MONITORING_VIEW,
        "name": "Critical monitors updated",
        "revision": 1,
        "definition": {**MONITORING_VIEW["definition"], "groupBy": "platform"},
    }
    update_response = await client.put(
        f"/api/v1/workspaces/views/{created['id']}",
        json=updated_body,
        headers=request_headers,
    )
    assert update_response.status_code == 200, update_response.text
    updated = update_response.json()
    assert updated["revision"] == 2
    assert updated["name"] == "Critical monitors updated"
    assert updated["definition"]["groupBy"] == "platform"

    missing_revision = await client.put(
        f"/api/v1/workspaces/views/{created['id']}",
        json={key: value for key, value in updated_body.items() if key != "revision"},
        headers=request_headers,
    )
    assert missing_revision.status_code == 422, missing_revision.text

    stale_update = await client.put(
        f"/api/v1/workspaces/views/{created['id']}",
        json={**updated_body, "revision": 1},
        headers=request_headers,
    )
    assert stale_update.status_code == 409, stale_update.text
    assert stale_update.json()["detail"]["current"]["revision"] == 2

    stale_delete = await client.delete(
        f"/api/v1/workspaces/views/{created['id']}?revision=1",
        headers=request_headers,
    )
    assert stale_delete.status_code == 409, stale_delete.text
    assert stale_delete.json()["detail"]["current"]["revision"] == 2

    delete_response = await client.delete(
        f"/api/v1/workspaces/views/{created['id']}?revision=2",
        headers=request_headers,
    )
    assert delete_response.status_code == 200, delete_response.text
    assert delete_response.json() == {"status": "deleted", "id": created["id"], "revision": 2}


@pytest.mark.anyio
async def test_saved_views_reject_unknown_workspace_team_scope_and_duplicate_names(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    request_headers = headers("admin_root", tenant_id)

    invalid_workspace = await client.post(
        "/api/v1/workspaces/nope/views",
        json=MONITORING_VIEW,
        headers=request_headers,
    )
    assert invalid_workspace.status_code == 400, invalid_workspace.text

    stale_schema = await client.post(
        "/api/v1/workspaces/monitoring/views",
        json={**MONITORING_VIEW, "name": "Stale schema", "schema_version": 99},
        headers=request_headers,
    )
    assert stale_schema.status_code == 409, stale_schema.text
    assert stale_schema.json()["detail"]["current_schema_version"] == 1

    oversized = await client.post(
        "/api/v1/workspaces/monitoring/views",
        json={**MONITORING_VIEW, "name": "Oversized", "definition": {"quickFilter": "x" * (70 * 1024)}},
        headers=request_headers,
    )
    assert oversized.status_code == 413, oversized.text

    team_view = await client.post(
        "/api/v1/workspaces/monitoring/views",
        json={**MONITORING_VIEW, "name": "Team view", "scope": "team", "team_id": 1},
        headers=request_headers,
    )
    assert team_view.status_code == 403, team_view.text

    first = await client.post(
        "/api/v1/workspaces/monitoring/views",
        json=MONITORING_VIEW,
        headers=request_headers,
    )
    assert first.status_code == 201, first.text
    duplicate = await client.post(
        "/api/v1/workspaces/monitoring/views",
        json=MONITORING_VIEW,
        headers=request_headers,
    )
    assert duplicate.status_code == 409, duplicate.text


@pytest.mark.anyio
async def test_saved_view_owner_and_tenant_isolation(seeded_admin_tenant, setup_db, tmp_path_factory):
    client = seeded_admin_tenant["client"]
    tenant_a_id = seeded_admin_tenant["tenant_id"]
    _, config_session_factory = setup_db
    await add_user_access(config_session_factory, user_id="other_user", tenant_id=tenant_a_id)
    async with config_session_factory() as config_db:
        tenant_a_url = await config_db.scalar(select(Tenant.db_url).where(Tenant.id == tenant_a_id))
    await add_workspace_reader(
        config_session_factory,
        user_id="other_user",
        tenant_id=tenant_a_id,
        tenant_db_url=tenant_a_url,
    )

    created_response = await client.post(
        "/api/v1/workspaces/services/views",
        json={
            "name": "Admin service view",
            "scope": "personal",
            "definition": {"groupBy": "environment", "hiddenColumns": ["cost"]},
            "schema_version": 1,
        },
        headers=headers("admin_root", tenant_a_id),
    )
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()

    cross_user = await client.get(
        f"/api/v1/workspaces/views/{created['id']}",
        headers=headers("other_user", tenant_a_id),
    )
    assert cross_user.status_code == 404, cross_user.text

    tenant_b_path = tmp_path_factory.mktemp("workspace_views_tenant_b") / "tenant_b.db"
    tenant_b_url = f"sqlite+aiosqlite:///{tenant_b_path}"
    async with config_session_factory() as config_db:
        tenant_b = Tenant(name="Workspace Views Tenant B", db_url=tenant_b_url, is_active=True)
        config_db.add(tenant_b)
        await config_db.flush()
        tenant_b_id = tenant_b.id
        config_db.add(UserTenantAccess(user_id="admin_root", tenant_id=tenant_b_id, role="ADMIN", is_selected=False))
        await config_db.commit()
    success, error = run_alembic_upgrade(tenant_b_url)
    assert success, error
    await ensure_tenant_admin_async(
        tenant_db_url=tenant_b_url,
        admin_user="admin_root",
        full_name="Admin Root",
        email="admin_root@test.com",
        department="Infrastructure",
    )

    cross_tenant = await client.get(
        f"/api/v1/workspaces/views/{created['id']}",
        headers=headers("admin_root", tenant_b_id),
    )
    assert cross_tenant.status_code == 404, cross_tenant.text


@pytest.mark.anyio
async def test_saved_view_favorite_and_single_default_metadata(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    request_headers = headers("admin_root", tenant_id)

    first_response = await client.post(
        "/api/v1/workspaces/monitoring/views",
        json={**MONITORING_VIEW, "name": "Primary", "is_favorite": True, "is_default": True},
        headers=request_headers,
    )
    assert first_response.status_code == 201, first_response.text
    first = first_response.json()
    assert first["is_favorite"] is True
    assert first["is_default"] is True

    compatibility_update = await client.put(
        f"/api/v1/workspaces/views/{first['id']}",
        json={**MONITORING_VIEW, "name": "Primary renamed", "revision": 1},
        headers=request_headers,
    )
    assert compatibility_update.status_code == 200, compatibility_update.text
    first = compatibility_update.json()
    assert first["revision"] == 2
    assert first["is_favorite"] is True
    assert first["is_default"] is True

    second_response = await client.post(
        "/api/v1/workspaces/monitoring/views",
        json={**MONITORING_VIEW, "name": "Secondary", "is_default": True},
        headers=request_headers,
    )
    assert second_response.status_code == 201, second_response.text
    second = second_response.json()
    assert second["is_default"] is True

    listed = await client.get("/api/v1/workspaces/monitoring/views", headers=request_headers)
    assert listed.status_code == 200, listed.text
    by_id = {entry["id"]: entry for entry in listed.json()["views"]}
    assert by_id[first["id"]]["is_default"] is False
    assert by_id[first["id"]]["is_favorite"] is True
    assert by_id[first["id"]]["revision"] == 3
    assert by_id[second["id"]]["is_default"] is True
    assert sum(1 for entry in by_id.values() if entry["is_default"]) == 1

    promote_first = await client.put(
        f"/api/v1/workspaces/views/{first['id']}",
        json={
            **MONITORING_VIEW,
            "name": "Primary renamed",
            "revision": 3,
            "is_favorite": False,
            "is_default": True,
        },
        headers=request_headers,
    )
    assert promote_first.status_code == 200, promote_first.text
    promoted = promote_first.json()
    assert promoted["revision"] == 4
    assert promoted["is_favorite"] is False
    assert promoted["is_default"] is True

    relisted = await client.get("/api/v1/workspaces/monitoring/views", headers=request_headers)
    assert relisted.status_code == 200, relisted.text
    by_id = {entry["id"]: entry for entry in relisted.json()["views"]}
    assert by_id[first["id"]]["is_default"] is True
    assert by_id[second["id"]]["is_default"] is False
    assert by_id[second["id"]]["revision"] == 2
    assert sum(1 for entry in by_id.values() if entry["is_default"]) == 1


@pytest.mark.anyio
async def test_atomic_revision_allows_only_one_writer(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    request_headers = headers("admin_root", tenant_id)
    created_response = await client.post(
        "/api/v1/workspaces/external/views",
        json={
            "name": "Concurrent view",
            "scope": "personal",
            "definition": {"groupBy": "type"},
            "schema_version": 1,
        },
        headers=request_headers,
    )
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()

    async def writer(name: str):
        return await client.put(
            f"/api/v1/workspaces/views/{created['id']}",
            json={
                "name": name,
                "scope": "personal",
                "definition": {"groupBy": "status"},
                "schema_version": 1,
                "revision": 1,
            },
            headers=request_headers,
        )

    first, second = await asyncio.gather(writer("Concurrent A"), writer("Concurrent B"))
    assert sorted([first.status_code, second.status_code]) == [200, 409], (first.text, second.text)
