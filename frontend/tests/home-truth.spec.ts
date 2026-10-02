import { expect, type APIRequestContext } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, createMonitoring, createService, fillGridSearch, getWorkspaceLogicalRowByText, resetBrowserState } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const headers = {
  'X-User-Id': process.env.USER_ID || 'haewon.kim',
  'X-Tenant-Id': process.env.PW_TENANT_ID || '1',
}

async function deleteActiveRows(request: APIRequestContext, path: string) {
  const response = await request.get(apiBase + path, { headers })
  expect(response.ok()).toBeTruthy()
  const rows = await response.json()
  expect(Array.isArray(rows)).toBeTruthy()

  for (const row of rows) {
    const deletion = await request.delete(
      apiBase + path + '/' + row.id,
      { headers },
    )
    expect(deletion.ok()).toBeTruthy()
  }
}

async function clearActiveHomeInventory(request: APIRequestContext) {
  await deleteActiveRows(request, '/logical-services')
  await deleteActiveRows(request, '/monitoring')
  await deleteActiveRows(request, '/devices')
}

test.describe('CHG-49 Home truth projection', () => {
  test('normal-v1 empty inventory keeps observations unavailable', async ({ page, request }) => {
    await resetBrowserState(page)
    await clearActiveHomeInventory(request)
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

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  test(`Home preserves every unknown inventory count and drills through in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    await resetBrowserState(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const before = await request.get(`${apiBase}/dashboard/metrics`)
    expect(before.ok()).toBeTruthy()
    const baseline = await before.json()
    const stamp = Date.now()
    let name = ''
    let assetId = 0
    for (const [typeIndex, type] of [null, '', 'Unknown'].entries()) {
      for (const [statusIndex, status] of [null, '', 'Unknown'].entries()) {
        name = `Home count ${theme} ${stamp} ${typeIndex}-${statusIndex}`
        assetId = (await createAsset(request, { name, system: 'Home count proof', type, status })).id
      }
    }
    const response = await request.get(`${apiBase}/dashboard/metrics`)
    expect(response.ok()).toBeTruthy()
    const metrics = await response.json()
    const overview = metrics.asset_overview
    expect(overview.total).toBe(baseline.asset_overview.total + 9)
    expect(overview.breakdown.Unknown.Unknown).toBe((baseline.asset_overview.breakdown.Unknown?.Unknown || 0) + 9)
    const count = Object.values(overview.breakdown as Record<string, Record<string, number>>)
      .reduce((sum, states) => sum + Object.values(states).reduce((subtotal, value) => subtotal + value, 0), 0)
    expect(count).toBe(overview.total)
    expect(metrics.observed_health.history.available).toBe(false)
    await page.goto('/')
    const card = page.getByRole('link', { name: 'Open Infrastructure assets', exact: true })
    await expect(card.getByRole('heading', { level: 2 })).toHaveText(String(overview.total))
    await expect(card.locator(`[title="Unknown: ${overview.breakdown.Unknown.Unknown}"]`)).toBeVisible()
    await card.screenshot({ path: testInfo.outputPath(`home-count-${theme}.png`), animations: 'disabled' })
    await card.click()
    await expect(page).toHaveURL(/\/asset(?:\?|$)/)
    await fillGridSearch(page, 'Scan asset matrix...', name)
    await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(1)
    const row = await getWorkspaceLogicalRowByText(page, 'assets', name)
    expect(row.rowKey).toBe(String(assetId))
  })
}
