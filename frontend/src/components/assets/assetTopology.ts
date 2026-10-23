export type TopologyNode = { id: number; name: string; type?: string; status?: string; system?: string; [key: string]: any }
export type TopologyLink = { source: number; target: number; category: 'network' | 'relationship'; label: string; direction: 'forward' | 'reverse' | 'both' | 'unspecified' }
export type AssetTopology = { nodes: TopologyNode[]; links: TopologyLink[] }

/** Traverse a bounded neighborhood while preserving each link's direction and identity. */
export function buildAssetTopology({ assets, connections, relationships, rootIds, depth = 1 }: {
  assets: any[]; connections: any[]; relationships: any[]; rootIds: number[]; depth?: number
}): AssetTopology {
  const index = new Map<number, TopologyNode>()
  for (const asset of assets) {
    const id = Number(asset.id)
    if (Number.isSafeInteger(id) && id > 0) index.set(id, { ...asset, id, name: String(asset.name || `Asset ${id}`) })
  }
  const adjacency = new Map<number, Array<{ key: string; link: TopologyLink }>>()
  for (const [category, entries] of [['network', connections], ['relationship', relationships]] as const) {
    for (const entry of entries) {
      const source = Number(category === 'network' ? entry.source_device_id ?? entry.src_device_id : entry.source_device_id)
      const target = Number(category === 'network' ? entry.target_device_id ?? entry.dst_device_id : entry.target_device_id)
      if (!index.has(source) || !index.has(target) || source === target) continue
      const label = String(category === 'network' ? entry.link_type || entry.connection_type || 'Network' : entry.relationship_type || 'Dependency')
      const direction: TopologyLink['direction'] = category === 'relationship' ? 'forward'
        : entry.direction === 'Bidirectional' ? 'both'
        : entry.direction === 'Target to Source' ? 'reverse'
        : ['Unidirectional', 'Source to Target'].includes(entry.direction) ? 'forward' : 'unspecified'
      const key = `${category}:${entry.id ?? JSON.stringify([source, target, entry.source_port ?? entry.src_port, entry.target_port ?? entry.dst_port, label])}`
      const edge = { key, link: { source, target, category, label, direction } }
      for (const id of [source, target]) {
        const entries = adjacency.get(id)
        if (entries) entries.push(edge)
        else adjacency.set(id, [edge])
      }
    }
  }
  const included = new Set(rootIds.map(Number).filter(id => index.has(id)))
  let frontier = [...included]
  const visited = new Set<number>()
  const links = new Map<string, TopologyLink>()
  const limit = Math.min(4, Math.max(1, Math.floor(depth) || 1))
  for (let level = 0; level < limit && frontier.length; level++) {
    const next = new Set<number>()
    for (const id of frontier) {
      visited.add(id)
      for (const edge of adjacency.get(id) || []) {
        links.set(edge.key, edge.link)
        const peer = edge.link.source === id ? edge.link.target : edge.link.source
        included.add(peer)
        if (!visited.has(peer)) next.add(peer)
      }
    }
    frontier = [...next]
  }
  return { nodes: [...included].map(id => ({ ...index.get(id)! })), links: [...links.values()].map(link => ({ ...link })) }
}

export const ASSET_TOPOLOGY_COLORS: Record<string, string> = {
  Physical: '#34d399', Virtual: '#60a5fa', Storage: '#fbbf24', Switch: '#fb7185', Firewall: '#fb923c',
  'Load Balancer': '#a78bfa', PDU: '#facc15', UPS: '#2dd4bf', 'Console-Server': '#38bdf8', 'Patch Panel': '#e879f9',
}
