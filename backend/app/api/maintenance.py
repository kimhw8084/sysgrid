from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import models
from ..schemas.schemas import MaintenanceWindowCreate
from .utils import build_audit_log
from .module_policy import require_module_access

router = APIRouter(
    prefix="/maintenance",
    tags=["Maintenance"],
    dependencies=[Depends(require_module_access("assets"))],
)

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
            "id": w.id,
            "device_id": w.device_id,
            "device_name": device_name if device_name is not None else "Unknown",
            "title": w.title,
            "start_time": w.start_time,
            "end_time": w.end_time,
            "ticket_number": w.ticket_number,
            "coordinator": w.coordinator,
            "status": w.status
        })
    return final

@router.post("")
async def create_maintenance_window(data: MaintenanceWindowCreate, request: Request, db: AsyncSession = Depends(get_db)):
    device = await db.get(models.Device, data.device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Asset not found in this tenant")
    if device.is_deleted:
        raise HTTPException(status_code=409, detail="Restore the archived asset before scheduling maintenance")
    mw = models.MaintenanceWindow(**data.model_dump())
    try:
        db.add(mw)
        await db.flush()
        db.add(build_audit_log(
            request=request, action="CREATE", target_table="maintenance_windows",
            target_id=str(mw.id), description=f"Scheduled maintenance: {mw.title}",
        ))
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    await db.refresh(mw)
    return mw

@router.delete("/{mw_id}")
async def delete_maintenance_window(mw_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.MaintenanceWindow).filter(models.MaintenanceWindow.id == mw_id))
    mw = result.scalar_one_or_none()
    if mw is None:
        raise HTTPException(status_code=404, detail="Maintenance window not found")
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
