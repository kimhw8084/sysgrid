"""Connection creation has trusted record ownership and atomic target history."""
import json

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import models
from test_chg13_authorization_security import _tenant_db
from test_network_endpoint_authorization import network_scope, snapshot
from test_network_import_authorization import valid_row


async def create(c):
    return await c['client'].post('/api/v1/networks/connections', headers=c['headers'], json={
        **valid_row(c), 'purpose': 'private-purpose', 'created_by_user_id': 'forged-actor',
        'id': 50000, 'created_at': '2001-01-01', 'updated_at': '2001-01-01',
    })


@pytest.mark.asyncio
@pytest.mark.parametrize('check', ['actor', 'history'])
async def test_create_assigns_trusted_actor_and_audit_target(network_scope, setup_db, check):
    c = network_scope
    response = await create(c)
    assert response.status_code == 200, response.text
    row_id = response.json()['id']
    assert row_id != 50000 and not response.json()['created_at'].startswith('2001')
    async with _tenant_db(setup_db, c['tenant']) as db:
        row = await db.get(models.PortConnection, row_id)
        entry = (await db.scalars(select(models.AuditLog))).one()
        if check == 'actor':
            assert row.created_by_user_id == response.json()['created_by_user_id'] == 'admin_root'
        else:
            assert (entry.user_id, entry.action, entry.target_table, entry.target_id) == (
                'admin_root', 'CREATE', 'port_connections', str(row_id))
            assert entry.changes == {'changed_fields': sorted([
                'source_device_id', 'target_device_id', 'source_port', 'target_port', 'link_type',
                'purpose', 'unit', 'direction', 'status',
            ])}
            assert 'private-purpose' not in json.dumps(entry.changes) + entry.description
            assert 'forged-actor' not in json.dumps(entry.changes) + entry.description
    if check == 'history':
        history = await c['client'].get('/api/v1/audit', headers=c['headers'],
            params={'target_table': 'port_connections', 'target_id': str(row_id)})
        assert history.status_code == 200 and len(history.json()) == 1
        assert history.json()[0]['action'] == 'CREATE'


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', ['audit', 'integrity'])
async def test_create_failure_leaves_no_connection_or_audit(network_scope, setup_db, failure):
    c = network_scope
    before = await snapshot(c, setup_db)

    def fail(session, *_):
        if any(isinstance(row, models.AuditLog) and row.target_table == 'port_connections' for row in session.new):
            if failure == 'integrity':
                raise IntegrityError('private SQL', {}, ValueError('private conflict'))
            raise RuntimeError('controlled connection audit failure')

    event.listen(Session, 'before_flush', fail)
    try:
        if failure == 'integrity':
            response = await create(c)
            assert response.status_code == 409 and 'private' not in response.text, response.text
        else:
            with pytest.raises(RuntimeError, match='controlled connection audit failure'):
                await create(c)
    finally:
        event.remove(Session, 'before_flush', fail)
    assert await snapshot(c, setup_db) == before
