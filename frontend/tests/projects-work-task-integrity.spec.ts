import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expect, Page, test, TestInfo, Locator } from '@playwright/test'
import { PROJECTS_ROOT_PREVIEW_USER, projectsRootPreviewPolicy } from './helpers/projects-root-preview'

type Task = { id: string; title: string; kind: string; parent_task_id: string | null; order_key: string; owner_id: string; status: string; progress: number; revision: number; end_date?: string }
type Work = { project_id: string; project_revision: number; graph_revision: number; items: Task[]; blockers: any[]; capabilities: Record<string, boolean> }
type Command = Record<string, any> & { idempotencyKey: string }
type RouteMode = 'success' | 'reject' | 'internal' | 'defer'

const initialWork = (projectId: string): Work => ({
  project_id: projectId,
  project_revision: 1,
  graph_revision: 1,
  items: projectId === 'p1'
    ? [
      { id: 'task-1', title: 'Canonical task', kind: 'Task', parent_task_id: null, order_key: '1024', owner_id: 'mina', status: 'To Do', progress: 25, revision: 1, end_date: '2026-10-01' },
      { id: 'task-2', title: 'Second task', kind: 'Task', parent_task_id: null, order_key: '2048', owner_id: 'mina', status: 'To Do', progress: 0, revision: 1 },
    ]
    : [{ id: 'task-b', title: 'Project B task', kind: 'Task', parent_task_id: null, order_key: '1024', owner_id: 'mina', status: 'To Do', progress: 0, revision: 1 }],
  blockers: [],
  capabilities: { view: true, edit: true, transition: true },
})

const focusFor = (projectId: string) => ({
  scope: 'project',
  project_id: projectId,
  total: projectId === 'p1' ? 1 : 0,
  engine_version: 'pv-focus-1',
  items: projectId === 'p1' ? [{
    id: 'task:task-1',
    entity_kind: 'task',
    entity_id: 'task-1',
    project_id: 'p1',
    project_name: 'Project A',
    title: 'Canonical task',
    due_context: 'Due in five days',
    bucket_label: 'In progress or review',
    why_here: 'In progress or review: current project work',
    primary_action: 'Open task',
    pinned: false,
  }] : [],
  all_priorities: [],
})

const identity = async (page: Page) => page.addInitScript((userId: string) => {
  localStorage.setItem('sysgrid-theme', 'nordic-frost-v1')
  localStorage.setItem('SYSGRID_USER_ID', userId)
}, PROJECTS_ROOT_PREVIEW_USER)

async function installRoutes(page: Page) {
  const projects = new Map([['p1', initialWork('p1')], ['p2', initialWork('p2')]])
  const commandModes: RouteMode[] = []
  const pendingCommands: Array<{ route: any; command: Command }> = []
  const pendingWork: Array<{ projectId: string; route: any }> = []
  const deferredWork = new Map<string, number>()
  const commands: Command[] = []
  let created = 0

  const replyCommand = async (entry: { route: any; command: Command }, mode: RouteMode) => {
    if (mode === 'reject') return entry.route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'REVISION_CONFLICT', message: 'The task changed on the server. Refresh and try again.' }) })
    if (mode === 'internal') return entry.route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Traceback at private-worker.js:42; stack trace sentinel' }) })
    const projectId = new URL(entry.route.request().url()).pathname.match(/^\/api\/v2\/projects\/([^/]+)\/commands$/)?.[1]
    const work = projectId ? projects.get(projectId) : undefined
    if (work) {
      const { type, payload } = entry.command
      if (type === 'task.create') {
        created += 1
        work.items.push({ id: `created-${created}`, title: payload.title, kind: 'Task', parent_task_id: null, order_key: String((created + 2) * 1024), owner_id: 'mina', status: 'To Do', progress: 0, revision: 1 })
      }
      if (type === 'task.transition') {
        const task = work.items.find((item) => item.id === String(payload.task_id))
        if (task) task.status = payload.to_status
      }
      if (type === 'task.bulk') {
        for (const id of payload.task_ids as string[]) {
          const task = work.items.find((item) => item.id === String(id))
          if (task) task.status = payload.operation === 'cancel' ? 'Cancelled' : String(payload.value)
        }
      }
      if (type === 'task.update_fields') {
        const task = work.items.find((item) => item.id === String(payload.task_id))
        if (task && typeof payload.progress === 'number') task.progress = payload.progress
      }
    }
    return entry.route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'applied', event_id: `event-${commands.length}` }) })
  }

  await identity(page)
  await page.route('**/api/v2/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === '/api/v2/focus') {
      const projectId = url.searchParams.get('project_id') || 'p1'
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(focusFor(projectId)) })
    }
    const workMatch = url.pathname.match(/^\/api\/v2\/projects\/([^/]+)\/work$/)
    if (request.method() === 'GET' && workMatch) {
      const projectId = workMatch[1]
      const deferred = deferredWork.get(projectId) || 0
      if (deferred > 0) {
        deferredWork.set(projectId, deferred - 1)
        pendingWork.push({ projectId, route })
        return
      }
      const work = projects.get(projectId)
      if (!work) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_FOUND', message: 'Project unavailable.' }) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(structuredClone(work)) })
    }
    const commandMatch = url.pathname.match(/^\/api\/v2\/projects\/([^/]+)\/commands$/)
    if (request.method() === 'POST' && commandMatch) {
      const body = request.postDataJSON?.() || {}
      const command = { ...body, idempotencyKey: request.headers()['idempotency-key'] || '' }
      commands.push(command)
      const mode = commandModes.shift() || 'success'
      const entry = { route, command }
      if (mode === 'defer') {
        pendingCommands.push(entry)
        return
      }
      return replyCommand(entry, mode)
    }
    if (request.method() === 'POST' && url.pathname === '/api/v2/focus/commands') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'applied' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (request.method() === 'POST' && path === '/api/v1/observability/performance') return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ accepted: true }) })
    if (request.method() === 'GET' && path.endsWith('/settings/bootstrap')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ VITE_API_BASE_URL: url.origin, DEFAULT_USER_ID: PROJECTS_ROOT_PREVIEW_USER }) })
    if (request.method() === 'GET' && path === '/api/v1/settings/user/profile') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: PROJECTS_ROOT_PREVIEW_USER, username: PROJECTS_ROOT_PREVIEW_USER, full_name: 'Synthetic Root Preview Proof', is_admin: false, permissions: {} }) })
    if (request.method() === 'GET' && path === '/api/v1/settings/user/settings') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ theme: 'nordic-frost-v1' }) })
    if (request.method() === 'GET' && path === '/api/v1/health') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) })
    if (request.method() === 'GET' && path === '/api/v1/policy/module-availability') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projectsRootPreviewPolicy) })
    if (request.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })

  return {
    commands,
    getWork: (projectId = 'p1') => projects.get(projectId)!,
    hasPendingWork: (projectId: string) => pendingWork.some((entry) => entry.projectId === projectId),
    queueCommand: (mode: RouteMode) => commandModes.push(mode),
    deferNextWork: (projectId: string) => deferredWork.set(projectId, (deferredWork.get(projectId) || 0) + 1),
    resolveCommand: async (mode: RouteMode = 'success') => {
      const entry = pendingCommands.shift()
      if (!entry) throw new Error('No deferred command is waiting.')
      await replyCommand(entry, mode)
    },
    resolveWork: async (projectId: string) => {
      const index = pendingWork.findIndex((entry) => entry.projectId === projectId)
      if (index < 0) throw new Error(`No deferred ${projectId} Work response is waiting.`)
      const [entry] = pendingWork.splice(index, 1)
      await entry.route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(structuredClone(projects.get(projectId))) })
    },
  }
}

async function captureProof(page: Page, testInfo: TestInfo, proofId: string, profile: { name: string; width: number; height: number }, negativeControlResult?: unknown) {
  await expect(page.locator('[data-p05-work-owner="true"]')).toBeVisible()
  await expect(page.locator('.p05-state')).toHaveCount(0)
  await expect(page.locator('[data-p05-work-owner="true"]')).toHaveAttribute('data-p05-pending-command-count', '0')
  const paths = {
    png: testInfo.outputPath('task-integrity', `${proofId}.png`),
    json: testInfo.outputPath('task-integrity', `${proofId}.json`),
  }
  const pageState = await page.evaluate(({ proofId: id, profile: viewport }) => {
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }
    }
    const visible = (element: Element) => {
      const node = element as HTMLElement
      const style = getComputedStyle(node)
      return node.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !node.closest('[hidden], [inert], [aria-hidden="true"]')
    }
    const name = (element: Element) => {
      const node = element as HTMLElement
      return node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText?.trim().replace(/\s+/g, ' ') || node.tagName.toLowerCase()
    }
    const actionElements = Array.from(document.querySelectorAll('.p05-task-panel button, .p05-work-owner button, .p05-work-owner select, nav[aria-label="Work navigation"] a, .p05-focus-actions a'))
    const selectedTaskIds = Array.from(document.querySelectorAll<HTMLInputElement>('.p05-work-owner input[type="checkbox"][aria-label^="Select "]:checked')).map((input) => input.dataset.taskId || '')
    const owner = document.querySelector<HTMLElement>('[data-p05-work-owner="true"]')
    const panel = document.querySelector<HTMLElement>('.p05-task-panel')
    const grid = document.querySelector<HTMLElement>('.p05-treegrid')
    const board = document.querySelector<HTMLElement>('.p05-board')
    const active = document.activeElement as HTMLElement | null
    return {
      proofId: id,
      route: `${location.pathname}${location.search}`,
      projectId: owner?.dataset.projectId || location.pathname.split('/')[2] || null,
      taskId: panel?.dataset.taskId || null,
      viewport: { ...viewport, devicePixelRatio: window.devicePixelRatio, documentWidth: document.documentElement.clientWidth, documentHeight: document.documentElement.clientHeight },
      selectedTaskIds,
      draftTitle: document.querySelector<HTMLInputElement>('.p05-inline-add input')?.value ?? null,
      visibleAlert: Array.from(document.querySelectorAll<HTMLElement>('[role="alert"]')).filter(visible).map((element) => element.innerText.trim()).join(' '),
      scroll: { windowX: window.scrollX, windowY: window.scrollY, treegridTop: grid?.scrollTop || 0, boardLeft: board?.scrollLeft || 0, taskPanelTop: panel?.scrollTop || 0 },
      focusedElement: active ? { tag: active.tagName.toLowerCase(), role: active.getAttribute('role'), name: name(active), id: active.id || null } : null,
      pending: { commandCount: Number(owner?.dataset.p05PendingCommandCount || 0), visibleLoadingMessages: Array.from(document.querySelectorAll('.p05-state,[aria-busy="true"]')).filter(visible).length },
      readyState: document.readyState,
      requiredActionInventory: actionElements.filter(visible).map((element) => ({ name: name(element), tag: element.tagName.toLowerCase(), enabled: !(element as HTMLButtonElement).disabled && element.getAttribute('aria-disabled') !== 'true', visible: visible(element), box: box(element) })),
      textContrast: ['.p05-task-panel h2', '.p05-task-panel p:not(.p05-eyebrow):not(.p05-muted)', '.p05-board section > h3', '.p05-card label span', '.p05-error[role="alert"]'].flatMap((selector) => {
        const element = document.querySelector<HTMLElement>(selector)
        if (!element || !visible(element)) return []
        const rgb = (value: string) => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [0, 0, 0]
        const luminance = (value: number[]) => value.map((raw) => { const channel = raw / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4 }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
        const foreground = getComputedStyle(element).color
        let ancestor: HTMLElement | null = element
        let background = 'rgb(255, 255, 255)'
        while (ancestor) {
          const candidate = getComputedStyle(ancestor).backgroundColor
          if (candidate !== 'rgba(0, 0, 0, 0)' && !candidate.endsWith(', 0)')) { background = candidate; break }
          ancestor = ancestor.parentElement
        }
        const [a, b] = [luminance(rgb(foreground)), luminance(rgb(background))].sort((left, right) => right - left)
        return [{ selector, foreground, background, ratio: (a + 0.05) / (b + 0.05) }]
      }),
      bodyHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      pairedCapture: { stateSnapshotAndPngShareProofId: true, browserActionsBetweenSnapshotAndPng: 0 },
    }
  }, { proofId, profile })
  const candidateSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const record = { candidateSha, capturedAt: new Date().toISOString(), negativeControlResult: negativeControlResult || null, pageState }
  for (const contrast of pageState.textContrast) expect(contrast.ratio, `${contrast.selector} text contrast must meet WCAG AA`).toBeGreaterThanOrEqual(4.5)
  await mkdir(dirname(paths.png), { recursive: true })
  await page.screenshot({ path: paths.png, animations: 'disabled' })
  await writeFile(paths.json, `${JSON.stringify(record, null, 2)}\n`)
  await testInfo.attach(`${proofId}.png`, { path: paths.png, contentType: 'image/png' })
  await testInfo.attach(`${proofId}.json`, { path: paths.json, contentType: 'application/json' })
  return record
}

async function clippedActionResult(page: Page) {
  const control = page.locator('[data-proof-clipped-control="true"]')
  if (!await control.count()) return { rejected: false, reason: 'missing-control' }
  const geometry = await inspectAction(control)
  return { rejected: geometry.reason === 'outside-viewport', reason: geometry.reason, box: geometry.box }
}

async function inspectAction(control: Locator) {
  return control.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const fullyInViewport = rect.left >= 0 && rect.top >= 0 && rect.right <= document.documentElement.clientWidth && rect.bottom <= document.documentElement.clientHeight
    const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    const style = getComputedStyle(element)
    const hidden = element.getClientRects().length === 0 || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || Boolean(element.closest('[hidden], [inert], [aria-hidden="true"]'))
    const unobscured = Boolean(center && (center === element || element.contains(center)))
    const reason = hidden ? 'hidden-or-inert' : !fullyInViewport ? 'outside-viewport' : !unobscured ? 'obscured' : null
    return { fullyInViewport, unobscured, hidden, reason, box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }, fontSize: Number.parseFloat(style.fontSize), text: (element as HTMLElement).innerText?.trim() || element.getAttribute('aria-label') || '' }
  })
}

async function expectReachable(control: Locator) {
  await expect(control).toBeVisible()
  await expect(control).toHaveAccessibleName(/\S/)
  await expect(control).toBeEnabled()
  await control.scrollIntoViewIfNeeded()
  const result = await inspectAction(control)
  expect(result.fullyInViewport, `control must be fully inside the viewport: ${result.text}; reason=${result.reason}`).toBe(true)
  expect(result.unobscured, `control must not be covered by another element: ${result.text}; reason=${result.reason}`).toBe(true)
  expect(result.hidden, `control must not have hidden or inert ancestry: ${result.text}`).toBe(false)
  expect(result.fontSize, `control text must remain readable: ${result.text}`).toBeGreaterThanOrEqual(10)
}

const boardCard = (page: Page, title: string) => page.locator('.p05-card').filter({ has: page.getByText(title, { exact: true }) }).first()

test('List, Board, and Focus resolve the same authorized task panel with deterministic close and focus return', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const state = await installRoutes(page)
  await page.goto('/projects/p1/work?layout=board')
  const card = boardCard(page, 'Canonical task')
  const open = card.getByRole('button', { name: 'Open task', exact: true })
  await open.click()
  const panel = page.locator('.p05-task-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('data-task-id', 'task-1')
  await expect(panel).toContainText('Canonical task')
  await expect(panel).toContainText('Owner: mina')
  await expect(panel.getByRole('button', { name: 'Mark done', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await expect(state.commands).toHaveLength(0)
  await captureProof(page, testInfo, 'board-panel-open-desktop', { name: 'desktop', width: 1440, height: 900 })

  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(panel).toHaveCount(0)
  await expect(open).toBeFocused()
  await captureProof(page, testInfo, 'board-panel-closed-focus-restored-desktop', { name: 'desktop', width: 1440, height: 900 })
  const move = card.getByRole('combobox', { name: 'Move Canonical task to', exact: true })
  await expectReachable(move)
  await move.selectOption('Blocked')
  await expect.poll(() => state.commands.length).toBe(1)
  expect(state.getWork().items.find((item) => item.id === 'task-1')?.status).toBe('Blocked')

  await open.focus()
  await open.press('Enter')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(open).toBeFocused()
  await expect(card.getByRole('combobox', { name: 'Move Canonical task to', exact: true })).toBeVisible()
  await captureProof(page, testInfo, 'board-panel-escape-focus-restored-desktop', { name: 'desktop', width: 1440, height: 900 })

  await page.goto('/projects/p1/work')
  const grid = page.getByRole('treegrid', { name: 'Project work breakdown' })
  const taskButton = grid.getByRole('button', { name: 'Canonical task', exact: true })
  await taskButton.click()
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('data-task-id', 'task-1')
  await captureProof(page, testInfo, 'list-panel-open-desktop', { name: 'desktop', width: 1440, height: 900 })
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(taskButton).toBeFocused()
  await captureProof(page, testInfo, 'list-panel-closed-focus-restored-desktop', { name: 'desktop', width: 1440, height: 900 })

  const row = grid.getByRole('row').filter({ hasText: 'Canonical task' }).first()
  await row.dblclick({ position: { x: 500, y: 24 } })
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('data-task-id', 'task-1')
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(row).toBeFocused()
  await captureProof(page, testInfo, 'list-double-click-escape-focus-restored-desktop', { name: 'desktop', width: 1440, height: 900 })
})

test('Focus primary action opens its exact Work task and invalid entity links normalize without disclosure', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installRoutes(page)
  await page.goto('/projects/p1/work')
  await page.getByRole('link', { name: 'Open task', exact: true }).click()
  await expect(page).toHaveURL(/\/projects\/p1\/work\?panel=task&entity=task-1/)
  const panel = page.locator('.p05-task-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('data-task-id', 'task-1')
  await expect(panel.getByRole('heading', { name: 'Canonical task', exact: true })).toBeVisible()
  await captureProof(page, testInfo, 'focus-deep-link-exact-task', { name: 'desktop', width: 1440, height: 900 })
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(panel).toHaveCount(0)
  await expect(page.locator('.p05-treegrid')).toBeFocused()
  await expect(page).not.toHaveURL(/panel=|entity=/)
  await captureProof(page, testInfo, 'focus-deep-link-close-fallback-desktop', { name: 'desktop', width: 1440, height: 900 })

  await page.goto('/projects/p1/work?layout=board&panel=task&entity=protected-task-id')
  await expect(page.locator('[data-p05-work-owner="true"]')).toBeVisible()
  await expect(page.locator('.p05-task-panel')).toHaveCount(0)
  await expect(page).toHaveURL(/\/projects\/p1\/work\?layout=board$/)
  await expect(page.locator('body')).not.toContainText('protected-task-id')
})

test('rejected Board and List commands preserve server truth, feedback, selection, and explicit retry', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const state = await installRoutes(page)
  await page.goto('/projects/p1/work?layout=board')
  const firstCard = boardCard(page, 'Canonical task')
  const secondCard = boardCard(page, 'Second task')
  const secondSelection = secondCard.getByRole('checkbox', { name: 'Select Second task', exact: true })
  await secondSelection.check()
  state.queueCommand('reject')
  await firstCard.getByRole('combobox', { name: 'Move Canonical task to', exact: true }).selectOption('Blocked')
  await expect(page.getByRole('alert')).toContainText('The task changed on the server.')
  expect(state.commands).toHaveLength(1)
  expect(state.getWork().items.find((item) => item.id === 'task-1')?.status).toBe('To Do')
  await expect(secondSelection).toBeChecked()
  await captureProof(page, testInfo, 'board-transition-failure-server-truth', { name: 'desktop', width: 1440, height: 900 })

  state.queueCommand('reject')
  await page.getByRole('button', { name: 'Bulk → In progress', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('The task changed on the server.')
  expect(state.commands).toHaveLength(2)
  expect(state.getWork().items.find((item) => item.id === 'task-2')?.status).toBe('To Do')
  await expect(secondCard.getByRole('checkbox', { name: 'Select Second task', exact: true })).toBeChecked()
  await captureProof(page, testInfo, 'board-bulk-failure-selection-retained', { name: 'desktop', width: 1440, height: 900 })
  await expect(page.getByRole('button', { name: 'Bulk → In progress', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Bulk → In progress', exact: true }).click()
  await expect.poll(() => state.commands.length).toBe(3)
  await expect.poll(() => state.getWork().items.find((item) => item.id === 'task-2')?.status).toBe('In progress')
  await expect(page.locator('.p05-card').filter({ hasText: 'Second task' }).getByRole('checkbox', { name: 'Select Second task' })).not.toBeChecked()
  expect(state.commands[1].idempotencyKey).not.toBe(state.commands[2].idempotencyKey)

  await page.goto('/projects/p1/work')
  const grid = page.getByRole('treegrid', { name: 'Project work breakdown' })
  const firstSelection = grid.getByRole('checkbox', { name: 'Select Canonical task', exact: true })
  await firstSelection.check()
  state.queueCommand('reject')
  await page.getByRole('button', { name: 'Bulk → Done', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('The task changed on the server.')
  expect(state.getWork().items.find((item) => item.id === 'task-1')?.status).toBe('To Do')
  await expect(firstSelection).toBeChecked()
  expect(state.commands).toHaveLength(4)
  await captureProof(page, testInfo, 'list-bulk-failure-selection-retained', { name: 'desktop', width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Bulk → Done', exact: true }).click()
  await expect.poll(() => state.commands.length).toBe(5)
  await expect.poll(() => state.getWork().items.find((item) => item.id === 'task-1')?.status).toBe('Done')
  expect(state.commands[3].idempotencyKey).not.toBe(state.commands[4].idempotencyKey)

  await grid.getByRole('combobox', { name: 'Status for Canonical task', exact: true }).selectOption('Review')
  state.queueCommand('internal')
  await grid.getByRole('combobox', { name: 'Status for Canonical task', exact: true }).selectOption('Blocked')
  await expect(page.getByRole('alert')).toContainText('This task change could not be saved.')
  await expect(page.getByRole('alert')).not.toContainText('stack trace sentinel')
  await expect(page.getByRole('alert')).not.toContainText('private-worker.js')
  await expect(page.locator('body')).not.toContainText('stack trace sentinel')
})

test('Create intent survives failure and delayed acknowledgment without clearing a newer draft', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const state = await installRoutes(page)
  await page.goto('/projects/p1/work')
  const title = page.getByRole('textbox', { name: 'New task title' })
  await title.fill('Draft survives rejection')
  state.queueCommand('reject')
  await page.getByRole('button', { name: 'Add task', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('The task changed on the server.')
  await expect(title).toHaveValue('Draft survives rejection')
  expect(state.getWork().items.some((item) => item.title === 'Draft survives rejection')).toBe(false)
  expect(state.commands).toHaveLength(1)
  await captureProof(page, test.info(), 'create-failure-draft-retained', { name: 'desktop', width: 1440, height: 900 })

  await page.getByRole('button', { name: 'Add task', exact: true }).click()
  await expect.poll(() => state.commands.length).toBe(2)
  await expect(title).toHaveValue('')
  expect(state.getWork().items.some((item) => item.title === 'Draft survives rejection')).toBe(true)

  await title.fill('Draft A')
  state.queueCommand('defer')
  await page.getByRole('button', { name: 'Add task', exact: true }).click()
  await expect.poll(() => state.commands.length).toBe(3)
  await expect(title).toHaveValue('Draft A')
  await expect(page.getByRole('button', { name: 'Add task', exact: true })).toBeDisabled()
  await title.fill('Draft B')
  await state.resolveCommand('success')
  await expect(title).toHaveValue('Draft B')
  expect(state.getWork().items.some((item) => item.title === 'Draft A')).toBe(true)
  expect(state.getWork().items.some((item) => item.title === 'Draft B')).toBe(false)
  await captureProof(page, test.info(), 'create-acknowledgment-preserves-newer-draft', { name: 'desktop', width: 1440, height: 900 })
})

test('Delayed bulk success acknowledges only the submitted selection', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const state = await installRoutes(page)
  await page.goto('/projects/p1/work?layout=board')
  const firstCard = boardCard(page, 'Canonical task')
  const secondCard = boardCard(page, 'Second task')
  await firstCard.getByRole('checkbox', { name: 'Select Canonical task', exact: true }).check()
  state.queueCommand('defer')
  await page.getByRole('button', { name: 'Bulk → In progress', exact: true }).click()
  await expect.poll(() => state.commands.length).toBe(1)
  await secondCard.getByRole('checkbox', { name: 'Select Second task', exact: true }).check()
  await expect(page.getByRole('button', { name: 'Bulk → In progress', exact: true })).toBeDisabled()
  await state.resolveCommand('success')
  await expect.poll(() => state.getWork().items.find((item) => item.id === 'task-1')?.status).toBe('In progress')
  await expect(page.locator('.p05-card').filter({ hasText: 'Second task' }).getByRole('checkbox', { name: 'Select Second task' })).toBeChecked()
  await expect(page.locator('.p05-card').filter({ hasText: 'Canonical task' }).getByRole('checkbox', { name: 'Select Canonical task' })).not.toBeChecked()
  await captureProof(page, test.info(), 'bulk-acknowledgment-preserves-new-selection', { name: 'desktop', width: 1440, height: 900 })
})

test('A to B to A late mutation completion cannot alter the newer Project A generation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const state = await installRoutes(page)
  await page.goto('/projects/p1/work')
  const title = page.getByRole('textbox', { name: 'New task title' })
  await title.fill('Old A request')
  state.queueCommand('defer')
  await page.getByRole('button', { name: 'Add task', exact: true }).click()
  await expect.poll(() => state.commands.length).toBe(1)

  await page.evaluate(() => {
    window.history.pushState({}, '', '/projects/p2/work')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.locator('[data-p05-work-owner="true"]')).toHaveAttribute('data-project-id', 'p2')
  await page.evaluate(() => {
    window.history.pushState({}, '', '/projects/p1/work')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.locator('[data-p05-work-owner="true"]')).toHaveAttribute('data-project-id', 'p1')
  const newGenerationTitle = page.getByRole('textbox', { name: 'New task title' })
  await newGenerationTitle.fill('New A generation draft')
  await state.resolveCommand('success')
  await expect(newGenerationTitle).toHaveValue('New A generation draft')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(state.getWork().items.some((item) => item.title === 'Old A request')).toBe(true)
  expect(state.commands).toHaveLength(1)
})

test('a revoked deep-link context cannot reopen a task when its delayed Work payload arrives', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const state = await installRoutes(page)
  state.deferNextWork('p1')
  await page.goto('/projects/p1/work?panel=task&entity=task-1')
  await expect.poll(() => state.hasPendingWork('p1')).toBe(true)
  await page.evaluate(() => {
    window.history.pushState({}, '', '/projects/p2/work')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.locator('[data-p05-work-owner="true"]')).toHaveAttribute('data-project-id', 'p2')
  await state.resolveWork('p1')
  await expect(page.locator('.p05-task-panel')).toHaveCount(0)
  await page.evaluate(() => {
    window.history.pushState({}, '', '/projects/p1/work')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.locator('[data-p05-work-owner="true"]')).toHaveAttribute('data-project-id', 'p1')
  await expect(page.locator('.p05-task-panel')).toHaveCount(0)
})

test('task-panel action closure holds at desktop, mobile, and short-height stress sizes', async ({ page }, testInfo) => {
  const state = await installRoutes(page)
  const profiles = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
    { name: 'short-height', width: 390, height: 560 },
  ]
  for (const profile of profiles) {
    await page.setViewportSize({ width: profile.width, height: profile.height })
    await page.goto('/projects/p1/work?layout=board')
    const card = boardCard(page, 'Canonical task')
    const open = card.getByRole('button', { name: 'Open task', exact: true })
    await open.scrollIntoViewIfNeeded()
    await expectReachable(open)
    await open.click()
    const panel = page.locator('.p05-task-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toHaveAttribute('data-task-id', 'task-1')
    await expect(panel.getByRole('button', { name: 'Close', exact: true })).toBeFocused()

    await page.evaluate(() => {
      const clipped = document.createElement('button')
      clipped.type = 'button'
      clipped.textContent = 'Deliberately clipped control'
      clipped.dataset.proofClippedControl = 'true'
      Object.assign(clipped.style, { position: 'fixed', top: '-120px', left: '8px', width: '220px', height: '40px' })
      document.body.append(clipped)
    })
    const negative = await clippedActionResult(page)
    expect(negative).toMatchObject({ rejected: true, reason: 'outside-viewport' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
    await expectReachable(panel.getByRole('button', { name: 'Close', exact: true }))
    await expectReachable(panel.getByRole('button', { name: 'Mark done', exact: true }))
    const proof = await captureProof(page, testInfo, `panel-open-${profile.name}`, profile, negative)
    expect(proof.pageState.projectId).toBe('p1')
    expect(proof.pageState.taskId).toBe('task-1')
    expect(proof.pageState.pending.commandCount).toBe(0)
    expect(proof.pageState.bodyHorizontalOverflow).toBe(false)
    expect(proof.pageState.requiredActionInventory.some((action: any) => action.name === 'Close' && action.enabled)).toBe(true)
    expect(proof.pageState.requiredActionInventory.some((action: any) => action.name === 'Mark done' && action.enabled)).toBe(true)

    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(panel).toHaveCount(0)
    await expect(open).toBeFocused()
    await expectReachable(card.getByRole('button', { name: 'Open task', exact: true }))
    const move = card.getByRole('combobox', { name: 'Move Canonical task to', exact: true })
    await expectReachable(move)
    await expectReachable(page.getByRole('navigation', { name: 'Work navigation' }).getByRole('link', { name: 'Work', exact: true }))
    await expectReachable(page.getByRole('navigation', { name: 'Work navigation' }).getByRole('link', { name: 'Board', exact: true }))
    await expectReachable(page.getByRole('link', { name: 'Open task', exact: true }))
    await page.locator('[data-proof-clipped-control="true"]').evaluate((element) => element.remove())
    if (profile.name === 'short-height') {
      await move.selectOption('Blocked')
      await expect.poll(() => state.commands.length).toBeGreaterThan(0)
    }
  }
})
