import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { test } from './helpers/sysgrid-test'
import { expectReadableGridText } from './helpers/grid-contrast'
import {
  createConnection,
  createExternalEntity,
  createInvestigation,
  fillGridSearch,
  createProject,
  createRack,
  resetBrowserState,
  seedRackScenario,
  seedOperationalScenario,
  testApiHeaders,
  waitForAppIdle,
} from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const releaseCatalog = JSON.parse(readFileSync(new URL('../../contracts/system_management_v1.json', import.meta.url), 'utf8')) as {
  modules: Array<{ id: string; canonical_route: string; default_stage: string }>
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
      const declaredMinimum = Number(definition?.minWidth) || 0
      const declaredMaximum = Number(definition?.maxWidth)
      return { columnId, actual: column?.getActualWidth?.() ?? 0, minimum: Math.max(declaredMinimum, requiredMinimums[columnId] || 0), maximum: Math.min(Number.isFinite(declaredMaximum) ? declaredMaximum : Number.POSITIVE_INFINITY, requiredMaximums[columnId] || Number.POSITIVE_INFINITY) }
    })
  }, { apiName, columnIds, requiredMinimums, requiredMaximums })
  for (const column of widths) {
    expect(column.actual, `${route} ${column.columnId} should not be compressed below its declared minimum`).toBeGreaterThanOrEqual(column.minimum)
    if (Number.isFinite(column.maximum)) expect(column.actual, `${route} ${column.columnId} should respect its declared maximum`).toBeLessThanOrEqual(column.maximum)
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

async function expectCellFullValueTitle(page: Page, row: Locator, apiName: string, columnId: string, expected: string) {
  const ensured = await page.evaluate(({ apiName, columnId }) => {
    const api = (window as any)[apiName]
    if (!api?.getColumn?.(columnId)) return false
    api.ensureColumnVisible(columnId, 'middle')
    return true
  }, { apiName, columnId })
  expect(ensured, `${columnId} should be available before checking its full-value hover`).toBe(true)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(row.locator(`[col-id="${columnId}"] [title]`).first()).toHaveAttribute('title', expected)
}

async function expectGoldenWorkspaceHeader(page: Page, workspace: string, eyebrow: string) {
  const header = page.locator(`#sg-main-content [data-golden-workspace="${workspace}"] [data-golden-page-header="true"]`).first()
  await expect(header, `${workspace} should render the shared PageHeader`).toBeVisible()
  await expect(header).toContainText(eyebrow)
  const accent = await header.evaluate(element => getComputedStyle(element).borderLeftWidth)
  expect(accent, `${workspace} should use the shared colored header accent`).toBe('3px')
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

async function createArchitectureModel(request: APIRequestContext, stamp: string) {
  const apiOrigin = apiBase.replace(/\/api\/v1$/, '')
  const modelCommand = crypto.randomUUID()
  const modelResponse = await request.post(`${apiOrigin}/api/v2/architecture/models`, {
    data: { command_id: modelCommand, name: 'Visual Architecture' },
    headers: { ...testApiHeaders, 'Idempotency-Key': modelCommand },
  })
  expect(modelResponse.ok()).toBeTruthy()
  const model = (await modelResponse.json()).model
  const serviceId = `pw-visual-${stamp}-service`
  const storeId = `pw-visual-${stamp}-store`
  const serviceName = 'Checkout Service'
  const storeName = 'Orders DB'

  const command = async (type: string, expectedRevision: number, payload: Record<string, unknown>) => {
    const commandId = crypto.randomUUID()
    const response = await request.post(`${apiOrigin}/api/v2/architecture/models/${model.id}/commands`, {
      data: { command_id: commandId, type, expected: { model_revision: expectedRevision }, payload },
      headers: { ...testApiHeaders, 'Idempotency-Key': commandId },
    })
    expect(response.ok()).toBeTruthy()
  }

  await command('object.create', 1, { id: serviceId, kind: 'Application/Service', name: serviceName })
  await command('object.create', 2, { id: storeId, kind: 'Datastore', name: storeName })
  await command('relation.create', 3, { id: `pw-visual-${stamp}-relation`, source_id: serviceId, target_id: storeId, relation_type: 'Changes' })
  return { modelId: model.id, serviceName, storeName }
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
    const architecture = await createArchitectureModel(request, stamp)

    const project = await createProject(request, {
      name: 'Network reliability modernization',
      objective: 'Improve core network resilience without interrupting production services.',
      start_date: '2037-02-03T00:00:00Z',
      end_date: '2037-04-30T00:00:00Z',
      type: 'Strategic',
      status: 'Planning',
      priority: 'High',
    })

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

    const research = await createInvestigation(request, {
      title: `PW-SEED-RESEARCH-${stamp}`,
      problem_statement: 'Representative populated research investigation',
      category: 'Research',
      status: 'Analyzing',
      priority: 'High',
      systems: [seeded.systemName],
      initiation_at: '2037-02-03T04:05:00',
    })

    const vendor = await createVendor(request, stamp)

    const routes = [
      { key: 'monitoring', path: '/monitoring', workspace: 'monitoring' },
      { key: 'assets', path: '/asset', workspace: 'assets' },
      { key: 'services', path: '/services', workspace: 'services' },
      { key: 'external', path: '/external', workspace: 'external' },
      { key: 'network', path: '/network', workspace: 'network' },
      { key: 'far', path: '/far', workspace: 'far' },
      { key: 'research', path: '/research', workspace: 'research' },
      { key: 'vendors', path: '/vendors', workspace: 'vendors' },
    ] as const

    const supplementaryRoutes = [
      { key: 'home', path: '/' },
      { key: 'racks', path: '/racks' },
      { key: 'projects', path: '/projects' },
      { key: 'architecture', path: `/architecture?model=${encodeURIComponent(architecture.modelId)}` },
      { key: 'knowledge', path: '/knowledge' },
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
      research: { placeholder: 'Scan research...', name: 'Search investigations', value: research.title },
      vendors: { placeholder: 'Search vendors...', name: 'Search vendor records', value: vendor.name },
    }
    const releasedPaths = releaseCatalog.modules.filter(module => module.default_stage === 'production').map(module => module.canonical_route).sort()
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
          vendors: { apiName: '__DEBUG_VENDORS_GRID_API__', columnIds: ['country', 'primary_personnel_name', 'primary_personnel_email'] },
        }
        if (importantColumns[route.key]) {
          const target = importantColumns[route.key]
          const requiredMinimums = route.key === 'assets' ? { name: 180, system: 112, type: 96, status: 132, environment: 80, owner: 104 } : route.key === 'external' ? { status: 120, business_purpose: 220, link_count: 130 } : route.key === 'vendors' ? { name: 180, country: 136, primary_personnel_name: 180, primary_personnel_email: 190 } : { name: 180, country: 120, primary_personnel_name: 180, primary_personnel_email: 190 }
          const requiredMaximums = route.key === 'assets' ? { name: 210, system: 128, type: 104, status: 144, environment: 96, owner: 112 } : route.key === 'vendors' ? { name: 220, country: 136, primary_personnel_name: 200, primary_personnel_email: 200 } : {}
          const widthColumnIds = route.key === 'assets' ? ['name', 'system', 'type', 'environment', ...target.columnIds] : route.key === 'vendors' ? ['name', ...target.columnIds] : target.columnIds
          await expectColumnsFullyVisible(page, row, route.key, target.apiName, target.columnIds)
          await expectColumnMinimumWidths(page, route.key, target.apiName, widthColumnIds, requiredMinimums, requiredMaximums)
          if (route.key === 'assets') await expectHeaderTextFits(page, route.key, target.apiName, 'owner', 'Owner')
          if (route.key === 'assets') await expectCellFullValueTitle(page, row, target.apiName, 'status', 'Maintenance')
          if (route.key === 'assets') await expectCellContentFits(page, row, route.key, 'status', '.operational-grid-badge')
          if (route.key === 'external') await expectCellFullValueTitle(page, row, target.apiName, 'business_purpose', 'Golden Eight deterministic visual validation')
          if (route.key === 'vendors') await expectCellFullValueTitle(page, row, target.apiName, 'primary_personnel_name', 'Unassigned')
        }
        if (route.key === 'research') {
          await expect(row.locator('[col-id="title"]'), 'Long system names must leave record titles visible').toBeInViewport({ ratio: 0.5 })
        }
        if (route.key === 'network') {
          await expect(page.locator('#sg-main-content .ag-body-horizontal-scroll').first(), 'Dense network records must expose the horizontal column scroll affordance').toBeVisible()
        }
        if (route.key === 'research') {
          await row.locator('[col-id="title"]').hover()
        } else {
          await row.hover()
        }
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
            await expectCellContentFits(page, row, route.key, 'status', '.operational-grid-badge', true)
            await expectCellContentFits(page, row, route.key, 'owner', '.operational-grid-text', true)
          }
          if (route.key === 'vendors') {
            await expectCellContentFits(page, row, route.key, 'primary_personnel_email', 'button', true)
          }
        }
        if (route.key === 'research') {
          await expect(row.locator('[col-id="title"]'), 'Research title must be visible in the captured viewport').toBeInViewport({ ratio: 0.5 })
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
          await expect(page.getByRole('textbox', { name: 'Search racks and devices' })).toBeVisible()
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
        }
        if (route.key === 'projects') {
          const projectRow = page.locator('.p04-table tbody tr').filter({ hasText: project.name })
          await expect(projectRow).toBeVisible()
          const pageHeading = page.locator('.p04-page-heading')
          await expect(pageHeading).toBeVisible()
          const headingAccent = await pageHeading.evaluate(element => {
            const style = getComputedStyle(element)
            return { borderWidth: style.borderLeftWidth, borderStyle: style.borderLeftStyle, borderColor: style.borderLeftColor, padding: style.paddingLeft }
          })
          expect(headingAccent.borderWidth).toBe('3px')
          expect(headingAccent.borderStyle).toBe('solid')
          expect(headingAccent.borderColor).not.toBe('rgba(0, 0, 0, 0)')
          expect(headingAccent.padding).toBe('16px')
          await expect(projectRow).toContainText('Unassigned')
          await expect(projectRow).not.toContainText(/legacy:unresolved/i)
        }
        if (route.key === 'architecture') {
          await expectGoldenWorkspaceHeader(page, 'architecture', 'Infrastructure')
          await expect(page.locator('[data-pv1-architecture-engine="shared"]')).toBeVisible()
          await expect(page.locator('[aria-label="Canonical Architecture objects"]').getByText(architecture.serviceName, { exact: true })).toBeVisible()
          const graph = page.locator('[aria-label="Architecture diagram projection"] svg')
          const geometry = await graph.evaluate(svg => {
            const canvas = svg.getBoundingClientRect()
            const nodes = Array.from(svg.querySelectorAll('[role="button"]')).map(node => node.getBoundingClientRect())
            return { width: canvas.width, height: canvas.height, nodes: nodes.map(node => ({ width: node.width, height: node.height, centerX: node.left + node.width / 2, centerY: node.top + node.height / 2 })) }
          })
          expect(geometry.nodes).toHaveLength(2)
          expect(geometry.nodes.every(node => node.width > 150 && node.height > 65), 'Small architecture diagrams should use the available canvas instead of pinning nodes to its corner').toBe(true)
          const centerX = geometry.nodes.reduce((sum, node) => sum + node.centerX, 0) / geometry.nodes.length
          const centerY = geometry.nodes.reduce((sum, node) => sum + node.centerY, 0) / geometry.nodes.length
          const canvasRect = await graph.boundingBox()
          expect(canvasRect).not.toBeNull()
          expect(centerX).toBeGreaterThan(canvasRect!.x + canvasRect!.width * 0.3)
          expect(centerX).toBeLessThan(canvasRect!.x + canvasRect!.width * 0.7)
          expect(centerY).toBeGreaterThan(canvasRect!.y + canvasRect!.height * 0.3)
          expect(centerY).toBeLessThan(canvasRect!.y + canvasRect!.height * 0.7)
          await expect(page.getByText(`${architecture.serviceName} → ${architecture.storeName}`, { exact: true })).toBeVisible()
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
          await expect(payloadHeader).toHaveText('PAYLOAD & IMPACT')
          const payloadHeaderFits = await payloadHeader.evaluate(element => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1)
          expect(payloadHeaderFits, 'Audit payload heading should be readable in the desktop table').toBe(true)
        }
        if (route.key === 'knowledge') {
          await expect(page.getByText(seeded.knowledge.title, { exact: true }).first()).toBeVisible()
          const knowledgeHeading = page.getByRole('heading', { name: 'Collective Intelligence' })
          await expect(knowledgeHeading).toBeVisible()
          const titleLayout = await knowledgeHeading.evaluate(element => {
            const text = element.querySelector('[data-knowledge-title-text]') as HTMLElement | null
            return { height: element.getBoundingClientRect().height, textFits: Boolean(text && text.scrollWidth <= text.clientWidth + 1), fontSize: parseFloat(getComputedStyle(element).fontSize) }
          })
          expect(titleLayout.height, 'Knowledge title should stay compact in its header').toBeLessThanOrEqual(72)
          expect(titleLayout.textFits, 'Knowledge title words should not collide or clip').toBe(true)
          expect(titleLayout.fontSize, 'Knowledge title should meet the shared page-title size').toBeGreaterThanOrEqual(20)
          const summary = page.locator('[data-knowledge-summary]').first()
          expect((await summary.boundingBox())!.height, 'Summary cards must not stretch to the queue height').toBeLessThan(240)
          await expect(page.locator('[data-knowledge-record-list] h3').first(), 'Populated records must remain visible below the overview').toBeInViewport()
          const queueRegion = page.getByRole('region', { name: 'Knowledge action queue entries' })
          await expect(page.locator('[data-knowledge-queue]').getByText(/^\d+ items?$/)).toBeVisible()
          const firstQueuedEntry = queueRegion.getByRole('button').first()
          await expect(firstQueuedEntry, 'The first high-priority action must be fully visible without scrolling the queue').toBeVisible()
          const [queueBox, entryBox] = await Promise.all([queueRegion.boundingBox(), firstQueuedEntry.boundingBox()])
          expect(queueBox).not.toBeNull()
          expect(entryBox).not.toBeNull()
          expect(entryBox!.y).toBeGreaterThanOrEqual(queueBox!.y)
          expect(entryBox!.y + entryBox!.height).toBeLessThanOrEqual(queueBox!.y + queueBox!.height + 1)
        }
        await page.screenshot({ path: testInfo.outputPath(`${theme}-${route.key}-resting-desktop.png`), animations: 'disabled' })
        await expect(page.locator('#sg-main-content h1, #sg-main-content h2').first()).toBeVisible()
        await expect(page.locator('[data-sg-state="fatal-error"]')).toHaveCount(0)
        expect(new URL(page.url()).pathname).toBe(route.path.split('?')[0])
        if (route.key === 'projects') {
          await expect(page.locator('[data-resource-coverage-warning="true"]')).toHaveCount(0)
          const timelineToggle = page.getByRole('button', { name: 'Timeline', exact: true })
          await timelineToggle.click()
          await expect(timelineToggle).toHaveAttribute('aria-pressed', 'true')
          await expect(page.locator('[data-p04-portfolio-timeline="true"]')).toBeVisible()
          await expect(page.locator('[data-p04-portfolio-timeline="true"] .p04-timeline-row')).toHaveCount(1)
        }
        await page.screenshot({ path: testInfo.outputPath(`${theme}-${route.key}-interacted-desktop.png`), animations: 'disabled' })
      }
    }
    expect(headerClips, 'Every production workspace heading should fit without truncation').toEqual([])
    expect(errors).toEqual([])
    const timingsPath = testInfo.outputPath('workspace-navigation-timings.json')
    writeFileSync(timingsPath, JSON.stringify(timings, null, 2))
    await testInfo.attach('workspace-navigation-timings', { path: timingsPath, contentType: 'application/json' })
  })

  for (const viewport of [
    { width: 1024, height: 768 },
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
        .map(module => ({ key: module.id, path: module.canonical_route }))
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
          await expectVisibleFormControlsHaveNames(page, routeLabel)
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
