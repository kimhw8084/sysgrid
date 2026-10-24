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

function workspace(primary: boolean | Promise<any[]> = false, cachedLive?: any[]) {
  vi.mocked(apiFetch).mockImplementation(async path => {
    if (String(path).includes('include_deleted=true')) {
      if (primary === true) throw new Error('Primary query unavailable')
      return { ok: true, json: async () => primary instanceof Promise ? primary : [active, archived] } as Response
    }
    return { ok: true, json: async () => String(path) === '/api/v1/devices/' ? [active] : [] } as Response
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (cachedLive) client.setQueryData(['devices'], cachedLive)
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

it('does not report cached live devices as a failure while the primary request is pending', async () => {
  let resolve!: (rows: any[]) => void
  const primary = new Promise<any[]>(done => { resolve = done })
  const { result } = workspace(primary, [active])
  expect(result.current.dataState.kind).toBe('loading')
  expect(result.current.dataState.noRowsLabel).toBe('Loading asset registry…')
  expect(result.current.dataState.notice).toBeUndefined()
  expect(result.current.allAssets).toEqual([])
  act(() => resolve([active, archived]))
  await waitFor(() => expect(result.current.allAssets).toHaveLength(2))
  expect(result.current.dataState.notice).toBeUndefined()
  expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path === '/api/v1/devices/')).toBe(false)
})

it('treats a successful empty primary response as authoritative over stale cached devices', async () => {
  const { result } = workspace(Promise.resolve([]), [active])
  await waitFor(() => expect(result.current.dataState.kind).toBe('raw-empty'))
  expect(result.current.allAssets).toEqual([])
  expect(result.current.devices).toEqual([])
  expect(result.current.dataState.notice).toBeUndefined()
})

it('shows the real fallback after a pending primary request fails', async () => {
  let reject!: (error: Error) => void
  const primary = new Promise<any[]>((_, fail) => { reject = fail })
  const { result } = workspace(primary, [active])
  expect(result.current.dataState.notice).toBeUndefined()
  act(() => reject(new Error('Primary query unavailable')))
  await waitFor(() => expect(result.current.dataState.notice?.title).toBe('Showing live fallback rows only'))
  expect(result.current.allAssets.map((row: any) => row.id)).toEqual([1])
})

it('clears a genuine fallback on recovery and does not resurrect cached rows when the recovered registry becomes empty', async () => {
  const { result, client } = workspace(true, [active])
  await waitFor(() => expect(result.current.dataState.notice?.title).toBe('Showing live fallback rows only'))
  act(() => client.setQueryData(['asset-golden-devices'], [active, archived]))
  await waitFor(() => expect(result.current.allAssets).toHaveLength(2))
  expect(result.current.dataState.notice).toBeUndefined()
  act(() => client.setQueryData(['asset-golden-devices'], []))
  await waitFor(() => expect(result.current.dataState.kind).toBe('raw-empty'))
  expect(result.current.allAssets).toEqual([])
  expect(result.current.dataState.notice).toBeUndefined()
})

it('updates selectable hosts after archive and restore without changing the inventory rows', async () => {
  const { result, client } = workspace()
  await waitFor(() => expect(result.current.allAssets).toHaveLength(2))
  expect(result.current.devices.map((row: any) => row.id)).toEqual([1])
  act(() => client.setQueryData(['asset-golden-devices'], [{ ...active, is_deleted: true }, { ...archived, is_deleted: false }]))
  await waitFor(() => expect(result.current.devices.map((row: any) => row.id)).toEqual([2]))
  expect(result.current.allAssets.map((row: any) => row.id)).toEqual([1, 2])
})
