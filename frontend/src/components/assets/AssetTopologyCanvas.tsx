import React, { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { Crosshair, Maximize2, Minus, Plus } from 'lucide-react'
import { ASSET_TOPOLOGY_COLORS, type AssetTopology } from './assetTopology'

export function AssetTopologyCanvas({ graph, selectedId, onSelect, className = '', controls = true }: {
  graph: AssetTopology; selectedId?: number | null; onSelect?: (id: number) => void; className?: string; controls?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<any>(null)
  const lastFit = useRef<AssetTopology | null>(null)
  const labelLayout = useRef<Map<number, string>>(new Map())
  const [size, setSize] = useState({ width: 320, height: 300 })
  const [appearance, setAppearance] = useState({ ink: '#e1e1e1', surface: '#202020', network: '#2dd4bf', dependency: '#a78bfa', attention: '#e4a5a0', active: '#73d5c3', scheduled: '#e5c583' })
  const reducedMotion = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const duration = reducedMotion ? 0 : 250
  useEffect(() => {
    if (!host.current) return
    const measure = () => {
      const rect = host.current!.getBoundingClientRect()
      const next = { width: Math.max(1, Math.floor(rect.width)), height: Math.max(1, Math.floor(rect.height)) }
      setSize(current => current.width === next.width && current.height === next.height ? current : next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const update = () => {
      const style = getComputedStyle(document.documentElement)
      setAppearance({
        ink: style.getPropertyValue('--text-primary').trim() || '#e1e1e1',
        surface: style.getPropertyValue('--surface-elevated').trim() || '#202020',
        network: style.getPropertyValue('--topology-network').trim() || '#2dd4bf',
        dependency: style.getPropertyValue('--topology-dependency').trim() || '#a78bfa',
        attention: style.getPropertyValue('--state-danger').trim() || '#e4a5a0',
        active: style.getPropertyValue('--guide-teal').trim() || '#73d5c3',
        scheduled: style.getPropertyValue('--guide-amber').trim() || '#e5c583',
      })
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  const labelCandidates = useMemo(() => {
    const budget = Math.min(graph.nodes.length, Math.max(8, Math.floor((size.width * size.height) / 16_000)))
    const priority = (node: any) => Number(node.id) === selectedId ? 0
      : node.workSignal?.level === 'attention' ? 1
        : node.workSignal?.level === 'active' ? 2
          : node.workSignal?.level === 'scheduled' ? 3
            : 4
    return graph.nodes.slice().sort((left: any, right: any) => priority(left) - priority(right) || String(left.name).localeCompare(String(right.name)))
      .slice(0, budget)
  }, [graph.nodes, selectedId, size.height, size.width])
  const fit = () => engine.current?.zoomToFit(duration, 96)
  useEffect(() => {
    const canvas = host.current?.querySelector('canvas')
    if (!canvas) return
    // The graph engine can receive its new width before the canvas reaches
    // layout. Fit only after that displayed size changes, not on selection.
    const observer = new ResizeObserver(() => {
      if (lastFit.current === graph) engine.current?.zoomToFit(duration, 96)
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [graph, duration])
  const safeLabel = (value: string) => {
    const label = document.createElement('span')
    label.textContent = value
    return label.innerHTML
  }
  return <div className={`asset-topology-canvas ${className}`}>
    {controls && <div className="asset-map-canvas-tools" aria-label="Map navigation">
      <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => engine.current?.zoom(Math.min(8, (engine.current?.zoom() || 1) * 1.3), duration)}><Plus aria-hidden="true" size={16} /></button>
      <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => engine.current?.zoom(Math.max(.1, (engine.current?.zoom() || 1) / 1.3), duration)}><Minus aria-hidden="true" size={16} /></button>
      <button type="button" title="Fit all assets" aria-label="Fit all assets" onClick={fit}><Maximize2 aria-hidden="true" size={16} /></button>
      <button type="button" title="Focus selected asset" aria-label="Focus selected asset" disabled={!selectedId} onClick={() => {
        const node = graph.nodes.find(node => node.id === selectedId)
        if (node && Number.isFinite(node.x) && Number.isFinite(node.y)) {
          engine.current?.centerAt(node.x, node.y, duration); engine.current?.zoom(2, duration)
        }
      }}><Crosshair aria-hidden="true" size={16} /></button>
    </div>}
    <div ref={host} className="asset-map-canvas-host" role="img" aria-label={`Asset topology: ${graph.nodes.length} assets and ${graph.links.length} links. Select an asset from the connected-assets list for details.`}>
      <ForceGraph2D ref={engine} graphData={graph} width={size.width} height={size.height}
        maxZoom={8}
        nodeRelSize={5} nodeVal={(node: any) => Number(node.id) === selectedId ? 49 / 25 : 1}
        cooldownTicks={reducedMotion ? 1 : 80} warmupTicks={reducedMotion ? 80 : 0} backgroundColor="rgba(0,0,0,0)"
        onEngineStop={() => { if (lastFit.current !== graph) { lastFit.current = graph; fit() } }}
        onRenderFramePre={(context: CanvasRenderingContext2D, scale: number) => {
          const placements: Array<{ left: number; right: number; top: number; bottom: number }> = []
          const nextLayout = new Map<number, string>()
          context.save()
          context.font = `600 ${12 / scale}px Inter, sans-serif`
          for (const node of labelCandidates) {
            if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue
            const selected = Number(node.id) === selectedId
            const hasWorkSignal = ['attention', 'active', 'scheduled'].includes(node.workSignal?.level)
            if (scale < 1.25 && graph.nodes.length > labelCandidates.length && !selected && !hasWorkSignal) continue

            const maxWidth = Math.min(160, Math.max(16, size.width - 32)) / scale
            const characters = Array.from(String(node.name || 'Asset'))
            let label = characters.join('')
            if (context.measureText(label).width > maxWidth) {
              let low = 0, high = characters.length
              while (low < high) {
                const middle = Math.ceil((low + high) / 2)
                if (context.measureText(characters.slice(0, middle).join('') + '…').width <= maxWidth) low = middle
                else high = middle - 1
              }
              label = characters.slice(0, low).join('') + '…'
            }

            const textWidth = context.measureText(label).width
            const padX = 5 / scale
            const labelY = Number(node.y) + 9 / scale
            const bounds = {
              left: Number(node.x) - textWidth / 2 - padX,
              right: Number(node.x) + textWidth / 2 + padX,
              top: labelY - 1 / scale,
              bottom: labelY + 15 / scale,
            }
            if (placements.some((placed) => bounds.left < placed.right && bounds.right > placed.left && bounds.top < placed.bottom && bounds.bottom > placed.top)) continue
            placements.push(bounds)
            nextLayout.set(Number(node.id), label)
          }
          context.restore()
          labelLayout.current = nextLayout
        }}
        onNodeClick={(node: any) => onSelect?.(Number(node.id))}
        nodeLabel={(node: any) => safeLabel(`${node.name} · ${node.type || 'Asset'}`)}
        linkLabel={(link: any) => safeLabel(`${link.label} · ${link.direction === 'unspecified' ? 'Direction not recorded or unrecognized' : link.direction === 'both' ? 'Bidirectional' : link.direction === 'reverse' ? 'Target to Source' : 'Source to Target'}`)}
        linkColor={(link: any) => link.category === 'network' ? appearance.network : appearance.dependency} linkWidth={1.25}
        linkDirectionalArrowLength={(link: any) => ['forward', 'both'].includes(link.direction) ? 4 : 0} linkDirectionalArrowRelPos={1}
        linkCanvasObjectMode={() => 'after'}
        linkCanvasObject={(link: any, context: CanvasRenderingContext2D) => {
          if (!['reverse', 'both'].includes(link.direction)) return
          const { source, target } = link
          const distance = Math.hypot(target.x - source.x, target.y - source.y)
          if (!Number.isFinite(distance) || distance < 30) return
          const ux = (target.x - source.x) / distance, uy = (target.y - source.y) / distance
          const radius = Number(source.id) === selectedId ? 7 : 5
          const x = source.x + ux * (radius + 1), y = source.y + uy * (radius + 1)
          context.beginPath(); context.moveTo(x, y)
          context.lineTo(x + ux * 4 - uy * 1.6, y + uy * 4 + ux * 1.6)
          context.lineTo(x + ux * 4 + uy * 1.6, y + uy * 4 - ux * 1.6)
          context.closePath(); context.fillStyle = link.category === 'network' ? appearance.network : appearance.dependency; context.fill()
        }}
        nodeCanvasObject={(node: any, context: CanvasRenderingContext2D, scale: number) => {
          const selected = Number(node.id) === selectedId
          context.beginPath(); context.arc(node.x, node.y, selected ? 7 : 5, 0, Math.PI * 2)
          context.fillStyle = ASSET_TOPOLOGY_COLORS[node.type] || '#94a3b8'; context.fill()
          if (selected) { context.strokeStyle = appearance.ink; context.lineWidth = 2 / scale; context.stroke() }
          const signalColor = node.workSignal?.level === 'attention' ? appearance.attention
            : node.workSignal?.level === 'active' ? appearance.active
              : node.workSignal?.level === 'scheduled' ? appearance.scheduled : null
          if (signalColor) {
            context.beginPath(); context.arc(node.x, node.y, (selected ? 9 : 7) / scale, 0, Math.PI * 2)
            context.strokeStyle = signalColor; context.lineWidth = 2.5 / scale; context.stroke()
          }
          const label = labelLayout.current.get(Number(node.id))
          if (!label) return
          context.font = `600 ${12 / scale}px Inter, sans-serif`
          context.textAlign = 'center'; context.textBaseline = 'top'; context.fillStyle = appearance.ink
          const textWidth = context.measureText(label).width
          const padX = 5 / scale, labelY = node.y + 9 / scale
          context.fillStyle = appearance.surface
          context.fillRect(node.x - textWidth / 2 - padX, labelY - 1 / scale, textWidth + padX * 2, 16 / scale)
          context.fillStyle = appearance.ink
          context.fillText(label, node.x, labelY + 1 / scale)
        }} />
    </div>
  </div>
}
