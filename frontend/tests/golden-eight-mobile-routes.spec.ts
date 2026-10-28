import { expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState, waitForAppIdle } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

test.describe('Golden Eight deterministic populated visual matrix', () => {
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
