import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState } from './helpers/sysgrid'

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
      const picker = panel.getByRole('button', { name: 'Choose group', exact: true })
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
