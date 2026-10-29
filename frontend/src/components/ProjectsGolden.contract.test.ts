import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
// SYSGRID_ALLOW_SOURCE_OWNERSHIP_ASSERTION — textual ownership is the contract under test.

const source = fs.readFileSync(path.resolve(__dirname, 'ProjectsGolden.tsx'), 'utf8')
const model = fs.readFileSync(path.resolve(__dirname, 'ProjectsGolden.model.ts'), 'utf8')

describe('Projects complete planning and execution golden contract', () => {
  it('keeps Projects on the shared hybrid workspace shell while adding one unified workbench shell', () => {
    expect(source).toContain('<OperationalWorkspaceShell')
    expect(source).toContain('archetype="hybrid"')
    expect(source).toContain('workspace="projects"')
    expect(source).toContain('data-project-unified-shell="true"')
    expect(source).toContain('data-project-workbench-rail="true"')
    expect(source).toContain('data-project-workbench-header="true"')
    expect(source).toContain('data-project-primary-nav="true"')
  })

  it('owns the eight member-first project views plus a separate portfolio utility surface', () => {
    for (const view of ['overview', 'tasks', 'timeline', 'board', 'files', 'updates', 'reports', 'insights']) expect(source).toContain(`value: '${view}'`)
    expect(model).toContain("PROJECT_GOLDEN_VIEWS = ['overview', 'tasks', 'timeline', 'board', 'files', 'updates', 'reports', 'insights', 'portfolio']")
    expect(source).toContain('data-project-portfolio-hub="true"')
    expect(source).not.toContain('AgGridReact')
  })

  it('preserves legacy project deep links but canonicalizes them into the new workbench hierarchy', () => {
    expect(model).toContain("workspace: 'timeline'")
    expect(model).toContain("roadmap: 'portfolio'")
    expect(model).toContain("owners: 'portfolio'")
    expect(model).toContain("review: 'insights'")
    expect(model).toContain("governance: 'insights'")
    expect(source).toContain("next.set('section', rawView)")
  })

  it('makes Overview, Tasks, Timeline, Updates, Reports and task context first-class useful surfaces', () => {
    expect(source).toContain('data-project-overview="true"')
    expect(source).toContain('data-project-tasks-foundation="true"')
    expect(source).toContain('data-project-report-preview="true"')
    expect(source).toContain('data-project-task-drawer="true"')
    expect(source).toContain('<ProjectTimeline project={selectedProject}')
    expect(source).toContain('data-project-flagship-gantt="true"')
    expect(source).toContain('data-project-updates-native="true"')
  })

  it('removes the legacy embedded Project host after Updates becomes a native collaboration surface', () => {
    expect(source).not.toContain('function LegacyEmbeddedHost')
    expect(source).not.toContain('<LegacyProjects')
    expect(source).not.toContain('data-project-embedded-host="true"')
    expect(source).not.toContain("view === 'updates' ? <LegacyEmbeddedHost")
    expect(source).toContain("view === 'updates' ? <ProjectUpdatesFoundation")
    expect(source).toContain("view === 'timeline' ? <ProjectTimeline")
    expect(source).not.toContain(':nth-child(')
  })

  it('restores working context from URL plus the migrated local workbench state', () => {
    expect(source).toContain("STORAGE_KEY = 'sysgrid_projects_workbench_v1'")
    expect(source).toContain("LEGACY_STORAGE_KEY = 'sysgrid_projects_execution_intelligence_v1'")
    expect(source).toContain("searchParams.get('view')")
    expect(source).toContain("searchParams.get('id')")
    expect(source).toContain("searchParams.get('task')")
    expect(source).toContain('lastProjectId: selectedProjectId')
    expect(source).toContain('lastView: view')
    expect(source).toContain('recentIds')
  })

  it('keeps one optimistic stale-safe Project PUT mutation path for task, governance and workbench edits', () => {
    expect(source).toContain("apiFetch(`/api/v1/projects/${nextProject.id}`")
    expect(source).toContain("method: 'PUT'")
    expect(source).toContain("queryClient.setQueryData(['projects']")
    expect(source).toContain('Project changed since this view loaded')
    expect(source).toContain('projectFingerprint(nextProject) === projectFingerprint(current)')
    expect(source).not.toContain('/api/v2/')
  })

  it('replaces raw dependency-id authoring with human-readable predecessor selection', () => {
    expect(source).toContain('Choose a predecessor by task name…')
    expect(source).toContain('aria-label="Dependency task"')
    expect(source).not.toContain('Dependencies · task IDs')
  })

  it('derives Overview and Reports from existing canonical execution/governance truth', () => {
    for (const marker of ['buildProjectOverview', 'buildProjectReportSummary', 'getProjectExecutionProgress', 'getProjectHealth', 'getProjectForecast', 'getEvidenceReadiness']) expect(model).toContain(marker)
    expect(source).toContain('Live Project Report')
    expect(source).toContain('Next actions')
    expect(source).toContain('Needs attention')
  })

  it('preserves accepted execution, roadmap, owner, review and governance intelligence behind the member workflow', () => {
    expect(source).toContain('Attention Queue 2.0')
    expect(source).toContain('data-project-execution-board="true"')
    expect(source).toContain('data-project-roadmap="true"')
    expect(source).toContain('data-project-owner-cockpit="true"')
    expect(source).toContain('data-project-review-mode="true"')
    expect(source).toContain('data-project-governance="true"')
    expect(source).toContain('data-project-forecast="true"')
    expect(source).toContain('data-project-stage-gates="true"')
    expect(source).toContain('data-project-change-intelligence="true"')
  })

  it('preserves deterministic governance/forecasting and existing Project metadata ownership', () => {
    expect(model).toContain("PROJECT_GOVERNANCE_KEY = 'project_governance_v1'")
    expect(model).toContain('simulateProjectScenario')
    expect(model).toContain('forecastFinishOrdinal')
    expect(model).toContain('captureProjectReviewSnapshot')
    expect(model).toContain('.slice(0, 24)')
    expect(source).not.toContain('ai_score')
    expect(source).not.toContain('forecast_score')
    expect(source).not.toContain('/api/v1/project-governance')
    expect(source).not.toContain('/api/v1/project-forecast')
  })

  it('promotes Tasks into a high-speed inline workbench instead of a read-only foundation list', () => {
    expect(source).toContain('data-project-task-workbench="true"')
    expect(source).toContain('Inline authoring · WBS hierarchy · bulk operations')
    for (const marker of ['Task name ${task.id}', 'Owner ${task.id}', 'Start date ${task.id}', 'Finish date ${task.id}', 'Status ${task.id}', 'Progress ${task.id}', 'Priority ${task.id}']) expect(source).toContain(marker)
    expect(source).toContain('Type a task and press Enter…')
    expect(source).toContain('Enter creates another row · Tab moves through fields')
  })

  it('owns WBS hierarchy, collapse, indent/outdent and subtree reorder through the canonical task model', () => {
    for (const marker of ['buildProjectTaskHierarchy', 'getProjectTaskParentId', 'getProjectTaskDescendantIds', 'setProjectTaskParent', 'indentProjectTask', 'outdentProjectTask', 'reorderProjectTaskBefore']) expect(model).toContain(marker)
    expect(source).toContain('data-task-depth={String(row.depth)}')
    expect(source).toContain('Reorder ${task.name}')
    expect(source).toContain('Indent ${task.name}')
    expect(source).toContain('Outdent ${task.name}')
  })

  it('adds spreadsheet paste, multi-select and bounded bulk task operations without a second task store', () => {
    expect(source).toContain('data-project-task-paste="true"')
    expect(source).toContain('data-project-task-bulkbar="true"')
    expect(source).toContain('Paste rows from Excel / Sheets')
    expect(model).toContain('parseProjectTaskPaste')
    expect(model).toContain('bulkUpdateProjectTasks')
    expect(source).toContain('Select visible tasks')
    expect(source).toContain('Shift days')
    expect(source).toContain('Milestone')
  })

  it('makes the persistent task drawer directly editable and preserves deep task context', () => {
    expect(source).toContain('data-project-task-drawer-editable="true"')
    expect(source).toContain('data-project-task-checklist="true"')
    expect(source).toContain('data-project-task-dependencies="true"')
    expect(source).toContain('Choose predecessor by task name…')
    expect(source).toContain('autosaves on blur')
    expect(source).toContain('WBS parent')
    expect(source).toContain('Comments & project material')
    expect(source).toContain('Recent task activity')
  })

  it('serializes rapid authoritative Project writes and provides bounded undo/redo history', () => {
    expect(source).toContain("scope: { id: 'projects-authoritative-write' }")
    expect(source).toContain('taskHistory')
    expect(source).toContain(".slice(-40)")
    expect(source).toContain('Task workbench undo')
    expect(source).toContain('Task workbench redo')
    expect(source).toContain('structuredClone(selectedProject.tasks || [])')
  })

  it('extends stale-write fingerprints to hierarchy, ordering, descriptions and task metadata', () => {
    expect(model).toContain('description: task?.description')
    expect(model).toContain('order_index: task?.order_index')
    expect(model).toContain('metadata_json: task?.metadata_json')
    expect(model).toContain('metadata_json: project?.metadata_json || null')
  })

  it('keeps direct inline edits canonical for completed and reopened progress semantics', () => {
    expect(model).toContain("if (next.status === 'Completed') next.progress = 100")
    expect(model).toContain("task?.status === 'Completed'")
    expect(model).toContain('Math.min(99')
  })

  it('does not introduce a task-workbench backend schema or alternate Project API family', () => {
    expect(source).not.toContain('/api/v1/project-tasks')
    expect(source).not.toContain('/api/v2/projects')
    expect(model).toContain('wbs_parent_id')
    expect(model).toContain('is_milestone')
  })

  it('owns a first-class synchronized flagship Timeline with direct schedule manipulation and four zoom levels', () => {
    expect(model).toContain("PROJECT_TIMELINE_ZOOMS = ['day', 'week', 'month', 'quarter']")
    expect(source).toContain('data-project-flagship-gantt="true"')
    expect(source).toContain('Task table + schedule canvas · baseline · forecast · critical path · dependencies')
    for (const marker of ['buildProjectTimelineRows', 'getProjectTimelineRange', 'shiftProjectTaskSchedules', 'resizeProjectTaskSchedule', 'scheduleProjectTask']) expect(model).toContain(marker)
    expect(source).toContain('data-project-timeline-bar="true"')
    expect(source).toContain('Resize start ${row.task.name}')
    expect(source).toContain('Resize end ${row.task.name}')
    expect(source).toContain('Fit Project')
    expect(source).toContain('Critical only')
  })

  it('renders baseline, deterministic forecast, milestones and critical path from canonical task truth', () => {
    expect(model).toContain('captureProjectScheduleBaseline')
    expect(model).toContain('baseline_start_date')
    expect(model).toContain('baseline_end_date')
    expect(model).toContain('getProjectForecast(project, now)')
    expect(model).toContain('critical: critical.has(task.id)')
    expect(model).toContain("taskMetadata(task).milestone === true")
    expect(source).toContain('Capture baseline')
    expect(source).toContain('Baseline ${projectOrdinalToDate(row.baselineStartOrdinal)}')
    expect(source).toContain('Forecast ${projectOrdinalToDate(row.forecastStartOrdinal)}')
  })

  it('owns visual dependency creation/removal with self-link and cycle rejection', () => {
    for (const marker of ['getProjectTaskDependencyIds', 'wouldCreateProjectTaskDependencyCycle', 'setProjectTaskDependency']) expect(model).toContain(marker)
    expect(source).toContain('data-project-dependency-handle="true"')
    expect(source).toContain("setProjectTaskDependency(project, targetId, sourceId, true)")
    expect(source).toContain("setProjectTaskDependency(project, link.row.id, link.depId, false)")
    expect(model).toContain('target == predecessor')
  })

  it('uses an explicit Board drag handle instead of native HTML5 drag/drop', () => {
    expect(source).toContain('const pointerDragRef = useRef')
    expect(source).toContain('beginBoardPointerDrag')
    expect(source).toContain('moveBoardPointerDrag')
    expect(source).toContain('finishBoardPointerDrag')
    expect(source).toContain('cancelBoardPointerDrag')
    expect(source).toContain('boardStatusAtPoint')
    expect(source).toContain('document.elementFromPoint(clientX, clientY)')
    expect(source).toContain('onPointerDown={(event) => beginBoardPointerDrag(task.id, event)}')
    expect(source).toContain('onPointerMove={moveBoardPointerDrag}')
    expect(source).toContain('onPointerUp={(event) => finishBoardPointerDrag(task, event)}')
    expect(source).toContain('title={`Drag ${task.name} to another status`} onPointerDown')
    expect(source).not.toContain('data-project-board-card="true" data-task-id={String(task.id)} draggable')
    expect(source).not.toContain('onDrop={(event) =>')
  })

  it('keeps Board status controls responsive while unrelated serialized Project writes are pending', () => {
    expect(source).toContain('disabled={statusIndex === 0}')
    expect(source).toContain('disabled={statusIndex === PROJECT_TASK_STATUSES.length - 1}')
    expect(source).not.toContain('disabled={statusIndex === 0 || isSaving}')
    expect(source).not.toContain('disabled={statusIndex === PROJECT_TASK_STATUSES.length - 1 || isSaving}')
  })

  it('rebases rapid Board and My Work task actions on the latest optimistic Project write head', () => {
    expect(source).toContain("queryClient.getQueryData<any[]>(['projects'])")
    expect(source).toContain('getProjectWriteHead(selectedProject.id) || selectedProject')
    expect(source).toContain("commitTaskProject(moved, 'Task status changed'")
    expect(source).toContain('true, current)')
    expect(source).toContain('getProjectWriteHead(projectId)')
  })

  it('upgrades Board into the same execution system with persisted WIP controls and milestone swimlanes', () => {
    expect(model).toContain("PROJECT_SWIMLANES = ['none', 'owner', 'priority', 'milestone', 'criticality']")
    expect(model).toContain("PROJECT_EXECUTION_CONFIG_KEY = 'project_execution_config_v1'")
    expect(model).toContain('getProjectWipLimits')
    expect(model).toContain('setProjectWipLimit')
    expect(source).toContain('data-project-wip-controls="true"')
    expect(source).toContain('Decrease ${status} WIP')
    expect(source).toContain('Increase ${status} WIP')
    expect(source).toContain("swimlane === 'milestone'")
    expect(source).toContain('Board status, Tasks, Timeline and My Work share the same authoritative task truth.')
  })

  it('adds cross-project My Work and deterministic Needs Update as daily execution surfaces', () => {
    expect(model).toContain('getProjectNeedsUpdate')
    expect(model).toContain("'Needs update'")
    expect(source).toContain('data-project-my-work-execution="true"')
    expect(source).toContain('Cross-project execution · update work without project hopping')
    expect(source).toContain('Needs Update ${needs.length}')
    expect(source).toContain('data-project-execution-hub="true"')
    expect(source).toContain("{ value: 'my-work', label: 'My Work' }")
  })

  it('keeps planning and execution on the existing Project contract without a new schedule or board API', () => {
    expect(source).not.toContain('/api/v1/project-timeline')
    expect(source).not.toContain('/api/v1/project-board')
    expect(source).not.toContain('/api/v1/my-work')
    expect(source).not.toContain('/api/v2/projects')
    expect(source).toContain("scope: { id: 'projects-authoritative-write' }")
    expect(model).toContain('metadata_json: project?.metadata_json || null')
  })

  it('adds Iteration 4A collaboration authoring on canonical task and project metadata', () => {
    expect(model).toContain("PROJECT_REPORTING_KEY = 'project_reporting_v1'")
    for (const marker of ['extractProjectMentions', 'addProjectTaskComment', 'addProjectMaterial']) expect(model).toContain(marker)
    expect(source).toContain('data-project-collaboration-authoring="true"')
    expect(source).toContain('aria-label="Add task comment"')
    expect(source).toContain('Post comment')
    expect(source).toContain('data-project-material-authoring="true"')
    expect(source).toContain('Add project material')
    expect(source).toContain('Canonical Project PUT')
  })

  it('adds immutable report snapshots and stable report deep-link authoring without a report API family', () => {
    for (const marker of ['captureProjectReportSnapshot', 'getProjectReportHistory', 'getProjectReportSharePath']) expect(model).toContain(marker)
    expect(source).toContain('data-project-report-history="true"')
    expect(source).toContain('Capture snapshot')
    expect(source).toContain('Copy share link')
    expect(source).toContain("searchParams.get('report')")
    expect(source).toContain("next.set('view', 'reports')")
    expect(source).not.toContain('/api/v1/project-comments')
    expect(source).not.toContain('/api/v1/project-files')
    expect(source).not.toContain('/api/v1/project-reports')
  })

  it('keeps PC59 planning and execution ownership intact while Iteration 4A stays additive', () => {
    expect(source).toContain('data-project-flagship-gantt="true"')
    expect(source).toContain('data-project-board-card="true"')
    expect(source).toContain('data-project-my-work-execution="true"')
    expect(source).toContain("scope: { id: 'projects-authoritative-write' }")
    expect(model).toContain("PROJECT_EXECUTION_CONFIG_KEY = 'project_execution_config_v1'")
  })

  it('adds Iteration 4B authoritative operator-backed mention autocomplete without a notification API', () => {
    for (const marker of ['getProjectMentionCandidates', 'getProjectMentionQuery', 'applyProjectMentionCandidate']) expect(model).toContain(marker)
    expect(source).toContain("useSafeListQuery('operators', '/api/v1/settings/operators')")
    expect(source).toContain('data-project-mention-autocomplete="true"')
    expect(source).toContain('data-project-mention-suggestions="true"')
    expect(source).toContain('aria-label="Mention suggestions"')
    expect(source).toContain('aria-label={`Mention ${candidate.mention} · ${candidate.label}`}')
    expect(source).not.toContain('/api/v1/project-mentions')
    expect(source).not.toContain('/api/v1/project-notifications')
  })

  it('keeps mention selection canonical and additive to the accepted PC60 comment persistence path', () => {
    expect(source).toContain('const chooseMention = (candidate: any)')
    expect(source).toContain('applyProjectMentionCandidate(commentText, candidate.username)')
    expect(source).toContain("commit(next, 'Task comment added'")
    expect(model).toContain('mentions: extractProjectMentions(content)')
    expect(source).toContain("scope: { id: 'projects-authoritative-write' }")
    expect(source).toContain('data-project-report-history="true"')
    expect(source).toContain('data-project-material-authoring="true"')
  })

  it('adds Iteration 4C native project-level update authoring on canonical Project metadata', () => {
    for (const marker of ['PROJECT_UPDATES_KEY', 'getProjectUpdates', 'addProjectUpdate']) expect(model).toContain(marker)
    expect(source).toContain('data-project-updates-native="true"')
    expect(source).toContain('data-project-update-authoring="true"')
    expect(source).toContain('aria-label="Add project update"')
    expect(source).toContain('Post update')
    expect(source).toContain("onProjectChange(next, 'Project update posted'")
    expect(source).toContain("scope: { id: 'projects-authoritative-write' }")
  })

  it('reuses authoritative operator mentions for project updates while keeping system activity read-only', () => {
    expect(source).toContain("useSafeListQuery('operators', '/api/v1/settings/operators')")
    expect(source).toContain('data-project-update-mention-suggestions="true"')
    expect(source).toContain('aria-label="Project update mention suggestions"')
    expect(source).toContain('applyProjectMentionCandidate(updateText, candidate.username)')
    expect(source).toContain('data-project-system-activity="true"')
    expect(source).toContain('Read-only audit generated by Project actions')
    expect(source).not.toContain('/api/v1/project-updates')
    expect(source).not.toContain('/api/v1/project-activity')
  })

  it('keeps accepted PC60/PC61 collaboration and reporting semantics intact while replacing only the Updates host', () => {
    expect(source).toContain('data-project-collaboration-authoring="true"')
    expect(source).toContain('data-project-mention-autocomplete="true"')
    expect(source).toContain('data-project-material-authoring="true"')
    expect(source).toContain('data-project-report-history="true"')
    expect(source).toContain('data-project-flagship-gantt="true"')
    expect(source).toContain('data-project-board-card="true"')
  })


  it('integrates canonical collaboration updates into live and immutable Project report summaries', () => {
    expect(model).toContain('latestUpdates: getProjectUpdates(project).slice(0, 6)')
    expect(model).toContain('mentions: Array.isArray(update?.mentions) ? [...update.mentions] : []')
    expect(source).toContain('data-project-report-collaboration="true"')
    expect(source).toContain("const reportUpdates = Array.isArray(report?.latestUpdates) ? report.latestUpdates : []")
    expect(source).toContain("selectedSnapshot ? 'Frozen with this report snapshot' : 'Live canonical Project collaboration'")
    expect(source).not.toContain('/api/v1/project-report-updates')
  })

  it('keeps report collaboration read-only and preserves canonical Project PUT ownership', () => {
    expect(source).toContain('data-project-report-update={String(update.id || index)}')
    expect(source).toContain("scope: { id: 'projects-authoritative-write' }")
    expect(source).toContain('data-project-updates-native="true"')
    expect(source).toContain('data-project-report-history="true"')
  })



  it('reconciles the externally published Iteration 4D integration before terminal certification', () => {
    expect(model).toContain('latestUpdates: getProjectUpdates(project).slice(0, 6)')
    expect(source).toContain('data-project-report-collaboration="true"')
    expect(source).toContain("selectedSnapshot ? 'Frozen with this report snapshot' : 'Live canonical Project collaboration'")
    expect(source).toContain("scope: { id: 'projects-authoritative-write' }")
  })


})
