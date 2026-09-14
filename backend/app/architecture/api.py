from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..pv1 import domain as pv1_domain
from ..pv1 import models as pv1_models
from . import domain
from . import models
from . import traceability


router = APIRouter(prefix="/architecture", tags=["PV1 Architecture"])


def _tenant_id(request: Request) -> int:
    value = getattr(request.state, "tenant_id", None)
    if not isinstance(value, int):
        raise domain.ArchitectureDomainError("AUTH_REQUIRED", "Tenant context is missing.", http_status=status.HTTP_401_UNAUTHORIZED)
    return value


def _actor(request: Request) -> str:
    from ..api.utils import get_current_user_id
    return get_current_user_id(request)


def _command_id(request: Request, raw: dict[str, Any] | None = None) -> str:
    value = request.headers.get("Idempotency-Key") or (raw or {}).get("command_id")
    if not value:
        raise domain.ArchitectureDomainError("VALIDATION_FAILED", "Idempotency-Key is required for Architecture writes.", details={"field": "Idempotency-Key"})
    try:
        return str(UUID(str(value)))
    except ValueError as exc:
        raise domain.ArchitectureDomainError("VALIDATION_FAILED", "Idempotency-Key must be a UUID.", details={"field": "Idempotency-Key"}) from exc


def _envelope(raw: dict[str, Any], request: Request) -> tuple[str, str, dict[str, Any], dict[str, Any]]:
    command_id = _command_id(request, raw)
    command_type = str(raw.get("type") or raw.get("command_type") or "")
    if not command_type:
        raise domain.ArchitectureDomainError("VALIDATION_FAILED", "Architecture command type is required.", details={"field": "type"})
    expected = raw.get("expected") or {}
    payload = raw.get("payload") if isinstance(raw.get("payload"), dict) else {key: value for key, value in raw.items() if key not in {"command_id", "type", "command_type", "expected"}}
    if not isinstance(expected, dict) or not isinstance(payload, dict):
        raise domain.ArchitectureDomainError("VALIDATION_FAILED", "Architecture command envelope fields are invalid.")
    return command_id, command_type, expected, payload


def _error(request: Request, error: domain.ArchitectureDomainError) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "architecture-request")
    return JSONResponse(status_code=error.http_status, content={
        "code": error.code, "message": error.message, "request_id": request_id,
        "retryable": error.retryable, "details": error.details,
        "current_revisions": error.details.get("current_revisions"),
    }, headers={"X-Request-ID": request_id})


def _traceability_error(request: Request, error: Exception) -> JSONResponse:
    if isinstance(error, pv1_domain.PV1DomainError):
        request_id = getattr(request.state, "request_id", "architecture-request")
        return JSONResponse(status_code=error.http_status, content={
            "code": error.code, "message": error.message, "request_id": request_id,
            "retryable": error.retryable, "details": error.details,
            "current_revisions": error.details.get("current_revisions"),
        }, headers={"X-Request-ID": request_id})
    return _error(request, error)


async def _run(request: Request, operation):
    try:
        result = await operation()
        db = request.state._db_for_architecture
        await db.commit()
        return result
    except domain.ArchitectureDomainError as exc:
        db = getattr(request.state, "_db_for_architecture", None)
        if db is not None:
            await db.rollback()
        return _error(request, exc)


def _bind_db(request: Request, db: AsyncSession) -> None:
    request.state._db_for_architecture = db


@router.get("/capabilities")
async def capabilities(request: Request, db: AsyncSession = Depends(get_db)):
    _bind_db(request, db)
    role = getattr(request.state, "sysgrid_access_role", None)
    return {"contract_version": "pv1-architecture-v1", "capabilities": {
        "architecture_read": {"supported": True, "scope": "tenant_and_model", "reason": "Canonical PV1 Architecture model service."},
        "architecture_edit": {"supported": True, "scope": "model_access", "reason": "Typed revisioned Architecture commands."},
        "architecture_change_sets": {"supported": True, "scope": "model_access", "reason": "Draft, review, apply and rebase workflow."},
        "architecture_assessment": {"supported": True, "scope": "project_access", "reason": "Evidence-backed assessment states."},
        "asset_architecture_traceability": {"supported": True, "scope": "tenant_and_project_or_model_access", "reason": "Normalized Device, ArchitectureObject, and PV1 work links with historical projections."},
        "tenant_role": role,
    }}


@router.get("/models")
async def list_models(request: Request, db: AsyncSession = Depends(get_db)):
    _bind_db(request, db)
    tenant_id, actor, request_role = _tenant_id(request), _actor(request), getattr(request.state, "sysgrid_access_role", None)
    if (request_role or "").upper() == "ADMIN":
        result = await db.execute(select(models.ArchitectureModel).where(models.ArchitectureModel.tenant_id == tenant_id).order_by(models.ArchitectureModel.name))
    else:
        result = await db.execute(select(models.ArchitectureModel).join(models.ArchitectureAccess, models.ArchitectureAccess.model_id == models.ArchitectureModel.id).where(models.ArchitectureModel.tenant_id == tenant_id, models.ArchitectureAccess.tenant_id == tenant_id, models.ArchitectureAccess.user_id == actor).order_by(models.ArchitectureModel.name))
    return {"items": [{"id": item.id, "name": item.name, "description": item.description, "owner_id": item.owner_id, "schema_version": item.schema_version, "lifecycle": item.lifecycle, "revision": item.revision} for item in result.scalars()]}


@router.post("/models", status_code=status.HTTP_201_CREATED)
async def create_model(request: Request, db: AsyncSession = Depends(get_db)):
    _bind_db(request, db)
    raw = await request.json()
    payload = raw.get("payload") if isinstance(raw.get("payload"), dict) else raw
    command_id = _command_id(request, raw)
    try:
        result = await domain.create_model(db, tenant_id=_tenant_id(request), actor_id=_actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), command_id=command_id, payload=payload)
        await db.commit()
        return result
    except domain.ArchitectureDomainError as exc:
        await db.rollback()
        return _error(request, exc)


@router.get("/models/{model_id}")
async def get_model(model_id: str, request: Request, mode: str = "current", changeset: str | None = None, project: str | None = None, db: AsyncSession = Depends(get_db)):
    _bind_db(request, db)
    try:
        if mode not in {"current", "impact", "proposed"}:
            raise domain.ArchitectureDomainError("VALIDATION_FAILED", "mode must be current, impact, or proposed.")
        return await domain.model_projection(db, tenant_id=_tenant_id(request), model_id=model_id, actor_id=_actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), mode=mode, change_set_id=changeset, project_id=project)
    except domain.ArchitectureDomainError as exc:
        return _error(request, exc)


@router.post("/models/{model_id}/commands")
async def model_command(model_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    _bind_db(request, db)
    raw = await request.json()
    try:
        command_id, command_type, expected, payload = _envelope(raw, request)
        result = await domain.execute_model_command(db, tenant_id=_tenant_id(request), actor_id=_actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), model_id=model_id, command_id=command_id, command_type=command_type, expected=expected, payload=payload)
        await db.commit()
        return result
    except domain.ArchitectureDomainError as exc:
        await db.rollback()
        return _error(request, exc)


@router.post("/change-sets", status_code=status.HTTP_201_CREATED)
async def create_change_set_endpoint(request: Request, db: AsyncSession = Depends(get_db)):
    _bind_db(request, db)
    raw = await request.json()
    try:
        command_id, _command_type, _expected, payload = _envelope({**raw, "type": "change_set.create"}, request)
        model_id = str(payload.get("model_id") or "")
        if not model_id:
            raise domain.ArchitectureDomainError("VALIDATION_FAILED", "model_id is required.")
        result = await domain.create_change_set(db, tenant_id=_tenant_id(request), actor_id=_actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), command_id=command_id, model_id=model_id, payload=payload)
        await db.commit()
        return result
    except domain.ArchitectureDomainError as exc:
        await db.rollback()
        return _error(request, exc)


@router.get("/change-sets/{change_set_id}")
async def get_change_set(change_set_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    _bind_db(request, db)
    try:
        return await domain.get_changeset(db, tenant_id=_tenant_id(request), actor_id=_actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), change_set_id=change_set_id)
    except domain.ArchitectureDomainError as exc:
        return _error(request, exc)


async def _change_set_command(change_set_id: str, action: str, request: Request, db: AsyncSession):
    _bind_db(request, db)
    raw = await request.json()
    action_map = {"submit": "change_set.submit", "approve": "change_set.approve", "reject": "change_set.reject", "apply": "change_set.apply", "rebase": "change_set.rebase", "supersede": "change_set.supersede"}
    try:
        command_id, _type, _expected, payload = _envelope({**raw, "type": action_map[action]}, request)
        result = await domain.execute_changeset_command(db, tenant_id=_tenant_id(request), actor_id=_actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), change_set_id=change_set_id, command_id=command_id, command_type=action_map[action], payload=payload)
        await db.commit()
        return result
    except domain.ArchitectureDomainError as exc:
        await db.rollback()
        return _error(request, exc)


@router.post("/change-sets/{change_set_id}/commands")
async def change_set_command(change_set_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    _bind_db(request, db)
    raw = await request.json()
    try:
        command_id, command_type, _expected, payload = _envelope(raw, request)
        result = await domain.execute_changeset_command(db, tenant_id=_tenant_id(request), actor_id=_actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), change_set_id=change_set_id, command_id=command_id, command_type=command_type, payload=payload)
        await db.commit()
        return result
    except domain.ArchitectureDomainError as exc:
        await db.rollback()
        return _error(request, exc)


for _action in ("submit", "approve", "reject", "apply", "rebase", "supersede"):
    async def _endpoint(change_set_id: str, request: Request, db: AsyncSession = Depends(get_db), _action: str = _action):
        return await _change_set_command(change_set_id, _action, request, db)
    router.add_api_route(f"/change-sets/{{change_set_id}}/{_action}", _endpoint, methods=["POST"])


@router.post("/projects/{project_id}/architecture/associate")
async def associate_project(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    _bind_db(request, db)
    raw = await request.json()
    try:
        command_id = _command_id(request, raw)
        payload = raw.get("payload") if isinstance(raw.get("payload"), dict) else raw
        result = await domain.associate_project(db, tenant_id=_tenant_id(request), actor_id=_actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), project_id=project_id, payload=payload, command_id=command_id)
        await db.commit()
        return result
    except (domain.ArchitectureDomainError, pv1_domain.PV1DomainError) as exc:
        await db.rollback()
        if isinstance(exc, pv1_domain.PV1DomainError) and not isinstance(exc, domain.ArchitectureDomainError):
            return JSONResponse(status_code=exc.http_status, content={"code": exc.code, "message": exc.message, "details": exc.details})
        return _error(request, exc)


@router.get("/projects/{project_id}/architecture")
async def project_architecture(project_id: str, request: Request, mode: str = "impact", changeset: str | None = None, db: AsyncSession = Depends(get_db)):
    _bind_db(request, db)
    try:
        return await domain.project_architecture(db, tenant_id=_tenant_id(request), actor_id=_actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), project_id=project_id, mode=mode, change_set_id=changeset)
    except (domain.ArchitectureDomainError, pv1_domain.PV1DomainError) as exc:
        if isinstance(exc, pv1_domain.PV1DomainError) and not isinstance(exc, domain.ArchitectureDomainError):
            return JSONResponse(status_code=exc.http_status, content={"code": exc.code, "message": exc.message, "details": exc.details})
        return _error(request, exc)


@router.post("/traceability/device-links", status_code=status.HTTP_201_CREATED)
async def create_device_architecture_link(request: Request, db: AsyncSession = Depends(get_db)):
    raw = await request.json()
    payload = raw.get("payload") if isinstance(raw.get("payload"), dict) else raw
    try:
        result = await traceability.create_device_link(db, tenant_id=_tenant_id(request), actor_id=_actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), command_id=_command_id(request, raw), payload=payload)
        await db.commit()
        return result
    except domain.ArchitectureDomainError as exc:
        await db.rollback()
        return _error(request, exc)


@router.put("/traceability/device-links/{link_id}")
async def update_device_architecture_link(link_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    raw = await request.json()
    payload = raw.get("payload") if isinstance(raw.get("payload"), dict) else raw
    try:
        result = await traceability.update_device_link(db, tenant_id=_tenant_id(request), actor_id=_actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), link_id=link_id, command_id=_command_id(request, raw), payload=payload)
        await db.commit()
        return result
    except (domain.ArchitectureDomainError, pv1_domain.PV1DomainError) as exc:
        await db.rollback()
        return _traceability_error(request, exc)


@router.delete("/traceability/device-links/{link_id}")
async def retire_device_architecture_link(link_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    raw = await request.json() if request.headers.get("content-length") not in {None, "0"} else {}
    payload = raw.get("payload") if isinstance(raw.get("payload"), dict) else raw
    try:
        result = await traceability.retire_device_link(db, tenant_id=_tenant_id(request), actor_id=_actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), link_id=link_id, command_id=_command_id(request, raw), payload=payload)
        await db.commit()
        return result
    except (domain.ArchitectureDomainError, pv1_domain.PV1DomainError) as exc:
        await db.rollback()
        return _traceability_error(request, exc)


@router.post("/traceability/work-links", status_code=status.HTTP_201_CREATED)
async def create_work_traceability_link(request: Request, db: AsyncSession = Depends(get_db)):
    raw = await request.json()
    payload = raw.get("payload") if isinstance(raw.get("payload"), dict) else raw
    try:
        result = await traceability.create_work_link(db, tenant_id=_tenant_id(request), actor_id=_actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), command_id=_command_id(request, raw), payload=payload)
        await db.commit()
        return result
    except (domain.ArchitectureDomainError, pv1_domain.PV1DomainError) as exc:
        await db.rollback()
        return _traceability_error(request, exc)


@router.put("/traceability/work-links/{link_id}")
async def update_work_traceability_link(link_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    raw = await request.json()
    payload = raw.get("payload") if isinstance(raw.get("payload"), dict) else raw
    try:
        result = await traceability.update_work_link(db, tenant_id=_tenant_id(request), actor_id=_actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), link_id=link_id, command_id=_command_id(request, raw), payload=payload)
        await db.commit()
        return result
    except (domain.ArchitectureDomainError, pv1_domain.PV1DomainError) as exc:
        await db.rollback()
        return _traceability_error(request, exc)


@router.delete("/traceability/work-links/{link_id}")
async def retire_work_traceability_link(link_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    raw = await request.json() if request.headers.get("content-length") not in {None, "0"} else {}
    payload = raw.get("payload") if isinstance(raw.get("payload"), dict) else raw
    try:
        result = await traceability.retire_work_link(db, tenant_id=_tenant_id(request), actor_id=_actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), link_id=link_id, command_id=_command_id(request, raw), payload=payload)
        await db.commit()
        return result
    except (domain.ArchitectureDomainError, pv1_domain.PV1DomainError) as exc:
        await db.rollback()
        return _traceability_error(request, exc)


@router.get("/traceability/devices/{device_id}")
async def get_device_traceability(device_id: int, request: Request, include_retired: bool = Query(default=False), db: AsyncSession = Depends(get_db)):
    try:
        return await traceability.device_projection(db, tenant_id=_tenant_id(request), device_id=device_id, actor_id=_actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), include_retired=include_retired)
    except (domain.ArchitectureDomainError, pv1_domain.PV1DomainError) as exc:
        return _traceability_error(request, exc)


@router.get("/traceability/architecture-objects/{object_id}")
async def get_object_traceability(object_id: str, request: Request, include_retired: bool = Query(default=False), db: AsyncSession = Depends(get_db)):
    try:
        return await traceability.object_projection(db, tenant_id=_tenant_id(request), object_id=object_id, actor_id=_actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), include_retired=include_retired)
    except (domain.ArchitectureDomainError, pv1_domain.PV1DomainError) as exc:
        return _traceability_error(request, exc)


@router.get("/traceability/work/{entity_kind}/{entity_id}")
async def get_work_traceability(entity_kind: str, entity_id: str, request: Request, include_retired: bool = Query(default=False), db: AsyncSession = Depends(get_db)):
    try:
        return await traceability.work_projection(db, tenant_id=_tenant_id(request), entity_kind=entity_kind, entity_id=entity_id, actor_id=_actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), include_retired=include_retired)
    except (domain.ArchitectureDomainError, pv1_domain.PV1DomainError) as exc:
        return _traceability_error(request, exc)


@router.post("/projects/{project_id}/architecture/assessment")
async def project_assessment(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    _bind_db(request, db)
    raw = await request.json()
    try:
        payload = raw.get("payload") if isinstance(raw.get("payload"), dict) else raw
        result = await domain.save_assessment(db, tenant_id=_tenant_id(request), actor_id=_actor(request), request_role=getattr(request.state, "sysgrid_access_role", None), project_id=project_id, payload=payload)
        await db.commit()
        return result
    except (domain.ArchitectureDomainError, pv1_domain.PV1DomainError) as exc:
        await db.rollback()
        if isinstance(exc, pv1_domain.PV1DomainError) and not isinstance(exc, domain.ArchitectureDomainError):
            return JSONResponse(status_code=exc.http_status, content={"code": exc.code, "message": exc.message, "details": exc.details})
        return _error(request, exc)
