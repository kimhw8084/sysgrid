import { describe, expect, it, vi } from 'vitest'

import { buildAssetGoldenColumns } from './assetGoldenColumns'

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
  it('keeps a common minimum while preserving an initial readable width for each column', () => {
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
      expect(column?.minWidth).toBe(40)
      expect(column).not.toHaveProperty('maxWidth')
      expect(column?.resizable).toBe(true)
    }
  })
})
