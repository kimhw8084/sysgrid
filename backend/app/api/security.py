from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update, or_
from typing import List, Optional
from ..database import get_db
from ..models import models
from .utils import build_audit_log, filter_valid_columns, normalize_json_object
from .module_policy import require_module_access

router = APIRouter(
    prefix="/security",
    tags=["Security & Firewall"],
    dependencies=[Depends(require_module_access("assets"))],
)

# --- Secret Vault ---

def serialize_secret_vault_entry(secret: models.SecretVault):
    return {
        "id": secret.id,
        "device_id": secret.device_id,
        "secret_type": secret.secret_type,
        "username": secret.username,
        "notes": secret.notes,
        "has_payload": bool(secret.encrypted_payload),
        "created_at": secret.created_at.isoformat() if secret.created_at else None,
        "updated_at": secret.updated_at.isoformat() if secret.updated_at else None,
    }


@router.get("/vault")
async def get_secrets(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.SecretVault))
    return [serialize_secret_vault_entry(secret) for secret in result.scalars().all()]

@router.post("/vault")
async def add_secret(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    clean_data = filter_valid_columns(models.SecretVault, data)
    encrypted_payload = clean_data.get("encrypted_payload")
    if encrypted_payload is None and "payload" in data:
        encrypted_payload = str(data.get("payload") or "")
    clean_data["encrypted_payload"] = encrypted_payload
    db_obj = models.SecretVault(**clean_data)
    db.add(db_obj)
    db.add(build_audit_log(
        request=request,
        action="CREATE",
        target_table="secret_vault",
        target_id=None,
        description=f"Created vault secret for device {db_obj.device_id}",
        changes=normalize_json_object({
            "device_id": db_obj.device_id,
            "secret_type": db_obj.secret_type,
            "username": db_obj.username,
            "has_payload": bool(db_obj.encrypted_payload),
        }),
    ))
    await db.commit()
    await db.refresh(db_obj)
    return serialize_secret_vault_entry(db_obj)

# --- Firewall Rules ---

def format_rule(rule: models.FirewallRule):
    return {
        "id": rule.id,
        "name": rule.name,
        "risk": rule.risk,
        "source_type": rule.source_type,
        "source_device_id": rule.source_device_id,
        "source_device_name": rule.source_device.name if rule.source_device else None,
        "source_subnet_id": rule.source_subnet_id,
        "source_subnet_name": rule.source_subnet.name if rule.source_subnet else None,
        "source_custom_ip": rule.source_custom_ip,
        "dest_type": rule.dest_type,
        "dest_device_id": rule.dest_device_id,
        "dest_device_name": rule.dest_device.name if rule.dest_device else None,
        "dest_subnet_id": rule.dest_subnet_id,
        "dest_subnet_name": rule.dest_subnet.name if rule.dest_subnet else None,
        "dest_custom_ip": rule.dest_custom_ip,
        "protocol": rule.protocol,
        "port_range": rule.port_range,
        "direction": rule.direction,
        "action": rule.action,
        "status": rule.status,
        "created_at": rule.created_at.isoformat() if rule.created_at else None,
        "updated_at": rule.updated_at.isoformat() if rule.updated_at else None
    }

@router.get("/firewall")
async def get_firewall_rules(
    device_id: Optional[int] = None, 
    include_deleted: bool = False, 
    db: AsyncSession = Depends(get_db)
):
    from sqlalchemy.orm import selectinload
    query = select(models.FirewallRule).options(
        selectinload(models.FirewallRule.source_device),
        selectinload(models.FirewallRule.source_subnet),
        selectinload(models.FirewallRule.dest_device),
        selectinload(models.FirewallRule.dest_subnet)
    )
    
    if not include_deleted:
        query = query.filter(models.FirewallRule.is_deleted == False)
    
    if device_id:
        # Rules where device is either source or destination
        query = query.filter(or_(
            models.FirewallRule.source_device_id == device_id,
            models.FirewallRule.dest_device_id == device_id
        ))
        
    result = await db.execute(query.order_by(models.FirewallRule.updated_at.desc()))
    rules = result.scalars().all()
    return [format_rule(r) for r in rules]

@router.post("/firewall")
async def create_firewall_rule(data: dict, db: AsyncSession = Depends(get_db)):
    from sqlalchemy.orm import selectinload
    rule = models.FirewallRule(
        name=data.get("name"),
        risk=data.get("risk"),
        source_type=data.get("source_type", "Custom IP"),
        source_device_id=data.get("source_device_id"),
        source_subnet_id=data.get("source_subnet_id"),
        source_custom_ip=data.get("source_custom_ip"),
        dest_type=data.get("dest_type", "Custom IP"),
        dest_device_id=data.get("dest_device_id"),
        dest_subnet_id=data.get("dest_subnet_id"),
        dest_custom_ip=data.get("dest_custom_ip"),
        protocol=data.get("protocol", "TCP"),
        port_range=data.get("port_range"),
        direction=data.get("direction", "Inbound"),
        action=data.get("action", "Allow"),
        status=data.get("status", "Active")
    )
    db.add(rule)
    await db.commit()
    
    # Refresh with selectinload to avoid MissingGreenlet
    result = await db.execute(
        select(models.FirewallRule)
        .options(
            selectinload(models.FirewallRule.source_device),
            selectinload(models.FirewallRule.source_subnet),
            selectinload(models.FirewallRule.dest_device),
            selectinload(models.FirewallRule.dest_subnet)
        )
        .filter(models.FirewallRule.id == rule.id)
    )
    rule = result.scalar_one()
    return format_rule(rule)

@router.put("/firewall/{rule_id}")
async def update_firewall_rule(rule_id: int, data: dict, db: AsyncSession = Depends(get_db)):
    from sqlalchemy.orm import selectinload
    result = await db.execute(select(models.FirewallRule).filter(models.FirewallRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule: raise HTTPException(404, "Rule not found")
    
    for key, value in data.items():
        if hasattr(rule, key):
            setattr(rule, key, value)
            
    await db.commit()
    
    # Refresh with selectinload to avoid MissingGreenlet
    result = await db.execute(
        select(models.FirewallRule)
        .options(
            selectinload(models.FirewallRule.source_device),
            selectinload(models.FirewallRule.source_subnet),
            selectinload(models.FirewallRule.dest_device),
            selectinload(models.FirewallRule.dest_subnet)
        )
        .filter(models.FirewallRule.id == rule_id)
    )
    rule = result.scalar_one()
    return format_rule(rule)

@router.delete("/firewall/{rule_id}")
async def delete_firewall_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.FirewallRule).filter(models.FirewallRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule: raise HTTPException(404, "Rule not found")
    
    rule.is_deleted = True
    await db.commit()
    return {"status": "success"}
