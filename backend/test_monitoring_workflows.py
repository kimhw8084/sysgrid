import pytest
from app.api.settings import ensure_tenant_admin_async
from app.models.config import Tenant
from sqlalchemy import select
from app.database import ConfigSessionLocal

async def _ensure_admin(seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    async with ConfigSessionLocal() as config_db:
        tenant_res = await config_db.execute(select(Tenant).filter(Tenant.id == tenant_id))
        selected_tenant_obj = tenant_res.scalar_one_or_none()
        if not selected_tenant_obj:
            pytest.fail(f"Seeded tenant with ID {tenant_id} not found in config DB.")
        tenant_db_url = selected_tenant_obj.db_url
    await ensure_tenant_admin_async(tenant_db_url=tenant_db_url, admin_user="admin_root", full_name="Admin Root", email="admin_root@test.com", department="IT")

@pytest.mark.anyio
async def test_monitoring_bulk_actions_create_history_entries(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant)

    team_res = await client.post("/api/v1/settings/teams", json={"name": "History Ops"}, headers=headers)
    assert team_res.status_code == 200, team_res.text
    device_res = await client.post("/api/v1/devices", json={
        "name": "MON-HIST-01",
        "system": "MON-HIST",
        "status": "Active",
        "type": "Physical",
        "serial_number": "MON-HIST-SN",
        "asset_tag": "MON-HIST-AT",
    }, headers=headers)
    assert device_res.status_code == 200, device_res.text
    device = device_res.json()

    knowledge_res = await client.post("/api/v1/knowledge", json={
        "title": "History Recovery",
        "category": "Runbook",
        "content": "Recovery steps",
        "status": "Draft",
    }, headers=headers)
    assert knowledge_res.status_code == 200, knowledge_res.text
    knowledge = knowledge_res.json()

    create_res = await client.post("/api/v1/monitoring", json={
        "device_id": device["id"],
        "category": "Hardware",
        "status": "Existing",
        "title": "MON-HISTORY",
        "platform": "Zabbix",
        "purpose": "History validation",
        "notification_method": "Slack",
        "owner_team": "History Ops",
        "recovery_docs": [knowledge["id"]],
    }, headers=headers)
    assert create_res.status_code == 200, create_res.text
    monitor = create_res.json()

    update_res = await client.post("/api/v1/monitoring/bulk-action", json={
        "ids": [monitor["id"]],
        "action": "update",
        "payload": {"severity": "Critical", "recovery_docs": [knowledge["id"]]},
    }, headers=headers)
    assert update_res.status_code == 200, update_res.text

    delete_res = await client.post("/api/v1/monitoring/bulk-action", json={
        "ids": [monitor["id"]],
        "action": "delete",
    }, headers=headers)
    assert delete_res.status_code == 200, delete_res.text

    restore_res = await client.post("/api/v1/monitoring/bulk-action", json={
        "ids": [monitor["id"]],
        "action": "restore",
    }, headers=headers)
    assert restore_res.status_code == 200, restore_res.text

    history_res = await client.get(f"/api/v1/monitoring/{monitor['id']}/history", headers=headers)
    assert history_res.status_code == 200, history_res.text
    history = history_res.json()

    assert [entry["version"] for entry in history[:4]] == [4, 3, 2, 1]
    assert history[0]["change_summary"] == "Restored monitor"
    assert history[0]["snapshot"]["status"] == "Existing"
    assert history[0]["delta"]
    assert "status" in history[0]["changed_fields"]
    assert history[0]["previous_version"] == 3
    assert history[1]["change_summary"] == "Archived monitor"
    assert history[1]["snapshot"]["status"] == "Deleted"
    assert history[2]["change_summary"] == "Updated Severity"
    assert history[2]["snapshot"]["severity"] == "Critical"
    assert history[2]["changed_fields"] == ["severity"]
    assert {entry["change_type"] for entry in history[2]["delta"]} == {"changed"}


@pytest.mark.anyio
async def test_monitoring_purge_is_irreversible_even_with_a_former_snapshot(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant)

    team_res = await client.post("/api/v1/settings/teams", json={"name": "History Ops"}, headers=headers)
    assert team_res.status_code == 200, team_res.text

    device_res = await client.post("/api/v1/devices", json={
        "name": "MON-PURGE-UNDO-01",
        "system": "MON-PURGE-UNDO",
        "status": "Active",
        "type": "Physical",
        "serial_number": "MON-PURGE-UNDO-SN",
        "asset_tag": "MON-PURGE-UNDO-AT",
    }, headers=headers)
    assert device_res.status_code == 200, device_res.text
    device = device_res.json()

    create_res = await client.post("/api/v1/monitoring", json={
        "device_id": device["id"],
        "category": "Hardware",
        "status": "Existing",
        "title": "MON-PURGE-UNDO",
        "platform": "Zabbix",
        "purpose": "Backend purge undo validation",
        "notification_method": "Slack",
        "owner_team": "History Ops",
    }, headers=headers)
    assert create_res.status_code == 200, create_res.text
    monitor = create_res.json()

    delete_res = await client.post("/api/v1/monitoring/bulk-action", json={
        "ids": [monitor["id"]],
        "action": "delete",
    }, headers=headers)
    assert delete_res.status_code == 200, delete_res.text

    deleted_list_res = await client.get("/api/v1/monitoring?include_deleted=true", headers=headers)
    assert deleted_list_res.status_code == 200, deleted_list_res.text
    deleted_monitor = next(item for item in deleted_list_res.json() if item["id"] == monitor["id"])
    assert deleted_monitor["status"] == "Deleted"
    assert deleted_monitor["is_deleted"] is True

    preview_res = await client.post("/api/v1/monitoring/bulk-action", json={
        "ids": [monitor["id"]], "action": "purge", "dry_run": True,
    }, headers=headers)
    assert preview_res.status_code == 200, preview_res.text
    assert preview_res.json()["can_execute"] is True
    purge_res = await client.post("/api/v1/monitoring/bulk-action", json={
        "ids": [monitor["id"]],
        "action": "purge",
        "precondition": preview_res.json()["precondition"],
    }, headers=headers)
    assert purge_res.status_code == 200, purge_res.text
    assert purge_res.json()["changed"] == 1

    post_purge_list_res = await client.get("/api/v1/monitoring?include_deleted=true", headers=headers)
    assert post_purge_list_res.status_code == 200, post_purge_list_res.text
    assert all(item["id"] != monitor["id"] for item in post_purge_list_res.json())

    restore_res = await client.post("/api/v1/monitoring/bulk-action", json={
        "ids": [monitor["id"]],
        "action": "restore_purged",
        "payload": {"snapshots": [deleted_monitor]},
    }, headers=headers)
    assert restore_res.status_code == 400, restore_res.text
    assert "unsupported" in restore_res.json()["detail"]

    restored_list_res = await client.get("/api/v1/monitoring?include_deleted=true", headers=headers)
    assert restored_list_res.status_code == 200, restored_list_res.text
    assert all(item["id"] != monitor["id"] for item in restored_list_res.json())


@pytest.mark.anyio
async def test_monitoring_enforces_guardrails_and_security_rules(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant)

    team_res = await client.post("/api/v1/settings/teams", json={"name": "Validation Ops"}, headers=headers)
    assert team_res.status_code == 200, team_res.text
    device_res = await client.post("/api/v1/devices", json={
        "name": "MON-VAL-01",
        "system": "MON-VAL",
        "status": "Active",
        "type": "Physical",
        "serial_number": "MON-VAL-SN",
        "asset_tag": "MON-VAL-AT",
    }, headers=headers)
    device = device_res.json()

    bad_frequency = await client.post("/api/v1/monitoring", json={
        "device_id": device["id"],
        "category": "Infrastructure",
        "status": "Existing",
        "title": "BAD-FREQ",
        "platform": "Zabbix",
        "owner_team": "Validation Ops",
        "check_interval": 5,
    }, headers=headers)
    assert bad_frequency.status_code == 400
    assert "check_interval" in bad_frequency.json()["detail"]

    bad_url = await client.post("/api/v1/monitoring", json={
        "device_id": device["id"],
        "category": "Infrastructure",
        "status": "Existing",
        "title": "BAD-URL",
        "platform": "Zabbix",
        "owner_team": "Validation Ops",
        "monitoring_url": "javascript:alert(1)",
    }, headers=headers)
    assert bad_url.status_code == 400
    assert "http or https" in bad_url.json()["detail"]

    missing_bkm = await client.post("/api/v1/monitoring", json={
        "device_id": device["id"],
        "category": "Infrastructure",
        "status": "Existing",
        "title": "NO-BKM",
        "platform": "Zabbix",
        "owner_team": "Validation Ops",
        "severity": "Critical",
    }, headers=headers)
    assert missing_bkm.status_code == 400
    assert "recovery document" in missing_bkm.json()["detail"]


@pytest.mark.anyio
async def test_monitoring_allows_optional_and_combined_ownership(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant)

    team_res = await client.post("/api/v1/settings/teams", json={"name": "Operations"}, headers=headers)
    assert team_res.status_code == 200, team_res.text

    operator_res = await client.post("/api/v1/settings/operators", json={
        "external_id": "op-1001",
        "username": "monitor.alpha",
        "full_name": "Monitor Alpha",
        "email": "alpha@example.com",
        "department": "Operations",
        "team": "Operations",
        "registration_status": "Verified",
    }, headers=headers)
    assert operator_res.status_code == 200, operator_res.text
    operator = operator_res.json()

    knowledge_res = await client.post("/api/v1/knowledge", json={
        "title": "CPU Recovery",
        "category": "Runbook",
        "content": "Restart service and reduce load",
        "status": "Draft",
    }, headers=headers)
    assert knowledge_res.status_code == 200, knowledge_res.text
    knowledge = knowledge_res.json()

    device_res = await client.post("/api/v1/devices", json={
        "name": "MON-TEAM-01",
        "system": "MON-TEAM",
        "status": "Active",
        "type": "Physical",
        "serial_number": "MON-TEAM-SN",
        "asset_tag": "MON-TEAM-AT",
    }, headers=headers)
    device = device_res.json()

    create_res = await client.post("/api/v1/monitoring", json={
        "device_id": device["id"],
        "category": "Infrastructure",
        "status": "Existing",
        "title": "TEAMED-MONITOR",
        "platform": "Zabbix",
        "owner_team": "Operations",
        "severity": "Critical",
        "recovery_docs": [knowledge["id"]],
        "owners": [{"operator_id": operator["id"], "role": "Primary Support"}],
    }, headers=headers)
    assert create_res.status_code == 200, create_res.text
    combined_monitor = create_res.json()
    assert combined_monitor["owner_team"] == "Operations"
    assert combined_monitor["owners"][0]["operator_id"] == operator["id"]

    individual_res = await client.post("/api/v1/monitoring", json={
        "device_id": device["id"],
        "category": "Infrastructure",
        "status": "Existing",
        "title": "USER-OWNED-MONITOR",
        "platform": "Zabbix",
        "severity": "Critical",
        "recovery_docs": [knowledge["id"]],
        "owners": [{"operator_id": operator["id"], "role": "Primary Support"}],
    }, headers=headers)
    assert individual_res.status_code == 200, individual_res.text
    individual_monitor = individual_res.json()
    assert individual_monitor["owner_team"] in ("", None)
    assert individual_monitor["owners"][0]["operator_id"] == operator["id"]

    team_owned_res = await client.post("/api/v1/monitoring", json={
        "device_id": device["id"],
        "category": "Infrastructure",
        "status": "Existing",
        "title": "TEAM-ONLY-MONITOR",
        "platform": "Zabbix",
        "owner_team": "Operations",
        "severity": "Critical",
        "recovery_docs": [knowledge["id"]],
        "owners": [],
    }, headers=headers)
    assert team_owned_res.status_code == 200, team_owned_res.text

    optional_owned_res = await client.post("/api/v1/monitoring", json={
        "device_id": device["id"],
        "category": "Infrastructure",
        "status": "Existing",
        "title": "UNOWNED-MONITOR",
        "platform": "Zabbix",
        "severity": "Critical",
        "recovery_docs": [knowledge["id"]],
        "owners": [],
    }, headers=headers)
    assert optional_owned_res.status_code == 200, optional_owned_res.text


@pytest.mark.anyio
async def test_monitoring_rejects_active_duplicates_and_allows_recreate_after_archive(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant)

    await client.post("/api/v1/settings/teams", json={"name": "Duplicate Ops"}, headers=headers)
    device_res = await client.post("/api/v1/devices", json={
        "name": "MON-DUP-01",
        "system": "MON-DUP",
        "status": "Active",
        "type": "Physical",
        "serial_number": "MON-DUP-SN",
        "asset_tag": "MON-DUP-AT",
    }, headers=headers)
    device = device_res.json()

    payload = {
        "device_id": device["id"],
        "category": "Infrastructure",
        "status": "Existing",
        "title": "DUPLICATE-MONITOR",
        "platform": "Zabbix",
        "owner_team": "Duplicate Ops",
    }
    first_res = await client.post("/api/v1/monitoring", json=payload, headers=headers)
    assert first_res.status_code == 200, first_res.text
    first = first_res.json()

    dup_res = await client.post("/api/v1/monitoring", json=payload, headers=headers)
    assert dup_res.status_code == 409
    assert "already exists" in dup_res.json()["detail"]

    archive_res = await client.delete(f"/api/v1/monitoring/{first['id']}", headers=headers)
    assert archive_res.status_code == 200, archive_res.text

    recreate_res = await client.post("/api/v1/monitoring", json=payload, headers=headers)
    assert recreate_res.status_code == 200, recreate_res.text
