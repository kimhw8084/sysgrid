"""Service snapshots cannot replace a committed peer edit or lifecycle change."""
import asyncio
import re

import pytest
from sqlalchemy import delete, select, update

from app.api import logical_services
from app.models import models
from test_chg13_authorization_security import _tenant_db
from test_service_relationship_authority import service_scope, snapshot


async def read_service(c, service_id):
    response = await c['client'].get('/api/v1/logical-services?include_deleted=true', headers=c['headers'])
    assert response.status_code == 200, response.text
    return next(row for row in response.json() if row['id'] == service_id)


@pytest.mark.asyncio
@pytest.mark.parametrize('peer_write', ['individual', 'bulk-update', 'archive', 'restore', 'mount', 'core'])
async def test_stale_service_draft_preserves_peer_and_all_audits(service_scope, setup_db, peer_write):
    c = service_scope
    identity = c['rows']['deleted' if peer_write == 'restore' else 'owned']
    initial = await read_service(c, identity)
    path = f'/api/v1/logical-services/{identity}'
    expected = initial.get('edit_revision', 'unprotected-pre-fix-snapshot')
    if peer_write == 'individual':
        peer = await c['client'].put(path, headers=c['headers'], json={'version': '2', 'purpose': 'Committed peer purpose'})
    elif peer_write == 'bulk-update':
        peer = await c['client'].post('/api/v1/logical-services/bulk-action', headers=c['headers'],
            json={'ids': [identity], 'action': 'update', 'payload': {'version': '2'}})
    elif peer_write == 'archive':
        peer = await c['client'].delete(path, headers=c['headers'])
    elif peer_write == 'restore':
        peer = await c['client'].post('/api/v1/logical-services/bulk-action', headers=c['headers'],
            json={'ids': [identity], 'action': 'restore'})
    elif peer_write == 'mount':
        peer = await c['client'].post(path + f"/mount/{c['devices']['peer']}", headers=c['headers'])
    else:
        async with _tenant_db(setup_db, c['tenant']) as db:
            await db.execute(update(models.LogicalService).where(models.LogicalService.id == identity).values(purpose='Core peer'))
            await db.commit()
        peer = None
    if peer is not None:
        assert peer.status_code == 200, peer.text
    before = await snapshot(c, setup_db)
    rejected = await c['client'].put(path, headers=c['headers'], json={
        'name': 'Stale draft must not persist', 'version': initial['version'],
        'device_id': initial['device_id'], 'is_deleted': initial['is_deleted'], 'expected_revision': expected,
    })
    assert rejected.status_code == 409, rejected.text
    assert 'draft is preserved' in rejected.json()['detail']
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_revision_is_server_owned_and_noops_and_legacy_calls_remain_compatible(service_scope, setup_db):
    c = service_scope
    initial = await read_service(c, c['rows']['owned'])
    assert re.fullmatch('[0-9a-f]{32}', initial['edit_revision'])
    path = f"/api/v1/logical-services/{initial['id']}"
    before = await snapshot(c, setup_db)
    noop = await c['client'].put(path, headers=c['headers'], json={
        'version': initial['version'], 'edit_revision': 'forged', 'expected_revision': initial['edit_revision'],
    })
    assert noop.status_code == 200 and noop.json()['edit_revision'] == initial['edit_revision'], noop.text
    assert await snapshot(c, setup_db) == before
    changed = await c['client'].put(path, headers=c['headers'], json={
        'purpose': 'Conditional edit', 'edit_revision': 'forged', 'expected_revision': initial['edit_revision'],
    })
    assert changed.status_code == 200, changed.text
    assert re.fullmatch('[0-9a-f]{32}', changed.json()['edit_revision'])
    assert changed.json()['edit_revision'] != initial['edit_revision'] and changed.json()['version'] == initial['version']
    legacy = await c['client'].put(path, headers=c['headers'], json={'purpose': 'Legacy integration'})
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()['edit_revision'] != changed.json()['edit_revision']
    summary = await c['client'].get('/api/v1/logical-services/summary', headers=c['headers'])
    assert next(row for row in summary.json() if row['id'] == initial['id'])['edit_revision'] == legacy.json()['edit_revision']


@pytest.mark.asyncio
@pytest.mark.parametrize('invalid', [None, 1, True, [], {}, '', 'x' * 32, 'A' * 32, 'a' * 31])
async def test_malformed_service_precondition_is_never_unconditional(service_scope, setup_db, invalid):
    c = service_scope
    before = await snapshot(c, setup_db)
    response = await c['client'].put(f"/api/v1/logical-services/{c['rows']['owned']}", headers=c['headers'],
        json={'purpose': 'Must not persist', 'expected_revision': invalid})
    assert response.status_code == 400, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_hidden_service_and_stale_noop_keep_authority_and_validation_order(service_scope, setup_db):
    c = service_scope
    initial = await read_service(c, c['rows']['owned'])
    path = f"/api/v1/logical-services/{initial['id']}"
    peer = await c['client'].put(path, headers=c['headers'], json={'purpose': 'Peer saved'})
    assert peer.status_code == 200
    before = await snapshot(c, setup_db)
    for payload in ({'purpose': 'Peer saved'}, {'cost': 'not a number'}):
        rejected = await c['client'].put(path, headers=c['headers'], json={**payload, 'expected_revision': initial['edit_revision']})
        assert rejected.status_code == 409, rejected.text
    hidden = await c['client'].put(f"/api/v1/logical-services/{c['rows']['foreign']}", headers=c['headers'],
        json={'expected_revision': None, 'purpose': 'Forbidden'})
    assert hidden.status_code == 404, hidden.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('peer_write', ['update', 'delete'])
@pytest.mark.parametrize('conditional', [True, False])
async def test_inflight_peer_write_returns_conflict_and_rolls_back_all_side_effects(service_scope, setup_db, monkeypatch, peer_write, conditional):
    c = service_scope
    identity = c['rows']['owned']
    initial = await read_service(c, identity)
    loaded, release = asyncio.Event(), asyncio.Event()
    original = logical_services._get_owned_service
    held = False

    async def hold_one_reader(request, db, service_id):
        nonlocal held
        row = await original(request, db, service_id)
        if not held:
            held = True
            loaded.set()
            await asyncio.wait_for(release.wait(), 5)
        return row

    monkeypatch.setattr(logical_services, '_get_owned_service', hold_one_reader)
    payload = {'version': 'Must not sync to host'}
    if conditional:
        payload['expected_revision'] = initial['edit_revision']
    stale = asyncio.create_task(c['client'].put(f'/api/v1/logical-services/{identity}', headers=c['headers'], json=payload))
    try:
        await asyncio.wait_for(loaded.wait(), 5)
        async with _tenant_db(setup_db, c['tenant']) as db:
            if peer_write == 'update':
                await db.execute(update(models.LogicalService).where(models.LogicalService.id == identity).values(purpose='Committed peer'))
            else:
                await db.execute(delete(models.LogicalService).where(models.LogicalService.id == identity))
            await db.commit()
        before = await snapshot(c, setup_db)
    finally:
        release.set()
    response = await stale
    assert response.status_code == 409, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_delete_and_recreate_identity_cannot_reuse_an_old_snapshot(service_scope, setup_db):
    c = service_scope
    created = await c['client'].post('/api/v1/logical-services', headers=c['headers'], json={'name': 'ABA original', 'service_type': 'Application'})
    assert created.status_code == 200, created.text
    initial = created.json()
    async with _tenant_db(setup_db, c['tenant']) as db:
        await db.execute(delete(models.LogicalService).where(models.LogicalService.id == initial['id']))
        await db.commit()
    replacement = await c['client'].post('/api/v1/logical-services', headers=c['headers'], json={'name': 'ABA replacement', 'service_type': 'Application'})
    assert replacement.status_code == 200 and replacement.json()['id'] == initial['id'], replacement.text
    assert replacement.json()['edit_revision'] != initial['edit_revision']
    before = await snapshot(c, setup_db)
    rejected = await c['client'].put(f"/api/v1/logical-services/{initial['id']}", headers=c['headers'],
        json={'purpose': 'Old identity draft', 'expected_revision': initial['edit_revision']})
    assert rejected.status_code == 409, rejected.text
    assert await snapshot(c, setup_db) == before
