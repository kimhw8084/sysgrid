import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const width of [1440, 390]) {
    for (const placement of ['above', 'below']) {
      test(`Settings bulk menu ${placement} remains reachable by keyboard in ${theme} at ${width}`, async ({ page, sysApi: request }, testInfo) => {
        await resetBrowserState(page)
        await page.setViewportSize({ width, height: 1600 })
        expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
        await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
        const username = `pw-bulk-menu-${Date.now()}`
        expect((await request.post(`${apiBase}/settings/operators`, { data: {
          external_id: username, username, full_name: 'Bulk menu inspection', is_admin: false,
        } })).ok()).toBeTruthy()
        const before = await (await request.get(`${apiBase}/settings/operators`)).json()
        await page.goto('/settings?tab=permissions')
        await page.getByPlaceholder('Search identity, department, or team...').fill(username)
        const selection = page.getByRole('checkbox', { name: `Select ${username}`, exact: true })
        await selection.check()
        const trigger = page.getByRole('button', { name: 'Bulk Actions', exact: true })
        await trigger.scrollIntoViewIfNeeded()
        if (placement === 'above') {
          const anchor = (await trigger.boundingBox())!
          await page.setViewportSize({ width, height: Math.max(400, Math.ceil(anchor.y + anchor.height + 100)) })
          await trigger.scrollIntoViewIfNeeded()
        }
        const anchor = (await trigger.boundingBox())!
        const height = page.viewportSize()!.height
        expect(anchor.y > height - anchor.y - anchor.height).toBe(placement === 'above')
        await trigger.focus()
        await page.keyboard.press('Enter')
        const assign = page.getByRole('button', { name: 'Assign Group', exact: true })
        const panel = page.locator('[data-workspace-panel="true"]').filter({ has: assign })
        await expect(panel).toBeVisible()
        await expect(panel).toHaveCSS('opacity', '1')
        await expect(trigger).toHaveAttribute('aria-expanded', 'true')
        await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
        await expect(page.getByRole('dialog', { name: 'Bulk identity actions', exact: true })).toHaveAttribute('id', (await trigger.getAttribute('aria-controls'))!)
        const bounds = (await panel.boundingBox())!
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
        expect(bounds.y).toBeGreaterThanOrEqual(0)
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(height)
        if (placement === 'above') expect(bounds.y + bounds.height).toBeLessThanOrEqual(anchor.y)
        else expect(bounds.y).toBeGreaterThanOrEqual(anchor.y + anchor.height)
        await testInfo.attach('bulk-menu-geometry', { body: JSON.stringify({ theme, width, height, placement, anchor, bounds }), contentType: 'application/json' })
        await page.screenshot({ path: testInfo.outputPath('bulk-menu-open.png'), animations: 'disabled' })
        await expect(assign).toBeFocused()
        await page.keyboard.press('ArrowDown')
        await expect(page.getByRole('button', { name: 'Remove Group', exact: true })).toBeFocused()
        await page.keyboard.press('End')
        const deletion = page.getByRole('button', { name: 'Delete Selection', exact: true })
        await expect(deletion).toBeFocused()
        await expect(deletion).toBeInViewport({ ratio: 0.9 })
        await page.screenshot({ path: testInfo.outputPath('bulk-menu-last-action.png'), animations: 'disabled' })
        await page.keyboard.press('Escape')
        await expect(panel).not.toBeVisible()
        await expect(trigger).toHaveAttribute('aria-expanded', 'false')
        await expect(trigger).toBeFocused()
        await expect(selection).toBeChecked()
        await trigger.click()
        await expect(panel).toBeVisible()
        await page.getByRole('button', { name: 'Clear Selection', exact: true }).click()
        await expect(panel).not.toBeVisible()
        await expect(selection).not.toBeChecked()
        await expect(trigger).toBeDisabled()
        expect(await (await request.get(`${apiBase}/settings/operators`)).json()).toEqual(before)
      })
    }
  }
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  test(`Settings bulk group dropdown preserves nested dismissal and persistence in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    await resetBrowserState(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const username = `pw-bulk-group-${Date.now()}`
    const groupName = `Review group ${Date.now()}`
    expect((await request.post(`${apiBase}/settings/teams`, { data: { name: groupName } })).ok()).toBeTruthy()
    const created = await request.post(`${apiBase}/settings/operators`, { data: {
      external_id: username, username, full_name: 'Group popup inspection', is_admin: false, teams: [],
    } })
    expect(created.ok()).toBeTruthy()
    const operator = await created.json()
    await page.goto('/settings?tab=permissions')
    await page.getByPlaceholder('Search identity, department, or team...').fill(username)
    const selection = page.getByRole('checkbox', { name: `Select ${username}`, exact: true })
    const trigger = page.getByRole('button', { name: 'Bulk Actions', exact: true })
    for (const action of ['assign', 'remove']) {
      await selection.check()
      await trigger.click()
      const panel = page.getByRole('dialog', { name: 'Bulk identity actions', exact: true })
      await expect(panel).toBeVisible()
      await page.setViewportSize({ width: 390, height: 844 })
      await panel.getByRole('button', { name: action === 'assign' ? 'Assign Group' : 'Remove Group', exact: true }).click()
      const picker = panel.locator('button[aria-haspopup="dialog"]')
      await expect(picker).toHaveCount(1)
      await picker.click()
      const dropdown = page.locator('[data-workspace-panel="true"]').filter({ has: page.getByPlaceholder('Search options...') }).last()
      await expect(dropdown).toBeVisible()
      await dropdown.getByPlaceholder('Search options...').focus()
      await page.keyboard.press('Escape')
      await expect(dropdown).not.toBeVisible()
      await expect(panel).toBeVisible()
      await expect(picker).toBeFocused()
      await picker.click()
      await dropdown.getByRole('button', { name: groupName, exact: true }).click()
      await expect(panel).toBeVisible()
      await expect(panel.getByRole('button', { name: groupName, exact: true })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`bulk-group-${action}.png`), animations: 'disabled' })
      const persisted = page.waitForResponse(response => response.url().endsWith('/settings/operators/bulk-update') && response.request().method() === 'POST')
      await panel.getByRole('button', { name: action === 'assign' ? 'Apply Group Assignment' : 'Remove Group Membership', exact: true }).click()
      expect((await persisted).ok()).toBeTruthy()
      await expect(panel).not.toBeVisible()
      await expect(selection).not.toBeChecked()
      const saved = (await (await request.get(`${apiBase}/settings/operators`)).json()).find((row: { id: number }) => row.id === operator.id)
      expect(saved.teams).toEqual(action === 'assign' ? [groupName] : [])
      expect(saved.is_admin).toBe(false)
    }
  })
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  test(`Settings bulk actions preserve visual clarity and safe confirmation in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    await resetBrowserState(page)
    await page.setViewportSize({ width: 1440, height: 1000 })
    expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const username = `pw-bulk-clarity-${Date.now()}`
    expect((await request.post(`${apiBase}/settings/operators`, { data: {
      external_id: username, username, full_name: 'Bulk action clarity', is_admin: false,
    } })).ok()).toBeTruthy()
    const before = await (await request.get(`${apiBase}/settings/operators`)).json()
    await page.goto('/settings?tab=permissions')
    await page.getByPlaceholder('Search identity, department, or team...').fill(username)
    await page.getByRole('checkbox', { name: `Select ${username}`, exact: true }).check()
    await page.getByRole('button', { name: 'Bulk Actions', exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'Bulk identity actions', exact: true })
    await expect(panel).toBeVisible()
    await expect(panel.locator('..')).toHaveCSS('opacity', '1')
    await page.screenshot({ path: testInfo.outputPath('bulk-clarity-default.png'), animations: 'disabled' })
    await expectReadableGridText(page, testInfo, 'bulk actions default', '#settings-permission-bulk-actions')
    const fonts = await panel.locator('p').evaluateAll(labels => labels.map(label => ({ text: label.textContent, size: parseFloat(getComputedStyle(label).fontSize) })))
    await testInfo.attach('bulk-action-font-sizes', { body: JSON.stringify(fonts), contentType: 'application/json' })
    expect(fonts.every(label => label.size >= 12), 'bulk action labels must be at least 12px').toBe(true)
    await panel.getByRole('button', { name: 'Set Admin', exact: true }).hover()
    await page.screenshot({ path: testInfo.outputPath('bulk-clarity-hover.png'), animations: 'disabled' })
    await expectReadableGridText(page, testInfo, 'bulk actions hover', '#settings-permission-bulk-actions')
    await panel.getByRole('button', { name: 'Assign Group', exact: true }).click()
    await expect(panel.locator('button[aria-haspopup="dialog"]')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('bulk-clarity-expanded.png'), animations: 'disabled' })
    await expectReadableGridText(page, testInfo, 'bulk actions expanded', '#settings-permission-bulk-actions')
    await panel.getByRole('button', { name: 'Delete Selection', exact: true }).click()
    await expect(panel.getByRole('button', { name: 'Confirm Identity Deletion?', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('bulk-clarity-confirmation.png'), animations: 'disabled' })
    await expectReadableGridText(page, testInfo, 'bulk actions confirmation', '#settings-permission-bulk-actions')
    await page.keyboard.press('Escape')
    await expect(panel).not.toBeVisible()
    expect(await (await request.get(`${apiBase}/settings/operators`)).json()).toEqual(before)
  })
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const action of ['update', 'delete']) {
    for (const fail of [false, true]) {
      test(`Settings bulk ${action} guards pending departure and ${fail ? 'recovers after failure' : 'persists'} in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
        await resetBrowserState(page)
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        await page.setViewportSize({ width: 1440, height: 900 })
        expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
        await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
        const username = `pw-bulk-pending-${Date.now()}`
        const created = await request.post(`${apiBase}/settings/operators`, { data: {
          external_id: username, username, full_name: 'Pending bulk action', is_admin: false, department: 'Keep department',
        } })
        expect(created.ok()).toBeTruthy()
        const operator = await created.json()
        const before = await (await request.get(`${apiBase}/settings/operators`)).json()
        const versions = await (await request.get(`${apiBase}/settings/user-pool/versions`)).json()
        await page.goto('/settings?tab=permissions')
        await page.getByPlaceholder('Search identity, department, or team...').fill(username)
        const selection = page.getByRole('checkbox', { name: `Select ${username}`, exact: true })
        await selection.check()
        const trigger = page.getByRole('button', { name: 'Bulk Actions', exact: true })
        const panel = page.getByRole('dialog', { name: 'Bulk identity actions', exact: true })
        const start = async () => {
          await trigger.click()
          await expect(panel).toBeVisible()
          if (action === 'update') {
            await panel.getByRole('button', { name: 'Set Admin', exact: true }).click()
          } else {
            await panel.getByRole('button', { name: 'Delete Selection', exact: true }).click()
            await panel.getByRole('button', { name: 'Confirm Identity Deletion?', exact: true }).click()
            const confirmation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Delete identities', exact: true }) })
            await expect(confirmation).toBeVisible()
            await confirmation.getByRole('button', { name: 'Delete identities', exact: true }).click()
          }
        }
        let release!: () => void
        const held = new Promise<void>(resolve => { release = resolve })
        let writes = 0
        const endpoint = `/settings/operators/bulk-${action}`
        const path = `**${endpoint}`
        await page.route(path, async route => {
          writes++
          await held
          if (fail) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Controlled bulk save failure' }) })
          else await route.continue()
        })
        const navigation = page.getByRole('navigation', { name: 'Primary navigation' })
        const home = navigation.getByRole('link', { name: 'Home', exact: true })
        const settings = navigation.getByRole('link', { name: 'Settings / Access', exact: true })
        try {
          await start()
          await expect.poll(() => writes).toBe(1)
          const unloadPrevented = await page.evaluate(() => {
            const event = new Event('beforeunload', { cancelable: true })
            window.dispatchEvent(event)
            return event.defaultPrevented
          })
          const pendingNotice = await page.getByRole('status').filter({ hasText: 'Saving bulk identity changes' }).count()
          await testInfo.attach('bulk-pending-state', { body: JSON.stringify({ action, fail, writes, unloadPrevented, pendingNotice }), contentType: 'application/json' })
          expect.soft(unloadPrevented).toBe(true)
          expect.soft(pendingNotice).toBe(1)
          await page.screenshot({ path: testInfo.outputPath('bulk-write-pending.png'), animations: 'disabled' })
          await home.click()
          expect(new URL(page.url()).pathname).toBe('/settings')
          await expect(settings).toHaveAttribute('aria-current', 'page')
          await expect(home).not.toHaveAttribute('aria-current', 'page')
          await expect(selection).toBeDisabled()
          // An exiting AnimatePresence panel can still be visible after its
          // trigger closes. Wait for that lifecycle to finish, then reopen it.
          await expect(trigger).toHaveAttribute('aria-expanded', 'false')
          await expect(panel).not.toBeVisible()
          await trigger.click()
          await expect(trigger).toHaveAttribute('aria-expanded', 'true')
          await expect(panel).toBeVisible()
          await expect(panel.getByRole('button', { name: 'Set Admin', exact: true })).toBeDisabled()
          await expect(panel.getByRole('button', { name: 'Unset Admin', exact: true })).toBeDisabled()
          await expect(panel.getByRole('button', { name: 'Clear Selection', exact: true })).toBeDisabled()
          await expect(panel.getByRole('button', { name: /^(Delete Selection|Confirm Identity Deletion\?)$/ })).toBeDisabled()
          // Native disabled controls must not start another write or clear the selected identities.
          await panel.getByRole('button', { name: 'Set Admin', exact: true }).evaluate((button: HTMLButtonElement) => button.click())
          await panel.getByRole('button', { name: 'Clear Selection', exact: true }).evaluate((button: HTMLButtonElement) => button.click())
          expect(writes).toBe(1)
          await expect(selection).toBeChecked()
        } finally { release() }
        await expect(page.getByRole('status').filter({ hasText: 'Saving bulk identity changes' })).toHaveCount(0)
        await page.unroute(path)
        if (fail) {
          await expect(page.getByRole('alert').filter({ hasText: 'Controlled bulk save failure' })).toBeVisible()
          await expect(selection).toBeChecked()
          await expect(selection).toBeEnabled()
          expect(await (await request.get(`${apiBase}/settings/operators`)).json()).toEqual(before)
          expect(await (await request.get(`${apiBase}/settings/user-pool/versions`)).json()).toEqual(versions)
          await page.screenshot({ path: testInfo.outputPath('bulk-write-recovery.png'), animations: 'disabled' })
          if (await panel.isVisible()) await page.keyboard.press('Escape')
          const saved = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST')
          await start()
          expect((await saved).ok()).toBeTruthy()
        }
        await expect(panel).not.toBeVisible()
        const saved = (await (await request.get(`${apiBase}/settings/operators`)).json()).find((row: { id: number }) => row.id === operator.id)
        if (action === 'update') {
          expect(saved).toMatchObject({ is_admin: true, full_name: 'Pending bulk action', department: 'Keep department' })
          await expect(selection).not.toBeChecked()
        } else {
          expect(saved).toBeUndefined()
          await expect(selection).toHaveCount(0)
        }
        const afterVersions = await (await request.get(`${apiBase}/settings/user-pool/versions`)).json()
        expect(afterVersions).toHaveLength(versions.length + 1)
        await home.click()
        await expect(page).toHaveURL(/\/$/)
      })
    }
  }
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  test(`Settings bulk cancellation releases guards and successful writes await refreshed state in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    await resetBrowserState(page)
    expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const username = `pw-bulk-refresh-${Date.now()}`
    const created = await request.post(`${apiBase}/settings/operators`, { data: { external_id: username, username, is_admin: false } })
    expect(created.ok()).toBeTruthy()
    const operator = await created.json()
    const before = await (await request.get(`${apiBase}/settings/operators`)).json()
    const versions = await (await request.get(`${apiBase}/settings/user-pool/versions`)).json()
    await page.goto('/settings?tab=permissions')
    await page.getByPlaceholder('Search identity, department, or team...').fill(username)
    const selection = page.getByRole('checkbox', { name: `Select ${username}`, exact: true })
    const trigger = page.getByRole('button', { name: 'Bulk Actions', exact: true })
    const panel = page.getByRole('dialog', { name: 'Bulk identity actions', exact: true })
    await selection.check()
    await trigger.click()
    await panel.getByRole('button', { name: 'Delete Selection', exact: true }).click()
    await panel.getByRole('button', { name: 'Confirm Identity Deletion?', exact: true }).click()
    const confirmation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Delete identities', exact: true }) })
    await expect(confirmation).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Review the identity deletion' })).toBeVisible()
    const guarded = () => page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })
    expect(await guarded()).toBe(true)
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(confirmation).not.toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Review the identity deletion' })).toHaveCount(0)
    expect(await guarded()).toBe(false)
    await expect(selection).toBeChecked()
    expect(await (await request.get(`${apiBase}/settings/operators`)).json()).toEqual(before)
    expect(await (await request.get(`${apiBase}/settings/user-pool/versions`)).json()).toEqual(versions)
    const home = page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Home', exact: true })
    await home.click()
    await expect(page).toHaveURL(/\/$/)
    await page.goto('/settings?tab=permissions')
    await page.getByPlaceholder('Search identity, department, or team...').fill(username)
    await selection.check()

    let writes = 0
    let refreshes = 0
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    page.on('request', req => { if (req.url().endsWith('/settings/operators/bulk-update') && req.method() === 'POST') writes++ })
    await page.route('**/settings/operators', async route => {
      if (route.request().method() === 'GET' && writes > 0) {
        refreshes++
        await held
      }
      await route.continue()
    })
    const saved = page.waitForResponse(response => response.url().endsWith('/settings/operators/bulk-update') && response.request().method() === 'POST')
    try {
      await trigger.click()
      await panel.getByRole('button', { name: 'Set Admin', exact: true }).click()
      expect((await saved).ok()).toBeTruthy()
      await expect.poll(() => refreshes).toBe(1)
      await expect(page.getByRole('status').filter({ hasText: 'Saving bulk identity changes' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Switch tenant', exact: true })).toBeDisabled()
      await expect(selection).toBeDisabled()
      expect(await guarded()).toBe(true)
      await home.click()
      expect(new URL(page.url()).pathname).toBe('/settings')
      await page.screenshot({ path: testInfo.outputPath('bulk-refresh-pending.png'), animations: 'disabled' })
      expect(writes).toBe(1)
    } finally { release() }
    await expect(page.getByRole('status').filter({ hasText: 'Saving bulk identity changes' })).toHaveCount(0)
    await expect(selection).not.toBeChecked()
    await expect(page.getByRole('button', { name: 'Switch tenant', exact: true })).toBeEnabled()
    expect(await guarded()).toBe(false)
    expect((await (await request.get(`${apiBase}/settings/operators`)).json()).find((row: { id: number }) => row.id === operator.id).is_admin).toBe(true)
    expect(await (await request.get(`${apiBase}/settings/user-pool/versions`)).json()).toHaveLength(versions.length + 1)
    await home.click()
    await expect(page).toHaveURL(/\/$/)
  })
}
