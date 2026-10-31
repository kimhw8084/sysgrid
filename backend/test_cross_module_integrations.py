import pytest
from httpx import AsyncClient
from app.api.settings import ensure_tenant_admin_async
from app.models.config import Tenant
from sqlalchemy import select
from app.database import ConfigSessionLocal

@pytest.mark.anyio
async def test_cross_module_asset_context_flows(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}

    # Ensure admin operator exists in the tenant database
    async with ConfigSessionLocal() as config_db:
        tenant_res = await config_db.execute(select(Tenant).filter(Tenant.id == tenant_id))
        selected_tenant_obj = tenant_res.scalar_one_or_none()
        if not selected_tenant_obj:
            pytest.fail(f"Seeded tenant with ID {tenant_id} not found in config DB.")
        tenant_db_url = selected_tenant_obj.db_url
    await ensure_tenant_admin_async(tenant_db_url=tenant_db_url, admin_user="admin_root", full_name="Admin Root", email="admin_root@test.com", department="IT")

    device_res = await client.post("/api/v1/devices", json={
        "name": "CTX-SRV-01",
        "system": "CTX-GRID",
        "status": "Maintenance",
        "type": "Physical",
        "model": "R750",
        "serial_number": "CTX-SN-01",
        "asset_tag": "CTX-AT-01",
        "owner": "",
        "business_unit": "Operations",
        "primary_ip": "10.10.10.10",
        "management_ip": "10.10.10.11"
    }, headers=headers)
    assert device_res.status_code == 200, device_res.text
    device = device_res.json()

    service_res = await client.post("/api/v1/logical-services", json={
        "name": "CTX-DB-01",
        "service_type": "Database",
        "status": "Active",
        "version": "16",
        "environment": "Production",
        "device_id": device["id"],
        "purpose": "Cross-module verification"
    }, headers=headers)
    assert service_res.status_code == 200, service_res.text
    service = service_res.json()

    knowledge_res = await client.post("/api/v1/knowledge", json={
        "category": "BKM",
        "title": "CTX-RUNBOOK-01",
        "content": "Recovery sequence",
        "linked_device_ids": [device["id"]]
    }, headers=headers)
    assert knowledge_res.status_code == 200, knowledge_res.text
    knowledge = knowledge_res.json()

    # Create a team to satisfy monitoring ownership requirement
    await client.post("/api/v1/settings/teams", json={"name": "Infrastructure"}, headers=headers)
    
    monitoring_res = await client.post("/api/v1/monitoring", json={
        "device_id": device["id"],
        "category": "Hardware",
        "status": "Existing",
        "title": "CTX-MON-01",
        "platform": "Zabbix",
        "purpose": "Cross-module verification",
        "impact": "Service degradation",
        "notification_method": "Slack",
        "severity": "Critical",
        "recovery_docs": [knowledge["id"]],
        "owner_team": "Infrastructure"
    }, headers=headers)
    assert monitoring_res.status_code == 200, monitoring_res.text
    monitoring = monitoring_res.json()

    maintenance_res = await client.post("/api/v1/maintenance", json={
        "device_id": device["id"],
        "title": "CTX-MAINT-01",
        "start_time": "2030-01-01T00:00:00Z",
        "end_time": "2030-01-01T01:00:00Z",
        "ticket_number": "CTX-CHG-01",
        "coordinator": "QA",
        "status": "Scheduled"
    }, headers=headers)
    assert maintenance_res.status_code == 200, maintenance_res.text

    far_res = await client.post("/api/v1/far/modes", json={
        "system_name": "CTX-GRID",
        "title": "CTX-FAR-01",
        "effect": "Cross-module failure mode",
        "severity": 7,
        "occurrence": 4,
        "detection": 3,
        "affected_assets": [device["id"]]
    }, headers=headers)
    assert far_res.status_code == 200, far_res.text
    far = far_res.json()
    assert far["affected_assets"][0]["id"] == device["id"]

    knowledge_query = await client.get(f"/api/v1/knowledge?device_id={device['id']}", headers=headers)
    assert knowledge_query.status_code == 200
    assert any(entry["id"] == knowledge["id"] for entry in knowledge_query.json())

    maintenance_query = await client.get(f"/api/v1/maintenance?device_id={device['id']}", headers=headers)
    assert maintenance_query.status_code == 200
    assert any(window["device_name"] == device["name"] for window in maintenance_query.json())

    audit_query = await client.get(f"/api/v1/audit?target_table=logical_services&target_id={service['id']}", headers=headers)
    assert audit_query.status_code == 200
    assert any(log["target_id"] == str(service["id"]) for log in audit_query.json())

    monitoring_query = await client.get("/api/v1/monitoring", headers=headers)
    assert monitoring_query.status_code == 200
    assert any(item["id"] == monitoring["id"] and item["device_name"] == device["name"] for item in monitoring_query.json())


async def test_dashboard_search_returns_new_cross_module_entities(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}

    # Ensure admin operator exists in the tenant database
    async with ConfigSessionLocal() as config_db:
        tenant_res = await config_db.execute(select(Tenant).filter(Tenant.id == tenant_id))
        selected_tenant_obj = tenant_res.scalar_one_or_none()
        if not selected_tenant_obj:
            pytest.fail(f"Seeded tenant with ID {tenant_id} not found in config DB.")
        tenant_db_url = selected_tenant_obj.db_url
    await ensure_tenant_admin_async(tenant_db_url=tenant_db_url, admin_user="admin_root", full_name="Admin Root", email="admin_root@test.com", department="IT")

    device_res = await client.post("/api/v1/devices", json={
        "name": "SEARCH-SRV-01",
        "system": "SEARCH-GRID",
        "status": "Active",
        "type": "Physical",
        "serial_number": "SEARCH-SN-01",
        "asset_tag": "SEARCH-AT-01"
    }, headers=headers)
    assert device_res.status_code == 200
    device = device_res.json()

    service_res = await client.post("/api/v1/logical-services", json={
        "name": "SEARCH-SVC-01",
        "service_type": "API",
        "status": "Active",
        "environment": "Production",
        "device_id": device["id"],
        "purpose": "Search coverage"
    }, headers=headers)
    assert service_res.status_code == 200

    knowledge_res = await client.post("/api/v1/knowledge", json={
        "category": "BKM",
        "title": "SEARCH-RUNBOOK-01",
        "content": "Searchable knowledge"
    }, headers=headers)
    assert knowledge_res.status_code == 200

    # Create a team to satisfy monitoring ownership requirement
    await client.post("/api/v1/settings/teams", json={"name": "Infrastructure"}, headers=headers)

    monitoring_res = await client.post("/api/v1/monitoring", json={
        "device_id": device["id"],
        "category": "App",
        "status": "Existing",
        "title": "SEARCH-MON-01",
        "platform": "Datadog",
        "purpose": "Search coverage",
        "notification_method": "Email",
        "owner_team": "Infrastructure"
    }, headers=headers)
    assert monitoring_res.status_code == 200

    far_res = await client.post("/api/v1/far/modes", json={
        "system_name": "SEARCH-GRID",
        "title": "SEARCH-FAR-01",
        "effect": "Searchable failure mode",
        "severity": 5,
        "occurrence": 3,
        "detection": 2,
        "affected_assets": [device["id"]]
    }, headers=headers)
    assert far_res.status_code == 200

    search_res = await client.get("/api/v1/dashboard/search?q=SEARCH-", headers=headers)
    assert search_res.status_code == 200, search_res.text
    results = search_res.json()["results"]

    result_types = {item["type"] for item in results}
    assert "asset" in result_types
    assert "service" in result_types
    assert "monitoring" in result_types
    assert "knowledge" in result_types
    assert "far" in result_types
