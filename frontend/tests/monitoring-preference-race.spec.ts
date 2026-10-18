import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createMonitoring, resetBrowserState } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const intent of ['type', 'clear']) {
    test(`late Monitoring preferences preserve ${intent} search intent in ${theme}`, async ({ page, sysApi }, testInfo) => {
      await resetBrowserState(page)
      const name = `Monitor search ${theme} ${intent} ${Date.now()}`
      const remoteName = `Previous ${name}`
      await createMonitoring(sysApi, { title: name, category: 'Hardware', status: 'Existing' })
      await createMonitoring(sysApi, { title: remoteName, category: 'Hardware', status: 'Existing' })
      expect((await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme,
        monitoring_workspace_state_v2: { version: 2, activeViewId: null, favoriteIds: [], watchIds: [],
          uiState: { searchTerm: remoteName, rowDensity: 8, fontSize: 11, groupBy: 'raw', showFilterBar: true } },
      } })).ok()).toBeTruthy()
      await page.addInitScript(({ theme, initialSearch }) => {
        localStorage.setItem('sysgrid-theme', theme)
        localStorage.setItem('sysgrid_monitoring_ui_state_v1', JSON.stringify({ searchTerm: initialSearch }))
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
        await page.goto('/monitoring')
        const search = page.getByPlaceholder('Scan matrix...', { exact: true })
        await expect.poll(() => captured).toBe(true)
        const desired = intent === 'clear' ? '' : name
        await search.fill(desired)
        await expect(search).toHaveValue(desired)
        const received = page.waitForResponse(response => response.url().endsWith('/api/v1/settings/user/settings') && response.request().method() === 'GET')
        release()
        expect((await received).ok()).toBeTruthy()
        await expect.poll(async () => {
          const settings = await (await sysApi.get(`${apiBase}/settings/user/settings`)).json()
          return settings.monitoring_workspace_state_v2?.uiState?.searchTerm
        }).toBe(desired)
        await expect(search).toHaveValue(desired)
        if (intent === 'type') await expect(page.getByRole('button', { name: `Search: ${name}`, exact: true })).toBeVisible()
        await page.screenshot({ path: testInfo.outputPath('monitoring-search-intent.png'), animations: 'disabled' })
      } finally { release() }
    })
  }
}
