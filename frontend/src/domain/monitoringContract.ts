import contract from '../../../contracts/monitoring_domain_contract_v1.json'

type MonitoringBound = { min: number; max: number }
type MonitoringContractShape = {
  bounds: {
    check_interval_seconds: MonitoringBound
    alert_duration_seconds: MonitoringBound
    notification_throttle_seconds: MonitoringBound
  }
}

const monitoringContract = contract as MonitoringContractShape

export const MONITORING_CONTRACT_ID = contract.contract_id
export const MONITORING_CONTRACT_VERSION = contract.version
export const MONITORING_SECONDS_UNIT = contract.value_semantics.unit

export const CHECK_INTERVAL_MIN = monitoringContract.bounds.check_interval_seconds.min
export const CHECK_INTERVAL_MAX = monitoringContract.bounds.check_interval_seconds.max
export const ALERT_DURATION_MIN = monitoringContract.bounds.alert_duration_seconds.min
export const ALERT_DURATION_MAX = monitoringContract.bounds.alert_duration_seconds.max
export const NOTIFICATION_THROTTLE_MIN = monitoringContract.bounds.notification_throttle_seconds.min
export const NOTIFICATION_THROTTLE_MAX = monitoringContract.bounds.notification_throttle_seconds.max

export const CHECK_INTERVAL_SECONDS_MIN = CHECK_INTERVAL_MIN
export const CHECK_INTERVAL_SECONDS_MAX = CHECK_INTERVAL_MAX
export const ALERT_DURATION_SECONDS_MIN = ALERT_DURATION_MIN
export const ALERT_DURATION_SECONDS_MAX = ALERT_DURATION_MAX
export const NOTIFICATION_THROTTLE_SECONDS_MIN = NOTIFICATION_THROTTLE_MIN
export const NOTIFICATION_THROTTLE_SECONDS_MAX = NOTIFICATION_THROTTLE_MAX

export const MONITORING_NUMERIC_FIELDS = {
  check_interval: {
    label: 'Check interval',
    min: CHECK_INTERVAL_MIN,
    max: CHECK_INTERVAL_MAX,
  },
  alert_duration: {
    label: 'Alert duration',
    min: ALERT_DURATION_MIN,
    max: ALERT_DURATION_MAX,
  },
  notification_throttle: {
    label: 'Notification throttle',
    min: NOTIFICATION_THROTTLE_MIN,
    max: NOTIFICATION_THROTTLE_MAX,
  },
} as const
