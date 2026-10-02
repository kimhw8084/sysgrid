import { expect, type Locator, type TestInfo } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, createConnection, resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

async function expectOpaqueSurface(surface: Locator, testInfo: TestInfo, name: string) {
  const paint = await surface.evaluate(element => {
    const color = getComputedStyle(element).backgroundColor
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    context.fillStyle = color
    context.fillRect(0, 0, 1, 1)
    return { color, rgba: Array.from(context.getImageData(0, 0, 1, 1).data), opacity: getComputedStyle(element).opacity }
  })
  await testInfo.attach(`${name}-paint`, { body: JSON.stringify(paint), contentType: 'application/json' })
  expect.soft(paint.rgba[3], `${name} must obscure content beneath the reading surface`).toBe(255)
  expect.soft(paint.opacity).toBe('1')
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  test(`shared overlay surfaces remain opaque and readable in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    await resetBrowserState(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect((await request.patch(`${process.env.PW_API_BASE}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const name = `Overlay surface ${theme} ${Date.now()}`
    const source = await createAsset(request, { name, system: 'Surface proof' })
    const peer = await createAsset(request, { name: `Peer ${name}`, system: 'Surface proof' })
    await createConnection(request, { device_a_id: source.id, device_b_id: peer.id, source_port: 'eth0', target_port: 'eth1', link_type: 'Data', speed_gbps: 10, unit: 'Gbps', status: 'Active' })
    await page.goto('/network')
    await page.getByPlaceholder('Scan matrix...').fill(name)
    await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(1)
    await page.getByRole('button', { name: 'Views', exact: true }).click()
    const views = page.locator('[data-workspace-panel-key="views-menu"]')
    await expect(views).toBeVisible()
    await expectOpaqueSurface(views.locator(':scope > div').first(), testInfo, 'saved-views')
    await expectReadableGridText(page, testInfo, 'saved-views', '[data-workspace-panel-key="views-menu"]')
    await page.screenshot({ path: testInfo.outputPath(`saved-views-${theme}.png`), animations: 'disabled' })
    await views.getByPlaceholder('Save as new view...').fill(`Surface view ${theme}`)
    await views.getByRole('button', { name: 'Save New', exact: true }).click()
    const toast = page.locator('.workspace-toast[data-visible="true"]').filter({ hasText: 'Saved' }).last()
    await expect(toast).toBeVisible()
    await expectOpaqueSurface(toast, testInfo, 'notification')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Display', exact: true }).click()
    const display = page.locator('[data-workspace-panel-key="display-menu"]')
    await expect(display).toBeVisible()
    await expectOpaqueSurface(display.locator(':scope > div').first(), testInfo, 'display-menu')
    await expectReadableGridText(page, testInfo, 'display-menu', '[data-workspace-panel-key="display-menu"]')
    await page.screenshot({ path: testInfo.outputPath(`display-${theme}.png`), animations: 'disabled' })

    await page.goto(`/logs?target_table=devices&target_id=${source.id}`)
    await page.getByRole('button', { name: 'View change payload', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Audit Change Payload', exact: true })
    await expect(dialog).toBeVisible()
    await expectOpaqueSurface(dialog.locator(':scope > div').first(), testInfo, 'audit-payload')
    await expectReadableGridText(page, testInfo, 'audit-payload', '[role="dialog"][aria-label="Audit Change Payload"] :is(h3, p, pre)')
    await page.screenshot({ path: testInfo.outputPath(`payload-${theme}.png`), animations: 'disabled' })
  })
}
