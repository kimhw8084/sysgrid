"""Network no-op edits and archive receipts describe actual state transitions."""
import pytest
from sqlalchemy import select

from app.models import models
from test_chg13_authorization_security import _tenant_db
from test_network_endpoint_authorization import network_scope, snapshot


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['empty', 'same_text', 'same_id', 'server_fields', 'custom_ip'])
async def test_noop_edit_preserves_record_and_audit(network_scope, setup_db, kind):
    c = network_scope
    row_id = c['rows']['custom-both' if kind == 'custom_ip' else 'owned']
    payload = {'empty': {}, 'same_text': {'purpose': '  owned  '},
               'same_id': {'source_device_id': str(c['devices']['source'])},
               'server_fields': {'created_by_user_id': 'forged', 'created_at': '2001-01-01'}, 'custom_ip': {}}[kind]
    before = await snapshot(c, setup_db)
    response = await c['client'].put(f'/api/v1/networks/connections/{row_id}', headers=c['headers'], json=payload)
    assert response.status_code == 200 and response.json()['id'] == row_id, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_archive_retry_has_no_second_mutation_or_audit(network_scope, setup_db):
    c = network_scope
    url = f"/api/v1/networks/connections/{c['rows']['owned']}"
    first = await c['client'].delete(url, headers=c['headers'])
    assert first.status_code == 200, first.text
    before = await snapshot(c, setup_db)
    second = await c['client'].delete(url, headers=c['headers'])
    assert second.status_code == 200 and second.json() == first.json()
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['status', 'delete'])
async def test_bulk_receipts_count_only_changed_unique_records(network_scope, setup_db, operation):
    c = network_scope
    if operation == 'status':
        unchanged_id = c['rows']['custom-target']
        async with _tenant_db(setup_db, c['tenant']) as db:
            row = await db.get(models.PortConnection, unchanged_id)
            row.status = 'Maintenance'
            await db.commit()
    else:
        unchanged_id = c['rows']['deleted']
    changed_id = c['rows']['owned']
    before, before_audits = await snapshot(c, setup_db)
    payload = {'ids': [changed_id, unchanged_id, changed_id]}
    if operation == 'status':
        payload['status'] = 'Maintenance'
    url = f'/api/v1/networks/connections/bulk-{operation}'
    response = await c['client'].post(url, headers=c['headers'], json=payload)
    assert response.status_code == 200, response.text
    assert response.json()['count'] == response.json()['changed'] == 1
    if operation == 'delete':
        assert response.json()['deleted_ids'] == [changed_id]
    after, audits = await snapshot(c, setup_db)
    assert [r for r in before if r['id'] != changed_id] == [r for r in after if r['id'] != changed_id]
    assert len(audits) == len(before_audits) + 1
    async with _tenant_db(setup_db, c['tenant']) as db:
        entry = (await db.scalars(select(models.AuditLog))).one()
        assert '1' in entry.description
    retry = await c['client'].post(url, headers=c['headers'], json=payload)
    assert retry.status_code == 200, retry.text
    assert retry.json()['count'] == retry.json()['changed'] == 0
    if operation == 'delete':
        assert retry.json()['deleted_ids'] == []
    assert await snapshot(c, setup_db) == (after, audits)


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['status', 'delete'])
async def test_noop_bulk_still_authorizes_every_requested_member(network_scope, setup_db, operation):
    c = network_scope
    owned = c['rows']['owned' if operation == 'status' else 'deleted']
    hidden = c['rows']['foreign-target' if operation == 'status' else 'foreign-deleted']
    payload = {'ids': [owned, hidden]}
    if operation == 'status':
        payload['status'] = 'Active'
    before = await snapshot(c, setup_db)
    response = await c['client'].post(f'/api/v1/networks/connections/bulk-{operation}', headers=c['headers'], json=payload)
    assert response.status_code == 404, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_real_edit_records_only_changed_field_names(network_scope, setup_db):
    c = network_scope
    row_id = c['rows']['owned']
    response = await c['client'].put(f'/api/v1/networks/connections/{row_id}', headers=c['headers'],
        json={'purpose': 'private-changed-purpose', 'status': 'Active'})
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        entry = (await db.scalars(select(models.AuditLog))).one()
        assert (entry.action, entry.target_id) == ('UPDATE', str(row_id))
        assert entry.changes == {'changed_fields': ['purpose']}
        assert 'private' not in entry.description
