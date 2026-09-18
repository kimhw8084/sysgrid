import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.tenants import run_alembic_upgrade
from app.database import get_tenant_engine
from app.models import models
from app.models.config import Tenant, UserTenantAccess


def headers(user_id: str, tenant_id: int) -> dict[str, str]:
    return {"X-User-Id": user_id, "X-Tenant-Id": str(tenant_id)}


async def grant_access(config_session_factory, *, user_id: str, tenant_id: int, role: str = "EDITOR") -> None:
    async with config_session_factory() as db:
        db.add(UserTenantAccess(user_id=user_id, tenant_id=tenant_id, role=role, is_selected=False))
        await db.commit()


async def seed_team(config_session_factory, *, tenant_id: int, name: str, users: list[str]) -> int:
    async with config_session_factory() as config_db:
        tenant = await config_db.get(Tenant, tenant_id)
        assert tenant is not None
        tenant_url = tenant.db_url

    session_factory = async_sessionmaker(
        bind=get_tenant_engine(tenant_url),
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
        class_=AsyncSession,
    )
    async with session_factory() as db:
        team = models.Team(name=name, description="Workspace saved-view test team", source="manual")
        db.add(team)
        await db.flush()
        team_role = models.Role(
            name=f"workspace-team-{name.lower().replace(' ', '-')}",
            permissions={"monitoring": 3},
        )
        db.add(team_role)
        await db.flush()
        for index, user_id in enumerate(users):
            operator = await db.scalar(
                select(models.Operator).where(models.Operator.username == user_id)
            )
            if operator is None:
                db.add(models.Operator(
                    external_id=f"team-view-{name.lower().replace(' ', '-')}-{index}",
                    username=user_id,
                    full_name=user_id,
                    email=f"{user_id}@example.test",
                    role_id=team_role.id,
                    team=name,
                    team_id=team.id,
                    team_source="manual",
                    registration_status="Registered",
                ))
            else:
                operator.team = name
                operator.team_id = team.id
                operator.team_source = "manual"
        await db.commit()
        return team.id


TEAM_VIEW = {
    "name": "Shared operations",
    "scope": "team",
    "definition": {"groupBy": "severity", "quickFilter": "critical"},
    "schema_version": 1,
    "is_favorite": True,
    "is_default": True,
}


@pytest.mark.anyio
async def test_team_saved_views_enforce_membership_identity_defaults_conflicts_and_tenant_isolation(
    seeded_admin_tenant,
    setup_db,
    tmp_path_factory,
):
    client = seeded_admin_tenant["client"]
    tenant_a_id = seeded_admin_tenant["tenant_id"]
    _, config_session_factory = setup_db

    await grant_access(config_session_factory, user_id="team_peer", tenant_id=tenant_a_id)
    await grant_access(config_session_factory, user_id="team_outsider", tenant_id=tenant_a_id)
    team_a_id = await seed_team(
        config_session_factory,
        tenant_id=tenant_a_id,
        name="Workspace Team A",
        users=["admin_root", "team_peer"],
    )
    await seed_team(
        config_session_factory,
        tenant_id=tenant_a_id,
        name="Workspace Team B",
        users=["team_outsider"],
    )

    created_response = await client.post(
        "/api/v1/workspaces/monitoring/views",
        json={**TEAM_VIEW, "team_id": team_a_id},
        headers=headers("admin_root", tenant_a_id),
    )
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()
    assert created["scope"] == "team"
    assert created["team_id"] == team_a_id
    assert created["owner_user_id"] == "admin_root"
    assert created["revision"] == 1
    assert created["is_default"] is True

    peer_list = await client.get(
        f"/api/v1/workspaces/monitoring/views?scope=team&team_id={team_a_id}",
        headers=headers("team_peer", tenant_a_id),
    )
    assert peer_list.status_code == 200, peer_list.text
    assert [view["id"] for view in peer_list.json()["views"]] == [created["id"]]

    peer_get = await client.get(
        f"/api/v1/workspaces/views/{created['id']}",
        headers=headers("team_peer", tenant_a_id),
    )
    assert peer_get.status_code == 200, peer_get.text

    duplicate = await client.post(
        "/api/v1/workspaces/monitoring/views",
        json={**TEAM_VIEW, "team_id": team_a_id},
        headers=headers("team_peer", tenant_a_id),
    )
    assert duplicate.status_code == 409, duplicate.text

    second_response = await client.post(
        "/api/v1/workspaces/monitoring/views",
        json={**TEAM_VIEW, "name": "Shared secondary", "team_id": team_a_id, "is_favorite": False},
        headers=headers("team_peer", tenant_a_id),
    )
    assert second_response.status_code == 201, second_response.text
    second = second_response.json()

    after_second = await client.get(
        f"/api/v1/workspaces/monitoring/views?scope=team&team_id={team_a_id}",
        headers=headers("team_peer", tenant_a_id),
    )
    by_id = {view["id"]: view for view in after_second.json()["views"]}
    assert by_id[created["id"]]["revision"] == 2
    assert by_id[created["id"]]["is_default"] is False
    assert by_id[second["id"]]["is_default"] is True
    assert sum(1 for view in by_id.values() if view["is_default"]) == 1

    stale_update = await client.put(
        f"/api/v1/workspaces/views/{created['id']}",
        json={**TEAM_VIEW, "team_id": team_a_id, "revision": 1},
        headers=headers("team_peer", tenant_a_id),
    )
    assert stale_update.status_code == 409, stale_update.text
    assert stale_update.json()["detail"]["current"]["revision"] == 2

    promoted_response = await client.put(
        f"/api/v1/workspaces/views/{created['id']}",
        json={
            **TEAM_VIEW,
            "name": "Shared operations promoted",
            "team_id": team_a_id,
            "revision": 2,
            "is_favorite": False,
            "is_default": True,
        },
        headers=headers("team_peer", tenant_a_id),
    )
    assert promoted_response.status_code == 200, promoted_response.text
    promoted = promoted_response.json()
    assert promoted["revision"] == 3
    assert promoted["owner_user_id"] == "admin_root"
    assert promoted["is_default"] is True

    outsider_list = await client.get(
        f"/api/v1/workspaces/monitoring/views?scope=team&team_id={team_a_id}",
        headers=headers("team_outsider", tenant_a_id),
    )
    assert outsider_list.status_code == 403, outsider_list.text
    outsider_get = await client.get(
        f"/api/v1/workspaces/views/{created['id']}",
        headers=headers("team_outsider", tenant_a_id),
    )
    assert outsider_get.status_code == 404, outsider_get.text
    outsider_update = await client.put(
        f"/api/v1/workspaces/views/{created['id']}",
        json={**TEAM_VIEW, "team_id": team_a_id, "revision": 3},
        headers=headers("team_outsider", tenant_a_id),
    )
    assert outsider_update.status_code == 404, outsider_update.text

    current_team_views = await client.get(
        f"/api/v1/workspaces/monitoring/views?scope=team&team_id={team_a_id}",
        headers=headers("team_peer", tenant_a_id),
    )
    current_by_id = {view["id"]: view for view in current_team_views.json()["views"]}
    assert current_by_id[second["id"]]["revision"] == 2
    deleted = await client.delete(
        f"/api/v1/workspaces/views/{second['id']}?revision=2",
        headers=headers("team_peer", tenant_a_id),
    )
    assert deleted.status_code == 200, deleted.text

    tenant_b_path = tmp_path_factory.mktemp("workspace_team_views_tenant_b") / "tenant_b.db"
    tenant_b_url = f"sqlite+aiosqlite:///{tenant_b_path}"
    async with config_session_factory() as config_db:
        tenant_b = Tenant(name="Workspace Team Views Tenant B", db_url=tenant_b_url, is_active=True)
        config_db.add(tenant_b)
        await config_db.flush()
        tenant_b_id = tenant_b.id
        config_db.add(UserTenantAccess(user_id="team_peer", tenant_id=tenant_b_id, role="EDITOR", is_selected=False))
        await config_db.commit()
    success, error = run_alembic_upgrade(tenant_b_url)
    assert success, error
    team_b_id = await seed_team(
        config_session_factory,
        tenant_id=tenant_b_id,
        name="Workspace Team A Tenant B",
        users=["team_peer"],
    )

    cross_tenant = await client.get(
        f"/api/v1/workspaces/views/{created['id']}",
        headers=headers("team_peer", tenant_b_id),
    )
    assert cross_tenant.status_code == 404, cross_tenant.text
    tenant_b_list = await client.get(
        f"/api/v1/workspaces/monitoring/views?scope=team&team_id={team_b_id}",
        headers=headers("team_peer", tenant_b_id),
    )
    assert tenant_b_list.status_code == 200, tenant_b_list.text
    assert tenant_b_list.json()["views"] == []
