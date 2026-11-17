import { describe, expect, it } from 'vitest'
import { getFarMaturityLevel } from './FAR.gridColumns'

describe('FAR prevention execution convergence', () => {
  it('requires verified prevention before declaring maturity Lv8', () => {
    expect(getFarMaturityLevel({ prevention_actions: [{ status: 'Open' }] })).toBe(0)
    expect(getFarMaturityLevel({ prevention_actions: [{ status: 'In Progress' }] })).toBe(0)
    expect(getFarMaturityLevel({ prevention_actions: [{ status: 'Verified' }] })).toBe(8)
    expect(getFarMaturityLevel({ prevention_actions: [{ status: 'Completed' }] })).toBe(8)
    expect(getFarMaturityLevel({ status: 'Prevented' })).toBe(8)
  })

  it('does not elevate incomplete prevention above the existing defense-in-depth levels', () => {
    expect(getFarMaturityLevel({
      prevention_actions: [{ status: 'Open' }],
      mitigations: [{ mitigation_type: 'Monitoring' }, { mitigation_type: 'Workaround' }],
      causes: [{ resolutions: [{}] }],
    })).toBe(7)
    expect(getFarMaturityLevel({
      prevention_actions: [{ status: 'In Progress' }],
      causes: [{ resolutions: [{}] }],
    })).toBe(4)
  })

  it('handles missing or malformed evidence arrays without crashing', () => {
    expect(getFarMaturityLevel(null)).toBe(0)
    expect(getFarMaturityLevel({
      status: 'Active',
      prevention_actions: 'invalid',
      mitigations: { mitigation_type: 'Monitoring' },
      causes: [null, { resolutions: 'invalid' }],
    } as any)).toBe(0)
  })
})
