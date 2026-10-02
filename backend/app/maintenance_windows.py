"""Window facts and database serialization shared by scheduling and execution."""

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .models import models


def is_cancelled(window: models.MaintenanceWindow) -> bool:
    return window.cancelled_at is not None or (window.status or "").strip().lower() in {"cancelled", "canceled"}


async def locked_window(db: AsyncSession, window_id: int) -> models.MaintenanceWindow | None:
    # A no-op UPDATE acquires SQLite's database write lock (SELECT FOR UPDATE
    # does not). Cancellation, deletion, linking and forward execution use
    # this same transaction boundary; the lock lasts through their commit.
    # Preserve updated_at: taking a lock is not a scheduling change.
    await db.execute(update(models.MaintenanceWindow).where(
        models.MaintenanceWindow.id == window_id,
    ).values(updated_at=models.MaintenanceWindow.updated_at))
    return await db.scalar(select(models.MaintenanceWindow).where(
        models.MaintenanceWindow.id == window_id,
    ).execution_options(populate_existing=True))


def window_facts(window: models.MaintenanceWindow) -> dict:
    return {name: value.isoformat() if hasattr(value, "isoformat") else value for name, value in {
        "id": window.id, "device_id": window.device_id, "title": window.title,
        "start_time": window.start_time, "end_time": window.end_time,
        "status": window.status, "ticket_number": window.ticket_number,
        "coordinator": window.coordinator, "cancelled_at": window.cancelled_at,
        "cancelled_by": window.cancelled_by, "cancellation_reason": window.cancellation_reason,
        "created_at": window.created_at, "updated_at": window.updated_at,
        "created_by_user_id": window.created_by_user_id,
    }.items()}
