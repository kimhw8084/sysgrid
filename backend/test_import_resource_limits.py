"""Import admission bounds apply before parsing, preview and database mutation."""
import io
import threading
import zipfile

import pandas as pd
import pytest
from sqlalchemy import func, select

from app.api import import_engine
from app.api.operational_bulk import MAX_OPERATIONAL_BULK_RECORDS
from app.models import models
from test_chg13_authorization_security import _tenant_db


def headers(c):
    return {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(c['tenant_id'])}


async def assert_no_writes(c, setup_db):
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        for model in (models.Device, models.LogicalService, models.AuditLog):
            assert await db.scalar(select(func.count()).select_from(model)) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['preview-rows', 'execute'])
async def test_row_limit_matches_operational_batch_limit(seeded_admin_tenant, setup_db, operation):
    c = seeded_admin_tenant
    rows = [{'name': f'Bounded host {i}', 'system': 'Resource proof'} for i in range(MAX_OPERATIONAL_BULK_RECORDS + 1)]
    response = await c['client'].post(f'/api/v1/import/{operation}?table_name=devices', headers=headers(c), json={'rows': rows})
    assert response.status_code == 413
    assert str(MAX_OPERATIONAL_BULK_RECORDS) in response.text
    await assert_no_writes(c, setup_db)


@pytest.mark.asyncio
async def test_exact_row_limit_remains_valid_and_schema_discloses_limits(seeded_admin_tenant, setup_db):
    c = seeded_admin_tenant
    rows = [{'name': f'Bounded host {i}', 'system': 'Resource proof'} for i in range(MAX_OPERATIONAL_BULK_RECORDS)]
    response = await c['client'].post('/api/v1/import/preview-rows?table_name=devices', headers=headers(c), json={'rows': rows})
    assert response.status_code == 200 and response.json()['valid_rows'] == MAX_OPERATIONAL_BULK_RECORDS
    schema = await c['client'].get('/api/v1/import/schema/devices', headers=headers(c))
    assert schema.json()['limits']['max_rows'] == MAX_OPERATIONAL_BULK_RECORDS
    assert schema.json()['limits']['max_file_bytes'] == 10 * 1024 ** 2
    await assert_no_writes(c, setup_db)


@pytest.mark.asyncio
@pytest.mark.parametrize('endpoint', ['preview-file', 'audit'])
async def test_file_byte_limit_is_enforced_before_parser(seeded_admin_tenant, setup_db, monkeypatch, endpoint):
    c = seeded_admin_tenant
    parsed = []

    def record_parse(*args, **kwargs):
        parsed.append(True)
        return pd.DataFrame([{'name': 'Must not parse', 'system': 'Resource proof'}])

    monkeypatch.setattr(import_engine, 'load_dataframe_from_upload', record_parse)
    response = await c['client'].post(f'/api/v1/import/{endpoint}?table_name=devices', headers=headers(c),
        data={'table_name': 'devices'}, files={'file': ('oversize.csv', b'x' * (10 * 1024 ** 2 + 1))})
    assert response.status_code == 413
    assert parsed == []
    await assert_no_writes(c, setup_db)


@pytest.mark.asyncio
@pytest.mark.parametrize('extension', ['csv', 'xlsx'])
async def test_file_row_limit_prevents_expensive_preview(seeded_admin_tenant, setup_db, extension):
    c = seeded_admin_tenant
    frame = pd.DataFrame([{'name': f'File host {i}', 'system': 'Resource proof'} for i in range(MAX_OPERATIONAL_BULK_RECORDS + 1)])
    data = io.BytesIO()
    if extension == 'csv': data.write(frame.to_csv(index=False).encode())
    else: frame.to_excel(data, index=False)
    response = await c['client'].post('/api/v1/import/preview-file', headers=headers(c),
        data={'table_name': 'devices'}, files={'file': (f'oversize.{extension}', data.getvalue())})
    assert response.status_code == 413
    await assert_no_writes(c, setup_db)


@pytest.mark.asyncio
async def test_compressed_workbook_is_bounded_before_excel_parser(seeded_admin_tenant, setup_db, monkeypatch):
    c = seeded_admin_tenant
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('xl/worksheets/sheet1.xml', b'x' * (64 * 1024 ** 2 + 1))
    parsed = []

    def record_excel(*args, **kwargs):
        parsed.append(True)
        return pd.DataFrame([{'name': 'Must not parse', 'system': 'Resource proof'}])

    monkeypatch.setattr(import_engine.pd, 'read_excel', record_excel)
    response = await c['client'].post('/api/v1/import/preview-file', headers=headers(c),
        data={'table_name': 'devices'}, files={'file': ('compressed.xlsx', stream.getvalue())})
    assert response.status_code == 413 and parsed == []
    await assert_no_writes(c, setup_db)


@pytest.mark.asyncio
async def test_parse_errors_do_not_echo_private_parser_details(seeded_admin_tenant, setup_db, monkeypatch):
    c = seeded_admin_tenant

    def fail_parse(*args, **kwargs):
        raise ValueError('private-parser-value must not appear in a response')

    monkeypatch.setattr(import_engine, 'load_dataframe_from_upload', fail_parse)
    response = await c['client'].post('/api/v1/import/preview-file', headers=headers(c),
        data={'table_name': 'devices'}, files={'file': ('private-filename.csv', b'name,system\nHost,Proof')})
    assert response.status_code == 400
    assert 'private-' not in response.text
    await assert_no_writes(c, setup_db)


@pytest.mark.asyncio
@pytest.mark.parametrize('chunked', [False, True])
async def test_request_body_limit_works_with_and_without_content_length(seeded_admin_tenant, setup_db, chunked):
    c = seeded_admin_tenant
    content = b'{"rows":[],"ignored":"' + b'x' * (12 * 1024 ** 2) + b'"}'

    async def chunks():
        for start in range(0, len(content), 65536):
            yield content[start:start + 65536]

    response = await c['client'].post('/api/v1/import/execute?table_name=devices',
        headers={**headers(c), 'Content-Type': 'application/json'}, content=chunks() if chunked else content)
    assert response.status_code == 413
    assert response.json()['code'] == 'IMPORT_REQUEST_TOO_LARGE'
    assert response.headers['X-Request-ID']
    await assert_no_writes(c, setup_db)


@pytest.mark.asyncio
async def test_exact_request_byte_limit_is_accepted_and_a_false_length_cannot_bypass_it(seeded_admin_tenant, setup_db):
    c = seeded_admin_tenant
    prefix, suffix = b'{"rows":[],"ignored":"', b'"}'
    content = prefix + b'x' * (12 * 1024 ** 2 - len(prefix) - len(suffix)) + suffix
    response = await c['client'].post('/api/v1/import/execute?table_name=devices',
        headers={**headers(c), 'Content-Type': 'application/json'}, content=content)
    assert response.status_code == 200 and response.json()['status'] == 'no_op'
    rejected = await c['client'].post('/api/v1/import/execute?table_name=devices',
        headers={**headers(c), 'Content-Type': 'application/json', 'Content-Length': '1'}, content=content + b' ')
    assert rejected.status_code == 413
    await assert_no_writes(c, setup_db)


@pytest.mark.asyncio
async def test_file_parser_runs_off_the_request_event_loop(seeded_admin_tenant, monkeypatch):
    c = seeded_admin_tenant
    main_thread = threading.get_ident()
    parser_threads = []

    def record_parse(*args, **kwargs):
        parser_threads.append(threading.get_ident())
        return pd.DataFrame([{'name': 'Thread proof', 'system': 'Resource proof'}])

    monkeypatch.setattr(import_engine, 'load_dataframe_from_upload', record_parse)
    response = await c['client'].post('/api/v1/import/preview-file', headers=headers(c),
        data={'table_name': 'devices'}, files={'file': ('valid.csv', b'name,system\nHost,Proof')})
    assert response.status_code == 200 and response.json()['valid_rows'] == 1
    assert len(parser_threads) == 1 and parser_threads[0] != main_thread


@pytest.mark.asyncio
async def test_too_many_workbook_members_and_corrupt_workbooks_are_rejected(seeded_admin_tenant, setup_db):
    c = seeded_admin_tenant
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as archive:
        for index in range(4097): archive.writestr(f'entry-{index}', b'')
    for content, expected in [(stream.getvalue(), 413), (b'private-corrupt-workbook', 400)]:
        response = await c['client'].post('/api/v1/import/preview-file', headers=headers(c),
            data={'table_name': 'devices'}, files={'file': ('invalid.xlsx', content)})
        assert response.status_code == expected
        assert 'private-corrupt' not in response.text
    await assert_no_writes(c, setup_db)
