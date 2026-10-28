import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test'

type Revisions = { project_revision: number; graph_revision: number; calendar_revision: number }
type Journey = { api: APIRequestContext; projectId: string; revisions: Revisions; ids: Record<string, string> }

const apiOrigin = () => {
  const value = process.env.SYSGRID_P06_API_ORIGIN
  if (!value) throw new Error('SYSGRID_P06_API_ORIGIN is required')
  return value
}
const user = process.env.SYSGRID_P06_USER_ID || 'p06.scheduler'

async function createJourney(): Promise<Journey> {
  const api = await request.newContext({ baseURL: apiOrigin(), extraHTTPHeaders: { 'X-User-Id': user, 'X-Tenant-Id': '1' } })
  const projectCommandId = crypto.randomUUID()
  const created = await api.post('/api/v2/projects', { headers: { 'Idempotency-Key': projectCommandId }, data: { name: `Journey 3 ${projectCommandId.slice(0, 8)}`, objective: 'Deterministic schedule authority', timezone: 'America/Chicago' } })
  expect(created.ok(), await created.text()).toBeTruthy()
  const project = (await created.json()).project
  const revisions: Revisions = { project_revision: 1, graph_revision: 1, calendar_revision: 1 }
  const command = async (type: string, payload: Record<string, unknown>, expected: Record<string, unknown> = revisions) => {
    const commandId = crypto.randomUUID()
    const response = await api.post(`/api/v2/projects/${project.id}/commands`, { headers: { 'Idempotency-Key': commandId }, data: { command_id: commandId, type, expected, payload } })
    expect(response.ok(), `${type}: ${await response.text()}`).toBeTruthy()
    const body = await response.json()
    for (const key of Object.keys(revisions) as Array<keyof Revisions>) if (body.revisions?.[key] != null) revisions[key] = body.revisions[key]
    return body
  }
  const ids: Record<string, string> = {}
  const tasks = [
    ['A', { title: 'A', start_date: '2026-10-05', end_date: '2026-10-07', duration_workdays: 3 }],
    ['B', { title: 'B', start_date: '2026-10-08', end_date: '2026-10-09', duration_workdays: 2 }],
    ['C', { title: 'C', start_date: '2026-10-06', end_date: '2026-10-07', duration_workdays: 2 }],
    ['D', { title: 'D', start_date: '2026-10-12', end_date: '2026-10-12', duration_workdays: 1 }],
    ['delivery', { title: 'Delivery', kind: 'Milestone', point_date: '2026-10-12', milestone_anchor: 'finish' }],
  ] as const
  for (const [key, payload] of tasks) ids[key] = (await command('task.create', payload)).changed_entities[0].id
  for (const [predecessor, successor, dependency_type, lag_days] of [
    ['A', 'B', 'FS', 0], ['A', 'C', 'SS', 1], ['B', 'D', 'FS', 0], ['C', 'D', 'FS', 0], ['D', 'delivery', 'FS', 0],
  ] as const) await command('dependency.create', { predecessor_id: ids[predecessor], successor_id: ids[successor], dependency_type, lag_days })
  return { api, projectId: project.id, revisions, ids }
}

async function openTimeline(page: Page, projectId: string) {
  await page.addInitScript(({ origin, actor }) => {
    localStorage.setItem('SYSGRID_OVERRIDE_API_URL', origin)
    localStorage.setItem('SYSGRID_USER_ID', actor)
    localStorage.setItem('SYSGRID_TENANT_ID', '1')
  }, { origin: apiOrigin(), actor: user })
  await page.goto(`/projects/${projectId}/timeline`)
  const gantt = page.getByRole('region', { name: 'Project timeline' })
  await expect(gantt).toBeVisible()
  return gantt
}

function collectFailures(page: Page) {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') failures.push(message.text()) })
  return failures
}

test.beforeEach(() => test.skip(!process.env.P06_REAL_BACKEND, 'requires the isolated P06 backend proof runtime'))

test('Journey 3 renders exact authority results with bounded rows, ticks, connectors and targets', async ({ page }) => {
  const journey = await createJourney()
  const failures = collectFailures(page)
  try {
    const stateResponse = await journey.api.get(`/api/v2/projects/${journey.projectId}/schedule?as_of=2026-10-05`)
    expect(stateResponse.ok()).toBeTruthy()
    const state = await stateResponse.json()
    expect(state.analysis.critical_task_ids).toEqual([journey.ids.A, journey.ids.B, journey.ids.D, journey.ids.delivery])
    expect(state.analysis.rows.find((row: any) => row.task_id === journey.ids.C).slack_workdays).toBe(2)

    const gantt = await openTimeline(page, journey.projectId)
    await expect(gantt.getByRole('treegrid', { name: 'Project WBS timeline tasks' })).toHaveAttribute('aria-rowcount', '6')
    expect(await gantt.locator('[data-project-timeline-row="true"]').count()).toBeLessThanOrEqual(40)
    expect(await gantt.locator('[data-project-timeline-tick="true"]').count()).toBeLessThanOrEqual(64)
    expect(await gantt.locator('[data-project-timeline-dependency-connector="true"]').count()).toBeLessThanOrEqual(80)
    await expect(gantt.getByRole('separator', { name: 'Resize WBS rail' })).toHaveAttribute('aria-valuenow', '320')
    await expect(gantt.locator(`[data-task-id="${journey.ids.delivery}"][data-project-timeline-bar="true"]`)).toHaveCSS('width', '44px')
    const shortBar = gantt.locator(`[data-task-id="${journey.ids.B}"][data-project-timeline-bar="true"]`)
    await shortBar.click()
    await expect(gantt.getByRole('button', { name: 'Move task earlier B' })).toBeVisible()
    expect(failures).toEqual([])
  } finally { await journey.api.dispose() }
})

test('keyboard and pointer emit equivalent previews, cancellation writes nothing, and lost response is confirmed', async ({ page }) => {
  const journey = await createJourney()
  const failures = collectFailures(page)
  const previews: any[] = []
  page.on('request', (incoming) => { if (incoming.url().includes('/schedule/preview') && incoming.method() === 'POST') previews.push(incoming.postDataJSON()) })
  try {
    const gantt = await openTimeline(page, journey.projectId)
    const bar = gantt.locator(`[data-task-id="${journey.ids.B}"][data-project-timeline-bar="true"]`)
    await bar.focus()
    await bar.press('ArrowRight')
    await expect(page.getByRole('dialog', { name: 'Review propagation' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel — zero writes' }).click()

    const box = await bar.boundingBox()
    if (!box) throw new Error('B task bar has no geometry')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 16, box.y + box.height / 2)
    await page.mouse.up()
    await expect(page.getByRole('dialog', { name: 'Review propagation' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel — zero writes' }).click()
    expect(previews.slice(0, 2).map(({ operation, selection_ids, parameters }) => ({ operation, selection_ids, parameters }))).toEqual([
      { operation: 'move', selection_ids: [journey.ids.B], parameters: { delta_workdays: 1 } },
      { operation: 'move', selection_ids: [journey.ids.B], parameters: { delta_workdays: 1 } },
    ])
    let state = await (await journey.api.get(`/api/v2/projects/${journey.projectId}/schedule`)).json()
    expect(state.history.filter((item: any) => item.event_type === 'schedule.apply')).toHaveLength(0)
    expect(state.tasks.find((item: any) => item.id === journey.ids.B).start_date).toBe('2026-10-08')

    let loseApplyResponse = true
    await page.route(`**/api/v2/projects/${journey.projectId}/commands`, async (route) => {
      const body = route.request().postDataJSON()
      if (loseApplyResponse && body?.type === 'schedule.apply') {
        loseApplyResponse = false
        await route.fetch()
        await route.abort('failed')
      } else await route.continue()
    })
    await bar.focus()
    await bar.press('ArrowRight')
    await page.getByRole('button', { name: 'Apply one atomic command' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'confirmed after the network response was lost' })).toBeVisible()
    state = await (await journey.api.get(`/api/v2/projects/${journey.projectId}/schedule`)).json()
    expect(state.history.filter((item: any) => item.event_type === 'schedule.apply')).toHaveLength(1)
    expect(state.tasks.find((item: any) => item.id === journey.ids.B).start_date).toBe('2026-10-09')
    expect(state.tasks.find((item: any) => item.id === journey.ids.D).start_date).toBe('2026-10-13')
    expect(failures).toContain('Failed to load resource: net::ERR_FAILED')
    failures.splice(failures.indexOf('Failed to load resource: net::ERR_FAILED'), 1)
    expect(failures).toEqual([])
  } finally { await journey.api.dispose() }
})

test('calendar changes demand explicit normalization before schedule changes are applied', async ({ page }) => {
  const journey = await createJourney()
  const failures = collectFailures(page)
  try {
    const gantt = await openTimeline(page, journey.projectId)
    const scheduleButton = gantt.getByRole('button', { name: 'Schedule changes' })
    await scheduleButton.click()
    const panel = page.getByRole('dialog', { name: 'Schedule changes' })
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: 'Fri', exact: true }).click()
    const previewButton = panel.getByRole('button', { name: 'Preview calendar change' })
    await expect(previewButton).toBeDisabled()
    const choices = panel.getByRole('combobox', { name: /normalization/ })
    expect(await choices.count()).toBeGreaterThan(0)
    for (let index = 0; index < await choices.count(); index += 1) await choices.nth(index).selectOption('next')
    await expect(previewButton).toBeEnabled()
    await panel.getByRole('button', { name: 'Close schedule changes' }).click()
    await expect(scheduleButton).toBeFocused()

    expect(failures).toEqual([])
  } finally { await journey.api.dispose() }
})
