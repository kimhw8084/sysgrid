import React, { useMemo, useState } from 'react'
import { architectureDiagramBounds, architectureInventoryText, architectureSearch, cullArchitectureProjection, layoutArchitecturePositions, wrapArchitectureLabel, type ArchitectureMode, type ArchitectureObject, type ArchitectureProjection } from './core'

type Props = {
  projection: ArchitectureProjection
  mode: ArchitectureMode
  readOnly?: boolean
  compact?: boolean
  onModeChange?: (mode: ArchitectureMode) => void
  onCommand: (type: string, payload: Record<string, unknown>) => Promise<void> | void
  onOpenFull?: () => void
}

const buttonStyle: React.CSSProperties = { minHeight: 40, minWidth: 40, border: '1px solid var(--pv1-border, rgba(148,163,184,.25))', borderRadius: 8, padding: '8px 12px', background: 'var(--pv1-surface-1, rgba(15,23,42,.8))', color: 'var(--pv1-text-primary, #e2e8f0)', cursor: 'pointer' }
const inputStyle: React.CSSProperties = { minHeight: 40, border: '1px solid var(--pv1-border, rgba(148,163,184,.25))', borderRadius: 8, padding: '8px 10px', background: 'var(--pv1-surface-0, #0f172a)', color: 'var(--pv1-text-primary, #e2e8f0)', width: '100%' }

export function ArchitectureCanvas({ projection, mode, readOnly = false, compact = false, onModeChange, onCommand, onOpenFull }: Props) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newKind, setNewKind] = useState('Application/Service')
  const [newName, setNewName] = useState('')
  const [relationSource, setRelationSource] = useState('')
  const [relationTarget, setRelationTarget] = useState('')
  const [live, setLive] = useState('')
  const [objectListLimit, setObjectListLimit] = useState(200)
  const [relationListLimit, setRelationListLimit] = useState(200)
  const visible = useMemo(() => cullArchitectureProjection(projection), [projection])
  const matches = useMemo(() => architectureSearch(projection, query), [projection, query])
  const diagram = visible.diagrams[0]
  const membership = new Map((diagram?.memberships || []).map((item) => [`${item.entity_kind}:${item.entity_id}`, item]))
  const positions = layoutArchitecturePositions(visible.objects, membership)
  const autoFitDiagram = visible.objects.length <= 16
  const diagramBounds = architectureDiagramBounds(positions.values(), autoFitDiagram ? 54 : 24)
  const diagramWidth = Math.max(720, Math.ceil(diagramBounds.width))
  const diagramHeight = Math.max(430, Math.ceil(diagramBounds.height))
  const objectNames = new Map(projection.objects.map((object) => [object.id, object.name]))
  const selected = projection.objects.find((item) => item.id === selectedId) || null

  const announce = (message: string) => { setLive(message); window.setTimeout(() => setLive(''), 3000) }
  const createObject = async () => {
    if (!newName.trim()) return
    await onCommand('object.create', { id: globalThis.crypto?.randomUUID?.(), kind: newKind, name: newName.trim(), lifecycle: mode === 'proposed' ? 'Planned' : 'Current' })
    announce(`Created ${newName.trim()}.`)
    setNewName('')
  }
  const createRelation = async () => {
    if (!relationSource || !relationTarget || relationSource === relationTarget) return
    await onCommand('relation.create', { id: globalThis.crypto?.randomUUID?.(), source_id: relationSource, target_id: relationTarget, relation_type: 'Depends on' })
    announce('Relation saved to the canonical model.')
    setRelationSource(''); setRelationTarget('')
  }
  const exportInventory = () => {
    const blob = new Blob([architectureInventoryText(projection)], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = url; link.download = `${projection.model.name.replace(/\s+/g, '-').toLowerCase()}-architecture.txt`; link.click(); URL.revokeObjectURL(url)
  }
  return <section aria-label={`${projection.model.name} Architecture`} data-pv1-architecture-engine="shared" data-architecture-mode={mode} style={{ display: 'flex', flexDirection: 'column', minHeight: compact ? 520 : 'min(760px, calc(100vh - 150px))', gap: 12, color: 'var(--pv1-text-primary, #e2e8f0)' }}>
    <p className="sg-sr">Text alternative: {projection.model.name} in {mode} mode contains {projection.objects.length} authorized objects and {projection.relations.length} authorized relations at model revision {projection.model.revision}. The canvas realizes {visible.objects.length} objects and {visible.relations.length} relations for rendering; the adjacent searchable Architecture record view is the complete keyboard-accessible model.</p>
    <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <div><p style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.14em', opacity: .65 }}>Canonical Architecture · revision {projection.model.revision}</p><h1 style={{ margin: '4px 0 0', fontSize: compact ? 20 : 28, overflowWrap: 'anywhere' }}>{projection.model.name}</h1><p style={{ margin: '4px 0 0', opacity: .7 }}>{projection.legacy_compatibility.authority} · {projection.objects.length} objects · {projection.relations.length} relations</p></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button type="button" onClick={exportInventory} style={buttonStyle}>Export inventory</button>{onOpenFull ? <button type="button" onClick={onOpenFull} style={buttonStyle}>Open full Architecture</button> : null}</div>
    </header>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><div role="tablist" aria-label="Architecture view mode" style={{ display: 'flex', gap: 4 }}>{(['current', 'impact', 'proposed'] as ArchitectureMode[]).map((value) => <button type="button" role="tab" aria-selected={mode === value} key={value} onClick={() => onModeChange?.(value)} style={{ ...buttonStyle, background: mode === value ? 'var(--pv1-accent, #2563eb)' : buttonStyle.background }}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div><span aria-label="Canonical model revision" style={{ marginLeft: 'auto', opacity: .7 }}>Model revision {projection.model.revision}</span></div>
    <div style={{ display: 'grid', gridTemplateColumns: compact ? 'minmax(180px, 260px) 1fr' : 'minmax(230px, 320px) 1fr', gap: 12, minHeight: 0, flex: 1 }}>
      <aside style={{ border: '1px solid var(--pv1-border, rgba(148,163,184,.25))', borderRadius: 10, padding: 12, overflow: 'auto' }} aria-label="Architecture object and relation list"><label style={{ display: 'block', fontSize: 12 }}>Search objects<input aria-label="Search Architecture objects" value={query} onChange={(event) => { setQuery(event.target.value); setObjectListLimit(200) }} placeholder="Name, kind, tag…" style={{ ...inputStyle, marginTop: 6 }} /></label><p style={{ margin: '10px 0 0', fontSize: 12, opacity: .7 }}>{matches.length} matching authorized objects{visible.objects.length < projection.objects.length ? ` · ${visible.objects.length} realized in canvas` : ''}</p><div role="list" aria-label="Canonical Architecture objects" style={{ marginTop: 12, display: 'grid', gap: 6 }}>{matches.slice(0, objectListLimit).map((object) => <button type="button" role="listitem" key={object.id} onClick={() => setSelectedId(object.id)} aria-current={selectedId === object.id ? 'true' : undefined} style={{ ...buttonStyle, textAlign: 'left', padding: 10, borderColor: selectedId === object.id ? 'var(--pv1-accent, #60a5fa)' : undefined }}><strong style={{ display: 'block', overflowWrap: 'anywhere' }} title={object.name}>{object.name}</strong><small style={{ opacity: .7 }}>{object.kind} · {object.lifecycle} · r{object.revision}</small></button>)}</div>{matches.length > objectListLimit ? <button type="button" onClick={() => setObjectListLimit((limit) => limit + 200)} style={{ ...buttonStyle, width: '100%', marginTop: 8 }}>Show more Architecture objects ({matches.length - objectListLimit} remaining)</button> : null}{projection.relations.length ? <div style={{ marginTop: 14 }}><p style={{ fontSize: 12, opacity: .7 }}>Relations ({projection.relations.length} authorized)</p>{projection.relations.slice(0, relationListLimit).map((relation) => <button type="button" key={relation.id} onClick={() => { setRelationSource(relation.source_id); setRelationTarget(relation.target_id) }} style={{ ...buttonStyle, width: '100%', textAlign: 'left', marginBottom: 6 }}><small style={{ display: 'block', overflowWrap: 'anywhere' }}>{objectNames.get(relation.source_id) || relation.source_id} <b>→</b> {objectNames.get(relation.target_id) || relation.target_id}</small><strong style={{ display: 'block' }}>{relation.relation_type}</strong></button>)}{projection.relations.length > relationListLimit ? <button type="button" onClick={() => setRelationListLimit((limit) => limit + 200)} style={{ ...buttonStyle, width: '100%', marginTop: 2 }}>Show more relationships ({projection.relations.length - relationListLimit} remaining)</button> : null}</div> : <p style={{ opacity: .7 }}>No relations in this projection.</p>}</aside>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}><div role="img" aria-label="Architecture diagram projection" style={{ flex: 1, minHeight: compact ? 300 : 430, overflow: 'auto', border: '1px solid var(--pv1-border, rgba(148,163,184,.25))', borderRadius: 10, background: 'var(--pv1-surface-0, #0f172a)' }}>{visible.objects.length === 0 ? <div data-architecture-empty="true" role="status" className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 p-8 text-center"><p className="text-sm font-semibold">No authorized objects are available in this diagram.</p>{!readOnly ? <p className="text-xs opacity-70">Add the first object below to begin mapping the system.</p> : null}</div> : (<svg viewBox={[diagramBounds.x, diagramBounds.y, diagramBounds.width, diagramBounds.height].join(' ')} width={autoFitDiagram ? '100%' : diagramWidth} height={autoFitDiagram ? '100%' : diagramHeight} preserveAspectRatio={autoFitDiagram ? 'xMidYMid meet' : 'xMidYMin meet'} style={{ display: 'block', maxWidth: 'none' }}><g aria-hidden="true">{visible.relations.map((relation) => { const source = positions.get(relation.source_id); const target = positions.get(relation.target_id); if (!source || !target) return null; return <line key={relation.id} x1={source.x + source.width} y1={source.y + source.height / 2} x2={target.x} y2={target.y + target.height / 2} stroke="var(--pv1-accent, #60a5fa)" strokeWidth="2" markerEnd="url(#arrow)" /> })}<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor" /></marker></defs></g>{visible.objects.map((object) => {
        const box = positions.get(object.id)!
        const nameLines = wrapArchitectureLabel(object.name, box.width - 24, 14, Math.max(1, Math.floor((box.height - 40) / 15)))
        const kindLines = wrapArchitectureLabel(object.kind, box.width - 24, 11, 1)
        const nameY = box.y + 22
        const revisionY = box.y + box.height - 8
        const kindY = Math.min(nameY + nameLines.length * 15 + 2, revisionY - 14)
        return <g key={object.id} tabIndex={0} role="button" aria-label={`${object.name}, ${object.kind}, revision ${object.revision}`} onClick={() => setSelectedId(object.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(object.id) } }}>
          <rect x={box.x} y={box.y} width={box.width} height={box.height} rx="10" fill={object.id === selectedId ? 'var(--pv1-accent, #2563eb)' : 'var(--pv1-surface-1, #1e293b)'} stroke={object.lifecycle === 'Planned' ? '#f59e0b' : 'var(--pv1-border, #64748b)'} />
          <title>{object.name}</title>
          <text fill="currentColor" fontSize="14" fontWeight="700">{nameLines.map((line, index) => <tspan key={`${object.id}-name-${index}`} x={box.x + 12} y={nameY + index * 15}>{line}</tspan>)}</text>
          <text x={box.x + 12} y={kindY} fill="currentColor" opacity=".72" fontSize="11">{kindLines[0]}</text>
          <text x={box.x + 12} y={revisionY} fill="currentColor" opacity=".65" fontSize="10">r{object.revision} · {object.lifecycle}</text>
        </g>
      })}</svg>)}</div><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'start' }}><div aria-live="polite" style={{ minHeight: 24, opacity: .78 }}>{live || (selected ? `${selected.name} selected · ${selected.kind}` : `${visible.objects.length} objects visible`)}</div>{selected && !readOnly ? <div style={{ display: 'flex', gap: 8 }}><button type="button" style={buttonStyle} onClick={() => onCommand('object.retire', { object_id: selected.id, expected_revision: selected.revision })}>Retire selected</button><button type="button" style={buttonStyle} onClick={() => onCommand('object.clone', { object_id: selected.id, clone_id: globalThis.crypto?.randomUUID?.(), name: `${selected.name} copy`, expected_revision: selected.revision })}>Clone selected</button></div> : null}</div></div>
    </div>
    {!readOnly ? <footer style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, borderTop: '1px solid var(--pv1-border, rgba(148,163,184,.25))', paddingTop: 12 }}><form onSubmit={(event) => { event.preventDefault(); void createObject() }} style={{ display: 'flex', gap: 8, alignItems: 'end' }}><label style={{ flex: 1, fontSize: 12 }}>New object name<input aria-label="New Architecture object name" value={newName} onChange={(event) => setNewName(event.target.value)} style={{ ...inputStyle, marginTop: 6 }} /></label><label style={{ minWidth: 170, fontSize: 12 }}>Kind<select aria-label="New Architecture object kind" value={newKind} onChange={(event) => setNewKind(event.target.value)} style={{ ...inputStyle, marginTop: 6 }}>{['Application/Service', 'Datastore', 'System', 'Component', 'External system', 'Person', 'Group'].map((kind) => <option key={kind}>{kind}</option>)}</select></label><button type="submit" style={buttonStyle} disabled={!newName.trim()}>Add object</button></form><form onSubmit={(event) => { event.preventDefault(); void createRelation() }} style={{ display: 'flex', gap: 8, alignItems: 'end' }}><label style={{ flex: 1, fontSize: 12 }}>From<select aria-label="Relation source object" value={relationSource} onChange={(event) => setRelationSource(event.target.value)} style={{ ...inputStyle, marginTop: 6 }}><option value="">Select</option>{visible.objects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label style={{ flex: 1, fontSize: 12 }}>To<select aria-label="Relation target object" value={relationTarget} onChange={(event) => setRelationTarget(event.target.value)} style={{ ...inputStyle, marginTop: 6 }}><option value="">Select</option>{visible.objects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="submit" style={buttonStyle} disabled={!relationSource || !relationTarget || relationSource === relationTarget}>Add relation</button></form></footer> : null}
  </section>
}
