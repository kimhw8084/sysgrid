"""Preserve maintenance cancellations and deduplicate window creation."""

from alembic import op
import sqlalchemy as sa

revision = "e39a28b5d0f2"
down_revision = "c9f2a1e8d7b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("maintenance_windows", sa.Column("creation_key_hash", sa.String(64), nullable=True))
    op.add_column("maintenance_windows", sa.Column("creation_request_hash", sa.String(64), nullable=True))
    op.add_column("maintenance_windows", sa.Column("cancelled_at", sa.DateTime(), nullable=True))
    op.add_column("maintenance_windows", sa.Column("cancelled_by", sa.String(200), nullable=True))
    op.add_column("maintenance_windows", sa.Column("cancellation_reason", sa.String(2000), nullable=True))
    op.create_index("uq_maintenance_creation_key", "maintenance_windows", ["creation_key_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_maintenance_creation_key", table_name="maintenance_windows")
    for name in ("cancellation_reason", "cancelled_by", "cancelled_at", "creation_request_hash", "creation_key_hash"):
        op.drop_column("maintenance_windows", name)
