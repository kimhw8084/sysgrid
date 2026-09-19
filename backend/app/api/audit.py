from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from ..database import get_db
from ..models import models
from .module_policy import require_module_access

from typing import Optional
from datetime import datetime

router = APIRouter(
    prefix="/audit",
    tags=["Audit"],
    dependencies=[Depends(require_module_access("logs"))],
)

@router.get("")
async def get_audit_logs(
    start_date: Optional[str] = None, 
    end_date: Optional[str] = None, 
    target_table: Optional[str] = None,
    target_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    query = select(models.AuditLog)
    
    if start_date:
        try:
            start_dt = datetime.fromisoformat(start_date)
            query = query.filter(models.AuditLog.timestamp >= start_dt)
        except: pass
        
    if end_date:
        try:
            end_dt = datetime.fromisoformat(end_date).replace(hour=23, minute=59, second=59)
            query = query.filter(models.AuditLog.timestamp <= end_dt)
        except: pass

    if target_table:
        query = query.filter(models.AuditLog.target_table == target_table)
    
    if target_id:
        query = query.filter(models.AuditLog.target_id == target_id)

    result = await db.execute(query.order_by(models.AuditLog.timestamp.desc()).limit(200))
    logs = result.scalars().all()
    
    final_logs = []
    for l in logs:
        final_logs.append({
            "id": l.id,
            "timestamp": l.timestamp,
            "user_id": l.user_id,
            "action": l.action,
            "target_table": l.target_table,
            "target_id": l.target_id,
            "description": l.description,
            "changes": l.changes
        })
    return final_logs
