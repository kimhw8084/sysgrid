import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const baseline = process.env.SYSGRID_VISUAL_BASELINE === '1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }]) {
    test(`settings history ${theme} ${viewport.width}`, async ({ page, sysApi: request }, testInfo) => {
      await resetBrowserState(page)
      await page.setViewportSize(viewport)
      const key = `PW_HISTORY_${theme === 'pure-clarity' ? 'LIGHT' : 'DARK'}_${viewport.width}`
      const label = key.replace(/_/g, ' ')
      const previous = 'Previous maintenance policy: retain the regional recovery window and the full operator handoff instructions.'
      const current = 'Current maintenance policy: verify recovery and record the approved change owner before applying configuration.'
      for (const value of [previous, current]) {
        const response = await request.post(`${apiBase}/settings/global`, { data: { [key]: value } })
        expect(response.ok()).toBeTruthy()
      }
      const preference = await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
      expect(preference.ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      await page.goto('/settings?tab=environments')
      const card = page.getByRole('group', { name: label, exact: true })
      await card.getByRole('button', { name: `History for ${label}`, exact: true }).click()
      const history = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Parameter Revision History', exact: true }) })
      await expect(history).toBeVisible()
      await expect(history.getByText('2 states', { exact: true })).toBeVisible()
      await expect(history.locator(':scope > .glass-panel')).toHaveCSS('opacity', '1')
      await page.evaluate(() => document.fonts.ready)
      const body = history.locator('[data-workspace-modal-body]')
      const geometry = await body.evaluate(node => ({ width: node.clientWidth, scrollWidth: node.scrollWidth }))
      await testInfo.attach('history-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' })
      await page.screenshot({ path: testInfo.outputPath('settings-history-overview.png'), animations: 'disabled' })
      expect.soft(geometry.scrollWidth - geometry.width).toBeLessThanOrEqual(2)
      expect.soft(await history.locator('button button').count()).toBe(0)

      if (!baseline) {
        const older = history.getByRole('button', { name: 'Select revision 1', exact: true })
        await older.focus()
        await page.keyboard.press('Enter')
        await expect(older).toHaveAttribute('aria-pressed', 'true')
        await expect(history.getByRole('button', { name: 'Select revision 2', exact: true })).toHaveAttribute('aria-pressed', 'true')
        const value = history.getByText(current, { exact: true })
        await value.scrollIntoViewIfNeeded()
        await expect(value).toBeInViewport({ ratio: 0.9 })
        await page.screenshot({ path: testInfo.outputPath('settings-history-values.png'), animations: 'disabled' })
        await page.setViewportSize(viewport.width === 1024 ? { width: 1440, height: 900 } : { width: 1024, height: 768 })
        await expect(older).toHaveAttribute('aria-pressed', 'true')
        await expect(history.getByText(current, { exact: true })).toBeVisible()
      }
      const restore = baseline ? history.getByRole('button', { name: 'Restore Vector', exact: true }).last() : history.getByRole('button', { name: 'Restore revision 1 to draft', exact: true })
      await restore.click()
      await expect(history).not.toBeVisible()
      const input = card.getByRole('textbox', { name: label, exact: true })
      await expect(input).toHaveValue(previous)
      const draftResponse = await request.get(`${apiBase}/settings/global`)
      expect(draftResponse.ok()).toBeTruthy()
      expect((await draftResponse.json())[key]).toBe(current)
      const save = card.getByRole('button', { name: `Save ${label}`, exact: true })
      await expect.soft(save).toBeVisible()
      if (baseline) return
      const persisted = page.waitForResponse(response => response.url().endsWith('/settings/global') && response.request().method() === 'POST')
      await save.click()
      expect((await persisted).ok()).toBeTruthy()
      await expect(input).toHaveAttribute('readonly', '')
      const savedResponse = await request.get(`${apiBase}/settings/global`)
      expect(savedResponse.ok()).toBeTruthy()
      expect((await savedResponse.json())[key]).toBe(previous)
      await card.getByRole('button', { name: `History for ${label}`, exact: true }).click()
      await expect(history.getByText('3 states', { exact: true })).toBeVisible()
      await history.getByTitle('Close', { exact: true }).click()
      await expect(history).not.toBeVisible()
      await expect(input).toHaveValue(previous)
    })
  }
}
