import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  test(`Network import excludes invalid endpoints and refreshes the grid in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    await resetBrowserState(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const name = `Network import ${theme} ${Date.now()}`
    const source = await createAsset(request, { name, system: 'Import proof' })
    const peer = await createAsset(request, { name: `Peer ${name}`, system: 'Import proof' })
    const csv = `source_device_id,source_port,target_device_id,target_port,link_type,status\n${source.id},000007,${peer.id},NA,Data,Active\n${source.id},invalid-source,900000000,invalid-peer,Data,Active`
    await page.goto('/network')
    await page.getByRole('button', { name: 'Import network rows', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Network Import', exact: true })
    await dialog.locator('input[type="file"]').setInputFiles({ name: 'network-proof.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await expect(dialog).toHaveCSS('opacity', '1')
    await expectReadableGridText(page, testInfo, 'network-import-source', '[role="dialog"][aria-label="Network Import"] fieldset')
    await dialog.getByRole('button').filter({ hasText: 'network-proof.csv' }).scrollIntoViewIfNeeded()
    await expectReadableGridText(page, testInfo, 'network-import-upload', '[role="dialog"][aria-label="Network Import"] fieldset')
    await page.screenshot({ path: testInfo.outputPath(`network-import-source-${theme}.png`), animations: 'disabled' })
    const preview = page.waitForResponse(response => response.url().includes('/api/v1/import/preview-file'))
    await dialog.getByRole('button', { name: 'Initiate Audit', exact: true }).click()
    const previewResponse = await preview
    expect(previewResponse.ok()).toBeTruthy()
    expect(await previewResponse.json()).toMatchObject({ total_rows: 2, valid_rows: 1, invalid_rows: 1 })
    await expect(page.locator('[data-workspace-toast="error"][data-visible="true"]')).toContainText('1 row ready to import; 1 row needs correction.')
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
    await expect(page.locator('.ag-center-cols-container .ag-row')).toContainText('000007')
    const readback = await request.get(`${apiBase}/networks/connections?device_id=${source.id}`)
    expect(readback.ok()).toBeTruthy()
    const imported = await readback.json()
    expect(imported).toEqual([expect.objectContaining({ source_device_id: source.id,
      target_device_id: peer.id, source_port: '000007', target_port: 'NA' })])
    const connectionId = imported[0].id
    const statusPayload = { ids: [connectionId, connectionId], status: 'Maintenance' }
    const changed = await request.post(`${apiBase}/networks/connections/bulk-status`, { data: statusPayload })
    expect(changed.ok()).toBeTruthy()
    expect(await changed.json()).toMatchObject({ count: 1, changed: 1 })
    const unchanged = await request.post(`${apiBase}/networks/connections/bulk-status`, { data: statusPayload })
    expect(unchanged.ok()).toBeTruthy()
    expect(await unchanged.json()).toMatchObject({ count: 0, changed: 0 })
    await page.goto(`/logs?target_table=port_connections&target_id=${connectionId}`)
    await expect(page.getByText(`Scoped: port_connections // ${connectionId}`)).toBeVisible()
    const historyRows = page.locator('.ag-center-cols-container .ag-row')
    await expect(historyRows).toHaveCount(2)
    await expect(historyRows.nth(0)).toContainText('Bulk updated 1 links to Maintenance')
    await expect(historyRows.nth(1)).toContainText('Imported network link')
    await page.getByRole('button', { name: 'View change payload', exact: true }).first().click()
    const payloadDialog = page.getByRole('dialog', { name: 'Audit Change Payload', exact: true })
    await expect(payloadDialog.locator(':scope > div').first()).toHaveCSS('opacity', '1')
    await expect(payloadDialog.locator('pre')).toContainText('"batch_count": 1')
    await expect(payloadDialog.locator('pre')).toContainText('"status"')
    await expectReadableGridText(page, testInfo, 'network-batch-audit', '[role="dialog"][aria-label="Audit Change Payload"] :is(h3, p, pre)')
    await page.screenshot({ path: testInfo.outputPath(`network-batch-audit-${theme}.png`), animations: 'disabled' })
    await payloadDialog.getByRole('button', { name: 'Close audit payload', exact: true }).click()
    await page.getByRole('button', { name: 'Open target record', exact: true }).first().click()
    await expect(page).toHaveURL(new RegExp(`/network\\?id=${connectionId}(?:&|$)`))
    const forensics = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /^Connection Forensics/ }) })
    await expect(forensics).toBeVisible()
    await expect(forensics.getByRole('heading', { level: 2 })).toContainText(`${name}:000007 ↔ Peer ${name}:NA`)
  })
}
