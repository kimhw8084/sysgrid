import pytest
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.settings import ensure_tenant_admin_async
from app.database import ConfigSessionLocal, get_tenant_engine
from app.models import models
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


async def _tenant_session_factory(seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant["tenant_id"]
    async with setup_db[1]() as config_db:
        tenant = (await config_db.execute(select(Tenant).filter(Tenant.id == tenant_id))).scalar_one()
    tenant_engine = get_tenant_engine(tenant.db_url)
    return async_sessionmaker(bind=tenant_engine, autoflush=False, expire_on_commit=False, class_=AsyncSession)


async def _create_site(client, headers: dict, name: str):
    res = await client.post("/api/v1/sites", json={"name": name, "address": "QA"}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


async def _create_rack(client, headers: dict, site_id: int, name: str):
    res = await client.post(
        "/api/v1/racks",
        json={"site_id": site_id, "name": name, "aisle": "A", "row": "1", "total_u": 12, "max_power_kw": 8},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    return res.json()


async def _create_device(client, headers: dict, **overrides):
    payload = {
        "name": "DEVICE-EDGE",
        "system": "EDGE-SYS",
        "status": "Active",
        "type": "Physical",
        "serial_number": "EDGE-SN",
        "asset_tag": "EDGE-AT",
    }
    payload.update(overrides)
    res = await client.post("/api/v1/devices", json=payload, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


@pytest.mark.anyio
async def test_devices_enrichment_summary_and_interfaces(seeded_admin_tenant, setup_db):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant)

    site = await _create_site(client, headers, "DEVICE-SITE")
    rack = await _create_rack(client, headers, site["id"], "DEVICE-RACK")
    device = await _create_device(
        client,
        headers,
        name="EDGE-HOST",
        os_name="Ubuntu",
        os_version="24.04",
        environment="Production",
        owner="Platform",
        vendor="Dell",
        size_u=2,
    )
    peer = await _create_device(
        client,
        headers,
        name="EDGE-PEER",
        system="PEER-SYS",
        serial_number="PEER-SN",
        asset_tag="PEER-AT",
    )

    mount_res = await client.post(
        f"/api/v1/racks/{rack['id']}/mount",
        json={"device_id": device["id"], "start_u": 3, "size_u": 2, "orientation": "Back", "depth": "Half"},
        headers=headers,
    )
    assert mount_res.status_code == 200, mount_res.text

    tenant_session_factory = await _tenant_session_factory(seeded_admin_tenant, setup_db)
    async with tenant_session_factory() as tenant_db:
        tenant_db.add_all(
            [
                models.NetworkInterface(
                    device_id=device["id"],
                    name="eth0",
                    mac_address="AA:AA:AA:AA:AA:01",
                    ip_address="10.0.0.10",
                    vlan_id=101,
                    link_speed_gbps=25,
                ),
                models.NetworkInterface(
                    device_id=peer["id"],
                    name="eth9",
                    mac_address="AA:AA:AA:AA:AA:09",
                    ip_address="10.0.0.11",
                    vlan_id=101,
                    link_speed_gbps=25,
                ),
                models.HardwareComponent(device_id=device["id"], category="CPU", name="CPU", count=2),
                models.HardwareComponent(device_id=device["id"], category="Memory", name="MEM", count=8),
                models.HardwareComponent(device_id=device["id"], category="Disk", name="DSK", count=4),
                models.IncidentLog(
                    title="Open Incident",
                    status="Investigating",
                    impacted_device_ids=[device["id"]],
                ),
                models.PortConnection(
                    source_device_id=device["id"],
                    source_port="eth0",
                    source_ip="10.0.0.10",
                    source_mac="AA:AA:AA:AA:AA:01",
                    source_vlan=101,
                    target_device_id=peer["id"],
                    target_port="eth9",
                    target_ip="10.0.0.11",
                    target_mac="AA:AA:AA:AA:AA:09",
                    target_vlan=101,
                    link_type="Fiber",
                    purpose="Uplink",
                    speed_gbps=25,
                    unit="Gbps",
                    direction="Bidirectional",
                    status="Active",
                ),
            ]
        )
        await tenant_db.commit()

    devices_res = await client.get("/api/v1/devices", headers=headers)
    assert devices_res.status_code == 200, devices_res.text
    loaded = next(item for item in devices_res.json() if item["id"] == device["id"])
    assert loaded["hardware_summary"] == "2x CPU / 8x MEM / 4x DSK"
    assert loaded["open_incident_count"] == 1
    assert loaded["rack_name"] == "DEVICE-RACK"
    assert loaded["site_name"] == "DEVICE-SITE"
    assert loaded["u_start"] == 3
    assert loaded["mount_orientation"] == "Back"
    assert loaded["mount_depth"] == "Half"
    assert loaded["all_ips"] == ["10.0.0.10"]
    assert any(service["service_type"] == "OS" and service["name"] == "Ubuntu" for service in loaded["logical_services"])

    summary_res = await client.get("/api/v1/devices/summary?system=EDGE-SYS&limit=5&offset=0", headers=headers)
    assert summary_res.status_code == 200, summary_res.text
    assert [item["id"] for item in summary_res.json()] == [device["id"]]

    interfaces_res = await client.get(f"/api/v1/devices/{device['id']}/interfaces", headers=headers)
    assert interfaces_res.status_code == 200, interfaces_res.text
    iface = interfaces_res.json()[0]
    assert iface["name"] == "eth0"
    assert iface["connection"]["peer_device_name"] == "EDGE-PEER"
    assert iface["connection"]["peer_port"] == "eth9"
    assert iface["connection"]["local_vlan"] == 101
    assert iface["connection"]["status"] == "Connected"


@pytest.mark.anyio
async def test_devices_create_update_and_bulk_actions(seeded_admin_tenant, setup_db):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant)

    missing_name = await client.post("/api/v1/devices", json={"system": "ONLY-SYS"}, headers=headers)
    assert missing_name.status_code == 400

    device = await _create_device(
        client,
        headers,
        name="BULK-HOST",
        os_name="Rocky",
        os_version="9.3",
        serial_number="BULK-SN-1",
        asset_tag="BULK-AT-1",
        purchase_date="2025-01-01T00:00:00Z",
        install_date="2025-02-01T00:00:00",
    )
    duplicate = await client.post(
        "/api/v1/devices",
        json={"name": "bulk-host", "system": "OTHER", "serial_number": "BULK-SN-2", "asset_tag": "BULK-AT-2"},
        headers=headers,
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "DUPLICATE_HOSTNAME"

    other = await _create_device(
        client,
        headers,
        name="OTHER-HOST",
        system="OTHER-SYS",
        serial_number="OTHER-SN",
        asset_tag="OTHER-AT",
    )

    dup_update = await client.put(f"/api/v1/devices/{other['id']}", json={"name": "bulk-host"}, headers=headers)
    assert dup_update.status_code == 409

    update_res = await client.put(
        f"/api/v1/devices/{device['id']}",
        json={"metadata_json": "{\"owner\":\"json\"}", "os_version": "9.4", "owner": "Operations"},
        headers=headers,
    )
    assert update_res.status_code == 200, update_res.text
    assert update_res.json()["metadata_json"] == {"owner": "json"}

    list_after = await client.get("/api/v1/devices", headers=headers)
    assert list_after.status_code == 200
    updated = next(item for item in list_after.json() if item["id"] == device["id"])
    assert updated["owner"] == "Operations"
    assert any(service["service_type"] == "OS" and service["name"] == "Rocky" for service in updated["logical_services"])

    no_op = await client.post("/api/v1/devices/bulk-action", json={"ids": [], "action": "delete"}, headers=headers)
    assert no_op.status_code == 200
    assert no_op.json()["status"] == "no_op"

    bulk_update = await client.post(
        "/api/v1/devices/bulk-action",
        json={"ids": [device["id"]], "action": "update", "payload": {"owner": "SRE"}},
        headers=headers,
    )
    assert bulk_update.status_code == 200

    bulk_delete = await client.post("/api/v1/devices/bulk-action", json={"ids": [device["id"]], "action": "delete"}, headers=headers)
    assert bulk_delete.status_code == 200

    replacement = await _create_device(
        client,
        headers,
        name="BULK-HOST",
        system="EDGE-SYS-2",
        serial_number="BULK-SN-3",
        asset_tag="BULK-AT-3",
    )

    tenant_session_factory = await _tenant_session_factory(seeded_admin_tenant, setup_db)
    restore_preview = await client.post(
        "/api/v1/devices/bulk-action",
        json={"ids": [device["id"]], "action": "restore", "dry_run": True},
        headers=headers,
    )
    assert restore_preview.status_code == 200
    assert restore_preview.json()["status"] == "preview"
    assert restore_preview.json()["can_execute"] is False
    assert restore_preview.json()["blockers"][0]["id"] == device["id"]
    assert "hostname" in restore_preview.json()["blockers"][0]["reason"].lower()

    restore_conflict = await client.post("/api/v1/devices/bulk-action", json={"ids": [device["id"]], "action": "restore"}, headers=headers)
    assert restore_conflict.status_code == 409
    assert restore_conflict.json()["detail"]["preview"]["blockers"][0]["id"] == device["id"]
    assert [row.action for row in await _device_audit_rows(tenant_session_factory, device["id"])] == ["ARCHIVE"]
    archived_rows = await client.get("/api/v1/devices?include_deleted=true", headers=headers)
    assert any(row["id"] == device["id"] and row["is_deleted"] for row in archived_rows.json())

    purge = await client.post("/api/v1/devices/bulk-action", json={"ids": [device["id"]], "action": "purge"}, headers=headers)
    assert purge.status_code == 200

    delete_single = await client.delete(f"/api/v1/devices/{replacement['id']}", headers=headers)
    assert delete_single.status_code == 200

    include_deleted = await client.get("/api/v1/devices?include_deleted=true", headers=headers)
    assert include_deleted.status_code == 200
    ids = {item["id"] for item in include_deleted.json()}
    assert device["id"] not in ids
    assert replacement["id"] in ids


@pytest.mark.anyio
async def test_device_subresources_and_resource_routes(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant)

    device = await _create_device(client, headers, name="RESOURCE-HOST", serial_number="RES-SN", asset_tag="RES-AT")
    peer = await _create_device(client, headers, name="RESOURCE-PEER", system="RES-SYS-2", serial_number="RES2-SN", asset_tag="RES2-AT")

    empty_hw = await client.post(f"/api/v1/devices/{device['id']}/hardware", json={}, headers=headers)
    assert empty_hw.status_code == 400
    valid_hw = await client.post(
        f"/api/v1/devices/{device['id']}/hardware",
        json={"category": "CPU", "name": "Xeon", "count": 2},
        headers=headers,
    )
    assert valid_hw.status_code == 200, valid_hw.text
    hw = valid_hw.json()

    hw_list = await client.get(f"/api/v1/devices/{device['id']}/hardware", headers=headers)
    assert hw_list.status_code == 200
    assert any(item["id"] == hw["id"] for item in hw_list.json())

    hw_update = await client.put(f"/api/v1/devices/hardware/{hw['id']}", json={"count": 4}, headers=headers)
    assert hw_update.status_code == 200
    assert hw_update.json()["count"] == 4

    missing_secret = await client.post(f"/api/v1/devices/{device['id']}/secrets", json={}, headers=headers)
    assert missing_secret.status_code == 400
    valid_secret = await client.post(
        f"/api/v1/devices/{device['id']}/secrets",
        json={"secret_type": "Password", "username": "root", "encrypted_payload": "cipher"},
        headers=headers,
    )
    assert valid_secret.status_code == 200, valid_secret.text
    secret = valid_secret.json()

    secrets_list = await client.get(f"/api/v1/devices/{device['id']}/secrets", headers=headers)
    assert secrets_list.status_code == 200
    assert any(item["id"] == secret["id"] for item in secrets_list.json())

    secret_update = await client.put(f"/api/v1/devices/secrets/{secret['id']}", json={"notes": "rotated"}, headers=headers)
    assert secret_update.status_code == 200
    assert secret_update.json()["notes"] == "rotated"

    missing_target = await client.post(f"/api/v1/devices/{device['id']}/relationships", json={}, headers=headers)
    assert missing_target.status_code == 400
    self_link = await client.post(f"/api/v1/devices/{device['id']}/relationships", json={"target_device_id": device["id"]}, headers=headers)
    assert self_link.status_code == 400

    rel_create = await client.post(
        f"/api/v1/devices/{device['id']}/relationships",
        json={"target_device_id": peer["id"], "relationship_type": "DependsOn", "notes": "critical"},
        headers=headers,
    )
    assert rel_create.status_code == 200, rel_create.text
    rel = rel_create.json()

    rel_list = await client.get(f"/api/v1/devices/{device['id']}/relationships", headers=headers)
    assert rel_list.status_code == 200
    assert any(item["id"] == rel["id"] for item in rel_list.json())

    rel_all = await client.get("/api/v1/devices/relationships/all", headers=headers)
    assert rel_all.status_code == 200
    assert any(item["id"] == rel["id"] for item in rel_all.json())

    rel_update = await client.put(f"/api/v1/devices/relationships/{rel['id']}", json={"notes": "updated"}, headers=headers)
    assert rel_update.status_code == 200
    assert rel_update.json()["notes"] == "updated"

    bad_resource_delete = await client.delete("/api/v1/devices/unknown/1", headers=headers)
    assert bad_resource_delete.status_code == 400
    bad_resource_update = await client.put("/api/v1/devices/unknown/1", json={"x": 1}, headers=headers)
    assert bad_resource_update.status_code == 400

    delete_rel = await client.delete(f"/api/v1/devices/relationships/{rel['id']}", headers=headers)
    assert delete_rel.status_code == 200
    delete_secret = await client.delete(f"/api/v1/devices/secrets/{secret['id']}", headers=headers)
    assert delete_secret.status_code == 200
    delete_hw = await client.delete(f"/api/v1/devices/hardware/{hw['id']}", headers=headers)
    assert delete_hw.status_code == 200


@pytest.mark.anyio
async def test_devices_bulk_purge_with_far_mode_assets(seeded_admin_tenant, setup_db):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant)

    # 1. Create asset (device)
    device = await _create_device(
        client,
        headers,
        name="FAR-PURGE-ASSET-01",
        system="FAR-PURGE-SYS",
        serial_number="FAR-PURGE-SN",
        asset_tag="FAR-PURGE-AT",
    )

    # 2. Create FAR failure mode associated with this asset
    mode_res = await client.post(
        "/api/v1/far/modes",
        json={
            "system_name": "FAR-PURGE-SYS",
            "title": "FAR-PURGE-MODE-01",
            "effect": "Purge testing with far_mode_assets",
            "severity": 5,
            "occurrence": 3,
            "detection": 2,
            "affected_assets": [device["id"]],
        },
        headers=headers,
    )
    assert mode_res.status_code == 200, mode_res.text
    mode = mode_res.json()
    assert device["id"] in [asset["id"] for asset in mode["affected_assets"]]

    peer = await _create_device(
        client,
        headers,
        name="FAR-PURGE-PEER-01",
        system="FAR-PURGE-SYS",
        serial_number="FAR-PURGE-PEER-SN",
        asset_tag="FAR-PURGE-PEER-AT",
    )
    tenant_session_factory = await _tenant_session_factory(seeded_admin_tenant, setup_db)
    async with tenant_session_factory() as tenant_db:
        monitor = models.MonitoringItem(device_id=device["id"], title="synthetic monitor")
        service = models.LogicalService(device_id=device["id"], name="purge detach service", service_type="Other", status="Active")
        tenant_db.add_all([
            models.DeviceSoftware(device_id=device["id"], name="synthetic software"),
            models.NetworkInterface(device_id=device["id"], name="eth-purge", mac_address="AA:BB:CC:00:00:51"),
            models.HardwareComponent(device_id=device["id"], category="CPU", name="synthetic component"),
            models.SecretVault(device_id=device["id"], secret_type="synthetic", username="safe-user", encrypted_payload="SENSITIVE-ENCRYPTED-SENTINEL"),
            models.MaintenanceWindow(device_id=device["id"], title="synthetic window"),
            models.ExternalLink(device_id=device["id"], service_id=None, purpose="synthetic link"),
            models.DeviceRelationship(source_device_id=device["id"], target_device_id=peer["id"], relationship_type="synthetic"),
            models.PortConnection(source_device_id=device["id"], target_device_id=peer["id"], source_port="eth-purge", target_port="eth-peer"),
            models.FirewallRule(name="synthetic firewall rule", source_device_id=device["id"], dest_device_id=device["id"]),
            monitor,
            service,
        ])
        await tenant_db.flush()
        tenant_db.add_all([
            models.MonitoringHistory(monitoring_item_id=monitor.id, version=1, snapshot={"title": "synthetic"}),
            models.MonitoringOwner(monitoring_item_id=monitor.id, name="synthetic owner", role="Owner"),
        ])
        await tenant_db.commit()

    archive = await client.post(
        "/api/v1/devices/bulk-action",
        json={"ids": [device["id"]], "action": "delete"},
        headers=headers,
    )
    assert archive.status_code == 200, archive.text
    assert archive.json()["status"] == "success"

    tenant_audits_before = await _device_audit_rows(tenant_session_factory, device["id"])
    assert [row.action for row in tenant_audits_before] == ["ARCHIVE"]

    # Preview derives both direct dependencies and FK cascade-owned rows from the current schema.
    purge_preview = await client.post(
        "/api/v1/devices/bulk-action",
        json={"ids": [device["id"]], "action": "purge", "dry_run": True},
        headers=headers,
    )
    assert purge_preview.status_code == 200, purge_preview.text
    preview_body = purge_preview.json()
    assert preview_body["status"] == "preview"
    impact = preview_body["purge_impact"]
    preview_tables = {item["table"]: item for item in impact["aggregate"]["deletes"]}
    assert preview_tables["devices"]["count"] == 1
    assert preview_tables["external_links"]["disposition"] == "explicit_delete"
    assert preview_tables["device_software"]["disposition"] == "database_cascade"
    assert preview_tables["network_interfaces"]["disposition"] == "database_cascade"
    assert preview_tables["monitoring_history"]["disposition"] == "database_cascade"
    assert preview_tables["monitoring_owners"]["disposition"] == "database_cascade"
    assert {item["table"] for item in impact["aggregate"]["detaches"]} == {"firewall_rules", "logical_services"}
    assert "SENSITIVE-ENCRYPTED-SENTINEL" not in purge_preview.text
    assert "username" not in purge_preview.text
    assert [row.action for row in await _device_audit_rows(tenant_session_factory, device["id"])] == ["ARCHIVE"]
    async with tenant_session_factory() as tenant_db:
        archived_device = await tenant_db.get(models.Device, device["id"])
        retained_software = await tenant_db.scalar(
            select(models.DeviceSoftware).where(models.DeviceSoftware.device_id == device["id"])
        )
        retained_secret = await tenant_db.scalar(
            select(models.SecretVault).where(models.SecretVault.device_id == device["id"])
        )
        assert archived_device is not None and archived_device.is_deleted is True
        assert retained_software is not None
        assert retained_secret is not None and retained_secret.encrypted_payload == "SENSITIVE-ENCRYPTED-SENTINEL"

    # 3. Call bulk-action purge
    purge_res = await client.post(
        "/api/v1/devices/bulk-action",
        json={"ids": [device["id"]], "action": "purge"},
        headers=headers,
    )
    assert purge_res.status_code == 200, purge_res.text
    receipt = purge_res.json()
    assert receipt["status"] == "success"
    assert receipt["count"] == 1
    assert receipt["purge_impact_applied"] == impact
    assert "can_revert" not in receipt

    # 4. Verify the asset is completely gone from devices
    include_deleted = await client.get("/api/v1/devices?include_deleted=true", headers=headers)
    assert include_deleted.status_code == 200
    ids = {item["id"] for item in include_deleted.json()}
    assert device["id"] not in ids

    async with tenant_session_factory() as tenant_db:
        for model in (
            models.ExternalLink,
            models.DeviceLocation,
            models.HardwareComponent,
            models.DeviceSoftware,
            models.NetworkInterface,
            models.SecretVault,
            models.MaintenanceWindow,
            models.MonitoringItem,
        ):
            assert not (await tenant_db.execute(select(model.id).where(model.device_id == device["id"]))).first()
        assert not (await tenant_db.execute(select(models.MonitoringHistory.id).where(models.MonitoringHistory.monitoring_item_id == monitor.id))).first()
        assert not (await tenant_db.execute(select(models.MonitoringOwner.id).where(models.MonitoringOwner.monitoring_item_id == monitor.id))).first()
        assert not (await tenant_db.execute(select(models.DeviceRelationship.id).where(or_(models.DeviceRelationship.source_device_id == device["id"], models.DeviceRelationship.target_device_id == device["id"])))).first()
        assert not (await tenant_db.execute(select(models.PortConnection.id).where(or_(models.PortConnection.source_device_id == device["id"], models.PortConnection.target_device_id == device["id"])))).first()
        services = (await tenant_db.execute(select(models.LogicalService).where(models.LogicalService.name == "purge detach service"))).scalars().all()
        assert len(services) == 1 and services[0].device_id is None
        rules = (await tenant_db.execute(select(models.FirewallRule).where(models.FirewallRule.name == "synthetic firewall rule"))).scalars().all()
        assert len(rules) == 1 and rules[0].source_device_id is None and rules[0].dest_device_id is None
        assert not (await tenant_db.execute(select(models.far_mode_assets.c.mode_id).where(models.far_mode_assets.c.device_id == device["id"]))).first()
    audit_rows_after = await _device_audit_rows(tenant_session_factory, device["id"])
    assert [row.action for row in audit_rows_after] == ["PURGE", "ARCHIVE"]
    assert audit_rows_after[0].changes["target"] == {"id": device["id"], "name": "FAR-PURGE-ASSET-01"}
    assert "SENSITIVE-ENCRYPTED-SENTINEL" not in str(audit_rows_after[0].changes)
    assert "SENSITIVE-ENCRYPTED-SENTINEL" not in audit_rows_after[0].description
    purge_retry = await client.post(
        "/api/v1/devices/bulk-action",
        json={"ids": [device["id"]], "action": "purge"},
        headers=headers,
    )
    assert purge_retry.status_code == 409
    assert purge_retry.json()["detail"]["preview"]["missing_ids"] == [device["id"]]
    assert [row.action for row in await _device_audit_rows(tenant_session_factory, device["id"])] == ["PURGE", "ARCHIVE"]

    # 5. Verify the FAR failure mode still exists but no longer has the purged asset
    modes_res = await client.get("/api/v1/far/modes", headers=headers)
    assert modes_res.status_code == 200
    refreshed_mode = next(item for item in modes_res.json() if item["id"] == mode["id"])
    assert device["id"] not in [asset["id"] for asset in refreshed_mode["affected_assets"]]


async def _device_audit_rows(tenant_session_factory, device_id: int):
    async with tenant_session_factory() as tenant_db:
        result = await tenant_db.execute(
            select(models.AuditLog)
            .where(models.AuditLog.target_table == "devices", models.AuditLog.target_id == str(device_id))
            .order_by(models.AuditLog.id.desc())
        )
        return list(result.scalars().all())


@pytest.mark.anyio
async def test_device_bulk_dry_run_lifecycle_audit_and_missing_execution(seeded_admin_tenant, setup_db):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant)
    device = await _create_device(client, headers, name="LIFECYCLE-CONTRACT", serial_number="LIFECYCLE-SN", asset_tag="LIFECYCLE-AT")
    tenant_session_factory = await _tenant_session_factory(seeded_admin_tenant, setup_db)

    for malformed in ("true", "false", 0, 1, None, [], {}):
        rejected = await client.post(
            "/api/v1/devices/bulk-action",
            headers=headers,
            json={"ids": [device["id"]], "action": "delete", "dry_run": malformed},
        )
        assert rejected.status_code == 400, rejected.text
        assert rejected.json()["detail"] == "dry_run must be a boolean"

    after_invalid = await client.get("/api/v1/devices?include_deleted=true", headers=headers)
    assert any(row["id"] == device["id"] and not row["is_deleted"] for row in after_invalid.json())
    assert await _device_audit_rows(tenant_session_factory, device["id"]) == []

    archive_preview = await client.post(
        "/api/v1/devices/bulk-action",
        headers=headers,
        json={"ids": [device["id"]], "action": "delete", "dry_run": True},
    )
    assert archive_preview.status_code == 200
    assert archive_preview.json()["status"] == "preview"
    assert archive_preview.json()["changed_count"] == 1
    assert archive_preview.json()["changed_ids"] == [device["id"]]
    assert await _device_audit_rows(tenant_session_factory, device["id"]) == []

    archive = await client.post(
        "/api/v1/devices/bulk-action",
        headers=headers,
        json={"ids": [device["id"]], "action": "delete"},
    )
    assert archive.status_code == 200
    assert archive.json()["status"] == "success"
    assert archive.json()["changed_ids"] == [device["id"]]
    assert [row.action for row in await _device_audit_rows(tenant_session_factory, device["id"])] == ["ARCHIVE"]
    active = await client.get("/api/v1/devices", headers=headers)
    assert all(row["id"] != device["id"] for row in active.json())

    archive_retry = await client.post(
        "/api/v1/devices/bulk-action",
        headers=headers,
        json={"ids": [device["id"]], "action": "delete", "dry_run": False},
    )
    assert archive_retry.status_code == 200
    assert archive_retry.json()["status"] == "no_op"
    assert archive_retry.json()["unchanged_count"] == 1
    assert archive_retry.json()["unchanged_ids"] == [device["id"]]
    assert [row.action for row in await _device_audit_rows(tenant_session_factory, device["id"])] == ["ARCHIVE"]

    restore_preview = await client.post(
        "/api/v1/devices/bulk-action",
        headers=headers,
        json={"ids": [device["id"]], "action": "restore", "dry_run": True},
    )
    assert restore_preview.status_code == 200
    assert restore_preview.json()["status"] == "preview"
    assert restore_preview.json()["changed_count"] == 1
    restore = await client.post(
        "/api/v1/devices/bulk-action",
        headers=headers,
        json={"ids": [device["id"]], "action": "restore"},
    )
    assert restore.status_code == 200
    assert restore.json()["status"] == "success"
    assert [row.action for row in await _device_audit_rows(tenant_session_factory, device["id"])] == ["RESTORE", "ARCHIVE"]

    restore_retry = await client.post(
        "/api/v1/devices/bulk-action",
        headers=headers,
        json={"ids": [device["id"]], "action": "restore"},
    )
    assert restore_retry.status_code == 200
    assert restore_retry.json()["status"] == "no_op"
    assert restore_retry.json()["unchanged_count"] == 1
    assert [row.action for row in await _device_audit_rows(tenant_session_factory, device["id"])] == ["RESTORE", "ARCHIVE"]

    missing_id = 9_223_372_036_854_775_807
    mixed_missing = await client.post(
        "/api/v1/devices/bulk-action",
        headers=headers,
        json={"ids": [device["id"], missing_id], "action": "delete"},
    )
    assert mixed_missing.status_code == 409
    assert mixed_missing.json()["detail"]["preview"]["missing_ids"] == [missing_id]
    assert mixed_missing.json()["detail"]["preview"]["changed_ids"] == [device["id"]]
    assert [row.action for row in await _device_audit_rows(tenant_session_factory, device["id"])] == ["RESTORE", "ARCHIVE"]
    final_state = await client.get("/api/v1/devices?include_deleted=true", headers=headers)
    assert any(row["id"] == device["id"] and not row["is_deleted"] for row in final_state.json())


@pytest.mark.anyio
async def test_single_device_delete_archives_once_with_lifecycle_audit(seeded_admin_tenant, setup_db):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant)
    device = await _create_device(client, headers, name="SINGLE-ARCHIVE", serial_number="SINGLE-ARCHIVE-SN", asset_tag="SINGLE-ARCHIVE-AT")
    tenant_session_factory = await _tenant_session_factory(seeded_admin_tenant, setup_db)

    first = await client.delete(f"/api/v1/devices/{device['id']}", headers=headers)
    assert first.status_code == 200
    assert first.json() == {"status": "success", "changed": True, "changed_ids": [device["id"]], "unchanged_ids": []}
    assert [row.action for row in await _device_audit_rows(tenant_session_factory, device["id"])] == ["ARCHIVE"]

    retry = await client.delete(f"/api/v1/devices/{device['id']}", headers=headers)
    assert retry.status_code == 200
    assert retry.json()["status"] == "no_op"
    assert [row.action for row in await _device_audit_rows(tenant_session_factory, device["id"])] == ["ARCHIVE"]


@pytest.mark.anyio
async def test_lifecycle_audit_construction_failure_does_not_archive(seeded_admin_tenant, setup_db, monkeypatch):
    from app.api import devices as device_api

    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    await _ensure_admin(seeded_admin_tenant)
    device = await _create_device(client, headers, name="AUDIT-ATOMICITY", serial_number="AUDIT-ATOMICITY-SN", asset_tag="AUDIT-ATOMICITY-AT")
    tenant_session_factory = await _tenant_session_factory(seeded_admin_tenant, setup_db)

    def fail_audit(**_kwargs):
        raise RuntimeError("synthetic audit construction failure")

    monkeypatch.setattr(device_api, "build_audit_log", fail_audit)
    with pytest.raises(RuntimeError, match="synthetic audit construction failure"):
        await client.post(
            "/api/v1/devices/bulk-action",
            headers=headers,
            json={"ids": [device["id"]], "action": "delete"},
        )

    rows = await client.get("/api/v1/devices?include_deleted=true", headers=headers)
    assert any(row["id"] == device["id"] and not row["is_deleted"] for row in rows.json())
    assert await _device_audit_rows(tenant_session_factory, device["id"]) == []
