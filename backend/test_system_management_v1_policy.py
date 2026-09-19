import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.api import module_policy
from app.api.knowledge import _embedded_entry_is_in_scope, _require_embedded_targets
from app.api.module_policy import CATALOG, _build_module_entry, ensure_module_access
from app.api.authorization import has_capability
from app.api.settings import reject_reserved_system_root_identity
from app.core.config import settings
from app.main import ConnectionManager
from fastapi import Request, HTTPException


def _operator(*, permissions=None, is_admin=False):
    return SimpleNamespace(
        role=SimpleNamespace(permissions=permissions or {}),
        custom_permissions={},
        is_admin=is_admin,
    )


def test_catalog_is_single_versioned_non_executable_contract():
    catalog_path = Path(__file__).resolve().parents[1] / "contracts" / "system_management_v1.json"
    assert json.loads(catalog_path.read_text(encoding="utf-8")) == CATALOG
    assert set(CATALOG["stages"]) == {"production", "preview", "disabled", "retired"}
    assert all("component" not in module and "executable" not in module for module in CATALOG["modules"])
    module_ids = {module["id"] for module in CATALOG["modules"]}
    assert set(CATALOG["api_ownership"]).issubset(module_ids)
    assert all(path.startswith("/api/") for paths in CATALOG["api_ownership"].values() for path in paths)
    knowledge_projection = next(
        projection
        for module in CATALOG["modules"]
        if module["id"] == "knowledge"
        for projection in module["embedded_support_projections"]
        if projection["id"] == "knowledge-recovery-context"
    )
    assert "allowed_selectors" not in knowledge_projection
    assert knowledge_projection["consumer_selector_sets"] == {
        "monitoring": [["monitoring_id"]],
        "assets": [["device_id"]],
        "network": [["device_id"]],
        "services": [["service_id"]],
    }


@pytest.mark.parametrize("stage", ["production", "preview", "disabled", "retired"])
def test_module_stages_are_distinct_and_fail_closed(stage, monkeypatch):
    monkeypatch.setattr(settings, "MODULE_STAGE_OVERRIDES", f"knowledge={stage}")
    monkeypatch.setattr(settings, "SYSTEM_ROOT_USER_IDS", "system-root")
    module = next(item for item in CATALOG["modules"] if item["id"] == "knowledge")

    normal = _build_module_entry(module, operator=_operator(permissions={"knowledge": 3}), system_root=False)
    root = _build_module_entry(module, operator=_operator(permissions={"knowledge": 3}), system_root=True)

    assert normal["stage"] == stage
    if stage == "production":
        assert normal["available"] is True
    elif stage in {"disabled", "retired"}:
        assert normal["available"] is False
        assert normal["blocked_reason"] == f"MODULE_{stage.upper()}"
    else:
        assert normal["available"] is False
        assert normal["blocked_reason"] == "SYSTEM_ROOT_REQUIRED"
        assert root["available"] is True
        assert root["root_preview"] is True


def test_tenant_admin_and_wildcard_do_not_become_system_root(monkeypatch):
    monkeypatch.setattr(settings, "SYSTEM_ROOT_USER_IDS", "haewon.kim")
    module = next(item for item in CATALOG["modules"] if item["id"] == "projects")
    tenant_admin = _build_module_entry(module, operator=_operator(is_admin=True), system_root=False)
    wildcard_admin = _build_module_entry(module, operator=_operator(permissions={"all": 3}), system_root=False)
    assert tenant_admin["available"] is False
    assert wildcard_admin["available"] is False
    assert tenant_admin["blocked_reason"] == "SYSTEM_ROOT_REQUIRED"
    assert has_capability(_operator(is_admin=True), "system.root", 3) is False
    assert has_capability(_operator(permissions={"all": 3}), "system.preview", 1) is False


def test_reserved_root_identity_cannot_be_manufactured_by_tenant_settings(monkeypatch):
    monkeypatch.setattr(settings, "SYSTEM_ROOT_USER_IDS", "haewon.kim")
    with pytest.raises(HTTPException) as exc:
        reject_reserved_system_root_identity(
            {"external_id": "haewon.kim", "username": "root-alias"},
            actor_id="ordinary-admin",
        )
    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "RESERVED_SYSTEM_ROOT_IDENTITY"
    reject_reserved_system_root_identity(
        {"external_id": "haewon.kim", "username": "haewon.kim"},
        actor_id="haewon.kim",
    )


@pytest.mark.anyio
async def test_embedded_projection_is_read_only_and_rejects_the_r1_monitoring_bypass(monkeypatch):
    policy = _embedded_policy()

    async def fake_policy(request, db):
        request.state.sysgrid_policy = policy
        return policy

    monkeypatch.setattr(module_policy, "build_effective_policy", fake_policy)
    request = Request({
        "type": "http",
        "method": "POST",
        "path": "/api/v1/knowledge",
        "headers": [],
        "query_string": b"embedded_consumer=monitoring&monitoring_id=1",
        "client": ("test", 1),
        "server": ("test", 80),
        "scheme": "http",
    })
    with pytest.raises(HTTPException) as exc:
        await ensure_module_access("knowledge", request, object(), allow_embedded=True)
    assert exc.value.status_code == 403
    assert exc.value.detail["reason"] == "READ_ONLY"

    request = Request({
        "type": "http",
        "method": "GET",
        "path": "/api/v1/knowledge",
        "headers": [],
        "query_string": b"embedded_consumer=monitoring",
        "client": ("test", 1),
        "server": ("test", 80),
        "scheme": "http",
    })
    with pytest.raises(HTTPException) as exc:
        await ensure_module_access("knowledge", request, object(), allow_embedded=True)
    assert exc.value.status_code == 403
    assert exc.value.detail["reason"] == "INVALID_SELECTOR_SET"


def _embedded_policy():
    operator = _operator(permissions={"all": 3})
    return {
        "modules": {
            module["id"]: _build_module_entry(module, operator=operator, system_root=False)
            for module in CATALOG["modules"]
        }
    }


def _request_with_query(query: str, method: str = "GET") -> Request:
    return Request({
        "type": "http",
        "method": method,
        "path": "/api/v1/knowledge",
        "headers": [],
        "query_string": query.encode(),
        "client": ("test", 1),
        "server": ("test", 80),
        "scheme": "http",
    })


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("query", "allowed"),
    [
        ("embedded_consumer=monitoring&monitoring_id=11", True),
        ("embedded_consumer=monitoring&device_id=11", False),
        ("embedded_consumer=monitoring&service_id=11", False),
        ("embedded_consumer=monitoring", False),
        ("embedded_consumer=monitoring&monitoring_id=", False),
        ("embedded_consumer=monitoring&monitoring_id=not-an-id", False),
        ("embedded_consumer=monitoring&embedded_consumer=monitoring&monitoring_id=11", False),
        ("embedded_consumer=assets&device_id=11", True),
        ("embedded_consumer=assets&monitoring_id=11", False),
        ("embedded_consumer=assets&device_id=11&service_id=12", False),
        ("embedded_consumer=services&service_id=12", True),
        ("embedded_consumer=services&device_id=11", False),
        ("embedded_consumer=network&device_id=11", True),
        ("embedded_consumer=network&monitoring_id=11", False),
        ("embedded_consumer=network&device_id=11&monitoring_id=12", False),
        ("embedded_consumer=network&service_id=12", False),
        ("embedded_consumer=network&device_id=11&service_id=12", False),
        ("embedded_consumer=unknown&device_id=11", False),
    ],
)
async def test_embedded_selector_matrix_is_consumer_specific(monkeypatch, query, allowed):
    policy = _embedded_policy()

    async def fake_policy(request, db):
        request.state.sysgrid_policy = policy
        return policy

    monkeypatch.setattr(module_policy, "build_effective_policy", fake_policy)
    request = _request_with_query(query)
    if allowed:
        result = await ensure_module_access("knowledge", request, object(), allow_embedded=True)
        assert result is policy
        assert request.state.sysgrid_embedded_projection == "knowledge-recovery-context"
    else:
        with pytest.raises(HTTPException) as exc:
            await ensure_module_access("knowledge", request, object(), allow_embedded=True)
        assert exc.value.status_code == 403
        assert exc.value.detail["code"] == "EMBEDDED_PROJECTION_DENIED"


@pytest.mark.anyio
async def test_embedded_projection_rejects_disabled_consumer_and_unsupported_module(monkeypatch):
    policy = _embedded_policy()
    policy["modules"]["monitoring"]["available"] = False

    async def fake_policy(request, db):
        request.state.sysgrid_policy = policy
        return policy

    monkeypatch.setattr(module_policy, "build_effective_policy", fake_policy)
    disabled_request = _request_with_query("embedded_consumer=monitoring&monitoring_id=11")
    with pytest.raises(HTTPException) as disabled_exc:
        await ensure_module_access("knowledge", disabled_request, object(), allow_embedded=True)
    assert disabled_exc.value.detail["reason"] == "CONSUMER_UNAVAILABLE"

    mismatched_request = _request_with_query("embedded_consumer=far&device_id=11")
    with pytest.raises(HTTPException) as mismatched_exc:
        await ensure_module_access("knowledge", mismatched_request, object(), allow_embedded=True)
    assert mismatched_exc.value.detail["reason"] == "CONSUMER_UNAVAILABLE"


@pytest.mark.anyio
async def test_embedded_scope_never_scans_all_monitoring_rows_without_monitoring_id():
    entry = SimpleNamespace(id=7, metadata_json={}, linked_device_ids=[])

    class UnexpectedDatabase:
        async def execute(self, query):
            raise AssertionError("embedded monitoring scope must not scan all monitoring rows")

    assert await _embedded_entry_is_in_scope(
        entry,
        consumer="monitoring",
        device_id=101,
        service_id=None,
        monitoring_id=None,
        db=UnexpectedDatabase(),
    ) is False


@pytest.mark.anyio
async def test_embedded_scope_keeps_consumer_relationships_narrow():
    entry = SimpleNamespace(
        id=7,
        linked_device_ids=[101],
        metadata_json={"links": {"service_ids": [303], "monitoring_ids": [202]}},
    )

    class RecoveryDatabase:
        async def execute(self, query):
            class ScalarResult:
                def scalars(self):
                    class Values:
                        def all(self):
                            return [[{"id": 7}]]
                    return Values()
            return ScalarResult()

    db = RecoveryDatabase()
    assert await _embedded_entry_is_in_scope(entry, consumer="monitoring", device_id=None, service_id=None, monitoring_id=202, db=db)
    assert await _embedded_entry_is_in_scope(entry, consumer="assets", device_id=101, service_id=None, monitoring_id=None, db=db)
    assert await _embedded_entry_is_in_scope(entry, consumer="services", device_id=None, service_id=303, monitoring_id=None, db=db)
    assert await _embedded_entry_is_in_scope(entry, consumer="network", device_id=101, service_id=None, monitoring_id=202, db=db)
    assert not await _embedded_entry_is_in_scope(entry, consumer="network", device_id=None, service_id=None, monitoring_id=202, db=db)
    assert not await _embedded_entry_is_in_scope(entry, consumer="monitoring", device_id=101, service_id=None, monitoring_id=None, db=db)
    assert not await _embedded_entry_is_in_scope(entry, consumer="services", device_id=101, service_id=None, monitoring_id=None, db=db)


@pytest.mark.anyio
async def test_embedded_target_resolution_is_tenant_scoped_and_fails_closed():
    request = _request_with_query("embedded_consumer=assets&device_id=99")
    request.state.sysgrid_embedded_projection = "knowledge-recovery-context"
    request.state.sysgrid_embedded_selectors = {"device_id": 99}
    queries = []

    class MissingTargetDB:
        async def execute(self, query):
            queries.append(str(query))

            class Result:
                def scalar_one_or_none(self):
                    return None

            return Result()

    request.state.tenant_id = 42
    with pytest.raises(HTTPException) as exc:
        await _require_embedded_targets(request, MissingTargetDB())
    assert exc.value.status_code == 404
    assert "devices.tenant_id" in queries[0]

    request = _request_with_query("embedded_consumer=monitoring&monitoring_id=99")
    request.state.sysgrid_embedded_projection = "knowledge-recovery-context"
    request.state.sysgrid_embedded_selectors = {"monitoring_id": 99}

    class AuthorizedTargetDB:
        async def execute(self, query):
            class Result:
                def scalar_one_or_none(self):
                    return 99

            return Result()

    await _require_embedded_targets(request, AuthorizedTargetDB())


@pytest.mark.anyio
async def test_websocket_broadcast_does_not_cross_tenant_connections():
    class FakeWebSocket:
        def __init__(self):
            self.messages = []

        async def accept(self):
            return None

        async def send_text(self, message):
            self.messages.append(message)

    manager = ConnectionManager()
    tenant_a = FakeWebSocket()
    tenant_b = FakeWebSocket()
    await manager.connect(tenant_a, user_id="user-a", tenant_id=101)
    await manager.connect(tenant_b, user_id="user-b", tenant_id=202)

    await manager.broadcast("TENANT_A_EVENT", tenant_id=101)

    assert tenant_a.messages == ["TENANT_A_EVENT"]
    assert tenant_b.messages == []
