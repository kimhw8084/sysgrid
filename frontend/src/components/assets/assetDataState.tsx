import React from 'react'
import { fetchOperationalArray } from '../shared/operationalArrayFetch'

export async function fetchAssetArray(endpoint: string): Promise<any[]> {
  return fetchOperationalArray(endpoint, 'Asset data', { silent: true })
}

export function AssetDataState({
  label,
  isLoading = false,
  isError = false,
  isFetching = false,
  onRetry,
  retryLabel,
}: {
  label: string
  isLoading?: boolean
  isError?: boolean
  isFetching?: boolean
  onRetry?: () => void
  retryLabel?: string
}) {
  if (!isLoading && !isError) return null

  return (
    <div role={isError ? 'alert' : 'status'} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--state-warning-border)] bg-[var(--state-warning-surface)] px-3 py-2 text-[10px] font-bold text-[var(--text-primary)]">
      <span>{isError ? `${label} unavailable. Its records are not shown as empty.` : `Loading ${label.toLowerCase()}…`}</span>
      {isError && onRetry ? (
        <button type="button" disabled={isFetching} onClick={onRetry} className="min-h-8 rounded-md border border-[var(--state-warning-border)] px-3 text-[9px] font-black uppercase tracking-wider text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:cursor-wait disabled:opacity-60">
          {isFetching ? 'Retrying…' : retryLabel || `Retry ${label.toLowerCase()}`}
        </button>
      ) : null}
    </div>
  )
}
