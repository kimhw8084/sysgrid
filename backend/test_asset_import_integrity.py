"""Asset imports share ordinary write integrity and server-owned tenant identity."""
import csv
import io
import json
from datetime import datetime

import pandas as pd
import pytest
import pytest_asyncio
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.models import models
from test_chg13_authorization_security import _tenant_db


@pytest_asyncio.fixture
async def import_context(seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant['tenant_id']
    async with _tenant_db(setup_db, tenant_id) as db:
        db.add_all([
            models.Device(name='Existing host', system='Import proof', tenant_id=tenant_id),
            models.Device(name='Archived host', system='Import proof', tenant_id=tenant_id, is_deleted=True),
            models.Device(name='Foreign private host', system='Private system', tenant_id=tenant_id + 100),
        ])
        await db.commit()
    return {'client': seeded_admin_tenant['client'], 'tenant_id': tenant_id,
            'headers': {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(tenant_id)}}


async def import_rows(context, operation, rows):
    return await context['client'].post(f'/api/v1/import/{operation}?table_name=devices',
                                        headers=context['headers'], json={'rows': rows})


async def assert_no_import(context, setup_db):
    async with _tenant_db(setup_db, context['tenant_id']) as db:
        assert await db.scalar(select(func.count()).select_from(models.Device)) == 3
        assert await db.scalar(select(func.count()).select_from(models.LogicalService)) == 0
        assert await db.scalar(select(func.count()).select_from(models.AuditLog)) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['preview-rows', 'execute'])
@pytest.mark.parametrize('kind', ['identity', 'integer', 'power', 'boolean', 'text', 'date', 'shape'])
async def test_invalid_import_batch_never_partially_writes(import_context, setup_db, operation, kind):
    values = {
        'identity': [{'name': None}, {'name': '   '}, {'system': ''}, {'name': ['private-input']}],
        'integer': [{'size_u': value} for value in [True, '1.5', 1.5, '0', '-1', str(2 ** 63)]],
        'power': [{'power_max_w': value} for value in [True, '-0.1', 'nan', 'inf', '1e400', {}]],
        'boolean': [{'recipe_critical': value} for value in ['unknown', [], 3]],
        'text': [{'owner': value} for value in [True, 12, {}, ['private-input']]],
        'date': [{'purchase_date': value} for value in ['2026-02-30', True, ['2026-01-01']]],
        'shape': [None, ['not-a-row'], 'not-a-row'],
    }[kind]
    for invalid in values:
        row = {'name': 'Invalid import', 'system': 'Import proof', **invalid} if isinstance(invalid, dict) else invalid
        response = await import_rows(import_context, operation, [
            {'name': 'Must not commit', 'system': 'Import proof', 'os_name': 'Must not sync'}, row,
        ])
        assert response.status_code == 200, response.text
        result = response.json()
        if operation == 'preview-rows':
            assert result['invalid_rows'] == 1 and result['results'][1]['status'] == 'INVALID', result
        else:
            assert result['status'] == 'failed' and result['count'] == 0, result
        await assert_no_import(import_context, setup_db)


@pytest.mark.asyncio
async def test_import_assigns_tenant_active_lifecycle_and_actor_on_server(import_context, setup_db):
    c = import_context
    forged = {'id': 9000, 'tenant_id': c['tenant_id'] + 100, 'is_deleted': True,
              'created_by_user_id': 'forged-author', 'created_at': '2000-01-01', 'updated_at': '2000-01-01'}
    row = {'name': 'Imported owned host', 'system': 'Import proof', 'os_name': 'Linux', 'os_version': '9.5', **forged}
    preview = await import_rows(c, 'preview-rows', [row])
    assert preview.status_code == 200 and preview.json()['valid_rows'] == 1, preview.text
    assert not set(forged) & preview.json()['results'][0]['normalized'].keys()
    await assert_no_import(c, setup_db)
    response = await import_rows(c, 'execute', [row])
    assert response.status_code == 200 and response.json()['status'] == 'success', response.text
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        stored = await db.scalar(select(models.Device).where(models.Device.name == row['name']))
        assert stored.id != 9000 and stored.tenant_id == c['tenant_id'] and stored.is_deleted is False
        assert stored.created_by_user_id == 'admin_root' and stored.created_at.year != 2000
        services = (await db.scalars(select(models.LogicalService).where(models.LogicalService.device_id == stored.id))).all()
        assert len(services) == 1 and services[0].name == 'Linux' and services[0].version == '9.5'
        audits = (await db.scalars(select(models.AuditLog))).all()
        assert len(audits) == 1 and audits[0].user_id == 'admin_root' and audits[0].action == 'BULK_IMPORT'
    listed = await c['client'].get('/api/v1/devices', headers=c['headers'])
    assert row['name'] in [item['name'] for item in listed.json()]


@pytest.mark.asyncio
@pytest.mark.parametrize('names', [['EXISTING HOST'], ['Same batch', 'same BATCH']])
@pytest.mark.parametrize('operation', ['preview-rows', 'execute'])
async def test_case_insensitive_duplicates_fail_before_import(import_context, setup_db, names, operation):
    response = await import_rows(import_context, operation, [{'name': name, 'system': 'Import proof'} for name in names])
    assert response.status_code == 200, response.text
    data = response.json()
    if operation == 'preview-rows': assert data['invalid_rows'] >= 1
    else: assert data['status'] == 'failed' and data['count'] == 0
    await assert_no_import(import_context, setup_db)


@pytest.mark.asyncio
async def test_import_allows_archived_and_foreign_names_without_adopting_their_identity(import_context, setup_db):
    c = import_context
    response = await import_rows(c, 'execute', [{'name': name, 'system': 'Import proof'} for name in ('Archived host', 'Foreign private host')])
    assert response.status_code == 200 and response.json()['count'] == 2, response.text
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        rows = (await db.scalars(select(models.Device).where(models.Device.tenant_id == c['tenant_id'], models.Device.is_deleted == False))).all()
        assert sorted(row.name for row in rows) == ['Archived host', 'Existing host', 'Foreign private host']


@pytest.mark.asyncio
@pytest.mark.parametrize('extension', ['csv', 'xlsx'])
async def test_file_preview_and_execution_preserve_identifiers_dates_and_numeric_values(import_context, setup_db, extension):
    c = import_context
    rows = [{'name': 'File import', 'system': 'Import proof', 'serial_number': '0000123', 'asset_tag': 'NA',
             'size_u': '2.0', 'power_supply_count': '0', 'power_max_w': '425.25', 'recipe_critical': 'yes',
             'purchase_date': '2024-02-29', 'metadata_json': '{"source":"file"}'}]
    stream = io.BytesIO()
    if extension == 'csv': stream.write(pd.DataFrame(rows).to_csv(index=False).encode())
    else: pd.DataFrame(rows).to_excel(stream, index=False)
    preview = await c['client'].post('/api/v1/import/preview-file', headers=c['headers'], data={'table_name': 'devices'},
                                       files={'file': (f'assets.{extension}', stream.getvalue())})
    assert preview.status_code == 200 and preview.json()['valid_rows'] == 1, preview.text
    parsed = preview.json()['results'][0]
    assert parsed['normalized']['serial_number'] == '0000123' and parsed['normalized']['asset_tag'] == 'NA'
    await assert_no_import(c, setup_db)
    response = await import_rows(c, 'execute', [parsed['source']])
    assert response.status_code == 200 and response.json()['status'] == 'success', response.text
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        stored = await db.scalar(select(models.Device).where(models.Device.name == 'File import'))
        assert stored.serial_number == '0000123' and stored.asset_tag == 'NA'
        assert stored.size_u == 2 and stored.power_supply_count == 0 and stored.power_max_w == 425.25
        assert stored.recipe_critical is True and stored.purchase_date == datetime(2024, 2, 29)
        assert stored.metadata_json == {'source': 'file'} and stored.tenant_id == c['tenant_id']


@pytest.mark.asyncio
async def test_schema_template_and_snapshot_exclude_server_fields_and_foreign_assets(import_context):
    c = import_context
    schema = await c['client'].get('/api/v1/import/schema/devices', headers=c['headers'])
    assert schema.status_code == 200
    names = {field['name'] for field in schema.json()['fields']}
    assert not {'id', 'tenant_id', 'is_deleted', 'created_by_user_id', 'created_at', 'updated_at'} & names
    assert {'name', 'system'} <= set(schema.json()['required_fields'])
    template = await c['client'].get('/api/v1/import/template/devices', headers=c['headers'])
    assert template.status_code == 200 and set(next(csv.reader(io.StringIO(template.text)))) == names
    snapshot = await c['client'].get('/api/v1/import/snapshot/devices', headers=c['headers'])
    assert snapshot.status_code == 200
    records = list(csv.DictReader(io.StringIO(snapshot.text)))
    assert [row['name'] for row in records] == ['Existing host']
    assert set(records[0]) == names


@pytest.mark.asyncio
async def test_audit_failure_rolls_back_the_entire_import_and_os_sync(import_context, setup_db):
    def fail_audit(session, *_):
        if any(isinstance(row, models.AuditLog) and row.action == 'BULK_IMPORT' for row in session.new):
            raise RuntimeError('controlled import audit failure')
    event.listen(Session, 'before_flush', fail_audit)
    try:
        with pytest.raises(RuntimeError, match='controlled import audit failure'):
            await import_rows(import_context, 'execute', [{'name': 'Must roll back', 'system': 'Import proof', 'os_name': 'Linux'}])
    finally:
        event.remove(Session, 'before_flush', fail_audit)
    await assert_no_import(import_context, setup_db)


@pytest.mark.asyncio
async def test_nonfinite_json_import_is_a_client_error(import_context, setup_db):
    c = import_context
    for operation in ['preview-rows', 'execute']:
        response = await c['client'].post(f'/api/v1/import/{operation}?table_name=devices',
            headers={**c['headers'], 'Content-Type': 'application/json'},
            content=json.dumps({'rows': [{'name': 'NaN import', 'system': 'Import proof', 'power_max_w': float('nan')}]}))
        assert response.status_code == 422, response.text
        await assert_no_import(c, setup_db)


@pytest.mark.asyncio
async def test_executed_import_never_adopts_client_tenant_or_archive_state(import_context, setup_db):
    c = import_context
    response = await import_rows(c, 'execute', [{'name': 'Forged import', 'system': 'Import proof',
                                               'tenant_id': c['tenant_id'] + 100, 'is_deleted': True}])
    assert response.status_code == 200 and response.json()['status'] == 'success', response.text
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        stored = await db.scalar(select(models.Device).where(models.Device.name == 'Forged import'))
        assert stored.tenant_id == c['tenant_id'] and stored.is_deleted is False


@pytest.mark.asyncio
async def test_asset_snapshot_excludes_foreign_rows_even_in_shared_physical_database(import_context):
    c = import_context
    response = await c['client'].get('/api/v1/import/snapshot/devices', headers=c['headers'])
    assert response.status_code == 200
    assert 'Foreign private host' not in response.text and 'Private system' not in response.text
    assert [row['name'] for row in csv.DictReader(io.StringIO(response.text))] == ['Existing host']


@pytest.mark.asyncio
async def test_empty_import_is_an_audit_free_no_op(import_context, setup_db):
    response = await import_rows(import_context, 'execute', [])
    assert response.status_code == 200 and response.json() == {'status': 'no_op', 'count': 0}
    await assert_no_import(import_context, setup_db)


@pytest.mark.asyncio
async def test_import_preserves_integral_numbers_and_legacy_boolean_aliases(import_context, setup_db):
    values = [True, False, 1, 0, 'Y', 'n', 'TRUE', 'false', '1', '0']
    rows = [{'name': f'Alias {index}', 'system': 'Import proof', 'size_u': 2.0,
             'recipe_critical': value, 'is_reservation': value} for index, value in enumerate(values)]
    response = await import_rows(import_context, 'execute', rows)
    assert response.status_code == 200 and response.json()['count'] == len(rows), response.text
    async with _tenant_db(setup_db, import_context['tenant_id']) as db:
        saved = (await db.scalars(select(models.Device).where(models.Device.name.like('Alias %')).order_by(models.Device.name))).all()
        assert [row.recipe_critical for row in saved] == [True, False] * 5
        assert [row.is_reservation for row in saved] == [True, False] * 5
        assert all(row.size_u == 2 for row in saved)
