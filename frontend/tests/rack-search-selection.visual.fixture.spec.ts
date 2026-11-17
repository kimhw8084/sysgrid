import { expect, test } from '@playwright/test'

const userId = 'golden.rack.fixture'
const tenantId = '1'
const fixtureSite = { id: 31, name: 'North Data Hall', color: '#034EA2' }
const fixtureRack = {
  id: 71,
  name: 'DC1-RACK-A01',
  site_id: fixtureSite.id,
  site_name: fixtureSite.name,
  site_color: fixtureSite.color,
  aisle: 'A1',
  row: '03',
  total_u: 42,
  max_power_kw: 12,
  pdu_a_name: 'PDU-A',
  pdu_b_name: 'PDU-B',
  pdu_a_cap_kw: 12,
  pdu_b_cap_kw: 12,
  is_deleted: false,
  device_locations: [{
    device_id: 501,
    start_unit: 20,
    size_u: 2,
    orientation: 'Front',
    depth: 'Full',
    device: {
      id: 501,
      name: 'Payment API Host',
      type: 'Server',
      status: 'Active',
      system: 'Billing Platform',
      power_typical_w: 350,
    },
  }],
}
const sameLocationRack = {
  ...fixtureRack,
  id: 72,
  name: 'DC1-RACK-A02',
  device_locations: [],
}
const fixtureDevice = {
  id: 501,
  name: 'Payment API Host',
  system: 'Billing Platform',
  serial_number: 'SN-GOLD-5001',
  asset_tag: 'SYS-02501',
  manufacturer: 'Dell',
  model: 'PowerEdge R760',
  type: 'Server',
  status: 'Active',
  power_typical_w: 350,
  power_max_w: 550,
  size_u: 2,
  is_deleted: false,
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  test(`Rack search and spatial handoff render and work in ${theme}`, async ({ page, browser }, testInfo) => {
    const localOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173').origin
    const apiOrigin = new URL(process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1').origin
    const unmockedRequests: string[] = []
    const attemptedWrites: string[] = []
    const nonCanonicalPaths: string[] = []
    const rackListRequests: string[] = []
    let deviceRecordsLoaded = false
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.addInitScript(({ user, tenant, selectedTheme }) => {
      localStorage.setItem('SYSGRID_USER_ID', user)
      localStorage.setItem('SYSGRID_TENANT_ID', tenant)
      localStorage.setItem('sysgrid-theme', selectedTheme)
    }, { user: userId, tenant: tenantId, selectedTheme: theme })

    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      const method = route.request().method().toUpperCase()
      const headers = {
        'access-control-allow-origin': localOrigin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'content-type, x-user-id, x-tenant-id, authorization',
      }

      if (url.origin === localOrigin && !url.pathname.startsWith('/api/v1/')) {
        await route.continue()
        return
      }
      if (url.origin !== localOrigin && url.origin !== apiOrigin) {
        unmockedRequests.push(`${method} ${url.origin}${url.pathname}`)
        await route.abort('blockedbyclient')
        return
      }
      if (url.pathname.startsWith('/api/v1/')) {
        if (method === 'OPTIONS') {
          await route.fulfill({ status: 204, headers })
          return
        }
        if (method !== 'GET') {
          attemptedWrites.push(`${method} ${url.pathname}`)
          await route.fulfill({ status: 403, headers, contentType: 'application/json', body: JSON.stringify({ detail: 'Fixture is read-only.' }) })
          return
        }

        if (['/api/v1/racks/', '/api/v1/sites/', '/api/v1/devices/'].includes(url.pathname)) {
          nonCanonicalPaths.push(`${url.pathname}${url.search}`)
          await route.fulfill({ status: 404, headers, contentType: 'application/json', body: JSON.stringify({ detail: 'Not Found' }) })
          return
        }

        let body: unknown = []
        if (url.pathname === '/api/v1/settings/bootstrap') {
          body = { VITE_API_BASE_URL: apiOrigin, DEFAULT_USER_ID: userId, VITE_APP_TITLE: 'SysGrid Fixture' }
        } else if (url.pathname === '/api/v1/tenants/me') {
          body = [{ id: Number(tenantId), name: 'Synthetic Rack Review', is_selected: true }]
        } else if (url.pathname === '/api/v1/policy/module-availability') {
          body = {
            identity: { user_id: userId, tenant_id: Number(tenantId), authenticated: true, tenant_admin: false, system_root: false },
            actions: {},
            modules: { racks: { module_id: 'racks', label: 'Racks', stage: 'released', available: true, blocked_reason: null } },
          }
        } else if (url.pathname === '/api/v1/settings/user/profile') {
          body = { username: userId, display_name: 'Synthetic Rack Reviewer' }
        } else if (url.pathname === '/api/v1/settings/user/settings') {
          body = { theme }
        } else if (url.pathname === '/api/v1/racks') {
          rackListRequests.push(`${url.pathname}${url.search}`)
          body = [fixtureRack, sameLocationRack]
        } else if (url.pathname === '/api/v1/devices') {
          deviceRecordsLoaded = true
          body = [fixtureDevice]
        } else if (url.pathname === '/api/v1/sites') {
          body = [fixtureSite]
        } else if (url.pathname === '/api/v1/networks/connections') {
          body = []
        } else if (url.pathname === '/api/v1/racks/plans' || url.pathname === '/api/v1/racks/audit-logs') {
          body = []
        }
        await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) })
        return
      }
      await route.continue()
    })

    await page.goto('/racks')
    await expect(page.getByRole('heading', { name: 'Racks', exact: true })).toBeVisible()
    await testInfo.attach('browser-runtime.json', {
      body: JSON.stringify({ browser: browser.browserType().name(), version: browser.version(), theme, viewport: { width: 1440, height: 900 }, data: 'synthetic read-only route fixtures' }, null, 2),
      contentType: 'application/json',
    })
    await expect.poll(() => deviceRecordsLoaded).toBe(true)
    const search = page.getByRole('textbox', { name: 'Search racks, locations, systems, asset tags, and serial numbers' })
    const rackCard = page.locator(`.glass-panel[data-rack-elevation-card="true"][data-rack-id="${fixtureRack.id}"]`)
    const sameLocationCard = page.locator(`.glass-panel[data-rack-elevation-card="true"][data-rack-id="${sameLocationRack.id}"]`)

    for (const value of ['SN-GOLD-5001', 'SYS-02501', 'Billing Platform', 'R760']) {
      await search.fill(value)
      await expect(rackCard).toBeVisible()
      const matchingUnits = rackCard.locator('.rack-unit[data-device-id="501"]')
      await expect(matchingUnits).toHaveCount(2)
      await expect(matchingUnits.nth(0)).toHaveAttribute('data-rack-match', 'true')
      await expect(matchingUnits.nth(1)).toHaveAttribute('data-rack-match', 'true')
      await expect(page.getByRole('status').filter({ hasText: '1 rack match the current filters' })).toBeVisible()
    }
    await search.fill('UNMOUNTED-SECRET')
    await expect(rackCard).not.toBeVisible()
    await expect(page.getByText('No racks match "UNMOUNTED-SECRET"', { exact: true })).toBeVisible()

    await search.fill('')
    const siteFilter = page.getByRole('button', { name: `Filter racks by site ${fixtureSite.name}`, exact: true })
    await expect(siteFilter).toHaveAttribute('aria-pressed', 'false')
    await siteFilter.click()
    await expect(siteFilter).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Tab')
    const siteActions = page.getByRole('button', { name: `Site actions for ${fixtureSite.name}`, exact: true })
    await expect(siteActions).toBeFocused()
    await expect.poll(() => siteActions.evaluate(button => getComputedStyle(button).opacity)).toBe('1')
    await expect.poll(() => siteActions.evaluate(button => getComputedStyle(button).outlineStyle)).not.toBe('none')

    await page.getByRole('button', { name: 'Spatial', exact: true }).click()
    const spatialRack = page.getByRole('button', { name: new RegExp(`^Rack ${sameLocationRack.name}; site ${fixtureSite.name}; aisle ${fixtureRack.aisle}; row ${fixtureRack.row};`) })
    await expect(spatialRack).toBeVisible()
    await spatialRack.click()
    await expect(sameLocationCard).toBeVisible()
    await expect(sameLocationCard.locator('input[type="checkbox"][aria-label^="Select rack "]')).toBeFocused()
    await expect(siteFilter).toHaveAttribute('aria-pressed', 'true')

    await page.keyboard.press('Space')
    await expect(page.getByText('1 selected', { exact: true })).toBeVisible()
    await search.fill('not a mounted rack')
    await expect(page.getByText('1 hidden by current filters', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Clear rack search' }).click()
    await expect(search).toBeFocused()
    await expect(rackCard).toBeVisible()
    await expect(page.getByText('1 hidden by current filters', { exact: true })).not.toBeVisible()

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(2)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await page.screenshot({ path: testInfo.outputPath(`rack-search-selection-${theme}.png`), fullPage: true, animations: 'disabled' })
    expect(rackListRequests).toContain('/api/v1/racks?include_deleted=true')
    const slashProbeStatuses = await page.evaluate(async ({ apiOrigin, paths, user, tenant }) => {
      const statuses: number[] = []
      for (const path of paths) {
        const response = await fetch(`${apiOrigin}${path}`, { headers: { 'x-user-id': user, 'x-tenant-id': tenant } })
        statuses.push(response.status)
      }
      return statuses
    }, { apiOrigin, paths: ['/api/v1/racks/', '/api/v1/sites/', '/api/v1/devices/'], user: userId, tenant: tenantId })
    expect(slashProbeStatuses).toEqual([404, 404, 404])
    expect(nonCanonicalPaths).toEqual(['/api/v1/racks/', '/api/v1/sites/', '/api/v1/devices/'])
    expect(attemptedWrites).toEqual([])
    expect(unmockedRequests).toEqual([])
  })
}
