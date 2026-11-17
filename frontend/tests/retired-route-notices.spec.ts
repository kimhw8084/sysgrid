import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState } from './helpers/sysgrid'
import { retiredSysGridRouteMatrix } from './helpers/routeMatrix'

const deepLinkSuffix: Record<string, string> = {
  projects: '/42/timeline',
  architecture: '?legacy=true',
  research: '?case_id=42',
  knowledge: '?device_id=42',
}

test.describe('Separate-application route notices', () => {
  test('preserves deep links and identifies every retired SysGrid workspace', async ({ page }) => {
    await resetBrowserState(page)

    for (const route of retiredSysGridRouteMatrix) {
      const suffix = deepLinkSuffix[route.moduleId]
      expect(suffix, `${route.moduleId} should have a deep-link regression case`).toBeDefined()
      const target = `${route.path}${suffix}`
      await page.goto(target)
      await expect(page.getByRole('heading', { name: `${route.name} is outside SysGrid`, exact: true })).toBeVisible()
      const notice = page.getByRole('status').filter({
        has: page.getByRole('heading', { level: 2, name: 'This workspace has been retired from SysGrid.' }),
      })
      await expect(notice).toContainText('Its backend records and API remain available for a dedicated app.')
      const location = new URL(page.url())
      expect(`${location.pathname}${location.search}`).toBe(target)
      await expect(page.locator('[data-sg-app-sidebar="true"] a').getByText(route.name, { exact: true })).toHaveCount(0)
    }
  })
})
