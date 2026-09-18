from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, and_, update, func
from ..database import get_db
from ..models import models
from typing import List, Optional
from .utils import build_audit_log
from .module_policy import require_module_access

router = APIRouter(
    prefix="/racks",
    tags=["Racks"],
    dependencies=[Depends(require_module_access("racks"))],
)

@router.get("/plans")
async def get_plans(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.InfrastructurePlan).order_by(models.InfrastructurePlan.created_at.desc()))
    plans = result.scalars().all()
    return plans

@router.post("/plans")
async def save_plan(data: dict, db: AsyncSession = Depends(get_db)):
    plan_id = data.get("id")
    if plan_id:
        result = await db.execute(select(models.InfrastructurePlan).filter(models.InfrastructurePlan.id == plan_id))
        plan = result.scalar_one_or_none()
        if plan:
            plan.name = data.get("name")
            plan.description = data.get("description")
            plan.racks_config = data.get("racks")
            plan.virtual_racks_data = data.get("racksData")
            await db.commit()
            await db.refresh(plan)
            return plan

    plan = models.InfrastructurePlan(
        name=data.get("name"),
        description=data.get("description"),
        racks_config=data.get("racks"),
        virtual_racks_data=data.get("racksData")
    )
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return plan

@router.delete("/plans/{plan_id}")
async def delete_plan(plan_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(models.InfrastructurePlan).filter(models.InfrastructurePlan.id == plan_id))
    await db.commit()
    return {"status": "deleted"}

@router.get("")
async def get_racks(site_id: Optional[str] = None, include_deleted: bool = False, db: AsyncSession = Depends(get_db)):
    if site_id == "missing":
        query = select(models.Rack).filter(models.Rack.room_id == None)
    elif site_id and site_id != "null" and site_id != "":
        query = select(models.Rack).join(models.Room).filter(models.Room.site_id == int(site_id))
    else:
        query = select(models.Rack)
    
    if not include_deleted:
        query = query.filter(models.Rack.is_deleted == False)
    
    query = query.order_by(models.Rack.order_index.asc())
    
    result = await db.execute(query)
    racks = result.scalars().all()
    
    final_result = []
    for rack in racks:
        loc_result = await db.execute(select(models.DeviceLocation).filter(models.DeviceLocation.rack_id == rack.id))
        locs = loc_result.scalars().all()
        
        device_locations_list = []
        for loc in locs:
            dev_res = await db.execute(select(models.Device).filter(models.Device.id == loc.device_id))
            d = dev_res.scalar_one_or_none()
            if d:
                device_locations_list.append({
                    "id": loc.id,
                    "device_id": d.id,
                    "rack_id": rack.id,
                    "start_unit": loc.start_unit,
                    "size_u": loc.size_u,
                    "orientation": loc.orientation or "Front",
                    "depth": loc.depth or "Full",
                    "device": {
                        "id": d.id,
                        "name": d.name,
                        "status": d.status,
                        "type": d.type,
                        "system": d.system,
                        "owner": d.owner,
                        "power_typical_w": d.power_typical_w or 0,
                        "power_max_w": d.power_max_w or 0,
                        "is_reservation": d.is_reservation or False,
                        "reservation_info": d.reservation_info or {},
                        "depth": d.depth or "Full"
                    }
                })
        
        site_name = "Unassigned"
        site_color = "#3b82f6"
        site_id = None
        if rack.last_site_name:
            site_name = f"Prev: {rack.last_site_name}"
        
        room = None
        if rack.room_id:
            room_res = await db.execute(select(models.Room).filter(models.Room.id == rack.room_id))
            room = room_res.scalar_one_or_none()
            if room:
                site_id = room.site_id
                site_res = await db.execute(select(models.Site).filter(models.Site.id == room.site_id))
                site = site_res.scalar_one_or_none()
                if site:
                    site_name = site.name
                    site_color = site.color

        final_result.append({
            "id": rack.id,
            "name": rack.name,
            "aisle": rack.aisle,
            "row": rack.row,
            "total_u": rack.total_u_height,
            "max_power_kw": rack.max_power_kw or 8.0,
            "pdu_a_name": rack.pdu_a_name,
            "pdu_b_name": rack.pdu_b_name,
            "pdu_a_cap_kw": rack.pdu_a_cap_kw,
            "pdu_b_cap_kw": rack.pdu_b_cap_kw,
            "room_id": rack.room_id,
            "site_id": site_id,
            "site_name": site_name,
            "site_color": site_color,
            "order_index": rack.order_index,
            "is_deleted": rack.is_deleted,
            "device_locations": device_locations_list
        })
    return final_result

@router.get("/audit-logs")
async def get_rack_audit_logs(db: AsyncSession = Depends(get_db)):
    query = select(models.AuditLog).filter(
        models.AuditLog.target_table.in_(["racks", "devices", "device_locations"])
    ).order_by(models.AuditLog.timestamp.desc()).limit(500)
    result = await db.execute(query)
    return result.scalars().all()

@router.post("/bulk-patch")
async def bulk_patch_cabling(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    # data: { connections: [{source_device_id, source_port, target_device_id, target_port, purpose, speed_gbps }] }
    conns = data.get("connections", [])
    for c in conns:
        conn = models.PortConnection(
            source_device_id=c["source_device_id"],
            source_port=c["source_port"],
            target_device_id=c["target_device_id"],
            target_port=c["target_port"],
            purpose=c.get("purpose", "Data"),
            speed_gbps=c.get("speed_gbps", 10.0),
            status="Active"
        )
        db.add(conn)
    
    log = build_audit_log(
        request=request,
        action="BULK_PATCH",
        target_table="port_connections",
        target_id="bulk",
        description=f"Created {len(conns)} inter-rack connections",
        changes={"connection_count": len(conns)}
    )
    db.add(log)
    await db.commit()
    return {"status": "success", "count": len(conns)}

@router.post("/reorder")
async def reorder_racks(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    # Expected format: {"ids": [3, 1, 2]}
    ids = data.get("ids", [])
    for index, rack_id in enumerate(ids):
        await db.execute(
            update(models.Rack)
            .where(models.Rack.id == rack_id)
            .values(order_index=index)
        )
    
    log = build_audit_log(
        request=request,
        action="REORDER",
        target_table="racks",
        target_id="bulk",
        description="Reordered racks in site/room",
        changes={"order": ids}
    )
    db.add(log)
    await db.commit()
    return {"status": "success"}

@router.post("")
async def create_rack(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    site_id = data.get('site_id')
    if not site_id:
        raise HTTPException(status_code=400, detail="Site selection mandatory")
    
    name = data.get('name', 'New Rack')
    
    room_res = await db.execute(select(models.Room).filter(models.Room.site_id == int(site_id)))
    room = room_res.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=400, detail="Site has no rooms")

    # Check for duplicate name within the same site (via room)
    dup_result = await db.execute(select(models.Rack).filter(models.Rack.name == name, models.Rack.room_id == room.id))
    if dup_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="RACK_NAME_DUPLICATE")

    # Get max order index for this room
    max_res = await db.execute(select(func.max(models.Rack.order_index)).filter(models.Rack.room_id == room.id))
    max_order = max_res.scalar() or 0

    rack = models.Rack(
        name=name,
        aisle=data.get('aisle'),
        row=data.get('row'),
        total_u_height=data.get('total_u', 42),
        max_power_kw=data.get('max_power_kw', 8.0),
        pdu_a_name=data.get('pdu_a_name', 'PDU-A'),
        pdu_b_name=data.get('pdu_b_name', 'PDU-B'),
        pdu_a_cap_kw=data.get('pdu_a_cap_kw', 10.0),
        pdu_b_cap_kw=data.get('pdu_b_cap_kw', 10.0),
        room_id=room.id,
        order_index=max_order + 1
    )
    db.add(rack)
    await db.commit()
    await db.refresh(rack)
    
    log = build_audit_log(
        request=request,
        action="CREATE",
        target_table="racks",
        target_id=str(rack.id),
        description=f"Provisioned rack {rack.name} at site ID {site_id}",
        changes={
            "name": rack.name,
            "aisle": rack.aisle,
            "row": rack.row,
            "total_u": rack.total_u_height,
            "max_power_kw": rack.max_power_kw,
            "pdu_a": rack.pdu_a_name,
            "pdu_b": rack.pdu_b_name
        }
    )
    db.add(log)
    await db.commit()
    return rack

@router.put("/{rack_id}")
async def update_rack(rack_id: int, data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Rack).filter(models.Rack.id == rack_id))
    rack = result.scalar_one_or_none()
    if not rack:
        raise HTTPException(status_code=404, detail="Rack not found")
    
    changes = {}
    if 'name' in data and data['name'] != rack.name:
        # Check for duplicate name in ANOTHER rack within the SAME site
        current_room_id = rack.room_id
        dup_result = await db.execute(select(models.Rack).filter(
            models.Rack.name == data['name'], 
            models.Rack.room_id == current_room_id,
            models.Rack.id != rack_id
        ))
        if dup_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="RACK_NAME_DUPLICATE_IN_SITE")
        changes["name"] = {"old": rack.name, "new": data["name"]}
        rack.name = data['name']
    
    if 'aisle' in data and data['aisle'] != rack.aisle: 
        changes["aisle"] = {"old": rack.aisle, "new": data["aisle"]}
        rack.aisle = data['aisle']
    if 'row' in data and data['row'] != rack.row: 
        changes["row"] = {"old": rack.row, "new": data["row"]}
        rack.row = data['row']
    if 'max_power_kw' in data and data['max_power_kw'] != rack.max_power_kw: 
        changes["max_power_kw"] = {"old": rack.max_power_kw, "new": data["max_power_kw"]}
        rack.max_power_kw = data['max_power_kw']

    if 'pdu_a_name' in data and data['pdu_a_name'] != rack.pdu_a_name:
        changes["pdu_a_name"] = {"old": rack.pdu_a_name, "new": data["pdu_a_name"]}
        rack.pdu_a_name = data['pdu_a_name']
    if 'pdu_b_name' in data and data['pdu_b_name'] != rack.pdu_b_name:
        changes["pdu_b_name"] = {"old": rack.pdu_b_name, "new": data["pdu_b_name"]}
        rack.pdu_b_name = data['pdu_b_name']
    if 'pdu_a_cap_kw' in data and data['pdu_a_cap_kw'] != rack.pdu_a_cap_kw:
        changes["pdu_a_cap_kw"] = {"old": rack.pdu_a_cap_kw, "new": data["pdu_a_cap_kw"]}
        rack.pdu_a_cap_kw = data['pdu_a_cap_kw']
    if 'pdu_b_cap_kw' in data and data['pdu_b_cap_kw'] != rack.pdu_b_cap_kw:
        changes["pdu_b_cap_kw"] = {"old": rack.pdu_b_cap_kw, "new": data["pdu_b_cap_kw"]}
        rack.pdu_b_cap_kw = data['pdu_b_cap_kw']

    if 'total_u' in data and data['total_u'] != rack.total_u_height: 
        new_total = data['total_u']
        if new_total < rack.total_u_height:
            # Check if any devices are mounted above the new limit
            loc_res = await db.execute(select(models.DeviceLocation).filter(
                models.DeviceLocation.rack_id == rack_id,
                (models.DeviceLocation.start_unit + models.DeviceLocation.size_u - 1) > new_total
            ))
            if loc_res.scalars().first():
                raise HTTPException(status_code=400, detail="RACK_SHRINK_CONFLICT: Units to be removed are occupied")
        changes["total_u"] = {"old": rack.total_u_height, "new": new_total}
        rack.total_u_height = new_total
    
    if 'new_site_id' in data:
        if data['new_site_id'] is None:
            changes["room_id"] = {"old": rack.room_id, "new": None}
            rack.room_id = None
        else:
            room_res = await db.execute(select(models.Room).filter(models.Room.site_id == int(data['new_site_id'])))
            new_room = room_res.scalar_one_or_none()
            if not new_room:
                raise HTTPException(status_code=400, detail="Target site has no rooms for relocation")
            
            # Check for duplicate name in the TARGET site
            dup_target_res = await db.execute(select(models.Rack).filter(
                models.Rack.name == rack.name, # Use current rack name for checking
                models.Rack.room_id == new_room.id,
                models.Rack.id != rack_id
            ))
            if dup_target_res.scalar_one_or_none():
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="RACK_NAME_DUPLICATE_IN_TARGET_SITE")
            
            changes["room_id"] = {"old": rack.room_id, "new": new_room.id}
            rack.room_id = new_room.id
    
    log = build_audit_log(
        request=request,
        action="UPDATE",
        target_table="racks",
        target_id=str(rack.id),
        description=f"Updated rack {rack.name} configuration",
        changes=changes
    )
    db.add(log)
    await db.commit()
    return rack

@router.delete("/{rack_id}")
async def delete_rack(rack_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Rack).filter(models.Rack.id == rack_id))
    rack = result.scalar_one_or_none()
    if not rack:
        raise HTTPException(status_code=404, detail="Rack not found")
    
    name = rack.name
    rack.is_deleted = True
    log = build_audit_log(
        request=request,
        action="SOFT_DELETE",
        target_table="racks",
        target_id=str(rack_id),
        description=f"Soft-deleted rack {name}",
        changes={"is_deleted": True}
    )
    db.add(log)
    await db.commit()
    return {"status": "success"}

@router.post("/{rack_id}/mount")
async def mount_device(rack_id: int, data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    device_id = int(data['device_id'])

    # Get rack info
    rack_res = await db.execute(select(models.Rack).filter(models.Rack.id == rack_id))
    rack = rack_res.scalar_one_or_none()
    if not rack:
        raise HTTPException(status_code=404, detail="Rack not found")

    # Get device info for logging
    dev_res = await db.execute(select(models.Device).filter(models.Device.id == device_id))
    device = dev_res.scalar_one_or_none()

    # Get ALL existing locations for this device in ACTIVE racks
    loc_res = await db.execute(
        select(models.DeviceLocation)
        .join(models.Rack, models.DeviceLocation.rack_id == models.Rack.id)
        .filter(models.DeviceLocation.device_id == device_id, models.Rack.is_deleted == False)
    )
    existing_locs = loc_res.scalars().all()

    if existing_locs and not data.get('relocate'):
        existing_loc = existing_locs[0]
        r_res = await db.execute(select(models.Rack).filter(models.Rack.id == existing_loc.rack_id))
        r = r_res.scalar_one_or_none()
        
        # Return structured data for frontend to handle confirmation
        return JSONResponse(
            status_code=409, 
            content={
                "type": "RELOCATION_CONFLICT",
                "detail": f"{r.name if r else 'another rack'} at U{existing_loc.start_unit}",
                "rackId": rack_id,
                "payload": data
            }
        )

    rack_locs_res = await db.execute(select(models.DeviceLocation).filter(models.DeviceLocation.rack_id == rack_id))
    rack_locs = rack_locs_res.scalars().all()

    new_start = int(data['start_u'])
    new_size_u = int(data['size_u'])
    new_end = new_start + new_size_u

    # SAFETY: Check if mount exceeds rack height
    if new_start + new_size_u - 1 > rack.total_u_height:
        raise HTTPException(status_code=400, detail=f"RACK_OVERFLOW: Device exceeds max U height of {rack.total_u_height}")

    for loc in rack_locs:
        if loc.device_id == device_id: continue
        loc_end = loc.start_unit + loc.size_u
        if not (new_end <= loc.start_unit or new_start >= loc_end):
            dev_res = await db.execute(select(models.Device).filter(models.Device.id == loc.device_id))
            d = dev_res.scalar_one_or_none()
            raise HTTPException(status_code=400, detail=f"Collision with {d.name if d else 'existing device'} at U{loc.start_unit}")

    # Delete ANY existing locations (cleanup stale/deleted-rack locations + prepare for new location)
    await db.execute(delete(models.DeviceLocation).where(models.DeviceLocation.device_id == device_id))

    loc = models.DeviceLocation(
        rack_id=rack_id,
        device_id=device_id,
        start_unit=new_start,
        size_u=new_size_u,
        orientation=data.get('orientation', 'Front'),
        depth=data.get('depth', 'Full')
    )
    db.add(loc)

    log = build_audit_log(
        request=request,
        action="MOUNT",
        target_table="devices",
        target_id=str(device_id),
        description=f"Mounted {device.name if device else device_id} in rack {rack.name} at U{new_start}",
        changes={
            "rack_id": rack_id,
            "start_unit": new_start,
            "size_u": new_size_u,
            "orientation": loc.orientation,
            "depth": loc.depth
        }
    )
    db.add(log)
    await db.commit()
    return {"status": "success"}

@router.post("/bulk-action")
async def bulk_action(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    ids = data.get("ids", [])
    action = data.get("action")
    payload = data.get("payload", {})
    if not ids: return {"status": "no_op"}

    if action == "delete": # Soft delete
        await db.execute(update(models.Rack).where(models.Rack.id.in_(ids)).values(is_deleted=True))
        log = build_audit_log(
            request=request, action="BULK_DELETE", target_table="racks", target_id="bulk",
            description=f"Soft-deleted {len(ids)} racks", changes={"ids": ids}
        )
        db.add(log)
    elif action == "purge": # Hard delete
        await db.execute(delete(models.Rack).where(models.Rack.id.in_(ids)))
        log = build_audit_log(
            request=request, action="BULK_PURGE", target_table="racks", target_id="bulk",
            description=f"Permanently purged {len(ids)} racks", changes={"ids": ids}
        )
        db.add(log)
    elif action == "restore":
        res = await db.execute(select(models.Rack).where(models.Rack.id.in_(ids)))
        racks_to_restore = res.scalars().all()

        # If payload contains new_site_id, reassign racks to that site
        new_site_id = payload.get("new_site_id") if payload else None
        renames = payload.get("renames", {}) if payload else {}
        new_room = None
        if new_site_id:
            room_res = await db.execute(select(models.Room).filter(models.Room.site_id == int(new_site_id)))
            new_room = room_res.scalar_one_or_none()
            if not new_room:
                raise HTTPException(status_code=400, detail="Target site has no rooms for restoration")

        restored_ids, conflict_ids = [], []
        for r in racks_to_restore:
            # Use new_room if provided, otherwise use existing room_id
            target_room_id = new_room.id if new_room else r.room_id

            room_res = await db.execute(select(models.Room).filter(models.Room.id == target_room_id))
            room = room_res.scalar_one_or_none()
            if room:
                # Check for name conflict using final name (possibly renamed)
                final_name = renames.get(str(r.id), r.name)
                dup_res = await db.execute(select(models.Rack).filter(
                    models.Rack.name == final_name,
                    models.Rack.room_id == room.id,
                    models.Rack.is_deleted == False
                ))
                if dup_res.scalar_one_or_none():
                    conflict_ids.append(r.id)
                else:
                    r.is_deleted = False
                    if new_room:
                        r.room_id = new_room.id
                    if str(r.id) in renames:
                        r.name = renames[str(r.id)]
                    restored_ids.append(r.id)
            else: # If rack has no room, it can be restored directly (standalone)
                r.is_deleted = False
                if new_room:
                    r.room_id = new_room.id
                if str(r.id) in renames:
                    r.name = renames[str(r.id)]
                restored_ids.append(r.id)
        
        log = build_audit_log(
            request=request, action="BULK_RESTORE", target_table="racks", target_id="bulk",
            description=f"Restored {len(restored_ids)} racks", changes={"ids": restored_ids, "site_id": new_site_id}
        )
        db.add(log)
        await db.commit()
        return {"status": "success", "restored": restored_ids, "conflicts": conflict_ids}

    elif action == "relocate":
        new_site_id = payload.get("new_site_id")
        if not new_site_id: raise HTTPException(400, "Target site ID is mandatory for relocation")
        
        room_res = await db.execute(select(models.Room).filter(models.Room.site_id == int(new_site_id)))
        new_room = room_res.scalar_one_or_none()
        if not new_room: raise HTTPException(400, "Target site has no rooms for relocation")
        
        res = await db.execute(select(models.Rack).where(models.Rack.id.in_(ids)))
        racks_to_relocate = res.scalars().all()
        
        relocated_ids, conflict_ids = [], []
        for r in racks_to_relocate:
            # Check for duplicate name in the TARGET site
            dup_target_res = await db.execute(select(models.Rack).filter(
                models.Rack.name == r.name,
                models.Rack.room_id == new_room.id,
                models.Rack.id != r.id,
                models.Rack.is_deleted == False
            ))
            if dup_target_res.scalar_one_or_none():
                conflict_ids.append(r.id)
            else:
                r.room_id = new_room.id
                relocated_ids.append(r.id)
        
        log = build_audit_log(
            request=request, action="BULK_RELOCATE", target_table="racks", target_id="bulk",
            description=f"Relocated {len(relocated_ids)} racks to site {new_site_id}", changes={"ids": relocated_ids, "new_site_id": new_site_id}
        )
        db.add(log)
        await db.commit()
        return {"status": "success", "relocated": relocated_ids, "conflicts": conflict_ids}
    else:
        raise HTTPException(status_code=400, detail="Unsupported bulk action")
    
    await db.commit()
    return {"status": "success"}

@router.post("/move")
async def move_device(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    device_id = int(data.get("device_id"))
    target_rack_id = int(data.get("target_rack_id"))
    target_start_u = int(data.get("target_start_u"))
    
    # 1. Get device and its current location
    dev_res = await db.execute(select(models.Device).filter(models.Device.id == device_id))
    device = dev_res.scalar_one_or_none()
    if not device: raise HTTPException(404, "Device not found")
    
    # 2. Check target rack
    rack_res = await db.execute(select(models.Rack).filter(models.Rack.id == target_rack_id))
    rack = rack_res.scalar_one_or_none()
    if not rack: raise HTTPException(404, "Target rack not found")
    
    # 2.5 Safety Check: Max height
    size = device.size_u or 1
    if target_start_u + size - 1 > rack.total_u_height:
        raise HTTPException(status_code=400, detail=f"RACK_OVERFLOW: Device exceeds max U height of {rack.total_u_height}")

    # 3. Conflict check (simplified for sandbox, but good practice)
    conf_res = await db.execute(
        select(models.DeviceLocation)
        .filter(
            models.DeviceLocation.rack_id == target_rack_id,
            models.DeviceLocation.device_id != device_id,
            models.DeviceLocation.start_unit < target_start_u + size,
            models.DeviceLocation.start_unit + models.DeviceLocation.size_u > target_start_u
        )
    )
    if conf_res.scalars().first():
        raise HTTPException(409, "Target slot is occupied")

    # Clear existing location
    await db.execute(delete(models.DeviceLocation).filter(models.DeviceLocation.device_id == device_id))
    
    # Create new location
    new_loc = models.DeviceLocation(
        device_id=device_id,
        rack_id=target_rack_id,
        start_unit=target_start_u,
        size_u=size
    )
    db.add(new_loc)
    
    log = build_audit_log(
        request=request,
        action="MOVE",
        target_table="devices",
        target_id=str(device_id),
        description=f"Moved {device.name} to {rack.name} U{target_start_u} (Interactive)",
        changes={"rack_id": target_rack_id, "start_unit": target_start_u}
    )
    db.add(log)

    await db.commit()
    return {"status": "success"}

@router.delete("/mount/{device_id}")
async def unmount_device(device_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    # Get device for logging
    dev_res = await db.execute(select(models.Device).filter(models.Device.id == device_id))
    device = dev_res.scalar_one_or_none()

    # Delete ALL locations for this device (should only be 1, but cleanup stale duplicates)
    await db.execute(delete(models.DeviceLocation).where(models.DeviceLocation.device_id == device_id))

    log = build_audit_log(
        request=request,
        action="UNMOUNT",
        target_table="devices",
        target_id=str(device_id),
        description=f"Removed {device.name if device else device_id} from rack",
        changes={"device_id": device_id}
    )
    db.add(log)
    await db.commit()
    return {"status": "success"}
