import { test, expect, Page, Locator } from '@playwright/test'
import { PROJECTS_ROOT_PREVIEW_USER, projectsRootPreviewPolicy } from './helpers/projects-root-preview'

type Project = Record<string, any>
type RuntimeState = { getProject: () => Project; getLastPut: () => Project | null; getPutCount: () => number; getCommands: () => any[] }

const projectFixture = (): Project => ({
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
  metadata_json: { adoption_state: 'Pilot' },
  tasks: [
    { id: 9011, name: 'Yield Guardian task A', status: 'To Do', progress: 0, owner: 'Proof Operator', priority: 'High', start_date: '2026-09-01', end_date: '2026-09-04', order_index: 10, dependencies_json: [], metadata_json: {} },
    { id: 9012, name: 'Yield Guardian task B', status: 'In Progress', progress: 55, owner: 'Proof Operator', priority: 'High', start_date: '2026-09-05', end_date: '2026-09-09', order_index: 20, dependencies_json: [9011], description: 'Threshold validation work', metadata_json: { subtasks: [{ id: 'check-1', name: 'Verify threshold', completed: false }] } },
    { id: 9013, name: 'Yield Guardian task C', status: 'To Do', progress: 0, owner: 'Proof Operator', priority: 'Medium', start_date: '2026-09-10', end_date: '2026-09-12', order_index: 30, dependencies_json: [], metadata_json: {} },
  ],
})

const installRoutes = async (page: Page): Promise<RuntimeState> => {
  let project = structuredClone(projectFixture())
  let lastPut: Project | null = null
  let putCount = 0
  const commands: any[] = []
  const work = () => ({ project_id: '901', project_revision: 1, graph_revision: 1, items: project.tasks.map((task: any) => ({ id: String(task.id), title: task.name, owner_id: task.owner, parent_task_id: null, status: task.status === 'In Progress' ? 'In progress' : task.status, progress: task.progress, start_date: task.start_date, end_date: task.end_date, order_key: String(task.order_index), revision: 1 })), blockers: [], source_revisions: { project_revision: 1, graph_revision: 1 }, capabilities: { view: true, edit: true, transition: true } })
  await page.route('**/api/v2/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname
    const json = (value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) })
    if (request.method() === 'GET' && path === '/api/v2/focus') return json({ scope: 'project', project_id: '901', items: [], total: 0, engine_version: 'pv-focus-1' })
    if (request.method() === 'GET' && path === '/api/v2/projects/901/work') return json(work())
    if (request.method() === 'POST' && path === '/api/v2/projects/901/commands') { const body = request.postDataJSON?.() || {}; commands.push(body); return json({ status: 'applied', event_id: `event-${commands.length}` }) }
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
      putCount += 1
      project = structuredClone(lastPut)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(project) })
    }
    if (request.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  return { getProject: () => project, getLastPut: () => lastPut, getPutCount: () => putCount, getCommands: () => commands }
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

const expectMinTarget = async (control: Locator) => {
  const box = await control.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(40)
  expect(box!.height).toBeGreaterThanOrEqual(40)
}

const expectAllDrawerControlsNamed = async (drawer: Locator) => {
  const controls = drawer.locator('button, input:not([type="hidden"]), select, textarea, a[href], [role="button"], [role="link"], [role="option"]')
  for (let index = 0; index < await controls.count(); index += 1) {
    const control = controls.nth(index)
    if (!(await control.isVisible())) continue
    await expect(control, `drawer control ${index} must have a computed accessible name`).toHaveAccessibleName(/\S/)
  }
}

test('OUT-40 Slice F Task Drawer required controls are explicitly named and icon targets are >=40px @out40-slice-f-rehearsal', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await installIdentity(page)
  await installRoutes(page)
  await page.goto('/projects/901/work')

  await page.getByRole('button', { name: 'Yield Guardian task B', exact: true }).click()
  const drawer = page.locator('.p05-task-panel')
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText('Task panel', { exact: true })).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Close', exact: true })).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Mark done', exact: true })).toBeVisible()
  await expectMinTarget(drawer.getByRole('button', { name: 'Close', exact: true }))
  await expectMinTarget(drawer.getByRole('button', { name: 'Mark done', exact: true }))

  await expectAllDrawerControlsNamed(drawer)
})

test('OUT-40 Slice F named dependency removal keeps native Enter activation and canonical Project PUT @out40-slice-f-acceptance', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const failures = collectRuntimeFailures(page)
  await installIdentity(page)
  const state = await installRoutes(page)
  await page.goto('/projects/901/work')

  await page.getByRole('button', { name: 'Yield Guardian task B', exact: true }).click()
  const drawer = page.locator('.p05-task-panel')
  await expect(drawer).toBeVisible()
  await expectAllDrawerControlsNamed(drawer)
  const markDone = drawer.getByRole('button', { name: 'Mark done', exact: true })
  await markDone.focus()
  await expect(markDone).toBeFocused()
  await markDone.press('Enter')
  await expect.poll(() => state.getCommands().length).toBe(1)
  expect(state.getCommands()[0]).toMatchObject({ type: 'task.transition', payload: { task_id: '9012', to_status: 'Done' } })
  await expect(drawer.getByText('In progress', { exact: true })).toHaveCount(1)
  await expectAllDrawerControlsNamed(drawer)
  expect(failures).toEqual([])
})
