"""Authorized relationship and legacy software definitions."""
from datetime import datetime, timezone

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased

from ..models import models
from .utils import build_audit_log


class RelationshipDefinition(BaseModel):
    model_config = ConfigDict(extra='ignore', strict=True)

    relationship_type: str | None = None
    source_role: str | None = None
    target_role: str | None = None
    notes: str | None = None


class RelationshipCreate(RelationshipDefinition):
    target_device_id: int = Field(ge=1, le=2 ** 63 - 1)

    @model_validator(mode='before')
    @classmethod
    def require_target(cls, value):
        # Keep the established missing-target response for existing clients.
        if isinstance(value, dict) and 'target_device_id' not in value:
            raise HTTPException(400, 'Target device ID required')
        return value

    @field_validator('target_device_id', mode='before')
    @classmethod
    def accept_select_value(cls, value):
        # Native selects send digit strings. Do not coerce booleans or fractions.
        if isinstance(value, str) and value.isascii() and value.isdigit() and len(value) <= 19:
            return int(value)
        return value


class SoftwareDefinition(BaseModel):
    model_config = ConfigDict(extra='ignore', strict=True)

    category: str | None = None
    name: str | None = None
    version: str | None = None
    install_date: datetime | None = None
    purpose: str | None = None
    notes: str | None = None

    @field_validator('install_date', mode='before')
    @classmethod
    def parse_install_date(cls, value):
        if isinstance(value, str):
            value = datetime.fromisoformat(value)
        if isinstance(value, datetime) and value.tzinfo is not None:
            try:
                value = value.astimezone(timezone.utc).replace(tzinfo=None)
            except OverflowError as exc:
                raise ValueError('Install date is outside the supported UTC range') from exc
        return value


def asset_link_update_payload(resource, data):
    schema = SoftwareDefinition if resource == 'software' else RelationshipDefinition
    try:
        return schema.model_validate(data).model_dump(exclude_unset=True)
    except ValidationError as exc:
        raise HTTPException(422, 'Definition fields must be text; install_date must be an ISO date or null') from exc


async def require_relationship_asset(request, db, device_id, *, active=False):
    if not 1 <= device_id <= 2 ** 63 - 1:
        raise HTTPException(404, 'Asset not found')
    query = select(models.Device.id).where(models.Device.id == device_id, models.Device.tenant_id == request.state.tenant_id)
    if active:
        query = query.where(models.Device.is_deleted == False)
    if await db.scalar(query) is None:
        raise HTTPException(404, 'Asset not found')


def scoped_relationship_query(request):
    source, target = aliased(models.Device), aliased(models.Device)
    return select(models.DeviceRelationship).join(source, source.id == models.DeviceRelationship.source_device_id).join(
        target, target.id == models.DeviceRelationship.target_device_id,
    ).where(source.tenant_id == request.state.tenant_id, target.tenant_id == request.state.tenant_id)


async def get_asset_link(request, db, resource, row_id):
    if not 1 <= row_id <= 2 ** 63 - 1:
        raise HTTPException(404, 'Asset definition not found')
    if resource == 'relationships':
        query = scoped_relationship_query(request).where(models.DeviceRelationship.id == row_id)
    else:
        query = select(models.DeviceSoftware).join(models.Device).where(
            models.DeviceSoftware.id == row_id, models.Device.tenant_id == request.state.tenant_id,
        )
    item = await db.scalar(query)
    if item is None:
        raise HTTPException(404, 'Asset definition not found')
    return item


async def commit_asset_link_audit(request, db, item, action, changes):
    try:
        await db.flush()
        db.add(build_audit_log(
            request=request, action=action, target_table=item.__tablename__, target_id=str(item.id),
            description=f'{action.title()} asset definition', changes=changes,
        ))
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, 'Definition conflicts with current asset state; reload and retry') from exc
    except Exception:
        await db.rollback()
        raise
