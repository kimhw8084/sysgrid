"""Normalized asset, Architecture v2, and PV1 traceability services."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from fastapi import status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import models as legacy_models
from ..pv1 import domain as pv1_domain
from ..pv1 import models as pv1_models
from . import domain as architecture_domain
from . import models


ENTITY_ALIASES = {
    "project": "project",
    "Project": "project",
    "task": "task",
    "Task": "task",
    "outcome_acceptance": "outcome_acceptance",
    "OutcomeAcceptance": "outcome_acceptance",
    "delivery_acceptance": "delivery_acceptance",
    "DeliveryAcceptance": "delivery_acceptance",
    "outcome_checkpoint": "outcome_checkpoint",
    "OutcomeCheckpoint": "outcome_checkpoint",
    "architecture_change_set": "architecture_change_set",
    "change_set": "architecture_change_set",
    "ArchitectureChangeSet": "architecture_change_set",
}
TARGET_KINDS = {"device", "architecture_object"}


def _error(code: str, message: str, *, http_status: int = 422, details: dict[str, Any] | None = None) -> architecture_domain.ArchitectureDomainError:
    return architecture_domain.ArchitectureDomainError(code, message, http_status=http_status, details=details)


def _text(value: Any, field: str, *, required: bool = False, limit: int = 40) -> str | None:
    if value is None:
        if required:
            raise _error("VALIDATION_FAILED", f"{field} is required.", details={"field": field})
        return None
    if not isinstance(value, str):
        raise _error("VALIDATION_FAILED", f"{field} must be text.", details={"field": field})
    value = value.strip()
    if required and not value:
        raise _error("VALIDATION_FAILED", f"{field} is required.", details={"field": field})
    if len(value) > limit:
        raise _error("VALIDATION_FAILED", f"{field} is too long.", details={"field": field})
    return value or None


def _serialize(value: Any) -> Any:
    return value.isoformat() if hasattr(value, "isoformat") else value


def _link_dict(link: pv1_models.PV1TraceabilityLink | models.ArchitectureDeviceLink) -> dict[str, Any]:
    result = {
        "id": link.id,
        "tenant_id": link.tenant_id,
        "relationship_type": link.relationship_type,
        "lifecycle": link.lifecycle,
        "retired_at": _serialize(link.retired_at),
        "revision": link.revision,
        "created_at": _serialize(link.created_at),
        "created_by": link.created_by,
        "updated_at": _serialize(link.updated_at),
        "updated_by": link.updated_by,
    }
    if isinstance(link, pv1_models.PV1TraceabilityLink):
        result.update({
            "entity_kind": link.entity_kind,
            "entity_id": link.entity_id,
            "project_id": link.project_id,
            "target_kind": link.target_kind,
            "target_key": link.target_key,
            "device_id": link.device_id,
            "architecture_object_id": link.architecture_object_id,
        })
    else:
        result.update({"device_id": link.device_id, "architecture_object_id": link.architecture_object_id})
    return result


def _device_dict(device: legacy_models.Device) -> dict[str, Any]:
    return {
        "id": device.id,
        "tenant_id": device.tenant_id,
        "name": device.name,
        "asset_tag": device.asset_tag,
        "system": device.system,
        "environment": device.environment,
        "status": device.status,
        "type": device.type,
        "is_deleted": bool(device.is_deleted),
    }


def _object_dict(obj: models.ArchitectureObject, model: models.ArchitectureModel | None = None) -> dict[str, Any]:
    return {
        "id": obj.id,
        "tenant_id": obj.tenant_id,
        "model_id": obj.model_id,
        "kind": obj.kind,
        "name": obj.name,
        "description": obj.description,
        "lifecycle": obj.lifecycle,
        "revision": obj.revision,
        "retired_at": _serialize(obj.retired_at),
        "model": {
            "id": model.id,
            "name": model.name,
            "schema_version": model.schema_version,
            "lifecycle": model.lifecycle,
            "revision": model.revision,
        } if model else None,
    }


async def _device(session: AsyncSession, tenant_id: int, device_id: Any, *, include_deleted: bool = False) -> legacy_models.Device:
    if isinstance(device_id, bool):
        raise _error("VALIDATION_FAILED", "device_id must be an integer.", details={"field": "device_id"})
    try:
        normalized_id = int(device_id)
    except (TypeError, ValueError) as exc:
        raise _error("VALIDATION_FAILED", "device_id must be an integer.", details={"field": "device_id"}) from exc
    result = await session.execute(select(legacy_models.Device).where(legacy_models.Device.tenant_id == tenant_id, legacy_models.Device.id == normalized_id))
    device = result.scalar_one_or_none()
    if not device or (device.is_deleted and not include_deleted):
        raise _error("INVALID_REFERENCE", "The Device reference is missing or retired.", details={"device_id": normalized_id})
    return device


async def _object(session: AsyncSession, tenant_id: int, object_id: Any, *, include_retired: bool = False) -> tuple[models.ArchitectureObject, models.ArchitectureModel]:
    normalized_id = _text(object_id, "architecture_object_id", required=True, limit=80) or ""
    result = await session.execute(select(models.ArchitectureObject).where(models.ArchitectureObject.tenant_id == tenant_id, models.ArchitectureObject.id == normalized_id))
    obj = result.scalar_one_or_none()
    if not obj or (obj.retired_at is not None and not include_retired):
        raise _error("INVALID_REFERENCE", "The ArchitectureObject reference is missing or retired.", details={"architecture_object_id": normalized_id})
    model_result = await session.execute(select(models.ArchitectureModel).where(models.ArchitectureModel.tenant_id == tenant_id, models.ArchitectureModel.id == obj.model_id))
    model = model_result.scalar_one_or_none()
    if not model:
        raise _error("DATA_INTEGRITY_ERROR", "The ArchitectureObject has no tenant-safe Architecture model.", details={"architecture_object_id": normalized_id})
    return obj, model


def _normalize_entity_kind(value: Any) -> str:
    if not isinstance(value, str) or value not in ENTITY_ALIASES:
        raise _error("VALIDATION_FAILED", "Unsupported traceability entity kind.", details={"allowed": sorted(set(ENTITY_ALIASES.values()))})
    return ENTITY_ALIASES[value]


async def _entity(session: AsyncSession, tenant_id: int, entity_kind: Any, entity_id: Any, *, actor_id: str, request_role: str | None, write: bool, allow_archived: bool = False) -> dict[str, Any]:
    kind = _normalize_entity_kind(entity_kind)
    normalized_id = _text(entity_id, "entity_id", required=True, limit=80) or ""
    project = None
    model_id = None
    label = normalized_id
    state = None
    if kind == "project":
        project = await pv1_domain.get_pv1_project(session, tenant_id, normalized_id)
        if not project:
            raise _error("INVALID_REFERENCE", "The PV1 Project reference is missing or belongs to another tenant.", details={"entity_id": normalized_id})
        await pv1_domain.require_project_role(session, tenant_id=tenant_id, project_id=project.id, actor_id=actor_id, request_role=request_role, write=write)
        label, state = project.name, project.phase
    elif kind == "task":
        task = await session.scalar(select(pv1_models.PV1Task).where(pv1_models.PV1Task.tenant_id == tenant_id, pv1_models.PV1Task.id == normalized_id))
        if not task:
            raise _error("INVALID_REFERENCE", "The PV1 Task reference is missing or belongs to another tenant.", details={"entity_id": normalized_id})
        project = await pv1_domain.get_pv1_project(session, tenant_id, task.project_id)
        if not project:
            raise _error("DATA_INTEGRITY_ERROR", "The PV1 Task has no tenant-safe Project parent.", details={"entity_id": normalized_id})
        await pv1_domain.require_project_role(session, tenant_id=tenant_id, project_id=project.id, actor_id=actor_id, request_role=request_role, write=write)
        label, state = task.title, task.status
    elif kind in {"outcome_acceptance", "delivery_acceptance", "outcome_checkpoint"}:
        entity_model = {
            "outcome_acceptance": pv1_models.PV1OutcomeAcceptance,
            "delivery_acceptance": pv1_models.PV1DeliveryAcceptance,
            "outcome_checkpoint": pv1_models.PV1OutcomeCheckpoint,
        }[kind]
        record = await session.scalar(select(entity_model).where(entity_model.tenant_id == tenant_id, entity_model.id == normalized_id))
        if not record:
            raise _error("INVALID_REFERENCE", "The PV1 outcome reference is missing or belongs to another tenant.", details={"entity_kind": kind, "entity_id": normalized_id})
        project = await pv1_domain.get_pv1_project(session, tenant_id, record.project_id)
        if not project:
            raise _error("DATA_INTEGRITY_ERROR", "The PV1 outcome record has no tenant-safe Project parent.", details={"entity_id": normalized_id})
        await pv1_domain.require_project_role(session, tenant_id=tenant_id, project_id=project.id, actor_id=actor_id, request_role=request_role, write=write)
        label = getattr(record, "kind", None) or getattr(record, "result", None) or kind
        state = getattr(record, "state", None) or getattr(record, "result", None)
    else:
        change_set = await session.scalar(select(models.ArchitectureChangeSet).where(models.ArchitectureChangeSet.tenant_id == tenant_id, models.ArchitectureChangeSet.id == normalized_id))
        if not change_set:
            raise _error("INVALID_REFERENCE", "The Architecture change-set reference is missing or belongs to another tenant.", details={"entity_id": normalized_id})
        model_id = change_set.model_id
        await architecture_domain.require_model_access(session, tenant_id=tenant_id, model_id=model_id, actor_id=actor_id, request_role=request_role, write=write)
        if change_set.project_id:
            project = await pv1_domain.get_pv1_project(session, tenant_id, change_set.project_id)
            if not project:
                raise _error("DATA_INTEGRITY_ERROR", "The Architecture change set has no tenant-safe Project parent.", details={"entity_id": normalized_id})
            await pv1_domain.require_project_role(session, tenant_id=tenant_id, project_id=project.id, actor_id=actor_id, request_role=request_role, write=write)
        label, state = "Architecture change set", change_set.state
    if write and project and project.archived_at is not None and not allow_archived:
        raise _error("INVALID_STATE", "Archived PV1 work cannot receive new traceability links.")
    return {"kind": kind, "id": normalized_id, "project_id": project.id if project else None, "model_id": model_id, "label": label, "state": state}


async def _target(session: AsyncSession, tenant_id: int, payload: dict[str, Any], *, actor_id: str, request_role: str | None, write: bool, include_retired: bool = False) -> dict[str, Any]:
    has_device = payload.get("device_id") is not None
    has_object = payload.get("architecture_object_id") is not None
    if has_device == has_object:
        raise _error("VALIDATION_FAILED", "Exactly one of device_id or architecture_object_id is required.", details={"fields": ["device_id", "architecture_object_id"]})
    if has_device:
        device = await _device(session, tenant_id, payload.get("device_id"), include_deleted=include_retired)
        return {"kind": "device", "key": str(device.id), "device": device, "object": None, "model": None}
    obj, model = await _object(session, tenant_id, payload.get("architecture_object_id"), include_retired=include_retired)
    await architecture_domain.require_model_access(session, tenant_id=tenant_id, model_id=model.id, actor_id=actor_id, request_role=request_role, write=write)
    return {"kind": "architecture_object", "key": obj.id, "device": None, "object": obj, "model": model}


async def _bump_project(session: AsyncSession, project_id: str, tenant_id: int, expected_revision: Any, actor_id: str) -> int | None:
    if not project_id:
        return None
    project = await pv1_domain.get_pv1_project(session, tenant_id, project_id)
    if not project:
        raise _error("DATA_INTEGRITY_ERROR", "The traceability entity has no tenant-safe Project parent.", details={"project_id": project_id})
    if expected_revision is not None:
        if not isinstance(expected_revision, int) or expected_revision < 1 or expected_revision != project.revision:
            raise _error("REVISION_CONFLICT", "The PV1 Project changed; review it before changing traceability.", http_status=status.HTTP_409_CONFLICT, details={"current_revisions": {"project_revision": project.revision}})
    result = await session.execute(update(pv1_models.PV1Project).where(pv1_models.PV1Project.tenant_id == tenant_id, pv1_models.PV1Project.id == project_id, pv1_models.PV1Project.revision == project.revision).values(revision=pv1_models.PV1Project.revision + 1, updated_by=actor_id, updated_at=architecture_domain._now()))
    if result.rowcount != 1:
        raise _error("REVISION_CONFLICT", "The PV1 Project changed during the traceability write.", http_status=status.HTTP_409_CONFLICT)
    return project.revision + 1


async def _finish_command(session: AsyncSession, *, tenant_id: int, actor_id: str, command_type: str, command_id: str, payload: dict[str, Any], response: dict[str, Any], event_id: str | None) -> dict[str, Any]:
    await architecture_domain._command_finish(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, response=response, event_id=event_id)
    return response


async def create_device_link(session: AsyncSession, *, tenant_id: int, actor_id: str, request_role: str | None, command_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("device_id") is None or payload.get("architecture_object_id") is None:
        raise _error("VALIDATION_FAILED", "A Device ↔ ArchitectureObject link requires both target identifiers.")
    relationship_type = _text(payload.get("relationship_type", "Represents"), "relationship_type", required=True) or "Represents"
    device = await _device(session, tenant_id, payload.get("device_id"))
    obj, model = await _object(session, tenant_id, payload.get("architecture_object_id"))
    await architecture_domain.require_model_access(session, tenant_id=tenant_id, model_id=model.id, actor_id=actor_id, request_role=request_role, write=True)
    command_type = "traceability.device_link.create"
    existing_command = await architecture_domain._command_start(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, request_body=payload)
    if existing_command:
        return existing_command.response_json
    existing = await session.scalar(select(models.ArchitectureDeviceLink).where(models.ArchitectureDeviceLink.tenant_id == tenant_id, models.ArchitectureDeviceLink.device_id == device.id, models.ArchitectureDeviceLink.architecture_object_id == obj.id))
    event_id = None
    if existing and existing.lifecycle == "Active":
        if existing.relationship_type != relationship_type:
            raise _error("CONFLICT", "The Device and ArchitectureObject are already linked with another relationship type.", http_status=status.HTTP_409_CONFLICT, details={"link_id": existing.id, "relationship_type": existing.relationship_type})
        response = {"status": "unchanged", "command_id": command_id, "link": _link_dict(existing), "model_revision": model.revision, "event_id": None}
        return await _finish_command(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, payload=payload, response=response, event_id=None)
    if existing:
        existing.lifecycle = "Active"
        existing.retired_at = None
        existing.relationship_type = relationship_type
        existing.revision += 1
        existing.updated_by = actor_id
        existing.updated_at = architecture_domain._now()
        link = existing
        event_type = "traceability.device_link.reactivated"
    else:
        link = models.ArchitectureDeviceLink(id=architecture_domain._id(), tenant_id=tenant_id, device_id=device.id, architecture_object_id=obj.id, relationship_type=relationship_type, lifecycle="Active", revision=1, created_by=actor_id, updated_by=actor_id)
        session.add(link)
        await session.flush()
        event_type = "traceability.device_link.created"
    await architecture_domain._touch_model(session, model, actor_id)
    event_id = await architecture_domain._append_event(session, tenant_id=tenant_id, model_id=model.id, actor_id=actor_id, command_id=command_id, event_type=event_type, aggregate_id=link.id, aggregate_revision=link.revision, delta={"device_id": device.id, "architecture_object_id": obj.id, "relationship_type": relationship_type, "lifecycle": link.lifecycle})
    response = {"status": "applied", "command_id": command_id, "link": _link_dict(link), "model_revision": model.revision, "event_id": event_id}
    return await _finish_command(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, payload=payload, response=response, event_id=event_id)


async def update_device_link(session: AsyncSession, *, tenant_id: int, actor_id: str, request_role: str | None, link_id: str, command_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    link = await session.scalar(select(models.ArchitectureDeviceLink).where(models.ArchitectureDeviceLink.tenant_id == tenant_id, models.ArchitectureDeviceLink.id == link_id))
    if not link:
        raise _error("NOT_FOUND", "Architecture Device link not found.", http_status=status.HTTP_404_NOT_FOUND)
    if link.lifecycle == "Retired":
        raise _error("INVALID_STATE", "Retired Architecture Device links cannot be edited; reactivate them by creating the same link.")
    device = await _device(session, tenant_id, link.device_id, include_deleted=True)
    if device.is_deleted:
        raise _error("INVALID_REFERENCE", "The Device reference is retired; the link can only be retained historically.", details={"device_id": device.id})
    obj, model = await _object(session, tenant_id, link.architecture_object_id, include_retired=True)
    if obj.retired_at is not None:
        raise _error("INVALID_REFERENCE", "The ArchitectureObject reference is retired; the link can only be retained historically.", details={"architecture_object_id": obj.id})
    await architecture_domain.require_model_access(session, tenant_id=tenant_id, model_id=model.id, actor_id=actor_id, request_role=request_role, write=True)
    expected_revision = payload.get("expected_revision")
    if not isinstance(expected_revision, int) or expected_revision != link.revision:
        raise _error("REVISION_CONFLICT", "The Architecture Device link changed; review it before saving.", http_status=status.HTTP_409_CONFLICT, details={"current_revisions": {"link_revision": link.revision}})
    relationship_type = _text(payload.get("relationship_type"), "relationship_type", required=True) or ""
    command_type = "traceability.device_link.update"
    existing_command = await architecture_domain._command_start(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, request_body={"link_id": link_id, **payload})
    if existing_command:
        return existing_command.response_json
    conflict = await session.scalar(select(models.ArchitectureDeviceLink).where(models.ArchitectureDeviceLink.tenant_id == tenant_id, models.ArchitectureDeviceLink.device_id == link.device_id, models.ArchitectureDeviceLink.architecture_object_id == link.architecture_object_id, models.ArchitectureDeviceLink.id != link.id))
    if conflict:
        raise _error("CONFLICT", "Another Device link already owns this target pair.", http_status=status.HTTP_409_CONFLICT, details={"link_id": conflict.id})
    link.relationship_type = relationship_type
    link.revision += 1
    link.updated_by = actor_id
    link.updated_at = architecture_domain._now()
    await architecture_domain._touch_model(session, model, actor_id)
    event_id = await architecture_domain._append_event(session, tenant_id=tenant_id, model_id=model.id, actor_id=actor_id, command_id=command_id, event_type="traceability.device_link.updated", aggregate_id=link.id, aggregate_revision=link.revision, delta={"relationship_type": relationship_type})
    response = {"status": "applied", "command_id": command_id, "link": _link_dict(link), "model_revision": model.revision, "event_id": event_id}
    return await _finish_command(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, payload=payload, response=response, event_id=event_id)


async def retire_device_link(session: AsyncSession, *, tenant_id: int, actor_id: str, request_role: str | None, link_id: str, command_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    link = await session.scalar(select(models.ArchitectureDeviceLink).where(models.ArchitectureDeviceLink.tenant_id == tenant_id, models.ArchitectureDeviceLink.id == link_id))
    if not link:
        raise _error("NOT_FOUND", "Architecture Device link not found.", http_status=status.HTTP_404_NOT_FOUND)
    await _device(session, tenant_id, link.device_id, include_deleted=True)
    obj, model = await _object(session, tenant_id, link.architecture_object_id, include_retired=True)
    await architecture_domain.require_model_access(session, tenant_id=tenant_id, model_id=model.id, actor_id=actor_id, request_role=request_role, write=True)
    expected_revision = payload.get("expected_revision")
    if expected_revision is not None and expected_revision != link.revision:
        raise _error("REVISION_CONFLICT", "The Architecture Device link changed; review it before retiring.", http_status=status.HTTP_409_CONFLICT, details={"current_revisions": {"link_revision": link.revision}})
    command_type = "traceability.device_link.retire"
    existing_command = await architecture_domain._command_start(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, request_body={"link_id": link_id, **payload})
    if existing_command:
        return existing_command.response_json
    if link.lifecycle == "Retired":
        response = {"status": "unchanged", "command_id": command_id, "link": _link_dict(link), "model_revision": model.revision, "event_id": None}
        return await _finish_command(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, payload=payload, response=response, event_id=None)
    link.lifecycle = "Retired"
    link.retired_at = architecture_domain._now()
    link.revision += 1
    link.updated_by = actor_id
    link.updated_at = architecture_domain._now()
    await architecture_domain._touch_model(session, model, actor_id)
    event_id = await architecture_domain._append_event(session, tenant_id=tenant_id, model_id=model.id, actor_id=actor_id, command_id=command_id, event_type=command_type, aggregate_id=link.id, aggregate_revision=link.revision, delta={"lifecycle": link.lifecycle})
    response = {"status": "applied", "command_id": command_id, "link": _link_dict(link), "model_revision": model.revision, "event_id": event_id}
    return await _finish_command(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, payload=payload, response=response, event_id=event_id)


async def sync_project_association_links(session: AsyncSession, *, tenant_id: int, project_id: str, model_id: str, object_ids: list[str], actor_id: str) -> None:
    """Make normalized Project→ArchitectureObject links authoritative for an association."""
    result = await session.execute(select(pv1_models.PV1TraceabilityLink).where(
        pv1_models.PV1TraceabilityLink.tenant_id == tenant_id,
        pv1_models.PV1TraceabilityLink.entity_kind == "project",
        pv1_models.PV1TraceabilityLink.entity_id == project_id,
        pv1_models.PV1TraceabilityLink.target_kind == "architecture_object",
        pv1_models.PV1TraceabilityLink.relationship_type == "Affected",
    ))
    candidate_links = list(result.scalars())
    if any(link.architecture_object_id is None for link in candidate_links):
        raise _error("DATA_INTEGRITY_ERROR", "A Project architecture association has a normalized link without an ArchitectureObject target.", details={"project_id": project_id})
    candidate_object_ids = {link.architecture_object_id for link in candidate_links if link.architecture_object_id}
    object_result = await session.execute(select(models.ArchitectureObject).where(models.ArchitectureObject.tenant_id == tenant_id, models.ArchitectureObject.id.in_(candidate_object_ids))) if candidate_object_ids else None
    candidate_objects = {obj.id: obj for obj in object_result.scalars().all()} if object_result else {}
    if len(candidate_objects) != len(candidate_object_ids):
        raise _error("DATA_INTEGRITY_ERROR", "A Project architecture association has a dangling or cross-tenant normalized link.", details={"project_id": project_id})
    links = [link for link in candidate_links if candidate_objects[link.architecture_object_id].model_id == model_id]
    by_object_id = {link.architecture_object_id: link for link in links}
    desired = set(object_ids)
    for object_id in desired:
        link = by_object_id.get(object_id)
        if link and link.lifecycle == "Active":
            continue
        if link:
            link.lifecycle = "Active"
            link.retired_at = None
            link.revision += 1
            link.updated_by = actor_id
            link.updated_at = architecture_domain._now()
        else:
            session.add(pv1_models.PV1TraceabilityLink(id=architecture_domain._id(), tenant_id=tenant_id, entity_kind="project", entity_id=project_id, project_id=project_id, target_kind="architecture_object", target_key=object_id, architecture_object_id=object_id, relationship_type="Affected", lifecycle="Active", revision=1, created_by=actor_id, updated_by=actor_id))
    for link in links:
        if link.architecture_object_id not in desired and link.lifecycle == "Active":
            link.lifecycle = "Retired"
            link.retired_at = architecture_domain._now()
            link.revision += 1
            link.updated_by = actor_id
            link.updated_at = architecture_domain._now()


async def _record_work_events(session: AsyncSession, *, tenant_id: int, actor_id: str, command_id: str, event_type: str, link: pv1_models.PV1TraceabilityLink, entity: dict[str, Any], model_id: str | None, project_revision: int | None) -> str | None:
    event_id = None
    if entity["project_id"]:
        event_id, _ = await pv1_domain.append_event(session, tenant_id=tenant_id, project_id=entity["project_id"], actor_id=actor_id, command_id=command_id, event_type=event_type, aggregate_type="traceability", aggregate_id=link.id, aggregate_revision=link.revision, delta={"entity_kind": link.entity_kind, "entity_id": link.entity_id, "target_kind": link.target_kind, "target_key": link.target_key, "lifecycle": link.lifecycle, "project_revision": project_revision})
    if model_id:
        architecture_event_id = await architecture_domain._append_event(session, tenant_id=tenant_id, model_id=model_id, actor_id=actor_id, command_id=command_id, event_type=event_type, aggregate_id=link.id, aggregate_revision=link.revision, delta={"entity_kind": link.entity_kind, "entity_id": link.entity_id, "target_kind": link.target_kind, "target_key": link.target_key, "lifecycle": link.lifecycle})
        event_id = event_id or architecture_event_id
    return event_id


async def create_work_link(session: AsyncSession, *, tenant_id: int, actor_id: str, request_role: str | None, command_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    entity = await _entity(session, tenant_id, payload.get("entity_kind"), payload.get("entity_id"), actor_id=actor_id, request_role=request_role, write=True)
    target = await _target(session, tenant_id, payload, actor_id=actor_id, request_role=request_role, write=True)
    if entity["model_id"] and target["model"] and entity["model_id"] != target["model"].id:
        raise _error("INVALID_REFERENCE", "An Architecture change set can only trace to an object in its canonical model.", details={"entity_model_id": entity["model_id"], "target_model_id": target["model"].id})
    relationship_type = _text(payload.get("relationship_type", "Affected"), "relationship_type", required=True) or "Affected"
    command_type = "traceability.work_link.create"
    existing_command = await architecture_domain._command_start(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, request_body=payload)
    if existing_command:
        return existing_command.response_json
    conditions = [
        pv1_models.PV1TraceabilityLink.tenant_id == tenant_id,
        pv1_models.PV1TraceabilityLink.entity_kind == entity["kind"],
        pv1_models.PV1TraceabilityLink.entity_id == entity["id"],
        pv1_models.PV1TraceabilityLink.target_kind == target["kind"],
        pv1_models.PV1TraceabilityLink.target_key == target["key"],
        pv1_models.PV1TraceabilityLink.relationship_type == relationship_type,
    ]
    link = await session.scalar(select(pv1_models.PV1TraceabilityLink).where(*conditions))
    if link and link.lifecycle == "Active":
        response = {"status": "unchanged", "command_id": command_id, "link": _link_dict(link), "event_id": None}
        return await _finish_command(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, payload=payload, response=response, event_id=None)
    if link:
        link.lifecycle = "Active"
        link.retired_at = None
        link.revision += 1
        link.updated_by = actor_id
        link.updated_at = architecture_domain._now()
        event_type = "traceability.work_link.reactivated"
    else:
        link = pv1_models.PV1TraceabilityLink(id=architecture_domain._id(), tenant_id=tenant_id, entity_kind=entity["kind"], entity_id=entity["id"], project_id=entity["project_id"], target_kind=target["kind"], target_key=target["key"], device_id=target["device"].id if target["device"] else None, architecture_object_id=target["object"].id if target["object"] else None, relationship_type=relationship_type, lifecycle="Active", revision=1, created_by=actor_id, updated_by=actor_id)
        session.add(link)
        await session.flush()
        event_type = "traceability.work_link.created"
    project_revision = await _bump_project(session, entity["project_id"], tenant_id, payload.get("expected_project_revision"), actor_id)
    event_id = await _record_work_events(session, tenant_id=tenant_id, actor_id=actor_id, command_id=command_id, event_type=event_type, link=link, entity=entity, model_id=target["model"].id if target["model"] else entity["model_id"], project_revision=project_revision)
    response = {"status": "applied", "command_id": command_id, "link": _link_dict(link), "revisions": {"project_revision": project_revision} if project_revision else {}, "event_id": event_id}
    return await _finish_command(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, payload=payload, response=response, event_id=event_id)


async def update_work_link(session: AsyncSession, *, tenant_id: int, actor_id: str, request_role: str | None, link_id: str, command_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    link = await session.scalar(select(pv1_models.PV1TraceabilityLink).where(pv1_models.PV1TraceabilityLink.tenant_id == tenant_id, pv1_models.PV1TraceabilityLink.id == link_id))
    if not link:
        raise _error("NOT_FOUND", "PV1 traceability link not found.", http_status=status.HTTP_404_NOT_FOUND)
    if link.lifecycle == "Retired":
        raise _error("INVALID_STATE", "Retired traceability links cannot be edited; reactivate them by creating the same link.")
    entity = await _entity(session, tenant_id, link.entity_kind, link.entity_id, actor_id=actor_id, request_role=request_role, write=True)
    target_payload = {"device_id": link.device_id, "architecture_object_id": link.architecture_object_id}
    target = await _target(session, tenant_id, target_payload, actor_id=actor_id, request_role=request_role, write=True)
    expected_revision = payload.get("expected_revision")
    if not isinstance(expected_revision, int) or expected_revision != link.revision:
        raise _error("REVISION_CONFLICT", "The PV1 traceability link changed; review it before saving.", http_status=status.HTTP_409_CONFLICT, details={"current_revisions": {"link_revision": link.revision}})
    relationship_type = _text(payload.get("relationship_type"), "relationship_type", required=True) or ""
    command_type = "traceability.work_link.update"
    existing_command = await architecture_domain._command_start(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, request_body={"link_id": link_id, **payload})
    if existing_command:
        return existing_command.response_json
    conflict = await session.scalar(select(pv1_models.PV1TraceabilityLink).where(pv1_models.PV1TraceabilityLink.tenant_id == tenant_id, pv1_models.PV1TraceabilityLink.entity_kind == link.entity_kind, pv1_models.PV1TraceabilityLink.entity_id == link.entity_id, pv1_models.PV1TraceabilityLink.target_kind == link.target_kind, pv1_models.PV1TraceabilityLink.target_key == link.target_key, pv1_models.PV1TraceabilityLink.relationship_type == relationship_type, pv1_models.PV1TraceabilityLink.id != link.id))
    if conflict:
        raise _error("CONFLICT", "Another PV1 traceability link already owns this target and relationship.", http_status=status.HTTP_409_CONFLICT, details={"link_id": conflict.id})
    link.relationship_type = relationship_type
    link.revision += 1
    link.updated_by = actor_id
    link.updated_at = architecture_domain._now()
    project_revision = await _bump_project(session, entity["project_id"], tenant_id, payload.get("expected_project_revision"), actor_id)
    event_id = await _record_work_events(session, tenant_id=tenant_id, actor_id=actor_id, command_id=command_id, event_type=command_type, link=link, entity=entity, model_id=target["model"].id if target["model"] else entity["model_id"], project_revision=project_revision)
    response = {"status": "applied", "command_id": command_id, "link": _link_dict(link), "revisions": {"project_revision": project_revision} if project_revision else {}, "event_id": event_id}
    return await _finish_command(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, payload=payload, response=response, event_id=event_id)


async def retire_work_link(session: AsyncSession, *, tenant_id: int, actor_id: str, request_role: str | None, link_id: str, command_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    link = await session.scalar(select(pv1_models.PV1TraceabilityLink).where(pv1_models.PV1TraceabilityLink.tenant_id == tenant_id, pv1_models.PV1TraceabilityLink.id == link_id))
    if not link:
        raise _error("NOT_FOUND", "PV1 traceability link not found.", http_status=status.HTTP_404_NOT_FOUND)
    entity = await _entity(session, tenant_id, link.entity_kind, link.entity_id, actor_id=actor_id, request_role=request_role, write=True, allow_archived=True)
    target_payload = {"device_id": link.device_id, "architecture_object_id": link.architecture_object_id}
    target = await _target(session, tenant_id, target_payload, actor_id=actor_id, request_role=request_role, write=False, include_retired=True)
    expected_revision = payload.get("expected_revision")
    if expected_revision is not None and expected_revision != link.revision:
        raise _error("REVISION_CONFLICT", "The PV1 traceability link changed; review it before retiring.", http_status=status.HTTP_409_CONFLICT, details={"current_revisions": {"link_revision": link.revision}})
    command_type = "traceability.work_link.retire"
    existing_command = await architecture_domain._command_start(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, request_body={"link_id": link_id, **payload})
    if existing_command:
        return existing_command.response_json
    if link.lifecycle == "Retired":
        response = {"status": "unchanged", "command_id": command_id, "link": _link_dict(link), "event_id": None}
        return await _finish_command(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, payload=payload, response=response, event_id=None)
    link.lifecycle = "Retired"
    link.retired_at = architecture_domain._now()
    link.revision += 1
    link.updated_by = actor_id
    link.updated_at = architecture_domain._now()
    project_revision = await _bump_project(session, entity["project_id"], tenant_id, payload.get("expected_project_revision"), actor_id)
    event_id = await _record_work_events(session, tenant_id=tenant_id, actor_id=actor_id, command_id=command_id, event_type=command_type, link=link, entity=entity, model_id=target["model"].id if target["model"] else entity["model_id"], project_revision=project_revision)
    response = {"status": "applied", "command_id": command_id, "link": _link_dict(link), "revisions": {"project_revision": project_revision} if project_revision else {}, "event_id": event_id}
    return await _finish_command(session, tenant_id=tenant_id, actor_id=actor_id, command_type=command_type, command_id=command_id, payload=payload, response=response, event_id=event_id)


async def _load_work_payloads(session: AsyncSession, tenant_id: int, links: list[pv1_models.PV1TraceabilityLink]) -> list[dict[str, Any]]:
    grouped: dict[str, set[str]] = defaultdict(set)
    for link in links:
        grouped[link.entity_kind].add(link.entity_id)
    records: dict[tuple[str, str], dict[str, Any]] = {}
    if grouped["project"]:
        rows = (await session.execute(select(pv1_models.PV1Project).where(pv1_models.PV1Project.tenant_id == tenant_id, pv1_models.PV1Project.id.in_(grouped["project"])))) .scalars().all()
        records.update({("project", row.id): {"kind": "project", "id": row.id, "project_id": row.id, "label": row.name, "state": row.phase, "revision": row.revision} for row in rows})
    if grouped["task"]:
        rows = (await session.execute(select(pv1_models.PV1Task).where(pv1_models.PV1Task.tenant_id == tenant_id, pv1_models.PV1Task.id.in_(grouped["task"])))) .scalars().all()
        records.update({("task", row.id): {"kind": "task", "id": row.id, "project_id": row.project_id, "label": row.title, "state": row.status, "revision": row.revision} for row in rows})
    for kind, entity_model, label_field in (
        ("outcome_acceptance", pv1_models.PV1OutcomeAcceptance, "result"),
        ("delivery_acceptance", pv1_models.PV1DeliveryAcceptance, "reviewer_id"),
        ("outcome_checkpoint", pv1_models.PV1OutcomeCheckpoint, "kind"),
    ):
        if not grouped[kind]:
            continue
        rows = (await session.execute(select(entity_model).where(entity_model.tenant_id == tenant_id, entity_model.id.in_(grouped[kind])))).scalars().all()
        records.update({(kind, row.id): {"kind": kind, "id": row.id, "project_id": row.project_id, "label": getattr(row, label_field, None) or kind, "state": getattr(row, "state", None) or getattr(row, "result", None), "revision": row.revision} for row in rows})
    if grouped["architecture_change_set"]:
        rows = (await session.execute(select(models.ArchitectureChangeSet).where(models.ArchitectureChangeSet.tenant_id == tenant_id, models.ArchitectureChangeSet.id.in_(grouped["architecture_change_set"])))) .scalars().all()
        records.update({("architecture_change_set", row.id): {"kind": "architecture_change_set", "id": row.id, "project_id": row.project_id, "model_id": row.model_id, "label": "Architecture change set", "state": row.state, "revision": row.revision} for row in rows})
    missing = [(link.entity_kind, link.entity_id) for link in links if (link.entity_kind, link.entity_id) not in records]
    if missing:
        raise _error("DATA_INTEGRITY_ERROR", "A traceability link points to a missing canonical work entity.", details={"references": missing})
    inconsistent = [link.id for link in links if link.project_id != records[(link.entity_kind, link.entity_id)]["project_id"]]
    if inconsistent:
        raise _error("DATA_INTEGRITY_ERROR", "A traceability link has an inconsistent Project parent.", details={"link_ids": inconsistent})
    return [{"link": _link_dict(link), "entity": records[(link.entity_kind, link.entity_id)]} for link in links]


async def _target_payloads(session: AsyncSession, tenant_id: int, links: list[pv1_models.PV1TraceabilityLink], *, include_retired: bool) -> list[dict[str, Any]]:
    device_ids = {link.device_id for link in links if link.device_id is not None}
    object_ids = {link.architecture_object_id for link in links if link.architecture_object_id is not None}
    devices = {}
    if device_ids:
        devices = {row.id: row for row in (await session.execute(select(legacy_models.Device).where(legacy_models.Device.tenant_id == tenant_id, legacy_models.Device.id.in_(device_ids)))).scalars().all()}
    objects = {}
    object_models = {}
    if object_ids:
        objects = {row.id: row for row in (await session.execute(select(models.ArchitectureObject).where(models.ArchitectureObject.tenant_id == tenant_id, models.ArchitectureObject.id.in_(object_ids)))).scalars().all()}
        object_models = {row.id: row for row in (await session.execute(select(models.ArchitectureModel).where(models.ArchitectureModel.tenant_id == tenant_id, models.ArchitectureModel.id.in_({obj.model_id for obj in objects.values()})))).scalars().all()}
    result = []
    for link in links:
        if link.target_kind == "device":
            target = devices.get(link.device_id)
            if not target:
                raise _error("DATA_INTEGRITY_ERROR", "A traceability link points to a missing or cross-tenant Device.", details={"link_id": link.id})
            if link.target_key != str(target.id):
                raise _error("DATA_INTEGRITY_ERROR", "A traceability link has an inconsistent Device target key.", details={"link_id": link.id})
            if target.is_deleted and not include_retired:
                continue
            result.append({"link": _link_dict(link), "target": {"kind": "device", "device": _device_dict(target), "architecture_object": None}})
        else:
            target = objects.get(link.architecture_object_id)
            model = object_models.get(target.model_id) if target else None
            if not target or not model:
                raise _error("DATA_INTEGRITY_ERROR", "A traceability link points to a missing or cross-tenant ArchitectureObject.", details={"link_id": link.id})
            if link.target_key != target.id:
                raise _error("DATA_INTEGRITY_ERROR", "A traceability link has an inconsistent ArchitectureObject target key.", details={"link_id": link.id})
            if target.retired_at is not None and not include_retired:
                continue
            result.append({"link": _link_dict(link), "target": {"kind": "architecture_object", "device": None, "architecture_object": _object_dict(target, model)}})
    return result


async def project_architecture_object_ids(session: AsyncSession, *, tenant_id: int, project_id: str, model_id: str, include_retired: bool = False) -> list[str]:
    statement = select(pv1_models.PV1TraceabilityLink).where(
        pv1_models.PV1TraceabilityLink.tenant_id == tenant_id,
        pv1_models.PV1TraceabilityLink.entity_kind == "project",
        pv1_models.PV1TraceabilityLink.entity_id == project_id,
        pv1_models.PV1TraceabilityLink.target_kind == "architecture_object",
    ).order_by(pv1_models.PV1TraceabilityLink.created_at, pv1_models.PV1TraceabilityLink.id)
    links = list((await session.execute(statement)).scalars())
    if any(link.architecture_object_id is None for link in links):
        raise _error("DATA_INTEGRITY_ERROR", "A Project architecture association has a normalized link without an ArchitectureObject target.", details={"project_id": project_id})
    object_ids = {link.architecture_object_id for link in links if link.architecture_object_id}
    object_result = await session.execute(select(models.ArchitectureObject).where(models.ArchitectureObject.tenant_id == tenant_id, models.ArchitectureObject.id.in_(object_ids))) if object_ids else None
    objects = {obj.id: obj for obj in object_result.scalars().all()} if object_result else {}
    if len(objects) != len(object_ids):
        raise _error("DATA_INTEGRITY_ERROR", "A Project architecture association has a dangling or cross-tenant ArchitectureObject link.", details={"project_id": project_id})
    if any(link.target_key != link.architecture_object_id for link in links):
        raise _error("DATA_INTEGRITY_ERROR", "A Project architecture association has an inconsistent ArchitectureObject target key.", details={"project_id": project_id})
    if any(obj.model_id != model_id for obj in objects.values()):
        raise _error("DATA_INTEGRITY_ERROR", "A Project architecture association crosses Architecture models.", details={"project_id": project_id, "model_id": model_id})
    if not include_retired:
        links = [link for link in links if link.lifecycle == "Active" and objects[link.architecture_object_id].retired_at is None]
    return [link.architecture_object_id for link in links if link.architecture_object_id]


async def device_projection(session: AsyncSession, *, tenant_id: int, device_id: int, actor_id: str, request_role: str | None, include_retired: bool = False) -> dict[str, Any]:
    device = await _device(session, tenant_id, device_id, include_deleted=include_retired)
    device_link_statement = select(models.ArchitectureDeviceLink).where(models.ArchitectureDeviceLink.tenant_id == tenant_id, models.ArchitectureDeviceLink.device_id == device.id)
    work_statement = select(pv1_models.PV1TraceabilityLink).where(pv1_models.PV1TraceabilityLink.tenant_id == tenant_id, pv1_models.PV1TraceabilityLink.target_kind == "device", pv1_models.PV1TraceabilityLink.device_id == device.id)
    if not include_retired:
        device_link_statement = device_link_statement.where(models.ArchitectureDeviceLink.lifecycle == "Active")
        work_statement = work_statement.where(pv1_models.PV1TraceabilityLink.lifecycle == "Active")
    device_links = list((await session.execute(device_link_statement.order_by(models.ArchitectureDeviceLink.id))).scalars())
    direct_work_links = list((await session.execute(work_statement.order_by(pv1_models.PV1TraceabilityLink.id))).scalars())
    object_ids = {link.architecture_object_id for link in device_links}
    object_work_links: list[pv1_models.PV1TraceabilityLink] = []
    if object_ids:
        object_work_statement = select(pv1_models.PV1TraceabilityLink).join(models.ArchitectureObject, models.ArchitectureObject.id == pv1_models.PV1TraceabilityLink.architecture_object_id).where(pv1_models.PV1TraceabilityLink.tenant_id == tenant_id, pv1_models.PV1TraceabilityLink.target_kind == "architecture_object", pv1_models.PV1TraceabilityLink.architecture_object_id.in_(object_ids), models.ArchitectureObject.tenant_id == tenant_id)
        if not include_retired:
            object_work_statement = object_work_statement.where(pv1_models.PV1TraceabilityLink.lifecycle == "Active", models.ArchitectureObject.retired_at.is_(None))
        object_work_links = list((await session.execute(object_work_statement.order_by(pv1_models.PV1TraceabilityLink.id))).scalars())
    object_result = await session.execute(select(models.ArchitectureObject).where(models.ArchitectureObject.tenant_id == tenant_id, models.ArchitectureObject.id.in_(object_ids))) if object_ids else None
    objects = {obj.id: obj for obj in object_result.scalars().all()} if object_result else {}
    if len(objects) != len(object_ids):
        raise _error("DATA_INTEGRITY_ERROR", "An Architecture Device link points to a missing or cross-tenant ArchitectureObject.", details={"device_id": device.id})
    model_ids = {obj.model_id for obj in objects.values()}
    model_result = await session.execute(select(models.ArchitectureModel).where(models.ArchitectureModel.tenant_id == tenant_id, models.ArchitectureModel.id.in_(model_ids))) if model_ids else None
    architecture_models = {model.id: model for model in model_result.scalars().all()} if model_result else {}
    if len(architecture_models) != len(model_ids):
        raise _error("DATA_INTEGRITY_ERROR", "An ArchitectureObject has no tenant-safe Architecture model.", details={"device_id": device.id})
    for model in architecture_models.values():
        await architecture_domain.require_model_access(session, tenant_id=tenant_id, model_id=model.id, actor_id=actor_id, request_role=request_role)
    object_work_payloads = await _load_work_payloads(session, tenant_id, object_work_links)
    work_by_object: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for payload in object_work_payloads:
        if payload["link"]["architecture_object_id"]:
            work_by_object[payload["link"]["architecture_object_id"]].append(payload)
    object_result = []
    for link in device_links:
        obj = objects[link.architecture_object_id]
        model = architecture_models[obj.model_id]
        if not include_retired and obj.retired_at is not None:
            continue
        object_result.append({"link": _link_dict(link), "object": _object_dict(obj, model), "work": work_by_object.get(obj.id, [])})
    await _target_payloads(session, tenant_id, direct_work_links, include_retired=include_retired)
    return {"as_of": architecture_domain._now().isoformat(), "device": _device_dict(device), "architecture_objects": object_result, "work": await _load_work_payloads(session, tenant_id, direct_work_links), "authority": "normalized_traceability"}


async def object_projection(session: AsyncSession, *, tenant_id: int, object_id: str, actor_id: str, request_role: str | None, include_retired: bool = False) -> dict[str, Any]:
    obj, model = await _object(session, tenant_id, object_id, include_retired=include_retired)
    await architecture_domain.require_model_access(session, tenant_id=tenant_id, model_id=model.id, actor_id=actor_id, request_role=request_role)
    device_statement = select(models.ArchitectureDeviceLink).where(models.ArchitectureDeviceLink.tenant_id == tenant_id, models.ArchitectureDeviceLink.architecture_object_id == obj.id)
    work_statement = select(pv1_models.PV1TraceabilityLink).where(pv1_models.PV1TraceabilityLink.tenant_id == tenant_id, pv1_models.PV1TraceabilityLink.target_kind == "architecture_object", pv1_models.PV1TraceabilityLink.architecture_object_id == obj.id)
    if not include_retired:
        device_statement = device_statement.where(models.ArchitectureDeviceLink.lifecycle == "Active")
        work_statement = work_statement.where(pv1_models.PV1TraceabilityLink.lifecycle == "Active")
    device_links = list((await session.execute(device_statement.order_by(models.ArchitectureDeviceLink.id))).scalars())
    work_links = list((await session.execute(work_statement.order_by(pv1_models.PV1TraceabilityLink.id))).scalars())
    device_ids = [link.device_id for link in device_links]
    devices = list((await session.execute(select(legacy_models.Device).where(legacy_models.Device.tenant_id == tenant_id, legacy_models.Device.id.in_(device_ids)))).scalars()) if device_ids else []
    if len(devices) != len(set(device_ids)):
        raise _error("DATA_INTEGRITY_ERROR", "An Architecture Device link points to a missing or cross-tenant Device.")
    if not include_retired and any(device.is_deleted for device in devices):
        raise _error("DATA_INTEGRITY_ERROR", "An active Architecture Device link points to a retired Device.")
    return {"as_of": architecture_domain._now().isoformat(), "architecture_object": _object_dict(obj, model), "devices": [{"link": _link_dict(link), "device": _device_dict(next(device for device in devices if device.id == link.device_id))} for link in device_links], "work": await _load_work_payloads(session, tenant_id, work_links), "authority": "normalized_traceability"}


async def work_projection(session: AsyncSession, *, tenant_id: int, entity_kind: str, entity_id: str, actor_id: str, request_role: str | None, include_retired: bool = False) -> dict[str, Any]:
    entity = await _entity(session, tenant_id, entity_kind, entity_id, actor_id=actor_id, request_role=request_role, write=False)
    statement = select(pv1_models.PV1TraceabilityLink).where(pv1_models.PV1TraceabilityLink.tenant_id == tenant_id, pv1_models.PV1TraceabilityLink.entity_kind == entity["kind"], pv1_models.PV1TraceabilityLink.entity_id == entity["id"])
    if not include_retired:
        statement = statement.where(pv1_models.PV1TraceabilityLink.lifecycle == "Active")
    links = list((await session.execute(statement.order_by(pv1_models.PV1TraceabilityLink.id))).scalars())
    targets = await _target_payloads(session, tenant_id, links, include_retired=include_retired)
    return {"as_of": architecture_domain._now().isoformat(), "entity": entity, "links": targets, "authority": "normalized_traceability"}
