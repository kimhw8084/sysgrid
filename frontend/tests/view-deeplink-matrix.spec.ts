import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import {
  createConnection,
  createProject,
  ensureSettingOption,
  resetBrowserState,
  seedOperationalScenario,
} from './helpers/sysgrid'
import { expectHealthyShell, expectNoAppFailures, installStrictAppMonitoring } from './helpers/sentinel'

test.describe('View deep-link matrix', () => {
  test('opens critical deep links without crashing and resolves the targeted record', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const failures = installStrictAppMonitoring(page)
    const { primary, secondary, service, knowledge, monitoring, far } = await seedOperationalScenario(request)
    await ensureSettingOption(request, 'NetworkFarm', 'Prod')
    const rootPreview = process.env.SYSGRID_VERIFY_PROFILE === 'root-preview'
    const project = rootPreview ? await createProject(request, {
      name: `PW-PROJ-DEEPLINK-${Date.now()}`,
      type: 'Strategic',
      status: 'Planning',
      priority: 'High',
      target_assets: [primary.id],
      target_services: [service.id],
    }) : null
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
    await expect(page.getByRole('heading', { level: 3, name: service.name })).toBeVisible()

    if (project) {
      await page.goto(`/projects?id=${project.id}`)
      await expect(page.locator('h1').filter({ hasText: project.name })).toBeVisible()
    } else {
      await page.goto('/projects')
      await expect(page.getByRole('heading', { name: 'Access unavailable', exact: true })).toBeVisible()
    }

    await page.goto(`/monitoring?id=${monitoring.id}`)
    const monitoringDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { level: 2, name: monitoring.title, exact: true }),
    }).last()
    await expect(monitoringDialog).toBeVisible()
    await expect(monitoringDialog.getByRole('heading', { level: 2, name: monitoring.title, exact: true })).toBeVisible()

    if (rootPreview) {
      await page.goto(`/far?id=${far.id}`)
      await expect(page.getByRole('heading', { name: far.title })).toBeVisible()

      await page.goto(`/knowledge?device_id=${primary.id}`)
      await expect(page.getByText(knowledge.title).first()).toBeVisible()
      await expect(page.getByText('Suggested Knowledge Context')).toBeVisible()
    } else {
      await page.goto(`/far?id=${far.id}`)
      await expect(page.getByRole('heading', { name: 'Access unavailable', exact: true })).toBeVisible()
      await page.goto(`/knowledge?device_id=${primary.id}`)
      await expect(page.getByRole('heading', { name: 'Access unavailable', exact: true })).toBeVisible()
    }

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
