import { describe, expect, it } from 'vitest'
import {
  LOGIC_SUGGESTIONS,
  LOGIC_TYPES,
  STATUSES,
} from './monitoringWorkspaceContract'

describe('monitoring workspace contract', () => {
  it('preserves the extracted Monitoring values and presentation contract', () => {
    expect(STATUSES).toEqual([
      { value: 'Existing', label: 'Existing', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
      { value: 'Planned', label: 'Planned', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
      { value: 'Cancelled', label: 'Cancelled', color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
      { value: 'Decommissioned', label: 'Decommissioned', color: 'bg-slate-500/20 text-slate-400 border-white/20' },
      { value: 'Deleted', label: 'Deleted', color: 'bg-slate-800 text-slate-500 border-white/5' },
    ])
    expect(LOGIC_TYPES).toEqual(['Threshold', 'Anomaly', 'Availability'])
    expect(LOGIC_SUGGESTIONS).toEqual({
      Threshold: 'CPU > 90%',
      Anomaly: 'Trend analysis',
      Availability: 'HTTP 200 check',
    })
  })
})
