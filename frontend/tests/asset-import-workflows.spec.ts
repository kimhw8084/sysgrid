import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) test.describe(theme, () => {
  test.beforeEach(async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
  })

  test(`multiline CSV remains editable and malformed paste preserves the draft in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    const name = `Multiline import ${theme} ${Date.now()}`
    await page.goto('/asset')
    await page.getByRole('button', { name: 'Import asset rows', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Assets Import', exact: true })
    await dialog.getByRole('button', { name: 'Paste CSV / Grid', exact: true }).click()
    const paste = dialog.getByPlaceholder('Paste CSV with headers, or paste spreadsheet cells directly...')
    await paste.fill(`name,system,owner,metadata_json\r\n${name},CSV proof,"First line\r\nSecond line","{""note"":""quoted, value""}"`)
    await dialog.getByRole('button', { name: 'Load Into Builder', exact: true }).click()
    const owner = dialog.getByRole('textbox', { name: 'Owner, row 1', exact: true })
    await expect(owner).toHaveValue('First line\nSecond line')
    await expect(dialog.getByRole('textbox', { name: 'Name, row 2', exact: true })).toHaveCount(0)
    await owner.fill('Edited first line\nSecond line')
    await dialog.getByRole('button', { name: 'Paste CSV / Grid', exact: true }).click()
    await paste.fill('"Unclosed name,CSV proof')
    await dialog.getByRole('button', { name: 'Load Into Builder', exact: true }).click()
    await expect(paste).toHaveValue('"Unclosed name,CSV proof')
    await expect(page.getByText('Unclosed quote in pasted data. Close the quoted field before loading it.', { exact: true })).toBeVisible()
    await expect(page.locator('[data-workspace-toast="error"][data-visible="true"]').filter({ hasText: 'Unclosed quote' })).toContainText('Action needed')
    await dialog.getByRole('button', { name: 'Build Rows', exact: true }).click()
    await expect(owner).toHaveValue('Edited first line\nSecond line')
    await owner.scrollIntoViewIfNeeded()
    await expectReadableGridText(page, testInfo, 'import-multiline-value', '[role="dialog"] textarea[aria-label="Owner, row 1"]')
    await page.screenshot({ path: testInfo.outputPath('import-multiline-builder.png'), animations: 'disabled' })
    const preview = page.waitForResponse(response => response.url().includes('/api/v1/import/preview-rows'))
    await dialog.getByRole('button', { name: 'Initiate Audit', exact: true }).click()
    expect(await (await preview).json()).toMatchObject({ total_rows: 1, valid_rows: 1, invalid_rows: 0 })
    const saved = page.waitForResponse(response => response.url().includes('/api/v1/import/execute'))
    await dialog.getByRole('button', { name: 'Import 1', exact: true }).click()
    expect(await (await saved).json()).toEqual({ status: 'success', count: 1 })
    await expect(dialog).toHaveCount(0)
    const stored = await (await request.get(`${apiBase}/devices`)).json()
    expect(stored.filter((row: any) => row.name === name)).toHaveLength(1)
    expect(stored.find((row: any) => row.name === name)).toMatchObject({ owner: 'Edited first line\nSecond line', metadata_json: { note: 'quoted, value' } })
  })

  for (const operation of ['preview', 'execute']) test(`pending ${operation} preserves the import draft and supports retry in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const name = `Pending import ${operation} ${theme} ${Date.now()}`
    await page.goto('/asset')
    await page.getByRole('button', { name: 'Import asset rows', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Assets Import', exact: true })
    await dialog.getByRole('button', { name: 'Paste CSV / Grid', exact: true }).click()
    await dialog.getByPlaceholder('Paste CSV with headers, or paste spreadsheet cells directly...').fill(`name,system\n${name},Import pending proof`)
    await dialog.getByRole('button', { name: 'Load Into Builder', exact: true }).click()
    const nameInput = dialog.getByRole('textbox', { name: 'Name, row 1', exact: true })
    const audit = async () => {
      const response = page.waitForResponse(response => response.url().includes('/api/v1/import/preview-rows'))
      await dialog.getByRole('button', { name: 'Initiate Audit', exact: true }).click()
      expect((await response).ok()).toBeTruthy()
      await expect(dialog.getByRole('button', { name: 'Import 1', exact: true })).toBeEnabled()
    }
    if (operation === 'execute') await audit()
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    let writes = 0
    const path = operation === 'preview' ? '**/api/v1/import/preview-rows?*' : '**/api/v1/import/execute?*'
    await page.route(path, async route => {
      writes++
      await held
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Controlled import failure' }) })
    })
    try {
      await dialog.getByRole('button', { name: operation === 'preview' ? 'Initiate Audit' : 'Import 1', exact: true }).click()
      await expect.poll(() => writes).toBe(1)
      await expect(nameInput).toBeDisabled()
      await expect(nameInput).toHaveAccessibleName('Name, row 1')
      await expect(dialog.getByRole('button', { name: 'Paste CSV / Grid', exact: true })).toBeDisabled()
      await expect(dialog.getByRole('button', { name: 'Clear All', exact: true })).toBeDisabled()
      for (const checkbox of await dialog.getByRole('checkbox').all()) await expect(checkbox).toBeDisabled()
      await dialog.getByTitle('Close', { exact: true }).click()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('alertdialog')).toHaveCount(0)
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('status')).toHaveText(operation === 'preview' ? 'Validating import rows...' : 'Importing selected rows...')
      const busyButton = dialog.getByRole('button', { name: operation === 'preview' ? 'Auditing...' : 'Importing...', exact: true })
      await expect(busyButton.locator('svg').first()).toHaveCSS('animation-name', 'none')
      await page.setViewportSize({ width: 390, height: 844 })
      await expect.poll(() => dialog.locator('[data-workspace-modal-header]').evaluate(header => header.scrollWidth <= header.clientWidth)).toBe(true)
      const header = dialog.locator('[data-workspace-modal-header]')
      const firstHeaderAction = await header.getByRole('button').first().boundingBox()
      for (const metadata of await header.locator('p').all()) {
        const box = await metadata.boundingBox()
        expect(box!.x + box!.width).toBeLessThanOrEqual(firstHeaderAction!.x)
      }
      const bounds = await dialog.boundingBox()
      for (const control of [dialog.getByRole('status'), dialog.getByTitle('Close', { exact: true })]) {
        const box = await control.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(bounds!.x)
        expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width)
      }
      const notices = page.locator('[data-workspace-toast][data-visible="true"]')
      if (await notices.count()) {
        await page.locator('[data-workspace-toaster]').hover()
        while (await notices.count()) await notices.first().getByRole('button', { name: 'Dismiss notification', exact: true }).click()
      }
      await expectReadableGridText(page, testInfo, 'import-request-status', '[role="dialog"] [role="status"]')
      await page.screenshot({ path: testInfo.outputPath('import-pending-mobile.png'), animations: 'disabled' })
      expect(writes).toBe(1)
    } finally { release() }
    await expect(nameInput).toBeEnabled()
    await expect(nameInput).toHaveValue(name)
    await page.unroute(path)
    if (operation === 'preview') await audit()
    const saved = page.waitForResponse(response => response.url().includes('/api/v1/import/execute'))
    await dialog.getByRole('button', { name: 'Import 1', exact: true }).click()
    expect(await (await saved).json()).toEqual({ status: 'success', count: 1 })
    await expect(dialog).toHaveCount(0)
    const stored = await (await request.get(`${apiBase}/devices`)).json()
    expect(stored.filter((row: any) => row.name === name)).toHaveLength(1)
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
