"""Scalar asset writes reject invalid types before any row or OS sync changes."""
import json

import pytest
import pytest_asyncio
from sqlalchemy import func, select

from app.models import models
from test_chg13_authorization_security import _tenant_db


TEXT_FIELDS = (
    'environment', 'status', 'type', 'manufacturer', 'model', 'serial_number', 'asset_tag', 'part_number',
    'os_name', 'os_version', 'management_ip', 'primary_ip', 'management_url', 'owner', 'business_unit',
    'vendor', 'purchase_order', 'cost_center', 'role', 'depth', 'tool_group', 'fab_area',
)
INTEGER_FIELDS = ('size_u', 'power_supply_count')
POWER_FIELDS = ('power_max_w', 'power_typical_w', 'btu_hr')
BOOLEAN_FIELDS = ('recipe_critical', 'is_reservation')
ORIGINAL = {**{field: 'Preserved text' for field in TEXT_FIELDS}, 'os_name': None, 'os_version': None,
            'size_u': 2, 'power_supply_count': 2, 'power_max_w': 450.5, 'power_typical_w': 300.25,
            'btu_hr': 1200.0, 'recipe_critical': False, 'is_reservation': False}


@pytest_asyncio.fixture
async def scalar_assets(seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant['tenant_id']
    async with _tenant_db(setup_db, tenant_id) as db:
        rows = [models.Device(name=name, system='Scalar proof', tenant_id=tenant_id, **ORIGINAL)
                for name in ('Scalar owner', 'Scalar peer')]
        db.add_all(rows)
        await db.commit()
        return {'client': seeded_admin_tenant['client'], 'tenant_id': tenant_id, 'ids': [row.id for row in rows],
                'headers': {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(tenant_id)}}


async def write_scalars(context, operation, payload):
    if operation == 'create':
        method, path = 'POST', '/api/v1/devices'
        body = {'name': 'New scalar asset', 'system': 'Scalar proof', **payload}
    elif operation == 'update':
        method, path = 'PUT', f"/api/v1/devices/{context['ids'][0]}"
        body = payload
    else:
        method, path = 'POST', '/api/v1/devices/bulk-action'
        body = {'ids': context['ids'], 'action': 'update', 'payload': payload, 'dry_run': operation == 'preview'}
    # Raw JSON also exercises non-finite inputs instead of HTTPX refusing to send them.
    return await context['client'].request(method, path, headers={**context['headers'], 'Content-Type': 'application/json'},
                                            content=json.dumps(body))


async def assert_preserved(context, setup_db):
    async with _tenant_db(setup_db, context['tenant_id']) as db:
        rows = (await db.scalars(select(models.Device).order_by(models.Device.id))).all()
        assert [row.name for row in rows] == ['Scalar owner', 'Scalar peer']
        assert all(getattr(row, field) == value for row in rows for field, value in ORIGINAL.items())
        assert await db.scalar(select(func.count()).select_from(models.LogicalService)) == 0
        assert await db.scalar(select(func.count()).select_from(models.AuditLog)) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update', 'preview', 'execute'])
@pytest.mark.parametrize('kind', ['text', 'integer', 'power', 'boolean'])
async def test_invalid_scalars_never_write_any_selected_asset(scalar_assets, setup_db, operation, kind):
    fields, invalid_values = {
        'text': (TEXT_FIELDS, [True, 123, {'private': 'invalid-private-marker'}, ['invalid-private-marker']]),
        'integer': (INTEGER_FIELDS, [True, '2', 2.5, -1, 2 ** 63, [], {}]),
        'power': (POWER_FIELDS, [True, '450', -0.5, [], {}, float('nan'), float('inf'), -float('inf'), 10 ** 400]),
        'boolean': (BOOLEAN_FIELDS, [0, 1, 'false', [], {}]),
    }[kind]
    for field in fields:
        for value in invalid_values:
            response = await write_scalars(scalar_assets, operation, {'owner': 'Must not persist', 'os_name': 'Must not sync', field: value})
            assert response.status_code == 422, (operation, field, type(value).__name__, response.text)
            assert field in response.json()['detail']
            assert 'invalid-private-marker' not in response.text
            await assert_preserved(scalar_assets, setup_db)


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update', 'preview', 'execute'])
async def test_rack_height_requires_at_least_one_whole_unit(scalar_assets, setup_db, operation):
    response = await write_scalars(scalar_assets, operation, {'size_u': 0, 'owner': 'Must not persist'})
    assert response.status_code == 422, response.text
    await assert_preserved(scalar_assets, setup_db)


@pytest.mark.asyncio
async def test_valid_scalars_share_preview_execute_noop_and_exact_stored_types(scalar_assets, setup_db):
    payload = {**{field: 'Valid text' for field in TEXT_FIELDS}, 'os_name': 'Linux', 'os_version': '9.5',
               'size_u': 1, 'power_supply_count': 0, 'power_max_w': 0, 'power_typical_w': 0.25,
               'btu_hr': 0, 'recipe_critical': True, 'is_reservation': True}
    preview = await write_scalars(scalar_assets, 'preview', payload)
    assert preview.status_code == 200 and preview.json()['changed_count'] == 2, preview.text
    await assert_preserved(scalar_assets, setup_db)
    executed = await write_scalars(scalar_assets, 'execute', payload)
    assert executed.status_code == 200 and executed.json()['changed_count'] == 2, executed.text
    async with _tenant_db(setup_db, scalar_assets['tenant_id']) as db:
        rows = (await db.scalars(select(models.Device))).all()
        assert all(getattr(row, field) == value for row in rows for field, value in payload.items())
        assert all(type(getattr(row, field)) is int for row in rows for field in INTEGER_FIELDS)
        assert all(type(getattr(row, field)) is bool for row in rows for field in BOOLEAN_FIELDS)
        services = (await db.scalars(select(models.LogicalService))).all()
        assert len(services) == 2 and all(row.name == 'Linux' and row.version == '9.5' for row in services)
    repeated = await write_scalars(scalar_assets, 'execute', payload)
    assert repeated.status_code == 200 and repeated.json()['status'] == 'no_op', repeated.text


@pytest.mark.asyncio
async def test_create_update_projection_and_nullable_scalars_remain_compatible(scalar_assets, setup_db):
    payload = {'size_u': 4, 'power_supply_count': 0, 'power_max_w': 325.5, 'power_typical_w': 225.75,
               'btu_hr': 1000, 'recipe_critical': True, 'is_reservation': True, 'metadata_json': {'preserved': True}}
    created = await write_scalars(scalar_assets, 'create', payload)
    assert created.status_code == 200, created.text
    row = created.json()
    assert all(row[field] == value for field, value in payload.items())
    path = f"/api/v1/devices/{row['id']}"
    updated = await scalar_assets['client'].put(path, headers=scalar_assets['headers'], json={**row, 'owner': 'New owner'})
    assert updated.status_code == 200, updated.text
    nulls = {field: None for field in (*TEXT_FIELDS, *INTEGER_FIELDS, *POWER_FIELDS, *BOOLEAN_FIELDS)}
    cleared = await scalar_assets['client'].put(path, headers=scalar_assets['headers'], json=nulls)
    assert cleared.status_code == 200, cleared.text
    async with _tenant_db(setup_db, scalar_assets['tenant_id']) as db:
        stored = await db.get(models.Device, row['id'])
        assert all(getattr(stored, field) is None for field in nulls)
        assert stored.name == 'New scalar asset' and stored.metadata_json == {'preserved': True}
    omitted = await scalar_assets['client'].put(path, headers=scalar_assets['headers'], json={'owner': 'Changed alone'})
    assert omitted.status_code == 200 and omitted.json()['size_u'] is None


@pytest.mark.asyncio
async def test_representable_integer_and_finite_power_limits_remain_supported(scalar_assets, setup_db):
    payload = {'size_u': 2 ** 63 - 1, 'power_supply_count': 2 ** 63 - 1, 'power_max_w': 1.7976931348623157e308}
    updated = await write_scalars(scalar_assets, 'update', payload)
    assert updated.status_code == 200, updated.text
    async with _tenant_db(setup_db, scalar_assets['tenant_id']) as db:
        stored = await db.get(models.Device, scalar_assets['ids'][0])
        assert all(getattr(stored, field) == value for field, value in payload.items())
