from datetime import datetime, timezone
from typing import Any, Dict, List, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ..database import get_db
from ..models import models
from .module_policy import build_effective_policy


router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

TruthKind = Literal["inventory", "configuration", "activity", "observed_health", "incident"]
TruthFreshness = Literal["current", "stale", "not_applicable", "unavailable"]


class HomeTruth(BaseModel):
    """Small provenance envelope used by every Home summary or signal."""

    value: int | float | str | None
    kind: TruthKind
    source: str
    as_of: datetime
    observed_at: datetime | None = None
    freshness: TruthFreshness
    available: bool
    unavailable_reason: str | None = None
    module_id: str | None = None
    path: str | None = None


class HomeOverview(BaseModel):
    total: int | None
    breakdown: dict[str, dict[str, int]]
    truth: HomeTruth


class HomeSite(BaseModel):
    id: int
    name: str


class RackOverview(BaseModel):
    total_sites: int | None
    total_racks: int | None
    total_racked_assets: int | None
    sites: list[HomeSite]
    truth: dict[str, HomeTruth]


class HomeActivity(BaseModel):
    id: int
    user: str | None
    action: str | None
    target: str | None
    description: str | None
    timestamp: datetime | None
    truth: HomeTruth


class HomeRecent(BaseModel):
    activity: list[HomeActivity]
    truth: HomeTruth


class DashboardMetrics(BaseModel):
    request_as_of: datetime
    stability_score: float | None = Field(
        default=None,
        description="Deprecated compatibility field; Home never fabricates a stability score.",
    )
    observed_health: dict[str, HomeTruth]
    incident_summary: HomeTruth
    rack_overview: RackOverview
    asset_overview: HomeOverview
    service_overview: HomeOverview
    network_overview: HomeOverview
    monitoring_overview: HomeOverview
    recent: HomeRecent


def group_by_status(items: List[Any], type_attr: str = "type") -> Dict[str, Dict[str, int]]:
    """Groups items by their type and then by status within that type."""
    result: Dict[str, Dict[str, int]] = {}
    for item in items:
        itype = getattr(item, type_attr, "Unknown") or "Unknown"
        status = getattr(item, "status", "Unknown") or "Unknown"
        result.setdefault(itype, {})[status] = result.setdefault(itype, {}).get(status, 0) + 1
    return result


async def _count(db: AsyncSession, column: Any, *conditions: Any) -> int:
    value = (await db.execute(select(func.count(column)).where(*conditions))).scalar()
    return int(value or 0)


async def _grouped_counts(
    db: AsyncSession,
    model: Any,
    dimension: Any,
    status: Any,
    *conditions: Any,
) -> dict[str, dict[str, int]]:
    rows = (
        await db.execute(
            select(dimension, status, func.count(model.id))
            .where(*conditions)
            .group_by(dimension, status)
        )
    ).all()
    result: dict[str, dict[str, int]] = {}
    for value, state, count in rows:
        dimension_value = value or "Unknown"
        status_value = state or "Unknown"
        result.setdefault(dimension_value, {})[status_value] = int(count)
    return result


def _module_target(policy: dict[str, Any], module_id: str) -> tuple[str | None, str | None]:
    entry = policy["modules"].get(module_id)
    if not entry or not entry.get("available"):
        return None, None
    return module_id, entry.get("canonical_route")


def _truth(
    *,
    value: int | float | str | None,
    kind: TruthKind,
    source: str,
    as_of: datetime,
    available: bool = True,
    freshness: TruthFreshness = "not_applicable",
    unavailable_reason: str | None = None,
    observed_at: datetime | None = None,
    module_id: str | None = None,
    path: str | None = None,
) -> HomeTruth:
    return HomeTruth(
        value=value,
        kind=kind,
        source=source,
        as_of=as_of,
        observed_at=observed_at,
        freshness=freshness,
        available=available,
        unavailable_reason=unavailable_reason,
        module_id=module_id,
        path=path,
    )


def _unavailable_observation(
    *,
    as_of: datetime,
    kind: Literal["observed_health", "incident"],
    source: str,
    reason: str,
    policy: dict[str, Any],
    module_id: str,
) -> HomeTruth:
    target_module, target_path = _module_target(policy, module_id)
    return _truth(
        value=None,
        kind=kind,
        source=source,
        as_of=as_of,
        available=False,
        freshness="unavailable",
        unavailable_reason=reason,
        module_id=target_module,
        path=target_path,
    )


def _module_scoped_truth(
    *,
    value: int | None,
    kind: Literal["inventory", "configuration", "activity"],
    source: str,
    as_of: datetime,
    policy: dict[str, Any],
    module_id: str,
) -> HomeTruth:
    target_module, target_path = _module_target(policy, module_id)
    available = target_module is not None
    return _truth(
        value=value if available else None,
        kind=kind,
        source=source,
        as_of=as_of,
        available=available,
        freshness="not_applicable" if available else "unavailable",
        unavailable_reason=None if available else "MODULE_UNAVAILABLE",
        module_id=target_module,
        path=target_path,
    )


@router.get("/metrics", response_model=DashboardMetrics)
async def get_metrics(request: Request, db: AsyncSession = Depends(get_db)):
    policy = await build_effective_policy(request, db)
    as_of = datetime.now(timezone.utc)
    visible = lambda module_id: bool(policy["modules"].get(module_id, {}).get("available"))

    assets_filter = models.Device.is_deleted.is_(False)
    services_filter = models.LogicalService.is_deleted.is_(False)
    network_filter = True
    monitoring_filter = models.MonitoringItem.is_deleted.is_(False)
    racks_filter = models.Rack.is_deleted.is_(False)

    asset_total = await _count(db, models.Device.id, assets_filter) if visible("assets") else None
    asset_breakdown = (
        await _grouped_counts(db, models.Device, models.Device.type, models.Device.status, assets_filter)
        if visible("assets")
        else {}
    )
    service_total = await _count(db, models.LogicalService.id, services_filter) if visible("services") else None
    service_breakdown = (
        await _grouped_counts(
            db,
            models.LogicalService,
            models.LogicalService.service_type,
            models.LogicalService.status,
            services_filter,
        )
        if visible("services")
        else {}
    )
    network_total = await _count(db, models.PortConnection.id, network_filter) if visible("network") else None
    network_breakdown = (
        await _grouped_counts(
            db,
            models.PortConnection,
            models.PortConnection.link_type,
            models.PortConnection.status,
            network_filter,
        )
        if visible("network")
        else {}
    )
    monitoring_total = await _count(db, models.MonitoringItem.id, monitoring_filter) if visible("monitoring") else None
    monitoring_breakdown = (
        await _grouped_counts(
            db,
            models.MonitoringItem,
            models.MonitoringItem.platform,
            models.MonitoringItem.status,
            monitoring_filter,
        )
        if visible("monitoring")
        else {}
    )

    sites_count = await _count(db, models.Site.id) if visible("racks") else None
    racks_count = await _count(db, models.Rack.id, racks_filter) if visible("racks") else None
    racked_assets_query = (
        select(func.count(func.distinct(models.DeviceLocation.device_id)))
        .join(models.Device, models.Device.id == models.DeviceLocation.device_id)
        .join(models.Rack, models.Rack.id == models.DeviceLocation.rack_id)
        .where(models.Device.is_deleted.is_(False), racks_filter)
    )
    racked_assets = int((await db.execute(racked_assets_query)).scalar() or 0) if visible("assets") and visible("racks") else None
    sites = (
        (await db.execute(select(models.Site.id, models.Site.name).order_by(models.Site.order_index))).all()
        if visible("racks")
        else []
    )

    logs_module, logs_path = _module_target(policy, "logs")

    observed_health = {
        "history": _unavailable_observation(
            as_of=as_of,
            kind="observed_health",
            source="No authoritative 24-hour availability or latency observation source is configured.",
            reason="NO_AUTHORITATIVE_OBSERVATION_SOURCE",
            policy=policy,
            module_id="monitoring",
        ),
        "availability": _unavailable_observation(
            as_of=as_of,
            kind="observed_health",
            source="MonitoringItem rows are configuration definitions, not availability observations.",
            reason="MONITORING_DEFINITIONS_ARE_NOT_OBSERVATIONS",
            policy=policy,
            module_id="monitoring",
        ),
        "latency": _unavailable_observation(
            as_of=as_of,
            kind="observed_health",
            source="No authoritative latency observation source is configured.",
            reason="NO_AUTHORITATIVE_OBSERVATION_SOURCE",
            policy=policy,
            module_id="monitoring",
        ),
        "stability": _unavailable_observation(
            as_of=as_of,
            kind="observed_health",
            source="No canonical stability contract or observed-health series is available.",
            reason="NO_CANONICAL_STABILITY_SOURCE",
            policy=policy,
            module_id="monitoring",
        ),
    }
    incident_summary = _unavailable_observation(
        as_of=as_of,
        kind="incident",
        source="No authoritative incident or alert source is configured for Home.",
        reason="NO_AUTHORITATIVE_INCIDENT_SOURCE",
        policy=policy,
        module_id="monitoring",
    )

    activity: list[HomeActivity] = []
    if visible("logs"):
        audit_rows = (
            await db.execute(
                select(
                    models.AuditLog.id,
                    models.AuditLog.user_id,
                    models.AuditLog.action,
                    models.AuditLog.target_table,
                    models.AuditLog.description,
                    models.AuditLog.timestamp,
                )
                .order_by(desc(models.AuditLog.timestamp))
                .limit(5)
            )
        ).all()
        for row in audit_rows:
            activity.append(
                HomeActivity(
                    id=row.id,
                    user=row.user_id,
                    action=row.action,
                    target=row.target_table,
                    description=row.description,
                    timestamp=row.timestamp,
                    truth=_truth(
                        value=1,
                        kind="activity",
                        source="audit_logs table",
                        as_of=as_of,
                        module_id=logs_module,
                        path=logs_path,
                    ),
                )
            )

    rack_truth = {
        "total_sites": _module_scoped_truth(
            value=sites_count if visible("racks") else None,
            kind="inventory",
            source="sites table",
            as_of=as_of,
            policy=policy,
            module_id="racks",
        ),
        "total_racks": _module_scoped_truth(
            value=racks_count if visible("racks") else None,
            kind="inventory",
            source="racks table (non-deleted rows)",
            as_of=as_of,
            policy=policy,
            module_id="racks",
        ),
        "total_racked_assets": _module_scoped_truth(
            value=racked_assets if visible("assets") and visible("racks") else None,
            kind="inventory",
            source="device_locations joined to non-deleted devices and racks",
            as_of=as_of,
            policy=policy,
            module_id="racks",
        ),
    }

    return DashboardMetrics(
        request_as_of=as_of,
        stability_score=None,
        observed_health=observed_health,
        incident_summary=incident_summary,
        rack_overview=RackOverview(
            total_sites=sites_count,
            total_racks=racks_count,
            total_racked_assets=racked_assets,
            sites=[HomeSite(id=site_id, name=name) for site_id, name in sites],
            truth=rack_truth,
        ),
        asset_overview=HomeOverview(
            total=asset_total,
            breakdown=asset_breakdown,
            truth=_module_scoped_truth(
                value=asset_total if visible("assets") else None,
                kind="inventory",
                source="devices table (non-deleted rows)",
                as_of=as_of,
                policy=policy,
                module_id="assets",
            ),
        ),
        service_overview=HomeOverview(
            total=service_total,
            breakdown=service_breakdown,
            truth=_module_scoped_truth(
                value=service_total if visible("services") else None,
                kind="inventory",
                source="logical_services table (non-deleted rows)",
                as_of=as_of,
                policy=policy,
                module_id="services",
            ),
        ),
        network_overview=HomeOverview(
            total=network_total,
            breakdown=network_breakdown,
            truth=_module_scoped_truth(
                value=network_total if visible("network") else None,
                kind="inventory",
                source="port_connections table",
                as_of=as_of,
                policy=policy,
                module_id="network",
            ),
        ),
        monitoring_overview=HomeOverview(
            total=monitoring_total,
            breakdown=monitoring_breakdown,
            truth=_module_scoped_truth(
                value=monitoring_total if visible("monitoring") else None,
                kind="configuration",
                source="monitoring_items table (non-deleted monitoring definitions)",
                as_of=as_of,
                policy=policy,
                module_id="monitoring",
            ),
        ),
        recent=HomeRecent(
            activity=activity,
            truth=_module_scoped_truth(
                value=len(activity) if visible("logs") else None,
                kind="activity",
                source="audit_logs table (latest five records)",
                as_of=as_of,
                policy=policy,
                module_id="logs",
            ),
        ),
    )


def _search_result(
    policy: dict[str, Any],
    *,
    module_id: str,
    item_id: int,
    item_type: str,
    title: str,
    subtitle: str,
    tag: str,
) -> dict[str, Any]:
    module = policy["modules"][module_id]
    return {
        "id": item_id,
        "type": item_type,
        "title": title,
        "subtitle": subtitle,
        "tag": tag,
        "path": module["canonical_route"],
        "module_id": module_id,
        "module_label": module["label"],
        "module_stage": module["stage"],
    }


@router.get("/search")
async def global_search(q: str, request: Request, db: AsyncSession = Depends(get_db)):
    if not q or len(q) < 2:
        return {"results": []}

    policy = await build_effective_policy(request, db)
    visible = lambda module_id: bool(policy["modules"].get(module_id, {}).get("available"))
    results: list[dict[str, Any]] = []
    search_term = f"%{q}%"

    if visible("assets"):
        assets = (
            await db.execute(
                select(models.Device)
                .where(
                    models.Device.is_deleted.is_(False),
                    (models.Device.name.ilike(search_term))
                    | (models.Device.system.ilike(search_term))
                    | (models.Device.asset_tag.ilike(search_term))
                    | (models.Device.serial_number.ilike(search_term))
                    | (models.Device.management_ip.ilike(search_term))
                    | (models.Device.primary_ip.ilike(search_term)),
                )
                .limit(10)
            )
        ).scalars().all()
        results.extend(
            _search_result(
                policy,
                module_id="assets",
                item_id=a.id,
                item_type="asset",
                title=a.name,
                subtitle=f"{a.system} | {a.management_ip or a.primary_ip or 'No IP'}",
                tag=a.type,
            )
            for a in assets
        )

    if visible("projects"):
        projects = (
            await db.execute(
                select(models.Project)
                .where(
                    models.Project.is_deleted.is_(False),
                    (models.Project.name.ilike(search_term)) | (models.Project.description.ilike(search_term)),
                )
                .limit(10)
            )
        ).scalars().all()
        results.extend(
            _search_result(
                policy,
                module_id="projects",
                item_id=p.id,
                item_type="project",
                title=p.name,
                subtitle=p.status,
                tag=p.type,
            )
            for p in projects
        )

    if visible("far"):
        far = (
            await db.execute(
                select(models.FarFailureMode)
                .where(
                    models.FarFailureMode.is_deleted.is_(False),
                    (models.FarFailureMode.title.ilike(search_term))
                    | (models.FarFailureMode.system_name.ilike(search_term))
                    | (models.FarFailureMode.effect.ilike(search_term)),
                )
                .limit(10)
            )
        ).scalars().all()
        results.extend(
            _search_result(
                policy,
                module_id="far",
                item_id=f.id,
                item_type="far",
                title=f.title,
                subtitle=f.system_name,
                tag=f"RPN: {f.rpn}",
            )
            for f in far
        )

    if visible("services"):
        services = (
            await db.execute(
                select(models.LogicalService)
                .where(
                    models.LogicalService.is_deleted.is_(False),
                    (models.LogicalService.name.ilike(search_term))
                    | (models.LogicalService.service_type.ilike(search_term))
                    | (models.LogicalService.environment.ilike(search_term))
                    | (models.LogicalService.purpose.ilike(search_term)),
                )
                .limit(10)
            )
        ).scalars().all()
        results.extend(
            _search_result(
                policy,
                module_id="services",
                item_id=service.id,
                item_type="service",
                title=service.name,
                subtitle=f"{service.service_type} | {service.environment}",
                tag=service.status or "Unknown",
            )
            for service in services
        )

    if visible("monitoring"):
        monitoring_items = (
            await db.execute(
                select(models.MonitoringItem)
                .where(
                    models.MonitoringItem.is_deleted.is_(False),
                    (models.MonitoringItem.title.ilike(search_term))
                    | (models.MonitoringItem.category.ilike(search_term))
                    | (models.MonitoringItem.platform.ilike(search_term))
                    | (models.MonitoringItem.purpose.ilike(search_term))
                    | (models.MonitoringItem.impact.ilike(search_term)),
                )
                .limit(10)
            )
        ).scalars().all()
        results.extend(
            _search_result(
                policy,
                module_id="monitoring",
                item_id=monitor.id,
                item_type="monitoring",
                title=monitor.title,
                subtitle=f"{monitor.category or 'Monitor'} | {monitor.platform or 'No Platform'}",
                tag=monitor.severity or "Info",
            )
            for monitor in monitoring_items
        )

    if visible("knowledge"):
        knowledge_entries = (
            await db.execute(
                select(models.KnowledgeEntry)
                .where(
                    models.KnowledgeEntry.is_deleted.is_(False),
                    (models.KnowledgeEntry.title.ilike(search_term))
                    | (models.KnowledgeEntry.content.ilike(search_term))
                    | (models.KnowledgeEntry.question_context.ilike(search_term)),
                )
                .limit(10)
            )
        ).scalars().all()
        results.extend(
            _search_result(
                policy,
                module_id="knowledge",
                item_id=entry.id,
                item_type="knowledge",
                title=entry.title,
                subtitle=entry.category,
                tag=entry.status or "Published",
            )
            for entry in knowledge_entries
        )

    if visible("network"):
        source_device = aliased(models.Device)
        target_device = aliased(models.Device)
        network_rows = (
            await db.execute(
                select(
                    models.PortConnection,
                    source_device.name.label("source_name"),
                    target_device.name.label("target_name"),
                )
                .join(source_device, models.PortConnection.source_device_id == source_device.id)
                .join(target_device, models.PortConnection.target_device_id == target_device.id)
                .where(
                    or_(
                        models.PortConnection.source_port.ilike(search_term),
                        models.PortConnection.target_port.ilike(search_term),
                        models.PortConnection.link_type.ilike(search_term),
                        models.PortConnection.purpose.ilike(search_term),
                        source_device.name.ilike(search_term),
                        target_device.name.ilike(search_term),
                    )
                )
                .limit(10)
            )
        ).all()
        results.extend(
            _search_result(
                policy,
                module_id="network",
                item_id=connection.id,
                item_type="network",
                title=f"{source_name} -> {target_name}",
                subtitle=f"{connection.source_port} -> {connection.target_port}",
                tag=connection.link_type or "Link",
            )
            for connection, source_name, target_name in network_rows
        )

    if visible("racks"):
        racks = (
            await db.execute(
                select(models.Rack)
                .where(
                    models.Rack.is_deleted.is_(False),
                    (models.Rack.name.ilike(search_term))
                    | (models.Rack.aisle.ilike(search_term))
                    | (models.Rack.row.ilike(search_term)),
                )
                .limit(10)
            )
        ).scalars().all()
        results.extend(
            _search_result(
                policy,
                module_id="racks",
                item_id=rack.id,
                item_type="rack",
                title=rack.name,
                subtitle=f"Aisle {rack.aisle or 'Unknown'} | Row {rack.row or 'Unknown'}",
                tag="Rack",
            )
            for rack in racks
        )

    if visible("logs"):
        audit_logs = (
            await db.execute(
                select(models.AuditLog)
                .where(
                    (models.AuditLog.action.ilike(search_term))
                    | (models.AuditLog.target_table.ilike(search_term))
                    | (models.AuditLog.description.ilike(search_term)),
                )
                .order_by(desc(models.AuditLog.timestamp))
                .limit(10)
            )
        ).scalars().all()
        results.extend(
            _search_result(
                policy,
                module_id="logs",
                item_id=log.id,
                item_type="audit",
                title=log.description or log.action or "Audit activity",
                subtitle=log.target_table or "Audit log",
                tag=log.action or "Activity",
            )
            for log in audit_logs
        )

    return {"results": results}
