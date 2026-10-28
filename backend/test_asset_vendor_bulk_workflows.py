from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

import pytest
from sqlalchemy import select

from app.api.settings import ensure_tenant_admin_async
from app.database import ConfigSessionLocal
from app.models.config import Tenant


async def _ensure_admin(seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    async with ConfigSessionLocal() as config_db:
        tenant = (await config_db.execute(select(Tenant).filter(Tenant.id == tenant_id))).scalar_one()
    await ensure_tenant_admin_async(
        tenant_db_url=tenant.db_url,
        admin_user="admin_root",
        full_name="Admin Root",
        email="admin_root@test.com",
        department="IT",
    )


async def _create_device(client, headers, name: str, environment: str = "Production"):
    response = await client.post(
        "/api/v1/devices",
        json={
            "name": name,
            "system": "BULK-WAVE-2",
            "status": "Active",
            "type": "Physical",
            "environment": environment,
            "serial_number": f"SN-{name}",
            "asset_tag": f"AT-{name}",
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _create_vendor(client, headers, name: str, country: str = "USA"):
    response = await client.post(
        "/api/v1/vendors",
        json={"name": name, "country": country},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.anyio
async def test_asset_bulk_preview_execution_and_reversible_lifecycle(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant)

    first = await _create_device(client, headers, "W2-ASSET-A")
    second = await _create_device(client, headers, "W2-ASSET-B")
    ids = [first["id"], second["id"]]

    preview = await client.post(
        "/api/v1/devices/bulk-action",
        json={"ids": ids, "action": "update", "payload": {"environment": "Development"}, "dry_run": True},
        headers=headers,
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["selected_count"] == 2
    assert preview.json()["changed_count"] == 2
    assert preview.json()["unchanged_count"] == 0
    assert preview.json()["can_execute"] is True

    before = await client.get("/api/v1/devices?include_deleted=true", headers=headers)
    before_rows = {row["id"]: row for row in before.json()}
    assert [before_rows[record_id]["environment"] for record_id in ids] == ["Production", "Production"]

    execute = await client.post(
        "/api/v1/devices/bulk-action",
        json={"ids": ids, "action": "update", "payload": {"environment": "Development"}},
        headers=headers,
    )
    assert execute.status_code == 200, execute.text
    assert execute.json()["changed_count"] == 2
    after = await client.get("/api/v1/devices?include_deleted=true", headers=headers)
    after_rows = {row["id"]: row for row in after.json()}
    assert [after_rows[record_id]["environment"] for record_id in ids] == ["Development", "Development"]

    archive_preview = await client.post(
        "/api/v1/devices/bulk-action",
        json={"ids": ids, "action": "delete", "dry_run": True},
        headers=headers,
    )
    assert archive_preview.status_code == 200
    assert archive_preview.json()["changed_count"] == 2

    archived = await client.post(
        "/api/v1/devices/bulk-action",
        json={"ids": ids, "action": "delete"},
        headers=headers,
    )
    assert archived.status_code == 200
    assert archived.json()["changed_count"] == 2

    restored = await client.post(
        "/api/v1/devices/bulk-action",
        json={"ids": ids, "action": "restore"},
        headers=headers,
    )
    assert restored.status_code == 200
    assert restored.json()["changed_count"] == 2

    active_purge = await client.post(
        "/api/v1/devices/bulk-action",
        json={"ids": ids, "action": "purge", "dry_run": True},
        headers=headers,
    )
    assert active_purge.status_code == 200
    assert active_purge.json()["can_execute"] is True
    assert active_purge.json()["changed_count"] == 2

    decimal_id = await client.post(
        "/api/v1/devices/bulk-action",
        json={"ids": [1.5], "action": "delete", "dry_run": True},
        headers=headers,
    )
    assert decimal_id.status_code == 400


@pytest.mark.anyio
async def test_vendor_bulk_preview_country_receipt_and_lifecycle(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant)

    first = await _create_vendor(client, headers, "W2-VENDOR-A")
    second = await _create_vendor(client, headers, "W2-VENDOR-B")
    ids = [first["id"], second["id"]]

    preview = await client.post(
        "/api/v1/vendors/bulk-action",
        json={"ids": ids, "action": "update", "target": "vendor", "payload": {"country": "South Korea"}, "dry_run": True},
        headers=headers,
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["selected_count"] == 2
    assert preview.json()["changed_count"] == 2
    assert preview.json()["can_execute"] is True

    before = await client.get("/api/v1/vendors?include_deleted=true", headers=headers)
    before_rows = {row["id"]: row for row in before.json()}
    assert [before_rows[record_id]["country"] for record_id in ids] == ["USA", "USA"]

    execute = await client.post(
        "/api/v1/vendors/bulk-action",
        json={"ids": ids, "action": "update", "target": "vendor", "payload": {"country": "South Korea"}, "precondition": preview.json()["precondition"], "operation_id": preview.json()["operation_id"]},
        headers=headers,
    )
    assert execute.status_code == 200, execute.text
    assert execute.json()["changed_count"] == 2
    replay = await client.post(
        "/api/v1/vendors/bulk-action",
        json={"ids": ids, "action": "update", "target": "vendor", "payload": {"country": "South Korea"}, "precondition": preview.json()["precondition"], "operation_id": preview.json()["operation_id"]},
        headers=headers,
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["receipt_id"] == execute.json()["receipt_id"]
    conflicting_replay = await client.post(
        "/api/v1/vendors/bulk-action",
        json={"ids": ids, "action": "update", "target": "vendor", "payload": {"country": "Japan"}, "precondition": preview.json()["precondition"], "operation_id": preview.json()["operation_id"]},
        headers=headers,
    )
    assert conflicting_replay.status_code == 409
    no_op_preview = await client.post(
        "/api/v1/vendors/bulk-action",
        json={"ids": ids, "action": "update", "target": "vendor", "payload": {"country": "South Korea"}, "dry_run": True},
        headers=headers,
    )
    no_op = await client.post(
        "/api/v1/vendors/bulk-action",
        json={"ids": ids, "action": "update", "target": "vendor", "payload": {"country": "South Korea"}, "precondition": no_op_preview.json()["precondition"], "operation_id": no_op_preview.json()["operation_id"]},
        headers=headers,
    )
    assert no_op.status_code == 200, no_op.text
    assert no_op.json()["changed_count"] == 0
    assert no_op.json()["receipt_id"]
    no_op_replay = await client.post(
        "/api/v1/vendors/bulk-action",
        json={"ids": ids, "action": "update", "target": "vendor", "payload": {"country": "South Korea"}, "precondition": no_op_preview.json()["precondition"], "operation_id": no_op_preview.json()["operation_id"]},
        headers=headers,
    )
    assert no_op_replay.status_code == 200, no_op_replay.text
    assert no_op_replay.json()["receipt_id"] == no_op.json()["receipt_id"]

    after = await client.get("/api/v1/vendors?include_deleted=true", headers=headers)
    after_rows = {row["id"]: row for row in after.json()}
    assert [after_rows[record_id]["country"] for record_id in ids] == ["South Korea", "South Korea"]

    archive_preview = await client.post(
        "/api/v1/vendors/bulk-action",
        json={"ids": ids, "action": "delete", "target": "vendor", "dry_run": True},
        headers=headers,
    )
    archived = await client.post(
        "/api/v1/vendors/bulk-action",
        json={"ids": ids, "action": "delete", "target": "vendor", "precondition": archive_preview.json()["precondition"], "operation_id": archive_preview.json()["operation_id"]},
        headers=headers,
    )
    assert archived.status_code == 200
    assert archived.json()["changed_count"] == 2

    restore_preview = await client.post(
        "/api/v1/vendors/bulk-action",
        json={"ids": ids, "action": "restore", "target": "vendor", "dry_run": True},
        headers=headers,
    )
    restored = await client.post(
        "/api/v1/vendors/bulk-action",
        json={"ids": ids, "action": "restore", "target": "vendor", "precondition": restore_preview.json()["precondition"], "operation_id": restore_preview.json()["operation_id"]},
        headers=headers,
    )
    assert restored.status_code == 200
    assert restored.json()["changed_count"] == 2

    active_purge = await client.post(
        "/api/v1/vendors/bulk-action",
        json={"ids": ids, "action": "purge", "target": "vendor", "dry_run": True},
        headers=headers,
    )
    assert active_purge.status_code == 200
    assert active_purge.json()["can_execute"] is False
    assert active_purge.json()["blocked_count"] == 2

    archive_again_preview = await client.post(
        "/api/v1/vendors/bulk-action",
        json={"ids": ids, "action": "delete", "target": "vendor", "dry_run": True},
        headers=headers,
    )
    archived_again = await client.post(
        "/api/v1/vendors/bulk-action",
        json={"ids": ids, "action": "delete", "target": "vendor", "precondition": archive_again_preview.json()["precondition"], "operation_id": archive_again_preview.json()["operation_id"]},
        headers=headers,
    )
    assert archived_again.status_code == 200
    purge_preview = await client.post(
        "/api/v1/vendors/bulk-action",
        json={"ids": ids, "action": "purge", "target": "vendor", "dry_run": True},
        headers=headers,
    )
    assert purge_preview.status_code == 200
    assert purge_preview.json()["can_execute"] is True
    purged = await client.post(
        "/api/v1/vendors/bulk-action",
        json={"ids": ids, "action": "purge", "target": "vendor", "precondition": purge_preview.json()["precondition"], "operation_id": purge_preview.json()["operation_id"]},
        headers=headers,
    )
    assert purged.status_code == 200
    assert purged.json()["changed_count"] == 2

    unsupported = await client.post(
        "/api/v1/vendors/bulk-action",
        json={"ids": ids, "action": "update", "target": "vendor", "payload": {"name": "NOPE"}, "dry_run": True},
        headers=headers,
    )
    assert unsupported.status_code == 400


@pytest.mark.anyio
async def test_vendor_contract_listing_archive_restore_and_purge_are_safe(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant)
    vendor = await _create_vendor(client, headers, "W2-CONTRACT-VENDOR")
    personnel = await client.post(f"/api/v1/vendors/{vendor['id']}/personnel", headers=headers, json={"name": "Retained contact"})
    assert personnel.status_code == 200, personnel.text

    created = await client.post("/api/v1/vendors/contracts", headers=headers, json={
        "vendor_id": vendor["id"],
        "title": "W2 contract lifecycle",
        "contract_id": "W2-CONTRACT-01",
        "status": "Completed",
        "effective_date": "2026-01-01T00:00:00",
        "expiry_date": "2027-01-01T00:00:00",
    })
    assert created.status_code == 200, created.text
    contract_id = created.json()["id"]

    listed = await client.get("/api/v1/vendors/contracts", headers=headers)
    assert listed.status_code == 200, listed.text
    assert any(row["id"] == contract_id for row in listed.json())

    contract_archive_preview = await client.post("/api/v1/vendors/bulk-action", headers=headers, json={
        "ids": [contract_id], "action": "delete", "target": "contract", "dry_run": True,
    })
    archived = await client.post("/api/v1/vendors/bulk-action", headers=headers, json={
        "ids": [contract_id], "action": "delete", "target": "contract",
        "precondition": contract_archive_preview.json()["precondition"], "operation_id": contract_archive_preview.json()["operation_id"],
    })
    assert archived.status_code == 200, archived.text
    active = await client.get("/api/v1/vendors/contracts", headers=headers)
    assert all(row["id"] != contract_id for row in active.json())

    contract_restore_preview = await client.post("/api/v1/vendors/bulk-action", headers=headers, json={
        "ids": [contract_id], "action": "restore", "target": "contract", "dry_run": True,
    })
    restored = await client.post("/api/v1/vendors/bulk-action", headers=headers, json={
        "ids": [contract_id], "action": "restore", "target": "contract",
        "precondition": contract_restore_preview.json()["precondition"], "operation_id": contract_restore_preview.json()["operation_id"],
    })
    assert restored.status_code == 200, restored.text
    active_after_restore = await client.get("/api/v1/vendors/contracts", headers=headers)
    assert any(row["id"] == contract_id for row in active_after_restore.json())

    blocked_purge = await client.post("/api/v1/vendors/bulk-action", headers=headers, json={
        "ids": [contract_id], "action": "purge", "target": "contract", "dry_run": True,
    })
    assert blocked_purge.status_code == 200, blocked_purge.text
    assert blocked_purge.json()["can_execute"] is False
    assert "Archive this contract" in blocked_purge.json()["blockers"][0]["reason"]

    contract_archive_again_preview = await client.post("/api/v1/vendors/bulk-action", headers=headers, json={
        "ids": [contract_id], "action": "delete", "target": "contract", "dry_run": True,
    })
    archived_again = await client.post("/api/v1/vendors/bulk-action", headers=headers, json={
        "ids": [contract_id], "action": "delete", "target": "contract",
        "precondition": contract_archive_again_preview.json()["precondition"], "operation_id": contract_archive_again_preview.json()["operation_id"],
    })
    assert archived_again.status_code == 200, archived_again.text
    contract_purge_preview = await client.post("/api/v1/vendors/bulk-action", headers=headers, json={
        "ids": [contract_id], "action": "purge", "target": "contract", "dry_run": True,
    })
    assert contract_purge_preview.status_code == 200, contract_purge_preview.text
    assert contract_purge_preview.json()["can_execute"] is True
    purged = await client.post("/api/v1/vendors/bulk-action", headers=headers, json={
        "ids": [contract_id], "action": "purge", "target": "contract", "precondition": contract_purge_preview.json()["precondition"], "operation_id": contract_purge_preview.json()["operation_id"],
    })
    assert purged.status_code == 200, purged.text
    retained = await client.get("/api/v1/vendors/contracts?include_deleted=true", headers=headers)
    assert all(row["id"] != contract_id for row in retained.json())

    vendor_archive_preview = await client.post("/api/v1/vendors/bulk-action", headers=headers, json={
        "ids": [vendor["id"]], "action": "delete", "target": "vendor", "dry_run": True,
    })
    archived_vendor = await client.post("/api/v1/vendors/bulk-action", headers=headers, json={
        "ids": [vendor["id"]], "action": "delete", "target": "vendor",
        "precondition": vendor_archive_preview.json()["precondition"], "operation_id": vendor_archive_preview.json()["operation_id"],
    })
    assert archived_vendor.status_code == 200, archived_vendor.text
    blocked_vendor_purge = await client.post("/api/v1/vendors/bulk-action", headers=headers, json={
        "ids": [vendor["id"]], "action": "purge", "target": "vendor", "dry_run": True,
    })
    assert blocked_vendor_purge.status_code == 200, blocked_vendor_purge.text
    assert blocked_vendor_purge.json()["can_execute"] is False
    assert "personnel and contracts" in blocked_vendor_purge.json()["blockers"][0]["reason"]
    rejected_vendor_purge = await client.post("/api/v1/vendors/bulk-action", headers=headers, json={
        "ids": [vendor["id"]], "action": "purge", "target": "vendor",
        "precondition": blocked_vendor_purge.json()["precondition"], "operation_id": blocked_vendor_purge.json()["operation_id"],
    })
    assert rejected_vendor_purge.status_code == 409
    still_present = await client.get("/api/v1/vendors?include_deleted=true", headers=headers)
    assert any(row["id"] == vendor["id"] for row in still_present.json())


@pytest.mark.anyio
async def test_vendor_and_personnel_edits_reject_stale_revisions(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant)
    vendor = await _create_vendor(client, headers, "W2-REVISION-VENDOR")

    updated_vendor = await client.put(f"/api/v1/vendors/{vendor['id']}", headers=headers, json={
        "country": "Canada", "edit_revision": vendor["edit_revision"],
    })
    assert updated_vendor.status_code == 200, updated_vendor.text
    assert updated_vendor.json()["edit_revision"] != vendor["edit_revision"]

    stale_vendor = await client.put(f"/api/v1/vendors/{vendor['id']}", headers=headers, json={
        "country": "Japan", "edit_revision": vendor["edit_revision"],
    })
    assert stale_vendor.status_code == 409

    personnel = await client.post(f"/api/v1/vendors/{vendor['id']}/personnel", headers=headers, json={
        "name": "First Contact", "company_email": "first@example.com",
    })
    assert personnel.status_code == 200, personnel.text
    original = personnel.json()
    updated_personnel = await client.put(f"/api/v1/vendors/personnel/{original['id']}", headers=headers, json={
        "name": "Updated Contact", "edit_revision": original["edit_revision"],
    })
    assert updated_personnel.status_code == 200, updated_personnel.text
    stale_personnel = await client.put(f"/api/v1/vendors/personnel/{original['id']}", headers=headers, json={
        "name": "Stale Contact", "edit_revision": original["edit_revision"],
    })
    assert stale_personnel.status_code == 409


@pytest.mark.anyio
async def test_vendor_write_commit_conflicts_return_409_and_preserve_records(seeded_admin_tenant, monkeypatch):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant)
    vendor = await _create_vendor(client, headers, "W2-CONCURRENT-VENDOR")
    personnel_response = await client.post(f"/api/v1/vendors/{vendor['id']}/personnel", headers=headers, json={
        "name": "Concurrent Contact", "company_email": "concurrent@example.com",
    })
    assert personnel_response.status_code == 200, personnel_response.text
    personnel = personnel_response.json()

    async def stale_commit(session):
        raise StaleDataError("simulated concurrent write")

    with monkeypatch.context() as patcher:
        patcher.setattr(AsyncSession, "commit", stale_commit)
        vendor_update = await client.put(f"/api/v1/vendors/{vendor['id']}", headers=headers, json={
            "country": "Canada", "edit_revision": vendor["edit_revision"],
        })
    assert vendor_update.status_code == 409, vendor_update.text
    assert "changed while saving" in vendor_update.json()["detail"]

    with monkeypatch.context() as patcher:
        patcher.setattr(AsyncSession, "commit", stale_commit)
        vendor_archive = await client.delete(
            f"/api/v1/vendors/{vendor['id']}", params={"expected_revision": vendor["edit_revision"]}, headers=headers,
        )
    assert vendor_archive.status_code == 409, vendor_archive.text
    assert "changed while archiving" in vendor_archive.json()["detail"]

    with monkeypatch.context() as patcher:
        patcher.setattr(AsyncSession, "commit", stale_commit)
        personnel_remove = await client.delete(
            f"/api/v1/vendors/personnel/{personnel['id']}", params={"expected_revision": personnel["edit_revision"]}, headers=headers,
        )
    assert personnel_remove.status_code == 409, personnel_remove.text
    assert "changed while removing" in personnel_remove.json()["detail"]

    vendors = await client.get("/api/v1/vendors?include_deleted=true", headers=headers)
    saved_vendor = next(row for row in vendors.json() if row["id"] == vendor["id"])
    assert saved_vendor["country"] == "USA"
    assert saved_vendor["is_deleted"] is False
    assert any(row["id"] == personnel["id"] for row in saved_vendor["personnel"])
