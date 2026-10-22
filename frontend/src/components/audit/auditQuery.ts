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
  start_at: string
  end_before: string
  local_start_date: string
  local_end_date: string
  range_error: string
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
  start_at: normalizeText(query.start_at),
  end_before: normalizeText(query.end_before),
  local_start_date: normalizeText(query.local_start_date),
  local_end_date: normalizeText(query.local_end_date),
  range_error: normalizeText(query.range_error),
  target_table: normalizeText(query.target_table),
  target_id: normalizeText(query.target_id),
  limit: Math.min(AUDIT_MAX_LIMIT, normalizeInteger(query.limit, AUDIT_DEFAULT_LIMIT, AUDIT_MIN_LIMIT)),
  offset: normalizeInteger(query.offset, 0, 0),
})

export const getAuditQueryKey = (descriptor: AuditQueryDescriptor) => [
  'audit',
  descriptor.start_date,
  descriptor.end_date,
  descriptor.start_at,
  descriptor.end_before,
  descriptor.local_start_date,
  descriptor.local_end_date,
  descriptor.range_error,
  descriptor.target_table,
  descriptor.target_id,
  descriptor.limit,
  descriptor.offset,
] as const

export const buildAuditQueryUrl = (descriptor: AuditQueryDescriptor) => {
  if (descriptor.range_error) throw new Error(descriptor.range_error)
  if ((descriptor.start_at || descriptor.end_before) && (descriptor.start_date || descriptor.end_date)) {
    throw new Error('Use either calendar dates or explicit instants, not both')
  }
  const params = new URLSearchParams()
  if (descriptor.start_date) params.set('start_date', descriptor.start_date)
  if (descriptor.end_date) params.set('end_date', descriptor.end_date)
  if (descriptor.start_at) params.set('start_at', descriptor.start_at)
  if (descriptor.end_before) params.set('end_before', descriptor.end_before)
  if (descriptor.target_table) params.set('target_table', descriptor.target_table)
  if (descriptor.target_id) params.set('target_id', descriptor.target_id)
  params.set('limit', String(descriptor.limit))
  params.set('offset', String(descriptor.offset))
  return `/api/v1/audit?${params.toString()}`
}

const parseCalendarDay = (value: string) => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!parts) return null
  const [year, month, day] = parts.slice(1).map(Number)
  if (year < 1) return null
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null
}

const localMidnight = (calendar: Date, dayOffset: number) => {
  const day = new Date(calendar.getTime())
  day.setUTCDate(day.getUTCDate() + dayOffset)
  const local = new Date(0)
  local.setFullYear(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())
  local.setHours(0, 0, 0, 0)
  return local
}

const utcYearBoundary = (year: number) => {
  const date = new Date(0)
  date.setUTCFullYear(year, 0, 1)
  date.setUTCHours(0, 0, 0, 0)
  return date.getTime()
}

export const createLocalAuditQueryDescriptor = (query: Partial<AuditQueryDescriptor> = {}): AuditQueryDescriptor => {
  const start = normalizeText(query.start_date)
  const end = normalizeText(query.end_date)
  const startDay = start ? parseCalendarDay(start) : null
  const endDay = end ? parseCalendarDay(end) : null
  const error = (start && !startDay) || (end && !endDay)
    ? 'Choose valid calendar dates within years 1–9999.'
    : start && end && start > end ? 'Start date must be on or before end date.' : ''
  const descriptor = createAuditQueryDescriptor({ ...query, start_date: '', end_date: '', start_at: '', end_before: '', local_start_date: start, local_end_date: end, range_error: error })
  if (error) return descriptor
  const minimum = utcYearBoundary(1)
  if (startDay) descriptor.start_at = new Date(Math.max(minimum, localMidnight(startDay, 0).getTime())).toISOString()
  if (endDay) {
    const upper = localMidnight(endDay, 1).getTime()
    // No representable backend instant reaches the following UTC year.
    // Omitting this upper bound preserves the final stored microsecond.
    if (upper < utcYearBoundary(10000)) descriptor.end_before = new Date(Math.max(minimum, upper)).toISOString()
  }
  return descriptor
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
