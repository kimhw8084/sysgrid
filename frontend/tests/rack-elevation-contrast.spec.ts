import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState, seedRackScenario } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`rack elevation labels stay readable in ${theme} at ${viewport.width}`, async ({ page, sysApi }, testInfo) => {
      await page.setViewportSize(viewport)
      await resetBrowserState(page)
      expect((await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      const { siteA, rackA1, devicePrimary } = await seedRackScenario(sysApi)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto('/racks')
      await page.getByRole('button', { name: `Open site ${siteA.name}`, exact: true }).click()
      const rack = page.locator(`.glass-panel[data-rack-id="${rackA1.id}"]`)
      const mounted = rack.locator(`[data-device-id="${devicePrimary.id}"]`).last()
      await mounted.scrollIntoViewIfNeeded()
      await expect(mounted).toBeInViewport({ ratio: 1 })
      await expect(mounted).toContainText(devicePrimary.name)
      await expect(mounted.getByText('PHY', { exact: true })).toBeVisible()
      await expect(mounted.getByRole('img', { name: 'Status: Active', exact: true })).toBeVisible()
      const empty = rack.locator('[data-u="3"]')
      await empty.hover()
      const hint = empty.getByText('Mount / Reserve', { exact: true })
      await expect.poll(() => hint.evaluate(element => getComputedStyle(element.parentElement!).opacity)).toBe('1')
      await expect(hint).toBeInViewport({ ratio: 1 })
      await page.screenshot({ path: testInfo.outputPath('rack-elevation-labels.png'), animations: 'disabled' })
      // Only the rendered rack units are sampled. PDU tooltip descriptions have
      // intentionally clipped sr-only copies outside these visible unit rows.
      await expectReadableGridText(page, testInfo, `rack-units-${theme}-${viewport.width}`,
        `.glass-panel[data-rack-id="${rackA1.id}"] [data-u]`)
      expect(errors).toEqual([])
    })
  }
}
