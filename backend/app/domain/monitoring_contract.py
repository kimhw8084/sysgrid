"""Load and validate the neutral Monitoring numeric contract."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


CONTRACT_PATH = Path(__file__).resolve().parents[3] / "contracts" / "monitoring_domain_contract_v1.json"
_EXPECTED_BOUND_NAMES = (
    "check_interval_seconds",
    "alert_duration_seconds",
    "notification_throttle_seconds",
)


def _contract_error(message: str) -> RuntimeError:
    return RuntimeError(f"Invalid Monitoring domain contract at {CONTRACT_PATH}: {message}")


def _require_integer(value: Any, *, field_name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise _contract_error(f"{field_name} must be an integer")
    return value


def _load_contract() -> dict[str, Any]:
    if not CONTRACT_PATH.is_file():
        raise _contract_error("file is missing")
    try:
        contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise _contract_error(f"could not be read: {exc}") from exc

    if not isinstance(contract, dict):
        raise _contract_error("root must be an object")
    if contract.get("contract_id") != "sysgrid.monitoring.domain":
        raise _contract_error("contract_id must be sysgrid.monitoring.domain")
    if contract.get("version") != "v1":
        raise _contract_error("version must be v1")
    if not isinstance(contract.get("schema_version"), str) or not contract["schema_version"]:
        raise _contract_error("schema_version must be a non-empty string")

    semantics = contract.get("value_semantics")
    if not isinstance(semantics, dict):
        raise _contract_error("value_semantics must be an object")
    if semantics.get("unit") != "seconds":
        raise _contract_error("value_semantics.unit must be seconds")
    if semantics.get("type") != "integer":
        raise _contract_error("value_semantics.type must be integer")
    if not isinstance(semantics.get("description"), str) or not semantics["description"]:
        raise _contract_error("value_semantics.description must be a non-empty string")

    bounds = contract.get("bounds")
    if not isinstance(bounds, dict) or set(bounds) != set(_EXPECTED_BOUND_NAMES):
        raise _contract_error(f"bounds must contain exactly {', '.join(_EXPECTED_BOUND_NAMES)}")
    for bound_name in _EXPECTED_BOUND_NAMES:
        bound = bounds[bound_name]
        if not isinstance(bound, dict) or set(bound) != {"min", "max"}:
            raise _contract_error(f"bounds.{bound_name} must contain min and max")
        minimum = _require_integer(bound["min"], field_name=f"bounds.{bound_name}.min")
        maximum = _require_integer(bound["max"], field_name=f"bounds.{bound_name}.max")
        if minimum > maximum:
            raise _contract_error(f"bounds.{bound_name}.min cannot exceed max")

    return contract


MONITORING_CONTRACT = _load_contract()
_MONITORING_BOUNDS = MONITORING_CONTRACT["bounds"]

CHECK_INTERVAL_MIN = _MONITORING_BOUNDS["check_interval_seconds"]["min"]
CHECK_INTERVAL_MAX = _MONITORING_BOUNDS["check_interval_seconds"]["max"]
ALERT_DURATION_MIN = _MONITORING_BOUNDS["alert_duration_seconds"]["min"]
ALERT_DURATION_MAX = _MONITORING_BOUNDS["alert_duration_seconds"]["max"]
NOTIFICATION_THROTTLE_MIN = _MONITORING_BOUNDS["notification_throttle_seconds"]["min"]
NOTIFICATION_THROTTLE_MAX = _MONITORING_BOUNDS["notification_throttle_seconds"]["max"]

# Descriptive aliases keep the domain names available to future consumers
# while preserving the existing API module constant names.
CHECK_INTERVAL_SECONDS_MIN = CHECK_INTERVAL_MIN
CHECK_INTERVAL_SECONDS_MAX = CHECK_INTERVAL_MAX
ALERT_DURATION_SECONDS_MIN = ALERT_DURATION_MIN
ALERT_DURATION_SECONDS_MAX = ALERT_DURATION_MAX
NOTIFICATION_THROTTLE_SECONDS_MIN = NOTIFICATION_THROTTLE_MIN
NOTIFICATION_THROTTLE_SECONDS_MAX = NOTIFICATION_THROTTLE_MAX
