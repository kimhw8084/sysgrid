import { describe, expect, it } from 'vitest'

import { applyOperationalHeaderWidthBounds } from './operationalHeaderWidthBounds'

describe('applyOperationalHeaderWidthBounds', () => {
  it('overrides only explicitly bounded fields and preserves remaining column data', () => {
    const columns = [
      { field: 'country', width: 120, minWidth: 96, headerName: 'Country' },
      { field: 'name', width: 220, minWidth: 180, headerName: 'Vendor Name' },
    ]

    expect(applyOperationalHeaderWidthBounds(columns, {
      country: { minWidth: 128, maxWidth: 128 },
    })).toEqual([
      { field: 'country', width: 120, minWidth: 128, maxWidth: 128, headerName: 'Country' },
      { field: 'name', width: 220, minWidth: 180, headerName: 'Vendor Name' },
    ])
  })
})
