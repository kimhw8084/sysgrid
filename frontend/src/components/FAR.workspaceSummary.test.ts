import { describe, expect, it } from 'vitest'
import { buildFarWorkspaceSummary } from './FAR.workspaceSummary'

describe('FAR workspace summary', () => {
  it('summarizes valid and partial records without coercion or duplicate systems', () => {
    const summary = buildFarWorkspaceSummary([
      { rpn: '180', system_name: 'Core', mitigations: ['UPS'], affected_assets: [1, 2] },
      { rpn: 80, system_name: ' core ', mitigations: [], affected_assets: 'not-an-array' },
      { rpn: 'not scored', system_name: '', mitigations: 'draft' },
      null,
    ])

    expect(summary).toMatchObject({
      recordCount: 4,
      averageRPN: 65,
      criticalCount: 1,
      priorityCount: 2,
      mitigationCount: 1,
      mitigationRatio: 25,
      systemsCovered: 1,
      totalAffectedAssets: 2,
    })
  })

  it('returns explicit zero values for an empty or malformed scope', () => {
    expect(buildFarWorkspaceSummary(null)).toMatchObject({
      recordCount: 0,
      averageRPN: 0,
      criticalCount: 0,
      priorityCount: 0,
      mitigationCount: 0,
      mitigationRatio: 0,
      systemsCovered: 0,
      totalRPN: 0,
      totalAffectedAssets: 0,
    })
  })
})
