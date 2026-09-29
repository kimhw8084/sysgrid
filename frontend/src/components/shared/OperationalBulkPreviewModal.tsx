import React from 'react'
import { AlertTriangle, CheckCircle2, Eye, RotateCcw, ShieldCheck } from 'lucide-react'
import { ToolbarButton } from './LayoutPrimitives'
import { WorkspaceModal } from './WorkspaceModal'

export type OperationalBulkBlocker = {
  id: number
  name?: string | null
  reason: string
}

export type OperationalBulkPreview = {
  action: string
  selected_count: number
  matched_count: number
  changed_count: number
  unchanged_count: number
  blocked_count: number
  missing_count: number
  changed_ids: number[]
  unchanged_ids: number[]
  missing_ids: number[]
  blockers: OperationalBulkBlocker[]
  can_execute: boolean
  purge_impact?: OperationalPurgeImpact
}

export type OperationalPurgeImpactEntry = {
  table: string
  type: string
  count: number
  disposition: 'database_cascade' | 'explicit_delete' | 'nullified' | 'mixed'
  fields?: string[]
}

export type OperationalPurgeImpact = {
  permanent: boolean
  recovery_supported: boolean
  aggregate: {
    device_count?: number
    monitoring_count?: number
    delete_count: number
    detach_count: number
    deletes: OperationalPurgeImpactEntry[]
    detaches: OperationalPurgeImpactEntry[]
  }
}

export type OperationalBulkResult = {
  selected_count: number
  changed_count: number
  unchanged_count: number
  can_revert: boolean
  purge_impact?: OperationalPurgeImpact
}

type OperationalBulkPreviewModalProps = {
  isOpen: boolean
  workspaceLabel: string
  actionLabel: string
  fieldLabel?: string
  nextValue?: React.ReactNode
  preview: OperationalBulkPreview | null
  result?: OperationalBulkResult | null
  isExecuting?: boolean
  isReverting?: boolean
  onClose: () => void
  onConfirm: () => void
  onRevert?: () => void
  previewBasis?: 'backend' | 'workspace-snapshot'
  isLoading?: boolean
  error?: string
  onRefresh?: () => void
}

const SummaryCard = ({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'success' | 'warning' | 'danger' }) => {
  const toneClass = tone === 'success'
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
    : tone === 'warning'
      ? 'border-amber-500/20 bg-amber-500/10 text-amber-200'
      : tone === 'danger'
        ? 'border-rose-500/20 bg-rose-500/10 text-rose-200'
        : 'border-white/10 bg-white/[0.04] text-slate-200'
  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClass}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-70">{label}</p>
      <p className="pt-1 text-2xl font-semibold" data-testid={`bulk-preview-${label.toLowerCase().replace(/\s+/g, '-')}`}>{value}</p>
    </div>
  )
}

export function OperationalBulkPreviewModal({
  isOpen,
  workspaceLabel,
  actionLabel,
  fieldLabel,
  nextValue,
  preview,
  result = null,
  isExecuting = false,
  isReverting = false,
  onClose,
  onConfirm,
  onRevert,
  previewBasis = 'backend',
  isLoading = false,
  error = '',
  onRefresh,
}: OperationalBulkPreviewModalProps) {
  const isComplete = Boolean(result)
  const hasBlockingIssues = Boolean(preview && (preview.blocked_count > 0 || preview.missing_count > 0))
  const canConfirm = Boolean(preview?.can_execute) && !isExecuting && !isComplete && !isLoading && !error
  const purgeImpact = isComplete ? result?.purge_impact : preview?.purge_impact

  return (
    <WorkspaceModal
      isOpen={isOpen}
      onClose={onClose}
      size="standard"
      icon={isComplete
        ? <CheckCircle2 size={17} className="text-emerald-300" />
        : <Eye size={17} className="text-blue-300" />}
      title={`${workspaceLabel} bulk ${isComplete ? 'complete' : 'preview'}`}
      subtitle={isComplete
        ? 'The backend confirmed the exact operation result.'
        : previewBasis === 'workspace-snapshot'
          ? 'Review the current workspace snapshot before anything changes.'
          : 'Review the backend-authoritative impact before anything changes.'}
      hideFooterClose
      footerLeft={isComplete ? (
        <div className="flex items-center gap-2 text-[11px] text-emerald-300">
          <ShieldCheck size={14} />
          Result persisted and workspace data is refreshing.
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <ShieldCheck size={14} className="text-emerald-300" />
          {previewBasis === 'workspace-snapshot'
            ? 'Preview uses currently loaded workspace data; the backend remains authoritative when you confirm.'
            : 'No records change until you confirm.'}
        </div>
      )}
      footerRight={isComplete ? (
        <>
          {result?.can_revert && onRevert ? (
            <ToolbarButton onClick={onRevert} disabled={isReverting} ariaLabel="Undo bulk changes">
              <RotateCcw size={14} />
              {isReverting ? 'Undoing…' : 'Undo changes'}
            </ToolbarButton>
          ) : null}
          <ToolbarButton variant="primary" onClick={onClose} disabled={isReverting} ariaLabel="Close bulk receipt">
            Done
          </ToolbarButton>
        </>
      ) : (
        <>
          <ToolbarButton onClick={onClose} disabled={isExecuting}>Cancel</ToolbarButton>
          <ToolbarButton
            variant={hasBlockingIssues ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={!canConfirm}
            ariaLabel={`Confirm ${actionLabel}`}
          >
            {isExecuting ? 'Applying…' : `Confirm ${actionLabel}`}
          </ToolbarButton>
        </>
      )}
    >
      <div className="space-y-5 pt-2" data-testid={isComplete ? 'operational-bulk-result' : 'operational-bulk-preview'}>
        {isLoading ? <p role="status" className="text-sm text-slate-300">Loading the current impact…</p> : null}
        {error ? (
          <div role="alert" className="space-y-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
            <p>{error}</p>
            {onRefresh ? <ToolbarButton onClick={onRefresh} disabled={isLoading || isExecuting}>Review fresh preview</ToolbarButton> : null}
          </div>
        ) : null}
        <div className="rounded-xl border border-white/10 bg-slate-950/70 px-5 py-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Requested action</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-100">
            <span className="font-semibold">{actionLabel}</span>
            {fieldLabel ? <span className="text-slate-500">· {fieldLabel}</span> : null}
            {nextValue !== undefined && nextValue !== null && nextValue !== '' ? (
              <span className="rounded-md border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-xs font-semibold text-blue-200">
                {nextValue}
              </span>
            ) : null}
          </div>
        </div>

        {purgeImpact ? (
          <section
            aria-label="Permanent purge impact"
            data-testid="operational-purge-impact"
            className="space-y-3 rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-4 py-4"
          >
            <div className="flex items-start gap-3 text-rose-100">
              <AlertTriangle size={17} className="mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold">Permanent removal</p>
                <p className="pt-1 text-xs text-rose-100/75">
                  {purgeImpact.permanent && !purgeImpact.recovery_supported
                    ? 'This purge cannot be restored or reverted.'
                    : 'Review the lifecycle recovery policy before confirming.'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2">
                <span className="text-slate-400">Records deleted</span>
                <strong className="float-right text-slate-100">{purgeImpact.aggregate.delete_count}</strong>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-2">
                <span className="text-slate-400">Associations detached</span>
                <strong className="float-right text-slate-100">{purgeImpact.aggregate.detach_count}</strong>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="pb-1 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Deleted by dependency</p>
                <ul className="space-y-1 text-xs text-slate-200">
                  {purgeImpact.aggregate.deletes.map((entry) => (
                    <li key={entry.table} className="flex items-start justify-between gap-2">
                      <span>{entry.type}</span>
                      <span className="shrink-0 text-slate-400">
                        {entry.count} · {entry.disposition === 'database_cascade' ? 'cascade' : entry.disposition === 'explicit_delete' ? 'direct' : entry.disposition}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="pb-1 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Associations detached</p>
                {purgeImpact.aggregate.detaches.length ? (
                  <ul className="space-y-1 text-xs text-slate-200">
                    {purgeImpact.aggregate.detaches.map((entry) => (
                      <li key={entry.table} className="flex items-start justify-between gap-2">
                        <span>{entry.type}{entry.fields?.length ? ` (${entry.fields.join(', ')})` : ''}</span>
                        <span className="shrink-0 text-slate-400">{entry.count}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-xs text-slate-400">No associations will be detached.</p>}
              </div>
            </div>
          </section>
        ) : null}

        {isComplete ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <SummaryCard label="Selected" value={result?.selected_count || 0} tone="neutral" />
              <SummaryCard label="Changed" value={result?.changed_count || 0} tone="success" />
              <SummaryCard label="Unchanged" value={result?.unchanged_count || 0} tone="warning" />
            </div>
            <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Bulk operation completed.</p>
                <p className="pt-1 text-xs text-emerald-200/80">
                  {result?.changed_count || 0} record{result?.changed_count === 1 ? '' : 's'} changed and {result?.unchanged_count || 0} already matched the requested state.
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <SummaryCard label="Selected" value={preview?.selected_count || 0} tone="neutral" />
              <SummaryCard label="Will change" value={preview?.changed_count || 0} tone="success" />
              <SummaryCard label="No change" value={preview?.unchanged_count || 0} tone="warning" />
              <SummaryCard label="Blocked" value={(preview?.blocked_count || 0) + (preview?.missing_count || 0)} tone="danger" />
            </div>

            {preview && preview.changed_count === 0 && !hasBlockingIssues ? (
              <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
                Every matched record already has the requested state. Nothing will be written.
              </div>
            ) : null}

            {preview?.missing_ids?.length ? (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-rose-100">
                  <AlertTriangle size={16} /> Selection changed
                </div>
                <p className="pt-2 text-xs text-rose-200/80">
                  These records no longer exist or are unavailable: {preview.missing_ids.join(', ')}. Refresh the workspace and preview again.
                </p>
              </div>
            ) : null}

            {preview?.blockers?.length ? (
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Blocked records</p>
                {preview.blockers.map((blocker) => (
                  <div key={`${blocker.id}-${blocker.reason}`} className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3">
                    <p className="text-sm font-semibold text-rose-100">{blocker.name || `Record ${blocker.id}`}</p>
                    <p className="pt-1 text-xs text-rose-200/80">{blocker.reason}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </WorkspaceModal>
  )
}
