import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState, seedOperationalScenario } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const baseline = process.env.SYSGRID_VISUAL_BASELINE === '1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 520 }]) {
    test(`history reference ${theme} ${viewport.width}`, async ({ page, sysApi: request }, testInfo) => {
      await page.setViewportSize(viewport)
      await resetBrowserState(page)
      const { monitoring } = await seedOperationalScenario(request)
      const preference = await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
      expect(preference.ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      const originalPurpose = monitoring.purpose
      const purpose = 'Investigate replication delay before the standby falls outside the recovery objective.'
      const update = await request.put(`${apiBase}/monitoring/${monitoring.id}`, { data: { ...monitoring, purpose } })
      expect(update.ok()).toBeTruthy()
      const revisions = await request.get(`${apiBase}/monitoring/${monitoring.id}/history`)
      expect(revisions.ok()).toBeTruthy()
      const records = await revisions.json()
      expect(records).toHaveLength(2)
      await testInfo.attach('fixture', { body: JSON.stringify({ theme, viewport, monitoring, records }), contentType: 'application/json' })
      await page.goto(`/monitoring?id=${monitoring.id}`)
      const detail = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: monitoring.title, exact: true }) })
      await detail.getByRole('button', { name: 'History', exact: true }).click()
      const history = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Revision History', exact: true }) })
      await expect(history).toBeVisible()
      await page.waitForLoadState('networkidle')
      await expect(history.locator(':scope > .glass-panel')).toHaveCSS('opacity', '1')
      await page.evaluate(() => document.fonts.ready)
      const body = history.locator('[data-workspace-modal-body]')
      const geometry = await body.evaluate(node => ({ width: node.clientWidth, scrollWidth: node.scrollWidth }))
      await testInfo.attach('history-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' })
      await page.screenshot({ path: testInfo.outputPath('history-overview.png'), animations: 'disabled' })
      expect.soft(geometry.scrollWidth - geometry.width).toBeLessThanOrEqual(2)
      expect.soft(await history.locator('button button').count()).toBe(0)
      if (baseline) return

      const current = history.getByRole('button', { name: 'Select revision 2', exact: true })
      await expect(current).toHaveAttribute('aria-pressed', 'true')
      const previous = history.getByRole('button', { name: 'Select revision 1', exact: true })
      await previous.focus()
      await page.keyboard.press('Enter')
      await expect(previous).toHaveAttribute('aria-pressed', 'true')
      await expect(current).toHaveAttribute('aria-pressed', 'true')
      const changed = history.getByRole('heading', { name: 'Changed fields', exact: true })
      await changed.scrollIntoViewIfNeeded()
      await expect(changed).toBeInViewport()
      const currentValue = history.getByText(purpose, { exact: true })
      await currentValue.scrollIntoViewIfNeeded()
      await expect(currentValue).toBeInViewport()
      await page.screenshot({ path: testInfo.outputPath('history-changes.png'), animations: 'disabled' })

      const restored = page.waitForResponse(response => response.url().includes(`/monitoring/${monitoring.id}/restore/`) && response.request().method() === 'POST')
      await history.getByRole('button', { name: 'Restore revision 1', exact: true }).click()
      expect((await restored).ok()).toBeTruthy()
      const after = await request.get(`${apiBase}/monitoring/${monitoring.id}/history`)
      expect(after.ok()).toBeTruthy()
      const restoredHistory = await after.json()
      expect(restoredHistory).toHaveLength(3)
      expect(restoredHistory[0].snapshot.purpose).toBe(originalPurpose)
      await history.getByTitle('Close', { exact: true }).click()
      await expect(history).not.toBeVisible()
      await expect(page).toHaveURL(/\/monitoring$/)
      await expect(page.getByRole('heading', { name: 'Monitoring', exact: true })).toBeVisible()
      await page.goto(`/monitoring?id=${monitoring.id}`)
      await expect(detail).toBeVisible()
      await expect(detail.getByText(originalPurpose, { exact: true })).toBeVisible()
    })
  }
}
