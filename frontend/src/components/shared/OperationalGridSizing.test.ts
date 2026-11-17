import { describe, expect, it } from 'vitest'

import { applyOperationalColumnSizing, applyOperationalColumnState, finalizeOperationalColumnDefinition, getEffectiveOperationalGridFontSize, getOperationalColumnSizingMetadata, getOperationalCompactGridHeight, getOperationalContentAutoSizeStrategy, getOperationalGridHeaderHeight, getOperationalGridRowDensityForHeight, getOperationalGridRowHeight, normalizeOperationalColumnDefinitions, OPERATIONAL_GRID_MIN_FONT_SIZE } from './OperationalGridSizing'

describe('compact operational grid sizing', () => {
  it('keeps the effective body size at the project minimum without rewriting saved requests', () => {
    expect(OPERATIONAL_GRID_MIN_FONT_SIZE).toBe(12)
    expect(getEffectiveOperationalGridFontSize(8)).toBe(12)
    expect(getEffectiveOperationalGridFontSize(11)).toBe(12)
    expect(getEffectiveOperationalGridFontSize(13)).toBe(13)
    expect(getEffectiveOperationalGridFontSize(18)).toBe(18)
    expect(getEffectiveOperationalGridFontSize(Number.NaN)).toBe(12)
    expect(getEffectiveOperationalGridFontSize(Number.NaN, 13)).toBe(13)
  })

  it('fits small filtered result sets without a tall blank panel', () => {
    expect(getOperationalCompactGridHeight(0, 12, 24)).toBe(142)
    expect(getOperationalCompactGridHeight(1, 12, 24)).toBe(142)
    expect(getOperationalCompactGridHeight(5, 12, 24)).toBe(268)
    expect(getOperationalCompactGridHeight(6, 12, 24)).toBeNull()
  })

  it('applies one row and header height scale across operational grids', () => {
    expect(getOperationalGridHeaderHeight(12)).toBe(42)
    expect(getOperationalGridRowHeight(12, 0)).toBe(40)
    expect(getOperationalGridRowHeight(12, 4)).toBe(40)
    expect(getOperationalGridRowHeight(12, 8)).toBe(40)
    expect(getOperationalGridRowHeight(12, 16)).toBe(40)
    expect(getOperationalGridRowHeight(12, 24)).toBe(42)
    expect(getOperationalGridRowHeight(14, 33)).toBe(48)
    expect(getOperationalGridRowDensityForHeight(24, 12)).toBe(6)
    expect(getOperationalGridRowHeight(12, getOperationalGridRowDensityForHeight(24, 12))).toBe(40)
    expect(getOperationalGridRowHeight(12, getOperationalGridRowDensityForHeight(48, 12))).toBe(48)
    for (let rowHeight = 40; rowHeight <= 48; rowHeight += 1) {
      expect(getOperationalGridRowHeight(12, getOperationalGridRowDensityForHeight(rowHeight, 12))).toBe(rowHeight)
    }
  })
})

describe('resizable operational columns', () => {
  it('excludes columns marked skip-auto-size from the initial content-size strategy', () => {
    const [identity, country] = normalizeOperationalColumnDefinitions([
      { field: 'name', width: 220, minWidth: 180, maxWidth: 220, operationalSkipAutoSize: true },
      { field: 'country', width: 136, operationalAutoSizeMaxWidth: 136 },
    ])
    expect(getOperationalContentAutoSizeStrategy({ type: 'fitCellContents' }, [identity, country]))
      .toEqual({ type: 'fitCellContents', colIds: ['country'] })
    expect(getOperationalContentAutoSizeStrategy({ type: 'fitCellContents', colIds: ['name'] }, [identity, country]))
      .toBeUndefined()
    expect(getOperationalContentAutoSizeStrategy({ type: 'fitGridWidth' }, [identity, country]))
      .toEqual({ type: 'fitGridWidth' })
  })

  it('applies the same small minimum and removes per-column width locks', () => {
    const [utility, grouped] = normalizeOperationalColumnDefinitions([
      { colId: 'select', width: 64, minWidth: 64, maxWidth: 64, resizable: false, operationalLockWidth: true, operationalSkipAutoSize: true },
      { headerName: 'Group', children: [{ colId: 'name', width: 220, minWidth: 180, maxWidth: 240, resizable: false }] },
    ])
    expect(utility).toMatchObject({ width: 64, minWidth: 40, resizable: true })
    expect(getOperationalColumnSizingMetadata(utility)).toMatchObject({
      autoSizeMinWidth: 64,
      autoSizeMaxWidth: 64,
      skipAutoSize: true,
    })
    expect(utility).not.toHaveProperty('operationalAutoSizeMinWidth')
    expect(utility).not.toHaveProperty('operationalAutoSizeMaxWidth')
    expect(utility).not.toHaveProperty('operationalSkipAutoSize')
    expect(utility).not.toHaveProperty('maxWidth')
    expect(utility).not.toHaveProperty('operationalLockWidth')
    expect(grouped.children[0]).toMatchObject({ width: 220, minWidth: 40, resizable: true })
    expect(getOperationalColumnSizingMetadata(grouped.children[0]).autoSizeMaxWidth).toBe(240)
    expect(grouped.children[0]).not.toHaveProperty('maxWidth')

    const normalizedAgain = normalizeOperationalColumnDefinitions([utility])[0]
    expect(getOperationalColumnSizingMetadata(normalizedAgain)).toMatchObject({ autoSizeMaxWidth: 64 })
    expect(normalizedAgain).not.toHaveProperty('operationalAutoSizeMaxWidth')
    expect(normalizedAgain).not.toHaveProperty('operationalSkipAutoSize')

    const finalizedWithoutLayout = finalizeOperationalColumnDefinition(
      { colId: 'name', width: 210, minWidth: 180, maxWidth: 210 },
      undefined,
      false,
    )
    const normalizedFinalized = normalizeOperationalColumnDefinitions([finalizedWithoutLayout])[0]
    expect(getOperationalColumnSizingMetadata(normalizedFinalized)).toMatchObject({
      autoSizeMinWidth: 180,
      autoSizeMaxWidth: 210,
    })
  })

  it('enforces an explicit user-resize minimum only for columns that require complete labels', () => {
    const [ordinary, required] = normalizeOperationalColumnDefinitions([
      { colId: 'ordinary', minWidth: 180 },
      { colId: 'administrator', minWidth: 180, operationalMinimumWidth: 180 },
    ])
    expect(ordinary.minWidth).toBe(40)
    expect(required.minWidth).toBe(180)
    expect(getOperationalColumnSizingMetadata(required).userMinWidth).toBe(180)
    expect(required).not.toHaveProperty('operationalMinimumWidth')
    expect(normalizeOperationalColumnDefinitions([required])[0].minWidth).toBe(180)
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
    expect(getOperationalColumnSizingMetadata(column).autoSizeMaxWidth).toBe(64)
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
