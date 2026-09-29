from datetime import date
from time import perf_counter
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.models.config import UserTenantAccess
from app.pv1.focus import build_focus


def _headers(tenant_id: int, user_id: str = "admin_root", command_id: str | None = None) -> dict[str, str]:
    headers = {"X-User-Id": user_id, "X-Tenant-Id": str(tenant_id)}
    if command_id:
        headers["Idempotency-Key"] = command_id
    return headers


def _command(command_id: str, command_type: str, *, expected: dict | None = None, payload: dict | None = None) -> dict:
    return {"command_id": command_id, "type": command_type, "expected": expected or {}, "payload": payload or {}}


async def _create_project(client, tenant_id: int, name: str = "P05 project") -> tuple[str, dict]:
    command_id = str(uuid4())
    response = await client.post("/api/v2/projects", headers=_headers(tenant_id, command_id=command_id), json={"name": name, "objective": "One canonical task graph"})
    assert response.status_code == 200, response.text
    body = response.json()
    return body["project"]["id"], body["project"]


async def _command_call(client, tenant_id: int, project_id: str, command_type: str, expected: dict, payload: dict, user_id: str = "admin_root"):
    command_id = str(uuid4())
    response = await client.post(f"/api/v2/projects/{project_id}/commands", headers=_headers(tenant_id, user_id, command_id), json=_command(command_id, command_type, expected=expected, payload=payload))
    return response


def test_focus_engine_bucket_tie_and_diversity_are_deterministic():
    projects = [SimpleNamespace(id="p1", name="Alpha", phase="Executing", run_state="Active", archived_at=None), SimpleNamespace(id="p2", name="Beta", phase="Executing", run_state="Active", archived_at=None)]
    tasks = [
        SimpleNamespace(id="a", project_id="p1", kind="Task", status="To Do", owner_id="mina", priority="High", progress=0, mandatory=True, end_date=date(2026, 9, 7), point_date=None, title="Due A", created_at=None, updated_at=None),
        SimpleNamespace(id="b", project_id="p1", kind="Task", status="To Do", owner_id="mina", priority="Medium", progress=0, mandatory=True, end_date=date(2026, 9, 8), point_date=None, title="Due B", created_at=None, updated_at=None),
        SimpleNamespace(id="c", project_id="p2", kind="Task", status="In progress", owner_id="mina", priority="Critical", progress=20, mandatory=True, end_date=None, point_date=None, title="Critical C", created_at=None, updated_at=None),
    ]
    first = build_focus(actor_id="mina", projects=projects, tasks=tasks, today=date(2026, 9, 7))
    second = build_focus(actor_id="mina", projects=projects, tasks=tasks, today=date(2026, 9, 7))
    assert first == second
    assert [item["bucket"] for item in first["items"]] == [3, 5, 6]
    assert first["items"][0]["due_context"] == "Due today"


def test_focus_engine_indexes_large_dependency_graph_without_changing_critical_path_truth():
    project = SimpleNamespace(id="large", name="Large", phase="Executing", run_state="Active", archived_at=None)
    tasks = [
        SimpleNamespace(
            id=f"task-{index}", project_id="large", kind="Task", status="To Do", owner_id="mina",
            priority="Medium", progress=0, mandatory=True, end_date=date(2026, 9, 7),
            point_date=None, title=f"Task {index}", created_at=None, updated_at=None,
        )
        for index in range(10_000)
    ]
    dependencies = [
        SimpleNamespace(
            predecessor_id=f"task-{index}", successor_id=f"task-{index + offset}",
            project_id="large", active=True,
        )
        for offset in (1, 2)
        for index in range(10_000 - offset)
    ]

    started = perf_counter()
    result = build_focus(actor_id="mina", projects=[project], tasks=tasks, dependencies=dependencies, today=date(2026, 9, 7), project_id="large")
    elapsed = perf_counter() - started

    assert result["total"] == 10_000
    assert result["items"][0]["entity_id"] == "task-0"
    assert "Unblock/waiting: predecessor is incomplete" in result["all_priorities"][1]["reason_tags"]
    # The pre-fix implementation performed a full dependency scan for every
    # task. Keep this generous enough for CI variance while catching a return
    # to the O(tasks * dependencies) path.
    assert elapsed < 5, f"large Focus projection regressed to an unbounded dependency scan: {elapsed:.3f}s"


@pytest.mark.asyncio
async def test_focus_preferences_and_same_engine_project_scope(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    project_id, project = await _create_project(client, tenant_id, "Focus source project")
    created = await _command_call(client, tenant_id, project_id, "task.create", {"project_revision": 1, "graph_revision": 1}, {"title": "Focus me", "owner_id": "admin_root", "priority": "Critical", "end_date": "2026-09-07"})
    assert created.status_code == 200, created.text
    task_id = created.json()["changed_entities"][0]["id"]
    focus = await client.get("/api/v2/focus", params={"project_id": project_id, "as_of": "2026-09-07"}, headers=_headers(tenant_id))
    assert focus.status_code == 200, focus.text
    assert focus.json()["engine_version"] == "pv-focus-1"
    assert focus.json()["items"][0]["entity_id"] == task_id
    command_id = str(uuid4())
    pinned = await client.post("/api/v2/focus/commands", headers=_headers(tenant_id, command_id=command_id), json=_command(command_id, "focus.pin", payload={"project_id": project_id, "entity_kind": "task", "entity_id": task_id}))
    assert pinned.status_code == 200, pinned.text
    project_focus = await client.get("/api/v2/focus", params={"project_id": project_id, "as_of": "2026-09-07"}, headers=_headers(tenant_id))
    my_day = await client.get("/api/v2/projects/my-day", headers=_headers(tenant_id))
    assert project_focus.json()["items"][0]["pinned"] is True
    assert my_day.json()["items"][0]["entity_id"] == task_id


@pytest.mark.asyncio
async def test_done_blocked_and_bulk_are_server_enforced_and_atomic(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    project_id, _ = await _create_project(client, tenant_id, "Transition project")
    created = await _command_call(client, tenant_id, project_id, "task.create", {"project_revision": 1, "graph_revision": 1}, {"title": "Acceptance task", "owner_id": "admin_root"})
    task_id = created.json()["changed_entities"][0]["id"]
    rejected = await _command_call(client, tenant_id, project_id, "task.transition", {"project_revision": 2, "graph_revision": 2, "task_revision": 1}, {"task_id": task_id, "to_status": "Done"})
    assert rejected.status_code == 422
    assert rejected.json()["code"] == "COMPLETION_CRITERIA_REQUIRED"
    criterion = await _command_call(client, tenant_id, project_id, "criterion.create", {"project_revision": 2}, {"parent_kind": "Task", "parent_id": task_id, "description": "Evidence reviewed", "mandatory": True})
    assert criterion.status_code == 200, criterion.text
    criterion_id = criterion.json()["changed_entities"][0]["id"]
    reviewed = await _command_call(client, tenant_id, project_id, "criterion.review", {"project_revision": 3}, {"criterion_id": criterion_id, "to_state": "Passed", "evidence_ids": ["evidence-1"]})
    assert reviewed.status_code == 200, reviewed.text
    done = await _command_call(client, tenant_id, project_id, "task.transition", {"project_revision": 4, "graph_revision": 2, "task_revision": 1}, {"task_id": task_id, "to_status": "Done"})
    assert done.status_code == 200, done.text
    blocked = await _command_call(client, tenant_id, project_id, "task.create", {"project_revision": 5, "graph_revision": 3}, {"title": "Blockable", "owner_id": "admin_root"})
    blocked_id = blocked.json()["changed_entities"][0]["id"]
    missing_blocker = await _command_call(client, tenant_id, project_id, "task.transition", {"project_revision": 6, "graph_revision": 4, "task_revision": 1}, {"task_id": blocked_id, "to_status": "Blocked"})
    assert missing_blocker.status_code == 422
    blocked_ok = await _command_call(client, tenant_id, project_id, "task.transition", {"project_revision": 6, "graph_revision": 4, "task_revision": 1}, {"task_id": blocked_id, "to_status": "Blocked", "blocker_reason": "Waiting for access", "resolver_id": "admin_root"})
    assert blocked_ok.status_code == 200, blocked_ok.text
    task2 = await _command_call(client, tenant_id, project_id, "task.create", {"project_revision": 7, "graph_revision": 5}, {"title": "Bulk target", "owner_id": "admin_root"})
    task2_id = task2.json()["changed_entities"][0]["id"]
    invalid_bulk = await _command_call(client, tenant_id, project_id, "task.bulk", {"project_revision": 8, "graph_revision": 6, "task_revisions": {blocked_id: 2, task2_id: 1}}, {"task_ids": [blocked_id, task2_id], "operation": "status", "value": "Not a status"})
    assert invalid_bulk.status_code == 422
    work = await client.get(f"/api/v2/projects/{project_id}/work", headers=_headers(tenant_id))
    assert work.status_code == 200, work.text
    assert {item["status"] for item in work.json()["items"] if item["id"] in {blocked_id, task2_id}} == {"Blocked", "To Do"}


@pytest.mark.asyncio
async def test_import_preview_and_plan_have_one_graph_and_typed_records(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    project_id, _ = await _create_project(client, tenant_id, "Plan project")
    preview = await client.post(f"/api/v2/projects/{project_id}/tasks/import/preview", headers=_headers(tenant_id), json={"text": "title,status\nOne,To Do\nTwo,Nope", "format": "csv"})
    assert preview.status_code == 200
    assert preview.json()["valid"] is False
    assert preview.json()["errors"]
    valid_preview = await client.post(f"/api/v2/projects/{project_id}/tasks/import/preview", headers=_headers(tenant_id), json={"text": "key,title,status\nroot,Imported,To Do", "format": "csv"})
    assert valid_preview.json()["valid"] is True
    import_id = str(uuid4())
    imported = await client.post(f"/api/v2/projects/{project_id}/tasks/import", headers=_headers(tenant_id, command_id=import_id), json={"text": "key,title,status\nroot,Imported,To Do", "format": "csv", "expected": {"graph_revision": 1}})
    assert imported.status_code == 200, imported.text
    plan = await client.get(f"/api/v2/projects/{project_id}/plan", headers=_headers(tenant_id))
    assert plan.status_code == 200, plan.text
    assert plan.json()["sections"] == ["Brief", "Milestones", "Architecture", "Risks & decisions", "Resources"]
    risk = await _command_call(client, tenant_id, project_id, "risk.save", {"project_revision": 2}, {"kind": "Risk", "title": "Review risk", "fields": {"probability": 2, "impact": 4}})
    assert risk.status_code == 200, risk.text
    resource = await _command_call(client, tenant_id, project_id, "resource.save", {"project_revision": 3}, {"title": "Runbook", "resource_kind": "Runbook", "content": "# Safe steps"})
    assert resource.status_code == 200, resource.text
    plan_again = await client.get(f"/api/v2/projects/{project_id}/plan", headers=_headers(tenant_id))
    assert len(plan_again.json()["work_breakdown"]) == 1
    assert plan_again.json()["governance"][0]["type"] == "Risk"
    assert plan_again.json()["resources"][0]["title"] == "Runbook"


@pytest.mark.asyncio
async def test_undo_redo_is_revision_checked_and_does_not_overwrite_newer_edit(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    project_id, _ = await _create_project(client, tenant_id, "Undo project")
    created = await _command_call(client, tenant_id, project_id, "task.create", {"project_revision": 1, "graph_revision": 1}, {"title": "Revision-safe task"})
    task_id = created.json()["changed_entities"][0]["id"]
    original_id = str(uuid4())
    edited = await client.post(f"/api/v2/projects/{project_id}/commands", headers=_headers(tenant_id, command_id=original_id), json=_command(original_id, "task.update_fields", expected={"project_revision": 2, "graph_revision": 2, "task_revision": 1}, payload={"task_id": task_id, "progress": 40}))
    assert edited.status_code == 200, edited.text
    undone_id = str(uuid4())
    undone = await client.post(f"/api/v2/projects/{project_id}/commands", headers=_headers(tenant_id, command_id=undone_id), json=_command(undone_id, "task.undo", expected={"project_revision": 3, "graph_revision": 3}, payload={"original_command_id": original_id}))
    assert undone.status_code == 200, undone.text
    work = await client.get(f"/api/v2/projects/{project_id}/work", headers=_headers(tenant_id))
    assert next(item for item in work.json()["items"] if item["id"] == task_id)["progress"] == 0
    redone_id = str(uuid4())
    redone = await client.post(f"/api/v2/projects/{project_id}/commands", headers=_headers(tenant_id, command_id=redone_id), json=_command(redone_id, "task.redo", expected={"project_revision": 4, "graph_revision": 4}, payload={"original_command_id": original_id}))
    assert redone.status_code == 200, redone.text
    changed = await client.get(f"/api/v2/projects/{project_id}/work", headers=_headers(tenant_id))
    assert next(item for item in changed.json()["items"] if item["id"] == task_id)["progress"] == 40


@pytest.mark.asyncio
async def test_two_users_get_owner_scoped_writes_and_named_decision_authorization(client, seeded_admin_tenant, setup_db, provision_module_operator):
    tenant_id = seeded_admin_tenant["tenant_id"]
    async with setup_db[1]() as config_session:
        config_session.add(UserTenantAccess(user_id="contributor", tenant_id=tenant_id, role="EDITOR", is_selected=False))
        await config_session.commit()
    await provision_module_operator(tenant_id, 'contributor', 'projects', preview=True)

    project_id, _ = await _create_project(client, tenant_id, "Two-user work plan")
    access = await _command_call(
        client,
        tenant_id,
        project_id,
        "project.set_access",
        {"project_revision": 1},
        {"members": [{"user_id": "admin_root", "role": "Owner"}, {"user_id": "contributor", "role": "Contributor"}], "visibility": "Team"},
    )
    assert access.status_code == 200, access.text

    admin_task = await _command_call(client, tenant_id, project_id, "task.create", {"project_revision": 2, "graph_revision": 1}, {"title": "Admin task", "owner_id": "admin_root"})
    assert admin_task.status_code == 200, admin_task.text
    admin_task_id = admin_task.json()["changed_entities"][0]["id"]
    forbidden = await _command_call(
        client,
        tenant_id,
        project_id,
        "task.update_fields",
        {"project_revision": 3, "graph_revision": 2, "task_revision": 1},
        {"task_id": admin_task_id, "progress": 20},
        user_id="contributor",
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["code"] == "FORBIDDEN"

    contributor_task = await _command_call(client, tenant_id, project_id, "task.create", {"project_revision": 3, "graph_revision": 2}, {"title": "Contributor task", "owner_id": "contributor"})
    assert contributor_task.status_code == 200, contributor_task.text
    contributor_task_id = contributor_task.json()["changed_entities"][0]["id"]
    own_update = await _command_call(
        client,
        tenant_id,
        project_id,
        "task.update_fields",
        {"project_revision": 4, "graph_revision": 3, "task_revision": 1},
        {"task_id": contributor_task_id, "progress": 20},
        user_id="contributor",
    )
    assert own_update.status_code == 200, own_update.text
    stale = await _command_call(
        client,
        tenant_id,
        project_id,
        "task.update_fields",
        {"project_revision": 4, "graph_revision": 3, "task_revision": 1},
        {"task_id": contributor_task_id, "progress": 40},
        user_id="contributor",
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "REVISION_CONFLICT"

    decision = await _command_call(
        client,
        tenant_id,
        project_id,
        "decision.request",
        {"project_revision": 5},
        {"title": "Named approval", "approver_ids": ["admin_root"]},
        user_id="contributor",
    )
    assert decision.status_code == 200, decision.text
    decision_id = decision.json()["changed_entities"][0]["id"]
    contributor_decision = await _command_call(
        client,
        tenant_id,
        project_id,
        "decision.decide",
        {"project_revision": 6},
        {"decision_id": decision_id, "outcome": "Approved"},
        user_id="contributor",
    )
    assert contributor_decision.status_code == 403
    admin_decision = await _command_call(client, tenant_id, project_id, "decision.decide", {"project_revision": 6}, {"decision_id": decision_id, "outcome": "Approved"})
    assert admin_decision.status_code == 200, admin_decision.text
