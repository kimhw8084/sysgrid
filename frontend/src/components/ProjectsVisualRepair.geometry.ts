/** Pure, timezone-stable geometry. No DOM access or scheduling/persistence authority. */
export const DAY_MS = 86400000
export const AXIS_HEIGHT = 64
export const MIN_LABEL_WIDTH = 76
export type AxisCell = { start: number; end: number; label: string; major: string }
const ordinal = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m, d) / DAY_MS)
const date = (n: number) => new Date(n * DAY_MS)
const shortMonth = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' })
export function fitScale(spanDays: number, viewport: number, rail: number) {
  return Math.max(0.000001, (Math.max(1, viewport - rail) - 2) / Math.max(1, spanDays))
}
export function taskGeometry(row: {startOrdinal: number | null; endOrdinal: number | null; milestone?: boolean}, rangeStart: number, scale: number) {
  const start = row.startOrdinal
  if (start == null || row.endOrdinal == null) return { left: 0, width: 0, start: 0, finish: 0, point: 0 }
  const left = (start - rangeStart) * scale
  if (row.milestone) {
    const point = left + scale / 2
    return { left: point - 10, width: 20, start: point, finish: point, point }
  }
  const width = Math.max(2, (row.endOrdinal - start + 1) * scale)
  return { left, width, start: left, finish: left + width, point: left + width / 2 }
}
/** Calendar-aligned intervals; never approximate a month as thirty days. */
export function axisCells(rangeStart: number, rangeEnd: number, scale: number, offset: number, viewport: number): AxisCell[] {
  const first = Math.max(rangeStart, rangeStart + Math.floor(Math.max(0, offset) / scale))
  const last = Math.min(rangeEnd + 1, rangeStart + Math.ceil((Math.max(0, offset) + viewport) / scale))
  const minDays = MIN_LABEL_WIDTH / Math.max(0.000001, scale)
  let unit: 'day' | 'week' | 'month' | 'quarter' | 'year' = minDays <= 1 ? 'day' : minDays <= 7 ? 'week' : minDays <= 28 ? 'month' : minDays <= 89 ? 'quarter' : 'year'
  let cursor = first
  const d = date(first), y = d.getUTCFullYear(), m = d.getUTCMonth()
  let years = Math.max(1, Math.ceil(minDays / 365))
  if (unit === 'week') cursor -= (d.getUTCDay() + 6) % 7
  if (unit === 'month') cursor = ordinal(y, m, 1)
  if (unit === 'quarter') cursor = ordinal(y, Math.floor(m / 3) * 3, 1)
  if (unit === 'year') cursor = ordinal(Math.floor(y / years) * years, 0, 1)
  const result: AxisCell[] = []
  let previousMajor = ''
  for (let i = 0; cursor <= last && i < 30; i++) {
    const d = date(cursor), y = d.getUTCFullYear(), m = d.getUTCMonth()
    const end = unit === 'day' ? cursor + 1 : unit === 'week' ? cursor + 7 : unit === 'month' ? ordinal(y, m + 1, 1) : unit === 'quarter' ? ordinal(y, m + 3, 1) : ordinal(y + years, 0, 1)
    const month = shortMonth.format(d)
    const label = unit === 'day' ? `${month} ${d.getUTCDate()}` : unit === 'week' ? `${month} ${d.getUTCDate()}` : unit === 'month' ? month : unit === 'quarter' ? `Q${Math.floor(m / 3) + 1}` : years > 1 ? `${y}–${y + years - 1}` : String(y)
    const majorLabel = unit === 'day' || unit === 'week' ? `${month} ${y}` : String(y)
    const major = majorLabel === previousMajor ? '' : majorLabel
    previousMajor = majorLabel
    result.push({ start: cursor, end, label, major })
    cursor = end
  }
  return result
}
export const canonicalTaskStatus = (value: unknown): string => {
  const raw = String(value ?? '').trim()
  const canonical: Record<string, string> = { 'done': 'Completed', 'completed': 'Completed', 'to do': 'To Do', 'in progress': 'In Progress', 'blocked': 'Blocked', 'review': 'Review' }
  return canonical[raw.toLowerCase()] ?? raw
}
export function readableProjectDate(value: unknown): string {
  const s = String(value ?? '')
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!match) return s || 'Not scheduled'
  const d = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]))
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d)
}
