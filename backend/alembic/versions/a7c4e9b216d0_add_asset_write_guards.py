"""Add Asset revisions and replay protection without rebuilding the parent table."""
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision = 'a7c4e9b216d0'
down_revision = 'b4a9d8e17c23'
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    # SQLite's constant default allows an additive NOT NULL column. Avoid a
    # parent-table rebuild: devices has cascading historical dependants.
    op.add_column('devices', sa.Column('edit_revision', sa.String(32), nullable=False, server_default=''))
    table = sa.table('devices', sa.column('id', sa.Integer), sa.column('edit_revision', sa.String(32)))
    rows = connection.execute(sa.select(table.c.id))
    while batch := rows.fetchmany(1000):
        connection.execute(table.update().where(table.c.id == sa.bindparam('record_id')).values(edit_revision=sa.bindparam('revision_value')),
            [{'record_id': row.id, 'revision_value': uuid4().hex} for row in batch])
    if connection.dialect.name == 'sqlite':
        op.execute("CREATE TRIGGER devices_revision_insert AFTER INSERT ON devices WHEN NEW.edit_revision = '' BEGIN UPDATE devices SET edit_revision = lower(hex(randomblob(16))) WHERE id = NEW.id; END")
        op.execute("CREATE TRIGGER devices_revision_update AFTER UPDATE ON devices WHEN NEW.edit_revision = OLD.edit_revision BEGIN UPDATE devices SET edit_revision = lower(hex(randomblob(16))) WHERE id = NEW.id; END")
    op.create_table('asset_write_receipts',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('tenant_id', sa.Integer(), nullable=False),
        sa.Column('actor_id', sa.String(200), nullable=False),
        sa.Column('operation_id', sa.String(32), nullable=False),
        sa.Column('request_hash', sa.String(64), nullable=False),
        sa.Column('schema_version', sa.Integer(), nullable=False),
        sa.Column('before_state', sa.JSON(), nullable=False),
        sa.Column('post_state', sa.JSON(), nullable=False),
        sa.Column('projection_state', sa.JSON(), nullable=False),
        sa.Column('undo_state', sa.JSON(), nullable=False),
        sa.Column('result', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('tenant_id', 'actor_id', 'operation_id', name='uq_asset_write_receipts_operation'))
    op.create_index('ix_asset_write_receipts_tenant_created', 'asset_write_receipts', ['tenant_id', 'created_at'])


def downgrade() -> None:
    raise RuntimeError('Asset revision and command history must be preserved; use the reviewed recovery procedure instead of a destructive downgrade.')
