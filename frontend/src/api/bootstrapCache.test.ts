import { beforeEach, describe, expect, it, vi } from 'vitest'
import { replaceBootstrapConfigurationCache } from './bootstrapCache'

beforeEach(() => localStorage.clear())

describe('public bootstrap cache ownership', () => {
  it('replaces stale and private entries while preserving unrelated operator preferences', () => {
    localStorage.setItem('SYSGRID_CONFIG_SCHEDULE_PREVIEW_SIGNING_KEY', 'synthetic-old-private-value')
    localStorage.setItem('SYSGRID_CONFIG_VITE_RETIRED', 'old public value')
    localStorage.setItem('SYSGRID_CONFIG__metadata', 'old diagnostics')
    localStorage.setItem('sysgrid-theme', 'pure-clarity')
    localStorage.setItem('SYSGRID_OVERRIDE_API_URL', 'https://api.example.invalid')
    expect(replaceBootstrapConfigurationCache({
      API_ENDPOINT: '/api/v1', PORT: 8000, DEFAULT_USER_ID: 'operator', VITE_FEATURE: false,
      SCHEDULE_PREVIEW_SIGNING_KEY: 'synthetic-private-response-value',
      _metadata: { private: 'synthetic-diagnostics' },
    })).toBe(true)
    expect(localStorage.getItem('SYSGRID_CONFIG_SCHEDULE_PREVIEW_SIGNING_KEY')).toBeNull()
    expect(localStorage.getItem('SYSGRID_CONFIG_VITE_RETIRED')).toBeNull()
    expect(localStorage.getItem('SYSGRID_CONFIG__metadata')).toBeNull()
    expect(localStorage.getItem('SYSGRID_CONFIG_API_ENDPOINT')).toBe('/api/v1')
    expect(localStorage.getItem('SYSGRID_CONFIG_PORT')).toBe('8000')
    expect(localStorage.getItem('SYSGRID_CONFIG_DEFAULT_USER_ID')).toBe('operator')
    expect(localStorage.getItem('SYSGRID_CONFIG_VITE_FEATURE')).toBe('false')
    expect(localStorage.getItem('sysgrid-theme')).toBe('pure-clarity')
    expect(localStorage.getItem('SYSGRID_OVERRIDE_API_URL')).toBe('https://api.example.invalid')
  })

  it('reports an unchanged snapshot without rewriting storage or triggering refresh', () => {
    replaceBootstrapConfigurationCache({ VITE_APP_TITLE: 'Current title' })
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const remove = vi.spyOn(Storage.prototype, 'removeItem')
    try {
      expect(replaceBootstrapConfigurationCache({ VITE_APP_TITLE: 'Current title' })).toBe(false)
      expect(write).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
    } finally {
      write.mockRestore()
      remove.mockRestore()
    }
  })

  it('removes a deleted or explicitly unset public value', () => {
    replaceBootstrapConfigurationCache({ VITE_APP_TITLE: 'Old title' })
    expect(replaceBootstrapConfigurationCache({ VITE_APP_TITLE: null })).toBe(true)
    expect(localStorage.getItem('SYSGRID_CONFIG_VITE_APP_TITLE')).toBeNull()
  })

  it.each([null, [], 'invalid', { VITE_APP_TITLE: {} }, { PORT: Infinity }])('rejects malformed snapshots before any cache mutation: %j', config => {
    localStorage.setItem('SYSGRID_CONFIG_VITE_RETAINED', 'committed value')
    expect(() => replaceBootstrapConfigurationCache(config)).toThrow('Invalid public configuration response')
    expect(localStorage.getItem('SYSGRID_CONFIG_VITE_RETAINED')).toBe('committed value')
    expect(localStorage.length).toBe(1)
  })
})
