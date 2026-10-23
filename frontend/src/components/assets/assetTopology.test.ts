import { describe, expect, it } from 'vitest'
import { buildAssetTopology } from './assetTopology'
const assets = [1, 2, 3, 4].map(id => ({ id, name: `Asset ${id}` }))
const connections = [{ id: 1, source_device_id: 1, target_device_id: 2, link_type: 'Data' },
  { id: 2, source_device_id: 2, target_device_id: 3, link_type: 'Data' }]
describe('Asset topology', () => {
  it('limits the neighborhood by hops and keeps isolated selected assets', () => {
    const input = { assets, connections, relationships: [], rootIds: [1, 4] }
    expect(buildAssetTopology(input).nodes.map(node => node.id)).toEqual([1, 4, 2])
    expect(buildAssetTopology({ ...input, depth: 2 }).nodes.map(node => node.id)).toEqual([1, 4, 2, 3])
  })
  it('preserves parallel links, reverse direction and relationship categories', () => {
    const graph = buildAssetTopology({ assets, rootIds: [1], relationships: [{ id: 1, source_device_id: 1, target_device_id: 2, relationship_type: 'Depends on' }],
      connections: [...connections, { id: 3, source_device_id: 2, target_device_id: 1, link_type: 'Data' }, { id: 4, source_device_id: 1, target_device_id: 2, link_type: 'Data' }] })
    expect(graph.links).toHaveLength(4)
    expect(graph.links.some(link => link.source === 2 && link.target === 1)).toBe(true)
    expect(new Set(graph.nodes.map(node => node.id)).size).toBe(graph.nodes.length)
  })
  it('supports legacy endpoint aliases and discards dangling links', () => {
    const graph = buildAssetTopology({ assets, rootIds: [1], relationships: [], connections: [
      { src_device_id: '1', dst_device_id: '2', connection_type: 'Management' },
      { src_device_id: 1, dst_device_id: 999 }, { source_device_id: 1, target_device_id: 1 },
    ] })
    expect(graph.links).toEqual([{ source: 1, target: 2, category: 'network', label: 'Management', direction: 'unspecified' }])
  })
  it('distinguishes both directions, reverse links and unrecognized historical directions', () => {
    const graph = buildAssetTopology({ assets, rootIds: [1], relationships: [], connections:
      ['Bidirectional', 'Source to Target', 'Target to Source', 'Ingress'].map((direction, id) => ({ id, source_device_id: 1, target_device_id: 2, direction })) })
    expect(graph.links.map(link => link.direction)).toEqual(['both', 'forward', 'reverse', 'unspecified'])
  })
  it('keeps simulation mutations away from records and returns no unselected network', () => {
    const before = JSON.stringify({ assets, connections })
    const graph = buildAssetTopology({ assets, connections, rootIds: [1], relationships: [] })
    graph.nodes[0].name = 'Simulation copy'
    expect(JSON.stringify({ assets, connections })).toBe(before)
    expect(buildAssetTopology({ assets, connections, rootIds: [], relationships: [] })).toEqual({ nodes: [], links: [] })
  })
})
