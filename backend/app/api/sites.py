from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update, func
from ..database import get_db
from ..models import models
from .utils import build_audit_log
from .module_policy import require_module_access

router = APIRouter(
    prefix="/sites",
    tags=["Sites"],
    dependencies=[Depends(require_module_access("racks"))],
)

@router.get("")
async def get_sites(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Site).order_by(models.Site.order_index.asc()))
    sites = result.scalars().all()
    return [{"id": s.id, "name": s.name, "address": s.address, "order_index": s.order_index, "color": s.color or "#3b82f6"} for s in sites]

@router.post("/reorder")
async def reorder_sites(data: dict, db: AsyncSession = Depends(get_db)):
    # Expected format: {"ids": [3, 1, 2]}
    ids = data.get("ids", [])
    for index, site_id in enumerate(ids):
        await db.execute(
            update(models.Site)
            .where(models.Site.id == site_id)
            .values(order_index=index)
        )
    await db.commit()
    return {"status": "success"}

@router.post("")
async def create_site(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    name = data.get('name', 'New Site')
    # Check for duplicate name
    existing_result = await db.execute(select(models.Site).filter(models.Site.name == name))
    if existing_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SITE_NAME_DUPLICATE")

    # Get max order index
    max_res = await db.execute(select(func.max(models.Site.order_index)))
    max_order = max_res.scalar() or 0
    
    site = models.Site(name=name, address=data.get('address', ''), color=data.get('color', '#3b82f6'), order_index=max_order + 1)
    db.add(site)
    try:
        await db.commit()
        await db.refresh(site)
        
        # Audit log
        log = build_audit_log(
            request=request,
            action="CREATE",
            target_table="sites",
            target_id=str(site.id),
            description=f"Established new site: {site.name}",
            changes={"color": site.color},
        )
        db.add(log)
        
        room = models.Room(name="Main Floor", site_id=site.id)
        db.add(room)
        
        await db.commit()
        return {"id": site.id, "name": site.name, "address": site.address, "order_index": site.order_index, "color": site.color}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

@router.put("/{site_id}")
async def update_site(site_id: int, data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Site).filter(models.Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site: raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    
    if 'name' in data and data['name'] != site.name:
        # Check if the new name is already taken by ANOTHER site
        dup_result = await db.execute(select(models.Site).filter(models.Site.name == data['name'], models.Site.id != site_id))
        if dup_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SITE_NAME_DUPLICATE")
        site.name = data['name']
        
    if 'address' in data: site.address = data['address']
    if 'order_index' in data: site.order_index = data['order_index']
    if 'color' in data: site.color = data['color']
    
    log = build_audit_log(
        request=request, action="UPDATE", target_table="sites",
        target_id=str(site.id), description=f"Updated site: {site.name}",
        changes={"color": site.color} if 'color' in data else {}
    )
    db.add(log)
    await db.commit()
    return {"id": site.id, "name": site.name, "order_index": site.order_index}

@router.delete("/{site_id}")
async def delete_site(site_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Site).filter(models.Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site: raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")

    # Before deleting the site, find all racks associated with it and update their last_site_name
    # Racks are linked to Site via Room. Room has cascade delete, which sets Rack.room_id to NULL.
    # We want to keep the name of this site in the Rack before that happens.
    rack_result = await db.execute(
        select(models.Rack)
        .join(models.Room)
        .filter(models.Room.site_id == site_id)
    )
    racks = rack_result.scalars().all()
    for rack in racks:
        rack.last_site_name = site.name

    await db.delete(site)
    log = build_audit_log(
        request=request, action="DELETE", target_table="sites",
        target_id=str(site_id), description=f"Decommissioned site: {site.name}"
    )
    db.add(log)
    await db.commit()
    return {"status": "success"}
