import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.dashboard import group_by_status
from app.database import get_tenant_engine
from app.core.config import settings
from app.models import models
from app.models.config import Tenant


def test_group_by_status_handles_missing_type_and_status_fields():
    rows = [
        type("Row", (), {"type": "Server", "status": "Active"})(),
        type("Row", (), {"type": "Server", "status": None})(),
        type("Row", (), {"type": None, "status": "Planned"})(),
    ]

    assert group_by_status(rows) == {
        "Server": {"Active": 1, "Unknown": 1},
        "Unknown": {"Planned": 1},
    }


@pytest.mark.anyio
async def test_dashboard_metrics_rolls_up_seeded_operational_data(seeded_admin_tenant, setup_db):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}

    site_res = await client.post("/api/v1/sites", json={"name": "METRICS-SITE", "address": "HQ"}, headers=headers)
    assert site_res.status_code == 200, site_res.text
    site = site_res.json()

    rack_res = await client.post(
        "/api/v1/racks",
        json={"site_id": site["id"], "name": "METRICS-RACK", "total_u": 10, "max_power_kw": 8},
        headers=headers,
    )
    assert rack_res.status_code == 200, rack_res.text
    rack = rack_res.json()

    device_res = await client.post(
        "/api/v1/devices",
        json={
            "name": "METRICS-DEVICE",
            "system": "METRICS-SYSTEM",
            "status": "Active",
            "type": "Physical",
            "model": "R740",
            "serial_number": "METRICS-SN",
            "asset_tag": "METRICS-AT",
            "owner": "ops",
            "business_unit": "platform",
        },
        headers=headers,
    )
    assert device_res.status_code == 200, device_res.text
    device = device_res.json()

    peer_device_res = await client.post(
        "/api/v1/devices",
        json={
            "name": "METRICS-PEER",
            "system": "METRICS-PEER-SYSTEM",
            "status": "Active",
            "type": "Physical",
            "model": "R640",
            "serial_number": "METRICS-PEER-SN",
            "asset_tag": "METRICS-PEER-AT",
            "owner": "ops",
            "business_unit": "platform",
        },
        headers=headers,
    )
    assert peer_device_res.status_code == 200, peer_device_res.text
    peer_device = peer_device_res.json()

    mount_res = await client.post(
        f"/api/v1/racks/{rack['id']}/mount",
        json={"device_id": device["id"], "start_u": 1, "size_u": 2, "orientation": "Front", "depth": "Full"},
        headers=headers,
    )
    assert mount_res.status_code == 200, mount_res.text

    team_res = await client.post("/api/v1/settings/teams", json={"name": "Metrics Team"}, headers=headers)
    assert team_res.status_code == 200, team_res.text

    service_res = await client.post(
        "/api/v1/logical-services",
        json={
            "name": "METRICS-SERVICE",
            "service_type": "Database",
            "status": "Active",
            "environment": "Production",
            "device_id": device["id"],
        },
        headers=headers,
    )
    assert service_res.status_code == 200, service_res.text
    external_res = await client.post(
        "/api/v1/intelligence/entities",
        json={
            "name": "METRICS-EXTERNAL",
            "external_key": "metrics-external",
            "type": "API",
            "status": "Active",
            "business_purpose": "Coverage validation",
            "owner_organization": "Partner",
            "ownership_mode": "team",
            "internal_team_id": team_res.json()["id"],
            "contacts_json": [{"role": "Primary", "full_name": "Metrics Owner", "email": "metrics@example.com", "is_primary": True}],
        },
        headers=headers,
    )
    assert external_res.status_code == 200, external_res.text

    connection_res = await client.post(
        "/api/v1/networks/connections",
        json={
            "device_a_id": device["id"],
            "source_port": "eth0",
            "device_b_id": peer_device["id"],
            "target_port": "eth1",
            "link_type": "Loopback",
            "status": "Active",
        },
        headers=headers,
    )
    assert connection_res.status_code == 200, connection_res.text

    monitor_res = await client.post(
        "/api/v1/monitoring",
        json={
            "device_id": device["id"],
            "category": "Hardware",
            "status": "Existing",
            "title": "METRICS-MONITOR",
            "platform": "Zabbix",
            "purpose": "Metrics coverage",
            "notification_method": "Slack",
            "owner_team": "Metrics Team",
        },
        headers=headers,
    )
    assert monitor_res.status_code == 200, monitor_res.text
    monitor = monitor_res.json()

    knowledge_res = await client.post(
        "/api/v1/knowledge",
        json={"category": "BKM", "title": "METRICS-KNOWLEDGE", "content": "Runbook", "linked_device_ids": [device["id"]]},
        headers=headers,
    )
    assert knowledge_res.status_code == 200, knowledge_res.text

    research_res = await client.post(
        "/api/v1/investigations",
        json={"title": "METRICS-RESEARCH", "status": "Analyzing", "systems": [device["system"]]},
        headers=headers,
    )
    assert research_res.status_code == 200, research_res.text

    far_res = await client.post(
        "/api/v1/far/modes",
        json={
            "system_name": device["system"],
            "title": "METRICS-FAR",
            "effect": "Failure effect",
            "severity": 8,
            "occurrence": 4,
            "detection": 3,
            "affected_assets": [device["id"]],
        },
        headers=headers,
    )
    assert far_res.status_code == 200, far_res.text

    flow_res = await client.post(
        "/api/v1/data-flows",
        json={
            "name": "METRICS-FLOW",
            "description": "Architecture path",
            "category": "System",
            "status": "Approved",
            "nodes": [],
            "edges": [],
            "viewport": {"x": 0, "y": 0, "zoom": 1},
        },
        headers=headers,
    )
    assert flow_res.status_code == 200, flow_res.text

    project_live_res = await client.post(
        "/api/v1/projects",
        json={"name": "METRICS-PROJECT-LIVE", "type": "Strategic", "status": "In Progress", "priority": "High"},
        headers=headers,
    )
    assert project_live_res.status_code == 200, project_live_res.text

    project_done_res = await client.post(
        "/api/v1/projects",
        json={"name": "METRICS-PROJECT-DONE", "type": "Strategic", "status": "Completed", "priority": "Medium"},
        headers=headers,
    )
    assert project_done_res.status_code == 200, project_done_res.text

    config_session_factory = setup_db[1]
    async with config_session_factory() as config_db:
        tenant = (await config_db.execute(select(Tenant).filter(Tenant.id == tenant_id))).scalar_one()
        tenant_db_url = tenant.db_url

    tenant_engine = get_tenant_engine(tenant_db_url)
    tenant_session_factory = async_sessionmaker(bind=tenant_engine, autoflush=False, expire_on_commit=False, class_=AsyncSession)
    async with tenant_session_factory() as tenant_db:
        monitor_row = (await tenant_db.execute(select(models.MonitoringItem).filter(models.MonitoringItem.id == monitor["id"]))).scalar_one()
        monitor_row.is_active = False
        await tenant_db.commit()

    metrics_res = await client.get("/api/v1/dashboard/metrics", headers=headers)
    assert metrics_res.status_code == 200, metrics_res.text
    metrics = metrics_res.json()

    assert metrics["rack_overview"]["total_sites"] >= 1
    assert metrics["rack_overview"]["total_racks"] >= 1
    assert metrics["rack_overview"]["total_racked_assets"] >= 1
    assert metrics["asset_overview"]["total"] >= 1
    assert metrics["service_overview"]["total"] >= 1
    assert metrics["network_overview"]["total"] >= 1
    assert metrics["monitoring_overview"]["total"] >= 1
    assert metrics["stability_score"] is None
    assert "critical_alerts" not in metrics
    assert metrics["observed_health"]["history"]["available"] is False
    assert metrics["observed_health"]["history"]["unavailable_reason"] == "NO_AUTHORITATIVE_OBSERVATION_SOURCE"
    assert metrics["observed_health"]["availability"]["kind"] == "observed_health"
    assert metrics["monitoring_overview"]["truth"]["kind"] == "configuration"
    assert metrics["monitoring_overview"]["truth"]["source"].startswith("monitoring_items table")
    assert "research" not in metrics["recent"]
    assert "far" not in metrics["recent"]
    assert "knowledge" not in metrics["recent"]
    assert "projects" not in metrics["recent"]
    assert metrics["recent"]["activity"]
    assert all("target" in activity for activity in metrics["recent"]["activity"])
    assert all(activity["truth"]["kind"] == "activity" for activity in metrics["recent"]["activity"])


@pytest.mark.anyio
async def test_dashboard_search_returns_cross_domain_matches(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}

    short_res = await client.get("/api/v1/dashboard/search?q=m", headers=headers)
    assert short_res.status_code == 200, short_res.text
    assert short_res.json() == {"results": []}

    device_res = await client.post(
        "/api/v1/devices",
        json={
            "name": "SEARCH-DEVICE",
            "system": "SEARCH-SYSTEM",
            "status": "Active",
            "type": "Physical",
            "model": "R750",
            "serial_number": "SEARCH-SN",
            "asset_tag": "SEARCH-TAG",
            "owner": "ops",
            "business_unit": "platform",
        },
        headers=headers,
    )
    assert device_res.status_code == 200, device_res.text
    device = device_res.json()

    peer_res = await client.post(
        "/api/v1/devices",
        json={
            "name": "SEARCH-PEER",
            "system": "SEARCH-PEER-SYSTEM",
            "status": "Active",
            "type": "Physical",
            "model": "R650",
            "serial_number": "SEARCH-PEER-SN",
            "asset_tag": "SEARCH-PEER-TAG",
            "owner": "ops",
            "business_unit": "platform",
        },
        headers=headers,
    )
    assert peer_res.status_code == 200, peer_res.text
    peer = peer_res.json()

    team_res = await client.post("/api/v1/settings/teams", json={"name": "Search Team"}, headers=headers)
    assert team_res.status_code == 200, team_res.text

    service_res = await client.post(
        "/api/v1/logical-services",
        json={
            "name": "SEARCH-SERVICE",
            "service_type": "SearchPlatform",
            "status": "Active",
            "environment": "Production",
            "device_id": device["id"],
            "purpose": "Search critical path",
        },
        headers=headers,
    )
    assert service_res.status_code == 200, service_res.text

    monitor_res = await client.post(
        "/api/v1/monitoring",
        json={
            "device_id": device["id"],
            "category": "SearchMonitoring",
            "status": "Existing",
            "title": "SEARCH-MONITOR",
            "platform": "SearchPlatform",
            "purpose": "Search reliability",
            "impact": "Search degraded",
            "notification_method": "Slack",
            "owner_team": "Search Team",
        },
        headers=headers,
    )
    assert monitor_res.status_code == 200, monitor_res.text

    knowledge_res = await client.post(
        "/api/v1/knowledge",
        json={"category": "BKM", "title": "SEARCH-KNOWLEDGE", "content": "Search recovery", "linked_device_ids": [device["id"]]},
        headers=headers,
    )
    assert knowledge_res.status_code == 200, knowledge_res.text

    far_res = await client.post(
        "/api/v1/far/modes",
        json={
            "system_name": device["system"],
            "title": "SEARCH-FAR",
            "effect": "Search outage",
            "severity": 8,
            "occurrence": 4,
            "detection": 3,
            "affected_assets": [device["id"]],
        },
        headers=headers,
    )
    assert far_res.status_code == 200, far_res.text

    project_res = await client.post(
        "/api/v1/projects",
        json={"name": "SEARCH-PROJECT", "type": "Strategic", "status": "In Progress", "priority": "High", "description": "Search project"},
        headers=headers,
    )
    assert project_res.status_code == 200, project_res.text

    connection_res = await client.post(
        "/api/v1/networks/connections",
        json={
            "device_a_id": device["id"],
            "source_port": "search0",
            "device_b_id": peer["id"],
            "target_port": "search1",
            "link_type": "SearchLink",
            "purpose": "Search traffic",
            "status": "Active",
        },
        headers=headers,
    )
    assert connection_res.status_code == 200, connection_res.text

    search_res = await client.get("/api/v1/dashboard/search?q=SEARCH", headers=headers)
    assert search_res.status_code == 200, search_res.text
    results = search_res.json()["results"]

    result_types = {item["type"] for item in results}
    assert {"asset", "project", "far", "service", "monitoring", "knowledge", "network"} <= result_types


@pytest.mark.anyio
async def test_dashboard_empty_inventory_is_distinct_from_unavailable_observations(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}

    response = await client.get("/api/v1/dashboard/metrics", headers=headers)
    assert response.status_code == 200, response.text
    metrics = response.json()

    assert metrics["asset_overview"]["total"] == 0
    assert metrics["asset_overview"]["truth"]["value"] == 0
    assert metrics["asset_overview"]["truth"]["kind"] == "inventory"
    assert metrics["observed_health"]["history"]["value"] is None
    assert metrics["observed_health"]["history"]["freshness"] == "unavailable"
    assert metrics["incident_summary"]["value"] is None
    assert metrics["incident_summary"]["unavailable_reason"] == "NO_AUTHORITATIVE_INCIDENT_SOURCE"


@pytest.mark.anyio
async def test_normal_home_search_does_not_expose_preview_records(seeded_admin_tenant, setup_db, monkeypatch):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    monkeypatch.setattr(settings, "SYSTEM_ROOT_USER_IDS", "")

    config_session_factory = setup_db[1]
    async with config_session_factory() as config_db:
        tenant = (await config_db.execute(select(Tenant).filter(Tenant.id == tenant_id))).scalar_one()
        tenant_db_url = tenant.db_url

    tenant_engine = get_tenant_engine(tenant_db_url)
    tenant_session_factory = async_sessionmaker(bind=tenant_engine, autoflush=False, expire_on_commit=False, class_=AsyncSession)
    async with tenant_session_factory() as tenant_db:
        tenant_db.add(
            models.Project(
                name="NORMAL-PREVIEW-PROJECT",
                type="Strategic",
                status="In Progress",
                priority="High",
                description="Preview-only record",
            )
        )
        await tenant_db.commit()

    search_res = await client.get("/api/v1/dashboard/search?q=NORMAL-PREVIEW", headers=headers)
    assert search_res.status_code == 200, search_res.text
    assert search_res.json()["results"] == []
