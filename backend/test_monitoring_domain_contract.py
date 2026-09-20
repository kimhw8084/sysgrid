import math
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.api import monitoring
from app.domain.monitoring_contract import (
    ALERT_DURATION_MAX,
    ALERT_DURATION_MIN,
    CHECK_INTERVAL_MAX,
    CHECK_INTERVAL_MIN,
    CONTRACT_PATH,
    MONITORING_CONTRACT,
    NOTIFICATION_THROTTLE_MAX,
    NOTIFICATION_THROTTLE_MIN,
)


def test_monitoring_contract_is_loaded_from_the_neutral_json():
    assert CONTRACT_PATH == Path(__file__).resolve().parents[1] / "contracts" / "monitoring_domain_contract_v1.json"
    assert MONITORING_CONTRACT["version"] == "v1"
    assert MONITORING_CONTRACT["value_semantics"] == {
        "unit": "seconds",
        "type": "integer",
        "description": "Values are integer counts of seconds; boolean, fractional, non-finite, and non-numeric values are invalid.",
    }
    assert (CHECK_INTERVAL_MIN, CHECK_INTERVAL_MAX) == (15, 86400)
    assert (ALERT_DURATION_MIN, ALERT_DURATION_MAX) == (0, 86400)
    assert (NOTIFICATION_THROTTLE_MIN, NOTIFICATION_THROTTLE_MAX) == (60, 604800)


@pytest.mark.parametrize(
    ("field_name", "valid_value", "minimum", "maximum"),
    [
        ("check_interval", CHECK_INTERVAL_MIN, CHECK_INTERVAL_MIN, CHECK_INTERVAL_MAX),
        ("alert_duration", ALERT_DURATION_MIN, ALERT_DURATION_MIN, ALERT_DURATION_MAX),
        ("notification_throttle", NOTIFICATION_THROTTLE_MIN, NOTIFICATION_THROTTLE_MIN, NOTIFICATION_THROTTLE_MAX),
    ],
)
def test_monitoring_numeric_boundaries_are_inclusive(field_name, valid_value, minimum, maximum):
    assert monitoring.validate_monitoring_numeric_fields({field_name: minimum})[field_name] == minimum
    assert monitoring.validate_monitoring_numeric_fields({field_name: maximum})[field_name] == maximum


@pytest.mark.parametrize(
    ("field_name", "invalid_value"),
    [
        ("check_interval", CHECK_INTERVAL_MIN - 1),
        ("check_interval", CHECK_INTERVAL_MAX + 1),
        ("alert_duration", ALERT_DURATION_MIN - 1),
        ("alert_duration", ALERT_DURATION_MAX + 1),
        ("notification_throttle", NOTIFICATION_THROTTLE_MIN - 1),
        ("notification_throttle", NOTIFICATION_THROTTLE_MAX + 1),
        ("check_interval", True),
        ("check_interval", "15"),
        ("check_interval", 15.5),
        ("alert_duration", math.nan),
        ("notification_throttle", math.inf),
        ("notification_throttle", None),
    ],
)
def test_monitoring_numeric_invalid_values_are_rejected(field_name, invalid_value):
    with pytest.raises(HTTPException) as raised:
        monitoring.validate_monitoring_numeric_fields({field_name: invalid_value})
    assert raised.value.status_code == 400
    assert field_name in str(raised.value.detail)


def test_monitoring_api_consumes_contract_constants_without_local_numeric_bounds():
    source = Path(monitoring.__file__).read_text(encoding="utf-8")
    assert "from ..domain.monitoring_contract import" in source
    assert "CHECK_INTERVAL_MIN = 15" not in source
    assert "ALERT_DURATION_MAX = 86400" not in source
    assert "NOTIFICATION_THROTTLE_MAX = 604800" not in source


@pytest.mark.anyio
async def test_monitoring_create_update_and_bulk_share_numeric_validation(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])}
    base_payload = {
        "category": "Infrastructure",
        "status": "Existing",
        "title": "SHARED-NUMERIC-CONTRACT",
    }

    create_invalid = await client.post(
        "/api/v1/monitoring",
        json={**base_payload, "check_interval": 15.5},
        headers=headers,
    )
    assert create_invalid.status_code == 422
    assert "check_interval" in str(create_invalid.json()["detail"])

    created = await client.post("/api/v1/monitoring", json=base_payload, headers=headers)
    assert created.status_code == 200, created.text
    item_id = created.json()["id"]

    update_invalid = await client.put(
        f"/api/v1/monitoring/{item_id}",
        json={"alert_duration": True},
        headers=headers,
    )
    assert update_invalid.status_code == 400
    assert "alert_duration" in str(update_invalid.json()["detail"])

    bulk_invalid = await client.post(
        "/api/v1/monitoring/bulk-action",
        json={"ids": [item_id], "action": "update", "payload": {"notification_throttle": "60"}},
        headers=headers,
    )
    assert bulk_invalid.status_code == 400
    assert "notification_throttle" in str(bulk_invalid.json()["detail"])


@pytest.mark.anyio
async def test_monitoring_create_uses_typed_request_and_rejects_raw_numeric_forms(seeded_admin_tenant):
    client = seeded_admin_tenant["client"]
    headers = {"X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"])}
    openapi = await client.get("/openapi.json")
    assert openapi.status_code == 200, openapi.text
    request_schema = openapi.json()["paths"]["/api/v1/monitoring"]["post"]["requestBody"]["content"]["application/json"]["schema"]
    assert request_schema["$ref"].endswith("/MonitoringItemCreate")

    base_payload = {
        "category": "Infrastructure",
        "status": "Existing",
        "title": "TYPED-NUMERIC-CONTRACT",
    }
    invalid_values = [
        ("check_interval", True),
        ("alert_duration", "60"),
        ("notification_throttle", "not-a-number"),
        ("check_interval", 15.5),
        ("alert_duration", math.nan),
        ("notification_throttle", math.inf),
    ]
    for field_name, invalid_value in invalid_values:
        response = await client.post(
            "/api/v1/monitoring",
            json={**base_payload, "title": f"{base_payload['title']}-{field_name}", field_name: invalid_value},
            headers=headers,
        )
        assert response.status_code == 422, response.text
        assert any(field_name in str(error["loc"]) for error in response.json()["detail"])

    valid = await client.post(
        "/api/v1/monitoring",
        json={
            **base_payload,
            "check_interval": CHECK_INTERVAL_MIN,
            "alert_duration": ALERT_DURATION_MAX,
            "notification_throttle": NOTIFICATION_THROTTLE_MIN,
        },
        headers=headers,
    )
    assert valid.status_code == 200, valid.text
    assert {
        field_name: valid.json()[field_name]
        for field_name in ("check_interval", "alert_duration", "notification_throttle")
    } == {
        "check_interval": CHECK_INTERVAL_MIN,
        "alert_duration": ALERT_DURATION_MAX,
        "notification_throttle": NOTIFICATION_THROTTLE_MIN,
    }
