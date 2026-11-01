import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { OperationalGridMatrix } from './OperationalGridMatrix'
import {
  getOperationalGridSurfaceStyle,
  OperationalGridSurface,
} from './OperationalWorkspaceShells'
import { clampAutoSizedOperationalColumnWidths, getOperationalCompactGridHeight, OPERATIONAL_GRID_AUTO_SIZE_STRATEGY } from './OperationalGridSizing'
import { WorkspaceEmptyState } from './OperationalWorkspacePrimitives'
import type { OperationalDataState } from './OperationalDataState'

type OperationalGridRuntimeLike = {
  preserveExplicitColumnWidths?: boolean
  autoSizeStrategy?: Record<string, any> | null
  handleGridReady?: (params: any) => void
  handleColumnResized?: (event: any) => void
  handleColumnMoved?: (event: any) => void
  handleDragStopped?: (event: any) => void
  handleColumnPinned?: (event: any) => void
  handleColumnVisible?: (event: any) => void
  handleFilterChanged?: (event: any) => void
  handleSortChanged?: (event: any) => void
}

type OperationalRowInteractionsLike = {
  handleRowClicked?: (event: any) => void
  handleRowDoubleClicked?: (event: any) => void
}

type OperationalContextMenuLike = {
  handleCellContextMenu?: (event: any) => void
}

interface OperationalDataGridProps {
  gridRef?: React.RefObject<any>
  rows: any[] | undefined
  columnDefs: any[]
  runtime: OperationalGridRuntimeLike
  rowInteractions?: OperationalRowInteractionsLike
  contextMenu?: OperationalContextMenuLike
  onSelectionChanged?: (event: any) => void
  onFirstDataRendered?: (event: any) => void
  onRowDataUpdated?: (event: any) => void
  getRowId?: (params: any) => string
  getRowClass?: (params: any) => string
  selectionScopeKey?: string | number | null
  context?: any
  quickFilterText?: string
  fontSize?: number
  rowDensity?: number
  noRowsLabel?: string
  loading?: boolean
  loadingIcon?: React.ReactNode
  loadingLabel?: React.ReactNode
  dataState?: OperationalDataState
  className?: string
  surfaceVariant?: 'golden' | 'attached-panel'
  height?: string
  compactWhenFewRows?: boolean
  suppressRowClickSelection?: boolean
}

export function OperationalDataGrid({
  gridRef,
  rows,
  columnDefs,
  runtime,
  rowInteractions,
  contextMenu,
  onSelectionChanged,
  onFirstDataRendered,
  onRowDataUpdated,
  getRowId,
  getRowClass,
  selectionScopeKey,
  context,
  quickFilterText,
  fontSize = 11,
  rowDensity = 8,
  noRowsLabel = 'No data found',
  loading = false,
  loadingIcon,
  loadingLabel,
  dataState,
  className = '',
  surfaceVariant = 'golden',
  height,
  compactWhenFewRows = Boolean(quickFilterText?.trim()) || height !== undefined,
  suppressRowClickSelection = true,
}: OperationalDataGridProps) {
  const [displayedRowCount, setDisplayedRowCount] = useState(() => rows?.length ?? 0)
  useEffect(() => setDisplayedRowCount(rows?.length ?? 0), [rows])
  const updateDisplayedRowCount = useCallback((event: any) => {
    const count = event?.api?.getDisplayedRowCount?.()
    if (typeof count === 'number' && Number.isFinite(count)) setDisplayedRowCount(count)
  }, [])
  const surfaceStyle = useMemo(() => {
    const style = getOperationalGridSurfaceStyle(fontSize, height)
    const compactHeight = loading || !compactWhenFewRows ? null : getOperationalCompactGridHeight(displayedRowCount, fontSize, rowDensity)
    if (compactHeight !== null) {
      style.height = `${compactHeight}px`
      style.minHeight = `${compactHeight}px`
      style.flex = '0 0 auto'
    }
    return style
  }, [compactWhenFewRows, displayedRowCount, fontSize, height, loading, rowDensity])
  const autoSizeStrategy = useMemo(
    () => (runtime?.preserveExplicitColumnWidths ? undefined : runtime?.autoSizeStrategy ?? OPERATIONAL_GRID_AUTO_SIZE_STRATEGY),
    [runtime?.preserveExplicitColumnWidths, runtime?.autoSizeStrategy]
  )
  const handleFirstDataRendered = useCallback((event: any) => {
    onFirstDataRendered?.(event)
    updateDisplayedRowCount(event)
    if (runtime?.preserveExplicitColumnWidths) return
    const api = event?.api
    if (!api) return
    const clampWidths = () => {
      if (api.isDestroyed?.()) return
      clampAutoSizedOperationalColumnWidths(api)
    }
    requestAnimationFrame(clampWidths)
    window.setTimeout(clampWidths, 32)
  }, [onFirstDataRendered, runtime?.preserveExplicitColumnWidths, updateDisplayedRowCount])
  const noticeToneClass = dataState?.notice?.tone === 'error'
    ? 'border-rose-500/30 bg-rose-500/10 text-rose-100'
    : dataState?.notice?.tone === 'warning'
      ? 'border-[var(--state-warning-border)] bg-[var(--state-warning-surface)] text-[var(--text-primary)]'
      : 'border-blue-500/25 bg-blue-500/10 text-slate-100'
  const notice = dataState?.notice ? (
    <div
      role={dataState.kind === 'query-error' || dataState.notice.tone === 'error' ? 'alert' : 'status'}
      aria-live={dataState.kind === 'query-error' || dataState.notice.tone === 'error' ? 'assertive' : 'polite'}
      className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 ${noticeToneClass}`}
    >
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-[0.14em]">{dataState.notice.title}</p>
        {dataState.notice.description ? <p className="pt-1 text-[11px] text-[var(--text-secondary)]">{dataState.notice.description}</p> : null}
      </div>
      {dataState.notice.onAction ? (
        <button
          type="button"
          onClick={dataState.notice.onAction}
          disabled={dataState.notice.isActionLoading}
          className="min-h-9 shrink-0 rounded-md border border-[var(--state-warning-border)] px-3 text-[9px] font-black uppercase tracking-wider text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-wait disabled:opacity-60"
        >
          {dataState.notice.isActionLoading ? 'Retrying…' : dataState.notice.actionLabel || 'Retry'}
        </button>
      ) : null}
    </div>
  ) : null
  const shouldRenderEmptyState = Boolean(
    dataState &&
    dataState.kind !== 'ready' &&
    dataState.kind !== 'loading' &&
    dataState.kind !== 'query-error' &&
    dataState.title
  )

  if (dataState?.kind === 'query-error') {
    return (
      <OperationalGridSurface
        className={className}
        style={getOperationalGridSurfaceStyle(fontSize, height)}
        loading={false}
        variant={surfaceVariant}
      >
        {notice}
        <div className="flex flex-1 items-center justify-center p-4">
          <WorkspaceEmptyState
            title={dataState.title}
            description={dataState.description}
          />
        </div>
      </OperationalGridSurface>
    )
  }

  if (shouldRenderEmptyState) {
    return (
      <OperationalGridSurface
        className={className}
        style={getOperationalGridSurfaceStyle(fontSize, height)}
        loading={false}
        variant={surfaceVariant}
      >
        {notice}
        <div className="flex flex-1 items-center justify-center p-4">
          <WorkspaceEmptyState
            title={dataState?.title || noRowsLabel}
            description={dataState?.description}
          />
        </div>
      </OperationalGridSurface>
    )
  }

  return (
    <OperationalGridSurface
      className={className}
      style={surfaceStyle}
      loading={loading}
      loadingIcon={loadingIcon}
      loadingLabel={loadingLabel}
      variant={surfaceVariant}
    >
      {notice}
      <div className="min-h-0 flex-1">
        <OperationalGridMatrix
          gridRef={gridRef}
          rowData={rows}
          columnDefs={columnDefs}
          autoSizeStrategy={autoSizeStrategy}
          colResizeDefault="normal"
          fontSize={fontSize}
          rowDensity={rowDensity}
          context={context}
          quickFilterText={quickFilterText}
          getRowId={getRowId}
          getRowClass={getRowClass}
          selectionScopeKey={selectionScopeKey}
          onGridReady={params => {
            if (typeof window !== 'undefined') (window as any).__DEBUG_OPERATIONAL_GRID_API__ = params.api
            runtime.handleGridReady?.(params)
            updateDisplayedRowCount(params)
          }}
          onSelectionChanged={onSelectionChanged}
          onColumnResized={runtime.handleColumnResized}
          onColumnMoved={runtime.handleColumnMoved}
          onDragStopped={runtime.handleDragStopped}
          onColumnPinned={runtime.handleColumnPinned}
          onColumnVisible={runtime.handleColumnVisible}
          onFilterChanged={event => { runtime.handleFilterChanged?.(event); updateDisplayedRowCount(event) }}
          onSortChanged={runtime.handleSortChanged}
          onRowClicked={rowInteractions?.handleRowClicked}
          onRowDoubleClicked={rowInteractions?.handleRowDoubleClicked}
          onCellContextMenu={contextMenu?.handleCellContextMenu}
          onFirstDataRendered={handleFirstDataRendered}
          onRowDataUpdated={event => { onRowDataUpdated?.(event); updateDisplayedRowCount(event) }}
          noRowsLabel={dataState?.noRowsLabel || noRowsLabel}
          suppressRowClickSelection={suppressRowClickSelection}
        />
      </div>
    </OperationalGridSurface>
  )
}
