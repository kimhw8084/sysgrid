from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update
from sqlalchemy.orm import joinedload
from typing import List, Optional
from datetime import datetime, timezone
from ..database import get_db
from ..models import models
from .utils import filter_valid_columns, get_current_user_id, parse_iso_date
from .module_policy import require_module_access

router = APIRouter(
    prefix="/investigations",
    tags=["Investigation Management"],
    dependencies=[Depends(require_module_access("research"))],
)
IMMUTABLE_INVESTIGATION_FIELDS = {"id", "created_at", "updated_at", "created_by_user_id"}

@router.get("")
async def get_investigations(include_deleted: bool = False, db: AsyncSession = Depends(get_db)):
    query = select(models.Investigation).options(joinedload(models.Investigation.progress_logs))
    if not include_deleted:
        query = query.filter(models.Investigation.is_deleted == False)
    result = await db.execute(query.order_by(models.Investigation.updated_at.desc()))
    return result.unique().scalars().all()

@router.post("")
async def create_investigation(data: dict, db: AsyncSession = Depends(get_db)):
    clean_data = filter_valid_columns(models.Investigation, data, exclude=IMMUTABLE_INVESTIGATION_FIELDS)
    
    # Handle ISO dates
    if "initiation_at" in clean_data:
        clean_data["initiation_at"] = parse_iso_date(clean_data["initiation_at"])

    inv = models.Investigation(**clean_data)
    db.add(inv)
    try:
        await db.commit()
        await db.refresh(inv)
        return inv
    except Exception as e:
        await db.rollback()
        raise HTTPException(400, detail=str(e))

@router.put("/{inv_id}")
async def update_investigation(inv_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Investigation).filter(models.Investigation.id == inv_id))
    inv = result.scalar_one_or_none()
    if not inv: raise HTTPException(404, "Investigation not found")
    
    clean_data = filter_valid_columns(models.Investigation, data, exclude=IMMUTABLE_INVESTIGATION_FIELDS)
    
    # Handle ISO dates
    if "initiation_at" in clean_data:
        clean_data["initiation_at"] = parse_iso_date(clean_data["initiation_at"])

    for k, v in clean_data.items():
        setattr(inv, k, v)
        
    await db.commit()
    await db.refresh(inv)
    return inv

@router.delete("/{inv_id}")
async def delete_investigation(inv_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Investigation).filter(models.Investigation.id == inv_id))
    inv = result.scalar_one_or_none()
    if not inv: raise HTTPException(404, "Investigation not found")
    
    inv.is_deleted = True
    await db.commit()
    return {"status": "success"}

# --- PROGRESS LOGS ---

@router.post("/{inv_id}/logs")
async def add_progress_log(inv_id: int, data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    inv_res = await db.execute(select(models.Investigation).filter(models.Investigation.id == inv_id))
    investigation = inv_res.scalar_one_or_none()
    if not investigation:
        raise HTTPException(404, "Investigation not found")

    clean_data = filter_valid_columns(models.InvestigationProgress, data)
    if not clean_data.get("entry_text", "").strip():
        raise HTTPException(400, "Intelligence pulse text is required")
    clean_data['investigation_id'] = inv_id
    if 'added_by' not in clean_data:
        clean_data['added_by'] = get_current_user_id(request)
        
    log = models.InvestigationProgress(**clean_data)
    db.add(log)
    investigation.updated_at = datetime.now(timezone.utc)
    try:
        await db.commit()
        await db.refresh(log)
        return log
    except Exception as e:
        await db.rollback()
        raise HTTPException(400, detail=str(e))
