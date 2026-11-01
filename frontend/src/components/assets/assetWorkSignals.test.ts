import { describe, expect, it } from 'vitest'
import { getAssetWorkSignal } from './assetWorkSignals'

describe('asset work signals', () => {
  it('prioritizes unresolved action states and matches action target ids', () => {
    const signal = getAssetWorkSignal(7, [
      { device_id: 7, status: 'Scheduled', start_time: '2026-11-05T00:00:00Z', end_time: '2026-11-05T02:00:00Z' },
    ], [
      { status: 'RECOVERY_REQUIRED', targets: [{ device_id: 7 }] },
      { status: 'EXECUTING', targets: [{ device_id: 8 }] },
    ], Date.parse('2026-11-01T00:00:00Z'))

    expect(signal.level).toBe('attention')
    expect(signal.label).toBe('Needs attention')
    expect(signal.attentionActions).toHaveLength(1)
    expect(signal.actions).toHaveLength(1)
  })

  it('ignores canceled and ended windows when selecting the visible signal', () => {
    expect(getAssetWorkSignal(2, [
      { device_id: 2, status: 'Scheduled', end_time: '2026-10-01T00:00:00Z' },
      { device_id: 2, status: 'Cancelled', end_time: '2026-12-01T00:00:00Z' },
    ], [], Date.parse('2026-11-01T00:00:00Z')).level).toBe('history')
  })
})
