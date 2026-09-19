export type BrowserRequestDescriptor = {
  method: string
  url: string
  resourceType?: string
}

export type BrowserResponseDescriptor = {
  method: string
  url: string
  status: number
  state: string
}

/** Only the exact, privacy-safe telemetry endpoint may be absent in a test. */
export const isExpectedTelemetryRequest = ({ method, url, resourceType }: BrowserRequestDescriptor): boolean => {
  try {
    const parsed = new URL(url, 'http://localhost')
    return method.toUpperCase() === 'POST'
      && parsed.pathname === '/api/v1/observability/performance'
      && (resourceType == null || ['beacon', 'ping', 'fetch', 'xhr'].includes(resourceType))
  } catch {
    return false
  }
}

export const isUnexpectedConsoleError = (_message: string): boolean => true

/**
 * The matrix intentionally exercises the unavailable state with one mocked
 * 503. Playwright reports that expected HTTP response as a console resource
 * error; only this exact response may be recorded as an allowed exception.
 */
export const isExpectedUnavailableConsoleError = (message: string, response: BrowserResponseDescriptor): boolean => {
  try {
    const parsed = new URL(response.url, 'http://localhost')
    return message === 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)'
      && response.method.toUpperCase() === 'GET'
      && parsed.pathname === '/api/v2/projects'
      && response.status === 503
      && response.state === 'unavailable'
  } catch {
    return false
  }
}
