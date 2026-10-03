"""Administrative inputs preserve privilege intent and atomic user-pool writes."""
import asyncio
import pytest
import pytest_asyncio
from sqlalchemy import select

from app.database import get_db
from app.main import app
from app.models import models
from test_chg13_authorization_security import _grant_access, _tenant_db


@pytest_asyncio.fixture
async def operator_scope(seeded_admin_tenant, setup_db):
    tenant = seeded_admin_tenant['tenant_id']
    async with _tenant_db(setup_db, tenant) as db:
        rows = [models.Operator(external_id=name, username=name, is_admin=True,
                    full_name='Original name', custom_permissions={'settings': 1})
                for name in ['input-target', 'input-peer']]
        db.add_all(rows)
        await db.commit()
        c = {'tenant': tenant, 'client': seeded_admin_tenant['client'], 'ids': [row.id for row in rows],
             'headers': {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(tenant)}}
    override = app.dependency_overrides.pop(get_db)
    try:
        yield c
    finally:
        app.dependency_overrides[get_db] = override


async def snapshot(c, setup_db):
    async with _tenant_db(setup_db, c['tenant']) as db:
        result = {}
        for model in [models.Operator, models.Team, models.TeamAudit, models.UserPoolVersion]:
            rows = (await db.scalars(select(model).order_by(model.id))).all()
            result[model.__tablename__] = [{col.name: getattr(row, col.name) for col in model.__table__.columns} for row in rows]
        return result


@pytest.mark.asyncio
@pytest.mark.parametrize('groups', [
    ['Target', 'Other'], ['Other', 'Target'], ['Other', 'Target', 'Third'], ['Target', 'Other', 'Target'],
])
@pytest.mark.parametrize('operation', ['rename', 'delete'])
async def test_team_group_references_include_every_array_position(operator_scope, setup_db, groups, operation):
    from app.api.settings import create_user_pool_version

    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        team = models.Team(name='Target')
        db.add(team)
        await db.flush()
        for index, op_id in enumerate(c['ids']):
            row = await db.get(models.Operator, op_id)
            row.teams = groups
            if operation == 'rename' and index == 0:
                row.team_id, row.team, row.team_source = team.id, team.name, 'manual'
        await create_user_pool_version(db, created_by='admin_root', diff_summary={})
        await db.commit()
        team_id = team.id
    before = await snapshot(c, setup_db)
    endpoint = f'/api/v1/settings/teams/{team_id}'
    if operation == 'delete':
        response = await c['client'].delete(endpoint, headers=c['headers'])
        assert response.status_code == 400, response.text
        assert 'operator groups' in response.json()['detail']
        assert await snapshot(c, setup_db) == before
        # Removing the actual references permits a later explicit deletion.
        for op_id in c['ids']:
            repaired = await c['client'].patch(f'/api/v1/settings/operators/{op_id}', headers=c['headers'], json={'teams': ['Other']})
            assert repaired.status_code == 200, repaired.text
        removed = await c['client'].delete(endpoint, headers=c['headers'])
        assert removed.status_code == 200, removed.text
        async with _tenant_db(setup_db, c['tenant']) as db:
            assert await db.get(models.Team, team_id) is None
            for op_id in c['ids']:
                assert (await db.get(models.Operator, op_id)).teams == ['Other']
        return
    response = await c['client'].patch(endpoint, headers=c['headers'], json={'name': 'Renamed'})
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        expected = sorted({'Renamed' if value == 'Target' else value for value in groups}, key=str.lower)
        for index, op_id in enumerate(c['ids']):
            row = await db.get(models.Operator, op_id)
            assert row.teams == expected
            assert row.team == ('Renamed' if index == 0 else None)
            assert row.custom_permissions == {'settings': 1}
        versions = (await db.scalars(select(models.UserPoolVersion).order_by(models.UserPoolVersion.id))).all()
        assert len(versions) == 2 and not versions[0].is_active and versions[1].is_active
        assert versions[0].snapshot_data == before[models.UserPoolVersion.__tablename__][0]['snapshot_data']
        assert all(record['teams'] == expected for record in versions[1].snapshot_data if record['id'] in c['ids'])
        audits = (await db.scalars(select(models.TeamAudit))).all()
        assert len(audits) == 1 and audits[0].action == 'team_updated'


@pytest.mark.asyncio
@pytest.mark.parametrize('name,unrelated', [('Ops_%', 'OpsXY'), ('Ops_', 'OpsX'), ('Ops%', 'OpsLong'), ('팀_%', '팀AB')])
async def test_team_group_references_use_literal_names_not_sql_wildcards(operator_scope, setup_db, name, unrelated):
    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        team = models.Team(name=name)
        db.add(team)
        row = await db.get(models.Operator, c['ids'][0])
        row.teams = [unrelated]
        await db.commit()
        team_id = team.id
    before = await snapshot(c, setup_db)
    response = await c['client'].delete(f'/api/v1/settings/teams/{team_id}', headers=c['headers'])
    assert response.status_code == 200, response.text
    after = await snapshot(c, setup_db)
    assert after[models.Operator.__tablename__] == before[models.Operator.__tablename__]
    assert not any(row['id'] == team_id for row in after[models.Team.__tablename__])


@pytest.mark.asyncio
@pytest.mark.parametrize('groups', ['Target', {'Target': True}, [1], False])
@pytest.mark.parametrize('operation', ['rename', 'delete'])
async def test_team_group_references_reject_uncertain_stored_memberships_atomically(operator_scope, setup_db, groups, operation):
    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        team = models.Team(name='Target')
        db.add(team)
        await db.flush()
        first = await db.get(models.Operator, c['ids'][0])
        first.team_id, first.team, first.teams = team.id, team.name, ['Target', 'Other']
        if operation == 'delete':
            first.team_id, first.team, first.teams = None, None, []
        peer = await db.get(models.Operator, c['ids'][1])
        peer.teams = groups
        await db.commit()
        team_id = team.id
    before = await snapshot(c, setup_db)
    endpoint = f'/api/v1/settings/teams/{team_id}'
    response = await (c['client'].patch(endpoint, headers=c['headers'], json={'name': 'Renamed'})
                      if operation == 'rename' else c['client'].delete(endpoint, headers=c['headers']))
    assert response.status_code == 422, response.text
    assert f'operators[{c["ids"][1]}].teams' in response.json()['detail']['field_errors']
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('groups', [['Secondary'], ['Secondary', 'Third'], [' Primary ', 'Secondary'], None, []])
async def test_restore_keeps_primary_team_in_group_memberships_without_rewriting_history(operator_scope, setup_db, groups):
    c = operator_scope
    version_id, _, original = await field_restore_fixture(c, setup_db, payload={'team': 'Primary', 'teams': groups})
    endpoint = f'/api/v1/settings/user-pool/restore/{version_id}'
    before = await snapshot(c, setup_db)
    preview = await c['client'].post(endpoint, headers=c['headers'], json={'preview': True})
    assert preview.status_code == 200, preview.text
    assert preview.json()['summary'] == {'added': 0, 'removed': 0, 'changed': 2}
    assert await snapshot(c, setup_db) == before
    response = await c['client'].post(endpoint, headers=c['headers'], json={'expected_fingerprint': preview.json()['fingerprint']})
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        peer = await db.get(models.Operator, c['ids'][1])
        expected = sorted({'Primary', *(name.strip() for name in (groups or []))}, key=str.lower)
        assert peer.team == 'Primary' and peer.team_id is not None and peer.teams == expected
        assert (await db.get(models.Team, peer.team_id)).name == 'Primary'
        versions = (await db.scalars(select(models.UserPoolVersion).order_by(models.UserPoolVersion.id))).all()
        assert len(versions) == 2 and versions[0].snapshot_data == original
        saved = next(record for record in versions[1].snapshot_data if record['id'] == peer.id)
        assert saved['teams'] == expected and saved['team'] == 'Primary'
        assert versions[1].diff_summary['changed'] == 2


@pytest.mark.asyncio
async def test_team_group_reference_rename_rolls_back_if_revision_cannot_be_recorded(operator_scope, setup_db, monkeypatch):
    from fastapi import HTTPException
    from app.api import settings as settings_api

    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        team = models.Team(name='Target')
        db.add(team)
        await db.flush()
        row = await db.get(models.Operator, c['ids'][0])
        row.team_id, row.team, row.teams = team.id, team.name, ['Target', 'Other']
        await db.commit()
        team_id = team.id
    before = await snapshot(c, setup_db)
    async def unavailable(*args, **kwargs):
        raise HTTPException(503, 'Controlled revision failure')
    monkeypatch.setattr(settings_api, 'create_user_pool_version', unavailable)
    response = await c['client'].patch(f'/api/v1/settings/teams/{team_id}', headers=c['headers'], json={'name': 'Renamed'})
    assert response.status_code == 503, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'patch', 'bulk', 'upsert'])
@pytest.mark.parametrize('groups', ['Team', False, 42, {}, [1], [None], [{}], [['Nested']]])
async def test_operator_group_inputs_reject_malformed_containers_without_mutation(operator_scope, setup_db, operation, groups):
    c = operator_scope
    before = await snapshot(c, setup_db)
    response = await write_operator(c, operation, {'teams': groups, 'full_name': 'Must roll back'})
    assert response.status_code == 422, response.text
    assert 'teams' in response.json()['detail']['field_errors']
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['patch', 'bulk', 'upsert'])
@pytest.mark.parametrize('groups', ['Target', {'Target': True}, [1], False, True, 42, [' Untouched ', 'Group', 'Group'], None, []])
async def test_operator_group_omission_preserves_stored_evidence_during_other_edits(operator_scope, setup_db, operation, groups):
    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        row = await db.get(models.Operator, c['ids'][0])
        row.teams = groups
        await db.commit()
    response = await write_operator(c, operation, {'full_name': 'Explicitly edited name'})
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        row = await db.get(models.Operator, c['ids'][0])
        assert type(row.teams) is type(groups) and row.teams == groups
        assert row.full_name == 'Explicitly edited name' and row.custom_permissions == {'settings': 1}


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'patch', 'bulk', 'upsert'])
@pytest.mark.parametrize('groups', [None, [], [' Other ', 'Other', '연구', '']])
async def test_operator_group_inputs_preserve_supported_clear_and_normalized_intent(operator_scope, setup_db, operation, groups):
    c = operator_scope
    response = await write_operator(c, operation, {'teams': groups})
    assert response.status_code == 200, response.text
    target = response.json()['id'] if operation == 'create' else c['ids'][0]
    async with _tenant_db(setup_db, c['tenant']) as db:
        row = await db.get(models.Operator, target)
        assert row.teams == (['Other', '연구'] if groups else [])
        assert row.team_id is None and row.team is None


@pytest.mark.asyncio
@pytest.mark.parametrize('endpoint', ['operators', 'roles', 'user-pool/versions', 'user/profile'])
@pytest.mark.parametrize('value,label', [(float('nan'), 'NaN'), (float('inf'), 'Infinity'), (-float('inf'), '-Infinity')])
async def test_identity_reads_preserve_nonfinite_evidence_without_writes(operator_scope, setup_db, endpoint, value, label):
    import json

    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        role = models.Role(name='Legacy grant evidence', permissions={'assets': value, 'network': 2.9, 'racks': ' Read '})
        db.add(role)
        await db.flush()
        target = await db.get(models.Operator, c['ids'][0])
        target.role_id, target.is_admin = role.id, False
        target.custom_permissions = {'assets': value, 'racks': 0, 'nested': {'entry': [value]}}
        db.add(models.UserPoolVersion(version_label='legacy-nonfinite', created_by='fixture', is_active=True,
            snapshot_data=[{'external_id': target.external_id, 'is_admin': False, 'role_id': role.id,
                'role_permissions': role.permissions, 'custom_permissions': target.custom_permissions},
                {'external_id': 'legacy-missing', 'is_admin': False, 'role_id': role.id}], diff_summary={}))
        await db.commit()
        role_id = role.id
    await _grant_access(setup_db, tenant_id=c['tenant'], user_id='input-target', role='ADMIN')
    before = json.dumps(await snapshot(c, setup_db), sort_keys=True, default=str)
    headers = {**c['headers'], 'X-User-Id': 'input-target'} if endpoint == 'user/profile' else c['headers']
    response = await c['client'].get(f'/api/v1/settings/{endpoint}', headers=headers)
    assert response.status_code == 200, response.text
    payload = response.json()
    json.dumps(payload, allow_nan=False)
    invalid = {'invalid_number': label}
    if endpoint == 'operators':
        row = next(row for row in payload if row['id'] == c['ids'][0])
        assert row['custom_permissions'] == {'assets': invalid, 'racks': 0, 'nested': {'entry': [invalid]}}
        assert row['role']['permissions'] == {'assets': invalid, 'network': 2.9, 'racks': ' Read '}
    elif endpoint == 'roles':
        row = next(row for row in payload if row['id'] == role_id)
        assert row['permissions'] == {'assets': invalid, 'network': 2.9, 'racks': ' Read '}
    elif endpoint == 'user-pool/versions':
        rows = next(row for row in payload if row['version_label'] == 'legacy-nonfinite')['snapshot_data']
        assert rows[0]['custom_permissions'] == {'assets': invalid, 'racks': 0, 'nested': {'entry': [invalid]}}
        assert rows[0]['role_permissions']['assets'] == invalid
        assert 'role_permissions' not in rows[1] and 'custom_permissions' not in rows[1]
    else:
        assert payload['permissions'] == {'assets': 0, 'network': 2, 'racks': 0, 'nested': 0}
        assert payload['is_admin'] is False and payload['access_mode'] == 'assigned'
    assert json.dumps(await snapshot(c, setup_db), sort_keys=True, default=str) == before
    async with _tenant_db(setup_db, c['tenant']) as db:
        assert json.dumps((await db.get(models.Role, role_id)).permissions, sort_keys=True) == json.dumps(
            {'assets': value, 'network': 2.9, 'racks': ' Read '}, sort_keys=True)


@pytest.mark.asyncio
@pytest.mark.parametrize('malformed', [None, [], ['assets'], 'read', False, 7])
@pytest.mark.parametrize('field', ['role', 'custom'])
async def test_profile_uses_authorization_merge_with_malformed_permission_containers(operator_scope, setup_db, field, malformed):
    from app.api.authorization import merge_operator_permissions
    from sqlalchemy.orm import selectinload
    import json

    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        role = models.Role(name='Legacy container', permissions=malformed if field == 'role' else {'assets': ' Read ', 'racks': 3})
        db.add(role)
        await db.flush()
        target = await db.get(models.Operator, c['ids'][0])
        target.role_id, target.is_admin = role.id, False
        target.custom_permissions = malformed if field == 'custom' else {'assets': 'WRITE', ' racks ': False}
        await db.commit()
    await _grant_access(setup_db, tenant_id=c['tenant'], user_id='input-target', role='ADMIN')
    before = json.dumps(await snapshot(c, setup_db), sort_keys=True, default=str)
    async with _tenant_db(setup_db, c['tenant']) as db:
        target = await db.scalar(select(models.Operator).options(selectinload(models.Operator.role)).where(models.Operator.id == c['ids'][0]))
        expected = merge_operator_permissions(target)
    response = await c['client'].get('/api/v1/settings/user/profile', headers={**c['headers'], 'X-User-Id': 'input-target'})
    assert response.status_code == 200, response.text
    assert response.json()['permissions'] == expected == ({'assets': 2, 'racks': 0} if field == 'role' else {'assets': 1, 'racks': 3})
    denied = await c['client'].post('/api/v1/settings/options', headers={**c['headers'], 'X-User-Id': 'input-target'},
        json={'category': 'Read safety fixture', 'value': 'Must not write'})
    assert denied.status_code == 403, denied.text
    assert json.dumps(await snapshot(c, setup_db), sort_keys=True, default=str) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('peer_permissions', [{'settings': 2}, {'settings': 1, 'assets': 0}])
async def test_permission_compare_and_swap_rejects_stale_maps_then_allows_reviewed_retry(operator_scope, setup_db, peer_permissions):
    c = operator_scope
    endpoint = f"/api/v1/settings/operators/{c['ids'][0]}"
    first = await c['client'].patch(endpoint, headers=c['headers'], json={
        'custom_permissions': peer_permissions, 'expected_custom_permissions': {'settings': 1},
    })
    assert first.status_code == 200, first.text
    before = await snapshot(c, setup_db)
    stale = await c['client'].patch(endpoint, headers=c['headers'], json={
        'custom_permissions': {'settings': 1, 'racks': 2}, 'expected_custom_permissions': {'settings': 1},
        'full_name': 'Must not partially update', 'team': 'Must not create stale team', 'is_admin': False,
    })
    assert stale.status_code == 409, stale.text
    assert stale.json()['detail'] == 'Permissions changed since this row was loaded. Review the current grants and try again.'
    assert await snapshot(c, setup_db) == before
    reviewed = await c['client'].patch(endpoint, headers=c['headers'], json={
        'custom_permissions': {**peer_permissions, 'racks': 2}, 'expected_custom_permissions': peer_permissions,
    })
    assert reviewed.status_code == 200, reviewed.text
    after = await snapshot(c, setup_db)
    target = next(row for row in after[models.Operator.__tablename__] if row['id'] == c['ids'][0])
    assert target['custom_permissions'] == {**peer_permissions, 'racks': 2}
    assert target['full_name'] == 'Original name' and target['is_admin'] is True
    versions = after[models.UserPoolVersion.__tablename__]
    assert len(versions) == 2 and sum(row['is_active'] for row in versions) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('payload', [
    {'expected_custom_permissions': {'settings': 1}},
    {'custom_permissions': {}, 'expected_custom_permissions': []},
    {'custom_permissions': {}, 'expected_custom_permissions': {'settings': '3'}},
    {'custom_permissions': {}, 'expected_custom_permissions': {'settings': None}},
    {'custom_permissions': {}, 'expected_custom_permissions': {'settings': float('inf')}},
    {'custom_permissions': {}, 'expected_custom_permissions': {'settings': 1, ' settings ': 2}},
])
async def test_permission_compare_and_swap_validates_expectation_without_writes(operator_scope, setup_db, payload):
    import json

    c = operator_scope
    before = await snapshot(c, setup_db)
    response = await c['client'].patch(f"/api/v1/settings/operators/{c['ids'][0]}",
        headers={**c['headers'], 'Content-Type': 'application/json'},
        content=json.dumps({**payload, 'full_name': 'Rejected expectation', 'team': 'Rejected team'}))
    assert response.status_code == 422, response.text
    assert 'expected_custom_permissions' in response.json()['detail']['field_errors']
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('stored,expected', [(None, {}), ({}, None), ({'settings': ' Read '}, {' settings ': True})])
async def test_permission_compare_and_swap_preserves_supported_semantics(operator_scope, setup_db, stored, expected):
    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        (await db.get(models.Operator, c['ids'][0])).custom_permissions = stored
        await db.commit()
    response = await c['client'].patch(f"/api/v1/settings/operators/{c['ids'][0]}", headers=c['headers'], json={
        'custom_permissions': {'assets': 2}, 'expected_custom_permissions': expected,
    })
    assert response.status_code == 200, response.text
    assert response.json()['custom_permissions'] == {'assets': 2}


@pytest.mark.asyncio
async def test_permission_compare_and_swap_serializes_competing_http_writes(operator_scope, setup_db, monkeypatch):
    from app.api import authorization

    c = operator_scope
    ready, sessions = asyncio.Event(), set()
    original = authorization.resolve_current_operator

    async def synchronize_initial_authorization(request, db):
        result = await original(request, db)
        if db not in sessions:
            sessions.add(db)
            if len(sessions) == 2:
                ready.set()
            await asyncio.wait_for(ready.wait(), 5)
        return result

    monkeypatch.setattr(authorization, 'resolve_current_operator', synchronize_initial_authorization)
    maps = [{'settings': 1, 'assets': 2}, {'settings': 1, 'racks': 3}]
    responses = await asyncio.wait_for(asyncio.gather(*[
        c['client'].patch(f"/api/v1/settings/operators/{c['ids'][0]}", headers=c['headers'], json={
            'custom_permissions': permissions, 'expected_custom_permissions': {'settings': 1},
        }) for permissions in maps
    ], return_exceptions=True), 10)
    assert not any(isinstance(response, BaseException) for response in responses), [repr(response) for response in responses]
    assert sorted(response.status_code for response in responses) == [200, 409], [response.text for response in responses]
    winner = maps[next(index for index, response in enumerate(responses) if response.status_code == 200)]
    after = await snapshot(c, setup_db)
    target = next(row for row in after[models.Operator.__tablename__] if row['id'] == c['ids'][0])
    assert target['custom_permissions'] == winner
    versions = after[models.UserPoolVersion.__tablename__]
    assert len(versions) == 1 and versions[0]['is_active']
    saved = next(row for row in versions[0]['snapshot_data'] if row['external_id'] == 'input-target')
    assert saved['custom_permissions'] == winner


@pytest.mark.asyncio
@pytest.mark.parametrize('value', [float('nan'), float('inf'), -float('inf')], ids=['nan', 'infinity', 'negative-infinity'])
async def test_authorized_repair_of_nonfinite_stored_overrides_preserves_other_state(operator_scope, setup_db, value):
    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        target = await db.get(models.Operator, c['ids'][0])
        target.custom_permissions = {'assets': value}
        target.is_admin = False
        await db.commit()
    before = await snapshot(c, setup_db)
    response = await c['client'].patch(f"/api/v1/settings/operators/{c['ids'][0]}", headers=c['headers'],
        json={'custom_permissions': {'assets': 2}})
    assert response.status_code == 200, response.text
    after = await snapshot(c, setup_db)
    assert after[models.Team.__tablename__] == before[models.Team.__tablename__]
    assert after[models.TeamAudit.__tablename__] == before[models.TeamAudit.__tablename__]
    for row in after[models.Operator.__tablename__]:
        previous = next(item for item in before[models.Operator.__tablename__] if item['id'] == row['id'])
        if row['id'] == c['ids'][0]:
            assert row['custom_permissions'] == {'assets': 2} and row['is_admin'] is False
            assert {k: v for k, v in row.items() if k not in {'custom_permissions', 'updated_at'}} == {
                k: v for k, v in previous.items() if k not in {'custom_permissions', 'updated_at'}}
        else:
            assert row == previous
    versions = after[models.UserPoolVersion.__tablename__]
    assert len(versions) == 1
    saved = next(row for row in versions[0]['snapshot_data'] if row['external_id'] == 'input-target')
    assert saved['custom_permissions'] == {'assets': 2} and saved['is_admin'] is False


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'upsert', 'patch', 'bulk', 'restore'])
@pytest.mark.parametrize('permissions', [
    [], 'read', False, 7,
    {'assets': []}, {'assets': {}}, {'assets': None}, {'assets': 'typo'}, {'assets': '3'},
    {'assets': -1}, {'assets': 4}, {'assets': 1.5},
    {' ': 1}, {'assets': 1, ' assets ': 3},
])
async def test_permission_inputs_reject_ambiguous_values_without_partial_writes(operator_scope, setup_db, operation, permissions):
    c = operator_scope
    payload = {'custom_permissions': permissions, 'is_admin': False, 'team': 'Rejected permission team'}
    version_id, index = None, None
    if operation == 'restore':
        version_id, index, _ = await field_restore_fixture(c, setup_db, payload=payload)
    before = await snapshot(c, setup_db)
    response = (await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
                if operation == 'restore' else await write_operator(c, operation, payload))
    assert response.status_code == 422, response.text
    field = f'snapshot_data[{index}].custom_permissions' if operation == 'restore' else 'custom_permissions'
    assert field in response.json()['detail']['field_errors']
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['patch', 'restore'])
@pytest.mark.parametrize('value', [float('nan'), float('inf'), -float('inf')], ids=['nan', 'infinity', 'negative-infinity'])
async def test_nonfinite_permission_inputs_fail_with_validation_not_server_errors(operator_scope, setup_db, operation, value):
    import json

    c = operator_scope
    payload = {'custom_permissions': {'assets': value}, 'is_admin': False, 'team': 'Rejected nonfinite team'}
    if operation == 'restore':
        version_id, _, _ = await field_restore_fixture(c, setup_db, payload=payload)
    before = await snapshot(c, setup_db)
    if operation == 'restore':
        response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
    else:
        response = await c['client'].patch(f"/api/v1/settings/operators/{c['ids'][0]}",
            headers={**c['headers'], 'Content-Type': 'application/json'}, content=json.dumps(payload))
    assert response.status_code == 422, response.text
    assert 'custom_permissions' in str(response.json()['detail']['field_errors'])
    # JSON's nonfinite legacy values need a canonical representation for immutable-state comparison.
    assert json.dumps(await snapshot(c, setup_db), default=str, sort_keys=True) == json.dumps(before, default=str, sort_keys=True)


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'upsert', 'patch', 'bulk', 'restore'])
@pytest.mark.parametrize('intent', ['omitted', 'null', 'empty', 'vocabulary'])
async def test_permission_inputs_preserve_supported_vocabulary_and_clear_intent(operator_scope, setup_db, operation, intent):
    c = operator_scope
    payload = {'full_name': 'Accepted permission input', 'is_admin': False}
    expected = {'settings': 1} if intent == 'omitted' and operation not in ['create', 'restore'] else {}
    if intent != 'omitted':
        payload['custom_permissions'] = None if intent == 'null' else {} if intent == 'empty' else {
            'all': ' None ', ' custom.capability ': 'read', 'assets': ' WRITE ',
            'settings': 'FULL', 'services': True, 'network': 2.0, 'racks': False,
        }
        if intent == 'vocabulary':
            expected = {'all': 0, 'custom.capability': 1, 'assets': 2, 'settings': 3, 'services': 1, 'network': 2, 'racks': 0}
    if operation == 'restore':
        version_id, _, original = await field_restore_fixture(c, setup_db, payload=payload,
            omitted=('custom_permissions',) if intent == 'omitted' else ())
        response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
    else:
        response = await write_operator(c, operation, payload)
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        name = 'input-peer' if operation == 'restore' else 'input-new' if operation == 'create' else 'input-target'
        row = await db.scalar(select(models.Operator).where(models.Operator.external_id == name))
        assert row.custom_permissions == expected and row.is_admin is False
        versions = (await db.scalars(select(models.UserPoolVersion).order_by(models.UserPoolVersion.id))).all()
        assert len(versions) == (2 if operation == 'restore' else 1)
        saved = next(record for record in versions[-1].snapshot_data if record['external_id'] == name)
        assert saved['custom_permissions'] == expected
        if operation == 'restore':
            assert versions[0].snapshot_data == original



@pytest.mark.asyncio
async def test_history_captures_role_grants_without_rewriting_previous_snapshots(operator_scope, setup_db):
    from app.api.settings import build_user_pool_snapshot, create_user_pool_version

    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        role = models.Role(name='Historical role', permissions={'all': ' Read ', 'assets': 2})
        db.add(role)
        await db.flush()
        target = await db.get(models.Operator, c['ids'][0])
        target.role_id = role.id
        target.is_admin = False
        target.custom_permissions = {'assets': 0}
        await create_user_pool_version(db, created_by='admin_root', diff_summary={}, version_label='role-before')
        await db.commit()
        first = await db.scalar(select(models.UserPoolVersion))
        recorded = next(row for row in first.snapshot_data if row['external_id'] == 'input-target')
        assert recorded['role_permissions'] == {'all': ' Read ', 'assets': 2}
        assert recorded['custom_permissions'] == {'assets': 0}
        no_role = next(row for row in first.snapshot_data if row['external_id'] == 'input-peer')
        assert no_role['role_id'] is None and no_role['role_permissions'] == {}
        role.permissions = {'all': 3}
        await db.commit()
        fresh = next(row for row in await build_user_pool_snapshot(db) if row['external_id'] == 'input-target')
        assert fresh['role_permissions'] == {'all': 3}
        await db.refresh(first)
        assert next(row for row in first.snapshot_data if row['external_id'] == 'input-target') == recorded


@pytest.mark.asyncio
@pytest.mark.parametrize('legacy', [False, True])
async def test_identity_restore_retains_current_role_definition_and_records_it(operator_scope, setup_db, legacy):
    from app.api.settings import build_user_pool_snapshot

    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        role = models.Role(name='Current role', permissions={'assets': 3, 'all': 1})
        db.add(role)
        await db.flush()
        records = await build_user_pool_snapshot(db)
        target = next(row for row in records if row['external_id'] == 'input-target')
        target.update(role_id=role.id, role_name='Historical role', is_admin=False, custom_permissions={'assets': 0})
        if legacy:
            target.pop('role_permissions', None)
        else:
            target['role_permissions'] = {'assets': 1, 'all': 0}
        version = models.UserPoolVersion(version_label='historical-role-definition', snapshot_data=records,
                                        diff_summary={}, created_by='admin_root', is_active=False)
        db.add(version)
        await db.commit()
        version_id, role_id = version.id, role.id
    response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        assert (await db.get(models.Role, role_id)).permissions == {'assets': 3, 'all': 1}
        restored = await db.get(models.Operator, c['ids'][0])
        assert restored.role_id == role_id and restored.custom_permissions == {'assets': 0}
        versions = (await db.scalars(select(models.UserPoolVersion).order_by(models.UserPoolVersion.id))).all()
        assert versions[0].snapshot_data == records
        saved = next(row for row in versions[-1].snapshot_data if row['external_id'] == 'input-target')
        assert saved['role_permissions'] == {'assets': 3, 'all': 1}
        assert saved['role_name'] == 'Current role'


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'upsert', 'patch', 'bulk'])
@pytest.mark.parametrize('field', ['role_id', 'team_id'])
@pytest.mark.parametrize('value', [True, False, 0, -1, 2 ** 63, 1.0, '1', [], {}])
async def test_invalid_operator_references_never_alias_or_create_fallback_state(operator_scope, setup_db, operation, field, value):
    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        db.add(models.Team(name='Existing reference team'))
        await db.commit()
    before = await snapshot(c, setup_db)
    response = await write_operator(c, operation, {
        field: value, 'full_name': 'Rejected reference change', 'team': 'Rejected fallback team',
    })
    assert response.status_code == 422, response.text
    assert field in response.json()['detail']['field_errors']
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'upsert', 'patch', 'bulk'])
@pytest.mark.parametrize('field', ['role_id', 'team_id'])
async def test_missing_operator_reference_cannot_fall_back_to_new_team(operator_scope, setup_db, operation, field):
    c = operator_scope
    before = await snapshot(c, setup_db)
    response = await write_operator(c, operation, {
        field: 2 ** 63 - 1, 'full_name': 'Missing reference change', 'team': 'Rejected fallback team',
    })
    assert response.status_code == 400, response.text
    assert response.json()['detail'] == ('Role not found' if field == 'role_id' else 'Team not found')
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'upsert', 'patch', 'bulk'])
@pytest.mark.parametrize('field', ['role_id', 'team_id'])
@pytest.mark.parametrize('intent', ['omitted', 'clear', 'assign'])
async def test_operator_reference_ids_preserve_supported_intent(operator_scope, setup_db, operation, field, intent):
    c = operator_scope
    model = models.Role if field == 'role_id' else models.Team
    async with _tenant_db(setup_db, c['tenant']) as db:
        old_reference, new_reference = model(name='Previous reference'), model(name='Requested reference')
        db.add_all([old_reference, new_reference])
        await db.flush()
        for op_id in c['ids']:
            row = await db.get(models.Operator, op_id)
            setattr(row, field, old_reference.id)
            if field == 'team_id':
                row.team = old_reference.name
        await db.commit()
        old_id, new_id = old_reference.id, new_reference.id
    payload = {'full_name': 'Accepted reference change'}
    if intent != 'omitted':
        payload[field] = None if intent == 'clear' else new_id
    response = await write_operator(c, operation, payload)
    assert response.status_code == 200, response.text
    expected = None if intent == 'clear' or (intent == 'omitted' and operation == 'create') else new_id if intent == 'assign' else old_id
    async with _tenant_db(setup_db, c['tenant']) as db:
        name = 'input-new' if operation == 'create' else 'input-target'
        row = await db.scalar(select(models.Operator).where(models.Operator.external_id == name))
        assert getattr(row, field) == expected
        assert row.full_name == 'Accepted reference change'
        if field == 'team_id':
            assert row.team == ('Requested reference' if intent == 'assign' else 'Previous reference' if expected else None)
        versions = (await db.scalars(select(models.UserPoolVersion))).all()
        assert len(versions) == 1
        saved = next(item for item in versions[0].snapshot_data if item['external_id'] == name)
        assert saved[field] == expected


@pytest.mark.asyncio
@pytest.mark.parametrize('value', [True, '1', 2 ** 63, {}])
async def test_restore_rejects_malformed_role_reference_without_partial_state(operator_scope, setup_db, value):
    from app.api.settings import build_user_pool_snapshot

    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        records = await build_user_pool_snapshot(db)
        records.sort(key=lambda item: 0 if item['external_id'] == 'input-target' else 1)
        target = next(item for item in records if item['external_id'] == 'input-target')
        target.update(full_name='Earlier restore change', team='Rejected restore team')
        next(item for item in records if item['external_id'] == 'input-peer')['role_id'] = value
        version = models.UserPoolVersion(version_label='malformed-role-fixture', snapshot_data=records,
                                        diff_summary={}, created_by='admin_root', is_active=False)
        db.add(version)
        await db.commit()
        version_id = version.id
    before = await snapshot(c, setup_db)
    response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
    assert response.status_code == 422, response.text
    assert 'role_id' in response.json()['detail']['field_errors']
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('intent', ['omitted', 'clear', 'assign'])
async def test_restore_retains_valid_optional_role_references(operator_scope, setup_db, intent):
    from app.api.settings import build_user_pool_snapshot

    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        role = models.Role(name='Restored role', permissions={'settings': 1})
        db.add(role)
        await db.flush()
        role_id = role.id
        records = await build_user_pool_snapshot(db)
        target = next(item for item in records if item['external_id'] == 'input-target')
        target['full_name'] = 'Restored identity'
        if intent == 'omitted':
            target.pop('role_id')
        else:
            target['role_id'] = role_id if intent == 'assign' else None
        version = models.UserPoolVersion(version_label='valid-role-fixture', snapshot_data=records,
                                        diff_summary={}, created_by='admin_root', is_active=False)
        db.add(version)
        await db.commit()
        version_id = version.id
    response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        target = await db.get(models.Operator, c['ids'][0])
        assert target.full_name == 'Restored identity'
        assert target.role_id == (role_id if intent == 'assign' else None)
        assert len((await db.scalars(select(models.Operator))).all()) == len(records)
        assert len((await db.scalars(select(models.UserPoolVersion))).all()) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('value', [None, 0, 1, 'false', 'true', '', [], ['ops'], {}, {'active': True}])
async def test_restore_rejects_malformed_admin_flag_without_partial_state(operator_scope, setup_db, value):
    from app.api.settings import build_user_pool_snapshot

    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        records = await build_user_pool_snapshot(db)
        records.sort(key=lambda item: 0 if item['external_id'] == 'input-target' else 1)
        next(item for item in records if item['external_id'] == 'input-target').update(
            full_name='Earlier restore change', team='Rejected restore team')
        next(item for item in records if item['external_id'] == 'input-peer')['is_admin'] = value
        version = models.UserPoolVersion(version_label='malformed-admin-fixture', snapshot_data=records,
                                        diff_summary={}, created_by='admin_root', is_active=False)
        db.add(version)
        await db.commit()
        version_id = version.id
    before = await snapshot(c, setup_db)
    response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
    assert response.status_code == 422, response.text
    assert response.json()['detail']['field_errors'] == {'is_admin': 'Must be a boolean'}
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('intent', ['omitted', 'grant', 'revoke'])
async def test_restore_preserves_valid_admin_intent_and_legacy_default(operator_scope, setup_db, intent):
    from app.api.settings import build_user_pool_snapshot

    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        records = await build_user_pool_snapshot(db)
        target = next(item for item in records if item['external_id'] == 'input-target')
        target['full_name'] = 'Restored admin intent'
        if intent == 'omitted':
            target.pop('is_admin')
        else:
            target['is_admin'] = intent == 'grant'
        version = models.UserPoolVersion(version_label='valid-admin-fixture', snapshot_data=records,
                                        diff_summary={}, created_by='admin_root', is_active=False)
        db.add(version)
        await db.commit()
        version_id = version.id
    response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        target = await db.get(models.Operator, c['ids'][0])
        assert target.is_admin is (intent == 'grant')
        assert target.full_name == 'Restored admin intent'
        versions = (await db.scalars(select(models.UserPoolVersion).order_by(models.UserPoolVersion.id))).all()
        assert len(versions) == 2
        saved = next(item for item in versions[-1].snapshot_data if item['external_id'] == 'input-target')
        assert saved['is_admin'] is (intent == 'grant')


@pytest.mark.asyncio
@pytest.mark.parametrize('kind,value', [
    *[('snapshot', value) for value in [None, {}, '', False, 0, 1, 'users', {'unexpected': 'record'}]],
    *[('record', value) for value in [None, False, 0, 'identity', [], ['identity']]],
    *[('identity', value) for value in [None, True, False, 0, -1, 1.5, {}, [], '', '   ']],
])
async def test_restore_rejects_invalid_snapshot_identity_shape_without_state_change(operator_scope, setup_db, kind, value):
    from app.api.settings import build_user_pool_snapshot

    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        records = await build_user_pool_snapshot(db)
        records.sort(key=lambda item: 0 if item['external_id'] == 'input-target' else 1)
        records[0].update(full_name='Earlier staged restore', team='Rejected snapshot team')
        if kind == 'snapshot':
            records = value
        elif kind == 'record':
            records.append(value)
        else:
            peer = next(item for item in records if item['external_id'] == 'input-peer')
            peer['external_id'] = value
            peer['username'] = 'snapshot-shape-peer'
            peer.pop('id')
        version = models.UserPoolVersion(version_label='invalid-shape-fixture', snapshot_data=records,
                                        diff_summary={}, created_by='admin_root', is_active=False)
        db.add(version)
        await db.commit()
        version_id = version.id
    before = await snapshot(c, setup_db)
    response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
    assert response.status_code == 422, response.text
    fields = response.json()['detail']['field_errors']
    assert len(fields) == 1 and next(iter(fields)).startswith('snapshot_data')
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('legacy_alias', [False, True])
async def test_restore_rejects_duplicate_external_identity_without_overwriting_or_deleting(operator_scope, setup_db, legacy_alias):
    from app.api.settings import build_user_pool_snapshot

    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        target = await db.get(models.Operator, c['ids'][0])
        target.external_id = '101'
        await db.commit()
        records = await build_user_pool_snapshot(db)
        records.sort(key=lambda item: 0 if item['external_id'] == '101' else 1)
        records[0].update(full_name='Earlier duplicate change', team='Rejected duplicate team')
        peer = next(item for item in records if item['external_id'] == 'input-peer')
        peer['username'] = 'snapshot-duplicate-peer'
        if legacy_alias:
            peer.pop('external_id')
            peer['id'] = 101
        else:
            peer['external_id'] = '101'
        version = models.UserPoolVersion(version_label='duplicate-identity-fixture', snapshot_data=records,
                                        diff_summary={}, created_by='admin_root', is_active=False)
        db.add(version)
        await db.commit()
        version_id = version.id
    before = await snapshot(c, setup_db)
    response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
    assert response.status_code == 409, response.text
    assert response.json()['detail'] == "Snapshot contains duplicate external identity '101'"
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('legacy_id', [101, '101'])
async def test_restore_preserves_supported_legacy_identity_ids(operator_scope, setup_db, legacy_id):
    from app.api.settings import build_user_pool_snapshot

    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        target = await db.get(models.Operator, c['ids'][0])
        target.external_id = '101'
        await db.commit()
        records = await build_user_pool_snapshot(db)
        record = next(item for item in records if item['external_id'] == '101')
        record.pop('external_id')
        record.update(id=legacy_id, full_name='Restored legacy identity')
        version = models.UserPoolVersion(version_label='legacy-identity-fixture', snapshot_data=records,
                                        diff_summary={}, created_by='admin_root', is_active=False)
        db.add(version)
        await db.commit()
        version_id = version.id
    response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        target = await db.get(models.Operator, c['ids'][0])
        assert target.external_id == '101' and target.full_name == 'Restored legacy identity'
        assert len((await db.scalars(select(models.Operator))).all()) == len(records)
        assert len((await db.scalars(select(models.UserPoolVersion))).all()) == 2


@pytest.mark.asyncio
async def test_empty_historical_list_preserves_current_user_and_records_actual_result(operator_scope, setup_db):
    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        version = models.UserPoolVersion(version_label='empty-historical-list', snapshot_data=[],
                                        diff_summary={}, created_by='admin_root', is_active=False)
        db.add(version)
        await db.commit()
        version_id = version.id
    response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        remaining = (await db.scalars(select(models.Operator))).all()
        assert [op.username for op in remaining] == ['admin_root']
        versions = (await db.scalars(select(models.UserPoolVersion).order_by(models.UserPoolVersion.id))).all()
        assert len(versions) == 2 and versions[-1].is_active
        assert [row['username'] for row in versions[-1].snapshot_data] == ['admin_root']


async def field_restore_fixture(c, setup_db, *, payload=None, omitted=()):
    from app.api.settings import build_user_pool_snapshot

    async with _tenant_db(setup_db, c['tenant']) as db:
        records = await build_user_pool_snapshot(db)
        records.sort(key=lambda item: 0 if item['external_id'] == 'input-target' else 1)
        records[0].update(full_name='Earlier staged field restore', team='Earlier staged field team')
        peer = next(item for item in records if item['external_id'] == 'input-peer')
        peer.update(payload or {})
        for field in omitted:
            peer.pop(field, None)
        version = models.UserPoolVersion(version_label='historical-field-fixture', snapshot_data=records,
                                        diff_summary={}, created_by='admin_root', is_active=False)
        db.add(version)
        await db.commit()
        return version.id, records.index(peer), records


@pytest.mark.asyncio
async def test_restore_preview_rolls_back_staged_changes_and_guards_repeated_apply(operator_scope, setup_db):
    c = operator_scope
    version_id, _, _ = await field_restore_fixture(c, setup_db)
    endpoint = f'/api/v1/settings/user-pool/restore/{version_id}'
    before = await snapshot(c, setup_db)
    preview = await c['client'].post(endpoint, headers=c['headers'], json={'preview': True})
    assert preview.status_code == 200, preview.text
    data = preview.json()
    assert data['summary'] == {'added': 0, 'removed': 0, 'changed': 1}
    assert len(data['fingerprint']) == 64
    assert await snapshot(c, setup_db) == before
    repeated = await c['client'].post(endpoint, headers=c['headers'], json={'preview': True})
    assert repeated.status_code == 200 and repeated.json() == data
    assert await snapshot(c, setup_db) == before
    applied = await c['client'].post(endpoint, headers=c['headers'], json={'expected_fingerprint': data['fingerprint']})
    assert applied.status_code == 200, applied.text
    after = await snapshot(c, setup_db)
    assert len(after[models.UserPoolVersion.__tablename__]) == len(before[models.UserPoolVersion.__tablename__]) + 1
    assert next(row for row in after[models.Operator.__tablename__] if row['id'] == c['ids'][0])['full_name'] == 'Earlier staged field restore'
    duplicate = await c['client'].post(endpoint, headers=c['headers'], json={'expected_fingerprint': data['fingerprint']})
    assert duplicate.status_code == 409, duplicate.text
    assert await snapshot(c, setup_db) == after


@pytest.mark.asyncio
@pytest.mark.parametrize('change', ['operator', 'new_identity', 'role', 'team', 'source', 'revision'])
async def test_restore_rejects_changed_review_before_mutation(operator_scope, setup_db, change):
    from copy import deepcopy

    c = operator_scope
    version_id, _, _ = await field_restore_fixture(c, setup_db)
    endpoint = f'/api/v1/settings/user-pool/restore/{version_id}'
    async with _tenant_db(setup_db, c['tenant']) as db:
        db.add(models.Role(name='Unassigned reviewed role', permissions={'assets': 1}))
        db.add(models.Team(name='Reviewed team'))
        await db.commit()
    preview = await c['client'].post(endpoint, headers=c['headers'], json={'preview': True})
    assert preview.status_code == 200, preview.text
    fingerprint = preview.json()['fingerprint']
    async with _tenant_db(setup_db, c['tenant']) as db:
        if change == 'operator':
            (await db.get(models.Operator, c['ids'][1])).full_name = 'Peer changed after review'
        elif change == 'new_identity':
            db.add(models.Operator(external_id='new-after-review', username='new-after-review', is_admin=False))
        elif change == 'role':
            (await db.scalar(select(models.Role).where(models.Role.name == 'Unassigned reviewed role'))).permissions = {'assets': 3}
        elif change == 'team':
            (await db.scalar(select(models.Team).where(models.Team.name == 'Reviewed team'))).name = 'Renamed after review'
        elif change == 'source':
            version = await db.get(models.UserPoolVersion, version_id)
            records = deepcopy(version.snapshot_data)
            records[0]['full_name'] = 'Different source content'
            version.snapshot_data = records
        else:
            db.add(models.UserPoolVersion(version_label='new-after-review', snapshot_data=[], diff_summary={}, created_by='fixture'))
        await db.commit()
    before = await snapshot(c, setup_db)
    rejected = await c['client'].post(endpoint, headers=c['headers'], json={'expected_fingerprint': fingerprint})
    assert rejected.status_code == 409, rejected.text
    assert rejected.json()['detail'] == 'Identity data or restore source changed. Preview again before restoring.'
    assert await snapshot(c, setup_db) == before
    reviewed = await c['client'].post(endpoint, headers=c['headers'], json={'preview': True})
    assert reviewed.status_code == 200 and reviewed.json()['fingerprint'] != fingerprint
    assert await snapshot(c, setup_db) == before
    accepted = await c['client'].post(endpoint, headers=c['headers'], json={'expected_fingerprint': reviewed.json()['fingerprint']})
    assert accepted.status_code == 200, accepted.text


@pytest.mark.asyncio
@pytest.mark.parametrize('payload', [{'preview': 'true'}, {'preview': None}, {'expected_fingerprint': None},
    {'expected_fingerprint': 5}, {'expected_fingerprint': 'a' * 63}, {'expected_fingerprint': 'G' * 64}])
async def test_restore_review_rejects_malformed_preconditions_atomically(operator_scope, setup_db, payload):
    c = operator_scope
    version_id, _, _ = await field_restore_fixture(c, setup_db)
    before = await snapshot(c, setup_db)
    response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'], json=payload)
    assert response.status_code == 422, response.text
    assert next(iter(payload)) in response.json()['detail']['field_errors']
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_restore_review_is_bound_to_the_actor(operator_scope, setup_db):
    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        db.add(models.Operator(external_id='other-reviewer', username='other-reviewer', is_admin=True))
        await db.commit()
    await _grant_access(setup_db, tenant_id=c['tenant'], user_id='other-reviewer', role='ADMIN')
    version_id, _, _ = await field_restore_fixture(c, setup_db)
    endpoint = f'/api/v1/settings/user-pool/restore/{version_id}'
    preview = await c['client'].post(endpoint, headers=c['headers'], json={'preview': True})
    assert preview.status_code == 200, preview.text
    before = await snapshot(c, setup_db)
    other = await c['client'].post(endpoint, headers={**c['headers'], 'X-User-Id': 'other-reviewer'},
        json={'expected_fingerprint': preview.json()['fingerprint']})
    assert other.status_code == 409, other.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_restore_preview_failure_rolls_back_earlier_staged_changes(operator_scope, setup_db):
    c = operator_scope
    version_id, _, _ = await field_restore_fixture(c, setup_db, payload={'full_name': ['invalid legacy name']})
    before = await snapshot(c, setup_db)
    response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'], json={'preview': True})
    assert response.status_code == 422, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_restore_review_serializes_competing_confirmations(operator_scope, setup_db, monkeypatch):
    from app.api import authorization

    c = operator_scope
    version_id, _, _ = await field_restore_fixture(c, setup_db)
    endpoint = f'/api/v1/settings/user-pool/restore/{version_id}'
    preview = await c['client'].post(endpoint, headers=c['headers'], json={'preview': True})
    assert preview.status_code == 200, preview.text
    fingerprint = preview.json()['fingerprint']
    before = await snapshot(c, setup_db)
    ready, sessions = asyncio.Event(), set()
    original = authorization.resolve_current_operator
    async def synchronize_initial_authorization(request, db):
        result = await original(request, db)
        if db not in sessions:
            sessions.add(db)
            if len(sessions) == 2:
                ready.set()
            await asyncio.wait_for(ready.wait(), 5)
        return result
    monkeypatch.setattr(authorization, 'resolve_current_operator', synchronize_initial_authorization)
    responses = await asyncio.wait_for(asyncio.gather(*[
        c['client'].post(endpoint, headers=c['headers'], json={'expected_fingerprint': fingerprint}) for _ in range(2)
    ], return_exceptions=True), 10)
    assert not any(isinstance(response, BaseException) for response in responses), [repr(response) for response in responses]
    assert sorted(response.status_code for response in responses) == [200, 409], [response.text for response in responses]
    after = await snapshot(c, setup_db)
    versions = after[models.UserPoolVersion.__tablename__]
    assert len(versions) == len(before[models.UserPoolVersion.__tablename__]) + 1
    assert sum(row['is_active'] for row in versions) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('field,value', [
    *[(field, value) for field in ['full_name', 'email', 'department', 'team', 'team_source', 'registration_status']
      for value in [False, 1, 1.5, [], {}]],
    *[('username', value) for value in [None, '', '   ', False, 1, 1.5, [], {}, ['user']]],
    *[('teams', value) for value in ['Operations', {}, False, 1, ['valid', None], ['valid', 1], ['valid', {}]]],
    *[('custom_permissions', value) for value in [False, 1, 1.5, '', [], ['settings']]],
])
async def test_restore_rejects_malformed_historical_fields_atomically(operator_scope, setup_db, field, value):
    c = operator_scope
    version_id, index, _ = await field_restore_fixture(c, setup_db, payload={field: value})
    before = await snapshot(c, setup_db)
    response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
    assert response.status_code == 422, response.text
    assert f'snapshot_data[{index}].{field}' in response.json()['detail']['field_errors']
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('intent', ['omitted', 'null', 'values'])
async def test_restore_preserves_nullable_legacy_fields_and_text_values(operator_scope, setup_db, intent):
    c = operator_scope
    fields = ['full_name', 'email', 'department', 'team_source', 'registration_status']
    values = {'full_name': '  Historical 이름  ', 'email': ' legacy@example.com ', 'department': 'Operations / IT',
              'team_source': 'manual_override', 'registration_status': 'Pending'}
    payload = values if intent == 'values' else dict.fromkeys(fields) if intent == 'null' else {}
    version_id, _, original_records = await field_restore_fixture(
        c, setup_db, payload=payload, omitted=fields if intent == 'omitted' else ())
    response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        peer = await db.get(models.Operator, c['ids'][1])
        expected = values if intent == 'values' else dict.fromkeys(fields)
        if intent == 'omitted':
            expected.update(team_source='synced', registration_status='Verified')
        assert {field: getattr(peer, field) for field in fields} == expected
        versions = (await db.scalars(select(models.UserPoolVersion).order_by(models.UserPoolVersion.id))).all()
        assert len(versions) == 2 and not versions[0].is_active and versions[1].is_active
        assert versions[0].snapshot_data == original_records
        saved = next(row for row in versions[1].snapshot_data if row['external_id'] == 'input-peer')
        assert {field: saved[field] for field in fields} == expected
        assert versions[1].diff_summary['source_version_id'] == version_id


@pytest.mark.asyncio
@pytest.mark.parametrize('intent', ['omitted', 'null', 'empty', 'legacy'])
async def test_restore_preserves_supported_group_and_permission_records(operator_scope, setup_db, intent):
    c = operator_scope
    payload = {} if intent == 'omitted' else {
        'teams': None if intent == 'null' else [] if intent == 'empty' else [' Operators ', 'Operators', '연구', ''],
        'custom_permissions': None if intent == 'null' else {} if intent == 'empty' else {
            'assets': 'read', 'settings': 'manage', 'services': True, 'network': 2,
        },
    }
    version_id, _, _ = await field_restore_fixture(
        c, setup_db, payload=payload, omitted=('teams', 'custom_permissions') if intent == 'omitted' else ())
    response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        peer = await db.get(models.Operator, c['ids'][1])
        assert peer.teams == (['Operators', '연구'] if intent == 'legacy' else [])
        assert peer.custom_permissions == ({'assets': 1, 'settings': 3, 'services': 1, 'network': 2} if intent == 'legacy' else {})
        assert len((await db.scalars(select(models.UserPoolVersion))).all()) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('grant', ['admin', 'custom', 'role'])
@pytest.mark.parametrize('operation', ['restore', 'patch'])
async def test_identity_write_rechecks_revoked_authority_inside_write_transaction(operator_scope, setup_db, grant, operation):
    import inspect
    from fastapi import Depends, Request
    from app.api import authorization, settings as settings_api

    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        role = models.Role(name='Concurrent restore role', permissions={'settings': 3} if grant == 'role' else {})
        db.add(role)
        await db.flush()
        manager = await db.scalar(select(models.Operator).where(models.Operator.username == 'admin_root'))
        assert manager is not None
        manager.is_admin = grant == 'admin'
        manager.role_id = role.id
        manager.custom_permissions = {'settings': 3} if grant == 'custom' else {}
        await db.commit()
        manager_id, role_id = manager.id, role.id
    version_id, _, _ = await field_restore_fixture(c, setup_db)
    resolved, release = asyncio.Event(), asyncio.Event()
    handler = settings_api.restore_user_pool if operation == 'restore' else settings_api.update_operator
    dependency = inspect.signature(handler).parameters['_settings_access'].default.dependency

    async def hold_accepted_authority(request: Request, db=Depends(get_db)):
        result = await dependency(request=request, db=db)
        assert authorization.has_capability(result, 'settings', 3)
        resolved.set()
        await release.wait()
        return result

    app.dependency_overrides[dependency] = hold_accepted_authority
    task = asyncio.create_task(
        c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
        if operation == 'restore' else c['client'].patch(f"/api/v1/settings/operators/{c['ids'][0]}",
            headers=c['headers'], json={'custom_permissions': {'settings': 2}, 'expected_custom_permissions': {'settings': 1}}))
    try:
        await asyncio.wait_for(resolved.wait(), 5)
        async with _tenant_db(setup_db, c['tenant']) as db:
            manager = await db.get(models.Operator, manager_id)
            manager.is_admin, manager.custom_permissions = False, {}
            (await db.get(models.Role, role_id)).permissions = {}
            await db.commit()
        before = await snapshot(c, setup_db)
    finally:
        release.set()
        try:
            response = await asyncio.wait_for(task, 10)
        finally:
            app.dependency_overrides.pop(dependency)
    assert response.status_code == 403, response.text
    assert response.json()['detail'] == "Insufficient capability 'settings' at level 3."
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_restore_busy_conflict_preserves_state_and_allows_explicit_retry(operator_scope, setup_db):
    c = operator_scope
    version_id, _, _ = await field_restore_fixture(c, setup_db)
    before = await snapshot(c, setup_db)
    async with _tenant_db(setup_db, c['tenant']) as writer:
        target = await writer.get(models.Operator, c['ids'][0])
        target.full_name = 'Uncommitted competing restore write'
        await writer.flush()
        response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
        assert response.status_code == 409, response.text
        assert 'busy' in response.json()['detail']
        await writer.rollback()
    assert await snapshot(c, setup_db) == before
    response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        assert (await db.get(models.Operator, c['ids'][0])).full_name == 'Earlier staged field restore'
        versions = (await db.scalars(select(models.UserPoolVersion).order_by(models.UserPoolVersion.id))).all()
        assert len(versions) == 2 and versions[-1].is_active
        assert versions[-1].diff_summary['source_version_id'] == version_id


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['same_update', 'different_updates', 'same_creation'])
async def test_concurrent_restores_preserve_each_complete_revision(operator_scope, setup_db, monkeypatch, operation):
    from app.api import authorization
    from app.api.settings import build_user_pool_snapshot

    c = operator_scope
    sources = []
    target_id = 'restore-created' if operation == 'same_creation' else 'input-target'
    async with _tenant_db(setup_db, c['tenant']) as db:
        for index in range(2):
            records = await build_user_pool_snapshot(db)
            if operation == 'same_creation':
                records.append({'external_id': target_id, 'username': target_id, 'full_name': 'Recreated identity',
                                'email': None, 'department': None})
            else:
                target = next(row for row in records if row['external_id'] == target_id)
                target['full_name'] = 'First historical name' if index == 0 or operation == 'same_update' else 'Second historical name'
            version = models.UserPoolVersion(version_label=f'concurrent-restore-{index}', snapshot_data=records,
                                            diff_summary={}, created_by='admin_root', is_active=False)
            db.add(version)
            await db.flush()
            sources.append((version.id, next(row['full_name'] for row in records if row['external_id'] == target_id)))
        await db.commit()
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
        c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
        for version_id, _ in sources
    ], return_exceptions=True), 10)
    assert not any(isinstance(response, BaseException) for response in responses), [repr(response) for response in responses]
    assert [response.status_code for response in responses] == [200, 200], [response.text for response in responses]
    async with _tenant_db(setup_db, c['tenant']) as db:
        versions = (await db.scalars(select(models.UserPoolVersion).order_by(models.UserPoolVersion.id))).all()
        assert len(versions) == 4 and sum(version.is_active for version in versions) == 1 and versions[-1].is_active
        restored = versions[2:]
        assert {version.diff_summary['source_version_id'] for version in restored} == {source[0] for source in sources}
        for version in restored:
            saved = next(row for row in version.snapshot_data if row['external_id'] == target_id)
            assert saved['full_name'] == dict(sources)[version.diff_summary['source_version_id']]
        operators = (await db.scalars(select(models.Operator).where(models.Operator.external_id == target_id))).all()
        assert len(operators) == 1
        saved = next(row for row in restored[-1].snapshot_data if row['external_id'] == target_id)
        assert operators[0].full_name == saved['full_name']


@pytest.mark.asyncio
@pytest.mark.parametrize('reserved_field', ['username', 'external_id'])
async def test_restore_cannot_delete_reserved_root_by_omitting_it_from_snapshot(operator_scope, setup_db, reserved_field):
    from app.api.settings import build_user_pool_snapshot

    c = operator_scope
    await _grant_access(setup_db, tenant_id=c['tenant'], user_id='ordinary-restore-manager', role='ADMIN')
    async with _tenant_db(setup_db, c['tenant']) as db:
        root = await db.scalar(select(models.Operator).where(models.Operator.username == 'admin_root'))
        assert root is not None
        root.username = 'admin_root' if reserved_field == 'username' else 'deployment-root-alias'
        root.external_id = 'admin_root' if reserved_field == 'external_id' else 'deployment-root-key'
        db.add(models.Operator(external_id='ordinary-restore-manager', username='ordinary-restore-manager', is_admin=True))
        await db.flush()
        records = [row for row in await build_user_pool_snapshot(db) if row['id'] != root.id]
        next(row for row in records if row['external_id'] == 'input-target').update(
            full_name='Rejected deletion change', team='Rejected deletion team')
        version = models.UserPoolVersion(version_label='omitted-root-fixture', snapshot_data=records,
                                        diff_summary={}, created_by='admin_root', is_active=False)
        db.add(version)
        await db.commit()
        version_id = version.id
    before = await snapshot(c, setup_db)
    response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}',
        headers={**c['headers'], 'X-User-Id': 'ordinary-restore-manager'})
    assert response.status_code == 403, response.text
    assert response.json()['detail']['code'] == 'RESERVED_SYSTEM_ROOT_IDENTITY'
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('actor_identity', ['username', 'external_id'])
async def test_empty_restore_preserves_actor_resolved_by_either_supported_identity(operator_scope, setup_db, actor_identity):
    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        actor = await db.scalar(select(models.Operator).where(models.Operator.username == 'admin_root'))
        assert actor is not None
        if actor_identity == 'external_id':
            actor.username = 'root-display-name'
        actor.external_id = 'admin_root'
        actor_id = actor.id
        version = models.UserPoolVersion(version_label='omitted-actor-fixture', snapshot_data=[],
                                        diff_summary={}, created_by='admin_root', is_active=False)
        db.add(version)
        await db.commit()
        version_id = version.id
        await db.refresh(actor)
        expected = {col.name: getattr(actor, col.name) for col in models.Operator.__table__.columns}
    response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        operators = (await db.scalars(select(models.Operator))).all()
        assert len(operators) == 1 and operators[0].id == actor_id
        assert {col.name: getattr(operators[0], col.name) for col in models.Operator.__table__.columns} == expected
        versions = (await db.scalars(select(models.UserPoolVersion).order_by(models.UserPoolVersion.id))).all()
        assert len(versions) == 2 and versions[-1].is_active and not versions[0].is_active
        assert versions[0].snapshot_data == []
        assert [row['external_id'] for row in versions[-1].snapshot_data] == ['admin_root']
        assert versions[-1].diff_summary['source_version_id'] == version_id


@pytest.mark.asyncio
@pytest.mark.parametrize('intent', ['mixed', 'empty'])
async def test_restore_revision_counts_describe_actual_changes_and_repeated_restore(operator_scope, setup_db, intent):
    from app.api.settings import build_user_pool_snapshot

    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        records = await build_user_pool_snapshot(db) if intent == 'mixed' else []
        if intent == 'mixed':
            records = [row for row in records if row['external_id'] != 'input-peer']
            next(row for row in records if row['external_id'] == 'input-target')['full_name'] = 'Restored summary identity'
            records.append({'external_id': 'summary-new', 'username': 'summary-new', 'full_name': 'Restored new identity'})
        version = models.UserPoolVersion(version_label='restore-count-fixture', snapshot_data=records,
                                        diff_summary={}, created_by='admin_root', is_active=False)
        db.add(version)
        await db.commit()
        version_id = version.id
    for iteration in range(2):
        response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
        assert response.status_code == 200, response.text
        expected = {'added': 0, 'removed': 0, 'changed': 0} if iteration else (
            {'added': 1, 'removed': 1, 'changed': 1} if intent == 'mixed' else {'added': 0, 'removed': 2, 'changed': 0})
        async with _tenant_db(setup_db, c['tenant']) as db:
            versions = (await db.scalars(select(models.UserPoolVersion).order_by(models.UserPoolVersion.id))).all()
            assert len(versions) == iteration + 2
            assert sum(row.is_active for row in versions) == 1 and versions[-1].is_active
            assert versions[0].snapshot_data == records
            assert {key: versions[-1].diff_summary[key] for key in expected} == expected
            assert versions[-1].diff_summary['source_version_id'] == version_id
            operators = (await db.scalars(select(models.Operator))).all()
            by_identity = {row.external_id: row for row in operators}
            assert set(by_identity) == ({'admin_root', 'input-target', 'summary-new'} if intent == 'mixed' else {'admin_root'})
            if intent == 'mixed':
                assert by_identity['input-target'].full_name == 'Restored summary identity'
                assert by_identity['summary-new'].full_name == 'Restored new identity'


@pytest.mark.asyncio
async def test_restore_counts_preserved_text_bytes_as_actual_change(operator_scope, setup_db):
    from app.api.settings import build_user_pool_snapshot

    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        records = await build_user_pool_snapshot(db)
        next(row for row in records if row['external_id'] == 'input-target')['full_name'] = ' Original name '
        version = models.UserPoolVersion(version_label='restore-text-count-fixture', snapshot_data=records,
                                        diff_summary={}, created_by='admin_root', is_active=False)
        db.add(version)
        await db.commit()
        version_id = version.id
    response = await c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}', headers=c['headers'])
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        assert (await db.get(models.Operator, c['ids'][0])).full_name == ' Original name '
        version = await db.scalar(select(models.UserPoolVersion).where(models.UserPoolVersion.is_active.is_(True)))
        assert {key: version.diff_summary[key] for key in ['added', 'removed', 'changed']} == {
            'added': 0, 'removed': 0, 'changed': 1,
        }


async def write_operator(c, operation, payload):
    base = '/api/v1/settings/operators'
    if operation in ['create', 'upsert']:
        name = 'input-new' if operation == 'create' else 'input-target'
        return await c['client'].post(base, headers=c['headers'],
            json={'external_id': name, 'username': name, **payload})
    if operation == 'patch':
        return await c['client'].patch(f"{base}/{c['ids'][0]}", headers=c['headers'], json=payload)
    return await c['client'].post(base + '/bulk-update', headers=c['headers'], json={'updates': [
        {'id': c['ids'][1], 'payload': {'full_name': 'Earlier valid change', 'team': 'Earlier valid team'}},
        {'id': c['ids'][0], 'payload': payload},
    ]})


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'upsert', 'patch', 'bulk'])
@pytest.mark.parametrize('value', ['false', 'true', 0, 1, None, [], {}, ['false']])
async def test_invalid_admin_flag_preserves_all_operator_team_and_version_state(operator_scope, setup_db, operation, value):
    c = operator_scope
    before = await snapshot(c, setup_db)
    response = await write_operator(c, operation, {'is_admin': value, 'team': 'Rejected team', 'full_name': 'Rejected name'})
    assert response.status_code == 422, response.text
    assert response.json()['detail']['field_errors'] == {'is_admin': 'Must be a boolean'}
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'upsert', 'patch', 'bulk'])
@pytest.mark.parametrize('flag', ['omitted', True, False])
async def test_explicit_boolean_privileges_and_omitted_flags_retain_their_meaning(operator_scope, setup_db, operation, flag):
    c = operator_scope
    payload = {'full_name': 'Accepted name'}
    if flag != 'omitted':
        payload['is_admin'] = flag
    response = await write_operator(c, operation, payload)
    assert response.status_code == 200, response.text
    expected = operation != 'create' if flag == 'omitted' else flag
    async with _tenant_db(setup_db, c['tenant']) as db:
        name = 'input-new' if operation == 'create' else 'input-target'
        row = await db.scalar(select(models.Operator).where(models.Operator.external_id == name))
        assert row.is_admin is expected and row.full_name == 'Accepted name'
        versions = (await db.scalars(select(models.UserPoolVersion))).all()
        assert len(versions) == 1 and versions[0].created_by == 'admin_root'
        saved = next(record for record in versions[0].snapshot_data if record['external_id'] == name)
        assert saved['is_admin'] is expected


@pytest.mark.asyncio
@pytest.mark.parametrize('action', ['update', 'delete'])
@pytest.mark.parametrize('value', [True, False, 0, -1, 2 ** 63, -(2 ** 63) - 1, 1.0, '1', None, [], {}])
async def test_invalid_bulk_ids_never_alias_rows_or_leave_partial_writes(operator_scope, setup_db, action, value):
    c = operator_scope
    before = await snapshot(c, setup_db)
    payload = {'ids': [c['ids'][1], value]} if action == 'delete' else {'updates': [
        {'id': c['ids'][1], 'payload': {'full_name': 'Earlier valid change', 'team': 'Earlier valid team'}},
        {'id': value, 'payload': {'is_admin': False}},
    ]}
    response = await c['client'].post(f'/api/v1/settings/operators/bulk-{action}', headers=c['headers'], json=payload)
    assert response.status_code == 400, response.text
    assert 'id' in response.json()['detail'] and 'integer' in response.json()['detail']
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('action', ['update', 'delete'])
async def test_valid_but_missing_bulk_id_rolls_back_earlier_changes(operator_scope, setup_db, action):
    c = operator_scope
    before = await snapshot(c, setup_db)
    payload = {'ids': [c['ids'][1], 2 ** 63 - 1]} if action == 'delete' else {'updates': [
        {'id': c['ids'][1], 'payload': {'is_admin': False, 'team': 'Earlier valid team'}},
        {'id': 2 ** 63 - 1, 'payload': {'is_admin': False}},
    ]}
    response = await c['client'].post(f'/api/v1/settings/operators/bulk-{action}', headers=c['headers'], json=payload)
    assert response.status_code == 404, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'upsert', 'patch', 'bulk', 'delete'])
async def test_settings_reader_cannot_reach_privilege_mutations(operator_scope, setup_db, operation):
    c = operator_scope
    await _grant_access(setup_db, tenant_id=c['tenant'], user_id='input-reader', role='VIEWER')
    async with _tenant_db(setup_db, c['tenant']) as db:
        db.add(models.Operator(username='input-reader', is_admin=False, custom_permissions={'settings': 1}))
        await db.commit()
    before = await snapshot(c, setup_db)
    c = {**c, 'headers': {**c['headers'], 'X-User-Id': 'input-reader'}}
    if operation == 'delete':
        response = await c['client'].post('/api/v1/settings/operators/bulk-delete', headers=c['headers'], json={'ids': [True]})
    else:
        response = await write_operator(c, operation, {'is_admin': 'false'})
    assert response.status_code == 403, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['patch', 'bulk', 'upsert'])
@pytest.mark.parametrize('assignment', ['omitted', 'same', 'clear', 'new'])
async def test_grouped_operator_edits_load_and_preserve_team_authority(operator_scope, setup_db, operation, assignment):
    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        team = models.Team(name='Existing team')
        db.add(team)
        await db.flush()
        for op_id in c['ids']:
            row = await db.get(models.Operator, op_id)
            row.team_id, row.team, row.teams = team.id, team.name, [team.name]
        await db.commit()
        team_id = team.id
    payload = {'custom_permissions': {'racks': 2}, 'is_admin': False}
    if assignment == 'same':
        payload['team_id'] = team_id
    elif assignment == 'clear':
        payload['team_id'] = None
    elif assignment == 'new':
        payload['team'] = 'Replacement team'
    response = await write_operator(c, operation, payload)
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        row = await db.get(models.Operator, c['ids'][0])
        assert row.is_admin is False and row.custom_permissions == {'racks': 2}
        if assignment == 'clear':
            assert row.team_id is None and row.team is None
        elif assignment == 'new':
            assert row.team_id != team_id and row.team == 'Replacement team'
        else:
            assert row.team_id == team_id and row.team == 'Existing team'
        versions = (await db.scalars(select(models.UserPoolVersion))).all()
        assert len(versions) == 1 and versions[0].created_by == 'admin_root'
        saved = next(record for record in versions[0].snapshot_data if record['external_id'] == 'input-target')
        assert saved['team_id'] == row.team_id and saved['custom_permissions'] == {'racks': 2}


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['patch', 'bulk', 'upsert'])
@pytest.mark.parametrize('source', ['synced', 'manual', 'manual_override', None])
@pytest.mark.parametrize('payload', [{}, {'is_admin': False}, {'custom_permissions': {'racks': 2}}, {'full_name': 'Updated name'}])
async def test_partial_operator_updates_preserve_omitted_team_source(operator_scope, setup_db, operation, source, payload):
    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        team = models.Team(name='Directory owned team')
        db.add(team)
        await db.flush()
        row = await db.get(models.Operator, c['ids'][0])
        row.team_id, row.team, row.teams, row.team_source = team.id, team.name, [team.name], source
        await db.commit()
        team_id = team.id
    response = await write_operator(c, operation, payload)
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        row = await db.get(models.Operator, c['ids'][0])
        assert row.team_source == source
        assert row.team_id == team_id and row.team == 'Directory owned team' and row.teams == ['Directory owned team']
        versions = (await db.scalars(select(models.UserPoolVersion))).all()
        for version in versions:
            saved = next(record for record in version.snapshot_data if record['external_id'] == 'input-target')
            assert saved['team_source'] == source


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['patch', 'bulk', 'upsert'])
@pytest.mark.parametrize('assignment', ['same', 'clear', 'new', 'explicit-source'])
async def test_explicit_operator_team_changes_retain_source_authority(operator_scope, setup_db, operation, assignment):
    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        team = models.Team(name='Directory owned team')
        db.add(team)
        await db.flush()
        row = await db.get(models.Operator, c['ids'][0])
        row.team_id, row.team, row.teams, row.team_source = team.id, team.name, [team.name], 'synced'
        await db.commit()
        team_id = team.id
    payload = {
        'same': {'team_id': team_id}, 'clear': {'team_id': None}, 'new': {'team': 'Manual team'},
        'explicit-source': {'team_source': 'manual'},
    }[assignment]
    response = await write_operator(c, operation, payload)
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        row = await db.get(models.Operator, c['ids'][0])
        assert row.team_source == ('manual' if operation == 'upsert' or assignment in ['clear', 'explicit-source'] else 'manual_override')
        if assignment == 'clear':
            assert row.team_id is None and row.team is None
        elif assignment == 'new':
            assert row.team_id != team_id and row.team == 'Manual team'
        else:
            assert row.team_id == team_id and row.team == 'Directory owned team'


@pytest.mark.asyncio
@pytest.mark.parametrize('assignment', ['omitted', 'same', 'clear', 'new', 'create'])
async def test_operator_upsert_records_only_actual_primary_team_transitions(operator_scope, setup_db, assignment):
    c = operator_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        team = models.Team(name='Original team')
        db.add(team)
        await db.flush()
        row = await db.get(models.Operator, c['ids'][0])
        row.team_id, row.team, row.teams, row.team_source = team.id, team.name, [team.name], 'manual'
        await db.commit()
        team_id = team.id
    before = await snapshot(c, setup_db)
    payload = {
        'omitted': {}, 'same': {'team_id': team_id}, 'clear': {'team_id': None},
        'new': {'team': 'Replacement team'}, 'create': {'team_id': team_id},
    }[assignment]
    response = await write_operator(c, 'create' if assignment == 'create' else 'upsert', payload)
    assert response.status_code == 200, response.text
    if assignment in ['omitted', 'same']:
        assert await snapshot(c, setup_db) == before
        return
    async with _tenant_db(setup_db, c['tenant']) as db:
        audits = (await db.scalars(select(models.TeamAudit).order_by(models.TeamAudit.id))).all()
        expected = ['member_removed', 'member_added'] if assignment == 'new' else ['member_removed'] if assignment == 'clear' else ['member_added']
        assert [row.action for row in audits] == expected
        assert all(row.actor == 'admin_root' for row in audits)
        if assignment in ['clear', 'new']:
            assert audits[0].team_id == team_id
        if assignment == 'new':
            assert audits[1].team_id != team_id
        versions = (await db.scalars(select(models.UserPoolVersion))).all()
        assert len(versions) == 1
        summary = versions[0].diff_summary
        assert summary['added'] == (1 if assignment == 'create' else 0)
        assert summary['changed'] == (0 if assignment == 'create' else 1)
        assert summary['removed'] == 0 and summary['team_updates']
        if assignment != 'create':
            transition = next(item for item in summary['team_updates'] if item['mode'] == 'primary_team_changed')
            assert transition['old'] == 'Original team'
            assert transition['new'] == (None if assignment == 'clear' else 'Replacement team')


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'upsert'])
async def test_operator_upsert_rolls_back_team_and_audit_when_version_creation_fails(operator_scope, setup_db, monkeypatch, operation):
    from fastapi import HTTPException
    from app.api import settings as settings_api

    async def fail_version(*args, **kwargs):
        raise HTTPException(503, 'Controlled version write failure')

    c = operator_scope
    before = await snapshot(c, setup_db)
    monkeypatch.setattr(settings_api, 'create_user_pool_version', fail_version)
    response = await write_operator(c, operation, {'team': 'Rejected team', 'full_name': 'Rejected name'})
    assert response.status_code == 503, response.text
    assert await snapshot(c, setup_db) == before
