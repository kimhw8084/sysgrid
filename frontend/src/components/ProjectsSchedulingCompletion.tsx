import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, BarChart3, CalendarDays, CheckCircle2, ChevronRight, GitBranch, Layers3, Save, SlidersHorizontal, X } from 'lucide-react'
import toast from 'react-hot-toast'
import ProjectsGolden from './ProjectsGolden'
import ProjectsStory, { shouldUseProjectsStory } from './ProjectsStory'
import ProjectsWorkPlan, { shouldUseProjectsWorkPlan } from './ProjectsWorkPlan'
import ProjectsCommunication, { shouldUseProjectsCommunication } from './ProjectsCommunication'
import ProjectsOutcomes, { shouldUseProjectsOutcomes } from './ProjectsOutcomes'
import { parseProjectsLocation, shouldPreserveLegacyProjectsPortfolioLocation } from './ProjectsNavigation'
import { shouldUseProjectsTimeline } from './ProjectsTimeline.route'
import { ProjectsTimelineAuthority } from './ProjectsWorkspaceLayout'
import { apiFetch } from '../api/apiClient'
import { PROJECT_TASK_STATUSES, buildProjectTaskHierarchy, projectFingerprint, type ProjectTaskStatus } from './ProjectsGolden.model'
import {
  PROJECT_DEPENDENCY_TYPES,
  analyzeProjectSchedule,
  applyProjectScheduleScenario,
  buildProjectCapacityView,
  captureProjectScheduleBaselineV2,
  compareProjectScheduleBaseline,
  getProjectScheduleState,
  getProjectTaskConstraint,
  normalizeProjectTaskDependencies,
  saveProjectScheduleScenario,
  setProjectTaskConstraint,
  setProjectWorkingDays,
  setTypedProjectDependency,
  simulateNamedProjectScenario,
  type ProjectConstraintType,
  type ProjectDependencyType,
} from './ProjectsSchedulingCompletion.model'

const controlStyle = { minHeight: 40, minWidth: 40 } as const
const inputClass = 'w-full rounded-md border border-white/10 bg-[var(--sg-surface-2)] px-2 py-2 text-xs text-white outline-none focus:border-blue-500/40'
const buttonClass = 'inline-flex min-h-[40px] min-w-[40px] items-center justify-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-2 text-xs font-black uppercase tracking-wider text-slate-300 hover:border-blue-500/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40'
const primaryButtonClass = `${buttonClass} border-blue-500/30 bg-blue-500/10 text-blue-300`
const sectionClass = 'rounded-lg border border-white/5 bg-[var(--sg-surface-1)] p-3'
const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const constraintTypes: ProjectConstraintType[] = ['ASAP', 'SNET', 'FNLT', 'MUST_START', 'MUST_FINISH']
const ProjectsTimeline = React.lazy(() => import('./ProjectsTimeline'))

type BoardPendingMove = { taskId: string; taskName: string; fromStatus: ProjectTaskStatus; toStatus: ProjectTaskStatus }
type TaskKeyboardMoveDirection = 'earlier' | 'later'
type TaskKeyboardMovePlan = { taskId: string; direction: TaskKeyboardMoveDirection; neighborId: string; dragTaskId: string; dropTargetId: string }
type TaskPendingMove = TaskKeyboardMovePlan & { taskName: string }


export const syncTimelineDependencyButtonGlyph = (button: { textContent: string | null }): string => {
  const glyph = '↗'
  if (button.textContent !== glyph) button.textContent = glyph
  return glyph
}

export const timelineDependencyControlLabel = (source: { id: string; name: string } | null, taskIdValue: number | string, taskName: string): string => {
  const taskId = String(taskIdValue)
  if (!source) return `Start dependency from ${taskName}`
  if (source.id === taskId) return `Cancel dependency from ${taskName}`
  return `Add dependency from ${source.name} to ${taskName}`
}

export const timelineDependencyRelationMatches = (project: any, sourceIdValue: number | string, targetIdValue: number | string, expected = true): boolean => {
  const sourceId = String(sourceIdValue)
  const targetId = String(targetIdValue)
  const target = (Array.isArray(project?.tasks) ? project.tasks : []).find((task: any) => String(task?.id) === targetId)
  if (!target) return false
  const exists = normalizeProjectTaskDependencies(target).some((dependency) => String(dependency.id) === sourceId)
  return expected ? exists : !exists
}

export const syncTaskKeyboardMoveButtonGlyph = (button: { textContent: string | null }, direction: TaskKeyboardMoveDirection): string => {
  const glyph = direction === 'earlier' ? '↑' : '↓'
  if (button.textContent !== glyph) button.textContent = glyph
  return glyph
}

export const buildTaskKeyboardMovePlan = (project: any, taskIdValue: number | string, direction: TaskKeyboardMoveDirection): TaskKeyboardMovePlan | null => {
  const taskId = String(taskIdValue)
  const rows = buildProjectTaskHierarchy(project)
  const row = rows.find((candidate: any) => String(candidate?.task?.id ?? candidate?.id ?? '') === taskId)
  if (!row) return null
  const siblings = rows.filter((candidate: any) => String(candidate?.parentId ?? '') === String(row?.parentId ?? ''))
  const index = siblings.findIndex((candidate: any) => String(candidate?.task?.id ?? candidate?.id ?? '') === taskId)
  if (index < 0) return null
  if (direction === 'earlier') {
    const previousId = String(siblings[index - 1]?.task?.id ?? siblings[index - 1]?.id ?? '')
    return previousId ? { taskId, direction, neighborId: previousId, dragTaskId: taskId, dropTargetId: previousId } : null
  }
  const nextId = String(siblings[index + 1]?.task?.id ?? siblings[index + 1]?.id ?? '')
  return nextId ? { taskId, direction, neighborId: nextId, dragTaskId: nextId, dropTargetId: taskId } : null
}

export const taskKeyboardMoveRelationMatches = (project: any, pending: Pick<TaskPendingMove, 'taskId' | 'neighborId' | 'direction'>): boolean => {
  const list = Array.isArray(project?.tasks) ? project.tasks : []
  const moving = list.find((task: any) => String(task?.id) === pending.taskId)
  const neighbor = list.find((task: any) => String(task?.id) === pending.neighborId)
  if (!moving || !neighbor) return false
  const movingOrder = Number(moving?.order_index) || 0
  const neighborOrder = Number(neighbor?.order_index) || 0
  return pending.direction === 'earlier' ? movingOrder < neighborOrder : movingOrder > neighborOrder
}

type AccessibleControl = { getAttribute: (name: string) => string | null; setAttribute: (name: string, value: string) => void }
export const syncProjectTaskDrawerAccessibleName = (control: AccessibleControl, label: string): boolean => {
  if (control.getAttribute('aria-label') === label) return false
  control.setAttribute('aria-label', label)
  return true
}
export const projectTaskDrawerChecklistLabels = (taskName: string, itemName: string) => ({
  toggle: `Toggle checklist item ${itemName}`,
  remove: `Remove checklist item ${itemName}`,
  addInput: `Add checklist item for ${taskName}`,
  addButton: `Add checklist item for ${taskName}`,
})
export const projectTaskDrawerDependencyLabel = (taskName: string, dependencyName: string | null, action: 'add' | 'remove') => action === 'remove' && dependencyName ? `Remove dependency ${dependencyName}` : `Add selected dependency to ${taskName}`

const readProjects = async () => {
  const response = await apiFetch('/api/v1/projects')
  if (!response.ok) throw new Error(await response.text())
  return response.json()
}
const capacityTone = (status: string) => status === 'OVER' ? 'text-rose-300 border-rose-500/20 bg-rose-500/[0.04]' : status === 'WITHIN' ? 'text-emerald-300 border-emerald-500/20 bg-emerald-500/[0.04]' : 'text-amber-300 border-amber-500/20 bg-amber-500/[0.04]'
const signed = (value: number | null) => value == null ? 'Unknown' : `${value > 0 ? '+' : ''}${value}d`

function ProjectsLegacyAliasRedirect({ target }: { target: string }) {
  const navigate = useNavigate()
  useEffect(() => { navigate(target, { replace: true }) }, [navigate, target])
  return <main className="sg-pv1-state" aria-busy="true">Opening the canonical Project link…</main>
}

export default function ProjectsSchedulingCompletion() {
  const location = useLocation()
  const projectsRoute = parseProjectsLocation(location.pathname, location.search)
  const preserveLegacyPortfolio = shouldPreserveLegacyProjectsPortfolioLocation(location.pathname, location.search)
  if (projectsRoute.source === 'legacy' && projectsRoute.redirectTo && !preserveLegacyPortfolio) return <ProjectsLegacyAliasRedirect target={projectsRoute.redirectTo} />
  if (shouldUseProjectsStory(location.pathname, location.search)) return <ProjectsStory />
  if (shouldUseProjectsWorkPlan(location.pathname, location.search)) return <ProjectsWorkPlan />
  if (shouldUseProjectsOutcomes(location.pathname)) return <ProjectsOutcomes />
  if (shouldUseProjectsCommunication(location.pathname)) return <ProjectsCommunication />
  const timeline = shouldUseProjectsTimeline(location.pathname)
  if (timeline) return <React.Suspense fallback={<main className="sg-pv1-state" aria-busy="true">Loading Timeline…</main>}><ProjectsTimeline projectId={timeline.projectId} /></React.Suspense>
  return <ProjectsSchedulingWorkspace />
}

function ProjectsSchedulingWorkspace() {
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const view = String(searchParams.get('view') || 'overview').toLowerCase()
  const selectedId = String(searchParams.get('id') || '')
  const [open, setOpen] = useState(false)
  const [taskId, setTaskId] = useState('')
  const [predecessorId, setPredecessorId] = useState('')
  const [dependencyType, setDependencyType] = useState<ProjectDependencyType>('FS')
  const [lagDays, setLagDays] = useState(0)
  const [constraintType, setConstraintType] = useState<ProjectConstraintType>('ASAP')
  const [constraintDate, setConstraintDate] = useState('')
  const [workingDays, setWorkingDays] = useState<number[] | null>(null)
  const [baselineName, setBaselineName] = useState('')
  const [baselineId, setBaselineId] = useState('')
  const [scenarioName, setScenarioName] = useState('')
  const [scenarioTaskId, setScenarioTaskId] = useState('')
  const [scenarioSlipDays, setScenarioSlipDays] = useState(5)
  const [previewNonce, setPreviewNonce] = useState(0)
  const [liveMessage, setLiveMessage] = useState('')
  const [boardLiveMessage, setBoardLiveMessage] = useState('')
  const [taskLiveMessage, setTaskLiveMessage] = useState('')
  const boardPendingMoveRef = useRef<BoardPendingMove | null>(null)
  const taskPendingMoveRef = useRef<TaskPendingMove | null>(null)
  const workspaceRootRef = useRef<HTMLDivElement | null>(null)
  const scheduleToggleRef = useRef<HTMLButtonElement | null>(null)
  const scheduleCloseRef = useRef<HTMLButtonElement | null>(null)

  const { data: projects = [] } = useQuery<any[]>({ queryKey: ['projects'], queryFn: readProjects, staleTime: 30_000 })
  const selectedProject = useMemo(() => {
    const list = Array.isArray(projects) ? projects : []
    if (selectedId) return list.find((project: any) => String(project?.id) === selectedId) || null
    return list.find((project: any) => !['Completed', 'Cancelled'].includes(project?.status)) || list[0] || null
  }, [projects, selectedId])
  const tasks = Array.isArray(selectedProject?.tasks) ? selectedProject.tasks : []
  const selectedTask = tasks.find((task: any) => String(task?.id) === taskId) || null
  const scheduleState = getProjectScheduleState(selectedProject)
  const analysis = useMemo(() => analyzeProjectSchedule(selectedProject), [selectedProject])
  const capacity = useMemo(() => buildProjectCapacityView(selectedProject), [selectedProject])
  const baselineComparison = useMemo(() => baselineId ? compareProjectScheduleBaseline(selectedProject, baselineId) : [], [selectedProject, baselineId])
  const preview = useMemo(() => scenarioTaskId && scenarioSlipDays ? simulateNamedProjectScenario(selectedProject, scenarioTaskId, scenarioSlipDays) : null, [selectedProject, scenarioTaskId, scenarioSlipDays, previewNonce])

  useEffect(() => {
    const first = String(tasks[0]?.id || '')
    if (!taskId || !tasks.some((task: any) => String(task?.id) === taskId)) setTaskId(first)
    if (!scenarioTaskId || !tasks.some((task: any) => String(task?.id) === scenarioTaskId)) setScenarioTaskId(first)
  }, [selectedProject?.id, tasks.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedTask) return
    const constraint = getProjectTaskConstraint(selectedTask)
    setConstraintType(constraint.type); setConstraintDate(constraint.date || '')
    const firstPred = normalizeProjectTaskDependencies(selectedTask)[0]
    if (firstPred) { setPredecessorId(firstPred.id); setDependencyType(firstPred.type); setLagDays(firstPred.lag_days) }
    else { setPredecessorId(String(tasks.find((task: any) => String(task?.id) !== String(selectedTask?.id))?.id || '')); setDependencyType('FS'); setLagDays(0) }
  }, [selectedTask?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setWorkingDays(Array.isArray(scheduleState.working_days) ? [...scheduleState.working_days] : null)
    const firstBaseline = scheduleState.baselines?.[0]?.id || ''
    setBaselineId((current) => scheduleState.baselines?.some((item) => item.id === current) ? current : firstBaseline)
  }, [selectedProject?.id, JSON.stringify(scheduleState.working_days), scheduleState.baselines?.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => scheduleCloseRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  // Board keyboard status alternatives from accepted OUT-40 Slice C.
  useEffect(() => {
    if (view !== 'board') { boardPendingMoveRef.current = null; setBoardLiveMessage(''); return }
    const root = workspaceRootRef.current; if (!root) return
    const selectorValue = (value: string) => typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&')
    const decorate = () => root.querySelectorAll<HTMLElement>('[data-project-board-card="true"]').forEach((card) => {
      const id = String(card.getAttribute('data-task-id') || ''); if (!id) return
      const name = card.querySelector('h4')?.textContent?.trim() || `Task ${id}`
      const column = card.closest<HTMLElement>('[data-project-board-column]'); const status = String(column?.getAttribute('data-project-board-column') || '') as ProjectTaskStatus
      const index = PROJECT_TASK_STATUSES.indexOf(status); if (index < 0) return
      card.tabIndex = -1; card.setAttribute('data-project-board-focus-target', 'true'); card.setAttribute('aria-label', `${name}, ${status}`)
      const buttons = Array.from(card.querySelectorAll<HTMLButtonElement>('button')); if (buttons.length < 3) return
      const apply = (button: HTMLButtonElement, direction: 'previous' | 'next', destination: ProjectTaskStatus | null) => {
        button.style.minHeight = '40px'; button.style.minWidth = '40px'; button.setAttribute('data-project-board-move', direction); button.setAttribute('data-project-board-move-task', id)
        if (destination) { button.setAttribute('data-project-board-move-destination', destination); button.setAttribute('aria-label', `Move ${name} to ${destination}`) }
        else { button.removeAttribute('data-project-board-move-destination'); button.setAttribute('aria-label', `${name} has no ${direction} status`) }
      }
      apply(buttons[buttons.length - 2], 'previous', index > 0 ? PROJECT_TASK_STATUSES[index - 1] : null)
      apply(buttons[buttons.length - 1], 'next', index < PROJECT_TASK_STATUSES.length - 1 ? PROJECT_TASK_STATUSES[index + 1] : null)
    })
    // Retained OUT-40 contract markers: Move ${taskName} to ${destination}; card.focus({ preventScroll: true })
    const focusCard = (id: string) => requestAnimationFrame(() => { decorate(); root.querySelector<HTMLElement>(`[data-project-board-card="true"][data-task-id="${selectorValue(id)}"]`)?.focus({ preventScroll: true }) })
    const activate = (event: Event) => {
      const button = (event.target instanceof Element ? event.target : null)?.closest<HTMLButtonElement>('button[data-project-board-move]') || null
      if (!button || !root.contains(button) || button.disabled) return
      const id = String(button.getAttribute('data-project-board-move-task') || ''); const destination = button.getAttribute('data-project-board-move-destination') as ProjectTaskStatus | null
      const card = button.closest<HTMLElement>('[data-project-board-card="true"]'); const column = card?.closest<HTMLElement>('[data-project-board-column]')
      const fromStatus = String(column?.getAttribute('data-project-board-column') || '') as ProjectTaskStatus; const name = card?.querySelector('h4')?.textContent?.trim() || `Task ${id}`
      if (!id || !destination || !PROJECT_TASK_STATUSES.includes(destination) || !PROJECT_TASK_STATUSES.includes(fromStatus)) return
      boardPendingMoveRef.current = { taskId: id, taskName: name, fromStatus, toStatus: destination }; setBoardLiveMessage(`Moving ${name} to ${destination}…`)
    }
    const unsubscribe = queryClient.getMutationCache().subscribe((event: any) => {
      const pending = boardPendingMoveRef.current; const mutation = event?.mutation
      if (!pending || mutation?.options?.scope?.id !== 'projects-authoritative-write') return
      const requested = mutation?.state?.variables?.nextProject?.tasks?.find((task: any) => String(task?.id) === pending.taskId)
      if (!requested || requested.status !== pending.toStatus) return
      if (mutation.state.status === 'success') { const saved = mutation.state.data?.tasks?.find((task: any) => String(task?.id) === pending.taskId); if (!saved || saved.status !== pending.toStatus) return; boardPendingMoveRef.current = null; setBoardLiveMessage(`${pending.taskName} moved to ${pending.toStatus}`); focusCard(pending.taskId) }
      else if (mutation.state.status === 'error') { const message = mutation.state.error?.message || 'Project update failed'; boardPendingMoveRef.current = null; setBoardLiveMessage(`Could not move ${pending.taskName} to ${pending.toStatus}: ${message}`); focusCard(pending.taskId) }
    })
    decorate(); root.addEventListener('click', activate, true); const observer = new MutationObserver(decorate); observer.observe(root, { childList: true, subtree: true })
    return () => { observer.disconnect(); root.removeEventListener('click', activate, true); unsubscribe() }
  }, [view, queryClient])

  // WBS keyboard reordering from accepted OUT-40 Slice D.
  useEffect(() => {
    if (view !== 'tasks') { taskPendingMoveRef.current = null; setTaskLiveMessage(''); return }
    const root = workspaceRootRef.current; if (!root || !selectedProject) return
    const selectorValue = (value: string) => typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&')
    const currentProject = () => queryClient.getQueryData<any[]>(['projects'])?.find((project: any) => String(project?.id) === String(selectedProject?.id)) || selectedProject
    const taskRow = (id: string) => root.querySelector<HTMLElement>(`[data-project-task-row="true"][data-task-id="${selectorValue(id)}"]`)
    const decorate = () => {
      const project = currentProject(); const rows = buildProjectTaskHierarchy(project); const byId = new Map(rows.map((row: any) => [String(row?.task?.id ?? row?.id ?? ''), row]))
      root.querySelectorAll<HTMLElement>('[data-project-task-row="true"]').forEach((element) => {
        const id = String(element.getAttribute('data-task-id') || ''); const row = byId.get(id); const task = row?.task; if (!id || !task) return
        const name = String(task.name || `Task ${id}`); const cell = element.children.item(1) as HTMLElement | null; if (!cell) return
        element.tabIndex = -1; element.setAttribute('data-project-task-focus-target', 'true'); element.setAttribute('aria-label', name)
        let controls = cell.querySelector<HTMLElement>('[data-project-task-keyboard-reorder="true"]')
        if (!controls) { controls = document.createElement('span'); controls.setAttribute('data-project-task-keyboard-reorder', 'true'); controls.className = 'mr-1 inline-flex shrink-0 items-center gap-0.5'; const dragHandle = cell.querySelector<HTMLElement>('[draggable="true"]'); if (dragHandle?.nextSibling) cell.insertBefore(controls, dragHandle.nextSibling); else cell.appendChild(controls) }
        const ensure = (direction: TaskKeyboardMoveDirection) => {
          const plan = buildTaskKeyboardMovePlan(project, id, direction); let button = controls!.querySelector<HTMLButtonElement>(`button[data-project-task-move="${direction}"]`)
          if (!button) { button = document.createElement('button'); button.type = 'button'; button.setAttribute('data-project-task-move', direction); button.className = 'inline-flex h-[40px] w-[40px] items-center justify-center rounded-md border border-white/5 text-xs font-black text-slate-600 hover:border-blue-500/25 hover:bg-blue-500/10 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-25'; controls!.appendChild(button) }
          button.disabled = !plan; syncTaskKeyboardMoveButtonGlyph(button, direction); button.setAttribute('aria-label', `Move ${name} ${direction}`); button.setAttribute('data-project-task-move-task', id)
        }
        ensure('earlier'); ensure('later')
      })
    }
    const focusRow = (id: string) => requestAnimationFrame(() => { decorate(); taskRow(id)?.focus({ preventScroll: true }) })
    const dispatchReorder = (movingId: string, targetId: string) => {
      const source = taskRow(movingId); const target = taskRow(targetId); const handle = source?.querySelector<HTMLElement>('[draggable="true"]')
      if (!source || !target || !handle || typeof DataTransfer === 'undefined' || typeof DragEvent === 'undefined') return false
      const transfer = new DataTransfer(); handle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }))
      requestAnimationFrame(() => requestAnimationFrame(() => { const current = taskRow(targetId); if (!current) return; current.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer })); current.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })); handle.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: transfer })) }))
      return true
    }
    const activate = (event: Event) => {
      const button = (event.target instanceof Element ? event.target : null)?.closest<HTMLButtonElement>('button[data-project-task-move]') || null
      if (!button || !root.contains(button) || button.disabled) return
      event.preventDefault(); event.stopPropagation(); const direction = button.getAttribute('data-project-task-move') as TaskKeyboardMoveDirection | null; const id = String(button.getAttribute('data-project-task-move-task') || '')
      const name = taskRow(id)?.getAttribute('aria-label') || `Task ${id}`; if (!direction || !id) return
      const plan = buildTaskKeyboardMovePlan(currentProject(), id, direction); if (!plan) return
      taskPendingMoveRef.current = { ...plan, taskName: name }; setTaskLiveMessage(`Moving ${name} ${direction}…`)
      if (!dispatchReorder(plan.dragTaskId, plan.dropTargetId)) { taskPendingMoveRef.current = null; setTaskLiveMessage(`Could not move ${name} ${direction}: reorder control is unavailable`); focusRow(id) }
    }
    const unsubscribe = queryClient.getMutationCache().subscribe((event: any) => {
      const pending = taskPendingMoveRef.current; const mutation = event?.mutation
      if (!pending || mutation?.options?.scope?.id !== 'projects-authoritative-write') return
      if (!taskKeyboardMoveRelationMatches(mutation?.state?.variables?.nextProject, pending)) return
      if (mutation.state.status === 'success') { if (!taskKeyboardMoveRelationMatches(mutation.state.data, pending)) return; taskPendingMoveRef.current = null; setTaskLiveMessage(`${pending.taskName} moved ${pending.direction}`); focusRow(pending.taskId) }
      else if (mutation.state.status === 'error') { const message = mutation.state.error?.message || 'Project update failed'; taskPendingMoveRef.current = null; setTaskLiveMessage(`Could not move ${pending.taskName} ${pending.direction}: ${message}`); focusRow(pending.taskId) }
    })
    decorate(); root.addEventListener('click', activate, true); const observer = new MutationObserver(decorate); observer.observe(root, { childList: true, subtree: true })
    return () => { observer.disconnect(); root.removeEventListener('click', activate, true); unsubscribe() }
  }, [view, selectedProject?.id, queryClient])

  // Task Drawer naming/min-target hardening from accepted OUT-40 Slice F.
  useEffect(() => {
    const root = workspaceRootRef.current; const drawerTaskId = String(searchParams.get('task') || '')
    if (!root || !selectedProject || !drawerTaskId) return
    const currentProject = () => queryClient.getQueryData<any[]>(['projects'])?.find((project: any) => String(project?.id) === String(selectedProject?.id)) || selectedProject
    const drawerTask = () => (Array.isArray(currentProject()?.tasks) ? currentProject().tasks : []).find((task: any) => String(task?.id) === drawerTaskId) || null
    const ensureMin = (control: HTMLElement | null) => { if (!control) return; control.style.minHeight = '40px'; control.style.minWidth = '40px' }
    const decorate = () => {
      const drawer = root.querySelector<HTMLElement>('[data-project-task-drawer="true"]'); const task = drawerTask(); if (!drawer || !task) return
      const name = String(task.name || `Task ${drawerTaskId}`); const description = Array.from(drawer.querySelectorAll<HTMLTextAreaElement>('textarea')).find((control) => !control.getAttribute('aria-label')); if (description) syncProjectTaskDrawerAccessibleName(description, `Description for ${name}`)
      for (const label of ['Undo task change', 'Redo task change', 'Close task drawer']) ensureMin(drawer.querySelector<HTMLElement>(`button[aria-label="${label}"]`))
      const checklist = drawer.querySelector<HTMLElement>('[data-project-task-checklist="true"]')
      checklist?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((checkbox) => { const row = checkbox.parentElement; const item = row?.querySelector('span')?.textContent?.trim() || 'Checklist item'; const labels = projectTaskDrawerChecklistLabels(name, item); syncProjectTaskDrawerAccessibleName(checkbox, labels.toggle); const remove = row?.querySelector<HTMLButtonElement>('button') || null; if (remove) { syncProjectTaskDrawerAccessibleName(remove, labels.remove); ensureMin(remove) } })
      if (checklist) { const addInput = Array.from(checklist.querySelectorAll<HTMLInputElement>('input')).find((input) => input.type !== 'checkbox') || null; if (addInput) { const labels = projectTaskDrawerChecklistLabels(name, ''); syncProjectTaskDrawerAccessibleName(addInput, labels.addInput); const addButton = addInput.parentElement?.querySelector<HTMLButtonElement>('button') || null; if (addButton) { syncProjectTaskDrawerAccessibleName(addButton, labels.addButton); ensureMin(addButton) } } }
      const deps = drawer.querySelector<HTMLElement>('[data-project-task-dependencies="true"]')
      if (deps) { const select = deps.querySelector<HTMLSelectElement>('select[aria-label="Add task dependency"]'); const add = select?.parentElement?.querySelector<HTMLButtonElement>('button') || null; if (add) { syncProjectTaskDrawerAccessibleName(add, projectTaskDrawerDependencyLabel(name, null, 'add')); ensureMin(add) } deps.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { if (button === add) return; const dependencyName = button.parentElement?.querySelector('span')?.textContent?.trim() || ''; if (!dependencyName) return; syncProjectTaskDrawerAccessibleName(button, projectTaskDrawerDependencyLabel(name, dependencyName, 'remove')); ensureMin(button) }) }
    }
    decorate(); const observer = new MutationObserver(decorate); observer.observe(root, { childList: true, subtree: true }); return () => observer.disconnect()
  }, [selectedProject?.id, searchParams, queryClient])

  // Name any remaining Project controls that lack computed names (accepted Slice G behavior).
  useEffect(() => {
    const root = workspaceRootRef.current; if (!root) return
    const hasNativeLabel = (control: HTMLElement) => Boolean((control as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).labels?.length)
    const nameIfMissing = (control: HTMLElement | null, label: string) => { if (!control || control.getAttribute('aria-label') || control.getAttribute('aria-labelledby') || control.getAttribute('title') || hasNativeLabel(control)) return; control.setAttribute('aria-label', label) }
    const semanticText = (element: Element | null) => { if (!element) return ''; const clone = element.cloneNode(true) as HTMLElement; clone.querySelectorAll('input, select, textarea, button, option, svg').forEach((node) => node.remove()); return String(clone.textContent || '').replace(/\s+/g, ' ').trim() }
    const inferCreateName = (control: HTMLElement, index: number) => {
      const placeholder = String(control.getAttribute('placeholder') || '').replace(/[.…]+$/g, '').trim(); if (placeholder) return placeholder
      const own = String(control.getAttribute('name') || control.getAttribute('id') || '').replace(/[_-]+/g, ' ').trim(); if (own) return own.replace(/\b\w/g, (letter) => letter.toUpperCase())
      let sibling = control.previousElementSibling; while (sibling) { const text = semanticText(sibling); if (text && text.length <= 80) return text; sibling = sibling.previousElementSibling }
      let ancestor = control.parentElement; for (let depth = 0; ancestor && depth < 3; depth += 1, ancestor = ancestor.parentElement) { const text = semanticText(ancestor); if (text && text.length <= 80) return text }
      if (control instanceof HTMLSelectElement) { const values = Array.from(control.options).map((option) => option.textContent?.trim() || '').filter(Boolean); const joined = values.join(' | ').toLowerCase(); if (joined.includes('planning') && joined.includes('in progress') && joined.includes('completed')) return 'Project status'; if (joined.includes('low') && joined.includes('medium') && joined.includes('high')) return 'Project priority'; if (joined.includes('strategic') || joined.includes('operational') || joined.includes('tactical')) return 'Project type' }
      return `Create project ${control.tagName.toLowerCase()} ${index + 1}`
    }
    const decorateCreate = () => { const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find((candidate) => /Create Project Outcome/i.test(candidate.textContent || '')); if (!dialog) return; Array.from(dialog.querySelectorAll<HTMLElement>('input:not([type="hidden"]), select, textarea')).forEach((control, index) => nameIfMissing(control, inferCreateName(control, index))) }
    const decorate = () => { nameIfMissing(root.querySelector<HTMLElement>('[data-project-my-work="true"] input[placeholder="Owner name / username"]'), 'My Work owner'); nameIfMissing(root.querySelector<HTMLElement>('[data-project-task-paste="true"] textarea'), 'Paste tasks'); nameIfMissing(root.querySelector<HTMLElement>('[data-project-schedule-scenarios="true"] select'), 'Scenario task'); nameIfMissing(root.querySelector<HTMLElement>('[data-project-schedule-scenarios="true"] input[placeholder="Scenario name"]'), 'Scenario name'); nameIfMissing(root.querySelector<HTMLElement>('[data-project-schedule-baselines="true"] input[placeholder="Baseline name"]'), 'Baseline name'); nameIfMissing(root.querySelector<HTMLElement>('[data-project-schedule-baselines="true"] select'), 'Schedule baseline'); decorateCreate() }
    decorate(); const observer = new MutationObserver(decorate); observer.observe(root, { childList: true, subtree: true }); const bodyObserver = new MutationObserver(decorateCreate); bodyObserver.observe(document.body, { childList: true, subtree: true }); return () => { observer.disconnect(); bodyObserver.disconnect() }
  }, [])

  const updateMutation = useMutation({
    mutationFn: async ({ baseProject, nextProject, label }: { baseProject: any; nextProject: any; label: string }) => {
      const latestResponse = await apiFetch('/api/v1/projects'); if (!latestResponse.ok) throw new Error(await latestResponse.text())
      const latest = await latestResponse.json(); const remote = latest.find((item: any) => String(item?.id) === String(nextProject?.id))
      if (!remote || projectFingerprint(remote) !== projectFingerprint(baseProject)) throw new Error('Project changed since this schedule control loaded. Refresh before applying this edit.')
      const response = await apiFetch(`/api/v1/projects/${nextProject.id}`, { method: 'PUT', body: JSON.stringify(nextProject) }); if (!response.ok) throw new Error(await response.text())
      return { saved: await response.json(), label }
    },
    onMutate: ({ label }: any) => setLiveMessage(`Saving ${String(label || 'schedule update').toLowerCase()}…`),
    onSuccess: ({ saved, label }: any) => { queryClient.setQueryData<any[]>(['projects'], (current = []) => current.map((project: any) => String(project?.id) === String(saved?.id) ? saved : project)); setLiveMessage(label); toast.success(label) },
    meta: { handlesErrorToast: true },
    onError: (error: any) => { const message = error?.message || 'Schedule update failed'; setLiveMessage(message); toast.error(message) },
  })

  const persist = (nextProject: any, label: string) => {
    if (!selectedProject || nextProject === selectedProject || projectFingerprint(nextProject) === projectFingerprint(selectedProject)) return
    updateMutation.mutate({ baseProject: selectedProject, nextProject, label })
  }
  const persistModern = async (nextProject: any, label: string, displayedBase?: any) => {
    // The displayed timeline owns its base, not a wrapper's fallback selection.
    const baseProject = displayedBase || projects.find((item: any) => String(item.id) === String(nextProject?.id))
    if (!baseProject || String(baseProject.id) !== String(nextProject?.id)) throw new Error('Timeline project identity changed. Refresh before saving.')
    if (nextProject === baseProject || projectFingerprint(nextProject) === projectFingerprint(baseProject)) return baseProject
    const result = await updateMutation.mutateAsync({ baseProject, nextProject, label })
    return result.saved
  }

  const saveDependency = () => { if (!selectedProject || !taskId || !predecessorId) return; const next = setTypedProjectDependency(selectedProject, taskId, predecessorId, dependencyType, lagDays, true); if (next === selectedProject) { const message = 'Dependency was not changed. Check for a duplicate or cycle.'; setLiveMessage(message); toast.error(message); return } persist(next, 'Typed dependency saved') }
  const removeDependency = (predecessor: string) => selectedProject && persist(setTypedProjectDependency(selectedProject, taskId, predecessor, 'FS', 0, false), 'Dependency removed')
  const saveConstraint = () => selectedProject && persist(setProjectTaskConstraint(selectedProject, taskId, { type: constraintType, date: constraintType === 'ASAP' ? null : constraintDate }), 'Task constraint saved')
  const saveCalendar = () => selectedProject && persist(setProjectWorkingDays(selectedProject, workingDays), 'Working calendar saved')
  const captureBaseline = () => selectedProject && persist(captureProjectScheduleBaselineV2(selectedProject, baselineName), 'Schedule baseline captured')
  const saveScenario = () => { if (!selectedProject || !scenarioTaskId || !scenarioSlipDays) return; const result = saveProjectScheduleScenario(selectedProject, { name: scenarioName, taskId: scenarioTaskId, slipDays: scenarioSlipDays }); persist(result.project, 'Scenario saved without changing live dates'); setScenarioName('') }
  const applyScenario = (scenarioId: string) => { if (!selectedProject) return; const result = applyProjectScheduleScenario(selectedProject, scenarioId); if (result.project === selectedProject) { if ('blockedReason' in result && result.blockedReason) { setLiveMessage(result.blockedReason); toast.error(result.blockedReason) } return } persist(result.project, `Scenario applied to ${result.affected.length} task${result.affected.length === 1 ? '' : 's'}`) }
  const toggleDay = (day: number) => setWorkingDays((current) => { const base = current == null ? [1, 2, 3, 4, 5] : current; return base.includes(day) ? base.filter((value) => value !== day) : [...base, day].sort() })
  const closeScheduleControl = () => { setOpen(false); requestAnimationFrame(() => scheduleToggleRef.current?.focus()) }
  const handleScheduleDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>) => { if (event.key !== 'Escape') return; event.preventDefault(); event.stopPropagation(); closeScheduleControl() }

  useEffect(() => setOpen(false), [selectedProject?.id])
  const timelineActive = view === 'timeline'
  const criticalRows = analysis.rows.filter((row) => row.critical)
  const dependencies = normalizeProjectTaskDependencies(selectedTask)

  return <div ref={workspaceRootRef} className="relative h-full min-h-0" data-projects-scheduling-completion="true" data-project-visual-repair="v1">
    <ProjectsTimelineAuthority.Provider value={{ onPersist: persistModern, isSaving: updateMutation.isPending, scheduleControl: (<button ref={scheduleToggleRef} type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-controls="project-schedule-control-drawer" aria-haspopup="dialog" data-project-schedule-control-toggle="true" className="absolute right-4 top-3 z-40 inline-flex min-h-[40px] min-w-[40px] items-center gap-2 rounded-lg border border-blue-500/30 bg-[var(--sg-surface-2)]/95 px-3 py-2 text-xs font-black uppercase tracking-widest text-blue-300 shadow-xl backdrop-blur hover:bg-blue-500/10"><SlidersHorizontal size={13} /> Schedule control <ChevronRight size={12} className={open ? 'rotate-180' : ''} /></button>) }}><ProjectsGolden /></ProjectsTimelineAuthority.Provider>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-project-board-live-status="true">{boardLiveMessage}</p>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-project-task-live-status="true">{taskLiveMessage}</p>
    {timelineActive && selectedProject && open ? createPortal(<aside id="project-schedule-control-drawer" role="dialog" aria-modal="true" aria-labelledby="project-schedule-control-title" aria-describedby="project-schedule-control-description" aria-busy={updateMutation.isPending} onKeyDown={handleScheduleDialogKeyDown} className="absolute inset-x-2 bottom-2 top-14 z-50 flex flex-col overflow-hidden rounded-xl border border-blue-500/20 bg-[var(--sg-surface-2)] shadow-2xl backdrop-blur sm:left-auto sm:right-3 sm:w-[470px]" data-project-schedule-control-drawer="true">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/5 px-4 py-3"><div className="min-w-0"><p className="text-xs font-black uppercase tracking-[0.2em] text-blue-400">OUT-40 · Flagship Gantt modernization</p><h2 id="project-schedule-control-title" className="mt-1 text-sm font-black text-white">Scheduling, capacity & scenarios</h2><p id="project-schedule-control-description" className="mt-1 text-xs text-slate-500">One scheduler, one canonical Project truth. Controls extend the connected Gantt.</p></div><button ref={scheduleCloseRef} type="button" onClick={closeScheduleControl} className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close schedule control"><X size={16} /></button></header>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-project-schedule-live-status="true">{liveMessage}</p>
        <div className="flex-1 space-y-3 overflow-y-auto p-3 custom-scrollbar">
          <section className={sectionClass} data-project-schedule-network="true"><div className="flex items-center justify-between"><span><p className="text-xs font-black uppercase tracking-widest text-slate-600">Dependency network</p><h3 className="mt-1 text-xs font-black text-white">Typed relationship + lag</h3></span><GitBranch size={15} className="text-blue-400" /></div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"><label className="text-xs font-black uppercase text-slate-600">Task<select style={controlStyle} className={`${inputClass} mt-1`} value={taskId} onChange={(event) => setTaskId(event.target.value)}>{tasks.map((task: any) => <option key={String(task.id)} value={String(task.id)}>{task.name || task.id}</option>)}</select></label><label className="text-xs font-black uppercase text-slate-600">Predecessor<select style={controlStyle} className={`${inputClass} mt-1`} value={predecessorId} onChange={(event) => setPredecessorId(event.target.value)}><option value="">Select</option>{tasks.filter((task: any) => String(task.id) !== taskId).map((task: any) => <option key={String(task.id)} value={String(task.id)}>{task.name || task.id}</option>)}</select></label><label className="text-xs font-black uppercase text-slate-600">Type<select style={controlStyle} className={`${inputClass} mt-1`} value={dependencyType} onChange={(event) => setDependencyType(event.target.value as ProjectDependencyType)}>{PROJECT_DEPENDENCY_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label><label className="text-xs font-black uppercase text-slate-600">Lag / lead days<input style={controlStyle} className={`${inputClass} mt-1`} type="number" value={lagDays} onChange={(event) => setLagDays(Number(event.target.value))} /></label></div>
            <button className={`${primaryButtonClass} mt-2 w-full`} disabled={updateMutation.isPending || !predecessorId} onClick={saveDependency}><Save size={11} /> Save dependency</button>
            <div className="mt-2 space-y-1">{dependencies.length ? dependencies.map((dep) => <div key={`${dep.id}:${taskId}:${dep.type}:${dep.lag_days}`} className="flex items-center justify-between rounded-md border border-white/5 bg-white/[0.02] px-2 py-1.5 text-xs"><span className="text-slate-400">{dep.id} → {taskId} <b className="text-blue-300">{dep.type}</b> {dep.lag_days >= 0 ? '+' : ''}{dep.lag_days}d</span><button className="min-h-[40px] min-w-[40px] rounded-md px-2 text-xs text-rose-300 hover:bg-rose-500/10" onClick={() => removeDependency(dep.id)}>Remove</button></div>) : <p className="mt-2 text-xs text-slate-700">Legacy IDs display as FS +0d until edited; no migration loss.</p>}</div>
          </section>

          <section className={sectionClass} data-project-schedule-analysis="true"><div className="flex items-center justify-between"><span><p className="text-xs font-black uppercase tracking-widest text-slate-600">Critical path & slack</p><h3 className="mt-1 text-xs font-black text-white">Typed-edge CPM</h3></span><BarChart3 size={15} className="text-violet-300" /></div>
            {analysis.cycle ? <p className="mt-2 rounded-md border border-rose-500/20 bg-rose-500/[0.04] p-2 text-xs text-rose-300"><AlertTriangle size={11} className="mr-1 inline" />Cycle detected; new cyclic edges are rejected.</p> : <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3"><div className="rounded-md border border-white/5 p-2"><small className="text-xs uppercase text-slate-700">Critical</small><b className="mt-1 block text-sm text-white">{criticalRows.length}</b></div><div className="rounded-md border border-white/5 p-2"><small className="text-xs uppercase text-slate-700">Network span</small><b className="mt-1 block text-sm text-white">{analysis.makespanDays}d</b></div><div className="rounded-md border border-white/5 p-2"><small className="text-xs uppercase text-slate-700">Tasks</small><b className="mt-1 block text-sm text-white">{analysis.rows.length}</b></div></div>}
            <div className="mt-2 max-h-36 overflow-auto"><table className="w-full text-left text-xs"><thead className="text-slate-700"><tr><th className="py-1">Task</th><th>Slack</th><th>Path</th></tr></thead><tbody>{analysis.rows.slice().sort((a, b) => a.slackDays - b.slackDays).slice(0, 30).map((row) => <tr key={row.id} className="border-t border-white/[0.03]"><td className="max-w-[250px] truncate py-1 text-slate-400">{row.name}</td><td className="tabular-nums text-slate-500">{row.slackDays}d</td><td className={row.constraintViolation ? 'font-black text-amber-300' : row.critical ? 'font-black text-rose-300' : 'text-slate-700'}>{row.constraintViolation || (row.critical ? 'Critical' : 'Flexible')}</td></tr>)}</tbody></table></div>
          </section>

          <section className={sectionClass} data-project-schedule-constraints="true"><div className="flex items-center justify-between"><span><p className="text-xs font-black uppercase tracking-widest text-slate-600">Calendar & constraints</p><h3 className="mt-1 text-xs font-black text-white">Explicit schedule authority</h3></span><CalendarDays size={15} className="text-emerald-300" /></div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"><label className="text-xs font-black uppercase text-slate-600">Constraint<select style={controlStyle} className={`${inputClass} mt-1`} value={constraintType} onChange={(event) => setConstraintType(event.target.value as ProjectConstraintType)}>{constraintTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label className="text-xs font-black uppercase text-slate-600">Constraint date<input style={controlStyle} className={`${inputClass} mt-1`} type="date" disabled={constraintType === 'ASAP'} value={constraintDate} onChange={(event) => setConstraintDate(event.target.value)} /></label></div><button className={`${buttonClass} mt-2 w-full`} disabled={updateMutation.isPending || (constraintType !== 'ASAP' && !constraintDate)} onClick={saveConstraint}>Save task constraint</button>
            <div className="mt-3"><div className="flex items-center justify-between"><p className="text-xs font-black uppercase text-slate-600">Project working days</p><button className="min-h-[40px] min-w-[40px] rounded-md px-2 text-xs font-black text-amber-300 hover:bg-amber-500/10" onClick={() => setWorkingDays(null)}>No explicit calendar</button></div><div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-7">{dayLabels.map((label, day) => <button key={label} type="button" aria-pressed={workingDays?.includes(day) ?? false} onClick={() => toggleDay(day)} className={`min-h-[40px] min-w-[40px] rounded-md border px-1 py-1.5 text-xs font-black ${workingDays?.includes(day) ? 'border-blue-500/30 bg-blue-500/10 text-blue-300' : 'border-white/5 text-slate-700'}`}>{label}</button>)}</div><p className="mt-2 text-xs text-slate-700">{workingDays == null ? 'No working calendar is inferred. Existing project dates remain authoritative.' : `Explicit project calendar: ${workingDays.map((day) => dayLabels[day]).join(', ')}`}</p><button className={`${buttonClass} mt-2 w-full`} disabled={updateMutation.isPending || (workingDays != null && !workingDays.length)} onClick={saveCalendar}>Save calendar</button></div>
          </section>

          <section className={sectionClass} data-project-schedule-scenarios="true"><div className="flex items-center justify-between"><span><p className="text-xs font-black uppercase tracking-widest text-slate-600">What-if scenarios</p><h3 className="mt-1 text-xs font-black text-white">Preview first · explicit Apply</h3></span><Layers3 size={15} className="text-cyan-300" /></div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_90px]"><select aria-label="Scenario task" style={controlStyle} className={inputClass} value={scenarioTaskId} onChange={(event) => setScenarioTaskId(event.target.value)}>{tasks.map((task: any) => <option key={String(task.id)} value={String(task.id)}>{task.name || task.id}</option>)}</select><input style={controlStyle} className={inputClass} type="number" value={scenarioSlipDays} onChange={(event) => setScenarioSlipDays(Number(event.target.value))} aria-label="Scenario slip days" /></div><input aria-label="Scenario name" style={controlStyle} className={`${inputClass} mt-2`} placeholder="Scenario name" value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} /><div className="mt-2 rounded-md border border-cyan-500/10 bg-cyan-500/[0.025] p-2 text-xs text-slate-500" data-project-scenario-preview="true">Preview is mutation-free: <b className="text-slate-300">{preview?.affected.length || 0}</b> affected · finish <b className="text-cyan-300">{signed(preview?.finishDeltaDays ?? 0)}</b>{preview?.constraintViolations?.length ? <span className="ml-1 text-rose-300">· {preview.constraintViolations.length} constraint violation(s); Apply is blocked</span> : null}.</div><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2"><button className={buttonClass} onClick={() => setPreviewNonce((value) => value + 1)}>Refresh preview</button><button className={primaryButtonClass} disabled={updateMutation.isPending || !scenarioTaskId || !scenarioSlipDays} onClick={saveScenario}>Save scenario</button></div>
            <div className="mt-2 space-y-1">{(scheduleState.scenarios || []).slice(0, 8).map((scenario) => <div key={scenario.id} className="flex items-center justify-between rounded-md border border-white/5 bg-white/[0.02] p-2"><span className="min-w-0"><b className="block truncate text-xs text-slate-300">{scenario.name}</b><small className="text-xs text-slate-700">{scenario.task_id} · {scenario.slip_days >= 0 ? '+' : ''}{scenario.slip_days}d · {scenario.status}</small></span>{scenario.status === 'PROPOSED' ? <button className={primaryButtonClass} disabled={updateMutation.isPending} onClick={() => applyScenario(scenario.id)}><CheckCircle2 size={10} /> Apply</button> : <span className="text-xs font-black text-emerald-300">Applied</span>}</div>)}</div>
          </section>

          <section className={sectionClass} data-project-schedule-baselines="true"><div className="flex items-center justify-between"><span><p className="text-xs font-black uppercase tracking-widest text-slate-600">Baseline history</p><h3 className="mt-1 text-xs font-black text-white">Immutable comparisons</h3></span><Save size={15} className="text-amber-300" /></div><div className="mt-2 flex flex-col gap-2 sm:flex-row"><input aria-label="Baseline name" style={controlStyle} className={inputClass} value={baselineName} onChange={(event) => setBaselineName(event.target.value)} placeholder="Baseline name" /><button className={primaryButtonClass} disabled={updateMutation.isPending} onClick={captureBaseline}>Capture</button></div>{(scheduleState.baselines || []).length ? <><select aria-label="Schedule baseline" style={controlStyle} className={`${inputClass} mt-2`} value={baselineId} onChange={(event) => setBaselineId(event.target.value)}>{(scheduleState.baselines || []).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.captured_at.slice(0, 10)}</option>)}</select><div className="mt-2 max-h-28 overflow-y-auto text-xs">{baselineComparison.slice(0, 30).map((row) => <div key={row.id} className="grid grid-cols-[1fr_55px_55px] border-t border-white/[0.03] py-1"><span className="truncate text-slate-500">{row.name}</span><span className="text-right text-slate-600">S {signed(row.startDeltaDays)}</span><span className="text-right text-slate-600">F {signed(row.endDeltaDays)}</span></div>)}</div></> : <p className="mt-2 text-xs text-slate-700">No schedule baseline captured yet.</p>}</section>

          <section className={sectionClass} data-project-schedule-capacity="true"><div className="flex items-center justify-between"><span><p className="text-xs font-black uppercase tracking-widest text-slate-600">Resource pressure</p><h3 className="mt-1 text-xs font-black text-white">Workload ≠ invented capacity</h3></span><BarChart3 size={15} className="text-amber-300" /></div><p className="mt-2 text-xs text-slate-700">Capacity is only evaluated when canonical project metadata provides an explicit owner limit. Otherwise it remains Unknown.</p><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">{capacity.slice(0, 12).map((row) => <div key={row.owner} className={`rounded-md border p-2 ${capacityTone(row.status)}`}><b className="block truncate text-xs">{row.owner}</b><span className="mt-1 block text-xs">Workload {row.workload} · Capacity {row.capacity == null ? 'Unknown' : row.capacity} · {row.status}</span></div>)}</div></section>
        </div>
      </aside>, document.body) : null}
  </div>
}
