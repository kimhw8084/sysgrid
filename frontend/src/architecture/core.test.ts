import { describe, expect, it } from 'vitest'
import { architectureDiagramBounds, architectureInventoryText, architectureNeighbors, architectureSearch, cullArchitectureProjection, layoutArchitecturePositions, normalizeArchitectureProjection, validateArchitectureOperation, wrapArchitectureLabel } from './core'

const projection = normalizeArchitectureProjection({ model: { id: 'm1', name: 'Platform', revision: 4 }, objects: [{ id: 'a', kind: 'Application/Service', name: 'Checkout', lifecycle: 'Current', revision: 2, tags: ['payments'] }, { id: 'b', kind: 'Datastore', name: 'Orders', lifecycle: 'Planned', revision: 1 }], relations: [{ id: 'r1', source_id: 'a', target_id: 'b', relation_type: 'Changes', revision: 1 }], diagrams: [] })

describe('shared Architecture core', () => {
  it('normalizes one canonical projection and discovers one-hop impact', () => {
    expect(architectureNeighbors(projection, 'a')).toEqual(new Set(['a', 'b']))
    expect(architectureSearch(projection, 'payment').map((item) => item.id)).toEqual(['a'])
  })
  it('fits small diagrams to their content and preserves a stable empty-canvas size', () => {
    expect(architectureDiagramBounds([
      { x: 24, y: 24, width: 180, height: 80 },
      { x: 234, y: 24, width: 180, height: 80 },
    ], 32)).toEqual({ x: -8, y: -8, width: 454, height: 144 })
    expect(architectureDiagramBounds([])).toEqual({ x: 0, y: 0, width: 980, height: 620 })
  })
  it('repairs overlapping stored placements and wraps long labels to each card size', () => {
    const memberships = new Map([
      ['object:a', { id: 'ma', entity_kind: 'object' as const, entity_id: 'a', x: 24, y: 24, width: 100, height: 40, revision: 1 }],
      ['object:b', { id: 'mb', entity_kind: 'object' as const, entity_id: 'b', x: 24, y: 24, width: 100, height: 40, revision: 1 }],
    ])
    const positions = layoutArchitecturePositions(projection.objects, memberships)
    const first = positions.get('a')!
    const second = positions.get('b')!
    expect(first).toMatchObject({ width: 180, height: 80 })
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height + 24)
    const lines = wrapArchitectureLabel('Primary application service with a long name', first.width - 24, 14, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('…')
  })
  it('culls large projections while preserving only valid edges', () => {
    const large = normalizeArchitectureProjection({ ...projection, objects: Array.from({ length: 205 }, (_, index) => ({ id: `o-${index}`, kind: 'Component', name: `Component ${index}`, lifecycle: 'Current', revision: 1 })), relations: [{ id: 'r', source_id: 'o-0', target_id: 'o-1', relation_type: 'Uses', revision: 1 }] })
    const culled = cullArchitectureProjection(large, 200)
    expect(culled.objects).toHaveLength(200)
    expect(culled.relations).toHaveLength(1)
    expect(architectureSearch(large, 'Component 204').map((item) => item.id)).toEqual(['o-204'])
    expect(architectureInventoryText(large)).toContain('Component 204')
  })
  it('exports a textual inventory and rejects incomplete typed operations', () => {
    expect(architectureInventoryText(projection)).toContain('Checkout')
    expect(validateArchitectureOperation({ type: 'object.create', payload: {} })).toEqual(['Object kind is required.', 'Object name is required.'])
  })
})
