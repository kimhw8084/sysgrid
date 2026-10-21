import { expect, type Page } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { clickResilientButton, createService, resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const isBatch = (response: any) => response.url().endsWith('/logical-services/bulk-action') && response.request().method() === 'POST'

async function openPreview(page: Page, ids: number[]) {
  for (const id of ids) {
    const row = page.locator(`:is(.ag-pinned-left-cols-container, .ag-center-cols-container) .ag-row[row-id="${id}"]`)
      .filter({ has: page.locator('.ag-selection-checkbox') })
    await expect(row).toHaveCount(1)
    await row.locator('.ag-selection-checkbox').click()
    await expect(row).toHaveAttribute('aria-selected', 'true')
  }
  await clickResilientButton(page, 'Bulk actions')
  await clickResilientButton(page, 'Set Environment')
  await clickResilientButton(page, 'Choose environment')
  const menu = page.locator('[data-workspace-panel="true"]').filter({ has: page.getByPlaceholder('Search options...') }).last()
  await menu.getByRole('button', { name: 'Development', exact: true }).click()
  const pending = page.waitForResponse(isBatch)
  await clickResilientButton(page, 'Apply Environment')
  const response = await pending
  expect(response.status()).toBe(200)
  const preview = await response.json()
  expect(preview.precondition).toMatch(/^[0-9a-f]{64}$/)
  await expect(page.getByRole('heading', { name: 'Services bulk preview', exact: true })).toBeVisible()
  return preview
}

async function expectTopRightNotice(page: Page) {
  const notices = page.locator('[data-workspace-toaster]')
  await expect(notices).toBeVisible()
  const box = await notices.boundingBox()
  expect(box).not.toBeNull()
  const viewport = page.viewportSize()!
  expect(box!.x).toBeGreaterThanOrEqual(8)
  expect(viewport.width - box!.x - box!.width).toBeGreaterThanOrEqual(8)
  expect(viewport.width - box!.x - box!.width).toBeLessThanOrEqual(32)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeLessThanOrEqual(32)
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const width of [1440, 390, 320]) {
    for (const scenario of ['stale-execute', 'fresh-undo', 'stale-undo', 'stale-row-archive']) {
      test(`Service ${scenario} preserves peer data and receipt ownership in ${theme} at ${width}px`, async ({ page, sysApi }, testInfo) => {
        await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 })
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await resetBrowserState(page)
        expect((await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
        await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
        const label = `Bulk guard ${theme} ${scenario} ${width} ${Date.now()}`
        const a = await createService(sysApi, { name: `${label} A`, service_type: 'Database', status: 'Existing', environment: scenario === 'fresh-undo' ? 'Development' : 'Production' })
        const b = await createService(sysApi, { name: `${label} B`, service_type: 'API', status: 'Existing', environment: 'Production' })
        const errors: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        await page.goto('/services')
        await page.getByPlaceholder('Search services, hosts, or metadata...', { exact: true }).fill(label)
        await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(2)
        const rows = async () => {
          const response = await sysApi.get(`${apiBase}/logical-services?include_deleted=true`)
          expect(response.status()).toBe(200)
          return (await response.json()).filter((row: any) => [a.id, b.id].includes(row.id))
        }
        const initial = await rows()
        if (scenario === 'stale-row-archive') {
          const row = page.locator(`.ag-pinned-right-cols-container .ag-row[row-id="${a.id}"]`)
          await row.getByRole('button', { name: 'More actions', exact: true }).click()
          await clickResilientButton(page, 'Archive')
          const peer = await sysApi.put(`${apiBase}/logical-services/${a.id}`, { data: { purpose: 'Peer saved before row confirmation' } })
          expect(peer.status()).toBe(200)
          const before = await rows()
          const pending = page.waitForResponse(isBatch)
          await clickResilientButton(page, 'Confirm Archive?')
          expect((await pending).status()).toBe(200) // Read-only impact check.
          await expect(page.getByText('Services changed since they were loaded. Nothing was changed; refresh and review the selection.', { exact: true })).toBeVisible()
          expect(await rows()).toEqual(before)
        } else {
          const preview = await openPreview(page, [a.id, b.id])
          if (scenario === 'stale-execute') {
            const peer = await sysApi.put(`${apiBase}/logical-services/${a.id}`, { data: { environment: 'Staging' } })
            expect(peer.status()).toBe(200)
            const before = await rows()
            const pending = page.waitForResponse(isBatch)
            await clickResilientButton(page, 'Confirm Apply Environment')
            const rejected = await pending
            expect(rejected.status()).toBe(409)
            expect(rejected.request().postDataJSON()).toMatchObject({ precondition: preview.precondition, operation_id: expect.stringMatching(/^[0-9a-f]{32}$/) })
            await expect(page.getByRole('heading', { name: 'Services bulk preview', exact: true })).toBeVisible()
            await expect(page.getByText('Service preview is stale. Nothing was changed; review a fresh preview.', { exact: true })).toBeVisible()
            expect(await rows()).toEqual(before)
          } else {
            const pending = page.waitForResponse(isBatch)
            await clickResilientButton(page, 'Confirm Apply Environment')
            const applied = await pending
            expect(applied.status()).toBe(200)
            const result = await applied.json()
            expect(applied.request().postDataJSON().precondition).toBe(preview.precondition)
            expect(result.receipt_id).toMatch(/^[0-9a-f]{32}$/)
            expect(result.changed_ids).toEqual(scenario === 'fresh-undo' ? [b.id] : [a.id, b.id])
            const receipt = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Services bulk complete', exact: true }) })
            await expect(receipt).toBeVisible()
            await expect(receipt.getByTestId('bulk-preview-changed')).toHaveText(scenario === 'fresh-undo' ? '1' : '2')
            await expect(receipt).toHaveCSS('opacity', '1')
            await expectReadableGridText(page, testInfo, 'Service bulk receipt', '[data-testid="operational-bulk-result"]')
            const headings = await receipt.locator('[data-testid^="bulk-preview-"]').evaluateAll(values => values.map(value => {
              const label = value.previousElementSibling!
              const range = document.createRange()
              range.selectNodeContents(label)
              return { text: label.textContent, lines: range.getClientRects().length, overflow: label.scrollWidth > label.clientWidth }
            }))
            expect(headings).toHaveLength(3)
            expect(headings.filter(heading => heading.lines !== 1 || heading.overflow), 'Receipt summary labels must remain whole at the selected viewport').toEqual([])
            if (scenario === 'stale-undo') {
              const peer = await sysApi.put(`${apiBase}/logical-services/${a.id}`, { data: { purpose: 'Peer saved after batch' } })
              expect(peer.status()).toBe(200)
            }
            const before = await rows()
            const undoResponse = page.waitForResponse(isBatch)
            await receipt.getByRole('button', { name: 'Undo bulk changes', exact: true }).click()
            const reverted = await undoResponse
            expect(reverted.request().postDataJSON()).toEqual({ action: 'undo', ids: result.changed_ids, receipt_id: result.receipt_id })
            if (scenario === 'stale-undo') {
              expect(reverted.status()).toBe(409)
              await expect(receipt).toBeVisible()
              await expect(page.getByText('Services changed after this operation. Nothing was reverted; review the latest records.', { exact: true })).toBeVisible()
              expect(await rows()).toEqual(before)
            } else {
              expect(reverted.status()).toBe(200)
              await expect(receipt).not.toBeVisible()
              const restored = await rows()
              expect(restored.find((row: any) => row.id === a.id)).toEqual(initial.find((row: any) => row.id === a.id))
              expect(restored.find((row: any) => row.id === b.id)).toMatchObject({ environment: 'Production', is_deleted: false })
              // Successful mutation cleanup must survive clearing the selection.
              await page.locator(`:is(.ag-pinned-left-cols-container, .ag-center-cols-container) .ag-row[row-id="${b.id}"] .ag-selection-checkbox`).click()
              await expect(page.getByRole('button', { name: 'Bulk actions', exact: true })).toBeEnabled()
            }
          }
        }
        await expectTopRightNotice(page)
        expect(errors).toEqual([])
        await page.screenshot({ path: testInfo.outputPath(`${scenario}-${theme}-${width}.png`), animations: 'disabled' })
      })
    }
  }
}
