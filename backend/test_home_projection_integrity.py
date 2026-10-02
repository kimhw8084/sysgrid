"""Home projections must obey registry ownership and conserve grouped counts."""
import itertools

import pytest
import pytest_asyncio

from app.core.config import settings
from app.models import models
from test_chg13_authorization_security import _tenant_db
from test_service_relationship_authority import service_scope


@pytest_asyncio.fixture
async def home_scope(service_scope, setup_db):
    c = service_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        connections = {}
        for label, source, target, state in [
            ('owned', 'owned', 'peer', 'Active'),
            ('custom-peer', 'owned', None, None),
            ('custom-only', None, None, 'Down'),
            ('owned-history', 'archived', 'peer', 'Active'),
            ('foreign-source', 'foreign', 'peer', 'Active'),
            ('foreign-target', 'owned', 'foreign', 'Active'),
            ('foreign-both', 'foreign', 'foreign', 'Active'),
            ('deleted', 'owned', 'peer', 'Deleted'),
        ]:
            row = models.PortConnection(source_device_id=c['devices'].get(source), target_device_id=c['devices'].get(target),
                source_port=f'HomeAuthority-{label}', target_port='peer', link_type='Ethernet',
                purpose=f'HomeAuthority {label}', status=state)
            db.add(row); await db.flush(); connections[label] = row.id
        active, archived = models.Rack(name='Active Home rack'), models.Rack(name='Archived Home rack', is_deleted=True)
        db.add_all([active, archived]); await db.flush()
        for index, (device, rack) in enumerate([('owned', active), ('foreign', active), ('archived', active), ('peer', archived)]):
            db.add(models.DeviceLocation(device_id=c['devices'][device], rack_id=rack.id, start_unit=index + 1, size_u=1))
        await db.commit()
    return {**c, 'connections': connections}


@pytest.mark.asyncio
@pytest.mark.parametrize('root', [False, True])
@pytest.mark.parametrize('overview,path', [('asset_overview', '/devices'), ('service_overview', '/logical-services'),
                                         ('network_overview', '/networks/connections')])
async def test_home_counts_match_authorized_active_registry(home_scope, monkeypatch, root, overview, path):
    c = home_scope
    monkeypatch.setattr(settings, 'SYSTEM_ROOT_USER_IDS', 'admin_root' if root else '')
    registry = await c['client'].get('/api/v1' + path, headers=c['headers'])
    assert registry.status_code == 200, registry.text
    response = await c['client'].get('/api/v1/dashboard/metrics', headers=c['headers'])
    assert response.status_code == 200, response.text
    value = response.json()[overview]
    assert value['total'] == len(registry.json()), response.text
    assert value['truth']['value'] == value['total'] and value['truth']['available'] is True
    assert sum(sum(states.values()) for states in value['breakdown'].values()) == value['total']


@pytest.mark.asyncio
async def test_home_racked_asset_count_excludes_foreign_and_archived_records(home_scope):
    c = home_scope
    response = await c['client'].get('/api/v1/dashboard/metrics', headers=c['headers'])
    assert response.status_code == 200, response.text
    rack = response.json()['rack_overview']
    assert rack['total_racked_assets'] == 1 and rack['truth']['total_racked_assets']['value'] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('root', [False, True])
@pytest.mark.parametrize('query', ['foreign', 'Confidential'])
async def test_home_search_does_not_reveal_foreign_parent_records(home_scope, monkeypatch, root, query):
    c = home_scope
    monkeypatch.setattr(settings, 'SYSTEM_ROOT_USER_IDS', 'admin_root' if root else '')
    response = await c['client'].get('/api/v1/dashboard/search', params={'q': query}, headers=c['headers'])
    assert response.status_code == 200 and response.json()['results'] == [], response.text
    allowed = await c['client'].get('/api/v1/dashboard/search', params={'q': 'owned service'}, headers=c['headers'])
    assert allowed.status_code == 200, allowed.text
    assert any(row['type'] == 'service' and row['id'] == c['rows']['owned'] for row in allowed.json()['results'])


@pytest.mark.asyncio
async def test_home_network_search_preserves_owned_history_and_excludes_deleted(home_scope):
    c = home_scope
    response = await c['client'].get('/api/v1/dashboard/search', params={'q': 'HomeAuthority'}, headers=c['headers'])
    assert response.status_code == 200, response.text
    ids = {row['id'] for row in response.json()['results'] if row['type'] == 'network'}
    assert ids == {c['connections']['owned'], c['connections']['owned-history']}


@pytest.mark.asyncio
@pytest.mark.parametrize('model,dimension,overview', [
    (models.Device, 'type', 'asset_overview'), (models.LogicalService, 'service_type', 'service_overview'),
    (models.PortConnection, 'link_type', 'network_overview'), (models.MonitoringItem, 'platform', 'monitoring_overview'),
])
async def test_home_grouping_conserves_null_empty_and_literal_unknown_records(service_scope, setup_db, model, dimension, overview):
    c = service_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        for index, (kind, state) in enumerate(itertools.product([None, '', 'Unknown'], repeat=2)):
            values = {dimension: kind, 'status': state}
            if model is models.Device:
                values.update(name=f'Grouped asset {index}', tenant_id=c['tenant'])
            elif model is models.LogicalService:
                values.update(name=f'Grouped service {index}')
            elif model is models.MonitoringItem:
                values.update(title=f'Grouped monitor {index}')
            else:
                values.update(source_device_id=c['devices']['owned'], target_device_id=c['devices']['peer'])
            db.add(model(**values))
        await db.commit()
    response = await c['client'].get('/api/v1/dashboard/metrics', headers=c['headers'])
    assert response.status_code == 200, response.text
    value = response.json()[overview]
    assert value['breakdown']['Unknown']['Unknown'] >= 9
    assert sum(sum(states.values()) for states in value['breakdown'].values()) == value['total']
