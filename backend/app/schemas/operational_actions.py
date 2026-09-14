from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..operational_actions.domain import OperationalActionDomainError, normalize_safe_json


def _safe_object(value: Any, field_name: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object")
    try:
        result = normalize_safe_json(value, field_name=field_name)
    except OperationalActionDomainError as exc:
        raise ValueError(str(exc)) from exc
    return result


class ActionCreateRequest(BaseModel):
    target_device_ids: list[int] = Field(min_length=1, max_length=250)
    action_key: str = Field(min_length=1, max_length=120)
    capability_key: str | None = Field(default=None, max_length=120)
    adapter_id: str = Field(default="simulation.recording.v1", min_length=1, max_length=120)
    parameters: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = Field(default=None, max_length=200)
    maintenance_window_id: int | None = Field(default=None, gt=0)
    change_context: dict[str, Any] = Field(default_factory=dict)
    ticket_reference: str | None = Field(default=None, max_length=500)

    @field_validator("target_device_ids")
    @classmethod
    def normalize_target_ids(cls, value: list[int]) -> list[int]:
        if any(isinstance(item, bool) or item <= 0 for item in value):
            raise ValueError("target_device_ids must contain positive integers")
        normalized = list(dict.fromkeys(value))
        if not normalized:
            raise ValueError("target_device_ids must not be empty")
        return normalized

    @field_validator("parameters", "change_context", mode="before")
    @classmethod
    def normalize_safe_objects(cls, value: Any, info) -> dict[str, Any]:
        return _safe_object(value, info.field_name)

    @field_validator("action_key", "capability_key", "adapter_id", "idempotency_key", "ticket_reference")
    @classmethod
    def strip_strings(cls, value: str | None) -> str | None:
        return value.strip() if isinstance(value, str) else value


class PreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AuthorizeRequest(BaseModel):
    preview_token: str = Field(min_length=64, max_length=64)
    approval_facts: dict[str, Any] = Field(default_factory=dict)
    recovery_facts: dict[str, Any] = Field(default_factory=dict)
    confirm: bool = False

    @field_validator("approval_facts", "recovery_facts", mode="before")
    @classmethod
    def normalize_facts(cls, value: Any, info) -> dict[str, Any]:
        return _safe_object(value, info.field_name)


class ConfirmRequest(BaseModel):
    preview_token: str = Field(min_length=64, max_length=64)
    confirmation: bool = True


class ExecuteRequest(BaseModel):
    preview_token: str = Field(min_length=64, max_length=64)


class EvidenceInput(BaseModel):
    evidence_type: str = Field(min_length=1, max_length=48)
    summary: str = Field(min_length=1, max_length=2000)
    reference: str | None = Field(default=None, max_length=500)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("metadata", mode="before")
    @classmethod
    def normalize_metadata(cls, value: Any) -> dict[str, Any]:
        return _safe_object(value, "metadata")

    @field_validator("evidence_type", "summary", "reference")
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        return value.strip() if isinstance(value, str) else value


class VerificationRequest(BaseModel):
    success: bool
    summary: str = Field(min_length=1, max_length=2000)
    evidence: list[EvidenceInput] = Field(default_factory=list, max_length=50)


class RollbackRequest(BaseModel):
    execute: bool = True
    reason: str = Field(min_length=1, max_length=2000)
    recovery_facts: dict[str, Any] = Field(default_factory=dict)
    evidence: list[EvidenceInput] = Field(default_factory=list, max_length=50)

    @field_validator("recovery_facts", mode="before")
    @classmethod
    def normalize_recovery_facts(cls, value: Any) -> dict[str, Any]:
        return _safe_object(value, "recovery_facts")


class RecoveryRequest(BaseModel):
    outcome: Literal["resolved", "unresolved"]
    summary: str = Field(min_length=1, max_length=2000)
    recovery_facts: dict[str, Any] = Field(default_factory=dict)
    evidence: list[EvidenceInput] = Field(default_factory=list, max_length=50)

    @field_validator("recovery_facts", mode="before")
    @classmethod
    def normalize_recovery_facts(cls, value: Any) -> dict[str, Any]:
        return _safe_object(value, "recovery_facts")


class ActionTargetRead(BaseModel):
    id: str
    device_id: int
    target_revision: str
    target_snapshot: dict[str, Any]


class ActionEventRead(BaseModel):
    id: str
    sequence: int
    event_type: str
    from_status: str | None
    to_status: str
    actor_id: str
    message: str | None
    details: dict[str, Any]
    occurred_at: datetime | None


class ActionEvidenceRead(BaseModel):
    id: str
    evidence_type: str
    success: bool | None
    summary: str
    reference: str | None
    metadata: dict[str, Any]
    recorded_by: str
    created_at: datetime | None


class OperationalActionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    tenant_id: int
    actor_id: str
    action_key: str
    capability_key: str
    adapter_id: str
    adapter_capability: str
    normalized_parameters: dict[str, Any]
    parameters_hash: str
    target_set_hash: str | None
    risk_tier: str
    risk_facts: dict[str, Any]
    precondition_snapshot: dict[str, Any]
    precondition_hash: str | None
    preview_token: str | None
    preview_expires_at: datetime | None
    authorization_facts: dict[str, Any]
    approval_facts: dict[str, Any]
    recovery_facts: dict[str, Any]
    confirmation_facts: dict[str, Any]
    rollback_plan: dict[str, Any]
    execution_result: dict[str, Any]
    verification_summary: str | None
    verification_evidence: list[dict[str, Any]]
    rollback_outcome: dict[str, Any]
    request_hash: str
    idempotency_key: str
    request_id: str
    maintenance_window_id: int | None
    change_context: dict[str, Any]
    status: str
    progress_percent: int
    progress_message: str | None
    requested_at: datetime | None
    previewed_at: datetime | None
    authorized_at: datetime | None
    confirmed_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None
    verified_at: datetime | None
    rolled_back_at: datetime | None
    created_at: datetime | None
    updated_at: datetime | None
    targets: list[ActionTargetRead] = Field(default_factory=list)
    history: list[ActionEventRead] = Field(default_factory=list)
    evidence: list[ActionEvidenceRead] = Field(default_factory=list)
