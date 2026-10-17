import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState } from './helpers/sysgrid'

test('periodic configuration refresh survives a silent worker socket without resetting a draft', async ({ page }) => {
  await resetBrowserState(page)
  await page.clock.install()
  // A healthy transport that receives no broadcast models a different backend worker.
  await page.addInitScript(() => {
    class QuietSocket {
      onmessage = null
      onerror = null
      close() {}
    }
    window.WebSocket = QuietSocket as unknown as typeof WebSocket
  })
  let generation = 'initial'
  let refreshes = 0
  await page.route('**/api/v1/settings/bootstrap', async route => {
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    refreshes++
    await route.fulfill({ response, json: { ...await response.json(), VITE_BUGANIZER_URL: `https://issues.invalid/${generation}` } })
  })
  await page.goto('/asset')
  await page.getByRole('button', { name: 'Register Asset', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create Asset', exact: true })
  const owner = dialog.getByRole('textbox', { name: 'Owner', exact: true })
  await owner.fill('Draft retained during background sync')
  await owner.evaluate(node => node.setAttribute('data-sync-draft-proof', 'original-node'))
  generation = 'updated'
  const before = refreshes
  await page.clock.fastForward(60_000)
  await expect.poll(() => refreshes).toBeGreaterThan(before)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('SYSGRID_CONFIG_VITE_BUGANIZER_URL'))).toBe('https://issues.invalid/updated')
  await expect(owner).toHaveValue('Draft retained during background sync')
  await expect(owner).toHaveAttribute('data-sync-draft-proof', 'original-node')
  await expect(dialog).toBeVisible()
})

test('bootstrap cache drops obsolete and legacy private entries while preserving unrelated preferences', async ({ page }) => {
  await resetBrowserState(page)
  await page.addInitScript(() => {
    localStorage.setItem('SYSGRID_CONFIG_SCHEDULE_PREVIEW_SIGNING_KEY', 'synthetic-legacy-cache-value')
    localStorage.setItem('SYSGRID_CONFIG_VITE_RETIRED_SETTING', 'obsolete-public-value')
    localStorage.setItem('SYSGRID_CONFIG__raw_env', 'legacy-diagnostic-metadata')
    localStorage.setItem('sysgrid_unrelated_cache_preference', 'preserved-preference')
  })
  await page.goto('/asset')
  await expect(page.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('SYSGRID_CONFIG_SCHEDULE_PREVIEW_SIGNING_KEY'))).toBeNull()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('SYSGRID_CONFIG_VITE_RETIRED_SETTING'))).toBeNull()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('SYSGRID_CONFIG__raw_env'))).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('sysgrid_unrelated_cache_preference'))).toBe('preserved-preference')
  expect(await page.evaluate(() => localStorage.getItem('SYSGRID_CONFIG_DEFAULT_USER_ID'))).toBeTruthy()
})

test('settings reads do not copy private configuration into the bootstrap cache', async ({ page }) => {
  await resetBrowserState(page)
  await page.route('**/api/v1/settings/global', async route => {
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    const data = await response.json()
    await route.fulfill({ response, json: {
      ...data,
      PRIVATE_CACHE_PROBE: 'synthetic-private-cache-probe',
      _metadata: { ...data._metadata, PRIVATE_CACHE_PROBE: { category: 'Infrastructure', description: 'Synthetic private configuration', file: 'Database', param: 'PRIVATE_CACHE_PROBE' } },
    } })
  })
  await page.goto('/settings')
  await expect(page.getByText('PRIVATE CACHE PROBE', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('SYSGRID_CONFIG_PRIVATE_CACHE_PROBE'))).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('SYSGRID_CONFIG__metadata'))).toBeNull()
})
