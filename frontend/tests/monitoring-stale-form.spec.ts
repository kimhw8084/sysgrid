import { expect, test } from '@playwright/test'
import {
  clickResilientButton,
  createMonitoring,
  resetBrowserState,
  testApiHeaders,
} from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  test(`stale monitor draft preserves the peer save and its own inputs in ${theme}`, async ({ page, request }, testInfo) => {
    await resetBrowserState(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    expect((await request.patch(`${apiBase}/settings/user/settings`, { headers: testApiHeaders, data: { theme } })).ok()).toBeTruthy()
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const monitor = await createMonitoring(request, {
      title: `PW-STALE-FORM-${Date.now()}`, category: 'Hardware', status: 'Existing',
      purpose: 'Original shared purpose',
    })
    await page.goto(`/monitoring?id=${monitor.id}`)
    await clickResilientButton(page, 'Edit Monitor')
    const dialog = page.getByRole('dialog', { name: 'Update Monitoring', exact: true })
    const purpose = dialog.getByPlaceholder('Why are we monitoring this?')
    await purpose.fill('Browser draft that must remain available')
    await purpose.evaluate(node => node.setAttribute('data-stale-draft-proof', 'original-input'))
    const peer = await request.put(`${apiBase}/monitoring/${monitor.id}`, {
      headers: testApiHeaders, data: { purpose: 'Newer peer purpose', impact: 'Peer impact retained' },
    })
    expect(peer.ok()).toBeTruthy()
    const committed = await peer.json()
    const pending = page.waitForResponse(response => response.url().endsWith(`/monitoring/${monitor.id}`) && response.request().method() === 'PUT')
    await dialog.getByRole('button', { name: 'Save Monitoring', exact: true }).click()
    const rejected = await pending
    expect(rejected.request().postDataJSON().expected_revision).toBe(monitor.edit_revision)
    expect(rejected.status()).toBe(409)
    await expect(dialog).toBeVisible()
    await expect(purpose).toHaveValue('Browser draft that must remain available')
    await expect(purpose).toHaveAttribute('data-stale-draft-proof', 'original-input')
    await expect(dialog.getByRole('paragraph').filter({ hasText: /This monitor changed after you opened it/ })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Notifications', exact: true }).getByRole('status'))
      .toHaveText('Monitor changed; your draft is preserved.')
    const rows = await (await request.get(`${apiBase}/monitoring`, { headers: testApiHeaders })).json()
    const retained = rows.find((row: { id: number }) => row.id === monitor.id)
    expect(retained.purpose).toBe('Newer peer purpose')
    expect(retained.impact).toBe('Peer impact retained')
    expect(retained.edit_revision).toBe(committed.edit_revision)
    const history = await (await request.get(`${apiBase}/monitoring/${monitor.id}/history`, { headers: testApiHeaders })).json()
    expect(history).toHaveLength(2)
    await page.screenshot({ path: testInfo.outputPath('stale-monitor-draft-desktop.png'), animations: 'disabled' })
    await expectReadableGridText(page, testInfo, 'stale monitor conflict', '[role="dialog"]')
    await page.setViewportSize({ width: 390, height: 844 })
    const notice = page.locator('[data-workspace-toast][data-visible="true"]')
      .filter({ hasText: 'Monitor changed; your draft is preserved.' })
    await expect(notice).toBeInViewport({ ratio: 1 })
    await expect.poll(async () => (await notice.boundingBox())?.height ?? Infinity).toBeLessThanOrEqual(140)
    const notifications = page.getByRole('region', { name: 'Notifications', exact: true })
    await expect(notifications).toHaveCSS('position', 'fixed')
    await expect(notifications).toHaveCSS('top', '16px')
    await expect(notifications).toHaveCSS('right', '16px')
    const save = dialog.getByRole('button', { name: 'Save Monitoring', exact: true })
    await expect(save).toBeInViewport({ ratio: 1 })
    await expect(purpose).toHaveValue('Browser draft that must remain available')
    await page.screenshot({ path: testInfo.outputPath('stale-monitor-draft-phone.png'), animations: 'disabled' })
  })
}
