from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from ..database_base import Base


class ArchitectureTimestampMixin:
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by = Column(String(200), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    updated_by = Column(String(200), nullable=False)


class ArchitectureModel(Base, ArchitectureTimestampMixin):
    __tablename__ = "pv1_architecture_models"
    __table_args__ = (
        Index("ix_pv1_arch_models_tenant_name", "tenant_id", "name"),
        CheckConstraint("revision >= 1", name="pv1_arch_model_revision_positive"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    name = Column(String(160), nullable=False)
    description = Column(Text, nullable=True)
    owner_id = Column(String(200), nullable=False)
    schema_version = Column(String(32), nullable=False, default="pv1.architecture.v1")
    lifecycle = Column(String(32), nullable=False, default="Current")
    revision = Column(Integer, nullable=False, default=1)


class ArchitectureObject(Base, ArchitectureTimestampMixin):
    __tablename__ = "pv1_architecture_objects"
    __table_args__ = (
        Index("ix_pv1_arch_objects_model_kind", "tenant_id", "model_id", "kind"),
        Index("ix_pv1_arch_objects_model_lifecycle", "tenant_id", "model_id", "retired_at"),
        CheckConstraint("revision >= 1", name="pv1_arch_object_revision_positive"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    model_id = Column(String(80), ForeignKey("pv1_architecture_models.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(32), nullable=False)
    name = Column(String(160), nullable=False)
    description = Column(Text, nullable=True)
    owner_id = Column(String(200), nullable=True)
    lifecycle = Column(String(32), nullable=False, default="Current")
    properties = Column(JSON, nullable=False, default=dict)
    tags = Column(JSON, nullable=False, default=list)
    revision = Column(Integer, nullable=False, default=1)
    retired_at = Column(DateTime(timezone=True), nullable=True)


class ArchitectureRelation(Base, ArchitectureTimestampMixin):
    __tablename__ = "pv1_architecture_relations"
    __table_args__ = (
        Index("ix_pv1_arch_relations_model_source", "tenant_id", "model_id", "source_id"),
        Index("ix_pv1_arch_relations_model_target", "tenant_id", "model_id", "target_id"),
        CheckConstraint("revision >= 1", name="pv1_arch_relation_revision_positive"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    model_id = Column(String(80), ForeignKey("pv1_architecture_models.id", ondelete="CASCADE"), nullable=False, index=True)
    source_id = Column(String(80), ForeignKey("pv1_architecture_objects.id", ondelete="CASCADE"), nullable=False)
    target_id = Column(String(80), ForeignKey("pv1_architecture_objects.id", ondelete="CASCADE"), nullable=False)
    relation_type = Column(String(40), nullable=False, default="Depends on")
    name = Column(String(160), nullable=True)
    description = Column(Text, nullable=True)
    properties = Column(JSON, nullable=False, default=dict)
    revision = Column(Integer, nullable=False, default=1)
    retired_at = Column(DateTime(timezone=True), nullable=True)


class ArchitectureDiagram(Base, ArchitectureTimestampMixin):
    __tablename__ = "pv1_architecture_diagrams"
    __table_args__ = (
        UniqueConstraint("tenant_id", "model_id", "name", name="uq_pv1_arch_diagrams_model_name"),
        CheckConstraint("revision >= 1", name="pv1_arch_diagram_revision_positive"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    model_id = Column(String(80), ForeignKey("pv1_architecture_models.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(160), nullable=False)
    level = Column(String(32), nullable=False, default="Context")
    filters = Column(JSON, nullable=False, default=dict)
    revision = Column(Integer, nullable=False, default=1)
    retired_at = Column(DateTime(timezone=True), nullable=True)


class ArchitectureDiagramMembership(Base, ArchitectureTimestampMixin):
    __tablename__ = "pv1_architecture_diagram_memberships"
    __table_args__ = (
        UniqueConstraint("tenant_id", "diagram_id", "entity_kind", "entity_id", name="uq_pv1_arch_membership_entity"),
        Index("ix_pv1_arch_membership_diagram", "tenant_id", "diagram_id"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    diagram_id = Column(String(80), ForeignKey("pv1_architecture_diagrams.id", ondelete="CASCADE"), nullable=False)
    entity_kind = Column(String(16), nullable=False)
    entity_id = Column(String(80), nullable=False)
    x = Column(Integer, nullable=False, default=0)
    y = Column(Integer, nullable=False, default=0)
    width = Column(Integer, nullable=False, default=180)
    height = Column(Integer, nullable=False, default=80)
    metadata_json = Column(JSON, nullable=False, default=dict)
    revision = Column(Integer, nullable=False, default=1)


class ArchitectureChangeSet(Base, ArchitectureTimestampMixin):
    __tablename__ = "pv1_architecture_change_sets"
    __table_args__ = (
        Index("ix_pv1_arch_changesets_model_state", "tenant_id", "model_id", "state"),
        CheckConstraint("base_model_revision >= 1", name="pv1_arch_changeset_base_revision_positive"),
        CheckConstraint("revision >= 1", name="pv1_arch_changeset_revision_positive"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    model_id = Column(String(80), ForeignKey("pv1_architecture_models.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="SET NULL"), nullable=True, index=True)
    owner_id = Column(String(200), nullable=False)
    base_model_revision = Column(Integer, nullable=False)
    base_entity_revisions = Column(JSON, nullable=False, default=dict)
    state = Column(String(24), nullable=False, default="Draft")
    revision = Column(Integer, nullable=False, default=1)
    approver_id = Column(String(200), nullable=True)
    conflict_metadata = Column(JSON, nullable=False, default=dict)
    applied_model_revision = Column(Integer, nullable=True)
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    applied_at = Column(DateTime(timezone=True), nullable=True)


class ArchitectureChangeOperation(Base, ArchitectureTimestampMixin):
    __tablename__ = "pv1_architecture_change_operations"
    __table_args__ = (
        UniqueConstraint("tenant_id", "change_set_id", "sequence", name="uq_pv1_arch_operation_sequence"),
        Index("ix_pv1_arch_operations_changeset", "tenant_id", "change_set_id"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    change_set_id = Column(String(80), ForeignKey("pv1_architecture_change_sets.id", ondelete="CASCADE"), nullable=False)
    sequence = Column(Integer, nullable=False)
    op_type = Column(String(80), nullable=False)
    target_id = Column(String(80), nullable=False)
    payload = Column(JSON, nullable=False, default=dict)
    revision = Column(Integer, nullable=False, default=1)


class ArchitectureAccess(Base, ArchitectureTimestampMixin):
    __tablename__ = "pv1_architecture_access"
    __table_args__ = (
        UniqueConstraint("tenant_id", "model_id", "user_id", name="uq_pv1_arch_access_user"),
        Index("ix_pv1_arch_access_model_role", "tenant_id", "model_id", "role"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    model_id = Column(String(80), ForeignKey("pv1_architecture_models.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String(200), nullable=False)
    role = Column(String(24), nullable=False, default="Viewer")
    revision = Column(Integer, nullable=False, default=1)


class ArchitectureAssociation(Base, ArchitectureTimestampMixin):
    __tablename__ = "pv1_project_architecture_associations"
    __table_args__ = (
        UniqueConstraint("tenant_id", "project_id", "model_id", name="uq_pv1_project_arch_association"),
        Index("ix_pv1_project_arch_association_project", "tenant_id", "project_id"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    model_id = Column(String(80), ForeignKey("pv1_architecture_models.id", ondelete="CASCADE"), nullable=False)
    diagram_id = Column(String(80), nullable=True)
    object_ids = Column(JSON, nullable=False, default=list)
    relation_ids = Column(JSON, nullable=False, default=list)
    impact_tags = Column(JSON, nullable=False, default=list)
    changeset_id = Column(String(80), nullable=True)
    revision = Column(Integer, nullable=False, default=1)


class ArchitectureDeviceLink(Base, ArchitectureTimestampMixin):
    """Normalized tenant-scoped link between an operational Device and v2 object."""

    __tablename__ = "pv1_architecture_device_links"
    __table_args__ = (
        UniqueConstraint("tenant_id", "device_id", "architecture_object_id", name="uq_pv1_arch_device_link_target"),
        Index("ix_pv1_arch_device_links_device", "tenant_id", "device_id", "lifecycle"),
        Index("ix_pv1_arch_device_links_object", "tenant_id", "architecture_object_id", "lifecycle"),
        CheckConstraint("revision >= 1", name="pv1_arch_device_link_revision_positive"),
        CheckConstraint("lifecycle IN ('Active', 'Retired')", name="pv1_arch_device_link_lifecycle"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="RESTRICT"), nullable=False)
    architecture_object_id = Column(String(80), ForeignKey("pv1_architecture_objects.id", ondelete="RESTRICT"), nullable=False)
    relationship_type = Column(String(40), nullable=False, default="Represents")
    lifecycle = Column(String(24), nullable=False, default="Active")
    retired_at = Column(DateTime(timezone=True), nullable=True)
    revision = Column(Integer, nullable=False, default=1)


class PV1TraceabilityBackfillIssue(Base):
    """Durable record of legacy association selections not safely normalizable."""

    __tablename__ = "pv1_traceability_backfill_issues"
    __table_args__ = (
        UniqueConstraint("tenant_id", "association_id", "source_field", "source_value", name="uq_pv1_traceability_backfill_issue"),
        Index("ix_pv1_traceability_backfill_issues_tenant", "tenant_id", "association_id"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    association_id = Column(String(80), ForeignKey("pv1_project_architecture_associations.id", ondelete="SET NULL"), nullable=True)
    project_id = Column(String(80), nullable=True)
    model_id = Column(String(80), nullable=True)
    source_field = Column(String(32), nullable=False)
    source_value = Column(String(160), nullable=False)
    reason = Column(Text, nullable=False)
    source_snapshot = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ArchitectureAssessment(Base, ArchitectureTimestampMixin):
    __tablename__ = "pv1_project_architecture_assessments"
    __table_args__ = (
        UniqueConstraint("tenant_id", "project_id", "model_id", name="uq_pv1_project_arch_assessment"),
        CheckConstraint("revision >= 1", name="pv1_arch_assessment_revision_positive"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    model_id = Column(String(80), ForeignKey("pv1_architecture_models.id", ondelete="CASCADE"), nullable=False)
    state = Column(String(32), nullable=False, default="Not assessed")
    rationale = Column(Text, nullable=True)
    evidence_refs = Column(JSON, nullable=False, default=list)
    reviewer_id = Column(String(200), nullable=True)
    applied_model_revision = Column(Integer, nullable=True)
    revision = Column(Integer, nullable=False, default=1)


class ArchitectureCommand(Base):
    __tablename__ = "pv1_architecture_commands"
    __table_args__ = (
        UniqueConstraint("tenant_id", "actor_id", "command_type", "command_id", name="uq_pv1_arch_command_idempotency"),
        Index("ix_pv1_arch_command_expiry", "tenant_id", "expires_at"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    actor_id = Column(String(200), nullable=False)
    command_type = Column(String(80), nullable=False)
    command_id = Column(String(80), nullable=False)
    request_hash = Column(String(64), nullable=False)
    status = Column(String(16), nullable=False, default="pending")
    response_json = Column(JSON, nullable=False, default=dict)
    event_id = Column(String(80), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)


class ArchitectureEvent(Base):
    __tablename__ = "pv1_architecture_events"
    __table_args__ = (
        UniqueConstraint("tenant_id", "model_id", "sequence", name="uq_pv1_arch_event_sequence"),
        Index("ix_pv1_arch_events_model_sequence", "tenant_id", "model_id", "sequence"),
    )

    event_id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    model_id = Column(String(80), ForeignKey("pv1_architecture_models.id", ondelete="CASCADE"), nullable=False)
    sequence = Column(Integer, nullable=False)
    actor_id = Column(String(200), nullable=False)
    event_type = Column(String(80), nullable=False)
    command_id = Column(String(80), nullable=False)
    aggregate_id = Column(String(80), nullable=False)
    aggregate_revision = Column(Integer, nullable=False)
    delta = Column(JSON, nullable=False, default=dict)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ArchitectureOutbox(Base):
    __tablename__ = "pv1_architecture_outbox"
    __table_args__ = (Index("ix_pv1_arch_outbox_pending", "tenant_id", "published_at"),)

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    event_id = Column(String(80), nullable=False, unique=True)
    topic = Column(String(120), nullable=False)
    payload = Column(JSON, nullable=False)
    published_at = Column(DateTime(timezone=True), nullable=True)
    attempt_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
