import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'react-hot-toast'

const observed = vi.hoisted(() => ({
  layouts: 0, pages: 0, health: 0,
  latency: null as null | ((value: number) => void),
  policy: null as any,
  scope: 'performance-shell',
  apiCalls: [] as Array<{ url: string; options: any }>,
  patchTheme: null as null | (() => Promise<any>),
  savedTheme: null as string | null,
  useRealPreferenceApi: false,
}))

vi.mock('./components/shared/routeFocus', () => ({ useRouteFocus: () => { observed.layouts++ } }))
vi.mock('./components/Dashboard', () => ({ default: () => { observed.pages++; return <div>Rendered home workspace</div> } }))
vi.mock('./components/shared/TenantSelector', () => ({ TenantSelector: () => <span>Test tenant</span> }))
vi.mock('./components/shared/ErrorConsole', () => ({ ErrorConsole: () => null }))
vi.mock('./api/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/apiClient')>()
  return {
    getConfig: (_name: string, fallback: string) => fallback,
    getRequestScopeKey: () => observed.scope,
    subscribeToLatency: (callback: (value: number) => void) => {
      observed.latency = callback
      return () => { observed.latency = null }
    },
    apiFetch: vi.fn(async (url: string, options: any = {}) => {
      observed.apiCalls.push({ url, options })
      if (observed.useRealPreferenceApi && url.endsWith('/user/settings')) {
        return actual.apiFetch(url, options)
      }
      if (options.method === 'PATCH') {
        return observed.patchTheme?.() ?? new Response(JSON.stringify({ status: 'success' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }
      return {
        json: async () => url.includes('/health')
          ? { status: 'healthy', sample: ++observed.health }
          : url.includes('/policy/')
            ? observed.policy || { identity: { user_id: 'test.operator', authenticated: true, tenant_admin: true, system_root: false }, modules: { home: { available: true } }, actions: { diagnostics: { read: true } } }
            : url.endsWith('/profile') ? { username: 'test.operator', full_name: 'Test Operator' }
              : url.endsWith('/user/settings') ? (observed.savedTheme ? { theme: observed.savedTheme } : {}) : {},
      }
    }),
  }
})

import App from './App'

beforeEach(() => {
  observed.apiCalls = []
  observed.patchTheme = null
  observed.savedTheme = null
  observed.useRealPreferenceApi = false
  observed.policy = null
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })))
})
afterEach(() => { act(() => toast.dismiss()); cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

async function selectLightAppearance() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Appearance' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Light appearance' }))
}

describe('application shell render isolation', () => {
  it('updates real clock, latency and health regions without rerendering MainLayout or the active page', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    render(<App />)
    await screen.findByText('Rendered home workspace')
    await screen.findByText('Test Operator')
    await waitFor(() => expect(observed.latency).not.toBeNull())
    await screen.findByText('Operational')
    // Settle bootstrap React Query notifications before measuring live updates.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    const before = { layouts: observed.layouts, pages: observed.pages, health: observed.health }
    expect(before.layouts).toBeGreaterThan(0)
    expect(before.pages).toBeGreaterThan(0)
    const footer = document.querySelector('footer')!
    expect(footer).not.toBeNull()
    const clock = footer.textContent
    await act(async () => { observed.latency!(37); await vi.advanceTimersByTimeAsync(11000) })
    expect(screen.getByText('37 ms')).toBeInTheDocument()
    expect(footer.textContent).not.toBe(clock)
    expect(observed.health).toBeGreaterThan(before.health)
    expect(observed.layouts, 'SHELL_RERENDER_REGRESSION').toBe(before.layouts)
    expect(observed.pages).toBe(before.pages)
  })

  it('fails closed when policy identity is missing without crashing app initialization', async () => {
    observed.scope = 'missing-policy-identity'
    observed.policy = { modules: {} }
    const pagesBefore = observed.pages
    render(<App />)
    await screen.findByText('Account unavailable')
    expect(screen.getByRole('status')).toHaveTextContent('Account unavailable')
    expect(observed.pages).toBe(pagesBefore)
  })

  it('persists the selected theme after server confirmation without an obstructive success toast', async () => {
    observed.scope = 'theme-persistence-success'
    localStorage.setItem('sysgrid-theme', 'nordic-frost-v1')
    let resolvePatch!: (response: Response) => void
    observed.patchTheme = vi.fn(() => new Promise<Response>(resolve => { resolvePatch = resolve }))
    const successToast = vi.spyOn(toast, 'success')
    render(<App />)
    await screen.findByText('Test Operator')
    successToast.mockClear()

    await selectLightAppearance()

    await waitFor(() => expect(observed.apiCalls.filter(call => call.options.method === 'PATCH')).toHaveLength(1))
    const patch = observed.apiCalls.find(call => call.options.method === 'PATCH')!
    expect(patch.url).toContain('/api/v1/settings/user/settings')
    expect(patch.options.body).toBe(JSON.stringify({ theme: 'pure-clarity' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('pure-clarity')
    expect(successToast).not.toHaveBeenCalled()

    await act(async () => resolvePatch(new Response(JSON.stringify({ status: 'success' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })))
    expect(successToast).not.toHaveBeenCalled()
    expect(observed.apiCalls.filter(call => call.options.method === 'PATCH')).toHaveLength(1)
  })

  it('persists one configured API PATCH through apiFetch when offline without a success toast', async () => {
    observed.scope = 'theme-persistence-real-api'
    observed.useRealPreferenceApi = true
    observed.savedTheme = 'nordic-frost-v1'
    localStorage.removeItem('sysgrid-theme')
    localStorage.setItem('SYSGRID_OVERRIDE_API_URL', 'http://127.0.0.1:8000')
    const originalOnline = navigator.onLine
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const settingsReadbacks: Array<string | null> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(String(input), window.location.origin).pathname
      if (path.endsWith('/user/settings') && init.method === 'PATCH') {
        observed.savedTheme = JSON.parse(String(init.body)).theme
        return new Response(JSON.stringify({ status: 'success' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }
      if (path.endsWith('/user/settings')) {
        settingsReadbacks.push(observed.savedTheme)
        return new Response(JSON.stringify({ theme: observed.savedTheme }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const successToast = vi.spyOn(toast, 'success')
    render(<App />)
    await screen.findByText('Test Operator')
    successToast.mockClear()

    try {
      await selectLightAppearance()

      await waitFor(() => expect(fetchMock.mock.calls.filter(call => call[1].method === 'PATCH')).toHaveLength(1))
      const [url, options] = fetchMock.mock.calls.find(call => call[1].method === 'PATCH')!
      expect(String(url)).toBe('http://127.0.0.1:8000/api/v1/settings/user/settings')
      expect(options.body).toBe(JSON.stringify({ theme: 'pure-clarity' }))
      expect(observed.savedTheme).toBe('pure-clarity')
      const patchIndex = fetchMock.mock.calls.findIndex(call => call[1].method === 'PATCH')
      const patchResponse = await fetchMock.mock.results[patchIndex].value
      expect(patchResponse.status).toBe(200)
      expect(successToast).not.toHaveBeenCalled()
      expect(fetchMock.mock.calls.filter(call => call[1].method === 'PATCH')).toHaveLength(1)

      await act(async () => { window.dispatchEvent(new Event('online')) })
      await waitFor(() => expect(settingsReadbacks.at(-1)).toBe('pure-clarity'))
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: originalOnline })
    }
  })

  it('restores the prior saved theme and reports failure when theme persistence is rejected', async () => {
    observed.scope = 'theme-persistence-failure'
    localStorage.setItem('sysgrid-theme', 'nordic-frost-v1')
    observed.patchTheme = vi.fn(async () => { throw new Error('HTTP 500') })
    const errorToast = vi.spyOn(toast, 'error')
    const successToast = vi.spyOn(toast, 'success')
    render(<App />)
    await screen.findByText('Test Operator')
    errorToast.mockClear()
    successToast.mockClear()

    await selectLightAppearance()

    await waitFor(() => expect(errorToast).toHaveBeenCalled())
    expect(observed.apiCalls.filter(call => call.options.method === 'PATCH')).toHaveLength(1)
    expect(document.documentElement.getAttribute('data-theme')).toBe('nordic-frost-v1')
    expect(localStorage.getItem('sysgrid-theme')).toBe('nordic-frost-v1')
    expect(errorToast).toHaveBeenCalledWith('Theme could not be saved. Previous appearance was restored.')
    expect(successToast).not.toHaveBeenCalled()
  })

  it('restores a persisted server theme during application startup', async () => {
    observed.scope = 'theme-persistence-readback'
    observed.savedTheme = 'pure-clarity'
    localStorage.removeItem('sysgrid-theme')
    render(<App />)

    await screen.findByText('Test Operator')
    // The application keeps its QueryClient between these shell tests. Force
    // the saved-preference read used by a new session rather than reuse cache.
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('pure-clarity'))
    expect(localStorage.getItem('sysgrid-theme')).toBe('pure-clarity')
  })
})
