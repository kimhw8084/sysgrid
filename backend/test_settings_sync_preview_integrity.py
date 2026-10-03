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


@pytest.mark.asyncio
@pytest.mark.parametrize(('source', 'incoming_team', 'change_profile'), [
    ('manual_override', 'Remote team', False),
    ('manual_override', None, False),
    ('manual_override', 'Remote team', True),
    ('manual', None, False),
    ('synced', 'Remote team', False),
    ('synced', None, False),
])
async def test_sync_preview_matches_applied_team_authority(operator_scope, setup_db, source, incoming_team, change_profile):
    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        team = models.Team(name='Local team')
        db.add(team)
        await db.flush()
        row = await db.get(models.Operator, c['ids'][0])
        row.team_id, row.team, row.team_source = team.id, team.name, source
        registration_status = row.registration_status
        await db.commit()
        team_id = team.id
    payload = {'records': [{
        'external_id': 'input-target', 'username': 'input-target',
        'full_name': 'Updated name' if change_profile else 'Original name', 'team': incoming_team,
        'registration_status': registration_status,
    }], 'source': 'controlled-test-source'}
    before = await snapshot(c, setup_db)
    preview = await c['client'].post('/api/v1/settings/user-pool/refresh', headers=c['headers'], json={**payload, 'preview': True})
    assert preview.status_code == 200, preview.text
    assert await snapshot(c, setup_db) == before
    applied = await c['client'].post('/api/v1/settings/user-pool/refresh', headers=c['headers'], json={**payload, 'preview': False})
    assert applied.status_code == 200, applied.text
    blocked = source != 'synced'
    expected_changes = 1 if change_profile or not blocked else 0
    async with _tenant_db(setup_db, c['tenant']) as db:
        row = await db.get(models.Operator, c['ids'][0])
        assert row.team == ('Local team' if blocked else incoming_team)
        if blocked:
            assert row.team_id == team_id and row.team_source == source
            assert (await db.scalars(select(models.Team).where(models.Team.name == 'Remote team'))).all() == []
            assert (await db.scalars(select(models.TeamAudit))).all() == []
        versions = (await db.scalars(select(models.UserPoolVersion))).all()
        assert len(versions) == expected_changes
        if versions:
            assert versions[0].diff_summary == preview.json()['summary']
    result = preview.json()
    assert result['summary']['changed'] == expected_changes
    assert result['summary']['added'] == result['summary']['removed'] == 0
    assert result['summary']['team_conflicts'] == ([{
        'external_id': 'input-target', 'local_team': 'Local team', 'synced_team': incoming_team,
    }] if blocked else [])
    item = result['preview'][0]
    assert item['team'] == ('Local team' if blocked else incoming_team)
    assert item['status'] == ('changed' if expected_changes else 'unchanged')
    assert ('team' in item['changes']) is not blocked
    assert ('full_name' in item['changes']) is change_profile
    assert applied.json()['changes'] is bool(expected_changes)
    assert applied.json()['summary'] == result['summary']
    if not expected_changes:
        assert await snapshot(c, setup_db) == before
