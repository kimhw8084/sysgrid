import { expect, type Locator, type Page } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, createRack, createSite, getWorkspaceLogicalRowByText, resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

async function expectReachable(panel: Locator, page: Page) {
  await expect(panel).toBeVisible()
  const viewport = page.viewportSize()!
  await expect.poll(async () => {
    const b = await panel.boundingBox()
    return !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= viewport.width + 1 && b.y + b.height <= viewport.height + 1
  }).toBeTruthy()
  const obscured = await panel.evaluate(node => {
    const r = node.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, Math.min(r.bottom - 8, r.top + 30))
    return !hit || !node.contains(hit)
  })
  expect(obscured, 'A higher layer must not cover the popup').toBe(false)
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const width of [1024, 1440]) {
    test(`overlay palette, layering and resize ${theme} ${width}`, async ({ page, sysApi: request }, testInfo) => {
      await page.setViewportSize({ width, height: 800 })
      await resetBrowserState(page)
      await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      await createAsset(request, { name: `Overlay host ${theme}-${width}`, type: 'Physical', status: 'Active', system: 'Overlay audit' })
      const site = await createSite(request, { name: `Overlay hall ${theme}-${width}`, color: '#888888' })
      await createRack(request, { site_id: site.id, name: 'Overlay rack', total_u: 12, aisle: 'A', row: '1' })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))

      for (const route of ['/asset', '/services', '/monitoring', '/network']) {
        await page.goto(route)
        await expect(page.locator('#sg-main-content h1, #sg-main-content h2').first()).toBeVisible()
        for (const name of ['Views', 'Display']) {
          await page.getByRole('button', { name, exact: true }).click()
          const popup = page.locator('[data-workspace-panel]').last()
          await expectReachable(popup, page)
          await expectReadableGridText(page, testInfo, `${route.slice(1)}-${name}`, '[data-workspace-panel]')
          await page.setViewportSize({ width: width === 1024 ? 1280 : 1024, height: 650 })
          await expectReachable(popup, page)
          await page.screenshot({ path: testInfo.outputPath(`${route.slice(1)}-${name}.png`), animations: 'disabled' })
          await page.keyboard.press('Escape')
          await expect(popup).not.toBeVisible()
          await page.setViewportSize({ width, height: 800 })
        }
      }

      await page.goto('/asset')
      await page.getByRole('button', { name: 'Register Asset', exact: true }).click()
      const form = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Create Asset', exact: true }) })
      await expect(form).toBeVisible()
      await form.getByRole('button', { name: 'Physical', exact: true }).click()
      const selector = page.locator('[data-workspace-panel]').last()
      await expectReachable(selector, page)
      await expectReadableGridText(page, testInfo, 'asset-type-selector', '[data-workspace-panel]')
      await page.screenshot({ path: testInfo.outputPath('asset-form-selector.png'), animations: 'disabled' })
      await page.keyboard.press('Escape')
      await expect(selector).not.toBeVisible()
      await expect(form).toBeVisible()
      await expect(form.getByRole('button', { name: 'Physical', exact: true })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(form).not.toBeVisible()

      await page.getByRole('button', { name: 'Import asset rows' }).click()
      const importer = page.getByRole('dialog').filter({ has: page.getByText('Assets Import', { exact: true }) })
      await importer.getByTitle('Maximize', { exact: true }).click()
      await page.getByRole('button', { name: 'Paste CSV / Grid', exact: true }).click()
      await page.getByPlaceholder('Paste CSV with headers, or paste spreadsheet cells directly...').fill('name,system\nOverlay draft,Audit')
      await importer.getByTitle('Close', { exact: true }).click()
      const discard = page.getByRole('alertdialog', { name: 'Unsaved Changes' })
      await expectReachable(discard, page)
      await expectReadableGridText(page, testInfo, 'fullscreen-discard', '[role="alertdialog"]')
      await page.screenshot({ path: testInfo.outputPath('fullscreen-discard.png'), animations: 'disabled' })
      await discard.getByRole('button', { name: 'Discard Changes', exact: true }).click()
      await expect(importer).not.toBeVisible()

      await page.getByRole('button', { name: 'Export asset data' }).click()
      await page.getByRole('button', { name: /^Export CSV/ }).click()
      const notice = page.locator('[data-workspace-toast][data-visible="true"]').filter({ hasText: 'Asset CSV exported' })
      await expectReachable(notice, page)
      await notice.hover()
      await expect(notice.locator('[data-toast-gauge] > div')).toBeVisible()
      await expectReadableGridText(page, testInfo, 'notification', '[data-workspace-toast][data-visible="true"]')
      await page.screenshot({ path: testInfo.outputPath('notification.png'), animations: 'disabled' })
      await notice.getByRole('button', { name: 'Dismiss notification' }).click()
      await expect(notice).not.toBeVisible()

      await page.goto('/racks')
      await page.getByRole('button', { name: 'Configure PDU A', exact: true }).first().hover()
      await expectReachable(page.getByRole('tooltip'), page)
      await expectReadableGridText(page, testInfo, 'rack-pdu-hint', '[role="tooltip"]')
      await page.screenshot({ path: testInfo.outputPath('rack-pdu-hint.png'), animations: 'disabled' })
      await page.keyboard.press('Escape')
      await expect(page.getByRole('tooltip')).not.toBeVisible()
      await page.getByRole('button', { name: 'Add', exact: true }).click()
      await page.getByRole('button', { name: 'Add Site', exact: true }).click()
      const siteDialog = page.getByRole('dialog').last()
      await expectReachable(siteDialog.locator(':scope > :first-child'), page)
      await expectReadableGridText(page, testInfo, 'rack-site-dialog', '[role="dialog"]')
      await page.screenshot({ path: testInfo.outputPath('rack-site-dialog.png'), animations: 'disabled' })
      await siteDialog.getByRole('textbox').first().fill('Unsaved site draft')
      await page.keyboard.press('Escape')
      const siteDiscard = page.getByRole('dialog', { name: 'Discard site changes?', exact: true })
      await expectReachable(siteDiscard.locator(':scope > :first-child'), page)
      await siteDiscard.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(siteDialog.getByRole('textbox').first()).toHaveValue('Unsaved site draft')
      await page.keyboard.press('Escape')
      await siteDiscard.getByRole('button', { name: 'Discard changes', exact: true }).click()
      await expect(siteDialog).not.toBeVisible()
      await page.getByRole('button', { name: `Site actions for ${site.name}`, exact: true }).click()
      await expectReachable(page.locator('[data-workspace-panel]').last(), page)
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: /^Open error console/ }).click()
      const errorConsole = page.getByRole('dialog', { name: 'Error console', exact: true })
      await expectReachable(errorConsole.locator(':scope > :first-child'), page)
      await page.keyboard.press('Escape')
      await expect(errorConsole).not.toBeVisible()
      await page.getByRole('button', { name: 'Search released and authorized records', exact: true }).click()
      await page.getByRole('textbox', { name: 'Search released and authorized records' }).fill('no-matching-record-987654321')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('textbox', { name: 'Search released and authorized records' })).not.toBeVisible()
      expect(errors).toEqual([])
    })
  }
}

test('reversible notification confirms once and restores the actual archived record', async ({ page, sysApi: request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await resetBrowserState(page)
  await request.patch(`${apiBase}/settings/user/settings`, { data: { theme: 'nordic-frost-v1' } })
  await page.addInitScript(() => localStorage.setItem('sysgrid-theme', 'nordic-frost-v1'))
  const asset = await createAsset(request, { name: 'Toast recovery audit host', type: 'Physical', status: 'Active', system: 'Overlay audit' })
  await page.goto('/asset')
  await page.getByPlaceholder('Scan asset matrix...').fill(asset.name)
  const row = await getWorkspaceLogicalRowByText(page, 'assets', asset.name)
  await row.action('More actions').click()
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm Archive?', exact: true }).click()
  await page.getByRole('dialog', { name: 'Assets bulk preview' }).getByRole('button', { name: 'Confirm Archive selection' }).click()
  await page.getByRole('dialog', { name: 'Assets bulk complete' }).getByRole('button', { name: 'Close bulk receipt' }).click()
  const toast = page.locator('[data-workspace-toast][data-visible="true"]').filter({ hasText: 'Archived 1 of 1 selected records.' })
  await expectReachable(toast, page)
  await toast.hover()
  await expectReadableGridText(page, testInfo, 'reversible-notification', '[data-workspace-toast][data-visible="true"]')
  await page.screenshot({ path: testInfo.outputPath('reversible-notification.png'), animations: 'disabled' })
  await toast.getByRole('button', { name: 'Revert', exact: true }).click()
  await expect(toast.getByRole('button', { name: 'Confirm Undo?', exact: true })).toBeVisible()
  const restored = page.waitForResponse(response => response.url().includes('/devices/bulk-action') && response.request().postDataJSON()?.action === 'restore')
  await toast.getByRole('button', { name: 'Confirm Undo?', exact: true }).click()
  expect((await restored).ok()).toBeTruthy()
  await expect(page.getByText('Bulk operation reverted.', { exact: true })).toBeVisible()
  await expect((await getWorkspaceLogicalRowByText(page, 'assets', asset.name)).center!).toBeVisible()
})
