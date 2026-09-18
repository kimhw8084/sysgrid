from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update
from ..database import get_db
from ..models import models
from datetime import datetime
from .utils import build_audit_log
from .module_policy import require_module_access

router = APIRouter(
    prefix="/maintenance",
    tags=["Maintenance"],
    dependencies=[Depends(require_module_access("assets"))],
)

@router.get("")
async def get_maintenance_windows(device_id: int | None = None, db: AsyncSession = Depends(get_db)):
    query = select(models.MaintenanceWindow)
    if device_id is not None:
        query = query.filter(models.MaintenanceWindow.device_id == device_id)
    result = await db.execute(query)
    windows = result.scalars().all()
    
    final = []
    for w in windows:
        dev_res = await db.execute(select(models.Device).filter(models.Device.id == w.device_id))
        dev = dev_res.scalar_one_or_none()
        final.append({
            "id": w.id,
            "device_id": w.device_id,
            "device_name": dev.name if dev else "Unknown",
            "title": w.title,
            "start_time": w.start_time,
            "end_time": w.end_time,
            "ticket_number": w.ticket_number,
            "coordinator": w.coordinator,
            "status": w.status
        })
    return final

@router.post("")
async def create_maintenance_window(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    # Parse dates
    start = datetime.fromisoformat(data['start_time'].replace("Z", "+00:00")) if data.get('start_time') else None
    end = datetime.fromisoformat(data['end_time'].replace("Z", "+00:00")) if data.get('end_time') else None
    
    mw = models.MaintenanceWindow(
        device_id=data.get('device_id'),
        title=data.get('title'),
        start_time=start,
        end_time=end,
        ticket_number=data.get('ticket_number'),
        coordinator=data.get('coordinator'),
        status=data.get('status', 'Scheduled')
    )
    db.add(mw)
    await db.commit()
    await db.refresh(mw)
    
    log = build_audit_log(request=request, action="CREATE", target_table="maintenance_windows", target_id=str(mw.id), description=f"Scheduled maintenance: {mw.title}")
    db.add(log)
    await db.commit()
    return mw

@router.delete("/{mw_id}")
async def delete_maintenance_window(mw_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.MaintenanceWindow).filter(models.MaintenanceWindow.id == mw_id))
    mw = result.scalar_one_or_none()
    if mw:
        db.delete(mw)
        log = build_audit_log(request=request, action="DELETE", target_table="maintenance_windows", target_id=str(mw_id), description=f"Cancelled maintenance: {mw.title}")
        db.add(log)
        await db.commit()
    return {"status": "success"}
