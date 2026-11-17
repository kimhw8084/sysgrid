import { describe, expect, it, vi } from 'vitest'

import { buildAssetGoldenColumns } from './assetGoldenColumns'
import { applyOperationalColumnSizing, getOperationalColumnSizingMetadata, normalizeOperationalColumnDefinitions } from '../shared/OperationalGridSizing'
import { OPERATIONAL_GRID_WIDTHS } from '../shared/OperationalGridContract'

const buildColumns = () => buildAssetGoldenColumns({
  activeTab: 'inventory',
  hiddenColumns: [],
  fontSize: 11,
  isIntelligenceExpanded: false,
  isRecentChange: vi.fn(() => false),
  onOpenQuickLook: vi.fn(),
  onOpenDetails: vi.fn(),
  onOpenEdit: vi.fn(),
  getConsoleUrl: vi.fn(() => null),
  onOpenRowActions: vi.fn(),
  onToggleFavorite: vi.fn(),
  onToggleWatch: vi.fn(),
})

describe('Asset header resize defaults', () => {
  it('enforces explicit readable header minima while preserving an initial width for each column', () => {
    const columns = buildColumns()
    const expectedMinimumWidths = new Map([
      ['system', 112],
      ['type', 96],
      ['environment', 92],
      ['manufacturer', 104],
      ['model', 112],
      ['primary_ip', 144],
    ])

    for (const [field, minimumWidth] of expectedMinimumWidths) {
      const column = columns.find((candidate: any) => candidate.field === field)
      expect(column?.initialWidth ?? column?.width).toBeGreaterThanOrEqual(minimumWidth)
      expect(column?.minWidth).toBe(minimumWidth)
      expect(column).not.toHaveProperty('maxWidth')
      expect(column?.resizable).toBe(true)
    }
  })

  it('allocates enough default and auto-size width for the operational System identifier', () => {
    const system = buildColumns().find((candidate: any) => candidate.field === 'system')

    expect(system?.initialWidth ?? system?.width).toBe(150)
    expect(getOperationalColumnSizingMetadata(system).autoSizeMaxWidth).toBe(150)
    expect(system?.minWidth).toBe(112)
    expect(system?.resizable).toBe(true)
  })

  it('keeps status resizable to its readable minimum and preserves full pinned action width', () => {
    const columns = buildColumns()
    const status = columns.find((candidate: any) => candidate.field === 'status')
    const actions = columns.find((candidate: any) => candidate.colId === 'row_actions')

    expect(status?.initialWidth ?? status?.width).toBe(OPERATIONAL_GRID_WIDTHS.badge)
    expect(status?.minWidth).toBe(OPERATIONAL_GRID_WIDTHS.badgeMin)
    expect(actions?.initialWidth ?? actions?.width).toBe(160)
  })

  it('places Make beside System so both identifiers remain in the first visible grid segment', () => {
    const fields = buildColumns().map((candidate: any) => candidate.field)
    const systemIndex = fields.indexOf('system')

    expect(fields[systemIndex + 1]).toBe('manufacturer')
  })

  it('preserves the Environment value width when restoring a previously narrower saved layout', () => {
    const environment = buildColumns().find((candidate: any) => candidate.field === 'environment')
    expect(environment?.initialWidth ?? environment?.width).toBe(92)
    expect(environment?.minWidth).toBe(92)
    expect(getOperationalColumnSizingMetadata(environment).userMinWidth).toBe(92)

    const normalized = normalizeOperationalColumnDefinitions([environment])[0]
    expect(normalized.minWidth).toBe(92)
    expect(getOperationalColumnSizingMetadata(normalized).userMinWidth).toBe(92)
    expect(applyOperationalColumnSizing(normalized, { colId: 'environment', width: 52 }, true).width).toBe(92)
  })
})
