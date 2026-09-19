import json
import os
from copy import deepcopy
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import select, delete, update, or_
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from ..database import get_db, get_config_db, Base
from ..models import models
from ..models.config import Tenant, UserTenantAccess, GlobalSetting
from ..core.config import settings
from ..runtime_diagnostics import (
    build_import_export_contract_summary,
    frontend_build_version_hint,
    infer_sanitized_environment_mode,
)
from .utils import filter_valid_columns, get_current_user_id, normalize_json_list, normalize_json_object
from .authorization import require_capability
from .module_policy import is_system_root_user_id, require_diagnostics_access

router = APIRouter(prefix="/settings", tags=["Settings"])
LOCKED_MONITORING_OPTION_CATEGORIES = {"MonitoringSeverity", "MonitoringOwnerRole", "MonitoringPlatform", "MonitoringCategory", "NotificationMethod"}
RELATIONAL_OPTION_CATEGORIES = {"MonitoringTeam"}
SAFE_DIAGNOSTIC_ENV_KEYS = {"PORT", "ENVIRONMENT", "LOG_LEVEL", "API_V1_STR", "VITE_UI_DEBUG_LOGGING"}


def parse_env_file_to_map(path: str | None) -> dict[str, str]:
    if not path or not os.path.exists(path):
        return {}
    env_map: dict[str, str] = {}
    with open(path, "r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env_map[key.strip()] = value.strip().strip('"').strip("'")
    return env_map


def sanitize_api_origin(url: str | None) -> tuple[str | None, bool]:
    cleaned = normalize_string(url)
    if not cleaned:
        return None, False
    try:
        parsed = urlparse(cleaned)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return None, False
        host = parsed.hostname
        if ":" in host and not host.startswith("["):
            host = f"[{host}]"
        port = f":{parsed.port}" if parsed.port is not None else ""
        return f"{parsed.scheme}://{host}{port}", True
    except ValueError:
        return None, False


def normalize_api_origin(url: str | None) -> str:
    """Return a safe HTTP(S) origin or an empty string for legacy callers."""
    origin, valid = sanitize_api_origin(url)
    return origin if valid and origin else ""


def serialize_user_preference_value(value):
    try:
        return json.dumps(value)
    except TypeError as exc:
        raise HTTPException(status_code=400, detail=f"User preference value is not JSON serializable: {exc}") from exc


def deserialize_user_preference_value(raw_value: str):
    if raw_value is None:
        return None
    try:
        return json.loads(raw_value)
    except (TypeError, json.JSONDecodeError):
        return raw_value


def normalize_string(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def normalize_string_list(values: list[str] | None) -> list[str]:
    cleaned = {
        normalized
        for normalized in (normalize_string(value) for value in (values or []))
        if normalized
    }
    return sorted(cleaned, key=lambda value: value.lower())


def reject_reserved_system_root_identity(payload: dict, *, actor_id: str) -> None:
    if is_system_root_user_id(actor_id):
        return
    for field in ("external_id", "username", "id"):
        candidate = normalize_string(payload.get(field))
        if candidate and is_system_root_user_id(candidate):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "RESERVED_SYSTEM_ROOT_IDENTITY",
                    "message": "Reserved System Root identities are deployment-owned and cannot be managed from tenant settings.",
                },
            )


def normalize_permission_map(raw_permissions: dict | None) -> dict:
    if not isinstance(raw_permissions, dict):
        return {}

    normalized: dict[str, int] = {}
    for key, value in raw_permissions.items():
        normalized_key = normalize_string(key)
        if not normalized_key:
            continue
        if isinstance(value, bool):
            normalized_value = 1 if value else 0
        elif isinstance(value, (int, float)):
            normalized_value = int(value)
        elif isinstance(value, str):
            lookup = value.strip().lower()
            normalized_value = {
                "none": 0,
                "read": 1,
                "add": 2,
                "write": 2,
                "edit": 3,
                "manage": 3,
                "full": 3,
                "admin": 3,
            }.get(lookup, 0)
        else:
            normalized_value = 0
        normalized[normalized_key] = max(0, min(3, normalized_value))
    return dict(sorted(normalized.items(), key=lambda item: item[0]))


def normalize_setting_option_payload(data: dict, *, fallback_category: str | None = None) -> dict:
    payload = dict(data or {})
    category = normalize_string(payload.get("category") or fallback_category)
    label = normalize_string(payload.get("label"))
    value = normalize_string(payload.get("value"))
    description = normalize_string(payload.get("description"))

    if category is not None:
        payload["category"] = category
    if label is not None:
        payload["label"] = label
    if value is not None:
        payload["value"] = value
    if description is not None or "description" in payload:
        payload["description"] = description
    if "metadata_keys" in payload:
        payload["metadata_keys"] = normalize_string_list(payload.get("metadata_keys"))

    return payload


def split_team_name_values(value: str | list[str] | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        raw_values = value
    else:
        raw_values = str(value).replace("\n", ",").split(",")
    return [normalized for normalized in (normalize_string(entry) for entry in raw_values) if normalized]


def canonical_operator_state(operator: models.Operator) -> dict:
    return {
        "external_id": normalize_string(operator.external_id),
        "username": normalize_string(operator.username),
        "full_name": normalize_string(operator.full_name),
        "email": normalize_string(operator.email),
        "department": normalize_string(operator.department),
        "team": normalize_string(operator.team),
        "team_id": operator.team_id,
        "team_source": normalize_string(operator.team_source) or "manual",
        "teams": normalize_string_list(operator.teams or []),
        "is_admin": bool(operator.is_admin),
        "custom_permissions": normalize_permission_map(operator.custom_permissions or {}),
        "registration_status": normalize_string(operator.registration_status),
        "role_id": operator.role_id,
    }


def apply_operator_canonicalization(
    operator: models.Operator,
    *,
    team: models.Team | None,
    payload: dict,
    default_source: str,
) -> None:
    for field in ("external_id", "username", "full_name", "email", "department", "registration_status"):
        if field in payload:
            setattr(operator, field, normalize_string(payload.get(field)))

    if "is_admin" in payload:
        operator.is_admin = bool(payload.get("is_admin"))
    if "role_id" in payload:
        operator.role_id = payload.get("role_id")
    if "custom_permissions" in payload:
        operator.custom_permissions = normalize_permission_map(payload.get("custom_permissions"))

    provided_groups = payload.get("teams") if "teams" in payload else operator.teams
    normalized_groups = normalize_string_list(provided_groups or [])
    if team and team.name not in normalized_groups:
        normalized_groups.append(team.name)
        normalized_groups = sorted(set(normalized_groups), key=lambda value: value.lower())
    operator.teams = normalized_groups

    operator.team_id = team.id if team else None
    operator.team = team.name if team else None
    operator.team_source = normalize_string(payload.get("team_source")) or (default_source if team else "manual")


async def ensure_setting_option_uniqueness(
    db: AsyncSession,
    *,
    category: str,
    value: str,
    label: str,
    exclude_id: int | None = None,
) -> None:
    existing = (await db.execute(select(models.SettingOption).filter(
        models.SettingOption.category == category,
        models.SettingOption.value == value,
    ))).scalar_one_or_none()
    if existing and existing.id != exclude_id:
        raise HTTPException(status_code=409, detail=f"Duplicate option value '{value}' already exists in category '{category}'")

    existing_label = (await db.execute(select(models.SettingOption).filter(
        models.SettingOption.category == category,
        models.SettingOption.label == label,
    ))).scalar_one_or_none()
    if existing_label and existing_label.id != exclude_id:
        raise HTTPException(status_code=409, detail=f"Duplicate option label '{label}' already exists in category '{category}'")


async def rename_json_string_list_references(db: AsyncSession, model: type, field_name: str, old_value: str, new_value: str) -> None:
    result = await db.execute(select(model).filter(getattr(model, field_name).contains([old_value])))
    rows = result.scalars().all()
    for row in rows:
        current = list(getattr(row, field_name) or [])
        updated = [new_value if entry == old_value else entry for entry in current]
        setattr(row, field_name, updated)


async def rename_vendor_personnel_pc_types(db: AsyncSession, old_value: str, new_value: str) -> None:
    result = await db.execute(select(models.VendorPersonnel).filter(models.VendorPersonnel.pcs.contains([{"type": old_value}])))
    personnel_rows = result.scalars().all()
    for person in personnel_rows:
        next_pcs = []
        for pc in person.pcs or []:
            current = deepcopy(pc)
            if current.get("type") == old_value:
                current["type"] = new_value
            next_pcs.append(current)
        person.pcs = next_pcs


async def rename_setting_option_references(db: AsyncSession, category: str, old_value: str, new_value: str) -> None:
    if old_value == new_value:
        return

    if category == "Status":
        await db.execute(update(models.Device).where(models.Device.status == old_value).values(status=new_value))
        await db.execute(update(models.LogicalService).where(models.LogicalService.status == old_value).values(status=new_value))
        await db.execute(update(models.MaintenanceWindow).where(models.MaintenanceWindow.status == old_value).values(status=new_value))
        await db.execute(update(models.ExternalEntity).where(models.ExternalEntity.status == old_value).values(status=new_value))
    elif category == "Environment":
        await db.execute(update(models.Device).where(models.Device.environment == old_value).values(environment=new_value))
        await db.execute(update(models.LogicalService).where(models.LogicalService.environment == old_value).values(environment=new_value))
        await db.execute(update(models.ExternalEntity).where(models.ExternalEntity.environment == old_value).values(environment=new_value))
    elif category == "DeviceType":
        await db.execute(update(models.Device).where(models.Device.type == old_value).values(type=new_value))
    elif category == "LogicalSystem":
        await db.execute(update(models.Device).where(models.Device.system == old_value).values(system=new_value))
        await rename_json_string_list_references(db, models.VendorContract, "covered_systems", old_value, new_value)
    elif category == "VendorCountry":
        await db.execute(update(models.Vendor).where(models.Vendor.country == old_value).values(country=new_value))
    elif category == "VendorDeviceType":
        await rename_vendor_personnel_pc_types(db, old_value, new_value)
    elif category == "LinkPurpose":
        await db.execute(update(models.PortConnection).where(models.PortConnection.link_type == old_value).values(link_type=new_value))
    elif category == "NetworkFarm":
        await db.execute(update(models.PortConnection).where(models.PortConnection.farm == old_value).values(farm=new_value))
    elif category == "NetworkCableType":
        await db.execute(update(models.PortConnection).where(models.PortConnection.cable_type == old_value).values(cable_type=new_value))
    elif category == "Manufacturer":
        await db.execute(update(models.Device).where(models.Device.manufacturer == old_value).values(manufacturer=new_value))
    elif category == "Model":
        await db.execute(update(models.Device).where(models.Device.model == old_value).values(model=new_value))
    elif category == "Owner":
        await db.execute(update(models.Device).where(models.Device.owner == old_value).values(owner=new_value))
    elif category == "BusinessUnit":
        await db.execute(update(models.Device).where(models.Device.business_unit == old_value).values(business_unit=new_value))
    elif category == "Vendor":
        await db.execute(update(models.Device).where(models.Device.vendor == old_value).values(vendor=new_value))
    elif category == "ServiceType":
        await db.execute(update(models.LogicalService).where(models.LogicalService.service_type == old_value).values(service_type=new_value))
    elif category == "MonitoringCategory":
        await db.execute(update(models.MonitoringItem).where(models.MonitoringItem.category == old_value).values(category=new_value))
    elif category == "MonitoringPlatform":
        await db.execute(update(models.MonitoringItem).where(models.MonitoringItem.platform == old_value).values(platform=new_value))
    elif category == "ExternalType":
        await db.execute(update(models.ExternalEntity).where(models.ExternalEntity.type == old_value).values(type=new_value))


async def setting_option_is_in_use(db: AsyncSession, category: str, value: str) -> bool:
    if category == "Status":
        return any([
            (await db.execute(select(models.Device.id).filter(models.Device.status == value))).scalars().first(),
            (await db.execute(select(models.LogicalService.id).filter(models.LogicalService.status == value))).scalars().first(),
            (await db.execute(select(models.MaintenanceWindow.id).filter(models.MaintenanceWindow.status == value))).scalars().first(),
            (await db.execute(select(models.ExternalEntity.id).filter(models.ExternalEntity.status == value))).scalars().first(),
        ])
    if category == "Environment":
        return any([
            (await db.execute(select(models.Device.id).filter(models.Device.environment == value))).scalars().first(),
            (await db.execute(select(models.LogicalService.id).filter(models.LogicalService.environment == value))).scalars().first(),
            (await db.execute(select(models.ExternalEntity.id).filter(models.ExternalEntity.environment == value))).scalars().first(),
        ])
    if category == "DeviceType":
        return bool((await db.execute(select(models.Device.id).filter(models.Device.type == value))).scalars().first())
    if category == "LogicalSystem":
        return any([
            (await db.execute(select(models.Device.id).filter(models.Device.system == value))).scalars().first(),
            (await db.execute(select(models.VendorContract.id).filter(models.VendorContract.covered_systems.contains([value])))).scalars().first(),
        ])
    if category == "VendorCountry":
        return bool((await db.execute(select(models.Vendor.id).filter(models.Vendor.country == value))).scalars().first())
    if category == "VendorDeviceType":
        return bool((await db.execute(select(models.VendorPersonnel.id).filter(models.VendorPersonnel.pcs.contains([{"type": value}])))).scalars().first())
    if category == "LinkPurpose":
        return bool((await db.execute(select(models.PortConnection.id).filter(models.PortConnection.link_type == value))).scalars().first())
    if category == "NetworkFarm":
        return bool((await db.execute(select(models.PortConnection.id).filter(models.PortConnection.farm == value))).scalars().first())
    if category == "NetworkCableType":
        return bool((await db.execute(select(models.PortConnection.id).filter(models.PortConnection.cable_type == value))).scalars().first())
    if category == "Manufacturer":
        return bool((await db.execute(select(models.Device.id).filter(models.Device.manufacturer == value))).scalars().first())
    if category == "Model":
        return bool((await db.execute(select(models.Device.id).filter(models.Device.model == value))).scalars().first())
    if category == "Owner":
        return bool((await db.execute(select(models.Device.id).filter(models.Device.owner == value))).scalars().first())
    if category == "BusinessUnit":
        return bool((await db.execute(select(models.Device.id).filter(models.Device.business_unit == value))).scalars().first())
    if category == "Vendor":
        return bool((await db.execute(select(models.Device.id).filter(models.Device.vendor == value))).scalars().first())
    if category == "ServiceType":
        return bool((await db.execute(select(models.LogicalService.id).filter(models.LogicalService.service_type == value))).scalars().first())
    if category == "MonitoringCategory":
        return bool((await db.execute(select(models.MonitoringItem.id).filter(models.MonitoringItem.category == value))).scalars().first())
    if category == "MonitoringPlatform":
        return bool((await db.execute(select(models.MonitoringItem.id).filter(models.MonitoringItem.platform == value))).scalars().first())
    if category == "ExternalType":
        return bool((await db.execute(select(models.ExternalEntity.id).filter(models.ExternalEntity.type == value))).scalars().first())
    return False

async def ensure_admin_operator(db: AsyncSession, user_id: str):
    res_op = await db.execute(select(models.Operator).filter(models.Operator.username == user_id))
    operator = res_op.scalar_one_or_none()
    return operator

async def record_team_audit(db: AsyncSession, team_id: int | None, action: str, actor: str, details: dict | None = None):
    db.add(models.TeamAudit(
        team_id=team_id,
        action=action,
        actor=actor,
        details=details or {}
    ))

async def build_user_pool_snapshot(db: AsyncSession):
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(models.Operator)
        .options(selectinload(models.Operator.role))
        .order_by(models.Operator.full_name.asc(), models.Operator.username.asc(), models.Operator.id.asc())
    )
    operators = result.scalars().all()
    return normalize_json_list([
        {
            "id": operator.id,
            "external_id": operator.external_id,
            "username": operator.username,
            "full_name": operator.full_name,
            "email": operator.email,
            "department": operator.department,
            "team": operator.team,
            "team_id": operator.team_id,
            "team_source": operator.team_source,
            "teams": operator.teams or [],
            "role_id": operator.role_id,
            "role_name": operator.role.name if operator.role else None,
            "is_admin": bool(operator.is_admin),
            "custom_permissions": operator.custom_permissions or {},
            "registration_status": operator.registration_status,
        }
        for operator in operators
    ])

async def create_user_pool_version(
    db: AsyncSession,
    *,
    created_by: str,
    diff_summary: dict,
    version_label: str | None = None,
):
    import datetime

    if not version_label:
        version_label = f"v{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}"
    
    await db.flush()
    snapshot = await build_user_pool_snapshot(db)
    await db.execute(update(models.UserPoolVersion).values(is_active=False))
    db.add(models.UserPoolVersion(
        version_label=version_label,
        snapshot_data=snapshot,
        diff_summary=normalize_json_object(diff_summary),
        created_by=created_by,
        is_active=True,
    ))


def _snapshot_identity_key(operator: dict) -> str:
    return str(operator.get("external_id") or operator.get("id") or operator.get("username") or "")


def _snapshot_role_name(operator: dict) -> str | None:
    return normalize_string(operator.get("role_name"))


def summarize_user_pool_snapshot_delta(
    before_snapshot: list[dict] | None,
    after_snapshot: list[dict] | None,
    *,
    extra_summary: dict | None = None,
) -> dict:
    before_rows = before_snapshot or []
    after_rows = after_snapshot or []
    before_map = {_snapshot_identity_key(operator): operator for operator in before_rows if _snapshot_identity_key(operator)}
    after_map = {_snapshot_identity_key(operator): operator for operator in after_rows if _snapshot_identity_key(operator)}
    keys = sorted(set(before_map) | set(after_map))

    added = 0
    removed = 0
    changed = 0
    changed_identities: list[dict[str, str | None]] = []

    for key in keys:
        before = before_map.get(key)
        after = after_map.get(key)
        if before is None and after is not None:
            added += 1
            changed_identities.append({
                "external_id": normalize_string(after.get("external_id")),
                "username": normalize_string(after.get("username")),
                "mode": "added",
            })
            continue
        if before is not None and after is None:
            removed += 1
            changed_identities.append({
                "external_id": normalize_string(before.get("external_id")),
                "username": normalize_string(before.get("username")),
                "mode": "removed",
            })
            continue
        if before != after:
            changed += 1
            changed_identities.append({
                "external_id": normalize_string((after or before).get("external_id")),
                "username": normalize_string((after or before).get("username")),
                "mode": "changed",
            })

    summary = {
        "added": added,
        "removed": removed,
        "changed": changed,
        "changed_identities": changed_identities,
    }
    if extra_summary:
        summary.update(extra_summary)
    return summary


async def create_user_pool_version_from_snapshot_delta(
    db: AsyncSession,
    *,
    created_by: str,
    before_snapshot: list[dict] | None,
    extra_summary: dict | None = None,
    version_label: str | None = None,
) -> dict:
    await db.flush()
    after_snapshot = await build_user_pool_snapshot(db)
    summary = summarize_user_pool_snapshot_delta(before_snapshot, after_snapshot, extra_summary=extra_summary)
    await db.execute(update(models.UserPoolVersion).values(is_active=False))
    if not version_label:
        import datetime
        version_label = f"v{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}"
    db.add(models.UserPoolVersion(
        version_label=version_label,
        snapshot_data=after_snapshot,
        diff_summary=normalize_json_object(summary),
        created_by=created_by,
        is_active=True,
    ))
    return summary

async def resolve_team_assignment(
    db: AsyncSession,
    *,
    team_id: int | None = None,
    team_name: str | None = None,
    source: str = "manual",
    create_missing: bool = False,
):
    normalized_name = team_name.strip() if isinstance(team_name, str) and team_name.strip() else None
    team = None
    if team_id:
        res = await db.execute(select(models.Team).filter(models.Team.id == team_id))
        team = res.scalar_one_or_none()
    elif normalized_name:
        res = await db.execute(select(models.Team).filter(models.Team.name == normalized_name))
        team = res.scalar_one_or_none()

    if not team and normalized_name and create_missing:
        team = models.Team(name=normalized_name, source=source)
        db.add(team)
        await db.flush()
    elif not team and (team_id or normalized_name):
        raise HTTPException(status_code=400, detail="Team not found")

    return team


async def rename_operator_group_memberships(db: AsyncSession, old_name: str, new_name: str) -> None:
    if old_name == new_name:
        return
    result = await db.execute(select(models.Operator).filter(models.Operator.teams.contains([old_name])))
    operators = result.scalars().all()
    for operator in operators:
        memberships = [new_name if entry == old_name else entry for entry in (operator.teams or [])]
        operator.teams = normalize_string_list(memberships)


async def rename_monitoring_team_references(db: AsyncSession, old_name: str, new_name: str) -> None:
    if old_name == new_name:
        return
    result = await db.execute(select(models.MonitoringItem).filter(models.MonitoringItem.owner_team.is_not(None)))
    items = result.scalars().all()
    for item in items:
        current_names = split_team_name_values(item.owner_team)
        if old_name not in current_names:
            continue
        renamed_names = [new_name if entry == old_name else entry for entry in current_names]
        item.owner_team = ", ".join(normalize_string_list(renamed_names)) or None


async def team_references_exist(db: AsyncSession, *, team_id: int | None, team_name: str) -> dict[str, bool]:
    monitoring_team_values = (
        await db.execute(select(models.MonitoringItem.owner_team).filter(models.MonitoringItem.owner_team.is_not(None)))
    ).scalars().all()
    return {
        "operator_groups": bool((await db.execute(
            select(models.Operator.id).filter(models.Operator.teams.contains([team_name]))
        )).scalars().first()),
        "monitoring_items": any(team_name in split_team_name_values(owner_team) for owner_team in monitoring_team_values),
        "external_entities": bool((await db.execute(
            select(models.ExternalEntity.id).filter(
                (models.ExternalEntity.internal_team_id == team_id) |
                (models.ExternalEntity.owner_team == team_name)
            )
        )).scalars().first()) if team_id or team_name else False,
    }


async def ensure_operator_identity_uniqueness(
    db: AsyncSession,
    *,
    external_id: str | None = None,
    username: str | None = None,
    exclude_id: int | None = None,
) -> None:
    normalized_external_id = normalize_string(external_id)
    normalized_username = normalize_string(username)

    if normalized_external_id:
        query = select(models.Operator).filter(models.Operator.external_id == normalized_external_id)
        if exclude_id is not None:
            query = query.filter(models.Operator.id != exclude_id)
        if (await db.execute(query)).scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"Operator external ID '{normalized_external_id}' already exists")

    if normalized_username:
        query = select(models.Operator).filter(models.Operator.username == normalized_username)
        if exclude_id is not None:
            query = query.filter(models.Operator.id != exclude_id)
        if (await db.execute(query)).scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"Operator username '{normalized_username}' already exists")


async def resolve_role_assignment(db: AsyncSession, role_id: int | None) -> models.Role | None:
    if role_id is None:
        return None
    res = await db.execute(select(models.Role).filter(models.Role.id == role_id))
    role = res.scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=400, detail="Role not found")
    return role


async def apply_operator_patch(
    db: AsyncSession,
    *,
    op: models.Operator,
    data: dict,
    user_id: str,
) -> dict:
    previous_state = canonical_operator_state(op)
    next_external_id = normalize_string(data.get("external_id")) if "external_id" in data else op.external_id
    next_username = normalize_string(data.get("username")) if "username" in data else op.username
    if "external_id" in data and not next_external_id:
        raise HTTPException(status_code=400, detail="External ID cannot be empty")
    if "username" in data and not next_username:
        raise HTTPException(status_code=400, detail="Username cannot be empty")
    await ensure_operator_identity_uniqueness(db, external_id=next_external_id, username=next_username, exclude_id=op.id)
    if "role_id" in data:
        await resolve_role_assignment(db, data.get("role_id"))

    team = op.team_rel
    if "team_id" in data or "team" in data:
        team = await resolve_team_assignment(
            db,
            team_id=data.get("team_id"),
            team_name=data.get("team"),
            source=data.get("team_source") or "manual_override",
            create_missing=bool(data.get("team"))
        )

    patch_payload = dict(data)
    if "external_id" in data:
        patch_payload["external_id"] = next_external_id
    if "username" in data:
        patch_payload["username"] = next_username
    apply_operator_canonicalization(op, team=team, payload=patch_payload, default_source="manual_override")
    if "external_id" in patch_payload:
        op.external_id = next_external_id
    if "username" in patch_payload:
        op.username = next_username
    current_state = canonical_operator_state(op)

    if previous_state["team_id"] and previous_state["team_id"] != current_state["team_id"]:
        await record_team_audit(db, previous_state["team_id"], "member_removed", user_id, {"external_id": op.external_id, "username": op.username, "from": previous_state["team"]})
    if current_state["team_id"] and previous_state["team_id"] != current_state["team_id"]:
        await record_team_audit(db, current_state["team_id"], "member_added", user_id, {"external_id": op.external_id, "username": op.username, "to": current_state["team"]})

    team_updates = []
    if previous_state["team"] != current_state["team"]:
        team_updates.append({"external_id": op.external_id, "old": previous_state["team"], "new": current_state["team"], "mode": "primary_team_changed"})
    if previous_state["teams"] != current_state["teams"]:
        team_updates.append({"external_id": op.external_id, "old": previous_state["teams"], "new": current_state["teams"], "mode": "group_membership_changed"})

    return {
        "changed": previous_state != current_state,
        "team_updates": team_updates,
    }


async def apply_operator_delete(
    db: AsyncSession,
    *,
    op: models.Operator,
    user_id: str,
) -> dict:
    if op.username == user_id:
        raise HTTPException(status_code=400, detail="Identity Protection: You cannot terminate your own active session.")
    if op.team_id:
        await record_team_audit(db, op.team_id, "member_removed", user_id, {"external_id": op.external_id, "username": op.username, "from": op.team})
    await db.execute(delete(models.Operator).where(models.Operator.id == op.id))
    return {
        "team_updates": [{"external_id": op.external_id, "old": op.team, "new": None, "mode": "operator_deleted"}],
    }

async def ensure_tenant_admin_async(*, tenant_db_url: str, admin_user: str, full_name: str | None, email: str | None, department: str | None) -> None:
    engine = create_async_engine(tenant_db_url)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as session:
        res_role = await session.execute(select(models.Role).where(models.Role.name == "Admin"))
        admin_role = res_role.scalar_one_or_none()
        if not admin_role:
            admin_role = models.Role(name="Admin", permissions={"all": 3})
            session.add(admin_role)
            await session.flush()

        res_op = await session.execute(select(models.Operator).where(models.Operator.username == admin_user))
        operator = res_op.scalar_one_or_none()
        
        derived_full_name = full_name or admin_user.replace(".", " ").replace("_", " ").title()
        derived_email = email or f"{admin_user}@{settings.DEFAULT_EMAIL_DOMAIN}"
        
        if operator:
            operator.full_name = derived_full_name
            operator.email = derived_email
            operator.department = department
            operator.role_id = admin_role.id
            operator.is_admin = True
        else:
            session.add(models.Operator(
                external_id=admin_user,
                username=admin_user,
                full_name=derived_full_name,
                email=derived_email,
                department=department,
                role_id=admin_role.id,
                is_admin=True,
                registration_status="Verified"
            ))
        await session.commit()
    await engine.dispose()


@router.get("/user/settings")
async def get_user_settings(request: Request, db: AsyncSession = Depends(get_db)):
    user_id = get_current_user_id(request)
    res = await db.execute(select(models.UserPreference).filter(models.UserPreference.user_id == user_id))
    prefs = res.scalars().all()
    return {p.key: deserialize_user_preference_value(p.value) for p in prefs}

@router.get("/user/profile")
async def get_user_profile(request: Request, db: AsyncSession = Depends(get_db)):
    user_id = get_current_user_id(request)
    # Attempt to find the operator by username
    from sqlalchemy.orm import selectinload
    res = await db.execute(
        select(models.Operator)
        .options(selectinload(models.Operator.role))
        .filter(or_(models.Operator.username == user_id, models.Operator.external_id == user_id))
    )
    operators = res.scalars().all()
    operator = operators[0] if len(operators) == 1 else None
    if not operator:
        is_public_readonly = bool(getattr(getattr(request, "state", None), "sysgrid_public_readonly", False))
        return {
            "id": None,
            "username": user_id,
            "full_name": user_id,
            "email": None,
            "department": "Read Only",
            "team": settings.PUBLIC_READONLY_TENANT_NAME if is_public_readonly else None,
            "role": "Viewer",
            "is_admin": False,
            "permissions": {},
            "access_mode": "public_readonly" if is_public_readonly else "viewer",
        }
    
    # Merge permissions: role permissions + custom overrides
    permissions = (operator.role.permissions if operator.role else {}).copy()
    if operator.custom_permissions:
        permissions.update(operator.custom_permissions)

    return {
        "id": operator.id,
        "username": operator.username,
        "full_name": operator.full_name,
        "email": operator.email,
        "department": operator.department,
        "team": operator.team,
        "role": operator.role.name if operator.role else "No Role",
        "is_admin": operator.is_admin,
        "permissions": permissions,
        "access_mode": "assigned",
    }

@router.get("/user/env-vars")
async def get_user_env_vars(
    request: Request,
    _diagnostics_access: models.Operator = Depends(require_diagnostics_access),
):
    # Return user-specific environment context (Mostly OS-level forensics)
    user_id = get_current_user_id(request)
    
    # Sensitive patterns to redact
    redact_patterns = [
        "KEY", "SECRET", "PASSWORD", "TOKEN", "AUTH", "CREDENTIAL",
        "DATABASE", "PRIVATE", "COOKIE", "CERT", "URL",
    ]
    
    env_data = {}
    for key, value in os.environ.items():
        # Check if the key is sensitive
        is_sensitive = any(pattern in key.upper() for pattern in redact_patterns)
        
        env_data[key] = value if not is_sensitive and key.upper() in SAFE_DIAGNOSTIC_ENV_KEYS else "********"
            
    # Add some calculated fields
    env_data["USER_ID"] = user_id
    env_data["SESSION_TYPE"] = "PROXIED" if os.environ.get("HTTP_X_FORWARDED_FOR") else "DIRECT"
    env_data["DEBUG_MODE"] = str(os.environ.get("VITE_UI_DEBUG_LOGGING", "false").lower() == "true")
    env_data["WORKSPACE_ROOT"] = "[redacted]"
    
    return env_data

@router.post("/user/settings")
@router.patch("/user/settings")
async def update_user_settings(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = get_current_user_id(request)
    for key, value in data.items():
        serialized_value = serialize_user_preference_value(value)
        statement = sqlite_insert(models.UserPreference).values(
            user_id=user_id,
            key=key,
            value=serialized_value,
        )
        statement = statement.on_conflict_do_update(
            index_elements=["user_id", "key"],
            set_={"value": serialized_value},
        )
        await db.execute(statement)
    await db.commit()
    return {"status": "success"}

@router.get("/bootstrap")
async def get_bootstrap_config(config_db: AsyncSession = Depends(get_config_db)):
    """Public endpoint for frontend startup discovery. Must not require tenant selection."""
    try:
        # 1. Fetch public settings from the config DB so bootstrap works even when tenant routing is broken.
        res = await config_db.execute(select(GlobalSetting).filter(GlobalSetting.is_public == True))
        db_settings = {s.key: s.value for s in res.scalars().all()}
        
        # 2. Extract from Environment/Config (as fallback)
        env_settings = {
            "API_ENDPOINT": settings.API_V1_STR,
            "PORT": str(settings.PORT),
            "VITE_API_BASE_URL": "", # Frontend usually handles this via proxy
            "DEFAULT_USER_ID": settings.DEFAULT_USER_ID,
        }
        
        # Merge, DB takes priority
        final_config = {**env_settings, **db_settings}
        
        return final_config
    except Exception as e:
        print(f"BOOTSTRAP ERROR: {e}")
        # Return at least basic settings so UI can try to render
        return {
            "PORT": str(settings.PORT),
            "API_ENDPOINT": settings.API_V1_STR,
            "DEFAULT_USER_ID": settings.DEFAULT_USER_ID,
        }

@router.get("/options")
async def get_options(category: str = None, db: AsyncSession = Depends(get_db)):
    query = select(models.SettingOption)
    if category:
        if category in RELATIONAL_OPTION_CATEGORIES:
            return []
        query = query.filter(models.SettingOption.category == category)
    else:
        query = query.filter(models.SettingOption.category.not_in(RELATIONAL_OPTION_CATEGORIES))
    result = await db.execute(query.order_by(models.SettingOption.label))
    return result.scalars().all()

@router.post("/options")
async def create_option(
    data: dict,
    _settings_access: models.Operator = Depends(require_capability("settings", 3)),
    db: AsyncSession = Depends(get_db),
):
    clean_data = normalize_setting_option_payload(filter_valid_columns(models.SettingOption, data))
    category = clean_data.get("category")
    label = clean_data.get("label")
    value = clean_data.get("value")
    if category in LOCKED_MONITORING_OPTION_CATEGORIES:
        raise HTTPException(status_code=400, detail="This monitoring category is code-managed and cannot be edited in settings")
    if category in RELATIONAL_OPTION_CATEGORIES:
        raise HTTPException(status_code=400, detail="This category is managed by relational settings data and cannot be edited as an enum")
    if not category or not label or not value:
        raise HTTPException(status_code=400, detail="Category, label, and value are required")
    await ensure_setting_option_uniqueness(db, category=category, value=value, label=label)
    if 'id' in clean_data and not clean_data['id']:
        del clean_data['id']
    opt = models.SettingOption(**clean_data)
    db.add(opt)
    await db.commit()
    await db.refresh(opt)
    return opt

@router.put("/options/{opt_id}")
async def update_option(
    opt_id: int,
    data: dict,
    _settings_access: models.Operator = Depends(require_capability("settings", 3)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(models.SettingOption).filter(models.SettingOption.id == opt_id))
    opt = result.scalar_one_or_none()
    if not opt: raise HTTPException(404, "Option not found")
    if opt.category in LOCKED_MONITORING_OPTION_CATEGORIES:
        raise HTTPException(status_code=400, detail="This monitoring category is code-managed and cannot be edited in settings")
    if opt.category in RELATIONAL_OPTION_CATEGORIES:
        raise HTTPException(status_code=400, detail="This category is managed by relational settings data and cannot be edited as an enum")

    clean_data = normalize_setting_option_payload(filter_valid_columns(models.SettingOption, data), fallback_category=opt.category)
    if clean_data.get("category") != opt.category:
        raise HTTPException(status_code=400, detail="Changing option category is not supported")

    old_value = opt.value
    old_keys = set(opt.metadata_keys or [])
    new_value = clean_data.get("value", opt.value)
    new_label = clean_data.get("label", opt.label)
    await ensure_setting_option_uniqueness(db, category=opt.category, value=new_value, label=new_label, exclude_id=opt.id)

    if opt.category == "ServiceType" and "metadata_keys" in clean_data:
        new_keys = set(clean_data.get("metadata_keys") or [])
        removed_keys = old_keys - new_keys
        if removed_keys:
            usage_query = select(models.LogicalService).filter(models.LogicalService.service_type == opt.value)
            usage_res = await db.execute(usage_query)
            in_use_services = usage_res.scalars().all()
            for svc in in_use_services:
                config = svc.config_json or {}
                for rk in sorted(removed_keys):
                    if rk in config and config[rk]:
                        raise HTTPException(status_code=400, detail=f"Cannot remove metadata key '{rk}' because it is in use by service '{svc.name}'")

    if old_value != new_value:
        await rename_setting_option_references(db, opt.category, old_value, new_value)

    opt.value = new_value
    opt.label = new_label
    if "description" in clean_data:
        opt.description = clean_data.get("description")
    if "metadata_keys" in clean_data:
        opt.metadata_keys = clean_data.get("metadata_keys") or []
    
    await db.commit()
    await db.refresh(opt)
    return opt

@router.delete("/options/{opt_id}")
async def delete_option(
    opt_id: int,
    _settings_access: models.Operator = Depends(require_capability("settings", 3)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(models.SettingOption).filter(models.SettingOption.id == opt_id))
    opt = result.scalar_one_or_none()
    if not opt: raise HTTPException(404, "Option not found")
    if opt.category in LOCKED_MONITORING_OPTION_CATEGORIES:
        raise HTTPException(status_code=400, detail="This monitoring category is code-managed and cannot be edited in settings")
    if opt.category in RELATIONAL_OPTION_CATEGORIES:
        raise HTTPException(status_code=400, detail="This category is managed by relational settings data and cannot be edited as an enum")

    if await setting_option_is_in_use(db, opt.category, opt.value):
        raise HTTPException(status_code=400, detail="Cannot delete option that is currently in use")
        
    await db.execute(delete(models.SettingOption).where(models.SettingOption.id == opt_id))
    await db.commit()
    return {"status": "success"}

@router.get("/ui")
async def get_ui_settings(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(models.SettingOption).filter(models.SettingOption.category == "UISettings"))
    opts = res.scalars().all()
    
    settings = {
        "status_badged": True,
        "status_colors": {
            "Active": "#10b981",
            "Maintenance": "#f59e0b",
            "Decommissioned": "#f43f5e",
            "Planned": "#3b82f6"
        }
    }
    
    for o in opts:
        if o.label == "status_badged":
            settings["status_badged"] = (o.value == "true")
        elif o.label.startswith("color_"):
            status_name = o.label.replace("color_", "")
            settings["status_colors"][status_name] = o.value
            
    return settings

@router.post("/ui")
async def update_ui_settings(
    data: dict,
    request: Request,
    _settings_access: models.Operator = Depends(require_capability("settings", 3)),
    db: AsyncSession = Depends(get_db),
):
    # Simple clear and set
    from sqlalchemy import delete
    user_id = get_current_user_id(request)
    
    # Security Check
    res_op = await db.execute(select(models.Operator).filter(models.Operator.username == user_id))
    operator = res_op.scalar_one_or_none()
    if not operator or not operator.is_admin:
        raise HTTPException(status_code=403, detail="Privileged Access Required: UI customization restricted to administrators.")

    await db.execute(delete(models.SettingOption).where(models.SettingOption.category == "UISettings"))
    
    if "status_badged" in data:
        db.add(models.SettingOption(category="UISettings", label="status_badged", value="true" if data["status_badged"] else "false"))
    
    if "status_colors" in data:
        for status_name, color in data["status_colors"].items():
            db.add(models.SettingOption(category="UISettings", label=f"color_{status_name}", value=color))
            
    await db.commit()
    return {"status": "success"}


@router.get("/startup-check")
async def get_startup_check(
    request: Request,
    _diagnostics_access: models.Operator = Depends(require_diagnostics_access),
    config_db: AsyncSession = Depends(get_config_db),
):
    user_id = get_current_user_id(request)
    configured_identity_value = os.getenv(settings.USER_ID_ENV_VAR, "")
    frontend_env = parse_env_file_to_map(settings.FRONTEND_ENV_FILE_PATH)
    vite_api_base_url_raw = frontend_env.get("VITE_API_BASE_URL", "").strip()
    configured_api_origin, configured_api_origin_valid = sanitize_api_origin(vite_api_base_url_raw)
    request_origin = request.headers.get("origin", "")
    cors_origins = settings.cors_origins
    allows_request_origin = "*" in cors_origins or not request_origin or request_origin in cors_origins
    request_base_origin = str(request.base_url).rstrip("/")
    vite_api_base_url_includes_api_v1 = vite_api_base_url_raw.lower().endswith("/api/v1")

    warnings: list[str] = []
    if vite_api_base_url_includes_api_v1:
      warnings.append("VITE_API_BASE_URL should be the backend origin only and must not include /api/v1.")
    if request_origin and not allows_request_origin:
      warnings.append(f"BACKEND_CORS_ORIGINS does not include the request origin: {request_origin}")
    if not vite_api_base_url_raw:
      warnings.append("VITE_API_BASE_URL is blank. This is fine only when the frontend can reach the backend on the same origin.")
    elif not configured_api_origin_valid:
      warnings.append("VITE_API_BASE_URL is configured but invalid. Use a valid http/https origin only.")
    if settings.DEFAULT_USER_ID == "admin_root":
      warnings.append("DEFAULT_USER_ID is still using the default admin_root fallback.")

    access_rows = (
      await config_db.execute(
        select(UserTenantAccess, Tenant)
        .join(Tenant, Tenant.id == UserTenantAccess.tenant_id)
        .where(UserTenantAccess.user_id == user_id)
      )
    ).all()
    selected_tenant_present = False
    for access, tenant in access_rows:
      if access.is_selected:
        selected_tenant_present = True
        break
    if not selected_tenant_present:
      warnings.append("No selected tenant access found for the current runtime user.")

    return {
      "status": "ok" if not warnings else "warning",
      "api": {
        "configured_origin": configured_api_origin,
        "configured_api_origin_valid": configured_api_origin_valid,
        "vite_api_base_url_configured": bool(vite_api_base_url_raw),
        "vite_api_base_url_includes_api_v1": vite_api_base_url_includes_api_v1,
        "request_origin": request_origin,
        "request_base_origin": request_base_origin,
        "api_prefix": settings.API_V1_STR,
      },
      "cors": {
        "allows_request_origin": allows_request_origin,
        "configured_origin_count": len(cors_origins),
        "wildcard_origin_enabled": "*" in cors_origins,
      },
      "runtime": {
        "environment_mode": infer_sanitized_environment_mode(),
        "default_user_id_is_fallback": settings.DEFAULT_USER_ID == "admin_root",
        "user_id_env_value_present": bool(configured_identity_value),
        "public_readonly_enabled": settings.PUBLIC_READONLY_ENABLED,
        "public_readonly_tenant_configured": bool(settings.PUBLIC_READONLY_TENANT_NAME),
        "frontend_build_version_hint": frontend_build_version_hint(),
      },
      "contracts": build_import_export_contract_summary(),
      "tenant": {
        "selected_tenant_present": selected_tenant_present,
        "accessible_tenant_count": len(access_rows),
      },
      "warnings": warnings,
    }

@router.get("/global")
async def get_global_settings(
    request: Request,
    _settings_access: models.Operator = Depends(require_capability("settings", 3)),
    db: AsyncSession = Depends(get_db),
    config_db: AsyncSession = Depends(get_config_db),
):
    """Fetch all settings from the unified GlobalSetting table."""
    user_id = get_current_user_id(request)
    # Security: Verify if user is admin before exposing raw env
    operator = await ensure_admin_operator(db, user_id)
    if not operator or not operator.is_admin:
        raise HTTPException(status_code=403, detail="Privileged Access Required: Raw configuration analysis restricted to administrators.")

    res = await config_db.execute(select(GlobalSetting))
    settings_list = res.scalars().all()
    
    # Return as a simple key-value map for the UI, plus metadata if needed
    config = {s.key: s.value for s in settings_list}
    config["_metadata"] = {s.key: {"category": s.category, "description": s.description, "file": "Database", "param": s.key} for s in settings_list}
    config["_deployment"] = {
        "database_url_configured": bool(settings.DATABASE_URL),
        "config_database_url_configured": bool(settings.CONFIG_DATABASE_URL),
        "tenant_storage_root": "[redacted]",
        "backend_env_file_configured": bool(settings.BACKEND_ENV_FILE_PATH),
        "frontend_env_file_configured": bool(settings.FRONTEND_ENV_FILE_PATH),
        "default_tenant_name": settings.DEFAULT_TENANT_NAME,
        "default_user_id": settings.DEFAULT_USER_ID,
        "auto_admin_user_ids": sorted(settings.auto_admin_user_ids),
        "default_email_domain": settings.DEFAULT_EMAIL_DOMAIN,
        "project_name": settings.PROJECT_NAME,
        "environment": settings.ENVIRONMENT
    }
    
    # Inject Raw Environment Data for Analysis tab
    raw_env = {"backend": {}, "frontend": {}}
    
    # Helper to parse .env files with redaction
    def parse_env(path):
        if not os.path.exists(path): return {}
        data = {}
        redact_patterns = [
            "KEY", "SECRET", "PASSWORD", "TOKEN", "AUTH", "CREDENTIAL",
            "DATABASE", "PRIVATE", "COOKIE", "CERT", "URL",
        ]
        with open(path, "r") as f:
            for line in f:
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip()
                    is_sensitive = any(p in k.upper() for p in redact_patterns)
                    data[k] = {
                        "value": v if not is_sensitive and k.upper() in SAFE_DIAGNOSTIC_ENV_KEYS else "********",
                        "file": "[redacted]",
                    }
        return data

    # Backend .env
    raw_env["backend"] = parse_env(settings.BACKEND_ENV_FILE_PATH)
    
    # Frontend .env
    raw_env["frontend"] = parse_env(settings.FRONTEND_ENV_FILE_PATH)
    
    config["_raw_env"] = raw_env
    return config

@router.post("/global")
async def update_global_settings(
    data: dict,
    request: Request,
    _settings_access: models.Operator = Depends(require_capability("settings", 3)),
    db: AsyncSession = Depends(get_db),
    config_db: AsyncSession = Depends(get_config_db),
):
    """Update unified settings and log to Audit Trail."""
    from sqlalchemy.exc import IntegrityError
    user_id = get_current_user_id(request)
    
    # Security: Verify if user is admin
    operator = await ensure_admin_operator(db, user_id)
    if not operator or not operator.is_admin:
        raise HTTPException(status_code=403, detail="Privileged Access Required: Configuration updates restricted to administrators.")

    protected_keys = {
        "DATABASE_URL",
        "CONFIG_DATABASE_URL",
        "TENANT_STORAGE_ROOT",
        "BACKEND_ENV_FILE_PATH",
        "FRONTEND_ENV_FILE_PATH",
        "DEFAULT_TENANT_NAME",
        "DEFAULT_USER_ID",
        "AUTO_ADMIN_USER_IDS",
        "SYSTEM_ROOT_USER_IDS",
        "CONTROL_PLANE_ADMIN_USER_IDS",
        "MODULE_STAGE_OVERRIDES",
        "PV1_RELEASE_CANDIDATE_SHA",
        "PV1_RELEASE_ID",
        "DEFAULT_EMAIL_DOMAIN"
    }

    for key, value in data.items():
        if key.startswith("_"): continue # Skip metadata
        if key in protected_keys:
            raise HTTPException(status_code=400, detail=f"{key} is a deploy-time setting and must be changed through environment/bootstrap configuration, not runtime global settings.")
        res = await config_db.execute(select(GlobalSetting).filter(GlobalSetting.key == key))
        setting = res.scalar_one_or_none()
        old_value = setting.value if setting else "None"
        
        if setting:
            setting.value = str(value)
            # Hot-reload in-memory config if attribute exists
            if hasattr(settings, key):
                try:
                    # Attempt type conversion if needed
                    current_val = getattr(settings, key)
                    if isinstance(current_val, bool):
                        new_val = str(value).lower() in ("true", "1", "yes")
                    elif isinstance(current_val, int):
                        new_val = int(value)
                    else:
                        new_val = str(value)
                    setattr(settings, key, new_val)
                except Exception as e:
                    print(f"Failed to hot-reload {key}: {e}")
        else:
            # Auto-detect if it should be public (Frontend usually needs VITE_ prefixed vars)
            is_public = key.startswith("VITE_") or key in ["PORT", "API_ENDPOINT"]
            config_db.add(GlobalSetting(
                key=key, 
                value=str(value), 
                is_public=is_public,
                category="Infrastructure"
            ))
        
        # Add to Audit Log
        db.add(models.AuditLog(
            user_id=user_id,
            action="UPDATE_SETTING",
            target_table="GLOBAL_SETTING",
            target_id=key,
            changes={"old": old_value, "new": str(value)},
            description=f"Configuration parameter '{key}' updated via Admin Dashboard."
        ))
        
        # Also add to EnvHistory for specialized history view
        db.add(models.EnvHistory(
            field=key,
            old_value=old_value,
            new_value=str(value),
            user=user_id
        ))

    try:
        await config_db.commit()
        await db.commit()
    except IntegrityError as e:
        await config_db.rollback()
        await db.rollback()
        print(f"IntegrityError during global settings update: {e}")
        raise HTTPException(status_code=409, detail=f"Configuration conflict detected: {str(e.orig)}")
    except Exception as e:
        await config_db.rollback()
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save settings: {str(e)}")
    
    # Notify all connected clients via WebSocket
    if hasattr(request.app.state, 'ws_manager'):
        await request.app.state.ws_manager.broadcast(
            "CONFIG_UPDATED",
            tenant_id=getattr(request.state, "tenant_id", None),
        )
        
    return {"status": "success"}

@router.get("/env/history")
async def get_env_history(
    field: str,
    _settings_access: models.Operator = Depends(require_capability("settings", 3)),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(models.EnvHistory).filter(models.EnvHistory.field == field).order_by(models.EnvHistory.timestamp.desc()))
    return res.scalars().all()

@router.get("/operators")
async def get_operators(db: AsyncSession = Depends(get_db)):
    from sqlalchemy.orm import selectinload
    res = await db.execute(select(models.Operator).options(selectinload(models.Operator.role), selectinload(models.Operator.team_rel)))
    return res.scalars().all()

@router.get("/teams")
async def get_teams(db: AsyncSession = Depends(get_db)):
    from sqlalchemy.orm import selectinload
    res = await db.execute(
        select(models.Team)
        .options(selectinload(models.Team.operators))
        .order_by(models.Team.is_archived.asc(), models.Team.name.asc())
    )
    teams = res.scalars().all()
    return [
        {
            "id": team.id,
            "name": team.name,
            "description": team.description,
            "source": team.source,
            "is_archived": team.is_archived,
            "metadata_json": team.metadata_json or {},
            "created_at": team.created_at,
            "updated_at": team.updated_at,
            "operators": [
                {
                    "id": operator.id,
                    "external_id": operator.external_id,
                    "username": operator.username,
                    "full_name": operator.full_name,
                    "team_id": operator.team_id,
                    "team": operator.team,
                    "team_source": operator.team_source,
                }
                for operator in team.operators
            ],
        }
        for team in teams
    ]

@router.get("/teams/{team_id}/audit")
async def get_team_audit(team_id: int, db: AsyncSession = Depends(get_db)):
    team_res = await db.execute(select(models.Team).filter(models.Team.id == team_id))
    team = team_res.scalar_one_or_none()
    if not team:
        raise HTTPException(404, "Team not found")
    audit_res = await db.execute(
        select(models.TeamAudit)
        .filter(models.TeamAudit.team_id == team_id)
        .order_by(models.TeamAudit.created_at.desc())
    )
    return audit_res.scalars().all()

@router.post("/teams")
async def create_team(
    data: dict,
    request: Request,
    _settings_access: models.Operator = Depends(require_capability("settings", 3)),
    db: AsyncSession = Depends(get_db),
):
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Team name is required")
    existing_res = await db.execute(select(models.Team).filter(models.Team.name == name))
    if existing_res.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Team already exists")
    team = models.Team(
        name=name,
        description=(data.get("description") or "").strip() or None,
        source=data.get("source") or "manual",
        is_archived=bool(data.get("is_archived", False)),
        metadata_json=data.get("metadata_json") or {}
    )
    db.add(team)
    await db.flush()
    user_id = get_current_user_id(request)
    await record_team_audit(db, team.id, "team_created", user_id, {"name": team.name})
    await create_user_pool_version(db, created_by=user_id, diff_summary={
        "added": 0,
        "removed": 0,
        "changed": 1,
        "team_updates": [{"team": team.name, "mode": "team_created"}],
    })
    await db.commit()
    await db.refresh(team)
    return team

@router.patch("/teams/{team_id}")
async def update_team(
    team_id: int,
    data: dict,
    request: Request,
    _settings_access: models.Operator = Depends(require_capability("settings", 3)),
    db: AsyncSession = Depends(get_db),
):
    team_res = await db.execute(select(models.Team).filter(models.Team.id == team_id))
    team = team_res.scalar_one_or_none()
    if not team:
        raise HTTPException(404, "Team not found")

    old_name = team.name
    next_name = (data.get("name") or team.name).strip()
    if not next_name:
        raise HTTPException(status_code=400, detail="Team name is required")
    if next_name != old_name:
        dupe_res = await db.execute(select(models.Team).filter(models.Team.name == next_name, models.Team.id != team_id))
        if dupe_res.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Team already exists")
        team.name = next_name
        await db.execute(update(models.Operator).where(models.Operator.team_id == team_id).values(team=next_name))
        await rename_operator_group_memberships(db, old_name, next_name)
        await rename_monitoring_team_references(db, old_name, next_name)
        await db.execute(
            update(models.ExternalEntity)
            .where(
                (models.ExternalEntity.internal_team_id == team_id) |
                (models.ExternalEntity.owner_team == old_name)
            )
            .values(owner_team=next_name)
        )

    if "description" in data:
        team.description = (data.get("description") or "").strip() or None
    if "is_archived" in data:
        team.is_archived = bool(data.get("is_archived"))
    if "metadata_json" in data:
        team.metadata_json = data.get("metadata_json") or {}

    # Check for actual changes
    has_changed = (
        old_name != team.name or
        "description" in data or
        "is_archived" in data or
        "metadata_json" in data
    )

    user_id = get_current_user_id(request)
    if has_changed:
        await record_team_audit(db, team.id, "team_updated", user_id, {"from": old_name, "to": team.name})
        await create_user_pool_version(db, created_by=user_id, diff_summary={
            "added": 0,
            "removed": 0,
            "changed": 1,
            "team_updates": [{"team": team.name, "mode": "team_updated", "old": old_name, "new": team.name}],
        })
    await db.commit()
    await db.refresh(team)
    return team

@router.delete("/teams/{team_id}")
async def delete_team(
    team_id: int,
    request: Request,
    _settings_access: models.Operator = Depends(require_capability("settings", 3)),
    db: AsyncSession = Depends(get_db),
):
    team_res = await db.execute(select(models.Team).filter(models.Team.id == team_id))
    team = team_res.scalar_one_or_none()
    if not team:
        raise HTTPException(404, "Team not found")
    members_res = await db.execute(select(models.Operator).filter(models.Operator.team_id == team_id))
    members = members_res.scalars().all()
    reference_map = await team_references_exist(db, team_id=team.id, team_name=team.name)
    if members or any(reference_map.values()):
        active_refs = ", ".join(label.replace("_", " ") for label, exists in reference_map.items() if exists)
        raise HTTPException(status_code=400, detail=f"Cannot delete team while references still exist: {active_refs}")
    user_id = get_current_user_id(request)
    await record_team_audit(db, None, "team_deleted", user_id, {"team_id": team.id, "name": team.name})
    await db.execute(delete(models.Team).where(models.Team.id == team_id))
    await create_user_pool_version(db, created_by=user_id, diff_summary={
        "added": 0,
        "removed": 0,
        "changed": 1,
        "team_updates": [{"team": team.name, "mode": "team_deleted"}],
    })
    await db.commit()
    return {"status": "success"}

@router.post("/operators")
async def create_operator(
    data: dict,
    request: Request,
    _settings_access: models.Operator = Depends(require_capability("settings", 3)),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.exc import IntegrityError
    external_id = normalize_string(data.get("external_id"))
    username = normalize_string(data.get("username"))
    if not external_id:
        raise HTTPException(status_code=400, detail="External ID is required")
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    res = await db.execute(select(models.Operator).filter(models.Operator.external_id == external_id))
    op = res.scalar_one_or_none()
    existing_operator = op is not None
    if op:
        await ensure_operator_identity_uniqueness(db, external_id=external_id, username=username, exclude_id=op.id)
    else:
        await ensure_operator_identity_uniqueness(db, external_id=external_id, username=username)
    await resolve_role_assignment(db, data.get("role_id"))

    team = await resolve_team_assignment(
        db,
        team_id=data.get("team_id"),
        team_name=data.get("team"),
        source=data.get("team_source") or "manual",
        create_missing=bool(data.get("team"))
    )

    user_id = get_current_user_id(request)
    reject_reserved_system_root_identity(
        {"external_id": external_id, "username": username, **data},
        actor_id=user_id,
    )
    if op:
        previous_state = canonical_operator_state(op)
        patch_payload = dict(data)
        patch_payload["external_id"] = external_id
        patch_payload["username"] = username
        apply_operator_canonicalization(op, team=team, payload=patch_payload, default_source="manual")
        current_state = canonical_operator_state(op)
        has_semantic_change = previous_state != current_state
    else:
        has_semantic_change = True
        clean_data = filter_valid_columns(models.Operator, {
            "username": username,
            "external_id": external_id,
            "full_name": normalize_string(data.get("full_name")),
            "email": normalize_string(data.get("email")),
            "department": normalize_string(data.get("department")),
            "registration_status": normalize_string(data.get("registration_status")),
            "is_admin": bool(data.get("is_admin", False)),
            "custom_permissions": normalize_permission_map(data.get("custom_permissions")),
            "role_id": data.get("role_id"),
            "teams": normalize_string_list(data.get("teams") or []),
        })
        op = models.Operator(**clean_data)
        apply_operator_canonicalization(op, team=team, payload=data, default_source="manual")
        db.add(op)
    
    try:
        if team:
            await record_team_audit(db, team.id, "member_added", user_id, {"external_id": external_id, "username": op.username})
        
        if has_semantic_change:
            await create_user_pool_version(db, created_by=user_id, diff_summary={
                "added": 0 if existing_operator else 1,
                "removed": 0,
                "changed": 1 if existing_operator else 0,
                "team_updates": [{"external_id": external_id, "team": team.name, "mode": "member_added"}] if team else [],
            })
        await db.commit()
        await db.refresh(op)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Operator with this ID or Username already exists.")
    return op

@router.patch("/operators/{op_id}")
async def update_operator(
    op_id: int,
    data: dict,
    request: Request,
    _settings_access: models.Operator = Depends(require_capability("settings", 3)),
    db: AsyncSession = Depends(get_db),
):
    user_id = get_current_user_id(request)
    res = await db.execute(select(models.Operator).filter(models.Operator.id == op_id))
    op = res.scalar_one_or_none()
    if not op: raise HTTPException(404, "Operator not found")
    reject_reserved_system_root_identity(
        {"external_id": op.external_id, "username": op.username, "id": op.external_id, **data},
        actor_id=user_id,
    )
    update_result = await apply_operator_patch(db, op=op, data=data, user_id=user_id)
    if update_result["changed"]:
        await create_user_pool_version(db, created_by=user_id, diff_summary={
            "added": 0,
            "removed": 0,
            "changed": 1,
            "team_updates": update_result["team_updates"],
        })
            
    await db.commit()
    await db.refresh(op)
    return op

@router.delete("/operators/{op_id}")
async def delete_operator(
    op_id: int,
    request: Request,
    _settings_access: models.Operator = Depends(require_capability("settings", 3)),
    db: AsyncSession = Depends(get_db),
):
    user_id = get_current_user_id(request)
    res = await db.execute(select(models.Operator).filter(models.Operator.id == op_id))
    op = res.scalar_one_or_none()
    if not op: raise HTTPException(404, "Operator not found")
    reject_reserved_system_root_identity(
        {"external_id": op.external_id, "username": op.username, "id": op.external_id},
        actor_id=user_id,
    )
    delete_result = await apply_operator_delete(db, op=op, user_id=user_id)
    await create_user_pool_version(db, created_by=user_id, diff_summary={
        "added": 0,
        "removed": 1,
        "changed": 0,
        "team_updates": delete_result["team_updates"],
    })
    await db.commit()
    return {"status": "success"}


@router.post("/operators/bulk-update")
async def bulk_update_operators(
    data: dict,
    request: Request,
    _settings_access: models.Operator = Depends(require_capability("settings", 3)),
    db: AsyncSession = Depends(get_db),
):
    updates = data.get("updates")
    if not isinstance(updates, list) or not updates:
        raise HTTPException(status_code=400, detail="A non-empty updates list is required")

    user_id = get_current_user_id(request)
    before_snapshot = await build_user_pool_snapshot(db)
    team_updates: list[dict] = []
    changed_count = 0

    for index, update_item in enumerate(updates):
        if not isinstance(update_item, dict):
            raise HTTPException(status_code=400, detail=f"updates[{index}] must be an object")
        op_id = update_item.get("id")
        payload = update_item.get("payload")
        if not isinstance(op_id, int):
            raise HTTPException(status_code=400, detail=f"updates[{index}].id must be an integer")
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail=f"updates[{index}].payload must be an object")
        res = await db.execute(select(models.Operator).filter(models.Operator.id == op_id))
        op = res.scalar_one_or_none()
        if not op:
            raise HTTPException(status_code=404, detail=f"Operator {op_id} not found")
        reject_reserved_system_root_identity(
            {"external_id": op.external_id, "username": op.username, "id": op.external_id, **payload},
            actor_id=user_id,
        )
        update_result = await apply_operator_patch(db, op=op, data=payload, user_id=user_id)
        if update_result["changed"]:
            changed_count += 1
        team_updates.extend(update_result["team_updates"])

    if changed_count:
        await create_user_pool_version_from_snapshot_delta(
            db,
            created_by=user_id,
            before_snapshot=before_snapshot,
            extra_summary={"team_updates": team_updates, "source": "bulk_operator_update"},
        )

    await db.commit()
    return {"status": "success", "changed": changed_count > 0, "updated": changed_count}


@router.post("/operators/bulk-delete")
async def bulk_delete_operators(
    data: dict,
    request: Request,
    _settings_access: models.Operator = Depends(require_capability("settings", 3)),
    db: AsyncSession = Depends(get_db),
):
    ids = data.get("ids")
    if not isinstance(ids, list) or not ids:
        raise HTTPException(status_code=400, detail="A non-empty ids list is required")

    user_id = get_current_user_id(request)
    before_snapshot = await build_user_pool_snapshot(db)
    team_updates: list[dict] = []
    deleted_count = 0

    for index, op_id in enumerate(ids):
        if not isinstance(op_id, int):
            raise HTTPException(status_code=400, detail=f"ids[{index}] must be an integer")
        res = await db.execute(select(models.Operator).filter(models.Operator.id == op_id))
        op = res.scalar_one_or_none()
        if not op:
            raise HTTPException(status_code=404, detail=f"Operator {op_id} not found")
        reject_reserved_system_root_identity(
            {"external_id": op.external_id, "username": op.username, "id": op.external_id},
            actor_id=user_id,
        )
        delete_result = await apply_operator_delete(db, op=op, user_id=user_id)
        deleted_count += 1
        team_updates.extend(delete_result["team_updates"])

    if deleted_count:
        await create_user_pool_version_from_snapshot_delta(
            db,
            created_by=user_id,
            before_snapshot=before_snapshot,
            extra_summary={"team_updates": team_updates, "source": "bulk_operator_delete"},
        )

    await db.commit()
    return {"status": "success", "changed": deleted_count > 0, "deleted": deleted_count}

@router.get("/roles")
async def get_roles(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(models.Role))
    return res.scalars().all()

@router.get("/user-pool/versions")
async def get_user_pool_versions(
    _settings_access: models.Operator = Depends(require_capability("settings", 3)),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(models.UserPoolVersion).order_by(models.UserPoolVersion.created_at.desc(), models.UserPoolVersion.id.desc()))
    return res.scalars().all()

@router.post("/user-pool/refresh")
async def refresh_user_pool(
    data: dict,
    request: Request,
    _settings_access: models.Operator = Depends(require_capability("settings", 3)),
    db: AsyncSession = Depends(get_db),
):
    preview = data.get("preview", False)
    user_id = get_current_user_id(request)

    import datetime
    version_label = f"v{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}"

    raw_records = data.get("records")
    if not isinstance(raw_records, list) or not raw_records:
        raise HTTPException(
            status_code=400,
            detail="User-pool refresh now requires a non-empty 'records' array from a real identity source",
        )

    source_records = []
    seen_external_ids: set[str] = set()
    seen_usernames: set[str] = set()
    for index, raw_record in enumerate(raw_records):
        if not isinstance(raw_record, dict):
            raise HTTPException(status_code=400, detail=f"records[{index}] must be an object")
        external_id = normalize_string(raw_record.get("external_id") or raw_record.get("id"))
        username = normalize_string(raw_record.get("username"))
        full_name = normalize_string(raw_record.get("full_name"))
        if not external_id or not username or not full_name:
            raise HTTPException(
                status_code=400,
                detail=f"records[{index}] requires external_id/id, username, and full_name",
            )
        reject_reserved_system_root_identity(
            {"external_id": external_id, "username": username, "id": raw_record.get("id")},
            actor_id=user_id,
        )
        if external_id in seen_external_ids:
            raise HTTPException(status_code=400, detail=f"Duplicate external_id '{external_id}' found in source records")
        if username in seen_usernames:
            raise HTTPException(status_code=400, detail=f"Duplicate username '{username}' found in source records")
        seen_external_ids.add(external_id)
        seen_usernames.add(username)
        source_records.append({
            "external_id": external_id,
            "username": username,
            "full_name": full_name,
            "email": normalize_string(raw_record.get("email")),
            "department": normalize_string(raw_record.get("department")),
            "team": normalize_string(raw_record.get("team")),
            "registration_status": normalize_string(raw_record.get("registration_status")),
        })

    diff_summary = {
        "added": 0,
        "removed": 0,
        "changed": 0,
        "source": normalize_string(data.get("source")) or "identity_ingestion",
        "team_conflicts": [],
        "team_updates": [],
    }
    preview_items = []
    existing_username_map = {
        operator.username: operator.external_id
        for operator in (await db.execute(select(models.Operator))).scalars().all()
        if operator.username and operator.external_id
    }
    for record in source_records:
        existing_external_id_for_username = existing_username_map.get(record["username"])
        if existing_external_id_for_username and existing_external_id_for_username != record["external_id"]:
            raise HTTPException(
                status_code=409,
                detail=f"Username '{record['username']}' is already assigned to a different operator",
            )

    source_external_ids = set()
    for u in source_records:
        ext_id = u["external_id"]
        source_external_ids.add(ext_id)
        res = await db.execute(select(models.Operator).filter(models.Operator.external_id == ext_id))
        op = res.scalar_one_or_none()

        reject_reserved_system_root_identity(
            {"external_id": ext_id, "username": u["username"], "id": ext_id},
            actor_id=user_id,
        )

        item_status = "unchanged"
        item_changes = {}

        if not op:
            item_status = "new"
            diff_summary["added"] += 1
            preview_items.append({
                "id": ext_id,
                "username": u["username"],
                "full_name": u["full_name"],
                "email": u["email"],
                "department": u["department"],
                "team": u.get("team"),
                "status": "new",
                "changes": {}
            })
            
            if not preview:
                team = await resolve_team_assignment(
                    db,
                    team_name=u.get("team"),
                    source="synced",
                    create_missing=bool(u.get("team"))
                ) if u.get("team") else None
                
                db.add(models.Operator(
                    external_id=ext_id,
                    username=u["username"],
                    full_name=u["full_name"],
                    email=u["email"],
                    department=u["department"],
                    registration_status=u["registration_status"],
                    team=team.name if team else None,
                    team_id=team.id if team else None,
                    team_source="synced" if team else "manual"
                ))
                if team:
                    diff_summary["team_updates"].append({"external_id": ext_id, "team": team.name, "mode": "created"})
                    await record_team_audit(db, team.id, "member_added_via_sync", user_id, {"external_id": ext_id, "username": u["username"]})
        else:
            core_fields = ["username", "full_name", "email", "department", "registration_status", "team"]
            has_changes = False
            for f in core_fields:
                old_val = getattr(op, f)
                new_val = u.get(f)
                if str(old_val) != str(new_val):
                    item_changes[f] = {"old": old_val, "new": new_val}
                    has_changes = True
            
            if has_changes:
                item_status = "changed"
                diff_summary["changed"] += 1
            
            preview_items.append({
                "id": ext_id,
                "username": u["username"],
                "full_name": u["full_name"],
                "email": u["email"],
                "department": u["department"],
                "team": u.get("team"),
                "status": item_status,
                "changes": item_changes
            })
            
            if not preview and has_changes:
                op.username = u["username"]
                op.full_name = u["full_name"]
                op.email = u["email"]
                op.department = u["department"]
                op.registration_status = u["registration_status"]
                
                team = await resolve_team_assignment(
                    db,
                    team_name=u.get("team"),
                    source="synced",
                    create_missing=bool(u.get("team"))
                ) if u.get("team") else None
                
                if team:
                    if op.team_source == "manual_override" and op.team and op.team != team.name:
                        diff_summary["team_conflicts"].append({
                            "external_id": op.external_id,
                            "local_team": op.team,
                            "synced_team": team.name
                        })
                    else:
                        if op.team_id != team.id:
                            if op.team_id:
                                await record_team_audit(db, op.team_id, "member_removed_via_sync", user_id, {"external_id": op.external_id, "username": op.username})
                            await record_team_audit(db, team.id, "member_added_via_sync", user_id, {"external_id": op.external_id, "username": op.username})
                            diff_summary["team_updates"].append({"external_id": op.external_id, "team": team.name, "mode": "updated"})
                        op.team = team.name
                        op.team_id = team.id
                        op.team_source = "synced"
                elif op.team_source == "synced":
                    if op.team_id:
                        await record_team_audit(db, op.team_id, "member_removed_via_sync", user_id, {"external_id": op.external_id, "username": op.username})
                    op.team = None
                    op.team_id = None
                    op.team_source = "manual"

    res_all = await db.execute(select(models.Operator))
    all_ops = res_all.scalars().all()
    for op in all_ops:
        if (
            op.external_id
            and op.external_id not in source_external_ids
            and op.team_source == "synced"
            and op.username != user_id
            and not settings.is_auto_admin_user(op.username)
        ):
            diff_summary["removed"] += 1
            preview_items.append({
                "id": op.external_id,
                "username": op.username,
                "full_name": op.full_name,
                "email": op.email,
                "department": op.department,
                "team": op.team,
                "status": "removed",
                "changes": {}
            })
            if not preview:
                if op.team_id:
                    await record_team_audit(db, op.team_id, "member_removed_via_sync", user_id, {"external_id": op.external_id, "username": op.username})
                await db.delete(op)

    if preview:
        return {
            "status": "success", 
            "preview": preview_items, 
            "summary": diff_summary,
            "version_label": version_label
        }

    # Only save version if something actually changed
    has_actual_changes = diff_summary["added"] > 0 or diff_summary["removed"] > 0 or diff_summary["changed"] > 0
    
    if has_actual_changes:
        await create_user_pool_version(
            db,
            created_by=user_id,
            diff_summary=diff_summary,
            version_label=version_label,
        )
        await db.commit()
        return {"status": "success", "version": version_label, "changes": True}
    
    await db.commit()
    return {"status": "success", "version": None, "changes": False}

@router.post("/user-pool/restore/{version_id}")
async def restore_user_pool(
    version_id: int,
    request: Request,
    _settings_access: models.Operator = Depends(require_capability("settings", 3)),
    db: AsyncSession = Depends(get_db),
):
    user_id = get_current_user_id(request)
    res = await db.execute(select(models.UserPoolVersion).filter(models.UserPoolVersion.id == version_id))
    version = res.scalar_one_or_none()
    if not version: raise HTTPException(404, "Version not found")
    
    # Identify all current operators to handle deletions
    res_current = await db.execute(select(models.Operator))
    current_ops = {op.external_id: op for op in res_current.scalars().all() if op.external_id}
    
    snapshot_external_ids = set()
    snapshot_usernames: set[str] = set()
    
    # Sync version data back to operators
    for u in version.snapshot_data:
        ext_id = str(u.get("external_id") or u.get("id"))
        snapshot_external_ids.add(ext_id)
        username = normalize_string(u.get("username"))
        if not username:
            raise HTTPException(status_code=400, detail=f"Snapshot record for '{ext_id}' is missing username")
        reject_reserved_system_root_identity(
            {"external_id": ext_id, "username": username, "id": ext_id},
            actor_id=user_id,
        )
        if username in snapshot_usernames:
            raise HTTPException(status_code=409, detail=f"Snapshot contains duplicate username '{username}'")
        snapshot_usernames.add(username)
        
        team = await resolve_team_assignment(
            db,
            team_name=u.get("team"),
            source="synced",
            create_missing=bool(u.get("team"))
        ) if u.get("team") else None
        role = await resolve_role_assignment(db, u.get("role_id")) if u.get("role_id") is not None else None
        
        op = current_ops.get(ext_id)
        if not op:
            # Re-create missing operator
            op = models.Operator(external_id=ext_id)
            db.add(op)
        
        await ensure_operator_identity_uniqueness(db, external_id=ext_id, username=username, exclude_id=op.id if op.id else None)
        op.username = username
        op.full_name = u["full_name"]
        op.email = u["email"]
        op.department = u["department"]
        op.team = team.name if team else None
        op.team_id = team.id if team else None
        op.team_source = u.get("team_source", "synced")
        op.teams = normalize_string_list(u.get("teams") or ([team.name] if team else []))
        op.role_id = role.id if role else None
        op.is_admin = bool(u.get("is_admin", False))
        op.custom_permissions = normalize_permission_map(u.get("custom_permissions", {}))
        op.registration_status = u.get("registration_status", "Verified")

    # Delete operators NOT in the snapshot (excluding current user to avoid lockout if they aren't in old version)
    for ext_id, op in current_ops.items():
        if ext_id not in snapshot_external_ids:
            if op.username != user_id:
                await db.delete(op)
             
    # Create a NEW version record with descriptive label
    import datetime
    new_label = f"v{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')} (Cloned from {version.version_label})"
    
    await create_user_pool_version(
        db,
        created_by=user_id,
        diff_summary={
            "revert": True,
            "source_version_id": version.id,
            "source_version_label": version.version_label,
            "added": 0, "removed": 0, "changed": 0 # Placeholder for diff summary
        },
        version_label=new_label
    )
    
    await db.commit()
    return {"status": "success", "new_version": new_label}

@router.get("/initialize")
async def initialize_settings(db: AsyncSession = Depends(get_db)):
    raise HTTPException(
        status_code=410,
        detail="Runtime settings initialization is disabled. Use explicit provisioning/bootstrap instead.",
    )
