import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, resetBrowserState } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  test(`Network import excludes invalid endpoints and refreshes the grid in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    await resetBrowserState(page)
    expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const name = `Network import ${theme} ${Date.now()}`
    const source = await createAsset(request, { name, system: 'Import proof' })
    const peer = await createAsset(request, { name: `Peer ${name}`, system: 'Import proof' })
    const csv = `source_device_id,source_port,target_device_id,target_port,link_type,status\n${source.id},valid-source,${peer.id},valid-peer,Data,Active\n${source.id},invalid-source,900000000,invalid-peer,Data,Active`
    await page.goto('/network')
    await page.getByRole('button', { name: 'Import network rows', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Network Import', exact: true })
    await dialog.locator('input[type="file"]').setInputFiles({ name: 'network-proof.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    const preview = page.waitForResponse(response => response.url().includes('/api/v1/import/preview-file'))
    await dialog.getByRole('button', { name: 'Initiate Audit', exact: true }).click()
    const previewResponse = await preview
    expect(previewResponse.ok()).toBeTruthy()
    expect(await previewResponse.json()).toMatchObject({ total_rows: 2, valid_rows: 1, invalid_rows: 1 })
    const table = dialog.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Diagnostics', exact: true }) })
    const rows = table.locator('tbody tr')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0).getByRole('checkbox')).toBeChecked()
    await expect(rows.nth(1).getByRole('checkbox')).toBeDisabled()
    await expect(rows.nth(1).getByRole('checkbox')).not.toBeChecked()
    await expect(rows.nth(1)).toContainText('Peer Device not found')
    await table.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`network-import-preview-${theme}.png`), animations: 'disabled' })
    const save = page.waitForResponse(response => response.url().includes('/api/v1/import/execute'))
    await dialog.getByRole('button', { name: 'Import 1', exact: true }).click()
    const saved = await save
    expect(saved.ok()).toBeTruthy()
    expect(await saved.json()).toEqual({ status: 'success', count: 1 })
    expect(saved.request().postDataJSON().rows).toHaveLength(1)
    await expect(dialog).toHaveCount(0)
    await page.getByPlaceholder('Scan matrix...').fill(name)
    await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(1)
    await expect(page.locator('.ag-center-cols-container .ag-row')).toContainText('valid-source')
    const readback = await request.get(`${apiBase}/networks/connections?device_id=${source.id}`)
    expect(readback.ok()).toBeTruthy()
    expect(await readback.json()).toEqual([expect.objectContaining({ source_device_id: source.id,
      target_device_id: peer.id, source_port: 'valid-source', target_port: 'valid-peer' })])
  })
}
