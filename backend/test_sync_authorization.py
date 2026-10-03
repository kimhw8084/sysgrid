"""Existing subscriptions lose access when their tenant membership is revoked."""
import asyncio
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import delete, update

from app.main import ConnectionManager, authorized_sync_scopes, websocket_endpoint
from app.models.config import Tenant, UserTenantAccess


class Socket:
    def __init__(self):
        self.messages = []
        self.closed = []

    async def accept(self):
        pass

    async def send_text(self, message):
        self.messages.append(message)

    async def close(self, **kwargs):
        self.closed.append(kwargs)


@pytest.mark.asyncio
@pytest.mark.parametrize('revoke', ['membership', 'tenant'])
async def test_revocation_stops_existing_subscription_before_next_broadcast(seeded_admin_tenant, setup_db, revoke):
    _, sessions = setup_db
    tenant_id = seeded_admin_tenant['tenant_id']
    manager = ConnectionManager()
    socket = Socket()
    await manager.connect(socket, user_id='admin_root', tenant_id=tenant_id)
    await manager.broadcast('BEFORE', tenant_id=tenant_id)
    assert socket.messages == ['BEFORE']
    async with sessions() as db:
        if revoke == 'membership':
            await db.execute(delete(UserTenantAccess).where(UserTenantAccess.tenant_id == tenant_id))
        else:
            await db.execute(update(Tenant).where(Tenant.id == tenant_id).values(is_active=False))
        await db.commit()
    assert await authorized_sync_scopes({('admin_root', tenant_id)}) == set()
    await manager.broadcast('AFTER', tenant_id=tenant_id)
    assert socket.messages == ['BEFORE']
    assert socket.closed == [{'code': 1008, 'reason': 'Tenant access revoked'}]
    assert manager.active_connections == []


@pytest.mark.asyncio
async def test_authorization_store_failure_drops_subscription_without_false_save_failure(monkeypatch):
    monkeypatch.setattr('app.main.authorized_sync_scopes', AsyncMock(side_effect=RuntimeError('unavailable')))
    manager = ConnectionManager()
    socket = Socket()
    await manager.connect(socket, user_id='user', tenant_id=7)
    await manager.broadcast('CONFIG_UPDATED', tenant_id=7)
    assert socket.messages == []
    assert socket.closed[0]['code'] == 1011
    assert manager.active_connections == []


@pytest.mark.asyncio
async def test_idle_connection_rechecks_access_and_closes_when_revoked(monkeypatch):
    import app.main as main
    socket = Socket()
    socket.query_params = {'tenant_id': '7'}
    socket.headers = {}
    socket.receive_text = AsyncMock(side_effect=asyncio.TimeoutError)
    monkeypatch.setattr(main, 'websocket_origin_allowed', lambda _: True)
    monkeypatch.setattr(main.settings, 'IDENTITY_MODE', 'environment')
    monkeypatch.setattr(main, 'get_current_user_id', lambda _: 'user')
    access = AsyncMock(side_effect=[{('user', 7)}, set()])
    monkeypatch.setattr(main, 'authorized_sync_scopes', access)
    times = iter([0, 0, 31])
    monkeypatch.setattr(main, 'perf_counter', lambda: next(times))
    manager = ConnectionManager()
    monkeypatch.setattr(main, 'manager', manager)
    await websocket_endpoint(socket)
    assert access.await_count == 2
    assert socket.closed == [{'code': 1008, 'reason': 'Tenant access revoked'}]
    assert manager.active_connections == []


@pytest.mark.asyncio
async def test_cancelled_connection_is_removed_during_shutdown(monkeypatch):
    import app.main as main
    socket = Socket()
    socket.query_params = {'tenant_id': '7'}
    socket.headers = {}
    socket.receive_text = AsyncMock(side_effect=asyncio.CancelledError)
    monkeypatch.setattr(main, 'websocket_origin_allowed', lambda _: True)
    monkeypatch.setattr(main.settings, 'IDENTITY_MODE', 'environment')
    monkeypatch.setattr(main, 'get_current_user_id', lambda _: 'user')
    monkeypatch.setattr(main, 'authorized_sync_scopes', AsyncMock(return_value={('user', 7)}))
    manager = ConnectionManager()
    monkeypatch.setattr(main, 'manager', manager)
    with pytest.raises(asyncio.CancelledError):
        await websocket_endpoint(socket)
    assert manager.active_connections == []
