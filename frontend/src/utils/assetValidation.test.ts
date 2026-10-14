import { describe, expect, it } from 'vitest'
import { buildAssetScalarErrors } from './assetValidation'

describe('asset editor scalar validation', () => {
  it.each([0, -1, 1.5, '1.5', 'invalid', NaN, Infinity, true, [], {}, Number.MAX_SAFE_INTEGER + 1])('rejects invalid rack height %j', value => {
    expect(buildAssetScalarErrors({ size_u: value })).toHaveProperty('size_u')
  })
  for (const field of ['power_typical_w', 'power_max_w'] as const) {
    it.each([-0.1, '-2', 'invalid', NaN, Infinity, true, [], {}])(`rejects invalid ${field} %j`, value => {
      expect(buildAssetScalarErrors({ [field]: value })).toHaveProperty(field)
    })
  }
  it('keeps blank defaults and finite decimal power compatible with the existing editor', () => {
    expect(buildAssetScalarErrors({})).toEqual({})
    expect(buildAssetScalarErrors({ size_u: '', power_typical_w: '', power_max_w: null })).toEqual({})
    expect(buildAssetScalarErrors({ size_u: '2', power_typical_w: '250.25', power_max_w: 450.5 })).toEqual({})
    expect(buildAssetScalarErrors({ size_u: Number.MAX_SAFE_INTEGER, power_typical_w: 0, power_max_w: Number.MAX_VALUE })).toEqual({})
  })
  it('reports every invalid field together', () => {
    expect(Object.keys(buildAssetScalarErrors({ size_u: 0, power_typical_w: -1, power_max_w: NaN })).sort())
      .toEqual(['power_max_w', 'power_typical_w', 'size_u'])
  })
})
