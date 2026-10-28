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

describe('Asset header width constraints', () => {
  it('leaves room for visible labels and header controls after content sizing', () => {
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
      expect(columns.find((column: any) => column.field === field)?.minWidth).toBe(minimumWidth)
    }
  })
})
