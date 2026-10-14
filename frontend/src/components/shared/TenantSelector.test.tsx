import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TenantSelector } from './TenantSelector'
import { usePageLeaveGuard } from './workspaceDeparture'
import { makeJsonResponse } from '../../test/response'

function Draft() {
  const [draft, setDraft] = React.useState('Unsaved host change')
  usePageLeaveGuard(!!draft)
  return <input aria-label="Draft" value={draft} onChange={e => setDraft(e.target.value)} />
}

function openSelector() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([{ path: '/', element: <><TenantSelector /><Draft /></> }])
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return client
}

describe('tenant-switch consent', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks() })

  it('cancellation sends no selection request and preserves the draft and tab scope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeJsonResponse([
      { id: 1, name: 'Original tenant', is_selected: true, is_online: true },
      { id: 2, name: 'Other tenant', is_selected: false, is_online: true },
    ]))
    vi.stubGlobal('fetch', fetchMock)
    openSelector()
    await screen.findByText('Original tenant')
    fireEvent.click(screen.getByRole('button', { name: 'Switch tenant' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Other tenant/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Switch tenant?' })
    expect(within(dialog).getByText(/discard unsaved changes/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay here' }))
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
    expect(screen.getByLabelText('Draft')).toHaveValue('Unsaved host change')
    expect(sessionStorage.getItem('SYSGRID_TAB_TENANT_ID')).toBe('1')
    expect(localStorage.getItem('SYSGRID_TENANT_ID')).toBeNull()
  })

  it('a failed selection preserves the old scope and unload protection', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => options?.method === 'POST'
      ? makeJsonResponse({ detail: 'Permission changed' }, { status: 403 })
      : makeJsonResponse([
        { id: 1, name: 'Original tenant', is_selected: false, is_online: true },
        { id: 2, name: 'Other tenant', is_selected: true, is_online: true },
      ])))
    openSelector()
    await screen.findByText('Original tenant')
    fireEvent.click(screen.getByRole('button', { name: 'Switch tenant' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Other tenant/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Switch tenant?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Switch tenant' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Switching tenant' })).not.toBeInTheDocument())
    expect(screen.getByLabelText('Draft')).toHaveValue('Unsaved host change')
    expect(sessionStorage.getItem('SYSGRID_TAB_TENANT_ID')).toBe('1')
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
  })
})
