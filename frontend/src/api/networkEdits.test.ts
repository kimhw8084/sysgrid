import { describe, expect, it } from 'vitest'
import { changedNetworkFields, networkOptionsWithCurrent, networkTableChanges } from './networkEdits'

describe('Network edits', () => {
  it('stages only edited table metadata and preserves legacy literals and unknown speeds', () => {
    const baseline = { id: 7, title: 'A ↔ B', direction: 'Ingress', unit: 'Legacy', purpose: '', speed_gbps: '' }
    expect(networkTableChanges({ ...baseline, purpose: 'New notes' }, baseline)).toEqual({ purpose: 'New notes' })
    expect(networkTableChanges({ ...baseline, speed_gbps: '0.5' }, baseline)).toEqual({ speed_gbps: .5 })
    expect(networkTableChanges({ ...baseline, purpose: '' }, { ...baseline, purpose: 'Old notes' })).toEqual({ purpose: null })
    expect(networkTableChanges(baseline, baseline)).toEqual({})
  })
  it('preserves unedited legacy enums and nullable values without submitting them', () => {
    const baseline = { link_type: 'Production', direction: 'Ingress', farm: 'HQ-01', purpose: null, speed_gbps: null }
    expect(changedNetworkFields({ ...baseline, purpose: 'Updated notes' }, baseline)).toEqual({ purpose: 'Updated notes' })
    expect(changedNetworkFields(baseline, baseline)).toEqual({})
  })
  it('submits explicit clears and real changes', () => {
    const baseline = { purpose: 'Old notes', speed_gbps: 10 }
    expect(changedNetworkFields({ purpose: null, speed_gbps: 25 }, baseline)).toEqual({ purpose: null, speed_gbps: 25 })
  })
  it('labels a retired current value without replacing the configured choices', () => {
    const options = [{ value: 'Data', label: 'Data' }]
    expect(networkOptionsWithCurrent(options, 'Production')).toEqual([...options, { value: 'Production', label: 'Production · current value' }])
    expect(networkOptionsWithCurrent(options, 'Data')).toBe(options)
  })
})
