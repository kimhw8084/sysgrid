import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  test(`permission saves refresh the current user's profile in ${theme}`, async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const profileResponse = await request.get(`${apiBase}/settings/user/profile`)
    expect(profileResponse.ok()).toBeTruthy()
    const profile = await profileResponse.json()
    const operatorsResponse = await request.get(`${apiBase}/settings/operators`)
    expect(operatorsResponse.ok()).toBeTruthy()
    const operator = (await operatorsResponse.json()).find((item: any) => item.id === profile.id)
    expect(operator).toBeTruthy()
    const original = { is_admin: operator.is_admin, custom_permissions: operator.custom_permissions }
    try {
      expect((await request.patch(`${apiBase}/settings/operators/${operator.id}`, { data: {
        is_admin: false, custom_permissions: { ...operator.custom_permissions, all: 0, settings: 3, racks: 0 },
      } })).ok()).toBeTruthy()
      await page.goto('/settings?tab=permissions')
      await page.getByPlaceholder('Search identity, department, or team...').fill(operator.username)
      const saved = page.waitForResponse(response => response.url().endsWith(`/settings/operators/${operator.id}`) && response.request().method() === 'PATCH')
      const refreshed = page.waitForResponse(response => response.url().endsWith('/settings/user/profile') && response.request().method() === 'GET')
      await page.getByRole('button', { name: `racks permission for ${operator.username}: NONE`, exact: true }).click()
      expect((await saved).ok()).toBeTruthy()
      const result = await refreshed
      expect(result.ok()).toBeTruthy()
      expect((await result.json()).permissions.racks).toBe(1)
    } finally {
      expect((await request.patch(`${apiBase}/settings/operators/${operator.id}`, { data: original })).ok()).toBeTruthy()
    }
  })

  test(`queued permission edits preserve independent user details in ${theme}`, async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const username = `pw-intent-${Date.now()}`
    const created = await request.post(`${apiBase}/settings/operators`, { data: {
      external_id: username, username, full_name: 'Original user name', department: 'Original department',
      is_admin: false, custom_permissions: { racks: 0, assets: 1 },
      team: 'Directory managed team', team_source: 'synced',
    } })
    expect(created.ok()).toBeTruthy()
    const operator = await created.json()
    const now = Date.now()
    await page.clock.install({ time: now })
    await page.goto('/settings?tab=permissions')
    await page.getByPlaceholder('Search identity, department, or team...').fill(username)
    const permission = page.getByRole('button', { name: `racks permission for ${username}: NONE`, exact: true })
    await expect(permission).toBeVisible()
    await page.clock.pauseAt(now + 60_000)
    try {
      await permission.click()
      const independentlyChanged = { full_name: 'Updated independently', department: 'New department', is_admin: true }
      const changed = await request.patch(`${apiBase}/settings/operators/${operator.id}`, { data: independentlyChanged })
      expect(changed.ok()).toBeTruthy()
      const saved = page.waitForResponse(response => response.url().endsWith(`/settings/operators/${operator.id}`) && response.request().method() === 'PATCH')
      await page.clock.runFor(900)
      const result = await saved
      expect(result.ok()).toBeTruthy()
      const persisted = await request.get(`${apiBase}/settings/operators`)
      expect(persisted.ok()).toBeTruthy()
      const row = (await persisted.json()).find((item: any) => item.id === operator.id)
      expect(row).toMatchObject({
        ...independentlyChanged, custom_permissions: { racks: 1, assets: 1 },
        team: 'Directory managed team', team_source: 'synced',
      })
      expect(result.request().postDataJSON()).toEqual({ id: operator.id, custom_permissions: { racks: 1, assets: 1 } })
    } finally {
      await page.clock.resume()
    }
  })

  for (const fail of [false, true]) {
    test(`queued permissions protect departure and ${fail ? 'recover from failure' : 'persist'} in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
      await resetBrowserState(page)
      await page.setViewportSize({ width: 1440, height: 900 })
      expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      const username = `pw-pending-${Date.now()}`
      const created = await request.post(`${apiBase}/settings/operators`, { data: {
        external_id: username, username, full_name: 'Pending permission operator', is_admin: false,
        custom_permissions: { racks: 0 },
      } })
      expect(created.ok()).toBeTruthy()
      const operator = await created.json()
      const now = Date.now()
      await page.clock.install({ time: now })
      await page.goto('/settings?tab=permissions')
      await page.getByPlaceholder('Search identity, department, or team...').fill(username)
      const permission = (level: string) => page.getByRole('button', { name: `racks permission for ${username}: ${level}`, exact: true })
      await expect(permission('NONE')).toBeVisible()
      await page.clock.pauseAt(now + 60_000)
      let release!: () => void
      const held = new Promise<void>(resolve => { release = resolve })
      let writes = 0
      const path = `**/api/v1/settings/operators/${operator.id}`
      await page.route(path, async route => {
        if (route.request().method() !== 'PATCH') return route.continue()
        writes++
        await held
        if (fail) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Controlled permission save failure' }) })
        else await route.continue()
      })
      const home = page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Home', exact: true })
      try {
        await permission('NONE').click()
        await home.click()
        expect(new URL(page.url()).pathname).toBe('/settings')
        await expect(page.getByRole('status').filter({ hasText: 'Saving permission changes' })).toBeVisible()
        expect(writes).toBe(0)
        expect(await page.evaluate(() => {
          const event = new Event('beforeunload', { cancelable: true })
          window.dispatchEvent(event)
          return event.defaultPrevented
        })).toBe(true)
        await permission('READ').click()
        await page.clock.runFor(900)
        await expect.poll(() => writes).toBe(1)
        await home.click()
        expect(new URL(page.url()).pathname).toBe('/settings')
        await page.screenshot({ path: testInfo.outputPath('permission-save-pending.png'), animations: 'disabled' })
      } finally {
        release()
        await page.clock.resume()
      }
      await expect(page.getByRole('status').filter({ hasText: 'Saving permission changes' })).toHaveCount(0)
      await page.unroute(path)
      if (fail) {
        await expect(permission('NONE')).toBeVisible()
        await expect(page.getByText('Controlled permission save failure', { exact: true })).toBeVisible()
        const saved = page.waitForResponse(response => response.url().endsWith(`/settings/operators/${operator.id}`) && response.request().method() === 'PATCH')
        await permission('NONE').click()
        expect((await saved).ok()).toBeTruthy()
      }
      const operators = await request.get(`${apiBase}/settings/operators`)
      expect(operators.ok()).toBeTruthy()
      expect((await operators.json()).find((row: any) => row.id === operator.id).custom_permissions.racks).toBe(fail ? 1 : 2)
      await home.click()
      await expect(page).toHaveURL(/\/$/)
    })
  }
}
