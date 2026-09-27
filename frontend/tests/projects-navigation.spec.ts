import { test, expect, Page } from '@playwright/test'
import { PROJECTS_ROOT_PREVIEW_USER, projectsRootPreviewPolicy } from './helpers/projects-root-preview'

type Project = Record<string, any>
const task = (id: number, name: string, status = 'In Progress') => ({
  id, name, status, progress: status === 'Completed' ? 100 : 55, owner: 'Proof Operator', priority: 'High',
  start_date: '2026-09-01', end_date: '2026-09-08', order_index: id * 10, dependencies_json: [], metadata_json: {},
})
const makeProject = (id: number, code: string, name: string, status = 'In Progress'): Project => ({
  id, name: `${code} — ${name}`, parent_project_id: null, status, priority: 'High', owner: 'Proof Operator',
  objective: `${name} independently valuable outcome`, expected_outcomes: [`${name} accepted`], start_date: '2026-09-01', end_date: '2026-10-01',
  man_hours_saved: id === 901 ? 420 : 0, wafers_gained: id === 909 ? 32 : 0,
  metadata_json: { adoption_state: id === 909 ? 'Scaling' : 'Pilot' },
  tasks: [task(id * 10 + 1, `${name} task A`, 'Completed'), task(id * 10 + 2, `${name} task B`)],
})

const projects = [
  makeProject(901, 'P01', 'Yield Guardian'),
  makeProject(902, 'P02', 'Recipe Release Guardrail', 'Blocked'),
  makeProject(909, 'P09', 'Operator Adoption Loop'),
]

const installRoutes = async (page: Page) => {
  await page.route('**/api/v2/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname
    const json = (value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) })
    if (request.method() === 'GET' && path === '/api/v2/projects') return json({
      items: projects.map((project, index) => ({ id: String(project.id), display_key: `PRJ-${project.id}`, name: project.name, objective: project.objective, owner_id: 'proof_operator', team_id: 1, phase: project.status === 'Blocked' ? 'Executing' : 'Planning', run_state: 'Active', outcome_phase: 'Planned', outcome_result: 'Unassessed', priority: project.priority, architecture_assessment: 'Not assessed', target_date: project.end_date, parent_project_id: null, child_count: 0, updated_at: '2026-09-01T00:00:00Z', revision: 1, graph_revision: 1, capabilities: { edit: true }, story: { attention_count: project.status === 'Blocked' ? 1 : 0, attention: project.status === 'Blocked' ? [{ id: `attention-${index}`, kind: 'Blocker', reason: 'Fixture blocker', accountable: 'Proof Operator', action: 'Open work' }] : [], health: { level: project.status === 'Blocked' ? 'At risk' : 'On track', reason: 'Navigation fixture' }, delivery: { percent: 50, label: '50%', method: 'Canonical task progress' }, next_milestone: null, milestones: [], acceptance_criteria: [], primary_metric: null, latest_update: null, governance: [], architecture: { assessment: 'Not assessed' }, resources: [], freshness: { updated_at: '2026-09-01T00:00:00Z', source: 'navigation-fixture' }, coverage: { resources: 'complete' } } })),
      summary: { Planned: 2, Active: 1, Delivered: 0, Paused: 0, Cancelled: 0, 'Needs attention': 1, Measuring: 0, Realized: 0, 'Closed below target': 0 }, as_of: '2026-09-01T00:00:00Z', source_revision: 'navigation-fixture', coverage: { projects: 'complete', rollups: 'complete', resources: 'complete' }, next_cursor: null,
    })
    const story = (source: Project) => ({ health: { level: source.status === 'Blocked' ? 'At risk' : 'On track', reason: 'Navigation fixture' }, delivery: { percent: 50, label: '50%', method: 'Canonical task progress' }, next_milestone: null, milestones: [], attention: source.status === 'Blocked' ? [{ id: 'attention', kind: 'Blocker', reason: 'Fixture blocker', accountable: 'Proof Operator', action: 'Open work' }] : [], attention_count: source.status === 'Blocked' ? 1 : 0, acceptance_criteria: [], primary_metric: null, latest_update: null, governance: [], architecture: { assessment: 'Not assessed', rationale: null }, resources: [], freshness: { updated_at: '2026-09-01T00:00:00Z', source: 'navigation-fixture' }, coverage: { resources: 'complete' } })
    const canonicalProject = (source: Project) => ({ id: String(source.id), display_key: 'PRJ-' + source.id, tenant_id: 1, name: source.name, objective: source.objective, problem: 'Navigation fixture', in_scope: 'Canonical route proof', out_of_scope: 'Feature implementation', team_id: 1, owner_id: 'proof_operator', phase: source.status === 'Blocked' ? 'Executing' : 'Planning', run_state: 'Active', priority: source.priority, architecture_assessment: 'Not assessed', architecture_rationale: null, start_date: source.start_date, target_date: source.end_date, timezone: 'UTC', visibility: 'Team', outcome_phase: source.id === 901 || source.id === 909 ? 'Pilot' : 'Planned', outcome_result: 'Unassessed', revision: 1, graph_revision: 1, capabilities: { view: true, edit: true, export: true, transition: true, manage_people: true }, story: story(source), created_by: 'proof_operator', updated_by: 'proof_operator' })
    const summary = path.match(/^\/api\/v2\/projects\/(\d+)\/summary$/)
    if (request.method() === 'GET' && summary) { const source = projects.find((item) => String(item.id) === summary[1])!; return json({ project: canonicalProject(source), story: story(source), capabilities: canonicalProject(source).capabilities, as_of: '2026-09-01T00:00:00Z', coverage: { projects: 'complete' } }) }
    const canonical = path.match(/^\/api\/v2\/projects\/(\d+)$/)
    if (request.method() === 'GET' && canonical) { const source = projects.find((item) => String(item.id) === canonical[1])!; return json(canonicalProject(source)) }
    const readiness = path.match(/^\/api\/v2\/projects\/(\d+)\/readiness/)
    if (request.method() === 'GET' && readiness) return json({ project_id: readiness[1], from_phase: 'Planning', to_phase: 'Ready', ready: true, gaps: [], project_revision: 1, as_of: '2026-09-01T00:00:00Z' })
    const schedule = path.match(/^\/api\/v2\/projects\/(\d+)\/schedule$/)
    if (request.method() === 'GET' && schedule) { const source = projects.find((item) => String(item.id) === schedule[1])!; return json({ project_id: schedule[1], project: canonicalProject(source), project_revision: 1, graph_revision: 1, calendar: { id: 'calendar', timezone: 'UTC', working_weekdays: [0, 1, 2, 3, 4, 5, 6], exceptions: [], revision: 1 }, tasks: source.tasks.map((item: any) => ({ id: String(item.id), title: item.name, kind: 'Task', status: item.status === 'Completed' ? 'Done' : 'In progress', progress: item.progress, start_date: item.start_date, end_date: item.end_date, revision: 1 })), dependencies: [], external_dependencies: [], baselines: [], baseline_variance: [], analysis: { rows: [], critical_task_ids: [], status: 'Complete' }, forecast: { rows: [], coverage: 'complete' }, external_warnings: [], history: [], as_of: '2026-09-01T00:00:00Z' }) }
    if (request.method() === 'GET' && path === '/api/v2/focus') return json({ scope: 'project', engine_version: 'pv-focus-1', total: 0, items: [], all_priorities: [] })
    const work = path.match(/^\/api\/v2\/projects\/(\d+)\/work$/)
    if (request.method() === 'GET' && work) {
      const project = projects.find((item) => String(item.id) === work[1])!
      return json({ project_id: work[1], project_revision: 1, graph_revision: 1, items: project.tasks.map((item: any, index: number) => ({ id: String(item.id), title: item.name, kind: 'Task', parent_task_id: null, order_key: String((index + 1) * 1024), owner_id: 'proof_operator', status: item.status === 'Completed' ? 'Done' : item.status === 'In Progress' ? 'In progress' : item.status, progress: item.progress, revision: 1, start_date: item.start_date, end_date: item.end_date })), blockers: [] })
    }
    const plan = path.match(/^\/api\/v2\/projects\/(\d+)\/plan$/)
    if (request.method() === 'GET' && plan) {
      const project = projects.find((item) => String(item.id) === plan[1])!
      return json({ brief: { problem: 'Navigation fixture', objective: project.objective, in_scope: 'Canonical route proof', out_of_scope: 'Feature implementation', delivery_acceptance: [] }, milestones: [], work_breakdown: [], architecture: { assessment: 'Not assessed' }, governance: [], resources: [], guidance: [] })
    }
    if (request.method() === 'GET') return json({})
    return json({ status: 'applied' })
  })
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname
    if (request.method() === 'GET' && path.endsWith('/settings/bootstrap')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ VITE_API_BASE_URL: url.origin, DEFAULT_USER_ID: PROJECTS_ROOT_PREVIEW_USER }) })
    if (request.method() === 'GET' && path === '/api/v1/policy/module-availability') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projectsRootPreviewPolicy) })
    if (request.method() === 'GET' && path === '/api/v1/settings/user/profile') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: PROJECTS_ROOT_PREVIEW_USER, username: PROJECTS_ROOT_PREVIEW_USER, full_name: 'Synthetic Root Preview Proof', is_admin: false, permissions: {} }) })
    if (request.method() === 'GET' && path === '/api/v1/settings/user/settings') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ theme: 'nordic-frost-v1' }) })
    if (request.method() === 'GET' && path === '/api/v1/health') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) })
    if (request.method() === 'GET' && path === '/api/v1/projects') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projects) })
    if (request.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    if (request.method() === 'PUT' && path.startsWith('/api/v1/projects/')) {
      const body = request.postDataJSON?.() || {}
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((userId) => {
    localStorage.setItem('sysgrid-theme', 'nordic-frost-v1')
    localStorage.setItem('SYSGRID_USER_ID', userId)
  }, PROJECTS_ROOT_PREVIEW_USER)
  await installRoutes(page)
})

const expectIntentNav = async (page: Page) => {
  const primary = page.getByRole('navigation', { name: 'Project primary navigation' })
  await expect(primary).toBeVisible()
  for (const label of ['Home', 'Work', 'Plan', 'Timeline', 'Updates', 'Outcomes']) await expect(primary.getByRole('link', { name: label, exact: true })).toBeVisible()
  await expect(primary.getByRole('link')).toHaveCount(6)
}

test('P01 central-navigation rehearsal exposes six intents and persistent context @navigation-rehearsal', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects?id=901&view=overview')
  await expect(page).toHaveURL('/projects/901/home')
  await expect(page.locator('[data-p04-project-home="true"]')).toContainText('P01 — Yield Guardian')
  await expect(page.locator('[data-p04-project-home="true"]')).toContainText('independently valuable outcome')
  await expect(page.locator('[data-p04-project-home="true"]')).toContainText('Pilot')
  await expectIntentNav(page)
})

test('P01 Work deep link opens the canonical task graph and Board projection @navigation-acceptance', async ({ page }) => {
  await page.goto('/projects?id=901&view=overview')
  const primary = page.getByRole('navigation', { name: 'Project primary navigation' })
  await primary.getByRole('link', { name: 'Work', exact: true }).click()
  await expect(page).toHaveURL(/\/projects\/901\/work\?layout=list$/)
  await expect(page.getByRole('treegrid', { name: 'Project work breakdown' })).toBeVisible()
  await page.getByRole('link', { name: 'Board', exact: true }).click()
  await expect(page).toHaveURL(/\/projects\/901\/work\?layout=board/)
  await expect(page.getByLabel('Move Yield Guardian task B to')).toBeVisible()
})

test('P02 fixed project navigation exposes canonical Plan, Timeline, Updates and Outcomes deep links @navigation-acceptance', async ({ page }) => {
  await page.goto('/projects?id=902&view=overview')
  const primary = page.getByRole('navigation', { name: 'Project primary navigation' })
  await expect(primary.getByRole('link', { name: 'Plan', exact: true })).toHaveAttribute('href', '/projects/902/plan?section=brief')
  await expect(primary.getByRole('link', { name: 'Timeline', exact: true })).toHaveAttribute('href', '/projects/902/timeline')
  await expect(primary.getByRole('link', { name: 'Updates', exact: true })).toHaveAttribute('href', '/projects/902/updates?section=updates')
  await expect(primary.getByRole('link', { name: 'Outcomes', exact: true })).toHaveAttribute('href', '/projects/902/outcomes?section=summary')
  await primary.getByRole('link', { name: 'Plan', exact: true }).click(); await expect(page).toHaveURL(/\/projects\/902\/plan\?section=brief$/); await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible()
  await page.goto('/projects?id=902&view=timeline'); await expect(page.locator('[data-project-flagship-gantt="true"]')).toBeVisible()
})

test('P09 Outcomes reveals Reports and Insights and legacy governance link canonicalizes @navigation-acceptance', async ({ page }) => {
  await page.goto('/projects?id=909&view=overview')
  const primary = page.getByRole('navigation', { name: 'Project primary navigation' })
  await expect(primary.getByRole('link', { name: 'Outcomes', exact: true })).toHaveAttribute('href', '/projects/909/outcomes?section=summary')
  await page.goto('/projects?id=909&view=governance')
  await expect(page).toHaveURL('/projects/909/plan?section=risks')
  await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible()
})

test('all retained project view aliases history-replace to canonical destinations @navigation-acceptance', async ({ page }) => {
  const aliases = [
    ['tasks', '/projects/901/work?layout=list'],
    ['board', '/projects/901/work?layout=board'],
    ['timeline', '/projects/901/timeline'],
    ['files', '/projects/901/plan?section=resources'],
    ['updates', '/projects/901/updates?section=updates'],
    ['reports', '/projects/901/updates?section=reports'],
    ['insights&section=review', '/projects/901/plan?section=risks'],
  ] as const
  for (const [legacyQuery, canonicalPath] of aliases) {
    await page.goto(`/projects?id=901&view=${legacyQuery}`)
    await expect(page).toHaveURL(canonicalPath)
  }
})

test('central Add/edit and intent navigation reuse existing project flows @navigation-acceptance', async ({ page }) => {
  await page.goto('/projects?id=901&view=overview')
  const primary = page.getByRole('navigation', { name: 'Project primary navigation' })
  await primary.getByRole('link', { name: 'Updates', exact: true }).click(); await expect(page).toHaveURL(/\/projects\/901\/updates\?section=updates$/)
  await page.goto('/projects?id=901&view=overview')
  const homePrimary = page.getByRole('navigation', { name: 'Project primary navigation' })
  await expect(homePrimary.getByRole('link', { name: 'Timeline', exact: true })).toHaveAttribute('href', '/projects/901/timeline')
  await page.goto('/projects?id=901&view=timeline'); await expect(page.locator('[data-project-flagship-gantt="true"]')).toBeVisible()
})

test('Portfolio remains a separate cross-project utility @navigation-acceptance', async ({ page }) => {
  await page.goto('/projects?view=portfolio&section=control')
  await expect(page.locator('[data-p04-portfolio="true"]')).toBeVisible()
  await expect(page.locator('[data-project-workbench-header="true"]')).toHaveCount(0)
  await expect(page.locator('[data-project-primary-nav="true"]')).toHaveCount(0)
})
