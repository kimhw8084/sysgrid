"""Hardware definition fields, parent scope and atomic inventory audit."""
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..models import models
from .utils import build_audit_log


class HardwarePayload(BaseModel):
    model_config = ConfigDict(extra='ignore', strict=True)

    category: str | None = None
    name: str | None = None
    manufacturer: str | None = None
    specs: str | None = None
    count: int = Field(default=1, ge=0, le=2 ** 63 - 1)
    serial_number: str | None = None


def hardware_update_payload(data):
    try:
        return HardwarePayload.model_validate(data).model_dump(exclude_unset=True)
    except ValidationError as exc:
        raise HTTPException(422, 'Hardware fields must be text; quantity must be a whole number of zero or more') from exc


async def require_hardware_parent(request, db, device_id):
    device = await db.scalar(select(models.Device.id).where(
        models.Device.id == device_id, models.Device.tenant_id == request.state.tenant_id,
    ))
    if device is None:
        raise HTTPException(404, 'Asset not found')


def scoped_hardware_query(request):
    return select(models.HardwareComponent).join(models.Device).where(
        models.Device.tenant_id == request.state.tenant_id,
    )


async def commit_hardware_audit(request, db, component, action, changes):
    try:
        await db.flush()
        db.add(build_audit_log(
            request=request, action=action, target_table='hardware_components', target_id=str(component.id),
            description=f'{action.title()} hardware component', changes={'device_id': component.device_id, **changes},
        ))
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, 'Hardware conflicts with current asset state; reload and retry') from exc
    except Exception:
        await db.rollback()
        raise
