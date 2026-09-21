import { describe, expect, it } from 'vitest'
import { buildDashboardSearchPath, dashboardTruthLabel, dashboardTruthReason, type DashboardTruth } from './Dashboard'

const unavailableObservation: DashboardTruth = {
  value: null,
  kind: 'observed_health',
  source: 'No authoritative observation source is configured.',
  as_of: '2026-09-21T12:00:00Z',
  observed_at: null,
  freshness: 'unavailable',
  available: false,
  unavailable_reason: 'NO_AUTHORITATIVE_OBSERVATION_SOURCE',
  module_id: 'monitoring',
  path: '/monitoring',
}

describe('Home truth presentation contract', () => {
  it('renders unavailable observations without a numeric fallback', () => {
    expect(dashboardTruthLabel(unavailableObservation)).toBe('Unavailable')
    expect(dashboardTruthReason(unavailableObservation)).toBe('NO_AUTHORITATIVE_OBSERVATION_SOURCE')
  })

  it('keeps persisted configuration distinct from observed health', () => {
    expect(dashboardTruthLabel({ ...unavailableObservation, kind: 'configuration', available: true, freshness: 'not_applicable', value: 3 })).toBe('Configured')
  })

  it('navigates using the server-returned path and stable object id', () => {
    expect(buildDashboardSearchPath({ id: 42, type: 'asset', title: 'Node', subtitle: 'Server', tag: 'Physical', path: '/asset', module_id: 'assets' })).toBe('/asset?id=42')
    expect(buildDashboardSearchPath({ id: 7, type: 'audit', title: 'Activity', subtitle: 'devices', tag: 'CREATE', path: '/logs?view=recent', module_id: 'logs' })).toBe('/logs?view=recent&id=7')
  })
})
