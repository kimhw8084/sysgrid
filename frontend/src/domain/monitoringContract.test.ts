import { describe, expect, it } from 'vitest'
import contract from '../../../contracts/monitoring_domain_contract_v1.json'
import {
  ALERT_DURATION_MAX,
  ALERT_DURATION_MIN,
  CHECK_INTERVAL_MAX,
  CHECK_INTERVAL_MIN,
  NOTIFICATION_THROTTLE_MAX,
  NOTIFICATION_THROTTLE_MIN,
} from './monitoringContract'

describe('monitoring domain contract', () => {
  it('exports exact values from the neutral JSON contract', () => {
    expect({ min: CHECK_INTERVAL_MIN, max: CHECK_INTERVAL_MAX }).toEqual(contract.bounds.check_interval_seconds)
    expect({ min: ALERT_DURATION_MIN, max: ALERT_DURATION_MAX }).toEqual(contract.bounds.alert_duration_seconds)
    expect({ min: NOTIFICATION_THROTTLE_MIN, max: NOTIFICATION_THROTTLE_MAX }).toEqual(contract.bounds.notification_throttle_seconds)
    expect(contract.value_semantics).toMatchObject({ unit: 'seconds', type: 'integer' })
  })
})
