"""Asset drafts and in-flight writers cannot erase committed peer work."""
import asyncio
import re

import pytest
from sqlalchemy import delete, select, update, text

from app.api import devices
from app.models import models
from test_asset_write_boundary import asset_context
from test_chg13_authorization_security import _tenant_db


async def read_asset(context):
    client, _, identity, headers = context
    response = await client.get('/api/v1/devices?include_deleted=true', headers=headers)
    assert response.status_code == 200, response.text
    return next(row for row in response.json() if row['id'] == identity)


async def snapshot(context, setup_db):
    async with _tenant_db(setup_db, context[1]) as db:
        result = {}
        for model in (models.Device, models.LogicalService, models.AuditLog):
            rows = (await db.scalars(select(model).order_by(model.id))).all()
            result[model.__tablename__] = [
                {column.name: getattr(row, column.name) for column in model.__table__.columns}
                for row in rows
            ]
        return result


@pytest.mark.asyncio
@pytest.mark.parametrize('peer_write', ['individual', 'bulk', 'archive', 'restore', 'core', 'recreated'])
async def test_stale_asset_draft_preserves_peer_projection_and_audit(asset_context, setup_db, peer_write):
    client, tenant, identity, headers = asset_context
    path = f'/api/v1/devices/{identity}'
    if peer_write == 'restore':
        assert (await client.delete(path, headers=headers)).status_code == 200
    initial = await read_asset(asset_context)
    if peer_write == 'individual':
        response = await client.put(path, headers=headers, json={'owner': 'Committed peer'})
    elif peer_write in {'bulk', 'restore'}:
        response = await client.post('/api/v1/devices/bulk-action', headers=headers,
            json={'ids': [identity], 'action': 'restore' if peer_write == 'restore' else 'update', 'payload': {'owner': 'Committed peer'}})
    elif peer_write == 'archive':
        response = await client.delete(path, headers=headers)
    else:
        async with _tenant_db(setup_db, tenant) as db:
            if peer_write == 'core':
                await db.execute(update(models.Device).where(models.Device.id == identity).values(owner='Committed peer'))
            else:
                await db.execute(delete(models.Device).where(models.Device.id == identity))
                db.add(models.Device(id=identity, name='Replacement identity', system='Replacement', tenant_id=tenant))
            await db.commit()
        response = None
    if response is not None:
        assert response.status_code == 200, response.text
    before = await snapshot(asset_context, setup_db)
    rejected = await client.put(path, headers=headers, json={
        'owner': 'Stale draft', 'os_name': 'Must not project',
        'expected_revision': initial.get('edit_revision', '0' * 32),
    })
    assert rejected.status_code == 409, rejected.text
    assert 'draft is preserved' in rejected.json()['detail']
    assert await snapshot(asset_context, setup_db) == before


@pytest.mark.asyncio
async def test_asset_revisions_are_server_owned_and_noops_preserve_history(asset_context, setup_db):
    client, _, identity, headers = asset_context
    initial = await read_asset(asset_context)
    assert re.fullmatch('[0-9a-f]{32}', initial['edit_revision'])
    before = await snapshot(asset_context, setup_db)
    noop = await client.put(f'/api/v1/devices/{identity}', headers=headers,
        json={'name': initial['name'], 'edit_revision': 'forged', 'expected_revision': initial['edit_revision']})
    assert noop.status_code == 200 and noop.json()['edit_revision'] == initial['edit_revision'], noop.text
    assert await snapshot(asset_context, setup_db) == before
    changed = await client.put(f'/api/v1/devices/{identity}', headers=headers,
        json={'owner': 'Conditional owner', 'edit_revision': 'forged', 'expected_revision': initial['edit_revision']})
    assert changed.status_code == 200, changed.text
    assert re.fullmatch('[0-9a-f]{32}', changed.json()['edit_revision'])
    assert changed.json()['edit_revision'] != initial['edit_revision']
    legacy = await client.put(f'/api/v1/devices/{identity}', headers=headers, json={'owner': 'Legacy owner'})
    assert legacy.status_code == 200 and legacy.json()['edit_revision'] != changed.json()['edit_revision'], legacy.text


@pytest.mark.asyncio
@pytest.mark.parametrize('invalid', [None, True, 1, [], {}, '', 'x' * 32, 'A' * 32, 'a' * 31])
async def test_malformed_asset_precondition_never_becomes_unconditional(asset_context, setup_db, invalid):
    client, _, identity, headers = asset_context
    before = await snapshot(asset_context, setup_db)
    response = await client.put(f'/api/v1/devices/{identity}', headers=headers,
        json={'owner': 'Must not persist', 'expected_revision': invalid})
    assert response.status_code == 400, response.text
    assert await snapshot(asset_context, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('peer_write', ['update', 'delete'])
@pytest.mark.parametrize('conditional', [True, False])
async def test_inflight_asset_race_rolls_back_domain_projection_and_audit(asset_context, setup_db, monkeypatch, peer_write, conditional):
    client, tenant, identity, headers = asset_context
    initial = await read_asset(asset_context)
    loaded, release = asyncio.Event(), asyncio.Event()
    original = devices._commit_device_definition
    async def hold_writer(request, db, device, action, changed_fields):
        loaded.set()
        await asyncio.wait_for(release.wait(), 5)
        return await original(request, db, device, action, changed_fields)
    monkeypatch.setattr(devices, '_commit_device_definition', hold_writer)
    payload = {'owner': 'Stale in-flight owner', 'os_name': 'Must not project'}
    if conditional:
        payload['expected_revision'] = initial.get('edit_revision', '0' * 32)
    pending = asyncio.create_task(client.put(f'/api/v1/devices/{identity}', headers=headers, json=payload))
    try:
        await asyncio.wait_for(loaded.wait(), 5)
        async with _tenant_db(setup_db, tenant) as db:
            statement = update(models.Device).where(models.Device.id == identity).values(owner='Committed race peer') if peer_write == 'update' else delete(models.Device).where(models.Device.id == identity)
            await db.execute(statement)
            await db.commit()
        before = await snapshot(asset_context, setup_db)
    finally:
        release.set()
    response = await pending
    assert response.status_code == 409, response.text
    assert await snapshot(asset_context, setup_db) == before


@pytest.mark.asyncio
async def test_legacy_sql_writers_advance_asset_revisions(asset_context, setup_db):
    initial = await read_asset(asset_context)
    async with _tenant_db(setup_db, asset_context[1]) as db:
        await db.execute(text('UPDATE devices SET owner = :owner WHERE id = :identity'), {'owner': 'Legacy SQL peer', 'identity': asset_context[2]})
        await db.execute(text('INSERT INTO devices (name, system, tenant_id, is_deleted) VALUES (:name, :system, :tenant, 0)'),
            {'name': 'Legacy inserted identity', 'system': 'Legacy system', 'tenant': asset_context[1]})
        await db.commit()
    current = await read_asset(asset_context)
    assert current['edit_revision'] != initial['edit_revision']
    rows = (await asset_context[0].get('/api/v1/devices', headers=asset_context[3])).json()
    inserted = next(row for row in rows if row['name'] == 'Legacy inserted identity')
    assert re.fullmatch('[0-9a-f]{32}', inserted['edit_revision'])
    assert inserted['edit_revision'] != current['edit_revision']


@pytest.mark.asyncio
async def test_concurrent_asset_creates_cannot_duplicate_active_hostnames(asset_context, setup_db):
    client, tenant, _, headers = asset_context
    payload = {'name': 'Concurrent unique host', 'system': 'Concurrent system', 'os_name': 'Linux'}
    first, second = await asyncio.gather(*(client.post('/api/v1/devices', headers=headers, json=payload) for _ in range(2)))
    assert sorted([first.status_code, second.status_code]) == [200, 409], (first.text, second.text)
    async with _tenant_db(setup_db, tenant) as db:
        rows = (await db.scalars(select(models.Device).where(models.Device.name == payload['name']))).all()
        assert len(rows) == 1
        services = (await db.scalars(select(models.LogicalService).where(models.LogicalService.device_id == rows[0].id))).all()
        assert len(services) == 1
