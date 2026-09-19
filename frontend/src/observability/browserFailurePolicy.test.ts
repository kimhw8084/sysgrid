import { describe, expect, it } from 'vitest'
import { isExpectedTelemetryRequest, isExpectedUnavailableConsoleError, isUnexpectedConsoleError } from './browserFailurePolicy'

describe('browser failure classification', () => {
  it('allows only the exact telemetry beacon', () => {
    expect(isExpectedTelemetryRequest({ method: 'POST', url: 'http://test/api/v1/observability/performance', resourceType: 'beacon' })).toBe(true)
    expect(isExpectedTelemetryRequest({ method: 'POST', url: 'http://test/api/v1/observability/performance', resourceType: 'ping' })).toBe(true)
    expect(isExpectedTelemetryRequest({ method: 'POST', url: 'http://test/api/v1/observability/performance?x=1', resourceType: 'fetch' })).toBe(true)
    expect(isExpectedTelemetryRequest({ method: 'GET', url: 'http://test/api/v1/observability/performance', resourceType: 'fetch' })).toBe(false)
    expect(isExpectedTelemetryRequest({ method: 'POST', url: 'http://test/api/v1/projects', resourceType: 'fetch' })).toBe(false)
    expect(isExpectedTelemetryRequest({ method: 'POST', url: 'http://test/api/v1/observability/performance', resourceType: 'document' })).toBe(false)
  })

  it('does not suppress arbitrary console resource failures', () => {
    expect(isUnexpectedConsoleError('Failed to load resource: net::ERR_FAILED')).toBe(true)
    expect(isUnexpectedConsoleError('Failed to load resource: the server responded with a status of 404')).toBe(true)
  })

  it('keeps missing chunks, APIs, stylesheets, arbitrary 404s and 500s outside the allowlist', () => {
    const failures = [
      { method: 'GET', url: 'http://test/assets/index.js', resourceType: 'script' },
      { method: 'GET', url: 'http://test/api/v2/projects', resourceType: 'fetch' },
      { method: 'GET', url: 'http://test/assets/index.css', resourceType: 'stylesheet' },
      { method: 'GET', url: 'http://test/not-found', resourceType: 'document' },
      { method: 'GET', url: 'http://test/server-error', resourceType: 'fetch' },
      { method: 'POST', url: 'http://test/api/v1/observability/other', resourceType: 'beacon' },
    ] as const
    for (const failure of failures) expect(isExpectedTelemetryRequest(failure)).toBe(false)
  })

  it('allows only the intentional unavailable-state project response console error', () => {
    const response = { method: 'GET', url: 'http://test/api/v2/projects', status: 503, state: 'unavailable' }
    expect(isExpectedUnavailableConsoleError('Failed to load resource: the server responded with a status of 503 (Service Unavailable)', response)).toBe(true)
    expect(isExpectedUnavailableConsoleError('Failed to load resource: the server responded with a status of 503 (Service Unavailable)', { ...response, state: 'typical' })).toBe(false)
    expect(isExpectedUnavailableConsoleError('Failed to load resource: the server responded with a status of 503 (Service Unavailable)', { ...response, url: 'http://test/assets/index.js' })).toBe(false)
    expect(isExpectedUnavailableConsoleError('Failed to load resource: the server responded with a status of 404 (Not Found)', response)).toBe(false)
  })
})
