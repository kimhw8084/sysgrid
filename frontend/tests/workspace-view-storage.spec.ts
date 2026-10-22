import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { openToolbarButton, resetBrowserState } from './helpers/sysgrid'

const api = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
for (const workspace of ['services', 'monitoring']) {
  for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
    for (const failure of ['read', 'checkpoint']) {
      test(`${workspace} canonical views survive ${failure} storage failure in ${theme}`, async ({ page, sysApi }, testInfo) => {
        await resetBrowserState(page)
        const width = theme === 'pure-clarity' ? 390 : 1440
        await page.setViewportSize({ width, height: 900 })
        expect((await sysApi.patch(`${api}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
        const suffix = `${workspace}-${failure}-${Date.now()}`
        const canonical = `Canonical ${suffix}`
        const local = `Local ${suffix}`
        const recovered = `Recovered ${suffix}`
        expect((await sysApi.post(`${api}/workspaces/${workspace}/views`, { data: { name: canonical, scope: 'personal', definition: {}, schema_version: 1 } })).ok()).toBeTruthy()
        await page.goto('/')
        await page.waitForLoadState('networkidle')
        await page.addInitScript(({ workspace, failure, local }) => {
          localStorage.setItem(`sysgrid_${workspace}_views_v1`, JSON.stringify([{ id: 'local-retained', name: local, config: {} }]))
          const key = `sysgrid_${workspace}_collaborative_views_v1_migrated`
          const get = Storage.prototype.getItem, set = Storage.prototype.setItem
          Storage.prototype.getItem = function (name) {
            if (name === key && failure === 'read') throw new DOMException('Blocked', 'SecurityError')
            return get.call(this, name)
          }
          Storage.prototype.setItem = function (name, value) {
            if (name === key && failure === 'checkpoint') throw new DOMException('Full', 'QuotaExceededError')
            return set.call(this, name, value)
          }
        }, { workspace, failure, local })
        const errors: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        const openViews = async () => {
          if (width < 768) await page.getByRole('button', { name: 'View & filters', exact: true }).click()
          await openToolbarButton(page, 'Views')
          try {
            await expect(page.getByTestId('workspace-view-sync-status')).toHaveText('Synced')
          } catch (error) {
            try {
              const response = await sysApi.get(`${api}/workspaces/${workspace}/views`)
              const saved = (await response.json()).views.find((view: any) => view.name === recovered)
              const grid = await page.evaluate(() => {
                const api = (window as any).__DEBUG_SERVICES_GRID_API__
                return api?.getColumnState ? { columns: api.getColumnState() } : { unavailable: true }
              })
              await testInfo.attach('canonical-view-geometry', { body: JSON.stringify({ definition: saved?.definition, grid }), contentType: 'application/json' })
            } catch { /* Preserve the original assertion if diagnostic collection fails. */ }
            throw error
          }
          const panel = page.locator('[data-workspace-panel-key="views-menu"]')
          await expect(panel.getByText(canonical, { exact: true })).toBeVisible()
          await expect(panel.getByText(local, { exact: true })).toBeVisible()
          return panel
        }
        await page.goto(`/${workspace}`)
        if (workspace === 'services' && failure === 'read') {
          await page.locator('.ag-header-cell[col-id="id"] .ag-header-cell-text').click()
          await expect(page.locator('.ag-header-cell[col-id="id"]')).toHaveAttribute('aria-sort', 'ascending')
        }
        let panel = await openViews()
        await panel.getByPlaceholder('Save as new personal view...').fill(recovered)
        await panel.getByRole('button', { name: 'Save personal view', exact: true }).click()
        await expect(page).toHaveURL(/(?:\?|&)view=\d+/)
        const names = async () => {
          const response = await sysApi.get(`${api}/workspaces/${workspace}/views`)
          expect(response.ok()).toBeTruthy()
          return (await response.json()).views.map((view: any) => view.name)
        }
        await expect.poll(names).toContain(recovered)
        expect(await names()).not.toContain(local)
        const active = new URL(page.url()).searchParams.get('view')
        const preferenceKey = workspace === 'services' ? 'services_workspace_state_v1' : 'monitoring_workspace_state_v2'
        await expect.poll(async () => {
          const response = await sysApi.get(`${api}/settings/user/settings`)
          expect(response.ok()).toBeTruthy()
          return (await response.json())[preferenceKey]?.activeViewId
        }).toBe(active)
        await page.screenshot({ path: testInfo.outputPath('view-storage-recovery.png'), animations: 'disabled' })
        // Reload the saved link, retaining its selected-view query identity.
        await page.reload()
        panel = await openViews()
        await expect(panel.getByRole('button', { name: new RegExp(`^${recovered} `) })).toBeVisible()
        expect((await names()).filter((name: string) => name === recovered)).toHaveLength(1)
        expect(await names()).not.toContain(local)
        expect(errors).toEqual([])
      })
    }
  }
}
