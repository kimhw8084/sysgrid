import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, createConnection, createMonitoring, createService, resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  test(`phone grid retains record identity beside reachable commands in ${theme}`, async ({ page, sysApi }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await resetBrowserState(page)
    expect((await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const suffix = `${theme}-${Date.now()}`
    const host = await createAsset(sysApi, { name: `Phone identity primary ${suffix}`, system: 'Phone identity' })
    const peer = await createAsset(sysApi, { name: `Phone identity peer ${suffix}`, system: 'Phone identity' })
    const service = await createService(sysApi, { name: `Phone identity database ${suffix}`, service_type: 'Database', status: 'Active', device_id: host.id })
    const monitor = await createMonitoring(sysApi, { title: `Phone identity monitor ${suffix}`, category: 'Hardware', status: 'Existing', device_id: host.id })
    const connection = await createConnection(sysApi, { device_a_id: host.id, device_b_id: peer.id,
      source_port: 'eth0', target_port: 'eth1', link_type: 'Data', status: 'Active' })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    for (const item of [
      { path: '/asset', workspace: 'assets', heading: 'Assets', id: host.id, label: host.name },
      { path: '/monitoring', workspace: 'monitoring', heading: 'Monitoring', id: monitor.id, label: monitor.title },
      { path: '/services', workspace: 'services', heading: 'Services', id: service.id, label: service.name },
      { path: '/network', workspace: 'network', heading: 'Network', id: connection.id, label: host.name },
    ] as const) {
      await page.goto(item.path)
      const root = page.locator('[data-golden-workspace-shell]:visible').filter({ has: page.getByRole('heading', { name: item.heading, exact: true }) }).first()
      const row = root.locator(`.ag-pinned-right-cols-container .ag-row[row-id="${item.id}"]`)
      await expect(row).toBeVisible()
      const caption = row.locator('[data-operational-row-identity]')
      await expect(caption).toContainText(item.label)
      await expect(caption).toBeInViewport({ ratio: 1 })
      await expect.poll(async () => (await caption.boundingBox())?.width ?? 0).toBeGreaterThan(100)
      await expect.poll(async () => (await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(52)
      const open = row.getByRole('button', { name: 'Open details', exact: true })
      await expect(open).toBeInViewport({ ratio: 1 })
      await expect(row.getByRole('button', { name: 'More actions', exact: true })).toBeInViewport({ ratio: 1 })
      await expectReadableGridText(page, testInfo, `${item.workspace}-phone-identity`)
      await page.screenshot({ path: testInfo.outputPath(`${item.workspace}-identity-${theme}.png`), animations: 'disabled' })
      await open.click()
      const dialog = page.getByRole('dialog').last()
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText(item.label)
      await dialog.getByTitle('Close', { exact: true }).click()
      await expect(dialog).not.toBeVisible()
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-operational-row-identity]').first()).not.toBeVisible()
    expect(errors).toEqual([])
  })
}
