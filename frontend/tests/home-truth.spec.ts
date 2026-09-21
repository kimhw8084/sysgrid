import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, createMonitoring, createService, resetBrowserState } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const headers = {
  'X-User-Id': process.env.USER_ID || 'haewon.kim',
  'X-Tenant-Id': process.env.PW_TENANT_ID || '1',
}

test.describe('CHG-49 Home truth projection', () => {
  test('normal-v1 empty inventory keeps observations unavailable', async ({ page, request }) => {
    await resetBrowserState(page)
    const response = await request.get(`${apiBase}/dashboard/metrics`, { headers })
    expect(response.ok()).toBeTruthy()
    const metrics = await response.json()

    expect(metrics.asset_overview.total).toBe(0)
    expect(metrics.asset_overview.truth.value).toBe(0)
    expect(metrics.observed_health.history.value).toBeNull()
    expect(metrics.observed_health.history.available).toBe(false)
    expect(metrics.incident_summary.value).toBeNull()
    expect(metrics.critical_alerts).toBeUndefined()

    await page.goto('/')
    await expect(page.getByText('Observed health history (24h)')).toBeVisible()
    await expect(page.getByText('Unavailable', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Hardened', { exact: true })).toHaveCount(0)
    await expect(page.getByText('V-SCAN: 100%', { exact: true })).toHaveCount(0)
  })

  test('normal-v1 populated inventory remains useful without becoming health evidence', async ({ page, request }) => {
    const stamp = Date.now()
    const asset = await createAsset(request, {
      name: `HOME-TRUTH-ASSET-${stamp}`,
      system: `HOME-TRUTH-SYSTEM-${stamp}`,
      status: 'Active',
      type: 'Physical',
      model: 'R740',
      serial_number: `HOME-TRUTH-SN-${stamp}`,
      asset_tag: `HOME-TRUTH-TAG-${stamp}`,
      owner: 'Home truth proof',
      business_unit: 'Operations',
    })
    await createService(request, {
      name: `HOME-TRUTH-SERVICE-${stamp}`,
      service_type: 'Database',
      status: 'Active',
      environment: 'Production',
      device_id: asset.id,
      purpose: 'Home truth proof',
    })
    await createMonitoring(request, {
      device_id: asset.id,
      category: 'Hardware',
      status: 'Existing',
      title: `HOME-TRUTH-MONITOR-${stamp}`,
      platform: 'Zabbix',
      purpose: 'Coverage definition only',
      notification_method: 'Slack',
    })

    const response = await request.get(`${apiBase}/dashboard/metrics`, { headers })
    expect(response.ok()).toBeTruthy()
    const metrics = await response.json()
    expect(metrics.asset_overview.total).toBeGreaterThan(0)
    expect(metrics.service_overview.total).toBeGreaterThan(0)
    expect(metrics.monitoring_overview.total).toBeGreaterThan(0)
    expect(metrics.monitoring_overview.truth.kind).toBe('configuration')
    expect(metrics.observed_health.history.available).toBe(false)
    expect(metrics.incident_summary.available).toBe(false)

    await page.goto('/')
    await expect(page.getByText('Infrastructure assets', { exact: true })).toBeVisible()
    await expect(page.getByText('Monitoring definitions', { exact: true })).toBeVisible()
    await expect(page.getByText('Observed health history (24h)')).toBeVisible()

    const homeSearch = page.getByRole('textbox', { name: 'Search released Home records' })
    await homeSearch.fill(asset.name)
    await homeSearch.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/asset\\?id=${asset.id}`))
  })
})
