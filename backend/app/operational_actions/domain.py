from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
import re
from typing import Any, Iterable, Protocol


class OperationalActionDomainError(ValueError):
    """Expected, fail-closed domain rejection."""


SENSITIVE_KEY_PATTERN = re.compile(
    r"(?:password|passwd|secret|token|private[_. -]?key|credential|"
    r"access[_. -]?key|api[_. -]?key|bearer|authorization|shell|command|"
    r"script|payload)",
    re.IGNORECASE,
)


def normalize_safe_json(value: Any, *, field_name: str = "value") -> Any:
    """Normalize JSON while rejecting common secret/command-bearing shapes."""

    if isinstance(value, dict):
        normalized: dict[str, Any] = {}
        for key in sorted(value, key=lambda item: str(item).lower()):
            if not isinstance(key, str) or not key.strip():
                raise OperationalActionDomainError(f"{field_name} contains an invalid object key")
            clean_key = key.strip()
            if SENSITIVE_KEY_PATTERN.search(clean_key):
                raise OperationalActionDomainError(
                    f"{field_name} cannot contain secret or command field '{clean_key}'"
                )
            normalized[clean_key] = normalize_safe_json(value[key], field_name=field_name)
        return normalized
    if isinstance(value, list):
        return [normalize_safe_json(item, field_name=field_name) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        if isinstance(value, str) and len(value) > 4000:
            raise OperationalActionDomainError(f"{field_name} contains an oversized string")
        return value
    raise OperationalActionDomainError(f"{field_name} contains an unsupported value")


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_json(value: Any) -> str:
    return sha256(canonical_json(value).encode("utf-8")).hexdigest()


class ActionStatus:
    CREATED = "CREATED"
    PREVIEWED = "PREVIEWED"
    STALE = "STALE"
    AUTHORIZED = "AUTHORIZED"
    CONFIRMED = "CONFIRMED"
    EXECUTING = "EXECUTING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    VERIFIED = "VERIFIED"
    VERIFICATION_FAILED = "VERIFICATION_FAILED"
    ROLLBACK_REQUESTED = "ROLLBACK_REQUESTED"
    ROLLING_BACK = "ROLLING_BACK"
    ROLLED_BACK = "ROLLED_BACK"
    ROLLBACK_FAILED = "ROLLBACK_FAILED"
    RECOVERY_REQUIRED = "RECOVERY_REQUIRED"
    RECOVERED = "RECOVERED"


class ActionAttemptPhase:
    EXECUTION = "EXECUTION"
    ROLLBACK = "ROLLBACK"


class ActionAttemptStatus:
    REQUESTED = "REQUESTED"
    CLAIMED = "CLAIMED"
    COMPLETED = "COMPLETED"
    OUTCOME_UNKNOWN = "OUTCOME_UNKNOWN"


ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    ActionStatus.CREATED: {ActionStatus.PREVIEWED, ActionStatus.STALE},
    ActionStatus.PREVIEWED: {ActionStatus.PREVIEWED, ActionStatus.AUTHORIZED, ActionStatus.CONFIRMED, ActionStatus.STALE},
    ActionStatus.STALE: {ActionStatus.PREVIEWED},
    ActionStatus.AUTHORIZED: {ActionStatus.AUTHORIZED, ActionStatus.CONFIRMED, ActionStatus.STALE},
    ActionStatus.CONFIRMED: {ActionStatus.EXECUTING, ActionStatus.STALE},
    ActionStatus.EXECUTING: {ActionStatus.SUCCEEDED, ActionStatus.FAILED, ActionStatus.RECOVERY_REQUIRED},
    ActionStatus.SUCCEEDED: {ActionStatus.VERIFIED, ActionStatus.VERIFICATION_FAILED, ActionStatus.ROLLBACK_REQUESTED},
    ActionStatus.FAILED: {ActionStatus.ROLLBACK_REQUESTED, ActionStatus.RECOVERY_REQUIRED},
    ActionStatus.VERIFIED: {ActionStatus.ROLLBACK_REQUESTED},
    ActionStatus.VERIFICATION_FAILED: {ActionStatus.ROLLBACK_REQUESTED, ActionStatus.RECOVERY_REQUIRED},
    ActionStatus.ROLLBACK_REQUESTED: {ActionStatus.ROLLING_BACK, ActionStatus.RECOVERY_REQUIRED},
    ActionStatus.ROLLING_BACK: {ActionStatus.ROLLED_BACK, ActionStatus.ROLLBACK_FAILED, ActionStatus.RECOVERY_REQUIRED},
    ActionStatus.ROLLED_BACK: set(),
    ActionStatus.ROLLBACK_FAILED: {ActionStatus.ROLLBACK_REQUESTED, ActionStatus.RECOVERY_REQUIRED},
    ActionStatus.RECOVERY_REQUIRED: {ActionStatus.RECOVERY_REQUIRED, ActionStatus.RECOVERED, ActionStatus.ROLLBACK_REQUESTED},
    ActionStatus.RECOVERED: set(),
}


def require_transition(current: str, target: str) -> None:
    if target not in ALLOWED_TRANSITIONS.get(current, set()):
        raise OperationalActionDomainError(f"Illegal operational action transition {current} -> {target}")


@dataclass(frozen=True)
class ActionDefinition:
    action_key: str
    capability_key: str
    title: str
    description: str
    risk_tier: str
    reversible: bool
    requires_approval: bool
    requires_recovery_facts: bool


@dataclass(frozen=True)
class AdapterProgress:
    percent: int
    message: str


@dataclass(frozen=True)
class AdapterExecution:
    progress: tuple[AdapterProgress, ...]
    success: bool
    result: dict[str, Any]


class OperationalAdapter(Protocol):
    adapter_id: str
    display_name: str
    capabilities: frozenset[str]

    def supports(self, definition: ActionDefinition) -> bool: ...

    def execute(self, *, action_id: str, target_ids: Iterable[int], parameters: dict[str, Any]) -> AdapterExecution: ...

    def rollback(self, *, action_id: str, target_ids: Iterable[int], parameters: dict[str, Any]) -> AdapterExecution: ...


class SimulationRecordingAdapter:
    """Deterministic test/development adapter. It cannot access a machine or network."""

    adapter_id = "simulation.recording.v1"
    display_name = "Deterministic recording simulation (non-production)"
    capabilities = frozenset({
        "telemetry.read",
        "service.control",
        "documentation.record",
    })

    def supports(self, definition: ActionDefinition) -> bool:
        return definition.capability_key in self.capabilities

    def execute(self, *, action_id: str, target_ids: Iterable[int], parameters: dict[str, Any]) -> AdapterExecution:
        should_fail = parameters.get("simulation_outcome") == "failure"
        progress = (
            AdapterProgress(10, "Simulation accepted; no machine operation performed."),
            AdapterProgress(60, "Simulation recorded target intent; no remote session opened."),
        )
        if not should_fail:
            progress += (AdapterProgress(100, "Simulation complete; no external system was changed."),)
        return AdapterExecution(
            progress=progress,
            success=not should_fail,
            result={
                "mode": "deterministic_recording_simulation",
                "performed": False,
                "external_side_effect": False,
                "action_id": action_id,
                "target_count": len(tuple(target_ids)),
                "outcome": "failure" if should_fail else "success",
            },
        )

    def rollback(self, *, action_id: str, target_ids: Iterable[int], parameters: dict[str, Any]) -> AdapterExecution:
        should_fail = parameters.get("simulation_rollback_outcome") == "failure"
        progress = (AdapterProgress(50, "Simulation rollback recorded; no machine operation performed."),)
        if not should_fail:
            progress += (AdapterProgress(100, "Simulation rollback complete; no external system was changed."),)
        return AdapterExecution(
            progress=progress,
            success=not should_fail,
            result={
                "mode": "deterministic_recording_simulation",
                "performed": False,
                "external_side_effect": False,
                "action_id": action_id,
                "outcome": "failure" if should_fail else "success",
            },
        )


FUTURE_CAPABILITY_CATALOG = (
    ("inventory.discovery", "Inventory and discovery"),
    ("telemetry.read", "Telemetry and health"),
    ("remote.execution", "Remote execution"),
    ("service.control", "Service control"),
    ("deployment", "Deployment"),
    ("hardware.management", "Hardware management"),
    ("networking", "Networking"),
    ("ticketing", "Ticket/change management"),
    ("identity", "Identity"),
    ("secrets.reference", "Secret reference metadata"),
    ("source.control", "Source control"),
    ("documentation.record", "Documentation and recording"),
)


class AdapterRegistry:
    def __init__(self) -> None:
        self._adapter = SimulationRecordingAdapter()
        self._definitions = {
            definition.action_key: definition
            for definition in (
                ActionDefinition(
                    "telemetry.snapshot",
                    "telemetry.read",
                    "Record telemetry snapshot",
                    "Record a deterministic simulated telemetry observation.",
                    "ROUTINE",
                    True,
                    False,
                    False,
                ),
                ActionDefinition(
                    "service.restart",
                    "service.control",
                    "Record service restart intent",
                    "Record a high-risk restart intent without operating a service.",
                    "HIGH",
                    True,
                    True,
                    True,
                ),
                ActionDefinition(
                    "asset.change_record",
                    "documentation.record",
                    "Record an asset change intent",
                    "Record a reversible simulated change intent for later integration.",
                    "ROUTINE",
                    True,
                    False,
                    False,
                ),
            )
        }

    def get_definition(self, action_key: str) -> ActionDefinition | None:
        return self._definitions.get(action_key)

    def get_adapter(self, adapter_id: str) -> OperationalAdapter | None:
        return self._adapter if adapter_id == self._adapter.adapter_id else None

    def supports(self, *, action_key: str, capability_key: str, adapter_id: str) -> bool:
        definition = self.get_definition(action_key)
        adapter = self.get_adapter(adapter_id)
        return bool(
            definition
            and definition.capability_key == capability_key
            and adapter
            and adapter.supports(definition)
        )

    def describe(self) -> dict[str, Any]:
        supported = []
        for capability_key, title in FUTURE_CAPABILITY_CATALOG:
            actions = [
                {
                    "action_key": definition.action_key,
                    "title": definition.title,
                    "description": definition.description,
                    "risk_tier": definition.risk_tier,
                    "reversible": definition.reversible,
                    "requires_approval": definition.requires_approval,
                    "requires_recovery_facts": definition.requires_recovery_facts,
                    "adapter_id": self._adapter.adapter_id,
                    "production_capable": False,
                }
                for definition in self._definitions.values()
                if definition.capability_key == capability_key
            ]
            supported.append({
                "capability_key": capability_key,
                "title": title,
                "supported": bool(actions),
                "actions": actions,
            })
        return {
            "adapter": {
                "adapter_id": self._adapter.adapter_id,
                "display_name": self._adapter.display_name,
                "production_capable": False,
            },
            "capabilities": supported,
        }


REGISTRY = AdapterRegistry()


def build_preview_token(*, tenant_id: int, actor_id: str, action_id: str, binding: dict[str, Any]) -> str:
    return sha256_json({
        "tenant_id": tenant_id,
        "actor_id": actor_id,
        "action_id": action_id,
        "binding": binding,
    })
