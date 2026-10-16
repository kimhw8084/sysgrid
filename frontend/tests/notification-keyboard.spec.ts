import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, resetBrowserState } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE!
const focusable = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const width of [1440, 390]) {
    for (const surface of ['asset-form', 'error-console', 'discard-confirmation']) {
      test(`notification keyboard ownership ${surface} ${theme} ${width}`, async ({ page, sysApi }, testInfo) => {
        await page.setViewportSize({ width, height: width === 390 ? 360 : 900 })
        await resetBrowserState(page)
        expect((await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBe(true)
        await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
        await createAsset(sysApi, { name: `Keyboard notification ${theme}-${width}-${surface}-${Date.now()}`, system: 'Notification keyboard proof' })
        await page.goto('/asset')
        if (width < 768) await page.getByRole('button', { name: 'View & filters', exact: true }).click()
        await page.getByRole('button', { name: 'Export asset data' }).click()
        await page.getByRole('button', { name: /^Export CSV/ }).click()
        const notice = page.locator('[data-workspace-toast][data-visible="true"]').filter({ hasText: 'Asset CSV exported' })
        await expect(notice).toBeVisible()
        // Hold the normal hover pause to isolate focus ownership from expiration.
        await notice.hover()
        if (surface !== 'error-console') {
          await page.getByRole('button', { name: 'Register Asset', exact: true }).click()
        } else {
          if (width < 1024) {
            await page.getByText('App tools', { exact: true }).focus()
            await page.keyboard.press('Enter')
          }
          await page.getByRole('button', { name: /^Open error console/ }).focus()
          await page.keyboard.press('Enter')
        }
        const parent = page.getByRole('dialog', { name: surface === 'error-console' ? 'Error console' : 'Create Asset', exact: true })
        await expect(parent).toBeVisible()
        if (surface === 'discard-confirmation') {
          await parent.getByRole('textbox', { name: 'Owner', exact: true }).fill('Preserved keyboard draft')
          await page.keyboard.press('Escape')
        }
        const dialog = surface === 'discard-confirmation' ? page.getByRole('alertdialog') : parent
        await expect(dialog).toBeVisible()
        await notice.hover()
        const dismiss = notice.getByRole('button', { name: 'Dismiss notification' })
        const first = dialog.locator(focusable).first()
        await expect(first).toBeVisible()
        await first.focus()
        await expect(first).toBeFocused()
        // The wrap boundary avoids browser-specific segmented date-field tab stops.
        await page.keyboard.press('Shift+Tab')
        await testInfo.attach('focus-boundary', { contentType: 'application/json', body: JSON.stringify(await dialog.evaluate(node => ({
          ownsNotification: !!node.querySelector('[data-workspace-toaster]'),
          activeLabel: document.activeElement?.getAttribute('aria-label'),
        }))) })
        await expect(dismiss).toBeFocused()
        const geometry = await notice.locator('..').evaluate(stack => {
          const rect = stack.getBoundingClientRect()
          return { top: rect.top, right: document.documentElement.getBoundingClientRect().right - rect.right }
        })
        expect(Math.round(geometry.top)).toBe(16)
        expect(Math.round(geometry.right)).toBe(16)
        await page.screenshot({ path: testInfo.outputPath('notification-focus-boundary.png'), animations: 'disabled' })
        await page.keyboard.press('Enter')
        await expect(notice).not.toBeVisible()
        await expect(dialog).toBeVisible()
        await page.keyboard.press('Escape')
        if (surface === 'discard-confirmation') {
          await expect(dialog).not.toBeVisible()
          await expect(parent).toBeVisible()
          await expect(parent.getByRole('textbox', { name: 'Owner', exact: true })).toHaveValue('Preserved keyboard draft')
          await page.keyboard.press('Escape')
          await page.getByRole('alertdialog').getByRole('button', { name: 'Discard Changes', exact: true }).click()
        }
        await expect(parent).not.toBeVisible()
      })
    }
  }
}
