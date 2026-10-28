import hashlib
import json
import re
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload, selectinload
from sqlalchemy.orm.exc import StaleDataError
from typing import List, Optional
from ..database import get_db
from ..models import models
from .utils import build_audit_log, filter_valid_columns, get_audit_actor, parse_iso_date
from .operational_bulk import (
    build_operational_bulk_summary,
    normalize_operational_bulk_ids,
    normalize_operational_bulk_payload,
    require_executable_operational_bulk,
)
from .module_policy import ensure_module_access, require_module_access

router = APIRouter(
    prefix="/vendors",
    tags=["Vendor & Contract Management"],
    dependencies=[Depends(require_module_access("vendors"))],
)
IMMUTABLE_VENDOR_FIELDS = {"id", "created_at", "updated_at", "created_by_user_id", "edit_revision"}


def mutable_model_data(model: type, data: dict):
    return {
        key: value
        for key, value in filter_valid_columns(model, data).items()
        if key not in IMMUTABLE_VENDOR_FIELDS
    }


async def _commit_vendor_write(db: AsyncSession, conflict_message: str) -> None:
    try:
        await db.commit()
    except StaleDataError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=conflict_message) from exc


def _vendor_audit(request: Request, action: str, table: str, target_id: int | str, description: str, changes: dict | None = None):
    return build_audit_log(
        request=request,
        action=action,
        target_table=table,
        target_id=str(target_id),
        description=description,
        changes=changes or {},
    )


def _bulk_precondition(request: Request, ids: list[int], action: str, payload: dict, records: dict[int, object]) -> str:
    value = {
        "contract": "vendor-bulk-preview-v1",
        "tenant": request.state.tenant_id,
        "actor": get_audit_actor(request),
        "ids": sorted(ids),
        "action": action,
        "payload": payload,
        "records": [
            {"id": identity, "revision": records[identity].edit_revision, "is_deleted": records[identity].is_deleted}
            for identity in sorted(records)
        ],
    }
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False, default=str).encode()).hexdigest()


def _bulk_request_hash(action: str, ids: list[int], target: str, payload: dict, precondition: str) -> str:
    value = {"module": "vendors", "action": action, "ids": ids, "target": target, "payload": payload, "precondition": precondition}
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False, default=str).encode()).hexdigest()


async def _reserve_vendor_writer(request: Request, db: AsyncSession) -> None:
    await db.rollback()
    dialect = db.get_bind().dialect.name
    if dialect == "sqlite":
        await db.execute(text("BEGIN IMMEDIATE"))
    elif dialect != "postgresql":
        raise HTTPException(409, "Guarded vendor operations are unavailable for this database engine")
    await ensure_module_access("vendors", request, db)


async def _replay_vendor_receipt(request: Request, db: AsyncSession, operation_id: str, request_hash: str):
    receipt = await db.scalar(select(models.ModuleBulkReceipt).where(
        models.ModuleBulkReceipt.module == "vendors",
        models.ModuleBulkReceipt.tenant_id == request.state.tenant_id,
        models.ModuleBulkReceipt.actor_id == get_audit_actor(request),
        models.ModuleBulkReceipt.operation_id == operation_id,
    ))
    if receipt is None:
        return None
    if receipt.request_hash != request_hash:
        raise HTTPException(409, "This operation ID is already bound to a different vendor request")
    if receipt.undo_result is not None:
        return {**receipt.result, "status": "already_reverted", "changed_count": 0, "changed_ids": [], "can_revert": False}
    return dict(receipt.result)


async def _undo_vendor_receipt(request: Request, db: AsyncSession, receipt_id: str, ids: list[int]):
    receipt = await db.scalar(select(models.ModuleBulkReceipt).where(
        models.ModuleBulkReceipt.id == receipt_id,
        models.ModuleBulkReceipt.module == "vendors",
        models.ModuleBulkReceipt.tenant_id == request.state.tenant_id,
        models.ModuleBulkReceipt.actor_id == get_audit_actor(request),
    ).with_for_update())
    if receipt is None:
        raise HTTPException(404, "Vendor operation receipt not found")
    expected_ids = receipt.result.get("changed_ids", [])
    if sorted(ids) != sorted(expected_ids):
        raise HTTPException(400, "Undo selection must match the receipt's changed vendor records")
    if receipt.undo_result is not None:
        return dict(receipt.undo_result)
    if not receipt.result.get("can_revert"):
        raise HTTPException(409, "This vendor operation cannot be reverted")

    if receipt.target == "vendor":
        model = models.Vendor
        allowed_fields = {"country", "is_deleted"}
    elif receipt.target == "contract":
        model = models.VendorContract
        allowed_fields = {"is_deleted"}
    else:
        raise HTTPException(409, "Vendor receipt target is not reversible")
    records = {row.id: row for row in (await db.execute(select(model).where(model.id.in_(ids)).with_for_update())).scalars().all()}
    if set(records) != set(ids):
        raise HTTPException(409, "A vendor record from this operation no longer exists")
    for identity in ids:
        if records[identity].edit_revision != receipt.post_state.get(str(identity)):
            raise HTTPException(409, "A vendor record changed after this operation; undo was not applied")
        before = receipt.before_state.get(str(identity), {})
        if set(before) - allowed_fields:
            raise HTTPException(409, "Vendor receipt contains fields that cannot be safely restored")
        for key, value in before.items():
            setattr(records[identity], key, value)

    db.add(_vendor_audit(request, "UNDO", "vendor_contracts" if receipt.target == "contract" else "vendors", "bulk", "Reverted vendor operation", {"receipt_id": receipt.id, "ids": ids}))
    await db.flush()
    receipt.undo_result = {"status": "reverted", "receipt_id": receipt.id, "changed_count": len(ids), "changed_ids": ids, "can_revert": False}
    receipt.reverted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()
    return dict(receipt.undo_result)

async def get_vendor_full(vendor_id: int, db: AsyncSession):
    query = select(models.Vendor).filter(models.Vendor.id == vendor_id).options(
        selectinload(models.Vendor.contracts),
        selectinload(models.Vendor.personnel)
    )
    result = await db.execute(query)
    return result.scalar_one_or_none()

@router.get("")
async def get_vendors(include_deleted: bool = False, db: AsyncSession = Depends(get_db)):
    query = select(models.Vendor).options(
        selectinload(models.Vendor.contracts),
        selectinload(models.Vendor.personnel)
    )
    if not include_deleted:
        query = query.filter(models.Vendor.is_deleted == False)
    result = await db.execute(query.order_by(models.Vendor.name))
    return result.unique().scalars().all()

@router.post("")
async def create_vendor(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    clean_data = mutable_model_data(models.Vendor, data)
    vendor = models.Vendor(**clean_data)
    db.add(vendor)
    try:
        await db.flush()
        db.add(_vendor_audit(request, "CREATE", "vendors", vendor.id, "Created vendor", {"changed_fields": sorted(clean_data)}))
        await db.commit()
        return await get_vendor_full(vendor.id, db)
    except Exception as e:
        await db.rollback()
        raise HTTPException(400, detail="Unable to create vendor; verify the supplied values and retry")

@router.put("/{vendor_id}")
async def update_vendor(vendor_id: int, data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Vendor).filter(models.Vendor.id == vendor_id).with_for_update())
    vendor = result.scalar_one_or_none()
    if not vendor: raise HTTPException(404, "Vendor not found")
    if not data.get("edit_revision") or data["edit_revision"] != vendor.edit_revision:
        raise HTTPException(status_code=409, detail="Vendor changed since it was loaded; reload and review your edit")
    if vendor.is_deleted:
        raise HTTPException(409, "Restore this vendor before editing it")
    
    clean_data = mutable_model_data(models.Vendor, data)
    if clean_data.get("primary_personnel_id") is not None:
        primary = await db.get(models.VendorPersonnel, clean_data["primary_personnel_id"])
        if not primary or primary.vendor_id != vendor_id or primary.is_deleted:
            raise HTTPException(400, "Primary contact must be active personnel for this vendor")
    changed_fields = sorted(key for key, value in clean_data.items() if getattr(vendor, key) != value)
    for k, v in clean_data.items():
        setattr(vendor, k, v)
    if changed_fields:
        db.add(_vendor_audit(request, "UPDATE", "vendors", vendor_id, "Updated vendor", {"changed_fields": changed_fields}))
    await _commit_vendor_write(db, "Vendor changed while saving; reload and review your edit")
    return await get_vendor_full(vendor_id, db)

@router.delete("/{vendor_id}")
async def delete_vendor(vendor_id: int, expected_revision: str, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Vendor).filter(models.Vendor.id == vendor_id).with_for_update())
    vendor = result.scalar_one_or_none()
    if not vendor: raise HTTPException(404, "Vendor not found")
    if expected_revision != vendor.edit_revision:
        raise HTTPException(409, "Vendor changed since it was loaded; reload before archiving it")
    
    if vendor.is_deleted:
        return {"status": "no_op"}
    vendor.is_deleted = True
    db.add(_vendor_audit(request, "ARCHIVE", "vendors", vendor_id, "Archived vendor"))
    await _commit_vendor_write(db, "Vendor changed while archiving; reload before trying again")
    return {"status": "success"}

# --- PERSONNEL ---

@router.post("/{vendor_id}/personnel")
async def add_personnel(vendor_id: int, data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    vendor = await db.get(models.Vendor, vendor_id)
    if not vendor:
        raise HTTPException(404, "Vendor not found")
    if vendor.is_deleted:
        raise HTTPException(409, "Restore this vendor before adding personnel")
    clean_data = mutable_model_data(models.VendorPersonnel, data)
    clean_data["vendor_id"] = vendor_id
    personnel = models.VendorPersonnel(**clean_data)
    db.add(personnel)
    try:
        await db.flush()
        db.add(_vendor_audit(request, "CREATE", "vendor_personnel", personnel.id, "Added vendor personnel", {"vendor_id": vendor_id, "changed_fields": sorted(clean_data)}))
        await db.commit()
        await db.refresh(personnel)
        return personnel
    except Exception as e:
        await db.rollback()
        raise HTTPException(400, detail="Unable to add personnel; verify the supplied values and retry")

@router.put("/personnel/{personnel_id}")
async def update_personnel(personnel_id: int, data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.VendorPersonnel).filter(models.VendorPersonnel.id == personnel_id).with_for_update())
    personnel = result.scalar_one_or_none()
    if not personnel: raise HTTPException(404, "Personnel not found")
    if not data.get("edit_revision") or data["edit_revision"] != personnel.edit_revision:
        raise HTTPException(status_code=409, detail="Personnel changed since it was loaded; reload and review your edit")
    vendor = await db.get(models.Vendor, personnel.vendor_id)
    if not vendor or vendor.is_deleted:
        raise HTTPException(409, "Restore this vendor before editing personnel")
    
    clean_data = mutable_model_data(models.VendorPersonnel, data)
    if "vendor_id" in clean_data:
        del clean_data["vendor_id"]
    
    changed_fields = sorted(key for key, value in clean_data.items() if getattr(personnel, key) != value)
    for k, v in clean_data.items():
        setattr(personnel, k, v)
    
    try:
        if changed_fields:
            db.add(_vendor_audit(request, "UPDATE", "vendor_personnel", personnel_id, "Updated vendor personnel", {"changed_fields": changed_fields}))
        await db.commit()
        await db.refresh(personnel)
        return personnel
    except StaleDataError as exc:
        await db.rollback()
        raise HTTPException(409, "Personnel changed while saving; reload and review your edit") from exc
    except Exception as e:
        await db.rollback()
        raise HTTPException(400, detail="Unable to update personnel; verify the supplied values and retry")

@router.delete("/personnel/{personnel_id}")
async def delete_personnel(personnel_id: int, expected_revision: str, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.VendorPersonnel).filter(models.VendorPersonnel.id == personnel_id).with_for_update())
    personnel = result.scalar_one_or_none()
    if not personnel: raise HTTPException(404, "Personnel not found")
    if expected_revision != personnel.edit_revision:
        raise HTTPException(409, "Personnel changed since it was loaded; reload before removing it")
    
    vendor_id = personnel.vendor_id
    await db.delete(personnel)
    db.add(_vendor_audit(request, "DELETE", "vendor_personnel", personnel_id, "Removed vendor personnel", {"vendor_id": vendor_id}))
    await _commit_vendor_write(db, "Personnel changed while removing; reload before trying again")
    return {"status": "success"}

# --- CONTRACTS ---

@router.get("/contracts")
async def get_contracts(include_deleted: bool = False, db: AsyncSession = Depends(get_db)):
    query = select(models.VendorContract).options(joinedload(models.VendorContract.vendor_ref))
    if not include_deleted:
        query = query.filter(models.VendorContract.is_deleted == False)
    result = await db.execute(query.order_by(models.VendorContract.expiry_date))
    return result.unique().scalars().all()

@router.post("/contracts")
async def create_contract(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    # If vendor_id is missing, it will fail anyway, but let's be safe
    if 'vendor_id' not in data:
        raise HTTPException(400, detail="vendor_id is required")
        
    vendor = await db.get(models.Vendor, data["vendor_id"])
    if not vendor:
        raise HTTPException(404, "Vendor not found")
    if vendor.is_deleted:
        raise HTTPException(409, "Restore this vendor before adding a contract")
    clean_data = mutable_model_data(models.VendorContract, data)
    clean_data['vendor_id'] = data['vendor_id'] # Ensure it's passed through
    
    # Handle dates
    if 'effective_date' in data:
        clean_data['effective_date'] = parse_iso_date(data['effective_date'])
    if 'expiry_date' in data:
        clean_data['expiry_date'] = parse_iso_date(data['expiry_date'])

    contract = models.VendorContract(**clean_data)
    db.add(contract)

    try:
        await db.flush()
        db.add(_vendor_audit(request, "CREATE", "vendor_contracts", contract.id, "Created vendor contract", {"vendor_id": vendor.id, "changed_fields": sorted(clean_data)}))
        await db.commit()
        await db.refresh(contract)
        return contract
    except Exception as e:
        await db.rollback()
        raise HTTPException(400, detail="Unable to create contract; verify the supplied values and retry")

@router.put("/contracts/{contract_id}")
async def update_contract(contract_id: int, data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.VendorContract).filter(models.VendorContract.id == contract_id).with_for_update())
    contract = result.scalar_one_or_none()
    if not contract: raise HTTPException(404, "Contract not found")
    if not data.get("edit_revision") or data["edit_revision"] != contract.edit_revision:
        raise HTTPException(status_code=409, detail="Contract changed since it was loaded; reload and review your edit")
    if contract.is_deleted:
        raise HTTPException(409, "Restore this contract before editing it")
    
    clean_data = mutable_model_data(models.VendorContract, data)
    if "vendor_id" in clean_data:
        vendor = await db.get(models.Vendor, clean_data["vendor_id"])
        if not vendor:
            raise HTTPException(404, "Vendor not found")
        if vendor.is_deleted:
            raise HTTPException(409, "Restore this vendor before moving a contract to it")
    
    if 'effective_date' in data:
        clean_data['effective_date'] = parse_iso_date(data['effective_date'])
    if 'expiry_date' in data:
        clean_data['expiry_date'] = parse_iso_date(data['expiry_date'])
        
    changed_fields = sorted(key for key, value in clean_data.items() if getattr(contract, key) != value)
    for k, v in clean_data.items():
        setattr(contract, k, v)
    
    try:
        if changed_fields:
            db.add(_vendor_audit(request, "UPDATE", "vendor_contracts", contract_id, "Updated vendor contract", {"changed_fields": changed_fields}))
        await db.commit()
        await db.refresh(contract)
        return contract
    except StaleDataError as exc:
        await db.rollback()
        raise HTTPException(409, "Contract changed while saving; reload and review your edit") from exc
    except Exception as e:
        await db.rollback()
        raise HTTPException(400, detail="Unable to update contract; verify the supplied values and retry")

@router.post("/bulk-action")
async def bulk_action(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    raw_ids = data.get("ids", [])
    action = str(data.get("action") or "").strip().lower()
    target = str(data.get("target") or "vendor").strip().lower()

    if raw_ids == []:
        return {
            "status": "no_op",
            "action": action,
            "selected_count": 0,
            "matched_count": 0,
            "changed_count": 0,
            "unchanged_count": 0,
            "blocked_count": 0,
            "missing_count": 0,
            "changed_ids": [],
            "unchanged_ids": [],
            "missing_ids": [],
            "blockers": [],
            "can_execute": False,
            "count": 0,
            "changed": 0,
        }

    ids = normalize_operational_bulk_ids(raw_ids)
    payload = normalize_operational_bulk_payload(data.get("payload"))
    dry_run = data.get("dry_run", False)
    if not isinstance(dry_run, bool):
        raise HTTPException(status_code=400, detail="dry_run must be a boolean")
    if action == "undo":
        if dry_run:
            raise HTTPException(400, "Vendor undo does not support preview")
        receipt_id = data.get("receipt_id")
        if not isinstance(receipt_id, str) or not re.fullmatch(r"[0-9a-f]{32}", receipt_id):
            raise HTTPException(400, "receipt_id must be a 32-character lowercase hexadecimal value")
        await _reserve_vendor_writer(request, db)
        return await _undo_vendor_receipt(request, db, receipt_id, ids)
    operation_id = data.get("operation_id")
    precondition = data.get("precondition")
    request_hash = None
    if not dry_run:
        if not isinstance(operation_id, str) or not re.fullmatch(r"[0-9a-f]{32}", operation_id):
            raise HTTPException(400, "operation_id must be a 32-character lowercase hexadecimal value")
        if not isinstance(precondition, str) or not re.fullmatch(r"[0-9a-f]{64}", precondition):
            raise HTTPException(400, "precondition must be a 64-character lowercase hexadecimal value")
        request_hash = _bulk_request_hash(action, ids, target, payload, precondition)
        await _reserve_vendor_writer(request, db)
        replay = await _replay_vendor_receipt(request, db, operation_id, request_hash)
        if replay is not None:
            return replay

    # Keep contract deletion recoverable until an explicitly archived row is purged.
    if target == "contract":
        if action not in {"delete", "restore", "purge"}:
            raise HTTPException(status_code=400, detail="Unsupported vendor contract bulk action")
        if action in {"delete", "restore", "purge"}:
            contract_query = select(models.VendorContract).where(models.VendorContract.id.in_(ids))
            if not dry_run:
                contract_query = contract_query.with_for_update()
            result = await db.execute(contract_query)
            contracts = list(result.scalars().all())
            by_id = {contract.id: contract for contract in contracts}
            matched_ids = [record_id for record_id in ids if record_id in by_id]
            changed_ids: list[int] = []
            unchanged_ids: list[int] = []
            blockers: list[dict] = []
            for record_id in matched_ids:
                contract = by_id[record_id]
                if action == "delete":
                    (unchanged_ids if contract.is_deleted else changed_ids).append(record_id)
                elif action == "restore":
                    vendor = await db.get(models.Vendor, contract.vendor_id)
                    if not contract.is_deleted:
                        unchanged_ids.append(record_id)
                    elif not vendor or vendor.is_deleted:
                        blockers.append({"id": record_id, "reason": "Restore the owning vendor before restoring this contract"})
                    else:
                        changed_ids.append(record_id)
                elif not contract.is_deleted:
                    blockers.append({"id": record_id, "reason": "Archive this contract before permanent purge"})
                else:
                    changed_ids.append(record_id)
            summary = build_operational_bulk_summary(
                action=action,
                selected_ids=ids,
                matched_ids=matched_ids,
                changed_ids=changed_ids,
                unchanged_ids=unchanged_ids,
                blockers=blockers,
            )
            precondition = _bulk_precondition(request, ids, action, payload, by_id)
            if dry_run:
                return {
                    **summary,
                    "status": "preview",
                    "precondition": precondition,
                    "operation_id": uuid4().hex,
                    "versions": {str(identity): contract.edit_revision for identity, contract in by_id.items()},
                    "count": summary["changed_count"],
                    "changed": summary["changed_count"],
                }
            if data.get("precondition") != precondition:
                raise HTTPException(409, "Contracts changed since preview; review a fresh preview before applying")
            require_executable_operational_bulk(summary)
            before_state = {
                str(identity): {"is_deleted": by_id[identity].is_deleted}
                for identity in changed_ids
            } if action != "purge" else {}
            if action == "delete":
                for identity in changed_ids:
                    by_id[identity].is_deleted = True
            elif action == "restore":
                for identity in changed_ids:
                    by_id[identity].is_deleted = False
            else:
                for identity in changed_ids:
                    await db.delete(by_id[identity])
            if changed_ids:
                db.add(_vendor_audit(request, f"BULK_{action.upper()}", "vendor_contracts", "bulk", f"Applied vendor contract action: {action}", {"ids": changed_ids}))
            await db.flush()
            receipt_id = uuid4().hex
            can_revert = action != "purge" and bool(changed_ids)
            contract_result = {
                **summary, "status": "success", "count": summary["changed_count"], "changed": summary["changed_count"],
                "operation_id": operation_id, "receipt_id": receipt_id, "can_revert": can_revert,
            }
            db.add(models.ModuleBulkReceipt(
                id=receipt_id,
                module="vendors", tenant_id=request.state.tenant_id, actor_id=get_audit_actor(request),
                target="contract", operation_id=operation_id, request_hash=request_hash, result=contract_result,
                before_state=before_state,
                post_state={str(identity): by_id[identity].edit_revision for identity in changed_ids} if can_revert else {},
            ))
            try:
                await db.commit()
            except IntegrityError:
                await db.rollback()
                replay = await _replay_vendor_receipt(request, db, operation_id, request_hash)
                if replay is not None:
                    return replay
                raise
            return contract_result

    if target != "vendor":
        raise HTTPException(status_code=400, detail="Unsupported vendor bulk target")
    if action not in {"update", "delete", "restore", "purge"}:
        raise HTTPException(status_code=400, detail="Unsupported vendor bulk action")

    vendor_query = select(models.Vendor).where(models.Vendor.id.in_(ids))
    if not dry_run:
        vendor_query = vendor_query.with_for_update()
    result = await db.execute(vendor_query)
    vendors = list(result.scalars().all())
    by_id = {vendor.id: vendor for vendor in vendors}
    matched_ids = [record_id for record_id in ids if record_id in by_id]
    changed_ids: list[int] = []
    unchanged_ids: list[int] = []
    blockers: list[dict] = []
    clean_update: dict = {}

    if action == "update":
        allowed_fields = {"country"}
        unsupported = sorted(set(payload) - allowed_fields)
        if unsupported:
            raise HTTPException(status_code=400, detail=f"Unsupported vendor bulk fields: {', '.join(unsupported)}")
        clean_update = {key: value for key, value in payload.items() if key in allowed_fields and value is not None}
        if not clean_update or not str(clean_update.get("country") or "").strip():
            raise HTTPException(status_code=400, detail="Vendor bulk update requires country")
        clean_update["country"] = str(clean_update["country"]).strip()
        for record_id in matched_ids:
            vendor = by_id[record_id]
            if vendor.is_deleted:
                blockers.append({"id": record_id, "name": vendor.name, "reason": "Restore this vendor before updating it"})
            elif vendor.country != clean_update["country"]:
                changed_ids.append(record_id)
            else:
                unchanged_ids.append(record_id)
    elif action == "delete":
        for record_id in matched_ids:
            vendor = by_id[record_id]
            (unchanged_ids if vendor.is_deleted else changed_ids).append(record_id)
    elif action == "restore":
        for record_id in matched_ids:
            vendor = by_id[record_id]
            if vendor.is_deleted:
                changed_ids.append(record_id)
            else:
                unchanged_ids.append(record_id)
    else:  # purge
        personnel_vendor_ids = set((await db.execute(
            select(models.VendorPersonnel.vendor_id).where(models.VendorPersonnel.vendor_id.in_(matched_ids))
        )).scalars().all()) if matched_ids else set()
        contract_vendor_ids = set((await db.execute(
            select(models.VendorContract.vendor_id).where(models.VendorContract.vendor_id.in_(matched_ids))
        )).scalars().all()) if matched_ids else set()
        dependent_vendor_ids = personnel_vendor_ids | contract_vendor_ids
        for record_id in matched_ids:
            vendor = by_id[record_id]
            if not vendor.is_deleted:
                blockers.append({"id": record_id, "name": vendor.name, "reason": "Archive this vendor before permanent purge"})
            elif record_id in dependent_vendor_ids:
                blockers.append({"id": record_id, "name": vendor.name, "reason": "Remove or transfer its personnel and contracts before permanent purge"})
            else:
                changed_ids.append(record_id)

    summary = build_operational_bulk_summary(
        action=action,
        selected_ids=ids,
        matched_ids=matched_ids,
        changed_ids=changed_ids,
        unchanged_ids=unchanged_ids,
        blockers=blockers,
    )
    precondition = _bulk_precondition(request, ids, action, clean_update if action == "update" else payload, by_id)
    compatibility = {
        **summary,
        "status": "preview" if dry_run else "success",
        "precondition": precondition,
        "operation_id": uuid4().hex if dry_run else operation_id,
        "versions": {str(identity): vendor.edit_revision for identity, vendor in by_id.items()},
        "count": summary["changed_count"],
        "changed": summary["changed_count"],
    }
    if dry_run:
        return compatibility

    if data.get("precondition") != precondition:
        raise HTTPException(409, "Vendors changed since preview; review a fresh preview before applying")
    require_executable_operational_bulk(summary)

    before_state: dict[str, dict] = {}
    if action == "update":
        before_state = {
            str(identity): {key: getattr(by_id[identity], key) for key in clean_update}
            for identity in changed_ids
        }
    elif action in {"delete", "restore"}:
        before_state = {str(identity): {"is_deleted": by_id[identity].is_deleted} for identity in changed_ids}

    if action == "update":
        for identity in changed_ids:
            for key, value in clean_update.items():
                setattr(by_id[identity], key, value)
    elif action == "delete":
        for identity in changed_ids:
            by_id[identity].is_deleted = True
    elif action == "restore":
        for identity in changed_ids:
            by_id[identity].is_deleted = False
    else:
        for identity in changed_ids:
            await db.delete(by_id[identity])

    receipt_id = uuid4().hex
    can_revert = action != "purge" and bool(changed_ids)
    compatibility.update(
        receipt_id=receipt_id,
        can_revert=can_revert,
        operation_id=operation_id,
    )
    if not changed_ids:
        db.add(models.ModuleBulkReceipt(
            id=receipt_id,
            module="vendors", target="vendor", tenant_id=request.state.tenant_id, actor_id=get_audit_actor(request),
            operation_id=operation_id, request_hash=request_hash, result=compatibility,
        ))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            replay = await _replay_vendor_receipt(request, db, operation_id, request_hash)
            if replay is not None:
                return replay
            raise
        return compatibility

    db.add(_vendor_audit(request, f"BULK_{action.upper()}", "vendors", "bulk", f"Applied vendor action: {action}", {
        "ids": changed_ids,
        "changed_fields": sorted(clean_update) if action == "update" else [],
        "selected_count": summary["selected_count"],
        "changed_count": summary["changed_count"],
    }))
    await db.flush()
    db.add(models.ModuleBulkReceipt(
        id=receipt_id,
        module="vendors", tenant_id=request.state.tenant_id, actor_id=get_audit_actor(request),
        target="vendor", operation_id=operation_id, request_hash=request_hash, result=compatibility,
        before_state=before_state,
        post_state={str(identity): by_id[identity].edit_revision for identity in changed_ids} if can_revert else {},
    ))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        replay = await _replay_vendor_receipt(request, db, operation_id, request_hash)
        if replay is not None:
            return replay
        raise
    return compatibility
