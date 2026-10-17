"""Legacy rows cannot bypass deployment-owned configuration or failed saves."""
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.database import get_config_db, get_tenant_engine
from app.main import app
from app.models import models
from app.models.config import GlobalSetting, Tenant
from sqlalchemy.ext.asyncio import async_sessionmaker
from test_settings_api_edges import _ensure_admin


@pytest.mark.anyio
@pytest.mark.parametrize('endpoint', ['bootstrap', 'global'])
async def test_legacy_deployment_rows_do_not_escape_runtime_settings(seeded_admin_tenant, setup_db, endpoint):
    await _ensure_admin(seeded_admin_tenant, setup_db)
    synthetic_secret = 'synthetic-legacy-signing-value-never-a-real-secret'
    async with setup_db[1]() as config_db:
        config_db.add_all([
            GlobalSetting(key='SCHEDULE_PREVIEW_SIGNING_KEY', value=synthetic_secret, is_public=True),
            GlobalSetting(key='IDENTITY_MODE', value='development', is_public=True),
            GlobalSetting(key='DEFAULT_USER_ID', value='synthetic-untrusted-legacy-user', is_public=True),
            GlobalSetting(key='VITE_ORG_NAME', value='Preserved public customization', is_public=True),
        ])
        await config_db.commit()
    headers = {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}
    response = await seeded_admin_tenant['client'].get('/api/v1/settings/' + endpoint, headers=headers if endpoint == 'global' else {})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert synthetic_secret not in response.text
    assert 'SCHEDULE_PREVIEW_SIGNING_KEY' not in payload
    assert 'IDENTITY_MODE' not in payload
    assert payload['VITE_ORG_NAME'] == 'Preserved public customization'
    if endpoint == 'bootstrap':
        assert payload['DEFAULT_USER_ID'] == settings.DEFAULT_USER_ID
    else:
        assert 'DEFAULT_USER_ID' not in payload
        assert 'SCHEDULE_PREVIEW_SIGNING_KEY' not in payload['_metadata']
    async with setup_db[1]() as config_db:
        row = await config_db.scalar(select(GlobalSetting).where(GlobalSetting.key == 'SCHEDULE_PREVIEW_SIGNING_KEY'))
        assert row.value == synthetic_secret


@pytest.mark.anyio
async def test_failed_config_commit_does_not_hot_reload_memory(seeded_admin_tenant, setup_db, monkeypatch):
    await _ensure_admin(seeded_admin_tenant, setup_db)
    client = seeded_admin_tenant['client']
    headers = {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}
    monkeypatch.setattr(settings, 'DEFAULT_UI_TITLE', 'Original committed title')
    async with setup_db[1]() as config_db:
        config_db.add(GlobalSetting(key='DEFAULT_UI_TITLE', value='Original committed title', is_public=False))
        await config_db.commit()

    async def fail_config_commit():
        async with setup_db[1]() as config_db:
            monkeypatch.setattr(config_db, 'commit', AsyncMock(side_effect=RuntimeError('synthetic config commit failure')))
            yield config_db

    monkeypatch.setitem(app.dependency_overrides, get_config_db, fail_config_commit)
    response = await client.post('/api/v1/settings/global', headers=headers, json={'DEFAULT_UI_TITLE': 'Uncommitted title'})
    assert response.status_code == 500, response.text
    assert settings.DEFAULT_UI_TITLE == 'Original committed title'
    async with setup_db[1]() as config_db:
        row = await config_db.scalar(select(GlobalSetting).where(GlobalSetting.key == 'DEFAULT_UI_TITLE'))
        assert row.value == 'Original committed title'


@pytest.mark.anyio
@pytest.mark.parametrize('endpoint', ['history', 'audit'])
async def test_legacy_deployment_history_is_redacted_without_rewriting_evidence(seeded_admin_tenant, setup_db, endpoint):
    await _ensure_admin(seeded_admin_tenant, setup_db)
    old_value = 'synthetic-old-signing-value'
    new_value = 'synthetic-new-signing-value'
    async with setup_db[1]() as config_db:
        tenant = await config_db.get(Tenant, seeded_admin_tenant['tenant_id'])
        tenant_db_url = tenant.db_url
    sessions = async_sessionmaker(get_tenant_engine(tenant_db_url), expire_on_commit=False)
    async with sessions() as db:
        history = models.EnvHistory(field='SCHEDULE_PREVIEW_SIGNING_KEY', old_value=old_value, new_value=new_value, user='admin_root')
        audit = models.AuditLog(user_id='admin_root', action='UPDATE_SETTING', target_table='GLOBAL_SETTING', target_id='SCHEDULE_PREVIEW_SIGNING_KEY', changes={'old': old_value, 'new': new_value}, description='Legacy configuration change')
        db.add_all([history, audit])
        await db.commit()
        history_id, audit_id = history.id, audit.id
    headers = {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}
    if endpoint == 'history':
        response = await seeded_admin_tenant['client'].get('/api/v1/settings/env/history', headers=headers, params={'field': 'SCHEDULE_PREVIEW_SIGNING_KEY'})
    else:
        response = await seeded_admin_tenant['client'].get('/api/v1/audit', headers=headers, params={'target_table': 'GLOBAL_SETTING', 'target_id': 'SCHEDULE_PREVIEW_SIGNING_KEY'})
    assert response.status_code == 200, response.text
    assert old_value not in response.text and new_value not in response.text
    row = response.json()[0]
    assert row['id'] == (history_id if endpoint == 'history' else audit_id)
    if endpoint == 'history':
        assert row['old_value'] == row['new_value'] == '[redacted]'
    else:
        assert row['changes'] == {'old': '[redacted]', 'new': '[redacted]'}
        assert row['description'] == 'Legacy configuration change'
    async with sessions() as db:
        assert (await db.get(models.EnvHistory, history_id)).old_value == old_value
        assert (await db.get(models.AuditLog, audit_id)).changes == {'old': old_value, 'new': new_value}
