from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update, or_, and_, func
from typing import List
from ..database import get_db
from ..models import models
from ..schemas import schemas
from .utils import build_audit_log, filter_valid_columns
from .module_policy import require_module_access

router = APIRouter(
    prefix="/networks",
    tags=["Network Fabric"],
    dependencies=[Depends(require_module_access("network"))],
)

NETWORK_DIRECTION_VALUES = {"Bidirectional", "Unidirectional", "Source to Target", "Target to Source"}
NETWORK_UNIT_VALUES = {"Gbps", "Mbps", "Kbps"}
NETWORK_STATUS_VALUES = {"Active", "Maintenance", "Down", "Planned", "Requested", "Standby", "Offline", "Deleted"}


async def _get_setting_values(db: AsyncSession, category: str) -> set[str]:
    result = await db.execute(
        select(models.SettingOption.value).filter(models.SettingOption.category == category)
    )
    return {str(value).strip() for (value,) in result.all() if str(value).strip()}


async def _validate_network_enums(
    db: AsyncSession,
    *,
    link_type: str | None,
    farm: str | None,
    cable_type: str | None,
    direction: str | None,
    status: str | None,
) -> None:
    if link_type is not None:
        allowed_link_types = await _get_setting_values(db, "LinkPurpose")
        if allowed_link_types and link_type not in allowed_link_types:
            raise HTTPException(status_code=400, detail=f"Invalid link type '{link_type}'")

    if farm is not None:
        allowed_farms = await _get_setting_values(db, "NetworkFarm")
        if allowed_farms and farm not in allowed_farms:
            raise HTTPException(status_code=400, detail=f"Invalid farm '{farm}'")

    if cable_type is not None:
        allowed_cables = await _get_setting_values(db, "NetworkCableType")
        if allowed_cables and cable_type not in allowed_cables:
            raise HTTPException(status_code=400, detail=f"Invalid cable type '{cable_type}'")

    if direction is not None and direction not in NETWORK_DIRECTION_VALUES:
        raise HTTPException(status_code=400, detail=f"Invalid direction '{direction}'")

    if status is not None and status not in NETWORK_STATUS_VALUES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{status}'")


async def _get_connection_by_id(db: AsyncSession, conn_id: int):
    result = await db.execute(select(models.PortConnection).filter(models.PortConnection.id == conn_id))
    return result.scalar_one_or_none()


async def _get_connections_for_ids(db: AsyncSession, ids: list[int]):
    if not ids:
        return []
    result = await db.execute(select(models.PortConnection).filter(models.PortConnection.id.in_(ids)))
    return result.scalars().all()

@router.get("/interfaces")
async def get_interfaces(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.NetworkInterface))
    interfaces = result.scalars().all()
    return [{"id": i.id, "name": i.name, "mac_address": i.mac_address, "ip_address": i.ip_address, "link_speed_gbps": i.link_speed_gbps} for i in interfaces]

@router.post("/interfaces")
async def create_interface(data: dict, db: AsyncSession = Depends(get_db)):
    clean_data = filter_valid_columns(models.NetworkInterface, data)
    if 'id' in clean_data and not clean_data['id']:
        del clean_data['id']
    db_obj = models.NetworkInterface(**clean_data)
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return {"status": "success", "id": db_obj.id}

@router.put("/interfaces/{interface_id}")
async def update_interface(interface_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(models.NetworkInterface).filter(models.NetworkInterface.id == interface_id))
    item = res.scalar_one_or_none()
    if not item: raise HTTPException(404)
    
    clean = filter_valid_columns(models.NetworkInterface, data)
    for k, v in clean.items():
        if k != "id": setattr(item, k, v)
    
    await db.commit()
    await db.refresh(item)
    return item

@router.get("/connections")
async def get_connections(device_id: int = None, include_deleted: bool = False, db: AsyncSession = Depends(get_db)):
    from sqlalchemy.orm import aliased
    DeviceA = aliased(models.Device)
    DeviceB = aliased(models.Device)
    LocA = aliased(models.DeviceLocation)
    LocB = aliased(models.DeviceLocation)
    RackA = aliased(models.Rack)
    RackB = aliased(models.Rack)
    
    source_location_subquery = (
        select(
            models.DeviceLocation.device_id.label("device_id"),
            func.min(models.DeviceLocation.id).label("location_id"),
        )
        .group_by(models.DeviceLocation.device_id)
        .subquery()
    )
    target_location_subquery = (
        select(
            models.DeviceLocation.device_id.label("device_id"),
            func.min(models.DeviceLocation.id).label("location_id"),
        )
        .group_by(models.DeviceLocation.device_id)
        .subquery()
    )

    query = select(
        models.PortConnection,
        DeviceA.name.label("server_a"),
        DeviceB.name.label("server_b"),
        RackA.name.label("rack_a"),
        LocA.start_unit.label("slot_a"),
        RackB.name.label("rack_b"),
        LocB.start_unit.label("slot_b")
    ).outerjoin(DeviceA, models.PortConnection.source_device_id == DeviceA.id) \
     .outerjoin(DeviceB, models.PortConnection.target_device_id == DeviceB.id) \
     .outerjoin(source_location_subquery, source_location_subquery.c.device_id == DeviceA.id) \
     .outerjoin(LocA, LocA.id == source_location_subquery.c.location_id) \
     .outerjoin(RackA, LocA.rack_id == RackA.id) \
     .outerjoin(target_location_subquery, target_location_subquery.c.device_id == DeviceB.id) \
     .outerjoin(LocB, LocB.id == target_location_subquery.c.location_id) \
     .outerjoin(RackB, LocB.rack_id == RackB.id)
    
    if device_id:
        query = query.filter(or_(models.PortConnection.source_device_id == device_id, models.PortConnection.target_device_id == device_id))
    if not include_deleted:
        query = query.filter(or_(models.PortConnection.status != "Deleted", models.PortConnection.status.is_(None)))
    
    result = await db.execute(query)
    rows = result.all()
    
    final_result = []
    for conn, server_a, server_b, rack_a, slot_a, rack_b, slot_b in rows:
        final_result.append({
            "id": conn.id,
            "created_at": conn.created_at,
            "updated_at": conn.updated_at,
            "created_by_user_id": conn.created_by_user_id,
            "source_device_id": conn.source_device_id,
            "src_device_id": conn.source_device_id,
            "server_a": server_a or "Unknown",
            "source_port": conn.source_port,
            "port_a": conn.source_port,
            "src_port": conn.source_port,
            "source_ip": conn.source_ip,
            "source_mac": conn.source_mac,
            "source_vlan": conn.source_vlan,
            "src_rack": rack_a or "N/A",
            "src_slot": slot_a or "N/A",
            "target_device_id": conn.target_device_id,
            "dst_device_id": conn.target_device_id,
            "server_b": server_b or "Unknown",
            "target_port": conn.target_port,
            "port_b": conn.target_port,
            "dst_port": conn.target_port,
            "target_ip": conn.target_ip,
            "target_mac": conn.target_mac,
            "target_vlan": conn.target_vlan,
            "peer_rack": rack_b or "N/A",
            "peer_slot": slot_b or "N/A",
            "vlan": conn.source_vlan or conn.target_vlan,
            "speed": f"{conn.speed_gbps} {conn.unit}" if conn.speed_gbps else "Unknown",
            "speed_gbps": conn.speed_gbps,
            "unit": conn.unit,
            "link_type": conn.link_type,
            "connection_type": conn.link_type,
            "purpose": conn.purpose,
            "direction": conn.direction,
            "cable_type": conn.cable_type,
            "status": conn.status,
            "is_deleted": conn.status == "Deleted",
            "is_active": conn.status != "Deleted",
            "farm": conn.farm,
            "request_link": conn.request_link
        })
    return final_result

@router.post("/connections")
async def create_connection(data: schemas.NetworkConnectionCreate, request: Request, db: AsyncSession = Depends(get_db)):
    payload = data.model_dump(exclude_none=True)
    source_device_id = payload["source_device_id"]
    source_port = payload["source_port"]
    target_device_id = payload["target_device_id"]
    target_port = payload["target_port"]
    link_type = payload["link_type"]
    status_value = payload.get("status", "Active")
    direction_value = payload.get("direction", "Bidirectional")
    farm_value = payload.get("farm")
    cable_type_value = payload.get("cable_type")
    unit_value = payload.get("unit", "Gbps")

    if unit_value not in NETWORK_UNIT_VALUES:
        raise HTTPException(status_code=400, detail=f"Invalid unit '{unit_value}'")
    await _validate_network_enums(
        db,
        link_type=link_type,
        farm=farm_value,
        cable_type=cable_type_value,
        direction=direction_value,
        status=status_value,
    )

    dup_query = select(models.PortConnection).filter(
        or_(
            and_(models.PortConnection.source_device_id == source_device_id, models.PortConnection.source_port == source_port),
            and_(models.PortConnection.target_device_id == source_device_id, models.PortConnection.target_port == source_port),
            and_(models.PortConnection.source_device_id == target_device_id, models.PortConnection.source_port == target_port),
            and_(models.PortConnection.target_device_id == target_device_id, models.PortConnection.target_port == target_port)
        )
    )
    dup_res = await db.execute(dup_query)
    if dup_res.scalars().first():
        raise HTTPException(status_code=400, detail="One of the selected ports is already physically cross-connected")

    conn = models.PortConnection(
        source_device_id=source_device_id,
        source_port=source_port,
        source_ip=payload.get('source_ip'),
        source_mac=payload.get('source_mac'),
        source_vlan=payload.get('source_vlan'),
        target_device_id=target_device_id,
        target_port=target_port,
        target_ip=payload.get('target_ip'),
        target_mac=payload.get('target_mac'),
        target_vlan=payload.get('target_vlan'),
        link_type=link_type,
        purpose=payload.get('purpose'),
        speed_gbps=payload.get('speed_gbps'),
        unit=unit_value,
        direction=direction_value,
        cable_type=cable_type_value,
        status=status_value,
        farm=farm_value,
        request_link=payload.get('request_link')
    )
    db.add(conn)
    log = build_audit_log(request=request, action="CREATE", target_table="port_connections", description=f"Established link between dev {source_device_id} and {target_device_id}")
    db.add(log)
    await db.commit()
    await db.refresh(conn)
    return conn

@router.post("/connections/bulk-status")
async def bulk_update_status(data: schemas.NetworkConnectionBulkStatus, request: Request, db: AsyncSession = Depends(get_db)):
    ids = data.ids
    new_status = data.status
    if new_status not in NETWORK_STATUS_VALUES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'")

    await db.execute(
        update(models.PortConnection)
        .where(models.PortConnection.id.in_(ids))
        .values(status=new_status)
    )

    log = build_audit_log(request=request, action="BULK_UPDATE", target_table="port_connections", description=f"Bulk updated {len(ids)} links to {new_status}")
    db.add(log)
    await db.commit()
    return {"status": "success", "count": len(ids), "changed": len(ids), "summary": f"Updated {len(ids)} links to {new_status}"}

@router.post("/connections/bulk-restore")
async def bulk_restore_connections(data: schemas.NetworkConnectionBulkIds, request: Request, db: AsyncSession = Depends(get_db)):
    ids = data.ids
    connections = await _get_connections_for_ids(db, ids)
    if not connections:
        return {"status": "success", "count": 0, "changed": 0, "summary": "No deleted connections restored"}
    if any(conn.status != "Deleted" for conn in connections):
        raise HTTPException(status_code=400, detail="Only deleted connections can be restored")

    await db.execute(
        update(models.PortConnection)
        .where(models.PortConnection.id.in_(ids))
        .values(status="Active")
    )

    log = build_audit_log(request=request, action="BULK_RESTORE", target_table="port_connections", description=f"Bulk restored {len(ids)} network links")
    db.add(log)
    await db.commit()
    return {"status": "success", "count": len(ids), "changed": len(ids), "summary": f"Restored {len(ids)} connections"}

@router.post("/connections/bulk-delete")
async def bulk_delete_connections(data: schemas.NetworkConnectionBulkIds, request: Request, db: AsyncSession = Depends(get_db)):
    ids = data.ids
    if not ids:
        raise HTTPException(status_code=400, detail="IDs required")

    result = await db.execute(select(models.PortConnection).filter(models.PortConnection.id.in_(ids)))
    connections = result.scalars().all()
    if not connections:
        return {"status": "success", "count": 0, "changed": 0, "summary": "No connections archived"}

    deleted_ids = []
    for conn in connections:
        deleted_ids.append(conn.id)
        conn.status = "Deleted"

    log = build_audit_log(request=request, action="BULK_DELETE", target_table="port_connections", description=f"Bulk severed {len(deleted_ids)} network links")
    db.add(log)
    await db.commit()
    return {"status": "success", "count": len(deleted_ids), "changed": len(deleted_ids), "deleted_ids": deleted_ids, "summary": f"Archived {len(deleted_ids)} connections"}

@router.post("/connections/bulk-purge")
async def bulk_purge_connections(data: schemas.NetworkConnectionBulkIds, request: Request, db: AsyncSession = Depends(get_db)):
    ids = data.ids
    if not ids:
        raise HTTPException(status_code=400, detail="IDs required")

    connections = await _get_connections_for_ids(db, ids)
    if not connections:
        return {"status": "success", "count": 0, "changed": 0, "summary": "No deleted connections purged"}
    if any(conn.status != "Deleted" for conn in connections):
        raise HTTPException(status_code=400, detail="Only deleted connections can be purged")

    deleted_ids = [conn.id for conn in connections]
    log = build_audit_log(request=request, action="BULK_PURGE", target_table="port_connections", description=f"Bulk purged {len(deleted_ids)} network links")
    db.add(log)
    for conn in connections:
        await db.delete(conn)
    await db.commit()
    return {"status": "success", "count": len(deleted_ids), "changed": len(deleted_ids), "deleted_ids": deleted_ids, "summary": f"Purged {len(deleted_ids)} connections"}

@router.put("/connections/{conn_id}")
async def update_connection(conn_id: int, data: schemas.NetworkConnectionUpdate, request: Request, db: AsyncSession = Depends(get_db)):
    conn = await _get_connection_by_id(db, conn_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    payload = data.model_dump(exclude_unset=True)
    for field_name, label in (
        ("source_device_id", "Source device"),
        ("source_port", "Source port"),
        ("target_device_id", "Peer device"),
        ("target_port", "Peer port"),
        ("link_type", "Connection type"),
    ):
        if field_name in payload and payload[field_name] is None:
            raise HTTPException(status_code=400, detail=f"{label} is required")

    source_device_id = payload.get('source_device_id', conn.source_device_id)
    source_port = payload.get('source_port', conn.source_port)
    target_device_id = payload.get('target_device_id', conn.target_device_id)
    target_port = payload.get('target_port', conn.target_port)
    link_type = payload.get('link_type', conn.link_type)
    direction_value = payload.get('direction', conn.direction)
    status_value = payload.get('status', conn.status)
    farm_value = payload.get('farm', conn.farm)
    cable_type_value = payload.get('cable_type', conn.cable_type)
    unit_value = payload.get('unit', conn.unit or 'Gbps')

    if unit_value not in NETWORK_UNIT_VALUES:
        raise HTTPException(status_code=400, detail=f"Invalid unit '{unit_value}'")
    await _validate_network_enums(
        db,
        link_type=link_type,
        farm=farm_value,
        cable_type=cable_type_value,
        direction=direction_value,
        status=status_value,
    )

    if source_device_id == target_device_id:
        raise HTTPException(status_code=400, detail="Source and peer assets must be different")

    dup_query = select(models.PortConnection).filter(
        models.PortConnection.id != conn_id,
        or_(
            and_(models.PortConnection.source_device_id == source_device_id, models.PortConnection.source_port == source_port),
            and_(models.PortConnection.target_device_id == source_device_id, models.PortConnection.target_port == source_port),
            and_(models.PortConnection.source_device_id == target_device_id, models.PortConnection.source_port == target_port),
            and_(models.PortConnection.target_device_id == target_device_id, models.PortConnection.target_port == target_port)
        )
    )
    dup_res = await db.execute(dup_query)
    if dup_res.scalars().first():
        raise HTTPException(status_code=400, detail="One of the selected ports is already physically cross-connected")

    conn.source_device_id = source_device_id
    conn.source_port = source_port
    conn.target_device_id = target_device_id
    conn.target_port = target_port
    if 'source_ip' in payload: conn.source_ip = payload['source_ip']
    if 'source_mac' in payload: conn.source_mac = payload['source_mac']
    if 'source_vlan' in payload: conn.source_vlan = payload['source_vlan']
    if 'target_ip' in payload: conn.target_ip = payload['target_ip']
    if 'target_mac' in payload: conn.target_mac = payload['target_mac']
    if 'target_vlan' in payload: conn.target_vlan = payload['target_vlan']
    if 'link_type' in payload: conn.link_type = payload['link_type']
    if 'purpose' in payload: conn.purpose = payload['purpose']
    if 'speed_gbps' in payload: conn.speed_gbps = payload['speed_gbps']
    if 'unit' in payload: conn.unit = payload['unit']
    if 'direction' in payload: conn.direction = payload['direction']
    if 'cable_type' in payload: conn.cable_type = payload['cable_type']
    if 'status' in payload: conn.status = payload['status']
    if 'farm' in payload: conn.farm = payload['farm']
    if 'request_link' in payload: conn.request_link = payload['request_link']

    log = build_audit_log(request=request, action="UPDATE", target_table="port_connections", target_id=str(conn_id), description="Modified network link")
    db.add(log)
    await db.commit()
    await db.refresh(conn)
    return conn

@router.delete("/connections/{conn_id}")
async def delete_connection(conn_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    conn = await _get_connection_by_id(db, conn_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    conn.status = "Deleted"
    log = build_audit_log(request=request, action="DELETE", target_table="port_connections", target_id=str(conn_id), description="Severed network link")
    db.add(log)
    await db.commit()
    return {"status": "success", "id": conn.id}

@router.post("/connections/{conn_id}/restore")
async def restore_connection(conn_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    conn = await _get_connection_by_id(db, conn_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    if conn.status != "Deleted":
        raise HTTPException(status_code=400, detail="Only deleted connections can be restored")

    conn.status = "Active"
    log = build_audit_log(request=request, action="RESTORE", target_table="port_connections", target_id=str(conn_id), description="Restored network link")
    db.add(log)
    await db.commit()
    return {"status": "success", "id": conn.id}

@router.post("/connections/{conn_id}/purge")
async def purge_connection(conn_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    conn = await _get_connection_by_id(db, conn_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    if conn.status != "Deleted":
        raise HTTPException(status_code=400, detail="Only deleted connections can be purged")

    log = build_audit_log(request=request, action="PURGE", target_table="port_connections", target_id=str(conn_id), description="Purged network link")
    db.add(log)
    await db.delete(conn)
    await db.commit()
    return {"status": "success", "id": conn_id}
