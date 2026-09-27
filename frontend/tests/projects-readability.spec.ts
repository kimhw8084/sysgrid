import { test, expect, Page } from '@playwright/test'
import { PROJECTS_ROOT_PREVIEW_USER, projectsRootPreviewPolicy } from './helpers/projects-root-preview'

type Project = Record<string, any>

const task = (id: number, name: string, status: string, progress: number, start: string, end: string, owner: string, dependencies: number[] = []) => ({
  id, name, status, progress, start_date: start, end_date: end, owner, priority: status === 'Blocked' ? 'Highest' : 'High',
  order_index: id * 10, dependencies_json: dependencies, metadata_json: {},
})

const p01: Project = {
  id: 80101,
  name: 'P01 — Yield Guardian — Excursion Detection MVP',
  status: 'In Progress', priority: 'High', owner: 'Maya Chen', objective: 'Detect yield excursions early enough to protect production output.',
  start_date: '2026-08-18', end_date: '2026-09-18', man_hours_saved: 920, stoploss_minutes_saved: 460, wafers_gained: 180,
  metadata_json: {},
  tasks: [
    task(101, 'Define excursion signal contract', 'Completed', 100, '2026-08-18', '2026-08-20', 'Maya Chen'),
    task(102, 'Connect inline metrology stream', 'Completed', 100, '2026-08-21', '2026-08-24', 'Sam Lee', [101]),
    task(103, 'Calibrate detection threshold', 'In Progress', 76, '2026-08-25', '2026-09-03', 'Maya Chen', [102]),
    task(104, 'Operator acceptance checkpoint', 'To Do', 0, '2026-09-04', '2026-09-08', 'Nina Park', [103]),
  ],
}

const p02: Project = {
  id: 80202,
  name: 'P02 — Recipe Release Guardrail — Change Control MVP',
  status: 'Blocked', priority: 'Highest', owner: 'Jordan Wells', objective: 'Stop unreviewed recipe changes before they reach production tools.',
  start_date: '2026-08-05', end_date: '2026-09-12', metadata_json: {},
  tasks: [
    task(201, 'Map recipe release controls', 'Completed', 100, '2026-08-05', '2026-08-09', 'Jordan Wells'),
    task(202, 'Implement approval gate', 'In Progress', 68, '2026-08-10', '2026-08-24', 'Priya Shah', [201]),
    task(203, 'Security sign-off', 'Blocked', 20, '2026-08-25', '2026-08-28', 'Avery Cole', [202]),
    task(204, 'Production release milestone', 'To Do', 0, '2026-08-29', '2026-09-02', 'Jordan Wells', [203]),
  ],
}

const p10Tasks = Array.from({ length: 120 }, (_, index) => {
  const id = 10001 + index
  const day = (index % 24) + 1
  const startMonth = index < 60 ? '09' : '10'
  const endMonth = index < 60 ? '09' : '10'
  const start = `2026-${startMonth}-${String(day).padStart(2, '0')}`
  const endDay = Math.min(28, day + 3)
  const end = `2026-${endMonth}-${String(endDay).padStart(2, '0')}`
  const status = index < 18 ? 'Completed' : index < 55 ? 'In Progress' : index === 55 ? 'Blocked' : 'To Do'
  const progress = status === 'Completed' ? 100 : status === 'In Progress' ? 45 + (index % 45) : status === 'Blocked' ? 30 : 0
  return task(id, `Atlas work package ${String(index + 1).padStart(3, '0')}`, status, progress, start, end, ['Alex Kim', 'Riley Stone', 'Taylor Wu', 'Morgan Diaz'][index % 4], index ? [id - 1] : [])
})
const p10: Project = {
  id: 81010,
  name: 'P10 — Multi-Site Rollout — Project Atlas MVP',
  status: 'In Progress', priority: 'High', owner: 'Alex Kim', objective: 'Roll out the validated operating model across multiple production sites.',
  start_date: '2026-09-01', end_date: '2026-12-18', metadata_json: {}, tasks: p10Tasks,
}

const projects = [p01, p02, p10]

const installRoutes = async (page: Page) => {
  const story = { health: { level: 'On track', reason: 'Readability fixture' }, delivery: { percent: 55, label: '55%', method: 'Canonical task progress' }, next_milestone: null, milestones: [], attention: [], attention_count: 0, acceptance_criteria: [], primary_metric: null, latest_update: null, governance: [], architecture: { assessment: 'Not assessed' }, resources: [], freshness: { updated_at: '2026-09-01T00:00:00Z', source: 'readability-fixture' }, coverage: { resources: 'complete' } }
  const canonical = (project: Project) => ({ id: String(project.id), display_key: `PRJ-${project.id}`, tenant_id: 1, name: project.name, objective: project.objective, owner_id: project.owner, team_id: 1, phase: 'Executing', run_state: 'Active', priority: project.priority, target_date: project.end_date, architecture_assessment: 'Not assessed', outcome_phase: 'Planned', outcome_result: 'Unassessed', revision: 1, graph_revision: 1, capabilities: { view: true, edit: true, transition: true }, story })
  const summary = (project: Project) => ({ project: canonical(project), story, capabilities: { view: true, edit: true, transition: true } })
  const schedule = (project: Project) => ({ project: canonical(project), project_id: String(project.id), project_revision: 1, graph_revision: 1, calendar: { id: `readability-${project.id}`, timezone: 'UTC', working_weekdays: [0, 1, 2, 3, 4, 5, 6], exceptions: [], revision: 1 }, tasks: project.tasks.map((item: any) => ({ id: String(item.id), title: item.name, kind: 'Task', owner_id: item.owner, parent_task_id: null, metadata_json: item.metadata_json || {}, status: item.status === 'Completed' ? 'Done' : item.status === 'In Progress' ? 'In progress' : item.status, progress: item.progress, order_key: String(item.order_index), start_date: item.start_date, end_date: item.end_date, point_date: null, revision: 1 })), dependencies: project.tasks.flatMap((item: any) => (item.dependencies_json || []).map((dependency: any, index: number) => ({ id: `edge-${item.id}-${index}`, predecessor_id: String(dependency.id ?? dependency), successor_id: String(item.id), dependency_type: dependency.type || 'FS', lag_days: 0, active: true, revision: 1 }))), external_dependencies: [], baselines: [], baseline_variance: [], analysis: { rows: [], critical_task_ids: [], status: 'Complete' }, forecast: { tasks: [], coverage: 'complete' }, external_warnings: [], history: [] })
  await page.route('**/api/v2/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname
    const json = (value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) })
    if (request.method() === 'GET' && path === '/api/v2/projects') return json({ items: projects.map(canonical), summary: { Executing: projects.length }, next_cursor: null, as_of: '2026-09-01T00:00:00Z', source_revision: 'readability-fixture', coverage: { projects: 'complete' } })
    const summaryMatch = path.match(/^\/api\/v2\/projects\/(\d+)\/summary$/)
    if (request.method() === 'GET' && summaryMatch) { const project = projects.find((item) => String(item.id) === summaryMatch[1]); if (project) return json(summary(project)) }
    const match = path.match(/^\/api\/v2\/projects\/(\d+)\/schedule$/)
    if (request.method() === 'GET' && match) { const project = projects.find((item) => String(item.id) === match[1]); if (project) return json(schedule(project)) }
    return json({})
  })
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (request.method() === 'GET' && path.endsWith('/settings/bootstrap')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ VITE_API_BASE_URL: url.origin, DEFAULT_USER_ID: PROJECTS_ROOT_PREVIEW_USER }) })
    }
    if (request.method() === 'GET' && path === '/api/v1/policy/module-availability') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projectsRootPreviewPolicy) })
    if (request.method() === 'GET' && path === '/api/v1/settings/user/profile') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: PROJECTS_ROOT_PREVIEW_USER,
          username: PROJECTS_ROOT_PREVIEW_USER,
          full_name: 'Synthetic Root Preview Proof',
          is_admin: false,
          permissions: {},
        }),
      })
    }
    if (request.method() === 'GET' && path === '/api/v1/settings/user/settings') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ theme: 'nordic-frost-v1' }) })
    }
    if (request.method() === 'GET' && path === '/api/v1/health') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) })
    }
    if (request.method() === 'GET' && path === '/api/v1/projects') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projects) })
    }
    if (request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}

const visibleTextFloor = async (page: Page, rootSelector: string) => page.locator(rootSelector).evaluate((root) => {
  const bad: Array<{ text: string; fontSize: string; cls: string }> = []
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    const text = (element.innerText || '').trim()
    if (!text || element.children.length > 0) continue
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') continue
    const size = Number.parseFloat(style.fontSize)
    if (size < 12) bad.push({ text: text.slice(0, 80), fontSize: style.fontSize, cls: element.className || '' })
  }
  return bad.slice(0, 20)
})

const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const channel = (value: number) => {
    const v = value / 255
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  const lum = (rgb: [number, number, number]) => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
  const l1 = lum(a), l2 = lum(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

const parseRgb = (value: string): [number, number, number] | null => {
  const match = value.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

const weakSlateContrast = async (page: Page) => page.locator('[data-workspace="projects"]').evaluate((root) => {
  const rows: Array<{ text: string; color: string; background: string; cls: string }> = []
  const parse = (value: string): [number, number, number, number] | null => {
    const match = value.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[, /]+([0-9.]+))?/) 
    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] == null ? 1 : Number(match[4])] : null
  }
  const blend = (fg: [number, number, number, number], bg: [number, number, number]): [number, number, number] => [
    Math.round(fg[0] * fg[3] + bg[0] * (1 - fg[3])),
    Math.round(fg[1] * fg[3] + bg[1] * (1 - fg[3])),
    Math.round(fg[2] * fg[3] + bg[2] * (1 - fg[3])),
  ]
  const isActuallyVisible = (element: HTMLElement) => {
    let cursor: HTMLElement | null = element
    while (cursor) {
      const style = getComputedStyle(cursor)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') <= 0.01) return false
      cursor = cursor.parentElement
    }
    return true
  }
  const effectiveBackground = (element: HTMLElement) => {
    const layers: [number, number, number, number][] = []
    let cursor: HTMLElement | null = element
    while (cursor) {
      const parsed = parse(getComputedStyle(cursor).backgroundColor)
      if (parsed && parsed[3] > 0) layers.push(parsed)
      cursor = cursor.parentElement
    }
    let background: [number, number, number] = [10, 12, 20]
    for (const layer of layers.reverse()) background = blend(layer, background)
    return `rgb(${background[0]}, ${background[1]}, ${background[2]})`
  }
  const candidates = root.querySelectorAll<HTMLElement>('.text-slate-500, .text-slate-600, .text-slate-700')
  for (const element of Array.from(candidates)) {
    const text = (element.innerText || '').trim()
    if (!text) continue
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0 || !isActuallyVisible(element)) continue
    const style = getComputedStyle(element)
    rows.push({ text: text.slice(0, 80), color: style.color, background: effectiveBackground(element), cls: element.className || '' })
  }
  return rows.slice(0, 80)
})

const assertReadable = async (page: Page) => {
  await expect(page.locator('[data-workspace="projects"]')).toBeVisible()
  const tiny = await visibleTextFloor(page, '[data-workspace="projects"]')
  expect(tiny, JSON.stringify(tiny, null, 2)).toEqual([])
  const rows = await weakSlateContrast(page)
  const bad = rows.filter((row) => {
    const fg = parseRgb(row.color), bg = parseRgb(row.background)
    return fg && bg ? contrast(fg, bg) < 4.5 : false
  })
  expect(bad, JSON.stringify(bad, null, 2)).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
}

const assertSurfaceLadder = async (page: Page) => {
  const values = await page.evaluate(() => {
    const bg = (selector: string) => getComputedStyle(document.querySelector(selector) as HTMLElement).backgroundColor
    return {
      base: bg('[data-workspace="projects"]'),
      rail: bg('[data-project-workbench-rail="true"]'),
      header: bg('[data-project-workbench-header="true"]'),
      nav: bg('[data-project-primary-nav="true"]'),
    }
  })
  expect(values.base).toBe('rgb(10, 12, 20)')
  expect(values.rail).toBe('rgb(15, 20, 32)')
  expect(values.header).toBe('rgb(15, 20, 32)')
  expect(values.nav).toBe('rgb(15, 20, 32)')
}

const focusProof = async (page: Page) => {
  const input = page.getByRole('textbox', { name: 'Find projects' })
  await input.focus()
  const focus = await input.evaluate((element) => {
    const style = getComputedStyle(element)
    return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor }
  })
  expect(Number.parseFloat(focus.width)).toBeGreaterThanOrEqual(2)
  expect(focus.style).not.toBe('none')
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((userId) => {
    localStorage.setItem('sysgrid-theme', 'nordic-frost-v1')
    localStorage.setItem('SYSGRID_USER_ID', userId)
  }, PROJECTS_ROOT_PREVIEW_USER)
  await installRoutes(page)
})

test('P01 readability rehearsal @readability-rehearsal', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects?id=80101&view=overview')
  await expect(page.locator('[data-project-overview="true"]')).toBeVisible()
  await assertReadable(page)
  await assertSurfaceLadder(page)
  await focusProof(page)
})

test('P01 high-value Overview stays readable at 1280x720 @readability-acceptance', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/projects?id=80101&view=overview')
  await expect(page.locator('[data-project-overview="true"]')).toBeVisible()
  await assertReadable(page)
  await assertSurfaceLadder(page)
  await focusProof(page)
})

test('P02 blocked project preserves clear hierarchy at 1440x900 @readability-acceptance', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects?id=80202&view=overview')
  await expect(page.locator('[data-project-workbench-header="true"]')).toBeVisible()
  await assertReadable(page)
  const header = page.locator('[data-project-workbench-header="true"]')
  await expect(header).toContainText('P02 — Recipe Release Guardrail — Change Control MVP')
})

test('P10 large Gantt remains contained and readable at 1920x1080 @readability-acceptance', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/projects?id=81010&view=timeline')
  const gantt = page.locator('[data-project-flagship-gantt="true"]')
  await expect(gantt).toBeVisible()
  await assertReadable(page)
  const bounds = await gantt.boundingBox()
  expect(bounds).not.toBeNull()
  expect((bounds?.x || 0) + (bounds?.width || 0)).toBeLessThanOrEqual(1921)
})

test('narrow Projects navigation remains reachable at 390x844 @readability-acceptance', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/projects/80101/home')
  const nav = page.locator('[data-project-primary-nav="true"]')
  await expect(nav).toBeVisible()
  await assertReadable(page)
  const geometry = await nav.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflowX: getComputedStyle(element).overflowX }))
  expect(geometry.overflowX).toBe('auto')
  expect(geometry.scrollWidth).toBeGreaterThanOrEqual(geometry.clientWidth)
  const planNavLink = nav.getByRole('link', { name: 'Plan', exact: true })
  await planNavLink.scrollIntoViewIfNeeded()
  await expect(planNavLink).toBeVisible()
})

test('Projects modal inherits elevated readability without changing the shared modal @readability-acceptance', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects?id=80101&view=overview')
  await page.getByRole('button', { name: 'Project', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const panelBackground = await dialog.locator(':scope > div').evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(panelBackground).toBe('rgb(24, 34, 53)')
  const tiny = await visibleTextFloor(page, '[role="dialog"]')
  expect(tiny, JSON.stringify(tiny, null, 2)).toEqual([])
})

test('readability diagnostics expose computed contract @readability-diagnostic', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects?id=80101&view=overview')
  const evidence = await page.evaluate(() => {
    const workspace = document.querySelector('[data-workspace="projects"]') as HTMLElement
    const header = document.querySelector('[data-project-workbench-header="true"]') as HTMLElement
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      workspaceBackground: getComputedStyle(workspace).backgroundColor,
      headerBackground: getComputedStyle(header).backgroundColor,
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }
  })
  console.log('SYSGRID_PROJECTS_READABILITY_DIAGNOSTIC', JSON.stringify(evidence))
  expect(evidence.theme).toBe('nordic-frost-v1')
})
