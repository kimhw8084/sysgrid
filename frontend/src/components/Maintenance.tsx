import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Plus, RefreshCw } from 'lucide-react'
import { apiFetch, getRequestScopeKey } from '../api/apiClient'
import { useModulePolicy } from '../policy/ModulePolicy'
import { formatAppDate } from '../utils/dateUtils'
import { ToolbarButton } from './shared/LayoutPrimitives'
import { OperationalWorkspaceShell } from './shared/OperationalWorkspaceShells'
import { MaintenancePlan, type MaintenanceWindow, windowIsCancelled } from './maintenance/MaintenancePlan'
import { MaintenanceWindowForm } from './maintenance/MaintenanceWindowForm'
import { MaintenanceAction } from './maintenance/MaintenanceAction'
import { Card, inputClass } from './maintenance/MaintenanceFields'
import { labelStatus, maintenanceError, type ActionCatalog, type OperationalAction } from './maintenance/maintenanceContract'

export default function Maintenance() {
  const [params, setParams] = useSearchParams()
  const [nextAction, setNextAction] = useState<string | null>(null)
  const [windowSaved, setWindowSaved] = useState(false)
  const [limit, setLimit] = useState(100)
  const policy = useModulePolicy()
  const client = useQueryClient()
  const scope = getRequestScopeKey()
  const actionId = params.get('action')
  const planning = params.get('plan') === 'new'
  const windowRoute = params.get('window')
  const deviceFilter = params.get('device_id') || ''
  const statusFilter = params.get('status') || ''
  const deviceId = /^[1-9]\d*$/.test(deviceFilter) && Number.isSafeInteger(Number(deviceFilter)) ? Number(deviceFilter) : undefined
  const invalidDevice = Boolean(deviceFilter && !deviceId)
  const catalog = useQuery<ActionCatalog>({ queryKey: ['maintenance-capabilities', scope], queryFn: async ({ signal }) => (await apiFetch('/api/v1/operational-actions/capabilities', { signal })).json() })
  const actions = useQuery<OperationalAction[]>({
    queryKey: ['maintenance-actions', scope, deviceFilter, statusFilter, limit], enabled: !invalidDevice,
    queryFn: async ({ signal }) => (await apiFetch(`/api/v1/operational-actions?limit=${limit}${deviceId ? `&device_id=${deviceId}` : ''}${statusFilter ? `&status=${encodeURIComponent(statusFilter)}` : ''}`, { signal })).json(),
  })
  const windows = useQuery<MaintenanceWindow[]>({
    queryKey: ['maintenance-windows', scope, deviceFilter], enabled: !invalidDevice && Boolean(policy.data?.modules.assets?.actions?.read),
    queryFn: async ({ signal }) => (await apiFetch(`/api/v1/maintenance${deviceId ? `?device_id=${deviceId}` : ''}`, { signal })).json(),
  })
  const canWrite = Boolean(!policy.isError && !catalog.isError && policy.data?.modules.monitoring?.actions?.write && ['ADMIN', 'EDITOR'].includes(catalog.data?.identity?.access_role || ''))
  const supportedSimulation = catalog.data?.adapter.adapter_id === 'simulation.recording.v1' && catalog.data.adapter.production_capable === false
  const canSchedule = Boolean(!policy.isError && policy.data?.modules.assets?.actions?.write)
  const selectedWindow = windows.data?.find(window => String(window.id) === windowRoute)

  function route(values: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(values)) value === null ? next.delete(key) : next.set(key, value)
    setParams(next)
  }
  useEffect(() => {
    if (!nextAction) return
    // The saved form has rendered its clean state before the guarded navigation.
    const next = new URLSearchParams(params)
    next.delete('plan'); next.set('action', nextAction)
    setParams(next, { replace: true }); setNextAction(null)
  }, [nextAction, params, setParams])
  useEffect(() => {
    if (!windowSaved) return
    const next = new URLSearchParams(params)
    next.delete('window'); next.delete('plan'); next.delete('action')
    setParams(next, { replace: true }); setWindowSaved(false)
  }, [windowSaved, params, setParams])

  return <OperationalWorkspaceShell workspace="maintenance" archetype="hybrid" header={{
    eyebrow: 'Monitoring / Operations', title: 'Maintenance', subtitle: 'Prepare, review and verify operational work with durable evidence.',
    actions: <Link to="/monitoring" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border-default)] px-3 text-xs font-semibold text-[var(--text-primary)]"><ArrowLeft size={14} aria-hidden="true" />Monitoring</Link>,
  }} toolbarSearch={<div className="flex flex-wrap gap-2"><ToolbarButton active={!planning && !actionId && !windowRoute} onClick={() => route({ plan: null, action: null, window: null })}>Action history</ToolbarButton><ToolbarButton disabled={!canWrite || !supportedSimulation || invalidDevice} active={planning} variant="primary" onClick={() => route({ plan: 'new', action: null, window: null })}><Plus size={14} aria-hidden="true" />New plan</ToolbarButton><ToolbarButton disabled={!canSchedule || invalidDevice} active={windowRoute === 'new'} onClick={() => route({ plan: null, action: null, window: 'new' })}><Plus size={14} aria-hidden="true" />New window</ToolbarButton></div>}
    toolbarActions={<ToolbarButton disabled={actions.isFetching || catalog.isFetching} onClick={() => { void actions.refetch(); void catalog.refetch(); if (windows.isEnabled) void windows.refetch(); void policy.refetch() }}><RefreshCw size={14} aria-hidden="true" />Refresh workspace</ToolbarButton>}>
    <div data-maintenance-content className="min-h-0 flex-1 space-y-4 overflow-auto pb-6 pr-1 text-[var(--text-primary)]">
      <div className="rounded-lg border border-[var(--state-warning-border)] bg-[var(--state-warning-surface)] p-4 text-sm text-[var(--text-primary)]"><strong>Simulation only.</strong> This workspace uses the deterministic recording adapter. It records workflow outcomes without changing company systems. Live adapter execution is not enabled here.</div>
      {invalidDevice && <p role="alert">The asset filter is invalid. <button className="underline" onClick={() => route({ device_id: null })}>Clear asset filter</button></p>}
      {catalog.isPending && <p role="status">Loading operational capabilities…</p>}
      {catalog.isError && <Card title="Capabilities unavailable"><p role="alert">{maintenanceError(catalog.error)}</p><ToolbarButton onClick={() => void catalog.refetch()}>Retry capabilities</ToolbarButton></Card>}
      {windowRoute && !invalidDevice && <>
        {windowRoute === 'new' || selectedWindow ? <MaintenanceWindowForm key={`${scope}:${windowRoute}`} window={selectedWindow} initialDeviceId={deviceId} canWrite={canSchedule && !windows.isError} onSaved={() => setWindowSaved(true)} /> : <Card title="Window unavailable"><p role="status">{windows.isPending && windows.isEnabled ? 'Loading this window…' : 'This window could not be found in the current scope. Refresh the workspace or return to history.'}</p></Card>}
      </>}
      {!windowRoute && planning && catalog.data && <>
        {!canWrite && <Card title="Planning read only"><p>A tenant mutation role and Monitoring write permission are required to save. Your current draft is retained. Refresh after an access change.</p></Card>}
        {!supportedSimulation ? <Card title="Adapter unavailable"><p>This workspace has not been qualified for the configured adapter. No execution controls are enabled.</p></Card> : invalidDevice ? null : <>
          {windows.isError && <p role="alert">Maintenance windows could not be loaded. You may record scheduling notes, or retry the workspace to link an existing window.</p>}
          <MaintenancePlan key={deviceFilter} catalog={catalog.data} windows={windows.data || []} initialDeviceId={deviceId} canWrite={canWrite} onCreated={action => { client.setQueryData(['maintenance-action', scope, action.id], action); void client.invalidateQueries({ queryKey: ['maintenance-actions'] }); setNextAction(action.id) }} />
        </>}
      </>}
      {!windowRoute && !planning && actionId && catalog.data && <div className="space-y-4"><MaintenanceAction key={`${scope}:${actionId}`} id={actionId} actorId={catalog.data.identity?.actor_id || ''} canWrite={canWrite && supportedSimulation} /></div>}
      {!windowRoute && !planning && !actionId && !invalidDevice && <>
        <Card title={deviceId ? `Action history for asset #${deviceId}` : 'Action history'}>
          <div className="flex flex-wrap items-center gap-3"><label className="min-w-0 space-y-1.5 text-xs font-semibold text-[var(--text-secondary)]"><span>Status</span><select className={inputClass} value={statusFilter} onChange={event => route({ status: event.target.value || null })}><option value="">All statuses</option>{['CREATED', 'PREVIEWED', 'AUTHORIZED', 'CONFIRMED', 'STALE', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'VERIFIED', 'VERIFICATION_FAILED', 'ROLLBACK_REQUESTED', 'ROLLING_BACK', 'ROLLED_BACK', 'ROLLBACK_FAILED', 'RECOVERY_REQUIRED', 'RECOVERED'].map(status => <option key={status} value={status}>{labelStatus(status)}</option>)}</select></label>{deviceId && <ToolbarButton onClick={() => route({ device_id: null })}>Clear asset filter</ToolbarButton>}</div>
          {actions.isPending && <p role="status">Loading action history…</p>}
          {actions.isError && <div role="alert"><p>{maintenanceError(actions.error)}</p><ToolbarButton onClick={() => void actions.refetch()}>Retry history</ToolbarButton></div>}
          {!actions.isPending && !actions.isError && actions.data?.length === 0 && <p className="text-sm text-[var(--text-secondary)]">No recorded actions match this scope. Create a plan to begin a simulation workflow.</p>}
          <ul className="space-y-2">{actions.data?.map(action => <li key={action.id}><Link to={`?workspace=maintenance&action=${encodeURIComponent(action.id)}${deviceId ? `&device_id=${deviceId}` : ''}`} className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--border-default)] p-4 hover:bg-[var(--surface-hover)]"><span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold">{String(action.change_context.title || action.action_key)}</span><span className="mt-1 block text-xs text-[var(--text-secondary)]">{action.targets.length} assets · {action.actor_id} · {formatAppDate(action.requested_at)}</span></span><span className="text-xs font-semibold capitalize">{labelStatus(action.status)}</span></Link></li>)}</ul>
          <p className="text-xs text-[var(--text-secondary)]">Showing up to {limit} newest matching actions.</p>{actions.data?.length === limit && limit < 500 && <ToolbarButton onClick={() => setLimit(500)}>Load up to 500 actions</ToolbarButton>}
        </Card>
        {windows.isEnabled && <Card title="Maintenance windows">
          {windows.isPending && <p role="status">Loading windows…</p>}{windows.isError && <p role="alert">{maintenanceError(windows.error)}</p>}
          {!windows.isPending && !windows.isError && windows.data?.length === 0 && <p className="text-sm text-[var(--text-secondary)]">No maintenance windows are recorded in this scope.</p>}
          <p className="text-xs text-[var(--text-secondary)]">Dates are displayed in your local time. Windows record scheduling intent; actions require separate review and confirmation.</p>
          <ul className="space-y-3">{windows.data?.map(window => <li key={window.id} className="rounded-lg border border-[var(--border-default)] p-3 text-sm"><p className="break-words font-semibold">{window.title} · {window.status || 'Status not recorded'}</p><p className="mt-1 text-xs text-[var(--text-secondary)]">{window.device_name} · {formatAppDate(window.start_time)} — {formatAppDate(window.end_time)}</p>{window.cancellation_reason && <p className="mt-2 break-words text-xs text-[var(--text-secondary)]">Canceled by {window.cancelled_by} · {formatAppDate(window.cancelled_at)} · {window.cancellation_reason}</p>}<div className="flex flex-wrap gap-4"><Link className="mt-2 inline-flex min-h-10 items-center text-xs underline" to={`?workspace=maintenance&device_id=${window.device_id}`}>View asset maintenance history</Link>{canSchedule && !windowIsCancelled(window) && <Link className="mt-2 inline-flex min-h-10 items-center text-xs underline" to={`?workspace=maintenance&window=${window.id}${deviceId ? `&device_id=${deviceId}` : ''}`}>Cancel window</Link>}</div></li>)}</ul>
        </Card>}
      </>}
    </div>
  </OperationalWorkspaceShell>
}
