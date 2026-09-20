from pydantic import BaseModel, ConfigDict, Field, AliasChoices, field_validator, model_validator
from typing import List, Optional, Any, Dict, Literal
from datetime import datetime
from urllib.parse import urlparse
from ipaddress import ip_address
from math import isfinite
import re

class BaseSchema(BaseModel):
    id: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by_user_id: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True)

class SiteBase(BaseModel):
    name: str
    address: Optional[str] = ""
    facility_manager: Optional[str] = None
    contact_phone: Optional[str] = None
    cooling_capacity_kw: Optional[float] = 0.0
    power_capacity_kw: Optional[float] = 0.0
    color: Optional[str] = "#3b82f6"

class SiteCreate(SiteBase): pass
class SiteResponse(SiteBase, BaseSchema): pass

class RackBase(BaseModel):
    room_id: Optional[int] = None
    name: str
    aisle: Optional[str] = None
    row: Optional[str] = None
    total_u_height: int = 42
    max_power_kw: float = 8.0
    max_weight_kg: float = 1000.0
    cooling_type: Optional[str] = "Air"
    pdu_a_id: Optional[str] = None
    pdu_b_id: Optional[str] = None
    pdu_a_name: Optional[str] = "PDU-A"
    pdu_b_name: Optional[str] = "PDU-B"
    pdu_a_cap_kw: Optional[float] = 10.0
    pdu_b_cap_kw: Optional[float] = 10.0

class RackCreate(RackBase):
    site_id: Optional[int] = None

class DeviceTinyResponse(BaseSchema):
    name: str
    system: Optional[str] = None
    type: Optional[str] = None
    status: Optional[str] = None
    primary_ip: Optional[str] = None

class RackResponse(RackBase, BaseSchema):
    site_name: Optional[str] = None
    site_id: Optional[int] = None
    site_color: Optional[str] = None
    devices: List[DeviceTinyResponse] = []

class DeviceBase(BaseModel):
    name: str
    system: Optional[str] = None
    environment: Optional[str] = "Production"
    status: Optional[str] = "Active"
    type: Optional[str] = "Physical"
    
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial_number: str
    asset_tag: str
    part_number: Optional[str] = None
    
    os_name: Optional[str] = None
    os_version: Optional[str] = None
    management_ip: Optional[str] = None
    primary_ip: Optional[str] = None
    management_url: Optional[str] = None
    
    owner: Optional[str] = None
    business_unit: Optional[str] = None
    vendor: Optional[str] = None
    purchase_order: Optional[str] = None
    cost_center: Optional[str] = None
    role: Optional[str] = None
    
    purchase_date: Optional[str] = None
    install_date: Optional[str] = None
    warranty_end: Optional[str] = None
    eol_date: Optional[str] = None
    
    power_supply_count: Optional[int] = 2
    power_max_w: Optional[float] = 0.0
    power_typical_w: Optional[float] = 0.0
    btu_hr: Optional[float] = 0.0
    depth: Optional[str] = "Full" # Full, Half
    
    tool_group: Optional[str] = None
    fab_area: Optional[str] = None
    recipe_critical: Optional[bool] = False
    
    metadata_json: Optional[Dict[str, Any]] = None
    is_reservation: Optional[bool] = False
    reservation_info: Optional[Dict[str, Any]] = None
    logic_json: Optional[List[Dict[str, Any]]] = []

class DeviceCreate(DeviceBase): pass

class DeviceResponse(DeviceBase, BaseSchema):
    relationships: List[Any] = []
    rack_name: Optional[str] = None
    site_name: Optional[str] = None
    u_size: Optional[int] = None
    u_start: Optional[int] = None
    mount_orientation: Optional[str] = "Front"
    mount_depth: Optional[str] = "Full"
    
    # Enriched Fields
    hardware_summary: Optional[str] = "No Components"
    hardware_age: Optional[str] = "N/A"
    open_incident_count: Optional[int] = 0

class MaintenanceWindowBase(BaseModel):
    title: str
    start_time: str
    end_time: str
    ticket_number: Optional[str] = None
    coordinator: Optional[str] = None
    status: str = "Scheduled"

class MaintenanceWindowCreate(MaintenanceWindowBase): pass
class MaintenanceWindowResponse(MaintenanceWindowBase, BaseSchema): pass

class MonitoringOwnerBase(BaseModel):
    operator_id: int
    name: Optional[str] = None
    external_id: Optional[str] = None
    role: str

class MonitoringOwnerCreate(MonitoringOwnerBase): pass
class MonitoringOwnerResponse(MonitoringOwnerBase, BaseSchema):
    operator_id: Optional[int] = None

class MonitoringLogicEntry(BaseModel):
    id: int
    type: Literal["Threshold", "Regex", "Query", "Health Check", "Log Pattern", "Synthetic", "Custom"]
    description: str = ""
    logic_info: str = ""

    @field_validator("description", "logic_info")
    @classmethod
    def strip_logic_text(cls, value: str) -> str:
        return value.strip()

class MonitoringRecoveryDoc(BaseModel):
    id: int
    note: Optional[str] = None
    added_at: Optional[datetime] = None

class MonitoringRecoveryDocResponse(BaseModel):
    id: int
    title: str
    note: Optional[str] = None
    added_at: Optional[datetime] = None

class MonitoringItemBase(BaseModel):
    device_id: Optional[int] = None
    category: str # Hardware, Log, Network, App, Synthetic
    status: str # Existing, Planned, Cancelled, Deleted
    title: str # What's being monitored
    spec: Optional[str] = None # Details/Thresholds
    platform: Optional[str] = None # Zabbix, Prometheus, Datadog, etc.
    monitoring_url: Optional[str] = None # Direct clickable link
    purpose: Optional[str] = None
    impact: Optional[str] = None
    notification_method: Optional[str] = None # Email, Slack, PagerDuty
    notification_recipients: Optional[List[str]] = Field(default_factory=list)
    logic: Optional[str] = None # For log-based: regex or query
    logic_json: List[MonitoringLogicEntry] = Field(default_factory=list)
    monitored_services: List[int] = Field(default_factory=list)
    owner_team: Optional[str] = None
    
    # New Fields
    check_interval: Optional[int] = 60
    alert_duration: Optional[int] = 0
    notification_throttle: Optional[int] = 3600
    severity: Optional[str] = "Warning"
    is_active: Optional[bool] = True
    is_deleted: Optional[bool] = False
    recovery_docs: List[MonitoringRecoveryDoc] = Field(default_factory=list)
    version: Optional[int] = 1

    @field_validator("category", "status", "title", "platform", "monitoring_url", "purpose", "impact", "notification_method", "logic", "owner_team", mode="before")
    @classmethod
    def normalize_optional_strings(cls, value: Any) -> Any:
        if value is None:
            return value
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value

    @field_validator("notification_recipients", mode="before")
    @classmethod
    def normalize_recipients(cls, value: Any) -> List[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("notification_recipients must be a list")
        return [str(entry).strip() for entry in value if str(entry).strip()]

    @field_validator("recovery_docs", mode="before")
    @classmethod
    def normalize_recovery_docs(cls, value: Any) -> List[Dict[str, Any]]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("recovery_docs must be a list")
        normalized: List[Dict[str, Any]] = []
        for entry in value:
            if isinstance(entry, dict):
                normalized.append(entry)
            else:
                normalized.append({"id": int(entry)})
        return normalized

    @model_validator(mode="after")
    def ensure_title_present(self):
        if not self.title:
            raise ValueError("title is required")
        return self

class MonitoringItemCreate(MonitoringItemBase):
    owners: List[MonitoringOwnerCreate] = Field(default_factory=list)

    @field_validator("check_interval", "alert_duration", "notification_throttle", mode="before")
    @classmethod
    def validate_monitoring_integer_seconds(cls, value: Any) -> Any:
        invalid_numeric_value = (
            value is None
            or isinstance(value, bool)
            or not isinstance(value, (int, float))
            or (isinstance(value, float) and (not isfinite(value) or not value.is_integer()))
        )
        if invalid_numeric_value:
            raise ValueError("must be a finite integer number of seconds")
        return value

class MonitoringItemResponse(MonitoringItemBase, BaseSchema):
    is_deleted: bool = False
    device_name: Optional[str] = None
    monitored_service_names: List[str] = Field(default_factory=list) # Optional, for UI convenience
    recovery_doc_titles: List[str] = Field(default_factory=list) # For UI convenience
    recovery_doc_details: List[MonitoringRecoveryDocResponse] = Field(default_factory=list)
    owners: List[MonitoringOwnerResponse] = Field(default_factory=list)

class MonitoringHistoryResponse(BaseSchema):
    monitoring_item_id: int
    version: int
    snapshot: Dict[str, Any]
    change_summary: Optional[str] = None
    delta: List[Dict[str, Any]] = Field(default_factory=list)
    changed_fields: List[str] = Field(default_factory=list)
    changed_labels: List[str] = Field(default_factory=list)
    previous_version: Optional[int] = None

class ServiceSecretBase(BaseModel):
    username: Optional[str] = None
    note: Optional[str] = None

class ServiceSecretCreate(ServiceSecretBase):
    service_id: int

class ServiceSecretResponse(ServiceSecretBase, BaseSchema):
    service_id: int
    has_password: bool = False

class LogicalServiceBase(BaseModel):
    device_id: Optional[int] = None
    name: str
    service_type: str
    status: Optional[str] = "Active"
    version: Optional[str] = None
    environment: Optional[str] = "Production"
    config_json: Optional[Dict[str, Any]] = None
    custom_attributes: Optional[Dict[str, Any]] = None
    logic_json: Optional[List[Dict[str, Any]]] = []
    purchase_type: Optional[str] = "One-time"
    license_key: Optional[str] = None
    purchase_date: Optional[str] = None
    expiry_date: Optional[str] = None
    cost: Optional[float] = 0.0
    currency: Optional[str] = "USD"
    manufacturer: Optional[str] = None
    supplier: Optional[str] = None

class LogicalServiceCreate(LogicalServiceBase): pass
class LogicalServiceResponse(LogicalServiceBase, BaseSchema):
    device_name: Optional[str] = None
    is_deleted: bool = False
    secrets: List[ServiceSecretResponse] = []

class IncidentLogBase(BaseModel):
    systems: Optional[List[str]] = []
    impacted_device_ids: Optional[List[int]] = []
    title: str
    severity: Optional[str] = "Major"
    status: Optional[str] = "Investigating"
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    reporter: Optional[str] = None
    initial_symptoms: Optional[str] = None
    impacts: Optional[List[str]] = []
    impact_analysis: Optional[str] = None
    trigger_event: Optional[str] = None
    log_evidence: Optional[str] = None
    mitigation_steps: Optional[str] = None
    root_cause: Optional[str] = None
    resolution_steps: Optional[str] = None
    lessons_learned: Optional[str] = None
    prevention_strategy: Optional[str] = None
    timeline: Optional[List[Any]] = []
    todos: Optional[List[Any]] = []

class IncidentLogCreate(IncidentLogBase): pass
class IncidentLogResponse(IncidentLogBase, BaseSchema):
    device_names: Optional[List[str]] = []

# External Intelligence
SAFE_EXTERNAL_URL_SCHEMES = {"http", "https", "sftp", "ftps", "ssh"}
EXTERNAL_RESERVED_METADATA_KEYS = {
    "business_purpose",
}


def _validate_external_url(value: Optional[str], field_name: str) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    parsed = urlparse(trimmed)
    if parsed.scheme.lower() not in SAFE_EXTERNAL_URL_SCHEMES:
        raise ValueError(f"{field_name} must use a safe supported scheme")
    if parsed.scheme.lower() in {"http", "https", "sftp", "ftps"} and not parsed.netloc:
        raise ValueError(f"{field_name} must include a host")
    if any(token in trimmed.lower() for token in ["<script", "javascript:", "data:text/html", "vbscript:"]):
        raise ValueError(f"{field_name} contains an unsafe value")
    return trimmed


class ExternalContact(BaseModel):
    role: Literal["Primary", "Operational", "Escalation", "Security", "Business"] = "Operational"
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    external_person_id: Optional[str] = None
    is_primary: bool = False
    is_escalation: bool = False

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Contact full name is required")
        return cleaned

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        if "@" not in cleaned or "." not in cleaned.split("@")[-1]:
            raise ValueError("Contact email must be valid")
        return cleaned

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        if not re.fullmatch(r"[\d\+\-\(\) ]{7,24}", cleaned):
            raise ValueError("Contact phone must be a valid phone number")
        return cleaned


class ExternalEntitySecretBase(BaseModel):
    secret_label: str
    secret_type: Literal["SharedSecret", "Token", "KeyPair", "Certificate", "VaultReference"] = "VaultReference"
    username: Optional[str] = None
    vault_provider: Optional[Literal["1Password", "Bitwarden", "HashiCorp Vault", "AWS Secrets Manager", "Azure Key Vault", "Other"]] = None
    vault_path: Optional[str] = None
    note: Optional[str] = None
    credential_status: Literal["Active", "RotationDue", "Disabled"] = "Active"
    rotation_frequency_days: Optional[int] = None
    password_last_rotated_at: Optional[str] = None

    @field_validator("secret_label")
    @classmethod
    def validate_secret_label(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Secret label is required")
        return cleaned

    @field_validator("vault_path")
    @classmethod
    def validate_vault_path(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @model_validator(mode="after")
    def validate_secret_contract(self):
        if self.secret_type == "VaultReference" and not self.vault_path:
            raise ValueError("Vault path is required for vault-referenced credentials")
        return self

class ExternalEntitySecretCreate(ExternalEntitySecretBase):
    external_entity_id: int

class ExternalEntitySecretResponse(BaseSchema):
    external_entity_id: int
    secret_label: Optional[str] = None
    secret_type: Optional[str] = None
    username: Optional[str] = None
    vault_provider: Optional[str] = None
    vault_path: Optional[str] = None
    note: Optional[str] = None
    credential_status: Optional[str] = None
    rotation_frequency_days: Optional[int] = None
    password_last_rotated_at: Optional[str] = None

class ExternalEntityResponse(BaseSchema):
    name: str
    external_key: Optional[str] = None
    aliases_json: List[str] = Field(default_factory=list)
    type: str
    subtype: Optional[str] = None
    owner_organization: Optional[str] = None
    owner_team: Optional[str] = None
    ownership_mode: Optional[str] = None
    internal_team_id: Optional[int] = None
    internal_operator_id: Optional[int] = None
    status: Optional[str] = "Planned"
    environment: Optional[str] = "Production"
    description: Optional[str] = None
    notes: Optional[str] = None
    contacts_json: List[Dict[str, Any]] = Field(default_factory=list)
    business_purpose: Optional[str] = None
    criticality: Optional[str] = "Low"
    dependency_tier: Optional[str] = "Tier 3"
    data_classification: Optional[str] = None
    integration_mode: Optional[str] = None
    primary_endpoint_url: Optional[str] = None
    secondary_endpoint_url: Optional[str] = None
    auth_method: Optional[str] = None
    protocol_family: Optional[str] = None
    port_override: Optional[int] = None
    supports_inbound: bool = False
    supports_outbound: bool = False
    source_system: Optional[str] = None
    source_record_id: Optional[str] = None
    risk_rating: Optional[str] = "Low"
    contains_customer_data: bool = False
    contains_credentials: bool = False
    stores_pii: bool = False
    internet_exposed: bool = False
    third_party_assessment_status: Optional[str] = None
    metadata_json: Dict[str, Any] = Field(default_factory=dict)
    is_deleted: bool = False
    secrets: List[ExternalEntitySecretResponse] = []
    internal_team_name: Optional[str] = None
    internal_operator_name: Optional[str] = None
    internal_operator_external_id: Optional[str] = None

class ExternalEntityBase(BaseModel):
    name: str
    external_key: Optional[str] = None
    aliases_json: List[str] = Field(default_factory=list)
    type: str
    subtype: Optional[str] = None
    owner_organization: Optional[str] = None
    owner_team: Optional[str] = None
    ownership_mode: Literal["team", "individual"] = "team"
    internal_team_id: Optional[int] = None
    internal_operator_id: Optional[int] = None
    status: Optional[str] = "Planned"
    environment: Optional[str] = "Production"
    description: Optional[str] = None
    notes: Optional[str] = None
    contacts_json: List[ExternalContact] = Field(default_factory=list)
    business_purpose: Optional[str] = None
    criticality: Literal["Critical", "High", "Medium", "Low"] = "Low"
    dependency_tier: Literal["Tier 1", "Tier 2", "Tier 3", "Tier 4"] = "Tier 3"
    data_classification: Optional[Literal["Public", "Internal", "Confidential", "Restricted"]] = None
    integration_mode: Optional[Literal["API", "SFTP", "VPN", "Database", "Manual", "Other"]] = None
    primary_endpoint_url: Optional[str] = None
    secondary_endpoint_url: Optional[str] = None
    auth_method: Optional[Literal["OAuth2", "Token", "Basic", "mTLS", "SFTP Key", "VPN", "Manual", "Other"]] = None
    protocol_family: Optional[Literal["HTTP", "HTTPS", "TCP", "UDP", "SFTP", "SSH", "Database", "Other"]] = None
    port_override: Optional[int] = None
    supports_inbound: bool = False
    supports_outbound: bool = False
    source_system: Optional[str] = None
    source_record_id: Optional[str] = None
    risk_rating: Literal["Critical", "High", "Medium", "Low"] = "Low"
    contains_customer_data: bool = False
    contains_credentials: bool = False
    stores_pii: bool = False
    internet_exposed: bool = False
    third_party_assessment_status: Optional[Literal["Required", "In Progress", "Approved", "Rejected", "Not Required"]] = None
    metadata_json: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Name is required")
        return cleaned

    @field_validator("external_key")
    @classmethod
    def validate_external_key(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip().lower()
        if not cleaned:
            return None
        if not re.fullmatch(r"[a-z0-9][a-z0-9._:-]*", cleaned):
            raise ValueError("External key must use lowercase letters, numbers, dot, underscore, colon, or dash")
        return cleaned

    @field_validator("aliases_json")
    @classmethod
    def validate_aliases(cls, value: List[str]) -> List[str]:
        seen = set()
        cleaned: List[str] = []
        for item in value:
            alias = item.strip()
            if alias and alias not in seen:
                seen.add(alias)
                cleaned.append(alias)
        return cleaned

    @field_validator("primary_endpoint_url", "secondary_endpoint_url")
    @classmethod
    def validate_endpoint_urls(cls, value: Optional[str], info):
        return _validate_external_url(value, info.field_name)

    @field_validator("port_override")
    @classmethod
    def validate_port_override(cls, value: Optional[int]) -> Optional[int]:
        if value is None:
            return None
        if value < 1 or value > 65535:
            raise ValueError("Port override must be between 1 and 65535")
        return value

    @field_validator("metadata_json")
    @classmethod
    def validate_metadata_json(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        for key, raw in value.items():
            if key in EXTERNAL_RESERVED_METADATA_KEYS:
                raise ValueError(f"{key} is now a first-class field and cannot remain in metadata")
            if not isinstance(raw, (str, int, float, bool)) and raw is not None:
                raise ValueError("Metadata values must be scalar")
        return value

    @model_validator(mode="after")
    def validate_contract(self):
        if self.external_key is None:
            self.external_key = re.sub(r"[^a-z0-9._:-]+", "-", self.name.lower()).strip("-") or "external-entity"
        if self.ownership_mode == "team":
            if self.internal_team_id is None:
                raise ValueError("Internal accountable team is required")
            if self.internal_operator_id is not None:
                raise ValueError("Individual owner cannot be set when ownership mode is team")
        if self.ownership_mode == "individual":
            if self.internal_operator_id is None:
                raise ValueError("Internal accountable operator is required")
            if self.internal_team_id is not None:
                raise ValueError("Team owner cannot be set when ownership mode is individual")
        if self.source_system and not self.source_record_id:
            raise ValueError("Source record ID is required when source system is set")
        if not self.business_purpose:
            raise ValueError("Business purpose is required")
        if not self.contacts_json:
            raise ValueError("At least one accountable contact is required")
        primary_count = sum(1 for contact in self.contacts_json if contact.is_primary)
        if primary_count > 1:
            raise ValueError("Only one primary contact is allowed")
        return self

class ExternalEntityCreate(ExternalEntityBase): pass
class ExternalEntityUpdate(ExternalEntityBase): pass

class ExternalLinkBase(BaseModel):
    external_entity_id: int
    device_id: int
    service_id: Optional[int] = None
    direction: Literal["Inbound", "Outbound", "Bidirectional"] = "Outbound"
    purpose: str
    protocol: Literal["HTTPS", "HTTP", "TCP", "UDP", "SFTP", "SSH", "Database", "Other"] = "TCP"
    port: Optional[int] = None
    host_or_fqdn: Optional[str] = None
    path_or_resource: Optional[str] = None
    network_zone: Optional[Literal["Internet", "DMZ", "Partner", "Internal", "Restricted"]] = None
    transport_security: Optional[Literal["TLS", "mTLS", "VPN", "None", "Other"]] = None
    link_status: Literal["Active", "Planned", "Disabled"] = "Active"
    credential_reference: Optional[str] = None
    credentials: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("purpose")
    @classmethod
    def validate_purpose(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Purpose is required")
        return cleaned

    @field_validator("port")
    @classmethod
    def validate_port(cls, value: Optional[int]) -> Optional[int]:
        if value is None:
            return None
        if value < 1 or value > 65535:
            raise ValueError("Port must be between 1 and 65535")
        return value

    @field_validator("host_or_fqdn")
    @classmethod
    def validate_host_or_fqdn(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        if any(token in cleaned.lower() for token in ["<script", "javascript:", "data:text/html", "vbscript:"]):
            raise ValueError("Host or FQDN contains an unsafe value")
        return cleaned

    @field_validator("credentials")
    @classmethod
    def validate_credentials(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        for key, raw in value.items():
            if not isinstance(raw, (str, int, float, bool)) and raw is not None:
                raise ValueError("Credential metadata values must be scalar")
        return value

class ExternalLinkCreate(ExternalLinkBase): pass
class ExternalLinkResponse(ExternalLinkBase, BaseSchema):
    external_entity_name: Optional[str] = None
    device_name: Optional[str] = None
    service_name: Optional[str] = None

NETWORK_CONNECTION_DIRECTIONS = ("Bidirectional", "Unidirectional", "Source to Target", "Target to Source")
NETWORK_CONNECTION_UNITS = ("Gbps", "Mbps", "Kbps")
NETWORK_CONNECTION_STATUSES = ("Active", "Maintenance", "Down", "Planned", "Requested", "Standby", "Offline", "Deleted")

class NetworkConnectionBase(BaseModel):
    source_device_id: Optional[int] = Field(default=None, ge=1, validation_alias=AliasChoices("source_device_id", "device_a_id", "src_device_id"))
    source_port: Optional[str] = Field(default=None, validation_alias=AliasChoices("source_port", "port_a", "src_port"))
    source_ip: Optional[str] = None
    source_mac: Optional[str] = None
    source_vlan: Optional[int] = Field(default=None, ge=0, le=4094)
    target_device_id: Optional[int] = Field(default=None, ge=1, validation_alias=AliasChoices("target_device_id", "device_b_id", "dst_device_id"))
    target_port: Optional[str] = Field(default=None, validation_alias=AliasChoices("target_port", "port_b", "dst_port"))
    target_ip: Optional[str] = None
    target_mac: Optional[str] = None
    target_vlan: Optional[int] = Field(default=None, ge=0, le=4094)
    link_type: Optional[str] = None
    purpose: Optional[str] = None
    speed_gbps: Optional[float] = Field(default=None, gt=0)
    unit: Literal["Gbps", "Mbps", "Kbps"] = "Gbps"
    direction: Literal["Bidirectional", "Unidirectional", "Source to Target", "Target to Source"] = "Bidirectional"
    cable_type: Optional[str] = None
    status: Literal["Active", "Maintenance", "Down", "Planned", "Requested", "Standby", "Offline", "Deleted"] = "Active"
    farm: Optional[str] = None
    request_link: Optional[str] = None

    @field_validator(
        "source_port",
        "target_port",
        "link_type",
        "purpose",
        "source_mac",
        "target_mac",
        "cable_type",
        "farm",
        mode="before",
    )
    @classmethod
    def validate_and_trim_text(cls, value):
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None

    @field_validator("source_ip", "target_ip", mode="before")
    @classmethod
    def validate_ip_address(cls, value):
        if value is None:
            return None
        cleaned = str(value).strip()
        if not cleaned:
            return None
        try:
            ip_address(cleaned)
        except ValueError as exc:
            raise ValueError("IP address must be valid IPv4 or IPv6") from exc
        return cleaned

    @field_validator("request_link", mode="before")
    @classmethod
    def validate_request_link(cls, value):
        if value is None:
            return None
        cleaned = str(value).strip()
        if not cleaned:
            return None
        if any(token in cleaned.lower() for token in ["<script", "javascript:", "data:text/html", "vbscript:"]):
            raise ValueError("Request link contains unsafe content")
        parsed = urlparse(cleaned)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("Request link must be a valid http/https URL")
        return cleaned

class NetworkConnectionCreate(NetworkConnectionBase):
    @model_validator(mode="after")
    def validate_identity(self):
        if self.source_device_id is None:
            raise ValueError("Source device is required")
        if self.target_device_id is None:
            raise ValueError("Peer device is required")
        if self.source_port is None:
            raise ValueError("Source port is required")
        if self.target_port is None:
            raise ValueError("Peer port is required")
        if self.link_type is None:
            raise ValueError("Connection type is required")
        if self.source_device_id == self.target_device_id and self.source_port == self.target_port:
            raise ValueError("Loopback mappings on the same asset and port are not allowed")
        if self.source_device_id == self.target_device_id:
            raise ValueError("Source and peer assets must be different")
        return self


class NetworkConnectionUpdate(NetworkConnectionBase):
    pass


class NetworkConnectionBulkIds(BaseModel):
    ids: List[int] = Field(default_factory=list, min_length=1)


class NetworkConnectionBulkStatus(NetworkConnectionBulkIds):
    status: Literal["Active", "Maintenance", "Down", "Planned", "Requested", "Standby", "Offline", "Deleted"]

# --- FAR (FAILURE ANALYSIS & RESOLUTION) SCHEMAS ---

class KnowledgeEntryTinyResponse(BaseSchema):
    category: Optional[str] = None
    title: Optional[str] = None
    status: Optional[str] = None

class FarResolutionResponse(BaseSchema):
    knowledge_id: Optional[int] = None
    preventive_follow_up: Optional[str] = None
    responsible_team: Optional[str] = None
    guidance_notes: Optional[str] = None
    knowledge_bkm: Optional[KnowledgeEntryTinyResponse] = None
    created_at: Optional[datetime] = None

class FarMitigationResponse(BaseSchema):
    mitigation_type: str
    mitigation_steps: Optional[str] = None
    responsible_team: Optional[str] = None
    status: Optional[str] = "Not Started"
    cause_id: Optional[int] = None
    monitoring_item_id: Optional[int] = None
    knowledge_bkm_id: Optional[int] = None
    external_bkm_url: Optional[str] = None
class FarPreventionResponse(BaseSchema):
    failure_mode_id: int
    cause_id: Optional[int] = None
    prevention_action: str
    status: str = "Open"
    target_date: Optional[datetime] = None
    responsible_team: Optional[str] = None

class FarFailureCauseResponse(BaseSchema):
    cause_text: str
    occurrence_level: int = 1
    responsible_team: Optional[str] = None
    resolutions: List[FarResolutionResponse] = []
    mitigations: List[FarMitigationResponse] = []
    prevention_actions: List[FarPreventionResponse] = []

class RcaRecordTinyResponse(BaseSchema):
    title: str
    severity: Optional[str] = None
    status: str = "Open"
    incident_type: Optional[str] = None

class FarFailureModeResponse(BaseSchema):
    system_name: str
    failure_type: str = "Design"
    title: str
    effect: Optional[str] = None
    severity: int = 1
    occurrence: int = 1
    detection: int = 1
    rpn: int = 1
    status: str = "Analyzing"
    has_incident_history: bool = False
    is_deleted: bool = False
    version: int = 1
    metadata_json: Optional[dict] = {}
    
    affected_assets: List[DeviceTinyResponse] = []
    causes: List[FarFailureCauseResponse] = []
    mitigations: List[FarMitigationResponse] = []
    prevention_actions: List[FarPreventionResponse] = []
    linked_rcas: List[RcaRecordTinyResponse] = []

class RcaTimelineEventResponse(BaseSchema):
    rca_id: int
    event_time: datetime
    event_type: Optional[str] = None
    description: str
    owner: Optional[str] = None
    owner_team: Optional[str] = None
    images: Optional[List[str]] = []

class RcaMitigationResponse(BaseSchema):
    rca_id: int
    type: str
    action_description: str
    status: str = "Planned"

class RcaRecordResponse(BaseSchema):
    title: str
    problem_statement: Optional[str] = None
    trigger_source: Optional[str] = None
    severity: Optional[str] = None
    priority: int = 1
    initial_symptoms: Optional[str] = None
    occurrence_at: Optional[datetime] = None
    detection_at: Optional[datetime] = None
    acknowledged_at: Optional[datetime] = None
    owner: Optional[str] = None
    owners: Optional[List[str]] = []
    incident_type: Optional[str] = None
    detection_type: Optional[str] = None
    impact_type: Optional[str] = None
    target_systems: Optional[List[str]] = []
    impacted_asset_ids: Optional[List[int]] = []
    impacted_service_ids: Optional[List[int]] = []
    identification_steps_json: Optional[List[Any]] = []
    rca_steps_json: Optional[List[Any]] = []
    mitigation_logs_json: Optional[List[Any]] = []
    narrative_summary: Optional[str] = None
    evidence_json: Optional[List[Any]] = []
    cause_of_failure: Optional[str] = None
    status: str = "Open"
    
    timeline: List[RcaTimelineEventResponse] = []
    mitigations: List[RcaMitigationResponse] = []
    linked_failure_modes: List[FarFailureModeResponse] = []

class ProjectCommentBase(BaseModel):
    author: str
    content: str
    project_id: int
    task_id: Optional[int] = None

class ProjectCommentCreate(ProjectCommentBase): pass
class ProjectCommentResponse(ProjectCommentBase, BaseSchema):
    timestamp: datetime

class ProjectQABase(BaseModel):
    question: str
    answer: Optional[str] = None
    asked_by: str
    answered_by: Optional[str] = None
    status: str = "Pending"
    project_id: int
    task_id: Optional[int] = None

class ProjectQACreate(ProjectQABase): pass
class ProjectQAResponse(ProjectQABase, BaseSchema): pass

class ProjectTaskBase(BaseModel):
    name: str
    description: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    actual_start_date: Optional[datetime] = None
    actual_end_date: Optional[datetime] = None
    progress: int = 0
    status: str = "To Do"
    owner: Optional[str] = None
    assigned_objects: Optional[List[Any]] = []
    project_id: Optional[int] = None
    parent_task_id: Optional[int] = None
    dependencies_json: Optional[List[int]] = []
    metadata_json: Optional[Dict[str, Any]] = {}

class ProjectTaskCreate(ProjectTaskBase): pass

class ProjectTaskUpdate(ProjectTaskBase):
    id: Optional[int] = None

class ProjectTaskResponse(ProjectTaskBase, BaseSchema):
    comments: List[ProjectCommentResponse] = []
    qa_items: List[ProjectQAResponse] = []
    subtasks: List["ProjectTaskResponse"] = []

class ProjectBase(BaseModel):
    name: str
    description: Optional[str] = None
    type: Optional[str] = None
    status: Optional[str] = "Planning"
    priority: Optional[str] = "Medium"
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    owner: Optional[str] = None
    owners: Optional[List[str]] = []
    
    jira_links: Optional[List[str]] = []
    target_systems: Optional[List[str]] = []
    target_assets: Optional[List[int]] = []
    target_services: Optional[List[int]] = []
    beneficiaries: Optional[List[str]] = []
    
    problem_statement: Optional[str] = None
    objective: Optional[str] = None
    key_functions: Optional[List[str]] = []
    expected_outcomes: Optional[List[str]] = []
    
    parent_project_id: Optional[int] = None
    
    roi_types: Optional[List[str]] = []
    roi_defense_line: int = 0
    roi_defense_line_desc: Optional[str] = None
    man_hours_saved: float = 0.0
    man_hours_saved_math: Optional[str] = None
    man_hours_saved_desc: Optional[str] = None
    stoploss_minutes_saved: float = 0.0
    stoploss_minutes_saved_math: Optional[str] = None
    stoploss_minutes_saved_desc: Optional[str] = None
    wafers_gained: float = 0.0
    wafers_gained_math: Optional[str] = None
    wafers_gained_desc: Optional[str] = None
    
    appendix_json: Optional[Dict[str, Any]] = {}
    team_members: Optional[List[str]] = []
    budget: float = 0.0
    currency: str = "USD"
    order_index: int = 0
    metadata_json: Optional[Dict[str, Any]] = {}

class ProjectCreate(ProjectBase):
    tasks: Optional[List[ProjectTaskUpdate]] = []

class ProjectUpdate(ProjectBase):
    tasks: Optional[List[ProjectTaskUpdate]] = []

class ProjectResponse(ProjectBase, BaseSchema):
    is_deleted: bool = False
    tasks: List[ProjectTaskResponse] = []
    comments: List[ProjectCommentResponse] = []
    qa_items: List[ProjectQAResponse] = []

class GlobalSettingBase(BaseModel):
    key: str
    value: str
    category: Optional[str] = "General"
    description: Optional[str] = None
    is_public: Optional[bool] = False

class GlobalSettingCreate(GlobalSettingBase): pass
class GlobalSettingResponse(GlobalSettingBase, BaseSchema): pass

class UserPreferenceBase(BaseModel):
    key: str
    value: str

class UserPreferenceCreate(UserPreferenceBase): pass
class UserPreferenceResponse(UserPreferenceBase, BaseSchema):
    user_id: str

# --- VENDOR SCHEMAS ---

class VendorPersonnelBase(BaseModel):
    name: str
    name_original: Optional[str] = None
    position: Optional[str] = None
    team: Optional[str] = None
    company_email: Optional[str] = None
    internal_email: Optional[str] = None
    phone: Optional[str] = None
    accounts: Optional[List[Dict[str, Any]]] = []
    pcs: Optional[List[Dict[str, Any]]] = []
    metadata_json: Optional[Dict[str, Any]] = {}

class VendorPersonnelCreate(VendorPersonnelBase):
    vendor_id: int

class VendorPersonnelResponse(VendorPersonnelBase, BaseSchema):
    vendor_id: int

class VendorContractBase(BaseModel):
    title: str
    contract_id: Optional[str] = None
    status: Optional[str] = "Drafted"
    effective_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    covered_systems: Optional[List[str]] = []
    covered_assets: Optional[List[int]] = []
    scope_of_work: Optional[List[Dict[str, Any]]] = []
    schedule: Optional[Dict[str, Any]] = {}
    document_link: Optional[str] = None
    previous_contract_changes: Optional[str] = None
    metadata_json: Optional[Dict[str, Any]] = {}

class VendorContractCreate(VendorContractBase):
    vendor_id: int

class VendorContractResponse(VendorContractBase, BaseSchema):
    vendor_id: int

class VendorBase(BaseModel):
    name: str
    country: Optional[str] = "South Korea"
    primary_personnel_id: Optional[int] = None
    metadata_json: Optional[Dict[str, Any]] = {}

class VendorCreate(VendorBase): pass
class VendorResponse(VendorBase, BaseSchema):
    is_deleted: bool = False
    personnel: List[VendorPersonnelResponse] = []
    contracts: List[VendorContractResponse] = []

# --- KNOWLEDGE BASE SCHEMAS ---

class KnowledgeQABase(BaseModel):
    parent_qa_id: Optional[int] = None
    content: str
    author: Optional[str] = "Anonymous"
    author_team: Optional[str] = None
    target_audience: Optional[str] = "Internal"
    is_answer: bool = False
    is_verified: bool = False
    entry_type: str = "Question"
    metadata_json: Optional[Dict[str, Any]] = {}

class KnowledgeQACreate(KnowledgeQABase):
    knowledge_id: int

class KnowledgeQAResponse(KnowledgeQABase, BaseSchema):
    knowledge_id: int
    replies: List["KnowledgeQAResponse"] = []

class KnowledgeEntryBase(BaseModel):
    category: str # Q&A, Manual, BKM
    title: str
    content: Optional[str] = None
    content_json: Optional[Dict[str, Any]] = {}
    question_context: Optional[str] = None
    is_answered: bool = False
    verified_by: Optional[str] = None
    tags: Optional[List[str]] = []
    impacted_systems: Optional[List[str]] = []
    linked_device_ids: Optional[List[int]] = []
    status: str = "Published"
    metadata_json: Optional[Dict[str, Any]] = {}

class KnowledgeEntryCreate(KnowledgeEntryBase): pass
class KnowledgeEntryResponse(KnowledgeEntryBase, BaseSchema):
    is_deleted: bool = False
    qa_threads: List[KnowledgeQAResponse] = []

# --- USER MANAGEMENT SCHEMAS ---

class RoleBase(BaseModel):
    name: str
    permissions: Dict[str, Any] = Field(default_factory=dict) # { "projects": "read", ... }

class RoleCreate(RoleBase): pass
class RoleResponse(RoleBase, BaseSchema): pass

class OperatorBase(BaseModel):
    external_id: str
    username: str
    full_name: Optional[str] = None
    email: Optional[str] = None
    department: Optional[str] = None
    team: Optional[str] = None
    role_id: Optional[int] = None
    custom_permissions: Dict[str, Any] = Field(default_factory=dict)
    registration_status: Optional[str] = "Pending"
    is_admin: bool = False

class OperatorCreate(OperatorBase): pass
class OperatorUpdate(BaseModel):
    external_id: Optional[str] = None
    username: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    department: Optional[str] = None
    team: Optional[str] = None
    teams: Optional[List[str]] = None
    role_id: Optional[int] = None
    custom_permissions: Optional[Dict[str, Any]] = None
    registration_status: Optional[str] = None
    is_admin: Optional[bool] = None

class OperatorResponse(OperatorBase, BaseSchema):
    role: Optional[RoleResponse] = None
