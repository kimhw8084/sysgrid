import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { clickResilientButton, createAsset, createMonitoring, createService, resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

async function singleReadableLine(element: Locator, description: string, testInfo: TestInfo) {
  await expect(element).toBeVisible()
  const geometry = await element.evaluate(node => {
    const range = document.createRange()
    range.selectNodeContents(node)
    const lines = new Set(Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0).map(rect => Math.round(rect.top)))
    const style = getComputedStyle(node)
    return { lines: lines.size, width: node.clientWidth, scrollWidth: node.scrollWidth,
      fontFamily: style.fontFamily, fontSize: style.fontSize, whiteSpace: style.whiteSpace,
      wordBreak: style.wordBreak, overflowWrap: style.overflowWrap, fontsStatus: document.fonts.status }
  })
  await testInfo.attach(`readability-${description}`, { body: JSON.stringify(geometry), contentType: 'application/json' }).catch(() => { /* Preserve the original oracle if diagnostics are unavailable. */ })
  expect(geometry.lines, `${description} must not split into narrow fragments`).toBe(1)
  expect(geometry.scrollWidth, `${description} must be fully readable`).toBeLessThanOrEqual(geometry.width + 1)
}

async function singleLineAuditTimestamp(page: Page, testInfo: TestInfo, description: string) {
  const timestamp = page.locator('.ag-row[row-index="0"] [col-id="timestamp"] span[title]').first()
  await expect(timestamp).toBeVisible()
  const geometry = await timestamp.evaluate(node => {
    const range = document.createRange()
    range.selectNodeContents(node)
    const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)
    const cell = node.closest('.ag-cell')!.getBoundingClientRect()
    return { lines: new Set(rects.map(rect => Math.round(rect.top))).size,
      width: node.clientWidth, scrollWidth: node.scrollWidth,
      withinCell: rects.every(rect => rect.top >= cell.top - 1 && rect.bottom <= cell.bottom + 1),
      completeTitle: node.getAttribute('title') === node.textContent }
  })
  await testInfo.attach(`audit-timestamp-${description}`, { body: JSON.stringify(geometry), contentType: 'application/json' }).catch(() => { /* Preserve the original oracle if diagnostics are unavailable. */ })
  expect(geometry.lines, 'The timestamp must stay on one readable row').toBe(1)
  expect(geometry.withinCell, 'Timestamp text must not bleed into another audit row').toBeTruthy()
  expect(geometry.completeTitle, 'The complete value must remain available when visually truncated').toBeTruthy()
  expect(geometry.width).toBeGreaterThan(0)
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const width of [360, 390]) {
    test(`asset summary preserves whole labels and IPv4 in ${theme} at ${width}`, async ({ page, sysApi }, testInfo) => {
      await page.setViewportSize({ width, height: 844 })
      await resetBrowserState(page)
      expect((await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      const asset = await createAsset(sysApi, { name: `Readable asset ${theme}-${width}-${Date.now()}`,
        system: 'Phone summary proof', status: 'Maintenance', type: 'Physical', primary_ip: '192.0.2.10', management_ip: null })
      await page.goto(`/asset?id=${asset.id}`)
      const dialog = page.getByRole('dialog').last()
      await expect(dialog).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('asset-summary.png'), animations: 'disabled' })
      for (const label of ['Operational State', 'Network IP', 'Management IP']) {
        await singleReadableLine(dialog.getByText(label, { exact: true }), label, testInfo)
      }
      for (const value of ['Maintenance', '192.0.2.10', 'Not configured']) {
        await singleReadableLine(dialog.getByText(value, { exact: true }), value, testInfo)
      }
      await expect(dialog.getByRole('button', { name: 'Close', exact: true }).last()).toBeInViewport({ ratio: 1 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy()
    })

    test(`audit action header and commands stay readable in ${theme} at ${width}`, async ({ page, sysApi }, testInfo) => {
      await page.setViewportSize({ width, height: 844 })
      await resetBrowserState(page)
      expect((await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      await createAsset(sysApi, { name: `Audit readability ${theme}-${width}-${Date.now()}`, system: 'Audit proof' })
      await page.goto('/logs')
      await expect(page.getByRole('heading', { name: 'Audit Ledger', exact: true })).toBeVisible()
      const row = page.locator('.ag-pinned-right-cols-container .ag-row').first()
      await expect(row).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('audit-actions.png'), animations: 'disabled' })
      await singleReadableLine(page.locator('.ag-header-cell[col-id="audit-actions"] .ag-header-cell-text'), 'Audit Actions header', testInfo)
      await expect(row.getByRole('button', { name: 'Open target record', exact: true })).toBeInViewport({ ratio: 1 })
      await expect(row.getByRole('button', { name: 'View change payload', exact: true })).toBeInViewport({ ratio: 1 })
      await singleLineAuditTimestamp(page, testInfo, 'default-font')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy()
      for (const boundary of [{ key: 'ArrowLeft', value: '8' }, { key: 'ArrowRight', value: '14' }]) {
        await page.getByRole('button', { name: 'Toggle density controls', exact: true }).click()
        const fontSize = page.getByRole('slider', { name: 'Audit font size', exact: true })
        const density = page.locator('[data-audit-density]')
        await density.scrollIntoViewIfNeeded()
        await expect(density).toBeInViewport({ ratio: 1 })
        await expect(fontSize).toBeInViewport({ ratio: 1 })
        await expect(page.getByRole('slider', { name: 'Audit row density', exact: true })).toBeInViewport({ ratio: 1 })
        await fontSize.focus()
        for (let step = 0; step < 6; step++) await page.keyboard.press(boundary.key)
        await expect(fontSize).toHaveValue(boundary.value)
        await density.scrollIntoViewIfNeeded()
        await expect(density).toBeInViewport({ ratio: 1 })
        await page.screenshot({ path: testInfo.outputPath(`audit-density-font-${boundary.value}.png`), animations: 'disabled' })
        await expectReadableGridText(page, testInfo, `audit-density-font-${boundary.value}`, '[data-audit-density] span')
        for (const name of ['Audit font size', 'Audit row density']) {
          await singleReadableLine(density.locator(`input[aria-label="${name}"] + span`), `${name} value at font ${boundary.value}`, testInfo)
        }
        await page.getByRole('button', { name: 'Close density controls', exact: true }).click()
        await expect(fontSize).toBeHidden()
        await row.scrollIntoViewIfNeeded()
        const header = page.locator('.ag-header-cell[col-id="audit-actions"] .ag-header-cell-text')
        await expect(header).toBeInViewport({ ratio: 1 })
        await page.screenshot({ path: testInfo.outputPath(`audit-actions-font-${boundary.value}.png`), animations: 'disabled' })
        await singleReadableLine(header, `Audit Actions header at font ${boundary.value}`, testInfo)
        await expect(row.getByRole('button', { name: 'Open target record', exact: true })).toBeInViewport({ ratio: 1 })
        await expect(row.getByRole('button', { name: 'View change payload', exact: true })).toBeInViewport({ ratio: 1 })
        await singleLineAuditTimestamp(page, testInfo, `font-${boundary.value}`)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy()
      }
    })
  }

  for (const width of [1440, 390]) {
    test(`monitor service choices expose readable toggle states in ${theme} at ${width}`, async ({ page, sysApi }, testInfo) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await resetBrowserState(page)
      expect((await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      const asset = await createAsset(sysApi, { name: `Coverage asset ${theme}-${width}-${Date.now()}`, system: 'Service selection' })
      const service = await createService(sysApi, { name: `Coverage service ${theme}-${width}-${Date.now()}`,
        service_type: 'Database', status: 'Active', device_id: asset.id })
      const monitor = await createMonitoring(sysApi, { title: `Coverage monitor ${theme}-${width}-${Date.now()}`,
        category: 'Hardware', status: 'Existing', device_id: asset.id })
      await page.goto(`/monitoring?id=${monitor.id}`)
      await clickResilientButton(page, 'Edit Monitor')
      const form = page.getByRole('dialog', { name: 'Update Monitoring', exact: true })
      const choice = form.getByRole('button', { name: service.name, exact: true })
      await choice.scrollIntoViewIfNeeded()
      await expect(choice).toBeInViewport({ ratio: 1 })
      await page.mouse.move(0, 0)
      const selector = `[role="dialog"] button:has-text(${JSON.stringify(service.name)})`
      await page.screenshot({ path: testInfo.outputPath('service-choice-unselected.png'), animations: 'disabled' })
      const choiceGeometry = await choice.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }))
      await testInfo.attach(`service-choice-geometry-${theme}-${width}`, { body: JSON.stringify(choiceGeometry), contentType: 'application/json' })
      expect(choiceGeometry.scrollWidth, 'The complete service name must fit inside its own choice button').toBeLessThanOrEqual(choiceGeometry.width + 1)
      await expectReadableGridText(page, testInfo, `service-choice-unselected-${theme}-${width}`, selector)
      await expect(choice).toHaveAttribute('aria-pressed', 'false')
      await choice.click()
      await expect(choice).toHaveAttribute('aria-pressed', 'true')
      await page.mouse.move(0, 0)
      await page.screenshot({ path: testInfo.outputPath('service-choice-selected.png'), animations: 'disabled' })
      expect(await choice.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'The selected service name must stay inside its button').toBeTruthy()
      await expectReadableGridText(page, testInfo, `service-choice-selected-${theme}-${width}`, selector)
      await choice.focus()
      await page.keyboard.press('Space')
      await expect(choice).toHaveAttribute('aria-pressed', 'false')
      await expect(form.getByRole('button', { name: 'Save Monitoring', exact: true })).toBeInViewport({ ratio: 1 })
    })
  }
}
