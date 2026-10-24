"""Asset commands are actor-bound, atomic, replayable and safe to compensate."""
import asyncio
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select, update

from app.api import devices
from app.models import models
from test_asset_write_boundary import asset_context
from test_asset_stale_form import snapshot
from test_chg13_authorization_security import _tenant_db, _grant_access, _seed_operator

PATH = '/api/v1/devices/bulk-action'


@pytest_asyncio.fixture
async def command_context(asset_context, setup_db):
    async with _tenant_db(setup_db, asset_context[1]) as db:
        second = models.Device(name='Second command host', system='Command system', tenant_id=asset_context[1],
            environment='Production', os_name='Linux', os_version='1')
        db.add(second)
        await db.flush()
        db.add(models.LogicalService(device_id=second.id, name='Linux', version='1', service_type='OS',
            status='Active', environment='Legacy OS environment'))
        await db.commit()
        return asset_context, [asset_context[2], second.id]


async def state(context, setup_db):
    result = await snapshot(context, setup_db)
    async with _tenant_db(setup_db, context[1]) as db:
        for model in (models.AssetWriteReceipt, models.HardwareComponent):
            rows = (await db.scalars(select(model).order_by(model.id))).all()
            result[model.__tablename__] = [{column.name: getattr(row, column.name) for column in model.__table__.columns} for row in rows]
    return result


async def preview(context, ids, action='update', payload=None):
    response = await context[0].post(PATH, headers=context[3], json={'ids': ids, 'action': action, 'payload': payload or {}, 'dry_run': True})
    assert response.status_code == 200, response.text
    result = response.json()
    assert len(result['precondition']) == 64 and set(result['versions']) == {str(identity) for identity in ids}
    return result


def execution(reviewed, ids, action='update', payload=None):
    return {'ids': ids, 'action': action, 'payload': payload or {}, 'precondition': reviewed['precondition'], 'operation_id': uuid4().hex}


async def apply(context, ids, action='update', payload=None):
    request = execution(await preview(context, ids, action, payload), ids, action, payload)
    response = await context[0].post(PATH, headers=context[3], json=request)
    assert response.status_code == 200, response.text
    return request, response.json()


async def undo(context, result, ids=None):
    return await context[0].post(PATH, headers=context[3], json={'action': 'undo', 'ids': ids or result['changed_ids'], 'receipt_id': result['receipt_id']})


@pytest.mark.asyncio
@pytest.mark.parametrize('action', ['update', 'delete', 'restore', 'purge'])
async def test_asset_preview_rejects_peer_changes_before_any_batch_write(command_context, setup_db, action):
    context, ids = command_context
    if action == 'restore':
        await apply(context, ids, 'delete')
    payload = {'owner': 'New bulk owner'} if action == 'update' else {}
    reviewed = await preview(context, ids, action, payload)
    peer = await context[0].put(f'/api/v1/devices/{ids[0]}', headers=context[3], json={'owner': 'Committed peer'})
    assert peer.status_code == 200, peer.text
    before = await state(context, setup_db)
    response = await context[0].post(PATH, headers=context[3], json=execution(reviewed, ids, action, payload))
    assert response.status_code == 409, response.text
    assert await state(context, setup_db) == before


@pytest.mark.asyncio
async def test_purge_preview_binds_complete_dependency_values(command_context, setup_db):
    context, ids = command_context
    reviewed = await preview(context, [ids[0]], 'purge')
    async with _tenant_db(setup_db, context[1]) as db:
        db.add(models.HardwareComponent(device_id=ids[0], category='Memory', count=1))
        await db.commit()
    before = await state(context, setup_db)
    response = await context[0].post(PATH, headers=context[3], json=execution(reviewed, [ids[0]], 'purge'))
    assert response.status_code == 409, response.text
    assert await state(context, setup_db) == before


@pytest.mark.asyncio
async def test_asset_response_loss_replays_without_a_second_write_or_audit(command_context, setup_db):
    context, ids = command_context
    request, result = await apply(context, ids, payload={'owner': 'Committed batch'})
    before = await state(context, setup_db)
    replay = await context[0].post(PATH, headers=context[3], json=request)
    assert replay.status_code == 200 and replay.json() == result, replay.text
    assert await state(context, setup_db) == before
    assert len(before['asset_write_receipts']) == 1
    assert len([row for row in before['audit_logs'] if row['action'] == 'UPDATE']) == 2
    rebound = {**request, 'payload': {'owner': 'Different request'}}
    rejected = await context[0].post(PATH, headers=context[3], json=rebound)
    assert rejected.status_code == 409, rejected.text
    assert await state(context, setup_db) == before


@pytest.mark.asyncio
async def test_guarded_purge_preserves_structured_missing_record_conflicts(command_context, setup_db):
    context, ids = command_context
    reviewed = await preview(context, ids, 'purge')
    await apply(context, [ids[0]], 'purge')
    before = await state(context, setup_db)
    rejected = await context[0].post(PATH, headers=context[3], json=execution(reviewed, ids, 'purge'))
    assert rejected.status_code == 409, rejected.text
    assert rejected.json()['detail']['preview']['missing_ids'] == [ids[0]]
    assert await state(context, setup_db) == before


@pytest.mark.asyncio
async def test_overlapping_asset_commands_have_one_durable_result(command_context, setup_db):
    context, ids = command_context
    request = execution(await preview(context, ids, payload={'owner': 'Concurrent batch'}), ids, payload={'owner': 'Concurrent batch'})
    responses = await asyncio.gather(*(context[0].post(PATH, headers=context[3], json=request) for _ in range(2)))
    assert [response.status_code for response in responses] == [200, 200], [response.text for response in responses]
    assert responses[0].json() == responses[1].json()
    after = await state(context, setup_db)
    assert len(after['asset_write_receipts']) == 1
    assert len([row for row in after['audit_logs'] if row['action'] == 'UPDATE']) == 2


@pytest.mark.asyncio
async def test_asset_noop_and_replay_do_not_mutate_domain_projection_or_audit(command_context, setup_db):
    context, ids = command_context
    await apply(context, ids, payload={'owner': 'Same owner'})
    before = await snapshot(context, setup_db)
    request, result = await apply(context, ids, payload={'owner': 'Same owner'})
    assert result['changed_count'] == 0 and result['can_revert'] is False
    assert await snapshot(context, setup_db) == before
    replay = await context[0].post(PATH, headers=context[3], json=request)
    assert replay.status_code == 200 and replay.json() == result, replay.text
    assert await snapshot(context, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('peer', ['asset', 'os'])
async def test_asset_undo_rejects_peer_changes_atomically(command_context, setup_db, peer):
    context, ids = command_context
    _, result = await apply(context, ids, payload={'environment': 'Development'})
    async with _tenant_db(setup_db, context[1]) as db:
        model = models.Device if peer == 'asset' else models.LogicalService
        clause = model.id == ids[1] if peer == 'asset' else model.device_id == ids[1]
        await db.execute(update(model).where(clause).values(**({'owner': 'Peer owner'} if peer == 'asset' else {'environment': 'Peer OS environment'})))
        await db.commit()
    before = await state(context, setup_db)
    rejected = await undo(context, result)
    assert rejected.status_code == 409, rejected.text
    assert await state(context, setup_db) == before


@pytest.mark.asyncio
async def test_asset_undo_restores_raw_os_values_and_is_idempotent(command_context, setup_db):
    context, ids = command_context
    original = await snapshot(context, setup_db)
    _, result = await apply(context, ids, payload={'environment': 'Development'})
    reverted = await undo(context, result)
    assert reverted.status_code == 200, reverted.text
    after = await snapshot(context, setup_db)
    for table in ['devices', 'logical_services']:
        for before_row, after_row in zip(original[table], after[table]):
            assert {key: value for key, value in before_row.items() if key not in {'edit_revision', 'updated_at'}} == {key: value for key, value in after_row.items() if key not in {'edit_revision', 'updated_at'}}
    before = await state(context, setup_db)
    repeated = await undo(context, result)
    assert repeated.status_code == 200 and repeated.json()['changed_count'] == 0
    assert await state(context, setup_db) == before


@pytest.mark.asyncio
async def test_asset_owner_edit_does_not_repair_or_normalize_unrelated_os_state(command_context, setup_db):
    context, ids = command_context
    before = await snapshot(context, setup_db)
    _, result = await apply(context, ids, payload={'owner': 'Temporary owner'})
    assert (await snapshot(context, setup_db))['logical_services'] == before['logical_services']
    assert (await undo(context, result)).status_code == 200
    after = await snapshot(context, setup_db)
    assert after['logical_services'] == before['logical_services']
    assert all(row['owner'] is None for row in after['devices'])


@pytest.mark.asyncio
async def test_asset_rename_undo_rejects_a_reused_original_hostname(command_context, setup_db):
    context, ids = command_context
    _, result = await apply(context, [ids[1]], payload={'name': 'Renamed command host'})
    replacement = await context[0].post('/api/v1/devices', headers=context[3],
        json={'name': 'SECOND COMMAND HOST', 'system': 'Replacement system'})
    assert replacement.status_code == 200, replacement.text
    before = await state(context, setup_db)
    rejected = await undo(context, result)
    assert rejected.status_code == 409 and 'hostname' in rejected.text, rejected.text
    assert await state(context, setup_db) == before


@pytest.mark.asyncio
async def test_partial_asset_recovery_preserves_unpurged_records(command_context, setup_db):
    context, ids = command_context
    _, result = await apply(context, ids, 'delete')
    await apply(context, [ids[0]], 'purge')
    reverted = await undo(context, result, [ids[1]])
    assert reverted.status_code == 200 and reverted.json()['changed_ids'] == [ids[1]], reverted.text
    rows = (await snapshot(context, setup_db))['devices']
    assert len(rows) == 1 and rows[0]['id'] == ids[1] and rows[0]['is_deleted'] is False
    before = await state(context, setup_db)
    assert (await undo(context, result, [ids[1]])).status_code == 200
    assert await state(context, setup_db) == before


@pytest.mark.asyncio
async def test_asset_command_failure_rolls_back_every_row_projection_audit_and_receipt(command_context, setup_db, monkeypatch):
    context, ids = command_context
    reviewed = await preview(context, ids, payload={'environment': 'Development'})
    before = await state(context, setup_db)
    async def failed_projection(*args): raise RuntimeError('Controlled projection failure')
    monkeypatch.setattr(devices, 'sync_device_to_os', failed_projection)
    with pytest.raises(RuntimeError, match='Controlled projection failure'):
        await context[0].post(PATH, headers=context[3], json=execution(reviewed, ids, payload={'environment': 'Development'}))
    assert await state(context, setup_db) == before


@pytest.mark.asyncio
async def test_asset_preview_replay_and_undo_are_bound_to_the_real_actor(command_context, setup_db):
    context, ids = command_context
    actor = 'independent-asset-editor'
    await _grant_access(setup_db, tenant_id=context[1], user_id=actor, role='EDITOR')
    await _seed_operator(setup_db, context[1], actor, role_permissions={'assets': 3})
    other = (*context[:3], {**context[3], 'X-User-Id': actor})
    reviewed = await preview(context, ids, payload={'owner': 'Actor-bound'})
    assert (await preview(other, ids, payload={'owner': 'Actor-bound'}))['matched_count'] == 2
    before = await state(context, setup_db)
    denied = await other[0].post(PATH, headers=other[3], json=execution(reviewed, ids, payload={'owner': 'Actor-bound'}))
    assert denied.status_code == 409, denied.text
    assert await state(context, setup_db) == before
    request, result = await apply(context, ids, payload={'owner': 'Actor-bound'})
    before = await state(context, setup_db)
    assert (await undo(other, result)).status_code == 404
    assert (await other[0].post(PATH, headers=other[3], json=request)).status_code == 409
    assert await state(context, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('field,value', [('precondition', None), ('precondition', 'a' * 63), ('operation_id', None), ('operation_id', True)])
async def test_invalid_asset_guards_fail_before_writes(command_context, setup_db, field, value):
    context, ids = command_context
    request = execution(await preview(context, ids, payload={'owner': 'Must not persist'}), ids, payload={'owner': 'Must not persist'})
    before = await state(context, setup_db)
    response = await context[0].post(PATH, headers=context[3], json={**request, field: value})
    assert response.status_code == 400, response.text
    assert await state(context, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('field,value', [('schema_version', 99), ('before_state', {}), ('post_state', {'invalid': 'state'}), ('projection_state', []), ('undo_state', {'unexpected': True})])
async def test_corrupt_asset_receipts_fail_closed(command_context, setup_db, field, value):
    context, ids = command_context
    _, result = await apply(context, ids, payload={'environment': 'Development'})
    async with _tenant_db(setup_db, context[1]) as db:
        row = await db.get(models.AssetWriteReceipt, result['receipt_id'])
        setattr(row, field, value)
        await db.commit()
    before = await state(context, setup_db)
    response = await undo(context, result)
    assert response.status_code == 409, response.text
    assert await state(context, setup_db) == before
