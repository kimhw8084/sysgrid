import { describe, expect, it } from 'vitest'
import { getRackImpactPopupPosition } from './rackPopupGeometry'

describe('rack impact popup geometry', () => {
  it('keeps impact analysis beside the function menu with a consistent gap', () => {
    const point = { x: 280, y: 220 }
    const position = getRackImpactPopupPosition(point, { width: 1440, height: 900 })

    expect(position).toEqual({ x: point.x + 216 + 12, y: point.y + 8, width: 450 })
  })

  it('flips to the left of the function menu near the right viewport edge', () => {
    const point = { x: 1280, y: 280 }
    const position = getRackImpactPopupPosition(point, { width: 1440, height: 900 })

    expect(position.x + position.width).toBe(1440 - 16 - 216 - 12)
  })

  it('keeps both popups within a narrow desktop viewport', () => {
    const position = getRackImpactPopupPosition({ x: 400, y: 700 }, { width: 800, height: 620 })

    expect(position.x).toBeGreaterThanOrEqual(16)
    expect(position.x + position.width).toBeLessThanOrEqual(784)
    expect(position.y).toBeGreaterThanOrEqual(16)
    expect(position.y + 520).toBeLessThanOrEqual(604)
  })
})
