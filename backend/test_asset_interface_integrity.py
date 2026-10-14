"""Asset interface reads enforce both endpoint scopes without per-port queries."""
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import event

from app.api.devices import get_device_interfaces
from app.database import get_db
from app.main import app
from app.models import models
from test_chg13_authorization_security import _tenant_db


@pytest_asyncio.fixture
async def interface_context(seeded_admin_tenant, setup_db):
    tenant_id = seeded_admin_tenant['tenant_id']
    async with _tenant_db(setup_db, tenant_id) as db:
        owner = models.Device(name='Interface owner', tenant_id=tenant_id)
        peer = models.Device(name='Archived peer', tenant_id=tenant_id, is_deleted=True)
        foreign = models.Device(name='Foreign confidential peer', tenant_id=tenant_id + 100)
        db.add_all([owner, peer, foreign])
        await db.flush()
        ports = ['forward', 'reverse', 'foreign-forward', 'foreign-reverse', 'custom-forward', 'custom-reverse', 'self-a', 'self-b', 'unconnected']
        for index, port in enumerate(ports):
            db.add(models.NetworkInterface(device_id=owner.id, name=port, ip_address=f'192.0.2.{index + 1}',
                                            mac_address=f'02:00:00:00:00:{index:02x}', vlan_id=100 + index, link_speed_gbps=25))
        db.add(models.NetworkInterface(device_id=foreign.id, name='Confidential interface', ip_address='198.51.100.10'))
        definitions = [
            ('forward', owner.id, 'forward', peer.id, 'peer-forward'),
            ('reverse', peer.id, 'peer-reverse', owner.id, 'reverse'),
            ('foreign-forward', owner.id, 'foreign-forward', foreign.id, 'secret-a'),
            ('foreign-reverse', foreign.id, 'secret-b', owner.id, 'foreign-reverse'),
            ('custom-forward', owner.id, 'custom-forward', None, 'external-a'),
            ('custom-reverse', None, 'external-b', owner.id, 'custom-reverse'),
            ('self', owner.id, 'self-a', owner.id, 'self-b'),
            ('duplicate', owner.id, 'forward', peer.id, 'later-duplicate'),
        ]
        connections = {}
        for label, source, source_port, target, target_port in definitions:
            connection = models.PortConnection(
                source_device_id=source, source_port=source_port, target_device_id=target, target_port=target_port,
                source_ip='192.0.2.100', target_ip='198.51.100.100', source_mac='02:00:00:00:01:01',
                target_mac='02:00:00:00:01:02', source_vlan=101, target_vlan=202,
                direction='Bidirectional', unit='Gbps', link_type='Fiber', purpose=label, speed_gbps=25, status='Active',
            )
            db.add(connection)
            await db.flush()
            connections[label] = {field: getattr(connection, field) for field in [
                'id', 'source_device_id', 'target_device_id', 'source_port', 'target_port', 'source_ip', 'target_ip',
                'source_mac', 'target_mac', 'source_vlan', 'target_vlan', 'direction', 'unit', 'link_type', 'purpose', 'speed_gbps',
            ]}
        await db.commit()
        context = {
            'client': seeded_admin_tenant['client'], 'tenant_id': tenant_id, 'owner': owner.id, 'peer': peer.id,
            'foreign': foreign.id, 'connections': connections, 'ports': ports,
            'headers': {'X-User-Id': 'admin_root', 'X-Tenant-Id': str(tenant_id)},
        }
    override = app.dependency_overrides.pop(get_db)
    try:
        yield context
    finally:
        app.dependency_overrides[get_db] = override


@pytest.mark.asyncio
@pytest.mark.parametrize('identity', ['foreign', 'missing', 'zero', 'negative', 'overflow'])
async def test_interface_parent_must_be_authorized(interface_context, identity):
    c = interface_context
    identity = {'foreign': c['foreign'], 'missing': 90000, 'zero': 0, 'negative': -1, 'overflow': 2 ** 63}[identity]
    response = await c['client'].get(f'/api/v1/devices/{identity}/interfaces', headers=c['headers'])
    assert response.status_code == 404, response.text
    assert 'Confidential' not in response.text and '198.51.100.10' not in response.text


@pytest.mark.asyncio
async def test_interface_projection_hides_foreign_peers_and_retains_both_directions_and_custom_ip(interface_context):
    c = interface_context
    response = await c['client'].get(f"/api/v1/devices/{c['owner']}/interfaces", headers=c['headers'])
    assert response.status_code == 200, response.text
    rows = {row['name']: row for row in response.json()}
    assert set(rows) == set(c['ports'])
    assert all(rows[port]['connection'] is None for port in ['foreign-forward', 'foreign-reverse', 'unconnected'])
    assert 'confidential' not in response.text.lower() and 'secret-a' not in response.text and 'secret-b' not in response.text
    for port, label, local_side, peer_name in [
        ('forward', 'forward', 'source', 'Archived peer'), ('reverse', 'reverse', 'target', 'Archived peer'),
        ('custom-forward', 'custom-forward', 'source', 'Unknown'), ('custom-reverse', 'custom-reverse', 'target', 'Unknown'),
        ('self-a', 'self', 'source', 'Interface owner'), ('self-b', 'self', 'target', 'Interface owner'),
    ]:
        source = c['connections'][label]
        peer_side = 'target' if local_side == 'source' else 'source'
        expected = {**source, 'peer_device_id': source[f'{peer_side}_device_id'], 'peer_device_name': peer_name,
                    'peer_port': source[f'{peer_side}_port'], 'status': 'Connected'}
        expected.update({f'peer_{field}': source[f'{peer_side}_{field}'] for field in ['ip', 'mac', 'vlan']})
        expected.update({f'local_{field}': source[f'{local_side}_{field}'] for field in ['ip', 'mac', 'vlan']})
        assert rows[port]['connection'] == expected
    for index, port in enumerate(c['ports']):
        assert rows[port]['device_id'] == c['owner']
        assert rows[port]['ip_address'] == f'192.0.2.{index + 1}'
        assert rows[port]['vlan_id'] == 100 + index and rows[port]['link_speed_gbps'] == 25


@pytest.mark.asyncio
async def test_loopback_connection_projects_the_matching_local_port(interface_context):
    c = interface_context
    response = await c['client'].get(f"/api/v1/devices/{c['owner']}/interfaces", headers=c['headers'])
    assert response.status_code == 200
    rows = {row['name']: row['connection'] for row in response.json()}
    assert rows['self-a']['peer_port'] == 'self-b' and rows['self-a']['local_vlan'] == 101
    assert rows['self-b']['peer_port'] == 'self-a' and rows['self-b']['local_vlan'] == 202


@pytest.mark.asyncio
async def test_archived_authorized_interface_history_remains_readable(interface_context, setup_db):
    c = interface_context
    async with _tenant_db(setup_db, c['tenant_id']) as db:
        (await db.get(models.Device, c['owner'])).is_deleted = True
        await db.commit()
    response = await c['client'].get(f"/api/v1/devices/{c['owner']}/interfaces", headers=c['headers'])
    assert response.status_code == 200 and len(response.json()) == len(c['ports'])


@pytest.mark.asyncio
@pytest.mark.parametrize('port_count', [1, 40, 600])
async def test_interface_read_queries_do_not_grow_per_port(seeded_admin_tenant, setup_db, port_count, record_property):
    tenant_id = seeded_admin_tenant['tenant_id']
    async with _tenant_db(setup_db, tenant_id) as db:
        owner = models.Device(name='Measured owner', tenant_id=tenant_id)
        peer = models.Device(name='Measured peer', tenant_id=tenant_id)
        db.add_all([owner, peer])
        await db.flush()
        for index in range(port_count):
            db.add(models.NetworkInterface(device_id=owner.id, name=f'eth{index}'))
            db.add(models.PortConnection(source_device_id=owner.id, source_port=f'eth{index}',
                                         target_device_id=peer.id, target_port=f'peer{index}', speed_gbps=25))
        await db.commit()
        engine = db.bind.sync_engine
        statements = []

        def count_select(_connection, _cursor, statement, _parameters, _context, _executemany):
            if statement.lstrip().upper().startswith('SELECT'):
                statements.append(statement)

        event.listen(engine, 'before_cursor_execute', count_select)
        try:
            rows = await get_device_interfaces(SimpleNamespace(state=SimpleNamespace(tenant_id=tenant_id)), owner.id, db)
        finally:
            event.remove(engine, 'before_cursor_execute', count_select)
        record_property('port_count', port_count)
        record_property('select_count', len(statements))
        assert len(rows) == port_count
        for index, row in enumerate(rows):
            assert row['name'] == f'eth{index}'
            assert row['connection']['peer_device_id'] == peer.id
            assert row['connection']['peer_device_name'] == 'Measured peer'
            assert row['connection']['peer_port'] == f'peer{index}'
        assert len(statements) <= 3, f'{port_count} ports caused {len(statements)} SELECTs'
