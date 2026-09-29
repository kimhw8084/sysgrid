from uuid import uuid4

import pytest
from sqlalchemy import select

from app.architecture import models as architecture_models
from app.models.config import Tenant, UserTenantAccess
from app.database import get_tenant_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from app.pv1 import models as pv1_models


def _headers(tenant_id: int, user_id: str, command_id: str | None = None) -> dict[str, str]:
    headers = {"X-User-Id": user_id, "X-Tenant-Id": str(tenant_id)}
    if command_id:
        headers["Idempotency-Key"] = command_id
    return headers


def _envelope(command_id: str, command_type: str, payload: dict, expected: dict | None = None) -> dict:
    return {"command_id": command_id, "type": command_type, "expected": expected or {}, "payload": payload}


async def _grant_user(setup_db, tenant_id: int, user_id: str):
    async with setup_db[1]() as session:
        session.add(UserTenantAccess(user_id=user_id, tenant_id=tenant_id, role="ADMIN", is_selected=False))
        await session.commit()


async def _create_project(client, tenant_id: int) -> str:
    command_id = str(uuid4())
    response = await client.post("/api/v2/projects", headers=_headers(tenant_id, "admin_root", command_id), json={"name": "Architecture project", "objective": "Canonical architecture impact"})
    assert response.status_code == 200, response.text
    return response.json()["project"]["id"]


@pytest.mark.asyncio
async def test_canonical_model_object_relation_identity_and_idempotency(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    create_id = str(uuid4())
    created = await client.post("/api/v2/architecture/models", headers=_headers(tenant_id, "admin_root", create_id), json={"name": "Platform topology", "description": "Canonical model"})
    assert created.status_code == 201, created.text
    assert created.json()["model"]["revision"] == 1
    model_id = created.json()["model"]["id"]
    replay = await client.post("/api/v2/architecture/models", headers=_headers(tenant_id, "admin_root", create_id), json={"name": "Platform topology", "description": "Canonical model"})
    assert replay.status_code == 201
    assert replay.json()["model"]["id"] == model_id

    first_id = str(uuid4())
    first = await client.post(f"/api/v2/architecture/models/{model_id}/commands", headers=_headers(tenant_id, "admin_root", first_id), json=_envelope(first_id, "object.create", {"id": "service-1", "kind": "Application/Service", "name": "Checkout"}, {"model_revision": 1}))
    assert first.status_code == 200, first.text
    assert first.json()["model_revision"] == 2
    second_id = str(uuid4())
    second = await client.post(f"/api/v2/architecture/models/{model_id}/commands", headers=_headers(tenant_id, "admin_root", second_id), json=_envelope(second_id, "object.create", {"id": "store-1", "kind": "Datastore", "name": "Orders"}, {"model_revision": 2}))
    assert second.status_code == 200, second.text
    relation_id = str(uuid4())
    relation = await client.post(f"/api/v2/architecture/models/{model_id}/commands", headers=_headers(tenant_id, "admin_root", relation_id), json=_envelope(relation_id, "relation.create", {"id": "relation-1", "source_id": "service-1", "target_id": "store-1", "relation_type": "Changes"}, {"model_revision": 3}))
    assert relation.status_code == 200, relation.text
    projection = await client.get(f"/api/v2/architecture/models/{model_id}", headers=_headers(tenant_id, "admin_root"))
    assert projection.status_code == 200, projection.text
    assert {item["id"] for item in projection.json()["objects"]} == {"service-1", "store-1"}
    assert projection.json()["relations"][0]["id"] == "relation-1"
    replay_command = await client.post(f"/api/v2/architecture/models/{model_id}/commands", headers=_headers(tenant_id, "admin_root", second_id), json=_envelope(second_id, "object.create", {"id": "store-1", "kind": "Datastore", "name": "Orders"}, {"model_revision": 2}))
    assert replay_command.status_code == 200
    assert replay_command.json()["event_id"] == second.json()["event_id"]


@pytest.mark.asyncio
async def test_changeset_review_apply_is_atomic_and_current_stays_unchanged(client, seeded_admin_tenant, setup_db, provision_module_operator):
    tenant_id = seeded_admin_tenant["tenant_id"]
    await _grant_user(setup_db, tenant_id, "approver")
    await provision_module_operator(tenant_id, 'approver', 'architecture', preview=True)
    model_id = (await client.post("/api/v2/architecture/models", headers=_headers(tenant_id, "admin_root", str(uuid4())), json={"name": "Review model"})).json()["model"]["id"]
    change_id = str(uuid4())
    change = await client.post("/api/v2/architecture/change-sets", headers=_headers(tenant_id, "admin_root", change_id), json={"command_id": change_id, "model_id": model_id, "operations": [{"op_type": "object.create", "target_id": "planned-db", "payload": {"kind": "Datastore", "name": "Planned DB", "lifecycle": "Planned"}}]})
    assert change.status_code == 201, change.text
    change_set_id = change.json()["change_set"]["id"]
    current = await client.get(f"/api/v2/architecture/models/{model_id}", headers=_headers(tenant_id, "admin_root"))
    assert current.json()["objects"] == []
    proposed = await client.get(f"/api/v2/architecture/models/{model_id}", params={"mode": "proposed", "changeset": change_set_id}, headers=_headers(tenant_id, "admin_root"))
    assert proposed.status_code == 200
    assert proposed.json()["reserved_object_ids"] == ["planned-db"]
    submit_id = str(uuid4())
    submitted = await client.post(f"/api/v2/architecture/change-sets/{change_set_id}/submit", headers=_headers(tenant_id, "admin_root", submit_id), json={"command_id": submit_id})
    assert submitted.status_code == 200, submitted.text
    self_approve_id = str(uuid4())
    self_approved = await client.post(f"/api/v2/architecture/change-sets/{change_set_id}/approve", headers=_headers(tenant_id, "admin_root", self_approve_id), json={"command_id": self_approve_id})
    assert self_approved.status_code == 403
    approve_id = str(uuid4())
    approved = await client.post(f"/api/v2/architecture/change-sets/{change_set_id}/approve", headers=_headers(tenant_id, "approver", approve_id), json={"command_id": approve_id})
    assert approved.status_code == 200, approved.text
    apply_id = str(uuid4())
    applied = await client.post(f"/api/v2/architecture/change-sets/{change_set_id}/apply", headers=_headers(tenant_id, "admin_root", apply_id), json={"command_id": apply_id})
    assert applied.status_code == 200, applied.text
    current_after = await client.get(f"/api/v2/architecture/models/{model_id}", headers=_headers(tenant_id, "admin_root"))
    assert [item["id"] for item in current_after.json()["objects"]] == ["planned-db"]
    assert applied.json()["model_revision"] == 2


@pytest.mark.asyncio
async def test_project_association_is_reference_only_and_assessment_requires_evidence(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    project_id = await _create_project(client, tenant_id)
    model_id = (await client.post("/api/v2/architecture/models", headers=_headers(tenant_id, "admin_root", str(uuid4())), json={"name": "Impact model"})).json()["model"]["id"]
    object_id = str(uuid4())
    created = await client.post(f"/api/v2/architecture/models/{model_id}/commands", headers=_headers(tenant_id, "admin_root", object_id), json=_envelope(object_id, "object.create", {"id": "service-impact", "kind": "Application/Service", "name": "Impact service"}, {"model_revision": 1}))
    assert created.status_code == 200, created.text
    association_id = str(uuid4())
    associated = await client.post(f"/api/v2/architecture/projects/{project_id}/architecture/associate", headers=_headers(tenant_id, "admin_root", association_id), json={"command_id": association_id, "model_id": model_id, "object_ids": ["service-impact"], "impact_tags": ["Changes"]})
    assert associated.status_code == 200, associated.text
    view = await client.get(f"/api/v2/architecture/projects/{project_id}/architecture", headers=_headers(tenant_id, "admin_root"))
    assert view.status_code == 200
    assert view.json()["models"][0]["association"]["object_ids"] == ["service-impact"]
    assert view.json()["models"][0]["objects"][0]["id"] == "service-impact"
    no_impact = await client.post(f"/api/v2/architecture/projects/{project_id}/architecture/assessment", headers=_headers(tenant_id, "admin_root", str(uuid4())), json={"model_id": model_id, "state": "No impact"})
    assert no_impact.status_code == 422
    as_built = await client.post(f"/api/v2/architecture/projects/{project_id}/architecture/assessment", headers=_headers(tenant_id, "admin_root", str(uuid4())), json={"model_id": model_id, "state": "As-built verified", "reviewer_id": "admin_root", "evidence_refs": ["runbook-1"], "applied_model_revision": 2})
    assert as_built.status_code == 403


@pytest.mark.asyncio
async def test_stale_object_write_and_stale_change_set_apply_require_rebase(client, seeded_admin_tenant, setup_db, provision_module_operator):
    tenant_id = seeded_admin_tenant["tenant_id"]
    await _grant_user(setup_db, tenant_id, "approver-2")
    await provision_module_operator(tenant_id, 'approver-2', 'architecture', preview=True)
    model_id = (await client.post("/api/v2/architecture/models", headers=_headers(tenant_id, "admin_root", str(uuid4())), json={"name": "Conflict model"})).json()["model"]["id"]
    create_id = str(uuid4())
    created = await client.post(f"/api/v2/architecture/models/{model_id}/commands", headers=_headers(tenant_id, "admin_root", create_id), json=_envelope(create_id, "object.create", {"id": "conflict-object", "kind": "Component", "name": "Conflict object"}, {"model_revision": 1}))
    assert created.status_code == 200, created.text
    update_id = str(uuid4())
    updated = await client.post(f"/api/v2/architecture/models/{model_id}/commands", headers=_headers(tenant_id, "admin_root", update_id), json=_envelope(update_id, "object.update", {"object_id": "conflict-object", "name": "First writer", "expected_revision": 1}, {"model_revision": 2}))
    assert updated.status_code == 200, updated.text
    stale_id = str(uuid4())
    stale = await client.post(f"/api/v2/architecture/models/{model_id}/commands", headers=_headers(tenant_id, "admin_root", stale_id), json=_envelope(stale_id, "object.update", {"object_id": "conflict-object", "name": "Stale writer", "expected_revision": 1}, {"model_revision": 2}))
    assert stale.status_code == 409
    assert stale.json()["code"] == "REVISION_CONFLICT"

    change_id = str(uuid4())
    change = await client.post("/api/v2/architecture/change-sets", headers=_headers(tenant_id, "admin_root", change_id), json={"command_id": change_id, "model_id": model_id, "operations": [{"op_type": "object.update", "target_id": "conflict-object", "payload": {"name": "Approved proposal"}}]})
    assert change.status_code == 201, change.text
    change_set_id = change.json()["change_set"]["id"]
    submit_id = str(uuid4())
    assert (await client.post(f"/api/v2/architecture/change-sets/{change_set_id}/submit", headers=_headers(tenant_id, "admin_root", submit_id), json={"command_id": submit_id})).status_code == 200
    approve_id = str(uuid4())
    assert (await client.post(f"/api/v2/architecture/change-sets/{change_set_id}/approve", headers=_headers(tenant_id, "approver-2", approve_id), json={"command_id": approve_id})).status_code == 200
    newer_id = str(uuid4())
    newer = await client.post(f"/api/v2/architecture/models/{model_id}/commands", headers=_headers(tenant_id, "admin_root", newer_id), json=_envelope(newer_id, "object.update", {"object_id": "conflict-object", "name": "Newer writer", "expected_revision": 2}, {"model_revision": 3}))
    assert newer.status_code == 200, newer.text
    apply_id = str(uuid4())
    applied = await client.post(f"/api/v2/architecture/change-sets/{change_set_id}/apply", headers=_headers(tenant_id, "admin_root", apply_id), json={"command_id": apply_id})
    assert applied.status_code == 409
    assert applied.json()["code"] == "REBASE_REQUIRED"
    after = await client.get(f"/api/v2/architecture/models/{model_id}", headers=_headers(tenant_id, "admin_root"))
    assert after.json()["objects"][0]["name"] == "Newer writer"


@pytest.mark.asyncio
async def test_architecture_model_is_tenant_scoped(client, seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant["tenant_id"]
    model_id = (await client.post("/api/v2/architecture/models", headers=_headers(tenant_id, "admin_root", str(uuid4())), json={"name": "Tenant model"})).json()["model"]["id"]
    wrong_tenant = tenant_id + 100000
    response = await client.get(f"/api/v2/architecture/models/{model_id}", headers=_headers(wrong_tenant, "admin_root"))
    assert response.status_code in {403, 404}
