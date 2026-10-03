import pytest


@pytest.mark.anyio
async def test_user_pool_revert_creates_new_version(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    tenant_id = seeded_admin_tenant["tenant_id"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(tenant_id)}
    original = {
        "external_id": "101",
        "username": "admin_alpha",
        "full_name": "Alpha Admin",
        "email": "alpha@example.com",
        "department": "Engineering",
    }
    created = await client.post("/api/v1/settings/operators", json=original, headers=headers)
    assert created.status_code == 200, created.text
    operator_id = created.json()["id"]

    versions_response = await client.get("/api/v1/settings/user-pool/versions", headers=headers)
    assert versions_response.status_code == 200, versions_response.text
    initial_versions = versions_response.json()
    source_version = initial_versions[0]
    source_user = next(row for row in source_version["snapshot_data"] if row["id"] == operator_id)
    assert all(source_user[field] == value for field, value in original.items())

    updated = await client.patch(f"/api/v1/settings/operators/{operator_id}", headers=headers,
                                 json={"full_name": "Alpha Admin Updated", "department": "Operations"})
    assert updated.status_code == 200, updated.text
    operators_response = await client.get("/api/v1/settings/operators", headers=headers)
    assert operators_response.status_code == 200, operators_response.text
    changed_user = next(row for row in operators_response.json() if row["id"] == operator_id)
    assert changed_user["full_name"] == "Alpha Admin Updated"
    assert changed_user["department"] == "Operations"
    changed_versions_response = await client.get("/api/v1/settings/user-pool/versions", headers=headers)
    assert changed_versions_response.status_code == 200, changed_versions_response.text
    changed_versions = changed_versions_response.json()
    assert len(changed_versions) == len(initial_versions) + 1

    restored = await client.post(f"/api/v1/settings/user-pool/restore/{source_version['id']}", headers=headers)
    assert restored.status_code == 200, restored.text
    operators_response = await client.get("/api/v1/settings/operators", headers=headers)
    assert operators_response.status_code == 200, operators_response.text
    restored_user = next(row for row in operators_response.json() if row["id"] == operator_id)
    assert all(restored_user[field] == value for field, value in original.items())

    versions_response = await client.get("/api/v1/settings/user-pool/versions", headers=headers)
    assert versions_response.status_code == 200, versions_response.text
    versions = versions_response.json()
    assert len(versions) == len(changed_versions) + 1
    latest = versions[0]
    assert latest["id"] not in {row["id"] for row in changed_versions}
    assert latest["version_label"] == restored.json()["new_version"]
    assert f"Cloned from {source_version['version_label']}" in latest["version_label"]
    assert latest["is_active"] is True
    assert not any(row["is_active"] for row in versions[1:])
    assert latest["diff_summary"]["source_version_id"] == source_version["id"]
    saved = next(row for row in latest["snapshot_data"] if row["id"] == operator_id)
    assert all(saved[field] == value for field, value in original.items())
