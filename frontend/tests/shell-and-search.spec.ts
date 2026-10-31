import { writeFile } from 'node:fs/promises'
import { clickResilientButton } from './helpers/sysgrid';
import { expect } from '@playwright/test';
import { test } from './helpers/sysgrid-test';
import { resetBrowserState, seedOperationalScenario, waitForAppIdle } from './helpers/sysgrid'

test.describe('App shell and global search', () => {
  test('loads the dashboard and feature audit HUD', async ({ page }) => {
    await resetBrowserState(page)

    await page.goto('/')
    await expect(page.getByText('Observed health history (24h)')).toBeVisible()
    await expect(page.getByText('Operational observation boundary')).toBeVisible()

    await clickResilientButton(page, /Patch Notes/i)
    await expect(page.getByText('Registry Updates')).toBeVisible()
  })

  test('navigates to seeded records through global search', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const { service, monitoring, knowledge } = await seedOperationalScenario(request)
    const searchInput = page.getByPlaceholder(/Search released and authorized records/i)
    const searchTrigger = page.locator('button').filter({ hasText: /Search released and authorized records/i }).first()

    await page.goto('/')
    await waitForAppIdle(page)
    await expect(page.getByText('Observed health history (24h)')).toBeVisible()

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
    const searchDialog = page.getByRole('dialog')
    await expect(searchDialog.getByRole('link', { name: new RegExp(knowledge.title) })).toHaveCount(0)
    await expect(searchDialog.getByText(`No released or authorized records found for "${knowledge.title}"`)).toBeVisible()
  })
})

const goldenRoutes = [
  { path: '/monitoring', archetype: 'table' },
  { path: '/asset', archetype: 'table' },
  { path: '/services', archetype: 'table' },
  { path: '/external', archetype: 'table' },
  { path: '/network', archetype: 'hybrid' },
  { path: '/far', archetype: 'analytical' },
  { path: '/vendors', archetype: 'table' },
] as const

const viewportCanvasRoutes = [
  '/',
  '/racks',
  '/asset',
  '/services',
  '/external',
  '/network',
  '/far',
  '/monitoring',
  '/vendors',
  '/logs',
  '/settings',
] as const

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

  await page.evaluate(async () => {
    await document.fonts.ready
    const root = document.querySelector('[data-golden-workspace-shell="true"]')
    const targets = root ? [root, root.querySelector('[data-golden-page-header]'), root.querySelector('[data-golden-command-bar]'), root.querySelector('[data-golden-page-toolbar]'), root.querySelector('[data-golden-grid-surface]')] : []
    let previous = ''
    let stableFrames = 0
    for (let frame = 0; frame < 12 && stableFrames < 2; frame += 1) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const signature = targets.map(target => {
        if (!target) return 'missing'
        const rect = target.getBoundingClientRect()
        return [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 10) / 10).join(':')
      }).join('|')
      stableFrames = signature === previous ? stableFrames + 1 : 0
      previous = signature
    }
  })

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

function expectAligned(actual: number, expected: number, message = 'Golden workspace geometry', tolerance = 2) {
  const delta = Math.abs(actual - expected)
  const measurement = `${message} (actual=${actual.toFixed(3)}px, expected=${expected.toFixed(3)}px, delta=${delta.toFixed(3)}px)`
  expect(delta, measurement).toBeLessThanOrEqual(tolerance)
}

test.describe('Released golden workspace geometry', () => {


  test('records authoritative API response shapes for released golden workspace seed fixtures', async ({ page }, testInfo) => {
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
  test('keeps desktop shell, command bar, and grid alignment invariant on every released golden route', async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    await resetBrowserState(page)
    await page.setViewportSize({ width: 1440, height: 1000 })

    for (const route of goldenRoutes) {
      await page.goto(route.path)
      await waitForAppIdle(page)
      const { shell, boxes } = await readGoldenGeometry(page)

      await expect(shell).toHaveAttribute('data-golden-geometry-version', '2')
      await expect(shell).toHaveAttribute('data-golden-archetype', route.archetype)
      expect(boxes.header.y).toBeLessThan(boxes.commandBar.y)
      expect(boxes.commandBar.bottom).toBeLessThanOrEqual(boxes.grid.y + 1)
      expect(boxes.grid.height).toBeGreaterThanOrEqual(350)
      const visibleSurfaces = [
        ['header', boxes.header],
        ['toolbar', boxes.toolbar],
        ['grid', boxes.grid],
      ] as const
      for (const [surfaceName, surface] of visibleSurfaces) {
        expect(surface.x, `${route.path} ${surfaceName} remains inside the workspace frame`)
          .toBeGreaterThanOrEqual(boxes.shell.x - 1)
        expect(surface.right, `${route.path} ${surfaceName} remains inside the workspace frame`)
          .toBeLessThanOrEqual(boxes.shell.right + 1)
      }
      for (const [surfaceName, surface] of visibleSurfaces.slice(1)) {
        expectAligned(surface.x, boxes.header.x, `${route.path} ${surfaceName} left edge`)
        expectAligned(surface.right, boxes.header.right, `${route.path} ${surfaceName} right edge`)
      }

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

  test('keeps compact desktop shell and overflow containment invariant on every released golden route', async ({ page }, testInfo) => {
    await resetBrowserState(page)
    await page.setViewportSize({ width: 1024, height: 768 })

    for (const route of goldenRoutes) {
      await page.goto(route.path)
      await waitForAppIdle(page)
      const { shell, boxes } = await readGoldenGeometry(page)

      await expect(shell).toHaveAttribute('data-golden-geometry-version', '2')
      await expect(shell).toHaveAttribute('data-golden-archetype', route.archetype)
      expect(boxes.header.y).toBeLessThan(boxes.commandBar.y)
      expect(boxes.commandBar.bottom).toBeLessThanOrEqual(boxes.grid.y + 1)
      expect(boxes.grid.height).toBeGreaterThanOrEqual(350)
      const visibleSurfaces = [
        ['header', boxes.header],
        ['toolbar', boxes.toolbar],
        ['grid', boxes.grid],
      ] as const
      for (const [surfaceName, surface] of visibleSurfaces) {
        expect(surface.x, `${route.path} ${surfaceName} remains inside the workspace frame`)
          .toBeGreaterThanOrEqual(boxes.shell.x - 1)
        expect(surface.right, `${route.path} ${surfaceName} remains inside the workspace frame`)
          .toBeLessThanOrEqual(boxes.shell.right + 1)
      }
      for (const [surfaceName, surface] of visibleSurfaces.slice(1)) {
        expectAligned(surface.x, boxes.header.x, `${route.path} ${surfaceName} left edge`)
        expectAligned(surface.right, boxes.header.right, `${route.path} ${surfaceName} right edge`)
      }

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(2)

    }
  })

  test('keeps every active view canvas full-width and inside the viewport in both themes', async ({ page, sysApi: request }, testInfo) => {
    await resetBrowserState(page)

    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })

      for (const theme of ['nordic-frost-v1', 'pure-clarity'] as const) {
        const preference = await request.patch(`${process.env.PW_API_BASE}/settings/user/settings`, { data: { theme } })
        expect(preference.ok()).toBeTruthy()
        await page.goto('/')
        await page.evaluate((nextTheme) => localStorage.setItem('sysgrid-theme', nextTheme), theme)
        await page.reload()
        await waitForAppIdle(page)
        await expect(page.locator('.sg-app-shell')).toBeVisible()
        await expect(page.locator('[data-sg-state="route-loading"]')).toHaveCount(0)

        for (const route of viewportCanvasRoutes) {
          if (route !== '/') {
            await page.goto(route)
            await waitForAppIdle(page)
            await expect(page.locator('.sg-app-shell')).toBeVisible()
            await expect(page.locator('[data-sg-state="route-loading"]')).toHaveCount(0)
          }

          const canvas = await page.evaluate(() => {
            const selectors = [
              ['document', 'html'],
              ['body', 'body'],
              ['root', '#root'],
              ['application shell', '.sg-app-shell'],
              ['navigation rail', '.sg-app-shell > [data-sg-app-sidebar="true"]'],
              ['main view', '.sg-app-shell > [data-sg-app-main="true"]'],
              ['view content', '#sg-main-content'],
            ] as const
            const viewportWidth = document.documentElement.clientWidth
            const boxes = selectors.map(([name, selector]) => {
              const element = document.querySelector<HTMLElement>(selector)
              if (!element) return { name, missing: true, left: 0, right: 0, width: 0, background: '' }
              const rect = element.getBoundingClientRect()
              return {
                name,
                missing: false,
                left: rect.left,
                right: rect.right,
                width: rect.width,
                background: getComputedStyle(element).backgroundColor,
              }
            })
            const outsideControls: Array<{ label: string; left: number; right: number }> = []
            const clippedControlLabels: Array<{ label: string; width: number; scrollWidth: number }> = []
            const controls = Array.from(document.querySelectorAll<HTMLElement>('button, a[href]'))
            for (const control of controls) {
              const rect = control.getBoundingClientRect()
              const style = getComputedStyle(control)
              if (
                rect.width === 0 || rect.height === 0 || style.display === 'none' ||
                style.visibility === 'hidden' || Number(style.opacity) === 0 ||
                control.closest('[aria-hidden="true"]')
              ) continue

              const label = (control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100)
              let scrollContainer = control.parentElement
              let isInsideHorizontalScroller = false
              while (scrollContainer && scrollContainer !== document.body) {
                const overflowX = getComputedStyle(scrollContainer).overflowX
                if ((overflowX === 'auto' || overflowX === 'scroll') && scrollContainer.scrollWidth > scrollContainer.clientWidth + 2) {
                  isInsideHorizontalScroller = true
                  break
                }
                scrollContainer = scrollContainer.parentElement
              }
              if (!isInsideHorizontalScroller && (rect.left < -1 || rect.right > viewportWidth + 1)) {
                outsideControls.push({ label, left: rect.left, right: rect.right })
              }
              if (
                control.textContent?.trim() && control.scrollWidth > control.clientWidth + 2 &&
                !control.getAttribute('aria-label') && !control.getAttribute('title')
              ) {
                clippedControlLabels.push({ label, width: control.clientWidth, scrollWidth: control.scrollWidth })
              }
            }
            return { viewportWidth, documentWidth: document.documentElement.scrollWidth, boxes, outsideControls, clippedControlLabels }
          })

          for (const box of canvas.boxes) {
            expect(box.missing, `${route} ${theme} ${box.name} exists`).toBe(false)
            expect(box.left, `${route} ${theme} ${box.name} starts within the viewport`).toBeGreaterThanOrEqual(-1)
            expect(box.right, `${route} ${theme} ${box.name} reaches the viewport right edge`).toBeLessThanOrEqual(canvas.viewportWidth + 1)
          }

          const [documentCanvas, bodyCanvas, rootCanvas, appCanvas, navigationCanvas, mainCanvas, contentCanvas] = canvas.boxes
          for (const [name, box] of [['root', rootCanvas], ['application shell', appCanvas]] as const) {
            expect(box.width, `${route} ${theme} ${name} covers the full viewport`).toBeGreaterThanOrEqual(canvas.viewportWidth - 1)
          }
          expect(mainCanvas.left, `${route} ${theme} main view begins after the navigation rail`).toBeCloseTo(navigationCanvas.right, 0)
          expect(mainCanvas.right, `${route} ${theme} main view reaches the application right edge`).toBeCloseTo(appCanvas.right, 0)
          expect(contentCanvas.left, `${route} ${theme} view content begins at the main view edge`).toBeCloseTo(mainCanvas.left, 0)
          expect(contentCanvas.right, `${route} ${theme} page content reaches the main view right edge`).toBeCloseTo(mainCanvas.right, 0)
          expect(contentCanvas.width, `${route} ${theme} view content fills the main column`).toBeCloseTo(mainCanvas.width, 0)
          expect(bodyCanvas.background, `${route} ${theme} body background joins the document canvas`).toBe(documentCanvas.background)
          expect(rootCanvas.background, `${route} ${theme} root background joins the document canvas`).toBe(documentCanvas.background)
          expect(appCanvas.background, `${route} ${theme} application background joins the document canvas`).toBe(documentCanvas.background)
          expect(mainCanvas.background, `${route} ${theme} main background joins the document canvas`).toBe(documentCanvas.background)
          expect(contentCanvas.background, `${route} ${theme} view background joins the document canvas`).toBe(documentCanvas.background)
          expect(canvas.documentWidth, `${route} ${theme} cannot expand the viewport horizontally`).toBeLessThanOrEqual(canvas.viewportWidth + 1)
          expect(canvas.outsideControls, `${route} ${theme} visible controls stay within the viewport or a deliberate horizontal scroller`).toEqual([])
          expect(canvas.clippedControlLabels, `${route} ${theme} clipped control text keeps an accessible full label`).toEqual([])

          if (width === 1440) {
            const viewName = route === '/' ? 'home' : route.slice(1)
            await page.screenshot({
              path: testInfo.outputPath(`viewport-${theme}-${viewName}.png`),
              fullPage: true,
            })
          }
        }
      }
    }
  })
})
