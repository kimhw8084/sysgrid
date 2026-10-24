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
