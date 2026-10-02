import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, getRequestScopeKey } from '../../api/apiClient'
import { ToolbarButton } from '../shared/LayoutPrimitives'
import { formatAppDate } from '../../utils/dateUtils'
import { Card, DraftGuard, Field, inputClass } from './MaintenanceFields'
import { maintenanceError, type ActionCatalog, type OperationalAction } from './maintenanceContract'

export type MaintenanceWindow = { id: number; device_id: number; device_name: string; title: string; status: string; start_time: string | null; end_time: string | null }
type Asset = { id: number; name: string; status: string; system: string }

export function MaintenancePlan({ catalog, windows, initialDeviceId, canWrite, onCreated }: {
  catalog: ActionCatalog; windows: MaintenanceWindow[]; initialDeviceId?: number; canWrite: boolean; onCreated: (action: OperationalAction) => void
}) {
  const definitions = catalog.capabilities.filter(item => item.supported).flatMap(item => item.actions)
  const client = useQueryClient()
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [actionKey, setActionKey] = useState(definitions[0]?.action_key || '')
  const [selected, setSelected] = useState<number[]>(initialDeviceId ? [initialDeviceId] : [])
  const [filter, setFilter] = useState('')
  const [title, setTitle] = useState('')
  const [ticket, setTicket] = useState('')
  const [owner, setOwner] = useState('')
  const [windowId, setWindowId] = useState('')
  const [windowNotes, setWindowNotes] = useState('')
  const [service, setService] = useState('')
  const [notes, setNotes] = useState('')
  const [outcome, setOutcome] = useState('success')
  const [rollbackOutcome, setRollbackOutcome] = useState('success')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const requestRef = useRef<{ key: string; body: string } | null>(null)
  const assets = useInfiniteQuery<Asset[]>({
    queryKey: ['maintenance-assets', getRequestScopeKey()], initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => (await apiFetch(`/api/v1/devices/summary?limit=100&offset=${pageParam}`, { signal })).json(),
    getNextPageParam: (last, pages) => last.length === 100 ? pages.length * 100 : undefined,
  })
  const rows = assets.data?.pages.flat() || []
  const visible = rows.filter(asset => `${asset.name} ${asset.system} ${asset.id}`.toLowerCase().includes(filter.toLowerCase()))
  const definition = definitions.find(item => item.action_key === actionKey)
  const locked = busy || uncertain || saved || !canWrite
  const dirty = !saved && (Boolean(title || ticket || owner || windowNotes || notes || service || windowId) || selected.length > 0 || actionKey !== definitions[0]?.action_key || outcome !== 'success' || rollbackOutcome !== 'success')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busyRef.current || !canWrite || !definition || !selected.length || !title.trim()) return
    busyRef.current = true
    setBusy(true); setError('')
    if (!uncertain) requestRef.current = {
      key: crypto.randomUUID(),
      body: JSON.stringify({
        action_key: actionKey, adapter_id: definition.adapter_id, target_device_ids: selected,
        maintenance_window_id: windowId ? Number(windowId) : null, ticket_reference: ticket.trim() || null,
        change_context: { title: title.trim(), owner: owner.trim(), window_notes: windowNotes.trim(), notes: notes.trim() },
        parameters: { ...(service.trim() ? { service_name: service.trim() } : {}), simulation_outcome: outcome, simulation_rollback_outcome: rollbackOutcome },
      }),
    }
    const request = requestRef.current!
    try {
      const result: OperationalAction = await (await apiFetch('/api/v1/operational-actions', { method: 'POST', headers: { 'Idempotency-Key': request.key }, body: request.body })).json()
      void client.invalidateQueries({ queryKey: ['maintenance-actions'] })
      if (!mounted.current) return
      setSaved(true)
      onCreated(result)
    } catch (failure) {
      const status = (failure as { status?: number }).status || 0
      setUncertain(status === 0 || status >= 500)
      setError(maintenanceError(failure))
    } finally { busyRef.current = false; setBusy(false) }
  }

  return <>
    <DraftGuard dirty={dirty || busy} />
    <form onSubmit={submit} className="space-y-4" aria-label="Maintenance plan">
      <Card title="Prepare a plan">
        <p className="text-sm text-[var(--text-secondary)]">Record intent and target assets. Saving a plan does not execute it. Keep credential values out of all notes and references.</p>
        <fieldset disabled={locked} className="grid min-w-0 gap-4 md:grid-cols-2">
          <Field label="Plan title" value={title} onChange={setTitle} required maxLength={200} />
          <div className="space-y-1.5"><label htmlFor="maintenance-action" className="text-xs font-semibold text-[var(--text-secondary)]">Action *</label><select id="maintenance-action" className={inputClass} value={actionKey} onChange={event => setActionKey(event.target.value)} required>{definitions.map(item => <option key={item.action_key} value={item.action_key}>{item.title}</option>)}</select></div>
          <Field label="Ticket reference" value={ticket} onChange={setTicket} />
          <Field label="Plan owner" value={owner} onChange={setOwner} />
          <Field label="Window / scheduling notes" value={windowNotes} onChange={setWindowNotes} />
          {actionKey === 'service.restart' && <Field label="Service name (simulation)" value={service} onChange={setService} required />}
          <div className="md:col-span-2"><Field label="Change and precondition notes" value={notes} onChange={setNotes} multiline maxLength={2000} /></div>
        </fieldset>
        {definition && <p className="text-sm text-[var(--text-secondary)]"><strong className="text-[var(--text-primary)]">{definition.risk_tier} risk.</strong> {definition.description}{definition.requires_approval ? ' Approval and recovery references are required before confirmation.' : ' Review and confirmation are required before execution.'}</p>}
      </Card>
      <Card title={`Target assets (${selected.length} / 250)`}>
        <Field label="Filter loaded assets" value={filter} onChange={setFilter} disabled={locked} />
        {selected.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Selected assets">{selected.map(id => <button key={id} type="button" disabled={locked} onClick={() => { setSelected(current => current.filter(value => value !== id)); setWindowId('') }} className="min-h-10 rounded-lg border border-[var(--border-default)] px-3 text-xs text-[var(--text-primary)]" aria-label={`Remove asset ${id}`}>{rows.find(row => row.id === id)?.name || `Asset ${id}`} ×</button>)}</div>}
        {assets.isPending && <p role="status">Loading assets…</p>}
        {assets.isError && <div role="alert"><p>{maintenanceError(assets.error)}</p><ToolbarButton onClick={() => void assets.refetch()}>Retry assets</ToolbarButton></div>}
        <div className="max-h-64 space-y-1 overflow-auto" role="group" aria-label="Available assets">{visible.map(asset => <label key={asset.id} className="flex min-h-10 items-center gap-3 rounded-lg px-2 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"><input type="checkbox" checked={selected.includes(asset.id)} disabled={locked || asset.status === 'Decommissioned' || (!selected.includes(asset.id) && selected.length >= 250)} onChange={event => { setSelected(current => event.target.checked ? [...current, asset.id] : current.filter(id => id !== asset.id)); setWindowId('') }} /><span className="min-w-0 break-words">{asset.name} <span className="text-xs text-[var(--text-secondary)]">#{asset.id} · {asset.status}</span></span></label>)}</div>
        {!assets.isPending && !assets.isError && !visible.length && <p className="text-sm text-[var(--text-secondary)]">No matching assets in the loaded set.</p>}
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]"><span>{rows.length} assets loaded, newest first.</span>{assets.hasNextPage && <ToolbarButton disabled={assets.isFetchingNextPage || locked} onClick={() => void assets.fetchNextPage()}>{assets.isFetchingNextPage ? 'Loading…' : 'Load more assets'}</ToolbarButton>}</div>
        <div className="space-y-1.5"><label htmlFor="maintenance-window" className="text-xs font-semibold text-[var(--text-secondary)]">Existing maintenance window (optional)</label><select id="maintenance-window" disabled={locked} className={inputClass} value={windowId} onChange={event => setWindowId(event.target.value)}><option value="">No linked window</option>{windows.filter(window => selected.includes(window.device_id)).map(window => <option key={window.id} value={window.id}>{window.title} · {formatAppDate(window.start_time)}</option>)}</select></div>
      </Card>
      <Card title="Simulation outcomes">
        <p className="text-sm text-[var(--text-secondary)]">Exercise the recovery workflow safely. The recording adapter performs no external operation.</p>
        <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">{[{ label: 'Execution outcome', value: outcome, set: setOutcome }, { label: 'Rollback outcome', value: rollbackOutcome, set: setRollbackOutcome }].map(field => <label key={field.label} className="space-y-1.5 text-xs font-semibold text-[var(--text-secondary)]"><span>{field.label}</span><select className={inputClass} value={field.value} onChange={event => field.set(event.target.value)}><option value="success">Success</option><option value="failure">Failure</option></select></label>)}</fieldset>
      </Card>
      {error && <div role="alert" className="rounded-lg border border-[var(--state-danger-border)] bg-[var(--state-danger-surface)] p-4 text-sm text-[var(--state-danger)]">{error}{uncertain && <p className="mt-2">The save outcome is unknown. Recover using the same request below; do not submit a duplicate plan. You can also inspect the recorded history.</p>}</div>}
      <button type="submit" disabled={busy || saved || !canWrite || !selected.length || !definition || !title.trim()} className="min-h-10 rounded-lg bg-[var(--action-primary)] px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving plan…' : uncertain ? 'Recover saved plan' : 'Save plan'}</button>
    </form>
  </>
}
