import hashlib
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from ..database import get_db
from ..maintenance_windows import is_cancelled, locked_window, window_facts
from ..models import models
from ..schemas.schemas import MaintenanceWindowCreate
from .utils import build_audit_log, get_current_user_id
from .module_policy import require_module_access

router = APIRouter(
    prefix="/maintenance",
    tags=["Maintenance"],
    dependencies=[Depends(require_module_access("assets"))],
)


class CancelWindowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    reason: str = Field(min_length=1, max_length=2000)


async def _creation_replay(db, key_hash, request_hash):
    if key_hash is None:
        return None
    window = await db.scalar(select(models.MaintenanceWindow).where(
        models.MaintenanceWindow.creation_key_hash == key_hash,
    ))
    if window is not None and window.creation_request_hash != request_hash:
        raise HTTPException(status_code=409, detail="The idempotency key belongs to a different window request")
    return window

@router.get("")
async def get_maintenance_windows(device_id: int | None = None, db: AsyncSession = Depends(get_db)):
    query = select(models.MaintenanceWindow, models.Device.name).outerjoin(
        models.Device, models.Device.id == models.MaintenanceWindow.device_id
    ).order_by(models.MaintenanceWindow.start_time, models.MaintenanceWindow.id)
    if device_id is not None:
        query = query.filter(models.MaintenanceWindow.device_id == device_id)
    result = await db.execute(query)
    windows = result.all()
    
    final = []
    for w, device_name in windows:
        final.append({
            **window_facts(w),
            "device_name": device_name if device_name is not None else "Unknown",
        })
    return final

@router.post("")
async def create_maintenance_window(data: MaintenanceWindowCreate, request: Request, db: AsyncSession = Depends(get_db)):
    actor = get_current_user_id(request)
    key = request.headers.get("Idempotency-Key")
    if key is not None and (not 1 <= len(key) <= 128 or not key.isascii() or not key.isprintable() or key != key.strip()):
        raise HTTPException(status_code=422, detail="Idempotency-Key must contain 1–128 printable ASCII characters without surrounding spaces")
    key_hash = hashlib.sha256(f"{actor}\0{key}".encode()).hexdigest() if key else None
    request_hash = hashlib.sha256(json.dumps(data.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    existing = await _creation_replay(db, key_hash, request_hash)
    if existing is not None:
        return window_facts(existing)
    device = await db.get(models.Device, data.device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Asset not found in this tenant")
    if device.is_deleted:
        raise HTTPException(status_code=409, detail="Restore the archived asset before scheduling maintenance")
    mw = models.MaintenanceWindow(**data.model_dump(), creation_key_hash=key_hash, creation_request_hash=request_hash, created_by_user_id=actor)
    try:
        db.add(mw)
        await db.flush()
        db.add(build_audit_log(
            request=request, action="CREATE", target_table="maintenance_windows",
            target_id=str(mw.id), description=f"Scheduled maintenance: {mw.title}",
        ))
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = await _creation_replay(db, key_hash, request_hash)
        if existing is not None:
            return window_facts(existing)
        raise
    except Exception:
        await db.rollback()
        raise
    await db.refresh(mw)
    return window_facts(mw)


@router.post("/{mw_id}/cancel")
async def cancel_maintenance_window(mw_id: int, data: CancelWindowRequest, request: Request, db: AsyncSession = Depends(get_db)):
    try:
        mw = await locked_window(db, mw_id)
        if mw is None:
            raise HTTPException(status_code=404, detail="Maintenance window not found")
        if is_cancelled(mw):
            # A retry returns the original cancellation, including its reason.
            await db.rollback()
            mw = await db.get(models.MaintenanceWindow, mw_id)
            return window_facts(mw)
        linked = select(models.OperationalAction.id).where(models.OperationalAction.maintenance_window_id == mw_id)
        active_action = await db.scalar(select(models.OperationalAction.id).where(
            models.OperationalAction.maintenance_window_id == mw_id,
            models.OperationalAction.status.in_(["EXECUTING", "ROLLBACK_REQUESTED", "ROLLING_BACK", "RECOVERY_REQUIRED"]),
        ).limit(1))
        active_attempt = await db.scalar(select(models.OperationalActionAttempt.id).where(
            models.OperationalActionAttempt.action_id.in_(linked),
            models.OperationalActionAttempt.status.in_(["REQUESTED", "CLAIMED", "OUTCOME_UNKNOWN"]),
        ).limit(1))
        if active_action or active_attempt:
            raise HTTPException(status_code=409, detail="Reconcile active or unresolved action attempts before canceling this window")
        mw.status = "Cancelled"
        mw.cancelled_at = datetime.now(timezone.utc).replace(tzinfo=None)
        mw.cancelled_by = get_current_user_id(request)
        mw.cancellation_reason = data.reason
        db.add(build_audit_log(request=request, action="CANCEL", target_table="maintenance_windows",
                               target_id=str(mw.id), description=f"Cancelled maintenance: {mw.title}",
                               changes={"reason": data.reason}))
        await db.commit()
        await db.refresh(mw)
        return window_facts(mw)
    except Exception:
        await db.rollback()
        raise

@router.delete("/{mw_id}")
async def delete_maintenance_window(mw_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    mw = await locked_window(db, mw_id)
    if mw is None:
        raise HTTPException(status_code=404, detail="Maintenance window not found")
    linked = await db.scalar(select(models.OperationalAction.id).where(
        models.OperationalAction.maintenance_window_id == mw_id,
    ).limit(1))
    if linked:
        raise HTTPException(status_code=409, detail="This window has action history; cancel it to preserve that history")
    try:
        await db.delete(mw)
        db.add(build_audit_log(
            request=request, action="DELETE", target_table="maintenance_windows",
            target_id=str(mw_id), description=f"Cancelled maintenance: {mw.title}",
        ))
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return {"status": "success"}
