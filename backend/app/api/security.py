from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update, or_
from sqlalchemy.exc import IntegrityError
from typing import List, Optional
from typing import Annotated
from pydantic import BaseModel, ConfigDict, Field
from ..database import get_db
from ..models import models
from .module_policy import require_module_access
from .authorization import require_capability, resolve_current_operator
from .secret_vault import can_manage_vault, commit_vault_audit, require_vault_device, serialize_secret_vault_entry
from .utils import build_audit_log, get_audit_actor

router = APIRouter(
    prefix="/security",
    tags=["Security & Firewall"],
    dependencies=[Depends(require_module_access("assets"))],
)

# --- Secret Vault ---

@router.get("/vault")
async def get_secrets(request: Request, db: AsyncSession = Depends(get_db)):
    can_manage = can_manage_vault(request, await resolve_current_operator(request, db))
    # get_db binds this query to the authorized tenant database. Preserve
    # existing unassigned vault metadata as well as device-linked records.
    result = await db.execute(select(models.SecretVault))
    return [serialize_secret_vault_entry(secret, can_manage=can_manage) for secret in result.scalars()]

@router.post("/vault")
async def add_secret(data: dict, request: Request, db: AsyncSession = Depends(get_db), _secret_admin=Depends(require_capability('secrets', 3))):
    if data.get('device_id') is not None:
        await require_vault_device(request, db, data['device_id'])
    clean_data = {key: data[key] for key in ('device_id', 'secret_type', 'username', 'encrypted_payload', 'notes') if key in data}
    encrypted_payload = clean_data.get("encrypted_payload")
    if encrypted_payload is None and "payload" in data:
        encrypted_payload = str(data.get("payload") or "")
    clean_data["encrypted_payload"] = encrypted_payload
    db_obj = models.SecretVault(**clean_data)
    db.add(db_obj)
    await db.flush()
    await commit_vault_audit(request, db, db_obj, 'CREATE')
    await db.refresh(db_obj)
    return serialize_secret_vault_entry(db_obj, can_manage=True)

# --- Firewall Rules ---

FirewallReferenceId = Annotated[int, Field(ge=1, le=2 ** 63 - 1)]


class FirewallRulePayload(BaseModel):
    # Read projections may round-trip; ORM identity, relationships, timestamps
    # and lifecycle fields are never editable through a definition payload.
    model_config = ConfigDict(extra='ignore', strict=True)

    name: str | None = None
    risk: str | None = None
    source_type: str | None = 'Custom IP'
    source_device_id: FirewallReferenceId | None = None
    source_subnet_id: FirewallReferenceId | None = None
    source_custom_ip: str | None = None
    dest_type: str | None = 'Custom IP'
    dest_device_id: FirewallReferenceId | None = None
    dest_subnet_id: FirewallReferenceId | None = None
    dest_custom_ip: str | None = None
    protocol: str | None = 'TCP'
    port_range: str | None = None
    direction: str | None = 'Inbound'
    action: str | None = 'Allow'
    status: str | None = 'Active'


async def validate_firewall_references(request, db, data, existing=None):
    for field in ('source_device_id', 'dest_device_id', 'source_subnet_id', 'dest_subnet_id'):
        value = data.get(field)
        if value is None or (existing is not None and value == getattr(existing, field)):
            continue
        if field.endswith('device_id'):
            query = select(models.Device.id).where(
                models.Device.id == value,
                models.Device.tenant_id == request.state.tenant_id,
                models.Device.is_deleted == False,
            )
        else:
            # The authorized get_db dependency binds subnets to this tenant's DB.
            query = select(models.Subnet.id).where(models.Subnet.id == value)
        if await db.scalar(query) is None:
            raise HTTPException(404, f'{field} does not identify an available resource')


async def commit_firewall_audit(request, db, rule, action, changes):
    try:
        await db.flush()
        db.add(build_audit_log(
            request=request, action=action, target_table='firewall_rules',
            target_id=str(rule.id), description=f'{action.title()} firewall definition', changes=changes,
        ))
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, 'Firewall definition conflicts with current resource state; reload and retry') from exc
    except Exception:
        await db.rollback()
        raise


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
async def create_firewall_rule(data: FirewallRulePayload, request: Request, db: AsyncSession = Depends(get_db)):
    from sqlalchemy.orm import selectinload
    definition = data.model_dump()
    await validate_firewall_references(request, db, definition)
    rule = models.FirewallRule(**definition, created_by_user_id=get_audit_actor(request))
    db.add(rule)
    await commit_firewall_audit(request, db, rule, 'CREATE', definition)
    
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
async def update_firewall_rule(rule_id: int, data: FirewallRulePayload, request: Request, db: AsyncSession = Depends(get_db)):
    from sqlalchemy.orm import selectinload
    result = await db.execute(select(models.FirewallRule).filter(models.FirewallRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule: raise HTTPException(404, "Rule not found")
    
    definition = data.model_dump(exclude_unset=True)
    await validate_firewall_references(request, db, definition, existing=rule)
    changes = {key: {'before': getattr(rule, key), 'after': value}
               for key, value in definition.items() if getattr(rule, key) != value}
    for key, change in changes.items():
        setattr(rule, key, change['after'])
    if changes:
        await commit_firewall_audit(request, db, rule, 'UPDATE', changes)
    
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
async def delete_firewall_rule(rule_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.FirewallRule).filter(models.FirewallRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule: raise HTTPException(404, "Rule not found")
    
    # The transition itself is conditional, so concurrent retries cannot each
    # claim a new archive in the audit trail.
    changed = await db.scalar(update(models.FirewallRule).where(
        models.FirewallRule.id == rule_id, models.FirewallRule.is_deleted == False,
    ).values(is_deleted=True).returning(models.FirewallRule.id))
    if changed is not None:
        await commit_firewall_audit(request, db, rule, 'ARCHIVE', {'is_deleted': {'before': False, 'after': True}})
    else:
        await db.commit()
    return {"status": "success"}
