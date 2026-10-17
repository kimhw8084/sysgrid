import { describe, expect, it } from 'vitest'
import { sanitizeMonitoringPayload } from './monitoring'

describe('sanitizeMonitoringPayload', () => {
  it('returns the original falsy payload unchanged', () => {
    expect(sanitizeMonitoringPayload(null)).toBeNull()
  })

  it('removes transient fields and normalizes nested monitoring data', () => {
    const sanitized = sanitizeMonitoringPayload({
      id: 10,
      created_at: 'now',
      updated_at: 'later',
      version: 2,
      edit_revision: 'server-owned-revision',
      expected_revision: 'stale-untrusted-input',
      is_deleted: false,
      device_name: 'db-01',
      recovery_doc_titles: ['Runbook'],
      recovery_doc_details: ['Step 1'],
      monitored_service_names: ['Payments'],
      logic_json: [{ id: 'rule-17', value: 'x' }, { id: 3, value: 'y' }],
      owners: [{ operator_id: '7', label: 'On Call' }, { operator_id: null, label: 'Skip' }],
      recovery_docs: [2, { id: '8', note: 'new', added_at: 'today' }],
    })

    expect(sanitized).toEqual({
      id: 10,
      logic_json: [{ id: 17, value: 'x' }, { id: 3, value: 'y' }],
      owners: [{ operator_id: 7, label: 'On Call' }],
      recovery_docs: [
        { id: 2 },
        { id: 8, note: 'new', added_at: 'today' },
      ],
    })
  })

  it('normalizes sparse nested values without crashing', () => {
    const sanitized = sanitizeMonitoringPayload({
      logic_json: [{ id: 'rule-x', value: 'x' }],
      owners: [{ operator_id: undefined, label: 'Skip' }, { operator_id: '3', label: 'Keep' }],
      recovery_docs: [{ id: '4' }, { id: 5, note: undefined, added_at: undefined }],
    })

    expect(sanitized).toEqual({
      logic_json: [{ id: 0, value: 'x' }],
      owners: [{ operator_id: 3, label: 'Keep' }],
      recovery_docs: [
        { id: 4, note: '', added_at: null },
        { id: 5, note: '', added_at: null },
      ],
    })
  })

  it('leaves non-array nested fields unchanged', () => {
    expect(sanitizeMonitoringPayload({
      logic_json: { id: 'skip' },
      owners: { operator_id: '7' },
      recovery_docs: 'skip',
    })).toEqual({
      logic_json: { id: 'skip' },
      owners: { operator_id: '7' },
      recovery_docs: 'skip',
    })
  })
})
