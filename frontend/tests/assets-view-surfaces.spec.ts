import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { fillGridSearch, resetBrowserState, seedOperationalScenario } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const desktopWidths = [1024, 1280, 1440, 1920] as const

for (const theme of ['nordic-frost-v1', 'pure-clarity'] as const) {
  test(`Asset Report and Map remain usable on desktop in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    await resetBrowserState(page)
    await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const scenario = await seedOperationalScenario(request)

    for (const width of desktopWidths) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/asset')
      await expect(page.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Grid', exact: true }).click()
      await fillGridSearch(page, 'Scan asset matrix...', scenario.primary.name)
      await expect(page.locator('[role="treegrid"]')).toContainText(scenario.primary.name)
      await fillGridSearch(page, 'Scan asset matrix...', '')
      await expect(page.getByPlaceholder('Scan asset matrix...')).toHaveValue('')
      await fillGridSearch(page, 'Scan asset matrix...', scenario.secondary.name)
      await expect(page.locator('[role="treegrid"]')).toContainText(scenario.secondary.name)
      await fillGridSearch(page, 'Scan asset matrix...', '')

      await page.getByRole('button', { name: 'Report', exact: true }).click()
      const report = page.locator('[data-asset-report]')
      await expect(report).toBeVisible()
      const reportSearch = report.getByRole('textbox', { name: 'Search report assets' })
      await reportSearch.fill(scenario.primary.name)
      const primaryEntry = report.locator('.asset-report-sidebar').getByRole('button', { name: new RegExp(scenario.primary.name) })
      await primaryEntry.click()
      await expect(report.locator('.asset-report-record-identity h1')).toHaveText(scenario.primary.name)
      await expect(report.getByRole('navigation', { name: 'Report sections' })).toBeVisible()
      await expect(report.getByRole('button', { name: 'Modify Config' })).toBeVisible()
      await expect(page.getByPlaceholder('Scan asset matrix...')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Views', exact: true })).toHaveCount(0)
      await expect(page.getByText('Registry Scope', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Register Asset', exact: true })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`asset-report-${theme}-${width}.png`), animations: 'disabled' })
      await reportSearch.fill(scenario.secondary.name)
      const secondaryEntry = report.locator('.asset-report-sidebar').getByRole('button', { name: new RegExp(scenario.secondary.name) })
      await secondaryEntry.click()
      await expect(report.locator('.asset-report-record-identity h1')).toHaveText(scenario.secondary.name)
      await expect(secondaryEntry).toHaveAttribute('aria-pressed', 'true')
      await reportSearch.fill(scenario.primary.name)
      await primaryEntry.click()
      await expect(report.locator('.asset-report-record-identity h1')).toHaveText(scenario.primary.name)
      await expect(primaryEntry).toHaveAttribute('aria-pressed', 'true')

      await page.getByRole('button', { name: 'Map', exact: true }).click()
      const map = page.locator('[data-asset-map]')
      await expect(map).toBeVisible()
      await expect(map.locator('.asset-map-sidebar')).toBeVisible()
      await expect(page.getByPlaceholder('Scan asset matrix...')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Views', exact: true })).toHaveCount(0)
      await expect(page.getByText('Registry Scope', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Register Asset', exact: true })).toBeVisible()
      const startAssets = map.locator('details').filter({ hasText: 'Starting assets' })
      await startAssets.locator('summary').click()
      const startingAsset = map.locator('.asset-map-asset-list').getByRole('button', { name: scenario.primary.name, exact: true })
      if (await startingAsset.getAttribute('aria-pressed') !== 'true') await startingAsset.click()
      await expect(startingAsset).toHaveAttribute('aria-pressed', 'true')
      await expect(startAssets.locator('summary')).toContainText('1 selected')
      await expect(map.getByRole('region', { name: 'Selected asset' })).toContainText(scenario.primary.name)
      await expect(map.getByRole('region', { name: 'Selected asset' }), 'Selected asset details must be visible without scrolling below the map').toBeInViewport()
      await expect(map.getByRole('region', { name: 'Connected assets' })).toContainText(scenario.primary.name)
      await expect(map.getByRole('region', { name: 'Connected assets' })).toBeInViewport()
      await page.screenshot({ path: testInfo.outputPath(`asset-map-${theme}-${width}.png`), animations: 'disabled' })
      await startingAsset.click()
      await expect(startingAsset).toHaveAttribute('aria-pressed', 'false')
      await expect(startAssets.locator('summary')).toContainText('0 selected')
      await expect(map.getByRole('region', { name: 'Selected asset' })).toHaveCount(0)

      const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }))
      expect(dimensions.document, `Asset ${width}px desktop view must not create document-level horizontal overflow`).toBeLessThanOrEqual(dimensions.viewport + 1)
    }
  })
}
