import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, resetBrowserState } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

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
