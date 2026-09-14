from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import models
from ..operational_actions import service
from ..operational_actions.domain import REGISTRY
from ..schemas.operational_actions import (
    ActionCreateRequest,
    ActionEventRead,
    AuthorizeRequest,
    ConfirmRequest,
    ExecuteRequest,
    OperationalActionRead,
    PreviewRequest,
    RecoveryRequest,
    RollbackRequest,
    VerificationRequest,
)
from .utils import get_current_user_id


router = APIRouter(prefix="/operational-actions", tags=["Operational Actions"])


def _context(request: Request) -> tuple[int, str, str | None]:
    tenant_id = getattr(request.state, "tenant_id", None)
    if tenant_id is None:
        raise HTTPException(status_code=403, detail={"code": "TENANT_CONTEXT_REQUIRED", "message": "Tenant context is required"})
    return int(tenant_id), get_current_user_id(request), getattr(request.state, "sysgrid_access_role", None)


def _raise(error: service.OperationalActionError) -> None:
    raise HTTPException(
        status_code=error.http_status,
        detail={"code": error.code, "message": error.detail},
    )


async def _view(db: AsyncSession, tenant_id: int, action_id: str) -> dict[str, Any]:
    return await service.action_view(db, tenant_id=tenant_id, action_id=action_id)


@router.get("/capabilities")
async def discover_capabilities(
    request: Request,
    device_id: int | None = Query(default=None, gt=0),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    tenant_id, _, _ = _context(request)
    if device_id is not None:
        result = await db.execute(
            select(models.Device.id).where(models.Device.id == device_id, models.Device.tenant_id == tenant_id)
        )
        if result.scalar_one_or_none() is None:
            _raise(service.TargetNotFound([device_id]))
    catalog = REGISTRY.describe()
    if device_id is not None:
        catalog["target"] = {"device_id": device_id, "tenant_id": tenant_id}
    return catalog


@router.get("", response_model=list[OperationalActionRead])
async def get_actions(
    request: Request,
    status_filter: str | None = Query(default=None, alias="status"),
    device_id: int | None = Query(default=None, gt=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    tenant_id, _, _ = _context(request)
    try:
        return await service.list_actions(
            db,
            tenant_id=tenant_id,
            status_filter=status_filter,
            device_id=device_id,
            limit=limit,
        )
    except service.OperationalActionError as error:
        _raise(error)


@router.post("", response_model=OperationalActionRead)
async def create_operational_action(
    payload: ActionCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    tenant_id, actor_id, access_role = _context(request)
    header_key = request.headers.get("Idempotency-Key") or request.headers.get("X-Command-Id")
    if header_key and payload.idempotency_key and header_key != payload.idempotency_key:
        _raise(service.ActionBadRequest("The body and Idempotency-Key values must match"))
    idempotency_key = (payload.idempotency_key or header_key or "").strip()
    try:
        action = await service.create_action(
            db,
            tenant_id=tenant_id,
            actor_id=actor_id,
            access_role=access_role,
            request_id=getattr(request.state, "request_id", "api-request"),
            action_key=payload.action_key,
            capability_key=payload.capability_key,
            adapter_id=payload.adapter_id,
            parameters=payload.parameters,
            target_device_ids=payload.target_device_ids,
            idempotency_key=idempotency_key,
            maintenance_window_id=payload.maintenance_window_id,
            change_context=payload.change_context,
            ticket_reference=payload.ticket_reference,
        )
        return await _view(db, tenant_id, action.id)
    except service.OperationalActionError as error:
        _raise(error)


@router.post("/{action_id}/preview", response_model=OperationalActionRead)
async def preview_operational_action(
    action_id: str,
    request: Request,
    payload: PreviewRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    tenant_id, actor_id, access_role = _context(request)
    try:
        await service.preview_action(
            db,
            tenant_id=tenant_id,
            actor_id=actor_id,
            access_role=access_role,
            action_id=action_id,
        )
        return await _view(db, tenant_id, action_id)
    except service.OperationalActionError as error:
        _raise(error)


@router.post("/{action_id}/authorize", response_model=OperationalActionRead)
async def authorize_operational_action(
    action_id: str,
    payload: AuthorizeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    tenant_id, actor_id, access_role = _context(request)
    try:
        await service.authorize_action(
            db,
            tenant_id=tenant_id,
            actor_id=actor_id,
            access_role=access_role,
            action_id=action_id,
            preview_token=payload.preview_token,
            approval_facts=payload.approval_facts,
            recovery_facts=payload.recovery_facts,
            confirm=payload.confirm,
        )
        return await _view(db, tenant_id, action_id)
    except service.OperationalActionError as error:
        _raise(error)


@router.post("/{action_id}/confirm", response_model=OperationalActionRead)
async def confirm_operational_action(
    action_id: str,
    payload: ConfirmRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    tenant_id, actor_id, access_role = _context(request)
    try:
        await service.confirm_action(
            db,
            tenant_id=tenant_id,
            actor_id=actor_id,
            access_role=access_role,
            action_id=action_id,
            preview_token=payload.preview_token,
            confirmation=payload.confirmation,
        )
        return await _view(db, tenant_id, action_id)
    except service.OperationalActionError as error:
        _raise(error)


@router.post("/{action_id}/execute", response_model=OperationalActionRead)
async def execute_operational_action(
    action_id: str,
    payload: ExecuteRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    tenant_id, actor_id, access_role = _context(request)
    try:
        await service.execute_action(
            db,
            tenant_id=tenant_id,
            actor_id=actor_id,
            access_role=access_role,
            action_id=action_id,
            preview_token=payload.preview_token,
        )
        return await _view(db, tenant_id, action_id)
    except service.OperationalActionError as error:
        _raise(error)


@router.get("/devices/{device_id}/history", response_model=list[OperationalActionRead])
async def get_device_action_history(
    device_id: int,
    request: Request,
    limit: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    tenant_id, _, _ = _context(request)
    try:
        return await service.asset_action_history(db, tenant_id=tenant_id, device_id=device_id, limit=limit)
    except service.OperationalActionError as error:
        _raise(error)


@router.get("/{action_id}", response_model=OperationalActionRead)
async def get_operational_action(
    action_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    tenant_id, _, _ = _context(request)
    try:
        return await _view(db, tenant_id, action_id)
    except service.OperationalActionError as error:
        _raise(error)


@router.get("/{action_id}/history", response_model=list[ActionEventRead])
async def get_operational_action_history(
    action_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    tenant_id, _, _ = _context(request)
    try:
        view = await _view(db, tenant_id, action_id)
        return view["history"]
    except service.OperationalActionError as error:
        _raise(error)


@router.post("/{action_id}/verify", response_model=OperationalActionRead)
async def verify_operational_action(
    action_id: str,
    payload: VerificationRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    tenant_id, actor_id, access_role = _context(request)
    try:
        await service.record_verification(
            db,
            tenant_id=tenant_id,
            actor_id=actor_id,
            access_role=access_role,
            action_id=action_id,
            success=payload.success,
            summary=payload.summary,
            evidence=[item.model_dump() for item in payload.evidence],
        )
        return await _view(db, tenant_id, action_id)
    except service.OperationalActionError as error:
        _raise(error)


@router.post("/{action_id}/rollback", response_model=OperationalActionRead)
async def rollback_operational_action(
    action_id: str,
    payload: RollbackRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    tenant_id, actor_id, access_role = _context(request)
    try:
        await service.request_or_execute_rollback(
            db,
            tenant_id=tenant_id,
            actor_id=actor_id,
            access_role=access_role,
            action_id=action_id,
            execute=payload.execute,
            reason=payload.reason,
            recovery_facts=payload.recovery_facts,
            evidence=[item.model_dump() for item in payload.evidence],
        )
        return await _view(db, tenant_id, action_id)
    except service.OperationalActionError as error:
        _raise(error)


@router.post("/{action_id}/recovery", response_model=OperationalActionRead)
async def recover_operational_action(
    action_id: str,
    payload: RecoveryRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    tenant_id, actor_id, access_role = _context(request)
    try:
        await service.record_recovery(
            db,
            tenant_id=tenant_id,
            actor_id=actor_id,
            access_role=access_role,
            action_id=action_id,
            outcome=payload.outcome,
            summary=payload.summary,
            recovery_facts=payload.recovery_facts,
            evidence=[item.model_dump() for item in payload.evidence],
        )
        return await _view(db, tenant_id, action_id)
    except service.OperationalActionError as error:
        _raise(error)
