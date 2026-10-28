import { describe, expect, it, vi } from 'vitest'

import { buildVendorGoldenColumns } from './vendorGoldenColumns'

describe('Vendor header width constraints', () => {
  it('leaves room for measured labels and header controls', () => {
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

    expect(columns.find((column: any) => column.field === 'country')).toMatchObject({ minWidth: 128, maxWidth: 128 })
    expect(columns.find((column: any) => column.field === 'primary_personnel_name')).toMatchObject({ minWidth: 192, maxWidth: 200 })
    expect(columns.find((column: any) => column.field === 'personnel_count')).toMatchObject({ minWidth: 144 })
  })
})
