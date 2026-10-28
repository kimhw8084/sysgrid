import { describe, expect, it } from 'vitest'
import {
  PROJECT_GOLDEN_VIEWS,
  PROJECT_GOVERNANCE_KEY,
  PROJECT_PRIMARY_VIEWS,
  PROJECT_REPORTING_KEY,
  PROJECT_UPDATES_KEY,
  PROJECT_RAIL_SCOPES,
  PROJECT_SORT_MODES,
  PROJECT_TASK_STATUSES,
  PROJECT_TIMELINE_ZOOMS,
  addProjectMaterial,
  addProjectTaskComment,
  addProjectUpdate,
  appendProjectAudit,
  buildCrossProjectDependencies,
  buildProjectTaskHierarchy,
  buildProjectTimelineRows,
  bulkUpdateProjectTasks,
  buildOwnerWorkload,
  buildPortfolioMetrics,
  buildProjectAttentionItems,
  buildProjectChangeIntelligence,
  buildProjectOverview,
  buildProjectRailRows,
  buildProjectReportSummary,
  captureProjectReportSnapshot,
  captureProjectReviewSnapshot,
  captureProjectScheduleBaseline,
  createProjectTask,
  deleteProjectTasks,
  diversifyAttentionItems,
  duplicateProjectTask,
  filterProjectsForGoldenView,
  getBenefitRealization,
  getCriticalTaskIds,
  getDaysToDue,
  getEvidenceReadiness,
  getProjectExecutionProgress,
  getProjectForecast,
  getProjectGovernance,
  getProjectHealth,
  getProjectMilestones,
  getProjectTaskDescendantIds,
  getProjectTaskParentId,
  getProjectNeedsUpdate,
  getProjectMentionCandidates,
  getProjectMentionQuery,
  applyProjectMentionCandidate,
  getProjectReportHistory,
  getProjectReportSharePath,
  getProjectUpdates,
  getProjectTimelineRange,
  getProjectWipLimits,
  getMyWork,
  getTaskProgress,
  extractProjectMentions,
  indentProjectTask,
  moveProjectTaskStatus,
  moveProjectTaskSchedule,
  normalizeProjectFilterValue,
  normalizeProjectSavedViewState,
  projectSavedViewFromWorkspaceDefinition,
  projectSavedViewToWorkspaceDefinition,
  outdentProjectTask,
  parseProjectTaskPaste,
  normalizeTaskStatus,
  projectFingerprint,
  reorderProjectTaskBefore,
  resizeProjectTaskSchedule,
  resolveProjectGoldenView,
  resolveProjectInsightSection,
  resolveProjectPortfolioSection,
  setProjectBenefitTargets,
  setProjectTaskMilestone,
  setProjectTaskDependency,
  setProjectWipLimit,
  shiftProjectTaskSchedules,
  setProjectTaskParent,
  simulateProjectScenario,
  wouldCreateProjectTaskDependencyCycle,
  toggleStageGateEvidence,
  updateProjectTask,
  upsertDecisionRecord,
  upsertRaidItem,
  upsertStageGate,
} from './ProjectsGolden.model'

const NOW = new Date('2026-08-28T12:00:00-05:00')
const projects: any[] = [
  {
    id: 1, name: 'Alpha', status: 'In Progress', priority: 'Highest', owner: 'alice', man_hours_saved: 60, stoploss_minutes_saved: 20, wafers_gained: 3,
    metadata_json: { baseline_end_date: '2026-08-31' }, end_date: '2026-09-05',
    tasks: [
      { id: 11, name: 'Blocked path', status: 'Blocked', progress: 30, owner: '', priority: 'High', start_date: '2026-08-20', end_date: '2026-08-27', dependencies_json: [] },
      { id: 12, name: 'Review gate', status: 'Review', progress: 90, owner: 'alice', start_date: '2026-08-28', end_date: '2026-08-30', dependencies_json: [11], metadata_json: { milestone: true } },
      { id: 13, name: 'Final release', status: 'To Do', progress: 0, owner: 'bob', start_date: '2026-08-31', end_date: '2026-09-05', dependencies_json: [12] },
    ],
  },
  {
    id: 2, name: 'Beta', status: 'Planning', priority: 'Low', owner: 'bob',
    tasks: [{ id: 21, name: 'Queued', status: 'To Do', progress: 0, owner: 'bob', end_date: '2026-09-10', dependencies_json: [12] }],
  },
]

const govern = (project: any) => {
  let next = upsertRaidItem(project, { type: 'Risk', title: 'Supply risk', impact: 'High', status: 'Open' }, NOW)
  next = upsertDecisionRecord(next, { kind: 'Decision', title: 'Use vendor B', status: 'Approved' }, NOW)
  next = upsertStageGate(next, { name: 'Release gate', status: 'Ready', evidence: [{ label: 'Runbook', complete: true }, { label: 'Approval', complete: false }] }, NOW)
  next = setProjectBenefitTargets(next, { manHoursSaved: 100, stoplossMinutesSaved: 40, wafersGained: 6 }, NOW)
  return next
}

describe('Projects governance and forecasting model', () => {
  it('defines the member-first Project workbench views and preserves legacy deep-link aliases', () => {
    expect(PROJECT_GOLDEN_VIEWS).toEqual(['overview', 'tasks', 'timeline', 'board', 'files', 'updates', 'reports', 'insights', 'portfolio'])
    expect(PROJECT_PRIMARY_VIEWS).toEqual(['overview', 'tasks', 'timeline', 'board', 'files', 'updates', 'reports', 'insights'])
    expect(PROJECT_RAIL_SCOPES).toEqual(['recent', 'watched', 'active', 'all'])
    expect(PROJECT_TASK_STATUSES).toEqual(['To Do', 'In Progress', 'Blocked', 'Review', 'Completed'])
    expect(PROJECT_TIMELINE_ZOOMS).toEqual(['day', 'week', 'month', 'quarter'])
    expect(resolveProjectGoldenView('workspace')).toBe('timeline')
    expect(resolveProjectGoldenView('review')).toBe('insights')
    expect(resolveProjectGoldenView('governance')).toBe('insights')
    expect(resolveProjectGoldenView('unknown')).toBe('overview')
    expect(resolveProjectPortfolioSection(null, 'roadmap')).toBe('roadmap')
    expect(resolveProjectPortfolioSection(null, 'owners')).toBe('owners')
    expect(resolveProjectInsightSection(null, 'governance')).toBe('governance')
  })

  it('normalizes ALL filters and preserves unknown task states for diagnostics', () => {
    expect(normalizeProjectFilterValue('all')).toBe('ALL')
    expect(normalizeTaskStatus('Queued Legacy')).toBe('Unknown')
  })

  it('uses calendar-date semantics without UTC day shifting', () => {
    expect(getDaysToDue('2026-08-28T23:30:00Z', NOW)).toBe(0)
    expect(getDaysToDue('2026-08-27T23:30:00Z', NOW)).toBe(-1)
  })

  it('makes completed progress canonical and reopened progress deterministic', () => {
    const completed = moveProjectTaskStatus(projects[0], 12, 'Completed')
    expect(getTaskProgress(completed.tasks.find((task: any) => task.id === 12))).toBe(100)
    const reopened = moveProjectTaskStatus(completed, 12, 'Review')
    expect(reopened.tasks.find((task: any) => task.id === 12).progress).toBe(90)
  })

  it('returns the original project for a no-op board move', () => {
    expect(moveProjectTaskStatus(projects[0], 12, 'Review')).toBe(projects[0])
  })

  it('derives the dependency-backed critical path and milestones from existing task truth', () => {
    const critical = getCriticalTaskIds(projects[0])
    expect([...critical]).toEqual(expect.arrayContaining([11, 12, 13]))
    expect(getProjectMilestones(projects[0], NOW).some((milestone) => milestone.id === 12)).toBe(true)
  })

  it('produces explainable health and grouped attention without a backend score', () => {
    const health = getProjectHealth(projects[0], NOW)
    expect(health.level).toBe('red')
    expect(health.blockedCritical).toBe(1)
    const attention = buildProjectAttentionItems(projects, NOW)
    const task11 = attention.filter((item) => item.taskId === 11)
    expect(task11).toHaveLength(1)
    expect(task11[0].reasons).toEqual(expect.arrayContaining(['blocked', 'overdue', 'unassigned']))
  })

  it('reports Unknown health until a project has execution evidence', () => {
    const health = getProjectHealth({ id: 99, name: 'Unplanned project' }, NOW)
    expect(health.level).toBe('unknown')
    expect(health.reasons).toContain('No execution plan recorded')
    expect(buildPortfolioMetrics([{ id: 99, name: 'Unplanned project' }], NOW).healthUnknown).toBe(1)
  })

  it('diversifies a constrained attention queue across projects first', () => {
    const alpha = buildProjectAttentionItems(projects, NOW)[0]
    const diversified = diversifyAttentionItems([alpha, { ...alpha, id: 'extra-alpha' }, { ...alpha, id: 'beta-risk', projectId: 2, projectName: 'Beta', taskId: 21 }], 2)
    expect(diversified.map((item) => item.projectId)).toEqual([1, 2])
  })

  it('uses task-weighted portfolio progress while retaining project average context', () => {
    const metrics = buildPortfolioMetrics(projects, NOW)
    expect(metrics.tasks).toBe(4)
    expect(metrics.projectAverageProgress).not.toBeUndefined()
  })

  it('sorts, filters, owner workload and cross-project dependencies deterministically', () => {
    expect(filterProjectsForGoldenView(projects, '', 'ALL', 'ALL', 'health', [], false, NOW)[0].id).toBe(1)
    expect(buildOwnerWorkload(projects, NOW).some((row) => row.owner === 'Unassigned' && row.blocked === 1)).toBe(true)
    expect(buildCrossProjectDependencies(projects).some((row) => row.fromProjectId === 1 && row.toProjectId === 2)).toBe(true)
  })

  it('supports immutable task quick capture/edit and auditable task actions', () => {
    const added = createProjectTask(projects[1], { id: 22, name: 'Captured', status: 'To Do' })
    const edited = updateProjectTask(added, 22, { owner: 'alice' })
    const audited = appendProjectAudit(edited, 'Task edited', 'Captured', NOW)
    expect(projects[1].tasks).toHaveLength(1)
    expect(edited.tasks.find((task: any) => task.id === 22).owner).toBe('alice')
    expect(getProjectGovernance(audited).audit[0].action).toBe('Task edited')
  })

  it('forecasts finish from remaining duration and dependency propagation', () => {
    const forecast = getProjectForecast(projects[0], NOW)
    expect(forecast.plannedFinish).toBe('2026-09-05')
    expect(forecast.forecastFinish).toBe('2026-09-09')
    expect(forecast.varianceVsPlanDays).toBe(4)
    expect(forecast.drivers[0].id).toBe(11)
  })

  it('simulates a task slip without mutating the live project', () => {
    const scenario = simulateProjectScenario(projects[0], 11, 5, NOW)
    expect(scenario.baseForecastFinish).toBe('2026-09-09')
    expect(scenario.scenarioForecastFinish).toBe('2026-09-14')
    expect(scenario.finishDeltaDays).toBe(5)
    expect(scenario.affected.map((row) => row.id)).toEqual(expect.arrayContaining([11, 12, 13]))
    expect(projects[0].tasks[0].end_date).toBe('2026-08-27')
  })

  it('stores RAID and decision/change records inside the existing governance metadata namespace', () => {
    const governed = govern(projects[0])
    const governance = getProjectGovernance(governed)
    expect(governed.metadata_json[PROJECT_GOVERNANCE_KEY]).toBeDefined()
    expect(governance.raid[0].title).toBe('Supply risk')
    expect(governance.decisions[0].status).toBe('Approved')
    expect(governance.audit.length).toBeGreaterThanOrEqual(4)
  })

  it('derives stage-gate evidence readiness and toggles evidence immutably', () => {
    const governed = govern(projects[0])
    const readiness = getEvidenceReadiness(governed)
    expect(readiness.evidencePercent).toBe(50)
    const gate = getProjectGovernance(governed).stageGates[0]
    const openEvidence = gate.evidence.find((row: any) => !row.complete)
    const completed = toggleStageGateEvidence(governed, gate.id, openEvidence.id, true, NOW)
    expect(getEvidenceReadiness(completed).evidencePercent).toBe(100)
    expect(getEvidenceReadiness(governed).evidencePercent).toBe(50)
  })

  it('calculates target versus realized benefits without manufacturing missing targets', () => {
    const realization = getBenefitRealization(govern(projects[0]))
    expect(realization.find((row) => row.key === 'manHoursSaved')?.percent).toBe(60)
    expect(getBenefitRealization(projects[0]).every((row) => row.target == null)).toBe(true)
  })

  it('captures a bounded review snapshot and explains material changes since that baseline', () => {
    const captured = captureProjectReviewSnapshot(govern(projects[0]), 'weekly baseline', NOW)
    const changed = { ...captured, tasks: captured.tasks.map((task: any) => task.id === 12 ? { ...task, status: 'Blocked', owner: 'carol', end_date: '2026-09-03' } : task) }
    const intelligence = buildProjectChangeIntelligence(changed, new Date('2026-08-29T12:00:00-05:00'))
    expect(intelligence.hasSnapshot).toBe(true)
    expect(intelligence.changes.map((row) => row.kind)).toEqual(expect.arrayContaining(['newly-blocked', 'owner', 'date']))
    expect(getProjectGovernance(captured).reviewSnapshots).toHaveLength(1)
  })

  it('returns an explicit no-baseline change state before the first review snapshot', () => {
    const intelligence = buildProjectChangeIntelligence(projects[0], NOW)
    expect(intelligence.hasSnapshot).toBe(false)
    expect(intelligence.changes).toEqual([])
  })

  it('includes governance truth in stale-write fingerprints', () => {
    const base = projectFingerprint(projects[0])
    const governed = upsertRaidItem(projects[0], { title: 'Risk', type: 'Risk' }, NOW)
    expect(projectFingerprint(governed)).not.toBe(base)
    expect(projectFingerprint(projects[0])).toBe(projectFingerprint({ ...projects[0] }))
  })

  it('builds recent/watched/active project rail scopes deterministically', () => {
    expect(buildProjectRailRows(projects, 'recent', '', [], ['2', '1']).map((row) => row.id)).toEqual([2, 1])
    expect(buildProjectRailRows(projects, 'watched', '', ['2'], []).map((row) => row.id)).toEqual([2])
    expect(buildProjectRailRows(projects, 'active', '', [], []).map((row) => row.id)).toEqual([1, 2])
    expect(buildProjectRailRows(projects, 'all', 'beta', [], []).map((row) => row.id)).toEqual([2])
  })

  it('derives an execution-first overview from the same task, schedule, health and governance truth', () => {
    const overview = buildProjectOverview(projects[0], NOW)
    expect(overview.progress).toBe(40)
    expect(overview.blockers.map((task) => task.id)).toContain(11)
    expect(overview.nextActions.map((task) => task.id)).toEqual(expect.arrayContaining([11, 12, 13]))
    expect(overview.nextMilestone?.id).toBe(12)
    expect(overview.forecast.forecastFinish).toBe('2026-09-09')
  })

  it('builds the live report summary from canonical project execution truth without duplicate report state', () => {
    const report = buildProjectReportSummary(govern(projects[0]), NOW)
    expect(report.name).toBe('Alpha')
    expect(report.progress).toBe(40)
    expect(report.forecastFinish).toBe('2026-09-09')
    expect(report.blockers[0].id).toBe(11)
    expect(report.evidence.evidencePercent).toBe(50)
    expect(report.benefits.find((row) => row.key === 'manHoursSaved')?.percent).toBe(60)
  })

  it('retains project execution progress compatibility', () => {
    expect(getProjectExecutionProgress(projects[0])).toBe(40)
  })

  it('builds stable WBS hierarchy, supports indent/outdent, and rejects hierarchy cycles', () => {
    const base: any = { id: 9, tasks: [
      { id: 1, name: 'Phase', order_index: 10, metadata_json: {} },
      { id: 2, name: 'Child', order_index: 20, metadata_json: {} },
      { id: 3, name: 'Grandchild', order_index: 30, metadata_json: {} },
    ] }
    const indented = indentProjectTask(base, 2)
    expect(getProjectTaskParentId(indented.tasks.find((task: any) => task.id === 2))).toBe(1)
    const nested = indentProjectTask(indented, 3)
    expect(getProjectTaskParentId(nested.tasks.find((task: any) => task.id === 3))).toBe(2)
    expect(buildProjectTaskHierarchy(nested).map((row) => [row.id, row.depth])).toEqual([[1,0],[2,1],[3,2]])
    expect(getProjectTaskDescendantIds(nested, 1)).toEqual(new Set(['2','3']))
    expect(setProjectTaskParent(nested, 1, 3)).toBe(nested)
    const outdented = outdentProjectTask(nested, 3)
    expect(getProjectTaskParentId(outdented.tasks.find((task: any) => task.id === 3))).toBe(1)
  })

  it('reorders a task subtree as one WBS block', () => {
    const base: any = { tasks: [
      { id: 1, name: 'A', order_index: 10, metadata_json: {} },
      { id: 2, name: 'A1', order_index: 20, metadata_json: { wbs_parent_id: 1 } },
      { id: 3, name: 'B', order_index: 30, metadata_json: {} },
      { id: 4, name: 'C', order_index: 40, metadata_json: {} },
    ] }
    const moved = reorderProjectTaskBefore(base, 1, 4)
    expect(buildProjectTaskHierarchy(moved).map((row) => row.id)).toEqual([3,1,2,4])
  })

  it('bulk edits task truth with canonical status progress, dates, milestone and shift semantics', () => {
    const base: any = { tasks: [
      { id: 1, name: 'A', status: 'In Progress', progress: 25, start_date: '2026-08-28', end_date: '2026-08-30', metadata_json: {} },
      { id: 2, name: 'B', status: 'To Do', progress: 0, start_date: '2026-09-01', end_date: '2026-09-02', metadata_json: {} },
    ] }
    const changed = bulkUpdateProjectTasks(base, [1,2], { status: 'Completed', owner: 'alice', milestone: true, shiftDays: 2 })
    expect(changed.tasks.every((task: any) => task.progress === 100 && task.owner === 'alice' && task.metadata_json.is_milestone)).toBe(true)
    expect(changed.tasks[0].start_date).toBe('2026-08-30')
    expect(changed.tasks[1].end_date).toBe('2026-09-04')
  })

  it('duplicates and deletes tasks without leaving broken hierarchy or dependency references', () => {
    const base: any = { tasks: [
      { id: 1, name: 'Parent', order_index: 10, metadata_json: {} },
      { id: 2, name: 'Child', order_index: 20, metadata_json: { wbs_parent_id: 1 }, dependencies_json: [] },
      { id: 3, name: 'Dependent', order_index: 30, metadata_json: {}, dependencies_json: [2] },
    ] }
    const duplicated = duplicateProjectTask(base, 2, 20)
    expect(duplicated.tasks.find((task: any) => task.id === 20).name).toBe('Child copy')
    const deleted = deleteProjectTasks(base, [1])
    expect(getProjectTaskParentId(deleted.tasks.find((task: any) => task.id === 2))).toBe(null)
    const deletedChild = deleteProjectTasks(base, [2])
    expect(deletedChild.tasks.find((task: any) => task.id === 3).dependencies_json).toEqual([])
  })

  it('parses spreadsheet paste with headers or positional columns and rejects invalid statuses', () => {
    expect(parseProjectTaskPaste('Task\tOwner\tStatus\tPriority\tStart\tFinish\tProgress\nInstall\tAlice\tIn Progress\tHigh\t2026-09-01\t2026-09-03\t40%')).toEqual([{ name: 'Install', owner: 'Alice', status: 'In Progress', priority: 'High', start_date: '2026-09-01', end_date: '2026-09-03', progress: 40 }])
    expect(parseProjectTaskPaste('Validate\tBob\tLegacy\tMedium')[0]).toMatchObject({ name: 'Validate', owner: 'Bob', priority: 'Medium' })
    expect(parseProjectTaskPaste('Validate\tBob\tLegacy\tMedium')[0].status).toBeUndefined()
  })

  it('makes hierarchy, description, ordering and checklist metadata participate in stale-write fingerprints', () => {
    const base = projectFingerprint(projects[0])
    expect(projectFingerprint(updateProjectTask(projects[0], 11, { description: 'new detail' }))).not.toBe(base)
    expect(projectFingerprint(updateProjectTask(projects[0], 11, { order_index: 99 }))).not.toBe(base)
    expect(projectFingerprint(updateProjectTask(projects[0], 11, { metadata_json: { wbs_parent_id: 12 } }))).not.toBe(base)
  })

  it('normalizes direct inline status and progress updates consistently with board status moves', () => {
    const completed = updateProjectTask(projects[0], 13, { status: 'Completed', progress: 10 })
    expect(completed.tasks.find((task: any) => task.id === 13).progress).toBe(100)
    const reopened = updateProjectTask(completed, 13, { status: 'In Progress' })
    expect(reopened.tasks.find((task: any) => task.id === 13).progress).toBe(50)
    const capped = updateProjectTask(projects[0], 13, { progress: 100 })
    expect(capped.tasks.find((task: any) => task.id === 13).progress).toBe(99)
  })

  it('marks task milestones through the existing task metadata contract', () => {
    const changed = setProjectTaskMilestone(projects[0], 13, true)
    expect(changed.tasks.find((task: any) => task.id === 13).metadata_json.is_milestone).toBe(true)
    expect(getProjectMilestones(changed, NOW).some((row) => row.id === 13)).toBe(true)
  })


  it('builds synchronized timeline rows with hierarchy, baseline, forecast, milestones and critical-path truth', () => {
    const baselined = captureProjectScheduleBaseline(projects[0], NOW)
    const rows = buildProjectTimelineRows(baselined, NOW)
    expect(rows.map((row) => row.id)).toEqual(buildProjectTaskHierarchy(baselined).map((row) => row.id))
    expect(rows.find((row) => row.id === 12)?.milestone).toBe(true)
    expect(rows.find((row) => row.id === 13)?.dependencyIds).toEqual(['12'])
    expect(rows.find((row) => row.id === 11)?.baselineEndOrdinal).not.toBeNull()
    expect(rows.some((row) => row.critical)).toBe(true)
    expect(rows.every((row) => row.forecastEndOrdinal != null)).toBe(true)
    const range = getProjectTimelineRange(baselined, NOW)
    expect(range.startOrdinal).toBeLessThan(range.endOrdinal)
    expect(range.todayOrdinal).toBeGreaterThanOrEqual(range.startOrdinal)
  })

  it('moves, resizes and multi-shifts schedules without inverting task dates', () => {
    const moved = moveProjectTaskSchedule(projects[0], 13, 2)
    expect(moved.tasks.find((task: any) => task.id === 13)).toMatchObject({ start_date: '2026-09-02', end_date: '2026-09-07' })
    const resizedStart = resizeProjectTaskSchedule(projects[0], 13, 'start', 99)
    expect(resizedStart.tasks.find((task: any) => task.id === 13).start_date).toBe('2026-09-05')
    const resizedEnd = resizeProjectTaskSchedule(projects[0], 13, 'end', -99)
    expect(resizedEnd.tasks.find((task: any) => task.id === 13).end_date).toBe('2026-08-31')
    const shifted = shiftProjectTaskSchedules(projects[0], [12,13], -1)
    expect(shifted.tasks.find((task: any) => task.id === 12).end_date).toBe('2026-08-29')
    expect(shifted.tasks.find((task: any) => task.id === 11).end_date).toBe('2026-08-27')
  })

  it('creates and removes task dependencies while rejecting self-links and cycles', () => {
    expect(wouldCreateProjectTaskDependencyCycle(projects[0], 11, 13)).toBe(true)
    expect(setProjectTaskDependency(projects[0], 11, 13, true)).toBe(projects[0])
    expect(setProjectTaskDependency(projects[0], 12, 12, true)).toBe(projects[0])
    const linked = setProjectTaskDependency(projects[0], 13, 11, true)
    expect(linked.tasks.find((task: any) => task.id === 13).dependencies_json.map(String)).toEqual(['12','11'])
    const removed = setProjectTaskDependency(linked, 13, 12, false)
    expect(removed.tasks.find((task: any) => task.id === 13).dependencies_json.map(String)).toEqual(['11'])
  })

  it('captures per-task baselines in existing metadata without changing live dates', () => {
    const baseline = captureProjectScheduleBaseline(projects[0], NOW)
    const task = baseline.tasks.find((row: any) => row.id === 13)
    expect(task.start_date).toBe('2026-08-31')
    expect(task.metadata_json.baseline_start_date).toBe('2026-08-31')
    expect(task.metadata_json.baseline_end_date).toBe('2026-09-05')
    expect(baseline.metadata_json.schedule_baseline_captured_at).toBe(NOW.toISOString())
  })

  it('persists configurable WIP limits through existing Project metadata and adds milestone swimlane compatibility', () => {
    expect(getProjectWipLimits(projects[0])['In Progress']).toBe(5)
    const changed = setProjectWipLimit(projects[0], 'In Progress', 8)
    expect(getProjectWipLimits(changed)['In Progress']).toBe(8)
    expect(changed.metadata_json.project_execution_config_v1.wip_limits['In Progress']).toBe(8)
  })

  it('classifies My Work and deterministic Needs Update without fabricating stale state when timestamps are missing', () => {
    const datedProjects: any[] = [{ id: 7, name: 'Execution', updated_at: '2026-08-20T10:00:00Z', tasks: [
      { id: 71, name: 'Blocked', owner: 'alice', status: 'Blocked', end_date: '2026-09-10' },
      { id: 72, name: 'Due', owner: 'alice', status: 'In Progress', end_date: '2026-08-28', updated_at: '2026-08-27T10:00:00Z' },
      { id: 73, name: 'Stale', owner: 'alice', status: 'Review', end_date: '2026-09-20', updated_at: '2026-08-20T10:00:00Z' },
      { id: 74, name: 'Future', owner: 'alice', status: 'To Do', end_date: '2026-10-20' },
    ] }]
    const needs = getProjectNeedsUpdate(datedProjects, 'alice', NOW)
    expect(needs.map((row: any) => row.task.id)).toEqual(expect.arrayContaining([71,72,73]))
    expect(needs.map((row: any) => row.task.id)).not.toContain(74)
    const work = getMyWork(datedProjects, 'alice', NOW)
    expect(work.find((row: any) => row.task.id === 71)?.bucket).toBe('Blocked')
    expect(work.find((row: any) => row.task.id === 72)?.bucket).toBe('Today')
    expect(work.find((row: any) => row.task.id === 73)?.bucket).toBe('Needs update')
    expect(work.find((row: any) => row.task.id === 74)?.bucket).toBe('Upcoming')
  })

  it('extracts stable unique @mentions from authored task comments and persists them on canonical task metadata', () => {
    expect(extractProjectMentions('Review with @Alice, @bob and @alice before signoff.')).toEqual(['@Alice', '@bob'])
    const changed = addProjectTaskComment(projects[0], 11, { id: 'comment-1', content: 'Review with @Alice and @bob', author: 'operator' }, NOW)
    const comment = changed.tasks.find((task: any) => task.id === 11).metadata_json.comments.at(-1)
    expect(comment).toMatchObject({ id: 'comment-1', content: 'Review with @Alice and @bob', author: 'operator', mentions: ['@Alice', '@bob'] })
    expect(projectFingerprint(changed)).not.toBe(projectFingerprint(projects[0]))
    expect(addProjectTaskComment(projects[0], 999, { content: 'missing' }, NOW)).toBe(projects[0])
    expect(addProjectTaskComment(projects[0], 11, { content: '   ' }, NOW)).toBe(projects[0])
  })

  it('authors link and file references through existing Project metadata without introducing a second material store', () => {
    const linked = addProjectMaterial(projects[0], { id: 'material-link', kind: 'link', title: 'Decision log', url: 'https://example.test/decision' }, NOW)
    expect(linked.metadata_json.links.at(-1)).toMatchObject({ id: 'material-link', title: 'Decision log', url: 'https://example.test/decision', type: 'link' })
    const filed = addProjectMaterial(linked, { id: 'material-file', kind: 'file', title: 'Run evidence', url: 'https://example.test/evidence.zip' }, NOW)
    expect(filed.metadata_json.files.at(-1)).toMatchObject({ id: 'material-file', title: 'Run evidence', type: 'file' })
    expect(addProjectMaterial(projects[0], { title: '', url: 'https://example.test' }, NOW)).toBe(projects[0])
  })

  it('captures bounded immutable report history and emits stable report deep links', () => {
    const captured = captureProjectReportSnapshot(projects[0], NOW)
    const history = getProjectReportHistory(captured)
    expect(history).toHaveLength(1)
    expect(history[0].captured_at).toBe(NOW.toISOString())
    expect(history[0].summary).toMatchObject({ projectId: 1, name: 'Alpha', status: 'In Progress' })
    expect(captured.metadata_json[PROJECT_REPORTING_KEY].snapshots[0].id).toBe(history[0].id)
    const changedAfterCapture = updateProjectTask(captured, 11, { status: 'Completed' })
    expect(getProjectReportHistory(changedAfterCapture)[0].summary.progress).toBe(history[0].summary.progress)
    expect(getProjectReportSharePath('alpha/1', history[0].id)).toBe(`/projects?id=alpha%2F1&view=reports&report=${encodeURIComponent(history[0].id)}`)
  })

  it('resolves authoritative mention candidates by stable username while matching name and email', () => {
    const operators = [
      { id: 1, username: 'alice', name: 'Alice Nguyen', email: 'alice@example.test', is_active: true },
      { id: 2, username: 'alicia', name: 'Alicia Park', email: 'apark@example.test', is_active: true },
      { id: 3, username: 'disabled', name: 'Disabled User', is_active: false },
      { id: 4, username: 'ALICE', name: 'Duplicate Alice', is_active: true },
      { id: 5, username: 'bad handle', name: 'Invalid Handle', is_active: true },
    ]
    expect(getProjectMentionCandidates(operators, 'ali').map((row: any) => row.mention)).toEqual(['@alice', '@alicia'])
    expect(getProjectMentionCandidates(operators, 'park').map((row: any) => row.mention)).toEqual(['@alicia'])
    expect(getProjectMentionCandidates(operators, 'example.test').map((row: any) => row.mention)).toEqual(['@alice', '@alicia'])
  })

  it('detects the active mention token and replaces only that token with the canonical username', () => {
    expect(getProjectMentionQuery('Coordinate with @ali')).toBe('ali')
    expect(getProjectMentionQuery('Coordinate with @alice before')).toBeNull()
    expect(applyProjectMentionCandidate('Coordinate with @ali', 'alice')).toBe('Coordinate with @alice ')
    expect(applyProjectMentionCandidate('(@bo', '@bob')).toBe('(@bob ')
    expect(applyProjectMentionCandidate('No active token', 'alice')).toBe('No active token')
  })

  it('authors bounded project-level updates with canonical mention extraction on existing Project metadata', () => {
    const changed = addProjectUpdate(projects[0], { id: 'update-1', content: 'Status is ready for @Alice and @bob', author: 'operator' }, NOW)
    expect(getProjectUpdates(changed)[0]).toMatchObject({ id: 'update-1', content: 'Status is ready for @Alice and @bob', author: 'operator', mentions: ['@Alice', '@bob'] })
    expect(changed.metadata_json[PROJECT_UPDATES_KEY].updates[0].id).toBe('update-1')
    expect(projectFingerprint(changed)).not.toBe(projectFingerprint(projects[0]))
    expect(addProjectUpdate(changed, { id: 'update-1', content: 'duplicate' }, NOW)).toBe(changed)
    expect(addProjectUpdate(projects[0], { content: '   ' }, NOW)).toBe(projects[0])
    let bounded = projects[0]
    for (let index = 0; index < 85; index += 1) bounded = addProjectUpdate(bounded, { id: `update-${index}`, content: `Update ${index}` }, new Date(NOW.getTime() + index))
    expect(getProjectUpdates(bounded)).toHaveLength(80)
    expect(getProjectUpdates(bounded)[0].id).toBe('update-84')
    expect(getProjectUpdates(bounded).at(-1)?.id).toBe('update-5')
  })


  it('integrates latest canonical human updates into the live Project report summary', () => {
    const withUpdate = addProjectUpdate(projects[0], { id: 'update-report-1', content: 'Release review with @alice', author: 'Bob', created_at: '2026-08-28T16:00:00Z' }, NOW)
    const report = buildProjectReportSummary(withUpdate, NOW)
    expect(report.latestUpdates).toHaveLength(1)
    expect(report.latestUpdates[0]).toMatchObject({ id: 'update-report-1', content: 'Release review with @alice', author: 'Bob', mentions: ['@alice'], created_at: '2026-08-28T16:00:00Z' })
  })

  it('freezes collaboration updates inside immutable report snapshots while later live updates continue independently', () => {
    const first = addProjectUpdate(projects[0], { id: 'update-frozen-1', content: 'Snapshot update for @alice', created_at: '2026-08-28T16:00:00Z' }, NOW)
    const captured = captureProjectReportSnapshot(first, new Date('2026-08-28T16:05:00Z'))
    const later = addProjectUpdate(captured, { id: 'update-live-2', content: 'Later update for @bob', created_at: '2026-08-28T17:00:00Z' }, NOW)
    const snapshot = getProjectReportHistory(later)[0]
    expect(snapshot.summary.latestUpdates.map((row: any) => row.id)).toEqual(['update-frozen-1'])
    expect(snapshot.summary.latestUpdates[0].mentions).toEqual(['@alice'])
    expect(buildProjectReportSummary(later, NOW).latestUpdates.map((row: any) => row.id)).toEqual(['update-live-2', 'update-frozen-1'])
  })

  it('normalizes malformed local Project saved views onto accepted defaults', () => {
    expect(PROJECT_SORT_MODES).toContain('order')
    expect(normalizeProjectSavedViewState({
      search: '  release  ',
      statusFilter: 'all',
      priorityFilter: 'High',
      sortMode: 'not-a-sort',
      watchedOnly: 'yes',
      view: 'not-a-view',
    })).toEqual({
      search: 'release',
      statusFilter: 'ALL',
      priorityFilter: 'High',
      sortMode: 'order',
      watchedOnly: false,
      view: 'overview',
    })
  })

  it('round-trips the local Project saved-view shape through the shared workspace definition', () => {
    const local = {
      search: 'release',
      statusFilter: 'In Progress',
      priorityFilter: 'Highest',
      sortMode: 'deadline',
      watchedOnly: true,
      view: 'reports',
    }
    const definition = projectSavedViewToWorkspaceDefinition(local)
    expect(definition).toEqual({
      searchTerm: 'release',
      filters: { status: ['In Progress'], priority: ['Highest'], watch: ['watched'] },
      activeTab: 'reports',
      mode: 'deadline',
    })
    expect(projectSavedViewFromWorkspaceDefinition(definition)).toEqual(local)
  })

  it('treats unsupported remote Project saved-view values as bounded defaults', () => {
    expect(projectSavedViewFromWorkspaceDefinition({
      searchTerm: '  portfolio  ',
      filters: { status: [], priority: ['Medium'], watch: ['unexpected'] },
      activeTab: 'unknown',
      mode: 'sideways',
    })).toEqual({
      search: 'portfolio',
      statusFilter: 'ALL',
      priorityFilter: 'Medium',
      sortMode: 'order',
      watchedOnly: false,
      view: 'overview',
    })
  })


})
