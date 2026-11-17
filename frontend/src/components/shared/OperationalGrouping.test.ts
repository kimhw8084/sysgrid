import { describe, expect, it } from 'vitest'
import { buildOperationalGroupSections, reconcileCollapsedOperationalGroups } from './OperationalGrouping'

describe('shared operational grouping', () => {
  it('groups empty, false, and zero values without dropping meaningful data', () => {
    const sections = buildOperationalGroupSections([
      { id: 1, value: false },
      { id: 2, value: 0 },
      { id: 3, value: '' },
      { id: 4, value: ' Active ' },
      { id: 5, value: 'Active' },
    ], 'value', row => row.value)

    expect(sections.map(section => [section.label, section.items.map(item => item.id)])).toEqual([
      ['0', [2]],
      ['Active', [4, 5]],
      ['false', [1]],
      ['Unspecified', [3]],
    ])
  })

  it('returns no sections for the raw table view', () => {
    expect(buildOperationalGroupSections([{ value: 'Active' }], 'raw', row => row.value)).toEqual([])
  })

  it('keeps high-cardinality groups responsive and preserves deliberate collapse choices', () => {
    const sections = Array.from({ length: 2_000 }, (_, index) => ({ key: `system:${index}` }))
    const current = Object.fromEntries([
      ['system:0', true],
      ['system:1999', false],
      ['stale:group', true],
    ])

    const next = reconcileCollapsedOperationalGroups(current, sections)

    expect(next).not.toBe(current)
    expect(next['system:0']).toBe(true)
    expect(next['system:1999']).toBe(false)
    expect(next['system:1000']).toBe(true)
    expect(next).not.toHaveProperty('stale:group')
    expect(Object.keys(next)).toHaveLength(2_000)
  })

  it('opens the first new group and collapses the rest to avoid mounting many grids at once', () => {
    const result = reconcileCollapsedOperationalGroups({}, [
      { key: 'system:Core' },
      { key: 'system:Edge' },
      { key: 'system:Archive' },
    ])

    expect(result).toEqual({
      'system:Core': false,
      'system:Edge': true,
      'system:Archive': true,
    })
  })

  it('retains state identity when the current collapse map already matches the sections', () => {
    const current = { 'system:Core': true, 'system:Edge': false }
    expect(reconcileCollapsedOperationalGroups(current, [{ key: 'system:Core' }, { key: 'system:Edge' }])).toBe(current)
  })
})
