"""Direct Network routes authorize every referenced asset and bulk member."""
import pytest
import pytest_asyncio
from sqlalchemy import select

from app.database import get_db
from app.main import app
from app.models import models
from test_chg13_authorization_security import _tenant_db


@pytest_asyncio.fixture
async def network_scope(seeded_admin_tenant, setup_db):
    tenant = seeded_admin_tenant['tenant_id']
    async with _tenant_db(setup_db, tenant) as db:
        devices = {
            'source': models.Device(name='Authorized source', tenant_id=tenant),
            'peer': models.Device(name='Authorized peer', tenant_id=tenant),
            'archived': models.Device(name='Authorized history', tenant_id=tenant, is_deleted=True),
            'foreign': models.Device(name='Confidential foreign asset', tenant_id=tenant + 100),
        }
        db.add_all(devices.values())
        await db.flush()
        rows = {}
        for label, source, target, status in [
            ('owned', 'source', 'peer', 'Active'),
            ('deleted', 'source', 'peer', 'Deleted'),
            ('history', 'source', 'archived', 'Deleted'),
            ('foreign-source', 'foreign', 'peer', 'Active'),
            ('foreign-target', 'source', 'foreign', 'Active'),
            ('foreign-deleted', 'source', 'foreign', 'Deleted'),
            ('custom-source', None, 'peer', 'Active'),
            ('custom-target', 'source', None, 'Active'),
            ('custom-both', None, None, 'Active'),
        ]:
            row = models.PortConnection(
                source_device_id=devices[source].id if source else None,
                target_device_id=devices[target].id if target else None,
                source_port=f'{label}-source', target_port=f'{label}-target',
                source_ip='192.0.2.1', target_ip='198.51.100.2',
                link_type='Data', status=status, unit='Gbps', direction='Bidirectional',
                purpose=label,
            )
            db.add(row)
            await db.flush()
            rows[label] = row.id
        await db.commit()
        context = {'client': seeded_admin_tenant['client'], 'tenant': tenant,
                   'devices': {name: row.id for name, row in devices.items()}, 'rows': rows,
                   'headers': {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(tenant)}}
    # Exercise the production tenant dependency, not the legacy fixture override.
    override = app.dependency_overrides.pop(get_db)
    try:
        yield context
    finally:
        app.dependency_overrides[get_db] = override


async def snapshot(context, setup_db):
    async with _tenant_db(setup_db, context['tenant']) as db:
        rows = (await db.scalars(select(models.PortConnection).order_by(models.PortConnection.id))).all()
        records = [{column.name: getattr(row, column.name) for column in models.PortConnection.__table__.columns} for row in rows]
        audits = (await db.scalars(select(models.AuditLog).order_by(models.AuditLog.id))).all()
        return records, [row.id for row in audits]


@pytest.mark.asyncio
@pytest.mark.parametrize('include_deleted', [False, True])
async def test_list_scopes_both_endpoints_and_preserves_custom_ip_history(network_scope, include_deleted):
    c = network_scope
    response = await c['client'].get('/api/v1/networks/connections', headers=c['headers'],
                                      params={'include_deleted': str(include_deleted).lower()})
    assert response.status_code == 200, response.text
    expected = {'owned', 'custom-source', 'custom-target', 'custom-both'}
    if include_deleted:
        expected |= {'deleted', 'history'}
    assert {row['id'] for row in response.json()} == {c['rows'][key] for key in expected}
    assert 'Confidential' not in response.text and 'foreign-' not in response.text


@pytest.mark.asyncio
@pytest.mark.parametrize('identity', ['foreign', 'missing', 'zero', 'overflow'])
async def test_device_filter_requires_authorized_parent(network_scope, identity):
    c = network_scope
    device_id = {'foreign': c['devices']['foreign'], 'missing': 90000, 'zero': 0, 'overflow': 2 ** 63}[identity]
    response = await c['client'].get('/api/v1/networks/connections', headers=c['headers'], params={'device_id': device_id})
    assert response.status_code == 404, response.text
    assert 'Confidential' not in response.text


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update'])
@pytest.mark.parametrize('side', ['source', 'target'])
@pytest.mark.parametrize('identity', ['foreign', 'missing', 'archived', 'overflow'])
async def test_new_endpoints_require_active_owned_assets(network_scope, setup_db, operation, side, identity):
    c = network_scope
    device_id = {'foreign': c['devices']['foreign'], 'missing': 90000,
                 'archived': c['devices']['archived'], 'overflow': 2 ** 63}[identity]
    payload = {'source_device_id': c['devices']['source'], 'target_device_id': c['devices']['peer'],
               'source_port': 'new-source', 'target_port': 'new-target', 'link_type': 'Data'}
    payload[f'{side}_device_id'] = device_id
    before = await snapshot(c, setup_db)
    url = '/api/v1/networks/connections'
    if operation == 'update':
        response = await c['client'].put(f"{url}/{c['rows']['owned']}", headers=c['headers'], json=payload)
    else:
        response = await c['client'].post(url, headers=c['headers'], json=payload)
    assert response.status_code == 404, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['update', 'delete', 'restore', 'purge'])
@pytest.mark.parametrize('identity', ['foreign-source', 'foreign-target', 'missing', 'overflow'])
async def test_single_mutations_cannot_touch_unowned_connections(network_scope, setup_db, operation, identity):
    c = network_scope
    conn_id = c['rows'].get(identity, {'missing': 90000, 'overflow': 2 ** 63}.get(identity))
    before = await snapshot(c, setup_db)
    url = f'/api/v1/networks/connections/{conn_id}'
    if operation == 'update':
        response = await c['client'].put(url, headers=c['headers'], json={'purpose': 'Unauthorized change'})
    elif operation == 'delete':
        response = await c['client'].delete(url, headers=c['headers'])
    else:
        response = await c['client'].post(f'{url}/{operation}', headers=c['headers'])
    assert response.status_code == 404, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['status', 'delete', 'restore', 'purge'])
@pytest.mark.parametrize('identity', ['foreign', 'missing', 'overflow'])
async def test_mixed_bulk_requests_fail_before_any_write(network_scope, setup_db, operation, identity):
    c = network_scope
    deleted = operation in {'restore', 'purge'}
    owned_id = c['rows']['deleted' if deleted else 'owned']
    hidden_id = {'foreign': c['rows']['foreign-deleted' if deleted else 'foreign-target'],
                 'missing': 90000, 'overflow': 2 ** 63}[identity]
    payload = {'ids': [owned_id, hidden_id]}
    if operation == 'status':
        payload['status'] = 'Maintenance'
    before = await snapshot(c, setup_db)
    response = await c['client'].post(f'/api/v1/networks/connections/bulk-{operation}', headers=c['headers'], json=payload)
    assert response.status_code == 404, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_owned_history_and_custom_ip_links_remain_operable(network_scope):
    c = network_scope
    for label in ['history', 'custom-source', 'custom-target']:
        response = await c['client'].put(f"/api/v1/networks/connections/{c['rows'][label]}",
            headers=c['headers'], json={'purpose': 'Retained authorized history'})
        assert response.status_code == 200, response.text
        assert response.json()['purpose'] == 'Retained authorized history'
    response = await c['client'].delete(f"/api/v1/networks/connections/{c['rows']['custom-both']}", headers=c['headers'])
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['status', 'delete', 'restore', 'purge'])
async def test_owned_bulk_members_are_counted_once_and_leave_hidden_rows_unchanged(network_scope, setup_db, operation):
    c = network_scope
    label = 'deleted' if operation in {'restore', 'purge'} else 'owned'
    conn_id = c['rows'][label]
    before, audits_before = await snapshot(c, setup_db)
    payload = {'ids': [conn_id, conn_id]}
    if operation == 'status':
        payload['status'] = 'Maintenance'
    response = await c['client'].post(f'/api/v1/networks/connections/bulk-{operation}', headers=c['headers'], json=payload)
    assert response.status_code == 200, response.text
    assert response.json()['count'] == response.json()['changed'] == 1
    after, audits_after = await snapshot(c, setup_db)
    assert [row for row in after if row['id'] != conn_id] == [row for row in before if row['id'] != conn_id]
    assert len(audits_after) == len(audits_before) + 1
    if operation == 'purge':
        assert all(row['id'] != conn_id for row in after)
    else:
        expected = {'status': 'Maintenance', 'delete': 'Deleted', 'restore': 'Active'}[operation]
        assert next(row for row in after if row['id'] == conn_id)['status'] == expected
