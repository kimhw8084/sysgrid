import { describe, expect, it, vi } from 'vitest'

import { buildVendorGoldenColumns } from './vendorGoldenColumns'

describe('Vendor header resize defaults', () => {
  it('enforces declared header minima while preserving resizable columns', () => {
    const columns = buildVendorGoldenColumns({
      fontSize: 11,
      hiddenColumns: [],
      columnLayoutState: [],
      preserveExplicitColumnWidths: false,
      isIntelligenceExpanded: false,
      isRecentChange: vi.fn(() => false),
      onToggleFavorite: vi.fn(),
      onToggleWatch: vi.fn(),
      renderPrimaryRowActions: () => null,
    })

    const expectedMinimumWidths = new Map([
      ['country', 136],
      ['primary_personnel_name', 192],
      ['primary_personnel_email', 190],
      ['personnel_count', 144],
    ])
    for (const [field, minimumWidth] of expectedMinimumWidths) {
      const column = columns.find((candidate: any) => candidate.field === field)
      expect(column?.initialWidth ?? column?.width).toBeGreaterThanOrEqual(minimumWidth)
      expect(column?.minWidth).toBe(minimumWidth)
      expect(column).not.toHaveProperty('maxWidth')
      expect(column?.resizable).toBe(true)
    }
  })
})
