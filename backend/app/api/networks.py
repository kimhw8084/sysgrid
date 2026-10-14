from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select, delete, update, or_, and_, func
from typing import List
from ..database import get_db
from ..models import models
from ..schemas import schemas
from .utils import build_audit_log, get_audit_actor
from .module_policy import require_module_access
from .asset_links import commit_asset_link_audit, require_relationship_asset

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


def _connection_scope(request: Request):
    # The tenant database owns custom-IP endpoints. Every referenced asset must
    # also belong to the authorized tenant; archived assets remain readable.
    owned_assets = select(models.Device.id).where(models.Device.tenant_id == request.state.tenant_id)
    return and_(
        or_(models.PortConnection.source_device_id.is_(None), models.PortConnection.source_device_id.in_(owned_assets)),
        or_(models.PortConnection.target_device_id.is_(None), models.PortConnection.target_device_id.in_(owned_assets)),
    )


async def _get_connection_by_id(request: Request, db: AsyncSession, conn_id: int):
    if not 1 <= conn_id <= 2 ** 63 - 1:
        return None
    result = await db.execute(select(models.PortConnection).where(
        models.PortConnection.id == conn_id, _connection_scope(request),
    ))
    return result.scalar_one_or_none()


async def _get_connections_for_ids(request: Request, db: AsyncSession, ids: list[int]):
    if not ids:
        return []
    if any(not 1 <= conn_id <= 2 ** 63 - 1 for conn_id in ids):
        raise HTTPException(404, 'Connection not found')
    result = await db.execute(select(models.PortConnection).where(
        models.PortConnection.id.in_(ids), _connection_scope(request),
    ))
    connections = result.scalars().all()
    if len(connections) != len(set(ids)):
        raise HTTPException(404, 'Connection not found')
    return connections


async def _commit_connection_batch_audit(request, db, ids, action, description, changed_fields):
    changes = {'batch_count': len(ids)}
    if changed_fields:
        changes['changed_fields'] = changed_fields
    try:
        for conn_id in ids:
            db.add(build_audit_log(
                request=request, action=action, target_table='port_connections', target_id=str(conn_id),
                description=description, changes=changes,
            ))
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, 'Network batch conflicts with current data; reload and retry') from exc
    except Exception:
        await db.rollback()
        raise


def _interface_query(request: Request):
    owned_assets = select(models.Device.id).where(models.Device.tenant_id == request.state.tenant_id)
    return select(models.NetworkInterface).where(models.NetworkInterface.device_id.in_(owned_assets))


@router.get("/interfaces")
async def get_interfaces(request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(_interface_query(request))
    interfaces = result.scalars().all()
    return [{"id": i.id, "name": i.name, "mac_address": i.mac_address, "ip_address": i.ip_address, "link_speed_gbps": i.link_speed_gbps} for i in interfaces]

@router.post("/interfaces")
async def create_interface(data: schemas.NetworkInterfaceCreate, request: Request, db: AsyncSession = Depends(get_db)):
    payload = data.model_dump(exclude_unset=True)
    await require_relationship_asset(request, db, data.device_id, active=True)
    db_obj = models.NetworkInterface(**payload, created_by_user_id=get_audit_actor(request))
    db.add(db_obj)
    await commit_asset_link_audit(request, db, db_obj, 'CREATE', {'changed_fields': sorted(payload)})
    await db.refresh(db_obj)
    return {"status": "success", "id": db_obj.id}

@router.put("/interfaces/{interface_id}")
async def update_interface(interface_id: int, data: schemas.NetworkInterfaceUpdate, request: Request, db: AsyncSession = Depends(get_db)):
    if not 1 <= interface_id <= 2 ** 63 - 1:
        raise HTTPException(404, 'Interface not found')
    res = await db.execute(_interface_query(request).where(models.NetworkInterface.id == interface_id))
    item = res.scalar_one_or_none()
    if item is None:
        raise HTTPException(404, 'Interface not found')

    payload = data.model_dump(exclude_unset=True)
    if 'device_id' in payload and payload['device_id'] != item.device_id:
        await require_relationship_asset(request, db, payload['device_id'], active=True)
    changed = {key: value for key, value in payload.items() if getattr(item, key) != value}
    if not changed:
        return item
    for key, value in changed.items():
        setattr(item, key, value)
    await commit_asset_link_audit(request, db, item, 'UPDATE', {'changed_fields': sorted(changed)})
    await db.refresh(item)
    return item

@router.get("/connections")
async def get_connections(request: Request, device_id: int = None, include_deleted: bool = False, db: AsyncSession = Depends(get_db)):
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
    
    query = query.where(_connection_scope(request))
    if device_id is not None:
        await require_relationship_asset(request, db, device_id)
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

    await require_relationship_asset(request, db, source_device_id, active=True)
    await require_relationship_asset(request, db, target_device_id, active=True)

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
        request_link=payload.get('request_link'),
        created_by_user_id=get_audit_actor(request),
    )
    try:
        db.add(conn)
        await db.flush()
        db.add(build_audit_log(
            request=request, action='CREATE', target_table='port_connections', target_id=str(conn.id),
            description=f'Established link between dev {source_device_id} and {target_device_id}',
            changes={'changed_fields': sorted(payload)},
        ))
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, 'Network connection conflicts with current data; reload and retry') from exc
    except Exception:
        await db.rollback()
        raise
    await db.refresh(conn)
    return conn

@router.post("/connections/bulk-status")
async def bulk_update_status(data: schemas.NetworkConnectionBulkStatus, request: Request, db: AsyncSession = Depends(get_db)):
    connections = await _get_connections_for_ids(request, db, data.ids)
    new_status = data.status
    if new_status not in NETWORK_STATUS_VALUES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'")
    ids = [conn.id for conn in connections if conn.status != new_status]
    if not ids:
        return {"status": "success", "count": 0, "changed": 0, "summary": "No connection status changed"}

    await db.execute(
        update(models.PortConnection)
        .where(models.PortConnection.id.in_(ids))
        .values(status=new_status)
    )

    await _commit_connection_batch_audit(
        request, db, ids, 'BULK_UPDATE', f'Bulk updated {len(ids)} links to {new_status}', ['status'],
    )
    return {"status": "success", "count": len(ids), "changed": len(ids), "summary": f"Updated {len(ids)} links to {new_status}"}

@router.post("/connections/bulk-restore")
async def bulk_restore_connections(data: schemas.NetworkConnectionBulkIds, request: Request, db: AsyncSession = Depends(get_db)):
    connections = await _get_connections_for_ids(request, db, data.ids)
    ids = [conn.id for conn in connections]
    if not connections:
        return {"status": "success", "count": 0, "changed": 0, "summary": "No deleted connections restored"}
    if any(conn.status != "Deleted" for conn in connections):
        raise HTTPException(status_code=400, detail="Only deleted connections can be restored")

    await db.execute(
        update(models.PortConnection)
        .where(models.PortConnection.id.in_(ids))
        .values(status="Active")
    )

    await _commit_connection_batch_audit(
        request, db, ids, 'BULK_RESTORE', f'Bulk restored {len(ids)} network links', ['status'],
    )
    return {"status": "success", "count": len(ids), "changed": len(ids), "summary": f"Restored {len(ids)} connections"}

@router.post("/connections/bulk-delete")
async def bulk_delete_connections(data: schemas.NetworkConnectionBulkIds, request: Request, db: AsyncSession = Depends(get_db)):
    ids = data.ids
    if not ids:
        raise HTTPException(status_code=400, detail="IDs required")

    connections = await _get_connections_for_ids(request, db, ids)
    connections = [conn for conn in connections if conn.status != 'Deleted']
    if not connections:
        return {"status": "success", "count": 0, "changed": 0, "deleted_ids": [], "summary": "No connections archived"}

    deleted_ids = []
    for conn in connections:
        deleted_ids.append(conn.id)
        conn.status = "Deleted"

    await _commit_connection_batch_audit(
        request, db, deleted_ids, 'BULK_DELETE', f'Bulk severed {len(deleted_ids)} network links', ['status'],
    )
    return {"status": "success", "count": len(deleted_ids), "changed": len(deleted_ids), "deleted_ids": deleted_ids, "summary": f"Archived {len(deleted_ids)} connections"}

@router.post("/connections/bulk-purge")
async def bulk_purge_connections(data: schemas.NetworkConnectionBulkIds, request: Request, db: AsyncSession = Depends(get_db)):
    ids = data.ids
    if not ids:
        raise HTTPException(status_code=400, detail="IDs required")

    connections = await _get_connections_for_ids(request, db, ids)
    if not connections:
        return {"status": "success", "count": 0, "changed": 0, "summary": "No deleted connections purged"}
    if any(conn.status != "Deleted" for conn in connections):
        raise HTTPException(status_code=400, detail="Only deleted connections can be purged")

    deleted_ids = [conn.id for conn in connections]
    for conn in connections:
        await db.delete(conn)
    await _commit_connection_batch_audit(
        request, db, deleted_ids, 'BULK_PURGE', f'Bulk purged {len(deleted_ids)} network links', [],
    )
    return {"status": "success", "count": len(deleted_ids), "changed": len(deleted_ids), "deleted_ids": deleted_ids, "summary": f"Purged {len(deleted_ids)} connections"}

@router.put("/connections/{conn_id}")
async def update_connection(conn_id: int, data: schemas.NetworkConnectionUpdate, request: Request, db: AsyncSession = Depends(get_db)):
    conn = await _get_connection_by_id(request, db, conn_id)
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

    changed = {key: value for key, value in payload.items() if getattr(conn, key) != value}
    if not changed:
        return conn

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

    for field_name in ('source_device_id', 'target_device_id'):
        if field_name in payload and payload[field_name] != getattr(conn, field_name):
            await require_relationship_asset(request, db, payload[field_name], active=True)

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

    if source_device_id is not None and source_device_id == target_device_id:
        raise HTTPException(status_code=400, detail="Source and peer assets must be different")

    port_checks = []
    for device_id, port in ((source_device_id, source_port), (target_device_id, target_port)):
        if device_id is not None:
            port_checks.extend([
                and_(models.PortConnection.source_device_id == device_id, models.PortConnection.source_port == port),
                and_(models.PortConnection.target_device_id == device_id, models.PortConnection.target_port == port),
            ])
    if port_checks:
        dup_query = select(models.PortConnection).filter(
            models.PortConnection.id != conn_id, or_(*port_checks)
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

    log = build_audit_log(request=request, action="UPDATE", target_table="port_connections", target_id=str(conn_id), description="Modified network link", changes={"changed_fields": sorted(changed)})
    db.add(log)
    await db.commit()
    await db.refresh(conn)
    return conn

@router.delete("/connections/{conn_id}")
async def delete_connection(conn_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    conn = await _get_connection_by_id(request, db, conn_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    if conn.status == 'Deleted':
        return {"status": "success", "id": conn.id}

    conn.status = "Deleted"
    log = build_audit_log(request=request, action="DELETE", target_table="port_connections", target_id=str(conn_id), description="Severed network link")
    db.add(log)
    await db.commit()
    return {"status": "success", "id": conn.id}

@router.post("/connections/{conn_id}/restore")
async def restore_connection(conn_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    conn = await _get_connection_by_id(request, db, conn_id)
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
    conn = await _get_connection_by_id(request, db, conn_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    if conn.status != "Deleted":
        raise HTTPException(status_code=400, detail="Only deleted connections can be purged")

    log = build_audit_log(request=request, action="PURGE", target_table="port_connections", target_id=str(conn_id), description="Purged network link")
    db.add(log)
    await db.delete(conn)
    await db.commit()
    return {"status": "success", "id": conn_id}
