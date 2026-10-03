"""Raw Network interface endpoints preserve ownership, typed values and atomic history."""
import json

import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import models
from test_chg13_authorization_security import _tenant_db
from test_network_endpoint_authorization import network_scope


@pytest_asyncio.fixture
async def interfaces(network_scope, setup_db):
    c = network_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        rows = {}
        for index, owner in enumerate(['source', 'peer', 'archived', 'foreign', None]):
            row = models.NetworkInterface(device_id=c['devices'][owner] if owner else None,
                name=f'{owner}-interface', mac_address=f'02:00:00:00:00:{index:02x}',
                ip_address='192.0.2.1', vlan_id=100, link_speed_gbps=25,
                created_by_user_id='original-actor')
            db.add(row)
            await db.flush()
            rows[owner or 'orphan'] = row.id
        await db.commit()
    return {**c, 'interfaces': rows}


async def snapshot(c, setup_db):
    async with _tenant_db(setup_db, c['tenant']) as db:
        rows = (await db.scalars(select(models.NetworkInterface).order_by(models.NetworkInterface.id))).all()
        values = [{col.name: getattr(row, col.name) for col in models.NetworkInterface.__table__.columns} for row in rows]
        audits = (await db.scalars(select(models.AuditLog).order_by(models.AuditLog.id))).all()
        return values, [row.id for row in audits]


async def write(c, operation, data):
    url = '/api/v1/networks/interfaces'
    if operation == 'create':
        return await c['client'].post(url, headers=c['headers'], json=data)
    return await c['client'].put(f"{url}/{c['interfaces']['source']}", headers=c['headers'], json=data)


@pytest.mark.asyncio
async def test_list_hides_foreign_and_orphan_interfaces_but_retains_owned_history(interfaces):
    c = interfaces
    response = await c['client'].get('/api/v1/networks/interfaces', headers=c['headers'])
    assert response.status_code == 200, response.text
    assert {row['id'] for row in response.json()} == {c['interfaces'][key] for key in ['source', 'peer', 'archived']}
    assert all(set(row) == {'id', 'name', 'mac_address', 'ip_address', 'link_speed_gbps'} for row in response.json())
    assert 'foreign-interface' not in response.text and 'None-interface' not in response.text


@pytest.mark.asyncio
@pytest.mark.parametrize('identity', ['foreign', 'orphan', 'missing', 'zero', 'overflow'])
async def test_update_requires_owned_interface(interfaces, setup_db, identity):
    c = interfaces
    row_id = c['interfaces'].get(identity, {'missing': 90000, 'zero': 0, 'overflow': 2 ** 63}.get(identity))
    before = await snapshot(c, setup_db)
    response = await c['client'].put(f'/api/v1/networks/interfaces/{row_id}', headers=c['headers'], json={'name': 'Forbidden'})
    assert response.status_code == 404, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update'])
@pytest.mark.parametrize('identity', ['foreign', 'missing', 'archived'])
async def test_assignment_requires_active_owned_parent(interfaces, setup_db, operation, identity):
    c = interfaces
    parent = c['devices'].get(identity, 90000)
    before = await snapshot(c, setup_db)
    response = await write(c, operation, {'device_id': parent, 'name': 'New interface'})
    assert response.status_code == 404, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update'])
@pytest.mark.parametrize('field,value', [
    ('device_id', None), ('device_id', True), ('device_id', 1.5), ('device_id', 0), ('device_id', 2 ** 63),
    ('name', False), ('mac_address', {}), ('ip_address', []),
    ('vlan_id', True), ('vlan_id', 1.5), ('vlan_id', 4095), ('vlan_id', -1),
    ('link_speed_gbps', True), ('link_speed_gbps', -1), ('link_speed_gbps', 1.5), ('link_speed_gbps', 2 ** 63),
])
async def test_invalid_scalars_fail_before_mutation(interfaces, setup_db, operation, field, value):
    c = interfaces
    before = await snapshot(c, setup_db)
    payload = {'device_id': c['devices']['source'], 'name': 'New interface', field: value}
    response = await write(c, operation, payload)
    assert response.status_code == 422, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_create_requires_parent(interfaces, setup_db):
    before = await snapshot(interfaces, setup_db)
    response = await write(interfaces, 'create', {'name': 'Detached interface'})
    assert response.status_code == 422, response.text
    assert await snapshot(interfaces, setup_db) == before


@pytest.mark.asyncio
async def test_zero_vlan_remains_supported(interfaces, setup_db):
    c = interfaces
    response = await write(c, 'create', {'device_id': c['devices']['source'], 'name': 'Priority-tagged', 'vlan_id': 0})
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        assert (await db.get(models.NetworkInterface, response.json()['id'])).vlan_id == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update'])
async def test_trusted_metadata_and_target_audit_with_field_names_only(interfaces, setup_db, operation):
    c = interfaces
    before, _ = await snapshot(c, setup_db)
    payload = {'device_id': str(c['devices']['peer']), 'name': 'private-interface-name',
               'mac_address': '02:00:00:00:00:99', 'ip_address': None, 'vlan_id': None, 'link_speed_gbps': 0,
               'id': 50000, 'created_by_user_id': 'forged-actor', 'created_at': '2001-01-01', 'updated_at': '2001-01-01'}
    response = await write(c, operation, payload)
    assert response.status_code == 200, response.text
    row_id = response.json()['id']
    assert row_id != 50000
    async with _tenant_db(setup_db, c['tenant']) as db:
        row = await db.get(models.NetworkInterface, row_id)
        assert row.device_id == c['devices']['peer'] and row.ip_address is None and row.vlan_id is None
        assert row.link_speed_gbps == 0 and row.created_at.year != 2001 and row.updated_at.year != 2001
        assert row.created_by_user_id == ('admin_root' if operation == 'create' else 'original-actor')
        if operation == 'update':
            assert row_id == c['interfaces']['source'] and row.created_at == before[0]['created_at']
        entry = (await db.scalars(select(models.AuditLog))).one()
        assert (entry.user_id, entry.action, entry.target_table, entry.target_id) == ('admin_root', operation.upper(), 'network_interfaces', str(row_id))
        assert entry.changes == {'changed_fields': sorted(['device_id', 'name', 'mac_address', 'ip_address', 'vlan_id', 'link_speed_gbps'])}
        assert 'private-interface' not in json.dumps(entry.changes) + entry.description
    history = await c['client'].get('/api/v1/audit', headers=c['headers'], params={'target_table': 'network_interfaces', 'target_id': str(row_id)})
    assert history.status_code == 200 and len(history.json()) == 1


@pytest.mark.asyncio
async def test_owned_archived_history_can_be_edited_and_noop_keeps_audit_unchanged(interfaces, setup_db):
    c = interfaces
    row_id = c['interfaces']['archived']
    payload = {'name': 'Retained history', 'device_id': str(c['devices']['archived'])}
    response = await c['client'].put(f'/api/v1/networks/interfaces/{row_id}', headers=c['headers'], json=payload)
    assert response.status_code == 200, response.text
    before = await snapshot(c, setup_db)
    response = await c['client'].put(f'/api/v1/networks/interfaces/{row_id}', headers=c['headers'], json={**payload, 'created_by_user_id': 'forged'})
    assert response.status_code == 200, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update'])
@pytest.mark.parametrize('failure', ['audit', 'integrity', 'duplicate_mac'])
async def test_failure_rolls_back_interface_and_audit(interfaces, setup_db, operation, failure):
    c = interfaces
    before = await snapshot(c, setup_db)
    payload = {'device_id': c['devices']['source'], 'name': 'Changed interface', 'mac_address': '02:00:00:00:00:01' if failure == 'duplicate_mac' else '02:00:00:00:00:99'}

    def fail_audit(session, *_):
        if any(isinstance(row, models.AuditLog) and row.target_table == 'network_interfaces' for row in session.new):
            if failure == 'integrity':
                raise IntegrityError('private SQL', {}, ValueError('private conflict'))
            if failure == 'audit':
                raise RuntimeError('controlled interface audit failure')

    event.listen(Session, 'before_flush', fail_audit)
    try:
        if failure == 'audit':
            with pytest.raises(RuntimeError, match='controlled interface audit failure'):
                await write(c, operation, payload)
        else:
            response = await write(c, operation, payload)
            assert response.status_code == 409, response.text
            assert 'private' not in response.text and '02:00' not in response.text and 'UNIQUE' not in response.text
    finally:
        event.remove(Session, 'before_flush', fail_audit)
    assert await snapshot(c, setup_db) == before
