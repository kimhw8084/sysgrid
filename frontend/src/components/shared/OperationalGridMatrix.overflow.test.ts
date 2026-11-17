import { describe, expect, it } from 'vitest'
import { getOperationalColumnsToUnpinForOverflow } from './OperationalGridMatrix'

const column = (colId: string, width: number, colDef: Record<string, unknown> = {}) => ({
  getColId: () => colId,
  getActualWidth: () => width,
  getColDef: () => colDef,
})

describe('operational grid pinned overflow', () => {
  it('keeps locked identity and action columns pinned while releasing only enough unlocked width', () => {
    const lockedIdentity = column('title', 260, { lockPinned: true })
    const unlockedIdentity = column('favorite', 64)
    const lockedAction = column('row_actions', 124, { lockPinned: true })
    const unlockedRight = column('extra', 140)

    expect(getOperationalColumnsToUnpinForOverflow(
      [lockedIdentity, unlockedIdentity],
      [unlockedRight, lockedAction],
      500,
    )).toEqual([unlockedRight])
  })

  it('leaves all pinned columns alone when the center has enough room', () => {
    expect(getOperationalColumnsToUnpinForOverflow([column('id', 90, { lockPinned: true })], [], 900)).toEqual([])
  })
})
