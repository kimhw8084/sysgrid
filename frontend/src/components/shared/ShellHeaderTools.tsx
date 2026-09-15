import React from 'react'
import { Bell, Bug, Settings } from 'lucide-react'
import { Link } from 'react-router-dom'
import { TenantSelector } from './TenantSelector'

type ErrorSummary = { acknowledged?: boolean }

export function ShellHeaderTools({
  pathname,
  isOnline,
  isHealthLoading,
  isHealthError,
  latency,
  errors,
  onOpenErrorConsole,
  compact = false,
}: {
  pathname: string
  isOnline: boolean
  isHealthLoading: boolean
  isHealthError: boolean
  latency: number
  errors: ErrorSummary[]
  onOpenErrorConsole: () => void
  compact?: boolean
}) {
  const outstandingErrors = errors.filter((error) => !error.acknowledged).length
  const statusLabel = isHealthError ? 'Unavailable' : isHealthLoading ? 'Checking' : isOnline ? 'Operational' : 'Unavailable'
  const statusTone = isHealthError || (!isHealthLoading && !isOnline) ? 'text-[var(--state-danger)]' : isOnline ? 'text-[var(--state-success)]' : 'text-[var(--text-secondary)]'

  const tools = (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
      <TenantSelector />
      <div className="min-w-[6.5rem] border-l border-[var(--border-subtle)] pl-3" role="status" aria-live="polite" aria-label={`System status: ${statusLabel}`}>
        <span className="block text-[10px] font-medium text-[var(--text-muted)]">System status</span>
        <span className={`text-sm font-semibold ${statusTone}`}>{statusLabel}</span>
        {isOnline ? <span className="ml-2 text-xs tabular-nums text-[var(--text-muted)]">{latency} ms</span> : null}
      </div>
      <button
        type="button"
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onOpenErrorConsole}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
        aria-label={outstandingErrors ? `Open error console, ${outstandingErrors} unacknowledged errors` : 'Open error console'}
        title="Open error console"
      >
        <Bug size={18} aria-hidden="true" />
        {outstandingErrors > 0 ? <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-[var(--state-danger)] px-1 text-center text-[10px] font-semibold leading-5 text-white">{outstandingErrors}</span> : null}
      </button>
      <Link
        to="/settings"
        className={`inline-flex h-10 w-10 items-center justify-center rounded-md border ${pathname === '/settings' ? 'border-[var(--action-primary)] bg-[var(--action-primary)] text-white' : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'}`}
        aria-current={pathname === '/settings' ? 'page' : undefined}
        aria-label="Open settings"
        title="Settings"
      >
        <Settings size={18} aria-hidden="true" />
      </Link>
    </div>
  )

  return compact ? (
    <details className="sg-app-tools relative min-w-0 max-w-full">
      <summary className="min-h-10 cursor-pointer rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none">App tools</summary>
      <div className="absolute right-3 top-14 z-30 max-w-[calc(100vw-1.5rem)] rounded-md border border-[var(--border-default)] bg-[var(--surface-overlay)] p-3 shadow-xl">{tools}</div>
    </details>
  ) : tools
}
