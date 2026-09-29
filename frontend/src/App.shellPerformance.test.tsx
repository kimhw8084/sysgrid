import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const observed = vi.hoisted(() => ({
  layouts: 0, pages: 0, health: 0,
  latency: null as null | ((value: number) => void),
}))

vi.mock('./components/shared/routeFocus', () => ({ useRouteFocus: () => { observed.layouts++ } }))
vi.mock('./components/Dashboard', () => ({ default: () => { observed.pages++; return <div>Rendered home workspace</div> } }))
vi.mock('./components/shared/TenantSelector', () => ({ TenantSelector: () => <span>Test tenant</span> }))
vi.mock('./components/shared/ErrorConsole', () => ({ ErrorConsole: () => null }))
vi.mock('./api/apiClient', () => ({
  getConfig: (_name: string, fallback: string) => fallback,
  getRequestScopeKey: () => 'performance-test',
  subscribeToLatency: (callback: (value: number) => void) => {
    observed.latency = callback
    return () => { observed.latency = null }
  },
  apiFetch: vi.fn(async (url: string) => ({
    json: async () => url.includes('/health')
      ? { status: 'healthy', sample: ++observed.health }
      : url.includes('/policy/')
        ? { identity: { authenticated: true, tenant_admin: true, system_root: false }, modules: { home: { available: true } }, actions: { diagnostics: { read: true } } }
        : url.endsWith('/profile') ? { username: 'test.operator', full_name: 'Test Operator' } : {},
  })),
}))

import App from './App'

afterEach(() => { cleanup(); vi.useRealTimers() })

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
})
