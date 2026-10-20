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

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const localState of ['absent', 'partial', 'malformed', 'empty']) {
    test(`Services restore server preferences with ${localState} browser state in ${theme}`, async ({ page, sysApi }, testInfo) => {
      await resetBrowserState(page)
      await page.goto('/')
      await page.evaluate(({ theme, localState }) => {
        for (const key of Object.keys(localStorage)) if (key.startsWith('sysgrid_services_')) localStorage.removeItem(key)
        localStorage.setItem('sysgrid-theme', theme)
        if (localState === 'partial') {
          localStorage.setItem('sysgrid_services_ui_state_v1', JSON.stringify({ rowDensity: 12 }))
          localStorage.setItem('sysgrid_services_favorites_v1', '[]')
        }
        if (localState === 'malformed') {
          localStorage.setItem('sysgrid_services_ui_state_v1', '{broken')
          localStorage.setItem('sysgrid_services_views_v1', '{}')
          localStorage.setItem('sysgrid_services_favorites_v1', 'null')
          localStorage.setItem('sysgrid_services_watch_v1', '{broken')
        }
        if (localState === 'empty') {
          localStorage.setItem('sysgrid_services_ui_state_v1', JSON.stringify({ searchTerm: '' }))
          localStorage.setItem('sysgrid_services_views_v1', '[]')
          localStorage.setItem('sysgrid_services_favorites_v1', '[]')
          localStorage.setItem('sysgrid_services_watch_v1', '[]')
        }
      }, { theme, localState })
      const name = `Remote Service ${theme} ${localState} ${Date.now()}`
      const service = await createService(sysApi, { name, service_type: 'Database', status: 'Active' })
      const viewName = `Server Service view ${localState}`
      expect((await sysApi.patch(`${apiBase}/settings/user/settings`, { data: {
        theme,
        services_workspace_state_v1: {
          version: 2, savedViews: [{ id: 'server-custom', name: viewName, config: {} }], activeViewId: null,
          favoriteIds: [service.id], watchIds: [service.id],
          uiState: { searchTerm: name, rowDensity: 9, fontSize: 14, groupBy: 'raw', showFilterBar: true, hiddenColumns: ['created_at', 'updated_at'] },
        },
      } })).ok()).toBeTruthy()
      const loaded = page.waitForResponse(response => response.url().endsWith('/api/v1/settings/user/settings') && response.request().method() === 'GET')
      await page.goto('/services')
      expect((await loaded).ok()).toBeTruthy()
      const desiredSearch = localState === 'empty' ? '' : name
      await expect(page.getByPlaceholder('Search services, hosts, or metadata...', { exact: true })).toHaveValue(desiredSearch)
      if (localState !== 'empty') await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(1)
      const expectedUi = { searchTerm: desiredSearch, rowDensity: localState === 'partial' ? 12 : 9, fontSize: 14 }
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sysgrid_services_ui_state_v1') || '{}'))).toMatchObject(expectedUi)
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sysgrid_services_favorites_v1') || '[]'))).toEqual(['partial', 'empty'].includes(localState) ? [] : [service.id])
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sysgrid_services_watch_v1') || '[]'))).toEqual(localState === 'empty' ? [] : [service.id])
      await page.getByRole('button', { name: 'Views', exact: true }).click()
      if (localState === 'empty') await expect(page.getByText(viewName, { exact: true })).toHaveCount(0)
      else await expect(page.getByText(viewName, { exact: true })).toBeVisible()
      await expect.poll(async () => {
        const settings = await (await sysApi.get(`${apiBase}/settings/user/settings`)).json()
        return settings.services_workspace_state_v1?.uiState
      }).toMatchObject(expectedUi)
      await page.screenshot({ path: testInfo.outputPath(`service-restore-${localState}-${theme}.png`), animations: 'disabled' })
    })
  }
}
