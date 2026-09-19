export type MonitoringFormErrors = Record<string, string>
import { MONITORING_NUMERIC_FIELDS } from '../domain/monitoringContract'

const MONITORING_REQUIRED_FIELD_NAMES = new Set(['title', 'category', 'status', 'severity', 'check_interval', 'alert_duration', 'notification_throttle'])
export const isMonitoringFieldRequired = (name: string) => MONITORING_REQUIRED_FIELD_NAMES.has(name)

export const buildMonitoringFormErrors = (
  formData: any
) => {
  const errors: MonitoringFormErrors = {}
  const unsafeUrlPattern = /[<>"']|javascript:|data:|vbscript:/i

  if (isMonitoringFieldRequired('title') && !formData.title?.trim()) errors.title = 'Title is required.'
  if (isMonitoringFieldRequired('category') && !formData.category) errors.category = 'Category is required.'
  if (isMonitoringFieldRequired('status') && !formData.status) errors.status = 'Status is required.'
  if (isMonitoringFieldRequired('severity') && !formData.severity) errors.severity = 'Severity is required.'

  for (const [fieldName, field] of Object.entries(MONITORING_NUMERIC_FIELDS)) {
    const value = formData[fieldName]
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
      errors[fieldName] = `${field.label} must be a finite integer number of seconds.`
      continue
    }
    if (value < field.min || value > field.max) {
      errors[fieldName] = `${field.label} must be between ${field.min} and ${field.max} seconds.`
    }
  }

  if (formData.monitoring_url) {
    try {
      const parsed = new URL(formData.monitoring_url)
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
        errors.monitoring_url = 'Monitoring URL must use http/https and include a host.'
      }
    } catch {
      errors.monitoring_url = 'Monitoring URL must be a valid http/https URL.'
    }
    if (unsafeUrlPattern.test(formData.monitoring_url)) {
      errors.monitoring_url = 'Monitoring URL contains unsafe content.'
    }
  }
  
  return errors
}

export const getMonitoringTabErrorCounts = (errors: MonitoringFormErrors) => ({
  context: Object.keys(errors).filter((key) => ['title', 'category', 'status', 'owner_team', 'owners', 'ownership', 'monitoring_url'].includes(key)).length,
  logic: Object.keys(errors).filter((key) => ['check_interval', 'alert_duration'].includes(key) || key.startsWith('logic_')).length,
  alerting: Object.keys(errors).filter((key) => ['severity', 'notification_method', 'notification_throttle', 'recovery_docs'].includes(key)).length,
})
