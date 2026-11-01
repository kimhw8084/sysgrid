"""Provision operational enum choices and retain values already in use."""

from alembic import op
import sqlalchemy as sa


revision = "e6b42d79f018"
down_revision = ("d43c98a72f10", "8320f53ea417")
branch_labels = None
depends_on = None


# These are the app's existing selector defaults. Retaining them in the
# reference registry keeps normal forms, imports, and settings on one contract.
REFERENCE_OPTIONS = (
    ("Status", "Planned", "Planned", "Operational lifecycle status.", []),
    ("Status", "Active", "Active", "Operational lifecycle status.", []),
    ("Status", "Maintenance", "Maintenance", "Operational lifecycle status.", []),
    ("Status", "Standby", "Standby", "Operational lifecycle status.", []),
    ("Status", "Failed", "Failed", "Operational lifecycle status.", []),
    ("Status", "Decommissioned", "Decommissioned", "Operational lifecycle status.", []),
    ("Status", "Provisioning", "Provisioning", "Operational lifecycle status.", []),
    ("Status", "Reserved", "Reserved", "Operational lifecycle status.", []),
    ("Status", "Deleted", "Deleted", "Operational lifecycle status.", []),
    ("Status", "Existing", "Existing", "Operational lifecycle status.", []),
    ("Status", "Cancelled", "Cancelled", "Operational lifecycle status.", []),
    ("Status", "Inactive", "Inactive", "Operational lifecycle status.", []),
    ("Status", "Deprecated", "Deprecated", "Operational lifecycle status.", []),
    ("Status", "Down", "Down", "Operational lifecycle status.", []),
    ("Status", "Requested", "Requested", "Operational lifecycle status.", []),
    ("Status", "Offline", "Offline", "Operational lifecycle status.", []),
    ("Environment", "Production", "Production", "Asset and service environment.", []),
    ("Environment", "Staging", "Staging", "Asset and service environment.", []),
    ("Environment", "Stage", "Stage", "Existing service environment choice.", []),
    ("Environment", "QA", "QA", "Asset and service environment.", []),
    ("Environment", "Dev", "Dev", "Asset and service environment.", []),
    ("Environment", "Development", "Development", "Existing service environment choice.", []),
    ("Environment", "DR", "DR", "Asset and service environment.", []),
    ("Environment", "Lab", "Lab", "Asset and service environment.", []),
    ("Environment", "Sandbox", "Sandbox", "Asset and service environment.", []),
    ("Environment", "Legacy", "Legacy", "Asset and service environment.", []),
    ("DeviceType", "Physical", "Physical", "Asset device type.", []),
    ("DeviceType", "Virtual", "Virtual", "Asset device type.", []),
    ("DeviceType", "Storage", "Storage", "Asset device type.", []),
    ("DeviceType", "Switch", "Switch", "Asset device type.", []),
    ("DeviceType", "Firewall", "Firewall", "Asset device type.", []),
    ("DeviceType", "Load Balancer", "Load Balancer", "Asset device type.", []),
    ("DeviceType", "PDU", "PDU", "Asset device type.", []),
    ("DeviceType", "UPS", "UPS", "Asset device type.", []),
    ("DeviceType", "Console-Server", "Console-Server", "Asset device type.", []),
    ("DeviceType", "Patch Panel", "Patch Panel", "Asset device type.", []),
    ("ServiceType", "Database", "Database", "Logical service type.", ["engine", "instance_name", "port", "sid", "collation", "always_on", "data_path", "backup_policy"]),
    ("ServiceType", "Application", "Application", "Logical service type.", []),
    ("ServiceType", "OS", "OS", "Logical service type.", []),
    ("ServiceType", "Middleware", "Middleware", "Logical service type.", []),
    ("ServiceType", "API", "API", "Logical service type.", []),
    ("RiskCategory", "Design", "Design", "FAR failure classification.", []),
    ("RiskCategory", "Process", "Process", "FAR failure classification.", []),
    ("RiskCategory", "Hardware", "Hardware", "FAR failure classification.", []),
    ("RiskCategory", "Software", "Software", "FAR failure classification.", []),
    ("RiskCategory", "Network", "Network", "FAR failure classification.", []),
    ("RiskCategory", "Human", "Human", "FAR failure classification.", []),
    ("RiskCategory", "Environment", "Environment", "FAR failure classification.", []),
    ("ExternalType", "Equipment", "Equipment", "External entity type.", ["manufacturer", "model", "serial_number"]),
    ("ExternalType", "Physical Server", "Physical Server", "External entity type.", ["rack_id", "unit_position", "os"]),
    ("ExternalType", "Virtual Server", "Virtual Server", "External entity type.", ["hypervisor", "vcpu", "vram", "os"]),
    ("ExternalType", "Switch", "Switch", "External entity type.", ["management_url", "ports", "firmware"]),
    ("ExternalType", "DB", "DB", "External entity type.", ["engine", "instance_name"]),
    ("ExternalType", "API", "API", "External entity type.", ["version"]),
    ("ExternalType", "Script", "Script", "External entity type.", ["runtime", "path", "schedule"]),
    ("LinkPurpose", "Data", "Data", "Network connection type.", []),
    ("LinkPurpose", "Management", "Management", "Network connection type.", []),
    ("LinkPurpose", "Storage", "Storage", "Network connection type.", []),
    ("LinkPurpose", "Backup", "Backup", "Network connection type.", []),
    ("LinkPurpose", "Control", "Control", "Network connection type.", []),
    ("LinkPurpose", "Voice", "Voice", "Network connection type.", []),
    ("LinkPurpose", "Production", "Production", "Retained link type used by existing network records.", []),
    ("LinkPurpose", "Loopback", "Loopback", "Supported link type for local and test-network connections.", []),
    ("LinkPurpose", "SearchLink", "SearchLink", "Supported link type for indexed service traffic.", []),
    ("NetworkFarm", "Prod", "Prod", "Network farm selector default.", []),
    ("NetworkFarm", "Stage", "Stage", "Network farm selector default.", []),
    ("NetworkFarm", "Lab", "Lab", "Network farm selector default.", []),
    ("NetworkCableType", "Fiber", "Fiber", "Network cable selector default.", []),
    ("NetworkCableType", "Copper", "Copper", "Network cable selector default.", []),
    ("NetworkCableType", "Cat6", "Cat6", "Network cable selector default.", []),
    ("NetworkCableType", "DAC", "DAC", "Network cable selector default.", []),
    ("NetworkCableType", "AOC", "AOC", "Network cable selector default.", []),
    ("VendorCountry", "South Korea", "South Korea", "Vendor region selector default.", []),
    ("VendorCountry", "USA", "USA", "Vendor region selector default.", []),
    ("VendorDeviceType", "PC", "PC", "Vendor personnel device type.", []),
    ("VendorDeviceType", "VDI", "VDI", "Vendor personnel device type.", []),
    ("VendorDeviceType", "Laptop", "Laptop", "Vendor personnel device type.", []),
    ("VendorDeviceType", "Workstation", "Workstation", "Vendor personnel device type.", []),
)

# If a tenant already has values outside the canonical selectors, publish each
# as a removable (while unused) option so stricter enum validation does not
# make existing rows impossible to edit or re-import.
EXISTING_VALUE_COLUMNS = (
    ("devices", "status", "Status"),
    ("logical_services", "status", "Status"),
    ("maintenance_windows", "status", "Status"),
    ("external_entities", "status", "Status"),
    ("devices", "environment", "Environment"),
    ("logical_services", "environment", "Environment"),
    ("external_entities", "environment", "Environment"),
    ("devices", "type", "DeviceType"),
    ("logical_services", "service_type", "ServiceType"),
    ("external_entities", "type", "ExternalType"),
    ("port_connections", "link_type", "LinkPurpose"),
    ("port_connections", "farm", "NetworkFarm"),
    ("port_connections", "cable_type", "NetworkCableType"),
    ("vendors", "country", "VendorCountry"),
    ("monitoring_items", "status", "Status"),
    ("monitoring_items", "category", "MonitoringCategory"),
    ("monitoring_items", "platform", "MonitoringPlatform"),
    ("monitoring_items", "severity", "MonitoringSeverity"),
    ("monitoring_items", "notification_method", "NotificationMethod"),
    ("devices", "system", "LogicalSystem"),
    ("far_failure_modes", "system_name", "LogicalSystem"),
    ("far_failure_modes", "failure_type", "RiskCategory"),
    ("devices", "business_unit", "BusinessUnit"),
)


def _value_options_table():
    return sa.table(
        "settings_options",
        sa.column("category", sa.String),
        sa.column("label", sa.String),
        sa.column("value", sa.String),
        sa.column("description", sa.String),
        sa.column("metadata_keys", sa.JSON),
        sa.column("is_default", sa.Boolean),
    )


def _next_label(value: str, category: str, used_labels: set[tuple[str, str]]) -> str:
    label = value
    suffix = 2
    while (category, label) in used_labels:
        label = f"{value} (existing {suffix})"
        suffix += 1
    return label


def upgrade() -> None:
    connection = op.get_bind()
    options = _value_options_table()
    existing_rows = connection.execute(
        sa.select(options.c.category, options.c.label, options.c.value, options.c.is_default)
    ).all()
    existing_by_value = {(row.category, row.value): row for row in existing_rows}
    used_labels = {(row.category, row.label) for row in existing_rows}

    for category, label, value, description, metadata_keys in REFERENCE_OPTIONS:
        existing = existing_by_value.get((category, value))
        if existing is not None:
            if not existing.is_default:
                connection.execute(
                    options.update().where(
                        options.c.category == category,
                        options.c.value == value,
                    ).values(is_default=True)
                )
            continue
        label = _next_label(label, category, used_labels)
        connection.execute(options.insert().values(
            category=category,
            label=label,
            value=value,
            description=description,
            metadata_keys=metadata_keys,
            is_default=True,
        ))
        existing_by_value[(category, value)] = True
        used_labels.add((category, label))

    existing_values = {(row.category, row.value) for row in connection.execute(
        sa.select(options.c.category, options.c.value)
    ).all()}

    for table_name, column_name, category in EXISTING_VALUE_COLUMNS:
        source = sa.table(table_name, sa.column(column_name, sa.String))
        for (value,) in connection.execute(sa.select(sa.distinct(source.c[column_name]))).all():
            if value is None:
                continue
            value = str(value)
            if not value.strip() or (category, value) in existing_values:
                continue
            label = _next_label(value, category, used_labels)
            connection.execute(options.insert().values(
                category=category,
                label=label,
                value=value,
                description="Existing database value retained during enum setup.",
                metadata_keys=[],
                is_default=False,
            ))
            existing_values.add((category, value))
            used_labels.add((category, label))

    contracts = sa.table("vendor_contracts", sa.column("covered_systems", sa.JSON))
    covered_systems = connection.execute(sa.select(contracts.c.covered_systems)).all()
    for (systems,) in covered_systems:
        for value in systems if isinstance(systems, list) else []:
            if not isinstance(value, str) or not value.strip() or ("LogicalSystem", value) in existing_values:
                continue
            label = _next_label(value, "LogicalSystem", used_labels)
            connection.execute(options.insert().values(
                category="LogicalSystem",
                label=label,
                value=value,
                description="Existing vendor contract system reference.",
                metadata_keys=[],
                is_default=False,
            ))
            existing_values.add(("LogicalSystem", value))
            used_labels.add(("LogicalSystem", label))

    personnel = sa.table("vendor_personnel", sa.column("pcs", sa.JSON))
    vendor_types = connection.execute(sa.select(personnel.c.pcs)).all()
    for (pcs,) in vendor_types:
        for pc in (pcs if isinstance(pcs, list) else []):
            value = pc.get("type") if isinstance(pc, dict) else None
            if not isinstance(value, str) or not value.strip() or ("VendorDeviceType", value) in existing_values:
                continue
            label = _next_label(value, "VendorDeviceType", used_labels)
            connection.execute(options.insert().values(
                category="VendorDeviceType",
                label=label,
                value=value,
                description="Existing vendor personnel device type.",
                metadata_keys=[],
                is_default=False,
            ))
            existing_values.add(("VendorDeviceType", value))
            used_labels.add(("VendorDeviceType", label))


def downgrade() -> None:
    # Keep reference values because user data and imports may depend on them.
    pass
