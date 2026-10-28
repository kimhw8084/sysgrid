"""Add revision tokens to External and Vendors records."""
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision = "b760f1d294a3"
down_revision = "a7c4e9b216d0"
branch_labels = None
depends_on = None

TABLES = ("external_entities", "external_links", "vendors", "vendor_personnel", "vendor_contracts")


def upgrade() -> None:
    connection = op.get_bind()
    for table_name in TABLES:
        op.add_column(table_name, sa.Column("edit_revision", sa.String(32), nullable=False, server_default=""))
        table = sa.table(table_name, sa.column("id", sa.Integer), sa.column("edit_revision", sa.String(32)))
        rows = connection.execute(sa.select(table.c.id))
        while batch := rows.fetchmany(1000):
            connection.execute(
                table.update()
                .where(table.c.id == sa.bindparam("record_id"))
                .values(edit_revision=sa.bindparam("revision_value")),
                [{"record_id": row.id, "revision_value": uuid4().hex} for row in batch],
            )
        if connection.dialect.name == "sqlite":
            op.execute(
                f"CREATE TRIGGER IF NOT EXISTS {table_name}_revision_insert "
                f"AFTER INSERT ON {table_name} WHEN NEW.edit_revision = '' BEGIN "
                f"UPDATE {table_name} SET edit_revision = lower(hex(randomblob(16))) WHERE id = NEW.id; END"
            )
            op.execute(
                f"CREATE TRIGGER IF NOT EXISTS {table_name}_revision_update "
                f"AFTER UPDATE ON {table_name} WHEN NEW.edit_revision = OLD.edit_revision BEGIN "
                f"UPDATE {table_name} SET edit_revision = lower(hex(randomblob(16))) WHERE id = NEW.id; END"
            )
    if connection.dialect.name == "postgresql":
        op.execute("""
            CREATE OR REPLACE FUNCTION sysgrid_external_vendor_revision_guard()
            RETURNS TRIGGER AS $sysgrid$
            BEGIN
                IF TG_OP = 'INSERT' THEN
                    IF NEW.edit_revision IS NULL OR NEW.edit_revision = '' THEN
                        NEW.edit_revision := md5(random()::text || clock_timestamp()::text || NEW.id::text);
                    END IF;
                ELSIF NEW.edit_revision IS NULL OR NEW.edit_revision = ''
                      OR NEW.edit_revision IS NOT DISTINCT FROM OLD.edit_revision THEN
                    NEW.edit_revision := md5(random()::text || clock_timestamp()::text || NEW.id::text);
                END IF;
                RETURN NEW;
            END;
            $sysgrid$ LANGUAGE plpgsql
        """)
        for table_name in TABLES:
            op.execute(
                f"CREATE TRIGGER {table_name}_revision_guard "
                f"BEFORE INSERT OR UPDATE ON {table_name} "
                "FOR EACH ROW EXECUTE FUNCTION sysgrid_external_vendor_revision_guard()"
            )
    op.create_table(
        "module_bulk_receipts",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("module", sa.String(24), nullable=False),
        sa.Column("target", sa.String(32), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("actor_id", sa.String(200), nullable=False),
        sa.Column("operation_id", sa.String(32), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("before_state", sa.JSON(), nullable=False),
        sa.Column("post_state", sa.JSON(), nullable=False),
        sa.Column("undo_result", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("reverted_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("module", "tenant_id", "actor_id", "operation_id", name="uq_module_bulk_receipts_operation"),
    )
    op.create_index(
        "ix_module_bulk_receipts_module_tenant_created",
        "module_bulk_receipts",
        ["module", "tenant_id", "created_at"],
    )
def downgrade() -> None:
    raise RuntimeError("External and vendor revision history must be preserved; use the reviewed recovery procedure instead of a destructive downgrade.")
