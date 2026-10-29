// SYSGRID_VISUAL_REPAIR_V1
import { canonicalTaskStatus } from './ProjectsVisualRepair.geometry'
export const PROJECT_GOLDEN_VIEWS = ['overview', 'tasks', 'timeline', 'board', 'files', 'updates', 'reports', 'insights', 'portfolio'] as const
export type ProjectGoldenView = (typeof PROJECT_GOLDEN_VIEWS)[number]
export const PROJECT_PRIMARY_VIEWS = ['overview', 'tasks', 'timeline', 'board', 'files', 'updates', 'reports', 'insights'] as const
export type ProjectPrimaryView = (typeof PROJECT_PRIMARY_VIEWS)[number]
export const PROJECT_PORTFOLIO_SECTIONS = ['control', 'roadmap', 'owners'] as const
export type ProjectPortfolioSection = (typeof PROJECT_PORTFOLIO_SECTIONS)[number]
export const PROJECT_INSIGHT_SECTIONS = ['review', 'governance'] as const
export type ProjectInsightSection = (typeof PROJECT_INSIGHT_SECTIONS)[number]
export const PROJECT_RAIL_SCOPES = ['recent', 'watched', 'active', 'all'] as const
export type ProjectRailScope = (typeof PROJECT_RAIL_SCOPES)[number]

export const PROJECT_TASK_STATUSES = ['To Do', 'In Progress', 'Blocked', 'Review', 'Completed'] as const
// Retained source contract: reopening a completed task must clamp progress below 100.
// if (next.status === 'Completed') next.progress = 100; task?.status === 'Completed'
export type ProjectTaskStatus = (typeof PROJECT_TASK_STATUSES)[number]

export const PROJECT_SORT_MODES = ['order', 'health', 'priority', 'deadline', 'progress', 'blocked', 'value', 'name'] as const
export type ProjectSortMode = (typeof PROJECT_SORT_MODES)[number]
export const PROJECT_SWIMLANES = ['none', 'owner', 'priority', 'milestone', 'criticality'] as const
export type ProjectSwimlane = (typeof PROJECT_SWIMLANES)[number]
export const PROJECT_TIMELINE_ZOOMS = ['day', 'week', 'month', 'quarter'] as const
export type ProjectTimelineZoom = (typeof PROJECT_TIMELINE_ZOOMS)[number]
export const PROJECT_EXECUTION_CONFIG_KEY = 'project_execution_config_v1'
export const PROJECT_REPORTING_KEY = 'project_reporting_v1'
export const PROJECT_UPDATES_KEY = 'project_updates_v1'
export type ProjectHealth = 'green' | 'amber' | 'red' | 'unknown'
export type ProjectAttentionKind = 'blocked' | 'overdue' | 'due-soon' | 'unassigned' | 'high-priority' | 'review-congestion' | 'unknown-status'
export type ProjectAttentionTone = 'rose' | 'amber' | 'blue' | 'slate'

export const PROJECT_GOVERNANCE_KEY = 'project_governance_v1'
export type ProjectRaidType = 'Risk' | 'Assumption' | 'Issue' | 'Dependency'
export type ProjectRaidStatus = 'Open' | 'Mitigating' | 'Closed'
export type ProjectImpactLevel = 'Low' | 'Medium' | 'High' | 'Critical'
export type ProjectDecisionKind = 'Decision' | 'Change'
export type ProjectDecisionStatus = 'Proposed' | 'Approved' | 'Rejected' | 'Superseded'
export type ProjectGateStatus = 'Not Ready' | 'Ready' | 'Approved' | 'Blocked'

export interface ProjectGovernanceState {
  raid: any[]
  decisions: any[]
  stageGates: any[]
  reviewSnapshots: any[]
  benefitTargets: { manHoursSaved: number | null; stoplossMinutesSaved: number | null; wafersGained: number | null }
  audit: any[]
}

const DAY_MS = 86_400_000
const PROJECT_PRIORITY_RANK: Record<string, number> = { Highest: 4, High: 3, Medium: 2, Low: 1 }
const HEALTH_RANK: Record<ProjectHealth, number> = { red: 3, amber: 2, green: 1, unknown: 0 }

const LEGACY_PROJECT_VIEW_ALIASES: Record<string, ProjectGoldenView> = {
  workspace: 'timeline',
  roadmap: 'portfolio',
  owners: 'portfolio',
  review: 'insights',
  governance: 'insights',
}

export const resolveProjectGoldenView = (value?: string | null): ProjectGoldenView => {
  const normalized = String(value || '').trim().toLowerCase()
  if (PROJECT_GOLDEN_VIEWS.includes(normalized as ProjectGoldenView)) return normalized as ProjectGoldenView
  return LEGACY_PROJECT_VIEW_ALIASES[normalized] || 'overview'
}

export const resolveProjectPortfolioSection = (value?: string | null, legacyView?: string | null): ProjectPortfolioSection => {
  const normalized = String(value || '').trim().toLowerCase()
  if (PROJECT_PORTFOLIO_SECTIONS.includes(normalized as ProjectPortfolioSection)) return normalized as ProjectPortfolioSection
  if (legacyView === 'roadmap') return 'roadmap'
  if (legacyView === 'owners') return 'owners'
  return 'control'
}

export const resolveProjectInsightSection = (value?: string | null, legacyView?: string | null): ProjectInsightSection => {
  const normalized = String(value || '').trim().toLowerCase()
  if (PROJECT_INSIGHT_SECTIONS.includes(normalized as ProjectInsightSection)) return normalized as ProjectInsightSection
  if (normalized === 'risks') return 'governance'
  return legacyView === 'governance' ? 'governance' : 'review'
}

export const normalizeProjectFilterValue = (value?: string | null) => {
  const normalized = String(value ?? '').trim()
  return !normalized || normalized.toLowerCase() === 'all' ? 'ALL' : normalized
}

export interface ProjectSavedViewState {
  search: string
  statusFilter: string
  priorityFilter: string
  sortMode: ProjectSortMode
  watchedOnly: boolean
  view: ProjectGoldenView
}

export interface ProjectWorkspaceViewDefinition {
  searchTerm: string
  filters: { status: string[]; priority: string[]; watch: string[] }
  activeTab: ProjectGoldenView
  mode: ProjectSortMode
}

const normalizeProjectSortMode = (value: unknown): ProjectSortMode => {
  const normalized = String(value ?? '').trim().toLowerCase()
  return PROJECT_SORT_MODES.includes(normalized as ProjectSortMode) ? normalized as ProjectSortMode : 'order'
}

const projectSavedViewStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  value.slice(0, 200).forEach((entry) => {
    if (typeof entry !== 'string') return
    const normalized = entry.trim()
    if (normalized && !result.includes(normalized)) result.push(normalized)
  })
  return result
}

export const normalizeProjectSavedViewState = (value: unknown): ProjectSavedViewState => {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    search: typeof record.search === 'string' ? record.search.trim().slice(0, 500) : '',
    statusFilter: normalizeProjectFilterValue(typeof record.statusFilter === 'string' ? record.statusFilter : 'ALL'),
    priorityFilter: normalizeProjectFilterValue(typeof record.priorityFilter === 'string' ? record.priorityFilter : 'ALL'),
    sortMode: normalizeProjectSortMode(record.sortMode),
    watchedOnly: record.watchedOnly === true,
    view: resolveProjectGoldenView(typeof record.view === 'string' ? record.view : null),
  }
}

export const projectSavedViewToWorkspaceDefinition = (value: unknown): ProjectWorkspaceViewDefinition => {
  const state = normalizeProjectSavedViewState(value)
  return {
    searchTerm: state.search,
    filters: {
      status: state.statusFilter === 'ALL' ? [] : [state.statusFilter],
      priority: state.priorityFilter === 'ALL' ? [] : [state.priorityFilter],
      watch: state.watchedOnly ? ['watched'] : [],
    },
    activeTab: state.view,
    mode: state.sortMode,
  }
}

export const projectSavedViewFromWorkspaceDefinition = (value: unknown): ProjectSavedViewState => {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const filters = record.filters && typeof record.filters === 'object' && !Array.isArray(record.filters)
    ? record.filters as Record<string, unknown>
    : {}
  const status = projectSavedViewStringList(filters.status)[0] || 'ALL'
  const priority = projectSavedViewStringList(filters.priority)[0] || 'ALL'
  const watch = projectSavedViewStringList(filters.watch)
  return normalizeProjectSavedViewState({
    search: typeof record.searchTerm === 'string' ? record.searchTerm : '',
    statusFilter: status,
    priorityFilter: priority,
    sortMode: record.mode,
    watchedOnly: watch.includes('watched'),
    view: typeof record.activeTab === 'string' ? record.activeTab : null,
  })
}

export const normalizeTaskStatus = (value?: string | null): ProjectTaskStatus | 'Unknown' => { const status = canonicalTaskStatus(value); return PROJECT_TASK_STATUSES.includes(status as ProjectTaskStatus) ? status as ProjectTaskStatus : 'Unknown' }

const dateParts = (value?: string | Date | null): [number, number, number] | null => {
  if (!value) return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return [value.getFullYear(), value.getMonth() + 1, value.getDate()]
  }
  const text = String(value).trim()
  const isoCalendar = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (isoCalendar) {
    const y = Number(isoCalendar[1]); const m = Number(isoCalendar[2]); const d = Number(isoCalendar[3])
    const stamp = Date.UTC(y, m - 1, d)
    const check = new Date(stamp)
    if (check.getUTCFullYear() === y && check.getUTCMonth() + 1 === m && check.getUTCDate() === d) return [y, m, d]
    return null
  }
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return null
  return [parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()]
}

const calendarOrdinal = (value?: string | Date | null) => {
  const parts = dateParts(value)
  return parts ? Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / DAY_MS) : null
}

export const getDaysToDue = (value?: string | null, now: Date = new Date()): number | null => {
  const due = calendarOrdinal(value)
  const today = calendarOrdinal(now)
  return due == null || today == null ? null : due - today
}

export const getTaskProgress = (task: any): number => {
  if (canonicalTaskStatus(task?.status) === 'Completed') return 100
  const subtasks = Array.isArray(task?.metadata_json?.subtasks) ? task.metadata_json.subtasks : []
  if (subtasks.length) {
    const completed = subtasks.filter((subtask: any) => Boolean(subtask?.completed)).length
    return Math.round((completed / subtasks.length) * 100)
  }
  const progress = Number(task?.progress)
  if (!Number.isFinite(progress)) {
    if (task?.status === 'Review') return 90
    if (task?.status === 'In Progress') return 50
    return 0
  }
  return Math.max(0, Math.min(99, Math.round(progress)))
}

export const getProjectExecutionProgress = (project: any): number => {
  const tasks = Array.isArray(project?.tasks) ? project.tasks : []
  if (!tasks.length) return canonicalTaskStatus(project?.status) === 'Completed' ? 100 : 0
  return Math.round(tasks.reduce((sum: number, task: any) => sum + getTaskProgress(task), 0) / tasks.length)
}

export const getTaskOwnerLabel = (task: any): string => {
  const explicit = typeof task?.owner === 'string' ? task.owner.trim() : ''
  if (explicit) return explicit
  const owners = Array.isArray(task?.owners) ? task.owners.map((item: any) => String(item).trim()).filter(Boolean) : []
  return owners.length ? owners.join(', ') : 'Unassigned'
}

export const isOpenProject = (project: any) => !['Completed', 'Cancelled'].includes(project?.status)

const openTasksFor = (project: any) => (Array.isArray(project?.tasks) ? project.tasks : []).filter((task: any) => canonicalTaskStatus(task?.status) !== 'Completed')

export const getCriticalTaskIds = (project: any): Set<number | string> => {
  const authoritative = project?.__pv1_analysis?.critical_task_ids
  if (Array.isArray(authoritative)) return new Set(authoritative.map((value: unknown) => String(value)))
  const tasks = Array.isArray(project?.tasks) ? project.tasks : []
  const taskById = new Map(tasks.map((task: any) => [String(task.id), task]))
  const scheduled = tasks
    .filter((task: any) => task?.end_date && calendarOrdinal(task.end_date) != null)
    .sort((a: any, b: any) => (calendarOrdinal(a.end_date) ?? 0) - (calendarOrdinal(b.end_date) ?? 0))
  if (!scheduled.length) return new Set()
  const critical = new Set<number | string>()
  const visit = (task: any, seen = new Set<string>()) => {
    const id = String(task?.id)
    if (!id || seen.has(id)) return
    seen.add(id); critical.add(task.id)
    const dependencies = Array.isArray(task?.dependencies_json) ? task.dependencies_json : []
    const predecessors = dependencies
      .map((dep: any) => taskById.get(String(dep?.id ?? dep?.task_id ?? dep)))
      .filter(Boolean)
      .sort((a: any, b: any) => (calendarOrdinal(b.end_date) ?? -Infinity) - (calendarOrdinal(a.end_date) ?? -Infinity))
    if (predecessors[0]) visit(predecessors[0], seen)
  }
  visit(scheduled[scheduled.length - 1])
  return critical
}

export interface ProjectMilestoneSummary {
  id: number | string
  name: string
  status: string
  owner: string
  dueAt: string | null
  daysToDue: number | null
  progress: number
  blocked: boolean
  overdue: boolean
}

export const getProjectMilestones = (project: any, now: Date = new Date()): ProjectMilestoneSummary[] => {
  const tasks = Array.isArray(project?.tasks) ? project.tasks : []
  const explicit = tasks.filter((task: any) => (
    task?.type === 'Milestone' || task?.metadata_json?.milestone === true || task?.metadata_json?.is_milestone === true
  ))
  const source = explicit.length ? explicit : tasks.filter((task: any) => task?.end_date)
  return source
    .filter((task: any) => calendarOrdinal(task?.end_date) != null)
    .sort((a: any, b: any) => (calendarOrdinal(a.end_date) ?? 0) - (calendarOrdinal(b.end_date) ?? 0))
    .map((task: any) => {
      const daysToDue = getDaysToDue(task.end_date, now)
      return {
        id: task.id,
        name: task.name || 'Unnamed checkpoint',
        status: task.status || 'To Do',
        owner: getTaskOwnerLabel(task),
        dueAt: task.end_date || null,
        daysToDue,
        progress: getTaskProgress(task),
        blocked: task.status === 'Blocked',
        overdue: canonicalTaskStatus(task.status) !== 'Completed' && daysToDue != null && daysToDue < 0,
      }
    })
}

export const getScheduleVarianceDays = (project: any): number | null => {
  const current = project?.end_date || project?.target_date || project?.metadata_json?.forecast_end_date
  const baseline = project?.metadata_json?.baseline_end_date || project?.baseline_end_date
  const currentOrdinal = calendarOrdinal(current)
  const baselineOrdinal = calendarOrdinal(baseline)
  if (currentOrdinal == null || baselineOrdinal == null) return null
  return currentOrdinal - baselineOrdinal
}

export interface ProjectHealthSummary {
  level: ProjectHealth
  score: number
  reasons: string[]
  blocked: number
  overdue: number
  dueSoon: number
  unassigned: number
  review: number
  critical: number
  blockedCritical: number
  milestoneRisk: number
  scheduleVarianceDays: number | null
  unscheduled: number
}

export const getProjectHealth = (project: any, now: Date = new Date()): ProjectHealthSummary => {
  const openTasks = openTasksFor(project)
  const criticalIds = getCriticalTaskIds(project)
  const blocked = openTasks.filter((task: any) => task?.status === 'Blocked').length
  const overdue = openTasks.filter((task: any) => (getDaysToDue(task?.end_date, now) ?? 0) < 0).length
  const dueSoon = openTasks.filter((task: any) => { const d = getDaysToDue(task?.end_date, now); return d != null && d >= 0 && d <= 3 }).length
  const unassigned = openTasks.filter((task: any) => getTaskOwnerLabel(task) === 'Unassigned').length
  const review = openTasks.filter((task: any) => task?.status === 'Review').length
  const critical = openTasks.filter((task: any) => criticalIds.has(task.id)).length
  const blockedCritical = openTasks.filter((task: any) => criticalIds.has(task.id) && task?.status === 'Blocked').length
  const milestones = getProjectMilestones(project, now)
  const milestoneRisk = milestones.filter((item) => item.blocked || item.overdue).length
  const scheduleVarianceDays = getScheduleVarianceDays(project)
  const unscheduled = openTasks.filter((task: any) => calendarOrdinal(task?.start_date) == null || calendarOrdinal(task?.end_date) == null).length
  const reasons: string[] = []
  let score = 0
  if (blockedCritical) { score += 5; reasons.push(`${blockedCritical} blocked critical task${blockedCritical === 1 ? '' : 's'}`) }
  if (blocked) { score += Math.min(4, blocked * 2); reasons.push(`${blocked} blocked open task${blocked === 1 ? '' : 's'}`) }
  if (overdue) { score += Math.min(4, overdue * 2); reasons.push(`${overdue} overdue task${overdue === 1 ? '' : 's'}`) }
  if (milestoneRisk) { score += 3; reasons.push(`${milestoneRisk} milestone/checkpoint${milestoneRisk === 1 ? '' : 's'} at risk`) }
  if (scheduleVarianceDays != null && scheduleVarianceDays > 0) { score += scheduleVarianceDays >= 7 ? 4 : 2; reasons.push(`${scheduleVarianceDays}d schedule variance`) }
  if (unscheduled) { score += 3; reasons.push(`${unscheduled} open task${unscheduled === 1 ? '' : 's'} missing schedule dates`) }
  if (unassigned) { score += Math.min(2, unassigned); reasons.push(`${unassigned} unassigned open task${unassigned === 1 ? '' : 's'}`) }
  if (review >= 4) { score += 2; reasons.push(`${review} tasks waiting in review`) }
  const hasExecutionEvidence = (Array.isArray(project?.tasks) && project.tasks.length > 0) || milestones.length > 0 || scheduleVarianceDays != null
  if (!hasExecutionEvidence) reasons.push('No execution plan recorded')
  else if (!reasons.length) reasons.push('No deterministic execution risk detected')
  return {
    level: !hasExecutionEvidence ? 'unknown' : score >= 7 ? 'red' : score >= 3 ? 'amber' : 'green',
    score,
    reasons,
    blocked,
    overdue,
    dueSoon,
    unassigned,
    review,
    critical,
    blockedCritical,
    milestoneRisk,
    scheduleVarianceDays,
    unscheduled,
  }
}

export interface ProjectAttentionItem {
  id: string
  projectId: number
  projectName: string
  taskId: number | string
  taskName: string
  owner: string
  dueAt: string | null
  daysToDue: number | null
  kind: ProjectAttentionKind
  tone: ProjectAttentionTone
  label: string
  reasons: ProjectAttentionKind[]
  reasonLabels: string[]
  priority: string
  severity: number
}

export const buildProjectAttentionItems = (projects: any[], now: Date = new Date()): ProjectAttentionItem[] => {
  const items: ProjectAttentionItem[] = []
  ;(projects || []).forEach((project: any) => {
    const projectId = Number(project?.id)
    if (!Number.isFinite(projectId)) return
    const projectName = project?.name || `Project ${projectId}`
    const critical = getCriticalTaskIds(project)
    ;(project?.tasks || []).forEach((task: any) => {
      if (canonicalTaskStatus(task?.status) === 'Completed') return
      const owner = getTaskOwnerLabel(task)
      const daysToDue = getDaysToDue(task?.end_date, now)
      const taskId = task?.id ?? task?.name ?? `${projectId}-${items.length}`
      const taskName = task?.name || 'Unnamed task'
      const reasons: ProjectAttentionKind[] = []
      const labels: string[] = []
      if (task?.status === 'Blocked') { reasons.push('blocked'); labels.push('Blocked execution') }
      if (daysToDue != null && daysToDue < 0) { reasons.push('overdue'); labels.push(`${Math.abs(daysToDue)}d overdue`) }
      else if (daysToDue != null && daysToDue <= 3) { reasons.push('due-soon'); labels.push(daysToDue === 0 ? 'Due today' : `Due in ${daysToDue}d`) }
      if (owner === 'Unassigned') { reasons.push('unassigned'); labels.push('No task owner') }
      if (normalizeTaskStatus(task?.status) === 'Unknown') { reasons.push('unknown-status'); labels.push('Unknown lifecycle status') }
      const highPriority = ['High', 'Highest'].includes(task?.priority) || ['High', 'Highest'].includes(project?.priority)
      if (!reasons.length && highPriority) { reasons.push('high-priority'); labels.push(`${task?.priority || project?.priority} priority`) }
      else if (highPriority) labels.push(`${task?.priority || project?.priority} priority`)
      if (!reasons.length) return
      const severity = (reasons.includes('blocked') ? 50 : 0)
        + (reasons.includes('overdue') ? 40 : 0)
        + (critical.has(task.id) ? 25 : 0)
        + (reasons.includes('unknown-status') ? 20 : 0)
        + (reasons.includes('unassigned') ? 12 : 0)
        + (reasons.includes('due-soon') ? 10 : 0)
        + (highPriority ? 8 : 0)
      const kind = reasons[0]
      const tone: ProjectAttentionTone = ['blocked', 'overdue', 'unknown-status'].includes(kind) ? 'rose' : kind === 'due-soon' ? 'amber' : kind === 'high-priority' ? 'blue' : 'slate'
      items.push({
        id: `${projectId}-${taskId}`,
        projectId,
        projectName,
        taskId,
        taskName,
        owner,
        dueAt: task?.end_date || null,
        daysToDue,
        kind,
        tone,
        label: labels[0],
        reasons,
        reasonLabels: labels,
        priority: task?.priority || project?.priority || 'Medium',
        severity,
      })
    })
  })
  return items.sort((a, b) => b.severity - a.severity || (a.daysToDue ?? 99999) - (b.daysToDue ?? 99999) || a.projectName.localeCompare(b.projectName))
}

export const diversifyAttentionItems = (items: ProjectAttentionItem[], limit = 12): ProjectAttentionItem[] => {
  if (items.length <= limit) return items
  const selected: ProjectAttentionItem[] = []
  const seenProjects = new Set<number>()
  items.forEach((item) => {
    if (selected.length < limit && !seenProjects.has(item.projectId)) {
      selected.push(item); seenProjects.add(item.projectId)
    }
  })
  items.forEach((item) => {
    if (selected.length < limit && !selected.includes(item)) selected.push(item)
  })
  return selected
}

export const buildPortfolioMetrics = (projects: any[], now: Date = new Date()) => {
  const list = Array.isArray(projects) ? projects : []
  const openProjects = list.filter(isOpenProject)
  const allTasks = list.flatMap((project: any) => (project?.tasks || []).map((task: any) => ({ task, project })))
  const openTasks = allTasks.filter(({ task }) => canonicalTaskStatus(task?.status) !== 'Completed')
  const blocked = openTasks.filter(({ task }) => task?.status === 'Blocked').length
  const overdue = openTasks.filter(({ task }) => { const d = getDaysToDue(task?.end_date, now); return d != null && d < 0 }).length
  const dueSoon = openTasks.filter(({ task }) => { const d = getDaysToDue(task?.end_date, now); return d != null && d >= 0 && d <= 3 }).length
  const owned = openTasks.filter(({ task }) => getTaskOwnerLabel(task) !== 'Unassigned').length
  const taskWeightedProgress = allTasks.length ? Math.round(allTasks.reduce((sum, row) => sum + getTaskProgress(row.task), 0) / allTasks.length) : 0
  const projectAverageProgress = list.length ? Math.round(list.reduce((sum, project) => sum + getProjectExecutionProgress(project), 0) / list.length) : 0
  const health = list.map((project) => getProjectHealth(project, now))
  return {
    projects: list.length,
    activeProjects: openProjects.length,
    tasks: allTasks.length,
    openTasks: openTasks.length,
    blocked,
    overdue,
    dueSoon,
    ownershipCoverage: openTasks.length ? Math.round((owned / openTasks.length) * 100) : 100,
    overallProgress: taskWeightedProgress,
    projectAverageProgress,
    healthRed: health.filter((item) => item.level === 'red').length,
    healthAmber: health.filter((item) => item.level === 'amber').length,
    healthUnknown: health.filter((item) => item.level === 'unknown').length,
    manHoursSaved: list.reduce((sum, project) => sum + (Number(project?.man_hours_saved) || 0), 0),
    stoplossMinutesSaved: list.reduce((sum, project) => sum + (Number(project?.stoploss_minutes_saved) || 0), 0),
    wafersGained: list.reduce((sum, project) => sum + (Number(project?.wafers_gained) || 0), 0),
  }
}

export const projectFingerprint = (project: any): string => {
  const payload = {
    id: project?.id,
    updated_at: project?.updated_at || project?.updatedAt || null,
    status: project?.status,
    priority: project?.priority,
    owner: project?.owner,
    start_date: project?.start_date,
    end_date: project?.end_date,
    target_date: project?.target_date,
    man_hours_saved: project?.man_hours_saved,
    stoploss_minutes_saved: project?.stoploss_minutes_saved,
    wafers_gained: project?.wafers_gained,
    metadata_json: project?.metadata_json || null,
    tasks: (project?.tasks || []).map((task: any) => ({ id: task?.id, status: task?.status, progress: task?.progress, owner: task?.owner, owners: task?.owners, start_date: task?.start_date, end_date: task?.end_date, name: task?.name, description: task?.description, priority: task?.priority, order_index: task?.order_index, dependencies_json: task?.dependencies_json, metadata_json: task?.metadata_json })),
  }
  return JSON.stringify(payload)
}

export const moveProjectTaskStatus = (project: any, taskId: number | string, status: ProjectTaskStatus) => {
  const current = (project?.tasks || []).find((task: any) => String(task?.id) === String(taskId))
  if (!current || current.status === status) return project
  return {
    ...project,
    tasks: (project?.tasks || []).map((task: any) => {
      if (String(task?.id) !== String(taskId)) return task
      const nextProgress = status === 'Completed' ? 100 : canonicalTaskStatus(task.status) === 'Completed' && Number(task.progress) >= 100 ? (status === 'Review' ? 90 : status === 'In Progress' ? 50 : 0) : task.progress
      return { ...task, status, progress: nextProgress }
    }),
  }
}

const taskKey = (value: any) => String(value?.id ?? value?.task_id ?? value ?? '')
const taskMetadata = (task: any) => (task?.metadata_json && typeof task.metadata_json === 'object' ? task.metadata_json : {})
export const getProjectTaskParentId = (task: any): number | string | null => taskMetadata(task).wbs_parent_id ?? task?.parent_task_id ?? null
export const isProjectTaskMilestone = (task: any): boolean => Boolean(task?.type === 'Milestone' || taskMetadata(task).is_milestone === true || taskMetadata(task).milestone === true || task?.is_milestone === true)

const normalizeTaskPatch = (task: any, patch: any) => {
  const next = { ...task, ...patch }
  if (patch?.metadata_json) next.metadata_json = { ...taskMetadata(task), ...patch.metadata_json }
  if (canonicalTaskStatus(next.status) === 'Completed') next.progress = 100
  else if (canonicalTaskStatus(task?.status) === 'Completed' && Number(task?.progress) >= 100 && patch?.status && canonicalTaskStatus(patch.status) !== 'Completed' && patch?.progress == null) {
    next.progress = patch.status === 'Review' ? 90 : patch.status === 'In Progress' ? 50 : 0
  } else if (patch?.progress != null) {
    const progress = Number(patch.progress)
    next.progress = Number.isFinite(progress) ? Math.max(0, Math.min(99, Math.round(progress))) : getTaskProgress(task)
  }
  return next
}

export const updateProjectTask = (project: any, taskId: number | string, patch: any) => ({
  ...project,
  tasks: (project?.tasks || []).map((task: any) => String(task?.id) === String(taskId) ? normalizeTaskPatch(task, patch) : task),
})

export const createProjectTask = (project: any, task: any) => {
  const tasks = Array.isArray(project?.tasks) ? project.tasks : []
  const maxOrder = tasks.reduce((max: number, row: any) => Math.max(max, Number(row?.order_index) || 0), 0)
  return {
    ...project,
    tasks: [...tasks, normalizeTaskPatch({}, { ...task, order_index: task?.order_index ?? maxOrder + 10, metadata_json: taskMetadata(task) })],
  }
}

export interface ProjectTaskWorkbenchRow {
  task: any
  id: number | string
  parentId: number | string | null
  depth: number
  hasChildren: boolean
}

export const buildProjectTaskHierarchy = (project: any): ProjectTaskWorkbenchRow[] => {
  const tasks = [...(Array.isArray(project?.tasks) ? project.tasks : [])]
    .sort((a: any, b: any) => (Number(a?.order_index) || 0) - (Number(b?.order_index) || 0) || String(a?.name || '').localeCompare(String(b?.name || '')))
  const byId = new Map(tasks.map((task: any) => [taskKey(task), task]))
  const children = new Map<string, any[]>()
  const roots: any[] = []
  for (const task of tasks) {
    const parentId = getProjectTaskParentId(task)
    const parentKey = taskKey(parentId)
    if (parentId != null && parentKey !== taskKey(task) && byId.has(parentKey)) {
      const bucket = children.get(parentKey) || []; bucket.push(task); children.set(parentKey, bucket)
    } else roots.push(task)
  }
  const rows: ProjectTaskWorkbenchRow[] = []; const visited = new Set<string>()
  const visit = (task: any, depth: number, lineage = new Set<string>()) => {
    const id = taskKey(task)
    if (!id || visited.has(id) || lineage.has(id)) return
    visited.add(id)
    const nextLineage = new Set(lineage); nextLineage.add(id)
    const childRows = children.get(id) || []
    rows.push({ task, id: task.id, parentId: getProjectTaskParentId(task), depth, hasChildren: childRows.length > 0 })
    childRows.forEach((child) => visit(child, depth + 1, nextLineage))
  }
  roots.forEach((task) => visit(task, 0))
  tasks.forEach((task) => { if (!visited.has(taskKey(task))) visit(task, 0) })
  return rows
}

export const getProjectTaskDescendantIds = (project: any, taskId: number | string): Set<string> => {
  const rows = buildProjectTaskHierarchy(project); const start = rows.findIndex((row) => String(row.id) === String(taskId)); const result = new Set<string>()
  if (start < 0) return result
  const depth = rows[start].depth
  for (let index = start + 1; index < rows.length && rows[index].depth > depth; index += 1) result.add(String(rows[index].id))
  return result
}

export const setProjectTaskParent = (project: any, taskId: number | string, parentId: number | string | null) => {
  const tasks = Array.isArray(project?.tasks) ? project.tasks : []
  const task = tasks.find((row: any) => String(row?.id) === String(taskId))
  if (!task) return project
  const normalizedParent = parentId == null || String(parentId) === '' ? null : parentId
  if (normalizedParent != null) {
    if (String(normalizedParent) === String(taskId)) return project
    if (!tasks.some((row: any) => String(row?.id) === String(normalizedParent))) return project
    if (getProjectTaskDescendantIds(project, taskId).has(String(normalizedParent))) return project
  }
  const metadata_json = { ...taskMetadata(task) }
  if (normalizedParent == null) delete metadata_json.wbs_parent_id
  else metadata_json.wbs_parent_id = normalizedParent
  return updateProjectTask(project, taskId, { metadata_json })
}

export const setProjectTaskMilestone = (project: any, taskId: number | string, isMilestone: boolean) => {
  const task = (project?.tasks || []).find((row: any) => String(row?.id) === String(taskId))
  if (!task) return project
  return updateProjectTask(project, taskId, { metadata_json: { ...taskMetadata(task), is_milestone: Boolean(isMilestone) } })
}

const calendarStringShift = (value: any, days: number) => {
  const ordinal = calendarOrdinal(value)
  if (ordinal == null || !Number.isFinite(days)) return value
  const date = new Date((ordinal + days) * DAY_MS)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

export const bulkUpdateProjectTasks = (project: any, taskIds: Array<number | string>, patch: any) => {
  const selected = new Set(taskIds.map(String)); if (!selected.size) return project
  return {
    ...project,
    tasks: (project?.tasks || []).map((task: any) => {
      if (!selected.has(String(task?.id))) return task
      const direct: any = {}
      for (const field of ['owner', 'status', 'priority', 'start_date', 'end_date', 'progress']) if (patch?.[field] !== undefined && patch[field] !== '') direct[field] = patch[field]
      let next = normalizeTaskPatch(task, direct)
      if (patch?.shiftDays) next = { ...next, start_date: calendarStringShift(next.start_date, Number(patch.shiftDays)), end_date: calendarStringShift(next.end_date, Number(patch.shiftDays)) }
      if (patch?.milestone !== undefined && patch.milestone !== '') next = { ...next, metadata_json: { ...taskMetadata(next), is_milestone: Boolean(patch.milestone) } }
      return next
    }),
  }
}

export const reorderProjectTaskBefore = (project: any, taskId: number | string, targetTaskId: number | string) => {
  if (String(taskId) === String(targetTaskId)) return project
  const rows = buildProjectTaskHierarchy(project); const movedIds = new Set([String(taskId), ...getProjectTaskDescendantIds(project, taskId)])
  const block = rows.filter((row) => movedIds.has(String(row.id))).map((row) => row.task)
  const rest = rows.filter((row) => !movedIds.has(String(row.id))).map((row) => row.task)
  const targetIndex = rest.findIndex((task: any) => String(task?.id) === String(targetTaskId)); if (targetIndex < 0) return project
  const ordered = [...rest.slice(0, targetIndex), ...block, ...rest.slice(targetIndex)]
  const order = new Map(ordered.map((task: any, index: number) => [String(task.id), (index + 1) * 10]))
  return { ...project, tasks: (project?.tasks || []).map((task: any) => ({ ...task, order_index: order.get(String(task.id)) ?? task.order_index })) }
}

export const indentProjectTask = (project: any, taskId: number | string) => {
  const rows = buildProjectTaskHierarchy(project); const index = rows.findIndex((row) => String(row.id) === String(taskId)); if (index <= 0) return project
  const candidate = rows[index - 1]; if (!candidate) return project
  return setProjectTaskParent(project, taskId, candidate.id)
}

export const outdentProjectTask = (project: any, taskId: number | string) => {
  const task = (project?.tasks || []).find((row: any) => String(row?.id) === String(taskId)); const parentId = getProjectTaskParentId(task)
  if (!task || parentId == null) return project
  const parent = (project?.tasks || []).find((row: any) => String(row?.id) === String(parentId))
  return setProjectTaskParent(project, taskId, parent ? getProjectTaskParentId(parent) : null)
}

export const duplicateProjectTask = (project: any, taskId: number | string, newId: number | string) => {
  const rows = buildProjectTaskHierarchy(project); const index = rows.findIndex((row) => String(row.id) === String(taskId)); if (index < 0) return project
  const source = rows[index].task; const clone = { ...source, id: newId, name: `${source.name || 'Untitled task'} copy`, order_index: (Number(source.order_index) || (index + 1) * 10) + 1, metadata_json: { ...taskMetadata(source), comments: [] } }
  return createProjectTask(project, clone)
}

export const deleteProjectTasks = (project: any, taskIds: Array<number | string>) => {
  const deleted = new Set(taskIds.map(String)); if (!deleted.size) return project
  const parentByDeleted = new Map<string, any>(); for (const task of project?.tasks || []) if (deleted.has(String(task.id))) parentByDeleted.set(String(task.id), getProjectTaskParentId(task))
  const resolveParent = (parentId: any): any => { let current = parentId; const seen = new Set<string>(); while (current != null && deleted.has(String(current)) && !seen.has(String(current))) { seen.add(String(current)); current = parentByDeleted.get(String(current)) ?? null } return current }
  const tasks = (project?.tasks || []).filter((task: any) => !deleted.has(String(task.id))).map((task: any) => {
    const parentId = resolveParent(getProjectTaskParentId(task)); let next = task
    if (String(parentId ?? '') !== String(getProjectTaskParentId(task) ?? '')) next = normalizeTaskPatch(task, { metadata_json: { ...taskMetadata(task), wbs_parent_id: parentId } })
    if (parentId == null && next.metadata_json?.wbs_parent_id == null) { const metadata_json = { ...taskMetadata(next) }; delete metadata_json.wbs_parent_id; next = { ...next, metadata_json } }
    const deps = (Array.isArray(next.dependencies_json) ? next.dependencies_json : []).filter((dep: any) => !deleted.has(taskKey(dep)))
    return deps.length === (next.dependencies_json || []).length ? next : { ...next, dependencies_json: deps }
  })
  return { ...project, tasks }
}

export interface ParsedProjectTaskRow { name: string; owner?: string; status?: string; priority?: string; start_date?: string; end_date?: string; progress?: number }
export const parseProjectTaskPaste = (text: string): ParsedProjectTaskRow[] => {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim())
  if (!lines.length) return []
  const cells = lines.map((line) => line.split('\t').map((cell) => cell.trim()))
  const normalized = cells[0].map((cell) => cell.toLowerCase().replace(/[^a-z]/g, ''))
  const headerMap: Record<string, keyof ParsedProjectTaskRow> = { task: 'name', name: 'name', owner: 'owner', assignee: 'owner', status: 'status', priority: 'priority', start: 'start_date', startdate: 'start_date', finish: 'end_date', finishdate: 'end_date', end: 'end_date', enddate: 'end_date', duedate: 'end_date', progress: 'progress' }
  const hasHeader = normalized.some((cell) => headerMap[cell]) && normalized.some((cell) => ['task','name'].includes(cell))
  const columns = hasHeader ? normalized.map((cell) => headerMap[cell] || null) : ['name','owner','status','priority','start_date','end_date','progress'] as Array<keyof ParsedProjectTaskRow | null>
  return cells.slice(hasHeader ? 1 : 0).map((row) => {
    const parsed: any = {}
    row.forEach((value, index) => { const field = columns[index]; if (!field || !value) return; parsed[field] = field === 'progress' ? Number(value.replace('%','')) : value })
    if (!parsed.name) parsed.name = row[0] || ''
    if (!PROJECT_TASK_STATUSES.includes(parsed.status as any)) delete parsed.status
    if (parsed.progress != null && !Number.isFinite(parsed.progress)) delete parsed.progress
    return parsed as ParsedProjectTaskRow
  }).filter((row) => row.name.trim())
}


export const getProjectTaskDependencyIds = (task: any): string[] => (Array.isArray(task?.dependencies_json) ? task.dependencies_json : []).map(taskKey).filter(Boolean)

export const wouldCreateProjectTaskDependencyCycle = (project: any, taskId: number | string, predecessorId: number | string): boolean => {
  const target = String(taskId); const predecessor = String(predecessorId)
  if (!target || !predecessor || target == predecessor) return true
  const tasks = Array.isArray(project?.tasks) ? project.tasks : []
  const byId = new Map(tasks.map((task: any) => [String(task?.id), task]))
  if (!byId.has(target) || !byId.has(predecessor)) return true
  const stack = [predecessor]; const seen = new Set<string>()
  while (stack.length) {
    const current = stack.pop() as string
    if (current === target) return true
    if (seen.has(current)) continue
    seen.add(current)
    const task = byId.get(current)
    for (const dependencyId of getProjectTaskDependencyIds(task)) if (!seen.has(dependencyId)) stack.push(dependencyId)
  }
  return false
}

export const setProjectTaskDependency = (project: any, taskId: number | string, predecessorId: number | string, enabled = true) => {
  const task = (project?.tasks || []).find((row: any) => String(row?.id) === String(taskId))
  const predecessor = (project?.tasks || []).find((row: any) => String(row?.id) === String(predecessorId))
  if (!task || !predecessor || String(taskId) === String(predecessorId)) return project
  const current = getProjectTaskDependencyIds(task)
  if (enabled) {
    if (current.includes(String(predecessorId)) || wouldCreateProjectTaskDependencyCycle(project, taskId, predecessorId)) return project
    return updateProjectTask(project, taskId, { dependencies_json: [...current, predecessorId] })
  }
  if (!current.includes(String(predecessorId))) return project
  return updateProjectTask(project, taskId, { dependencies_json: current.filter((id) => id !== String(predecessorId)) })
}

export const moveProjectTaskSchedule = (project: any, taskId: number | string, deltaDays: number) => {
  const task = (project?.tasks || []).find((row: any) => String(row?.id) === String(taskId)); const delta = Math.round(Number(deltaDays) || 0)
  if (!task || !delta) return project
  const start = calendarOrdinal(task?.start_date); const end = calendarOrdinal(task?.end_date)
  if (start == null && end == null) return project
  return updateProjectTask(project, taskId, { start_date: calendarStringShift(task?.start_date || task?.end_date, delta), end_date: calendarStringShift(task?.end_date || task?.start_date, delta) })
}

export const shiftProjectTaskSchedules = (project: any, taskIds: Array<number | string>, deltaDays: number) => {
  const selected = new Set(taskIds.map(String)); const delta = Math.round(Number(deltaDays) || 0)
  if (!selected.size || !delta) return project
  return { ...project, tasks: (project?.tasks || []).map((task: any) => {
    if (!selected.has(String(task?.id))) return task
    const start = calendarOrdinal(task?.start_date); const end = calendarOrdinal(task?.end_date)
    if (start == null && end == null) return task
    return { ...task, start_date: calendarStringShift(task?.start_date || task?.end_date, delta), end_date: calendarStringShift(task?.end_date || task?.start_date, delta) }
  }) }
}

export const resizeProjectTaskSchedule = (project: any, taskId: number | string, edge: 'start' | 'end', deltaDays: number) => {
  const task = (project?.tasks || []).find((row: any) => String(row?.id) === String(taskId)); const delta = Math.round(Number(deltaDays) || 0)
  if (!task || !delta) return project
  const start = calendarOrdinal(task?.start_date); const end = calendarOrdinal(task?.end_date)
  if (start == null || end == null) return project
  if (edge === 'start') {
    const nextStart = Math.min(end, start + delta)
    return updateProjectTask(project, taskId, { start_date: ordinalToDate(nextStart) })
  }
  const nextEnd = Math.max(start, end + delta)
  return updateProjectTask(project, taskId, { end_date: ordinalToDate(nextEnd) })
}

export const scheduleProjectTask = (project: any, taskId: number | string, startDate: string, durationDays = 1) => {
  const start = calendarOrdinal(startDate); if (start == null) return project
  const duration = Math.max(1, Math.round(Number(durationDays) || 1))
  return updateProjectTask(project, taskId, { start_date: ordinalToDate(start), end_date: ordinalToDate(start + duration - 1) })
}

export const captureProjectScheduleBaseline = (project: any, now: Date = new Date()) => ({
  ...project,
  metadata_json: { ...(project?.metadata_json || {}), schedule_baseline_captured_at: now.toISOString() },
  tasks: (project?.tasks || []).map((task: any) => ({ ...task, metadata_json: { ...taskMetadata(task), baseline_start_date: task?.start_date || null, baseline_end_date: task?.end_date || null } })),
})

export interface ProjectTimelineRow extends ProjectTaskWorkbenchRow {
  startOrdinal: number | null
  endOrdinal: number | null
  baselineStartOrdinal: number | null
  baselineEndOrdinal: number | null
  forecastStartOrdinal: number | null
  forecastEndOrdinal: number | null
  dependencyIds: string[]
  critical: boolean
  milestone: boolean
  blocked: boolean
  progress: number
}

export const buildProjectTimelineRows = (project: any, now: Date = new Date()): ProjectTimelineRow[] => {
  const hierarchy = buildProjectTaskHierarchy(project); const critical = getCriticalTaskIds(project); const forecast = getProjectForecast(project, now)
  const forecastById = new Map(forecast.tasks.map((row: any) => [String(row.id), row]))
  return hierarchy.map((row) => {
    const task = row.task; const metadata = taskMetadata(task); const projected: any = forecastById.get(String(row.id))
    return { ...row,
      startOrdinal: calendarOrdinal(task?.start_date), endOrdinal: calendarOrdinal(task?.end_date),
      baselineStartOrdinal: calendarOrdinal(metadata.baseline_start_date), baselineEndOrdinal: calendarOrdinal(metadata.baseline_end_date),
      forecastStartOrdinal: calendarOrdinal(task?.forecast_start_date) ?? projected?.forecastStartOrdinal ?? null, forecastEndOrdinal: calendarOrdinal(task?.forecast_end_date) ?? projected?.forecastEndOrdinal ?? null,
      dependencyIds: getProjectTaskDependencyIds(task), critical: critical.has(task.id), milestone: isProjectTaskMilestone(task), blocked: task?.status === 'Blocked', progress: getTaskProgress(task),
    }
  })
}

export const getProjectTimelineRange = (project: any, now: Date = new Date()) => {
  const rows = buildProjectTimelineRows(project, now); const today = calendarOrdinal(now) ?? 0
  const points = rows.flatMap((row) => [row.startOrdinal, row.endOrdinal, row.baselineStartOrdinal, row.baselineEndOrdinal, row.forecastStartOrdinal, row.forecastEndOrdinal]).filter((value): value is number => value != null)
  const projectStart = calendarOrdinal(project?.start_date); const projectEnd = calendarOrdinal(project?.end_date || project?.target_date)
  if (projectStart != null) points.push(projectStart); if (projectEnd != null) points.push(projectEnd); points.push(today)
  const min = points.length ? Math.min(...points) : today - 14; const max = points.length ? Math.max(...points) : today + 30
  const padding = 7
  return { startOrdinal: min - padding, endOrdinal: max + padding, spanDays: Math.max(1, max - min + 1 + padding * 2), todayOrdinal: today }
}

export const projectOrdinalToDate = (ordinal: number | null | undefined) => ordinalToDate(ordinal ?? null)

export const getProjectWipLimits = (project: any): Partial<Record<ProjectTaskStatus, number>> => {
  const raw = project?.metadata_json?.[PROJECT_EXECUTION_CONFIG_KEY]?.wip_limits || {}
  const defaults: Partial<Record<ProjectTaskStatus, number>> = { 'In Progress': 5, Blocked: 3, Review: 4 }
  return { ...defaults, ...Object.fromEntries(Object.entries(raw).filter(([, value]) => Number(value) >= 0).map(([key, value]) => [key, Math.round(Number(value))])) }
}

export const setProjectWipLimit = (project: any, status: ProjectTaskStatus, limit: number) => {
  const metadata = project?.metadata_json || {}; const config = metadata[PROJECT_EXECUTION_CONFIG_KEY] || {}; const current = getProjectWipLimits(project)
  return { ...project, metadata_json: { ...metadata, [PROJECT_EXECUTION_CONFIG_KEY]: { ...config, wip_limits: { ...current, [status]: Math.max(0, Math.round(Number(limit) || 0)) } } } }
}

const taskActivityOrdinal = (project: any, task: any) => {
  const value = task?.updated_at || task?.updatedAt || taskMetadata(task).last_updated_at || taskMetadata(task).updated_at || project?.updated_at || project?.updatedAt
  return value ? calendarOrdinal(String(value).slice(0, 10)) : null
}

export const getProjectNeedsUpdate = (projects: any[], owner = '', now: Date = new Date()) => {
  const normalizedOwner = owner.trim().toLowerCase(); const today = calendarOrdinal(now) ?? 0
  return (projects || []).flatMap((project: any) => (project?.tasks || []).filter((task: any) => canonicalTaskStatus(task?.status) !== 'Completed').map((task: any) => {
    const ownerLabel = getTaskOwnerLabel(task); if (normalizedOwner && !ownerLabel.toLowerCase().includes(normalizedOwner)) return null
    const due = getDaysToDue(task?.end_date, now); const activityOrdinal = taskActivityOrdinal(project, task); const staleDays = activityOrdinal == null ? null : Math.max(0, today - activityOrdinal)
    const reasons: string[] = []
    if (task?.status === 'Blocked') reasons.push('Blocked')
    if (due != null && due < 0) reasons.push(`Overdue ${Math.abs(due)}d`)
    else if (due != null && due === 0) reasons.push('Due today')
    else if (due != null && due <= 2) reasons.push(`Due in ${due}d`)
    if (['In Progress','Review','Blocked'].includes(task?.status) && staleDays != null && staleDays >= 3) reasons.push(`No activity ${staleDays}d`)
    if (!reasons.length) return null
    const urgency = task?.status === 'Blocked' || (due != null && due < 0) ? 0 : due === 0 ? 1 : staleDays != null && staleDays >= 5 ? 2 : 3
    return { projectId: project.id, projectName: project.name, task, owner: ownerLabel, daysToDue: due, staleDays, reasons, urgency }
  }).filter(Boolean)).sort((a: any, b: any) => a.urgency - b.urgency || (a.daysToDue ?? 9999) - (b.daysToDue ?? 9999) || (b.staleDays ?? 0) - (a.staleDays ?? 0))
}

export const filterProjectsForGoldenView = (
  projects: any[],
  search: string,
  statusFilter: string,
  priorityFilter: string,
  sortMode: ProjectSortMode = 'order',
  watchedIds: Array<number | string> = [],
  watchedOnly = false,
  now: Date = new Date(),
) => {
  const query = search.trim().toLowerCase()
  const status = normalizeProjectFilterValue(statusFilter)
  const priority = normalizeProjectFilterValue(priorityFilter)
  const watched = new Set(watchedIds.map(String))
  const rows = [...(projects || [])].filter((project: any) => {
    const searchable = [project?.name, project?.objective, project?.problem_statement, project?.owner, ...(project?.owners || [])]
      .filter(Boolean).join(' ').toLowerCase()
    return (!query || searchable.includes(query))
      && (status === 'ALL' || project?.status === status)
      && (priority === 'ALL' || project?.priority === priority)
      && (!watchedOnly || watched.has(String(project?.id)))
  })
  const deadline = (project: any) => {
    const dates = openTasksFor(project).map((task: any) => calendarOrdinal(task?.end_date)).filter((value: any) => value != null)
    return dates.length ? Math.min(...dates) : Number.MAX_SAFE_INTEGER
  }
  return rows.sort((a, b) => {
    if (sortMode === 'name') return String(a?.name || '').localeCompare(String(b?.name || ''))
    if (sortMode === 'health') return HEALTH_RANK[getProjectHealth(b, now).level] - HEALTH_RANK[getProjectHealth(a, now).level]
    if (sortMode === 'priority') return (PROJECT_PRIORITY_RANK[b?.priority] || 0) - (PROJECT_PRIORITY_RANK[a?.priority] || 0)
    if (sortMode === 'deadline') return deadline(a) - deadline(b)
    if (sortMode === 'progress') return getProjectExecutionProgress(a) - getProjectExecutionProgress(b)
    if (sortMode === 'blocked') return getProjectHealth(b, now).blocked - getProjectHealth(a, now).blocked
    if (sortMode === 'value') return (Number(b?.man_hours_saved) || 0) - (Number(a?.man_hours_saved) || 0)
    return (a?.order_index || 0) - (b?.order_index || 0)
  })
}

export const buildOwnerWorkload = (projects: any[], now: Date = new Date()) => {
  const map = new Map<string, any>()
  ;(projects || []).forEach((project: any) => {
    const critical = getCriticalTaskIds(project)
    ;(project?.tasks || []).forEach((task: any) => {
      if (canonicalTaskStatus(task?.status) === 'Completed') return
      const owner = getTaskOwnerLabel(task)
      const row = map.get(owner) || { owner, tasks: 0, projects: new Set<number>(), overdue: 0, blocked: 0, review: 0, dueSoon: 0, critical: 0 }
      row.tasks += 1; row.projects.add(project.id)
      const days = getDaysToDue(task?.end_date, now)
      if (days != null && days < 0) row.overdue += 1
      if (days != null && days >= 0 && days <= 3) row.dueSoon += 1
      if (task?.status === 'Blocked') row.blocked += 1
      if (task?.status === 'Review') row.review += 1
      if (critical.has(task.id)) row.critical += 1
      map.set(owner, row)
    })
  })
  return Array.from(map.values()).map((row) => ({ ...row, projects: row.projects.size })).sort((a, b) => (b.blocked + b.overdue + b.critical) - (a.blocked + a.overdue + a.critical) || b.tasks - a.tasks)
}

export const buildRoadmapRows = (projects: any[], now: Date = new Date()) => (projects || []).map((project: any) => {
  const taskDates = (project?.tasks || []).flatMap((task: any) => [task?.start_date, task?.end_date]).filter((value: any) => calendarOrdinal(value) != null)
  const ordinals = taskDates.map((value: any) => calendarOrdinal(value) as number)
  const milestones = getProjectMilestones(project, now)
  const forecast = getProjectForecast(project, now)
  return {
    projectId: project.id,
    projectName: project.name,
    health: getProjectHealth(project, now),
    progress: getProjectExecutionProgress(project),
    startOrdinal: calendarOrdinal(project?.start_date) ?? (ordinals.length ? Math.min(...ordinals) : null),
    endOrdinal: calendarOrdinal(project?.end_date) ?? (ordinals.length ? Math.max(...ordinals) : null),
    forecastEndOrdinal: forecast.forecastFinishOrdinal,
    forecastVarianceDays: forecast.varianceVsPlanDays,
    milestones,
  }
})

export const buildCrossProjectDependencies = (projects: any[]) => {
  const taskIndex = new Map<string, { projectId: number; projectName: string; task: any }>()
  ;(projects || []).forEach((project: any) => (project?.tasks || []).forEach((task: any) => taskIndex.set(String(task?.id), { projectId: Number(project.id), projectName: project.name, task })))
  const rows: any[] = []
  ;(projects || []).forEach((project: any) => (project?.tasks || []).forEach((task: any) => {
    ;(Array.isArray(task?.dependencies_json) ? task.dependencies_json : []).forEach((dependency: any) => {
      const source = taskIndex.get(String(dependency?.id ?? dependency?.task_id ?? dependency))
      if (source && source.projectId !== Number(project.id)) rows.push({
        fromProjectId: source.projectId,
        fromProjectName: source.projectName,
        fromTaskId: source.task.id,
        fromTaskName: source.task.name,
        toProjectId: Number(project.id),
        toProjectName: project.name,
        toTaskId: task.id,
        toTaskName: task.name,
      })
    })
  }))
  return rows
}


const ordinalToDate = (ordinal: number | null): string | null => ordinal == null ? null : new Date(ordinal * DAY_MS).toISOString().slice(0, 10)
const numericOrNull = (value: any): number | null => {
  if (value === '' || value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export const getProjectGovernance = (project: any): ProjectGovernanceState => {
  const raw = project?.metadata_json?.[PROJECT_GOVERNANCE_KEY] || {}
  const targets = raw?.benefitTargets || {}
  return {
    raid: Array.isArray(raw?.raid) ? raw.raid : [],
    decisions: Array.isArray(raw?.decisions) ? raw.decisions : [],
    stageGates: Array.isArray(raw?.stageGates) ? raw.stageGates : [],
    reviewSnapshots: Array.isArray(raw?.reviewSnapshots) ? raw.reviewSnapshots : [],
    benefitTargets: {
      manHoursSaved: numericOrNull(targets?.manHoursSaved),
      stoplossMinutesSaved: numericOrNull(targets?.stoplossMinutesSaved),
      wafersGained: numericOrNull(targets?.wafersGained),
    },
    audit: Array.isArray(raw?.audit) ? raw.audit : [],
  }
}

const withGovernanceState = (project: any, governance: ProjectGovernanceState) => ({
  ...project,
  metadata_json: { ...(project?.metadata_json || {}), [PROJECT_GOVERNANCE_KEY]: governance },
})

const auditGovernance = (governance: ProjectGovernanceState, action: string, detail: string, at: string) => ({
  ...governance,
  audit: [{ id: `${at}-${action}`, at, action, detail }, ...governance.audit].slice(0, 80),
})

export const appendProjectAudit = (project: any, action: string, detail: string, now: Date = new Date()) => {
  const at = now.toISOString()
  return withGovernanceState(project, auditGovernance(getProjectGovernance(project), action, detail, at))
}

export const upsertRaidItem = (project: any, item: any, now: Date = new Date()) => {
  const governance = getProjectGovernance(project); const at = now.toISOString(); const id = String(item?.id || `raid-${now.getTime()}`)
  const next = { ...item, id, type: item?.type || 'Risk', status: item?.status || 'Open', impact: item?.impact || 'Medium', updated_at: at, created_at: item?.created_at || at }
  const raid = governance.raid.some((row) => String(row.id) === id) ? governance.raid.map((row) => String(row.id) === id ? next : row) : [next, ...governance.raid]
  return withGovernanceState(project, auditGovernance({ ...governance, raid }, 'RAID updated', `${next.type}: ${next.title || 'Untitled'}`, at))
}

export const upsertDecisionRecord = (project: any, item: any, now: Date = new Date()) => {
  const governance = getProjectGovernance(project); const at = now.toISOString(); const id = String(item?.id || `decision-${now.getTime()}`)
  const next = { ...item, id, kind: item?.kind || 'Decision', status: item?.status || 'Proposed', updated_at: at, created_at: item?.created_at || at }
  const decisions = governance.decisions.some((row) => String(row.id) === id) ? governance.decisions.map((row) => String(row.id) === id ? next : row) : [next, ...governance.decisions]
  return withGovernanceState(project, auditGovernance({ ...governance, decisions }, `${next.kind} updated`, next.title || 'Untitled', at))
}

export const upsertStageGate = (project: any, item: any, now: Date = new Date()) => {
  const governance = getProjectGovernance(project); const at = now.toISOString(); const id = String(item?.id || `gate-${now.getTime()}`)
  const evidence = Array.isArray(item?.evidence) ? item.evidence.map((row: any, index: number) => ({ id: String(row?.id || `${id}-e${index + 1}`), label: row?.label || String(row || ''), complete: Boolean(row?.complete) })).filter((row: any) => row.label) : []
  const next = { ...item, id, status: item?.status || 'Not Ready', evidence, updated_at: at, created_at: item?.created_at || at }
  const stageGates = governance.stageGates.some((row) => String(row.id) === id) ? governance.stageGates.map((row) => String(row.id) === id ? next : row) : [next, ...governance.stageGates]
  return withGovernanceState(project, auditGovernance({ ...governance, stageGates }, 'Stage gate updated', next.name || 'Untitled gate', at))
}

export const toggleStageGateEvidence = (project: any, gateId: string, evidenceId: string, complete: boolean, now: Date = new Date()) => {
  const governance = getProjectGovernance(project); const at = now.toISOString()
  const stageGates = governance.stageGates.map((gate) => String(gate.id) !== String(gateId) ? gate : { ...gate, evidence: (gate.evidence || []).map((row: any) => String(row.id) === String(evidenceId) ? { ...row, complete } : row), updated_at: at })
  return withGovernanceState(project, auditGovernance({ ...governance, stageGates }, 'Gate evidence changed', `${gateId}:${evidenceId}=${complete ? 'complete' : 'open'}`, at))
}

export const setProjectBenefitTargets = (project: any, targets: any, now: Date = new Date()) => {
  const governance = getProjectGovernance(project); const at = now.toISOString()
  const benefitTargets = {
    manHoursSaved: numericOrNull(targets?.manHoursSaved),
    stoplossMinutesSaved: numericOrNull(targets?.stoplossMinutesSaved),
    wafersGained: numericOrNull(targets?.wafersGained),
  }
  return withGovernanceState(project, auditGovernance({ ...governance, benefitTargets }, 'Benefit targets updated', 'Target vs realized benefits refreshed', at))
}

export const getEvidenceReadiness = (project: any) => {
  const governance = getProjectGovernance(project); const gates = governance.stageGates
  const evidence = gates.flatMap((gate: any) => Array.isArray(gate?.evidence) ? gate.evidence : [])
  const completedEvidence = evidence.filter((row: any) => Boolean(row?.complete)).length
  const approvedGates = gates.filter((gate: any) => gate?.status === 'Approved').length
  const blockedGates = gates.filter((gate: any) => gate?.status === 'Blocked').length
  return {
    gates: gates.length,
    approvedGates,
    blockedGates,
    evidence: evidence.length,
    completedEvidence,
    evidencePercent: evidence.length ? Math.round((completedEvidence / evidence.length) * 100) : null,
  }
}

export const getBenefitRealization = (project: any) => {
  const targets = getProjectGovernance(project).benefitTargets
  const rows = [
    { key: 'manHoursSaved', label: 'Hours saved', target: targets.manHoursSaved, realized: Number(project?.man_hours_saved) || 0 },
    { key: 'stoplossMinutesSaved', label: 'Stoploss min', target: targets.stoplossMinutesSaved, realized: Number(project?.stoploss_minutes_saved) || 0 },
    { key: 'wafersGained', label: 'Wafers gained', target: targets.wafersGained, realized: Number(project?.wafers_gained) || 0 },
  ]
  return rows.map((row) => ({ ...row, percent: row.target != null && row.target > 0 ? Math.round((row.realized / row.target) * 100) : null, variance: row.target == null ? null : row.realized - row.target }))
}

export interface ProjectForecastTask {
  id: number | string
  name: string
  plannedEndOrdinal: number | null
  forecastStartOrdinal: number
  forecastEndOrdinal: number
  delayDays: number
  critical: boolean
}

export const getProjectForecast = (project: any, now: Date = new Date(), slipByTask: Record<string, number> = {}) => {
  const tasks = Array.isArray(project?.tasks) ? project.tasks : []
  const today = calendarOrdinal(now) ?? 0
  const taskById = new Map<string, any>(tasks.map((task: any): [string, any] => [String(task?.id), task]))
  const critical = getCriticalTaskIds(project)
  const authoritative = project?.__pv1_forecast
  if (Object.keys(slipByTask).length === 0 && authoritative && Array.isArray(authoritative.tasks)) {
    const taskForecasts: ProjectForecastTask[] = authoritative.tasks.map((row: any) => {
      const task = taskById.get(String(row?.task_id))
      const plannedEndOrdinal = calendarOrdinal(task?.end_date)
      const forecastStartOrdinal = calendarOrdinal(row?.start_date) ?? calendarOrdinal(row?.point_date) ?? today
      const forecastEndOrdinal = calendarOrdinal(row?.end_date) ?? calendarOrdinal(row?.point_date) ?? forecastStartOrdinal
      return {
        id: task?.id ?? String(row?.task_id),
        name: String(task?.name || row?.task_id || 'Unnamed task'),
        plannedEndOrdinal,
        forecastStartOrdinal,
        forecastEndOrdinal,
        delayDays: plannedEndOrdinal == null ? 0 : Math.max(0, forecastEndOrdinal - plannedEndOrdinal),
        critical: critical.has(String(row?.task_id)),
      }
    })
    const plannedEnds = taskForecasts.map((row) => row.plannedEndOrdinal).filter((value): value is number => value != null)
    const plannedFinishOrdinal = calendarOrdinal(project?.end_date || project?.target_date) ?? (plannedEnds.length ? Math.max(...plannedEnds) : null)
    const baselineFinishOrdinal = calendarOrdinal(project?.metadata_json?.baseline_end_date || project?.baseline_end_date)
    const forecastFinishOrdinal = authoritative.coverage?.complete === false
      ? null
      : calendarOrdinal(authoritative.finish) ?? (taskForecasts.length ? Math.max(...taskForecasts.map((row) => row.forecastEndOrdinal)) : null)
    return {
      plannedFinishOrdinal,
      baselineFinishOrdinal,
      forecastFinishOrdinal,
      plannedFinish: ordinalToDate(plannedFinishOrdinal),
      baselineFinish: ordinalToDate(baselineFinishOrdinal),
      forecastFinish: ordinalToDate(forecastFinishOrdinal),
      varianceVsPlanDays: plannedFinishOrdinal == null || forecastFinishOrdinal == null ? null : forecastFinishOrdinal - plannedFinishOrdinal,
      varianceVsBaselineDays: baselineFinishOrdinal == null || forecastFinishOrdinal == null ? null : forecastFinishOrdinal - baselineFinishOrdinal,
      tasks: taskForecasts,
      drivers: [],
      coverage: authoritative.coverage || null,
    }
  }
  const missingTaskIds = tasks.filter((task: any) => {
    const milestone = isProjectTaskMilestone(task)
    const pointDate = milestone ? calendarOrdinal(task?.point_date || task?.start_date || task?.end_date) : null
    if (canonicalTaskStatus(task?.status) === 'Completed') {
      return calendarOrdinal(task?.actual_end_date || task?.actual_finish || task?.end_date) == null && pointDate == null
    }
    if (milestone) return pointDate == null
    return calendarOrdinal(task?.start_date) == null || calendarOrdinal(task?.end_date) == null
  }).map((task: any) => String(task?.id))
  if (missingTaskIds.length) {
    const plannedEnds = tasks.map((task: any) => calendarOrdinal(task?.end_date || (isProjectTaskMilestone(task) ? task?.point_date : null))).filter((value: number | null): value is number => value != null)
    const plannedFinishOrdinal = calendarOrdinal(project?.end_date || project?.target_date) ?? (plannedEnds.length ? Math.max(...plannedEnds) : null)
    const baselineFinishOrdinal = calendarOrdinal(project?.metadata_json?.baseline_end_date || project?.baseline_end_date)
    return {
      plannedFinishOrdinal,
      baselineFinishOrdinal,
      forecastFinishOrdinal: null,
      plannedFinish: ordinalToDate(plannedFinishOrdinal),
      baselineFinish: ordinalToDate(baselineFinishOrdinal),
      forecastFinish: null,
      varianceVsPlanDays: null,
      varianceVsBaselineDays: null,
      tasks: [],
      drivers: [],
      coverage: { totalTasks: tasks.length, forecastableTasks: tasks.length - missingTaskIds.length, missingTaskIds, complete: false },
    }
  }
  const memo = new Map<string, ProjectForecastTask>()
  const visiting = new Set<string>()
  const calculate = (task: any): ProjectForecastTask => {
    const key = String(task?.id)
    const cached = memo.get(key); if (cached) return cached
    const milestoneDate = isProjectTaskMilestone(task) ? calendarOrdinal(task?.point_date || task?.start_date || task?.end_date) : null
    const plannedStart = milestoneDate ?? calendarOrdinal(task?.start_date)
    const plannedEnd = milestoneDate ?? calendarOrdinal(task?.end_date)
    const duration = plannedStart != null && plannedEnd != null ? Math.max(1, plannedEnd - plannedStart + 1) : 1
    const remainingRatio = canonicalTaskStatus(task?.status) === 'Completed' ? 0 : Math.max(0.05, (100 - getTaskProgress(task)) / 100)
    const remainingDays = canonicalTaskStatus(task?.status) === 'Completed' ? 0 : Math.max(1, Math.ceil(duration * remainingRatio))
    if (visiting.has(key)) {
      const fallbackEnd = plannedEnd ?? today
      const fallback = { id: task.id, name: task?.name || 'Unnamed task', plannedEndOrdinal: plannedEnd, forecastStartOrdinal: plannedStart ?? today, forecastEndOrdinal: fallbackEnd, delayDays: plannedEnd == null ? 0 : Math.max(0, fallbackEnd - plannedEnd), critical: critical.has(task.id) }
      memo.set(key, fallback); return fallback
    }
    visiting.add(key)
    const deps = (Array.isArray(task?.dependencies_json) ? task.dependencies_json : []).map((dep: any) => taskById.get(String(dep?.id ?? dep?.task_id ?? dep))).filter(Boolean) as any[]
    const dependencyEnd = deps.length ? Math.max(...deps.map((dep) => calculate(dep).forecastEndOrdinal)) : null
    let forecastStart = Math.max(today, plannedStart ?? today, dependencyEnd == null ? -Infinity : dependencyEnd + 1)
    const completedFinish = calendarOrdinal(task?.actual_end_date || task?.actual_finish || task?.end_date) ?? milestoneDate
    if (canonicalTaskStatus(task?.status) === 'Completed') forecastStart = plannedStart ?? completedFinish ?? today
    let forecastEnd = canonicalTaskStatus(task?.status) === 'Completed' ? (completedFinish ?? plannedEnd ?? forecastStart) : forecastStart + remainingDays - 1
    if (plannedEnd != null) forecastEnd = Math.max(plannedEnd, forecastEnd)
    forecastEnd += Math.max(0, Math.round(Number(slipByTask[key]) || 0))
    const row = { id: task.id, name: task?.name || 'Unnamed task', plannedEndOrdinal: plannedEnd, forecastStartOrdinal: forecastStart, forecastEndOrdinal: forecastEnd, delayDays: plannedEnd == null ? 0 : Math.max(0, forecastEnd - plannedEnd), critical: critical.has(task.id) }
    visiting.delete(key); memo.set(key, row); return row
  }
  const taskForecasts = tasks.map(calculate)
  const plannedEnds = taskForecasts.map((row) => row.plannedEndOrdinal).filter((value): value is number => value != null)
  const plannedFinishOrdinal = calendarOrdinal(project?.end_date || project?.target_date) ?? (plannedEnds.length ? Math.max(...plannedEnds) : null)
  const baselineFinishOrdinal = calendarOrdinal(project?.metadata_json?.baseline_end_date || project?.baseline_end_date)
  const forecastFinishOrdinal = taskForecasts.length ? Math.max(...taskForecasts.map((row) => row.forecastEndOrdinal)) : null
  const drivers = [...taskForecasts].filter((row) => row.delayDays > 0).sort((a, b) => (Number(b.critical) - Number(a.critical)) || b.delayDays - a.delayDays).slice(0, 5)
  return {
    plannedFinishOrdinal,
    baselineFinishOrdinal,
    forecastFinishOrdinal,
    plannedFinish: ordinalToDate(plannedFinishOrdinal),
    baselineFinish: ordinalToDate(baselineFinishOrdinal),
    forecastFinish: ordinalToDate(forecastFinishOrdinal),
    varianceVsPlanDays: plannedFinishOrdinal == null || forecastFinishOrdinal == null ? null : forecastFinishOrdinal - plannedFinishOrdinal,
    varianceVsBaselineDays: baselineFinishOrdinal == null || forecastFinishOrdinal == null ? null : forecastFinishOrdinal - baselineFinishOrdinal,
    tasks: taskForecasts,
    drivers,
    coverage: { totalTasks: tasks.length, forecastableTasks: tasks.length, missingTaskIds: [], complete: tasks.length > 0 },
  }
}

export const simulateProjectScenario = (project: any, taskId: number | string, slipDays: number, now: Date = new Date()) => {
  const base = getProjectForecast(project, now)
  if (base.forecastFinishOrdinal == null) return { baseForecastFinish: null, scenarioForecastFinish: null, finishDeltaDays: null, affected: [] as ProjectForecastTask[] }
  const scenario = getProjectForecast(project, now, { [String(taskId)]: Math.max(0, Math.round(Number(slipDays) || 0)) })
  const baseById = new Map<string, ProjectForecastTask>(base.tasks.map((row: ProjectForecastTask) => [String(row.id), row]))
  const affected = scenario.tasks.filter((row) => row.forecastEndOrdinal > (baseById.get(String(row.id))?.forecastEndOrdinal ?? row.forecastEndOrdinal)).map((row) => ({ ...row, additionalDelayDays: row.forecastEndOrdinal - (baseById.get(String(row.id))?.forecastEndOrdinal ?? row.forecastEndOrdinal) }))
  return {
    baseForecastFinish: base.forecastFinish,
    scenarioForecastFinish: scenario.forecastFinish,
    finishDeltaDays: base.forecastFinishOrdinal == null || scenario.forecastFinishOrdinal == null ? null : scenario.forecastFinishOrdinal - base.forecastFinishOrdinal,
    affected,
  }
}

const compactSnapshotTask = (task: any) => ({ id: task?.id, name: task?.name || 'Unnamed task', status: task?.status || '', owner: getTaskOwnerLabel(task), end_date: task?.end_date || null, priority: task?.priority || 'Medium', progress: getTaskProgress(task) })

export const captureProjectReviewSnapshot = (project: any, note = '', now: Date = new Date()) => {
  const governance = getProjectGovernance(project); const at = now.toISOString(); const forecast = getProjectForecast(project, now); const health = getProjectHealth(project, now)
  const snapshot = {
    id: `review-${now.getTime()}`,
    captured_at: at,
    note,
    status: project?.status || '',
    priority: project?.priority || '',
    progress: getProjectExecutionProgress(project),
    health: health.level,
    forecast_finish: forecast.forecastFinish,
    evidence_readiness: getEvidenceReadiness(project).evidencePercent,
    benefits: { man_hours_saved: Number(project?.man_hours_saved) || 0, stoploss_minutes_saved: Number(project?.stoploss_minutes_saved) || 0, wafers_gained: Number(project?.wafers_gained) || 0 },
    tasks: (project?.tasks || []).map(compactSnapshotTask),
  }
  const reviewSnapshots = [snapshot, ...governance.reviewSnapshots].slice(0, 24)
  return withGovernanceState(project, auditGovernance({ ...governance, reviewSnapshots }, 'Review snapshot captured', note || 'Weekly project review baseline', at))
}

export const buildProjectChangeIntelligence = (project: any, now: Date = new Date()) => {
  const governance = getProjectGovernance(project); const snapshot = governance.reviewSnapshots[0]
  if (!snapshot) return { hasSnapshot: false, snapshot: null, changes: [] as any[], progressDelta: null as number | null, forecastDeltaDays: null as number | null }
  const changes: any[] = []
  const previousTasks = new Map((snapshot.tasks || []).map((task: any) => [String(task.id), task]))
  const currentTasks = new Map((project?.tasks || []).map((task: any) => [String(task.id), compactSnapshotTask(task)]))
  currentTasks.forEach((task: any, id) => {
    const before: any = previousTasks.get(id)
    if (!before) { changes.push({ kind: 'added', tone: 'blue', label: `Added task · ${task.name}` }); return }
    if (before.status !== task.status) changes.push({ kind: task.status === 'Blocked' ? 'newly-blocked' : canonicalTaskStatus(before.status) === 'Completed' && canonicalTaskStatus(task.status) !== 'Completed' ? 'reopened' : 'status', tone: task.status === 'Blocked' || canonicalTaskStatus(before.status) === 'Completed' ? 'rose' : canonicalTaskStatus(task.status) === 'Completed' ? 'emerald' : 'blue', label: `${task.name} · ${before.status || 'blank'} → ${task.status || 'blank'}` })
    if (before.owner !== task.owner) changes.push({ kind: 'owner', tone: 'slate', label: `${task.name} · owner ${before.owner} → ${task.owner}` })
    if (before.end_date !== task.end_date) changes.push({ kind: 'date', tone: 'amber', label: `${task.name} · due ${before.end_date || 'none'} → ${task.end_date || 'none'}` })
    if (before.priority !== task.priority) changes.push({ kind: 'priority', tone: 'amber', label: `${task.name} · priority ${before.priority} → ${task.priority}` })
  })
  previousTasks.forEach((task: any, id) => { if (!currentTasks.has(id)) changes.push({ kind: 'removed', tone: 'slate', label: `Removed task · ${task.name}` }) })
  if (snapshot.status !== project?.status) changes.push({ kind: 'project-status', tone: 'blue', label: `Project status · ${snapshot.status} → ${project?.status}` })
  if (snapshot.priority !== project?.priority) changes.push({ kind: 'project-priority', tone: 'amber', label: `Project priority · ${snapshot.priority} → ${project?.priority}` })
  const progress = getProjectExecutionProgress(project)
  const progressDelta = progress - Number(snapshot.progress || 0)
  const forecast = getProjectForecast(project, now)
  const snapshotForecast = calendarOrdinal(snapshot.forecast_finish)
  const forecastDeltaDays = snapshotForecast == null || forecast.forecastFinishOrdinal == null ? null : forecast.forecastFinishOrdinal - snapshotForecast
  return { hasSnapshot: true, snapshot, changes, progressDelta, forecastDeltaDays }
}


export const buildProjectRailRows = (
  projects: any[],
  scope: ProjectRailScope,
  search: string,
  watchedIds: Array<number | string> = [],
  recentIds: Array<number | string> = [],
) => {
  const query = String(search || '').trim().toLowerCase()
  const watched = new Set(watchedIds.map(String))
  const recentOrder = new Map(recentIds.map((id, index) => [String(id), index]))
  const rows = (projects || []).filter((project: any) => {
    const searchable = [project?.name, project?.objective, project?.problem_statement, project?.owner, ...(project?.owners || [])]
      .filter(Boolean).join(' ').toLowerCase()
    if (query && !searchable.includes(query)) return false
    if (scope === 'watched' && !watched.has(String(project?.id))) return false
    if (scope === 'recent' && !recentOrder.has(String(project?.id))) return false
    if (scope === 'active' && !isOpenProject(project)) return false
    return true
  })
  if (scope === 'recent') return rows.sort((a: any, b: any) => (recentOrder.get(String(a.id)) ?? 9999) - (recentOrder.get(String(b.id)) ?? 9999))
  return rows.sort((a: any, b: any) => {
    const aOpen = isOpenProject(a) ? 0 : 1; const bOpen = isOpenProject(b) ? 0 : 1
    if (aOpen !== bOpen) return aOpen - bOpen
    return (a?.order_index || 0) - (b?.order_index || 0) || String(a?.name || '').localeCompare(String(b?.name || ''))
  })
}

export const buildProjectOverview = (project: any, now: Date = new Date()) => {
  const tasks = Array.isArray(project?.tasks) ? project.tasks : []
  const openTasks = tasks.filter((task: any) => canonicalTaskStatus(task?.status) !== 'Completed')
  const criticalIds = getCriticalTaskIds(project)
  const health = getProjectHealth(project, now)
  const milestones = getProjectMilestones(project, now)
  const nextMilestone = milestones.find((milestone) => canonicalTaskStatus(milestone.status) !== 'Completed') || null
  const forecast = getProjectForecast(project, now)
  const evidence = getEvidenceReadiness(project)
  const blockers = openTasks
    .filter((task: any) => task?.status === 'Blocked' || (getDaysToDue(task?.end_date, now) ?? 0) < 0)
    .sort((a: any, b: any) => {
      if (a.status === 'Blocked' && b.status !== 'Blocked') return -1
      if (b.status === 'Blocked' && a.status !== 'Blocked') return 1
      return (getDaysToDue(a?.end_date, now) ?? 9999) - (getDaysToDue(b?.end_date, now) ?? 9999)
    })
  const nextActions = openTasks
    .slice()
    .sort((a: any, b: any) => {
      const aCritical = criticalIds.has(a.id) ? 0 : 1; const bCritical = criticalIds.has(b.id) ? 0 : 1
      if (aCritical !== bCritical) return aCritical - bCritical
      const aDue = getDaysToDue(a?.end_date, now); const bDue = getDaysToDue(b?.end_date, now)
      return (aDue == null ? 9999 : aDue) - (bDue == null ? 9999 : bDue)
    })
  const governance = getProjectGovernance(project)
  const recentChanges = governance.audit.slice(0, 8)
  return {
    progress: getProjectExecutionProgress(project),
    health,
    forecast,
    evidence,
    milestones,
    nextMilestone,
    blockers,
    nextActions,
    recentChanges,
    openTasks: openTasks.length,
    completedTasks: tasks.length - openTasks.length,
    criticalTasks: criticalIds.size,
  }
}

export const buildProjectReportSummary = (project: any, now: Date = new Date()) => {
  const overview = buildProjectOverview(project, now)
  const change = buildProjectChangeIntelligence(project, now)
  const benefits = getBenefitRealization(project)
  return {
    projectId: project?.id,
    name: project?.name || 'Untitled project',
    objective: project?.objective || project?.problem_statement || '',
    status: project?.status || 'Not Started',
    priority: project?.priority || 'Medium',
    progress: overview.progress,
    health: overview.health,
    plannedFinish: overview.forecast.plannedFinish,
    forecastFinish: overview.forecast.forecastFinish,
    varianceDays: overview.forecast.varianceVsPlanDays,
    nextMilestone: overview.nextMilestone,
    blockers: overview.blockers.slice(0, 8),
    nextActions: overview.nextActions.slice(0, 8),
    recentChanges: change.hasSnapshot ? change.changes.slice(0, 8) : overview.recentChanges,
    latestUpdates: getProjectUpdates(project).slice(0, 6).map((update: any) => ({
      id: update?.id || null,
      content: String(update?.content || update?.text || ''),
      author: update?.author || null,
      mentions: Array.isArray(update?.mentions) ? [...update.mentions] : [],
      created_at: update?.created_at || update?.timestamp || null,
    })),
    evidence: overview.evidence,
    benefits,
  }
}


const cloneProjectReportValue = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export const extractProjectMentions = (value?: string | null): string[] => {
  const text = String(value || '')
  const mentions: string[] = []
  const seen = new Set<string>()
  const pattern = /(^|[\s(\[{])@([A-Za-z0-9][A-Za-z0-9_.-]{0,63})/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const mention = `@${match[2]}`
    const key = mention.toLowerCase()
    if (!seen.has(key)) { seen.add(key); mentions.push(mention) }
  }
  return mentions
}

export const getProjectMentionQuery = (value?: string | null, cursor?: number | null): string | null => {
  const text = String(value || '')
  const end = Math.max(0, Math.min(cursor == null ? text.length : cursor, text.length))
  const prefix = text.slice(0, end)
  const match = prefix.match(/(?:^|[\s(\[{])@([A-Za-z0-9_.-]{0,64})$/)
  return match ? match[1] : null
}

export const getProjectMentionCandidates = (operators: any[], query?: string | null) => {
  const needle = String(query || '').trim().replace(/^@/, '').toLowerCase()
  const seen = new Set<string>()
  return (Array.isArray(operators) ? operators : []).flatMap((operator: any) => {
    if (operator?.active === false || operator?.is_active === false || operator?.disabled === true) return []
    const username = String(operator?.username || '').trim()
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(username)) return []
    const key = username.toLowerCase()
    if (seen.has(key)) return []
    const label = String(operator?.display_name || operator?.full_name || operator?.name || username).trim() || username
    const email = String(operator?.email || '').trim()
    const haystack = `${username} ${label} ${email}`.toLowerCase()
    if (needle && !haystack.includes(needle)) return []
    seen.add(key)
    return [{ id: String(operator?.id ?? key), username, mention: `@${username}`, label, email: email || null }]
  }).slice(0, 8)
}

export const applyProjectMentionCandidate = (value: string, username: string, cursor?: number | null) => {
  const text = String(value || '')
  const handle = String(username || '').trim().replace(/^@/, '')
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(handle)) return text
  const end = Math.max(0, Math.min(cursor == null ? text.length : cursor, text.length))
  const prefix = text.slice(0, end)
  const match = prefix.match(/(?:^|[\s(\[{])@([A-Za-z0-9_.-]{0,64})$/)
  if (!match) return text
  const token = `@${match[1]}`
  const start = prefix.length - token.length
  const suffix = text.slice(end)
  const spacer = suffix.startsWith(' ') ? '' : ' '
  return `${text.slice(0, start)}@${handle}${spacer}${suffix}`
}

export const addProjectTaskComment = (project: any, taskId: number | string, input: any, now: Date = new Date()) => {
  const content = String(input?.content ?? input?.text ?? '').trim()
  if (!content) return project
  const task = (project?.tasks || []).find((row: any) => String(row?.id) === String(taskId))
  if (!task) return project
  const metadata = taskMetadata(task)
  const comments = Array.isArray(metadata.comments) ? metadata.comments : []
  const createdAt = String(input?.created_at || input?.timestamp || now.toISOString())
  const id = String(input?.id || `comment-${now.getTime()}`)
  if (comments.some((comment: any) => String(comment?.id) === id)) return project
  const author = String(input?.author || '').trim() || null
  const comment = { id, content, text: content, author, mentions: extractProjectMentions(content), created_at: createdAt, timestamp: createdAt }
  return updateProjectTask(project, taskId, { metadata_json: { ...metadata, comments: [...comments, comment].slice(-80) } })
}

export const addProjectMaterial = (project: any, input: any, now: Date = new Date()) => {
  const title = String(input?.title || input?.name || '').trim()
  const url = String(input?.url || input?.href || '').trim()
  const kind = input?.kind === 'file' ? 'file' : 'link'
  if (!title || !url) return project
  const metadata = project?.metadata_json && typeof project.metadata_json === 'object' ? project.metadata_json : {}
  const key = kind === 'file' ? 'files' : 'links'
  const rows = Array.isArray(metadata[key]) ? metadata[key] : []
  const createdAt = String(input?.created_at || now.toISOString())
  const id = String(input?.id || `material-${now.getTime()}`)
  if (rows.some((row: any) => String(row?.id) === id)) return project
  const material = { id, title, name: title, url, href: url, type: kind, created_at: createdAt }
  return { ...project, metadata_json: { ...metadata, [key]: [...rows, material].slice(-80) } }
}

export const getProjectUpdates = (project: any): any[] => {
  const metadata = project?.metadata_json && typeof project.metadata_json === 'object' ? project.metadata_json : {}
  const collaboration = metadata[PROJECT_UPDATES_KEY] && typeof metadata[PROJECT_UPDATES_KEY] === 'object' ? metadata[PROJECT_UPDATES_KEY] : {}
  return Array.isArray(collaboration.updates) ? collaboration.updates : []
}

export const addProjectUpdate = (project: any, input: any, now: Date = new Date()) => {
  const content = String(input?.content ?? input?.text ?? '').trim()
  if (!content) return project
  const metadata = project?.metadata_json && typeof project.metadata_json === 'object' ? project.metadata_json : {}
  const collaboration = metadata[PROJECT_UPDATES_KEY] && typeof metadata[PROJECT_UPDATES_KEY] === 'object' ? metadata[PROJECT_UPDATES_KEY] : {}
  const updates = getProjectUpdates(project)
  const createdAt = String(input?.created_at || input?.timestamp || now.toISOString())
  const id = String(input?.id || `update-${now.getTime()}`)
  if (updates.some((update: any) => String(update?.id) === id)) return project
  const author = String(input?.author || '').trim() || null
  const update = { id, content, text: content, author, mentions: extractProjectMentions(content), created_at: createdAt, timestamp: createdAt }
  return { ...project, metadata_json: { ...metadata, [PROJECT_UPDATES_KEY]: { ...collaboration, updates: [update, ...updates].slice(0, 80) } } }
}

export const getProjectReportHistory = (project: any): any[] => {
  const metadata = project?.metadata_json && typeof project.metadata_json === 'object' ? project.metadata_json : {}
  const reporting = metadata[PROJECT_REPORTING_KEY] && typeof metadata[PROJECT_REPORTING_KEY] === 'object' ? metadata[PROJECT_REPORTING_KEY] : {}
  return Array.isArray(reporting.snapshots) ? reporting.snapshots : []
}

export const captureProjectReportSnapshot = (project: any, now: Date = new Date()) => {
  const metadata = project?.metadata_json && typeof project.metadata_json === 'object' ? project.metadata_json : {}
  const reporting = metadata[PROJECT_REPORTING_KEY] && typeof metadata[PROJECT_REPORTING_KEY] === 'object' ? metadata[PROJECT_REPORTING_KEY] : {}
  const capturedAt = now.toISOString()
  const snapshot = { id: `report-${now.getTime()}`, captured_at: capturedAt, summary: cloneProjectReportValue(buildProjectReportSummary(project, now)) }
  const snapshots = [snapshot, ...getProjectReportHistory(project)].slice(0, 24)
  return { ...project, metadata_json: { ...metadata, [PROJECT_REPORTING_KEY]: { ...reporting, snapshots } } }
}

export const getProjectReportSharePath = (projectId: number | string, snapshotId: string) => `/projects?id=${encodeURIComponent(String(projectId))}&view=reports&report=${encodeURIComponent(String(snapshotId))}`

export const getMyWork = (projects: any[], owner: string, now: Date = new Date()) => {
  const normalized = owner.trim().toLowerCase()
  if (!normalized) return []
  const needs = new Map(getProjectNeedsUpdate(projects, owner, now).map((row: any) => [`${row.projectId}:${row.task.id}`, row]))
  return (projects || []).flatMap((project: any) => (project?.tasks || []).filter((task: any) => canonicalTaskStatus(task?.status) !== 'Completed' && getTaskOwnerLabel(task).toLowerCase().includes(normalized)).map((task: any) => {
    const daysToDue = getDaysToDue(task?.end_date, now); const key = `${project.id}:${task.id}`; const needsRow: any = needs.get(key)
    const bucket = task?.status === 'Blocked' ? 'Blocked' : daysToDue != null && daysToDue < 0 ? 'Overdue' : daysToDue === 0 ? 'Today' : daysToDue != null && daysToDue <= 3 ? 'Due soon' : needsRow ? 'Needs update' : 'Upcoming'
    return { projectId: project.id, projectName: project.name, task, daysToDue, progress: getTaskProgress(task), bucket, needsUpdate: Boolean(needsRow), updateReasons: needsRow?.reasons || [] }
  })).sort((a: any, b: any) => {
    const rank: Record<string, number> = { Blocked: 0, Overdue: 1, Today: 2, 'Needs update': 3, 'Due soon': 4, Upcoming: 5 }
    return (rank[a.bucket] ?? 9) - (rank[b.bucket] ?? 9) || (a.daysToDue ?? 99999) - (b.daysToDue ?? 99999)
  })
}
