import { clickResilientButton, getWorkspaceLogicalRowByText } from './helpers/sysgrid';
import { expect } from '@playwright/test';
import { test } from './helpers/sysgrid-test';
import { resetBrowserState } from './helpers/sysgrid'

test.describe('Vendor workflows', () => {
  test('creates a vendor, updates the profile, and registers a contract', async ({ page }) => {
    await resetBrowserState(page)
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const vendorName = `PW-VENDOR-${stamp}`
    const contractTitle = `PW-CONTRACT-${stamp}`

    await page.goto('/vendors')
    await expect(page.getByRole('heading', { name: 'Vendors' })).toBeVisible()
    await expect(page.getByPlaceholder('Search vendors...')).toBeVisible()
    const hideFilters = page.getByRole('button', { name: 'Hide filters', exact: true })
    await expect(hideFilters).toBeVisible()
    await expect(page.getByText('Country Filter', { exact: true })).toBeVisible()
    await clickResilientButton(page, /^Hide filters$/)
    const showFilters = page.getByRole('button', { name: 'Show filters', exact: true })
    await expect(page.getByText('Country Filter', { exact: true })).toBeHidden()
    await clickResilientButton(page, /^Show filters$/)
    await expect(page.getByText('Country Filter', { exact: true })).toBeVisible()

    await clickResilientButton(page, /\+ Add Vendor/i)
    const vendorModal = page.locator('.glass-panel').filter({ has: page.getByText('New Vendor') })
    await expect(vendorModal).toBeVisible()
    await vendorModal.getByRole('textbox', { name: 'Vendor Name' }).fill(vendorName)
    await vendorModal.getByRole('combobox', { name: 'Vendor Country' }).selectOption('USA')
    await vendorModal.getByRole('button', { name: /Save Vendor/i }).click()

    await expect(page.getByText('Vendor record saved')).toBeVisible()
    await page.getByPlaceholder('Search vendors...').fill(vendorName)
    await expect(page.locator('.ag-pinned-left-cols-container')).toContainText(vendorName)
    const vendorNameCell = page.locator('.ag-pinned-left-cols-container .ag-cell[col-id="name"]', { hasText: vendorName })
    await vendorNameCell.click()
    await expect(page.getByRole('button', { name: /bulk actions/i })).toBeEnabled()
    await (await getWorkspaceLogicalRowByText(page, 'vendors', vendorName)).action('Open details').click()
    const detailsPanel = page.getByRole('dialog').filter({ hasText: vendorName })
    await expect(detailsPanel).toBeVisible()

    await detailsPanel.getByRole('button', { name: /Edit Vendor/i }).click()
    await detailsPanel.getByRole('combobox', { name: 'Vendor Country' }).selectOption('South Korea')
    await detailsPanel.getByRole('button', { name: /Save Changes/i }).click()
    await expect(detailsPanel.getByRole('button', { name: /Edit Vendor/i })).toBeVisible()
    await expect(detailsPanel.locator('p').filter({ hasText: /^South Korea$/ })).toBeVisible()

    await detailsPanel.getByRole('button', { name: 'Contracts', exact: true }).click()
    await detailsPanel.getByRole('button', { name: /Register New Contract/i }).click()
    const contractModal = page.locator('.glass-panel').filter({ has: page.getByRole('heading', { name: 'New Contract' }) })
    await expect(contractModal).toBeVisible()
    await contractModal.getByRole('button', { name: 'Close contract form' }).click()
    await expect(contractModal).not.toBeVisible()
    await detailsPanel.getByRole('button', { name: /Register New Contract/i }).click()
    await expect(contractModal).toBeVisible()
    await contractModal.getByRole('textbox', { name: 'Contract Title' }).fill(contractTitle)
    await contractModal.getByRole('textbox', { name: 'Contract ID' }).fill(`PW-CID-${stamp}`)
    await contractModal.getByRole('combobox', { name: 'Contract Status' }).selectOption('Completed')
    await contractModal.getByLabel('Effective Date').fill('2030-01-01')
    await contractModal.getByLabel('Expiry Date').fill('2030-12-31')
    await contractModal.getByRole('button', { name: /Register Contract/i }).click()

    await expect(page.getByText('Contract Synchronized')).toBeVisible()
    await expect(detailsPanel.getByText(contractTitle)).toBeVisible()
  })
})
