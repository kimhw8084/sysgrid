import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../../api/apiClient'
import { downloadOperationalImportFile } from '../shared/OperationalImportExport'
import { resolveOperationalDataState } from '../shared/OperationalDataState'
import { dismissWorkspaceToasts, showWorkspaceToast } from '../shared/WorkspaceToast'
import { useOperationalBulkWorkflow } from '../shared/useOperationalBulkWorkflow'
import { ASSET_GOLDEN_ALLOWED_COLUMN_FIELDS } from './assetGoldenColumns'
import { usePersistentJsonState } from '../shared/OperationalWorkspaceHooks'

export type AssetTab = 'inventory' | 'deleted'
export type AssetViewMode = 'grid' | 'report' | 'map'
export type AssetLens = 'all' | 'degraded' | 'unowned' | 'security' | 'network'
export type AssetSavedView = {
  id: string
  name: string
  config: {
    activeTab: AssetTab
    viewMode: AssetViewMode
    groupBy: string
    searchTerm: string
    activeLens: AssetLens
    hiddenColumns: string[]
    fontSize: number
    rowDensity: number
    filters: AssetQuickFilters
  }
}
export type AssetQuickFilters = {
  status: string[]
  system: string[]
  type: string[]
  owner: string[]
}

export type AssetLifecycleOperation = Readonly<{
  ids: readonly number[]
  originalAction: 'delete' | 'restore'
  inverseAction: 'restore' | 'delete'
  targetLabels: readonly string[]
}>

type PendingAssetBulkMutation = {
  isPending?: unknown
  variables?: unknown
}

export function isAssetLifecycleRecoveryBlocked(
  operation: AssetLifecycleOperation | null,
  mutation: PendingAssetBulkMutation,
): boolean {
  if (!operation || mutation.isPending !== true) return false

  const variables = mutation.variables
  if (!variables || typeof variables !== 'object') return true
  const { action, ids } = variables as { action?: unknown; ids?: unknown }
  if (typeof action !== 'string' || !action) return true
  if (action !== 'purge') return false

  if (
    !Array.isArray(ids)
    || ids.length === 0
    || ids.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)
    || !Array.isArray(operation.ids)
    || operation.ids.length === 0
    || operation.ids.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)
  ) return true

  const recoveryIds = new Set(operation.ids)
  return ids.some((id: number) => recoveryIds.has(id))
}

export function revokePurgedAssetLifecycleOperation(
  operation: AssetLifecycleOperation | null,
  purgedIds: readonly number[],
): AssetLifecycleOperation | null {
  if (!operation) return null
  const purgedIdSet = new Set(purgedIds)
  const remainingIndexes = operation.ids
    .map((id, index) => ({ id, index }))
    .filter(({ id }) => !purgedIdSet.has(id))
  const overlapCount = operation.ids.length - remainingIndexes.length
  if (overlapCount === 0) return operation
  if (
    operation.ids.length !== operation.targetLabels.length
    || new Set(operation.ids).size !== operation.ids.length
  ) return null
  if (remainingIndexes.length === 0) return null

  return Object.freeze({
    ...operation,
    ids: Object.freeze(remainingIndexes.map(({ id }) => id)),
    targetLabels: Object.freeze(remainingIndexes.map(({ index }) => operation.targetLabels[index])),
  })
}

const DEFAULT_HIDDEN_COLUMNS = [
  'is_deleted',
]

const DEFAULT_ASSET_VIEWS: AssetSavedView[] = [
  {
    id: 'operations-overview',
    name: 'Operations Overview',
    config: {
      activeTab: 'inventory',
      viewMode: 'grid',
      groupBy: 'system',
      searchTerm: '',
      activeLens: 'all',
      hiddenColumns: ['is_deleted'],
      fontSize: 11,
      rowDensity: 8,
      filters: { status: [], system: [], type: [], owner: [] },
    },
  },
  {
    id: 'security-exposure',
    name: 'Security Exposure',
    config: {
      activeTab: 'inventory',
      viewMode: 'grid',
      groupBy: 'owner',
      searchTerm: '',
      activeLens: 'security',
      hiddenColumns: ['is_deleted'],
      fontSize: 11,
      rowDensity: 8,
      filters: { status: [], system: [], type: [], owner: [] },
    },
  },
  {
    id: 'hardware-inventory',
    name: 'Hardware Inventory',
    config: {
      activeTab: 'inventory',
      viewMode: 'grid',
      groupBy: 'site_name',
      searchTerm: '',
      activeLens: 'all',
      hiddenColumns: ['is_deleted'],
      fontSize: 11,
      rowDensity: 8,
      filters: { status: [], system: [], type: ['Physical', 'Storage', 'Switch', 'Firewall', 'Load Balancer'], owner: [] },
    },
  },
  {
    id: 'dependency-map',
    name: 'Dependency Map',
    config: {
      activeTab: 'inventory',
      viewMode: 'map',
      groupBy: 'raw',
      searchTerm: '',
      activeLens: 'network',
      hiddenColumns: ['is_deleted'],
      fontSize: 11,
      rowDensity: 8,
      filters: { status: [], system: [], type: [], owner: [] },
    },
  },
  {
    id: 'purged-registry',
    name: 'Archived Assets',
    config: {
      activeTab: 'deleted',
      viewMode: 'grid',
      groupBy: 'status',
      searchTerm: '',
      activeLens: 'all',
      hiddenColumns: ['is_deleted'],
      fontSize: 11,
      rowDensity: 8,
      filters: { status: [], system: [], type: [], owner: [] },
    },
  },
  {
    id: 'monitoring-coverage',
    name: 'Monitoring Coverage',
    config: {
      activeTab: 'inventory',
      viewMode: 'report',
      groupBy: 'raw',
      searchTerm: '',
      activeLens: 'degraded',
      hiddenColumns: ['is_deleted'],
      fontSize: 11,
      rowDensity: 8,
      filters: { status: [], system: [], type: [], owner: [] },
    },
  },
  {
    id: 'owner-environment-review',
    name: 'Owner / Environment Review',
    config: {
      activeTab: 'inventory',
      viewMode: 'grid',
      groupBy: 'owner',
      searchTerm: '',
      activeLens: 'unowned',
      hiddenColumns: ['is_deleted'],
      fontSize: 11,
      rowDensity: 8,
      filters: { status: [], system: [], type: [], owner: [] },
    },
  },
]
const DEFAULT_ASSET_VIEW_IDS = new Set(DEFAULT_ASSET_VIEWS.map((view) => view.id))

const STORAGE_KEY = 'sysgrid_asset_golden_workspace_v34'
const STORAGE_MIGRATION_KEYS = ['sysgrid_asset_golden_workspace_v33', 'sysgrid_asset_golden_workspace_v32']
const STORAGE_SCHEMA_VERSION = 34

const EMPTY_FILTERS: AssetQuickFilters = { status: [], system: [], type: [], owner: [] }
const ASSET_BULK_FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  environment: 'Environment',
}
const VALID_TABS = new Set<AssetTab>(['inventory', 'deleted'])
const VALID_VIEW_MODES = new Set<AssetViewMode>(['grid', 'report', 'map'])
const VALID_LENSES = new Set<AssetLens>(['all', 'degraded', 'unowned', 'security', 'network'])
const VALID_GROUP_BY = new Set(['raw', 'system', 'type', 'status', 'environment', 'owner', 'site_name', 'rack_name'])
const VALID_STORAGE_VERSIONS = new Set([STORAGE_SCHEMA_VERSION])

const uniqueStringArray = (value: any) => (
  Array.isArray(value)
    ? Array.from(new Set(value.filter((entry: any) => typeof entry === 'string' && entry.trim()).map((entry: string) => entry.trim())))
    : []
)

const sanitizeHiddenColumns = (value: any) => uniqueStringArray(value).filter((field) => ASSET_GOLDEN_ALLOWED_COLUMN_FIELDS.has(field))

const sanitizeFilters = (value: any): AssetQuickFilters => ({
  status: uniqueStringArray(value?.status),
  system: uniqueStringArray(value?.system),
  type: uniqueStringArray(value?.type),
  owner: uniqueStringArray(value?.owner),
})

const sanitizeSavedViews = (value: any): AssetSavedView[] => {
  const parsed = Array.isArray(value) ? value : []
  const customViews = parsed.flatMap((view: any) => {
    if (!view || typeof view !== 'object' || typeof view.id !== 'string' || typeof view.name !== 'string') return []
    const config = view.config || {}
    return [{
      id: view.id,
      name: view.name,
      config: {
        activeTab: VALID_TABS.has(config.activeTab) ? config.activeTab : 'inventory',
        viewMode: VALID_VIEW_MODES.has(config.viewMode) ? config.viewMode : 'grid',
        groupBy: VALID_GROUP_BY.has(config.groupBy) ? config.groupBy : 'raw',
        searchTerm: typeof config.searchTerm === 'string' ? config.searchTerm : '',
        activeLens: VALID_LENSES.has(config.activeLens) ? config.activeLens : 'all',
        hiddenColumns: sanitizeHiddenColumns(config.hiddenColumns),
        fontSize: Number.isFinite(config.fontSize) ? Math.min(14, Math.max(10, Number(config.fontSize))) : 11,
        rowDensity: Number.isFinite(config.rowDensity) ? Math.min(14, Math.max(6, Number(config.rowDensity))) : 8,
        filters: sanitizeFilters(config.filters),
      },
    }]
  })
  const customViewMap = new Map(customViews.filter((view) => !DEFAULT_ASSET_VIEW_IDS.has(view.id)).map((view) => [view.id, view]))
  const defaultViews = DEFAULT_ASSET_VIEWS.map((view) => customViews.find((entry) => entry.id === view.id) || view)
  return [...defaultViews, ...Array.from(customViewMap.values())]
}

const mergeSavedViewsForMigration = (value: any): AssetSavedView[] => {
  const parsed = sanitizeSavedViews(value)
  const customViews = parsed.filter((view) => !DEFAULT_ASSET_VIEW_IDS.has(view.id))
  return [...DEFAULT_ASSET_VIEWS, ...customViews]
}

const normalizeStoredWorkspace = (value: any) => {
  const normalizedSavedViews = sanitizeSavedViews(value?.savedViews)
  const activeViewId = typeof value?.activeViewId === 'string' && normalizedSavedViews.some((view) => view.id === value.activeViewId)
    ? value.activeViewId
    : null

  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    activeTab: VALID_TABS.has(value?.activeTab) ? value.activeTab : 'inventory',
    viewMode: VALID_VIEW_MODES.has(value?.viewMode) ? value.viewMode : 'grid',
    groupBy: VALID_GROUP_BY.has(value?.groupBy) ? value.groupBy : 'raw',
    searchTerm: typeof value?.searchTerm === 'string' ? value.searchTerm : '',
    activeLens: VALID_LENSES.has(value?.activeLens) ? value.activeLens : 'all',
    hiddenColumns: sanitizeHiddenColumns(value?.hiddenColumns).length > 0 ? sanitizeHiddenColumns(value?.hiddenColumns) : DEFAULT_HIDDEN_COLUMNS,
    fontSize: Number.isFinite(value?.fontSize) ? Math.min(14, Math.max(10, Number(value.fontSize))) : 11,
    rowDensity: Number.isFinite(value?.rowDensity) ? Math.min(14, Math.max(6, Number(value.rowDensity))) : 8,
    filters: sanitizeFilters(value?.filters),
    savedViews: normalizedSavedViews,
    activeViewId,
  }
}

const readStorage = () => {
  if (typeof window === 'undefined') return null
  try {
    const storageKeys = [STORAGE_KEY, ...STORAGE_MIGRATION_KEYS]
    for (const key of storageKeys) {
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      const storedVersion = Number(parsed?.schemaVersion || 0)
      if (key === STORAGE_KEY && !VALID_STORAGE_VERSIONS.has(storedVersion)) {
        window.localStorage.removeItem(key)
        continue
      }
      const normalized = normalizeStoredWorkspace(
        key === STORAGE_KEY
          ? parsed
          : { ...parsed, savedViews: mergeSavedViewsForMigration(parsed?.savedViews) }
      )
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
      if (key !== STORAGE_KEY) window.localStorage.removeItem(key)
      return normalized
    }
    return null
  } catch {
    return null
  }
}

const writeStorage = (value: any) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
    ...value,
    schemaVersion: STORAGE_SCHEMA_VERSION,
  }))
}

const slugify = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `asset-view-${Date.now()}`

const normalizeAsset = (asset: any) => ({
  ...asset,
  id: Number(asset?.id),
  name: asset?.name || 'Unnamed Asset',
  system: asset?.system || 'Unassigned',
  type: asset?.type || 'Physical',
  status: asset?.status || 'Active',
  environment: asset?.environment || 'Production',
  owner: asset?.owner || '',
  manufacturer: asset?.manufacturer || '',
  model: asset?.model || '',
  os_name: asset?.os_name || '',
  primary_ip: asset?.primary_ip || '',
  management_ip: asset?.management_ip || '',
  management_url: asset?.management_url || '',
  hardware_summary: asset?.hardware_summary || 'No hardware summary',
  open_incident_count: Number(asset?.open_incident_count || 0),
  site_name: asset?.site_name || '',
  rack_name: asset?.rack_name || '',
  u_start: asset?.u_start ?? null,
  size_u: asset?.size_u ?? 1,
  power_typical_w: Number(asset?.power_typical_w || 0),
  power_max_w: Number(asset?.power_max_w || 0),
  is_deleted: Boolean(asset?.is_deleted),
  updated_at: asset?.updated_at || asset?.created_at || null,
})

const uniqueValues = (items: any[], field: string) =>
  Array.from(new Set(items.map((item) => String(item?.[field] || '').trim()).filter(Boolean))).sort()

const assetMatchesLens = (asset: any, lens: AssetLens) => {
  if (lens === 'degraded') return asset.status !== 'Active' || Number(asset.open_incident_count || 0) > 0
  if (lens === 'unowned') return !String(asset.owner || '').trim()
  if (lens === 'security') return Boolean(String(asset.management_ip || asset.management_url || '').trim())
  if (lens === 'network') return Boolean(String(asset.primary_ip || asset.management_ip || '').trim())
  return true
}

const matchesTerm = (asset: any, term: string) => {
  const haystack = [
    asset.name,
    asset.system,
    asset.type,
    asset.status,
    asset.environment,
    asset.owner,
    asset.manufacturer,
    asset.model,
    asset.primary_ip,
    asset.management_ip,
    asset.hardware_summary,
  ].join(' ').toLowerCase()
  return haystack.includes(term.toLowerCase())
}

const getAssetConsoleUrl = (asset: any) => {
  const direct = String(asset?.management_url || '').trim()
  if (direct) return /^https?:\/\//i.test(direct) ? direct : `https://${direct}`
  return asset?.management_ip ? `https://${asset.management_ip}` : null
}

export function useAssetGoldenWorkspace() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const stored = readStorage()

  const [activeTab, setActiveTab] = useState<AssetTab>(stored?.activeTab === 'deleted' ? 'deleted' : 'inventory')
  const [viewMode, setViewMode] = useState<AssetViewMode>(VALID_VIEW_MODES.has(stored?.viewMode) ? stored.viewMode : 'grid')
  const [groupBy, setGroupBy] = useState(VALID_GROUP_BY.has(stored?.groupBy) ? stored.groupBy : 'raw')
  const [searchTerm, setSearchTerm] = useState(stored?.searchTerm || '')
  const [activeLens, setActiveLens] = useState<AssetLens>(VALID_LENSES.has(stored?.activeLens) ? stored.activeLens : 'all')
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(sanitizeHiddenColumns(stored?.hiddenColumns).length > 0 ? sanitizeHiddenColumns(stored?.hiddenColumns) : DEFAULT_HIDDEN_COLUMNS)
  const [fontSize, setFontSize] = useState(Number.isFinite(stored?.fontSize) ? Math.min(14, Math.max(10, Number(stored.fontSize))) : 11)
  const [rowDensity, setRowDensity] = useState(Number.isFinite(stored?.rowDensity) ? Math.min(14, Math.max(6, Number(stored.rowDensity))) : 8)
  const [filters, setFilters] = useState<AssetQuickFilters>(sanitizeFilters(stored?.filters))
  const [savedViews, setSavedViews] = useState<AssetSavedView[]>(sanitizeSavedViews(stored?.savedViews))
  const [activeViewId, setActiveViewId] = useState<string | null>(stored?.activeViewId || null)
  const [newViewName, setNewViewName] = useState('')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [selectionResetVersion, setSelectionResetVersion] = useState(0)
  const [reportAssetId, setReportAssetId] = useState<number | null>(null)
  const [reportFocusSection, setReportFocusSection] = useState<string | null>(null)
  const [quickLookAsset, setQuickLookAsset] = useState<any | null>(null)
  const [detailAsset, setDetailAsset] = useState<any | null>(null)
  const [editingAsset, setEditingAsset] = useState<any | null>(null)
  const [editingLink, setEditingLink] = useState<any | null>(null)
  const [detailLink, setDetailLink] = useState<any | null>(null)
  const [serviceDetails, setServiceDetails] = useState<any | null>(null)
  const [serviceEdit, setServiceEdit] = useState<any | null>(null)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showRegistryModal, setShowRegistryModal] = useState(false)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const [rowActionMenu, setRowActionMenu] = useState<{ asset: any; x: number; y: number } | null>(null)
  const [isReverting, setIsReverting] = useState(false)
  const [lastLifecycleOperation, setLastLifecycleOperation] = useState<AssetLifecycleOperation | null>(null)
  const lastLifecycleOperationRef = useRef<AssetLifecycleOperation | null>(null)
  const lifecycleRecoveryGenerationRef = useRef(0)
  const setLifecycleOperation = useCallback((operation: AssetLifecycleOperation | null, newGeneration = true) => {
    if (newGeneration) lifecycleRecoveryGenerationRef.current += 1
    lastLifecycleOperationRef.current = operation
    setLastLifecycleOperation(operation)
  }, [])

  const [favoriteIds, setFavoriteIds] = usePersistentJsonState<number[]>('sysgrid_asset_favorites', [])
  const [watchIds, setWatchIds] = usePersistentJsonState<number[]>('sysgrid_asset_watches', [])

  const toggleFavorite = useCallback((id: number) => {
    setFavoriteIds((current) => {
      const isFav = current.includes(id)
      const next = isFav ? current.filter((i) => i !== id) : [...current, id]
      showWorkspaceToast(isFav ? 'Removed from favorites' : 'Added to favorites', { type: 'success' })
      return next
    })
  }, [setFavoriteIds])

  const toggleWatch = useCallback((id: number) => {
    setWatchIds((current) => {
      const isWatched = current.includes(id)
      const next = isWatched ? current.filter((i) => i !== id) : [...current, id]
      showWorkspaceToast(isWatched ? 'Removed from watchers' : 'Added to watchers', { type: 'success' })
      return next
    })
  }, [setWatchIds])

  const devicesQuery = useQuery({
    queryKey: ['asset-golden-devices'],
    queryFn: async () => (await apiFetch('/api/v1/devices/?include_deleted=true')).json(),
  })
  const liveDevicesQuery = useQuery({
    queryKey: ['devices'],
    queryFn: async () => (await apiFetch('/api/v1/devices/')).json(),
    enabled: devicesQuery.isError,
  })
  const optionsQuery = useQuery({
    queryKey: ['settings-options'],
    queryFn: async () => (await apiFetch('/api/v1/settings/options')).json(),
  })
  const relationshipsQuery = useQuery({
    queryKey: ['asset-golden-relationships'],
    queryFn: async () => (await apiFetch('/api/v1/devices/relationships/all')).json(),
  })
  const connectionsQuery = useQuery({
    queryKey: ['asset-golden-connections'],
    queryFn: async () => (await apiFetch('/api/v1/networks/connections')).json(),
  })

  const includeDeletedAssets = useMemo(
    () => Array.isArray(devicesQuery.data) ? devicesQuery.data : [],
    [devicesQuery.data],
  )
  const hasIncludeDeletedAssetData = Array.isArray(devicesQuery.data)
  const liveAssets = useMemo(
    () => Array.isArray(liveDevicesQuery.data) ? liveDevicesQuery.data : [],
    [liveDevicesQuery.data],
  )
  const hasLiveAssetData = Array.isArray(liveDevicesQuery.data)
  const isUsingLiveFallback = !hasIncludeDeletedAssetData && hasLiveAssetData
  const assetQueryFallbackError = !hasIncludeDeletedAssetData && !hasLiveAssetData
    ? (devicesQuery.error || liveDevicesQuery.error || null)
    : (!hasIncludeDeletedAssetData && includeDeletedAssets.length === 0 && liveAssets.length === 0)
      ? (devicesQuery.error || null)
      : null

  const allAssets = useMemo(() => {
    const source = includeDeletedAssets.length > 0 ? includeDeletedAssets : liveAssets
    return source.map(normalizeAsset)
  }, [includeDeletedAssets, liveAssets])

  const visiblePool = useMemo(
    () => allAssets.filter((asset) => activeTab === 'deleted' ? asset.is_deleted : !asset.is_deleted),
    [activeTab, allAssets]
  )

  const filterOptions = useMemo(() => ({
    status: uniqueValues(visiblePool, 'status'),
    system: uniqueValues(visiblePool, 'system'),
    type: uniqueValues(visiblePool, 'type'),
    owner: uniqueValues(visiblePool, 'owner'),
  }), [visiblePool])

  const filteredAssets = useMemo(() => {
    return visiblePool.filter((asset) => {
      if (!assetMatchesLens(asset, activeLens)) return false
      if (searchTerm.trim() && !matchesTerm(asset, searchTerm.trim())) return false
      if (filters.status.length && !filters.status.includes(asset.status)) return false
      if (filters.system.length && !filters.system.includes(asset.system)) return false
      if (filters.type.length && !filters.type.includes(asset.type)) return false
      if (filters.owner.length && !filters.owner.includes(asset.owner || '')) return false
      return true
    })
  }, [activeLens, filters, searchTerm, visiblePool])

  const lifecycleCounts = useMemo(() => ({
    inventory: allAssets.filter((asset) => !asset.is_deleted).length,
    purged: allAssets.filter((asset) => asset.is_deleted).length,
  }), [allAssets])

  const filterChips = useMemo(() => {
    const chips: Array<{ id: string; label: string; onRemove: () => void }> = []
    if (activeLens !== 'all') chips.push({ id: 'lens', label: `Lens: ${activeLens}`, onRemove: () => setActiveLens('all') })
    for (const [field, values] of Object.entries(filters) as Array<[keyof AssetQuickFilters, string[]]>) {
      values.forEach((value) => chips.push({
        id: `${field}:${value}`,
        label: `${field}: ${value}`,
        onRemove: () => setFilters((current) => ({ ...current, [field]: current[field].filter((entry) => entry !== value) })),
      }))
    }
    return chips
  }, [activeLens, filters])

  const dataState = useMemo(() => resolveOperationalDataState({
    loading: devicesQuery.isLoading || liveDevicesQuery.isLoading,
    error: allAssets.length > 0 ? null : assetQueryFallbackError,
    totalCount: allAssets.length,
    tabCount: visiblePool.length,
    visibleCount: filteredAssets.length,
    emptyLabel: 'No assets have been registered yet.',
    filteredLabel: 'No assets match the current filters.',
    tabEmptyKind: activeTab === 'deleted' ? 'deleted-empty' : 'active-empty',
    tabEmptyLabel: activeTab === 'deleted' ? 'No archived assets are available.' : 'No active assets are available.',
    errorTitle: 'Asset registry unavailable',
    errorDescription: 'The asset inventory request failed and no usable fallback rows are available.',
    emptyTitle: 'No assets registered',
    emptyDescription: 'Import a registry snapshot or register an asset to populate the workspace.',
    filteredTitle: 'No assets match the current working view',
    filteredDescription: 'Clear filters, search terms, or apply a broader saved view to bring assets back into scope.',
    tabEmptyTitle: activeTab === 'deleted' ? 'No archived assets in scope' : 'No active assets in scope',
    tabEmptyDescription: activeTab === 'deleted'
      ? 'The registry is loaded, but no archived assets are currently available.'
      : 'The registry is loaded, but no active assets are currently available.',
    degradedNotice: isUsingLiveFallback ? {
      tone: 'warning',
      title: 'Showing live fallback rows only',
      description: 'The include-deleted asset request failed, so this workspace is using active inventory rows until the registry endpoint recovers.',
    } : undefined,
  }), [activeTab, allAssets.length, assetQueryFallbackError, devicesQuery.isLoading, filteredAssets.length, isUsingLiveFallback, liveDevicesQuery.isLoading, visiblePool.length])

  const linkPurposeOptions = useMemo(() => {
    const options = Array.isArray(optionsQuery.data) ? optionsQuery.data.filter((item: any) => item.category === 'LinkPurpose') : []
    return options.map((item: any) => ({ value: item.value, label: item.label }))
  }, [optionsQuery.data])

  const farmOptions = useMemo(() => {
    const options = Array.isArray(optionsQuery.data) ? optionsQuery.data.filter((item: any) => item.category === 'NetworkFarm') : []
    return options.map((item: any) => ({ value: item.value, label: item.label }))
  }, [optionsQuery.data])

  const cableTypeOptions = useMemo(() => {
    const options = Array.isArray(optionsQuery.data) ? optionsQuery.data.filter((item: any) => item.category === 'NetworkCableType') : []
    return options.map((item: any) => ({ value: item.value, label: item.label }))
  }, [optionsQuery.data])

  const systemsList = useMemo(
    () => {
      const optionSystems = Array.isArray(optionsQuery.data)
        ? optionsQuery.data.filter((item: any) => item.category === 'LogicalSystem').map((item: any) => item.value)
        : []
      return optionSystems.length > 0 ? optionSystems : uniqueValues(allAssets, 'system')
    },
    [allAssets, optionsQuery.data]
  )

  useEffect(() => {
    if (viewMode !== 'report' && viewMode !== 'map') return
    if (!filteredAssets.length) {
      if (reportAssetId != null) setReportAssetId(null)
      if (reportFocusSection != null) setReportFocusSection(null)
      return
    }
    const hasSelectedVisibleAsset = reportAssetId != null && filteredAssets.some((asset) => asset.id === reportAssetId)
    if (!hasSelectedVisibleAsset) {
      setReportAssetId(filteredAssets[0].id)
    }
  }, [filteredAssets, reportAssetId, reportFocusSection, viewMode])

  useEffect(() => {
    writeStorage({
      activeTab,
      viewMode,
      groupBy,
      searchTerm,
      activeLens,
      hiddenColumns,
      fontSize,
      rowDensity,
      filters,
      savedViews,
      activeViewId,
    })
  }, [activeLens, activeTab, activeViewId, filters, fontSize, groupBy, hiddenColumns, rowDensity, savedViews, searchTerm, viewMode])

  const routeAssetId = searchParams.get('id')

  useEffect(() => {
    const routeId = Number(routeAssetId || '')
    if (!routeId || !allAssets.length) return
    const match = allAssets.find((asset) => asset.id === routeId)
    if (!match) return

    setDetailAsset((current: any) => Number(current?.id) === routeId ? current : match)
    setReportAssetId((current) => current === routeId ? current : routeId)
  }, [allAssets, routeAssetId])

  // Synchronize/close quickLookAsset and detailAsset after mutations/scope changes
  useEffect(() => {
    if (quickLookAsset) {
      const latest = allAssets.find((asset: any) => Number(asset.id) === Number(quickLookAsset.id))
      if (!latest) {
        setQuickLookAsset(null)
      } else if (latest.is_deleted !== (activeTab === 'deleted')) {
        setQuickLookAsset(null)
      } else {
        const latestNormalized = normalizeAsset(latest)
        if (JSON.stringify(latestNormalized) !== JSON.stringify(quickLookAsset)) {
          setQuickLookAsset(latestNormalized)
        }
      }
    }
  }, [allAssets, activeTab, quickLookAsset])

  useEffect(() => {
    if (detailAsset) {
      const latest = allAssets.find((asset: any) => Number(asset.id) === Number(detailAsset.id))
      if (!latest) {
        setDetailAsset(null)
        setSearchParams((current: URLSearchParams) => {
          const next = new URLSearchParams(current)
          next.delete('id')
          return next
        })
      } else if (latest.is_deleted !== (activeTab === 'deleted')) {
        setDetailAsset(null)
        setSearchParams((current: URLSearchParams) => {
          const next = new URLSearchParams(current)
          next.delete('id')
          return next
        })
      } else {
        const latestNormalized = normalizeAsset(latest)
        if (JSON.stringify(latestNormalized) !== JSON.stringify(detailAsset)) {
          setDetailAsset(latestNormalized)
        }
      }
    }
  }, [allAssets, activeTab, detailAsset, setSearchParams])

  const refreshAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['asset-golden-devices'] })
    queryClient.invalidateQueries({ queryKey: ['devices'] })
    queryClient.invalidateQueries({ queryKey: ['asset-golden-relationships'] })
    queryClient.invalidateQueries({ queryKey: ['asset-golden-connections'] })
  }, [queryClient])

  const refreshAssetLifecycle = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['asset-golden-devices'] }),
    [queryClient],
  )

  const {
    bulkMutation,
    bulkPreviewMutation,
    bulkOperationPreview,
    isBulkReverting,
    requestBulkPreview,
    runBulkReceiptRevert,
    setBulkOperationPreview,
  } = useOperationalBulkWorkflow<any>({
    selectedIds,
    fieldLabels: ASSET_BULK_FIELD_LABELS,
    selectionErrorMessage: 'Select at least one asset first',
    previewErrorMessage: 'Asset preview failed',
    executionErrorMessage: 'Asset action failed',
    revertErrorMessage: 'Asset bulk undo failed',
    getSnapshots: (ids) => allAssets
      .filter((asset) => ids.includes(asset.id))
      .map((asset) => ({ ...asset })),
    previewRequest: async ({ action, ids, payload }) => {
      const response = await apiFetch('/api/v1/devices/bulk-action', {
        method: 'POST',
        body: JSON.stringify({ action, ids, payload, dry_run: true }),
      })
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    },
    executeRequest: async ({ action, ids, payload }) => {
      const response = await apiFetch('/api/v1/devices/bulk-action', {
        method: 'POST',
        body: JSON.stringify({ action, ids, ...(Object.keys(payload).length ? { payload } : {}) }),
      })
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    },
    refresh: refreshAssetLifecycle,
    buildRevertRequest: ({ action, payload, changedIds, changedSnapshots }) => {
      if (action === 'delete' || action === 'restore') {
        return { action: action === 'delete' ? 'restore' : 'delete', ids: changedIds }
      }
      const updateKeys = Object.keys(payload)
      if (action !== 'update' || updateKeys.length !== 1) return null
      const key = updateKeys[0]
      const previousValues = Array.from(new Set(changedSnapshots.map((snapshot: any) => snapshot[key])))
      if (previousValues.length !== 1 || previousValues[0] === null || previousValues[0] === undefined) return null
      return { action: 'update', ids: changedIds, payload: { [key]: previousValues[0] } }
    },
    onExecutionStart: (_ids, action) => {
      if (action !== 'purge') return undefined
      // Every entry point (row menu, receipt, bulk toolbar) invalidates transient undo.
      // The guarded durable recovery control remains available for disjoint records.
      dismissWorkspaceToasts()
      return { recoveryGeneration: lifecycleRecoveryGenerationRef.current }
    },
    onExecutionSuccess: ({ action, ids, changedIds, targetLabels, previousSnapshots, executionStartContext }) => {
      setRowActionMenu(null)
      setSelectedIds([])
      setSelectionResetVersion(version => version + 1)
      if ((action === 'delete' || action === 'restore') && changedIds.length > 0) {
        const labelsById = new Map<number, string>()
        if (targetLabels?.length === ids.length) {
          ids.forEach((id, index) => labelsById.set(id, targetLabels[index]))
        }
        previousSnapshots.forEach((snapshot: any) => {
          const id = Number(snapshot?.id)
          if (!labelsById.has(id) && Number.isFinite(id)) {
            labelsById.set(id, String(snapshot?.name || id))
          }
        })
        const nextOperation = Object.freeze({
          ids: Object.freeze([...changedIds]),
          originalAction: action,
          inverseAction: action === 'delete' ? 'restore' : 'delete',
          targetLabels: Object.freeze(changedIds.map((id) => labelsById.get(id) || String(id))),
        }) as AssetLifecycleOperation
        setLifecycleOperation(nextOperation)
      } else if (action === 'purge' && changedIds.length > 0) {
        const startGeneration = (executionStartContext as { recoveryGeneration?: unknown } | undefined)?.recoveryGeneration
        if (startGeneration === lifecycleRecoveryGenerationRef.current) {
          setLifecycleOperation(revokePurgedAssetLifecycleOperation(lastLifecycleOperationRef.current, changedIds), false)
        }
      }
    },
    onRevertSuccess: () => setLifecycleOperation(null),
  })
  const bulkMutationRef = useRef(bulkMutation)
  bulkMutationRef.current = bulkMutation

  const openConfirm = useCallback((title: string, message: string, onConfirm: () => void) => {
    setConfirmState({ title, message, onConfirm })
  }, [])

  const performBulkAction = useCallback((action: string, ids?: number[], payload?: Record<string, any>) => {
    const targetIds = ids && ids.length ? ids : selectedIds
    if (!targetIds.length) {
      showWorkspaceToast('Select at least one asset first', { type: 'error' })
      return
    }
    if (action === 'purge') dismissWorkspaceToasts()
    requestBulkPreview({ action, ids: targetIds, payload: payload || {} })
  }, [requestBulkPreview, selectedIds])

  const executeRevert = useCallback(async (operation: AssetLifecycleOperation) => {
    if (isAssetLifecycleRecoveryBlocked(operation, bulkMutationRef.current)) {
      showWorkspaceToast('Wait for the overlapping permanent purge to finish before reverting this asset operation', { type: 'error' })
      return
    }
    setIsReverting(true)
    try {
      const response = await apiFetch('/api/v1/devices/bulk-action', {
        method: 'POST',
        body: JSON.stringify({ action: operation.inverseAction, ids: operation.ids }),
      })
      if (!response.ok) throw new Error(await response.text())
      await refreshAssetLifecycle()
      setLifecycleOperation(null)
      showWorkspaceToast('Reverted asset operation', { type: 'success' })
    } catch (error: any) {
      showWorkspaceToast(error?.message || 'Revert failed', { type: 'error' })
    } finally {
      setIsReverting(false)
    }
  }, [refreshAssetLifecycle])

  const toggleColumn = useCallback((field: string) => {
    setHiddenColumns((current) => current.includes(field) ? current.filter((entry) => entry !== field) : [...current, field])
  }, [])

  const applyView = useCallback((view: AssetSavedView | null) => {
    if (!view) {
      setActiveViewId(null)
      setActiveTab('inventory')
      setViewMode('grid')
      setGroupBy('raw')
      setSearchTerm('')
      setActiveLens('all')
      setHiddenColumns([...DEFAULT_HIDDEN_COLUMNS])
      setFontSize(11)
      setRowDensity(8)
      setFilters(EMPTY_FILTERS)
      return
    }
    setActiveViewId(view.id)
    setActiveTab(view.config.activeTab)
    setViewMode(view.config.viewMode)
    setGroupBy(VALID_GROUP_BY.has(view.config.groupBy) ? view.config.groupBy : 'raw')
    setSearchTerm(view.config.searchTerm)
    setActiveLens(VALID_LENSES.has(view.config.activeLens) ? view.config.activeLens : 'all')
    setHiddenColumns(sanitizeHiddenColumns(view.config.hiddenColumns).length > 0 ? sanitizeHiddenColumns(view.config.hiddenColumns) : DEFAULT_HIDDEN_COLUMNS)
    setFontSize(Number.isFinite(view.config.fontSize) ? Math.min(14, Math.max(10, Number(view.config.fontSize))) : 11)
    setRowDensity(Number.isFinite(view.config.rowDensity) ? Math.min(14, Math.max(6, Number(view.config.rowDensity))) : 8)
    setFilters(sanitizeFilters(view.config.filters))
  }, [])

  const createSavedView = useCallback(() => {
    if (!newViewName.trim()) {
      showWorkspaceToast('Name the saved view first', { type: 'error' })
      return
    }
    const view: AssetSavedView = {
      id: slugify(newViewName),
      name: newViewName.trim(),
      config: { activeTab, viewMode, groupBy, searchTerm, activeLens, hiddenColumns, fontSize, rowDensity, filters },
    }
    setSavedViews((current) => [...current.filter((entry) => entry.id !== view.id), view])
    setActiveViewId(view.id)
    setNewViewName('')
  }, [activeLens, activeTab, filters, fontSize, groupBy, hiddenColumns, newViewName, rowDensity, searchTerm, viewMode])

  const overwriteSavedView = useCallback((id: string) => {
    setSavedViews((current) => current.map((view) => view.id === id ? ({
      ...view,
      config: { activeTab, viewMode, groupBy, searchTerm, activeLens, hiddenColumns, fontSize, rowDensity, filters },
    }) : view))
    setActiveViewId(id)
  }, [activeLens, activeTab, filters, fontSize, groupBy, hiddenColumns, rowDensity, searchTerm, viewMode])

  const deleteSavedView = useCallback((id: string) => {
    setSavedViews((current) => current.filter((view) => view.id !== id))
    if (activeViewId === id) setActiveViewId(null)
  }, [activeViewId])

  const exportSnapshot = useCallback(async () => {
    try {
      await downloadOperationalImportFile({
        tableName: 'devices',
        kind: 'snapshot',
        fallbackFileName: `SysGrid_Assets_${new Date().toISOString().slice(0, 10)}.csv`,
      })
      showWorkspaceToast('Asset snapshot downloaded')
    } catch (error: any) {
      showWorkspaceToast(error?.message || 'Export failed', { type: 'error' })
    }
  }, [])

  const exportTemplate = useCallback(async () => {
    try {
      await downloadOperationalImportFile({
        tableName: 'devices',
        kind: 'template',
        fallbackFileName: 'SysGrid_Assets_Template.csv',
      })
      showWorkspaceToast('Asset template downloaded')
    } catch (error: any) {
      showWorkspaceToast(error?.message || 'Template download failed', { type: 'error' })
    }
  }, [])

  return {
    defaultViewIds: DEFAULT_ASSET_VIEW_IDS,
    activeLens,
    activeTab,
    activeViewId,
    allAssets,
    bulkMutation,
    bulkPreviewMutation,
    bulkOperationPreview,
    cableTypeOptions,
    confirmState,
    connections: Array.isArray(connectionsQuery.data) ? connectionsQuery.data : [],
    createSavedView,
    dataState,
    detailAsset,
    detailLink,
    devices: Array.isArray(liveDevicesQuery.data) ? liveDevicesQuery.data : [],
    editingAsset,
    editingLink,
    exportSnapshot,
    exportTemplate,
    favoriteIds,
    watchIds,
    toggleFavorite,
    toggleWatch,
    farmOptions,
    filterChips,
    filterOptions,
    filters,
    fontSize,
    groupBy,
    getAssetConsoleUrl,
    hiddenColumns,
    lifecycleCounts,
    linkPurposeOptions,
    newViewName,
    openConfirm,
    options: Array.isArray(optionsQuery.data) ? optionsQuery.data : [],
    overwriteSavedView,
    performBulkAction,
    runBulkReceiptRevert,
    quickLookAsset,
    reportAssetId,
    reportFocusSection,
    refreshAll,
    isReverting,
    isLastLifecycleRecoveryBlocked: isAssetLifecycleRecoveryBlocked(lastLifecycleOperation, bulkMutation),
    isBulkReverting,
    lastLifecycleOperation,
    executeRevert,
    relationships: Array.isArray(relationshipsQuery.data) ? relationshipsQuery.data : [],
    rowActionMenu,
    rowDensity,
    savedViews,
    searchParams,
    searchTerm,
    selectedIds,
    serviceDetails,
    serviceEdit,
    setActiveLens,
    setBulkOperationPreview,
    setActiveTab,
    setConfirmState,
    setDetailAsset,
    setDetailLink,
    setEditingAsset,
    setEditingLink,
    setFilters,
    setFontSize,
    setGroupBy,
    setHiddenColumns,
    setNewViewName,
    setQuickLookAsset,
    setReportAssetId,
    setReportFocusSection,
    setRowActionMenu,
    setRowDensity,
    setSearchParams,
    setSearchTerm,
    setSelectedIds,
    selectionResetVersion,
    setServiceDetails,
    setServiceEdit,
    setShowImportModal,
    setShowRegistryModal,
    setViewMode,
    showImportModal,
    showRegistryModal,
    systemsList,
    toggleColumn,
    viewMode,
    visibleAssets: filteredAssets,
    visiblePool,
    applyView,
    deleteSavedView,
  }
}
