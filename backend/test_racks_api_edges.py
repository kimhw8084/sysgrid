import pytest
from sqlalchemy import select

from app.api.settings import ensure_tenant_admin_async
from app.database import ConfigSessionLocal
from app.models.config import Tenant


async def _ensure_admin(seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    async with ConfigSessionLocal() as config_db:
        tenant_res = await config_db.execute(select(Tenant).filter(Tenant.id == tenant_id))
        tenant = tenant_res.scalar_one()
    await ensure_tenant_admin_async(
        tenant_db_url=tenant.db_url,
        admin_user="admin_root",
        full_name="Admin Root",
        email="admin_root@test.com",
        department="IT",
    )


@pytest.mark.asyncio
async def test_rack_site_filter_rejects_invalid_values_and_retains_legacy_sentinels(seeded_admin_tenant):
    client = seeded_admin_tenant['client']
    headers = {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}
    for value in ('not-a-site', '1.5', '-1', '9223372036854775808'):
        response = await client.get('/api/v1/racks', params={'site_id': value}, headers=headers)
        assert response.status_code == 422, (value, response.text)
    for value in ('', 'null', 'missing', '0', '9223372036854775807'):
        response = await client.get('/api/v1/racks', params={'site_id': value}, headers=headers)
        assert response.status_code == 200, (value, response.text)
        assert response.json() == []


async def _create_site(client, headers: dict, name: str, color: str = "#22c55e"):
    res = await client.post("/api/v1/sites", json={"name": name, "address": "QA", "color": color}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


async def _create_rack(client, headers: dict, site_id: int, name: str, total_u: int = 10):
    res = await client.post(
        "/api/v1/racks",
        json={"site_id": site_id, "name": name, "aisle": "A", "row": "1", "total_u": total_u, "max_power_kw": 8},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    return res.json()


async def _create_device(client, headers: dict, name: str, size_u: int = 2):
    res = await client.post(
        "/api/v1/devices",
        json={
            "name": name,
            "system": f"{name}-SYS",
            "status": "Active",
            "type": "Physical",
            "serial_number": f"{name}-SN",
            "asset_tag": f"{name}-AT",
            "size_u": size_u,
        },
        headers=headers,
    )
    assert res.status_code == 200, res.text
    return res.json()


@pytest.mark.anyio
async def test_rack_plan_listing_and_deleted_filters(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])}
    await _ensure_admin(seeded_admin_tenant)

    create_plan = await client.post(
        "/api/v1/racks/plans",
        json={"name": "Edge Plan", "description": "First", "racks": [{"name": "R1"}], "racksData": {"zoom": 1}},
        headers=headers,
    )
    assert create_plan.status_code == 200, create_plan.text
    plan = create_plan.json()

    update_plan = await client.post(
        "/api/v1/racks/plans",
        json={"id": plan["id"], "name": "Edge Plan 2", "description": "Updated", "racks": [{"name": "R2"}], "racksData": {"zoom": 2}},
        headers=headers,
    )
    assert update_plan.status_code == 200, update_plan.text
    assert update_plan.json()["name"] == "Edge Plan 2"

    plans_res = await client.get("/api/v1/racks/plans", headers=headers)
    assert plans_res.status_code == 200, plans_res.text
    assert any(item["id"] == plan["id"] and item["name"] == "Edge Plan 2" for item in plans_res.json())

    site = await _create_site(client, headers, "RACK-EDGE-SITE", "#123456")
    rack = await _create_rack(client, headers, site["id"], "EDGE-RACK-A")

    all_racks = await client.get("/api/v1/racks", headers=headers)
    assert all_racks.status_code == 200, all_racks.text
    loaded_rack = next(item for item in all_racks.json() if item["id"] == rack["id"])
    assert loaded_rack["site_name"] == "RACK-EDGE-SITE"
    assert loaded_rack["site_color"] == "#123456"
    assert loaded_rack["device_locations"] == []

    delete_res = await client.delete(f"/api/v1/racks/{rack['id']}", headers=headers)
    assert delete_res.status_code == 200, delete_res.text

    hidden_res = await client.get("/api/v1/racks", headers=headers)
    assert hidden_res.status_code == 200
    assert all(item["id"] != rack["id"] for item in hidden_res.json())

    deleted_res = await client.get("/api/v1/racks?include_deleted=true", headers=headers)
    assert deleted_res.status_code == 200, deleted_res.text
    deleted_rack = next(item for item in deleted_res.json() if item["id"] == rack["id"])
    assert deleted_rack["is_deleted"] is True

    delete_plan = await client.delete(f"/api/v1/racks/plans/{plan['id']}", headers=headers)
    assert delete_plan.status_code == 200, delete_plan.text


@pytest.mark.anyio
async def test_rack_mount_update_move_and_bulk_edge_flows(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])}
    await _ensure_admin(seeded_admin_tenant)

    source_site = await _create_site(client, headers, "EDGE-SRC")
    target_site = await _create_site(client, headers, "EDGE-TGT")
    rack_a = await _create_rack(client, headers, source_site["id"], "EDGE-RACK-A", total_u=8)
    rack_b = await _create_rack(client, headers, source_site["id"], "EDGE-RACK-B", total_u=8)
    await _create_rack(client, headers, target_site["id"], "EDGE-RACK-A", total_u=8)
    await _create_rack(client, headers, target_site["id"], "EDGE-RACK-B", total_u=8)

    create_duplicate = await client.post("/api/v1/racks", json={"site_id": source_site["id"], "name": "EDGE-RACK-A"}, headers=headers)
    assert create_duplicate.status_code == 400
    assert create_duplicate.json()["detail"] == "RACK_NAME_DUPLICATE"

    no_site = await client.post("/api/v1/racks", json={"name": "NO-SITE"}, headers=headers)
    assert no_site.status_code == 400

    missing_site = await client.post("/api/v1/racks", json={"site_id": 999999, "name": "MISSING-SITE"}, headers=headers)
    assert missing_site.status_code == 400

    dev_a = await _create_device(client, headers, "EDGE-DEV-A", size_u=2)
    dev_b = await _create_device(client, headers, "EDGE-DEV-B", size_u=2)
    dev_c = await _create_device(client, headers, "EDGE-DEV-C", size_u=3)

    mount_a = await client.post(
        f"/api/v1/racks/{rack_a['id']}/mount",
        json={"device_id": dev_a["id"], "start_u": 1, "size_u": 2, "orientation": "Front", "depth": "Full"},
        headers=headers,
    )
    assert mount_a.status_code == 200, mount_a.text

    collision = await client.post(
        f"/api/v1/racks/{rack_a['id']}/mount",
        json={"device_id": dev_b["id"], "start_u": 2, "size_u": 2},
        headers=headers,
    )
    assert collision.status_code == 400
    assert "Collision with EDGE-DEV-A" in collision.json()["detail"]

    overflow_mount = await client.post(
        f"/api/v1/racks/{rack_a['id']}/mount",
        json={"device_id": dev_c["id"], "start_u": 7, "size_u": 3},
        headers=headers,
    )
    assert overflow_mount.status_code == 400
    assert "RACK_OVERFLOW" in overflow_mount.json()["detail"]

    relocate_conflict = await client.post(
        f"/api/v1/racks/{rack_b['id']}/mount",
        json={"device_id": dev_a["id"], "start_u": 1, "size_u": 2},
        headers=headers,
    )
    assert relocate_conflict.status_code == 409
    assert relocate_conflict.json()["type"] == "RELOCATION_CONFLICT"

    relocate_success = await client.post(
        f"/api/v1/racks/{rack_b['id']}/mount",
        json={"device_id": dev_a["id"], "start_u": 3, "size_u": 2, "relocate": True},
        headers=headers,
    )
    assert relocate_success.status_code == 200, relocate_success.text

    mount_b = await client.post(
        f"/api/v1/racks/{rack_b['id']}/mount",
        json={"device_id": dev_b["id"], "start_u": 1, "size_u": 2},
        headers=headers,
    )
    assert mount_b.status_code == 200, mount_b.text

    shrink_conflict = await client.put(f"/api/v1/racks/{rack_b['id']}", json={"total_u": 3}, headers=headers)
    assert shrink_conflict.status_code == 400
    assert "RACK_SHRINK_CONFLICT" in shrink_conflict.json()["detail"]

    duplicate_target = await client.put(f"/api/v1/racks/{rack_b['id']}", json={"new_site_id": target_site["id"]}, headers=headers)
    assert duplicate_target.status_code == 400
    assert duplicate_target.json()["detail"] == "RACK_NAME_DUPLICATE_IN_TARGET_SITE"

    rename_duplicate = await client.put(f"/api/v1/racks/{rack_b['id']}", json={"name": "EDGE-RACK-A"}, headers=headers)
    assert rename_duplicate.status_code == 400
    assert rename_duplicate.json()["detail"] == "RACK_NAME_DUPLICATE_IN_SITE"

    rename_success = await client.put(
        f"/api/v1/racks/{rack_b['id']}",
        json={"name": "EDGE-RACK-B2", "aisle": "B", "row": "2", "max_power_kw": 12, "pdu_a_name": "PDU-X", "pdu_b_name": "PDU-Y", "pdu_a_cap_kw": 15, "pdu_b_cap_kw": 16},
        headers=headers,
    )
    assert rename_success.status_code == 200, rename_success.text

    reorder = await client.post("/api/v1/racks/reorder", json={"ids": [rack_b["id"], rack_a["id"]]}, headers=headers)
    assert reorder.status_code == 200, reorder.text

    bulk_patch = await client.post(
        "/api/v1/racks/bulk-patch",
        json={"connections": [{"source_device_id": dev_a["id"], "source_port": "eth0", "target_device_id": dev_b["id"], "target_port": "eth1", "purpose": "Data", "speed_gbps": 25}]},
        headers=headers,
    )
    assert bulk_patch.status_code == 200, bulk_patch.text
    assert bulk_patch.json()["count"] == 1

    occupied_move = await client.post(
        "/api/v1/racks/move",
        json={"device_id": dev_a["id"], "target_rack_id": rack_b["id"], "target_start_u": 1},
        headers=headers,
    )
    assert occupied_move.status_code == 409

    overflow_move = await client.post(
        "/api/v1/racks/move",
        json={"device_id": dev_c["id"], "target_rack_id": rack_b["id"], "target_start_u": 7},
        headers=headers,
    )
    assert overflow_move.status_code == 400
    assert "RACK_OVERFLOW" in overflow_move.json()["detail"]

    move_success = await client.post(
        "/api/v1/racks/move",
        json={"device_id": dev_a["id"], "target_rack_id": rack_b["id"], "target_start_u": 5},
        headers=headers,
    )
    assert move_success.status_code == 200, move_success.text

    unmount = await client.delete(f"/api/v1/racks/mount/{dev_a['id']}", headers=headers)
    assert unmount.status_code == 200, unmount.text

    audit_res = await client.get("/api/v1/racks/audit-logs", headers=headers)
    assert audit_res.status_code == 200, audit_res.text
    actions = {entry["action"] for entry in audit_res.json()}
    assert {"CREATE", "UPDATE", "REORDER", "BULK_PATCH", "MOUNT", "MOVE", "UNMOUNT", "SOFT_DELETE"} & actions


@pytest.mark.anyio
async def test_rack_bulk_actions_cover_restore_purge_relocate_and_noop(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])}
    await _ensure_admin(seeded_admin_tenant)

    source_site = await _create_site(client, headers, "BULK-SRC")
    target_site = await _create_site(client, headers, "BULK-TGT")
    rack_keep = await _create_rack(client, headers, source_site["id"], "BULK-KEEP")
    rack_conflict = await _create_rack(client, headers, source_site["id"], "BULK-CONFLICT")
    await _create_rack(client, headers, target_site["id"], "BULK-CONFLICT")

    no_op = await client.post("/api/v1/racks/bulk-action", json={"ids": [], "action": "delete"}, headers=headers)
    assert no_op.status_code == 200
    assert no_op.json()["status"] == "no_op"

    relocate_missing = await client.post("/api/v1/racks/bulk-action", json={"ids": [rack_keep["id"]], "action": "relocate", "payload": {}}, headers=headers)
    assert relocate_missing.status_code == 400

    relocate_bad_site = await client.post(
        "/api/v1/racks/bulk-action",
        json={"ids": [rack_keep["id"]], "action": "relocate", "payload": {"new_site_id": 999999}},
        headers=headers,
    )
    assert relocate_bad_site.status_code == 400

    relocate = await client.post(
        "/api/v1/racks/bulk-action",
        json={"ids": [rack_keep["id"], rack_conflict["id"]], "action": "relocate", "payload": {"new_site_id": target_site["id"]}},
        headers=headers,
    )
    assert relocate.status_code == 200, relocate.text
    assert rack_keep["id"] in relocate.json()["relocated"]
    assert rack_conflict["id"] in relocate.json()["conflicts"]

    delete_bulk = await client.post(
        "/api/v1/racks/bulk-action",
        json={"ids": [rack_keep["id"], rack_conflict["id"]], "action": "delete"},
        headers=headers,
    )
    assert delete_bulk.status_code == 200, delete_bulk.text

    restore_bad_site = await client.post(
        "/api/v1/racks/bulk-action",
        json={"ids": [rack_keep["id"]], "action": "restore", "payload": {"new_site_id": 999999}},
        headers=headers,
    )
    assert restore_bad_site.status_code == 400

    restore = await client.post(
        "/api/v1/racks/bulk-action",
        json={"ids": [rack_keep["id"], rack_conflict["id"]], "action": "restore", "payload": {"new_site_id": target_site["id"], "renames": {str(rack_conflict["id"]): "BULK-CONFLICT-RENAMED"}}},
        headers=headers,
    )
    assert restore.status_code == 200, restore.text
    assert rack_keep["id"] in restore.json()["restored"]
    assert rack_conflict["id"] in restore.json()["restored"]

    purge = await client.post(
        "/api/v1/racks/bulk-action",
        json={"ids": [rack_keep["id"]], "action": "purge"},
        headers=headers,
    )
    assert purge.status_code == 200, purge.text

    racks_after = await client.get("/api/v1/racks?include_deleted=true", headers=headers)
    assert racks_after.status_code == 200
    assert all(item["id"] != rack_keep["id"] for item in racks_after.json())


@pytest.mark.anyio
async def test_rack_orphan_filters_and_missing_resource_edges(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])}
    await _ensure_admin(seeded_admin_tenant)

    site = await _create_site(client, headers, "ORPHAN-SITE", "#abcdef")
    rack = await _create_rack(client, headers, site["id"], "ORPHAN-RACK", total_u=6)
    device = await _create_device(client, headers, "ORPHAN-DEV", size_u=1)

    delete_site_res = await client.delete(f"/api/v1/sites/{site['id']}", headers=headers)
    assert delete_site_res.status_code == 200, delete_site_res.text

    missing_site_res = await client.get("/api/v1/racks?site_id=missing", headers=headers)
    assert missing_site_res.status_code == 200, missing_site_res.text
    orphan_rack = next(item for item in missing_site_res.json() if item["id"] == rack["id"])
    assert orphan_rack["site_id"] is None
    assert orphan_rack["site_name"] == "Prev: ORPHAN-SITE"

    null_site_res = await client.get("/api/v1/racks?site_id=null", headers=headers)
    assert null_site_res.status_code == 200, null_site_res.text
    assert any(item["id"] == rack["id"] for item in null_site_res.json())

    mount_missing_rack = await client.post(
        "/api/v1/racks/999999/mount",
        json={"device_id": device["id"], "start_u": 1, "size_u": 1},
        headers=headers,
    )
    assert mount_missing_rack.status_code == 404
    assert mount_missing_rack.json()["detail"] == "Rack not found"

    update_missing_rack = await client.put("/api/v1/racks/999999", json={"name": "NOPE"}, headers=headers)
    assert update_missing_rack.status_code == 404
    assert update_missing_rack.json()["detail"] == "Rack not found"

    delete_missing_rack = await client.delete("/api/v1/racks/999999", headers=headers)
    assert delete_missing_rack.status_code == 404
    assert delete_missing_rack.json()["detail"] == "Rack not found"

    bad_bulk_action = await client.post(
        "/api/v1/racks/bulk-action",
        json={"ids": [rack["id"]], "action": "explode"},
        headers=headers,
    )
    assert bad_bulk_action.status_code == 400
    assert bad_bulk_action.json()["detail"] == "Unsupported bulk action"

    move_missing_device = await client.post(
        "/api/v1/racks/move",
        json={"device_id": 999999, "target_rack_id": rack["id"], "target_start_u": 1},
        headers=headers,
    )
    assert move_missing_device.status_code == 404
    assert move_missing_device.json()["detail"] == "Device not found"

    move_missing_rack = await client.post(
        "/api/v1/racks/move",
        json={"device_id": device["id"], "target_rack_id": 999999, "target_start_u": 1},
        headers=headers,
    )
    assert move_missing_rack.status_code == 404
    assert move_missing_rack.json()["detail"] == "Target rack not found"

    unmount_missing = await client.delete("/api/v1/racks/mount/999999", headers=headers)
    assert unmount_missing.status_code == 200
    assert unmount_missing.json()["status"] == "success"
