"""Network definitions reject coercion and malformed batches before mutation."""
import json

import pytest

from test_network_endpoint_authorization import network_scope, snapshot
from test_network_import_authorization import send_rows, valid_row


INVALID_FIELDS = [
    ('source_device_id', True), ('target_device_id', False),
    ('source_port', True), ('target_port', 12), ('purpose', {'private': 'value'}),
    ('source_mac', ['private-value']), ('target_mac', False),
    ('source_vlan', True), ('target_vlan', False),
    ('speed_gbps', True), ('speed_gbps', 'inf'), ('speed_gbps', 'nan'), ('speed_gbps', '1e400'),
]


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update'])
@pytest.mark.parametrize('field,value', INVALID_FIELDS)
async def test_direct_writes_reject_invalid_scalars_without_partial_write(network_scope, setup_db, operation, field, value):
    c = network_scope
    before = await snapshot(c, setup_db)
    payload = {**valid_row(c), field: value}
    if operation == 'create':
        response = await c['client'].post('/api/v1/networks/connections', headers=c['headers'], json=payload)
    else:
        response = await c['client'].put(f"/api/v1/networks/connections/{c['rows']['owned']}", headers=c['headers'], json=payload)
    assert response.status_code == 422, response.text
    assert 'private' not in response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['preview-rows', 'execute'])
@pytest.mark.parametrize('field,value', INVALID_FIELDS)
async def test_import_scalars_mark_one_row_invalid_and_never_partially_commit(network_scope, setup_db, operation, field, value):
    c = network_scope
    before = await snapshot(c, setup_db)
    response = await send_rows(c, operation, [valid_row(c, 'good'), {**valid_row(c, 'bad'), field: value}])
    assert response.status_code == 200, response.text
    result = response.json()
    if operation == 'preview-rows':
        assert result['valid_rows'] == result['invalid_rows'] == 1, result
        row = result['results'][1]
        assert row['normalized'] == {} and row['errors'], row
        assert 'private' not in json.dumps(row['errors']) and 'input_value' not in json.dumps(row['errors'])
    else:
        assert result['status'] == 'failed' and result['count'] == 0, result
        assert 'private' not in json.dumps(result['errors']) and 'input_value' not in json.dumps(result['errors'])
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['preview-rows', 'execute'])
@pytest.mark.parametrize('row', [None, ['not-an-object'], 'private-row', True])
async def test_import_row_shape_is_diagnosed_without_server_error(network_scope, setup_db, operation, row):
    c = network_scope
    before = await snapshot(c, setup_db)
    response = await send_rows(c, operation, [valid_row(c), row])
    assert response.status_code == 200, response.text
    result = response.json()
    if operation == 'preview-rows':
        assert result['valid_rows'] == result['invalid_rows'] == 1
        assert result['results'][1]['errors'] == ['Each Network row must be an object']
    else:
        assert result['status'] == 'failed' and result['count'] == 0
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['preview-rows', 'execute'])
@pytest.mark.parametrize('value', [float('nan'), float('inf'), -float('inf')])
async def test_nonfinite_json_is_rejected_before_preview_or_mutation(network_scope, setup_db, operation, value):
    c = network_scope
    before = await snapshot(c, setup_db)
    response = await c['client'].post(f'/api/v1/import/{operation}?table_name=port_connections',
        headers={**c['headers'], 'Content-Type': 'application/json'},
        content=json.dumps({'rows': [{**valid_row(c), 'speed_gbps': value}]}))
    assert response.status_code == 422, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['preview-rows', 'execute'])
@pytest.mark.parametrize('field,alias,replacement', [
    ('source_device_id', 'src_node', 'Authorized source'),
    ('source_port', 'src_port', 'fallback-port'),
    ('source_ip', 'src_ip', '192.0.2.7'),
    ('target_ip', 'peer_ip', '198.51.100.7'),
    ('link_type', 'type', 'Data'),
])
async def test_populated_alias_cannot_mask_invalid_canonical_value(network_scope, setup_db, operation, field, alias, replacement):
    c = network_scope
    before = await snapshot(c, setup_db)
    response = await send_rows(c, operation, [{**valid_row(c), field: False, alias: replacement}])
    assert response.status_code == 200, response.text
    result = response.json()
    if operation == 'preview-rows':
        assert result['valid_rows'] == 0 and result['invalid_rows'] == 1
    else:
        assert result['status'] == 'failed' and result['count'] == 0
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['status', 'delete', 'restore', 'purge'])
async def test_bulk_ids_never_coerce_boolean_to_record_identity(network_scope, setup_db, operation):
    c = network_scope
    before = await snapshot(c, setup_db)
    payload = {'ids': [True]}
    if operation == 'status':
        payload['status'] = 'Maintenance'
    response = await c['client'].post(f'/api/v1/networks/connections/bulk-{operation}', headers=c['headers'], json=payload)
    assert response.status_code == 422, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update', 'execute'])
async def test_numeric_strings_aliases_optional_nulls_and_trimmed_text_remain_supported(network_scope, operation):
    c = network_scope
    payload = {**valid_row(c), 'source_device_id': str(c['devices']['source']), 'target_device_id': str(c['devices']['peer']),
               'source_vlan': '0', 'target_vlan': '4094', 'speed_gbps': '2.5', 'purpose': '  retained text  ', 'source_ip': None}
    if operation == 'execute':
        response = await send_rows(c, operation, [payload])
        assert response.status_code == 200 and response.json()['count'] == 1, response.text
    else:
        payload['device_a_id'] = payload.pop('source_device_id')
        payload['port_a'] = payload.pop('source_port')
        if operation == 'create':
            response = await c['client'].post('/api/v1/networks/connections', headers=c['headers'], json=payload)
        else:
            response = await c['client'].put(f"/api/v1/networks/connections/{c['rows']['owned']}", headers=c['headers'], json=payload)
        assert response.status_code == 200, response.text
        assert response.json()['source_vlan'] == 0 and response.json()['target_vlan'] == 4094
        assert response.json()['speed_gbps'] == 2.5 and response.json()['purpose'] == 'retained text'
