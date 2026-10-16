"""Runtime customization must not become a deployment-security control plane."""
import pytest
from sqlalchemy import select
from app.models.config import GlobalSetting
from app.core.config import PRODUCTION_REQUIRED_ENV, settings
from test_settings_api_edges import _ensure_admin


@pytest.mark.anyio
@pytest.mark.parametrize(('key', 'value'), [
    ('IDENTITY_MODE', 'development'),
    ('USER_ID_ENV_VAR', 'SYNTHETIC_UNTRUSTED_IDENTITY'),
    ('TRUSTED_PROXY_USER_HEADER', 'X-User-Id'),
    ('ENVIRONMENT', 'development'),
    ('ALLOW_AUTO_ADMIN_IN_PRODUCTION', True),
    ('CONTROL_PLANE_BOOTSTRAP_ENABLED', True),
    ('RATE_LIMIT_ENABLED', False),
    ('SCHEDULE_PREVIEW_SIGNING_KEY', 'synthetic-key-never-a-secret'),
])
async def test_runtime_settings_reject_deployment_security_changes(seeded_admin_tenant, setup_db, key, value):
    await _ensure_admin(seeded_admin_tenant, setup_db)
    response = await seeded_admin_tenant['client'].post('/api/v1/settings/global',
        headers={'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])},
        json={key: value})
    assert response.status_code == 400, response.text
    async with setup_db[1]() as config_db:
        assert await config_db.scalar(select(GlobalSetting).where(GlobalSetting.key == key)) is None


@pytest.mark.anyio
@pytest.mark.parametrize('key', PRODUCTION_REQUIRED_ENV)
async def test_every_required_production_setting_stays_deployment_owned(seeded_admin_tenant, setup_db, key):
    await _ensure_admin(seeded_admin_tenant, setup_db)
    response = await seeded_admin_tenant['client'].post('/api/v1/settings/global',
        headers={'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])},
        json={key: 'synthetic-rejected-value'})
    assert response.status_code == 400, response.text


@pytest.mark.anyio
async def test_mixed_rejection_changes_neither_memory_nor_persisted_customization(seeded_admin_tenant, setup_db, monkeypatch):
    await _ensure_admin(seeded_admin_tenant, setup_db)
    client = seeded_admin_tenant['client']
    headers = {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}
    initial = await client.post('/api/v1/settings/global', headers=headers, json={'DEFAULT_UI_TITLE': 'Original title'})
    assert initial.status_code == 200, initial.text
    monkeypatch.setattr(settings, 'DEFAULT_UI_TITLE', 'Original title')
    rejected = await client.post('/api/v1/settings/global', headers=headers,
        json={'DEFAULT_UI_TITLE': 'Must not change', 'IDENTITY_MODE': 'development'})
    assert rejected.status_code == 400, rejected.text
    assert settings.DEFAULT_UI_TITLE == 'Original title'
    async with setup_db[1]() as config_db:
        row = await config_db.scalar(select(GlobalSetting).where(GlobalSetting.key == 'DEFAULT_UI_TITLE'))
        assert row.value == 'Original title'
    accepted = await client.post('/api/v1/settings/global', headers=headers,
        json={'DEFAULT_UI_TITLE': 'Approved custom title', 'VITE_ISSUE_URL': 'https://issues.invalid/new'})
    assert accepted.status_code == 200 and settings.DEFAULT_UI_TITLE == 'Approved custom title', accepted.text
