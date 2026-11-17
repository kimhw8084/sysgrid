import { describe, expect, it } from 'vitest'
import { searchRackCollection } from './rackSearch'

const racks = [
  {
    id: 7,
    name: 'RACK-A',
    site_name: 'North Campus',
    aisle: 'A1',
    row: '03',
    device_locations: [{ device_id: 42, start_unit: 4, device: { id: 42, name: 'Compute node' } }],
  },
  {
    id: 8,
    name: 'RACK-B',
    site_name: 'South Campus',
    aisle: 'B2',
    row: '03',
    device_locations: [{ device_id: 99, start_unit: 5, device: { id: 99, name: 'Other node' } }],
  },
]

const devices = [
  { id: 42, serial_number: 'SN-42-X', asset_tag: 'AST-0042', system: 'Payments', manufacturer: 'Acme', model: 'Edge 4' },
  { id: 99, serial_number: 'SN-99-X', asset_tag: 'AST-0099', system: 'Analytics', manufacturer: 'Other', model: 'Edge 9' },
  { id: 123, serial_number: 'UNMOUNTED-SECRET', asset_tag: 'AST-0123', system: 'Payments' },
]

describe('searchRackCollection', () => {
  it('matches rack, site, aisle, row, and mounted device identifiers and context', () => {
    expect(searchRackCollection(racks, 'north campus', devices).map(result => result.rack.id)).toEqual([7])
    expect(searchRackCollection(racks, 'A1 03', devices).map(result => result.rack.id)).toEqual([7])
    expect(searchRackCollection(racks, 'SN-42-X', devices)[0]?.matchedDeviceIds).toEqual(['42'])
    expect(searchRackCollection(racks, 'AST-0042', devices)[0]?.matchedDeviceIds).toEqual(['42'])
    expect(searchRackCollection(racks, 'Payments', devices)[0]?.matchedDeviceIds).toEqual(['42'])
  })

  it('does not match a rack through an unrelated, unmounted device', () => {
    expect(searchRackCollection(racks, 'UNMOUNTED-SECRET', devices)).toEqual([])
  })

  it('supports case and diacritic-insensitive search and multi-token filtering', () => {
    const localized = [{ id: 1, name: 'Räck Nordic', site_name: 'Étage 2', device_locations: [] }]
    expect(searchRackCollection(localized, 'rack nordic', devices)).toHaveLength(1)
    expect(searchRackCollection(localized, 'rack missing', devices)).toHaveLength(0)
  })

  it('preserves the full collection for an empty query without inventing asset highlights', () => {
    const result = searchRackCollection(racks, '   ', devices)
    expect(result.map(item => item.rack.id)).toEqual([7, 8])
    expect(result[0]?.matchedDeviceIds).toEqual([])
  })
})
