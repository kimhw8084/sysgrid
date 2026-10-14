"""Ordinary asset writes and OS synchronization have atomic, bounded audit evidence."""
import json
from datetime import datetime

import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api import devices
from app.models import models
from test_chg13_authorization_security import _tenant_db


@pytest_asyncio.fixture
async def context(seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant['tenant_id']
    async with _tenant_db(setup_db, tenant_id) as db:
        device = models.Device(name='Retained host', system='Audit proof', tenant_id=tenant_id,
                               os_name='Linux', os_version='1', purchase_date=datetime(2024, 2, 29),
                               metadata_json={'retained': True})
        db.add(device)
        await db.flush()
        db.add(models.LogicalService(device_id=device.id, name='Linux', version='1',
                                     service_type='OS', status='Active', environment='Production'))
        foreign = models.Device(name='Foreign host', system='Private system', tenant_id=tenant_id + 100)
        db.add(foreign)
        await db.commit()
        return {'client': seeded_admin_tenant['client'], 'tenant_id': tenant_id, 'id': device.id,
                'foreign_id': foreign.id,
                'headers': {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(tenant_id)}}


async def write(c, operation, payload=None):
    payload = payload or {'name': 'Changed host', 'system': 'Audit proof', 'os_name': 'Linux', 'os_version': '2'}
    if operation == 'create':
        return await c['client'].post('/api/v1/devices', headers=c['headers'], json=payload)
    return await c['client'].put(f"/api/v1/devices/{c['id']}", headers=c['headers'], json=payload)


async def assert_unchanged(c, setup_db):
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        rows = (await db.scalars(select(models.Device).where(models.Device.tenant_id == c['tenant_id']))).all()
        assert len(rows) == 1 and rows[0].name == 'Retained host' and rows[0].os_version == '1'
        services = (await db.scalars(select(models.LogicalService))).all()
        assert len(services) == 1 and services[0].name == 'Linux' and services[0].version == '1'
        assert (await db.scalars(select(models.AuditLog))).all() == []


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update'])
async def test_write_records_actor_target_and_bounded_field_names(context, setup_db, operation):
    c = context
    payload = {'name': 'Changed host', 'system': 'Audit proof', 'os_name': 'Linux', 'os_version': '2',
               'owner': 'private-owner-value', 'metadata_json': {'secret': 'private-metadata-value'},
               'management_url': 'https://example.invalid/?token=private-url-value',
               'purchase_date': '2024-02-29', 'tenant_id': c['tenant_id'] + 100,
               'created_by_user_id': 'forged-actor', 'is_deleted': True}
    response = await write(c, operation, payload)
    assert response.status_code == 200, response.text
    device_id = response.json()['id']
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        audit = (await db.scalars(select(models.AuditLog))).all()
        assert len(audit) == 1
        entry = audit[0]
        assert (entry.user_id, entry.action, entry.target_table, entry.target_id) == (
            'admin_root', operation.upper(), 'devices', str(device_id))
        expected = {'name', 'system', 'os_name', 'os_version', 'owner', 'metadata_json', 'management_url', 'purchase_date'}
        if operation == 'update': expected -= {'system', 'os_name', 'purchase_date'}
        assert entry.changes == {'changed_fields': sorted(expected), 'os_service_changed': True}
        serialized = json.dumps({'description': entry.description, 'changes': entry.changes})
        assert all(value not in serialized for value in ['Changed host', 'private-', 'forged-actor'])
        assert len(serialized) < 600
        device = await db.get(models.Device, device_id)
        assert device.tenant_id == c['tenant_id'] and device.is_deleted is False
        service = await db.scalar(select(models.LogicalService).where(models.LogicalService.device_id == device_id))
        assert service.name == 'Linux' and service.version == '2'
    visible = await c['client'].get('/api/v1/audit', headers=c['headers'],
                                    params={'target_table': 'devices', 'target_id': str(device_id)})
    assert visible.status_code == 200 and len(visible.json()) == 1
    assert visible.json()[0]['action'] == operation.upper()


@pytest.mark.asyncio
async def test_normalized_noop_does_not_add_a_mutation_audit(context, setup_db):
    response = await write(context, 'update', {'name': 'Retained host', 'os_version': '1',
        'purchase_date': '2024-02-29T00:00:00+05:00', 'metadata_json': '{"retained": true}',
        'created_by_user_id': 'forged-actor'})
    assert response.status_code == 200, response.text
    await assert_unchanged(context, setup_db)


@pytest.mark.asyncio
async def test_noop_asset_edit_still_audits_an_actual_os_service_repair(context, setup_db):
    c = context
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        service = await db.scalar(select(models.LogicalService))
        service.version = 'out-of-sync'
        await db.commit()
    response = await write(c, 'update', {'name': 'Retained host'})
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        entry = (await db.scalars(select(models.AuditLog))).one()
        assert entry.changes == {'changed_fields': [], 'os_service_changed': True}
        assert (await db.scalar(select(models.LogicalService))).version == '1'


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update'])
@pytest.mark.parametrize('failure', ['audit', 'integrity', 'os_sync'])
async def test_failures_leave_no_asset_service_or_audit_partial_commit(context, setup_db, monkeypatch, operation, failure):
    if failure == 'os_sync':
        original = devices.sync_device_to_os

        async def fail_sync(device, db):
            await original(device, db)
            raise RuntimeError('controlled OS sync failure')

        monkeypatch.setattr(devices, 'sync_device_to_os', fail_sync)

    def fail_audit(session, *_):
        if any(isinstance(row, models.AuditLog) and row.target_table == 'devices' for row in session.new):
            if failure == 'integrity':
                raise IntegrityError('controlled SQL', {}, ValueError('controlled conflict'))
            if failure == 'audit':
                raise RuntimeError('controlled asset audit failure')

    event.listen(Session, 'before_flush', fail_audit)
    try:
        if failure == 'integrity':
            response = await write(context, operation)
            assert response.status_code == 409, response.text
            assert 'controlled SQL' not in response.text
        else:
            with pytest.raises(RuntimeError, match='controlled'):
                await write(context, operation)
    finally:
        event.remove(Session, 'before_flush', fail_audit)
    await assert_unchanged(context, setup_db)


@pytest.mark.asyncio
async def test_rejected_and_foreign_writes_leave_no_false_audit(context, setup_db):
    c = context
    invalid = await write(c, 'update', {'size_u': 0})
    assert invalid.status_code == 422
    duplicate = await write(c, 'create', {'name': 'RETAINED HOST', 'system': 'Audit proof'})
    assert duplicate.status_code == 409
    foreign = await c['client'].put(f"/api/v1/devices/{c['foreign_id']}", headers=c['headers'], json={'owner': 'Must not write'})
    assert foreign.status_code == 404
    await assert_unchanged(c, setup_db)
