import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, createConnection, resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const width of [1440, 390]) {
    test(`Direct-link copying reports actual clipboard results in ${theme} at ${width}`, async ({ page, sysApi: request }, testInfo) => {
      await resetBrowserState(page)
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
      expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
      await page.addInitScript(value => {
        localStorage.setItem('sysgrid-theme', value)
        const state = { calls: [] as string[], resolve: () => {}, reject: (_error: Error) => {} }
        ;(window as any).__shareClipboard = state
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
          writeText: (text: string) => new Promise<void>((resolve, reject) => {
            state.calls.push(text); state.resolve = resolve; state.reject = reject
          }),
        } })
      }, theme)
      const stamp = `${Date.now()}-${theme}-${width}`
      const source = await createAsset(request, { name: `Copy source ${stamp}`, system: 'Clipboard proof' })
      const peer = await createAsset(request, { name: `Copy peer ${stamp}`, system: 'Clipboard proof' })
      const connection = await createConnection(request, { device_a_id: source.id, device_b_id: peer.id,
        source_port: 'eth0', target_port: 'eth1', link_type: 'Data', status: 'Active' })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`/network?id=${connection.id}`)
      const detail = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Connection Forensics' }) })
      await expect(detail).toBeVisible()
      await expect(detail.locator(':scope > .glass-panel')).toHaveCSS('opacity', '1')
      const button = detail.getByRole('button', { name: 'Share direct link', exact: true })
      await expect(button).toBeInViewport({ ratio: 1 })
      const bounds = await button.boundingBox()
      expect(bounds!.width).toBeGreaterThanOrEqual(44)
      expect(bounds!.height).toBeGreaterThanOrEqual(44)
      const locationBefore = page.url()
      await button.focus()
      await page.keyboard.press('Enter')
      await expect(button).toBeDisabled()
      await expect(button).toHaveAttribute('aria-busy', 'true')
      const success = page.getByText('Direct link copied to clipboard', { exact: true })
      const failure = page.getByText('Could not copy the link. Check clipboard access and try again.', { exact: true })
      await expect(success).toHaveCount(0)
      expect(await page.evaluate(() => (window as any).__shareClipboard.calls.length)).toBe(1)
      await page.evaluate(() => (window as any).__shareClipboard.reject(new DOMException('Clipboard denied', 'NotAllowedError')))
      await expect(failure).toBeVisible()
      await expect(success).toHaveCount(0)
      await expect(button).toBeEnabled()
      await expect(button).toHaveAttribute('aria-busy', 'false')
      await expectReadableGridText(page, testInfo, 'copy-failure', '[data-workspace-toast="error"]')
      await page.screenshot({ path: testInfo.outputPath('copy-failure.png'), animations: 'disabled' })
      await button.focus()
      await page.keyboard.press('Enter')
      await expect(button).toBeDisabled()
      await expect(success).toHaveCount(0)
      await page.evaluate(() => (window as any).__shareClipboard.resolve())
      await expect(success).toBeVisible()
      await expect(failure).toHaveCount(0)
      await expect(button).toBeEnabled()
      const copied = await page.evaluate(() => (window as any).__shareClipboard.calls as string[])
      expect(copied).toEqual([locationBefore, locationBefore])
      expect(page.url()).toBe(locationBefore)
      await expectReadableGridText(page, testInfo, 'copy-success', '[data-workspace-toast="success"]')
      const noticeBounds = await page.locator('[data-workspace-toast="success"]').boundingBox()
      expect(noticeBounds!.height).toBeLessThanOrEqual(110)
      await page.screenshot({ path: testInfo.outputPath('copy-success.png'), animations: 'disabled' })
      const dismissNotice = page.locator('[data-workspace-toast][data-visible="true"]').getByRole('button', { name: 'Dismiss notification' })
      while (await dismissNotice.count()) await dismissNotice.first().click()
      await expect(failure).toHaveCount(0)
      await expect(success).toHaveCount(0)
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }))
      await button.click()
      await expect(failure).toBeVisible()
      await expect(success).toHaveCount(0)
      await expect(button).toBeEnabled()
      expect(await page.evaluate(() => (window as any).__shareClipboard.calls.length)).toBe(2)
      expect(errors).toEqual([])
      await testInfo.attach('clipboard-facts', { body: JSON.stringify({ bounds, noticeBounds, writes: copied.length, deniedThenRetried: true, unavailableHandled: true, pageErrors: errors }), contentType: 'application/json' })
    })
  }
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const width of [1440, 390]) {
    for (const custom of [false, true]) {
      test(`Network detail is readable without unused queries for ${custom ? 'custom endpoints' : 'linked assets'} in ${theme} at ${width}`, async ({ page, sysApi: request }, testInfo) => {
        await resetBrowserState(page)
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
        expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
        await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
        const stamp = `${Date.now()}-${theme}-${width}`
        const source = await createAsset(request, { name: `Source ${stamp}`, system: 'Detail proof' })
        const peer = await createAsset(request, { name: `Peer ${stamp}`, system: 'Detail proof' })
        const connection = await createConnection(request, { device_a_id: source.id, device_b_id: peer.id,
          source_port: 'eth0', target_port: 'eth1', link_type: 'Data', speed_gbps: 10, unit: 'Gbps', status: 'Active',
          purpose: 'Production connection detail evidence', direction: 'Bidirectional' })
        if (custom) {
          // Existing custom-IP rows are readable, but creation requires assets.
          // Project a legacy row into this read response without altering storage.
          await page.route('**/api/v1/networks/connections*', async route => {
            if (route.request().method() !== 'GET') return route.continue()
            const response = await route.fetch()
            const rows = await response.json()
            if (!Array.isArray(rows)) return route.fulfill({ response })
            await route.fulfill({ response, json: rows.map(row => row.id === connection.id ? {
              ...row, source_device_id: null, target_device_id: null,
              server_a: 'Custom source endpoint', server_b: 'Custom peer endpoint',
              source_ip: '192.0.2.10', target_ip: '198.51.100.20',
            } : row) })
          })
        }
        const knowledgeRequests: string[] = []
        page.on('request', req => { if (new URL(req.url()).pathname === '/api/v1/knowledge') knowledgeRequests.push(new URL(req.url()).search) })
        await page.goto(`/network?id=${connection.id}`)
        const detail = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Connection Forensics' }) })
        await expect(detail).toBeVisible()
        await expect(detail.locator(':scope > .glass-panel')).toHaveCSS('opacity', '1')
        const assetButtons = detail.getByRole('button', { name: 'Open asset', exact: true })
        await expect(assetButtons).toHaveCount(2)
        if (custom) {
          await expect(assetButtons.nth(0)).toBeDisabled()
          await expect(assetButtons.nth(1)).toBeDisabled()
          await expect(detail).toContainText('192.0.2.10')
          await expect(detail).toContainText('198.51.100.20')
        } else {
          await expect(assetButtons.nth(0)).toBeEnabled()
          await expect(assetButtons.nth(1)).toBeEnabled()
        }
        const samples = []
        for (const label of ['Source endpoint', 'Peer endpoint', 'Purpose and routing', 'Capacity and audit']) {
          const heading = detail.getByText(label, { exact: true })
          await heading.scrollIntoViewIfNeeded()
          await expect(heading).toBeInViewport({ ratio: 0.9 })
          const fonts = await detail.locator('[data-workspace-modal-body]').evaluate(element => {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
            const result = []
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const parent = node.parentElement!
              const bounds = parent.getBoundingClientRect()
              if (!node.textContent?.trim() || !bounds.width || !bounds.height || bounds.bottom <= 0 || bounds.top >= innerHeight || parent.closest('[disabled]')) continue
              result.push({ text: node.textContent.trim(), size: parseFloat(getComputedStyle(parent).fontSize) })
            }
            return result
          })
          samples.push({ label, fonts })
          expect.soft(fonts.filter(sample => sample.size < 12), 'detail text must be at least 12px').toEqual([])
          await page.screenshot({ path: testInfo.outputPath(`network-detail-${label.replaceAll(' ', '-')}.png`), animations: 'disabled' })
          await expectReadableGridText(page, testInfo, label, '[role="dialog"] [data-workspace-modal-body]')
        }
        const bounds = await detail.locator('[data-workspace-modal-body]').evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }))
        expect(bounds.scroll - bounds.client).toBeLessThanOrEqual(1)
        expect(knowledgeRequests, 'detail has no consumer for Knowledge query results').toEqual([])
        await testInfo.attach('network-detail-facts', { body: JSON.stringify({ samples, bounds, knowledgeRequests, customResponseOnly: custom }), contentType: 'application/json' })
        if (!custom) {
          await assetButtons.nth(1).scrollIntoViewIfNeeded()
          await assetButtons.nth(1).click()
          await expect(page).toHaveURL(url => url.pathname === '/asset' && url.searchParams.get('id') === String(peer.id))
        } else {
          await page.keyboard.press('Escape')
          await expect(detail).not.toBeVisible()
        }
      })
    }
  }
}
