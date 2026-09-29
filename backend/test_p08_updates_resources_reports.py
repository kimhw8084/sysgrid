from datetime import date
import base64
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.config import UserTenantAccess
from app.pv1 import models


def headers(tenant_id: int, user_id: str = "admin_root", command_id: str | None = None) -> dict[str, str]:
    value = {"X-Tenant-Id": str(tenant_id), "X-User-Id": user_id}
    if command_id:
        value["Idempotency-Key"] = command_id
    return value


def envelope(command_id: str, command_type: str, expected: dict, payload: dict) -> dict:
    return {"command_id": command_id, "type": command_type, "expected": expected, "payload": payload}


async def create_project(client, tenant_id: int) -> tuple[str, dict]:
    command_id = str(uuid4())
    response = await client.post("/api/v2/projects", headers=headers(tenant_id, command_id=command_id), json={"name": "P08 evidence project", "objective": "Communicate persisted facts without chores"})
    assert response.status_code == 200, response.text
    body = response.json()
    return body["project"]["id"], body["project"]


async def command(client, tenant_id: int, project_id: str, project_revision: int, command_type: str, payload: dict, user_id: str = "admin_root", graph_revision: int | None = None):
    command_id = str(uuid4())
    expected = {"project_revision": project_revision}
    if graph_revision is not None:
        expected["graph_revision"] = graph_revision
    response = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, user_id, command_id), json=envelope(command_id, command_type, expected, payload))
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_ai_disabled_update_is_deterministic_and_published_snapshot_is_immutable(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    project_id, project = await create_project(client, tenant_id)
    task = await command(client, tenant_id, project_id, project["revision"], "task.create", {"title": "Persisted acceptance fact", "owner_id": "admin_root"}, graph_revision=project["graph_revision"])
    task_id = task["changed_entities"][0]["id"]
    current_revision = task["revisions"]["project_revision"]
    criterion = await command(client, tenant_id, project_id, current_revision, "criterion.create", {"parent_kind": "Task", "parent_id": task_id, "description": "Evidence is reviewed"})
    current_revision = criterion["revisions"]["project_revision"]
    draft_id = str(uuid4())
    draft_response = await client.post(f"/api/v2/projects/{project_id}/updates/draft", headers=headers(tenant_id, command_id=draft_id), json={"period_start": "2026-01-01", "period_end": "2026-12-31"})
    assert draft_response.status_code == 200, draft_response.text
    draft_id = draft_response.json()["changed_entities"][0]["id"]
    draft_project_revision = draft_response.json()["revisions"]["project_revision"]
    update = await client.get(f"/api/v2/projects/{project_id}/updates", headers=headers(tenant_id))
    assert update.status_code == 200
    content = update.json()["items"][0]["content"]
    assert content["ai_enabled"] is False
    assert any("Persisted acceptance fact" in item["text"] for item in content["sections"].get("Next", []))
    published_id = str(uuid4())
    published = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, command_id=published_id), json=envelope(published_id, "update.publish", {"project_revision": draft_project_revision}, {"update_id": draft_id}))
    assert published.status_code == 200, published.text
    snapshot = await client.get(f"/api/v2/projects/{project_id}/updates", headers=headers(tenant_id))
    before = next(item for item in snapshot.json()["items"] if item["id"] == draft_id)
    task_edit = str(uuid4())
    edited = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, command_id=task_edit), json=envelope(task_edit, "task.update_fields", {"project_revision": draft_project_revision, "graph_revision": task["revisions"]["graph_revision"], "task_revision": 1}, {"task_id": task_id, "progress": 25}))
    assert edited.status_code == 200, edited.text
    after = await client.get(f"/api/v2/projects/{project_id}/updates", headers=headers(tenant_id))
    published_after = next(item for item in after.json()["items"] if item["id"] == draft_id)
    assert published_after["content"] == before["content"]
    assert published_after["source_revisions"] == before["source_revisions"]


@pytest.mark.asyncio
async def test_resource_safety_versions_pin_limit_and_exports(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    project_id, project = await create_project(client, tenant_id)
    unsafe_id = str(uuid4())
    unsafe = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, command_id=unsafe_id), json=envelope(unsafe_id, "resource.save", {"project_revision": project["revision"]}, {"title": "unsafe", "resource_kind": "General note", "content": "<script>alert(1)</script>"}))
    assert unsafe.status_code == 422
    revision = project["revision"]
    resource_ids = []
    for index in range(4):
        command_id = str(uuid4())
        created = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, command_id=command_id), json=envelope(command_id, "resource.save", {"project_revision": revision}, {"title": f"Safe {index}", "resource_kind": "Runbook", "content": f"# Step {index}", "pinned": True}))
        assert created.status_code == 200, created.text
        resource_ids.append(created.json()["changed_entities"][0]["id"])
        revision = created.json()["revisions"]["project_revision"]
    fifth_id = str(uuid4())
    fifth = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, command_id=fifth_id), json=envelope(fifth_id, "resource.save", {"project_revision": revision}, {"title": "Too many", "resource_kind": "General note", "content": "x", "pinned": True}))
    assert fifth.status_code == 422
    edit_id = str(uuid4())
    edited = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, command_id=edit_id), json=envelope(edit_id, "resource.save", {"project_revision": revision, "resource_revision": 1}, {"resource_id": resource_ids[0], "revision": 1, "title": "Safe edited", "resource_kind": "Runbook", "content": "Updated evidence"}))
    assert edited.status_code == 200, edited.text
    revision = edited.json()["revisions"]["project_revision"]
    versions = await client.get(f"/api/v2/projects/{project_id}/resources/{resource_ids[0]}/versions", headers=headers(tenant_id))
    assert versions.status_code == 200
    assert len(versions.json()["items"]) == 2
    csv_export = await client.get(f"/api/v2/projects/{project_id}/resources/export?format=csv", headers=headers(tenant_id))
    assert csv_export.status_code == 200
    assert "Safe edited" in csv_export.text
    unsafe_file_id = str(uuid4())
    unsafe_file = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, command_id=unsafe_file_id), json=envelope(unsafe_file_id, "resource.save", {"project_revision": revision}, {"title": "unsafe file", "resource_kind": "Uploaded file", "content": "", "upload": {"filename": "payload.txt", "mime_type": "text/plain", "content_base64": base64.b64encode(b"EICAR test signature").decode()}}))
    assert unsafe_file.status_code == 422
    csv_resource_id = str(uuid4())
    csv_resource = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, command_id=csv_resource_id), json=envelope(csv_resource_id, "resource.save", {"project_revision": revision}, {"title": "=SUM(A1:A2)", "resource_kind": "General note", "content": "CSV injection check"}))
    assert csv_resource.status_code == 200, csv_resource.text
    csv_export = await client.get(f"/api/v2/projects/{project_id}/resources/export?format=csv", headers=headers(tenant_id))
    assert "'=SUM(A1:A2)" in csv_export.text


@pytest.mark.asyncio
async def test_reports_activity_and_notification_retry_are_snapshot_safe(client, seeded_admin_tenant, setup_db, provision_module_operator):
    tenant_id = seeded_admin_tenant["tenant_id"]
    project_id, project = await create_project(client, tenant_id)
    session_factory = await _tenant_session_factory(setup_db, tenant_id)
    _, config_session_factory = setup_db
    async with config_session_factory() as config_session:
        config_session.add(UserTenantAccess(user_id="reviewer", tenant_id=tenant_id, role="VIEWER", is_selected=True))
        await config_session.commit()
    await provision_module_operator(tenant_id, 'reviewer', 'projects', preview=True)
    async with session_factory() as session:
        project_record = await session.get(models.PV1Project, project_id)
        project_record.phase = "Executing"
        session.add(models.PV1ProjectMember(id=str(uuid4()), tenant_id=tenant_id, project_id=project_id, user_id="reviewer", role="Lead", capabilities={}, created_by="admin_root", updated_by="admin_root"))
        await session.commit()
    cadence = await client.post(f"/api/v2/projects/{project_id}/notifications/cadence", headers=headers(tenant_id), json={"as_of": "2026-09-11T15:00:00+00:00"})
    assert cadence.status_code == 200 and cadence.json()["queued"] == 1
    cadence_retry = await client.post(f"/api/v2/projects/{project_id}/notifications/cadence", headers=headers(tenant_id), json={"as_of": "2026-09-11T15:00:00+00:00"})
    assert cadence_retry.status_code == 200 and cadence_retry.json()["queued"] == 0
    draft_command = str(uuid4())
    draft = await client.post(f"/api/v2/projects/{project_id}/updates/draft", headers=headers(tenant_id, command_id=draft_command), json={"period_start": "2026-01-01", "period_end": "2026-12-31"})
    assert draft.status_code == 200, draft.text
    draft_id = draft.json()["changed_entities"][0]["id"]
    publish_command = str(uuid4())
    published = await client.post(f"/api/v2/projects/{project_id}/commands", headers=headers(tenant_id, command_id=publish_command), json=envelope(publish_command, "update.publish", {"project_revision": draft.json()["revisions"]["project_revision"]}, {"update_id": draft_id}))
    assert published.status_code == 200, published.text
    notifications = await client.get(f"/api/v2/projects/{project_id}/notifications", headers=headers(tenant_id, user_id="reviewer"))
    assert notifications.status_code == 200
    assert len(notifications.json()["items"]) == 1
    dispatched = await client.post(f"/api/v2/projects/{project_id}/notifications/dispatch", headers=headers(tenant_id, user_id="reviewer"))
    assert dispatched.status_code == 200
    retry = await client.post(f"/api/v2/projects/{project_id}/notifications/dispatch", headers=headers(tenant_id, user_id="reviewer"))
    assert retry.status_code == 200
    assert retry.json()["sent"] == 0
    report_command = str(uuid4())
    report = await client.post(f"/api/v2/projects/{project_id}/reports/capture", headers=headers(tenant_id, command_id=report_command), json={"report_type": "Stakeholder summary", "period_start": "2026-01-01", "period_end": "2026-12-31"})
    assert report.status_code == 200, report.text
    report_id = report.json()["changed_entities"][0]["id"]
    report_before = await client.get(f"/api/v2/projects/{project_id}/reports/{report_id}", headers=headers(tenant_id))
    assert report_before.status_code == 200
    assert report_before.json()["payload"]["objective"] == "Communicate persisted facts without chores"
    pdf = await client.get(f"/api/v2/projects/{project_id}/reports/{report_id}/export?format=pdf", headers=headers(tenant_id))
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    activity = await client.get(f"/api/v2/projects/{project_id}/activity", headers=headers(tenant_id))
    assert activity.status_code == 200
    assert any(item["category"] == "Communication" for item in activity.json()["items"])


async def _tenant_session_factory(setup_db, tenant_id: int):
    from app.database import get_tenant_engine
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
    from app.models.config import Tenant

    _, config_session = setup_db
    async with config_session() as session:
        tenant = await session.get(Tenant, tenant_id)
        url = tenant.db_url
    return async_sessionmaker(bind=get_tenant_engine(url), class_=AsyncSession, expire_on_commit=False)
