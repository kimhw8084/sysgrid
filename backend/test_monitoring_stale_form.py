"""A browser draft must not overwrite a record saved after its snapshot."""
import asyncio
import re

import pytest
from sqlalchemy import delete, select, update

from app.models import models
from app.api import monitoring
from test_chg13_authorization_security import _tenant_db
from test_monitoring_history_authority import create


@pytest.mark.asyncio
@pytest.mark.parametrize('peer_write', ['individual', 'bulk'])
async def test_stale_form_preserves_the_committed_peer(seeded_admin_tenant, setup_db, peer_write):
    client = seeded_admin_tenant['client']
    headers = {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}
    initial = await create(client, headers)
    path = f"/api/v1/monitoring/{initial['id']}"
    # The fallback lets the unchanged application exercise the lost update,
    # rather than failing early because it does not yet expose a revision.
    expected = initial.get('edit_revision', 'unprotected-pre-fix-snapshot')
    if peer_write == 'individual':
        peer = await client.put(path, headers=headers, json={'purpose': 'Committed peer purpose'})
    else:
        peer = await client.post('/api/v1/monitoring/bulk-action', headers=headers,
            json={'ids': [initial['id']], 'action': 'update', 'payload': {'purpose': 'Committed peer purpose'}})
    assert peer.status_code == 200, peer.text
    history_before = (await client.get(path + '/history', headers=headers)).json()
    rejected = await client.put(path, headers=headers, json={
        'title': 'Retained browser draft title', 'purpose': initial['purpose'],
        'expected_revision': expected,
    })
    async with _tenant_db(setup_db, seeded_admin_tenant['tenant_id']) as db:
        item = await db.get(models.MonitoringItem, initial['id'])
        retained = {'purpose': item.purpose, 'title': item.title, 'version': item.version}
        audits = (await db.scalars(select(models.AuditLog).where(
            models.AuditLog.target_table == 'monitoring_items',
            models.AuditLog.target_id == str(initial['id'])))).all()
    assert (rejected.status_code, retained['purpose']) == (409, 'Committed peer purpose'), {
        'status': rejected.status_code, 'retained': retained,
    }
    assert retained['title'] == initial['title'] and retained['version'] == 2
    assert len(audits) == 2
    assert (await client.get(path + '/history', headers=headers)).json() == history_before


@pytest.mark.asyncio
async def test_revision_is_server_owned_and_legacy_writes_remain_compatible(seeded_admin_tenant):
    client = seeded_admin_tenant['client']
    headers = {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}
    item = await create(client, headers)
    assert re.fullmatch('[0-9a-f]{32}', item['edit_revision'])
    path = f"/api/v1/monitoring/{item['id']}"
    unchanged = await client.put(path, headers=headers, json={
        'title': item['title'], 'expected_revision': item['edit_revision'], 'edit_revision': 'forged',
    })
    assert unchanged.status_code == 200 and unchanged.json()['edit_revision'] == item['edit_revision']
    changed = await client.put(path, headers=headers, json={
        'purpose': 'Conditional save', 'expected_revision': item['edit_revision'], 'edit_revision': 'forged',
    })
    assert changed.status_code == 200, changed.text
    assert re.fullmatch('[0-9a-f]{32}', changed.json()['edit_revision'])
    assert changed.json()['edit_revision'] != item['edit_revision']
    legacy = await client.put(path, headers=headers, json={'impact': 'Existing integration without precondition'})
    assert legacy.status_code == 200 and legacy.json()['version'] == 3
    assert legacy.json()['edit_revision'] != changed.json()['edit_revision']
    rows = (await client.get('/api/v1/monitoring', headers=headers)).json()
    assert next(row for row in rows if row['id'] == item['id'])['edit_revision'] == legacy.json()['edit_revision']


@pytest.mark.asyncio
@pytest.mark.parametrize('invalid', [None, 1, [], '', 'x' * 32, 'A' * 32, 'a' * 31])
async def test_invalid_precondition_cannot_silently_become_an_unconditional_write(seeded_admin_tenant, invalid):
    client = seeded_admin_tenant['client']
    headers = {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}
    item = await create(client, headers)
    path = f"/api/v1/monitoring/{item['id']}"
    before = (await client.get(path + '/history', headers=headers)).json()
    response = await client.put(path, headers=headers, json={'purpose': 'Must not persist', 'expected_revision': invalid})
    assert response.status_code == 400, response.text
    assert (await client.get(path + '/history', headers=headers)).json() == before
    rows = (await client.get('/api/v1/monitoring', headers=headers)).json()
    retained = next(row for row in rows if row['id'] == item['id'])
    assert retained['purpose'] is None and retained['edit_revision'] == item['edit_revision']


@pytest.mark.asyncio
async def test_stale_noop_is_rejected_before_payload_validation(seeded_admin_tenant):
    client = seeded_admin_tenant['client']
    headers = {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}
    item = await create(client, headers)
    path = f"/api/v1/monitoring/{item['id']}"
    peer = await client.put(path, headers=headers, json={'purpose': 'Peer saved'})
    assert peer.status_code == 200
    for payload in ({'purpose': 'Peer saved'}, {'check_interval': 'invalid'}):
        response = await client.put(path, headers=headers, json={**payload, 'expected_revision': item['edit_revision']})
        assert response.status_code == 409, response.text
    assert len((await client.get(path + '/history', headers=headers)).json()) == 2


@pytest.mark.asyncio
async def test_core_update_invalidates_a_draft_without_relying_on_history_counter(seeded_admin_tenant, setup_db, monkeypatch):
    client = seeded_admin_tenant['client']
    headers = {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}
    item = await create(client, headers)
    loaded = asyncio.Event()
    release = asyncio.Event()
    original = monitoring.load_monitoring_item
    held = False

    async def hold_one_reader(db, item_id):
        nonlocal held
        row = await original(db, item_id)
        if not held:
            held = True
            loaded.set()
            await asyncio.wait_for(release.wait(), 5)
        return row

    monkeypatch.setattr(monitoring, 'load_monitoring_item', hold_one_reader)
    stale = asyncio.create_task(client.put(f"/api/v1/monitoring/{item['id']}", headers=headers,
        json={'purpose': 'Stale in-flight overwrite', 'expected_revision': item['edit_revision']}))
    try:
        await asyncio.wait_for(loaded.wait(), 5)
        async with _tenant_db(setup_db, seeded_admin_tenant['tenant_id']) as db:
            await db.execute(update(models.MonitoringItem).where(models.MonitoringItem.id == item['id'])
                .values(purpose='Committed Core update'))
            await db.commit()
            peer = await db.get(models.MonitoringItem, item['id'])
            assert peer.version == 1 and peer.edit_revision != item['edit_revision']
    finally:
        release.set()
    response = await stale
    assert response.status_code == 409, response.text
    async with _tenant_db(setup_db, seeded_admin_tenant['tenant_id']) as db:
        retained = await db.get(models.MonitoringItem, item['id'])
        assert retained.purpose == 'Committed Core update' and retained.version == 1
        audits = (await db.scalars(select(models.AuditLog).where(
            models.AuditLog.target_table == 'monitoring_items', models.AuditLog.target_id == str(item['id'])))).all()
        assert len(audits) == 1


@pytest.mark.asyncio
async def test_reused_sqlite_identity_never_reuses_an_edit_revision(seeded_admin_tenant, setup_db):
    client = seeded_admin_tenant['client']
    headers = {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}
    original = await create(client, headers)
    async with _tenant_db(setup_db, seeded_admin_tenant['tenant_id']) as db:
        await db.execute(delete(models.MonitoringItem).where(models.MonitoringItem.id == original['id']))
        await db.commit()
    replacement = await create(client, headers)
    assert replacement['id'] == original['id'] and replacement['version'] == original['version']
    assert replacement['edit_revision'] != original['edit_revision']
    rejected = await client.put(f"/api/v1/monitoring/{replacement['id']}", headers=headers,
        json={'purpose': 'Old identity draft', 'expected_revision': original['edit_revision']})
    assert rejected.status_code == 409
