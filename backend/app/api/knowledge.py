from copy import deepcopy
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update, or_
from sqlalchemy.orm import selectinload
from typing import List, Optional
from ..database import get_db
from ..models import models
from ..schemas import schemas
from .utils import filter_valid_columns, get_current_user_id
from .module_policy import require_module_access

router = APIRouter(prefix="/knowledge", tags=["Knowledge Base & Q&A"])

DEFAULT_KNOWLEDGE_METADATA = {
    "entry_type": "Runbook",
    "criticality": "Standard",
    "ownership": {
        "owner": "",
        "backup_owner": "",
        "review_team": "",
        "escalation_contact": ""
    },
    "verification": {
        "state": "Needs Review",
        "last_verified_at": "",
        "next_review_at": "",
        "verified_by": ""
    },
    "links": {
        "data_flow_ids": [],
        "service_ids": [],
        "monitoring_ids": [],
        "far_ids": [],
        "research_ids": [],
        "vendor_ids": [],
        "project_ids": []
    },
    "feedback": [],
    "version_history": [],
    "source_context": {}
}


def _merge_dict(base: dict, override: dict) -> dict:
    merged = deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_dict(merged[key], value)
        else:
            merged[key] = value
    return merged


def normalize_metadata(entry_data: dict, existing_metadata: Optional[dict] = None) -> dict:
    metadata = _merge_dict(DEFAULT_KNOWLEDGE_METADATA, existing_metadata or {})
    metadata = _merge_dict(metadata, entry_data.get("metadata_json") or {})
    metadata["entry_type"] = metadata.get("entry_type") or "Runbook"
    metadata["criticality"] = metadata.get("criticality") or "Standard"
    metadata["ownership"] = _merge_dict(DEFAULT_KNOWLEDGE_METADATA["ownership"], metadata.get("ownership") or {})
    metadata["verification"] = _merge_dict(DEFAULT_KNOWLEDGE_METADATA["verification"], metadata.get("verification") or {})
    metadata["links"] = _merge_dict(DEFAULT_KNOWLEDGE_METADATA["links"], metadata.get("links") or {})
    metadata["feedback"] = list(metadata.get("feedback") or [])
    metadata["version_history"] = list(metadata.get("version_history") or [])
    metadata["source_context"] = dict(metadata.get("source_context") or {})
    return metadata


def build_version_snapshot(entry: models.KnowledgeEntry, metadata: dict, summary: str) -> dict:
    history = metadata.get("version_history") or []
    return {
        "version": len(history) + 1,
        "changed_at": datetime.now(timezone.utc).isoformat(),
        "changed_by": metadata.get("ownership", {}).get("owner") or entry.created_by_user_id or "",
        "summary": summary,
        "snapshot": {
            "category": entry.category,
            "title": entry.title,
            "content": entry.content,
            "content_json": deepcopy(entry.content_json or {}),
            "question_context": entry.question_context,
            "tags": list(entry.tags or []),
            "impacted_systems": list(entry.impacted_systems or []),
            "linked_device_ids": list(entry.linked_device_ids or []),
            "status": entry.status,
            "metadata_json": {
                k: deepcopy(v)
                for k, v in metadata.items()
                if k != "version_history"
            }
        }
    }


def stringify_knowledge_blob(value) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        return " ".join(stringify_knowledge_blob(v) for v in value.values())
    if isinstance(value, list):
        return " ".join(stringify_knowledge_blob(v) for v in value)
    return str(value)


async def get_lookup_names(db: AsyncSession, ids: List[int], model, field_name: str = "name") -> dict:
    if not ids:
        return {}
    result = await db.execute(select(model.id, getattr(model, field_name)).where(model.id.in_(ids)))
    return {row[0]: row[1] for row in result.all()}


async def expand_entry_search_text(entry: models.KnowledgeEntry, db: AsyncSession) -> str:
    metadata = normalize_metadata({"metadata_json": entry.metadata_json}, entry.metadata_json)
    links = metadata.get("links", {})
    data_flow_names = await get_lookup_names(db, links.get("data_flow_ids", []), models.DataFlow, "name")
    service_names = await get_lookup_names(db, links.get("service_ids", []), models.LogicalService)
    monitoring_names = await get_lookup_names(db, links.get("monitoring_ids", []), models.MonitoringItem, "title")
    far_names = await get_lookup_names(db, links.get("far_ids", []), models.FarFailureMode, "title")
    research_names = await get_lookup_names(db, links.get("research_ids", []), models.Investigation, "title")
    vendor_names = await get_lookup_names(db, links.get("vendor_ids", []), models.Vendor)
    project_names = await get_lookup_names(db, links.get("project_ids", []), models.Project, "name")
    device_names = await get_lookup_names(db, entry.linked_device_ids or [], models.Device)

    parts = [
        entry.title,
        entry.content,
        entry.question_context,
        stringify_knowledge_blob(entry.content_json),
        stringify_knowledge_blob(entry.tags),
        stringify_knowledge_blob(entry.impacted_systems),
        stringify_knowledge_blob(metadata),
        stringify_knowledge_blob(device_names.values()),
        stringify_knowledge_blob(data_flow_names.values()),
        stringify_knowledge_blob(service_names.values()),
        stringify_knowledge_blob(monitoring_names.values()),
        stringify_knowledge_blob(far_names.values()),
        stringify_knowledge_blob(research_names.values()),
        stringify_knowledge_blob(vendor_names.values()),
        stringify_knowledge_blob(project_names.values()),
    ]
    return " ".join(part for part in parts if part)


async def _require_embedded_targets(request: Request, db: AsyncSession) -> None:
    """Resolve every embedded selector inside the active tenant before reading rows."""
    if not getattr(request.state, "sysgrid_embedded_projection", None):
        return

    selectors = getattr(request.state, "sysgrid_embedded_selectors", {})
    tenant_id = getattr(request.state, "tenant_id", None)
    target_checks = []
    if "device_id" in selectors:
        device_query = select(models.Device.id).where(
            models.Device.id == selectors["device_id"],
            models.Device.is_deleted == False,
        )
        if tenant_id is not None:
            device_query = device_query.where(models.Device.tenant_id == tenant_id)
        target_checks.append(("device_id", device_query))
    if "service_id" in selectors:
        target_checks.append((
            "service_id",
            select(models.LogicalService.id).where(
                models.LogicalService.id == selectors["service_id"],
                models.LogicalService.is_deleted == False,
            ),
        ))
    if "monitoring_id" in selectors:
        target_checks.append((
            "monitoring_id",
            select(models.MonitoringItem.id).where(
                models.MonitoringItem.id == selectors["monitoring_id"],
                models.MonitoringItem.is_deleted == False,
            ),
        ))

    for selector, query in target_checks:
        if (await db.execute(query)).scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="Embedded target not found")


def _embedded_knowledge_projection(entry: models.KnowledgeEntry) -> dict:
    """Return the title/index projection used by released workspaces."""
    return {
        "id": entry.id,
        "created_at": entry.created_at,
        "updated_at": entry.updated_at,
        "category": entry.category,
        "title": entry.title,
        "content": entry.content,
        "content_json": deepcopy(entry.content_json or {}),
        "question_context": entry.question_context,
        "is_answered": bool(entry.is_answered),
        "verified_by": entry.verified_by,
        "tags": list(entry.tags or []),
        "impacted_systems": list(entry.impacted_systems or []),
        "linked_device_ids": list(entry.linked_device_ids or []),
        "status": entry.status,
        "metadata_json": normalize_metadata({"metadata_json": entry.metadata_json}, entry.metadata_json),
        "is_deleted": bool(entry.is_deleted),
        "qa_threads": [],
    }


async def _embedded_entry_is_in_scope(
    entry: models.KnowledgeEntry,
    *,
    consumer: str | None,
    device_id: int | None,
    service_id: int | None,
    monitoring_id: int | None,
    db: AsyncSession,
) -> bool:
    metadata = normalize_metadata({"metadata_json": entry.metadata_json}, entry.metadata_json)
    links = metadata.get("links", {})
    device_match = device_id is not None and device_id in (entry.linked_device_ids or [])
    service_match = service_id is not None and service_id in (links.get("service_ids", []) or [])
    monitoring_match = monitoring_id is not None and monitoring_id in (links.get("monitoring_ids", []) or [])

    if consumer == "assets":
        return device_match
    if consumer == "services":
        return service_match

    if consumer == "monitoring" and monitoring_id is not None:
        if monitoring_match:
            return True
        recovery_query = select(models.MonitoringItem.recovery_docs).where(
            models.MonitoringItem.id == monitoring_id,
            models.MonitoringItem.is_deleted == False,
        )
        monitoring_rows = (await db.execute(recovery_query)).scalars().all()
        recovery_ids: set[int] = set()
        for docs in monitoring_rows:
            for doc in (docs or []):
                raw_id = doc.get("id") if isinstance(doc, dict) else doc
                try:
                    if raw_id is not None:
                        recovery_ids.add(int(raw_id))
                except (TypeError, ValueError):
                    continue
        monitoring_match = entry.id in recovery_ids

    if consumer in {"monitoring", "network"}:
        return monitoring_match if consumer == "monitoring" else device_match
    return False

@router.get("", response_model=List[schemas.KnowledgeEntryResponse])
async def get_entries(
    category: Optional[str] = None,
    search: Optional[str] = None,
    device_id: Optional[int] = None,
    service_id: Optional[int] = None,
    monitoring_id: Optional[int] = None,
    far_id: Optional[int] = None,
    research_id: Optional[int] = None,
    vendor_id: Optional[int] = None,
    project_id: Optional[int] = None,
    request: Request = None,
    embedded_consumer: Optional[str] = None,
    _policy: dict = Depends(require_module_access("knowledge", allow_embedded=True)),
    db: AsyncSession = Depends(get_db)
):
    await _require_embedded_targets(request, db)
    query = select(models.KnowledgeEntry).filter(models.KnowledgeEntry.is_deleted == False).options(
        selectinload(models.KnowledgeEntry.qa_threads).selectinload(models.KnowledgeQA.replies)
    )
    
    if category:
        query = query.filter(models.KnowledgeEntry.category == category)
    
    result = await db.execute(query.order_by(models.KnowledgeEntry.updated_at.desc()))
    entries = result.scalars().all()

    if device_id is not None:
        entries = [entry for entry in entries if device_id in (entry.linked_device_ids or [])]

    def matches_link(entry: models.KnowledgeEntry, link_key: str, target_id: Optional[int]) -> bool:
        if target_id is None:
            return True
        metadata = normalize_metadata({"metadata_json": entry.metadata_json}, entry.metadata_json)
        return target_id in (metadata.get("links", {}).get(link_key, []) or [])

    entries = [
        entry for entry in entries
        if matches_link(entry, "service_ids", service_id)
        and matches_link(entry, "monitoring_ids", monitoring_id)
        and matches_link(entry, "far_ids", far_id)
        and matches_link(entry, "research_ids", research_id)
        and matches_link(entry, "vendor_ids", vendor_id)
        and matches_link(entry, "project_ids", project_id)
    ]

    if getattr(request.state, "sysgrid_embedded_projection", None):
        entries = [
            entry for entry in entries
            if await _embedded_entry_is_in_scope(
                entry,
                consumer=embedded_consumer,
                device_id=device_id,
                service_id=service_id,
                monitoring_id=monitoring_id,
                db=db,
            )
        ]

    if search:
        search_term = search.lower()
        filtered_entries = []
        for entry in entries:
            if search_term in (await expand_entry_search_text(entry, db)).lower():
                filtered_entries.append(entry)
        entries = filtered_entries

    if getattr(request.state, "sysgrid_embedded_projection", None):
        return [_embedded_knowledge_projection(entry) for entry in entries]

    for entry in entries:
        entry.metadata_json = normalize_metadata({"metadata_json": entry.metadata_json}, entry.metadata_json)

    return entries

@router.get("/{entry_id}", response_model=schemas.KnowledgeEntryResponse)
async def get_entry(
    entry_id: int,
    request: Request,
    device_id: Optional[int] = None,
    service_id: Optional[int] = None,
    monitoring_id: Optional[int] = None,
    embedded_consumer: Optional[str] = None,
    _policy: dict = Depends(require_module_access("knowledge", allow_embedded=True)),
    db: AsyncSession = Depends(get_db),
):
    await _require_embedded_targets(request, db)
    result = await db.execute(
        select(models.KnowledgeEntry)
        .filter(models.KnowledgeEntry.id == entry_id)
        .options(selectinload(models.KnowledgeEntry.qa_threads).selectinload(models.KnowledgeQA.replies))
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Entry not found")
    if getattr(request.state, "sysgrid_embedded_projection", None):
        if not await _embedded_entry_is_in_scope(
            entry,
            consumer=embedded_consumer,
            device_id=device_id,
            service_id=service_id,
            monitoring_id=monitoring_id,
            db=db,
        ):
            raise HTTPException(404, "Entry not found")
    else:
        entry.metadata_json = normalize_metadata({"metadata_json": entry.metadata_json}, entry.metadata_json)
    return entry

@router.post("", response_model=schemas.KnowledgeEntryResponse)
async def create_entry(
    data: schemas.KnowledgeEntryCreate,
    request: Request,
    _policy: dict = Depends(require_module_access("knowledge")),
    db: AsyncSession = Depends(get_db),
):
    payload = data.model_dump()
    payload["metadata_json"] = normalize_metadata(payload)
    entry = models.KnowledgeEntry(**payload)
    entry.created_by_user_id = get_current_user_id(request)
    entry.metadata_json["version_history"].append(build_version_snapshot(entry, entry.metadata_json, "Initial version"))
    db.add(entry)
    try:
        await db.commit()
        # Re-fetch to ensure relationships are properly handled for the response model
        result = await db.execute(
            select(models.KnowledgeEntry)
            .filter(models.KnowledgeEntry.id == entry.id)
            .options(selectinload(models.KnowledgeEntry.qa_threads).selectinload(models.KnowledgeQA.replies))
        )
        return result.scalar_one()
    except Exception as e:
        await db.rollback()
        raise HTTPException(400, detail=str(e))

@router.put("/{entry_id}", response_model=schemas.KnowledgeEntryResponse)
async def update_entry(
    entry_id: int,
    data: schemas.KnowledgeEntryBase,
    _policy: dict = Depends(require_module_access("knowledge")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(models.KnowledgeEntry).filter(models.KnowledgeEntry.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry: raise HTTPException(404, "Entry not found")

    payload = data.model_dump(exclude_unset=True)
    normalized_metadata = normalize_metadata(payload, entry.metadata_json)

    for k, v in payload.items():
        if k == "metadata_json":
            continue
        setattr(entry, k, v)
    entry.metadata_json = normalized_metadata
    entry.metadata_json["version_history"].append(
        build_version_snapshot(entry, entry.metadata_json, payload.get("status", "Knowledge update"))
    )

    await db.commit()
    
    # Re-fetch with relationships
    result = await db.execute(
        select(models.KnowledgeEntry)
        .filter(models.KnowledgeEntry.id == entry_id)
        .options(selectinload(models.KnowledgeEntry.qa_threads).selectinload(models.KnowledgeQA.replies))
    )
    return result.scalar_one()

@router.delete("/{entry_id}")
async def delete_entry(
    entry_id: int,
    _policy: dict = Depends(require_module_access("knowledge")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(models.KnowledgeEntry).filter(models.KnowledgeEntry.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry: raise HTTPException(404, "Entry not found")
    
    entry.is_deleted = True
    await db.commit()
    return {"status": "success"}

# --- QA Thread Routes ---

@router.post("/qa", response_model=schemas.KnowledgeQAResponse)
async def add_qa_entry(
    data: schemas.KnowledgeQACreate,
    _policy: dict = Depends(require_module_access("knowledge")),
    db: AsyncSession = Depends(get_db),
):
    qa = models.KnowledgeQA(**data.model_dump())
    db.add(qa)
    await db.commit()
    
    # Re-fetch with relationships
    result = await db.execute(
        select(models.KnowledgeQA)
        .filter(models.KnowledgeQA.id == qa.id)
        .options(selectinload(models.KnowledgeQA.replies))
    )
    return result.scalar_one()

@router.put("/qa/{qa_id}", response_model=schemas.KnowledgeQAResponse)
async def update_qa_entry(
    qa_id: int,
    data: schemas.KnowledgeQABase,
    _policy: dict = Depends(require_module_access("knowledge")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(models.KnowledgeQA).filter(models.KnowledgeQA.id == qa_id))
    qa = result.scalar_one_or_none()
    if not qa: raise HTTPException(404, "QA entry not found")
    
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(qa, k, v)
        
    await db.commit()
    
    # Re-fetch with relationships
    result = await db.execute(
        select(models.KnowledgeQA)
        .filter(models.KnowledgeQA.id == qa_id)
        .options(selectinload(models.KnowledgeQA.replies))
    )
    return result.scalar_one()

@router.delete("/qa/{qa_id}")
async def delete_qa_entry(
    qa_id: int,
    _policy: dict = Depends(require_module_access("knowledge")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(models.KnowledgeQA).filter(models.KnowledgeQA.id == qa_id))
    qa = result.scalar_one_or_none()
    if not qa: raise HTTPException(404, "QA entry not found")
    
    qa.is_deleted = True
    await db.commit()
    return {"status": "success"}
