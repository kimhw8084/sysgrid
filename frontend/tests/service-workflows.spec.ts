import { clickResilientButton } from './helpers/sysgrid';
import { expect } from '@playwright/test';
import { test } from './helpers/sysgrid-test';
import { createAsset, createService, resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  test(`Service form labels and rejected-save recovery are accessible in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    await resetBrowserState(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const name = `Service form ${theme} ${Date.now()}`
    const host = await createAsset(request, { name: `Host ${name}`, system: 'Service form proof' })
    let rejected = false
    await page.route(/\/api\/v1\/logical-services\/?$/, async route => {
      if (route.request().method() === 'POST' && !rejected) {
        rejected = true
        await route.fulfill({ status: 422, contentType: 'application/json',
          body: JSON.stringify({ detail: { field_errors: { installation_date: 'Review the deployment date before saving.' } } }) })
      } else await route.continue()
    })
    await page.goto('/services')
    await page.getByRole('button', { name: /\+ Add Service/i }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: 'Create Service' })
    const form = dialog.locator('#service-record-form')
    await form.getByPlaceholder('e.g. ERP DB Prod 01').fill(name)
    await form.getByPlaceholder('v1.0.0').fill('000007')
    await form.getByRole('button', { name: 'Select host node' }).click()
    await page.getByPlaceholder('Search hostname or system...').fill(host.name)
    await page.getByRole('button', { name: new RegExp(host.name) }).click()
    await form.locator('label').filter({ hasText: /^Deployment Date$/ }).locator('..').locator('input').fill('2026-10-02')
    await dialog.getByRole('button', { name: 'Add Service', exact: true }).click()
    await expect(form).toContainText('Fix the highlighted service fields before saving.')
    await expect(form).not.toContainText('field_errors')
    await expect(page.getByText('Fix the highlighted service fields before saving.', { exact: true })).toHaveCount(2)
    expect(await page.getByText('Action needed', { exact: true }).count()).toBe(1)
    expect(await page.getByText('[object Object]', { exact: true }).count()).toBe(0)
    expect(rejected).toBe(true)
    await expect(form.getByLabel(/^Name/)).toHaveValue(name)
    await expect(form.getByLabel('Version', { exact: true })).toHaveValue('000007')
    const date = form.getByLabel('Deployment Date', { exact: true })
    await expect(date).toHaveAttribute('aria-invalid', 'true')
    await expect(date).toHaveAccessibleDescription('Review the deployment date before saving.')
    for (const label of ['Deployment Date', 'Version', 'Purpose', 'Expiry Date', 'Manufacturer', 'Supplier', 'Cost']) {
      await expect(form.getByLabel(label, { exact: true })).toHaveCount(1)
    }
    await form.locator('label').filter({ hasText: /^Version$/ }).click()
    await expect(form.getByLabel('Version', { exact: true })).toBeFocused()
    await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click()
    await date.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`service-form-error-${theme}.png`), animations: 'disabled' })
    await date.fill('2026-10-03')
    await expect(date).toHaveAttribute('aria-invalid', 'false')
    await expect(date).not.toHaveAttribute('aria-describedby')
    await dialog.getByRole('button', { name: 'Add Service', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const saved = await request.get(`${apiBase}/logical-services?device_id=${host.id}`)
    expect(saved.ok()).toBeTruthy()
    expect(await saved.json()).toEqual([expect.objectContaining({ name, version: '000007', installation_date: '2026-10-03T00:00:00' })])
  })

  test(`Service import rejects unavailable hosts and preserves identifiers in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    await resetBrowserState(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const name = `Service import ${theme} ${Date.now()}`
    const host = await createAsset(request, { name: `Host ${name}`, system: 'Service import proof' })
    const csv = `name,service_type,status,version,device_id,license_key,purpose,installation_date,purchase_date,expiry_date\n${name},OS,Existing,000007,${host.id},0000123,NA,2026-10-02,2026-09-30,2027-10-02\nUnavailable host,OS,Existing,1,900000000,,,,,`
    await page.goto('/services')
    await page.getByRole('button', { name: 'Import service rows', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Services Import', exact: true })
    await dialog.locator('input[type="file"]').setInputFiles({ name: 'services-proof.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
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
    await expect(rows.nth(1)).toContainText('Asset not found')
    await table.scrollIntoViewIfNeeded()
    await expect(dialog).toHaveCSS('opacity', '1')
    await expectReadableGridText(page, testInfo, 'service-import-preview', '[role="dialog"][aria-label="Services Import"] :is(th, td)')
    await page.screenshot({ path: testInfo.outputPath(`service-import-preview-${theme}.png`), animations: 'disabled' })
    const save = page.waitForResponse(response => response.url().includes('/api/v1/import/execute'))
    await dialog.getByRole('button', { name: 'Import 1', exact: true }).click()
    const saved = await save
    expect(saved.ok()).toBeTruthy()
    expect(await saved.json()).toEqual({ status: 'success', count: 1 })
    expect(saved.request().postDataJSON().rows).toHaveLength(1)
    await expect(dialog).toHaveCount(0)
    await page.getByPlaceholder('Search services, hosts, or metadata...').fill(name)
    await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(1)
    await expect(page.locator('.ag-center-cols-container .ag-row')).toContainText(host.name)
    const readback = await request.get(`${apiBase}/logical-services?device_id=${host.id}`)
    expect(readback.ok()).toBeTruthy()
    const imported = await readback.json()
    expect(imported).toEqual([expect.objectContaining({ name, device_id: host.id, version: '000007', license_key: '0000123', purpose: 'NA',
      installation_date: '2026-10-02T00:00:00', purchase_date: '2026-09-30T00:00:00', expiry_date: '2027-10-02T00:00:00' })])
    const assets = await request.get(`${apiBase}/devices`)
    expect(assets.ok()).toBeTruthy()
    expect((await assets.json()).find((asset: { id: number }) => asset.id === host.id))
      .toMatchObject({ os_name: name, os_version: '000007' })
    await page.goto(`/logs?target_table=logical_services&target_id=${imported[0].id}`)
    const historyRows = page.locator('.ag-center-cols-container .ag-row')
    await expect(historyRows).toHaveCount(1)
    await expect(historyRows).toContainText('Imported logical service')
    await page.getByRole('button', { name: 'Open target record', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/services\\?id=${imported[0].id}(?:&|$)`))
    const detail = page.getByRole('dialog').filter({ has: page.getByRole('heading', { level: 2, name, exact: true }) })
    await expect(detail).toBeVisible()
    await expect(detail.locator('dt').filter({ hasText: /^Version$/ }).locator('..').locator('dd')).toHaveText('000007')
    await expect(detail.locator('dt').filter({ hasText: /^Deployment Date$/ }).locator('..').locator('dd')).toHaveText('2026-10-02')
    await expect(detail.locator('dt').filter({ hasText: /^Expiry Date$/ }).locator('..').locator('dd')).toHaveText('2027-10-02')
  })
}

test.describe('Service workflows', () => {
  test('adopts searchable Host selection and saves the selected numeric device id', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const host = await createAsset(request, {
      name: `PW-SVC-HOST-A-${stamp}`,
      system: `PW-SVC-SYS-A-${stamp}`,
      status: 'Active',
      model: 'R740',
      type: 'Physical',
      serial_number: `PW-SVC-SN-A-${stamp}`,
      asset_tag: `PW-SVC-AT-A-${stamp}`,
      owner: 'ops',
      business_unit: 'Platform'
    })
    const alternateHost = await createAsset(request, {
      name: `PW-SVC-HOST-B-${stamp}`,
      system: `PW-SVC-SYS-B-${stamp}`,
      status: 'Active',
      model: 'R740',
      type: 'Virtual',
      serial_number: `PW-SVC-SN-B-${stamp}`,
      asset_tag: `PW-SVC-AT-B-${stamp}`,
      owner: 'ops',
      business_unit: 'Platform'
    })
    const serviceName = `PW-SVC-PARITY-${stamp}`

    await page.goto('/services')
    await expect(page.getByRole('heading', { name: 'Services' })).toBeVisible()
    await page.getByRole('button', { name: /\+ Add Service/i }).click()
    const formDialog = page.getByRole('dialog').filter({ hasText: 'Create Service' })
    await expect(formDialog).toBeVisible()
    await formDialog.locator('input[placeholder="e.g. ERP DB Prod 01"]').fill(serviceName)
    await formDialog.getByRole('button', { name: 'Select host node' }).click()
    await page.getByRole('button', { name: 'All Systems', exact: true }).click()
    await page.getByRole('button', { name: alternateHost.system, exact: true }).click()
    await page.getByPlaceholder('Search hostname or system...').fill(alternateHost.name)
    await expect(page.getByRole('button', { name: new RegExp(alternateHost.name) })).toBeVisible()
    await page.getByRole('button', { name: new RegExp(alternateHost.name) }).click()

    await formDialog.getByRole('button', { name: 'Add Service', exact: true }).click()
    await expect(formDialog).not.toBeVisible()
    await expect.poll(async () => {
      const response = await request.get(`${apiBase}/logical-services`)
      const services = await response.json()
      return Array.isArray(services) && services.some((service: any) => (
        service.name === serviceName && service.device_id === alternateHost.id && typeof service.device_id === 'number'
      ))
    }).toBeTruthy()
    expect(host.id).not.toBe(alternateHost.id)
  })

  test('tolerates malformed metadata and clears deep-link state on close', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const host = await createAsset(request, {
      name: `PW-SVC-HOST-${stamp}`,
      system: `PW-SVC-SYS-${stamp}`,
      status: 'Active',
      model: 'R740',
      type: 'Physical',
      serial_number: `PW-SVC-SN-${stamp}`,
      asset_tag: `PW-SVC-AT-${stamp}`,
      owner: 'ops',
      business_unit: 'Platform'
    })

    const activeService = await createService(request, {
      name: `PW-SVC-ACTIVE-${stamp}`,
      service_type: 'Database',
      status: 'Active',
      environment: 'Production',
      device_id: host.id,
      license_key: 'LIC-PW-1234',
      config_json: '{bad json'
    })

    const purgedService = await createService(request, {
      name: `PW-SVC-PURGED-${stamp}`,
      service_type: 'Web Server',
      status: 'Stopped',
      environment: 'DR'
    })

    const purgeResponse = await request.delete(`${apiBase}/logical-services/${purgedService.id}`)
    expect(purgeResponse.ok()).toBeTruthy()

    await page.goto(`/services?id=${activeService.id}`)
    const activeDialog = page.getByRole('dialog').filter({ hasText: activeService.name })
    await expect(activeDialog).toBeVisible()
    await clickResilientButton(page, 'Edit Service')
    
    const editDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'Edit Service', exact: true })
    })
    await expect(editDialog).toBeVisible()
    await expect(editDialog.locator('#service-record-form').getByText('Configuration Metadata', { exact: true })).toBeVisible()
    await editDialog.getByTitle('Close').click()
    await expect(editDialog).not.toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page).not.toHaveURL(new RegExp(`id=${activeService.id}`))

    await page.goto(`/services?id=${purgedService.id}`)
    const purgedDialog = page.getByRole('dialog').filter({ hasText: purgedService.name })
    const statusValue = purgedDialog.locator('dt').filter({ hasText: /^Status$/ }).locator('..').locator('dd')
    await expect(statusValue).toBeVisible()
    await expect(statusValue).toHaveText('Stopped')
    await expect(purgedDialog.locator('.text-amber-200').filter({ hasText: 'Purge is unavailable' })).toBeVisible()
    await expect(purgedDialog.getByRole('heading', { level: 2, name: purgedService.name, exact: true })).toBeVisible()
    await expect(purgedDialog.locator('dd').getByText(purgedService.name, { exact: true })).toBeVisible()
    await purgedDialog.getByTitle('Close').click()
    await expect(page).not.toHaveURL(new RegExp(`id=${purgedService.id}`))
  })
})
