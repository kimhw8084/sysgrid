import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const width of [1440, 390]) {
    test(`live permissions respect global grants in ${theme} at ${width}`, async ({ page, sysApi: request }, testInfo) => {
      await resetBrowserState(page)
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
      expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      const roles = await (await request.get(`${apiBase}/settings/roles`)).json()
      const adminRole = roles.find((role: any) => role.permissions?.all === 3)
      expect(adminRole).toBeTruthy()
      const username = `pw-global-grant-${Date.now()}`
      const created = await request.post(`${apiBase}/settings/operators`, { data: {
        external_id: username, username, full_name: 'Global grant operator', role_id: adminRole.id,
        is_admin: false, custom_permissions: { all: 1, racks: 0 },
      } })
      expect(created.ok()).toBeTruthy()
      const operator = await created.json()
      const endpoint = `/settings/operators/${operator.id}`
      let writes = 0
      page.on('request', req => { if (req.url().endsWith(endpoint) && req.method() === 'PATCH') writes++ })
      await page.goto('/settings?tab=permissions')
      await page.getByPlaceholder('Search identity, department, or team...').fill(username)
      const row = page.locator('[data-settings-tab-content="permissions"]').getByRole('row').filter({ hasText: username })
      const button = (level: string) => row.getByRole('button', { name: `racks permission for ${username}: ${level}`, exact: true })
      await expect(button('READ')).toBeVisible()
      await button('READ').scrollIntoViewIfNeeded()
      await expect(button('READ')).toHaveAccessibleDescription('Global: Read')
      expect(await button('READ').evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12)
      await expect(page.locator('[data-permission-grant-help]')).toContainText('module policy may further restrict access')
      for (const [before, after, value] of [['READ', 'WRITE', 2], ['WRITE', 'FULL', 3], ['FULL', 'READ', 1]] as const) {
        const saved = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'PATCH')
        await button(before).click()
        const response = await saved
        expect(response.ok()).toBeTruthy()
        expect(response.request().postDataJSON().custom_permissions).toEqual({ all: 1, racks: value })
        await expect(button(after)).toBeVisible()
        await expect(row.getByRole('button', { name: `racks permission for ${username}: NONE`, exact: true })).toHaveCount(0)
      }
      await button('READ').scrollIntoViewIfNeeded()
      await expect(page.locator('[data-permission-grant-help]')).toBeInViewport({ ratio: 1 })
      await page.screenshot({ path: testInfo.outputPath('global-grant-read.png'), animations: 'disabled' })
      await expectReadableGridText(page, testInfo, 'global Read grant', '[data-settings-tab-content="permissions"] table')
      expect(writes).toBe(3)
      const persisted = (await (await request.get(`${apiBase}/settings/operators`)).json()).find((item: any) => item.id === operator.id)
      expect(persisted.custom_permissions).toEqual({ all: 1, racks: 1 })

      expect((await request.patch(`${apiBase}${endpoint}`, { data: { custom_permissions: { racks: 0 } } })).ok()).toBeTruthy()
      await page.reload()
      await page.getByPlaceholder('Search identity, department, or team...').fill(username)
      const full = button('FULL')
      await expect(full).toBeDisabled()
      await full.scrollIntoViewIfNeeded()
      await expect(page.locator('[data-permission-grant-help]')).toBeInViewport({ ratio: 1 })
      await expect(full).toHaveAccessibleDescription('Global: Full')
      await full.evaluate((element: HTMLButtonElement) => element.click())
      expect(writes).toBe(3)
      await page.screenshot({ path: testInfo.outputPath('global-grant-full.png'), animations: 'disabled' })
      await expectReadableGridText(page, testInfo, 'global Full grant', '[data-settings-tab-content="permissions"] table')
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2)
      await testInfo.attach('global-grant-result', { body: JSON.stringify({ writes, customOverride: persisted.custom_permissions, roleGrant: adminRole.permissions }), contentType: 'application/json' })
    })
  }
}


for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const width of [1440, 390]) {
    test(`expanded identity sync stays readable and reachable in ${theme} at ${width}`, async ({ page, sysApi: request }, testInfo) => {
      await resetBrowserState(page)
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 })
      expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      await page.goto('/settings?tab=permissions')
      await expect(page.getByText('You', { exact: true })).toBeVisible()
      await page.getByText('You', { exact: true }).scrollIntoViewIfNeeded()
      await expectReadableGridText(page, testInfo, 'current user badge', '[data-settings-tab-content="permissions"] table')
      const toggle = page.getByRole('button', { name: /Identity Sync Pipeline/ })
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await expect(page.locator('textarea')).toBeVisible()
      await expect.poll(() => page.locator('textarea').evaluate(editor => {
        const panel = editor.closest('[data-settings-tab-content="permissions"]')!.firstElementChild!
        return editor.getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom
      })).toBe(true)
      await page.getByRole('button', { name: 'Edit Records', exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath('sync-editor.png'), animations: 'disabled' })
      await expectReadableGridText(page, testInfo, 'expanded sync editor', '[data-settings-tab-content="permissions"]')
      const editor = page.getByRole('textbox', { name: 'Identity records (JSON)', exact: true })
      await expect(editor).toHaveAttribute('readonly', '')
      await expect(page.getByText('Read-only. Choose Edit Records to edit.', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Edit Records', exact: true }).click()
      await expect(editor).toBeEditable()
      await page.getByRole('button', { name: 'Lock Records', exact: true }).click()
      await expect(editor).toHaveAttribute('readonly', '')
      const schema = page.getByText('Schema Requirements', { exact: true })
      await schema.scrollIntoViewIfNeeded()
      await expect(schema).toBeInViewport({ ratio: 1 })
      await page.getByText('Optional primary team', { exact: true }).scrollIntoViewIfNeeded()
      await expect(page.getByText('Optional primary team', { exact: true })).toBeInViewport({ ratio: 1 })
      await page.screenshot({ path: testInfo.outputPath('sync-schema.png'), animations: 'disabled' })
      await expectReadableGridText(page, testInfo, 'expanded sync schema', '[data-settings-tab-content="permissions"]')
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2)
    })

    test(`permissions remain readable and operable in ${theme} at ${width}`, async ({ page, sysApi: request }, testInfo) => {
      await resetBrowserState(page)
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 })
      expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      const username = `pw-clarity-${Date.now()}`
      const created = await request.post(`${apiBase}/settings/operators`, { data: {
        external_id: username, username, full_name: 'Readable permission operator', department: 'Engineering',
        team: 'Readability team', is_admin: false, custom_permissions: { projects: 0, racks: 1, assets: 2, services: 3 },
      } })
      expect(created.ok()).toBeTruthy()
      const operator = await created.json()
      await page.goto('/settings?tab=permissions')
      await page.getByPlaceholder('Search identity, department, or team...').fill(username)
      const permissions = page.locator('[data-settings-tab-content="permissions"]')
      const row = permissions.getByRole('row').filter({ hasText: username })
      await expect(row).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('permissions-overview.png'), animations: 'disabled' })
      await expectReadableGridText(page, testInfo, 'permissions overview', '[data-settings-tab-content="permissions"]')
      await expect(permissions.getByRole('combobox', { name: 'Sort operators', exact: true })).toBeVisible()
      const selection = row.getByRole('checkbox', { name: `Select ${username}`, exact: true })
      await expect(selection).toBeVisible()
      const admin = row.getByRole('checkbox', { name: `Admin access for ${username}`, exact: true })
      await admin.scrollIntoViewIfNeeded()
      await expect(admin).not.toBeChecked()
      const read = row.getByRole('button', { name: `racks permission for ${username}: READ`, exact: true })
      await read.scrollIntoViewIfNeeded()
      await expect(read).toBeInViewport({ ratio: 0.9 })
      const saved = page.waitForResponse(response => response.url().endsWith(`/settings/operators/${operator.id}`) && response.request().method() === 'PATCH')
      await read.click()
      expect((await saved).ok()).toBeTruthy()
      await expect(row.getByRole('button', { name: `racks permission for ${username}: WRITE`, exact: true })).toBeVisible()
      await expectReadableGridText(page, testInfo, 'permission levels', '[data-settings-tab-content="permissions"] table')
      await row.getByRole('button', { name: `services permission for ${username}: FULL`, exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath('permissions-scrolled.png'), animations: 'disabled' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2)
    })
  }
}
