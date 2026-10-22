"""Guarded Service batches cannot overwrite intervening operator changes."""
import asyncio
import re
from uuid import uuid4

import pytest
from sqlalchemy import delete, event, select, update
from sqlalchemy.orm import Session

from app.api import logical_services
from app.models import models
from test_chg13_authorization_security import _tenant_db
from test_service_relationship_authority import service_scope, snapshot
from test_service_stale_form import read_service


PATH = '/api/v1/logical-services/bulk-action'
TABLE_PATH = '/api/v1/logical-services/table-edit'


async def table_request(c, changes):
    rows = []
    for identity, values in changes:
        row = await read_service(c, identity)
        rows.append({'id': identity, 'expected_revision': row['edit_revision'], 'changes': values})
    return {'operation_id': uuid4().hex, 'rows': rows}


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', ['stale', 'invalid', 'missing', 'archived', 'foreign'])
async def test_table_edit_rejects_whole_draft_before_any_write(service_scope, setup_db, failure):
    c = service_scope
    a, b = c['rows']['owned'], c['rows']['floating']
    data = await table_request(c, [(a, {'purpose': 'Draft A'}), (b, {'purpose': 'Draft B'})])
    expected = 409
    if failure == 'stale':
        peer = await c['client'].put(f'/api/v1/logical-services/{b}', headers=c['headers'], json={'purpose': 'Peer'})
        assert peer.status_code == 200
    elif failure == 'invalid': data['rows'][1]['changes'] = {'cost': -1}; expected = 422
    elif failure == 'missing': data['rows'][1]['id'] = 99999999; expected = 404
    elif failure == 'archived': data['rows'][1]['id'] = c['rows']['deleted']
    else: data['rows'][1]['id'] = c['rows']['foreign']; expected = 404
    before = await state(c, setup_db)
    response = await c['client'].post(TABLE_PATH, headers=c['headers'], json=data)
    assert response.status_code == expected, response.text
    assert await state(c, setup_db) == before


@pytest.mark.asyncio
async def test_table_edit_changes_only_supplied_fields_and_replays_without_writes(service_scope, setup_db):
    c = service_scope
    a, b = c['rows']['owned'], c['rows']['floating']
    before = await snapshot(c, setup_db)
    data = await table_request(c, [(a, {'purpose': 'New purpose'}), (b, {'cost': 17.5, 'installation_date': '2024-02-29'})])
    response = await c['client'].post(TABLE_PATH, headers=c['headers'], json=data)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['changed_ids'] == [a, b] and result['can_revert'] is False
    after = await state(c, setup_db)
    assert after['domain']['service_secrets'] == before['service_secrets']
    for previous, current in zip(before['logical_services'], after['domain']['logical_services']):
        allowed = {'purpose'} if previous['id'] == a else {'cost', 'installation_date'} if previous['id'] == b else set()
        changed_fields = {field for field in previous if previous[field] != current[field]}
        assert changed_fields <= allowed | ({'updated_at', 'edit_revision'} if allowed else set())
    assert len(after['domain']['audit_logs']) == len(before['audit_logs']) + 2
    replay = await c['client'].post(TABLE_PATH, headers=c['headers'], json=data)
    assert replay.status_code == 200 and replay.json() == result
    assert await state(c, setup_db) == after
    data['rows'][0]['changes']['purpose'] = 'Different payload'
    collision = await c['client'].post(TABLE_PATH, headers=c['headers'], json=data)
    assert collision.status_code == 409
    assert await state(c, setup_db) == after


@pytest.mark.asyncio
async def test_table_noop_preserves_revisions_projections_and_audits(service_scope, setup_db):
    c = service_scope
    data = await table_request(c, [(c['rows']['owned'], {})])
    before = await snapshot(c, setup_db)
    response = await c['client'].post(TABLE_PATH, headers=c['headers'], json=data)
    assert response.status_code == 200 and response.json()['changed_count'] == 0, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['revision', 'duplicate', 'field', 'boolean-id', 'operation'])
async def test_table_invalid_envelopes_fail_without_receipts(service_scope, setup_db, kind):
    c = service_scope
    data = await table_request(c, [(c['rows']['owned'], {'purpose': 'Draft'})])
    if kind == 'revision': data['rows'][0]['expected_revision'] = None
    elif kind == 'duplicate': data['rows'] *= 2
    elif kind == 'field': data['rows'][0]['changes']['device_id'] = c['devices']['owned']
    elif kind == 'boolean-id': data['rows'][0]['id'] = True
    else: data['operation_id'] = 'invalid'
    before = await state(c, setup_db)
    response = await c['client'].post(TABLE_PATH, headers=c['headers'], json=data)
    assert response.status_code == 400, response.text
    assert await state(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', ['audit', 'host'])
async def test_table_failures_roll_back_all_rows_audits_hosts_and_receipts(service_scope, setup_db, monkeypatch, failure):
    c = service_scope
    data = await table_request(c, [(c['rows']['owned'], {'purpose': 'OS purpose'}), (c['rows']['floating'], {'purpose': 'Other purpose'})])
    before = await state(c, setup_db)
    def fail_audit(session, *_):
        if any(isinstance(row, models.AuditLog) and row.target_table == 'logical_services' for row in session.new):
            raise RuntimeError('controlled table audit failure')
    original = logical_services.sync_device_os_state
    async def fail_host(identity, db):
        await original(identity, db)
        await db.flush()
        raise RuntimeError('controlled table host failure')
    if failure == 'audit': event.listen(Session, 'before_flush', fail_audit)
    else: monkeypatch.setattr(logical_services, 'sync_device_os_state', fail_host)
    try:
        with pytest.raises(RuntimeError, match='controlled table ' + failure + ' failure'):
            await c['client'].post(TABLE_PATH, headers=c['headers'], json=data)
    finally:
        if failure == 'audit': event.remove(Session, 'before_flush', fail_audit)
    assert await state(c, setup_db) == before


@pytest.mark.asyncio
async def test_overlapping_table_requests_replay_one_atomic_receipt(service_scope, setup_db):
    c = service_scope
    data = await table_request(c, [(c['rows']['floating'], {'purpose': 'One durable edit'})])
    before = await snapshot(c, setup_db)
    responses = await asyncio.gather(*(c['client'].post(TABLE_PATH, headers=c['headers'], json=data) for _ in range(2)))
    assert [response.status_code for response in responses] == [200, 200], [response.text for response in responses]
    assert responses[0].json() == responses[1].json()
    assert len(await receipt_rows(c, setup_db)) == 1
    assert len((await snapshot(c, setup_db))['audit_logs']) == len(before['audit_logs']) + 1


@pytest.mark.asyncio
async def test_table_requires_current_module_write_permission(service_scope, setup_db):
    from test_chg13_authorization_security import _grant_access, _seed_operator
    c = service_scope
    actor = 'table-read-only'
    await _grant_access(setup_db, tenant_id=c['tenant'], user_id=actor, role='VIEWER')
    await _seed_operator(setup_db, c['tenant'], actor, role_permissions={'services': 1})
    data = await table_request(c, [(c['rows']['owned'], {'purpose': 'Forbidden'})])
    before = await state(c, setup_db)
    response = await c['client'].post(TABLE_PATH, headers={**c['headers'], 'X-User-Id': actor}, json=data)
    assert response.status_code == 403, response.text
    assert await state(c, setup_db) == before


async def preview(c, ids, action='update', payload=None):
    response = await c['client'].post(PATH, headers=c['headers'], json={
        'ids': ids, 'action': action, 'payload': payload or {}, 'dry_run': True,
    })
    assert response.status_code == 200, response.text
    return response.json()


def execution(preview_result, ids, action='update', payload=None, operation_id=None):
    return {'ids': ids, 'action': action, 'payload': payload or {},
            # The fallback lets unchanged Product reach the lost-write oracle
            # before this new metadata exists; successful controls require it.
            'precondition': preview_result.get('precondition', '0' * 64),
            'operation_id': operation_id or uuid4().hex}


async def receipt_rows(c, setup_db):
    async with _tenant_db(setup_db, c['tenant']) as db:
        rows = (await db.scalars(select(models.ServiceBulkReceipt).order_by(models.ServiceBulkReceipt.id))).all()
        return [{col.name: getattr(row, col.name) for col in models.ServiceBulkReceipt.__table__.columns} for row in rows]


@pytest.mark.asyncio
@pytest.mark.parametrize('peer_write', ['individual', 'bulk'])
async def test_guarded_bulk_rejects_peer_edit_after_preview(service_scope, setup_db, peer_write):
    c = service_scope
    ids = [c['rows']['owned'], c['rows']['floating']]
    payload = {'environment': 'Development'}
    reviewed = await preview(c, ids, payload=payload)
    if peer_write == 'individual':
        peer = await c['client'].put(f"/api/v1/logical-services/{ids[0]}", headers=c['headers'],
            json={'environment': 'Staging'})
    else:
        peer = await c['client'].post(PATH, headers=c['headers'],
            json={'ids': [ids[0]], 'action': 'update', 'payload': {'environment': 'Staging'}})
    assert peer.status_code == 200, peer.text
    before = await snapshot(c, setup_db)
    rejected = await c['client'].post(PATH, headers=c['headers'], json=execution(reviewed, ids, payload=payload))
    assert rejected.status_code == 409, rejected.text
    assert await snapshot(c, setup_db) == before
    assert await receipt_rows(c, setup_db) == []
    assert re.fullmatch('[0-9a-f]{64}', reviewed['precondition'])


async def apply_reviewed(c, ids, action='update', payload=None):
    reviewed = await preview(c, ids, action, payload)
    request = execution(reviewed, ids, action, payload)
    response = await c['client'].post(PATH, headers=c['headers'], json=request)
    assert response.status_code == 200, response.text
    result = response.json()
    assert re.fullmatch('[0-9a-f]{32}', result['receipt_id'])
    return request, result


async def undo(c, result, **overrides):
    return await c['client'].post(PATH, headers=c['headers'], json={
        'action': 'undo', 'ids': result['changed_ids'], 'receipt_id': result['receipt_id'], **overrides,
    })


async def state(c, setup_db):
    return {'domain': await snapshot(c, setup_db), 'receipts': await receipt_rows(c, setup_db)}


def business(rows):
    return [{key: value for key, value in row.items() if key not in {'edit_revision', 'updated_at'}} for row in rows]


@pytest.mark.asyncio
@pytest.mark.parametrize('action', ['update', 'delete', 'restore'])
async def test_fresh_batches_and_undo_change_only_reported_rows_and_preserve_secrets(service_scope, setup_db, action):
    c = service_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        # Begin with the established projection owner in a consistent state.
        await logical_services.sync_device_os_state(c['devices']['owned'], db)
        if action == 'update':
            (await db.get(models.LogicalService, c['rows']['owned'])).environment = 'Development'
        await db.commit()
    labels = ['owned', 'floating'] if action == 'update' else ['owned', 'deleted']
    ids = [c['rows'][label] for label in labels]
    changed_id = c['rows'][{'update': 'floating', 'delete': 'owned', 'restore': 'deleted'}[action]]
    before = await state(c, setup_db)
    payload = {'environment': 'Development'} if action == 'update' else {}
    reviewed = await preview(c, ids, action, payload)
    assert await state(c, setup_db) == before, 'Preview must not create a receipt, revision, host or audit write'
    assert reviewed['changed_ids'] == [changed_id] and reviewed['unchanged_count'] == 1
    response = await c['client'].post(PATH, headers=c['headers'], json=execution(reviewed, ids, action, payload))
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['changed_ids'] == [changed_id] and result['can_revert'] is True
    after = await snapshot(c, setup_db)
    for original, current in zip(before['domain']['logical_services'], after['logical_services']):
        if original['id'] == changed_id:
            assert current['edit_revision'] != original['edit_revision']
        else:
            assert current == original
    assert after['service_secrets'] == before['domain']['service_secrets']
    reverted = await undo(c, result)
    assert reverted.status_code == 200 and reverted.json()['changed_ids'] == [changed_id], reverted.text
    final = await snapshot(c, setup_db)
    assert business(final['logical_services']) == business(before['domain']['logical_services'])
    assert business(final['devices']) == business(before['domain']['devices'])
    assert final['service_secrets'] == before['domain']['service_secrets']
    assert len(final['audit_logs']) == len(before['domain']['audit_logs']) + 2
    rows = await receipt_rows(c, setup_db)
    assert len(rows) == 1 and rows[0]['undo_result'] == reverted.json() and rows[0]['reverted_at'] is not None


@pytest.mark.asyncio
async def test_execution_response_loss_and_repeated_undo_never_repeat_writes(service_scope, setup_db):
    c = service_scope
    request, result = await apply_reviewed(c, [c['rows']['floating']], payload={'environment': 'Development'})
    after = await state(c, setup_db)
    replay = await c['client'].post(PATH, headers=c['headers'], json=request)
    assert replay.status_code == 200 and replay.json() == result, replay.text
    assert await state(c, setup_db) == after
    reverted = await undo(c, result)
    assert reverted.status_code == 200, reverted.text
    peer = await c['client'].put(f"/api/v1/logical-services/{c['rows']['floating']}", headers=c['headers'], json={'purpose': 'After Undo peer edit'})
    assert peer.status_code == 200, peer.text
    after = await state(c, setup_db)
    replay = await undo(c, result)
    assert replay.status_code == 200 and replay.json() == reverted.json(), replay.text
    executed_again = await c['client'].post(PATH, headers=c['headers'], json=request)
    assert executed_again.status_code == 200, executed_again.text
    assert executed_again.json()['status'] == 'already_reverted'
    assert executed_again.json()['changed_ids'] == [] and executed_again.json()['can_revert'] is False
    assert await state(c, setup_db) == after


@pytest.mark.asyncio
async def test_noop_receipt_is_stable_without_audit_or_revision_writes(service_scope, setup_db):
    c = service_scope
    before = await snapshot(c, setup_db)
    request, result = await apply_reviewed(c, [c['rows']['owned']], payload={'status': 'Existing'})
    assert result['status'] == 'no_op' and result['changed_ids'] == [] and result['can_revert'] is False
    assert await snapshot(c, setup_db) == before
    after = await state(c, setup_db)
    replay = await c['client'].post(PATH, headers=c['headers'], json=request)
    assert replay.status_code == 200 and replay.json() == result
    assert await state(c, setup_db) == after


@pytest.mark.asyncio
@pytest.mark.parametrize('peer_write', ['purpose', 'archive', 'os-peer', 'host-projection'])
async def test_undo_rejects_later_selected_or_host_dependency_writes_atomically(service_scope, setup_db, peer_write):
    c = service_scope
    identity = c['rows']['owned']
    _, result = await apply_reviewed(c, [identity], payload={'version': '2'})
    if peer_write == 'purpose':
        response = await c['client'].put(f'/api/v1/logical-services/{identity}', headers=c['headers'], json={'purpose': 'Committed peer'})
        assert response.status_code == 200, response.text
    elif peer_write == 'archive':
        response = await c['client'].delete(f'/api/v1/logical-services/{identity}', headers=c['headers'])
        assert response.status_code == 200, response.text
    elif peer_write == 'os-peer':
        response = await c['client'].post('/api/v1/logical-services', headers=c['headers'], json={
            'name': 'Later OS peer', 'version': '9', 'service_type': 'OS', 'device_id': c['devices']['owned']})
        assert response.status_code == 200, response.text
    else:
        async with _tenant_db(setup_db, c['tenant']) as db:
            (await db.get(models.Device, c['devices']['owned'])).os_version = 'Host peer version'
            await db.commit()
    before = await state(c, setup_db)
    rejected = await undo(c, result)
    assert rejected.status_code == 409, rejected.text
    assert await state(c, setup_db) == before


@pytest.mark.asyncio
async def test_undo_restores_raw_legacy_values_instead_of_input_normalization(service_scope, setup_db):
    c = service_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        row = await db.get(models.LogicalService, c['rows']['floating'])
        row.status, row.environment = 'Active', None
        await db.commit()
    _, result = await apply_reviewed(c, [c['rows']['floating']], payload={'status': 'Retired', 'environment': 'Development'})
    reverted = await undo(c, result)
    assert reverted.status_code == 200, reverted.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        row = await db.get(models.LogicalService, c['rows']['floating'])
        assert row.status == 'Active' and row.environment is None


@pytest.mark.asyncio
@pytest.mark.parametrize('field', ['precondition', 'operation_id'])
@pytest.mark.parametrize('invalid', [None, True, 1, [], {}, '', 'G' * 64, 'a' * 31])
async def test_malformed_explicit_bulk_guards_never_fall_back_to_legacy(service_scope, setup_db, field, invalid):
    c = service_scope
    ids, payload = [c['rows']['floating']], {'environment': 'Development'}
    request = execution(await preview(c, ids, payload=payload), ids, payload=payload)
    request[field] = invalid
    before = await state(c, setup_db)
    response = await c['client'].post(PATH, headers=c['headers'], json=request)
    assert response.status_code == 400, response.text
    assert await state(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('field', ['precondition', 'operation_id'])
async def test_missing_half_of_explicit_guard_is_rejected(service_scope, setup_db, field):
    c = service_scope
    ids, payload = [c['rows']['floating']], {'environment': 'Development'}
    request = execution(await preview(c, ids, payload=payload), ids, payload=payload)
    del request[field]
    before = await state(c, setup_db)
    response = await c['client'].post(PATH, headers=c['headers'], json=request)
    assert response.status_code == 400, response.text
    assert await state(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('tamper', ['selection', 'action', 'payload', 'precondition', 'missing', 'foreign'])
async def test_preview_binding_and_entire_selection_are_enforced(service_scope, setup_db, tamper):
    c = service_scope
    ids, payload = [c['rows']['owned'], c['rows']['floating']], {'environment': 'Development'}
    request = execution(await preview(c, ids, payload=payload), ids, payload=payload)
    if tamper == 'selection':
        request['ids'] = ids[:1]
    elif tamper == 'action':
        request['action'] = 'delete'
    elif tamper == 'payload':
        request['payload'] = {'environment': 'Staging'}
    elif tamper == 'precondition':
        request['precondition'] = '0' * 64
    else:
        request['ids'] = [ids[0], 90000 if tamper == 'missing' else c['rows']['foreign']]
    before = await state(c, setup_db)
    response = await c['client'].post(PATH, headers=c['headers'], json=request)
    assert response.status_code == 409, response.text
    assert await state(c, setup_db) == before


@pytest.mark.asyncio
async def test_operation_identity_cannot_be_rebound_to_new_payload(service_scope, setup_db):
    c = service_scope
    ids = [c['rows']['floating']]
    request, _ = await apply_reviewed(c, ids, payload={'environment': 'Development'})
    other_payload = {'environment': 'Staging'}
    conflicting = execution(await preview(c, ids, payload=other_payload), ids, payload=other_payload, operation_id=request['operation_id'])
    before = await state(c, setup_db)
    response = await c['client'].post(PATH, headers=c['headers'], json=conflicting)
    assert response.status_code == 409, response.text
    assert await state(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('peer_write', ['update', 'delete'])
async def test_inflight_batch_rechecks_after_writer_acquisition(service_scope, setup_db, monkeypatch, peer_write):
    from app.api import service_bulk
    c = service_scope
    ids, payload = [c['rows']['owned'], c['rows']['floating']], {'environment': 'Development'}
    request = execution(await preview(c, ids, payload=payload), ids, payload=payload)
    entered, release = asyncio.Event(), asyncio.Event()
    original = service_bulk._reserve_writer

    async def held_writer(request, db):
        entered.set()
        await asyncio.wait_for(release.wait(), 5)
        await original(request, db)

    monkeypatch.setattr(service_bulk, '_reserve_writer', held_writer)
    pending = asyncio.create_task(c['client'].post(PATH, headers=c['headers'], json=request))
    try:
        await asyncio.wait_for(entered.wait(), 5)
        async with _tenant_db(setup_db, c['tenant']) as db:
            statement = update(models.LogicalService).where(models.LogicalService.id == ids[0]).values(purpose='Inflight peer') if peer_write == 'update' else delete(models.LogicalService).where(models.LogicalService.id == ids[0])
            await db.execute(statement)
            await db.commit()
        before = await state(c, setup_db)
    finally:
        release.set()
    response = await pending
    assert response.status_code == 409, response.text
    assert await state(c, setup_db) == before


@pytest.mark.asyncio
async def test_overlapping_batches_from_one_preview_have_only_one_writer(service_scope, setup_db, monkeypatch):
    from app.api import service_bulk
    c = service_scope
    ids, payload = [c['rows']['floating']], {'environment': 'Development'}
    reviewed = await preview(c, ids, payload=payload)
    ready, release = asyncio.Event(), asyncio.Event()
    original, arrivals = service_bulk._reserve_writer, 0

    async def barrier(request, db):
        nonlocal arrivals
        arrivals += 1
        if arrivals == 2:
            ready.set()
        await asyncio.wait_for(release.wait(), 5)
        await original(request, db)

    monkeypatch.setattr(service_bulk, '_reserve_writer', barrier)
    before = await snapshot(c, setup_db)
    tasks = [asyncio.create_task(c['client'].post(PATH, headers=c['headers'], json=execution(reviewed, ids, payload=payload))) for _ in range(2)]
    try:
        await asyncio.wait_for(ready.wait(), 5)
    finally:
        release.set()
    responses = await asyncio.gather(*tasks)
    assert sorted(response.status_code for response in responses) == [200, 409], [response.text for response in responses]
    assert len(await receipt_rows(c, setup_db)) == 1
    after = await snapshot(c, setup_db)
    assert len(after['audit_logs']) == len(before['audit_logs']) + 1
    assert after['service_secrets'] == before['service_secrets']


@pytest.mark.asyncio
async def test_batch_preview_rejects_deleted_and_recreated_identity(service_scope, setup_db):
    c = service_scope
    created = await c['client'].post('/api/v1/logical-services', headers=c['headers'], json={'name': 'Bulk ABA original', 'service_type': 'Application'})
    assert created.status_code == 200, created.text
    identity = created.json()['id']
    payload = {'environment': 'Development'}
    request = execution(await preview(c, [identity], payload=payload), [identity], payload=payload)
    async with _tenant_db(setup_db, c['tenant']) as db:
        await db.execute(delete(models.LogicalService).where(models.LogicalService.id == identity))
        await db.commit()
    replacement = await c['client'].post('/api/v1/logical-services', headers=c['headers'], json={'name': 'Bulk ABA replacement', 'service_type': 'Application'})
    assert replacement.status_code == 200 and replacement.json()['id'] == identity, replacement.text
    before = await state(c, setup_db)
    response = await c['client'].post(PATH, headers=c['headers'], json=request)
    assert response.status_code == 409, response.text
    assert await state(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('phase', ['execute', 'undo'])
@pytest.mark.parametrize('failure', ['audit', 'host'])
async def test_batch_and_undo_roll_back_domain_projection_and_receipt_together(service_scope, setup_db, monkeypatch, phase, failure):
    c = service_scope
    ids, payload = [c['rows']['owned']], {'version': '2'}
    if phase == 'undo':
        _, result = await apply_reviewed(c, ids, payload=payload)
        request = {'action': 'undo', 'ids': result['changed_ids'], 'receipt_id': result['receipt_id']}
    else:
        request = execution(await preview(c, ids, payload=payload), ids, payload=payload)
    before = await state(c, setup_db)

    def fail_audit(session, *_):
        if any(isinstance(row, models.AuditLog) and row.target_table == 'logical_services' for row in session.new):
            raise RuntimeError('controlled bulk audit failure')

    async def fail_host(device_id, db):
        await original_sync(device_id, db)
        await db.flush()
        raise RuntimeError('controlled bulk host failure')

    original_sync = logical_services.sync_device_os_state
    if failure == 'audit':
        event.listen(Session, 'before_flush', fail_audit)
    else:
        monkeypatch.setattr(logical_services, 'sync_device_os_state', fail_host)
    try:
        with pytest.raises(RuntimeError, match='controlled bulk ' + failure + ' failure'):
            await c['client'].post(PATH, headers=c['headers'], json=request)
    finally:
        if failure == 'audit':
            event.remove(Session, 'before_flush', fail_audit)
    assert await state(c, setup_db) == before


@pytest.mark.asyncio
async def test_authorized_other_actor_cannot_use_preview_receipt_or_replay_identity(service_scope, setup_db):
    from test_chg13_authorization_security import _grant_access, _seed_operator
    c = service_scope
    actor = 'independent-service-editor'
    await _grant_access(setup_db, tenant_id=c['tenant'], user_id=actor, role='EDITOR')
    await _seed_operator(setup_db, c['tenant'], actor, role_permissions={'services': 3})
    other = {**c, 'headers': {**c['headers'], 'X-User-Id': actor}}
    ids, payload = [c['rows']['floating']], {'environment': 'Development'}
    reviewed = await preview(c, ids, payload=payload)
    # Real module authorization succeeds for this distinct principal.
    assert (await preview(other, ids, payload=payload))['matched_count'] == 1
    before = await state(c, setup_db)
    denied = await other['client'].post(PATH, headers=other['headers'], json=execution(reviewed, ids, payload=payload))
    assert denied.status_code == 409, denied.text
    assert await state(c, setup_db) == before
    request, result = await apply_reviewed(c, ids, payload=payload)
    before = await state(c, setup_db)
    denied = await undo(other, result)
    assert denied.status_code == 404, denied.text
    denied = await other['client'].post(PATH, headers=other['headers'], json=request)
    assert denied.status_code == 409, denied.text
    assert await state(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('tamper', ['selection', 'schema', 'before', 'post', 'projection', 'extra-metadata'])
async def test_undo_fails_closed_for_invalid_or_corrupt_receipts(service_scope, setup_db, tamper):
    c = service_scope
    _, result = await apply_reviewed(c, [c['rows']['floating']], payload={'environment': 'Development'})
    overrides = {}
    if tamper == 'selection':
        overrides['ids'] = [c['rows']['owned']]
    elif tamper == 'extra-metadata':
        overrides['precondition'] = '0' * 64
    else:
        async with _tenant_db(setup_db, c['tenant']) as db:
            row = await db.get(models.ServiceBulkReceipt, result['receipt_id'])
            if tamper == 'schema':
                row.schema_version = 999
            elif tamper == 'before':
                row.before_state = {str(c['rows']['floating']): {'name': 'Injected unsupported field'}}
            elif tamper == 'post':
                row.post_state = {}
            else:
                row.projection_state = {'device_ids': [True], 'fingerprint': 'x'}
            await db.commit()
    before = await state(c, setup_db)
    response = await undo(c, result, **overrides)
    assert response.status_code == (400 if tamper == 'extra-metadata' else 409), response.text
    assert await state(c, setup_db) == before


@pytest.mark.asyncio
async def test_host_reassignment_receipt_does_not_advertise_unsupported_compensation(service_scope, setup_db):
    c = service_scope
    _, result = await apply_reviewed(c, [c['rows']['owned']], payload={'device_id': c['devices']['peer']})
    assert result['changed_count'] == 1 and result['can_revert'] is False
    before = await state(c, setup_db)
    response = await undo(c, result)
    assert response.status_code == 409, response.text
    assert await state(c, setup_db) == before


def test_receipt_migration_preserves_business_data_and_refuses_destructive_downgrade(tmp_path):
    import importlib.util
    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from pathlib import Path
    path = Path(__file__).parent / 'alembic/versions/b4a9d8e17c23_add_service_bulk_receipts.py'
    spec = importlib.util.spec_from_file_location('service_receipt_migration_under_test', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert migration.down_revision == 'f6c2a9d4e8b1'
    engine = sa.create_engine('sqlite:///' + str(tmp_path / 'isolated-migration.db'))
    with engine.begin() as connection:
        connection.execute(sa.text('CREATE TABLE retained_business (id INTEGER PRIMARY KEY, value TEXT)'))
        connection.execute(sa.text("INSERT INTO retained_business VALUES (1, 'preserved')"))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            table = sa.Table('service_bulk_receipts', sa.MetaData(), autoload_with=connection)
            connection.execute(table.insert().values(id='a' * 32, tenant_id=1, actor_id='migration-actor', operation_id='b' * 32,
                request_hash='c' * 64, schema_version=1, before_state={}, post_state={}, projection_state={}, result={}))
            with pytest.raises(RuntimeError, match='history exists'):
                migration.downgrade()
            assert connection.scalar(sa.select(sa.func.count()).select_from(table)) == 1
            assert connection.execute(sa.text('SELECT * FROM retained_business')).all() == [(1, 'preserved')]
            connection.execute(table.delete())
            migration.downgrade()
            assert not sa.inspect(connection).has_table('service_bulk_receipts')
            assert connection.execute(sa.text('SELECT * FROM retained_business')).all() == [(1, 'preserved')]
    engine.dispose()
