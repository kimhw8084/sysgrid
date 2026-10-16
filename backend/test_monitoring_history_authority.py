"""Monitoring revisions retain trusted authorship and immutable version history."""
import asyncio
import json
import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api import monitoring
from app.core.config import settings
from app.models import models
from test_chg13_authorization_security import _tenant_db


async def create(client, headers):
    response = await client.post('/api/v1/monitoring', headers=headers, json={
        'title': 'Private monitoring history fixture', 'category': 'Hardware', 'status': 'Existing',
    })
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['environment', 'trusted_proxy'])
@pytest.mark.parametrize('operation', ['create', 'update', 'delete', 'bulk_update', 'bulk_delete', 'bulk_restore', 'restore_history'])
async def test_history_actor_comes_from_resolved_identity(seeded_admin_tenant, setup_db, monkeypatch, mode, operation):
    monkeypatch.setattr(settings, 'IDENTITY_MODE', mode)
    monkeypatch.setattr(settings, 'USER_ID_ENV_VAR', 'SYSGRID_MONITORING_HISTORY_TEST_ACTOR')
    monkeypatch.setenv('SYSGRID_MONITORING_HISTORY_TEST_ACTOR', 'admin_root')
    client = seeded_admin_tenant['client']
    headers = {'X-User-Id': 'forged-history-actor', 'X-Authenticated-User': 'admin_root',
               'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}
    item = await create(client, headers)
    path = '/api/v1/monitoring/' + str(item['id'])
    if operation == 'update':
        response = await client.put(path, headers=headers, json={'purpose': 'Updated private purpose'})
    elif operation == 'delete':
        response = await client.delete(path, headers=headers)
    elif operation.startswith('bulk_'):
        if operation == 'bulk_restore':
            assert (await client.post('/api/v1/monitoring/bulk-action', headers=headers,
                json={'ids': [item['id']], 'action': 'delete'})).status_code == 200
        response = await client.post('/api/v1/monitoring/bulk-action', headers=headers, json={
            'ids': [item['id']], 'action': operation.removeprefix('bulk_'), 'payload': {'purpose': 'Bulk private purpose'},
        })
    elif operation == 'restore_history':
        history = await client.get(path + '/history', headers=headers)
        history_id = history.json()[0]['id']
        assert (await client.put(path, headers=headers, json={'purpose': 'Changed purpose'})).status_code == 200
        response = await client.post(path + '/restore/' + str(history_id), headers=headers)
    else:
        response = None
    if response is not None:
        assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, seeded_admin_tenant['tenant_id']) as db:
        latest = await db.scalar(select(models.MonitoringHistory).where(
            models.MonitoringHistory.monitoring_item_id == item['id']).order_by(models.MonitoringHistory.version.desc()).limit(1))
        assert latest.created_by_user_id == 'admin_root'
        audit = await db.scalar(select(models.AuditLog).where(models.AuditLog.target_table == 'monitoring_items',
            models.AuditLog.target_id == str(item['id'])).order_by(models.AuditLog.id.desc()).limit(1))
        assert audit is not None and audit.user_id == 'admin_root'
        expected = 'RESTORE' if operation in ('bulk_restore', 'restore_history') else operation.removeprefix('bulk_').upper()
        assert audit.action == expected
        assert isinstance(audit.changes['changed_fields'], list)
        assert 'Private monitoring' not in json.dumps(audit.changes)
        assert 'private purpose' not in json.dumps(audit.changes)


@pytest.mark.asyncio
async def test_caller_cannot_rewind_and_replace_a_recorded_revision(seeded_admin_tenant, setup_db):
    client = seeded_admin_tenant['client']
    headers = {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}
    item = await create(client, headers)
    path = '/api/v1/monitoring/' + str(item['id'])
    assert (await client.put(path, headers=headers, json={'purpose': 'Second revision'})).status_code == 200
    before = (await client.get(path + '/history', headers=headers)).json()
    changed = await client.put(path, headers=headers, json={'purpose': 'Third revision', 'version': 0})
    assert changed.status_code == 200, changed.text
    assert changed.json()['version'] == 3
    after = (await client.get(path + '/history', headers=headers)).json()
    assert len(after) == 3
    assert [row for row in after if row['version'] in (1, 2)] == before


@pytest.mark.asyncio
async def test_duplicate_revision_is_rejected_without_replacing_history(seeded_admin_tenant, setup_db):
    headers = {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}
    item = await create(seeded_admin_tenant['client'], headers)
    async with _tenant_db(setup_db, seeded_admin_tenant['tenant_id']) as db:
        original = await db.scalar(select(models.MonitoringHistory).where(models.MonitoringHistory.monitoring_item_id == item['id']))
        identity = original.id
        with pytest.raises(IntegrityError):
            await monitoring.save_monitoring_history(item['id'], 1, db, 'Must not replace', 'forged actor')
            await db.flush()
        await db.rollback()
        retained = await db.scalar(select(models.MonitoringHistory).where(models.MonitoringHistory.monitoring_item_id == item['id']))
        assert retained.id == identity and retained.created_by_user_id == 'admin_root'


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['noop_update', 'noop_bulk_update', 'invalid_update'])
async def test_unchanged_or_rejected_write_adds_no_revision_or_success_audit(seeded_admin_tenant, setup_db, operation):
    client = seeded_admin_tenant['client']
    headers = {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}
    item = await create(client, headers)
    path = '/api/v1/monitoring/' + str(item['id'])
    before = (await client.get(path + '/history', headers=headers)).json()
    if operation == 'noop_bulk_update':
        response = await client.post('/api/v1/monitoring/bulk-action', headers=headers,
            json={'ids': [item['id']], 'action': 'update', 'payload': {'title': item['title']}})
    else:
        payload = {'monitoring_url': 'javascript:unsafe'} if operation == 'invalid_update' else {'title': item['title']}
        response = await client.put(path, headers=headers, json=payload)
    assert response.status_code == (400 if operation == 'invalid_update' else 200), response.text
    assert (await client.get(path + '/history', headers=headers)).json() == before
    async with _tenant_db(setup_db, seeded_admin_tenant['tenant_id']) as db:
        retained = await db.get(models.MonitoringItem, item['id'])
        assert retained.version == 1 and retained.monitoring_url is None
        audits = (await db.scalars(select(models.AuditLog).where(models.AuditLog.target_table == 'monitoring_items',
            models.AuditLog.target_id == str(item['id'])))).all()
        assert len(audits) == 1 and audits[0].action == 'CREATE'


@pytest.mark.asyncio
async def test_legacy_rewound_counter_advances_past_recorded_history(seeded_admin_tenant, setup_db):
    client = seeded_admin_tenant['client']
    headers = {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}
    item = await create(client, headers)
    path = '/api/v1/monitoring/' + str(item['id'])
    assert (await client.put(path, headers=headers, json={'purpose': 'Recorded second revision'})).status_code == 200
    before = (await client.get(path + '/history', headers=headers)).json()
    async with _tenant_db(setup_db, seeded_admin_tenant['tenant_id']) as db:
        retained = await db.get(models.MonitoringItem, item['id'])
        retained.version = 1
        await db.commit()
    result = await client.put(path, headers=headers, json={'purpose': 'Recovered third revision'})
    assert result.status_code == 200 and result.json()['version'] == 3, result.text
    after = (await client.get(path + '/history', headers=headers)).json()
    assert len(after) == 3 and [row for row in after if row['version'] in (1, 2)] == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update', 'delete'])
async def test_audit_failure_rolls_back_data_and_history(seeded_admin_tenant, setup_db, operation):
    client = seeded_admin_tenant['client']
    headers = {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}
    item = None if operation == 'create' else await create(client, headers)
    path = '/api/v1/monitoring/' + str(item['id']) if item else ''
    before = (await client.get(path + '/history', headers=headers)).json() if item else []

    def fail_audit(session, *_):
        if any(isinstance(row, models.AuditLog) and row.target_table == 'monitoring_items' for row in session.new):
            raise RuntimeError('controlled monitoring audit failure')

    event.listen(Session, 'before_flush', fail_audit)
    try:
        with pytest.raises(RuntimeError, match='controlled monitoring audit failure'):
            if operation == 'create':
                await create(client, headers)
            elif operation == 'update':
                await client.put(path, headers=headers, json={'purpose': 'Must roll back'})
            else:
                await client.delete(path, headers=headers)
    finally:
        event.remove(Session, 'before_flush', fail_audit)
    async with _tenant_db(setup_db, seeded_admin_tenant['tenant_id']) as db:
        rows = (await db.scalars(select(models.MonitoringItem))).all()
        assert len(rows) == (1 if item else 0)
        audits = (await db.scalars(select(models.AuditLog).where(models.AuditLog.target_table == 'monitoring_items'))).all()
        assert len(audits) == (1 if item else 0)
        if item:
            assert rows[0].purpose is None and not rows[0].is_deleted
    if item:
        assert (await client.get(path + '/history', headers=headers)).json() == before


@pytest.mark.asyncio
async def test_stale_writer_cannot_overwrite_a_committed_peer(seeded_admin_tenant, setup_db, monkeypatch):
    client = seeded_admin_tenant['client']
    headers = {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}
    item = await create(client, headers)
    path = '/api/v1/monitoring/' + str(item['id'])
    loaded = asyncio.Event()
    release = asyncio.Event()
    original = monitoring.load_monitoring_item
    held = False

    async def hold_one_reader(db, item_id):
        nonlocal held
        result = await original(db, item_id)
        if not held:
            held = True
            loaded.set()
            await asyncio.wait_for(release.wait(), 5)
        return result

    monkeypatch.setattr(monitoring, 'load_monitoring_item', hold_one_reader)
    stale = asyncio.create_task(client.put(path, headers=headers, json={'purpose': 'Stale overwrite'}))
    try:
        await asyncio.wait_for(loaded.wait(), 5)
        winner = await client.put(path, headers=headers, json={'purpose': 'Committed peer'})
        assert winner.status_code == 200, winner.text
    finally:
        release.set()
    rejected = await stale
    assert rejected.status_code == 409, rejected.text
    async with _tenant_db(setup_db, seeded_admin_tenant['tenant_id']) as db:
        retained = await db.get(models.MonitoringItem, item['id'])
        assert retained.purpose == 'Committed peer' and retained.version == 2
    assert len((await client.get(path + '/history', headers=headers)).json()) == 2


@pytest.mark.asyncio
async def test_racing_revision_claim_rolls_back_the_loser(seeded_admin_tenant, setup_db, monkeypatch):
    client = seeded_admin_tenant['client']
    headers = {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(seeded_admin_tenant['tenant_id'])}
    item = await create(client, headers)
    path = '/api/v1/monitoring/' + str(item['id'])
    both_ready = asyncio.Event()
    original = monitoring.next_monitoring_version
    arrivals = 0

    async def same_revision(db, row):
        nonlocal arrivals
        version = await original(db, row)
        arrivals += 1
        if arrivals == 2:
            both_ready.set()
        await asyncio.wait_for(both_ready.wait(), 5)
        return version

    monkeypatch.setattr(monitoring, 'next_monitoring_version', same_revision)
    responses = await asyncio.gather(*(client.put(path, headers=headers, json={'purpose': value})
                                      for value in ('Concurrent A', 'Concurrent B')))
    assert sorted(response.status_code for response in responses) == [200, 409]
    winner = next(response.json() for response in responses if response.status_code == 200)
    async with _tenant_db(setup_db, seeded_admin_tenant['tenant_id']) as db:
        retained = await db.get(models.MonitoringItem, item['id'])
        assert retained.purpose == winner['purpose'] and retained.version == 2
        audits = (await db.scalars(select(models.AuditLog).where(models.AuditLog.target_table == 'monitoring_items'))).all()
        assert len(audits) == 2
    assert len((await client.get(path + '/history', headers=headers)).json()) == 2
