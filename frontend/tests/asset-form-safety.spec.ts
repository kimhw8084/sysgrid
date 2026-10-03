import { expect, type Locator } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, fillGridSearch, getWorkspaceLogicalRowByText, resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const nativeLabels = ['Hostname', 'Role / Description', 'Logical System', 'Owner', 'Business Unit', 'Size (U)',
  'Primary IP', 'Management IP', 'Management URL', 'OS Name', 'OS Version', 'Manufacturer', 'Model',
  'Serial Number', 'Asset Tag', 'Typical Power (W)', 'Max Power (W)', 'Purchase Date', 'Install Date',
  'Warranty End', 'EOL Date', 'Metadata JSON']
const field = (dialog: Locator, label: string) => dialog.locator('label').filter({ hasText: label }).locator('..').locator('input, textarea').first()

for (const theme of ['nordic-frost-v1', 'pure-clarity']) test.describe(theme, () => {
  test.beforeEach(async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
  })

  test(`asset form associates every native field with its visible label in ${theme}`, async ({ page }) => {
    await page.goto('/asset')
    await page.getByRole('button', { name: 'Register Asset', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Create Asset', exact: true })
    await expect(dialog.locator('input, textarea')).toHaveCount(nativeLabels.length)
    for (const label of nativeLabels) {
      const input = field(dialog, label)
      await expect(input).toHaveAccessibleName(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      await dialog.locator('label').filter({ hasText: label }).click()
      await expect(input).toBeFocused()
    }
  })

  test(`asset numeric errors preserve the draft before a valid save in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    await page.setViewportSize({ width: theme === 'pure-clarity' ? 390 : 1440, height: 900 })
    await page.goto('/asset')
    await page.getByRole('button', { name: 'Register Asset', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Create Asset', exact: true })
    const name = `Scalar form ${theme} ${Date.now()}`
    for (const [label, value] of [['Hostname', name], ['Logical System', 'Form proof'], ['Serial Number', 'FORM-SN'], ['Asset Tag', 'FORM-TAG']]) await field(dialog, label).fill(value)
    await field(dialog, 'Size (U)').fill('1.5')
    await field(dialog, 'Typical Power (W)').fill('-1')
    await field(dialog, 'Max Power (W)').fill('-2')
    let writes = 0
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/devices' && request.method() === 'POST') writes++ })
    await dialog.getByRole('button', { name: 'Save Asset', exact: true }).click()
    await expect(dialog.getByText('Size must be a whole number of at least 1.', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Typical power must be a finite number of zero or more.', { exact: true })).toBeAttached()
    await expect(dialog.getByText('Max power must be a finite number of zero or more.', { exact: true })).toBeAttached()
    expect(writes).toBe(0)
    await expect(field(dialog, 'Size (U)')).toHaveValue('1.5')
    await expect(field(dialog, 'Hostname')).toHaveValue(name)
    await expect(field(dialog, 'Size (U)')).toHaveAttribute('aria-invalid', 'true')
    await expect(field(dialog, 'Size (U)')).toHaveAccessibleDescription('Size must be a whole number of at least 1.')
    for (const notice of await page.locator('[data-workspace-toast][data-visible="true"]').all()) await notice.getByRole('button', { name: 'Dismiss notification', exact: true }).click()
    await field(dialog, 'Size (U)').scrollIntoViewIfNeeded()
    await expectReadableGridText(page, testInfo, 'asset-form-size-errors', '[role="dialog"]')
    await page.screenshot({ path: testInfo.outputPath('asset-field-errors.png'), animations: 'disabled' })
    await field(dialog, 'Max Power (W)').scrollIntoViewIfNeeded()
    await expectReadableGridText(page, testInfo, 'asset-form-power-errors', '[role="dialog"]')
    await page.screenshot({ path: testInfo.outputPath('asset-power-errors.png'), animations: 'disabled' })
    await field(dialog, 'Size (U)').fill('2')
    await expect(field(dialog, 'Size (U)')).toHaveAttribute('aria-invalid', 'false')
    await field(dialog, 'Typical Power (W)').fill('250.25')
    await field(dialog, 'Max Power (W)').fill('450.5')
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/devices' && response.request().method() === 'POST')
    await dialog.getByRole('button', { name: 'Save Asset', exact: true }).click()
    const result = await saved
    expect(result.ok()).toBeTruthy()
    const asset = await result.json()
    await expect(dialog).toHaveCount(0)
    expect(writes).toBe(1)
    const rows = await (await request.get(`${apiBase}/devices`)).json()
    expect(rows.find((row: any) => row.id === asset.id)).toMatchObject({ name, size_u: 2, power_typical_w: 250.25, power_max_w: 450.5 })
  })

  test(`pending asset edits block departure and retain failed drafts for retry in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    const asset = await createAsset(request, { name: `Pending form ${theme} ${Date.now()}`, system: 'Form proof', serial_number: 'PENDING-SN', asset_tag: 'PENDING-TAG' })
    await page.goto('/asset')
    await fillGridSearch(page, 'Scan asset matrix...', asset.name)
    const row = await getWorkspaceLogicalRowByText(page, 'assets', asset.name)
    await row.action('More actions').click()
    await page.getByRole('button', { name: 'Edit Configuration', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit Asset', exact: true })
    await field(dialog, 'Owner').fill('Retained draft owner')
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    let writes = 0
    const path = `**/api/v1/devices/${asset.id}`
    await page.route(path, async route => {
      if (route.request().method() !== 'PUT') return route.continue()
      writes++
      await held
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Controlled asset save failure' }) })
    })
    try {
      await dialog.getByRole('button', { name: 'Save Asset', exact: true }).click()
      await expect.poll(() => writes).toBe(1)
      await expect(dialog.getByRole('button', { name: 'Saving...', exact: true })).toBeDisabled()
      for (const control of await dialog.locator('input, textarea').all()) await expect(control).toBeDisabled()
      await expect(dialog.locator('label').filter({ hasText: 'Asset Type' }).locator('..').getByRole('button')).toBeDisabled()
      await dialog.getByTitle('Close', { exact: true }).click()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeVisible()
      await expect(page.getByRole('alertdialog')).toHaveCount(0)
      await expect(dialog.getByRole('status')).toHaveText('Saving asset changes...')
      await page.screenshot({ path: testInfo.outputPath('asset-save-pending.png'), animations: 'disabled' })
      await page.setViewportSize({ width: 390, height: 844 })
      await expect.poll(() => dialog.locator('[data-workspace-modal-header]').evaluate(header => header.scrollWidth <= header.clientWidth)).toBe(true)
      const bounds = await dialog.boundingBox()
      for (const control of [dialog.getByRole('status'), dialog.getByTitle('Close', { exact: true }), dialog.getByRole('button', { name: 'Saving...', exact: true })]) {
        const box = await control.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(bounds!.x)
        expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width)
      }
      for (const notice of await page.locator('[data-workspace-toast][data-visible="true"]').all()) await notice.getByRole('button', { name: 'Dismiss notification', exact: true }).click()
      await page.screenshot({ path: testInfo.outputPath('asset-save-pending-mobile.png'), animations: 'disabled' })
      expect(writes).toBe(1)
    } finally { release() }
    await expect(dialog.getByRole('button', { name: 'Save Asset', exact: true })).toBeEnabled()
    await expect(field(dialog, 'Owner')).toBeEnabled()
    await expect(field(dialog, 'Owner')).toHaveValue('Retained draft owner')
    await page.unroute(path)
    const saved = page.waitForResponse(response => response.url().endsWith(`/devices/${asset.id}`) && response.request().method() === 'PUT')
    await dialog.getByRole('button', { name: 'Save Asset', exact: true }).click()
    expect((await saved).ok()).toBeTruthy()
    await expect(dialog).toHaveCount(0)
    const rows = await (await request.get(`${apiBase}/devices`)).json()
    expect(rows.find((row: any) => row.id === asset.id).owner).toBe('Retained draft owner')
  })
})
