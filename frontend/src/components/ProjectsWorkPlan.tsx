import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../api/apiClient'
import { AlertTriangle, Check, ChevronDown, ChevronRight, CircleHelp, Pin, Plus, Undo2 } from 'lucide-react'
import { BOARD_STATUSES, buildWorkRows, focusDisplayItems, parseTaskImportText, transitionLabel, treeGridAria, WORK_STATUSES } from './ProjectsWorkPlan.model'
import './ProjectsWorkPlan.css'
import './ProjectsPlanEditor.css'
import ArchitectureHost from '../architecture/ArchitectureHost'
import { ProjectsOfflineNotice, useProjectsOnline } from './ProjectsState'
import { ProjectsLegacyWorkspaceRedirect, ProjectsPrimaryNavigation } from './ProjectsRouteChrome'

type Route = { scope: 'my-day' | 'work' | 'plan'; projectId?: string; board: boolean; section?: string; taskPanel?: string; taskEntity?: string; hasTaskSelection?: boolean }

export function shouldUseProjectsWorkPlan(pathname: string, search = ''): Route | null {
  if (pathname === '/projects/my-day' || pathname === '/projects/my-day/') return { scope: 'my-day', board: false }
  const work = pathname.match(/^\/projects\/([^/]+)\/(work|plan)\/?$/)
  if (!work) return null
  const params = new URLSearchParams(search)
  const planSection = params.get('section')
  const section = (['brief', 'milestones', 'architecture', 'risks', 'resources'] as const).includes(planSection as any) ? planSection! : 'brief'
  return { scope: work[2] as 'work' | 'plan', projectId: decodeURIComponent(work[1]), board: params.get('layout') === 'board', section: work[2] === 'plan' ? section : undefined, taskPanel: params.get('panel') || undefined, taskEntity: params.get('entity') || undefined, hasTaskSelection: params.has('panel') || params.has('entity') }
}

const uuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`

async function jsonOrThrow(response: Response) {
  if (!response.ok) throw new Error(await response.text())
  return response.json()
}

function projectCommandFeedback(error: unknown) {
  const data = (error as { data?: unknown } | null)?.data
  if (data && typeof data === 'object') {
    const { code, message } = data as { code?: unknown; message?: unknown }
    if (typeof code === 'string' && typeof message === 'string' && /^[A-Z0-9_]{2,80}$/.test(code)) {
      const bounded = message.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
      if (bounded && bounded.length <= 240 && !/(?:traceback|stack trace|\bat\s+\S+\s*\()/i.test(bounded)) return bounded
    }
  }
  return 'This task change could not be saved. Check the task and try again.'
}

function focusEligible(element: HTMLElement | null): element is HTMLElement {
  if (!element || !element.isConnected || element.matches(':disabled') || element.closest('[inert], [aria-hidden="true"]')) return false
  let ancestor: HTMLElement | null = element
  while (ancestor) {
    const style = window.getComputedStyle(ancestor)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false
    ancestor = ancestor.parentElement
  }
  const box = element.getBoundingClientRect()
  return box.width > 0 && box.height > 0
}

function command(projectId: string, type: string, expected: Record<string, unknown>, payload: Record<string, unknown>) {
  const commandId = uuid()
  return apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': commandId },
    body: JSON.stringify({ command_id: commandId, type, expected, payload }),
  }).then(jsonOrThrow)
}

function Header({ projectId, scope, board, section = 'brief', project }: { projectId?: string; scope: Route['scope']; board: boolean; section?: string; project?: any }) {
  const planSections = [
    ['brief', 'Brief'], ['milestones', 'Milestones'], ['architecture', 'Architecture'], ['risks', 'Risks & decisions'], ['resources', 'Resources'],
  ] as const
  const extra = scope === 'plan' && projectId
    ? planSections.map(([key, label]) => ({ label, href: `/projects/${encodeURIComponent(projectId)}/plan?section=${key}`, active: section === key }))
    : projectId ? [{
    label: 'Board',
    href: project?.legacy_project_id != null ? `/projects?view=board&id=${encodeURIComponent(String(project.legacy_project_id))}&legacy_workspace=1` : `/projects/${encodeURIComponent(projectId)}/work?layout=board`,
    active: scope === 'work' && board,
  }] : []
  return <header className="p05-header" data-golden-page-header="true"><div><p className="p05-eyebrow">Projects · {scope === 'my-day' ? 'Personal execution' : projectId ? 'Project workspace' : 'Work'}</p><h1>{scope === 'my-day' ? 'My day' : scope === 'plan' ? 'Plan' : 'Work'}</h1>{projectId && project ? <p className="p05-project-context"><strong>{project.display_key}</strong> · {project.name}</p> : null}</div>{projectId ? <ProjectsPrimaryNavigation projectId={projectId} active={scope === 'plan' ? 'plan' : 'work'} legacyProjectId={project?.legacy_project_id} extras={extra} /> : <nav aria-label="Projects navigation"><Link to="/projects">Portfolio</Link><Link to="/projects/my-day" aria-current={scope === 'my-day' ? 'page' : undefined}>My day</Link></nav>}</header>
}

function FocusSection({ response, projectId, onRefresh }: { response: any; projectId?: string; onRefresh: () => void }) {
  const items = focusDisplayItems(response)
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const focusMutation = useMutation({ mutationFn: ({ type, item }: { type: string; item: any }) => {
    const id = uuid()
    return apiFetch('/api/v2/focus/commands', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id }, body: JSON.stringify({ command_id: id, type, expected: {}, payload: { project_id: item.project_id, entity_kind: item.entity_kind, entity_id: item.entity_id } }) }).then(jsonOrThrow)
  }, onSuccess: () => { setMessage('Focus preference saved.'); queryClient.invalidateQueries({ queryKey: ['pv1-focus'] }); onRefresh() } })
  return <section className="p05-focus" aria-labelledby="focus-title"><div className="p05-section-heading"><div><p className="p05-eyebrow">{response?.scope === 'project' ? 'Project Focus' : 'Focus today'}</p><h2 id="focus-title">The next useful actions</h2><p>Prioritized from current project work, with the reason shown for every suggestion.</p></div><span className="p05-source">{response?.total ?? 0} actionable item{response?.total === 1 ? '' : 's'}</span></div>{message ? <p role="status" className="p05-success">{message}</p> : null}{!items.length ? <div className="p05-empty-state"><p className="p05-empty-title">Nothing needs your attention today.</p><p className="p05-empty">No actionable work is assigned to you. Unscheduled work remains visible in the project work list.</p><div className="p05-empty-actions"><Link to={projectId ? `/projects/${encodeURIComponent(projectId)}/work` : '/projects'}>{projectId ? 'Review project work' : 'Open portfolio'}</Link>{projectId ? <Link to="/projects">Portfolio</Link> : null}</div></div> : <ol className="p05-focus-list">{items.map((item: any) => <li key={item.id} className={item.pinned ? 'is-pinned' : undefined}><div className="p05-focus-main"><span className="p05-bucket">{item.bucket_label}</span><strong>{item.title}</strong><span>{item.project_name} · {item.due_context}</span><small>{item.why_here}</small></div><div className="p05-focus-actions"><button title="Why here?" aria-label={`Why here for ${item.title}`} onClick={() => setMessage(item.why_here)}><CircleHelp size={16} /></button><button aria-label={`${item.pinned ? 'Unpin' : 'Pin'} ${item.title}`} onClick={() => focusMutation.mutate({ type: item.pinned ? 'focus.unpin' : 'focus.pin', item })}><Pin size={16} /></button><Link to={`/projects/${encodeURIComponent(item.project_id)}/work?panel=task&entity=${encodeURIComponent(item.entity_id)}`}>{item.primary_action}</Link></div></li>)}</ol>}{message ? <small className="p05-live" aria-live="polite">{message}</small> : null}</section>
}

type TaskSelectionQuery = { hasSelection: boolean; panel?: string; entity?: string; locationKey: string }
type WorkIntent =
  | { kind: 'create'; draft: string; title: string }
  | { kind: 'bulk'; operation: string; selection: Array<{ id: string; version: number }> }
type WorkCommand = { type: string; expected: any; payload: any; pendingKey: string; intent?: WorkIntent }

function WorkTree({ projectId, work, board, onRefresh, taskSelection, workFetching, clearTaskSelection }: { projectId: string; work: any; board: boolean; onRefresh: () => void; taskSelection: TaskSelectionQuery; workFetching: boolean; clearTaskSelection: () => void }) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const selectionVersions = useRef(new Map<string, number>())
  const selectionVersion = useRef(0)
  const [newTitle, setNewTitle] = useState('')
  const [taskSearch, setTaskSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [importText, setImportText] = useState('')
  const [importPreview, setImportPreview] = useState<any>(null)
  const [panelId, setPanelId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [scrollTop, setScrollTop] = useState(0)
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set())
  const pendingKeysRef = useRef(new Set<string>())
  const lifetimeActive = useRef(false)
  const processedTaskSelection = useRef<string | null>(null)
  const panelOpenedFromQuery = useRef<{ entity: string; locationKey: string } | null>(null)
  const invoker = useRef<HTMLElement | null>(null)
  const fallback = useRef<HTMLDivElement | null>(null)
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const [restoreFocus, setRestoreFocus] = useState(false)
  const filteredItems = useMemo(() => {
    const tasks = work?.items || []
    const query = taskSearch.trim().toLowerCase()
    if (!query && statusFilter === 'All') return tasks
    const byId = new Map(tasks.map((task: any) => [String(task.id), task]))
    const included = new Set<string>()
    for (const task of tasks) {
      const searchable = `${task.title || ''} ${task.owner_id || ''} ${task.status || ''} ${task.id}`.toLowerCase()
      if ((statusFilter === 'All' || task.status === statusFilter) && (!query || searchable.includes(query))) {
        let current = task
        while (current && !included.has(String(current.id))) {
          included.add(String(current.id))
          current = current.parent_task_id == null ? null : byId.get(String(current.parent_task_id))
        }
      }
    }
    return tasks.filter((task: any) => included.has(String(task.id)))
  }, [work?.items, taskSearch, statusFilter])
  const visibleTaskIds = useMemo(() => new Set(filteredItems.map((task: any) => String(task.id))), [filteredItems])
  const visibleSelectedIds = useMemo(() => [...selected].filter((id) => visibleTaskIds.has(id)), [selected, visibleTaskIds])
  useEffect(() => {
    const hiddenSelection = [...selected].filter((id) => !visibleTaskIds.has(id))
    if (!hiddenSelection.length) return
    hiddenSelection.forEach((id) => selectionVersions.current.delete(id))
    setSelected((current) => new Set([...current].filter((id) => visibleTaskIds.has(id))))
  }, [selected, visibleTaskIds])
  const filterExpanded = useMemo(() => new Set(filteredItems.map((task: any) => task.parent_task_id == null ? null : String(task.parent_task_id)).filter(Boolean) as string[]), [filteredItems])
  const effectiveExpanded = useMemo(() => taskSearch.trim() || statusFilter !== 'All' ? new Set([...expanded, ...filterExpanded]) : expanded, [expanded, filterExpanded, taskSearch, statusFilter])
  const boardItemsByStatus = useMemo(() => {
    const grouped = new Map<string, any[]>()
    for (const status of BOARD_STATUSES) grouped.set(status, [])
    for (const item of filteredItems) grouped.get(item.status)?.push(item)
    return grouped
  }, [filteredItems])
  const rows = useMemo(() => buildWorkRows(filteredItems, effectiveExpanded), [filteredItems, effectiveExpanded])
  const aria = useMemo(() => ({ ...treeGridAria(filteredItems, effectiveExpanded), unfilteredCount: work?.items?.length || 0 }), [filteredItems, effectiveExpanded, work?.items?.length])
  const virtualStart = Math.max(0, Math.floor(Math.max(0, scrollTop - 48) / 48) - 8)
  const virtualCount = Math.min(rows.length - virtualStart, Math.ceil(512 / 48) + 16)
  const visibleRows = rows.slice(virtualStart, virtualStart + Math.max(0, virtualCount))
  const filterControls = <div className="p05-filterbar" data-p05-work-filters="true"><label><span className="sr-only">Search tasks by title, owner, or ID</span><input type="search" value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="Search tasks, owners, or IDs…" /></label><label><span className="sr-only">Filter tasks by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All</option>{WORK_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label><span aria-live="polite">{filteredItems.length === work.items.length ? `${work.items.length} tasks` : `${filteredItems.length} of ${work.items.length} tasks`}</span>{taskSearch || statusFilter !== 'All' ? <button type="button" onClick={() => { setTaskSearch(''); setStatusFilter('All') }}>Clear filters</button> : null}</div>
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['pv1-work', projectId] }); queryClient.invalidateQueries({ queryKey: ['pv1-focus'] }); onRefresh() }
  useEffect(() => {
    lifetimeActive.current = true
    return () => { lifetimeActive.current = false }
  }, [])
  const finishPending = (key: string) => {
    pendingKeysRef.current.delete(key)
    setPendingKeys((current) => { const next = new Set(current); next.delete(key); return next })
  }
  const acknowledgeIntent = (intent?: WorkIntent) => {
    if (intent?.kind === 'create') setNewTitle((current) => current === intent.draft && current.trim() === intent.title ? '' : current)
    if (intent?.kind === 'bulk') {
      setSelected((current) => {
        const next = new Set(current)
        for (const item of intent.selection) {
          if (next.has(item.id) && selectionVersions.current.get(item.id) === item.version) next.delete(item.id)
        }
        return next
      })
    }
  }
  const send = useMutation({
    mutationFn: async ({ type, expected, payload }: WorkCommand) => {
      try {
        return await command(projectId, type, expected, payload)
      } catch (error) {
        const feedback = projectCommandFeedback(error)
        throw Object.assign(new Error(feedback), { data: { code: 'TASK_COMMAND_FAILED', message: feedback }, silent: true })
      }
    },
    onSuccess: (_result, variables) => {
      if (!lifetimeActive.current) return
      finishPending(variables.pendingKey)
      acknowledgeIntent(variables.intent)
      refresh()
    },
    onError: (error: unknown, variables) => {
      if (!lifetimeActive.current) return
      finishPending(variables.pendingKey)
      setMessage(projectCommandFeedback(error))
    },
  })
  const dispatch = (variables: WorkCommand) => {
    if (!lifetimeActive.current || pendingKeysRef.current.has(variables.pendingKey)) return false
    pendingKeysRef.current.add(variables.pendingKey)
    setPendingKeys((current) => new Set(current).add(variables.pendingKey))
    setMessage('')
    send.mutate(variables)
    return true
  }
  const create = () => {
    const draft = newTitle
    const title = draft.trim()
    if (!title || pendingKeysRef.current.has('create')) return
    dispatch({ type: 'task.create', expected: { project_revision: work.project_revision, graph_revision: work.graph_revision }, payload: { title }, pendingKey: 'create', intent: { kind: 'create', draft, title } })
  }
  const toggle = (id: string) => setExpanded((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  const toggleSelected = (id: string) => {
    selectionVersion.current += 1
    selectionVersions.current.set(id, selectionVersion.current)
    setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  }
  const openPanel = (id: string, control: HTMLElement) => {
    invoker.current = control
    panelOpenedFromQuery.current = null
    setRestoreFocus(false)
    setPanelId(id)
  }
  const closePanel = () => {
    if (!panelId) return
    setPanelId(null)
    setRestoreFocus(true)
    clearTaskSelection()
  }
  const transition = (task: any, status: string) => dispatch({ type: 'task.transition', expected: { project_revision: work.project_revision, graph_revision: work.graph_revision, task_revision: task.revision }, payload: { task_id: task.id, to_status: status }, pendingKey: `task:${String(task.id)}` })
  const bulk = (operation: string, value: unknown) => {
    const ids = visibleSelectedIds
    if (!ids.length || pendingKeysRef.current.has('bulk')) return
    const selection = ids.map((id) => ({ id, version: selectionVersions.current.get(id) || 0 }))
    dispatch({ type: 'task.bulk', expected: { project_revision: work.project_revision, graph_revision: work.graph_revision, task_revisions: Object.fromEntries(ids.map((id) => [id, (work.items || []).find((item: any) => String(item.id) === id)?.revision])) }, payload: { task_ids: ids, operation, value }, pendingKey: 'bulk', intent: { kind: 'bulk', operation, selection } })
  }
  const previewImport = async () => { const format = importText.includes('\t') ? 'tsv' : 'csv'; const response = await apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}/tasks/import/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: importText, format }) }); const result = await jsonOrThrow(response); if (lifetimeActive.current) setImportPreview(result) }
  const applyImport = async () => { if (!importPreview?.valid) return; const id = uuid(); const response = await apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}/tasks/import`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id }, body: JSON.stringify({ text: importText, format: importText.includes('\t') ? 'tsv' : 'csv', expected: { graph_revision: work.graph_revision } }) }); await jsonOrThrow(response); if (!lifetimeActive.current) return; setImportPreview(null); setImportText(''); refresh() }
  const panel = (work.items || []).find((item: any) => String(item.id) === panelId)
  useEffect(() => {
    const selectionKey = `${taskSelection.locationKey}:${taskSelection.panel || ''}:${taskSelection.entity || ''}`
    if (!taskSelection.hasSelection) return
    if (processedTaskSelection.current !== selectionKey && panelId) {
      panelOpenedFromQuery.current = null
      invoker.current = null
      setPanelId(null)
      setRestoreFocus(true)
    }
    if (workFetching || processedTaskSelection.current === selectionKey) return
    processedTaskSelection.current = selectionKey
    const requested = taskSelection.panel === 'task' && taskSelection.entity
      ? (work.items || []).find((item: any) => String(item.id) === taskSelection.entity)
      : null
    if (!requested) {
      panelOpenedFromQuery.current = null
      invoker.current = null
      setPanelId(null)
      setRestoreFocus(true)
      clearTaskSelection()
      return
    }
    panelOpenedFromQuery.current = { entity: taskSelection.entity!, locationKey: taskSelection.locationKey }
    invoker.current = null
    setRestoreFocus(false)
    setPanelId(String(requested.id))
  }, [taskSelection.hasSelection, taskSelection.panel, taskSelection.entity, taskSelection.locationKey, workFetching, work.items, panelId, clearTaskSelection])
  useEffect(() => {
    if (!panelId || workFetching || panel) return
    setPanelId(null)
    setRestoreFocus(true)
    const fromQuery = panelOpenedFromQuery.current
    panelOpenedFromQuery.current = null
    if (fromQuery?.entity === panelId && taskSelection.hasSelection && taskSelection.entity === panelId) clearTaskSelection()
  }, [panelId, panel, workFetching, taskSelection.hasSelection, taskSelection.entity, clearTaskSelection])
  useEffect(() => {
    if (panelId) {
      closeButton.current?.focus()
      return
    }
    if (!restoreFocus) return
    const target = focusEligible(invoker.current) ? invoker.current : fallback.current
    target?.focus()
    if (!target || document.activeElement !== target) fallback.current?.focus()
    invoker.current = null
    setRestoreFocus(false)
  }, [panelId, restoreFocus])
  useEffect(() => {
    if (!panelId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closePanel()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [panelId, clearTaskSelection])
  const taskPanel = panel ? <aside className="p05-task-panel" data-task-id={String(panel.id)} role="region" aria-labelledby="p05-task-panel-title"><button ref={closeButton} onClick={closePanel}>Close</button><p className="p05-eyebrow">Task panel</p><h2 id="p05-task-panel-title">{panel.title}</h2><p>{transitionLabel(panel.status, (work.blockers || []).some((item: any) => String(item.task_id) === String(panel.id)))}</p><p>Owner: {panel.owner_id || 'Unassigned'}</p><p>Progress: {panel.progress}%</p><button onClick={() => transition(panel, panel.status === 'Done' ? 'In progress' : 'Done')} disabled={pendingKeys.has(`task:${String(panel.id)}`)}><Check size={15} /> {panel.status === 'Done' ? 'Reopen' : 'Mark done'}</button><p className="p05-muted">Routine progress updates do not require a note.</p></aside> : null
  const workContent = board ? <div className="p05-board-wrap">
    {filterControls}
    <div className="p05-toolbar"><span className="p05-view-hint">Columns show workflow status; task progress is a separate measure.</span><button onClick={() => bulk('status', 'In progress')} disabled={!visibleSelectedIds.length || pendingKeys.has('bulk')}>Bulk → In progress</button><button onClick={() => bulk('cancel', null)} disabled={!visibleSelectedIds.length || pendingKeys.has('bulk')}>Cancel selected</button><span>{visibleSelectedIds.length} visible selected</span></div>
    {!filteredItems.length && work.items.length ? <p className="p05-empty" role="status">No tasks match these filters. Clear filters to restore the board.</p> : null}
    <div className="p05-board" role="region" aria-label="Project task board" tabIndex={-1} ref={fallback}>{BOARD_STATUSES.map((status) => <section key={status} aria-labelledby={`board-${status}`}><h3 id={`board-${status}`}>{status}</h3>{(boardItemsByStatus.get(status) || []).map((task: any) => <article className="p05-card" key={task.id} data-task-id={String(task.id)} draggable={false}><label><input type="checkbox" aria-label={`Select ${task.title}`} data-task-id={String(task.id)} checked={selected.has(String(task.id))} onChange={() => toggleSelected(String(task.id))} /> <span>{task.title}</span></label><small>{task.owner_id || 'Unassigned'} · {task.end_date || 'No finish'}</small><small className="p05-card-progress">Task progress <strong>{task.progress ?? 0}%</strong></small><button aria-label={`Open task ${task.title}`} onClick={(event) => openPanel(String(task.id), event.currentTarget)}>Open task</button><label className="p05-move"><span>Move to…</span><select aria-label={`Move ${task.title} to`} value={task.status} disabled={pendingKeys.has(`task:${String(task.id)}`)} onChange={(event) => transition(task, event.target.value)}>{WORK_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></label></article>)}</section>)}</div>
  </div> : <div className="p05-work-area">
    {filterControls}
    <div className="p05-toolbar"><label className="p05-inline-add"><span className="sr-only">New task title</span><input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') create(); if (event.key === 'Escape') setNewTitle('') }} placeholder="Add task title and press Enter" /><button onClick={create} disabled={!newTitle.trim() || pendingKeys.has('create')}><Plus size={16} /> Add task</button></label><button onClick={() => bulk('status', 'Done')} disabled={!visibleSelectedIds.length || pendingKeys.has('bulk')}>Bulk → Done</button><button onClick={() => bulk('cancel', null)} disabled={!visibleSelectedIds.length || pendingKeys.has('bulk')}>Cancel selected</button></div>
    <div className="p05-import"><label>Paste CSV/TSV<input value={importText} onChange={(event) => setImportText(event.target.value)} placeholder="title,owner,status,start,finish,parent_key,progress" /></label><button onClick={previewImport} disabled={!importText.trim()}>Preview</button>{importPreview ? <span>{importPreview.count} rows · {importPreview.errors?.length || 0} errors <button onClick={applyImport} disabled={!importPreview.valid}>Confirm import</button></span> : null}</div>
    {!filteredItems.length && work.items.length ? <p className="p05-empty" role="status">No tasks match these filters. Clear filters to restore the work list.</p> : null}
    <div className="p05-treegrid" role="treegrid" aria-label="Project work breakdown" aria-rowcount={aria.rowCount} aria-description={`Showing ${filteredItems.length} of ${aria.unfilteredCount} tasks; progress is separate from workflow status.`} data-virtualized="true" tabIndex={-1} ref={fallback} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}><div role="row" aria-rowindex={1} className="p05-grid-row p05-grid-header"><span role="columnheader">Task</span><span role="columnheader">Owner</span><span role="columnheader">Status</span><span role="columnheader">Progress</span><span role="columnheader">Finish</span></div><div className="p05-treegrid-spacer" style={{ height: `${Math.max(0, rows.length) * 48}px` }}>{visibleRows.map((row, visibleIndex) => { const globalIndex = virtualStart + visibleIndex; const task = row.task; const id = String(task.id); const blocked = (work.blockers || []).some((item: any) => String(item.task_id) === id); return <div role="row" key={id} data-task-id={id} aria-rowindex={globalIndex + 2} aria-level={row.depth} aria-posinset={row.posInSet} aria-setsize={row.setSize} aria-expanded={row.children.length ? row.expanded : undefined} tabIndex={0} className="p05-grid-row p05-grid-row-virtual" style={{ top: `${globalIndex * 48}px` }} onDoubleClick={(event) => openPanel(id, event.currentTarget)}><span role="gridcell" className="p05-task-name" style={{ paddingLeft: `${(row.depth - 1) * 20}px` }}><input type="checkbox" aria-label={`Select ${task.title}`} data-task-id={id} checked={selected.has(id)} onChange={() => toggleSelected(id)} />{row.children.length ? <button aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${task.title}`} onClick={() => toggle(id)}>{row.expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button> : <span className="p05-indent" />}{task.kind === 'Milestone' ? <span aria-label="Milestone">◆</span> : null}<button className="p05-link-button" onClick={(event) => openPanel(id, event.currentTarget)}>{task.title}</button>{blocked ? <AlertTriangle size={14} aria-label="Blocked" /> : null}</span><span role="gridcell">{task.owner_id || 'Unassigned'}</span><span role="gridcell"><select aria-label={`Status for ${task.title}`} value={task.status} disabled={pendingKeys.has(`task:${id}`)} onChange={(event) => transition(task, event.target.value)}>{WORK_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></span><span role="gridcell"><input aria-label={`Progress for ${task.title}`} type="number" min={0} max={99} value={task.progress} disabled={pendingKeys.has(`progress:${id}`)} onChange={(event) => dispatch({ type: 'task.update_fields', expected: { project_revision: work.project_revision, graph_revision: work.graph_revision, task_revision: task.revision }, payload: { task_id: task.id, progress: Number(event.target.value) }, pendingKey: `progress:${id}` })} />%</span><span role="gridcell">{task.end_date || task.point_date || 'Unscheduled'}</span></div>})}</div></div>
  </div>
  return <div className="p05-work-owner" data-p05-work-owner="true" data-project-id={projectId} data-p05-pending-command-count={pendingKeys.size}>{message ? <p className="p05-error" role="alert" aria-live="assertive">{message}</p> : null}{workContent}{taskPanel}</div>
}

function PlanView({ projectId, plan, section }: { projectId: string; plan: any; section: string }) {
  return <div className="p05-plan" data-p05-plan-section={section}>
    {section === 'brief' ? <>
      <section><p className="p05-eyebrow">Brief</p><h2>Project brief</h2><dl className="p05-brief"><div><dt>Problem</dt><dd>{plan.brief?.problem || 'Not recorded'}</dd></div><div><dt>Objective</dt><dd>{plan.brief?.objective || 'Not recorded'}</dd></div><div><dt>In scope</dt><dd>{plan.brief?.in_scope || 'Not recorded'}</dd></div><div><dt>Out of scope</dt><dd>{plan.brief?.out_of_scope || 'Not recorded'}</dd></div><div><dt>Delivery acceptance</dt><dd>{plan.brief?.delivery_acceptance?.length || 'No'} criteria recorded</dd></div></dl></section>
      <section><p className="p05-eyebrow">Shared work</p><h2>Work breakdown</h2><p>Plan and Work use the same task records. Edit owners, dates, dependencies, and progress in <Link to={`/projects/${encodeURIComponent(projectId)}/work`}>Work</Link>.</p><div className="p05-simple-list">{(plan.work_breakdown || []).slice(0, 20).map((item: any) => <div key={item.id}><strong>{item.title}</strong><span>{item.status} · {item.progress}%</span></div>)}{!plan.work_breakdown?.length ? <p className="p05-empty">No work items are recorded yet.</p> : null}</div></section>
    </> : null}
    {section === 'milestones' ? <section><p className="p05-eyebrow">Delivery schedule</p><h2>Milestones</h2><p>Milestones are checkpoints in the shared Project schedule.</p><div className="p05-simple-list">{(plan.milestones || []).map((item: any) => <div key={item.id}><strong>{item.title}</strong><span>{item.point_date || 'Point date not recorded'} · {item.status}</span></div>)}{!plan.milestones?.length ? <p className="p05-empty">No milestone recorded.</p> : null}</div></section> : null}
    {section === 'architecture' ? <section data-pv1-project-architecture-panel="true"><p className="p05-eyebrow">Architecture</p><h2>Architecture impact</h2><p>{plan.architecture?.assessment || 'Not assessed'}{plan.architecture?.rationale ? ` · ${plan.architecture.rationale}` : ''}</p><ArchitectureHost projectId={projectId} compact initialMode="impact" /></section> : null}
    {section === 'risks' ? <section><p className="p05-eyebrow">Risks & decisions</p><h2>Typed planning records</h2><div className="p05-simple-list">{(plan.governance || []).map((item: any) => <div key={item.id}><strong>{item.type} · {item.title}</strong><span>{item.state} · {item.owner_id || 'Unassigned'}</span></div>)}{!plan.governance?.length ? <p className="p05-empty">No risks, issues, assumptions, or decisions recorded.</p> : null}</div></section> : null}
    {section === 'resources' ? <section><div className="p05-resource-heading"><div><p className="p05-eyebrow">Resources</p><h2>Project library</h2><p>Manage documents, links, uploads, version history, and scan status in the full resource workspace.</p></div><Link className="p05-resource-open" to={`/projects/${encodeURIComponent(projectId)}/resources`}>Open resource library</Link></div><div className="p05-simple-list">{(plan.resources || []).map((item: any) => <div key={item.id}><strong>{item.title}</strong><span>{item.resource_kind} · {item.scan_state}{item.pinned ? ' · Pinned' : ''}</span></div>)}{!plan.resources?.length ? <p className="p05-empty">No resources are linked yet. Open the resource library to add the first one.</p> : null}</div></section> : null}
    {plan.guidance?.length ? <aside className="p05-guidance" aria-label="Planning guidance"><h2>Planning guidance</h2>{plan.guidance.map((item: any) => <a key={item.code} href={`#${item.fix}`}><AlertTriangle size={15} />{item.message}</a>)}</aside> : null}
  </div>
}
function PlanGovernanceEditor({ projectId, plan, onRefresh }: { projectId: string; plan: any; onRefresh: () => void }) {
  const [kind, setKind] = useState<'Risk' | 'Issue' | 'Assumption' | 'Decision'>('Risk')
  const [recordId, setRecordId] = useState('')
  const [title, setTitle] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [probability, setProbability] = useState('3')
  const [impact, setImpact] = useState('3')
  const [notes, setNotes] = useState('')
  const [approverId, setApproverId] = useState('')
  const [context, setContext] = useState('')
  const [options, setOptions] = useState('')
  const [recommendation, setRecommendation] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const records = plan.governance || []
  const reset = () => { setRecordId(''); setTitle(''); setOwnerId(''); setDueDate(''); setProbability('3'); setImpact('3'); setNotes(''); setApproverId(''); setContext(''); setOptions(''); setRecommendation(''); setErrorMessage(''); setSuccessMessage('') }
  const save = useMutation({
    mutationFn: () => {
      const commandType = kind === 'Decision' ? 'decision.request' : 'risk.save'
      const payload = kind === 'Decision'
        ? { title: title.trim(), owner_id: ownerId.trim() || undefined, approver_ids: [approverId.trim()], due_date: dueDate || undefined, context: context.trim(), options: options.split('\n').map((item) => item.trim()).filter(Boolean), recommendation: recommendation.trim() }
        : { ...(recordId ? { id: recordId } : {}), kind, title: title.trim(), state: records.find((item: any) => String(item.id) === recordId)?.state || 'Open', owner_id: ownerId.trim() || undefined, fields: { ...(kind === 'Risk' ? { probability: Number(probability), impact: Number(impact) } : {}), due_date: dueDate || null, notes: notes.trim() } }
      return command(projectId, commandType, { project_revision: plan.source_revisions.project_revision }, payload)
    },
    onSuccess: () => { const savedMessage = recordId ? 'Planning record updated.' : kind === 'Decision' ? 'Decision request sent to the named approver.' : 'Planning record added.'; reset(); setSuccessMessage(savedMessage); onRefresh() },
    onError: () => setErrorMessage('The planning record was not saved. Refresh the project and try again.'),
  })
  const edit = (record: any) => {
    setRecordId(String(record.id)); setKind(record.type); setTitle(record.title || ''); setOwnerId(record.owner_id || '')
    setDueDate(String(record.fields?.due_date || '').slice(0, 10)); setProbability(String(record.fields?.probability || 3)); setImpact(String(record.fields?.impact || 3)); setNotes(record.fields?.notes || ''); setErrorMessage(''); setSuccessMessage('')
  }
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')
    if (!title.trim()) { setErrorMessage('Add a short title before saving.'); return }
    if (kind === 'Decision' && (!approverId.trim() || !context.trim() || !recommendation.trim() || options.split('\n').map((item) => item.trim()).filter(Boolean).length < 2)) { setErrorMessage('Decision requests need a named approver, context, recommendation, and at least two options.'); return }
    save.mutate()
  }
  return <section className="p05-plan-editor" data-project-ui-form="true" aria-labelledby="p05-governance-editor-title">
    <header><div><p className="p05-eyebrow">Project plan · risks & decisions</p><h2 id="p05-governance-editor-title">Add a planning record</h2><p>Changes are saved as audited Project commands. Risk exposure is calculated from probability × impact.</p></div></header>
    {records.filter((record: any) => record.type !== 'Decision' && !['Approved', 'Rejected', 'Superseded'].includes(record.state)).length ? <div className="p05-record-edit-list" aria-label="Editable risk records">{records.filter((record: any) => record.type !== 'Decision' && !['Approved', 'Rejected', 'Superseded'].includes(record.state)).map((record: any) => <button key={record.id} type="button" onClick={() => edit(record)} aria-pressed={recordId === String(record.id)}><span>Edit {record.type.toLowerCase()}: {record.title}</span>{record.type === 'Risk' ? <small>Exposure: {record.fields?.exposure_level || 'Not scored'} · probability {record.fields?.probability || '—'} × impact {record.fields?.impact || '—'}</small> : <small>{record.state} · {record.owner_id || 'Unassigned'}</small>}</button>)}</div> : null}
    <form className="p05-record-form" onSubmit={submit}>
      <label>Record type<select value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setRecordId(''); setErrorMessage(''); setSuccessMessage('') }} disabled={Boolean(recordId)}><option>Risk</option><option>Issue</option><option>Assumption</option><option>Decision</option></select></label>
      <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} required placeholder={kind === 'Decision' ? 'Decision needed and outcome expected' : 'Describe the risk, issue, or assumption'} /></label>
      <label>Owner ID<input value={ownerId} onChange={(event) => setOwnerId(event.target.value)} placeholder="Leave blank to assign to you" /></label>
      <label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
      {kind === 'Risk' ? <><label>Probability<select value={probability} onChange={(event) => setProbability(event.target.value)}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} · {['', 'Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'][value]}</option>)}</select></label><label>Impact<select value={impact} onChange={(event) => setImpact(event.target.value)}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} · {['', 'Insignificant', 'Minor', 'Moderate', 'Major', 'Severe'][value]}</option>)}</select></label><label className="p05-record-wide">Mitigation / notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="What will reduce likelihood or impact?" /></label></> : null}
      {kind === 'Decision' ? <><label className="p05-record-wide">Named approver ID<input value={approverId} onChange={(event) => setApproverId(event.target.value)} required placeholder="The approver must be authorized for this project" /></label><label className="p05-record-wide">Context<textarea value={context} onChange={(event) => setContext(event.target.value)} required rows={3} placeholder="Why is a decision needed now?" /></label><label className="p05-record-wide">Options · one per line<textarea value={options} onChange={(event) => setOptions(event.target.value)} required rows={3} placeholder="Option A\nOption B" /></label><label className="p05-record-wide">Recommendation<textarea value={recommendation} onChange={(event) => setRecommendation(event.target.value)} required rows={3} placeholder="Recommended option and reason" /></label></> : null}
      {errorMessage ? <p className="p05-record-error" role="alert">{errorMessage}</p> : null}
      {successMessage ? <p className="p05-record-success" role="status">{successMessage}</p> : null}
      <div className="p05-record-actions"><button type="submit" disabled={save.isPending || !title.trim()}>{save.isPending ? 'Saving…' : recordId ? 'Save changes' : kind === 'Decision' ? 'Request decision' : 'Add record'}</button>{recordId ? <button type="button" onClick={reset} disabled={save.isPending}>Cancel edit</button> : null}</div>
    </form>
  </section>
}

export default function ProjectsWorkPlan() {
  const location = useLocation(); const navigate = useNavigate(); const route = shouldUseProjectsWorkPlan(location.pathname, location.search); const queryClient = useQueryClient()
  const online = useProjectsOnline()
  const activeRoute = route || { scope: 'my-day' as const, board: false }
  const projectId = activeRoute.projectId
  const project = useQuery({ queryKey: ['pv1-project-route', projectId], queryFn: () => apiFetch(`/api/v2/projects/${encodeURIComponent(projectId!)}`).then(jsonOrThrow), enabled: Boolean(projectId), staleTime: 30_000 })
  const projectReady = !projectId || (project.isSuccess && project.data?.legacy_project_id == null)
  const focus = useQuery({ queryKey: ['pv1-focus', projectId || 'all'], queryFn: () => apiFetch(`/api/v2/focus${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`).then(jsonOrThrow), enabled: Boolean(route) && projectReady && activeRoute.scope !== 'plan', staleTime: 10_000 })
  const work = useQuery({ queryKey: ['pv1-work', projectId], queryFn: () => apiFetch(`/api/v2/projects/${encodeURIComponent(projectId!)}/work`).then(jsonOrThrow), enabled: Boolean(projectId && activeRoute.scope === 'work') && projectReady, staleTime: 60_000, refetchOnMount: 'always' })
  const plan = useQuery({ queryKey: ['pv1-plan', projectId], queryFn: () => apiFetch(`/api/v2/projects/${encodeURIComponent(projectId!)}/plan`).then(jsonOrThrow), enabled: Boolean(projectId && activeRoute.scope === 'plan') && projectReady, staleTime: 60_000 })
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['pv1-focus'] }); queryClient.invalidateQueries({ queryKey: ['pv1-work', projectId] }); queryClient.invalidateQueries({ queryKey: ['pv1-plan', projectId] }) }
  const clearTaskSelection = useCallback(() => {
    const params = new URLSearchParams(location.search)
    if (!params.has('panel') && !params.has('entity')) return
    params.delete('panel')
    params.delete('entity')
    const search = params.toString()
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true })
  }, [location.pathname, location.search, navigate])
  if (!route) return null
  const legacyView = activeRoute.scope === 'work'
    ? activeRoute.board ? 'board' : 'tasks'
    : activeRoute.section === 'resources' ? 'files' : activeRoute.section === 'milestones' ? 'timeline' : ['brief', 'architecture', 'risks'].includes(activeRoute.section || '') ? 'insights' : 'overview'
  const legacySection = legacyView === 'insights' ? activeRoute.section : undefined
  if (projectId && project.isPending) return <main className="p05-page" data-workspace="projects" data-pv1-projects-route="true"><ProjectsOfflineNotice online={online} /><Header projectId={projectId} scope={activeRoute.scope} board={activeRoute.board} section={activeRoute.section} /><p className="p05-state">Loading project…</p></main>
  if (projectId && project.isError) return <main className="p05-page" data-workspace="projects" data-pv1-projects-route="true"><ProjectsOfflineNotice online={online} /><Header projectId={projectId} scope={activeRoute.scope} board={activeRoute.board} section={activeRoute.section} /><p className="p05-error" role="alert">Project could not be loaded. Check access or retry.</p><button className="p05-back" onClick={() => project.refetch()}>Retry</button></main>
  if (project.data?.legacy_project_id != null) return <main className="p05-page" data-workspace="projects" data-pv1-projects-route="true"><ProjectsOfflineNotice online={online} /><Header projectId={projectId} scope={activeRoute.scope} board={activeRoute.board} section={activeRoute.section} project={project.data} /><ProjectsLegacyWorkspaceRedirect project={project.data} view={legacyView} section={legacySection} /><button className="p05-back" onClick={() => navigate(`/projects/${encodeURIComponent(projectId!)}/home`)}>Back to Project Home</button></main>
  return <main className="p05-page" data-workspace="projects" data-pv1-projects-route="true" data-p05-scope={activeRoute.scope}>
    <ProjectsOfflineNotice online={online} />
    <Header projectId={projectId} scope={activeRoute.scope} board={activeRoute.board} section={activeRoute.section} project={project.data} />
    {activeRoute.scope !== 'plan' ? (focus.isPending ? <p className="p05-state">Loading Focus…</p> : focus.isError ? <div className="p05-error" role="alert">Could not load Focus. <button onClick={() => focus.refetch()}>Retry</button></div> : <FocusSection response={focus.data} projectId={projectId} onRefresh={refresh} />) : null}
    {activeRoute.scope === 'work' ? (work.isPending ? <p className="p05-state">Loading work…</p> : work.isError ? <div className="p05-error" role="alert">Could not load work records. <button onClick={() => work.refetch()}>Retry</button></div> : <WorkTree key={projectId} projectId={projectId!} work={work.data} board={activeRoute.board} onRefresh={refresh} taskSelection={{ hasSelection: Boolean(route.hasTaskSelection), panel: route.taskPanel, entity: route.taskEntity, locationKey: location.key }} workFetching={work.isFetching} clearTaskSelection={clearTaskSelection} />) : null}
    {activeRoute.scope === 'plan' ? (plan.isPending ? <p className="p05-state">Loading plan…</p> : plan.isError ? <div className="p05-error" role="alert">Could not load the project plan. <button onClick={() => plan.refetch()}>Retry</button></div> : <><PlanView projectId={projectId!} plan={plan.data} section={activeRoute.section || 'brief'} />{activeRoute.section === 'risks' ? <PlanGovernanceEditor projectId={projectId!} plan={plan.data} onRefresh={refresh} /> : null}</>) : null}
    <button className="p05-back" onClick={() => navigate(projectId ? `/projects/${encodeURIComponent(projectId)}/home` : '/projects')}>Back to {projectId ? 'Project Home' : 'Portfolio'}</button>
  </main>
}
