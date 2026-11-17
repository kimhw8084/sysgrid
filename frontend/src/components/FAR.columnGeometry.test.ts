// SYSGRID_ALLOW_SOURCE_OWNERSHIP_ASSERTION
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  FAR_GOLDEN_COLUMN_GEOMETRY_FINGERPRINT,
  buildFarGoldenGeometryResetState,
  sanitizeFarPersistedColumnGeometry,
} from './FAR.columnGeometry'
import { sanitizeFarWorkspaceViewConfig } from './FAR.workspaceState'

describe('FAR golden column geometry', () => {
  it('locks the machine-verifiable analytical geometry fingerprint', () => {
    expect(FAR_GOLDEN_COLUMN_GEOMETRY_FINGERPRINT).toEqual([
      { colId: 'id', headerName: 'ID', defaultWidth: 90, minWidth: 72, maxWidth: 140, dynamicDefault: false },
      { colId: 'system_name', headerName: 'System', defaultWidth: 120, minWidth: 120, maxWidth: 220, dynamicDefault: true },
      { colId: 'failure_type', headerName: 'Type', defaultWidth: 108, minWidth: 96, maxWidth: 160, dynamicDefault: true },
      { colId: 'title', headerName: 'Failure Mode', defaultWidth: 220, minWidth: 200, maxWidth: 360, dynamicDefault: true },
      { colId: 'severity', headerName: 'S', defaultWidth: 72, minWidth: 68, maxWidth: 100, dynamicDefault: false },
      { colId: 'occurrence', headerName: 'O', defaultWidth: 84, minWidth: 84, maxWidth: 110, dynamicDefault: false },
      { colId: 'detection', headerName: 'D', defaultWidth: 72, minWidth: 68, maxWidth: 100, dynamicDefault: false },
      { colId: 'rpn', headerName: 'RPN', defaultWidth: 130, minWidth: 130, maxWidth: 180, dynamicDefault: false },
      { colId: 'status', headerName: 'Maturity', defaultWidth: 164, minWidth: 152, maxWidth: 220, dynamicDefault: false },
      { colId: 'vectors', headerName: 'Vectors', defaultWidth: 160, minWidth: 140, maxWidth: 220, dynamicDefault: false },
      { colId: 'linked_rcas', headerName: 'Incidents', defaultWidth: 120, minWidth: 112, maxWidth: 200, dynamicDefault: false },
      { colId: 'created_by_user_id', headerName: 'Created By', defaultWidth: 136, minWidth: 128, maxWidth: 220, dynamicDefault: true },
    ])
  })

  it('preserves legitimate manual widths and repairs narrow or pathological persisted widths', () => {
    const result = sanitizeFarPersistedColumnGeometry([
      { colId: 'title', width: 48, flex: 1 },
      { colId: 'status', width: 164 },
      { colId: 'vectors', width: 196 },
      { colId: 'id', width: 44 },
      { colId: 'system_name', width: 2000 },
    ])
    expect(result.repairedColumnIds).toEqual(['system_name'])
    expect(result.layout).toEqual([
      { colId: 'title', width: 48, flex: 1 },
      { colId: 'status', width: 164 },
      { colId: 'vectors', width: 196 },
      { colId: 'id', width: 44 },
      { colId: 'system_name', width: 120 },
    ])
  })

  it('applies width repair while retaining unrelated FAR workspace state', () => {
    const config = sanitizeFarWorkspaceViewConfig({
      lifecycleScope: 'archived',
      quickFilter: 'pump',
      groupBy: 'system_name',
      hiddenColumns: ['linked_rcas'],
      columnLayoutState: [
        { colId: 'title', width: 20 },
        { colId: 'system_name', width: 2000 },
        { colId: 'vectors', width: 180 },
      ],
    })
    expect(config.lifecycleScope).toBe('archived')
    expect(config.quickFilter).toBe('pump')
    expect(config.groupBy).toBe('system_name')
    expect(config.hiddenColumns).toEqual(['linked_rcas'])
    expect(config.columnLayoutState).toHaveLength(3)
    expect(config.columnLayoutState[0]).toMatchObject({ colId: 'title', width: 220, pinned: 'left' })
    expect(config.columnLayoutState[1]).toMatchObject({ colId: 'system_name', width: 120 })
    expect(config.columnLayoutState[1].pinned).not.toBe('left')
    expect(config.columnLayoutState[2]).toMatchObject({ colId: 'vectors', width: 180 })
  })

  it('builds a canonical geometry reset without encoding filters, search, lifecycle, or saved-view identity', () => {
    expect(buildFarGoldenGeometryResetState([
      { field: 'title', width: 312, pinned: null },
      { field: 'rpn', width: 130 },
      { colId: 'row_actions', width: 112, pinned: 'right' },
    ])).toEqual([
      { colId: 'title', hide: false, pinned: 'left', width: 312 },
      { colId: 'rpn', hide: false, pinned: null, width: 130 },
      { colId: 'row_actions' },
    ])

    const source = readFileSync('src/components/FARGoldenWorkspaceControls.tsx', 'utf8')
    const start = source.indexOf('const resetFarLayoutToGolden')
    const end = source.indexOf('const gridRuntime', start)
    const resetSource = source.slice(start, end)
    expect(resetSource).toContain("FAR layout reset to current golden geometry")
    expect(resetSource).not.toContain('setSearchTerm(')
    expect(resetSource).not.toContain('setQuickFilters(')
    expect(resetSource).not.toContain('setGroupBy(')
    expect(resetSource).not.toContain('setActiveViewId(')
    expect(source).toContain('WorkspaceFlyoutActionCard title="Reset layout"')
  })
})
