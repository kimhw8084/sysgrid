"""Shared metadata and tenant boundary for existing asset vault records.

Legacy payload custody is unchanged here; values leave this boundary only via
the separately authorized and audited reveal operation.
"""
from fastapi import HTTPException
from sqlalchemy import select

from ..models import models
from .utils import build_audit_log
from .authorization import has_capability


def can_manage_vault(request, operator):
    return (
        str(getattr(request.state, 'sysgrid_access_role', '')).upper() in {'ADMIN', 'EDITOR'}
        and has_capability(operator, 'assets', 2)
        and has_capability(operator, 'secrets', 3)
    )


def serialize_secret_vault_entry(secret, *, can_manage=False):
    return {
        'id': secret.id,
        'device_id': secret.device_id,
        'secret_type': secret.secret_type,
        'username': secret.username,
        'notes': secret.notes,
        'has_payload': bool(secret.encrypted_payload),
        'can_reveal': can_manage,
        'can_manage': can_manage,
        'created_at': secret.created_at.isoformat() if secret.created_at else None,
        'updated_at': secret.updated_at.isoformat() if secret.updated_at else None,
    }


def scoped_vault_query(request):
    return select(models.SecretVault).join(models.Device).where(
        models.Device.tenant_id == request.state.tenant_id,
    )


async def require_vault_device(request, db, device_id):
    if type(device_id) is not int or device_id <= 0:
        raise HTTPException(400, 'A valid asset ID is required')
    device = await db.scalar(select(models.Device.id).where(
        models.Device.id == device_id,
        models.Device.tenant_id == request.state.tenant_id,
    ))
    if device is None:
        raise HTTPException(404, 'Asset not found')


async def commit_vault_audit(request, db, secret, action):
    try:
        db.add(build_audit_log(
            request=request,
            action=action,
            target_table='secret_vault',
            target_id=secret.id,
            description=f'{action.title()} asset credential',
            changes={'device_id': secret.device_id, 'has_payload': bool(secret.encrypted_payload)},
        ))
        await db.commit()
    except Exception:
        await db.rollback()
        raise
