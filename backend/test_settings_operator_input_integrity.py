"""Administrative inputs preserve privilege intent and atomic user-pool writes."""
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
