"""Add the tenant-scoped operational action orchestration foundation."""

from alembic import op
import sqlalchemy as sa


revision = "c17a9e5b2f01"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "operational_actions",
        sa.Column("id", sa.String(length=80), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("actor_id", sa.String(length=200), nullable=False),
        sa.Column("action_key", sa.String(length=120), nullable=False),
        sa.Column("capability_key", sa.String(length=120), nullable=False),
        sa.Column("adapter_id", sa.String(length=120), nullable=False),
        sa.Column("adapter_capability", sa.String(length=120), nullable=False),
        sa.Column("normalized_parameters", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("parameters_hash", sa.String(length=64), nullable=False),
        sa.Column("target_set_hash", sa.String(length=64), nullable=True),
        sa.Column("risk_tier", sa.String(length=32), nullable=False),
        sa.Column("risk_facts", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("precondition_snapshot", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("precondition_hash", sa.String(length=64), nullable=True),
        sa.Column("preview_token", sa.String(length=64), nullable=True),
        sa.Column("preview_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("authorization_facts", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("approval_facts", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("recovery_facts", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("confirmation_facts", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("rollback_plan", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("execution_result", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("verification_summary", sa.Text(), nullable=True),
        sa.Column("verification_evidence", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("rollback_outcome", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("idempotency_key", sa.String(length=200), nullable=False),
        sa.Column("request_id", sa.String(length=128), nullable=False),
        sa.Column("maintenance_window_id", sa.Integer(), nullable=True),
        sa.Column("change_context", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("progress_percent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("progress_message", sa.String(length=500), nullable=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("previewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("authorized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rolled_back_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["maintenance_window_id"], ["maintenance_windows.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "actor_id", "idempotency_key", name="uq_operational_actions_idempotency"),
    )
    op.create_index("ix_operational_actions_tenant_id", "operational_actions", ["tenant_id"])
    op.create_index("ix_operational_actions_actor_id", "operational_actions", ["actor_id"])
    op.create_index("ix_operational_actions_action_key", "operational_actions", ["action_key"])
    op.create_index("ix_operational_actions_capability_key", "operational_actions", ["capability_key"])
    op.create_index("ix_operational_actions_status", "operational_actions", ["status"])
    op.create_index("ix_operational_actions_tenant_status", "operational_actions", ["tenant_id", "status"])
    op.create_index("ix_operational_actions_tenant_created", "operational_actions", ["tenant_id", "created_at"])

    op.create_table(
        "operational_action_targets",
        sa.Column("id", sa.String(length=80), nullable=False),
        sa.Column("action_id", sa.String(length=80), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("target_revision", sa.String(length=64), nullable=False),
        sa.Column("target_snapshot", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["action_id"], ["operational_actions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("action_id", "device_id", name="uq_operational_action_target_device"),
    )
    op.create_index("ix_operational_action_targets_tenant_id", "operational_action_targets", ["tenant_id"])
    op.create_index("ix_operational_action_targets_device_id", "operational_action_targets", ["device_id"])
    op.create_index("ix_operational_action_targets_tenant_device", "operational_action_targets", ["tenant_id", "device_id"])

    op.create_table(
        "operational_action_events",
        sa.Column("id", sa.String(length=80), nullable=False),
        sa.Column("action_id", sa.String(length=80), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=48), nullable=False),
        sa.Column("from_status", sa.String(length=32), nullable=True),
        sa.Column("to_status", sa.String(length=32), nullable=False),
        sa.Column("actor_id", sa.String(length=200), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["action_id"], ["operational_actions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("action_id", "sequence", name="uq_operational_action_event_sequence"),
    )
    op.create_index("ix_operational_action_events_tenant_id", "operational_action_events", ["tenant_id"])
    op.create_index("ix_operational_action_events_tenant_action", "operational_action_events", ["tenant_id", "action_id"])

    op.create_table(
        "operational_action_evidence",
        sa.Column("id", sa.String(length=80), nullable=False),
        sa.Column("action_id", sa.String(length=80), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("evidence_type", sa.String(length=48), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("reference", sa.String(length=500), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("recorded_by", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["action_id"], ["operational_actions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_operational_action_evidence_tenant_id", "operational_action_evidence", ["tenant_id"])
    op.create_index("ix_operational_action_evidence_tenant_action", "operational_action_evidence", ["tenant_id", "action_id"])


def downgrade() -> None:
    op.drop_index("ix_operational_action_evidence_tenant_action", table_name="operational_action_evidence")
    op.drop_index("ix_operational_action_evidence_tenant_id", table_name="operational_action_evidence")
    op.drop_table("operational_action_evidence")
    op.drop_index("ix_operational_action_events_tenant_action", table_name="operational_action_events")
    op.drop_index("ix_operational_action_events_tenant_id", table_name="operational_action_events")
    op.drop_table("operational_action_events")
    op.drop_index("ix_operational_action_targets_tenant_device", table_name="operational_action_targets")
    op.drop_index("ix_operational_action_targets_device_id", table_name="operational_action_targets")
    op.drop_index("ix_operational_action_targets_tenant_id", table_name="operational_action_targets")
    op.drop_table("operational_action_targets")
    op.drop_index("ix_operational_actions_tenant_created", table_name="operational_actions")
    op.drop_index("ix_operational_actions_tenant_status", table_name="operational_actions")
    op.drop_index("ix_operational_actions_status", table_name="operational_actions")
    op.drop_index("ix_operational_actions_capability_key", table_name="operational_actions")
    op.drop_index("ix_operational_actions_action_key", table_name="operational_actions")
    op.drop_index("ix_operational_actions_actor_id", table_name="operational_actions")
    op.drop_index("ix_operational_actions_tenant_id", table_name="operational_actions")
    op.drop_table("operational_actions")

