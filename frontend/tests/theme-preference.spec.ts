import { expect, type Locator, type Page } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, createConnection, createMonitoring, createService, resetBrowserState } from './helpers/sysgrid'

async function settleAppearance(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    await Promise.all(document.getAnimations()
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => undefined)))
  })
}

const themeConsumers = '[class*="dark:"], [role="gridcell"], [role="columnheader"], [role="gridcell"] [class*="text-"]'

async function visibleThemeConsumers(scope: Locator) {
  return scope.locator(themeConsumers).evaluateAll(nodes => nodes.flatMap(node => {
    const bounds = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    if (!bounds.width || !bounds.height || style.visibility === 'hidden') return []
    return [{
      text: node.textContent?.trim(), classes: node.getAttribute('class'),
      color: style.color, background: style.backgroundColor, border: style.borderColor,
      width: bounds.width, height: bounds.height,
    }]
  }))
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const surface of ['assets', 'network', 'service-detail', 'monitoring-detail']) {
    test(`saved theme ${theme} controls ${surface} independently of OS appearance`, async ({ page, sysApi: request }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await resetBrowserState(page)
      const preference = await request.patch(`${process.env.PW_API_BASE}/settings/user/settings`, { data: { theme } })
      expect(preference.ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      const suffix = `${theme}-${surface}`
      const host = await createAsset(request, { name: `Theme host ${suffix}`, system: `Theme ${suffix}`, type: 'Physical', status: 'Active', serial_number: suffix })
      let route = '/asset'
      let heading: string | undefined
      if (surface === 'network') {
        const peer = await createAsset(request, { name: `Theme peer ${suffix}`, system: `Theme ${suffix}`, type: 'Physical', status: 'Active', serial_number: `peer-${suffix}` })
        await createConnection(request, { device_a_id: host.id, device_b_id: peer.id, source_port: 'eth0', target_port: 'eth1', link_type: 'Data', speed_gbps: 10, unit: 'Gbps', status: 'Active' })
        route = '/network'
      } else if (surface === 'service-detail') {
        const service = await createService(request, { name: `Theme service ${suffix}`, device_id: host.id, service_type: 'Application', status: 'Active', environment: 'Production' })
        route = `/services?id=${service.id}`
        heading = service.name
      } else if (surface === 'monitoring-detail') {
        const monitor = await createMonitoring(request, { title: `Theme monitor ${suffix}`, device_id: host.id, category: 'App', platform: 'Zabbix', status: 'Existing', severity: 'Warning' })
        route = `/monitoring?id=${monitor.id}`
        heading = monitor.title
      }

      const appearances: Record<string, Awaited<ReturnType<typeof visibleThemeConsumers>>> = {}
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme })
        await page.goto(route)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(page.locator('html')).toHaveClass(theme === 'pure-clarity' ? /^(?!.*\bdark\b).*$/ : /\bdark\b/)
        if (!heading) {
          // Locate the fixture through the user's search so virtualized rows
          // remain reachable after other desktop cases have populated the grid.
          await page.getByPlaceholder(surface === 'assets' ? 'Scan asset matrix...' : 'Scan matrix...').fill(host.name)
        }
        const scope = heading
          ? page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: heading, exact: true }) })
          : page.locator('#sg-main-content')
        await expect(scope).toBeVisible()
        if (!heading) await expect(scope.getByText(host.name, { exact: true }).first()).toBeVisible()
        await expect(scope.locator(themeConsumers).first()).toBeVisible()
        await page.waitForLoadState('networkidle')
        await settleAppearance(page)
        appearances[colorScheme] = await visibleThemeConsumers(scope)
        expect(appearances[colorScheme].length).toBeGreaterThan(0)
        await page.screenshot({ path: testInfo.outputPath(`${surface}-os-${colorScheme}.png`), animations: 'disabled' })

        // Compare the same hydrated document before/after the OS change. A
        // reload independently restores saved sorting and auto-sized columns.
        await page.emulateMedia({ colorScheme: colorScheme === 'light' ? 'dark' : 'light' })
        await settleAppearance(page)
        expect(await visibleThemeConsumers(scope), 'An OS appearance change must preserve the saved app colors, geometry and open record').toEqual(appearances[colorScheme])
        await page.emulateMedia({ colorScheme })
        await settleAppearance(page)
        expect(await visibleThemeConsumers(scope)).toEqual(appearances[colorScheme])
      }
      await testInfo.attach('theme-consumer-appearance', { body: JSON.stringify({ theme, surface, appearances }, null, 2), contentType: 'application/json' })
    })
  }
}
