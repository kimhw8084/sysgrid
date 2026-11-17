import React, { useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { buildOperationalColumnSizingContext, clampOperationalColumnWidth, getOperationalContentAutoSizeStrategy, isOperationalAutoResizeSource, normalizeOperationalColumnDefinitions } from './OperationalGridSizing'
import { readOptionalStorage, writeOptionalStorage } from './optionalStorage'

const getOperationalGridColumnIds = (definitions: any[] = []) => {
  const ids: string[] = []
  const visit = (columns: any[]) => columns.forEach((column, index) => {
    if (Array.isArray(column?.children)) {
      visit(column.children)
      return
    }
    const id = column?.colId ?? column?.field ?? column?.headerName ?? `column-${index}`
    ids.push(String(id))
  })
  visit(definitions)
  return ids
}

const readStoredColumnWidths = (storageKey: string | null) => {
  if (!storageKey) return []
  try {
    const value = JSON.parse(readOptionalStorage(storageKey) || 'null')
    return Array.isArray(value?.columns)
      ? value.columns.filter((column: any) => typeof column?.colId === 'string' && Number.isFinite(column?.width) && column.width >= 40)
      : []
  } catch {
    return []
  }
}

export const OperationalAgGrid = React.forwardRef<any, any>(({ columnDefs, ...props }, ref) => {
  const normalizedColumnDefs = useMemo(
    () => normalizeOperationalColumnDefinitions(columnDefs),
    [columnDefs],
  )
  const operationalContext = useMemo(
    () => buildOperationalColumnSizingContext(props.context, normalizedColumnDefs),
    [normalizedColumnDefs, props.context],
  )
  const storageKey = useMemo(() => {
    if (typeof window === 'undefined') return null
    const ids = getOperationalGridColumnIds(columnDefs)
    if (!ids.length) return null
    return `sysgrid:operational-grid-widths:v1:${window.location.pathname}:${ids.join('|')}`
  }, [columnDefs])
  const storedWidths = useMemo(() => readStoredColumnWidths(storageKey), [storageKey])
  const boundedAutoSizeStrategy = useMemo(
    () => getOperationalContentAutoSizeStrategy(props.autoSizeStrategy, normalizedColumnDefs),
    [normalizedColumnDefs, props.autoSizeStrategy],
  )
  const autoSizeStrategy = storedWidths.length ? undefined : boundedAutoSizeStrategy

  const onGridReady = (event: any) => {
    props.onGridReady?.(event)
    if (!storedWidths.length) return
    requestAnimationFrame(() => {
      if (event.api?.isDestroyed?.()) return
      const boundedWidths = storedWidths.map((stored: any) => {
        const definition = event.api?.getColumn?.(stored.colId)?.getColDef?.()
        const width = clampOperationalColumnWidth(stored.width, definition?.minWidth, definition?.maxWidth)
        return width === stored.width ? stored : { ...stored, width }
      })
      event.api?.applyColumnState?.({ state: boundedWidths, applyOrder: false })
    })
  }

  const onColumnResized = (event: any) => {
    props.onColumnResized?.(event)
    if (!storageKey || !event?.finished || isOperationalAutoResizeSource(event.source || '')) return
    const columns = event.api?.getColumnState?.()
      ?.filter((column: any) => typeof column?.colId === 'string' && Number.isFinite(column?.width) && column.width >= 40)
      .map((column: any) => ({ colId: column.colId, width: column.width })) || []
    if (columns.length) writeOptionalStorage(storageKey, JSON.stringify({ version: 1, columns }))
  }

  return <AgGridReact {...props} context={operationalContext} autoSizeStrategy={autoSizeStrategy} onGridReady={onGridReady} onColumnResized={onColumnResized} columnDefs={normalizedColumnDefs} ref={ref} />
})

OperationalAgGrid.displayName = 'OperationalAgGrid'
