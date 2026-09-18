from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import models
from .utils import get_current_user_id, normalize_json_object
from .module_policy import build_effective_policy, ensure_module_access, get_module_definition

async def require_workspace_module_access(
    request: Request,
    db: AsyncSession = Depends(get_db),
    workspace_key: str | None = None,
    view_id: int | None = None,
) -> None:
    module_id = workspace_key
    if not module_id and view_id is not None:
        view = await db.get(models.WorkspaceSavedView, view_id)
        module_id = view.workspace_key if view else None
    if not module_id:
        return
    try:
        get_module_definition(module_id)
    except ValueError:
        return
    await ensure_module_access(module_id, request, db)


router = APIRouter(
    prefix="/workspaces",
    tags=["Workspaces"],
    dependencies=[Depends(require_workspace_module_access)],
)

WorkspaceScope = Literal["personal", "team"]
WorkspaceArchetype = Literal["table", "topology_hybrid", "investigation", "research", "hybrid"]

MAX_VIEW_DEFINITION_BYTES = 64 * 1024
MAX_SEARCH_LENGTH = 500
MAX_LIST_ITEMS = 200
MAX_FILTER_FIELDS = 100
MAX_FILTER_VALUES = 100


class WorkspaceStateSchema(BaseModel):
    allowed_keys: list[str]
    column_ids: list[str] = Field(default_factory=list)
    quick_filter_keys: list[str] = Field(default_factory=list)
    group_by: list[str] = Field(default_factory=lambda: ["raw"])
    active_tabs: list[str] = Field(default_factory=list)
    modes: list[str] = Field(default_factory=list)


class WorkspaceDefinition(BaseModel):
    key: str
    route: str
    archetype: WorkspaceArchetype
    schema_version: int = Field(ge=1)
    capabilities: list[str]
    lifecycle_actions: list[str] = Field(default_factory=list)
    state_schema: WorkspaceStateSchema


class WorkspaceDefinitionList(BaseModel):
    definitions: list[WorkspaceDefinition]


class SavedViewBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    scope: WorkspaceScope = "personal"
    team_id: int | None = Field(default=None, ge=1)
    definition: dict[str, Any] = Field(default_factory=dict)
    schema_version: int = Field(default=1, ge=1)
    is_favorite: bool | None = None
    is_default: bool | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.split()).strip()
        if not normalized:
            raise ValueError("Saved view name cannot be blank.")
        return normalized


class SavedViewCreate(SavedViewBase):
    pass


class SavedViewUpdate(SavedViewBase):
    revision: int = Field(ge=1)


class SavedViewResponse(BaseModel):
    id: int
    workspace_key: str
    name: str
    scope: WorkspaceScope
    owner_user_id: str
    team_id: int | None
    definition: dict[str, Any]
    schema_version: int
    revision: int
    is_favorite: bool
    is_default: bool
    created_at: datetime | None
    updated_at: datetime | None


class SavedViewListResponse(BaseModel):
    views: list[SavedViewResponse]


class DeleteSavedViewResponse(BaseModel):
    status: Literal["deleted"]
    id: int
    revision: int


MONITORING_COLUMNS = [
    "select", "id", "recent_change", "favorite", "watch", "device_name", "title",
    "status", "owners", "category", "is_active", "monitored_service_names", "platform",
    "severity", "check_interval", "notification_method", "purpose", "created_at",
    "updated_at", "row_actions",
]
EXTERNAL_COLUMNS = [
    "select", "id", "recent_change", "favorite", "watch", "name", "external_entity_name",
    "direction", "device_name", "service_name", "purpose", "protocol", "port", "type",
    "internal_owner", "status", "environment", "link_count", "warning_count", "row_actions",
]
SERVICE_COLUMNS = [
    "select", "id", "recent_change", "favorite", "watch", "device_name", "name",
    "service_type", "environment", "version", "status", "purpose", "manufacturer",
    "supplier", "purchase_type", "cost", "currency", "installation_date", "secret_count",
    "created_at", "updated_at", "row_actions",
]
ASSET_COLUMNS = [
    "select", "id", "recent_change", "favorite", "watch", "name", "system", "type",
    "status", "environment", "owner", "manufacturer", "model", "os_name", "os_version",
    "primary_ip", "management_ip", "hardware_summary", "hardware_age", "open_incident_count",
    "site_name", "rack_name", "depth", "mount_orientation", "u_start", "size_u",
    "power_typical_w", "power_max_w", "created_at", "updated_at", "row_actions",
]
VENDOR_COLUMNS = [
    "select", "id", "recent_change", "favorite", "watch", "name", "country",
    "primary_personnel_name", "primary_personnel_email", "active_contract_count",
    "contract_count", "earliest_expiry_date", "personnel_count", "created_at",
    "updated_at", "row_actions",
]
FAR_COLUMNS = [
    "id", "system_name", "failure_type", "title", "severity", "occurrence", "detection",
    "rpn", "status", "vectors", "linked_rcas", "created_by_user_id",
]

TABLE_STATE_KEYS = [
    "fontSize", "rowDensity", "hiddenColumns", "groupBy", "showFilterBar",
    "columnLayoutState", "quickFilter", "quickFilters", "filterModel", "sortModel",
    "activeTab", "viewMode", "activeLens", "searchTerm", "filters",
]
MONITORING_STATE_KEYS = [
    "fontSize", "rowDensity", "hiddenColumns", "groupBy", "showFilterBar",
    "columnLayoutState", "quickFilter", "quickFilters", "filterModel", "sortModel",
]
SERVICE_STATE_KEYS = list(MONITORING_STATE_KEYS)
EXTERNAL_STATE_KEYS = [
    "fontSize", "rowDensity", "hiddenColumns", "groupBy", "activeTab", "searchTerm",
    "showFilterBar", "quickFilters", "columnLayoutState", "filterModel", "sortModel",
]
CUSTOM_STATE_KEYS = ["searchTerm", "quickFilter", "filters", "activeTab", "mode", "viewMode", "lens"]


def _definition(
    key: str,
    route: str,
    archetype: WorkspaceArchetype,
    capabilities: list[str],
    *,
    columns: list[str] | None = None,
    allowed_keys: list[str] | None = None,
    quick_filter_keys: list[str] | None = None,
    group_by: list[str] | None = None,
    active_tabs: list[str] | None = None,
    modes: list[str] | None = None,
    lifecycle_actions: list[str] | None = None,
) -> WorkspaceDefinition:
    return WorkspaceDefinition(
        key=key,
        route=route,
        archetype=archetype,
        schema_version=1,
        capabilities=capabilities,
        lifecycle_actions=lifecycle_actions or [],
        state_schema=WorkspaceStateSchema(
            allowed_keys=allowed_keys or (TABLE_STATE_KEYS if archetype == "table" else CUSTOM_STATE_KEYS),
            column_ids=columns or [],
            quick_filter_keys=quick_filter_keys or [],
            group_by=group_by or ["raw"],
            active_tabs=active_tabs or [],
            modes=modes or [],
        ),
    )


WORKSPACE_DEFINITIONS: dict[str, WorkspaceDefinition] = {
    "monitoring": _definition(
        "monitoring", "/monitoring", "table",
        ["saved_views", "search", "filters", "column_state", "grouping", "selection", "bulk_actions", "import", "export", "details", "deep_links", "lifecycle", "history", "relationships"],
        columns=MONITORING_COLUMNS,
        allowed_keys=MONITORING_STATE_KEYS,
        quick_filter_keys=["status", "severity", "platform", "owner"],
        group_by=["raw", "category", "platform", "status", "severity", "notification_method"],
        active_tabs=["active", "deleted"],
        lifecycle_actions=["archive", "restore", "purge", "revert"],
    ),
    "assets": _definition(
        "assets", "/assets", "table",
        ["saved_views", "search", "filters", "column_state", "grouping", "selection", "bulk_actions", "import", "export", "details", "deep_links", "lifecycle", "history", "compare", "relationships", "custom_modes"],
        columns=ASSET_COLUMNS,
        allowed_keys=MONITORING_STATE_KEYS,
        quick_filter_keys=["status", "system", "type", "owner"],
        group_by=["raw", "status", "system", "type", "owner"],
        active_tabs=["active", "deleted"],
        modes=["grid", "report", "map"],
        lifecycle_actions=["archive", "restore", "revert"],
    ),
    "services": _definition(
        "services", "/services", "table",
        ["saved_views", "search", "filters", "column_state", "grouping", "selection", "bulk_actions", "import", "export", "details", "deep_links", "lifecycle", "relationships"],
        columns=SERVICE_COLUMNS,
        allowed_keys=SERVICE_STATE_KEYS,
        quick_filter_keys=["status", "environment", "service_type", "device_name"],
        group_by=["raw", "status", "environment", "service_type", "device_name"],
        active_tabs=["active", "deleted"],
        lifecycle_actions=["archive", "restore", "delete", "revert"],
    ),
    "external": _definition(
        "external", "/external", "table",
        ["saved_views", "search", "filters", "column_state", "grouping", "selection", "bulk_actions", "import", "export", "details", "deep_links", "lifecycle", "relationships", "compare", "link_registry"],
        columns=EXTERNAL_COLUMNS,
        allowed_keys=EXTERNAL_STATE_KEYS,
        quick_filter_keys=["status", "type", "environment", "owner", "direction", "protocol"],
        group_by=["raw", "type", "status", "environment", "criticality"],
        active_tabs=["active", "deleted", "links"],
        lifecycle_actions=["archive", "restore", "delete", "revert"],
    ),
    "network": _definition(
        "network", "/network", "topology_hybrid",
        ["saved_views", "search", "filters", "details", "deep_links", "lifecycle", "history", "relationships", "topology", "custom_body"],
        group_by=["raw", "status", "farm", "type", "direction"],
        active_tabs=["active", "deleted"],
        modes=["topology", "table", "forensics"],
        lifecycle_actions=["archive", "restore", "revert"],
    ),
    "far": _definition(
        "far", "/far", "investigation",
        ["saved_views", "search", "filters", "column_state", "selection", "bulk_actions", "import", "export", "details", "deep_links", "lifecycle", "history", "compare", "relationships", "investigation", "custom_body"],
        columns=FAR_COLUMNS,
        allowed_keys=MONITORING_STATE_KEYS,
        quick_filter_keys=["system_name", "failure_type", "status", "risk_band"],
        group_by=["raw", "system_name", "failure_type", "status", "risk_band"],
        active_tabs=["active", "deleted"],
        modes=["failure_modes", "causes", "mitigations", "prevention"],
        lifecycle_actions=["archive", "restore"],
    ),
    "research": _definition(
        "research", "/research", "research",
        ["saved_views", "search", "filters", "details", "deep_links", "lifecycle", "history", "relationships", "research_workbench", "custom_body"],
        active_tabs=["active", "deleted"],
        modes=["portfolio", "investigation", "evidence"],
        lifecycle_actions=["archive", "restore"],
    ),
    "projects": _definition(
        "projects", "/projects", "hybrid",
        ["saved_views", "search", "filters", "deep_links", "custom_body"],
        allowed_keys=["searchTerm", "filters", "activeTab", "mode"],
        quick_filter_keys=["status", "priority", "watch"],
        active_tabs=["overview", "tasks", "timeline", "board", "files", "updates", "reports", "insights", "portfolio"],
        modes=["order", "health", "priority", "deadline", "progress", "blocked", "value", "name"],
    ),
    "vendors": _definition(
        "vendors", "/vendors", "table",
        ["saved_views", "search", "filters", "column_state", "grouping", "selection", "bulk_actions", "import", "export", "details", "deep_links", "lifecycle", "relationships"],
        columns=VENDOR_COLUMNS,
        allowed_keys=MONITORING_STATE_KEYS,
        quick_filter_keys=["country", "contractStatus"],
        group_by=["raw", "country"],
        active_tabs=["active", "deleted"],
        lifecycle_actions=["archive", "restore", "revert"],
    ),
}


def definition_for(key: str) -> WorkspaceDefinition:
    result = WORKSPACE_DEFINITIONS.get(key)
    if result is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown workspace key.")
    return result


def _bounded_string(value: Any, *, max_length: int = MAX_SEARCH_LENGTH) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:max_length]


def _bounded_string_list(value: Any, *, allowed: set[str] | None = None) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for entry in value[:MAX_LIST_ITEMS]:
        if not isinstance(entry, str):
            continue
        normalized = entry.strip()
        if not normalized or (allowed is not None and normalized not in allowed) or normalized in result:
            continue
        result.append(normalized)
    return result


def _sanitize_filter_model(value: Any, allowed_columns: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, Any] = {}
    for key, raw in list(value.items())[:MAX_FILTER_FIELDS]:
        if not isinstance(key, str) or (allowed_columns and key not in allowed_columns):
            continue
        candidate = normalize_json_object(raw) if isinstance(raw, dict) else raw
        if isinstance(candidate, dict):
            values = candidate.get("values")
            if isinstance(values, list):
                candidate["values"] = values[:MAX_FILTER_VALUES]
            normalized[key] = candidate
    return normalized


def _sanitize_sort_model(value: Any, allowed_columns: set[str]) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, str]] = []
    for entry in value[:MAX_LIST_ITEMS]:
        if not isinstance(entry, dict):
            continue
        column = entry.get("colId")
        direction = entry.get("sort")
        if not isinstance(column, str) or (allowed_columns and column not in allowed_columns):
            continue
        if direction not in {"asc", "desc"}:
            continue
        result.append({"colId": column, "sort": direction})
    return result


def _sanitize_column_layout(value: Any, allowed_columns: set[str]) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in value[:MAX_LIST_ITEMS]:
        if not isinstance(entry, dict):
            continue
        column = entry.get("colId")
        if not isinstance(column, str) or column in seen or (allowed_columns and column not in allowed_columns):
            continue
        seen.add(column)
        next_entry: dict[str, Any] = {"colId": column}
        if isinstance(entry.get("hide"), bool):
            next_entry["hide"] = entry["hide"]
        if "pinned" in entry and entry.get("pinned") in {"left", "right", None}:
            next_entry["pinned"] = entry.get("pinned")
        width = entry.get("width")
        if isinstance(width, (int, float)) and 40 <= width <= 2000:
            next_entry["width"] = int(width)
        if entry.get("sort") in {"asc", "desc"}:
            next_entry["sort"] = entry["sort"]
        result.append(next_entry)
    return result


def sanitize_definition(workspace_key: str, raw: Any) -> dict[str, Any]:
    definition = definition_for(workspace_key)
    if not isinstance(raw, dict):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Saved view definition must be an object.")
    if len(json.dumps(raw, default=str, separators=(",", ":")).encode("utf-8")) > MAX_VIEW_DEFINITION_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Saved view definition is too large.")

    schema = definition.state_schema
    allowed_keys = set(schema.allowed_keys)
    allowed_columns = set(schema.column_ids)
    normalized: dict[str, Any] = {}

    for key in allowed_keys:
        value = raw.get(key)
        if key in {"quickFilter", "searchTerm"}:
            normalized[key] = _bounded_string(value)
        elif key in {"fontSize", "rowDensity"}:
            if isinstance(value, (int, float)):
                minimum, maximum, fallback = (8, 18, 11) if key == "fontSize" else (0, 30, 8)
                normalized[key] = max(minimum, min(maximum, int(value)))
        elif key in {"showFilterBar"}:
            normalized[key] = value is not False
        elif key == "hiddenColumns":
            normalized[key] = _bounded_string_list(value, allowed=allowed_columns or None)
        elif key == "groupBy":
            normalized[key] = value if isinstance(value, str) and value in schema.group_by else "raw"
        elif key == "activeTab":
            if schema.active_tabs:
                normalized[key] = value if isinstance(value, str) and value in schema.active_tabs else schema.active_tabs[0]
        elif key in {"mode", "viewMode"}:
            if schema.modes:
                normalized[key] = value if isinstance(value, str) and value in schema.modes else schema.modes[0]
        elif key in {"activeLens", "lens"}:
            normalized[key] = _bounded_string(value, max_length=80)
        elif key == "columnLayoutState":
            normalized[key] = _sanitize_column_layout(value, allowed_columns)
        elif key == "filterModel":
            normalized[key] = _sanitize_filter_model(value, allowed_columns)
        elif key == "sortModel":
            normalized[key] = _sanitize_sort_model(value, allowed_columns)
        elif key in {"quickFilters", "filters"}:
            if isinstance(value, dict):
                allowed_filter_keys = set(schema.quick_filter_keys)
                normalized[key] = {
                    str(filter_key): _bounded_string_list(filter_values)
                    for filter_key, filter_values in list(value.items())[:MAX_FILTER_FIELDS]
                    if isinstance(filter_key, str) and (not allowed_filter_keys or filter_key in allowed_filter_keys)
                }

    return normalized


def view_payload(view: models.WorkspaceSavedView) -> SavedViewResponse:
    return SavedViewResponse(
        id=view.id,
        workspace_key=view.workspace_key,
        name=view.name,
        scope=view.scope,
        owner_user_id=view.owner_user_id,
        team_id=view.team_id,
        definition=view.definition_json or {},
        schema_version=view.schema_version,
        revision=view.revision,
        is_favorite=bool(view.is_favorite),
        is_default=bool(view.is_default),
        created_at=view.created_at,
        updated_at=view.updated_at,
    )


def validate_scope_shape(scope: WorkspaceScope, team_id: int | None) -> None:
    if scope == "personal" and team_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Personal saved views cannot have a team_id.",
        )
    if scope == "team" and team_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Team saved views require a team_id.",
        )


async def require_team_membership(
    db: AsyncSession,
    *,
    user_id: str,
    team_id: int,
    conceal: bool = False,
) -> models.Team:
    result = await db.execute(
        select(models.Team)
        .join(models.Operator, models.Operator.team_id == models.Team.id)
        .where(
            models.Team.id == team_id,
            models.Team.is_archived.is_(False),
            models.Operator.username == user_id,
        )
    )
    team = result.scalars().first()
    if team is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND if conceal else status.HTTP_403_FORBIDDEN,
            detail="Saved view not found." if conceal else "You are not a member of this team.",
        )
    return team


def validate_schema_version(definition: WorkspaceDefinition, supplied_version: int) -> None:
    if supplied_version != definition.schema_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "Saved view schema version is stale.",
                "workspace_key": definition.key,
                "current_schema_version": definition.schema_version,
            },
        )


async def clear_other_defaults(
    db: AsyncSession,
    *,
    scope: WorkspaceScope,
    user_id: str,
    team_id: int | None,
    workspace_key: str,
    exclude_view_id: int | None = None,
) -> None:
    statement = update(models.WorkspaceSavedView).where(
        models.WorkspaceSavedView.workspace_key == workspace_key,
        models.WorkspaceSavedView.scope == scope,
        models.WorkspaceSavedView.is_default.is_(True),
    )
    if scope == "personal":
        statement = statement.where(models.WorkspaceSavedView.owner_user_id == user_id)
    else:
        statement = statement.where(models.WorkspaceSavedView.team_id == team_id)
    if exclude_view_id is not None:
        statement = statement.where(models.WorkspaceSavedView.id != exclude_view_id)
    await db.execute(
        statement.values(
            is_default=False,
            revision=models.WorkspaceSavedView.revision + 1,
            updated_at=func.now(),
        )
    )


async def accessible_view(view_id: int, request: Request, db: AsyncSession) -> models.WorkspaceSavedView:
    user_id = get_current_user_id(request)
    result = await db.execute(
        select(models.WorkspaceSavedView).where(models.WorkspaceSavedView.id == view_id)
    )
    view = result.scalar_one_or_none()
    if view is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved view not found.")
    if view.scope == "personal":
        if view.owner_user_id != user_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved view not found.")
    elif view.scope == "team" and view.team_id is not None:
        await require_team_membership(db, user_id=user_id, team_id=view.team_id, conceal=True)
    else:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved view not found.")
    return view


def conflict_detail(view: models.WorkspaceSavedView) -> dict[str, Any]:
    return {
        "message": "Saved view changed on the server.",
        "current": view_payload(view).model_dump(mode="json"),
    }


@router.get("/definitions", response_model=WorkspaceDefinitionList)
async def list_definitions(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> WorkspaceDefinitionList:
    policy = await build_effective_policy(request, db)
    definitions = [
        definition for definition in WORKSPACE_DEFINITIONS.values()
        if policy["modules"].get(definition.key, {}).get("available")
    ]
    return WorkspaceDefinitionList(definitions=definitions)


@router.get("/{workspace_key}/views", response_model=SavedViewListResponse)
async def list_views(
    workspace_key: str,
    request: Request,
    scope: WorkspaceScope = Query(default="personal"),
    team_id: int | None = Query(default=None, ge=1),
    db: AsyncSession = Depends(get_db),
) -> SavedViewListResponse:
    definition_for(workspace_key)
    validate_scope_shape(scope, team_id)
    user_id = get_current_user_id(request)
    statement = select(models.WorkspaceSavedView).where(
        models.WorkspaceSavedView.workspace_key == workspace_key,
        models.WorkspaceSavedView.scope == scope,
    )
    if scope == "personal":
        statement = statement.where(models.WorkspaceSavedView.owner_user_id == user_id)
    else:
        await require_team_membership(db, user_id=user_id, team_id=team_id)
        statement = statement.where(models.WorkspaceSavedView.team_id == team_id)
    rows = await db.execute(
        statement.order_by(models.WorkspaceSavedView.updated_at.desc(), models.WorkspaceSavedView.id.desc())
    )
    return SavedViewListResponse(views=[view_payload(row) for row in rows.scalars().all()])


@router.post("/{workspace_key}/views", response_model=SavedViewResponse, status_code=status.HTTP_201_CREATED)
async def create_view(
    workspace_key: str,
    body: SavedViewCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> SavedViewResponse:
    definition = definition_for(workspace_key)
    validate_scope_shape(body.scope, body.team_id)
    validate_schema_version(definition, body.schema_version)
    user_id = get_current_user_id(request)
    if body.scope == "team":
        await require_team_membership(db, user_id=user_id, team_id=body.team_id)
    normalized = sanitize_definition(workspace_key, body.definition)
    is_favorite = bool(body.is_favorite)
    is_default = bool(body.is_default)
    if is_default:
        await clear_other_defaults(
            db,
            scope=body.scope,
            user_id=user_id,
            team_id=body.team_id,
            workspace_key=workspace_key,
        )
    view = models.WorkspaceSavedView(
        workspace_key=workspace_key,
        name=body.name,
        scope=body.scope,
        owner_user_id=user_id,
        team_id=body.team_id,
        definition_json=normalized,
        schema_version=definition.schema_version,
        revision=1,
        is_favorite=is_favorite,
        is_default=is_default,
        created_by_user_id=user_id,
    )
    db.add(view)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A saved view with this name already exists.") from exc
    await db.refresh(view)
    return view_payload(view)


@router.get("/views/{view_id}", response_model=SavedViewResponse)
async def get_view(
    view_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> SavedViewResponse:
    return view_payload(await accessible_view(view_id, request, db))


@router.put("/views/{view_id}", response_model=SavedViewResponse)
async def update_view(
    view_id: int,
    body: SavedViewUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> SavedViewResponse:
    current = await accessible_view(view_id, request, db)
    validate_scope_shape(body.scope, body.team_id)
    if body.scope != current.scope or body.team_id != current.team_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Saved view scope and team cannot be changed.",
        )
    definition = definition_for(current.workspace_key)
    validate_schema_version(definition, body.schema_version)
    normalized = sanitize_definition(current.workspace_key, body.definition)
    user_id = get_current_user_id(request)
    next_is_favorite = bool(current.is_favorite) if body.is_favorite is None else body.is_favorite
    next_is_default = bool(current.is_default) if body.is_default is None else body.is_default
    identity_predicate = (
        models.WorkspaceSavedView.owner_user_id == user_id
        if current.scope == "personal"
        else models.WorkspaceSavedView.team_id == current.team_id
    )

    try:
        # First win the optimistic revision race while temporarily demoting this
        # view. This avoids violating the single-default index before the prior
        # default is atomically demoted in the same transaction.
        result = await db.execute(
            update(models.WorkspaceSavedView)
            .where(
                models.WorkspaceSavedView.id == view_id,
                models.WorkspaceSavedView.scope == current.scope,
                identity_predicate,
                models.WorkspaceSavedView.revision == body.revision,
            )
            .values(
                name=body.name,
                definition_json=normalized,
                schema_version=definition.schema_version,
                revision=body.revision + 1,
                is_favorite=next_is_favorite,
                is_default=False,
                updated_at=func.now(),
            )
        )
        if result.rowcount != 1:
            await db.rollback()
            latest = await accessible_view(view_id, request, db)
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=conflict_detail(latest))
        if next_is_default:
            await clear_other_defaults(
                db,
                scope=current.scope,
                user_id=user_id,
                team_id=current.team_id,
                workspace_key=current.workspace_key,
                exclude_view_id=view_id,
            )
            promoted = await db.execute(
                update(models.WorkspaceSavedView)
                .where(
                    models.WorkspaceSavedView.id == view_id,
                    models.WorkspaceSavedView.scope == current.scope,
                    identity_predicate,
                    models.WorkspaceSavedView.revision == body.revision + 1,
                )
                .values(is_default=True)
            )
            if promoted.rowcount != 1:
                await db.rollback()
                latest = await accessible_view(view_id, request, db)
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=conflict_detail(latest))
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A saved view with this name already exists.") from exc

    updated = await accessible_view(view_id, request, db)
    return view_payload(updated)


@router.delete("/views/{view_id}", response_model=DeleteSavedViewResponse)
async def delete_view(
    view_id: int,
    request: Request,
    revision: int = Query(ge=1),
    db: AsyncSession = Depends(get_db),
) -> DeleteSavedViewResponse:
    current = await accessible_view(view_id, request, db)
    user_id = get_current_user_id(request)
    identity_predicate = (
        models.WorkspaceSavedView.owner_user_id == user_id
        if current.scope == "personal"
        else models.WorkspaceSavedView.team_id == current.team_id
    )
    result = await db.execute(
        delete(models.WorkspaceSavedView).where(
            models.WorkspaceSavedView.id == view_id,
            models.WorkspaceSavedView.scope == current.scope,
            identity_predicate,
            models.WorkspaceSavedView.revision == revision,
        )
    )
    if result.rowcount != 1:
        await db.rollback()
        latest = await accessible_view(view_id, request, db)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=conflict_detail(latest))
    await db.commit()
    return DeleteSavedViewResponse(status="deleted", id=current.id, revision=revision)
