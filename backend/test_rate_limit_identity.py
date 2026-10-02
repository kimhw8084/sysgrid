"""Mutation budgets follow the authenticated principal, not request hints."""
import pytest

from app.core.config import settings
from app.main import app
from app.observability import SlidingWindowRateLimiter


@pytest.fixture
def one_request_budget(monkeypatch):
    monkeypatch.setattr(settings, 'RATE_LIMIT_ENABLED', True)
    monkeypatch.setattr(app.state, 'rate_limiter', SlidingWindowRateLimiter(limit=1, window_seconds=60))


@pytest.mark.asyncio
@pytest.mark.parametrize('identity,first_status', [('admin_root', 400), (None, 401)])
async def test_environment_identity_cannot_rotate_browser_headers_to_reset_budget(
    seeded_admin_tenant, one_request_budget, monkeypatch, identity, first_status,
):
    monkeypatch.setattr(settings, 'IDENTITY_MODE', 'environment')
    monkeypatch.setattr(settings, 'USER_ID_ENV_VAR', 'SYSGRID_TEST_LIMITER_IDENTITY')
    monkeypatch.delenv('SYSGRID_TEST_LIMITER_IDENTITY', raising=False)
    if identity:
        monkeypatch.setenv('SYSGRID_TEST_LIMITER_IDENTITY', identity)
    client = seeded_admin_tenant['client']
    headers = {'X-Tenant-Id': str(seeded_admin_tenant['tenant_id']), 'X-User-Id': 'spoof-one', 'X-Authenticated-User': 'spoof-one'}
    first = await client.post('/api/v1/devices', headers=headers, json={})
    assert first.status_code == first_status
    second = await client.post('/api/v1/devices', headers={**headers, 'X-User-Id': 'spoof-two', 'X-Authenticated-User': 'spoof-two', 'X-Forwarded-For': '192.0.2.9'}, json={})
    assert second.status_code == 429
    assert int(second.headers['Retry-After']) >= 1
    assert 'spoof' not in second.text


@pytest.mark.asyncio
async def test_custom_trusted_proxy_header_selects_independent_principal_budgets(
    seeded_admin_tenant, one_request_budget, monkeypatch,
):
    monkeypatch.setattr(settings, 'IDENTITY_MODE', 'trusted_proxy')
    monkeypatch.setattr(settings, 'TRUSTED_PROXY_USER_HEADER', 'X-Company-Principal')
    client = seeded_admin_tenant['client']
    headers = {'X-Tenant-Id': str(seeded_admin_tenant['tenant_id']), 'X-Company-Principal': 'admin_root', 'X-User-Id': 'spoof-one'}
    first = await client.post('/api/v1/devices', headers=headers, json={})
    assert first.status_code == 400
    second = await client.post('/api/v1/devices', headers={**headers, 'X-User-Id': 'spoof-two'}, json={})
    assert second.status_code == 429
    other = await client.post('/api/v1/devices', headers={**headers, 'X-Company-Principal': 'unassigned-company-user'}, json={})
    assert other.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize('method,path', [
    ('POST', '/api/v1/sites'),
    ('PUT', '/api/v1/devices/999'),
    ('PATCH', '/api/v1/devices/999'),
    ('DELETE', '/api/v1/devices/999'),
    ('GET', '/api/v1/devices/export'),
])
async def test_tenant_path_and_method_hints_cannot_reset_principal_budget(
    seeded_admin_tenant, one_request_budget, monkeypatch, method, path,
):
    monkeypatch.setattr(settings, 'IDENTITY_MODE', 'environment')
    monkeypatch.setattr(settings, 'USER_ID_ENV_VAR', 'SYSGRID_TEST_LIMITER_IDENTITY')
    monkeypatch.setenv('SYSGRID_TEST_LIMITER_IDENTITY', 'admin_root')
    client = seeded_admin_tenant['client']
    first = await client.post('/api/v1/devices', headers={'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}, json={})
    assert first.status_code == 400
    second = await client.request(method, path, headers={'X-Tenant-Id': 'arbitrary-unverified-scope'})
    assert second.status_code == 429
