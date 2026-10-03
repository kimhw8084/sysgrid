import os
from fastapi import HTTPException, Request, status
from datetime import datetime
from ..core.config import settings
from ..models import models


def normalize_json_object(value):
    if not isinstance(value, dict):
        return {}
    normalized = {}
    for key in sorted(value.keys(), key=lambda item: str(item).lower()):
        if not isinstance(key, str):
            continue
        normalized[key] = normalize_json_value(value[key])
    return normalized


def normalize_json_list(value):
    if not isinstance(value, list):
        return []
    return [normalize_json_value(item) for item in value]


def normalize_json_value(value):
    if isinstance(value, dict):
        return normalize_json_object(value)
    if isinstance(value, list):
        return normalize_json_list(value)
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)

def _normalize_user_id(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    if not normalized or len(normalized) > 200:
        return None
    return normalized


def get_current_user_id(request: Request = None):
    """Resolve identity using an environment-aware trust contract.

    Production accepts an explicit process identity or a trusted proxy identity.
    Browser-controlled X-User-Id remains available only in development/test mode.
    """
    if settings.identity_mode == "environment":
        environment_user = settings.environment_user_id
        if environment_user:
            return environment_user
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Configured company environment identity is missing or invalid.",
        )

    if settings.identity_mode == "trusted_proxy":
        if request is not None:
            trusted_user = _normalize_user_id(request.headers.get(settings.TRUSTED_PROXY_USER_HEADER))
            if trusted_user:
                return trusted_user
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authenticated proxy identity header is missing.",
            )
        service_user = _normalize_user_id(os.getenv(settings.USER_ID_ENV_VAR))
        if service_user:
            return service_user
        return _normalize_user_id(settings.DEFAULT_USER_ID)

    if settings.identity_mode != "development":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Identity mode is not configured.")

    configured_env_user = _normalize_user_id(os.getenv(settings.USER_ID_ENV_VAR))
    if configured_env_user:
        return configured_env_user

    if request:
        header_user = _normalize_user_id(request.headers.get("X-User-Id"))
        if header_user:
            return header_user

    return (
        _normalize_user_id(os.getenv("user_name"))
        or _normalize_user_id(os.getenv("USER_ID"))
        or _normalize_user_id(settings.DEFAULT_USER_ID)
    )


def get_audit_actor(request: Request = None, fallback: str | None = None):
    return get_current_user_id(request) or fallback or settings.DEFAULT_USER_ID


def build_audit_log(
    *,
    request: Request = None,
    action: str,
    target_table: str,
    target_id: str | None = None,
    description: str | None = None,
    changes: dict | None = None,
    fallback_actor: str | None = None,
):
    return models.AuditLog(
        user_id=get_audit_actor(request, fallback=fallback_actor),
        action=action,
        target_table=target_table,
        target_id=target_id,
        description=description,
        changes=normalize_json_object(changes or {}),
    )

def filter_valid_columns(model, data: dict, exclude: set | None = None):
    """
    Filters a dictionary to only include keys that are valid columns for a given SQLAlchemy model.
    """
    from sqlalchemy import inspect
    valid_columns = {c.key for c in inspect(model).mapper.column_attrs}
    excluded = exclude or set()
    return {k: v for k, v in data.items() if k in valid_columns and k not in excluded}

def parse_iso_date(date_str: str):
    """
    Safely parses an ISO date string into a datetime object.
    """
    if not date_str:
        return None
    if not isinstance(date_str, str):
        return None
    try:
        # Handle cases with 'Z' or offset
        clean_str = date_str.replace('Z', '+00:00')
        return datetime.fromisoformat(clean_str)
    except (ValueError, TypeError):
        return None
