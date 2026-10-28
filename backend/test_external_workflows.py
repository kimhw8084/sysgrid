import pytest
from app.api.settings import ensure_tenant_admin_async
from app.models.config import Tenant
from sqlalchemy import select
from app.database import ConfigSessionLocal

@pytest.mark.anyio
async def test_external_entity_creation_and_secret_management(seeded_admin_tenant):
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

    team_res = await client.post("/api/v1/settings/teams", json={"name": "External Governance"}, headers=headers)
    assert team_res.status_code == 200, team_res.text
    team = team_res.json()
    operator_res = await client.post("/api/v1/settings/operators", json={
        "external_id": "external-ops-001",
        "username": "external.ops.001",
        "full_name": "External Ops One",
        "email": "external.ops.001@example.com",
        "department": "Operations",
        "team_id": team["id"],
    }, headers=headers)
    assert operator_res.status_code == 200, operator_res.text
    default_operator = operator_res.json()

    create_res = await client.post("/api/v1/intelligence/entities", json={
        "name": "EXT-QA-01",
        "type": "API",
        "external_key": "ext-qa-01",
        "owner_organization": "PartnerCo",
        "owner_team": "B2B",
        "ownership_mode": "individual",
        "internal_operator_id": default_operator["id"],
        "status": "Active",
        "environment": "Production",
        "description": "External partner feed",
        "contacts_json": [{
            "role": "Primary",
            "full_name": "Jane Doe",
            "external_person_id": "JD-01",
            "email": "jane.doe@example.com",
            "phone": "+1-555-0101",
            "is_primary": True,
            "is_escalation": False,
        }],
        "business_purpose": "External partner feed",
        "criticality": "High",
        "dependency_tier": "Tier 2",
        "integration_mode": "API",
        "primary_endpoint_url": "https://partner.example.com",
        "auth_method": "Token",
        "risk_rating": "Medium",
        "metadata_json": {"custom_note": "retain-me"},
    }, headers=headers)
    assert create_res.status_code == 200, create_res.text
    entity = create_res.json()
    assert entity["name"] == "EXT-QA-01"
    assert entity["secrets"] == []

    preview_res = await client.post("/api/v1/intelligence/entities/bulk-action", json={
        "ids": [entity["id"]],
        "action": "update",
        "payload": {"risk_rating": "High"},
        "dry_run": True,
    }, headers=headers)
    assert preview_res.status_code == 200, preview_res.text
    preview = preview_res.json()
    assert preview["status"] == "preview"
    assert preview["changed_count"] == 1
    assert preview["can_execute"] is True

    before_execute = await client.get("/api/v1/intelligence/entities?include_deleted=true", headers=headers)
    assert next(item for item in before_execute.json() if item["id"] == entity["id"])["risk_rating"] == "Medium"

    execute_res = await client.post("/api/v1/intelligence/entities/bulk-action", json={
        "ids": [entity["id"]],
        "action": "update",
        "payload": {"risk_rating": "High"},
        "precondition": preview["precondition"],
        "operation_id": preview["operation_id"],
    }, headers=headers)
    assert execute_res.status_code == 200, execute_res.text
    assert execute_res.json()["changed_count"] == 1
    replayed_bulk_res = await client.post("/api/v1/intelligence/entities/bulk-action", json={
        "ids": [entity["id"]],
        "action": "update",
        "payload": {"risk_rating": "High"},
        "precondition": preview["precondition"],
        "operation_id": preview["operation_id"],
    }, headers=headers)
    assert replayed_bulk_res.status_code == 200
    assert replayed_bulk_res.json()["changed_count"] == 1
    undo_res = await client.post("/api/v1/intelligence/entities/bulk-action", json={
        "ids": [entity["id"]],
        "action": "undo",
        "receipt_id": execute_res.json()["receipt_id"],
    }, headers=headers)
    assert undo_res.status_code == 200, undo_res.text
    assert undo_res.json()["status"] == "reverted"
    current_entities = await client.get("/api/v1/intelligence/entities?include_deleted=true", headers=headers)
    current_entity = next(item for item in current_entities.json() if item["id"] == entity["id"])
    assert current_entity["risk_rating"] == "Medium"

    secret_res = await client.post(f"/api/v1/intelligence/entities/{entity['id']}/secrets", json={
        "secret_label": "Readonly feed",
        "secret_type": "VaultReference",
        "username": "svc_partner",
        "vault_provider": "1Password",
        "vault_path": "vault://partner/feed/readonly",
        "note": "Readonly feed access",
    }, headers=headers)
    assert secret_res.status_code == 200, secret_res.text

    update_res = await client.put(f"/api/v1/intelligence/entities/{entity['id']}", json={
        "id": entity["id"],
        "edit_revision": current_entity["edit_revision"],
        "name": "EXT-QA-01",
        "external_key": "ext-qa-01",
        "type": "Virtual Server",
        "owner_organization": "PartnerCo",
        "owner_team": "B2B",
        "ownership_mode": "individual",
        "internal_operator_id": default_operator["id"],
        "status": "Active",
        "environment": "Production",
        "description": "External partner feed",
        "contacts_json": [{
            "role": "Primary",
            "full_name": "Jane Doe",
            "external_person_id": "JD-01",
            "email": "jane.doe@example.com",
            "phone": "+1-555-0101",
            "is_primary": True,
            "is_escalation": False,
        }],
        "business_purpose": "External partner feed",
        "criticality": "High",
        "dependency_tier": "Tier 2",
        "integration_mode": "Database",
        "primary_endpoint_url": "https://partner.example.com",
        "auth_method": "Token",
        "risk_rating": "High",
        "metadata_json": {"hypervisor": "", "vcpu": "", "vram": "", "os": ""},
    }, headers=headers)
    assert update_res.status_code == 200, update_res.text
    stale_update_payload = {**update_res.json(), "edit_revision": current_entity["edit_revision"]}
    stale_update_res = await client.put(
        f"/api/v1/intelligence/entities/{entity['id']}", headers=headers, json=stale_update_payload,
    )
    assert stale_update_res.status_code == 409

    list_res = await client.get("/api/v1/intelligence/entities?include_deleted=true", headers=headers)
    assert list_res.status_code == 200, list_res.text
    loaded = next(item for item in list_res.json() if item["id"] == entity["id"])
    assert loaded["metadata_json"]["hypervisor"] == ""
    assert len(loaded["secrets"]) == 1
    assert loaded["secrets"][0]["username"] == "svc_partner"

    archive_res = await client.delete(
        f"/api/v1/intelligence/entities/{entity['id']}",
        headers=headers,
        params={"expected_revision": update_res.json()["edit_revision"]},
    )
    assert archive_res.status_code == 200, archive_res.text
    purge_preview_res = await client.post("/api/v1/intelligence/entities/bulk-action", json={
        "ids": [entity["id"]],
        "action": "purge",
        "dry_run": True,
    }, headers=headers)
    assert purge_preview_res.status_code == 200, purge_preview_res.text
    purge_preview = purge_preview_res.json()
    assert purge_preview["blocked_count"] == 1
    assert purge_preview["can_execute"] is False
    assert "credentials" in purge_preview["blockers"][0]["reason"].lower()


@pytest.mark.anyio
async def test_external_archived_entity_blocks_new_links_and_secrets(seeded_admin_tenant):
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

    team_res = await client.post("/api/v1/settings/teams", json={"name": "External Archive Ops"}, headers=headers)
    assert team_res.status_code == 200, team_res.text
    team = team_res.json()
    operator_res = await client.post("/api/v1/settings/operators", json={
        "external_id": "external-ops-archive-001",
        "username": "external.archive.001",
        "full_name": "External Archive Owner",
        "email": "external.archive.001@example.com",
        "department": "Operations",
        "team_id": team["id"],
    }, headers=headers)
    assert operator_res.status_code == 200, operator_res.text
    operator = operator_res.json()
    device_res = await client.post("/api/v1/devices", json={
        "name": "EXT-LINK-DEVICE-01",
        "system": "EXT-LINK-SYS",
        "status": "Active",
        "type": "Physical",
        "serial_number": "EXT-LINK-SN",
        "asset_tag": "EXT-LINK-AT",
    }, headers=headers)
    assert device_res.status_code == 200, device_res.text
    device = device_res.json()

    entity_res = await client.post("/api/v1/intelligence/entities", json={
        "name": "ARCHIVE-EXT-01",
        "type": "API",
        "external_key": "archive-ext-01",
        "owner_organization": "PartnerCo",
        "ownership_mode": "individual",
        "internal_operator_id": operator["id"],
        "status": "Active",
        "environment": "Production",
        "description": "Archived external entity",
        "contacts_json": [{
            "role": "Primary",
            "full_name": "Jane Archive",
            "external_person_id": "JA-01",
            "email": "jane.archive@example.com",
            "phone": "+1-555-0110",
            "is_primary": True,
            "is_escalation": False,
        }],
        "business_purpose": "Archive validation",
        "criticality": "High",
        "dependency_tier": "Tier 2",
        "integration_mode": "API",
        "primary_endpoint_url": "https://archive.example.com",
        "auth_method": "Token",
        "risk_rating": "Medium",
        "metadata_json": {},
    }, headers=headers)
    assert entity_res.status_code == 200, entity_res.text
    entity = entity_res.json()

    delete_res = await client.delete(
        f"/api/v1/intelligence/entities/{entity['id']}", headers=headers,
        params={"expected_revision": entity["edit_revision"]},
    )
    assert delete_res.status_code == 200, delete_res.text

    secret_res = await client.post(f"/api/v1/intelligence/entities/{entity['id']}/secrets", json={
        "secret_label": "Archived secret",
        "secret_type": "VaultReference",
        "username": "svc_archived",
        "vault_provider": "1Password",
        "vault_path": "vault://archived/entity",
        "note": "Archived entity credential",
    }, headers=headers)
    assert secret_res.status_code == 400
    assert "archived external entity" in secret_res.json()["detail"]

    link_res = await client.post("/api/v1/intelligence/links", json={
        "external_entity_id": entity["id"],
        "device_id": device["id"],
        "direction": "Outbound",
        "purpose": "Archive blocked link",
        "protocol": "HTTPS",
        "port": 443,
        "host_or_fqdn": "archive.example.com",
        "path_or_resource": "/health",
        "link_status": "Active",
    }, headers=headers)
    assert link_res.status_code == 400
    assert "archived external entity" in link_res.json()["detail"]


@pytest.mark.anyio
async def test_external_links_are_enriched_and_duplicate_shape_is_blocked(seeded_admin_tenant):
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

    team_res = await client.post("/api/v1/settings/teams", json={"name": "External Link Ops"}, headers=headers)
    assert team_res.status_code == 200, team_res.text
    team = team_res.json()
    operator_res = await client.post("/api/v1/settings/operators", json={
        "external_id": "external-link-001",
        "username": "external.link.001",
        "full_name": "External Link Owner",
        "email": "external.link.001@example.com",
        "department": "Operations",
        "team_id": team["id"],
    }, headers=headers)
    assert operator_res.status_code == 200, operator_res.text
    operator = operator_res.json()
    device_res = await client.post("/api/v1/devices", json={
        "name": "EXT-ENRICH-DEVICE-01",
        "system": "EXT-ENRICH-SYS",
        "status": "Active",
        "type": "Physical",
        "serial_number": "EXT-ENRICH-SN",
        "asset_tag": "EXT-ENRICH-AT",
    }, headers=headers)
    assert device_res.status_code == 200, device_res.text
    device = device_res.json()

    entity_res = await client.post("/api/v1/intelligence/entities", json={
        "name": "ENRICH-EXT-01",
        "type": "API",
        "external_key": "enrich-ext-01",
        "owner_organization": "PartnerCo",
        "ownership_mode": "individual",
        "internal_operator_id": operator["id"],
        "status": "Active",
        "environment": "Production",
        "description": "Enriched link target",
        "contacts_json": [{
            "role": "Primary",
            "full_name": "Link Primary",
            "external_person_id": "LP-01",
            "email": "link.primary@example.com",
            "phone": "+1-555-0111",
            "is_primary": True,
            "is_escalation": False,
        }],
        "business_purpose": "Link enrichment validation",
        "criticality": "High",
        "dependency_tier": "Tier 2",
        "integration_mode": "API",
        "primary_endpoint_url": "https://enrich.example.com",
        "auth_method": "Token",
        "risk_rating": "Medium",
        "metadata_json": {},
    }, headers=headers)
    entity = entity_res.json()

    link_payload = {
        "external_entity_id": entity["id"],
        "device_id": device["id"],
        "direction": "Outbound",
        "purpose": "Primary partner feed",
        "protocol": "HTTPS",
        "port": 443,
        "host_or_fqdn": "enrich.example.com",
        "path_or_resource": "/status",
        "link_status": "Active",
    }
    secret_value_res = await client.post("/api/v1/intelligence/links", json={
        **link_payload,
        "credentials": {"username": "partner-user", "password": "must-not-be-stored"},
    }, headers=headers)
    assert secret_value_res.status_code == 422

    link_payload["credentials"] = {
        "username": "partner-user",
        "vault_path": "vault://partner/readonly",
        "note": "Read-only integration reference",
    }
    create_link_res = await client.post("/api/v1/intelligence/links", json=link_payload, headers=headers)
    assert create_link_res.status_code == 200, create_link_res.text
    assert create_link_res.json()["credentials"] == link_payload["credentials"]

    dup_link_res = await client.post("/api/v1/intelligence/links", json=link_payload, headers=headers)
    assert dup_link_res.status_code == 409
    assert "same shape already exists" in dup_link_res.json()["detail"]

    links_res = await client.get("/api/v1/intelligence/links", headers=headers)
    assert links_res.status_code == 200, links_res.text
    links = links_res.json()
    link = next(item for item in links if item["external_entity_id"] == entity["id"])
    assert link["external_entity_name"] == "ENRICH-EXT-01"
    assert link["device_name"] == "EXT-ENRICH-DEVICE-01"
    assert "password" not in link["credentials"]

    from app.schemas.schemas import ExternalLinkResponse
    legacy_response = ExternalLinkResponse.model_validate({
        **link,
        "credentials": {"username": "partner-user", "password": "legacy-inline-secret", "vault_path": "vault://partner/readonly"},
    })
    assert legacy_response.credentials == {"username": "partner-user", "vault_path": "vault://partner/readonly"}

    updated_link_payload = {
        **link_payload,
        "purpose": "Updated partner feed",
        "edit_revision": link["edit_revision"],
    }
    updated_link_res = await client.put(
        f"/api/v1/intelligence/links/{link['id']}",
        json=updated_link_payload,
        headers=headers,
    )
    assert updated_link_res.status_code == 200, updated_link_res.text
    assert updated_link_res.json()["purpose"] == "Updated partner feed"
    stale_link_res = await client.put(
        f"/api/v1/intelligence/links/{link['id']}",
        json=updated_link_payload,
        headers=headers,
    )
    assert stale_link_res.status_code == 409
    secret_link_update_res = await client.put(
        f"/api/v1/intelligence/links/{link['id']}",
        json={**updated_link_payload, "edit_revision": updated_link_res.json()["edit_revision"],
              "credentials": {"username": "partner-user", "password": "must-not-be-stored"}},
        headers=headers,
    )
    assert secret_link_update_res.status_code == 422


@pytest.mark.anyio
async def test_external_entity_blocks_active_identity_duplicates_and_restore_conflicts(seeded_admin_tenant):
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

    team_res = await client.post("/api/v1/settings/teams", json={"name": "External Identity Ops"}, headers=headers)
    assert team_res.status_code == 200, team_res.text
    team = team_res.json()
    operator_res = await client.post("/api/v1/settings/operators", json={
        "external_id": "external-identity-001",
        "username": "external.identity.001",
        "full_name": "External Identity Owner",
        "email": "external.identity.001@example.com",
        "department": "Operations",
        "team_id": team["id"],
    }, headers=headers)
    assert operator_res.status_code == 200, operator_res.text
    operator = operator_res.json()

    base_payload = {
        "name": "IDENTITY-EXT-01",
        "type": "API",
        "owner_organization": "PartnerCo",
        "ownership_mode": "individual",
        "internal_operator_id": operator["id"],
        "status": "Active",
        "environment": "Production",
        "description": "Identity conflict target",
        "contacts_json": [{
            "role": "Primary",
            "full_name": "Identity Primary",
            "external_person_id": "IP-01",
            "email": "identity.primary@example.com",
            "phone": "+1-555-0112",
            "is_primary": True,
            "is_escalation": False,
        }],
        "business_purpose": "Identity uniqueness validation",
        "criticality": "High",
        "dependency_tier": "Tier 2",
        "integration_mode": "API",
        "primary_endpoint_url": "https://identity.example.com",
        "auth_method": "Token",
        "risk_rating": "Medium",
        "metadata_json": {},
    }

    first_res = await client.post("/api/v1/intelligence/entities", json={**base_payload, "external_key": "identity-ext-01"}, headers=headers)
    assert first_res.status_code == 200, first_res.text
    first = first_res.json()

    duplicate_res = await client.post("/api/v1/intelligence/entities", json={**base_payload, "external_key": "identity-ext-02"}, headers=headers)
    assert duplicate_res.status_code == 409
    assert "same name, type, and owner organization" in duplicate_res.json()["detail"]

    premature_purge = await client.delete(
        f"/api/v1/intelligence/entities/{first['id']}", headers=headers,
        params={"purge": "true", "expected_revision": first["edit_revision"]},
    )
    assert premature_purge.status_code == 409
    assert "Archive this external entity" in premature_purge.json()["detail"]

    archive_res = await client.delete(
        f"/api/v1/intelligence/entities/{first['id']}", headers=headers,
        params={"expected_revision": first["edit_revision"]},
    )
    assert archive_res.status_code == 200, archive_res.text

    replacement_res = await client.post("/api/v1/intelligence/entities", json={**base_payload, "external_key": "identity-ext-02"}, headers=headers)
    assert replacement_res.status_code == 200, replacement_res.text

    restore_res = await client.post(
        f"/api/v1/intelligence/entities/{first['id']}/restore", headers=headers,
        params={"expected_revision": archive_res.json()["edit_revision"]},
    )
    assert restore_res.status_code == 409
    assert "same name, type, and owner organization" in restore_res.json()["detail"]
