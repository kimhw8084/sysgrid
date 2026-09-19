import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient, apiFetch, getApiBaseUrl, getConfig, setApiOverride, subscribeToLatency } from './apiClient'
import { makeJsonResponse } from '../test/response'

function makeJsonErrorResponse(status: number, statusText: string, body: unknown) {
  return makeJsonResponse(body, {
    status,
    statusText,
  })
}

describe('apiClient', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('prefers the local storage API override and normalizes trailing API paths', () => {
    localStorage.setItem('SYSGRID_OVERRIDE_API_URL', 'http://localhost:8000/api/v1/')
    expect(getApiBaseUrl()).toBe('http://localhost:8000')

    setApiOverride('http://example.com/api/v1/')
    expect(localStorage.getItem('SYSGRID_OVERRIDE_API_URL')).toBe('http://example.com')

    setApiOverride(null)
    expect(localStorage.getItem('SYSGRID_OVERRIDE_API_URL')).toBeNull()
  })

  it('reads bootstrapped config values before defaults', () => {
    localStorage.setItem('SYSGRID_CONFIG_VITE_SAMPLE_KEY', 'bootstrapped')
    expect(getConfig('SAMPLE_KEY', 'fallback')).toBe('bootstrapped')
    expect(getConfig('UNKNOWN_KEY', 'fallback')).toBe('fallback')
  })

  it('attaches identity headers and normalizes endpoint slashes for same-origin API calls', async () => {
    localStorage.setItem('SYSGRID_OVERRIDE_API_URL', 'http://127.0.0.1:8000/api/v1')
    localStorage.setItem('SYSGRID_USER_ID', 'pw-user')
    localStorage.setItem('SYSGRID_TENANT_ID', '42')

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await apiClient.post('/settings/?tab=general', { enabled: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8000/settings?tab=general')
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-User-Id': 'pw-user',
      'X-Tenant-Id': '42',
    })
    expect(options.credentials).toBe('include')
    expect(options.body).toBe(JSON.stringify({ enabled: true }))
  })

  it('trims trailing slashes on relative endpoints without query strings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/health/')

    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/health$/)
  })

  it('does not force JSON content type for FormData payloads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/upload', { method: 'POST', body: new FormData() })

    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers['Content-Type']).toBeUndefined()
  })

  it('does not send Content-Type for bodyless GET requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/health', { method: 'GET' })

    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers['Content-Type']).toBeUndefined()
  })

  it('does not send Content-Type for bodyless HEAD requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/health', { method: 'HEAD' })

    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers['Content-Type']).toBeUndefined()
  })

  it('does not send writes while offline and exposes a reviewable error', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const originalOnline = navigator.onLine
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    try {
      await expect(apiFetch('/api/v2/projects', { method: 'POST', body: '{}' })).rejects.toMatchObject({
        status: 0,
        offline: true,
        message: expect.stringContaining('was not sent'),
      })
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: originalOnline })
    }
  })

  it('does not leak identity headers to non-local external requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('https://api.example.com/health')

    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers['X-User-Id']).toBeUndefined()
    expect(options.headers['X-Tenant-Id']).toBeUndefined()
    expect(options.credentials).toBe('include')
  })

  it('uses same-origin credentials for absolute same-origin URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch(`${window.location.origin}/api/health`)

    const [, options] = fetchMock.mock.calls[0]
    expect(options.credentials).toBe('same-origin')
    expect(options.headers['X-User-Id']).toBe('admin_root')
  })

  it('emits latency updates and unsubscribes cleanly', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToLatency(listener)
    expect(listener).toHaveBeenCalledWith(expect.any(Number))

    const fetchMock = vi.fn().mockResolvedValue(makeJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/health')

    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls[1][0]).toBeTypeOf('number')

    unsubscribe()
    await apiFetch('/health')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('throws enriched errors for JSON API failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeJsonErrorResponse(503, 'Unavailable', {
        detail: 'Backend unavailable',
        traceback: 'stack trace',
      }),
    ))

    await expect(apiFetch('/health')).rejects.toMatchObject({
      message: 'Backend unavailable',
      status: 503,
      data: { detail: 'Backend unavailable', traceback: 'stack trace' },
    })
  })

  it('falls back to status text when error payload is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json', {
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'Content-Type': 'text/plain' },
    })))

    await expect(apiFetch('/boom')).rejects.toMatchObject({
      message: 'API Error 500: Internal Server Error',
      status: 500,
      data: { detail: 'API Error 500: Internal Server Error' },
    })
  })

  it('uses the API message field when detail is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeJsonErrorResponse(422, 'Unprocessable Entity', {
        message: 'Validation Failed',
      }),
    ))

    await expect(apiFetch('/invalid')).rejects.toMatchObject({
      message: 'Validation Failed',
      status: 422,
      data: { message: 'Validation Failed' },
    })
  })

  it('supports the convenience get, put, delete, and patch helpers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ method: 'get' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ method: 'put' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ method: 'delete' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ method: 'patch' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient.get('/one')).resolves.toEqual({ method: 'get' })
    await expect(apiClient.put('/two', { ok: true })).resolves.toEqual({ method: 'put' })
    await expect(apiClient.delete('/three')).resolves.toEqual({ method: 'delete' })
    await expect(apiClient.patch('/four', { ok: true })).resolves.toEqual({ method: 'patch' })

    expect(fetchMock.mock.calls[0][1].method).toBe('GET')
    expect(fetchMock.mock.calls[1][1].method).toBe('PUT')
    expect(fetchMock.mock.calls[2][1].method).toBe('DELETE')
    expect(fetchMock.mock.calls[3][1].method).toBe('PATCH')
  })

  it('falls back to same-origin credentials when URL parsing fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('http://[bad-url')

    const [, options] = fetchMock.mock.calls[0]
    expect(options.credentials).toBe('same-origin')
  })

  it('fails fast for an invalid configured API base URL', async () => {
    localStorage.setItem('SYSGRID_OVERRIDE_API_URL', 'backend.internal')

    await expect(apiFetch('/health')).rejects.toMatchObject({
      message: expect.stringContaining('Configured API base "backend.internal" is invalid'),
      status: 0,
    })
  })

  it('rejects OAuth or login HTML where JSON was expected', async () => {
    const redirectedResponse = new Response('<html>Sign in</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })
    Object.defineProperty(redirectedResponse, 'redirected', { value: true })
    Object.defineProperty(redirectedResponse, 'url', { value: 'https://gitlab.example.com/oauth/authorize' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redirectedResponse))

    await expect(apiClient.get('/api/v1/settings/bootstrap')).rejects.toMatchObject({
      message: 'Backend JSON request was redirected to OAuth or a login page.',
      status: 200,
    })
  })
  it('captures invalid-host response diagnostics for bootstrap classification', async () => {
    const response = new Response('Invalid host header', {
      status: 400,
      statusText: 'Bad Request',
      headers: {
        'Content-Type': 'text/plain',
        'X-Request-ID': 'request-123',
      },
    })
    Object.defineProperty(response, 'url', {
      value: 'http://8000.vscode.company.example/api/v1/health',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expect(apiFetch('http://8000.vscode.company.example/api/v1/health')).rejects.toMatchObject({
      status: 400,
      statusText: 'Bad Request',
      method: 'GET',
      contentType: 'text/plain',
      requestId: 'request-123',
      rawBody: 'Invalid host header',
      finalUrl: 'http://8000.vscode.company.example/api/v1/health',
      browserOrigin: window.location.origin,
      timestamp: expect.any(String),
    })
  })

  it('captures network failure context when fetch does not return a response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(apiFetch('https://api.company.example/api/v1/health')).rejects.toMatchObject({
      message: 'Failed to fetch',
      status: 0,
      method: 'GET',
      url: 'https://api.company.example/api/v1/health',
      finalUrl: 'https://api.company.example/api/v1/health',
      browserOnline: expect.any(Boolean),
    })
  })

  it('captures redirect and content-type context for non-JSON responses', async () => {
    const response = new Response('<html>Proxy landing page</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })
    Object.defineProperty(response, 'redirected', { value: false })
    Object.defineProperty(response, 'url', { value: 'https://proxy.example.com/' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expect(apiClient.get('https://proxy.example.com/')).rejects.toMatchObject({
      status: 200,
      contentType: 'text/html',
      redirected: false,
      finalUrl: 'https://proxy.example.com/',
      rawBody: '<html>Proxy landing page</html>',
    })
  })

})
