import { describe, expect, it } from 'vitest'
import { architectureDiagramBounds, architectureInventoryText, architectureNeighbors, architectureSearch, cullArchitectureProjection, normalizeArchitectureProjection, validateArchitectureOperation } from './core'

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
