"""Service calendar dates reject invalid input without losing existing values."""
from datetime import datetime
import csv
import io

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models import models
from test_chg13_authorization_security import _tenant_db
from test_service_relationship_authority import service_scope, snapshot


DATE_FIELDS = ['installation_date', 'purchase_date', 'expiry_date']


@pytest_asyncio.fixture
async def dated_service(service_scope, setup_db):
    c = service_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        service = await db.get(models.LogicalService, c['rows']['owned'])
        for field in DATE_FIELDS:
            setattr(service, field, datetime(2024, 5, 6))
        await db.commit()
    return c


async def write_dates(c, operation, dates):
    row = {'name': 'Dated service', 'service_type': 'Application', **dates}
    if operation == 'create':
        return await c['client'].post('/api/v1/logical-services', headers=c['headers'], json=row)
    if operation == 'update':
        return await c['client'].put(f"/api/v1/logical-services/{c['rows']['owned']}", headers=c['headers'], json=dates)
    return await c['client'].post(f'/api/v1/import/{operation}?table_name=logical_services',
        headers=c['headers'], json={'rows': [row]})


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update', 'preview-rows', 'execute'])
@pytest.mark.parametrize('field', DATE_FIELDS)
@pytest.mark.parametrize('value', ['2026-02-30', 'private-invalid-date', False, 0, {}])
async def test_invalid_service_dates_are_rejected_without_any_mutation(dated_service, setup_db, operation, field, value):
    c = dated_service
    before = await snapshot(c, setup_db)
    response = await write_dates(c, operation, {field: value})
    if operation in {'create', 'update'}:
        assert response.status_code == 422, response.text
        assert field in response.json()['detail']['field_errors']
        assert 'private-invalid-date' not in response.text
    else:
        assert response.status_code == 200, response.text
        if operation == 'preview-rows':
            assert response.json()['invalid_rows'] == 1 and response.json()['valid_rows'] == 0
            assert response.json()['results'][0]['normalized'] == {}
            assert field in ' '.join(response.json()['results'][0]['errors'])
        else:
            assert response.json()['status'] == 'failed' and response.json()['count'] == 0
            assert field in ' '.join(response.json()['errors'])
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update', 'preview-rows', 'execute'])
@pytest.mark.parametrize('value', ['2026-10-02', '2026-10-02T12:34:56', '2026-10-02T12:34:56Z', '2026-10-02T12:34:56-05:00', None, ''])
async def test_service_dates_roundtrip_and_explicit_clears_remain_supported(dated_service, setup_db, operation, value):
    c = dated_service
    before = await snapshot(c, setup_db)
    dates = dict.fromkeys(DATE_FIELDS, value)
    response = await write_dates(c, operation, dates)
    assert response.status_code == 200, response.text
    # These are operator calendar/wall dates, consistent with the Asset editor;
    # keep the entered day/time rather than shifting it by an offset.
    expected = datetime.fromisoformat(value.replace('Z', '+00:00')).replace(tzinfo=None) if value else None
    if operation == 'preview-rows':
        assert response.json()['valid_rows'] == 1 and response.json()['invalid_rows'] == 0
        normalized = response.json()['results'][0]['normalized']
        for field in DATE_FIELDS:
            assert normalized[field] == (expected.isoformat() if expected else None)
        assert await snapshot(c, setup_db) == before
        # The actual UI executes normalized preview rows, not the original CSV.
        response = await c['client'].post('/api/v1/import/execute?table_name=logical_services',
            headers=c['headers'], json={'rows': [normalized]})
        assert response.status_code == 200 and response.json()['count'] == 1, response.text
    elif operation == 'execute':
        assert response.json() == {'status': 'success', 'count': 1}
    async with _tenant_db(setup_db, c['tenant']) as db:
        if operation == 'update':
            row = await db.get(models.LogicalService, c['rows']['owned'])
        elif operation == 'create':
            row = await db.get(models.LogicalService, response.json()['id'])
        else:
            row = await db.scalar(select(models.LogicalService).where(models.LogicalService.name == 'Dated service'))
        assert row is not None
        for field in DATE_FIELDS:
            assert getattr(row, field) == expected
        if operation == 'update':
            assert row.config_json == {'retained': 'owned'}


@pytest.mark.asyncio
async def test_service_snapshot_date_csv_can_be_previewed_and_imported(dated_service, setup_db):
    c = dated_service
    exported = await c['client'].get('/api/v1/import/snapshot/logical_services', headers=c['headers'])
    assert exported.status_code == 200
    rows = list(csv.DictReader(io.StringIO(exported.text)))
    source = next(row for row in rows if row['name'] == 'owned service')
    source.update(name='Imported dated snapshot', device_id='')
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=source.keys());writer.writeheader();writer.writerow(source)
    preview = await c['client'].post('/api/v1/import/preview-file', headers=c['headers'], data={'table_name': 'logical_services'},
        files={'file': ('dated-services.csv', stream.getvalue(), 'text/csv')})
    assert preview.status_code == 200 and preview.json()['valid_rows'] == 1, preview.text
    normalized = preview.json()['results'][0]['normalized']
    response = await c['client'].post('/api/v1/import/execute?table_name=logical_services',
        headers=c['headers'], json={'rows': [normalized]})
    assert response.status_code == 200 and response.json()['count'] == 1, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        row = await db.scalar(select(models.LogicalService).where(models.LogicalService.name == 'Imported dated snapshot'))
        assert row is not None and all(getattr(row, field) == datetime(2024, 5, 6) for field in DATE_FIELDS)
