"""Services import preserves mounted-asset authority, data and atomic history."""
import csv
import io
import json

import pandas as pd
import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import models
from test_chg13_authorization_security import _tenant_db
from test_service_relationship_authority import service_scope, snapshot


def valid_row(c, name='Imported OS'):
    return {'name': name, 'service_type': 'OS', 'status': 'Existing',
            'version': '000007', 'device_id': c['devices']['peer']}


async def send_rows(c, operation, rows):
    if operation in {'preview-file', 'audit'}:
        stream = io.StringIO()
        writer = csv.DictWriter(stream, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
        args = {'data': {'table_name': 'logical_services'}} if operation == 'preview-file' else {'params': {'table_name': 'logical_services'}}
        return await c['client'].post(f'/api/v1/import/{operation}', headers=c['headers'],
            files={'file': ('services.csv', stream.getvalue(), 'text/csv')}, **args)
    return await c['client'].post(f'/api/v1/import/{operation}?table_name=logical_services',
        headers=c['headers'], json={'rows': rows})


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['preview-rows', 'preview-file', 'audit', 'execute'])
@pytest.mark.parametrize('identity', ['foreign', 'archived', 'missing', 'zero', 'overflow'])
async def test_unavailable_service_import_host_rejects_whole_batch(service_scope, setup_db, operation, identity):
    c = service_scope
    bad_id = {'foreign': c['devices']['foreign'], 'archived': c['devices']['archived'],
              'missing': 90000, 'zero': 0, 'overflow': 2 ** 63}[identity]
    before = await snapshot(c, setup_db)
    response = await send_rows(c, operation, [valid_row(c), {**valid_row(c, 'Invalid service'), 'device_id': bad_id}])
    assert response.status_code == 200, response.text
    if operation == 'execute':
        assert response.json()['status'] == 'failed' and response.json()['count'] == 0, response.text
    else:
        assert response.json()['valid_rows'] == response.json()['invalid_rows'] == 1, response.text
        assert response.json()['results'][1]['normalized'] == {}, response.text
    assert 'Confidential' not in response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['preview-rows', 'execute'])
@pytest.mark.parametrize('value', [True, False, 1.5, {}, [], '-1'])
async def test_service_import_does_not_coerce_malformed_host_identity(service_scope, setup_db, operation, value):
    c = service_scope
    before = await snapshot(c, setup_db)
    response = await send_rows(c, operation, [{**valid_row(c), 'device_id': value}])
    assert response.status_code == 200, response.text
    if operation == 'execute':
        assert response.json()['status'] == 'failed' and response.json()['count'] == 0
    else:
        assert response.json()['invalid_rows'] == 1
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['preview-rows', 'execute'])
@pytest.mark.parametrize('row', [None, [], 'not an object'])
async def test_service_import_reports_malformed_rows_without_writes(service_scope, setup_db, operation, row):
    c = service_scope
    before = await snapshot(c, setup_db)
    response = await send_rows(c, operation, [valid_row(c), row])
    assert response.status_code == 200, response.text
    if operation == 'execute':
        assert response.json()['status'] == 'failed' and response.json()['count'] == 0
    else:
        assert response.json()['valid_rows'] == response.json()['invalid_rows'] == 1
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_service_snapshot_excludes_foreign_mounts_and_retains_floating_rows(service_scope):
    c = service_scope
    response = await c['client'].get('/api/v1/import/snapshot/logical_services', headers=c['headers'])
    assert response.status_code == 200, response.text
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert {row['name'] for row in rows} == {'owned service', 'floating service'}
    assert 'foreign' not in response.text and 'Confidential' not in response.text


@pytest.mark.asyncio
async def test_service_import_records_trusted_creation_history_and_updates_os(service_scope, setup_db):
    c = service_scope
    rows = [{**valid_row(c), 'device_id': str(c['devices']['peer']), 'created_by_user_id': 'forged',
             'license_key': 'private license', 'config_json': '{"engine":"private engine"}',
             'logic_json': '[{"order":1}]', 'custom_attributes': '{"private":"value"}'},
            {**valid_row(c, 'Imported floating'), 'device_id': None, 'service_type': 'Application'}]
    response = await send_rows(c, 'execute', rows)
    assert response.status_code == 200 and response.json() == {'status': 'success', 'count': 2}, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        imported = (await db.scalars(select(models.LogicalService).where(models.LogicalService.name.like('Imported%')))).all()
        assert len(imported) == 2 and all(row.created_by_user_id == 'admin_root' for row in imported)
        mounted = next(row for row in imported if row.device_id is not None)
        assert mounted.config_json == {'engine': 'private engine'} and mounted.logic_json == [{'order': 1}]
        assert mounted.custom_attributes == {'private': 'value'} and mounted.license_key == 'private license'
        host = await db.get(models.Device, c['devices']['peer'])
        assert (host.os_name, host.os_version) == ('Imported OS', '000007')
        audit = (await db.scalars(select(models.AuditLog))).all()
        assert len(audit) == 3
        batch = [entry for entry in audit if entry.action == 'BULK_IMPORT']
        assert len(batch) == 1 and batch[0].target_table == 'LOGICAL_SERVICES'
        assert batch[0].target_id == 'MULTIPLE' and batch[0].changes == {'count': 2}
        ids = {row.id for row in imported}
    for row_id in ids:
        history = await c['client'].get('/api/v1/audit', headers=c['headers'],
            params={'target_table': 'logical_services', 'target_id': str(row_id)})
        assert history.status_code == 200 and len(history.json()) == 1, history.text
        entry = history.json()[0]
        assert entry['user_id'] == 'admin_root' and entry['action'] == 'CREATE'
        assert entry['changes']['batch_count'] == 2
        assert {'name', 'device_id', 'service_type'} <= set(entry['changes']['changed_fields'])
        assert 'private' not in json.dumps(entry) and 'forged' not in json.dumps(entry)


@pytest.mark.asyncio
@pytest.mark.parametrize('target', ['batch', 'record', 'host'])
@pytest.mark.parametrize('failure', ['runtime', 'integrity'])
async def test_service_import_rolls_back_records_hosts_and_audit_together(service_scope, setup_db, target, failure):
    c = service_scope
    before = await snapshot(c, setup_db)

    def fail(session, *_):
        matches = any(isinstance(row, models.AuditLog) and row.action == ('BULK_IMPORT' if target == 'batch' else 'CREATE')
                      for row in session.new) if target != 'host' else any(
                          isinstance(row, models.Device) and row.os_name == 'Imported OS' for row in session.dirty)
        if matches:
            if failure == 'integrity':
                raise IntegrityError('private SQL', {}, ValueError('private conflict'))
            raise RuntimeError('controlled service import failure')

    event.listen(Session, 'before_flush', fail)
    try:
        rows = [valid_row(c), {**valid_row(c, 'Imported floating'), 'device_id': None}]
        if failure == 'integrity':
            response = await send_rows(c, 'execute', rows)
            assert response.status_code == 409 and 'private' not in response.text, response.text
        else:
            with pytest.raises(RuntimeError, match='controlled service import failure'):
                await send_rows(c, 'execute', rows)
    finally:
        event.remove(Session, 'before_flush', fail)
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('extension', ['csv', 'xlsx'])
async def test_service_file_import_preserves_text_and_blank_host(service_scope, setup_db, extension):
    c = service_scope
    row = {**valid_row(c), 'license_key': '0000123', 'purpose': 'NA', 'manufacturer': 'N/A'}
    rows = [row, {**row, 'name': 'Imported floating', 'device_id': ''}]
    stream = io.BytesIO()
    if extension == 'csv':
        stream.write(pd.DataFrame(rows).to_csv(index=False).encode())
    else:
        pd.DataFrame(rows).to_excel(stream, index=False)
    before = await snapshot(c, setup_db)
    preview = await c['client'].post('/api/v1/import/preview-file', headers=c['headers'], data={'table_name': 'logical_services'},
        files={'file': (f'services.{extension}', stream.getvalue(), 'application/octet-stream')})
    assert preview.status_code == 200 and preview.json()['valid_rows'] == 2, preview.text
    normalized = [result['normalized'] for result in preview.json()['results']]
    for result in normalized:
        assert result['version'] == '000007' and result['license_key'] == '0000123'
        assert result['purpose'] == 'NA' and result['manufacturer'] == 'N/A'
    assert [result['device_id'] for result in normalized] == [c['devices']['peer'], None]
    assert await snapshot(c, setup_db) == before
    response = await send_rows(c, 'execute', normalized)
    assert response.status_code == 200 and response.json()['count'] == 2, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        imported = (await db.scalars(select(models.LogicalService).where(models.LogicalService.name.like('Imported%')))).all()
        assert len(imported) == 2 and all(row.license_key == '0000123' and row.version == '000007' for row in imported)


@pytest.mark.asyncio
async def test_empty_service_import_has_no_audit_or_state_side_effect(service_scope, setup_db):
    c = service_scope
    before = await snapshot(c, setup_db)
    response = await send_rows(c, 'execute', [])
    assert response.status_code == 200 and response.json() == {'status': 'success', 'count': 0}, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['preview-rows', 'execute'])
@pytest.mark.parametrize('encoded', [False, True])
async def test_nonfinite_service_import_values_are_controlled_rejections(service_scope, setup_db, operation, encoded):
    c = service_scope
    before = await snapshot(c, setup_db)
    row = {**valid_row(c), 'config_json': '{"value":NaN}' if encoded else {'value': float('nan')}}
    response = await c['client'].post(f'/api/v1/import/{operation}?table_name=logical_services',
        headers={**c['headers'], 'Content-Type': 'application/json'}, content=json.dumps({'rows': [row]}))
    if encoded:
        assert response.status_code == 200, response.text
        assert response.json()['invalid_rows'] == 1 if operation == 'preview-rows' else response.json()['status'] == 'failed'
    else:
        assert response.status_code == 422, response.text
    assert await snapshot(c, setup_db) == before
