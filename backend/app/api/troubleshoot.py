from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update
from sqlalchemy.orm import joinedload
from typing import List, Optional
from ..database import get_db
from ..models import models
from .utils import build_audit_log, filter_valid_columns, parse_iso_date
from .module_policy import require_module_access

router = APIRouter(
    prefix="/incidents",
    tags=["Incident Management"],
    dependencies=[Depends(require_module_access("architecture"))],
)

def format_incident(inc: models.IncidentLog, devices_map: dict = {}):
    device_names = []
    if inc.impacted_device_ids:
        for did in inc.impacted_device_ids:
            if did in devices_map:
                device_names.append(devices_map[did].name)
            else:
                device_names.append(f"ID:{did}")

    return {
        "id": inc.id,
        "systems": inc.systems or [],
        "impacted_device_ids": inc.impacted_device_ids or [],
        "device_names": device_names,
        "title": inc.title,
        "severity": inc.severity,
        "status": inc.status,
        "start_time": inc.start_time.isoformat() if inc.start_time else None,
        "end_time": inc.end_time.isoformat() if inc.end_time else None,
        "reporter": inc.reporter,
        "initial_symptoms": inc.initial_symptoms,
        "impacts": inc.impacts_json or [],
        "impact_analysis": inc.impact_analysis,
        "trigger_event": inc.trigger_event,
        "log_evidence": inc.log_evidence,
        "mitigation_steps": inc.mitigation_steps,
        "root_cause": inc.root_cause,
        "resolution_steps": inc.resolution_steps,
        "lessons_learned": inc.lessons_learned,
        "prevention_strategy": inc.prevention_strategy,
        "timeline": inc.timeline_json or [],
        "todos": inc.todos_json or []
    }

@router.get("")
async def get_incidents(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.IncidentLog).order_by(models.IncidentLog.created_at.desc()))
    incidents = result.scalars().all()
    
    # Resolve device names in batch
    all_device_ids = set()
    for inc in incidents:
        if inc.impacted_device_ids:
            all_device_ids.update(inc.impacted_device_ids)
    
    devices_map = {}
    if all_device_ids:
        dev_res = await db.execute(select(models.Device).filter(models.Device.id.in_(list(all_device_ids))))
        devices_map = {d.id: d for d in dev_res.scalars().all()}

    return [format_incident(inc, devices_map) for inc in incidents]

@router.post("")
async def create_incident(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    clean_data = filter_valid_columns(models.IncidentLog, data)
    
    # Handle dates
    if 'start_time' in data: clean_data['start_time'] = parse_iso_date(data['start_time'])
    if 'end_time' in data: clean_data['end_time'] = parse_iso_date(data['end_time'])
    
    # Handle JSON fields
    if 'timeline' in data: clean_data['timeline_json'] = data['timeline']
    if 'todos' in data: clean_data['todos_json'] = data['todos']
    if 'systems' in data: clean_data['systems'] = data['systems']
    if 'impacted_device_ids' in data: clean_data['impacted_device_ids'] = data['impacted_device_ids']
    
    inc = models.IncidentLog(**clean_data)
    db.add(inc)
    try:
        await db.flush()
        log = build_audit_log(
            request=request, action="CREATE", target_table="incident_logs",
            target_id=str(inc.id), description=f"Logged incident: {inc.title}"
        )
        db.add(log)
        await db.commit()
        
        # Refetch for formatting
        result = await db.execute(select(models.IncidentLog).filter(models.IncidentLog.id == inc.id))
        refetched = result.scalars().one()
        
        devices_map = {}
        if refetched.impacted_device_ids:
            dev_res = await db.execute(select(models.Device).filter(models.Device.id.in_(refetched.impacted_device_ids)))
            devices_map = {d.id: d for d in dev_res.scalars().all()}
            
        return format_incident(refetched, devices_map)
    except Exception as e:
        await db.rollback()
        raise HTTPException(400, detail=str(e))

@router.put("/{incident_id}")
async def update_incident(incident_id: int, data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.IncidentLog).filter(models.IncidentLog.id == incident_id))
    inc = result.scalar_one_or_none()
    if not inc: raise HTTPException(404, "Incident not found")
    
    clean_data = filter_valid_columns(models.IncidentLog, data)
    
    if 'start_time' in data: clean_data['start_time'] = parse_iso_date(data['start_time'])
    if 'end_time' in data: clean_data['end_time'] = parse_iso_date(data['end_time'])
    if 'timeline' in data: clean_data['timeline_json'] = data['timeline']
    if 'todos' in data: clean_data['todos_json'] = data['todos']
    if 'systems' in data: clean_data['systems'] = data['systems']
    if 'impacted_device_ids' in data: clean_data['impacted_device_ids'] = data['impacted_device_ids']
    
    for k, v in clean_data.items():
        setattr(inc, k, v)
        
    log = build_audit_log(
        request=request, action="UPDATE", target_table="incident_logs",
        target_id=str(incident_id), description=f"Updated incident forensics: {inc.title}"
    )
    db.add(log)
    await db.commit()
    
    # Refetch for formatting
    result = await db.execute(select(models.IncidentLog).filter(models.IncidentLog.id == inc.id))
    refetched = result.scalars().one()
    
    devices_map = {}
    if refetched.impacted_device_ids:
        dev_res = await db.execute(select(models.Device).filter(models.Device.id.in_(refetched.impacted_device_ids)))
        devices_map = {d.id: d for d in dev_res.scalars().all()}
        
    return format_incident(refetched, devices_map)

@router.delete("/{incident_id}")
async def delete_incident(incident_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.IncidentLog).filter(models.IncidentLog.id == incident_id))
    inc = result.scalar_one_or_none()
    if not inc: raise HTTPException(404, "Incident not found")
    
    title = inc.title
    await db.delete(inc)
    
    log = build_audit_log(
        request=request, action="DELETE", target_table="incident_logs",
        target_id=str(incident_id), description=f"Purged incident record: {title}"
    )
    db.add(log)
    await db.commit()
    return {"status": "success"}

@router.post("/bulk-action")
async def bulk_action(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    ids = data.get("ids", [])
    action = data.get("action")
    if not ids: return {"status": "no_op"}
    
    if action == "delete":
        await db.execute(delete(models.IncidentLog).where(models.IncidentLog.id.in_(ids)))
        log = build_audit_log(request=request, action="DELETE", target_table="incident_logs", target_id="MULTIPLE", description=f"Bulk purged {len(ids)} incident records")
        db.add(log)
    
    await db.commit()
    return {"status": "success"}
