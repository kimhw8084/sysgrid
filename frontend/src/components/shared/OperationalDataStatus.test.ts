import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildOperationalDiagnosticDetail } from './OperationalDataStatus'

describe('buildOperationalDiagnosticDetail', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
  afterEach(() => vi.unstubAllGlobals())
  it('preserves available apiFetch error fields', () => {
    expect(buildOperationalDiagnosticDetail({
      endpoint: '/api/v1/intelligence/links',
      userId: 'operator-7',
      tenantId: '24',
      error: {
        status: 503,
        statusText: 'Service Unavailable',
        url: 'http://127.0.0.1:8000/api/v1/intelligence/links',
        message: 'Backend unavailable',
        rawBody: '{"detail":"Backend unavailable"}',
        data: { detail: 'Backend unavailable' },
      },
    })).toEqual({
      endpoint: '/api/v1/intelligence/links',
      status: 503,
      statusText: 'Service Unavailable',
      url: 'http://127.0.0.1:8000/api/v1/intelligence/links',
      userId: 'operator-7',
      tenantId: '24',
      message: 'Backend unavailable',
      rawBody: '{"detail":"Backend unavailable"}',
      data: { detail: 'Backend unavailable' },
    })
  })

  it('does not invent identities or initialize tenant state when context is absent', () => {
    const result = buildOperationalDiagnosticDetail({ endpoint: '/actual', error: {} })
    expect(result.userId).toBe('Not captured')
    expect(result.tenantId).toBe('Not captured')
    expect(sessionStorage.getItem('SYSGRID_TAB_TENANT_ID')).toBeNull()
  })

  it('uses tab tenant context ahead of another tabs default and honors explicit context', () => {
    localStorage.setItem('SYSGRID_CONFIG_DEFAULT_USER_ID', 'configured-user')
    localStorage.setItem('SYSGRID_TENANT_ID', '24')
    sessionStorage.setItem('SYSGRID_TAB_TENANT_ID', '42')
    expect(buildOperationalDiagnosticDetail({ endpoint: '/actual', error: {} })).toMatchObject({ userId: 'configured-user', tenantId: '42' })
    expect(buildOperationalDiagnosticDetail({ endpoint: '/actual', error: {}, userId: 'captured-user', tenantId: '7' })).toMatchObject({ userId: 'captured-user', tenantId: '7' })
  })

  it('keeps useful error details when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Storage blocked') } })
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('Storage blocked') } })
    expect(buildOperationalDiagnosticDetail({ endpoint: '/actual', error: { status: 503, message: 'Unavailable' } })).toMatchObject({ status: 503, message: 'Unavailable', userId: 'Not captured', tenantId: 'Not captured' })
  })

  it('uses honest fallbacks when the error object lacks details', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => {
        if (key === 'SYSGRID_USER_ID') return 'operator-7'
        if (key === 'SYSGRID_TENANT_ID') return '24'
        return null
      },
    } as Storage)

    expect(buildOperationalDiagnosticDetail({
      endpoint: '/api/v1/intelligence/entities?include_deleted=true',
      error: {},
      fallbackMessage: 'The external entities request failed.',
    })).toEqual({
      endpoint: '/api/v1/intelligence/entities?include_deleted=true',
      status: 'Unavailable from current error object',
      statusText: 'Unavailable from current error object',
      url: 'Unavailable from current error object',
      userId: 'operator-7',
      tenantId: '24',
      message: 'The external entities request failed.',
      rawBody: undefined,
      data: undefined,
    })
  })
})
