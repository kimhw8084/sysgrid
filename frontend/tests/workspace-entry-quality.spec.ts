import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, createConnection, fillGridSearch, getWorkspaceLogicalRowByText, resetBrowserState, expectWorkspaceLogicalRowSelected } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const [theme, width] of [['nordic-frost-v1', 1440], ['pure-clarity', 390]] as const) test.describe(`Guided workspaces ${theme}`, () => {
  test.beforeEach(async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    await page.setViewportSize({ width, height: 900 })
    expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
  })

  test('Map automatically frames every painted asset at initial and resized canvas sizes', async ({ page, sysApi: request }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.addInitScript(() => {
      const prototype = CanvasRenderingContext2D.prototype
      const clear = prototype.clearRect
      const arc = prototype.arc
      prototype.clearRect = function (...args) {
        if (this.canvas.closest('[data-asset-map]')) (this.canvas as any).topologyPaint = []
        return clear.apply(this, args)
      }
      prototype.arc = function (...args) {
        if (this.canvas.closest('[data-asset-map]') && [5, 7].includes(args[2])) {
          const matrix = this.getTransform(), ratio = this.canvas.clientWidth / this.canvas.width
          const [x, y, radius] = args
          const paint = (this.canvas as any).topologyPaint ||= []
          paint.push({ x: (matrix.a * x + matrix.c * y + matrix.e) * ratio, y: (matrix.b * x + matrix.d * y + matrix.f) * ratio, radius: radius * Math.hypot(matrix.a, matrix.b) * ratio })
        }
        return arc.apply(this, args)
      }
    })
    const stamp = `Framing-${Date.now()}`
    const center = await createAsset(request, { name: `${stamp}-Center`, system: 'Framing proof' })
    for (let index = 0; index < 8; index++) {
      const peer = await createAsset(request, { name: `${stamp}-Peer-${index}`, system: 'Framing proof' })
      await createConnection(request, { source_device_id: center.id, target_device_id: peer.id, source_port: `frame-${index}`, target_port: 'eth0', link_type: 'Data' })
    }
    await page.goto('/asset')
    await fillGridSearch(page, 'Scan asset matrix...', stamp)
    await page.getByRole('button', { name: 'Report', exact: true }).click()
    await page.locator('.asset-report-sidebar').getByRole('button', { name: new RegExp(center.name) }).click()
    await page.getByRole('button', { name: 'Map', exact: true }).click()
    const canvas = page.locator('[data-asset-map] canvas')
    await expect(canvas).toBeVisible()
    const expectPaintWithinCanvas = async () => {
      await expect.poll(() => canvas.evaluate(element => {
        const paints = (element as any).topologyPaint || []
        const centerX = (Math.min(...paints.map((node: any) => node.x - node.radius)) + Math.max(...paints.map((node: any) => node.x + node.radius))) / 2
        const centerY = (Math.min(...paints.map((node: any) => node.y - node.radius)) + Math.max(...paints.map((node: any) => node.y + node.radius))) / 2
        const host = element.closest('.asset-map-canvas-host')!
        return { count: paints.length,
          measured: Math.abs(element.clientWidth - host.clientWidth) <= 1 && Math.abs((element as HTMLCanvasElement).width / devicePixelRatio - element.clientWidth) <= 1,
          centered: Math.abs(centerX - element.clientWidth / 2) <= 4 && Math.abs(centerY - element.clientHeight / 2) <= 4,
          inside: paints.every((node: any) => node.x - node.radius >= 0 && node.y - node.radius >= 0 && node.x + node.radius <= element.clientWidth && node.y + node.radius <= element.clientHeight) }
      })).toEqual({ count: 9, measured: true, centered: true, inside: true })
    }
    await expectPaintWithinCanvas()
    for (const resizedWidth of [900, 390, 1440]) {
      await page.setViewportSize({ width: resizedWidth, height: 900 })
      await expectPaintWithinCanvas()
    }
    await page.screenshot({ path: testInfo.outputPath('map-auto-framing.png'), animations: 'disabled' })
  })

  test('Report selection stays stable and Map can be cleared and navigated by keyboard', async ({ page, sysApi: request }, testInfo) => {
    const stamp = `Report-map-${Date.now()}`
    const primary = await createAsset(request, { name: `${stamp}-A`, system: 'Quality proof' })
    const peer = await createAsset(request, { name: `${stamp}-B`, system: 'Quality proof' })
    await createConnection(request, { source_device_id: primary.id, target_device_id: peer.id, source_port: 'eth0', target_port: 'eth1', link_type: 'Data' })
    await page.goto('/asset')
    await fillGridSearch(page, 'Scan asset matrix...', stamp)
    await page.getByRole('button', { name: 'Report', exact: true }).click()
    const report = page.locator('[data-asset-report]')
    await report.locator('.asset-report-sidebar').getByRole('button', { name: new RegExp(peer.name) }).click()
    const heading = report.getByRole('heading', { name: peer.name, exact: true, level: 1 })
    await expect(heading).toBeVisible()
    const stableNames = await report.evaluate(async element => {
      const names = new Set<string>()
      for (let frame = 0; frame < 60; frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        names.add(element.querySelector('h1')?.textContent || '')
      }
      return [...names]
    })
    expect(stableNames).toEqual([peer.name])
    await expect(report.locator('.asset-report-sidebar [aria-pressed="true"]')).toContainText(peer.name)
    await expectReadableGridText(page, testInfo, 'report-selected', '[data-asset-report]')
    await page.screenshot({ path: testInfo.outputPath('report-selected.png'), animations: 'disabled' })
    for (const section of ['hardware-summary', 'lifecycle', 'services', 'monitoring', 'security', 'metadata', 'components', 'relationships']) {
      await report.locator(`[data-report-section="${section}"]`).scrollIntoViewIfNeeded()
      await expectReadableGridText(page, testInfo, `report-${section}`, '[data-asset-report]')
      await page.screenshot({ path: testInfo.outputPath(`report-${section}.png`), animations: 'disabled' })
    }
    await page.getByRole('button', { name: 'Map', exact: true }).click()
    const map = page.locator('[data-asset-map]')
    if (width < 768) await map.getByRole('button', { name: /Map filters/ }).click()
    await map.getByRole('button', { name: 'Clear selections' }).click()
    await expect(map.getByText('Choose where to start', { exact: true })).toBeVisible()
    await map.getByLabel('Find a starting asset', { exact: true }).fill(primary.name)
    await expect(map.getByRole('img', { name: /^Asset topology:/ })).toBeVisible()
    const connected = map.getByRole('region', { name: 'Connected assets' })
    const choice = connected.getByRole('button', { name: peer.name, exact: true })
    await choice.focus()
    await page.keyboard.press('Enter')
    await expect(map.getByRole('region', { name: 'Selected asset' })).toContainText(peer.name)
    await map.getByRole('button', { name: 'Fit all assets', exact: true }).click()
    await page.screenshot({ path: testInfo.outputPath('map-selected.png'), animations: 'disabled' })
    await map.getByRole('button', { name: 'Open asset details', exact: true }).click()
    await expect(page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: peer.name, exact: true }) })).toBeVisible()
  })

  test('Asset entry guides required fields and leaves untouched timestamps out of an edit', async ({ page, sysApi: request }) => {
    await page.goto('/asset')
    await page.getByRole('button', { name: 'Register Asset', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Create Asset', exact: true })
    await expect(dialog.getByRole('navigation', { name: 'Form guide' })).toBeVisible()
    await expect(dialog.locator('details.form-optional')).not.toHaveAttribute('open')
    await dialog.getByRole('button', { name: 'Save Asset', exact: true }).click()
    await expect(dialog.getByLabel('Hostname', { exact: false })).toBeFocused()
    await expect(dialog.getByLabel('Hostname', { exact: false })).toHaveAttribute('aria-invalid', 'true')
    const name = `Guided-entry-${Date.now()}`
    for (const [label, value] of [['Hostname', name], ['Logical System', 'Guided proof'], ['Serial Number', `${name}-SN`], ['Asset Tag', `${name}-AT`]]) {
      await dialog.getByLabel(new RegExp(`^${label}`)).fill(value)
    }
    const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/devices' && response.request().method() === 'POST')
    await dialog.getByRole('button', { name: 'Save Asset', exact: true }).click()
    const response = await created
    expect(response.ok()).toBeTruthy()
    const asset = await response.json()
    await expect(dialog).toHaveCount(0)
    const update = await request.put(`${apiBase}/devices/${asset.id}`, { data: { purchase_date: '2026-01-02T13:45:30', management_ip: null } })
    expect(update.ok()).toBeTruthy()
    const updatedAsset = await update.json()
    await page.reload()
    await fillGridSearch(page, 'Scan asset matrix...', name)
    const row = await getWorkspaceLogicalRowByText(page, 'assets', name)
    await row.action('More actions').click()
    await page.getByRole('button', { name: 'Edit Configuration', exact: true }).click()
    const editor = page.getByRole('dialog', { name: 'Edit Asset', exact: true })
    await editor.getByLabel('Owner', { exact: true }).fill('Quality owner')
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/devices/${asset.id}` && response.request().method() === 'PUT')
    await editor.getByRole('button', { name: 'Save Asset', exact: true }).click()
    const savedResponse = await saved
    expect(savedResponse.ok()).toBeTruthy()
    expect(savedResponse.request().postDataJSON()).toEqual({ owner: 'Quality owner', expected_revision: updatedAsset.edit_revision })
    const records = await (await request.get(`${apiBase}/devices`)).json()
    expect(records.find((row: any) => row.id === asset.id)).toMatchObject({ owner: 'Quality owner', purchase_date: '2026-01-02T13:45:30', management_ip: null })
  })

  test('Network form preserves a rejected draft and never resends unchanged legacy values', async ({ page, sysApi: request }) => {
    const a = await createAsset(request, { name: `Network-form-A-${Date.now()}`, system: 'Quality proof' })
    const b = await createAsset(request, { name: `Network-form-B-${Date.now()}`, system: 'Quality proof' })
    const connection = await createConnection(request, { source_device_id: a.id, target_device_id: b.id, source_port: 'form-a', target_port: 'form-b', link_type: 'Data', purpose: 'Original' })
    // Simulate historical display values; the backend legacy-preservation suite
    // separately exercises real persisted pre-configuration records.
    await page.route('**/api/v1/networks/connections?**', async route => {
      const response = await route.fetch()
      const rows = await response.json()
      await route.fulfill({ response, json: Array.isArray(rows) ? rows.map(row => row.id === connection.id ? { ...row, link_type: 'Production', direction: 'Ingress' } : row) : rows })
    })
    await page.goto(`/network?id=${connection.id}`)
    await page.getByRole('button', { name: 'Edit Connection', exact: true }).click()
    const editor = page.getByRole('dialog').filter({ has: page.getByText('Edit Network Connection', { exact: true }) })
    await expect(editor.getByRole('navigation', { name: 'Form guide' })).toBeVisible()
    await editor.getByLabel('Purpose', { exact: true }).fill('Retained operator draft')
    await page.route(`**/api/v1/networks/connections/${connection.id}`, async route => {
      if (route.request().method() === 'PUT') await route.fulfill({ status: 400, json: { detail: 'Controlled validation rejection' } })
      else await route.continue()
    })
    await editor.getByRole('button', { name: 'Save Connection', exact: true }).click()
    await expect(editor.getByRole('paragraph').filter({ hasText: /^Controlled validation rejection$/ })).toBeVisible()
    await expect(editor.getByLabel('Purpose', { exact: true })).toHaveValue('Retained operator draft')
    await page.unroute(`**/api/v1/networks/connections/${connection.id}`)
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/networks/connections/${connection.id}` && response.request().method() === 'PUT')
    await editor.getByRole('button', { name: 'Save Connection', exact: true }).click()
    const result = await saved
    expect(result.ok()).toBeTruthy()
    expect(result.request().postDataJSON()).toEqual({ purpose: 'Retained operator draft', edit_revision: connection.edit_revision })
    await expect(editor).toHaveCount(0)
    await page.unrouteAll({ behavior: 'wait' })
  })

  test('Network table rejects the whole batch before saving its retained edits', async ({ page, sysApi: request }) => {
    const stamp = `Network-table-${Date.now()}`
    const a = await createAsset(request, { name: `${stamp}-A`, system: 'Quality proof' })
    const b = await createAsset(request, { name: `${stamp}-B`, system: 'Quality proof' })
    await createConnection(request, { source_device_id: a.id, target_device_id: b.id, source_port: 'table-a', target_port: 'table-b', link_type: 'Data', purpose: 'Original' })
    await page.goto('/network')
    await fillGridSearch(page, 'Scan matrix...', a.name, 'network')
    const row = await getWorkspaceLogicalRowByText(page, 'network', a.name)
    await row.pinned!.locator('.ag-selection-checkbox').click()
    await expectWorkspaceLogicalRowSelected(row)
    await page.getByRole('button', { name: /^Bulk actions$/i }).click()
    await page.locator('.bulk-menu-container').getByText('Bulk Edit Table', { exact: true }).click()
    const editor = page.getByRole('dialog').filter({ hasText: 'Bulk Edit Network' })
    const purpose = editor.getByPlaceholder('Purpose', { exact: true }).first()
    await purpose.fill('Retained batch draft')
    await page.route('**/api/v1/networks/connections/table-edit', route => route.fulfill({ status: 409, json: { detail: 'A selected connection changed; no rows applied' } }))
    await editor.getByRole('button', { name: 'Save Bulk Edit', exact: true }).click()
    await expect(editor.getByRole('paragraph').filter({ hasText: /^A selected connection changed; no rows applied$/ })).toBeVisible()
    await expect(purpose).toHaveValue('Retained batch draft')
    await page.unroute('**/api/v1/networks/connections/table-edit')
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/networks/connections/table-edit' && response.request().method() === 'POST')
    await editor.getByRole('button', { name: 'Save Bulk Edit', exact: true }).click()
    const response = await saved
    expect(response.ok()).toBeTruthy()
    expect(response.request().postDataJSON().rows[0].changes).toEqual({ purpose: 'Retained batch draft' })
    expect((await response.json()).changed).toBe(1)
    await expect(editor).toHaveCount(0)
  })
})
