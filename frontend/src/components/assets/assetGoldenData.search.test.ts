import { describe, expect, it } from 'vitest'
import { matchesTerm } from './assetGoldenData'

describe('asset registry search identifiers', () => {
  const knownAsset = {
    name: 'QUAL-SYNTH-SW-001',
    asset_tag: 'QUAL-ASSET-001',
    serial_number: 'QUAL-SERIAL-001',
    system: 'Qualification Sandbox',
    manufacturer: 'Synthetic Fixture',
  }

  it('finds an asset by its asset tag or serial number, case-insensitively', () => {
    expect(matchesTerm(knownAsset, 'qual-asset-001')).toBe(true)
    expect(matchesTerm(knownAsset, 'QUAL-SERIAL-001')).toBe(true)
  })

  it('retains existing name, system, manufacturer, and model matching', () => {
    expect(matchesTerm(knownAsset, 'QUAL-SYNTH-SW-001')).toBe(true)
    expect(matchesTerm(knownAsset, 'Qualification Sandbox')).toBe(true)
    expect(matchesTerm(knownAsset, 'Synthetic Fixture')).toBe(true)
    expect(matchesTerm({ ...knownAsset, model: 'Qualification Device' }, 'Qualification Device')).toBe(true)
  })
})
