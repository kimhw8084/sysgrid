"""Hardware writes keep their owning asset and validated inventory quantities."""
import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.models import models
from test_chg13_authorization_security import _tenant_db


@pytest_asyncio.fixture
async def hardware_context(seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant['tenant_id']
    async with _tenant_db(setup_db, tenant_id) as db:
        owner = models.Device(name='Hardware owner', system='Test', tenant_id=tenant_id)
        peer = models.Device(name='Different owner', system='Test', tenant_id=tenant_id)
        foreign = models.Device(name='Wrong tenant', system='Test', tenant_id=tenant_id + 100)
        db.add_all([owner, peer, foreign])
        await db.flush()
        component = models.HardwareComponent(device_id=owner.id, category='CPU', name='Retained CPU', count=2,
                                             created_by_user_id='original-author')
        foreign_component = models.HardwareComponent(device_id=foreign.id, category='CPU', name='Foreign CPU', count=1)
        db.add_all([component, foreign_component])
        await db.commit()
        return {
            'client': seeded_admin_tenant['client'], 'tenant_id': tenant_id,
            'headers': {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(tenant_id)},
            'owner': owner.id, 'peer': peer.id, 'foreign': foreign.id,
            'component': component.id, 'foreign_component': foreign_component.id,
        }


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update'])
@pytest.mark.parametrize('count', [None, True, 1.5, -1, 2 ** 63])
async def test_bad_quantities_are_rejected_without_partial_writes(hardware_context, setup_db, operation, count):
    c = hardware_context
    path = f"/api/v1/devices/{c['owner']}/hardware" if operation == 'create' else f"/api/v1/devices/hardware/{c['component']}"
    response = await c['client'].request('POST' if operation == 'create' else 'PUT', path, headers=c['headers'],
                                         json={'name': 'Must not persist', 'count': count})
    assert response.status_code == 422, response.text
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        assert len((await db.scalars(select(models.HardwareComponent))).all()) == 2
        original = await db.get(models.HardwareComponent, c['component'])
        assert original.name == 'Retained CPU' and original.count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update'])
async def test_parent_and_audit_identity_come_from_the_server(hardware_context, setup_db, operation):
    c = hardware_context
    path = f"/api/v1/devices/{c['owner']}/hardware" if operation == 'create' else f"/api/v1/devices/hardware/{c['component']}"
    response = await c['client'].request('POST' if operation == 'create' else 'PUT', path, headers=c['headers'], json={
        'id': 9000, 'device_id': c['peer'], 'created_by_user_id': 'forged-author', 'created_at': '2000-01-01T00:00:00',
        'updated_at': '2000-01-01T00:00:00', 'name': 'Allowed hardware edit', 'count': 0,
    })
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        stored = await db.get(models.HardwareComponent, response.json()['id'])
        assert stored.id != 9000 and stored.device_id == c['owner'] and stored.count == 0
        assert stored.created_by_user_id == ('admin_root' if operation == 'create' else 'original-author')
        assert stored.created_at.year != 2000 and stored.updated_at.year != 2000


@pytest.mark.asyncio
@pytest.mark.parametrize('parent', ['foreign', 'missing'])
async def test_hardware_read_and_create_require_an_authorized_parent(hardware_context, parent):
    c = hardware_context
    device_id = c.get(parent, 9000)
    path = f'/api/v1/devices/{device_id}/hardware'
    response = await c['client'].get(path, headers=c['headers'])
    assert response.status_code == 404, response.text
    response = await c['client'].post(path, headers=c['headers'], json={'name': 'Denied component'})
    assert response.status_code == 404, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize('method', ['PUT', 'DELETE'])
@pytest.mark.parametrize('component', ['foreign_component', 'missing'])
async def test_generic_resource_routes_respect_the_owning_tenant(hardware_context, method, component):
    c = hardware_context
    response = await c['client'].request(method, f"/api/v1/devices/hardware/{c.get(component, 9000)}",
                                         headers=c['headers'], json={'name': 'Denied'})
    assert response.status_code == 404, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update', 'delete'])
async def test_hardware_audit_failure_preserves_inventory(hardware_context, setup_db, operation):
    c = hardware_context

    def fail_audit(session, *_):
        if any(isinstance(row, models.AuditLog) and row.target_table == 'hardware_components' for row in session.new):
            raise RuntimeError('controlled hardware audit failure')

    event.listen(Session, 'before_flush', fail_audit)
    try:
        with pytest.raises(RuntimeError, match='controlled hardware audit failure'):
            if operation == 'create':
                await c['client'].post(f"/api/v1/devices/{c['owner']}/hardware", headers=c['headers'], json={'name': 'Not committed'})
            elif operation == 'update':
                await c['client'].put(f"/api/v1/devices/hardware/{c['component']}", headers=c['headers'], json={'count': 8})
            else:
                await c['client'].delete(f"/api/v1/devices/hardware/{c['component']}", headers=c['headers'])
    finally:
        event.remove(Session, 'before_flush', fail_audit)
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        original = await db.get(models.HardwareComponent, c['component'])
        assert original is not None and original.count == 2
        assert len((await db.scalars(select(models.HardwareComponent))).all()) == 2


@pytest.mark.asyncio
async def test_legacy_unknown_quantities_remain_visible_without_breaking_inventory(hardware_context, setup_db):
    c = hardware_context
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        original = await db.get(models.HardwareComponent, c['component'])
        original.count = None
        await db.commit()
    response = await c['client'].get('/api/v1/devices', headers=c['headers'])
    assert response.status_code == 200, response.text
    owner = next(row for row in response.json() if row['id'] == c['owner'])
    assert owner['hardware_summary_complete'] is False
    assert 'Quantity unavailable' in owner['hardware_summary']
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        assert (await db.get(models.HardwareComponent, c['component'])).count is None


@pytest.mark.asyncio
async def test_allowed_hardware_crud_records_actor_and_preserves_fields(hardware_context, setup_db):
    c = hardware_context
    response = await c['client'].post(f"/api/v1/devices/{c['owner']}/hardware", headers=c['headers'], json={
        'category': 'Memory', 'name': 'DIMM', 'manufacturer': 'Synthetic', 'specs': '64 GB', 'serial_number': 'SERIAL',
    })
    assert response.status_code == 200, response.text
    row = response.json()
    assert row['count'] == 1
    path = f"/api/v1/devices/hardware/{row['id']}"
    response = await c['client'].put(path, headers=c['headers'], json={**row, 'count': 4})
    assert response.status_code == 200, response.text
    assert response.json()['serial_number'] == 'SERIAL' and response.json()['count'] == 4
    response = await c['client'].delete(path, headers=c['headers'])
    assert response.status_code == 200
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        audit = (await db.scalars(select(models.AuditLog).where(models.AuditLog.target_table == 'hardware_components',
                                 models.AuditLog.target_id == str(row['id'])).order_by(models.AuditLog.id))).all()
        assert [entry.action for entry in audit] == ['CREATE', 'UPDATE', 'DELETE']
        assert all(entry.user_id == 'admin_root' for entry in audit)
        assert audit[1].changes['count'] == {'before': 1, 'after': 4}
