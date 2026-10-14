"""Company identity comes from the configured process environment, never the browser."""
import pytest
from fastapi import HTTPException, Request

from app.api.utils import get_current_user_id
from app.core.config import Settings, settings
from test_production_startup_policy import safe_production_values


def request_with_identity(value='browser-admin'):
    return Request({'type': 'http', 'headers': [(b'x-user-id', value.encode()), (b'x-authenticated-user', value.encode())]})


@pytest.fixture
def environment_identity(monkeypatch):
    monkeypatch.setattr(settings, 'IDENTITY_MODE', 'environment')
    monkeypatch.setattr(settings, 'USER_ID_ENV_VAR', 'SYSGRID_TEST_COMPANY_IDENTITY')
    monkeypatch.delenv('SYSGRID_TEST_COMPANY_IDENTITY', raising=False)


def test_environment_mode_ignores_all_browser_identity_headers(environment_identity, monkeypatch):
    monkeypatch.setenv('SYSGRID_TEST_COMPANY_IDENTITY', 'company-user')
    assert get_current_user_id(request_with_identity()) == 'company-user'
    assert get_current_user_id() == 'company-user'


@pytest.mark.parametrize('value', [None, '', '   ', 'x' * 201, 'invalid\nidentity'])
def test_missing_or_invalid_environment_identity_has_no_fallback(environment_identity, monkeypatch, value):
    if value is not None:
        monkeypatch.setenv('SYSGRID_TEST_COMPANY_IDENTITY', value)
    monkeypatch.setenv('USER_ID', 'legacy-admin')
    monkeypatch.setenv('user_name', 'legacy-admin')
    for request in (request_with_identity(), None):
        with pytest.raises(HTTPException) as error:
            get_current_user_id(request)
        assert error.value.status_code == 401
        assert 'legacy-admin' not in error.value.detail
        assert 'browser-admin' not in error.value.detail


def test_production_accepts_explicit_environment_identity(monkeypatch):
    monkeypatch.delenv('TESTING', raising=False)
    monkeypatch.setenv('SYSGRID_TEST_COMPANY_IDENTITY', 'company-user')
    values = safe_production_values()
    values.update(IDENTITY_MODE='environment', USER_ID_ENV_VAR='SYSGRID_TEST_COMPANY_IDENTITY')
    values.pop('TRUSTED_PROXY_USER_HEADER')
    assert Settings(_env_file=None, **values).production_guard_errors() == []


@pytest.mark.parametrize('variable', [None, 'BAD-NAME', 'SYSGRID_TEST_MISSING_IDENTITY'])
def test_production_rejects_unconfigured_environment_identity(monkeypatch, variable):
    monkeypatch.delenv('TESTING', raising=False)
    monkeypatch.delenv('SYSGRID_TEST_MISSING_IDENTITY', raising=False)
    values = safe_production_values()
    values['IDENTITY_MODE'] = 'environment'
    if variable is not None:
        values['USER_ID_ENV_VAR'] = variable
    errors = Settings(_env_file=None, **values).production_guard_errors()
    assert any('USER_ID_ENV_VAR' in error or 'environment identity' in error for error in errors)


@pytest.mark.asyncio
async def test_spoofed_browser_admin_cannot_cross_environment_tenant_boundary(seeded_admin_tenant, environment_identity, monkeypatch):
    tenant_id = seeded_admin_tenant['tenant_id']
    monkeypatch.setenv('SYSGRID_TEST_COMPANY_IDENTITY', 'unassigned-company-user')
    response = await seeded_admin_tenant['client'].get('/api/v1/devices', headers={'X-User-Id': 'admin_root', 'X-Tenant-Id': str(tenant_id)})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_authorized_environment_identity_retains_tenant_access(seeded_admin_tenant, environment_identity, monkeypatch):
    monkeypatch.setenv('SYSGRID_TEST_COMPANY_IDENTITY', 'admin_root')
    response = await seeded_admin_tenant['client'].get('/api/v1/devices', headers={'X-User-Id': 'untrusted-user', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])})
    assert response.status_code == 200


def test_websocket_missing_environment_identity_closes_with_policy_error(environment_identity):
    from fastapi.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect
    from app.main import app
    with pytest.raises(WebSocketDisconnect) as error:
        with TestClient(app).websocket_connect('/api/v1/ws/sync?tenant_id=1', headers={'origin': 'http://localhost', 'x-user-id': 'browser-admin'}):
            pass
    assert error.value.code == 1008
    assert 'identity' in error.value.reason


@pytest.mark.asyncio
async def test_missing_environment_identity_rejects_api_request(seeded_admin_tenant, environment_identity):
    response = await seeded_admin_tenant['client'].get('/api/v1/devices', headers={'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])})
    assert response.status_code == 401


def test_unknown_identity_mode_does_not_accept_browser_fallback(monkeypatch):
    monkeypatch.setattr(settings, 'IDENTITY_MODE', 'environmnt')
    with pytest.raises(HTTPException) as error:
        get_current_user_id(request_with_identity())
    assert error.value.status_code == 401
