"""Populated rack reads must not issue a query per rack or placed device."""
import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.api.racks import get_racks
from app.database import get_tenant_engine
from app.models.config import Tenant
from app.models.models import Device, DeviceLocation, Rack, Room, Site


@pytest.mark.asyncio
@pytest.mark.parametrize('rack_count', [1, 40])
async def test_populated_rack_query_count_is_bounded(seeded_admin_tenant, setup_db, rack_count, record_property):
    async with setup_db[1]() as config:
        tenant = await config.get(Tenant, seeded_admin_tenant['tenant_id'])
        engine = get_tenant_engine(tenant.db_url)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        site = Site(name='Capacity fixture', color='#123456')
        room = Room(name='Room A', site=site)
        db.add(site)
        db.add(room)
        for index in range(rack_count):
            rack = Rack(name=f'Rack {index}', room=room, order_index=rack_count - index, total_u_height=42)
            db.add(rack)
            for unit in range(1, 4):
                device = Device(name=f'Host {index}-{unit}', type='Physical', status='Active', power_typical_w=125, power_max_w=250)
                db.add(DeviceLocation(rack=rack, device=device, start_unit=unit, size_u=1, orientation='Rear', depth='Half'))
        archived = Rack(name='Archived', room=room, is_deleted=True)
        unassigned = Rack(name='Stored', last_site_name='Previous site', order_index=100)
        db.add_all([archived, unassigned])
        await db.commit()
        site_id = site.id

    statements = []
    def count_select(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith('SELECT'):
            statements.append(statement)

    event.listen(engine.sync_engine, 'before_cursor_execute', count_select)
    try:
        async with sessions() as db:
            rows = await get_racks(site_id=str(site_id), db=db)
    finally:
        event.remove(engine.sync_engine, 'before_cursor_execute', count_select)
    record_property('rack_count', rack_count)
    record_property('placed_device_count', rack_count * 3)
    record_property('select_count', len(statements))
    assert len(rows) == rack_count
    assert [row['name'] for row in rows] == [f'Rack {i}' for i in reversed(range(rack_count))]
    for row in rows:
        assert row['site_name'] == 'Capacity fixture'
        assert row['site_color'] == '#123456'
        assert len(row['device_locations']) == 3
        assert {location['start_unit'] for location in row['device_locations']} == {1, 2, 3}
        assert all(location['orientation'] == 'Rear' and location['depth'] == 'Half' for location in row['device_locations'])
        assert all(location['device']['power_typical_w'] == 125 and location['device']['power_max_w'] == 250 for location in row['device_locations'])
    assert len(statements) <= 2, f'{rack_count} racks caused {len(statements)} SELECTs'

    async with sessions() as db:
        missing = await get_racks(site_id='missing', db=db)
        assert len(missing) == 1
        assert missing[0]['site_name'] == 'Prev: Previous site'
        assert missing[0]['device_locations'] == []
        all_rows = await get_racks(include_deleted=True, db=db)
        assert {row['name'] for row in all_rows} == {f'Rack {i}' for i in range(rack_count)} | {'Archived', 'Stored'}
