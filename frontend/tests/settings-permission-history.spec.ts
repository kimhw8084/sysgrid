import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const width of [1440, 390]) {
    for (const legacy of [false, true]) {
      test(`permission history preserves ${legacy ? 'malformed legacy evidence safely' : 'exact recorded field changes'} in ${theme} at ${width}`, async ({ page, sysApi: request }, testInfo) => {
        await resetBrowserState(page)
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
        expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
        await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
        const original = { external_id: 'history-record-fixture', username: 'history-record-fixture',
          full_name: ' Analyst ', email: null, department: 'Operations', team: 'Platform',
          team_id: 11, team_source: 'manual', teams: [''], role_id: 21, role_name: 'Operator',
          registration_status: 'Verified', is_admin: false, custom_permissions: {} }
        const changed = { ...original, full_name: 'Analyst', email: '', team_id: 12, team_source: 'synced', role_id: 22, teams: ['Empty text'] }
        const versions = [
          { id: 902, created_at: '2026-10-02T12:00:00Z', created_by: 'History fixture', is_active: true,
            snapshot_data: legacy ? [
              { ...changed, full_name: { legacy: 'unreadable name' }, email: ['invalid email'], department: { label: 'invalid department' }, team: ['invalid team'], is_admin: 'false' },
              { ...changed, external_id: 'healthy-record', username: 'healthy-record', full_name: 'Healthy identity' },
              { ...changed, external_id: 'duplicate-record', full_name: 'Ambiguous duplicate one' },
              { ...changed, external_id: 'duplicate-record', full_name: 'Ambiguous duplicate two' },
            ] : [changed] },
          { id: 901, created_at: '2026-10-01T12:00:00Z', created_by: 'History fixture', is_active: false,
            snapshot_data: legacy ? [null, 42, { full_name: 'Missing identity key' }, original] : [original] },
        ]
        const errors: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        let restoreWrites = 0
        page.on('request', req => { if (req.url().includes('/user-pool/restore/') && req.method() === 'POST') restoreWrites++ })
        await page.route('**/api/v1/settings/user-pool/versions', route => route.fulfill({ json: versions }))
        await page.goto('/settings?tab=permissions')
        const trigger = page.getByRole('button', { name: 'Revision History', exact: true })
        await trigger.click()
        const history = page.getByRole('dialog', { name: 'Permission Registry History', exact: true })
        await expect(history).toBeVisible()
        await expect(history.locator(':scope > .glass-panel')).toHaveCSS('opacity', '1')
        if (legacy) {
          await expect(history.getByRole('alert')).toContainText('Comparison is partial')
          await expect(history.getByText('Healthy identity', { exact: true })).toBeVisible()
          await expect(history).toContainText('Invalid recorded value')
          await expect(history).not.toContainText('Ambiguous duplicate')
          const adminCell = history.getByRole('row').filter({ hasText: 'history-record-fixture' }).getByRole('cell').nth(5)
          await expect(adminCell).toContainText('Unknown')
          await expect(adminCell).not.toContainText('Admin')
        } else {
          const row = history.getByRole('row').filter({ hasText: 'history-record-fixture' })
          await expect(row).toHaveCount(1)
          await expect(row).toContainText('NAME: " Analyst " -> Analyst', { useInnerText: false })
          await expect(row).toContainText('EMAIL: Not set -> Empty text')
          await expect(row).toContainText('ROLE ID: 21 → 22')
          await expect(row).toContainText('TEAM ID: 11 → 12')
          await expect(row).toContainText('SOURCE: manual → synced')
          await expect(row.getByRole('cell').nth(4).locator('.line-through')).toHaveCount(1)
          await expect(row.getByRole('cell').nth(4)).toContainText('"Empty text"')
        }
        const region = history.getByRole('region', { name: 'Identity changes', exact: true })
        for (const index of [1, 2, 3]) {
          const cell = region.getByRole('row').nth(1).getByRole('cell').nth(index)
          await cell.scrollIntoViewIfNeeded()
          await expect(cell).toBeInViewport({ ratio: 0.9 })
          await page.screenshot({ path: testInfo.outputPath(`history-records-cell-${index}.png`), animations: 'disabled' })
          await expectReadableGridText(page, testInfo, `history records cell ${index}`, '[data-workspace-history]')
        }
        expect(errors).toEqual([])
        expect(restoreWrites).toBe(0)
        await history.getByRole('button', { name: 'Dismiss', exact: true }).click()
        await expect(history).not.toBeVisible()
        await expect(trigger).toBeFocused()
        await testInfo.attach('history-records-fixture', { body: JSON.stringify({ versions, errors, restoreWrites, responseOnly: true }), contentType: 'application/json' })
        if (legacy) {
          await page.unroute('**/api/v1/settings/user-pool/versions')
          await page.route('**/api/v1/settings/user-pool/versions', route => route.fulfill({ json: [
            { ...versions[0], snapshot_data: { invalid: 'legacy snapshot container' } }, versions[1],
          ] }))
          await page.reload()
          await trigger.click()
          await expect(history.getByRole('alert')).toContainText('Comparison is partial')
          await expect(history.getByRole('row')).toHaveCount(0)
          expect(errors).toEqual([])
          expect(restoreWrites).toBe(0)
        }
      })
    }
  }
}


const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

async function prepareHistory(request: any) {
  const username = `pw-permission-history-${Date.now()}`
  const original = { external_id: username, username, full_name: 'Original history identity',
    department: 'Original department', email: 'history@example.com', is_admin: false,
    custom_permissions: { assets: 1, settings: 1 }, team: 'Original history team', registration_status: 'Verified' }
  const created = await request.post(`${apiBase}/settings/operators`, { data: original })
  expect(created.ok()).toBeTruthy()
  const operator = await created.json()
  const previous = await (await request.get(`${apiBase}/settings/user-pool/versions`)).json()
  expect((await request.patch(`${apiBase}/settings/operators/${operator.id}`, { data: {
    full_name: 'Updated history identity', department: 'Updated department', email: 'updated@example.com',
    is_admin: true, team: 'Updated history team', username: `${username}-updated`, registration_status: 'Pending',
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
      expect.soft(await row.textContent(), 'show the old and new username').toContain(`USERNAME: ${data.original.username} -> ${data.original.username}-updated`)
      expect.soft(await row.textContent(), 'show the old and new registration status').toContain('STATUS: Verified -> Pending')
      const identityCell = row.getByRole('cell').nth(1)
      await identityCell.scrollIntoViewIfNeeded()
      await expect(identityCell).toBeInViewport({ ratio: 0.9 })
      await page.screenshot({ path: testInfo.outputPath('permission-history-identity.png'), animations: 'disabled' })
      await expectReadableGridText(page, testInfo, 'permission history identity', '[data-workspace-history]')
      const collapsedHeight = await row.evaluate(element => element.getBoundingClientRect().height)
      await testInfo.attach('permission-history-collapsed-height', { body: JSON.stringify({ collapsedHeight }), contentType: 'application/json' })
      expect.soft(collapsedHeight, 'collapsed history rows must remain easy to scan').toBeLessThanOrEqual(320)
      const details = row.locator('details')
      const summary = details.locator('summary')
      await expect(summary).toHaveCount(1)
      await expect(summary).toContainText('permission changes')
      await summary.focus()
      await page.screenshot({ path: testInfo.outputPath('permission-history-disclosure.png'), animations: 'disabled' })
      await expectReadableGridText(page, testInfo, 'permission history disclosure', '[data-workspace-history]')
      await page.keyboard.press('Enter')
      await expect(details).toHaveAttribute('open', '')
      const changes = details.locator('[data-permission-change]')
      expect(await changes.count()).toBeGreaterThan(1)
      await expect(summary).toContainText(String(await changes.count()))
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
      await summary.focus()
      await page.keyboard.press('Space')
      await expect(details).not.toHaveAttribute('open', '')
      await expect(summary).toBeFocused()
      expect(await row.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(320)
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
