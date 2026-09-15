from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..pv1 import domain as pv1_domain
from ..pv1 import models as pv1_models
from . import models


OBJECT_KINDS = {
    "Person", "Actor", "System", "Application/Service", "Datastore", "Component",
    "Device", "Network", "External system", "Group",
}
LIFECYCLES = {"Current", "Planned", "Deprecated", "Retired"}
DIAGRAM_LEVELS = {"Context", "Service", "Component", "Deployment"}
RELATION_TYPES = {"Reads", "Changes", "Introduces", "Retires", "Depends on", "Uses", "Connects to", "Contains"}
IMPACT_TAGS = {"Reads", "Changes", "Introduces", "Retires", "Depends on"}
ASSESSMENTS = {"Not assessed", "No impact", "Impact identified", "Design under review", "Design approved", "As-built verified"}
READ_ACCESS = {"Viewer", "Editor", "Approver", "Owner"}
EDIT_ACCESS = {"Editor", "Owner"}
APPROVE_ACCESS = {"Approver", "Owner"}
ALLOWED_MODEL_COMMANDS = {
    "model.rename", "object.create", "object.update", "object.retire", "object.clone",
    "relation.create", "relation.update", "relation.retire", "diagram.create",
    "diagram.membership.upsert", "diagram.membership.remove", "view.layout",
    "model.access.grant", "model.access.revoke", "change_set.create",
}
ALLOWED_CHANGE_COMMANDS = {
    "change_set.submit", "change_set.approve", "change_set.reject", "change_set.apply",
    "change_set.rebase", "change_set.supersede",
}


class ArchitectureDomainError(pv1_domain.PV1DomainError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _id() -> str:
    return str(uuid4())


def _hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _clean_text(value: Any, field: str, *, required: bool = False, limit: int = 160) -> str | None:
    if value is None:
        if required:
            raise ArchitectureDomainError("VALIDATION_FAILED", f"{field} is required.", details={"field": field})
        return None
    if not isinstance(value, str):
        raise ArchitectureDomainError("VALIDATION_FAILED", f"{field} must be text.", details={"field": field})
    value = value.strip()
    if required and not value:
        raise ArchitectureDomainError("VALIDATION_FAILED", f"{field} is required.", details={"field": field})
    if len(value) > limit:
        raise ArchitectureDomainError("VALIDATION_FAILED", f"{field} is too long.", details={"field": field})
    return value or None


def _list_of_text(value: Any, field: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(item, str) or not item.strip() for item in value):
        raise ArchitectureDomainError("VALIDATION_FAILED", f"{field} must be a list of non-empty strings.", details={"field": field})
    return list(dict.fromkeys(item.strip() for item in value))


def _json_object(value: Any, field: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ArchitectureDomainError("VALIDATION_FAILED", f"{field} must be an object.", details={"field": field})
    return value


def _serialize(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _object_dict(item: models.ArchitectureObject) -> dict[str, Any]:
    return {
        "id": item.id, "model_id": item.model_id, "kind": item.kind, "name": item.name,
        "description": item.description, "owner_id": item.owner_id, "lifecycle": item.lifecycle,
        "properties": item.properties or {}, "tags": item.tags or [], "revision": item.revision,
        "retired_at": _serialize(item.retired_at),
    }


def _relation_dict(item: models.ArchitectureRelation) -> dict[str, Any]:
    return {
        "id": item.id, "model_id": item.model_id, "source_id": item.source_id, "target_id": item.target_id,
        "relation_type": item.relation_type, "name": item.name, "description": item.description,
        "properties": item.properties or {}, "revision": item.revision, "retired_at": _serialize(item.retired_at),
    }


def _diagram_dict(item: models.ArchitectureDiagram, memberships: list[models.ArchitectureDiagramMembership]) -> dict[str, Any]:
    return {
        "id": item.id, "model_id": item.model_id, "name": item.name, "level": item.level,
        "filters": item.filters or {}, "revision": item.revision,
        "memberships": [{
            "id": membership.id, "entity_kind": membership.entity_kind, "entity_id": membership.entity_id,
            "x": membership.x, "y": membership.y, "width": membership.width, "height": membership.height,
            "metadata": membership.metadata_json or {}, "revision": membership.revision,
        } for membership in memberships],
    }


def _changeset_dict(item: models.ArchitectureChangeSet, operations: list[models.ArchitectureChangeOperation]) -> dict[str, Any]:
    return {
        "id": item.id, "model_id": item.model_id, "project_id": item.project_id, "owner_id": item.owner_id,
        "base_model_revision": item.base_model_revision, "base_entity_revisions": item.base_entity_revisions or {},
        "state": item.state, "revision": item.revision, "approver_id": item.approver_id,
        "conflict_metadata": item.conflict_metadata or {}, "applied_model_revision": item.applied_model_revision,
        "submitted_at": _serialize(item.submitted_at), "approved_at": _serialize(item.approved_at),
        "applied_at": _serialize(item.applied_at),
        "operations": [{"id": op.id, "sequence": op.sequence, "op_type": op.op_type, "target_id": op.target_id, "payload": op.payload or {}, "revision": op.revision} for op in operations],
    }


def _is_admin(request_role: str | None) -> bool:
    return (request_role or "").upper() == "ADMIN"


async def _access(session: AsyncSession, tenant_id: int, model_id: str, actor_id: str, request_role: str | None) -> str | None:
    if _is_admin(request_role):
        return "Tenant administrator"
    result = await session.execute(select(models.ArchitectureAccess).where(
        models.ArchitectureAccess.tenant_id == tenant_id,
        models.ArchitectureAccess.model_id == model_id,
        models.ArchitectureAccess.user_id == actor_id,
    ))
    item = result.scalar_one_or_none()
    return item.role if item else None


async def require_model_access(session: AsyncSession, *, tenant_id: int, model_id: str, actor_id: str, request_role: str | None, write: bool = False, approve: bool = False) -> tuple[models.ArchitectureModel, str]:
    result = await session.execute(select(models.ArchitectureModel).where(models.ArchitectureModel.tenant_id == tenant_id, models.ArchitectureModel.id == model_id))
    model = result.scalar_one_or_none()
    if not model:
        raise ArchitectureDomainError("NOT_FOUND", "Architecture model not found.", http_status=status.HTTP_404_NOT_FOUND)
    access = await _access(session, tenant_id, model_id, actor_id, request_role)
    allowed = APPROVE_ACCESS if approve else EDIT_ACCESS if write else READ_ACCESS
    if access is None or (access != "Tenant administrator" and access not in allowed):
        raise ArchitectureDomainError("FORBIDDEN", "You do not have access to this Architecture model.", http_status=status.HTTP_403_FORBIDDEN)
    return model, access


async def _command_start(session: AsyncSession, *, tenant_id: int, actor_id: str, command_type: str, command_id: str, request_body: Any) -> models.ArchitectureCommand | None:
    request_hash = _hash(request_body)
    result = await session.execute(select(models.ArchitectureCommand).where(
        models.ArchitectureCommand.tenant_id == tenant_id,
        models.ArchitectureCommand.actor_id == actor_id,
        models.ArchitectureCommand.command_type == command_type,
        models.ArchitectureCommand.command_id == command_id,
    ))
    existing = result.scalar_one_or_none()
    if existing:
        if existing.request_hash != request_hash:
            raise ArchitectureDomainError("IDEMPOTENCY_CONFLICT", "The command id was already used with a different request body.", http_status=status.HTTP_409_CONFLICT)
        if existing.status == "applied":
            return existing
        raise ArchitectureDomainError("COMMAND_IN_PROGRESS", "The command is already being processed.", http_status=status.HTTP_409_CONFLICT, retryable=True)
    record = models.ArchitectureCommand(
        id=_id(), tenant_id=tenant_id, actor_id=actor_id, command_type=command_type,
        command_id=command_id, request_hash=request_hash, status="pending", response_json={},
        expires_at=_now() + timedelta(hours=72),
    )
    try:
        async with session.begin_nested():
            session.add(record)
            await session.flush()
    except IntegrityError:
        raise ArchitectureDomainError("IDEMPOTENCY_CONFLICT", "The command id was concurrently used; retry with the original response.", http_status=status.HTTP_409_CONFLICT, retryable=True)
    return None


async def _command_finish(session: AsyncSession, *, tenant_id: int, actor_id: str, command_type: str, command_id: str, response: dict[str, Any], event_id: str | None) -> None:
    result = await session.execute(select(models.ArchitectureCommand).where(
        models.ArchitectureCommand.tenant_id == tenant_id, models.ArchitectureCommand.actor_id == actor_id,
        models.ArchitectureCommand.command_type == command_type, models.ArchitectureCommand.command_id == command_id,
    ))
    record = result.scalar_one()
    record.status = "applied"
    record.response_json = response
    record.event_id = event_id


async def _append_event(session: AsyncSession, *, tenant_id: int, model_id: str, actor_id: str, command_id: str, event_type: str, aggregate_id: str, aggregate_revision: int, delta: dict[str, Any]) -> str:
    result = await session.execute(select(func.max(models.ArchitectureEvent.sequence)).where(models.ArchitectureEvent.tenant_id == tenant_id, models.ArchitectureEvent.model_id == model_id))
    sequence = int(result.scalar_one() or 0) + 1
    event_id = _id()
    session.add(models.ArchitectureEvent(
        event_id=event_id, tenant_id=tenant_id, model_id=model_id, sequence=sequence,
        actor_id=actor_id, event_type=event_type, command_id=command_id, aggregate_id=aggregate_id,
        aggregate_revision=aggregate_revision, delta=delta,
    ))
    session.add(models.ArchitectureOutbox(
        id=_id(), tenant_id=tenant_id, event_id=event_id, topic=f"architecture.{event_type}",
        payload={"event_id": event_id, "model_id": model_id, "sequence": sequence, "type": event_type, "aggregate_id": aggregate_id},
    ))
    return event_id


async def _get_object(session: AsyncSession, tenant_id: int, model_id: str, object_id: str, *, include_retired: bool = False) -> models.ArchitectureObject | None:
    statement = select(models.ArchitectureObject).where(models.ArchitectureObject.tenant_id == tenant_id, models.ArchitectureObject.model_id == model_id, models.ArchitectureObject.id == object_id)
    if not include_retired:
        statement = statement.where(models.ArchitectureObject.retired_at.is_(None))
    return (await session.execute(statement)).scalar_one_or_none()


async def _get_relation(session: AsyncSession, tenant_id: int, model_id: str, relation_id: str, *, include_retired: bool = False) -> models.ArchitectureRelation | None:
    statement = select(models.ArchitectureRelation).where(models.ArchitectureRelation.tenant_id == tenant_id, models.ArchitectureRelation.model_id == model_id, models.ArchitectureRelation.id == relation_id)
    if not include_retired:
        statement = statement.where(models.ArchitectureRelation.retired_at.is_(None))
    return (await session.execute(statement)).scalar_one_or_none()


async def _touch_model(session: AsyncSession, model: models.ArchitectureModel, actor_id: str) -> None:
    model.revision += 1
    model.updated_by = actor_id


async def create_model(session: AsyncSession, *, tenant_id: int, actor_id: str, request_role: str | None, command_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    if not _is_admin(request_role):
        raise ArchitectureDomainError("FORBIDDEN", "Only a tenant administrator can create an Architecture model.", http_status=status.HTTP_403_FORBIDDEN)
    existing = await _command_start(session, tenant_id=tenant_id, actor_id=actor_id, command_type="architecture.model.create", command_id=command_id, request_body=payload)
    if existing:
        return existing.response_json
    name = _clean_text(payload.get("name"), "name", required=True)
    model = models.ArchitectureModel(id=str(payload.get("id") or _id()), tenant_id=tenant_id, name=name or "", description=_clean_text(payload.get("description"), "description", limit=2000), owner_id=actor_id, schema_version="pv1.architecture.v1", lifecycle="Current", revision=1, created_by=actor_id, updated_by=actor_id)
    session.add(model)
    await session.flush()
    diagram = models.ArchitectureDiagram(id=str(payload.get("diagram_id") or _id()), tenant_id=tenant_id, model_id=model.id, name="Context", level="Context", filters={}, revision=1, created_by=actor_id, updated_by=actor_id)
    session.add(diagram)
    await session.flush()
    event_id = await _append_event(session, tenant_id=tenant_id, model_id=model.id, actor_id=actor_id, command_id=command_id, event_type="model.created", aggregate_id=model.id, aggregate_revision=1, delta={"model_id": model.id, "diagram_id": diagram.id})
    response = {"status": "applied", "command_id": command_id, "model_revision": 1, "model": {"id": model.id, "name": model.name, "description": model.description, "owner_id": model.owner_id, "revision": model.revision, "schema_version": model.schema_version}, "diagram": {"id": diagram.id, "name": diagram.name, "level": diagram.level, "revision": diagram.revision}, "event_id": event_id}
    await _command_finish(session, tenant_id=tenant_id, actor_id=actor_id, command_type="architecture.model.create", command_id=command_id, response=response, event_id=event_id)
    return response


async def _capture_base_revisions(session: AsyncSession, tenant_id: int, model_id: str, operations: list[dict[str, Any]]) -> dict[str, int | None]:
    ids = [str(op.get("target_id") or op.get("id") or op.get("payload", {}).get("id") or "") for op in operations]
    ids = [item for item in ids if item]
    result = await session.execute(select(models.ArchitectureObject.id, models.ArchitectureObject.revision).where(models.ArchitectureObject.tenant_id == tenant_id, models.ArchitectureObject.model_id == model_id, models.ArchitectureObject.id.in_(ids)))
    revisions: dict[str, int | None] = {row[0]: row[1] for row in result.all()}
    result = await session.execute(select(models.ArchitectureRelation.id, models.ArchitectureRelation.revision).where(models.ArchitectureRelation.tenant_id == tenant_id, models.ArchitectureRelation.model_id == model_id, models.ArchitectureRelation.id.in_(ids)))
    revisions.update({row[0]: row[1] for row in result.all()})
    return {item: revisions.get(item) for item in ids}


def _normalize_operation(raw: dict[str, Any], sequence: int) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ArchitectureDomainError("VALIDATION_FAILED", "Each change-set operation must be an object.")
    op_type = str(raw.get("op_type") or raw.get("type") or "").strip()
    aliases = {"add_object": "object.create", "update_object": "object.update", "retire_object": "object.retire", "add_relation": "relation.create", "update_relation": "relation.update", "retire_relation": "relation.retire"}
    op_type = aliases.get(op_type, op_type)
    if op_type not in {"object.create", "object.update", "object.retire", "relation.create", "relation.update", "relation.retire", "diagram.membership.upsert", "view.layout"}:
        raise ArchitectureDomainError("VALIDATION_FAILED", f"Unsupported change-set operation: {op_type}.")
    payload = _json_object(raw.get("payload") if "payload" in raw else raw, "operation.payload")
    target_id = str(raw.get("target_id") or payload.get("id") or _id())
    return {"sequence": sequence, "op_type": op_type, "target_id": target_id, "payload": payload}


async def create_change_set(session: AsyncSession, *, tenant_id: int, actor_id: str, request_role: str | None, command_id: str, model_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    model, _ = await require_model_access(session, tenant_id=tenant_id, model_id=model_id, actor_id=actor_id, request_role=request_role, write=True)
    project_id = _clean_text(payload.get("project_id"), "project_id", limit=80)
    if project_id:
        await pv1_domain.require_project_role(session, tenant_id=tenant_id, project_id=project_id, actor_id=actor_id, request_role=request_role)
    operations_raw = payload.get("operations") or []
    if not isinstance(operations_raw, list) or not operations_raw:
        raise ArchitectureDomainError("VALIDATION_FAILED", "A change set must contain at least one typed operation.", details={"field": "operations"})
    operations = [_normalize_operation(item, index + 1) for index, item in enumerate(operations_raw)]
    base_revision = payload.get("base_model_revision", model.revision)
    if not isinstance(base_revision, int) or base_revision < 1:
        raise ArchitectureDomainError("VALIDATION_FAILED", "base_model_revision must be a positive integer.")
    existing = await _command_start(session, tenant_id=tenant_id, actor_id=actor_id, command_type="architecture.change_set.create", command_id=command_id, request_body={"model_id": model_id, **payload})
    if existing:
        return existing.response_json
    base_entities = await _capture_base_revisions(session, tenant_id, model_id, operations)
    change_set = models.ArchitectureChangeSet(
        id=str(payload.get("id") or _id()), tenant_id=tenant_id, model_id=model_id, project_id=project_id,
        owner_id=actor_id, base_model_revision=base_revision, base_entity_revisions=base_entities,
        state="Draft", revision=1, conflict_metadata={}, created_by=actor_id, updated_by=actor_id,
    )
    session.add(change_set)
    await session.flush()
    for item in operations:
        session.add(models.ArchitectureChangeOperation(id=_id(), tenant_id=tenant_id, change_set_id=change_set.id, sequence=item["sequence"], op_type=item["op_type"], target_id=item["target_id"], payload=item["payload"], revision=1, created_by=actor_id, updated_by=actor_id))
    await session.flush()
    event_id = await _append_event(session, tenant_id=tenant_id, model_id=model_id, actor_id=actor_id, command_id=command_id, event_type="change_set.created", aggregate_id=change_set.id, aggregate_revision=change_set.revision, delta={"change_set_id": change_set.id, "base_model_revision": base_revision})
    response = {"status": "applied", "command_id": command_id, "change_set": _changeset_dict(change_set, sorted(change_set.operations if hasattr(change_set, "operations") else [], key=lambda item: item.sequence)) if False else {"id": change_set.id, "model_id": model_id, "project_id": change_set.project_id, "owner_id": actor_id, "base_model_revision": base_revision, "base_entity_revisions": base_entities, "state": change_set.state, "revision": 1, "operations": [{"sequence": item["sequence"], "op_type": item["op_type"], "target_id": item["target_id"], "payload": item["payload"]} for item in operations]}, "event_id": event_id}
    await _command_finish(session, tenant_id=tenant_id, actor_id=actor_id, command_type="architecture.change_set.create", command_id=command_id, response=response, event_id=event_id)
    return response


async def model_projection(session: AsyncSession, *, tenant_id: int, model_id: str, actor_id: str, request_role: str | None, mode: str = "current", change_set_id: str | None = None, project_id: str | None = None) -> dict[str, Any]:
    if project_id:
        await pv1_domain.require_project_role(session, tenant_id=tenant_id, project_id=project_id, actor_id=actor_id, request_role=request_role)
    model, access = await require_model_access(session, tenant_id=tenant_id, model_id=model_id, actor_id=actor_id, request_role=request_role)
    object_result = await session.execute(select(models.ArchitectureObject).where(models.ArchitectureObject.tenant_id == tenant_id, models.ArchitectureObject.model_id == model_id, models.ArchitectureObject.retired_at.is_(None)).order_by(models.ArchitectureObject.name, models.ArchitectureObject.id))
    relation_result = await session.execute(select(models.ArchitectureRelation).where(models.ArchitectureRelation.tenant_id == tenant_id, models.ArchitectureRelation.model_id == model_id, models.ArchitectureRelation.retired_at.is_(None)).order_by(models.ArchitectureRelation.id))
    diagram_result = await session.execute(select(models.ArchitectureDiagram).where(models.ArchitectureDiagram.tenant_id == tenant_id, models.ArchitectureDiagram.model_id == model_id, models.ArchitectureDiagram.retired_at.is_(None)).order_by(models.ArchitectureDiagram.name))
    object_items = [_object_dict(item) for item in object_result.scalars()]
    relation_items = [_relation_dict(item) for item in relation_result.scalars()]
    diagrams = []
    for diagram in diagram_result.scalars():
        memberships = (await session.execute(select(models.ArchitectureDiagramMembership).where(models.ArchitectureDiagramMembership.tenant_id == tenant_id, models.ArchitectureDiagramMembership.diagram_id == diagram.id).order_by(models.ArchitectureDiagramMembership.entity_kind, models.ArchitectureDiagramMembership.entity_id))).scalars().all()
        diagrams.append(_diagram_dict(diagram, list(memberships)))
    reserved_ids: list[str] = []
    if mode == "proposed" or change_set_id:
        if not change_set_id:
            raise ArchitectureDomainError("VALIDATION_FAILED", "A changeset is required for Proposed mode.")
        cs_result = await session.execute(select(models.ArchitectureChangeSet).where(models.ArchitectureChangeSet.tenant_id == tenant_id, models.ArchitectureChangeSet.id == change_set_id, models.ArchitectureChangeSet.model_id == model_id))
        change_set = cs_result.scalar_one_or_none()
        if not change_set:
            raise ArchitectureDomainError("NOT_FOUND", "Architecture change set not found.", http_status=status.HTTP_404_NOT_FOUND)
        if change_set.project_id and not project_id:
            await pv1_domain.require_project_role(session, tenant_id=tenant_id, project_id=change_set.project_id, actor_id=actor_id, request_role=request_role)
        ops = (await session.execute(select(models.ArchitectureChangeOperation).where(models.ArchitectureChangeOperation.tenant_id == tenant_id, models.ArchitectureChangeOperation.change_set_id == change_set.id).order_by(models.ArchitectureChangeOperation.sequence))).scalars().all()
        object_by_id = {item["id"]: item for item in object_items}
        relation_by_id = {item["id"]: item for item in relation_items}
        for op in ops:
            payload = op.payload or {}
            if op.op_type == "object.create":
                item = {"id": op.target_id, "model_id": model_id, "kind": payload.get("kind"), "name": payload.get("name", op.target_id), "description": payload.get("description"), "owner_id": payload.get("owner_id"), "lifecycle": payload.get("lifecycle", "Planned"), "properties": payload.get("properties", {}), "tags": payload.get("tags", []), "revision": 0, "retired_at": None}
                object_by_id[op.target_id] = item
                reserved_ids.append(op.target_id)
            elif op.op_type == "object.update" and op.target_id in object_by_id:
                object_by_id[op.target_id].update({key: payload[key] for key in ("name", "description", "owner_id", "lifecycle", "properties", "tags") if key in payload})
            elif op.op_type == "object.retire" and op.target_id in object_by_id:
                object_by_id.pop(op.target_id, None)
            elif op.op_type == "relation.create":
                relation_by_id[op.target_id] = {"id": op.target_id, "model_id": model_id, "source_id": payload.get("source_id"), "target_id": payload.get("target_id"), "relation_type": payload.get("relation_type", "Depends on"), "name": payload.get("name"), "description": payload.get("description"), "properties": payload.get("properties", {}), "revision": 0, "retired_at": None}
            elif op.op_type == "relation.update" and op.target_id in relation_by_id:
                relation_by_id[op.target_id].update({key: payload[key] for key in ("relation_type", "name", "description", "properties") if key in payload})
            elif op.op_type == "relation.retire":
                relation_by_id.pop(op.target_id, None)
        object_items, relation_items = list(object_by_id.values()), list(relation_by_id.values())
    if mode == "impact" and project_id:
        association_result = await session.execute(select(models.ArchitectureAssociation).where(models.ArchitectureAssociation.tenant_id == tenant_id, models.ArchitectureAssociation.project_id == project_id, models.ArchitectureAssociation.model_id == model_id))
        association = association_result.scalar_one_or_none()
        from . import traceability
        selected = set(await traceability.project_architecture_object_ids(session, tenant_id=tenant_id, project_id=project_id, model_id=model_id))
        selected_relations = set((association.relation_ids if association else []) or [])
        for relation in relation_items:
            if relation["source_id"] in selected or relation["target_id"] in selected:
                selected_relations.add(relation["id"])
                selected.update({relation["source_id"], relation["target_id"]})
        object_items = [item for item in object_items if item["id"] in selected]
        relation_items = [item for item in relation_items if item["id"] in selected_relations]
    return {
        "model": {"id": model.id, "name": model.name, "description": model.description, "owner_id": model.owner_id, "schema_version": model.schema_version, "lifecycle": model.lifecycle, "revision": model.revision},
        "mode": mode, "objects": object_items, "relations": relation_items, "diagrams": diagrams,
        "reserved_object_ids": reserved_ids, "capabilities": {"read": access in READ_ACCESS or access == "Tenant administrator", "edit": access in EDIT_ACCESS or access == "Tenant administrator", "approve": access in APPROVE_ACCESS or access == "Tenant administrator", "apply": access in EDIT_ACCESS or access == "Tenant administrator"},
        "legacy_compatibility": {"data_flows_readable": True, "authority": "pv1_architecture"},
    }


async def _apply_direct_operation(session: AsyncSession, *, tenant_id: int, model: models.ArchitectureModel, actor_id: str, command_id: str, op_type: str, target_id: str, payload: dict[str, Any], touch_model: bool = True) -> dict[str, Any]:
    if op_type == "model.rename":
        model.name = _clean_text(payload.get("name"), "name", required=True) or model.name
        model.description = _clean_text(payload.get("description"), "description", limit=2000)
        if touch_model:
            await _touch_model(session, model, actor_id)
        return {"kind": "model", "id": model.id, "revision": model.revision}
    if op_type == "object.create":
        kind = _clean_text(payload.get("kind"), "kind", required=True)
        if kind not in OBJECT_KINDS:
            raise ArchitectureDomainError("VALIDATION_FAILED", "Unsupported Architecture object kind.", details={"field": "kind", "allowed": sorted(OBJECT_KINDS)})
        if await _get_object(session, tenant_id, model.id, target_id, include_retired=True):
            raise ArchitectureDomainError("CONFLICT", "Architecture object id already exists.", http_status=status.HTTP_409_CONFLICT)
        item = models.ArchitectureObject(id=target_id, tenant_id=tenant_id, model_id=model.id, kind=kind, name=_clean_text(payload.get("name"), "name", required=True) or target_id, description=_clean_text(payload.get("description"), "description", limit=2000), owner_id=_clean_text(payload.get("owner_id"), "owner_id", limit=200), lifecycle=_clean_text(payload.get("lifecycle", "Current"), "lifecycle", limit=32) or "Current", properties=_json_object(payload.get("properties"), "properties"), tags=_list_of_text(payload.get("tags"), "tags"), revision=1, created_by=actor_id, updated_by=actor_id)
        if item.lifecycle not in LIFECYCLES:
            raise ArchitectureDomainError("VALIDATION_FAILED", "Unsupported object lifecycle.")
        session.add(item)
        if touch_model:
            await _touch_model(session, model, actor_id)
        return {"kind": "object", "id": item.id, "revision": item.revision}
    if op_type in {"object.update", "object.retire", "object.clone"}:
        item = await _get_object(session, tenant_id, model.id, target_id)
        if not item:
            raise ArchitectureDomainError("NOT_FOUND", "Architecture object not found.", http_status=status.HTTP_404_NOT_FOUND)
        expected_revision = payload.get("expected_revision")
        if expected_revision is not None and expected_revision != item.revision:
            raise ArchitectureDomainError("REVISION_CONFLICT", "Architecture object revision is stale.", http_status=status.HTTP_409_CONFLICT, details={"current_revisions": {target_id: item.revision}})
        if op_type == "object.clone":
            clone_id = str(payload.get("clone_id") or _id())
            clone = models.ArchitectureObject(id=clone_id, tenant_id=tenant_id, model_id=model.id, kind=item.kind, name=_clean_text(payload.get("name"), "name", limit=160) or f"{item.name} copy", description=item.description, owner_id=item.owner_id, lifecycle="Planned", properties=dict(item.properties or {}), tags=list(item.tags or []), revision=1, created_by=actor_id, updated_by=actor_id)
            session.add(clone)
            if touch_model:
                await _touch_model(session, model, actor_id)
            return {"kind": "object", "id": clone.id, "revision": clone.revision, "cloned_from": item.id}
        if op_type == "object.retire":
            item.retired_at = _now()
            item.lifecycle = "Retired"
        else:
            for field in ("name", "description", "owner_id", "lifecycle"):
                if field in payload:
                    value = _clean_text(payload[field], field, limit=2000 if field == "description" else 160)
                    if field == "lifecycle" and value not in LIFECYCLES:
                        raise ArchitectureDomainError("VALIDATION_FAILED", "Unsupported object lifecycle.")
                    setattr(item, field, value)
            if "properties" in payload:
                item.properties = _json_object(payload["properties"], "properties")
            if "tags" in payload:
                item.tags = _list_of_text(payload["tags"], "tags")
        item.revision += 1
        item.updated_by = actor_id
        if touch_model:
            await _touch_model(session, model, actor_id)
        return {"kind": "object", "id": item.id, "revision": item.revision}
    if op_type in {"relation.create", "relation.update", "relation.retire"}:
        if op_type == "relation.create":
            source_id = str(payload.get("source_id") or "")
            target_id = str(payload.get("target_id") or "")
            if not source_id or not target_id or source_id == target_id:
                raise ArchitectureDomainError("VALIDATION_FAILED", "A relation requires two distinct object IDs.")
            source = await _get_object(session, tenant_id, model.id, source_id)
            target = await _get_object(session, tenant_id, model.id, target_id)
            if not source or not target:
                raise ArchitectureDomainError("VALIDATION_FAILED", "Relation endpoints must be active objects in the same model.")
            relation_type = _clean_text(payload.get("relation_type", "Depends on"), "relation_type", required=True, limit=40) or "Depends on"
            if relation_type not in RELATION_TYPES:
                raise ArchitectureDomainError("VALIDATION_FAILED", "Unsupported relation type.", details={"field": "relation_type", "allowed": sorted(RELATION_TYPES)})
            relation = models.ArchitectureRelation(id=str(payload.get("id") or _id()), tenant_id=tenant_id, model_id=model.id, source_id=source_id, target_id=target_id, relation_type=relation_type, name=_clean_text(payload.get("name"), "name"), description=_clean_text(payload.get("description"), "description", limit=2000), properties=_json_object(payload.get("properties"), "properties"), revision=1, created_by=actor_id, updated_by=actor_id)
            session.add(relation)
            if touch_model:
                await _touch_model(session, model, actor_id)
            return {"kind": "relation", "id": relation.id, "revision": relation.revision}
        relation = await _get_relation(session, tenant_id, model.id, target_id)
        if not relation:
            raise ArchitectureDomainError("NOT_FOUND", "Architecture relation not found.", http_status=status.HTTP_404_NOT_FOUND)
        if payload.get("expected_revision") is not None and payload["expected_revision"] != relation.revision:
            raise ArchitectureDomainError("REVISION_CONFLICT", "Architecture relation revision is stale.", http_status=status.HTTP_409_CONFLICT, details={"current_revisions": {target_id: relation.revision}})
        if op_type == "relation.retire":
            relation.retired_at = _now()
        else:
            for field in ("relation_type", "name", "description"):
                if field in payload:
                    setattr(relation, field, _clean_text(payload[field], field, limit=2000 if field == "description" else 160))
            if relation.relation_type not in RELATION_TYPES:
                raise ArchitectureDomainError("VALIDATION_FAILED", "Unsupported relation type.")
            if "properties" in payload:
                relation.properties = _json_object(payload["properties"], "properties")
        relation.revision += 1
        relation.updated_by = actor_id
        if touch_model:
            await _touch_model(session, model, actor_id)
        return {"kind": "relation", "id": relation.id, "revision": relation.revision}
    if op_type == "diagram.create":
        level = _clean_text(payload.get("level", "Context"), "level", limit=32) or "Context"
        if level not in DIAGRAM_LEVELS:
            raise ArchitectureDomainError("VALIDATION_FAILED", "Unsupported diagram level.")
        diagram = models.ArchitectureDiagram(id=target_id, tenant_id=tenant_id, model_id=model.id, name=_clean_text(payload.get("name"), "name", required=True) or target_id, level=level, filters=_json_object(payload.get("filters"), "filters"), revision=1, created_by=actor_id, updated_by=actor_id)
        session.add(diagram)
        if touch_model:
            await _touch_model(session, model, actor_id)
        return {"kind": "diagram", "id": diagram.id, "revision": diagram.revision}
    if op_type in {"diagram.membership.upsert", "diagram.membership.remove", "view.layout"}:
        diagram_id = str(payload.get("diagram_id") or "")
        diagram_result = await session.execute(select(models.ArchitectureDiagram).where(models.ArchitectureDiagram.tenant_id == tenant_id, models.ArchitectureDiagram.model_id == model.id, models.ArchitectureDiagram.id == diagram_id))
        diagram = diagram_result.scalar_one_or_none()
        if not diagram:
            raise ArchitectureDomainError("NOT_FOUND", "Architecture diagram not found.", http_status=status.HTTP_404_NOT_FOUND)
        entity_kind = str(payload.get("entity_kind") or "object")
        entity_id = str(payload.get("entity_id") or target_id)
        membership_result = await session.execute(select(models.ArchitectureDiagramMembership).where(models.ArchitectureDiagramMembership.tenant_id == tenant_id, models.ArchitectureDiagramMembership.diagram_id == diagram_id, models.ArchitectureDiagramMembership.entity_kind == entity_kind, models.ArchitectureDiagramMembership.entity_id == entity_id))
        membership = membership_result.scalar_one_or_none()
        if op_type == "diagram.membership.remove":
            if membership:
                await session.delete(membership)
        else:
            if not membership:
                membership = models.ArchitectureDiagramMembership(id=_id(), tenant_id=tenant_id, diagram_id=diagram_id, entity_kind=entity_kind, entity_id=entity_id, revision=1, created_by=actor_id, updated_by=actor_id)
                session.add(membership)
            for field in ("x", "y", "width", "height"):
                if field in payload:
                    value = payload[field]
                    if not isinstance(value, int) or value < 0:
                        raise ArchitectureDomainError("VALIDATION_FAILED", f"{field} must be a non-negative integer.")
                    setattr(membership, field, value)
            if "metadata" in payload:
                membership.metadata_json = _json_object(payload["metadata"], "metadata")
            membership.revision += 1
            membership.updated_by = actor_id
        diagram.revision += 1
        diagram.updated_by = actor_id
        await _touch_model(session, model, actor_id)
        return {"kind": "diagram", "id": diagram.id, "revision": diagram.revision}
    if op_type in {"model.access.grant", "model.access.revoke"}:
        user_id = _clean_text(payload.get("user_id"), "user_id", required=True, limit=200) or ""
        access_result = await session.execute(select(models.ArchitectureAccess).where(models.ArchitectureAccess.tenant_id == tenant_id, models.ArchitectureAccess.model_id == model.id, models.ArchitectureAccess.user_id == user_id))
        access = access_result.scalar_one_or_none()
        if op_type == "model.access.revoke":
            if access:
                await session.delete(access)
        else:
            role = _clean_text(payload.get("role", "Viewer"), "role", limit=24) or "Viewer"
            if role not in READ_ACCESS:
                raise ArchitectureDomainError("VALIDATION_FAILED", "Unsupported Architecture access role.")
            if not access:
                access = models.ArchitectureAccess(id=_id(), tenant_id=tenant_id, model_id=model.id, user_id=user_id, role=role, revision=1, created_by=actor_id, updated_by=actor_id)
                session.add(access)
            else:
                access.role = role
                access.revision += 1
                access.updated_by = actor_id
        await _touch_model(session, model, actor_id)
        return {"kind": "access", "id": user_id, "revision": model.revision}
    raise ArchitectureDomainError("VALIDATION_FAILED", f"Unsupported Architecture command: {op_type}.")


async def execute_model_command(session: AsyncSession, *, tenant_id: int, actor_id: str, request_role: str | None, model_id: str, command_id: str, command_type: str, expected: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    normalized_type = command_type.removeprefix("architecture.")
    if normalized_type in {"change_set.create", "changeset.create"}:
        return await create_change_set(session, tenant_id=tenant_id, actor_id=actor_id, request_role=request_role, command_id=command_id, model_id=model_id, payload=payload)
    if normalized_type not in ALLOWED_MODEL_COMMANDS:
        raise ArchitectureDomainError("VALIDATION_FAILED", f"Unsupported Architecture command: {command_type}.")
    model, access = await require_model_access(session, tenant_id=tenant_id, model_id=model_id, actor_id=actor_id, request_role=request_role, write=True)
    if normalized_type.startswith("model.access.") and access != "Tenant administrator":
        raise ArchitectureDomainError("FORBIDDEN", "Only a tenant administrator can change Architecture access.", http_status=status.HTTP_403_FORBIDDEN)
    existing = await _command_start(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, request_body={"model_id": model_id, "expected": expected, "payload": payload})
    if existing:
        return existing.response_json
    if expected.get("model_revision") is not None and expected["model_revision"] != model.revision:
        raise ArchitectureDomainError("REVISION_CONFLICT", "Architecture model revision is stale.", http_status=status.HTTP_409_CONFLICT, details={"current_revisions": {model.id: model.revision}})
    target_id = str(payload.get("id") or payload.get("object_id") or payload.get("relation_id") or payload.get("diagram_id") or _id())
    changed = await _apply_direct_operation(session, tenant_id=tenant_id, model=model, actor_id=actor_id, command_id=command_id, op_type=normalized_type, target_id=target_id, payload=payload)
    event_id = await _append_event(session, tenant_id=tenant_id, model_id=model.id, actor_id=actor_id, command_id=command_id, event_type=normalized_type, aggregate_id=changed["id"], aggregate_revision=int(changed.get("revision") or model.revision), delta={"command": normalized_type, "changed": changed})
    response = {"status": "applied", "command_id": command_id, "model_revision": model.revision, "changed_entities": [changed], "event_id": event_id}
    await _command_finish(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, response=response, event_id=event_id)
    return response


async def _load_changeset(session: AsyncSession, tenant_id: int, change_set_id: str) -> tuple[models.ArchitectureChangeSet, models.ArchitectureModel, list[models.ArchitectureChangeOperation]]:
    result = await session.execute(select(models.ArchitectureChangeSet).where(models.ArchitectureChangeSet.tenant_id == tenant_id, models.ArchitectureChangeSet.id == change_set_id))
    change_set = result.scalar_one_or_none()
    if not change_set:
        raise ArchitectureDomainError("NOT_FOUND", "Architecture change set not found.", http_status=status.HTTP_404_NOT_FOUND)
    model_result = await session.execute(select(models.ArchitectureModel).where(models.ArchitectureModel.tenant_id == tenant_id, models.ArchitectureModel.id == change_set.model_id))
    model = model_result.scalar_one()
    operations = list((await session.execute(select(models.ArchitectureChangeOperation).where(models.ArchitectureChangeOperation.tenant_id == tenant_id, models.ArchitectureChangeOperation.change_set_id == change_set.id).order_by(models.ArchitectureChangeOperation.sequence))).scalars())
    return change_set, model, operations


async def _changeset_conflicts(session: AsyncSession, tenant_id: int, model_id: str, change_set: models.ArchitectureChangeSet, operations: list[models.ArchitectureChangeOperation]) -> list[dict[str, Any]]:
    conflicts = []
    base = change_set.base_entity_revisions or {}
    for op in operations:
        if op.op_type in {"object.create", "relation.create"}:
            continue
        expected = base.get(op.target_id)
        current_object = await _get_object(session, tenant_id, model_id, op.target_id, include_retired=True)
        current_relation = await _get_relation(session, tenant_id, model_id, op.target_id, include_retired=True)
        current = current_object or current_relation
        if current is None or expected is None or current.revision != expected:
            conflicts.append({"target_id": op.target_id, "expected_revision": expected, "current_revision": current.revision if current else None})
    return conflicts


async def execute_changeset_command(session: AsyncSession, *, tenant_id: int, actor_id: str, request_role: str | None, change_set_id: str, command_id: str, command_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    normalized_type = command_type.removeprefix("architecture.")
    if normalized_type not in ALLOWED_CHANGE_COMMANDS:
        raise ArchitectureDomainError("VALIDATION_FAILED", f"Unsupported change-set command: {command_type}.")
    change_set, model, operations = await _load_changeset(session, tenant_id, change_set_id)
    if change_set.project_id:
        await pv1_domain.require_project_role(session, tenant_id=tenant_id, project_id=change_set.project_id, actor_id=actor_id, request_role=request_role)
    if normalized_type == "change_set.approve":
        await require_model_access(session, tenant_id=tenant_id, model_id=model.id, actor_id=actor_id, request_role=request_role, approve=True)
    else:
        await require_model_access(session, tenant_id=tenant_id, model_id=model.id, actor_id=actor_id, request_role=request_role, write=True)
    existing = await _command_start(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, request_body={"change_set_id": change_set_id, "payload": payload})
    if existing:
        return existing.response_json
    event_id: str | None = None
    if normalized_type == "change_set.submit":
        if change_set.state != "Draft":
            raise ArchitectureDomainError("INVALID_STATE", "Only Draft change sets can be submitted.")
        change_set.state = "Submitted"
        change_set.submitted_at = _now()
    elif normalized_type == "change_set.approve":
        if change_set.state != "Submitted":
            raise ArchitectureDomainError("INVALID_STATE", "Only Submitted change sets can be approved.")
        if actor_id == change_set.owner_id:
            raise ArchitectureDomainError("SELF_APPROVAL_FORBIDDEN", "The change-set author cannot approve the same change set.", http_status=status.HTTP_403_FORBIDDEN)
        change_set.state = "Approved"
        change_set.approver_id = actor_id
        change_set.approved_at = _now()
    elif normalized_type == "change_set.reject":
        if change_set.state != "Submitted":
            raise ArchitectureDomainError("INVALID_STATE", "Only Submitted change sets can be rejected.")
        change_set.state = "Rejected"
        change_set.conflict_metadata = {"reason": _clean_text(payload.get("reason"), "reason", required=True, limit=2000)}
    elif normalized_type == "change_set.supersede":
        if change_set.state not in {"Draft", "Submitted", "Approved"}:
            raise ArchitectureDomainError("INVALID_STATE", "This change set cannot be superseded.")
        change_set.state = "Superseded"
    elif normalized_type == "change_set.rebase":
        if change_set.state not in {"Approved", "Submitted"}:
            raise ArchitectureDomainError("INVALID_STATE", "Only submitted or approved change sets can be rebased.")
        new_id = _id()
        base_entities = await _capture_base_revisions(session, tenant_id, model.id, [{"target_id": op.target_id} for op in operations])
        rebased = models.ArchitectureChangeSet(id=new_id, tenant_id=tenant_id, model_id=model.id, project_id=change_set.project_id, owner_id=actor_id, base_model_revision=model.revision, base_entity_revisions=base_entities, state="Draft", revision=1, conflict_metadata={"rebased_from": change_set.id}, created_by=actor_id, updated_by=actor_id)
        session.add(rebased)
        for op in operations:
            session.add(models.ArchitectureChangeOperation(id=_id(), tenant_id=tenant_id, change_set_id=new_id, sequence=op.sequence, op_type=op.op_type, target_id=op.target_id, payload=op.payload or {}, revision=1, created_by=actor_id, updated_by=actor_id))
        change_set.state = "Superseded"
        change_set.conflict_metadata = {"rebased_to": new_id}
        await session.flush()
        event_id = await _append_event(session, tenant_id=tenant_id, model_id=model.id, actor_id=actor_id, command_id=command_id, event_type="change_set.rebased", aggregate_id=new_id, aggregate_revision=model.revision, delta={"from": change_set.id, "to": new_id})
        response = {"status": "applied", "command_id": command_id, "change_set": {"id": new_id, "state": "Draft", "base_model_revision": model.revision, "rebased_from": change_set.id}, "event_id": event_id}
        await _command_finish(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, response=response, event_id=event_id)
        return response
    elif normalized_type == "change_set.apply":
        if change_set.state != "Approved":
            raise ArchitectureDomainError("INVALID_STATE", "Only Approved change sets can be applied.")
        conflicts = await _changeset_conflicts(session, tenant_id, model.id, change_set, operations)
        if conflicts:
            change_set.conflict_metadata = {"conflicts": conflicts, "current_model_revision": model.revision}
            raise ArchitectureDomainError("REBASE_REQUIRED", "The change set touches newer Architecture revisions; rebase is required before apply.", http_status=status.HTTP_409_CONFLICT, details={"conflicts": conflicts, "current_model_revision": model.revision})
        changed = []
        for op in operations:
            changed.append(await _apply_direct_operation(session, tenant_id=tenant_id, model=model, actor_id=actor_id, command_id=command_id, op_type=op.op_type, target_id=op.target_id, payload={**(op.payload or {}), "id": op.target_id}, touch_model=False))
        await _touch_model(session, model, actor_id)
        change_set.state = "Applied"
        change_set.applied_at = _now()
        change_set.applied_model_revision = model.revision
        event_id = await _append_event(session, tenant_id=tenant_id, model_id=model.id, actor_id=actor_id, command_id=command_id, event_type="change_set.applied", aggregate_id=change_set.id, aggregate_revision=model.revision, delta={"change_set_id": change_set.id, "changed": changed})
    change_set.revision += 1
    change_set.updated_by = actor_id
    await session.flush()
    if event_id is None:
        event_id = await _append_event(session, tenant_id=tenant_id, model_id=model.id, actor_id=actor_id, command_id=command_id, event_type=command_type, aggregate_id=change_set.id, aggregate_revision=change_set.revision, delta={"change_set_id": change_set.id, "state": change_set.state})
    response = {"status": "applied", "command_id": command_id, "change_set": {"id": change_set.id, "state": change_set.state, "revision": change_set.revision, "approver_id": change_set.approver_id, "applied_model_revision": change_set.applied_model_revision}, "model_revision": model.revision, "event_id": event_id}
    await _command_finish(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, response=response, event_id=event_id)
    return response


async def get_changeset(session: AsyncSession, *, tenant_id: int, actor_id: str, request_role: str | None, change_set_id: str) -> dict[str, Any]:
    change_set, model, operations = await _load_changeset(session, tenant_id, change_set_id)
    await require_model_access(session, tenant_id=tenant_id, model_id=model.id, actor_id=actor_id, request_role=request_role)
    if change_set.project_id:
        await pv1_domain.require_project_role(session, tenant_id=tenant_id, project_id=change_set.project_id, actor_id=actor_id, request_role=request_role)
    return _changeset_dict(change_set, operations)


async def associate_project(session: AsyncSession, *, tenant_id: int, actor_id: str, request_role: str | None, project_id: str, payload: dict[str, Any], command_id: str) -> dict[str, Any]:
    await pv1_domain.require_project_role(session, tenant_id=tenant_id, project_id=project_id, actor_id=actor_id, request_role=request_role, write=True)
    model_id = _clean_text(payload.get("model_id"), "model_id", required=True, limit=80) or ""
    await require_model_access(session, tenant_id=tenant_id, model_id=model_id, actor_id=actor_id, request_role=request_role)
    object_ids = _list_of_text(payload.get("object_ids"), "object_ids")
    relation_ids = _list_of_text(payload.get("relation_ids"), "relation_ids")
    impact_tags = _list_of_text(payload.get("impact_tags"), "impact_tags")
    if any(item not in IMPACT_TAGS for item in impact_tags):
        raise ArchitectureDomainError("VALIDATION_FAILED", "Unsupported impact tag.")
    for object_id in object_ids:
        if not await _get_object(session, tenant_id, model_id, object_id):
            raise ArchitectureDomainError("VALIDATION_FAILED", "Project association references an unknown Architecture object.", details={"object_id": object_id})
    for relation_id in relation_ids:
        if not await _get_relation(session, tenant_id, model_id, relation_id):
            raise ArchitectureDomainError("VALIDATION_FAILED", "Project association references an unknown Architecture relation.", details={"relation_id": relation_id})
    existing_result = await session.execute(select(models.ArchitectureAssociation).where(models.ArchitectureAssociation.tenant_id == tenant_id, models.ArchitectureAssociation.project_id == project_id, models.ArchitectureAssociation.model_id == model_id))
    association = existing_result.scalar_one_or_none()
    if not association:
        association = models.ArchitectureAssociation(id=_id(), tenant_id=tenant_id, project_id=project_id, model_id=model_id, revision=1, created_by=actor_id, updated_by=actor_id)
        session.add(association)
    association.diagram_id = payload.get("diagram_id")
    association.object_ids = object_ids
    association.relation_ids = relation_ids
    association.impact_tags = impact_tags
    association.changeset_id = payload.get("changeset_id")
    association.revision += 1
    association.updated_by = actor_id
    from . import traceability
    await traceability.sync_project_association_links(session, tenant_id=tenant_id, project_id=project_id, model_id=model_id, object_ids=object_ids, actor_id=actor_id)
    project = await pv1_domain.get_pv1_project(session, tenant_id, project_id)
    if project:
        project.revision += 1
        project.updated_by = actor_id
        await pv1_domain.append_event(session, tenant_id=tenant_id, project_id=project_id, actor_id=actor_id, command_id=command_id, event_type="architecture.associated", aggregate_type="project", aggregate_id=project_id, aggregate_revision=project.revision, delta={"model_id": model_id, "object_ids": object_ids, "relation_ids": relation_ids})
    await session.flush()
    return {"status": "applied", "association": {"id": association.id, "project_id": project_id, "model_id": model_id, "diagram_id": association.diagram_id, "object_ids": object_ids, "relation_ids": relation_ids, "impact_tags": impact_tags, "changeset_id": association.changeset_id, "revision": association.revision, "legacy_projection": {"object_ids": association.object_ids or [], "relation_ids": association.relation_ids or []}}}


async def project_architecture(session: AsyncSession, *, tenant_id: int, actor_id: str, request_role: str | None, project_id: str, mode: str = "impact", change_set_id: str | None = None) -> dict[str, Any]:
    await pv1_domain.require_project_role(session, tenant_id=tenant_id, project_id=project_id, actor_id=actor_id, request_role=request_role)
    result = await session.execute(select(models.ArchitectureAssociation).where(models.ArchitectureAssociation.tenant_id == tenant_id, models.ArchitectureAssociation.project_id == project_id))
    associations = list(result.scalars())
    projections = []
    for association in associations:
        projection = await model_projection(session, tenant_id=tenant_id, model_id=association.model_id, actor_id=actor_id, request_role=request_role, mode=mode, change_set_id=change_set_id, project_id=project_id)
        from . import traceability
        normalized_object_ids = await traceability.project_architecture_object_ids(session, tenant_id=tenant_id, project_id=project_id, model_id=association.model_id)
        projection["association"] = {"id": association.id, "model_id": association.model_id, "diagram_id": association.diagram_id, "object_ids": normalized_object_ids, "relation_ids": association.relation_ids or [], "impact_tags": association.impact_tags or [], "changeset_id": association.changeset_id, "revision": association.revision, "legacy_projection": {"object_ids": association.object_ids or [], "relation_ids": association.relation_ids or []}}
        projections.append(projection)
    return {"project_id": project_id, "mode": mode, "models": projections, "authority": "pv1_architecture", "source": "canonical-association"}


async def save_assessment(session: AsyncSession, *, tenant_id: int, actor_id: str, request_role: str | None, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    await pv1_domain.require_project_role(session, tenant_id=tenant_id, project_id=project_id, actor_id=actor_id, request_role=request_role, write=True)
    model_id = _clean_text(payload.get("model_id"), "model_id", required=True, limit=80) or ""
    model, _ = await require_model_access(session, tenant_id=tenant_id, model_id=model_id, actor_id=actor_id, request_role=request_role)
    state = _clean_text(payload.get("state"), "state", required=True, limit=32) or ""
    if state not in ASSESSMENTS:
        raise ArchitectureDomainError("VALIDATION_FAILED", "Unsupported Architecture assessment state.")
    rationale = _clean_text(payload.get("rationale"), "rationale", limit=4000)
    evidence = _list_of_text(payload.get("evidence_refs"), "evidence_refs")
    if state == "No impact" and not rationale:
        raise ArchitectureDomainError("VALIDATION_FAILED", "No impact requires a rationale.", details={"field": "rationale"})
    reviewer = _clean_text(payload.get("reviewer_id"), "reviewer_id", limit=200)
    applied_revision = payload.get("applied_model_revision")
    if state == "As-built verified":
        if not reviewer or reviewer == actor_id:
            raise ArchitectureDomainError("SELF_APPROVAL_FORBIDDEN", "As-built verification requires a distinct reviewer.", http_status=status.HTTP_403_FORBIDDEN)
        if not evidence:
            raise ArchitectureDomainError("VALIDATION_FAILED", "As-built verification requires evidence references.", details={"field": "evidence_refs"})
        if applied_revision != model.revision:
            raise ArchitectureDomainError("REVISION_CONFLICT", "As-built evidence must identify the current applied Architecture revision.", http_status=status.HTTP_409_CONFLICT, details={"current_model_revision": model.revision})
    result = await session.execute(select(models.ArchitectureAssessment).where(models.ArchitectureAssessment.tenant_id == tenant_id, models.ArchitectureAssessment.project_id == project_id, models.ArchitectureAssessment.model_id == model_id))
    assessment = result.scalar_one_or_none()
    if not assessment:
        assessment = models.ArchitectureAssessment(id=_id(), tenant_id=tenant_id, project_id=project_id, model_id=model_id, revision=1, created_by=actor_id, updated_by=actor_id)
        session.add(assessment)
    assessment.state = state
    assessment.rationale = rationale
    assessment.evidence_refs = evidence
    assessment.reviewer_id = reviewer
    assessment.applied_model_revision = applied_revision
    assessment.revision += 1
    assessment.updated_by = actor_id
    project = await pv1_domain.get_pv1_project(session, tenant_id, project_id)
    if project:
        project.architecture_assessment = state
        project.architecture_rationale = rationale
        project.revision += 1
        project.updated_by = actor_id
    await session.flush()
    return {"status": "applied", "assessment": {"id": assessment.id, "project_id": project_id, "model_id": model_id, "state": state, "rationale": rationale, "evidence_refs": evidence, "reviewer_id": reviewer, "applied_model_revision": applied_revision, "revision": assessment.revision}}
