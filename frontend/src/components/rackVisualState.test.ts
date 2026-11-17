import { describe, expect, it } from 'vitest'
import { getRackDeviceTypeTone, getRackUnitStatusKey } from './rackVisualState'

describe('rack visual state', () => {
  it.each([
    ['Physical', 'physical'],
    ['Virtual Machine', 'virtual'],
    ['SAN Array', 'storage'],
    ['Network Switch', 'switch'],
    ['Compute Node', 'server'],
    ['Physical Server', 'server'],
    ['unknown category', 'unknown'],
  ] as const)('maps the asset type %s to the rack palette %s', (type, expected) => {
    expect(getRackDeviceTypeTone(type)).toBe(expected)
  })

  it('retains semantic status independently from the type palette', () => {
    expect(getRackUnitStatusKey({ type: 'server', status: 'Maintenance' })).toBe('maintenance')
    expect(getRackUnitStatusKey({ type: 'switch', status: 'Active' })).toBe('active')
    expect(getRackUnitStatusKey({ is_reservation: true, status: 'Active' })).toBe('reserved')
  })
})
