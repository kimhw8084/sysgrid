import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, createConnection, createMonitoring, createService, resetBrowserState } from './helpers/sysgrid'

const routes = ['/asset', '/monitoring', '/services', '/network', '/racks', '/logs', '/settings', '/']

test('fifteen minute SPA session retains bounded memory after repeated route and dialog use', async ({ page, sysApi }, testInfo) => {
  // This is a separately declared 15-minute soak, with the original 15-second
  // interaction assertions and zero retries. Ordinary V1 timeouts are unchanged.
  test.setTimeout(18 * 60_000)
  await resetBrowserState(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  const first = await createAsset(sysApi, { name: 'Session proof source', system: 'Session proof' })
  const second = await createAsset(sysApi, { name: 'Session proof peer', system: 'Session proof' })
  await createService(sysApi, { name: 'Session proof service', service_type: 'Database', status: 'Active', device_id: first.id })
  await createMonitoring(sysApi, { title: 'Session proof monitor', category: 'Hardware', status: 'Existing', device_id: first.id })
  await createConnection(sysApi, { device_a_id: first.id, device_b_id: second.id, source_port: 'soak-a', target_port: 'soak-b', link_type: 'Data', status: 'Active' })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.stack || error.message))
  await page.goto('/')
  const sidebar = page.locator('[data-sg-app-sidebar]')
  await expect(sidebar).toBeVisible()
  for (const button of await sidebar.locator('button[aria-expanded="false"][aria-controls^="shell-nav-group-"]').all()) await button.click()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const measure = async () => {
    await cdp.send('HeapProfiler.collectGarbage')
    const metrics = await cdp.send('Performance.getMetrics')
    const dom = await cdp.send('Memory.getDOMCounters')
    return { at: Date.now(), heap_bytes: metrics.metrics.find(item => item.name === 'JSHeapUsedSize')!.value, ...dom }
  }
  const cycle = async () => {
    const began = Date.now()
    for (const route of routes) {
      const link = sidebar.locator(`a[href="${route}"]`).first()
      await link.click()
      await expect(page).toHaveURL(new RegExp(`${route === '/' ? '\\/$' : route + '(?:\\?|$)'}`))
      await expect(page.locator('#sg-main-content')).toBeVisible()
      await expect(page.locator('[data-sg-state="fatal-error"]')).not.toBeVisible()
      if (route === '/asset') {
        await page.getByRole('button', { name: 'Register Asset', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Create Asset', exact: true })
        await expect(dialog).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(dialog).not.toBeVisible()
      }
    }
    return Date.now() - began
  }
  for (let index = 0; index < 3; index++) await cycle()
  const baseline = await measure()
  const samples: Array<Awaited<ReturnType<typeof measure>> & { cycle_ms: number }> = []
  const started = Date.now()
  while (Date.now() - started < 900_000) {
    const cycle_ms = await cycle()
    samples.push({ ...await measure(), cycle_ms })
    console.log(JSON.stringify({ memory_sample: samples.length, ...samples.at(-1) }))
    await page.waitForTimeout(15_000)
  }
  const final = await measure()
  const budget = { heap_growth_bytes: Math.max(20 * 1024 * 1024, baseline.heap_bytes * .25), nodes_growth: 1000, listeners_growth: 100, documents_growth: 2 }
  const report = { scope: 'synthetic_local_chromium_small_fixture_spa_session', duration_ms: Date.now() - started,
    warmup_cycles: 3, baseline, final, budget, samples, errors, company_proof: false }
  await testInfo.attach('session-memory-report', { contentType: 'application/json', body: JSON.stringify(report) })
  await page.screenshot({ path: testInfo.outputPath('session-final-home.png'), animations: 'disabled' })
  expect(samples.length).toBeGreaterThan(10)
  expect(final.heap_bytes - baseline.heap_bytes).toBeLessThanOrEqual(budget.heap_growth_bytes)
  expect(final.nodes - baseline.nodes).toBeLessThanOrEqual(budget.nodes_growth)
  expect(final.jsEventListeners - baseline.jsEventListeners).toBeLessThanOrEqual(budget.listeners_growth)
  expect(final.documents - baseline.documents).toBeLessThanOrEqual(budget.documents_growth)
  expect(errors).toEqual([])
})
