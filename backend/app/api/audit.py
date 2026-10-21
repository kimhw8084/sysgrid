from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import DEPLOYMENT_OWNED_GLOBAL_KEYS
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


def _parse_instant(value: str, field_name: str) -> datetime:
    """Require an explicit zone and compare instants in the stored UTC clock."""
    try:
        instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if instant.tzinfo is None or instant.utcoffset() is None:
            raise ValueError("Timezone required")
        return instant.astimezone(timezone.utc).replace(tzinfo=None)
    except (AttributeError, TypeError, ValueError, OverflowError) as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be a valid timezone-aware ISO instant within years 1–9999") from exc


def _audit_log_payload(log: models.AuditLog) -> dict[str, Any]:
    changes = log.changes
    if log.target_table == 'GLOBAL_SETTING' and log.target_id in DEPLOYMENT_OWNED_GLOBAL_KEYS:
        changes = {'old': '[redacted]', 'new': '[redacted]'}
    return {
        "id": log.id,
        "timestamp": log.timestamp,
        "user_id": log.user_id,
        "action": log.action,
        "target_table": log.target_table,
        "target_id": log.target_id,
        "description": log.description,
        "changes": changes,
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
    start_at: Optional[str] = None,
    end_before: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    if (start_at is not None or end_before is not None) and (start_date is not None or end_date is not None):
        raise HTTPException(status_code=400, detail="Use either calendar dates or explicit instants, not both")
    start_day = _parse_calendar_date(start_date, "start_date") if start_date is not None else None
    end_day = _parse_calendar_date(end_date, "end_date") if end_date is not None else None
    if start_day is not None and end_day is not None and start_day > end_day:
        raise HTTPException(status_code=400, detail="start_date must be on or before end_date")
    lower = _parse_instant(start_at, "start_at") if start_at is not None else None
    upper = _parse_instant(end_before, "end_before") if end_before is not None else None
    if lower is not None and upper is not None and lower > upper:
        raise HTTPException(status_code=400, detail="start_at must be on or before end_before")

    query = select(models.AuditLog)
    if start_day is not None:
        query = query.where(models.AuditLog.timestamp >= _day_start(start_day))
    if end_day is not None and end_day != date.max:
        # The end day is inclusive to callers, represented as the next day's
        # midnight so sub-second timestamps remain in the selected day.
        query = query.where(models.AuditLog.timestamp < _day_start(end_day + timedelta(days=1)))
    if lower is not None:
        query = query.where(models.AuditLog.timestamp >= lower)
    if upper is not None:
        query = query.where(models.AuditLog.timestamp < upper)
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
