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

      await expect(page.locator(workspace.selector)).toBeVisible({ timeout: 30000 })
      
      // Ensure the URL matches the canonical route (allowing for query params)
      await expect(page).toHaveURL(new RegExp(workspace.route.split('?')[0]))
    })
  }

  // Legacy/Dashboard coverage
  const otherRoutes = [
    { path: '/', expectedText: /Observed health history \(24h\)/i },
    { path: '/projects', expectedText: /Projects/i },
    { path: '/racks', expectedText: /Racks/i },
  ]

  for (const route of otherRoutes) {
    test(`Page Load: ${route.path}`, async ({ page }) => {
      await page.goto(route.path)
      await expect(page.locator('body')).toContainText(route.expectedText, { timeout: 30000 })
    })
  }
})


test('structured startup diagnostics remain visible when bootstrap fails', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/v1/settings/bootstrap', route => route.abort('failed'))
  await page.route('**/api/v1/settings/startup-check', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*'},
    body: JSON.stringify({ detail: { code: 'STARTUP_UNAVAILABLE', message: 'Backend startup is unavailable' } }),
  }))
  await page.goto('/')
  await expect(page.getByText('Backend startup is unavailable', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Retry/ }).first()).toBeVisible()
  expect(errors).toEqual([])
})
