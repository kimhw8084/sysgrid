from fastapi import APIRouter, Depends, HTTPException, status, Header
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update, func
from sqlalchemy.orm import joinedload
from typing import List, Optional, Any
from math import isfinite
from urllib.parse import urlparse
from ..database import get_db
from ..domain.monitoring_contract import (
    ALERT_DURATION_MAX,
    ALERT_DURATION_MIN,
    CHECK_INTERVAL_MAX,
    CHECK_INTERVAL_MIN,
    NOTIFICATION_THROTTLE_MAX,
    NOTIFICATION_THROTTLE_MIN,
)
from ..models import models
from ..schemas import schemas
from .utils import filter_valid_columns
from .module_policy import require_module_access

router = APIRouter(
    prefix="/monitoring",
    tags=["Monitoring Matrix"],
    dependencies=[Depends(require_module_access("monitoring"))],
)
IMMUTABLE_MONITORING_FIELDS = {"id", "created_at", "updated_at", "created_by_user_id"}
MONITORING_SEVERITIES = {"Critical", "Warning", "Info"}
MONITORING_STATUSES = {"Existing", "Planned", "Cancelled", "Decommissioned", "Deleted"}
MONITORING_OWNER_ROLES = {"Primary Support", "Escalation", "Observer"}


def normalize_string(value: Any) -> Optional[str]:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def normalize_string_list(values: list[Any] | None) -> list[str]:
    cleaned = {
        normalized
        for normalized in (normalize_string(value) for value in (values or []))
        if normalized
    }
    return sorted(cleaned, key=lambda value: (value.lower(), value))

def normalize_monitoring_url(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    url = value.strip()
    if not url:
        return None
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="Monitoring URL must use http or https")
    if not parsed.netloc:
        raise HTTPException(status_code=400, detail="Monitoring URL must include a host")
    lowered = url.lower()
    blocked_tokens = ("<", ">", "\"", "'", "javascript:", "data:", "vbscript:")
    if any(token in lowered for token in blocked_tokens):
        raise HTTPException(status_code=400, detail="Monitoring URL contains unsafe content")
    return url

async def get_setting_values_by_category(db: AsyncSession, category: str) -> set[str]:
    result = await db.execute(select(models.SettingOption.value).where(models.SettingOption.category == category))
    return {value for value in result.scalars().all() if value}

async def get_registered_team_names(db: AsyncSession) -> set[str]:
    result = await db.execute(select(models.Team.name).where(models.Team.is_archived == False))
    return {name for name in result.scalars().all() if name}


def split_owner_values(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        raw_values = value
    else:
        raw_values = str(value).replace("\n", ",").split(",")
    return [str(entry).strip() for entry in raw_values if str(entry).strip()]


def normalize_recovery_docs(recovery_docs: Any) -> list[dict[str, Any]]:
    normalized_docs = []
    for raw_doc in recovery_docs or []:
        if isinstance(raw_doc, dict):
            normalized_docs.append({
                "id": raw_doc.get("id"),
                "note": normalize_string(raw_doc.get("note")),
                "added_at": raw_doc.get("added_at"),
            })
        else:
            normalized_docs.append({
                "id": raw_doc,
                "note": None,
                "added_at": None,
            })
    return sorted(normalized_docs, key=lambda entry: (entry.get("id") or 0, entry.get("note") or "", str(entry.get("added_at") or "")))


def build_monitoring_snapshot_from_values(
    values: dict[str, Any],
    owners: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    return {
        "device_id": values.get("device_id"),
        "category": normalize_string(values.get("category")),
        "status": normalize_string(values.get("status")),
        "title": normalize_string(values.get("title")),
        "spec": normalize_string(values.get("spec")),
        "platform": normalize_string(values.get("platform")),
        "monitoring_url": normalize_string(values.get("monitoring_url")),
        "purpose": normalize_string(values.get("purpose")),
        "impact": normalize_string(values.get("impact")),
        "notification_method": normalize_string(values.get("notification_method")),
        "notification_recipients": normalize_string_list(values.get("notification_recipients")),
        "logic": normalize_string(values.get("logic")),
        "logic_json": values.get("logic_json") or [],
        "monitored_services": sorted(int(service_id) for service_id in (values.get("monitored_services") or [])),
        "owner_team": ", ".join(normalize_string_list(split_owner_values(values.get("owner_team")))) or None,
        "check_interval": values.get("check_interval"),
        "alert_duration": values.get("alert_duration"),
        "notification_throttle": values.get("notification_throttle"),
        "severity": normalize_string(values.get("severity")),
        "is_active": bool(values.get("is_active", True)),
        "is_deleted": bool(values.get("is_deleted", False)),
        "recovery_docs": normalize_recovery_docs(values.get("recovery_docs")),
        "owners": sorted(
            [
                {
                    "operator_id": owner.get("operator_id"),
                    "name": normalize_string(owner.get("name")),
                    "external_id": normalize_string(owner.get("external_id")),
                    "role": normalize_string(owner.get("role")),
                }
                for owner in (owners or [])
            ],
            key=lambda owner: (
                owner.get("operator_id") or 0,
                owner.get("external_id") or "",
                owner.get("role") or "",
            ),
        ),
    }


def build_monitoring_snapshot(item: models.MonitoringItem) -> dict[str, Any]:
    return build_monitoring_snapshot_from_values(
        {
            "device_id": item.device_id,
            "category": item.category,
            "status": item.status,
            "title": item.title,
            "spec": item.spec,
            "platform": item.platform,
            "monitoring_url": item.monitoring_url,
            "purpose": item.purpose,
            "impact": item.impact,
            "notification_method": item.notification_method,
            "notification_recipients": item.notification_recipients,
            "logic": item.logic,
            "logic_json": item.logic_json,
            "monitored_services": item.monitored_services,
            "owner_team": item.owner_team,
            "check_interval": item.check_interval,
            "alert_duration": item.alert_duration,
            "notification_throttle": item.notification_throttle,
            "severity": item.severity,
            "is_active": item.is_active,
            "is_deleted": item.is_deleted,
            "recovery_docs": item.recovery_docs,
        },
        [
            {
                "operator_id": owner.operator_id,
                "name": owner.name or (owner.operator.full_name if owner.operator else None),
                "external_id": owner.external_id or (owner.operator.external_id if owner.operator else None),
                "role": owner.role,
            }
            for owner in item.owners
        ],
    )


def summarize_monitoring_snapshot_delta(
    before_snapshot: dict[str, Any] | None,
    after_snapshot: dict[str, Any] | None,
    *,
    action_label: str,
) -> str:
    before = before_snapshot or {}
    after = after_snapshot or {}

    if action_label == "create":
        return "Created monitor"
    if action_label == "delete":
        return "Archived monitor"
    if action_label == "restore":
        return "Restored monitor"

    labels = {
        "device_id": "Target asset",
        "category": "Category",
        "status": "Status",
        "title": "Title",
        "spec": "Spec",
        "platform": "Platform",
        "monitoring_url": "Monitoring URL",
        "purpose": "Purpose",
        "impact": "Impact",
        "notification_method": "Notification method",
        "notification_recipients": "Recipients",
        "logic": "Logic",
        "logic_json": "Logic rules",
        "monitored_services": "Monitored services",
        "owner_team": "Owner teams",
        "check_interval": "Check interval",
        "alert_duration": "Alert duration",
        "notification_throttle": "Notification throttle",
        "severity": "Severity",
        "is_active": "Active state",
        "is_deleted": "Deletion state",
        "recovery_docs": "Recovery docs",
        "owners": "Named owners",
    }
    changed_fields = [label for key, label in labels.items() if before.get(key) != after.get(key)]
    if not changed_fields:
        return "No semantic change"
    if len(changed_fields) <= 3:
        return f"Updated {'; '.join(changed_fields)}"
    return f"Updated {', '.join(changed_fields[:3])} and {len(changed_fields) - 3} more"


MONITORING_HISTORY_FIELD_LABELS = {
    "device_id": "Target asset",
    "category": "Category",
    "status": "Status",
    "title": "Title",
    "spec": "Spec",
    "platform": "Platform",
    "monitoring_url": "Monitoring URL",
    "purpose": "Purpose",
    "impact": "Impact",
    "notification_method": "Notification method",
    "notification_recipients": "Recipients",
    "logic": "Logic",
    "logic_json": "Logic rules",
    "monitored_services": "Monitored services",
    "owner_team": "Owner teams",
    "check_interval": "Check interval",
    "alert_duration": "Alert duration",
    "notification_throttle": "Notification throttle",
    "severity": "Severity",
    "is_active": "Active state",
    "is_deleted": "Deletion state",
    "recovery_docs": "Recovery docs",
    "owners": "Named owners",
}


def build_monitoring_history_delta(
    before_snapshot: dict[str, Any] | None,
    after_snapshot: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    before = before_snapshot or {}
    after = after_snapshot or {}
    keys = list(dict.fromkeys([*MONITORING_HISTORY_FIELD_LABELS.keys(), *before.keys(), *after.keys()]))
    delta: list[dict[str, Any]] = []
    for key in keys:
        previous_value = before.get(key)
        next_value = after.get(key)
        if previous_value == next_value:
            continue
        if previous_value is None and next_value is not None:
            change_type = "added"
        elif previous_value is not None and next_value is None:
            change_type = "removed"
        else:
            change_type = "changed"
        delta.append({
            "field": key,
            "label": MONITORING_HISTORY_FIELD_LABELS.get(key, key.replace("_", " ").title()),
            "before": previous_value,
            "after": next_value,
            "change_type": change_type,
        })
    return delta


async def ensure_monitoring_item_uniqueness(
    db: AsyncSession,
    *,
    item_data: dict[str, Any],
    exclude_item_id: int | None = None,
) -> None:
    normalized_title = normalize_string(item_data.get("title"))
    if not normalized_title:
        return

    query = select(models.MonitoringItem).where(
        func.lower(models.MonitoringItem.title) == normalized_title.lower(),
        models.MonitoringItem.device_id == item_data.get("device_id"),
        models.MonitoringItem.category == item_data.get("category"),
        models.MonitoringItem.platform == item_data.get("platform"),
        models.MonitoringItem.is_deleted == False,
    )
    if exclude_item_id is not None:
        query = query.where(models.MonitoringItem.id != exclude_item_id)
    duplicate = (await db.execute(query.limit(1))).scalar_one_or_none()
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail="A monitoring item with the same target asset, title, category, and platform already exists.",
        )


def summarize_bulk_monitoring_action(
    *,
    action: str,
    changed_count: int,
    skipped_count: int,
    changed_fields: set[str] | None = None,
) -> str:
    if changed_count == 0:
        return "No semantic change"

    base = {
        "delete": "Archived monitors",
        "restore": "Restored monitors",
        "restore_purged": "Restored monitors",
        "purge": "Purged monitors",
        "update": "Updated monitors",
    }.get(action, "Updated monitors")
    parts = [f"{base}: {changed_count} changed"]
    if skipped_count:
        parts.append(f"{skipped_count} unchanged")
    if action == "update" and changed_fields:
        labels = sorted(changed_fields)
        if len(labels) <= 3:
            parts.append(f"fields: {', '.join(labels)}")
        else:
            parts.append(f"fields: {', '.join(labels[:3])} and {len(labels) - 3} more")
    return " | ".join(parts)


def validate_monitoring_numeric_fields(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize the shared integer-seconds fields."""
    for field_name, minimum, maximum in (
        ("check_interval", CHECK_INTERVAL_MIN, CHECK_INTERVAL_MAX),
        ("alert_duration", ALERT_DURATION_MIN, ALERT_DURATION_MAX),
        ("notification_throttle", NOTIFICATION_THROTTLE_MIN, NOTIFICATION_THROTTLE_MAX),
    ):
        if field_name not in payload:
            continue
        value = payload[field_name]
        invalid_numeric_value = (
            value is None
            or isinstance(value, bool)
            or not isinstance(value, (int, float))
            or (isinstance(value, float) and (not isfinite(value) or not value.is_integer()))
        )
        if invalid_numeric_value:
            raise HTTPException(
                status_code=400,
                detail=f"{field_name} must be a finite integer number of seconds",
            )
        normalized_value = int(value)
        if normalized_value < minimum or normalized_value > maximum:
            raise HTTPException(status_code=400, detail=f"{field_name} must be between {minimum} and {maximum}")
        payload[field_name] = normalized_value
    return payload


async def build_monitoring_payload(
    db: AsyncSession,
    payload: dict[str, Any],
    *,
    partial: bool = False,
) -> tuple[dict[str, Any], list[dict[str, Any]] | None]:
    owners_data = payload.get("owners") if "owners" in payload else None
    clean_data = filter_valid_columns(models.MonitoringItem, payload, exclude=IMMUTABLE_MONITORING_FIELDS | {"owners"})

    if "monitoring_url" in clean_data:
        clean_data["monitoring_url"] = normalize_monitoring_url(clean_data.get("monitoring_url"))

    if "severity" in clean_data and clean_data["severity"] not in MONITORING_SEVERITIES:
        raise HTTPException(status_code=400, detail=f"Severity must be one of: {', '.join(sorted(MONITORING_SEVERITIES))}")
    if "status" in clean_data and clean_data["status"] not in MONITORING_STATUSES:
        raise HTTPException(status_code=400, detail=f"Status must be one of: {', '.join(sorted(MONITORING_STATUSES))}")

    validate_monitoring_numeric_fields(clean_data)

    if "platform" in clean_data and clean_data["platform"]:
        platforms = await get_setting_values_by_category(db, "MonitoringPlatform")
        if platforms and clean_data["platform"] not in platforms:
            raise HTTPException(status_code=400, detail="Platform must be selected from Monitoring Platform settings")
    if "category" in clean_data and clean_data["category"]:
        categories = await get_setting_values_by_category(db, "MonitoringCategory")
        if categories and clean_data["category"] not in categories:
            raise HTTPException(status_code=400, detail="Category must be selected from Monitoring Category settings")
    if "notification_method" in clean_data and clean_data["notification_method"]:
        notification_methods = await get_setting_values_by_category(db, "NotificationMethod")
        if notification_methods and clean_data["notification_method"] not in notification_methods:
            raise HTTPException(status_code=400, detail="Notification method must be selected from Notification Method settings")

    registered_teams = await get_registered_team_names(db)
    if "owner_team" in clean_data:
        owner_team_names = split_owner_values(clean_data.get("owner_team"))
        unknown_teams = [team_name for team_name in owner_team_names if team_name not in registered_teams]
        if unknown_teams:
            raise HTTPException(status_code=400, detail=f"Unknown owner team(s): {', '.join(unknown_teams)}")
        clean_data["owner_team"] = ", ".join(owner_team_names) if owner_team_names else None

    if "monitored_services" in clean_data and clean_data["monitored_services"]:
        monitored_service_ids = sorted({int(service_id) for service_id in clean_data["monitored_services"]})
        service_result = await db.execute(
            select(models.LogicalService.id, models.LogicalService.device_id)
            .where(models.LogicalService.id.in_(monitored_service_ids))
        )
        service_rows = service_result.all()
        found_service_ids = {service_id for service_id, _ in service_rows}
        missing_service_ids = [str(service_id) for service_id in monitored_service_ids if service_id not in found_service_ids]
        if missing_service_ids:
            raise HTTPException(status_code=400, detail=f"Unknown monitored service ID(s): {', '.join(missing_service_ids)}")
        if clean_data.get("device_id") is not None:
            mismatched_services = [
                str(service_id)
                for service_id, device_id in service_rows
                if device_id is not None and device_id != clean_data["device_id"]
            ]
            if mismatched_services:
                raise HTTPException(status_code=400, detail=f"Monitored services do not belong to the selected asset: {', '.join(mismatched_services)}")
        clean_data["monitored_services"] = monitored_service_ids

    if "recovery_docs" in clean_data and clean_data["recovery_docs"]:
        recovery_doc_ids = sorted({int(doc["id"] if isinstance(doc, dict) else doc) for doc in clean_data["recovery_docs"]})
        doc_result = await db.execute(
            select(models.KnowledgeEntry.id)
            .where(models.KnowledgeEntry.id.in_(recovery_doc_ids))
        )
        found_doc_ids = {doc_id for doc_id in doc_result.scalars().all()}
        missing_doc_ids = [str(doc_id) for doc_id in recovery_doc_ids if doc_id not in found_doc_ids]
        if missing_doc_ids:
            raise HTTPException(status_code=400, detail=f"Unknown recovery document ID(s): {', '.join(missing_doc_ids)}")

    resolved_owners: list[dict[str, Any]] | None = None
    if owners_data is not None:
        if not isinstance(owners_data, list):
            raise HTTPException(status_code=400, detail="owners must be a list")
        resolved_owners = []
        seen_owner_operator_ids: set[int] = set()
        for owner in owners_data:
            operator_id = owner.get("operator_id")
            owner_identifier = owner.get("external_id") or owner.get("username")
            role = owner.get("role") or "Primary Support"
            if not operator_id and not owner_identifier:
                raise HTTPException(status_code=400, detail="Each owner must include operator_id or a user identifier")
            if role not in MONITORING_OWNER_ROLES:
                raise HTTPException(status_code=400, detail=f"Owner role must be one of: {', '.join(sorted(MONITORING_OWNER_ROLES))}")
            operator_query = select(models.Operator)
            if operator_id:
                operator_query = operator_query.where(models.Operator.id == operator_id)
            else:
                operator_query = operator_query.where(
                    (models.Operator.username == owner_identifier) |
                    (models.Operator.external_id == owner_identifier)
                )
            operator_result = await db.execute(operator_query)
            operator = operator_result.scalar_one_or_none()
            if not operator:
                raise HTTPException(status_code=400, detail=f"Operator {owner_identifier or operator_id} was not found")
            if operator.id in seen_owner_operator_ids:
                raise HTTPException(status_code=400, detail=f"Operator {operator.external_id or operator.username or operator.id} is assigned more than once")
            seen_owner_operator_ids.add(operator.id)
            resolved_owners.append({
                "operator_id": operator.id,
                "name": operator.full_name or operator.username or operator.external_id,
                "external_id": operator.external_id,
                "role": role,
            })

    if not partial:
        try:
            data = schemas.MonitoringItemCreate.model_validate({**clean_data, "owners": resolved_owners or []})
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail=f"Monitoring payload validation failed: {exc}") from exc
        clean_data = data.model_dump(exclude={"owners"})
        resolved_owners = [owner.model_dump() for owner in data.owners]
    elif "logic_json" in clean_data:
        clean_data["logic_json"] = [schemas.MonitoringLogicEntry.model_validate(entry).model_dump() for entry in clean_data["logic_json"] or []]

    severity = clean_data.get("severity")
    if severity == "Critical" and not clean_data.get("recovery_docs"):
        raise HTTPException(status_code=400, detail="Critical monitors require at least one linked recovery document")

    if "status" in clean_data:
        clean_data["is_deleted"] = clean_data["status"] == "Deleted"

    return clean_data, resolved_owners

async def load_monitoring_item(db: AsyncSession, item_id: int):
    result = await db.execute(
        select(models.MonitoringItem)
        .options(joinedload(models.MonitoringItem.owners).joinedload(models.MonitoringOwner.operator))
        .filter(models.MonitoringItem.id == item_id)
    )
    return result.unique().scalar_one_or_none()

async def to_monitoring_response(db: AsyncSession, item: models.MonitoringItem):
    resp = schemas.MonitoringItemResponse.model_validate(item)
    if item.device_id:
        dev_res = await db.execute(select(models.Device.name).filter(models.Device.id == item.device_id))
        resp.device_name = dev_res.scalar_one_or_none()
    if item.monitored_services:
        svc_res = await db.execute(select(models.LogicalService.name).filter(models.LogicalService.id.in_(item.monitored_services)))
        resp.monitored_service_names = list(svc_res.scalars().all())
    
    if item.recovery_docs:
        doc_ids = [d.get("id") if isinstance(d, dict) else d for d in item.recovery_docs]
        doc_res = await db.execute(select(models.KnowledgeEntry).filter(models.KnowledgeEntry.id.in_(doc_ids)))
        docs = doc_res.scalars().all()
        doc_map = {d.id: d.title for d in docs}
        
        resp.recovery_doc_titles = [doc_map.get(did, f"KB-{did}") for did in doc_ids]
        resp.recovery_doc_details = []
        for d in item.recovery_docs:
            did = d.get("id") if isinstance(d, dict) else d
            note = d.get("note") if isinstance(d, dict) else None
            added_at = d.get("added_at") if isinstance(d, dict) else None
            resp.recovery_doc_details.append(
                schemas.MonitoringRecoveryDocResponse(
                    id=did,
                    title=doc_map.get(did, f"KB-{did}"),
                    note=note,
                    added_at=added_at,
                )
            )
    return resp

async def save_monitoring_history(item_id: int, version: int, db: AsyncSession, summary: str = None, user_id: str = None):
    # Fetch the item with owners
    result = await db.execute(
        select(models.MonitoringItem)
        .options(joinedload(models.MonitoringItem.owners).joinedload(models.MonitoringOwner.operator))
        .filter(models.MonitoringItem.id == item_id)
    )
    item = result.unique().scalar_one()
    snapshot = build_monitoring_snapshot(item)

    # Clean up any existing history entry for this specific version to avoid UNIQUE constraints on retries
    await db.execute(
        delete(models.MonitoringHistory)
        .where(
            models.MonitoringHistory.monitoring_item_id == item_id,
            models.MonitoringHistory.version == version
        )
    )

    history_obj = models.MonitoringHistory(
        monitoring_item_id=item_id,
        version=version,
        snapshot=snapshot,
        change_summary=summary,
        created_by_user_id=user_id
    )
    db.add(history_obj)


async def restore_purged_monitoring_item_from_snapshot(
    db: AsyncSession,
    snapshot: dict[str, Any],
    *,
    item_id: int,
) -> bool:
    existing_item = await load_monitoring_item(db, item_id)
    target_snapshot = build_monitoring_snapshot_from_values(snapshot, snapshot.get("owners") or [])
    if existing_item:
        if build_monitoring_snapshot(existing_item) == target_snapshot:
            return False
        raise HTTPException(status_code=409, detail=f"Monitoring item {item_id} already exists and does not match the purge snapshot")

    await ensure_monitoring_item_uniqueness(db, item_data=target_snapshot, exclude_item_id=item_id)

    owner_rows: list[models.MonitoringOwner] = []
    for owner in target_snapshot.get("owners") or []:
        operator_id = owner.get("operator_id")
        if operator_id is not None:
            operator_exists = await db.scalar(select(models.Operator.id).where(models.Operator.id == operator_id))
            if operator_exists is None:
                operator_id = None
        owner_rows.append(models.MonitoringOwner(
            monitoring_item_id=item_id,
            operator_id=operator_id,
            name=normalize_string(owner.get("name")),
            external_id=normalize_string(owner.get("external_id")),
            role=normalize_string(owner.get("role")),
        ))

    restored_item = models.MonitoringItem(
        id=item_id,
        device_id=target_snapshot.get("device_id"),
        category=target_snapshot.get("category"),
        status=target_snapshot.get("status"),
        title=target_snapshot.get("title"),
        spec=target_snapshot.get("spec"),
        platform=target_snapshot.get("platform"),
        monitoring_url=target_snapshot.get("monitoring_url"),
        purpose=target_snapshot.get("purpose"),
        impact=target_snapshot.get("impact"),
        notification_method=target_snapshot.get("notification_method"),
        notification_recipients=target_snapshot.get("notification_recipients") or [],
        logic=target_snapshot.get("logic"),
        logic_json=target_snapshot.get("logic_json") or [],
        monitored_services=target_snapshot.get("monitored_services") or [],
        owner_team=target_snapshot.get("owner_team"),
        check_interval=target_snapshot.get("check_interval"),
        alert_duration=target_snapshot.get("alert_duration"),
        notification_throttle=target_snapshot.get("notification_throttle"),
        severity=target_snapshot.get("severity"),
        is_active=bool(target_snapshot.get("is_active", True)),
        is_deleted=bool(target_snapshot.get("is_deleted", False)),
        recovery_docs=target_snapshot.get("recovery_docs") or [],
        version=max(int(snapshot.get("version") or 0) + 1, 1),
    )
    db.add(restored_item)
    await db.flush()
    for owner_row in owner_rows:
        db.add(owner_row)
    await db.flush()
    await save_monitoring_history(
        item_id,
        restored_item.version,
        db,
        summarize_monitoring_snapshot_delta(None, target_snapshot, action_label="restore"),
    )
    return True

@router.get("/{item_id}/history", response_model=List[schemas.MonitoringHistoryResponse])
async def get_monitoring_history(item_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.MonitoringHistory)
        .filter(models.MonitoringHistory.monitoring_item_id == item_id)
        .order_by(models.MonitoringHistory.version.desc())
    )
    entries = result.scalars().all()
    response: list[dict[str, Any]] = []
    for index, entry in enumerate(entries):
        previous_entry = entries[index + 1] if index + 1 < len(entries) else None
        previous_snapshot = previous_entry.snapshot if previous_entry else None
        current_snapshot = entry.snapshot or {}
        delta = build_monitoring_history_delta(previous_snapshot, current_snapshot)
        response.append({
            "id": entry.id,
            "created_at": entry.created_at,
            "updated_at": entry.updated_at,
            "created_by_user_id": entry.created_by_user_id,
            "monitoring_item_id": entry.monitoring_item_id,
            "version": entry.version,
            "snapshot": current_snapshot,
            "change_summary": entry.change_summary,
            "delta": delta,
            "changed_fields": [item["field"] for item in delta],
            "changed_labels": [item["label"] for item in delta],
            "previous_version": previous_entry.version if previous_entry else None,
        })
    return response

@router.get("", response_model=List[schemas.MonitoringItemResponse])
async def get_monitoring_items(device_id: Optional[int] = None, include_deleted: bool = False, db: AsyncSession = Depends(get_db)):
    query = select(models.MonitoringItem).options(
        joinedload(models.MonitoringItem.owners).joinedload(models.MonitoringOwner.operator)
    )
    if not include_deleted:
        query = query.filter(models.MonitoringItem.is_deleted == False)
    
    if device_id:
        query = query.filter(models.MonitoringItem.device_id == device_id)
    
    result = await db.execute(query)
    items = result.unique().scalars().all()
    
    # Batch fetch device names
    device_ids = {item.device_id for item in items if item.device_id}
    device_map = {}
    if device_ids:
        dev_res = await db.execute(select(models.Device.id, models.Device.name).filter(models.Device.id.in_(device_ids)))
        device_map = {id_: name for id_, name in dev_res.all()}

    # Batch fetch service names
    all_service_ids = set()
    for item in items:
        if item.monitored_services:
            all_service_ids.update(item.monitored_services)
    
    service_map = {}
    if all_service_ids:
        svc_res = await db.execute(select(models.LogicalService.id, models.LogicalService.name).filter(models.LogicalService.id.in_(all_service_ids)))
        service_map = {id_: name for id_, name in svc_res.all()}

    # Batch fetch recovery doc titles
    all_doc_ids = set()
    for item in items:
        if item.recovery_docs:
            for d in item.recovery_docs:
                did = d.get("id") if isinstance(d, dict) else d
                all_doc_ids.add(did)
            
    doc_map = {}
    if all_doc_ids:
        doc_res = await db.execute(select(models.KnowledgeEntry.id, models.KnowledgeEntry.title).filter(models.KnowledgeEntry.id.in_(all_doc_ids)))
        doc_map = {id_: title for id_, title in doc_res.all()}

    res = []
    for item in items:
        resp = schemas.MonitoringItemResponse.model_validate(item)
        resp.device_name = device_map.get(item.device_id)
        resp.monitored_service_names = [service_map.get(sid) for sid in (item.monitored_services or []) if service_map.get(sid)]
        
        resp.recovery_doc_titles = []
        resp.recovery_doc_details = []
        if item.recovery_docs:
            for d in item.recovery_docs:
                did = d.get("id") if isinstance(d, dict) else d
                note = d.get("note") if isinstance(d, dict) else None
                added_at = d.get("added_at") if isinstance(d, dict) else None
                title = doc_map.get(did, f"KB-{did}")
                resp.recovery_doc_titles.append(title)
                resp.recovery_doc_details.append(
                    schemas.MonitoringRecoveryDocResponse(
                        id=did,
                        title=title,
                        note=note,
                        added_at=added_at,
                    )
                )
        res.append(resp)
        
    return res

@router.post("", response_model=schemas.MonitoringItemResponse)
async def create_monitoring_item(data: dict[str, Any], db: AsyncSession = Depends(get_db), user_id: str = Header(None, alias="X-User-Id")):
    item_data, owners_data = await build_monitoring_payload(db, data, partial=False)
    await ensure_monitoring_item_uniqueness(db, item_data=item_data)

    db_obj = models.MonitoringItem(**item_data)
    db.add(db_obj)
    await db.flush() # To get db_obj.id

    for owner in owners_data or []:
        db_owner = models.MonitoringOwner(**owner, monitoring_item_id=db_obj.id)
        db.add(db_owner)

    await db.flush()
    await save_monitoring_history(
        db_obj.id,
        db_obj.version,
        db,
        summarize_monitoring_snapshot_delta(None, build_monitoring_snapshot_from_values(item_data, owners_data), action_label="create"),
        user_id
    )
    await db.commit()
    
    # Reload with owners
    db_obj = await load_monitoring_item(db, db_obj.id)
    return await to_monitoring_response(db, db_obj)

@router.put("/{item_id}", response_model=schemas.MonitoringItemResponse)
async def update_monitoring_item(item_id: int, data: dict, db: AsyncSession = Depends(get_db), user_id: str = Header(None, alias="X-User-Id")):
    item = await load_monitoring_item(db, item_id)
    if not item: raise HTTPException(404, "Monitoring item not found")
    previous_snapshot = build_monitoring_snapshot(item)
    
    merged_payload = {
        "device_id": item.device_id,
        "category": item.category,
        "status": item.status,
        "title": item.title,
        "spec": item.spec,
        "platform": item.platform,
        "monitoring_url": item.monitoring_url,
        "purpose": item.purpose,
        "impact": item.impact,
        "notification_method": item.notification_method,
        "notification_recipients": item.notification_recipients,
        "logic": item.logic,
        "logic_json": item.logic_json,
        "monitored_services": item.monitored_services,
        "owner_team": item.owner_team,
        "check_interval": item.check_interval,
        "alert_duration": item.alert_duration,
        "notification_throttle": item.notification_throttle,
        "severity": item.severity,
        "is_active": item.is_active,
        "recovery_docs": item.recovery_docs,
        "owners": [
            {"operator_id": owner.operator_id, "role": owner.role}
            for owner in item.owners
        ],
    }
    merged_payload.update(data)
    clean_data, owners_data = await build_monitoring_payload(db, merged_payload, partial=False)
    await ensure_monitoring_item_uniqueness(db, item_data=clean_data, exclude_item_id=item_id)
    next_snapshot = build_monitoring_snapshot_from_values(clean_data, owners_data)
    if next_snapshot == previous_snapshot:
        return await to_monitoring_response(db, item)

    for k, v in clean_data.items():
        setattr(item, k, v)
    
    # Increment version
    item.version = (item.version or 0) + 1

    if owners_data is not None:
        await db.execute(delete(models.MonitoringOwner).where(models.MonitoringOwner.monitoring_item_id == item_id))
        for owner in owners_data:
            db_owner = models.MonitoringOwner(**owner, monitoring_item_id=item_id)
            db.add(db_owner)
            
    await db.flush()
    await save_monitoring_history(
        item_id,
        item.version,
        db,
        summarize_monitoring_snapshot_delta(previous_snapshot, next_snapshot, action_label="update"),
        user_id
    )
    await db.commit()
    
    # Reload with owners
    item = await load_monitoring_item(db, item_id)
    return await to_monitoring_response(db, item)

@router.post("/bulk-action")
async def bulk_action(data: dict, db: AsyncSession = Depends(get_db)):
    ids = data.get("ids", [])
    action = data.get("action")
    payload = data.get("payload", {})
    if not ids: return {"status": "no_op"}
    changed_count = 0
    skipped_count = 0
    changed_fields: set[str] = set()

    if action == "delete":
        result = await db.execute(
            select(models.MonitoringItem)
            .options(joinedload(models.MonitoringItem.owners).joinedload(models.MonitoringOwner.operator))
            .where(models.MonitoringItem.id.in_(ids))
        )
        items = result.unique().scalars().all()
        for item in items:
            if item.is_deleted and item.status == "Deleted":
                skipped_count += 1
                continue
            previous_snapshot = build_monitoring_snapshot(item)
            item.is_deleted = True
            item.status = "Deleted"
            item.version = (item.version or 0) + 1
            await db.flush()
            await save_monitoring_history(
                item.id,
                item.version,
                db,
                summarize_monitoring_snapshot_delta(previous_snapshot, build_monitoring_snapshot(item), action_label="delete"),
            )
            changed_count += 1
    elif action == "purge":
        delete_result = await db.execute(delete(models.MonitoringItem).where(models.MonitoringItem.id.in_(ids)))
        changed_count = delete_result.rowcount or 0
        skipped_count = max(0, len(ids) - changed_count)
    elif action == "restore_purged":
        snapshots = payload.get("snapshots")
        if not isinstance(snapshots, list):
            raise HTTPException(status_code=400, detail="restore_purged requires payload.snapshots")
        snapshots_by_id = {
            int(snapshot.get("id")): snapshot
            for snapshot in snapshots
            if isinstance(snapshot, dict) and snapshot.get("id") is not None
        }
        for requested_id in ids:
            if int(requested_id) not in snapshots_by_id:
                raise HTTPException(status_code=400, detail=f"Missing purge snapshot for monitoring item {requested_id}")
        for requested_id in ids:
            restored = await restore_purged_monitoring_item_from_snapshot(
                db,
                snapshots_by_id[int(requested_id)],
                item_id=int(requested_id),
            )
            if restored:
                changed_count += 1
            else:
                skipped_count += 1
    elif action == "restore":
        result = await db.execute(
            select(models.MonitoringItem)
            .options(joinedload(models.MonitoringItem.owners).joinedload(models.MonitoringOwner.operator))
            .where(models.MonitoringItem.id.in_(ids))
        )
        items = result.unique().scalars().all()
        for item in items:
            if not item.is_deleted and item.status == "Existing":
                skipped_count += 1
                continue
            previous_snapshot = build_monitoring_snapshot(item)
            item.is_deleted = False
            item.status = "Existing"
            item.version = (item.version or 0) + 1
            await db.flush()
            await save_monitoring_history(
                item.id,
                item.version,
                db,
                summarize_monitoring_snapshot_delta(previous_snapshot, build_monitoring_snapshot(item), action_label="restore"),
            )
            changed_count += 1
    elif action == "update":
        if payload:
            result = await db.execute(
                select(models.MonitoringItem)
                .options(joinedload(models.MonitoringItem.owners).joinedload(models.MonitoringOwner.operator))
                .where(models.MonitoringItem.id.in_(ids))
            )
            items = result.unique().scalars().all()
            for item in items:
                previous_snapshot = build_monitoring_snapshot(item)
                merged_payload = {
                    "device_id": item.device_id,
                    "category": item.category,
                    "status": item.status,
                    "title": item.title,
                    "spec": item.spec,
                    "platform": item.platform,
                    "monitoring_url": item.monitoring_url,
                    "purpose": item.purpose,
                    "impact": item.impact,
                    "notification_method": item.notification_method,
                    "notification_recipients": item.notification_recipients,
                    "logic": item.logic,
                    "logic_json": item.logic_json,
                    "monitored_services": item.monitored_services,
                    "owner_team": item.owner_team,
                    "check_interval": item.check_interval,
                    "alert_duration": item.alert_duration,
                    "notification_throttle": item.notification_throttle,
                    "severity": item.severity,
                    "is_active": item.is_active,
                    "recovery_docs": item.recovery_docs,
                    "owners": [
                        {"operator_id": owner.operator_id, "role": owner.role}
                        for owner in item.owners
                        if owner.operator_id
                    ],
                }
                merged_payload.update(payload)
                validated_update, owners_data = await build_monitoring_payload(db, merged_payload, partial=False)
                await ensure_monitoring_item_uniqueness(db, item_data=validated_update, exclude_item_id=item.id)
                next_snapshot = build_monitoring_snapshot_from_values(validated_update, owners_data)
                if next_snapshot == previous_snapshot:
                    skipped_count += 1
                    continue
                for key, value in validated_update.items():
                    setattr(item, key, value)
                if owners_data is not None:
                    await db.execute(delete(models.MonitoringOwner).where(models.MonitoringOwner.monitoring_item_id == item.id))
                    for owner in owners_data:
                        db.add(models.MonitoringOwner(**owner, monitoring_item_id=item.id))
                item.version = (item.version or 0) + 1
                await db.flush()
                await save_monitoring_history(
                    item.id,
                    item.version,
                    db,
                    summarize_monitoring_snapshot_delta(previous_snapshot, next_snapshot, action_label="update"),
                )
                changed_count += 1
                changed_fields.update(
                    label
                    for key, label in {
                        "device_id": "target asset",
                        "category": "category",
                        "status": "status",
                        "title": "title",
                        "platform": "platform",
                        "notification_method": "notification method",
                        "severity": "severity",
                        "owner_team": "owner teams",
                        "owners": "owners",
                        "monitored_services": "monitored services",
                        "recovery_docs": "recovery docs",
                    }.items()
                    if previous_snapshot.get(key) != next_snapshot.get(key)
                )
    else:
        raise HTTPException(status_code=400, detail="Unsupported bulk action")

    await db.commit()
    return {
        "status": "success",
        "action": action,
        "changed": changed_count,
        "skipped": skipped_count,
        "summary": summarize_bulk_monitoring_action(
            action=action,
            changed_count=changed_count,
            skipped_count=skipped_count,
            changed_fields=changed_fields,
        ),
    }

@router.delete("/{item_id}")
async def delete_monitoring_item(item_id: int, db: AsyncSession = Depends(get_db)):
    item = await load_monitoring_item(db, item_id)
    if not item: raise HTTPException(404, "Monitoring item not found")
    if item.is_deleted and item.status == "Deleted":
        return {"status": "success"}
    previous_snapshot = build_monitoring_snapshot(item)
    item.is_deleted = True
    item.status = "Deleted"
    item.version = (item.version or 0) + 1
    await db.flush()
    await save_monitoring_history(
        item.id,
        item.version,
        db,
        summarize_monitoring_snapshot_delta(previous_snapshot, build_monitoring_snapshot(item), action_label="delete"),
    )
    await db.commit()
    return {"status": "success"}


@router.post("/{item_id}/restore/{history_id}", response_model=schemas.MonitoringItemResponse)
async def restore_monitoring_history_version(item_id: int, history_id: int, db: AsyncSession = Depends(get_db)):
    item = await load_monitoring_item(db, item_id)
    if not item:
        raise HTTPException(404, "Monitoring item not found")
    history_result = await db.execute(
        select(models.MonitoringHistory)
        .filter(
            models.MonitoringHistory.id == history_id,
            models.MonitoringHistory.monitoring_item_id == item_id,
        )
    )
    history = history_result.scalar_one_or_none()
    if not history:
        raise HTTPException(404, "Monitoring history entry not found")

    snapshot = history.snapshot or {}
    current_snapshot = build_monitoring_snapshot(item)
    target_snapshot = build_monitoring_snapshot_from_values(snapshot, snapshot.get("owners") or [])
    if current_snapshot == target_snapshot:
        return await to_monitoring_response(db, item)

    for key, value in snapshot.items():
        if key == "owners":
            continue
        if key == "owner_team":
            setattr(item, key, ", ".join(normalize_string_list(split_owner_values(value))) or None)
        else:
            setattr(item, key, value)

    await db.execute(delete(models.MonitoringOwner).where(models.MonitoringOwner.monitoring_item_id == item_id))
    for owner in snapshot.get("owners") or []:
        operator_id = owner.get("operator_id")
        if operator_id is not None:
            operator_exists = await db.scalar(select(models.Operator.id).where(models.Operator.id == operator_id))
            if operator_exists is None:
                operator_id = None
        db.add(models.MonitoringOwner(
            monitoring_item_id=item_id,
            operator_id=operator_id,
            name=normalize_string(owner.get("name")),
            external_id=normalize_string(owner.get("external_id")),
            role=normalize_string(owner.get("role")),
        ))

    item.version = (item.version or 0) + 1
    await db.flush()
    await save_monitoring_history(
        item.id,
        item.version,
        db,
        summarize_monitoring_snapshot_delta(current_snapshot, target_snapshot, action_label="restore"),
    )
    await db.commit()
    item = await load_monitoring_item(db, item_id)
    return await to_monitoring_response(db, item)
