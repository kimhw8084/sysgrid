from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update
from sqlalchemy.orm import selectinload
from typing import List, Optional
from ..database import get_db
from ..models import models
from .utils import filter_valid_columns, parse_iso_date
from .operational_bulk import (
    build_operational_bulk_summary,
    normalize_operational_bulk_ids,
    normalize_operational_bulk_payload,
    require_executable_operational_bulk,
)
from .module_policy import require_module_access

router = APIRouter(
    prefix="/vendors",
    tags=["Vendor & Contract Management"],
    dependencies=[Depends(require_module_access("vendors"))],
)
IMMUTABLE_VENDOR_FIELDS = {"id", "created_at", "updated_at", "created_by_user_id"}


def mutable_model_data(model: type, data: dict):
    return {
        key: value
        for key, value in filter_valid_columns(model, data).items()
        if key not in IMMUTABLE_VENDOR_FIELDS
    }

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
async def create_vendor(data: dict, db: AsyncSession = Depends(get_db)):
    clean_data = mutable_model_data(models.Vendor, data)
    vendor = models.Vendor(**clean_data)
    db.add(vendor)
    try:
        await db.commit()
        return await get_vendor_full(vendor.id, db)
    except Exception as e:
        await db.rollback()
        raise HTTPException(400, detail=str(e))

@router.put("/{vendor_id}")
async def update_vendor(vendor_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Vendor).filter(models.Vendor.id == vendor_id))
    vendor = result.scalar_one_or_none()
    if not vendor: raise HTTPException(404, "Vendor not found")
    
    clean_data = mutable_model_data(models.Vendor, data)
    for k, v in clean_data.items():
        setattr(vendor, k, v)
        
    await db.commit()
    return await get_vendor_full(vendor_id, db)

@router.delete("/{vendor_id}")
async def delete_vendor(vendor_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Vendor).filter(models.Vendor.id == vendor_id))
    vendor = result.scalar_one_or_none()
    if not vendor: raise HTTPException(404, "Vendor not found")
    
    vendor.is_deleted = True
    await db.commit()
    return {"status": "success"}

# --- PERSONNEL ---

@router.post("/{vendor_id}/personnel")
async def add_personnel(vendor_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    clean_data = mutable_model_data(models.VendorPersonnel, data)
    clean_data["vendor_id"] = vendor_id
    personnel = models.VendorPersonnel(**clean_data)
    db.add(personnel)
    try:
        await db.commit()
        await db.refresh(personnel)
        return personnel
    except Exception as e:
        await db.rollback()
        raise HTTPException(400, detail=str(e))

@router.put("/personnel/{personnel_id}")
async def update_personnel(personnel_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.VendorPersonnel).filter(models.VendorPersonnel.id == personnel_id))
    personnel = result.scalar_one_or_none()
    if not personnel: raise HTTPException(404, "Personnel not found")
    
    clean_data = mutable_model_data(models.VendorPersonnel, data)
    if "vendor_id" in clean_data:
        del clean_data["vendor_id"]
    
    for k, v in clean_data.items():
        setattr(personnel, k, v)
    
    try:
        await db.commit()
        await db.refresh(personnel)
        return personnel
    except Exception as e:
        await db.rollback()
        raise HTTPException(400, detail=str(e))

@router.delete("/personnel/{personnel_id}")
async def delete_personnel(personnel_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.VendorPersonnel).filter(models.VendorPersonnel.id == personnel_id))
    personnel = result.scalar_one_or_none()
    if not personnel: raise HTTPException(404, "Personnel not found")
    
    await db.delete(personnel)
    await db.commit()
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
async def create_contract(data: dict, db: AsyncSession = Depends(get_db)):
    # If vendor_id is missing, it will fail anyway, but let's be safe
    if 'vendor_id' not in data:
        raise HTTPException(400, detail="vendor_id is required")
        
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
        await db.commit()
        await db.refresh(contract)
        return contract
    except Exception as e:
        await db.rollback()
        raise HTTPException(400, detail=str(e))

@router.put("/contracts/{contract_id}")
async def update_contract(contract_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.VendorContract).filter(models.VendorContract.id == contract_id))
    contract = result.scalar_one_or_none()
    if not contract: raise HTTPException(404, "Contract not found")
    
    clean_data = mutable_model_data(models.VendorContract, data)
    
    if 'effective_date' in data:
        clean_data['effective_date'] = parse_iso_date(data['effective_date'])
    if 'expiry_date' in data:
        clean_data['expiry_date'] = parse_iso_date(data['expiry_date'])
        
    for k, v in clean_data.items():
        setattr(contract, k, v)
    
    try:
        await db.commit()
        await db.refresh(contract)
        return contract
    except Exception as e:
        await db.rollback()
        raise HTTPException(400, detail=str(e))

@router.post("/bulk-action")
async def bulk_action(data: dict, db: AsyncSession = Depends(get_db)):
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
    dry_run = bool(data.get("dry_run"))

    # Preserve the established contract lifecycle behavior. Vendor workspace preview/receipts
    # are intentionally scoped to vendor records, not nested contract records.
    if target == "contract":
        if action not in {"delete", "restore", "purge"}:
            raise HTTPException(status_code=400, detail="Unsupported vendor contract bulk action")
        if dry_run:
            result = await db.execute(select(models.VendorContract).where(models.VendorContract.id.in_(ids)))
            contracts = list(result.scalars().all())
            matched_ids = [contract.id for contract in contracts]
            changed_ids = matched_ids
            summary = build_operational_bulk_summary(
                action=action,
                selected_ids=ids,
                matched_ids=matched_ids,
                changed_ids=changed_ids,
                unchanged_ids=[],
            )
            return {**summary, "status": "success", "count": summary["changed_count"], "changed": summary["changed_count"]}
        if action == "delete" or action == "purge":
            await db.execute(delete(models.VendorContract).where(models.VendorContract.id.in_(ids)))
        else:
            await db.execute(update(models.VendorContract).where(models.VendorContract.id.in_(ids)).values(is_deleted=False))
        await db.commit()
        return {"status": "success", "count": len(ids), "changed": len(ids)}

    if target != "vendor":
        raise HTTPException(status_code=400, detail="Unsupported vendor bulk target")
    if action not in {"update", "delete", "restore", "purge"}:
        raise HTTPException(status_code=400, detail="Unsupported vendor bulk action")

    result = await db.execute(select(models.Vendor).where(models.Vendor.id.in_(ids)))
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
            (changed_ids if vendor.is_deleted else unchanged_ids).append(record_id)
    else:  # purge
        changed_ids.extend(matched_ids)

    summary = build_operational_bulk_summary(
        action=action,
        selected_ids=ids,
        matched_ids=matched_ids,
        changed_ids=changed_ids,
        unchanged_ids=unchanged_ids,
        blockers=blockers,
    )
    compatibility = {
        **summary,
        "status": "success",
        "count": summary["changed_count"],
        "changed": summary["changed_count"],
    }
    if dry_run or not changed_ids:
        return compatibility

    require_executable_operational_bulk(summary)

    if action == "update":
        await db.execute(
            update(models.Vendor)
            .where(models.Vendor.id.in_(changed_ids))
            .values(**clean_update)
        )
    elif action == "delete":
        await db.execute(
            update(models.Vendor)
            .where(models.Vendor.id.in_(changed_ids))
            .values(is_deleted=True)
        )
    elif action == "restore":
        await db.execute(
            update(models.Vendor)
            .where(models.Vendor.id.in_(changed_ids))
            .values(is_deleted=False)
        )
    else:
        await db.execute(delete(models.Vendor).where(models.Vendor.id.in_(changed_ids)))

    await db.commit()
    return compatibility
