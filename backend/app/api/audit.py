from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import models
from .module_policy import require_module_access


AUDIT_SCOPE_HEADER_NAMES = [
    "X-SysGrid-Result-Scope",
    "X-SysGrid-Result-Limit",
    "X-SysGrid-Result-Offset",
    "X-SysGrid-Result-Has-More",
    "X-SysGrid-Result-Complete",
]

router = APIRouter(
    prefix="/audit",
    tags=["Audit"],
    dependencies=[Depends(require_module_access("logs"))],
)

def _parse_calendar_date(value: str, field_name: str) -> date:
    """Parse a date filter as a calendar day and reject malformed values."""
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
        except (AttributeError, TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=400,
                detail=f"{field_name} must be a valid ISO calendar date",
            ) from exc


def _day_start(day: date) -> datetime:
    return datetime.combine(day, datetime.min.time())


def _audit_log_payload(log: models.AuditLog) -> dict[str, Any]:
    return {
        "id": log.id,
        "timestamp": log.timestamp,
        "user_id": log.user_id,
        "action": log.action,
        "target_table": log.target_table,
        "target_id": log.target_id,
        "description": log.description,
        "changes": log.changes,
    }


@router.get("")
async def get_audit_logs(
    response: Response,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    target_table: Optional[str] = None,
    target_id: Optional[str] = None,
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    start_day = _parse_calendar_date(start_date, "start_date") if start_date is not None else None
    end_day = _parse_calendar_date(end_date, "end_date") if end_date is not None else None
    if start_day is not None and end_day is not None and start_day > end_day:
        raise HTTPException(status_code=400, detail="start_date must be on or before end_date")

    query = select(models.AuditLog)
    if start_day is not None:
        query = query.where(models.AuditLog.timestamp >= _day_start(start_day))
    if end_day is not None:
        # The end day is inclusive to callers, represented as the next day's
        # midnight so sub-second timestamps remain in the selected day.
        query = query.where(models.AuditLog.timestamp < _day_start(end_day + timedelta(days=1)))
    if target_table:
        query = query.where(models.AuditLog.target_table == target_table)
    if target_id:
        query = query.where(models.AuditLog.target_id == target_id)

    result = await db.execute(
        query
        .order_by(models.AuditLog.timestamp.desc(), models.AuditLog.id.desc())
        .offset(offset)
        .limit(limit + 1)
    )
    rows = result.scalars().all()
    has_more = len(rows) > limit
    logs = rows[:limit]
    complete = offset == 0 and not has_more

    response.headers["X-SysGrid-Result-Scope"] = "bounded"
    response.headers["X-SysGrid-Result-Limit"] = str(limit)
    response.headers["X-SysGrid-Result-Offset"] = str(offset)
    response.headers["X-SysGrid-Result-Has-More"] = str(has_more).lower()
    response.headers["X-SysGrid-Result-Complete"] = str(complete).lower()
    return [_audit_log_payload(log) for log in logs]
