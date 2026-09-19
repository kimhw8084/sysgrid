import { describe, expect, it } from 'vitest'
import {
  buildAuditQueryUrl,
  createAuditQueryDescriptor,
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
})
