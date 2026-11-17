import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { apiFetch } from '../../api/apiClient'
import { NetworkActivityModal } from './NetworkActivityModal'

vi.mock('../../api/apiClient', () => ({ apiFetch: vi.fn() }))

afterEach(() => { cleanup(); vi.clearAllMocks() })

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '/', element: <NetworkActivityModal item={{ id: 42, title: 'DC-1 uplink' }} onClose={() => {}} /> }])
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...view, client }
}

it('reads the network connection audit stream through the canonical permission-checked endpoint', async () => {
  vi.mocked(apiFetch).mockResolvedValue({
    ok: true,
    json: async () => [{ id: 8, timestamp: '2026-11-09T12:00:00Z', action: 'UPDATE', target_table: 'port_connections', target_id: '42', user_id: 'synthetic.user', description: 'Modified network link', changes: { changed_fields: ['cable_type'] } }],
  } as Response)
  const { client, unmount } = renderModal()
  expect((await screen.findAllByText('Modified network link')).length).toBeGreaterThan(0)
  expect(screen.getAllByText('synthetic.user').length).toBeGreaterThan(0)
  expect(vi.mocked(apiFetch)).toHaveBeenCalledWith('/api/v1/audit?target_table=port_connections&target_id=42&limit=200&offset=0')
  expect(screen.queryByRole('button', { name: /restore/i })).not.toBeInTheDocument()
  unmount(); client.clear()
})

it('keeps audit authorization failures visible instead of presenting an empty history', async () => {
  vi.mocked(apiFetch).mockResolvedValue({ ok: false, status: 403, text: async () => 'Access denied' } as Response)
  const { client, unmount } = renderModal()
  expect(await screen.findByText(/Access denied/)).toBeInTheDocument()
  expect(screen.queryByText('No activity recorded')).not.toBeInTheDocument()
  unmount(); client.clear()
})

it('lets keyboard and pointer users select the event detail without offering unsupported snapshot restore', async () => {
  vi.mocked(apiFetch).mockResolvedValue({
    ok: true,
    json: async () => [
      { id: 9, timestamp: '2026-11-09T12:00:00Z', action: 'UPDATE', target_table: 'port_connections', target_id: '42', user_id: 'synthetic.user', description: 'Changed endpoint', changes: { changed_fields: ['source_port'] } },
      { id: 8, timestamp: '2026-11-08T12:00:00Z', action: 'CREATE', target_table: 'port_connections', target_id: '42', user_id: 'synthetic.user', description: 'Created connection', changes: { changed_fields: ['created'] } },
    ],
  } as Response)
  const { client, unmount } = renderModal()
  const event = await screen.findByRole('button', { name: /CREATE.*Created connection/i })
  const user = userEvent.setup()
  for (let step = 0; step < 16 && document.activeElement !== event; step += 1) await user.tab()
  expect(document.activeElement).toBe(event)
  await user.keyboard('{Enter}')
  expect(screen.getByRole('heading', { name: 'Created connection' })).toBeInTheDocument()
  expect(screen.getByText(/created/)).toBeInTheDocument()
  unmount(); client.clear()
})
