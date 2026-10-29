import React, { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CalendarClock, Check, RefreshCcw, X } from 'lucide-react'
import { apiFetch } from '../api/apiClient'
import ProjectsModernGantt, { type TimelineScheduleAuthority } from './ProjectsModernGantt'
import type { ProjectDependencyType } from './ProjectsSchedulingCompletion.model'
import { isProjectWorkingOrdinal, scheduleDateOrdinal, type PV1Calendar } from './ProjectsScheduleCore'
import { shouldUseProjectsTimeline, type ProjectsTimelineRoute } from './ProjectsTimeline.route'
import { ProjectsLegacyWorkspaceRedirect, ProjectsPrimaryNavigation } from './ProjectsRouteChrome'
import './ProjectsTimeline.css'

export { shouldUseProjectsTimeline } from './ProjectsTimeline.route'
type PendingPreview = { preview: any; commandId: string; reason: string }

const uuid = (): string => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
async function jsonOrThrow(response: Response) {
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(body?.message || body?.detail || `Request failed (${response.status})`) as Error & { code?: string; data?: any }
    error.code = body?.code; error.data = body
    throw error
  }
  return body
}

const readSchedule = (projectId: string) => apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}/schedule`).then(jsonOrThrow)

export function adaptSchedule(response: any) {
  const dependencies = Array.isArray(response?.dependencies) ? response.dependencies : []
  const bySuccessor = new Map<string, any[]>()
  dependencies.filter((item: any) => item.active).forEach((item: any) => bySuccessor.set(String(item.successor_id), [...(bySuccessor.get(String(item.successor_id)) || []), { id: item.predecessor_id, type: item.dependency_type, lag_days: item.lag_days, edge_id: item.id, revision: item.revision }]))
  const defaultBaseline = (response?.baselines || []).find((item: any) => item.is_default) || response?.baselines?.[0]
  const baselineTasks = new Map((defaultBaseline?.snapshot?.tasks || []).map((item: any) => [String(item.id), item]))
  const forecastTasks = new Map((response?.forecast?.tasks || []).map((item: any) => [String(item.task_id), item]))
  const tasks = (response?.tasks || []).map((task: any, index: number) => {
    const baseline: any = baselineTasks.get(String(task.id)); const forecast: any = forecastTasks.get(String(task.id))
    const milestone = task.kind === 'Milestone'
    return {
      ...task,
      name: task.title,
      type: task.kind,
      owner: task.owner_id,
      order_index: Number(task.order_key) || (index + 1) * 10,
      start_date: milestone ? task.point_date : task.start_date,
      end_date: milestone ? task.point_date : task.end_date,
      dependencies_json: bySuccessor.get(String(task.id)) || [],
      forecast_start_date: milestone ? forecast?.point_date : forecast?.start_date,
      forecast_end_date: milestone ? forecast?.point_date : forecast?.end_date,
      metadata_json: {
        is_milestone: milestone,
        baseline_start_date: milestone ? baseline?.point_date : baseline?.start_date,
        baseline_end_date: milestone ? baseline?.point_date : baseline?.end_date,
      },
    }
  })
  return {
    ...response.project,
    status: response.project?.phase,
    owner: response.project?.owner_id,
    end_date: response.project?.target_date,
    tasks,
    __pv1_calendar: response.calendar,
    __pv1_analysis: response.analysis,
    __pv1_forecast: response.forecast,
    metadata_json: {
      project_schedule_v2: {
        working_days: response.calendar?.working_weekdays,
        baselines: [...(response.baselines || [])].sort((left: any, right: any) => Number(Boolean(right.is_default)) - Number(Boolean(left.is_default))).map((item: any) => ({ id: item.id, name: item.label, captured_at: item.created_at, tasks: item.snapshot?.tasks || [], is_default: item.is_default })),
      },
    },
  }
}

function useDialogFocus(container: React.RefObject<HTMLElement | null>) {
  const returnFocus = useRef<HTMLElement | null>(null)
  React.useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => container.current?.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')?.focus())
    return () => { if (returnFocus.current?.isConnected) returnFocus.current.focus() }
  }, [container])
}

function trapDialogTab(event: React.KeyboardEvent, container: HTMLElement | null) {
  if (event.key !== 'Tab' || !container) return
  const targets = Array.from(container.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]'))
  const current = targets.indexOf(document.activeElement as HTMLElement)
  if (!targets.length) return
  if ((event.shiftKey && current <= 0) || (!event.shiftKey && current === targets.length - 1)) {
    event.preventDefault()
    targets[event.shiftKey ? targets.length - 1 : 0].focus()
  }
}

function TimelineNavigation({ projectId }: { projectId: string }) {
  return <ProjectsPrimaryNavigation projectId={projectId} active="timeline" />
}

export default function ProjectsTimeline({ projectId }: ProjectsTimelineRoute) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [pending, setPending] = useState<PendingPreview | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [lastUndoId, setLastUndoId] = useState<string | null>(null)
  const [lastRedoId, setLastRedoId] = useState<string | null>(null)
  const projectQuery = useQuery({ queryKey: ['pv1-project-route', projectId], queryFn: () => apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}`).then(jsonOrThrow), staleTime: 30_000 })
  const legacyProject = projectQuery.data?.legacy_project_id != null
  const query = useQuery({ queryKey: ['pv1-schedule', projectId], queryFn: () => readSchedule(projectId), staleTime: 5_000, enabled: projectQuery.isSuccess && !legacyProject })
  const projectsQuery = useQuery({ queryKey: ['pv1-projects-selector'], queryFn: () => apiFetch('/api/v2/projects?limit=200').then(jsonOrThrow), staleTime: 30_000 })
  const data = query.data
  const project = useMemo(() => data ? adaptSchedule(data) : null, [data])

  const refetch = async () => {
    await queryClient.invalidateQueries({ queryKey: ['pv1-schedule', projectId] })
    return query.refetch()
  }
  const sendCommand = async (type: string, expected: Record<string, unknown>, payload: Record<string, unknown>, commandId: string = uuid()) => {
    const response = await apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': commandId }, body: JSON.stringify({ command_id: commandId, type, expected, payload }) })
    return { body: await jsonOrThrow(response), commandId }
  }
  const applyPreview = async (candidate: PendingPreview) => {
    if (!data) throw new Error('Schedule source is unavailable.')
    setBusy(true); setMessage('Applying one atomic schedule command…')
    try {
      await sendCommand('schedule.apply', { project_revision: data.project_revision, graph_revision: candidate.preview.base_graph_revision, calendar_revision: candidate.preview.calendar_revision }, { preview_id: candidate.preview.preview_id, preview_hash: candidate.preview.content_hash }, candidate.commandId)
      setLastUndoId(candidate.commandId); setLastRedoId(null); setPending(null); setMessage('Schedule applied atomically.'); await refetch()
    } catch (error: any) {
      const confirmed = await query.refetch().then((result) => (result.data?.history || []).some((item: any) => item.command_id === candidate.commandId)).catch(() => false)
      if (confirmed) { setLastUndoId(candidate.commandId); setPending(null); setMessage('Schedule was confirmed after the network response was lost.') }
      else { setPending(candidate); setMessage(`${error?.message || 'Schedule apply failed'} Review remains available for retry.`); throw error }
    } finally { setBusy(false) }
  }
  const request: TimelineScheduleAuthority['request'] = async (operation, selectionIds, parameters) => {
    if (!data) throw new Error('Schedule source is unavailable.')
    setBusy(true); setMessage('Calculating a read-only preview…')
    try {
      const response = await apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}/schedule/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, selection_ids: selectionIds, parameters, graph_revision: data.graph_revision, calendar_revision: data.calendar.revision }) })
      const preview = await jsonOrThrow(response)
      if (preview.failures?.length) throw new Error(preview.failures.map((item: any) => item.message || item.code).join('; '))
      const candidate = { preview, commandId: uuid(), reason: operation === 'change_calendar' ? 'Calendar change' : `${preview.changes.length} task changes` }
      if (preview.changes.length > 1 || operation === 'change_calendar') { setPending(candidate); setMessage('Propagation preview is ready for review.'); return 'review' }
      await applyPreview(candidate)
      return 'applied'
    } finally { setBusy(false) }
  }
  const createDependency = async (sourceId: string, targetId: string, type: ProjectDependencyType, lagDays: number) => {
    if (!data) return
    setBusy(true)
    try { await sendCommand('dependency.create', { project_revision: data.project_revision, graph_revision: data.graph_revision }, { predecessor_id: sourceId, successor_id: targetId, dependency_type: type, lag_days: lagDays }); setMessage('Dependency saved.'); await refetch() }
    finally { setBusy(false) }
  }
  const removeDependency = async (dependencyId: string, revision: number) => {
    if (!data) return
    setBusy(true)
    try { await sendCommand('dependency.remove', { project_revision: data.project_revision, graph_revision: data.graph_revision, dependency_revision: revision }, { dependency_id: dependencyId }); setMessage('Dependency retained as disabled.'); await refetch() }
    finally { setBusy(false) }
  }
  const inferredUndone = new Set((data?.history || []).filter((item: any) => item.event_type === 'task.undo').map((item: any) => item.delta?.original_command_id))
  const inferredUndoId = (data?.history || []).find((item: any) => item.event_type === 'schedule.apply' && !inferredUndone.has(item.command_id))?.command_id || null
  const inferredRedoId = (data?.history || []).find((item: any) => item.event_type === 'task.undo')?.delta?.original_command_id || null
  const undo = async () => {
    const original = lastUndoId || inferredUndoId; if (!data || !original) return
    setBusy(true)
    try { await sendCommand('task.undo', { project_revision: data.project_revision, graph_revision: data.graph_revision }, { original_command_id: original }); setLastRedoId(original); setLastUndoId(null); setMessage('Schedule undo complete.'); await refetch() }
    finally { setBusy(false) }
  }
  const redo = async () => {
    const original = lastRedoId || inferredRedoId; if (!data || !original) return
    setBusy(true)
    try { await sendCommand('task.redo', { project_revision: data.project_revision, graph_revision: data.graph_revision }, { original_command_id: original }); setLastUndoId(original); setLastRedoId(null); setMessage('Schedule redo complete.'); await refetch() }
    finally { setBusy(false) }
  }
  const authority: TimelineScheduleAuthority = { request, createDependency, removeDependency, undo, redo, canUndo: Boolean(lastUndoId || inferredUndoId), canRedo: Boolean(lastRedoId || inferredRedoId), openScheduleChanges: () => setPanelOpen(true) }
  const selectedTask = (data?.tasks || []).find((item: any) => String(item.id) === searchParams.get('task'))
  const closeTask = () => { const next = new URLSearchParams(searchParams); next.delete('task'); setSearchParams(next, { replace: true }) }

  if (projectQuery.isPending) return <main className="p06-page" data-workspace="projects" data-pv1-projects-route="true" data-p06-timeline="true"><header className="p06-header"><div><a href="/projects">Portfolio</a><a href="/projects/my-day">My day</a><span>Project {projectId}</span></div></header><TimelineNavigation projectId={projectId}/><section className="p06-state" aria-busy="true"><CalendarClock/><h1>Loading Timeline</h1><p>Loading the project and schedule authority.</p></section></main>
  if (projectQuery.isError) return <main className="p06-page" data-workspace="projects" data-pv1-projects-route="true" data-p06-timeline="true"><header className="p06-header"><div><a href="/projects">Portfolio</a><a href="/projects/my-day">My day</a><span>Project {projectId}</span></div></header><TimelineNavigation projectId={projectId}/><section className="p06-state" role="alert"><AlertTriangle/><h1>Project unavailable</h1><p>The project could not be loaded. Check access, then retry.</p><button onClick={() => projectQuery.refetch()}><RefreshCcw/> Retry</button></section></main>
  if (legacyProject) return <main className="p06-page" data-workspace="projects" data-pv1-projects-route="true" data-p06-timeline="true"><header className="p06-header"><div><a href="/projects">Portfolio</a><a href="/projects/my-day">My day</a><span>{projectQuery.data.display_key}</span></div><strong>{projectQuery.data.name}</strong></header><ProjectsPrimaryNavigation projectId={projectId} active="timeline" legacyProjectId={projectQuery.data.legacy_project_id}/><ProjectsLegacyWorkspaceRedirect project={projectQuery.data} view="timeline" /></main>
  if (query.isPending) return <main className="p06-page" data-workspace="projects" data-pv1-projects-route="true" data-p06-timeline="true"><header className="p06-header"><div><a href="/projects">Portfolio</a><a href="/projects/my-day">My day</a><span>{projectQuery.data?.display_key || projectId}</span></div><strong>{projectQuery.data?.name}</strong></header><TimelineNavigation projectId={projectId}/><section className="p06-state" aria-busy="true"><CalendarClock/><h1>Loading Timeline</h1><p>Loading the canonical task graph and project calendar.</p></section></main>
  if (query.isError || !data || !project) return <main className="p06-page" data-workspace="projects" data-pv1-projects-route="true" data-p06-timeline="true"><header className="p06-header"><div><a href="/projects">Portfolio</a><a href="/projects/my-day">My day</a><span>{projectQuery.data?.display_key || projectId}</span></div><strong>{projectQuery.data?.name}</strong></header><TimelineNavigation projectId={projectId}/><section className="p06-state" role="alert"><AlertTriangle/><h1>Timeline unavailable</h1><p>Schedule data could not be loaded. Try again.</p><button onClick={() => query.refetch()}><RefreshCcw/> Retry</button></section></main>
  return <main className="p06-page" data-workspace="projects" data-pv1-projects-route="true" data-p06-timeline="true">
    <header className="p06-header"><div><a href="/projects">Portfolio</a><a href="/projects/my-day">My day</a><label className="p06-project-selector"><span>Project</span><select aria-label="Project" value={projectId} onChange={(event) => navigate(`/projects/${encodeURIComponent(event.target.value)}/timeline`)}><option value={projectId}>{data.project.name}</option>{(projectsQuery.data?.items || []).filter((item: any) => String(item.id) !== projectId).map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><span>{data.project.display_key}</span></header>
    <TimelineNavigation projectId={projectId}/>
    <section className="p06-title"><div><p>Project schedule · {data.calendar.timezone}</p><h1>Timeline</h1></div><div><span>Graph r{data.graph_revision}</span><span>Calendar r{data.calendar.revision}</span><button onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCcw/> Refresh</button></div></section>
    <p className={message.includes('failed') || message.includes('conflict') ? 'p06-message is-error' : 'p06-message'} role="status" aria-live="polite">{message}</p>
    <div className="p06-canvas"><ProjectsModernGantt project={project} onPersist={() => project} isSaving={busy} scheduleAuthority={authority}/></div>
    {selectedTask ? <TaskSchedulePanel key={selectedTask.id} task={selectedTask} busy={busy} onClose={closeTask} onRequest={request}/> : null}
    {panelOpen ? <SchedulePanel data={data} busy={busy} onClose={() => setPanelOpen(false)} onRequest={request} onCommand={async (type, payload) => { await sendCommand(type, { project_revision: data.project_revision, graph_revision: data.graph_revision, calendar_revision: data.calendar.revision }, payload); await refetch() }}/>: null}
    {pending ? <PropagationReview pending={pending} busy={busy} onCancel={() => { setPending(null); setMessage('Schedule preview cancelled; zero mutations were sent.') }} onApply={() => void applyPreview(pending)}/> : null}
  </main>
}

function TaskSchedulePanel({ task, busy, onClose, onRequest }: { task: any; busy: boolean; onClose: () => void; onRequest: TimelineScheduleAuthority['request'] }) {
  const milestone = task.kind === 'Milestone'
  const [startDate, setStartDate] = useState(task.start_date || '')
  const [endDate, setEndDate] = useState(task.end_date || '')
  const [pointDate, setPointDate] = useState(task.point_date || '')
  const [anchor, setAnchor] = useState<'start' | 'finish'>(task.milestone_anchor || 'finish')
  const [startNormalization, setStartNormalization] = useState('')
  const [endNormalization, setEndNormalization] = useState('')
  const [pointNormalization, setPointNormalization] = useState('')
  const panelRef = useRef<HTMLElement | null>(null)
  useDialogFocus(panelRef)
  const submit = async () => {
    const result = milestone
      ? await onRequest('set_dates', [String(task.id)], { point_date: pointDate, anchor, normalization: { point_date: pointNormalization || undefined } })
      : await onRequest('set_dates', [String(task.id)], { start_date: startDate, end_date: endDate, normalization: { start_date: startNormalization || undefined, end_date: endNormalization || undefined } })
    onClose()
    return result
  }
  return <div className="p06-shade" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><aside ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="p06-task-title" className="p06-panel p06-task-panel" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); else trapDialogTab(event, panelRef.current) }}>
    <header><div><p>{task.kind} · revision {task.revision}</p><h2 id="p06-task-title">{task.title}</h2></div><button onClick={onClose} aria-label={`Close ${task.title} schedule details`}><X/></button></header>
    <section><h3>Manual plan</h3><p>Dates remain date-only in {task.timezone || 'the project calendar'}. A non-working date requires an explicit previous/next choice.</p>{milestone ? <><label>Point date<input type="date" value={pointDate} onChange={(event) => setPointDate(event.target.value)}/></label><label>Anchor<select value={anchor} onChange={(event) => setAnchor(event.target.value as 'start' | 'finish')}><option value="start">Start boundary</option><option value="finish">Finish boundary</option></select></label><label>Non-working date choice<select value={pointNormalization} onChange={(event) => setPointNormalization(event.target.value)}><option value="">Only if already working</option><option value="previous">Previous working date</option><option value="next">Next working date</option></select></label></> : <><label>Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)}/></label><label>Start non-working choice<select value={startNormalization} onChange={(event) => setStartNormalization(event.target.value)}><option value="">Only if already working</option><option value="previous">Previous working date</option><option value="next">Next working date</option></select></label><label>Finish date<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)}/></label><label>Finish non-working choice<select value={endNormalization} onChange={(event) => setEndNormalization(event.target.value)}><option value="">Only if already working</option><option value="previous">Previous working date</option><option value="next">Next working date</option></select></label></>}<button disabled={busy || (milestone ? !pointDate : !startDate || !endDate)} onClick={() => void submit()}>Preview date change</button></section>
    <section><h3>Constraints</h3><dl><dt>Start pin</dt><dd>{task.start_pinned ? 'Pinned' : 'Not pinned'}</dd><dt>Finish pin</dt><dd>{task.finish_pinned ? 'Pinned' : 'Not pinned'}</dd><dt>Not before</dt><dd>{task.not_before_date || 'None'}</dd><dt>Duration</dt><dd>{milestone ? 'Milestone' : task.duration_workdays ? `${task.duration_workdays} working days` : 'Derived from dates'}</dd></dl></section>
  </aside></div>
}

function PropagationReview({ pending, busy, onCancel, onApply }: { pending: PendingPreview; busy: boolean; onCancel: () => void; onApply: () => void }) {
  const dialogRef = useRef<HTMLElement | null>(null)
  useDialogFocus(dialogRef)
  return <div className="p06-shade" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}><section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="p06-review-title" className="p06-review" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onCancel() } else trapDialogTab(event, dialogRef.current) }}>
    <header><div><p>Pure preview · expires {new Date(pending.preview.expires_at).toLocaleTimeString()}</p><h2 id="p06-review-title">Review propagation</h2></div><button onClick={onCancel} aria-label="Cancel schedule preview"><X/></button></header>
    <p>{pending.reason}. Base graph r{pending.preview.base_graph_revision}; hash <code>{pending.preview.content_hash.slice(0, 12)}</code>.</p>
    <div className="p06-change-list">{pending.preview.changes.map((item: any) => <article key={item.task_id}><strong>{item.task_id}</strong><span>{item.before.start_date || item.before.point_date || 'Unscheduled'} → {item.after.start_date || item.after.point_date || 'Unscheduled'}</span><small>{item.explanation_chain?.map((step: any) => step.kind).join(' → ') || 'Direct edit'}</small></article>)}</div>
    <footer><button onClick={onCancel} disabled={busy}>Cancel — zero writes</button><button className="is-primary" onClick={onApply} disabled={busy}><Check/> Apply one atomic command</button></footer>
  </section></div>
}

function SchedulePanel({ data, busy, onClose, onRequest, onCommand }: { data: any; busy: boolean; onClose: () => void; onRequest: TimelineScheduleAuthority['request']; onCommand: (type: string, payload: Record<string, unknown>) => Promise<void> }) {
  const [weekdays, setWeekdays] = useState<number[]>(data.calendar.working_weekdays)
  const [exceptions, setExceptions] = useState<Array<{ date: string; working: boolean }>>(data.calendar.exceptions || [])
  const [exceptionDate, setExceptionDate] = useState('')
  const [exceptionWorking, setExceptionWorking] = useState(false)
  const [normalization, setNormalization] = useState<Record<string, Record<string, 'previous' | 'next' | ''>>>({})
  const [label, setLabel] = useState('')
  const [rationale, setRationale] = useState('')
  const dialogRef = useRef<HTMLElement | null>(null)
  useDialogFocus(dialogRef)
  const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
  const targetCalendar: PV1Calendar = { timezone: data.calendar.timezone, working_weekdays: weekdays, exceptions, revision: data.calendar.revision + 1 }
  const affectedDates = useMemo(() => (data.tasks || []).flatMap((task: any) => {
    const fields = task.kind === 'Milestone' ? ['point_date'] : ['start_date', 'end_date']
    return fields.flatMap((field) => {
      const value = task[field]; const ordinal = scheduleDateOrdinal(value)
      return ordinal != null && !isProjectWorkingOrdinal(targetCalendar, ordinal) ? [{ taskId: String(task.id), title: task.title, field, value }] : []
    })
  }), [data.tasks, exceptions, weekdays])
  const unresolvedDates = affectedDates.filter((item: any) => !normalization[item.taskId]?.[item.field])
  const addException = () => {
    if (!exceptionDate) return
    setExceptions((current) => [...current.filter((item) => item.date !== exceptionDate), { date: exceptionDate, working: exceptionWorking }].sort((a, b) => a.date.localeCompare(b.date)))
    setExceptionDate('')
  }
  const previewCalendar = () => {
    const selectedNormalization = Object.fromEntries(Object.entries(normalization).map(([taskId, fields]) => [taskId, Object.fromEntries(Object.entries(fields).filter(([, direction]) => direction))]))
    return onRequest('change_calendar', [], { timezone: data.calendar.timezone, working_weekdays: weekdays, exceptions, normalization: selectedNormalization })
  }
  return <div className="p06-shade"><aside ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="p06-panel-title" className="p06-panel" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); else trapDialogTab(event, dialogRef.current) }}>
    <header><div><p>Deterministic schedule authority</p><h2 id="p06-panel-title">Schedule changes</h2></div><button onClick={onClose} aria-label="Close schedule changes"><X/></button></header>
    <section><h3>Calendar</h3><p>{data.calendar.timezone} · version {data.calendar.revision}. Dates are date-only; non-working dates remain visible.</p><div className="p06-weekdays">{labels.map((name, day) => <button key={name} aria-pressed={weekdays.includes(day)} onClick={() => setWeekdays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort())}>{name}</button>)}</div>
      <div className="p06-exception-add"><label>Exception date<input type="date" value={exceptionDate} onChange={(event) => setExceptionDate(event.target.value)}/></label><label>Behavior<select value={exceptionWorking ? 'working' : 'non-working'} onChange={(event) => setExceptionWorking(event.target.value === 'working')}><option value="non-working">Non-working</option><option value="working">Working</option></select></label><button disabled={!exceptionDate} onClick={addException}>Add exception</button></div>
      {exceptions.length ? <div className="p06-exceptions">{exceptions.map((item) => <article key={item.date}><span>{item.date} · {item.working ? 'Working' : 'Non-working'}</span><button aria-label={`Remove ${item.date} exception`} onClick={() => setExceptions((current) => current.filter((value) => value.date !== item.date))}>Remove</button></article>)}</div> : <p>No calendar exceptions.</p>}
      {affectedDates.length ? <div className="p06-normalization" role="group" aria-label="Explicit date normalization"><strong>Choose how each affected date moves</strong><p>The calendar cannot silently move dates. Every choice is included in the preview.</p>{affectedDates.map((item: any) => <label key={`${item.taskId}-${item.field}`}>{item.title} · {item.field.replace('_', ' ')} · {item.value}<select aria-label={`${item.title} ${item.field} normalization`} value={normalization[item.taskId]?.[item.field] || ''} onChange={(event) => setNormalization((current) => ({ ...current, [item.taskId]: { ...(current[item.taskId] || {}), [item.field]: event.target.value as 'previous' | 'next' | '' } }))}><option value="">Choose…</option><option value="previous">Previous working date</option><option value="next">Next working date</option></select></label>)}</div> : null}
      <button disabled={busy || !weekdays.length || unresolvedDates.length > 0} onClick={() => void previewCalendar()}>Preview calendar change</button>{unresolvedDates.length ? <small>{unresolvedDates.length} explicit date choice{unresolvedDates.length === 1 ? '' : 's'} required.</small> : null}
    </section>
    <section><h3>Calculation</h3><p>{data.analysis.status} · {data.analysis.critical_task_ids.length} critical · forecast {data.forecast.coverage.complete ? data.forecast.finish || 'unavailable' : `incomplete (${data.forecast.coverage.forecastable_tasks}/${data.forecast.coverage.total_tasks})`}.</p><p>Forecast provenance: {data.forecast.provenance || 'unavailable'}{data.forecast.delta_workdays == null ? '' : ` · ${data.forecast.delta_workdays >= 0 ? '+' : ''}${data.forecast.delta_workdays} working days`}</p><button disabled={busy} onClick={() => void onRequest('recalculate_earliest', [], {})}>Recalculate earliest preview</button><div className="p06-analysis">{data.analysis.rows.filter((item: any) => item.critical || item.negative_slack).map((item: any) => <article key={item.task_id}><strong>{data.tasks.find((task: any) => task.id === item.task_id)?.title || item.task_id}</strong><span>{item.critical ? 'Critical' : `${item.slack_workdays}d slack`}</span><small>{(item.explanation_chain || []).map((step: any) => step.kind).join(' → ') || 'Project completion anchor'}</small></article>)}</div></section>
    <section><h3>Immutable baseline</h3><label>Label<input value={label} onChange={(event) => setLabel(event.target.value)} /></label><label>Rationale<input value={rationale} onChange={(event) => setRationale(event.target.value)} /></label><button disabled={busy || !label.trim()} onClick={() => void onCommand('baseline.capture', { label: label.trim(), rationale: rationale.trim() }).then(() => { setLabel(''); setRationale('') })}>Capture baseline</button><div>{data.baselines.map((item: any) => <article key={item.id}><strong>{item.label}</strong><span>{item.is_default ? 'Default comparison' : `Graph r${item.graph_revision}`}</span>{!item.is_default ? <button onClick={() => void onCommand('baseline.set_default', { baseline_id: item.id })}>Set default</button> : null}</article>)}</div>{data.baseline_variance?.length ? <div className="p06-variance"><strong>Variance against default</strong>{data.baseline_variance.filter((item: any) => item.scope_change || item.start_delta_workdays || item.finish_delta_workdays).map((item: any) => <article key={item.task_id || item.baseline_id}><span>{data.tasks.find((task: any) => task.id === item.task_id)?.title || item.task_id || item.status}</span><small>{item.scope_change || `Start ${item.start_delta_workdays ?? '—'}d · finish ${item.finish_delta_workdays ?? '—'}d`}</small></article>)}</div> : null}</section>
    <section><h3>Schedule history</h3>{data.history.length ? data.history.slice(0, 12).map((item: any) => <article key={item.event_id}><strong>{item.event_type}</strong><span>{new Date(item.timestamp).toLocaleString()} · {item.actor_id}</span></article>) : <p>No schedule commands applied.</p>}</section>
  </aside></div>
}
