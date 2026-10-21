import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'
import { parseAppDate } from '../utils/dateUtils'
import { useOperationalRowInteractions } from './shared/OperationalGridInteractions'
import { usePersistentJsonState } from './shared/OperationalWorkspaceHooks'
import { readOptionalStorage, writeOptionalStorage } from './shared/optionalStorage'
import type { FarGroupBy, FarQuickFilters } from './FAR.workspaceModel'

export const FAR_FAVORITES_STORAGE_KEY = 'sysgrid_far_favorites_v1'
export const FAR_WATCH_STORAGE_KEY = 'sysgrid_far_watch_v1'
export const FAR_LAST_VISITED_STORAGE_KEY = 'sysgrid_far_last_visited_v1'

export const normalizeFarPreferenceIds = (value: unknown): number[] => {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry > 0)))
}

export const toggleFarPreferenceId = (current: number[], value: number): number[] => {
  const ids = normalizeFarPreferenceIds(current)
  const id = Number(value)
  if (!Number.isFinite(id) || id <= 0) return ids
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id]
}

export const sortFarModesByFavorite = (rows: any[] | undefined, favoriteIds: number[]): any[] => {
  const favorites = new Set(normalizeFarPreferenceIds(favoriteIds))
  return (rows || [])
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftFavorite = favorites.has(Number(left.row?.id)) ? 1 : 0
      const rightFavorite = favorites.has(Number(right.row?.id)) ? 1 : 0
      return rightFavorite - leftFavorite || left.index - right.index
    })
    .map(({ row }) => row)
}

export const isFarRecentChange = (item: any, lastVisitedAt: number): boolean => {
  const changedAt = item?.updated_at || item?.created_at
  if (!changedAt || !Number.isFinite(lastVisitedAt) || lastVisitedAt <= 0) return false
  const changedTime = parseAppDate(changedAt)?.getTime() || 0
  return changedTime > lastVisitedAt
}

export function useFarOperatorIntelligence({
  rows,
  groupBy,
  searchTerm,
  quickFilters,
  onOpenDetail,
  gridRef,
}: {
  rows: any[]
  groupBy: FarGroupBy
  searchTerm: string
  quickFilters: FarQuickFilters
  onOpenDetail: (row: any) => void
  gridRef: RefObject<any>
}) {
  const [favoriteIds, setFavoriteIds] = usePersistentJsonState<number[]>(FAR_FAVORITES_STORAGE_KEY, [])
  const [watchIds, setWatchIds] = usePersistentJsonState<number[]>(FAR_WATCH_STORAGE_KEY, [])
  const [pendingIds, setPendingIds] = useState<number[]>([])
  const [isIntelligenceExpanded, setIsIntelligenceExpanded] = useState(false)
  const [lastVisitedAt] = useState<number>(() => {
    if (typeof window === 'undefined') return 0
    const value = Number(readOptionalStorage(FAR_LAST_VISITED_STORAGE_KEY))
    return Number.isFinite(value) && value > 0 ? value : 0
  })

  const normalizedFavoriteIds = useMemo(() => normalizeFarPreferenceIds(favoriteIds), [favoriteIds])
  const normalizedWatchIds = useMemo(() => normalizeFarPreferenceIds(watchIds), [watchIds])
  const orderedRows = useMemo(() => sortFarModesByFavorite(rows, normalizedFavoriteIds), [normalizedFavoriteIds, rows])
  const selectionScopeKey = useMemo(() => JSON.stringify({
    groupBy,
    search: searchTerm.trim(),
    quickFilters,
    visibleIds: orderedRows.map((row: any) => Number(row.id)),
  }), [groupBy, orderedRows, quickFilters, searchTerm])

  const toggleFavorite = useCallback((id: number) => {
    setFavoriteIds((current) => toggleFarPreferenceId(current, id))
  }, [setFavoriteIds])
  const toggleWatch = useCallback((id: number) => {
    setWatchIds((current) => toggleFarPreferenceId(current, id))
  }, [setWatchIds])
  const isRecentChange = useCallback((item: any) => isFarRecentChange(item, lastVisitedAt), [lastVisitedAt])

  const { handleRowClicked, handleRowDoubleClicked } = useOperationalRowInteractions({
    onRowDoubleClick: onOpenDetail,
    pendingIds,
    selectionScopeKey,
  })
  const rowInteractions = useMemo(() => ({ handleRowClicked, handleRowDoubleClicked }), [handleRowClicked, handleRowDoubleClicked])
  const gridContext = useMemo(() => ({ favoriteIds: normalizedFavoriteIds, watchIds: normalizedWatchIds }), [normalizedFavoriteIds, normalizedWatchIds])
  const getRowClass = useCallback((params: any) => (
    params?.data && pendingIds.includes(Number(params.data.id))
      ? 'row-ghost opacity-40 grayscale pointer-events-none'
      : ''
  ), [pendingIds])

  const beginPending = useCallback((ids: number[]) => {
    const nextIds = normalizeFarPreferenceIds(ids)
    setPendingIds((current) => Array.from(new Set([...current, ...nextIds])))
  }, [])
  const endPending = useCallback((ids: number[]) => {
    const completed = new Set(normalizeFarPreferenceIds(ids))
    setPendingIds((current) => current.filter((id) => !completed.has(id)))
  }, [])

  useEffect(() => {
    gridRef.current?.api?.refreshCells?.({ columns: ['favorite', 'watch'], force: true })
  }, [gridRef, normalizedFavoriteIds, normalizedWatchIds])

  useEffect(() => () => {
    if (typeof window !== 'undefined') writeOptionalStorage(FAR_LAST_VISITED_STORAGE_KEY, String(Date.now()))
  }, [])

  const utilityColumnsConfig = useMemo(() => ({
    includeRecentChange: true,
    includeFavorite: true,
    includeWatch: true,
    isIntelligenceExpanded,
    isRecentChange,
    onToggleFavorite: toggleFavorite,
    onToggleWatch: toggleWatch,
    itemLabel: 'failure mode',
  }), [isIntelligenceExpanded, isRecentChange, toggleFavorite, toggleWatch])

  return {
    rows: orderedRows,
    selectionScopeKey,
    utilityColumnsConfig,
    rowInteractions,
    gridContext,
    getRowClass,
    pendingIds,
    beginPending,
    endPending,
    favoriteIds: normalizedFavoriteIds,
    watchIds: normalizedWatchIds,
    toggleFavorite,
    toggleWatch,
    isIntelligenceExpanded,
    setIsIntelligenceExpanded,
  }
}
