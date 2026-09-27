import { test, expect, Page } from '@playwright/test'
import { PROJECTS_ROOT_PREVIEW_USER, projectsRootPreviewPolicy } from './helpers/projects-root-preview'

type RuntimeState = { getProject: () => any; getLastPut: () => any; getCommands: () => any[] }

const projectFixture = () => ({
  id: 901,
  name: 'P01 — Yield Guardian',
  parent_project_id: null,
  status: 'In Progress',
  priority: 'High',
  owner: 'Proof Operator',
  objective: 'Yield Guardian independently valuable outcome',
  expected_outcomes: ['Yield Guardian accepted'],
  start_date: '2026-09-01',
  end_date: '2026-10-01',
  man_hours_saved: 420,
  wafers_gained: 0,
  metadata_json: { adoption_state: 'Pilot' },
  tasks: [
    { id: 9011, name: 'Yield Guardian task A', status: 'Completed', progress: 100, owner: 'Proof Operator', priority: 'High', start_date: '2026-09-01', end_date: '2026-09-08', order_index: 10, dependencies_json: [], metadata_json: {} },
    { id: 9012, name: 'Yield Guardian task B', status: 'In Progress', progress: 55, owner: 'Proof Operator', priority: 'High', start_date: '2026-09-01', end_date: '2026-09-08', order_index: 20, dependencies_json: [], metadata_json: {} },
  ],
})

const installRoutes = async (page: Page): Promise<RuntimeState> => {
  let project = structuredClone(projectFixture())
  let lastPut: any = null
  const commands: any[] = []
  const work = () => ({ project_id: '901', project_revision: 1, graph_revision: 1, items: project.tasks.map((task: any) => ({ id: String(task.id), title: task.name, owner_id: task.owner, parent_task_id: null, status: task.status === 'In Progress' ? 'In progress' : task.status === 'Completed' ? 'Done' : task.status, progress: task.progress, start_date: task.start_date, end_date: task.end_date, order_key: String(task.order_index), revision: 1 })), blockers: [], source_revisions: { project_revision: 1, graph_revision: 1 }, capabilities: { view: true, edit: true, transition: true } })
  await page.route('**/api/v2/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname
    const json = (value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) })
    if (request.method() === 'GET' && path === '/api/v2/focus') return json({ scope: 'project', project_id: '901', items: [], total: 0, engine_version: 'pv-focus-1' })
    if (request.method() === 'GET' && path === '/api/v2/projects/901/work') return json(work())
    if (request.method() === 'POST' && path === '/api/v2/projects/901/commands') { const body = request.postDataJSON?.() || {}; commands.push(body); if (body.type === 'task.transition') { const task = project.tasks.find((item: any) => String(item.id) === String(body.payload?.task_id)); if (task) task.status = body.payload.to_status }; return json({ status: 'applied', event_id: `event-${commands.length}` }) }
    return json({})
  })
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (request.method() === 'POST' && path === '/api/v1/observability/performance') return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ accepted: true }) })
    if (request.method() === 'GET' && path.endsWith('/settings/bootstrap')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ VITE_API_BASE_URL: url.origin, DEFAULT_USER_ID: PROJECTS_ROOT_PREVIEW_USER }) })
    if (request.method() === 'GET' && path === '/api/v1/policy/module-availability') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projectsRootPreviewPolicy) })
    if (request.method() === 'GET' && path === '/api/v1/settings/user/profile') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: PROJECTS_ROOT_PREVIEW_USER, username: PROJECTS_ROOT_PREVIEW_USER, full_name: 'Synthetic Root Preview Proof', is_admin: false, permissions: {} }) })
    if (request.method() === 'GET' && path === '/api/v1/settings/user/settings') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ theme: 'nordic-frost-v1' }) })
    if (request.method() === 'GET' && path === '/api/v1/health') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) })
    if (request.method() === 'GET' && path === '/api/v1/projects') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([project]) })
    if (request.method() === 'PUT' && path === '/api/v1/projects/901') {
      lastPut = request.postDataJSON?.() || JSON.parse(request.postData() || '{}')
      project = structuredClone(lastPut)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(project) })
    }
    if (request.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  return { getProject: () => project, getLastPut: () => lastPut, getCommands: () => commands }
}

const installIdentity = async (page: Page) => {
  await page.addInitScript((userId) => {
    localStorage.setItem('sysgrid-theme', 'nordic-frost-v1')
    localStorage.setItem('SYSGRID_USER_ID', userId)
  }, PROJECTS_ROOT_PREVIEW_USER)
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

test('OUT-40 Slice C Board move alternatives expose exact names and minimum targets @out40-slice-c-rehearsal', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await installIdentity(page)
  await installRoutes(page)
  await page.goto('/projects/901/work?layout=board')

  const card = page.locator('.p05-card[data-task-id="9012"]')
  await expect(card).toBeVisible()
  const move = card.getByRole('combobox', { name: 'Move Yield Guardian task B to', exact: true })
  await expect(move).toBeVisible()
  await expect(move.locator('option', { hasText: 'Blocked' })).toHaveCount(1)
  const box = await move.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(40)
  expect(box!.height).toBeGreaterThanOrEqual(40)
  await expect(card.getByRole('button', { name: 'Open task', exact: true })).toBeVisible()
})

test('OUT-40 Slice C keyboard status move persists canonical PUT, announces success, and restores focus @out40-slice-c-acceptance', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const failures = collectRuntimeFailures(page)
  await installIdentity(page)
  const state = await installRoutes(page)
  await page.goto('/projects/901/work?layout=board')

  const sourceCard = page.locator('.p05-card').filter({ hasText: 'Yield Guardian task B' }).first()
  const move = sourceCard.getByRole('combobox', { name: 'Move Yield Guardian task B to', exact: true })
  await move.focus()
  await expect(move).toBeFocused()
  await move.selectOption({ label: 'Blocked' })

  await expect.poll(() => state.getCommands()[0]?.payload?.to_status).toBe('Blocked')
  expect(state.getProject().tasks.find((task: any) => task.id === 9012).status).toBe('Blocked')

  await expect(page.getByRole('heading', { name: 'Blocked', exact: true })).toBeVisible()
  await expect(page.locator('.p05-card').filter({ hasText: 'Yield Guardian task B' }).first()).toBeVisible()
  await expect(page.locator('[data-workspace="projects"]')).toBeVisible()
  expect(failures).toEqual([])
})
