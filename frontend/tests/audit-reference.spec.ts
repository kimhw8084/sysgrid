import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { expectReadableGridText } from './helpers/grid-contrast'
import { createService, resetBrowserState } from './helpers/sysgrid'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const width of [1440, 390]) {
    test(`audit reference ${theme} ${width}`, async ({ page, sysApi: request }, testInfo) => {
      await resetBrowserState(page)
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 })
      const preference = await request.patch(`${process.env.PW_API_BASE}/settings/user/settings`, { data: { theme } })
      expect(preference.ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      const service = await createService(request, { name: `Audit reference ${theme} ${width}`, service_type: 'Application', status: 'Existing', version: '1' })
      const changed = await request.put(`${process.env.PW_API_BASE}/logical-services/${service.id}`, { data: { version: '2' } })
      expect(changed.ok()).toBeTruthy()
      await page.goto(`/logs?target_table=logical_services&target_id=${service.id}`)
      await expect(page.getByText('Complete matching scope', { exact: true })).toBeVisible()
      await page.waitForLoadState('networkidle')
      await expectReadableGridText(page, testInfo, 'audit', '[data-audit-ledger] .ag-cell')
      if (width < 768) await page.getByRole('button', { name: /Analytics/i }).click()
      await expect(page.getByText('Transaction Velocity (Loaded result/page)', { exact: true })).toBeVisible()
      const charts = page.locator('.recharts-wrapper')
      await expect(charts).toHaveCount(2)
      await page.evaluate(() => document.fonts.ready)
      const geometry = await charts.evaluateAll(nodes => nodes.map(node => ({
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
        svg: node.querySelector(':scope > svg.recharts-surface')?.getBoundingClientRect().toJSON(),
        bars: Array.from(node.querySelectorAll('.recharts-bar-rectangle path')).map(bar => bar.getBoundingClientRect().toJSON()),
        dots: Array.from(node.querySelectorAll('.recharts-area-dots circle')).map(dot => dot.getBoundingClientRect().toJSON()),
      })))
      await testInfo.attach('audit-chart-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' })
      for (const chart of geometry) {
        expect.soft(chart.width).toBeGreaterThan(180)
        expect.soft(chart.svg?.width ?? 0).toBeGreaterThan(180)
        expect.soft(chart.height).toBeGreaterThan(100)
      }
      expect.soft(geometry[0].dots.some(dot => dot.width >= 5 && dot.height >= 5)).toBeTruthy()
      expect.soft(geometry[1].bars.filter(bar => bar.width > 10 && bar.height > 5)).toHaveLength(2)
      await page.getByText('Transaction Velocity (Loaded result/page)', { exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath('audit-analytics.png'), animations: 'disabled' })
      await page.getByRole('button', { name: /Analytics/i }).click()
      await expect(page.getByText('Transaction Velocity (Loaded result/page)', { exact: true })).not.toBeVisible()
      await expect(page.getByRole('button', { name: 'Export loaded CSV', exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2)
    })
  }
}
