from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel
from pydantic import model_validator

from app.api.error_utils import standardize_validation_errors


class Payload(BaseModel):
    count: int


def test_standardize_validation_errors_returns_uniform_payload():
    app = FastAPI()
    standardize_validation_errors(app)

    @app.post("/items")
    def create_item(payload: Payload):
        return payload.model_dump()

    client = TestClient(app)
    response = client.post("/items", json={"count": "bad"})

    assert response.status_code == 422
    data = response.json()
    assert data["message"] == "Validation Failed"
    assert isinstance(data["detail"], list)
    assert data["detail"][0]["loc"][-1] == "count"


class ValueValidatedPayload(BaseModel):
    name: str | None = None

    @model_validator(mode="after")
    def require_name(self):
        if not self.name:
            raise ValueError("Name is required")
        return self


def test_standardize_validation_errors_keeps_category_without_exception_context():
    app = FastAPI()
    standardize_validation_errors(app)

    @app.post("/validated")
    def create_item(payload: ValueValidatedPayload):
        return payload.model_dump()

    client = TestClient(app)
    response = client.post("/validated", json={})

    assert response.status_code == 422
    data = response.json()
    assert data["message"] == "Validation Failed"
    assert data["detail"][0]["type"] == "value_error"
    assert data["detail"][0]["loc"] == ["body"]
    assert "ctx" not in data["detail"][0]
    assert "input" not in data["detail"][0]
