"""Network batch writes retain discoverable, atomic history for each record."""
import json

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import models
from test_chg13_authorization_security import _tenant_db
from test_network_endpoint_authorization import network_scope, snapshot
from test_network_import_authorization import send_rows, valid_row


def bulk_request(c, operation):
    labels = ['deleted', 'history'] if operation in {'restore', 'purge'} else ['owned', 'custom-target']
    ids = [c['rows'][label] for label in labels]
    payload = {'ids': [*ids, ids[0]]}
    if operation == 'status':
        payload['status'] = 'Maintenance'
    return ids, payload


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['status', 'delete', 'restore', 'purge'])
async def test_bulk_records_exact_per_connection_history(network_scope, setup_db, operation):
    c = network_scope
    ids, payload = bulk_request(c, operation)
    before, _ = await snapshot(c, setup_db)
    response = await c['client'].post(f'/api/v1/networks/connections/bulk-{operation}', headers=c['headers'], json=payload)
    assert response.status_code == 200 and response.json()['count'] == response.json()['changed'] == 2, response.text
    after, audit_ids = await snapshot(c, setup_db)
    assert [r for r in before if r['id'] not in ids] == [r for r in after if r['id'] not in ids]
    assert len(audit_ids) == 2
    action = {'status': 'BULK_UPDATE', 'delete': 'BULK_DELETE', 'restore': 'BULK_RESTORE', 'purge': 'BULK_PURGE'}[operation]
    for row_id in ids:
        history = await c['client'].get('/api/v1/audit', headers=c['headers'],
            params={'target_table': 'port_connections', 'target_id': str(row_id)})
        assert history.status_code == 200 and len(history.json()) == 1, history.text
        entry = history.json()[0]
        assert (entry['user_id'], entry['action'], entry['target_id']) == ('admin_root', action, str(row_id))
        expected = {'batch_count': 2}
        if operation != 'purge':
            expected['changed_fields'] = ['status']
        assert entry['changes'] == expected
    untouched = await c['client'].get('/api/v1/audit', headers=c['headers'],
        params={'target_table': 'port_connections', 'target_id': str(c['rows']['foreign-target'])})
    assert untouched.status_code == 200 and untouched.json() == []


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['status', 'delete', 'restore', 'purge'])
@pytest.mark.parametrize('failure', ['audit', 'integrity'])
async def test_bulk_target_audit_failure_rolls_back_all_members(network_scope, setup_db, operation, failure):
    c = network_scope
    ids, payload = bulk_request(c, operation)
    before = await snapshot(c, setup_db)

    def fail(session, *_):
        if any(isinstance(row, models.AuditLog) and row.target_table == 'port_connections'
               and row.target_id == str(ids[1]) for row in session.new):
            if failure == 'integrity':
                raise IntegrityError('private SQL', {}, ValueError('private conflict'))
            raise RuntimeError('controlled network target audit failure')

    event.listen(Session, 'before_flush', fail)
    try:
        if failure == 'integrity':
            response = await c['client'].post(f'/api/v1/networks/connections/bulk-{operation}', headers=c['headers'], json=payload)
            assert response.status_code == 409 and 'private' not in response.text, response.text
        else:
            with pytest.raises(RuntimeError, match='controlled network target audit failure'):
                await c['client'].post(f'/api/v1/networks/connections/bulk-{operation}', headers=c['headers'], json=payload)
    finally:
        event.remove(Session, 'before_flush', fail)
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['status', 'delete'])
async def test_bulk_target_history_excludes_unchanged_members(network_scope, setup_db, operation):
    c = network_scope
    changed_id = c['rows']['owned']
    unchanged_id = c['rows']['deleted']
    payload = {'ids': [changed_id, unchanged_id, changed_id]}
    if operation == 'status':
        payload['status'] = 'Deleted'
    response = await c['client'].post(f'/api/v1/networks/connections/bulk-{operation}', headers=c['headers'], json=payload)
    assert response.status_code == 200 and response.json()['changed'] == 1, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        entry = (await db.scalars(select(models.AuditLog))).one()
        assert entry.target_id == str(changed_id) and entry.changes == {'batch_count': 1, 'changed_fields': ['status']}
    before = await snapshot(c, setup_db)
    retry = await c['client'].post(f'/api/v1/networks/connections/bulk-{operation}', headers=c['headers'], json=payload)
    assert retry.status_code == 200 and retry.json()['changed'] == 0
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_import_retains_batch_receipt_and_scoped_creation_history(network_scope, setup_db):
    c = network_scope
    rows = [{**valid_row(c, name), 'purpose': 'private imported text', 'created_by_user_id': 'forged'} for name in ['first', 'second']]
    response = await send_rows(c, 'execute', rows)
    assert response.status_code == 200 and response.json()['count'] == 2, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        imported = (await db.scalars(select(models.PortConnection).where(models.PortConnection.source_port.in_(['first-source', 'second-source'])))).all()
        entries = (await db.scalars(select(models.AuditLog))).all()
        assert len(imported) == 2 and len(entries) == 3
        batch = [row for row in entries if row.action == 'BULK_IMPORT']
        assert len(batch) == 1 and batch[0].target_table == 'PORT_CONNECTIONS' and batch[0].changes == {'count': 2}
        assert batch[0].target_id == 'MULTIPLE' and batch[0].user_id == 'admin_root'
        ids = [row.id for row in imported]
    for row_id in ids:
        history = await c['client'].get('/api/v1/audit', headers=c['headers'],
            params={'target_table': 'port_connections', 'target_id': str(row_id)})
        assert history.status_code == 200 and len(history.json()) == 1, history.text
        entry = history.json()[0]
        assert entry['user_id'] == 'admin_root' and entry['action'] == 'CREATE'
        assert entry['changes']['batch_count'] == 2
        assert {'source_device_id', 'target_device_id', 'source_port', 'target_port', 'purpose'} <= set(entry['changes']['changed_fields'])
        assert 'private imported text' not in json.dumps(entry) and 'forged' not in json.dumps(entry)


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', ['audit', 'integrity'])
async def test_import_target_audit_failure_rolls_back_all_records(network_scope, setup_db, failure):
    c = network_scope
    before = await snapshot(c, setup_db)

    def fail(session, *_):
        if any(isinstance(row, models.AuditLog) and row.action == 'CREATE'
               and row.target_table == 'port_connections' and row.target_id is not None for row in session.new):
            if failure == 'integrity':
                raise IntegrityError('private SQL', {}, ValueError('private conflict'))
            raise RuntimeError('controlled import target audit failure')

    event.listen(Session, 'before_flush', fail)
    try:
        if failure == 'integrity':
            response = await send_rows(c, 'execute', [valid_row(c, 'first'), valid_row(c, 'second')])
            assert response.status_code == 409 and 'private' not in response.text, response.text
        else:
            with pytest.raises(RuntimeError, match='controlled import target audit failure'):
                await send_rows(c, 'execute', [valid_row(c, 'first'), valid_row(c, 'second')])
    finally:
        event.remove(Session, 'before_flush', fail)
    assert await snapshot(c, setup_db) == before
