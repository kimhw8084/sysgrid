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

  for (const route of routes) {
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    const onConsole = (message: ConsoleMessage) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    }
    const onRequestFailed = (request: Request) => {
      if (isExpectedTelemetryRequest({
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
      })) return
      failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`)
    }
    page.on('console', onConsole)
    page.on('requestfailed', onRequestFailed)

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
      if (route.retired) {
        await expect(page.getByRole('heading', { name: `${route.retired} is outside SysGrid`, exact: true })).toBeVisible()
      }

      const pageHeaders = main.locator('[data-golden-page-header="true"]')
      if (route.key !== 'home') await expect(pageHeaders, `${route.key} should use one shared page header`).toHaveCount(1)
      const pageHeader = pageHeaders.first()
      if (await pageHeader.count()) {
        const geometry = await pageHeader.evaluate(element => {
          const rail = getComputedStyle(element, '::before')
          const title = element.querySelector('h1')
          return { railColor: rail.backgroundColor, railHeight: rail.height, titleWeight: title ? getComputedStyle(title).fontWeight : '' }
        })
        const expectedBlue = theme === 'pure-clarity' ? 'rgb(37, 99, 235)' : 'rgb(106, 146, 255)'
        expect(geometry.railColor, `${route.key} should use the shared brand-blue accent`).toBe(expectedBlue)
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
    } finally {
      page.removeListener('console', onConsole)
      page.removeListener('requestfailed', onRequestFailed)
    }
  }
}

test.describe('SysGrid data-hub desktop visual matrix', () => {
  for (const theme of ['nordic-frost-v1', 'pure-clarity'] as const) {
    test(`${theme} views, title rails, and retirement routes`, async ({ page, sysApi }, testInfo) => {
      await resetBrowserState(page)
      await captureRouteMatrix(page, sysApi, testInfo, theme)
    })
  }
})
