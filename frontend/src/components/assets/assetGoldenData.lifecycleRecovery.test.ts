import { describe, expect, it } from 'vitest'
import { revokePurgedAssetLifecycleOperation, type AssetLifecycleOperation } from './assetGoldenData'

const recovery = (ids: number[], targetLabels: string[]): AssetLifecycleOperation => Object.freeze({
  ids: Object.freeze(ids),
  originalAction: 'delete',
  inverseAction: 'restore',
  targetLabels: Object.freeze(targetLabels),
})

describe('revokePurgedAssetLifecycleOperation', () => {
  it('preserves the exact recovery when a purge has no overlapping IDs', () => {
    const operation = recovery([11, 12], ['Asset A', 'Asset B'])

    expect(revokePurgedAssetLifecycleOperation(operation, [13])).toBe(operation)
  })

  it('clears recovery when every tracked ID was purged', () => {
    expect(revokePurgedAssetLifecycleOperation(
      recovery([11, 12], ['Asset A', 'Asset B']),
      [12, 11],
    )).toBeNull()
  })

  it('keeps only unpurged IDs with their matching labels and inverse semantics', () => {
    const operation = recovery([11, 12, 13], ['Asset A', 'Asset B', 'Asset C'])

    expect(revokePurgedAssetLifecycleOperation(operation, [12])).toEqual({
      ids: [11, 13],
      originalAction: 'delete',
      inverseAction: 'restore',
      targetLabels: ['Asset A', 'Asset C'],
    })
  })

  it('clears only an overlapping recovery when its ID-to-label mapping is ambiguous', () => {
    const operation = recovery([11, 12], ['Asset A'])

    expect(revokePurgedAssetLifecycleOperation(operation, [12])).toBeNull()
  })
})
