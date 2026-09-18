from copy import deepcopy
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import models
from .module_policy import require_module_access

router = APIRouter(
    prefix="/data-flows",
    tags=["Data Flow Designer"],
    dependencies=[Depends(require_module_access("architecture"))],
)

DEFAULT_FLOW_METADATA = {
    "owner_team": "",
    "criticality": "Medium",
    "dependency_tier": "Tier 2",
    "review_status": "Needs Review",
    "runbook_url": "",
    "source_of_truth": "",
    "business_purpose": "",
    "last_reviewed_at": "",
    "next_review_due": "",
    "approved_at": "",
    "approved_by": "",
    "approval_notes": "",
    "links": {
        "knowledge_ids": [],
        "monitoring_ids": [],
        "far_ids": [],
        "vendor_ids": [],
        "project_ids": [],
    },
}


def merge_metadata(base: dict, override: dict) -> dict:
    merged = deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = merge_metadata(merged[key], value)
        else:
            merged[key] = value
    return merged


def normalize_metadata(metadata: dict | None) -> dict:
    normalized = merge_metadata(DEFAULT_FLOW_METADATA, metadata or {})
    normalized["links"] = merge_metadata(DEFAULT_FLOW_METADATA["links"], normalized.get("links") or {})
    return normalized


def serialize_snapshot(flow: models.DataFlow) -> dict:
    return {
        "name": flow.name,
        "description": flow.description,
        "category": flow.category,
        "status": flow.status,
        "metadata": normalize_metadata(flow.metadata_json or {}),
        "nodes": deepcopy(flow.nodes_json or []),
        "edges": deepcopy(flow.edges_json or []),
        "viewport": deepcopy(flow.viewport_json or {}),
        "traces": deepcopy(flow.traces_json or []),
        "is_template": flow.is_template,
        "is_deleted": flow.is_deleted,
    }


async def get_current_version(flow_id: int, db: AsyncSession) -> int:
    result = await db.execute(
        select(func.max(models.DataFlowHistory.version)).where(models.DataFlowHistory.data_flow_id == flow_id)
    )
    return int(result.scalar_one_or_none() or 0)


async def save_history(flow: models.DataFlow, db: AsyncSession, summary: str) -> models.DataFlowHistory:
    history = models.DataFlowHistory(
        data_flow_id=flow.id,
        version=(await get_current_version(flow.id, db)) + 1,
        snapshot=serialize_snapshot(flow),
        change_summary=summary,
    )
    db.add(history)
    await db.flush()
    return history


def format_flow(flow: models.DataFlow, current_version: int = 0):
    metadata = normalize_metadata(flow.metadata_json or {})
    return {
        "id": flow.id,
        "name": flow.name,
        "description": flow.description,
        "category": flow.category,
        "status": flow.status,
        "metadata": metadata,
        "nodes": flow.nodes_json or [],
        "edges": flow.edges_json or [],
        "viewport": flow.viewport_json or {},
        "traces": flow.traces_json or [],
        "is_template": flow.is_template,
        "is_deleted": flow.is_deleted,
        "current_version": current_version,
        "created_at": flow.created_at.isoformat() if flow.created_at else None,
        "updated_at": flow.updated_at.isoformat() if flow.updated_at else None,
    }


def format_history(entry: models.DataFlowHistory):
    snapshot = entry.snapshot or {}
    snapshot["metadata"] = normalize_metadata(snapshot.get("metadata") or {})
    return {
        "id": entry.id,
        "data_flow_id": entry.data_flow_id,
        "version": entry.version,
        "change_summary": entry.change_summary,
        "snapshot": snapshot,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
        "updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
    }


async def fetch_flow(flow_id: int, db: AsyncSession) -> models.DataFlow:
    result = await db.execute(select(models.DataFlow).where(models.DataFlow.id == flow_id))
    flow = result.scalar_one_or_none()
    if not flow:
        raise HTTPException(404, "Flow not found")
    return flow


def apply_flow_payload(flow: models.DataFlow, data: dict):
    if "name" in data:
        flow.name = data["name"]
    if "description" in data:
        flow.description = data["description"]
    if "category" in data:
        flow.category = data["category"]
    if "status" in data:
        flow.status = data["status"]
    if "metadata" in data:
        flow.metadata_json = normalize_metadata(data["metadata"])
    elif flow.metadata_json is None:
        flow.metadata_json = normalize_metadata({})
    if "nodes" in data:
        flow.nodes_json = data["nodes"]
    if "edges" in data:
        flow.edges_json = data["edges"]
    if "viewport" in data:
        flow.viewport_json = data["viewport"]
    if "traces" in data:
        flow.traces_json = data["traces"]
    if "is_deleted" in data:
        flow.is_deleted = data["is_deleted"]
    if "is_template" in data:
        flow.is_template = data["is_template"]


@router.get("")
async def get_flows(include_deleted: bool = False, db: AsyncSession = Depends(get_db)):
    query = select(models.DataFlow)
    query = query.where(models.DataFlow.is_deleted == include_deleted)
    result = await db.execute(query.order_by(models.DataFlow.updated_at.desc(), models.DataFlow.id.desc()))
    flows = result.scalars().all()

    version_rows = await db.execute(
        select(models.DataFlowHistory.data_flow_id, func.max(models.DataFlowHistory.version))
        .group_by(models.DataFlowHistory.data_flow_id)
    )
    version_map = {row[0]: int(row[1] or 0) for row in version_rows.all()}
    return [format_flow(flow, version_map.get(flow.id, 0)) for flow in flows]


@router.post("")
async def create_flow(data: dict, db: AsyncSession = Depends(get_db)):
    flow = models.DataFlow(
        name=data.get("name", "New Data Flow"),
        description=data.get("description", ""),
        category=data.get("category", "System"),
        status=data.get("status", "Up to date"),
        metadata_json=normalize_metadata(data.get("metadata", {})),
        nodes_json=data.get("nodes", []),
        edges_json=data.get("edges", []),
        viewport_json=data.get("viewport", {}),
        traces_json=data.get("traces", []),
        is_template=data.get("is_template", False),
    )
    db.add(flow)
    await db.flush()
    await save_history(flow, db, "Initial version")
    await db.commit()
    await db.refresh(flow)
    return format_flow(flow, 1)


@router.get("/{flow_id}")
async def get_flow(flow_id: int, db: AsyncSession = Depends(get_db)):
    flow = await fetch_flow(flow_id, db)
    return format_flow(flow, await get_current_version(flow.id, db))


@router.put("/{flow_id}")
async def update_flow(flow_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    flow = await fetch_flow(flow_id, db)
    apply_flow_payload(flow, data)
    await db.flush()
    summary = data.get("change_summary") or "Updated architecture manifest"
    current_version = await get_current_version(flow.id, db) + 1
    await save_history(flow, db, summary)
    await db.commit()
    await db.refresh(flow)
    return format_flow(flow, current_version)


@router.get("/{flow_id}/history")
async def get_flow_history(flow_id: int, db: AsyncSession = Depends(get_db)):
    await fetch_flow(flow_id, db)
    result = await db.execute(
        select(models.DataFlowHistory)
        .where(models.DataFlowHistory.data_flow_id == flow_id)
        .order_by(models.DataFlowHistory.version.desc(), models.DataFlowHistory.id.desc())
    )
    return [format_history(entry) for entry in result.scalars().all()]


@router.post("/{flow_id}/history/{history_id}/restore")
async def restore_flow_version(flow_id: int, history_id: int, db: AsyncSession = Depends(get_db)):
    flow = await fetch_flow(flow_id, db)
    history_result = await db.execute(
        select(models.DataFlowHistory).where(
            models.DataFlowHistory.id == history_id,
            models.DataFlowHistory.data_flow_id == flow_id,
        )
    )
    history = history_result.scalar_one_or_none()
    if not history:
        raise HTTPException(404, "History entry not found")

    snapshot = history.snapshot or {}
    apply_flow_payload(flow, snapshot)
    flow.is_deleted = False
    metadata = normalize_metadata(flow.metadata_json or {})
    metadata["review_status"] = "Needs Review"
    flow.metadata_json = metadata
    await db.flush()
    current_version = await get_current_version(flow.id, db) + 1
    await save_history(flow, db, f"Restored version {history.version}")
    await db.commit()
    await db.refresh(flow)
    return format_flow(flow, current_version)


@router.post("/{flow_id}/approve")
async def approve_flow(flow_id: int, data: dict | None = None, db: AsyncSession = Depends(get_db)):
    flow = await fetch_flow(flow_id, db)
    payload = data or {}
    metadata = normalize_metadata(flow.metadata_json or {})
    metadata["review_status"] = "Approved"
    metadata["approved_by"] = payload.get("approved_by") or metadata.get("owner_team") or "Architecture Board"
    metadata["approval_notes"] = payload.get("approval_notes", metadata.get("approval_notes", ""))
    timestamp = datetime.now(timezone.utc).isoformat()
    metadata["approved_at"] = timestamp
    metadata["last_reviewed_at"] = timestamp
    flow.metadata_json = metadata
    await db.flush()
    current_version = await get_current_version(flow.id, db) + 1
    await save_history(flow, db, payload.get("change_summary") or "Approved architecture manifest")
    await db.commit()
    await db.refresh(flow)
    return format_flow(flow, current_version)


@router.post("/{flow_id}/restore")
async def restore_flow(flow_id: int, db: AsyncSession = Depends(get_db)):
    flow = await fetch_flow(flow_id, db)
    flow.is_deleted = False
    await db.flush()
    current_version = await get_current_version(flow.id, db) + 1
    await save_history(flow, db, "Restored deleted architecture")
    await db.commit()
    await db.refresh(flow)
    return format_flow(flow, current_version)


@router.delete("/{flow_id}")
async def delete_flow(flow_id: int, permanent: bool = False, db: AsyncSession = Depends(get_db)):
    flow = await fetch_flow(flow_id, db)

    if permanent:
        await db.delete(flow)
        await db.commit()
        return {"status": "success"}

    flow.is_deleted = True
    await db.flush()
    await save_history(flow, db, "Archived architecture")
    await db.commit()
    return {"status": "success"}
