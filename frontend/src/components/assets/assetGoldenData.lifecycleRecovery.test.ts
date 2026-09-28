import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isAssetLifecycleRecoveryBlocked,
  revokePurgedAssetLifecycleOperation,
  useAssetGoldenWorkspace,
  type AssetLifecycleOperation,
} from './assetGoldenData'

const { apiFetchMock, showWorkspaceToastMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  showWorkspaceToastMock: vi.fn(),
}))

vi.mock('../../api/apiClient', () => ({ apiFetch: apiFetchMock }))
vi.mock('../shared/WorkspaceToast', () => ({
  dismissWorkspaceToasts: vi.fn(),
  showWorkspaceToast: showWorkspaceToastMock,
}))

const recovery = (ids: number[], targetLabels: string[]): AssetLifecycleOperation => Object.freeze({
  ids: Object.freeze(ids),
  originalAction: 'delete',
  inverseAction: 'restore',
  targetLabels: Object.freeze(targetLabels),
})

describe('revokePurgedAssetLifecycleOperation', () => {
  it('preserves the exact recovery when a purge has no overlapping IDs', () => {
    const operation = recovery([11, 12], ['Asset A', 'Asset B'])

    expect(revokePurgedAssetLifecycleOperation(operation, [13])).toBe(operation)
  })

  it('clears recovery when every tracked ID was purged', () => {
    expect(revokePurgedAssetLifecycleOperation(
      recovery([11, 12], ['Asset A', 'Asset B']),
      [12, 11],
    )).toBeNull()
  })

  it('keeps only unpurged IDs with their matching labels and inverse semantics', () => {
    const operation = recovery([11, 12, 13], ['Asset A', 'Asset B', 'Asset C'])

    expect(revokePurgedAssetLifecycleOperation(operation, [12])).toEqual({
      ids: [11, 13],
      originalAction: 'delete',
      inverseAction: 'restore',
      targetLabels: ['Asset A', 'Asset C'],
    })
  })

  it('clears only an overlapping recovery when its ID-to-label mapping is ambiguous', () => {
    const operation = recovery([11, 12], ['Asset A'])

    expect(revokePurgedAssetLifecycleOperation(operation, [12])).toBeNull()
  })
})

describe('isAssetLifecycleRecoveryBlocked', () => {
  const operation = recovery([11, 12], ['Asset A', 'Asset B'])

  it('does not block when there is no pending mutation', () => {
    expect(isAssetLifecycleRecoveryBlocked(operation, {
      isPending: false,
      variables: { action: 'purge', ids: [11] },
    })).toBe(false)
  })

  it('keeps recovery usable during a disjoint pending purge', () => {
    expect(isAssetLifecycleRecoveryBlocked(operation, {
      isPending: true,
      variables: { action: 'purge', ids: [13] },
    })).toBe(false)
  })

  it('blocks full and partial overlap during a pending purge', () => {
    expect(isAssetLifecycleRecoveryBlocked(operation, {
      isPending: true,
      variables: { action: 'purge', ids: [12, 11] },
    })).toBe(true)
    expect(isAssetLifecycleRecoveryBlocked(operation, {
      isPending: true,
      variables: { action: 'purge', ids: [12, 13] },
    })).toBe(true)
  })

  it('fails closed when a pending purge identity is missing or malformed', () => {
    expect(isAssetLifecycleRecoveryBlocked(operation, { isPending: true })).toBe(true)
    expect(isAssetLifecycleRecoveryBlocked(operation, {
      isPending: true,
      variables: { action: 'purge', ids: [] },
    })).toBe(true)
    expect(isAssetLifecycleRecoveryBlocked(operation, {
      isPending: true,
      variables: { action: 'purge', ids: ['11'] },
    })).toBe(true)
    expect(isAssetLifecycleRecoveryBlocked(operation, {
      isPending: true,
      variables: { ids: [11] },
    })).toBe(true)
  })
})

describe('Asset lifecycle direct recovery guard', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    showWorkspaceToastMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('blocks a stale executeRevert callback while an overlapping purge is pending', async () => {
    let settlePurge!: (response: Response) => void
    const purgeResponse = new Promise<Response>((resolve) => { settlePurge = resolve })
    const jsonResponse = (body: unknown) => ({
      ok: true,
      json: async () => body,
      text: async () => '',
    } as Response)

    apiFetchMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (!path.endsWith('/bulk-action')) return jsonResponse([])
      const body = JSON.parse(String(options?.body || '{}')) as { action?: string; dry_run?: boolean; ids?: number[] }
      if (body.action === 'purge' && body.dry_run !== true) return purgeResponse
      return jsonResponse({ changed_count: body.ids?.length || 0, changed_ids: body.ids || [], unchanged_count: 0 })
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => createElement(
      MemoryRouter,
      null,
      createElement(QueryClientProvider, { client: queryClient }, children),
    )
    const { result, unmount } = renderHook(() => useAssetGoldenWorkspace(), { wrapper })

    try {
      await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(4))
      act(() => result.current.bulkMutation.mutate({ action: 'delete', ids: [11], targetLabels: ['Asset A'] }))
      await waitFor(() => expect(result.current.lastLifecycleOperation?.ids).toEqual([11]))
      const operation = result.current.lastLifecycleOperation!
      const staleExecuteRevert = result.current.executeRevert

      act(() => result.current.bulkMutation.mutate({ action: 'purge', ids: [11] }))
      await waitFor(() => expect(result.current.bulkMutation.isPending).toBe(true))
      expect(result.current.isLastLifecycleRecoveryBlocked).toBe(true)

      await act(async () => { await staleExecuteRevert(operation) })
      const bulkRequests = apiFetchMock.mock.calls
        .filter(([path]) => path.endsWith('/bulk-action'))
        .map(([, options]) => JSON.parse(String(options?.body || '{}')) as { action?: string; ids?: number[] })
      expect(bulkRequests.map(({ action }) => action)).toEqual(['delete', 'purge'])
      expect(result.current.lastLifecycleOperation).toBe(operation)
      expect(showWorkspaceToastMock).toHaveBeenCalledWith(
        'Wait for the overlapping permanent purge to finish before reverting this asset operation',
        { type: 'error' },
      )

      await act(async () => {
        settlePurge(jsonResponse({ changed_count: 1, changed_ids: [11], unchanged_count: 0 }))
      })
      await waitFor(() => expect(result.current.bulkMutation.isPending).toBe(false))
      expect(result.current.lastLifecycleOperation).toBeNull()
    } finally {
      unmount()
      queryClient.clear()
    }
  })
})
