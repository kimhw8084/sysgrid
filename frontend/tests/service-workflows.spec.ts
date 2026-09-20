import { clickResilientButton } from './helpers/sysgrid';
import { expect } from '@playwright/test';
import { test } from './helpers/sysgrid-test';
import { createAsset, createService, resetBrowserState } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

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
    await expect(purgedDialog.getByRole('paragraph').filter({ hasText: 'Stopped' })).toBeVisible()
    await expect(purgedDialog.locator('.text-amber-200').filter({ hasText: 'Purge is unavailable' })).toBeVisible()
    await expect(purgedDialog.getByRole('heading', { level: 3, name: purgedService.name })).toBeVisible()
    await purgedDialog.getByTitle('Close').click()
    await expect(page).not.toHaveURL(new RegExp(`id=${purgedService.id}`))
  })
})
