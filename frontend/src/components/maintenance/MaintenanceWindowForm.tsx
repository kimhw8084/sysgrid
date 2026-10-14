import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, getRequestScopeKey } from '../../api/apiClient'
import { formatAppDate } from '../../utils/dateUtils'
import { ConfirmationModal } from '../shared/ConfirmationModal'
import { ToolbarButton } from '../shared/LayoutPrimitives'
import { Card, DraftGuard, Field, inputClass } from './MaintenanceFields'
import { maintenanceError } from './maintenanceContract'
import { type MaintenanceWindow, windowIsCancelled } from './MaintenancePlan'

type Asset = { id: number; name: string; system: string; status: string }

export function MaintenanceWindowForm({ window, initialDeviceId, canWrite, onSaved }: {
  window?: MaintenanceWindow; initialDeviceId?: number; canWrite: boolean; onSaved: () => void
}) {
  const client = useQueryClient()
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [title, setTitle] = useState('')
  const [deviceId, setDeviceId] = useState(initialDeviceId ? String(initialDeviceId) : '')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [ticket, setTicket] = useState('')
  const [coordinator, setCoordinator] = useState('')
  const [reason, setReason] = useState('')
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [uncertain, setUncertain] = useState(false)
  const [saved, setSaved] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const requestRef = useRef<{ key: string; body: string } | null>(null)
  const assets = useInfiniteQuery<Asset[]>({
    queryKey: ['maintenance-assets', getRequestScopeKey()], enabled: !window, initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => (await apiFetch(`/api/v1/devices/summary?limit=100&offset=${pageParam}`, { signal })).json(),
    getNextPageParam: (last, pages) => last.length === 100 ? pages.length * 100 : undefined,
  })
  const rows = assets.data?.pages.flat() || []
  const visible = rows.filter(asset => String(asset.id) === deviceId || `${asset.name} ${asset.system} ${asset.id}`.toLowerCase().includes(filter.toLowerCase()))
  const cancelled = window && windowIsCancelled(window)
  const locked = busy || uncertain || saved || !canWrite || Boolean(cancelled)
  const dirty = !saved && Boolean(window ? reason : title || deviceId || start || end || ticket || coordinator)

  async function save() {
    if (busyRef.current || !canWrite || cancelled || saved) return
    if (!uncertain) {
      if (window ? !reason.trim() : !title.trim() || !deviceId || !start || !end) return
      if (!window && (!Number.isFinite(Date.parse(`${start}Z`)) || !Number.isFinite(Date.parse(`${end}Z`)) || Date.parse(`${end}Z`) <= Date.parse(`${start}Z`))) {
        setError('End time must be after start time. Enter both times in UTC.'); return
      }
      requestRef.current = { key: crypto.randomUUID(), body: JSON.stringify(window ? { reason: reason.trim() } : {
        device_id: Number(deviceId), title: title.trim(), start_time: `${start}Z`, end_time: `${end}Z`,
        ticket_number: ticket.trim() || null, coordinator: coordinator.trim() || null,
      }) }
    }
    busyRef.current = true; setBusy(true); setError(''); setConfirm(false)
    try {
      await apiFetch(`/api/v1/maintenance${window ? `/${window.id}/cancel` : ''}`, {
        method: 'POST', headers: { 'Idempotency-Key': requestRef.current!.key }, body: requestRef.current!.body,
      })
      void client.invalidateQueries({ queryKey: ['maintenance-windows'] })
      void client.invalidateQueries({ queryKey: ['maintenance-action'] })
      if (!mounted.current) return
      setSaved(true); onSaved()
    } catch (failure) {
      if (!mounted.current) return
      const status = (failure as { status?: number }).status || 0
      setUncertain(status === 0 || status >= 500); setError(maintenanceError(failure))
    } finally { busyRef.current = false; if (mounted.current) setBusy(false) }
  }

  return <>
    <DraftGuard dirty={dirty || busy} />
    <form aria-label={window ? 'Cancel maintenance window' : 'Create maintenance window'} onSubmit={event => { event.preventDefault(); if (window && !uncertain) setConfirm(true); else void save() }} className="space-y-4">
      <Card title={window ? 'Cancel maintenance window' : 'Schedule a maintenance window'}>
        <p className="text-sm text-[var(--text-secondary)]">Windows record planned work. They do not start actions automatically or enforce an execution time. Keep credential values out of notes.</p>
        {!canWrite && <p role="status">Assets write permission is required. Your draft is retained.</p>}
        {window ? <>
          <div className="space-y-2 text-sm"><p className="break-words font-semibold">{window.title} · {window.status}</p><p>{window.device_name} · {formatAppDate(window.start_time)} — {formatAppDate(window.end_time)}</p></div>
          {cancelled ? <p role="status">This window was canceled. {window.cancellation_reason}</p> : <>
            <p className="text-sm text-[var(--text-secondary)]">Cancellation retains this window and action history, and blocks new forward execution linked to it. Finish or reconcile active attempts first. Verification and recovery of completed work remain available.</p>
            <Field label="Cancellation reason" value={reason} onChange={setReason} required multiline maxLength={2000} disabled={locked} />
          </>}
        </> : <>
          <fieldset disabled={locked} className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field label="Window title" value={title} onChange={setTitle} required /></div>
            <Field label="Ticket reference" value={ticket} onChange={setTicket} />
            <Field label="Coordinator" value={coordinator} onChange={setCoordinator} />
            <label className="space-y-1.5 text-xs font-semibold text-[var(--text-secondary)]"><span>Start time (UTC) *</span><input aria-label="Start time (UTC)" type="datetime-local" required className={inputClass} value={start} onChange={event => setStart(event.target.value)} /></label>
            <label className="space-y-1.5 text-xs font-semibold text-[var(--text-secondary)]"><span>End time (UTC) *</span><input aria-label="End time (UTC)" type="datetime-local" required className={inputClass} value={end} onChange={event => setEnd(event.target.value)} /></label>
          </fieldset>
          <p className="text-xs text-[var(--text-secondary)]">Enter UTC, regardless of your computer’s time zone. Saved windows are displayed in your local time.</p>
          <Field label="Filter loaded assets" value={filter} onChange={setFilter} disabled={locked} />
          {assets.isPending && <p role="status">Loading assets…</p>}
          {assets.isError && <div role="alert"><p>{maintenanceError(assets.error)}</p><ToolbarButton onClick={() => void assets.refetch()}>Retry assets</ToolbarButton></div>}
          <label className="block space-y-1.5 text-xs font-semibold text-[var(--text-secondary)]"><span>Window asset *</span><select className={inputClass} value={deviceId} onChange={event => setDeviceId(event.target.value)} disabled={locked} required>
            <option value="">Select an asset</option>
            {deviceId && !rows.some(asset => String(asset.id) === deviceId) && <option value={deviceId}>Asset #{deviceId} (reference will be validated on save)</option>}
            {visible.map(asset => <option key={asset.id} value={asset.id}>{asset.name} · #{asset.id} · {asset.status}</option>)}
          </select></label>
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]"><span>{rows.length} assets loaded, newest first.</span>{assets.hasNextPage && <ToolbarButton disabled={locked || assets.isFetchingNextPage} onClick={() => void assets.fetchNextPage()}>Load more assets</ToolbarButton>}</div>
        </>}
      </Card>
      {error && <div role="alert" className="rounded-lg border border-[var(--state-danger-border)] bg-[var(--state-danger-surface)] p-4 text-sm text-[var(--state-danger)]">{error}{uncertain && <p className="mt-2">The save outcome is unknown. Recover the same request below to avoid a duplicate. The original values are retained.</p>}</div>}
      {!cancelled && <button type="submit" disabled={busy || saved || !canWrite || (window ? !reason.trim() : !title.trim() || !deviceId || !start || !end)} className="min-h-10 rounded-lg bg-[var(--action-primary)] px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving window…' : uncertain ? 'Recover window request' : window ? 'Review cancellation' : 'Save window'}</button>}
    </form>
    <ConfirmationModal isOpen={confirm} onClose={() => setConfirm(false)} onConfirm={() => { void save() }} title="Cancel this maintenance window?" message="The window and its history will remain. New forward execution linked to this window will be blocked. Recovery work remains available." confirmText="Cancel window" cancelText="Keep window" variant="warning" />
  </>
}
