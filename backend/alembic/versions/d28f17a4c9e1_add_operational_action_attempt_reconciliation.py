"""Add durable operational action attempt ownership and reconciliation."""

from alembic import op
import sqlalchemy as sa


revision = "d28f17a4c9e1"
down_revision = "c17a9e5b2f01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "operational_action_attempts",
        sa.Column("id", sa.String(length=80), nullable=False),
        sa.Column("action_id", sa.String(length=80), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("actor_id", sa.String(length=200), nullable=False),
        sa.Column("phase", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("request_id", sa.String(length=128), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=True),
        sa.Column("progress_percent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("progress_message", sa.String(length=500), nullable=True),
        sa.Column("result", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["action_id"], ["operational_actions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_operational_action_attempts_tenant_id", "operational_action_attempts", ["tenant_id"])
    op.create_index(
        "ix_operational_action_attempts_tenant_action",
        "operational_action_attempts",
        ["tenant_id", "action_id"],
    )
    op.create_index(
        "ix_operational_action_attempts_action_phase",
        "operational_action_attempts",
        ["action_id", "phase"],
    )
    op.create_index("ix_operational_action_attempts_status", "operational_action_attempts", ["status"])
    op.add_column(
        "operational_actions",
        sa.Column("execution_attempt_id", sa.String(length=80), nullable=True),
    )
    op.add_column(
        "operational_actions",
        sa.Column("rollback_attempt_id", sa.String(length=80), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("operational_actions", "rollback_attempt_id")
    op.drop_column("operational_actions", "execution_attempt_id")
    op.drop_index("ix_operational_action_attempts_status", table_name="operational_action_attempts")
    op.drop_index("ix_operational_action_attempts_action_phase", table_name="operational_action_attempts")
    op.drop_index("ix_operational_action_attempts_tenant_action", table_name="operational_action_attempts")
    op.drop_index("ix_operational_action_attempts_tenant_id", table_name="operational_action_attempts")
    op.drop_table("operational_action_attempts")
