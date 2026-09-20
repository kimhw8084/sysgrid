from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import ConfigSessionLocal, get_tenant_engine
from app.models.config import Tenant
from app.models.models import AuditLog


async def _seed_audit_rows(seeded_admin_tenant):
    async with ConfigSessionLocal() as config_db:
        tenant = await config_db.scalar(select(Tenant).where(Tenant.id == seeded_admin_tenant["tenant_id"]))
        assert tenant is not None
        tenant_url = tenant.db_url

    engine = get_tenant_engine(tenant_url)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as db:
        rows = [
            AuditLog(timestamp=datetime(2026, 9, 18, 23, 59, 59, 999999), user_id="u", action="CREATE", target_table="devices", target_id="42", description="before", changes={}),
            AuditLog(timestamp=datetime(2026, 9, 19, 0, 0, 0), user_id="u", action="CREATE", target_table="devices", target_id="42", description="start", changes={}),
            AuditLog(timestamp=datetime(2026, 9, 19, 12, 0, 0), user_id="u", action="UPDATE", target_table="devices", target_id="42", description="same-time-a", changes={}),
            AuditLog(timestamp=datetime(2026, 9, 19, 12, 0, 0), user_id="u", action="UPDATE", target_table="devices", target_id="42", description="same-time-b", changes={}),
            AuditLog(timestamp=datetime(2026, 9, 19, 23, 59, 59, 999999), user_id="u", action="DELETE", target_table="services", target_id="7", description="end", changes={}),
            AuditLog(timestamp=datetime(2026, 9, 20, 0, 0, 0), user_id="u", action="CREATE", target_table="devices", target_id="42", description="after", changes={}),
        ]
        db.add_all(rows)
        await db.commit()


@pytest.mark.anyio
async def test_audit_filters_boundaries_ordering_targets_pagination_and_scope(seeded_admin_tenant):
    await _seed_audit_rows(seeded_admin_tenant)
    client = seeded_admin_tenant["client"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])}

    response = await client.get(
        "/api/v1/audit",
        params={"start_date": "2026-09-19", "end_date": "2026-09-19", "target_table": "devices", "target_id": "42", "limit": 2, "offset": 0},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert isinstance(body, list)
    assert [row["description"] for row in body] == ["same-time-b", "same-time-a"]
    assert response.headers["X-SysGrid-Result-Scope"] == "bounded"
    assert response.headers["X-SysGrid-Result-Limit"] == "2"
    assert response.headers["X-SysGrid-Result-Offset"] == "0"
    assert response.headers["X-SysGrid-Result-Has-More"] == "true"
    assert response.headers["X-SysGrid-Result-Complete"] == "false"

    page_two = await client.get(
        "/api/v1/audit",
        params={"start_date": "2026-09-19", "end_date": "2026-09-19", "target_table": "devices", "target_id": "42", "limit": 2, "offset": 2},
        headers=headers,
    )
    assert page_two.status_code == 200
    assert [row["description"] for row in page_two.json()] == ["start"]
    assert page_two.headers["X-SysGrid-Result-Complete"] == "false"


@pytest.mark.anyio
async def test_audit_rejects_malformed_and_reversed_dates_and_invalid_pagination(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])}

    malformed = await client.get("/api/v1/audit", params={"start_date": "not-a-date"}, headers=headers)
    assert malformed.status_code == 400
    assert "start_date" in malformed.json()["detail"]

    reversed_range = await client.get(
        "/api/v1/audit",
        params={"start_date": "2026-09-20", "end_date": "2026-09-19"},
        headers=headers,
    )
    assert reversed_range.status_code == 400
    assert "on or before" in reversed_range.json()["detail"]

    for params in ({"limit": 0}, {"limit": 501}, {"offset": -1}):
        invalid = await client.get("/api/v1/audit", params=params, headers=headers)
        assert invalid.status_code == 422
