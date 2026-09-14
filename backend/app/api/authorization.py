"""Shared server-side authorization primitives.

This module deliberately reuses the existing Operator/Role permission model:
permission levels are 0 (none) through 3 (manage/admin), with ``all: 3``
remaining the compatibility grant used by the existing Admin role.
"""

from __future__ import annotations

from typing import Any

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_config_db, get_db
from ..core.config import settings
from ..models import models
from .utils import get_current_user_id

PERMISSION_LEVELS = {
    "none": 0,
    "read": 1,
    "add": 2,
    "write": 2,
    "edit": 3,
    "manage": 3,
    "full": 3,
    "admin": 3,
}


def normalize_permission_level(value: Any) -> int:
    """Convert the existing permission vocabulary to a bounded numeric level."""
    if isinstance(value, bool):
        level = 1 if value else 0
    elif isinstance(value, (int, float)):
        level = int(value)
    elif isinstance(value, str):
        level = PERMISSION_LEVELS.get(value.strip().lower(), 0)
    else:
        level = 0
    return max(0, min(3, level))


def normalize_permission_map(raw_permissions: Any) -> dict[str, int]:
    if not isinstance(raw_permissions, dict):
        return {}
    normalized = {
        str(capability).strip(): normalize_permission_level(level)
        for capability, level in raw_permissions.items()
        if str(capability).strip()
    }
    return dict(sorted(normalized.items(), key=lambda item: item[0]))


def merge_operator_permissions(operator: models.Operator) -> dict[str, int]:
    """Merge role grants and deterministic custom overrides for one operator."""
    role = getattr(operator, "role", None)
    merged = normalize_permission_map(getattr(role, "permissions", None))
    merged.update(normalize_permission_map(getattr(operator, "custom_permissions", None)))
    return dict(sorted(merged.items(), key=lambda item: item[0]))


def has_capability(
    operator: models.Operator | None,
    capability: str,
    required_level: int = 1,
) -> bool:
    """Return whether an operator has the requested capability level."""
    if required_level < 0 or required_level > 3:
        raise ValueError("required_level must be between 0 and 3")
    if not operator or not capability or not capability.strip():
        return False
    if bool(operator.is_admin):
        return True

    permissions = merge_operator_permissions(operator)
    return max(
        permissions.get(capability.strip(), 0),
        permissions.get("all", 0),
    ) >= required_level


async def resolve_current_operator(
    request: Request,
    db: AsyncSession,
) -> models.Operator | None:
    """Resolve exactly one current-identity Operator in the active tenant DB."""
    user_id = get_current_user_id(request)
    result = await db.execute(
        select(models.Operator)
        .options(selectinload(models.Operator.role))
        .where(
            or_(
                models.Operator.username == user_id,
                models.Operator.external_id == user_id,
            )
        )
    )
    operators = result.scalars().all()
    # Ambiguous identity matches fail closed just like an absent operator.
    return operators[0] if len(operators) == 1 else None


def require_capability(capability: str, required_level: int = 1):
    """Build a FastAPI dependency enforcing a named tenant capability."""
    if required_level < 0 or required_level > 3:
        raise ValueError("required_level must be between 0 and 3")
    capability_name = capability.strip()
    if not capability_name:
        raise ValueError("capability must not be empty")

    async def dependency(
        request: Request,
        db: AsyncSession = Depends(get_db),
    ) -> models.Operator:
        operator = await resolve_current_operator(request, db)
        if not has_capability(operator, capability_name, required_level):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Insufficient capability '{capability_name}' at level "
                    f"{required_level}."
                ),
            )
        return operator

    dependency.__name__ = f"require_{capability_name}_capability"
    return dependency


async def require_control_plane_admin(
    request: Request,
    db: AsyncSession = Depends(get_config_db),
) -> str:
    """Require an explicit global control-plane identity.

    Bootstrap is an opt-in, first-install-only path: it requires one exact
    configured bootstrap identity and an empty tenant registry. It does not
    confer steady-state global authority after the first tenant exists.
    """
    user_id = get_current_user_id(request)
    if user_id in settings.control_plane_admin_user_ids:
        return user_id

    if (
        settings.CONTROL_PLANE_BOOTSTRAP_ENABLED
        and settings.control_plane_bootstrap_user_id
        and user_id == settings.control_plane_bootstrap_user_id
    ):
        from ..models.config import Tenant

        tenant_count = await db.scalar(select(Tenant.id).limit(1))
        if tenant_count is None:
            return user_id

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Global control-plane administrator permission is required.",
    )
