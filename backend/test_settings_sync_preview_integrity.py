"""Preview mode and reviewed identity state must survive malformed inputs and races."""
import asyncio
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


@pytest.mark.asyncio
@pytest.mark.parametrize('change', ['profile', 'permissions', 'team_authority', 'teams', 'records', 'source'])
async def test_reviewed_sync_rejects_changed_state_or_input(operator_scope, setup_db, change):
    c = operator_scope
    payload = await prepare_sync(c, setup_db)
    preview = await c['client'].post('/api/v1/settings/user-pool/refresh', headers=c['headers'], json={**payload, 'preview': True})
    assert preview.status_code == 200, preview.text
    fingerprint = preview.json().get('fingerprint', '0' * 64)
    if change == 'teams':
        async with _tenant_db(setup_db, c['tenant']) as db:
            db.add(models.Team(name='Independent team'))
            await db.commit()
    elif change in {'profile', 'permissions', 'team_authority'}:
        async with _tenant_db(setup_db, c['tenant']) as db:
            row = await db.get(models.Operator, c['ids'][0])
            if change == 'profile':
                row.full_name = 'Independent update'
            elif change == 'permissions':
                row.custom_permissions = {'settings': 2}
            else:
                row.team_source = 'manual_override'
            await db.commit()
    elif change == 'records':
        payload['records'][0]['full_name'] = 'Unreviewed name'
    else:
        payload['source'] = 'Unreviewed source'
    before = await snapshot(c, setup_db)
    applied = await c['client'].post('/api/v1/settings/user-pool/refresh', headers=c['headers'], json={**payload, 'preview': False, 'expected_fingerprint': fingerprint})
    assert await snapshot(c, setup_db) == before
    assert applied.status_code == 409, applied.text
    assert 'Preview again' in applied.json()['detail']


@pytest.mark.asyncio
@pytest.mark.parametrize('value', [None, False, 42, '', 'invalid', 'g' * 64, [], {}])
async def test_malformed_review_fingerprint_never_applies(operator_scope, setup_db, value):
    c = operator_scope
    payload = await prepare_sync(c, setup_db)
    before = await snapshot(c, setup_db)
    response = await c['client'].post('/api/v1/settings/user-pool/refresh', headers=c['headers'], json={**payload, 'preview': False, 'expected_fingerprint': value})
    assert await snapshot(c, setup_db) == before
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_reviewed_sync_applies_exact_input_once_and_rejects_old_review(operator_scope, setup_db):
    c = operator_scope
    payload = await prepare_sync(c, setup_db)
    before = await snapshot(c, setup_db)
    preview = await c['client'].post('/api/v1/settings/user-pool/refresh', headers=c['headers'], json={**payload, 'preview': True})
    assert preview.status_code == 200, preview.text
    assert await snapshot(c, setup_db) == before
    fingerprint = preview.json()['fingerprint']
    assert len(fingerprint) == 64 and all(char in '0123456789abcdef' for char in fingerprint)
    repeated_preview = await c['client'].post('/api/v1/settings/user-pool/refresh', headers=c['headers'], json={**payload, 'preview': True})
    assert repeated_preview.json()['fingerprint'] == fingerprint
    reviewed = {**payload, 'preview': False, 'expected_fingerprint': fingerprint}
    applied = await c['client'].post('/api/v1/settings/user-pool/refresh', headers=c['headers'], json=reviewed)
    assert applied.status_code == 200, applied.text
    assert applied.json()['summary'] == preview.json()['summary']
    after = await snapshot(c, setup_db)
    assert after != before
    repeated = await c['client'].post('/api/v1/settings/user-pool/refresh', headers=c['headers'], json=reviewed)
    assert repeated.status_code == 409, repeated.text
    assert await snapshot(c, setup_db) == after


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['same_update', 'different_updates', 'same_creation'])
async def test_concurrent_reviewed_sync_has_one_winner(operator_scope, setup_db, monkeypatch, operation):
    from app.api import authorization

    c = operator_scope
    name = 'concurrent-new' if operation == 'same_creation' else 'input-target'
    payloads = [{'records': [{
        'external_id': name, 'username': name, 'full_name': 'First reviewed name',
        'registration_status': 'Pending',
    }], 'source': 'controlled-concurrent-source'} for _ in range(2)]
    if operation == 'different_updates':
        payloads[1]['records'][0]['full_name'] = 'Second reviewed name'
    for payload in payloads:
        response = await c['client'].post('/api/v1/settings/user-pool/refresh', headers=c['headers'], json={**payload, 'preview': True})
        assert response.status_code == 200, response.text
        payload.update(preview=False, expected_fingerprint=response.json()['fingerprint'])

    # Both real requests resolve their initial authorization before either can
    # enter the mutation. Each request still uses its own real database session.
    ready = asyncio.Event()
    sessions = set()
    original = authorization.resolve_current_operator

    async def synchronized_authorization(request, db):
        result = await original(request, db)
        if db not in sessions:
            sessions.add(db)
            if len(sessions) == 2:
                ready.set()
            await asyncio.wait_for(ready.wait(), 5)
        return result

    monkeypatch.setattr(authorization, 'resolve_current_operator', synchronized_authorization)
    responses = await asyncio.wait_for(asyncio.gather(*[
        c['client'].post('/api/v1/settings/user-pool/refresh', headers=c['headers'], json=payload)
        for payload in payloads
    ], return_exceptions=True), 10)
    assert not any(isinstance(response, BaseException) for response in responses), [repr(response) for response in responses]
    assert sorted(response.status_code for response in responses) == [200, 409], [response.text for response in responses]
    winner = next(index for index, response in enumerate(responses) if response.status_code == 200)
    assert responses[winner].json()['changes'] is True
    async with _tenant_db(setup_db, c['tenant']) as db:
        row = await db.scalar(select(models.Operator).where(models.Operator.external_id == name))
        assert row.full_name == payloads[winner]['records'][0]['full_name']
        versions = (await db.scalars(select(models.UserPoolVersion))).all()
        assert len(versions) == 1 and versions[0].is_active
        saved = next(item for item in versions[0].snapshot_data if item['external_id'] == name)
        assert saved['full_name'] == row.full_name


@pytest.mark.asyncio
@pytest.mark.parametrize('grant', ['admin', 'custom', 'role'])
@pytest.mark.parametrize('preview', [True, False])
async def test_sync_rechecks_revoked_authority_after_initial_resolution(operator_scope, setup_db, monkeypatch, grant, preview):
    from app.api import authorization

    c = operator_scope
    await _grant_access(setup_db, tenant_id=c['tenant'], user_id='sync-manager', role='EDITOR')
    async with _tenant_db(setup_db, c['tenant']) as db:
        role = models.Role(name='Concurrent sync role', permissions={'settings': 3} if grant == 'role' else {})
        db.add(role)
        await db.flush()
        manager = models.Operator(username='sync-manager', is_admin=grant == 'admin', role_id=role.id,
                                  custom_permissions={'settings': 3} if grant == 'custom' else {})
        db.add(manager)
        await db.commit()
        manager_id, role_id = manager.id, role.id
    resolved, release = asyncio.Event(), asyncio.Event()
    original = authorization.resolve_current_operator
    held = False

    async def hold_initial_authority(request, db):
        nonlocal held
        result = await original(request, db)
        if not held:
            held = True
            resolved.set()
            await release.wait()
        return result

    monkeypatch.setattr(authorization, 'resolve_current_operator', hold_initial_authority)
    task = asyncio.create_task(c['client'].post('/api/v1/settings/user-pool/refresh',
        headers={**c['headers'], 'X-User-Id': 'sync-manager'},
        json={'preview': preview, 'records': [{'external_id': 'input-target', 'username': 'input-target', 'full_name': 'Revoked write'}]}))
    try:
        await asyncio.wait_for(resolved.wait(), 5)
        async with _tenant_db(setup_db, c['tenant']) as db:
            manager = await db.get(models.Operator, manager_id)
            manager.is_admin = False
            manager.custom_permissions = {}
            role = await db.get(models.Role, role_id)
            role.permissions = {}
            await db.commit()
        before = await snapshot(c, setup_db)
    finally:
        release.set()
        response = await asyncio.wait_for(task, 10)
    assert response.status_code == 403, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_preview_uses_one_read_snapshot_without_blocking_a_writer(operator_scope, setup_db, monkeypatch):
    from app.api import settings as settings_api

    c = operator_scope
    payload = {'preview': True, 'records': [{
        'external_id': 'input-target', 'username': 'input-target', 'full_name': 'Reviewed update',
        'registration_status': 'Pending',
    }]}
    captured, release = asyncio.Event(), asyncio.Event()
    original = settings_api.build_user_pool_snapshot

    async def hold_snapshot(db):
        result = await original(db)
        captured.set()
        await release.wait()
        return result

    monkeypatch.setattr(settings_api, 'build_user_pool_snapshot', hold_snapshot)
    task = asyncio.create_task(c['client'].post('/api/v1/settings/user-pool/refresh', headers=c['headers'], json=payload))
    try:
        await asyncio.wait_for(captured.wait(), 5)
        async with _tenant_db(setup_db, c['tenant']) as db:
            row = await db.get(models.Operator, c['ids'][0])
            row.full_name = 'Independent committed update'
            await asyncio.wait_for(db.commit(), 5)
        after_writer = await snapshot(c, setup_db)
    finally:
        release.set()
        response = await asyncio.wait_for(task, 10)
    assert response.status_code == 200, response.text
    item = next(item for item in response.json()['preview'] if item['id'] == 'input-target')
    assert item['changes']['full_name'] == {'old': 'Original name', 'new': 'Reviewed update'}
    assert await snapshot(c, setup_db) == after_writer
    applied = await c['client'].post('/api/v1/settings/user-pool/refresh', headers=c['headers'],
        json={**payload, 'preview': False, 'expected_fingerprint': response.json()['fingerprint']})
    assert applied.status_code == 409, applied.text
    assert await snapshot(c, setup_db) == after_writer


@pytest.mark.asyncio
async def test_busy_sync_reports_conflict_and_releases_its_transaction(operator_scope, setup_db):
    c = operator_scope
    payload = {'records': [{'external_id': 'input-target', 'username': 'input-target', 'full_name': 'After contention'}]}
    before = await snapshot(c, setup_db)
    async with _tenant_db(setup_db, c['tenant']) as writer:
        row = await writer.get(models.Operator, c['ids'][0])
        row.full_name = 'Uncommitted competing write'
        await writer.flush()
        response = await c['client'].post('/api/v1/settings/user-pool/refresh', headers=c['headers'], json=payload)
        assert response.status_code == 409, response.text
        assert 'busy' in response.json()['detail']
        await writer.rollback()
    assert await snapshot(c, setup_db) == before
    response = await c['client'].post('/api/v1/settings/user-pool/refresh', headers=c['headers'], json=payload)
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        assert (await db.get(models.Operator, c['ids'][0])).full_name == 'After contention'
        assert len((await db.scalars(select(models.UserPoolVersion))).all()) == 1
