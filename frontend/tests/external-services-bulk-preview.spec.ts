import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { clickResilientButton, createExternalEntity, createService, resetBrowserState } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const multiSelectModifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const targetEnvironment = 'Development'

async function selectRowsByNames(page: any, names: string[]) {
  const selectedRows = []
  for (const [index, name] of names.entries()) {
    const row = page
      .locator('.ag-pinned-left-cols-container .ag-row, .ag-center-cols-container .ag-row')
      .filter({ hasText: name })
      .first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    const nameCell = row.locator('.ag-cell[col-id="name"], .ag-cell').first()
    await nameCell.click(index === 0 ? undefined : { modifiers: [multiSelectModifier] })
    await expect(row).toHaveClass(/ag-row-selected/)
    selectedRows.push(row)
  }
  return selectedRows
}

async function choosePortaledDropdownOption(page: any, label: string) {
  const menu = page
    .locator('[data-workspace-panel="true"]')
    .filter({ has: page.getByPlaceholder('Search options...') })
    .last()
  await expect(menu).toBeVisible()
  const option = menu.getByRole('button', { name: label, exact: true })
  await expect(option).toBeVisible()
  await option.click()
}

test.describe('External and Services authoritative bulk preview', () => {
  test('previews and confirms exact environment changes in both goldenized workspaces', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const services = await Promise.all([
      createService(request, { name: `PW-SVC-BULK-A-${stamp}`, service_type: 'Database', status: 'Active', environment: 'Production' }),
      createService(request, { name: `PW-SVC-BULK-B-${stamp}`, service_type: 'API', status: 'Active', environment: 'Production' }),
    ])

    await page.goto('/services')
    const servicesSearch = page.getByPlaceholder('Search services, hosts, or metadata...')
    await servicesSearch.fill(stamp)
    await expect(servicesSearch).toHaveValue(stamp)
    await selectRowsByNames(page, services.map((service: any) => service.name))
    await clickResilientButton(page, 'Bulk actions')
    await clickResilientButton(page, 'Set Environment')
    await clickResilientButton(page, 'Choose environment')
    await choosePortaledDropdownOption(page, targetEnvironment)
    await clickResilientButton(page, 'Apply Environment')

    const servicePreview = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Services bulk preview' }) })
    await expect(servicePreview).toBeVisible()
    await expect(servicePreview.getByTestId('bulk-preview-selected')).toHaveText('2')
    await expect(servicePreview.getByTestId('bulk-preview-will-change')).toHaveText('2')
    await expect(servicePreview.getByTestId('bulk-preview-no-change')).toHaveText('0')
    await expect(servicePreview).toContainText('No records change until you confirm.')

    const servicesBeforeConfirmResponse = await request.get(`${apiBase}/logical-services`)
    expect(servicesBeforeConfirmResponse.ok()).toBeTruthy()
    const servicesBeforeConfirm = await servicesBeforeConfirmResponse.json()
    for (const service of services) {
      expect(servicesBeforeConfirm.find((row: any) => row.id === service.id)?.environment).toBe('Production')
    }

    await clickResilientButton(page, 'Confirm Apply Environment')
    const serviceReceipt = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Services bulk complete' }) })
    await expect(serviceReceipt).toBeVisible({ timeout: 15_000 })
    await expect(serviceReceipt.getByTestId('bulk-preview-changed')).toHaveText('2')
    await expect(serviceReceipt.getByTestId('bulk-preview-unchanged')).toHaveText('0')
    await expect(serviceReceipt).toContainText('Bulk operation completed.')

    const servicesResponse = await request.get(`${apiBase}/logical-services`)
    expect(servicesResponse.ok()).toBeTruthy()
    const serviceRows = await servicesResponse.json()
    for (const service of services) {
      expect(serviceRows.find((row: any) => row.id === service.id)?.environment).toBe(targetEnvironment)
    }

    await serviceReceipt.getByRole('button', { name: 'Undo bulk changes' }).click()
    await expect(serviceReceipt).not.toBeVisible({ timeout: 15_000 })
    const servicesAfterUndoResponse = await request.get(`${apiBase}/logical-services`)
    expect(servicesAfterUndoResponse.ok()).toBeTruthy()
    const servicesAfterUndo = await servicesAfterUndoResponse.json()
    for (const service of services) {
      expect(servicesAfterUndo.find((row: any) => row.id === service.id)?.environment).toBe('Production')
    }

    const externalEntities = await Promise.all([
      createExternalEntity(request, {
        name: `PW-EXT-BULK-A-${stamp}`, external_key: `pw-ext-bulk-a-${stamp}`.toLowerCase(), type: 'API',
        owner_organization: 'PartnerCo', status: 'Active', environment: 'Production',
      }),
      createExternalEntity(request, {
        name: `PW-EXT-BULK-B-${stamp}`, external_key: `pw-ext-bulk-b-${stamp}`.toLowerCase(), type: 'API',
        owner_organization: 'PartnerCo', status: 'Active', environment: 'Production',
      }),
    ])

    await page.goto('/external')
    const externalSearch = page.getByPlaceholder('Scan registry...')
    await externalSearch.fill(stamp)
    await expect(externalSearch).toHaveValue(stamp)
    await selectRowsByNames(page, externalEntities.map((entity: any) => entity.name))
    await clickResilientButton(page, 'Bulk actions')
    await clickResilientButton(page, 'Set Environment')
    await clickResilientButton(page, 'Choose environment')
    await choosePortaledDropdownOption(page, targetEnvironment)
    await clickResilientButton(page, 'Apply Environment')

    const externalPreview = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'External bulk preview' }) })
    await expect(externalPreview).toBeVisible()
    await expect(externalPreview.getByTestId('bulk-preview-selected')).toHaveText('2')
    await expect(externalPreview.getByTestId('bulk-preview-will-change')).toHaveText('2')
    await expect(externalPreview.getByTestId('bulk-preview-no-change')).toHaveText('0')
    await expect(externalPreview).toContainText('No records change until you confirm.')

    const externalBeforeConfirmResponse = await request.get(`${apiBase}/intelligence/entities`)
    expect(externalBeforeConfirmResponse.ok()).toBeTruthy()
    const externalBeforeConfirm = await externalBeforeConfirmResponse.json()
    for (const entity of externalEntities) {
      expect(externalBeforeConfirm.find((row: any) => row.id === entity.id)?.environment).toBe('Production')
    }

    await clickResilientButton(page, 'Confirm Apply Environment')
    const externalReceipt = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'External bulk complete' }) })
    await expect(externalReceipt).toBeVisible({ timeout: 15_000 })
    await expect(externalReceipt.getByTestId('bulk-preview-changed')).toHaveText('2')
    await expect(externalReceipt.getByTestId('bulk-preview-unchanged')).toHaveText('0')

    const externalResponse = await request.get(`${apiBase}/intelligence/entities`)
    expect(externalResponse.ok()).toBeTruthy()
    const externalRows = await externalResponse.json()
    for (const entity of externalEntities) {
      expect(externalRows.find((row: any) => row.id === entity.id)?.environment).toBe(targetEnvironment)
    }
    await externalReceipt.getByRole('button', { name: 'Close bulk receipt' }).click()
    await expect(externalReceipt).not.toBeVisible()
  })
})
