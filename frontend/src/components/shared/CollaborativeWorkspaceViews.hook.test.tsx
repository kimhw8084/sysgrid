import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { apiClient } from '../../api/apiClient'
import {
  useCollaborativeWorkspaceViews,
  type CollaborativeSavedView,
  type WorkspaceViewApiRecord,
} from './CollaborativeWorkspaceViews'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn(), remove: vi.fn() } }))

type Config = {
  groupBy: string
  quickFilter?: string
  columnLayoutState?: Array<Record<string, unknown>>
}
type View = CollaborativeSavedView<Config>

const SYSTEM_VIEW_IDS = new Set(['core'])

const normalizeViews = (views: View[]) => {
  const byId = new Map<string, View>()
  views.forEach((view) => byId.set(view.id, view))
  return Array.from(byId.values())
}

const sanitizeDefinition = (raw: unknown): Config => {
  const value = raw && typeof raw === 'object' ? raw as Partial<Config> : {}
  return {
    groupBy: typeof value.groupBy === 'string' ? value.groupBy : 'raw',
    ...(typeof value.quickFilter === 'string' && value.quickFilter.trim()
      ? { quickFilter: value.quickFilter.trim() }
      : {}),
    ...(Array.isArray(value.columnLayoutState)
      ? { columnLayoutState: value.columnLayoutState.map((entry) => ({ ...entry })) }
      : {}),
  }
}

function remoteRecord(overrides: Partial<WorkspaceViewApiRecord<Config>> = {}): WorkspaceViewApiRecord<Config> {
  return {
    id: 9,
    workspace_key: 'monitoring',
    name: 'Server view',
    scope: 'personal',
    owner_user_id: 'admin_root',
    team_id: null,
    definition: { groupBy: 'status' },
    schema_version: 1,
    revision: 2,
    ...overrides,
  }
}

function useHarness({
  initialViews,
  activeViewId,
  currentDefinition,
  onActiveViewIdChange,
}: {
  initialViews: View[]
  activeViewId: string | null
  currentDefinition: Config
  onActiveViewIdChange?: (id: string | null) => void
}) {
  const [views, setViews] = useState(initialViews)
  const collaborative = useCollaborativeWorkspaceViews({
    workspaceKey: 'monitoring',
    migrationKey: 'test-collaborative-migration-v1',
    systemViewIds: SYSTEM_VIEW_IDS,
    currentViews: views,
    setCurrentViews: setViews,
    normalizeViews,
    sanitizeDefinition,
    activeViewId,
    onActiveViewIdChange,
    currentDefinition,
  })
  return { views, collaborative }
}

describe('useCollaborativeWorkspaceViews', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  describe('clipboard outcome', () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const originalUrl = location.href
    afterEach(() => {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
      else Reflect.deleteProperty(navigator, 'clipboard')
      history.replaceState(null, '', originalUrl)
      vi.clearAllMocks()
    })
    async function copyHarness(writeText?: (text: string) => Promise<void>) {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText ? { writeText } : undefined })
      vi.spyOn(apiClient, 'get').mockResolvedValue({ views: [remoteRecord()] })
      history.replaceState(null, '', '/monitoring?id=12#details')
      const { result } = renderHook(() => useHarness({ initialViews: [], activeViewId: '9', currentDefinition: { groupBy: 'status' } }))
      await waitFor(() => expect(result.current.collaborative.status).toBe('synced'))
      return result
    }

    it('waits for clipboard completion and suppresses overlapping copies', async () => {
      let resolve!: () => void
      const write = vi.fn((_text: string) => new Promise<void>(done => { resolve = done }))
      const result = await copyHarness(write)
      let pending!: Promise<string>
      act(() => { pending = result.current.collaborative.copyViewLink('9') })
      expect(result.current.collaborative.copyingLink).toBe(true)
      expect(toast.success).not.toHaveBeenCalled()
      await act(async () => { await result.current.collaborative.copyViewLink('9') })
      expect(write).toHaveBeenCalledTimes(1)
      await act(async () => { resolve(); await pending })
      expect(result.current.collaborative.copyingLink).toBe(false)
      expect(toast.success).toHaveBeenCalledWith('View link copied', { id: result.current.collaborative.successNoticeId })
      expect(toast.error).not.toHaveBeenCalled()
      expect(new URL(write.mock.calls[0][0]).searchParams.get('view')).toBe('9')
      expect(location.hash).toBe('#details')
      expect(new URL(location.href).searchParams.get('id')).toBe('12')
    })

    it('keeps a manual-copy URL after rejection and replaces failure on a successful retry', async () => {
      const write = vi.fn().mockRejectedValueOnce(new Error('Browser-specific private reason')).mockResolvedValueOnce(undefined)
      const result = await copyHarness(write)
      await act(async () => { await result.current.collaborative.copyViewLink('9') })
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith('Could not copy the view link. Copy the URL from your address bar.', { id: expect.any(String) })
      expect(new URL(location.href).searchParams.get('view')).toBe('9')
      expect(result.current.collaborative.copyingLink).toBe(false)
      await act(async () => { await result.current.collaborative.copyViewLink('9') })
      const errorId = vi.mocked(toast.error).mock.calls[0][1]!.id
      expect(errorId).not.toBe(result.current.collaborative.successNoticeId)
      expect(toast.remove).toHaveBeenCalledWith(errorId)
      expect(toast.remove).toHaveBeenCalledTimes(1)
      expect(toast.success).toHaveBeenCalledWith('View link copied', { id: result.current.collaborative.successNoticeId })
    })

    it('reports unavailable clipboard and preserves the system-view URL', async () => {
      const result = await copyHarness()
      history.replaceState(null, '', '/monitoring?view=9&id=12#details')
      await act(async () => { await result.current.collaborative.copyViewLink(null) })
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledTimes(1)
      expect(new URL(location.href).searchParams.has('view')).toBe(false)
      expect(new URL(location.href).searchParams.get('id')).toBe('12')
      expect(result.current.collaborative.copyingLink).toBe(false)
    })

    it('contains synchronous clipboard failure and clears pending state', async () => {
      const result = await copyHarness(() => { throw new Error('Clipboard unavailable') })
      await act(async () => { await result.current.collaborative.copyViewLink('9') })
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledTimes(1)
      expect(result.current.collaborative.copyingLink).toBe(false)
    })
  })

  it('hydrates remote views and migrates each local view only once', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ views: [remoteRecord()] })
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue(remoteRecord({ id: 10, name: 'Legacy local' }))
    const initialViews: View[] = [
      { id: 'core', name: 'Core', config: { groupBy: 'raw' }, source: 'system' },
      { id: 'legacy-local', name: 'Legacy local', config: { groupBy: 'platform' }, source: 'local' },
    ]

    const onActiveViewIdChange = vi.fn()
    const first = renderHook(() => useHarness({
      initialViews,
      activeViewId: 'legacy-local',
      onActiveViewIdChange,
      currentDefinition: { groupBy: 'platform' },
    }))

    await waitFor(() => expect(first.result.current.collaborative.status).toBe('synced'))
    expect(get).toHaveBeenCalledWith('/api/v1/workspaces/monitoring/views')
    expect(post).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('test-collaborative-migration-v1')).toBe('1')
    expect(first.result.current.views.map((view) => view.id)).toEqual(['core', '9', '10'])
    expect(onActiveViewIdChange).toHaveBeenCalledWith('10')
    first.unmount()

    const second = renderHook(() => useHarness({
      initialViews,
      activeViewId: null,
      currentDefinition: { groupBy: 'raw' },
    }))
    await waitFor(() => expect(second.result.current.collaborative.status).toBe('synced'))
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('sanitizes remote definitions before they are applied to client state', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      views: [remoteRecord({ definition: { groupBy: 'status', quickFilter: '  critical  ' } })],
    })
    localStorage.setItem('test-collaborative-migration-v1', '1')

    const { result } = renderHook(() => useHarness({
      initialViews: [],
      activeViewId: '9',
      currentDefinition: { groupBy: 'status', quickFilter: 'critical' },
    }))

    await waitFor(() => expect(result.current.collaborative.status).toBe('synced'))
    expect(result.current.views[0].config).toEqual({ groupBy: 'status', quickFilter: 'critical' })
    expect(result.current.collaborative.dirty).toBe(false)
  })

  it('treats a backend-stripped column layout round-trip as synced', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      views: [remoteRecord({
        definition: {
          groupBy: 'status',
          columnLayoutState: [
            { colId: 'status', hide: false, pinned: null, width: 131 },
          ],
        },
      })],
    })
    localStorage.setItem('test-collaborative-migration-v1', '1')

    const { result } = renderHook(() => useHarness({
      initialViews: [],
      activeViewId: '9',
      currentDefinition: {
        groupBy: 'status',
        columnLayoutState: [
          { colId: 'status', hide: false, pinned: null, width: 131, flex: null, sort: null, sortIndex: null },
        ],
      },
    }))

    await waitFor(() => expect(result.current.collaborative.status).toBe('synced'))
    expect(result.current.collaborative.dirty).toBe(false)
    expect(result.current.views[0].config.columnLayoutState).toEqual([
      { colId: 'status', hide: false, pinned: null, width: 131 },
    ])
  })

  it('sends and stores the backend-canonical definition when creating a view', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ views: [] })
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue(remoteRecord({
      definition: {
        groupBy: 'status',
        columnLayoutState: [
          { colId: 'status', hide: false, pinned: null, width: 131 },
        ],
      },
    }))
    localStorage.setItem('test-collaborative-migration-v1', '1')

    const { result } = renderHook(() => useHarness({
      initialViews: [],
      activeViewId: null,
      currentDefinition: { groupBy: 'raw' },
    }))
    await waitFor(() => expect(result.current.collaborative.status).toBe('synced'))

    await act(async () => {
      const mutation = await result.current.collaborative.createView('Canonical', {
        groupBy: 'status',
        columnLayoutState: [
          { colId: 'status', hide: false, pinned: null, width: 131, flex: null, sort: null, sortIndex: null },
        ],
      })
      expect(mutation.persisted).toBe(true)
      expect(mutation.view?.config.columnLayoutState).toEqual([
        { colId: 'status', hide: false, pinned: null, width: 131 },
      ])
    })

    expect(post).toHaveBeenCalledWith('/api/v1/workspaces/monitoring/views', expect.objectContaining({
      definition: {
        groupBy: 'status',
        columnLayoutState: [
          { colId: 'status', hide: false, pinned: null, width: 131 },
        ],
      },
    }))
  })

  it('reports normalized dirty state only for meaningful changes', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ views: [remoteRecord()] })
    localStorage.setItem('test-collaborative-migration-v1', '1')

    const { result, rerender } = renderHook(
      ({ currentDefinition }) => useHarness({
        initialViews: [],
        activeViewId: '9',
        currentDefinition,
      }),
      { initialProps: { currentDefinition: { groupBy: 'status' } as Config } },
    )

    await waitFor(() => expect(result.current.collaborative.status).toBe('synced'))
    expect(result.current.collaborative.dirty).toBe(false)

    rerender({ currentDefinition: { quickFilter: ' critical ', groupBy: 'status' } })
    await waitFor(() => expect(result.current.collaborative.status).toBe('unsaved'))
    expect(result.current.collaborative.dirty).toBe(true)
  })

  it('surfaces atomic revision conflicts and can reload the server copy', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ views: [remoteRecord()] })
    vi.spyOn(apiClient, 'put').mockRejectedValue({
      status: 409,
      data: { detail: { message: 'Saved view changed on the server.', current: remoteRecord({ revision: 3, definition: { groupBy: 'platform' } }) } },
    })
    localStorage.setItem('test-collaborative-migration-v1', '1')

    const { result } = renderHook(() => useHarness({
      initialViews: [],
      activeViewId: '9',
      currentDefinition: { groupBy: 'severity' },
    }))
    await waitFor(() => expect(result.current.views).toHaveLength(1))

    await act(async () => {
      const mutation = await result.current.collaborative.updateView('9', 'Server view', { groupBy: 'severity' })
      expect(mutation.conflict).toBe(true)
    })
    expect(result.current.collaborative.status).toBe('conflict')

    act(() => result.current.collaborative.reloadConflict())
    expect(result.current.collaborative.status).toBe('unsaved')
    expect(result.current.views[0].revision).toBe(3)
    expect(result.current.views[0].config.groupBy).toBe('platform')
  })

  it('uses a local fallback only for connectivity/server failures, not validation conflicts', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue({ status: 0, data: { detail: 'offline' } })
    const post = vi.spyOn(apiClient, 'post')
      .mockRejectedValueOnce({ status: 0, data: { detail: 'offline' } })
      .mockRejectedValueOnce({ status: 409, data: { detail: 'A saved view with this name already exists.' } })

    const { result } = renderHook(() => useHarness({
      initialViews: [],
      activeViewId: null,
      currentDefinition: { groupBy: 'raw' },
    }))
    await waitFor(() => expect(result.current.collaborative.status).toBe('offline'))

    await act(async () => {
      const fallback = await result.current.collaborative.createView('Offline view', { groupBy: 'status' })
      expect(fallback.persisted).toBe(false)
      expect(fallback.view?.source).toBe('local')
    })
    expect(result.current.views).toHaveLength(1)

    await act(async () => {
      const rejected = await result.current.collaborative.createView('Duplicate', { groupBy: 'raw' })
      expect(rejected.view).toBeUndefined()
      expect(rejected.error).toContain('already exists')
    })
    expect(result.current.views).toHaveLength(1)
  })
})
