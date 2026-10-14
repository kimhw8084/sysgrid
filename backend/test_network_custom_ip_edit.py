"""Preserved custom-IP links can be edited without treating nulls as asset IDs."""
import pytest
from sqlalchemy import select

from app.models import models
from test_chg13_authorization_security import _tenant_db
from test_network_endpoint_authorization import network_scope, snapshot


@pytest.mark.asyncio
@pytest.mark.parametrize('label', ['custom-source', 'custom-target', 'custom-both'])
@pytest.mark.parametrize('shared_port', [False, True])
async def test_custom_ip_metadata_edit_keeps_endpoints_and_ignores_unassigned_ports(network_scope, setup_db, label, shared_port):
    c = network_scope
    row_id = c['rows'][label]
    if shared_port:
        async with _tenant_db(setup_db, c['tenant']) as db:
            edited = await db.get(models.PortConnection, row_id)
            db.add(models.PortConnection(
                source_device_id=None, target_device_id=None,
                source_port=edited.source_port if edited.source_device_id is None else 'unrelated-source',
                target_port=edited.target_port if edited.target_device_id is None else 'unrelated-target',
                source_ip='203.0.113.1', target_ip='203.0.113.2',
                link_type='Data', status='Active', unit='Gbps', direction='Bidirectional',
            ))
            await db.commit()
    before, audits_before = await snapshot(c, setup_db)
    original = next(row for row in before if row['id'] == row_id)
    response = await c['client'].put(f'/api/v1/networks/connections/{row_id}', headers=c['headers'],
        json={'purpose': 'Updated custom link', 'source_ip': '192.0.2.99', 'target_vlan': 0})
    assert response.status_code == 200, response.text
    assert response.json()['purpose'] == 'Updated custom link'
    after, audits_after = await snapshot(c, setup_db)
    assert [r for r in before if r['id'] != row_id] == [r for r in after if r['id'] != row_id]
    updated = next(row for row in after if row['id'] == row_id)
    for key in ['source_device_id', 'target_device_id', 'source_port', 'target_port', 'target_ip']:
        assert updated[key] == original[key]
    assert updated['source_ip'] == '192.0.2.99' and updated['target_vlan'] == 0
    assert len(audits_after) == len(audits_before) + 1
    async with _tenant_db(setup_db, c['tenant']) as db:
        entry = (await db.scalars(select(models.AuditLog))).one()
        assert entry.target_id == str(row_id) and entry.changes == {'changed_fields': ['purpose', 'source_ip', 'target_vlan']}


@pytest.mark.asyncio
@pytest.mark.parametrize('label,side', [('custom-source', 'target'), ('custom-target', 'source')])
@pytest.mark.parametrize('endpoint_side', ['source', 'target'])
async def test_custom_link_still_rejects_occupied_real_asset_port(network_scope, setup_db, label, side, endpoint_side):
    c = network_scope
    occupied_device = c['devices']['source' if endpoint_side == 'source' else 'peer']
    before = await snapshot(c, setup_db)
    response = await c['client'].put(f"/api/v1/networks/connections/{c['rows'][label]}", headers=c['headers'],
        json={f'{side}_device_id': occupied_device, f'{side}_port': f'owned-{endpoint_side}'})
    assert response.status_code == 400 and 'cross-connected' in response.json()['detail'], response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_assigning_same_real_asset_to_custom_link_is_still_rejected(network_scope, setup_db):
    c = network_scope
    before = await snapshot(c, setup_db)
    response = await c['client'].put(f"/api/v1/networks/connections/{c['rows']['custom-both']}", headers=c['headers'],
        json={'source_device_id': c['devices']['source'], 'target_device_id': c['devices']['source']})
    assert response.status_code == 400 and 'different' in response.json()['detail'], response.text
    assert await snapshot(c, setup_db) == before
