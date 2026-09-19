import { writeFile } from 'node:fs/promises'
import { clickResilientButton } from './helpers/sysgrid';
import { expect } from '@playwright/test';
import { test } from './helpers/sysgrid-test';
import { resetBrowserState, seedOperationalScenario, waitForAppIdle } from './helpers/sysgrid'

test.describe('App shell and global search', () => {
  test('loads the dashboard and feature audit HUD', async ({ page }) => {
    await resetBrowserState(page)

    await page.goto('/')
    await expect(page.getByText('Stability Pulse')).toBeVisible()
    await expect(page.getByText('Defense Status')).toBeVisible()

    await clickResilientButton(page, /Patch Notes/i)
    await expect(page.getByText('Registry Updates')).toBeVisible()
  })

  test('navigates to seeded records through global search', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const { service, monitoring, knowledge } = await seedOperationalScenario(request)
    const searchInput = page.getByPlaceholder(/Search Assets, Projects, FAR, Services, Monitoring/i)
    const searchTrigger = page.locator('button').filter({ hasText: /Search assets, projects, or incidents/i }).first()

    await page.goto('/')
    await waitForAppIdle(page)
    await expect(page.getByText('Stability Pulse')).toBeVisible()

    await searchTrigger.click()
    await expect(searchInput).toBeVisible()
    await searchInput.fill(service.name)
    const serviceResult = page.getByRole('link', { name: new RegExp(service.name) }).first()
    await expect(serviceResult).toBeVisible()
    await serviceResult.click()
    await expect(page).toHaveURL(new RegExp(`/services\\?id=${service.id}`))
    const serviceDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { level: 2, name: service.name, exact: true }),
    }).last()
    await expect(serviceDialog).toBeVisible()
    await expect(serviceDialog.getByRole('heading', { level: 2, name: service.name, exact: true })).toBeVisible()

    await page.goto('/')
    await waitForAppIdle(page)
    await searchTrigger.click()
    await expect(searchInput).toBeVisible()
    await searchInput.fill(monitoring.title)
    const monitoringResult = page.getByRole('link', { name: new RegExp(monitoring.title) }).first()
    await expect(monitoringResult).toBeVisible()
    await monitoringResult.click()
    await expect(page).toHaveURL(new RegExp(`/monitoring\\?id=${monitoring.id}`))
    const monitoringDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { level: 2, name: monitoring.title, exact: true }),
    }).last()
    await expect(monitoringDialog).toBeVisible()
    await expect(monitoringDialog.getByRole('heading', { level: 2, name: monitoring.title, exact: true })).toBeVisible()

    await page.goto('/')
    await waitForAppIdle(page)
    await searchTrigger.click()
    await expect(searchInput).toBeVisible()
    await searchInput.fill(knowledge.title)
    if (process.env.SYSGRID_VERIFY_PROFILE === 'root-preview') {
      const searchDialog = page.getByRole('dialog')
      const knowledgeResult = searchDialog.getByRole('link', { name: new RegExp(knowledge.title) }).first()
      await expect(knowledgeResult).toBeVisible()
      await knowledgeResult.click()
      await expect(page).toHaveURL(new RegExp(`/knowledge\\?id=${knowledge.id}`))
    } else {
      await expect(page.getByText(`Zero records found for "${knowledge.title}"`, { exact: true })).toBeVisible()
    }
  })
})

const goldenRoutes = [
  { path: '/monitoring', archetype: 'table' },
  { path: '/asset', archetype: 'table' },
  { path: '/services', archetype: 'table' },
  { path: '/external', archetype: 'table' },
  { path: '/network', archetype: 'hybrid' },
  { path: '/far', archetype: 'analytical' },
  { path: '/research', archetype: 'analytical' },
  { path: '/vendors', archetype: 'table' },
] as const
const normalPreviewRoutes = new Set(['/external', '/far', '/research', '/vendors'])

type GeometryBox = { x: number; y: number; width: number; height: number; right: number; bottom: number }


type PayloadShape =
  | { type: 'null' }
  | { type: 'array'; length: number; itemShapes: PayloadShape[] }
  | { type: 'object'; keys: Record<string, PayloadShape> }
  | { type: 'string' | 'number' | 'boolean' }
  | { type: 'unknown' }

function summarizePayloadShape(value: unknown, depth = 0): PayloadShape {
  if (value === null) return { type: 'null' }
  if (depth >= 4) return { type: 'unknown' }
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      itemShapes: value.slice(0, 3).map((item) => summarizePayloadShape(item, depth + 1)),
    }
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, 80)
    return {
      type: 'object',
      keys: Object.fromEntries(entries.map(([key, child]) => [key, summarizePayloadShape(child, depth + 1)])),
    }
  }
  if (typeof value === 'string') return { type: 'string' }
  if (typeof value === 'number') return { type: 'number' }
  if (typeof value === 'boolean') return { type: 'boolean' }
  return { type: 'unknown' }
}

async function readGoldenGeometry(page: any) {
  const shell = page.locator('[data-golden-workspace-shell="true"]:visible').first()
  const header = shell.locator('[data-golden-page-header="true"]').first()
  const commandBar = shell.locator('[data-golden-command-bar="true"]').first()
  const toolbar = commandBar.locator('[data-golden-page-toolbar="true"]').first()
  const grid = shell.locator('[data-golden-grid-surface="true"]').first()

  await expect(shell).toBeVisible()
  await expect(header).toBeVisible()
  await expect(commandBar).toBeVisible()
  await expect(toolbar).toBeVisible()
  await expect(grid).toBeVisible()

  const boxes = await Promise.all([shell, header, commandBar, toolbar, grid].map(async (locator) => {
    const box = await locator.boundingBox()
    if (!box) throw new Error('Golden geometry target did not produce a bounding box')
    return { ...box, right: box.x + box.width, bottom: box.y + box.height } satisfies GeometryBox
  }))

  return {
    shell,
    boxes: {
      shell: boxes[0],
      header: boxes[1],
      commandBar: boxes[2],
      toolbar: boxes[3],
      grid: boxes[4],
    },
  }
}

function expectAligned(actual: number, expected: number, tolerance = 2) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

test.describe('Golden Eight rendered geometry', () => {


  test('records authoritative API response shapes for comprehensive Golden Eight seed fixtures', async ({ page }, testInfo) => {
    await resetBrowserState(page)
    await page.setViewportSize({ width: 1440, height: 1000 })

    const inventory: Array<{
      route: string
      method: string
      url: string
      status: number
      contentType: string
      shape?: PayloadShape
      bodyError?: string
    }> = []

    for (const route of goldenRoutes) {
      const routeEntries: typeof inventory = []
      const listener = async (response: any) => {
        const request = response.request()
        const url = new URL(response.url())
        if (!url.pathname.startsWith('/api/')) return
        const contentType = response.headers()['content-type'] || ''
        const entry: (typeof inventory)[number] = {
          route: route.path,
          method: request.method(),
          url: `${url.pathname}${url.search}`,
          status: response.status(),
          contentType,
        }
        if (contentType.includes('application/json')) {
          try {
            entry.shape = summarizePayloadShape(await response.json())
          } catch (error) {
            entry.bodyError = error instanceof Error ? error.message : String(error)
          }
        }
        routeEntries.push(entry)
      }

      page.on('response', listener)
      await page.goto(route.path)
      await waitForAppIdle(page)
      await page.waitForTimeout(250)
      page.off('response', listener)

      const deduplicated = new Map<string, (typeof inventory)[number]>()
      for (const entry of routeEntries) {
        const key = `${entry.method} ${entry.url} ${entry.status}`
        if (!deduplicated.has(key)) deduplicated.set(key, entry)
      }
      inventory.push(...deduplicated.values())
    }

    const outputPath = testInfo.outputPath('golden-eight-api-shape-inventory.json')
    await writeFile(outputPath, `${JSON.stringify({ viewport: { width: 1440, height: 1000 }, routes: goldenRoutes, inventory }, null, 2)}\n`, 'utf8')

    for (const route of goldenRoutes) {
      expect(inventory.some((entry) => entry.route === route.path)).toBeTruthy()
    }
  })
  test('keeps desktop shell, command bar, and grid alignment invariant on every golden route', async ({ page }, testInfo) => {
    await resetBrowserState(page)
    await page.setViewportSize({ width: 1440, height: 1000 })

    for (const route of goldenRoutes) {
      await page.goto(route.path)
      await waitForAppIdle(page)
      if (process.env.SYSGRID_VERIFY_PROFILE === 'normal-v1' && normalPreviewRoutes.has(route.path)) {
        await expect(page.getByRole('heading', { name: 'Access unavailable', exact: true })).toBeVisible()
        continue
      }
      const { shell, boxes } = await readGoldenGeometry(page)

      await expect(shell).toHaveAttribute('data-golden-geometry-version', '1')
      await expect(shell).toHaveAttribute('data-golden-archetype', route.archetype)
      expect(boxes.header.y).toBeLessThan(boxes.commandBar.y)
      expect(boxes.commandBar.bottom).toBeLessThanOrEqual(boxes.grid.y + 1)
      expect(boxes.grid.height).toBeGreaterThanOrEqual(350)
      expectAligned(boxes.header.x, boxes.shell.x)
      expectAligned(boxes.header.right, boxes.shell.right)
      expectAligned(boxes.commandBar.x, boxes.shell.x)
      expectAligned(boxes.commandBar.right, boxes.shell.right)
      expectAligned(boxes.grid.x, boxes.shell.x)
      expectAligned(boxes.grid.right, boxes.shell.right)

      const slug = route.path.slice(1)
      await page.screenshot({
        path: testInfo.outputPath(`${slug}-default-desktop.png`),
        fullPage: true,
      })

      for (const control of ['Display', 'Filters', 'Insights'] as const) {
        await page.goto(route.path)
        await waitForAppIdle(page)
        const button = page.getByRole('button', { name: new RegExp(`^${control}$`, 'i') }).first()
        if (await button.count()) {
          await expect(button).toBeVisible()
          await button.click()
          await waitForAppIdle(page)
          await page.screenshot({
            path: testInfo.outputPath(`${slug}-${control.toLowerCase()}-toggled-desktop.png`),
            fullPage: true,
          })
        }
      }
    }
  })

  test('keeps narrow-screen stacking and overflow containment invariant on every golden route', async ({ page }, testInfo) => {
    await resetBrowserState(page)
    await page.setViewportSize({ width: 390, height: 844 })

    for (const route of goldenRoutes) {
      await page.goto(route.path)
      await waitForAppIdle(page)
      if (process.env.SYSGRID_VERIFY_PROFILE === 'normal-v1' && normalPreviewRoutes.has(route.path)) {
        await expect(page.getByRole('heading', { name: 'Access unavailable', exact: true })).toBeVisible()
        continue
      }
      const { shell, boxes } = await readGoldenGeometry(page)

      await expect(shell).toHaveAttribute('data-golden-geometry-version', '1')
      await expect(shell).toHaveAttribute('data-golden-archetype', route.archetype)
      expect(boxes.header.y).toBeLessThan(boxes.commandBar.y)
      expect(boxes.commandBar.bottom).toBeLessThanOrEqual(boxes.grid.y + 1)
      expect(boxes.grid.height).toBeGreaterThanOrEqual(350)
      expectAligned(boxes.header.x, boxes.shell.x)
      expectAligned(boxes.commandBar.x, boxes.shell.x)
      expectAligned(boxes.grid.x, boxes.shell.x)
      expectAligned(boxes.header.width, boxes.shell.width)
      expectAligned(boxes.commandBar.width, boxes.shell.width)
      expectAligned(boxes.grid.width, boxes.shell.width)

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(2)

    }
  })
})
