export const OPERATIONAL_GRID_CONTENT_AUTO_SIZE_STRATEGY = {
  type: 'fitCellContents' as const,
}

export const OPERATIONAL_GRID_AUTO_SIZE_STRATEGY = OPERATIONAL_GRID_CONTENT_AUTO_SIZE_STRATEGY

export const getOperationalGridHeaderHeight = (fontSize = 11) =>
  Math.max(42, Math.ceil(fontSize + 31))

export const getOperationalGridRowHeight = (fontSize = 11, rowDensity = 8) =>
  Math.min(52, Math.max(32, Math.ceil(fontSize + rowDensity + 17)))

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

const clampOperationalColumnWidth = (width: any, minWidth: any, maxWidth: any): any => {
  if (typeof width !== 'number' || !Number.isFinite(width)) return width
  const minimum = typeof minWidth === 'number' && Number.isFinite(minWidth) ? minWidth : 0
  const maximum = typeof maxWidth === 'number' && Number.isFinite(maxWidth) ? maxWidth : Number.POSITIVE_INFINITY
  return Math.max(minimum, Math.min(width, maximum))
}

const isOperationalGridDestroyed = (api: { isDestroyed?: () => boolean } | null | undefined) => {
  try {
    return api?.isDestroyed?.() === true
  } catch {
    return true
  }
}

// Source of truth: protected sizing / resize behavior for fixed-width operational columns.
export const lockOperationalColumnWidth = (
  column: Record<string, any>,
  layout?: Record<string, any>
) => {
  const lockedWidth = column.width ?? column.initialWidth
  if (!column.operationalLockWidth || lockedWidth == null) return column
  return {
    ...column,
    width: lockedWidth,
    initialWidth: lockedWidth,
    minWidth: lockedWidth,
    maxWidth: lockedWidth,
    flex: undefined,
    initialFlex: undefined,
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
  isDestroyed?: () => boolean
} | null | undefined) => {
  if (!api?.getAllDisplayedColumns || !api.applyColumnState || isOperationalGridDestroyed(api)) return
  const displayedColumns = api.getAllDisplayedColumns()
  if (!Array.isArray(displayedColumns)) return
  const state = displayedColumns.flatMap((column) => {
    const width = column.getActualWidth?.()
    if (typeof width !== 'number' || !Number.isFinite(width)) return []
    const definition = column.getColDef?.()
    const boundedWidth = clampOperationalColumnWidth(width, definition?.minWidth, definition?.maxWidth)
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
    .filter((column) => !column.getColDef?.()?.operationalSkipAutoSize)
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
  const nextColumn: Record<string, any> = { ...column }

  if (!column.operationalLockWidth && nextColumn.width !== undefined) {
    nextColumn.initialWidth = nextColumn.width
    if (!preserveExplicitWidths) delete nextColumn.width
  }

  if (!column.operationalLockWidth && nextColumn.flex !== undefined) {
    nextColumn.initialFlex = nextColumn.flex
    if (!preserveExplicitWidths) delete nextColumn.flex
  }

  if (!layout) return nextColumn

  // null is AG Grid's explicit unpinned state, including viewport overflow.
  if (layout.pinned !== undefined) nextColumn.pinned = layout.pinned
  if (nextColumn.hide === undefined) {
    nextColumn.hide = layout.hide
  }

  if (preserveExplicitWidths && !column.operationalLockWidth) {
    const restoredWidth = layout.width ?? nextColumn.width
    nextColumn.width = clampOperationalColumnWidth(restoredWidth, nextColumn.minWidth, nextColumn.maxWidth)
    nextColumn.flex = layout.flex ?? nextColumn.flex
  }

  return nextColumn
}

export const finalizeOperationalColumnDefinition = (
  column: Record<string, any>,
  layout: Record<string, any> | undefined,
  preserveExplicitWidths: boolean
) => lockOperationalColumnWidth(
  applyOperationalColumnSizing(column, layout, preserveExplicitWidths),
  layout
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
