import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, resetBrowserState } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) test.describe(theme, () => {
  test.beforeEach(async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
  })

  for (const mode of ['file', 'paste']) test(`${mode} import selects only valid assets and preserves identifiers in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    const suffix = `${theme}-${mode}-${Date.now()}`
    const name = `Imported ${suffix}`
    const existing = await createAsset(request, { name: `Duplicate ${suffix}`, system: 'Import browser proof' })
    const invalidName = mode === 'file' ? `Invalid ${suffix}` : existing.name.toUpperCase()
    const csv = `name,system,serial_number,asset_tag,size_u,power_max_w,recipe_critical,purchase_date\n${name},Import browser proof,0000123,NA,2.0,425.25,yes,2024-02-29\n${invalidName},Import browser proof,0000456,NA,2,${mode === 'file' ? '-1' : '10'},no,2024-02-29`
    await page.goto('/asset')
    await page.getByRole('button', { name: 'Import asset rows', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Assets Import', exact: true })
    await expect(dialog.getByText('Tenant Id', { exact: true })).toHaveCount(0)
    if (mode === 'file') {
      await dialog.locator('input[type="file"]').setInputFiles({ name: 'asset-proof.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    } else {
      await dialog.getByRole('button', { name: 'Paste CSV / Grid', exact: true }).click()
      await dialog.getByPlaceholder('Paste CSV with headers, or paste spreadsheet cells directly...').fill(csv)
      await dialog.getByRole('button', { name: 'Load Into Builder', exact: true }).click()
      await expect(dialog.getByText('Manual Data Builder', { exact: true })).toBeVisible()
    }
    const previewResponse = page.waitForResponse(response => response.url().includes(`/api/v1/import/preview-${mode === 'file' ? 'file' : 'rows'}`))
    await dialog.getByRole('button', { name: 'Initiate Audit', exact: true }).click()
    const response = await previewResponse
    expect(response.ok()).toBeTruthy()
    expect(await response.json()).toMatchObject({ total_rows: 2, valid_rows: 1, invalid_rows: 1 })
    const previewTable = dialog.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Diagnostics', exact: true }) })
    const rows = previewTable.locator('tbody tr')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0).getByRole('checkbox')).toBeChecked()
    await expect(rows.nth(1).getByRole('checkbox')).toBeDisabled()
    await expect(rows.nth(1).getByRole('checkbox')).not.toBeChecked()
    await expect(rows.nth(0)).toContainText('0000123')
    await expect(rows.nth(1)).toContainText(mode === 'file' ? 'power_max_w' : 'already uses this hostname')
    await expect(dialog.getByRole('button', { name: 'Import 1', exact: true })).toBeEnabled()
    await previewTable.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('asset-import-preview.png'), animations: 'disabled' })
    const saved = page.waitForResponse(response => response.url().includes('/api/v1/import/execute'))
    await dialog.getByRole('button', { name: 'Import 1', exact: true }).click()
    const imported = await saved
    expect(imported.ok()).toBeTruthy()
    expect(await imported.json()).toEqual({ status: 'success', count: 1 })
    expect(imported.request().postDataJSON().rows).toHaveLength(1)
    await expect(dialog).toHaveCount(0)
    const stored = await (await request.get(`${apiBase}/devices`)).json()
    expect(stored.filter((row: any) => row.name === name)).toHaveLength(1)
    expect(stored.find((row: any) => row.name === name)).toMatchObject({
      serial_number: '0000123', asset_tag: 'NA', size_u: 2, power_max_w: 425.25,
      recipe_critical: true, purchase_date: '2024-02-29T00:00:00',
    })
    expect(stored.some((row: any) => row.name === invalidName)).toBe(false)
    expect(stored.filter((row: any) => row.id === existing.id)).toHaveLength(1)
  })
})
