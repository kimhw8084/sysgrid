"""System Management V1 module catalog and effective access projection.

The catalog is neutral JSON so the backend owns authorization decisions while
the frontend consumes the same release/profile vocabulary for presentation.
It contains no component names or executable UI instructions.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.authorization import (
    has_capability,
    merge_operator_permissions,
    resolve_current_operator,
)
from ..core.config import settings
from ..database import get_db
from ..models import models
from .utils import get_current_user_id


CATALOG_PATH = Path(__file__).resolve().parents[3] / "contracts" / "system_management_v1.json"
CATALOG: dict[str, Any] = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
MODULES: dict[str, dict[str, Any]] = {
    module["id"]: module for module in CATALOG["modules"]
}
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def get_module_definition(module_id: str) -> dict[str, Any]:
    try:
        return MODULES[module_id]
    except KeyError as exc:
        raise ValueError(f"Unknown SysGrid module '{module_id}'") from exc


def is_system_root_user_id(user_id: str | None) -> bool:
    return bool(user_id and user_id in settings.system_root_user_ids)


def _module_stage(module: dict[str, Any]) -> str:
    return settings.module_stage_overrides.get(module["id"], module["default_stage"])


def _explicit_capability(operator: models.Operator | None, capability: str | None, required_level: int = 1) -> bool:
    if not operator or not capability:
        return False
    permissions = merge_operator_permissions(operator)
    # Explicit deployment-owned surfaces do not inherit legacy is_admin/all
    # compatibility grants. Ordinary released modules still use has_capability.
    return permissions.get(capability, 0) >= required_level


def _projection_for_consumer(module: dict[str, Any], consumer_module_id: str | None) -> dict[str, Any] | None:
    if not consumer_module_id:
        return None
    for projection in module.get("embedded_support_projections", []):
        if isinstance(projection, dict) and consumer_module_id in projection.get("consumers", []):
            return projection
    return None


def _build_module_entry(
    module: dict[str, Any],
    *,
    operator: models.Operator | None,
    system_root: bool,
) -> dict[str, Any]:
    stage = _module_stage(module)
    capability = module.get("required_capability")
    root_preview_requires_explicit_capability = bool(system_root and stage == "preview")
    has_read = (
        not capability
        or (
            _explicit_capability(operator, capability, 1)
            if root_preview_requires_explicit_capability
            else has_capability(operator, capability, 1)
        )
    )
    has_write = (
        not capability
        or (
            _explicit_capability(operator, capability, 2)
            if root_preview_requires_explicit_capability
            else has_capability(operator, capability, 2)
        )
    )
    root_preview = bool(
        stage == "preview"
        and system_root
        and module.get("root_preview_allowed", False)
        and has_read
    )

    if stage == "disabled":
        blocked_reason = "MODULE_DISABLED"
    elif stage == "retired":
        blocked_reason = "MODULE_RETIRED"
    elif not has_read:
        blocked_reason = "MISSING_CAPABILITY"
    elif stage == "preview" and not root_preview:
        blocked_reason = "SYSTEM_ROOT_REQUIRED"
    else:
        blocked_reason = None

    available = stage == "production" and has_read or root_preview
    return {
        "module_id": module["id"],
        "label": module["label"],
        "canonical_route": module["canonical_route"],
        "aliases": list(module.get("aliases", [])),
        "navigation_group": module["navigation_group"],
        "profile_membership": module["profile_membership"],
        "stage": stage,
        "default_stage": module["default_stage"],
        "required_capability": capability,
        "resource_owner": module["resource_owner"],
        "root_preview_allowed": bool(module.get("root_preview_allowed", False)),
        "atlas_identity": module["atlas_identity"],
        "available": available,
        "blocked_reason": blocked_reason,
        "root_preview": root_preview,
        "actions": {
            "read": available,
            "write": bool(available and has_write),
            "import": bool(available and has_write),
            "export": bool(available),
            "preview": root_preview,
        },
    }


async def build_effective_policy(request: Request, db: AsyncSession) -> dict[str, Any]:
    user_id = get_current_user_id(request)
    operator = await resolve_current_operator(request, db)
    system_root = is_system_root_user_id(user_id)
    modules = {
        module_id: _build_module_entry(module, operator=operator, system_root=system_root)
        for module_id, module in MODULES.items()
    }
    policy = {
        "catalog_version": CATALOG["catalog_version"],
        "profile_id": CATALOG["profile_id"],
        "identity": {
            "authenticated": bool(user_id),
            "tenant_id": getattr(request.state, "tenant_id", None),
            "access_role": getattr(request.state, "sysgrid_access_role", None),
            "operator_role": operator.role.name if operator and operator.role else None,
            "tenant_admin": bool(operator and operator.is_admin),
            "system_root": system_root,
        },
        "actions": {
            "diagnostics": {
                "read": _explicit_capability(operator, "diagnostics", 1),
            },
        },
        "modules": modules,
    }
    request.state.sysgrid_policy = policy
    return policy


def _deny(module_id: str, entry: dict[str, Any], *, operation: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "code": "MODULE_ACCESS_DENIED",
            "module_id": module_id,
            "operation": operation,
            "stage": entry.get("stage"),
            "reason": entry.get("blocked_reason") or "MISSING_WRITE_CAPABILITY",
            "message": "This module is unavailable for the current account and tenant.",
        },
    )


async def ensure_module_access(
    module_id: str,
    request: Request,
    db: AsyncSession,
    *,
    allow_embedded: bool = False,
) -> dict[str, Any]:
    module = get_module_definition(module_id)
    policy = await build_effective_policy(request, db)
    entry = policy["modules"][module_id]
    operation = request.method.upper().lower()

    if allow_embedded:
        consumer_module_id = request.query_params.get("embedded_consumer")
        projection = _projection_for_consumer(module, consumer_module_id)
        consumer_entry = policy["modules"].get(consumer_module_id or "")
        allowed_selectors = projection.get("allowed_selectors", []) if projection else []
        selector_present = any(request.query_params.get(selector) not in (None, "") for selector in allowed_selectors)
        if (
            projection
            and consumer_entry
            and consumer_entry["available"]
            and request.method.upper() in SAFE_METHODS
            and (not allowed_selectors or selector_present)
        ):
            request.state.sysgrid_embedded_projection = projection["id"]
            request.state.sysgrid_embedded_consumer = consumer_module_id
            return policy

    if not entry["available"]:
        raise _deny(module_id, entry, operation=operation)

    if operation not in {method.lower() for method in SAFE_METHODS} and not entry["actions"]["write"]:
        raise _deny(module_id, entry, operation=operation)
    return policy


def require_module_access(module_id: str, *, allow_embedded: bool = False):
    get_module_definition(module_id)

    async def dependency(
        request: Request,
        db: AsyncSession = Depends(get_db),
    ) -> dict[str, Any]:
        return await ensure_module_access(module_id, request, db, allow_embedded=allow_embedded)

    dependency.__name__ = f"require_{module_id}_module_access"
    return dependency


async def require_diagnostics_access(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> models.Operator:
    operator = await resolve_current_operator(request, db)
    if not _explicit_capability(operator, "diagnostics", 1):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "DIAGNOSTICS_ACCESS_DENIED",
                "message": "Environment diagnostics require the explicit diagnostics capability.",
            },
        )
    return operator


router = APIRouter(prefix="/policy", tags=["Module Policy"])


@router.get("/module-availability")
async def get_module_availability(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    return await build_effective_policy(request, db)
