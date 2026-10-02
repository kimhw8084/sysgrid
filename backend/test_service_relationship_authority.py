"""Service projections and mutations authorize the mounted asset relationship."""
import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.main import app
from app.models import models
from test_chg13_authorization_security import _tenant_db


@pytest_asyncio.fixture
async def service_scope(seeded_admin_tenant, setup_db):
    tenant = seeded_admin_tenant['tenant_id']
    async with _tenant_db(setup_db, tenant) as db:
        devices = {
            'owned': models.Device(name='Authorized service host', tenant_id=tenant, os_name='Original OS', os_version='1'),
            'peer': models.Device(name='Authorized new host', tenant_id=tenant),
            'archived': models.Device(name='Authorized archived host', tenant_id=tenant, is_deleted=True),
            'foreign': models.Device(name='Confidential foreign host', tenant_id=tenant + 100, os_name='Foreign OS', os_version='9'),
        }
        db.add_all(devices.values())
        await db.flush()
        rows, secrets = {}, {}
        for label, device, deleted in [('owned', 'owned', False), ('floating', None, False),
                ('deleted', 'owned', True), ('history', 'archived', True),
                ('foreign', 'foreign', False), ('foreign-deleted', 'foreign', True)]:
            row = models.LogicalService(name=f'{label} service', service_type='OS' if device else 'Application',
                device_id=devices[device].id if device else None, is_deleted=deleted, status='Existing',
                version='1', config_json={'retained': label}, created_by_user_id='admin_root')
            db.add(row)
            await db.flush()
            secret = models.ServiceSecret(service_id=row.id, username=f'{label} account', note=f'{label} note')
            db.add(secret)
            await db.flush()
            rows[label], secrets[label] = row.id, secret.id
        await db.commit()
        c = {'tenant': tenant, 'client': seeded_admin_tenant['client'], 'rows': rows, 'secrets': secrets,
             'devices': {key: row.id for key, row in devices.items()},
             'headers': {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(tenant)}}
    override = app.dependency_overrides.pop(get_db)
    try:
        yield c
    finally:
        app.dependency_overrides[get_db] = override


async def snapshot(c, setup_db):
    async with _tenant_db(setup_db, c['tenant']) as db:
        result = {}
        for model in [models.LogicalService, models.Device, models.ServiceSecret, models.AuditLog]:
            rows = (await db.scalars(select(model).order_by(model.id))).all()
            result[model.__tablename__] = [{col.name: getattr(row, col.name) for col in model.__table__.columns} for row in rows]
        return result


@pytest.mark.asyncio
@pytest.mark.parametrize('projection', ['', '?projection=summary', '/summary'])
@pytest.mark.parametrize('include_deleted', [False, True])
async def test_service_reads_hide_unowned_mounts_and_retain_floating_history(service_scope, projection, include_deleted):
    c = service_scope
    separator = '&' if '?' in projection else '?'
    response = await c['client'].get('/api/v1/logical-services' + projection + separator + f'include_deleted={str(include_deleted).lower()}', headers=c['headers'])
    assert response.status_code == 200, response.text
    expected = {'owned', 'floating'} | ({'deleted', 'history'} if include_deleted else set())
    assert {row['id'] for row in response.json()} == {c['rows'][label] for label in expected}
    assert 'foreign' not in response.text and 'Confidential' not in response.text


@pytest.mark.asyncio
@pytest.mark.parametrize('projection', ['', '?projection=summary', '/summary'])
@pytest.mark.parametrize('identity', ['foreign', 'missing', 'zero', 'overflow'])
async def test_service_device_filter_requires_owned_parent(service_scope, projection, identity):
    c = service_scope
    device_id = {'foreign': c['devices']['foreign'], 'missing': 90000, 'zero': 0, 'overflow': 2 ** 63}[identity]
    separator = '&' if '?' in projection else '?'
    response = await c['client'].get('/api/v1/logical-services' + projection + separator + f'device_id={device_id}', headers=c['headers'])
    assert response.status_code == 404, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['update', 'delete', 'mount', 'add-secret', 'delete-secret'])
@pytest.mark.parametrize('identity', ['foreign', 'foreign-deleted', 'missing', 'overflow'])
async def test_hidden_service_mutations_leave_all_records_unchanged(service_scope, setup_db, operation, identity):
    c = service_scope
    row_id = c['rows'].get(identity, {'missing': 90000, 'overflow': 2 ** 63}.get(identity))
    before = await snapshot(c, setup_db)
    url = f'/api/v1/logical-services/{row_id}'
    if operation == 'update':
        response = await c['client'].put(url, headers=c['headers'], json={'version': '2'})
    elif operation == 'delete':
        response = await c['client'].delete(url, headers=c['headers'])
    elif operation == 'mount':
        response = await c['client'].post(f"{url}/mount/{c['devices']['peer']}", headers=c['headers'])
    elif operation == 'add-secret':
        response = await c['client'].post(url + '/secrets', headers=c['headers'], json={'username': 'new account'})
    else:
        secret_id = c['secrets'].get(identity, c['secrets']['foreign'])
        response = await c['client'].delete(f'{url}/secrets/{secret_id}', headers=c['headers'])
    assert response.status_code == 404, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update', 'bulk', 'mount'])
@pytest.mark.parametrize('identity', ['foreign', 'missing', 'archived', 'overflow'])
async def test_new_service_assignments_require_active_owned_devices(service_scope, setup_db, operation, identity):
    c = service_scope
    device_id = {'foreign': c['devices']['foreign'], 'missing': 90000,
                 'archived': c['devices']['archived'], 'overflow': 2 ** 63}[identity]
    before = await snapshot(c, setup_db)
    if operation == 'create':
        response = await c['client'].post('/api/v1/logical-services', headers=c['headers'],
            json={'name': 'New OS', 'service_type': 'OS', 'device_id': device_id})
    elif operation == 'update':
        response = await c['client'].put(f"/api/v1/logical-services/{c['rows']['owned']}", headers=c['headers'], json={'device_id': device_id})
    elif operation == 'bulk':
        response = await c['client'].post('/api/v1/logical-services/bulk-action', headers=c['headers'],
            json={'ids': [c['rows']['owned'], c['rows']['floating']], 'action': 'update', 'payload': {'device_id': device_id}})
    else:
        response = await c['client'].post(f"/api/v1/logical-services/{c['rows']['owned']}/mount/{device_id}", headers=c['headers'])
    assert response.status_code == 404, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('action', ['delete', 'restore', 'update'])
@pytest.mark.parametrize('dry_run', [False, True])
@pytest.mark.parametrize('identity', ['foreign', 'missing'])
async def test_bulk_preview_and_execution_treat_hidden_members_as_missing(service_scope, setup_db, action, dry_run, identity):
    c = service_scope
    owned = c['rows']['deleted' if action == 'restore' else 'owned']
    hidden = 90000 if identity == 'missing' else c['rows']['foreign-deleted' if action == 'restore' else 'foreign']
    before = await snapshot(c, setup_db)
    response = await c['client'].post('/api/v1/logical-services/bulk-action', headers=c['headers'],
        json={'ids': [owned, hidden], 'action': action, 'payload': {'version': '2'}, 'dry_run': dry_run})
    assert response.status_code == (200 if dry_run else 409), response.text
    preview = response.json() if dry_run else response.json()['detail']['preview']
    assert preview['missing_ids'] == [hidden] and preview['matched_count'] == 1
    assert preview['changed_ids'] == [owned] and preview['can_execute'] is False
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_owned_history_floating_and_native_string_assignments_remain_usable(service_scope, setup_db):
    c = service_scope
    for label in ['owned', 'floating', 'history']:
        response = await c['client'].put(f"/api/v1/logical-services/{c['rows'][label]}", headers=c['headers'], json={'purpose': 'Retained history'})
        assert response.status_code == 200 and response.json()['purpose'] == 'Retained history', response.text
    mounted = await c['client'].put(f"/api/v1/logical-services/{c['rows']['floating']}", headers=c['headers'], json={'device_id': str(c['devices']['peer'])})
    assert mounted.status_code == 200 and mounted.json()['device_id'] == c['devices']['peer'], mounted.text
    detached = await c['client'].put(f"/api/v1/logical-services/{c['rows']['floating']}", headers=c['headers'], json={'device_id': None})
    assert detached.status_code == 200 and detached.json()['device_id'] is None, detached.text
    created = await c['client'].post('/api/v1/logical-services', headers=c['headers'], json={'name': 'Floating authorized application', 'service_type': 'Application'})
    assert created.status_code == 200 and created.json()['device_id'] is None, created.text


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update', 'bulk'])
@pytest.mark.parametrize('value', [True, False, 1.5, '', {}, []])
async def test_device_identity_rejects_malformed_scalars_before_writes(service_scope, setup_db, operation, value):
    c = service_scope
    before = await snapshot(c, setup_db)
    if operation == 'create':
        response = await c['client'].post('/api/v1/logical-services', headers=c['headers'],
            json={'name': 'Invalid host assignment', 'service_type': 'OS', 'device_id': value})
    elif operation == 'update':
        response = await c['client'].put(f"/api/v1/logical-services/{c['rows']['owned']}", headers=c['headers'], json={'device_id': value})
    else:
        response = await c['client'].post('/api/v1/logical-services/bulk-action', headers=c['headers'],
            json={'ids': [c['rows']['owned']], 'action': 'update', 'payload': {'device_id': value}})
    assert response.status_code == 400, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_owned_secret_metadata_routes_remain_available(service_scope):
    c = service_scope
    url = f"/api/v1/logical-services/{c['rows']['owned']}/secrets"
    created = await c['client'].post(url, headers=c['headers'], json={'username': 'Authorized account', 'note': 'Metadata only'})
    assert created.status_code == 200 and created.json()['password'] is None, created.text
    deleted = await c['client'].delete(f"{url}/{created.json()['id']}", headers=c['headers'])
    assert deleted.status_code == 200, deleted.text


@pytest.mark.asyncio
async def test_oversized_secret_identity_is_a_controlled_not_found(service_scope, setup_db):
    c = service_scope
    before = await snapshot(c, setup_db)
    response = await c['client'].delete(f"/api/v1/logical-services/{c['rows']['owned']}/secrets/{2 ** 63}", headers=c['headers'])
    assert response.status_code == 404, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_active_owned_mount_and_bulk_detach_synchronize_os_state(service_scope, setup_db):
    c = service_scope
    created = await c['client'].post('/api/v1/logical-services', headers=c['headers'],
        json={'name': 'New authorized OS', 'version': '3', 'service_type': 'OS', 'device_id': str(c['devices']['peer'])})
    assert created.status_code == 200 and created.json()['device_id'] == c['devices']['peer'], created.text
    row_id = created.json()['id']
    mounted = await c['client'].post(f"/api/v1/logical-services/{row_id}/mount/{c['devices']['owned']}", headers=c['headers'])
    assert mounted.status_code == 200, mounted.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        peer = await db.get(models.Device, c['devices']['peer'])
        owned = await db.get(models.Device, c['devices']['owned'])
        assert peer.os_name is None and peer.os_version is None
        assert owned.os_name == 'New authorized OS' and owned.os_version == '3'
    detached = await c['client'].post('/api/v1/logical-services/bulk-action', headers=c['headers'],
        json={'ids': [row_id], 'action': 'update', 'payload': {'device_id': None}})
    assert detached.status_code == 200 and detached.json()['changed_count'] == 1, detached.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        owned = await db.get(models.Device, c['devices']['owned'])
        assert owned.os_name == 'owned service' and owned.os_version == '1'


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['update', 'mount'])
async def test_flushed_service_assignment_and_os_sync_roll_back_with_audit(service_scope, setup_db, operation):
    c = service_scope
    before = await snapshot(c, setup_db)

    def fail(session, *_):
        if any(isinstance(row, models.AuditLog) and row.target_table == 'logical_services' for row in session.new):
            raise RuntimeError('controlled service assignment audit failure')

    event.listen(Session, 'before_flush', fail)
    try:
        with pytest.raises(RuntimeError, match='controlled service assignment audit failure'):
            url = f"/api/v1/logical-services/{c['rows']['owned']}"
            if operation == 'update':
                await c['client'].put(url, headers=c['headers'], json={'device_id': c['devices']['peer']})
            else:
                await c['client'].post(f"{url}/mount/{c['devices']['peer']}", headers=c['headers'])
    finally:
        event.remove(Session, 'before_flush', fail)
    assert await snapshot(c, setup_db) == before
