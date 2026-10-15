import { describe, expect, it } from 'vitest'

import { applyOperationalColumnSizing, lockOperationalColumnWidth } from './OperationalGridSizing'

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

describe('lockOperationalColumnWidth', () => {
  it('ignores stale saved layout widths for locked operational columns', () => {
    const column = lockOperationalColumnWidth(
      {
        colId: 'select',
        operationalLockWidth: true,
        width: 48,
      },
      {
        width: 160,
      },
    )

    expect(column.width).toBe(48)
    expect(column.initialWidth).toBe(48)
    expect(column.minWidth).toBe(48)
    expect(column.maxWidth).toBe(48)
  })
})
