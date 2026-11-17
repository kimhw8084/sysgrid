import { OPERATIONAL_GRID_MIN_COLUMN_WIDTH } from './OperationalGridContract'

export const OPERATIONAL_GRID_CONTENT_AUTO_SIZE_STRATEGY = {
  type: 'fitCellContents' as const,
}

export const OPERATIONAL_GRID_AUTO_SIZE_STRATEGY = OPERATIONAL_GRID_CONTENT_AUTO_SIZE_STRATEGY

// SysGrid's shared table contract sets 12px as the minimum effective body
// size. Keep an older saved request intact, but never render below that floor.
export const OPERATIONAL_GRID_MIN_FONT_SIZE = 12
export const OPERATIONAL_GRID_MAX_FONT_SIZE = 14

export const getEffectiveOperationalGridFontSize = (requested: unknown, fallback = OPERATIONAL_GRID_MIN_FONT_SIZE) => {
  const safeFallback = Number.isFinite(fallback)
    ? Math.max(OPERATIONAL_GRID_MIN_FONT_SIZE, fallback)
    : OPERATIONAL_GRID_MIN_FONT_SIZE
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return safeFallback
  return Math.max(OPERATIONAL_GRID_MIN_FONT_SIZE, requested)
}

export const getOperationalGridHeaderHeight = (fontSize = OPERATIONAL_GRID_MIN_FONT_SIZE) =>
  Math.max(42, Math.ceil(getEffectiveOperationalGridFontSize(fontSize) + 30))

// The project's shared operational-grid contract requires at least 40px per
// desktop record. Density controls may add space, but may not compress rows
// below the size needed for readable text and usable row actions.
export const OPERATIONAL_GRID_ROW_HEIGHT_MIN = 40
export const OPERATIONAL_GRID_ROW_HEIGHT_MAX = 48
export const OPERATIONAL_GRID_ROW_DENSITY_MAX = 33

export const getOperationalGridRowHeight = (fontSize = OPERATIONAL_GRID_MIN_FONT_SIZE, rowDensity = 8) =>
  Math.min(OPERATIONAL_GRID_ROW_HEIGHT_MAX, Math.max(OPERATIONAL_GRID_ROW_HEIGHT_MIN, Math.ceil(getEffectiveOperationalGridFontSize(fontSize) + rowDensity + 6)))

export const getOperationalGridRowDensityForHeight = (rowHeight: number, fontSize = OPERATIONAL_GRID_MIN_FONT_SIZE) =>
  Math.min(OPERATIONAL_GRID_ROW_DENSITY_MAX, Math.max(0, Math.round(rowHeight - getEffectiveOperationalGridFontSize(fontSize) - 6)))

export const getOperationalCompactGridHeight = (
  visibleRowCount: number,
  fontSize: number,
  rowDensity: number,
): number | null => {
  if (![visibleRowCount, fontSize, rowDensity].every(Number.isFinite) || visibleRowCount > 5) return null
  const rows = Math.max(2, Math.floor(visibleRowCount))
  const headerHeight = getOperationalGridHeaderHeight(fontSize)
  const rowHeight = getOperationalGridRowHeight(fontSize, rowDensity)
  return Math.ceil(headerHeight + rows * rowHeight + 16)
}

export const isOperationalAutoResizeSource = (source: string) => (
  source === 'autosizeColumns' ||
  source === 'sizeColumnsToFit' ||
  source === 'api' ||
  source === 'flex'
)

export const clampOperationalColumnWidth = (width: any, minWidth: any, maxWidth: any): any => {
  if (typeof width !== 'number' || !Number.isFinite(width)) return width
  const minimum = typeof minWidth === 'number' && Number.isFinite(minWidth) ? minWidth : 0
  const maximum = typeof maxWidth === 'number' && Number.isFinite(maxWidth) ? maxWidth : Number.POSITIVE_INFINITY
  return Math.max(minimum, Math.min(width, maximum))
}

type OperationalColumnSizingMetadata = {
  autoSizeMinWidth?: number
  autoSizeMaxWidth?: number
  skipAutoSize?: boolean
  userMinWidth?: number
}

export const OPERATIONAL_COLUMN_SIZING_CONTEXT_KEY = '__sysgridOperationalColumnSizing'
const operationalColumnSizingMetadata = new WeakMap<object, OperationalColumnSizingMetadata>()

export const getOperationalColumnSizingMetadata = (column: Record<string, any> | null | undefined) => {
  if (!column || typeof column !== 'object') return {}
  return operationalColumnSizingMetadata.get(column) ?? {
    autoSizeMinWidth: column.operationalAutoSizeMinWidth,
    autoSizeMaxWidth: column.operationalAutoSizeMaxWidth,
    skipAutoSize: column.operationalSkipAutoSize,
    userMinWidth: column.operationalMinimumWidth,
  }
}

const rememberOperationalColumnSizingMetadata = (
  target: Record<string, any>,
  metadata: OperationalColumnSizingMetadata,
) => {
  if (Object.values(metadata).some(value => value !== undefined)) {
    operationalColumnSizingMetadata.set(target, metadata)
  }
  return target
}

export const normalizeOperationalColumnDefinition = (column: Record<string, any>) => {
  const inheritedMetadata = getOperationalColumnSizingMetadata(column)
  const userMinWidth = column.operationalMinimumWidth ?? inheritedMetadata.userMinWidth
  const autoSizeMaxWidth = column.operationalAutoSizeMaxWidth ?? inheritedMetadata.autoSizeMaxWidth ?? column.maxWidth
  const autoSizeMinWidth = column.operationalAutoSizeMinWidth ?? inheritedMetadata.autoSizeMinWidth ?? column.minWidth
  const normalized: Record<string, any> = {
    ...column,
    resizable: true,
    minWidth: typeof userMinWidth === 'number' && Number.isFinite(userMinWidth)
      ? Math.max(OPERATIONAL_GRID_MIN_COLUMN_WIDTH, userMinWidth)
      : OPERATIONAL_GRID_MIN_COLUMN_WIDTH,
  }
  const metadata: OperationalColumnSizingMetadata = {
    ...inheritedMetadata,
    ...(column.operationalSkipAutoSize !== undefined ? { skipAutoSize: column.operationalSkipAutoSize } : {}),
    ...(typeof userMinWidth === 'number' && Number.isFinite(userMinWidth)
      ? { userMinWidth: Math.max(OPERATIONAL_GRID_MIN_COLUMN_WIDTH, userMinWidth) }
      : {}),
  }
  if (typeof autoSizeMaxWidth === 'number' && Number.isFinite(autoSizeMaxWidth)) {
    metadata.autoSizeMaxWidth = Math.max(OPERATIONAL_GRID_MIN_COLUMN_WIDTH, autoSizeMaxWidth)
  }
  if (typeof autoSizeMinWidth === 'number' && Number.isFinite(autoSizeMinWidth)) {
    const maximum = metadata.autoSizeMaxWidth
    metadata.autoSizeMinWidth = Math.min(
      Math.max(OPERATIONAL_GRID_MIN_COLUMN_WIDTH, autoSizeMinWidth),
      typeof maximum === 'number' ? maximum : Number.POSITIVE_INFINITY,
    )
  }
  delete normalized.operationalAutoSizeMinWidth
  delete normalized.operationalAutoSizeMaxWidth
  delete normalized.operationalSkipAutoSize
  delete normalized.operationalMinimumWidth
  delete normalized.maxWidth
  delete normalized.operationalLockWidth
  if (typeof normalized.width === 'number') {
    normalized.width = clampOperationalColumnWidth(normalized.width, OPERATIONAL_GRID_MIN_COLUMN_WIDTH, undefined)
  }
  if (typeof normalized.initialWidth === 'number') {
    normalized.initialWidth = clampOperationalColumnWidth(normalized.initialWidth, OPERATIONAL_GRID_MIN_COLUMN_WIDTH, undefined)
  }
  return rememberOperationalColumnSizingMetadata(normalized, metadata)
}

const normalizedColumnDefinitionCache = new WeakMap<any[], any[]>()
const EMPTY_OPERATIONAL_COLUMN_DEFINITIONS: any[] = []

export const normalizeOperationalColumnDefinitions = (columnDefs?: any[] | null) => {
  const source = Array.isArray(columnDefs) ? columnDefs : EMPTY_OPERATIONAL_COLUMN_DEFINITIONS
  const cached = normalizedColumnDefinitionCache.get(source)
  if (cached) return cached
  const normalized = source.map((column: any) => column.children
    ? { ...column, children: normalizeOperationalColumnDefinitions(column.children) }
    : normalizeOperationalColumnDefinition(column))
  normalizedColumnDefinitionCache.set(source, normalized)
  return normalized
}

/** Keep AG Grid's initial content auto-size consistent with the operational skip-auto-size contract. */
export const getOperationalContentAutoSizeStrategy = (strategy: any, columnDefs: any[] = []) => {
  if (!strategy || strategy.type !== 'fitCellContents') return strategy
  const candidates: string[] = []
  const visit = (columns: any[]) => columns.forEach((column, index) => {
    if (Array.isArray(column?.children)) {
      visit(column.children)
      return
    }
    const columnId = column?.colId ?? column?.field ?? column?.headerName ?? `column-${index}`
    if (!getOperationalColumnSizingMetadata(column).skipAutoSize) candidates.push(String(columnId))
  })
  visit(columnDefs)
  const requested = Array.isArray(strategy.colIds) ? new Set(strategy.colIds.map(String)) : null
  const colIds = requested ? candidates.filter(columnId => requested.has(columnId)) : candidates
  return colIds.length ? { ...strategy, colIds } : undefined
}

export const buildOperationalColumnSizingContext = (context: any, columnDefs: any[]) => {
  const sizingByColumnId: Record<string, OperationalColumnSizingMetadata> = {}
  const visit = (columns: any[]) => columns.forEach((column, index) => {
    if (Array.isArray(column?.children)) {
      visit(column.children)
      return
    }
    const metadata = getOperationalColumnSizingMetadata(column)
    if (!Object.values(metadata).some(value => value !== undefined)) return
    const columnId = column?.colId ?? column?.field ?? column?.headerName ?? `column-${index}`
    sizingByColumnId[String(columnId)] = metadata
  })
  visit(Array.isArray(columnDefs) ? columnDefs : [])
  if (!Object.keys(sizingByColumnId).length) return context

  const baseContext = context && typeof context === 'object' && !Array.isArray(context)
    ? context
    : context == null
      ? {}
      : { __sysgridOriginalGridContext: context }
  return {
    ...baseContext,
    [OPERATIONAL_COLUMN_SIZING_CONTEXT_KEY]: {
      ...baseContext[OPERATIONAL_COLUMN_SIZING_CONTEXT_KEY],
      ...sizingByColumnId,
    },
  }
}

const getGridColumnSizingMetadata = (api: { getGridOption?: (key: string) => any } | null | undefined, column: any) => {
  const columnId = column?.getColId?.()
  const context = api?.getGridOption?.('context')
  const fromContext = typeof columnId === 'string'
    ? context?.[OPERATIONAL_COLUMN_SIZING_CONTEXT_KEY]?.[columnId]
    : undefined
  return fromContext ?? getOperationalColumnSizingMetadata(column?.getColDef?.())
}

const isOperationalGridDestroyed = (api: { isDestroyed?: () => boolean } | null | undefined) => {
  try {
    return api?.isDestroyed?.() === true
  } catch {
    return true
  }
}

export const normalizeOperationalColumnLayout = (layout: any[], preserveWidths: boolean) =>
  (layout || []).map((column: any) => ({
    colId: column.colId,
    hide: column.hide,
    pinned: column.pinned,
    sort: column.sort,
    sortIndex: column.sortIndex,
    ...(preserveWidths ? { width: column.width, flex: column.flex } : {})
  }))

export const getOperationalColumnLayoutSnapshot = (
  api: { getColumnState?: () => any[]; isDestroyed?: () => boolean } | null | undefined,
  preserveWidths: boolean
) => {
  if (!api?.getColumnState || isOperationalGridDestroyed(api)) return []
  return normalizeOperationalColumnLayout(api.getColumnState(), preserveWidths)
}

export const applyOperationalColumnState = (
  api: {
    applyColumnState?: (config: any) => void
    getColumn?: (key: string) => { getColDef?: () => Record<string, any> } | null
    isDestroyed?: () => boolean
  } | null | undefined,
  layout: any[],
  preserveWidths: boolean
) => {
  if (!api || !layout?.length || !api.applyColumnState || isOperationalGridDestroyed(api)) return
  const state = normalizeOperationalColumnLayout(layout, preserveWidths)
  const boundedState = preserveWidths && api.getColumn
    ? state.map((entry: any) => {
      const definition = api.getColumn?.(entry.colId)?.getColDef?.()
      const width = clampOperationalColumnWidth(entry.width, definition?.minWidth, definition?.maxWidth)
      return width === entry.width ? entry : { ...entry, width }
    })
    : state
  api.applyColumnState({
    state: boundedState,
    applyOrder: true,
    defaultState: { sort: null }
  })
}

export const clampAutoSizedOperationalColumnWidths = (api: {
  getAllDisplayedColumns?: () => Array<{ getColId: () => string; getColDef?: () => Record<string, any>; getActualWidth?: () => number }>
  applyColumnState?: (config: any) => void
  getGridOption?: (key: string) => any
  isDestroyed?: () => boolean
} | null | undefined) => {
  if (!api?.getAllDisplayedColumns || !api.applyColumnState || isOperationalGridDestroyed(api)) return
  const displayedColumns = api.getAllDisplayedColumns()
  if (!Array.isArray(displayedColumns)) return
  const state = displayedColumns.flatMap((column) => {
    const width = column.getActualWidth?.()
    if (typeof width !== 'number' || !Number.isFinite(width)) return []
    const definition = column.getColDef?.()
    const sizing = getGridColumnSizingMetadata(api, column)
    const boundedWidth = clampOperationalColumnWidth(
      width,
      sizing.autoSizeMinWidth ?? definition?.minWidth,
      sizing.autoSizeMaxWidth ?? definition?.maxWidth,
    )
    return boundedWidth === width ? [] : [{ colId: column.getColId(), width: boundedWidth }]
  })
  if (!state.length || isOperationalGridDestroyed(api)) return
  api.applyColumnState({ state, applyOrder: false })
}

export const autoSizeOperationalColumns = ({
  api,
  fitGridWidth = false,
  skipColumnIds = [],
  onSized,
}: {
  api: {
    getAllDisplayedColumns?: () => Array<{ getColId: () => string; getColDef?: () => Record<string, any>; getActualWidth?: () => number }>
    autoSizeColumns?: (keys: string[], skipHeader?: boolean) => void
    sizeColumnsToFit?: () => void
    applyColumnState?: (config: any) => void
    getGridOption?: (key: string) => any
    isDestroyed?: () => boolean
  } | null | undefined
  fitGridWidth?: boolean
  skipColumnIds?: string[]
  onSized?: () => void
}) => {
  if (fitGridWidth) {
    if (!api?.sizeColumnsToFit || isOperationalGridDestroyed(api)) return

    requestAnimationFrame(() => {
      if (isOperationalGridDestroyed(api)) return
      api.sizeColumnsToFit?.()
      clampAutoSizedOperationalColumnWidths(api)
      onSized?.()
    })
    return
  }

  if (!api?.getAllDisplayedColumns || !api.autoSizeColumns || isOperationalGridDestroyed(api)) return
  const displayedColumns = api.getAllDisplayedColumns()
  if (!Array.isArray(displayedColumns)) return
  const columnIds = displayedColumns
    .filter((column) => !getGridColumnSizingMetadata(api, column).skipAutoSize)
    .map((column) => column.getColId())
    .filter((colId) => !skipColumnIds.includes(colId))

  if (!columnIds.length) return

  const run = () => {
    if (isOperationalGridDestroyed(api)) return
    api.autoSizeColumns?.(columnIds, false)
    clampAutoSizedOperationalColumnWidths(api)
    onSized?.()
  }

  requestAnimationFrame(() => {
    run()
    window.setTimeout(run, 32)
  })
}

export const applyOperationalColumnSizing = (
  column: Record<string, any>,
  layout: Record<string, any> | undefined,
  preserveExplicitWidths: boolean
) => {
  const metadata = getOperationalColumnSizingMetadata(column)
  const lockWidth = column.operationalLockWidth
  const nextColumn: Record<string, any> = { ...column }

  if (!lockWidth && nextColumn.width !== undefined) {
    nextColumn.initialWidth = nextColumn.width
    if (!preserveExplicitWidths) delete nextColumn.width
  }

  if (!lockWidth && nextColumn.flex !== undefined) {
    nextColumn.initialFlex = nextColumn.flex
    if (!preserveExplicitWidths) delete nextColumn.flex
  }

  if (!layout) return rememberOperationalColumnSizingMetadata(nextColumn, metadata)

  // null is AG Grid's explicit unpinned state, including viewport overflow.
  if (layout.pinned !== undefined) nextColumn.pinned = layout.pinned
  if (nextColumn.hide === undefined) {
    nextColumn.hide = layout.hide
  }

  if (preserveExplicitWidths && !lockWidth) {
    const restoredWidth = layout.width ?? nextColumn.width
    nextColumn.width = clampOperationalColumnWidth(restoredWidth, nextColumn.minWidth, nextColumn.maxWidth)
    if (layout.flex !== undefined && layout.flex !== null) {
      nextColumn.flex = layout.flex
    } else if (layout.width !== undefined && layout.width !== null) {
      delete nextColumn.flex
      delete nextColumn.initialFlex
    }
  }

  return rememberOperationalColumnSizingMetadata(nextColumn, metadata)
}

export const finalizeOperationalColumnDefinition = (
  column: Record<string, any>,
  layout: Record<string, any> | undefined,
  preserveExplicitWidths: boolean
) => applyOperationalColumnSizing(
  normalizeOperationalColumnDefinition(column),
  layout,
  preserveExplicitWidths
)

export const orderOperationalColumnDefinitions = (
  columns: Record<string, any>[],
  layout: Array<{ colId?: string }> | undefined
) => {
  if (!layout?.length) return columns
  const orderMap = new Map(layout.map((column, index) => [column.colId, index]))
  return [...columns].sort((a, b) => {
    const aId = a.colId || a.field
    const bId = b.colId || b.field
    return (orderMap.get(aId) ?? 1000) - (orderMap.get(bId) ?? 1000)
  })
}

export const sanitizeOperationalColumnLayout = (
  layout: any[],
  allowedColumnIds: Iterable<string>,
  preserveWidths: boolean
) => {
  const allowed = new Set(Array.from(allowedColumnIds))
  return normalizeOperationalColumnLayout(
    (layout || []).filter((column: any) => typeof column?.colId === 'string' && allowed.has(column.colId)),
    preserveWidths
  )
}

export const sanitizeOperationalFilterModel = (
  filterModel: Record<string, any> | null | undefined,
  allowedColumnIds: Iterable<string>
) => {
  const allowed = new Set(Array.from(allowedColumnIds))
  const entries = Object.entries(filterModel || {}).filter(([key]) => allowed.has(key))
  return Object.fromEntries(entries)
}

export const sanitizeOperationalSortModel = (
  sortModel: Array<{ colId?: string; sort?: string }> | null | undefined,
  allowedColumnIds: Iterable<string>
) => {
  const allowed = new Set(Array.from(allowedColumnIds))
  return (Array.isArray(sortModel) ? sortModel : []).filter((entry: any) => (
    typeof entry?.colId === 'string' &&
    allowed.has(entry.colId) &&
    (entry.sort === 'asc' || entry.sort === 'desc')
  )).map((entry: any) => ({
    colId: entry.colId,
    sort: entry.sort,
  }))
}
