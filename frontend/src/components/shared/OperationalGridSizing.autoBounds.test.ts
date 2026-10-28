import { describe, expect, it } from 'vitest'

import { clampAutoSizedOperationalColumnWidths } from './OperationalGridSizing'

describe('auto-sized operational column width bounds', () => {
  it('restores declared minimums and maximums after content sizing', () => {
    let applied: any
    clampAutoSizedOperationalColumnWidths({
      getAllDisplayedColumns: () => [
        { getColId: () => 'country', getColDef: () => ({ minWidth: 120, maxWidth: 128 }), getActualWidth: () => 58 },
        { getColId: () => 'primary_contact', getColDef: () => ({ minWidth: 180, maxWidth: 200 }), getActualWidth: () => 150 },
        { getColId: () => 'contact_email', getColDef: () => ({ minWidth: 190, maxWidth: 200 }), getActualWidth: () => 240 },
        { getColId: () => 'notes', getColDef: () => ({ minWidth: 80, maxWidth: 200 }), getActualWidth: () => 140 },
      ],
      applyColumnState: (config: any) => { applied = config },
    })

    expect(applied).toEqual({
      state: [
        { colId: 'country', width: 120 },
        { colId: 'primary_contact', width: 180 },
        { colId: 'contact_email', width: 200 },
      ],
      applyOrder: false,
    })
  })
})
