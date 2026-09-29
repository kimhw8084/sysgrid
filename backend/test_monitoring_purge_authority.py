import json
import sqlite3

import pytest
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlalchemy.exc import IntegrityError

from app.api import monitoring_purge
from app.database import ConfigSessionLocal, get_tenant_engine, sqlite_path_from_url
from app.models import models
from app.models.config import Tenant


async def fixture(seeded):
    async with ConfigSessionLocal() as db:
        tenant = await db.get(Tenant, seeded["tenant_id"])
        url = tenant.db_url
    factory = async_sessionmaker(get_tenant_engine(url), expire_on_commit=False)
    async with factory() as db:
        item = models.MonitoringItem(title="Purge fixture", status="Deleted", is_deleted=True, version=2,
            monitoring_url="https://example.test/?token=secret-sentinel", logic="secret-sentinel",
            notification_recipients=["secret-sentinel"], recovery_docs=[{"note": "secret-sentinel"}])
        db.add(item)
        await db.flush()
        record_id = item.id
        db.add_all([
            models.MonitoringOwner(monitoring_item_id=record_id, name="secret-sentinel"),
            models.MonitoringHistory(monitoring_item_id=record_id, version=2, snapshot={"logic": "secret-sentinel"}),
            models.FarMitigation(monitoring_item_id=record_id),
            models.RcaRecord(monitoring_item_id=record_id),
        ])
        await db.commit()
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded["tenant_id"])}

    async def call(**body):
        return await seeded["client"].post("/api/v1/monitoring/bulk-action", headers=headers,
            json={"ids": [record_id], "action": "purge", **body})

    return record_id, factory, call, url


async def counts(factory):
    async with factory() as db:
        return {model.__tablename__: await db.scalar(select(func.count()).select_from(model))
            for model in (models.MonitoringItem, models.MonitoringOwner, models.MonitoringHistory,
                          models.FarMitigation, models.RcaRecord, models.AuditLog)}


@pytest.mark.anyio
@pytest.mark.parametrize("invalid", ["true", "false", 0, 1, None, [], {}])
async def test_destructive_control_rejects_non_booleans(seeded_admin_tenant, invalid):
    _, factory, call, _ = await fixture(seeded_admin_tenant)
    before = await counts(factory)
    response = await call(dry_run=invalid)
    assert response.status_code == 400
    assert response.json()["detail"] == "dry_run must be a boolean"
    assert await counts(factory) == before


@pytest.mark.anyio
async def test_preview_execution_impact_audit_and_retry(seeded_admin_tenant):
    record_id, factory, call, _ = await fixture(seeded_admin_tenant)
    before = await counts(factory)
    preview = await call(dry_run=True)
    assert preview.status_code == 200, preview.text
    p = preview.json()
    assert p["can_execute"] is True
    assert p["purge_impact"]["aggregate"]["delete_count"] == 3
    assert p["purge_impact"]["aggregate"]["detach_count"] == 2
    assert p["versions"] == {str(record_id): 2}
    assert "secret-sentinel" not in preview.text
    assert await counts(factory) == before
    assert (await call()).status_code == 409
    executed = await call(dry_run=False, precondition=p["precondition"])
    assert executed.status_code == 200, executed.text
    assert executed.json()["purge_impact_applied"] == p["purge_impact"]
    assert executed.json()["changed_ids"] == [record_id]
    assert executed.json()["can_revert"] is False
    after = await counts(factory)
    assert after["monitoring_items"] == after["monitoring_owners"] == after["monitoring_history"] == 0
    assert after["far_mitigations"] == after["rca_records"] == 1
    async with factory() as db:
        assert await db.scalar(select(models.FarMitigation.monitoring_item_id)) is None
        assert await db.scalar(select(models.RcaRecord.monitoring_item_id)) is None
        audit = (await db.execute(select(models.AuditLog).where(models.AuditLog.action == "PURGE"))).scalar_one()
        assert audit.target_table == "monitoring_items" and audit.target_id == str(record_id)
        assert audit.user_id == "admin_root"
        assert audit.changes["prior_version"] == 2
        assert "secret-sentinel" not in json.dumps(audit.changes)
    assert (await call(precondition=p["precondition"])).status_code == 409
    assert (await call(action="restore_purged", payload={"snapshots": [{"id": record_id, "title": "Forged"}]})).status_code == 400
    assert await counts(factory) == after


@pytest.mark.anyio
@pytest.mark.parametrize("change", ["version", "active", "dependency", "same_count_dependency", "missing"])
async def test_stale_preview_never_expands_or_partially_purges(seeded_admin_tenant, change):
    record_id, factory, call, _ = await fixture(seeded_admin_tenant)
    preview = (await call(dry_run=True)).json()
    async with factory() as db:
        if change == "version":
            await db.execute(update(models.MonitoringItem).values(version=3).where(models.MonitoringItem.id == record_id))
        elif change == "active":
            await db.execute(update(models.MonitoringItem).values(is_deleted=False, status="Existing").where(models.MonitoringItem.id == record_id))
        elif change in {"dependency", "same_count_dependency"}:
            if change == "same_count_dependency":
                await db.execute(delete(models.FarMitigation).where(models.FarMitigation.monitoring_item_id == record_id))
            db.add(models.FarMitigation(id=999, monitoring_item_id=record_id))
        else:
            await db.execute(delete(models.MonitoringItem).where(models.MonitoringItem.id == record_id))
        await db.commit()
    before = await counts(factory)
    response = await call(precondition=preview["precondition"])
    assert response.status_code == 409, response.text
    assert await counts(factory) == before
    fresh = await call(dry_run=True)
    assert fresh.status_code == 200
    assert fresh.json()["can_execute"] is (change not in {"active", "missing"})
    if change not in {"active", "missing"}:
        assert (await call(precondition=fresh.json()["precondition"])).status_code == 200


@pytest.mark.anyio
async def test_missing_selection_and_unsupported_preview_are_non_mutating(seeded_admin_tenant):
    record_id, factory, call, _ = await fixture(seeded_admin_tenant)
    before = await counts(factory)
    response = await call(ids=[record_id, 999999], dry_run=True)
    assert response.json()["missing_ids"] == [999999]
    assert response.json()["can_execute"] is False
    assert (await call(ids=[record_id, 999999], precondition=response.json()["precondition"])).status_code == 409
    assert (await call(action="restore", dry_run=True)).status_code == 400
    assert await counts(factory) == before


@pytest.mark.anyio
async def test_audit_failure_rolls_back_whole_purge(seeded_admin_tenant, monkeypatch):
    _, factory, call, _ = await fixture(seeded_admin_tenant)
    preview = (await call(dry_run=True)).json()
    async with factory() as db:
        db.add(models.AuditLog(id=99999, action="TEST_ONLY"))
        await db.commit()
    before = await counts(factory)
    original = monitoring_purge.build_audit_log

    def invalid_audit(**kwargs):
        result = original(**kwargs)
        result.id = 99999  # Force a real unique-key failure while flushing audit.
        return result

    monkeypatch.setattr(monitoring_purge, "build_audit_log", invalid_audit)
    with pytest.raises(IntegrityError):
        await call(precondition=preview["precondition"])
    assert await counts(factory) == before


@pytest.mark.anyio
async def test_sqlite_reservation_excludes_concurrent_dependency_writer(seeded_admin_tenant, monkeypatch):
    record_id, _, call, url = await fixture(seeded_admin_tenant)
    preview = (await call(dry_run=True)).json()
    original = monitoring_purge.build_audit_log
    checked = []

    def check_reserved(**kwargs):
        with sqlite3.connect(sqlite_path_from_url(url), timeout=0) as other:
            with pytest.raises(sqlite3.OperationalError, match="locked"):
                other.execute("UPDATE far_mitigations SET monitoring_item_id = NULL WHERE monitoring_item_id = ?", (record_id,))
        checked.append(True)
        return original(**kwargs)

    monkeypatch.setattr(monitoring_purge, "build_audit_log", check_reserved)
    response = await call(precondition=preview["precondition"])
    assert response.status_code == 200, response.text
    assert checked == [True]
