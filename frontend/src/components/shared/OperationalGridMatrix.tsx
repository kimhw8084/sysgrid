import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { OperationalAgGrid } from './OperationalAgGrid'
import { OPERATIONAL_GRID_CLASSES, OPERATIONAL_GRID_DEFAULT_COLUMN_DEF } from './OperationalGridContract'
import { getOperationalGridHeaderHeight, getOperationalGridRowHeight } from './OperationalGridSizing'

export const OperationalGridMatrix = React.memo(({
  gridRef,
  rowData,
  columnDefs,
  autoSizeStrategy,
  colResizeDefault = 'normal',
  fontSize,
  rowDensity,
  context,
  getRowId,
  selectionScopeKey,
  onGridReady,
  onSelectionChanged,
  onColumnResized,
  onColumnMoved,
  onDragStopped,
  onColumnPinned,
  onColumnVisible,
  onFilterChanged,
  onSortChanged,
  onRowClicked,
  onRowDoubleClicked,
  onCellContextMenu,
  getRowClass,
  onFirstDataRendered,
  onRowDataUpdated,
  quickFilterText,
  noRowsLabel = 'No data found',
  suppressRowClickSelection = true,
}: any) => {
  const apiRef = useRef<any>(null)
  const unpinFrame = useRef<number>()
  const handleCellKeyDown = useCallback((event: any) => {
    const key = event?.event?.key
    if (!onCellContextMenu || !(key === 'ContextMenu' || (key === 'F10' && event.event.shiftKey))) return
    event.event.preventDefault()
    const cell = event.event.target as HTMLElement | null
    const rect = cell?.getBoundingClientRect()
    const pointEvent = {
      target: event.event.target,
      clientX: rect ? Math.round(rect.left + Math.min(rect.width / 2, 24)) : 0,
      clientY: rect ? Math.round(rect.bottom) : 0,
      preventDefault: () => event.event.preventDefault(),
    }
    onCellContextMenu({ ...event, event: pointEvent })
  }, [onCellContextMenu])
  // AG Grid detects pinned overflow inside ResizeObserver delivery. Defer its
  // layout-changing unpin until the next frame to avoid same-frame resize loops.
  const processUnpinnedColumns = useCallback(({ columns, api, viewportWidth }: any) => {
    let overflowing = columns
    if (columns.some((column: any) => column.getColId?.() === 'row_actions')) {
      const left = api.getDisplayedLeftColumns()
      const right = api.getDisplayedRightColumns()
      let pinnedWidth = [...left, ...right].reduce((total, column) => total + column.getActualWidth(), 0)
      // Keep row commands reachable when pinned columns threaten the center viewport.
      // Release other pinned columns first, retaining the minimum center width.
      const candidates = [...right].reverse().filter(column => column.getColId() !== 'row_actions')
        .concat([...left].reverse(), right.filter((column: any) => column.getColId() === 'row_actions'))
      overflowing = []
      for (const column of candidates) {
        if (pinnedWidth < viewportWidth - 50) break
        overflowing.push(column)
        pinnedWidth -= column.getActualWidth()
      }
    }
    if (unpinFrame.current !== undefined) cancelAnimationFrame(unpinFrame.current)
    unpinFrame.current = requestAnimationFrame(() => {
      unpinFrame.current = undefined
      if (!api.isDestroyed()) api.setColumnsPinned(overflowing, null)
    })
    return []
  }, [])
  useEffect(() => () => {
    if (unpinFrame.current !== undefined) cancelAnimationFrame(unpinFrame.current)
  }, [])

  const defaultColDef = useMemo(() => ({
    ...OPERATIONAL_GRID_DEFAULT_COLUMN_DEF,
    tooltipValueGetter: (params: any) => {
      const value = params.valueFormatted ?? params.value
      return value == null ? null : String(value)
    },
    cellClass: OPERATIONAL_GRID_CLASSES.textCell,
    headerClass: OPERATIONAL_GRID_CLASSES.textHeader,
  }), [])

  useEffect(() => {
    if (apiRef.current && context) {
      apiRef.current.refreshCells({ force: true })
    }
  }, [context])

  useEffect(() => {
    apiRef.current?.deselectAll?.()
  }, [selectionScopeKey])

  return (
    <OperationalAgGrid
      ref={(ref) => {
        apiRef.current = ref?.api
        if (gridRef) {
          if (typeof gridRef === 'function') gridRef(ref)
          else gridRef.current = ref
        }
      }}
      rowData={rowData}
      columnDefs={columnDefs}
      autoSizeStrategy={autoSizeStrategy}
      alwaysShowHorizontalScroll={false}
      processUnpinnedColumns={processUnpinnedColumns}
      colResizeDefault={colResizeDefault}
      defaultColDef={defaultColDef}
      getRowId={getRowId}
      rowSelection="multiple"
      animateRows={false}
      headerHeight={getOperationalGridHeaderHeight(fontSize)}
      rowHeight={getOperationalGridRowHeight(fontSize, rowDensity)}
      rowBuffer={6}
      valueCache={true}
      context={context}
      quickFilterText={quickFilterText}
      onGridReady={onGridReady}
      onSelectionChanged={onSelectionChanged}
      onColumnResized={onColumnResized}
      onColumnMoved={onColumnMoved}
      onDragStopped={onDragStopped}
      onColumnPinned={onColumnPinned}
      onColumnVisible={onColumnVisible}
      onFilterChanged={onFilterChanged}
      onSortChanged={onSortChanged}
      onRowClicked={onRowClicked}
      onRowDoubleClicked={onRowDoubleClicked}
      onCellContextMenu={onCellContextMenu}
      onCellKeyDown={handleCellKeyDown}
      getRowClass={getRowClass}
      onFirstDataRendered={onFirstDataRendered}
      onRowDataUpdated={onRowDataUpdated}
      suppressScrollOnNewData={true}
      suppressCellFocus={false}
      suppressRowClickSelection={suppressRowClickSelection}
      enableCellTextSelection={true}
      tooltipShowMode="whenTruncated"
      tooltipShowDelay={450}
      suppressMovableColumns={false}
      ensureDomOrder={false}
      overlayNoRowsTemplate={`<span class='text-slate-500 font-semibold text-[10px]'>${noRowsLabel}</span>`}
    />
  )
}, (prev, next) => {
  return prev.rowData === next.rowData &&
    prev.columnDefs === next.columnDefs &&
    prev.fontSize === next.fontSize &&
    prev.rowDensity === next.rowDensity &&
    prev.context === next.context &&
    prev.quickFilterText === next.quickFilterText &&
    prev.selectionScopeKey === next.selectionScopeKey
})

OperationalGridMatrix.displayName = 'OperationalGridMatrix'
