import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createConnection, resetBrowserState, seedOperationalScenario } from './helpers/sysgrid'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const width of [320, 390, 1024]) {
    test(`compact workspace access ${theme} ${width}`, async ({ page, sysApi: request }, testInfo) => {
      await page.setViewportSize({ width, height: width === 1024 ? 768 : 720 })
      await resetBrowserState(page)
      const { primary, secondary } = await seedOperationalScenario(request)
      await createConnection(request, { device_a_id: primary.id, source_port: 'eth0', device_b_id: secondary.id, target_port: 'eth1', link_type: 'Data', speed_gbps: 10, unit: 'Gbps', status: 'Active' })
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      const preference = await request.patch(`${process.env.PW_API_BASE}/settings/user/settings`, { data: { theme } })
      expect(preference.ok()).toBeTruthy()
      for (const route of [
        { path: '/monitoring', name: 'Monitoring', identity: 'title' },
        { path: '/asset', name: 'Assets', identity: 'name' },
        { path: '/services', name: 'Services', identity: 'name' },
        { path: '/network', name: 'Network', identity: 'src_node' },
      ]) {
        await page.goto(route.path)
        await expect(page.getByRole('heading', { name: route.name, exact: true })).toBeVisible()
        await page.waitForLoadState('networkidle')
        if (width < 768) {
          const menu = page.getByRole('button', { name: 'Open application navigation', exact: true })
          await expect(menu).toBeVisible()
          await menu.focus()
          await page.keyboard.press('Enter')
          const nav = page.locator('[data-sg-app-sidebar]')
          await expect(nav).toBeVisible()
          await expect(nav.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
          await expect(page.locator('[data-sg-app-main]')).toHaveJSProperty('inert', true)
          const firstPrimaryLink = nav.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Home', exact: true })
          await expect(firstPrimaryLink).toBeFocused()
          const focusStyles = await firstPrimaryLink.evaluate(element => {
            const style = getComputedStyle(element)
            const outline = style.outlineColor
            return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: outline }
          })
          expect(focusStyles.outlineStyle).not.toBe('none')
          expect(Number.parseFloat(focusStyles.outlineWidth)).toBeGreaterThan(0)
          // Traverse the real primary navigation with native Tab and verify each item retains a visible focus indicator.
          for (let step = 0; step < 5; step += 1) {
            await page.keyboard.press('Tab')
            const activeFocus = await page.evaluate(() => {
              const element = document.activeElement
              if (!(element instanceof HTMLElement)) return null
              const style = getComputedStyle(element)
              return { inNavigation: Boolean(element.closest('[data-sg-app-sidebar]')), outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
            })
            expect(activeFocus?.inNavigation).toBeTruthy()
            expect(activeFocus?.outlineStyle).not.toBe('none')
            expect(Number.parseFloat(activeFocus?.outlineWidth ?? '0')).toBeGreaterThan(0)
          }
          await page.keyboard.press('Escape')
          await expect(nav).not.toBeVisible()
          await expect(menu).toBeFocused()
          await expect(page.locator('[data-sg-app-main]')).toHaveJSProperty('inert', false)
          const header = await page.locator('[data-sg-shell-header]').boundingBox()
          expect(header!.height).toBeLessThanOrEqual(180)
          await expect(page.getByRole('button', { name: 'Switch tenant', exact: true })).toBeVisible()
          if (route.path === '/monitoring') {
            await menu.click()
            await nav.getByRole('link', { name: 'Home', exact: true }).click()
            await expect(page).toHaveURL(/\/$/)
            await expect(nav).not.toBeVisible()
            await expect(page.locator('[data-sg-app-main]')).toHaveJSProperty('inert', false)
            await page.goto(route.path)
            await expect(page.getByRole('heading', { name: route.name, exact: true })).toBeVisible()
          }
        }
        const main = page.locator('#sg-main-content')
        const mainOverflowY = await main.evaluate(node => getComputedStyle(node).overflowY)
        if (width < 768) expect(mainOverflowY).toMatch(/auto|scroll/)
        const workspace = page.locator('[data-golden-workspace-shell]')
        const mainBounds = await main.boundingBox()
        const workspaceBounds = await workspace.boundingBox()
        expect(workspaceBounds).not.toBeNull()
        expect(workspaceBounds!.x).toBeGreaterThanOrEqual(mainBounds!.x - 1)
        expect(workspaceBounds!.x + workspaceBounds!.width).toBeLessThanOrEqual(mainBounds!.x + mainBounds!.width + 1)
        if (width >= 768) {
          expect(workspaceBounds!.y).toBeGreaterThanOrEqual(mainBounds!.y - 1)
          expect(workspaceBounds!.y + workspaceBounds!.height).toBeLessThanOrEqual(mainBounds!.y + mainBounds!.height + 1)
        }
        if (width < 768) {
          const record = workspace.locator(`.ag-row[row-index="0"] [col-id="${route.identity}"]`).first()
          await expect(record).not.toHaveText('')
          await testInfo.attach(`${route.name}-first-record`, {
            body: JSON.stringify(await record.evaluate(node => ({ identity: node.textContent, fragment: node.parentElement?.parentElement?.className, bounds: node.getBoundingClientRect().toJSON(), viewport: { width: innerWidth, height: innerHeight } }))),
            contentType: 'application/json',
          })
          await expect(record).toBeInViewport({ ratio: 0.1 })
          await page.screenshot({ path: testInfo.outputPath(`${route.name}-first-view.png`), animations: 'disabled' })
          const tools = workspace.getByRole('button', { name: 'View & filters', exact: true })
          await expect(tools).toHaveAttribute('aria-expanded', 'false')
          await tools.click()
          await expect(tools).toHaveAttribute('aria-expanded', 'true')
          if (route.path === '/network') {
            await expect(workspace.locator('.ag-row[row-index="0"] [col-id="id"]').first()).toBeHidden()
            await expect(workspace.locator('.ag-row[row-index="0"] [col-id="favorite"]').first()).toBeHidden()
            const sourceText = record.locator('span').first()
            const textGeometry = await sourceText.evaluate(node => ({
              clientWidth: node.clientWidth,
              scrollWidth: node.scrollWidth,
              clientHeight: node.clientHeight,
              scrollHeight: node.scrollHeight,
            }))
            expect(textGeometry.scrollWidth).toBeLessThanOrEqual(textGeometry.clientWidth + 1)
            expect(textGeometry.scrollHeight).toBeLessThanOrEqual(textGeometry.clientHeight + 1)
            const actions = workspace.getByRole('button', { name: /^Open actions for / }).first()
            await actions.focus()
            await expect(actions).toBeFocused()
            await page.keyboard.press('Enter')
            const pin = page.getByRole('button', { name: 'Pin connection', exact: true })
            await expect(pin).toBeVisible()
            await pin.click()
            await actions.click()
            await expect(page.getByRole('button', { name: 'Unpin connection', exact: true })).toBeVisible()
          }
        }
        await expect(workspace.getByRole('button', { name: 'Views', exact: true })).toBeVisible()
        await expect(workspace.getByRole('button', { name: 'Display', exact: true })).toBeVisible()
        if (width < 768) {
          await workspace.getByRole('button', { name: 'Views', exact: true }).click()
          const closeViews = page.getByRole('button', { name: 'Close saved views', exact: true })
          await expect(closeViews).toBeVisible()
          await closeViews.click()
          await expect(closeViews).not.toBeVisible()
        }
        for (const toolbar of await workspace.locator('[data-golden-page-toolbar]').all()) {
          const bounds = await toolbar.boundingBox()
          for (const button of await toolbar.getByRole('button').all()) {
            const box = await button.boundingBox()
            if (!box) continue
            expect(box.x).toBeGreaterThanOrEqual(bounds!.x - 1)
            expect(box.x + box.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1)
          }
        }
        // Real wheel input must reach records without programmatically scrolling a hidden ancestor.
        await main.hover()
        await page.mouse.wheel(0, 1000)
        await expect(workspace.locator('[data-golden-grid-surface]').first()).toBeInViewport()
        const geometry = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          scrollTop: document.querySelector('#sg-main-content')!.scrollTop,
        }))
        expect(geometry.overflow).toBeLessThanOrEqual(2)
        if (width < 768) expect(geometry.scrollTop).toBeGreaterThan(0)
        await testInfo.attach(`${route.name}-geometry`, { body: JSON.stringify(geometry), contentType: 'application/json' })
        await page.screenshot({ path: testInfo.outputPath(`${route.name}-records.png`), animations: 'disabled' })
      }
    })
  }
}
