import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { apiFetch } from '../../api/apiClient'
import { useAssetGoldenWorkspace } from './assetGoldenData'

vi.mock('../../api/apiClient', () => ({ apiFetch: vi.fn() }))

const active = { id: 1, name: 'Current host', system: 'Host options', type: 'Physical', status: 'Active', is_deleted: false }
const archived = { ...active, id: 2, name: 'Archived host', is_deleted: true }
const views: Array<() => void> = []
afterEach(() => { views.splice(0).forEach(close => close()); localStorage.clear(); vi.clearAllMocks() })

function workspace(primaryFails = false) {
  vi.mocked(apiFetch).mockImplementation(async path => {
    if (String(path).includes('include_deleted=true')) {
      if (primaryFails) throw new Error('Primary query unavailable')
      return { ok: true, json: async () => [active, archived] } as Response
    }
    return { ok: true, json: async () => String(path) === '/api/v1/devices/' ? [active] : [] } as Response
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter><QueryClientProvider client={client}>{children}</QueryClientProvider></MemoryRouter>
  )
  const view = renderHook(() => useAssetGoldenWorkspace(), { wrapper })
  views.push(() => { view.unmount(); client.clear() })
  return { ...view, client }
}

it('supplies active hosts from the successful primary query while fallback stays disabled', async () => {
  const { result } = workspace()
  await waitFor(() => expect(result.current.allAssets).toHaveLength(2))
  expect(result.current.devices.map((row: any) => row.id)).toEqual([1])
  expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path === '/api/v1/devices/')).toBe(false)
})

it('retains the existing live-query fallback when the primary query fails', async () => {
  const { result } = workspace(true)
  await waitFor(() => expect(result.current.devices.map((row: any) => row.id)).toEqual([1]))
})

it('updates selectable hosts after archive and restore without changing the inventory rows', async () => {
  const { result, client } = workspace()
  await waitFor(() => expect(result.current.allAssets).toHaveLength(2))
  expect(result.current.devices.map((row: any) => row.id)).toEqual([1])
  act(() => client.setQueryData(['asset-golden-devices'], [{ ...active, is_deleted: true }, { ...archived, is_deleted: false }]))
  await waitFor(() => expect(result.current.devices.map((row: any) => row.id)).toEqual([2]))
  expect(result.current.allAssets.map((row: any) => row.id)).toEqual([1, 2])
})
