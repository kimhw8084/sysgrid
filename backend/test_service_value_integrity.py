"""Service scalar validation rejects malformed values before record, host or audit writes."""
import json

import pytest
from sqlalchemy import select

from app.models import models
from test_chg13_authorization_security import _tenant_db
from test_service_relationship_authority import service_scope, snapshot


@pytest.mark.asyncio
async def test_service_import_schema_explains_name_and_cost_constraints(service_scope):
    c = service_scope
    response = await c['client'].get('/api/v1/import/schema/logical_services', headers=c['headers'])
    assert response.status_code == 200, response.text
    fields = {field['name']: field for field in response.json()['fields']}
    assert fields['name']['required'] is True
    assert any('non-empty' in rule for rule in fields['name']['validation_rules'])
    assert any('finite' in rule and 'zero or greater' in rule for rule in fields['cost']['validation_rules'])


async def write(c, operation, fields):
    url = '/api/v1/logical-services'
    method = c['client'].post
    payload = {'name': 'Scalar service', 'service_type': 'Application', **fields}
    if operation == 'update':
        url += f"/{c['rows']['owned']}"
        method, payload = c['client'].put, fields
    elif operation.startswith('bulk'):
        url += '/bulk-action'
        payload = {'ids': [c['rows']['owned'], c['rows']['floating']], 'action': 'update',
                   'payload': fields, 'dry_run': operation == 'bulk-preview'}
    elif operation in {'preview-rows', 'execute'}:
        url = f'/api/v1/import/{operation}?table_name=logical_services'
        payload = {'rows': [{'name': 'Valid preceding row', 'service_type': 'Application'}, payload]}
    return await method(url, headers={**c['headers'], 'Content-Type': 'application/json'}, content=json.dumps(payload))


async def assert_rejected(c, setup_db, operation, field, value):
    before = await snapshot(c, setup_db)
    response = await write(c, operation, {field: value})
    if operation in {'preview-rows', 'execute'}:
        assert response.status_code == 200, response.text
        body = response.json()
        if operation == 'preview-rows':
            assert body['valid_rows'] == body['invalid_rows'] == 1, response.text
            assert body['results'][1]['normalized'] == {}
            assert field in ' '.join(body['results'][1]['errors'])
        else:
            assert body['status'] == 'failed' and body['count'] == 0, response.text
            assert field in ' '.join(body['errors'])
    else:
        assert response.status_code == 422, response.text
        assert field in response.json()['detail']['field_errors']
        assert 'private-bad-value' not in response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update', 'bulk-preview', 'bulk-execute', 'preview-rows', 'execute'])
@pytest.mark.parametrize('field,value', [('status', True), ('service_type', {}), ('environment', []), ('version', 17)])
async def test_service_text_types_reject_consistently(service_scope, setup_db, operation, field, value):
    await assert_rejected(service_scope, setup_db, operation, field, value)


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update', 'preview-rows', 'execute'])
@pytest.mark.parametrize('field', ['name', 'purpose', 'documentation_link', 'purchase_type', 'license_key', 'currency', 'manufacturer', 'supplier'])
async def test_other_service_text_fields_cannot_persist_objects(service_scope, setup_db, operation, field):
    await assert_rejected(service_scope, setup_db, operation, field, {'private-bad-value': 1})


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update', 'preview-rows', 'execute'])
async def test_whitespace_service_name_is_rejected(service_scope, setup_db, operation):
    await assert_rejected(service_scope, setup_db, operation, 'name', '   ')


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update', 'preview-rows', 'execute'])
@pytest.mark.parametrize('value', [True, -1, 'Infinity', 'NaN', 10 ** 400, {'private-bad-value': 1}])
async def test_service_cost_is_finite_nonnegative_and_not_boolean(service_scope, setup_db, operation, value):
    await assert_rejected(service_scope, setup_db, operation, 'cost', value)


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update'])
@pytest.mark.parametrize('field,value', [
    ('cost', float('nan')), ('cost', float('inf')),
    ('config_json', {'private-bad-value': float('nan')}),
    ('custom_attributes', {'nested': [float('inf')]}),
    ('logic_json', [{'weight': float('-inf')}]),
])
async def test_nonfinite_service_values_are_controlled_field_errors(service_scope, setup_db, operation, field, value):
    await assert_rejected(service_scope, setup_db, operation, field, value)


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update', 'preview-rows', 'execute'])
@pytest.mark.parametrize('cost', [0, 12.5, '0012.50', None])
async def test_valid_service_values_and_legacy_numeric_text_roundtrip(service_scope, setup_db, operation, cost):
    c = service_scope
    fields = {'name': 'Scalar service', 'service_type': 'Custom Type', 'status': 'Active', 'version': '000007',
              'environment': 'Custom Environment', 'cost': cost, 'license_key': '0000123',
              'purpose': None, 'config_json': {'values': [True, 0, 1.5]}, 'custom_attributes': {'code': '0001'},
              'logic_json': [{'step': 1}]}
    response = await write(c, operation, fields)
    assert response.status_code == 200, response.text
    if operation == 'preview-rows':
        assert response.json()['valid_rows'] == 2, response.text
        normalized = response.json()['results'][1]['normalized']
        assert normalized['status'] == 'Existing' and normalized['version'] == '000007'
        response = await c['client'].post('/api/v1/import/execute?table_name=logical_services', headers=c['headers'],
            json={'rows': [normalized]})
        assert response.status_code == 200 and response.json()['count'] == 1, response.text
    elif operation == 'execute':
        assert response.json() == {'status': 'success', 'count': 2}, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        row = await db.scalar(select(models.LogicalService).where(models.LogicalService.name == 'Scalar service'))
        assert row is not None
        assert row.status == 'Existing' and row.service_type == 'Custom Type' and row.environment == 'Custom Environment'
        assert row.version == '000007' and row.license_key == '0000123' and row.purpose is None
        assert row.config_json == fields['config_json'] and row.custom_attributes == fields['custom_attributes']
        assert row.logic_json == fields['logic_json']
        # SQLAlchemy retains the existing create-default behavior for explicit None.
        assert row.cost == (None if cost is None and operation == 'update' else float(cost or 0))
