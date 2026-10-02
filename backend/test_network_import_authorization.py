"""Network import discovery, preview, execution and exports share endpoint scope."""
import csv
import io

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import models
from test_chg13_authorization_security import _tenant_db
from test_network_endpoint_authorization import network_scope, snapshot


def valid_row(c, suffix='new'):
    return {'source_device_id': c['devices']['source'], 'target_device_id': c['devices']['peer'],
            'source_port': f'{suffix}-source', 'target_port': f'{suffix}-target', 'link_type': 'Data'}


async def send_rows(c, operation, rows):
    if operation == 'preview-file':
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
        return await c['client'].post('/api/v1/import/preview-file', headers=c['headers'],
            data={'table_name': 'port_connections'}, files={'file': ('network.csv', output.getvalue(), 'text/csv')})
    return await c['client'].post(f'/api/v1/import/{operation}?table_name=port_connections',
                                   headers=c['headers'], json={'rows': rows})


@pytest.mark.asyncio
async def test_schema_options_and_snapshot_exclude_foreign_endpoints(network_scope):
    c = network_scope
    schema = await c['client'].get('/api/v1/import/schema/port_connections', headers=c['headers'])
    assert schema.status_code == 200, schema.text
    for field in schema.json()['fields']:
        if field['name'] in {'source_device_id', 'target_device_id'}:
            assert {option['value'] for option in field['options']} == {str(c['devices'][name]) for name in ['source', 'peer']}
    assert 'Confidential' not in schema.text
    export = await c['client'].get('/api/v1/import/snapshot/port_connections', headers=c['headers'])
    assert export.status_code == 200, export.text
    rows = list(csv.DictReader(io.StringIO(export.text)))
    assert {row['purpose'] for row in rows} == {'owned', 'deleted', 'history', 'custom-source', 'custom-target', 'custom-both'}
    assert 'foreign-' not in export.text


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['preview-rows', 'preview-file', 'execute'])
@pytest.mark.parametrize('side', ['source', 'target'])
@pytest.mark.parametrize('identifier', ['id', 'name', 'overflow'])
async def test_foreign_or_invalid_import_endpoint_never_writes(network_scope, setup_db, operation, side, identifier):
    c = network_scope
    bad = valid_row(c, 'invalid')
    bad[f'{side}_device_id'] = {'id': c['devices']['foreign'], 'name': 'Confidential foreign asset', 'overflow': 2 ** 63}[identifier]
    before = await snapshot(c, setup_db)
    response = await send_rows(c, operation, [valid_row(c), bad])
    assert response.status_code == 200, response.text
    result = response.json()
    if operation == 'execute':
        assert result['status'] == 'failed' and result['count'] == 0, result
    else:
        assert result['valid_rows'] == result['invalid_rows'] == 1, result
        assert result['results'][1]['normalized'] == {}, result
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_owned_import_resolves_names_and_ids_and_records_atomic_audit(network_scope, setup_db):
    c = network_scope
    rows = [valid_row(c, 'first'), {**valid_row(c, 'second'), 'source_device_id': 'Authorized source',
                                 'target_device_id': 'Authorized peer', 'created_by_user_id': 'forged'}]
    response = await send_rows(c, 'execute', rows)
    assert response.status_code == 200 and response.json()['count'] == 2, response.text
    records, _ = await snapshot(c, setup_db)
    imported = [row for row in records if row['source_port'] in {'first-source', 'second-source'}]
    assert len(imported) == 2
    assert all(row['source_device_id'] == c['devices']['source'] and row['target_device_id'] == c['devices']['peer']
               and row['created_by_user_id'] == 'admin_root' for row in imported)
    async with _tenant_db(setup_db, c['tenant']) as db:
        audit = (await db.scalars(select(models.AuditLog))).one()
        assert (audit.user_id, audit.action, audit.target_table, audit.target_id) == (
            'admin_root', 'BULK_IMPORT', 'PORT_CONNECTIONS', 'MULTIPLE')
        assert audit.changes == {'count': 2}


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', ['audit', 'integrity'])
async def test_audit_failure_rolls_back_every_imported_connection(network_scope, setup_db, failure):
    c = network_scope
    before = await snapshot(c, setup_db)

    def fail_audit(session, *_):
        if any(isinstance(row, models.AuditLog) and row.action == 'BULK_IMPORT' for row in session.new):
            if failure == 'integrity':
                raise IntegrityError('private SQL', {}, ValueError('private conflict'))
            raise RuntimeError('controlled network import audit failure')

    event.listen(Session, 'before_flush', fail_audit)
    try:
        rows = [valid_row(c, 'first'), valid_row(c, 'second')]
        if failure == 'integrity':
            response = await send_rows(c, 'execute', rows)
            assert response.status_code == 409 and 'private' not in response.text, response.text
        else:
            with pytest.raises(RuntimeError, match='controlled network import audit failure'):
                await send_rows(c, 'execute', rows)
    finally:
        event.remove(Session, 'before_flush', fail_audit)
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_ambiguous_owned_name_or_tag_requires_correction(network_scope, setup_db):
    c = network_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        peer = await db.get(models.Device, c['devices']['peer'])
        peer.asset_tag = 'Authorized source'
        await db.commit()
    before = await snapshot(c, setup_db)
    response = await send_rows(c, 'preview-rows', [{**valid_row(c), 'source_device_id': 'Authorized source'}])
    assert response.status_code == 200 and response.json()['invalid_rows'] == 1, response.text
    assert 'ambiguous' in response.json()['results'][0]['errors'][0]
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['preview-rows', 'execute'])
@pytest.mark.parametrize('reversed_side', [False, True])
async def test_import_rejects_a_port_reused_within_the_same_batch(network_scope, setup_db, operation, reversed_side):
    c = network_scope
    first, second = valid_row(c, 'first'), valid_row(c, 'second')
    if reversed_side:
        second.update(source_device_id=c['devices']['peer'], target_device_id=c['devices']['source'], target_port=first['source_port'])
    else:
        second['source_port'] = first['source_port']
    before = await snapshot(c, setup_db)
    response = await send_rows(c, operation, [first, second])
    assert response.status_code == 200, response.text
    if operation == 'execute':
        assert response.json()['status'] == 'failed' and response.json()['count'] == 0
    else:
        assert response.json()['invalid_rows'] == 1
    assert await snapshot(c, setup_db) == before
