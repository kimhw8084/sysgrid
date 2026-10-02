import { expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { test } from './helpers/sysgrid-test'
import { createAsset, createEmbeddedKnowledgeFixture, createSite, resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  test(`rack editor values remain readable and drafts survive cancellation in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    await resetBrowserState(page)
    await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    await createSite(request, { name: `UI readiness ${theme}-${Date.now()}`, color: '#888888' })
    await page.goto('/racks')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.getByRole('button', { name: 'Add Site', exact: true }).click()
    const site = page.getByRole('dialog', { name: 'Establish New Site', exact: true })
    const siteName = site.getByPlaceholder('e.g. DATA-CENTER-01')
    await siteName.fill('Readable site draft')
    await expect(site.locator(':scope > :first-child')).toHaveCSS('opacity', '1')
    await expectReadableGridText(page, testInfo, 'site-editor', '[role="dialog"]')
    await page.screenshot({ path: testInfo.outputPath('site-editor.png'), animations: 'disabled' })
    await page.keyboard.press('Escape')
    const discard = page.getByRole('dialog', { name: 'Discard site changes?', exact: true })
    await discard.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(siteName).toHaveValue('Readable site draft')
    await page.keyboard.press('Escape')
    await discard.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.getByRole('button', { name: 'Add Rack', exact: true }).click()
    const rack = page.getByRole('dialog', { name: 'Deploy New Rack', exact: true })
    await rack.getByPlaceholder('e.g. A01').fill('Readable rack draft')
    await expect(rack.locator(':scope > :first-child')).toHaveCSS('opacity', '1')
    await expectReadableGridText(page, testInfo, 'rack-editor', '[role="dialog"]')
    await page.screenshot({ path: testInfo.outputPath('rack-editor.png'), animations: 'disabled' })
  })
}

test('asset details fetch linked runbooks once and keep every tab reachable at laptop width', async ({ page, sysApi: request }, testInfo) => {
  await resetBrowserState(page)
  await page.setViewportSize({ width: 1024, height: 768 })
  const asset = await createAsset(request, { name: `UI readiness detail host ${Date.now()}`, type: 'Physical', status: 'Active', system: 'UI readiness' })
  const requests: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname === '/api/v1/knowledge' && url.searchParams.get('device_id') === String(asset.id)) requests.push(request.url())
  })
  await page.goto(`/asset?id=${asset.id}`)
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: asset.name, exact: true }) })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByPlaceholder('Component Name')).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(requests, 'Opening one asset must not duplicate the same linked-runbook request').toHaveLength(1)
  for (const name of ['hardware', 'secrets', 'relations', 'services', 'network', 'security', 'monitoring', 'metadata']) {
    const button = dialog.getByRole('button', { name, exact: true })
    await button.scrollIntoViewIfNeeded()
    const bounds = await button.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1024)
  }
  await page.screenshot({ path: testInfo.outputPath('asset-detail-laptop.png'), animations: 'disabled' })
})

test('hardware submission shows pending state and preserves the draft on failure', async ({ page, sysApi: request }) => {
  await resetBrowserState(page)
  const asset = await createAsset(request, { name: `UI readiness hardware host ${Date.now()}`, type: 'Physical', status: 'Active', system: 'UI readiness' })
  await page.goto(`/asset?id=${asset.id}`)
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: asset.name, exact: true }) })
  const name = dialog.getByPlaceholder('Component Name')
  await name.fill('Draft CPU')
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let attempts = 0
  await page.route(`**/api/v1/devices/${asset.id}/hardware`, async route => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    await pending
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Hardware storage unavailable' }) })
  })
  await dialog.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Adding...', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'secrets', exact: true })).toBeDisabled()
  expect(attempts).toBe(1)
  release()
  await expect(page.locator('[data-workspace-toast][data-visible="true"]').filter({ hasText: 'Hardware storage unavailable' })).toBeVisible()
  await expect(page.locator('[data-workspace-toast][data-visible="true"]').filter({ hasText: 'Hardware storage unavailable' })).toHaveCount(1)
  await expect(name).toHaveValue('Draft CPU')
  await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toBeEnabled()
})

test('asset hardware and credential drafts survive tab changes and require explicit discard', async ({ page, sysApi: request }) => {
  await resetBrowserState(page)
  const asset = await createAsset(request, { name: `UI readiness draft host ${Date.now()}`, type: 'Physical', status: 'Active', system: 'UI readiness' })
  await page.goto(`/asset?id=${asset.id}`)
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: asset.name, exact: true }) })
  await dialog.getByPlaceholder('Component Name').fill('Unsaved hardware draft')
  await dialog.getByRole('button', { name: 'secrets', exact: true }).click()
  await dialog.getByPlaceholder('Identity / Username').fill('Unsaved identity')
  await dialog.getByPlaceholder('Value', { exact: true }).fill('synthetic-ui-test-value')
  await dialog.getByRole('button', { name: 'hardware', exact: true }).click()
  await expect(dialog.getByPlaceholder('Component Name')).toHaveValue('Unsaved hardware draft')
  await dialog.getByRole('button', { name: 'secrets', exact: true }).click()
  await expect(dialog.getByPlaceholder('Identity / Username')).toHaveValue('Unsaved identity')
  await expect(dialog.getByPlaceholder('Value', { exact: true })).toHaveValue('synthetic-ui-test-value')
  await page.keyboard.press('Escape')
  const confirmation = page.getByRole('alertdialog', { name: 'Unsaved Changes', exact: true })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(dialog.getByPlaceholder('Identity / Username')).toHaveValue('Unsaved identity')
  await page.keyboard.press('Escape')
  await confirmation.getByRole('button', { name: 'Discard Changes', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.goto(`/asset?id=${asset.id}`)
  await expect(dialog.getByPlaceholder('Component Name')).toHaveValue('')
  await dialog.getByRole('button', { name: 'secrets', exact: true }).click()
  await expect(dialog.getByPlaceholder('Value', { exact: true })).toHaveValue('')
})

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  test(`Knowledge, Projects, and Architecture use readable ${theme} surfaces`, async ({ page, sysApi: request }, testInfo) => {
    await resetBrowserState(page)
    await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    await page.goto('/knowledge')
    await expect(page.locator('[data-knowledge-summary]').first()).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expectReadableGridText(page, testInfo, 'knowledge-primary', '[data-knowledge-primary-tools], [data-knowledge-summary], [data-knowledge-queue], [data-knowledge-record-list]')
    await page.screenshot({ path: testInfo.outputPath('knowledge-readable.png'), animations: 'disabled' })
    await page.goto('/projects')
    const project = page.locator('[data-pv1-projects-route]')
    await expect(project).toBeVisible()
    const paletteRules = await project.evaluate(element => {
      const matched: string[] = []
      const inspect = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule && element.matches(rule.selectorText) && /background|--pv1|--projects/.test(rule.cssText)) matched.push(rule.cssText)
          else if ('cssRules' in rule) inspect((rule as CSSGroupingRule).cssRules)
        }
      }
      for (const sheet of Array.from(document.styleSheets)) { try { inspect(sheet.cssRules) } catch { /* cross-origin sheets do not own these local rules */ } }
      return { matched, style: element.getAttribute('style'), pv1: getComputedStyle(element).getPropertyValue('--pv1-page'), base: getComputedStyle(element).getPropertyValue('--surface-base') }
    })
    const palettePath = testInfo.outputPath('project-palette-rules.json')
    writeFileSync(palettePath, JSON.stringify(paletteRules, null, 2))
    await testInfo.attach('project-palette-rules', { path: palettePath, contentType: 'application/json' })
    if (theme === 'nordic-frost-v1') {
      const colors = await project.evaluate(element => ({ page: getComputedStyle(element).backgroundColor, expected: getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim(), input: getComputedStyle(element.querySelector('input')!).backgroundColor }))
      expect(colors.page).toBe('rgb(37, 37, 37)')
      expect(colors.input).not.toBe('rgb(30, 41, 59)')
    }
    await expectReadableGridText(page, testInfo, 'project-controls', '.p04-global-header, .p04-toolbar')
    const modelResponse = await request.post(`${apiBase.replace(/\/api\/v1$/, '')}/api/v2/architecture/models`, { data: { command_id: crypto.randomUUID(), name: `Readable populated ${theme} ${Date.now()}` } })
    expect(modelResponse.ok()).toBeTruthy()
    const model = await modelResponse.json()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/architecture?model=${model.model.id}`)
    await expect(page.locator('[data-pv1-architecture-host]')).toBeVisible()
    const proposal = page.getByRole('textbox', { name: 'Proposed object name', exact: true })
    await proposal.fill('Readable proposal draft')
    const propose = page.getByRole('button', { name: 'Create Draft proposal', exact: true })
    await propose.scrollIntoViewIfNeeded()
    const bounds = (await propose.boundingBox())!
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
    await expectReadableGridText(page, testInfo, 'architecture-populated-mobile', '[data-pv1-architecture-host]')
    await page.screenshot({ path: testInfo.outputPath('architecture-populated-mobile.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 1440, height: 900 })
    // Exercise the empty-model creation surface independently of models created
    // by the integration/responsive journeys in the same disposable runtime.
    await page.route('**/api/v2/architecture/models', route => route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
      : route.continue())
    await page.goto('/architecture')
    const name = page.getByRole('textbox', { name: 'New Architecture model name', exact: true })
    await name.fill('Readable architecture draft')
    await expectReadableGridText(page, testInfo, 'architecture-create', '[data-architecture-create-model]')
    await page.screenshot({ path: testInfo.outputPath('architecture-readable.png'), animations: 'disabled' })
  })
}

test('a tenant-list failure is distinct from an empty list and can be retried', async ({ page }) => {
  await resetBrowserState(page)
  await page.route('**/api/v1/tenants/me', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Tenant registry unavailable' }) }))
  await page.goto('/asset')
  await expect(page.getByText('Tenant unavailable', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Switch tenant', exact: true }).click()
  await expect(page.getByText('Available tenants could not be loaded.', { exact: true })).toBeVisible()
  await expect(page.getByText('No accessible tenants available', { exact: true })).not.toBeVisible()
  await page.unroute('**/api/v1/tenants/me')
  await page.getByRole('menuitem', { name: 'Retry tenant list', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Switch tenant', exact: true })).toContainText('Playwright Gate')
})

test('a knowledge record opens with keyboard activation', async ({ page, sysApi: request }) => {
  await resetBrowserState(page)
  const asset = await createAsset(request, { name: `UI keyboard host ${Date.now()}`, type: 'Physical', status: 'Active', system: 'UI readiness' })
  const entry = await createEmbeddedKnowledgeFixture(request, asset.id, `UI keyboard runbook ${Date.now()}`)
  await page.goto('/knowledge')
  const card = page.getByRole('button', { name: `Open knowledge: ${entry.title}`, exact: true })
  await card.scrollIntoViewIfNeeded()
  await card.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: entry.title, exact: true, level: 1 })).toBeVisible()
})
