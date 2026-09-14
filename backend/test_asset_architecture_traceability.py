import json
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from sqlalchemy import select
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.architecture import models as architecture_models
from app.database import get_tenant_engine
from app.models import models as legacy_models
from app.pv1 import models as pv1_models


def _headers(tenant_id: int, command_id: str | None = None, user_id: str = "admin_root") -> dict[str, str]:
    headers = {"X-User-Id": user_id, "X-Tenant-Id": str(tenant_id)}
    if command_id:
        headers["Idempotency-Key"] = command_id
    return headers


def _envelope(command_id: str, command_type: str, payload: dict, expected: dict | None = None) -> dict:
    return {"command_id": command_id, "type": command_type, "expected": expected or {}, "payload": payload}


async def _session_factory(seeded_admin_tenant):
    from sqlalchemy import select
    from app.models.config import Tenant
    from app.database import ConfigSessionLocal

    async with ConfigSessionLocal() as config_db:
        tenant = (await config_db.execute(select(Tenant).where(Tenant.id == seeded_admin_tenant["tenant_id"]))).scalar_one()
    return async_sessionmaker(bind=get_tenant_engine(tenant.db_url), autoflush=False, expire_on_commit=False, class_=AsyncSession)


@pytest.mark.asyncio
async def test_normalized_asset_architecture_pv1_traceability_and_lifecycle(client, seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant["tenant_id"]
    device_response = await client.post(
        "/api/v1/devices",
        headers=_headers(tenant_id),
        json={"name": "TRACE-HOST", "system": "TRACE-SYS", "status": "Active", "type": "Physical", "asset_tag": "TRACE-AT"},
    )
    assert device_response.status_code == 200, device_response.text
    device_id = device_response.json()["id"]

    model_command = str(uuid4())
    model_response = await client.post("/api/v2/architecture/models", headers=_headers(tenant_id, model_command), json={"name": "Trace topology"})
    assert model_response.status_code == 201, model_response.text
    model_id = model_response.json()["model"]["id"]
    object_command = str(uuid4())
    object_response = await client.post(
        f"/api/v2/architecture/models/{model_id}/commands",
        headers=_headers(tenant_id, object_command),
        json=_envelope(object_command, "object.create", {"id": "trace-object", "kind": "Device", "name": "Trace host object"}, {"model_revision": 1}),
    )
    assert object_response.status_code == 200, object_response.text

    link_command = str(uuid4())
    link_response = await client.post(
        "/api/v2/architecture/traceability/device-links",
        headers=_headers(tenant_id, link_command),
        json={"device_id": device_id, "architecture_object_id": "trace-object", "relationship_type": "Represents"},
    )
    assert link_response.status_code == 201, link_response.text
    device_link_id = link_response.json()["link"]["id"]
    duplicate = await client.post(
        "/api/v2/architecture/traceability/device-links",
        headers=_headers(tenant_id, str(uuid4())),
        json={"device_id": device_id, "architecture_object_id": "trace-object", "relationship_type": "Represents"},
    )
    assert duplicate.status_code == 201
    assert duplicate.json()["status"] == "unchanged"
    assert duplicate.json()["link"]["id"] == device_link_id
    updated_device_link = await client.put(
        f"/api/v2/architecture/traceability/device-links/{device_link_id}",
        headers=_headers(tenant_id, str(uuid4())),
        json={"expected_revision": link_response.json()["link"]["revision"], "relationship_type": "Maps To"},
    )
    assert updated_device_link.status_code == 200, updated_device_link.text
    assert updated_device_link.json()["link"]["relationship_type"] == "Maps To"
    purge_preview = await client.post("/api/v1/devices/bulk-action", headers=_headers(tenant_id), json={"ids": [device_id], "action": "purge", "dry_run": True})
    assert purge_preview.status_code == 200, purge_preview.text
    assert purge_preview.json()["can_execute"] is False
    assert "traceability" in purge_preview.json()["blockers"][0]["reason"].lower()

    device_projection = await client.get(f"/api/v2/architecture/traceability/devices/{device_id}", headers=_headers(tenant_id))
    assert device_projection.status_code == 200, device_projection.text
    assert device_projection.json()["architecture_objects"][0]["object"]["id"] == "trace-object"

    project_command = str(uuid4())
    project_response = await client.post("/api/v2/projects", headers=_headers(tenant_id, project_command), json={"name": "Trace project"})
    assert project_response.status_code == 200, project_response.text
    project = project_response.json()["project"]
    project_link_command = str(uuid4())
    project_link = await client.post(
        "/api/v2/architecture/traceability/work-links",
        headers=_headers(tenant_id, project_link_command),
        json={"entity_kind": "Project", "entity_id": project["id"], "device_id": device_id, "relationship_type": "Affected", "expected_project_revision": project["revision"]},
    )
    assert project_link.status_code == 201, project_link.text
    project = (await client.get(f"/api/v2/projects/{project['id']}", headers=_headers(tenant_id))).json()
    project_revision = project["revision"]

    task_command = str(uuid4())
    task_response = await client.post(
        f"/api/v2/projects/{project['id']}/commands",
        headers=_headers(tenant_id, task_command),
        json=_envelope(task_command, "task.create", {"title": "Trace task"}, {"project_revision": project_revision, "graph_revision": project["graph_revision"]}),
    )
    assert task_response.status_code == 200, task_response.text
    task_id = task_response.json()["changed_entities"][0]["id"]
    task_link_command = str(uuid4())
    task_link = await client.post(
        "/api/v2/architecture/traceability/work-links",
        headers=_headers(tenant_id, task_link_command),
        json={"entity_kind": "Task", "entity_id": task_id, "architecture_object_id": "trace-object", "relationship_type": "Implements"},
    )
    assert task_link.status_code == 201, task_link.text
    updated_task_link = await client.put(
        f"/api/v2/architecture/traceability/work-links/{task_link.json()['link']['id']}",
        headers=_headers(tenant_id, str(uuid4())),
        json={"expected_revision": task_link.json()["link"]["revision"], "relationship_type": "Executes"},
    )
    assert updated_task_link.status_code == 200, updated_task_link.text
    assert updated_task_link.json()["link"]["relationship_type"] == "Executes"

    object_projection = await client.get("/api/v2/architecture/traceability/architecture-objects/trace-object", headers=_headers(tenant_id))
    assert object_projection.status_code == 200, object_projection.text
    assert object_projection.json()["devices"][0]["device"]["id"] == device_id
    assert {item["entity"]["kind"] for item in object_projection.json()["work"]} == {"task"}
    work_projection = await client.get(f"/api/v2/architecture/traceability/work/task/{task_id}", headers=_headers(tenant_id))
    assert work_projection.status_code == 200, work_projection.text
    assert work_projection.json()["links"][0]["target"]["architecture_object"]["id"] == "trace-object"

    change_command = str(uuid4())
    change_response = await client.post(
        "/api/v2/architecture/change-sets",
        headers=_headers(tenant_id, change_command),
        json={"command_id": change_command, "model_id": model_id, "operations": [{"op_type": "object.update", "target_id": "trace-object", "payload": {"name": "Trace host object (planned)"}}]},
    )
    assert change_response.status_code == 201, change_response.text
    change_set_id = change_response.json()["change_set"]["id"]
    change_link = await client.post(
        "/api/v2/architecture/traceability/work-links",
        headers=_headers(tenant_id, str(uuid4())),
        json={"entity_kind": "ArchitectureChangeSet", "entity_id": change_set_id, "device_id": device_id, "relationship_type": "Changes"},
    )
    assert change_link.status_code == 201, change_link.text

    outcome_id = "trace-outcome"
    session_factory = await _session_factory(seeded_admin_tenant)
    async with session_factory() as session:
        session.add(pv1_models.PV1OutcomeAcceptance(id=outcome_id, tenant_id=tenant_id, project_id=project["id"], result="Realized", metric_revision_ids=[], measurement_ids=[], reviewer_id="admin_root", rationale="Traceability test acceptance", source_snapshot={}, created_by="admin_root", updated_by="admin_root"))
        await session.commit()
    outcome_link = await client.post(
        "/api/v2/architecture/traceability/work-links",
        headers=_headers(tenant_id, str(uuid4())),
        json={"entity_kind": "OutcomeAcceptance", "entity_id": outcome_id, "architecture_object_id": "trace-object", "relationship_type": "Measures"},
    )
    assert outcome_link.status_code == 201, outcome_link.text
    change_projection = await client.get(f"/api/v2/architecture/traceability/work/architecture_change_set/{change_set_id}", headers=_headers(tenant_id))
    assert change_projection.status_code == 200, change_projection.text
    assert change_projection.json()["links"][0]["target"]["device"]["id"] == device_id
    outcome_projection = await client.get(f"/api/v2/architecture/traceability/work/outcome_acceptance/{outcome_id}", headers=_headers(tenant_id))
    assert outcome_projection.status_code == 200, outcome_projection.text
    assert outcome_projection.json()["links"][0]["target"]["architecture_object"]["id"] == "trace-object"

    association_command = str(uuid4())
    association = await client.post(
        f"/api/v2/architecture/projects/{project['id']}/architecture/associate",
        headers=_headers(tenant_id, association_command),
        json={"model_id": model_id, "object_ids": ["trace-object"], "impact_tags": ["Changes"]},
    )
    assert association.status_code == 200, association.text
    architecture_projection = await client.get(f"/api/v2/architecture/projects/{project['id']}/architecture", headers=_headers(tenant_id))
    assert architecture_projection.json()["models"][0]["association"]["object_ids"] == ["trace-object"]
    assert architecture_projection.json()["models"][0]["association"]["legacy_projection"]["object_ids"] == ["trace-object"]

    retired = await client.request(
        "DELETE",
        f"/api/v2/architecture/traceability/work-links/{task_link.json()['link']['id']}",
        headers=_headers(tenant_id, str(uuid4())),
        json={"expected_revision": updated_task_link.json()["link"]["revision"]},
    )
    assert retired.status_code == 200, retired.text
    assert retired.json()["link"]["lifecycle"] == "Retired"
    current_task_links = await client.get(f"/api/v2/architecture/traceability/work/task/{task_id}", headers=_headers(tenant_id))
    assert current_task_links.json()["links"] == []
    historical_task_links = await client.get(f"/api/v2/architecture/traceability/work/task/{task_id}?include_retired=true", headers=_headers(tenant_id))
    assert historical_task_links.json()["links"][0]["link"]["lifecycle"] == "Retired"

    retired_device_link = await client.request(
        "DELETE",
        f"/api/v2/architecture/traceability/device-links/{device_link_id}",
        headers=_headers(tenant_id, str(uuid4())),
        json={"expected_revision": updated_device_link.json()["link"]["revision"]},
    )
    assert retired_device_link.status_code == 200, retired_device_link.text
    historical_object_projection = await client.get("/api/v2/architecture/traceability/architecture-objects/trace-object?include_retired=true", headers=_headers(tenant_id))
    assert historical_object_projection.json()["devices"][0]["link"]["lifecycle"] == "Retired"

    session_factory = await _session_factory(seeded_admin_tenant)
    async with session_factory() as session:
        cross_device = legacy_models.Device(name="DANGLING-CROSS-TENANT-HOST", tenant_id=tenant_id + 1, is_deleted=False)
        session.add(cross_device)
        await session.flush()
        session.add(pv1_models.PV1TraceabilityLink(id="dangling-cross-tenant-link", tenant_id=tenant_id, entity_kind="task", entity_id=task_id, project_id=project["id"], target_kind="device", target_key=str(cross_device.id), device_id=cross_device.id, relationship_type="Affected", lifecycle="Active", revision=1, created_by="admin_root", updated_by="admin_root"))
        await session.commit()
        rows = list((await session.execute(select(pv1_models.PV1TraceabilityLink).where(pv1_models.PV1TraceabilityLink.tenant_id == tenant_id))).scalars())
        assert {row.entity_kind for row in rows} >= {"project", "task", "architecture_change_set", "outcome_acceptance"}
        architecture_rows = list((await session.execute(select(architecture_models.ArchitectureDeviceLink).where(architecture_models.ArchitectureDeviceLink.tenant_id == tenant_id))).scalars())
        assert len(architecture_rows) == 1
    dangling_projection = await client.get(f"/api/v2/architecture/traceability/work/task/{task_id}", headers=_headers(tenant_id))
    assert dangling_projection.status_code == 422
    assert dangling_projection.json()["code"] == "DATA_INTEGRITY_ERROR"


@pytest.mark.asyncio
async def test_traceability_rejects_missing_and_cross_tenant_references(client, seeded_admin_tenant):
    tenant_id = seeded_admin_tenant["tenant_id"]
    missing = await client.post(
        "/api/v2/architecture/traceability/work-links",
        headers=_headers(tenant_id, str(uuid4())),
        json={"entity_kind": "Project", "entity_id": "missing-project", "device_id": 999999, "relationship_type": "Affected"},
    )
    assert missing.status_code == 422
    assert missing.json()["code"] == "INVALID_REFERENCE"

    session_factory = await _session_factory(seeded_admin_tenant)
    async with session_factory() as session:
        cross_model = architecture_models.ArchitectureModel(id="cross-tenant-model", tenant_id=tenant_id + 1, name="Cross tenant model", owner_id="other", created_by="other", updated_by="other")
        session.add(cross_model)
        session.add(architecture_models.ArchitectureObject(id="cross-tenant-object", tenant_id=tenant_id + 1, model_id=cross_model.id, kind="Device", name="Cross tenant object", created_by="other", updated_by="other"))
        cross_device = legacy_models.Device(name="CROSS-TENANT-HOST", tenant_id=tenant_id + 1, is_deleted=False)
        session.add(cross_device)
        await session.commit()
        cross_device_id = cross_device.id
    cross_tenant_reference = await client.post(
        "/api/v2/architecture/traceability/device-links",
        headers=_headers(tenant_id, str(uuid4())),
        json={"device_id": cross_device_id, "architecture_object_id": "cross-tenant-object", "relationship_type": "Represents"},
    )
    assert cross_tenant_reference.status_code == 422
    assert cross_tenant_reference.json()["code"] == "INVALID_REFERENCE"

    cross_tenant = await client.get("/api/v2/architecture/traceability/devices/1", headers=_headers(tenant_id + 100000))
    assert cross_tenant.status_code in {403, 404}


def test_traceability_migration_backfills_valid_selections_and_preserves_invalid_source(tmp_path):
    backend_root = Path(__file__).resolve().parent
    database_path = tmp_path / "traceability-migration.db"
    config = AlembicConfig(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database_path}")
    alembic_command.upgrade(config, "f1a2b3c4d5e6")
    engine = create_engine(f"sqlite:///{database_path}")
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO pv1_projects (id, tenant_id, display_key, name, owner_id, created_by, updated_by) VALUES ('legacy-trace-project', 1, 'PRJ-TRACE', 'Legacy trace project', 'owner', 'owner', 'owner')"))
        connection.execute(text("INSERT INTO pv1_architecture_models (id, tenant_id, name, owner_id, created_by, updated_by) VALUES ('legacy-trace-model', 1, 'Legacy trace model', 'owner', 'owner', 'owner'), ('legacy-malformed-model', 1, 'Legacy malformed model', 'owner', 'owner', 'owner'), ('other-trace-model', 2, 'Other trace model', 'owner', 'owner', 'owner')"))
        connection.execute(text("INSERT INTO pv1_architecture_objects (id, tenant_id, model_id, kind, name, created_by, updated_by) VALUES ('migration-object', 1, 'legacy-trace-model', 'Device', 'Migration object', 'owner', 'owner'), ('other-object', 2, 'other-trace-model', 'Device', 'Other object', 'owner', 'owner')"))
        connection.execute(text("INSERT INTO pv1_project_architecture_associations (id, tenant_id, project_id, model_id, object_ids, relation_ids, created_by, updated_by) VALUES ('legacy-valid-association', 1, 'legacy-trace-project', 'legacy-trace-model', :object_ids, :relation_ids, 'owner', 'owner'), ('legacy-malformed-association', 1, 'legacy-trace-project', 'legacy-malformed-model', :malformed, :malformed_relation_ids, 'owner', 'owner')"), {"object_ids": json.dumps(["migration-object", "migration-object", " migration-object ", "missing-object", "other-object"]), "relation_ids": json.dumps(["legacy-relation"]), "malformed": "not-a-json-list", "malformed_relation_ids": json.dumps(["malformed-relation"])})

    alembic_command.upgrade(config, "head")
    with engine.connect() as connection:
        normalized = connection.execute(text("SELECT entity_kind, entity_id, target_kind, target_key, relationship_type FROM pv1_traceability_links")).mappings().all()
        issues = connection.execute(text("SELECT source_field, source_value FROM pv1_traceability_backfill_issues ORDER BY source_value")).mappings().all()
        source_rows = connection.execute(text("SELECT id, object_ids, relation_ids FROM pv1_project_architecture_associations ORDER BY id")).mappings().all()
    assert [dict(row) for row in normalized] == [{"entity_kind": "project", "entity_id": "legacy-trace-project", "target_kind": "architecture_object", "target_key": "migration-object", "relationship_type": "Affected"}]
    assert {row["source_value"] for row in issues} == {"missing-object", "not-a-json-list", "other-object"}
    source_by_id = {row["id"]: row for row in source_rows}
    assert json.loads(source_by_id["legacy-malformed-association"]["relation_ids"]) == ["malformed-relation"]
    assert source_by_id["legacy-valid-association"]["object_ids"] == json.dumps(["migration-object", "migration-object", " migration-object ", "missing-object", "other-object"])
    engine.dispose()
