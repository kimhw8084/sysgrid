import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AUDIT_EXPORT_FILENAME_PREFIX,
  buildAuditExportFileName,
  buildAuditQueryUrl,
  createAuditQueryDescriptor,
  createLocalAuditQueryDescriptor,
  getAuditQueryKey,
  parseAuditScopeHeaders,
} from './auditQuery'

describe('audit query contract', () => {
  const descriptor = createAuditQueryDescriptor({
    start_date: '2026-09-01',
    end_date: '2026-09-19',
    target_table: 'devices',
    target_id: '42',
    limit: 25,
    offset: 50,
  })

  it('includes every scope input in the query key', () => {
    const key = getAuditQueryKey(descriptor)
    for (const field of ['start_date', 'end_date', 'target_table', 'target_id', 'limit', 'offset'] as const) {
      expect(key).toContain(descriptor[field])
    }
  })

  it('uses the same canonical inputs in the URL', () => {
    const url = new URL(buildAuditQueryUrl(descriptor), 'http://test')
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({
      start_date: '2026-09-01',
      end_date: '2026-09-19',
      target_table: 'devices',
      target_id: '42',
      limit: '25',
      offset: '50',
    })
  })

  it('safely parses incomplete and complete scope headers', () => {
    const incomplete = new Headers({
      'X-SysGrid-Result-Scope': 'bounded',
      'X-SysGrid-Result-Limit': '25',
      'X-SysGrid-Result-Offset': '0',
      'X-SysGrid-Result-Has-More': 'true',
      'X-SysGrid-Result-Complete': 'false',
    })
    expect(parseAuditScopeHeaders(incomplete, descriptor)).toEqual({ scope: 'bounded', limit: 25, offset: 0, hasMore: true, complete: false })

    const complete = new Headers({
      'X-SysGrid-Result-Limit': '25',
      'X-SysGrid-Result-Offset': '0',
      'X-SysGrid-Result-Has-More': 'false',
      'X-SysGrid-Result-Complete': 'true',
    })
    expect(parseAuditScopeHeaders(complete, descriptor).complete).toBe(true)
  })

  it('names exports as the currently loaded bounded result', () => {
    expect(buildAuditExportFileName(new Date('2026-09-19T12:00:00.000Z'))).toBe('SysGrid_AuditLoadedResult_2026-09-19.csv')
    expect(AUDIT_EXPORT_FILENAME_PREFIX).toContain('Loaded')
  })
})

describe('Audit local calendar boundaries', () => {
  afterEach(() => vi.unstubAllEnvs())

  it.each([
    ['America/Chicago', '2026-03-08', '2026-03-08T06:00:00.000Z', '2026-03-09T05:00:00.000Z', 23],
    ['America/Chicago', '2026-11-01', '2026-11-01T05:00:00.000Z', '2026-11-02T06:00:00.000Z', 25],
    ['Asia/Seoul', '2026-03-08', '2026-03-07T15:00:00.000Z', '2026-03-08T15:00:00.000Z', 24],
    ['UTC', '2024-02-29', '2024-02-29T00:00:00.000Z', '2024-03-01T00:00:00.000Z', 24],
    ['UTC', '2026-12-31', '2026-12-31T00:00:00.000Z', '2027-01-01T00:00:00.000Z', 24],
    ['UTC', '0001-01-01', '0001-01-01T00:00:00.000Z', '0001-01-02T00:00:00.000Z', 24],
    ['UTC', '0099-12-31', '0099-12-31T00:00:00.000Z', '0100-01-01T00:00:00.000Z', 24],
    ['Pacific/Apia', '2011-12-30', '2011-12-30T10:00:00.000Z', '2011-12-30T10:00:00.000Z', 0],
  ])('uses actual %s calendar midnights for %s', (zone, day, start, end, hours) => {
    vi.stubEnv('TZ', zone)
    const descriptor = createLocalAuditQueryDescriptor({ start_date: day, end_date: day, target_table: 'devices', target_id: '42', limit: 25, offset: 50 })
    expect(descriptor.range_error).toBe('')
    expect(descriptor.start_at).toBe(start)
    expect(descriptor.end_before).toBe(end)
    expect((Date.parse(descriptor.end_before) - Date.parse(descriptor.start_at)) / 3_600_000).toBe(Number(hours))
    expect(Object.fromEntries(new URL(buildAuditQueryUrl(descriptor), 'http://test').searchParams)).toEqual({ start_at: start, end_before: end, target_table: 'devices', target_id: '42', limit: '25', offset: '50' })
    for (const field of ['start_at', 'end_before', 'local_start_date', 'local_end_date', 'target_table', 'target_id', 'limit', 'offset'] as const) expect(getAuditQueryKey(descriptor)).toContain(descriptor[field])
  })

  it.each(['UTC', 'America/Chicago', 'Asia/Seoul'])('preserves representable endpoints in %s', zone => {
    vi.stubEnv('TZ', zone)
    const minimum = createLocalAuditQueryDescriptor({ start_date: '0001-01-01' })
    expect(minimum.range_error).toBe('')
    expect(minimum.start_at.startsWith('0001-01-01T')).toBe(true)
    const maximum = createLocalAuditQueryDescriptor({ start_date: '9999-12-31', end_date: '9999-12-31' })
    expect(maximum.range_error).toBe('')
    expect(maximum.start_at.startsWith('9999-12-')).toBe(true)
    expect(maximum.end_before).toBe(zone === 'Asia/Seoul' ? '9999-12-31T15:00:00.000Z' : '')
    expect(getAuditQueryKey(maximum)).toContain('9999-12-31')
  })

  it.each(['2026-02-30', '2026-13-01', '0000-01-01', '10000-01-01', 'not-a-date'])('never builds an unrestricted URL from invalid %s', day => {
    const descriptor = createLocalAuditQueryDescriptor({ start_date: day })
    expect(descriptor.range_error).not.toBe('')
    expect(getAuditQueryKey(descriptor)).toContain(day)
    expect(() => buildAuditQueryUrl(descriptor)).toThrow(descriptor.range_error)
  })

  it('separates invalid, reversed, partial and cleared input identities', () => {
    vi.stubEnv('TZ', 'UTC')
    const reversed = createLocalAuditQueryDescriptor({ start_date: '2026-03-09', end_date: '2026-03-08' })
    expect(reversed.range_error).toContain('on or before')
    expect(() => buildAuditQueryUrl(reversed)).toThrow()
    const partial = createLocalAuditQueryDescriptor({ end_date: '2026-03-08' })
    expect(partial.start_at).toBe('')
    expect(partial.end_before).toBe('2026-03-09T00:00:00.000Z')
    const cleared = createLocalAuditQueryDescriptor()
    expect(buildAuditQueryUrl(cleared)).toBe('/api/v1/audit?limit=200&offset=0')
    expect(getAuditQueryKey(cleared)).not.toEqual(getAuditQueryKey(partial))
    expect(getAuditQueryKey(cleared)).not.toEqual(getAuditQueryKey(reversed))
  })

  it('keeps explicit instant inputs in the URL and rejects mixed calendar inputs', () => {
    const instant = createAuditQueryDescriptor({ start_at: '2026-03-08T00:00:00+09:00' })
    expect(new URL(buildAuditQueryUrl(instant), 'http://test').searchParams.get('start_at')).toBe('2026-03-08T00:00:00+09:00')
    expect(() => buildAuditQueryUrl(createAuditQueryDescriptor({ ...instant, start_date: '2026-03-08' }))).toThrow('either calendar dates or explicit instants')
  })
})
