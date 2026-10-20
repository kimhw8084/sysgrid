import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createService, resetBrowserState } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const intent of ['type', 'clear']) {
    test(`late Service preferences preserve ${intent} search intent in ${theme}`, async ({ page, sysApi }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await resetBrowserState(page)
      const name = `Service search ${theme} ${intent} ${Date.now()}`
      const remoteName = `Previous ${name}`
      await createService(sysApi, { name, service_type: 'Database', status: 'Active' })
      await createService(sysApi, { name: remoteName, service_type: 'Database', status: 'Active' })
      expect((await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme,
        services_workspace_state_v1: { version: 2, activeViewId: null, savedViews: [], favoriteIds: [], watchIds: [],
          uiState: { searchTerm: remoteName, rowDensity: 8, fontSize: 11, groupBy: 'raw', showFilterBar: true } },
      } })).ok()).toBeTruthy()
      await page.addInitScript(({ theme, initialSearch }) => {
        localStorage.setItem('sysgrid-theme', theme)
        localStorage.setItem('sysgrid_services_ui_state_v1', JSON.stringify({ searchTerm: initialSearch }))
      }, { theme, initialSearch: intent === 'clear' ? name : '' })
      let release!: () => void
      const held = new Promise<void>(resolve => { release = resolve })
      let captured = false
      await page.route('**/api/v1/settings/user/settings', async route => {
        if (route.request().method() !== 'GET') return route.continue()
        const response = await route.fetch()
        expect(response.ok()).toBeTruthy()
        captured = true
        await held
        await route.fulfill({ response })
      })
      try {
        await page.goto('/services')
        const search = page.getByPlaceholder('Search services, hosts, or metadata...', { exact: true })
        await expect.poll(() => captured).toBe(true)
        const desired = intent === 'clear' ? '' : name
        await search.fill(desired)
        await expect(search).toHaveValue(desired)
        const received = page.waitForResponse(response => response.url().endsWith('/api/v1/settings/user/settings') && response.request().method() === 'GET')
        release()
        expect((await received).ok()).toBeTruthy()
        await expect.poll(async () => {
          const settings = await (await sysApi.get(`${apiBase}/settings/user/settings`)).json()
          return settings.services_workspace_state_v1?.uiState?.searchTerm
        }).toBe(desired)
        await expect(search).toHaveValue(desired)
        if (intent === 'type') {
          const chip = page.getByRole('button', { name: `Search: ${name}`, exact: true })
          await expect(chip).toBeVisible()
          await chip.scrollIntoViewIfNeeded()
          await expect(chip).toBeInViewport({ ratio: 1 })
          expect(await chip.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBeTruthy()
        }
        await page.screenshot({ path: testInfo.outputPath('service-search-intent.png'), animations: 'disabled' })
      } finally { release() }
    })
  }
}
