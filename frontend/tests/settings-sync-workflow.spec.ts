import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const record = (user: any) => Object.fromEntries(
  ['external_id', 'username', 'full_name', 'email', 'department', 'team', 'registration_status'].map(key => [key, user[key] ?? null]),
)

async function prepare(request: any) {
  const stamp = `pw-sync-ui-${Date.now()}`
  const users = []
  for (const [suffix, team_source] of [['local', 'manual_override'], ['removed', 'synced']]) {
    const response = await request.post(`${apiBase}/settings/operators`, { data: {
      external_id: `${stamp}-${suffix}`, username: `${stamp}-${suffix}`, full_name: `Sync ${suffix}`,
      team: 'Local sync team', team_source, registration_status: 'Verified',
    } })
    expect(response.ok()).toBeTruthy()
    users.push(await response.json())
  }
  const [local, removed] = users
  const before = await (await request.get(`${apiBase}/settings/operators`)).json()
  const added = { external_id: `${stamp}-new`, username: `${stamp}-new`, full_name: 'New source user', team: 'Source sync team', registration_status: 'Verified' }
  const records = [
    ...before.filter((user: any) => user.team_source === 'synced' && user.id !== removed.id && user.external_id).map(record),
    { ...record(local), full_name: 'Reviewed source name', team: 'Rejected source team' }, added,
  ]
  return { records, local, removed, added, before }
}

async function openEditor(page: any, request: any, theme: string, width = 1440) {
  await resetBrowserState(page)
  await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 })
  expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
  await page.addInitScript((value: string) => localStorage.setItem('sysgrid-theme', value), theme)
  await page.goto('/settings?tab=permissions')
  await page.getByRole('button', { name: /Identity Sync Pipeline/ }).click()
  await page.getByRole('button', { name: 'Edit Records', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Identity records (JSON)', exact: true })).toBeEditable()
}

async function preview(page: any) {
  const pending = page.waitForResponse((response: any) => response.url().endsWith('/settings/user-pool/refresh'))
  await page.getByRole('button', { name: 'Dry Run Preview', exact: true }).click()
  const response = await pending
  expect(response.ok(), await response.text()).toBeTruthy()
  await expect(page.getByRole('region', { name: 'Synchronization preview', exact: true })).toBeVisible()
  return response
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const width of [1440, 390]) {
    test(`identity records preview and apply truthfully in ${theme} at ${width}`, async ({ page, sysApi: request }, testInfo) => {
      const data = await prepare(request)
      await openEditor(page, request, theme, width)
      const draft = JSON.stringify(data.records, null, 2)
      await page.locator('textarea').fill(draft)
      const response = await preview(page)
      const reviewed = await response.json()
      expect(response.request().postDataJSON()).toEqual({ records: data.records, source: 'settings_identity_import', preview: true })
      expect(await (await request.get(`${apiBase}/settings/operators`)).json()).toEqual(data.before)
      const panel = page.getByRole('region', { name: 'Synchronization preview', exact: true })
      await expect(panel.getByText('1 removed', { exact: true })).toBeVisible()
      await expect(panel.getByText('Local sync team', { exact: false }).first()).toBeVisible()
      const newRow = panel.getByRole('row').filter({ hasText: data.added.username })
      await expect(newRow).toContainText('team: Source sync team')
      await expect(newRow).toContainText('registration status: Verified')
      const apply = panel.getByRole('button', { name: 'Confirm & Execute Sync', exact: true })
      await expect(apply).toBeDisabled()
      await panel.getByRole('checkbox', { name: 'I reviewed the removals', exact: true }).check()
      await expect.poll(() => panel.evaluate(element => element.getBoundingClientRect().bottom <= element.parentElement!.getBoundingClientRect().bottom + 1)).toBe(true)
      await apply.scrollIntoViewIfNeeded()
      const geometry = await panel.evaluate(element => {
        const chain = []
        for (let node: Element | null = element; node; node = node.parentElement) {
          const rect = node.getBoundingClientRect()
          chain.push({ tag: node.tagName, left: rect.left, width: rect.width, scrollLeft: node.scrollLeft, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth })
        }
        return chain
      })
      await testInfo.attach('preview-geometry.json', { body: JSON.stringify(geometry), contentType: 'application/json' })
      const workspaceChildren = await page.locator('[data-settings-workspace]').evaluate(element => Array.from(element.children).map(child => {
        const rect = child.getBoundingClientRect()
        return { tag: child.tagName, className: child.className, left: rect.left, right: rect.right, scrollWidth: child.scrollWidth, clientWidth: child.clientWidth }
      }))
      await testInfo.attach('workspace-geometry.json', { body: JSON.stringify(workspaceChildren), contentType: 'application/json' })
      const workspaceOverflow = await page.locator('[data-settings-workspace]').evaluate(element => element.scrollWidth - element.clientWidth)
      expect(workspaceOverflow).toBeLessThanOrEqual(1)
      expect(geometry[0].left).toBeGreaterThanOrEqual(0)
      expect(geometry[0].left + geometry[0].width).toBeLessThanOrEqual(width)
      await page.screenshot({ path: testInfo.outputPath('sync-reviewed.png'), animations: 'disabled' })
      await expectReadableGridText(page, testInfo, 'reviewed synchronization', '[data-sync-preview]')
      await newRow.getByRole('cell').last().scrollIntoViewIfNeeded()
      await expect(newRow.getByRole('cell').last()).toBeInViewport({ ratio: 0.9 })
      const detailsLeft = await panel.evaluate(element => element.getBoundingClientRect().left)
      expect(detailsLeft).toBeGreaterThanOrEqual(0)
      await page.screenshot({ path: testInfo.outputPath('sync-details.png'), animations: 'disabled' })
      const applied = page.waitForResponse(result => result.url().endsWith('/settings/user-pool/refresh') && result.request().postDataJSON().preview === false)
      await apply.click()
      const receipt = await applied
      expect(receipt.ok(), await receipt.text()).toBeTruthy()
      expect(receipt.request().postDataJSON()).toEqual({ records: data.records, source: 'settings_identity_import', preview: false, expected_fingerprint: reviewed.fingerprint })
      expect((await receipt.json()).summary).toEqual(reviewed.summary)
      await expect(page.getByText('Identity records synchronized', { exact: true })).toBeVisible()
      await expect(panel).not.toBeVisible()
      const after = await (await request.get(`${apiBase}/settings/operators`)).json()
      expect(after.find((user: any) => user.id === data.removed.id)).toBeUndefined()
      expect(after.find((user: any) => user.id === data.local.id)).toMatchObject({ full_name: 'Reviewed source name', team: 'Local sync team', team_source: 'manual_override' })
      expect(after.find((user: any) => user.external_id === data.added.external_id)).toMatchObject({ ...data.added, is_admin: false })
      await page.reload()
      await page.getByPlaceholder('Search identity, department, or team...').fill(data.added.username)
      await expect(page.getByRole('row').filter({ hasText: data.added.username })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('sync-persisted.png'), animations: 'disabled' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2)
    })
  }

  test(`stale sync review preserves the draft and requires a fresh preview in ${theme}`, async ({ page, sysApi: request }) => {
    const data = await prepare(request)
    await openEditor(page, request, theme)
    const draft = JSON.stringify(data.records, null, 2)
    await page.locator('textarea').fill(draft)
    await preview(page)
    expect((await request.patch(`${apiBase}/settings/operators/${data.local.id}`, { data: { department: 'Independent change' } })).ok()).toBeTruthy()
    const before = await (await request.get(`${apiBase}/settings/operators`)).json()
    await page.getByRole('checkbox', { name: 'I reviewed the removals', exact: true }).check()
    const rejected = page.waitForResponse(result => result.url().endsWith('/settings/user-pool/refresh') && !result.request().postDataJSON().preview)
    await page.getByRole('button', { name: 'Confirm & Execute Sync', exact: true }).click()
    expect((await rejected).status()).toBe(409)
    await expect(page.getByRole('alert').filter({ hasText: 'Preview again' })).toBeVisible()
    await expect(page.locator('textarea')).toHaveValue(draft)
    await expect(page.getByRole('button', { name: 'Confirm & Execute Sync', exact: true })).not.toBeVisible()
    expect(await (await request.get(`${apiBase}/settings/operators`)).json()).toEqual(before)
    await preview(page)
    await page.locator('textarea').fill(draft + ' ')
    await expect(page.getByRole('button', { name: 'Confirm & Execute Sync', exact: true })).not.toBeVisible()
    await expect(page.locator('textarea')).toHaveValue(draft + ' ')
  })

  test(`sync input, pending request and failed apply preserve recovery in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    const data = await prepare(request)
    await openEditor(page, request, theme)
    const navigation = page.getByRole('navigation', { name: 'Primary navigation' })
    const home = navigation.getByRole('link', { name: 'Home', exact: true })
    const settings = navigation.getByRole('link', { name: 'Settings / Access', exact: true })
    const homeUrl = new URL((await home.getAttribute('href'))!, page.url()).href
    await expect(settings).toHaveAttribute('aria-current', 'page')
    await expect(home).not.toHaveAttribute('aria-current', 'page')
    let requests = 0
    page.on('request', req => { if (req.url().endsWith('/settings/user-pool/refresh')) requests++ })
    await page.locator('textarea').fill('invalid JSON')
    await page.getByRole('button', { name: 'Dry Run Preview', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Enter a non-empty JSON array' })).toBeVisible()
    expect(requests).toBe(0)
    const draft = JSON.stringify(data.records, null, 2)
    await page.locator('textarea').fill(draft)
    await preview(page)
    await page.getByRole('checkbox', { name: 'I reviewed the removals', exact: true }).check()
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    await page.route('**/settings/user-pool/refresh', async route => {
      if (route.request().postDataJSON().preview) return route.continue()
      await held
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Controlled sync failure' }) })
    })
    try {
      await page.getByRole('button', { name: 'Confirm & Execute Sync', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Applying identity records' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Confirm & Execute Sync', exact: true })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Dry Run Preview', exact: true })).toBeDisabled()
      await expect(page.locator('textarea')).toHaveAttribute('readonly', '')
      await home.click()
      await expect(page).toHaveURL(/settings/)
      await expect(settings).toHaveAttribute('aria-current', 'page')
      await expect(home).not.toHaveAttribute('aria-current', 'page')
      await page.mouse.move(500, 200)
      await expect(home.locator('span').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(page.locator('textarea')).toHaveValue(draft)
      await page.screenshot({ path: testInfo.outputPath('sync-pending.png'), animations: 'disabled' })
      expect(requests).toBe(2)
    } finally { release() }
    await expect(page.getByRole('alert').filter({ hasText: 'Controlled sync failure' })).toBeVisible()
    await expect(page.locator('textarea')).toHaveValue(draft)
    await expect(page.getByRole('button', { name: 'Confirm & Execute Sync', exact: true })).not.toBeVisible()
    expect(await (await request.get(`${apiBase}/settings/operators`)).json()).toEqual(data.before)
    await page.unroute('**/settings/user-pool/refresh')
    await home.click()
    const dialog = page.getByRole('dialog').filter({ hasText: 'Discard identity records draft?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(page).toHaveURL(/settings/)
    await expect(settings).toHaveAttribute('aria-current', 'page')
    await expect(home).not.toHaveAttribute('aria-current', 'page')
    await expect(page.locator('textarea')).toHaveValue(draft)
    await preview(page)
    await page.getByRole('button', { name: 'Abort', exact: true }).click()
    await expect(page.locator('textarea')).toHaveValue(draft)
    await home.click()
    await dialog.getByRole('button', { name: 'Discard draft', exact: true }).click()
    await expect(page).toHaveURL(homeUrl)
    await expect(home).toHaveAttribute('aria-current', 'page')
    await expect(settings).not.toHaveAttribute('aria-current', 'page')
  })
}
