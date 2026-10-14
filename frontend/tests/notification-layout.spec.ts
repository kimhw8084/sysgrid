import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const height of [360, 844]) {
    test(`phone notifications reserve space and survive a covering modal ${theme} ${height}`, async ({ page, sysApi: request }, testInfo) => {
      await page.setViewportSize({ width: 390, height })
      await resetBrowserState(page)
      await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      await createAsset(request, { name: `Notification layout ${theme}-${height}-${Date.now()}`, type: 'Physical', status: 'Active', system: 'Notification layout' })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto('/asset')
      const header = page.locator('[data-sg-shell-header]')
      const content = page.locator('#sg-main-content')
      const empty = await content.boundingBox()
      expect(empty).not.toBeNull()
      await page.getByRole('button', { name: 'View & filters', exact: true }).click()
      await page.getByRole('button', { name: 'Export asset data' }).click()
      await page.getByRole('button', { name: /^Export CSV/ }).click()
      const notice = page.locator('[data-workspace-toast][data-visible="true"]').filter({ hasText: 'Asset CSV exported' })
      await expect(notice).toBeVisible()
      const dismiss = notice.getByRole('button', { name: 'Dismiss notification' })
      await dismiss.focus()
      const region = page.getByRole('region', { name: 'Notifications' })
      await expect.poll(async () => {
        const h = await header.boundingBox(), n = await region.boundingBox(), c = await content.boundingBox()
        return !!h && !!n && !!c && n.y >= h.y + h.height && c.y >= n.y + n.height && c.height > 64 && c.y > empty!.y
      }, { message: 'Phone notifications must have their own space between shell tools and workspace content' }).toBeTruthy()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expectReadableGridText(page, testInfo, 'phone-notification', '[data-workspace-toast][data-visible="true"]')
      await page.screenshot({ path: testInfo.outputPath('phone-notification.png'), animations: 'disabled' })

      // Resize the existing renderer rather than reconstructing the notice or its recovery state.
      const original = await notice.elementHandle()
      await page.setViewportSize({ width: 1440, height: 900 })
      await expect.poll(() => region.evaluate(node => getComputedStyle(node).position)).toBe('fixed')
      expect(await notice.evaluate((node, prior) => node === prior, original)).toBe(true)
      await expect(dismiss).toBeFocused()
      await page.screenshot({ path: testInfo.outputPath('desktop-notification.png'), animations: 'disabled' })
      await page.setViewportSize({ width: 390, height })
      await page.getByRole('button', { name: 'Register Asset', exact: true }).click()
      const form = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Create Asset', exact: true }) })
      await expect(form).toBeVisible()
      await expect(form.locator('[data-workspace-modal-notification-slot]')).toContainText('Asset CSV exported')
      await expect.poll(() => notice.evaluate(node => {
        const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + 20)
        return !!hit && node.contains(hit) && !!hit.closest('[aria-modal="true"]')
      })).toBe(true)
      const coveredGauge = await notice.locator('[data-toast-gauge] > div').getAttribute('style')
      const started = Date.now()
      await expect.poll(() => Date.now() - started).toBeGreaterThan(4500)
      await expect(notice).toBeVisible()
      await expect(notice.locator('[data-toast-gauge] > div')).toHaveAttribute('style', coveredGauge!)
      await page.screenshot({ path: testInfo.outputPath('modal-over-notification.png'), animations: 'disabled' })
      await page.keyboard.press('Escape')
      await expect(form).not.toBeVisible()
      await expect(notice).toBeVisible()
      await dismiss.click()
      await expect(region).not.toBeVisible()
      await expect.poll(async () => (await content.boundingBox())?.height).toBe(empty!.height)
      expect(errors).toEqual([])
    })
  }
}
