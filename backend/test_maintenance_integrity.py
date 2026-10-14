"""Maintenance mutations must be validated, tenant-bound, and audit-atomic."""
import pytest
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlalchemy.orm import Session

from app.api import maintenance
from app.database import get_tenant_engine
from app.models import models
from app.models.config import Tenant


async def context(seeded_admin_tenant, setup_db):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    response = await client.post("/api/v1/devices", headers=headers, json={
        "name": "Maintenance integrity host", "type": "Physical",
        "system": "Maintenance integrity", "status": "Active",
    })
    assert response.status_code == 200, response.text
    async with setup_db[1]() as registry:
        tenant = await registry.get(Tenant, tenant_id)
        engine = get_tenant_engine(tenant.db_url)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    payload = {
        "device_id": response.json()["id"], "title": "Scheduled patching",
        "start_time": "2030-01-01T10:00:00Z", "end_time": "2030-01-01T11:00:00Z",
    }
    return client, headers, sessions, payload


@pytest.mark.asyncio
async def test_delete_removes_window_and_records_exactly_one_audit(seeded_admin_tenant, setup_db):
    client, headers, sessions, payload = await context(seeded_admin_tenant, setup_db)
    created = await client.post("/api/v1/maintenance", headers=headers, json=payload)
    assert created.status_code == 200, created.text
    window_id = created.json()["id"]
    response = await client.delete(f"/api/v1/maintenance/{window_id}", headers=headers)
    assert response.status_code == 200, response.text
    async with sessions() as db:
        assert await db.get(models.MaintenanceWindow, window_id) is None
        logs = (await db.scalars(select(models.AuditLog).where(
            models.AuditLog.target_table == "maintenance_windows",
            models.AuditLog.target_id == str(window_id),
        ).order_by(models.AuditLog.id))).all()
        assert [log.action for log in logs] == ["CREATE", "DELETE"]
        assert all(log.user_id == "admin_root" for log in logs)
    missing = await client.delete(f"/api/v1/maintenance/{window_id}", headers=headers)
    assert missing.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("changes", [
    {"title": "  "}, {"device_id": None}, {"device_id": True},
    {"start_time": "not-a-date"}, {"start_time": 1900000000},
    {"end_time": "2030-01-01T09:00:00Z"},
    {"end_time": "2030-01-01T10:00:00Z"}, {"end_time": None},
    {"start_time": "2030-01-01T10:00:00", "end_time": "2030-01-01T11:00:00Z"},
])
async def test_invalid_window_is_rejected_without_writes(seeded_admin_tenant, setup_db, changes):
    client, headers, sessions, payload = await context(seeded_admin_tenant, setup_db)
    response = await client.post("/api/v1/maintenance", headers=headers, json={**payload, **changes})
    assert response.status_code == 422, response.text
    async with sessions() as db:
        assert (await db.scalars(select(models.MaintenanceWindow))).all() == []
        assert (await db.scalars(select(models.AuditLog).where(
            models.AuditLog.target_table == "maintenance_windows",
        ))).all() == []


@pytest.mark.asyncio
async def test_reference_validation_and_offset_normalization(seeded_admin_tenant, setup_db):
    client, headers, sessions, payload = await context(seeded_admin_tenant, setup_db)
    missing = await client.post("/api/v1/maintenance", headers=headers, json={**payload, "device_id": 999999})
    assert missing.status_code == 404
    created = await client.post("/api/v1/maintenance", headers=headers, json={
        **payload, "title": "  Scheduled patching  ",
        "start_time": "2030-01-01T12:00:00+02:00", "end_time": "2030-01-01T06:00:00-05:00",
    })
    assert created.status_code == 200, created.text
    async with sessions() as db:
        window = await db.get(models.MaintenanceWindow, created.json()["id"])
        assert window.start_time.hour == 10
        assert window.end_time.hour == 11
        assert window.title == "Scheduled patching"
        device = await db.get(models.Device, payload["device_id"])
        device.is_deleted = True
        await db.commit()
    archived = await client.post("/api/v1/maintenance", headers=headers, json=payload)
    assert archived.status_code == 409


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["create", "delete"])
@pytest.mark.parametrize("failure_point", ["build", "flush"])
async def test_audit_failure_rolls_back_mutation(seeded_admin_tenant, setup_db, monkeypatch, operation, failure_point):
    client, headers, sessions, payload = await context(seeded_admin_tenant, setup_db)
    window_id = None
    if operation == "delete":
        created = await client.post("/api/v1/maintenance", headers=headers, json=payload)
        assert created.status_code == 200
        window_id = created.json()["id"]

    def unavailable_audit(**kwargs):
        raise RuntimeError("controlled audit failure")

    def unavailable_audit_insert(session, flush_context, instances):
        if any(isinstance(row, models.AuditLog) and row.target_table == "maintenance_windows" for row in session.new):
            raise RuntimeError("controlled audit failure")

    if failure_point == "build":
        monkeypatch.setattr(maintenance, "build_audit_log", unavailable_audit)
    else:
        event.listen(Session, "before_flush", unavailable_audit_insert)
    try:
        with pytest.raises(RuntimeError, match="controlled audit failure"):
            if operation == "create":
                await client.post("/api/v1/maintenance", headers=headers, json=payload)
            else:
                await client.delete(f"/api/v1/maintenance/{window_id}", headers=headers)
    finally:
        if failure_point == "flush":
            event.remove(Session, "before_flush", unavailable_audit_insert)
    async with sessions() as db:
        windows = (await db.scalars(select(models.MaintenanceWindow))).all()
        assert [window.id for window in windows] == ([] if operation == "create" else [window_id])
        logs = (await db.scalars(select(models.AuditLog).where(
            models.AuditLog.target_table == "maintenance_windows",
        ))).all()
        assert [log.action for log in logs] == ([] if operation == "create" else ["CREATE"])


@pytest.mark.asyncio
async def test_list_uses_one_query_and_preserves_legacy_windows(seeded_admin_tenant, setup_db):
    _, _, sessions, payload = await context(seeded_admin_tenant, setup_db)
    async with sessions() as db:
        db.add_all([
            models.MaintenanceWindow(device_id=payload["device_id"], title="Legacy undated window"),
            models.MaintenanceWindow(device_id=payload["device_id"], title="Second legacy window"),
        ])
        await db.commit()
        statements = []
        engine = db.bind.sync_engine
        def capture(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)
        event.listen(engine, "before_cursor_execute", capture)
        try:
            rows = await maintenance.get_maintenance_windows(device_id=payload["device_id"], db=db)
        finally:
            event.remove(engine, "before_cursor_execute", capture)
        assert len(statements) == 1
        assert len(rows) == 2
        assert all(row["device_name"] == "Maintenance integrity host" for row in rows)
        assert all(row["start_time"] is None for row in rows)


@pytest.mark.asyncio
async def test_read_only_operator_cannot_create_or_delete(seeded_admin_tenant, setup_db):
    client, headers, sessions, payload = await context(seeded_admin_tenant, setup_db)
    created = await client.post("/api/v1/maintenance", headers=headers, json=payload)
    window_id = created.json()["id"]
    async with sessions() as db:
        operator = await db.scalar(select(models.Operator).where(models.Operator.username == "admin_root"))
        operator.is_admin = False
        operator.custom_permissions = {"all": 0, "assets": 1}
        await db.commit()
    assert (await client.get("/api/v1/maintenance", headers=headers)).status_code == 200
    assert (await client.post("/api/v1/maintenance", headers=headers, json=payload)).status_code == 403
    assert (await client.delete(f"/api/v1/maintenance/{window_id}", headers=headers)).status_code == 403
    async with sessions() as db:
        assert await db.get(models.MaintenanceWindow, window_id) is not None
