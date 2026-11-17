import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Maintenance from './Maintenance'

const api = vi.hoisted(() => ({ fetch: vi.fn() }))
const policy = vi.hoisted(() => ({
  current: {
    data: { modules: { assets: { actions: { read: true, write: true } }, monitoring: { actions: { write: true } } } },
    isError: false,
    refetch: vi.fn(),
  },
}))

vi.mock('../api/apiClient', () => ({
  apiFetch: (...args: any[]) => api.fetch(...args),
  getRequestScopeKey: () => 'test-scope',
}))
vi.mock('../policy/ModulePolicy', () => ({ useModulePolicy: () => policy.current }))

describe('Maintenance purpose and operational boundaries', () => {
  beforeEach(() => {
    api.fetch.mockImplementation(async (path: string) => ({
      json: async () => path.includes('/operational-actions/capabilities')
        ? { adapter: { adapter_id: 'simulation.recording.v1', production_capable: false }, identity: { access_role: 'ADMIN', actor_id: 'operator-1' } }
        : [],
    }))
  })

  it('explains durable scheduling records separately from simulated plans', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <MemoryRouter initialEntries={['/monitoring?workspace=maintenance']}>
        <QueryClientProvider client={queryClient}><Maintenance /></QueryClientProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('What this workspace is for')).toBeInTheDocument()
    expect(screen.getByText(/Creates a durable maintenance record/)).toBeInTheDocument()
    expect(screen.getByText(/does not make infrastructure changes/)).toBeInTheDocument()
    expect(screen.getByText(/recording adapter stores plan outcomes for review only/)).toBeInTheDocument()
    expect(screen.getByText(/live execution is not configured/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Simulate plan' })).toBeEnabled())
    expect(screen.getByRole('button', { name: 'New window' })).toBeEnabled()
  })
})
