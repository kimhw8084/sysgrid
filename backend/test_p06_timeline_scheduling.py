import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.database import get_tenant_engine
from app.models.config import Tenant, UserTenantAccess
from app.pv1 import domain, models


def _headers(tenant_id: int, user_id: str = "admin_root", command_id: str | None = None) -> dict[str, str]:
    headers = {"X-User-Id": user_id, "X-Tenant-Id": str(tenant_id)}
    if command_id:
        headers["Idempotency-Key"] = command_id
    return headers


def _body(command_id: str, command_type: str, expected: dict, payload: dict) -> dict:
    return {"command_id": command_id, "type": command_type, "expected": expected, "payload": payload}


async def _create_project(client, tenant_id: int, name: str = "P06 schedule") -> tuple[str, dict[str, int]]:
    command_id = str(uuid4())
    response = await client.post("/api/v2/projects", headers=_headers(tenant_id, command_id=command_id), json={"name": name, "timezone": "America/Chicago"})
    assert response.status_code == 200, response.text
    project = response.json()["project"]
    assert project["calendar_revision"] == 1
    return project["id"], {"project_revision": 1, "graph_revision": 1, "calendar_revision": 1}


async def _command(client, tenant_id: int, project_id: str, command_type: str, revisions: dict[str, int], payload: dict, *, user_id: str = "admin_root", command_id: str | None = None):
    command_id = command_id or str(uuid4())
    response = await client.post(
        f"/api/v2/projects/{project_id}/commands",
        headers=_headers(tenant_id, user_id, command_id),
        json=_body(command_id, command_type, revisions, payload),
    )
    if response.status_code == 200:
        revisions.update({key: value for key, value in response.json().get("revisions", {}).items() if key in revisions})
    return response


async def _journey(client, tenant_id: int):
    project_id, revisions = await _create_project(client, tenant_id)
    task_specs = [
        ("A", {"title": "A", "start_date": "2026-10-05", "end_date": "2026-10-07", "duration_workdays": 3}),
        ("B", {"title": "B", "start_date": "2026-10-08", "end_date": "2026-10-09", "duration_workdays": 2}),
        ("C", {"title": "C", "start_date": "2026-10-06", "end_date": "2026-10-07", "duration_workdays": 2}),
        ("D", {"title": "D", "start_date": "2026-10-12", "end_date": "2026-10-12", "duration_workdays": 1}),
        ("delivery", {"title": "Delivery", "kind": "Milestone", "point_date": "2026-10-12", "milestone_anchor": "finish"}),
    ]
    ids: dict[str, str] = {}
    for key, payload in task_specs:
        response = await _command(client, tenant_id, project_id, "task.create", revisions, payload)
        assert response.status_code == 200, response.text
        ids[key] = response.json()["changed_entities"][0]["id"]
    edge_specs = [
        ("A", "B", "FS", 0),
        ("A", "C", "SS", 1),
        ("B", "D", "FS", 0),
        ("C", "D", "FS", 0),
        ("D", "delivery", "FS", 0),
    ]
    for predecessor, successor, dependency_type, lag_days in edge_specs:
        response = await _command(client, tenant_id, project_id, "dependency.create", revisions, {"predecessor_id": ids[predecessor], "successor_id": ids[successor], "dependency_type": dependency_type, "lag_days": lag_days})
        assert response.status_code == 200, response.text
    return project_id, revisions, ids


async def _tenant_session(setup_db, tenant_id: int) -> AsyncSession:
    async with setup_db[1]() as config_session:
        tenant = await config_session.get(Tenant, tenant_id)
        assert tenant is not None
        engine = get_tenant_engine(tenant.db_url)
    return async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)()


@pytest.mark.asyncio
async def test_journey_3_preview_is_zero_write_apply_is_atomic_idempotent_and_undoable(client, seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant["tenant_id"]
    project_id, revisions, ids = await _journey(client, tenant_id)

    schedule_response = await client.get(f"/api/v2/projects/{project_id}/schedule", headers=_headers(tenant_id), params={"as_of": "2026-10-05"})
    assert schedule_response.status_code == 200, schedule_response.text
    current = schedule_response.json()
    analysis = {row["task_id"]: row for row in current["analysis"]["rows"]}
    assert current["analysis"]["critical_task_ids"] == [ids[key] for key in ("A", "B", "D", "delivery")]
    assert analysis[ids["C"]]["slack_workdays"] == 2

    session = await _tenant_session(setup_db, tenant_id)
    try:
        before_events = await session.scalar(select(func.count()).select_from(models.PV1Event).where(models.PV1Event.project_id == project_id))
        before_idempotency = await session.scalar(select(func.count()).select_from(models.PV1IdempotencyKey))
        before_tasks = list((await session.execute(select(models.PV1Task.id, models.PV1Task.start_date, models.PV1Task.end_date, models.PV1Task.point_date, models.PV1Task.revision).where(models.PV1Task.project_id == project_id).order_by(models.PV1Task.id))).all())
    finally:
        await session.close()

    preview_response = await client.post(
        f"/api/v2/projects/{project_id}/schedule/preview",
        headers=_headers(tenant_id),
        json={"operation": "move", "selection_ids": [ids["B"]], "parameters": {"delta_workdays": 2}, "graph_revision": revisions["graph_revision"], "calendar_revision": 1},
    )
    assert preview_response.status_code == 200, preview_response.text
    preview = preview_response.json()
    changes = {item["task_id"]: item["after"] for item in preview["changes"]}
    assert changes[ids["B"]]["start_date"] == "2026-10-12"
    assert changes[ids["B"]]["end_date"] == "2026-10-13"
    assert ids["C"] not in changes
    assert changes[ids["D"]]["start_date"] == "2026-10-14"
    assert changes[ids["delivery"]]["point_date"] == "2026-10-14"

    session = await _tenant_session(setup_db, tenant_id)
    try:
        assert await session.scalar(select(func.count()).select_from(models.PV1Event).where(models.PV1Event.project_id == project_id)) == before_events
        assert await session.scalar(select(func.count()).select_from(models.PV1IdempotencyKey)) == before_idempotency
        after_preview_tasks = list((await session.execute(select(models.PV1Task.id, models.PV1Task.start_date, models.PV1Task.end_date, models.PV1Task.point_date, models.PV1Task.revision).where(models.PV1Task.project_id == project_id).order_by(models.PV1Task.id))).all())
        assert after_preview_tasks == before_tasks
    finally:
        await session.close()

    apply_id = str(uuid4())
    apply_payload = {"preview_id": preview["preview_id"], "preview_hash": preview["content_hash"]}
    expected = dict(revisions)
    applied = await _command(client, tenant_id, project_id, "schedule.apply", revisions, apply_payload, command_id=apply_id)
    assert applied.status_code == 200, applied.text
    assert len(applied.json()["changed_entities"]) == 3
    replay = await client.post(f"/api/v2/projects/{project_id}/commands", headers=_headers(tenant_id, command_id=apply_id), json=_body(apply_id, "schedule.apply", expected, apply_payload))
    assert replay.status_code == 200
    assert replay.json() == applied.json()

    altered = await client.post(f"/api/v2/projects/{project_id}/commands", headers=_headers(tenant_id, command_id=apply_id), json=_body(apply_id, "schedule.apply", expected, {**apply_payload, "preview_hash": "0" * 64}))
    assert altered.status_code == 409
    assert altered.json()["code"] == "IDEMPOTENCY_CONFLICT"

    refreshed = await client.get(f"/api/v2/projects/{project_id}/schedule", headers=_headers(tenant_id))
    by_id = {item["id"]: item for item in refreshed.json()["tasks"]}
    assert by_id[ids["B"]]["start_date"] == "2026-10-12"
    assert by_id[ids["D"]]["start_date"] == "2026-10-14"
    assert by_id[ids["delivery"]]["point_date"] == "2026-10-14"
    assert [item["event_type"] for item in refreshed.json()["history"]].count("schedule.apply") == 1

    undo = await _command(client, tenant_id, project_id, "task.undo", revisions, {"original_command_id": apply_id})
    assert undo.status_code == 200, undo.text
    restored = await client.get(f"/api/v2/projects/{project_id}/schedule", headers=_headers(tenant_id))
    restored_by_id = {item["id"]: item for item in restored.json()["tasks"]}
    assert restored_by_id[ids["B"]]["start_date"] == "2026-10-08"
    assert restored_by_id[ids["D"]]["start_date"] == "2026-10-12"
    assert restored_by_id[ids["delivery"]]["point_date"] == "2026-10-12"


@pytest.mark.asyncio
async def test_stale_preview_and_competing_graph_revision_reject_before_mutation(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    project_id, revisions = await _create_project(client, tenant_id, "Stale preview")
    created = await _command(client, tenant_id, project_id, "task.create", revisions, {"title": "Move", "start_date": "2026-10-05", "end_date": "2026-10-05"})
    task_id = created.json()["changed_entities"][0]["id"]
    preview_response = await client.post(f"/api/v2/projects/{project_id}/schedule/preview", headers=_headers(tenant_id), json={"operation": "move", "selection_ids": [task_id], "parameters": {"delta_workdays": 1}, "graph_revision": revisions["graph_revision"], "calendar_revision": 1})
    preview = preview_response.json()
    stale_expected = dict(revisions)
    competitor = await _command(client, tenant_id, project_id, "task.create", revisions, {"title": "Concurrent"})
    assert competitor.status_code == 200
    apply_id = str(uuid4())
    rejected = await client.post(f"/api/v2/projects/{project_id}/commands", headers=_headers(tenant_id, command_id=apply_id), json=_body(apply_id, "schedule.apply", {**stale_expected, "project_revision": revisions["project_revision"]}, {"preview_id": preview["preview_id"], "preview_hash": preview["content_hash"]}))
    assert rejected.status_code == 409
    assert rejected.json()["code"] == "REVISION_CONFLICT"
    current = await client.get(f"/api/v2/projects/{project_id}/schedule", headers=_headers(tenant_id))
    task = next(item for item in current.json()["tasks"] if item["id"] == task_id)
    assert task["start_date"] == "2026-10-05"
    assert not any(item["event_type"] == "schedule.apply" for item in current.json()["history"])


@pytest.mark.asyncio
async def test_dependency_validation_retention_baselines_and_schedule_permissions(client, seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant["tenant_id"]
    project_id, revisions = await _create_project(client, tenant_id, "Dependencies")
    ids = {}
    for key in ("A", "B", "C"):
        response = await _command(client, tenant_id, project_id, "task.create", revisions, {"title": key, "start_date": "2026-10-05", "end_date": "2026-10-05"})
        ids[key] = response.json()["changed_entities"][0]["id"]
    first = await _command(client, tenant_id, project_id, "dependency.create", revisions, {"predecessor_id": ids["A"], "successor_id": ids["B"], "dependency_type": "FS", "lag_days": 0})
    first_id = first.json()["changed_entities"][0]["id"]
    distinct = await _command(client, tenant_id, project_id, "dependency.create", revisions, {"predecessor_id": ids["A"], "successor_id": ids["B"], "dependency_type": "SS", "lag_days": -1})
    assert distinct.status_code == 200
    duplicate = await _command(client, tenant_id, project_id, "dependency.create", revisions, {"predecessor_id": ids["A"], "successor_id": ids["B"], "dependency_type": "FS", "lag_days": 1})
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "DUPLICATE_DEPENDENCY"
    bc = await _command(client, tenant_id, project_id, "dependency.create", revisions, {"predecessor_id": ids["B"], "successor_id": ids["C"], "dependency_type": "FS", "lag_days": 0})
    assert bc.status_code == 200
    cycle = await _command(client, tenant_id, project_id, "dependency.create", revisions, {"predecessor_id": ids["C"], "successor_id": ids["A"], "dependency_type": "FS", "lag_days": 0})
    assert cycle.status_code == 409
    assert cycle.json()["code"] == "DEPENDENCY_CYCLE"
    reported_cycle = cycle.json()["details"]["cycle_path"]
    assert reported_cycle[0] == reported_cycle[-1]
    assert set(reported_cycle[:-1]) == {ids["A"], ids["B"], ids["C"]}

    remove_expected = {**revisions, "dependency_revision": 1}
    removed = await _command(client, tenant_id, project_id, "dependency.remove", remove_expected, {"dependency_id": first_id}, command_id=str(uuid4()))
    assert removed.status_code == 200, removed.text
    revisions.update({key: value for key, value in removed.json()["revisions"].items() if key in revisions})
    schedule_response = await client.get(f"/api/v2/projects/{project_id}/schedule", headers=_headers(tenant_id))
    removed_record = next(item for item in schedule_response.json()["dependencies"] if item["id"] == first_id)
    assert removed_record["active"] is False

    captured = await _command(client, tenant_id, project_id, "baseline.capture", revisions, {"label": "Approved plan", "rationale": "Ready review"})
    assert captured.status_code == 200, captured.text
    baseline_id = captured.json()["changed_entities"][0]["id"]
    after_baseline = await client.get(f"/api/v2/projects/{project_id}/schedule", headers=_headers(tenant_id))
    baseline = next(item for item in after_baseline.json()["baselines"] if item["id"] == baseline_id)
    assert baseline["is_default"] is True
    assert baseline["snapshot"]["calendar"]["working_weekdays"] == [0, 1, 2, 3, 4]
    assert len(baseline["snapshot"]["tasks"]) == 3

    async with setup_db[1]() as config_session:
        config_session.add(UserTenantAccess(user_id="viewer", tenant_id=tenant_id, role="VIEWER", is_selected=False))
        await config_session.commit()
    access = await _command(client, tenant_id, project_id, "project.set_access", revisions, {"members": [{"user_id": "admin_root", "role": "Owner"}, {"user_id": "viewer", "role": "Stakeholder"}]})
    assert access.status_code == 200, access.text
    forbidden_preview = await client.post(f"/api/v2/projects/{project_id}/schedule/preview", headers=_headers(tenant_id, "viewer"), json={"operation": "move", "selection_ids": [ids["A"]], "parameters": {"delta_workdays": 1}, "graph_revision": revisions["graph_revision"], "calendar_revision": revisions["calendar_revision"]})
    assert forbidden_preview.status_code in {403, 404}


@pytest.mark.asyncio
async def test_calendar_change_requires_explicit_normalization_and_baseline_variance_is_durable(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    project_id, revisions = await _create_project(client, tenant_id, "Calendar and variance")
    created = await _command(client, tenant_id, project_id, "task.create", revisions, {"title": "Friday task", "start_date": "2026-10-09", "end_date": "2026-10-09"})
    task_id = created.json()["changed_entities"][0]["id"]
    baseline = await _command(client, tenant_id, project_id, "baseline.capture", revisions, {"label": "Friday commitment", "rationale": "Approved before calendar change"})
    assert baseline.status_code == 200, baseline.text

    without_choice = await client.post(
        f"/api/v2/projects/{project_id}/schedule/preview",
        headers=_headers(tenant_id),
        json={"operation": "change_calendar", "selection_ids": [], "parameters": {"timezone": "America/Chicago", "working_weekdays": [0, 1, 2, 3], "exceptions": [], "normalization": {}}, "graph_revision": revisions["graph_revision"], "calendar_revision": revisions["calendar_revision"]},
    )
    assert without_choice.status_code == 422
    assert without_choice.json()["code"] == "NON_WORKING_DATE"

    with_choice = await client.post(
        f"/api/v2/projects/{project_id}/schedule/preview",
        headers=_headers(tenant_id),
        json={"operation": "change_calendar", "selection_ids": [], "parameters": {"timezone": "America/Chicago", "working_weekdays": [0, 1, 2, 3], "exceptions": [], "normalization": {task_id: {"start_date": "next", "end_date": "next"}}}, "graph_revision": revisions["graph_revision"], "calendar_revision": revisions["calendar_revision"]},
    )
    assert with_choice.status_code == 200, with_choice.text
    preview = with_choice.json()
    changed = next(item for item in preview["changes"] if item["task_id"] == task_id)
    assert changed["after"]["start_date"] == "2026-10-12"
    applied = await _command(client, tenant_id, project_id, "schedule.apply", revisions, {"preview_id": preview["preview_id"], "preview_hash": preview["content_hash"]})
    assert applied.status_code == 200, applied.text
    assert revisions["calendar_revision"] == 2
    schedule_state = (await client.get(f"/api/v2/projects/{project_id}/schedule", headers=_headers(tenant_id))).json()
    assert schedule_state["calendar"]["working_weekdays"] == [0, 1, 2, 3]
    variance = next(item for item in schedule_state["baseline_variance"] if item["task_id"] == task_id)
    assert variance["start_delta_workdays"] == 1
    assert variance["finish_delta_workdays"] == 1


@pytest.mark.asyncio
async def test_external_milestone_constraint_requires_confirmation_and_remote_revision_creates_attention(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    project_id, revisions = await _create_project(client, tenant_id, "External constraint")
    created = await _command(client, tenant_id, project_id, "task.create", revisions, {"title": "Local successor", "start_date": "2026-10-05", "end_date": "2026-10-05"})
    task_id = created.json()["changed_entities"][0]["id"]
    external = await _command(client, tenant_id, project_id, "external_dependency.create", revisions, {
        "local_task_id": task_id, "external_project_ref": "remote-project", "external_task_ref": "published-milestone",
        "external_milestone_revision": 7, "external_date": "2026-10-07", "external_anchor": "finish",
        "dependency_type": "FS", "lag_days": 0, "access_policy": "Visible", "confirmed": True,
    })
    assert external.status_code == 200, external.text
    external_id = external.json()["changed_entities"][0]["id"]
    state = (await client.get(f"/api/v2/projects/{project_id}/schedule", headers=_headers(tenant_id))).json()
    row = next(item for item in state["analysis"]["rows"] if item["task_id"] == task_id)
    assert row["earliest_start"] == "2026-10-08"
    assert state["external_warnings"] == []

    refreshed = await _command(client, tenant_id, project_id, "external_dependency.refresh", {**revisions, "external_dependency_revision": 1}, {"external_dependency_id": external_id, "observed_milestone_revision": 8, "observed_date": "2026-10-09"})
    assert refreshed.status_code == 200, refreshed.text
    revisions.update({key: value for key, value in refreshed.json()["revisions"].items() if key in revisions})
    attention = (await client.get(f"/api/v2/projects/{project_id}/schedule", headers=_headers(tenant_id))).json()
    assert attention["analysis"]["status"] == "Critical path incomplete"
    assert attention["external_warnings"][0]["code"] == "EXTERNAL_MILESTONE_CHANGED"
    assert attention["external_dependencies"][0]["confirmed"] is False

    confirmed = await _command(client, tenant_id, project_id, "external_dependency.confirm", {**revisions, "external_dependency_revision": 2}, {"external_dependency_id": external_id})
    assert confirmed.status_code == 200, confirmed.text
    revisions.update({key: value for key, value in confirmed.json()["revisions"].items() if key in revisions})
    final_state = (await client.get(f"/api/v2/projects/{project_id}/schedule", headers=_headers(tenant_id))).json()
    final_row = next(item for item in final_state["analysis"]["rows"] if item["task_id"] == task_id)
    assert final_row["earliest_start"] == "2026-10-12"
    assert final_state["external_dependencies"][0]["external_milestone_revision"] == 8

    hidden = await _command(client, tenant_id, project_id, "external_dependency.create", revisions, {
        "local_task_id": task_id, "external_project_ref": "restricted-project", "external_task_ref": "restricted-milestone",
        "external_milestone_revision": 1, "external_anchor": "finish", "dependency_type": "SS", "lag_days": 0,
        "access_policy": "Unavailable", "confirmed": False,
    })
    assert hidden.status_code == 200, hidden.text
    redacted = (await client.get(f"/api/v2/projects/{project_id}/schedule", headers=_headers(tenant_id))).json()
    hidden_record = next(item for item in redacted["external_dependencies"] if item["id"] == hidden.json()["changed_entities"][0]["id"])
    assert hidden_record["external_project_ref"] is None
    assert hidden_record["external_task_ref"] is None
    assert any(item["code"] == "EXTERNAL_DEPENDENCY_UNAVAILABLE" for item in redacted["external_warnings"])


@pytest.mark.asyncio
async def test_two_competing_schedule_applies_allow_exactly_one_atomic_winner(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    project_id, revisions = await _create_project(client, tenant_id, "Competing apply")
    created = await _command(client, tenant_id, project_id, "task.create", revisions, {"title": "Race", "start_date": "2026-10-05", "end_date": "2026-10-05"})
    task_id = created.json()["changed_entities"][0]["id"]
    base = dict(revisions)

    async def preview(delta: int):
        response = await client.post(f"/api/v2/projects/{project_id}/schedule/preview", headers=_headers(tenant_id), json={"operation": "move", "selection_ids": [task_id], "parameters": {"delta_workdays": delta}, "graph_revision": base["graph_revision"], "calendar_revision": base["calendar_revision"]})
        assert response.status_code == 200, response.text
        return response.json()

    left, right = await asyncio.gather(preview(1), preview(2))

    async def apply(candidate: dict):
        command_id = str(uuid4())
        return await client.post(f"/api/v2/projects/{project_id}/commands", headers=_headers(tenant_id, command_id=command_id), json=_body(command_id, "schedule.apply", base, {"preview_id": candidate["preview_id"], "preview_hash": candidate["content_hash"]}))

    results = await asyncio.gather(apply(left), apply(right))
    assert sorted(response.status_code for response in results) == [200, 409]
    assert next(response for response in results if response.status_code == 409).json()["code"] == "REVISION_CONFLICT"
    state = (await client.get(f"/api/v2/projects/{project_id}/schedule", headers=_headers(tenant_id))).json()
    assert next(item for item in state["tasks"] if item["id"] == task_id)["start_date"] in {"2026-10-06", "2026-10-07"}
    assert [item["event_type"] for item in state["history"]].count("schedule.apply") == 1


def test_schedule_migration_preserves_existing_ids_dates_and_round_trips(tmp_path):
    backend_root = Path(__file__).resolve().parent
    database_path = tmp_path / "p06-migration-round-trip.db"
    config = AlembicConfig(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database_path}")
    alembic_command.upgrade(config, "b2c3d4e5f6a7")
    engine = create_engine(f"sqlite:///{database_path}")
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO pv1_projects (id, tenant_id, display_key, name, owner_id, start_date, target_date, created_by, updated_by) VALUES ('legacy-pv1', 7, 'PRJ-000007', 'Preserve schedule', 'owner', '2026-10-03', '2026-10-11', 'owner', 'owner')"))
        connection.execute(text("INSERT INTO pv1_tasks (id, tenant_id, project_id, title, start_date, end_date, created_by, updated_by) VALUES ('legacy-task', 7, 'legacy-pv1', 'Weekend dates', '2026-10-03', '2026-10-11', 'owner', 'owner')"))

    alembic_command.upgrade(config, "head")
    with engine.connect() as connection:
        project = connection.execute(text("SELECT id, start_date, target_date, calendar_id, calendar_revision FROM pv1_projects WHERE id='legacy-pv1'")).mappings().one()
        task = connection.execute(text("SELECT id, start_date, end_date, milestone_anchor, duration_workdays FROM pv1_tasks WHERE id='legacy-task'")).mappings().one()
        calendar = connection.execute(text("SELECT working_weekdays, revision FROM pv1_project_calendars WHERE project_id='legacy-pv1'")).mappings().one()
        assert dict(project) == {"id": "legacy-pv1", "start_date": "2026-10-03", "target_date": "2026-10-11", "calendar_id": "calendar-legacy-pv1", "calendar_revision": 1}
        assert dict(task) == {"id": "legacy-task", "start_date": "2026-10-03", "end_date": "2026-10-11", "milestone_anchor": "start", "duration_workdays": None}
        assert json.loads(calendar["working_weekdays"]) == [0, 1, 2, 3, 4, 5, 6]
        assert calendar["revision"] == 1

    alembic_command.downgrade(config, "b2c3d4e5f6a7")
    assert "duration_workdays" not in {column["name"] for column in inspect(engine).get_columns("pv1_tasks")}
    with engine.connect() as connection:
        assert connection.execute(text("SELECT id, start_date, end_date FROM pv1_tasks WHERE id='legacy-task'")).one() == ("legacy-task", "2026-10-03", "2026-10-11")
    alembic_command.upgrade(config, "head")
    with engine.connect() as connection:
        assert connection.execute(text("SELECT COUNT(*) FROM pv1_project_calendars WHERE project_id='legacy-pv1'")).scalar_one() == 1
        assert connection.execute(text("SELECT id, start_date, end_date FROM pv1_tasks WHERE id='legacy-task'")).one() == ("legacy-task", "2026-10-03", "2026-10-11")
    engine.dispose()


@pytest.mark.asyncio
async def test_preview_signature_hash_actor_and_expiry_bindings_reject_before_mutation(client, seeded_admin_tenant, setup_db, monkeypatch, provision_module_operator):
    tenant_id = seeded_admin_tenant["tenant_id"]
    project_id, revisions = await _create_project(client, tenant_id, "Preview identity")
    created = await _command(client, tenant_id, project_id, "task.create", revisions, {"title": "Bound preview", "start_date": "2026-10-05", "end_date": "2026-10-05"})
    task_id = created.json()["changed_entities"][0]["id"]
    async with setup_db[1]() as config_session:
        config_session.add(UserTenantAccess(user_id="other-scheduler", tenant_id=tenant_id, role="ADMIN", is_selected=False))
        await config_session.commit()
    await provision_module_operator(tenant_id, 'other-scheduler', 'projects', preview=True)
    access = await _command(client, tenant_id, project_id, "project.set_access", revisions, {"members": [{"user_id": "admin_root", "role": "Owner"}, {"user_id": "other-scheduler", "role": "Lead"}]})
    assert access.status_code == 200, access.text

    async def make_preview():
        response = await client.post(f"/api/v2/projects/{project_id}/schedule/preview", headers=_headers(tenant_id), json={"operation": "move", "selection_ids": [task_id], "parameters": {"delta_workdays": 1}, "graph_revision": revisions["graph_revision"], "calendar_revision": revisions["calendar_revision"]})
        assert response.status_code == 200, response.text
        return response.json()

    preview = await make_preview()
    tampered_id = preview["preview_id"][:-1] + ("0" if preview["preview_id"][-1] != "0" else "1")
    tampered = await _command(client, tenant_id, project_id, "schedule.apply", revisions, {"preview_id": tampered_id, "preview_hash": preview["content_hash"]})
    assert tampered.status_code == 409
    assert tampered.json()["code"] == "PREVIEW_INVALID"

    preview = await make_preview()
    hash_mismatch = await _command(client, tenant_id, project_id, "schedule.apply", revisions, {"preview_id": preview["preview_id"], "preview_hash": "0" * 64})
    assert hash_mismatch.status_code == 409
    assert hash_mismatch.json()["code"] == "PREVIEW_HASH_MISMATCH"

    preview = await make_preview()
    actor_mismatch = await _command(client, tenant_id, project_id, "schedule.apply", revisions, {"preview_id": preview["preview_id"], "preview_hash": preview["content_hash"]}, user_id="other-scheduler")
    assert actor_mismatch.status_code == 409
    assert actor_mismatch.json()["code"] == "PREVIEW_INVALID"

    preview = await make_preview()
    frozen = datetime.now(timezone.utc) + timedelta(minutes=6)
    monkeypatch.setattr(domain, "_now", lambda: frozen)
    expired = await _command(client, tenant_id, project_id, "schedule.apply", revisions, {"preview_id": preview["preview_id"], "preview_hash": preview["content_hash"]})
    assert expired.status_code == 409
    assert expired.json()["code"] == "PREVIEW_EXPIRED"
    state = (await client.get(f"/api/v2/projects/{project_id}/schedule", headers=_headers(tenant_id))).json()
    assert next(item for item in state["tasks"] if item["id"] == task_id)["start_date"] == "2026-10-05"
    assert not any(item["event_type"] == "schedule.apply" for item in state["history"])
