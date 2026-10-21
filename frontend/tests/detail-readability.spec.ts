import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { clickResilientButton, createAsset, createMonitoring, createService, expectHeaderBodyAligned, resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

test.describe('readability measurement controls', () => {
  test('alignment measurement observes one grid revision during resizing', async ({ page }) => {
    await page.setContent('<div class="ag-header-cell" col-id="user_id" style="position:absolute;left:20px;top:20px;width:150px;height:30px">Heading</div><div class="ag-row" row-index="0"><div class="ag-cell" col-id="user_id" style="position:absolute;left:20px;top:60px;width:150px;height:30px">Actor</div></div>')
    const resize = () => page.evaluate(() => document.querySelectorAll<HTMLElement>('[col-id="user_id"]').forEach(node => {
      node.style.left = '40px'
      node.style.width = '166px'
    }))
    const wrap = (locator: Locator): Locator => new Proxy(locator, {
      get(target, key) {
        if (key === 'first') return () => wrap(target.first())
        if (key === 'evaluate') return async (operation: any, argument: any) => {
          const value = await target.evaluate(operation, argument)
          await resize()
          return value
        }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const controlled = new Proxy(page, {
      get(target, key) {
        if (key === 'locator') return (selector: string) => wrap(target.locator(selector))
        if (key === 'evaluate') return async (operation: any, argument: any) => {
          await resize()
          return target.evaluate(operation, argument)
        }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    await expectHeaderBodyAligned(controlled, 'user_id', 1, 1)
  })

  for (const fault of ['position', 'width']) test(`alignment measurement rejects a real ${fault} mismatch`, async ({ page }) => {
    await page.setContent(`<div class="ag-header-cell" col-id="user_id" style="position:absolute;left:20px;top:20px;width:150px;height:30px">Heading</div><div class="ag-row" row-index="0"><div class="ag-cell" col-id="user_id" style="position:absolute;left:${fault === 'position' ? 25 : 20}px;top:60px;width:${fault === 'width' ? 155 : 150}px;height:30px">Actor</div></div>`)
    await expect(expectHeaderBodyAligned(page, 'user_id', 1, 1)).rejects.toThrow('Header/Body alignment mismatch')
  })

  test('measures the current label after replacement during locator resolution', async ({ page }, testInfo) => {
    await page.setContent('<span id="readability-control" style="display:inline-block;font:14px Arial;white-space:nowrap">Audit Actions</span>')
    const label = page.locator('#readability-control')
    const replace = () => label.evaluate(node => node.replaceWith(node.cloneNode(true)))
    const controlled = new Proxy(label, {
      get(target, property) {
        if (property === 'evaluate') return async (operation: any, argument: any) => {
          const handle = await target.elementHandle()
          expect(handle).not.toBeNull()
          await replace()
          try { return await handle!.evaluate(operation, argument) } finally { await handle!.dispose() }
        }
        if (property === 'evaluateAll') return async (operation: any, argument: any) => {
          const handle = await target.page().evaluateHandle(() => Array.from(document.querySelectorAll('#readability-control')))
          await replace()
          try { return await handle.evaluate(operation, argument) } finally { await handle.dispose() }
        }
        if (property === 'page') return () => new Proxy(target.page(), {
          get(currentPage, method) {
            if (method === 'evaluate') return async (operation: any, argument: any) => {
              await replace()
              return currentPage.evaluate(operation, argument)
            }
            const value = Reflect.get(currentPage, method)
            return typeof value === 'function' ? value.bind(currentPage) : value
          },
        })
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    try {
      await singleReadableLine(controlled, 'replacement control', testInfo, { selector: '#readability-control' })
    } finally {
      await label.evaluateAll(nodes => nodes.forEach(node => node.remove()))
      await expect(label).toHaveCount(0)
    }
  })

  test('measures the current timestamp after replacement during locator resolution', async ({ page }, testInfo) => {
    const selector = '.ag-row[row-index="0"] [col-id="timestamp"] span[title]'
    await page.setContent('<div class="ag-row" row-index="0"><div class="ag-cell" col-id="timestamp" style="width:240px;height:32px"><span style="display:inline-block;white-space:nowrap;font:14px Arial" title="2026-10-20 00:00:00">2026-10-20 00:00:00</span></div></div>')
    const timestamp = page.locator(selector).first()
    const replace = () => page.locator('.ag-row').evaluate(node => node.replaceWith(node.cloneNode(true)))
    const controlledTimestamp: Locator = new Proxy(timestamp, {
      get(target, property) {
        if (property === 'first') return () => controlledTimestamp
        if (property === 'evaluateAll') return async (operation: any, argument: any) => {
          const handle = await page.evaluateHandle(selector => Array.from(document.querySelectorAll(selector)), selector)
          await replace()
          try { return await handle.evaluate(operation, argument) } finally { await handle.dispose() }
        }
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const controlledPage = new Proxy(page, {
      get(target, property) {
        if (property === 'locator') return () => controlledTimestamp
        if (property === 'evaluate') return async (operation: any, argument: any) => {
          await replace()
          return target.evaluate(operation, argument)
        }
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    try {
      await singleLineAuditTimestamp(controlledPage, testInfo, 'replacement-control')
    } finally {
      await page.locator('.ag-row').evaluateAll(nodes => nodes.forEach(node => node.remove()))
      await expect(timestamp).toHaveCount(0)
    }
  })

  test('keeps sound geometry valid when its diagnostic provider fails', async ({ page }, testInfo) => {
    await page.setContent('<span id="readability-control" style="display:inline-block;font:14px Arial;white-space:nowrap">Audit Actions</span>')
    const label = page.locator('#readability-control')
    const provider = { attach: async () => { throw new Error('controlled diagnostic failure') } } as unknown as TestInfo
    try { await singleReadableLine(label, 'sound control', provider, { selector: '#readability-control' }) } finally {
      await label.evaluateAll(nodes => nodes.forEach(node => node.remove()))
      await expect(label).toHaveCount(0)
    }
    await testInfo.attach('readability-provider-control', { body: 'sound geometry retained; cleanup complete', contentType: 'text/plain' })
  })

  for (const fault of ['wrapped', 'clipped'] as const) {
    for (const providerFails of [false, true]) {
      test(`rejects ${fault} text with diagnostic failure ${providerFails}`, async ({ page }, testInfo) => {
        const whiteSpace = fault === 'wrapped' ? 'normal' : 'nowrap'
        await page.setContent(`<span id="readability-control" style="display:inline-block;width:45px;font:14px Arial;white-space:${whiteSpace};overflow:hidden">Audit Actions</span>`)
        const label = page.locator('#readability-control')
        let measured: { lines: number; width: number; scrollWidth: number } | undefined
        const provider = { attach: async (_name: string, options: { body: string }) => {
          measured = JSON.parse(options.body)
          if (providerFails) throw new Error('controlled diagnostic failure')
        } } as unknown as TestInfo
        try {
          await expect(singleReadableLine(label, `${fault} control`, provider, { selector: '#readability-control' })).rejects.toThrow(fault === 'wrapped' ? 'must not split into narrow fragments' : 'must be fully readable')
          expect(measured).toBeDefined()
          if (fault === 'wrapped') expect(measured!.lines).toBeGreaterThan(1)
          else {
            expect(measured!.lines).toBe(1)
            expect(measured!.scrollWidth).toBeGreaterThan(measured!.width + 1)
          }
          await testInfo.attach('readability-fault-control', { body: JSON.stringify({ fault, providerFails, measured }), contentType: 'application/json' })
        } finally {
          await label.evaluateAll(nodes => nodes.forEach(node => node.remove()))
          await expect(label).toHaveCount(0)
        }
      })
    }
  }

  test('rejects a label removed before atomic measurement', async ({ page }, testInfo) => {
    await page.setContent('<span id="readability-control">Audit Actions</span>')
    const label = page.locator('#readability-control')
    const controlled = new Proxy(label, {
      get(target, property) {
        if (property === 'evaluateAll') return async (operation: any, argument: any) => {
          await target.evaluateAll(nodes => nodes.forEach(node => node.remove()))
          return target.evaluateAll(operation, argument)
        }
        if (property === 'page') return () => new Proxy(target.page(), {
          get(currentPage, method) {
            if (method === 'evaluate') return async (operation: any, argument: any) => {
              await target.evaluateAll(nodes => nodes.forEach(node => node.remove()))
              return currentPage.evaluate(operation, argument)
            }
            const value = Reflect.get(currentPage, method)
            return typeof value === 'function' ? value.bind(currentPage) : value
          },
        })
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    try {
      await expect(singleReadableLine(controlled, 'missing control', testInfo, { selector: '#readability-control' })).rejects.toThrow('must not split into narrow fragments')
    } finally {
      await label.evaluateAll(nodes => nodes.forEach(node => node.remove()))
      await expect(label).toHaveCount(0)
    }
  })
})

async function attachGeometry(testInfo: TestInfo, name: string, geometry: unknown) {
  await testInfo.attach(name, { body: JSON.stringify(geometry), contentType: 'application/json' }).catch(() => { /* Preserve the original oracle if diagnostics are unavailable. */ })
}

type ReadabilityTarget = { selector: string; scope?: string; text?: string }

async function singleReadableLine(element: Locator, description: string, testInfo: TestInfo, target: ReadabilityTarget) {
  await expect(element).toBeVisible()
  const geometry = await element.page().evaluate(target => {
    // Query inside this synchronous callback; locator array handles can already be stale.
    const visible = (node: Element) => {
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return node.isConnected && rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.visibility !== 'collapse'
    }
    const root = target.scope ? Array.from(document.querySelectorAll(target.scope)).filter(visible).at(-1) : document
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
    const matchesText = (node: Element) => normalize(node.textContent || '') === target.text
    const nodes = Array.from(root?.querySelectorAll<HTMLElement>(target.selector) || []).filter(node =>
      visible(node) && (target.text === undefined || (matchesText(node) && !Array.from(node.children).some(matchesText))))
    const node = nodes[0]
    if (nodes.length !== 1 || !node) return { lines: 0, width: 0, scrollWidth: 0, connected: false, matchingNodes: nodes.length }
    const range = document.createRange()
    range.selectNodeContents(node)
    const lines = new Set(Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0).map(rect => Math.round(rect.top)))
    const style = getComputedStyle(node)
    return { lines: lines.size, width: node.clientWidth, scrollWidth: node.scrollWidth,
      fontFamily: style.fontFamily, fontSize: style.fontSize, whiteSpace: style.whiteSpace,
      wordBreak: style.wordBreak, overflowWrap: style.overflowWrap, fontsStatus: document.fonts.status, connected: node.isConnected }
  }, target)
  await attachGeometry(testInfo, `readability-${description}`, geometry)
  expect(geometry.lines, `${description} must not split into narrow fragments`).toBe(1)
  expect(geometry.scrollWidth, `${description} must be fully readable`).toBeLessThanOrEqual(geometry.width + 1)
  expect(geometry.connected, `${description} must belong to the current document`).toBeTruthy()
  expect(geometry.width, `${description} must have a visible width`).toBeGreaterThan(0)
}

async function singleLineAuditTimestamp(page: Page, testInfo: TestInfo, description: string) {
  const timestamp = page.locator('.ag-row[row-index="0"] [col-id="timestamp"] span[title]').first()
  await expect(timestamp).toBeVisible()
  const geometry = await page.evaluate(() => {
    const node = document.querySelector<HTMLElement>('.ag-row[row-index="0"] [col-id="timestamp"] span[title]')
    const cellNode = node?.closest('.ag-cell')
    if (!node || !cellNode) return { lines: 0, width: 0, scrollWidth: 0, withinCell: false, completeTitle: false, connected: false }
    const range = document.createRange()
    range.selectNodeContents(node)
    const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)
    const cell = cellNode.getBoundingClientRect()
    return { lines: new Set(rects.map(rect => Math.round(rect.top))).size,
      width: node.clientWidth, scrollWidth: node.scrollWidth,
      withinCell: rects.every(rect => rect.top >= cell.top - 1 && rect.bottom <= cell.bottom + 1),
      completeTitle: node.getAttribute('title') === node.textContent, connected: node.isConnected }
  })
  await attachGeometry(testInfo, `audit-timestamp-${description}`, geometry)
  expect(geometry.lines, 'The timestamp must stay on one readable row').toBe(1)
  expect(geometry.connected, 'The measured timestamp must belong to the current grid').toBeTruthy()
  expect(geometry.withinCell, 'Timestamp text must not bleed into another audit row').toBeTruthy()
  expect(geometry.completeTitle, 'The complete value must remain available when visually truncated').toBeTruthy()
  expect(geometry.width).toBeGreaterThan(0)
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) for (const width of [1440, 390, 320]) {
  test(`audit Administrator and Operation headers stay whole through empty and populated results in ${theme} at ${width}`, async ({ page, sysApi }, testInfo) => {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await resetBrowserState(page)
    expect((await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const asset = await createAsset(sysApi, { name: `Administrator heading ${theme}-${width}-${Date.now()}`, system: 'Audit heading proof' })
    await page.goto(`/logs?target_table=devices&target_id=${asset.id}`)
    const rows = page.locator('.ag-center-cols-container .ag-row')
    await expect(rows).toHaveCount(1)
    const end = page.getByLabel('Audit end date', { exact: true })
    const emptyResponse = page.waitForResponse(response => {
      const url = new URL(response.url())
      return url.pathname === '/api/v1/audit' && url.searchParams.get('target_id') === String(asset.id) && url.searchParams.has('end_before')
    })
    await end.fill('2000-01-01')
    const response = await emptyResponse
    expect(response.ok()).toBeTruthy()
    expect(await response.json()).toEqual([])
    await expect(rows).toHaveCount(0)
    await page.waitForLoadState('networkidle')
    const checkHeader = async (state: string) => {
      await expect(page.locator('.ag-pinned-left-header .ag-header-cell[col-id="timestamp"]')).toHaveCount(page.viewportSize()!.width < 768 ? 0 : 1)
      await page.locator('[data-audit-ledger] .ag-header').scrollIntoViewIfNeeded()
      for (const [columnId, label, stem] of [['user_id', 'ADMINISTRATOR', 'administrator'], ['action', 'OPERATION', 'operation']]) {
        const header = page.locator(`.ag-header-cell[col-id="${columnId}"] .ag-header-cell-text`)
        await page.evaluate(columnId => {
          const cell = document.querySelector<HTMLElement>(`.ag-header-cell[col-id="${columnId}"]`)!
          const scroller = document.querySelector<HTMLElement>('.ag-center-cols-viewport')!
          scroller.scrollLeft = cell.offsetLeft
        }, columnId)
        await expect(header).toHaveText(label)
        await expect(header).toBeInViewport({ ratio: 1 })
        if (await rows.count()) {
          await expectHeaderBodyAligned(page, columnId, 1, 1)
        }
        await page.screenshot({ path: testInfo.outputPath(`audit-${stem}-${state}.png`), animations: 'disabled' })
        await singleReadableLine(header, `${label} header ${state}`, testInfo, { selector: `.ag-header-cell[col-id="${columnId}"] .ag-header-cell-text` })
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy()
    }
    await checkHeader('empty-default')
    for (const boundary of [{ key: 'ArrowLeft', value: '8' }, { key: 'ArrowRight', value: '14' }]) {
      await page.getByRole('button', { name: 'Toggle density controls', exact: true }).click()
      const font = page.getByRole('slider', { name: 'Audit font size', exact: true })
      await font.scrollIntoViewIfNeeded()
      await font.focus()
      for (let step = 0; step < 6; step++) await page.keyboard.press(boundary.key)
      await expect(font).toHaveValue(boundary.value)
      await page.getByRole('button', { name: 'Close density controls', exact: true }).click()
      await expect(font).toBeHidden()
      await checkHeader(`empty-font-${boundary.value}`)
      await end.clear()
      await expect(rows).toHaveCount(1)
      await page.waitForLoadState('networkidle')
      await checkHeader(`populated-font-${boundary.value}`)
      await end.fill('2000-01-01')
      await expect(rows).toHaveCount(0)
      await page.waitForLoadState('networkidle')
      await checkHeader(`empty-again-font-${boundary.value}`)
    }
    await end.clear()
    await expect(rows).toHaveCount(1)
    await page.waitForLoadState('networkidle')
    await checkHeader('repopulated')
    await page.setViewportSize({ width: width <= 390 ? 1440 : 390, height: width <= 390 ? 1000 : 844 })
    await checkHeader('resized')
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 })
    await checkHeader('original-viewport')
    expect(errors).toEqual([])
  })
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
        await singleReadableLine(dialog.getByText(label, { exact: true }), label, testInfo, { scope: '[role="dialog"]', selector: '*', text: label })
      }
      for (const value of ['Maintenance', '192.0.2.10', 'Not configured']) {
        await singleReadableLine(dialog.getByText(value, { exact: true }), value, testInfo, { scope: '[role="dialog"]', selector: '*', text: value })
      }
      await expect(dialog.getByRole('button', { name: 'Close', exact: true }).last()).toBeInViewport({ ratio: 1 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy()
      const changeHeading = dialog.getByText('Change & Maintenance', { exact: true })
      await changeHeading.scrollIntoViewIfNeeded()
      await expect(changeHeading).toBeInViewport({ ratio: 1 })
      await page.screenshot({ path: testInfo.outputPath('asset-change-heading.png'), animations: 'disabled' })
      await expectReadableGridText(page, testInfo, `asset-change-heading-${theme}-${width}`, '[role="dialog"] p:has(> span:text-is("Change & Maintenance"))')
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
      const paginationLayout = await page.evaluate(() => {
        const ledger = document.querySelector('[data-audit-ledger]')!
        const pager = ledger.querySelector('.ag-paging-panel')!
        return {
          ledgerBottom: ledger.getBoundingClientRect().bottom,
          pagerBottom: pager.getBoundingClientRect().bottom,
          dates: Array.from(ledger.querySelectorAll<HTMLInputElement>('input[type="date"]')).map(input => {
            const rect = input.getBoundingClientRect()
            const group = input.parentElement!.parentElement!.getBoundingClientRect()
            return { width: input.clientWidth, scrollWidth: input.scrollWidth,
              withinGroup: rect.left >= group.left && rect.right <= group.right }
          }),
        }
      })
      await attachGeometry(testInfo, 'audit-pagination-layout', paginationLayout)
      expect(paginationLayout.pagerBottom, 'Audit pagination must fit above the app footer').toBeLessThanOrEqual(paginationLayout.ledgerBottom + 1)
      expect(paginationLayout.dates).toHaveLength(2)
      for (const input of paginationLayout.dates) {
        expect(input.withinGroup, 'Native date controls must stay inside the filter group').toBeTruthy()
        expect(input.scrollWidth, 'Native date controls must remain fully readable').toBeLessThanOrEqual(input.width + 1)
      }
      for (const selector of ['.ag-paging-page-size', '.ag-paging-row-summary-panel', '.ag-paging-page-summary-panel']) {
        await expect(page.locator(`[data-audit-ledger] ${selector}`)).toBeInViewport({ ratio: 1 })
      }
      await page.screenshot({ path: testInfo.outputPath('audit-actions.png'), animations: 'disabled' })
      await singleReadableLine(page.locator('.ag-header-cell[col-id="audit-actions"] .ag-header-cell-text'), 'Audit Actions header', testInfo, { selector: '.ag-header-cell[col-id="audit-actions"] .ag-header-cell-text' })
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
          await singleReadableLine(density.locator(`input[aria-label="${name}"] + span`), `${name} value at font ${boundary.value}`, testInfo, { selector: `[data-audit-density] input[aria-label="${name}"] + span` })
        }
        await page.getByRole('button', { name: 'Close density controls', exact: true }).click()
        await expect(fontSize).toBeHidden()
        await row.scrollIntoViewIfNeeded()
        const header = page.locator('.ag-header-cell[col-id="audit-actions"] .ag-header-cell-text')
        await expect(header).toBeInViewport({ ratio: 1 })
        await page.screenshot({ path: testInfo.outputPath(`audit-actions-font-${boundary.value}.png`), animations: 'disabled' })
        await singleReadableLine(header, `Audit Actions header at font ${boundary.value}`, testInfo, { selector: '.ag-header-cell[col-id="audit-actions"] .ag-header-cell-text' })
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
