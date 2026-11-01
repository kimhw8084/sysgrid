import { describe, expect, it } from 'vitest'

import { applyOperationalColumnSizing, applyOperationalColumnState, finalizeOperationalColumnDefinition, getOperationalCompactGridHeight, getOperationalGridHeaderHeight, getOperationalGridRowDensityForHeight, getOperationalGridRowHeight, normalizeOperationalColumnDefinitions } from './OperationalGridSizing'

describe('compact operational grid sizing', () => {
  it('fits small filtered result sets without a tall blank panel', () => {
    expect(getOperationalCompactGridHeight(0, 11, 24)).toBe(142)
    expect(getOperationalCompactGridHeight(1, 11, 24)).toBe(142)
    expect(getOperationalCompactGridHeight(5, 11, 24)).toBe(268)
    expect(getOperationalCompactGridHeight(6, 11, 24)).toBeNull()
  })

  it('applies one row and header height scale across operational grids', () => {
    expect(getOperationalGridHeaderHeight(11)).toBe(42)
    expect(getOperationalGridRowHeight(11, 4)).toBe(22)
    expect(getOperationalGridRowHeight(11, 8)).toBe(26)
    expect(getOperationalGridRowHeight(11, 16)).toBe(34)
    expect(getOperationalGridRowHeight(20, 24)).toBe(48)
    expect(getOperationalGridRowDensityForHeight(24, 11)).toBe(6)
    expect(getOperationalGridRowHeight(11, getOperationalGridRowDensityForHeight(48, 11))).toBe(48)
    for (let rowHeight = 22; rowHeight <= 48; rowHeight += 1) {
      expect(getOperationalGridRowHeight(11, getOperationalGridRowDensityForHeight(rowHeight, 11))).toBe(rowHeight)
    }
  })
})

describe('resizable operational columns', () => {
  it('applies the same small minimum and removes per-column width locks', () => {
    const [utility, grouped] = normalizeOperationalColumnDefinitions([
      { colId: 'select', width: 64, minWidth: 64, maxWidth: 64, resizable: false, operationalLockWidth: true },
      { headerName: 'Group', children: [{ colId: 'name', width: 220, minWidth: 180, maxWidth: 240, resizable: false }] },
    ])
    expect(utility).toMatchObject({ width: 64, minWidth: 40, resizable: true })
    expect(utility).not.toHaveProperty('maxWidth')
    expect(utility).not.toHaveProperty('operationalLockWidth')
    expect(grouped.children[0]).toMatchObject({ width: 220, minWidth: 40, resizable: true })
    expect(grouped.children[0]).not.toHaveProperty('maxWidth')
  })

  it('restores saved widths beyond the former fixed bounds', () => {
    const column = finalizeOperationalColumnDefinition(
      { colId: 'favorite', width: 64, minWidth: 64, maxWidth: 64, resizable: false, operationalLockWidth: true },
      { colId: 'favorite', width: 900 },
      true,
    )
    expect(column.width).toBe(900)
    expect(column.minWidth).toBe(40)
    expect(column.resizable).toBe(true)
    expect(column).not.toHaveProperty('maxWidth')
  })

  it('keeps a saved manual width from being overridden by a column flex setting', () => {
    const column = finalizeOperationalColumnDefinition(
      { colId: 'name', width: 220, flex: 1.2, initialFlex: 1.2, minWidth: 120 },
      { colId: 'name', width: 580 },
      true,
    )
    expect(column.width).toBe(580)
    expect(column).not.toHaveProperty('flex')
    expect(column).not.toHaveProperty('initialFlex')
  })
})

describe('restored pin state', () => {
  it('preserves an explicit unpin after automatic narrow-viewport overflow', () => {
    const column = { colId: 'title', pinned: 'left', width: 240 }
    expect(applyOperationalColumnSizing(column, { colId: 'title', pinned: null }, false).pinned).toBeNull()
    expect(applyOperationalColumnSizing(column, { colId: 'title' }, false).pinned).toBe('left')
  })
  it('keeps fixed utility widths while preserving an explicit unpin', () => {
    const column = { colId: 'select', pinned: 'left', width: 48, operationalLockWidth: true }
    const result = applyOperationalColumnSizing(column, { colId: 'select', pinned: null, width: 160 }, true)
    expect(result.pinned).toBeNull()
    expect(result.width).toBe(48)
  })
})

describe('restored column width bounds', () => {
  it('clamps saved widths to the current column minimum and maximum', () => {
    const column = { colId: 'contact', width: 180, minWidth: 120, maxWidth: 200 }
    expect(applyOperationalColumnSizing(column, { colId: 'contact', width: 80 }, true).width).toBe(120)
    expect(applyOperationalColumnSizing(column, { colId: 'contact', width: 260 }, true).width).toBe(200)
  })

  it('clamps the state applied to a live grid column definition', () => {
    let applied: any[] = []
    applyOperationalColumnState({
      getColumn: () => ({ getColDef: () => ({ minWidth: 120, maxWidth: 200 }) }),
      applyColumnState: (config: any) => { applied = config.state },
    }, [{ colId: 'contact', width: 80 }], true)
    expect(applied[0].width).toBe(120)
  })
})
