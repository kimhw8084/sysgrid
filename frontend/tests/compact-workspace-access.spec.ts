import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState, seedOperationalScenario } from './helpers/sysgrid'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const width of [320, 390, 960]) {
    test(`compact workspace access ${theme} ${width}`, async ({ page, sysApi: request }, testInfo) => {
      await page.setViewportSize({ width, height: 720 })
      await resetBrowserState(page)
      await seedOperationalScenario(request)
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      const preference = await request.patch(`${process.env.PW_API_BASE}/settings/user/settings`, { data: { theme } })
      expect(preference.ok()).toBeTruthy()
      for (const route of [
        { path: '/monitoring', name: 'Monitoring' },
        { path: '/asset', name: 'Assets' },
        { path: '/services', name: 'Services' },
        { path: '/network', name: 'Network' },
      ]) {
        await page.goto(route.path)
        await expect(page.getByRole('heading', { name: route.name, exact: true })).toBeVisible()
        await page.waitForLoadState('networkidle')
        if (width < 768) {
          const menu = page.getByRole('button', { name: 'Open application navigation', exact: true })
          await expect(menu).toBeVisible()
          await menu.click()
          const nav = page.locator('[data-sg-app-sidebar]')
          await expect(nav).toBeVisible()
          await expect(nav.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
          await expect(page.locator('[data-sg-app-main]')).toHaveJSProperty('inert', true)
          const firstControl = nav.locator('a[href],button:not(:disabled)').first()
          await expect(firstControl).toBeFocused()
          await page.keyboard.press('Shift+Tab')
          await expect(nav.locator('a[href],button:not(:disabled)').last()).toBeFocused()
          await page.keyboard.press('Tab')
          await expect(firstControl).toBeFocused()
          await page.keyboard.press('Escape')
          await expect(nav).not.toBeVisible()
          await expect(menu).toBeFocused()
          await expect(page.locator('[data-sg-app-main]')).toHaveJSProperty('inert', false)
          const header = await page.locator('[data-sg-shell-header]').boundingBox()
          expect(header!.height).toBeLessThanOrEqual(180)
          await expect(page.getByRole('button', { name: 'Switch tenant', exact: true })).toBeVisible()
          if (route.path === '/monitoring') {
            await menu.click()
            await nav.getByRole('link', { name: 'Home', exact: true }).click()
            await expect(page).toHaveURL(/\/$/)
            await expect(nav).not.toBeVisible()
            await expect(page.locator('[data-sg-app-main]')).toHaveJSProperty('inert', false)
            await page.goto(route.path)
            await expect(page.getByRole('heading', { name: route.name, exact: true })).toBeVisible()
          }
        }
        const main = page.locator('#sg-main-content')
        expect(await main.evaluate(node => getComputedStyle(node).overflowY)).toMatch(/auto|scroll/)
        const workspace = page.locator('[data-golden-workspace-shell]')
        await expect(workspace.getByRole('button', { name: 'Views', exact: true })).toBeVisible()
        await expect(workspace.getByRole('button', { name: 'Display', exact: true })).toBeVisible()
        for (const toolbar of await workspace.locator('[data-golden-page-toolbar]').all()) {
          const bounds = await toolbar.boundingBox()
          for (const button of await toolbar.getByRole('button').all()) {
            const box = await button.boundingBox()
            if (!box) continue
            expect(box.x).toBeGreaterThanOrEqual(bounds!.x - 1)
            expect(box.x + box.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1)
          }
        }
        // Real wheel input must reach records without programmatically scrolling a hidden ancestor.
        await main.hover()
        await page.mouse.wheel(0, 1000)
        await expect(workspace.locator('[data-golden-grid-surface]').first()).toBeInViewport()
        const geometry = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          scrollTop: document.querySelector('#sg-main-content')!.scrollTop,
        }))
        expect(geometry.overflow).toBeLessThanOrEqual(2)
        await testInfo.attach(`${route.name}-geometry`, { body: JSON.stringify(geometry), contentType: 'application/json' })
        await page.screenshot({ path: testInfo.outputPath(`${route.name}-records.png`), animations: 'disabled' })
      }
    })
  }
}
