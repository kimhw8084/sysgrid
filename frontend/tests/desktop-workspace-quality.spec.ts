import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, createConnection, fillGridSearch, getWorkspaceLogicalRowByText, resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity'] as const) {
  for (const viewport of [{ width: 1024, height: 768 }, { width: 1280, height: 650 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    test(`desktop Report and Map ${theme} ${viewport.width}`, async ({ page, sysApi }, testInfo) => {
      await page.setViewportSize(viewport)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await resetBrowserState(page)
      expect((await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
      await page.addInitScript(value => {
        localStorage.setItem('sysgrid-theme', value)
        const stroke = CanvasRenderingContext2D.prototype.stroke
        CanvasRenderingContext2D.prototype.stroke = function (...args: any[]) {
          if (this.canvas.closest('[data-asset-map]')) {
            const colors = (window as any).__mapStrokeColors ||= new Set<string>()
            colors.add(String(this.strokeStyle))
          }
          return stroke.apply(this, args as any)
        }
      }, theme)
      const stamp = `Desktop-${viewport.width}-${Date.now()}`
      const primary = await createAsset(sysApi, { name: `${stamp}-Core`, system: 'Desktop contract', type: 'PDU', status: 'Standby', environment: 'Dev', primary_ip: '192.0.2.10', management_ip: '192.0.2.11' })
      const recovery = await createAsset(sysApi, { name: `${stamp}-Recovery`, system: 'Desktop contract', type: 'UPS', status: 'Planned', environment: 'DR' })
      await createConnection(sysApi, { source_device_id: primary.id, target_device_id: recovery.id, source_port: 'desktop-a', target_port: 'desktop-b', link_type: 'Data', direction: 'Bidirectional' })
      await page.goto('/asset')
      await fillGridSearch(page, 'Scan asset matrix...', stamp)
      await page.getByRole('button', { name: 'Report', exact: true }).click()
      const report = page.locator('[data-asset-report]')
      await report.locator('.asset-report-sidebar').getByRole('button', { name: new RegExp(primary.name) }).click()
      await expect(report.getByRole('heading', { name: primary.name, level: 1 })).toBeVisible()
      const sections = report.getByRole('navigation', { name: 'Report sections' })
      await expect(sections.getByRole('button')).toHaveCount(9)
      await expect(sections).toBeInViewport({ ratio: 1 })
      for (const [label, values] of [
        ['Report asset type', ['PDU', 'UPS', 'Console-Server', 'Patch Panel']],
        ['Report status', ['Standby', 'Planned', 'Decommissioned']],
        ['Report environment', ['Dev', 'QA', 'DR', 'Sandbox', 'Legacy']],
      ] as const) for (const value of values) await expect(report.getByRole('combobox', { name: label }).getByRole('option', { name: value, exact: true })).toHaveAttribute('value', value)
      await report.getByRole('combobox', { name: 'Report environment' }).selectOption('DR')
      await expect(report.getByRole('heading', { name: recovery.name, level: 1 })).toBeVisible()
      await report.getByRole('combobox', { name: 'Report environment' }).selectOption('')
      await report.locator('.asset-report-sidebar').getByRole('button', { name: new RegExp(primary.name) }).click()
      await report.locator('.asset-report-content').evaluate(element => { element.scrollTop = 0 })
      await expectReadableGridText(page, testInfo, 'desktop-report', '.asset-report-sidebar button, .asset-report-record-header, .asset-report-sections, .asset-report-addresses')
      await page.screenshot({ path: testInfo.outputPath('desktop-report.png'), animations: 'disabled' })
      await sections.getByRole('button', { name: 'Relationships', exact: true }).click()
      await expect(report.locator('[data-report-section="relationships"]')).toBeInViewport()
      await expect(report.locator('[data-report-section="relationships"]').getByRole('heading').first()).toBeInViewport({ ratio: 1 })
      expect(await report.locator('.asset-report-content').evaluate(element => element.clientHeight)).toBeGreaterThanOrEqual(320)
      await expect(sections).toBeInViewport({ ratio: 1 })
      await expect(page.locator('[data-sg-shell-header]')).toBeInViewport({ ratio: 1 })
      expect(await page.locator('.sg-app-shell').evaluate(element => element.scrollTop)).toBe(0)
      await page.getByRole('button', { name: 'Map', exact: true }).click()
      const map = page.locator('[data-asset-map]')
      await expect(map.getByText('2 assets', { exact: true })).toBeVisible()
      const color = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--topology-network').trim())
      await expect.poll(() => page.evaluate(value => (window as any).__mapStrokeColors?.has(value) || false, color)).toBeTruthy()
      const contrast = await map.locator('.asset-topology-canvas').evaluate((element, linkColor) => {
        const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!
        canvas.width = canvas.height = 1
        const luminance = (color: string) => {
          context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1)
          return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => {
            const value = channel / 255
            return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
          }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
        }
        const a = luminance(linkColor), b = luminance(getComputedStyle(element).backgroundColor)
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
      }, color)
      expect(contrast, 'Painted network links must be distinguishable from the canvas').toBeGreaterThanOrEqual(3)
      const peerButton = map.getByRole('region', { name: 'Connected assets' }).getByRole('button', { name: recovery.name, exact: true })
      await peerButton.focus()
      await page.keyboard.press('Enter')
      await expect(peerButton).toHaveAttribute('aria-pressed', 'true')
      await expect(map.getByRole('region', { name: 'Selected asset' }).getByRole('heading', { name: recovery.name })).toBeVisible()
      await map.locator('.asset-map-main').scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath('desktop-map.png'), animations: 'disabled' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy()
      await testInfo.attach('desktop-quality-facts', { body: JSON.stringify({ theme, viewport, primary: primary.id, recovery: recovery.id, networkColor: color, networkContrast: contrast }), contentType: 'application/json' })
    })
  }

  test(`desktop form guide keyboard ${theme}`, async ({ page, sysApi }) => {
    await page.setViewportSize({ width: 1280, height: 650 })
    await resetBrowserState(page)
    expect((await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    await page.goto('/asset')
    await page.getByRole('button', { name: 'Register Asset', exact: true }).click()
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Create Asset', exact: true }) })
    await dialog.getByRole('button', { name: /^Enrich/ }).focus()
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('textbox', { name: 'Primary IP', exact: true })).toBeFocused()
    await dialog.getByRole('button', { name: /^Identify/ }).focus()
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('textbox', { name: /^Hostname/ })).toBeFocused()
    await expect(dialog.getByRole('button', { name: 'Save Asset', exact: true })).toBeInViewport({ ratio: 1 })
  })

  test(`desktop configured asset choices ${theme}`, async ({ page, sysApi }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await resetBrowserState(page)
    expect((await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const stamp = `Desktop-config-${Date.now()}`
    const choices = [
      { field: 'type', title: 'Asset Type', category: 'DeviceType', value: `${stamp}-appliance`, label: `Specialized appliance ${stamp.slice(-8)}` },
      { field: 'status', title: 'Status', category: 'Status', value: `${stamp}-acceptance`, label: `Acceptance testing ${stamp.slice(-8)}` },
      { field: 'environment', title: 'Environment', category: 'Environment', value: `${stamp}-validation`, label: `Validation environment ${stamp.slice(-8)}` },
    ]
    for (const { category, value, label } of choices) expect((await sysApi.post(`${apiBase}/settings/options`, { data: { category, value, label } })).ok()).toBeTruthy()
    await page.goto('/asset')
    await page.getByRole('button', { name: 'Register Asset', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Create Asset', exact: true })
    for (const [label, value] of [['Hostname', stamp], ['Logical System', 'Desktop configuration proof'], ['Serial Number', stamp + '-SN'], ['Asset Tag', stamp + '-AT']]) await dialog.getByRole('textbox', { name: new RegExp(`^${label}`) }).fill(value)
    for (const choice of choices) {
      const dropdown = dialog.locator('label').filter({ hasText: choice.title }).locator('..').getByRole('button')
      await dropdown.click()
      const panel = page.locator('[data-workspace-panel="true"]').filter({ has: page.getByPlaceholder('Search options...') })
      await panel.getByPlaceholder('Search options...').fill(choice.value)
      await panel.getByRole('button', { name: choice.label, exact: true }).click()
      await expect(dropdown).toHaveText(choice.label)
    }
    for (const choice of choices.filter(choice => choice.field !== 'type')) {
      const badge = dialog.locator('[data-sg-status-pill]').filter({ hasText: choice.label })
      await expect(badge).toHaveAttribute('title', choice.label)
      expect(await badge.evaluate(element => {
        const text = element.firstElementChild!, box = element.getBoundingClientRect(), bounds = text.getBoundingClientRect()
        return bounds.left >= box.left && bounds.right <= box.right && bounds.top >= box.top && bounds.bottom <= box.bottom
      })).toBe(true)
    }
    await expectReadableGridText(page, testInfo, 'configured-asset-editor', '[role="dialog"]')
    await page.screenshot({ path: testInfo.outputPath('configured-asset-editor.png'), animations: 'disabled' })
    const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/devices' && response.request().method() === 'POST')
    await dialog.getByRole('button', { name: 'Save Asset', exact: true }).click()
    const response = await created
    expect(response.ok()).toBeTruthy()
    const asset = await response.json()
    await expect(dialog).toHaveCount(0)
    const rows = await (await sysApi.get(`${apiBase}/devices`)).json()
    expect(rows.find((row: any) => row.id === asset.id)).toMatchObject(Object.fromEntries(choices.map(choice => [choice.field, choice.value])))
    await fillGridSearch(page, 'Scan asset matrix...', stamp)
    const row = await getWorkspaceLogicalRowByText(page, 'assets', stamp)
    await row.action('More actions').click()
    await page.getByRole('button', { name: 'Edit Configuration', exact: true }).click()
    const editor = page.getByRole('dialog', { name: 'Edit Asset', exact: true })
    for (const choice of choices) await expect(editor.locator('label').filter({ hasText: choice.title }).locator('..').getByRole('button')).toHaveText(choice.label)
    await editor.getByRole('textbox', { name: 'Owner', exact: true }).fill('Desktop configuration owner')
    const updated = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/devices/${asset.id}` && response.request().method() === 'PUT')
    await editor.getByRole('button', { name: 'Save Asset', exact: true }).click()
    const result = await updated
    expect(result.ok()).toBeTruthy()
    expect(result.request().postDataJSON()).toEqual({ owner: 'Desktop configuration owner' })
    const savedRows = await (await sysApi.get(`${apiBase}/devices`)).json()
    expect(savedRows.find((row: any) => row.id === asset.id)).toMatchObject({ ...Object.fromEntries(choices.map(choice => [choice.field, choice.value])), owner: 'Desktop configuration owner' })
  })

  test(`desktop configured choices recover without replacing drafts ${theme}`, async ({ page, sysApi }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await resetBrowserState(page)
    expect((await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const asset = await createAsset(sysApi, { name: `Desktop-recorded-${Date.now()}`, system: 'Recorded configuration proof', type: 'Historical appliance', status: 'Historical status', environment: 'Historical environment' })
    let recover = false, release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/v1/settings/options', async route => {
      if (!recover) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Controlled unavailable configuration' }) })
      await held
      return route.continue()
    })
    try {
      await page.goto('/asset')
      await fillGridSearch(page, 'Scan asset matrix...', asset.name)
      const row = await getWorkspaceLogicalRowByText(page, 'assets', asset.name)
      await row.action('More actions').click()
      await page.getByRole('button', { name: 'Edit Configuration', exact: true }).click()
      const editor = page.getByRole('dialog', { name: 'Edit Asset', exact: true })
      await editor.getByRole('textbox', { name: 'Owner', exact: true }).fill('Draft survives configuration recovery')
      await expect(editor.getByRole('alert')).toContainText('Configured choices could not be loaded.')
      for (const [title, value] of [['Asset Type', asset.type], ['Status', asset.status], ['Environment', asset.environment]]) await expect(editor.locator('label').filter({ hasText: title }).locator('..').getByRole('button')).toHaveText(value)
      recover = true
      await editor.getByRole('button', { name: 'Retry configured choices', exact: true }).click()
      await expect(editor.getByRole('status').filter({ hasText: 'Loading configured choices.' })).toBeVisible()
      await expect(editor.getByRole('textbox', { name: 'Owner', exact: true })).toHaveValue('Draft survives configuration recovery')
      release()
      await expect(editor.getByRole('button', { name: 'Retry configured choices', exact: true })).toHaveCount(0)
      await expect(editor.getByRole('status').filter({ hasText: 'Loading configured choices.' })).toHaveCount(0)
      await expect(editor.getByRole('textbox', { name: 'Owner', exact: true })).toHaveValue('Draft survives configuration recovery')
      for (const [title, value] of [['Asset Type', asset.type], ['Status', asset.status], ['Environment', asset.environment]]) await expect(editor.locator('label').filter({ hasText: title }).locator('..').getByRole('button')).toHaveText(value)
      await editor.locator('label').filter({ hasText: 'Asset Type' }).locator('..').getByRole('button').click()
      await expect(page.locator('[data-workspace-panel="true"]').getByRole('button', { name: asset.type, exact: true })).toBeVisible()
    } finally { release() }
  })

  test(`desktop singleton Map labels ${theme}`, async ({ page, sysApi }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await resetBrowserState(page)
    expect((await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
    await page.addInitScript(value => {
      localStorage.setItem('sysgrid-theme', value)
      const prototype = CanvasRenderingContext2D.prototype, clear = prototype.clearRect, fill = prototype.fillText
      prototype.clearRect = function (...args) {
        if (this.canvas.closest('[data-asset-map]')) (this.canvas as any).paintedLabels = []
        return clear.apply(this, args)
      }
      prototype.fillText = function (text, x, y, ...rest: any[]) {
        if (this.canvas.closest('[data-asset-map]')) {
          const matrix = this.getTransform(), ratio = this.canvas.clientWidth / this.canvas.width
          const width = this.measureText(String(text)).width * Math.hypot(matrix.a, matrix.b) * ratio
          const px = (matrix.a * x + matrix.c * y + matrix.e) * ratio, py = (matrix.b * x + matrix.d * y + matrix.f) * ratio
          ;((this.canvas as any).paintedLabels ||= []).push({ text, left: px - width / 2, right: px + width / 2, top: py, bottom: py + 12, zoom: Math.hypot(matrix.a, matrix.b) * ratio })
        }
        return fill.call(this, text, x, y, ...rest as [number])
      }
    }, theme)
    const asset = await createAsset(sysApi, { name: `Desktop-singleton-${Date.now()}-${'regional-datacenter-asset-'.repeat(6)}`, system: 'Singleton proof' })
    await page.goto('/asset')
    await fillGridSearch(page, 'Scan asset matrix...', asset.name)
    await page.getByRole('button', { name: 'Map', exact: true }).click()
    const map = page.locator('[data-asset-map]'), canvas = map.locator('canvas')
    await expect(map.locator('.asset-map-summary strong')).toHaveText('1 asset')
    const expectFittedLabel = async () => {
      await expect.poll(() => canvas.evaluate(element => {
        const labels = (element as any).paintedLabels || [], host = element.closest('.asset-map-canvas-host')!
        return { count: labels.length, measured: Math.abs(element.clientWidth - host.clientWidth) <= 1 && Math.abs((element as HTMLCanvasElement).width / devicePixelRatio - element.clientWidth) <= 1,
          inside: labels.every((label: any) => label.left >= 0 && label.right <= element.clientWidth && label.top >= 0 && label.bottom <= element.clientHeight),
          bounded: labels.every((label: any) => label.zoom <= 8 && label.right - label.left <= 160.5 && label.text.endsWith('…')) }
      })).toEqual({ count: 1, measured: true, inside: true, bounded: true })
    }
    await expectFittedLabel()
    for (const width of [1024, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await expectFittedLabel()
      await map.getByRole('button', { name: 'Fit all assets', exact: true }).click()
      await expectFittedLabel()
    }
    const connected = map.getByRole('region', { name: 'Connected assets' }).getByRole('button', { name: asset.name, exact: true })
    await connected.focus()
    await page.keyboard.press('Enter')
    await expect(map.getByRole('region', { name: 'Selected asset' }).getByRole('heading', { name: asset.name, exact: true })).toBeVisible()
    await expect(connected).toHaveAttribute('title', asset.name)
    await page.screenshot({ path: testInfo.outputPath('singleton-map-label.png'), animations: 'disabled' })
  })

  for (const scenario of ['initial load', 'fallback recovery'] as const) test(`desktop Asset ${scenario} ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const cached = { id: 900001, name: 'Cached live host', system: 'Loading proof', type: 'Physical', status: 'Active', is_deleted: false }
    let release!: () => void, entered!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const requested = new Promise<void>(resolve => { entered = resolve })
    let fail = scenario === 'fallback recovery', liveRequests = 0
    await page.route('**/api/v1/**', async route => {
      const request = route.request(), url = new URL(request.url())
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.abort('blockedbyclient')
      if (url.pathname === '/api/v1/settings/user/settings') return route.fulfill({ json: { theme } })
      if (url.pathname.replace(/\/$/, '') !== '/api/v1/devices') return route.continue()
      if (url.searchParams.get('include_deleted') !== 'true') {
        liveRequests++
        return route.fulfill({ json: [cached] })
      }
      entered()
      if (scenario === 'initial load') {
        await held
        return route.fulfill({ json: [{ ...cached, name: 'Current registry host' }] })
      }
      return fail ? route.fulfill({ status: 503, json: { detail: 'Controlled registry failure' } }) : route.fulfill({ json: [] })
    })
    try {
      await page.goto('/services')
      await page.waitForLoadState('networkidle')
      expect(liveRequests).toBeGreaterThan(0)
      await page.evaluate(() => {
        ;(window as any).fallbackWarnings = []
        new MutationObserver(() => {
          if (document.body.textContent?.includes('Showing live fallback rows only')) (window as any).fallbackWarnings.push(performance.now())
        }).observe(document.body, { childList: true, subtree: true, characterData: true })
      })
      await page.getByRole('link', { name: 'Assets', exact: true }).click()
      await requested
      await expect(page.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible()
      const notice = page.getByText('Showing live fallback rows only', { exact: true })
      if (scenario === 'initial load') {
        await expect(page.getByText('Loading asset registry…', { exact: true })).toBeVisible()
        const frames = await page.evaluate(async () => {
          const frames = []
          for (let frame = 0; frame < 30; frame++) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
            frames.push(Boolean(document.body.textContent?.includes('Showing live fallback rows only')))
          }
          return frames
        })
        expect(frames).toEqual(Array(30).fill(false))
        expect(await page.evaluate(() => (window as any).fallbackWarnings)).toEqual([])
        await expect(notice).toHaveCount(0)
        await page.screenshot({ path: testInfo.outputPath('asset-pending-with-cache.png'), animations: 'disabled' })
        release()
        const current = await getWorkspaceLogicalRowByText(page, 'assets', 'Current registry host')
        await expect((await current.cell('name')).locator('.operational-grid-primary-text')).toHaveText('Current registry host')
        await expect(notice).toHaveCount(0)
        expect(await page.evaluate(() => (window as any).fallbackWarnings)).toEqual([])
      } else {
        await expect(notice).toBeVisible()
        const cachedRow = await getWorkspaceLogicalRowByText(page, 'assets', cached.name)
        await expect((await cachedRow.cell('name')).locator('.operational-grid-primary-text')).toHaveText(cached.name)
        await page.screenshot({ path: testInfo.outputPath('asset-genuine-fallback.png'), animations: 'disabled' })
        fail = false
        await page.getByRole('link', { name: 'Services', exact: true }).click()
        await page.waitForLoadState('networkidle')
        await page.getByRole('link', { name: 'Assets', exact: true }).click()
        await expect(page.getByText('No assets registered', { exact: true })).toBeVisible()
        await expect(notice).toHaveCount(0)
        await expect(page.getByText(cached.name, { exact: true })).toHaveCount(0)
        await page.screenshot({ path: testInfo.outputPath('asset-empty-after-recovery.png'), animations: 'disabled' })
      }
    } finally { release() }
  })
}
