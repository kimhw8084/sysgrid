import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useSearchParams } from 'react-router-dom'
import { usePageLeaveGuard } from './workspaceDeparture'
import {
  applyOperationalColumnState,
  getOperationalColumnLayoutSnapshot,
  isOperationalAutoResizeSource,
} from './OperationalGridSizing'

export function usePersistentJsonState<T>(
  storageKey: string,
  fallback: T | (() => T),
  normalizeStoredValue?: (value: unknown) => T
) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return typeof fallback === 'function' ? (fallback as () => T)() : fallback
    }
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw == null) {
        return typeof fallback === 'function' ? (fallback as () => T)() : fallback
      }
      const stored: unknown = JSON.parse(raw)
      return normalizeStoredValue ? normalizeStoredValue(stored) : stored as T
    } catch {
      return typeof fallback === 'function' ? (fallback as () => T)() : fallback
    }
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(storageKey, JSON.stringify(value))
  }, [storageKey, value])

  return [value, setValue] as const
}

export function useOperationalWorkspaceViewState<TSavedView, TWorkingState>({
  savedViewsStorageKey,
  activeViewStorageKey,
  sessionKey,
  workingStateStorageKey,
  initialSavedViews,
  initialWorkingState,
}: {
  savedViewsStorageKey: string
  activeViewStorageKey: string
  sessionKey: string
  workingStateStorageKey: string
  initialSavedViews: TSavedView[] | (() => TSavedView[])
  initialWorkingState: TWorkingState | (() => TWorkingState)
}) {
  const [savedViews, setSavedViews] = usePersistentJsonState<TSavedView[]>(
    savedViewsStorageKey,
    initialSavedViews
  )
  const [workingState, setWorkingState] = usePersistentJsonState<TWorkingState>(
    workingStateStorageKey,
    initialWorkingState
  )
  const [activeViewId, setActiveViewId] = useWorkspaceSessionValue<string | null>(
    sessionKey,
    null,
    () => {
      if (typeof window === 'undefined') return null
      return window.localStorage.getItem(activeViewStorageKey)
    }
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (activeViewId) {
      window.localStorage.setItem(activeViewStorageKey, activeViewId)
      return
    }
    window.localStorage.removeItem(activeViewStorageKey)
  }, [activeViewId, activeViewStorageKey])

  return {
    savedViews,
    setSavedViews,
    activeViewId,
    setActiveViewId,
    workingState,
    setWorkingState,
  } as const
}

export function useWorkspaceSessionValue<T>(
  sessionKey: string,
  initialValue: T,
  nextValueFactory: () => T
) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return nextValueFactory()
    const isFirstLoad = !window.sessionStorage.getItem(sessionKey)
    if (isFirstLoad) {
      window.sessionStorage.setItem(sessionKey, 'true')
      return initialValue
    }
    return nextValueFactory()
  })

  return [value, setValue] as const
}

export function useWorkspaceDismissHandlers({
  active,
  onDismiss,
  shouldDismiss,
}: {
  active: boolean
  onDismiss: () => void
  shouldDismiss: (target: HTMLElement) => boolean
}) {
  useEffect(() => {
    if (!active) return

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target && shouldDismiss(target)) onDismiss()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onDismiss()
    }

    document.addEventListener('click', handleClick)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('click', handleClick)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [active, onDismiss, shouldDismiss])
}

export type WorkspaceOverlayKey = 'display' | 'views' | 'bulk' | 'rowAction' | 'surface' | 'export'

export function useWorkspaceOverlayController() {
  const [activeOverlay, setActiveOverlay] = useState<WorkspaceOverlayKey | null>(null)

  const isOverlayOpen = useCallback((key: WorkspaceOverlayKey) => activeOverlay === key, [activeOverlay])

  const openOverlay = useCallback((key: WorkspaceOverlayKey) => {
    setActiveOverlay(key)
  }, [])

  const toggleOverlay = useCallback((key: WorkspaceOverlayKey) => {
    setActiveOverlay((current) => (current === key ? null : key))
  }, [])

  const closeOverlay = useCallback((key: WorkspaceOverlayKey) => {
    setActiveOverlay((current) => (current === key ? null : current))
  }, [])

  const dismissOverlays = useCallback(() => {
    setActiveOverlay(null)
  }, [])

  return {
    activeOverlay,
    isOverlayOpen,
    openOverlay,
    toggleOverlay,
    closeOverlay,
    dismissOverlays,
  }
}

export function useOperationalGridLayout(
  initialLayout: any[],
  hasSavedViewWidths: boolean
) {
  const [columnLayoutState, setColumnLayoutState] = useState<any[]>(initialLayout)
  const [hasManualColumnWidths, setHasManualColumnWidths] = useState(false)

  const preserveExplicitColumnWidths = Boolean((hasSavedViewWidths || hasManualColumnWidths) && columnLayoutState.length)

  const syncColumnLayoutState = useCallback((api: any, _preserveWidths: boolean = preserveExplicitColumnWidths) => {
    const nextLayout = getOperationalColumnLayoutSnapshot(api, true)
    if (!nextLayout.length) return
    setColumnLayoutState(nextLayout)
  }, [preserveExplicitColumnWidths])

  const applyColumnLayoutState = useCallback((
    api: any,
    layout: any[] = columnLayoutState,
    preserveWidths: boolean = preserveExplicitColumnWidths
  ) => {
    applyOperationalColumnState(api, layout, preserveWidths)
  }, [columnLayoutState, preserveExplicitColumnWidths])

  const handleColumnResized = useCallback((event: any) => {
    if (!event.finished) return
    const source = event.source || ''
    if (typeof window !== 'undefined') {
      ;(window as any).__DEBUG_LAST_RESIZE_SOURCE__ = source
      ;(window as any).__DEBUG_LAST_RESIZE_STATE__ = event.api?.getColumnState?.() || []
    }
    const nextState = event.api?.getColumnState?.() || []
    const previousState = columnLayoutState || []
    const previousWidths = new Map(previousState.map((column: any) => [column.colId, column.width]))
    const changedColumns = nextState.filter((column: any) => previousWidths.get(column.colId) !== column.width)
    const widthChanged = changedColumns.length > 0
    const isAutoResizeSource = isOperationalAutoResizeSource(source)

    if (!isAutoResizeSource) {
      const isAccidentalResize = !widthChanged || changedColumns.length !== 1 || changedColumns.some((column: any) => {
        const previousWidth = previousWidths.get(column.colId)
        return previousWidth == null || column.width == null || Math.abs(column.width - previousWidth) <= 1
      })
      if (isAccidentalResize) {
        applyColumnLayoutState(event.api, previousState, true)
        return
      }
      setHasManualColumnWidths(true)
      syncColumnLayoutState(event.api, true)
      return
    }
    syncColumnLayoutState(event.api, false)
  }, [applyColumnLayoutState, columnLayoutState, syncColumnLayoutState])

  const setTransientManualColumnWidths = useCallback((value: boolean) => {
    setHasManualColumnWidths(value)
  }, [])

  return {
    columnLayoutState,
    setColumnLayoutState,
    hasManualColumnWidths,
    setTransientManualColumnWidths,
    preserveExplicitColumnWidths,
    syncColumnLayoutState,
    applyColumnLayoutState,
    handleColumnResized,
  }
}

export function useOperationalColumnSyncHandlers(
  syncColumnLayoutState: (api: any, preserveWidths?: boolean) => void,
  preserveWidths: boolean
) {
  const handleColumnMoved = useCallback((event: any) => {
    if (!event?.source?.includes?.('drag')) syncColumnLayoutState(event.api, preserveWidths)
  }, [preserveWidths, syncColumnLayoutState])

  const handleDragStopped = useCallback((event: any) => {
    syncColumnLayoutState(event.api, preserveWidths)
  }, [preserveWidths, syncColumnLayoutState])

  const handleColumnPinned = useCallback((event: any) => {
    syncColumnLayoutState(event.api, preserveWidths)
  }, [preserveWidths, syncColumnLayoutState])

  const handleColumnVisible = useCallback((event: any) => {
    syncColumnLayoutState(event.api, preserveWidths)
  }, [preserveWidths, syncColumnLayoutState])

  return {
    handleColumnMoved,
    handleDragStopped,
    handleColumnPinned,
    handleColumnVisible,
  }
}

export const OPERATIONAL_GRID_LAYOUT_POLICIES = {
  standard: {
    syncSortPreserveWidths: false,
    preserveMovedWidths: false,
  },
} as const

export type OperationalGridLayoutPolicy = typeof OPERATIONAL_GRID_LAYOUT_POLICIES[keyof typeof OPERATIONAL_GRID_LAYOUT_POLICIES]

export function useOperationalGridController({
  pendingGridRestore,
  applyGridState,
  columnLayoutState,
  preserveExplicitColumnWidths,
  applyColumnLayoutState,
  initialFilterModel,
  initialSortModel,
  setGridFilterModel,
  setGridSortModel,
  sanitizeFilterModel,
  sanitizeSortModel,
  syncColumnLayoutState,
  syncSortPreserveWidths = true,
  onGridApiReady,
}: {
  pendingGridRestore?: any | null
  applyGridState: (config: any) => void
  columnLayoutState: any[]
  preserveExplicitColumnWidths: boolean
  applyColumnLayoutState: (api: any, layout?: any[], preserveWidths?: boolean) => void
  initialFilterModel?: Record<string, any>
  initialSortModel?: Array<{ colId?: string; sort?: string }>
  setGridFilterModel: (value: any) => void
  setGridSortModel: (value: any) => void
  sanitizeFilterModel?: (model: any) => any
  sanitizeSortModel?: (model: any) => any
  syncColumnLayoutState: (api: any, preserveWidths?: boolean) => void
  syncSortPreserveWidths?: boolean
  onGridApiReady?: (params: any) => void
}) {
  const handleGridReady = useCallback((params: any) => {
    onGridApiReady?.(params)
    if (pendingGridRestore) {
      applyGridState(pendingGridRestore)
      return
    }
    if (!columnLayoutState.length) return
    applyColumnLayoutState(params.api, columnLayoutState, preserveExplicitColumnWidths)
    params.api.setFilterModel(initialFilterModel || {})
    params.api.applyColumnState({
      state: (initialSortModel || []).map((entry) => ({ colId: entry.colId, sort: entry.sort as 'asc' | 'desc' })),
      defaultState: { sort: null },
      applyOrder: false,
    })
  }, [
    applyColumnLayoutState,
    applyGridState,
    columnLayoutState,
    initialFilterModel,
    initialSortModel,
    onGridApiReady,
    pendingGridRestore,
    preserveExplicitColumnWidths,
  ])

  const handleFilterChanged = useCallback((event: any) => {
    const nextModel = event.api.getFilterModel() || {}
    setGridFilterModel(sanitizeFilterModel ? sanitizeFilterModel(nextModel) : nextModel)
  }, [sanitizeFilterModel, setGridFilterModel])

  const handleSortChanged = useCallback((event: any) => {
    const nextSortModel = event.columnApi.getColumnState()
      .filter((column: any) => column.sort === 'asc' || column.sort === 'desc')
      .map((column: any) => ({ colId: column.colId, sort: column.sort }))
    setGridSortModel(sanitizeSortModel ? sanitizeSortModel(nextSortModel) : nextSortModel)
    syncColumnLayoutState(event.api, syncSortPreserveWidths)
  }, [sanitizeSortModel, setGridSortModel, syncColumnLayoutState, syncSortPreserveWidths])

  return {
    handleGridReady,
    handleFilterChanged,
    handleSortChanged,
  }
}

export function useOperationalWorkspaceController<TFilters = any, TQuickFilters = any>({
  initialFilterModel,
  initialQuickFilters,
}: {
  initialFilterModel?: TFilters;
  initialQuickFilters?: TQuickFilters;
}) {
  const [filterModel, setFilterModel] = useState<TFilters>(initialFilterModel ?? ({} as TFilters));
  const [quickFilters, setQuickFilters] = useState<TQuickFilters>(initialQuickFilters ?? ({} as TQuickFilters));

  return {
    filterModel,
    setFilterModel,
    quickFilters,
    setQuickFilters,
  };
}

export function useOperationalSelection(initialSelectedIds: number[] = []) {
  const [selectedIds, setSelectedIds] = useState<number[]>(initialSelectedIds);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const isSelected = useCallback((id: number) => {
    return selectedIds.includes(id);
  }, [selectedIds]);

  const hasSelection = useCallback(() => {
    return selectedIds.length > 0;
  }, [selectedIds]);

  const selectedCount = useMemo(() => selectedIds.length, [selectedIds]);

  return {
    selectedIds,
    setSelectedIds,
    clearSelection,
    isSelected,
    hasSelection,
    selectedCount,
  };
}

export function useOperationalGridRuntime({
  initialColumnLayoutState,
  hasSavedViewWidths,
  pendingGridRestore,
  applyGridState,
  initialFilterModel,
  initialSortModel,
  setGridFilterModel,
  setGridSortModel,
  sanitizeFilterModel,
  sanitizeSortModel,
  layoutPolicy = OPERATIONAL_GRID_LAYOUT_POLICIES.standard,
  onGridApiReady,
  onBeforeManualResize,
}: {
  initialColumnLayoutState: any[]
  hasSavedViewWidths: boolean
  pendingGridRestore?: any | null
  applyGridState: (config: any) => void
  initialFilterModel?: Record<string, any>
  initialSortModel?: Array<{ colId?: string; sort?: string }>
  setGridFilterModel: (value: any) => void
  setGridSortModel: (value: any) => void
  sanitizeFilterModel?: (model: any) => any
  sanitizeSortModel?: (model: any) => any
  layoutPolicy?: OperationalGridLayoutPolicy
  onGridApiReady?: (params: any) => void
  onBeforeManualResize?: (event: any) => void
}) {
  const {
    columnLayoutState,
    setColumnLayoutState,
    hasManualColumnWidths,
    setTransientManualColumnWidths,
    preserveExplicitColumnWidths,
    syncColumnLayoutState,
    applyColumnLayoutState,
    handleColumnResized: handleBaseColumnResized,
  } = useOperationalGridLayout(initialColumnLayoutState, hasSavedViewWidths)

  const {
    handleColumnMoved,
    handleDragStopped,
    handleColumnPinned,
    handleColumnVisible,
  } = useOperationalColumnSyncHandlers(syncColumnLayoutState, layoutPolicy.preserveMovedWidths)

  const handleColumnResized = useCallback((event: any) => {
    if (!event?.finished) return
    if (!isOperationalAutoResizeSource(event?.source || '')) {
      onBeforeManualResize?.(event)
    }
    handleBaseColumnResized(event)
  }, [handleBaseColumnResized, onBeforeManualResize])

  const {
    handleGridReady,
    handleFilterChanged,
    handleSortChanged,
  } = useOperationalGridController({
    pendingGridRestore,
    applyGridState,
    columnLayoutState,
    preserveExplicitColumnWidths,
    applyColumnLayoutState,
    initialFilterModel,
    initialSortModel,
    setGridFilterModel,
    setGridSortModel,
    sanitizeFilterModel,
    sanitizeSortModel,
    syncColumnLayoutState,
    syncSortPreserveWidths: layoutPolicy.syncSortPreserveWidths,
    onGridApiReady,
  })

  return {
    columnLayoutState,
    setColumnLayoutState,
    hasManualColumnWidths,
    setTransientManualColumnWidths,
    preserveExplicitColumnWidths,
    syncColumnLayoutState,
    applyColumnLayoutState,
    handleColumnResized,
    handleColumnMoved,
    handleDragStopped,
    handleColumnPinned,
    handleColumnVisible,
    handleGridReady,
    handleFilterChanged,
    handleSortChanged,
  }
}

export function useOperationalDirtyGuard({
  active,
  isDirty,
  resolveIsDirty,
  onDiscard,
}: {
  active: boolean
  isDirty: boolean
  resolveIsDirty?: () => boolean
  onDiscard: () => void
}) {
  const pendingActionRef = useRef<(() => void) | null>(null)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const blockedLocationRef = useRef<string | null>(null)
  const effectiveDirty = useMemo(
    () => active && (resolveIsDirty ? resolveIsDirty() : isDirty),
    [active, isDirty, resolveIsDirty]
  )
  const blocker = useBlocker(effectiveDirty)

  const requestDiscard = useCallback((action?: () => void) => {
    if (!active) return
    const nextAction = action || onDiscard
    if (!effectiveDirty) {
      nextAction()
      return
    }
    pendingActionRef.current = nextAction
    setIsConfirmOpen(true)
  }, [active, effectiveDirty, onDiscard])

  const confirmDiscard = useCallback(() => {
    const action = pendingActionRef.current || onDiscard
    pendingActionRef.current = null
    setIsConfirmOpen(false)
    action()
  }, [onDiscard])

  const cancelDiscard = useCallback(() => {
    if (blocker.state === 'blocked') {
      blocker.reset()
    }
    pendingActionRef.current = null
    setIsConfirmOpen(false)
  }, [blocker])

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      blockedLocationRef.current = null
      return
    }

    const nextLocationKey = `${blocker.location.pathname}${blocker.location.search}${blocker.location.hash}`
    // Router reset/proceed settles in a separate render. Keep the handled
    // location until the blocker is unblocked, otherwise dismissing the dialog
    // can immediately reopen it against the previous blocked navigation.
    if (blockedLocationRef.current === nextLocationKey) return

    blockedLocationRef.current = nextLocationKey
    pendingActionRef.current = () => blocker.proceed()
    setIsConfirmOpen(true)
  }, [blocker, isConfirmOpen])

  usePageLeaveGuard(effectiveDirty)

  useEffect(() => {
    if (!effectiveDirty) return
    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const href = anchor.href
      if (!href || href === window.location.href) return
      const hrefUrl = new URL(href, window.location.href)
      if (hrefUrl.origin === window.location.origin) return
      event.preventDefault()
      requestDiscard(() => {
        window.location.assign(href)
      })
    }
    document.addEventListener('click', handleDocumentClick, true)
    return () => document.removeEventListener('click', handleDocumentClick, true)
  }, [effectiveDirty, requestDiscard])

  return {
    requestDiscard,
    isConfirmOpen,
    confirmDiscard,
    cancelDiscard,
  }
}

export function useOperationalDetailRoute({
  allItems,
  detailItem,
  setDetailItem,
  setActiveTab,
  fetchDetailItem,
  isEditOpen = false,
  isHistoryOpen = false,
  isLinkOpen = false,
}: {
  allItems: any[] | undefined
  detailItem: any
  setDetailItem: (item: any) => void
  setActiveTab?: (tab: any) => void
  fetchDetailItem?: (id: string) => Promise<any>
  isEditOpen?: boolean
  isHistoryOpen?: boolean
  isLinkOpen?: boolean
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.toString()
  const idParam = searchParams.get('id')
  const isTransitioningRef = useRef(false)
  const skipStateToUrlSyncRef = useRef(false)
  const detailRequestRef = useRef(0)
  const pendingDetailRouteRef = useRef<string | null | undefined>(undefined)

  const clearDetailRoute = useCallback((options?: { replace?: boolean }) => {
    const replace = options?.replace ?? true
    const nextParams = new URLSearchParams(search)
    if (nextParams.has('id')) {
      nextParams.delete('id')
      setSearchParams(nextParams, { replace })
    }
  }, [search, setSearchParams])

  const openDetail = useCallback((item: any, options?: { replace?: boolean }) => {
    const replace = options?.replace ?? true
    isTransitioningRef.current = false
    pendingDetailRouteRef.current = item ? String(item.id) : null
    setDetailItem(item)
    if (item) {
      const nextParams = new URLSearchParams(search)
      nextParams.set('id', String(item.id))
      setSearchParams(nextParams, { replace })
    }
  }, [search, setDetailItem, setSearchParams])

  const closeDetail = useCallback((options?: { replace?: boolean }) => {
    isTransitioningRef.current = false
    pendingDetailRouteRef.current = null
    setDetailItem(null)
    clearDetailRoute(options)
  }, [setDetailItem, clearDetailRoute])

  const openEditFromDetail = useCallback((item: any, callback?: () => void, options?: { replace?: boolean }) => {
    isTransitioningRef.current = true
    setDetailItem(null)
    clearDetailRoute(options)
    if (callback) callback()
  }, [setDetailItem, clearDetailRoute])

  const openHistoryFromDetail = useCallback((item: any, callback?: () => void, options?: { replace?: boolean }) => {
    isTransitioningRef.current = true
    setDetailItem(null)
    clearDetailRoute(options)
    if (callback) callback()
  }, [setDetailItem, clearDetailRoute])

  const openLinkFromDetail = useCallback((item: any, callback?: () => void, options?: { replace?: boolean }) => {
    isTransitioningRef.current = true
    setDetailItem(null)
    clearDetailRoute(options)
    if (callback) callback()
  }, [setDetailItem, clearDetailRoute])

  // 1. URL -> State sync (Deep linking)
  useEffect(() => {
    if (!Array.isArray(allItems)) return

    if (pendingDetailRouteRef.current !== undefined) {
      if (pendingDetailRouteRef.current !== idParam) return
      pendingDetailRouteRef.current = undefined
    }

    // If we are currently transitioning or a modal is open, don't sync from URL
    if (isTransitioningRef.current || isEditOpen || isHistoryOpen || isLinkOpen) return

    if (!idParam) {
      if (detailItem) {
        skipStateToUrlSyncRef.current = true
        setDetailItem(null)
      }
      return
    }

    const target = allItems.find((item: any) => String(item.id) === idParam)
    if (!target) {
      if (fetchDetailItem) {
        if (detailItem && String(detailItem.id) === idParam) return
        const requestId = ++detailRequestRef.current
        let cancelled = false
        if (detailItem && String(detailItem.id) !== idParam) {
          skipStateToUrlSyncRef.current = true
          setDetailItem(null)
        }
        fetchDetailItem(idParam)
          .then((resolvedItem) => {
            if (cancelled || requestId !== detailRequestRef.current) return
            if (!resolvedItem) {
              skipStateToUrlSyncRef.current = true
              setDetailItem(null)
              clearDetailRoute()
              return
            }
            if (setActiveTab) {
              const isDeleted = resolvedItem.is_deleted || resolvedItem.status === 'Deleted' || resolvedItem.status === 'Archived'
              setActiveTab(isDeleted ? 'deleted' : 'active')
            }
            skipStateToUrlSyncRef.current = true
            setDetailItem(resolvedItem)
          })
          .catch(() => {
            if (!cancelled && requestId === detailRequestRef.current) clearDetailRoute()
          })
        return () => { cancelled = true }
      }
      clearDetailRoute()
      if (detailItem) {
        skipStateToUrlSyncRef.current = true
        setDetailItem(null)
      }
      return
    }

    if (setActiveTab) {
      const isDeleted = target.is_deleted || target.status === 'Deleted' || target.status === 'Archived'
      setActiveTab(isDeleted ? 'deleted' : 'active')
    }

    if (!detailItem || String(detailItem.id) !== idParam || detailItem !== target) {
      skipStateToUrlSyncRef.current = true
      setDetailItem(target)
    }
  }, [allItems, idParam, setSearchParams, detailItem, clearDetailRoute, setActiveTab, fetchDetailItem, isEditOpen, isHistoryOpen, isLinkOpen])

  // 2. State -> URL sync (handles direct closing from ESC or backdrop click)
  useEffect(() => {
    if (isTransitioningRef.current || isEditOpen || isHistoryOpen || isLinkOpen) return
    if (skipStateToUrlSyncRef.current) {
      skipStateToUrlSyncRef.current = false
      return
    }

    const nextParams = new URLSearchParams(search)
    if (detailItem) {
      if (nextParams.get('id') !== String(detailItem.id)) {
        nextParams.set('id', String(detailItem.id))
        setSearchParams(nextParams, { replace: true })
      }
    } else {
      if (idParam) return
      if (nextParams.has('id')) {
        nextParams.delete('id')
        setSearchParams(nextParams, { replace: true })
      }
    }
  }, [detailItem, idParam, search, setSearchParams, isEditOpen, isHistoryOpen, isLinkOpen])

  const finishTransition = useCallback(() => {
    isTransitioningRef.current = false
  }, [])

  useEffect(() => {
    if (!isEditOpen && !isHistoryOpen && !isLinkOpen) {
      isTransitioningRef.current = false
    }
  }, [isEditOpen, isHistoryOpen, isLinkOpen])

  return {
    openDetail,
    closeDetail,
    clearDetailRoute,
    openEditFromDetail,
    openHistoryFromDetail,
    openLinkFromDetail,
    finishTransition,
  }
}
