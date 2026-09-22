import { test, expect } from '@playwright/test'
import { resetBrowserState } from './helpers/sysgrid'
import { OPERATIONAL_WORKSPACE_MATRIX } from './helpers/operational-matrix'

test.describe('Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    await resetBrowserState(page)
  })

  // Canonical route coverage based on operational matrix
  for (const workspace of OPERATIONAL_WORKSPACE_MATRIX) {
    test(`Canonical Page Load: ${workspace.key} (${workspace.route})`, async ({ page }) => {
      await page.goto(workspace.route)

      // Normal-v1 must prove deferred standalone routes fail before their
      // preview component mounts; production routes retain their canonical
      // workspace readiness assertion.
      const previewKeys = new Set(['external', 'far', 'research', 'vendors'])
      if (previewKeys.has(workspace.key)) {
        await expect(page.getByRole('heading', { name: 'Access unavailable', exact: true })).toBeVisible({ timeout: 30000 })
      } else {
        await expect(page.locator(workspace.selector)).toBeVisible({ timeout: 30000 })
      }
      
      // Ensure the URL matches the canonical route (allowing for query params)
      await expect(page).toHaveURL(new RegExp(workspace.route.split('?')[0]))
    })
  }

  // Legacy/Dashboard coverage
  const otherRoutes = [
    { path: '/', expectedText: /Observed health history \(24h\)/i },
    { path: '/projects', expectedText: /Access unavailable/i },
    { path: '/racks', expectedText: /Racks/i },
  ]

  for (const route of otherRoutes) {
    test(`Page Load: ${route.path}`, async ({ page }) => {
      await page.goto(route.path)
      await expect(page.locator('body')).toContainText(route.expectedText, { timeout: 30000 })
    })
  }
})
