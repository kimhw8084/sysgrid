import { describe, expect, it } from 'vitest'
import { computeRowActionGeometry, estimateRowActionButtonWidth } from './OperationalRowActionGeometry'

const items = (labels: string[]) => labels.map((label, index) => ({
  id: `action-${index}`,
  label,
  icon: () => null,
  onClick: () => {},
}))

describe('adaptive row action menu geometry', () => {
  it('keeps a small action set compact and preserves natural button widths', () => {
    const geometry = computeRowActionGeometry({
      sections: [{ id: 'archive', columns: 1, items: items(['Archive']) }],
      headerContentWidth: 220,
      viewportWidth: 1440,
      viewportHeight: 900,
      cursorX: 600,
      cursorY: 300,
    })

    expect(geometry.panelWidth).toBe(244)
    expect(geometry.sections[0].rows[0].buttonWidths).toEqual([estimateRowActionButtonWidth('Archive')])
    expect(geometry.sections[0].rows[0].rowWidth).toBeLessThan(geometry.actionSetWidth)
  })

  it('uses each section column preference while capping large menus at a useful desktop width', () => {
    const geometry = computeRowActionGeometry({
      sections: [{ id: 'quickAccess', columns: 2, items: items(['Details', 'Edit', 'History', 'Duplicate', 'Export']) }],
      headerContentWidth: 200,
      viewportWidth: 1440,
      viewportHeight: 900,
      cursorX: 600,
      cursorY: 300,
    })

    expect(geometry.panelWidth).toBeLessThanOrEqual(520)
    expect(geometry.sections[0].rows.map(row => row.items.length)).toEqual([2, 2, 1])
    expect(geometry.sections[0].rows[2].rowWidth).toBeLessThan(geometry.actionSetWidth)
  })

  it('wraps long labels and stays inside the viewport at narrow window sizes', () => {
    const geometry = computeRowActionGeometry({
      sections: [{ id: 'quickAccess', columns: 3, items: items(['Open the complete operational change history and audit trail']) }],
      headerContentWidth: 900,
      viewportWidth: 360,
      viewportHeight: 260,
      cursorX: 350,
      cursorY: 220,
    })
    const row = geometry.sections[0].rows[0]

    expect(geometry.panelWidth).toBeLessThanOrEqual(328)
    expect(row.allowWrap).toBe(true)
    expect(row.buttonWidths[0]).toBe(geometry.actionSetWidth)
    expect(Number(geometry.style.left) + geometry.panelWidth).toBeLessThanOrEqual(344)
    expect(geometry.placement).toBe('above')
    expect(geometry.style.maxHeight).toBeLessThanOrEqual(196)
  })
})
