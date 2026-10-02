"""Ordinary Service writes record trusted, meaningful and atomic receipts."""
import json

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import models
from test_chg13_authorization_security import _tenant_db
from test_service_relationship_authority import service_scope, snapshot


@pytest.mark.asyncio
@pytest.mark.parametrize('creator', [None, 'forged'])
async def test_service_creation_records_trusted_creator_and_actor(service_scope, setup_db, creator):
    c = service_scope
    data = {'name': 'Trusted creation', 'service_type': 'OS', 'version': '7', 'device_id': c['devices']['peer']}
    if creator is not None:
        data['created_by_user_id'] = creator
    response = await c['client'].post('/api/v1/logical-services', headers=c['headers'], json=data)
    assert response.status_code == 200, response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        row = await db.get(models.LogicalService, response.json()['id'])
        assert row.created_by_user_id == 'admin_root'
        log = (await db.scalars(select(models.AuditLog))).one()
        assert log.user_id == 'admin_root' and log.target_id == str(row.id) and log.action == 'CREATE'
        assert log.target_table == 'logical_services'


@pytest.mark.asyncio
@pytest.mark.parametrize('payload', [{}, {'version': '1'}, {'device_id': None}, {'status': 'Existing'},
    {'status': 'Active'}, {'config_json': {'retained': 'floating'}}, {'id': 90000, 'created_by_user_id': 'forged'}])
async def test_unchanged_service_edits_preserve_all_state_and_history(service_scope, setup_db, payload):
    c = service_scope
    before = await snapshot(c, setup_db)
    response = await c['client'].put(f"/api/v1/logical-services/{c['rows']['floating']}", headers=c['headers'], json=payload)
    assert response.status_code == 200 and response.json()['id'] == c['rows']['floating'], response.text
    assert response.json()['secrets'][0]['username'] == 'floating account'
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_unchanged_mount_has_no_timestamp_host_or_audit_mutation(service_scope, setup_db):
    c = service_scope
    before = await snapshot(c, setup_db)
    for _ in range(2):
        response = await c['client'].post(f"/api/v1/logical-services/{c['rows']['owned']}/mount/{c['devices']['owned']}", headers=c['headers'])
        assert response.status_code == 200 and response.json() == {'status': 'success'}, response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_changed_service_edit_has_one_bounded_receipt_and_retry_is_noop(service_scope, setup_db):
    c = service_scope
    payload = {'version': '2', 'config_json': {'private-key': 'private-value'}, 'license_key': 'private-license',
               'created_by_user_id': 'forged'}
    url = f"/api/v1/logical-services/{c['rows']['owned']}"
    response = await c['client'].put(url, headers=c['headers'], json=payload)
    assert response.status_code == 200 and response.json()['version'] == '2', response.text
    async with _tenant_db(setup_db, c['tenant']) as db:
        service = await db.get(models.LogicalService, c['rows']['owned'])
        host = await db.get(models.Device, c['devices']['owned'])
        assert service.created_by_user_id == 'admin_root' and service.license_key == 'private-license'
        assert host.os_version == '2' and host.os_name == service.name
        log = (await db.scalars(select(models.AuditLog))).one()
        assert log.user_id == 'admin_root' and log.action == 'UPDATE' and log.target_id == str(service.id)
        assert log.changes['changed_fields'] == ['config_json', 'license_key', 'version']
        assert 'private-' not in json.dumps(log.changes)
    before_retry = await snapshot(c, setup_db)
    retry = await c['client'].put(url, headers=c['headers'], json=payload)
    assert retry.status_code == 200, retry.text
    assert await snapshot(c, setup_db) == before_retry


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', ['audit', 'integrity'])
async def test_create_failure_rolls_back_host_and_service_without_exposing_exception(service_scope, setup_db, failure):
    c = service_scope
    before = await snapshot(c, setup_db)

    def fail(session, *_):
        if any(isinstance(row, models.AuditLog) and row.action == 'CREATE' and row.target_table == 'logical_services' for row in session.new):
            if failure == 'integrity':
                raise IntegrityError('private SQL', {}, ValueError('private license conflict'))
            raise RuntimeError('controlled private service failure')

    event.listen(Session, 'before_flush', fail)
    try:
        payload = {'name': 'Failed OS', 'service_type': 'OS', 'version': '7', 'device_id': c['devices']['peer']}
        if failure == 'integrity':
            response = await c['client'].post('/api/v1/logical-services', headers=c['headers'], json=payload)
            assert response.status_code == 409 and 'private' not in response.text, response.text
        else:
            with pytest.raises(RuntimeError, match='controlled private service failure'):
                await c['client'].post('/api/v1/logical-services', headers=c['headers'], json=payload)
    finally:
        event.remove(Session, 'before_flush', fail)
    assert await snapshot(c, setup_db) == before
