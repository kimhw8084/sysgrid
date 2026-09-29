import { expect, type Page, type TestInfo } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, createConnection, createEmbeddedKnowledgeFixture, createMonitoring, createRack, createService, createSite, mountRackDevice, resetBrowserState } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const baselineCapture = process.env.SYSGRID_VISUAL_BASELINE === '1'

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
  const panel = page.getByRole('dialog').locator(':scope > .glass-panel').first()
  if (await panel.count()) await expect(panel).toHaveCSS('opacity', '1')
  await expect(page.getByText('Unexpected Application Error!', { exact: true })).not.toBeVisible()
  if (name === 'home') {
    for (const card of await page.locator('a[aria-label^="Open "] > div[style]').all()) {
      await expect(card).toHaveCSS('opacity', '1')
    }
  }
  const metrics = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    viewport: { width: innerWidth, height: innerHeight },
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    fontFaces: Array.from(document.fonts).map(face => ({ family: face.family, status: face.status, style: face.style, weight: face.weight })),
    fontRequests: performance.getEntriesByType('resource').filter(entry => /\.(woff2?|ttf|otf)(\?|$)/i.test(entry.name)).map(entry => entry.toJSON()),
    layoutShifts: (window as any).__foundationShifts || [],
    tokens: Object.fromEntries(['--bg-primary', '--text-primary', '--text-secondary', '--text-muted', '--accent-primary'].map(key => [key, getComputedStyle(document.documentElement).getPropertyValue(key).trim()])),
  }))
  expect(metrics.overflow).toBeLessThanOrEqual(2)
  if (metrics.viewport.width >= 1024 && !await page.getByRole('dialog').count()) {
    const shell = await page.locator('[data-sg-shell-header]').evaluate(header => {
      const search = header.querySelector('[data-sg-app-search]')!.getBoundingClientRect()
      const tools = header.querySelector(':scope > div > div:last-child')!.getBoundingClientRect()
      return { search: search.toJSON(), tools: tools.toJSON(), overlap: Math.max(0, Math.min(search.right, tools.right) - Math.max(search.left, tools.left)) * Math.max(0, Math.min(search.bottom, tools.bottom) - Math.max(search.top, tools.top)) }
    })
    await testInfo.attach(`${name}-desktop-shell-bounds`, { body: JSON.stringify(shell), contentType: 'application/json' })
    expect.soft(shell.overlap, 'Global search overlaps tenant or app controls').toBeLessThanOrEqual(2)
    const controls = await page.locator('[data-golden-page-toolbar] button, [data-golden-page-toolbar] input:not([type="hidden"]), [data-golden-page-toolbar] select').evaluateAll(nodes => nodes.flatMap(node => {
      const rect = node.getBoundingClientRect()
      if (!rect.width || !rect.height || getComputedStyle(node).visibility === 'hidden') return []
      let left = 0, right = innerWidth
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (/hidden|clip|auto|scroll/.test(getComputedStyle(parent).overflowX)) {
          const bounds = parent.getBoundingClientRect()
          left = Math.max(left, bounds.left)
          right = Math.min(right, bounds.right)
        }
      }
      return [{ name: node.getAttribute('aria-label') || node.getAttribute('title') || node.getAttribute('placeholder') || node.textContent?.trim(), left: rect.left, right: rect.right, clipLeft: left, clipRight: right }]
    }))
    await testInfo.attach(`${name}-desktop-toolbar-bounds`, { body: JSON.stringify(controls), contentType: 'application/json' })
    expect.soft(controls.filter(control => control.left < control.clipLeft - 2 || control.right > control.clipRight + 2), `${name} desktop toolbar controls are horizontally clipped`).toEqual([])
  }
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const { root } = await cdp.send('DOM.getDocument')
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#sg-main-content h1, #sg-main-content h2' })
  expect(nodeId).toBeGreaterThan(0)
  // Platform-font inspection includes direct text children, not nested title spans.
  const descendants = await cdp.send('DOM.querySelectorAll', { nodeId, selector: '*' })
  const fonts = (await Promise.all([nodeId, ...descendants.nodeIds].map(id => cdp.send('CSS.getPlatformFontsForNode', { nodeId: id })))).flatMap(result => result.fonts)
  await cdp.detach()
  await testInfo.attach(`${name}-render-proof`, { body: JSON.stringify({ mode: baselineCapture ? 'baseline' : 'candidate', url: page.url(), browser: page.context().browser()?.version(), metrics, fonts }, null, 2), contentType: 'application/json' })
  if (!baselineCapture) {
    expect(fonts.some(font => font.isCustomFont && /Inter/i.test(font.familyName) && font.glyphCount > 0)).toBeTruthy()
    expect(metrics.fontFaces.some(face => face.family === 'Inter' && face.status === 'loaded')).toBeTruthy()
    expect(metrics.fontRequests.every(entry => new URL(entry.name).origin === new URL(page.url()).origin)).toBeTruthy()
  }
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: 'disabled', fullPage: true })
}

for (const theme of ['nordic-frost-v1', 'pure-clarity'] as const) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
    test(`visual foundation ${theme} ${viewport.width}`, async ({ page, sysApi: request }, testInfo) => {
      await page.setViewportSize(viewport)
      await resetBrowserState(page)
      await page.addInitScript(() => {
        ;(window as any).__foundationShifts = []
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            const shift = entry as any
            if (!shift.hadRecentInput) (window as any).__foundationShifts.push({ value: shift.value, startTime: shift.startTime })
          }
        }).observe({ type: 'layout-shift', buffered: true })
      })
      const settings = await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
      expect(settings.ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      const suffix = `${theme}-${viewport.width}`
      const host = await createAsset(request, {
        name: `orders-primary-${theme === 'pure-clarity' ? 'light' : 'dark'}-${viewport.width}`, system: `Platform ${suffix}`, type: 'Physical',
        status: 'Active', model: 'R740', serial_number: `REFERENCE-${suffix}`, asset_tag: `REF-${suffix}`,
        owner: 'Platform Operations', business_unit: 'Infrastructure', environment: 'Production', primary_ip: '10.42.8.12',
      })
      const service = await createService(request, {
        name: 'Orders database · Primary', service_type: 'Database', status: 'Active', environment: 'Production', device_id: host.id,
        purpose: 'Authoritative order storage for the regional application cluster.',
        version: '16.4', config_json: { endpoint: 'orders-primary.production.internal:5432', replication: { mode: 'synchronous', replicas: 2 }, maintenance_window: 'Sunday 02:00–03:00 UTC', encryption: true },
      })
      const peer = await createAsset(request, {
        name: `orders-standby-${theme === 'pure-clarity' ? 'light' : 'dark'}-${viewport.width}`, system: `Platform ${suffix}`, type: 'Physical',
        status: 'Active', model: 'R740', serial_number: `REFERENCE-PEER-${suffix}`, asset_tag: `REF-PEER-${suffix}`,
        owner: 'Platform Operations', business_unit: 'Infrastructure', environment: 'Production', primary_ip: '10.42.8.13',
      })
      const connection = await createConnection(request, { device_a_id: host.id, source_port: 'eth0', device_b_id: peer.id, target_port: 'eth1', link_type: 'Data', speed_gbps: 10, unit: 'Gbps', status: 'Active' })
      const site = await createSite(request, { name: `Regional hall ${suffix}`, address: 'Reference environment', color: '#2563eb' })
      const rack = await createRack(request, { site_id: site.id, name: 'Database rack A01', aisle: 'A', row: '1', total_u: 12, max_power_kw: 10 })
      await mountRackDevice(request, rack.id, { device_id: host.id, start_u: 1, size_u: 2, orientation: 'Front', depth: 'Full' })
      const recovery = await createEmbeddedKnowledgeFixture(request, host.id, `Database recovery guide ${suffix}`)
      const monitor = await createMonitoring(request, {
        title: 'Database replication lag', device_id: host.id, category: 'App', platform: 'Zabbix', status: 'Existing',
        severity: 'Critical', recovery_docs: [recovery.id], purpose: 'Detect replication delay before the standby falls outside the recovery objective.',
        impact: 'Delayed recovery and stale reads from the standby. Inspect the primary node and replication queue.', notification_method: 'Email',
      })
      await testInfo.attach('reference-fixture', { body: JSON.stringify({ theme, viewport, host, peer, connection, site, rack, service, monitor, recovery }), contentType: 'application/json' })

      for (const route of [
        { path: '/', slug: 'home', heading: null },
        { path: '/asset', slug: 'assets', heading: 'Assets' },
        { path: '/monitoring', slug: 'monitoring', heading: 'Monitoring' },
        { path: '/services', slug: 'services', heading: 'Services' },
        { path: '/network', slug: 'network', heading: 'Network' },
        { path: '/racks', slug: 'racks', heading: 'Racks' },
        { path: '/logs', slug: 'audit', heading: null },
        { path: '/settings', slug: 'settings', heading: null },
      ]) {
        await page.goto(route.path)
        await expect(page.locator('#sg-main-content h1, #sg-main-content h2').first()).toBeVisible()
        if (route.heading) await expect(page.getByRole('heading', { name: route.heading, exact: true })).toBeVisible()
        if (route.slug === 'settings') await expect(page.getByText('Infrastructure Domain', { exact: true })).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await capture(page, testInfo, route.slug)
        if (route.slug === 'racks' && viewport.width >= 1024) {
          const elevation = page.locator(`#racks-grid .glass-panel[data-rack-id="${rack.id}"]`)
          const equipment = elevation.getByText(host.name, { exact: true })
          const geometry = await elevation.evaluate(node => ({ height: node.getBoundingClientRect().height, equipmentViewportHeight: node.querySelector('.overflow-y-auto')?.getBoundingClientRect().height ?? 0 }))
          await testInfo.attach('rack-desktop-equipment-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' })
          expect(geometry.equipmentViewportHeight).toBeGreaterThanOrEqual(120)
          await equipment.scrollIntoViewIfNeeded()
          await expect(equipment).toBeInViewport({ ratio: 0.9 })
          await capture(page, testInfo, 'racks-equipment')
        }
        if (route.slug === 'home') {
          const charts = await page.locator('.recharts-wrapper').evaluateAll(nodes => nodes.map(node => ({
            width: node.getBoundingClientRect().width,
            height: node.getBoundingClientRect().height,
            maxWidth: getComputedStyle(node).maxWidth,
            parentWidth: node.parentElement!.getBoundingClientRect().width,
            svgWidth: node.querySelector(':scope > svg.recharts-surface')?.getBoundingClientRect().width ?? 0,
          })))
          await testInfo.attach('home-chart-geometry', { body: JSON.stringify(charts), contentType: 'application/json' })
          expect(charts).toHaveLength(2)
          for (const chart of charts) {
            expect(chart.width).toBeGreaterThan(180)
            expect(chart.svgWidth).toBeGreaterThan(180)
            expect(chart.height).toBeGreaterThan(100)
          }
          const inventory = await page.getByRole('link', { name: 'Open Infrastructure assets', exact: true }).boundingBox()
          const observations = await page.getByRole('heading', { name: 'Observed health history (24h)', exact: true }).boundingBox()
          expect(inventory!.y + inventory!.height).toBeLessThan(observations!.y)
          await expect(page.getByRole('link', { name: 'Open Infrastructure assets', exact: true })).toBeInViewport()
          await page.getByRole('heading', { name: 'Asset composition', exact: true }).scrollIntoViewIfNeeded()
          await capture(page, testInfo, 'home-inventory-charts')
          await page.getByRole('heading', { name: 'Released entry points', exact: true }).scrollIntoViewIfNeeded()
          await capture(page, testInfo, 'home-activity-and-links')
        }
      }
      // A reload must keep the user's persisted theme identity, including its legacy ID.
      await page.reload()
      await expect(page.getByText('Infrastructure Domain', { exact: true })).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      for (const detail of [
        { path: `/services?id=${service.id}`, slug: 'service-detail', name: service.name },
        { path: `/monitoring?id=${monitor.id}`, slug: 'monitoring-detail', name: monitor.title },
      ]) {
        await page.goto(detail.path)
        const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: detail.name, exact: true }) })
        await expect(dialog).toBeVisible()
        await expect(dialog.locator(':scope > .glass-panel')).toHaveCSS('opacity', '1')
        const bounds = await dialog.locator(':scope > .glass-panel').boundingBox()
        expect(bounds).not.toBeNull()
        for (const button of await dialog.locator('[data-workspace-modal-footer] button').all()) {
          await expect(button).toBeVisible()
          const box = await button.boundingBox()
          expect(box!.x).toBeGreaterThanOrEqual(bounds!.x - 1)
          expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1)
        }
        const closeBox = await dialog.getByTitle('Close', { exact: true }).boundingBox()
        expect(closeBox!.width).toBeGreaterThanOrEqual(44)
        expect(closeBox!.height).toBeGreaterThanOrEqual(44)
        if (detail.slug === 'service-detail') {
          await expect(dialog.getByText('orders-primary.production.internal:5432', { exact: true })).toBeVisible()
          await expect(dialog.getByText(/"mode": "synchronous"/)).toBeVisible()
        }
        await capture(page, testInfo, detail.slug)
        if (detail.slug === 'service-detail') {
          await dialog.getByText(/"mode": "synchronous"/).scrollIntoViewIfNeeded()
          await expect(dialog.getByText(/"mode": "synchronous"/)).toBeInViewport()
          await capture(page, testInfo, 'service-metadata')
        }
        await dialog.getByTitle('Maximize', { exact: true }).click()
        await expect(dialog.getByTitle('Restore size', { exact: true })).toBeVisible()
        await dialog.getByTitle('Restore size', { exact: true }).click()
        await dialog.getByTitle('Close', { exact: true }).click()
        await expect(dialog).not.toBeVisible()
        await expect(page).not.toHaveURL(/[?&]id=/)
      }
      if (!baselineCapture) {
        const faces = await page.evaluate(async () => {
          const normal = await document.fonts.load('900 16px Inter')
          const italic = await document.fonts.load('italic 400 16px Inter')
          return [...normal, ...italic].map(face => ({ family: face.family, status: face.status, style: face.style }))
        })
        expect(faces).toEqual(expect.arrayContaining([
          expect.objectContaining({ family: 'Inter', status: 'loaded', style: 'normal' }),
          expect.objectContaining({ family: 'Inter', status: 'loaded', style: 'italic' }),
        ]))
      }
    })
  }
}
