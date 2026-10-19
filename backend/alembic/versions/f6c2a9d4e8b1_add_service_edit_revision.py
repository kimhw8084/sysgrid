"""Add server-owned Service revisions without changing business versions or history."""
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision = "f6c2a9d4e8b1"
down_revision = "d4a7b2c8e1f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    op.add_column("logical_services", sa.Column("edit_revision", sa.String(32), nullable=True))
    table = sa.table("logical_services", sa.column("id", sa.Integer), sa.column("edit_revision", sa.String(32)))
    rows = connection.execute(sa.select(table.c.id))
    while batch := rows.fetchmany(1000):
        connection.execute(
            table.update().where(table.c.id == sa.bindparam("record_id")).values(edit_revision=sa.bindparam("revision_value")),
            [{"record_id": row.id, "revision_value": uuid4().hex} for row in batch],
        )
    with op.batch_alter_table("logical_services") as batch:
        batch.alter_column("edit_revision", existing_type=sa.String(32), nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("logical_services") as batch:
        batch.drop_column("edit_revision")
