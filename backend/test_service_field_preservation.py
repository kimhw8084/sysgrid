"""Partial service edits preserve omitted structured data and OS synchronization."""
import copy

import pytest
import pytest_asyncio

from app.database import get_db
from app.main import app
from app.models import models
from test_chg13_authorization_security import _tenant_db


STRUCTURED = {
    'config_json': {'port': 443, 'nested': {'enabled': True}},
    'custom_attributes': {'owner': 'Original owner', 'labels': ['first', 'second']},
    'logic_json': [{'step': 'check', 'enabled': False}],
}


@pytest_asyncio.fixture
async def service_record(seeded_admin_tenant, setup_db):
    tenant = seeded_admin_tenant['tenant_id']
    async with _tenant_db(setup_db, tenant) as db:
        device = models.Device(name='Service host', tenant_id=tenant, os_name='Original OS', os_version='1')
        db.add(device)
        await db.flush()
        service = models.LogicalService(name='Original OS', service_type='OS', version='1',
            status='Existing', device_id=device.id, created_by_user_id='admin_root', **copy.deepcopy(STRUCTURED))
        db.add(service)
        await db.commit()
        context = {'client': seeded_admin_tenant['client'], 'tenant': tenant, 'id': service.id, 'device_id': device.id,
                   'headers': {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(tenant)}}
    override = app.dependency_overrides.pop(get_db)
    try:
        yield context
    finally:
        app.dependency_overrides[get_db] = override


async def edit_and_read(c, setup_db, payload):
    response = await c['client'].put(f"/api/v1/logical-services/{c['id']}", headers=c['headers'], json=payload)
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        service = await db.get(models.LogicalService, c['id'])
        device = await db.get(models.Device, c['device_id'])
        stored = {key: getattr(service, key) for key in STRUCTURED}
        assert {key: response.json()[key] for key in STRUCTURED} == stored
        assert service.created_by_user_id == 'admin_root' and service.device_id == c['device_id']
        assert (device.os_name, device.os_version) == (service.name, service.version)
        return stored


@pytest.mark.asyncio
@pytest.mark.parametrize('payload', [
    {}, {'name': 'Renamed OS', 'version': '2'}, {'created_by_user_id': 'forged', 'created_at': '2001-01-01'},
])
async def test_omitted_structured_fields_survive_partial_edits(service_record, setup_db, payload):
    assert await edit_and_read(service_record, setup_db, payload) == STRUCTURED


@pytest.mark.asyncio
@pytest.mark.parametrize('field', list(STRUCTURED))
async def test_replacing_one_structured_field_preserves_the_others(service_record, setup_db, field):
    replacement = [{'step': 'replacement'}] if field == 'logic_json' else {'replacement': {'value': 0}}
    expected = {**STRUCTURED, field: replacement}
    assert await edit_and_read(service_record, setup_db, {field: replacement}) == expected


@pytest.mark.asyncio
@pytest.mark.parametrize('field', list(STRUCTURED))
@pytest.mark.parametrize('representation', ['null', 'empty', 'encoded'])
async def test_explicit_clear_and_legacy_non_container_values_keep_their_contract(service_record, setup_db, field, representation):
    is_list = field == 'logic_json'
    empty = [] if is_list else {}
    supplied = {'null': None, 'empty': empty, 'encoded': '[{"step":"encoded"}]' if is_list else '{"encoded":false}'}[representation]
    # Existing readers/writers normalize non-container values to an empty
    # container; decoding JSON strings is not this API's established contract.
    expected = {**STRUCTURED, field: empty}
    assert await edit_and_read(service_record, setup_db, {field: supplied}) == expected


@pytest.mark.asyncio
async def test_create_without_structured_fields_retains_empty_defaults(service_record):
    c = service_record
    created = await c['client'].post('/api/v1/logical-services', headers=c['headers'],
        json={'name': 'Floating application', 'service_type': 'Application'})
    assert created.status_code == 200, created.text
    response = await c['client'].get('/api/v1/logical-services', headers=c['headers'])
    assert response.status_code == 200, response.text
    row = next(row for row in response.json() if row['id'] == created.json()['id'])
    assert {key: row[key] for key in STRUCTURED} == {'config_json': {}, 'custom_attributes': {}, 'logic_json': []}
