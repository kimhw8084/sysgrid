from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update, or_, func
from datetime import datetime
from typing import Optional
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
    prefix="/devices",
    tags=["Devices"],
    dependencies=[Depends(require_module_access("assets"))],
)

async def sync_device_to_os(device, db: AsyncSession):
    if device.os_name:
        # Check if OS service already exists for this device
        result = await db.execute(select(models.LogicalService).filter(
            models.LogicalService.device_id == device.id,
            models.LogicalService.service_type == "OS",
            models.LogicalService.is_deleted == False
        ))
        svc = result.scalar_one_or_none()
        
        if svc:
            svc.name = device.os_name
            svc.version = device.os_version
            svc.environment = device.environment or svc.environment or "Production"
        else:
            svc = models.LogicalService(
                device_id=device.id,
                name=device.os_name,
                version=device.os_version,
                service_type="OS",
                status="Active",
                environment=device.environment or "Production"
            )
            db.add(svc)
        # No internal commit here, calling code handles it

@router.get("")
async def get_devices(request: Request, system: Optional[str] = None, include_deleted: bool = False, db: AsyncSession = Depends(get_db)):
    tenant_id = request.state.tenant_id
    from sqlalchemy.orm import selectinload
    
    query = select(models.Device).options(
        selectinload(models.Device.network_interfaces),
        selectinload(models.Device.logical_services)
    ).filter(models.Device.tenant_id == tenant_id)
    if not include_deleted:
        query = query.filter(models.Device.is_deleted == False)
    
    if system:
        query = query.filter(models.Device.system == system)
        
    result = await db.execute(query)
    devices = result.scalars().all()
    
    if not devices:
        return []

    device_ids = [d.id for d in devices]
    
    # Batch fetch locations
    loc_res = await db.execute(select(models.DeviceLocation).filter(models.DeviceLocation.device_id.in_(device_ids)))
    locations = {l.device_id: l for l in loc_res.scalars().all()}
    
    # Batch fetch hardware components for summary
    hw_res = await db.execute(select(models.HardwareComponent).filter(models.HardwareComponent.device_id.in_(device_ids)))
    hw_all = hw_res.scalars().all()
    hw_map = {}
    for h in hw_all:
        if h.device_id not in hw_map: hw_map[h.device_id] = []
        hw_map[h.device_id].append(h)

    # Batch fetch open incidents
    inc_res = await db.execute(select(models.IncidentLog).filter(
        models.IncidentLog.status != "Resolved",
        models.IncidentLog.status != "Prevented"
    ))
    inc_all = inc_res.scalars().all()
    inc_map = {}
    target_device_ids_set = set(device_ids)
    for inc in inc_all:
        impacted = inc.impacted_device_ids or []
        for did in impacted:
            if did in target_device_ids_set:
                inc_map[did] = inc_map.get(did, 0) + 1
    
    rack_ids = {l.rack_id for l in locations.values() if l.rack_id}
    racks = {}
    if rack_ids:
        rack_res = await db.execute(select(models.Rack).filter(models.Rack.id.in_(list(rack_ids))))
        racks = {r.id: r for r in rack_res.scalars().all()}
    
    room_ids = {r.room_id for r in racks.values() if r.room_id}
    rooms = {}
    if room_ids:
        room_res = await db.execute(select(models.Room).filter(models.Room.id.in_(list(room_ids))))
        rooms = {rm.id: rm for rm in room_res.scalars().all()}
        
    site_ids = {rm.site_id for rm in rooms.values() if rm.site_id}
    sites = {}
    if site_ids:
        site_res = await db.execute(select(models.Site).filter(models.Site.id.in_(list(site_ids))))
        sites = {s.id: s for s in site_res.scalars().all()}

    final_devices = []
    for d in devices:
        device_dict = {c.name: getattr(d, c.name) for c in d.__table__.columns}
        
        # Format dates for JSON
        for date_field in ["purchase_date", "install_date", "warranty_end", "eol_date"]:
            val = getattr(d, date_field)
            if val: device_dict[date_field] = val.isoformat()

        # Hardware Summary (Resource Snapshot)
        comps = hw_map.get(d.id, [])
        hw_summary = []
        cpu = sum(c.count for c in comps if c.category == 'CPU')
        mem = sum(c.count for c in comps if c.category == 'Memory')
        disk = sum(c.count for c in comps if c.category == 'Disk')
        # Clever summary: check specs too if possible? 
        # Actually count is most straightforward for now.
        if cpu: hw_summary.append(f"{cpu}x CPU")
        if mem: hw_summary.append(f"{mem}x MEM")
        if disk: hw_summary.append(f"{disk}x DSK")
        device_dict["hardware_summary"] = " / ".join(hw_summary) if hw_summary else "No Components"

        # Hardware Age
        age_str = "N/A"
        ref_date = d.install_date or d.purchase_date
        if ref_date:
            delta = datetime.now() - ref_date
            years = delta.days // 365
            months = (delta.days % 365) // 30
            if years > 0: age_str = f"{years}y {months}m"
            else: age_str = f"{months}m"
        device_dict["hardware_age"] = age_str

        # Incidents Indicator
        device_dict["open_incident_count"] = inc_map.get(d.id, 0)

        # Logical Services
        device_dict["logical_services"] = [
            {"id": s.id, "name": s.name, "service_type": s.service_type, "status": s.status}
            for s in d.logical_services if not s.is_deleted
        ]

        # Multi-IP Summary
        ips = [i.ip_address for i in d.network_interfaces if i.ip_address]
        device_dict["all_ips"] = ips

        loc = locations.get(d.id)
        rack_name, site_name, u_start = None, "Unplaced", None
        
        if loc:
            u_start = loc.start_unit
            rack = racks.get(loc.rack_id)
            if rack:
                rack_name = rack.name
                room = rooms.get(rack.room_id)
                if room:
                    site = sites.get(room.site_id)
                    if site:
                        site_name = site.name

        device_dict.update({
            "rack_name": rack_name, 
            "site_name": site_name, 
            "u_start": u_start, 
            "size_u": d.size_u,
            "mount_orientation": loc.orientation if loc else None,
            "mount_depth": loc.depth if loc else None
        })
        final_devices.append(device_dict)
    return final_devices


@router.get("/summary")
async def get_devices_summary(
    request: Request,
    system: Optional[str] = None,
    include_deleted: bool = False,
    limit: int = 200,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    tenant_id = request.state.tenant_id
    query = select(models.Device).filter(models.Device.tenant_id == tenant_id)
    if not include_deleted:
        query = query.filter(models.Device.is_deleted == False)
    if system:
        query = query.filter(models.Device.system == system)
    query = query.order_by(models.Device.updated_at.desc(), models.Device.id.desc()).offset(max(offset, 0)).limit(min(max(limit, 1), 500))

    result = await db.execute(query)
    devices = result.scalars().all()
    return [
        {
            "id": device.id,
            "name": device.name,
            "system": device.system,
            "environment": device.environment,
            "status": device.status,
            "type": device.type,
            "owner": device.owner,
            "vendor": device.vendor,
            "primary_ip": device.primary_ip,
            "management_ip": device.management_ip,
            "updated_at": device.updated_at.isoformat() if device.updated_at else None,
        }
        for device in devices
    ]

@router.get("/{device_id}/interfaces")
async def get_device_interfaces(request: Request, device_id: int, db: AsyncSession = Depends(get_db)):
    # Fetch interfaces for the device
    res = await db.execute(select(models.NetworkInterface).filter(models.NetworkInterface.device_id == device_id))
    interfaces = res.scalars().all()
    
    # Fetch all connections involving this device to map to interfaces
    conn_res = await db.execute(select(models.PortConnection).filter(
        or_(
            models.PortConnection.source_device_id == device_id,
            models.PortConnection.target_device_id == device_id
        )
    ))
    connections = conn_res.scalars().all()
    
    result = []
    for i in interfaces:
        iface_dict = {c.name: getattr(i, c.name) for c in i.__table__.columns}
        
        # Find connection matching this interface name (port)
        conn = next((c for c in connections if 
            (c.source_device_id == device_id and c.source_port == i.name) or
            (c.target_device_id == device_id and c.target_port == i.name)
        ), None)
        
        if conn:
            peer_device_id = conn.target_device_id if conn.source_device_id == device_id else conn.source_device_id
            peer_port = conn.target_port if conn.source_device_id == device_id else conn.source_port
            peer_ip = conn.target_ip if conn.source_device_id == device_id else conn.source_ip
            peer_mac = conn.target_mac if conn.source_device_id == device_id else conn.source_mac
            peer_vlan = conn.target_vlan if conn.source_device_id == device_id else conn.source_vlan
            
            # Local side info from the connection record
            local_mac = conn.source_mac if conn.source_device_id == device_id else conn.target_mac
            local_vlan = conn.source_vlan if conn.source_device_id == device_id else conn.target_vlan
            local_ip = conn.source_ip if conn.source_device_id == device_id else conn.target_ip

            peer_res = await db.execute(select(models.Device).filter(models.Device.id == peer_device_id))
            peer_dev = peer_res.scalar_one_or_none()
            
            iface_dict["connection"] = {
                "id": conn.id,
                "source_device_id": conn.source_device_id,
                "target_device_id": conn.target_device_id,
                "source_port": conn.source_port,
                "target_port": conn.target_port,
                "source_ip": conn.source_ip,
                "target_ip": conn.target_ip,
                "source_mac": conn.source_mac,
                "target_mac": conn.target_mac,
                "source_vlan": conn.source_vlan,
                "target_vlan": conn.target_vlan,
                "direction": conn.direction,
                "unit": conn.unit,
                "peer_device_id": peer_device_id,
                "peer_device_name": peer_dev.name if peer_dev else "Unknown",
                "peer_port": peer_port,
                "peer_ip": peer_ip,
                "peer_mac": peer_mac,
                "peer_vlan": peer_vlan,
                "local_ip": local_ip,
                "local_mac": local_mac,
                "local_vlan": local_vlan,
                "link_type": conn.link_type,
                "purpose": conn.purpose,
                "speed_gbps": conn.speed_gbps,
                "status": "Connected"
            }
        else:
            iface_dict["connection"] = None
            
        result.append(iface_dict)
        
    return result

@router.post("")
async def create_device(request: Request, data: dict, db: AsyncSession = Depends(get_db)):
    tenant_id = request.state.tenant_id
    required = ["name", "system"]
    for f in required:
        if not data.get(f): raise HTTPException(400, f"Field {f} is mandatory")
    
    # Case-insensitive duplicate check
    dup_res = await db.execute(select(models.Device).filter(
        func.lower(models.Device.name) == data["name"].lower(), 
        models.Device.tenant_id == tenant_id,
        models.Device.is_deleted == False
    ))
    if dup_res.scalars().first():
        raise HTTPException(409, "DUPLICATE_HOSTNAME")

    clean_data = filter_valid_columns(models.Device, data)
    for date_f in ["purchase_date", "install_date", "warranty_end", "eol_date"]:
        if date_f in clean_data: clean_data[date_f] = parse_iso_date(clean_data[date_f])
    
    db_device = models.Device(**clean_data, tenant_id=tenant_id)
    db.add(db_device)
    await db.flush() # Flush to get ID

    # Sync OS to services
    await sync_device_to_os(db_device, db)
    
    await db.commit()
    await db.refresh(db_device)

    # Re-fetch for full response consistency (all enriched fields)
    res_list = await get_devices(request=request, include_deleted=True, db=db)
    return next((x for x in res_list if x["id"] == db_device.id), None)


@router.put("/{device_id}")
async def update_device(request: Request, device_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    tenant_id = request.state.tenant_id
    result = await db.execute(select(models.Device).filter(models.Device.id == device_id, models.Device.tenant_id == tenant_id))
    db_device = result.scalar_one_or_none()
    if not db_device: raise HTTPException(404)
    
    if 'name' in data and data['name'].lower() != db_device.name.lower():
        # Check for duplicate name in ANOTHER active device (case-insensitive)
        dup_res = await db.execute(select(models.Device).filter(
            func.lower(models.Device.name) == data["name"].lower(), 
            models.Device.is_deleted == False, 
            models.Device.id != device_id,
            models.Device.tenant_id == tenant_id
        ))
        if dup_res.scalars().first():
            raise HTTPException(409, "DUPLICATE_HOSTNAME")

    clean_data = filter_valid_columns(models.Device, data)
    # Exclude read-only fields
    for ro_field in ["id", "created_at", "updated_at", "created_by_user_id"]:
        if ro_field in clean_data:
            del clean_data[ro_field]

    for k, v in clean_data.items():
        if k in ["purchase_date", "install_date", "warranty_end", "eol_date"]:
            # Ensure we only pass datetime objects or None to SQLAlchemy for DateTime columns
            setattr(db_device, k, parse_iso_date(v))
        elif k == "metadata_json" and isinstance(v, str):
            try:
                import json
                setattr(db_device, k, json.loads(v))
            except:
                setattr(db_device, k, v)
        else:
            setattr(db_device, k, v)
    
    # Sync OS to services
    await sync_device_to_os(db_device, db)
    
    await db.commit()
    await db.refresh(db_device)
    return db_device

@router.post("/bulk-action")
async def bulk_action(request: Request, data: dict, db: AsyncSession = Depends(get_db)):
    tenant_id = request.state.tenant_id
    raw_ids = data.get("ids", [])
    if raw_ids == []:
        return {
            "status": "no_op",
            "action": data.get("action"),
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
    action = str(data.get("action") or "").strip().lower()
    payload = normalize_operational_bulk_payload(data.get("payload"))
    dry_run = bool(data.get("dry_run"))
    if action not in {"update", "delete", "restore", "purge"}:
        raise HTTPException(status_code=400, detail="Unsupported asset bulk action")

    result = await db.execute(
        select(models.Device)
        .where(models.Device.id.in_(ids))
        .filter(models.Device.tenant_id == tenant_id)
    )
    devices = list(result.scalars().all())
    by_id = {device.id: device for device in devices}
    matched_ids = [record_id for record_id in ids if record_id in by_id]
    changed_ids: list[int] = []
    unchanged_ids: list[int] = []
    blockers: list[dict] = []
    clean_update: dict = {}

    if action == "update":
        protected_fields = {"id", "tenant_id", "created_at", "updated_at", "created_by_user_id", "is_deleted"}
        clean_update = {
            key: value
            for key, value in filter_valid_columns(models.Device, payload).items()
            if key not in protected_fields and value is not None
        }
        unsupported = sorted(set(payload) - set(clean_update) - protected_fields)
        if unsupported:
            raise HTTPException(status_code=400, detail=f"Unsupported asset bulk fields: {', '.join(unsupported)}")
        if not clean_update:
            raise HTTPException(status_code=400, detail="Asset bulk update requires at least one mutable field")
        for record_id in matched_ids:
            device = by_id[record_id]
            if device.is_deleted:
                blockers.append({"id": record_id, "name": device.name, "reason": "Restore this asset before updating it"})
            elif any(getattr(device, key) != value for key, value in clean_update.items()):
                changed_ids.append(record_id)
            else:
                unchanged_ids.append(record_id)
    elif action == "delete":
        for record_id in matched_ids:
            device = by_id[record_id]
            (unchanged_ids if device.is_deleted else changed_ids).append(record_id)
    elif action == "restore":
        for record_id in matched_ids:
            device = by_id[record_id]
            if not device.is_deleted:
                unchanged_ids.append(record_id)
                continue
            duplicate = await db.execute(
                select(models.Device.id).filter(
                    models.Device.tenant_id == tenant_id,
                    models.Device.name == device.name,
                    models.Device.is_deleted == False,
                    models.Device.id != device.id,
                )
            )
            if duplicate.scalars().first():
                blockers.append({"id": record_id, "name": device.name, "reason": "An active asset already uses this hostname"})
            else:
                changed_ids.append(record_id)
    else:  # purge
        changed_ids.extend(matched_ids)
        # Normalized traceability is historical record, so a hard purge is
        # blocked even when the link itself is retired. Soft delete remains
        # the lifecycle operation for an asset with traceability history.
        from ..architecture.models import ArchitectureDeviceLink
        from ..pv1.models import PV1TraceabilityLink
        architecture_link_ids = set((await db.execute(
            select(ArchitectureDeviceLink.device_id).where(
                ArchitectureDeviceLink.tenant_id == tenant_id,
                ArchitectureDeviceLink.device_id.in_(matched_ids),
            )
        )).scalars().all())
        work_link_ids = set((await db.execute(
            select(PV1TraceabilityLink.device_id).where(
                PV1TraceabilityLink.tenant_id == tenant_id,
                PV1TraceabilityLink.device_id.in_(matched_ids),
            )
        )).scalars().all())
        protected_ids = architecture_link_ids | work_link_ids
        if protected_ids:
            blockers.extend({"id": record_id, "name": by_id[record_id].name, "reason": "Hard purge would destroy normalized traceability history"} for record_id in matched_ids if record_id in protected_ids)
            changed_ids = [record_id for record_id in changed_ids if record_id not in protected_ids]

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
    if action == "restore":
        compatibility["restored"] = changed_ids
        compatibility["conflicts"] = [blocker["id"] for blocker in blockers]
    if dry_run or not changed_ids:
        return compatibility

    require_executable_operational_bulk(summary)

    if action == "update":
        for record_id in changed_ids:
            device = by_id[record_id]
            for key, value in clean_update.items():
                setattr(device, key, value)
            await sync_device_to_os(device, db)
    elif action == "delete":
        await db.execute(
            update(models.Device)
            .where(models.Device.id.in_(changed_ids))
            .values(is_deleted=True)
        )
    elif action == "restore":
        await db.execute(
            update(models.Device)
            .where(models.Device.id.in_(changed_ids))
            .values(is_deleted=False)
        )
    else:
        tenant_device_ids = changed_ids
        await db.execute(delete(models.ExternalLink).where(models.ExternalLink.device_id.in_(tenant_device_ids)))
        await db.execute(delete(models.DeviceLocation).where(models.DeviceLocation.device_id.in_(tenant_device_ids)))
        await db.execute(delete(models.HardwareComponent).where(models.HardwareComponent.device_id.in_(tenant_device_ids)))
        await db.execute(delete(models.SecretVault).where(models.SecretVault.device_id.in_(tenant_device_ids)))
        await db.execute(delete(models.MaintenanceWindow).where(models.MaintenanceWindow.device_id.in_(tenant_device_ids)))
        monitoring_result = await db.execute(select(models.MonitoringItem.id).where(models.MonitoringItem.device_id.in_(tenant_device_ids)))
        monitoring_ids = list(monitoring_result.scalars().all())
        if monitoring_ids:
            await db.execute(delete(models.MonitoringHistory).where(models.MonitoringHistory.monitoring_item_id.in_(monitoring_ids)))
            await db.execute(delete(models.MonitoringOwner).where(models.MonitoringOwner.monitoring_item_id.in_(monitoring_ids)))
            await db.execute(delete(models.MonitoringItem).where(models.MonitoringItem.id.in_(monitoring_ids)))
        await db.execute(delete(models.DeviceRelationship).where(
            or_(
                models.DeviceRelationship.source_device_id.in_(tenant_device_ids),
                models.DeviceRelationship.target_device_id.in_(tenant_device_ids),
            )
        ))
        await db.execute(delete(models.PortConnection).where(
            or_(
                models.PortConnection.source_device_id.in_(tenant_device_ids),
                models.PortConnection.target_device_id.in_(tenant_device_ids),
            )
        ))
        await db.execute(update(models.LogicalService).where(models.LogicalService.device_id.in_(tenant_device_ids)).values(device_id=None))
        await db.execute(update(models.FirewallRule).where(models.FirewallRule.source_device_id.in_(tenant_device_ids)).values(source_device_id=None))
        await db.execute(update(models.FirewallRule).where(models.FirewallRule.dest_device_id.in_(tenant_device_ids)).values(dest_device_id=None))
        await db.execute(delete(models.far_mode_assets).where(models.far_mode_assets.c.device_id.in_(tenant_device_ids)))
        await db.execute(delete(models.Device).where(models.Device.id.in_(tenant_device_ids)))

    await db.commit()
    return compatibility

@router.get("/{device_id}/hardware")
async def get_hardware(request: Request, device_id: int, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(models.HardwareComponent).filter(models.HardwareComponent.device_id == device_id))
    return res.scalars().all()

@router.post("/{device_id}/hardware")
async def add_hardware(request: Request, device_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    # Audit: Ensure data is not empty
    if not data or not any(data.values()): raise HTTPException(400, "Empty hardware data")
    clean = filter_valid_columns(models.HardwareComponent, data)
    comp = models.HardwareComponent(device_id=device_id, **clean)
    db.add(comp); await db.commit(); return comp

@router.get("/{device_id}/secrets")
async def get_secrets(request: Request, device_id: int, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(models.SecretVault).filter(models.SecretVault.device_id == device_id))
    return res.scalars().all()

@router.post("/{device_id}/secrets")
async def add_secret(request: Request, device_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    if not data or not data.get("secret_type"): raise HTTPException(400, "Secret type required")
    clean = filter_valid_columns(models.SecretVault, data)
    sec = models.SecretVault(device_id=device_id, **clean)
    db.add(sec); await db.commit(); return sec

@router.get("/relationships/all")
async def get_all_relationships(request: Request, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(models.DeviceRelationship))
    return res.scalars().all()

@router.get("/{device_id}/relationships")
async def get_relationships(request: Request, device_id: int, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import or_
    res = await db.execute(select(models.DeviceRelationship).filter(
        or_(
            models.DeviceRelationship.source_device_id == device_id,
            models.DeviceRelationship.target_device_id == device_id
        )
    ))
    return res.scalars().all()

@router.post("/{device_id}/relationships")
async def add_relationship(request: Request, device_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    target_id = data.get("target_device_id")
    if not target_id: raise HTTPException(400, "Target device ID required")
    if int(target_id) == device_id: raise HTTPException(400, "Cannot link server to itself")
    clean = filter_valid_columns(models.DeviceRelationship, data)
    rel = models.DeviceRelationship(source_device_id=device_id, **clean)
    db.add(rel); await db.commit(); return rel

@router.delete("/{device_id}")
async def delete_device(request: Request, device_id: int, db: AsyncSession = Depends(get_db)):
    tenant_id = request.state.tenant_id
    result = await db.execute(select(models.Device).filter(models.Device.id == device_id, models.Device.tenant_id == tenant_id))
    db_device = result.scalar_one_or_none()
    if not db_device: raise HTTPException(404)
    db_device.is_deleted = True
    await db.commit()
    return {"status": "success"}

@router.delete("/{resource}/{id}")
async def delete_resource(request: Request, resource: str, id: int, db: AsyncSession = Depends(get_db)):
    model_map = {"hardware": models.HardwareComponent, "software": models.DeviceSoftware, "secrets": models.SecretVault, "relationships": models.DeviceRelationship}
    if resource not in model_map: raise HTTPException(400)
    await db.execute(delete(model_map[resource]).where(model_map[resource].id == id))
    await db.commit(); return {"status": "success"}

@router.put("/{resource}/{id}")
async def update_resource(request: Request, resource: str, id: int, data: dict, db: AsyncSession = Depends(get_db)):
    model_map = {"hardware": models.HardwareComponent, "software": models.DeviceSoftware, "secrets": models.SecretVault, "relationships": models.DeviceRelationship}
    if resource not in model_map: raise HTTPException(400)
    
    res = await db.execute(select(model_map[resource]).filter(model_map[resource].id == id))
    item = res.scalar_one_or_none()
    if not item: raise HTTPException(404)
    
    clean = filter_valid_columns(model_map[resource], data)
    for k, v in clean.items():
        if k != "id": setattr(item, k, v)
    
    await db.commit(); return item
