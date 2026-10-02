from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, or_
from sqlalchemy.orm import joinedload
from sqlalchemy.exc import IntegrityError
from typing import List, Optional
from ..database import get_db
from ..models import models
from .authorization import require_capability
from .utils import build_audit_log, filter_valid_columns, get_audit_actor, normalize_json_list, normalize_json_object, parse_iso_date
from .operational_bulk import (
    build_operational_bulk_summary,
    normalize_operational_bulk_ids,
    normalize_operational_bulk_payload,
    require_executable_operational_bulk,
)
from .module_policy import require_module_access
from .asset_links import require_relationship_asset

router = APIRouter(
    prefix="/logical-services",
    tags=["Logical Services"],
    dependencies=[Depends(require_module_access("services"))],
)
IMMUTABLE_SERVICE_FIELDS = {"id", "created_at", "updated_at", "created_by_user_id"}
SERVICE_BULK_UPDATE_FIELDS = {"status", "service_type", "environment", "version", "device_id"}


def _service_scope(request: Request):
    owned_devices = select(models.Device.id).where(models.Device.tenant_id == request.state.tenant_id)
    return or_(models.LogicalService.device_id.is_(None), models.LogicalService.device_id.in_(owned_devices))


async def _get_owned_service(request: Request, db: AsyncSession, service_id: int):
    if not 1 <= service_id <= 2 ** 63 - 1:
        raise HTTPException(404, 'Service not found')
    service = await db.scalar(select(models.LogicalService).where(
        models.LogicalService.id == service_id, _service_scope(request),
    ))
    if service is None:
        raise HTTPException(404, 'Service not found')
    return service


def _normalize_service_device_id(value):
    if value is None:
        return None
    if isinstance(value, str) and value.strip().isascii() and value.strip().isdigit():
        try:
            value = int(value.strip())
        except ValueError:
            raise HTTPException(400, 'Device ID must be a positive integer or null')
    if isinstance(value, bool) or not isinstance(value, int):
        raise HTTPException(400, 'Device ID must be a positive integer or null')
    if not 1 <= value <= 2 ** 63 - 1:
        raise HTTPException(404, 'Asset not found')
    return value


def canonicalize_service_status(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if normalized.lower() == "active":
        return "Existing"
    return normalized


def serialize_service_secret(secret: models.ServiceSecret, *, include_secret_values: bool = False):
    return {
        "id": secret.id,
        "service_id": secret.service_id,
        "username": secret.username,
        # ``include_secret_values`` is retained for request compatibility, but
        # legacy reusable credentials are never serialized by this API.
        "password": None,
        "has_password": bool(secret.password),
        "note": secret.note,
    }


def serialize_service(service: models.LogicalService, device_name: str, *, include_secret_values: bool = False):
    return {
        "id": service.id,
        "name": service.name,
        "service_type": service.service_type,
        "status": canonicalize_service_status(service.status),
        "version": service.version,
        "environment": service.environment,
        "device_id": service.device_id,
        "device_name": device_name,
        "config_json": normalize_json_object(service.config_json),
        "custom_attributes": normalize_json_object(service.custom_attributes),
        "logic_json": normalize_json_list(service.logic_json),
        "is_deleted": service.is_deleted,
        "created_at": service.created_at.isoformat() if service.created_at else None,
        "updated_at": service.updated_at.isoformat() if service.updated_at else None,
        "created_by_user_id": service.created_by_user_id,
        "purchase_type": service.purchase_type,
        "license_key": service.license_key,
        "purchase_date": service.purchase_date.isoformat() if service.purchase_date else None,
        "expiry_date": service.expiry_date.isoformat() if service.expiry_date else None,
        "installation_date": service.installation_date.isoformat() if service.installation_date else None,
        "purpose": service.purpose,
        "documentation_link": service.documentation_link,
        "manufacturer": service.manufacturer,
        "supplier": service.supplier,
        "cost": service.cost,
        "currency": service.currency,
        "secret_count": len(service.secrets or []),
        "secrets": [serialize_service_secret(sc, include_secret_values=include_secret_values) for sc in service.secrets]
    }


def summarize_service(service: models.LogicalService, device_name: str):
    return {
        "id": service.id,
        "name": service.name,
        "service_type": service.service_type,
        "status": canonicalize_service_status(service.status),
        "version": service.version,
        "environment": service.environment,
        "device_id": service.device_id,
        "device_name": device_name,
        "is_deleted": service.is_deleted,
        "secret_count": len(service.secrets or []),
        "config_key_count": len(normalize_json_object(service.config_json)),
        "custom_attribute_count": len(normalize_json_object(service.custom_attributes)),
    }


def normalize_service_payload(data: dict) -> dict:
    clean_data = filter_valid_columns(models.LogicalService, data, exclude=IMMUTABLE_SERVICE_FIELDS)
    if "device_id" in clean_data:
        clean_data["device_id"] = _normalize_service_device_id(clean_data["device_id"])
    if "status" in clean_data:
        clean_data["status"] = canonicalize_service_status(clean_data.get("status")) or "Existing"
    for field in ("config_json", "custom_attributes"):
        if field in clean_data:
            clean_data[field] = normalize_json_object(clean_data[field])
    if "logic_json" in clean_data:
        clean_data["logic_json"] = normalize_json_list(clean_data["logic_json"])
    for date_field in ["purchase_date", "expiry_date", "installation_date"]:
        if date_field in clean_data:
            clean_data[date_field] = parse_iso_date(clean_data.get(date_field))
    return clean_data


async def sync_device_os_state(device_id: Optional[int], db: AsyncSession):
    if not device_id:
        return
    result = await db.execute(select(models.Device).filter(models.Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        return

    service_res = await db.execute(
        select(models.LogicalService)
        .filter(
            models.LogicalService.device_id == device_id,
            models.LogicalService.service_type == "OS",
            models.LogicalService.is_deleted == False
        )
        .order_by(models.LogicalService.updated_at.desc(), models.LogicalService.id.desc())
    )
    active_os_service = service_res.scalars().first()
    if active_os_service:
        device.os_name = active_os_service.name
        device.os_version = active_os_service.version
    else:
        device.os_name = None
        device.os_version = None

@router.get("")
async def get_services(
    request: Request,
    device_id: Optional[int] = None,
    include_deleted: bool = False,
    projection: str = "full",
    include_secret_values: bool = False,
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import selectinload
    query = select(models.LogicalService).where(_service_scope(request)).options(selectinload(models.LogicalService.secrets))
    if device_id is not None:
        await require_relationship_asset(request, db, device_id)
        query = query.filter(models.LogicalService.device_id == device_id)
    if not include_deleted:
        query = query.filter(models.LogicalService.is_deleted == False)
    
    result = await db.execute(query)
    services = result.scalars().all()
    
    if not services:
        return []

    device_ids = {s.device_id for s in services if s.device_id}
    devices = {}
    if device_ids:
        dev_res = await db.execute(select(models.Device).filter(models.Device.id.in_(list(device_ids))))
        devices = {d.id: d for d in dev_res.scalars().all()}
    
    final_result = []
    for s in services:
        device_name = "Floating / Unmounted"
        if s.device_id:
            dev = devices.get(s.device_id)
            if dev: device_name = dev.name
        if projection == "summary":
            final_result.append(summarize_service(s, device_name))
        else:
            final_result.append(serialize_service(s, device_name, include_secret_values=include_secret_values))
    return final_result


@router.get("/summary")
async def get_services_summary(
    request: Request,
    device_id: Optional[int] = None,
    include_deleted: bool = False,
    db: AsyncSession = Depends(get_db),
):
    return await get_services(request=request, device_id=device_id, include_deleted=include_deleted, projection="summary", db=db)

@router.post("/{service_id}/secrets")
async def add_service_secret(
    service_id: int,
    data: dict,
    request: Request,
    _secret_admin: models.Operator = Depends(require_capability("secrets", 3)),
    db: AsyncSession = Depends(get_db),
):
    if "password" in data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Reusable secret material cannot be accepted as plaintext. "
                "Use the approved future secret-provider boundary."
            ),
        )

    svc = await _get_owned_service(request, db, service_id)
    
    secret = models.ServiceSecret(
        service_id=service_id,
        username=data.get("username"),
        note=data.get("note")
    )
    db.add(secret)
    db.add(build_audit_log(
        request=request,
        action="CREATE_SECRET",
        target_table="service_secrets",
        target_id=str(service_id),
        description=f"Added service secret for service {svc.name}",
        changes={"service_id": service_id, "username": data.get("username"), "has_password": bool(data.get("password"))},
    ))
    await db.commit()
    await db.refresh(secret)
    return serialize_service_secret(secret)

@router.delete("/{service_id}/secrets/{secret_id}")
async def delete_service_secret(
    service_id: int,
    secret_id: int,
    request: Request,
    _secret_admin: models.Operator = Depends(require_capability("secrets", 3)),
    db: AsyncSession = Depends(get_db),
):
    await _get_owned_service(request, db, service_id)
    if not 1 <= secret_id <= 2 ** 63 - 1:
        raise HTTPException(404, 'Secret not found')
    res = await db.execute(select(models.ServiceSecret).filter(
        models.ServiceSecret.id == secret_id,
        models.ServiceSecret.service_id == service_id
    ))
    secret = res.scalar_one_or_none()
    if not secret: raise HTTPException(404, "Secret not found")
    
    await db.delete(secret)
    db.add(build_audit_log(
        request=request,
        action="DELETE_SECRET",
        target_table="service_secrets",
        target_id=str(secret_id),
        description=f"Deleted service secret from service {service_id}",
        changes={"service_id": service_id},
    ))
    await db.commit()
    return {"status": "success"}

async def sync_service_to_device(service, db: AsyncSession):
    # Production sessions disable autoflush. Synchronization must query the
    # new service assignment/type within this transaction, not its old row.
    await db.flush()
    if service.service_type == "OS" or service.device_id:
        await sync_device_os_state(service.device_id, db)

@router.post("")
async def create_service(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    # data includes: name, service_type, status, version, environment, device_id, config_json, custom_attributes
    name = data.get('name')
    if not name: raise HTTPException(400, "Service name required")

    clean_data = normalize_service_payload(data)
    if clean_data.get('device_id') is not None:
        await require_relationship_asset(request, db, clean_data['device_id'], active=True)

    svc = models.LogicalService(**clean_data, created_by_user_id=get_audit_actor(request))
    db.add(svc)
    try:
        await db.flush() # Flush to get ID without committing
        
        # Sync back to device if OS
        await sync_service_to_device(svc, db)
        
        log = build_audit_log(
            request=request,
            action="CREATE",
            target_table="logical_services",
            target_id=str(svc.id),
            description=f"Registered logical service: {svc.name} ({svc.service_type})",
            changes={"name": svc.name, "service_type": svc.service_type, "device_id": svc.device_id},
        )
        db.add(log)
        await db.commit()
        await db.refresh(svc)
        return svc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, 'Service creation conflicts with current data; reload and retry') from exc
    except Exception:
        await db.rollback()
        raise

@router.put("/{service_id}")
async def update_service(service_id: int, data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    svc = await _get_owned_service(request, db, service_id)
    previous_device_id = svc.device_id
    
    clean_data = normalize_service_payload(data)
    changed = {key: value for key, value in clean_data.items() if getattr(svc, key) != value}
    if changed:
        if changed.get('device_id') is not None:
            await require_relationship_asset(request, db, changed['device_id'], active=True)
        for key, value in changed.items():
            setattr(svc, key, value)

        # Sync back to device if OS
        await sync_service_to_device(svc, db)
        if previous_device_id != svc.device_id:
            await sync_device_os_state(previous_device_id, db)

        db.add(build_audit_log(
            request=request,
            action="UPDATE",
            target_table="logical_services",
            target_id=str(service_id),
            description=f"Updated service configuration: {svc.name}",
            changes={"device_id": svc.device_id, "service_type": svc.service_type, "status": svc.status,
                     "changed_fields": sorted(changed)},
        ))
        await db.commit()
        await db.refresh(svc)
    result = await db.execute(
        select(models.LogicalService)
        .options(joinedload(models.LogicalService.secrets))
        .filter(models.LogicalService.id == service_id)
    )
    refreshed = result.unique().scalar_one()
    device_name = None
    if refreshed.device_id:
        device_name = await db.scalar(select(models.Device.name).filter(models.Device.id == refreshed.device_id))
    return serialize_service(refreshed, device_name)

@router.delete("/{service_id}")
async def delete_service(service_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    await _get_owned_service(request, db, service_id)
    result = await db.execute(
        update(models.LogicalService)
        .where(models.LogicalService.id == service_id, _service_scope(request), models.LogicalService.is_deleted.is_not(True))
        .values(is_deleted=True)
        .returning(models.LogicalService.name, models.LogicalService.device_id)
    )
    archived = result.first()
    if archived is None:
        exists = await db.scalar(select(models.LogicalService.id).where(models.LogicalService.id == service_id, _service_scope(request)))
        if exists is None: raise HTTPException(404)
        return {"status": "no_op"}

    name, affected_device_id = archived
    await sync_device_os_state(affected_device_id, db)
    log = build_audit_log(
        request=request,
        action="DELETE",
        target_table="logical_services",
        target_id=str(service_id),
        description=f"Soft-deleted service: {name}",
        changes={"device_id": affected_device_id},
    )
    db.add(log)
    await db.commit()
    return {"status": "success"}

@router.post("/bulk-action")
async def bulk_action(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    ids = normalize_operational_bulk_ids(data.get("ids"))
    action = str(data.get("action") or "").strip().lower()
    payload = normalize_operational_bulk_payload(data.get("payload"))
    dry_run = data.get("dry_run", False)
    if not isinstance(dry_run, bool):
        raise HTTPException(status_code=400, detail="dry_run must be a boolean")
    if action not in {"delete", "restore", "update"}:
        raise HTTPException(status_code=400, detail=f"Unsupported bulk action: {action}")

    services_res = await db.execute(select(models.LogicalService).where(models.LogicalService.id.in_(ids), _service_scope(request)))
    affected_services = services_res.scalars().all()
    services_by_id = {service.id: service for service in affected_services}

    clean_update: dict = {}
    if action == "update":
        clean_update = {key: value for key, value in payload.items() if key in SERVICE_BULK_UPDATE_FIELDS}
        if "status" in clean_update:
            clean_update["status"] = canonicalize_service_status(clean_update.get("status")) or "Existing"
        if "device_id" in clean_update:
            clean_update["device_id"] = _normalize_service_device_id(clean_update["device_id"])
            if clean_update["device_id"] is not None and any(service.device_id != clean_update["device_id"] for service in affected_services):
                await require_relationship_asset(request, db, clean_update["device_id"], active=True)
        if not clean_update:
            raise HTTPException(status_code=400, detail="Bulk update requires a supported field")

    changed_ids: list[int] = []
    unchanged_ids: list[int] = []
    for service_id in ids:
        service = services_by_id.get(service_id)
        if service is None:
            continue
        if action == "delete":
            changed = not bool(service.is_deleted)
        elif action == "restore":
            changed = bool(service.is_deleted)
        else:
            changed = any(getattr(service, key) != value for key, value in clean_update.items())
        (changed_ids if changed else unchanged_ids).append(service_id)

    summary = build_operational_bulk_summary(
        action=action,
        selected_ids=ids,
        matched_ids=services_by_id.keys(),
        changed_ids=changed_ids,
        unchanged_ids=unchanged_ids,
    )
    if dry_run:
        return {"status": "preview", **summary}

    require_executable_operational_bulk(summary)
    if not changed_ids:
        return {"status": "no_op", **summary}

    affected_device_ids = {
        service.device_id
        for service in affected_services
        if service.id in changed_ids and service.device_id
    }
    os_device_ids_before = {
        service.device_id
        for service in affected_services
        if service.id in changed_ids and service.service_type == "OS" and service.device_id
    }
    if action == "delete":
        await db.execute(
            update(models.LogicalService)
            .where(models.LogicalService.id.in_(changed_ids))
            .values(is_deleted=True)
        )
    elif action == "restore":
        await db.execute(
            update(models.LogicalService)
            .where(models.LogicalService.id.in_(changed_ids))
            .values(is_deleted=False)
        )
    else:
        previous_device_ids = set(affected_device_ids)
        await db.execute(
            update(models.LogicalService)
            .where(models.LogicalService.id.in_(changed_ids))
            .values(**clean_update)
        )
        if "device_id" in clean_update and clean_update["device_id"]:
            affected_device_ids.add(clean_update["device_id"])
        affected_device_ids.update(previous_device_ids)

    refreshed_res = await db.execute(select(models.LogicalService).filter(models.LogicalService.id.in_(changed_ids)))
    refreshed_services = refreshed_res.scalars().all()
    os_device_ids_after = {
        service.device_id
        for service in refreshed_services
        if service.service_type == "OS" and service.device_id
    }
    affected_device_ids.update(os_device_ids_before)
    affected_device_ids.update(os_device_ids_after)
    if os_device_ids_before or os_device_ids_after:
        for device_id in affected_device_ids:
            await sync_device_os_state(device_id, db)

    db.add(build_audit_log(
        request=request,
        action=f"BULK_{action.upper()}",
        target_table="logical_services",
        target_id="bulk",
        description=f"Applied bulk logical service action: {action}",
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

@router.post("/{service_id}/mount/{device_id}")
async def mount_service(service_id: int, device_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    svc = await _get_owned_service(request, db, service_id)
    await require_relationship_asset(request, db, device_id, active=True)
    if svc.device_id == device_id:
        return {"status": "success"}
    dev_res = await db.execute(select(models.Device).filter(models.Device.id == device_id))
    dev = dev_res.scalar_one_or_none()
    
    if not svc or not dev: raise HTTPException(404, "Service or Device not found")
    
    previous_device_id = svc.device_id
    svc.device_id = device_id
    await sync_service_to_device(svc, db)
    if previous_device_id != device_id:
        await sync_device_os_state(previous_device_id, db)
    log = build_audit_log(
        request=request,
        action="MOUNT",
        target_table="logical_services",
        target_id=str(service_id),
        description=f"Mounted service {svc.name} onto host {dev.name}",
        changes={"from_device_id": previous_device_id, "to_device_id": device_id},
    )
    db.add(log)
    await db.commit()
    return {"status": "success"}
