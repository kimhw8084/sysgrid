import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { apiFetch } from '../../api/apiClient'
import { fetchAssetArray } from './assetDataState'
import { AssetDetailsView } from './AssetDetailsView'

vi.mock('../../api/apiClient', () => ({ apiFetch: vi.fn() }))
vi.mock('../AssetGrid_Legacy', () => ({ AssetServicesTable: () => null, MetadataViewer: () => null, MiniMonitoringTable: () => null }))
vi.mock('../../policy/ModulePolicy', () => ({
  ModulePolicyButton: ({ children, ...props }: any) => {
    const { moduleId: _moduleId, disabledReason: _disabledReason, ...buttonProps } = props
    return <button type="button" {...buttonProps}>{children}</button>
  },
}))

const device = { id: 12, name: 'Compute 12', system: 'ERP', type: 'Server', status: 'Active' }
let client: QueryClient
let serviceRequests = 0
let knowledgeRequests = 0

function renderDetails() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AssetDetailsView device={device} options={[]} onViewServiceDetails={() => {}} onEditService={() => {}} onEditLink={() => {}} onViewLink={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  serviceRequests = 0
  knowledgeRequests = 0
  vi.mocked(apiFetch).mockImplementation(async (endpoint) => {
    if (String(endpoint).startsWith('/api/v1/logical-services/')) {
      serviceRequests += 1
      if (serviceRequests === 1) throw new Error('Service endpoint unavailable')
    }
    if (String(endpoint).startsWith('/api/v1/knowledge?')) {
      knowledgeRequests += 1
      if (knowledgeRequests === 1) throw new Error('Knowledge endpoint unavailable')
    }
    return { json: async () => [] } as Response
  })
})

afterEach(() => {
  cleanup()
  client?.clear()
  vi.clearAllMocks()
})

it('rejects a successful response that is not a list', async () => {
  vi.mocked(apiFetch).mockResolvedValue({ json: async () => ({ detail: 'unexpected shape' }) } as Response)
  await expect(fetchAssetArray('/api/v1/devices/12/hardware')).rejects.toMatchObject({ message: 'Asset data returned an invalid list response.', silent: true })
})

it('keeps failed asset reads in the inline recovery UI without duplicating them as global toasts', async () => {
  const failure = new Error('Asset registry unavailable') as Error & { silent?: boolean }
  vi.mocked(apiFetch).mockRejectedValue(failure)
  await expect(fetchAssetArray('/api/v1/devices/?include_deleted=true')).rejects.toBe(failure)
  expect(failure.silent).toBe(true)
})

it('shows failed context data as unavailable and recovers through retry', async () => {
  renderDetails()

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('services')
  expect(alert).toHaveTextContent('runbooks')
  expect(alert).toHaveTextContent('unknown until recovered')
  expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  expect(screen.queryByText('No linked runbooks identified')).not.toBeInTheDocument()
  expect(screen.getByText('Linked runbooks unavailable')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable data' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(screen.getByText('No linked runbooks identified')).toBeInTheDocument()
  expect(screen.getAllByText('0').length).toBeGreaterThan(0)
  expect(serviceRequests).toBe(2)
  expect(knowledgeRequests).toBe(2)
})
