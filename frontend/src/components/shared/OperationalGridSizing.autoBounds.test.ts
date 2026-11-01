import { describe, expect, it, vi } from 'vitest'

import { applyOperationalColumnState, autoSizeOperationalColumns, clampAutoSizedOperationalColumnWidths } from './OperationalGridSizing'

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

  it('caps automatic sizing without capping a user-resized width', () => {
    const definition = { colId: 'title', minWidth: 40, operationalAutoSizeMaxWidth: 340 }
    let applied: any
    const api = {
      getAllDisplayedColumns: () => [
        { getColId: () => 'title', getColDef: () => definition, getActualWidth: () => 761 },
      ],
      getColumn: () => ({ getColDef: () => definition }),
      applyColumnState: (config: any) => { applied = config },
    }

    clampAutoSizedOperationalColumnWidths(api)
    expect(applied.state).toEqual([{ colId: 'title', width: 340 }])

    let restored: any
    const savedApi = {
      getColumn: () => ({ getColDef: () => definition }),
      applyColumnState: (config: any) => { restored = config },
    }
    applyOperationalColumnState(savedApi, [{ colId: 'title', width: 761 }], true)
    expect(restored.state).toEqual([{ colId: 'title', width: 761 }])
  })

  it('does not call or resize a grid after AG Grid destroys its API', () => {
    const getAllDisplayedColumns = vi.fn(() => undefined as any)
    const applyColumnState = vi.fn()
    const autoSizeColumns = vi.fn()
    const api = {
      isDestroyed: () => true,
      getAllDisplayedColumns,
      applyColumnState,
      autoSizeColumns,
    }

    clampAutoSizedOperationalColumnWidths(api)
    autoSizeOperationalColumns({ api })

    expect(getAllDisplayedColumns).not.toHaveBeenCalled()
    expect(applyColumnState).not.toHaveBeenCalled()
    expect(autoSizeColumns).not.toHaveBeenCalled()
  })
})
