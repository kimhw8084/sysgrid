import React from 'react'
import { getCurrentTenantId } from '../../api/tenantContext'
import { AlertCircle, X, Copy } from 'lucide-react'
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
    const safeUserId = userId || (typeof localStorage !== 'undefined' ? localStorage.getItem('SYSGRID_USER_ID') || 'admin_root' : 'admin_root')
    const safeTenantId = tenantId || (typeof localStorage !== 'undefined' ? getCurrentTenantId() : '1')

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
        error: 'bg-rose-500/20 text-rose-300 border-rose-500/30 cursor-pointer hover:bg-rose-500/30',
        empty: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
        filtered: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
        loading: 'bg-blue-500/20 text-blue-300 border-blue-500/30'
    }
    
    const labels = {
        error: `Data error ${errorDetail?.status || ''}`,
        empty: 'No data',
        filtered: 'Filtered to 0',
        loading: 'Loading...'
    }

    return (
        <button 
            onClick={onClick}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest ${colors[status as keyof typeof colors] || ''}`}
        >
            <AlertCircle size={12} />
            <span>{labels[status as keyof typeof labels] || 'Data status'}</span>
        </button>
    )
}

export function DataDiagnosticModal({ isOpen, onClose, errorDetail }: { isOpen: boolean, onClose: () => void, errorDetail: any }) {
    const copyDiagnostics = () => {
        navigator.clipboard.writeText(JSON.stringify(errorDetail, null, 2))
    }

    return (
        <WorkspaceModal isOpen={isOpen} onClose={onClose} title="Diagnostic Information">
            <div className="p-4 text-[12px] text-slate-300 font-mono space-y-2">
                <p><strong>Endpoint:</strong> {errorDetail?.endpoint || '/api/v1/monitoring?include_deleted=true'}</p>
                <p><strong>Status:</strong> {errorDetail?.status ?? UNAVAILABLE_DETAIL}</p>
                <p><strong>Status Text:</strong> {errorDetail?.statusText || UNAVAILABLE_DETAIL}</p>
                <p><strong>URL:</strong> {errorDetail?.url || UNAVAILABLE_DETAIL}</p>
                <p><strong>User ID:</strong> {errorDetail?.userId || 'admin_root'}</p>
                <p><strong>Tenant ID:</strong> {errorDetail?.tenantId || '1'}</p>
                <p><strong>Message:</strong> {errorDetail?.message || 'The request failed.'}</p>
                <div className="bg-slate-900 p-2 rounded overflow-x-auto">
                    <pre>{typeof errorDetail?.rawBody === 'string' ? errorDetail.rawBody : JSON.stringify(errorDetail?.data || errorDetail, null, 2)}</pre>
                </div>
                <button onClick={copyDiagnostics} className="flex items-center gap-2 px-3 py-1 bg-slate-800 rounded hover:bg-slate-700">
                    <Copy size={12} />
                    Copy Diagnostics
                </button>
            </div>
        </WorkspaceModal>
    )
}
