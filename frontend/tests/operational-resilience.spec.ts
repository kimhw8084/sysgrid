import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, createConnection, resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const timezone of ['America/Chicago', 'Asia/Seoul']) {
  test.describe(`Forensic timestamps in ${timezone}`, () => {
    test.use({ timezoneId: timezone, locale: 'en-US' })
    for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
      test(`shared headers preserve the API instant in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
        await resetBrowserState(page)
        await page.setViewportSize({ width: 1440, height: 900 })
        expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
        await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
        const source = await createAsset(request, { name: `Timestamp source ${Date.now()}`, system: 'Timestamp proof' })
        const target = await createAsset(request, { name: `Timestamp peer ${Date.now()}`, system: 'Timestamp proof' })
        const connection = await createConnection(request, { device_a_id: source.id, device_b_id: target.id,
          source_port: 'timestamp-source', target_port: 'timestamp-peer', link_type: 'Data', status: 'Active' })
        expect(connection.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/)
        await page.goto(`/network?id=${connection.id}`)
        const expected = await page.evaluate(value => {
          const instant = new Date(`${value}Z`)
          return {
            header: instant.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }),
            body: instant.toLocaleString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
          }
        }, connection.created_at)
        const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /Connection Forensics/ }) })
        const header = dialog.locator('[data-workspace-modal-header]')
        await expect(header.getByText('Created', { exact: true }).locator('..')).toContainText(expected.header)
        await expect(header.getByText('Last modified', { exact: true }).locator('..')).toContainText(expected.header)
        await expect(dialog.getByText(expected.body, { exact: true }).first()).toBeVisible()
        await header.screenshot({ path: testInfo.outputPath(`forensic-time-${timezone.replace('/', '-')}-${theme}.png`), animations: 'disabled' })
      })
    }
  })
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }, { width: 640, height: 360 }]) {
    test(`error console keeps diagnostics and controls reachable in ${theme} at ${viewport.width}x${viewport.height}`, async ({ page, sysApi: request }, testInfo) => {
      await resetBrowserState(page)
      await page.setViewportSize(viewport)
      await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      await page.goto('/racks')
      await expect(page.getByRole('heading', { name: 'Racks', exact: true })).toBeVisible()
      const message = `Long diagnostic ${'source_'.repeat(20)}`
      await page.evaluate(value => window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.resolve(), reason: { message: value, stack: `Error: ${value}\n    at syntheticDiagnostic (test:1:1)` },
      })), message)
      if (viewport.width < 1024) await page.getByText('App tools', { exact: true }).click()
      const trigger = page.getByRole('button', { name: /^Open error console/ })
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: 'Error console', exact: true })
      await expect(dialog).toBeVisible()
      await expect(dialog.locator(':scope > :first-child')).toHaveCSS('opacity', '1')
      const assertReachable = async (button: ReturnType<typeof page.getByRole>) => {
        await button.scrollIntoViewIfNeeded()
        const rect = await button.boundingBox()
        expect.soft(rect).not.toBeNull()
        expect.soft(rect!.x).toBeGreaterThanOrEqual(0)
        expect.soft(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width)
        expect.soft(rect!.y).toBeGreaterThanOrEqual(0)
        expect.soft(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height)
      }
      await assertReachable(dialog.getByRole('button', { name: 'Close error console', exact: true }))
      await page.screenshot({ path: testInfo.outputPath('console-list.png'), animations: 'disabled' })
      const entry = dialog.getByRole('button', { name: `Inspect error: ${message}`, exact: true })
      await entry.focus()
      await page.keyboard.press('Enter')
      await expect(dialog.getByRole('heading', { name: message, exact: true })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('console-detail-top.png'), animations: 'disabled' })
      for (const name of ['Acknowledge error', 'Copy Bug Report', 'Copy technical details']) {
        await assertReachable(dialog.getByRole('button', { name, exact: true }))
      }
      await page.screenshot({ path: testInfo.outputPath('console-detail.png'), animations: 'disabled' })
      await expectReadableGridText(page, testInfo, 'error-console', '[role="dialog"]')
      if (viewport.width < 1024) {
        await dialog.getByRole('button', { name: 'Back to error list', exact: true }).click()
        await expect(entry).toBeFocused()
      }
      await page.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible()
      await expect(trigger).toBeFocused()
      await expect(page).toHaveURL(/\/racks$/)
    })
  }
}

test('service save preserves the draft on failure and commits once after a stalled retry', async ({ page, sysApi: request }) => {
  await resetBrowserState(page)
  const suffix = `${Date.now()}`
  const host = await createAsset(request, { name: `Resilience host ${suffix}`, system: 'Resilience', type: 'Physical', status: 'Active', serial_number: suffix })
  const name = `Resilient service ${suffix}`
  await page.goto('/services')
  await page.getByRole('button', { name: '+ Add Service', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Create Service', exact: true }) })
  const nameInput = dialog.getByPlaceholder('e.g. ERP DB Prod 01')
  await nameInput.fill(name)
  await dialog.getByRole('button', { name: 'Select host node', exact: true }).click()
  await page.getByPlaceholder('Search hostname or system...').fill(host.name)
  await page.getByRole('button', { name: new RegExp(host.name) }).click()

  let writes = 0
  let releaseFailure!: () => void
  let releaseSuccess!: () => void
  const failure = new Promise<void>(resolve => { releaseFailure = resolve })
  const success = new Promise<void>(resolve => { releaseSuccess = resolve })
  await page.route(/\/api\/v1\/logical-services\/?$/, async route => {
    if (route.request().method() !== 'POST') return route.continue()
    writes += 1
    if (writes === 1) {
      await failure
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Temporary service outage. Please retry.' }) })
    }
    await success
    return route.continue()
  })
  try {
    const save = dialog.getByRole('button', { name: 'Add Service', exact: true })
    await save.click()
    await expect.poll(() => writes).toBe(1)
    await expect(save).toBeDisabled()
    await nameInput.press('Enter')
    await nameInput.press('Enter')
    expect(writes, 'Pending form submission must not send duplicate writes').toBe(1)
    releaseFailure()
    await expect(dialog.getByText('Temporary service outage. Please retry.', { exact: true })).toBeVisible()
    await expect(nameInput).toHaveValue(name)
    await expect(save).toBeEnabled()
    const beforeRetry = await request.get(`${apiBase}/logical-services`)
    expect((await beforeRetry.json()).filter((item: any) => item.name === name)).toHaveLength(0)

    await save.click()
    await expect.poll(() => writes).toBe(2)
    await expect(save).toBeDisabled()
    await nameInput.press('Enter')
    expect(writes).toBe(2)
    releaseSuccess()
    await expect(dialog).not.toBeVisible()
    const afterRetry = await request.get(`${apiBase}/logical-services`)
    const matches = (await afterRetry.json()).filter((item: any) => item.name === name)
    expect(matches).toHaveLength(1)
    expect(matches[0].device_id).toBe(host.id)
  } finally {
    releaseFailure()
    releaseSuccess()
  }
})

test('error console opens and closes without navigating or losing the current workspace', async ({ page }) => {
  await resetBrowserState(page)
  await page.goto('/racks')
  await expect(page.getByRole('heading', { name: 'Racks', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^Open error console/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Error console', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Close error console', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page).toHaveURL(/\/racks$/)
  await expect(page.getByRole('heading', { name: 'Racks', exact: true })).toBeVisible()
})

test('error diagnostics remain transient while saved metadata survives acknowledgement and reload', async ({ page }) => {
  await resetBrowserState(page)
  await page.goto('/racks')
  await expect(page.getByRole('heading', { name: 'Racks', exact: true })).toBeVisible()
  const marker = 'synthetic-diagnostic-private-value'
  await page.evaluate(value => {
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.resolve(), reason: { message: value, status: 422, data: { input: { credential: value } } },
    }))
  }, marker)
  await page.getByRole('button', { name: /^Open error console/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Error console', exact: true })
  await expect(dialog.getByRole('button', { name: `Inspect error: ${marker}`, exact: true })).toBeVisible()
  await expect(dialog).toContainText('Saved history contains metadata only')
  const stored = await page.evaluate(() => localStorage.getItem('SYSGRID_ERROR_LOGS')!)
  expect(stored).not.toContain(marker)
  const entry = JSON.parse(stored).find((item: any) => item.status === 422)
  expect(entry).toBeTruthy()
  await dialog.getByRole('button', { name: 'Acknowledge All', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: /^Open error console/ }).click()
  await expect(dialog.getByRole('button', { name: /Inspect error: API error \(422\)/ })).toBeVisible()
  await expect(dialog).not.toContainText(marker)
  const reloaded = await page.evaluate(() => JSON.parse(localStorage.getItem('SYSGRID_ERROR_LOGS')!))
  expect(reloaded.find((item: any) => item.id === entry.id)).toMatchObject({ timestamp: entry.timestamp, status: 422, acknowledged: true })
})

test('opening an upgraded app removes legacy diagnostic payloads without losing event history', async ({ page }) => {
  await resetBrowserState(page)
  await page.goto('/racks')
  await page.evaluate(() => localStorage.setItem('SYSGRID_ERROR_LOGS', JSON.stringify([{
    id: 'legacy1', timestamp: '2026-10-02T01:00:00.000Z', type: 'backend', severity: 'critical', status: 500,
    acknowledged: true, message: 'synthetic-legacy-secret', rawBody: 'synthetic-legacy-secret', data: { password: 'synthetic-legacy-secret' },
  }])))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Racks', exact: true })).toBeVisible()
  const stored = await page.evaluate(() => localStorage.getItem('SYSGRID_ERROR_LOGS')!)
  expect(stored).not.toContain('synthetic-legacy-secret')
  expect(JSON.parse(stored)).toEqual([expect.objectContaining({ id: 'legacy1', timestamp: '2026-10-02T01:00:00.000Z', acknowledged: true })])
  await page.getByRole('button', { name: /^Open error console/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Error console', exact: true })
  await expect(dialog.getByRole('button', { name: /Inspect error: API error \(500\)/ })).toBeVisible()
  await expect(dialog).not.toContainText('synthetic-legacy-secret')
})
