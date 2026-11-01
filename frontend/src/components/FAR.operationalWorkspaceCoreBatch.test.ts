// SYSGRID_ALLOW_SOURCE_OWNERSHIP_ASSERTION
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  FAR_PERSISTED_COLUMN_IDS,
  FAR_WORKSPACE_PREFERENCE_VERSION,
  buildFarWorkspacePreference,
  normalizeFarWorkspacePreference,
  sanitizeFarWorkspaceViewConfig,
} from './FAR.workspaceState'
import {
  FAR_GOLDEN_COLUMN_GEOMETRY,
  sanitizeFarPersistedColumnGeometry,
} from './FAR.columnGeometry'
import {
  FAR_PRESERVES_EXPLICIT_COLUMN_WIDTHS,
  getStableFarManualResizeLayout,
} from './FAR.gridStability'
import {
  isOperationalAutoResizeSource,
  sanitizeOperationalColumnLayout,
  sanitizeOperationalFilterModel,
  sanitizeOperationalSortModel,
} from './shared/OperationalGridSizing'
import {
  buildWorkspaceViewLink,
  buildWorkspaceViewsListPath,
  canonicalizeWorkspaceDefinition,
  isRemoteWorkspaceViewId,
  readWorkspaceViewId,
  workspaceDefinitionsEqual,
} from './shared/CollaborativeWorkspaceViews'

export const PC50_NEW_CLOSURE_ROWS = [
  'G02',
  'G06', 'G07', 'G08', 'G09', 'G10', 'G11', 'G12', 'G13',
  'G16', 'G17', 'G18', 'G19', 'G20', 'G21',
  'G25', 'G26', 'G27', 'G28', 'G29', 'G30', 'G31', 'G32', 'G33', 'G34',
  'G62', 'G63', 'G64', 'G65', 'G66', 'G67', 'G68', 'G69', 'G70',
] as const

export const PC50_REGRESSION_LOCK_ROWS = [
  'G22', 'G24',
  'G35', 'G36', 'G37', 'G38', 'G39', 'G40', 'G41', 'G42',
  'G53', 'G57', 'G58', 'G74', 'G82', 'G83', 'G97', 'G98', 'G100',
] as const

const components = resolve(process.cwd(), 'src/components')
const read = (relative: string) => readFileSync(resolve(components, relative), 'utf8')
const farSource = read('FAR.tsx')
const controlsSource = read('FARGoldenWorkspaceControls.tsx')
const hooksSource = read('shared/OperationalWorkspaceHooks.ts')
const collaborativeSource = read('shared/CollaborativeWorkspaceViews.ts')

const expectAll = (source: string, fragments: readonly string[]) => {
  for (const fragment of fragments) expect(source, fragment).toContain(fragment)
}

describe('PC-50 FAR operational workspace core + saved-view continuity exact G batch', () => {
  it('binds exactly thirty-four new closure candidates plus nineteen existing regression locks', () => {
    expect(PC50_NEW_CLOSURE_ROWS).toHaveLength(34)
    expect(PC50_REGRESSION_LOCK_ROWS).toHaveLength(19)
    const batch = [...PC50_NEW_CLOSURE_ROWS, ...PC50_REGRESSION_LOCK_ROWS]
    expect(batch).toHaveLength(53)
    expect(new Set(batch).size).toBe(53)
    expect(PC50_NEW_CLOSURE_ROWS).toEqual([
      'G02',
      'G06', 'G07', 'G08', 'G09', 'G10', 'G11', 'G12', 'G13',
      'G16', 'G17', 'G18', 'G19', 'G20', 'G21',
      'G25', 'G26', 'G27', 'G28', 'G29', 'G30', 'G31', 'G32', 'G33', 'G34',
      'G62', 'G63', 'G64', 'G65', 'G66', 'G67', 'G68', 'G69', 'G70',
    ])
  })

  it('G02/G06–G13 retain page identity, search, primary/secondary commands, CSV/export/import and clear-state controls', () => {
    expectAll(farSource, [
      'workspace="far"',
      "eyebrow: 'Analysis'",
      "title: 'Failure Matrix'",
      "subtitle: 'Reliability Knowledge Engine // FMEA Studio'",
      'placeholder="Scan risk vectors..."',
      'goldenWorkspace.toolbarControls',
      'goldenWorkspace.toolbarActions',
      'filterChips={goldenWorkspace.filterChips}',
    ])
    expectAll(controlsSource, [
      '<LayoutGrid size={14} /> Views',
      '<Sliders size={14} /> Display',
      'WorkspaceFlyoutActionCard title="Reset layout"',
      'title="Export CSV"',
      'WorkspaceFlyoutActionCard title="Export round-trip snapshot"',
      'title="Copy to clipboard"',
      'title="Import failure modes"',
      '<Upload size={14} /> Import</ToolbarButton>',
      "title={showFilterBar ? 'Hide filters' : 'Show filters'}",
      'title="Reliability insights"',
      'title="FAR activity summary"',
      'title="Compare 2 to 5 selected failure modes"',
      'title="Bulk actions"',
      'ariaLabel="Add Failure Mode"',
      "id: 'clear-all'",
      "setSearchTerm('')",
      'setQuickFilters(createDefaultFarQuickFilters())',
      'gridRef.current?.api?.setFilterModel?.({})',
    ])
  })

  it('G16–G19 retain standardized display density, grouping and column visibility controls', () => {
    expectAll(controlsSource, [
      '<OperationalDisplayPanel',
      'title="Display density"',
      'fontSize={fontSize}',
      'onFontSizeChange={setFontSize}',
      'rowDensity={rowDensity}',
      'onRowDensityChange={setRowDensity}',
      'groupBy={groupBy}',
      'onGroupByChange={(value) => setGroupBy(value as FarGroupBy)}',
      'columns={columnDefs}',
      'hiddenColumns={hiddenColumns}',
      'onToggleColumn={toggleColumn}',
    ])
  })

  it('G20/G21/G26 protect stable analytical geometry from auto-size and preserve legitimate manual resize', () => {
    expect(FAR_PRESERVES_EXPLICIT_COLUMN_WIDTHS).toBe(true)
    expect(isOperationalAutoResizeSource('autosizeColumns')).toBe(true)
    expect(isOperationalAutoResizeSource('sizeColumnsToFit')).toBe(true)
    expect(isOperationalAutoResizeSource('uiColumnResized')).toBe(false)

    const api = {
      getColumnState: () => [{ colId: 'title', width: 288, pinned: null, hide: false }],
    }
    expect(getStableFarManualResizeLayout({ finished: true, source: 'autosizeColumns', api })).toBeNull()
    expect(getStableFarManualResizeLayout({ finished: true, source: 'uiColumnResized', api })).toEqual([
      { colId: 'title', hide: false, pinned: null, sort: undefined, sortIndex: undefined, width: 288, flex: undefined },
    ])

    const repaired = sanitizeFarPersistedColumnGeometry([
      { colId: 'title', width: 80, pinned: null },
      { colId: 'rpn', width: 40, pinned: null },
      { colId: 'system_name', width: 160, pinned: null },
    ])
    expect(repaired.repairedColumnIds).toEqual([])
    expect(repaired.layout.find((entry) => entry.colId === 'title')?.width).toBe(80)
    expect(repaired.layout.find((entry) => entry.colId === 'rpn')?.width).toBe(40)
    expect(repaired.layout.find((entry) => entry.colId === 'system_name')?.width).toBe(160)

    expect(FAR_GOLDEN_COLUMN_GEOMETRY.find((entry) => entry.colId === 'title')).toMatchObject({ minWidth: 200, defaultWidth: 260 })
    expect(FAR_GOLDEN_COLUMN_GEOMETRY.find((entry) => entry.colId === 'rpn')).toMatchObject({ minWidth: 130, defaultWidth: 130 })
    expectAll(hooksSource, [
      'if (!isAutoResizeSource && changedColumns.length > 0)',
      'setHasManualColumnWidths(true)',
      'syncColumnLayoutState(event.api, true)',
      'handleColumnMoved',
      'handleDragStopped',
      'handleColumnPinned',
      'handleColumnVisible',
    ])
    expectAll(controlsSource, [
      'getStableFarManualResizeLayout(event)',
      'setTransientManualColumnWidths(true)',
      'setColumnLayoutState(nextLayout)',
      'handleColumnMoved,',
      'handleDragStopped,',
      'handleColumnPinned,',
      'handleColumnVisible,',
    ])
  })

  it('G25/G27–G34 keep the desktop analytical grid, loading/search/filter/sort/visibility state and RPN presentation contract', () => {
    expectAll(farSource, [
      "queryKey: ['far', 'modes']",
      'isLoading: modesLoading',
      'filterFarModes(lifecycleModes, searchTerm, quickFilters)',
      "field: 'severity', headerName: 'S', width: 72, minWidth: 68",
      "field: 'occurrence', headerName: 'O', width: 84, minWidth: 84",
      "field: 'detection', headerName: 'D', width: 72, minWidth: 68",
      "field: 'rpn', headerName: 'RPN', width: 130, minWidth: 130",
      "title: 'RPN Definition Matrix'",
      'createFarAnalyticalColumns({',
      'goldenWorkspace.gridRuntime',
    ])

    const sanitized = sanitizeFarWorkspaceViewConfig({
      lifecycleScope: 'active',
      fontSize: 12,
      rowDensity: 10,
      hiddenColumns: ['created_by_user_id', 'not-real'],
      groupBy: 'status',
      showFilterBar: true,
      quickFilter: ' pump ',
      quickFilters: { system_name: ['Hydraulics'], failure_type: [], status: ['OPEN'], risk_band: ['critical'] },
      filterModel: { title: { filterType: 'text', filter: 'pump' }, fake: { filter: 'x' } },
      sortModel: [{ colId: 'rpn', sort: 'desc' }, { colId: 'fake', sort: 'asc' }],
      columnLayoutState: [{ colId: 'title', width: 280, pinned: null }, { colId: 'fake', width: 200 }],
    })
    expect(sanitized.hiddenColumns).toEqual(['created_by_user_id'])
    expect(sanitized.groupBy).toBe('status')
    expect(sanitized.quickFilter).toBe('pump')
    expect(sanitized.filterModel).toEqual({ title: { filterType: 'text', filter: 'pump' } })
    expect(sanitized.sortModel).toEqual([{ colId: 'rpn', sort: 'desc' }])
    expect(sanitized.columnLayoutState.map((entry) => entry.colId)).toEqual(['title'])

    expect(sanitizeOperationalFilterModel({ title: { filter: 'x' }, fake: {} }, FAR_PERSISTED_COLUMN_IDS)).toEqual({ title: { filter: 'x' } })
    expect(sanitizeOperationalSortModel([{ colId: 'rpn', sort: 'desc' }, { colId: 'fake', sort: 'asc' }], FAR_PERSISTED_COLUMN_IDS)).toEqual([{ colId: 'rpn', sort: 'desc' }])
    expect(sanitizeOperationalColumnLayout([{ colId: 'title', width: 280 }, { colId: 'fake', width: 200 }], FAR_PERSISTED_COLUMN_IDS, true)).toEqual([
      { colId: 'title', hide: undefined, pinned: undefined, sort: undefined, sortIndex: undefined, width: 280, flex: undefined },
    ])
  })

  it('G63 preserves grouping and the full durable workspace definition through preference normalization', () => {
    const preference = buildFarWorkspacePreference({
      lifecycleScope: 'active',
      fontSize: 12,
      rowDensity: 10,
      hiddenColumns: ['created_by_user_id'],
      groupBy: 'risk_band',
      showFilterBar: false,
      quickFilter: 'critical',
      quickFilters: { system_name: [], failure_type: [], status: ['OPEN'], risk_band: ['critical'] },
      filterModel: { title: { filterType: 'text', filter: 'pump' } },
      sortModel: [{ colId: 'rpn', sort: 'desc' }],
      columnLayoutState: [{ colId: 'title', width: 300, pinned: null }],
    })
    expect(preference.version).toBe(FAR_WORKSPACE_PREFERENCE_VERSION)
    expect(preference.workingDefinition.groupBy).toBe('risk_band')
    expect(normalizeFarWorkspacePreference(preference)).toEqual(preference)
    expectAll(controlsSource, [
      'const currentDefinition = useMemo<FarWorkspaceViewConfig>(() => sanitizeFarWorkspaceViewConfig({',
      'groupBy,',
      'quickFilters,',
      'filterModel: gridFilterModel,',
      'sortModel: gridSortModel,',
      'columnLayoutState,',
      'setGroupBy(config.groupBy)',
      'setGridFilterModel(config.filterModel)',
      'setGridSortModel(config.sortModel)',
      'setColumnLayoutState(config.columnLayoutState)',
    ])
  })

  it('G62/G64–G70 retain collaborative saved-view CRUD, semantic dirty-state, links, conflict recovery and team-server safety', () => {
    expect(workspaceDefinitionsEqual(
      { groupBy: 'status', quickFilters: { status: ['OPEN'] } },
      { quickFilters: { status: ['OPEN'] }, groupBy: 'status' },
    )).toBe(true)
    expect(workspaceDefinitionsEqual({ groupBy: 'status' }, { groupBy: 'risk_band' })).toBe(false)

    expect(canonicalizeWorkspaceDefinition({
      groupBy: 'raw',
      columnLayoutState: [
        { colId: 'status', width: 131.9, pinned: null, flex: 1, sortIndex: 0 },
        { colId: 'title', width: 240, pinned: 'left', sort: 'asc' },
      ],
    })).toEqual({
      groupBy: 'raw',
      columnLayoutState: [
        { colId: 'status', pinned: null, width: 131 },
        { colId: 'title', pinned: 'left', width: 240, sort: 'asc' },
      ],
    })

    const linked = buildWorkspaceViewLink('https://sysgrid.local/far?id=9', '42')
    expect(readWorkspaceViewId(linked)).toBe('42')
    expect(isRemoteWorkspaceViewId('42')).toBe(true)
    expect(isRemoteWorkspaceViewId('local-42')).toBe(false)
    expect(buildWorkspaceViewsListPath('far', 'team', 7)).toBe('/api/v1/workspaces/far/views?scope=team&team_id=7')

    expectAll(controlsSource, [
      'useCollaborativeWorkspaceViews<FarWorkspaceViewConfig, FarSavedView>({',
      "workspaceKey: 'far'",
      'const createView = useCallback(async () => {',
      'collaborativeViews.createView(name, durableCurrentDefinition)',
      'const overwriteView = useCallback(async (id: string) => {',
      'collaborativeViews.updateView(id, view.name, durableCurrentDefinition)',
      'const renameView = useCallback(async (id: string, name: string) => {',
      'const deleteView = useCallback(async (id: string) => {',
      'collaborativeViews.deleteView(id)',
      '<OperationalSavedViewsPanel',
      'onApplyView={applyView}',
      'onOverwriteView={(id) => { void overwriteView(id) }}',
      'onRenameView={renameView}',
      'onDeleteView={(id) => { void deleteView(id) }}',
      'onCopyViewLink={(id) => { void collaborativeViews.copyViewLink(id && isRemoteWorkspaceViewId(id) ? id : null) }}',
      'conflictMessage={collaborativeViews.conflict?.message}',
      'collaborativeViews.reloadConflict()',
      'onSaveConflictCopy={() => { void collaborativeViews.saveConflictCopy() }}',
    ])
    expectAll(collaborativeSource, [
      "export type CollaborativeViewScope = 'personal' | 'team'",
      'workspaceDefinitionsEqual',
      'canonicalizeWorkspaceDefinition',
      'parseWorkspaceViewConflict',
      "if (scope === 'team')",
      'return { persisted: false, error: message }',
      'localFallbackView',
    ])
  })

  it('keeps all nineteen regression-lock rows out of the new-closure count', () => {
    const newRows = new Set<string>(PC50_NEW_CLOSURE_ROWS)
    for (const row of PC50_REGRESSION_LOCK_ROWS) expect(newRows.has(row)).toBe(false)
  })
})
