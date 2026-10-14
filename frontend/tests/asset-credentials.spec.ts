import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, resetBrowserState } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  test(`asset credentials require explicit reveal and preserve unedited values in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    await resetBrowserState(page)
    await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const asset = await createAsset(request, { name: `Credential boundary ${theme} ${Date.now()}`, type: 'Physical', status: 'Active', system: 'UI readiness' })
    const value = 'synthetic-browser-credential-value'
    const created = await request.post(`${apiBase}/devices/${asset.id}/secrets`, { data: { secret_type: 'Service Account', username: 'vault-user', notes: 'preserved note', encrypted_payload: value } })
    expect(created.ok()).toBeTruthy()
    expect(await created.text()).not.toContain(value)
    const secret = await created.json()
    const metadata = await request.get(`${apiBase}/devices/${asset.id}/secrets`)
    expect(await metadata.text()).not.toContain(value)
    let reveals = 0
    page.on('request', event => { if (event.url().endsWith(`/secrets/${secret.id}/reveal`)) reveals++ })
    await page.goto(`/asset?id=${asset.id}`)
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: asset.name, exact: true }) })
    await dialog.getByRole('button', { name: 'secrets', exact: true }).click()
    await expect(dialog.getByText('vault-user', { exact: true })).toBeVisible()
    expect(reveals).toBe(0)
    await expect(dialog.getByText(value, { exact: true })).toHaveCount(0)
    const revealResponse = page.waitForResponse(response => response.url().endsWith(`/secrets/${secret.id}/reveal`))
    await dialog.getByRole('button', { name: 'Reveal credential', exact: true }).click()
    expect((await revealResponse).headers()['cache-control']).toBe('no-store')
    await expect(dialog.getByText(value, { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Hide credential', exact: true }).click()
    await expect(dialog.getByText(value, { exact: true })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Edit credential', exact: true }).click()
    await expect(dialog.getByLabel('Replacement credential value', { exact: true })).toHaveValue('')
    const updated = page.waitForRequest(event => event.method() === 'PUT' && event.url().endsWith(`/devices/secrets/${secret.id}`))
    await dialog.getByRole('button', { name: 'Save credential', exact: true }).click()
    expect((await updated).postDataJSON()).not.toHaveProperty('encrypted_payload')
    await expect(dialog.getByRole('button', { name: 'Edit credential', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Reveal credential', exact: true }).click()
    await expect(dialog.getByText(value, { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Hide credential', exact: true }).click()
    await page.screenshot({ path: testInfo.outputPath('credential-metadata.png'), animations: 'disabled' })
    expect(reveals).toBe(2)
  })
}
