import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { apiFetch, setApiOverride, getApiBaseUrl } from './api/apiClient'
import { buildBootstrapFailureDiagnosis, buildBootstrapReport } from './api/bootstrapDiagnostics'
import { AlertTriangle, Bug, Copy, Database, ExternalLink, Globe, RefreshCcw, ShieldAlert, UserCircle2, Wrench } from 'lucide-react'
import { WorkspaceSectionCard, WorkspaceSectionBadge, WorkspaceEmptyState } from './components/shared/OperationalWorkspacePrimitives'
import { PageHeader, PageToolbar, ToolbarButton, ToolbarGroup } from './components/shared/LayoutPrimitives'
import { initializePV1PerformanceInstrumentation } from './observability/pv1Performance'

initializePV1PerformanceInstrumentation()

console.log("MAIN.TSX: Initializing React Root");

// Global error capture for early bootstrap issues
window.addEventListener('error', (event) => {
  if (event.message === 'ResizeObserver loop completed with undelivered notifications.' && event.error == null) {
    console.warn("GLOBAL_RESIZE_OBSERVER_DELIVERY:", event.message);
    return;
  }
  console.error("GLOBAL_ERROR_BEFORE_MOUNT:", event.message, event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error("GLOBAL_REJECTION_BEFORE_MOUNT:", event.reason);
});

function normalizeUiApiOrigin(url: string): string {
  return (url || '').trim().replace(/\/api\/v1\/?$/i, '').replace(/\/$/, '')
}

function isLoopbackOrigin(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(normalizeUiApiOrigin(url))
}

function isLikelyForwardedHost(hostname: string): boolean {
  return !/^(127\.0\.0\.1|localhost)$/i.test(hostname) && hostname.includes('.')
}

function shouldUseWebSocketSync(apiBaseUrl: string): boolean {
  const normalizedBaseUrl = normalizeUiApiOrigin(apiBaseUrl || '')
  if (!normalizedBaseUrl) return true
  try {
    const targetUrl = new URL(normalizedBaseUrl, window.location.origin)
    return targetUrl.origin === window.location.origin
  } catch {
    return true
  }
}

function resolveBootstrapCredentialsMode(url: string): RequestCredentials {
  try {
    const targetUrl = new URL(url, window.location.origin)
    return targetUrl.origin === window.location.origin ? 'same-origin' : 'include'
  } catch {
    return 'same-origin'
  }
}

function getBootstrapUserId() {
  return (
    localStorage.getItem('SYSGRID_USER_ID') ||
    localStorage.getItem('SYSGRID_CONFIG_DEFAULT_USER_ID') ||
    'admin_root'
  )
}

const Bootstrap = () => {
  const BOOTSTRAP_MAX_ATTEMPTS = 4
  const BOOTSTRAP_RETRY_DELAY_MS = 750
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string>("");
  const [appKey, setAppKey] = useState(0);
  const [backendDiagnostics, setBackendDiagnostics] = useState<any>(null);
  const [errorDetails, setErrorDetails] = useState<any>(null);
  const [copyFeedback, setCopyFeedback] = useState<string>('');

  useEffect(() => {
    let isMounted = true;
    let ws: WebSocket | null = null;
    let pollInterval: any = null;
    let retryTimeout: any = null;

    const sleep = (ms: number) => new Promise((resolve) => {
      retryTimeout = window.setTimeout(resolve, ms)
    })

    const fetchConfig = async () => {
      try {
        console.log("BOOTSTRAP: Fetching system configuration...");
        let response;
        let usedRelativeBootstrap = false
        const configuredBaseUrl = normalizeUiApiOrigin(getApiBaseUrl() || '')
        const currentOrigin = normalizeUiApiOrigin(window.location.origin)
        const shouldPreferRelativeBootstrap = !configuredBaseUrl || configuredBaseUrl === currentOrigin

        const fetchRelativeBootstrap = async () => {
          const relativeResponse = await fetch('/api/v1/settings/bootstrap', {
            cache: 'no-store',
            credentials: 'same-origin',
          })
          const contentType = relativeResponse.headers.get('content-type') || ''
          if (!relativeResponse.ok || !contentType.toLowerCase().includes('application/json')) {
            throw new Error(`Relative bootstrap is unavailable from this origin (status ${relativeResponse.status})`)
          }
          usedRelativeBootstrap = true
          return relativeResponse
        }

        const fetchConfiguredBootstrap = async () => {
          const configuredResponse = await apiFetch('/api/v1/settings/bootstrap')
          if (!configuredResponse.ok) {
            throw new Error(`API Error ${configuredResponse.status}`)
          }
          return configuredResponse
        }

        try {
          if (shouldPreferRelativeBootstrap) {
            try {
              response = await fetchRelativeBootstrap()
            } catch (relativeErr) {
              console.warn("BOOTSTRAP: Relative bootstrap unavailable, falling back to configured API target...", relativeErr)
              response = await apiFetch('/api/v1/settings/bootstrap');
            }
          } else {
            try {
              response = await fetchConfiguredBootstrap()
            } catch (configuredErr) {
              console.warn("BOOTSTRAP: Configured bootstrap target failed, clearing configuration cache and retrying...", configuredErr)
              Object.keys(localStorage).forEach(k => {
                if (k.startsWith('SYSGRID_CONFIG_')) {
                  localStorage.removeItem(k)
                }
              })
              response = await fetchConfiguredBootstrap()
            }
          }
        } catch (initialErr) {
          console.warn("BOOTSTRAP: Initial fetch failed, clearing configuration cache and retrying...", initialErr);
          Object.keys(localStorage).forEach(k => {
            if (k.startsWith('SYSGRID_CONFIG_')) {
              localStorage.removeItem(k);
            }
          });
          try {
            response = await fetchConfiguredBootstrap()
          } catch (overrideErr) {
            const currentOverride = localStorage.getItem('SYSGRID_OVERRIDE_API_URL') || ''
            const envApiBase = (import.meta.env.VITE_API_BASE_URL || '').trim()
            if (currentOverride && envApiBase && currentOverride !== envApiBase) {
              console.warn("BOOTSTRAP: Retrying without stale API override...", currentOverride);
              setApiOverride(null);
              response = await fetchConfiguredBootstrap()
            } else {
              throw overrideErr;
            }
          }
        }
        
        const config = await response.json();
        console.log("BOOTSTRAP: Configuration received", config);
        if (usedRelativeBootstrap) {
          const currentOverride = localStorage.getItem('SYSGRID_OVERRIDE_API_URL') || ''
          const currentOrigin = window.location.origin.replace(/\/$/, '')
          const normalizedOverride = currentOverride.replace(/\/api\/v1\/?$/i, '').replace(/\/$/, '')
          if (normalizedOverride && normalizedOverride !== currentOrigin) {
            console.warn(`BOOTSTRAP: Clearing stale API override ${normalizedOverride} because same-origin API is healthy at ${currentOrigin}`)
            setApiOverride(null)
          }
        }
        let changed = false;
        Object.entries(config).forEach(([key, value]) => {
          const lsKey = `SYSGRID_CONFIG_${key}`;
          if (localStorage.getItem(lsKey) !== String(value)) {
            changed = true;
            localStorage.setItem(lsKey, String(value));
          }
        });
        if (changed && ready) {
          console.log("BOOTSTRAP: Configuration updated, triggering re-render");
          setAppKey(prev => prev + 1);
        }
        return true;
      } catch (err: any) {
        console.error("BOOTSTRAP: Failed to fetch configuration", err);
        throw err;
      }
    };

    const init = async () => {
      try {
        let lastError: any = null
        for (let attempt = 1; attempt <= BOOTSTRAP_MAX_ATTEMPTS; attempt += 1) {
          try {
            await fetchConfig();
            lastError = null
            break
          } catch (err: any) {
            lastError = err
            console.warn(`BOOTSTRAP: attempt ${attempt} failed`, err)
            if (attempt < BOOTSTRAP_MAX_ATTEMPTS) {
              await sleep(BOOTSTRAP_RETRY_DELAY_MS)
            }
          }
        }
        if (lastError) throw lastError
        if (isMounted) {
          console.log("BOOTSTRAP: System ready, launching application layer");
          setReady(true);
        }

        // Use WebSocket only for same-origin/local routing. In forwarded/company cross-origin
        // deployments, prefer polling to avoid noisy socket failures through port-forward layers.
        const baseUrl = getApiBaseUrl() || window.location.origin;
        if (shouldUseWebSocketSync(baseUrl)) {
          const wsProtocol = baseUrl.startsWith('https') ? 'wss' : 'ws';
          const tenantId = localStorage.getItem('SYSGRID_TENANT_ID') || '1';
          const wsUrl = baseUrl.replace(/^https?/, wsProtocol) + `/api/v1/ws/sync?tenant_id=${encodeURIComponent(tenantId)}`;
          
          console.log("BOOTSTRAP: Initializing WebSocket sync at " + wsUrl);
          try {
            ws = new WebSocket(wsUrl);
            ws.onmessage = (event) => {
              if (event.data === 'CONFIG_UPDATED') {
                console.log("WS: CONFIG_UPDATED signal received");
                fetchConfig().catch(() => {});
              }
            };
            ws.onerror = (err) => {
              console.warn("WS: Connection failed. Gracefully degrading to HTTP polling.", err);
              if (!pollInterval) {
                pollInterval = setInterval(() => fetchConfig().catch(() => {}), 60000); // 1 min fallback
              }
            };
          } catch (e) {
            console.warn("WS: Setup failed. Gracefully degrading to HTTP polling.", e);
            pollInterval = setInterval(() => fetchConfig().catch(() => {}), 60000);
          }
        } else {
          console.log("BOOTSTRAP: Cross-origin deployment detected, skipping WebSocket sync and using HTTP polling.");
          if (!pollInterval) {
            pollInterval = setInterval(() => fetchConfig().catch(() => {}), 60000);
          }
        }

      } catch (err: any) {
        if (isMounted) {
          setErrorDetails(err);
          setError(err.message || "Failed to connect to backend");
          setFailedUrl(err.finalUrl || err.url || getApiBaseUrl() || "relative path");
        }
      }
    };
    
    init();
    return () => { 
      isMounted = false; 
      if (ws) ws.close();
      if (pollInterval) clearInterval(pollInterval);
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, []); // Only run once on mount

  useEffect(() => {
    if (!error) return
    let cancelled = false

    const fetchStartupDiagnostics = async () => {
      const baseUrl = normalizeUiApiOrigin(getApiBaseUrl() || '')
      const candidateUrls = [
        baseUrl ? `${baseUrl}/api/v1/settings/startup-check` : null,
        '/api/v1/settings/startup-check',
      ].filter((value, index, collection): value is string => Boolean(value) && collection.indexOf(value) === index)

      let fallbackResult: any = null

      for (const diagnosticsUrl of candidateUrls) {
        try {
          const response = await fetch(diagnosticsUrl, {
            cache: 'no-store',
            credentials: resolveBootstrapCredentialsMode(diagnosticsUrl),
          })
          const text = await response.text()
          let data: any = null
          if (text) {
            try {
              data = JSON.parse(text)
            } catch {
              data = { detail: text }
            }
          }
          const result = {
            ok: response.ok,
            status: response.status,
            data,
            url: diagnosticsUrl,
          }
          if (response.ok) {
            if (!cancelled) {
              setBackendDiagnostics(result)
            }
            return
          }
          fallbackResult = result
        } catch (diagnosticError: any) {
          fallbackResult = {
            ok: false,
            status: null,
            data: { detail: diagnosticError?.message || 'Backend startup diagnostics request failed.' },
            url: diagnosticsUrl,
          }
        }
      }

      if (!cancelled) {
        setBackendDiagnostics(fallbackResult)
      }
    }

    fetchStartupDiagnostics()
    return () => {
      cancelled = true
    }
  }, [error])

  const currentOrigin = window.location.origin
  const configuredApiBase = getApiBaseUrl()
  const effectiveUserId = getBootstrapUserId()

  const failureDiagnosis = buildBootstrapFailureDiagnosis({
    error: errorDetails || {
      message: error,
      url: failedUrl,
      finalUrl: failedUrl,
    },
    configuredApiBase,
    uiOrigin: currentOrigin,
    effectiveUserId,
    storedOverride: localStorage.getItem('SYSGRID_OVERRIDE_API_URL') || '',
    backendDiagnostics,
  })
  const bootstrapReport = buildBootstrapReport(failureDiagnosis)

  const copyBootstrapText = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyFeedback(`${label} copied`)
    } catch {
      setCopyFeedback(`Could not copy ${label.toLowerCase()}`)
    }
    window.setTimeout(() => setCopyFeedback(''), 2500)
  }

  const openHealthEndpoint = () => {
    window.open(failureDiagnosis.healthUrl, '_blank', 'noopener,noreferrer')
  }

  const openBuganizer = async () => {
    await copyBootstrapText('Sanitized Buganizer report', bootstrapReport)
    if (failureDiagnosis.buganizerUrl) {
      window.open(failureDiagnosis.buganizerUrl, '_blank', 'noopener,noreferrer')
    }
  }

  if (error) {
    const backendWarnings = Array.isArray(backendDiagnostics?.data?.warnings) ? backendDiagnostics.data.warnings : []

    return (
      <div className="min-h-screen w-full bg-[var(--bg-primary)] text-[var(--accent-primary)] font-mono">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8">
          <WorkspaceSectionCard className="space-y-4 p-6">
            <PageHeader
              eyebrow="Bootstrap Failure"
              title={failureDiagnosis.title}
              subtitle={failureDiagnosis.summary}
              meta={
                <div className="flex flex-wrap items-center gap-2">
                  <WorkspaceSectionBadge tone="rose">{failureDiagnosis.code.replace(/_/g, " ")}</WorkspaceSectionBadge>
                  {backendDiagnostics?.ok ? <WorkspaceSectionBadge tone="emerald">Backend Diagnostics Live</WorkspaceSectionBadge> : null}
                  {backendWarnings.length ? <WorkspaceSectionBadge tone="amber">{backendWarnings.length} Warning{backendWarnings.length > 1 ? 's' : ''}</WorkspaceSectionBadge> : null}
                </div>
              }
              actions={
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-2 text-rose-400">
                  <AlertTriangle size={18} />
                </div>
              }
            />
            <p className="max-w-4xl text-[11px] font-semibold leading-relaxed text-slate-400">
              This window reports the classified root cause, the exact request/response context, and direct recovery actions. Diagnostics are sanitized before copying or opening Buganizer.
            </p>
            {copyFeedback ? (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[10px] font-bold text-emerald-300">
                {copyFeedback}
              </div>
            ) : null}
            <PageToolbar
              left={
                <ToolbarGroup>
                  <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[10px] font-semibold text-slate-400">
                    Active user: <span className="text-slate-200">{effectiveUserId}</span>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[10px] font-semibold text-slate-400">
                    Failed target: <span className="text-slate-200">{failureDiagnosis.diagnostics.failedUrl}</span>
                  </div>
                </ToolbarGroup>
              }
              right={
                <ToolbarGroup>
                  <ToolbarButton variant="primary" onClick={() => window.location.reload()}>
                    <RefreshCcw size={13} /> Retry
                  </ToolbarButton>
                  <ToolbarButton onClick={openHealthEndpoint}>
                    <ExternalLink size={13} /> Open Health
                  </ToolbarButton>
                  {failureDiagnosis.fixCommand ? (
                    <ToolbarButton onClick={() => copyBootstrapText('Fix command', failureDiagnosis.fixCommand)}>
                      <Copy size={13} /> Copy Fix
                    </ToolbarButton>
                  ) : null}
                  <ToolbarButton onClick={() => copyBootstrapText('Diagnostics', bootstrapReport)}>
                    <Copy size={13} /> Copy Diagnostics
                  </ToolbarButton>
                  <ToolbarButton onClick={openBuganizer}>
                    <Bug size={13} /> {failureDiagnosis.buganizerUrl ? 'Open Buganizer' : 'Copy Bug Report'}
                  </ToolbarButton>
                  <ToolbarButton
                    variant="quiet"
                    onClick={() => {
                      setApiOverride(null)
                      window.location.reload()
                    }}
                  >
                    Clear Overrides
                  </ToolbarButton>
                </ToolbarGroup>
              }
            />
          </WorkspaceSectionCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <WorkspaceSectionCard className="space-y-3">
              <div className="flex items-center gap-2 text-slate-200">
                <AlertTriangle size={14} className="text-rose-400" />
                <h2 className="text-[11px] font-black uppercase tracking-widest">Likely Cause</h2>
              </div>
              <div className="space-y-2">
                {failureDiagnosis.reasons.map((reason, index) => (
                  <p key={index} className="text-[11px] leading-relaxed text-slate-300">
                    {reason}
                  </p>
                ))}
              </div>
            </WorkspaceSectionCard>

            <WorkspaceSectionCard className="space-y-3">
              <div className="flex items-center gap-2 text-slate-200">
                <Database size={14} className="text-blue-400" />
                <h2 className="text-[11px] font-black uppercase tracking-widest">Frontend Diagnostics</h2>
              </div>
              <div className="grid gap-2 text-[10px] text-slate-400 sm:grid-cols-2">
                {Object.entries(failureDiagnosis.diagnostics).map(([label, value]) => (
                  <p key={label} className={label === 'rawBody' ? 'sm:col-span-2' : ''}>
                    <span className="text-slate-500">{label.replace(/([A-Z])/g, ' $1')}</span><br />
                    <span className="break-all text-slate-200">{String(value)}</span>
                  </p>
                ))}
              </div>
            </WorkspaceSectionCard>
          </div>

          <WorkspaceSectionCard className="space-y-4">
            <div className="flex items-center gap-2 text-slate-200">
              <Wrench size={14} className="text-amber-400" />
              <h2 className="text-[11px] font-black uppercase tracking-widest">Recommended Actions</h2>
            </div>
            <div className="space-y-2">
              {failureDiagnosis.actions.map((action, index) => (
                <p key={index} className="text-[11px] leading-relaxed text-slate-300">
                  {index + 1}. {action}
                </p>
              ))}
            </div>
          </WorkspaceSectionCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <WorkspaceSectionCard className="space-y-3">
              <div className="flex items-center gap-2 text-slate-200">
                <Globe size={14} className="text-blue-400" />
                <h2 className="text-[11px] font-black uppercase tracking-widest">Useful Checks</h2>
              </div>
              <div className="space-y-2 text-[10px] text-slate-400">
                <p>1. Open <span className="break-all text-slate-200">{failureDiagnosis.healthUrl}</span> directly in the browser.</p>
                <p>2. Run <span className="text-slate-200">./scripts/start-local.sh ... --print-runtime-config</span> to inspect derived hosts and origins without resetting data.</p>
                <p>3. Confirm the HTTP/HTTPS schemes match and the forwarded API port is visible to the same audience as the frontend.</p>
                <p>4. Use Copy Diagnostics before opening Buganizer; credentials and token-like values are redacted.</p>
              </div>
            </WorkspaceSectionCard>

            <WorkspaceSectionCard className="space-y-3">
              <div className="flex items-center gap-2 text-slate-200">
                <ShieldAlert size={14} className="text-emerald-400" />
                <h2 className="text-[11px] font-black uppercase tracking-widest">Backend Diagnostics</h2>
              </div>
              {backendDiagnostics ? (
                <div className="space-y-3 text-[10px] text-slate-400">
                  <p>
                    <span className="text-slate-500">Endpoint</span><br />
                    <span className="text-slate-200">{backendDiagnostics.url}</span>
                  </p>
                  <p>
                    <span className="text-slate-500">Status</span><br />
                    <span className="text-slate-200">{backendDiagnostics.status ?? 'unreachable'}</span>
                  </p>
                  {backendDiagnostics.data?.api && (
                    <>
                      <p><span className="text-slate-500">Backend-configured API Origin</span><br /><span className="text-slate-200">{backendDiagnostics.data.api.configured_origin || '<blank>'}</span></p>
                      <p><span className="text-slate-500">Request Origin</span><br /><span className="text-slate-200">{backendDiagnostics.data.api.request_origin || '<none>'}</span></p>
                      <p><span className="text-slate-500">Request Base Origin</span><br /><span className="text-slate-200">{backendDiagnostics.data.api.request_base_origin || '<none>'}</span></p>
                      <p><span className="text-slate-500">API Base Configured</span><br /><span className="text-slate-200">{backendDiagnostics.data.api.vite_api_base_url_configured ? 'yes' : 'no'}</span></p>
                      <p><span className="text-slate-500">API Base Includes /api/v1</span><br /><span className="text-slate-200">{backendDiagnostics.data.api.vite_api_base_url_includes_api_v1 ? 'yes' : 'no'}</span></p>
                    </>
                  )}
                  {backendDiagnostics.data?.cors && (
                    <>
                      <p><span className="text-slate-500">Request Origin Allowed</span><br /><span className="text-slate-200">{backendDiagnostics.data.cors.allows_request_origin ? 'yes' : 'no'}</span></p>
                      <p><span className="text-slate-500">Configured CORS Origin Count</span><br /><span className="text-slate-200">{String(backendDiagnostics.data.cors.configured_origin_count ?? 0)}</span></p>
                      <p><span className="text-slate-500">Wildcard CORS Enabled</span><br /><span className="text-slate-200">{backendDiagnostics.data.cors.wildcard_origin_enabled ? 'yes' : 'no'}</span></p>
                    </>
                  )}
                  {backendDiagnostics.data?.runtime && (
                    <>
                      <p><span className="text-slate-500">Environment Mode</span><br /><span className="text-slate-200">{backendDiagnostics.data.runtime.environment_mode || '<blank>'}</span></p>
                      <p><span className="text-slate-500">Default User Still Fallback</span><br /><span className="text-slate-200">{backendDiagnostics.data.runtime.default_user_id_is_fallback ? 'yes' : 'no'}</span></p>
                      <p><span className="text-slate-500">Identity Env Value Present</span><br /><span className="text-slate-200">{backendDiagnostics.data.runtime.user_id_env_value_present ? 'yes' : 'no'}</span></p>
                      <p><span className="text-slate-500">Public Read-Only</span><br /><span className="text-slate-200">{backendDiagnostics.data.runtime.public_readonly_enabled ? 'enabled' : 'disabled'}</span></p>
                      <p><span className="text-slate-500">Public Read-Only Tenant Configured</span><br /><span className="text-slate-200">{backendDiagnostics.data.runtime.public_readonly_tenant_configured ? 'yes' : 'no'}</span></p>
                      <p><span className="text-slate-500">Frontend Build Hint</span><br /><span className="text-slate-200">{backendDiagnostics.data.runtime.frontend_build_version_hint || '<blank>'}</span></p>
                    </>
                  )}
                  {backendDiagnostics.data?.tenant && (
                    <>
                      <p><span className="text-slate-500">Selected Tenant Present</span><br /><span className="text-slate-200">{backendDiagnostics.data.tenant.selected_tenant_present ? 'yes' : 'no'}</span></p>
                      <p><span className="text-slate-500">Accessible Tenant Count</span><br /><span className="text-slate-200">{String(backendDiagnostics.data.tenant.accessible_tenant_count ?? 0)}</span></p>
                    </>
                  )}
                  {Array.isArray(backendDiagnostics.data?.warnings) && backendDiagnostics.data.warnings.length > 0 ? (
                    <div className="space-y-1">
                      <p className="text-slate-300">Warnings</p>
                      {backendDiagnostics.data.warnings.map((warning: string, index: number) => (
                        <p key={index} className="text-[10px] leading-relaxed text-amber-300">{index + 1}. {warning}</p>
                      ))}
                    </div>
                  ) : null}
                  {!backendDiagnostics.ok && backendDiagnostics.data?.detail ? (
                    <p className="text-[10px] leading-relaxed text-rose-300">{backendDiagnostics.data.detail}</p>
                  ) : null}
                </div>
              ) : (
                <WorkspaceEmptyState
                  compact
                  icon={<Database size={18} />}
                  title="Loading Backend Diagnostics"
                  description="The app is attempting to fetch startup-check data from the backend."
                />
              )}
            </WorkspaceSectionCard>
          </div>

          <WorkspaceSectionCard className="space-y-3">
            <div className="flex items-center gap-2 text-slate-200">
              <UserCircle2 size={14} className="text-blue-400" />
              <h2 className="text-[11px] font-black uppercase tracking-widest">Recovery Intent</h2>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-300">
              Retry preserves the configured target. Clear Overrides removes only a stale browser API override. The application no longer offers an unsafe “ignore bootstrap” bypass; launch remains blocked until backend, host, origin, identity, and tenant contracts are valid.
            </p>
          </WorkspaceSectionCard>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--bg-primary)] text-[var(--accent-primary)] font-mono">
        <div className="flex flex-col items-center gap-6">
          <div className="relative">
            <div className="w-16 h-16 border-2 border-[var(--glass-border)] rounded-lg"></div>
            <div className="absolute top-0 left-0 w-16 h-16 border-2 border-[var(--accent-primary)] border-t-transparent rounded-full animate-spin"></div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.3em] font-black animate-pulse text-[var(--text-primary)]">Initializing SysGrid</span>
            <span className="text-[8px] uppercase tracking-[0.1em] opacity-30 text-[var(--text-muted)] font-black">Verifying Backend Synchronization...</span>
          </div>
        </div>
      </div>
    );
  }

  return <App key={appKey} />;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Bootstrap />
  </React.StrictMode>,
)
