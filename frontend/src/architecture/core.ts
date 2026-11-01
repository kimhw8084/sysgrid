export type ArchitectureMode = 'current' | 'impact' | 'proposed'
export type ArchitectureObjectKind = 'Person' | 'Actor' | 'System' | 'Application/Service' | 'Datastore' | 'Component' | 'Device' | 'Network' | 'External system' | 'Group'

export type ArchitectureObject = {
  id: string
  model_id: string
  kind: ArchitectureObjectKind | string
  name: string
  description?: string | null
  owner_id?: string | null
  lifecycle: 'Current' | 'Planned' | 'Deprecated' | 'Retired' | string
  properties: Record<string, unknown>
  tags: string[]
  revision: number
  retired_at?: string | null
}

export type ArchitectureRelation = {
  id: string
  model_id: string
  source_id: string
  target_id: string
  relation_type: string
  name?: string | null
  description?: string | null
  properties: Record<string, unknown>
  revision: number
  retired_at?: string | null
}

export type ArchitectureMembership = { id: string; entity_kind: 'object' | 'relation' | string; entity_id: string; x: number; y: number; width: number; height: number; revision: number; metadata?: Record<string, unknown> }
export type ArchitectureDiagram = { id: string; model_id: string; name: string; level: string; filters: Record<string, unknown>; revision: number; memberships: ArchitectureMembership[] }
export type ArchitectureProjection = {
  model: { id: string; name: string; description?: string | null; owner_id: string; schema_version: string; lifecycle: string; revision: number }
  mode: ArchitectureMode
  objects: ArchitectureObject[]
  relations: ArchitectureRelation[]
  diagrams: ArchitectureDiagram[]
  reserved_object_ids: string[]
  capabilities: { read: boolean; edit: boolean; approve: boolean; apply: boolean }
  legacy_compatibility: { data_flows_readable: boolean; authority: string }
}

export const ARCHITECTURE_KINDS: ArchitectureObjectKind[] = ['Person', 'Actor', 'System', 'Application/Service', 'Datastore', 'Component', 'Device', 'Network', 'External system', 'Group']
export const ARCHITECTURE_LIFECYCLES = ['Current', 'Planned', 'Deprecated', 'Retired'] as const
export const ARCHITECTURE_RELATION_TYPES = ['Reads', 'Changes', 'Introduces', 'Retires', 'Depends on', 'Uses', 'Connects to', 'Contains'] as const

export const normalizeArchitectureProjection = (value: unknown): ArchitectureProjection => {
  const source = (value && typeof value === 'object' ? value : {}) as Partial<ArchitectureProjection>
  return {
    model: { id: String(source.model?.id || ''), name: String(source.model?.name || 'Architecture model'), description: source.model?.description || null, owner_id: String(source.model?.owner_id || ''), schema_version: String(source.model?.schema_version || 'pv1.architecture.v1'), lifecycle: String(source.model?.lifecycle || 'Current'), revision: Number(source.model?.revision || 1) },
    mode: source.mode === 'impact' || source.mode === 'proposed' ? source.mode : 'current',
    objects: Array.isArray(source.objects) ? source.objects.map((item) => ({ ...item, id: String(item.id), name: String(item.name || item.id), properties: item.properties || {}, tags: Array.isArray(item.tags) ? item.tags : [], revision: Number(item.revision || 1) })) : [],
    relations: Array.isArray(source.relations) ? source.relations.map((item) => ({ ...item, id: String(item.id), source_id: String(item.source_id), target_id: String(item.target_id), relation_type: String(item.relation_type || 'Depends on'), properties: item.properties || {}, revision: Number(item.revision || 1) })) : [],
    diagrams: Array.isArray(source.diagrams) ? source.diagrams.map((diagram) => ({ ...diagram, id: String(diagram.id), memberships: Array.isArray(diagram.memberships) ? diagram.memberships : [], revision: Number(diagram.revision || 1) })) : [],
    reserved_object_ids: Array.isArray(source.reserved_object_ids) ? source.reserved_object_ids.map(String) : [],
    capabilities: { read: Boolean(source.capabilities?.read), edit: Boolean(source.capabilities?.edit), approve: Boolean(source.capabilities?.approve), apply: Boolean(source.capabilities?.apply) },
    legacy_compatibility: { data_flows_readable: Boolean(source.legacy_compatibility?.data_flows_readable), authority: String(source.legacy_compatibility?.authority || 'pv1_architecture') },
  }
}

export const architectureNeighbors = (projection: ArchitectureProjection, objectId: string): Set<string> => {
  const result = new Set<string>([objectId])
  projection.relations.forEach((relation) => {
    if (relation.source_id === objectId) result.add(relation.target_id)
    if (relation.target_id === objectId) result.add(relation.source_id)
  })
  return result
}

export const cullArchitectureProjection = (projection: ArchitectureProjection, limit = 200): ArchitectureProjection => {
  if (projection.objects.length <= limit) return projection
  const objects = projection.objects.slice(0, limit)
  const ids = new Set(objects.map((item) => item.id))
  return { ...projection, objects, relations: projection.relations.filter((item) => ids.has(item.source_id) && ids.has(item.target_id)), reserved_object_ids: projection.reserved_object_ids.filter((id) => ids.has(id)) }
}

export const architectureSearch = (projection: ArchitectureProjection, query: string): ArchitectureObject[] => {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return projection.objects
  return projection.objects.filter((item) => [item.name, item.kind, item.description || '', ...item.tags].some((value) => value.toLocaleLowerCase().includes(normalized)))
}

export const architecturePosition = (object: ArchitectureObject, index: number, membership?: ArchitectureMembership): { x: number; y: number; width: number; height: number } => membership ? { x: membership.x, y: membership.y, width: membership.width, height: membership.height } : { x: 24 + (index % 4) * 210, y: 24 + Math.floor(index / 4) * 120, width: 180, height: 80 }

/** Preserve stored placement where possible, repair invalid boxes, and prevent overlapping diagram cards. */
export const layoutArchitecturePositions = (
  objects: ArchitectureObject[],
  memberships: ReadonlyMap<string, ArchitectureMembership>,
  gap = 24,
): Map<string, { x: number; y: number; width: number; height: number }> => {
  const placed: Array<{ x: number; y: number; width: number; height: number }> = []
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>()

  objects.forEach((object, index) => {
    const fallback = architecturePosition(object, index)
    const source = architecturePosition(object, index, memberships.get(`object:${object.id}`))
    const box = {
      x: Number.isFinite(source.x) ? source.x : fallback.x,
      y: Number.isFinite(source.y) ? source.y : fallback.y,
      width: Math.min(640, Math.max(180, Number.isFinite(source.width) ? source.width : fallback.width)),
      height: Math.min(320, Math.max(80, Number.isFinite(source.height) ? source.height : fallback.height)),
    }

    while (true) {
      const overlaps = placed.filter((previous) => (
        box.x < previous.x + previous.width + gap &&
        box.x + box.width + gap > previous.x &&
        box.y < previous.y + previous.height + gap &&
        box.y + box.height + gap > previous.y
      ))
      if (!overlaps.length) break
      box.y = Math.max(...overlaps.map((previous) => previous.y + previous.height + gap))
    }

    positions.set(object.id, box)
    placed.push(box)
  })

  return positions
}

/** Wrap SVG card labels to the available width and height without drawing through neighboring cards. */
export const wrapArchitectureLabel = (value: unknown, availableWidth: number, fontSize: number, maxLines: number) => {
  const text = String(value || '').trim()
  if (!text) return ['']
  const maxCharacters = Math.max(4, Math.floor(Math.max(24, availableWidth) / Math.max(6, fontSize * 0.58)))
  const lineLimit = Math.max(1, Math.floor(maxLines))
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''

  for (const word of words) {
    if (word.length > maxCharacters) {
      if (line) { lines.push(line); line = '' }
      for (let offset = 0; offset < word.length; offset += maxCharacters) {
        lines.push(word.slice(offset, offset + maxCharacters))
      }
      continue
    }
    if (!line) line = word
    else if (`${line} ${word}`.length <= maxCharacters) line = `${line} ${word}`
    else { lines.push(line); line = word }
  }
  if (line) lines.push(line)
  if (lines.length <= lineLimit) return lines
  return [...lines.slice(0, lineLimit - 1), `${lines[lineLimit - 1].slice(0, Math.max(1, maxCharacters - 1))}…`]
}

export const architectureDiagramBounds = (
  positions: Iterable<{ x: number; y: number; width: number; height: number }>,
  padding = 24,
): { x: number; y: number; width: number; height: number } => {
  const valid = Array.from(positions).filter((position) =>
    Number.isFinite(position.x) && Number.isFinite(position.y) &&
    Number.isFinite(position.width) && Number.isFinite(position.height) &&
    position.width > 0 && position.height > 0
  )
  if (!valid.length) return { x: 0, y: 0, width: 980, height: 620 }

  const left = Math.min(...valid.map((position) => position.x))
  const top = Math.min(...valid.map((position) => position.y))
  const right = Math.max(...valid.map((position) => position.x + position.width))
  const bottom = Math.max(...valid.map((position) => position.y + position.height))
  return {
    x: left - padding,
    y: top - padding,
    width: right - left + padding * 2,
    height: bottom - top + padding * 2,
  }
}

export const architectureInventoryText = (projection: ArchitectureProjection): string => {
  const lines = [`${projection.model.name} · revision ${projection.model.revision}`, `Mode: ${projection.mode}`, 'Objects:']
  projection.objects.forEach((item) => lines.push(`- ${item.kind}: ${item.name} [${item.lifecycle}] (${item.id}, revision ${item.revision})`))
  lines.push('Relations:')
  projection.relations.forEach((item) => lines.push(`- ${item.source_id} --${item.relation_type}--> ${item.target_id} (${item.id}, revision ${item.revision})`))
  return lines.join('\n')
}

export const validateArchitectureOperation = (operation: { type: string; payload: Record<string, unknown> }): string[] => {
  const errors: string[] = []
  if (!operation.type) errors.push('Operation type is required.')
  if (operation.type === 'object.create') {
    if (!operation.payload.kind) errors.push('Object kind is required.')
    if (!String(operation.payload.name || '').trim()) errors.push('Object name is required.')
  }
  if (operation.type === 'relation.create' && (!operation.payload.source_id || !operation.payload.target_id)) errors.push('A relation requires source and target objects.')
  return errors
}
