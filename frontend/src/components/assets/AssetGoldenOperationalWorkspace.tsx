import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Clipboard,
  Download,
  FileText,
  GitCompare,
  Eye,
  EyeOff,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Plus,
  RotateCcw,
  Settings,
  Sliders,
  Upload,
  Zap,
} from 'lucide-react'
import { ToolbarButton, ToolbarGroup, ToolbarIconButton } from '../shared/LayoutPrimitives'
import { OperationalDisplayPanel, OperationalSavedViewsPanel, OperationalAnchoredPanel } from '../shared/OperationalWorkspaceShells'
import { OperationalRowActionMenu } from '../shared/OperationalRowActionMenu'
import { buildAssetGoldenColumns } from './assetGoldenColumns'
import { buildAssetGoldenRowActionSections } from './assetGoldenRowActions'
import AssetGoldenShellScaffold from './AssetGoldenShellScaffold'
import { AssetGoldenFeatureSurfaces } from './AssetGoldenFeatureSurfaces'
import { AssetGoldenDialogs } from './AssetGoldenDialogs'
import { useAssetGoldenWorkspace } from './assetGoldenData'
import {
  useOperationalContextMenu,
  useOperationalDismissController,
  useOperationalGroupedSelection,
  useOperationalRowInteractions,
} from '../shared/OperationalGridInteractions'
import { AppDropdown } from '../shared/AppDropdown'
import { showWorkspaceToast } from '../shared/WorkspaceToast'
import { useWorkspaceOverlayController } from '../shared/OperationalWorkspaceHooks'
import { WorkspaceFloatingPanel, useWorkspaceAnchoredLayer } from '../shared/OperationalWorkspacePrimitives'
import { AssetBulkActionsPanel } from './AssetBulkActionsPanel'
import { AssetCompareModal } from './AssetCompareModal'
import { OperationalBulkPreviewModal } from '../shared/OperationalBulkPreviewModal'

const GROUP_OPTIONS = [
  { value: 'raw', label: 'Raw Table' },
  { value: 'system', label: 'System' },
  { value: 'type', label: 'Type' },
  { value: 'status', label: 'Status' },
  { value: 'environment', label: 'Environment' },
  { value: 'owner', label: 'Owner' },
  { value: 'site_name', label: 'Site' },
  { value: 'rack_name', label: 'Rack' },
]

export default function AssetGoldenOperationalWorkspace() {
  const workspace = useAssetGoldenWorkspace()
  const {
    setDetailAsset,
    setSearchParams,
    setRowActionMenu,
    setReportAssetId,
    setReportFocusSection,
    setViewMode,
  } = workspace

  const gridRef = useRef<any>(null)
  const [showFilterBar, setShowFilterBar] = useState(false)
  const [showCompareOpen, setShowCompareOpen] = useState(false)
  const [compareIds, setCompareIds] = useState<number[]>([])
  const [isIntelligenceExpanded, setIsIntelligenceExpanded] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [rowDeleteConfirmId, setRowDeleteConfirmId] = useState<number | null>(null)

  const {
    activeOverlay,
    isOverlayOpen,
    openOverlay,
    toggleOverlay,
    dismissOverlays,
  } = useWorkspaceOverlayController()

  const showDisplayMenu = isOverlayOpen('display')
  const showViewsMenu = isOverlayOpen('views')
  const showBulkMenu = isOverlayOpen('bulk')
  const showExportMenu = isOverlayOpen('export')
  const hasRowActionMenu = activeOverlay === 'rowAction' && Boolean(workspace.rowActionMenu)

  const { triggerRef: displayMenuButtonRef, panelRef: displayMenuPanelRef, panelStyle: displayMenuStyle } = useWorkspaceAnchoredLayer(showDisplayMenu, { minWidth: 320 })
  const { triggerRef: viewsMenuButtonRef, panelRef: viewsMenuPanelRef, panelStyle: viewsMenuStyle } = useWorkspaceAnchoredLayer(showViewsMenu, { minWidth: 420 })
  const { triggerRef: bulkMenuButtonRef, panelRef: bulkMenuPanelRef, panelStyle: bulkMenuStyle } = useWorkspaceAnchoredLayer(showBulkMenu, { minWidth: 340 })
  const { triggerRef: exportMenuButtonRef, panelRef: exportMenuPanelRef, panelStyle: exportMenuStyle } = useWorkspaceAnchoredLayer(showExportMenu, { minWidth: 260 })

  const openDetailAsset = useCallback((asset: any) => {
    setDetailAsset(asset)
    setSearchParams((current: URLSearchParams) => {
      const next = new URLSearchParams(current)
      next.set('id', String(asset.id))
      return next
    })
  }, [setDetailAsset, setSearchParams])

  const dismissWorkspaceMenus = useCallback(() => {
    dismissOverlays()
    setRowActionMenu(null)
    setRowDeleteConfirmId(null)
  }, [dismissOverlays, setRowActionMenu])

  const openReportSection = useCallback((asset: any, section?: string) => {
    setReportAssetId(asset.id)
    setReportFocusSection(section || null)
    setViewMode('report')
    dismissWorkspaceMenus()
  }, [dismissWorkspaceMenus, setReportAssetId, setReportFocusSection, setViewMode])

  useEffect(() => {
    if (activeOverlay !== 'rowAction' && workspace.rowActionMenu) {
      setRowActionMenu(null)
    }
  }, [activeOverlay, setRowActionMenu, workspace.rowActionMenu])

  useEffect(() => {
    if (activeOverlay === 'rowAction' && !workspace.rowActionMenu) {
      dismissOverlays()
    }
  }, [activeOverlay, dismissOverlays, workspace.rowActionMenu])

  const openRowActionMenuAtPoint = useCallback((asset: any, x: number, y: number) => {
    setRowDeleteConfirmId(null)
    setRowActionMenu({ asset, x, y })
    openOverlay('rowAction')
  }, [openOverlay, setRowActionMenu, setRowDeleteConfirmId])

  const { handleCellContextMenu } = useOperationalContextMenu({
    onOpenRowActionMenu: useCallback((asset, point) => {
      openRowActionMenuAtPoint(asset, point.x, point.y)
    }, [openRowActionMenuAtPoint]),
  })

  const {
    activeTab,
    hiddenColumns,
    fontSize,
    setQuickLookAsset,
    setEditingAsset,
    getAssetConsoleUrl,
    toggleFavorite,
    toggleWatch,
  } = workspace

  const columnDefs = useMemo(() => buildAssetGoldenColumns({
    activeTab,
    hiddenColumns,
    fontSize,
    isIntelligenceExpanded,
    isRecentChange: (asset) => {
      if (!asset?.updated_at) return false
      return Date.now() - new Date(asset.updated_at).getTime() < 1000 * 60 * 60 * 24
    },
    onOpenQuickLook: setQuickLookAsset,
    onOpenDetails: openDetailAsset,
    onOpenEdit: setEditingAsset,
    getConsoleUrl: getAssetConsoleUrl,
    onOpenRowActions: (asset, event) => {
      event.stopPropagation()
      openRowActionMenuAtPoint(asset, event.clientX, event.clientY)
    },
    onToggleFavorite: toggleFavorite,
    onToggleWatch: toggleWatch,
  }), [
    activeTab,
    hiddenColumns,
    fontSize,
    isIntelligenceExpanded,
    setQuickLookAsset,
    openDetailAsset,
    setEditingAsset,
    getAssetConsoleUrl,
    openRowActionMenuAtPoint,
    toggleFavorite,
    toggleWatch,
  ])

  const selectedCount = workspace.selectedIds.length
  const hasVisibleRows = workspace.visibleAssets.length > 0
  const hasRegistryRows = workspace.allAssets.length > 0
  const isGridLoading = workspace.dataState?.kind === 'loading'
  const isSelected = useCallback((id: number) => workspace.selectedIds.includes(Number(id)), [workspace.selectedIds])
  const selectedAssets = useMemo(() => workspace.visibleAssets.filter((asset) => isSelected(asset.id)), [isSelected, workspace.visibleAssets])
  const compareItems = useMemo(() => {
    const sourceIds = compareIds.length > 0 ? compareIds : workspace.selectedIds
    if (!sourceIds.length) return []
    return sourceIds
      .map((id) => workspace.allAssets.find((asset: any) => Number(asset.id) === Number(id)))
      .filter(Boolean)
      .slice(0, 5)
  }, [compareIds, workspace.allAssets, workspace.selectedIds])

  const rowActionSections = workspace.rowActionMenu ? buildAssetGoldenRowActionSections({
    asset: workspace.rowActionMenu.asset,
    activeTab: workspace.activeTab,
    onOpenQuickLook: workspace.setQuickLookAsset,
    onOpenReport: (asset) => {
      openReportSection(asset)
    },
    onOpenMap: (asset) => {
      workspace.setReportAssetId(asset.id)
      workspace.setViewMode('map')
      dismissWorkspaceMenus()
    },
    onOpenDetails: openDetailAsset,
    onOpenEdit: workspace.setEditingAsset,
    onOpenReportSection: openReportSection,
    onAddToCompare: (asset) => {
      setCompareIds((current) => {
        const next = current.includes(asset.id) ? current : [...current, asset.id].slice(0, 5)
        if (next.length >= 2) setShowCompareOpen(true)
        return next
      })
    },
    onCloseMenu: dismissWorkspaceMenus,
    onRequestConfirm: workspace.openConfirm,
    onBulkAction: ({ action, ids }) => workspace.performBulkAction(action, ids),
    onCopyAssetId: (asset) => {
      navigator.clipboard.writeText(String(asset.id))
      showWorkspaceToast('Asset ID copied')
    },
    onCopyRow: (asset) => {
      navigator.clipboard.writeText(JSON.stringify(asset, null, 2))
      showWorkspaceToast('Asset row copied')
    },
    onExportRow: (asset) => {
      navigator.clipboard.writeText(Object.values(asset).map((value) => JSON.stringify(value ?? '')).join(','))
      showWorkspaceToast('Asset row exported to clipboard')
    },
    getConsoleUrl: workspace.getAssetConsoleUrl,
    rowDeleteConfirmId,
    setRowDeleteConfirmId,
    favoriteIds: workspace.favoriteIds,
    watchIds: workspace.watchIds,
    onToggleFavorite: workspace.toggleFavorite,
    onToggleWatch: workspace.toggleWatch,
  }) : []

  const LENS_OPTIONS = useMemo(() => [
    { value: 'all', label: 'All Lenses' },
    { value: 'degraded', label: 'Degraded' },
    { value: 'unowned', label: 'Unowned' },
    { value: 'security', label: 'Security' },
    { value: 'network', label: 'Network' },
  ], [])

  const statusOptions = useMemo(() => workspace.filterOptions.status.map((status) => ({ value: status, label: status })), [workspace.filterOptions.status])
  const systemOptions = useMemo(() => workspace.filterOptions.system.map((system) => ({ value: system, label: system })), [workspace.filterOptions.system])
  const typeOptions = useMemo(() => workspace.filterOptions.type.map((type) => ({ value: type, label: type })), [workspace.filterOptions.type])
  const ownerOptions = useMemo(() => workspace.filterOptions.owner.map((owner) => ({ value: owner, label: owner })), [workspace.filterOptions.owner])

  const handleCopyToClipboard = useCallback(() => {
    if (!gridRef.current?.api) {
      showWorkspaceToast('Grid is not ready', { type: 'error' })
      return
    }
    const csvData = gridRef.current.api.getDataAsCsv({
      allColumns: false,
      onlySelected: selectedCount > 0,
      suppressQuotes: true,
    })
    if (!csvData) {
      showWorkspaceToast('No grid data available', { type: 'error' })
      return
    }
    navigator.clipboard.writeText(csvData)
      .then(() => showWorkspaceToast(selectedCount > 0 ? 'Selected assets copied to clipboard' : 'Asset table copied to clipboard'))
      .catch(() => showWorkspaceToast('Failed to copy data', { type: 'error' }))
  }, [selectedCount])

  const handleExportCSV = useCallback(() => {
    if (!gridRef.current?.api) {
      showWorkspaceToast('Grid is not ready', { type: 'error' })
      return
    }
    const hasSelection = workspace.selectedIds.length > 0
    gridRef.current.api.exportDataAsCsv({
      fileName: `SysGrid_Assets_${new Date().toISOString().slice(0, 10)}.csv`,
      allColumns: true,
      onlySelected: hasSelection,
    })
    showWorkspaceToast(hasSelection ? 'Exported selected asset rows to CSV' : 'Asset CSV exported')
  }, [workspace.selectedIds.length])

  // AgGrid owns live selection; stable row IDs preserve it across data refreshes.
  // Only a scope change or an explicit successful bulk operation resets it.
  const selectionScopeKey = `${workspace.activeTab}:${workspace.viewMode}:${workspace.groupBy}:${workspace.selectionResetVersion}`
  const { handleSelectionChanged } = useOperationalGroupedSelection({
    setSelectedIds: workspace.setSelectedIds,
    selectionScopeKey,
  })

  const { handleRowClicked, handleRowDoubleClicked } = useOperationalRowInteractions({
    onRowDoubleClick: useCallback((asset) => {
      openDetailAsset(asset)
    }, [openDetailAsset]),
    selectionScopeKey,
    suppressRowClickSelection: false,
  })

  const getRowClass = useCallback((params: any) => (
    params.node.rowIndex % 2 === 0 ? 'operational-grid-row-even' : 'operational-grid-row-odd'
  ), [])

  const assetContextMenu = useMemo(() => ({ handleCellContextMenu }), [handleCellContextMenu])
  const assetRowInteractions = useMemo(() => ({ handleRowClicked, handleRowDoubleClicked }), [handleRowClicked, handleRowDoubleClicked])

  useEffect(() => {
    if (workspace.groupBy === 'raw') return
    const groupedSections = workspace.visibleAssets.reduce((acc: string[], asset: any) => {
      const label = String(asset?.[workspace.groupBy] || 'Unassigned')
      if (!acc.includes(label)) acc.push(label)
      return acc
    }, []).sort((a, b) => a.localeCompare(b))
    setCollapsedGroups((current) => {
      const next = { ...current }
      groupedSections.forEach((section) => {
        if (!(section in next)) next[section] = false
      })
      Object.keys(next).forEach((key) => {
        if (!groupedSections.includes(key)) delete next[key]
      })
      return next
    })
  }, [workspace.groupBy, workspace.visibleAssets])

  // Refresh favorite and watch columns immediately in AgGrid when changed
  useEffect(() => {
    if (gridRef.current?.api) {
      gridRef.current.api.refreshCells({ columns: ['favorite', 'watch'], force: true })
      if (typeof gridRef.current.api.onSortChanged === 'function') {
        gridRef.current.api.onSortChanged()
      }
    }
  }, [workspace.favoriteIds, workspace.watchIds])

  // Filter compareIds to only include assets in the currently active tab's visiblePool
  useEffect(() => {
    if (compareIds.length > 0) {
      const validPoolIds = new Set(workspace.visiblePool.map((asset: any) => Number(asset.id)))
      setCompareIds((current) => {
        const next = current.filter((id) => validPoolIds.has(Number(id)))
        if (next.length !== current.length) {
          return next
        }
        return current
      })
    }
  }, [compareIds, workspace.visiblePool])

  useOperationalDismissController({
    active: showBulkMenu || showDisplayMenu || showViewsMenu || showExportMenu || hasRowActionMenu,
    onDismiss: dismissWorkspaceMenus,
    allTriggerRefs: [bulkMenuButtonRef, displayMenuButtonRef, exportMenuButtonRef, viewsMenuButtonRef],
    bulkMenuButtonRef,
    bulkMenuPanelRef,
    displayMenuButtonRef,
    displayMenuPanelRef,
    exportMenuButtonRef,
    exportMenuPanelRef,
    viewsMenuButtonRef,
    viewsMenuPanelRef,
    showBulkMenu,
    showDisplayMenu,
    showExportMenu,
    showViewsMenu,
    hasRowActionMenu,
  })

  const secondaryToolbar = showFilterBar ? (
    <div className="space-y-3">
      {showFilterBar ? (
        <div className="grid w-full gap-3 md:grid-cols-5">
          <AppDropdown value={workspace.activeLens} onChange={(value) => workspace.setActiveLens((value || 'all') as any)} options={LENS_OPTIONS} label="Lens Filter" placeholder="All Lenses" />
          <AppDropdown multi value={workspace.filters.status} onChange={(value) => workspace.setFilters((current: any) => ({ ...current, status: value || [] }))} options={statusOptions} label="Status Filter" placeholder="All statuses" />
          <AppDropdown multi value={workspace.filters.system} onChange={(value) => workspace.setFilters((current: any) => ({ ...current, system: value || [] }))} options={systemOptions} label="System Filter" placeholder="All systems" />
          <AppDropdown multi value={workspace.filters.type} onChange={(value) => workspace.setFilters((current: any) => ({ ...current, type: value || [] }))} options={typeOptions} label="Type Filter" placeholder="All types" />
          <AppDropdown multi value={workspace.filters.owner} onChange={(value) => workspace.setFilters((current: any) => ({ ...current, owner: value || [] }))} options={ownerOptions} label="Owner Filter" placeholder="All owners" />
        </div>
      ) : null}
    </div>
  ) : null

  return (
    <>
      <AssetGoldenShellScaffold
        activeTab={workspace.activeTab}
        existingCount={workspace.lifecycleCounts.inventory}
        purgedCount={workspace.lifecycleCounts.purged}
        onTabChange={(next) => {
          workspace.setActiveTab(next)
          workspace.setSelectedIds([])
          dismissWorkspaceMenus()
        }}
        searchTerm={workspace.searchTerm}
        onSearchTermChange={(event) => workspace.setSearchTerm(event.target.value)}
        filterChips={workspace.filterChips}
        viewMode={workspace.viewMode}
        onViewModeChange={(mode) => {
          dismissWorkspaceMenus()
          workspace.setViewMode(mode)
        }}
        toolbarControls={(
          <>
            <ToolbarGroup>
              <div className="views-menu-container">
                <ToolbarButton ref={viewsMenuButtonRef as any} active={showViewsMenu} onClick={() => toggleOverlay('views')}>
                  <span className="flex items-center gap-2">
                    <LayoutGrid size={14} />
                    Views
                  </span>
                </ToolbarButton>
              </div>
              <div className="display-menu-container">
                <ToolbarButton ref={displayMenuButtonRef as any} active={showDisplayMenu} onClick={() => toggleOverlay('display')}>
                  <span className="flex items-center gap-2">
                    <Sliders size={14} />
                    Display
                  </span>
                </ToolbarButton>
              </div>
              <ToolbarIconButton ref={exportMenuButtonRef as any} onClick={() => toggleOverlay('export')} title="Export asset data" active={showExportMenu}>
                <Download size={16} />
              </ToolbarIconButton>
              <ToolbarIconButton
                onClick={handleCopyToClipboard}
                title={hasVisibleRows ? 'Copy to clipboard' : isGridLoading ? 'Grid is still loading' : 'No visible asset rows to copy'}
                disabled={!hasVisibleRows || isGridLoading}
              >
                <Clipboard size={16} />
              </ToolbarIconButton>
              <ToolbarIconButton onClick={() => { dismissWorkspaceMenus(); workspace.setShowRegistryModal(true) }} title="Registry configuration">
                <Settings size={16} />
              </ToolbarIconButton>
            </ToolbarGroup>
            <ToolbarGroup>
              <ToolbarButton onClick={() => { dismissWorkspaceMenus(); workspace.setShowImportModal(true) }} title="Import asset rows">
                <span className="flex items-center gap-2">
                  <Upload size={14} />
                  Import
                </span>
              </ToolbarButton>
              <ToolbarButton active={showFilterBar} onClick={() => setShowFilterBar((current) => !current)} title={showFilterBar ? 'Hide filters' : 'Show filters'}>
                <span className="flex items-center gap-2">
                  {showFilterBar ? <EyeOff size={14} /> : <Eye size={14} />}
                  Filters
                </span>
              </ToolbarButton>
              <ToolbarButton active={isIntelligenceExpanded} onClick={() => setIsIntelligenceExpanded((current) => !current)} title={isIntelligenceExpanded ? 'Hide Intelligence Columns' : 'Show Intelligence Columns'}>
                <span className="flex items-center gap-2">
                  {isIntelligenceExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  Toggle Intelligence
                </span>
              </ToolbarButton>
            </ToolbarGroup>
          </>
        )}
        secondaryToolbar={secondaryToolbar}
        toolbarActions={(
          <>
            {workspace.lastLifecycleOperation ? (
              <ToolbarButton
                onClick={() => {
                  dismissWorkspaceMenus()
                  const operation = workspace.lastLifecycleOperation
                  workspace.openConfirm(
                    'Revert asset operation',
                    `Revert the completed ${operation.originalAction === 'delete' ? 'archive' : 'restore'} operation for ${operation.targetLabels.join(', ')}?`,
                    () => { void workspace.executeRevert(operation) },
                  )
                }}
                disabled={workspace.isReverting || workspace.isLastLifecycleRecoveryBlocked}
                ariaLabel="Revert last completed asset lifecycle operation"
                title={workspace.isLastLifecycleRecoveryBlocked
                  ? 'Wait for the overlapping permanent purge to finish before reverting this asset operation'
                  : 'Revert last completed asset lifecycle operation'}
              >
                <span className="flex items-center gap-2">
                  <RotateCcw size={14} />
                  {workspace.isReverting ? 'Reverting...' : 'Revert'}
                </span>
              </ToolbarButton>
            ) : null}
            <ToolbarButton onClick={() => {
              dismissWorkspaceMenus()
              setCompareIds(workspace.selectedIds.slice(0, 5))
              setShowCompareOpen(true)
            }} disabled={selectedCount < 2 || selectedCount > 5} active={showCompareOpen} title="Compare selected assets">
              <span className="flex items-center gap-2">
                <GitCompare size={14} />
                Compare
              </span>
            </ToolbarButton>
            <ToolbarButton ref={bulkMenuButtonRef as any} onClick={() => toggleOverlay('bulk')} disabled={selectedCount === 0} active={showBulkMenu} title="Bulk actions">
              <span className="flex items-center gap-2">
                <Zap size={14} />
                Bulk Actions
              </span>
            </ToolbarButton>
            <ToolbarButton onClick={() => { dismissWorkspaceMenus(); workspace.setEditingAsset({}) }} variant="primary" className="px-6 py-2">
              <Plus size={14} />
              Register Asset
            </ToolbarButton>
          </>
        )}
        floatingPanels={(
          <>
            <OperationalDisplayPanel
              isOpen={showDisplayMenu}
              panelRef={displayMenuPanelRef}
              panelStyle={displayMenuStyle}
              title="Asset display"
              onClose={dismissWorkspaceMenus}
              fontSize={workspace.fontSize}
              onFontSizeChange={workspace.setFontSize}
              rowDensity={workspace.rowDensity}
              onRowDensityChange={workspace.setRowDensity}
              groupBy={workspace.groupBy}
              onGroupByChange={workspace.setGroupBy}
              groupOptions={GROUP_OPTIONS}
              columns={columnDefs}
              hiddenColumns={workspace.hiddenColumns}
              onToggleColumn={workspace.toggleColumn}
            />
            <OperationalSavedViewsPanel
              isOpen={showViewsMenu}
              panelRef={viewsMenuPanelRef}
              panelStyle={viewsMenuStyle}
              entityLabel="Asset"
              onClose={dismissWorkspaceMenus}
              activeViewId={workspace.activeViewId}
              currentViewName={workspace.savedViews.find((view: any) => view.id === workspace.activeViewId)?.name || 'Unsaved working view'}
              newViewName={workspace.newViewName}
              onNewViewNameChange={workspace.setNewViewName}
              onCreateView={workspace.createSavedView}
              onApplySystemDefault={() => workspace.applyView(null)}
              savedViews={workspace.savedViews}
              defaultViewIds={workspace.defaultViewIds}
              onApplyView={(id) => workspace.applyView(workspace.savedViews.find((view: any) => view.id === id) || null)}
              onOverwriteView={workspace.overwriteSavedView}
              onDeleteView={workspace.deleteSavedView}
              describeView={(view: any) => view.config?.groupBy && view.config.groupBy !== 'raw'
                ? `Grouped by ${GROUP_OPTIONS.find((option) => option.value === view.config.groupBy)?.label || view.config.groupBy}`
                : `${view.config.viewMode} · ${view.config.activeTab} · ${view.config.activeLens}`}
            />
            <AssetBulkActionsPanel
              activeTab={workspace.activeTab}
              isOpen={showBulkMenu}
              panelRef={bulkMenuPanelRef}
              panelStyle={bulkMenuStyle}
              selectedCount={selectedCount}
              selectedLabels={selectedAssets.map((asset: any) => asset.name)}
              onClose={dismissWorkspaceMenus}
              onApply={(action, payload) => workspace.performBulkAction(action, undefined, payload)}
            />
            <OperationalAnchoredPanel
              isOpen={showExportMenu}
              panelKey="export-menu"
              style={exportMenuStyle}
              panelRef={exportMenuPanelRef}
              className="export-menu-container"
            >
              <WorkspaceFloatingPanel kind="context" className="p-3">
                <div className="space-y-2">
                  <div className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
                    <p className="text-[10px] font-semibold text-slate-400">Export assets</p>
                    <p className="pt-1 text-[12px] font-semibold text-slate-100">Download a CSV export, template, or registry snapshot.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { handleExportCSV(); dismissWorkspaceMenus() }}
                    disabled={!hasVisibleRows || isGridLoading}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-4 py-3 text-left transition-all hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-300">Export CSV</p>
                      <p className="pt-1 text-[11px] text-slate-500">
                        {hasVisibleRows ? 'Download the current asset import snapshot.' : 'Available once the active grid view has at least one row.'}
                      </p>
                    </div>
                    <FileText size={16} className="text-blue-400" />
                  </button>
                  <button type="button" onClick={() => { workspace.exportTemplate(); dismissWorkspaceMenus() }} className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-4 py-3 text-left transition-all hover:bg-white/[0.03]">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-300">Export Template</p>
                      <p className="pt-1 text-[11px] text-slate-500">Download the asset registry template with canonical columns.</p>
                    </div>
                    <Download size={16} className="text-emerald-400" />
                  </button>
                  <button
                    type="button"
                    onClick={() => { workspace.exportSnapshot(); dismissWorkspaceMenus() }}
                    disabled={!hasVisibleRows || isGridLoading}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-4 py-3 text-left transition-all hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-300">Snapshot</p>
                      <p className="pt-1 text-[11px] text-slate-500">
                        {hasVisibleRows ? 'Download the backend snapshot artifact for import/export recovery.' : 'Available once the active grid view has at least one row.'}
                      </p>
                    </div>
                    <FileText size={16} className="text-amber-400" />
                  </button>
                </div>
              </WorkspaceFloatingPanel>
            </OperationalAnchoredPanel>
            {workspace.rowActionMenu ? (
              <OperationalRowActionMenu
                meta={workspace.rowActionMenu.asset.system}
                title={workspace.rowActionMenu.asset.name}
                onClose={dismissWorkspaceMenus}
                sections={rowActionSections as any}
                cursorX={workspace.rowActionMenu.x}
                cursorY={workspace.rowActionMenu.y}
              />
            ) : null}
          </>
        )}
      >
        <AssetGoldenFeatureSurfaces
          gridRef={gridRef}
          allAssets={workspace.allAssets}
          columnDefs={columnDefs}
          contextMenu={assetContextMenu}
          dataState={workspace.dataState}
          fontSize={workspace.fontSize}
          getRowClass={getRowClass}
          getRowId={(params: any) => String(params.data.id)}
          groupBy={workspace.groupBy}
          groupOptions={GROUP_OPTIONS}
          collapsedGroups={collapsedGroups}
          onSetCollapsedGroups={setCollapsedGroups}
          onCancelGrouping={() => workspace.setGroupBy('raw')}
          onSelectReportAsset={(asset) => workspace.setReportAssetId(asset.id)}
          options={workspace.options}
          onEditAsset={workspace.setEditingAsset}
          onOpenDetails={openDetailAsset}
          onOpenQuickLook={workspace.setQuickLookAsset}
          onViewServiceDetails={workspace.setServiceDetails}
          onEditService={workspace.setServiceEdit}
          rowDensity={workspace.rowDensity}
          rows={workspace.visibleAssets}
          visibleAssets={workspace.visibleAssets}
          runtime={{ getAssetConsoleUrl: workspace.getAssetConsoleUrl }}
          rowInteractions={assetRowInteractions}
          selectionScopeKey={selectionScopeKey}
          viewMode={workspace.viewMode}
          connections={workspace.connections}
          relationships={workspace.relationships}
          reportAssetId={workspace.reportAssetId}
          reportFocusSection={workspace.reportFocusSection}
          onFocusSectionHandled={() => workspace.setReportFocusSection(null)}
          systemsList={workspace.systemsList}
          onSelectionChanged={handleSelectionChanged}
          isSelected={isSelected}
          gridContext={useMemo(() => ({ favoriteIds: workspace.favoriteIds, watchIds: workspace.watchIds }), [workspace.favoriteIds, workspace.watchIds])}
        />
      </AssetGoldenShellScaffold>

      <OperationalBulkPreviewModal
        isOpen={Boolean(workspace.bulkOperationPreview)}
        workspaceLabel="Assets"
        actionLabel={workspace.bulkOperationPreview?.actionLabel || 'Apply change'}
        fieldLabel={workspace.bulkOperationPreview?.fieldLabel}
        nextValue={workspace.bulkOperationPreview?.nextValue}
        preview={workspace.bulkOperationPreview?.preview || null}
        result={workspace.bulkOperationPreview?.result || null}
        isExecuting={workspace.bulkMutation.isPending}
        isReverting={workspace.isBulkReverting}
        onClose={() => workspace.setBulkOperationPreview(null)}
        onRevert={workspace.bulkOperationPreview?.onRevert ? workspace.runBulkReceiptRevert : undefined}
        onConfirm={() => {
          const operation = workspace.bulkOperationPreview
          if (!operation) return
          workspace.bulkMutation.mutate({
            action: operation.action,
            ids: operation.ids,
            payload: operation.payload,
          })
        }}
      />

      <AssetGoldenDialogs
        detailAsset={workspace.detailAsset}
        detailLink={workspace.detailLink}
        devices={workspace.devices}
        editingAsset={workspace.editingAsset}
        editingLink={workspace.editingLink}
        linkPurposeOptions={workspace.linkPurposeOptions}
        farmOptions={workspace.farmOptions}
        cableTypeOptions={workspace.cableTypeOptions}
        onCloseDetails={() => {
          workspace.setDetailAsset(null)
          workspace.setSearchParams((current: URLSearchParams) => {
            const next = new URLSearchParams(current)
            next.delete('id')
            return next
          })
        }}
        onCloseEdit={() => workspace.setEditingAsset(null)}
        onCloseLinkDetails={(link: any) => workspace.setDetailLink(link || null)}
        onCloseLinkEdit={(link: any) => workspace.setEditingLink(link || null)}
        onRefresh={workspace.refreshAll}
        options={workspace.options}
        quickLookAsset={workspace.quickLookAsset}
        setEditingAsset={workspace.setEditingAsset}
        setQuickLookAsset={workspace.setQuickLookAsset}
        setServiceDetails={workspace.setServiceDetails}
        setServiceEdit={workspace.setServiceEdit}
        showImportModal={workspace.showImportModal}
        showRegistryModal={workspace.showRegistryModal}
        serviceDetails={workspace.serviceDetails}
        serviceEdit={workspace.serviceEdit}
        setShowImportModal={workspace.setShowImportModal}
        setShowRegistryModal={workspace.setShowRegistryModal}
        confirmState={workspace.confirmState}
        setConfirmState={workspace.setConfirmState}
      />

      {showCompareOpen ? <AssetCompareModal items={compareItems} onClose={() => { setShowCompareOpen(false); setCompareIds([]) }} /> : null}
    </>
  )
}
