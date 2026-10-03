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
async def test_restore_rechecks_revoked_authority_inside_write_transaction(operator_scope, setup_db, grant):
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
    dependency = inspect.signature(settings_api.restore_user_pool).parameters['_settings_access'].default.dependency

    async def hold_accepted_authority(request: Request, db=Depends(get_db)):
        result = await dependency(request=request, db=db)
        assert authorization.has_capability(result, 'settings', 3)
        resolved.set()
        await release.wait()
        return result

    app.dependency_overrides[dependency] = hold_accepted_authority
    task = asyncio.create_task(c['client'].post(f'/api/v1/settings/user-pool/restore/{version_id}',
        headers=c['headers']))
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
