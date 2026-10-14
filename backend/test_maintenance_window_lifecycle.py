import asyncio
import sqlite3
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import select

from app.api import maintenance
from app.models import models
from app.operational_actions import service
from test_maintenance_integrity import context


def test_upgrade_preserves_legacy_windows_and_allows_multiple_unkeyed_records(tmp_path):
    config = Config(str(Path(__file__).with_name("alembic.ini")))
    database = tmp_path / "legacy-maintenance.db"
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    command.upgrade(config, "c9f2a1e8d7b6")
    with sqlite3.connect(database) as db:
        db.execute("INSERT INTO maintenance_windows (id, title, status) VALUES (77, 'Legacy undated record', NULL)")
        before = db.execute("SELECT * FROM maintenance_windows WHERE id = 77").fetchone()
    command.upgrade(config, "head")
    command.upgrade(config, "head")
    with sqlite3.connect(database) as db:
        after = db.execute("SELECT * FROM maintenance_windows WHERE id = 77").fetchone()
        assert after[:len(before)] == before
        assert after[len(before):] == (None,) * 5
        db.execute("INSERT INTO maintenance_windows (id, title) VALUES (78, 'Second unkeyed record')")
        db.execute("INSERT INTO maintenance_windows (id, title, creation_key_hash) VALUES (79, 'Keyed record', 'test-key')")
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("INSERT INTO maintenance_windows (id, creation_key_hash) VALUES (80, 'test-key')")


async def linked_action(client, headers, payload, window_id, *, confirm=True):
    created = await client.post("/api/v1/operational-actions", headers=headers, json={
        "action_key": "telemetry.snapshot", "target_device_ids": [payload["device_id"]],
        "maintenance_window_id": window_id, "idempotency_key": str(uuid4()),
    })
    assert created.status_code == 200, created.text
    action_id = created.json()["id"]
    preview = await client.post(f"/api/v1/operational-actions/{action_id}/preview", headers=headers)
    assert preview.status_code == 200, preview.text
    assert preview.json()["precondition_snapshot"]["maintenance_window"]["id"] == window_id
    token = preview.json()["preview_token"]
    if confirm:
        response = await client.post(f"/api/v1/operational-actions/{action_id}/confirm", headers=headers,
                                    json={"preview_token": token, "confirmation": True})
        assert response.status_code == 200, response.text
    return action_id, token


@pytest.mark.asyncio
async def test_concurrent_creation_replays_once_and_rejects_changed_payload(seeded_admin_tenant, setup_db):
    client, headers, sessions, payload = await context(seeded_admin_tenant, setup_db)
    headers = {**headers, "Idempotency-Key": str(uuid4())}
    replies = await asyncio.gather(*(client.post("/api/v1/maintenance", headers=headers, json=payload) for _ in range(6)))
    assert all(reply.status_code == 200 for reply in replies), [reply.text for reply in replies]
    assert len({reply.json()["id"] for reply in replies}) == 1
    assert "creation_key_hash" not in replies[0].json()
    assert replies[0].json()["created_by_user_id"] == "admin_root"
    assert replies[0].json()["created_at"]
    conflict = await client.post("/api/v1/maintenance", headers=headers, json={**payload, "title": "Different intent"})
    assert conflict.status_code == 409
    async with sessions() as db:
        assert len((await db.scalars(select(models.MaintenanceWindow))).all()) == 1
        assert len((await db.scalars(select(models.AuditLog).where(models.AuditLog.target_table == "maintenance_windows"))).all()) == 1


@pytest.mark.asyncio
async def test_cancel_preserves_lineage_and_blocks_confirmed_execution(seeded_admin_tenant, setup_db):
    client, headers, sessions, payload = await context(seeded_admin_tenant, setup_db)
    created = await client.post("/api/v1/maintenance", headers=headers, json=payload)
    window_id = created.json()["id"]
    action_id, token = await linked_action(client, headers, payload, window_id)
    assert (await client.delete(f"/api/v1/maintenance/{window_id}", headers=headers)).status_code == 409
    cancel = await client.post(f"/api/v1/maintenance/{window_id}/cancel", headers=headers, json={"reason": "Change rescheduled"})
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["status"] == "Cancelled"
    assert cancel.json()["cancelled_by"] == "admin_root"
    repeat = await client.post(f"/api/v1/maintenance/{window_id}/cancel", headers=headers, json={"reason": "Do not overwrite original reason"})
    assert repeat.status_code == 200
    assert repeat.json() == cancel.json()
    execute = await client.post(f"/api/v1/operational-actions/{action_id}/execute", headers=headers, json={"preview_token": token})
    assert execute.status_code == 409, execute.text
    assert execute.json()["detail"]["code"] == "MAINTENANCE_WINDOW_UNAVAILABLE"
    current = (await client.get(f"/api/v1/operational-actions/{action_id}", headers=headers)).json()
    assert current["status"] == "STALE"
    assert current["maintenance_window_id"] == window_id
    assert current["attempts"] == []
    assert (await client.post(f"/api/v1/operational-actions/{action_id}/preview", headers=headers)).status_code == 409
    new = await client.post("/api/v1/operational-actions", headers=headers, json={
        "action_key": "telemetry.snapshot", "target_device_ids": [payload["device_id"]],
        "maintenance_window_id": window_id, "idempotency_key": str(uuid4()),
    })
    assert new.status_code == 409
    async with sessions() as db:
        window = await db.get(models.MaintenanceWindow, window_id)
        assert window.title == payload["title"]
        assert window.cancellation_reason == "Change rescheduled"
        logs = (await db.scalars(select(models.AuditLog).where(models.AuditLog.target_table == "maintenance_windows").order_by(models.AuditLog.id))).all()
        assert [log.action for log in logs] == ["CREATE", "CANCEL"]
        assert logs[-1].changes == {"reason": "Change rescheduled"}


@pytest.mark.asyncio
async def test_cancellation_waits_for_execution_claim_and_rejects_active_attempt(seeded_admin_tenant, setup_db, monkeypatch):
    client, headers, sessions, payload = await context(seeded_admin_tenant, setup_db)
    window_id = (await client.post("/api/v1/maintenance", headers=headers, json=payload)).json()["id"]
    action_id, token = await linked_action(client, headers, payload, window_id)
    preview_locked, release_preview = asyncio.Event(), asyncio.Event()
    claimed, release_progress = asyncio.Event(), asyncio.Event()
    original_preview, original_progress = service._ensure_fresh_preview, service._record_adapter_progress

    async def held_preview(*args, **kwargs):
        result = await original_preview(*args, **kwargs)
        preview_locked.set()
        await release_preview.wait()
        return result

    async def held_progress(*args, **kwargs):
        claimed.set()
        await release_progress.wait()
        return await original_progress(*args, **kwargs)

    monkeypatch.setattr(service, "_ensure_fresh_preview", held_preview)
    monkeypatch.setattr(service, "_record_adapter_progress", held_progress)
    execute = asyncio.create_task(client.post(f"/api/v1/operational-actions/{action_id}/execute", headers=headers, json={"preview_token": token}))
    cancel = None
    try:
        await asyncio.wait_for(preview_locked.wait(), 5)
        cancel = asyncio.create_task(client.post(f"/api/v1/maintenance/{window_id}/cancel", headers=headers, json={"reason": "Concurrent cancellation"}))
        release_preview.set()
        await asyncio.wait_for(claimed.wait(), 5)
        rejected = await asyncio.wait_for(cancel, 5)
        assert rejected.status_code == 409, rejected.text
    finally:
        release_preview.set()
        release_progress.set()
        completed = await execute
        if cancel is not None and not cancel.done():
            await cancel
    assert completed.status_code == 200, completed.text
    async with sessions() as db:
        assert (await db.get(models.MaintenanceWindow, window_id)).status == "Scheduled"
    # Closing a booking after completed work preserves the work and permits recovery.
    assert (await client.post(f"/api/v1/maintenance/{window_id}/cancel", headers=headers, json={"reason": "Booking closed"})).status_code == 200
    rollback = await client.post(f"/api/v1/operational-actions/{action_id}/rollback", headers=headers,
                                 json={"execute": True, "attempt_id": str(uuid4()), "reason": "Required recovery"})
    assert rollback.status_code == 200, rollback.text
    assert rollback.json()["status"] == "ROLLED_BACK"


@pytest.mark.asyncio
async def test_window_revision_invalidates_preview(seeded_admin_tenant, setup_db):
    client, headers, sessions, payload = await context(seeded_admin_tenant, setup_db)
    window_id = (await client.post("/api/v1/maintenance", headers=headers, json=payload)).json()["id"]
    action_id, token = await linked_action(client, headers, payload, window_id, confirm=False)
    async with sessions() as db:
        window = await db.get(models.MaintenanceWindow, window_id)
        window.coordinator = "Changed coordinator"
        await db.commit()
    response = await client.post(f"/api/v1/operational-actions/{action_id}/confirm", headers=headers, json={"preview_token": token})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "STALE_PREVIEW"


@pytest.mark.asyncio
async def test_canceled_window_cannot_generate_preview_and_records_stale_state(seeded_admin_tenant, setup_db):
    client, headers, sessions, payload = await context(seeded_admin_tenant, setup_db)
    window_id = (await client.post("/api/v1/maintenance", headers=headers, json=payload)).json()["id"]
    action_id, _ = await linked_action(client, headers, payload, window_id, confirm=False)
    assert (await client.post(f"/api/v1/maintenance/{window_id}/cancel", headers=headers, json={"reason": "Withdrawn before confirmation"})).status_code == 200
    assert (await client.post(f"/api/v1/operational-actions/{action_id}/preview", headers=headers)).status_code == 409
    current = (await client.get(f"/api/v1/operational-actions/{action_id}", headers=headers)).json()
    assert current["status"] == "STALE"
    assert current["attempts"] == []


@pytest.mark.asyncio
async def test_cancel_is_atomic_with_audit_and_enforces_write_access(seeded_admin_tenant, setup_db, monkeypatch):
    client, headers, sessions, payload = await context(seeded_admin_tenant, setup_db)
    window_id = (await client.post("/api/v1/maintenance", headers=headers, json=payload)).json()["id"]
    original = maintenance.build_audit_log
    def failed_audit(**kwargs):
        raise RuntimeError("controlled cancellation audit failure")
    monkeypatch.setattr(maintenance, "build_audit_log", failed_audit)
    with pytest.raises(RuntimeError, match="controlled cancellation"):
        await client.post(f"/api/v1/maintenance/{window_id}/cancel", headers=headers, json={"reason": "Rollback all changes"})
    monkeypatch.setattr(maintenance, "build_audit_log", original)
    async with sessions() as db:
        window = await db.get(models.MaintenanceWindow, window_id)
        assert window.status == "Scheduled" and window.cancelled_at is None
        operator = await db.scalar(select(models.Operator).where(models.Operator.username == "admin_root"))
        operator.is_admin = False
        operator.custom_permissions = {"all": 0, "assets": 1}
        await db.commit()
    assert (await client.post(f"/api/v1/maintenance/{window_id}/cancel", headers=headers, json={"reason": "Unauthorized"})).status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [{}, {"reason": " "}, {"reason": "x" * 2001}, {"reason": "valid", "status": "Scheduled"}])
async def test_cancel_requires_bounded_reason_and_no_extra_mutations(seeded_admin_tenant, setup_db, body):
    client, headers, sessions, payload = await context(seeded_admin_tenant, setup_db)
    window_id = (await client.post("/api/v1/maintenance", headers=headers, json=payload)).json()["id"]
    assert (await client.post(f"/api/v1/maintenance/{window_id}/cancel", headers=headers, json=body)).status_code == 422
    async with sessions() as db:
        assert (await db.get(models.MaintenanceWindow, window_id)).status == "Scheduled"
