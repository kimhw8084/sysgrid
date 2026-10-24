import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Network, RotateCcw, Search, Share2, SlidersHorizontal } from 'lucide-react'
import { WorkspaceEmptyState } from '../shared/OperationalWorkspacePrimitives'
import { ASSET_TOPOLOGY_COLORS, buildAssetTopology } from './assetTopology'
import { AssetTopologyCanvas } from './AssetTopologyCanvas'

export function AssetMapSurface({ assets, visibleAssets, connections, relationships, selectedAssetId, systemsList, onOpenDetails, onEdit }: {
  assets: any[]; visibleAssets: any[]; connections: any[]; relationships: any[]; selectedAssetId?: number | null; systemsList: string[]
  onOpenDetails?: (asset: any) => void; onEdit?: (asset: any) => void
}) {
  const [selectedSystems, setSelectedSystems] = useState<string[]>([])
  const [selectedAssetIds, setSelectedAssetIds] = useState<number[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)
  const [depth, setDepth] = useState(1)
  const [search, setSearch] = useState('')
  const [assetSearch, setAssetSearch] = useState('')
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const lastExternalSelection = useRef<number | null>(null)
  useEffect(() => {
    const id = Number(selectedAssetId)
    if (!Number.isSafeInteger(id) || id <= 0 || !visibleAssets.some(asset => Number(asset.id) === id)) return
    if (lastExternalSelection.current === id) return
    lastExternalSelection.current = id
    setSelectedAssetIds([id]); setSelectedNodeId(id)
  }, [selectedAssetId, visibleAssets])
  const rootIds = useMemo(() => visibleAssets.filter(asset => selectedAssetIds.includes(Number(asset.id))
    || selectedSystems.includes(asset.system)
    || (search.trim().length >= 2 && String(asset.name || '').toLowerCase().includes(search.trim().toLowerCase())))
    .map(asset => Number(asset.id)), [visibleAssets, selectedAssetIds, selectedSystems, search])
  const graph = useMemo(() => buildAssetTopology({ assets, connections, relationships, rootIds, depth }), [assets, connections, relationships, rootIds, depth])
  const selectedNode = assets.find(asset => Number(asset.id) === selectedNodeId)
  const choices = visibleAssets.filter(asset => String(asset.name || '').toLowerCase().includes(assetSearch.toLowerCase()))
  const reset = () => { setSelectedSystems([]); setSelectedAssetIds([]); setSearch(''); setAssetSearch(''); setSelectedNodeId(null) }
  if (!assets.length) return <WorkspaceEmptyState title="No asset topology available" description="Register an asset, then link it to another asset to explore its connections." />
  return <div data-asset-map className="asset-map">
    <aside className="asset-map-sidebar" aria-label="Map filters">
      <div className="asset-map-title"><Share2 size={19} aria-hidden="true" /><div><h2>Asset topology</h2><p>Choose a starting point. Follow its connections.</p></div></div>
      <label className="asset-map-label" htmlFor="asset-map-search">Find a starting asset</label>
      <div className="asset-map-search"><Search size={16} aria-hidden="true" /><input id="asset-map-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by hostname (2+ letters)" /></div>
      <button type="button" className="asset-map-filter-toggle" aria-expanded={filtersExpanded} aria-controls="asset-map-filter-options" onClick={() => setFiltersExpanded(value => !value)}><SlidersHorizontal size={15} />Map filters <span>{rootIds.length} starting assets</span></button>
      <div id="asset-map-filter-options" className="asset-map-filter-options" data-expanded={filtersExpanded}>
      <details className="asset-map-filter-section">
        <summary>Systems <span>{selectedSystems.length || 'All available'}</span></summary>
        <div className="asset-map-system-list">{systemsList.map(system => <button type="button" key={system} aria-pressed={selectedSystems.includes(system)} onClick={() => setSelectedSystems(current => current.includes(system) ? current.filter(value => value !== system) : [...current, system])}>{system}</button>)}</div>
      </details>
      <details className="asset-map-filter-section">
        <summary>Starting assets <span>{selectedAssetIds.length} selected</span></summary>
        <input aria-label="Filter starting assets" value={assetSearch} onChange={event => setAssetSearch(event.target.value)} placeholder="Filter the asset list…" className="asset-map-list-search" />
        <div className="asset-map-asset-list">{choices.map(asset => <button type="button" key={asset.id} aria-pressed={selectedAssetIds.includes(Number(asset.id))} onClick={() => {
          const id = Number(asset.id)
          setSelectedAssetIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
          setSelectedNodeId(id)
        }}><Box size={14} aria-hidden="true" /><span>{asset.name}</span></button>)}{!choices.length && <p>No matching assets.</p>}</div>
      </details>
      <label className="asset-map-label" htmlFor="asset-map-depth">Connection depth <span>{depth} {depth === 1 ? 'hop' : 'hops'}</span></label>
      <input id="asset-map-depth" type="range" min="1" max="4" step="1" value={depth} onChange={event => setDepth(Number(event.target.value))} />
      <button type="button" className="asset-map-reset" onClick={reset}><RotateCcw size={14} aria-hidden="true" />Clear selections</button>
      </div>
    </aside>
    <div className="asset-map-main">
      <div className="asset-map-summary"><div><Network size={16} aria-hidden="true" /><strong>{graph.nodes.length} {graph.nodes.length === 1 ? 'asset' : 'assets'}</strong><span>{graph.links.length} {graph.links.length === 1 ? 'link' : 'links'}</span></div><span>Drag to pan · scroll to zoom</span></div>
      {graph.nodes.length ? <AssetTopologyCanvas graph={graph} selectedId={selectedNodeId} onSelect={setSelectedNodeId} className="asset-map-full-canvas" />
        : <div className="asset-map-empty"><WorkspaceEmptyState title="Choose where to start" description="Select a starting asset or system, or search a hostname. Only its connected neighborhood is drawn." /></div>}
      <div className="asset-map-bottom">
        <section className="asset-map-connected" aria-label="Connected assets">
          <h3>Connected assets <span>Keyboard accessible</span></h3>
          <div>{graph.nodes.map(node => <button type="button" key={node.id} title={node.name} aria-pressed={node.id === selectedNodeId} onClick={() => setSelectedNodeId(node.id)}><span style={{ backgroundColor: ASSET_TOPOLOGY_COLORS[node.type || ''] || '#94a3b8' }} />{node.name}</button>)}</div>
        </section>
        {selectedNode && <section className="asset-map-selection" aria-label="Selected asset">
          <p>{selectedNode.system || 'Asset'}</p><h3>{selectedNode.name}</h3>
          <dl><div><dt>Type</dt><dd>{selectedNode.type || 'Not recorded'}</dd></div><div><dt>Status</dt><dd>{selectedNode.status || 'Not recorded'}</dd></div><div><dt>Primary IP</dt><dd>{selectedNode.primary_ip || 'Not recorded'}</dd></div><div><dt>Owner</dt><dd>{selectedNode.owner || 'Unassigned'}</dd></div></dl>
          <div className="asset-map-selection-actions">{onOpenDetails && <button type="button" onClick={() => onOpenDetails(selectedNode)}>Open asset details</button>}{onEdit && <button type="button" onClick={() => onEdit(selectedNode)}>Edit asset</button>}</div>
        </section>}
      </div>
      <details className="asset-map-legend"><summary>Color legend</summary>
        <div>{Object.entries(ASSET_TOPOLOGY_COLORS).map(([type, color]) => <span key={type}><i style={{ backgroundColor: color }} />{type}</span>)}<span><i style={{ backgroundColor: 'var(--topology-network)' }} />Network link</span><span><i style={{ backgroundColor: 'var(--topology-dependency)' }} />Dependency</span></div>
      </details>
    </div>
  </div>
}
