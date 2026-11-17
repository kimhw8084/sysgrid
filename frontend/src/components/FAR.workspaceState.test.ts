import { describe, expect, it } from 'vitest'
import {
  FAR_PERSISTED_COLUMN_IDS,
  FAR_WORKSPACE_PREFERENCE_ENDPOINT,
  FAR_WORKSPACE_PREFERENCE_KEY,
  FAR_WORKSPACE_PREFERENCE_VERSION,
  buildFarWorkspacePreference,
  buildFarWorkspacePreferencePatch,
  normalizeFarSavedViews,
  normalizeFarWorkspacePreference,
  sanitizeFarWorkspaceViewConfig,
} from './FAR.workspaceState'

describe('FAR golden workspace view state', () => {
  it('sanitizes lifecycle scope with active as the backward-compatible legacy default', () => {
    expect(sanitizeFarWorkspaceViewConfig({ lifecycleScope: 'archived' }).lifecycleScope).toBe('archived')
    expect(sanitizeFarWorkspaceViewConfig({ lifecycleScope: 'active' }).lifecycleScope).toBe('active')
    expect(sanitizeFarWorkspaceViewConfig({ lifecycleScope: 'ARCHIVED' }).lifecycleScope).toBe('active')
    expect(sanitizeFarWorkspaceViewConfig({}).lifecycleScope).toBe('active')
  })

  it('preserves golden display, filter, sort, and system-filter state while rejecting unknown columns', () => {
    const result = sanitizeFarWorkspaceViewConfig({
      lifecycleScope: 'archived',
      fontSize: 99,
      rowDensity: -5,
      hiddenColumns: ['rpn', 'unknown', 'rpn'],
      quickFilter: '  thermal risk  ',
      quickFilters: { system_name: ['Core', 'Core', '', 4] },
      filterModel: {
        status: { filterType: 'text', filter: 'Analyzing' },
        not_a_column: { filterType: 'text', filter: 'drop' },
      },
      sortModel: [
        { colId: 'rpn', sort: 'desc' },
        { colId: 'missing', sort: 'asc' },
      ],
      columnLayoutState: [
        { colId: 'title', width: 320, pinned: 'left' },
        { colId: 'missing', width: 900 },
      ],
    })

    expect(result.lifecycleScope).toBe('archived')
    expect(result.fontSize).toBe(14)
    expect(result.rowDensity).toBe(0)
    expect(result.hiddenColumns).toEqual(['rpn'])
    expect(result.quickFilter).toBe('thermal risk')
    expect(result.quickFilters).toEqual({
      system_name: ['Core'],
      failure_type: [],
      status: [],
      risk_band: [],
    })
    expect(Object.keys(result.filterModel)).toEqual(['status'])
    expect(result.sortModel).toEqual([{ colId: 'rpn', sort: 'desc' }])
    expect(result.columnLayoutState).toEqual([
      expect.objectContaining({ colId: 'title', width: 320, pinned: 'left' }),
    ])
    expect(FAR_PERSISTED_COLUMN_IDS.has('linked_rcas')).toBe(true)
  })

  it('keeps primary FAR identity columns frozen while leaving type data scrollable', () => {
    const result = sanitizeFarWorkspaceViewConfig({
      columnLayoutState: [
        { colId: 'id', width: 90, pinned: null },
        { colId: 'system_name', width: 148, pinned: null },
        { colId: 'failure_type', width: 112, pinned: null },
        { colId: 'title', width: 260, pinned: null },
        { colId: 'rpn', width: 130, pinned: null },
      ],
    })

    expect(result.columnLayoutState.map(({ colId, pinned }: any) => [colId, pinned])).toEqual([
      ['id', 'left'],
      ['system_name', null],
      ['failure_type', null],
      ['title', 'left'],
      ['rpn', null],
    ])
  })

  it('round-trips only the current versioned backend working-state preference', () => {
    const preference = buildFarWorkspacePreference({
      fontSize: 12,
      groupBy: 'risk_band',
      hiddenColumns: ['status', 'unknown'],
      quickFilter: '  power loss  ',
    })

    expect(FAR_WORKSPACE_PREFERENCE_ENDPOINT).toBe('/api/v1/settings/user/settings')
    expect(preference.version).toBe(FAR_WORKSPACE_PREFERENCE_VERSION)
    expect(preference.workingDefinition.lifecycleScope).toBe('active')
    expect(preference.workingDefinition.groupBy).toBe('risk_band')
    expect(preference.workingDefinition.hiddenColumns).toEqual(['status'])
    expect(preference.workingDefinition.quickFilter).toBe('power loss')
    expect(buildFarWorkspacePreferencePatch(preference.workingDefinition)).toEqual({
      [FAR_WORKSPACE_PREFERENCE_KEY]: preference,
    })
    expect(normalizeFarWorkspacePreference(preference)).toEqual(preference)
    expect(normalizeFarWorkspacePreference({ ...preference, version: 99 })).toBeNull()
    expect(normalizeFarWorkspacePreference({ version: FAR_WORKSPACE_PREFERENCE_VERSION })).toBeNull()
    expect(normalizeFarWorkspacePreference(null)).toBeNull()
  })

  it('normalizes collaborative FAR views without duplicating ids', () => {
    const result = normalizeFarSavedViews([
      { id: '17', name: ' High risk ', config: { lifecycleScope: 'archived', rpn: 1 } as any, source: 'remote' },
      { id: '17', name: 'Duplicate', config: {} as any, source: 'remote' },
      { id: 'local-1', name: ' Local fallback ', config: { hiddenColumns: ['status'] } as any, source: 'local' },
    ])

    expect(result.map((view) => [view.id, view.name])).toEqual([
      ['17', 'High risk'],
      ['local-1', 'Local fallback'],
    ])
    expect(result[0].config.lifecycleScope).toBe('archived')
    expect(result[1].config.lifecycleScope).toBe('active')
    expect(result[1].config.hiddenColumns).toEqual(['status'])
  })
})
