import { expect, type Page } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const scenario of [{ mode: 'blocked', width: 390 }, { mode: 'blocked', width: 1440 }, { mode: 'held', width: 1440 }]) {
    test(`logic editor ${scenario.mode} download preserves plain text and saving ${theme} ${scenario.width}`, async ({ page, sysApi: request }, info) => {
      await page.setViewportSize({ width: scenario.width, height: 900 })
      await resetBrowserState(page)
      await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto('/monitoring')
      await page.getByRole('button', { name: 'Add Monitoring', exact: true }).click()
      const form = page.getByRole('dialog', { name: 'Add Monitoring', exact: true })
      const title = `Editor ${scenario.mode} ${theme}-${scenario.width}-${Date.now()}`
      await form.getByPlaceholder('e.g. CORE-DB: High CPU Load Alert').fill(title)
      await form.getByPlaceholder('Why are we monitoring this?').fill('Keep logic authoring available during editor download failure')
      await page.waitForLoadState('networkidle')
      let release!: () => void
      const held = new Promise<void>(resolve => { release = resolve })
      let intercepted = 0
      await page.route('**/assets/*.js', async route => {
        intercepted++
        if (scenario.mode === 'blocked') await route.abort('failed')
        else { await held; await route.continue() }
      })
      try {
        await form.getByRole('button', { name: 'Logic', exact: true }).click()
        await form.getByRole('button', { name: 'Add entry', exact: true }).click()
        if (scenario.mode === 'held') {
          await expect(form.getByRole('status').filter({ hasText: 'Loading logic editor' })).toBeVisible()
          await form.getByRole('button', { name: 'Use plain text editor', exact: true }).click()
        } else await expect(form.getByRole('alert').filter({ hasText: 'Enhanced editor unavailable' })).toBeVisible()
        const plain = form.getByRole('textbox', { name: 'Logic Information', exact: true })
        const source = 'CPU > 90%\nAND region = "west"\n# retained without enhanced editor'
        await form.getByPlaceholder('Verification logic purpose').fill('Plain text recovery check')
        await plain.fill(source)
        await plain.focus()
        expect(intercepted).toBeGreaterThan(0)
        if (scenario.mode === 'held') {
          release()
          await expect(form.getByRole('button', { name: 'Use enhanced editor', exact: true })).toBeVisible()
          await expect(plain).toBeFocused()
          await expect(plain).toHaveValue(source)
        }
        await expectReadableGridText(page, info, 'plain-editor-recovery', '#monitoring-logic-root [role="alert"], #monitoring-logic-root [role="status"], #monitoring-logic-root textarea')
        await page.screenshot({ path: info.outputPath('plain-editor-recovery.png'), animations: 'disabled' })
        const saved = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/monitoring')
        await form.getByRole('button', { name: 'Add Monitoring', exact: true }).click()
        const response = await saved
        expect(response.ok()).toBe(true)
        const record = await response.json()
        const readback = await request.get(`${apiBase}/monitoring`)
        expect(readback.ok()).toBe(true)
        const persisted = (await readback.json()).find((item: { id: number }) => item.id === record.id)
        expect(persisted.logic_json[0].logic_info).toBe(source)
        await expect(form).not.toBeVisible()
        expect(errors).toEqual([])
      } finally { release(); await page.unroute('**/assets/*.js') }
    })
  }
}

function observeEditorDownloads(page: Page) {
  const pending: Promise<void>[] = [], downloads: string[] = []
  page.on('response', response => {
    if (!response.ok() || !new URL(response.url()).pathname.endsWith('.js')) return
    pending.push(response.text().then(body => {
      if (body.includes('cm-editor') && body.includes('cm-content')) downloads.push(new URL(response.url()).pathname)
    }))
  })
  return async () => { await Promise.all(pending); return downloads }
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const width of [390, 1440]) {
    test(`logic editor loads on demand and saves multiline content ${theme} ${width}`, async ({ page, sysApi: request }, info) => {
      await page.setViewportSize({ width, height: 900 })
      await resetBrowserState(page)
      await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      const asset = await createAsset(request, { name: `Editor dependency ${theme}-${width}-${Date.now()}`, type: 'Physical', status: 'Active', system: 'Editor loading' })
      const downloads = observeEditorDownloads(page)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto('/asset')
      await expect(page.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible()
      await page.waitForLoadState('networkidle')
      expect(await downloads(), 'Closed Monitoring editor must not load with Assets').toEqual([])
      await page.goto('/monitoring')
      await page.getByRole('button', { name: 'Add Monitoring', exact: true }).click()
      const form = page.getByRole('dialog', { name: 'Add Monitoring', exact: true })
      await expect(form).toBeVisible()
      await page.waitForLoadState('networkidle')
      expect(await downloads(), 'Context tab must not load the hidden editor').toEqual([])
      const title = `Lazy logic ${theme}-${width}-${asset.id}`
      await form.getByPlaceholder('e.g. CORE-DB: High CPU Load Alert').fill(title)
      await form.getByPlaceholder('Why are we monitoring this?').fill('Editor loading and persisted logic recovery')
      await form.getByRole('button', { name: 'Logic', exact: true }).click()
      await form.getByRole('button', { name: 'Add entry', exact: true }).click()
      const editor = form.locator('.cm-content[contenteditable="true"]')
      await expect(editor).toBeVisible()
      expect((await downloads()).length).toBeGreaterThan(0)
      const source = 'CPU > 90%\nAND region = "east"\n# preserve multiline input'
      await form.getByPlaceholder('Verification logic purpose').fill('Regional CPU threshold')
      await editor.fill(source)
      await expectReadableGridText(page, info, 'logic-editor', '#monitoring-logic-root label, #monitoring-logic-root .cm-content, #monitoring-logic-root .cm-content span')
      await page.screenshot({ path: info.outputPath('logic-editor.png'), animations: 'disabled' })
      const saved = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/monitoring')
      await form.getByRole('button', { name: 'Add Monitoring', exact: true }).click()
      const response = await saved
      expect(response.ok()).toBe(true)
      const record = await response.json()
      const readback = await request.get(`${apiBase}/monitoring`)
      expect(readback.ok()).toBe(true)
      const persisted = (await readback.json()).find((item: { id: number }) => item.id === record.id)
      expect(persisted.title).toBe(title)
      expect(persisted.logic_json[0].logic_info).toBe(source)
      await expect(form).not.toBeVisible()
      expect(errors).toEqual([])
    })
  }
}
