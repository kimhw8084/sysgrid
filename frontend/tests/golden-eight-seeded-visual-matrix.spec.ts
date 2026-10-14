import { expect, type APIRequestContext } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { test } from './helpers/sysgrid-test'
import { expectReadableGridText } from './helpers/grid-contrast'
import {
  createConnection,
  createExternalEntity,
  createInvestigation,
  resetBrowserState,
  seedOperationalScenario,
  testApiHeaders,
  waitForAppIdle,
} from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

async function createVendor(request: APIRequestContext, stamp: string) {
  const response = await request.post(`${apiBase}/vendors`, {
    data: {
      name: `PW-SEED-VENDOR-${stamp}`,
      country: 'USA',
    },
    headers: testApiHeaders,
  })
  expect(response.ok()).toBeTruthy()
  return response.json()
}

test.describe('Golden Eight deterministic populated visual matrix', () => {
  test('renders representative populated desktop states for every completed target view', async ({ page, sysApi: request }, testInfo) => {
    await resetBrowserState(page)
    const seeded = await seedOperationalScenario(request)
    const stamp = seeded.stamp

    await createConnection(request, {
      device_a_id: seeded.primary.id,
      source_port: 'eth0',
      device_b_id: seeded.secondary.id,
      target_port: 'eth1',
      link_type: 'Data',
      speed_gbps: 10,
      unit: 'Gbps',
      status: 'Active',
      farm: `PW-SEED-FARM-${stamp}`,
    })

    await createExternalEntity(request, {
      name: `PW-SEED-EXTERNAL-${stamp}`,
      external_key: `pw-seed-external-${stamp}`.toLowerCase(),
      type: 'API',
      owner_organization: 'Seed Partner',
      ownership_mode: 'individual',
      status: 'Active',
      environment: 'Production',
      description: 'Representative populated external dependency',
      business_purpose: 'Golden Eight deterministic visual validation',
      metadata_json: { fixture: 'golden-eight-populated' },
    })

    await createInvestigation(request, {
      title: `PW-SEED-RESEARCH-${stamp}`,
      problem_statement: 'Representative populated research investigation',
      category: 'Research',
      status: 'Analyzing',
      priority: 'High',
      systems: [seeded.systemName],
      initiation_at: '2037-02-03T04:05:00',
    })

    await createVendor(request, stamp)

    const routes = [
      { key: 'monitoring', path: '/monitoring', workspace: 'monitoring' },
      { key: 'assets', path: '/asset', workspace: 'assets' },
      { key: 'services', path: '/services', workspace: 'services' },
      { key: 'external', path: '/external', workspace: 'external' },
      { key: 'network', path: '/network', workspace: 'network' },
      { key: 'far', path: '/far', workspace: 'far' },
      { key: 'research', path: '/research', workspace: 'research' },
      { key: 'vendors', path: '/vendors', workspace: 'vendors' },
    ] as const

    await page.setViewportSize({ width: 1440, height: 900 })

    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const timings: Array<{ theme: string; route: string; readyMs: number }> = []
    for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
      const preference = await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
      expect(preference.ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      for (const route of routes) {
        const started = Date.now()
        await page.goto(route.path)
        await waitForAppIdle(page)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        expect(new URL(page.url()).pathname).toBe(route.path)
        const workspace = page.locator('#sg-main-content')
        await expect(workspace, `${route.key} workspace should render`).toBeVisible()
        const row = workspace.locator('.ag-center-cols-container .ag-row').first()
        await expect(
          row,
          `${route.key} should render at least one representative seeded row`,
        ).toBeVisible()
        await expect(row).toBeInViewport()
        const clipped = await row.evaluate(element => {
          const bounds = element.getBoundingClientRect()
          let ancestor = element.parentElement
          while (ancestor) {
            const style = getComputedStyle(ancestor)
            if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) {
              const clip = ancestor.getBoundingClientRect()
              if (bounds.top < clip.top - 1 || bounds.bottom > clip.bottom + 1) return true
            }
            ancestor = ancestor.parentElement
          }
          return false
        })
        expect(clipped, `${route.key} rows must not be clipped out of the grid surface`).toBe(false)
        if (route.key === 'research') {
          await expect(row.locator('[col-id="title"]'), 'Long system names must leave record titles visible').toBeInViewport({ ratio: 0.5 })
        }
        await row.hover()
        await expectReadableGridText(page, testInfo, `${theme}-${route.key}-hover`, '.ag-center-cols-container, .ag-pinned-right-cols-container')
        timings.push({ theme, route: route.path, readyMs: Date.now() - started })
        await page.screenshot({
          path: testInfo.outputPath(`${theme}-${route.key}-populated-desktop.png`),
          fullPage: false,
          animations: 'disabled',
        })
      }
      for (const route of ['/', '/racks', '/projects', '/architecture', '/knowledge', '/logs', '/settings']) {
        await page.goto(route)
        await waitForAppIdle(page)
        await page.waitForLoadState('networkidle')
        if (route === '/knowledge') {
          await expect(page.getByText(seeded.knowledge.title, { exact: true }).first()).toBeVisible()
          const summary = page.locator('[data-knowledge-summary]').first()
          expect((await summary.boundingBox())!.height, 'Summary cards must not stretch to the queue height').toBeLessThan(240)
          await expect(page.locator('[data-knowledge-record-list] h3').first(), 'Populated records must remain visible below the overview').toBeInViewport()
        }
        await expect(page.locator('#sg-main-content h1, #sg-main-content h2').first()).toBeVisible()
        await expect(page.locator('[data-sg-state="fatal-error"]')).toHaveCount(0)
        expect(new URL(page.url()).pathname).toBe(route)
        await page.screenshot({ path: testInfo.outputPath(`${theme}-${route.slice(1) || 'home'}-desktop.png`), animations: 'disabled' })
      }
    }
    expect(errors).toEqual([])
    const timingsPath = testInfo.outputPath('workspace-navigation-timings.json')
    writeFileSync(timingsPath, JSON.stringify(timings, null, 2))
    await testInfo.attach('workspace-navigation-timings', { path: timingsPath, contentType: 'application/json' })
  })

  for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
    test(`captures canonical mobile routed surfaces in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
      await resetBrowserState(page)
      const preference = await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
      expect(preference.ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      await page.setViewportSize({ width: 390, height: 844 })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      const geometry: Array<{ route: string; overflow: number; gridRows: number }> = []
      for (const route of ['/', '/asset', '/monitoring', '/services', '/network', '/racks', '/logs', '/settings', '/projects', '/architecture', '/research', '/far', '/knowledge', '/external', '/vendors']) {
        await page.goto(route)
        await waitForAppIdle(page)
        await page.waitForLoadState('networkidle')
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        expect(new URL(page.url()).pathname).toBe(route)
        await expect(page.locator('#sg-main-content h1, #sg-main-content h2').first()).toBeVisible()
        await expect(page.locator('[data-sg-state="fatal-error"]')).toHaveCount(0)
        geometry.push(await page.evaluate(route => ({ route, overflow: document.documentElement.scrollWidth - innerWidth, gridRows: document.querySelectorAll('#sg-main-content .ag-center-cols-container .ag-row').length }), route))
        await page.screenshot({ path: testInfo.outputPath(`${route.slice(1) || 'home'}-mobile.png`), fullPage: false, animations: 'disabled' })
      }
      expect(errors).toEqual([])
      expect(geometry.filter(item => item.overflow > 2), 'Routed mobile surfaces must not overflow the document').toEqual([])
      const geometryPath = testInfo.outputPath('mobile-route-geometry.json')
      writeFileSync(geometryPath, JSON.stringify(geometry, null, 2))
      await testInfo.attach('mobile-route-geometry', { path: geometryPath, contentType: 'application/json' })
    })
  }
})
