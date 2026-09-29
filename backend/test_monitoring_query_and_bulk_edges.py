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


@pytest.mark.anyio
async def test_monitoring_list_filters_and_bulk_edge_behaviors(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant)

    await client.post("/api/v1/settings/teams", json={"name": "Query Ops"}, headers=headers)

    device_a_res = await client.post(
        "/api/v1/devices",
        json={
            "name": "MON-QUERY-01",
            "system": "MON-QUERY",
            "status": "Active",
            "type": "Physical",
            "serial_number": "MON-QUERY-01-SN",
            "asset_tag": "MON-QUERY-01-AT",
        },
        headers=headers,
    )
    assert device_a_res.status_code == 200, device_a_res.text
    device_a = device_a_res.json()

    device_b_res = await client.post(
        "/api/v1/devices",
        json={
            "name": "MON-QUERY-02",
            "system": "MON-QUERY",
            "status": "Active",
            "type": "Physical",
            "serial_number": "MON-QUERY-02-SN",
            "asset_tag": "MON-QUERY-02-AT",
        },
        headers=headers,
    )
    assert device_b_res.status_code == 200, device_b_res.text
    device_b = device_b_res.json()

    monitor_a_res = await client.post(
        "/api/v1/monitoring",
        json={
            "device_id": device_a["id"],
            "category": "Infrastructure",
            "status": "Existing",
            "title": "QUERY-MON-A",
            "platform": "Zabbix",
            "owner_team": "Query Ops",
        },
        headers=headers,
    )
    assert monitor_a_res.status_code == 200, monitor_a_res.text
    monitor_a = monitor_a_res.json()

    monitor_b_res = await client.post(
        "/api/v1/monitoring",
        json={
            "device_id": device_b["id"],
            "category": "Infrastructure",
            "status": "Existing",
            "title": "QUERY-MON-B",
            "platform": "Prometheus",
            "owner_team": "Query Ops",
        },
        headers=headers,
    )
    assert monitor_b_res.status_code == 200, monitor_b_res.text
    monitor_b = monitor_b_res.json()

    delete_res = await client.delete(f"/api/v1/monitoring/{monitor_b['id']}", headers=headers)
    assert delete_res.status_code == 200, delete_res.text

    active_only_res = await client.get("/api/v1/monitoring", headers=headers)
    assert active_only_res.status_code == 200, active_only_res.text
    active_ids = {item["id"] for item in active_only_res.json()}
    assert monitor_a["id"] in active_ids
    assert monitor_b["id"] not in active_ids

    include_deleted_res = await client.get("/api/v1/monitoring?include_deleted=true", headers=headers)
    assert include_deleted_res.status_code == 200, include_deleted_res.text
    included_items = {item["id"]: item for item in include_deleted_res.json()}
    assert included_items[monitor_b["id"]]["status"] == "Deleted"
    assert included_items[monitor_b["id"]]["is_deleted"] is True

    device_filtered_res = await client.get(f"/api/v1/monitoring?device_id={device_a['id']}", headers=headers)
    assert device_filtered_res.status_code == 200, device_filtered_res.text
    assert [item["id"] for item in device_filtered_res.json()] == [monitor_a["id"]]

    no_op_res = await client.post("/api/v1/monitoring/bulk-action", json={"ids": [], "action": "delete"}, headers=headers)
    assert no_op_res.status_code == 200, no_op_res.text
    assert no_op_res.json() == {"status": "no_op"}

    unsupported_res = await client.post(
        "/api/v1/monitoring/bulk-action",
        json={"ids": [monitor_a["id"]], "action": "explode"},
        headers=headers,
    )
    assert unsupported_res.status_code == 400
    assert unsupported_res.json()["detail"] == "Unsupported bulk action"

    noop_update_res = await client.post(
        "/api/v1/monitoring/bulk-action",
        json={"ids": [monitor_a["id"]], "action": "update", "payload": {"owner_team": "Query Ops"}},
        headers=headers,
    )
    assert noop_update_res.status_code == 200, noop_update_res.text
    noop_update = noop_update_res.json()
    assert noop_update["changed"] == 0
    assert noop_update["skipped"] == 1
    assert noop_update["summary"] == "No semantic change"

    purge_res = await client.post(
        "/api/v1/monitoring/bulk-action",
        json={"ids": [monitor_b["id"], 999999], "action": "purge"},
        headers=headers,
    )
    assert purge_res.status_code == 409, purge_res.text
    assert purge_res.json()["detail"]["preview"]["missing_ids"] == [999999]
    remaining = await client.get("/api/v1/monitoring?include_deleted=true", headers=headers)
    assert any(item["id"] == monitor_b["id"] for item in remaining.json())
    preview = await client.post("/api/v1/monitoring/bulk-action", json={
        "ids": [monitor_b["id"]], "action": "purge", "dry_run": True,
    }, headers=headers)
    assert preview.status_code == 200, preview.text
    executed = await client.post("/api/v1/monitoring/bulk-action", json={
        "ids": [monitor_b["id"]], "action": "purge", "precondition": preview.json()["precondition"],
    }, headers=headers)
    assert executed.status_code == 200, executed.text
    assert executed.json()["changed_ids"] == [monitor_b["id"]]
