import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, createConnection, resetBrowserState } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) test(`late Network preferences preserve the current search in ${theme}`, async ({ page, sysApi: request }) => {
  await resetBrowserState(page)
  await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
  await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
  const name = `Network search ${theme} ${Date.now()}`
  const source = await createAsset(request, { name, system: 'Preference proof' })
  const peer = await createAsset(request, { name: `Peer ${name}`, system: 'Preference proof' })
  const connection = await createConnection(request, { device_a_id: source.id, device_b_id: peer.id, source_port: 'eth0', target_port: 'eth1', link_type: 'Data', speed_gbps: 10, unit: 'Gbps', status: 'Active' })
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let captured = false
  await page.route('**/api/v1/settings/user/settings', async route => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    captured = true
    await held
    await route.fulfill({ response })
  })
  await page.goto('/network')
  const search = page.getByPlaceholder('Scan matrix...')
  try {
    await expect.poll(() => captured).toBe(true)
    await search.fill(name)
    await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(1)
    const received = page.waitForResponse(response => response.url().endsWith('/api/v1/settings/user/settings') && response.request().method() === 'GET')
    release()
    await received
    // The toolbar chip and preference write are rendered/persisted effects of
    // the search, so this also detects a late reset after the HTTP response.
    await expect(search).toHaveValue(name)
    await expect.poll(async () => {
      const settings = await (await request.get(`${apiBase}/settings/user/settings`)).json()
      return settings.network_workspace_state_v1?.uiState?.searchTerm
    }).toBe(name)
    await expect(search).toHaveValue(name)
    await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(1)
    expect(connection.id).toBeTruthy()
  } finally { release() }
})

for (const theme of ['nordic-frost-v1', 'pure-clarity']) for (const localState of ['absent', 'partial', 'malformed']) {
  test(`Network restores server preferences with ${localState} browser state in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    await resetBrowserState(page)
    await page.goto('/')
    await page.evaluate(({ theme, localState }) => {
      for (const key of Object.keys(localStorage)) if (key.startsWith('sysgrid_network_')) localStorage.removeItem(key)
      localStorage.setItem('sysgrid-theme', theme)
      if (localState === 'partial') {
        localStorage.setItem('sysgrid_network_ui_state_v1', JSON.stringify({ rowDensity: 12 }))
        localStorage.setItem('sysgrid_network_favorites_v1', '[]')
      }
      if (localState === 'malformed') {
        localStorage.setItem('sysgrid_network_ui_state_v1', '{broken')
        localStorage.setItem('sysgrid_network_views_v1', '{}')
        localStorage.setItem('sysgrid_network_favorites_v1', 'null')
        localStorage.setItem('sysgrid_network_watch_v1', '{broken')
      }
    }, { theme, localState })
    const name = `Remote Network ${theme} ${localState} ${Date.now()}`
    const source = await createAsset(request, { name, system: 'Preference restoration' })
    const peer = await createAsset(request, { name: `Peer ${name}`, system: 'Preference restoration' })
    const connection = await createConnection(request, { device_a_id: source.id, device_b_id: peer.id, source_port: 'eth0', target_port: 'eth1', link_type: 'Data', speed_gbps: 10, unit: 'Gbps', status: 'Active' })
    const viewName = `Server view ${localState}`
    const response = await request.patch(`${apiBase}/settings/user/settings`, { data: {
      theme,
      network_workspace_state_v1: {
        version: 3, savedViews: [{ id: 'server-custom', name: viewName, config: {} }], activeViewId: null,
        favoriteIds: [connection.id], watchIds: [connection.id],
        uiState: { searchTerm: name, rowDensity: 9, fontSize: 14, groupBy: 'raw', showFilterBar: true, hiddenColumns: ['created_at', 'updated_at'] },
      },
    } })
    expect(response.ok()).toBeTruthy()
    const loaded = page.waitForResponse(response => response.url().endsWith('/api/v1/settings/user/settings') && response.request().method() === 'GET')
    await page.goto('/network')
    expect((await loaded).ok()).toBeTruthy()
    await expect(page.getByPlaceholder('Scan matrix...')).toHaveValue(name)
    await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(1)
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sysgrid_network_ui_state_v1') || '{}'))).toMatchObject({
      searchTerm: name, rowDensity: localState === 'partial' ? 12 : 9, fontSize: 14,
    })
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sysgrid_network_favorites_v1') || '[]'))).toEqual(localState === 'partial' ? [] : [connection.id])
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sysgrid_network_watch_v1') || '[]'))).toEqual([connection.id])
    await page.getByRole('button', { name: 'Views', exact: true }).click()
    await expect(page.getByText(viewName, { exact: true })).toBeVisible()
    await expect.poll(async () => {
      const saved = await (await request.get(`${apiBase}/settings/user/settings`)).json()
      return saved.network_workspace_state_v1?.uiState
    }).toMatchObject({ searchTerm: name, rowDensity: localState === 'partial' ? 12 : 9, fontSize: 14 })
    await page.screenshot({ path: testInfo.outputPath(`network-restore-${localState}-${theme}.png`), fullPage: true, animations: 'disabled' })
  })
}
