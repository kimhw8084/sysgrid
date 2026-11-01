import { describe, expect, it } from 'vitest'

import {
  describeExternalSavedView,
  normalizeExternalActiveTab,
  sanitizeExternalViewConfig,
} from './External'

describe('External saved view state', () => {
  it('preserves links as a valid persisted workspace tab', () => {
    expect(normalizeExternalActiveTab('links')).toBe('links')
    expect(sanitizeExternalViewConfig({ activeTab: 'links' }).activeTab).toBe('links')
  })

  it('validates group fields against the selected External table', () => {
    expect(sanitizeExternalViewConfig({ activeTab: 'links', groupBy: 'link_status' }).groupBy).toBe('link_status')
    expect(sanitizeExternalViewConfig({ activeTab: 'links', groupBy: 'status' }).groupBy).toBe('raw')
    expect(sanitizeExternalViewConfig({ activeTab: 'active', groupBy: 'status' }).groupBy).toBe('status')
  })

  it('preserves active and deleted while still falling back invalid tabs to active', () => {
    expect(normalizeExternalActiveTab('active')).toBe('active')
    expect(normalizeExternalActiveTab('deleted')).toBe('deleted')
    expect(normalizeExternalActiveTab('unexpected')).toBe('active')
    expect(sanitizeExternalViewConfig({ activeTab: 'unexpected' }).activeTab).toBe('active')
  })

  it('labels links saved views truthfully', () => {
    expect(describeExternalSavedView({
      config: {
        activeTab: 'links',
        groupBy: 'raw',
        searchTerm: '',
      },
    })).toBe('Links · Raw Table · Full workspace')
  })
})
