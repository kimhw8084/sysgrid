import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel, ConfigDict, model_validator

from app.api.error_utils import standardize_validation_errors

SENTINEL = "synthetic-private-value-DO-NOT-RECORD"


def client_for(model):
    app = FastAPI()
    standardize_validation_errors(app)
    @app.post("/validate")
    def validate(payload: model):
        return {"ok": True}
    return TestClient(app)


class PrivatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    count: int
    values: dict[str, int] = {}


@pytest.mark.parametrize("payload", [
    {"count": SENTINEL},
    {"count": 1, "values": {SENTINEL: "bad"}},
    {"count": 1, SENTINEL: "extra field"},
])
def test_validation_response_never_echoes_values_or_dynamic_keys(payload):
    response = client_for(PrivatePayload).post("/validate", json=payload)
    assert response.status_code == 422
    assert SENTINEL not in response.text
    assert response.headers["cache-control"] == "no-store"
    details = response.json()["detail"]
    assert all(set(detail) == {"type", "loc", "msg"} for detail in details)
    assert all(detail["loc"][0] == "body" for detail in details)
    if "count" in payload and payload["count"] == SENTINEL:
        assert details[0]["loc"] == ["body", "count"]
        assert details[0]["type"] == "int_parsing"


class EchoingValidator(BaseModel):
    credential: str

    @model_validator(mode="after")
    def reject(self):
        raise ValueError(f"Rejected credential: {self.credential}")


def test_custom_validator_message_and_exception_context_are_not_public():
    response = client_for(EchoingValidator).post("/validate", json={"credential": SENTINEL})
    assert response.status_code == 422
    assert SENTINEL not in response.text
    assert response.json()["detail"][0]["type"] == "value_error"
    assert "ctx" not in response.json()["detail"][0]


def test_invalid_json_response_does_not_copy_body():
    response = client_for(PrivatePayload).post("/validate", content='{"count": "' + SENTINEL, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert SENTINEL not in response.text
    assert response.json()["detail"][0]["type"] == "json_invalid"


@pytest.mark.asyncio
async def test_real_action_validation_does_not_send_rejected_credentials_to_diagnostics(seeded_admin_tenant):
    response = await seeded_admin_tenant["client"].post("/api/v1/operational-actions", headers={
        "X-User-Id": "admin_root", "X-Tenant-Id": str(seeded_admin_tenant["tenant_id"]),
    }, json={"target_device_ids": [1], "action_key": "telemetry.snapshot", "parameters": {"password": SENTINEL}})
    assert response.status_code == 422
    assert SENTINEL not in response.text
    assert response.json()["detail"][0]["loc"] == ["body", "parameters"]
    assert "input" not in json.dumps(response.json())
