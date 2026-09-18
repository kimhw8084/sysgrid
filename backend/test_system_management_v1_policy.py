import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.api import module_policy
from app.api.module_policy import CATALOG, _build_module_entry, ensure_module_access
from app.api.authorization import has_capability
from app.api.settings import reject_reserved_system_root_identity
from app.core.config import settings
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
async def test_embedded_projection_is_read_only_and_requires_a_selector(monkeypatch):
    knowledge = next(item for item in CATALOG["modules"] if item["id"] == "knowledge")
    monitoring = next(item for item in CATALOG["modules"] if item["id"] == "monitoring")
    policy = {
        "modules": {
            "knowledge": _build_module_entry(knowledge, operator=_operator(permissions={"knowledge": 3}), system_root=False),
            "monitoring": _build_module_entry(monitoring, operator=_operator(permissions={"monitoring": 3}), system_root=False),
        }
    }

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
