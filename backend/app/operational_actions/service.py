from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Iterable
from uuid import uuid4

from fastapi import status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.utils import normalize_json_object
from ..models import models
from .domain import (
    ActionDefinition,
    ActionStatus,
    AdapterExecution,
    OperationalActionDomainError,
    REGISTRY,
    build_preview_token,
    normalize_safe_json,
    require_transition,
    sha256_json,
)


class OperationalActionError(Exception):
    def __init__(self, detail: str, http_status: int = status.HTTP_409_CONFLICT, code: str = "ACTION_CONFLICT"):
        super().__init__(detail)
        self.detail = detail
        self.http_status = http_status
        self.code = code


class ActionNotFound(OperationalActionError):
    def __init__(self, detail: str = "Operational action not found"):
        super().__init__(detail, status.HTTP_404_NOT_FOUND, "ACTION_NOT_FOUND")


class TargetNotFound(OperationalActionError):
    def __init__(self, ids: Iterable[int]):
        self.ids = list(ids)
        super().__init__(
            f"Target Device asset(s) are missing or outside the tenant: {', '.join(str(item) for item in self.ids)}",
            status.HTTP_404_NOT_FOUND,
            "TARGET_NOT_FOUND",
        )


class ActionForbidden(OperationalActionError):
    def __init__(self, detail: str = "The current actor is not allowed to mutate this action"):
        super().__init__(detail, status.HTTP_403_FORBIDDEN, "ACTION_FORBIDDEN")


class ActionBadRequest(OperationalActionError):
    def __init__(self, detail: str):
        super().__init__(detail, status.HTTP_400_BAD_REQUEST, "ACTION_INVALID_REQUEST")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _ensure_safe_object(value: Any, field_name: str) -> dict[str, Any]:
    try:
        normalized = normalize_safe_json(value or {}, field_name=field_name)
    except OperationalActionDomainError as exc:
        raise ActionBadRequest(str(exc)) from exc
    if not isinstance(normalized, dict):
        raise ActionBadRequest(f"{field_name} must be an object")
    return normalized


def _policy_check(*, actor_id: str, access_role: str | None, phase: str) -> None:
    """Narrow authorization seam for later CHG-13 capability adoption.

    The current base exposes only tenant access roles. The seam deliberately
    does not invent a second-approver organization or duplicate CHG-13.
    """

    if (access_role or "").upper() not in {"ADMIN", "EDITOR"}:
        raise ActionForbidden(
            f"Actor '{actor_id}' lacks the current tenant mutation role for action phase '{phase}'"
        )


def _require_action_actor(action: models.OperationalAction, actor_id: str) -> None:
    if action.actor_id != actor_id:
        raise ActionForbidden("The action is bound to the actor that requested it")


def _definition(action: models.OperationalAction) -> ActionDefinition:
    definition = REGISTRY.get_definition(action.action_key)
    adapter = REGISTRY.get_adapter(action.adapter_id)
    if not definition or not adapter or not adapter.supports(definition):
        raise OperationalActionError(
            "The selected capability or adapter is no longer supported",
            status.HTTP_409_CONFLICT,
            "UNSUPPORTED_CAPABILITY_OR_ADAPTER",
        )
    if definition.capability_key != action.capability_key or action.adapter_capability != definition.capability_key:
        raise OperationalActionError(
            "The action capability binding is invalid",
            status.HTTP_409_CONFLICT,
            "UNSUPPORTED_CAPABILITY_OR_ADAPTER",
        )
    return definition


async def _get_action(db: AsyncSession, *, tenant_id: int, action_id: str) -> models.OperationalAction:
    result = await db.execute(
        select(models.OperationalAction).where(
            models.OperationalAction.id == action_id,
            models.OperationalAction.tenant_id == tenant_id,
        )
    )
    action = result.scalar_one_or_none()
    if action is None:
        raise ActionNotFound()
    return action


async def _get_target_rows(db: AsyncSession, action_id: str) -> list[models.OperationalActionTarget]:
    result = await db.execute(
        select(models.OperationalActionTarget)
        .where(models.OperationalActionTarget.action_id == action_id)
        .order_by(models.OperationalActionTarget.device_id.asc())
    )
    return list(result.scalars().all())


async def _target_snapshots(
    db: AsyncSession,
    *,
    tenant_id: int,
    device_ids: Iterable[int],
) -> tuple[list[dict[str, Any]], dict[int, models.Device]]:
    normalized_ids = list(dict.fromkeys(int(item) for item in device_ids))
    result = await db.execute(
        select(models.Device).where(
            models.Device.id.in_(normalized_ids),
            models.Device.tenant_id == tenant_id,
            models.Device.is_deleted == False,
        )
    )
    devices = {device.id: device for device in result.scalars().all()}
    missing = [device_id for device_id in normalized_ids if device_id not in devices]
    if missing:
        raise TargetNotFound(missing)

    snapshots: list[dict[str, Any]] = []
    for device_id in normalized_ids:
        device = devices[device_id]
        snapshots.append(
            {
                "device_id": device.id,
                "tenant_id": device.tenant_id,
                "name": device.name,
                "system": device.system,
                "environment": device.environment,
                "status": device.status,
                "type": device.type,
                "role": device.role,
                "is_deleted": bool(device.is_deleted),
                "updated_at": _iso(device.updated_at),
            }
        )
    return snapshots, devices


def _target_set_hash(snapshots: list[dict[str, Any]]) -> str:
    return sha256_json(snapshots)


async def _append_event(
    db: AsyncSession,
    *,
    action: models.OperationalAction,
    event_type: str,
    from_status: str | None,
    to_status: str,
    actor_id: str,
    message: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    sequence_result = await db.execute(
        select(func.max(models.OperationalActionEvent.sequence)).where(
            models.OperationalActionEvent.action_id == action.id
        )
    )
    sequence = int(sequence_result.scalar() or 0) + 1
    db.add(
        models.OperationalActionEvent(
            id=str(uuid4()),
            action_id=action.id,
            tenant_id=action.tenant_id,
            sequence=sequence,
            event_type=event_type,
            from_status=from_status,
            to_status=to_status,
            actor_id=actor_id,
            message=message,
            details=normalize_json_object(details or {}),
            occurred_at=_now(),
        )
    )
    # Multiple state transitions can be recorded before one commit (for
    # example authorize+confirm). Flush so the next sequence lookup observes
    # the just-appended event rather than reusing its sequence number.
    await db.flush()


async def _audit(
    db: AsyncSession,
    *,
    actor_id: str,
    action: str,
    action_id: str,
    details: dict[str, Any],
) -> None:
    db.add(
        models.AuditLog(
            user_id=actor_id,
            action=action,
            target_table="operational_actions",
            target_id=action_id,
            description=f"Operational action {action.lower()}",
            changes=normalize_json_object(details),
        )
    )


async def _transition(
    db: AsyncSession,
    *,
    action: models.OperationalAction,
    target_status: str,
    actor_id: str,
    event_type: str,
    message: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    current = action.status
    require_transition(current, target_status)
    action.status = target_status
    await _append_event(
        db,
        action=action,
        event_type=event_type,
        from_status=current,
        to_status=target_status,
        actor_id=actor_id,
        message=message,
        details=details,
    )


async def _mark_stale(
    db: AsyncSession,
    *,
    action: models.OperationalAction,
    actor_id: str,
    reason: str,
) -> None:
    if action.status != ActionStatus.STALE:
        await _transition(
            db,
            action=action,
            target_status=ActionStatus.STALE,
            actor_id=actor_id,
            event_type="preview_stale",
            message="The preview binding no longer matches current target or precondition state.",
            details={"reason": reason},
        )
    action.authorization_facts = {}
    action.approval_facts = {}
    action.confirmation_facts = {}
    action.authorized_at = None
    action.confirmed_at = None


async def _ensure_fresh_preview(
    db: AsyncSession,
    *,
    action: models.OperationalAction,
    tenant_id: int,
    actor_id: str,
    preview_token: str,
) -> list[int]:
    _require_action_actor(action, actor_id)
    if not action.preview_token or preview_token != action.preview_token:
        raise OperationalActionError("The preview token does not match this action", code="PREVIEW_TOKEN_MISMATCH")
    expires_at = action.preview_expires_at
    if expires_at is None or (expires_at.replace(tzinfo=timezone.utc) if expires_at.tzinfo is None else expires_at) <= _now():
        await _mark_stale(db, action=action, actor_id=actor_id, reason="preview_expired")
        await db.commit()
        raise OperationalActionError("The preview has expired and must be regenerated", code="STALE_PREVIEW")

    target_rows = await _get_target_rows(db, action.id)
    target_ids = [row.device_id for row in target_rows]
    try:
        snapshots, _ = await _target_snapshots(db, tenant_id=tenant_id, device_ids=target_ids)
    except TargetNotFound as exc:
        await _mark_stale(db, action=action, actor_id=actor_id, reason="target_missing_or_cross_tenant")
        await db.commit()
        raise OperationalActionError(str(exc), code="STALE_PREVIEW") from exc

    current_hash = _target_set_hash(snapshots)
    bound_targets = action.precondition_snapshot.get("targets", []) if action.precondition_snapshot else []
    if (
        current_hash != action.target_set_hash
        or snapshots != bound_targets
        or any(snapshot.get("status") == "Decommissioned" for snapshot in snapshots)
    ):
        await _mark_stale(db, action=action, actor_id=actor_id, reason="target_or_precondition_revision_changed")
        await db.commit()
        raise OperationalActionError(
            "The preview is stale because a target or bound precondition changed",
            code="STALE_PREVIEW",
        )
    return target_ids


async def _add_evidence(
    db: AsyncSession,
    *,
    action: models.OperationalAction,
    actor_id: str,
    evidence: list[dict[str, Any]],
    evidence_type_prefix: str,
) -> list[dict[str, Any]]:
    references: list[dict[str, Any]] = []
    for item in evidence:
        clean = _ensure_safe_object(item, "evidence")
        evidence_id = str(uuid4())
        db.add(
            models.OperationalActionEvidence(
                id=evidence_id,
                action_id=action.id,
                tenant_id=action.tenant_id,
                evidence_type=f"{evidence_type_prefix}:{clean.get('evidence_type', 'record')}",
                success=clean.get("success"),
                summary=str(clean.get("summary") or ""),
                reference=clean.get("reference"),
                metadata_json=clean.get("metadata") or {},
                recorded_by=actor_id,
                created_at=_now(),
            )
        )
        references.append({
            "id": evidence_id,
            "evidence_type": f"{evidence_type_prefix}:{clean.get('evidence_type', 'record')}",
            "summary": clean.get("summary"),
            "reference": clean.get("reference"),
        })
    return references


async def create_action(
    db: AsyncSession,
    *,
    tenant_id: int,
    actor_id: str,
    access_role: str | None,
    request_id: str,
    action_key: str,
    capability_key: str | None,
    adapter_id: str,
    parameters: dict[str, Any],
    target_device_ids: list[int],
    idempotency_key: str,
    maintenance_window_id: int | None,
    change_context: dict[str, Any],
    ticket_reference: str | None,
) -> models.OperationalAction:
    _policy_check(actor_id=actor_id, access_role=access_role, phase="create")
    if not idempotency_key.strip():
        raise ActionBadRequest("An Idempotency-Key or idempotency_key is required")
    definition = REGISTRY.get_definition(action_key)
    adapter = REGISTRY.get_adapter(adapter_id)
    requested_capability = capability_key or (definition.capability_key if definition else None)
    if not definition or not requested_capability or not REGISTRY.supports(
        action_key=action_key,
        capability_key=requested_capability,
        adapter_id=adapter_id,
    ):
        raise OperationalActionError(
            "The requested capability, action, or adapter is unsupported",
            code="UNSUPPORTED_CAPABILITY_OR_ADAPTER",
        )

    clean_parameters = _ensure_safe_object(parameters, "parameters")
    clean_context = _ensure_safe_object(change_context, "change_context")
    if ticket_reference:
        clean_context["ticket_reference"] = ticket_reference.strip()
    normalized_ids = list(dict.fromkeys(int(item) for item in target_device_ids))
    request_hash = sha256_json({
        "tenant_id": tenant_id,
        "actor_id": actor_id,
        "target_device_ids": normalized_ids,
        "action_key": action_key,
        "capability_key": requested_capability,
        "adapter_id": adapter_id,
        "parameters": clean_parameters,
        "maintenance_window_id": maintenance_window_id,
        "change_context": clean_context,
    })

    existing_result = await db.execute(
        select(models.OperationalAction).where(
            models.OperationalAction.tenant_id == tenant_id,
            models.OperationalAction.actor_id == actor_id,
            models.OperationalAction.idempotency_key == idempotency_key,
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        if existing.request_hash != request_hash:
            raise OperationalActionError(
                "The idempotency key is already bound to a different request",
                code="IDEMPOTENCY_KEY_REUSE",
            )
        return existing

    snapshots, _ = await _target_snapshots(db, tenant_id=tenant_id, device_ids=normalized_ids)
    if maintenance_window_id is not None:
        maintenance_result = await db.execute(
            select(models.MaintenanceWindow).where(models.MaintenanceWindow.id == maintenance_window_id)
        )
        maintenance = maintenance_result.scalar_one_or_none()
        if maintenance is None:
            raise ActionBadRequest("The maintenance window context does not exist")
        if maintenance.device_id not in normalized_ids:
            raise ActionBadRequest("The maintenance window must reference one of the action targets")

    action_id = str(uuid4())
    target_hash = _target_set_hash(snapshots)
    action = models.OperationalAction(
        id=action_id,
        tenant_id=tenant_id,
        actor_id=actor_id,
        action_key=definition.action_key,
        capability_key=definition.capability_key,
        adapter_id=adapter_id,
        adapter_capability=definition.capability_key,
        normalized_parameters=clean_parameters,
        parameters_hash=sha256_json(clean_parameters),
        target_set_hash=target_hash,
        risk_tier=definition.risk_tier,
        risk_facts={
            "risk_tier": definition.risk_tier,
            "reversible": definition.reversible,
            "requires_approval": definition.requires_approval,
            "requires_recovery_facts": definition.requires_recovery_facts,
        },
        precondition_snapshot={"targets": snapshots, "requirements": ["target_exists", "not_deleted"]},
        authorization_facts={},
        approval_facts={},
        recovery_facts={},
        confirmation_facts={},
        rollback_plan={
            "available": definition.reversible,
            "adapter_id": adapter.adapter_id if adapter else adapter_id,
            "mode": "deterministic_recording_simulation",
            "requires_recovery_facts": definition.requires_recovery_facts,
        },
        execution_result={},
        verification_evidence=[],
        rollback_outcome={},
        request_hash=request_hash,
        idempotency_key=idempotency_key,
        request_id=request_id,
        maintenance_window_id=maintenance_window_id,
        change_context=clean_context,
        status=ActionStatus.CREATED,
        requested_at=_now(),
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(action)
    for snapshot in snapshots:
        db.add(
            models.OperationalActionTarget(
                id=str(uuid4()),
                action_id=action_id,
                tenant_id=tenant_id,
                device_id=int(snapshot["device_id"]),
                target_revision=sha256_json(snapshot),
                target_snapshot=snapshot,
                created_at=_now(),
            )
        )
    await _append_event(
        db,
        action=action,
        event_type="requested",
        from_status=None,
        to_status=ActionStatus.CREATED,
        actor_id=actor_id,
        message="Operational action request recorded; no execution occurred.",
        details={"request_hash": request_hash, "target_count": len(snapshots)},
    )
    await _audit(
        db,
        actor_id=actor_id,
        action="REQUEST",
        action_id=action_id,
        details={"request_hash": request_hash, "action_key": action_key, "target_count": len(snapshots)},
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        retry = await db.execute(
            select(models.OperationalAction).where(
                models.OperationalAction.tenant_id == tenant_id,
                models.OperationalAction.actor_id == actor_id,
                models.OperationalAction.idempotency_key == idempotency_key,
            )
        )
        existing = retry.scalar_one_or_none()
        if existing and existing.request_hash == request_hash:
            return existing
        raise OperationalActionError("The action request could not be recorded safely", code="ACTION_RECORD_CONFLICT")
    await db.refresh(action)
    return action


async def preview_action(
    db: AsyncSession,
    *,
    tenant_id: int,
    actor_id: str,
    access_role: str | None,
    action_id: str,
) -> models.OperationalAction:
    _policy_check(actor_id=actor_id, access_role=access_role, phase="preview")
    action = await _get_action(db, tenant_id=tenant_id, action_id=action_id)
    _require_action_actor(action, actor_id)
    if action.status not in {ActionStatus.CREATED, ActionStatus.PREVIEWED, ActionStatus.STALE}:
        raise OperationalActionError("A new preview is not legal after authorization or execution")
    definition = _definition(action)
    target_rows = await _get_target_rows(db, action.id)
    target_ids = [row.device_id for row in target_rows]
    try:
        snapshots, _ = await _target_snapshots(db, tenant_id=tenant_id, device_ids=target_ids)
        if any(snapshot.get("status") == "Decommissioned" for snapshot in snapshots):
            await _mark_stale(db, action=action, actor_id=actor_id, reason="target_decommissioned")
            await _audit(db, actor_id=actor_id, action="PREVIEW_REJECTED", action_id=action.id, details={"reason": "target_decommissioned"})
            await db.commit()
            raise OperationalActionError("A decommissioned Device cannot satisfy the action preconditions", code="PRECONDITION_FAILED")
    except TargetNotFound as exc:
        await _mark_stale(db, action=action, actor_id=actor_id, reason="target_missing_or_cross_tenant")
        await _audit(db, actor_id=actor_id, action="PREVIEW_REJECTED", action_id=action.id, details={"reason": "target_missing_or_cross_tenant"})
        await db.commit()
        raise OperationalActionError(str(exc), code="TARGET_NOT_FOUND") from exc

    target_hash = _target_set_hash(snapshots)
    preconditions = {
        "targets": snapshots,
        "requirements": ["target_exists", "not_deleted", "not_decommissioned", "adapter_supported"],
        "target_set_hash": target_hash,
    }
    precondition_hash = sha256_json(preconditions)
    expires_at = _now() + timedelta(minutes=15)
    binding = {
        "tenant_id": tenant_id,
        "actor_id": actor_id,
        "action_key": action.action_key,
        "capability_key": action.capability_key,
        "adapter_id": action.adapter_id,
        "parameters_hash": action.parameters_hash,
        "target_set_hash": target_hash,
        "precondition_hash": precondition_hash,
        "risk_tier": action.risk_tier,
        "expires_at": expires_at.isoformat(),
    }
    action.target_set_hash = target_hash
    action.precondition_snapshot = preconditions
    action.precondition_hash = precondition_hash
    action.preview_expires_at = expires_at
    action.preview_token = build_preview_token(
        tenant_id=tenant_id,
        actor_id=actor_id,
        action_id=action.id,
        binding=binding,
    )
    action.previewed_at = _now()
    action.authorization_facts = {}
    action.approval_facts = {}
    action.recovery_facts = {}
    action.confirmation_facts = {}
    action.authorized_at = None
    action.confirmed_at = None
    for row, snapshot in zip(target_rows, snapshots):
        row.target_revision = sha256_json(snapshot)
        row.target_snapshot = snapshot
    await _transition(
        db,
        action=action,
        target_status=ActionStatus.PREVIEWED,
        actor_id=actor_id,
        event_type="previewed",
        message="Authoritative preview binding recorded; execution remains blocked until confirmation.",
        details={"target_set_hash": target_hash, "precondition_hash": precondition_hash, "risk_tier": definition.risk_tier},
    )
    await _audit(
        db,
        actor_id=actor_id,
        action="PREVIEW",
        action_id=action.id,
        details={"target_set_hash": target_hash, "precondition_hash": precondition_hash},
    )
    await db.commit()
    await db.refresh(action)
    return action


async def authorize_action(
    db: AsyncSession,
    *,
    tenant_id: int,
    actor_id: str,
    access_role: str | None,
    action_id: str,
    preview_token: str,
    approval_facts: dict[str, Any],
    recovery_facts: dict[str, Any],
    confirm: bool,
) -> models.OperationalAction:
    _policy_check(actor_id=actor_id, access_role=access_role, phase="authorize")
    action = await _get_action(db, tenant_id=tenant_id, action_id=action_id)
    _require_action_actor(action, actor_id)
    if action.status not in {ActionStatus.PREVIEWED, ActionStatus.AUTHORIZED}:
        raise OperationalActionError("Authorization is only legal after a current preview")
    definition = _definition(action)
    await _ensure_fresh_preview(
        db,
        action=action,
        tenant_id=tenant_id,
        actor_id=actor_id,
        preview_token=preview_token,
    )
    clean_approval = _ensure_safe_object(approval_facts, "approval_facts")
    clean_recovery = _ensure_safe_object(recovery_facts, "recovery_facts")
    if definition.requires_approval and not clean_approval:
        raise OperationalActionError("This risk tier requires approval facts before authorization", code="APPROVAL_FACTS_REQUIRED")
    if definition.requires_recovery_facts and not clean_recovery:
        raise OperationalActionError("This risk tier requires recovery facts before authorization", code="RECOVERY_FACTS_REQUIRED")

    action.approval_facts = clean_approval
    action.recovery_facts = clean_recovery
    action.authorization_facts = {
        "actor_id": actor_id,
        "access_role": (access_role or "").upper(),
        "policy_version": "current-tenant-role-seam-v1",
        "facts_hash": sha256_json({"approval": clean_approval, "recovery": clean_recovery}),
    }
    action.authorized_at = _now()
    if action.status == ActionStatus.PREVIEWED:
        await _transition(
            db,
            action=action,
            target_status=ActionStatus.AUTHORIZED,
            actor_id=actor_id,
            event_type="authorized",
            message="Authorization facts recorded; execution is still blocked until confirmation.",
            details={"risk_tier": definition.risk_tier, "approval_required": definition.requires_approval},
        )
    if confirm:
        action.confirmation_facts = {"actor_id": actor_id, "confirmed": True, "method": "authorize"}
        action.confirmed_at = _now()
        await _transition(
            db,
            action=action,
            target_status=ActionStatus.CONFIRMED,
            actor_id=actor_id,
            event_type="confirmed",
            message="Explicit operator confirmation recorded; execution may proceed if preview remains fresh.",
            details={"risk_tier": definition.risk_tier},
        )
    await _audit(
        db,
        actor_id=actor_id,
        action="CONFIRM" if confirm else "AUTHORIZE",
        action_id=action.id,
        details={"risk_tier": definition.risk_tier, "facts_hash": action.authorization_facts["facts_hash"]},
    )
    await db.commit()
    await db.refresh(action)
    return action


async def confirm_action(
    db: AsyncSession,
    *,
    tenant_id: int,
    actor_id: str,
    access_role: str | None,
    action_id: str,
    preview_token: str,
    confirmation: bool,
) -> models.OperationalAction:
    _policy_check(actor_id=actor_id, access_role=access_role, phase="confirm")
    if not confirmation:
        raise OperationalActionError("Explicit confirmation is required", code="CONFIRMATION_REQUIRED")
    action = await _get_action(db, tenant_id=tenant_id, action_id=action_id)
    _require_action_actor(action, actor_id)
    if action.status not in {ActionStatus.PREVIEWED, ActionStatus.AUTHORIZED}:
        raise OperationalActionError("Confirmation is only legal after a current preview")
    definition = _definition(action)
    await _ensure_fresh_preview(
        db,
        action=action,
        tenant_id=tenant_id,
        actor_id=actor_id,
        preview_token=preview_token,
    )
    if definition.requires_approval and not action.approval_facts:
        raise OperationalActionError("This risk tier requires authorization facts before confirmation", code="APPROVAL_FACTS_REQUIRED")
    if definition.requires_recovery_facts and not action.recovery_facts:
        raise OperationalActionError("This risk tier requires recovery facts before confirmation", code="RECOVERY_FACTS_REQUIRED")
    if not action.authorization_facts:
        action.authorization_facts = {
            "actor_id": actor_id,
            "access_role": (access_role or "").upper(),
            "policy_version": "current-tenant-role-seam-v1",
            "approval_required": False,
        }
        action.authorized_at = _now()
    action.confirmation_facts = {"actor_id": actor_id, "confirmed": True, "method": "confirm"}
    action.confirmed_at = _now()
    await _transition(
        db,
        action=action,
        target_status=ActionStatus.CONFIRMED,
        actor_id=actor_id,
        event_type="confirmed",
        message="Explicit operator confirmation recorded; execution may proceed if preview remains fresh.",
        details={"risk_tier": definition.risk_tier},
    )
    await _audit(db, actor_id=actor_id, action="CONFIRM", action_id=action.id, details={"risk_tier": definition.risk_tier})
    await db.commit()
    await db.refresh(action)
    return action


def _outcome_status(action: models.OperationalAction, success: bool) -> str:
    return ActionStatus.SUCCEEDED if success else ActionStatus.FAILED


async def _record_adapter_progress(
    db: AsyncSession,
    *,
    action: models.OperationalAction,
    actor_id: str,
    execution: AdapterExecution,
    event_prefix: str,
) -> None:
    for progress in execution.progress:
        action.progress_percent = max(0, min(100, progress.percent))
        action.progress_message = progress.message
        await _append_event(
            db,
            action=action,
            event_type=f"{event_prefix}_progress",
            from_status=action.status,
            to_status=action.status,
            actor_id=actor_id,
            message=progress.message,
            details={"percent": action.progress_percent, "external_side_effect": False},
        )
        await db.commit()


async def execute_action(
    db: AsyncSession,
    *,
    tenant_id: int,
    actor_id: str,
    access_role: str | None,
    action_id: str,
    preview_token: str,
) -> models.OperationalAction:
    _policy_check(actor_id=actor_id, access_role=access_role, phase="execute")
    action = await _get_action(db, tenant_id=tenant_id, action_id=action_id)
    _require_action_actor(action, actor_id)
    if action.status in {
        ActionStatus.SUCCEEDED,
        ActionStatus.FAILED,
        ActionStatus.VERIFIED,
        ActionStatus.VERIFICATION_FAILED,
        ActionStatus.ROLLED_BACK,
        ActionStatus.RECOVERED,
    }:
        return action
    if action.status == ActionStatus.EXECUTING:
        raise OperationalActionError("Execution is already in progress", code="EXECUTION_IN_PROGRESS")
    if action.status != ActionStatus.CONFIRMED:
        raise OperationalActionError("Execution requires authorization and explicit confirmation", code="CONFIRMATION_REQUIRED")
    definition = _definition(action)
    await _ensure_fresh_preview(
        db,
        action=action,
        tenant_id=tenant_id,
        actor_id=actor_id,
        preview_token=preview_token,
    )
    if not action.authorization_facts or not action.confirmation_facts:
        raise OperationalActionError("Authorization and confirmation facts are required", code="AUTHORIZATION_FACTS_REQUIRED")

    claimed = await db.execute(
        update(models.OperationalAction)
        .where(
            models.OperationalAction.id == action.id,
            models.OperationalAction.tenant_id == tenant_id,
            models.OperationalAction.status == ActionStatus.CONFIRMED,
        )
        .values(status=ActionStatus.EXECUTING, started_at=_now(), progress_percent=0)
    )
    if claimed.rowcount != 1:
        await db.rollback()
        current = await _get_action(db, tenant_id=tenant_id, action_id=action_id)
        if current.status in {ActionStatus.SUCCEEDED, ActionStatus.FAILED, ActionStatus.VERIFIED, ActionStatus.VERIFICATION_FAILED}:
            return current
        raise OperationalActionError("Execution could not claim the confirmed action safely", code="EXECUTION_CONFLICT")
    action.status = ActionStatus.EXECUTING
    action.started_at = _now()
    await _append_event(
        db,
        action=action,
        event_type="execution_started",
        from_status=ActionStatus.CONFIRMED,
        to_status=ActionStatus.EXECUTING,
        actor_id=actor_id,
        message="Selected adapter entered synchronous simulation; no external system was contacted.",
        details={"adapter_id": action.adapter_id, "production_capable": False},
    )
    await _audit(db, actor_id=actor_id, action="EXECUTE", action_id=action.id, details={"adapter_id": action.adapter_id})
    await db.commit()
    await db.refresh(action)

    adapter = REGISTRY.get_adapter(action.adapter_id)
    if not adapter or not adapter.supports(definition):
        raise OperationalActionError("The selected adapter is unsupported", code="UNSUPPORTED_CAPABILITY_OR_ADAPTER")
    target_rows = await _get_target_rows(db, action.id)
    target_ids = [row.device_id for row in target_rows]
    try:
        execution = adapter.execute(action_id=action.id, target_ids=target_ids, parameters=action.normalized_parameters)
    except Exception:
        execution = AdapterExecution(
            progress=(),
            success=False,
            result={"mode": "deterministic_recording_simulation", "performed": False, "error": "adapter_failure"},
        )
    await _record_adapter_progress(db, action=action, actor_id=actor_id, execution=execution, event_prefix="execution")
    action.execution_result = normalize_json_object(execution.result)
    action.finished_at = _now()
    action.progress_percent = 100 if execution.success else action.progress_percent
    await _transition(
        db,
        action=action,
        target_status=_outcome_status(action, execution.success),
        actor_id=actor_id,
        event_type="execution_result",
        message="Simulation result recorded; no external system was changed.",
        details={"success": execution.success, "external_side_effect": False},
    )
    await db.commit()
    await db.refresh(action)
    return action


async def record_verification(
    db: AsyncSession,
    *,
    tenant_id: int,
    actor_id: str,
    access_role: str | None,
    action_id: str,
    success: bool,
    summary: str,
    evidence: list[dict[str, Any]],
) -> models.OperationalAction:
    _policy_check(actor_id=actor_id, access_role=access_role, phase="verify")
    action = await _get_action(db, tenant_id=tenant_id, action_id=action_id)
    if action.status in {ActionStatus.VERIFIED, ActionStatus.VERIFICATION_FAILED}:
        return action
    if action.status != ActionStatus.SUCCEEDED:
        raise OperationalActionError("Verification requires a recorded successful execution")
    references = await _add_evidence(db, action=action, actor_id=actor_id, evidence=evidence, evidence_type_prefix="verification")
    action.verification_summary = summary.strip()
    action.verification_evidence = references
    action.verified_at = _now()
    await _transition(
        db,
        action=action,
        target_status=ActionStatus.VERIFIED if success else ActionStatus.VERIFICATION_FAILED,
        actor_id=actor_id,
        event_type="verification_recorded",
        message="Verification evidence recorded against the durable action lineage.",
        details={"success": success, "evidence_count": len(references)},
    )
    await _audit(db, actor_id=actor_id, action="VERIFY", action_id=action.id, details={"success": success, "evidence_count": len(references)})
    await db.commit()
    await db.refresh(action)
    return action


async def request_or_execute_rollback(
    db: AsyncSession,
    *,
    tenant_id: int,
    actor_id: str,
    access_role: str | None,
    action_id: str,
    execute: bool,
    reason: str,
    recovery_facts: dict[str, Any],
    evidence: list[dict[str, Any]],
) -> models.OperationalAction:
    _policy_check(actor_id=actor_id, access_role=access_role, phase="rollback")
    action = await _get_action(db, tenant_id=tenant_id, action_id=action_id)
    _require_action_actor(action, actor_id)
    if action.status in {ActionStatus.ROLLED_BACK, ActionStatus.RECOVERED}:
        return action
    definition = _definition(action)
    if not definition.reversible:
        raise OperationalActionError("This action definition has no rollback capability", code="ROLLBACK_UNSUPPORTED")
    allowed = {
        ActionStatus.SUCCEEDED,
        ActionStatus.VERIFIED,
        ActionStatus.FAILED,
        ActionStatus.VERIFICATION_FAILED,
        ActionStatus.ROLLBACK_REQUESTED,
        ActionStatus.ROLLBACK_FAILED,
        ActionStatus.RECOVERY_REQUIRED,
    }
    if action.status not in allowed:
        raise OperationalActionError("Rollback is not legal in the current action state")
    clean_recovery = _ensure_safe_object(recovery_facts, "recovery_facts")
    if definition.requires_recovery_facts and not (clean_recovery or action.recovery_facts):
        raise OperationalActionError("This risk tier requires recovery facts before rollback", code="RECOVERY_FACTS_REQUIRED")
    action.recovery_facts = clean_recovery or action.recovery_facts or {}
    action.rollback_outcome = {
        "requested": True,
        "requested_by": actor_id,
        "reason": reason.strip(),
        "recovery_facts_hash": sha256_json(action.recovery_facts),
        "external_side_effect": False,
    }
    if evidence:
        await _add_evidence(db, action=action, actor_id=actor_id, evidence=evidence, evidence_type_prefix="rollback")
    if action.status != ActionStatus.ROLLBACK_REQUESTED:
        await _transition(
            db,
            action=action,
            target_status=ActionStatus.ROLLBACK_REQUESTED,
            actor_id=actor_id,
            event_type="rollback_requested",
            message="Rollback/recovery request recorded; execution is optional and remains simulation-only.",
            details={"reason": reason.strip()},
        )
    if not execute:
        await _audit(db, actor_id=actor_id, action="ROLLBACK_REQUEST", action_id=action.id, details={"reason": reason.strip()})
        await db.commit()
        await db.refresh(action)
        return action

    await _transition(
        db,
        action=action,
        target_status=ActionStatus.ROLLING_BACK,
        actor_id=actor_id,
        event_type="rollback_started",
        message="Selected adapter entered synchronous simulation rollback; no external system was contacted.",
        details={"adapter_id": action.adapter_id, "production_capable": False},
    )
    await db.commit()
    await db.refresh(action)
    adapter = REGISTRY.get_adapter(action.adapter_id)
    target_rows = await _get_target_rows(db, action.id)
    target_ids = [row.device_id for row in target_rows]
    try:
        execution = adapter.rollback(action_id=action.id, target_ids=target_ids, parameters=action.normalized_parameters) if adapter else AdapterExecution((), False, {"error": "adapter_missing"})
    except Exception:
        execution = AdapterExecution((), False, {"error": "adapter_failure", "performed": False})
    await _record_adapter_progress(db, action=action, actor_id=actor_id, execution=execution, event_prefix="rollback")
    action.rollback_outcome = {
        **action.rollback_outcome,
        "completed": True,
        "success": execution.success,
        "result": normalize_json_object(execution.result),
    }
    if execution.success:
        action.rolled_back_at = _now()
    await _transition(
        db,
        action=action,
        target_status=ActionStatus.ROLLED_BACK if execution.success else ActionStatus.ROLLBACK_FAILED,
        actor_id=actor_id,
        event_type="rollback_result",
        message="Rollback simulation result recorded; no external system was changed.",
        details={"success": execution.success, "external_side_effect": False},
    )
    await _audit(db, actor_id=actor_id, action="ROLLBACK", action_id=action.id, details={"success": execution.success})
    await db.commit()
    await db.refresh(action)
    return action


async def record_recovery(
    db: AsyncSession,
    *,
    tenant_id: int,
    actor_id: str,
    access_role: str | None,
    action_id: str,
    outcome: str,
    summary: str,
    recovery_facts: dict[str, Any],
    evidence: list[dict[str, Any]],
) -> models.OperationalAction:
    _policy_check(actor_id=actor_id, access_role=access_role, phase="recover")
    action = await _get_action(db, tenant_id=tenant_id, action_id=action_id)
    _require_action_actor(action, actor_id)
    if action.status in {ActionStatus.ROLLED_BACK, ActionStatus.RECOVERED}:
        return action
    if action.status not in {
        ActionStatus.FAILED,
        ActionStatus.VERIFICATION_FAILED,
        ActionStatus.ROLLBACK_FAILED,
        ActionStatus.RECOVERY_REQUIRED,
    }:
        raise OperationalActionError("Recovery evidence is not legal in the current action state")
    clean_facts = _ensure_safe_object(recovery_facts, "recovery_facts")
    if outcome == "resolved" and not (clean_facts or action.recovery_facts):
        raise OperationalActionError("Resolved recovery requires recovery facts", code="RECOVERY_FACTS_REQUIRED")
    action.recovery_facts = clean_facts or action.recovery_facts or {}
    references = await _add_evidence(db, action=action, actor_id=actor_id, evidence=evidence, evidence_type_prefix="recovery")
    action.rollback_outcome = {
        **(action.rollback_outcome or {}),
        "recovery": {
            "outcome": outcome,
            "summary": summary.strip(),
            "evidence": references,
            "recorded_by": actor_id,
            "facts_hash": sha256_json(action.recovery_facts),
            "external_side_effect": False,
        },
    }
    if action.status != ActionStatus.RECOVERY_REQUIRED:
        await _transition(
            db,
            action=action,
            target_status=ActionStatus.RECOVERY_REQUIRED,
            actor_id=actor_id,
            event_type="recovery_requested",
            message="Recovery outcome is being recorded against the action lineage.",
            details={"outcome": outcome},
        )
    if outcome == "resolved":
        await _transition(
            db,
            action=action,
            target_status=ActionStatus.RECOVERED,
            actor_id=actor_id,
            event_type="recovery_recorded",
            message="Recovery evidence recorded as resolved; no external recovery operation was performed.",
            details={"evidence_count": len(references)},
        )
    else:
        await _append_event(
            db,
            action=action,
            event_type="recovery_recorded",
            from_status=action.status,
            to_status=action.status,
            actor_id=actor_id,
            message="Recovery evidence recorded as unresolved; action remains recovery-required.",
            details={"evidence_count": len(references)},
        )
    await _audit(db, actor_id=actor_id, action="RECOVER", action_id=action.id, details={"outcome": outcome, "evidence_count": len(references)})
    await db.commit()
    await db.refresh(action)
    return action


def _event_dict(event: models.OperationalActionEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "sequence": event.sequence,
        "event_type": event.event_type,
        "from_status": event.from_status,
        "to_status": event.to_status,
        "actor_id": event.actor_id,
        "message": event.message,
        "details": event.details or {},
        "occurred_at": event.occurred_at,
    }


def _evidence_dict(evidence: models.OperationalActionEvidence) -> dict[str, Any]:
    return {
        "id": evidence.id,
        "evidence_type": evidence.evidence_type,
        "success": evidence.success,
        "summary": evidence.summary,
        "reference": evidence.reference,
        "metadata": evidence.metadata_json or {},
        "recorded_by": evidence.recorded_by,
        "created_at": evidence.created_at,
    }


async def action_view(db: AsyncSession, *, tenant_id: int, action_id: str) -> dict[str, Any]:
    action = await _get_action(db, tenant_id=tenant_id, action_id=action_id)
    target_rows = await _get_target_rows(db, action.id)
    event_result = await db.execute(
        select(models.OperationalActionEvent)
        .where(models.OperationalActionEvent.action_id == action.id)
        .order_by(models.OperationalActionEvent.sequence.asc())
    )
    evidence_result = await db.execute(
        select(models.OperationalActionEvidence)
        .where(models.OperationalActionEvidence.action_id == action.id)
        .order_by(models.OperationalActionEvidence.created_at.asc(), models.OperationalActionEvidence.id.asc())
    )
    return {
        "id": action.id,
        "tenant_id": action.tenant_id,
        "actor_id": action.actor_id,
        "action_key": action.action_key,
        "capability_key": action.capability_key,
        "adapter_id": action.adapter_id,
        "adapter_capability": action.adapter_capability,
        "normalized_parameters": action.normalized_parameters or {},
        "parameters_hash": action.parameters_hash,
        "target_set_hash": action.target_set_hash,
        "risk_tier": action.risk_tier,
        "risk_facts": action.risk_facts or {},
        "precondition_snapshot": action.precondition_snapshot or {},
        "precondition_hash": action.precondition_hash,
        "preview_token": action.preview_token,
        "preview_expires_at": action.preview_expires_at,
        "authorization_facts": action.authorization_facts or {},
        "approval_facts": action.approval_facts or {},
        "recovery_facts": action.recovery_facts or {},
        "confirmation_facts": action.confirmation_facts or {},
        "rollback_plan": action.rollback_plan or {},
        "execution_result": action.execution_result or {},
        "verification_summary": action.verification_summary,
        "verification_evidence": action.verification_evidence or [],
        "rollback_outcome": action.rollback_outcome or {},
        "request_hash": action.request_hash,
        "idempotency_key": action.idempotency_key,
        "request_id": action.request_id,
        "maintenance_window_id": action.maintenance_window_id,
        "change_context": action.change_context or {},
        "status": action.status,
        "progress_percent": action.progress_percent,
        "progress_message": action.progress_message,
        "requested_at": action.requested_at,
        "previewed_at": action.previewed_at,
        "authorized_at": action.authorized_at,
        "confirmed_at": action.confirmed_at,
        "started_at": action.started_at,
        "finished_at": action.finished_at,
        "verified_at": action.verified_at,
        "rolled_back_at": action.rolled_back_at,
        "created_at": action.created_at,
        "updated_at": action.updated_at,
        "targets": [
            {
                "id": row.id,
                "device_id": row.device_id,
                "target_revision": row.target_revision,
                "target_snapshot": row.target_snapshot or {},
            }
            for row in target_rows
        ],
        "history": [_event_dict(event) for event in event_result.scalars().all()],
        "evidence": [_evidence_dict(item) for item in evidence_result.scalars().all()],
    }


async def asset_action_history(
    db: AsyncSession,
    *,
    tenant_id: int,
    device_id: int,
    limit: int = 100,
) -> list[dict[str, Any]]:
    action_result = await db.execute(
        select(models.OperationalAction.id)
        .join(
            models.OperationalActionTarget,
            models.OperationalActionTarget.action_id == models.OperationalAction.id,
        )
        .where(
            models.OperationalAction.tenant_id == tenant_id,
            models.OperationalActionTarget.tenant_id == tenant_id,
            models.OperationalActionTarget.device_id == device_id,
        )
        .order_by(models.OperationalAction.created_at.desc())
        .limit(min(max(limit, 1), 500))
    )
    return [await action_view(db, tenant_id=tenant_id, action_id=action_id) for action_id in action_result.scalars().all()]


async def list_actions(
    db: AsyncSession,
    *,
    tenant_id: int,
    status_filter: str | None = None,
    device_id: int | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    query = select(models.OperationalAction.id).where(models.OperationalAction.tenant_id == tenant_id)
    if status_filter:
        query = query.where(models.OperationalAction.status == status_filter)
    if device_id is not None:
        query = query.join(
            models.OperationalActionTarget,
            models.OperationalActionTarget.action_id == models.OperationalAction.id,
        ).where(
            models.OperationalActionTarget.tenant_id == tenant_id,
            models.OperationalActionTarget.device_id == device_id,
        )
    query = query.order_by(models.OperationalAction.created_at.desc()).limit(min(max(limit, 1), 500))
    result = await db.execute(query)
    return [await action_view(db, tenant_id=tenant_id, action_id=action_id) for action_id in result.scalars().all()]
