import type { CollaborativeSavedView } from './shared/CollaborativeWorkspaceViews'
import {
  sanitizeOperationalColumnLayout,
  sanitizeOperationalFilterModel,
  sanitizeOperationalSortModel,
} from './shared/OperationalGridSizing'
import {
  FAR_VALID_GROUP_BY,
  normalizeFarQuickFilters,
  type FarGroupBy,
  type FarQuickFilters,
} from './FAR.workspaceModel'
import { sanitizeFarPersistedColumnGeometry } from './FAR.columnGeometry'

export const FAR_VIEW_STORAGE_KEY = 'sysgrid_far_views_v2'
export const FAR_ACTIVE_VIEW_KEY = 'sysgrid_far_active_view_v2'
export const FAR_WORKING_STATE_KEY = 'sysgrid_far_working_state_v1'
export const FAR_WORKSPACE_PREFERENCE_KEY = 'far_workspace_state_v1'
export const FAR_WORKSPACE_PREFERENCE_ENDPOINT = '/api/v1/settings/user/settings'
export const FAR_WORKSPACE_PREFERENCE_VERSION = 1
export const FAR_COLLABORATIVE_VIEW_MIGRATION_KEY = 'sysgrid_far_collaborative_views_v1_migrated'

export const FAR_PERSISTED_COLUMN_IDS = new Set([
  'id',
  'system_name',
  'failure_type',
  'title',
  'severity',
  'occurrence',
  'detection',
  'rpn',
  'status',
  'vectors',
  'linked_rcas',
  'created_by_user_id',
])

export type FarLifecycleScope = 'active' | 'archived'

export type FarWorkspaceViewConfig = {
  lifecycleScope: FarLifecycleScope
  fontSize: number
  rowDensity: number
  hiddenColumns: string[]
  groupBy: FarGroupBy
  showFilterBar: boolean
  quickFilter: string
  quickFilters: FarQuickFilters
  filterModel: Record<string, any>
  sortModel: Array<{ colId: string; sort: 'asc' | 'desc' }>
  columnLayoutState: any[]
}

export type FarSavedView = CollaborativeSavedView<FarWorkspaceViewConfig>

export type FarWorkspacePreference = {
  version: typeof FAR_WORKSPACE_PREFERENCE_VERSION
  workingDefinition: FarWorkspaceViewConfig
}

const clampNumber = (value: unknown, minimum: number, maximum: number, fallback: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)))
}

const normalizeStrings = (value: unknown) => {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean)))
}

const FAR_RECOVERY_COLUMN_IDS = new Set(['system_name', 'title', 'rpn', 'status'])

const sanitizeFarColumnLayout = (value: unknown) => {
  const normalizedLayout = sanitizeOperationalColumnLayout(
    Array.isArray(value) ? value : [],
    FAR_PERSISTED_COLUMN_IDS,
    true,
  )
  const geometry = sanitizeFarPersistedColumnGeometry(normalizedLayout)
  const layout = geometry.layout
  const recoveryCoreFullyPinned = Array.from(FAR_RECOVERY_COLUMN_IDS).every((colId) => {
    const column = layout.find((entry: any) => entry?.colId === colId)
    return column?.pinned === 'left' || column?.pinned === 'right'
  })
  if (!recoveryCoreFullyPinned) return { layout, recovered: false }

  return {
    recovered: true,
    layout: layout.map((column: any) => {
      const recoveredColumn: any = {
        ...column,
        pinned: column?.colId === 'id' ? 'left' : null,
        ...(FAR_RECOVERY_COLUMN_IDS.has(column?.colId) ? { hide: false } : {}),
      }
      delete recoveredColumn.width
      delete recoveredColumn.flex
      return recoveredColumn
    }),
  }
}

export function sanitizeFarWorkspaceViewConfig(value: unknown): FarWorkspaceViewConfig {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
  const columnLayout = sanitizeFarColumnLayout(source.columnLayoutState)
  const groupBy = typeof source.groupBy === 'string' && FAR_VALID_GROUP_BY.has(source.groupBy as FarGroupBy)
    ? source.groupBy as FarGroupBy
    : 'raw'

  return {
    lifecycleScope: source.lifecycleScope === 'archived' ? 'archived' : 'active',
    fontSize: clampNumber(source.fontSize, 8, 14, 11),
    rowDensity: clampNumber(source.rowDensity, 0, 33, 8),
    hiddenColumns: normalizeStrings(source.hiddenColumns)
      .filter((field) => FAR_PERSISTED_COLUMN_IDS.has(field))
      .filter((field) => !columnLayout.recovered || !FAR_RECOVERY_COLUMN_IDS.has(field)),
    groupBy,
    showFilterBar: source.showFilterBar !== false,
    quickFilter: typeof source.quickFilter === 'string' ? source.quickFilter.trim().slice(0, 500) : '',
    quickFilters: normalizeFarQuickFilters(source.quickFilters),
    filterModel: sanitizeOperationalFilterModel(source.filterModel, FAR_PERSISTED_COLUMN_IDS),
    sortModel: sanitizeOperationalSortModel(source.sortModel, FAR_PERSISTED_COLUMN_IDS) as FarWorkspaceViewConfig['sortModel'],
    columnLayoutState: columnLayout.layout,
  }
}

export function buildFarWorkspacePreference(value: unknown): FarWorkspacePreference {
  return {
    version: FAR_WORKSPACE_PREFERENCE_VERSION,
    workingDefinition: sanitizeFarWorkspaceViewConfig(value),
  }
}

export function buildFarWorkspacePreferencePatch(value: unknown) {
  return {
    [FAR_WORKSPACE_PREFERENCE_KEY]: buildFarWorkspacePreference(value),
  }
}

export function normalizeFarWorkspacePreference(value: unknown): FarWorkspacePreference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (source.version !== FAR_WORKSPACE_PREFERENCE_VERSION) return null
  if (!source.workingDefinition || typeof source.workingDefinition !== 'object' || Array.isArray(source.workingDefinition)) return null
  return buildFarWorkspacePreference(source.workingDefinition)
}

export function normalizeFarSavedViews(value: FarSavedView[]): FarSavedView[] {
  const seen = new Set<string>()
  return (Array.isArray(value) ? value : []).flatMap((view) => {
    if (!view || typeof view !== 'object') return []
    if (typeof view.id !== 'string' || !view.id.trim() || seen.has(view.id)) return []
    if (typeof view.name !== 'string' || !view.name.trim()) return []
    seen.add(view.id)
    return [{
      ...view,
      name: view.name.trim(),
      config: sanitizeFarWorkspaceViewConfig(view.config),
    }]
  })
}

export const FAR_SYSTEM_VIEW_IDS = new Set<string>()
export const DEFAULT_FAR_VIEW_CONFIG = sanitizeFarWorkspaceViewConfig({})
