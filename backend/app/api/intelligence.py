from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update, or_, func
from sqlalchemy.orm import selectinload
from typing import List, Optional, Any, Dict
import json
import re
from ..database import get_db
from ..models import models
from ..schemas import schemas
from .utils import build_audit_log, filter_valid_columns
from .operational_bulk import (
    build_operational_bulk_summary,
    normalize_operational_bulk_ids,
    normalize_operational_bulk_payload,
    require_executable_operational_bulk,
)
from .module_policy import require_module_access

router = APIRouter(
    prefix="/intelligence",
    tags=["External Intelligence"],
    dependencies=[Depends(require_module_access("external"))],
)
IMMUTABLE_EXTERNAL_ENTITY_FIELDS = {"id", "created_at", "updated_at", "created_by_user_id"}
EXTERNAL_BULK_UPDATE_FIELDS = {"status", "environment", "criticality", "risk_rating"}
EXTERNAL_BULK_RATING_VALUES = {"Critical", "High", "Medium", "Low"}

async def log_audit(db: AsyncSession, request: Request, action: str, table: str, target_id: int, description: str, changes: Optional[Dict] = None):
    log = build_audit_log(
        request=request,
        action=action,
        target_table=table,
        target_id=str(target_id),
        description=description,
        changes=changes,
    )
    db.add(log)
    await db.commit()


async def _validate_internal_ownership(db: AsyncSession, payload: schemas.ExternalEntityBase):
    team = None
    if payload.internal_team_id is not None:
        team_res = await db.execute(select(models.Team).filter(models.Team.id == payload.internal_team_id))
        team = team_res.scalar_one_or_none()
        if not team:
            raise HTTPException(status_code=400, detail="Selected accountable team does not exist")
    if payload.internal_operator_id is not None:
        op_res = await db.execute(select(models.Operator).filter(models.Operator.id == payload.internal_operator_id))
        if not op_res.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Selected accountable operator does not exist")
    return team


def _normalize_external_payload(data: schemas.ExternalEntityBase, team: models.Team | None) -> dict[str, Any]:
    payload = data.model_dump()
    if payload["ownership_mode"] == "team":
        payload["owner_team"] = team.name if team else None
        payload["internal_operator_id"] = None
    else:
        payload["owner_team"] = None
        payload["internal_team_id"] = None
    return payload


def _normalize_contacts(entity: models.ExternalEntity) -> list[dict[str, Any]]:
    if entity.contacts_json:
        return entity.contacts_json
    legacy_contacts = entity.poc_json or []
    normalized = []
    for index, contact in enumerate(legacy_contacts):
        full_name = " ".join(part for part in [contact.get("first_name"), contact.get("last_name")] if part).strip()
        normalized.append({
            "role": "Primary" if index == 0 else "Operational",
            "full_name": full_name or contact.get("id") or "Unspecified Contact",
            "email": contact.get("email"),
            "phone": contact.get("phone"),
            "external_person_id": contact.get("id"),
            "is_primary": index == 0,
            "is_escalation": False,
        })
    return normalized


def _normalize_secret(secret: models.ExternalEntitySecret) -> dict[str, Any]:
    secret_type = secret.secret_type or ("SharedSecret" if secret.password else "VaultReference")
    return {
        "id": secret.id,
        "created_at": secret.created_at,
        "updated_at": secret.updated_at,
        "created_by_user_id": secret.created_by_user_id,
        "external_entity_id": secret.external_entity_id,
        "secret_label": secret.secret_label or secret.note or secret.username or f"secret-{secret.id}",
        "secret_type": secret_type,
        "username": secret.username,
        "vault_provider": secret.vault_provider,
        "vault_path": secret.vault_path or (f"legacy-inline://external-secrets/{secret.id}" if secret.password else None),
        "note": secret.note,
        "credential_status": secret.credential_status or "Active",
        "rotation_frequency_days": secret.rotation_frequency_days,
        "password_last_rotated_at": secret.password_last_rotated_at,
    }


async def _enrich_entity_response(db: AsyncSession, entity: models.ExternalEntity) -> schemas.ExternalEntityResponse:
    metadata = entity.metadata_json or {}
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except Exception:
            metadata = {}
    normalized_payload = {
        "id": entity.id,
        "created_at": entity.created_at,
        "updated_at": entity.updated_at,
        "created_by_user_id": entity.created_by_user_id,
        "name": entity.name,
        "external_key": entity.external_key or re.sub(r"[^a-z0-9._:-]+", "-", (entity.name or "").strip().lower()).strip("-") or f"external-{entity.id}",
        "aliases_json": entity.aliases_json or [],
        "type": entity.type,
        "subtype": entity.subtype,
        "owner_organization": entity.owner_organization,
        "owner_team": entity.owner_team,
        "ownership_mode": entity.ownership_mode or ("individual" if entity.internal_operator_id else "team"),
        "internal_team_id": entity.internal_team_id,
        "internal_operator_id": entity.internal_operator_id,
        "status": entity.status or "Planned",
        "environment": entity.environment or "Production",
        "description": entity.description,
        "notes": entity.notes,
        "contacts_json": _normalize_contacts(entity),
        "business_purpose": entity.business_purpose or metadata.get("business_purpose"),
        "criticality": entity.criticality or metadata.get("criticality") or "Low",
        "dependency_tier": entity.dependency_tier or metadata.get("dependency_tier") or "Tier 3",
        "data_classification": entity.data_classification,
        "integration_mode": entity.integration_mode or ("API" if entity.type == "API" else None),
        "primary_endpoint_url": entity.primary_endpoint_url or metadata.get("base_url"),
        "secondary_endpoint_url": entity.secondary_endpoint_url,
        "auth_method": entity.auth_method or metadata.get("auth_method") or metadata.get("auth_type"),
        "protocol_family": entity.protocol_family,
        "port_override": entity.port_override,
        "supports_inbound": bool(entity.supports_inbound),
        "supports_outbound": bool(entity.supports_outbound),
        "source_system": entity.source_system,
        "source_record_id": entity.source_record_id,
        "risk_rating": entity.risk_rating or "Low",
        "contains_customer_data": bool(entity.contains_customer_data),
        "contains_credentials": bool(entity.contains_credentials),
        "stores_pii": bool(entity.stores_pii),
        "internet_exposed": bool(entity.internet_exposed),
        "third_party_assessment_status": entity.third_party_assessment_status,
        "metadata_json": metadata,
        "is_deleted": bool(entity.is_deleted),
        "secrets": [_normalize_secret(secret) for secret in (entity.secrets or [])],
    }
    if normalized_payload["ownership_mode"] == "team" and normalized_payload["internal_team_id"] is None:
        normalized_payload["ownership_mode"] = "individual" if normalized_payload["internal_operator_id"] else "team"
    response = schemas.ExternalEntityResponse.model_validate(normalized_payload)
    if entity.internal_team_id:
        team_res = await db.execute(select(models.Team.name).filter(models.Team.id == entity.internal_team_id))
        response.internal_team_name = team_res.scalar_one_or_none()
    if entity.internal_operator_id:
        op_res = await db.execute(
            select(models.Operator.full_name, models.Operator.username, models.Operator.external_id)
            .filter(models.Operator.id == entity.internal_operator_id)
        )
        operator = op_res.first()
        if operator:
            response.internal_operator_name = operator[0] or operator[1] or operator[2]
            response.internal_operator_external_id = operator[2]
    return response


async def _validate_unique_external_key(db: AsyncSession, external_key: str, entity_id: Optional[int] = None):
    query = select(models.ExternalEntity).filter(models.ExternalEntity.external_key == external_key)
    if entity_id is not None:
        query = query.filter(models.ExternalEntity.id != entity_id)
    res = await db.execute(query)
    if res.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="External key already exists")


async def _validate_unique_external_identity(
    db: AsyncSession,
    payload: schemas.ExternalEntityBase,
    *,
    entity_id: Optional[int] = None,
) -> None:
    normalized_name = payload.name.strip().lower()
    normalized_type = payload.type.strip()
    normalized_owner_org = (payload.owner_organization or "").strip().lower() or None
    query = select(models.ExternalEntity).filter(
        func.lower(models.ExternalEntity.name) == normalized_name,
        models.ExternalEntity.type == normalized_type,
        models.ExternalEntity.is_deleted == False,
    )
    if normalized_owner_org is None:
        query = query.filter(or_(models.ExternalEntity.owner_organization == None, models.ExternalEntity.owner_organization == ""))
    else:
        query = query.filter(func.lower(models.ExternalEntity.owner_organization) == normalized_owner_org)
    if entity_id is not None:
        query = query.filter(models.ExternalEntity.id != entity_id)
    existing = (await db.execute(query)).scalar_one_or_none()
    if existing:
        raise HTTPException(409, detail="An active external entity with the same name, type, and owner organization already exists")


async def _validate_restoreable_external_entity(db: AsyncSession, entity: models.ExternalEntity) -> None:
    if entity.ownership_mode == "team":
        if entity.internal_team_id is None:
            raise HTTPException(409, detail="Archived team-owned external entity cannot be restored without an accountable internal team")
        team = await db.scalar(select(models.Team).where(models.Team.id == entity.internal_team_id, models.Team.is_archived == False))
        if team is None:
            raise HTTPException(409, detail="Archived team-owned external entity cannot be restored because the accountable team is missing or archived")
    elif entity.ownership_mode == "individual":
        if entity.internal_operator_id is None:
            raise HTTPException(409, detail="Archived individually owned external entity cannot be restored without an accountable operator")
        operator = await db.scalar(select(models.Operator.id).where(models.Operator.id == entity.internal_operator_id))
        if operator is None:
            raise HTTPException(409, detail="Archived individually owned external entity cannot be restored because the accountable operator is missing")


def _external_restore_identity_payload(entity: models.ExternalEntity) -> schemas.ExternalEntityCreate:
    return schemas.ExternalEntityCreate.model_validate({
        "name": entity.name,
        "external_key": entity.external_key,
        "aliases_json": entity.aliases_json or [],
        "type": entity.type,
        "subtype": entity.subtype,
        "owner_organization": entity.owner_organization,
        "owner_team": entity.owner_team,
        "ownership_mode": entity.ownership_mode,
        "internal_team_id": entity.internal_team_id,
        "internal_operator_id": entity.internal_operator_id,
        "status": entity.status,
        "environment": entity.environment,
        "description": entity.description,
        "notes": entity.notes,
        "contacts_json": _normalize_contacts(entity),
        "business_purpose": entity.business_purpose,
        "criticality": entity.criticality,
        "dependency_tier": entity.dependency_tier,
        "data_classification": entity.data_classification,
        "integration_mode": entity.integration_mode,
        "primary_endpoint_url": entity.primary_endpoint_url,
        "secondary_endpoint_url": entity.secondary_endpoint_url,
        "auth_method": entity.auth_method,
        "protocol_family": entity.protocol_family,
        "port_override": entity.port_override,
        "supports_inbound": bool(entity.supports_inbound),
        "supports_outbound": bool(entity.supports_outbound),
        "source_system": entity.source_system,
        "source_record_id": entity.source_record_id,
        "risk_rating": entity.risk_rating,
        "contains_customer_data": bool(entity.contains_customer_data),
        "contains_credentials": bool(entity.contains_credentials),
        "stores_pii": bool(entity.stores_pii),
        "internet_exposed": bool(entity.internet_exposed),
        "third_party_assessment_status": entity.third_party_assessment_status,
        "metadata_json": entity.metadata_json or {},
    })


async def _validate_external_restore_contract(db: AsyncSession, entity: models.ExternalEntity) -> None:
    await _validate_unique_external_key(db, entity.external_key, entity.id)
    await _validate_restoreable_external_entity(db, entity)
    await _validate_unique_external_identity(
        db,
        _external_restore_identity_payload(entity),
        entity_id=entity.id,
    )


def _normalize_external_link_identity(data: schemas.ExternalLinkBase) -> dict[str, Any]:
    return {
        "external_entity_id": data.external_entity_id,
        "device_id": data.device_id,
        "service_id": data.service_id,
        "protocol": data.protocol,
        "port": str(data.port) if data.port is not None else None,
        "host_or_fqdn": (data.host_or_fqdn or "").strip() or None,
        "path_or_resource": (data.path_or_resource or "").strip() or None,
    }


async def _validate_unique_external_link(
    db: AsyncSession,
    data: schemas.ExternalLinkBase,
    *,
    exclude_link_id: Optional[int] = None,
) -> None:
    identity = _normalize_external_link_identity(data)
    query = select(models.ExternalLink).filter(
        models.ExternalLink.external_entity_id == identity["external_entity_id"],
        models.ExternalLink.device_id == identity["device_id"],
        models.ExternalLink.service_id == identity["service_id"],
        models.ExternalLink.protocol == identity["protocol"],
        models.ExternalLink.port == identity["port"],
        models.ExternalLink.host_or_fqdn == identity["host_or_fqdn"],
        models.ExternalLink.path_or_resource == identity["path_or_resource"],
        models.ExternalLink.link_status == "Active",
    )
    if exclude_link_id is not None:
        query = query.filter(models.ExternalLink.id != exclude_link_id)
    duplicate = (await db.execute(query)).scalar_one_or_none()
    if duplicate:
        raise HTTPException(409, "An active link with the same shape already exists")

# --- External Entities ---

@router.get("/entities", response_model=List[schemas.ExternalEntityResponse])
async def get_entities(include_deleted: bool = False, db: AsyncSession = Depends(get_db)):
    query = select(models.ExternalEntity).options(selectinload(models.ExternalEntity.secrets))
    if not include_deleted:
        query = query.filter(models.ExternalEntity.is_deleted == False)
    result = await db.execute(query)
    entities = result.scalars().all()
    return [await _enrich_entity_response(db, entity) for entity in entities]

@router.post("/entities", response_model=schemas.ExternalEntityResponse)
async def create_entity(data: schemas.ExternalEntityCreate, request: Request, db: AsyncSession = Depends(get_db)):
    team = await _validate_internal_ownership(db, data)
    await _validate_unique_external_key(db, data.external_key or "")
    await _validate_unique_external_identity(db, data)
    db_obj = models.ExternalEntity(**_normalize_external_payload(data, team))
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    await log_audit(db, request, "CREATE", "external_entities", db_obj.id, f"Created external entity: {db_obj.name}")
    result = await db.execute(
        select(models.ExternalEntity)
        .filter(models.ExternalEntity.id == db_obj.id)
        .options(selectinload(models.ExternalEntity.secrets))
    )
    return await _enrich_entity_response(db, result.scalar_one())

@router.put("/entities/{entity_id}", response_model=schemas.ExternalEntityResponse)
async def update_entity(entity_id: int, data: schemas.ExternalEntityUpdate, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.ExternalEntity).filter(models.ExternalEntity.id == entity_id).options(selectinload(models.ExternalEntity.secrets)))
    obj = result.scalar_one_or_none()
    if not obj: raise HTTPException(404, "Entity not found")

    team = await _validate_internal_ownership(db, data)
    await _validate_unique_external_key(db, data.external_key or "", entity_id)
    await _validate_unique_external_identity(db, data, entity_id=entity_id)

    clean_data = filter_valid_columns(
        models.ExternalEntity,
        _normalize_external_payload(data, team),
        exclude=IMMUTABLE_EXTERNAL_ENTITY_FIELDS,
    )
    try:
        body_json = await request.json()
        sent_keys = set(body_json.keys())
    except Exception:
        sent_keys = set()
    if "ownership_mode" in sent_keys or "internal_team_id" in sent_keys or "internal_operator_id" in sent_keys:
        sent_keys.update(["owner_team", "internal_team_id", "internal_operator_id"])
    clean_data = {k: v for k, v in clean_data.items() if k in sent_keys}
    for k, v in clean_data.items():
        setattr(obj, k, v)
    
    await db.commit()
    await db.refresh(obj)
    await log_audit(db, request, "UPDATE", "external_entities", entity_id, f"Updated external entity: {obj.name}", clean_data)
    refreshed = await db.execute(
        select(models.ExternalEntity)
        .filter(models.ExternalEntity.id == entity_id)
        .options(selectinload(models.ExternalEntity.secrets))
    )
    return await _enrich_entity_response(db, refreshed.scalar_one())

@router.post("/entities/bulk-action")
async def bulk_entity_action(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    ids = normalize_operational_bulk_ids(data.get("ids"))
    action = str(data.get("action") or "").strip().lower()
    payload = normalize_operational_bulk_payload(data.get("payload"))
    dry_run = data.get("dry_run", False)
    if not isinstance(dry_run, bool):
        raise HTTPException(status_code=400, detail="dry_run must be a boolean")
    if action not in {"update", "delete", "restore", "purge"}:
        raise HTTPException(status_code=400, detail=f"Unsupported bulk action: {action}")

    clean_update: dict[str, Any] = {}
    if action == "update":
        clean_update = {key: value for key, value in payload.items() if key in EXTERNAL_BULK_UPDATE_FIELDS}
        if not clean_update:
            raise HTTPException(status_code=400, detail="Bulk update requires a supported field")
        for field in ("status", "environment"):
            if field in clean_update:
                clean_update[field] = str(clean_update[field] or "").strip()
                if not clean_update[field]:
                    raise HTTPException(status_code=400, detail=f"{field.replace('_', ' ').title()} cannot be blank")
        for field in ("criticality", "risk_rating"):
            if field in clean_update and clean_update[field] not in EXTERNAL_BULK_RATING_VALUES:
                raise HTTPException(status_code=400, detail=f"Unsupported {field.replace('_', ' ')} value")

    result = await db.execute(select(models.ExternalEntity).filter(models.ExternalEntity.id.in_(ids)))
    entities = result.scalars().all()
    entities_by_id = {entity.id: entity for entity in entities}

    linked_ids: set[int] = set()
    secret_ids: set[int] = set()
    if action == "purge" and entities:
        link_rows = await db.execute(
            select(models.ExternalLink.external_entity_id)
            .where(models.ExternalLink.external_entity_id.in_(list(entities_by_id)))
        )
        linked_ids = set(link_rows.scalars().all())
        secret_rows = await db.execute(
            select(models.ExternalEntitySecret.external_entity_id)
            .where(models.ExternalEntitySecret.external_entity_id.in_(list(entities_by_id)))
        )
        secret_ids = set(secret_rows.scalars().all())

    changed_ids: list[int] = []
    unchanged_ids: list[int] = []
    blockers: list[dict[str, Any]] = []
    for entity_id in ids:
        entity = entities_by_id.get(entity_id)
        if entity is None:
            continue
        blocked = False
        if action == "update":
            changed = any(getattr(entity, key) != value for key, value in clean_update.items())
        elif action == "delete":
            changed = not bool(entity.is_deleted)
        elif action == "restore":
            changed = bool(entity.is_deleted)
            if changed:
                try:
                    await _validate_external_restore_contract(db, entity)
                except HTTPException as exc:
                    blockers.append({"id": entity.id, "name": entity.name, "reason": str(exc.detail)})
                    blocked = True
        else:
            changed = bool(entity.is_deleted)
            reasons: list[str] = []
            if not entity.is_deleted:
                reasons.append("Archive this record before permanent purge")
            if entity.id in linked_ids:
                reasons.append("Active connectivity links must be removed")
            if entity.id in secret_ids:
                reasons.append("Registered credentials must be removed")
            if reasons:
                blockers.append({"id": entity.id, "name": entity.name, "reason": "; ".join(reasons)})
                blocked = True
        if blocked:
            continue
        (changed_ids if changed else unchanged_ids).append(entity_id)

    summary = build_operational_bulk_summary(
        action=action,
        selected_ids=ids,
        matched_ids=entities_by_id.keys(),
        changed_ids=changed_ids,
        unchanged_ids=unchanged_ids,
        blockers=blockers,
    )
    if dry_run:
        return {"status": "preview", **summary}

    require_executable_operational_bulk(summary)
    if not changed_ids:
        return {"status": "no_op", **summary}

    if action == "update":
        for entity_id in changed_ids:
            entity = entities_by_id[entity_id]
            for key, value in clean_update.items():
                setattr(entity, key, value)
    elif action == "delete":
        for entity_id in changed_ids:
            entities_by_id[entity_id].is_deleted = True
    elif action == "restore":
        for entity_id in changed_ids:
            entities_by_id[entity_id].is_deleted = False
    else:
        for entity_id in changed_ids:
            await db.delete(entities_by_id[entity_id])

    db.add(build_audit_log(
        request=request,
        action=f"BULK_{action.upper()}",
        target_table="external_entities",
        target_id="bulk",
        description=f"Applied bulk external entity action: {action}",
        changes={
            "ids": changed_ids,
            "payload": clean_update if action == "update" else {},
            "selected_count": summary["selected_count"],
            "changed_count": summary["changed_count"],
            "unchanged_count": summary["unchanged_count"],
        },
    ))
    await db.commit()
    return {"status": "success", **summary}


@router.post("/entities/{entity_id}/restore")
async def restore_entity(entity_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.ExternalEntity).filter(models.ExternalEntity.id == entity_id))
    obj = result.scalar_one_or_none()
    if not obj: raise HTTPException(404, "Entity not found")
    await _validate_external_restore_contract(db, obj)

    obj.is_deleted = False
    await db.commit()
    await log_audit(db, request, "RESTORE", "external_entities", entity_id, f"Restored external entity: {obj.name}")
    return {"status": "success"}

@router.delete("/entities/{entity_id}")
async def delete_entity(entity_id: int, request: Request, purge: bool = False, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.ExternalEntity).filter(models.ExternalEntity.id == entity_id))
    obj = result.scalar_one_or_none()
    if not obj: raise HTTPException(404, "Entity not found")
    
    if purge:
        # Check for links
        link_check = await db.execute(select(models.ExternalLink).filter(models.ExternalLink.external_entity_id == entity_id))
        if link_check.scalars().first():
            raise HTTPException(400, "Cannot purge entity with active connectivity links")
        secret_check = await db.execute(select(models.ExternalEntitySecret).filter(models.ExternalEntitySecret.external_entity_id == entity_id))
        if secret_check.scalars().first():
            raise HTTPException(400, "Cannot purge entity with registered credentials")
        await db.delete(obj)
        await log_audit(db, request, "PURGE", "external_entities", entity_id, f"Permanently purged external entity: {obj.name}")
    else:
        obj.is_deleted = True
        await log_audit(db, request, "DELETE", "external_entities", entity_id, f"Soft-deleted external entity: {obj.name}")
    
    await db.commit()
    return {"status": "success"}

# --- External Entity Secrets ---

@router.post("/entities/{entity_id}/secrets", response_model=schemas.ExternalEntitySecretResponse)
async def add_entity_secret(entity_id: int, data: schemas.ExternalEntitySecretBase, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.ExternalEntity).filter(models.ExternalEntity.id == entity_id))
    obj = result.scalar_one_or_none()
    if not obj: raise HTTPException(404, "Entity not found")
    if obj.is_deleted:
        raise HTTPException(400, "Cannot attach credentials to an archived external entity")
    
    secret = models.ExternalEntitySecret(
        external_entity_id=entity_id,
        **data.model_dump()
    )
    db.add(secret)
    await db.commit()
    await db.refresh(secret)
    await log_audit(db, request, "CREATE", "external_entity_secrets", secret.id, f"Added credential for external entity: {obj.name}")
    return secret

@router.delete("/entities/{entity_id}/secrets/{secret_id}")
async def delete_entity_secret(entity_id: int, secret_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(models.ExternalEntitySecret).filter(
        models.ExternalEntitySecret.id == secret_id,
        models.ExternalEntitySecret.external_entity_id == entity_id
    ))
    secret = res.scalar_one_or_none()
    if not secret: raise HTTPException(404, "Secret not found")
    
    await db.delete(secret)
    await db.commit()
    await log_audit(db, request, "DELETE", "external_entity_secrets", secret_id, f"Revoked credential for external entity ID: {entity_id}")
    return {"status": "success"}

# --- External Links ---

@router.get("/links", response_model=List[schemas.ExternalLinkResponse])
async def get_links(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.ExternalLink))
    items = result.scalars().all()

    entity_ids = {item.external_entity_id for item in items if item.external_entity_id}
    device_ids = {item.device_id for item in items if item.device_id}
    service_ids = {item.service_id for item in items if item.service_id}

    entity_map = {}
    device_map = {}
    service_map = {}
    if entity_ids:
        entity_result = await db.execute(select(models.ExternalEntity.id, models.ExternalEntity.name).where(models.ExternalEntity.id.in_(entity_ids)))
        entity_map = {entity_id: name for entity_id, name in entity_result.all()}
    if device_ids:
        device_result = await db.execute(select(models.Device.id, models.Device.name).where(models.Device.id.in_(device_ids)))
        device_map = {device_id: name for device_id, name in device_result.all()}
    if service_ids:
        service_result = await db.execute(select(models.LogicalService.id, models.LogicalService.name).where(models.LogicalService.id.in_(service_ids)))
        service_map = {service_id: name for service_id, name in service_result.all()}

    response = []
    for item in items:
        resp = schemas.ExternalLinkResponse.model_validate(item)
        resp.external_entity_name = entity_map.get(item.external_entity_id)
        resp.device_name = device_map.get(item.device_id)
        resp.service_name = service_map.get(item.service_id) if item.service_id else None
        response.append(resp)
    return response

@router.post("/links", response_model=schemas.ExternalLinkResponse)
async def create_link(data: schemas.ExternalLinkCreate, request: Request, db: AsyncSession = Depends(get_db)):
    entity_res = await db.execute(select(models.ExternalEntity).filter(models.ExternalEntity.id == data.external_entity_id))
    entity = entity_res.scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "External entity not found")
    if entity.is_deleted:
        raise HTTPException(400, "Cannot create a link for an archived external entity")
    device_res = await db.execute(select(models.Device).filter(models.Device.id == data.device_id))
    if not device_res.scalar_one_or_none():
        raise HTTPException(404, "Device not found")
    if data.service_id is not None:
        service_res = await db.execute(select(models.LogicalService).filter(models.LogicalService.id == data.service_id))
        service = service_res.scalar_one_or_none()
        if not service:
            raise HTTPException(404, "Logical service not found")
        if service.device_id != data.device_id:
            raise HTTPException(400, "Selected service does not belong to the selected asset")
    await _validate_unique_external_link(db, data)
    db_obj = models.ExternalLink(**data.model_dump())
    db_obj.port = str(data.port) if data.port is not None else None
    db_obj.host_or_fqdn = (data.host_or_fqdn or "").strip() or None
    db_obj.path_or_resource = (data.path_or_resource or "").strip() or None
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    await log_audit(db, request, "CREATE", "external_links", db_obj.id, f"Established external link to {db_obj.purpose}")
    return db_obj

@router.delete("/links/{link_id}")
async def delete_link(link_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.ExternalLink).filter(models.ExternalLink.id == link_id))
    obj = result.scalar_one_or_none()
    if not obj: raise HTTPException(404, "Link not found")
    
    await db.delete(obj)
    await db.commit()
    await log_audit(db, request, "DELETE", "external_links", link_id, "Severed external link")
    return {"status": "success"}
