import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { History, Clock } from 'lucide-react'
import { apiFetch } from '../../api/apiClient'
import { formatAppDate } from '../../utils/dateUtils'
import { WorkspaceModal } from '../shared/WorkspaceModal'
import { WorkspaceEmptyState, useBodyModalFlag, useEscapeDismiss } from '../shared/OperationalWorkspacePrimitives'

type AuditRecord = {
  id: number
  timestamp: string
  user_id?: string | null
  action: string
  target_table: string
  target_id: string
  description: string
  changes?: unknown
}

export function NetworkActivityModal({ item, onClose }: { item: { id: number; title?: string; name?: string }; onClose: () => void }) {
  useEscapeDismiss(onClose)
  useBodyModalFlag()
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null)
  const { data: events = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['network-activity', item.id],
    queryFn: async (): Promise<AuditRecord[]> => {
      const query = new URLSearchParams({ target_table: 'port_connections', target_id: String(item.id), limit: '200', offset: '0' })
      const response = await apiFetch(`/api/v1/audit?${query.toString()}`)
      if (!response.ok) throw new Error(await response.text() || `Activity history could not be loaded (HTTP ${response.status}).`)
      const body: unknown = await response.json()
      if (!Array.isArray(body)) throw new Error('Activity history returned an invalid response.')
      return body as AuditRecord[]
    },
  })
  const selected = events.find(event => event.id === selectedEventId) || events[0]

  return (
    <WorkspaceModal
      isOpen
      onClose={onClose}
      size="workspace"
      title="Connection activity"
      subtitle={`Recorded changes for ${item.title || item.name || `connection ${item.id}`}`}
      icon={<History size={20} aria-hidden="true" />}
      footerRight={<button type="button" onClick={onClose} className="rounded-lg border border-[var(--border-default)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)]">Close</button>}
    >
      <div className="grid min-h-[24rem] grid-cols-1 gap-4 p-4 md:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.2fr)] md:p-6">
        <section aria-label="Connection activity records" className="min-w-0 overflow-y-auto rounded-xl border border-[var(--border-default)]">
          <h2 className="sticky top-0 z-10 border-b border-[var(--border-default)] bg-[var(--surface-raised)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">Recent activity</h2>
          {isLoading ? (
            <p role="status" className="p-5 text-sm text-[var(--text-secondary)]">Loading activity…</p>
          ) : isError ? (
            <WorkspaceEmptyState compact icon={<History size={20} />} title="Activity unavailable" description={error instanceof Error ? error.message : 'The activity record could not be loaded.'} action={<button type="button" onClick={() => void refetch()} className="rounded-lg border border-[var(--border-default)] px-3 py-2 text-sm font-semibold">Retry</button>} />
          ) : events.length ? (
            <ol className="divide-y divide-[var(--border-subtle)]">
              {events.map(event => (
                <li key={event.id}>
                  <button
                    type="button"
                    aria-current={selected?.id === event.id ? 'true' : undefined}
                    onClick={() => setSelectedEventId(event.id)}
                    className="w-full p-4 text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent-primary)]"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-primary)]">{event.action}</span>
                      <time className="shrink-0 text-xs text-[var(--text-secondary)]" dateTime={event.timestamp}>{formatAppDate(event.timestamp)}</time>
                    </span>
                    <span className="mt-1 block break-words text-sm text-[var(--text-secondary)]">{event.description || 'Recorded connection change'}</span>
                    <span className="mt-2 block text-xs text-[var(--text-secondary)]">Recorded by {event.user_id || 'Unknown user'}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <WorkspaceEmptyState compact icon={<History size={20} />} title="No activity recorded" description="Changes recorded for this connection will appear here." />
          )}
        </section>

        <section aria-label="Selected activity details" className="min-w-0 rounded-xl border border-[var(--border-default)] p-4 md:p-5">
          {selected ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{selected.action}</p>
                  <h2 className="mt-1 break-words text-lg font-semibold text-[var(--text-primary)]">{selected.description || 'Recorded connection change'}</h2>
                </div>
                <span className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)]"><Clock size={14} aria-hidden="true" /><time dateTime={selected.timestamp}>{formatAppDate(selected.timestamp)}</time></span>
              </div>
              <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-xs font-semibold text-[var(--text-secondary)]">Connection ID</dt><dd className="mt-1 break-all font-mono text-[var(--text-primary)]">{selected.target_id}</dd></div>
                <div><dt className="text-xs font-semibold text-[var(--text-secondary)]">Recorded by</dt><dd className="mt-1 break-words text-[var(--text-primary)]">{selected.user_id || 'Unknown user'}</dd></div>
              </dl>
              <h3 className="mt-5 text-sm font-semibold text-[var(--text-primary)]">Recorded change data</h3>
              <pre className="mt-2 max-h-[45vh] overflow-auto rounded-lg bg-[var(--surface-sunken)] p-3 text-xs leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap break-words">{JSON.stringify(selected.changes ?? {}, null, 2)}</pre>
              {events.length >= 200 && <p className="mt-3 text-xs text-[var(--text-secondary)]">Showing up to the 200 most recent records.</p>}
              <p className="mt-3 text-xs text-[var(--text-secondary)]">This is a read-only audit view. Restore actions remain available only for deleted connections in the registry.</p>
            </>
          ) : !isLoading && !isError ? (
            <WorkspaceEmptyState icon={<History size={28} />} title="Select an activity record" description="Choose an entry to inspect its recorded details." />
          ) : null}
        </section>
      </div>
    </WorkspaceModal>
  )
}
