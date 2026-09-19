import { expect, test, type ConsoleMessage, type Request } from '@playwright/test'
import { isExpectedTelemetryRequest } from '../src/observability/browserFailurePolicy'

const routes = ['/', '/asset', '/monitoring', '/services', '/network', '/racks', '/logs', '/settings']

test.describe('CHG-120 normal-v1 eight-route smoke', () => {
  test('settles every production V1 route without a shell or connection failure', async ({ context }) => {
    for (const route of routes) {
      const page = await context.newPage()
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
        await page.goto(route)
        await expect(page.locator('[data-sg-state="fatal-error"]'), `${route} fatal error`).not.toBeVisible()
        await expect(page.locator('[data-sg-state="permission-denied"]'), `${route} permission denied`).not.toBeVisible()
        await expect(page.locator('body'), `${route} connection lost`).not.toContainText('Connection lost')
        await expect(page.locator('body'), `${route} render failure`).not.toContainText('Unable to render this view')
        await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})

        expect(consoleErrors.filter((entry) => /Failed to fetch|ECONNREFUSED|Unhandled/i.test(entry)), `${route} console errors`).toEqual([])
        expect(failedRequests.filter((entry) => /ECONNREFUSED|net::ERR|Failed/i.test(entry)), `${route} failed requests`).toEqual([])
      } finally {
        page.removeListener('console', onConsole)
        page.removeListener('requestfailed', onRequestFailed)
        await page.close()
      }
    }
  })
})
