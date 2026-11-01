import { describe, expect, it } from 'vitest'
import { buildOperationalGroupSections } from './OperationalGrouping'

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
})
