from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.tenants import run_alembic_upgrade
from app.database import build_engine, get_tenant_engine
from app.models import models as legacy_models
from app.models.config import Tenant, UserTenantAccess
from app.pv1 import models as pv1_models


def _headers(tenant_id: int, user_id: str = "admin_root", command_id: str | None = None) -> dict[str, str]:
    headers = {"X-User-Id": user_id, "X-Tenant-Id": str(tenant_id)}
    if command_id:
        headers["Idempotency-Key"] = command_id
    return headers


def _command(command_id: str, command_type: str, *, expected: dict | None = None, payload: dict | None = None) -> dict:
    return {
        "command_id": command_id,
        "type": command_type,
        "expected": expected or {},
        "payload": payload or {},
    }


async def _tenant_db_url(ConfigSessionLocal, tenant_id: int) -> str:
    async with ConfigSessionLocal() as session:
        tenant = await session.get(Tenant, tenant_id)
        assert tenant is not None
        return tenant.db_url


async def _tenant_session(db_url: str):
    engine = get_tenant_engine(db_url)
    return async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)()


@pytest.mark.asyncio
async def test_pv1_migration_creates_additive_tables_and_legacy_round_trip(client, seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant["tenant_id"]
    db_url = await _tenant_db_url(setup_db[1], tenant_id)
    session = await _tenant_session(db_url)
    try:
        legacy = legacy_models.Project(
            name="Legacy Exact Dates",
            status="Completed",
            priority="High",
            start_date=datetime(2026, 1, 2, tzinfo=timezone.utc),
            end_date=datetime(2026, 2, 3, tzinfo=timezone.utc),
            owner="legacy-owner",
            created_by_user_id="legacy-author",
            objective="Retain this objective",
            metadata_json={"legacy_key": "preserve-me"},
        )
        session.add(legacy)
        await session.commit()
        legacy_id = legacy.id

        canonical_response = await client.post(
            "/api/v2/projects",
            headers=_headers(tenant_id, command_id=str(uuid4())),
            json={"name": "Canonical project", "start_date": "2026-03-01", "target_date": "2026-03-31"},
        )
        assert canonical_response.status_code == 200, canonical_response.text
        canonical_id = canonical_response.json()["project"]["id"]
        assert canonical_id != str(legacy_id)

        legacy_response = await client.get(f"/api/v2/projects/{legacy_id}", headers=_headers(tenant_id))
        assert legacy_response.status_code == 200, legacy_response.text
        legacy_project = legacy_response.json()
        assert legacy_project["id"] == str(legacy_id)
        assert legacy_project["legacy_project_id"] == legacy_id
        assert legacy_project["start_date"] == "2026-01-02"
        assert legacy_project["target_date"] == "2026-02-03"
        assert legacy_project["phase"] == "Delivered"
        assert legacy_project["legacy_metadata"]["legacy_key"] == "preserve-me"

        persisted = await session.get(pv1_models.PV1Project, canonical_id)
        assert persisted is not None
        assert persisted.revision == 1
        assert persisted.graph_revision == 1
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_command_idempotency_stale_revision_and_atomic_event(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    create_id = str(uuid4())
    created = await client.post(
        "/api/v2/projects",
        headers=_headers(tenant_id, command_id=create_id),
        json={"name": "Idempotent project"},
    )
    assert created.status_code == 200, created.text
    project_id = created.json()["project"]["id"]

    command_id = str(uuid4())
    body = _command(command_id, "project.update_details", expected={"project_revision": 1}, payload={"name": "Updated once"})
    first = await client.post(f"/api/v2/projects/{project_id}/commands", headers=_headers(tenant_id, command_id=command_id), json=body)
    second = await client.post(f"/api/v2/projects/{project_id}/commands", headers=_headers(tenant_id, command_id=command_id), json=body)
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json() == first.json()

    conflicting_retry = await client.post(
        f"/api/v2/projects/{project_id}/commands",
        headers=_headers(tenant_id, command_id=command_id),
        json=_command(command_id, "project.update_details", expected={"project_revision": 2}, payload={"name": "Different"}),
    )
    assert conflicting_retry.status_code == 409
    assert conflicting_retry.json()["code"] == "IDEMPOTENCY_CONFLICT"

    stale_id = str(uuid4())
    stale = await client.post(
        f"/api/v2/projects/{project_id}/commands",
        headers=_headers(tenant_id, command_id=stale_id),
        json=_command(stale_id, "project.update_details", expected={"project_revision": 1}, payload={"name": "Stale"}),
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "REVISION_CONFLICT"

    events = await client.get(f"/api/v2/projects/{project_id}/events", headers=_headers(tenant_id))
    assert events.status_code == 200, events.text
    event_types = [item["event_type"] for item in events.json()["items"]]
    assert event_types.count("project.update_details") == 1
    assert event_types.count("project.created") == 1


@pytest.mark.asyncio
async def test_project_membership_enforces_task_ownership_and_revocation(client, seeded_admin_tenant, setup_db, provision_module_operator):
    tenant_id = seeded_admin_tenant["tenant_id"]
    async with setup_db[1]() as config_session:
        config_session.add(UserTenantAccess(user_id="contributor", tenant_id=tenant_id, role="EDITOR", is_selected=False))
        await config_session.commit()
    await provision_module_operator(tenant_id, 'contributor', 'projects', preview=True)

    created = await client.post(
        "/api/v2/projects",
        headers=_headers(tenant_id, command_id=str(uuid4())),
        json={"name": "Access project"},
    )
    assert created.status_code == 200, created.text
    project_id = created.json()["project"]["id"]

    access_id = str(uuid4())
    access_body = _command(
        access_id,
        "project.set_access",
        expected={"project_revision": 1},
        payload={
            "members": [
                {"user_id": "admin_root", "role": "Owner", "capabilities": {"financial.view": True}},
                {"user_id": "contributor", "role": "Contributor"},
            ],
            "visibility": "Team",
        },
    )
    access = await client.post(f"/api/v2/projects/{project_id}/commands", headers=_headers(tenant_id, command_id=access_id), json=access_body)
    assert access.status_code == 200, access.text
    assert access.json()["revisions"]["project_revision"] == 2

    task_id = str(uuid4())
    task_body = _command(
        task_id,
        "task.create",
        expected={"project_revision": 2, "graph_revision": 1},
        payload={"title": "Contributor-owned task", "owner_id": "contributor"},
    )
    task = await client.post(f"/api/v2/projects/{project_id}/commands", headers=_headers(tenant_id, command_id=task_id), json=task_body)
    assert task.status_code == 200, task.text
    actual_task_id = task.json()["changed_entities"][0]["id"]

    update_id = str(uuid4())
    contributor_update = _command(
        update_id,
        "task.update_fields",
        expected={"project_revision": 3, "graph_revision": 2, "task_revision": 1},
        payload={"task_id": actual_task_id, "progress": 50},
    )
    updated = await client.post(f"/api/v2/projects/{project_id}/commands", headers=_headers(tenant_id, "contributor", update_id), json=contributor_update)
    assert updated.status_code == 200, updated.text

    forbidden_id = str(uuid4())
    forbidden = await client.post(
        f"/api/v2/projects/{project_id}/commands",
        headers=_headers(tenant_id, "contributor", forbidden_id),
        json=_command(forbidden_id, "project.update_details", expected={"project_revision": 4}, payload={"name": "No"}),
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["code"] == "FORBIDDEN"

    revoke_id = str(uuid4())
    revoke_body = _command(
        revoke_id,
        "project.set_access",
        expected={"project_revision": 4},
        payload={"members": [{"user_id": "admin_root", "role": "Owner"}]},
    )
    revoked = await client.post(f"/api/v2/projects/{project_id}/commands", headers=_headers(tenant_id, command_id=revoke_id), json=revoke_body)
    assert revoked.status_code == 200, revoked.text

    db_url = await _tenant_db_url(setup_db[1], tenant_id)
    session = await _tenant_session(db_url)
    try:
        member = await session.scalar(select(pv1_models.PV1ProjectMember).where(pv1_models.PV1ProjectMember.project_id == project_id, pv1_models.PV1ProjectMember.user_id == "contributor"))
        assert member is None
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_outcome_does_not_follow_progress_and_attribution_is_bounded(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    created = await client.post(
        "/api/v2/projects",
        headers=_headers(tenant_id, command_id=str(uuid4())),
        json={"name": "Outcome project"},
    )
    assert created.status_code == 200, created.text
    project = created.json()["project"]
    project_id = project["id"]

    task_command_id = str(uuid4())
    task = await client.post(
        f"/api/v2/projects/{project_id}/commands",
        headers=_headers(tenant_id, command_id=task_command_id),
        json=_command(task_command_id, "task.create", expected={"project_revision": 1, "graph_revision": 1}, payload={"title": "Complete work", "progress": 100}),
    )
    assert task.status_code == 200, task.text

    close_without_delivery_id = str(uuid4())
    not_delivered = await client.post(
        f"/api/v2/projects/{project_id}/commands",
        headers=_headers(tenant_id, command_id=close_without_delivery_id),
        json=_command(close_without_delivery_id, "outcomes.close", expected={"project_revision": 2}, payload={"result": "Realized", "measurement_ids": ["m"], "metric_revision_ids": ["r"]}),
    )
    assert not_delivered.status_code == 422
    assert not_delivered.json()["code"] == "VALIDATION_FAILED"

    value_1 = str(uuid4())
    value_body = {
        "classification": "Cash saving",
        "amount": "100.00",
        "currency_or_unit": "USD",
        "period_start": "2026-01-01",
        "period_end": "2026-02-01",
        "attribution_key": "shared-benefit",
        "fraction": "0.75",
        "source": "approved ledger",
    }
    first_value = await client.post(
        f"/api/v2/projects/{project_id}/commands",
        headers=_headers(tenant_id, command_id=value_1),
        json=_command(value_1, "value.record", expected={"project_revision": 2}, payload=value_body),
    )
    assert first_value.status_code == 403
    assert first_value.json()["code"] == "FORBIDDEN"


@pytest.mark.asyncio
async def test_metric_delivery_acceptance_and_verified_outcome_are_independent(client, seeded_admin_tenant, setup_db, outcome_reference_date):
    tenant_id = seeded_admin_tenant["tenant_id"]
    created = await client.post(
        "/api/v2/projects",
        headers=_headers(tenant_id, command_id=str(uuid4())),
        json={"name": "Measured outcome project", "objective": "Verify delivery and outcome remain independent.", "in_scope": "Measured delivery", "out_of_scope": "Unmeasured value", "target_date": "2026-03-01"},
    )
    assert created.status_code == 200, created.text
    project_id = created.json()["project"]["id"]

    creation_save_id = str(uuid4())
    creation_save = await client.post(
        f"/api/v2/projects/{project_id}/commands",
        headers=_headers(tenant_id, command_id=creation_save_id),
        json=_command(
            creation_save_id,
            "project.save_creation_draft",
            expected={"project_revision": 1},
            payload={
                "details": {"architecture_assessment": "Yes"},
                "creation_draft": {
                    "draft_step": 3,
                    "acceptance_criteria": ["Delivery evidence is reviewable"],
                    "metric": {},
                    "milestones": [{"title": "Measurement review", "owner_id": "admin_root", "point_date": "2026-02-20"}],
                    "collaborators": [],
                    "dependencies": [],
                    "suggestions_accepted": False,
                },
            },
        ),
    )
    assert creation_save.status_code == 200, creation_save.text
    promote_id = str(uuid4())
    promote = await client.post(
        f"/api/v2/projects/{project_id}/commands",
        headers=_headers(tenant_id, command_id=promote_id),
        json=_command(promote_id, "project.transition", expected={"project_revision": 2}, payload={"to_phase": "Proposed"}),
    )
    assert promote.status_code == 200, promote.text

    access_id = str(uuid4())
    access = await client.post(
        f"/api/v2/projects/{project_id}/commands",
        headers=_headers(tenant_id, command_id=access_id),
        json=_command(
            access_id,
            "project.set_access",
            expected={"project_revision": 3},
            payload={"members": [{"user_id": "admin_root", "role": "Owner", "capabilities": {"financial.view": True, "financial.edit": True}}]},
        ),
    )
    assert access.status_code == 200, access.text

    metric_command_id = str(uuid4())
    metric = await client.post(
        f"/api/v2/projects/{project_id}/commands",
        headers=_headers(tenant_id, command_id=metric_command_id),
        json=_command(
            metric_command_id,
            "metric.define",
            expected={"project_revision": 4},
            payload={
                "name": "Eligible adoption",
                "kind": "Adoption",
                "unit": "%",
                "direction": "Increase",
                "steward_id": "admin_root",
                    "measurement_method": "Verified sample",
                    "target_spec": {"type": "number", "operator": ">=", "value": "80"},
                    "required_for_success": True,
                    "required_consecutive_periods": 1,
            },
        ),
    )
    assert metric.status_code == 200, metric.text
    metric_id = metric.json()["changed_entities"][0]["id"]

    measurement_command_id = str(uuid4())
    measurement = await client.post(
        f"/api/v2/projects/{project_id}/commands",
        headers=_headers(tenant_id, command_id=measurement_command_id),
        json=_command(
            measurement_command_id,
            "measurement.record",
            expected={"project_revision": 4},
            payload={
                "metric_id": metric_id,
                "definition_revision": 1,
                "period_start": "2026-08-01",
                "period_end": "2026-09-01",
                "observed_numeric": "85",
                "unit": "%",
                "source": "verified sample",
                "quality": "Verified",
                "evidence": [{"id": "evidence-1", "kind": "sample"}],
            },
        ),
    )
    assert measurement.status_code == 200, measurement.text
    measurement_id = measurement.json()["changed_entities"][0]["id"]

    value_body = {
        "classification": "Cash saving",
        "amount": "100.00",
        "currency_or_unit": "USD",
        "period_start": "2026-01-01",
        "period_end": "2026-02-01",
        "attribution_key": "measured-benefit",
        "fraction": "0.75",
        "source": "approved ledger",
        "quality": "Verified",
        "evidence": [{"id": "value-evidence-1"}],
    }
    value_id = str(uuid4())
    value = await client.post(
        f"/api/v2/projects/{project_id}/commands",
        headers=_headers(tenant_id, command_id=value_id),
        json=_command(value_id, "value.record", expected={"project_revision": 4}, payload=value_body),
    )
    assert value.status_code == 200, value.text
    over_allocated_id = str(uuid4())
    over_allocated = await client.post(
        f"/api/v2/projects/{project_id}/commands",
        headers=_headers(tenant_id, command_id=over_allocated_id),
        json=_command(over_allocated_id, "value.record", expected={"project_revision": 4}, payload={**value_body, "fraction": "0.30"}),
    )
    assert over_allocated.status_code == 422
    assert over_allocated.json()["code"] == "VALIDATION_FAILED"

    task_id = str(uuid4())
    task = await client.post(
        f"/api/v2/projects/{project_id}/commands",
        headers=_headers(tenant_id, command_id=task_id),
            json=_command(task_id, "task.create", expected={"project_revision": 4, "graph_revision": 2}, payload={"title": "Execute measured delivery", "owner_id": "admin_root", "start_date": "2026-02-02", "end_date": "2026-02-13", "mandatory": True}),
    )
    assert task.status_code == 200, task.text

    # P09 delivery acceptance is deliberately strict: every mandatory task,
    # including the creation-template milestone, must be explicitly Done.
    task_revisions = task.json()["revisions"]
    milestone_session = await _tenant_session(await _tenant_db_url(setup_db[1], tenant_id))
    try:
        milestone_rows = list((await milestone_session.execute(select(pv1_models.PV1Task).where(pv1_models.PV1Task.project_id == project_id, pv1_models.PV1Task.mandatory.is_(True), pv1_models.PV1Task.status != "Done"))).scalars())
        milestone_ids = [row.id for row in milestone_rows if row.id != task.json()["changed_entities"][0]["id"]]
    finally:
        await milestone_session.close()
    current_project_revision = task_revisions["project_revision"]
    current_graph_revision = task_revisions["graph_revision"]
    for task_to_finish in [task.json()["changed_entities"][0]["id"], *milestone_ids]:
        finish_id = str(uuid4())
        finished = await client.post(
            f"/api/v2/projects/{project_id}/commands",
            headers=_headers(tenant_id, command_id=finish_id),
            json=_command(finish_id, "task.transition", expected={"project_revision": current_project_revision, "graph_revision": current_graph_revision, "task_revision": 1}, payload={"task_id": task_to_finish, "to_status": "Done", "completion_exception": "Owner verified the delivery evidence for this retained regression."}),
        )
        assert finished.status_code == 200, finished.text
        current_project_revision = finished.json()["revisions"]["project_revision"]
        current_graph_revision = finished.json()["revisions"]["graph_revision"]

    # The retained fixture now reviews the creation-draft acceptance criterion
    # explicitly so delivery acceptance remains evidence-backed under PV1.
    criterion_session = await _tenant_session(await _tenant_db_url(setup_db[1], tenant_id))
    try:
        open_criteria = list((await criterion_session.execute(select(pv1_models.PV1TaskCriterion).where(pv1_models.PV1TaskCriterion.project_id == project_id, pv1_models.PV1TaskCriterion.state == "Open"))).scalars())
    finally:
        await criterion_session.close()
    for criterion in open_criteria:
        review_id = str(uuid4())
        reviewed = await client.post(
            f"/api/v2/projects/{project_id}/commands",
            headers=_headers(tenant_id, command_id=review_id),
            json=_command(review_id, "criterion.review", expected={"project_revision": current_project_revision}, payload={"criterion_id": criterion.id, "to_state": "Passed", "evidence_ids": ["evidence-1"]}),
        )
        assert reviewed.status_code == 200, reviewed.text
        current_project_revision = reviewed.json()["revisions"]["project_revision"]

    # Re-read after the independently committed checklist reviews so this
    # retained regression follows the server's authoritative revision.
    latest_project = await client.get(f"/api/v2/projects/{project_id}", headers=_headers(tenant_id))
    assert latest_project.status_code == 200, latest_project.text
    current_project_revision = latest_project.json()["revision"]

    transition_id = str(uuid4())
    transition = await client.post(
        f"/api/v2/projects/{project_id}/commands",
        headers=_headers(tenant_id, command_id=transition_id),
        json=_command(transition_id, "project.transition", expected={"project_revision": current_project_revision}, payload={"to_phase": "Validating"}),
    )
    assert transition.status_code == 200, transition.text
    delivery_expected_revision = transition.json()["revisions"]["project_revision"]

    delivery_id = str(uuid4())
    delivery = await client.post(
        f"/api/v2/projects/{project_id}/commands",
        headers=_headers(tenant_id, command_id=delivery_id),
        json=_command(
            delivery_id,
            "delivery.accept",
            expected={"project_revision": delivery_expected_revision},
            payload={"task_revision_ids": [], "criterion_revision_ids": [], "evidence_revision_ids": ["evidence-1"], "residual_obligation_ids": [], "followups": [{"days": 14}]},
        ),
    )
    assert delivery.status_code == 200, delivery.text
    outcome_expected_revision = delivery.json()["revisions"]["project_revision"]

    outcome_id = str(uuid4())
    outcome = await client.post(
        f"/api/v2/projects/{project_id}/commands",
        headers=_headers(tenant_id, command_id=outcome_id),
        json=_command(
            outcome_id,
            "outcomes.close",
            expected={"project_revision": outcome_expected_revision},
            payload={"result": "Realized", "metric_revision_ids": [metric_id], "measurement_ids": [measurement_id], "rationale": "Verified target evidence reviewed."},
        ),
    )
    assert outcome.status_code == 200, outcome.text

    project_response = await client.get(f"/api/v2/projects/{project_id}", headers=_headers(tenant_id))
    assert project_response.status_code == 200, project_response.text
    assert project_response.json()["phase"] == "Delivered"
    assert project_response.json()["outcome_result"] == "Realized"


@pytest.mark.asyncio
async def test_same_project_id_is_not_readable_from_another_tenant(client, seeded_admin_tenant, setup_db, tmp_path, provision_module_operator):
    tenant_a_id = seeded_admin_tenant["tenant_id"]
    created = await client.post(
        "/api/v2/projects",
        headers=_headers(tenant_a_id, command_id=str(uuid4())),
        json={"name": "Tenant A project"},
    )
    assert created.status_code == 200, created.text
    project_id = created.json()["project"]["id"]

    tenant_b_url = f"sqlite+aiosqlite:///{tmp_path / 'tenant_b_pv1.db'}"
    upgraded, error = run_alembic_upgrade(tenant_b_url)
    assert upgraded, error
    async with setup_db[1]() as config_session:
        tenant_b = Tenant(name=f"Tenant B {uuid4()}", db_url=tenant_b_url, is_active=True)
        config_session.add(tenant_b)
        await config_session.flush()
        tenant_b_id = tenant_b.id
        config_session.add(UserTenantAccess(user_id="admin_root", tenant_id=tenant_b.id, role="ADMIN", is_selected=False))
        await config_session.commit()

    await provision_module_operator(tenant_b_id, 'admin_root', 'projects')
    hidden = await client.get(f"/api/v2/projects/{project_id}", headers=_headers(tenant_b_id))
    assert hidden.status_code == 404


@pytest.mark.asyncio
async def test_new_canonical_project_survives_new_engine_connection(client, seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant["tenant_id"]
    created = await client.post(
        "/api/v2/projects",
        headers=_headers(tenant_id, command_id=str(uuid4())),
        json={"name": "Restart persistence"},
    )
    assert created.status_code == 200, created.text
    project_id = created.json()["project"]["id"]
    db_url = await _tenant_db_url(setup_db[1], tenant_id)
    fresh_engine = build_engine(db_url)
    session_factory = async_sessionmaker(bind=fresh_engine, class_=AsyncSession, expire_on_commit=False)
    session = session_factory()
    try:
        persisted = await session.scalar(select(pv1_models.PV1Project).where(pv1_models.PV1Project.id == project_id))
        assert persisted is not None
        assert persisted.name == "Restart persistence"
        assert persisted.tenant_id == tenant_id
        outbox = await session.scalar(select(pv1_models.PV1OutboxEvent).where(pv1_models.PV1OutboxEvent.event_id.is_not(None)))
        assert outbox is not None
    finally:
        await session.close()
        await fresh_engine.dispose()
