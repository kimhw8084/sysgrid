export const AUDIT_DEFAULT_LIMIT = 200
export const AUDIT_MIN_LIMIT = 1
export const AUDIT_MAX_LIMIT = 500
export const AUDIT_EXPORT_FILENAME_PREFIX = 'SysGrid_AuditLoadedResult'

export const buildAuditExportFileName = (date = new Date()) => (
  `${AUDIT_EXPORT_FILENAME_PREFIX}_${date.toISOString().split('T')[0]}.csv`
)

export interface AuditQueryDescriptor {
  start_date: string
  end_date: string
  target_table: string
  target_id: string
  limit: number
  offset: number
}

export interface AuditResultScope {
  scope: 'bounded'
  limit: number
  offset: number
  hasMore: boolean
  complete: boolean
}

export interface AuditQueryResult<T = Record<string, unknown>> {
  items: T[]
  scope: AuditResultScope
}

const normalizeText = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const normalizeInteger = (value: unknown, fallback: number, minimum: number) => (
  typeof value === 'number' && Number.isInteger(value) && value >= minimum ? value : fallback
)

export const createAuditQueryDescriptor = (
  query: Partial<AuditQueryDescriptor> = {},
): AuditQueryDescriptor => ({
  start_date: normalizeText(query.start_date),
  end_date: normalizeText(query.end_date),
  target_table: normalizeText(query.target_table),
  target_id: normalizeText(query.target_id),
  limit: Math.min(AUDIT_MAX_LIMIT, normalizeInteger(query.limit, AUDIT_DEFAULT_LIMIT, AUDIT_MIN_LIMIT)),
  offset: normalizeInteger(query.offset, 0, 0),
})

export const getAuditQueryKey = (descriptor: AuditQueryDescriptor) => [
  'audit',
  descriptor.start_date,
  descriptor.end_date,
  descriptor.target_table,
  descriptor.target_id,
  descriptor.limit,
  descriptor.offset,
] as const

export const buildAuditQueryUrl = (descriptor: AuditQueryDescriptor) => {
  const params = new URLSearchParams()
  if (descriptor.start_date) params.set('start_date', descriptor.start_date)
  if (descriptor.end_date) params.set('end_date', descriptor.end_date)
  if (descriptor.target_table) params.set('target_table', descriptor.target_table)
  if (descriptor.target_id) params.set('target_id', descriptor.target_id)
  params.set('limit', String(descriptor.limit))
  params.set('offset', String(descriptor.offset))
  return `/api/v1/audit?${params.toString()}`
}

const parseHeaderInteger = (headers: Headers, name: string, fallback: number, minimum: number, maximum?: number) => {
  const value = Number(headers.get(name))
  if (!Number.isInteger(value) || value < minimum || (maximum !== undefined && value > maximum)) return fallback
  return value
}

export const parseAuditScopeHeaders = (
  headers: Headers,
  fallback: Pick<AuditQueryDescriptor, 'limit' | 'offset'> = { limit: AUDIT_DEFAULT_LIMIT, offset: 0 },
): AuditResultScope => {
  const limit = parseHeaderInteger(headers, 'X-SysGrid-Result-Limit', fallback.limit, AUDIT_MIN_LIMIT, AUDIT_MAX_LIMIT)
  const offset = parseHeaderInteger(headers, 'X-SysGrid-Result-Offset', fallback.offset, 0)
  const hasMore = headers.get('X-SysGrid-Result-Has-More') === 'true'
  const complete = headers.get('X-SysGrid-Result-Complete') === 'true' && !hasMore && offset === 0
  return {
    scope: 'bounded',
    limit,
    offset,
    hasMore,
    complete,
  }
}

export const parseAuditResponse = async <T = Record<string, unknown>>(
  response: Response,
  descriptor: AuditQueryDescriptor,
): Promise<AuditQueryResult<T>> => {
  const body = await response.json()
  return {
    items: Array.isArray(body) ? body as T[] : [],
    scope: parseAuditScopeHeaders(response.headers, descriptor),
  }
}
