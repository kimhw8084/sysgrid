import React from 'react'
import { fetchOperationalArray } from './shared/operationalArrayFetch'

export async function fetchRackArray(endpoint: string): Promise<any[]> {
  return fetchOperationalArray(endpoint, 'Rack request')
}

export function RackDataState({
  label,
  isLoading = false,
  isError = false,
  isFetching = false,
  hasData = false,
  onRetry,
}: {
  label: string
  isLoading?: boolean
  isError?: boolean
  isFetching?: boolean
  hasData?: boolean
  onRetry?: () => void
}) {
  if (!isLoading && !isError) return null

  return (
    <div role={isError ? 'alert' : 'status'} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--state-warning-border)] bg-[var(--state-warning-surface)] px-4 py-3 text-sm text-[var(--text-primary)]">
      <span>
        {isError
          ? `${label} could not be loaded. ${hasData ? 'Previously loaded data remains visible.' : 'An empty result has not been confirmed.'}`
          : `Loading ${label.toLowerCase()}…`}
      </span>
      {isError && onRetry ? (
        <button
          type="button"
          disabled={isFetching}
          onClick={onRetry}
          className="min-h-9 rounded-md border border-[var(--state-warning-border)] px-3 text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--state-warning-surface)] disabled:cursor-wait disabled:opacity-60"
        >
          {isFetching ? 'Retrying…' : `Retry ${label.toLowerCase()}`}
        </button>
      ) : null}
    </div>
  )
}
