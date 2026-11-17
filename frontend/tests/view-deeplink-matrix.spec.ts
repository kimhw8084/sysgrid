import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import {
  createConnection,
  ensureSettingOption,
  resetBrowserState,
  seedOperationalScenario,
} from './helpers/sysgrid'
import { expectHealthyShell, expectNoAppFailures, installStrictAppMonitoring } from './helpers/sentinel'

test.describe('View deep-link matrix', () => {
  test('opens critical deep links without crashing and resolves the targeted record', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const failures = installStrictAppMonitoring(page)
    const { primary, secondary, service, monitoring, far } = await seedOperationalScenario(request)
    await ensureSettingOption(request, 'NetworkFarm', 'Prod')
    const connection = await createConnection(request, {
      device_a_id: primary.id,
      source_port: 'eth10',
      device_b_id: secondary.id,
      target_port: 'eth11',
      link_type: 'Data',
      speed_gbps: 10,
      unit: 'Gbps',
      status: 'Active',
      farm: 'Prod',
    })

    await page.goto(`/asset?id=${primary.id}&search=${encodeURIComponent(primary.name)}&status=${encodeURIComponent(primary.status)}`)
    await page.getByPlaceholder('Scan asset matrix...').fill(primary.name)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('treegrid')).toContainText(primary.name)
    await page.waitForTimeout(100)
    await expectHealthyShell(page)
    await expectNoAppFailures(failures, 'asset deep link')
    failures.splice(0)

    await page.goto(`/services?id=${service.id}`)
    await expect(page.getByRole('dialog').getByRole('heading', { level: 2, name: service.name, exact: true })).toBeVisible()
    await expect(page.getByRole('dialog').locator('dd').getByText(service.name, { exact: true })).toBeVisible()

    await page.goto(`/monitoring?id=${monitoring.id}`)
    const monitoringDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { level: 2, name: monitoring.title, exact: true }),
    }).last()
    await expect(monitoringDialog).toBeVisible()
    await expect(monitoringDialog.getByRole('heading', { level: 2, name: monitoring.title, exact: true })).toBeVisible()

    await page.goto(`/far?id=${far.id}`)
    await expect(page.getByRole('heading', { name: far.title })).toBeVisible()

    await page.goto(`/network?id=${connection.id}`)
    await expect(page.getByRole('heading', { name: 'Connection Forensics' })).toBeVisible()

    await page.goto(`/logs?target_table=logical_services&target_id=${service.id}`)
    await expect(page.getByText(`Scoped: logical_services // ${service.id}`)).toBeVisible()

    await page.goto('/settings?tab=permissions')
    await expect(page.getByText('Identity Sync Pipeline')).toBeVisible()

    await expectHealthyShell(page)
    await expectNoAppFailures(failures, 'deep-link matrix')
  })
})
