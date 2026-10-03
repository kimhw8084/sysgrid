"""Firewall definitions cannot rewrite ORM identity, ownership or lifecycle metadata."""
import asyncio
import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.models import models
from app.database import get_db
from app.main import app
from test_chg13_authorization_security import _grant_access, _seed_operator, _tenant_db


@pytest_asyncio.fixture
async def firewall_context(seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant['tenant_id']
    async with _tenant_db(setup_db, tenant_id) as db:
        device = models.Device(name='Firewall asset', system='Test', tenant_id=tenant_id)
        foreign = models.Device(name='Wrong logical tenant', system='Test', tenant_id=tenant_id + 100)
        archived = models.Device(name='Archived asset', system='Test', tenant_id=tenant_id, is_deleted=True)
        subnet = models.Subnet(name='Firewall subnet', network_cidr='10.33.0.0/24')
        db.add_all([device, foreign, archived, subnet])
        await db.flush()
        rule = models.FirewallRule(name='Retained definition', source_type='Device', source_device_id=device.id,
                                   dest_type='Any', protocol='TCP', port_range='443', created_by_user_id='original-author')
        db.add(rule)
        await db.commit()
        context = {
            'client': seeded_admin_tenant['client'], 'tenant_id': tenant_id,
            'headers': {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(tenant_id)},
            'rule_id': rule.id, 'device_id': device.id, 'subnet_id': subnet.id,
            'foreign_id': foreign.id, 'archived_id': archived.id,
        }
    # Exercise the production tenant/write guard against setup_db's temporary
    # registry. The general legacy override omits its VIEWER write rejection.
    override = app.dependency_overrides.pop(get_db)
    try:
        yield context
    finally:
        app.dependency_overrides[get_db] = override


@pytest.mark.asyncio
@pytest.mark.parametrize('field,value', [
    ('id', 4000), ('is_deleted', True), ('created_by_user_id', 'forged-author'),
    ('created_at', '2000-01-01T00:00:00'), ('updated_at', '2000-01-01T00:00:00'),
    ('source_device', {'id': 4000}),
])
async def test_update_ignores_non_editable_projection_fields(firewall_context, setup_db, field, value):
    c = firewall_context
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        before = await db.get(models.FirewallRule, c['rule_id'])
        created_at = before.created_at
    response = await c['client'].put(f"/api/v1/security/firewall/{c['rule_id']}", headers=c['headers'],
                                     json={'name': 'Allowed edit', field: value})
    assert response.status_code == 200, response.text
    assert response.json()['id'] == c['rule_id']
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        rule = await db.get(models.FirewallRule, c['rule_id'])
        assert rule.name == 'Allowed edit'
        assert rule.is_deleted is False
        assert rule.created_by_user_id == 'original-author'
        assert rule.created_at == created_at
        assert rule.updated_at.year != 2000
        assert rule.source_device_id == c['device_id']


@pytest.mark.asyncio
@pytest.mark.parametrize('field,value', [
    ('name', {'unexpected': 'object'}), ('protocol', True),
    ('source_device_id', True), ('source_device_id', 1.5),
    ('source_device_id', 2 ** 63), ('dest_subnet_id', 'invalid'),
])
@pytest.mark.parametrize('operation', ['create', 'update'])
async def test_invalid_types_fail_before_mutation(firewall_context, setup_db, field, value, operation):
    c = firewall_context
    path = '/api/v1/security/firewall'
    if operation == 'update':
        path += f"/{c['rule_id']}"
    response = await c['client'].request('POST' if operation == 'create' else 'PUT', path,
                                         headers=c['headers'], json={'name': 'Should not persist', field: value})
    assert response.status_code == 422, response.text
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        rows = (await db.scalars(select(models.FirewallRule))).all()
        assert len(rows) == 1 and rows[0].name == 'Retained definition'


@pytest.mark.asyncio
@pytest.mark.parametrize('field', ['source_device_id', 'dest_device_id', 'source_subnet_id', 'dest_subnet_id'])
@pytest.mark.parametrize('operation', ['create', 'update'])
async def test_new_references_must_exist_in_the_tenant(firewall_context, setup_db, field, operation):
    c = firewall_context
    path = '/api/v1/security/firewall' + (f"/{c['rule_id']}" if operation == 'update' else '')
    response = await c['client'].request('POST' if operation == 'create' else 'PUT', path,
                                         headers=c['headers'], json={'name': 'Should not persist', field: 900000})
    assert response.status_code == 404, response.text
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        rows = (await db.scalars(select(models.FirewallRule))).all()
        assert len(rows) == 1 and rows[0].name == 'Retained definition'


@pytest.mark.asyncio
@pytest.mark.parametrize('reference', ['foreign_id', 'archived_id'])
async def test_new_device_links_exclude_wrong_tenant_and_archived_assets(firewall_context, reference):
    c = firewall_context
    response = await c['client'].post('/api/v1/security/firewall', headers=c['headers'],
                                      json={'name': 'Invalid scope', 'dest_device_id': c[reference]})
    assert response.status_code == 404, response.text


@pytest.mark.asyncio
async def test_create_edit_detach_archive_and_retry_preserve_audit_lineage(firewall_context, setup_db):
    c = firewall_context
    created = await c['client'].post('/api/v1/security/firewall', headers=c['headers'], json={
        'name': 'Audited definition', 'source_type': 'Device', 'source_device_id': c['device_id'],
        'dest_type': 'Subnet', 'dest_subnet_id': c['subnet_id'], 'port_range': '443,8443',
        'id': 4000, 'created_by_user_id': 'forged-author', 'is_deleted': True,
    })
    assert created.status_code == 200, created.text
    row = created.json()
    assert row['id'] != 4000 and row['protocol'] == 'TCP'
    assert row['source_device_name'] == 'Firewall asset'
    assert row['dest_subnet_name'] == 'Firewall subnet'
    path = f"/api/v1/security/firewall/{row['id']}"
    edited = await c['client'].put(path, headers=c['headers'], json={**row, 'risk': 'Business impact', 'source_device_id': None})
    assert edited.status_code == 200, edited.text
    assert edited.json()['source_device_id'] is None and edited.json()['source_device_name'] is None
    assert edited.json()['dest_subnet_id'] == c['subnet_id']
    # A read projection can round-trip without a second semantic edit.
    repeated = await c['client'].put(path, headers=c['headers'], json=edited.json())
    assert repeated.status_code == 200
    for _ in range(2):
        archived = await c['client'].delete(path, headers=c['headers'])
        assert archived.status_code == 200 and archived.json() == {'status': 'success'}
    listed = await c['client'].get('/api/v1/security/firewall', headers=c['headers'])
    assert row['id'] not in [item['id'] for item in listed.json()]
    retained = await c['client'].get('/api/v1/security/firewall?include_deleted=true', headers=c['headers'])
    assert row['id'] in [item['id'] for item in retained.json()]
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        stored = await db.get(models.FirewallRule, row['id'])
        assert stored.created_by_user_id == 'admin_root' and stored.is_deleted is True
        audit = (await db.scalars(select(models.AuditLog).where(models.AuditLog.target_table == 'firewall_rules',
                                 models.AuditLog.target_id == str(row['id'])).order_by(models.AuditLog.id))).all()
        assert [entry.action for entry in audit] == ['CREATE', 'UPDATE', 'ARCHIVE']
        assert all(entry.user_id == 'admin_root' for entry in audit)
        assert audit[1].changes['source_device_id'] == {'before': c['device_id'], 'after': None}


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update', 'archive'])
async def test_audit_failure_rolls_back_the_domain_mutation(firewall_context, setup_db, operation):
    c = firewall_context

    def fail_audit(session, *_):
        if any(isinstance(row, models.AuditLog) and row.target_table == 'firewall_rules' for row in session.new):
            raise RuntimeError('controlled firewall audit failure')

    event.listen(Session, 'before_flush', fail_audit)
    try:
        with pytest.raises(RuntimeError, match='controlled firewall audit failure'):
            if operation == 'create':
                await c['client'].post('/api/v1/security/firewall', headers=c['headers'], json={'name': 'Not committed'})
            elif operation == 'update':
                await c['client'].put(f"/api/v1/security/firewall/{c['rule_id']}", headers=c['headers'], json={'name': 'Not committed'})
            else:
                await c['client'].delete(f"/api/v1/security/firewall/{c['rule_id']}", headers=c['headers'])
    finally:
        event.remove(Session, 'before_flush', fail_audit)
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        rows = (await db.scalars(select(models.FirewallRule))).all()
        assert len(rows) == 1 and rows[0].name == 'Retained definition' and rows[0].is_deleted is False
        assert (await db.scalars(select(models.AuditLog).where(models.AuditLog.target_table == 'firewall_rules'))).all() == []


@pytest.mark.asyncio
@pytest.mark.parametrize('role,permissions', [('VIEWER', {'assets': 3}), ('EDITOR', {'assets': 1})])
async def test_mutations_require_both_tenant_write_and_asset_capability(firewall_context, setup_db, role, permissions):
    c = firewall_context
    user = 'limited-firewall-user'
    await _grant_access(setup_db, tenant_id=c['tenant_id'], user_id=user, role=role)
    await _seed_operator(setup_db, c['tenant_id'], user, role_permissions=permissions)
    headers = {**c['headers'], 'X-User-Id': user}
    path = f"/api/v1/security/firewall/{c['rule_id']}"
    for method, url, body in [('POST', '/api/v1/security/firewall', {'name': 'Denied'}),
                              ('PUT', path, {'name': 'Denied'}), ('DELETE', path, None)]:
        response = await c['client'].request(method, url, headers=headers, json=body)
        assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_concurrent_archive_records_one_transition(firewall_context, setup_db):
    c = firewall_context
    path = f"/api/v1/security/firewall/{c['rule_id']}"
    responses = await asyncio.gather(*(c['client'].delete(path, headers=c['headers']) for _ in range(2)))
    assert [response.status_code for response in responses] == [200, 200]
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        assert (await db.get(models.FirewallRule, c['rule_id'])).is_deleted is True
        audit = (await db.scalars(select(models.AuditLog).where(models.AuditLog.target_table == 'firewall_rules'))).all()
        assert len(audit) == 1 and audit[0].action == 'ARCHIVE'


@pytest.mark.asyncio
async def test_existing_legacy_references_do_not_block_unrelated_edits(firewall_context, setup_db):
    c = firewall_context
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        rule = await db.get(models.FirewallRule, c['rule_id'])
        rule.source_device_id = c['archived_id']
        await db.commit()
    response = await c['client'].put(f"/api/v1/security/firewall/{c['rule_id']}", headers=c['headers'],
                                     json={'name': 'Historical definition', 'source_device_id': c['archived_id']})
    assert response.status_code == 200, response.text
    assert response.json()['source_device_id'] == c['archived_id']


@pytest.mark.asyncio
async def test_reference_removed_after_validation_returns_conflict_without_a_partial_write(firewall_context, setup_db, monkeypatch):
    from app.api import security

    c = firewall_context
    original = security.validate_firewall_references

    async def remove_after_validation(request, db, data, existing=None):
        await original(request, db, data, existing)
        async with _tenant_db(setup_db, c['tenant_id']) as competing:
            await competing.delete(await competing.get(models.Subnet, c['subnet_id']))
            await competing.commit()

    monkeypatch.setattr(security, 'validate_firewall_references', remove_after_validation)
    response = await c['client'].post('/api/v1/security/firewall', headers=c['headers'],
                                      json={'name': 'Racing definition', 'source_subnet_id': c['subnet_id']})
    assert response.status_code == 409, response.text
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        rules = (await db.scalars(select(models.FirewallRule))).all()
        assert len(rules) == 1 and rules[0].name == 'Retained definition'
        assert (await db.scalars(select(models.AuditLog).where(models.AuditLog.target_table == 'firewall_rules'))).all() == []
