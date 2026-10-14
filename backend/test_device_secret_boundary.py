"""Stored credential values require a scoped, authorized, audited reveal."""
import json

import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.models import models
from test_chg13_authorization_security import _grant_access, _seed_operator, _tenant_db


@pytest_asyncio.fixture
async def vault_context(seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant['tenant_id']
    async with _tenant_db(setup_db, tenant_id) as db:
        device = models.Device(name='Vault boundary asset', system='Test', tenant_id=tenant_id)
        db.add(device)
        await db.flush()
        secret = models.SecretVault(device_id=device.id, secret_type='Service Account', username='service-user', encrypted_payload='SYNTHETIC-VAULT-VALUE', notes='retained note')
        db.add(secret)
        await db.commit()
        return seeded_admin_tenant['client'], tenant_id, device.id, secret.id


def headers(tenant_id, user_id='admin_root'):
    return {'X-Tenant-Id': str(tenant_id), 'X-User-Id': user_id}


@pytest.mark.asyncio
@pytest.mark.parametrize('user_id,role,permissions', [
    ('admin_root', None, None),
    ('vault-viewer', 'VIEWER', {'assets': 1}),
    ('vault-editor', 'EDITOR', {'assets': 3, 'secrets': 2}),
    ('vault-read-only', 'VIEWER', {'assets': 3, 'secrets': 3}),
    ('vault-asset-reader', 'EDITOR', {'assets': 1, 'secrets': 3}),
])
async def test_lists_never_serialize_values(vault_context, setup_db, user_id, role, permissions):
    client, tenant_id, device_id, secret_id = vault_context
    if role:
        await _grant_access(setup_db, tenant_id=tenant_id, user_id=user_id, role=role)
        await _seed_operator(setup_db, tenant_id, user_id, role_permissions=permissions)
    for path in (f'/api/v1/devices/{device_id}/secrets', '/api/v1/security/vault'):
        response = await client.get(path, headers=headers(tenant_id, user_id))
        assert response.status_code == 200, response.text
        assert 'SYNTHETIC-VAULT-VALUE' not in response.text
        item = next(row for row in response.json() if row['id'] == secret_id)
        assert 'encrypted_payload' not in item
        assert item['has_payload'] is True
        assert item['can_reveal'] is (user_id == 'admin_root')
        assert item['can_manage'] is (user_id == 'admin_root')


@pytest.mark.asyncio
async def test_authorized_reveal_is_audited_and_not_cacheable(vault_context, setup_db):
    client, tenant_id, device_id, secret_id = vault_context
    response = await client.post(f'/api/v1/devices/{device_id}/secrets/{secret_id}/reveal', headers=headers(tenant_id))
    assert response.status_code == 200, response.text
    assert response.json() == {'value': 'SYNTHETIC-VAULT-VALUE'}
    assert response.headers['Cache-Control'] == 'no-store'
    async with _tenant_db(setup_db, tenant_id) as db:
        logs = (await db.scalars(select(models.AuditLog).where(models.AuditLog.target_table == 'secret_vault'))).all()
        assert len(logs) == 1
        assert logs[0].action == 'REVEAL'
        assert logs[0].target_id == str(secret_id)
        assert logs[0].user_id == 'admin_root'
        assert 'SYNTHETIC-VAULT-VALUE' not in json.dumps(logs[0].changes)


@pytest.mark.asyncio
async def test_editor_without_manage_cannot_reveal_or_mutate(vault_context, setup_db):
    client, tenant_id, device_id, secret_id = vault_context
    user_id = 'vault-limited-editor'
    await _grant_access(setup_db, tenant_id=tenant_id, user_id=user_id, role='EDITOR')
    await _seed_operator(setup_db, tenant_id, user_id, role_permissions={'assets': 3, 'secrets': 2})
    attempts = [
        ('POST', f'/api/v1/devices/{device_id}/secrets/{secret_id}/reveal', {}),
        ('POST', f'/api/v1/devices/{device_id}/secrets', {'secret_type': 'Root Password', 'encrypted_payload': 'denied'}),
        ('POST', '/api/v1/security/vault', {'device_id': device_id, 'secret_type': 'Root Password', 'payload': 'denied'}),
        ('PUT', f'/api/v1/devices/secrets/{secret_id}', {'encrypted_payload': 'denied'}),
        ('DELETE', f'/api/v1/devices/secrets/{secret_id}', None),
    ]
    for method, path, data in attempts:
        response = await client.request(method, path, headers=headers(tenant_id, user_id), json=data)
        assert response.status_code == 403, (path, response.text)
    async with _tenant_db(setup_db, tenant_id) as db:
        assert (await db.get(models.SecretVault, secret_id)).encrypted_payload == 'SYNTHETIC-VAULT-VALUE'
        assert len((await db.scalars(select(models.SecretVault))).all()) == 1


@pytest.mark.asyncio
async def test_reveal_requires_matching_asset_and_tenant(vault_context, setup_db):
    client, tenant_id, device_id, secret_id = vault_context
    response = await client.post(f'/api/v1/devices/{device_id + 100}/secrets/{secret_id}/reveal', headers=headers(tenant_id))
    assert response.status_code == 404
    response = await client.post(f'/api/v1/devices/{device_id}/secrets/{secret_id}/reveal', headers=headers(tenant_id, 'foreign-user'))
    assert response.status_code == 403
    assert 'SYNTHETIC-VAULT-VALUE' not in response.text
    async with _tenant_db(setup_db, tenant_id) as db:
        assert (await db.scalars(select(models.AuditLog).where(models.AuditLog.target_table == 'secret_vault'))).all() == []


@pytest.mark.asyncio
async def test_reveal_fails_closed_when_audit_cannot_commit(vault_context, setup_db):
    client, tenant_id, device_id, secret_id = vault_context

    def fail_audit(session, *_):
        if any(isinstance(row, models.AuditLog) and row.target_table == 'secret_vault' for row in session.new):
            raise RuntimeError('controlled vault audit failure')

    event.listen(Session, 'before_flush', fail_audit)
    try:
        with pytest.raises(RuntimeError, match='controlled vault audit failure'):
            await client.post(f'/api/v1/devices/{device_id}/secrets/{secret_id}/reveal', headers=headers(tenant_id))
    finally:
        event.remove(Session, 'before_flush', fail_audit)
    async with _tenant_db(setup_db, tenant_id) as db:
        assert (await db.scalars(select(models.AuditLog).where(models.AuditLog.target_table == 'secret_vault'))).all() == []
        assert (await db.get(models.SecretVault, secret_id)).encrypted_payload == 'SYNTHETIC-VAULT-VALUE'


@pytest.mark.asyncio
async def test_authorized_writes_return_metadata_and_preserve_unedited_value(vault_context, setup_db):
    client, tenant_id, device_id, secret_id = vault_context
    for path, data in [
        (f'/api/v1/devices/{device_id}/secrets', {'secret_type': 'SSH Key', 'encrypted_payload': 'NEW-SYNTHETIC-VALUE'}),
        ('/api/v1/security/vault', {'device_id': device_id, 'secret_type': 'SSH Key', 'payload': 'NEW-SYNTHETIC-VALUE'}),
    ]:
        response = await client.post(path, headers=headers(tenant_id), json=data)
        assert response.status_code == 200, response.text
        assert 'NEW-SYNTHETIC-VALUE' not in response.text
        assert response.json()['has_payload'] is True
    response = await client.put(f'/api/v1/devices/secrets/{secret_id}', headers=headers(tenant_id), json={'username': 'renamed-user', 'device_id': device_id + 100})
    assert response.status_code == 200
    assert 'SYNTHETIC-VAULT-VALUE' not in response.text
    async with _tenant_db(setup_db, tenant_id) as db:
        secret = await db.get(models.SecretVault, secret_id)
        assert secret.encrypted_payload == 'SYNTHETIC-VAULT-VALUE'
        assert secret.device_id == device_id
        assert secret.username == 'renamed-user'


@pytest.mark.asyncio
async def test_explicit_manage_capability_allows_non_admin_reveal(vault_context, setup_db):
    client, tenant_id, device_id, secret_id = vault_context
    await _grant_access(setup_db, tenant_id=tenant_id, user_id='vault-manager', role='EDITOR')
    await _seed_operator(setup_db, tenant_id, 'vault-manager', role_permissions={'assets': 2, 'secrets': 3})
    response = await client.post(f'/api/v1/devices/{device_id}/secrets/{secret_id}/reveal', headers=headers(tenant_id, 'vault-manager'))
    assert response.status_code == 200
    assert response.json()['value'] == 'SYNTHETIC-VAULT-VALUE'


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['create', 'update', 'delete'])
async def test_mutation_audit_failure_preserves_existing_records(vault_context, setup_db, operation):
    client, tenant_id, device_id, secret_id = vault_context

    def fail_audit(session, *_):
        if any(isinstance(row, models.AuditLog) and row.target_table == 'secret_vault' for row in session.new):
            raise RuntimeError('controlled vault audit failure')

    event.listen(Session, 'before_flush', fail_audit)
    try:
        with pytest.raises(RuntimeError, match='controlled vault audit failure'):
            if operation == 'create':
                await client.post(f'/api/v1/devices/{device_id}/secrets', headers=headers(tenant_id), json={'secret_type': 'SSH Key', 'encrypted_payload': 'uncommitted'})
            elif operation == 'update':
                await client.put(f'/api/v1/devices/secrets/{secret_id}', headers=headers(tenant_id), json={'encrypted_payload': 'uncommitted'})
            else:
                await client.delete(f'/api/v1/devices/secrets/{secret_id}', headers=headers(tenant_id))
    finally:
        event.remove(Session, 'before_flush', fail_audit)
    async with _tenant_db(setup_db, tenant_id) as db:
        rows = (await db.scalars(select(models.SecretVault))).all()
        assert len(rows) == 1
        assert rows[0].encrypted_payload == 'SYNTHETIC-VAULT-VALUE'
        assert (await db.scalars(select(models.AuditLog).where(models.AuditLog.target_table == 'secret_vault'))).all() == []


@pytest.mark.asyncio
async def test_unassigned_vault_metadata_remains_available(vault_context):
    client, tenant_id, _, _ = vault_context
    created = await client.post('/api/v1/security/vault', headers=headers(tenant_id), json={'secret_type': 'Service Account', 'payload': 'unassigned-synthetic-value'})
    assert created.status_code == 200, created.text
    assert 'unassigned-synthetic-value' not in created.text
    listed = await client.get('/api/v1/security/vault', headers=headers(tenant_id))
    assert any(row['id'] == created.json()['id'] and row['device_id'] is None for row in listed.json())
    assert 'unassigned-synthetic-value' not in listed.text
