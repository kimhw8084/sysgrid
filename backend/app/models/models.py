from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey, JSON, Text, Table, UniqueConstraint, CheckConstraint, Index
from sqlalchemy.orm import relationship, backref
from sqlalchemy.sql import func
from ..database_base import Base

class BaseMixin:
    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())
    created_by_user_id = Column(String)

class Site(Base, BaseMixin):
    __tablename__ = "sites"
    name = Column(String, index=True, unique=True)
    address = Column(String)
    facility_manager = Column(String)
    contact_phone = Column(String)
    cooling_capacity_kw = Column(Float, default=0.0)
    power_capacity_kw = Column(Float, default=0.0)
    order_index = Column(Integer, default=0)
    color = Column(String, default="#3b82f6")
    rooms = relationship("Room", back_populates="site", cascade="all, delete-orphan")

class Room(Base, BaseMixin):
    __tablename__ = "rooms"
    site_id = Column(Integer, ForeignKey("sites.id", ondelete="CASCADE"))
    name = Column(String)
    floor_level = Column(String)
    hvac_zone = Column(String)
    fire_suppression_type = Column(String)
    site = relationship("Site", back_populates="rooms")
    racks = relationship("Rack", back_populates="room")

class Rack(Base, BaseMixin):
    __tablename__ = "racks"
    room_id = Column(Integer, ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True)
    name = Column(String, index=True)
    aisle = Column(String, nullable=True)
    row = Column(String, nullable=True)
    total_u_height = Column(Integer, default=42)
    max_power_kw = Column(Float, default=8.0)
    typical_power_kw = Column(Float, default=4.0)
    max_weight_kg = Column(Float, default=1000.0)
    cooling_type = Column(String)
    pdu_a_id = Column(String)
    pdu_b_id = Column(String)
    pdu_a_name = Column(String, default="PDU-A")
    pdu_b_name = Column(String, default="PDU-B")
    pdu_a_cap_kw = Column(Float, default=10.0)
    pdu_b_cap_kw = Column(Float, default=10.0)
    is_deleted = Column(Boolean, default=False)
    order_index = Column(Integer, default=0)
    last_site_name = Column(String, nullable=True) # Historical record for unassigned racks
    room = relationship("Room", back_populates="racks")
    device_locations = relationship("DeviceLocation", back_populates="rack", cascade="all, delete-orphan")

class InfrastructurePlan(Base, BaseMixin):
    __tablename__ = "infrastructure_plans"
    name = Column(String, index=True)
    description = Column(String, nullable=True)
    racks_config = Column(JSON) # List of sandboxRackIds
    virtual_racks_data = Column(JSON) # virtualRacks data (JSON serialized)
    plan_date = Column(DateTime(timezone=True), server_default=func.now())

class Device(Base, BaseMixin):
    __tablename__ = "devices"
    name = Column(String, index=True) # Hostname (Removed unique)
    system = Column(String, index=True) # Logical System name
    environment = Column(String)
    status = Column(String) # Active, Virtual, Decommissioned
    type = Column(String) # Physical, Virtual, Storage, Switch
    size_u = Column(Integer, default=1) # Default U-height for the device
    tenant_id = Column(Integer, index=True, nullable=True) # Added for multi-tenancy. Foreign key removed due to cross-database reference.
    
    manufacturer = Column(String)
    model = Column(String)
    serial_number = Column(String, index=True) # Removed unique
    asset_tag = Column(String, index=True)
    part_number = Column(String)
    
    os_name = Column(String)
    os_version = Column(String)
    management_ip = Column(String)
    primary_ip = Column(String)
    management_url = Column(String)
    
    owner = Column(String)
    business_unit = Column(String)
    vendor = Column(String)
    purchase_order = Column(String)
    cost_center = Column(String)
    purchase_date = Column(DateTime, nullable=True)
    install_date = Column(DateTime, nullable=True)
    warranty_end = Column(DateTime, nullable=True)
    eol_date = Column(DateTime, nullable=True)
    role = Column(String) # Role description of the asset
    
    power_supply_count = Column(Integer, default=2)
    power_max_w = Column(Float, default=0.0)
    power_typical_w = Column(Float, default=0.0)
    btu_hr = Column(Float, default=0.0)
    depth = Column(String, default="Full") # Full, Half
    
    tool_group = Column(String)
    fab_area = Column(String)
    recipe_critical = Column(Boolean, default=False)
    
    metadata_json = Column(JSON, default=dict)
    is_reservation = Column(Boolean, default=False)
    reservation_info = Column(JSON, default=dict) # {est_arrival: "YYYY-MM", requester: "Name"}
    is_deleted = Column(Boolean, default=False)
    logic_json = Column(JSON, default=list) # [{id, name, upstream_ids: [], controller: "", steps: [], state: "", downstream_ids: []}]
    
    locations = relationship("DeviceLocation", back_populates="device", cascade="all, delete-orphan")
    components = relationship("HardwareComponent", back_populates="device", cascade="all, delete-orphan")
    software = relationship("DeviceSoftware", back_populates="device", cascade="all, delete-orphan")
    secrets = relationship("SecretVault", back_populates="device", cascade="all, delete-orphan")
    relationships = relationship("DeviceRelationship", primaryjoin="Device.id==DeviceRelationship.source_device_id", cascade="all, delete-orphan")
    maintenance_windows = relationship("MaintenanceWindow", back_populates="device", cascade="all, delete-orphan")
    logical_services = relationship("LogicalService", back_populates="device")
    monitoring_items = relationship("MonitoringItem", back_populates="device", cascade="all, delete-orphan")
    network_interfaces = relationship("NetworkInterface", back_populates="device", cascade="all, delete-orphan")

class LogicalService(Base, BaseMixin):
    __tablename__ = "logical_services"
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="SET NULL"), nullable=True) # Nullable if service is floating/clustered
    name = Column(String, index=True) # Service Name
    service_type = Column(String, index=True) # Database, Web, Middleware, Container, ToolStack, Other
    status = Column(String) # Active, Stopped, Critical, Maintenance
    version = Column(String)
    environment = Column(String)
    purpose = Column(Text) # Purpose description
    documentation_link = Column(String) # Link to source, installation, app, etc.
    installation_date = Column(DateTime) # Date of installation or planned installation
    
    # Exaustive Predefined Schemas stored in JSON for maximum flexibility + strict UI enforcement
    # For Database: { engine, instance_name, port, sid, collation, always_on, data_path, backup_policy }
    # For Web: { server_type, url, bindings, app_pool, ssl_expiry, root_path }
    config_json = Column(JSON, default=dict)
    
    # License & Procurement
    purchase_type = Column(String) # One-time, Subscription
    license_key = Column(String)
    purchase_date = Column(DateTime)
    expiry_date = Column(DateTime)
    cost = Column(Float, default=0.0)
    currency = Column(String) # USD, KRW
    manufacturer = Column(String) # Developing company (e.g. Microsoft)
    supplier = Column(String) # Licensing company (e.g. AWS, Reseller)
    
    # Smart Expandability: Unlimited custom key-values
    custom_attributes = Column(JSON, default=dict)
    logic_json = Column(JSON, default=list)
    is_deleted = Column(Boolean, default=False)
    
    device = relationship("Device", back_populates="logical_services")
    secrets = relationship("ServiceSecret", back_populates="service", cascade="all, delete-orphan")

class ServiceSecret(Base, BaseMixin):
    __tablename__ = "service_secrets"
    service_id = Column(Integer, ForeignKey("logical_services.id", ondelete="CASCADE"))
    username = Column(String)
    password = Column(String)
    note = Column(Text)
    service = relationship("LogicalService", back_populates="secrets")

class DeviceRelationship(Base, BaseMixin):
    __tablename__ = "device_relationships"
    source_device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"))
    target_device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"))
    relationship_type = Column(String)
    source_role = Column(String)
    target_role = Column(String)
    notes = Column(Text)

class DeviceLocation(Base, BaseMixin):
    __tablename__ = "device_locations"
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"))
    rack_id = Column(Integer, ForeignKey("racks.id", ondelete="CASCADE"))
    start_unit = Column(Integer)
    size_u = Column(Integer)
    orientation = Column(String, default="Front") # Front, Back
    depth = Column(String, default="Full") # Full, Half
    device = relationship("Device", back_populates="locations")
    rack = relationship("Rack", back_populates="device_locations")

class HardwareComponent(Base, BaseMixin):
    __tablename__ = "hardware_components"
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"))
    category = Column(String) # CPU, Memory, Card, SSD, HDD, NIC
    name = Column(String)
    manufacturer = Column(String)
    specs = Column(String)
    count = Column(Integer, default=1)
    serial_number = Column(String)
    device = relationship("Device", back_populates="components")

class DeviceSoftware(Base, BaseMixin):
    __tablename__ = "device_software"
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"))
    category = Column(String)
    name = Column(String)
    version = Column(String)
    install_date = Column(DateTime)
    purpose = Column(String)
    notes = Column(Text)
    device = relationship("Device", back_populates="software")

class NetworkInterface(Base, BaseMixin):
    __tablename__ = "network_interfaces"
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"))
    name = Column(String)
    mac_address = Column(String, unique=True, index=True)
    ip_address = Column(String, index=True)
    vlan_id = Column(Integer, nullable=True)
    link_speed_gbps = Column(Integer)
    device = relationship("Device", back_populates="network_interfaces")

class PortConnection(Base, BaseMixin):
    __tablename__ = "port_connections"
    source_device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"))
    source_port = Column(String)
    source_ip = Column(String, nullable=True)
    source_mac = Column(String, nullable=True)
    source_vlan = Column(Integer, nullable=True)
    target_device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"))
    target_port = Column(String)
    target_ip = Column(String, nullable=True)
    target_mac = Column(String, nullable=True)
    target_vlan = Column(Integer, nullable=True)
    link_type = Column(String)  # Renamed from purpose
    purpose = Column(Text)     # New description field
    speed_gbps = Column(Float)
    unit = Column(String)
    direction = Column(String)
    cable_type = Column(String)
    status = Column(String) # Active, Maintenance, Down, Planned
    farm = Column(String)
    request_link = Column(String)

class Subnet(Base, BaseMixin):
    __tablename__ = "subnets"
    network_cidr = Column(String, index=True, unique=True)
    name = Column(String)
    vlan_id = Column(Integer, nullable=True)
    gateway = Column(String, nullable=True)
    dns_servers = Column(String, nullable=True) # Comma separated
    description = Column(Text)

class SettingOption(Base, BaseMixin):
    __tablename__ = "settings_options"
    __table_args__ = (
        UniqueConstraint("category", "value", name="uq_settings_options_category_value"),
        UniqueConstraint("category", "label", name="uq_settings_options_category_label"),
    )
    category = Column(String, index=True) # LogicalSystem, DeviceType, ServiceType, etc.
    label = Column(String)
    value = Column(String)
    description = Column(String, nullable=True)
    metadata_keys = Column(JSON, default=list) # For ServiceType: ["port", "dbname", etc]
    is_default = Column(Boolean, default=False)

class SecretVault(Base, BaseMixin):
    __tablename__ = "secret_vault"
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"))
    secret_type = Column(String)
    username = Column(String)
    encrypted_payload = Column(Text)
    notes = Column(Text)
    device = relationship("Device", back_populates="secrets")

class MaintenanceWindow(Base, BaseMixin):
    __tablename__ = "maintenance_windows"
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"))
    title = Column(String)
    start_time = Column(DateTime)
    end_time = Column(DateTime)
    ticket_number = Column(String)
    coordinator = Column(String)
    status = Column(String)
    device = relationship("Device", back_populates="maintenance_windows")


class OperationalAction(Base):
    """Durable, tenant-scoped lineage for an operator action request."""

    __tablename__ = "operational_actions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "actor_id", "idempotency_key", name="uq_operational_actions_idempotency"),
        Index("ix_operational_actions_tenant_status", "tenant_id", "status"),
        Index("ix_operational_actions_tenant_created", "tenant_id", "created_at"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    actor_id = Column(String(200), nullable=False, index=True)
    action_key = Column(String(120), nullable=False, index=True)
    capability_key = Column(String(120), nullable=False, index=True)
    adapter_id = Column(String(120), nullable=False)
    adapter_capability = Column(String(120), nullable=False)
    normalized_parameters = Column(JSON, nullable=False, default=dict)
    parameters_hash = Column(String(64), nullable=False)
    target_set_hash = Column(String(64), nullable=True)
    risk_tier = Column(String(32), nullable=False)
    risk_facts = Column(JSON, nullable=False, default=dict)
    precondition_snapshot = Column(JSON, nullable=False, default=dict)
    precondition_hash = Column(String(64), nullable=True)
    preview_token = Column(String(64), nullable=True)
    preview_expires_at = Column(DateTime(timezone=True), nullable=True)
    authorization_facts = Column(JSON, nullable=False, default=dict)
    approval_facts = Column(JSON, nullable=False, default=dict)
    recovery_facts = Column(JSON, nullable=False, default=dict)
    confirmation_facts = Column(JSON, nullable=False, default=dict)
    rollback_plan = Column(JSON, nullable=False, default=dict)
    execution_result = Column(JSON, nullable=False, default=dict)
    verification_summary = Column(Text, nullable=True)
    verification_evidence = Column(JSON, nullable=False, default=list)
    rollback_outcome = Column(JSON, nullable=False, default=dict)
    request_hash = Column(String(64), nullable=False)
    idempotency_key = Column(String(200), nullable=False)
    request_id = Column(String(128), nullable=False)
    maintenance_window_id = Column(
        Integer,
        ForeignKey("maintenance_windows.id", ondelete="SET NULL"),
        nullable=True,
    )
    change_context = Column(JSON, nullable=False, default=dict)
    status = Column(String(32), nullable=False, index=True)
    execution_attempt_id = Column(String(80), nullable=True)
    rollback_attempt_id = Column(String(80), nullable=True)
    progress_percent = Column(Integer, nullable=False, default=0)
    progress_message = Column(String(500), nullable=True)
    requested_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    previewed_at = Column(DateTime(timezone=True), nullable=True)
    authorized_at = Column(DateTime(timezone=True), nullable=True)
    confirmed_at = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    rolled_back_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class OperationalActionAttempt(Base):
    """Durable ownership and reconciliation record for one adapter attempt."""

    __tablename__ = "operational_action_attempts"
    __table_args__ = (
        Index("ix_operational_action_attempts_tenant_action", "tenant_id", "action_id"),
        Index("ix_operational_action_attempts_action_phase", "action_id", "phase"),
    )

    id = Column(String(80), primary_key=True)
    action_id = Column(String(80), ForeignKey("operational_actions.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(Integer, nullable=False, index=True)
    actor_id = Column(String(200), nullable=False)
    phase = Column(String(24), nullable=False)
    status = Column(String(32), nullable=False, index=True)
    request_id = Column(String(128), nullable=False)
    success = Column(Boolean, nullable=True)
    progress_percent = Column(Integer, nullable=False, default=0)
    progress_message = Column(String(500), nullable=True)
    result = Column(JSON, nullable=False, default=dict)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class OperationalActionTarget(Base):
    """Snapshot-backed target reference; intentionally not an FK to Device.

    Device purge must not erase historical action lineage. The device ID and
    safe snapshot remain durable even when the current asset row is gone.
    """

    __tablename__ = "operational_action_targets"
    __table_args__ = (
        UniqueConstraint("action_id", "device_id", name="uq_operational_action_target_device"),
        Index("ix_operational_action_targets_tenant_device", "tenant_id", "device_id"),
    )

    id = Column(String(80), primary_key=True)
    action_id = Column(String(80), ForeignKey("operational_actions.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(Integer, nullable=False, index=True)
    device_id = Column(Integer, nullable=False, index=True)
    target_revision = Column(String(64), nullable=False)
    target_snapshot = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class OperationalActionEvent(Base):
    """Append-only state/progress history for an operational action."""

    __tablename__ = "operational_action_events"
    __table_args__ = (
        UniqueConstraint("action_id", "sequence", name="uq_operational_action_event_sequence"),
        Index("ix_operational_action_events_tenant_action", "tenant_id", "action_id"),
    )

    id = Column(String(80), primary_key=True)
    action_id = Column(String(80), ForeignKey("operational_actions.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(Integer, nullable=False, index=True)
    sequence = Column(Integer, nullable=False)
    event_type = Column(String(48), nullable=False)
    from_status = Column(String(32), nullable=True)
    to_status = Column(String(32), nullable=False)
    actor_id = Column(String(200), nullable=False)
    message = Column(String(500), nullable=True)
    details = Column(JSON, nullable=False, default=dict)
    occurred_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class OperationalActionEvidence(Base):
    """Small, typed evidence records; arbitrary secret-bearing blobs are excluded."""

    __tablename__ = "operational_action_evidence"
    __table_args__ = (
        Index("ix_operational_action_evidence_tenant_action", "tenant_id", "action_id"),
    )

    id = Column(String(80), primary_key=True)
    action_id = Column(String(80), ForeignKey("operational_actions.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(Integer, nullable=False, index=True)
    evidence_type = Column(String(48), nullable=False)
    success = Column(Boolean, nullable=True)
    summary = Column(Text, nullable=False)
    reference = Column(String(500), nullable=True)
    metadata_json = Column(JSON, nullable=False, default=dict)
    recorded_by = Column(String(200), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

class MonitoringItem(Base, BaseMixin):
    __tablename__ = "monitoring_items"
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=True)
    category = Column(String, index=True) # Hardware, Log, Network, App, Synthetic
    status = Column(String, index=True) # Existing, Planned, Cancelled, Deleted
    title = Column(String) # What's being monitored
    spec = Column(Text) # Details/Thresholds
    platform = Column(String) # Zabbix, Prometheus, Datadog, etc.
    monitoring_url = Column(String) # Direct clickable link
    purpose = Column(Text)
    impact = Column(Text)
    notification_method = Column(String) # Email, Slack, PagerDuty
    notification_recipients = Column(JSON, default=list)
    logic = Column(Text) # For log-based: regex or query
    logic_json = Column(JSON, default=list) # Structured logic entries
    monitored_services = Column(JSON, default=list) # List of LogicalService IDs
    owner_team = Column(String) # Managed via Team registry names
    
    # Reliability & Frequency Controls
    check_interval = Column(Integer, default=60) # Seconds
    alert_duration = Column(Integer, default=0) # Seconds before alerting
    notification_throttle = Column(Integer, default=3600) # Seconds between re-alerts
    severity = Column(String, default="Warning") # Critical, Warning, Info
    is_active = Column(Boolean, default=True)
    is_deleted = Column(Boolean, default=False)
    recovery_docs = Column(JSON, default=list) # List of KnowledgeEntry IDs
    version = Column(Integer, default=1)

    device = relationship("Device", back_populates="monitoring_items")
    owners = relationship("MonitoringOwner", back_populates="monitoring_item", cascade="all, delete-orphan")

class MonitoringHistory(Base, BaseMixin):
    __tablename__ = "monitoring_history"
    __table_args__ = (
        UniqueConstraint("monitoring_item_id", "version", name="uq_monitoring_history_item_version"),
    )
    monitoring_item_id = Column(Integer, ForeignKey("monitoring_items.id", ondelete="CASCADE"))
    version = Column(Integer)
    snapshot = Column(JSON) # Snapshot of fields + owners
    change_summary = Column(Text, nullable=True)

    monitoring_item = relationship("MonitoringItem")

class MonitoringOwner(Base, BaseMixin):
    __tablename__ = "monitoring_owners"
    monitoring_item_id = Column(Integer, ForeignKey("monitoring_items.id", ondelete="CASCADE"))
    operator_id = Column(Integer, ForeignKey("operators.id", ondelete="CASCADE"), nullable=True)
    name = Column(String)
    external_id = Column(String) # Owner external ID snapshot
    role = Column(String) # From MonitoringOwnerRole enum
    
    monitoring_item = relationship("MonitoringItem", back_populates="owners")
    operator = relationship("Operator")

class FirewallRule(Base, BaseMixin):
    __tablename__ = "firewall_rules"
    name = Column(String, index=True)
    risk = Column(Text) # Business impact if rule is missing
    
    # Source Configuration
    source_type = Column(String) # Device, Subnet, Custom IP, Any
    source_device_id = Column(Integer, ForeignKey("devices.id", ondelete="SET NULL"), nullable=True)
    source_subnet_id = Column(Integer, ForeignKey("subnets.id", ondelete="SET NULL"), nullable=True)
    source_custom_ip = Column(String) # For external or one-off IPs
    
    # Destination Configuration
    dest_type = Column(String) # Device, Subnet, Custom IP, Any
    dest_device_id = Column(Integer, ForeignKey("devices.id", ondelete="SET NULL"), nullable=True)
    dest_subnet_id = Column(Integer, ForeignKey("subnets.id", ondelete="SET NULL"), nullable=True)
    dest_custom_ip = Column(String)
    
    # Protocol & Ports
    protocol = Column(String, default="TCP") # TCP, UDP, ICMP, Any
    port_range = Column(String) # e.g. "443", "1433,1434", "1024-2048"
    direction = Column(String, default="Inbound") # Inbound, Outbound
    action = Column(String, default="Allow") # Allow, Deny
    
    status = Column(String, default="Active") # Active, Requested, Decommissioned
    is_deleted = Column(Boolean, default=False)

    source_device = relationship("Device", foreign_keys=[source_device_id])
    dest_device = relationship("Device", foreign_keys=[dest_device_id])
    source_subnet = relationship("Subnet", foreign_keys=[source_subnet_id])
    dest_subnet = relationship("Subnet", foreign_keys=[dest_subnet_id])

class IncidentLog(Base, BaseMixin):
    __tablename__ = "incident_logs"
    systems = Column(JSON, default=list) # Multi-select systems
    impacted_device_ids = Column(JSON, default=list) # Multi-select assets

    title = Column(String, index=True)
    severity = Column(String, default="Major") # Critical, Major, Minor
    status = Column(String, default="Investigating") # Investigating, Identified, Monitoring, Resolved, Prevented
    start_time = Column(DateTime)
    end_time = Column(DateTime, nullable=True)
    reporter = Column(String)

    # Forensic / Progressive disclosure fields
    initial_symptoms = Column(Text) # "Day zero" info
    impacts_json = Column(JSON, default=list) # Multi-select categories (Wafer loss, Blockage, etc.)
    impact_analysis = Column(Text)
    # Deep Forensics (For engineers)
    trigger_event = Column(Text) # Change, load spike, etc.
    log_evidence = Column(Text) # Error log snippets
    mitigation_steps = Column(Text) # Temporary stability
    root_cause = Column(Text) # Final finding
    resolution_steps = Column(Text) # Permanent fix

    # Post-Mortem / Reliability
    lessons_learned = Column(Text)
    prevention_strategy = Column(Text)

    timeline_json = Column(JSON, default=list) # [{time, event, type}]
    todos_json = Column(JSON, default=list) # [{task, status, owner}]
class DataFlow(Base, BaseMixin):
    __tablename__ = "data_flows"
    name = Column(String, index=True)
    description = Column(Text)
    category = Column(String) # System, Service, Application
    status = Column(String) # Up to date, Deprecated, Planned, etc.
    metadata_json = Column(JSON, default=dict)
    nodes_json = Column(JSON, default=list)
    edges_json = Column(JSON, default=list)
    viewport_json = Column(JSON, default=dict)
    traces_json = Column(JSON, default=list) # [{id, name, steps: [{node_id, edge_id}]}]
    is_template = Column(Boolean, default=False)
    is_deleted = Column(Boolean, default=False)
    history = relationship("DataFlowHistory", back_populates="data_flow", cascade="all, delete-orphan")

class DataFlowHistory(Base, BaseMixin):
    __tablename__ = "data_flow_history"
    data_flow_id = Column(Integer, ForeignKey("data_flows.id", ondelete="CASCADE"))
    version = Column(Integer, default=1)
    snapshot = Column(JSON, default=dict)
    change_summary = Column(Text)

    data_flow = relationship("DataFlow", back_populates="history")

class ExternalEntity(Base, BaseMixin):
    __tablename__ = "external_entities"
    name = Column(String, index=True)
    external_key = Column(String, unique=True, index=True)
    aliases_json = Column(JSON, default=list)
    type = Column(String) # Driven by ExternalType registry (e.g. Equipment, Physical Server, Virtual Server, Switch, Storage, DB, API, Script)
    subtype = Column(String)
    owner_organization = Column(String)
    owner_team = Column(String) # Legacy external-side team label
    ownership_mode = Column(String)
    internal_team_id = Column(Integer, ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    internal_operator_id = Column(Integer, ForeignKey("operators.id", ondelete="SET NULL"), nullable=True)
    status = Column(String)
    environment = Column(String)
    description = Column(Text)
    notes = Column(Text)
    contacts_json = Column(JSON, default=list)
    business_purpose = Column(Text)
    criticality = Column(String)
    dependency_tier = Column(String)
    data_classification = Column(String)
    integration_mode = Column(String)
    primary_endpoint_url = Column(String)
    secondary_endpoint_url = Column(String)
    auth_method = Column(String)
    protocol_family = Column(String)
    port_override = Column(Integer)
    supports_inbound = Column(Boolean, default=False)
    supports_outbound = Column(Boolean, default=False)
    source_system = Column(String)
    source_record_id = Column(String)
    risk_rating = Column(String)
    contains_customer_data = Column(Boolean, default=False)
    contains_credentials = Column(Boolean, default=False)
    stores_pii = Column(Boolean, default=False)
    internet_exposed = Column(Boolean, default=False)
    third_party_assessment_status = Column(String)
    poc_json = Column(JSON, default=list) # Multi-add POCs: [{first_name, last_name, id, email, phone}]
    metadata_json = Column(JSON, default=dict) # Driven by ExternalType registry keys
    is_deleted = Column(Boolean, default=False)
    
    secrets = relationship("ExternalEntitySecret", back_populates="external_entity", cascade="all, delete-orphan")
    internal_team = relationship("Team", foreign_keys=[internal_team_id])
    internal_operator = relationship("Operator", foreign_keys=[internal_operator_id])

class ExternalEntitySecret(Base, BaseMixin):
    __tablename__ = "external_entity_secrets"
    external_entity_id = Column(Integer, ForeignKey("external_entities.id", ondelete="CASCADE"))
    secret_label = Column(String)
    secret_type = Column(String)
    username = Column(String)
    password = Column(String)
    vault_provider = Column(String)
    vault_path = Column(String)
    note = Column(Text)
    credential_status = Column(String)
    rotation_frequency_days = Column(Integer)
    password_last_rotated_at = Column(String)
    external_entity = relationship("ExternalEntity", back_populates="secrets")

class ExternalLink(Base, BaseMixin):
    __tablename__ = "external_links"
    __table_args__ = (
        UniqueConstraint(
            "external_entity_id",
            "device_id",
            "service_id",
            "protocol",
            "port",
            "host_or_fqdn",
            "path_or_resource",
            "link_status",
            name="uq_external_link_shape_status",
        ),
    )
    external_entity_id = Column(Integer, ForeignKey("external_entities.id"))
    device_id = Column(Integer, ForeignKey("devices.id"))
    service_id = Column(Integer, ForeignKey("logical_services.id"), nullable=True)
    direction = Column(String) # Upstream, Downstream
    purpose = Column(String)
    protocol = Column(String) # TCP, UDP, HTTPS, etc.
    port = Column(String)
    host_or_fqdn = Column(String)
    path_or_resource = Column(String)
    network_zone = Column(String)
    transport_security = Column(String)
    link_status = Column(String)
    credential_reference = Column(String)
    credentials = Column(JSON) # Store as { "username": "...", "password": "...", "note": "..." }
    
    external_entity = relationship("ExternalEntity")
    device = relationship("Device")
    service = relationship("LogicalService")

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True)
    timestamp = Column(DateTime, server_default=func.now())
    user_id = Column(String)
    action = Column(String)
    target_table = Column(String)
    target_id = Column(String)
    changes = Column(JSON)
    description = Column(Text)

# --- NEW VENDOR & CONTRACT MODULES ---

class Vendor(Base, BaseMixin):
    __tablename__ = "vendors"
    name = Column(String, index=True)
    country = Column(String)
    primary_personnel_id = Column(Integer, ForeignKey("vendor_personnel.id", ondelete="SET NULL"), nullable=True)
    
    is_deleted = Column(Boolean, default=False)
    metadata_json = Column(JSON, default=dict)
    
    personnel = relationship("VendorPersonnel", back_populates="vendor_ref", cascade="all, delete-orphan", foreign_keys="[VendorPersonnel.vendor_id]")
    contracts = relationship("VendorContract", back_populates="vendor_ref", cascade="all, delete-orphan")
    primary_personnel = relationship("VendorPersonnel", foreign_keys=[primary_personnel_id], post_update=True)

class VendorPersonnel(Base, BaseMixin):
    __tablename__ = "vendor_personnel"
    vendor_id = Column(Integer, ForeignKey("vendors.id", ondelete="CASCADE"))
    name = Column(String, index=True)
    name_original = Column(String) # Added original name
    position = Column(String)
    team = Column(String)
    company_email = Column(String)
    internal_email = Column(String)
    phone = Column(String)
    
    # Nested lists of dicts
    accounts = Column(JSON, default=list) # [{type, username, purpose_description}]
    pcs = Column(JSON, default=list) # [{name, type, purpose_description}]
    
    metadata_json = Column(JSON, default=dict)
    is_deleted = Column(Boolean, default=False)
    
    vendor_ref = relationship("Vendor", back_populates="personnel", foreign_keys=[vendor_id])

class VendorContract(Base, BaseMixin):
    __tablename__ = "vendor_contracts"
    vendor_id = Column(Integer, ForeignKey("vendors.id", ondelete="CASCADE"))
    title = Column(String, index=True)
    contract_id = Column(String, index=True)
    status = Column(String) # Drafted, In Review, Completed, Cancelled, Expired
    effective_date = Column(DateTime)
    expiry_date = Column(DateTime)
    
    # Details
    covered_systems = Column(JSON, default=list) # List of system names
    covered_assets = Column(JSON, default=list) # List of device IDs
    scope_of_work = Column(JSON, default=list) # [{work_description, frequency, response, objective_description, importance}]
    schedule = Column(JSON, default=dict) # {work_schedule, oncall_method, holiday_policy}
    document_link = Column(String)
    previous_contract_changes = Column(Text) # What changed from the previous contract
    
    metadata_json = Column(JSON, default=dict)
    is_deleted = Column(Boolean, default=False)
    
    vendor_ref = relationship("Vendor", back_populates="contracts")

# --- NEW KNOWLEDGE BASE MODULE ---

class KnowledgeEntry(Base, BaseMixin):
    __tablename__ = "knowledge_entries"
    category = Column(String, index=True) # Q&A, Manual, BKM
    title = Column(String, index=True)
    content = Column(Text) # Markdown or Rich Text (Mainly for simple entries)
    
    # Structured Data (BKM or System Manual)
    # BKM Schema: { purpose, prerequisites: [], workflow_diagram, steps: [], tips: [], troubleshooting: [], next_steps: [] }
    # Manual Schema: { business_value: {}, overview: {}, performance: {}, operation: {} }
    content_json = Column(JSON, default=dict) 
    
    # Q&A specific fields
    question_context = Column(Text) # Original problem description
    is_answered = Column(Boolean, default=False)
    verified_by = Column(String)
    
    # Relations & Metadata
    tags = Column(JSON, default=list) # ["Network", "Database", "Vendor:Dell"]
    impacted_systems = Column(JSON, default=list) # List of system names
    linked_device_ids = Column(JSON, default=list) # Multi-select assets
    
    status = Column(String, default="Published") # Draft, Published, Archived
    is_deleted = Column(Boolean, default=False)
    metadata_json = Column(JSON, default=dict)

    qa_threads = relationship("KnowledgeQA", back_populates="knowledge", cascade="all, delete-orphan")

class KnowledgeQA(Base, BaseMixin):
    __tablename__ = "knowledge_qa"
    knowledge_id = Column(Integer, ForeignKey("knowledge_entries.id", ondelete="CASCADE"))
    parent_qa_id = Column(Integer, ForeignKey("knowledge_qa.id", ondelete="CASCADE"), nullable=True)
    
    content = Column(Text)
    author = Column(String)
    author_team = Column(String)
    target_audience = Column(String) # Internal, HQ, Dept, Vendor, etc.
    
    # If it's an answer to a question
    is_answer = Column(Boolean, default=False)
    is_verified = Column(Boolean, default=False)
    
    # Metadata for the "timeline" feel
    entry_type = Column(String, default="Question") # Question, Answer, Follow-up, Observation
    
    timestamp = Column(DateTime, server_default=func.now())
    is_deleted = Column(Boolean, default=False)
    metadata_json = Column(JSON, default=dict) # For images, links, etc.
    
    knowledge = relationship("KnowledgeEntry", back_populates="qa_threads")
    replies = relationship("KnowledgeQA", backref=backref("parent", remote_side="KnowledgeQA.id"), cascade="all, delete-orphan")

# --- NEW FAR (FAILURE ANALYSIS & RESOLUTION) MODULE ---

# Many-to-Many Join Tables for FAR
far_mode_assets = Table(
    "far_mode_assets", Base.metadata,
    Column("mode_id", Integer, ForeignKey("far_failure_modes.id", ondelete="CASCADE")),
    Column("device_id", Integer, ForeignKey("devices.id", ondelete="CASCADE"))
)

far_mode_causes = Table(
    "far_mode_causes", Base.metadata,
    Column("mode_id", Integer, ForeignKey("far_failure_modes.id", ondelete="CASCADE")),
    Column("cause_id", Integer, ForeignKey("far_failure_causes.id", ondelete="CASCADE"))
)

far_cause_resolutions = Table(
    "far_cause_resolutions", Base.metadata,
    Column("cause_id", Integer, ForeignKey("far_failure_causes.id", ondelete="CASCADE")),
    Column("resolution_id", Integer, ForeignKey("far_resolutions.id", ondelete="CASCADE"))
)

far_mode_mitigations = Table(
    "far_mode_mitigations", Base.metadata,
    Column("mode_id", Integer, ForeignKey("far_failure_modes.id", ondelete="CASCADE")),
    Column("mitigation_id", Integer, ForeignKey("far_mitigations.id", ondelete="CASCADE"))
)

# Join table for RcaRecord <-> FarFailureMode N:N relationship
rca_failure_mode_links = Table(
    "rca_failure_mode_links", Base.metadata,
    Column("rca_id", Integer, ForeignKey("rca_records.id", ondelete="CASCADE")),
    Column("failure_mode_id", Integer, ForeignKey("far_failure_modes.id", ondelete="CASCADE"))
)

class FarFailureMode(Base, BaseMixin):
    __tablename__ = "far_failure_modes"
    system_name = Column(String, index=True)
    failure_type = Column(String, default="Design")
    title = Column(String, index=True)
    effect = Column(Text)
    
    # FMEA Indices
    severity = Column(Integer, default=1)
    occurrence = Column(Integer, default=1)
    detection = Column(Integer, default=1)
    rpn = Column(Integer, default=1)
    
    # Status: Analyzing, Cause Identified, Resolution Identified, Mitigated, Eliminated
    status = Column(String, default="Analyzing")
    has_incident_history = Column(Boolean, default=False)
    
    version = Column(Integer, default=1)
    is_deleted = Column(Boolean, default=False)
    metadata_json = Column(JSON, default=dict)

    # Relationships
    affected_assets = relationship("Device", secondary=far_mode_assets)
    causes = relationship("FarFailureCause", secondary=far_mode_causes, back_populates="failure_modes")
    mitigations = relationship("FarMitigation", secondary=far_mode_mitigations)
    prevention_actions = relationship("FarPrevention", back_populates="failure_mode", cascade="all, delete-orphan")
    linked_rcas = relationship("RcaRecord", secondary=rca_failure_mode_links, back_populates="linked_failure_modes")

class FarHistory(Base, BaseMixin):
    __tablename__ = "far_history"
    far_mode_id = Column(Integer, ForeignKey("far_failure_modes.id", ondelete="CASCADE"))
    version = Column(Integer)
    snapshot = Column(JSON) # Snapshot of fields
    change_summary = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("far_mode_id", "version", name="uq_far_history_mode_version"),
    )

class FarFailureCause(Base, BaseMixin):
    __tablename__ = "far_failure_causes"
    cause_text = Column(Text)
    occurrence_level = Column(Integer, default=1)
    responsible_team = Column(String)
    
    failure_modes = relationship("FarFailureMode", secondary=far_mode_causes, back_populates="causes")
    resolutions = relationship("FarResolution", secondary=far_cause_resolutions)
    mitigations = relationship("FarMitigation", backref="cause", cascade="all, delete-orphan")
    prevention_actions = relationship("FarPrevention", backref="cause", cascade="all, delete-orphan")

class FarResolution(Base, BaseMixin):
    __tablename__ = "far_resolutions"
    # Links to a KnowledgeEntry (BKM)
    knowledge_id = Column(Integer, ForeignKey("knowledge_entries.id", ondelete="SET NULL"), nullable=True)
    preventive_follow_up = Column(Text)
    responsible_team = Column(String)
    guidance_notes = Column(Text)

    knowledge_bkm = relationship("KnowledgeEntry")

class FarMitigation(Base, BaseMixin):
    __tablename__ = "far_mitigations"
    # Types: Monitoring, Workaround, Process Change
    mitigation_type = Column(String)
    mitigation_steps = Column(Text)
    responsible_team = Column(String)
    status = Column(String, default="Not Started")

    # Link to a specific Cause
    cause_id = Column(Integer, ForeignKey("far_failure_causes.id", ondelete="CASCADE"), nullable=True)

    # Durable provenance for monitoring and workaround mitigations.
    monitoring_item_id = Column(Integer, ForeignKey("monitoring_items.id", ondelete="SET NULL"), nullable=True)
    knowledge_bkm_id = Column(Integer, ForeignKey("knowledge_entries.id", ondelete="SET NULL"), nullable=True)
    external_bkm_url = Column(String, nullable=True)
    monitoring_item = relationship("MonitoringItem")
class FarPrevention(Base, BaseMixin):
    __tablename__ = "far_prevention"
    failure_mode_id = Column(Integer, ForeignKey("far_failure_modes.id", ondelete="CASCADE"))
    cause_id = Column(Integer, ForeignKey("far_failure_causes.id", ondelete="CASCADE"), nullable=True)
    prevention_action = Column(Text)
    status = Column(String, default="Open") # Open, In Progress, Verified, Completed
    target_date = Column(DateTime, nullable=True)
    responsible_team = Column(String)
    
    failure_mode = relationship("FarFailureMode", back_populates="prevention_actions")

# --- NEW INVESTIGATION MODULE (Renamed/Expanded Troubleshooting) ---

class Investigation(Base, BaseMixin):
    __tablename__ = "investigations"
    title = Column(String, index=True)
    problem_statement = Column(Text)
    category = Column(String, default="General") # General, Troubleshooting, Security, Maintenance
    research_domain = Column(String) # Added research_domain
    failure_domain = Column(String) # Added failure_domain
    
    status = Column(String, default="Analyzing") # Analyzing, Escalated, Monitoring, Resolved, Closed
    priority = Column(String, default="Medium") # Urgent, High, Medium, Low
    
    # Context
    systems = Column(JSON, default=list)
    impacted_device_ids = Column(JSON, default=list)
    assigned_team = Column(String)
    
    # Forensics & Troubleshooting Details
    impact = Column(Text)
    trigger_event = Column(Text)
    root_cause = Column(Text)
    resolution_steps = Column(Text)
    mitigation_items = Column(JSON, default=list) # List of actions taken to mitigate
    prevention_method = Column(Text)
    monitoring_items = Column(JSON, default=list) # Items to monitor after resolution
    lessons_learned = Column(Text)
    
    # Optional timing
    initiation_at = Column(DateTime, nullable=True)
    
    is_deleted = Column(Boolean, default=False)
    metadata_json = Column(JSON, default=dict)
    
    progress_logs = relationship("InvestigationProgress", back_populates="investigation", cascade="all, delete-orphan")

class InvestigationProgress(Base, BaseMixin):
    __tablename__ = "investigation_progress"
    investigation_id = Column(Integer, ForeignKey("investigations.id", ondelete="CASCADE"))
    entry_text = Column(Text)
    entry_type = Column(String, default="Update") # Update, Diagnosis, Action, Observation, Milestone
    poc = Column(String) # Point of Contact/Person who did it
    
    added_by = Column(String)
    timestamp = Column(DateTime, server_default=func.now())
    
    metadata_json = Column(JSON, default=dict) # To store links to files/images
    
    investigation = relationship("Investigation", back_populates="progress_logs")

class Project(Base, BaseMixin):
    __tablename__ = "projects"
    name = Column(String, index=True)
    description = Column(Text)
    type = Column(String) # Strategic, Tactical, Operational, Research
    status = Column(String, default="Planning") 
    priority = Column(String, default="Medium")
    start_date = Column(DateTime)
    end_date = Column(DateTime)
    owner = Column(String)
    owners = Column(JSON, default=list) # Multi-owner support
    
    jira_links = Column(JSON, default=list)
    target_systems = Column(JSON, default=list)
    target_assets = Column(JSON, default=list)
    target_services = Column(JSON, default=list)
    beneficiaries = Column(JSON, default=list)
    
    problem_statement = Column(Text)
    objective = Column(Text)
    key_functions = Column(JSON, default=list) # List of strings
    expected_outcomes = Column(JSON, default=list) # List of strings
    
    parent_project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    
    # ROI Metrics
    roi_types = Column(JSON, default=list) # List of active ROI streams
    roi_defense_line = Column(Integer, default=0) # 0, 1, 2
    roi_defense_line_desc = Column(Text)
    man_hours_saved = Column(Float, default=0.0)
    man_hours_saved_math = Column(Text)
    man_hours_saved_desc = Column(Text)
    stoploss_minutes_saved = Column(Float, default=0.0)
    stoploss_minutes_saved_math = Column(Text)
    stoploss_minutes_saved_desc = Column(Text)
    wafers_gained = Column(Float, default=0.0)
    wafers_gained_math = Column(Text)
    wafers_gained_desc = Column(Text)
    
    # Timing
    completed_at = Column(DateTime(timezone=True), nullable=True)
    
    appendix_json = Column(JSON, default=dict) # {glossary: [], images: []}
    
    team_members = Column(JSON, default=list)
    budget = Column(Float, default=0.0)
    currency = Column(String, default="USD")
    order_index = Column(Integer, default=0)

    metadata_json = Column(JSON, default=dict)
    is_deleted = Column(Boolean, default=False)

    tasks = relationship("ProjectTask", back_populates="project", cascade="all, delete-orphan")
    comments = relationship("ProjectComment", back_populates="project", cascade="all, delete-orphan")
    qa_items = relationship("ProjectQA", back_populates="project", cascade="all, delete-orphan")

class ProjectTask(Base, BaseMixin):
    __tablename__ = "project_tasks"
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"))
    parent_task_id = Column(Integer, ForeignKey("project_tasks.id", ondelete="CASCADE"), nullable=True)
    
    name = Column(String, index=True)
    description = Column(Text)
    start_date = Column(DateTime)
    end_date = Column(DateTime)
    actual_start_date = Column(DateTime, nullable=True)
    actual_end_date = Column(DateTime, nullable=True)
    progress = Column(Integer, default=0) # 0-100
    status = Column(String, default="To Do")
    owner = Column(String)
    assigned_objects = Column(JSON, default=list) # Linked assets/services
    
    dependencies_json = Column(JSON, default=list) # List of task IDs this task depends on
    estimate_hours = Column(Float, default=0.0)
    metadata_json = Column(JSON, default=dict)
    
    project = relationship("Project", back_populates="tasks")
    subtasks = relationship("ProjectTask", backref=backref("parent_task", remote_side="ProjectTask.id"), cascade="all, delete-orphan")
    comments = relationship("ProjectComment", back_populates="task", cascade="all, delete-orphan")
    qa_items = relationship("ProjectQA", back_populates="task", cascade="all, delete-orphan")

class ProjectComment(Base, BaseMixin):
    __tablename__ = "project_comments"
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"))
    task_id = Column(Integer, ForeignKey("project_tasks.id", ondelete="CASCADE"), nullable=True)
    
    author = Column(String)
    content = Column(Text)
    timestamp = Column(DateTime, server_default=func.now())
    
    project = relationship("Project", back_populates="comments")
    task = relationship("ProjectTask", back_populates="comments")

class ProjectQA(Base, BaseMixin):
    __tablename__ = "project_qa"
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"))
    task_id = Column(Integer, ForeignKey("project_tasks.id", ondelete="CASCADE"), nullable=True)
    
    question = Column(Text)
    answer = Column(Text, nullable=True)
    asked_by = Column(String)
    answered_by = Column(String, nullable=True)
    status = Column(String, default="Pending") # Pending, Answered
    
    project = relationship("Project", back_populates="qa_items")
    task = relationship("ProjectTask", back_populates="qa_items")

# --- INCIDENT RCA (ROOT CAUSE ANALYSIS) MODULE ---

class RcaRecord(Base, BaseMixin):
    __tablename__ = "rca_records"
    title = Column(String, index=True)
    problem_statement = Column(Text) # Added problem statement
    trigger_source = Column(String) # e.g. "Auto Alert", "Manual Report", "Customer Escalation"
    severity = Column(String) # Auto-calculated: P1, P2, P3, P4
    priority = Column(Integer, default=1) # 1-10 priority gauge
    severity_logic = Column(JSON, default=dict) # { flow_halted: bool, scrap_risk: bool, etc }
    initial_symptoms = Column(Text)
    
    # Timing & Ownership
    occurrence_at = Column(DateTime)
    detection_at = Column(DateTime) # Added detection_at
    acknowledged_at = Column(DateTime)
    owner = Column(String)
    owners = Column(JSON, default=list) # Added multi-owner support
    jira_link = Column(String)
    
    # Enum Classifications
    incident_type = Column(String) # Added incident_type
    detection_type = Column(String) # Added detection_type
    impact_type = Column(String) # Added impact_type
    
    # Cascading selection context
    target_system = Column(String) # Legacy field (string)
    target_systems = Column(JSON, default=list) # New multi-select field
    impacted_asset_ids = Column(JSON, default=list) # List of device IDs within that system
    impacted_service_ids = Column(JSON, default=list) # List of service IDs within those assets
    
    # FAB Impact
    fab_impact_json = Column(JSON, default=lambda: {"categories": [], "explanation": "", "severity": 1})
    
    # Investigation Flow
    identification_steps_json = Column(JSON, default=list) # [{step, text, images: []}]
    rca_steps_json = Column(JSON, default=list) # [{step, text, images: []}]
    potential_causes_json = Column(JSON, default=list) # [{cause, indicator, bkm_id, status}]
    
    narrative_summary = Column(Text) # Step-by-step narrative
    evidence_json = Column(JSON, default=list) # [{ type: 'image|log|text', content: '...', timestamp: '...' }]
    mitigation_logs_json = Column(JSON, default=list) # [{type, description, status, timestamp, images: []}]
    
    # Resolution Logic
    cause_of_failure = Column(Text)
    signature_indicator = Column(Text) # The specific log/metric that confirms the failure
    
    # External Hooks
    knowledge_id = Column(Integer, ForeignKey("knowledge_entries.id", ondelete="SET NULL"), nullable=True)
    monitoring_item_id = Column(Integer, ForeignKey("monitoring_items.id", ondelete="SET NULL"), nullable=True)
    
    status = Column(String, default="Open") # Open, Investigation, Resolved, Closed
    version = Column(Integer, default=1)
    is_deleted = Column(Boolean, default=False)
    metadata_json = Column(JSON, default=dict)

    # Relationships
    timeline = relationship("RcaTimelineEvent", back_populates="rca", cascade="all, delete-orphan")
    mitigations = relationship("RcaMitigation", back_populates="rca", cascade="all, delete-orphan")
    knowledge_bkm = relationship("KnowledgeEntry")
    monitoring_config = relationship("MonitoringItem")
    linked_failure_modes = relationship("FarFailureMode", secondary=rca_failure_mode_links, back_populates="linked_rcas")

class RcaTimelineEvent(Base, BaseMixin):
    __tablename__ = "rca_timeline_events"
    rca_id = Column(Integer, ForeignKey("rca_records.id", ondelete="CASCADE"))
    event_time = Column(DateTime)
    event_type = Column(String) # e.g. "Detection", "Mitigation", "Observation", "Resolution"
    description = Column(Text)
    owner = Column(String) # Added owner
    owner_team = Column(String) # Added owner_team
    involved_pocs = Column(JSON, default=list) # List of names/IDs
    images = Column(JSON, default=list) # Added images support
    
    rca = relationship("RcaRecord", back_populates="timeline")

class RcaMitigation(Base, BaseMixin):
    __tablename__ = "rca_mitigations"
    rca_id = Column(Integer, ForeignKey("rca_records.id", ondelete="CASCADE"))
    type = Column(String) # Preventive, Workaround, Mitigation
    action_description = Column(Text)
    status = Column(String, default="Planned") # Planned, In Progress, Verified, Completed
    
    rca = relationship("RcaRecord", back_populates="mitigations")

class RcaHistory(Base, BaseMixin):
    __tablename__ = "rca_history"
    rca_id = Column(Integer, ForeignKey("rca_records.id", ondelete="CASCADE"))
    version = Column(Integer)
    snapshot = Column(JSON) # Snapshot of fields
    change_summary = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("rca_id", "version", name="uq_rca_history_rca_version"),
    )

class EnvHistory(Base, BaseMixin):
    __tablename__ = "env_history"
    field = Column(String, index=True)
    old_value = Column(Text)
    new_value = Column(Text)
    user = Column(String)
    timestamp = Column(DateTime, server_default=func.now())

class UserPoolVersion(Base, BaseMixin):
    __tablename__ = "user_pool_versions"
    version_label = Column(String, index=True) # e.g. "v20260424_143005"
    snapshot_data = Column(JSON) # Full list of users at this point
    diff_summary = Column(JSON) # {added: [], removed: [], changed: []}
    created_by = Column(String)
    is_active = Column(Boolean, default=False)

class Team(Base, BaseMixin):
    __tablename__ = "teams"
    name = Column(String, unique=True, index=True)
    description = Column(Text, nullable=True)
    source = Column(String, default="manual") # manual, synced
    is_archived = Column(Boolean, default=False)
    metadata_json = Column(JSON, default=dict)

    operators = relationship("Operator", back_populates="team_rel")
    audits = relationship("TeamAudit", back_populates="team", cascade="all, delete-orphan")

class TeamAudit(Base, BaseMixin):
    __tablename__ = "team_audit"
    team_id = Column(Integer, ForeignKey("teams.id", ondelete="CASCADE"), nullable=True)
    action = Column(String, index=True)
    actor = Column(String)
    details = Column(JSON, default=dict)

    team = relationship("Team", back_populates="audits")

class Role(Base, BaseMixin):
    __tablename__ = "roles"
    name = Column(String, unique=True, index=True)
    permissions = Column(JSON, default=dict) # { "dashboard": "read", "rca": "edit", ... }
    operators = relationship("Operator", back_populates="role")

class Operator(Base, BaseMixin):
    __tablename__ = "operators"
    external_id = Column(String, unique=True, index=True)
    username = Column(String, index=True)
    full_name = Column(String)
    email = Column(String)
    department = Column(String)
    team = Column(String)
    teams = Column(JSON, default=list)
    team_id = Column(Integer, ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    team_source = Column(String, default="manual") # manual, synced, manual_override
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=True)
    custom_permissions = Column(JSON, default=dict) # Override role permissions
    registration_status = Column(String, default="Pending")
    is_admin = Column(Boolean, default=False)
    
    role = relationship("Role", back_populates="operators")
    team_rel = relationship("Team", back_populates="operators")

class UserPreference(Base, BaseMixin):
    __tablename__ = "user_preferences"
    __table_args__ = (
        UniqueConstraint("user_id", "key", name="uq_user_preferences_user_key"),
    )
    user_id = Column(String, index=True)
    key = Column(String, index=True)
    value = Column(Text)

class WorkspaceSavedView(Base, BaseMixin):
    """Tenant-scoped durable workspace views; transient UI state stays in user preferences."""
    __tablename__ = "workspace_saved_views"
    __table_args__ = (
        CheckConstraint("scope IN ('personal', 'team')", name="workspace_saved_view_scope"),
        CheckConstraint("revision >= 1", name="workspace_saved_view_revision_positive"),
        CheckConstraint("schema_version >= 1", name="workspace_saved_view_schema_version_positive"),
        CheckConstraint(
            "(scope = 'personal' AND team_id IS NULL) OR (scope = 'team' AND team_id IS NOT NULL)",
            name="workspace_saved_view_scope_owner_coherent",
        ),
        Index("ix_workspace_saved_views_owner_workspace", "owner_user_id", "workspace_key"),
    )
    workspace_key = Column(String(80), index=True, nullable=False)
    name = Column(String(120), nullable=False)
    scope = Column(String(16), nullable=False, default="personal")
    owner_user_id = Column(String(200), index=True, nullable=False)
    team_id = Column(Integer, ForeignKey("teams.id", ondelete="SET NULL"), nullable=True, index=True)
    definition_json = Column(JSON, nullable=False, default=dict)
    schema_version = Column(Integer, nullable=False, default=1)
    revision = Column(Integer, nullable=False, default=1)
    is_favorite = Column(Boolean, nullable=False, default=False)
    is_default = Column(Boolean, nullable=False, default=False)
