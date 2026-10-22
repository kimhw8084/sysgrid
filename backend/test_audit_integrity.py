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


@pytest.mark.anyio
@pytest.mark.parametrize("start,end", [
    ("2026-03-08T00:00:00-06:00", "2026-03-09T00:00:00-05:00"),
    ("2026-11-01T00:00:00-05:00", "2026-11-02T00:00:00-06:00"),
    ("2026-03-08T00:00:00+09:00", "2026-03-09T00:00:00+09:00"),
    ("2026-03-08T00:00:00Z", "2026-03-09T00:00:00Z"),
])
async def test_audit_explicit_instant_filter_controls(seeded_admin_tenant, start, end):
    from datetime import timedelta, timezone

    lower = datetime.fromisoformat(start.replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)
    upper = datetime.fromisoformat(end.replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)
    async with ConfigSessionLocal() as config_db:
        tenant = await config_db.scalar(select(Tenant).where(Tenant.id == seeded_admin_tenant["tenant_id"]))
        tenant_url = tenant.db_url
    factory = async_sessionmaker(bind=get_tenant_engine(tenant_url), class_=AsyncSession, expire_on_commit=False)
    async with factory() as db:
        db.add_all([AuditLog(timestamp=value, user_id="u", action="CREATE", target_table="devices", target_id="calendar-proof", description=label, changes={}) for label, value in [
            ("before", lower - timedelta(microseconds=1)),
            ("start", lower),
            ("inside", lower + timedelta(hours=1)),
            ("end", upper - timedelta(microseconds=1)),
            ("after", upper),
        ]])
        await db.commit()
    response = await seeded_admin_tenant["client"].get("/api/v1/audit", params={"start_at": start, "end_before": end, "target_table": "devices", "target_id": "calendar-proof"}, headers={"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])})
    assert response.status_code == 200, response.text
    assert [row["description"] for row in response.json()] == ["end", "inside", "start"]
    assert response.headers["X-SysGrid-Result-Complete"] == "true"


@pytest.mark.anyio
async def test_audit_explicit_instant_rejects_naive_control(seeded_admin_tenant):
    response = await seeded_admin_tenant["client"].get("/api/v1/audit", params={"start_at": "2026-03-08T00:00:00"}, headers={"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])})
    assert response.status_code == 400
    assert "start_at" in response.json()["detail"]


@pytest.mark.anyio
async def test_audit_legacy_maximum_calendar_control(seeded_admin_tenant):
    response = await seeded_admin_tenant["client"].get("/api/v1/audit", params={"end_date": "9999-12-31"}, headers={"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])})
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.anyio
@pytest.mark.parametrize("params", [
    {"start_at": ""}, {"end_before": " "}, {"start_at": "not-an-instant"},
    {"start_at": "2026-03-08"}, {"end_before": "2026-03-08T00:00:00"},
    {"start_at": "2026-13-08T00:00:00Z"}, {"end_before": "2026-03-08T00:00:00+25:00"},
    {"start_at": "0000-01-01T00:00:00Z"}, {"end_before": "+010000-01-01T00:00:00Z"},
    {"start_at": "0001-01-01T00:00:00+14:00"}, {"end_before": "9999-12-31T23:59:59.999999-14:00"},
    {"start_at": "2026-03-09T00:00:00Z", "end_before": "2026-03-08T00:00:00Z"},
    {"start_date": "", "start_at": "2026-03-08T00:00:00Z"},
    {"end_date": "2026-03-08", "end_before": ""},
    {"start_date": "", "end_before": ""},
])
async def test_audit_rejects_invalid_or_mixed_instant_ranges(seeded_admin_tenant, params):
    response = await seeded_admin_tenant["client"].get("/api/v1/audit", params=params, headers={"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])})
    assert response.status_code == 400, response.text


@pytest.mark.anyio
async def test_audit_minimum_maximum_microseconds_and_equal_bounds(seeded_admin_tenant):
    async with ConfigSessionLocal() as config_db:
        tenant = await config_db.scalar(select(Tenant).where(Tenant.id == seeded_admin_tenant["tenant_id"]))
        tenant_url = tenant.db_url
    factory = async_sessionmaker(bind=get_tenant_engine(tenant_url), class_=AsyncSession, expire_on_commit=False)
    async with factory() as db:
        db.add_all([AuditLog(timestamp=value, user_id="u", action="CREATE", target_table="devices", target_id="extremes", description=label, changes={}) for label, value in [
            ("minimum", datetime.min),
            ("near-maximum", datetime(9999, 12, 31, 23, 59, 59, 999998)),
            ("maximum", datetime.max),
        ]])
        await db.commit()
    cases = [
        ({"start_at": "0001-01-01T00:00:00Z"}, ["maximum", "near-maximum", "minimum"]),
        ({"end_before": "0001-01-01T00:00:00.000001Z"}, ["minimum"]),
        ({"start_at": "9999-12-31T23:59:59.999998Z"}, ["maximum", "near-maximum"]),
        ({"end_before": "9999-12-31T23:59:59.999999Z"}, ["near-maximum", "minimum"]),
        ({"start_at": "9999-12-31T23:59:59.999999Z", "end_before": "9999-12-31T23:59:59.999999Z"}, []),
        ({"start_date": "0001-01-01", "end_date": "0001-01-01"}, ["minimum"]),
        ({"end_date": "9999-12-31"}, ["maximum", "near-maximum", "minimum"]),
    ]
    for params, expected in cases:
        response = await seeded_admin_tenant["client"].get("/api/v1/audit", params={**params, "target_id": "extremes"}, headers={"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])})
        assert response.status_code == 200, response.text
        assert [row["description"] for row in response.json()] == expected
        assert response.headers["X-SysGrid-Result-Complete"] == "true"
