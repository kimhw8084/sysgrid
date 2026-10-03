"""Relationship and legacy software writes preserve authorized inventory ownership."""
import asyncio
import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.main import app
from app.models import models
from test_chg13_authorization_security import _grant_access, _seed_operator, _tenant_db


@pytest_asyncio.fixture
async def link_context(seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant['tenant_id']
    async with _tenant_db(setup_db, tenant_id) as db:
        assets = {
            name: models.Device(name=name, system='Link proof', tenant_id=tenant_id + (100 if name == 'foreign' else 0),
                                is_deleted=name == 'archived')
            for name in ['owner', 'peer', 'third', 'foreign', 'archived']
        }
        db.add_all(assets.values())
        await db.flush()
        relationship = models.DeviceRelationship(source_device_id=assets['owner'].id, target_device_id=assets['peer'].id,
                                                  relationship_type='Depends On', notes='Retained', created_by_user_id='original')
        foreign_relationship = models.DeviceRelationship(source_device_id=assets['owner'].id, target_device_id=assets['foreign'].id)
        software = models.DeviceSoftware(device_id=assets['owner'].id, name='Retained', version='1.0', created_by_user_id='original')
        foreign_software = models.DeviceSoftware(device_id=assets['foreign'].id, name='Foreign')
        db.add_all([relationship, foreign_relationship, software, foreign_software])
        await db.commit()
        context = {
            'client': seeded_admin_tenant['client'], 'tenant_id': tenant_id,
            'headers': {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(tenant_id)},
            **{name: row.id for name, row in assets.items()},
            'relationships': relationship.id, 'foreign_relationships': foreign_relationship.id,
            'software': software.id, 'foreign_software': foreign_software.id,
        }
    override = app.dependency_overrides.pop(get_db)
    try:
        yield context
    finally:
        app.dependency_overrides[get_db] = override


@pytest.mark.asyncio
@pytest.mark.parametrize('target', [None, True, 1.5, -1, 0, 2 ** 63, 'invalid', '1.5'])
async def test_malformed_relationship_targets_fail_before_mutation(link_context, setup_db, target):
    c = link_context
    response = await c['client'].post(f"/api/v1/devices/{c['owner']}/relationships", headers=c['headers'],
                                      json={'target_device_id': target})
    assert response.status_code == 422, response.text
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        assert len((await db.scalars(select(models.DeviceRelationship))).all()) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('side', ['source', 'target'])
@pytest.mark.parametrize('asset', ['foreign', 'archived', 'missing'])
async def test_new_relationship_endpoints_must_be_active_and_authorized(link_context, side, asset):
    c = link_context
    source = c.get(asset, 90000) if side == 'source' else c['owner']
    target = c.get(asset, 90000) if side == 'target' else c['peer']
    response = await c['client'].post(f'/api/v1/devices/{source}/relationships', headers=c['headers'],
                                      json={'target_device_id': target, 'notes': 'Denied'})
    assert response.status_code == 404, response.text


@pytest.mark.asyncio
async def test_relationship_reads_scope_both_endpoints_and_preserve_archived_history(link_context, setup_db):
    c = link_context
    for suffix in ['relationships/all', f"{c['owner']}/relationships", f"{c['peer']}/relationships"]:
        response = await c['client'].get(f'/api/v1/devices/{suffix}', headers=c['headers'])
        assert response.status_code == 200
        assert [row['id'] for row in response.json()] == [c['relationships']]
    for asset in [c['foreign'], 90000]:
        response = await c['client'].get(f'/api/v1/devices/{asset}/relationships', headers=c['headers'])
        assert response.status_code == 404
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        (await db.get(models.Device, c['peer'])).is_deleted = True
        await db.commit()
    response = await c['client'].get(f"/api/v1/devices/{c['peer']}/relationships", headers=c['headers'])
    assert response.status_code == 200 and response.json()[0]['id'] == c['relationships']


@pytest.mark.asyncio
@pytest.mark.parametrize('resource', ['software', 'relationships'])
async def test_generic_edits_preserve_parent_and_server_metadata(link_context, setup_db, resource):
    c = link_context
    response = await c['client'].put(f"/api/v1/devices/{resource}/{c[resource]}", headers=c['headers'], json={
        'id': 90000, 'device_id': c['third'], 'source_device_id': c['third'], 'target_device_id': c['third'],
        'created_by_user_id': 'forged', 'created_at': '2000-01-01T00:00:00', 'updated_at': '2000-01-01T00:00:00',
        'name': 'Allowed', 'notes': 'Allowed',
    })
    assert response.status_code == 200, response.text
    row = response.json()
    assert row['id'] == c[resource] and row['created_by_user_id'] == 'original'
    assert not row['created_at'].startswith('2000') and not row['updated_at'].startswith('2000')
    if resource == 'software':
        assert row['device_id'] == c['owner'] and row['name'] == 'Allowed'
    else:
        assert row['source_device_id'] == c['owner'] and row['target_device_id'] == c['peer'] and row['notes'] == 'Allowed'


@pytest.mark.asyncio
@pytest.mark.parametrize('resource,field,value', [
    ('software', 'name', {'bad': 'object'}), ('software', 'version', True),
    ('software', 'install_date', 'not-a-date'), ('software', 'install_date', 123),
    ('software', 'install_date', '0001-01-01T00:00:00+01:00'),
    ('software', 'install_date', '9999-12-31T23:59:59-01:00'),
    ('relationships', 'source_role', ['bad']), ('relationships', 'notes', False),
])
async def test_invalid_edit_fields_never_partially_persist(link_context, setup_db, resource, field, value):
    c = link_context
    response = await c['client'].put(f"/api/v1/devices/{resource}/{c[resource]}", headers=c['headers'],
                                     json={'notes': 'Must not persist', field: value})
    assert response.status_code == 422, response.text
    model = models.DeviceSoftware if resource == 'software' else models.DeviceRelationship
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        row = await db.get(model, c[resource])
        assert row.notes == (None if resource == 'software' else 'Retained')


@pytest.mark.asyncio
@pytest.mark.parametrize('resource', ['software', 'relationships'])
@pytest.mark.parametrize('method', ['PUT', 'DELETE'])
@pytest.mark.parametrize('identity', ['foreign', 'missing'])
async def test_mutation_scope_hides_foreign_and_missing_rows(link_context, resource, method, identity):
    c = link_context
    row_id = c[f'foreign_{resource}'] if identity == 'foreign' else 90000
    response = await c['client'].request(method, f'/api/v1/devices/{resource}/{row_id}', headers=c['headers'], json={'notes': 'Denied'})
    assert response.status_code == 404, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize('resource,method', [('relationships', 'POST'), ('relationships', 'PUT'), ('relationships', 'DELETE'),
                                              ('software', 'PUT'), ('software', 'DELETE')])
async def test_audit_failure_rolls_back_link_and_software_changes(link_context, setup_db, resource, method):
    c = link_context

    def fail_audit(session, *_):
        if any(isinstance(row, models.AuditLog) and row.target_table in ('device_software', 'device_relationships') for row in session.new):
            raise RuntimeError('controlled link audit failure')

    event.listen(Session, 'before_flush', fail_audit)
    try:
        path = f"/api/v1/devices/{c['owner']}/relationships" if method == 'POST' else f"/api/v1/devices/{resource}/{c[resource]}"
        with pytest.raises(RuntimeError, match='controlled link audit failure'):
            await c['client'].request(method, path, headers=c['headers'], json={'target_device_id': c['third'], 'notes': 'Must roll back'})
    finally:
        event.remove(Session, 'before_flush', fail_audit)
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        assert len((await db.scalars(select(models.DeviceRelationship))).all()) == 2
        assert (await db.get(models.DeviceRelationship, c['relationships'])).notes == 'Retained'
        assert (await db.get(models.DeviceSoftware, c['software'])).notes is None


@pytest.mark.asyncio
async def test_current_relationship_form_roundtrip_and_software_dates_remain_supported(link_context, setup_db):
    c = link_context
    response = await c['client'].post(f"/api/v1/devices/{c['owner']}/relationships", headers=c['headers'], json={
        'target_device_id': str(c['third']), 'relationship_type': 'Depends On', 'source_role': 'Consumer', 'target_role': 'Provider',
        'id': 90000, 'source_device_id': c['foreign'], 'created_by_user_id': 'forged',
    })
    assert response.status_code == 200, response.text
    row = response.json()
    assert row['id'] != 90000 and row['source_device_id'] == c['owner'] and row['created_by_user_id'] == 'admin_root'
    path = f"/api/v1/devices/relationships/{row['id']}"
    response = await c['client'].put(path, headers=c['headers'], json={**row, 'notes': 'Added note'})
    assert response.status_code == 200 and response.json()['source_role'] == 'Consumer'
    assert (await c['client'].delete(path, headers=c['headers'])).status_code == 200
    assert (await c['client'].delete(path, headers=c['headers'])).status_code == 404
    software_path = f"/api/v1/devices/software/{c['software']}"
    response = await c['client'].put(software_path, headers=c['headers'], json={'install_date': '2026-10-02T12:30:00+02:00'})
    assert response.status_code == 200, response.text
    assert response.json()['install_date'].startswith('2026-10-02T10:30:00')
    response = await c['client'].put(software_path, headers=c['headers'], json={**response.json(), 'version': '2.0', 'install_date': None})
    assert response.status_code == 200 and response.json()['install_date'] is None
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        audits = (await db.scalars(select(models.AuditLog).where(models.AuditLog.target_table == 'device_relationships',
                                  models.AuditLog.target_id == str(row['id'])).order_by(models.AuditLog.id))).all()
        assert [entry.action for entry in audits] == ['CREATE', 'UPDATE', 'DELETE']
        assert all(entry.user_id == 'admin_root' for entry in audits)


@pytest.mark.asyncio
@pytest.mark.parametrize('role,permissions', [('VIEWER', {'assets': 3}), ('EDITOR', {'assets': 1})])
async def test_link_mutations_preserve_real_tenant_and_module_write_guards(link_context, setup_db, role, permissions):
    c = link_context
    user = 'limited-link-user'
    await _grant_access(setup_db, tenant_id=c['tenant_id'], user_id=user, role=role)
    await _seed_operator(setup_db, c['tenant_id'], user, role_permissions=permissions)
    headers = {**c['headers'], 'X-User-Id': user}
    for method, path in [('POST', f"{c['owner']}/relationships"), ('PUT', f"relationships/{c['relationships']}"),
                         ('DELETE', f"relationships/{c['relationships']}"), ('PUT', f"software/{c['software']}"),
                         ('DELETE', f"software/{c['software']}")]:
        response = await c['client'].request(method, f'/api/v1/devices/{path}', headers=headers,
                                             json={'target_device_id': c['third'], 'notes': 'Denied'})
        assert response.status_code == 403, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize('resource', ['software', 'relationships'])
async def test_concurrent_delete_records_only_the_removed_row(link_context, setup_db, resource):
    c = link_context
    path = f"/api/v1/devices/{resource}/{c[resource]}"
    responses = await asyncio.gather(*(c['client'].delete(path, headers=c['headers']) for _ in range(2)))
    assert sorted(response.status_code for response in responses) == [200, 404]
    table = 'device_software' if resource == 'software' else 'device_relationships'
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        audits = (await db.scalars(select(models.AuditLog).where(models.AuditLog.target_table == table))).all()
        assert len(audits) == 1 and audits[0].action == 'DELETE'


@pytest.mark.asyncio
async def test_disappearing_relationship_target_returns_conflict_and_no_partial_history(link_context, setup_db, monkeypatch):
    from app.api import devices

    c = link_context
    original = devices.require_relationship_asset

    async def remove_after_validation(request, db, device_id, *, active=False):
        await original(request, db, device_id, active=active)
        if device_id == c['third'] and active:
            async with _tenant_db(setup_db, c['tenant_id']) as competing:
                await competing.delete(await competing.get(models.Device, device_id))
                await competing.commit()

    monkeypatch.setattr(devices, 'require_relationship_asset', remove_after_validation)
    response = await c['client'].post(f"/api/v1/devices/{c['owner']}/relationships", headers=c['headers'],
                                      json={'target_device_id': c['third']})
    assert response.status_code == 409, response.text
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        assert len((await db.scalars(select(models.DeviceRelationship))).all()) == 2
        assert (await db.scalars(select(models.AuditLog).where(models.AuditLog.target_table == 'device_relationships'))).all() == []


@pytest.mark.asyncio
async def test_self_relationship_is_still_rejected(link_context):
    c = link_context
    response = await c['client'].post(f"/api/v1/devices/{c['owner']}/relationships", headers=c['headers'],
                                      json={'target_device_id': str(c['owner'])})
    assert response.status_code == 400
