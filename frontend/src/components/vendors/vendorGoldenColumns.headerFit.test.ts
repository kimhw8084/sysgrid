import { describe, expect, it, vi } from 'vitest'

import { buildVendorGoldenColumns } from './vendorGoldenColumns'

describe('Vendor header resize defaults', () => {
  it('keeps a common minimum while preserving an initial readable width for each column', () => {
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

    for (const field of ['country', 'primary_personnel_name', 'personnel_count']) {
      const column = columns.find((candidate: any) => candidate.field === field)
      expect(column?.initialWidth ?? column?.width).toBeGreaterThanOrEqual(40)
      expect(column?.minWidth).toBe(40)
      expect(column).not.toHaveProperty('maxWidth')
      expect(column?.resizable).toBe(true)
    }
  })
})
