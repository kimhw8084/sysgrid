import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, resetBrowserState } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const definitions = [
  { resource: 'hardware', tab: 'hardware', edit: 'Edit hardware component', save: 'Save hardware component', cancel: 'Cancel hardware edit', remove: 'Remove hardware component' },
  { resource: 'relationships', tab: 'relations', edit: 'Edit relationship', save: 'Save relationship', cancel: 'Cancel relationship edit', remove: 'Remove relationship' },
  { resource: 'secrets', tab: 'secrets', edit: 'Edit credential', save: 'Save credential', cancel: 'Cancel credential editing', remove: 'Delete credential' },
] as const

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const definition of definitions) {
    test(`${definition.resource} inline save freezes its draft and permits recovery in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
      await resetBrowserState(page)
      await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      const owner = await createAsset(request, { name: `Inline save ${definition.resource} ${Date.now()}`, system: 'Draft proof' })
      const records = []
      for (const index of [1, 2]) {
        const label = `Draft record ${index}`
        let data: Record<string, unknown>
        if (definition.resource === 'hardware') data = { name: label, category: 'CPU', specs: 'Original specs', count: 1 }
        else if (definition.resource === 'secrets') data = { username: label, secret_type: 'Service Account', notes: 'Original notes', encrypted_payload: 'synthetic-inline-proof-only' }
        else {
          const peer = await createAsset(request, { name: `${label} ${owner.id}`, system: 'Draft proof' })
          data = { target_device_id: peer.id, source_role: 'Consumer', target_role: 'Provider', relationship_type: 'Depends On' }
        }
        const response = await request.post(`${apiBase}/devices/${owner.id}/${definition.resource}`, { data })
        expect(response.ok()).toBeTruthy()
        records.push(await response.json())
      }
      await page.goto(`/asset?id=${owner.id}`)
      const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: owner.name, exact: true }) })
      await dialog.getByRole('button', { name: definition.tab, exact: true }).click()
      await dialog.getByRole('button', { name: definition.edit, exact: true }).first().click()
      const editor = dialog.getByRole('row').filter({ has: page.getByRole('button', { name: definition.save, exact: true }) })
      const field = definition.resource === 'relationships'
        ? editor.getByRole('combobox', { name: 'Local role', exact: true })
        : definition.resource === 'hardware' ? editor.getByRole('spinbutton') : editor.getByRole('textbox').last()
      const changed = definition.resource === 'relationships' ? 'Hypervisor' : definition.resource === 'hardware' ? '3' : 'Retained after failure'
      if (definition.resource === 'relationships') await field.selectOption(changed)
      else await field.fill(changed)

      let release!: () => void
      const held = new Promise<void>(resolve => { release = resolve })
      let requested = false
      let writes = 0
      const path = `**/api/v1/devices/${definition.resource}/${records[0].id}`
      await page.route(path, async route => {
        if (route.request().method() !== 'PUT') return route.continue()
        requested = true
        writes++
        await held
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Controlled inline save failure' }) })
      })
      try {
        await editor.getByRole('button', { name: definition.save, exact: true }).click()
        await expect.poll(() => requested).toBe(true)
        await expect(editor.getByRole('button', { name: definition.save, exact: true })).toBeDisabled()
        await expect(editor.getByRole('button', { name: definition.cancel, exact: true })).toBeDisabled()
        await expect(dialog.getByRole('button', { name: definition.edit, exact: true })).toBeDisabled()
        await expect(dialog.getByRole('button', { name: definition.remove, exact: true })).toBeDisabled()
        for (const control of await editor.locator('input, select, textarea').all()) await expect(control).toBeDisabled()
        await expect(field).toHaveValue(changed)
        expect(writes).toBe(1)
        await page.screenshot({ path: testInfo.outputPath('inline-save-pending.png'), animations: 'disabled' })
      } finally {
        release()
      }
      await expect(editor.getByRole('button', { name: definition.save, exact: true })).toBeEnabled()
      await expect(field).toBeEnabled()
      await expect(field).toHaveValue(changed)
      await page.unroute(path)
      const completed = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/devices/${definition.resource}/${records[0].id}`))
      await editor.getByRole('button', { name: definition.save, exact: true }).click()
      expect((await completed).ok()).toBeTruthy()
      await expect(dialog.getByRole('button', { name: definition.edit, exact: true })).toHaveCount(2)
      const storedResponse = await request.get(`${apiBase}/devices/${owner.id}/${definition.resource}`)
      expect(storedResponse.ok()).toBeTruthy()
      const stored = (await storedResponse.json()).find((row: any) => row.id === records[0].id)
      expect(stored[definition.resource === 'relationships' ? 'source_role' : definition.resource === 'hardware' ? 'count' : 'notes']).toBe(definition.resource === 'hardware' ? 3 : changed)
      await dialog.getByRole('button', { name: definition.edit, exact: true }).last().click()
      await expect(editor.getByRole('button', { name: definition.save, exact: true })).toBeEnabled()
      await editor.getByRole('button', { name: definition.cancel, exact: true }).click()
      await expect(dialog.getByRole('button', { name: definition.edit, exact: true })).toHaveCount(2)
    })
  }
}
