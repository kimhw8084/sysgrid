"""Provision application-owned option values in every tenant database.

These values are required configuration, not demo records. The migration is
additive and leaves existing option labels, descriptions, and data untouched.
"""

from alembic import op
import sqlalchemy as sa


revision = "d43c98a72f10"
down_revision = "b760f1d294a3"
branch_labels = None
depends_on = None


REFERENCE_OPTIONS = (
    ("MonitoringSeverity", "Critical", "Critical", "Immediate operator attention is required."),
    ("MonitoringSeverity", "Warning", "Warning", "Degraded or at-risk behavior requires review."),
    ("MonitoringSeverity", "Info", "Info", "Informational monitoring signal."),
    ("MonitoringOwnerRole", "Primary Support", "Primary Support", "Primary operational owner."),
    ("MonitoringOwnerRole", "Escalation", "Escalation", "Escalation owner for unresolved events."),
    ("MonitoringOwnerRole", "Observer", "Observer", "Read-only monitoring stakeholder."),
    ("MonitoringPlatform", "Zabbix", "Zabbix", "Zabbix monitoring platform."),
    ("MonitoringPlatform", "Prometheus", "Prometheus", "Prometheus monitoring platform."),
    ("MonitoringPlatform", "Datadog", "Datadog", "Datadog monitoring platform."),
    ("MonitoringCategory", "Hardware", "Hardware", "Physical hardware and component monitoring."),
    ("MonitoringCategory", "Log", "Log", "Log-derived monitoring."),
    ("MonitoringCategory", "Network", "Network", "Network path and interface monitoring."),
    ("MonitoringCategory", "App", "App", "Application monitoring."),
    ("MonitoringCategory", "Synthetic", "Synthetic", "Synthetic transaction monitoring."),
    ("NotificationMethod", "Email", "Email", "Email notification delivery."),
    ("NotificationMethod", "Slack", "Slack", "Slack notification delivery."),
    ("NotificationMethod", "PagerDuty", "PagerDuty", "PagerDuty notification delivery."),
)


def upgrade() -> None:
    connection = op.get_bind()
    options = sa.table(
        "settings_options",
        sa.column("category", sa.String),
        sa.column("label", sa.String),
        sa.column("value", sa.String),
        sa.column("description", sa.String),
        sa.column("metadata_keys", sa.JSON),
        sa.column("is_default", sa.Boolean),
    )
    categories = sorted({category for category, _, _, _ in REFERENCE_OPTIONS})
    existing_rows = connection.execute(
        sa.select(options.c.category, options.c.label, options.c.value).where(
            options.c.category.in_(categories)
        )
    ).all()
    existing_values = {(row.category, row.value) for row in existing_rows}
    existing_labels = {(row.category, row.label) for row in existing_rows}

    for category, label, value, description in REFERENCE_OPTIONS:
        if (category, value) in existing_values:
            continue
        if (category, label) in existing_labels:
            raise RuntimeError(
                f"Code-managed option conflicts with existing label: {category}:{label}"
            )
        connection.execute(
            options.insert().values(
                category=category,
                label=label,
                value=value,
                description=description,
                metadata_keys=[],
                is_default=False,
            )
        )
        existing_values.add((category, value))
        existing_labels.add((category, label))


def downgrade() -> None:
    # Keep reference values on downgrade because records may already use them.
    pass
