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
