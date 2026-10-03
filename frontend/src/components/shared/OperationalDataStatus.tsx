import React from 'react'
import toast from 'react-hot-toast'
import { AlertCircle, Copy } from 'lucide-react'
import { WorkspaceModal } from './WorkspaceModal'

export type DataStatus = 'healthy' | 'loading' | 'error' | 'filtered' | 'empty'
export type OperationalDiagnosticDetail = {
    endpoint: string
    status: number | string
    statusText: string
    url: string
    userId: string
    tenantId: string
    message: string
    rawBody?: string
    data?: any
}

const UNAVAILABLE_DETAIL = 'Unavailable from current error object'
const UNAVAILABLE_CONTEXT = 'Not captured'

function readContext(storage: 'localStorage' | 'sessionStorage', key: string) {
    try { return window[storage].getItem(key) || undefined } catch { return undefined }
}

export function normalizeOperationalListResponse(data: any) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
        if (Array.isArray(data.items)) return data.items;
        if (Array.isArray(data.data)) return data.data;
        if (Array.isArray(data.results)) return data.results;
        if (Array.isArray(data.rows)) return data.rows;
    }
    return null;
}

export function classifyDataStatus(
    isLoading: boolean,
    error: any,
    rawData: any,
    filteredCount: number,
    totalCount: number
): { status: DataStatus, errorDetail?: any } {
    if (isLoading) return { status: 'loading' };
    if (error) return { status: 'error', errorDetail: error };
    if (!rawData) return { status: 'error', errorDetail: { message: 'Invalid response shape' } };
    if (totalCount === 0) return { status: 'empty' };
    if (filteredCount === 0) return { status: 'filtered' };
    return { status: 'healthy' };
}

export function buildOperationalDiagnosticDetail({
    endpoint,
    error,
    fallbackMessage = 'The request failed.',
    userId,
    tenantId,
}: {
    endpoint: string
    error: any
    fallbackMessage?: string
    userId?: string
    tenantId?: string
}): OperationalDiagnosticDetail {
    const safeUserId = userId || readContext('localStorage', 'SYSGRID_USER_ID') || readContext('localStorage', 'SYSGRID_CONFIG_DEFAULT_USER_ID') || UNAVAILABLE_CONTEXT
    const safeTenantId = tenantId || readContext('sessionStorage', 'SYSGRID_TAB_TENANT_ID') || readContext('localStorage', 'SYSGRID_TENANT_ID') || UNAVAILABLE_CONTEXT

    return {
        endpoint,
        status: error?.status ?? UNAVAILABLE_DETAIL,
        statusText: error?.statusText || UNAVAILABLE_DETAIL,
        url: error?.url || UNAVAILABLE_DETAIL,
        userId: safeUserId,
        tenantId: safeTenantId,
        message: error?.message || fallbackMessage,
        rawBody: typeof error?.rawBody === 'string' && error.rawBody.trim() ? error.rawBody : undefined,
        data: error?.data,
    }
}

export default function DataStatusPill({ status, errorDetail, onClick }: { status: string, errorDetail?: any, onClick: () => void }) {
    if (status === 'healthy') return null
    
    const colors = {
        error: 'bg-[var(--state-danger-surface)] text-[var(--state-danger)] border-[var(--state-danger-border)] hover:bg-[var(--state-danger-surface-strong)]',
        empty: 'bg-[var(--surface-elevated)] text-[var(--text-secondary)] border-[var(--border-default)]',
        filtered: 'bg-[var(--state-warning-surface)] text-[var(--state-warning)] border-[var(--state-warning-border)]',
        loading: 'bg-[var(--state-info-surface)] text-[var(--state-info)] border-[var(--state-info-border)]'
    }
    
    const labels = {
        error: `Data error ${errorDetail?.status || ''}`,
        empty: 'No data',
        filtered: 'Filtered to 0',
        loading: 'Loading...'
    }

    return (
        <button 
            type="button"
            onClick={onClick}
            className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--action-primary)] ${colors[status as keyof typeof colors] || ''}`}
        >
            <AlertCircle size={16} aria-hidden="true" />
            <span>{labels[status as keyof typeof labels] || 'Data status'}</span>
        </button>
    )
}

export function DataDiagnosticModal({ isOpen, onClose, errorDetail }: { isOpen: boolean, onClose: () => void, errorDetail: any }) {
    React.useLayoutEffect(() => {
        // Opening the full report consumes only its matching summary notice.
        // The error history and unrelated notifications remain available.
        if (isOpen && typeof errorDetail?.message === 'string' && errorDetail.message) toast.remove(errorDetail.message)
    }, [isOpen, errorDetail?.message])
    const report = JSON.stringify(errorDetail ?? {}, null, 2)
    return (
        <WorkspaceModal isOpen={isOpen} onClose={onClose} title="Diagnostic Information">
            <DiagnosticContent key={report} errorDetail={errorDetail} report={report} />
        </WorkspaceModal>
    )
}

function DiagnosticContent({ errorDetail, report }: { errorDetail: any, report: string }) {
    const inFlight = React.useRef(false)
    const mounted = React.useRef(true)
    const [copyState, setCopyState] = React.useState<'idle' | 'copying' | 'failed' | 'copied'>('idle')
    React.useEffect(() => {
        mounted.current = true
        return () => { mounted.current = false }
    }, [])

    const copyDiagnostics = async () => {
        if (inFlight.current) return
        inFlight.current = true
        setCopyState('copying')
        try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
            await navigator.clipboard.writeText(report)
            if (mounted.current) setCopyState('copied')
        } catch {
            if (mounted.current) setCopyState('failed')
        } finally { inFlight.current = false }
    }

    return (
        <div className="min-w-0 space-y-4 py-4 text-sm leading-relaxed text-[var(--text-primary)] [overflow-wrap:anywhere]">
            <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
                {[
                    ['Endpoint', errorDetail?.endpoint || UNAVAILABLE_DETAIL],
                    ['Status', errorDetail?.status ?? UNAVAILABLE_DETAIL],
                    ['Status text', errorDetail?.statusText || UNAVAILABLE_DETAIL],
                    ['URL', errorDetail?.url || UNAVAILABLE_DETAIL],
                    ['User context', errorDetail?.userId || UNAVAILABLE_CONTEXT],
                    ['Tenant context', errorDetail?.tenantId || UNAVAILABLE_CONTEXT],
                    ['Message', errorDetail?.message || 'The request failed.'],
                ].map(([label, value]) => (
                    <React.Fragment key={label}>
                        <dt className="font-semibold text-[var(--text-secondary)]">{label}</dt>
                        <dd className="min-w-0 mb-2 sm:mb-0">{value}</dd>
                    </React.Fragment>
                ))}
            </dl>
            <p className="text-xs text-[var(--text-secondary)]">User and tenant context come from this browser and may differ from the failed request.</p>
            <pre role="region" aria-label="Response details" tabIndex={0} className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] p-3 font-mono text-xs text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--action-primary)]">{typeof errorDetail?.rawBody === 'string' ? errorDetail.rawBody : JSON.stringify(errorDetail?.data ?? errorDetail ?? {}, null, 2)}</pre>
            <button type="button" onClick={copyDiagnostics} disabled={copyState === 'copying'} aria-busy={copyState === 'copying'} className="flex min-h-11 items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--action-primary)] disabled:cursor-wait">
                <Copy size={16} aria-hidden="true" />
                Copy Diagnostics
            </button>
            {copyState === 'copying' || copyState === 'copied' ? <p role="status">{copyState === 'copying' ? 'Copying diagnostics…' : 'Diagnostics copied.'}</p> : null}
            {copyState === 'failed' ? (
                <div className="space-y-2">
                    <p role="alert" className="text-[var(--state-danger)]">Could not copy diagnostics. Select the report below to copy it manually, or try again.</p>
                    <label className="block space-y-2">
                        <span className="font-semibold">Diagnostics for manual copy</span>
                        <textarea readOnly rows={6} value={report} onFocus={event => event.currentTarget.select()} className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] p-3 font-mono text-base text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--action-primary)] sm:text-xs" />
                    </label>
                </div>
            ) : null}
        </div>
    )
}
