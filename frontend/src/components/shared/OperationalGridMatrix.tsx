import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { OperationalAgGrid } from './OperationalAgGrid'
import { OPERATIONAL_GRID_CLASSES, OPERATIONAL_GRID_DEFAULT_COLUMN_DEF } from './OperationalGridContract'
import { getOperationalGridHeaderHeight, getOperationalGridRowHeight } from './OperationalGridSizing'

export function getOperationalColumnsToUnpinForOverflow(
  leftColumns: any[],
  rightColumns: any[],
  viewportWidth: number,
  centerSafetyWidth = 50,
) {
  const pinnedWidth = [...leftColumns, ...rightColumns].reduce(
    (total, column) => total + (Number(column.getActualWidth?.()) || 0),
    0,
  )
  let remainingWidth = pinnedWidth
  const canUnpin = (column: any) => !column.getColDef?.().lockPinned && !column.getColDef?.().lockPosition
  const isActionColumn = (column: any) => column.getColId?.() === 'row_actions'
  const candidates = [
    ...rightColumns.slice().reverse().filter((column) => canUnpin(column) && !isActionColumn(column)),
    ...leftColumns.slice().reverse().filter(canUnpin),
    ...rightColumns.filter((column) => canUnpin(column) && isActionColumn(column)),
  ]
  const toUnpin: any[] = []

  for (const column of candidates) {
    if (remainingWidth < viewportWidth - centerSafetyWidth) break
    toUnpin.push(column)
    remainingWidth -= Number(column.getActualWidth?.()) || 0
  }

  return toUnpin
}

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
  onCellKeyDown: onCellKeyDownProp,
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
    if (onCellContextMenu && (key === 'ContextMenu' || (key === 'F10' && event.event.shiftKey))) {
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
      return
    }
    onCellKeyDownProp?.(event)
  }, [onCellContextMenu, onCellKeyDownProp])
  // AG Grid detects pinned overflow inside ResizeObserver delivery. Defer its
  // layout-changing unpin until the next frame to avoid same-frame resize loops.
  const processUnpinnedColumns = useCallback(({ api, viewportWidth }: any) => {
    const left = api.getDisplayedLeftColumns?.() || []
    const right = api.getDisplayedRightColumns?.() || []
    // Identity and action columns marked lockPinned/lockPosition remain frozen;
    // release only unlocked columns when the center viewport needs room.
    const overflowing = getOperationalColumnsToUnpinForOverflow(left, right, viewportWidth)
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
