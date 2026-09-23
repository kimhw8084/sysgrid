import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { clickResilientButton, resetBrowserState } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

async function selectRowsByNames(page: any, names: string[]) {
  for (const name of names) {
    const row = page
      .locator('.ag-pinned-left-cols-container .ag-row, .ag-center-cols-container .ag-row')
      .filter({ has: page.getByText(name, { exact: true }) })
      .first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    const selectionCell = row.getByRole('gridcell', { name: /Press Space to toggle row selection/ })
    await expect(selectionCell).toBeVisible()
    await expect(row).toHaveAttribute('aria-selected', 'false')
    await selectionCell.press('Space')
    await expect(row).toHaveAttribute('aria-selected', 'true')
    await expect(row).toHaveClass(/ag-row-selected/)
  }
}

async function choosePortaledDropdownOption(page: any, label: string) {
  const menu = page
    .locator('[data-workspace-panel="true"]')
    .filter({ has: page.getByPlaceholder('Search options...') })
    .last()
  await expect(menu).toBeVisible()
  await menu.getByRole('button', { name: label, exact: true }).click()
}

test.describe('Assets and Vendors authoritative bulk completion', () => {
  test('previews, confirms, receipts, and undoes exact shared changes', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const assets = []
    for (const suffix of ['A', 'B']) {
      const response = await request.post(`${apiBase}/devices`, {
        data: {
          name: `PW-ASSET-W2-${suffix}-${stamp}`,
          system: 'PW-WAVE-2',
          status: 'Active',
          type: 'Physical',
          environment: 'Production',
          serial_number: `PW-SN-${suffix}-${stamp}`,
          asset_tag: `PW-AT-${suffix}-${stamp}`,
        },
      })
      expect(response.ok()).toBeTruthy()
      assets.push(await response.json())
    }

    await page.goto('/asset')
    const assetSearch = page.getByPlaceholder('Scan asset matrix...')
    await assetSearch.fill(stamp)
    await selectRowsByNames(page, assets.map((asset: any) => asset.name))
    await clickResilientButton(page, /Bulk Actions/i)
    await clickResilientButton(page, 'Set Environment')
    await clickResilientButton(page, 'Choose environment')
    await choosePortaledDropdownOption(page, 'Development')
    await clickResilientButton(page, 'Preview Environment Change')

    const assetPreview = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Assets bulk preview' }) })
    await expect(assetPreview).toBeVisible()
    await expect(assetPreview.getByTestId('bulk-preview-selected')).toHaveText('2')
    await expect(assetPreview.getByTestId('bulk-preview-will-change')).toHaveText('2')
    await expect(assetPreview.getByTestId('bulk-preview-no-change')).toHaveText('0')

    const assetsBefore = await (await request.get(`${apiBase}/devices?include_deleted=true`)).json()
    for (const asset of assets) {
      expect(assetsBefore.find((row: any) => row.id === asset.id)?.environment).toBe('Production')
    }

    await assetPreview.getByRole('button', { name: 'Confirm Apply Environment' }).click()
    const assetReceipt = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Assets bulk complete' }) })
    await expect(assetReceipt).toBeVisible({ timeout: 15_000 })
    await expect(assetReceipt.getByTestId('bulk-preview-changed')).toHaveText('2')
    const assetsChanged = await (await request.get(`${apiBase}/devices?include_deleted=true`)).json()
    for (const asset of assets) {
      expect(assetsChanged.find((row: any) => row.id === asset.id)?.environment).toBe('Development')
    }

    await assetReceipt.getByRole('button', { name: 'Undo bulk changes' }).click()
    await expect(assetReceipt).not.toBeVisible({ timeout: 15_000 })
    const assetsRestored = await (await request.get(`${apiBase}/devices?include_deleted=true`)).json()
    for (const asset of assets) {
      expect(assetsRestored.find((row: any) => row.id === asset.id)?.environment).toBe('Production')
    }

    // Vendors remains deferred/preview-only for normal-v1. Keep the asset
    // qualification above release-blocking and retain vendor coverage for the
    // explicit root-preview and historical suites.
    if (process.env.SYSGRID_VERIFY_PROFILE === 'normal-v1') return

    const vendors = []
    for (const suffix of ['A', 'B']) {
      const response = await request.post(`${apiBase}/vendors`, {
        data: { name: `PW-VENDOR-W2-${suffix}-${stamp}`, country: 'USA' },
      })
      expect(response.ok()).toBeTruthy()
      vendors.push(await response.json())
    }

    await page.goto('/vendors')
    const vendorSearch = page.getByPlaceholder('Search vendors...')
    await vendorSearch.fill(stamp)
    await selectRowsByNames(page, vendors.map((vendor: any) => vendor.name))
    await clickResilientButton(page, /Bulk Actions/i)
    await clickResilientButton(page, 'Set Country')
    await clickResilientButton(page, 'Choose country')
    await choosePortaledDropdownOption(page, 'South Korea')
    await clickResilientButton(page, 'Preview Country Change')

    const vendorPreview = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Vendors bulk preview' }) })
    await expect(vendorPreview).toBeVisible()
    await expect(vendorPreview.getByTestId('bulk-preview-selected')).toHaveText('2')
    await expect(vendorPreview.getByTestId('bulk-preview-will-change')).toHaveText('2')

    const vendorsBefore = await (await request.get(`${apiBase}/vendors?include_deleted=true`)).json()
    for (const vendor of vendors) {
      expect(vendorsBefore.find((row: any) => row.id === vendor.id)?.country).toBe('USA')
    }

    await vendorPreview.getByRole('button', { name: 'Confirm Apply Country' }).click()
    const vendorReceipt = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Vendors bulk complete' }) })
    await expect(vendorReceipt).toBeVisible({ timeout: 15_000 })
    await expect(vendorReceipt.getByTestId('bulk-preview-changed')).toHaveText('2')
    const vendorsChanged = await (await request.get(`${apiBase}/vendors?include_deleted=true`)).json()
    for (const vendor of vendors) {
      expect(vendorsChanged.find((row: any) => row.id === vendor.id)?.country).toBe('South Korea')
    }

    await vendorReceipt.getByRole('button', { name: 'Undo bulk changes' }).click()
    await expect(vendorReceipt).not.toBeVisible({ timeout: 15_000 })
    const vendorsRestored = await (await request.get(`${apiBase}/vendors?include_deleted=true`)).json()
    for (const vendor of vendors) {
      expect(vendorsRestored.find((row: any) => row.id === vendor.id)?.country).toBe('USA')
    }
  })
})
