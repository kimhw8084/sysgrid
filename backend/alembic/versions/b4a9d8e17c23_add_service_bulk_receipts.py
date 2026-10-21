"""Retain Service batch replay protection and server-owned compensation state."""
from alembic import op
import sqlalchemy as sa

revision = "b4a9d8e17c23"
down_revision = "f6c2a9d4e8b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "service_bulk_receipts",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("actor_id", sa.String(200), nullable=False),
        sa.Column("operation_id", sa.String(32), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("before_state", sa.JSON(), nullable=False),
        sa.Column("post_state", sa.JSON(), nullable=False),
        sa.Column("projection_state", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("undo_result", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("reverted_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("tenant_id", "actor_id", "operation_id", name="uq_service_bulk_receipts_operation"),
    )
    op.create_index("ix_service_bulk_receipts_tenant_created", "service_bulk_receipts", ["tenant_id", "created_at"])


def downgrade() -> None:
    receipts = sa.table("service_bulk_receipts", sa.column("id", sa.String(32)))
    if op.get_bind().execute(sa.select(receipts.c.id).limit(1)).first() is not None:
        raise RuntimeError("Service command history exists; use a reviewed recovery plan instead of discarding replay protection.")
    op.drop_index("ix_service_bulk_receipts_tenant_created", table_name="service_bulk_receipts")
    op.drop_table("service_bulk_receipts")
