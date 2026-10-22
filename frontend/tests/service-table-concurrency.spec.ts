import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createService, resetBrowserState } from './helpers/sysgrid'

const api = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const width of [1440, 390]) {
    for (const scenario of ['stale', 'invalid', 'success', 'response-loss']) {
      test(`Service table ${scenario} is atomic in ${theme} at ${width}`, async ({ page, sysApi }, testInfo) => {
        await resetBrowserState(page)
        await page.setViewportSize({ width, height: 900 })
        await page.emulateMedia({ reducedMotion: 'reduce' })
        expect((await sysApi.patch(`${api}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
        const label = `Table ${scenario} ${Date.now()}`
        const a = await createService(sysApi, { name: `${label} A`, service_type: 'Database', purpose: 'Original A', environment: null, currency: null, cost: null, purchase_type: null, installation_date: '2024-01-01T12:34:00' })
        const b = await createService(sysApi, { name: `${label} B`, service_type: 'API', purpose: 'Original B' })
        const read = async () => {
          const response = await sysApi.get(`${api}/logical-services`)
          expect(response.ok()).toBeTruthy()
          return (await response.json()).filter((row: any) => [a.id, b.id].includes(row.id)).sort((x: any, y: any) => x.id - y.id)
        }
        const errors: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        await page.goto('/services')
        await page.getByPlaceholder('Search services, hosts, or metadata...', { exact: true }).fill(label)
        await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(2)
        for (const id of [a.id, b.id]) {
          await page.locator(`:is(.ag-pinned-left-cols-container, .ag-center-cols-container) .ag-row[row-id="${id}"] .ag-selection-checkbox`).click()
        }
        await page.getByRole('button', { name: 'Bulk actions', exact: true }).click()
        await page.getByRole('button', { name: /Bulk Edit Table/ }).click()
        const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Bulk Edit Services', exact: true }) })
        await expect(dialog).toBeVisible()
        const rowA = dialog.getByRole('row').filter({ hasText: a.name })
        const rowB = dialog.getByRole('row').filter({ hasText: b.name })
        await rowA.getByPlaceholder('Purpose', { exact: true }).fill('Draft A')
        await rowB.getByPlaceholder('Purpose', { exact: true }).fill('Draft B')
        if (scenario === 'invalid') await rowB.getByPlaceholder('Cost', { exact: true }).fill('-1')
        if (scenario === 'stale') expect((await sysApi.put(`${api}/logical-services/${b.id}`, { data: { purpose: 'Peer B' } })).ok()).toBeTruthy()
        const before = await read()
        const isSave = (response: any) => response.url().endsWith('/logical-services/table-edit') || (
          response.url().endsWith(`/logical-services/${b.id}`) && response.request().method() === 'PUT')
        const operations: string[] = []
        if (scenario === 'response-loss') {
          await page.route('**/logical-services/table-edit', async route => {
            operations.push(route.request().postDataJSON().operation_id)
            const response = await route.fetch()
            expect(response.ok()).toBeTruthy()
            await route.abort('failed')
          })
          await dialog.getByRole('button', { name: 'Save Bulk Edit', exact: true }).click()
          await expect.poll(() => operations.length).toBe(1)
          await expect.poll(async () => (await read()).map((row: any) => row.purpose)).toEqual(['Draft A', 'Draft B'])
          await expect(dialog.getByRole('button', { name: 'Save Bulk Edit', exact: true })).toBeEnabled()
          const committed = await read()
          await page.unroute('**/logical-services/table-edit')
          const pending = page.waitForResponse(isSave)
          await dialog.getByRole('button', { name: 'Save Bulk Edit', exact: true }).click()
          const replay = await pending
          expect(replay.request().postDataJSON().operation_id).toBe(operations[0])
          expect(replay.status()).toBe(200)
          expect(await read()).toEqual(committed)
        } else {
          const pending = page.waitForResponse(isSave)
          await dialog.getByRole('button', { name: 'Save Bulk Edit', exact: true }).click()
          const response = await pending
          const after = await read()
          await testInfo.attach('table-write-observation', { body: JSON.stringify({ before, after, status: response.status() }), contentType: 'application/json' })
          if (scenario === 'stale' || scenario === 'invalid') {
            expect(after).toEqual(before)
            expect(response.status()).toBe(scenario === 'stale' ? 409 : 422)
            await expect(dialog).toBeVisible()
            await expect(rowA.getByPlaceholder('Purpose', { exact: true })).toHaveValue('Draft A')
          } else {
            expect(response.status()).toBe(200)
            expect(after.map((row: any) => row.purpose)).toEqual(['Draft A', 'Draft B'])
            for (const field of ['environment', 'currency', 'cost', 'purchase_type', 'installation_date']) expect(after[0][field]).toEqual(before[0][field])
          }
        }
        expect(errors).toEqual([])
        await page.screenshot({ path: testInfo.outputPath('service-table.png'), animations: 'disabled' })
      })
    }
  }
}
