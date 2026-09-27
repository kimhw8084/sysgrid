import { test, expect, Page, Locator } from '@playwright/test'
import { PROJECTS_ROOT_PREVIEW_USER, projectsRootPreviewPolicy } from './helpers/projects-root-preview'

type Project = Record<string, any>

const projectFixture = (): Project => ({
  id: 901,
  name: 'P01 — Accessible Projects Audit',
  parent_project_id: null,
  status: 'In Progress',
  priority: 'High',
  owner: 'Proof Operator',
  objective: 'Projects cross-surface accessibility audit fixture',
  expected_outcomes: ['Every required Projects-owned interactive control has a computed accessible name'],
  start_date: '2026-09-01',
  end_date: '2026-10-01',
  metadata_json: {
    adoption_state: 'Pilot',
    project_schedule_v2: {
      working_days: [1,2,3,4,5],
      baselines: [{ id: 'base-1', name: 'Audit baseline', captured_at: '2026-09-01T00:00:00Z', tasks: [] }],
      scenarios: [{ id: 'scenario-1', name: 'Audit scenario', task_id: '9012', slip_days: 2, status: 'PROPOSED' }],
    },
    project_updates_v1: [{ id: 'u1', author: 'Proof Operator', created_at: '2026-09-01T00:00:00Z', content: 'Audit update' }],
  },
  tasks: [
    { id: 9011, name: 'Audit task A', status: 'To Do', progress: 10, owner: 'Proof Operator', priority: 'High', start_date: '2026-09-01', end_date: '2026-09-04', order_index: 10, dependencies_json: [], metadata_json: {} },
    { id: 9012, name: 'Audit task B', status: 'In Progress', progress: 55, owner: 'Proof Operator', priority: 'High', start_date: '2026-09-05', end_date: '2026-09-09', order_index: 20, dependencies_json: [9011], description: 'Audit task description', metadata_json: { subtasks: [{ id: 'check-1', name: 'Verify audit', completed: false }] } },
    { id: 9013, name: 'Audit task C', status: 'Review', progress: 80, owner: 'Partner User', priority: 'Medium', start_date: '2026-09-10', end_date: '2026-09-13', order_index: 30, dependencies_json: [], metadata_json: {} },
  ],
})

const operators = [
  { id: 1, username: 'proof_operator', full_name: 'Proof Operator', team: 'Operations', team_id: 1 },
  { id: 2, username: 'partner.user', full_name: 'Partner User', team: 'Operations', team_id: 1 },
]

const installIdentity = async (page: Page) => {
  await page.addInitScript((userId) => {
    localStorage.setItem('sysgrid-theme', 'nordic-frost-v1')
    localStorage.setItem('SYSGRID_USER_ID', userId)
  }, PROJECTS_ROOT_PREVIEW_USER)
}

const installRoutes = async (page: Page) => {
  const project = projectFixture()
  const story = { attention_count: 0, attention: [], health: { level: 'On track', reason: 'Fixture schedule is current.' }, delivery: { percent: 55, label: '55%', method: 'Canonical task progress' }, next_milestone: null, milestones: [], acceptance_criteria: [], primary_metric: null, latest_update: null, governance: [], architecture: { assessment: 'Not assessed' }, resources: [], freshness: { updated_at: '2026-09-01T00:00:00Z', source: 'accessible-audit-fixture' }, coverage: { resources: 'complete' } }
  const canonical = { id: '901', display_key: 'PRJ-901', name: project.name, objective: project.objective, owner_id: 'proof_operator', team_id: 1, phase: 'Executing', run_state: 'Active', outcome_phase: 'Planned', outcome_result: null, priority: 'High', target_date: project.end_date, parent_project_id: null, child_count: 0, updated_at: '2026-09-01T00:00:00Z', capabilities: { edit: true, view: true, transition: true }, story }
  const schedule = { project: canonical, project_id: '901', project_revision: 1, graph_revision: 1, calendar: { id: 'accessible-calendar', timezone: 'UTC', working_weekdays: [0, 1, 2, 3, 4, 5, 6], exceptions: [], revision: 1 }, tasks: project.tasks.map((task: any) => ({ id: String(task.id), title: task.name, kind: 'Task', owner_id: task.owner, parent_task_id: null, metadata_json: task.metadata_json || {}, status: task.status, progress: task.progress, order_key: String(task.order_index), start_date: task.start_date, end_date: task.end_date, point_date: null, revision: 1 })), dependencies: [], external_dependencies: [], baselines: [], baseline_variance: [], analysis: { rows: [], critical_task_ids: [], status: 'Complete' }, forecast: { tasks: [], coverage: 'complete' }, external_warnings: [], history: [] }
  const work = { project_id: '901', project_revision: 1, graph_revision: 1, items: project.tasks.map((task: any) => ({ id: String(task.id), title: task.name, owner_id: task.owner, parent_task_id: null, status: task.status === 'In Progress' ? 'In progress' : task.status, progress: task.progress, start_date: task.start_date, end_date: task.end_date, order_key: String(task.order_index), revision: 1 })), blockers: [], source_revisions: { project_revision: 1, graph_revision: 1 }, capabilities: { view: true, edit: true, transition: true } }
  await page.route('**/api/v2/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) })
    if (request.method() === 'GET' && path === '/api/v2/projects') return json({
      items: [canonical],
      summary: { Planned: 0, Active: 1, Delivered: 0, Paused: 0, Cancelled: 0, 'Needs attention': 0, Measuring: 0, Realized: 0, 'Closed below target': 0 },
      next_cursor: null,
      as_of: '2026-09-01T00:00:00Z',
      source_revision: 'accessible-audit-fixture',
      coverage: { projects: 'complete', rollups: 'complete', resources: 'complete' },
    })
    if (request.method() === 'GET' && path === '/api/v2/projects/901/schedule') return json(schedule)
    if (request.method() === 'GET' && path === '/api/v2/focus') return json({ scope: 'project', project_id: '901', items: [], total: 0, engine_version: 'pv-focus-1' })
    if (request.method() === 'GET' && path === '/api/v2/projects/901/work') return json(work)
    if (request.method() === 'GET') return json({})
    return json({})
  })
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const json = (value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) })
    if (request.method() === 'POST' && path === '/api/v1/observability/performance') return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ accepted: true }) })
    if (request.method() === 'GET' && path.endsWith('/settings/bootstrap')) return json({ VITE_API_BASE_URL: url.origin, DEFAULT_USER_ID: PROJECTS_ROOT_PREVIEW_USER })
    if (request.method() === 'GET' && path === '/api/v1/policy/module-availability') return json(projectsRootPreviewPolicy)
    if (request.method() === 'GET' && path === '/api/v1/settings/user/profile') return json({ id: PROJECTS_ROOT_PREVIEW_USER, username: PROJECTS_ROOT_PREVIEW_USER, full_name: 'Synthetic Root Preview Proof', team: 'Operations', team_id: 1, is_admin: false, permissions: {} })
    if (request.method() === 'GET' && path === '/api/v1/settings/user/settings') return json({ theme: 'nordic-frost-v1' })
    if (request.method() === 'GET' && path === '/api/v1/settings/operators') return json(operators)
    if (request.method() === 'GET' && path === '/api/v1/health') return json({ status: 'ok' })
    if (request.method() === 'GET' && path === '/api/v1/projects') return json([project])
    if (request.method() === 'GET' && path === '/api/v1/projects/901') return json(project)
    if (request.method() === 'GET' && path === '/api/v1/workspaces/projects/views') return json([])
    if (request.method() === 'GET') return json([])
    return json({})
  })
}

const collectRuntimeFailures = (page: Page) => {
  const failures: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console:${message.text()}`) })
  page.on('pageerror', (error) => failures.push(`pageerror:${error.message}`))
  page.on('requestfailed', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/observability/performance') return
    failures.push(`requestfailed:${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`)
  })
  return failures
}

const requiredControls = (root: Locator) => root.locator(':is(button,input:not([type="hidden"]),select,textarea,summary,a[href],[role="button"],[role="link"],[role="option"],[role="checkbox"],[role="combobox"],[role="textbox"])')

const expectAllRequiredControlsNamed = async (root: Locator, scope: string) => {
  const controls = requiredControls(root)
  const count = await controls.count()
  expect(count, `${scope} must render at least one required interactive control`).toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index)
    if (!(await control.isVisible())) continue
    await expect(control, `${scope} required control ${index} must have a computed accessible name`).toHaveAccessibleName(/\S/)
  }
}

const openProjects = async (page: Page, path: string) => {
  await page.goto(path)
  const workspace = page.locator('[data-workspace="projects"]')
  await expect(workspace).toBeVisible()
  return workspace
}

const auditStaticRoute = async (page: Page, path: string, label: string) => {
  const workspace = await openProjects(page, path)
  await expectAllRequiredControlsNamed(workspace, label)
}

test('OUT-40 Slice G persistent Projects surfaces have no unnamed required controls @out40-slice-g-rehearsal', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await installIdentity(page)
  await installRoutes(page)
  const routes = [
    ['/projects?view=portfolio&section=control', 'portfolio control'],
    ['/projects?view=portfolio&section=roadmap', 'portfolio roadmap'],
    ['/projects?view=portfolio&section=owners', 'portfolio owners'],
    ['/projects?id=901&view=overview', 'overview'],
    ['/projects?id=901&view=tasks', 'tasks'],
    ['/projects?id=901&view=timeline', 'timeline'],
    ['/projects?id=901&view=board', 'board'],
    ['/projects?id=901&view=files', 'files'],
    ['/projects?id=901&view=updates', 'updates'],
    ['/projects?id=901&view=reports', 'reports'],
    ['/projects?id=901&view=insights&section=review', 'insights review'],
    ['/projects?id=901&view=insights&section=governance', 'insights governance'],
  ] as const
  for (const [path, label] of routes) await auditStaticRoute(page, path, label)
})

test('OUT-40 Slice G transient Projects surfaces have no unnamed required controls @out40-slice-g-acceptance', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const failures = collectRuntimeFailures(page)
  await installIdentity(page)
  await installRoutes(page)

  await openProjects(page, '/projects/901/work')
  await page.getByRole('button', { name: 'Audit task B', exact: true }).click()
  await expectAllRequiredControlsNamed(page.locator('.p05-task-panel'), 'canonical task panel')
  await expectAllRequiredControlsNamed(page.locator('.p05-import'), 'canonical task import')

  await openProjects(page, '/projects/new')
  await expectAllRequiredControlsNamed(page.locator('[data-workspace="projects"]'), 'project creation flow')

  await openProjects(page, '/projects/901/updates')
  await expectAllRequiredControlsNamed(page.locator('[data-workspace="projects"]'), 'updates surface')

  await openProjects(page, '/projects/901/timeline')
  await page.getByRole('button', { name: 'Schedule changes', exact: true }).click()
  const scheduleDialog = page.getByRole('dialog', { name: 'Schedule changes', exact: true })
  await expect(scheduleDialog).toBeVisible()
  await expectAllRequiredControlsNamed(scheduleDialog, 'canonical schedule changes')

  await openProjects(page, '/projects/901/reports')
  await expectAllRequiredControlsNamed(page.locator('[data-workspace="projects"]'), 'reports surface')

  expect(failures).toEqual([])
})
