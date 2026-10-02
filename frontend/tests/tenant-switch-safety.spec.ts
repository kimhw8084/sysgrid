import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, testApiHeaders, testTenantId } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

test.beforeEach(async ({ context }) => {
  // The generic fixture pins tenant 1 at the browser transport layer. Tenant
  // tests must observe the application's actual scope headers instead.
  await context.setExtraHTTPHeaders({ 'X-User-Id': testApiHeaders['X-User-Id'] })
})

test('a fresh tab resolves a non-default tenant before workspace requests', async ({ page, sysApi }) => {
  const name = `Fresh workspace ${Date.now()}`
  const created = await sysApi.post(`${apiBase}/tenants/admin/create`, { data: { name } })
  expect(created.status()).toBe(200)
  const tenant = await created.json()
  expect(tenant.id).not.toBe(1)
  const tenantRequests: string[] = []
  page.on('request', request => {
    if (/\/api\/v1\/(devices|policy\/module-availability)(\?|$)/.test(request.url())) {
      tenantRequests.push(request.headers()['x-tenant-id'])
    }
  })
  await page.goto('/asset')
  await expect(page.getByRole('button', { name: 'Switch tenant', exact: true })).toContainText(name)
  expect(await page.evaluate(() => sessionStorage.getItem('SYSGRID_TAB_TENANT_ID'))).toBe(String(tenant.id))
  await expect.poll(() => tenantRequests.length).toBeGreaterThan(0)
  expect(tenantRequests.every(id => id === String(tenant.id))).toBe(true)
  const selection = await sysApi.get(`${apiBase}/tenants/me`)
  expect((await selection.json()).find((row: any) => row.is_selected)?.id).toBe(tenant.id)
})

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  test(`tenant selection preserves another tab's draft and write scope in ${theme}`, async ({ page, context, sysApi }, testInfo) => {
    const name = `Tenant isolation ${theme} ${Date.now()}`
    const created = await sysApi.post(`${apiBase}/tenants/admin/create`, { data: { name } })
    expect(created.status(), 'This test requires an explicit control-plane administrator in the disposable fixture').toBe(200)
    const tenant = await created.json()
    const original = await sysApi.post(`${apiBase}/tenants/select`, { data: { tenant_id: Number(testTenantId) } })
    expect(original.status()).toBe(200)
    const asset = await createAsset(sysApi, { name: `Original tenant host ${Date.now()}`, type: 'Physical', status: 'Active', system: 'Tenant safety' })
    await context.addInitScript(({ api, tenantId, selectedTheme }) => {
      localStorage.setItem('SYSGRID_OVERRIDE_API_URL', api)
      if (!localStorage.getItem('SYSGRID_TENANT_ID')) localStorage.setItem('SYSGRID_TENANT_ID', tenantId)
      localStorage.setItem('sysgrid-theme', selectedTheme)
    }, { api: apiBase.replace(/\/api\/v1$/, ''), tenantId: testTenantId, selectedTheme: theme })
    await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
    await page.goto('/asset')
    const other = await context.newPage()
    await other.goto(`/asset?id=${asset.id}`)
    const details = other.getByRole('dialog').filter({ has: other.getByRole('heading', { name: asset.name, exact: true }) })
    const draft = details.getByPlaceholder('Component Name')
    await draft.fill('Preserved CPU draft')
    const selector = page.getByRole('button', { name: 'Switch tenant', exact: true })
    await expect(selector).toContainText('Playwright Gate')
    await selector.click()
    await expect(page.getByRole('menuitem', { name: new RegExp(name) })).toBeVisible()
    await expectReadableGridText(page, testInfo, `tenant-menu-${theme}`, '[role="menu"][aria-label="Available tenants"]')
    await page.screenshot({ path: testInfo.outputPath('tenant-menu.png') })
    await page.getByRole('menuitem', { name: new RegExp(name) }).click()
    const confirmation = page.getByRole('dialog', { name: 'Switch tenant?', exact: true })
    await confirmation.getByRole('button', { name: 'Stay here', exact: true }).click()
    await expect(selector).toContainText('Playwright Gate')
    expect(await page.evaluate(() => sessionStorage.getItem('SYSGRID_TAB_TENANT_ID'))).toBe(testTenantId)
    await expect(draft).toHaveValue('Preserved CPU draft')

    // Failure must leave the existing tab scope usable and report the failure.
    await page.route('**/api/v1/tenants/select', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Tenant selection temporarily unavailable' }) }))
    await selector.click()
    await page.getByRole('menuitem', { name: new RegExp(name) }).click()
    await confirmation.getByRole('button', { name: 'Switch tenant', exact: true }).click()
    await expect(page.locator('[data-workspace-toast][data-visible="true"]').filter({ hasText: 'Tenant selection temporarily unavailable' })).toBeVisible()
    expect(await page.evaluate(() => sessionStorage.getItem('SYSGRID_TAB_TENANT_ID'))).toBe(testTenantId)
    await page.unroute('**/api/v1/tenants/select')

    await selector.click()
    await page.getByRole('menuitem', { name: new RegExp(name) }).click()
    const previousDocument = await page.evaluate(() => performance.timeOrigin)
    // The old document can display the new tenant just before its intentional
    // reload. Observe the new document before checking its storage and scope.
    await Promise.all([
      page.waitForEvent('domcontentloaded'),
      confirmation.getByRole('button', { name: 'Switch tenant', exact: true }).click(),
    ])
    await expect(selector).toContainText(name)
    expect(await page.evaluate(() => performance.timeOrigin)).toBeGreaterThan(previousDocument)
    expect(await page.evaluate(() => sessionStorage.getItem('SYSGRID_TAB_TENANT_ID'))).toBe(String(tenant.id))
    await expect(draft).toHaveValue('Preserved CPU draft')
    await expect(other.getByRole('button', { name: 'Switch tenant', exact: true })).toContainText('Playwright Gate')
    const saved = other.waitForResponse(response => response.url().endsWith(`/devices/${asset.id}/hardware`) && response.request().method() === 'POST')
    await details.getByRole('button', { name: 'Add', exact: true }).click()
    const response = await saved
    expect(response.status()).toBe(200)
    expect(response.request().headers()['x-tenant-id']).toBe(testTenantId)
    const hardware = await sysApi.get(`${apiBase}/devices/${asset.id}/hardware`)
    expect(hardware.status()).toBe(200)
    expect(await hardware.json()).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Preserved CPU draft' })]))
    const isolated = await sysApi.get(`${apiBase}/devices`, { headers: { 'X-Tenant-Id': String(tenant.id) } })
    expect(isolated.status()).toBe(200)
    expect(await isolated.json()).toEqual([])
    await other.close()
  })
}
