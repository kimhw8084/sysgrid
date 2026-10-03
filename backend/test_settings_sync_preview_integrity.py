"""Preview mode must never be inferred from a malformed synchronization flag."""
import pytest
from sqlalchemy import select

from app.models import models
from test_chg13_authorization_security import _grant_access, _tenant_db
from test_settings_operator_input_integrity import operator_scope, snapshot


async def prepare_sync(c, setup_db):
    async with _tenant_db(setup_db, c['tenant']) as db:
        for op_id in c['ids']:
            row = await db.get(models.Operator, op_id)
            row.team_source = 'synced'
        await db.commit()
    return {'records': [{
        'external_id': 'source-user', 'username': 'source-user', 'full_name': 'Source user',
        'team': 'Source team',
    }], 'source': 'controlled-test-source'}


@pytest.mark.asyncio
@pytest.mark.parametrize('value', [None, 0, 1, 'false', 'true', [], {}, ['true']])
async def test_invalid_preview_flag_neither_writes_nor_deletes_identity_state(operator_scope, setup_db, value):
    c = operator_scope
    payload = await prepare_sync(c, setup_db)
    before = await snapshot(c, setup_db)
    response = await c['client'].post('/api/v1/settings/user-pool/refresh', headers=c['headers'], json={**payload, 'preview': value})
    assert await snapshot(c, setup_db) == before
    assert response.status_code == 422, response.text
    assert response.json()['detail']['field_errors'] == {'preview': 'Must be a boolean'}


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['preview', 'execute', 'omitted'])
async def test_preview_and_execution_preserve_explicit_supported_contract(operator_scope, setup_db, mode):
    c = operator_scope
    payload = await prepare_sync(c, setup_db)
    if mode != 'omitted':
        payload['preview'] = mode == 'preview'
    before = await snapshot(c, setup_db)
    response = await c['client'].post('/api/v1/settings/user-pool/refresh', headers=c['headers'], json=payload)
    assert response.status_code == 200, response.text
    if mode == 'preview':
        assert await snapshot(c, setup_db) == before
        result = response.json()
        assert result['summary']['added'] == 1 and result['summary']['removed'] == 2
        assert sorted(row['status'] for row in result['preview']) == ['new', 'removed', 'removed']
    else:
        async with _tenant_db(setup_db, c['tenant']) as db:
            old = (await db.scalars(select(models.Operator).where(models.Operator.id.in_(c['ids'])))).all()
            assert old == []
            created = await db.scalar(select(models.Operator).where(models.Operator.external_id == 'source-user'))
            assert created.full_name == 'Source user' and created.team == 'Source team'
            assert created.team_source == 'synced'
            versions = (await db.scalars(select(models.UserPoolVersion))).all()
            assert len(versions) == 1 and versions[0].created_by == 'admin_root'
            assert versions[0].diff_summary['added'] == 1 and versions[0].diff_summary['removed'] == 2


@pytest.mark.asyncio
async def test_settings_reader_cannot_preview_or_apply_identity_replacement(operator_scope, setup_db):
    c = operator_scope
    payload = await prepare_sync(c, setup_db)
    await _grant_access(setup_db, tenant_id=c['tenant'], user_id='sync-reader', role='VIEWER')
    async with _tenant_db(setup_db, c['tenant']) as db:
        db.add(models.Operator(username='sync-reader', is_admin=False, custom_permissions={'settings': 1}))
        await db.commit()
    before = await snapshot(c, setup_db)
    for preview in [True, False]:
        response = await c['client'].post('/api/v1/settings/user-pool/refresh', headers={**c['headers'], 'X-User-Id': 'sync-reader'}, json={**payload, 'preview': preview})
        assert response.status_code == 403, response.text
        assert await snapshot(c, setup_db) == before
