import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiFetch, getRequestScopeKey } from '../../api/apiClient'
import { formatAppDate, parseAppDate } from '../../utils/dateUtils'
import { ToolbarButton } from '../shared/LayoutPrimitives'
import { useWorkspaceConfirmation } from '../shared/useWorkspaceConfirmation'
import { Card, DraftGuard, Field, inputClass } from './MaintenanceFields'
import { actionControls, isActiveAttempt, labelStatus, maintenanceError, type OperationalAction } from './maintenanceContract'

function Facts({ value }: { value: Record<string, unknown> }) {
  return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-base)] p-3 text-xs text-[var(--text-secondary)]">{JSON.stringify(value, null, 2)}</pre>
}

export function MaintenanceAction({ id, actorId, canWrite }: { id: string; actorId: string; canWrite: boolean }) {
  const client = useQueryClient()
  const key = ['maintenance-action', getRequestScopeKey(), id]
  const query = useQuery<OperationalAction>({
    queryKey: key, queryFn: async ({ signal }) => (await apiFetch(`/api/v1/operational-actions/${encodeURIComponent(id)}`, { signal })).json(),
    refetchInterval: query => query.state.data?.attempts.some(item => isActiveAttempt(item.status)) ? 2000 : false,
  })
  const [approval, setApproval] = useState('')
  const [recovery, setRecovery] = useState('')
  const [summary, setSummary] = useState('')
  const [reference, setReference] = useState('')
  const [verification, setVerification] = useState('success')
  const [recoveryOutcome, setRecoveryOutcome] = useState('unresolved')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState('')
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const rollbackRequest = useRef<{ attemptId: string; body: Record<string, unknown> } | null>(null)
  const { confirm, confirmation } = useWorkspaceConfirmation()
  const dirty = Boolean(approval || recovery || summary || reference || acknowledged)

  async function perform(operation: string, body: Record<string, unknown> | (() => Record<string, unknown>), question?: string) {
    if (busyRef.current) return
    busyRef.current = true
    if (question && !await confirm({ title: question, message: 'This changes the recorded simulation lifecycle. No external operation will be performed. Review the current targets, state and evidence before continuing.', confirmText: 'Continue', variant: 'warning' })) {
      busyRef.current = false
      return
    }
    setBusy(operation); setError('')
    try {
      const result: OperationalAction = await (await apiFetch(`/api/v1/operational-actions/${encodeURIComponent(id)}/${operation}`, { method: 'POST', body: JSON.stringify(typeof body === 'function' ? body() : body) })).json()
      client.setQueryData(key, result)
      await client.invalidateQueries({ queryKey: ['maintenance-actions'] })
      setApproval(''); setRecovery(''); setSummary(''); setReference(''); setAcknowledged(false)
      setNeedsRefresh(false)
      if (operation === 'rollback') rollbackRequest.current = null
    } catch (failure) {
      setError(maintenanceError(failure))
      // An error response can follow a durable state transition (STALE, claimed
      // execution or interrupted rollback). Read the action before another write.
      setNeedsRefresh(true)
    } finally { busyRef.current = false; setBusy('') }
  }

  async function refresh() {
    const result = await query.refetch()
    if (!result.isError) {
      setNeedsRefresh(false); setAcknowledged(false)
      const prior = rollbackRequest.current
      if (prior && result.data?.attempts.some(attempt => attempt.id === prior.attemptId && !isActiveAttempt(attempt.status))) rollbackRequest.current = null
    }
  }

  if (query.isPending) return <p role="status">Loading recorded action…</p>
  if (!query.data) return <Card title="Action unavailable"><p role="alert">{maintenanceError(query.error)}</p><ToolbarButton onClick={() => void refresh()}>Retry action</ToolbarButton></Card>
  const action = query.data
  const controls = actionControls(action, actorId, canWrite)
  const locked = Boolean(busy) || needsRefresh || query.isError || query.isFetching
  const token = action.preview_token
  const expires = action.preview_expires_at ? parseAppDate(action.preview_expires_at)?.getTime() : undefined
  const expired = expires != null && expires <= Date.now()
  const hasApproval = Boolean(approval.trim() || Object.keys(action.approval_facts).length)
  const hasRecovery = Boolean(recovery.trim() || Object.keys(action.recovery_facts).length)
  const confirmationReady = !expired && Boolean(token) && (!action.risk_facts.requires_approval || hasApproval) && (!action.risk_facts.requires_recovery_facts || hasRecovery)
  const evidence = reference.trim() && summary.trim() ? [{ evidence_type: 'operator_reference', summary: summary.trim(), reference: reference.trim(), metadata: {} }] : []
  const recoveryFacts = recovery.trim() ? { plan_reference: recovery.trim() } : action.recovery_facts
  const activeAttempts = action.attempts.filter(item => isActiveAttempt(item.status))

  return <>
    {confirmation}<DraftGuard dirty={dirty || Boolean(busy)} />
    <Card title={String(action.change_context.title || action.action_key)}>
      <div className="flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-sm font-semibold capitalize text-[var(--text-primary)]">{labelStatus(action.status)} · {action.risk_tier} risk</p><ToolbarButton disabled={Boolean(busy) || query.isFetching} onClick={() => void refresh()}>{query.isFetching ? 'Refreshing…' : 'Refresh recorded state'}</ToolbarButton></div>
      <p className="break-words text-xs text-[var(--text-secondary)]">{action.action_key} · Requested by {action.actor_id} · {formatAppDate(action.requested_at)} · ID {action.id}</p>
      {!canWrite && <p className="text-sm text-[var(--text-secondary)]">Read only. A tenant mutation role and Monitoring write permission are required.</p>}
      {canWrite && !controls.owner && <p className="text-sm text-[var(--text-secondary)]">Only the requesting actor can authorize, execute, roll back or reconcile this action. Authorized operators may record verification.</p>}
      {query.isError && <p role="alert">Recorded state may be stale: {maintenanceError(query.error)}</p>}
      {error && <div role="alert" className="rounded-lg border border-[var(--state-danger-border)] bg-[var(--state-danger-surface)] p-3 text-sm text-[var(--state-danger)]"><p>{error}</p>{needsRefresh && <p className="mt-2">Refresh the recorded state before continuing. No operation will be automatically retried.</p>}</div>}
      {busy && <p role="status" className="text-sm text-[var(--text-secondary)]">Waiting for the server to record {busy}…</p>}
      <div className="grid gap-3 sm:grid-cols-2">{action.targets.map(target => <Link key={target.device_id} to={`/asset?id=${target.device_id}`} className="min-w-0 rounded-lg border border-[var(--border-default)] p-3 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"><span className="block break-words font-semibold">{target.target_snapshot.name || `Asset ${target.device_id}`}</span><span className="text-xs text-[var(--text-secondary)]">#{target.device_id} · {target.target_snapshot.status || 'Status not recorded'} · Open asset</span></Link>)}</div>
      <details className="text-sm text-[var(--text-secondary)]"><summary className="min-h-10 cursor-pointer py-2">Recorded plan and parameters{action.maintenance_window_id ? ` · Window #${action.maintenance_window_id}` : ''}</summary><Facts value={{ ...action.change_context, parameters: action.normalized_parameters }} /></details>
    </Card>
    <Card title="Preview and authorization">
      <p className="text-sm text-[var(--text-secondary)]">The server binds a preview to the actor, tenant, parameters and target revisions. It checks those facts again before execution.</p>
      {action.precondition_snapshot.requirements && <ul className="flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">{action.precondition_snapshot.requirements.map(requirement => <li key={requirement} className="rounded-lg border border-[var(--border-default)] px-3 py-2">{labelStatus(requirement)}</li>)}</ul>}
      {action.preview_expires_at && <p className="text-sm text-[var(--text-secondary)]">Preview {expired ? 'expired' : 'expires'}: {formatAppDate(action.preview_expires_at)}. Target changes can invalidate it earlier.</p>}
      {action.status === 'STALE' && <p role="alert" className="text-sm text-[var(--state-warning)]">The preview is stale. Review the target facts and request a new preview.</p>}
      <div className="flex flex-wrap gap-3">{controls.preview && <ToolbarButton disabled={locked} onClick={() => void perform('preview', {})}>{action.status === 'CREATED' ? 'Preview plan' : 'Refresh preview'}</ToolbarButton>}</div>
      {controls.authorize && <>
        <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2"><Field label="Approval reference" value={approval} onChange={setApproval} required={Boolean(action.risk_facts.requires_approval)} /><Field label="Recovery plan reference" value={recovery} onChange={setRecovery} required={Boolean(action.risk_facts.requires_recovery_facts)} /></fieldset>
        <p className="text-xs text-[var(--text-secondary)]">References record the current operator's approval context. They do not certify approval by a separate person.</p>
        <ToolbarButton disabled={locked || !confirmationReady} onClick={() => void perform('authorize', { preview_token: token, approval_facts: approval.trim() ? { reference: approval.trim() } : action.approval_facts, recovery_facts: recoveryFacts, confirm: false })}>Record authorization</ToolbarButton>
      </>}
      {controls.confirm && <>
        <label className="flex min-h-10 items-start gap-3 py-2 text-sm text-[var(--text-primary)]"><input className="mt-1" type="checkbox" checked={acknowledged} disabled={locked} onChange={event => setAcknowledged(event.target.checked)} />I reviewed this simulation, its targets, risk and recovery plan.</label>
        <ToolbarButton variant="primary" disabled={locked || !acknowledged || !confirmationReady || Boolean(approval || recovery) || (Boolean(action.risk_facts.requires_approval) && action.status !== 'AUTHORIZED')} onClick={() => void perform('confirm', { preview_token: token, confirmation: true })}>Confirm reviewed plan</ToolbarButton>
      </>}
      {controls.execute && <ToolbarButton variant="primary" disabled={locked} onClick={() => void perform('execute', { preview_token: token }, 'Execute this simulation?')}>Execute simulation</ToolbarButton>}
    </Card>
    <Card title="Execution and attempts">
      {!action.attempts.length && <p className="text-sm text-[var(--text-secondary)]">No execution attempt has been recorded.</p>}
      {action.attempts.map(attempt => <div key={attempt.id} className="space-y-2 rounded-lg border border-[var(--border-default)] p-3"><p className="text-sm font-semibold capitalize text-[var(--text-primary)]">{labelStatus(attempt.phase)} · {labelStatus(attempt.status)}</p><p className="break-words text-xs text-[var(--text-secondary)]">{attempt.id}</p><progress className="h-2 w-full" max={100} value={attempt.progress_percent} aria-label={`${attempt.phase} recorded progress`} /><p className="text-sm text-[var(--text-secondary)]">{attempt.progress_percent}% · {attempt.progress_message || 'No progress message recorded'}</p><details><summary className="min-h-10 cursor-pointer py-2 text-sm text-[var(--text-secondary)]">Recorded result</summary><Facts value={attempt.result} /></details></div>)}
      {Object.keys(action.execution_result).length > 0 && <div className="space-y-2 text-sm text-[var(--text-secondary)]"><p>Recorded execution outcome: <strong className="capitalize text-[var(--text-primary)]">{String(action.execution_result.outcome || 'not recorded')}</strong>. {action.execution_result.external_side_effect === false ? 'No external system was changed.' : 'Review the external effect evidence.'}</p><details><summary className="min-h-10 cursor-pointer py-2">Execution receipt details</summary><Facts value={action.execution_result} /></details></div>}
      {controls.reconcile && <div className="space-y-3"><p className="text-sm text-[var(--text-secondary)]">If an attempt was interrupted, reconcile its recorded outcome. This does not restart or cancel an external operation.</p>{activeAttempts.map(attempt => <ToolbarButton key={attempt.id} disabled={locked} onClick={() => void perform('reconcile', { attempt_id: attempt.id, phase: attempt.phase, summary: 'Operator requested reconciliation after reviewing the recorded attempt.' }, `Reconcile ${labelStatus(attempt.phase)} attempt?`)}>Reconcile {labelStatus(attempt.phase)}</ToolbarButton>)}</div>}
    </Card>
    {(controls.verify || controls.rollback || controls.recover) && <Card title="Verification and recovery">
      <fieldset disabled={locked} className="space-y-4"><Field label="Outcome summary / rollback reason" value={summary} onChange={setSummary} required multiline maxLength={2000} /><Field label="Evidence reference" value={reference} onChange={setReference} />{(controls.rollback || controls.recover) && <Field label="Recovery plan reference" value={recovery} onChange={setRecovery} required={Boolean(action.risk_facts.requires_recovery_facts) || recoveryOutcome === 'resolved'} />}</fieldset>
      {controls.verify && <div className="space-y-3"><label className="block space-y-1.5 text-xs font-semibold text-[var(--text-secondary)]"><span>Verification result</span><select className={inputClass} disabled={locked} value={verification} onChange={event => setVerification(event.target.value)}><option value="success">Passed</option><option value="failure">Failed</option></select></label><ToolbarButton disabled={locked || !summary.trim()} onClick={() => void perform('verify', { success: verification === 'success', summary: summary.trim(), evidence })}>Record verification</ToolbarButton></div>}
      {controls.rollback && <ToolbarButton variant="danger" disabled={locked || !summary.trim() || (Boolean(action.risk_facts.requires_recovery_facts) && !hasRecovery)} onClick={() => void perform('rollback', () => {
        if (!rollbackRequest.current) rollbackRequest.current = { attemptId: crypto.randomUUID(), body: { execute: true, reason: summary.trim(), recovery_facts: recoveryFacts, evidence } }
        const request = rollbackRequest.current
        return { ...request.body, attempt_id: request.attemptId }
      }, action.status === 'ROLLBACK_FAILED' ? 'Start a new rollback simulation attempt?' : 'Roll back this simulation?')}>{action.status === 'ROLLBACK_FAILED' ? 'Retry rollback simulation' : 'Roll back simulation'}</ToolbarButton>}
      {controls.recover && <div className="space-y-3"><label className="block space-y-1.5 text-xs font-semibold text-[var(--text-secondary)]"><span>Recovery outcome</span><select className={inputClass} disabled={locked} value={recoveryOutcome} onChange={event => setRecoveryOutcome(event.target.value)}><option value="unresolved">Unresolved — further work required</option><option value="resolved">Resolved — evidence reviewed</option></select></label><ToolbarButton disabled={locked || !summary.trim() || (recoveryOutcome === 'resolved' && !hasRecovery)} onClick={() => void perform('recovery', { outcome: recoveryOutcome, summary: summary.trim(), recovery_facts: recoveryFacts, evidence }, 'Record this recovery outcome?')}>Record recovery</ToolbarButton></div>}
    </Card>}
    {(action.verification_summary || action.evidence.length > 0 || Object.keys(action.rollback_outcome).length > 0) && <Card title="Recorded evidence">
      {action.verification_summary && !action.evidence.some(item => item.summary === action.verification_summary) && <p className="text-sm text-[var(--text-primary)]">{action.verification_summary}</p>}
      {action.evidence.map(item => <div key={item.id} className="break-words text-sm text-[var(--text-secondary)]"><p>{item.summary}</p><p className="text-xs">{item.evidence_type} · {item.reference || 'No external reference'} · {item.recorded_by}</p></div>)}
      {Object.keys(action.rollback_outcome).length > 0 && <details><summary className="min-h-10 cursor-pointer py-2 text-sm text-[var(--text-secondary)]">Rollback and recovery receipt details</summary><Facts value={action.rollback_outcome} /></details>}
    </Card>}
    <Card title="Action history"><ol className="space-y-4">{action.history.map(event => <li key={event.id} className="border-l-2 border-[var(--border-default)] pl-4"><p className="text-sm text-[var(--text-primary)]">{event.message}</p><p className="mt-1 break-words text-xs text-[var(--text-secondary)]">#{event.sequence} · {labelStatus(event.to_status)} · {event.actor_id} · {formatAppDate(event.occurred_at)}</p></li>)}</ol></Card>
  </>
}
