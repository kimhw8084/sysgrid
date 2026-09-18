from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import joinedload, selectinload
from typing import List, Optional
from ..database import get_db
from ..models import models
from ..schemas import schemas
from .utils import filter_valid_columns

from sqlalchemy import delete, update
from ..api.utils import filter_valid_columns, normalize_json_object, normalize_json_list
from .module_policy import require_module_access

router = APIRouter(
    prefix="/far",
    tags=["FAR"],
    dependencies=[Depends(require_module_access("far", allow_embedded=True))],
)
IMMUTABLE_FAR_FIELDS = {"id", "created_at", "updated_at", "created_by_user_id", "version", "is_deleted"}
FAR_BULK_SCORE_FIELDS = {"severity", "occurrence", "detection"}

def normalize_far_versioned_mutation_request(data: dict):
    if not isinstance(data, dict):
        raise ValueError("FAR mutation request must be an object")

    expected_version = data.get("expected_version")
    if isinstance(expected_version, bool) or not isinstance(expected_version, int) or expected_version <= 0:
        raise ValueError("expected_version must be a positive integer")

    mutation_data = dict(data)
    mutation_data.pop("expected_version", None)
    return expected_version, mutation_data

def get_far_versioned_mutation_precondition(mode, expected_version: int):
    actual_version = int(getattr(mode, "version", 1) or 1)
    if bool(getattr(mode, "is_deleted", False)):
        return {
            "code": "far_mode_archived_read_only",
            "id": int(getattr(mode, "id")),
            "actual_version": actual_version,
        }
    if actual_version != expected_version:
        return {
            "code": "far_mode_version_conflict",
            "id": int(getattr(mode, "id")),
            "expected_version": expected_version,
            "actual_version": actual_version,
        }
    return None

FAR_AUTHORING_RELATIONSHIP_FIELDS = ("affected_assets", "cause_ids")

def normalize_far_reference_ids(value, field: str) -> list[int]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    ids = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, int) or item <= 0:
            raise ValueError(f"{field} must contain positive integer ids")
        if item in ids:
            raise ValueError(f"{field} must not contain duplicate ids")
        ids.append(item)
    return ids

def normalize_far_authoring_relationships(data: dict) -> dict[str, list[int]]:
    if not isinstance(data, dict):
        raise ValueError("FAR authoring payload must be an object")
    return {
        field: normalize_far_reference_ids(data[field], field)
        for field in FAR_AUTHORING_RELATIONSHIP_FIELDS
        if field in data
    }

def collect_far_missing_reference_ids(requested_ids: list[int], rows) -> list[int]:
    found_ids = {int(getattr(row, "id")) for row in rows}
    return [item for item in requested_ids if item not in found_ids]

async def resolve_far_authoring_relationships(db: AsyncSession, relationship_ids: dict[str, list[int]]):
    resolved = {}
    specs = {
        "affected_assets": (models.Device, "Affected asset"),
        "cause_ids": (models.FarFailureCause, "Root cause"),
    }
    for field, ids in relationship_ids.items():
        model, label = specs[field]
        if not ids:
            resolved[field] = []
            continue
        result = await db.execute(select(model).filter(model.id.in_(ids)))
        rows = list(result.scalars().all())
        missing_ids = collect_far_missing_reference_ids(ids, rows)
        if missing_ids:
            missing = ", ".join(str(item) for item in missing_ids)
            raise HTTPException(409, f"{label} references are stale or missing: {missing}. Refresh and retry.")
        by_id = {int(row.id): row for row in rows}
        resolved[field] = [by_id[item] for item in ids]
    return resolved

def normalize_far_lifecycle_request(data: dict):
    if not isinstance(data, dict):
        raise ValueError("Lifecycle request must be an object")

    raw_ids = data.get("ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        raise ValueError("ids must be a non-empty list")
    if any(isinstance(item, bool) or not isinstance(item, int) or item <= 0 for item in raw_ids):
        raise ValueError("ids must contain positive integers")
    if len(set(raw_ids)) != len(raw_ids):
        raise ValueError("ids must not contain duplicates")
    ids = list(raw_ids)

    raw_expected = data.get("expected_versions")
    if not isinstance(raw_expected, dict):
        raise ValueError("expected_versions must be an object")

    expected_versions = {}
    normalized_keys = set()
    for raw_key, raw_version in raw_expected.items():
        try:
            key = int(raw_key)
        except (TypeError, ValueError):
            raise ValueError("expected_versions keys must be record ids")
        if isinstance(raw_version, bool) or not isinstance(raw_version, int) or raw_version <= 0:
            raise ValueError("expected_versions values must be positive integers")
        normalized_keys.add(key)
        expected_versions[key] = raw_version

    if normalized_keys != set(ids):
        raise ValueError("expected_versions must exactly match ids")

    return ids, expected_versions

def collect_far_lifecycle_preconditions(ids, modes, expected_versions):
    by_id = {int(mode.id): mode for mode in modes}
    missing_ids = [mode_id for mode_id in ids if mode_id not in by_id]
    version_conflicts = [
        {
            "id": mode_id,
            "expected_version": expected_versions[mode_id],
            "actual_version": int(getattr(by_id[mode_id], "version", 1) or 1),
        }
        for mode_id in ids
        if (
            mode_id in by_id
            and int(getattr(by_id[mode_id], "version", 1) or 1) != expected_versions[mode_id]
        )
    ]
    return {
        "missing_ids": missing_ids,
        "version_conflicts": version_conflicts,
    }

def apply_far_lifecycle_state(mode, archived: bool):
    if bool(getattr(mode, "is_deleted", False)) == archived:
        return False
    mode.is_deleted = archived
    mode.version = int(getattr(mode, "version", 1) or 1) + 1
    return True

def normalize_far_context_mutation_request(data: dict):
    expected_version, mutation_data = normalize_far_versioned_mutation_request(data)
    mode_id = mutation_data.pop("mode_id", None)
    if isinstance(mode_id, bool) or not isinstance(mode_id, int) or mode_id <= 0:
        raise ValueError("mode_id must be a positive integer")
    return mode_id, expected_version, mutation_data

async def lock_far_context_mode(mode_id: int, expected_version: int, db: AsyncSession):
    stmt = (
        select(models.FarFailureMode)
        .filter(models.FarFailureMode.id == mode_id)
        .with_for_update()
    )
    result = await db.execute(stmt)
    mode = result.scalar_one_or_none()
    if not mode:
        raise HTTPException(404, "Failure vector not found")
    blocker = get_far_versioned_mutation_precondition(mode, expected_version)
    if blocker:
        raise HTTPException(409, detail=blocker)
    return mode

async def advance_far_context_mode(mode, db: AsyncSession, summary: str):
    mode.version = int(mode.version or 1) + 1
    await db.flush()
    await save_far_history(mode.id, mode.version, db, summary)

async def get_far_cause_parent_ids(cause_id: int, db: AsyncSession):
    result = await db.execute(
        select(models.far_mode_causes.c.mode_id)
        .where(models.far_mode_causes.c.cause_id == cause_id)
    )
    return [int(mode_id) for mode_id in result.scalars().all()]

def ensure_far_exclusive_cause_context(cause_id: int, mode_id: int, parent_ids: list[int]):
    if mode_id not in parent_ids:
        raise HTTPException(409, detail={
            "code": "far_cause_not_linked_to_mode",
            "cause_id": cause_id,
            "mode_id": mode_id,
        })
    if len(parent_ids) != 1:
        raise HTTPException(409, detail={
            "code": "far_shared_cause_requires_explicit_scope",
            "cause_id": cause_id,
            "mode_ids": parent_ids,
        })

FAR_MITIGATION_TYPES = ("Monitoring", "Workaround", "Process Change")
FAR_MITIGATION_STATUSES = ("Not Started", "In Progress", "Completed")
FAR_USABLE_MONITORING_STATUSES = {"Existing", "Planned"}


def _normalize_far_mitigation_optional_text(value, field: str):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    normalized = value.strip()
    return normalized or None


def _normalize_far_mitigation_optional_id(value, field: str):
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{field} must be a positive integer")
    return value


def normalize_far_mitigation_status(value):
    if value is None:
        value = "Not Started"
    if not isinstance(value, str):
        raise ValueError("status must be a string")
    normalized = value.strip()
    if normalized not in FAR_MITIGATION_STATUSES:
        raise ValueError("status must be Not Started, In Progress, or Completed")
    return normalized


def ensure_far_mitigation_transition(current_status, requested_status):
    current = normalize_far_mitigation_status(current_status)
    requested = normalize_far_mitigation_status(requested_status)
    current_index = FAR_MITIGATION_STATUSES.index(current)
    requested_index = FAR_MITIGATION_STATUSES.index(requested)
    if requested_index not in {current_index, current_index + 1}:
        raise ValueError("Mitigation status may stay the same or advance exactly one step")


def normalize_far_external_bkm_url(value):
    normalized = _normalize_far_mitigation_optional_text(value, "external_bkm_url")
    if normalized is None:
        return None
    if len(normalized) > 2048:
        raise ValueError("external_bkm_url is too long")
    from urllib.parse import urlparse
    parsed = urlparse(normalized)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise ValueError("external_bkm_url must be a valid HTTP(S) URL")
    if parsed.username or parsed.password:
        raise ValueError("external_bkm_url must not contain embedded credentials")
    return normalized


def normalize_far_mitigation_payload(data: dict, existing=None):
    if not isinstance(data, dict):
        raise ValueError("Mitigation payload must be an object")

    mitigation_type = data.get("mitigation_type", getattr(existing, "mitigation_type", None))
    if mitigation_type not in FAR_MITIGATION_TYPES:
        raise ValueError("mitigation_type must be Monitoring, Workaround, or Process Change")
    if existing is not None and mitigation_type != getattr(existing, "mitigation_type", None):
        raise ValueError("Mitigation type is immutable after creation")

    mitigation_steps = _normalize_far_mitigation_optional_text(data.get("mitigation_steps"), "mitigation_steps")
    if not mitigation_steps:
        raise ValueError("mitigation_steps is required")
    responsible_team = _normalize_far_mitigation_optional_text(data.get("responsible_team"), "responsible_team")

    cause_id = _normalize_far_mitigation_optional_id(data.get("cause_id", getattr(existing, "cause_id", None)), "cause_id")
    if not cause_id:
        raise ValueError("cause_id must be a positive integer")
    if existing is not None and cause_id != getattr(existing, "cause_id", None):
        raise ValueError("Mitigation cause cannot be changed after creation")

    status = normalize_far_mitigation_status(data.get("status", getattr(existing, "status", None)))
    if existing is not None:
        ensure_far_mitigation_transition(getattr(existing, "status", None), status)

    monitoring_item_id = _normalize_far_mitigation_optional_id(data.get("monitoring_item_id"), "monitoring_item_id")
    knowledge_bkm_id = _normalize_far_mitigation_optional_id(data.get("knowledge_bkm_id"), "knowledge_bkm_id")
    external_bkm_url = normalize_far_external_bkm_url(data.get("external_bkm_url"))

    if mitigation_type == "Monitoring":
        if monitoring_item_id is None:
            raise ValueError("Monitoring reference is required")
        if knowledge_bkm_id is not None or external_bkm_url is not None:
            raise ValueError("Monitoring mitigation cannot carry BKM provenance")
    elif mitigation_type == "Workaround":
        if monitoring_item_id is not None:
            raise ValueError("Workaround mitigation cannot carry Monitoring provenance")
        if knowledge_bkm_id is not None and external_bkm_url is not None:
            raise ValueError("Direct and external BKM provenance are mutually exclusive")
    else:
        if monitoring_item_id is not None or knowledge_bkm_id is not None or external_bkm_url is not None:
            raise ValueError("Process Change mitigation cannot carry BKM or Monitoring provenance")

    return {
        "mitigation_type": mitigation_type,
        "mitigation_steps": mitigation_steps,
        "responsible_team": responsible_team,
        "status": status,
        "cause_id": cause_id,
        "monitoring_item_id": monitoring_item_id,
        "knowledge_bkm_id": knowledge_bkm_id,
        "external_bkm_url": external_bkm_url,
    }


async def resolve_far_mitigation_references(db: AsyncSession, payload: dict):
    knowledge_bkm_id = payload.get("knowledge_bkm_id")
    if knowledge_bkm_id is not None:
        result = await db.execute(select(models.KnowledgeEntry).filter(models.KnowledgeEntry.id == knowledge_bkm_id))
        knowledge = result.scalar_one_or_none()
        if (
            not knowledge
            or bool(getattr(knowledge, "is_deleted", False))
            or getattr(knowledge, "category", None) != "BKM"
            or getattr(knowledge, "status", None) != "Published"
        ):
            raise HTTPException(409, detail={
                "code": "far_mitigation_bkm_reference_unusable",
                "knowledge_bkm_id": knowledge_bkm_id,
            })

    monitoring_item_id = payload.get("monitoring_item_id")
    if monitoring_item_id is not None:
        result = await db.execute(select(models.MonitoringItem).filter(models.MonitoringItem.id == monitoring_item_id))
        monitoring = result.scalar_one_or_none()
        if (
            not monitoring
            or bool(getattr(monitoring, "is_deleted", False))
            or getattr(monitoring, "status", None) not in FAR_USABLE_MONITORING_STATUSES
        ):
            raise HTTPException(409, detail={
                "code": "far_mitigation_monitor_reference_unusable",
                "monitoring_item_id": monitoring_item_id,
            })

def normalize_far_bulk_score_request(data: dict):
    if not isinstance(data, dict):
        raise ValueError("Bulk score request must be an object")

    raw_ids = data.get("ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        raise ValueError("ids must be a non-empty list")
    if any(isinstance(item, bool) or not isinstance(item, int) or item <= 0 for item in raw_ids):
        raise ValueError("ids must contain positive integers")
    if len(set(raw_ids)) != len(raw_ids):
        raise ValueError("ids must not contain duplicates")
    ids = list(raw_ids)

    field = data.get("field")
    if field not in FAR_BULK_SCORE_FIELDS:
        raise ValueError("field must be severity, occurrence, or detection")

    value = data.get("value")
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 10:
        raise ValueError("value must be an integer from 1 to 10")

    raw_expected = data.get("expected_versions")
    if not isinstance(raw_expected, dict):
        raise ValueError("expected_versions must be an object")

    expected_versions = {}
    normalized_keys = set()
    for raw_key, raw_version in raw_expected.items():
        try:
            key = int(raw_key)
        except (TypeError, ValueError):
            raise ValueError("expected_versions keys must be record ids")
        if isinstance(raw_version, bool) or not isinstance(raw_version, int) or raw_version <= 0:
            raise ValueError("expected_versions values must be positive integers")
        normalized_keys.add(key)
        expected_versions[key] = raw_version

    if normalized_keys != set(ids):
        raise ValueError("expected_versions must exactly match ids")

    return ids, field, value, expected_versions

def collect_far_bulk_score_preconditions(ids, modes, expected_versions):
    by_id = {int(mode.id): mode for mode in modes}
    missing_ids = [mode_id for mode_id in ids if mode_id not in by_id]
    archived_ids = [
        mode_id for mode_id in ids
        if mode_id in by_id and bool(getattr(by_id[mode_id], "is_deleted", False))
    ]
    version_conflicts = [
        {
            "id": mode_id,
            "expected_version": expected_versions[mode_id],
            "actual_version": int(getattr(by_id[mode_id], "version", 1) or 1),
        }
        for mode_id in ids
        if (
            mode_id in by_id
            and int(getattr(by_id[mode_id], "version", 1) or 1) != expected_versions[mode_id]
        )
    ]
    return {
        "missing_ids": missing_ids,
        "archived_ids": archived_ids,
        "version_conflicts": version_conflicts,
    }

def apply_far_bulk_score_value(mode, field: str, value: int):
    if getattr(mode, field) == value:
        return False
    setattr(mode, field, value)
    mode.rpn = int(mode.severity) * int(mode.occurrence) * int(mode.detection)
    mode.version = int(mode.version or 1) + 1
    return True

FAR_HISTORY_RESTOREABLE_FIELDS = {
    "system_name",
    "failure_type",
    "title",
    "effect",
    "severity",
    "occurrence",
    "detection",
    "rpn",
    "status",
    "affected_asset_ids",
    "cause_ids",
    "has_incident_history",
    "metadata_json",
}
FAR_HISTORY_FORENSIC_FIELDS = {
    "cause_state",
    "resolution_state",
    "mitigation_state",
    "prevention_state",
    "linked_rca_ids",
}
FAR_HISTORY_FIELD_LABELS = {
    "system_name": "System",
    "failure_type": "Failure type",
    "title": "Failure mode",
    "effect": "Effect",
    "severity": "Severity",
    "occurrence": "Occurrence",
    "detection": "Detection",
    "rpn": "RPN",
    "status": "Maturity status",
    "affected_asset_ids": "Affected assets",
    "cause_ids": "Cause links",
    "has_incident_history": "Incident history",
    "metadata_json": "FAR metadata",
    "cause_state": "Root-cause state",
    "resolution_state": "Resolution state",
    "mitigation_state": "Mitigation state",
    "prevention_state": "Prevention state",
    "linked_rca_ids": "Linked RCA records",
    "is_deleted": "Lifecycle",
}

def _far_history_id(value):
    return int(getattr(value, "id", 0) or 0)

def _far_history_date(value):
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)

def build_far_intervention_snapshot(mode) -> dict:
    causes = sorted(list(getattr(mode, "causes", None) or []), key=_far_history_id)
    resolutions = []
    for cause in causes:
        for resolution in sorted(list(getattr(cause, "resolutions", None) or []), key=_far_history_id):
            resolutions.append({
                "cause_id": _far_history_id(cause),
                "id": _far_history_id(resolution),
                "knowledge_id": getattr(resolution, "knowledge_id", None),
                "preventive_follow_up": getattr(resolution, "preventive_follow_up", None),
                "responsible_team": getattr(resolution, "responsible_team", None),
                "guidance_notes": getattr(resolution, "guidance_notes", None),
            })

    mitigations = sorted(list(getattr(mode, "mitigations", None) or []), key=_far_history_id)
    prevention_actions = sorted(list(getattr(mode, "prevention_actions", None) or []), key=_far_history_id)
    linked_rcas = sorted(list(getattr(mode, "linked_rcas", None) or []), key=_far_history_id)
    return {
        "cause_state": [
            {
                "id": _far_history_id(cause),
                "cause_text": getattr(cause, "cause_text", None),
                "occurrence_level": getattr(cause, "occurrence_level", None),
                "responsible_team": getattr(cause, "responsible_team", None),
            }
            for cause in causes
        ],
        "resolution_state": resolutions,
        "mitigation_state": [
            {
                "id": _far_history_id(mitigation),
                "cause_id": getattr(mitigation, "cause_id", None),
                "mitigation_type": getattr(mitigation, "mitigation_type", None),
                "mitigation_steps": getattr(mitigation, "mitigation_steps", None),
                "responsible_team": getattr(mitigation, "responsible_team", None),
                "status": getattr(mitigation, "status", None),
                "monitoring_item_id": getattr(mitigation, "monitoring_item_id", None),
                "knowledge_bkm_id": getattr(mitigation, "knowledge_bkm_id", None),
                "external_bkm_url": getattr(mitigation, "external_bkm_url", None),
            }
            for mitigation in mitigations
        ],
        "prevention_state": [
            {
                "id": _far_history_id(prevention),
                "cause_id": getattr(prevention, "cause_id", None),
                "prevention_action": getattr(prevention, "prevention_action", None),
                "responsible_team": getattr(prevention, "responsible_team", None),
                "status": getattr(prevention, "status", None),
                "target_date": _far_history_date(getattr(prevention, "target_date", None)),
            }
            for prevention in prevention_actions
        ],
        "linked_rca_ids": [_far_history_id(rca) for rca in linked_rcas],
    }

def build_far_snapshot(mode: models.FarFailureMode) -> dict:
    """Creates a core-restorable snapshot plus forensic intervention lineage."""
    snapshot = {
        "system_name": mode.system_name,
        "failure_type": mode.failure_type,
        "title": mode.title,
        "effect": mode.effect,
        "severity": mode.severity,
        "occurrence": mode.occurrence,
        "detection": mode.detection,
        "rpn": mode.rpn,
        "status": mode.status,
        "affected_asset_ids": sorted([a.id for a in mode.affected_assets]),
        "cause_ids": sorted([c.id for c in mode.causes]),
        "has_incident_history": bool(mode.has_incident_history),
        "metadata_json": normalize_json_object(getattr(mode, "metadata_json", None)),
        "is_deleted": bool(mode.is_deleted),
    }
    snapshot.update(build_far_intervention_snapshot(mode))
    return snapshot

def get_far_restoreable_snapshot(snapshot: dict) -> dict:
    source = snapshot if isinstance(snapshot, dict) else {}
    return {
        field: source[field]
        for field in FAR_HISTORY_RESTOREABLE_FIELDS
        if field in source
    }

def far_restoreable_snapshot_differs(target_snapshot: dict, current_snapshot: dict) -> bool:
    target = get_far_restoreable_snapshot(target_snapshot)
    current = get_far_restoreable_snapshot(current_snapshot)
    return any(current.get(field) != value for field, value in target.items())

def build_far_history_delta(previous_snapshot: Optional[dict], current_snapshot: dict) -> list[dict]:
    previous = previous_snapshot or {}
    current = current_snapshot or {}
    keys = list(dict.fromkeys([*FAR_HISTORY_FIELD_LABELS.keys(), *previous.keys(), *current.keys()]))
    delta = []
    for field in keys:
        previous_value = previous.get(field, False) if field == "is_deleted" else previous.get(field)
        current_value = current.get(field, False) if field == "is_deleted" else current.get(field)
        if previous_snapshot is not None and previous_value == current_value:
            continue
        if field == "is_deleted":
            change_type = "archived" if current_value else "restored"
        elif previous_snapshot is None:
            change_type = "created"
        else:
            change_type = "updated"
        delta.append({
            "field": field,
            "label": FAR_HISTORY_FIELD_LABELS.get(field, field.replace("_", " ").title()),
            "before": previous_value,
            "after": current_value,
            "change_type": change_type,
        })
    return delta

async def save_far_history(mode_id: int, version: int, db: AsyncSession, summary: str = None):
    stmt = (
        select(models.FarFailureMode)
        .options(
            selectinload(models.FarFailureMode.affected_assets),
            selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.resolutions),
            selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.mitigations),
            selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.prevention_actions),
            selectinload(models.FarFailureMode.mitigations),
            selectinload(models.FarFailureMode.prevention_actions),
            selectinload(models.FarFailureMode.linked_rcas),
        )
        .filter(models.FarFailureMode.id == mode_id)
        .execution_options(populate_existing=True)
    )
    res = await db.execute(stmt)
    mode = res.unique().scalar_one()
    
    # Ensure no duplicate version entries
    await db.execute(
        delete(models.FarHistory)
        .where(models.FarHistory.far_mode_id == mode_id, models.FarHistory.version == version)
    )
    
    history = models.FarHistory(
        far_mode_id=mode_id,
        version=version,
        snapshot=build_far_snapshot(mode),
        change_summary=summary
    )
    db.add(history)

# --- FAILURE MODES ---

@router.get("/modes", response_model=List[schemas.FarFailureModeResponse])
async def get_failure_modes(
    system: Optional[str] = None,
    include_deleted: bool = False,
    request: Request = None,
    embedded_consumer: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(models.FarFailureMode).options(
        selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.resolutions).selectinload(models.FarResolution.knowledge_bkm),
        selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.mitigations),
        selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.prevention_actions),
        selectinload(models.FarFailureMode.mitigations),
        selectinload(models.FarFailureMode.affected_assets),
        selectinload(models.FarFailureMode.prevention_actions),
        selectinload(models.FarFailureMode.linked_rcas)
    )
    if not include_deleted:
        stmt = stmt.filter(models.FarFailureMode.is_deleted == False)
    
    if system:
        stmt = stmt.filter(models.FarFailureMode.system_name == system)
    
    result = await db.execute(stmt)
    modes = result.unique().scalars().all()
    if getattr(request.state, "sysgrid_embedded_projection", None):
        return [
            {
                "id": mode.id,
                "created_at": mode.created_at,
                "updated_at": mode.updated_at,
                "system_name": mode.system_name,
                "failure_type": mode.failure_type,
                "title": mode.title,
                "effect": mode.effect,
                "severity": mode.severity,
                "occurrence": mode.occurrence,
                "detection": mode.detection,
                "rpn": mode.rpn,
                "status": mode.status,
                "is_deleted": bool(mode.is_deleted),
                "version": mode.version,
                "metadata_json": {},
                "affected_assets": [],
                "causes": [],
                "mitigations": [],
                "prevention_actions": [],
                "linked_rcas": [],
            }
            for mode in modes
        ]
    return modes

@router.post("/modes", response_model=schemas.FarFailureModeResponse)
async def create_failure_mode(data: dict, db: AsyncSession = Depends(get_db)):
    try:
        relationship_ids = normalize_far_authoring_relationships(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    resolved_relationships = await resolve_far_authoring_relationships(db, relationship_ids)

    # Calculate RPN only after every requested relationship has been validated.
    rpn = data.get('severity', 1) * data.get('occurrence', 1) * data.get('detection', 1)
    mode = models.FarFailureMode(
        system_name=data.get('system_name'),
        failure_type=data.get('failure_type', 'Design'),
        title=data.get('title'),
        effect=data.get('effect'),
        severity=data.get('severity', 1),
        occurrence=data.get('occurrence', 1),
        detection=data.get('detection', 1),
        rpn=rpn,
        status="Analyzing",
        version=1,
        metadata_json=normalize_json_object(data.get('metadata_json')),
        affected_assets=resolved_relationships.get('affected_assets', []),
        causes=resolved_relationships.get('cause_ids', []),
    )
    db.add(mode)
    await db.flush()
    await save_far_history(mode.id, mode.version, db, "Initial creation")
    await db.commit()

    # Reload with all relationships to avoid MissingGreenlet during serialization.
    stmt = select(models.FarFailureMode).options(
        selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.resolutions).selectinload(models.FarResolution.knowledge_bkm),
        selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.mitigations),
        selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.prevention_actions),
        selectinload(models.FarFailureMode.mitigations),
        selectinload(models.FarFailureMode.affected_assets),
        selectinload(models.FarFailureMode.prevention_actions),
        selectinload(models.FarFailureMode.linked_rcas)
    ).filter(models.FarFailureMode.id == mode.id)
    result = await db.execute(stmt)
    return result.unique().scalar_one()

@router.put("/modes/{mode_id}", response_model=schemas.FarFailureModeResponse)
async def update_failure_mode(mode_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    try:
        expected_version, mutation_data = normalize_far_versioned_mutation_request(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    lock_stmt = (
        select(models.FarFailureMode)
        .filter(models.FarFailureMode.id == mode_id)
        .with_for_update()
    )
    lock_result = await db.execute(lock_stmt)
    mode = lock_result.scalar_one_or_none()
    if not mode:
        raise HTTPException(404)

    blocker = get_far_versioned_mutation_precondition(mode, expected_version)
    if blocker:
        raise HTTPException(409, detail=blocker)

    # Keep the row lock while loading the relationship collections needed for assignment.
    relation_stmt = select(models.FarFailureMode).options(
        joinedload(models.FarFailureMode.affected_assets),
        joinedload(models.FarFailureMode.causes)
    ).filter(models.FarFailureMode.id == mode_id)
    relation_result = await db.execute(relation_stmt)
    mode = relation_result.unique().scalar_one()

    # Resolve every relationship request before mutating scalar or relationship state.
    try:
        relationship_ids = normalize_far_authoring_relationships(mutation_data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    resolved_relationships = await resolve_far_authoring_relationships(db, relationship_ids)
    change_summary = mutation_data.get("_change_summary") or "Update via API"

    # Track if we need to update RPN.
    rpn_fields = {'severity', 'occurrence', 'detection'}
    needs_rpn = False
    clean_data = filter_valid_columns(models.FarFailureMode, mutation_data, exclude=IMMUTABLE_FAR_FIELDS)

    for k, v in clean_data.items():
        if hasattr(mode, k):
            setattr(mode, k, v)
            if k in rpn_fields:
                needs_rpn = True

    if 'affected_assets' in resolved_relationships:
        mode.affected_assets = resolved_relationships['affected_assets']
    if 'cause_ids' in resolved_relationships:
        mode.causes = resolved_relationships['cause_ids']

    if needs_rpn:
        mode.rpn = mode.severity * mode.occurrence * mode.detection

    mode.version = int(mode.version or 1) + 1
    await db.flush()
    await save_far_history(mode.id, mode.version, db, change_summary)
    await db.commit()

    # Reload with full relations.
    stmt = select(models.FarFailureMode).options(
        selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.resolutions).selectinload(models.FarResolution.knowledge_bkm),
        selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.mitigations),
        selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.prevention_actions),
        selectinload(models.FarFailureMode.mitigations),
        selectinload(models.FarFailureMode.affected_assets),
        selectinload(models.FarFailureMode.prevention_actions),
        selectinload(models.FarFailureMode.linked_rcas)
    ).filter(models.FarFailureMode.id == mode_id)
    result = await db.execute(stmt)
    return result.unique().scalar_one()

@router.get("/modes/{mode_id}/history")
async def get_far_history(mode_id: int, db: AsyncSession = Depends(get_db)):
    stmt = select(models.FarHistory).filter(models.FarHistory.far_mode_id == mode_id).order_by(models.FarHistory.version.desc())
    res = await db.execute(stmt)
    entries = list(res.scalars().all())
    current_snapshot = entries[0].snapshot or {} if entries else {}
    history = []
    for index, entry in enumerate(entries):
        previous_entry = entries[index + 1] if index + 1 < len(entries) else None
        snapshot = entry.snapshot or {}
        delta = build_far_history_delta(previous_entry.snapshot if previous_entry else None, snapshot)
        changed_fields = [item["field"] for item in delta]
        restoreable_changed_fields = [field for field in changed_fields if field in FAR_HISTORY_RESTOREABLE_FIELDS]
        forensic_changed_fields = [field for field in changed_fields if field in FAR_HISTORY_FORENSIC_FIELDS]
        history.append({
            "id": entry.id,
            "far_mode_id": entry.far_mode_id,
            "version": entry.version,
            "snapshot": entry.snapshot,
            "change_summary": entry.change_summary,
            "created_at": entry.created_at,
            "previous_version": previous_entry.version if previous_entry else None,
            "delta": delta,
            "changed_fields": changed_fields,
            "changed_labels": [item["label"] for item in delta],
            "restore_scope": "core_content",
            "core_restore_available": far_restoreable_snapshot_differs(snapshot, current_snapshot),
            "restoreable_changed_fields": restoreable_changed_fields,
            "forensic_changed_fields": forensic_changed_fields,
            "has_forensic_changes": bool(forensic_changed_fields),
        })
    return history

@router.post("/modes/{mode_id}/restore/{version}")
async def restore_far_version(mode_id: int, version: int, data: dict, db: AsyncSession = Depends(get_db)):
    try:
        expected_version, _ = normalize_far_versioned_mutation_request(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    stmt = select(models.FarHistory).filter(models.FarHistory.far_mode_id == mode_id, models.FarHistory.version == version)
    res = await db.execute(stmt)
    history = res.scalar_one_or_none()
    if not history:
        raise HTTPException(404, "History version not found")

    lock_stmt = (
        select(models.FarFailureMode)
        .filter(models.FarFailureMode.id == mode_id)
        .with_for_update()
    )
    mode_res = await db.execute(lock_stmt)
    mode = mode_res.scalar_one_or_none()
    if not mode:
        raise HTTPException(404)

    blocker = get_far_versioned_mutation_precondition(mode, expected_version)
    if blocker:
        raise HTTPException(409, detail=blocker)

    relation_stmt = (
        select(models.FarFailureMode)
        .options(
            selectinload(models.FarFailureMode.affected_assets),
            selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.resolutions),
            selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.mitigations),
            selectinload(models.FarFailureMode.causes).selectinload(models.FarFailureCause.prevention_actions),
            selectinload(models.FarFailureMode.mitigations),
            selectinload(models.FarFailureMode.prevention_actions),
            selectinload(models.FarFailureMode.linked_rcas),
        )
        .filter(models.FarFailureMode.id == mode_id)
        .execution_options(populate_existing=True)
    )
    relation_res = await db.execute(relation_stmt)
    mode = relation_res.unique().scalar_one()

    snapshot = history.snapshot or {}
    current_snapshot = build_far_snapshot(mode)
    if not far_restoreable_snapshot_differs(snapshot, current_snapshot):
        raise HTTPException(409, detail={
            "code": "far_history_no_core_change",
            "version": version,
            "restore_scope": "core_content",
            "message": "This version differs only in lifecycle or forensic intervention state; no core FAR content can be restored.",
        })

    restoreable_snapshot = get_far_restoreable_snapshot(snapshot)
    for k, v in restoreable_snapshot.items():
        # Explicit lifecycle guard is retained in the endpoint contract even though
        # get_far_restoreable_snapshot excludes lifecycle fields. This keeps the
        # independent archive lifecycle fail-closed if restore scope changes later.
        if k == 'is_deleted':
            continue
        if k == 'affected_asset_ids' and isinstance(v, list):
            target_ids = list(dict.fromkeys(int(item) for item in v))
            asset_stmt = select(models.Device).filter(models.Device.id.in_(target_ids))
            asset_res = await db.execute(asset_stmt)
            assets = list(asset_res.scalars().all())
            found_ids = {int(asset.id) for asset in assets}
            missing_ids = [item for item in target_ids if item not in found_ids]
            if missing_ids:
                raise HTTPException(409, detail={
                    "code": "far_history_restore_missing_assets",
                    "missing_ids": missing_ids,
                })
            mode.affected_assets = assets
        elif k == 'cause_ids' and isinstance(v, list):
            target_ids = list(dict.fromkeys(int(item) for item in v))
            cause_stmt = select(models.FarFailureCause).filter(models.FarFailureCause.id.in_(target_ids))
            cause_res = await db.execute(cause_stmt)
            causes = list(cause_res.scalars().all())
            found_ids = {int(cause.id) for cause in causes}
            missing_ids = [item for item in target_ids if item not in found_ids]
            if missing_ids:
                raise HTTPException(409, detail={
                    "code": "far_history_restore_missing_causes",
                    "missing_ids": missing_ids,
                })
            mode.causes = causes
        elif k == 'metadata_json':
            mode.metadata_json = normalize_json_object(v)
        elif hasattr(mode, k):
            setattr(mode, k, v)

    mode.version = int(mode.version or 1) + 1
    await db.flush()
    await save_far_history(mode.id, mode.version, db, f"Restored core content from v{version}")
    await db.commit()
    return {
        "status": "success",
        "restore_scope": "core_content",
        "forensic_intervention_state_preserved": True,
        "restored_from_version": version,
        "previous_version": expected_version,
        "new_version": mode.version,
    }

@router.post("/modes/{mode_id}/archive")
@router.delete("/modes/{mode_id}", include_in_schema=False)
async def archive_failure_mode(mode_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    try:
        expected_version, _ = normalize_far_versioned_mutation_request(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    stmt = (
        select(models.FarFailureMode)
        .filter(models.FarFailureMode.id == mode_id)
        .with_for_update()
    )
    result = await db.execute(stmt)
    mode = result.scalar_one_or_none()
    if not mode:
        raise HTTPException(404)

    blockers = collect_far_lifecycle_preconditions([mode_id], [mode], {mode_id: expected_version})
    if blockers["version_conflicts"]:
        raise HTTPException(409, detail={"code": "far_mode_version_conflict", **blockers["version_conflicts"][0]})

    changed = apply_far_lifecycle_state(mode, True)
    if changed:
        await db.flush()
        await save_far_history(mode.id, mode.version, db, "Archived failure vector")
    await db.commit()
    return {"status": "success", "changed": changed, "version": mode.version}

@router.post("/modes/bulk-score")
async def bulk_score_failure_modes(data: dict, db: AsyncSession = Depends(get_db)):
    try:
        ids, field, value, expected_versions = normalize_far_bulk_score_request(data)
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc))

    stmt = (
        select(models.FarFailureMode)
        .filter(models.FarFailureMode.id.in_(ids))
        .order_by(models.FarFailureMode.id)
        .with_for_update()
    )
    result = await db.execute(stmt)
    modes = list(result.scalars().all())

    blockers = collect_far_bulk_score_preconditions(ids, modes, expected_versions)
    if blockers["missing_ids"] or blockers["archived_ids"] or blockers["version_conflicts"]:
        raise HTTPException(
            409,
            detail={
                "code": "far_bulk_score_precondition_failed",
                **blockers,
            },
        )

    by_id = {int(mode.id): mode for mode in modes}
    changed_ids = []
    unchanged_ids = []
    for mode_id in ids:
        mode = by_id[mode_id]
        if not apply_far_bulk_score_value(mode, field, value):
            unchanged_ids.append(mode_id)
            continue
        await db.flush()
        await save_far_history(
            mode.id,
            mode.version,
            db,
            f"Bulk score update: {field}={value}",
        )
        changed_ids.append(mode_id)

    await db.commit()
    return {
        "status": "success",
        "field": field,
        "value": value,
        "selected_count": len(ids),
        "changed_count": len(changed_ids),
        "unchanged_count": len(unchanged_ids),
        "changed_ids": changed_ids,
        "unchanged_ids": unchanged_ids,
        "versions": {str(mode_id): int(by_id[mode_id].version or 1) for mode_id in ids},
    }

@router.post("/modes/bulk-archive")
@router.post("/modes/bulk-delete", include_in_schema=False)
async def bulk_archive_failure_modes(data: dict, db: AsyncSession = Depends(get_db)):
    try:
        ids, expected_versions = normalize_far_lifecycle_request(data)
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc))

    stmt = (
        select(models.FarFailureMode)
        .filter(models.FarFailureMode.id.in_(ids))
        .order_by(models.FarFailureMode.id)
        .with_for_update()
    )
    result = await db.execute(stmt)
    modes = list(result.scalars().all())
    blockers = collect_far_lifecycle_preconditions(ids, modes, expected_versions)
    if blockers["missing_ids"] or blockers["version_conflicts"]:
        raise HTTPException(409, detail={"code": "far_lifecycle_precondition_failed", **blockers})

    by_id = {int(mode.id): mode for mode in modes}
    changed_ids = []
    unchanged_ids = []
    for mode_id in ids:
        mode = by_id[mode_id]
        if not apply_far_lifecycle_state(mode, True):
            unchanged_ids.append(mode_id)
            continue
        await db.flush()
        await save_far_history(mode.id, mode.version, db, "Archived failure vector")
        changed_ids.append(mode_id)

    await db.commit()
    return {
        "status": "success",
        "action": "archive",
        "count": len(changed_ids),
        "selected_count": len(ids),
        "changed_count": len(changed_ids),
        "unchanged_count": len(unchanged_ids),
        "changed_ids": changed_ids,
        "unchanged_ids": unchanged_ids,
        "versions": {str(mode_id): int(by_id[mode_id].version or 1) for mode_id in ids},
    }

@router.post("/modes/{mode_id}/restore")
async def restore_failure_mode(mode_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    try:
        expected_version, _ = normalize_far_versioned_mutation_request(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    stmt = (
        select(models.FarFailureMode)
        .filter(models.FarFailureMode.id == mode_id)
        .with_for_update()
    )
    result = await db.execute(stmt)
    mode = result.scalar_one_or_none()
    if not mode:
        raise HTTPException(404)

    blockers = collect_far_lifecycle_preconditions([mode_id], [mode], {mode_id: expected_version})
    if blockers["version_conflicts"]:
        raise HTTPException(409, detail={"code": "far_mode_version_conflict", **blockers["version_conflicts"][0]})

    changed = apply_far_lifecycle_state(mode, False)
    if changed:
        await db.flush()
        await save_far_history(mode.id, mode.version, db, "Restored failure vector")
    await db.commit()
    return {"status": "success", "changed": changed, "version": mode.version}

@router.post("/modes/bulk-restore")
async def bulk_restore_failure_modes(data: dict, db: AsyncSession = Depends(get_db)):
    try:
        ids, expected_versions = normalize_far_lifecycle_request(data)
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc))

    stmt = (
        select(models.FarFailureMode)
        .filter(models.FarFailureMode.id.in_(ids))
        .order_by(models.FarFailureMode.id)
        .with_for_update()
    )
    result = await db.execute(stmt)
    modes = list(result.scalars().all())
    blockers = collect_far_lifecycle_preconditions(ids, modes, expected_versions)
    if blockers["missing_ids"] or blockers["version_conflicts"]:
        raise HTTPException(409, detail={"code": "far_lifecycle_precondition_failed", **blockers})

    by_id = {int(mode.id): mode for mode in modes}
    changed_ids = []
    unchanged_ids = []
    for mode_id in ids:
        mode = by_id[mode_id]
        if not apply_far_lifecycle_state(mode, False):
            unchanged_ids.append(mode_id)
            continue
        await db.flush()
        await save_far_history(mode.id, mode.version, db, "Restored failure vector")
        changed_ids.append(mode_id)

    await db.commit()
    return {
        "status": "success",
        "action": "restore",
        "count": len(changed_ids),
        "selected_count": len(ids),
        "changed_count": len(changed_ids),
        "unchanged_count": len(unchanged_ids),
        "changed_ids": changed_ids,
        "unchanged_ids": unchanged_ids,
        "versions": {str(mode_id): int(by_id[mode_id].version or 1) for mode_id in ids},
    }

# --- CAUSES ---

@router.get("/causes", response_model=List[schemas.FarFailureCauseResponse])
async def get_failure_causes(db: AsyncSession = Depends(get_db)):
    stmt = select(models.FarFailureCause).options(
        selectinload(models.FarFailureCause.failure_modes),
        selectinload(models.FarFailureCause.resolutions).selectinload(models.FarResolution.knowledge_bkm),
        selectinload(models.FarFailureCause.mitigations),
        selectinload(models.FarFailureCause.prevention_actions)
    )
    result = await db.execute(stmt)
    return result.unique().scalars().all()

@router.post("/causes", response_model=schemas.FarFailureCauseResponse)
async def create_cause(data: dict, db: AsyncSession = Depends(get_db)):
    try:
        mode_id, expected_version, mutation_data = normalize_far_context_mutation_request(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    mode = await lock_far_context_mode(mode_id, expected_version, db)
    requested_mode_ids = mutation_data.get("mode_ids")
    if requested_mode_ids not in (None, [mode_id]):
        raise HTTPException(422, "Context-scoped cause creation requires mode_ids to contain only mode_id")

    cause = models.FarFailureCause(
        cause_text=mutation_data.get('cause_text'),
        occurrence_level=mutation_data.get('occurrence_level', 1),
        responsible_team=mutation_data.get('responsible_team'),
        failure_modes=[],
        resolutions=[],
        mitigations=[],
        prevention_actions=[]
    )
    db.add(cause)
    await db.flush()
    await db.execute(models.far_mode_causes.insert().values(mode_id=mode_id, cause_id=cause.id))
    await advance_far_context_mode(mode, db, f"Root cause linked: cause {cause.id}")
    await db.commit()

    stmt = select(models.FarFailureCause).options(
        selectinload(models.FarFailureCause.failure_modes),
        selectinload(models.FarFailureCause.resolutions).selectinload(models.FarResolution.knowledge_bkm),
        selectinload(models.FarFailureCause.mitigations).selectinload(models.FarMitigation.monitoring_item),
        selectinload(models.FarFailureCause.prevention_actions)
    ).filter(models.FarFailureCause.id == cause.id)
    result = await db.execute(stmt)
    return result.unique().scalar_one()

@router.put("/causes/{cause_id}", response_model=schemas.FarFailureCauseResponse)
async def update_cause(cause_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    try:
        mode_id, expected_version, mutation_data = normalize_far_context_mutation_request(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    mode = await lock_far_context_mode(mode_id, expected_version, db)
    parent_ids = await get_far_cause_parent_ids(cause_id, db)
    ensure_far_exclusive_cause_context(cause_id, mode_id, parent_ids)

    result = await db.execute(select(models.FarFailureCause).filter(models.FarFailureCause.id == cause_id))
    cause = result.scalar_one_or_none()
    if not cause:
        raise HTTPException(404, "Root cause not found")

    if 'cause_text' in mutation_data:
        cause.cause_text = mutation_data.get('cause_text')
    if 'occurrence_level' in mutation_data:
        cause.occurrence_level = mutation_data.get('occurrence_level')
    if 'responsible_team' in mutation_data:
        cause.responsible_team = mutation_data.get('responsible_team')

    await advance_far_context_mode(mode, db, f"Root cause updated: cause {cause_id}")
    await db.commit()

    stmt = select(models.FarFailureCause).options(
        selectinload(models.FarFailureCause.failure_modes),
        selectinload(models.FarFailureCause.resolutions).selectinload(models.FarResolution.knowledge_bkm),
        selectinload(models.FarFailureCause.mitigations).selectinload(models.FarMitigation.monitoring_item),
        selectinload(models.FarFailureCause.prevention_actions)
    ).filter(models.FarFailureCause.id == cause_id)
    result = await db.execute(stmt)
    return result.unique().scalar_one()

@router.delete("/causes/{cause_id}")
async def delete_cause(cause_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    try:
        mode_id, expected_version, _ = normalize_far_context_mutation_request(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    mode = await lock_far_context_mode(mode_id, expected_version, db)
    parent_ids = await get_far_cause_parent_ids(cause_id, db)
    if mode_id not in parent_ids:
        raise HTTPException(409, detail={"code": "far_cause_not_linked_to_mode", "cause_id": cause_id, "mode_id": mode_id})

    result = await db.execute(select(models.FarFailureCause).filter(models.FarFailureCause.id == cause_id))
    cause = result.scalar_one_or_none()
    if not cause:
        raise HTTPException(404, "Root cause not found")

    await db.execute(
        delete(models.far_mode_causes).where(
            models.far_mode_causes.c.mode_id == mode_id,
            models.far_mode_causes.c.cause_id == cause_id,
        )
    )
    deleted = len(parent_ids) == 1
    if deleted:
        await db.delete(cause)
    await advance_far_context_mode(mode, db, f"Root cause unlinked: cause {cause_id}")
    await db.commit()
    return {"status": "success", "unlinked": True, "deleted": deleted, "parent_version": mode.version}

# --- RESOLUTIONS ---

@router.post("/resolutions", response_model=schemas.FarResolutionResponse)
async def create_resolution(data: dict, db: AsyncSession = Depends(get_db)):
    try:
        mode_id, expected_version, mutation_data = normalize_far_context_mutation_request(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    mode = await lock_far_context_mode(mode_id, expected_version, db)
    cause_ids = mutation_data.get('cause_ids') or []
    if len(cause_ids) != 1 or isinstance(cause_ids[0], bool) or not isinstance(cause_ids[0], int):
        raise HTTPException(422, "Resolution mutation requires exactly one cause_id")
    cause_id = int(cause_ids[0])
    parent_ids = await get_far_cause_parent_ids(cause_id, db)
    ensure_far_exclusive_cause_context(cause_id, mode_id, parent_ids)

    cause_result = await db.execute(select(models.FarFailureCause).filter(models.FarFailureCause.id == cause_id))
    if not cause_result.scalar_one_or_none():
        raise HTTPException(404, "Root cause not found")

    res = models.FarResolution(
        knowledge_id=mutation_data.get('knowledge_id'),
        preventive_follow_up=mutation_data.get('preventive_follow_up'),
        responsible_team=mutation_data.get('responsible_team'),
        guidance_notes=mutation_data.get('guidance_notes')
    )
    db.add(res)
    await db.flush()
    await db.execute(models.far_cause_resolutions.insert().values(cause_id=cause_id, resolution_id=res.id))
    await advance_far_context_mode(mode, db, f"Resolution linked: cause {cause_id}, resolution {res.id}")
    await db.commit()

    stmt = select(models.FarResolution).options(joinedload(models.FarResolution.knowledge_bkm)).filter(models.FarResolution.id == res.id)
    result = await db.execute(stmt)
    return result.scalar_one()

@router.delete("/resolutions/{resolution_id}")
async def delete_resolution(resolution_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    try:
        mode_id, expected_version, mutation_data = normalize_far_context_mutation_request(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    cause_id = mutation_data.get('cause_id')
    if isinstance(cause_id, bool) or not isinstance(cause_id, int) or cause_id <= 0:
        raise HTTPException(422, "cause_id must be a positive integer")

    mode = await lock_far_context_mode(mode_id, expected_version, db)
    parent_ids = await get_far_cause_parent_ids(cause_id, db)
    ensure_far_exclusive_cause_context(cause_id, mode_id, parent_ids)

    link_result = await db.execute(
        select(models.far_cause_resolutions.c.cause_id).where(
            models.far_cause_resolutions.c.cause_id == cause_id,
            models.far_cause_resolutions.c.resolution_id == resolution_id,
        )
    )
    if link_result.scalar_one_or_none() is None:
        raise HTTPException(404, "Resolution linkage not found")

    resolution_result = await db.execute(select(models.FarResolution).filter(models.FarResolution.id == resolution_id))
    resolution = resolution_result.scalar_one_or_none()
    if not resolution:
        raise HTTPException(404, "Resolution not found")

    await db.execute(
        delete(models.far_cause_resolutions).where(
            models.far_cause_resolutions.c.cause_id == cause_id,
            models.far_cause_resolutions.c.resolution_id == resolution_id,
        )
    )
    remaining_result = await db.execute(
        select(models.far_cause_resolutions.c.cause_id).where(models.far_cause_resolutions.c.resolution_id == resolution_id)
    )
    orphaned = not list(remaining_result.scalars().all())
    if orphaned:
        await db.delete(resolution)
    await advance_far_context_mode(mode, db, f"Resolution unlinked: cause {cause_id}, resolution {resolution_id}")
    await db.commit()
    return {"status": "success", "unlinked": True, "deleted": orphaned, "parent_version": mode.version}

# --- MITIGATIONS ---

@router.post("/mitigations", response_model=schemas.FarMitigationResponse)
async def create_mitigation(data: dict, db: AsyncSession = Depends(get_db)):
    try:
        mode_id, expected_version, mutation_data = normalize_far_context_mutation_request(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    mode = await lock_far_context_mode(mode_id, expected_version, db)
    requested_mode_ids = mutation_data.pop("mode_ids", None)
    if requested_mode_ids not in (None, [mode_id]):
        raise HTTPException(422, "Context-scoped mitigation creation requires mode_ids to contain only mode_id")

    try:
        payload = normalize_far_mitigation_payload(mutation_data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    parent_ids = await get_far_cause_parent_ids(payload["cause_id"], db)
    ensure_far_exclusive_cause_context(payload["cause_id"], mode_id, parent_ids)
    await resolve_far_mitigation_references(db, payload)

    mit = models.FarMitigation(**payload)
    db.add(mit)
    await db.flush()
    await db.execute(models.far_mode_mitigations.insert().values(mode_id=mode_id, mitigation_id=mit.id))
    await advance_far_context_mode(mode, db, f"Mitigation linked: cause {payload['cause_id']}, mitigation {mit.id}")
    await db.commit()
    await db.refresh(mit)
    return mit


@router.put("/mitigations/{mitigation_id}", response_model=schemas.FarMitigationResponse)
async def update_mitigation(mitigation_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    try:
        mode_id, expected_version, mutation_data = normalize_far_context_mutation_request(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    mode = await lock_far_context_mode(mode_id, expected_version, db)
    requested_mode_ids = mutation_data.pop("mode_ids", None)
    if requested_mode_ids not in (None, [mode_id]):
        raise HTTPException(422, "Context-scoped mitigation update requires mode_ids to contain only mode_id")

    link_result = await db.execute(
        select(models.far_mode_mitigations.c.mode_id).where(models.far_mode_mitigations.c.mitigation_id == mitigation_id)
    )
    parent_ids = [int(parent_id) for parent_id in link_result.scalars().all()]
    if mode_id not in parent_ids:
        raise HTTPException(409, detail={"code": "far_mitigation_not_linked_to_mode", "mitigation_id": mitigation_id, "mode_id": mode_id})
    if len(parent_ids) != 1:
        raise HTTPException(409, detail={"code": "far_shared_mitigation_requires_explicit_scope", "mitigation_id": mitigation_id, "mode_ids": parent_ids})

    mitigation_result = await db.execute(select(models.FarMitigation).filter(models.FarMitigation.id == mitigation_id))
    mitigation = mitigation_result.scalar_one_or_none()
    if not mitigation:
        raise HTTPException(404, "Mitigation not found")

    try:
        payload = normalize_far_mitigation_payload(mutation_data, existing=mitigation)
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    cause_parent_ids = await get_far_cause_parent_ids(payload["cause_id"], db)
    ensure_far_exclusive_cause_context(payload["cause_id"], mode_id, cause_parent_ids)
    await resolve_far_mitigation_references(db, payload)

    mutable_fields = (
        "mitigation_steps",
        "responsible_team",
        "status",
        "monitoring_item_id",
        "knowledge_bkm_id",
        "external_bkm_url",
    )
    changes = {
        field: value
        for field in mutable_fields
        if getattr(mitigation, field, None) != (value := payload[field])
    }
    if not changes:
        await db.commit()
        return mitigation

    for field, value in changes.items():
        setattr(mitigation, field, value)
    await advance_far_context_mode(mode, db, f"Mitigation updated: mitigation {mitigation_id}")
    await db.commit()
    await db.refresh(mitigation)
    return mitigation


@router.delete("/mitigations/{mitigation_id}")
async def delete_mitigation(mitigation_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    try:
        mode_id, expected_version, _ = normalize_far_context_mutation_request(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    mode = await lock_far_context_mode(mode_id, expected_version, db)
    link_result = await db.execute(
        select(models.far_mode_mitigations.c.mode_id).where(models.far_mode_mitigations.c.mitigation_id == mitigation_id)
    )
    parent_ids = [int(parent_id) for parent_id in link_result.scalars().all()]
    if mode_id not in parent_ids:
        raise HTTPException(409, detail={"code": "far_mitigation_not_linked_to_mode", "mitigation_id": mitigation_id, "mode_id": mode_id})
    if len(parent_ids) != 1:
        raise HTTPException(409, detail={"code": "far_shared_mitigation_requires_explicit_scope", "mitigation_id": mitigation_id, "mode_ids": parent_ids})

    mitigation_result = await db.execute(select(models.FarMitigation).filter(models.FarMitigation.id == mitigation_id))
    mitigation = mitigation_result.scalar_one_or_none()
    if not mitigation:
        raise HTTPException(404, "Mitigation not found")
    if normalize_far_mitigation_status(mitigation.status) == "Completed":
        raise HTTPException(409, detail={
            "code": "far_mitigation_completed_read_only",
            "mitigation_id": mitigation_id,
        })

    await db.execute(
        delete(models.far_mode_mitigations).where(
            models.far_mode_mitigations.c.mode_id == mode_id,
            models.far_mode_mitigations.c.mitigation_id == mitigation_id,
        )
    )
    await db.delete(mitigation)
    await advance_far_context_mode(mode, db, f"Mitigation removed: mitigation {mitigation_id}")
    await db.commit()
    return {"status": "success", "deleted": True, "parent_version": mode.version}

# --- PREVENTION ---

FAR_PREVENTION_STATUSES = {"Open", "In Progress", "Verified", "Completed"}

def normalize_far_prevention_project_request(data: dict):
    mode_id, expected_version, mutation_data = normalize_far_context_mutation_request(data)
    cause_id = mutation_data.pop("cause_id", None)
    if isinstance(cause_id, bool) or not isinstance(cause_id, int) or cause_id <= 0:
        raise ValueError("cause_id must be a positive integer")
    project = mutation_data.pop("project", None)
    if project is not None and not isinstance(project, dict):
        raise ValueError("project must be an object")
    return mode_id, expected_version, cause_id, project, mutation_data

def get_far_prevention_status_from_project(project_status):
    status = str(project_status or "").strip().lower()
    if status == "completed":
        return "Completed"
    if status in {"in progress", "active", "executing"}:
        return "In Progress"
    return "Open"

def ensure_far_cause_linked_to_mode(cause_id: int, mode_id: int, parent_ids: list[int]):
    if mode_id not in parent_ids:
        raise HTTPException(409, detail={
            "code": "far_cause_not_linked_to_mode",
            "cause_id": cause_id,
            "mode_id": mode_id,
        })

@router.post("/prevention")
async def create_prevention(data: dict, db: AsyncSession = Depends(get_db)):
    try:
        mode_id, expected_version, cause_id, project_payload, mutation_data = normalize_far_prevention_project_request(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    mode = await lock_far_context_mode(mode_id, expected_version, db)
    parent_ids = await get_far_cause_parent_ids(cause_id, db)
    ensure_far_cause_linked_to_mode(cause_id, mode_id, parent_ids)

    project = None
    if project_payload is not None:
        try:
            validated_project = schemas.ProjectCreate.model_validate(project_payload)
        except Exception as exc:
            raise HTTPException(422, detail=str(exc))

        project_data = validated_project.model_dump()
        tasks_data = project_data.pop("tasks", [])
        project_metadata = dict(project_data.get("metadata_json") or {})
        project_data["metadata_json"] = {
            **project_metadata,
            "linked_failure_mode_id": mode_id,
            "linked_cause_id": cause_id,
        }
        project = models.Project(**project_data)
        db.add(project)
        await db.flush()

        for task_data in tasks_data:
            clean_task_data = filter_valid_columns(models.ProjectTask, task_data)
            clean_task_data.pop("id", None)
            clean_task_data.pop("project_id", None)
            db.add(models.ProjectTask(**clean_task_data, project_id=project.id))

        owners = project_data.get("owners") or []
        prevention_action = (
            project_data.get("objective")
            or project_data.get("description")
            or project_data.get("name")
        )
        responsible_team = project_data.get("owner") or (owners[0] if owners else None)
        prevention_status = get_far_prevention_status_from_project(project_data.get("status"))
        target_date = project_data.get("end_date")
    else:
        prevention_action = mutation_data.get("prevention_action")
        responsible_team = mutation_data.get("responsible_team")
        prevention_status = mutation_data.get("status", "Open")
        target_date = mutation_data.get("target_date")

    if not prevention_action or not str(prevention_action).strip():
        raise HTTPException(422, "prevention_action is required")
    if prevention_status not in FAR_PREVENTION_STATUSES:
        raise HTTPException(422, "status must be Open, In Progress, Verified, or Completed")

    prev = models.FarPrevention(
        failure_mode_id=mode_id,
        cause_id=cause_id,
        prevention_action=str(prevention_action).strip(),
        responsible_team=responsible_team,
        status=prevention_status,
        target_date=target_date,
    )
    db.add(prev)
    await db.flush()

    if project is not None:
        project.metadata_json = {
            **dict(project.metadata_json or {}),
            "far_prevention_id": prev.id,
        }

    await advance_far_context_mode(mode, db, f"Prevention project linked: prevention {prev.id}")
    await db.commit()
    return {
        "status": "success",
        "prevention": {
            "id": prev.id,
            "failure_mode_id": prev.failure_mode_id,
            "cause_id": prev.cause_id,
            "prevention_action": prev.prevention_action,
            "responsible_team": prev.responsible_team,
            "status": prev.status,
            "target_date": prev.target_date,
        },
        "project": None if project is None else {
            "id": project.id,
            "name": project.name,
            "status": project.status,
        },
        "parent_version": mode.version,
    }

@router.put("/prevention/{prevention_id}", response_model=schemas.FarPreventionResponse)
async def update_prevention(prevention_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    try:
        mode_id, expected_version, mutation_data = normalize_far_context_mutation_request(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    mode = await lock_far_context_mode(mode_id, expected_version, db)
    result = await db.execute(
        select(models.FarPrevention).filter(
            models.FarPrevention.id == prevention_id,
            models.FarPrevention.failure_mode_id == mode_id,
        )
    )
    prev = result.scalar_one_or_none()
    if not prev:
        raise HTTPException(404, "Prevention record not found")

    changed = False
    if "status" in mutation_data:
        status = mutation_data.get("status")
        if status not in FAR_PREVENTION_STATUSES:
            raise HTTPException(422, "status must be Open, In Progress, Verified, or Completed")
        if prev.status != status:
            prev.status = status
            changed = True
    for field in ("prevention_action", "responsible_team", "target_date"):
        if field in mutation_data and getattr(prev, field) != mutation_data.get(field):
            setattr(prev, field, mutation_data.get(field))
            changed = True

    if changed:
        await advance_far_context_mode(mode, db, f"Prevention updated: prevention {prevention_id}")
    await db.commit()
    await db.refresh(prev)
    return prev
