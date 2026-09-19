import { beforeEach, describe, expect, it } from 'vitest'
import { formatExternalExportContractReport, runExternalExportContractCheck } from './externalExportDiagnostics'
import { makeTestResponse } from '../../test/response'

const validManifest = {
  profile: 'external_entities',
  schema_version: '2026-06-external-v1',
  filename: 'SysGrid_External_2026-06-30_15-11-09.csv',
  scope: 'active',
  content_type: 'text/csv',
  download_url: '/api/v1/import/snapshot/external_entities?export_token=2026-06-30_15-11-09',
}

function createFetchImpl({
  manifest = validManifest,
  csvHeaders,
  csvBody = 'name,type\nA,API\n',
  csvContentType = 'text/csv',
  previewBody = {
    table_name: 'external_entities',
    total_rows: 1,
    valid_rows: 1,
    invalid_rows: 0,
  },
  manifestRedirect,
  csvRedirect,
}: {
  manifest?: Record<string, any>
  csvHeaders?: Record<string, string>
  csvBody?: string
  csvContentType?: string
  previewBody?: any
  manifestRedirect?: { finalUrl: string; body?: string }
  csvRedirect?: { finalUrl: string; body?: string }
} = {}): typeof fetch {
  return (async (input) => {
    const url = String(input)
    if (url.endsWith('/api/v1/import/snapshot/external_entities/manifest')) {
      if (manifestRedirect) {
        return makeTestResponse(manifestRedirect.body || '<html>GitLab sign in</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
          redirected: true,
          finalUrl: manifestRedirect.finalUrl,
        })
      }
      return makeTestResponse(JSON.stringify(manifest), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        finalUrl: url,
      })
    }
    if (url.includes('/api/v1/import/snapshot/external_entities?export_token=')) {
      if (csvRedirect) {
        return makeTestResponse(csvRedirect.body || '<html>OAuth</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
          redirected: true,
          finalUrl: csvRedirect.finalUrl,
        })
      }
      return makeTestResponse(csvBody, {
        status: 200,
        headers: {
          'Content-Type': csvContentType,
          ...(csvHeaders || {
            'Content-Disposition': 'attachment; filename=SysGrid_External_2026-06-30_15-11-09.csv',
            'X-SysGrid-Import-Profile': 'external_entities',
            'X-SysGrid-Schema-Version': '2026-06-external-v1',
          }),
        },
        finalUrl: url,
      })
    }
    if (url.endsWith('/api/v1/import/preview-file')) {
      return makeTestResponse(JSON.stringify(previewBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        finalUrl: url,
      })
    }
    throw new Error(`unexpected url ${url}`)
  }) as typeof fetch
}

async function runCheck(fetchImpl: typeof fetch) {
  return runExternalExportContractCheck({
    fetchImpl,
    frontendOrigin: 'https://frontend.example.com',
    apiBase: 'https://api.example.com',
  })
}

describe('runExternalExportContractCheck', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('SYSGRID_USER_ID', 'admin_root')
    localStorage.setItem('SYSGRID_TENANT_ID', '1')
  })

  it('passes when manifest, csv, readable headers, filename, and preview are valid', async () => {
    const result = await runCheck(createFetchImpl())

    expect(result.status).toBe('PASS')
    expect(result.manifest.verdict).toBe('PASS')
    expect(result.csvDownload.verdict).toBe('PASS')
    expect(result.headers.verdict).toBe('PASS')
    expect(result.filename.verdict).toBe('PASS')
    expect(result.importPreview.verdict).toBe('PASS')
    expect(result.filenameValue).toBe(validManifest.filename)
    expect(result.headersReadable).toBe(true)
    expect(result.manifestFallbackUsed).toBe(false)
    expect(result.transport.manifest.customIdentityHeadersSent).toBe(true)
    expect(result.transport.manifest.contentTypeHeaderSent).toBeNull()
    expect(result.transport.manifest.likelyPreflight).toBe(true)
    expect(result.wildcardExposeHeadersDetected).toBe(false)
  })

  it('returns PARTIAL when manifest fallback is valid but custom headers are unreadable', async () => {
    const result = await runCheck(createFetchImpl({
      csvHeaders: {
        'Content-Type': 'text/csv',
      },
    }))

    expect(result.status).toBe('PARTIAL')
    expect(result.headers.verdict).toBe('PARTIAL')
    expect(result.headers.message).toContain('manifest fallback')
    expect(result.headersReadable).toBe(false)
    expect(result.manifestFallbackUsed).toBe(true)
    expect(result.reportText).toContain('Headers Readable: no')
    expect(result.reportText).toContain('Manifest Fallback Used: yes')
    expect(result.explanation).toContain('Headers were unreadable')
  })

  it('fails when manifest request redirects to oauth', async () => {
    const result = await runCheck(createFetchImpl({
      manifestRedirect: { finalUrl: 'https://gitlab.example.com/oauth/authorize' },
    }))

    expect(result.status).toBe('FAIL')
    expect(result.layer).toBe('Auth / proxy routing')
    expect(result.redirectDetected).toBe(true)
    expect(result.recommendedFix).toContain('authenticated browser session')
  })

  it('fails when manifest profile is wrong', async () => {
    const result = await runCheck(createFetchImpl({
      manifest: { ...validManifest, profile: 'monitoring_items' },
    }))

    expect(result.status).toBe('FAIL')
    expect(result.layer).toBe('Manifest contract')
    expect(result.explanation).toContain('Manifest profile')
  })

  it('fails when manifest schema version is wrong', async () => {
    const result = await runCheck(createFetchImpl({
      manifest: { ...validManifest, schema_version: '2026-05-external-v1' },
    }))

    expect(result.status).toBe('FAIL')
    expect(result.layer).toBe('Manifest contract')
    expect(result.explanation).toContain('schema version')
  })

  it('fails when manifest filename pattern is invalid', async () => {
    const result = await runCheck(createFetchImpl({
      manifest: { ...validManifest, filename: 'external.csv' },
    }))

    expect(result.status).toBe('FAIL')
    expect(result.layer).toBe('Manifest contract')
    expect(result.explanation).toContain('filename')
  })

  it('fails when csv download request redirects to oauth', async () => {
    const result = await runCheck(createFetchImpl({
      csvRedirect: { finalUrl: 'https://gitlab.example.com/oauth/authorize' },
    }))

    expect(result.status).toBe('FAIL')
    expect(result.layer).toBe('Auth / proxy routing')
    expect(result.redirectDetected).toBe(true)
  })

  it('fails when csv content type is invalid', async () => {
    const result = await runCheck(createFetchImpl({
      csvContentType: 'text/html',
      csvBody: '<html>proxy response</html>',
      csvHeaders: {
        'Content-Type': 'text/html',
      },
    }))

    expect(result.status).toBe('FAIL')
    expect(result.layer).toBe('CSV content type')
    expect(result.csvDownload.verdict).toBe('FAIL')
  })

  it('fails when manifest and csv filename disagree while both are available', async () => {
    const result = await runCheck(createFetchImpl({
      csvHeaders: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename=SysGrid_External_2026-06-30_15-11-10.csv',
        'X-SysGrid-Import-Profile': 'external_entities',
        'X-SysGrid-Schema-Version': '2026-06-external-v1',
      },
    }))

    expect(result.status).toBe('FAIL')
    expect(result.layer).toBe('Filename validation')
    expect(result.filename.verdict).toBe('FAIL')
  })

  it('fails when readable csv profile header does not match the contract', async () => {
    const result = await runCheck(createFetchImpl({
      csvHeaders: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename=${validManifest.filename}`,
        'X-SysGrid-Import-Profile': 'wrong_profile',
        'X-SysGrid-Schema-Version': '2026-06-external-v1',
      },
    }))

    expect(result.status).toBe('FAIL')
    expect(result.layer).toBe('Profile validation')
    expect(result.headers.verdict).toBe('FAIL')
    expect(result.profile).toBe('wrong_profile')
  })

  it('fails when expose headers uses a wildcard value', async () => {
    const result = await runCheck(createFetchImpl({
      csvHeaders: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename=${validManifest.filename}`,
        'X-SysGrid-Import-Profile': 'external_entities',
        'X-SysGrid-Schema-Version': '2026-06-external-v1',
        'Access-Control-Expose-Headers': '*',
      },
    }))

    expect(result.status).toBe('FAIL')
    expect(result.layer).toBe('CORS expose headers')
    expect(result.wildcardExposeHeadersDetected).toBe(true)
  })
})

describe('formatExternalExportContractReport', () => {
  it('includes required report fields and transport classification', () => {
    const text = formatExternalExportContractReport({
      status: 'PASS',
      state: 'completed',
      layer: 'Verified',
      explanation: 'Environment is safe for External round-trip export.',
      recommendedFix: 'No fix required.',
      frontendOrigin: 'https://frontend.example.com',
      apiBase: 'https://api.example.com',
      environmentMode: 'cross-origin company-domain proxy',
      manifestUrl: 'https://api.example.com/api/v1/import/snapshot/external_entities/manifest',
      csvUrl: 'https://api.example.com/api/v1/import/snapshot/external_entities?export_token=2026-06-30_15-11-09',
      previewUrl: 'https://api.example.com/api/v1/import/preview-file',
      manifest: { verdict: 'PASS', message: 'Manifest ok.' },
      csvDownload: { verdict: 'PASS', message: 'CSV ok.' },
      headers: { verdict: 'PARTIAL', message: 'Manifest fallback used.' },
      filename: { verdict: 'PASS', message: 'Filename ok.' },
      importPreview: { verdict: 'PASS', message: 'Preview ok.' },
      statusCodes: { manifest: 200, csv: 200, preview: 200 },
      redirectDetected: false,
      headersReadable: false,
      manifestFallbackUsed: true,
      filenameValue: 'SysGrid_External_2026-06-30_15-11-09.csv',
      schemaVersion: '2026-06-external-v1',
      profile: 'external_entities',
      exposeHeadersValue: 'Content-Disposition, X-SysGrid-Import-Profile, X-SysGrid-Schema-Version',
      wildcardExposeHeadersDetected: false,
      transport: {
        manifest: {
          method: 'GET',
          customIdentityHeadersSent: true,
          contentTypeHeaderSent: null,
          likelySimpleRequest: false,
          likelyPreflight: true,
          explanation: 'cross-origin request; sends X-User-Id/X-Tenant-Id; does not send Content-Type; likely triggers OPTIONS preflight; custom identity headers can force preflight',
        },
        csv: {
          method: 'GET',
          customIdentityHeadersSent: true,
          contentTypeHeaderSent: null,
          likelySimpleRequest: false,
          likelyPreflight: true,
          explanation: 'cross-origin request; sends X-User-Id/X-Tenant-Id; does not send Content-Type; likely triggers OPTIONS preflight; custom identity headers can force preflight',
        },
      },
      reportText: '',
    })

    expect(text).toContain('Frontend Origin: https://frontend.example.com')
    expect(text).toContain('API Base: https://api.example.com')
    expect(text).toContain('Manifest URL:')
    expect(text).toContain('CSV URL:')
    expect(text).toContain('CSV URL: https://api.example.com/api/v1/import/snapshot/external_entities?[redacted-query]')
    expect(text).toContain('Manifest Status: 200')
    expect(text).toContain('Redirect Detected: no')
    expect(text).toContain('Manifest Fallback Used: yes')
    expect(text).toContain('Expose Headers: Content-Disposition, X-SysGrid-Import-Profile, X-SysGrid-Schema-Version')
    expect(text).toContain('Wildcard Expose Headers: no')
    expect(text).toContain('Manifest Request: method=GET; custom_identity_headers=yes; content_type=none; likely_simple=no; likely_preflight=yes')
    expect(text).toContain('Overall: PASS')
  })
})
