import React, { useState } from 'react'
import { AlertTriangle, RefreshCcw, ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'

const getErrorDetails = (error: unknown) => {
  if (error instanceof Error) return `${error.name}: ${error.message}\n\n${error.stack || ''}`.trim()
  if (error == null) return 'No technical details were captured.'
  return String(error)
}

export function FatalErrorState({
  error,
  onOpenErrorConsole = () => window.dispatchEvent(new CustomEvent('open-error-console')),
  onReload = () => window.location.reload(),
}: {
  error?: unknown
  onOpenErrorConsole?: () => void
  onReload?: () => void
}) {
  const [showDetails, setShowDetails] = useState(false)
  const details = getErrorDetails(error)

  return (
    <section
      className="flex min-h-full w-full flex-col items-center justify-center overflow-auto bg-[var(--surface-base)] px-6 py-12 text-center text-[var(--text-primary)] sm:px-10"
      role="alert"
      aria-labelledby="sysgrid-fatal-error-title"
      data-sg-state="fatal-error"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--state-danger-border)] bg-[var(--state-danger-surface)] text-[var(--state-danger)]">
        <AlertTriangle size={24} aria-hidden="true" />
      </div>
      <h1 id="sysgrid-fatal-error-title" className="mt-5 text-2xl font-semibold tracking-tight">Unable to render this view</h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-[var(--text-secondary)]">
        The application encountered an unexpected rendering error. Reload the application or open the error console for captured diagnostics.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onOpenErrorConsole}
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
        >
          Open error console
        </button>
        <button
          type="button"
          onClick={onReload}
          className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--action-primary-hover)]"
        >
          <RefreshCcw size={16} aria-hidden="true" />
          Reload application
        </button>
      </div>
      <details className="mt-8 w-full max-w-2xl rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-left" open={showDetails} onToggle={(event) => setShowDetails(event.currentTarget.open)}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--text-secondary)] focus-visible:outline-none">
          Show technical details
        </summary>
        <pre className="max-h-64 overflow-auto border-t border-[var(--border-subtle)] px-4 py-3 text-xs leading-5 text-[var(--text-secondary)]">{details}</pre>
      </details>
    </section>
  )
}

export function PermissionDeniedState({ area, homePath = '/' }: { area: string; homePath?: string }) {
  return (
    <section
      className="flex min-h-full w-full flex-col items-center justify-center overflow-auto bg-[var(--surface-base)] px-6 py-12 text-center text-[var(--text-primary)] sm:px-10"
      role="status"
      aria-labelledby="sysgrid-permission-title"
      data-sg-state="permission-denied"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--state-warning-border)] bg-[var(--state-warning-surface)] text-[var(--state-warning)]">
        <ShieldAlert size={24} aria-hidden="true" />
      </div>
      <h1 id="sysgrid-permission-title" className="mt-5 text-2xl font-semibold tracking-tight">Access unavailable</h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-[var(--text-secondary)]">
        This account does not have permission to view <span className="font-semibold text-[var(--text-primary)]">{area}</span> in the current tenant.
      </p>
      <p className="mt-2 max-w-md text-sm leading-6 text-[var(--text-secondary)]">
        Return to Home, or ask an administrator to grant access if this area is required.
      </p>
      <Link
        to={homePath}
        className="mt-6 inline-flex min-h-10 items-center gap-2 rounded-md bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--action-primary-hover)] focus-visible:outline-none"
      >
        Return to Home
      </Link>
    </section>
  )
}
