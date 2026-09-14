from sqlalchemy import Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from ..database_base import Base


class PV1TimestampMixin:
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by = Column(String(200), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    updated_by = Column(String(200), nullable=False)


class PV1Project(Base, PV1TimestampMixin):
    __tablename__ = "pv1_projects"
    __table_args__ = (
        UniqueConstraint("tenant_id", "display_key", name="uq_pv1_projects_tenant_display_key"),
        Index("ix_pv1_projects_tenant_archived", "tenant_id", "archived_at"),
        CheckConstraint("revision >= 1", name="pv1_project_revision_positive"),
        CheckConstraint("graph_revision >= 1", name="pv1_project_graph_revision_positive"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    legacy_project_id = Column(Integer, nullable=True, index=True)
    display_key = Column(String(32), nullable=False)
    name = Column(String(120), nullable=False)
    objective = Column(String(500), nullable=True)
    problem = Column(Text, nullable=True)
    in_scope = Column(Text, nullable=True)
    out_of_scope = Column(Text, nullable=True)
    team_id = Column(Integer, nullable=True, index=True)
    owner_id = Column(String(200), nullable=False)
    template_key = Column(String(120), nullable=True)
    template_version = Column(String(40), nullable=True)
    phase = Column(String(32), nullable=False, default="Draft")
    run_state = Column(String(32), nullable=False, default="Active")
    priority = Column(String(16), nullable=False, default="Medium")
    start_date = Column(Date, nullable=True)
    target_date = Column(Date, nullable=True)
    no_deadline_reason = Column(String(500), nullable=True)
    timezone = Column(String(64), nullable=False, default="UTC")
    calendar_id = Column(String(120), nullable=True)
    calendar_revision = Column(Integer, nullable=True)
    visibility = Column(String(16), nullable=False, default="Team")
    parent_project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="SET NULL"), nullable=True)
    architecture_assessment = Column(String(32), nullable=False, default="Not assessed")
    architecture_rationale = Column(Text, nullable=True)
    outcome_phase = Column(String(32), nullable=False, default="Not configured")
    outcome_result = Column(String(32), nullable=False, default="Unassessed")
    outcome_currency = Column(String(16), nullable=True)
    update_cadence = Column(Integer, nullable=False, default=7)
    update_cadence_kind = Column(String(16), nullable=False, default="weekly")
    update_weekday = Column(Integer, nullable=False, default=4)
    update_time = Column(String(5), nullable=False, default="15:00")
    update_disabled_reason = Column(String(500), nullable=True)
    measurement_followups = Column(JSON, nullable=True)
    comparison_baseline_id = Column(String(80), nullable=True)
    actual_delivery_at = Column(DateTime(timezone=True), nullable=True)
    delivery_snapshot_id = Column(String(80), nullable=True)
    archived_at = Column(DateTime(timezone=True), nullable=True)
    cancellation_reason = Column(Text, nullable=True)
    pause_reason = Column(Text, nullable=True)
    resume_review_date = Column(Date, nullable=True)
    revision = Column(Integer, nullable=False, default=1)
    graph_revision = Column(Integer, nullable=False, default=1)
    metadata_json = Column(JSON, nullable=True)


class PV1Task(Base, PV1TimestampMixin):
    __tablename__ = "pv1_tasks"
    __table_args__ = (
        Index("ix_pv1_tasks_project_parent_order", "tenant_id", "project_id", "parent_task_id", "order_key"),
        Index("ix_pv1_tasks_project_owner_status", "tenant_id", "project_id", "owner_id", "status"),
        CheckConstraint("revision >= 1", name="pv1_task_revision_positive"),
        CheckConstraint("progress >= 0 AND progress <= 100", name="pv1_task_progress_range"),
        CheckConstraint("planning_weight >= 1 AND planning_weight <= 100", name="pv1_task_planning_weight_range"),
        CheckConstraint("milestone_anchor IN ('start', 'finish')", name="pv1_task_milestone_anchor"),
        CheckConstraint("duration_workdays IS NULL OR (kind = 'Milestone' AND duration_workdays = 0) OR (kind != 'Milestone' AND duration_workdays >= 1)", name="pv1_task_duration_positive"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    legacy_task_id = Column(Integer, nullable=True, index=True)
    parent_task_id = Column(String(80), ForeignKey("pv1_tasks.id", ondelete="SET NULL"), nullable=True)
    milestone_id = Column(String(80), nullable=True)
    kind = Column(String(16), nullable=False, default="Task")
    title = Column(String(120), nullable=False)
    description = Column(Text, nullable=True)
    owner_id = Column(String(200), nullable=True)
    status = Column(String(32), nullable=False, default="To Do")
    priority = Column(String(16), nullable=False, default="Medium")
    progress = Column(Integer, nullable=False, default=0)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    point_date = Column(Date, nullable=True)
    milestone_anchor = Column(String(8), nullable=False, default="start")
    duration_workdays = Column(Integer, nullable=True)
    start_pinned = Column(Boolean, nullable=False, default=False)
    finish_pinned = Column(Boolean, nullable=False, default=False)
    not_before_date = Column(Date, nullable=True)
    estimate_hours = Column(Numeric(18, 4), nullable=True)
    remaining_workdays = Column(Integer, nullable=True)
    planning_weight = Column(Integer, nullable=False, default=1)
    mandatory = Column(Boolean, nullable=False, default=True)
    order_key = Column(Numeric(24, 0), nullable=False, default=1024)
    actual_started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    tags = Column(JSON, nullable=True)
    revision = Column(Integer, nullable=False, default=1)


class PV1TraceabilityLink(Base, PV1TimestampMixin):
    """Normalized link from a canonical PV1/Architecture work entity to a target."""

    __tablename__ = "pv1_traceability_links"
    __table_args__ = (
        UniqueConstraint("tenant_id", "entity_kind", "entity_id", "target_kind", "target_key", "relationship_type", name="uq_pv1_traceability_link_target"),
        Index("ix_pv1_traceability_links_entity", "tenant_id", "entity_kind", "entity_id", "lifecycle"),
        Index("ix_pv1_traceability_links_project", "tenant_id", "project_id", "lifecycle"),
        Index("ix_pv1_traceability_links_device", "tenant_id", "device_id", "lifecycle"),
        Index("ix_pv1_traceability_links_object", "tenant_id", "architecture_object_id", "lifecycle"),
        CheckConstraint("revision >= 1", name="pv1_traceability_link_revision_positive"),
        CheckConstraint("lifecycle IN ('Active', 'Retired')", name="pv1_traceability_link_lifecycle"),
        CheckConstraint("target_kind IN ('device', 'architecture_object')", name="pv1_traceability_link_target_kind"),
        CheckConstraint("(target_kind = 'device' AND device_id IS NOT NULL AND architecture_object_id IS NULL) OR (target_kind = 'architecture_object' AND device_id IS NULL AND architecture_object_id IS NOT NULL)", name="pv1_traceability_link_one_target"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    entity_kind = Column(String(32), nullable=False)
    entity_id = Column(String(80), nullable=False)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=True)
    target_kind = Column(String(32), nullable=False)
    target_key = Column(String(80), nullable=False)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="RESTRICT"), nullable=True)
    architecture_object_id = Column(String(80), ForeignKey("pv1_architecture_objects.id", ondelete="RESTRICT"), nullable=True)
    relationship_type = Column(String(40), nullable=False, default="Affected")
    lifecycle = Column(String(24), nullable=False, default="Active")
    retired_at = Column(DateTime(timezone=True), nullable=True)
    revision = Column(Integer, nullable=False, default=1)


class PV1ProjectMember(Base, PV1TimestampMixin):
    __tablename__ = "pv1_project_members"
    __table_args__ = (
        UniqueConstraint("tenant_id", "project_id", "user_id", name="uq_pv1_project_members_project_user"),
        Index("ix_pv1_project_members_user", "tenant_id", "user_id"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String(200), nullable=False)
    role = Column(String(32), nullable=False)
    capabilities = Column(JSON, nullable=True)
    revision = Column(Integer, nullable=False, default=1)


class PV1TaskCriterion(Base, PV1TimestampMixin):
    __tablename__ = "pv1_task_criteria"
    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    task_id = Column(String(80), ForeignKey("pv1_tasks.id", ondelete="CASCADE"), nullable=True)
    description = Column(Text, nullable=False)
    mandatory = Column(Boolean, nullable=False, default=True)
    evidence_refs = Column(JSON, nullable=True)
    state = Column(String(16), nullable=False, default="Open")
    reviewer = Column(String(200), nullable=True)
    waiver_reason = Column(Text, nullable=True)
    revision = Column(Integer, nullable=False, default=1)


class PV1Dependency(Base, PV1TimestampMixin):
    __tablename__ = "pv1_dependencies"
    __table_args__ = (
        UniqueConstraint("tenant_id", "project_id", "predecessor_id", "successor_id", "dependency_type", name="uq_pv1_dependencies_edge"),
        Index("ix_pv1_dependencies_successor", "tenant_id", "project_id", "successor_id"),
    )
    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    predecessor_id = Column(String(80), ForeignKey("pv1_tasks.id", ondelete="CASCADE"), nullable=False)
    successor_id = Column(String(80), ForeignKey("pv1_tasks.id", ondelete="CASCADE"), nullable=False)
    dependency_type = Column(String(2), nullable=False)
    lag_days = Column(Integer, nullable=False, default=0)
    active = Column(Boolean, nullable=False, default=True)
    revision = Column(Integer, nullable=False, default=1)


class PV1ProjectCalendar(Base, PV1TimestampMixin):
    __tablename__ = "pv1_project_calendars"
    __table_args__ = (
        UniqueConstraint("tenant_id", "project_id", name="uq_pv1_project_calendars_project"),
        CheckConstraint("revision >= 1", name="pv1_project_calendar_revision_positive"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    timezone = Column(String(64), nullable=False, default="UTC")
    working_weekdays = Column(JSON, nullable=False)
    exceptions = Column(JSON, nullable=False)
    revision = Column(Integer, nullable=False, default=1)


class PV1ScheduleBaseline(Base):
    __tablename__ = "pv1_schedule_baselines"
    __table_args__ = (
        Index("ix_pv1_schedule_baselines_project_created", "tenant_id", "project_id", "created_at"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    owner_id = Column(String(200), nullable=False)
    label = Column(String(120), nullable=False)
    rationale = Column(Text, nullable=True)
    calendar_revision = Column(Integer, nullable=False)
    graph_revision = Column(Integer, nullable=False)
    snapshot = Column(JSON, nullable=False)
    is_default = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PV1ExternalDependency(Base, PV1TimestampMixin):
    __tablename__ = "pv1_external_dependencies"
    __table_args__ = (
        Index("ix_pv1_external_dependencies_task", "tenant_id", "project_id", "local_task_id"),
        CheckConstraint("dependency_type IN ('FS', 'SS', 'FF', 'SF')", name="pv1_external_dependency_type"),
        CheckConstraint("lag_days >= -365 AND lag_days <= 365", name="pv1_external_dependency_lag"),
        CheckConstraint("external_anchor IN ('start', 'finish')", name="pv1_external_dependency_anchor"),
        CheckConstraint("access_policy IN ('Visible', 'Redacted', 'Unavailable')", name="pv1_external_dependency_access"),
        CheckConstraint("external_milestone_revision >= 1", name="pv1_external_dependency_revision_positive"),
        CheckConstraint("observed_milestone_revision IS NULL OR observed_milestone_revision >= 1", name="pv1_external_dependency_observed_revision_positive"),
        CheckConstraint("NOT confirmed OR external_date IS NOT NULL", name="pv1_external_dependency_confirmed_date"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    local_task_id = Column(String(80), ForeignKey("pv1_tasks.id", ondelete="CASCADE"), nullable=False)
    external_project_ref = Column(String(200), nullable=False)
    external_task_ref = Column(String(200), nullable=False)
    external_milestone_revision = Column(Integer, nullable=False)
    external_date = Column(Date, nullable=True)
    observed_milestone_revision = Column(Integer, nullable=True)
    observed_date = Column(Date, nullable=True)
    external_anchor = Column(String(8), nullable=False, default="finish")
    access_policy = Column(String(16), nullable=False, default="Visible")
    dependency_type = Column(String(2), nullable=False)
    lag_days = Column(Integer, nullable=False, default=0)
    confirmed = Column(Boolean, nullable=False, default=False)
    active = Column(Boolean, nullable=False, default=True)
    revision = Column(Integer, nullable=False, default=1)


class PV1TaskBlocker(Base, PV1TimestampMixin):
    __tablename__ = "pv1_task_blockers"
    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    task_id = Column(String(80), ForeignKey("pv1_tasks.id", ondelete="CASCADE"), nullable=False)
    source = Column(String(16), nullable=False)
    reason = Column(Text, nullable=False)
    resolver_id = Column(String(200), nullable=True)
    review_date = Column(Date, nullable=True)
    state = Column(String(16), nullable=False, default="Open")
    revision = Column(Integer, nullable=False, default=1)


class PV1FocusPin(Base, PV1TimestampMixin):
    __tablename__ = "pv1_focus_pins"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", "entity_kind", "entity_id", name="uq_pv1_focus_pin_user_entity"),
        Index("ix_pv1_focus_pins_user", "tenant_id", "user_id", "project_id"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    user_id = Column(String(200), nullable=False)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    entity_kind = Column(String(32), nullable=False)
    entity_id = Column(String(80), nullable=False)
    revision = Column(Integer, nullable=False, default=1)


class PV1FocusSnooze(Base, PV1TimestampMixin):
    __tablename__ = "pv1_focus_snoozes"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", "entity_kind", "entity_id", name="uq_pv1_focus_snooze_user_entity"),
        Index("ix_pv1_focus_snoozes_user_until", "tenant_id", "user_id", "until_date"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    user_id = Column(String(200), nullable=False)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    entity_kind = Column(String(32), nullable=False)
    entity_id = Column(String(80), nullable=False)
    until_date = Column(Date, nullable=False)
    revision = Column(Integer, nullable=False, default=1)


class PV1TaskCommandHistory(Base):
    __tablename__ = "pv1_task_command_history"
    __table_args__ = (
        UniqueConstraint("tenant_id", "actor_id", "original_command_id", name="uq_pv1_task_history_command"),
        Index("ix_pv1_task_history_session", "tenant_id", "actor_id", "project_id", "created_at"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    actor_id = Column(String(200), nullable=False)
    original_command_id = Column(String(80), nullable=False)
    command_type = Column(String(80), nullable=False)
    task_ids = Column(JSON, nullable=False)
    before_values = Column(JSON, nullable=False)
    after_values = Column(JSON, nullable=False)
    before_revisions = Column(JSON, nullable=False)
    after_revisions = Column(JSON, nullable=False)
    state = Column(String(16), nullable=False, default="Active")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PV1Resource(Base, PV1TimestampMixin):
    __tablename__ = "pv1_resources"
    __table_args__ = (
        Index("ix_pv1_resources_project_pinned", "tenant_id", "project_id", "pinned"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    resource_kind = Column(String(32), nullable=False)
    title = Column(String(120), nullable=False)
    content = Column(Text, nullable=True)
    upload_ref = Column(String(500), nullable=True)
    scan_state = Column(String(16), nullable=False, default="Available")
    mime_type = Column(String(120), nullable=True)
    size_bytes = Column(Integer, nullable=True)
    content_sha256 = Column(String(64), nullable=True)
    sensitivity = Column(String(32), nullable=False, default="Project")
    pinned = Column(Boolean, nullable=False, default=False)
    links = Column(JSON, nullable=True)
    revision = Column(Integer, nullable=False, default=1)


class PV1ResourceVersion(Base, PV1TimestampMixin):
    __tablename__ = "pv1_resource_versions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "resource_id", "version", name="uq_pv1_resource_versions_number"),
        Index("ix_pv1_resource_versions_resource", "tenant_id", "project_id", "resource_id", "version"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    resource_id = Column(String(80), ForeignKey("pv1_resources.id", ondelete="CASCADE"), nullable=False)
    version = Column(Integer, nullable=False)
    title = Column(String(120), nullable=False)
    content = Column(Text, nullable=True)
    upload_ref = Column(String(500), nullable=True)
    mime_type = Column(String(120), nullable=True)
    size_bytes = Column(Integer, nullable=True)
    content_sha256 = Column(String(64), nullable=True)
    scan_state = Column(String(16), nullable=False, default="Available")
    snapshot = Column(JSON, nullable=False, default=dict)


class PV1ResourceAttachment(Base, PV1TimestampMixin):
    __tablename__ = "pv1_resource_attachments"
    __table_args__ = (
        Index("ix_pv1_resource_attachments_resource", "tenant_id", "project_id", "resource_id"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    resource_id = Column(String(80), ForeignKey("pv1_resources.id", ondelete="CASCADE"), nullable=False)
    filename = Column(String(255), nullable=False)
    mime_type = Column(String(120), nullable=False)
    size_bytes = Column(Integer, nullable=False)
    content_sha256 = Column(String(64), nullable=False)
    scan_state = Column(String(16), nullable=False, default="Pending")
    storage_ref = Column(String(500), nullable=False)
    version = Column(Integer, nullable=False, default=1)


class PV1ActivityProjection(Base):
    __tablename__ = "pv1_activity_projection"
    __table_args__ = (
        UniqueConstraint("tenant_id", "source_event_id", name="uq_pv1_activity_source_event"),
        Index("ix_pv1_activity_project_time", "tenant_id", "project_id", "timestamp"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    source_event_id = Column(String(80), nullable=False)
    actor_id = Column(String(200), nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    category = Column(String(32), nullable=False)
    summary = Column(String(500), nullable=False)
    details = Column(JSON, nullable=False, default=dict)
    visibility_policy = Column(String(32), nullable=False, default="project_members")


class PV1NotificationSubscription(Base, PV1TimestampMixin):
    __tablename__ = "pv1_notification_subscriptions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "project_id", "user_id", name="uq_pv1_notification_subscription"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String(200), nullable=False)
    enabled = Column(Boolean, nullable=False, default=True)
    digest_enabled = Column(Boolean, nullable=False, default=True)
    quiet_start = Column(String(5), nullable=False, default="18:00")
    quiet_end = Column(String(5), nullable=False, default="08:00")
    preferences = Column(JSON, nullable=False, default=dict)
    revision = Column(Integer, nullable=False, default=1)


class PV1Notification(Base):
    __tablename__ = "pv1_notifications"
    __table_args__ = (
        UniqueConstraint("tenant_id", "recipient_id", "dedupe_key", name="uq_pv1_notification_dedupe"),
        Index("ix_pv1_notifications_recipient_due", "tenant_id", "recipient_id", "due_at", "read_at"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    recipient_id = Column(String(200), nullable=False)
    kind = Column(String(32), nullable=False)
    dedupe_key = Column(String(240), nullable=False)
    payload = Column(JSON, nullable=False, default=dict)
    due_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    read_at = Column(DateTime(timezone=True), nullable=True)
    access_epoch = Column(String(120), nullable=False, default="")
    delivery_state = Column(String(16), nullable=False, default="Pending")
    attempt_count = Column(Integer, nullable=False, default=0)


class PV1ReportSnapshot(Base):
    __tablename__ = "pv1_report_snapshots"
    __table_args__ = (
        Index("ix_pv1_report_snapshots_project_created", "tenant_id", "project_id", "created_at"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    report_type = Column(String(32), nullable=False)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    project_revision = Column(Integer, nullable=False)
    source_revisions = Column(JSON, nullable=False, default=dict)
    payload = Column(JSON, nullable=False, default=dict)
    html = Column(Text, nullable=False)
    confidentiality = Column(String(32), nullable=False, default="Project")
    author_id = Column(String(200), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PV1GovernanceRecord(Base, PV1TimestampMixin):
    __tablename__ = "pv1_governance_records"
    __table_args__ = (
        CheckConstraint("record_type IN ('Risk', 'Issue', 'Assumption', 'Decision')", name="pv1_governance_record_type"),
        Index("ix_pv1_governance_project_type_state", "tenant_id", "project_id", "record_type", "state"),
    )
    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    record_type = Column(String(16), nullable=False)
    title = Column(String(120), nullable=False)
    state = Column(String(32), nullable=False, default="Open")
    owner_id = Column(String(200), nullable=True)
    payload = Column(JSON, nullable=True)
    revision = Column(Integer, nullable=False, default=1)


class PV1Update(Base, PV1TimestampMixin):
    __tablename__ = "pv1_updates"
    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    state = Column(String(16), nullable=False, default="Draft")
    period_start = Column(Date, nullable=True)
    period_end = Column(Date, nullable=True)
    author_id = Column(String(200), nullable=False)
    content = Column(JSON, nullable=False)
    source_revisions = Column(JSON, nullable=False, default=dict)
    health_assessment = Column(String(16), nullable=True)
    health_rationale = Column(Text, nullable=True)
    reporting_timezone = Column(String(64), nullable=False, default="UTC")
    published_at = Column(DateTime(timezone=True), nullable=True)
    supersedes_id = Column(String(80), nullable=True)
    withdrawn_at = Column(DateTime(timezone=True), nullable=True)
    withdrawal_reason = Column(Text, nullable=True)
    revision = Column(Integer, nullable=False, default=1)


class PV1Metric(Base, PV1TimestampMixin):
    __tablename__ = "pv1_metrics"
    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(120), nullable=False)
    kind = Column(String(32), nullable=False)
    description = Column(Text, nullable=True)
    unit = Column(String(64), nullable=False)
    direction = Column(String(24), nullable=False)
    baseline = Column(Numeric(24, 8), nullable=True)
    target_spec = Column(JSON, nullable=True)
    target_date = Column(Date, nullable=True)
    steward_id = Column(String(200), nullable=False)
    measurement_method = Column(Text, nullable=False)
    population_definition = Column(Text, nullable=True)
    cadence_days = Column(Integer, nullable=False, default=14)
    required_for_success = Column(Boolean, nullable=False, default=False)
    required_consecutive_periods = Column(Integer, nullable=False, default=1)
    population_version = Column(String(80), nullable=True)
    definition_revision = Column(Integer, nullable=False, default=1)
    archived_at = Column(DateTime(timezone=True), nullable=True)
    revision = Column(Integer, nullable=False, default=1)


class PV1Measurement(Base, PV1TimestampMixin):
    __tablename__ = "pv1_measurements"
    __table_args__ = (Index("ix_pv1_measurements_metric_period", "tenant_id", "metric_id", "period_start", "period_end"),)
    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    metric_id = Column(String(80), ForeignKey("pv1_metrics.id", ondelete="CASCADE"), nullable=False)
    definition_revision = Column(Integer, nullable=False)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    observed_numeric = Column(Numeric(24, 8), nullable=True)
    observed_binary = Column(Boolean, nullable=True)
    numerator = Column(Integer, nullable=True)
    denominator = Column(Integer, nullable=True)
    population_version = Column(String(80), nullable=True)
    imported_percentage = Column(Numeric(24, 8), nullable=True)
    unit = Column(String(64), nullable=False)
    source = Column(Text, nullable=False)
    evidence = Column(JSON, nullable=True)
    observed_at = Column(DateTime(timezone=True), nullable=True)
    recorded_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    recorder_id = Column(String(200), nullable=False)
    quality = Column(String(16), nullable=False, default="Unverified")
    reviewer_id = Column(String(200), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    supersedes_id = Column(String(80), nullable=True)
    revision = Column(Integer, nullable=False, default=1)


class PV1ValueEntry(Base, PV1TimestampMixin):
    __tablename__ = "pv1_value_entries"
    __table_args__ = (Index("ix_pv1_values_attribution", "tenant_id", "attribution_key"),)
    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    kind = Column(String(16), nullable=False, default="Measured")
    classification = Column(String(32), nullable=False)
    amount = Column(Numeric(24, 8), nullable=False)
    currency_or_unit = Column(String(64), nullable=False)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    attribution_key = Column(String(160), nullable=False)
    fraction = Column(Numeric(10, 8), nullable=False, default=1)
    valuation_rate = Column(Numeric(24, 8), nullable=True)
    parent_value_id = Column(String(80), nullable=True)
    approved_by = Column(String(200), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    source = Column(Text, nullable=False)
    quality = Column(String(16), nullable=False, default="Unverified")
    evidence = Column(JSON, nullable=True)
    revision = Column(Integer, nullable=False, default=1)


class PV1OutcomeAcceptance(Base, PV1TimestampMixin):
    __tablename__ = "pv1_outcome_acceptances"
    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    result = Column(String(32), nullable=False)
    metric_revision_ids = Column(JSON, nullable=True)
    measurement_ids = Column(JSON, nullable=True)
    reviewer_id = Column(String(200), nullable=False)
    rationale = Column(Text, nullable=False)
    source_snapshot = Column(JSON, nullable=False, default=dict)
    accepted_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    revision = Column(Integer, nullable=False, default=1)


class PV1DeliveryAcceptance(Base, PV1TimestampMixin):
    __tablename__ = "pv1_delivery_acceptances"
    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    task_revision_ids = Column(JSON, nullable=True)
    criterion_revision_ids = Column(JSON, nullable=True)
    evidence_revision_ids = Column(JSON, nullable=True)
    residual_obligation_ids = Column(JSON, nullable=True)
    followups = Column(JSON, nullable=True)
    source_snapshot = Column(JSON, nullable=False, default=dict)
    reviewer_id = Column(String(200), nullable=False)
    accepted_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    revision = Column(Integer, nullable=False, default=1)


class PV1MetricDefinitionRevision(Base, PV1TimestampMixin):
    __tablename__ = "pv1_metric_definition_revisions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "metric_id", "definition_revision", name="uq_pv1_metric_definition_revision"),
        Index("ix_pv1_metric_definition_revisions_metric", "tenant_id", "project_id", "metric_id", "definition_revision"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    metric_id = Column(String(80), ForeignKey("pv1_metrics.id", ondelete="CASCADE"), nullable=False)
    definition_revision = Column(Integer, nullable=False)
    definition = Column(JSON, nullable=False, default=dict)
    rationale = Column(Text, nullable=True)
    status = Column(String(16), nullable=False, default="Current")


class PV1OutcomeCheckpoint(Base, PV1TimestampMixin):
    __tablename__ = "pv1_outcome_checkpoints"
    __table_args__ = (
        Index("ix_pv1_outcome_checkpoints_project_due", "tenant_id", "project_id", "due_date", "state"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    delivery_acceptance_id = Column(String(80), ForeignKey("pv1_delivery_acceptances.id", ondelete="SET NULL"), nullable=True)
    kind = Column(String(32), nullable=False)
    due_date = Column(Date, nullable=False)
    metric_ids = Column(JSON, nullable=False, default=list)
    state = Column(String(16), nullable=False, default="Pending")
    completed_at = Column(DateTime(timezone=True), nullable=True)
    revision = Column(Integer, nullable=False, default=1)


class PV1Event(Base):
    __tablename__ = "pv1_events"
    __table_args__ = (
        UniqueConstraint("tenant_id", "project_id", "sequence", name="uq_pv1_events_project_sequence"),
        Index("ix_pv1_events_project_sequence", "tenant_id", "project_id", "sequence"),
    )
    event_id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    project_id = Column(String(80), ForeignKey("pv1_projects.id", ondelete="CASCADE"), nullable=False)
    aggregate_type = Column(String(32), nullable=False)
    aggregate_id = Column(String(80), nullable=False)
    aggregate_revision = Column(Integer, nullable=False)
    sequence = Column(Integer, nullable=False)
    actor_id = Column(String(200), nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    event_type = Column(String(80), nullable=False)
    command_id = Column(String(80), nullable=False)
    delta = Column(JSON, nullable=True)
    visibility_policy = Column(String(32), nullable=False, default="project_members")


class PV1IdempotencyKey(Base):
    __tablename__ = "pv1_idempotency_keys"
    __table_args__ = (
        UniqueConstraint("tenant_id", "actor_id", "command_type", "command_id", name="uq_pv1_idempotency_scope"),
        Index("ix_pv1_idempotency_expiry", "tenant_id", "expires_at"),
    )
    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    actor_id = Column(String(200), nullable=False)
    command_type = Column(String(80), nullable=False)
    command_id = Column(String(80), nullable=False)
    request_hash = Column(String(64), nullable=False)
    status = Column(String(16), nullable=False, default="applied")
    response_json = Column(JSON, nullable=False)
    event_id = Column(String(80), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)


class PV1OutboxEvent(Base):
    __tablename__ = "pv1_outbox_events"
    __table_args__ = (Index("ix_pv1_outbox_pending", "tenant_id", "published_at"),)
    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    event_id = Column(String(80), nullable=False, unique=True)
    topic = Column(String(120), nullable=False)
    payload = Column(JSON, nullable=False)
    published_at = Column(DateTime(timezone=True), nullable=True)
    attempt_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PV1MigrationRun(Base):
    """Durable, tenant-scoped ledger for additive legacy backfills.

    The ledger is deliberately separate from the domain aggregates. It makes
    interruption, source drift, rejected rows, and an application rollback to
    the read-only adapter observable without making migration metadata a second
    Project or Task authority.
    """

    __tablename__ = "pv1_migration_runs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "source_hash", name="uq_pv1_migration_run_source"),
        Index("ix_pv1_migration_runs_tenant_status", "tenant_id", "status"),
    )

    id = Column(String(80), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    migration_key = Column(String(80), nullable=False, default="legacy-projects-v1")
    source_hash = Column(String(64), nullable=False)
    status = Column(String(24), nullable=False, default="Running")
    source_counts = Column(JSON, nullable=False, default=dict)
    migrated_counts = Column(JSON, nullable=False, default=dict)
    rejected_counts = Column(JSON, nullable=False, default=dict)
    checkpoint = Column(JSON, nullable=False, default=dict)
    source_snapshot = Column(JSON, nullable=False, default=dict)
    rollback_mapping = Column(JSON, nullable=False, default=dict)
    error = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)


class PV1MigrationRow(Base):
    """One source row's idempotent migration decision."""

    __tablename__ = "pv1_migration_rows"
    __table_args__ = (
        UniqueConstraint("tenant_id", "source_kind", "source_id", name="uq_pv1_migration_row_source"),
        Index("ix_pv1_migration_rows_run_state", "run_id", "state"),
    )

    id = Column(String(80), primary_key=True)
    run_id = Column(String(80), ForeignKey("pv1_migration_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    source_kind = Column(String(32), nullable=False)
    source_id = Column(String(80), nullable=False)
    source_hash = Column(String(64), nullable=False)
    destination_id = Column(String(80), nullable=True)
    state = Column(String(24), nullable=False)
    reason = Column(Text, nullable=True)
    source_snapshot = Column(JSON, nullable=False, default=dict)
    processed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PV1TenantCutover(Base):
    """Source-authority boundary for the v1 compatibility adapter."""

    __tablename__ = "pv1_tenant_cutovers"

    tenant_id = Column(Integer, primary_key=True)
    state = Column(String(24), nullable=False, default="shadow")
    migration_run_id = Column(String(80), nullable=True)
    adapter_version = Column(String(32), nullable=False, default="pv1-v1-adapter-1")
    changed_by = Column(String(200), nullable=False)
    changed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    rollback_mode = Column(String(24), nullable=False, default="read_only")
