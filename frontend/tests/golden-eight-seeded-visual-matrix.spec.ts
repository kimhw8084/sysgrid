import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { test } from './helpers/sysgrid-test'
import { expectReadableGridText } from './helpers/grid-contrast'
import {
  createConnection,
  createExternalEntity,
  fillGridSearch,
  createRack,
  resetBrowserState,
  seedRackScenario,
  seedOperationalScenario,
  testApiHeaders,
  waitForAppIdle,
} from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const releaseCatalog = JSON.parse(readFileSync(new URL('../../contracts/system_management_v1.json', import.meta.url), 'utf8')) as {
  modules: Array<{ id: string; canonical_route: string; default_stage: string; sysgrid_route_class: 'active' | 'retired_notice' }>
}

async function expectVisibleFormControlsHaveNames(page: Page, route: string) {
  const unnamed = await page.locator([
    'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]):visible',
    'textarea:visible',
    'select:visible',
  ].join(', ')).evaluateAll(elements => elements.flatMap(element => {
    const control = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    const hasLabel = Array.from(control.labels ?? []).some(label => Boolean(label.textContent?.trim()))
    const labelledBy = control.getAttribute('aria-labelledby')?.trim().split(/\s+/).filter(Boolean) ?? []
    const hasLabelledByText = labelledBy.some(id => Boolean(document.getElementById(id)?.textContent?.trim()))
    const hasAccessibleName = hasLabel || Boolean(control.getAttribute('aria-label')?.trim()) || hasLabelledByText || Boolean(control.getAttribute('title')?.trim())
    return hasAccessibleName ? [] : [{ tag: control.tagName.toLowerCase(), placeholder: control.getAttribute('placeholder'), name: control.getAttribute('name') }]
  }))
  expect(unnamed, `${route} visible form controls should have accessible names`).toEqual([])
}

async function getVisibleGridHeaderClips(page: Page) {
  return page.locator('#sg-main-content .ag-header-cell-text:visible').evaluateAll(elements => elements.flatMap(element => {
    const text = element.textContent?.trim() || ''
    if (!text) return []
    const column = element.closest('.ag-header-cell')
    const cellBounds = column?.getBoundingClientRect()
    const viewport = column?.closest('.ag-header-viewport, .ag-pinned-left-header, .ag-pinned-right-header')?.getBoundingClientRect()
    // Horizontally scrollable grids can expose a sliver of an offscreen column;
    // only flag text truncation when the complete header cell is in its viewport.
    if (cellBounds && viewport && (cellBounds.left < viewport.left - 1 || cellBounds.right > viewport.right + 1)) return []
    if (element.scrollWidth <= element.clientWidth + 1) return []
    const label = column?.querySelector('.ag-header-cell-label')
    const geometry = { text, columnId: column?.getAttribute('col-id') || null, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }
    return [{
      ...geometry,
      cellWidth: column?.clientWidth ?? null,
      labelWidth: label?.clientWidth ?? null,
      labelPaddingRight: label ? getComputedStyle(label).paddingRight : null,
    }]
  }))
}

async function expectColumnsFullyVisible(page: Page, row: Locator, route: string, apiName: string, columnIds: string[]) {
  for (const columnId of columnIds) {
    const ensured = await page.evaluate(({ apiName, columnId }) => {
      const api = (window as any)[apiName]
      if (!api?.getColumn?.(columnId)) return false
      api.ensureColumnVisible(columnId, 'middle')
      return true
    }, { apiName, columnId })
    expect(ensured, `${route} ${columnId} should exist in the active grid`).toBe(true)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const header = page.locator(`#sg-main-content .ag-header-cell[col-id="${columnId}"]`).first()
    const cell = row.locator(`.ag-cell[col-id="${columnId}"]`).first()
    await expect(header, `${route} ${columnId} header should be visible`).toBeVisible()
    await expect(cell, `${route} ${columnId} value should be visible`).toBeVisible()
    const headerGeometry = await header.evaluate(element => {
      const viewport = element.closest('.ag-header-viewport')
      const bounds = element.getBoundingClientRect()
      const clip = viewport?.getBoundingClientRect()
      return {
        fits: Boolean(clip && bounds.left >= clip.left - 1 && bounds.right <= clip.right + 1),
        bounds: { left: bounds.left, right: bounds.right },
        clip: clip ? { left: clip.left, right: clip.right } : null,
      }
    })
    const cellGeometry = await cell.evaluate(element => {
      const viewport = element.closest('.ag-center-cols-viewport')
      const bounds = element.getBoundingClientRect()
      const clip = viewport?.getBoundingClientRect()
      return {
        fits: Boolean(clip && bounds.left >= clip.left - 1 && bounds.right <= clip.right + 1),
        bounds: { left: bounds.left, right: bounds.right },
        clip: clip ? { left: clip.left, right: clip.right } : null,
      }
    })
    expect(headerGeometry.fits, `${route} ${columnId} header bounds: ${JSON.stringify(headerGeometry)}`).toBe(true)
    expect(cellGeometry.fits, `${route} ${columnId} value bounds: ${JSON.stringify(cellGeometry)}`).toBe(true)
  }
}

async function expectColumnMinimumWidths(page: Page, route: string, apiName: string, columnIds: string[], requiredMinimums: Record<string, number> = {}, requiredMaximums: Record<string, number> = {}) {
  const widths = await page.evaluate(({ apiName, columnIds, requiredMinimums, requiredMaximums }) => {
    const api = (window as any)[apiName]
    return columnIds.map(columnId => {
      const column = api?.getColumn?.(columnId)
      const definition = column?.getColDef?.()
      const sizingMetadata = api?.getGridOption?.('context')?.__sysgridOperationalColumnSizing?.[columnId]
      const declaredMinimum = Number(definition?.minWidth) || 0
      const declaredMaximum = Number(definition?.maxWidth)
      const storedKey = Object.keys(localStorage).find(key => key.startsWith(`sysgrid:operational-grid-widths:v1:${window.location.pathname}:`))
      let storedColumnState: unknown = null
      try {
        storedColumnState = storedKey ? JSON.parse(localStorage.getItem(storedKey) || 'null') : null
      } catch {
        storedColumnState = { malformed: true }
      }
      const activeState = api?.getColumnState?.()?.find((entry: any) => entry.colId === columnId) ?? null
      return {
        columnId,
        actual: column?.getActualWidth?.() ?? 0,
        minimum: Math.max(declaredMinimum, requiredMinimums[columnId] || 0),
        maximum: Math.min(Number.isFinite(declaredMaximum) ? declaredMaximum : Number.POSITIVE_INFINITY, requiredMaximums[columnId] || Number.POSITIVE_INFINITY),
        definition: definition ? { width: definition.width, minWidth: definition.minWidth, maxWidth: definition.maxWidth, initialWidth: definition.initialWidth } : null,
        sizingMetadata,
        activeState,
        storedColumnState,
      }
    })
  }, { apiName, columnIds, requiredMinimums, requiredMaximums })
  for (const column of widths) {
    const diagnostic = JSON.stringify(column)
    expect(column.actual, `${route} ${column.columnId} should not be compressed below its declared minimum; rendered sizing state: ${diagnostic}`).toBeGreaterThanOrEqual(column.minimum)
    if (Number.isFinite(column.maximum)) expect(column.actual, `${route} ${column.columnId} should respect its declared maximum (${column.maximum}); rendered sizing state: ${diagnostic}`).toBeLessThanOrEqual(column.maximum)
  }
}

async function expectHeaderTextFits(page: Page, route: string, apiName: string, columnId: string, expectedText: string) {
  const ensured = await page.evaluate(({ apiName, columnId }) => {
    const api = (window as any)[apiName]
    if (!api?.getColumn?.(columnId)) return false
    api.ensureColumnVisible(columnId, 'middle')
    return true
  }, { apiName, columnId })
  expect(ensured, `${route} ${columnId} should exist before checking its heading`).toBe(true)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const headerText = page.locator(`#sg-main-content .ag-header-cell[col-id="${columnId}"] .ag-header-cell-text`).first()
  const geometry = await headerText.evaluate(element => ({
    text: element.textContent?.trim() || '',
    fits: element.scrollWidth <= element.clientWidth + 1,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }))
  expect(geometry.text, `${route} ${columnId} heading should retain its full label`).toBe(expectedText)
  expect(geometry.fits, `${route} ${columnId} heading should not ellipsize: ${JSON.stringify(geometry)}`).toBe(true)
}

async function expectCellContentFits(page: Page, row: Locator, route: string, columnId: string, selector: string, requireViewportFit = false) {
  const content = row.locator('.ag-cell[col-id="' + columnId + '"] ' + selector).first()
  const geometry = await content.evaluate(element => {
    const cell = element.closest('.ag-cell')
    if (!cell) return { fitsCell: false, fitsViewport: false, bounds: null }
    const contentBounds = element.getBoundingClientRect()
    const cellBounds = cell.getBoundingClientRect()
    const viewport = cell.closest('.ag-center-cols-viewport')?.getBoundingClientRect()
    return {
      fitsCell: contentBounds.left >= cellBounds.left - 1 && contentBounds.right <= cellBounds.right + 1,
      fitsViewport: Boolean(viewport && cellBounds.left >= viewport.left - 1 && cellBounds.right <= viewport.right + 1),
      bounds: { content: { left: contentBounds.left, right: contentBounds.right }, cell: { left: cellBounds.left, right: cellBounds.right }, viewport: viewport ? { left: viewport.left, right: viewport.right } : null },
    }
  })
  expect(geometry.fitsCell, route + ' ' + columnId + ' content should fit its cell: ' + JSON.stringify(geometry)).toBe(true)
  if (requireViewportFit) expect(geometry.fitsViewport, route + ' ' + columnId + ' should fit the initial desktop viewport: ' + JSON.stringify(geometry)).toBe(true)
}

async function expectCellFullValueTooltip(page: Page, row: Locator, apiName: string, columnId: string, expected: string) {
  const ensured = await page.evaluate(({ apiName, columnId }) => {
    const api = (window as any)[apiName]
    if (!api?.getColumn?.(columnId)) return false
    api.ensureColumnVisible(columnId, 'middle')
    return true
  }, { apiName, columnId })
  expect(ensured, `${columnId} should be available before checking its full-value hover`).toBe(true)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const rowIndex = await row.getAttribute('row-index')
  expect(rowIndex, `${columnId} tooltip check should retain the representative row identity`).not.toBeNull()
  const cell = page.locator(`#sg-main-content .ag-row[row-index="${rowIndex}"] .ag-cell[col-id="${columnId}"]:visible`).first()
  await cell.hover()
  const tooltip = page.locator('.ag-tooltip:visible').last()
  await expect(tooltip).toContainText(expected)
  const bounds = await tooltip.boundingBox()
  const viewport = page.viewportSize()
  expect(bounds && viewport && bounds.width > 0 && bounds.height > 0, `${columnId} full-value tooltip should be rendered`).toBeTruthy()
  expect(bounds!.x, `${columnId} tooltip should stay inside the viewport at its left edge`).toBeGreaterThanOrEqual(0)
  expect(bounds!.y, `${columnId} tooltip should stay inside the viewport at its top edge`).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width, `${columnId} tooltip should stay inside the viewport at its right edge`).toBeLessThanOrEqual(viewport!.width + 1)
  expect(bounds!.y + bounds!.height, `${columnId} tooltip should stay inside the viewport at its bottom edge`).toBeLessThanOrEqual(viewport!.height + 1)
}

async function expectGoldenWorkspaceHeader(page: Page, workspace: string, eyebrow: string) {
  const header = page.locator(`#sg-main-content [data-golden-workspace="${workspace}"] [data-golden-page-header="true"]`).first()
  await expect(header, `${workspace} should render the shared PageHeader`).toBeVisible()
  await expect(header).toContainText(eyebrow)
  await expect.poll(
    () => header.evaluate(element => getComputedStyle(element, '::before').width),
    { message: `${workspace} should use the shared colored header accent` },
  ).toBe('3px')
  await expect.poll(
    () => header.evaluate(element => getComputedStyle(element, '::before').backgroundColor),
    { message: `${workspace} should color the shared header accent` },
  ).not.toBe('rgba(0, 0, 0, 0)')
}

async function expectRackLabelsAndElevationScrolling(page: Page) {
  const labels = page.locator('[data-rack-row-label="true"]')
  await expect(labels.first(), 'elevation cards should show their row context within the current site and aisle').toBeVisible()
  const labelCount = await labels.count()
  for (let index = 0; index < labelCount; index += 1) {
    const label = labels.nth(index)
    await label.scrollIntoViewIfNeeded()
    const geometry = await label.evaluate(element => {
      const labelBounds = element.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(element)
      const textRects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)
      const clipping: Array<{ tag: string; className: string; outside: boolean }> = []
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor)
        const clipsX = ['hidden', 'clip'].includes(style.overflowX)
        const clipsY = ['hidden', 'clip'].includes(style.overflowY)
        if (!clipsX && !clipsY) continue
        const bounds = ancestor.getBoundingClientRect()
        const outside = textRects.some(rect => (clipsX && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) || (clipsY && (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)))
        clipping.push({ tag: ancestor.tagName.toLowerCase(), className: typeof ancestor.className === 'string' ? ancestor.className : '', outside })
      }
      return {
        text: element.textContent?.trim() ?? '',
        scrollWidth: (element as HTMLElement).scrollWidth,
        clientWidth: (element as HTMLElement).clientWidth,
        labelHeight: labelBounds.height,
        lineCount: textRects.length,
        clipAncestors: clipping.filter(item => item.outside),
      }
    })
    expect(geometry.text, `rack row label ${index} should identify its row`).toMatch(/^Row (.+)$/)
    expect(geometry.lineCount, `rack row label ${index} should render visible text`).toBeGreaterThan(0)
    expect(geometry.scrollWidth, `rack row label ${index} must not overflow horizontally: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(geometry.clientWidth + 1)
    expect(geometry.clipAncestors, `rack row label ${index} must not be cut by a clipping ancestor: ${JSON.stringify(geometry)}`).toEqual([])
  }

  const elevationCards = page.locator('[data-rack-elevation-card="true"]')
  const cardCount = await elevationCards.count()
  expect(cardCount, 'the seeded rack scenario should exercise the full visible rack set').toBeGreaterThanOrEqual(8)
  for (let index = 0; index < cardCount; index += 1) {
    const card = elevationCards.nth(index)
    const rackId = await card.getAttribute('data-rack-id')
    expect(rackId, `rack ${index} should expose a stable identity for its elevation scroller`).toBeTruthy()
    const scroller = page.locator(`[data-rack-elevation-card="true"][data-rack-id="${rackId}"] [data-rack-elevation-scroll="true"]`)
    await scroller.scrollIntoViewIfNeeded()
    const setup = await scroller.evaluate(element => {
      const scroll = element as HTMLElement
      scroll.scrollTop = 0
      const rect = scroll.getBoundingClientRect()
      let visible = { left: Math.max(0, rect.left), top: Math.max(0, rect.top), right: Math.min(innerWidth, rect.right), bottom: Math.min(innerHeight, rect.bottom) }
      for (let ancestor = scroll.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor)
        if (!['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) && !['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)) continue
        const bounds = ancestor.getBoundingClientRect()
        visible = { left: Math.max(visible.left, bounds.left), top: Math.max(visible.top, bounds.top), right: Math.min(visible.right, bounds.right), bottom: Math.min(visible.bottom, bounds.bottom) }
      }
      const point = { x: (visible.left + visible.right) / 2, y: (visible.top + visible.bottom) / 2 }
      const hit = point.x >= visible.left && point.x < visible.right && point.y >= visible.top && point.y < visible.bottom ? document.elementFromPoint(point.x, point.y) : null
      return {
        point,
        rackId: scroll.closest<HTMLElement>('[data-rack-elevation-card="true"]')?.dataset.rackId ?? null,
        visible,
        before: scroll.scrollTop,
        maximum: scroll.scrollHeight - scroll.clientHeight,
        hitInside: Boolean(hit && (hit === scroll || scroll.contains(hit))),
      }
    })
    expect(setup.maximum, `rack ${index} elevation should have scrollable rack units`).toBeGreaterThan(1)
    expect(setup.hitInside, `rack ${index} wheel point should hit its visible elevation scroller: ${JSON.stringify(setup)}`).toBe(true)
    await scroller.evaluate(element => {
      const scroll = element as HTMLElement
      scroll.dataset.goldenTestLastWheel = 'not-observed'
      scroll.addEventListener('wheel', event => {
        scroll.dataset.goldenTestLastWheel = JSON.stringify({
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          defaultPrevented: event.defaultPrevented,
          target: (event.target as HTMLElement | null)?.tagName ?? null,
          rackId: (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-rack-elevation-card="true"]')?.dataset.rackId ?? null,
        })
      }, { capture: true, once: true })
      document.documentElement.dataset.goldenTestLastWindowWheel = 'not-observed'
      window.addEventListener('wheel', event => {
        document.documentElement.dataset.goldenTestLastWindowWheel = JSON.stringify({
          deltaY: event.deltaY,
          target: (event.target as HTMLElement | null)?.tagName ?? null,
          rackId: (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-rack-elevation-card="true"]')?.dataset.rackId ?? null,
        })
      }, { capture: true, once: true })
    })
    const input = await page.context().newCDPSession(page)
    let postMoveHit: unknown
    try {
      await input.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: setup.point.x,
        y: setup.point.y,
      })
      postMoveHit = await scroller.evaluate((element, point) => {
        const hit = document.elementFromPoint(point.x, point.y)
        return {
          tag: hit?.tagName ?? null,
          className: hit instanceof HTMLElement ? hit.className : null,
          insideScroller: Boolean(hit && (hit === element || element.contains(hit))),
          rackId: hit instanceof HTMLElement ? hit.closest<HTMLElement>('[data-rack-elevation-card="true"]')?.dataset.rackId ?? null : null,
          scrollableAncestorRackId: hit instanceof HTMLElement ? hit.closest<HTMLElement>('[data-rack-elevation-scroll="true"]')?.closest<HTMLElement>('[data-rack-elevation-card="true"]')?.dataset.rackId ?? null : null,
        }
      }, setup.point)
      await input.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: setup.point.x,
        y: setup.point.y,
        deltaX: 0,
        deltaY: 120,
      })
      await expect.poll(
        () => scroller.evaluate(element => (element as HTMLElement).scrollTop),
        { message: `native wheel input should scroll rack ${index} elevation; setup=${JSON.stringify(setup)}` },
      ).toBeGreaterThan(setup.before)
    } catch (error) {
      const wheelResult = await scroller.evaluate(element => ({
        scrollTop: (element as HTMLElement).scrollTop,
        wheel: (element as HTMLElement).dataset.goldenTestLastWheel ?? 'no wheel event received',
        windowWheel: document.documentElement.dataset.goldenTestLastWindowWheel ?? 'no window wheel event received',
      }))
      throw new Error(`native wheel input did not scroll rack ${index} elevation; setup=${JSON.stringify(setup)}; postMoveHit=${JSON.stringify(postMoveHit)}; result=${JSON.stringify(wheelResult)}; ${String(error)}`)
    } finally {
      await input.detach()
    }
    await scroller.evaluate((element, initial) => { (element as HTMLElement).scrollTop = initial }, setup.before)
  }
}

async function expectViewportCanvasContinuity(page: Page, routeLabel: string, expectActiveNavigation = true) {
  await expect(page.locator('.sg-app-shell'), `${routeLabel} shared application shell should finish mounting`).toBeVisible()
  await expect(page.locator('[data-sg-app-main="true"]'), `${routeLabel} main pane should finish mounting`).toBeVisible()
  await expect(page.locator('#sg-main-content'), `${routeLabel} workspace canvas should finish mounting`).toBeVisible()
  const geometry = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('.sg-app-shell')
    const main = document.querySelector<HTMLElement>('[data-sg-app-main="true"]')
    const content = document.querySelector<HTMLElement>('#sg-main-content')
    if (!shell || !main || !content) return { missing: true as const }
    const bounds = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right }
    }
    return {
      missing: false as const,
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      shell: bounds(shell),
      main: bounds(main),
      content: bounds(content),
      backgrounds: {
        html: getComputedStyle(document.documentElement).backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
        shell: getComputedStyle(shell).backgroundColor,
        main: getComputedStyle(main).backgroundColor,
      },
    }
  })
  expect(geometry.missing, `${routeLabel} should expose the shared viewport canvas`).toBe(false)
  if (geometry.missing) return
  expect(Math.abs(geometry.shell.left), `${routeLabel} shell should start at the viewport edge: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.shell.right - geometry.viewport), `${routeLabel} shell should reach the viewport edge: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.main.right - geometry.shell.right), `${routeLabel} main should reach the shell edge: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.content.left - geometry.main.left), `${routeLabel} content should align with the main pane: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.content.right - geometry.main.right), `${routeLabel} content should reach the main pane edge: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(1)
  expect(geometry.documentWidth, `${routeLabel} should not create page-level horizontal overflow: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(geometry.viewport + 1)
  expect(geometry.bodyWidth, `${routeLabel} body should not create page-level horizontal overflow: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(geometry.viewport + 1)
  expect(new Set(Object.values(geometry.backgrounds)).size, `${routeLabel} html, body, shell, and main backgrounds should form one continuous surface: ${JSON.stringify(geometry.backgrounds)}`).toBe(1)
  const activeNavigation = await page.locator('[data-sg-app-sidebar] nav[aria-label="Primary navigation"]').evaluate(navigation => {
    const active = navigation.querySelector<HTMLElement>('[aria-current="page"]')
    if (!active) return { present: false, contained: false }
    const navBounds = navigation.getBoundingClientRect()
    const activeBounds = active.getBoundingClientRect()
    return {
      present: true,
      contained: activeBounds.top >= navBounds.top - 1 && activeBounds.bottom <= navBounds.bottom + 1,
      active: { top: activeBounds.top, bottom: activeBounds.bottom },
      navigation: { top: navBounds.top, bottom: navBounds.bottom, scrollTop: (navigation as HTMLElement).scrollTop },
    }
  })
  if (expectActiveNavigation) {
    expect(activeNavigation.present, `${routeLabel} should expose its active navigation route`).toBe(true)
  }
  if (activeNavigation.present) {
    expect(activeNavigation.contained, `${routeLabel} active navigation item should remain fully visible: ${JSON.stringify(activeNavigation)}`).toBe(true)
  }
}

async function createVendor(request: APIRequestContext, stamp: string) {
  const response = await request.post(`${apiBase}/vendors`, {
    data: {
      name: `PW-SEED-VENDOR-${stamp}`,
      country: 'USA',
    },
    headers: testApiHeaders,
  })
  expect(response.ok()).toBeTruthy()
  return response.json()
}

test.describe('Golden Eight deterministic populated visual matrix', () => {
  test('renders representative populated desktop states for every completed target view', async ({ page, sysApi: request }, testInfo) => {
    await resetBrowserState(page)
    const seeded = await seedOperationalScenario(request)
    const stamp = seeded.stamp
    const racks = await seedRackScenario(request)
    for (let index = 1; index <= 6; index += 1) {
      await createRack(request, {
        site_id: racks.siteA.id,
        name: `PW-RACK-VISUAL-${stamp}-${index}`,
        aisle: 'A',
        row: '2',
        total_u: 12,
        max_power_kw: 10,
      })
    }
    await createConnection(request, {
      device_a_id: seeded.primary.id,
      source_port: 'eth0',
      device_b_id: seeded.secondary.id,
      target_port: 'eth1',
      link_type: 'Data',
      speed_gbps: 10,
      unit: 'Gbps',
      status: 'Active',
      farm: `PW-SEED-FARM-${stamp}`,
    })

    const external = await createExternalEntity(request, {
      name: `PW-SEED-EXTERNAL-${stamp}`,
      external_key: `pw-seed-external-${stamp}`.toLowerCase(),
      type: 'API',
      owner_organization: 'Seed Partner',
      ownership_mode: 'individual',
      status: 'Active',
      environment: 'Production',
      description: 'Representative populated external dependency',
      business_purpose: 'Golden Eight deterministic visual validation',
      metadata_json: { fixture: 'golden-eight-populated' },
    })

    const vendor = await createVendor(request, stamp)

    const routes = [
      { key: 'monitoring', path: '/monitoring', workspace: 'monitoring' },
      { key: 'assets', path: '/asset', workspace: 'assets' },
      { key: 'services', path: '/services', workspace: 'services' },
      { key: 'external', path: '/external', workspace: 'external' },
      { key: 'network', path: '/network', workspace: 'network' },
      { key: 'far', path: '/far', workspace: 'far' },
      { key: 'vendors', path: '/vendors', workspace: 'vendors' },
    ] as const

    const supplementaryRoutes = [
      { key: 'home', path: '/' },
      { key: 'racks', path: '/racks' },
      { key: 'logs', path: '/logs' },
      { key: 'settings', path: '/settings' },
    ] as const
    const routeSearches: Record<string, { placeholder: string; name: string; value: string }> = {
      monitoring: { placeholder: 'Scan matrix...', name: 'Search monitoring records', value: seeded.monitoring.title },
      assets: { placeholder: 'Scan asset matrix...', name: 'Search assets', value: seeded.primary.name },
      services: { placeholder: 'Search services, hosts, or metadata...', name: 'Search services', value: seeded.service.name },
      external: { placeholder: 'Scan registry...', name: 'Search external registry records', value: external.name },
      network: { placeholder: 'Scan matrix...', name: 'Search network connections', value: `PW-SEED-FARM-${stamp}` },
      far: { placeholder: 'Scan risk vectors...', name: 'Search failure analysis records', value: seeded.far.title },
      vendors: { placeholder: 'Search vendors...', name: 'Search vendor records', value: vendor.name },
    }
    const releasedPaths = releaseCatalog.modules
      .filter(module => module.sysgrid_route_class === 'active')
      .map(module => module.canonical_route)
      .sort()
    const testedPaths = [...routes, ...supplementaryRoutes].map(route => route.path.split('?')[0])
    expect(testedPaths).toHaveLength(releasedPaths.length)
    expect([...new Set(testedPaths)].sort()).toEqual(releasedPaths)
    if (process.env.SYSGRID_VERIFY_PROFILE === 'normal-v1') {
      const policyResponse = await request.get(`${apiBase}/policy/module-availability`, { headers: testApiHeaders })
      expect(policyResponse.ok()).toBeTruthy()
      const policy = await policyResponse.json()
      expect(policy.identity.system_root).toBe(false)
      for (const module of releaseCatalog.modules.filter(item => item.default_stage === 'production')) {
        expect(policy.modules[module.id], module.id).toMatchObject({ available: true, stage: 'production', root_preview: false })
      }
    }

    await page.setViewportSize({ width: 1440, height: 900 })

    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const timings: Array<{ theme: string; route: string; readyMs: number }> = []
    const headerClips: Array<Record<string, unknown>> = []
    for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
      // The compact Audit check below changes the viewport. Restore the
      // primary desktop viewport so each theme uses identical conditions.
      await page.setViewportSize({ width: 1440, height: 900 })
      const preference = await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
      expect(preference.ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      for (const route of routes) {
        const started = Date.now()
        await page.goto(route.path)
        await waitForAppIdle(page)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        expect(new URL(page.url()).pathname).toBe(route.path)
        const workspace = page.locator('#sg-main-content')
        await expect(workspace, `${route.key} workspace should render`).toBeVisible()
        await expectViewportCanvasContinuity(page, `${theme} ${route.key}`)
        if (route.key === 'external') await expectGoldenWorkspaceHeader(page, 'external', 'External Intelligence')
        await expectVisibleFormControlsHaveNames(page, route.key)
        // AG Grid's virtualized DOM order can start with a clipped overscan row;
        // assert against the actual first displayed data row instead.
        const row = workspace.locator('.ag-center-cols-container .ag-row[row-index="0"]')
        await expect(
          row,
          `${route.key} should render at least one representative seeded row`,
        ).toBeVisible()
        await expect(row).toBeInViewport()
        const clippedHeaders = await getVisibleGridHeaderClips(page)
        headerClips.push(...clippedHeaders.map(heading => ({ theme, route: route.key, ...heading })))
        await page.screenshot({
          path: testInfo.outputPath(`${theme}-${route.key}-resting-populated-desktop.png`),
          fullPage: false,
          animations: 'disabled',
        })
        const routeSearch = routeSearches[route.key]
        if (routeSearch) {
          await fillGridSearch(page, routeSearch.placeholder, routeSearch.value)
          await expect(page.getByRole('textbox', { name: routeSearch.name })).toHaveValue(routeSearch.value)
        }
        if (['assets', 'external', 'vendors'].includes(route.key)) {
          const gridApiName = route.key === 'vendors' ? '__DEBUG_VENDORS_GRID_API__' : '__DEBUG_OPERATIONAL_GRID_API__'
          await expect.poll(() => page.evaluate(apiName => {
            const api = (window as any)[apiName]
            return api?.getDisplayedRowCount?.() ?? -1
          }, gridApiName)).toBe(1)
          const surface = workspace.locator('[data-golden-grid-surface="true"]')
          const height = await surface.evaluate(element => element.getBoundingClientRect().height)
          expect(height, route.key + ' one-result grids should stay compact').toBeLessThanOrEqual(300)
        }
        const clipped = await row.evaluate(element => {
          const bounds = element.getBoundingClientRect()
          let ancestor = element.parentElement
          while (ancestor) {
            const style = getComputedStyle(ancestor)
            if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) {
              const clip = ancestor.getBoundingClientRect()
              if (bounds.top < clip.top - 1 || bounds.bottom > clip.bottom + 1) return true
            }
            ancestor = ancestor.parentElement
          }
          return false
        })
        expect(clipped, `${route.key} rows must not be clipped out of the grid surface`).toBe(false)
        const importantColumns: Record<string, { apiName: string; columnIds: string[] }> = {
          assets: { apiName: '__DEBUG_OPERATIONAL_GRID_API__', columnIds: ['status', 'owner', 'primary_ip', 'management_ip', 'hardware_summary', 'hardware_age'] },
          external: { apiName: '__DEBUG_OPERATIONAL_GRID_API__', columnIds: ['internal_owner', 'status', 'environment', 'business_purpose', 'link_count'] },
          network: { apiName: '__DEBUG_NETWORK_GRID_API__', columnIds: ['src_port', 'peer_node', 'peer_port', 'type', 'status'] },
          vendors: { apiName: '__DEBUG_VENDORS_GRID_API__', columnIds: ['country', 'primary_personnel_name', 'primary_personnel_email'] },
        }
        if (importantColumns[route.key]) {
          const target = importantColumns[route.key]
          const requiredMinimums = route.key === 'assets' ? { name: 180, system: 112, type: 96, status: 132, environment: 80, owner: 104 } : route.key === 'external' ? { status: 120, business_purpose: 220, link_count: 130 } : route.key === 'vendors' ? { name: 180, country: 136, primary_personnel_name: 180, primary_personnel_email: 190 } : { name: 180, country: 120, primary_personnel_name: 180, primary_personnel_email: 190 }
          const requiredMaximums = route.key === 'assets' ? { name: 210, system: 150, type: 104, status: 144, environment: 96, owner: 112 } : route.key === 'vendors' ? { name: 220, country: 136, primary_personnel_name: 200, primary_personnel_email: 200 } : {}
          const widthColumnIds = route.key === 'assets' ? ['name', 'system', 'type', 'environment', ...target.columnIds] : route.key === 'vendors' ? ['name', ...target.columnIds] : target.columnIds
          await expectColumnsFullyVisible(page, row, route.key, target.apiName, target.columnIds)
          await expectColumnMinimumWidths(page, route.key, target.apiName, widthColumnIds, requiredMinimums, requiredMaximums)
          if (route.key === 'network') await expectHeaderTextFits(page, route.key, target.apiName, 'type', 'Type')
          if (route.key === 'network') await expectHeaderTextFits(page, route.key, target.apiName, 'status', 'Status')
          if (route.key === 'assets') await expectHeaderTextFits(page, route.key, target.apiName, 'owner', 'Owner')
          if (route.key === 'assets') await expect(row.locator('.ag-cell[col-id="status"] .operational-grid-badge')).toHaveText('Maintenance')
          if (route.key === 'assets') await expectCellContentFits(page, row, route.key, 'status', '.operational-grid-badge')
          if (route.key === 'external') await expectCellFullValueTooltip(page, row, target.apiName, 'business_purpose', 'Golden Eight deterministic visual validation')
          if (route.key === 'vendors') await expect(row.locator('.ag-cell[col-id="primary_personnel_name"]')).toContainText('Unassigned')
        }
        if (route.key === 'assets') {
          const cellSemantics = await workspace.locator('.ag-cell[col-id="name"]:visible').first().evaluate(cell => {
            const grid = cell.closest('[role="grid"], [role="treegrid"], [role="table"]')
            const cellElement = cell as HTMLElement
            return {
              grid: grid ? {
                role: grid.getAttribute('role'),
                tabIndex: (grid as HTMLElement).tabIndex,
                label: grid.getAttribute('aria-label'),
                tabbableDescendants: grid.querySelectorAll('[tabindex="0"]').length,
              } : null,
              cell: {
                role: cell.getAttribute('role'),
                tabIndex: cellElement.tabIndex,
                ariaLabel: cell.getAttribute('aria-label'),
                ariaLabelledby: cell.getAttribute('aria-labelledby'),
                text: cellElement.innerText,
              },
              value: cell.querySelector('[id^="sg-operational-grid-value-"]')?.textContent ?? null,
            }
          })
          await page.mouse.move(2, 2)
          const nativeTabPath: Array<{ tag: string; role: string | null; name: string; className: string; tabIndex: number }> = []
          for (let step = 0; step < 12; step += 1) {
            await page.keyboard.press('Tab')
            nativeTabPath.push(await page.evaluate(() => {
              const active = document.activeElement as HTMLElement | null
              return {
                tag: active?.tagName.toLowerCase() ?? '',
                role: active?.getAttribute('role') ?? null,
                name: active?.getAttribute('aria-label') || active?.innerText?.trim().slice(0, 100) || '',
                className: typeof active?.className === 'string' ? active.className : '',
                tabIndex: active?.tabIndex ?? -1,
              }
            }))
          }
          await page.keyboard.press('ArrowDown')
          await page.waitForTimeout(600)
          const focusedGridCell = await page.evaluate(() => {
            const active = document.activeElement as HTMLElement | null
            const style = active ? getComputedStyle(active) : null
            const rect = active?.getBoundingClientRect()
            return {
              role: active?.getAttribute('role') ?? null,
              text: active?.innerText?.trim() ?? '',
              tabIndex: active?.tabIndex ?? -1,
              className: typeof active?.className === 'string' ? active.className : '',
              indicator: style ? {
                outlineStyle: style.outlineStyle,
                outlineWidth: style.outlineWidth,
                outlineColor: style.outlineColor,
                boxShadow: style.boxShadow,
              } : null,
              rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
              gridHasTabStop: Boolean(active?.closest('[role="grid"], [role="treegrid"]')?.querySelector('[tabindex="0"]')),
              describedBy: active?.getAttribute('aria-describedby') ?? null,
              title: active?.getAttribute('title') ?? active?.querySelector('[title]')?.getAttribute('title') ?? null,
              focusHit: rect ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('[role="gridcell"]') === active : false,
            }
          })
          const focusedTooltip = await page.locator('.ag-tooltip:visible').allTextContents()
          expect(focusedGridCell.role, 'ArrowDown from the Asset Registry Instance header should enter a semantic grid cell').toBe('gridcell')
          expect(focusedGridCell.text, 'the keyboard-focused asset cell should expose the full synthetic asset identity').toContain(seeded.primary.name)
          expect(focusedGridCell.title, 'the keyboard-focused cell should retain a full-value pointer disclosure').toBe(seeded.primary.name)
          expect(focusedGridCell.focusHit, 'the keyboard-focused grid cell should remain visibly hit-testable').toBe(true)
          // Clear the primary-asset search first. The grid virtualizes rows, so
          // search each seeded identity below to bring that record into the DOM
          // before checking its accessible cell name.
          await fillGridSearch(page, routeSearches.assets.placeholder, '')
          await expect.poll(() => page.evaluate(() => (window as any).__DEBUG_OPERATIONAL_GRID_API__?.getDisplayedRowCount?.() ?? -1)).toBeGreaterThanOrEqual(5)
          const visibleAssetIdentities = [seeded.primary.name, seeded.secondary.name, seeded.tertiary.name, racks.devicePrimary.name, racks.deviceSecondary.name]
          const accessibleAssetIdentityEvidence = []
          for (const identity of visibleAssetIdentities) {
            await fillGridSearch(page, routeSearches.assets.placeholder, identity)
            await expect.poll(() => page.evaluate(() => (window as any).__DEBUG_OPERATIONAL_GRID_API__?.getDisplayedRowCount?.() ?? -1)).toBe(1)
            // Preserve column context in the accessible name while requiring
            // the full identity to remain discoverable as a unique grid cell.
            const cells = page.getByRole('gridcell', { name: identity })
            await expect(cells, `the complete rendered asset identity should remain available in the grid-cell name: ${identity}`).toHaveCount(1)
            await expect(cells, `the full asset identity cell should be visible: ${identity}`).toBeVisible()
            accessibleAssetIdentityEvidence.push({ value: identity, matching_accessible_cell_count: 1, visible: true })
          }
          await fillGridSearch(page, routeSearches.assets.placeholder, '')
          const semanticsPath = testInfo.outputPath(`${theme}-asset-grid-cell-keyboard-semantics.json`)
          writeFileSync(semanticsPath, JSON.stringify({ cellSemantics, nativeTabPath, focusedGridCell, focusedTooltip, accessibleAssetIdentityEvidence }, null, 2))
          await testInfo.attach(`${theme}-asset-grid-cell-keyboard-semantics`, { path: semanticsPath, contentType: 'application/json' })
        }
        if (['assets', 'external', 'far', 'vendors'].includes(route.key)) {
          if (route.key === 'assets') {
            await fillGridSearch(page, routeSearches.assets.placeholder, seeded.primary.name)
            await expect.poll(() => page.evaluate(() => (window as any).__DEBUG_OPERATIONAL_GRID_API__?.getDisplayedRowCount?.() ?? -1)).toBe(1)
          }
          const identityColumn = route.key === 'far' ? 'system_name' : 'name'
          const identityHeaderSelector = route.key === 'external'
            ? '.ag-header-cell[col-id="name"], .ag-header-cell[col-id="external_entity_name"]'
            : `.ag-header-cell[col-id="${identityColumn}"]`
          const identityHeader = workspace.locator(identityHeaderSelector).first()
          const viewsButton = workspace.getByRole('button', { name: 'Views', exact: true }).first()
          await expect(viewsButton, `${route.key} grid controls should expose a keyboard entry point`).toBeVisible()
          await viewsButton.focus()
          const nativeKeyboardGridPath: Array<{ tag: string; role: string | null; columnId: string | null; name: string; tabIndex: number }> = []
          let identityHeaderReached = false
          for (let step = 0; step < 32; step += 1) {
            await page.keyboard.press('Tab')
            const active = await page.evaluate(() => {
              const element = document.activeElement as HTMLElement | null
              return {
                tag: element?.tagName.toLowerCase() ?? '',
                role: element?.getAttribute('role') ?? null,
                columnId: element?.getAttribute('col-id') ?? null,
                name: element?.getAttribute('aria-label') || element?.innerText?.trim().slice(0, 100) || '',
                tabIndex: element?.tabIndex ?? -1,
              }
            })
            nativeKeyboardGridPath.push(active)
            if (active.role === 'columnheader' && (route.key === 'external'
              ? ['name', 'external_entity_name'].includes(active.columnId ?? '')
              : active.columnId === identityColumn)) {
              identityHeaderReached = true
              break
            }
          }
          expect(identityHeaderReached, `${route.key} native Tab traversal from Views should reach the identity column header: ${JSON.stringify(nativeKeyboardGridPath)}`).toBe(true)
          await page.keyboard.press('ArrowDown')
          const focusedCell = await page.evaluate((nativeKeyboardGridPath) => {
            const active = document.activeElement as HTMLElement | null
            const style = active ? getComputedStyle(active) : null
            const rect = active?.getBoundingClientRect()
            const source = active?.querySelector<HTMLElement>('[id^="sg-operational-grid-value-"]')
            const valueStyle = source ? getComputedStyle(source) : style
            return {
              role: active?.getAttribute('role') ?? null,
              text: active?.innerText?.trim() ?? '',
              tabIndex: active?.tabIndex ?? -1,
              title: active?.getAttribute('title') ?? source?.getAttribute('title') ?? null,
              outlineStyle: style?.outlineStyle ?? null,
              outlineWidth: style?.outlineWidth ?? null,
              valueTextTransform: valueStyle?.textTransform ?? 'none',
              nativeKeyboardGridPath,
              rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
              hit: rect ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('[role="gridcell"]') === active : false,
            }
          }, nativeKeyboardGridPath)
          expect(focusedCell.role, `${route.key} ArrowDown should focus the full identity cell`).toBe('gridcell')
          expect(focusedCell.outlineStyle, `${route.key} focused data cell should show a visible focus outline`).not.toBe('none')
          expect(Number.parseFloat(focusedCell.outlineWidth ?? '0'), `${route.key} focused data cell should have a measurable focus indicator`).toBeGreaterThanOrEqual(1)
          expect(focusedCell.hit, `${route.key} keyboard focus should remain visible and hit-testable`).toBe(true)
          if (route.key === 'far') {
            // FAR intentionally renders system identifiers in uppercase while its title preserves
            // the API's original spelling. Compare both representations to the seeded API value.
            expect(focusedCell.title, 'FAR focused system should retain the exact API value in its pointer disclosure').toBe(seeded.systemName)
            expect(focusedCell.valueTextTransform, 'FAR system casing should be an explicit presentation transform').toBe('uppercase')
            expect(focusedCell.text, 'FAR focused system should preserve the exact identifier when rendered uppercase').toBe(seeded.systemName.toUpperCase())
          } else if (focusedCell.title) {
            expect(focusedCell.title, `${route.key} focused data value should retain its exact pointer disclosure`).toBe(focusedCell.text)
          }
          const accessibleIdentity = route.key === 'far' ? seeded.systemName
            : route.key === 'assets' ? seeded.primary.name
              : route.key === 'external' ? external.name
                : vendor.name
          // Asset rows are virtualized and the broader matrix restores the
          // unfiltered list here. Their full accessible names were verified
          // individually while filtered into the rendered DOM above.
          if (route.key !== 'assets') {
            await expect(page.getByRole('gridcell', { name: accessibleIdentity }), `${route.key} full identity should be present in the browser accessibility tree`).toBeVisible()
          }
          if (route.key === 'assets') expect(focusedCell.text).toBe(seeded.primary.name)
          if (route.key === 'external') expect(focusedCell.text).toBe(external.name)
          if (route.key === 'vendors') expect(focusedCell.text).toBe(vendor.name)
          const tooltipColumn = route.key === 'far' ? 'system_name' : 'name'
          await expectCellFullValueTooltip(page, row, route.key === 'vendors' ? '__DEBUG_VENDORS_GRID_API__' : '__DEBUG_OPERATIONAL_GRID_API__', tooltipColumn, accessibleIdentity)
          const path = testInfo.outputPath(`${theme}-${route.key}-keyboard-grid-focus.json`)
          writeFileSync(path, JSON.stringify(focusedCell, null, 2))
          await testInfo.attach(`${theme}-${route.key}-keyboard-grid-focus`, { path, contentType: 'application/json' })
        }
        await row.hover()
        if (importantColumns[route.key]) {
          const apiName = importantColumns[route.key].apiName
          const restored = await page.evaluate(apiName => {
            const api = (window as any)[apiName]
            const firstCenterColumn = api?.getAllDisplayedColumns?.().find((column: any) => !column.isPinned())
            if (!firstCenterColumn) return false
            api.ensureColumnVisible(firstCenterColumn.getColId(), 'start')
            return true
          }, apiName)
          expect(restored, `${route.key} should return to its first data column before capture`).toBe(true)
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
          if (route.key === 'assets') {
            // Viewport-fit is asserted while each column is scrolled into view
            // above. After restoring the first center column for the capture,
            // later columns may be intentionally outside the horizontal
            // viewport; only their content-to-cell fit remains applicable.
            await expectCellContentFits(page, row, route.key, 'status', '.operational-grid-badge')
            await expectCellContentFits(page, row, route.key, 'owner', '.operational-grid-text')
          }
          if (route.key === 'vendors') {
            // The email column is brought fully into view above. After restoring
            // the first center column for capture, only content-to-cell fit applies.
            await expectCellContentFits(page, row, route.key, 'primary_personnel_email', 'button')
          }
        }
        await expectReadableGridText(page, testInfo, `${theme}-${route.key}-hover`, '.ag-center-cols-container, .ag-pinned-right-cols-container')
        timings.push({ theme, route: route.path, readyMs: Date.now() - started })
        await page.screenshot({
          path: testInfo.outputPath(`${theme}-${route.key}-searched-hover-desktop.png`),
          fullPage: false,
          animations: 'disabled',
        })
      }
      for (const route of supplementaryRoutes) {
        await page.goto(route.path)
        await waitForAppIdle(page)
        await expectViewportCanvasContinuity(page, `${theme} ${route.key}`)
        if (route.key === 'home') {
          await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening),/ })).toBeVisible()
        }
        // Route-specific UI assertions below establish readiness while background requests may stay active.
        await expectVisibleFormControlsHaveNames(page, route.key)
        await expect(page.locator('#sg-main-content h1, #sg-main-content h2').first()).toBeVisible()
        const clippedHeaders = await getVisibleGridHeaderClips(page)
        headerClips.push(...clippedHeaders.map(heading => ({ theme, route: route.key, ...heading })))
        await expect(page.locator('[data-sg-state="fatal-error"]')).toHaveCount(0)
        expect(new URL(page.url()).pathname).toBe(route.path.split('?')[0])
        if (route.key === 'racks') {
          await expectGoldenWorkspaceHeader(page, 'racks', 'Infrastructure')
          await expect(page.getByRole('textbox', { name: 'Search racks, locations, systems, asset tags, and serial numbers' })).toBeVisible()
          await expect(page.getByText(racks.rackA1.name, { exact: true }).first()).toBeVisible()
          const rackRail = page.locator('#racks-grid')
          const rackControls = page.locator('[data-rack-scroll-controls="true"]')
          await expect(rackControls).toBeVisible()
          expect(await rackControls.evaluate(element => Boolean(element.closest('#racks-grid'))), 'Rack navigation must stay in the toolbar without covering rack cards').toBe(false)
          await expect.poll(() => rackRail.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
          await page.getByRole('button', { name: 'Scroll to next racks' }).click()
          await expect.poll(() => rackRail.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
          await page.getByRole('button', { name: 'Scroll to previous racks' }).click()
          await expect.poll(() => rackRail.evaluate(element => element.scrollLeft)).toBeLessThanOrEqual(1)
          await expectRackLabelsAndElevationScrolling(page)
        }
        if (route.key === 'settings') {
          await expect(page.getByRole('textbox', { name: 'Search system parameters' })).toBeVisible()
        }
        if (route.key === 'logs') {
          const registryHeader = page.locator('[data-audit-ledger] .ag-header-cell[col-id="target_table"] .ag-header-cell-text')
          await expect(registryHeader).toBeVisible()
          const registryHeaderFits = await registryHeader.evaluate(element => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1)
          expect(registryHeaderFits, 'Audit registry headings should stay on one line without truncation').toBe(true)
          const idHeader = page.locator('[data-audit-ledger] .ag-header-cell[col-id="target_id"] .ag-header-cell-text')
          const payloadHeader = page.locator('[data-audit-ledger] .ag-header-cell[col-id="description"] .ag-header-cell-text')
          await expect(idHeader).toHaveText('ID')
          await expect(payloadHeader).toContainText('DETAILS')
          const payloadHeaderFits = await payloadHeader.evaluate(element => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1)
          expect(payloadHeaderFits, 'Audit payload heading should be readable in the desktop table').toBe(true)
        }
        await page.screenshot({ path: testInfo.outputPath(`${theme}-${route.key}-resting-desktop.png`), animations: 'disabled' })
        await expect(page.locator('#sg-main-content h1, #sg-main-content h2').first()).toBeVisible()
        await expect(page.locator('[data-sg-state="fatal-error"]')).toHaveCount(0)
        expect(new URL(page.url()).pathname).toBe(route.path.split('?')[0])
        await page.screenshot({ path: testInfo.outputPath(`${theme}-${route.key}-interacted-desktop.png`), animations: 'disabled' })
      }
      await page.setViewportSize({ width: 1280, height: 720 })
      await page.goto('/logs')
      await waitForAppIdle(page)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const compactPayloadHeader = page.locator('[data-audit-ledger] .ag-header-cell[col-id="description"] .ag-header-cell-text')
      await expect(compactPayloadHeader).toHaveText('DETAILS')
      await page.screenshot({ path: testInfo.outputPath(`${theme}-logs-populated-desktop-1280x720.png`), animations: 'disabled' })
      const compactPayloadGeometry = await compactPayloadHeader.evaluate(element => {
        const cell = element.closest<HTMLElement>('.ag-header-cell')
        return {
          columnWidth: cell?.getBoundingClientRect().width ?? 0,
          textScrollWidth: element.scrollWidth,
          textClientWidth: element.clientWidth,
          textBounds: (() => {
            const range = document.createRange()
            range.selectNodeContents(element)
            const rect = range.getBoundingClientRect()
            return { left: rect.left, right: rect.right }
          })(),
          headerViewport: (() => {
            const viewport = element.closest<HTMLElement>('.ag-header-viewport')?.getBoundingClientRect()
            return { left: viewport?.left ?? 0, right: viewport?.right ?? 0 }
          })(),
        }
      })
      expect(compactPayloadGeometry.columnWidth, 'Audit change details should retain its readable minimum width at compact desktop size').toBeGreaterThanOrEqual(360)
      expect(compactPayloadGeometry.textScrollWidth, 'Audit change details heading should not be clipped at compact desktop size').toBeLessThanOrEqual(compactPayloadGeometry.textClientWidth + 1)
      expect(compactPayloadGeometry.textBounds.left, 'Audit detail heading should not be clipped at the horizontal viewport start').toBeGreaterThanOrEqual(compactPayloadGeometry.headerViewport.left - 1)
      expect(compactPayloadGeometry.textBounds.right, 'Audit detail heading should remain fully visible before the pinned actions column').toBeLessThanOrEqual(compactPayloadGeometry.headerViewport.right + 1)
      await expectViewportCanvasContinuity(page, `${theme} populated logs@1280x720`)
    }
    expect(headerClips, 'Every production workspace heading should fit without truncation').toEqual([])
    expect(errors).toEqual([])
    const timingsPath = testInfo.outputPath('workspace-navigation-timings.json')
    writeFileSync(timingsPath, JSON.stringify(timings, null, 2))
    await testInfo.attach('workspace-navigation-timings', { path: timingsPath, contentType: 'application/json' })
  })

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1366, height: 768 },
    { width: 1280, height: 650 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ]) {
    test(`all production workspaces remain usable at ${viewport.width}x${viewport.height}`, async ({ page, sysApi: request }, testInfo) => {
      await resetBrowserState(page)
      await page.setViewportSize(viewport)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      const routes = releaseCatalog.modules
        .filter(module => module.default_stage === 'production')
        .map(module => ({ key: module.id, path: module.canonical_route, hasSidebarEntry: module.sysgrid_route_class === 'active' }))
      for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
        const preference = await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
        expect(preference.ok()).toBeTruthy()
        await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
        for (const route of routes) {
          const routeLabel = `${route.key}@${viewport.width}x${viewport.height}`
          await page.goto(route.path)
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
          await expect(page.locator('#sg-main-content'), `${routeLabel} workspace should remain visible`).toBeVisible()
          await expect(page.locator('#sg-main-content h1, #sg-main-content h2').first(), `${routeLabel} should expose a visible view heading`).toBeVisible()
          if (route.key === 'assets') {
            await expect(
              page.getByText('Loading asset registry…', { exact: true }),
              `${routeLabel} grid should finish its data load before measuring header geometry`,
            ).toBeHidden()
          }
          await expectVisibleFormControlsHaveNames(page, routeLabel)
          await expectViewportCanvasContinuity(page, `${theme} ${routeLabel}`, route.hasSidebarEntry)
          await expect(page.locator('[data-sg-state="fatal-error"]'), `${routeLabel} should not render a fatal error`).toHaveCount(0)
          const documentGeometry = await page.evaluate(() => ({
            body: document.body.scrollWidth,
            document: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
          }))
          expect(
            documentGeometry.document <= documentGeometry.viewport + 1 && documentGeometry.body <= documentGeometry.viewport + 1,
            `${routeLabel} should not create page-level horizontal overflow: ${JSON.stringify(documentGeometry)}`,
          ).toBe(true)
          const clippedHeaders = await getVisibleGridHeaderClips(page)
          expect(clippedHeaders, `${routeLabel} visible grid headings should fit: ${JSON.stringify(clippedHeaders)}`).toEqual([])
          await page.screenshot({
            path: testInfo.outputPath(`${theme}-${route.key}-empty-desktop-${viewport.width}x${viewport.height}.png`),
            fullPage: false,
            animations: 'disabled',
          })
        }
      }
      expect(errors, `${viewport.width}x${viewport.height} should render without browser errors`).toEqual([])
    })
  }

})
