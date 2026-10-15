import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { OPERATIONAL_GRID_CLASSES } from './OperationalGridContract'

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
  // AG Grid detects pinned overflow inside ResizeObserver delivery. Defer its
  // layout-changing unpin until the next frame to avoid same-frame resize loops.
  const processUnpinnedColumns = useCallback(({ columns, api, viewportWidth }: any) => {
    let overflowing = columns
    if (columns.some((column: any) => column.getColId?.() === 'row_actions')) {
      const left = api.getDisplayedLeftColumns()
      const right = api.getDisplayedRightColumns()
      let pinnedWidth = [...left, ...right].reduce((total, column) => total + column.getActualWidth(), 0)
      // Keep row commands reachable on phones. Release other pinned columns
      // first, retaining AG Grid's minimum 50px center viewport and width rules.
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
    sortable: true,
    resizable: true,
    filter: true,
    suppressMovable: false,
    wrapText: false,
    autoHeight: false,
    cellClass: OPERATIONAL_GRID_CLASSES.centeredCell,
    headerClass: OPERATIONAL_GRID_CLASSES.centeredHeader,
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
    <AgGridReact
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
      processUnpinnedColumns={processUnpinnedColumns}
      colResizeDefault={colResizeDefault}
      defaultColDef={defaultColDef}
      getRowId={getRowId}
      rowSelection="multiple"
      animateRows={false}
      headerHeight={fontSize + rowDensity + 10}
      rowHeight={fontSize + rowDensity + 4}
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
      getRowClass={getRowClass}
      onFirstDataRendered={onFirstDataRendered}
      onRowDataUpdated={onRowDataUpdated}
      suppressScrollOnNewData={true}
      suppressCellFocus={true}
      suppressRowClickSelection={suppressRowClickSelection}
      enableCellTextSelection={true}
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
