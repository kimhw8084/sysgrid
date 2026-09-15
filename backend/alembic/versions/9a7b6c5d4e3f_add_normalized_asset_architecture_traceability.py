"""Add normalized Device, Architecture v2, and PV1 traceability.

The existing project ArchitectureAssociation JSON selections are retained as
compatibility projections. Valid object selections are copied to normalized
Project links; invalid selections are recorded without changing the source
JSON so an operator can reconcile them explicitly.
"""

import hashlib
import json

from alembic import op
import sqlalchemy as sa


revision = "9a7b6c5d4e3f"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def _stable_id(prefix: str, *values: object) -> str:
    digest = hashlib.sha256("\x1f".join(str(value) for value in values).encode("utf-8")).hexdigest()
    return f"{prefix}-{digest[:64]}"


def _list_value(value: object) -> list[object] | None:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except (TypeError, ValueError):
            return None
        return decoded if isinstance(decoded, list) else None
    return None


def _source_value(value: object) -> str:
    if isinstance(value, str):
        return value.strip()[:160]
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"))[:160]
    except (TypeError, ValueError):
        return str(value)[:160]


def upgrade() -> None:
    op.create_table(
        "pv1_architecture_device_links",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), sa.ForeignKey("devices.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("architecture_object_id", sa.String(80), sa.ForeignKey("pv1_architecture_objects.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("relationship_type", sa.String(40), nullable=False, server_default="Represents"),
        sa.Column("lifecycle", sa.String(24), nullable=False, server_default="Active"),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", sa.String(200), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_by", sa.String(200), nullable=False),
        sa.UniqueConstraint("tenant_id", "device_id", "architecture_object_id", name="uq_pv1_arch_device_link_target"),
        sa.CheckConstraint("revision >= 1", name="pv1_arch_device_link_revision_positive"),
        sa.CheckConstraint("lifecycle IN ('Active', 'Retired')", name="pv1_arch_device_link_lifecycle"),
    )
    op.create_index("ix_pv1_architecture_device_links_tenant_id", "pv1_architecture_device_links", ["tenant_id"])
    op.create_index("ix_pv1_arch_device_links_device", "pv1_architecture_device_links", ["tenant_id", "device_id", "lifecycle"])
    op.create_index("ix_pv1_arch_device_links_object", "pv1_architecture_device_links", ["tenant_id", "architecture_object_id", "lifecycle"])

    op.create_table(
        "pv1_traceability_links",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("entity_kind", sa.String(32), nullable=False),
        sa.Column("entity_id", sa.String(80), nullable=False),
        sa.Column("project_id", sa.String(80), sa.ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=True),
        sa.Column("target_kind", sa.String(32), nullable=False),
        sa.Column("target_key", sa.String(80), nullable=False),
        sa.Column("device_id", sa.Integer(), sa.ForeignKey("devices.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("architecture_object_id", sa.String(80), sa.ForeignKey("pv1_architecture_objects.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("relationship_type", sa.String(40), nullable=False, server_default="Affected"),
        sa.Column("lifecycle", sa.String(24), nullable=False, server_default="Active"),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", sa.String(200), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_by", sa.String(200), nullable=False),
        sa.UniqueConstraint("tenant_id", "entity_kind", "entity_id", "target_kind", "target_key", "relationship_type", name="uq_pv1_traceability_link_target"),
        sa.CheckConstraint("revision >= 1", name="pv1_traceability_link_revision_positive"),
        sa.CheckConstraint("lifecycle IN ('Active', 'Retired')", name="pv1_traceability_link_lifecycle"),
        sa.CheckConstraint("target_kind IN ('device', 'architecture_object')", name="pv1_traceability_link_target_kind"),
        sa.CheckConstraint("(target_kind = 'device' AND device_id IS NOT NULL AND architecture_object_id IS NULL) OR (target_kind = 'architecture_object' AND device_id IS NULL AND architecture_object_id IS NOT NULL)", name="pv1_traceability_link_one_target"),
    )
    op.create_index("ix_pv1_traceability_links_tenant_id", "pv1_traceability_links", ["tenant_id"])
    op.create_index("ix_pv1_traceability_links_entity", "pv1_traceability_links", ["tenant_id", "entity_kind", "entity_id", "lifecycle"])
    op.create_index("ix_pv1_traceability_links_project", "pv1_traceability_links", ["tenant_id", "project_id", "lifecycle"])
    op.create_index("ix_pv1_traceability_links_device", "pv1_traceability_links", ["tenant_id", "device_id", "lifecycle"])
    op.create_index("ix_pv1_traceability_links_object", "pv1_traceability_links", ["tenant_id", "architecture_object_id", "lifecycle"])

    op.create_table(
        "pv1_traceability_backfill_issues",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("association_id", sa.String(80), sa.ForeignKey("pv1_project_architecture_associations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("project_id", sa.String(80), nullable=True),
        sa.Column("model_id", sa.String(80), nullable=True),
        sa.Column("source_field", sa.String(32), nullable=False),
        sa.Column("source_value", sa.String(160), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("source_snapshot", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "association_id", "source_field", "source_value", name="uq_pv1_traceability_backfill_issue"),
    )
    op.create_index("ix_pv1_traceability_backfill_issues_tenant_id", "pv1_traceability_backfill_issues", ["tenant_id"])
    op.create_index("ix_pv1_traceability_backfill_issues_tenant", "pv1_traceability_backfill_issues", ["tenant_id", "association_id"])

    bind = op.get_bind()
    associations = sa.table(
        "pv1_project_architecture_associations",
        sa.column("id", sa.String(80)),
        sa.column("tenant_id", sa.Integer()),
        sa.column("project_id", sa.String(80)),
        sa.column("model_id", sa.String(80)),
        # Read legacy JSON as text so a malformed historical value can be
        # recorded in the issue ledger instead of aborting the migration
        # during SQLAlchemy's JSON deserialization.
        sa.column("object_ids", sa.Text()),
        sa.column("relation_ids", sa.Text()),
    )
    projects = sa.table("pv1_projects", sa.column("id", sa.String(80)), sa.column("tenant_id", sa.Integer()))
    objects = sa.table("pv1_architecture_objects", sa.column("id", sa.String(80)), sa.column("tenant_id", sa.Integer()), sa.column("model_id", sa.String(80)), sa.column("retired_at", sa.DateTime()))
    links = sa.table(
        "pv1_traceability_links",
        sa.column("id", sa.String(80)), sa.column("tenant_id", sa.Integer()), sa.column("entity_kind", sa.String(32)), sa.column("entity_id", sa.String(80)), sa.column("project_id", sa.String(80)), sa.column("target_kind", sa.String(32)), sa.column("target_key", sa.String(80)), sa.column("architecture_object_id", sa.String(80)), sa.column("relationship_type", sa.String(40)), sa.column("lifecycle", sa.String(24)), sa.column("revision", sa.Integer()), sa.column("created_by", sa.String(200)), sa.column("updated_by", sa.String(200)),
    )
    issues = sa.table(
        "pv1_traceability_backfill_issues",
        sa.column("id", sa.String(80)), sa.column("tenant_id", sa.Integer()), sa.column("association_id", sa.String(80)), sa.column("project_id", sa.String(80)), sa.column("model_id", sa.String(80)), sa.column("source_field", sa.String(32)), sa.column("source_value", sa.String(160)), sa.column("reason", sa.Text()), sa.column("source_snapshot", sa.JSON()),
    )
    for row in bind.execute(sa.select(associations)).mappings():
        snapshot = {"object_ids": row["object_ids"], "relation_ids": row["relation_ids"]}
        object_values = _list_value(row["object_ids"])
        if object_values is None:
            bind.execute(issues.insert().values(id=_stable_id("issue", row["tenant_id"], row["id"], "object_ids", row["object_ids"]), tenant_id=row["tenant_id"], association_id=row["id"], project_id=row["project_id"], model_id=row["model_id"], source_field="object_ids", source_value=_source_value(row["object_ids"]), reason="ArchitectureAssociation.object_ids is not a JSON list; source selection was retained unchanged.", source_snapshot=snapshot))
            continue
        project_exists = bind.execute(sa.select(projects.c.id).where(projects.c.id == row["project_id"], projects.c.tenant_id == row["tenant_id"])).first()
        if not project_exists:
            bind.execute(issues.insert().values(id=_stable_id("issue", row["tenant_id"], row["id"], "project", row["project_id"]), tenant_id=row["tenant_id"], association_id=row["id"], project_id=row["project_id"], model_id=row["model_id"], source_field="project_id", source_value=_source_value(row["project_id"]), reason="Association project is not present in the same tenant; no normalized link was created.", source_snapshot=snapshot))
            continue
        seen_source_values: set[str] = set()
        seen_object_ids: set[str] = set()
        for raw_object_id in object_values:
            source_value = _source_value(raw_object_id)
            if source_value in seen_source_values:
                continue
            seen_source_values.add(source_value)
            object_id = raw_object_id.strip() if isinstance(raw_object_id, str) else ""
            if object_id in seen_object_ids:
                continue
            found = bind.execute(sa.select(objects.c.id).where(objects.c.id == object_id, objects.c.tenant_id == row["tenant_id"], objects.c.model_id == row["model_id"], objects.c.retired_at.is_(None))).first() if object_id else None
            if not found:
                bind.execute(issues.insert().values(id=_stable_id("issue", row["tenant_id"], row["id"], "object_ids", raw_object_id), tenant_id=row["tenant_id"], association_id=row["id"], project_id=row["project_id"], model_id=row["model_id"], source_field="object_ids", source_value=source_value, reason="Architecture object is missing, retired, or belongs to another tenant/model; source selection was retained unchanged.", source_snapshot=snapshot))
                continue
            seen_object_ids.add(object_id)
            bind.execute(links.insert().values(id=_stable_id("trace", row["tenant_id"], row["project_id"], object_id, "Affected"), tenant_id=row["tenant_id"], entity_kind="project", entity_id=row["project_id"], project_id=row["project_id"], target_kind="architecture_object", target_key=object_id, architecture_object_id=object_id, relationship_type="Affected", lifecycle="Active", revision=1, created_by="migration:9a7b6c5d4e3f", updated_by="migration:9a7b6c5d4e3f"))


def downgrade() -> None:
    op.drop_index("ix_pv1_traceability_backfill_issues_tenant", table_name="pv1_traceability_backfill_issues")
    op.drop_index("ix_pv1_traceability_backfill_issues_tenant_id", table_name="pv1_traceability_backfill_issues")
    op.drop_table("pv1_traceability_backfill_issues")
    op.drop_index("ix_pv1_traceability_links_object", table_name="pv1_traceability_links")
    op.drop_index("ix_pv1_traceability_links_device", table_name="pv1_traceability_links")
    op.drop_index("ix_pv1_traceability_links_project", table_name="pv1_traceability_links")
    op.drop_index("ix_pv1_traceability_links_entity", table_name="pv1_traceability_links")
    op.drop_index("ix_pv1_traceability_links_tenant_id", table_name="pv1_traceability_links")
    op.drop_table("pv1_traceability_links")
    op.drop_index("ix_pv1_arch_device_links_object", table_name="pv1_architecture_device_links")
    op.drop_index("ix_pv1_arch_device_links_device", table_name="pv1_architecture_device_links")
    op.drop_index("ix_pv1_architecture_device_links_tenant_id", table_name="pv1_architecture_device_links")
    op.drop_table("pv1_architecture_device_links")
