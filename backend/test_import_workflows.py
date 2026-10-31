import csv
import io
import json
import re
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
async def test_monitoring_import_schema_and_template(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])}
    await _ensure_admin(seeded_admin_tenant)

    team_res = await client.post("/api/v1/settings/teams", json={"name": "Import Template Ops"}, headers=headers)
    assert team_res.status_code == 200, team_res.text
    device_res = await client.post("/api/v1/devices", json={
        "name": "MON-TEMPLATE-01",
        "system": "MON-TEMPLATE",
        "status": "Active",
        "type": "Physical",
        "serial_number": "MON-TEMPLATE-SN",
        "asset_tag": "MON-TEMPLATE-AT",
    }, headers=headers)
    assert device_res.status_code == 200, device_res.text
    monitor_res = await client.post("/api/v1/monitoring", json={
        "device_id": device_res.json()["id"],
        "category": "Hardware",
        "status": "Existing",
        "title": "Template Example Monitor",
        "platform": "Zabbix",
        "severity": "Warning",
        "owner_team": "Import Template Ops",
    }, headers=headers)
    assert monitor_res.status_code == 200, monitor_res.text
    monitor = monitor_res.json()

    schema_res = await client.get("/api/v1/import/schema/monitoring_items", headers=headers)
    assert schema_res.status_code == 200, schema_res.text
    schema = schema_res.json()

    assert schema["table_name"] == "monitoring_items"
    assert "title" in schema["required_fields"]
    assert "category" in schema["required_fields"]
    assert "status" in schema["required_fields"]
    assert "severity" in schema["required_fields"]
    assert "platform" not in schema["required_fields"]
    assert any(field["name"] == "device_name" for field in schema["fields"])
    assert any(field["name"] == "status" and field["options"] for field in schema["fields"])
    assert any(field["name"] == "owner_user_ids" for field in schema["fields"])
    assert any(field["name"] == "logic" and field["supported_in_builder"] is False for field in schema["fields"])
    assert any(record["id"] == monitor["id"] for record in schema["example_records"])

    template_res = await client.get(f"/api/v1/import/template/monitoring_items?columns=title,monitoring_url&mode=example&example_id={monitor['id']}", headers=headers)
    assert template_res.status_code == 200, template_res.text
    assert template_res.headers["x-sysgrid-schema-version"] == "2026-06-monitoring-v1"
    assert template_res.headers["x-sysgrid-import-profile"] == "monitoring_items"
    decoded = template_res.content.decode("utf-8")
    rows = list(csv.reader(io.StringIO(decoded)))

    assert rows[0][:5] == ["category", "status", "title", "severity", "monitoring_url"]
    assert "severity" in rows[0]
    assert "platform" not in rows[0]
    assert "monitoring_url" in rows[0]
    assert rows[1][rows[0].index("monitoring_url")] == "[https://...]"
    assert rows[2][rows[0].index("title")] == "Template Example Monitor"


@pytest.mark.anyio
async def test_monitoring_import_preview_rows_and_execute(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])}
    await _ensure_admin(seeded_admin_tenant)

    await client.post("/api/v1/settings/teams", json={"name": "Import Ops"}, headers=headers)

    device_res = await client.post("/api/v1/devices", json={
        "name": "MON-IMPORT-01",
        "system": "MON-IMPORT",
        "status": "Active",
        "type": "Physical",
        "serial_number": "MON-IMPORT-SN",
        "asset_tag": "MON-IMPORT-AT",
    }, headers=headers)
    assert device_res.status_code == 200, device_res.text

    knowledge_res = await client.post("/api/v1/knowledge", json={
        "title": "Import Recovery",
        "category": "Runbook",
        "content": "Recover the monitor",
        "status": "Draft",
    }, headers=headers)
    assert knowledge_res.status_code == 200, knowledge_res.text

    preview_res = await client.post(
        "/api/v1/import/preview-rows?table_name=monitoring_items",
        json={
            "rows": [
                {
                    "device_name": "MON-IMPORT-01",
                    "category": "Hardware",
                    "status": "Existing",
                    "title": "Disk Free Space",
                    "platform": "Zabbix",
                    "owner_team": "Import Ops",
                    "severity": "Critical",
                    "recovery_doc_titles": "Import Recovery",
                    "notification_recipients": "ops@example.com, pager@example.com",
                },
                {
                    "device_name": "UNKNOWN-ASSET",
                    "category": "Hardware",
                    "status": "Existing",
                    "title": "Bad Row",
                    "platform": "Zabbix",
                    "owner_team": "Import Ops",
                },
            ]
        },
        headers=headers,
    )
    assert preview_res.status_code == 200, preview_res.text
    preview = preview_res.json()

    assert preview["valid_rows"] == 1
    assert preview["invalid_rows"] == 1
    assert preview["results"][0]["normalized"]["notification_recipients"] == ["ops@example.com", "pager@example.com"]
    assert preview["results"][1]["status"] == "INVALID"
    assert "Unknown Target Asset" in preview["results"][1]["errors"][0]

    execute_res = await client.post(
        "/api/v1/import/execute?table_name=monitoring_items",
        headers={**headers, "X-User-Id": "admin_root"},
        json={
            "rows": [
                {
                    "device_name": "MON-IMPORT-01",
                    "category": "Hardware",
                    "status": "Existing",
                    "title": "Disk Free Space",
                    "platform": "Zabbix",
                    "owner_team": "Import Ops",
                    "severity": "Critical",
                    "recovery_doc_titles": "Import Recovery",
                    "notification_recipients": "ops@example.com, pager@example.com",
                }
            ]
        },
    )
    assert execute_res.status_code == 200, execute_res.text
    assert execute_res.json() == {"status": "success", "count": 1}

    list_res = await client.get("/api/v1/monitoring", headers=headers)
    assert list_res.status_code == 200, list_res.text
    monitors = list_res.json()
    assert len(monitors) == 1
    assert monitors[0]["title"] == "Disk Free Space"
    assert monitors[0]["owner_team"] == "Import Ops"
    assert monitors[0]["notification_recipients"] == ["ops@example.com", "pager@example.com"]
    assert monitors[0]["recovery_doc_titles"] == ["Import Recovery"]


@pytest.mark.anyio
async def test_monitoring_snapshot_export_uses_round_trip_import_contract(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])}
    await _ensure_admin(seeded_admin_tenant)

    await client.post("/api/v1/settings/teams", json={"name": "Snapshot Ops"}, headers=headers)
    device_res = await client.post("/api/v1/devices", json={
        "name": "MON-SNAPSHOT-01",
        "system": "MON-SNAPSHOT",
        "status": "Active",
        "type": "Physical",
        "serial_number": "MON-SNAPSHOT-SN",
        "asset_tag": "MON-SNAPSHOT-AT",
    }, headers=headers)
    device = device_res.json()
    knowledge_res = await client.post("/api/v1/knowledge", json={
        "title": "Snapshot Recovery",
        "category": "Runbook",
        "content": "Recover snapshot monitor",
        "status": "Draft",
    }, headers=headers)
    knowledge = knowledge_res.json()

    create_res = await client.post("/api/v1/monitoring", json={
        "device_id": device["id"],
        "category": "Hardware",
        "status": "Existing",
        "title": "Snapshot Monitor",
        "platform": "Zabbix",
        "owner_team": "Snapshot Ops",
        "notification_method": "Slack",
        "notification_recipients": ["snap@example.com"],
        "severity": "Critical",
        "recovery_docs": [knowledge["id"]],
        "spec": "Watch disk saturation",
        "logic": "disk_used > 90",
    }, headers=headers)
    assert create_res.status_code == 200, create_res.text

    snapshot_res = await client.get("/api/v1/import/snapshot/monitoring_items", headers=headers)
    assert snapshot_res.status_code == 200, snapshot_res.text
    assert snapshot_res.headers["x-sysgrid-schema-version"] == "2026-06-monitoring-v1"
    assert snapshot_res.headers["x-sysgrid-import-profile"] == "monitoring_items"

    rows = list(csv.DictReader(io.StringIO(snapshot_res.content.decode("utf-8"))))
    assert rows
    row = rows[0]
    assert row["device_name"] == "MON-SNAPSHOT-01"
    assert row["title"] == "Snapshot Monitor"
    assert row["owner_team"] == "Snapshot Ops"
    assert row["notification_recipients"] == "snap@example.com"
    assert row["recovery_doc_titles"] == "Snapshot Recovery"
    assert row["spec"] == "Watch disk saturation"
    assert row["logic"] == "disk_used > 90"


@pytest.mark.anyio
async def test_monitoring_import_preview_file_accepts_csv_upload(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])}
    await _ensure_admin(seeded_admin_tenant)

    await client.post("/api/v1/settings/teams", json={"name": "File Import Ops"}, headers=headers)
    await client.post("/api/v1/devices", json={
        "name": "MON-FILE-01",
        "system": "MON-FILE",
        "status": "Active",
        "type": "Physical",
        "serial_number": "MON-FILE-SN",
        "asset_tag": "MON-FILE-AT",
    }, headers=headers)

    csv_body = "\n".join([
        "device_name,category,status,title,platform,owner_team",
        "MON-FILE-01,Hardware,Existing,CPU Saturation,Zabbix,File Import Ops",
    ])
    preview_res = await client.post(
        "/api/v1/import/preview-file",
        files={"file": ("monitoring.csv", csv_body.encode("utf-8"), "text/csv")},
        data={"table_name": "monitoring_items"},
        headers=headers,
    )

    assert preview_res.status_code == 200, preview_res.text
    preview = preview_res.json()
    assert preview["total_rows"] == 1
    assert preview["valid_rows"] == 1


@pytest.mark.anyio
async def test_external_import_schema_template_preview_and_execute(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])}
    await _ensure_admin(seeded_admin_tenant)

    team_res = await client.post("/api/v1/settings/teams", json={"name": "External Import Ops"}, headers=headers)
    assert team_res.status_code == 200, team_res.text
    team = team_res.json()

    operator_res = await client.post("/api/v1/settings/operators", json={
        "external_id": "ext-import-op",
        "username": "ext-import-op",
        "full_name": "External Import Operator",
        "email": "ext-import-op@test.com",
        "department": "Integration",
        "team_id": team["id"],
    }, headers=headers)
    assert operator_res.status_code == 200, operator_res.text
    operator = operator_res.json()

    entity_res = await client.post("/api/v1/intelligence/entities", json={
        "name": "Import Example Entity",
        "external_key": "import-example-entity",
        "type": "API",
        "ownership_mode": "team",
        "internal_team_id": team["id"],
        "status": "Planned",
        "environment": "Production",
        "business_purpose": "Validate external import contracts",
        "contacts_json": [
            {
                "role": "Primary",
                "full_name": "Primary Import Contact",
                "email": "primary.import@example.com",
                "phone": "+1-555-0110",
                "external_person_id": "contact-1",
                "is_primary": True,
                "is_escalation": False,
            }
        ],
        "metadata_json": {"asset_class": "integration"},
    }, headers=headers)
    assert entity_res.status_code == 200, entity_res.text
    entity = entity_res.json()

    schema_res = await client.get("/api/v1/import/schema/external_entities", headers=headers)
    assert schema_res.status_code == 200, schema_res.text
    schema = schema_res.json()

    assert schema["table_name"] == "external_entities"
    assert "name" in schema["required_fields"]
    assert "type" in schema["required_fields"]
    assert "ownership_mode" in schema["required_fields"]
    assert "business_purpose" in schema["required_fields"]
    assert "contacts_json" in schema["required_fields"]
    assert any(field["name"] == "contacts_json" for field in schema["fields"])
    assert any(field["name"] == "internal_team_id" and field["options"] for field in schema["fields"])
    assert any(record["id"] == entity["id"] for record in schema["example_records"])

    template_res = await client.get(
        f"/api/v1/import/template/external_entities?columns=name,type,contacts_json&mode=example&example_id={entity['id']}",
        headers=headers,
    )
    assert template_res.status_code == 200, template_res.text
    assert template_res.headers["x-sysgrid-schema-version"] == "2026-06-external-v1"
    assert template_res.headers["x-sysgrid-import-profile"] == "external_entities"
    rows = list(csv.reader(io.StringIO(template_res.content.decode("utf-8"))))
    assert "name" in rows[0]
    assert "type" in rows[0]
    assert "contacts_json" in rows[0]
    assert rows[2][rows[0].index("name")] == "Import Example Entity"

    preview_res = await client.post(
        "/api/v1/import/preview-rows?table_name=external_entities",
        json={
            "rows": [
                {
                    "name": "Preview External Entity",
                    "type": "API",
                    "ownership_mode": "individual",
                    "internal_operator_id": operator["external_id"],
                    "status": "Active",
                    "environment": "Production",
                    "business_purpose": "Preview import validation",
                    "contacts_json": json.dumps([
                        {
                            "role": "Primary",
                            "full_name": "Preview Contact",
                            "email": "preview.contact@example.com",
                            "external_person_id": "preview-contact",
                            "is_primary": True,
                            "is_escalation": False,
                        }
                    ]),
                    "metadata_json": json.dumps({"source": "playwright"}),
                },
                {
                    "name": "Invalid External Entity",
                    "type": "API",
                    "ownership_mode": "team",
                    "status": "Active",
                    "environment": "Production",
                    "business_purpose": "Missing required team and contacts",
                },
            ]
        },
        headers=headers,
    )
    assert preview_res.status_code == 200, preview_res.text
    preview = preview_res.json()
    assert preview["valid_rows"] == 1
    assert preview["invalid_rows"] == 1
    assert preview["results"][0]["normalized"]["ownership_mode"] == "individual"
    assert preview["results"][1]["status"] == "INVALID"
    assert any("contacts_json" in error or "internal_team_id" in error for error in preview["results"][1]["errors"])

    execute_res = await client.post(
        "/api/v1/import/execute?table_name=external_entities",
        headers={**headers, "X-User-Id": "admin_root"},
        json={
            "rows": [
                {
                    "name": "Execute External Entity",
                    "type": "API",
                    "ownership_mode": "individual",
                    "internal_operator_id": operator["username"],
                    "status": "Active",
                    "environment": "Production",
                    "business_purpose": "Execute import validation",
                    "contacts_json": json.dumps([
                        {
                            "role": "Primary",
                            "full_name": "Execute Contact",
                            "email": "execute.contact@example.com",
                            "external_person_id": "execute-contact",
                            "is_primary": True,
                            "is_escalation": False,
                        }
                    ]),
                    "metadata_json": json.dumps({"imported": True}),
                }
            ]
        },
    )
    assert execute_res.status_code == 200, execute_res.text
    assert execute_res.json() == {"status": "success", "count": 1}

    list_res = await client.get("/api/v1/intelligence/entities?include_deleted=true", headers=headers)
    assert list_res.status_code == 200, list_res.text
    entities = list_res.json()
    assert any(item["name"] == "Execute External Entity" for item in entities)

    snapshot_res = await client.get("/api/v1/import/snapshot/external_entities", headers=headers)
    assert snapshot_res.status_code == 200, snapshot_res.text
    assert snapshot_res.headers["x-sysgrid-schema-version"] == "2026-06-external-v1"
    assert snapshot_res.headers["x-sysgrid-import-profile"] == "external_entities"
    snapshot_rows = list(csv.DictReader(io.StringIO(snapshot_res.content.decode("utf-8"))))
    assert any(row["name"] == "Execute External Entity" for row in snapshot_rows)
    assert any(row["business_purpose"] == "Execute import validation" for row in snapshot_rows)


@pytest.mark.anyio
async def test_external_snapshot_export_exposes_round_trip_headers_for_browser_js(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    headers = {
        "X-User-Id": "admin_root",
        "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"]),
        "Origin": "http://localhost:5173",
    }
    await _ensure_admin(seeded_admin_tenant)

    team_res = await client.post("/api/v1/settings/teams", json={"name": "External Export Ops"}, headers=headers)
    assert team_res.status_code == 200, team_res.text
    team = team_res.json()

    entity_res = await client.post("/api/v1/intelligence/entities", json={
        "name": "Export Header Entity",
        "external_key": "export-header-entity",
        "type": "API",
        "ownership_mode": "team",
        "internal_team_id": team["id"],
        "status": "Active",
        "environment": "Production",
        "business_purpose": "Validate exposed snapshot headers",
        "contacts_json": [
            {
                "role": "Primary",
                "full_name": "Export Header Contact",
                "email": "export.header@example.com",
                "external_person_id": "export-header-contact",
                "is_primary": True,
                "is_escalation": False,
            }
        ],
    }, headers=headers)
    assert entity_res.status_code == 200, entity_res.text

    manifest_res = await client.get("/api/v1/import/snapshot/external_entities/manifest", headers=headers)
    assert manifest_res.status_code == 200, manifest_res.text
    manifest = manifest_res.json()
    assert manifest["profile"] == "external_entities"
    assert manifest["schema_version"] == "2026-06-external-v1"
    assert manifest["scope"] == "active"
    assert manifest["content_type"] == "text/csv"
    assert re.fullmatch(
        r"SysGrid_External_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv",
        manifest["filename"],
    )
    assert re.fullmatch(
        r"/api/v1/import/snapshot/external_entities\?export_token=\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}",
        manifest["download_url"],
    )

    snapshot_res = await client.get(manifest["download_url"], headers=headers)
    assert snapshot_res.status_code == 200, snapshot_res.text
    assert snapshot_res.headers["x-sysgrid-import-profile"] == "external_entities"
    assert snapshot_res.headers["x-sysgrid-schema-version"] == "2026-06-external-v1"
    content_disposition_values = snapshot_res.headers.get_list("content-disposition")
    assert content_disposition_values and len(content_disposition_values) == 1
    content_disposition = content_disposition_values[0]
    assert content_disposition != "attachment; filename=SYSGRID_external_entities_Snapshot.csv"
    assert re.fullmatch(
        r'attachment; filename=SysGrid_External_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv',
        content_disposition,
    )
    assert content_disposition == f'attachment; filename={manifest["filename"]}'
    exposed_header_values = snapshot_res.headers.get_list("access-control-expose-headers")
    assert exposed_header_values == ["Content-Disposition, X-SysGrid-Import-Profile, X-SysGrid-Schema-Version"]
    exposed_headers = exposed_header_values[0]
    assert exposed_headers.strip()
    assert exposed_headers not in {"*", "**"}
    assert exposed_headers == "Content-Disposition, X-SysGrid-Import-Profile, X-SysGrid-Schema-Version"
    exposed_headers_normalized = {header.strip().lower() for header in exposed_headers.split(",") if header.strip()}
    assert exposed_headers_normalized == {
        "content-disposition",
        "x-sysgrid-import-profile",
        "x-sysgrid-schema-version",
    }


@pytest.mark.anyio
async def test_external_snapshot_manifest_and_csv_contract_stay_in_sync(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])}
    await _ensure_admin(seeded_admin_tenant)

    team_res = await client.post("/api/v1/settings/teams", json={"name": "External Manifest Sync Ops"}, headers=headers)
    assert team_res.status_code == 200, team_res.text
    team = team_res.json()

    entity_res = await client.post("/api/v1/intelligence/entities", json={
        "name": "Manifest Sync Entity",
        "external_key": "manifest-sync-entity",
        "type": "API",
        "ownership_mode": "team",
        "internal_team_id": team["id"],
        "status": "Active",
        "environment": "Production",
        "business_purpose": "Keep manifest and CSV export metadata aligned",
        "contacts_json": [
            {
                "role": "Primary",
                "full_name": "Manifest Sync Contact",
                "email": "manifest.sync@example.com",
                "external_person_id": "manifest-sync-contact",
                "is_primary": True,
                "is_escalation": False,
            }
        ],
    }, headers=headers)
    assert entity_res.status_code == 200, entity_res.text

    manifest_res = await client.get("/api/v1/import/snapshot/external_entities/manifest", headers=headers)
    assert manifest_res.status_code == 200, manifest_res.text
    manifest = manifest_res.json()

    snapshot_res = await client.get(manifest["download_url"], headers=headers)
    assert snapshot_res.status_code == 200, snapshot_res.text
    assert snapshot_res.headers["x-sysgrid-import-profile"] == manifest["profile"]
    assert snapshot_res.headers["x-sysgrid-schema-version"] == manifest["schema_version"]
    assert snapshot_res.headers["content-disposition"] == f'attachment; filename={manifest["filename"]}'


@pytest.mark.anyio
async def test_external_snapshot_export_previews_successfully_on_round_trip(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])}
    await _ensure_admin(seeded_admin_tenant)

    team_res = await client.post("/api/v1/settings/teams", json={"name": "External Round Trip Ops"}, headers=headers)
    assert team_res.status_code == 200, team_res.text
    team = team_res.json()

    entity_res = await client.post("/api/v1/intelligence/entities", json={
        "name": "External Round Trip Entity",
        "external_key": "external-round-trip-entity",
        "type": "API",
        "ownership_mode": "team",
        "internal_team_id": team["id"],
        "status": "Active",
        "environment": "Production",
        "business_purpose": "Validate export preview round trip",
        "contacts_json": [
            {
                "role": "Primary",
                "full_name": "Round Trip Contact",
                "email": "round.trip@example.com",
                "external_person_id": "round-trip-contact",
                "is_primary": True,
                "is_escalation": False,
            }
        ],
    }, headers=headers)
    assert entity_res.status_code == 200, entity_res.text

    snapshot_res = await client.get("/api/v1/import/snapshot/external_entities", headers=headers)
    assert snapshot_res.status_code == 200, snapshot_res.text

    preview_res = await client.post(
        "/api/v1/import/preview-file",
        files={"file": ("external-roundtrip.csv", snapshot_res.content, "text/csv")},
        data={"table_name": "external_entities"},
        headers=headers,
    )
    assert preview_res.status_code == 200, preview_res.text
    preview = preview_res.json()

    assert preview["total_rows"] == 1
    assert preview["valid_rows"] == 1
    assert preview["invalid_rows"] == 0
    assert preview["results"][0]["status"] == "VALID"
    assert preview["results"][0]["normalized"]["external_key"] == "external-round-trip-entity"


@pytest.mark.anyio
async def test_monitoring_import_rejects_duplicate_rows_in_same_batch(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])}
    await _ensure_admin(seeded_admin_tenant)

    await client.post("/api/v1/settings/teams", json={"name": "Dup Import Ops"}, headers=headers)
    await client.post("/api/v1/devices", json={
        "name": "MON-DUP-IMPORT-01",
        "system": "MON-DUP-IMPORT",
        "status": "Active",
        "type": "Physical",
        "serial_number": "MON-DUP-IMPORT-SN",
        "asset_tag": "MON-DUP-IMPORT-AT",
    }, headers=headers)

    preview_res = await client.post(
        "/api/v1/import/preview-rows?table_name=monitoring_items",
        json={
            "rows": [
                {
                    "device_name": "MON-DUP-IMPORT-01",
                    "category": "Hardware",
                    "status": "Existing",
                    "title": "Duplicate Import Monitor",
                    "platform": "Zabbix",
                    "owner_team": "Dup Import Ops",
                },
                {
                    "device_name": "MON-DUP-IMPORT-01",
                    "category": "Hardware",
                    "status": "Existing",
                    "title": "Duplicate Import Monitor",
                    "platform": "Zabbix",
                    "owner_team": "Dup Import Ops",
                },
            ]
        },
        headers=headers,
    )
    assert preview_res.status_code == 200, preview_res.text
    preview = preview_res.json()
    assert preview["valid_rows"] == 1
    assert preview["invalid_rows"] == 1
    assert "Duplicate monitoring row in the same import batch." in preview["results"][1]["errors"][0]
