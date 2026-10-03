"""Asset calendar dates validate consistently before create, edit or bulk writes."""
from datetime import datetime

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models import models
from test_chg13_authorization_security import _tenant_db


DATE_FIELDS = ('purchase_date', 'install_date', 'warranty_end', 'eol_date')
ORIGINAL_DATE = datetime(2024, 2, 29)


@pytest_asyncio.fixture
async def dated_assets(seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant['tenant_id']
    async with _tenant_db(setup_db, tenant_id) as db:
        rows = [models.Device(name=name, system='Calendar proof', tenant_id=tenant_id, owner='Preserved owner',
                              **{field: ORIGINAL_DATE for field in DATE_FIELDS}) for name in ['Dated owner', 'Dated peer']]
        db.add_all(rows)
        await db.commit()
        return {
            'client': seeded_admin_tenant['client'], 'tenant_id': tenant_id, 'ids': [row.id for row in rows],
            'headers': {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(tenant_id)},
        }


async def write_dates(context, operation, payload):
    client, headers = context['client'], context['headers']
    if operation == 'create':
        return await client.post('/api/v1/devices', headers=headers, json={'name': 'New dated asset', 'system': 'Calendar proof', **payload})
    if operation == 'update':
        return await client.put(f"/api/v1/devices/{context['ids'][0]}", headers=headers, json=payload)
    return await client.post('/api/v1/devices/bulk-action', headers=headers, json={
        'ids': context['ids'], 'action': 'update', 'payload': payload, 'dry_run': operation == 'preview',
    })


async def assert_dates_preserved(context, setup_db):
    async with _tenant_db(setup_db, context['tenant_id']) as db:
        rows = (await db.scalars(select(models.Device).order_by(models.Device.id))).all()
        assert len(rows) == 2
        assert [row.name for row in rows] == ['Dated owner', 'Dated peer']
        assert all(row.owner == 'Preserved owner' for row in rows)
        assert all(getattr(row, field) == ORIGINAL_DATE for row in rows for field in DATE_FIELDS)


@pytest.mark.asyncio
@pytest.mark.parametrize('field', DATE_FIELDS)
@pytest.mark.parametrize('operation', ['create', 'update', 'preview', 'execute'])
async def test_invalid_calendar_date_never_clears_dates_or_partially_edits(dated_assets, setup_db, field, operation):
    response = await write_dates(dated_assets, operation, {'owner': 'Must not change', field: '2026-02-30'})
    assert response.status_code == 422, response.text
    assert field in response.json()['detail']
    await assert_dates_preserved(dated_assets, setup_db)


@pytest.mark.asyncio
@pytest.mark.parametrize('value', [True, 123, {'date': '2026-01-01'}, ['2026-01-01']])
@pytest.mark.parametrize('operation', ['create', 'update', 'preview', 'execute'])
async def test_non_text_dates_fail_without_mutation(dated_assets, setup_db, value, operation):
    response = await write_dates(dated_assets, operation, {'owner': 'Must not change', 'purchase_date': value})
    assert response.status_code == 422, response.text
    await assert_dates_preserved(dated_assets, setup_db)


@pytest.mark.asyncio
@pytest.mark.parametrize('value,expected', [
    ('2026-01-02', datetime(2026, 1, 2)),
    ('2026-01-02T08:30:00Z', datetime(2026, 1, 2, 8, 30)),
    ('2026-01-02T08:30:00+09:00', datetime(2026, 1, 2, 8, 30)),
])
async def test_bulk_preview_execution_and_noop_share_calendar_parsing(dated_assets, setup_db, value, expected):
    c = dated_assets
    payload = {field: value for field in DATE_FIELDS}
    preview = await write_dates(c, 'preview', payload)
    assert preview.status_code == 200 and preview.json()['changed_count'] == 2, preview.text
    await assert_dates_preserved(c, setup_db)
    executed = await write_dates(c, 'execute', payload)
    assert executed.status_code == 200 and executed.json()['changed_count'] == 2, executed.text
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        rows = (await db.scalars(select(models.Device))).all()
        # These are calendar fields edited by date-only inputs. Preserve the
        # established SQLite wall-date semantics, without shifting existing days.
        assert all(getattr(row, field) == expected for row in rows for field in DATE_FIELDS)
    repeated = await write_dates(c, 'execute', payload)
    assert repeated.status_code == 200 and repeated.json()['status'] == 'no_op'
    assert repeated.json()['changed_count'] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('empty', [None, ''])
async def test_full_asset_projection_and_explicit_empty_dates_remain_supported(dated_assets, setup_db, empty):
    c = dated_assets
    response = await write_dates(c, 'create', {field: '2024-02-29' for field in DATE_FIELDS})
    assert response.status_code == 200, response.text
    row = response.json()
    path = f"/api/v1/devices/{row['id']}"
    response = await c['client'].put(path, headers=c['headers'], json={**row, 'owner': 'Projection roundtrip'})
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        stored = await db.get(models.Device, row['id'])
        assert all(getattr(stored, field) == ORIGINAL_DATE for field in DATE_FIELDS)
    response = await c['client'].put(path, headers=c['headers'], json={field: empty for field in DATE_FIELDS})
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        stored = await db.get(models.Device, row['id'])
        assert all(getattr(stored, field) is None for field in DATE_FIELDS)
        assert stored.owner == 'Projection roundtrip'


@pytest.mark.asyncio
async def test_omitted_dates_preserve_existing_calendar_values(dated_assets, setup_db):
    c = dated_assets
    response = await write_dates(c, 'update', {'owner': 'New owner'})
    assert response.status_code == 200
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        stored = await db.get(models.Device, c['ids'][0])
        assert stored.owner == 'New owner' and all(getattr(stored, field) == ORIGINAL_DATE for field in DATE_FIELDS)
