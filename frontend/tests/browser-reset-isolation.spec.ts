import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState } from './helpers/sysgrid'

test('storage reset stays inert and real application startup remains observed', async ({ page }) => {
  const errors: string[] = []
  let scripts = 0
  let bootstraps = 0
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (request.resourceType() === 'script') scripts++
    if (new URL(request.url()).pathname === '/api/v1/settings/bootstrap') bootstraps++
  })
  await resetBrowserState(page)
  expect(scripts, 'Storage cleanup must not execute an app that will immediately be torn down').toBe(0)
  expect(bootstraps, 'Storage cleanup must not start background bootstrap requests').toBe(0)
  await page.goto('/asset')
  await expect(page.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible()
  expect(scripts).toBeGreaterThan(0)
  expect(bootstraps).toBeGreaterThan(0)
  expect(errors).toEqual([])
})
