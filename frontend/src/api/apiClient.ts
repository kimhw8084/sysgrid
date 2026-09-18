import { recordApiTiming } from '../observability/pv1Performance'

function normalizeApiBaseUrl(url: string | null | undefined): string {
  const trimmed = (url || '').trim()
  if (!trimmed) return ''
  return trimmed
    .replace(/\/api\/v1\/?$/i, '')
    .replace(/\/$/, '')
}

function isLikelyForwardedHost(hostname: string): boolean {
  return !/^(127\.0\.0\.1|localhost)$/i.test(hostname) && hostname.includes('.')
}

function isLoopbackOrigin(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(normalizeApiBaseUrl(url))
}

function validateConfiguredApiBaseUrl(baseUrl: string) {
  if (!baseUrl) return null
  const trimmed = baseUrl.trim()
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) {
    return null
  }
  return `Configured API base "${trimmed}" is invalid. Use the backend origin only, for example https://backend.example.com, or leave it blank for same-origin routing.`
}

export function getApiBaseUrl() {
  return normalizeApiBaseUrl(
    localStorage.getItem('SYSGRID_OVERRIDE_API_URL') ||
    localStorage.getItem('SYSGRID_CONFIG_VITE_API_BASE_URL') ||
    import.meta.env.VITE_API_BASE_URL ||
    ''
  )
}

export function getConfig(key: string, defaultValue: string = ''): string {
  const viteKey = key.startsWith('VITE_') ? key : `VITE_${key}`;
  const bootstrapVal = localStorage.getItem(`SYSGRID_CONFIG_${viteKey}`);
  if (bootstrapVal !== null) return bootstrapVal;
  return (import.meta.env as any)[viteKey] || defaultValue;
}

export function setApiOverride(url: string | null) {
  const normalized = normalizeApiBaseUrl(url)
  if (normalized) {
    localStorage.setItem('SYSGRID_OVERRIDE_API_URL', normalized);
  } else {
    localStorage.removeItem('SYSGRID_OVERRIDE_API_URL');
  }
}


function decorateApiError(
  error: any,
  details: {
    url?: string
    method?: string
    status?: number
    statusText?: string
    contentType?: string
    redirected?: boolean
    finalUrl?: string
    requestId?: string
    rawBody?: string
  } = {},
) {
  error.status = Number(details.status ?? error.status ?? 0)
  error.statusText = details.statusText ?? error.statusText ?? ''
  error.url = details.url ?? error.url ?? ''
  error.finalUrl = details.finalUrl ?? error.finalUrl ?? error.url
  error.method = details.method ?? error.method ?? 'GET'
  error.contentType = details.contentType ?? error.contentType ?? ''
  error.redirected = Boolean(details.redirected ?? error.redirected)
  error.requestId = details.requestId ?? error.requestId ?? ''
  error.rawBody = String(details.rawBody ?? error.rawBody ?? '').slice(0, 2000)
  error.browserOrigin = typeof window === 'undefined' ? '' : window.location.origin
  error.configuredApiBase = getApiBaseUrl()
  error.timestamp = new Date().toISOString()
  error.browserOnline = typeof navigator === 'undefined' ? null : navigator.onLine
  if (!error.data) error.data = { detail: error.message }
  return error
}

function isWriteMethod(method: string) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

async function parseJsonResponse(response: Response) {
  const rawBody = await response.clone().text()
  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  const redirected = Boolean(response.redirected)
  const finalUrl = response.url || ''
  const looksLikeAuthRedirect = redirected && /oauth|gitlab|signin|sign-in|login/i.test(`${finalUrl} ${rawBody}`)

  if (looksLikeAuthRedirect) {
    const error = decorateApiError(
      new Error('Backend JSON request was redirected to OAuth or a login page.'),
      {
        status: response.status,
        statusText: response.statusText,
        url: finalUrl,
        finalUrl,
        contentType,
        redirected,
        requestId: response.headers.get('x-request-id') || '',
        rawBody,
      },
    )
    throw error
  }

  if (contentType.includes('application/json') || (!contentType && rawBody.trim().startsWith('{'))) {
    try {
      return rawBody ? JSON.parse(rawBody) : null
    } catch {
      const error = decorateApiError(
        new Error('Backend returned invalid JSON where JSON was expected.'),
        {
          status: response.status,
          statusText: response.statusText,
          url: finalUrl,
          finalUrl,
          contentType,
          redirected,
          requestId: response.headers.get('x-request-id') || '',
          rawBody,
        },
      )
      throw error
    }
  }

  const error = decorateApiError(
    new Error(`Backend returned ${contentType || 'non-JSON content'} where JSON was expected.`),
    {
      status: response.status,
      statusText: response.statusText,
      url: finalUrl,
      finalUrl,
      contentType,
      redirected,
      requestId: response.headers.get('x-request-id') || '',
      rawBody,
    },
  )
  throw error
}

let lastLatency = 0;
const latencyListeners: Array<(latency: number) => void> = [];

export function subscribeToLatency(listener: (latency: number) => void) {
  latencyListeners.push(listener);
  listener(lastLatency);
  return () => {
    const idx = latencyListeners.indexOf(listener);
    if (idx !== -1) latencyListeners.splice(idx, 1);
  };
}

function notifyLatency(latency: number) {
  lastLatency = latency;
  latencyListeners.forEach(listener => listener(latency));
}

function getCurrentUserId(): string {
  return (
    localStorage.getItem('SYSGRID_USER_ID') ||
    localStorage.getItem('SYSGRID_CONFIG_DEFAULT_USER_ID') ||
    'admin_root'
  )
}

function getIdentityMode(): string {
  return String(import.meta.env.VITE_IDENTITY_MODE || 'development').trim().toLowerCase()
}

function shouldAttachUserIdHeader(url: string): boolean {
  // In production the reverse proxy owns identity and must strip any client-supplied
  // identity header before injecting TRUSTED_PROXY_USER_HEADER.
  if (getIdentityMode() === 'trusted_proxy') return false

  const baseUrl = getApiBaseUrl()
  if (!url.startsWith('http')) return true
  if (baseUrl && url.startsWith(baseUrl)) return true

  try {
    const targetUrl = new URL(url, window.location.origin)
    if (targetUrl.origin === window.location.origin) return true
    const isLocal = targetUrl.hostname === 'localhost' || targetUrl.hostname === '127.0.0.1'
    return isLocal
  } catch {
    return true
  }
}

function resolveCredentialsMode(url: string): RequestCredentials {
  try {
    const targetUrl = new URL(url, window.location.origin)
    return targetUrl.origin === window.location.origin ? 'same-origin' : 'include'
  } catch {
    return 'same-origin'
  }
}

function getCurrentTenantId(): string {
  return (
    localStorage.getItem('SYSGRID_TENANT_ID') ||
    '1'
  )
}

export function getRequestScopeKey(): string {
  return `${getCurrentUserId()}::${getCurrentTenantId()}`
}

let lastRequestScopeKey = ''

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  const requestScopeKey = getRequestScopeKey()
  if (requestScopeKey !== lastRequestScopeKey) {
    const previousScopeKey = lastRequestScopeKey
    lastRequestScopeKey = requestScopeKey
    if (previousScopeKey && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sysgrid-scope-changed', {
        detail: { previousScopeKey, requestScopeKey },
      }))
    }
  }
  const baseUrl = getApiBaseUrl();
  const invalidApiBaseMessage = validateConfiguredApiBaseUrl(baseUrl)
  if (invalidApiBaseMessage && !endpoint.startsWith('http')) {
    throw decorateApiError(new Error(invalidApiBaseMessage), {
      status: 0,
      url: endpoint,
      method: String(options.method || 'GET').toUpperCase(),
    })
  }
  if (baseUrl && isLikelyForwardedHost(window.location.hostname) && isLoopbackOrigin(baseUrl) && !endpoint.startsWith('http')) {
    throw decorateApiError(
      new Error('Frontend origin mismatch: this UI is running on a hosted or company origin, but the configured API base still points to a loopback address.'),
      {
        status: 0,
        url: endpoint,
        method: String(options.method || 'GET').toUpperCase(),
      },
    )
  }
  
  // Better normalization: remove trailing slash before query params or at the end
  let normalizedEndpoint = endpoint;
  if (endpoint.includes('?')) {
    const [path, query] = endpoint.split('?');
    if (path.length > 1 && path.endsWith('/')) {
      normalizedEndpoint = path.slice(0, -1) + '?' + query;
    }
  } else if (endpoint.length > 1 && endpoint.endsWith('/')) {
    normalizedEndpoint = endpoint.slice(0, -1);
  }

  const url = (normalizedEndpoint.startsWith('http') || !baseUrl) 
    ? normalizedEndpoint 
    : `${baseUrl.replace(/\/$/, '')}/${normalizedEndpoint.replace(/^\//, '')}`;
  
  const headers: Record<string, string> = { ...options.headers } as any;
  const method = String(options.method || 'GET').toUpperCase()
  
  // Only attach explicit browser user identity on same-origin requests.
  if (shouldAttachUserIdHeader(url)) {
    headers['X-User-Id'] = getCurrentUserId();
    headers['X-Tenant-Id'] = getCurrentTenantId();
  }

  const hasBody = options.body != null
  const isBodylessReadRequest = (method === 'GET' || method === 'HEAD') && !hasBody

  // PV1 is online-first. A failed write is surfaced to the caller and is
  // never placed in a browser or query-library replay queue.
  if (isWriteMethod(method) && typeof navigator !== 'undefined' && navigator.onLine === false) {
    const offlineError = decorateApiError(new Error('Offline. The change was not sent; reconnect and review the current revision before retrying.'), {
      status: 0,
      url,
      finalUrl: url,
      method,
    })
    offlineError.offline = true
    throw offlineError
  }

  if (!isBodylessReadRequest && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const startTime = Date.now();
  let response: Response
  try {
    response = await fetch(url, {
      cache: 'no-store',
      credentials: resolveCredentialsMode(url),
      ...options,
      headers,
    });
  } catch (cause: any) {
    const elapsed = Date.now() - startTime
    notifyLatency(elapsed)
    recordApiTiming(url, method, elapsed)
    const message = cause?.message || 'Failed to fetch'
    throw decorateApiError(new Error(message), {
      status: 0,
      url,
      finalUrl: url,
      method,
    })
  }
  const elapsed = Date.now() - startTime
  notifyLatency(elapsed);
  const projectionLagHeader = response.headers.get('x-projection-lag-ms')
  const scheduleDurationHeader = response.headers.get('x-schedule-calculation-duration-ms')
  recordApiTiming(url, method, elapsed, response.status, {
    requestId: response.headers.get('x-request-id') || undefined,
    commandId: headers['Idempotency-Key'] || headers['X-Command-Id'] || undefined,
    projectionLagMs: projectionLagHeader == null ? undefined : Number(projectionLagHeader),
    scheduleCalculationVersion: response.headers.get('x-schedule-calculation-version') || undefined,
    scheduleCalculationDurationMs: scheduleDurationHeader == null ? undefined : Number(scheduleDurationHeader),
  })

  if (!response.ok) {
    let errorData: any = {};
    let rawBody = '';
    try {
      rawBody = await response.clone().text();
      errorData = JSON.parse(rawBody);
    } catch (e) {
      errorData = { detail: `API Error ${response.status}: ${response.statusText}`, raw: rawBody };
    }
    
    const errorMessage = errorData.detail || errorData.message || `API error: ${response.status}`;
    const error = decorateApiError(new Error(errorMessage), {
      status: response.status,
      statusText: response.statusText,
      url,
      finalUrl: response.url || url,
      method,
      contentType: response.headers.get('content-type') || '',
      redirected: response.redirected,
      requestId: response.headers.get('x-request-id') || '',
      rawBody,
    })
    error.data = errorData
    throw error;
  }

  return response;
}

export const apiClient = {
  get: (endpoint: string, options?: RequestInit) => apiFetch(endpoint, { ...options, method: 'GET' }).then(parseJsonResponse),
  post: (endpoint: string, body: any, options?: RequestInit) => apiFetch(endpoint, { ...options, method: 'POST', body: JSON.stringify(body) }).then(parseJsonResponse),
  put: (endpoint: string, body: any, options?: RequestInit) => apiFetch(endpoint, { ...options, method: 'PUT', body: JSON.stringify(body) }).then(parseJsonResponse),
  delete: (endpoint: string, options?: RequestInit) => apiFetch(endpoint, { ...options, method: 'DELETE' }).then(parseJsonResponse),
  patch: (endpoint: string, body: any, options?: RequestInit) => apiFetch(endpoint, { ...options, method: 'PATCH', body: JSON.stringify(body) }).then(parseJsonResponse),
};
