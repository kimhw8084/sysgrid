from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update
from sqlalchemy.orm import joinedload, selectinload
from typing import List, Optional, Any
from ..database import get_db
from ..models import models
from ..schemas import schemas
from .utils import filter_valid_columns, parse_iso_date, normalize_json_object, normalize_json_list
from .module_policy import require_module_access

router = APIRouter(
    prefix="/rca",
    tags=["Incident RCA Management"],
    dependencies=[Depends(require_module_access("research"))],
)

def build_rca_snapshot(record: models.RcaRecord) -> dict:
    """Creates a forensic snapshot of an RCA record including timeline/mitigations."""
    return {
        "title": record.title,
        "problem_statement": record.problem_statement,
        "trigger_source": record.trigger_source,
        "severity": record.severity,
        "priority": record.priority,
        "status": record.status,
        "cause_of_failure": record.cause_of_failure,
        "narrative_summary": record.narrative_summary,
        "target_systems": record.target_systems,
        "owner": record.owner,
        "owners": record.owners,
        "timeline": [
            {"event_time": t.event_time.isoformat() if t.event_time else None, "event_type": t.event_type, "description": t.description}
            for t in record.timeline
        ],
        "mitigations": [
            {"type": m.type, "action_description": m.action_description, "status": m.status}
            for m in record.mitigations
        ]
    }

async def save_rca_history(rca_id: int, version: int, db: AsyncSession, summary: str = None):
    stmt = select(models.RcaRecord).options(
        joinedload(models.RcaRecord.timeline),
        joinedload(models.RcaRecord.mitigations)
    ).filter(models.RcaRecord.id == rca_id)
    res = await db.execute(stmt)
    record = res.unique().scalar_one()
    
    # Ensure no duplicate version entries
    await db.execute(
        delete(models.RcaHistory)
        .where(models.RcaHistory.rca_id == rca_id, models.RcaHistory.version == version)
    )
    
    history = models.RcaHistory(
        rca_id=rca_id,
        version=version,
        snapshot=build_rca_snapshot(record),
        change_summary=summary
    )
    db.add(history)

def get_rca_options():
    """Reusable options for deep loading RCA records to satisfy RcaRecordResponse schema."""
    return [
        selectinload(models.RcaRecord.timeline),
        selectinload(models.RcaRecord.mitigations),
        selectinload(models.RcaRecord.knowledge_bkm),
        selectinload(models.RcaRecord.monitoring_config),
        selectinload(models.RcaRecord.linked_failure_modes).selectinload(models.FarFailureMode.affected_assets),
        selectinload(models.RcaRecord.linked_failure_modes).selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.resolutions).selectinload(models.FarResolution.knowledge_bkm),
        selectinload(models.RcaRecord.linked_failure_modes).selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.mitigations),
        selectinload(models.RcaRecord.linked_failure_modes).selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.prevention_actions),
        selectinload(models.RcaRecord.linked_failure_modes).selectinload(models.FarFailureMode.mitigations),
        selectinload(models.RcaRecord.linked_failure_modes).selectinload(models.FarFailureMode.prevention_actions),
        selectinload(models.RcaRecord.linked_failure_modes).selectinload(models.FarFailureMode.linked_rcas)
    ]

@router.get("", response_model=List[schemas.RcaRecordResponse])
async def get_rca_records(db: AsyncSession = Depends(get_db)):
    query = select(models.RcaRecord).options(*get_rca_options()).filter(models.RcaRecord.is_deleted == False)
    result = await db.execute(query)
    return result.unique().scalars().all()

@router.get("/{rca_id}", response_model=schemas.RcaRecordResponse)
async def get_rca_detail(rca_id: int, db: AsyncSession = Depends(get_db)):
    query = select(models.RcaRecord).options(*get_rca_options()).filter(models.RcaRecord.id == rca_id)
    result = await db.execute(query)
    record = result.unique().scalar_one_or_none()
    if not record: raise HTTPException(404, "RCA Record not found")
    return record

@router.post("", response_model=schemas.RcaRecordResponse)
async def create_rca(data: dict, db: AsyncSession = Depends(get_db)):
    linked_modes_data = data.pop("linked_failure_modes", [])
    clean_data = filter_valid_columns(models.RcaRecord, data)
    
    # Priority Mapping
    p_map = {"LOW": 1, "MEDIUM": 4, "HIGH": 7, "HIGHEST": 10}
    if "priority" in clean_data and isinstance(clean_data["priority"], str):
        clean_data["priority"] = p_map.get(clean_data["priority"].upper(), 1)

    # Handle ISO dates
    for date_field in ["occurrence_at", "acknowledged_at", "detection_at"]:
        if date_field in clean_data:
            clean_data[date_field] = parse_iso_date(clean_data[date_field])

    record = models.RcaRecord(**clean_data)
    record.version = 1
    
    if linked_modes_data:
        mode_ids = [m.get("id") for m in linked_modes_data if m.get("id")]
        if mode_ids:
            modes_result = await db.execute(select(models.FarFailureMode).filter(models.FarFailureMode.id.in_(mode_ids)))
            record.linked_failure_modes = list(modes_result.scalars().all())

    db.add(record)
    await db.flush()
    await save_rca_history(record.id, record.version, db, "Initial creation")
    await db.commit()
    
    # Re-fetch with all options to ensure fresh return
    result = await db.execute(select(models.RcaRecord).options(*get_rca_options()).filter(models.RcaRecord.id == record.id))
    record = result.unique().scalar_one()
    
    return record

@router.put("/{rca_id}", response_model=schemas.RcaRecordResponse)
async def update_rca(rca_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.RcaRecord).options(
        selectinload(models.RcaRecord.linked_failure_modes),
        selectinload(models.RcaRecord.timeline),
        selectinload(models.RcaRecord.mitigations)
    ).filter(models.RcaRecord.id == rca_id))
    record = result.unique().scalar_one_or_none()
    if not record: raise HTTPException(404, "RCA Record not found")
    
    linked_modes_data = data.pop("linked_failure_modes", None)
    timeline_data = data.pop("timeline", None)
    mitigations_data = data.pop("mitigations", None)
    
    clean_data = filter_valid_columns(models.RcaRecord, data)
    
    # Priority Mapping
    p_map = {"LOW": 1, "MEDIUM": 4, "HIGH": 7, "HIGHEST": 10}
    if "priority" in clean_data and isinstance(clean_data["priority"], str):
        clean_data["priority"] = p_map.get(clean_data["priority"].upper(), 1)

    # Handle ISO dates
    for date_field in ["occurrence_at", "acknowledged_at", "detection_at"]:
        if date_field in clean_data:
            clean_data[date_field] = parse_iso_date(clean_data[date_field])

    # Sync primary owner from owners list if provided
    if "owners" in clean_data and isinstance(clean_data["owners"], list) and clean_data["owners"]:
        clean_data["owner"] = clean_data["owners"][0]

    for k, v in clean_data.items():
        setattr(record, k, v)
    
    # Sync Failure Modes
    if linked_modes_data is not None:
        mode_ids = [m if isinstance(m, int) else m.get("id") for m in linked_modes_data if (isinstance(m, int) or m.get("id"))]
        if mode_ids:
            modes_result = await db.execute(select(models.FarFailureMode).filter(models.FarFailureMode.id.in_(mode_ids)))
            record.linked_failure_modes = list(modes_result.scalars().all())
        else:
            record.linked_failure_modes = []

    # Sync Timeline
    if timeline_data is not None:
        new_timeline = []
        for t in timeline_data:
            t_clean = filter_valid_columns(models.RcaTimelineEvent, t)
            if 'event_time' in t_clean and isinstance(t_clean['event_time'], str):
                try:
                    t_clean['event_time'] = datetime.fromisoformat(t_clean['event_time'].replace('Z', '+00:00'))
                except Exception:
                    pass
            new_timeline.append(models.RcaTimelineEvent(**t_clean))
        record.timeline = new_timeline

    # Sync Mitigations
    if mitigations_data is not None:
        new_mitigations = []
        for m in mitigations_data:
            m_clean = filter_valid_columns(models.RcaMitigation, m)
            new_mitigations.append(models.RcaMitigation(**m_clean))
        record.mitigations = new_mitigations
        
    db.add(record)
    record.version = (record.version or 1) + 1
    await db.flush()
    await save_rca_history(record.id, record.version, db, data.get("_change_summary", "Update via API"))
    await db.commit()
    
    # Re-fetch with all options to ensure fresh return
    result = await db.execute(select(models.RcaRecord).options(*get_rca_options()).filter(models.RcaRecord.id == rca_id))
    record = result.unique().scalar_one()
    
    return record

@router.get("/{rca_id}/history")
async def get_rca_history(rca_id: int, db: AsyncSession = Depends(get_db)):
    stmt = select(models.RcaHistory).filter(models.RcaHistory.rca_id == rca_id).order_by(models.RcaHistory.version.desc())
    res = await db.execute(stmt)
    return res.scalars().all()

@router.post("/{rca_id}/restore/{version}")
async def restore_rca_version(rca_id: int, version: int, db: AsyncSession = Depends(get_db)):
    stmt = select(models.RcaHistory).filter(models.RcaHistory.rca_id == rca_id, models.RcaHistory.version == version)
    res = await db.execute(stmt)
    history = res.scalar_one_or_none()
    if not history: raise HTTPException(404, "History version not found")
    
    record_stmt = select(models.RcaRecord).filter(models.RcaRecord.id == rca_id)
    record_res = await db.execute(record_stmt)
    record = record_res.scalar_one()
    
    snapshot = history.snapshot
    # Apply snapshot
    for k, v in snapshot.items():
        if k == 'timeline' and isinstance(v, list):
            new_timeline = []
            for t in v:
                t_clean = filter_valid_columns(models.RcaTimelineEvent, t)
                if 'event_time' in t_clean and t_clean['event_time']:
                    t_clean['event_time'] = parse_iso_date(t_clean['event_time'])
                new_timeline.append(models.RcaTimelineEvent(**t_clean))
            record.timeline = new_timeline
        elif k == 'mitigations' and isinstance(v, list):
            new_mitigations = []
            for m in v:
                m_clean = filter_valid_columns(models.RcaMitigation, m)
                new_mitigations.append(models.RcaMitigation(**m_clean))
            record.mitigations = new_mitigations
        elif hasattr(record, k) and k not in ['id', 'created_at', 'updated_at']:
            setattr(record, k, v)
            
    record.version = (record.version or 1) + 1
    await db.flush()
    await save_rca_history(record.id, record.version, db, f"Restored from v{version}")
    await db.commit()
    return {"status": "success", "new_version": record.version}

@router.delete("/{rca_id}")
async def delete_rca(rca_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.RcaRecord).filter(models.RcaRecord.id == rca_id))
    record = result.scalar_one_or_none()
    if not record: raise HTTPException(404, "RCA Record not found")
    
    record.is_deleted = True
    await db.commit()
    return {"status": "success"}

@router.post("/{rca_id}/timeline", response_model=schemas.RcaTimelineEventResponse)
async def add_timeline_event(rca_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    clean_data = filter_valid_columns(models.RcaTimelineEvent, data)
    clean_data["rca_id"] = rca_id
    if 'event_time' in clean_data and isinstance(clean_data['event_time'], str):
        clean_data['event_time'] = parse_iso_date(clean_data['event_time'])
    
    event = models.RcaTimelineEvent(**clean_data)
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event

# --- Mitigations ---

@router.post("/{rca_id}/mitigations", response_model=schemas.RcaMitigationResponse)
async def add_mitigation(rca_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    clean_data = filter_valid_columns(models.RcaMitigation, data)
    clean_data["rca_id"] = rca_id
    
    mitigation = models.RcaMitigation(**clean_data)
    db.add(mitigation)
    await db.commit()
    await db.refresh(mitigation)
    return mitigation
