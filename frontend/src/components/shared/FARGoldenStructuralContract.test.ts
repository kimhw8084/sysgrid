import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { OPERATIONAL_GRID_WIDTHS } from './OperationalGridContract'
import { FAR_PRESERVES_EXPLICIT_COLUMN_WIDTHS, getStableFarManualResizeLayout } from '../FAR.gridStability'
import { filterFarModes, groupFarModes, normalizeFarQuickFilters } from '../FAR.workspaceModel'
import { FAR_WORKING_STATE_KEY, sanitizeFarWorkspaceViewConfig } from '../FAR.workspaceState'
import { getOperationalContentAwareWidth } from './OperationalGoldenColumns'
import { isFarRecentChange, sortFarModesByFavorite, toggleFarPreferenceId } from '../FAR.operatorIntelligence'

const componentsRoot = path.resolve(process.cwd(), 'src/components')
const read = (fileName: string) => fs.readFileSync(path.join(componentsRoot, fileName), 'utf8')

describe('FAR Monitoring-golden structural contract', () => {
  it('uses the shared golden select, ID, and row-action builders', () => {
    const far = read('FAR.tsx')
    const standard = read('shared/OperationalGridStandard.tsx')

    expect(far).toContain('...createOperationalUtilityColumns(operatorIntelligence.utilityColumnsConfig)')
    expect(read('FAR.operatorIntelligence.ts')).toContain('includeRecentChange: true')
    expect(read('FAR.operatorIntelligence.ts')).toContain('includeFavorite: true')
    expect(read('FAR.operatorIntelligence.ts')).toContain('includeWatch: true')
    expect(far).toContain('createOperationalActionColumnDefinition({')
    expect(far).toContain('width: OPERATIONAL_GRID_WIDTHS.standardAction')
    expect(far).toContain('renderOperationalActionButtons([')

    expect(far).not.toContain('width: 50,\n      checkboxSelection: true')
    expect(far).not.toContain('headerName: "Action",\n      width: 100')

    expect(standard).toContain("colId: 'select'")
    expect(standard).toContain("colId: 'id'")
    expect(standard).toContain("colId: 'row_actions'")
    expect(standard).toContain("pinned: 'left'")
    expect(standard).toContain('operationalLockWidth: true')

    expect(OPERATIONAL_GRID_WIDTHS.utilityCheckbox).toBe(64)
    expect(OPERATIONAL_GRID_WIDTHS.id).toBe(90)
    expect(OPERATIONAL_GRID_WIDTHS.standardAction).toBe(208)
  })

  it('uses stable content-aware defaults and shared golden renderers without limiting operator resize', () => {
    const far = read('FAR.tsx')
    const gridColumns = read('FAR.gridColumns.tsx')
    const gridContract = read('shared/OperationalGridContract.ts')
    const helper = read('shared/OperationalGoldenColumns.tsx')
    const state = read('FAR.workspaceState.ts')

    expect(getOperationalContentAwareWidth({
      headerName: 'Failure Mode',
      values: ['Short', 'A meaningfully longer failure mode label'],
      minWidth: 200,
      fallbackWidth: 260,
      maxDefaultWidth: 360,
    })).toBeGreaterThanOrEqual(260)
    expect(getOperationalContentAwareWidth({
      headerName: 'Failure Mode',
      values: ['x'.repeat(200)],
      minWidth: 200,
      fallbackWidth: 260,
      maxDefaultWidth: 360,
    })).toBe(360)

    for (const field of ['system_name', 'failure_type', 'title', 'created_by_user_id']) {
      expect(far).toContain(`field: '${field}'`)
    }
    expect(far).toContain('width: farDefaultWidths.system_name')
    expect(far).toContain('width: farDefaultWidths.failure_type')
    expect(far).toContain('width: farDefaultWidths.title')
    expect(far).toContain('width: farDefaultWidths.created_by_user_id')
    expect(far).toContain("headerName: 'Failure Mode', values: loadedModes.map((mode: any) => mode.title), minWidth: 200, fallbackWidth: 260, maxDefaultWidth: 360")

    expect((far.match(/createOperationalMetricBadgeColumn\(\{/g) || []).length).toBe(4)
    expect(far).toContain("resolveTone: (value) => value >= 8 ? 'critical' : value >= 5 ? 'warning' : 'healthy'")
    expect(far).toContain("resolveTone: (value) => value >= 150 ? 'critical' : value >= 80 ? 'warning' : 'healthy'")
    expect(helper).toContain('operationalSkipAutoSize: true')
    expect(helper).toContain('resizable: true')
    expect(helper).not.toContain('maxWidth: maxDefaultWidth')

    expect(gridColumns).toContain("field: 'status'")
    expect(gridColumns).toContain('OPERATIONAL_GRID_BADGE_CLASS')
    expect(gridColumns).toContain('OPERATIONAL_GRID_BADGE_TEXT_CLASS')
    expect(gridContract).toContain("export const OPERATIONAL_GRID_BADGE_CLASS = 'operational-grid-badge'")
    expect(gridContract).toContain("export const OPERATIONAL_GRID_BADGE_TEXT_CLASS = 'operational-grid-badge-text'")
    expect(gridColumns).toContain("headerName: 'Vectors'")
    expect(gridColumns).toContain("headerName: 'Incidents'")
    expect(state).toContain("'vectors'")
  })

  it('recovers before FAR loses the golden analytical center viewport', () => {
    const controls = read('FARGoldenWorkspaceControls.tsx')

    expect(controls).toContain('const FAR_MIN_DESKTOP_CENTER_VIEWPORT_WIDTH = 600')
    expect(controls).toContain('centerViewportWidth < FAR_MIN_DESKTOP_CENTER_VIEWPORT_WIDTH')
    expect(controls).toContain('requestedPinnedWidth > Math.max(0, window.innerWidth - FAR_MIN_DESKTOP_CENTER_VIEWPORT_WIDTH)')
    expect(controls).toContain("api.ensureColumnVisible?.('title', 'middle')")
  })


  it('keeps FAR sizing stable on load and persists only completed manual resize state', () => {
    const controls = read('FARGoldenWorkspaceControls.tsx')
    const state = [
      { colId: 'system_name', width: 164, hide: false, pinned: null, sort: null, sortIndex: null, flex: null },
      { colId: 'title', width: 312, hide: false, pinned: null, sort: null, sortIndex: null, flex: null },
    ]
    const api = { getColumnState: () => state }

    expect(FAR_PRESERVES_EXPLICIT_COLUMN_WIDTHS).toBe(true)
    expect(getStableFarManualResizeLayout({ finished: false, source: 'uiColumnResized', api })).toBeNull()
    for (const source of ['autosizeColumns', 'sizeColumnsToFit', 'api', 'flex']) {
      expect(getStableFarManualResizeLayout({ finished: true, source, api })).toBeNull()
    }
    expect(getStableFarManualResizeLayout({ finished: true, source: 'uiColumnResized', api })).toEqual([
      { colId: 'system_name', hide: false, pinned: null, sort: null, sortIndex: null, width: 164, flex: null },
      { colId: 'title', hide: false, pinned: null, sort: null, sortIndex: null, width: 312, flex: null },
    ])

    expect(controls).toContain('preserveExplicitColumnWidths: FAR_PRESERVES_EXPLICIT_COLUMN_WIDTHS')
    expect(controls).toContain('handleColumnResized: handleStableColumnResized')
    expect(controls).not.toContain('api.sizeColumnsToFit?.()')
    expect(controls).not.toContain('handleColumnResized,\n  } = useOperationalGridLayout')
  })


  it('persists the sanitized unsaved FAR working definition including manual widths', () => {
    const controls = read('FARGoldenWorkspaceControls.tsx')
    const far = read('FAR.tsx')
    const config = sanitizeFarWorkspaceViewConfig({
      groupBy: 'system_name',
      quickFilter: 'database',
      columnLayoutState: [
        { colId: 'title', width: 333, hide: false, pinned: null, sort: null, sortIndex: null, flex: null },
      ],
    })

    expect(FAR_WORKING_STATE_KEY).toBe('sysgrid_far_working_state_v1')
    expect(config.columnLayoutState.find((column: any) => column.colId === 'title')?.width).toBe(333)
    expect(controls).toContain('usePersistentJsonState<FarWorkspaceViewConfig>(FAR_WORKING_STATE_KEY, DEFAULT_FAR_VIEW_CONFIG)')
    expect(controls).toContain("applyViewConfig(selection.definition, selection.source)")
    expect(controls).toContain('setWorkingDefinition(durableCurrentDefinition)')
    expect(controls).toContain('collaborativeStatus: collaborativeViews.status')
    expect(controls).toContain('userSettingsReady')
    expect(controls).toContain('collaborativeViews.setViewLink(null)')
    expect(controls).toContain('workingStateReady')
    expect(far).toContain('loading={modesLoading || !goldenWorkspace.workingStateReady}')
  })

  it('persists FAR grouping, filter-bar state, and multidimensional quick filters safely', () => {
    const config = sanitizeFarWorkspaceViewConfig({
      groupBy: 'risk_band',
      showFilterBar: false,
      quickFilter: 'database',
      quickFilters: {
        system_name: ['Payments'],
        failure_type: ['Software'],
        status: ['Existing'],
        risk_band: ['critical'],
      },
    })

    expect(config.groupBy).toBe('risk_band')
    expect(config.showFilterBar).toBe(false)
    expect(config.quickFilter).toBe('database')
    expect(config.quickFilters).toEqual({
      system_name: ['Payments'],
      failure_type: ['Software'],
      status: ['Existing'],
      risk_band: ['critical'],
    })
    expect(sanitizeFarWorkspaceViewConfig({ groupBy: 'invalid' }).groupBy).toBe('raw')
    expect(normalizeFarQuickFilters({ system_name: ['A', 'A', ''], risk_band: ['critical'] })).toEqual({
      system_name: ['A'],
      failure_type: [],
      status: [],
      risk_band: ['critical'],
    })
  })

  it('filters full FAR semantics and groups domain rows deterministically', () => {
    const modes = [
      {
        id: 1,
        system_name: 'Payments',
        failure_type: 'Software',
        title: 'Checkout timeout',
        effect: 'Customer checkout fails',
        status: 'Existing',
        rpn: 180,
        causes: [{ description: 'database lock escalation' }],
        mitigations: [],
        prevention_actions: [],
        linked_rcas: [],
      },
      {
        id: 2,
        system_name: 'Search',
        failure_type: 'Network',
        title: 'Edge packet loss',
        effect: 'Search latency',
        status: 'Planned',
        rpn: 90,
        causes: [],
        mitigations: [],
        prevention_actions: [],
        linked_rcas: [],
      },
    ]

    const critical = filterFarModes(modes, 'database lock', {
      system_name: ['Payments'],
      failure_type: ['Software'],
      status: ['Existing'],
      risk_band: ['critical'],
    })
    expect(critical.map((mode) => mode.id)).toEqual([1])
    expect(groupFarModes(modes, 'risk_band').map((group) => group.label)).toEqual([
      'Critical · RPN ≥ 150',
      'Elevated · RPN 80–149',
    ])
  })

  it('wires FAR to the shared grouped-grid and selection-scope contract', () => {
    const far = read('FAR.tsx')
    const controls = read('FARGoldenWorkspaceControls.tsx')
    const interaction = read('FARGoldenWorkspaceInteraction.tsx')

    expect(interaction).toContain('OperationalGroupedGridView')
    expect(interaction).toContain('OperationalGroupedGridSection')
    expect(interaction).toContain('useOperationalGroupedSelection')
    expect(interaction).toContain('selectionScopeKey={selectionScopeKey}')
    expect(far).toContain('filterChips={goldenWorkspace.filterChips}')
    expect(far).toContain('<FARFilterBar')
    expect(far).toContain('<FAROperationalGridView')
    expect(controls).toContain('groupOptions={FAR_GROUP_OPTIONS}')
    expect(controls).toContain('showFilterBar')
    expect(controls).toContain('quickFilters')
  })

  it('adds Monitoring-golden operator intelligence without changing FAR semantics', () => {
    const far = read('FAR.tsx')
    const interaction = read('FARGoldenWorkspaceInteraction.tsx')

    expect(toggleFarPreferenceId([2], 1)).toEqual([2, 1])
    expect(toggleFarPreferenceId([2, 1], 2)).toEqual([1])
    expect(sortFarModesByFavorite([{ id: 1 }, { id: 2 }, { id: 3 }], [2]).map((row) => row.id)).toEqual([2, 1, 3])
    const visitedAt = Date.parse('2026-08-14T01:00:00Z')
    expect(isFarRecentChange({ updated_at: '2026-08-14T02:00:00Z' }, visitedAt)).toBe(true)
    expect(isFarRecentChange({ updated_at: '2026-08-14T00:30:00Z' }, visitedAt)).toBe(false)

    expect(far).toContain('operatorIntelligence.beginPending(ids)')
    expect(far).toContain('operatorIntelligence.endPending(ids)')
    expect(far).toContain('operatorIntelligence.isIntelligenceExpanded')
    expect(far).toContain('<Activity size={14} /> Signals')
    expect(far).toContain('rowInteractions={operatorIntelligence.rowInteractions}')
    expect(far).toContain('gridContext={operatorIntelligence.gridContext}')
    expect(far).toContain('getRowClass={operatorIntelligence.getRowClass}')
    expect(interaction).toContain('rowInteractions={rowInteractions}')
    expect(interaction).toContain('context={gridContext}')
    expect(interaction).toContain('getRowClass={getRowClass}')
  })

  it('keeps FAR analytical semantics intact while adopting the shared frame', () => {
    const far = read('FAR.tsx')
    const gridColumns = read('FAR.gridColumns.tsx')

    for (const token of ['severity', 'occurrence', 'detection', 'rpn', 'Failure Mode', 'Vectors', 'Incidents']) {
      expect(`${far}\n${gridColumns}`).toContain(token)
    }
    expect(far).toContain('setShowRpnHelp(true)')
    expect(far).toContain('setShowMaturityHelp(true)')
  })
})
