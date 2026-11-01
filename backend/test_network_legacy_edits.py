"""Retired configuration values never prevent an unrelated edit or admit new bad values."""
import pytest
from sqlalchemy import select
from app.models import models
from test_chg13_authorization_security import _tenant_db
from test_network_endpoint_authorization import network_scope, snapshot


async def ensure_setting_option(db, category, value, label):
    existing_id = await db.scalar(select(models.SettingOption.id).where(
        models.SettingOption.category == category,
        models.SettingOption.value == value,
    ))
    if existing_id is None:
        db.add(models.SettingOption(category=category, value=value, label=label))


@pytest.mark.asyncio
async def test_unrelated_edit_preserves_all_legacy_network_values(network_scope, setup_db):
    c = network_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        row = await db.get(models.PortConnection, c['rows']['owned'])
        row.link_type, row.farm, row.cable_type, row.direction = 'Production', 'HQ-01', 'Cat6', 'Ingress'
        for category, value in [('LinkPurpose', 'Data'), ('NetworkFarm', 'Prod'), ('NetworkCableType', 'Copper')]:
            await ensure_setting_option(db, category, value, value)
        await db.commit()
    response = await c['client'].put(f"/api/v1/networks/connections/{c['rows']['owned']}", headers=c['headers'],
        json={'purpose': 'Updated operator notes', 'link_type': 'Production', 'farm': 'HQ-01', 'cable_type': 'Cat6'})
    assert response.status_code == 200, response.text
    row = response.json()
    assert (row['link_type'], row['farm'], row['cable_type'], row['direction']) == ('Production', 'HQ-01', 'Cat6', 'Ingress')
    assert row['purpose'] == 'Updated operator notes'


@pytest.mark.asyncio
@pytest.mark.parametrize('field,category,valid', [('link_type', 'LinkPurpose', 'Data'), ('farm', 'NetworkFarm', 'Prod'), ('cable_type', 'NetworkCableType', 'Copper'), ('direction', None, None), ('unit', None, None)])
async def test_changed_invalid_value_is_rejected_without_mutation(network_scope, setup_db, field, category, valid):
    c = network_scope
    if category:
        async with _tenant_db(setup_db, c['tenant']) as db:
            await ensure_setting_option(db, category, valid, valid)
            await db.commit()
    before = await snapshot(c, setup_db)
    response = await c['client'].put(f"/api/v1/networks/connections/{c['rows']['owned']}", headers=c['headers'], json={field: 'Unconfigured value'})
    assert response.status_code == (422 if field in {'direction', 'unit'} else 400), response.text
    assert await snapshot(c, setup_db) == before


@pytest.mark.asyncio
async def test_legacy_port_collision_does_not_block_notes_but_new_collision_is_rejected(network_scope, setup_db):
    c = network_scope
    async with _tenant_db(setup_db, c['tenant']) as db:
        owned = await db.get(models.PortConnection, c['rows']['owned'])
        peer = await db.get(models.PortConnection, c['rows']['custom-target'])
        peer.source_port = owned.source_port
        await db.commit()
    response = await c['client'].put(f"/api/v1/networks/connections/{c['rows']['owned']}", headers=c['headers'], json={'purpose': 'Preserve historical endpoint'})
    assert response.status_code == 200, response.text
    before = await snapshot(c, setup_db)
    response = await c['client'].put(f"/api/v1/networks/connections/{c['rows']['owned']}", headers=c['headers'], json={'target_port': 'custom-source-target'})
    assert response.status_code == 400
    assert await snapshot(c, setup_db) == before
