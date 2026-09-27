import { expect, request, test } from '@playwright/test'
import { installProjectsRootPreviewApis, PROJECTS_ROOT_PREVIEW_USER } from './helpers/projects-root-preview'

const work = {
  project_id: 'p1',
  project_revision: 3,
  graph_revision: 2,
  items: [
    { id: 'summary', title: 'Delivery group', kind: 'Summary', parent_task_id: null, order_key: '1024', owner_id: 'mina', status: 'To Do', progress: 0, revision: 1 },
    { id: 'task-1', title: 'Canonical task', kind: 'Task', parent_task_id: 'summary', order_key: '1024', owner_id: 'mina', status: 'In progress', progress: 50, revision: 1 },
    { id: 'task-2', title: 'Unscheduled task', kind: 'Task', parent_task_id: null, order_key: '2048', owner_id: 'mina', status: 'To Do', progress: 0, revision: 1 },
  ],
  blockers: [],
}

test('P05 Work treegrid exposes expanded row geometry and keyboard status projection', async ({ page }) => {
  const fixture = structuredClone(work)
  await page.addInitScript((userId) => {
    localStorage.setItem('SYSGRID_OVERRIDE_API_URL', 'http://127.0.0.1:8000')
    localStorage.setItem('SYSGRID_USER_ID', userId)
    localStorage.setItem('SYSGRID_TENANT_ID', '1')
  }, PROJECTS_ROOT_PREVIEW_USER)
  await page.route('**/api/v2/focus*', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ scope: 'project', engine_version: 'pv-focus-1', total: 1, items: [{ id: 'task:task-1', entity_kind: 'task', entity_id: 'task-1', project_id: 'p1', project_name: 'P05 fixture', title: 'Canonical task', due_context: 'No due date', bucket_label: 'In progress or review', why_here: 'In progress or review: In progress work', primary_action: 'Open task', pinned: false }], all_priorities: [] }) }))
  await page.route('**/api/v2/projects/p1/work', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'applied' }) })
  })
  await page.route('**/api/v2/projects/p1/commands', async (route) => {
    const body = route.request().postDataJSON?.() || {}
    const task = fixture.items.find((item) => item.id === body.payload?.task_id)
    if (task && body.type === 'task.transition') task.status = body.payload.to_status
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'applied' }) })
  })
  await installProjectsRootPreviewApis(page)
  await page.goto('/projects/p1/work')
  const grid = page.getByRole('treegrid', { name: 'Project work breakdown' })
  await expect(grid).toBeVisible()
  await expect(grid).toHaveAttribute('aria-rowcount', '3')
  await grid.getByRole('button', { name: 'Expand Delivery group' }).click()
  await expect(grid).toHaveAttribute('aria-rowcount', '4')
  const child = grid.getByRole('row').filter({ hasText: 'Canonical task' })
  await expect(child).toHaveAttribute('aria-level', '2')
  await expect(child).toHaveAttribute('aria-posinset', '1')
  const status = child.getByRole('combobox', { name: 'Status for Canonical task' })
  await status.focus()
  await status.press('ArrowDown')
  await status.selectOption('Blocked')
  await expect(status).toHaveValue('Blocked')
})

test('P05 Board keeps Move to keyboard control in the same task projection', async ({ page }) => {
  const fixture = structuredClone(work)
  await page.addInitScript((userId) => {
    localStorage.setItem('SYSGRID_OVERRIDE_API_URL', 'http://127.0.0.1:8000')
    localStorage.setItem('SYSGRID_USER_ID', userId)
    localStorage.setItem('SYSGRID_TENANT_ID', '1')
  }, PROJECTS_ROOT_PREVIEW_USER)
  await page.route('**/api/v2/focus*', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ scope: 'project', engine_version: 'pv-focus-1', total: 0, items: [], all_priorities: [] }) }))
  await page.route('**/api/v2/projects/p1/work', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'applied' }) })
  })
  await page.route('**/api/v2/projects/p1/commands', async (route) => {
    const body = route.request().postDataJSON?.() || {}
    const task = fixture.items.find((item) => item.id === body.payload?.task_id)
    if (task && body.type === 'task.transition') task.status = body.payload.to_status
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'applied' }) })
  })
  await installProjectsRootPreviewApis(page)
  await page.goto('/projects/p1/work?layout=board')
  await expect(page.getByRole('heading', { name: 'Board' })).toHaveCount(0)
  await expect(page.getByLabel('Move Canonical task to')).toBeVisible()
  await page.getByLabel('Move Canonical task to').focus()
  await page.getByLabel('Move Canonical task to').press('ArrowDown')
  await page.getByLabel('Move Canonical task to').selectOption('Blocked')
  await expect(page.getByLabel('Move Canonical task to')).toHaveValue('Blocked')
})

test('P05 real backend browser journey reads the canonical task graph', async ({ page }) => {
  test.skip(!process.env.P05_REAL_BACKEND, 'requires the isolated P05 backend proof runtime')
  const apiOrigin = process.env.SYSGRID_P05_API_ORIGIN
  if (!apiOrigin) throw new Error('SYSGRID_P05_API_ORIGIN is required for the real backend journey')
  const api = await request.newContext({
    baseURL: apiOrigin,
    extraHTTPHeaders: { 'X-User-Id': 'p05.manager', 'X-Tenant-Id': '1' },
  })
  try {
    const projectCommandId = globalThis.crypto.randomUUID()
    const projectResponse = await api.post('/api/v2/projects', { headers: { 'Idempotency-Key': projectCommandId }, data: { name: 'P05 real backend fixture', objective: 'One task graph drives every projection' } })
    expect(projectResponse.ok(), await projectResponse.text()).toBeTruthy()
    const project = (await projectResponse.json()).project
    const create = async (commandType: string, expected: Record<string, unknown>, payload: Record<string, unknown>) => {
      const commandId = globalThis.crypto.randomUUID()
      const response = await api.post(`/api/v2/projects/${project.id}/commands`, {
        headers: { 'Idempotency-Key': commandId },
        data: { command_id: commandId, type: commandType, expected, payload },
      })
      expect(response.ok()).toBeTruthy()
      return response.json()
    }
    await create('task.create', { project_revision: 1, graph_revision: 1 }, { title: 'Delivery group', kind: 'Summary' })
    const work = await api.get(`/api/v2/projects/${project.id}/work`)
    expect(work.ok()).toBeTruthy()
    const summary = (await work.json()).items.find((item: any) => item.title === 'Delivery group')
    expect(summary?.kind).toBe('Summary')
    await create('task.create', { project_revision: 2, graph_revision: 2 }, { title: 'Canonical child', parent_task_id: summary.id, status: 'In progress', progress: 20 })
    await page.addInitScript((origin) => {
      localStorage.setItem('SYSGRID_OVERRIDE_API_URL', origin)
      localStorage.setItem('SYSGRID_USER_ID', 'p05.manager')
      localStorage.setItem('SYSGRID_TENANT_ID', '1')
    }, apiOrigin)
    await page.goto(`/projects/${project.id}/work`)
    const grid = page.getByRole('treegrid', { name: 'Project work breakdown' })
    await expect(grid).toBeVisible()
    await expect(grid).toHaveAttribute('aria-rowcount', '2')
    await grid.getByRole('button', { name: 'Expand Delivery group' }).click()
    await expect(grid).toHaveAttribute('aria-rowcount', '3')
    await expect(grid.getByRole('row').filter({ hasText: 'Canonical child' })).toHaveAttribute('aria-level', '2')
  } finally {
    await api.dispose()
  }
})
