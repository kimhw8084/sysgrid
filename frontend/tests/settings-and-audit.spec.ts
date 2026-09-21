import { clickResilientButton } from './helpers/sysgrid';
import { expect } from '@playwright/test';
import { test } from './helpers/sysgrid-test';
import { resetBrowserState, seedOperationalScenario } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const testUserId = process.env.SYSGRID_VERIFY_USER_ID || 'haewon.kim'
const hasControlPlaneAuthority = () => (process.env.CONTROL_PLANE_ADMIN_USER_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .includes(testUserId)

test.describe('Settings and audit workflows', () => {
  test('persists theme and loads major settings sections', async ({ page }) => {
    await resetBrowserState(page)

    await page.goto('/settings')
    await expect(page.getByText('Infrastructure Domain')).toBeVisible()

    await clickResilientButton(page, /^Light$/)
    await expect.poll(async () => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('pure-clarity')

    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Infrastructure Domain')).toBeVisible()
    await expect.poll(async () => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('pure-clarity')

    await clickResilientButton(page, /Permission/i)
    await expect(page.getByText('Identity Sync Pipeline')).toBeVisible()
    await expect(page.getByPlaceholder('Search identity, department, or team...')).toBeVisible()

    if (hasControlPlaneAuthority()) {
      await clickResilientButton(page, /Tenants/i)
      await expect(page.getByText('Tenant Registry')).toBeVisible()
      await expect(page.getByRole('button', { name: /Create Tenant/i })).toBeVisible()
    } else {
      await expect(page.getByRole('button', { name: /Tenants/i })).not.toBeVisible()
    }
  })

  test('filters operators and keeps tenant input after a failed create attempt', async ({ page }) => {
    await resetBrowserState(page)

    await page.goto('/settings?tab=permissions')
    await expect(page.getByText('Identity Sync Pipeline')).toBeVisible()
    await page.getByPlaceholder('Search identity, department, or team...').fill(testUserId)
    const adminRow = page.locator('table > tbody > tr').filter({ hasText: testUserId }).first()
    await expect(adminRow).toBeVisible()
    await expect(adminRow).toContainText(testUserId)
    await expect(page.getByText('No operators match the current filter')).not.toBeVisible()

    await page.getByPlaceholder('Search identity, department, or team...').fill('not-a-real-operator')
    await expect(page.getByText('No operators match the current filter')).toBeVisible()

    if (!hasControlPlaneAuthority()) {
      await expect(page.getByRole('button', { name: /Tenants/i })).not.toBeVisible()
      return
    }

    await clickResilientButton(page, /Tenants/i)
    await expect(page.getByText('Tenant Registry')).toBeVisible()
    const tenantTable = page.locator('table').filter({
      has: page.getByRole('columnheader', { name: 'Tenant', exact: true })
    })
    const existingTenantName = (await tenantTable.locator('tbody > tr').first().locator('td').first().locator('div.text-white').innerText()).trim()
    expect(existingTenantName).not.toBe('')

    const tenantInput = page.getByPlaceholder('Tenant name')
    await tenantInput.fill(existingTenantName)
    await clickResilientButton(page, /Create Tenant/i)
    await expect(page.getByText(/Tenant name already exists/i)).toBeVisible()
    await expect(tenantInput).toHaveValue(existingTenantName)
  })

  test('stores and exposes user-pool synchronization history', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const username = `pwsync-${stamp}`
    const fullName = `PW Sync ${stamp}`
    const response = await request.post(`${apiBase}/settings/user-pool/refresh`, {
      data: {
        records: [
          {
            external_id: `pw.sync.${stamp}`,
            username,
            full_name: fullName,
            email: `${username}@example.com`,
            registration_status: 'Verified'
          }
        ],
        source: 'playwright_test'
      },
      /* headers auto-injected */
    })
    if (!response.ok()) { console.error(await response.text()); }
    expect(response.ok()).toBeTruthy()

    await page.goto('/settings?tab=permissions')
    await expect(page.getByText('Identity Sync Pipeline')).toBeVisible()
    const revisionHistory = page.getByRole('button', { name: 'Revision History', exact: true })
    await expect(revisionHistory).toBeVisible()
    await revisionHistory.click()

    const historyDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'Permission Registry History', exact: true })
    })
    await expect(historyDialog).toBeVisible()
    await expect(historyDialog.getByText(fullName, { exact: true })).toBeVisible()
  })

  test('renders scoped audit logs for seeded service activity', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const { service } = await seedOperationalScenario(request)

    await page.goto(`/logs?target_table=logical_services&target_id=${service.id}`)
    await expect(page.getByText(`Scoped: logical_services // ${service.id}`)).toBeVisible()
    await expect(page.getByText(service.name)).toBeVisible()
    await expect(page.getByRole('button', { name: /Analytics/i })).toBeVisible()
  })
})
