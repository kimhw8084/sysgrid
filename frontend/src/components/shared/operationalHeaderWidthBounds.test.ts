import { describe, expect, it } from 'vitest'

import { applyOperationalHeaderWidthBounds } from './operationalHeaderWidthBounds'
import { buildOperationalColumnDefinition } from './OperationalGridStandard'
import { getOperationalColumnSizingMetadata, normalizeOperationalColumnDefinition } from './OperationalGridSizing'

describe('applyOperationalHeaderWidthBounds', () => {
  it('overrides only explicitly bounded fields and preserves remaining column data', () => {
    const columns = [
      { field: 'country', width: 120, minWidth: 96, headerName: 'Country' },
      { field: 'name', width: 220, minWidth: 180, headerName: 'Vendor Name' },
    ]

    expect(applyOperationalHeaderWidthBounds(columns, {
      country: { minWidth: 128, maxWidth: 128 },
    })).toEqual([
      { field: 'country', width: 128, minWidth: 128, maxWidth: 128, operationalMinimumWidth: 128, headerName: 'Country' },
      { field: 'name', width: 220, minWidth: 180, headerName: 'Vendor Name' },
    ])
  })

  it('never weakens an existing operational column minimum', () => {
    const columns = [{ field: 'country', operationalMinimumWidth: 144 }]

    expect(applyOperationalHeaderWidthBounds(columns, {
      country: { minWidth: 128 },
    })).toEqual([{ field: 'country', minWidth: 128, operationalMinimumWidth: 144 }])
  })

  it('carries a requested header minimum through the shared column builder into AG Grid', () => {
    const [bounded] = applyOperationalHeaderWidthBounds([
      { kind: 'plain' as const, field: 'country', headerName: 'Country', width: 136 },
    ], { country: { minWidth: 136 } })
    const gridColumn = normalizeOperationalColumnDefinition(buildOperationalColumnDefinition(bounded))

    expect(gridColumn.minWidth).toBe(136)
    expect(getOperationalColumnSizingMetadata(gridColumn).userMinWidth).toBe(136)
  })
})
