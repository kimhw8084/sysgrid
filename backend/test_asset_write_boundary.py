"""Ordinary asset edits preserve tenant identity and audited lifecycle authority."""
import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models import models
from test_chg13_authorization_security import _tenant_db


@pytest_asyncio.fixture
async def asset_context(seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant['tenant_id']
    async with _tenant_db(setup_db, tenant_id) as db:
        device = models.Device(name='Retained host', system='Retained system', tenant_id=tenant_id,
                               created_by_user_id='original-author', metadata_json={'retained': True})
        db.add(device)
        await db.commit()
        return seeded_admin_tenant['client'], tenant_id, device.id, {
            'X-User-Id': 'admin_root', 'X-Tenant-Id': str(tenant_id),
        }


@pytest.mark.asyncio
@pytest.mark.parametrize('field,value', [
    ('id', 9000), ('tenant_id', 9000), ('is_deleted', True),
    ('created_by_user_id', 'forged-author'), ('created_at', '2000-01-01T00:00:00'),
    ('updated_at', '2000-01-01T00:00:00'),
])
async def test_create_assigns_server_identity_and_active_lifecycle(asset_context, setup_db, field, value):
    client, tenant_id, original_id, headers = asset_context
    response = await client.post('/api/v1/devices', headers=headers, json={
        'name': 'New host', 'system': 'New system', 'metadata_json': {'retained': True}, field: value,
    })
    assert response.status_code == 200, response.text
    row = response.json()
    assert row['id'] not in (original_id, 9000)
    async with _tenant_db(setup_db, tenant_id) as db:
        stored = await db.get(models.Device, row['id'])
        assert stored.tenant_id == tenant_id and stored.is_deleted is False
        assert stored.created_by_user_id == 'admin_root'
        assert stored.created_at.year != 2000 and stored.updated_at.year != 2000
        assert stored.metadata_json == {'retained': True}


@pytest.mark.asyncio
@pytest.mark.parametrize('field,value', [
    ('id', 9000), ('tenant_id', 9000), ('is_deleted', True),
    ('created_by_user_id', 'forged-author'), ('created_at', '2000-01-01T00:00:00'),
    ('updated_at', '2000-01-01T00:00:00'),
])
async def test_update_cannot_move_hide_or_reauthor_an_asset(asset_context, setup_db, field, value):
    client, tenant_id, device_id, headers = asset_context
    response = await client.put(f'/api/v1/devices/{device_id}', headers=headers,
                                json={'owner': 'Allowed owner edit', field: value})
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, tenant_id) as db:
        stored = await db.get(models.Device, device_id)
        assert stored is not None
        assert stored.tenant_id == tenant_id and stored.is_deleted is False
        assert stored.created_by_user_id == 'original-author'
        assert stored.created_at.year != 2000 and stored.updated_at.year != 2000
        assert stored.owner == 'Allowed owner edit' and stored.metadata_json == {'retained': True}
    listed = await client.get('/api/v1/devices', headers=headers)
    assert device_id in [row['id'] for row in listed.json()]


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update', 'bulk'])
@pytest.mark.parametrize('value', [None, True, 12, {'name': 'object'}, ['list'], '   '])
async def test_invalid_hostname_is_a_client_error_before_writes(asset_context, setup_db, operation, value):
    client, tenant_id, device_id, headers = asset_context
    payload = {'name': value, 'owner': 'Must not persist', 'system': 'Valid system'}
    if operation == 'create':
        response = await client.post('/api/v1/devices', headers=headers, json=payload)
    elif operation == 'update':
        response = await client.put(f'/api/v1/devices/{device_id}', headers=headers, json=payload)
    else:
        response = await client.post('/api/v1/devices/bulk-action', headers=headers,
                                     json={'ids': [device_id], 'action': 'update', 'payload': payload})
    assert response.status_code == 400, response.text
    async with _tenant_db(setup_db, tenant_id) as db:
        rows = (await db.scalars(select(models.Device))).all()
        assert len(rows) == 1 and rows[0].name == 'Retained host' and rows[0].owner is None


@pytest.mark.asyncio
async def test_definition_edit_cannot_bypass_archive_restore_checks(asset_context, setup_db):
    client, tenant_id, device_id, headers = asset_context
    archived = await client.delete(f'/api/v1/devices/{device_id}', headers=headers)
    assert archived.status_code == 200
    replacement = await client.post('/api/v1/devices', headers=headers, json={'name': 'Retained host', 'system': 'Replacement'})
    assert replacement.status_code == 200
    edited = await client.put(f'/api/v1/devices/{device_id}', headers=headers,
                              json={'is_deleted': False, 'owner': 'Historical owner'})
    assert edited.status_code == 200
    async with _tenant_db(setup_db, tenant_id) as db:
        stored = await db.get(models.Device, device_id)
        assert stored.is_deleted is True and stored.owner == 'Historical owner'
    restore = await client.post('/api/v1/devices/bulk-action', headers=headers,
                                 json={'ids': [device_id], 'action': 'restore'})
    assert restore.status_code == 409


@pytest.mark.asyncio
async def test_read_projection_roundtrip_preserves_os_sync_and_optional_fields(asset_context, setup_db):
    client, tenant_id, device_id, headers = asset_context
    rows = await client.get('/api/v1/devices', headers=headers)
    row = next(item for item in rows.json() if item['id'] == device_id)
    payload = {**row, 'name': 'Valid renamed host', 'os_name': 'Linux', 'os_version': '1.2',
               'part_number': 'PART-1', 'vendor': 'Retained vendor', 'is_reservation': True,
               'reservation_info': {'requester': 'Synthetic operator'}, 'logic_json': [{'name': 'Retained logic'}]}
    response = await client.put(f'/api/v1/devices/{device_id}', headers=headers, json=payload)
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, tenant_id) as db:
        stored = await db.get(models.Device, device_id)
        assert stored.name == 'Valid renamed host' and stored.vendor == 'Retained vendor'
        assert stored.part_number == 'PART-1' and stored.is_reservation is True
        assert stored.reservation_info == {'requester': 'Synthetic operator'}
        assert stored.logic_json == [{'name': 'Retained logic'}]
        services = (await db.scalars(select(models.LogicalService).where(models.LogicalService.device_id == device_id))).all()
        assert len(services) == 1 and services[0].name == 'Linux' and services[0].version == '1.2'


@pytest.mark.asyncio
async def test_bulk_edits_share_the_server_field_boundary(asset_context, setup_db):
    client, tenant_id, device_id, headers = asset_context
    response = await client.post('/api/v1/devices/bulk-action', headers=headers, json={
        'ids': [device_id], 'action': 'update',
        'payload': {'owner': 'Bulk owner', 'tenant_id': 9000, 'is_deleted': True, 'created_by_user_id': 'forged-author'},
    })
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, tenant_id) as db:
        stored = await db.get(models.Device, device_id)
        assert stored.tenant_id == tenant_id and stored.is_deleted is False
        assert stored.created_by_user_id == 'original-author' and stored.owner == 'Bulk owner'
