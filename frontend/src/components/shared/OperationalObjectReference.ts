export type OperationalObjectType =
  | 'device'
  | 'service'
  | 'monitoring'
  | 'network'
  | 'rack'
  | 'project'
  | 'far'
  | 'knowledge'

export interface OperationalObjectReference {
  objectType: OperationalObjectType
  objectId: string
}

export interface OperationalObjectNavigation {
  moduleId: string
  path: string
}

const OBJECT_TYPE_ALIASES: Record<string, OperationalObjectType> = {
  asset: 'device',
  device: 'device',
  devices: 'device',
  service: 'service',
  services: 'service',
  logical_service: 'service',
  logical_services: 'service',
  monitoring: 'monitoring',
  monitor: 'monitoring',
  monitoring_item: 'monitoring',
  monitoring_items: 'monitoring',
  network: 'network',
  port_connection: 'network',
  port_connections: 'network',
  rack: 'rack',
  racks: 'rack',
  project: 'project',
  projects: 'project',
  far: 'far',
  knowledge: 'knowledge',
}

const OBJECT_NAVIGATION: Record<OperationalObjectType, { moduleId: string; route: string }> = {
  device: { moduleId: 'assets', route: '/asset' },
  service: { moduleId: 'services', route: '/services' },
  monitoring: { moduleId: 'monitoring', route: '/monitoring' },
  network: { moduleId: 'network', route: '/network' },
  rack: { moduleId: 'racks', route: '/racks' },
  project: { moduleId: 'projects', route: '/projects' },
  far: { moduleId: 'far', route: '/far' },
  knowledge: { moduleId: 'knowledge', route: '/knowledge' },
}

// Only audit tables with a canonical typed relationship are listed here.
// Unsupported targets intentionally fail closed instead of guessing a table.
const AUDIT_TARGET_TABLES: Partial<Record<OperationalObjectType, string>> = {
  device: 'devices',
  service: 'logical_services',
  monitoring: 'monitoring_items',
  network: 'port_connections',
  rack: 'racks',
}

const normalizeObjectId = (objectId: unknown) => {
  if (typeof objectId === 'string') {
    const normalized = objectId.trim()
    return normalized || null
  }
  if (typeof objectId === 'number' && Number.isFinite(objectId)) return String(objectId)
  return null
}

const normalizeObjectType = (objectType: unknown): OperationalObjectType | null => {
  if (typeof objectType !== 'string') return null
  return OBJECT_TYPE_ALIASES[objectType.trim().toLowerCase()] || null
}

export function createOperationalObjectReference(objectType: unknown, objectId: unknown): OperationalObjectReference | null {
  const normalizedType = normalizeObjectType(objectType)
  const normalizedId = normalizeObjectId(objectId)
  if (!normalizedType || !normalizedId) return null
  return { objectType: normalizedType, objectId: normalizedId }
}

export function resolveOperationalObjectNavigation(reference: OperationalObjectReference | null | undefined): OperationalObjectNavigation | null {
  if (!reference) return null
  const navigation = OBJECT_NAVIGATION[reference.objectType]
  if (!navigation || !reference.objectId) return null
  return {
    moduleId: navigation.moduleId,
    path: `${navigation.route}?id=${encodeURIComponent(reference.objectId)}`,
  }
}

export function resolveOperationalObjectReference(objectType: unknown, objectId: unknown): OperationalObjectNavigation | null {
  return resolveOperationalObjectNavigation(createOperationalObjectReference(objectType, objectId))
}

export function resolveOperationalAuditNavigation(objectType: unknown, objectId: unknown): OperationalObjectNavigation | null {
  const reference = createOperationalObjectReference(objectType, objectId)
  if (!reference) return null
  const targetTable = AUDIT_TARGET_TABLES[reference.objectType]
  if (!targetTable) return null
  return {
    moduleId: 'logs',
    path: `/logs?target_table=${encodeURIComponent(targetTable)}&target_id=${encodeURIComponent(reference.objectId)}`,
  }
}
