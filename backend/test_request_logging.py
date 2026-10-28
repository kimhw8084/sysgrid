from __future__ import annotations

import io
import json
import logging
from types import SimpleNamespace

import pytest
from starlette.requests import Request

from app.main import global_exception_handler, request_metric_logger
from app.observability import RequestMetricJsonFormatter, safe_route_template


def test_safe_route_template_uses_only_bounded_router_patterns():
    route = SimpleNamespace(path="/api/v2/projects/{project_id}/commands")
    assert safe_route_template({"route": route}) == "/api/v2/projects/{project_id}/commands"
    assert safe_route_template({"route": SimpleNamespace(path="private-user")}) == "/unmatched"
    assert safe_route_template({"path": "/private-user"}) == "/unmatched"
    assert safe_route_template({"route": SimpleNamespace(path="/" + "x" * 241)}) == "/unmatched"


@pytest.mark.asyncio
async def test_request_metrics_are_json_and_exclude_query_identity_and_unmatched_path(client, monkeypatch):
    stream = io.StringIO()
    assert request_metric_logger.handlers
    assert request_metric_logger.disabled is False
    assert request_metric_logger.isEnabledFor(logging.INFO)
    formatter = request_metric_logger.handlers[0].formatter
    assert isinstance(formatter, RequestMetricJsonFormatter)
    capture_handler = logging.StreamHandler(stream)
    capture_handler.setFormatter(formatter)
    monkeypatch.setattr(request_metric_logger, "handlers", [capture_handler])
    matched = await client.get(
        "/api/v1/readiness?token=private-query-value",
        headers={"X-Request-ID": "private-operator"},
    )
    unmatched = await client.get(
        "/api/v1/private-email-alex@example.invalid",
        headers={"X-Request-ID": "4f4e4bd9-1051-47a5-956b-9ff4e9cfcf02"},
    )
    output = stream.getvalue()
    records = {}
    for line in output.splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and value.get("event") == "request_complete":
            records[value.get("request_id")] = value

    matched_id = matched.headers["X-Request-ID"]
    unmatched_id = unmatched.headers["X-Request-ID"]
    assert matched.status_code == 200, matched.text
    assert unmatched.status_code == 404, unmatched.text
    assert matched_id != "private-operator"
    assert records[matched_id]["path"] == "/api/v1/readiness"
    assert records[matched_id]["status_code"] == 200
    assert records[unmatched_id]["path"] == "/unmatched"
    assert "private-query-value" not in output
    assert "private-operator" not in output
    assert "private-email-alex@example.invalid" not in output


@pytest.mark.asyncio
async def test_internal_error_response_sanitizes_unmatched_path():
    request = Request({
        "type": "http",
        "method": "GET",
        "path": "/api/v1/private-email-alex@example.invalid",
        "headers": [],
        "query_string": b"token=private-query-value",
        "scheme": "http",
        "server": ("test", 80),
        "client": ("test", 1),
        "state": {},
    })
    response = await global_exception_handler(request, RuntimeError("synthetic failure"))
    body = json.loads(response.body)
    assert response.status_code == 500
    assert body["path"] == "/unmatched"
    assert "private-email-alex@example.invalid" not in response.body.decode()
