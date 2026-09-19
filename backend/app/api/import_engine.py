from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
import io
import json
import re
from typing import Any, Awaitable, Callable, Dict, List, Optional

import pandas as pd
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, inspect, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from ..database import get_db
from ..models import models
from ..schemas import schemas
from .monitoring import (
    build_monitoring_payload,
    build_monitoring_snapshot_from_values,
    ensure_monitoring_item_uniqueness,
    save_monitoring_history,
    summarize_monitoring_snapshot_delta,
)
from .far import save_far_history
from .utils import filter_valid_columns, get_current_user_id
from .module_policy import ensure_module_access

router = APIRouter(prefix="/import", tags=["Intelligence Engine"])
MONITORING_IMPORT_SCHEMA_VERSION = "2026-06-monitoring-v1"
EXTERNAL_IMPORT_SCHEMA_VERSION = "2026-06-external-v1"
NETWORK_IMPORT_SCHEMA_VERSION = "2026-06-network-v1"
FAR_IMPORT_SCHEMA_VERSION = "2026-08-far-v1"
ROUND_TRIP_EXPOSE_HEADER_NAMES = (
    "Content-Disposition",
    "X-SysGrid-Import-Profile",
    "X-SysGrid-Schema-Version",
)
ROUND_TRIP_EXPOSE_HEADERS = ", ".join(ROUND_TRIP_EXPOSE_HEADER_NAMES)
EXTERNAL_SNAPSHOT_EXPORT_TOKEN_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$")


@dataclass
class ImportField:
    name: str
    label: str
    required: bool = False
    description: str = ""
    input_kind: str = "text"
    input_control: str = "text"
    template_hint: str = ""
    aliases: list[str] = field(default_factory=list)
    accepts_multiple: bool = False
    supported_in_builder: bool = True
    unsupported_reason: str = ""
    validation_rules: list[str] = field(default_factory=list)
    options_key: Optional[str] = None


@dataclass
class ImportProfile:
    key: str
    display_name: str
    model: Any
    fields: list[ImportField]
    execute_rows: Callable[[AsyncSession, list[dict[str, Any]], Optional[str]], Any]
    preview_rows: Callable[[AsyncSession, list[dict[str, Any]]], Any]
    schema_context: Optional[Callable[[AsyncSession], Awaitable[dict[str, Any]]]] = None
    serialize_example_row: Optional[Callable[[AsyncSession, Any], Awaitable[dict[str, Any]]]] = None


GENERIC_EXCLUDE_COLUMNS = {
    "id",
    "created_at",
    "updated_at",
    "created_by_user_id",
    "hardware_age",
    "open_incident_count",
}


def normalize_scalar(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    if isinstance(value, str):
      trimmed = value.strip()
      return trimmed or None
    return value


def stringify_json(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return value


def coerce_bool(value: Any) -> bool:
    normalized = str(value).strip().lower()
    if normalized in {"true", "1", "yes", "y"}:
        return True
    if normalized in {"false", "0", "no", "n"}:
        return False
    raise ValueError("must be a boolean")


def coerce_value_for_column(column: Any, value: Any) -> Any:
    normalized = normalize_scalar(value)
    if normalized is None:
        return None
    python_type = column.type.python_type
    if python_type == bool:
        return coerce_bool(normalized)
    if python_type == int:
        return int(normalized)
    if python_type == float:
        return float(normalized)
    if python_type in {dict, list}:
        if isinstance(normalized, str):
            return json.loads(normalized)
        return normalized
    return normalized


def split_multi_value(value: Any) -> list[str]:
    normalized = normalize_scalar(value)
    if normalized is None:
        return []
    if isinstance(normalized, list):
        return [str(entry).strip() for entry in normalized if str(entry).strip()]
    raw = str(normalized).replace("\n", ",")
    return [entry.strip() for entry in raw.split(",") if entry.strip()]


def rows_from_dataframe(df: pd.DataFrame) -> list[dict[str, Any]]:
    records = df.to_dict(orient="records")
    return [
        {key: normalize_scalar(value) for key, value in record.items()}
        for record in records
    ]


def load_dataframe_from_upload(file: UploadFile, content: bytes) -> pd.DataFrame:
    lower_name = (file.filename or "").lower()
    if lower_name.endswith(".csv"):
        return pd.read_csv(io.BytesIO(content))
    if lower_name.endswith(".xlsx") or lower_name.endswith(".xls"):
        return pd.read_excel(io.BytesIO(content))
    raise HTTPException(status_code=400, detail="Only CSV and Excel uploads are supported")


def generic_fields_for_model(model: Any) -> list[ImportField]:
    mapper = inspect(model)
    fields: list[ImportField] = []
    for column in mapper.columns:
        if column.primary_key or column.name in GENERIC_EXCLUDE_COLUMNS:
            continue
        hint = "[STRING]"
        try:
            python_type = column.type.python_type
            if python_type == int:
                hint = "[INTEGER]"
            elif python_type == float:
                hint = "[FLOAT]"
            elif python_type == bool:
                hint = "[BOOLEAN]"
            elif python_type == dict:
                hint = "[JSON_OBJECT]"
            elif python_type == list:
                hint = "[JSON_ARRAY]"
        except NotImplementedError:
            pass
        fields.append(
            ImportField(
                name=column.name,
                label=column.name.replace("_", " ").title(),
                required=not column.nullable and column.default is None and column.server_default is None,
                template_hint=hint,
            )
        )
    return fields


async def preview_generic_rows(db: AsyncSession, model: Any, rows: list[dict[str, Any]]) -> dict[str, Any]:
    mapper = inspect(model)
    relevant_columns = {
        column.name: column
        for column in mapper.columns
        if not column.primary_key and column.name not in GENERIC_EXCLUDE_COLUMNS
    }
    results = []
    for index, raw_row in enumerate(rows):
        normalized_row: dict[str, Any] = {}
        errors: list[str] = []
        for column_name, column in relevant_columns.items():
            try:
                normalized_row[column_name] = coerce_value_for_column(column, raw_row.get(column_name))
            except (ValueError, TypeError, json.JSONDecodeError):
                errors.append(f"{column_name} has an invalid value")

            value = normalized_row.get(column_name)
            if not column.nullable and value is None and column.default is None and column.server_default is None:
                errors.append(f"{column_name} is required")

        results.append({
            "row": index + 1,
            "source": raw_row,
            "normalized": normalized_row,
            "status": "VALID" if not errors else "INVALID",
            "errors": errors,
        })

    valid = [result for result in results if result["status"] == "VALID"]
    invalid = [result for result in results if result["status"] == "INVALID"]
    return {
        "total_rows": len(results),
        "valid_rows": len(valid),
        "invalid_rows": len(invalid),
        "total_errors": sum(len(result["errors"]) for result in invalid),
        "results": results,
    }


async def execute_generic_rows(db: AsyncSession, model: Any, rows: list[dict[str, Any]], user_id: Optional[str]) -> dict[str, Any]:
    preview = await preview_generic_rows(db, model, rows)
    invalid = [result for result in preview["results"] if result["status"] == "INVALID"]
    if invalid:
        return {"status": "failed", "errors": [f"Row {result['row']}: {', '.join(result['errors'])}" for result in invalid], "count": 0}

    mapper = inspect(model)
    relevant_columns = {
        column.name: column
        for column in mapper.columns
        if not column.primary_key and column.name not in GENERIC_EXCLUDE_COLUMNS
    }
    count = 0
    for raw_row in rows:
        clean_data = {}
        for column_name, column in relevant_columns.items():
            clean_data[column_name] = coerce_value_for_column(column, raw_row.get(column_name))
        clean_data = filter_valid_columns(model, clean_data)
        if hasattr(model, "created_by_user_id") and user_id:
            clean_data["created_by_user_id"] = user_id
        db.add(model(**clean_data))
        count += 1

    await db.commit()
    if user_id:
        db.add(models.AuditLog(
            user_id=user_id,
            action="BULK_IMPORT",
            target_table=model.__tablename__.upper(),
            target_id="MULTIPLE",
            description=f"Bulk imported {count} records into {model.__tablename__}.",
        ))
        await db.commit()
    return {"status": "success", "count": count}


MONITORING_IMPORT_REQUIRED_FIELD_NAMES = {"category", "status", "title"}
MONITORING_REQUIRED_UI_FIELD_NAMES = {"category", "status", "title", "severity"}
MONITORING_IMPORT_SUPPORTED_FIELD_NAMES = {
    "device_name",
    "category",
    "status",
    "title",
    "platform",
    "purpose",
    "impact",
    "notification_method",
    "notification_recipients",
    "owner_team",
    "owner_user_ids",
    "monitoring_url",
    "severity",
    "check_interval",
    "alert_duration",
    "notification_throttle",
}

EXTERNAL_IMPORT_REQUIRED_FIELD_NAMES = {
    "name",
    "type",
    "ownership_mode",
    "status",
    "environment",
    "business_purpose",
    "contacts_json",
}


def build_monitoring_import_fields() -> list[ImportField]:
    return [
        ImportField("device_name", "Target Asset", description="Existing asset name or tag. Resolves to device_id.", template_hint="[Name or Asset Tag]", input_control="select", options_key="device_name"),
        ImportField("category", "Category", required="category" in MONITORING_IMPORT_REQUIRED_FIELD_NAMES, template_hint="[Monitoring category]", input_control="select", options_key="category"),
        ImportField("status", "Status", required="status" in MONITORING_IMPORT_REQUIRED_FIELD_NAMES, template_hint="[Existing|Planned|Cancelled|Decommissioned]", input_control="select", options_key="status"),
        ImportField("title", "Title", required="title" in MONITORING_IMPORT_REQUIRED_FIELD_NAMES, template_hint="[Short monitor title]", validation_rules=["Required. Keep it concise and unique enough to identify the monitor."]),
        ImportField("platform", "Platform", required=False, template_hint="[Monitoring platform]", input_control="select", options_key="platform"),
        ImportField("purpose", "Purpose", template_hint="[Why this monitor exists]", input_kind="multiline", input_control="textarea"),
        ImportField("impact", "Impact", template_hint="[What happens if it fails]", input_kind="multiline", input_control="textarea"),
        ImportField("notification_method", "Notification Method", template_hint="[Notification route]", input_control="select", options_key="notification_method"),
        ImportField("notification_recipients", "Notification Recipients", input_kind="multiline", input_control="textarea", template_hint="[comma separated user IDs or emails]", accepts_multiple=True, validation_rules=["Comma-separated recipients only."]),
        ImportField("owner_team", "Owner Team(s)", required=False, template_hint="[comma separated managed team names]", input_control="textarea", options_key="owner_team", accepts_multiple=True, validation_rules=["Optional. Use comma-separated team names from the registered team list."]),
        ImportField("owner_user_ids", "Owner User ID(s)", required=False, template_hint="[comma separated usernames or external IDs]", input_control="textarea", options_key="owner_user_ids", accepts_multiple=True, validation_rules=["Optional. Use comma-separated usernames or external IDs from the operator list. Default role is Primary Support."]),
        ImportField("monitoring_url", "Monitoring URL", template_hint="[https://...]", input_control="url", validation_rules=["Must be a valid http/https URL with a host."]),
        ImportField("severity", "Severity", required=True, template_hint="[Critical|Warning|Info]", input_control="select", options_key="severity"),
        ImportField("check_interval", "Check Interval (sec)", template_hint="[15-86400]", input_control="number", validation_rules=["Must be between 15 and 86400 seconds."]),
        ImportField("alert_duration", "Alert Duration (sec)", template_hint="[0-86400]", input_control="number", validation_rules=["Must be between 0 and 86400 seconds."]),
        ImportField("notification_throttle", "Notification Throttle (sec)", template_hint="[60-604800]", input_control="number", validation_rules=["Must be between 60 and 604800 seconds."]),
        ImportField("spec", "Spec", input_kind="multiline", input_control="unsupported", template_hint="[Use add/edit workspace]", supported_in_builder=False, unsupported_reason="Spec content is freeform threshold documentation and is not standardized enough for strict bulk import."),
        ImportField("logic", "Logic", input_kind="multiline", input_control="unsupported", template_hint="[Use add/edit workspace]", supported_in_builder=False, unsupported_reason="Logic belongs in the structured monitoring logic editor, not the simplified import grid."),
        ImportField("monitored_service_names", "Services", input_control="unsupported", template_hint="[Use add/edit workspace]", accepts_multiple=True, supported_in_builder=False, unsupported_reason="Service coverage depends on the linked asset and must be chosen from the add/edit workspace."),
        ImportField("recovery_doc_titles", "Recovery Documents", input_control="unsupported", template_hint="[Use add/edit workspace]", accepts_multiple=True, supported_in_builder=False, unsupported_reason="Recovery documents should be linked from the knowledge workspace search, not typed into bulk import."),
    ]


MONITORING_IMPORT_FIELDS = build_monitoring_import_fields()


def build_external_import_fields() -> list[ImportField]:
    bool_options = [
        {"value": "true", "label": "True"},
        {"value": "false", "label": "False"},
    ]
    return [
        ImportField("name", "Entity Name", required=True, template_hint="[External entity name]", validation_rules=["Required. Must be unique with its type and owner organization."]),
        ImportField("external_key", "External Key", template_hint="[lowercase unique key]", validation_rules=["Optional. Lowercase letters, numbers, dot, underscore, colon, or dash."]),
        ImportField("aliases_json", "Aliases", input_kind="multiline", template_hint="[alias1, alias2]", validation_rules=["Optional. Use a JSON array or comma-separated aliases."], accepts_multiple=True),
        ImportField("type", "Type", required=True, input_control="select", options_key="type", template_hint="[Entity type]", validation_rules=["Required. Use a configured external type."]),
        ImportField("subtype", "Subtype", template_hint="[Sub classification]"),
        ImportField("owner_organization", "Owner Organization", template_hint="[Partner organization]"),
        ImportField("owner_team", "Owner Team", template_hint="[External team label]"),
        ImportField("ownership_mode", "Ownership Mode", required=True, input_control="select", options_key="ownership_mode", template_hint="[team|individual]", validation_rules=["Required. Determines whether the accountable owner is a team or operator."]),
        ImportField("internal_team_id", "Accountable Team", input_control="select", options_key="internal_team_id", template_hint="[Registered team name or ID]", validation_rules=["Required when ownership mode is team."]),
        ImportField("internal_operator_id", "Accountable Operator", input_control="select", options_key="internal_operator_id", template_hint="[Registered operator username, external ID, or ID]", validation_rules=["Required when ownership mode is individual."]),
        ImportField("status", "Status", required=True, input_control="select", options_key="status", template_hint="[Operational status]", validation_rules=["Required."]),
        ImportField("environment", "Environment", required=True, input_control="select", options_key="environment", template_hint="[Production|Staging|...]", validation_rules=["Required."]),
        ImportField("description", "Description", input_kind="multiline", template_hint="[Operational description]"),
        ImportField("notes", "Notes", input_kind="multiline", template_hint="[Operational notes]"),
        ImportField("business_purpose", "Business Purpose", required=True, input_kind="multiline", template_hint="[Why this entity matters]", validation_rules=["Required."]),
        ImportField("criticality", "Criticality", input_control="select", options_key="criticality", template_hint="[Low|Medium|High|Critical]"),
        ImportField("dependency_tier", "Dependency Tier", input_control="select", options_key="dependency_tier", template_hint="[Tier 1|Tier 2|Tier 3]"),
        ImportField("data_classification", "Data Classification", input_control="select", options_key="data_classification", template_hint="[Public|Internal|Confidential|Restricted]"),
        ImportField("integration_mode", "Integration Mode", input_control="select", options_key="integration_mode", template_hint="[API|Manual|File|Streaming]"),
        ImportField("primary_endpoint_url", "Primary Endpoint URL", template_hint="[https://...]", validation_rules=["Must use a safe supported URL scheme."]),
        ImportField("secondary_endpoint_url", "Secondary Endpoint URL", template_hint="[https://...]", validation_rules=["Must use a safe supported URL scheme."]),
        ImportField("auth_method", "Auth Method", input_control="select", options_key="auth_method", template_hint="[Token|OAuth|mTLS|Manual]"),
        ImportField("protocol_family", "Protocol Family", input_control="select", options_key="protocol_family", template_hint="[HTTPS|SFTP|SSH|Database]"),
        ImportField("port_override", "Port Override", input_control="number", template_hint="[1-65535]", validation_rules=["Optional. Must be a valid port number."]),
        ImportField("supports_inbound", "Supports Inbound", input_control="select", options_key="boolean_truthy", template_hint="[true|false]"),
        ImportField("supports_outbound", "Supports Outbound", input_control="select", options_key="boolean_truthy", template_hint="[true|false]"),
        ImportField("source_system", "Source System", template_hint="[Upstream system]"),
        ImportField("source_record_id", "Source Record ID", template_hint="[Source system identifier]"),
        ImportField("risk_rating", "Risk Rating", input_control="select", options_key="risk_rating", template_hint="[Low|Medium|High]"),
        ImportField("contains_customer_data", "Contains Customer Data", input_control="select", options_key="boolean_truthy", template_hint="[true|false]"),
        ImportField("contains_credentials", "Contains Credentials", input_control="select", options_key="boolean_truthy", template_hint="[true|false]"),
        ImportField("stores_pii", "Stores PII", input_control="select", options_key="boolean_truthy", template_hint="[true|false]"),
        ImportField("internet_exposed", "Internet Exposed", input_control="select", options_key="boolean_truthy", template_hint="[true|false]"),
        ImportField("third_party_assessment_status", "Assessment Status", input_control="select", options_key="assessment_status", template_hint="[Not Started|In Progress|Complete]"),
        ImportField("contacts_json", "Contacts JSON", required=True, input_kind="multiline", input_control="textarea", template_hint='[{"role":"Primary","full_name":"Jane Doe","email":"jane@example.com","is_primary":true}]', validation_rules=["Required. Use a JSON array of contact objects."]),
        ImportField("metadata_json", "Metadata JSON", input_kind="multiline", input_control="textarea", template_hint='{"key":"value"}', validation_rules=["Optional. Use a JSON object."]),
    ]


EXTERNAL_IMPORT_FIELDS = build_external_import_fields()


def build_network_import_fields() -> list[ImportField]:
    return [
        ImportField("source_device_id", "Source Device", required=True, input_control="select", options_key="source_device_id", template_hint="[Device name, asset tag, or ID]", validation_rules=["Required. Resolve the source endpoint device from the device roster."]),
        ImportField("source_port", "Source Port", required=True, template_hint="[Source port name]", validation_rules=["Required."]),
        ImportField("source_ip", "Source IP", template_hint="[IPv4 or IPv6]"),
        ImportField("source_mac", "Source MAC", template_hint="[MAC address]"),
        ImportField("source_vlan", "Source VLAN", input_control="number", template_hint="[0-4094]", validation_rules=["Optional. Must be between 0 and 4094."]),
        ImportField("target_device_id", "Peer Device", required=True, input_control="select", options_key="target_device_id", template_hint="[Device name, asset tag, or ID]", validation_rules=["Required. Resolve the peer endpoint device from the device roster."]),
        ImportField("target_port", "Peer Port", required=True, template_hint="[Peer port name]", validation_rules=["Required."]),
        ImportField("target_ip", "Peer IP", template_hint="[IPv4 or IPv6]"),
        ImportField("target_mac", "Peer MAC", template_hint="[MAC address]"),
        ImportField("target_vlan", "Peer VLAN", input_control="number", template_hint="[0-4094]", validation_rules=["Optional. Must be between 0 and 4094."]),
        ImportField("link_type", "Type", required=True, input_control="select", options_key="link_type", template_hint="[Connection type]", validation_rules=["Required. Use a configured connection type."], aliases=["type"]),
        ImportField("speed_gbps", "Speed", input_control="number", template_hint="[Speed value]"),
        ImportField("unit", "Unit", input_control="select", options_key="unit", template_hint="[Gbps|Mbps|Kbps]"),
        ImportField("direction", "Direction", input_control="select", options_key="direction", template_hint="[Bidirectional|Unidirectional|Source to Target|Target to Source]"),
        ImportField("purpose", "Purpose", input_kind="multiline", template_hint="[Why the connection exists]"),
        ImportField("farm", "Farm", input_control="select", options_key="farm", template_hint="[Network farm]"),
        ImportField("cable_type", "Cable Type", input_control="select", options_key="cable_type", template_hint="[Configured cable type]"),
        ImportField("status", "Status", required=True, input_control="select", options_key="status", template_hint="[Active|Maintenance|Down|Planned|Requested|Standby|Offline|Deleted]"),
        ImportField("request_link", "Request Link", input_control="url", template_hint="[https://...]"),
    ]


NETWORK_IMPORT_FIELDS = build_network_import_fields()


async def fetch_setting_options(db: AsyncSession, category: str) -> list[dict[str, str]]:
    result = await db.execute(
        select(models.SettingOption.value, models.SettingOption.label, models.SettingOption.description)
        .where(models.SettingOption.category == category)
        .order_by(models.SettingOption.label)
    )
    return [
        {
            "value": value,
            "label": label or value,
            "description": description or "",
        }
        for value, label, description in result.all()
        if value
    ]


async def build_monitoring_schema_context(db: AsyncSession) -> dict[str, Any]:
    devices = await db.execute(select(models.Device.name).where(models.Device.is_deleted == False).order_by(models.Device.name))
    teams = await db.execute(select(models.Team.name).where(models.Team.is_archived == False).order_by(models.Team.name))
    operators = await db.execute(
        select(models.Operator.username, models.Operator.external_id, models.Operator.full_name)
        .order_by(models.Operator.username)
    )
    methods = await fetch_setting_options(db, "NotificationMethod")

    example_items_res = await db.execute(
        select(models.MonitoringItem.id, models.MonitoringItem.title)
        .where(models.MonitoringItem.is_deleted == False)
        .order_by(models.MonitoringItem.updated_at.desc(), models.MonitoringItem.id.desc())
        .limit(20)
    )

    return {
        "options": {
            "device_name": [{"value": name, "label": name, "description": "Existing asset"} for name in devices.scalars().all() if name],
            "category": await fetch_setting_options(db, "MonitoringCategory"),
            "platform": await fetch_setting_options(db, "MonitoringPlatform"),
            "notification_method": methods,
            "owner_team": [{"value": name, "label": name, "description": "Registered team"} for name in teams.scalars().all() if name],
            "owner_user_ids": [
                {
                    "value": username or external_id,
                    "label": username or external_id,
                    "description": full_name or external_id or "",
                }
                for username, external_id, full_name in operators.all()
                if username or external_id
            ],
            "severity": [
                {"value": "Critical", "label": "Critical", "description": "Requires linked recovery guidance."},
                {"value": "Warning", "label": "Warning", "description": "Actionable but not highest urgency."},
                {"value": "Info", "label": "Info", "description": "Informational visibility only."},
            ],
            "status": [
                {"value": "Existing", "label": "Existing", "description": "Already in production."},
                {"value": "Planned", "label": "Planned", "description": "Approved but not yet active."},
                {"value": "Cancelled", "label": "Cancelled", "description": "Retired before implementation."},
                {"value": "Decommissioned", "label": "Decommissioned", "description": "Previously active and now retired."},
            ],
        },
        "example_records": [
            {"id": item_id, "label": title}
            for item_id, title in example_items_res.all()
            if title
        ],
    }


async def serialize_monitoring_example_row(db: AsyncSession, item: models.MonitoringItem) -> dict[str, Any]:
    device_name = None
    if item.device_id:
        device_name = await db.scalar(select(models.Device.name).where(models.Device.id == item.device_id))

    monitored_service_names: list[str] = []
    if item.monitored_services:
        service_result = await db.execute(
            select(models.LogicalService.name).where(models.LogicalService.id.in_(item.monitored_services))
        )
        monitored_service_names = [name for name in service_result.scalars().all() if name]

    recovery_doc_titles: list[str] = []
    if item.recovery_docs:
        recovery_doc_ids = [doc.get("id") if isinstance(doc, dict) else doc for doc in item.recovery_docs]
        recovery_doc_result = await db.execute(
            select(models.KnowledgeEntry.title).where(models.KnowledgeEntry.id.in_(recovery_doc_ids))
        )
        recovery_doc_titles = [title for title in recovery_doc_result.scalars().all() if title]

    return {
        "device_name": device_name or "",
        "category": item.category or "",
        "status": item.status or "",
        "title": item.title or "",
        "platform": item.platform or "",
        "purpose": item.purpose or "",
        "impact": item.impact or "",
        "notification_method": item.notification_method or "",
        "notification_recipients": ", ".join(item.notification_recipients or []),
        "owner_team": item.owner_team or "",
        "owner_user_ids": ", ".join([
            owner.external_id or (owner.operator.username if owner.operator else "") or str(owner.operator_id or "")
            for owner in item.owners
        ]),
        "monitoring_url": item.monitoring_url or "",
        "severity": item.severity or "",
        "check_interval": item.check_interval,
        "alert_duration": item.alert_duration,
        "notification_throttle": item.notification_throttle,
        "spec": item.spec or "",
        "logic": item.logic or "",
        "monitored_service_names": ", ".join(monitored_service_names),
        "recovery_doc_titles": ", ".join(recovery_doc_titles),
    }


async def build_external_schema_context(db: AsyncSession) -> dict[str, Any]:
    types = await fetch_setting_options(db, "ExternalType")
    statuses = await fetch_setting_options(db, "Status")
    environments = await fetch_setting_options(db, "Environment")
    teams = await db.execute(select(models.Team.name).where(models.Team.is_archived == False).order_by(models.Team.name))
    operators = await db.execute(
        select(models.Operator.username, models.Operator.external_id, models.Operator.full_name)
        .order_by(models.Operator.username)
    )
    example_entities = await db.execute(
        select(models.ExternalEntity.id, models.ExternalEntity.name)
        .where(models.ExternalEntity.is_deleted == False)
        .order_by(models.ExternalEntity.updated_at.desc(), models.ExternalEntity.id.desc())
        .limit(20)
    )
    return {
        "options": {
            "type": types,
            "status": statuses,
            "environment": environments,
            "ownership_mode": [
                {"value": "team", "label": "team", "description": "Accountable internal team"},
                {"value": "individual", "label": "individual", "description": "Accountable internal operator"},
            ],
            "internal_team_id": [
                {"value": str(team_name), "label": team_name, "description": "Registered team"}
                for team_name in teams.scalars().all()
                if team_name
            ],
            "internal_operator_id": [
                {
                    "value": username or external_id or str(full_name or ""),
                    "label": username or external_id or str(full_name or ""),
                    "description": full_name or external_id or "",
                }
                for username, external_id, full_name in operators.all()
                if username or external_id
            ],
            "criticality": [
                {"value": "Low", "label": "Low"},
                {"value": "Medium", "label": "Medium"},
                {"value": "High", "label": "High"},
                {"value": "Critical", "label": "Critical"},
            ],
            "dependency_tier": [
                {"value": "Tier 1", "label": "Tier 1"},
                {"value": "Tier 2", "label": "Tier 2"},
                {"value": "Tier 3", "label": "Tier 3"},
            ],
            "data_classification": [
                {"value": "Public", "label": "Public"},
                {"value": "Internal", "label": "Internal"},
                {"value": "Confidential", "label": "Confidential"},
                {"value": "Restricted", "label": "Restricted"},
            ],
            "integration_mode": [
                {"value": "API", "label": "API"},
                {"value": "Manual", "label": "Manual"},
                {"value": "File", "label": "File"},
                {"value": "Streaming", "label": "Streaming"},
            ],
            "auth_method": [
                {"value": "Token", "label": "Token"},
                {"value": "OAuth", "label": "OAuth"},
                {"value": "mTLS", "label": "mTLS"},
                {"value": "Manual", "label": "Manual"},
            ],
            "protocol_family": [
                {"value": "HTTPS", "label": "HTTPS"},
                {"value": "HTTP", "label": "HTTP"},
                {"value": "SFTP", "label": "SFTP"},
                {"value": "SSH", "label": "SSH"},
                {"value": "Database", "label": "Database"},
            ],
            "risk_rating": [
                {"value": "Low", "label": "Low"},
                {"value": "Medium", "label": "Medium"},
                {"value": "High", "label": "High"},
            ],
            "assessment_status": [
                {"value": "Not Started", "label": "Not Started"},
                {"value": "In Progress", "label": "In Progress"},
                {"value": "Complete", "label": "Complete"},
            ],
            "boolean_truthy": [
                {"value": "true", "label": "True"},
                {"value": "false", "label": "False"},
            ],
        },
        "example_records": [
            {"id": entity_id, "label": name}
            for entity_id, name in example_entities.all()
            if name
        ],
    }


def _parse_json_value(value: Any, *, default: Any, field_name: str) -> Any:
    normalized = normalize_scalar(value)
    if normalized is None:
        return default
    if isinstance(normalized, (dict, list)):
        return normalized
    if isinstance(normalized, str):
        try:
            return json.loads(normalized)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail=f"{field_name} must contain valid JSON") from exc
    return normalized


def _parse_bool_value(value: Any, *, field_name: str) -> Optional[bool]:
    normalized = normalize_scalar(value)
    if normalized is None:
        return None
    if isinstance(normalized, bool):
        return normalized
    text = str(normalized).strip().lower()
    if text in {"true", "1", "yes", "y"}:
        return True
    if text in {"false", "0", "no", "n"}:
        return False
    raise HTTPException(status_code=400, detail=f"{field_name} must be a boolean value")


def _normalize_external_export_risk_rating(value: Optional[str]) -> str:
    normalized = (value or "").strip()
    if normalized in {"Critical", "High", "Medium", "Low"}:
        return normalized
    if normalized == "Elevated":
        return "High"
    if normalized == "Moderate":
        return "Medium"
    return "Low"


def _normalize_external_export_assessment_status(value: Optional[str]) -> Optional[str]:
    normalized = (value or "").strip()
    if not normalized:
        return None
    if normalized in {"Required", "In Progress", "Approved", "Rejected", "Not Required"}:
        return normalized
    if normalized == "Pending":
        return "In Progress"
    if normalized == "Review Needed":
        return "Required"
    if normalized == "Complete":
        return "Approved"
    if normalized == "Not Started":
        return "Required"
    return None


async def _resolve_team_id(db: AsyncSession, value: Any) -> Optional[int]:
    normalized = normalize_scalar(value)
    if normalized is None:
        return None
    try:
        team_identifier = _parse_int_like(normalized)
    except ValueError:
        team_identifier = None
    if team_identifier is not None:
        team = await db.get(models.Team, team_identifier)
        if team and not team.is_archived:
            return team.id
    res = await db.execute(
        select(models.Team.id).where(
            models.Team.is_archived == False,
            func.lower(models.Team.name) == func.lower(str(normalized)),
        )
    )
    team_id = res.scalar_one_or_none()
    if team_id is None:
        raise HTTPException(status_code=400, detail=f"Unknown accountable team: {normalized}")
    return team_id


async def _resolve_operator_id(db: AsyncSession, value: Any) -> Optional[int]:
    normalized = normalize_scalar(value)
    if normalized is None:
        return None
    try:
        operator_identifier = _parse_int_like(normalized)
    except ValueError:
        operator_identifier = None
    if operator_identifier is not None:
        operator = await db.get(models.Operator, operator_identifier)
        if operator:
            return operator.id
    res = await db.execute(
        select(models.Operator.id).where(
            or_(
                func.lower(models.Operator.username) == func.lower(str(normalized)),
                func.lower(models.Operator.external_id) == func.lower(str(normalized)),
                func.lower(models.Operator.full_name) == func.lower(str(normalized)),
            )
        )
    )
    operator_id = res.scalar_one_or_none()
    if operator_id is None:
        raise HTTPException(status_code=400, detail=f"Unknown accountable operator: {normalized}")
    return operator_id


async def serialize_external_example_row(db: AsyncSession, entity: models.ExternalEntity) -> dict[str, Any]:
    ownership_mode = "individual" if entity.internal_operator_id else "team"
    return {
        "name": entity.name or "",
        "external_key": entity.external_key or "",
        "aliases_json": json.dumps(entity.aliases_json or []),
        "type": entity.type or "",
        "subtype": entity.subtype or "",
        "owner_organization": entity.owner_organization or "",
        "owner_team": entity.owner_team or "",
        "ownership_mode": ownership_mode,
        "internal_team_id": entity.internal_team_id if ownership_mode == "team" else "",
        "internal_operator_id": entity.internal_operator_id if ownership_mode == "individual" else "",
        "status": entity.status or "",
        "environment": entity.environment or "",
        "description": entity.description or "",
        "notes": entity.notes or "",
        "business_purpose": entity.business_purpose or "",
        "criticality": entity.criticality or "",
        "dependency_tier": entity.dependency_tier or "",
        "data_classification": entity.data_classification or "",
        "integration_mode": entity.integration_mode or "",
        "primary_endpoint_url": entity.primary_endpoint_url or "",
        "secondary_endpoint_url": entity.secondary_endpoint_url or "",
        "auth_method": entity.auth_method or "",
        "protocol_family": entity.protocol_family or "",
        "port_override": entity.port_override or "",
        "supports_inbound": "true" if entity.supports_inbound else "false",
        "supports_outbound": "true" if entity.supports_outbound else "false",
        "source_system": entity.source_system or "",
        "source_record_id": entity.source_record_id or "",
        "risk_rating": _normalize_external_export_risk_rating(entity.risk_rating),
        "contains_customer_data": "true" if entity.contains_customer_data else "false",
        "contains_credentials": "true" if entity.contains_credentials else "false",
        "stores_pii": "true" if entity.stores_pii else "false",
        "internet_exposed": "true" if entity.internet_exposed else "false",
        "third_party_assessment_status": _normalize_external_export_assessment_status(entity.third_party_assessment_status) or "",
        "contacts_json": json.dumps(entity.contacts_json or []),
        "metadata_json": json.dumps(entity.metadata_json or {}),
    }


async def build_external_import_row(db: AsyncSession, raw_row: dict[str, Any]) -> dict[str, Any]:
    row = {key: normalize_scalar(value) for key, value in raw_row.items()}
    payload: dict[str, Any] = {
        "name": row.get("name"),
        "external_key": row.get("external_key"),
        "aliases_json": _parse_json_value(row.get("aliases_json"), default=[], field_name="aliases_json"),
        "type": row.get("type"),
        "subtype": row.get("subtype"),
        "owner_organization": row.get("owner_organization"),
        "owner_team": row.get("owner_team"),
        "ownership_mode": row.get("ownership_mode") or None,
        "status": row.get("status"),
        "environment": row.get("environment"),
        "description": row.get("description"),
        "notes": row.get("notes"),
        "business_purpose": row.get("business_purpose"),
        "criticality": row.get("criticality") or "Low",
        "dependency_tier": row.get("dependency_tier") or "Tier 3",
        "data_classification": row.get("data_classification"),
        "integration_mode": row.get("integration_mode"),
        "primary_endpoint_url": row.get("primary_endpoint_url"),
        "secondary_endpoint_url": row.get("secondary_endpoint_url"),
        "auth_method": row.get("auth_method"),
        "protocol_family": row.get("protocol_family"),
        "port_override": int(row["port_override"]) if row.get("port_override") is not None else None,
        "supports_inbound": _parse_bool_value(row.get("supports_inbound"), field_name="supports_inbound") if row.get("supports_inbound") is not None else False,
        "supports_outbound": _parse_bool_value(row.get("supports_outbound"), field_name="supports_outbound") if row.get("supports_outbound") is not None else False,
        "source_system": row.get("source_system"),
        "source_record_id": row.get("source_record_id"),
        "risk_rating": row.get("risk_rating") or "Low",
        "contains_customer_data": _parse_bool_value(row.get("contains_customer_data"), field_name="contains_customer_data") if row.get("contains_customer_data") is not None else False,
        "contains_credentials": _parse_bool_value(row.get("contains_credentials"), field_name="contains_credentials") if row.get("contains_credentials") is not None else False,
        "stores_pii": _parse_bool_value(row.get("stores_pii"), field_name="stores_pii") if row.get("stores_pii") is not None else False,
        "internet_exposed": _parse_bool_value(row.get("internet_exposed"), field_name="internet_exposed") if row.get("internet_exposed") is not None else False,
        "third_party_assessment_status": row.get("third_party_assessment_status"),
        "contacts_json": _parse_json_value(row.get("contacts_json"), default=[], field_name="contacts_json"),
        "metadata_json": _parse_json_value(row.get("metadata_json"), default={}, field_name="metadata_json"),
    }

    team_id = await _resolve_team_id(db, row.get("internal_team_id"))
    operator_id = await _resolve_operator_id(db, row.get("internal_operator_id"))
    if payload["ownership_mode"] is None:
        payload["ownership_mode"] = "individual" if operator_id is not None else "team"
    if payload["ownership_mode"] == "team" and team_id is None:
        raise HTTPException(status_code=400, detail="internal_team_id is required when ownership_mode is team")
    if payload["ownership_mode"] == "individual" and operator_id is None:
        raise HTTPException(status_code=400, detail="internal_operator_id is required when ownership_mode is individual")
    if team_id is not None:
        payload["internal_team_id"] = team_id
    if operator_id is not None:
        payload["internal_operator_id"] = operator_id

    validated = schemas.ExternalEntityCreate.model_validate(payload)
    normalized = validated.model_dump()
    if normalized["ownership_mode"] == "team":
        normalized["internal_operator_id"] = None
    else:
        normalized["internal_team_id"] = None
    return normalized


async def preview_external_rows(db: AsyncSession, rows: list[dict[str, Any]]) -> dict[str, Any]:
    results = []
    seen_fingerprints: set[tuple[Any, ...]] = set()
    for index, raw_row in enumerate(rows):
        errors: list[str] = []
        normalized_row: dict[str, Any] = {}
        try:
            candidate = await build_external_import_row(db, raw_row)
            existing_entity_id = await _find_matching_external_entity_id(db, candidate)
            await _validate_external_import_identity(db, candidate, entity_id=existing_entity_id)
            fingerprint = (
                (candidate.get("name") or "").strip().lower(),
                candidate.get("type"),
                (candidate.get("owner_organization") or "").strip().lower() or None,
            )
            if fingerprint in seen_fingerprints:
                raise HTTPException(status_code=400, detail="Duplicate external entity row in the same import batch.")
            seen_fingerprints.add(fingerprint)
            normalized_row = candidate
        except HTTPException as exc:
            detail = exc.detail
            if isinstance(detail, list):
                errors.extend(str(entry) for entry in detail)
            else:
                errors.append(str(detail))
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            errors.append(str(exc))

        results.append({
            "row": index + 1,
            "source": raw_row,
            "normalized": normalized_row,
            "status": "VALID" if not errors else "INVALID",
            "errors": errors,
        })

    valid = [result for result in results if result["status"] == "VALID"]
    invalid = [result for result in results if result["status"] == "INVALID"]
    return {
        "total_rows": len(results),
        "valid_rows": len(valid),
        "invalid_rows": len(invalid),
        "total_errors": sum(len(result["errors"]) for result in invalid),
        "results": results,
    }


async def _find_matching_external_entity_id(db: AsyncSession, payload: dict[str, Any]) -> Optional[int]:
    external_key = (payload.get("external_key") or "").strip() if payload.get("external_key") else None
    if external_key:
        existing_entity_id = await db.scalar(
            select(models.ExternalEntity.id).where(models.ExternalEntity.external_key == external_key)
        )
        if existing_entity_id is not None:
            return existing_entity_id

    name = (payload.get("name") or "").strip()
    entity_type = (payload.get("type") or "").strip()
    owner_organization = (payload.get("owner_organization") or "").strip().lower() or None
    if not name or not entity_type:
        return None

    query = select(models.ExternalEntity.id).where(
        func.lower(models.ExternalEntity.name) == name.lower(),
        models.ExternalEntity.type == entity_type,
        models.ExternalEntity.is_deleted == False,
    )
    if owner_organization is None:
        query = query.where(or_(models.ExternalEntity.owner_organization == None, models.ExternalEntity.owner_organization == ""))
    else:
        query = query.where(func.lower(models.ExternalEntity.owner_organization) == owner_organization)
    return await db.scalar(query)


async def _validate_external_import_identity(db: AsyncSession, payload: dict[str, Any], entity_id: Optional[int] = None) -> None:
    external_key = (payload.get("external_key") or "").strip() if payload.get("external_key") else None
    if external_key:
        key_query = select(models.ExternalEntity.id).where(models.ExternalEntity.external_key == external_key)
        if entity_id is not None:
            key_query = key_query.where(models.ExternalEntity.id != entity_id)
        if await db.scalar(key_query):
            raise HTTPException(status_code=409, detail="External key already exists")

    name = (payload.get("name") or "").strip()
    entity_type = (payload.get("type") or "").strip()
    owner_organization = (payload.get("owner_organization") or "").strip().lower() or None
    if not name or not entity_type:
        return
    query = select(models.ExternalEntity.id).where(
        func.lower(models.ExternalEntity.name) == name.lower(),
        models.ExternalEntity.type == entity_type,
        models.ExternalEntity.is_deleted == False,
    )
    if owner_organization is None:
        query = query.where(or_(models.ExternalEntity.owner_organization == None, models.ExternalEntity.owner_organization == ""))
    else:
        query = query.where(func.lower(models.ExternalEntity.owner_organization) == owner_organization)
    if entity_id is not None:
        query = query.where(models.ExternalEntity.id != entity_id)
    if await db.scalar(query):
        raise HTTPException(status_code=409, detail="An active external entity with the same name, type, and owner organization already exists")


async def execute_external_rows(db: AsyncSession, rows: list[dict[str, Any]], user_id: Optional[str]) -> dict[str, Any]:
    preview = await preview_external_rows(db, rows)
    invalid = [result for result in preview["results"] if result["status"] == "INVALID"]
    if invalid:
        return {"status": "failed", "errors": [f"Row {result['row']}: {', '.join(result['errors'])}" for result in invalid], "count": 0}

    count = 0
    for raw_row in rows:
        candidate = await build_external_import_row(db, raw_row)
        await _validate_external_import_identity(db, candidate)
        if user_id:
            candidate["created_by_user_id"] = user_id
        db.add(models.ExternalEntity(**filter_valid_columns(models.ExternalEntity, candidate)))
        count += 1

    await db.commit()
    if user_id:
        db.add(models.AuditLog(
            user_id=user_id,
            action="BULK_IMPORT",
            target_table=models.ExternalEntity.__tablename__.upper(),
            target_id="MULTIPLE",
            description=f"Bulk imported {count} records into external_entities.",
        ))
        await db.commit()
    return {"status": "success", "count": count}


async def build_network_schema_context(db: AsyncSession) -> dict[str, Any]:
    devices = await db.execute(
        select(models.Device.id, models.Device.name, models.Device.asset_tag)
        .where(models.Device.is_deleted == False)
        .order_by(models.Device.name)
    )
    link_types = await fetch_setting_options(db, "LinkPurpose")
    farms = await fetch_setting_options(db, "NetworkFarm")
    cable_types = await fetch_setting_options(db, "NetworkCableType")
    device_options = [
        {
            "value": str(device_id),
            "label": f"{name} ({asset_tag})" if asset_tag else name,
            "description": asset_tag or "",
        }
        for device_id, name, asset_tag in devices.all()
        if device_id and name
    ]
    return {
        "options": {
            "source_device_id": device_options,
            "target_device_id": device_options,
            "link_type": link_types,
            "farm": farms,
            "cable_type": cable_types,
            "status": [{"value": value, "label": value} for value in schemas.NETWORK_CONNECTION_STATUSES],
            "direction": [{"value": value, "label": value} for value in schemas.NETWORK_CONNECTION_DIRECTIONS],
            "unit": [{"value": value, "label": value} for value in schemas.NETWORK_CONNECTION_UNITS],
        },
        "example_records": device_options[:12],
    }


def _normalize_network_import_text(value: Any) -> Optional[str]:
    normalized = normalize_scalar(value)
    if normalized is None:
        return None
    cleaned = str(normalized).strip()
    return cleaned or None


def _parse_int_like(value: Any) -> Optional[int]:
    normalized = normalize_scalar(value)
    if normalized is None:
        return None
    if isinstance(normalized, bool):
        raise ValueError("must be an integer")
    if isinstance(normalized, int):
        return normalized
    if isinstance(normalized, float):
        if normalized.is_integer():
            return int(normalized)
        raise ValueError("must be an integer")
    text = str(normalized).strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        number = float(text)
        if number.is_integer():
            return int(number)
        raise ValueError("must be an integer")


async def _resolve_network_device_id(db: AsyncSession, value: Any, label: str) -> Optional[int]:
    normalized = normalize_scalar(value)
    if normalized is None:
        return None
    try:
        device_id = _parse_int_like(normalized)
    except ValueError:
        device_id = None
    if device_id is not None:
        device = await db.get(models.Device, device_id)
        if device and not device.is_deleted:
            return device.id
    result = await db.execute(
        select(models.Device.id).where(
            models.Device.is_deleted == False,
            or_(
                func.lower(models.Device.name) == func.lower(str(normalized)),
                func.lower(models.Device.asset_tag) == func.lower(str(normalized)),
            ),
        )
    )
    device_id = result.scalar_one_or_none()
    if device_id is None:
        raise HTTPException(status_code=400, detail=f"Unknown {label}: {normalized}")
    return device_id


async def _validate_network_import_enums(db: AsyncSession, payload: dict[str, Any]) -> None:
    link_type = payload.get("link_type")
    farm = payload.get("farm")
    cable_type = payload.get("cable_type")
    direction = payload.get("direction")
    status = payload.get("status")

    allowed_link_types = await fetch_setting_options(db, "LinkPurpose")
    if allowed_link_types and link_type is not None:
        allowed_values = {str(entry["value"]).strip() for entry in allowed_link_types if entry.get("value")}
        if link_type not in allowed_values:
            raise HTTPException(status_code=400, detail=f"Invalid link type '{link_type}'")

    allowed_farms = await fetch_setting_options(db, "NetworkFarm")
    if allowed_farms and farm is not None:
        allowed_values = {str(entry["value"]).strip() for entry in allowed_farms if entry.get("value")}
        if farm not in allowed_values:
            raise HTTPException(status_code=400, detail=f"Invalid farm '{farm}'")

    allowed_cables = await fetch_setting_options(db, "NetworkCableType")
    if allowed_cables and cable_type is not None:
        allowed_values = {str(entry["value"]).strip() for entry in allowed_cables if entry.get("value")}
        if cable_type not in allowed_values:
            raise HTTPException(status_code=400, detail=f"Invalid cable type '{cable_type}'")

    if direction is not None and direction not in schemas.NETWORK_CONNECTION_DIRECTIONS:
        raise HTTPException(status_code=400, detail=f"Invalid direction '{direction}'")

    if status is not None and status not in schemas.NETWORK_CONNECTION_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{status}'")


async def _validate_network_import_identity(db: AsyncSession, payload: dict[str, Any]) -> None:
    source_device_id = payload.get("source_device_id")
    target_device_id = payload.get("target_device_id")
    source_port = payload.get("source_port")
    target_port = payload.get("target_port")
    if None in {source_device_id, target_device_id, source_port, target_port}:
        return
    if source_device_id == target_device_id:
        raise HTTPException(status_code=400, detail="Source and peer assets must be different")

    dup_query = select(models.PortConnection.id).filter(
        or_(
            and_(models.PortConnection.source_device_id == source_device_id, models.PortConnection.source_port == source_port),
            and_(models.PortConnection.target_device_id == source_device_id, models.PortConnection.target_port == source_port),
            and_(models.PortConnection.source_device_id == target_device_id, models.PortConnection.source_port == target_port),
            and_(models.PortConnection.target_device_id == target_device_id, models.PortConnection.target_port == target_port),
        )
    )
    if await db.scalar(dup_query):
        raise HTTPException(status_code=400, detail="One of the selected ports is already physically cross-connected")


async def build_network_import_row(db: AsyncSession, raw_row: dict[str, Any]) -> dict[str, Any]:
    row = {key: normalize_scalar(value) for key, value in raw_row.items()}
    payload: dict[str, Any] = {
        "source_device_id": await _resolve_network_device_id(db, row.get("source_device_id") or row.get("source_device_name") or row.get("src_node"), "Source Device"),
        "source_port": _normalize_network_import_text(row.get("source_port") or row.get("src_port")),
        "source_ip": _normalize_network_import_text(row.get("source_ip") or row.get("src_ip")),
        "source_mac": _normalize_network_import_text(row.get("source_mac")),
        "source_vlan": _parse_int_like(row.get("source_vlan")),
        "target_device_id": await _resolve_network_device_id(db, row.get("target_device_id") or row.get("target_device_name") or row.get("peer_node") or row.get("dst_node"), "Peer Device"),
        "target_port": _normalize_network_import_text(row.get("target_port") or row.get("peer_port") or row.get("dst_port")),
        "target_ip": _normalize_network_import_text(row.get("target_ip") or row.get("peer_ip") or row.get("dst_ip")),
        "target_mac": _normalize_network_import_text(row.get("target_mac")),
        "target_vlan": _parse_int_like(row.get("target_vlan")),
        "link_type": _normalize_network_import_text(row.get("link_type") or row.get("type")),
        "purpose": _normalize_network_import_text(row.get("purpose")),
        "speed_gbps": float(row["speed_gbps"]) if row.get("speed_gbps") is not None else None,
        "unit": _normalize_network_import_text(row.get("unit")) or "Gbps",
        "direction": _normalize_network_import_text(row.get("direction")) or "Bidirectional",
        "cable_type": _normalize_network_import_text(row.get("cable_type")),
        "status": _normalize_network_import_text(row.get("status")) or "Active",
        "farm": _normalize_network_import_text(row.get("farm")),
        "request_link": _normalize_network_import_text(row.get("request_link")),
    }
    if payload["source_vlan"] is not None and (payload["source_vlan"] < 0 or payload["source_vlan"] > 4094):
        raise HTTPException(status_code=400, detail="source_vlan must be between 0 and 4094")
    if payload["target_vlan"] is not None and (payload["target_vlan"] < 0 or payload["target_vlan"] > 4094):
        raise HTTPException(status_code=400, detail="target_vlan must be between 0 and 4094")
    if payload["speed_gbps"] is not None and payload["speed_gbps"] <= 0:
        raise HTTPException(status_code=400, detail="speed_gbps must be greater than 0")

    candidate = schemas.NetworkConnectionCreate.model_validate(payload).model_dump()
    await _validate_network_import_enums(db, candidate)
    await _validate_network_import_identity(db, candidate)
    return candidate


async def preview_network_rows(db: AsyncSession, rows: list[dict[str, Any]]) -> dict[str, Any]:
    results = []
    seen_fingerprints: set[tuple[Any, ...]] = set()
    for index, raw_row in enumerate(rows):
        errors: list[str] = []
        normalized_row: dict[str, Any] = {}
        try:
            candidate = await build_network_import_row(db, raw_row)
            fingerprint = (
                candidate.get("source_device_id"),
                (candidate.get("source_port") or "").strip().lower(),
                candidate.get("target_device_id"),
                (candidate.get("target_port") or "").strip().lower(),
            )
            if fingerprint in seen_fingerprints:
                raise HTTPException(status_code=400, detail="Duplicate network row in the same import batch.")
            seen_fingerprints.add(fingerprint)
            normalized_row = candidate
        except HTTPException as exc:
            detail = exc.detail
            if isinstance(detail, list):
                errors.extend(str(entry) for entry in detail)
            else:
                errors.append(str(detail))
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            errors.append(str(exc))

        results.append({
            "row": index + 1,
            "source": raw_row,
            "normalized": normalized_row,
            "status": "VALID" if not errors else "INVALID",
            "errors": errors,
        })

    valid = [result for result in results if result["status"] == "VALID"]
    invalid = [result for result in results if result["status"] == "INVALID"]
    return {
        "total_rows": len(results),
        "valid_rows": len(valid),
        "invalid_rows": len(invalid),
        "total_errors": sum(len(result["errors"]) for result in invalid),
        "results": results,
    }


async def execute_network_rows(db: AsyncSession, rows: list[dict[str, Any]], user_id: Optional[str]) -> dict[str, Any]:
    preview = await preview_network_rows(db, rows)
    invalid = [result for result in preview["results"] if result["status"] == "INVALID"]
    if invalid:
        return {"status": "failed", "errors": [f"Row {result['row']}: {', '.join(result['errors'])}" for result in invalid], "count": 0}

    count = 0
    for raw_row in rows:
        candidate = await build_network_import_row(db, raw_row)
        if user_id:
            candidate["created_by_user_id"] = user_id
        db.add(models.PortConnection(**filter_valid_columns(models.PortConnection, candidate)))
        count += 1

    await db.commit()
    if user_id:
        db.add(models.AuditLog(
            user_id=user_id,
            action="BULK_IMPORT",
            target_table=models.PortConnection.__tablename__.upper(),
            target_id="MULTIPLE",
            description=f"Bulk imported {count} records into port_connections.",
        ))
        await db.commit()
    return {"status": "success", "count": count}


async def build_monitoring_import_row(db: AsyncSession, raw_row: dict[str, Any]) -> dict[str, Any]:
    row = {key: normalize_scalar(value) for key, value in raw_row.items()}
    next_row: dict[str, Any] = {}

    for field_name in ("category", "status", "title", "platform", "purpose", "impact", "notification_method", "owner_team", "monitoring_url", "severity", "spec", "logic"):
        if field_name in row:
            next_row[field_name] = row.get(field_name)

    for integer_field in ("check_interval", "alert_duration", "notification_throttle"):
        if integer_field in row and row.get(integer_field) is not None:
            next_row[integer_field] = int(row[integer_field])

    if row.get("device_id") is not None:
        next_row["device_id"] = int(row["device_id"])
    elif row.get("device_name"):
        name = row["device_name"]
        result = await db.execute(
            select(models.Device.id)
            .where(
                (func.lower(models.Device.name) == func.lower(name)) |
                (func.lower(models.Device.asset_tag) == func.lower(name))
            )
        )
        device_id = result.scalar_one_or_none()
        if device_id is None:
            raise HTTPException(status_code=400, detail=f"Unknown Target Asset: {name}. Must be an existing asset name or tag.")
        next_row["device_id"] = device_id

    if "notification_recipients" in row:
        next_row["notification_recipients"] = split_multi_value(row.get("notification_recipients"))

    if row.get("owner_user_ids"):
        next_row["owners"] = [
            {
                "external_id": owner_identifier,
                "role": "Primary Support",
            }
            for owner_identifier in split_multi_value(row.get("owner_user_ids"))
        ]

    if row.get("monitored_services") is not None:
        next_row["monitored_services"] = row["monitored_services"]
    elif row.get("monitored_service_names"):
        names = split_multi_value(row.get("monitored_service_names"))
        if names:
            result = await db.execute(
                select(models.LogicalService.id, models.LogicalService.name)
                .where(func.lower(models.LogicalService.name).in_([n.lower() for n in names]))
            )
            found = {name.lower(): service_id for service_id, name in result.all()}
            missing = [name for name in names if name.lower() not in found]
            if missing:
                raise HTTPException(status_code=400, detail=f"Unknown monitored services: {', '.join(missing)}")
            next_row["monitored_services"] = [found[name.lower()] for name in names]

    if row.get("recovery_docs") is not None:
        next_row["recovery_docs"] = row["recovery_docs"]
    elif row.get("recovery_doc_titles"):
        titles = split_multi_value(row.get("recovery_doc_titles"))
        if titles:
            result = await db.execute(
                select(models.KnowledgeEntry.id, models.KnowledgeEntry.title)
                .where(func.lower(models.KnowledgeEntry.title).in_([t.lower() for t in titles]))
            )
            found = {title.lower(): knowledge_id for knowledge_id, title in result.all()}
            missing = [title for title in titles if title.lower() not in found]
            if missing:
                raise HTTPException(status_code=400, detail=f"Unknown recovery documents: {', '.join(missing)}")
            next_row["recovery_docs"] = [found[title.lower()] for title in titles]

    return next_row


async def preview_monitoring_rows(db: AsyncSession, rows: list[dict[str, Any]]) -> dict[str, Any]:
    results = []
    seen_fingerprints: set[tuple[Any, ...]] = set()
    for index, raw_row in enumerate(rows):
        errors: list[str] = []
        normalized_row: dict[str, Any] = {}
        try:
            candidate = await build_monitoring_import_row(db, raw_row)
            clean_data, owners_data = await build_monitoring_payload(db, candidate, partial=False)
            await ensure_monitoring_item_uniqueness(db, item_data=clean_data)
            fingerprint = (
                clean_data.get("device_id"),
                (clean_data.get("title") or "").strip().lower(),
                clean_data.get("category"),
                clean_data.get("platform"),
            )
            if fingerprint in seen_fingerprints:
                raise HTTPException(status_code=400, detail="Duplicate monitoring row in the same import batch.")
            seen_fingerprints.add(fingerprint)
            normalized_row = {**clean_data, "owners": owners_data or []}
        except HTTPException as exc:
            detail = exc.detail
            if isinstance(detail, list):
                errors.extend(str(entry) for entry in detail)
            else:
                errors.append(str(detail))
        except (ValueError, TypeError) as exc:
            errors.append(str(exc))

        results.append({
            "row": index + 1,
            "source": raw_row,
            "normalized": normalized_row,
            "status": "VALID" if not errors else "INVALID",
            "errors": errors,
        })

    valid = [result for result in results if result["status"] == "VALID"]
    invalid = [result for result in results if result["status"] == "INVALID"]
    return {
        "total_rows": len(results),
        "valid_rows": len(valid),
        "invalid_rows": len(invalid),
        "total_errors": sum(len(result["errors"]) for result in invalid),
        "results": results,
    }


async def execute_monitoring_rows(db: AsyncSession, rows: list[dict[str, Any]], user_id: Optional[str]) -> dict[str, Any]:
    preview = await preview_monitoring_rows(db, rows)
    invalid = [result for result in preview["results"] if result["status"] == "INVALID"]
    if invalid:
        return {"status": "failed", "errors": [f"Row {result['row']}: {', '.join(result['errors'])}" for result in invalid], "count": 0}

    count = 0
    for raw_row in rows:
        candidate = await build_monitoring_import_row(db, raw_row)
        item_data, owners_data = await build_monitoring_payload(db, candidate, partial=False)
        await ensure_monitoring_item_uniqueness(db, item_data=item_data)
        if user_id:
            item_data["created_by_user_id"] = user_id
        db_obj = models.MonitoringItem(**item_data)
        db.add(db_obj)
        await db.flush()
        for owner in owners_data or []:
            db.add(models.MonitoringOwner(**owner, monitoring_item_id=db_obj.id))
        count += 1

    await db.commit()

    result = await db.execute(
        select(models.MonitoringItem)
        .options(joinedload(models.MonitoringItem.owners).joinedload(models.MonitoringOwner.operator))
        .order_by(models.MonitoringItem.id.desc())
        .limit(count)
    )
    created_items = list(reversed(result.unique().scalars().all()))
    for item in created_items:
        await save_monitoring_history(
            item.id,
            item.version,
            db,
            summarize_monitoring_snapshot_delta(
                None,
                build_monitoring_snapshot_from_values(
                    {
                        "device_id": item.device_id,
                        "category": item.category,
                        "status": item.status,
                        "title": item.title,
                        "spec": item.spec,
                        "platform": item.platform,
                        "monitoring_url": item.monitoring_url,
                        "purpose": item.purpose,
                        "impact": item.impact,
                        "notification_method": item.notification_method,
                        "notification_recipients": item.notification_recipients,
                        "logic": item.logic,
                        "logic_json": item.logic_json,
                        "monitored_services": item.monitored_services,
                        "owner_team": item.owner_team,
                        "check_interval": item.check_interval,
                        "alert_duration": item.alert_duration,
                        "notification_throttle": item.notification_throttle,
                        "severity": item.severity,
                        "is_active": item.is_active,
                        "is_deleted": item.is_deleted,
                        "recovery_docs": item.recovery_docs,
                    },
                    [
                        {
                            "operator_id": owner.operator_id,
                            "name": owner.name or (owner.operator.full_name if owner.operator else None),
                            "external_id": owner.external_id or (owner.operator.external_id if owner.operator else None),
                            "role": owner.role,
                        }
                        for owner in item.owners
                    ],
                ),
                action_label="create",
            ),
        )
    await db.commit()

    if user_id:
        db.add(models.AuditLog(
            user_id=user_id,
            action="BULK_IMPORT",
            target_table=models.MonitoringItem.__tablename__.upper(),
            target_id="MULTIPLE",
            description=f"Bulk imported {count} records into monitoring_items.",
        ))
        await db.commit()

    return {"status": "success", "count": count}


def build_far_import_fields() -> list[ImportField]:
    return [
        ImportField("system_name", "System", required=True, template_hint="[Logical system]", validation_rules=["Required."]),
        ImportField("failure_type", "Failure Type", required=True, template_hint="[Design|Process|Hardware|Software|Network|Human|Environment]", validation_rules=["Required."]),
        ImportField("title", "Failure Mode", required=True, template_hint="[Short failure-mode title]", validation_rules=["Required."]),
        ImportField("effect", "Effect", input_kind="multiline", input_control="textarea", template_hint="[Operational effect]"),
        ImportField("severity", "Severity", required=True, input_control="number", template_hint="[1-10]", validation_rules=["Integer from 1 to 10."]),
        ImportField("occurrence", "Occurrence", required=True, input_control="number", template_hint="[1-10]", validation_rules=["Integer from 1 to 10."]),
        ImportField("detection", "Detection", required=True, input_control="number", template_hint="[1-10]", validation_rules=["Integer from 1 to 10."]),
        ImportField("status", "Status", template_hint="[Analyzing]"),
    ]


FAR_IMPORT_FIELDS = build_far_import_fields()


def _coerce_far_import_score(value: Any, label: str) -> int:
    normalized = normalize_scalar(value)
    if normalized is None:
        raise ValueError(f"{label} is required")
    if isinstance(normalized, bool):
        raise ValueError(f"{label} must be an integer from 1 to 10")
    number = float(normalized)
    if not number.is_integer() or number < 1 or number > 10:
        raise ValueError(f"{label} must be an integer from 1 to 10")
    return int(number)


def build_far_import_row(raw_row: dict[str, Any]) -> dict[str, Any]:
    system_name = normalize_scalar(raw_row.get("system_name"))
    failure_type = normalize_scalar(raw_row.get("failure_type"))
    title = normalize_scalar(raw_row.get("title"))
    if not system_name:
        raise ValueError("system_name is required")
    if not failure_type:
        raise ValueError("failure_type is required")
    if not title:
        raise ValueError("title is required")

    severity = _coerce_far_import_score(raw_row.get("severity"), "severity")
    occurrence = _coerce_far_import_score(raw_row.get("occurrence"), "occurrence")
    detection = _coerce_far_import_score(raw_row.get("detection"), "detection")
    effect = normalize_scalar(raw_row.get("effect"))
    return {
        "system_name": str(system_name),
        "failure_type": str(failure_type),
        "title": str(title),
        "effect": str(effect) if effect is not None else None,
        "severity": severity,
        "occurrence": occurrence,
        "detection": detection,
        "rpn": severity * occurrence * detection,
        "status": str(normalize_scalar(raw_row.get("status")) or "Analyzing"),
    }


async def preview_far_rows(db: AsyncSession, rows: list[dict[str, Any]]) -> dict[str, Any]:
    results = []
    for index, raw_row in enumerate(rows):
        errors: list[str] = []
        normalized_row: dict[str, Any] = {}
        try:
            normalized_row = build_far_import_row(raw_row)
        except (ValueError, TypeError) as exc:
            errors.append(str(exc))
        results.append({
            "row": index + 1,
            "source": raw_row,
            "normalized": normalized_row,
            "status": "VALID" if not errors else "INVALID",
            "errors": errors,
        })
    valid = [result for result in results if result["status"] == "VALID"]
    invalid = [result for result in results if result["status"] == "INVALID"]
    return {
        "total_rows": len(results),
        "valid_rows": len(valid),
        "invalid_rows": len(invalid),
        "total_errors": sum(len(result["errors"]) for result in invalid),
        "results": results,
    }


async def execute_far_rows(db: AsyncSession, rows: list[dict[str, Any]], user_id: Optional[str]) -> dict[str, Any]:
    preview = await preview_far_rows(db, rows)
    invalid = [result for result in preview["results"] if result["status"] == "INVALID"]
    if invalid:
        return {"status": "failed", "errors": [f"Row {result['row']}: {', '.join(result['errors'])}" for result in invalid], "count": 0}

    for result in preview["results"]:
        payload = dict(result["normalized"])
        if user_id:
            payload["created_by_user_id"] = user_id
        mode = models.FarFailureMode(
            **payload,
            version=1,
            affected_assets=[],
            causes=[],
        )
        db.add(mode)
        await db.flush()
        await save_far_history(mode.id, mode.version, db, "Bulk import creation")
    await db.commit()
    count = len(preview["results"])
    if user_id:
        db.add(models.AuditLog(
            user_id=user_id,
            action="BULK_IMPORT",
            target_table=models.FarFailureMode.__tablename__.upper(),
            target_id="MULTIPLE",
            description=f"Bulk imported {count} records into {models.FarFailureMode.__tablename__}.",
        ))
        await db.commit()
    return {"status": "success", "count": count}


async def serialize_far_example_row(db: AsyncSession, item: models.FarFailureMode) -> dict[str, Any]:
    return {
        "system_name": item.system_name or "",
        "failure_type": item.failure_type or "Design",
        "title": item.title or "",
        "effect": item.effect or "",
        "severity": item.severity if item.severity is not None else 1,
        "occurrence": item.occurrence if item.occurrence is not None else 1,
        "detection": item.detection if item.detection is not None else 1,
        "status": item.status or "Analyzing",
    }


def profile_fields_to_payload(fields: list[ImportField], context: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    options_map = (context or {}).get("options", {})
    return [
        {
            "name": field.name,
            "label": field.label,
            "required": field.required,
            "description": field.description,
            "input_kind": field.input_kind,
            "input_control": field.input_control,
            "template_hint": field.template_hint,
            "aliases": field.aliases,
            "accepts_multiple": field.accepts_multiple,
            "supported_in_builder": field.supported_in_builder,
            "unsupported_reason": field.unsupported_reason,
            "validation_rules": field.validation_rules,
            "options": options_map.get(field.options_key or "", []),
        }
        for field in fields
    ]


GENERIC_MODEL_MAPPING = {
    "devices": models.Device,
    "racks": models.Rack,
    "logical_services": models.LogicalService,
}


def build_import_profiles() -> dict[str, ImportProfile]:
    profiles: dict[str, ImportProfile] = {
        "monitoring_items": ImportProfile(
            key="monitoring_items",
            display_name="Monitoring",
            model=models.MonitoringItem,
            fields=MONITORING_IMPORT_FIELDS,
            preview_rows=preview_monitoring_rows,
            execute_rows=execute_monitoring_rows,
            schema_context=build_monitoring_schema_context,
            serialize_example_row=serialize_monitoring_example_row,
        ),
        "external_entities": ImportProfile(
            key="external_entities",
            display_name="External Registry",
            model=models.ExternalEntity,
            fields=EXTERNAL_IMPORT_FIELDS,
            preview_rows=preview_external_rows,
            execute_rows=execute_external_rows,
            schema_context=build_external_schema_context,
            serialize_example_row=serialize_external_example_row,
        ),
        "far_records": ImportProfile(
            key="far_records",
            display_name="Failure Modes & Risk Matrix",
            model=models.FarFailureMode,
            fields=FAR_IMPORT_FIELDS,
            preview_rows=preview_far_rows,
            execute_rows=execute_far_rows,
            serialize_example_row=serialize_far_example_row,
        ),
        "port_connections": ImportProfile(
            key="port_connections",
            display_name="Network Connections",
            model=models.PortConnection,
            fields=NETWORK_IMPORT_FIELDS,
            preview_rows=preview_network_rows,
            execute_rows=execute_network_rows,
            schema_context=build_network_schema_context,
        )
    }

    for key, model in GENERIC_MODEL_MAPPING.items():
        profiles[key] = ImportProfile(
            key=key,
            display_name=model.__tablename__.replace("_", " ").title(),
            model=model,
            fields=generic_fields_for_model(model),
            preview_rows=lambda db, rows, current_model=model: preview_generic_rows(db, current_model, rows),
            execute_rows=lambda db, rows, user_id, current_model=model: execute_generic_rows(db, current_model, rows, user_id),
        )
    return profiles


IMPORT_PROFILES = build_import_profiles()

IMPORT_PROFILE_MODULES = {
    "monitoring_items": "monitoring",
    "external_entities": "external",
    "far_records": "far",
    "port_connections": "network",
    "devices": "assets",
    "racks": "racks",
    "logical_services": "services",
}


async def enforce_import_profile_access(profile: ImportProfile, request: Request, db: AsyncSession) -> None:
    module_id = IMPORT_PROFILE_MODULES.get(profile.key)
    if module_id:
        await ensure_module_access(module_id, request, db)


def get_import_profile(table_name: str) -> ImportProfile:
    profile = IMPORT_PROFILES.get(table_name)
    if not profile:
        raise HTTPException(status_code=404, detail="Import profile not found")
    return profile


def resolve_template_fields(profile: ImportProfile, requested_columns: Optional[str]) -> list[ImportField]:
    field_map = {field.name: field for field in profile.fields}
    required_names = [field.name for field in profile.fields if field.required]
    if not requested_columns:
        ordered_names = [field.name for field in profile.fields]
    else:
        requested_names = [column.strip() for column in requested_columns.split(",") if column.strip()]
        ordered_names = []
        for name in required_names + requested_names:
            if name in field_map and name not in ordered_names:
                ordered_names.append(name)
    return [field_map[name] for name in ordered_names]


def build_round_trip_download_headers(profile: ImportProfile, filename: str) -> dict[str, str]:
    headers = {
        "Content-Disposition": f"attachment; filename={filename}",
    }
    if profile.key == "monitoring_items":
        headers["X-SysGrid-Schema-Version"] = MONITORING_IMPORT_SCHEMA_VERSION
        headers["X-SysGrid-Import-Profile"] = profile.key
    elif profile.key == "external_entities":
        headers["X-SysGrid-Schema-Version"] = EXTERNAL_IMPORT_SCHEMA_VERSION
        headers["X-SysGrid-Import-Profile"] = profile.key
    elif profile.key == "far_records":
        headers["X-SysGrid-Schema-Version"] = FAR_IMPORT_SCHEMA_VERSION
        headers["X-SysGrid-Import-Profile"] = profile.key
    return headers


def build_snapshot_export_token() -> str:
    return datetime.now().strftime("%Y-%m-%d_%H-%M-%S")


def validate_snapshot_export_token(export_token: Optional[str]) -> Optional[str]:
    if export_token is None:
        return None
    if not EXTERNAL_SNAPSHOT_EXPORT_TOKEN_PATTERN.fullmatch(export_token):
        raise HTTPException(status_code=400, detail="Invalid export token")
    return export_token


def build_snapshot_filename(profile: ImportProfile, export_token: Optional[str] = None) -> str:
    if profile.key == "external_entities":
        timestamp = validate_snapshot_export_token(export_token) or build_snapshot_export_token()
        return f"SysGrid_External_{timestamp}.csv"
    return f"SYSGRID_{profile.key}_Snapshot.csv"


def build_snapshot_manifest(profile: ImportProfile, export_token: Optional[str] = None) -> dict[str, Any]:
    filename = build_snapshot_filename(profile, export_token=export_token)
    manifest: dict[str, Any] = {
        "profile": profile.key,
        "filename": filename,
        "download_url": f"/api/v1/import/snapshot/{profile.key}",
        "content_type": "text/csv",
    }
    if profile.key == "monitoring_items":
        manifest["schema_version"] = MONITORING_IMPORT_SCHEMA_VERSION
    elif profile.key == "external_entities":
        token = validate_snapshot_export_token(export_token) or filename.removeprefix("SysGrid_External_").removesuffix(".csv")
        manifest["schema_version"] = EXTERNAL_IMPORT_SCHEMA_VERSION
        manifest["scope"] = "active"
        manifest["export_token"] = token
        manifest["download_url"] = f"/api/v1/import/snapshot/{profile.key}?export_token={token}"
    elif profile.key == "port_connections":
        manifest["schema_version"] = NETWORK_IMPORT_SCHEMA_VERSION
    elif profile.key == "far_records":
        manifest["schema_version"] = FAR_IMPORT_SCHEMA_VERSION
    else:
        manifest["schema_version"] = None
    return manifest


@router.get("/schema/{table_name}")
async def get_import_schema(table_name: str, request: Request, db: AsyncSession = Depends(get_db)):
    profile = get_import_profile(table_name)
    await enforce_import_profile_access(profile, request, db)
    context = await profile.schema_context(db) if profile.schema_context else {}
    headers = {}
    if profile.key == "monitoring_items":
        headers["schema_version"] = MONITORING_IMPORT_SCHEMA_VERSION
    elif profile.key == "external_entities":
        headers["schema_version"] = EXTERNAL_IMPORT_SCHEMA_VERSION
    elif profile.key == "port_connections":
        headers["schema_version"] = NETWORK_IMPORT_SCHEMA_VERSION
    elif profile.key == "far_records":
        headers["schema_version"] = FAR_IMPORT_SCHEMA_VERSION
    return {
        "table_name": profile.key,
        "display_name": profile.display_name,
        "fields": profile_fields_to_payload(profile.fields, context),
        "required_fields": [field.name for field in profile.fields if field.required],
        "example_records": context.get("example_records", []),
        "schema_version": headers.get("schema_version"),
    }


@router.get("/template/{table_name}")
async def download_template(
    table_name: str,
    request: Request,
    columns: Optional[str] = None,
    mode: str = "hints",
    example_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
):
    profile = get_import_profile(table_name)
    await enforce_import_profile_access(profile, request, db)
    fields = resolve_template_fields(profile, columns)
    df = pd.DataFrame(columns=[field.name for field in fields])

    if fields and mode in {"hints", "example"}:
        df.loc[0] = {field.name: field.template_hint or "[STRING]" for field in fields}
    if fields and mode == "example" and profile.serialize_example_row:
        example_row = None
        if example_id is not None:
            if profile.key == "monitoring_items":
                result = await db.execute(
                    select(profile.model)
                    .options(joinedload(models.MonitoringItem.owners).joinedload(models.MonitoringOwner.operator))
                    .where(profile.model.id == example_id)
                )
                example_row = result.unique().scalar_one_or_none()
            else:
                example_row = await db.get(profile.model, example_id)
        if example_row is None:
            query = select(profile.model).order_by(profile.model.updated_at.desc(), profile.model.id.desc()).limit(1)
            if profile.key == "monitoring_items":
                query = query.options(
                    joinedload(models.MonitoringItem.owners).joinedload(models.MonitoringOwner.operator)
                )
            result = await db.execute(query)
            example_row = result.unique().scalar_one_or_none()
        if example_row is not None:
            serialized_example = await profile.serialize_example_row(db, example_row)
            df.loc[len(df)] = {field.name: serialized_example.get(field.name, "") for field in fields}

    stream = io.BytesIO()
    df.to_csv(stream, index=False)
    stream.seek(0)
    headers = build_round_trip_download_headers(profile, f"SYSGRID_{table_name}_Template.csv")
    return StreamingResponse(
        stream,
        media_type="text/csv",
        headers=headers
    )


@router.get("/snapshot/{table_name}")
async def download_snapshot(table_name: str, request: Request, export_token: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    profile = get_import_profile(table_name)
    await enforce_import_profile_access(profile, request, db)
    export_contract = build_snapshot_manifest(profile, export_token=export_token if profile.key == "external_entities" else None)
    model = profile.model
    if profile.serialize_example_row:
        fields = [field for field in profile.fields]
        columns = [field.name for field in fields]
        query = select(model).order_by(model.updated_at.desc(), model.id.desc())
        if profile.key == "monitoring_items":
            query = query.options(
                joinedload(models.MonitoringItem.owners).joinedload(models.MonitoringOwner.operator)
            )
        if hasattr(model, "is_deleted"):
            query = query.where(model.is_deleted == False)
        result = await db.execute(query)
        records = result.unique().scalars().all()
        data = []
        for record in records:
            serialized = await profile.serialize_example_row(db, record)
            data.append({column: serialized.get(column, "") for column in columns})
        df = pd.DataFrame(data, columns=columns)
    else:
        mapper = inspect(model)
        exclude = {"id", "created_at", "updated_at", "created_by_user_id"}
        cols = [column.name for column in mapper.columns if column.name not in exclude]

        query = select(model)
        if hasattr(model, "is_deleted"):
            query = query.where(model.is_deleted == False)

        result = await db.execute(query)
        records = result.scalars().all()
        data = []
        for record in records:
            row = {}
            for column in cols:
                row[column] = stringify_json(getattr(record, column))
            data.append(row)
        df = pd.DataFrame(data, columns=cols)

    stream = io.BytesIO()
    df.to_csv(stream, index=False)
    stream.seek(0)
    headers = build_round_trip_download_headers(profile, export_contract["filename"])
    return StreamingResponse(
        stream,
        media_type="text/csv",
        headers=headers
    )


@router.get("/snapshot/{table_name}/manifest")
async def get_snapshot_manifest(table_name: str, request: Request, db: AsyncSession = Depends(get_db)):
    profile = get_import_profile(table_name)
    await enforce_import_profile_access(profile, request, db)
    if profile.key not in {"external_entities", "far_records"}:
        raise HTTPException(status_code=404, detail="Snapshot manifest not found")
    return build_snapshot_manifest(profile)


@router.post("/preview-file")
async def preview_import_file(request: Request, table_name: str = Form(...), file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    profile = get_import_profile(table_name)
    await enforce_import_profile_access(profile, request, db)
    content = await file.read()
    try:
        df = load_dataframe_from_upload(file, content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    preview = await profile.preview_rows(db, rows_from_dataframe(df))
    return {"table_name": table_name, **preview}


@router.post("/preview-rows")
async def preview_import_rows(
    table_name: str,
    request: Request,
    payload: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    profile = get_import_profile(table_name)
    await enforce_import_profile_access(profile, request, db)
    rows = payload.get("rows")
    if not isinstance(rows, list):
        raise HTTPException(status_code=400, detail="rows must be a list")
    preview = await profile.preview_rows(db, rows)
    return {"table_name": table_name, **preview}


@router.post("/audit")
async def audit_import(request: Request, table_name: str, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    return await preview_import_file(request=request, table_name=table_name, file=file, db=db)


@router.post("/execute")
async def execute_import(
    table_name: str,
    request: Request,
    body: Any = Body(...),
    db: AsyncSession = Depends(get_db),
):
    profile = get_import_profile(table_name)
    await enforce_import_profile_access(profile, request, db)
    if isinstance(body, dict):
        rows = body.get("rows")
    else:
        rows = body
    if not isinstance(rows, list):
        raise HTTPException(status_code=400, detail="rows must be a list")

    user_id = get_current_user_id(request)
    return await profile.execute_rows(db, rows, user_id)
