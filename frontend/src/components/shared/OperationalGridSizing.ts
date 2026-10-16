export const OPERATIONAL_GRID_AUTO_SIZE_STRATEGY = {
  type: 'fitCellContents' as const,
}

export const isOperationalAutoResizeSource = (source: string) => (
  source === 'autosizeColumns' ||
  source === 'sizeColumnsToFit' ||
  source === 'api' ||
  source === 'flex'
)

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
  api: { getColumnState?: () => any[] } | null | undefined,
  preserveWidths: boolean
) => {
  if (!api?.getColumnState) return []
  return normalizeOperationalColumnLayout(api.getColumnState(), preserveWidths)
}

export const applyOperationalColumnState = (
  api: { applyColumnState?: (config: any) => void } | null | undefined,
  layout: any[],
  preserveWidths: boolean
) => {
  if (!api || !layout?.length || !api.applyColumnState) return
  api.applyColumnState({
    state: normalizeOperationalColumnLayout(layout, preserveWidths),
    applyOrder: true,
    defaultState: { sort: null }
  })
}

export const autoSizeOperationalColumns = ({
  api,
  skipColumnIds = [],
  onSized,
}: {
  api: {
    getAllDisplayedColumns?: () => Array<{ getColId: () => string; getColDef?: () => Record<string, any> }>
    autoSizeColumns?: (keys: string[], skipHeader?: boolean) => void
  } | null | undefined
  skipColumnIds?: string[]
  onSized?: () => void
}) => {
  if (!api?.getAllDisplayedColumns || !api.autoSizeColumns) return
  const columnIds = api
    .getAllDisplayedColumns()
    .filter((column) => !column.getColDef?.()?.operationalSkipAutoSize)
    .map((column) => column.getColId())
    .filter((colId) => !skipColumnIds.includes(colId))

  if (!columnIds.length) return

  const run = () => {
    api.autoSizeColumns?.(columnIds, false)
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
    nextColumn.width = layout.width ?? nextColumn.width
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
