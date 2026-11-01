import React, { useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { isOperationalAutoResizeSource, normalizeOperationalColumnDefinitions } from './OperationalGridSizing'
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
  const storageKey = useMemo(() => {
    if (typeof window === 'undefined' || typeof props.onColumnResized === 'function') return null
    const ids = getOperationalGridColumnIds(columnDefs)
    if (!ids.length) return null
    return `sysgrid:operational-grid-widths:v1:${window.location.pathname}:${ids.join('|')}`
  }, [columnDefs, props.onColumnResized])
  const storedWidths = useMemo(() => readStoredColumnWidths(storageKey), [storageKey])
  const autoSizeStrategy = storedWidths.length ? undefined : props.autoSizeStrategy

  const onGridReady = (event: any) => {
    props.onGridReady?.(event)
    if (!storedWidths.length) return
    requestAnimationFrame(() => {
      if (event.api?.isDestroyed?.()) return
      event.api?.applyColumnState?.({ state: storedWidths, applyOrder: false })
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

  return <AgGridReact {...props} autoSizeStrategy={autoSizeStrategy} onGridReady={onGridReady} onColumnResized={onColumnResized} columnDefs={normalizedColumnDefs} ref={ref} />
})

OperationalAgGrid.displayName = 'OperationalAgGrid'
