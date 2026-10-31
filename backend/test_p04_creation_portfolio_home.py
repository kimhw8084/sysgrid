from datetime import date, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.database import get_tenant_engine
from app.models import models as legacy_models
from app.models.config import Tenant
from app.pv1 import domain, models as pv1_models


def headers(tenant_id: int, command_id: str | None = None, user_id: str = "admin_root") -> dict[str, str]:
    result = {"X-User-Id": user_id, "X-Tenant-Id": str(tenant_id)}
    if command_id:
        result["Idempotency-Key"] = command_id
    return result


def command(command_id: str, command_type: str, revision: int, payload: dict) -> dict:
    return {"command_id": command_id, "type": command_type, "expected": {"project_revision": revision}, "payload": payload}


async def tenant_session(setup_db, tenant_id: int) -> AsyncSession:
    async with setup_db[1]() as config_session:
        tenant = await config_session.get(Tenant, tenant_id)
        assert tenant is not None
        engine = get_tenant_engine(tenant.db_url)
    return async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)()


@pytest.mark.asyncio
async def test_server_draft_resumes_idempotently_and_materializes_accepted_template_data(client, seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant["tenant_id"]
    session = await tenant_session(setup_db, tenant_id)
    try:
        team = legacy_models.Team(name="Automation Engineering", is_archived=False, source="test", metadata_json={"timezone": "America/Chicago", "calendar_id": "eng-standard", "calendar_revision": 4})
        session.add(team)
        await session.commit()
        team_id = team.id
    finally:
        await session.close()

    create_id = str(uuid4())
    payload = {
        "name": "Qualification Analysis Automation",
        "objective": "Reduce manual review time while preserving qualification evidence.",
        "team_id": team_id,
        "owner_id": "admin_root",
        "template_key": "automation",
        "template_version": "1.0.0",
        "phase": "Draft",
    }
    created = await client.post("/api/v2/projects", headers=headers(tenant_id, create_id), json=payload)
    replayed = await client.post("/api/v2/projects", headers=headers(tenant_id, create_id), json=payload)
    assert created.status_code == 200, created.text
    assert replayed.status_code == 200, replayed.text
    project = created.json()["project"]
    assert replayed.json()["project"]["id"] == project["id"]
    assert (project["timezone"], project["calendar_id"], project["calendar_revision"]) == ("America/Chicago", "eng-standard", 4)

    target_date = (date.today() + timedelta(days=90)).isoformat()
    save_id = str(uuid4())
    saved = await client.post(
        f"/api/v2/projects/{project['id']}/commands",
        headers=headers(tenant_id, save_id),
        json=command(save_id, "project.save_creation_draft", 1, {
            "details": {
                "problem": "Manual review delays qualification decisions.",
                "in_scope": "Qualification evidence review",
                "out_of_scope": "Source-system replacement",
                "target_date": target_date,
                "architecture_assessment": "Yes",
                "template_key": "automation",
                "template_version": "1.0.0",
            },
            "creation_draft": {
                "draft_step": 3,
                "acceptance_criteria": ["Review evidence remains traceable"],
                "metric": {"name": "Eligible workflows adopted", "kind": "Adoption", "unit": "workflows", "direction": "Increase", "measurement_method": "Count eligible workflows using the approved automation", "steward_id": "admin_root", "target_spec": None},
                "milestones": [{"title": "Baseline measured", "owner_id": "admin_root", "point_date": None}, {"title": "Pilot", "owner_id": "admin_root", "point_date": None}],
                "collaborators": [],
                "dependencies": ["Validation dataset approval"],
                "suggestions_accepted": True,
            },
        }),
    )
    assert saved.status_code == 200, saved.text
    resumed = await client.get(f"/api/v2/projects/{project['id']}", headers=headers(tenant_id))
    assert resumed.status_code == 200, resumed.text
    resumed_project = resumed.json()
    assert resumed_project["creation_draft"]["draft_step"] == 3
    assert resumed_project["creation_draft"]["milestones"][1]["title"] == "Pilot"
    assert resumed_project["target_date"] == target_date
    assert (resumed_project["template_key"], resumed_project["template_version"]) == ("automation", "1.0.0")

    readiness = await client.get(f"/api/v2/projects/{project['id']}/readiness?to_phase=Proposed", headers=headers(tenant_id))
    assert readiness.status_code == 200, readiness.text
    assert readiness.json()["ready"] is True

    promote_id = str(uuid4())
    promoted = await client.post(f"/api/v2/projects/{project['id']}/commands", headers=headers(tenant_id, promote_id), json=command(promote_id, "project.transition", 2, {"to_phase": "Proposed"}))
    assert promoted.status_code == 200, promoted.text
    assert promoted.json()["revisions"] == {"project_revision": 3, "graph_revision": 2}
    promoted_project = await client.get(f"/api/v2/projects/{project['id']}", headers=headers(tenant_id))
    assert promoted_project.json()["story"]["health"] == {"level": "Unknown", "reason": "Delivery work is not planned yet."}
    assert promoted_project.json()["outcome_phase"] == "Planned"

    missing_reason_id = str(uuid4())
    missing_reason = await client.post(f"/api/v2/projects/{project['id']}/commands", headers=headers(tenant_id, missing_reason_id), json=command(missing_reason_id, "project.pause", 3, {}))
    assert missing_reason.status_code == 422
    assert missing_reason.json()["field_errors"] == [{"field": "reason", "message": "Enter why the project is paused."}]

    session = await tenant_session(setup_db, tenant_id)
    try:
        project_count = await session.scalar(select(func.count()).select_from(pv1_models.PV1Project).where(pv1_models.PV1Project.id == project["id"]))
        criterion_count = await session.scalar(select(func.count()).select_from(pv1_models.PV1TaskCriterion).where(pv1_models.PV1TaskCriterion.project_id == project["id"]))
        milestone_count = await session.scalar(select(func.count()).select_from(pv1_models.PV1Task).where(pv1_models.PV1Task.project_id == project["id"], pv1_models.PV1Task.kind == "Milestone"))
        metric_count = await session.scalar(select(func.count()).select_from(pv1_models.PV1Metric).where(pv1_models.PV1Metric.project_id == project["id"]))
        assert (project_count, criterion_count, milestone_count, metric_count) == (1, 1, 2, 1)
    finally:
        await session.close()

    duplicate_promote_id = str(uuid4())
    duplicate = await client.post(f"/api/v2/projects/{project['id']}/commands", headers=headers(tenant_id, duplicate_promote_id), json=command(duplicate_promote_id, "project.transition", 3, {"to_phase": "Proposed"}))
    assert duplicate.status_code == 422


@pytest.mark.asyncio
async def test_readiness_returns_structured_gaps_without_inventing_project_facts(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    create_id = str(uuid4())
    created = await client.post("/api/v2/projects", headers=headers(tenant_id, create_id), json={"name": "Truthful readiness Draft"})
    assert created.status_code == 200, created.text
    project = created.json()["project"]

    proposed = await client.get(f"/api/v2/projects/{project['id']}/readiness?to_phase=Proposed", headers=headers(tenant_id))
    assert proposed.status_code == 200
    assert proposed.json()["ready"] is False
    assert [gap["code"] for gap in proposed.json()["gaps"]] == ["MISSING_OBJECTIVE"]

    ready = await client.get(f"/api/v2/projects/{project['id']}/readiness?to_phase=Ready", headers=headers(tenant_id))
    codes = {gap["code"] for gap in ready.json()["gaps"]}
    assert {"MISSING_OBJECTIVE", "MISSING_IN_SCOPE", "MISSING_OUT_SCOPE", "MISSING_ACCEPTANCE", "MISSING_EXECUTABLE_WORK", "MISSING_TARGET", "MISSING_METRIC", "MISSING_ARCHITECTURE_ASSESSMENT"}.issubset(codes)
    refreshed = await client.get(f"/api/v2/projects/{project['id']}", headers=headers(tenant_id))
    assert refreshed.json()["target_date"] is None
    assert refreshed.json()["story"]["primary_metric"] is None

    transition_id = str(uuid4())
    blocked = await client.post(f"/api/v2/projects/{project['id']}/commands", headers=headers(tenant_id, transition_id), json=command(transition_id, "project.transition", 1, {"to_phase": "Proposed"}))
    assert blocked.status_code == 422
    assert blocked.json()["code"] == "READINESS_GAPS"
    assert blocked.json()["details"]["gaps"][0]["code"] == "MISSING_OBJECTIVE"


@pytest.mark.asyncio
async def test_only_durable_approved_records_satisfy_readiness_exceptions(seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant["tenant_id"]
    session = await tenant_session(setup_db, tenant_id)
    try:
        project = pv1_models.PV1Project(id="durable-exception", tenant_id=tenant_id, display_key="PRJ-EXCEPTION", name="Durable readiness exception", objective="Prove exceptions remain auditable.", in_scope="Readiness decisions", out_of_scope="Delivery execution", owner_id="admin_root", phase="Planning", run_state="Active", priority="Medium", no_deadline_reason="No external deadline; review monthly.", architecture_assessment="Yes", metadata_json={"outcome_not_applicable": True}, created_by="test", updated_by="test")
        session.add(project)
        session.add(pv1_models.PV1Task(id="durable-work", tenant_id=tenant_id, project_id=project.id, kind="Task", title="Verify durable exception", owner_id="admin_root", status="To Do", priority="Medium", progress=0, planning_weight=1, mandatory=True, order_key=1024, created_by="test", updated_by="test"))
        session.add(pv1_models.PV1TaskCriterion(id="durable-criterion", tenant_id=tenant_id, project_id=project.id, description="Decision remains visible and auditable", mandatory=True, state="Open", created_by="test", updated_by="test"))
        await session.flush()

        hidden_flag_gaps = await domain.project_readiness_gaps(session, project, "Ready")
        assert "MISSING_METRIC" in {gap["code"] for gap in hidden_flag_gaps}

        session.add(pv1_models.PV1GovernanceRecord(id="durable-outcome-na", tenant_id=tenant_id, project_id=project.id, record_type="Decision", title="Outcome not applicable", state="Approved", owner_id="admin_root", payload={"exception_type": "outcome_not_applicable", "rationale": "This migration-only project preserves data without changing a user outcome.", "approver_id": "admin_root"}, created_by="test", updated_by="test"))
        await session.flush()
        durable_gaps = await domain.project_readiness_gaps(session, project, "Ready")
        assert durable_gaps == []
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_story_projection_marks_project_target_miss_and_never_returns_past_next_measurement(seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant["tenant_id"]
    session = await tenant_session(setup_db, tenant_id)
    try:
        yesterday = date.today() - timedelta(days=1)
        project = pv1_models.PV1Project(id="overdue-story", tenant_id=tenant_id, display_key="PRJ-OVERDUE", name="Overdue story", objective="Surface truthful management attention.", owner_id="admin_root", phase="Executing", run_state="Active", priority="High", target_date=yesterday, architecture_assessment="Yes", outcome_phase="Measuring", created_by="test", updated_by="test")
        session.add(project)
        await session.flush()
        session.add(pv1_models.PV1Metric(id="overdue-metric", tenant_id=tenant_id, project_id=project.id, name="Verified adoption", kind="Adoption", unit="workflows", direction="Increase", target_date=yesterday, cadence_days=14, steward_id="admin_root", measurement_method="Count verified workflows.", required_for_success=True, created_by="test", updated_by="test"))
        await session.flush()
        story = await domain.project_story_projection(session, project)
        assert story["attention"][0]["kind"] == "Missed commitment"
        assert any(item["kind"] == "Overdue outcome checkpoint" for item in story["attention"])
        assert story["primary_metric"]["next_measurement_date"] is None
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_portfolio_rollups_are_exclusive_top_level_and_attention_is_overlapping(client, seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant["tenant_id"]
    session = await tenant_session(setup_db, tenant_id)
    try:
        team = legacy_models.Team(name="Portfolio Team", is_archived=False, source="test")
        session.add(team)
        await session.flush()
        rows = [
            ("planned", "Planned Project", "Draft", "Active", None, "Not configured", "Unassessed"),
            ("active", "Active Project", "Executing", "Active", None, "Planned", "Unassessed"),
            ("delivered", "Delivered Project", "Delivered", "Active", None, "Measuring", "Unassessed"),
            ("paused", "Paused Project", "Planning", "Paused", None, "Not configured", "Unassessed"),
            ("cancelled", "Cancelled Project", "Planning", "Cancelled", None, "Not configured", "Unassessed"),
            ("child", "Child Draft", "Draft", "Active", "planned", "Not configured", "Unassessed"),
        ]
        for project_id, name, phase, run_state, parent_id, outcome_phase, outcome_result in rows:
            session.add(pv1_models.PV1Project(id=project_id, tenant_id=tenant_id, display_key=f"PRJ-{project_id.upper()}", name=name, objective=f"Objective for {name}", team_id=team.id, owner_id="admin_root", phase=phase, run_state=run_state, priority="Medium", target_date=date(2026, 12, 31), parent_project_id=parent_id, architecture_assessment="Not assessed", outcome_phase=outcome_phase, outcome_result=outcome_result, created_by="test", updated_by="test"))
            session.add(pv1_models.PV1ProjectMember(id=str(uuid4()), tenant_id=tenant_id, project_id=project_id, user_id="admin_root", role="Owner", capabilities={}, created_by="test", updated_by="test"))
        task = pv1_models.PV1Task(id="blocked-task", tenant_id=tenant_id, project_id="active", title="Validation dataset approval", kind="Task", owner_id="admin_root", status="Blocked", priority="High", progress=58, start_date=date(2026, 10, 5), end_date=date(2026, 10, 23), created_by="test", updated_by="test")
        session.add(task)
        session.add(pv1_models.PV1TaskBlocker(id="blocked-task-record", tenant_id=tenant_id, project_id="active", task_id="blocked-task", source="task", reason="Validation dataset approval", resolver_id="admin_root", review_date=date(2026, 10, 23), state="Open", created_by="test", updated_by="test"))
        await session.commit()
        team_id = team.id
    finally:
        await session.close()

    response = await client.get(f"/api/v2/projects?limit=200&team_id={team_id}", headers=headers(tenant_id))
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["summary"] == {"Planned": 1, "Active": 1, "Delivered": 1, "Paused": 1, "Cancelled": 1, "Needs attention": 1, "Measuring": 1, "Realized": 0, "Closed below target": 0}
    assert len(payload["items"]) == 6
    active = next(item for item in payload["items"] if item["id"] == "active")
    assert active["story"]["health"]["level"] == "Off track"
    assert active["story"]["delivery"] == {"percent": 58, "label": "58%", "method": "Weighted by canonical planning weight."}
    assert active["story"]["attention"][0]["reason"] == "Validation dataset approval"
    assert active["capabilities"]["edit"] is True
    planned = next(item for item in payload["items"] if item["id"] == "planned")
    assert planned["story"]["delivery"]["label"] == "Not planned"
    assert planned["child_count"] == 1


def test_lifecycle_actions_are_permission_aware_and_legacy_writes_stay_disabled():
    owner = domain.project_capabilities("Owner", {"financial.view": True})
    stakeholder = domain.project_capabilities("Stakeholder", {"financial.view": True})
    legacy_admin = domain.project_capabilities("Tenant administrator", legacy=True)
    assert owner["edit"] and owner["pause"] and owner["financial_view"]
    assert stakeholder["view"] and not stakeholder["edit"] and not stakeholder["cancel"]
    assert legacy_admin["view"] and not legacy_admin["edit"] and not legacy_admin["archive"]


@pytest.mark.asyncio
async def test_lifecycle_capabilities_are_enforced_by_the_owning_domain(seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant["tenant_id"]
    session = await tenant_session(setup_db, tenant_id)
    try:
        created = await domain.create_project(session, tenant_id=tenant_id, actor_id="owner", request_role="ADMIN", command_id=str(uuid4()), payload={"name": "Lifecycle authority", "owner_id": "owner", "objective": "Preserve server authority."})
        project_id = created["changed_entities"][0]["id"]
        session.add(pv1_models.PV1ProjectMember(id=str(uuid4()), tenant_id=tenant_id, project_id=project_id, user_id="lead", role="Lead", capabilities={}, created_by="owner", updated_by="owner"))
        await session.commit()

        with pytest.raises(domain.PV1DomainError) as denied:
            await domain.execute_command(session, tenant_id=tenant_id, actor_id="lead", request_role="EDITOR", project_id=project_id, command_id=str(uuid4()), command_type="project.pause", expected={"project_revision": 1}, payload={"reason": "Not authorized"})
        assert denied.value.code == "FORBIDDEN"
        await session.rollback()

        paused = await domain.execute_command(session, tenant_id=tenant_id, actor_id="owner", request_role="EDITOR", project_id=project_id, command_id=str(uuid4()), command_type="project.pause", expected={"project_revision": 1}, payload={"reason": "Capacity held"})
        assert paused["revisions"]["project_revision"] == 2
        await session.commit()
        project = await domain.get_pv1_project(session, tenant_id, project_id)
        assert project is not None
        await session.refresh(project)
        assert (project.run_state, project.pause_reason) == ("Paused", "Capacity held")
    finally:
        await session.close()
