import { test, expect, Page } from '@playwright/test'
import { PROJECTS_ROOT_PREVIEW_USER, projectsRootPreviewPolicy } from './helpers/projects-root-preview'

type Project = Record<string, any>
const makeTask = (id: number, name: string, start: string, end: string, deps: any[] = []) => ({ id, name, status: 'In Progress', progress: 50, owner: 'Planner', start_date: start, end_date: end, dependencies_json: deps, metadata_json: {} })
const seed: Project = {
  id: 3801,
  name: 'OUT-38 Browser Proof',
  status: 'In Progress',
  priority: 'High',
  owner: 'Planner',
  start_date: '2026-01-05',
  end_date: '2026-01-31',
  metadata_json: {},
  tasks: [
    makeTask(1, 'Foundation', '2026-01-05', '2026-01-06'),
    makeTask(2, 'Delivery', '2026-01-07', '2026-01-08', [1]),
  ],
}
let projects: Project[] = []
let lastPutBody: any = null

const installRoutes = async (page: Page) => {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname
    if (request.method() === 'GET' && path.endsWith('/settings/bootstrap')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ VITE_API_BASE_URL: url.origin, DEFAULT_USER_ID: PROJECTS_ROOT_PREVIEW_USER }) })
    if (request.method() === 'GET' && path === '/api/v1/policy/module-availability') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projectsRootPreviewPolicy) })
    if (request.method() === 'GET' && path === '/api/v1/settings/user/profile') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: PROJECTS_ROOT_PREVIEW_USER, username: PROJECTS_ROOT_PREVIEW_USER, full_name: 'Projects Root Preview', is_admin: false, permissions: {} }) })
    if (request.method() === 'GET' && path === '/api/v1/settings/user/settings') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ theme: 'nordic-frost-v1' }) })
    if (request.method() === 'GET' && path === '/api/v1/health') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) })
    if (request.method() === 'GET' && path === '/api/v1/projects') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projects) })
    if (request.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    if (request.method() === 'PUT' && path === '/api/v1/projects/3801') {
      lastPutBody = request.postDataJSON(); projects = [{ ...projects[0], ...lastPutBody }]
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projects[0]) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}

const visibleTextBelow = async (page: Page, selector: string, floor: number) => page.locator(selector).evaluate((root, min) => {
  const bad: Array<{ text: string; size: number }> = []
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    const text = (element.innerText || '').trim()
    if (!text || element.children.length > 0) continue
    const rect = element.getBoundingClientRect(); const style = getComputedStyle(element)
    if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') continue
    const size = Number.parseFloat(style.fontSize)
    if (size < min) bad.push({ text: text.slice(0, 80), size })
  }
  return bad
}, floor)

const undersizedControls = async (page: Page, selector: string, floor: number) => page.locator(selector).evaluate((root, min) => {
  const bad: Array<{ name: string; width: number; height: number }> = []
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('button, input, select'))) {
    const rect = element.getBoundingClientRect(); const style = getComputedStyle(element)
    if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden' || element.hasAttribute('disabled')) continue
    if (rect.width + 0.5 < min || rect.height + 0.5 < min) bad.push({ name: element.getAttribute('aria-label') || element.innerText || element.getAttribute('name') || element.tagName, width: rect.width, height: rect.height })
  }
  return bad
}, floor)

test.beforeEach(async ({ page }) => {
  projects = [structuredClone(seed)]; lastPutBody = null
  await page.addInitScript((userId) => { localStorage.setItem('sysgrid-theme', 'nordic-frost-v1'); localStorage.setItem('SYSGRID_USER_ID', userId) }, PROJECTS_ROOT_PREVIEW_USER)
  await installRoutes(page)
})

test('advanced schedule control completes the existing Timeline without replacing it @scheduling-rehearsal', async ({ page }) => {
  await page.goto('/projects?id=3801&view=timeline')
  await expect(page.locator('[data-projects-scheduling-completion="true"]')).toBeVisible()
  await expect(page.locator('[data-project-timeline="true"]')).toBeVisible()
  await page.locator('[data-project-schedule-control-toggle="true"]').click()
  await expect(page.locator('[data-project-schedule-control-drawer="true"]')).toBeVisible()
  await expect(page.locator('[data-project-schedule-network="true"]')).toContainText('Typed relationship + lag')
  await expect(page.locator('[data-project-schedule-analysis="true"]')).toContainText('Typed-edge CPM')
  await expect(page.locator('[data-project-schedule-capacity="true"]')).toContainText('Capacity Unknown')
})

test('typed dependency and calendar save through canonical Project PUT @scheduling-acceptance', async ({ page }) => {
  await page.goto('/projects?id=3801&view=timeline')
  await page.locator('[data-project-schedule-control-toggle="true"]').click()
  const network = page.locator('[data-project-schedule-network="true"]')
  await network.getByLabel('Task').selectOption('2')
  await network.getByLabel('Predecessor').selectOption('1')
  await network.getByLabel('Type').selectOption('SS')
  await network.getByRole('spinbutton').fill('2')
  await network.getByRole('button', { name: /Save dependency/i }).click()
  await expect.poll(() => lastPutBody?.tasks?.find((task: any) => task.id === 2)?.dependencies_json?.some((dependency: any) => dependency.type === 'SS' && dependency.lag_days === 2)).toBe(true)
  expect(lastPutBody.tasks.find((task: any) => task.id === 2).dependencies_json).toEqual(expect.arrayContaining([expect.objectContaining({ id: '1', type: 'FS', lag_days: 0 }), expect.objectContaining({ id: '1', type: 'SS', lag_days: 2 })]))

  const constraints = page.locator('[data-project-schedule-constraints="true"]')
  await constraints.getByRole('button', { name: 'Sat', exact: true }).click()
  await constraints.getByRole('button', { name: /Save calendar/i }).click()
  await expect.poll(() => lastPutBody?.metadata_json?.project_schedule_v2?.working_days).toEqual([1, 2, 3, 4, 5, 6])
})

test('scenario preview is non-mutating, save is metadata-only, and Apply changes live dates @scheduling-acceptance', async ({ page }) => {
  await page.goto('/projects?id=3801&view=timeline')
  await page.locator('[data-project-schedule-control-toggle="true"]').click()
  const scenarios = page.locator('[data-project-schedule-scenarios="true"]')
  await expect(scenarios.locator('[data-project-scenario-preview="true"]')).toContainText('Preview is mutation-free')
  await scenarios.getByPlaceholder('Scenario name').fill('Two-day slip')
  await scenarios.getByRole('spinbutton', { name: 'Scenario slip days' }).fill('2')
  await scenarios.getByRole('button', { name: /Save scenario/i }).click()
  await expect.poll(() => lastPutBody?.metadata_json?.project_schedule_v2?.scenarios?.[0]?.status).toBe('PROPOSED')
  expect(lastPutBody.tasks[0].start_date).toBe('2026-01-05')
  await scenarios.getByRole('button', { name: /Apply/i }).click()
  await expect.poll(() => lastPutBody?.metadata_json?.project_schedule_v2?.scenarios?.[0]?.status).toBe('APPLIED')
  expect(lastPutBody.tasks[0].start_date).toBe('2026-01-07')
})

test('baseline history is additive and capacity stays Unknown without authority @scheduling-acceptance', async ({ page }) => {
  await page.goto('/projects?id=3801&view=timeline')
  await page.locator('[data-project-schedule-control-toggle="true"]').click()
  const baselines = page.locator('[data-project-schedule-baselines="true"]')
  await baselines.getByPlaceholder('Baseline name').fill('Gate baseline')
  await baselines.getByRole('button', { name: 'Capture', exact: true }).click()
  await expect.poll(() => lastPutBody?.metadata_json?.project_schedule_v2?.baselines?.length).toBe(1)
  await expect(page.locator('[data-project-schedule-capacity="true"]')).toContainText('Capacity Unknown')
})

test('OUT-40 schedule control is keyboard-accessible, announced and contained at 390x844 @out40-slice-b-acceptance', async ({ page }) => {
  const consoleErrors: string[] = []; const requestFailures: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('requestfailed', (request) => requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/projects?id=3801&view=timeline')

  const toggle = page.locator('[data-project-schedule-control-toggle="true"]')
  await toggle.focus(); await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Scheduling, capacity & scenarios' })
  await expect(dialog).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(toggle).toHaveAttribute('aria-controls', 'project-schedule-control-drawer')
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(page.getByRole('button', { name: 'Close schedule control' })).toBeFocused()

  const bounds = await dialog.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds?.x || 0).toBeGreaterThanOrEqual(0)
  expect(bounds?.y || 0).toBeGreaterThanOrEqual(0)
  expect((bounds?.x || 0) + (bounds?.width || 0)).toBeLessThanOrEqual(391)
  expect((bounds?.y || 0) + (bounds?.height || 0)).toBeLessThanOrEqual(845)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  expect(await visibleTextBelow(page, '[data-project-schedule-control-drawer="true"]', 12)).toEqual([])
  expect(await undersizedControls(page, '[data-project-schedule-control-drawer="true"]', 40)).toEqual([])

  const network = page.locator('[data-project-schedule-network="true"]')
  await network.getByLabel('Task').selectOption('2')
  await network.getByLabel('Predecessor').selectOption('1')
  await network.getByLabel('Type').selectOption('SS')
  await network.getByRole('spinbutton').fill('2')
  await network.getByRole('button', { name: /Save dependency/i }).click()
  const live = page.locator('[data-project-schedule-live-status="true"]')
  await expect(live).toHaveText('Typed dependency saved')

  await network.getByLabel('Task').selectOption('1')
  await network.getByLabel('Predecessor').selectOption('2')
  await network.getByRole('button', { name: /Save dependency/i }).click()
  await expect(live).toHaveText('Dependency was not changed. Check for a duplicate or cycle.')

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(toggle).toBeFocused()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(consoleErrors).toEqual([])
  expect(requestFailures).toEqual([])
})

test('OUT-40 schedule control stays viewport-contained on desktop and wide screens @out40-slice-b-regression', async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/projects?id=3801&view=timeline')
    const toggle = page.locator('[data-project-schedule-control-toggle="true"]')
    await toggle.click()
    const dialog = page.getByRole('dialog', { name: 'Scheduling, capacity & scenarios' })
    await expect(dialog).toBeVisible()
    const bounds = await dialog.boundingBox()
    expect(bounds).not.toBeNull()
    expect((bounds?.x || 0) + (bounds?.width || 0)).toBeLessThanOrEqual(viewport.width + 1)
    expect((bounds?.y || 0) + (bounds?.height || 0)).toBeLessThanOrEqual(viewport.height + 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    await page.getByRole('button', { name: 'Close schedule control' }).click()
    await expect(toggle).toBeFocused()
  }
})
