import { expect, test } from '@playwright/test'
import { isExpectedTelemetryRequest } from '../src/observability/browserFailurePolicy'

const routes = ['/', '/asset', '/monitoring', '/services', '/network', '/racks', '/logs', '/settings']

test.describe('CHG-120 normal-v1 eight-route smoke', () => {
  test('settles every production V1 route without a shell or connection failure', async ({ page }) => {
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('requestfailed', (request) => {
      if (isExpectedTelemetryRequest({
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
      })) return

      failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`)
    })

    for (const route of routes) {
      await page.goto(route)
      await expect(page.locator('[data-sg-state="fatal-error"]')).not.toBeVisible()
      await expect(page.locator('[data-sg-state="permission-denied"]')).not.toBeVisible()
      await expect(page.locator('body')).not.toContainText('Connection lost')
      await expect(page.locator('body')).not.toContainText('Unable to render this view')
    }

    expect(consoleErrors.filter((entry) => /Failed to fetch|ECONNREFUSED|Unhandled/i.test(entry))).toEqual([])
    expect(failedRequests.filter((entry) => /ECONNREFUSED|net::ERR|Failed/i.test(entry))).toEqual([])
  })
})
