import { test, expect, Page, Locator } from '@playwright/test'
import { projectsRootPreviewPolicy } from './helpers/projects-root-preview'
import { writeFileSync } from 'node:fs'

type Project = Record<string, any>
type State = { getProject: () => Project; getPutCount: () => number; getProjectGetCount: () => number; resetWrites: () => void }

const iso = (ordinal: number) => new Date(ordinal * 86_400_000).toISOString().slice(0, 10)
const baseOrdinal = Math.floor(Date.UTC(2026, 8, 1) / 86_400_000)
const projectFixture = (): Project => {
  const tasks = Array.from({ length: 120 }, (_, index) => {
    const id = 1001 + index
    const start = baseOrdinal + index * 2
    const dependencyType = index === 1 ? 'FS' : (['FS', 'SS', 'FF', 'SF'] as const)[index % 4]
    const dependency = index === 0 ? [] : [{ id: String(id - 1), type: dependencyType, lag_days: index % 7 === 0 ? 1 : 0 }]
    return {
      id,
      name: `Gantt task ${index + 1}`,
      status: index % 17 === 0 ? 'Blocked' : index % 5 === 0 ? 'Review' : 'In Progress',
      progress: (index * 13) % 95,
      owner: `Planner ${index % 4}`,
      priority: index % 9 === 0 ? 'High' : 'Medium',
      start_date: iso(start),
      end_date: iso(start + (index === 4 ? 7 : 1)),
      order_index: (index + 1) * 10,
      dependencies_json: dependency,
      metadata_json: index === 2 ? { wbs_parent_id: 1002 } : {},
    }
  })
  return {
    id: 901,
    name: 'P01 — Flagship Gantt Modernization',
    parent_project_id: null,
    status: 'In Progress',
    priority: 'High',
    owner: 'Proof Operator',
    objective: 'One connected, modern planning surface',
    expected_outcomes: ['World-class Gantt acceptance'],
    start_date: iso(baseOrdinal),
    end_date: iso(baseOrdinal + 241),
    metadata_json: {
      adoption_state: 'Pilot',
      project_schedule_v2: {
        working_days: [1, 2, 3, 4, 5],
        baselines: [{ id: 'base-1', name: 'Approved baseline', captured_at: '2026-09-01T00:00:00Z', tasks: tasks.map((task: any) => ({ id: String(task.id), start_date: task.start_date, end_date: task.end_date })) }],
      },
    },
    tasks,
  }
}

const installIdentity = async (page: Page) => {
  await page.addInitScript(() => {
    localStorage.setItem('sysgrid-theme', 'nordic-frost-v1')
    localStorage.setItem('SYSGRID_USER_ID', 'proof_operator')
  })
}

const installRoutes = async (page: Page): Promise<State> => {
  let project = structuredClone(projectFixture())
  let putCount = 0
  let projectGetCount = 0
  const previews = new Map<string, any>()
  const story = () => ({ health: { level: 'On track', reason: 'OUT-40 fixture' }, delivery: { percent: 50, label: '50%', method: 'Canonical task progress' }, next_milestone: null, milestones: [], attention: [], attention_count: 0, acceptance_criteria: [], primary_metric: null, latest_update: null, governance: [], architecture: { assessment: 'Not assessed' }, resources: [], freshness: { updated_at: '2026-09-01T00:00:00Z', source: 'out40-fixture' }, coverage: { resources: 'complete' } })
  const canonical = () => ({ id: '901', display_key: 'PRJ-901', tenant_id: 1, name: project.name, objective: project.objective, owner_id: 'proof_operator', team_id: 1, phase: 'Executing', run_state: 'Active', priority: 'High', architecture_assessment: 'Not assessed', target_date: project.end_date, outcome_phase: 'Planned', outcome_result: 'Unassessed', revision: 1, graph_revision: 1, capabilities: { view: true, edit: true, export: true, transition: true }, story: story() })
  const schedule = () => ({ project: canonical(), project_id: '901', project_revision: 1, graph_revision: 1, calendar: { id: 'out40-calendar', timezone: 'UTC', working_weekdays: [0, 1, 2, 3, 4, 5, 6], exceptions: [], revision: 1 }, tasks: project.tasks.map((task: any, index: number) => ({ id: String(task.id), title: task.name, kind: task.metadata_json?.milestone ? 'Milestone' : 'Task', owner_id: task.owner, parent_task_id: task.metadata_json?.wbs_parent_id ? String(task.metadata_json.wbs_parent_id) : null, metadata_json: { ...task.metadata_json, is_milestone: Boolean(task.metadata_json?.milestone) }, status: task.status, progress: task.progress, order_key: String(task.order_index || (index + 1) * 10), start_date: task.start_date, end_date: task.end_date, point_date: task.metadata_json?.milestone ? task.start_date : null, revision: 1 })), dependencies: project.tasks.flatMap((task: any) => (task.dependencies_json || []).map((dep: any, index: number) => ({ id: `edge-${task.id}-${index}`, predecessor_id: String(dep.id), successor_id: String(task.id), dependency_type: dep.type || 'FS', lag_days: dep.lag_days || 0, active: true, revision: 1 }))), external_dependencies: [], baselines: [], baseline_variance: [], analysis: { rows: [], critical_task_ids: [], status: 'Complete' }, forecast: { tasks: [], coverage: 'complete' }, external_warnings: [], history: [] })
  await page.route('**/api/v2/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname
    const json = (value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) })
    if (request.method() === 'GET' && path === '/api/v2/projects') return json({ items: [canonical()], summary: { Executing: 1 }, as_of: '2026-09-01T00:00:00Z', source_revision: 'out40-fixture', coverage: { projects: 'complete' }, next_cursor: null })
    if (request.method() === 'GET' && path === '/api/v2/projects/901') return json(canonical())
    if (request.method() === 'GET' && path === '/api/v2/projects/901/schedule') return json(schedule())
    if (request.method() === 'POST' && path === '/api/v2/projects/901/schedule/preview') {
      const body = request.postDataJSON?.() || {}; const delta = Number(body.parameters?.delta_workdays || 1); const ids = (body.selection_ids || []).map(String)
      const changes = ids.map((id: string) => { const task = project.tasks.find((item: any) => String(item.id) === id); if (!task) return null; const shift = (value: string) => new Date(Date.parse(value) + delta * 86400000).toISOString().slice(0, 10); const before = { start_date: task.start_date, end_date: task.end_date }; const after = body.operation === 'resize' ? body.parameters?.edge === 'start' ? { ...before, start_date: shift(task.start_date) } : { ...before, end_date: shift(task.end_date) } : { start_date: shift(task.start_date), end_date: shift(task.end_date) }; return { task_id: id, before, after, delta_workdays: delta, explanation_chain: [{ kind: 'direct-edit' }] } }).filter(Boolean)
      const preview = { preview_id: `out40-preview-${Date.now()}-${Math.random()}`, content_hash: 'f'.repeat(64), base_graph_revision: 1, calendar_revision: 1, expires_at: new Date(Date.now() + 60_000).toISOString(), changes, failures: [] }; previews.set(preview.preview_id, preview); return json(preview)
    }
    if (request.method() === 'POST' && path === '/api/v2/projects/901/commands') { const body = request.postDataJSON?.() || {}; const preview = previews.get(body.payload?.preview_id); for (const change of preview?.changes || []) { const task = project.tasks.find((item: any) => String(item.id) === String(change.task_id)); if (task) Object.assign(task, change.after) }; if (body.type === 'dependency.create') { const task = project.tasks.find((item: any) => String(item.id) === String(body.payload?.successor_id)); if (task) task.dependencies_json = [...(task.dependencies_json || []), { id: String(body.payload.predecessor_id), type: body.payload.dependency_type || 'FS', lag_days: Number(body.payload.lag_days || 0) }] }; if (body.type === 'dependency.remove') { const dependencyId = String(body.payload?.dependency_id || ''); project.tasks = project.tasks.map((task: any) => ({ ...task, dependencies_json: (task.dependencies_json || []).filter((dep: any, index: number) => `edge-${task.id}-${index}` !== dependencyId) })) }; putCount += 1; return json({ status: 'applied', event_id: `event-${putCount}` }) }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Unexpected OUT-40 v2 request' }) })
  })
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname
    const json = (value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) })
    if (request.method() === 'POST' && path === '/api/v1/observability/performance') return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ accepted: true }) })
    if (request.method() === 'GET' && path.endsWith('/settings/bootstrap')) return json({ VITE_API_BASE_URL: url.origin, DEFAULT_USER_ID: 'proof_operator' })
    if (request.method() === 'GET' && path === '/api/v1/policy/module-availability') return json(projectsRootPreviewPolicy)
    if (request.method() === 'GET' && path === '/api/v1/settings/user/profile') return json({ id: 'proof_operator', username: 'proof_operator', full_name: 'Proof Operator', team: 'Operations', team_id: 1, is_admin: true, permissions: { all: 3, projects: 3 } })
    if (request.method() === 'GET' && path === '/api/v1/settings/user/settings') return json({ theme: 'nordic-frost-v1' })
    if (request.method() === 'GET' && path === '/api/v1/settings/operators') return json([{ id: 1, username: 'proof_operator', full_name: 'Proof Operator', team: 'Operations', team_id: 1 }])
    if (request.method() === 'GET' && path === '/api/v1/health') return json({ status: 'ok' })
    if (request.method() === 'GET' && path === '/api/v1/projects') { projectGetCount += 1; return json([project]) }
    if (request.method() === 'PUT' && path === '/api/v1/projects/901') { putCount += 1; project = structuredClone(request.postDataJSON?.() || JSON.parse(request.postData() || '{}')); return json(project) }
    if (request.method() === 'GET') return json([])
    return json({})
  })
  return { getProject: () => project, getPutCount: () => putCount, getProjectGetCount: () => projectGetCount, resetWrites: () => { putCount = 0 } }
}

const collectFailures = (page: Page) => {
  const failures: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console:${message.text()}`) })
  page.on('pageerror', (error) => failures.push(`pageerror:${error.message}`))
  page.on('requestfailed', (request) => {
    const pathname = new URL(request.url()).pathname
    if (request.method() === 'POST' && pathname === '/api/v1/observability/performance') return
    failures.push(`requestfailed:${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`)
  })
  return failures
}

const center = async (locator: Locator) => {
  const box = await locator.boundingBox(); expect(box).not.toBeNull()
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
}
const expectMinTarget = async (locator: Locator, label = 'control') => {
  const box = await locator.boundingBox(); expect(box).not.toBeNull()
  const style = await locator.evaluate((element) => { const node = element as HTMLElement; const computed = getComputedStyle(node); return { tag: node.tagName, minHeight: computed.minHeight, height: computed.height, transform: computed.transform, zoom: (computed as any).zoom || '1' } })
  expect(box!.width, `${label} width ${JSON.stringify(style)}`).toBeGreaterThanOrEqual(40); expect(box!.height, `${label} height ${JSON.stringify(style)}`).toBeGreaterThanOrEqual(40)
}
const dependencyIds = (task: any) => (task?.dependencies_json || []).map((dep: any) => String(dep?.id ?? dep?.task_id ?? dep))

const openTimeline = async (page: Page) => {
  await page.goto('/projects?id=901&view=timeline')
  const gantt = page.locator('[data-project-modern-gantt="true"]')
  await expect(gantt).toBeVisible()
  await expect(gantt).toHaveCount(1)
  return gantt
}

test('OUT-40 Slice H P10 Gantt is bounded, aligned and connector-anchored @out40-slice-h-rehearsal', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  const failures = collectFailures(page); await installIdentity(page); await installRoutes(page); const gantt = await openTimeline(page)

  const rows = gantt.locator('[data-project-timeline-row="true"]')
  const bars = gantt.locator('[data-project-timeline-bar="true"]')
  const connectors = gantt.locator('[data-project-timeline-dependency-connector="true"]')
  const gridNodes = gantt.locator('[data-project-timeline-tick="true"], [data-project-timeline-grid="true"]')
  expect(await rows.count()).toBeLessThanOrEqual(40)
  expect(await bars.count()).toBeLessThanOrEqual(40)
  expect(await connectors.count()).toBeLessThanOrEqual(80)
  expect(await gridNodes.count()).toBeLessThanOrEqual(64)

  const row = gantt.locator('[data-project-timeline-row="true"][data-task-id="1001"]')
  const bar = gantt.locator('[data-project-semantic-id="task-bar-1001"]')
  const rc = await center(row); const bc = await center(bar)
  expect(Math.abs(rc.y - bc.y)).toBeLessThanOrEqual(1)

  await expect(gantt.locator('[data-project-semantic-id="dependency-1001:1002:FS:0"]')).toBeVisible()
  const sourceEndpoint = gantt.locator('[data-project-connector-endpoint="source"][data-project-relation-key="1001:1002:FS:0"]')
  const targetEndpoint = gantt.locator('[data-project-connector-endpoint="target"][data-project-relation-key="1001:1002:FS:0"]')
  const sourcePort = gantt.locator('[data-project-timeline-row="true"][data-task-id="1001"] [data-project-dependency-port="true"][data-edge="finish"]')
  const targetPort = gantt.locator('[data-project-timeline-row="true"][data-task-id="1002"] [data-project-dependency-port="true"][data-edge="start"]')
  for (const [endpoint, port] of [[sourceEndpoint, sourcePort], [targetEndpoint, targetPort]] as const) {
    const ec = await center(endpoint); const pc = await center(port)
    expect(Math.hypot(ec.x - pc.x, ec.y - pc.y)).toBeLessThanOrEqual(2)
  }
  expect(failures).toEqual([])
})

test('OUT-40 Slice H keyboard dependency add/remove is explicit, canonical and focus-stable @out40-slice-h-acceptance', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const failures = collectFailures(page); await installIdentity(page); const state = await installRoutes(page); const gantt = await openTimeline(page)
  state.resetWrites()

  const source = page.getByRole('button', { name: 'Start dependency from Gantt task 1', exact: true })
  await expectMinTarget(source); await source.focus(); await source.press('Enter')
  await expect(gantt.locator('[data-project-timeline-live-status="true"]')).toHaveText('Dependency source selected: Gantt task 1')
  const target = page.getByRole('button', { name: 'Add dependency from Gantt task 1 to Gantt task 4', exact: true })
  await expectMinTarget(target); await target.press('Enter')
  await expect.poll(() => state.getPutCount()).toBe(1)
  await expect.poll(() => dependencyIds(state.getProject().tasks.find((task: any) => task.id === 1004))).toContain('1001')
  await expect(gantt.locator('[data-project-timeline-live-status="true"]')).toHaveText('Dependency added: Gantt task 1 → Gantt task 4')
  await expect(gantt.locator('[data-project-timeline-row="true"][data-task-id="1004"] button[data-project-timeline-dependency-keyboard="true"]')).toBeFocused()

  const connector = gantt.locator('[data-project-timeline-dependency-connector="true"][data-source-task-id="1001"][data-target-task-id="1004"]')
  await expect(connector).toBeVisible(); await connector.focus(); await connector.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Dependency details', exact: true })
  await expect(dialog).toBeVisible()
  const remove = dialog.getByRole('button', { name: 'Remove dependency', exact: true })
  await expectMinTarget(remove); await remove.focus(); await remove.press('Enter')
  await expect.poll(() => state.getPutCount()).toBe(2)
  await expect.poll(() => dependencyIds(state.getProject().tasks.find((task: any) => task.id === 1004))).not.toContain('1001')
  await expect(gantt.locator('[data-project-timeline-live-status="true"]')).toHaveText('Dependency removed: Gantt task 1 → Gantt task 4')
  await expect(gantt.locator('[data-project-semantic-id="dependency-source-1004"]')).toBeFocused()
  expect(failures).toEqual([])
})

test('OUT-40 Slice H scroll zoom filter collapse are mutation-free and stay bounded @out40-slice-h-acceptance', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  const failures = collectFailures(page); await installIdentity(page); const state = await installRoutes(page); const gantt = await openTimeline(page)
  const initialGets = state.getProjectGetCount(); state.resetWrites()
  const scrollport = gantt.locator('[data-project-timeline-scrollport="true"]')
  for (let cycle = 0; cycle < 20; cycle += 1) {
    const elapsed = await gantt.evaluate(async (root, index) => {
      const scroll = root.querySelector<HTMLElement>('[data-project-timeline-scrollport="true"]')!
      scroll.scrollTop = (index % 6) * 620
      scroll.scrollLeft = (index % 5) * 420
      scroll.dispatchEvent(new Event('scroll', { bubbles: true }))
      const value = index % 2 === 0 ? 'month' : 'week'
      const select = root.querySelector<HTMLSelectElement>('select[aria-label="Timeline zoom"]')!
      const started = performance.now(); select.value = value; select.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      return performance.now() - started
    }, cycle)
    expect(elapsed).toBeLessThanOrEqual(250)
  }
  await gantt.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByLabel('Find timeline tasks or owners').fill('Gantt task 2')
  await page.getByLabel('Find timeline tasks or owners').fill('')
  const collapse = gantt.getByRole('button', { name: 'Collapse Gantt task 2', exact: true })
  await collapse.click(); await gantt.getByRole('button', { name: 'Expand Gantt task 2', exact: true }).click()
  await expect.poll(() => state.getPutCount()).toBe(0)
  expect(state.getProjectGetCount()).toBe(initialGets)
  expect(await gantt.locator('[data-project-timeline-row="true"]').count()).toBeLessThanOrEqual(40)
  expect(await gantt.locator('[data-project-timeline-dependency-connector="true"]').count()).toBeLessThanOrEqual(80)
  expect(await gantt.locator('[data-project-timeline-tick="true"], [data-project-timeline-grid="true"]').count()).toBeLessThanOrEqual(64)
  expect(failures).toEqual([])
})

test('OUT-40 Slice H bar move and resize each commit one Project PUT @out40-slice-h-acceptance', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const failures = collectFailures(page); await installIdentity(page); const state = await installRoutes(page); const gantt = await openTimeline(page)
  state.resetWrites()
  const bar = gantt.locator('[data-project-semantic-id="task-bar-1001"]')
  const box = await bar.boundingBox(); expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.down(); await page.mouse.move(box!.x + box!.width / 2 + 28, box!.y + box!.height / 2, { steps: 3 }); await page.mouse.up()
  await expect.poll(() => state.getPutCount()).toBe(1)
  const movedStart = state.getProject().tasks.find((task: any) => task.id === 1001).start_date
  expect(movedStart).not.toBe(iso(baseOrdinal))

  await page.goto('/projects?id=901&view=timeline'); await expect(gantt).toBeVisible(); state.resetWrites()
  const compactBar = gantt.locator('[data-project-semantic-id="task-bar-1002"]')
  const compactBox = await compactBar.boundingBox(); expect(compactBox).not.toBeNull(); expect(compactBox!.width).toBeLessThan(120)
  await expect(compactBar).toHaveAttribute('data-status', 'in-progress')
  await expect(gantt.locator('.sg-status-legend')).toContainText('To do')
  await expect(gantt.locator('.sg-status-legend')).toContainText('In progress')
  await expect(gantt.locator('.sg-status-legend')).toContainText('Review')
  await expect(gantt.locator('.sg-status-legend')).toContainText('Blocked')
  await expect(gantt.locator('.sg-status-legend')).toContainText('Done')
  expect(await compactBar.evaluate((element) => getComputedStyle(element, '::before').backgroundColor)).toBe('rgb(37, 99, 235)')
  expect(await gantt.locator('[data-project-semantic-id="task-bar-1001"]').evaluate((element) => getComputedStyle(element, '::before').backgroundColor)).toBe('rgb(190, 54, 85)')
  const resizeEnd = gantt.locator('[data-project-semantic-id="resize-end-1002"]')
  await resizeEnd.scrollIntoViewIfNeeded()
  await expectMinTarget(resizeEnd)
  const originalEnd = state.getProject().tasks.find((task: any) => task.id === 1002).end_date
  const rb = await resizeEnd.boundingBox(); expect(rb).not.toBeNull()
  await page.mouse.move(rb!.x + rb!.width / 2, rb!.y + rb!.height / 2); await page.mouse.down(); await page.mouse.move(rb!.x + rb!.width / 2 + 28, rb!.y + rb!.height / 2, { steps: 3 }); await page.mouse.up()
  await expect.poll(() => state.getPutCount()).toBe(1)
  expect(state.getProject().tasks.find((task: any) => task.id === 1002).end_date).not.toBe(originalEnd)
  state.resetWrites()
  const resizeStart = gantt.locator('[data-project-semantic-id="resize-start-1002"]')
  await expectMinTarget(resizeStart)
  const beforeShorten = state.getProject().tasks.find((task: any) => task.id === 1002)
  const previousStart = beforeShorten.start_date; const previousFinish = beforeShorten.end_date
  const sb = await resizeStart.boundingBox(); expect(sb).not.toBeNull()
  await page.mouse.move(sb!.x + sb!.width / 2, sb!.y + sb!.height / 2); await page.mouse.down(); await page.mouse.move(sb!.x + sb!.width / 2 + 14, sb!.y + sb!.height / 2, { steps: 3 }); await page.mouse.up()
  await expect.poll(() => state.getPutCount()).toBe(1)
  expect(state.getProject().tasks.find((task: any) => task.id === 1002).start_date).not.toBe(previousStart)
  expect(state.getProject().tasks.find((task: any) => task.id === 1002).end_date).toBe(previousFinish)
  await page.screenshot({ path: process.env.SYSGRID_PROJECTS_UX_GANTT_SCREENSHOT || testInfo.outputPath('projects-timeline-gantt-ux.png'), fullPage: false })
  expect(failures).toEqual([])
})

test('OUT-40 Slice H compact desktop Gantt contains page overflow and keeps primary controls >=40px @out40-slice-h-acceptance', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  const failures = collectFailures(page); await installIdentity(page); await installRoutes(page); const gantt = await openTimeline(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  const compactControls: Array<[string, Locator]> = [
    ['Today', gantt.getByRole('button', { name: 'Today', exact: true })],
    ['Fit', gantt.getByRole('button', { name: 'Fit', exact: true })],
    ['Timeline zoom', gantt.getByLabel('Timeline zoom', { exact: true })],
    ['Filters', gantt.getByRole('button', { name: 'Filters', exact: true })],
    ['Dependency start', gantt.getByRole('button', { name: 'Start dependency from Gantt task 1', exact: true })],
  ]
  for (const [label, control] of compactControls) await expectMinTarget(control, label)
  const scrollport = gantt.locator('[data-project-timeline-scrollport="true"]'); const scrollBox = await scrollport.boundingBox(); expect(scrollBox).not.toBeNull(); expect(scrollBox!.x).toBeGreaterThanOrEqual(0); expect(scrollBox!.x + scrollBox!.width).toBeLessThanOrEqual(1025)
  expect(failures).toEqual([])
})

test('P12 task-1001 virtualization remains bounded in the active schedule @p12-task-1001', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  const failures = collectFailures(page)
  await installIdentity(page)
  await installRoutes(page)
  const gantt = await openTimeline(page)
  const row = gantt.locator('[data-project-timeline-row="true"][data-task-id="1001"]')
  const bar = gantt.locator('[data-project-semantic-id="task-bar-1001"]')
  await expect(row).toBeVisible()
  await expect(bar).toBeVisible()
  await row.locator('button.sg-task-name').click()
  await expect(row).toHaveAttribute('aria-selected', 'true')
  const selected = await row.getAttribute('aria-selected') === 'true'
  const scrollportHeight = await gantt.locator('[data-project-timeline-scrollport="true"]').evaluate((element) => (element as HTMLElement).clientHeight)
  const realizedRows = await gantt.locator('[data-project-timeline-row="true"]').count()
  const domBound = Math.ceil(scrollportHeight / 48) + 16
  const evidence = {
    schema: 'sysgrid.pv1.task-1001-regression.v1',
    check_id: 'retained:task-1001-virtualization',
    candidate_git_sha: process.env.PV1_CANDIDATE_SHA || 'local-test-candidate',
    candidate_tree_sha: process.env.PV1_CANDIDATE_TREE || 'local-test-tree',
    requirement_ids: ['PV-PERF-002', 'PV-GATE-006'],
    fixture_profile: 'OUT-40 120-task WBS fixture',
    logical_task_count: 120,
    target_task_id: '1001',
    target_addressable: true,
    target_visible: await row.isVisible(),
    target_selectable: selected,
    realized_row_count: realizedRows,
    scrollport_height: scrollportHeight,
    dom_bound: domBound,
    verdict: !failures.length && realizedRows <= domBound && selected,
  }
  if (process.env.P12_TASK_1001_OUTPUT) writeFileSync(process.env.P12_TASK_1001_OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`)
  expect(failures).toEqual([])
  expect(realizedRows).toBeLessThanOrEqual(domBound)
})
