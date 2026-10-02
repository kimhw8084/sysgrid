import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildOperationalDiagnosticDetail } from './OperationalDataStatus'

describe('buildOperationalDiagnosticDetail', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
  afterEach(() => vi.unstubAllGlobals())
  it('preserves available apiFetch error fields', () => {
    expect(buildOperationalDiagnosticDetail({
      endpoint: '/api/v1/intelligence/links',
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
      userId: 'admin_root',
      tenantId: '1',
      message: 'Backend unavailable',
      rawBody: '{"detail":"Backend unavailable"}',
      data: { detail: 'Backend unavailable' },
    })
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
