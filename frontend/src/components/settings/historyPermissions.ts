/** Historical tenant grants only; module/control-plane policy is enforced separately. */
export type PermissionHistoryRecord = {
  is_admin?: unknown
  role_id?: unknown
  role_permissions?: unknown
  custom_permissions?: unknown
}

const levels = new Map<string, number>([
  ['none', 0], ['read', 1], ['add', 2], ['write', 2],
  ['edit', 3], ['manage', 3], ['full', 3], ['admin', 3],
])

export function normalizeHistoryPermissionLevel(value: unknown): number {
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(3, Math.trunc(value)))
  return typeof value === 'string' ? levels.get(value.trim().toLowerCase()) ?? 0 : 0
}

function permissionMap(value: unknown): Map<string, number> | null {
  if (value == null) return new Map()
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value)
  const keys = entries.map(([key]) => key.trim()).filter(Boolean)
  // Historical serialization may reorder keys. Colliding legacy aliases have no reliable winner.
  if (new Set(keys).size !== keys.length) return null
  if (entries.some(([, level]) =>
    !['string', 'boolean', 'number'].includes(typeof level) || (typeof level === 'number' && !Number.isFinite(level)))) return null
  return new Map(entries.filter(([key]) => key.trim()).map(([key, level]) => [key.trim(), normalizeHistoryPermissionLevel(level)]))
}

export function hasCompleteHistoryPermissions(operator: PermissionHistoryRecord): boolean {
  if (operator.is_admin === true) return true
  if (operator.is_admin !== false) return false
  // An explicit no-role record needs no historical role definition. Never use today's roles.
  const hasRoleRecord = Object.prototype.hasOwnProperty.call(operator, 'role_permissions')
  if (!hasRoleRecord && operator.role_id !== null) return false
  return permissionMap(operator.role_permissions) !== null && permissionMap(operator.custom_permissions) !== null
}

export function recordedPermissionState(operator: PermissionHistoryRecord | null, capability: string): { level: number | null; global: number | null } {
  if (!operator || capability.toLowerCase().startsWith('system.')) return { level: 0, global: 0 }
  if (!hasCompleteHistoryPermissions(operator)) return { level: null, global: null }
  if (operator.is_admin === true) return { level: 3, global: 3 }
  const permissions = new Map([...permissionMap(operator.role_permissions)!, ...permissionMap(operator.custom_permissions)!])
  const global = permissions.get('all') ?? 0
  return { level: Math.max(permissions.get(capability) ?? 0, global), global }
}

export function recordedPermissionLevel(operator: PermissionHistoryRecord | null, capability: string): number | null {
  return recordedPermissionState(operator, capability).level
}

export function historyPermissionViews(views: string[], ...operators: Array<PermissionHistoryRecord | null>): string[] {
  const keys = operators.flatMap(operator => [operator?.role_permissions, operator?.custom_permissions]
    .flatMap(value => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : []))
  return [...new Set([...views, ...keys.map(key => key.trim()).filter(key => key && key !== 'all')])]
}

export function formatRecordedPermissions(value: unknown): string {
  if (value === undefined) return 'Not recorded'
  if (value === null) return 'Not set'
  if (typeof value === 'object' && !Array.isArray(value)) {
    return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))), null, 2)
  }
  return `Invalid recorded permissions: ${JSON.stringify(value)}`
}
