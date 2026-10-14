import React, { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Info, Star, Terminal } from 'lucide-react'
import { apiFetch } from '../../api/apiClient'
import { WorkspaceModal } from './WorkspaceModal'
import { ToolbarButton } from './LayoutPrimitives'

type Patch = { version: string; date: string; changes: Array<{ type: string; text: string }> }

export function PatchNotesModal({ onClose, history }: { onClose: () => void; history: Patch[] }) {
  const [expandedIndex, setExpandedIndex] = useState(0)
  const id = useId()
  return (
    <WorkspaceModal isOpen onClose={onClose} title="Registry Updates" icon={<Star size={18} />} size="standard">
      <div className="space-y-3 py-4">
        {history.map((patch, index) => (
          <section key={patch.version} className="overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)]">
            <button type="button" aria-expanded={expandedIndex === index} aria-controls={`${id}-${index}`}
              onClick={() => setExpandedIndex(expandedIndex === index ? -1 : index)}
              className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--surface-hover)]">
              <span className="min-w-0">
                <span className="block break-words text-sm font-semibold text-[var(--text-primary)]">{patch.version}</span>
                <span className="block text-xs text-[var(--text-secondary)]">{patch.date}</span>
              </span>
              <ChevronRight size={16} aria-hidden="true" className={`shrink-0 text-[var(--text-secondary)] ${expandedIndex === index ? 'rotate-90' : ''}`} />
            </button>
            <div id={`${id}-${index}`} hidden={expandedIndex !== index} className="space-y-3 border-t border-[var(--border-subtle)] p-4">
              {patch.changes.map((change, changeIndex) => (
                <div key={changeIndex} className="flex flex-wrap items-start gap-2 text-sm">
                  <span className="rounded border border-[var(--border-default)] bg-[var(--surface-hover)] px-2 py-0.5 text-xs font-medium text-[var(--text-primary)]">{change.type}</span>
                  <span className="min-w-0 flex-1 basis-48 break-words leading-relaxed text-[var(--text-secondary)]">{change.text}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </WorkspaceModal>
  )
}

export function LinuxEnvModal({ onClose }: { onClose: () => void }) {
  const { data, isPending, isError, isFetching, refetch } = useQuery<Record<string, string>>({
    queryKey: ['linux-env-vars'],
    queryFn: async () => {
      try {
        const response = await apiFetch('/api/v1/settings/user/env-vars')
        const values = await response.json()
        if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Environment details could not be read')
        return values
      } catch (error) {
        // The dialog owns the visible error and retry state. Avoid a duplicate
        // global toast that would still cover the recovered values after retry.
        if (error instanceof Error) Object.assign(error, { silent: true })
        throw error
      }
    },
  })
  return (
    <WorkspaceModal isOpen onClose={onClose} title="Environment details" subtitle="Authorized runtime diagnostics" icon={<Terminal size={18} />} size="wide">
      <div className="space-y-4 py-4">
        {isPending && <p role="status" className="text-sm text-[var(--text-secondary)]">Loading environment details…</p>}
        {isError && <div role="alert" className="space-y-3 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] p-4">
          <p className="text-sm text-[var(--text-primary)]">Environment details could not be loaded.</p>
          <p className="text-sm text-[var(--text-secondary)]">Check your connection and diagnostics access, then retry.</p>
          <ToolbarButton disabled={isFetching} onClick={() => void refetch()}>{isFetching ? 'Retrying…' : 'Retry environment details'}</ToolbarButton>
        </div>}
        {!isPending && !isError && (!data || Object.keys(data).length === 0) && <p role="status" className="text-sm text-[var(--text-secondary)]">No environment details are available.</p>}
        {!isError && data && <dl className="space-y-2">
          {Object.entries(data).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => (
            <div key={key} className="grid min-w-0 grid-cols-1 gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <dt className="break-all text-xs font-semibold text-[var(--text-secondary)]">{key}</dt>
              <dd className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-xs text-[var(--text-primary)]">{String(value)}</dd>
            </div>
          ))}
        </dl>}
        <p className="flex items-start gap-2 text-xs leading-relaxed text-[var(--text-secondary)]"><Info size={16} aria-hidden="true" className="shrink-0" />Sensitive values are redacted by the server. These diagnostics describe the hosting environment; changing them requires an authorized deployment update.</p>
      </div>
    </WorkspaceModal>
  )
}
