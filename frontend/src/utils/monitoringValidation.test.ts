import { describe, expect, it } from 'vitest'
import { buildMonitoringFormErrors, getMonitoringTabErrorCounts, isMonitoringFieldRequired } from './monitoringValidation'
import {
  ALERT_DURATION_MAX,
  ALERT_DURATION_MIN,
  CHECK_INTERVAL_MAX,
  CHECK_INTERVAL_MIN,
  NOTIFICATION_THROTTLE_MAX,
  NOTIFICATION_THROTTLE_MIN,
} from '../domain/monitoringContract'

const validNumericFields = {
  check_interval: CHECK_INTERVAL_MIN,
  alert_duration: ALERT_DURATION_MIN,
  notification_throttle: NOTIFICATION_THROTTLE_MIN,
}

describe('monitoringValidation', () => {
  it('tracks the required fields used by the monitoring form', () => {
    expect(isMonitoringFieldRequired('title')).toBe(true)
    expect(isMonitoringFieldRequired('severity')).toBe(true)
    expect(isMonitoringFieldRequired('owner_team')).toBe(false)
  })

  it('builds validation errors for missing required fields and unsafe URLs', () => {
    const errors = buildMonitoringFormErrors({
      title: '   ',
      category: '',
      status: '',
      severity: '',
      ...validNumericFields,
      monitoring_url: 'javascript:alert(1)',
    })

    expect(errors).toMatchObject({
      title: 'Title is required.',
      category: 'Category is required.',
      status: 'Status is required.',
      severity: 'Severity is required.',
      monitoring_url: 'Monitoring URL contains unsafe content.',
    })
  })

  it('accepts valid http and https URLs', () => {
    expect(buildMonitoringFormErrors({ title: 'Title', category: 'infra', status: 'Live', severity: 'High', ...validNumericFields, monitoring_url: 'https://example.com/path' })).toEqual({})
    expect(buildMonitoringFormErrors({ title: 'Title', category: 'infra', status: 'Live', severity: 'High', ...validNumericFields, monitoring_url: 'http://example.com' })).toEqual({})
  })

  it('reports malformed monitoring URLs that fail URL parsing', () => {
    expect(buildMonitoringFormErrors({
      title: 'Title',
      category: 'infra',
      status: 'Live',
      severity: 'High',
      ...validNumericFields,
      monitoring_url: 'http://',
    })).toEqual({
      monitoring_url: 'Monitoring URL must be a valid http/https URL.',
    })
  })

  it('accepts inclusive numeric contract boundaries', () => {
    expect(buildMonitoringFormErrors({ title: 'Title', category: 'infra', status: 'Live', severity: 'High', check_interval: CHECK_INTERVAL_MIN, alert_duration: ALERT_DURATION_MIN, notification_throttle: NOTIFICATION_THROTTLE_MIN })).not.toHaveProperty('check_interval')
    expect(buildMonitoringFormErrors({ title: 'Title', category: 'infra', status: 'Live', severity: 'High', check_interval: CHECK_INTERVAL_MAX, alert_duration: ALERT_DURATION_MAX, notification_throttle: NOTIFICATION_THROTTLE_MAX })).toEqual({})
  })

  it('rejects missing, fractional, non-finite, and out-of-range numeric values', () => {
    const errors = buildMonitoringFormErrors({
      title: 'Title',
      category: 'infra',
      status: 'Live',
      severity: 'High',
      check_interval: CHECK_INTERVAL_MIN - 1,
      alert_duration: 1.5,
      notification_throttle: Number.NaN,
    })
    expect(errors.check_interval).toContain('between')
    expect(errors.alert_duration).toContain('finite integer')
    expect(errors.notification_throttle).toContain('finite integer')
    expect(buildMonitoringFormErrors({ title: 'Title', category: 'infra', status: 'Live', severity: 'High' })).toMatchObject({
      check_interval: expect.stringContaining('finite integer'),
      alert_duration: expect.stringContaining('finite integer'),
      notification_throttle: expect.stringContaining('finite integer'),
    })
  })

  it('groups errors by tab for focused form feedback', () => {
    const counts = getMonitoringTabErrorCounts({
      title: 'required',
      owner_team: 'required',
      monitoring_url: 'invalid',
      check_interval: 'required',
      logic_rule: 'broken',
      severity: 'required',
      notification_method: 'required',
      recovery_docs: 'required',
    })

    expect(counts).toEqual({
      context: 3,
      logic: 2,
      alerting: 3,
    })
  })
})
