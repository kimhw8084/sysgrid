import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

async function prepareHistory(request: any) {
  const username = `pw-permission-history-${Date.now()}`
  const original = { external_id: username, username, full_name: 'Original history identity',
    department: 'Original department', email: 'history@example.com', is_admin: false,
    custom_permissions: { assets: 1, settings: 1 }, team: 'Original history team' }
  const created = await request.post(`${apiBase}/settings/operators`, { data: original })
  expect(created.ok()).toBeTruthy()
  const operator = await created.json()
  const previous = await (await request.get(`${apiBase}/settings/user-pool/versions`)).json()
  expect((await request.patch(`${apiBase}/settings/operators/${operator.id}`, { data: {
    full_name: 'Updated history identity', department: 'Updated department', email: 'updated@example.com',
    is_admin: true, team: 'Updated history team',
  } })).ok()).toBeTruthy()
  const current = await (await request.get(`${apiBase}/settings/user-pool/versions`)).json()
  expect(current).toHaveLength(previous.length + 1)
  return { operator, original, source: previous[0], sourceNumber: previous.length, latestNumber: current.length }
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const width of [1440, 390]) {
    test(`permission history remains readable and reachable in ${theme} at ${width}`, async ({ page, sysApi: request }, testInfo) => {
      await resetBrowserState(page)
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
      expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      const data = await prepareHistory(request)
      await page.goto('/settings?tab=permissions')
      const trigger = page.getByRole('button', { name: 'Revision History', exact: true })
      await trigger.click()
      const history = page.getByRole('dialog', { name: 'Permission Registry History', exact: true })
      await expect(history).toBeVisible()
      await expect(history.locator(':scope > .glass-panel')).toHaveCSS('opacity', '1')
      await expect(history.getByText('Updated history identity', { exact: true })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('permission-history-overview.png'), animations: 'disabled' })
      expect.soft(await history.locator('button button').count(), 'revision selection and Restore must be separate controls').toBe(0)
      const fonts = await history.locator('[data-workspace-history]').evaluate(element => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        const samples = []
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement!
          const bounds = parent.getBoundingClientRect()
          if (!node.textContent?.trim() || !bounds.width || !bounds.height || bounds.bottom <= 0 || bounds.top >= innerHeight) continue
          samples.push({ text: node.textContent.trim(), size: parseFloat(getComputedStyle(parent).fontSize) })
        }
        return samples
      })
      await testInfo.attach('permission-history-fonts', { body: JSON.stringify(fonts), contentType: 'application/json' })
      expect.soft(fonts.filter(sample => sample.size < 12), 'history text must be at least 12px').toEqual([])
      await expectReadableGridText(page, testInfo, 'permission history overview', '[data-workspace-history]')
      const older = history.getByRole('button', { name: `Select revision ${data.sourceNumber}`, exact: true })
      await older.focus()
      await page.keyboard.press('Enter')
      await expect(older).toHaveAttribute('aria-pressed', 'true')
      await expect(history.getByRole('button', { name: `Select revision ${data.latestNumber}`, exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expect(history.getByText('Comparison Mode', { exact: true })).toBeVisible()
      const row = history.getByRole('row').filter({ hasText: 'Updated history identity' })
      const changes = row.getByRole('cell').last().locator(':scope > div > div')
      expect(await changes.count()).toBeGreaterThan(1)
      for (const change of [changes.first(), changes.last()]) {
        await change.scrollIntoViewIfNeeded()
        await expect(change).toBeInViewport({ ratio: 0.9 })
      }
      const bounds = await history.locator('[data-workspace-modal-body]').evaluate(element => ({
        client: element.clientWidth, scroll: element.scrollWidth,
      }))
      expect(bounds.scroll - bounds.client).toBeLessThanOrEqual(1)
      await testInfo.attach('permission-history-body-width', { body: JSON.stringify(bounds), contentType: 'application/json' })
      await page.screenshot({ path: testInfo.outputPath('permission-history-comparison.png'), animations: 'disabled' })
      await expectReadableGridText(page, testInfo, 'permission history comparison', '[data-workspace-history]')
      await history.getByRole('button', { name: 'Exit Comparison', exact: true }).click()
      await expect(history.getByText('Latest Revision Delta', { exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(history).not.toBeVisible()
      await expect(trigger).toBeFocused()
    })
  }
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const fail of [false, true]) {
    test(`permission history restore confirms scope, guards pending state and ${fail ? 'recovers after failure' : 'persists'} in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
      await resetBrowserState(page)
      await page.setViewportSize({ width: 1440, height: 1000 })
      expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      const data = await prepareHistory(request)
      const before = await (await request.get(`${apiBase}/settings/operators`)).json()
      const versions = await (await request.get(`${apiBase}/settings/user-pool/versions`)).json()
      await page.goto('/settings?tab=permissions')
      const trigger = page.getByRole('button', { name: 'Revision History', exact: true })
      await trigger.click()
      const history = page.getByRole('dialog', { name: 'Permission Registry History', exact: true })
      const restore = history.getByRole('button', { name: `Restore identity revision ${data.sourceNumber}`, exact: true })
      const confirmation = page.getByRole('dialog', { name: 'Restore identity revision?', exact: true })
      let writes = 0
      const endpoint = `/settings/user-pool/restore/${data.source.id}`
      page.on('request', req => { if (req.url().endsWith(endpoint) && req.method() === 'POST') writes++ })
      const guarded = () => page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(event)
        return event.defaultPrevented
      })
      await restore.click()
      await expect(confirmation).toBeVisible()
      await expect(confirmation).toContainText('entire identity and permission snapshot')
      await expect(confirmation).toContainText('Identities added later may be removed')
      expect(await guarded()).toBe(true)
      await confirmation.getByRole('button', { name: 'Keep current identities', exact: true }).click()
      await expect(confirmation).not.toBeVisible()
      await expect(restore).toBeEnabled()
      expect(await guarded()).toBe(false)
      expect(writes).toBe(0)
      expect(await (await request.get(`${apiBase}/settings/operators`)).json()).toEqual(before)
      expect(await (await request.get(`${apiBase}/settings/user-pool/versions`)).json()).toEqual(versions)

      let release!: () => void
      const held = new Promise<void>(resolve => { release = resolve })
      await page.route(`**${endpoint}`, async route => {
        await held
        if (fail) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Controlled identity restore failure' }) })
        else await route.continue()
      })
      try {
        await restore.click()
        await confirmation.getByRole('button', { name: 'Restore identities', exact: true }).click()
        await expect.poll(() => writes).toBe(1)
        const pending = history.getByRole('status').filter({ hasText: 'Restoring identity revision' })
        await expect(pending).toBeVisible()
        await pending.scrollIntoViewIfNeeded()
        await expect(restore).toBeDisabled()
        await expect(history.getByRole('button', { name: 'Dismiss', exact: true })).toBeDisabled()
        await expect(history.getByTitle('Close', { exact: true })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Switch tenant', exact: true })).toBeDisabled()
        expect(await guarded()).toBe(true)
        await page.keyboard.press('Escape')
        await expect(history).toBeVisible()
        await restore.evaluate((button: HTMLButtonElement) => button.click())
        expect(writes).toBe(1)
        await page.screenshot({ path: testInfo.outputPath('permission-restore-pending.png'), animations: 'disabled' })
      } finally { release() }
      await expect(history.getByRole('status')).toHaveCount(0)
      await page.unroute(`**${endpoint}`)
      if (fail) {
        await expect(history.getByRole('alert')).toContainText('Controlled identity restore failure')
        await expect(restore).toBeEnabled()
        expect(await (await request.get(`${apiBase}/settings/operators`)).json()).toEqual(before)
        expect(await (await request.get(`${apiBase}/settings/user-pool/versions`)).json()).toEqual(versions)
        await page.screenshot({ path: testInfo.outputPath('permission-restore-recovery.png'), animations: 'disabled' })
        await restore.click()
        const applied = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST')
        await confirmation.getByRole('button', { name: 'Restore identities', exact: true }).click()
        expect((await applied).ok()).toBeTruthy()
        await expect(history.getByRole('status')).toHaveCount(0)
      }
      await expect(page.getByText('Identity revision restored', { exact: true })).toBeVisible()
      const saved = (await (await request.get(`${apiBase}/settings/operators`)).json()).find((row: { id: number }) => row.id === data.operator.id)
      expect(saved).toMatchObject(data.original)
      const afterVersions = await (await request.get(`${apiBase}/settings/user-pool/versions`)).json()
      expect(afterVersions).toHaveLength(versions.length + 1)
      expect(afterVersions[0]).toMatchObject({ is_active: true, diff_summary: { revert: true, source_version_id: data.source.id } })
      expect(afterVersions.slice(1).every((version: any) => !version.is_active)).toBe(true)
      expect(writes).toBe(fail ? 2 : 1)
      await expect(history.getByRole('button', { name: `Select revision ${afterVersions.length}`, exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expect(history.getByText('Original history identity', { exact: true })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('permission-restore-persisted.png'), animations: 'disabled' })
      expect(await guarded()).toBe(false)
      await history.getByRole('button', { name: 'Dismiss', exact: true }).click()
      await expect(history).not.toBeVisible()
      await expect(trigger).toBeFocused()
    })
  }
}
