import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { clickResilientButton, createAsset, createService, resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const peerWrite of ['individual', 'bulk', 'asset-editor']) {
    test(`stale Service draft preserves ${peerWrite} peer data and its inputs in ${theme}`, async ({ page, sysApi }, testInfo) => {
      await resetBrowserState(page)
      await page.setViewportSize({ width: 1440, height: 900 })
      expect((await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      const host = await createAsset(sysApi, { name: `Service conflict host ${Date.now()}`, system: 'Service conflict qualification' })
      const service = await createService(sysApi, { name: `Service conflict ${theme} ${peerWrite} ${Date.now()}`,
        service_type: 'Database', status: 'Existing', environment: 'Production', version: '1', purpose: 'Original purpose', device_id: host.id })
      if (peerWrite === 'asset-editor') {
        await page.goto(`/asset?id=${host.id}`)
        await page.getByRole('group', { name: 'Asset detail sections' }).getByRole('button', { name: 'services', exact: true }).click()
        await page.getByRole('row').filter({ hasText: service.name }).getByTitle('Edit Service Instance').click()
      } else {
        await page.goto(`/services?id=${service.id}`)
        await clickResilientButton(page, 'Edit Service')
      }
      const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Edit Service', exact: true }) })
      await dialog.evaluate(node => node.setAttribute('data-service-conflict-dialog', 'true'))
      await expect(dialog.getByRole('button', { name: new RegExp(host.name) })).toBeVisible()
      const purpose = dialog.getByLabel('Purpose', { exact: true })
      await purpose.fill('Draft from the earlier snapshot')
      await purpose.evaluate(node => node.setAttribute('data-service-draft-proof', 'original-input'))
      const peer = peerWrite !== 'bulk'
        ? await sysApi.put(`${apiBase}/logical-services/${service.id}`, { data: { version: '2', purpose: 'Newer peer purpose' } })
        : await sysApi.post(`${apiBase}/logical-services/bulk-action`, { data: { ids: [service.id], action: 'update', payload: { version: '2' } } })
      expect(peer.status()).toBe(200)
      const pending = page.waitForResponse(response => response.url().endsWith(`/logical-services/${service.id}`) && response.request().method() === 'PUT')
      await dialog.getByRole('button', { name: 'Save Service', exact: true }).click()
      const rejected = await pending
      expect(rejected.request().postDataJSON().expected_revision).toBe(service.edit_revision)
      expect(rejected.status()).toBe(409)
      await expect(dialog).toBeVisible()
      await expect(purpose).toHaveValue('Draft from the earlier snapshot')
      await expect(purpose).toHaveAttribute('data-service-draft-proof', 'original-input')
      await expect(dialog.getByRole('paragraph').filter({ hasText: 'This service changed after you opened it.' })).toBeInViewport({ ratio: 1 })
      const readback = await sysApi.get(`${apiBase}/logical-services?include_deleted=true`)
      expect(readback.status()).toBe(200)
      const retained = (await readback.json()).find((row: { id: number }) => row.id === service.id)
      expect(retained.version).toBe('2')
      expect(retained.purpose).toBe(peerWrite !== 'bulk' ? 'Newer peer purpose' : 'Original purpose')
      expect(retained.edit_revision).not.toBe(service.edit_revision)
      await expectReadableGridText(page, testInfo, 'Service conflict draft', '[data-service-conflict-dialog="true"]')
      await page.screenshot({ path: testInfo.outputPath('service-conflict-desktop.png'), animations: 'disabled' })
      await page.setViewportSize({ width: 390, height: 844 })
      const notice = page.locator('[data-workspace-toast][data-visible="true"]').filter({ hasText: 'Service changed; your draft is preserved.' })
      await expect(notice).toBeInViewport({ ratio: 1 })
      await expect.poll(async () => (await notice.boundingBox())?.height ?? Infinity).toBeLessThanOrEqual(140)
      const notifications = page.getByRole('region', { name: 'Notifications', exact: true })
      await expect(notifications).toHaveCSS('position', 'fixed')
      await expect(notifications).toHaveCSS('top', '16px')
      await expect(notifications).toHaveCSS('right', '16px')
      const save = dialog.getByRole('button', { name: 'Save Service', exact: true })
      await expect(save).toBeInViewport({ ratio: 1 })
      await expect(purpose).toHaveValue('Draft from the earlier snapshot')
      const phoneGeometry = await dialog.locator('form').evaluate(form => {
        const bounds = form.getBoundingClientRect()
        return {
          width: form.clientWidth,
          scrollWidth: form.scrollWidth,
          controls: Array.from(form.querySelectorAll('input, textarea, button')).filter(node => node.getBoundingClientRect().width > 0).map(node => {
            const rect = node.getBoundingClientRect()
            return { tag: node.tagName, withinForm: rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 }
          }),
        }
      })
      await testInfo.attach('service-phone-geometry', { body: JSON.stringify(phoneGeometry), contentType: 'application/json' })
      await page.screenshot({ path: testInfo.outputPath('service-conflict-phone.png'), animations: 'disabled' })
      expect(phoneGeometry.scrollWidth, 'Service form must not require horizontal scrolling').toBeLessThanOrEqual(phoneGeometry.width + 1)
      expect(phoneGeometry.controls.length).toBeGreaterThanOrEqual(14)
      expect(phoneGeometry.controls.every(control => control.withinForm), 'All Service field edges must fit the form').toBe(true)
      await dialog.getByRole('button', { name: 'Close', exact: true }).first().click()
      const discard = page.getByRole('alertdialog', { name: 'Discard Service Changes?', exact: true })
      await expect(discard).toBeVisible()
      await discard.getByRole('button', { name: 'Keep editing', exact: true }).click()
      await expect(dialog).toBeVisible()
      await expect(purpose).toHaveValue('Draft from the earlier snapshot')
      await expect(purpose).toHaveAttribute('data-service-draft-proof', 'original-input')
    })
  }
}
