import { getApiBaseUrl } from '../../api/apiClient'
import { getCurrentTenantId } from '../../api/tenantContext'

export type DiagnosticVerdict = 'PASS' | 'PARTIAL' | 'FAIL'
export type DiagnosticState = 'idle' | 'running' | 'completed'

export interface DiagnosticLayerResult {
  verdict: DiagnosticVerdict
  message: string
}

export interface RequestTransportClassification {
  method: string
  customIdentityHeadersSent: boolean
  contentTypeHeaderSent: string | null
  likelySimpleRequest: boolean
  likelyPreflight: boolean
  explanation: string
}

export interface ExternalExportContractResult {
  status: DiagnosticVerdict
  state: Exclude<DiagnosticState, 'idle'>
  layer: string
  explanation: string
  recommendedFix: string
  frontendOrigin: string
  apiBase: string
  environmentMode: string
  manifestUrl: string
  csvUrl: string
  previewUrl: string
  manifest: DiagnosticLayerResult
  csvDownload: DiagnosticLayerResult
  headers: DiagnosticLayerResult
  filename: DiagnosticLayerResult
  importPreview: DiagnosticLayerResult
  statusCodes: {
    manifest: number | 'NETWORK_ERROR' | 'NOT_RUN'
    csv: number | 'NETWORK_ERROR' | 'NOT_RUN'
    preview: number | 'NETWORK_ERROR' | 'NOT_RUN'
  }
  redirectDetected: boolean
  headersReadable: boolean
  manifestFallbackUsed: boolean
  filenameValue: string | null
  schemaVersion: string | null
  profile: string | null
  exposeHeadersValue: string | null
  wildcardExposeHeadersDetected: boolean
  transport: {
    manifest: RequestTransportClassification
    csv: RequestTransportClassification
  }
  reportText: string
}

type ManifestPayload = {
  profile?: string
  schema_version?: string
  filename?: string
  download_url?: string
  scope?: string
  content_type?: string
}

type RuntimeRequestOptions = {
  fetchImpl?: typeof fetch
  frontendOrigin?: string
  apiBase?: string
  userId?: string
  tenantId?: string
}

type RequestResult = {
  ok: boolean
  status: number | 'NETWORK_ERROR'
  redirected: boolean
  finalUrl: string
  contentType: string | null
  headers: Headers | null
  json: any | null
  text: string | null
  blob: Blob | null
  error?: string
}

type RequestPlan = {
  method: string
  customIdentityHeadersSent: boolean
  contentTypeHeaderSent: string | null
  likelySimpleRequest: boolean
  likelyPreflight: boolean
  explanation: string
}

const EXPECTED_PROFILE = 'external_entities'
const EXPECTED_SCHEMA_VERSION = '2026-06-external-v1'
const EXPECTED_SCOPE = 'active'
const EXPECTED_CONTENT_TYPE = 'text/csv'
const FILENAME_PATTERN = /^SysGrid_External_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv$/

function normalizeContentType(contentType: string | null | undefined) {
  return (contentType || '').split(';')[0]?.trim().toLowerCase() || null
}

function parseFileNameFromContentDisposition(contentDisposition: string | null | undefined) {
  const match = contentDisposition?.match(/filename="?([^"]+)"?/)
  return match?.[1] || null
}

function buildAbsoluteApiUrl(endpoint: string, apiBase: string, frontendOrigin: string) {
  if (/^https?:\/\//i.test(endpoint)) return endpoint
  if (!apiBase) return new URL(endpoint, frontendOrigin).toString()
  return new URL(endpoint, apiBase.endsWith('/') ? apiBase : `${apiBase}/`).toString()
}

function sanitizeDiagnosticUrl(url: string) {
  if (!url) return url
  try {
    const parsed = new URL(url)
    return parsed.search ? `${parsed.origin}${parsed.pathname}?[redacted-query]` : `${parsed.origin}${parsed.pathname}`
  } catch {
    const [path, query] = url.split('?')
    return query ? `${path}?[redacted-query]` : url
  }
}

export function formatDiagnosticUrlForDisplay(url: string) {
  return sanitizeDiagnosticUrl(url)
}

function shouldAttachIdentityHeaders(targetUrl: string, frontendOrigin: string, apiBase: string) {
  if (!targetUrl.startsWith('http')) return true
  if (apiBase && targetUrl.startsWith(apiBase)) return true
  try {
    const resolved = new URL(targetUrl, frontendOrigin)
    if (resolved.origin === frontendOrigin) return true
    return resolved.hostname === 'localhost' || resolved.hostname === '127.0.0.1'
  } catch {
    return true
  }
}

function resolveCredentialsMode(targetUrl: string, frontendOrigin: string): RequestCredentials {
  try {
    const resolved = new URL(targetUrl, frontendOrigin)
    return resolved.origin === frontendOrigin ? 'same-origin' : 'include'
  } catch {
    return 'same-origin'
  }
}

function inferEnvironmentMode(frontendOrigin: string, apiBase: string) {
  if (!apiBase) return 'same-origin relative proxy'
  try {
    const apiUrl = new URL(apiBase, frontendOrigin)
    if (apiUrl.origin === frontendOrigin) return 'same-origin deployed/company domain'
    const isLocalFrontend = /^(localhost|127\.0\.0\.1)$/i.test(new URL(frontendOrigin).hostname)
    const isLocalApi = /^(localhost|127\.0\.0\.1)$/i.test(apiUrl.hostname)
    if (isLocalFrontend && isLocalApi) return 'local direct backend'
    return 'cross-origin company-domain proxy'
  } catch {
    return 'custom runtime'
  }
}

function isCrossOriginTarget(targetUrl: string, frontendOrigin: string) {
  try {
    const resolved = new URL(targetUrl, frontendOrigin)
    return resolved.origin !== frontendOrigin
  } catch {
    return false
  }
}

function buildRequestPlan(
  url: string,
  options: RequestInit,
  runtime: RuntimeRequestOptions & { frontendOrigin: string; apiBase: string }
): RequestPlan {
  const method = String(options.method || 'GET').toUpperCase()
  const headers = new Headers(options.headers || {})
  const customIdentityHeadersSent = shouldAttachIdentityHeaders(url, runtime.frontendOrigin, runtime.apiBase)
  if (customIdentityHeadersSent) {
    headers.set('X-User-Id', runtime.userId || localStorage.getItem('SYSGRID_USER_ID') || 'admin_root')
    headers.set('X-Tenant-Id', runtime.tenantId || getCurrentTenantId())
  }
  const contentTypeHeaderSent = headers.get('Content-Type') || headers.get('content-type')
  const crossOrigin = isCrossOriginTarget(url, runtime.frontendOrigin)
  const hasBody = options.body != null
  const simpleContentType = !contentTypeHeaderSent || ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'].includes(normalizeContentType(contentTypeHeaderSent) || '')
  const onlySimpleMethod = ['GET', 'HEAD', 'POST'].includes(method)
  const likelySimpleRequest = !crossOrigin || (onlySimpleMethod && !customIdentityHeadersSent && simpleContentType)
  const likelyPreflight = crossOrigin && !likelySimpleRequest
  const explanationParts = [
    crossOrigin ? 'cross-origin request' : 'same-origin request',
    customIdentityHeadersSent ? 'sends X-User-Id/X-Tenant-Id' : 'does not send custom identity headers',
    contentTypeHeaderSent ? `sends Content-Type ${contentTypeHeaderSent}` : 'does not send Content-Type',
    likelyPreflight ? 'likely triggers OPTIONS preflight' : 'likely stays a simple request',
  ]
  if (crossOrigin && customIdentityHeadersSent) {
    explanationParts.push('custom identity headers can force preflight')
  }
  return {
    method,
    customIdentityHeadersSent,
    contentTypeHeaderSent,
    likelySimpleRequest,
    likelyPreflight,
    explanation: explanationParts.join('; '),
  }
}

function detectAuthRedirect(result: RequestResult) {
  const finalUrl = (result.finalUrl || '').toLowerCase()
  const body = (result.text || '').toLowerCase()
  return (
    result.redirected &&
    (finalUrl.includes('oauth') || finalUrl.includes('gitlab') || body.includes('gitlab') || body.includes('sign in'))
  )
}

function buildFailureResult(base: Omit<ExternalExportContractResult, 'status' | 'state' | 'layer' | 'explanation' | 'recommendedFix' | 'reportText'> & {
  layer: string
  explanation: string
  recommendedFix: string
  status?: DiagnosticVerdict
}) {
  const result: ExternalExportContractResult = {
    ...base,
    status: base.status || 'FAIL',
    state: 'completed',
    layer: base.layer,
    explanation: base.explanation,
    recommendedFix: base.recommendedFix,
    reportText: '',
  }
  result.reportText = formatExternalExportContractReport(result)
  return result
}

async function requestRuntimeResource(
  url: string,
  options: RequestInit,
  runtime: RuntimeRequestOptions & { frontendOrigin: string; apiBase: string }
): Promise<RequestResult> {
  const fetchImpl = runtime.fetchImpl || fetch
  const requestPlan = buildRequestPlan(url, options, runtime)
  const headers = new Headers(options.headers || {})
  if (requestPlan.customIdentityHeadersSent) {
    headers.set('X-User-Id', runtime.userId || localStorage.getItem('SYSGRID_USER_ID') || 'admin_root')
    headers.set('X-Tenant-Id', runtime.tenantId || getCurrentTenantId())
  }

  try {
    const response = await fetchImpl(url, {
      cache: 'no-store',
      redirect: 'follow',
      credentials: resolveCredentialsMode(url, runtime.frontendOrigin),
      ...options,
      headers,
    })
    const contentType = normalizeContentType(response.headers.get('content-type'))
    let text: string | null = null
    let json: any | null = null
    let blob: Blob | null = null
    if (contentType === 'application/json') {
      text = await response.clone().text()
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = null
      }
    } else if (contentType === 'text/csv' || contentType === 'application/octet-stream') {
      blob = await response.clone().blob()
      text = await response.clone().text()
    } else {
      text = await response.clone().text()
      if (text && text.trim().startsWith('{')) {
        try {
          json = JSON.parse(text)
        } catch {
          json = null
        }
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      redirected: response.redirected,
      finalUrl: response.url || url,
      contentType,
      headers: response.headers,
      json,
      text,
      blob,
    }
  } catch (error: any) {
    return {
      ok: false,
      status: 'NETWORK_ERROR',
      redirected: false,
      finalUrl: url,
      contentType: null,
      headers: null,
      json: null,
      text: null,
      blob: null,
      error: error?.message || 'Network request failed',
    }
  }
}

function validateManifestPayload(manifest: ManifestPayload) {
  if (manifest.profile !== EXPECTED_PROFILE) return `Manifest profile was "${manifest.profile || 'missing'}".`
  if (manifest.schema_version !== EXPECTED_SCHEMA_VERSION) return `Manifest schema version was "${manifest.schema_version || 'missing'}".`
  if (manifest.scope !== EXPECTED_SCOPE) return `Manifest scope was "${manifest.scope || 'missing'}".`
  if (normalizeContentType(manifest.content_type) !== EXPECTED_CONTENT_TYPE) return `Manifest content type was "${manifest.content_type || 'missing'}".`
  if (!manifest.filename || !FILENAME_PATTERN.test(manifest.filename)) return 'Manifest filename did not match SysGrid_External_YYYY-MM-DD_HH-mm-ss.csv.'
  if (!manifest.download_url) return 'Manifest did not include a download URL.'
  return null
}

export function formatExternalExportContractReport(result: ExternalExportContractResult) {
  return [
    `External Export Contract: ${result.status}`,
    '',
    `Frontend Origin: ${result.frontendOrigin}`,
    `API Base: ${result.apiBase || '(relative proxy)'}`,
    `Environment Mode: ${result.environmentMode}`,
    `Manifest URL: ${sanitizeDiagnosticUrl(result.manifestUrl)}`,
    `CSV URL: ${sanitizeDiagnosticUrl(result.csvUrl)}`,
    `Preview URL: ${result.previewUrl}`,
    `Manifest Status: ${String(result.statusCodes.manifest)}`,
    `CSV Status: ${String(result.statusCodes.csv)}`,
    `Preview Status: ${String(result.statusCodes.preview)}`,
    `Redirect Detected: ${result.redirectDetected ? 'yes' : 'no'}`,
    `Headers Readable: ${result.headersReadable ? 'yes' : 'no'}`,
    `Manifest Fallback Used: ${result.manifestFallbackUsed ? 'yes' : 'no'}`,
    `Manifest Request: method=${result.transport.manifest.method}; custom_identity_headers=${result.transport.manifest.customIdentityHeadersSent ? 'yes' : 'no'}; content_type=${result.transport.manifest.contentTypeHeaderSent || 'none'}; likely_simple=${result.transport.manifest.likelySimpleRequest ? 'yes' : 'no'}; likely_preflight=${result.transport.manifest.likelyPreflight ? 'yes' : 'no'}`,
    `Manifest Request Notes: ${result.transport.manifest.explanation}`,
    `CSV Request: method=${result.transport.csv.method}; custom_identity_headers=${result.transport.csv.customIdentityHeadersSent ? 'yes' : 'no'}; content_type=${result.transport.csv.contentTypeHeaderSent || 'none'}; likely_simple=${result.transport.csv.likelySimpleRequest ? 'yes' : 'no'}; likely_preflight=${result.transport.csv.likelyPreflight ? 'yes' : 'no'}`,
    `CSV Request Notes: ${result.transport.csv.explanation}`,
    `Filename: ${result.filenameValue || 'missing'}`,
    `Schema Version: ${result.schemaVersion || 'missing'}`,
    `Profile: ${result.profile || 'missing'}`,
    `Expose Headers: ${result.exposeHeadersValue || 'missing'}`,
    `Wildcard Expose Headers: ${result.wildcardExposeHeadersDetected ? 'yes' : 'no'}`,
    `Layer: ${result.layer}`,
    `Manifest: ${result.manifest.verdict} — ${result.manifest.message}`,
    `CSV Download: ${result.csvDownload.verdict} — ${result.csvDownload.message}`,
    `Headers: ${result.headers.verdict} — ${result.headers.message}`,
    `Filename Check: ${result.filename.verdict} — ${result.filename.message}`,
    `Import Preview: ${result.importPreview.verdict} — ${result.importPreview.message}`,
    `Overall: ${result.status} — ${result.explanation}`,
    `Recommended Fix: ${result.recommendedFix}`,
  ].join('\n')
}

export async function runExternalExportContractCheck(options: RuntimeRequestOptions = {}): Promise<ExternalExportContractResult> {
  const frontendOrigin = options.frontendOrigin || window.location.origin
  const apiBase = options.apiBase ?? getApiBaseUrl()
  const environmentMode = inferEnvironmentMode(frontendOrigin, apiBase)
  const manifestUrl = buildAbsoluteApiUrl('/api/v1/import/snapshot/external_entities/manifest', apiBase, frontendOrigin)
  const previewUrl = buildAbsoluteApiUrl('/api/v1/import/preview-file', apiBase, frontendOrigin)
  const manifestTransport = buildRequestPlan(manifestUrl, { method: 'GET' }, { ...options, frontendOrigin, apiBase })

  const manifestResponse = await requestRuntimeResource(manifestUrl, { method: 'GET' }, { ...options, frontendOrigin, apiBase })
  const baseResult = {
    frontendOrigin,
    apiBase,
    environmentMode,
    manifestUrl,
    csvUrl: buildAbsoluteApiUrl('/api/v1/import/snapshot/external_entities', apiBase, frontendOrigin),
    previewUrl,
    manifest: { verdict: 'FAIL' as DiagnosticVerdict, message: 'Manifest was not checked.' },
    csvDownload: { verdict: 'FAIL' as DiagnosticVerdict, message: 'CSV download was not checked.' },
    headers: { verdict: 'FAIL' as DiagnosticVerdict, message: 'Headers were not checked.' },
    filename: { verdict: 'FAIL' as DiagnosticVerdict, message: 'Filename was not checked.' },
    importPreview: { verdict: 'PARTIAL' as DiagnosticVerdict, message: 'Import preview not run.' },
    statusCodes: {
      manifest: manifestResponse.status,
      csv: 'NOT_RUN' as const,
      preview: 'NOT_RUN' as const,
    },
    redirectDetected: manifestResponse.redirected,
    headersReadable: false,
    manifestFallbackUsed: false,
    filenameValue: null,
    schemaVersion: null,
    profile: null,
    exposeHeadersValue: null,
    wildcardExposeHeadersDetected: false,
    transport: {
      manifest: manifestTransport,
      csv: buildRequestPlan(buildAbsoluteApiUrl('/api/v1/import/snapshot/external_entities', apiBase, frontendOrigin), { method: 'GET' }, { ...options, frontendOrigin, apiBase }),
    },
  }

  if (manifestResponse.status === 'NETWORK_ERROR') {
    return buildFailureResult({
      ...baseResult,
      layer: 'API connectivity',
      explanation: `Manifest request failed before the browser received a response. ${manifestResponse.error || ''}`.trim(),
      recommendedFix: 'Ensure the configured API base is reachable from the browser runtime and not blocked by network or CORS policy.',
      manifest: { verdict: 'FAIL', message: manifestResponse.error || 'Network request failed.' },
      csvDownload: { verdict: 'PARTIAL', message: 'Skipped because manifest failed.' },
      headers: { verdict: 'PARTIAL', message: 'Skipped because manifest failed.' },
      filename: { verdict: 'PARTIAL', message: 'Skipped because manifest failed.' },
    })
  }

  if (detectAuthRedirect(manifestResponse)) {
    return buildFailureResult({
      ...baseResult,
      redirectDetected: true,
      layer: 'Auth / proxy routing',
      explanation: 'Manifest request was redirected to OAuth or a login page before reaching the SysGrid JSON contract.',
      recommendedFix: 'Ensure the authenticated browser session can access the API route, or configure proxy/API base so the app can reach the backend manifest endpoint.',
      manifest: { verdict: 'FAIL', message: 'Manifest request redirected before valid JSON contract was returned.' },
      csvDownload: { verdict: 'PARTIAL', message: 'Skipped because manifest failed.' },
      headers: { verdict: 'PARTIAL', message: 'Skipped because manifest failed.' },
      filename: { verdict: 'PARTIAL', message: 'Skipped because manifest failed.' },
    })
  }

  if (!manifestResponse.ok || !manifestResponse.json) {
    return buildFailureResult({
      ...baseResult,
      layer: 'Manifest endpoint',
      explanation: 'Manifest endpoint did not return a valid JSON contract from the actual browser runtime.',
      recommendedFix: 'Ensure the External manifest endpoint returns authenticated JSON at the configured API base.',
      manifest: { verdict: 'FAIL', message: `Manifest response status was ${String(manifestResponse.status)} with content type ${manifestResponse.contentType || 'missing'}.` },
      csvDownload: { verdict: 'PARTIAL', message: 'Skipped because manifest failed.' },
      headers: { verdict: 'PARTIAL', message: 'Skipped because manifest failed.' },
      filename: { verdict: 'PARTIAL', message: 'Skipped because manifest failed.' },
    })
  }

  const manifest = manifestResponse.json as ManifestPayload
  const manifestValidationError = validateManifestPayload(manifest)
  if (manifestValidationError) {
    return buildFailureResult({
      ...baseResult,
      profile: manifest.profile || null,
      schemaVersion: manifest.schema_version || null,
      filenameValue: manifest.filename || null,
      layer: 'Manifest contract',
      explanation: manifestValidationError,
      recommendedFix: 'Make the backend manifest return the exact External export contract: expected profile, schema version, active scope, content type, filename pattern, and download URL.',
      manifest: { verdict: 'FAIL', message: manifestValidationError },
      csvDownload: { verdict: 'PARTIAL', message: 'Skipped because manifest contract was invalid.' },
      headers: { verdict: 'PARTIAL', message: 'Skipped because manifest contract was invalid.' },
      filename: { verdict: 'FAIL', message: manifestValidationError },
    })
  }

  const csvUrl = buildAbsoluteApiUrl(manifest.download_url!, apiBase, frontendOrigin)
  const csvTransport = buildRequestPlan(csvUrl, { method: 'GET' }, { ...options, frontendOrigin, apiBase })
  const csvResponse = await requestRuntimeResource(csvUrl, { method: 'GET' }, { ...options, frontendOrigin, apiBase })
  const baseWithManifest = {
    ...baseResult,
    csvUrl,
    profile: manifest.profile || null,
    schemaVersion: manifest.schema_version || null,
    filenameValue: manifest.filename || null,
    manifest: { verdict: 'PASS' as DiagnosticVerdict, message: 'Manifest returned a valid backend-owned External export contract.' },
    statusCodes: {
      manifest: manifestResponse.status,
      csv: csvResponse.status,
      preview: 'NOT_RUN' as const,
    },
    redirectDetected: manifestResponse.redirected || csvResponse.redirected,
    transport: {
      manifest: manifestTransport,
      csv: csvTransport,
    },
  }

  if (csvResponse.status === 'NETWORK_ERROR') {
    return buildFailureResult({
      ...baseWithManifest,
      layer: 'CSV download',
      explanation: `CSV request failed before the browser received a response. ${csvResponse.error || ''}`.trim(),
      recommendedFix: 'Ensure the browser can reach the CSV download URL from the configured API base and that proxy/CORS policy permits the request.',
      csvDownload: { verdict: 'FAIL', message: csvResponse.error || 'CSV request failed.' },
      headers: { verdict: 'PARTIAL', message: 'Skipped because CSV download failed.' },
      filename: { verdict: 'PARTIAL', message: 'Skipped because CSV download failed.' },
    })
  }

  if (detectAuthRedirect(csvResponse)) {
    return buildFailureResult({
      ...baseWithManifest,
      redirectDetected: true,
      layer: 'Auth / proxy routing',
      explanation: 'CSV download request was redirected to OAuth or a login page before reaching the SysGrid CSV contract.',
      recommendedFix: 'Ensure authenticated browser access to the CSV route, or adjust proxy/API base so the app reaches the backend export endpoint directly.',
      csvDownload: { verdict: 'FAIL', message: 'CSV request redirected before valid CSV content was returned.' },
      headers: { verdict: 'PARTIAL', message: 'Skipped because CSV download redirected.' },
      filename: { verdict: 'PARTIAL', message: 'Skipped because CSV download redirected.' },
    })
  }

  if (!csvResponse.ok) {
    return buildFailureResult({
      ...baseWithManifest,
      layer: 'CSV download',
      explanation: `CSV endpoint returned status ${String(csvResponse.status)} from the actual browser runtime.`,
      recommendedFix: 'Ensure the backend export endpoint is reachable and returns a successful CSV response for authenticated browser requests.',
      csvDownload: { verdict: 'FAIL', message: `CSV response status was ${String(csvResponse.status)}.` },
      headers: { verdict: 'PARTIAL', message: 'Skipped because CSV download failed.' },
      filename: { verdict: 'PARTIAL', message: 'Skipped because CSV download failed.' },
    })
  }

  const csvContentType = normalizeContentType(csvResponse.contentType)
  if (csvContentType !== EXPECTED_CONTENT_TYPE) {
    return buildFailureResult({
      ...baseWithManifest,
      layer: 'CSV content type',
      explanation: `CSV endpoint returned content type "${csvResponse.contentType || 'missing'}" instead of text/csv.`,
      recommendedFix: 'Ensure the export route returns CSV content and is not being rewritten to HTML or another payload type by proxy/auth infrastructure.',
      csvDownload: { verdict: 'FAIL', message: `CSV content type was ${csvResponse.contentType || 'missing'}.` },
      headers: { verdict: 'PARTIAL', message: 'Skipped because CSV content type was wrong.' },
      filename: { verdict: 'PARTIAL', message: 'Skipped because CSV content type was wrong.' },
    })
  }

  const headerProfile = csvResponse.headers?.get('x-sysgrid-import-profile') || csvResponse.headers?.get('X-SysGrid-Import-Profile') || null
  const headerSchema = csvResponse.headers?.get('x-sysgrid-schema-version') || csvResponse.headers?.get('X-SysGrid-Schema-Version') || null
  const headerFileName = parseFileNameFromContentDisposition(csvResponse.headers?.get('content-disposition') || csvResponse.headers?.get('Content-Disposition'))
  const exposeHeadersValue = csvResponse.headers?.get('access-control-expose-headers') || csvResponse.headers?.get('Access-Control-Expose-Headers') || null
  const wildcardExposeHeadersDetected = Boolean(exposeHeadersValue && exposeHeadersValue.split(',').map((value) => value.trim()).includes('*'))
  const headersReadable = Boolean(headerProfile || headerSchema || headerFileName)

  if (wildcardExposeHeadersDetected) {
    return buildFailureResult({
      ...baseWithManifest,
      headersReadable,
      exposeHeadersValue,
      wildcardExposeHeadersDetected,
      layer: 'CORS expose headers',
      explanation: 'CSV response exposed headers with a wildcard value instead of an explicit allowlist.',
      recommendedFix: 'Return explicit Access-Control-Expose-Headers values for Content-Disposition, X-SysGrid-Import-Profile, and X-SysGrid-Schema-Version.',
      csvDownload: { verdict: 'PASS', message: 'CSV endpoint returned successful CSV content.' },
      headers: { verdict: 'FAIL', message: `Expose headers value was "${exposeHeadersValue}".` },
      filename: { verdict: 'PARTIAL', message: 'Filename validation stopped because the expose-header contract was unsafe.' },
    })
  }

  if (headerProfile && headerProfile !== EXPECTED_PROFILE) {
    return buildFailureResult({
      ...baseWithManifest,
      headersReadable: true,
      layer: 'Profile validation',
      explanation: `CSV response profile was "${headerProfile}" instead of "${EXPECTED_PROFILE}".`,
      recommendedFix: 'Ensure the CSV endpoint returns X-SysGrid-Import-Profile: external_entities and that proxy layers preserve that value.',
      csvDownload: { verdict: 'PASS', message: 'CSV endpoint returned successful CSV content.' },
      headers: { verdict: 'FAIL', message: `Readable profile header was "${headerProfile}".` },
      filename: { verdict: 'PARTIAL', message: 'Filename check skipped because profile validation failed.' },
      profile: headerProfile,
      exposeHeadersValue,
      wildcardExposeHeadersDetected,
    })
  }

  if (headerSchema && headerSchema !== EXPECTED_SCHEMA_VERSION) {
    return buildFailureResult({
      ...baseWithManifest,
      headersReadable: true,
      layer: 'Schema validation',
      explanation: `CSV response schema version was "${headerSchema}" instead of "${EXPECTED_SCHEMA_VERSION}".`,
      recommendedFix: 'Ensure the CSV endpoint returns the expected schema header and that proxy layers preserve it.',
      csvDownload: { verdict: 'PASS', message: 'CSV endpoint returned successful CSV content.' },
      headers: { verdict: 'FAIL', message: `Readable schema header was "${headerSchema}".` },
      filename: { verdict: 'PARTIAL', message: 'Filename check skipped because schema validation failed.' },
      schemaVersion: headerSchema,
      exposeHeadersValue,
      wildcardExposeHeadersDetected,
    })
  }

  if (headerFileName && headerFileName !== manifest.filename) {
    return buildFailureResult({
      ...baseWithManifest,
      headersReadable: true,
      layer: 'Filename validation',
      explanation: `CSV response filename was "${headerFileName}" instead of "${manifest.filename}".`,
      recommendedFix: 'Ensure manifest and CSV Content-Disposition are generated from the same backend-owned export contract.',
      csvDownload: { verdict: 'PASS', message: 'CSV endpoint returned successful CSV content.' },
      headers: { verdict: 'FAIL', message: `Readable Content-Disposition filename was "${headerFileName}".` },
      filename: { verdict: 'FAIL', message: `Filename mismatch: manifest "${manifest.filename}" vs CSV "${headerFileName}".` },
      filenameValue: headerFileName,
      exposeHeadersValue,
      wildcardExposeHeadersDetected,
    })
  }

  const effectiveFileName = headerFileName || manifest.filename || null
  const effectiveProfile = headerProfile || manifest.profile || null
  const effectiveSchemaVersion = headerSchema || manifest.schema_version || null
  const manifestFallbackUsed = !headersReadable
  const headersVerdict: DiagnosticLayerResult = headersReadable
    ? { verdict: 'PASS', message: 'Custom headers were readable and matched the backend contract.' }
    : { verdict: 'PARTIAL', message: 'Custom headers were unreadable; manifest fallback was used.' }
  const filenameVerdict: DiagnosticLayerResult = effectiveFileName && FILENAME_PATTERN.test(effectiveFileName)
    ? { verdict: 'PASS', message: `Filename validated as ${effectiveFileName}.` }
    : { verdict: 'FAIL', message: 'Effective filename was missing or invalid.' }

  if (filenameVerdict.verdict === 'FAIL') {
    return buildFailureResult({
      ...baseWithManifest,
      headersReadable,
      manifestFallbackUsed,
      filenameValue: effectiveFileName,
      profile: effectiveProfile,
      schemaVersion: effectiveSchemaVersion,
      exposeHeadersValue,
      wildcardExposeHeadersDetected,
      layer: 'Filename validation',
      explanation: 'Neither readable headers nor manifest provided a valid External export filename.',
      recommendedFix: 'Ensure the backend manifest and CSV response expose the SysGrid_External_YYYY-MM-DD_HH-mm-ss.csv filename contract.',
      csvDownload: { verdict: 'PASS', message: 'CSV endpoint returned successful CSV content.' },
      headers: headersVerdict,
      filename: filenameVerdict,
    })
  }

  let previewResult: DiagnosticLayerResult = { verdict: 'PARTIAL', message: 'Import preview not run.' }
  let previewStatus: ExternalExportContractResult['statusCodes']['preview'] = 'NOT_RUN'
  const csvBlob = csvResponse.blob || new Blob([csvResponse.text || ''], { type: 'text/csv' })
  const formData = new FormData()
  formData.append('table_name', 'external_entities')
  formData.append('file', csvBlob, effectiveFileName || 'external-export.csv')
  const previewResponse = await requestRuntimeResource(previewUrl, { method: 'POST', body: formData }, { ...options, frontendOrigin, apiBase })
  previewStatus = previewResponse.status

  if (previewResponse.status === 'NETWORK_ERROR') {
    previewResult = { verdict: 'PARTIAL', message: previewResponse.error || 'Import preview request failed.' }
  } else if (!previewResponse.ok || !previewResponse.json) {
    previewResult = { verdict: 'PARTIAL', message: `Import preview returned status ${String(previewResponse.status)}.` }
  } else {
    const preview = previewResponse.json
    if (preview.table_name === 'external_entities' && Number(preview.invalid_rows || 0) === 0) {
      previewResult = { verdict: 'PASS', message: 'Exported CSV previewed successfully through External Import.' }
    } else {
      return buildFailureResult({
        ...baseWithManifest,
        headersReadable,
        manifestFallbackUsed,
        filenameValue: effectiveFileName,
        profile: effectiveProfile,
        schemaVersion: effectiveSchemaVersion,
        exposeHeadersValue,
        wildcardExposeHeadersDetected,
        statusCodes: {
          manifest: manifestResponse.status,
          csv: csvResponse.status,
          preview: previewStatus,
        },
        layer: 'Import preview',
        explanation: 'Exported CSV did not preview cleanly through External Import.',
        recommendedFix: 'Ensure the backend export rows remain compatible with External Import preview.',
        csvDownload: { verdict: 'PASS', message: 'CSV endpoint returned successful CSV content.' },
        headers: headersVerdict,
        filename: filenameVerdict,
        importPreview: { verdict: 'FAIL', message: `Preview returned ${preview.invalid_rows || 0} invalid rows.` },
      })
    }
  }

  const overallStatus: DiagnosticVerdict = headersReadable ? 'PASS' : 'PARTIAL'
  const explanation = headersReadable
    ? 'Environment is safe for External round-trip export.'
    : 'Headers were unreadable, but manifest fallback validated the External export contract and kept the environment safe for round-trip export.'
  const result: ExternalExportContractResult = {
    ...baseWithManifest,
    status: overallStatus,
    state: 'completed',
    layer: headersReadable ? 'Verified' : 'Headers / manifest fallback',
    explanation,
    recommendedFix: headersReadable
      ? 'No fix required.'
      : 'Proxy should still preserve and expose the custom export headers, but the manifest fallback is currently protecting the contract.',
    headersReadable,
    manifestFallbackUsed,
    filenameValue: effectiveFileName,
    profile: effectiveProfile,
    schemaVersion: effectiveSchemaVersion,
    exposeHeadersValue,
    wildcardExposeHeadersDetected,
    csvDownload: { verdict: 'PASS', message: 'CSV endpoint returned successful CSV content from the configured API base.' },
    headers: headersVerdict,
    filename: filenameVerdict,
    importPreview: previewResult,
    statusCodes: {
      manifest: manifestResponse.status,
      csv: csvResponse.status,
      preview: previewStatus,
    },
    reportText: '',
  }
  result.reportText = formatExternalExportContractReport(result)
  return result
}
