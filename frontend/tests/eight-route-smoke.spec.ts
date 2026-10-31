import { expect, type ConsoleMessage, type Page, type Request, type TestInfo } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState } from './helpers/sysgrid'
import { isExpectedTelemetryRequest } from '../src/observability/browserFailurePolicy'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
type SmokeRoute = { path: string; key: string; retired?: string }
const routes: SmokeRoute[] = [
  { path: '/', key: 'home' },
  { path: '/asset', key: 'assets' },
  { path: '/monitoring', key: 'monitoring' },
  { path: '/monitoring?workspace=maintenance', key: 'maintenance' },
  { path: '/services', key: 'services' },
  { path: '/external', key: 'external' },
  { path: '/network', key: 'network' },
  { path: '/racks', key: 'racks' },
  { path: '/far', key: 'far' },
  { path: '/vendors', key: 'vendors' },
  { path: '/logs', key: 'audit' },
  { path: '/settings', key: 'settings' },
  { path: '/projects/42/timeline', key: 'retired-projects', retired: 'Projects' },
  { path: '/research', key: 'retired-research', retired: 'Research' },
  { path: '/knowledge?id=42', key: 'retired-knowledge', retired: 'Knowledge' },
  { path: '/architecture?legacy=true', key: 'retired-architecture', retired: 'Architecture' },
]

async function captureRouteMatrix(page: Page, sysApi: any, testInfo: TestInfo, theme: string) {
  const themeResponse = await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
  expect(themeResponse.ok(), `${theme} preference should be persisted for the visual pass`).toBeTruthy()
  await page.addInitScript((value: string) => localStorage.setItem('sysgrid-theme', value), theme)
  await page.setViewportSize({ width: 1440, height: 900 })
  const appHost = new URL(process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173').hostname
  const apiHost = new URL(apiBase).hostname
  const allowedRuntimeHosts = new Set([appHost, apiHost])

  for (const route of routes) {
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    const externalRuntimeRequests: string[] = []
    const onConsole = (message: ConsoleMessage) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    }
    const onRequestFailed = (request: Request) => {
      if (request.failure()?.errorText === 'net::ERR_ABORTED') return
      if (isExpectedTelemetryRequest({
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
      })) return
      failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`)
    }
    const onRequest = (request: Request) => {
      const url = new URL(request.url())
      if (/^(https?|wss?):$/.test(url.protocol) && !allowedRuntimeHosts.has(url.hostname)) {
        externalRuntimeRequests.push(`${request.method()} ${url.origin}`)
      }
    }
    page.on('console', onConsole)
    page.on('requestfailed', onRequestFailed)
    page.on('request', onRequest)

    try {
      await page.goto(route.path)
      await expect(page.locator('[data-sg-state="fatal-error"]'), `${route.path} fatal error`).not.toBeVisible()
      await expect(page.locator('[data-sg-state="permission-denied"]'), `${route.path} permission denied`).not.toBeVisible()
      await expect(page.locator('.sg-app-shell')).not.toHaveAttribute('data-sg-projects-app', 'true')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const main = page.locator('#sg-main-content')
      await expect(main.locator('h1, h2').first(), `${route.path} should show a page heading`).toBeVisible()
      await expect(page.locator('body'), `${route.path} should not show a connection failure`).not.toContainText('Connection lost')
      await expect(page.locator('body'), `${route.path} should not show a render failure`).not.toContainText('Unable to render this view')
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
      const shellLaw = await page.evaluate(() => {
        const shell = document.querySelector('.nova-app-shell')
        const content = document.querySelector('#sg-main-content')
        const activeNav = shell?.querySelector('[data-sg-app-sidebar="true"] a[aria-current="page"] > span')
        const pageHeader = content?.querySelector('[data-golden-page-header="true"]')
        const contentRect = content?.getBoundingClientRect()
        const headerRect = pageHeader?.getBoundingClientRect()
        const contentStyle = content ? getComputedStyle(content) : null
        return {
          designSystem: shell?.getAttribute('data-design-system') ?? null,
          gutterLeft: contentStyle?.paddingLeft ?? null,
          gutterRight: contentStyle?.paddingRight ?? null,
          headerLeftInset: contentRect && headerRect ? Math.round(headerRect.left - contentRect.left) : null,
          headerTopInset: contentRect && headerRect ? Math.round(headerRect.top - contentRect.top) : null,
          headerRightInset: contentRect && headerRect ? Math.round(contentRect.right - headerRect.right) : null,
          activeNavBackground: activeNav ? getComputedStyle(activeNav).backgroundColor : null,
        }
      })
      expect(shellLaw.designSystem, `${route.path} uses the Nova design law`).toBe('nova')
      expect(shellLaw.gutterLeft, `${route.path} left content gutter`).toBe('32px')
      expect(shellLaw.gutterRight, `${route.path} right content gutter`).toBe('32px')
      expect(shellLaw.headerTopInset, `${route.path} header top alignment`).toBe(32)
      if (!route.retired) {
        const expectedActiveNavBackground = theme === 'pure-clarity' ? 'rgb(239, 246, 255)' : 'rgb(18, 59, 122)'
        expect(shellLaw.activeNavBackground, `${theme} active navigation color`).toBe(expectedActiveNavBackground)
      }
      expect(shellLaw.headerLeftInset, `${route.path} header left alignment`).toBe(32)
      expect(shellLaw.headerRightInset, `${route.path} header right alignment`).toBe(32)
      if (route.key === 'home') {
        await page.getByRole('button', { name: 'Appearance' }).click()
        await expect(page.getByRole('menuitem', { name: 'Dark appearance' })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: 'Light appearance' })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('menuitem', { name: 'Dark appearance' })).toHaveCount(0)

        const alternateTheme = theme === 'pure-clarity' ? 'nordic-frost-v1' : 'pure-clarity'
        const alternateAppearance = alternateTheme === 'pure-clarity' ? 'Light appearance' : 'Dark appearance'
        const originalAppearance = theme === 'pure-clarity' ? 'Light appearance' : 'Dark appearance'
        await page.getByRole('button', { name: 'Appearance' }).click()
        await page.getByRole('menuitem', { name: alternateAppearance }).click()
        await expect(page.locator('html')).toHaveAttribute('data-theme', alternateTheme)
        await expect(page.locator('.nova-app-shell')).toHaveAttribute('data-theme', alternateTheme)
        const notificationRegion = page.locator('[data-workspace-toaster]')
        const notificationPlacement = await notificationRegion.evaluate(element => {
          const style = getComputedStyle(element)
          return { position: style.position, top: style.top, right: style.right }
        })
        expect(notificationPlacement, 'theme notifications remain in the fixed upper-right stack').toEqual({ position: 'fixed', top: '16px', right: '16px' })
        await expect(notificationRegion.locator('[data-workspace-toast]:visible').first()).toContainText('Theme changed to')
        const activeNav = page.locator('[data-sg-app-sidebar="true"] a[aria-current="page"] > span').first()
        const expectedAlternateNavBackground = alternateTheme === 'pure-clarity' ? 'rgb(239, 246, 255)' : 'rgb(18, 59, 122)'
        await expect.poll(
          () => activeNav.evaluate(element => getComputedStyle(element).backgroundColor),
          { message: `${alternateTheme} selected navigation color after switching`, timeout: 1000 },
        ).toBe(expectedAlternateNavBackground)
        await page.getByRole('button', { name: 'Appearance' }).click()
        await page.getByRole('menuitem', { name: originalAppearance }).click()
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(page.locator('.nova-app-shell')).toHaveAttribute('data-theme', theme)
        const visibleNotifications = page.locator('[data-workspace-toast]:visible')
        while (await visibleNotifications.count() > 0) {
          await visibleNotifications.first().getByRole('button', { name: 'Dismiss notification' }).click()
        }
        await expect(visibleNotifications).toHaveCount(0)
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        })

        await page.emulateMedia({ reducedMotion: 'reduce' })
        const reducedMotionDuration = await activeNav.evaluate(element => getComputedStyle(element).transitionDuration.split(',')[0])
        expect(Number.parseFloat(reducedMotionDuration), 'reduced-motion transition duration').toBeLessThan(0.001)
        await page.emulateMedia({ reducedMotion: 'no-preference' })
      }
      if (route.retired) {
        await expect(page.getByRole('heading', { name: `${route.retired} is outside SysGrid`, exact: true })).toBeVisible()
      }

      const pageHeaders = main.locator('[data-golden-page-header="true"]')
      await expect(pageHeaders, `${route.key} should use one shared page header`).toHaveCount(1)
      const pageHeader = pageHeaders.first()
      if (await pageHeader.count()) {
        const geometry = await pageHeader.evaluate(element => {
          const rail = getComputedStyle(element, '::before')
          const title = element.querySelector('h1')
          const railProbe = document.createElement('span')
          railProbe.style.color = 'var(--workspace-ink)'
          element.appendChild(railProbe)
          const expectedRailColor = getComputedStyle(railProbe).color
          railProbe.remove()
          return { railColor: rail.backgroundColor, expectedRailColor, railHeight: rail.height, titleWeight: title ? getComputedStyle(title).fontWeight : '' }
        })
        expect(geometry.railColor, `${route.key} should use the shared neutral theme accent`).toBe(geometry.expectedRailColor)
        expect(geometry.railHeight, `${route.key} should use the shared title-rail height`).toBe('64px')
        expect(geometry.titleWeight, `${route.key} title should use the shared strong weight`).toBe('700')
      }

      const capture = async (name: string) => {
        const imagePath = testInfo.outputPath(`${theme}-${name}.png`)
        await page.screenshot({ path: imagePath, animations: 'disabled' })
        await testInfo.attach(`${theme}-${name}`, { path: imagePath, contentType: 'image/png' })
      }

      if (route.key === 'assets') {
        const viewGroup = page.getByRole('group', { name: 'View selection' }).first()
        await viewGroup.getByRole('button', { name: 'Grid', exact: true }).click()
        await expect(page.locator('[data-golden-grid-surface="true"]')).toBeVisible()
        await capture('assets-grid')
        await viewGroup.getByRole('button', { name: 'Report', exact: true }).click()
        await expect(page.locator('[data-asset-report]')).toBeVisible()
        await capture('assets-report')
        await viewGroup.getByRole('button', { name: 'Map', exact: true }).click()
        const mapSurface = page.locator('[data-asset-map]')
        const emptyTopology = page.getByText('No asset topology available', { exact: true })
        await expect(mapSurface.or(emptyTopology)).toBeVisible()
        await capture(await emptyTopology.isVisible() ? 'assets-map-empty' : 'assets-map')
      } else {
        await capture(route.key)
      }

      expect(consoleErrors.filter(entry => /Failed to fetch|ECONNREFUSED|Unhandled/i.test(entry)), `${route.path} console errors`).toEqual([])
      expect(failedRequests.filter(entry => /ECONNREFUSED|net::ERR|Failed/i.test(entry)), `${route.path} failed requests`).toEqual([])
      expect(externalRuntimeRequests, `${route.path} must not load runtime resources from outside the configured app/API hosts`).toEqual([])
    } finally {
      page.removeListener('console', onConsole)
      page.removeListener('requestfailed', onRequestFailed)
      page.removeListener('request', onRequest)
    }
  }
}

test.describe('SysGrid data-hub desktop visual matrix', () => {
  for (const theme of ['nordic-frost-v1', 'pure-clarity'] as const) {
    test(`${theme} views, title rails, and retirement routes`, async ({ page, sysApi }, testInfo) => {
      const preference = await sysApi.get(`${apiBase}/settings/user/settings`)
      expect(preference.ok(), 'the current appearance preference should be readable').toBeTruthy()
      const originalTheme = (await preference.json()).theme || 'nordic-frost-v1'
      try {
        await resetBrowserState(page)
        await captureRouteMatrix(page, sysApi, testInfo, theme)
      } finally {
        const restore = await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme: originalTheme } })
        expect(restore.ok(), 'the original appearance preference should be restored after visual proof').toBeTruthy()
      }
    })
  }
})
