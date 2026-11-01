import React, { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { OperationalDataGrid } from '../shared/OperationalDataGrid'
import { OperationalGroupedGridView, OperationalGroupedGridSection } from '../shared/OperationalWorkspaceShells'
import { getOperationalGridRowHeight } from '../shared/OperationalGridSizing'
import { buildOperationalGroupSections } from '../shared/OperationalGrouping'
import { getRequestScopeKey } from '../../api/apiClient'
import { fetchOperationalArray } from '../shared/operationalArrayFetch'
import { AssetLegacyReportSurface } from './AssetLegacyReportSurface'
import { AssetLegacyMapSurface } from './AssetLegacyMapSurface'

export function AssetGoldenFeatureSurfaces({
  gridRef,
  allAssets,
  columnDefs,
  contextMenu,
  dataState,
  fontSize,
  getRowClass,
  getRowId,
  groupBy,
  groupOptions,
  collapsedGroups,
  onSetCollapsedGroups,
  onCancelGrouping,
  onSelectReportAsset,
  options,
  onEditAsset,
  onOpenDetails,
  onOpenQuickLook,
  onViewServiceDetails,
  onEditService,
  rowDensity,
  searchTerm = '',
  rows,
  visibleAssets,
  runtime,
  rowInteractions,
  selectionScopeKey,
  viewMode,
  connections,
  relationships,
  reportAssetId,
  reportFocusSection,
  onFocusSectionHandled,
  onOpenMaintenance,
  systemsList,
  onSelectionChanged,
  isSelected,
  gridContext,
}: {
  gridRef?: React.RefObject<any>
  allAssets: any[]
  columnDefs: any[]
  contextMenu: { handleCellContextMenu: (event: any) => void }
  dataState: any
  fontSize: number
  getRowClass?: (params: any) => string
  getRowId?: (params: any) => string
  groupBy: string
  groupOptions: Array<{ value: string; label: string }>
  collapsedGroups: Record<string, boolean>
  onSetCollapsedGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  onCancelGrouping: () => void
  onSelectReportAsset: (asset: any) => void
  options: any[]
  onEditAsset: (asset: any) => void
  onOpenDetails?: (asset: any) => void
  onOpenQuickLook?: (asset: any) => void
  onViewServiceDetails: (service: any) => void
  onEditService: (service: any) => void
  rowDensity: number
  searchTerm?: string
  rows: any[]
  visibleAssets: any[]
  runtime: any
  rowInteractions: any
  selectionScopeKey: string
  viewMode: 'grid' | 'report' | 'map'
  connections: any[]
  relationships: any[]
  reportAssetId?: number | null
  reportFocusSection?: string | null
  onFocusSectionHandled?: () => void
  onOpenMaintenance?: (asset: any) => void
  systemsList: string[]
  onSelectionChanged: (event: any, groupKey?: string) => void
  isSelected: (id: number) => boolean
  gridContext?: any
}) {
  const workDataEnabled = viewMode === 'map' || viewMode === 'report'
  const requestScope = getRequestScopeKey()
  const maintenanceQuery = useQuery({
    queryKey: ['maintenance-windows', requestScope, ''],
    queryFn: () => fetchOperationalArray('/api/v1/maintenance', 'Asset maintenance windows'),
    enabled: workDataEnabled,
    staleTime: 30_000,
  })
  const actionQuery = useQuery({
    queryKey: ['maintenance-actions', requestScope, '', '', 500],
    queryFn: () => fetchOperationalArray('/api/v1/operational-actions?limit=500', 'Asset operational work history'),
    enabled: workDataEnabled,
    staleTime: 30_000,
  })
  const workDataState = {
    isLoading: workDataEnabled && (maintenanceQuery.isPending || actionQuery.isPending),
    isError: maintenanceQuery.isError || actionQuery.isError,
    isFetching: maintenanceQuery.isFetching || actionQuery.isFetching,
    onRetry: () => { void maintenanceQuery.refetch(); void actionQuery.refetch() },
  }

  if (viewMode === 'report') {
    return (
      <AssetLegacyReportSurface
        assets={visibleAssets}
        options={options}
        allAssets={allAssets}
        connections={connections}
        relationships={relationships}
        selectedAssetId={reportAssetId}
        focusSection={reportFocusSection}
        onFocusSectionHandled={onFocusSectionHandled}
        maintenanceWindows={maintenanceQuery.data || []}
        operationalActions={actionQuery.data || []}
        workDataState={workDataState}
        onOpenMaintenance={onOpenMaintenance}
        onSelectAsset={onSelectReportAsset}
        onEdit={onEditAsset}
        onOpenDetails={onOpenDetails}
        onOpenQuickLook={onOpenQuickLook}
        onViewServiceDetails={onViewServiceDetails}
        onEditService={onEditService}
        getConsoleUrl={runtime?.getAssetConsoleUrl}
      />
    )
  }

  if (viewMode === 'map') {
    return <AssetLegacyMapSurface assets={allAssets} visibleAssets={visibleAssets} connections={connections} relationships={relationships} selectedAssetId={reportAssetId} systemsList={systemsList} maintenanceWindows={maintenanceQuery.data || []} operationalActions={actionQuery.data || []} workDataState={workDataState} onOpenDetails={onOpenDetails} onOpenMaintenance={onOpenMaintenance} onEdit={onEditAsset} />
  }

  const groupedSections = buildOperationalGroupSections(rows, groupBy, item => item?.[groupBy], 'Unassigned')

  if (groupBy !== 'raw') {
    return (
      <OperationalGroupedGridView
        summary={(
          <div>
            <p className="operational-group-summary-kicker">Grouped asset matrix</p>
            <p className="operational-group-summary-value">Sorted by {groupOptions.find((option) => option.value === groupBy)?.label || groupBy}</p>
          </div>
        )}
        actions={(
          <>
            <button type="button" onClick={() => onSetCollapsedGroups(Object.fromEntries(groupedSections.map((section: any) => [section.key, false])))} className="operational-group-control">
              Expand All
            </button>
            <button type="button" onClick={() => onSetCollapsedGroups(Object.fromEntries(groupedSections.map((section: any) => [section.key, true])))} className="operational-group-control">
              Collapse All
            </button>
            <button type="button" onClick={onCancelGrouping} className="operational-group-control operational-group-control-danger">
              <X size={12} aria-hidden="true" />
              Cancel grouping
            </button>
          </>
        )}
        sections={groupedSections.map((section) => {
          const isCollapsed = collapsedGroups[section.key]
          const selectedCountForSection = section.items.filter((item: any) => isSelected(Number(item.id))).length
          return (
            <OperationalGroupedGridSection
              key={section.key}
              labelMeta={groupOptions.find((option) => option.value === groupBy)?.label}
              label={section.label}
              count={section.items.length}
              countLabel="assets"
              selectedCount={selectedCountForSection}
              collapsed={Boolean(isCollapsed)}
              onToggle={() => onSetCollapsedGroups((current) => ({ ...current, [section.key]: !current[section.key] }))}
            >
              {!isCollapsed ? (
                <OperationalDataGrid
                  rows={section.items}
                  columnDefs={columnDefs}
                  runtime={runtime}
                  rowInteractions={rowInteractions}
                  contextMenu={contextMenu}
                  onSelectionChanged={(event: any) => onSelectionChanged(event, section.key)}
                  selectionScopeKey={selectionScopeKey}
                  getRowId={getRowId}
                  getRowClass={getRowClass}
                  fontSize={fontSize}
                  rowDensity={rowDensity}
                  noRowsLabel="No assets found"
                  className="w-full"
                  height={`${Math.min(600, section.items.length * getOperationalGridRowHeight(fontSize, rowDensity) + 40)}px`}
                  context={gridContext}
                  suppressRowClickSelection={false}
                />
              ) : null}
            </OperationalGroupedGridSection>
          )
        })}
      />
    )
  }

  return (
    <OperationalDataGrid
      gridRef={gridRef}
      rows={rows}
      columnDefs={columnDefs}
      runtime={runtime}
      rowInteractions={rowInteractions}
      contextMenu={contextMenu}
      onSelectionChanged={(event: any) => onSelectionChanged(event, 'raw')}
      selectionScopeKey={selectionScopeKey}
      getRowId={getRowId}
      getRowClass={getRowClass}
      fontSize={fontSize}
      rowDensity={rowDensity}
      compactWhenFewRows={Boolean(searchTerm.trim())}
      dataState={dataState}
      noRowsLabel="No assets match the current working set."
      height="calc(100vh - 250px)"
      context={gridContext}
      suppressRowClickSelection={false}
    />
  )
}
