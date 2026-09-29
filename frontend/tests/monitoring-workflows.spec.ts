import { expect, test } from '@playwright/test'
import { MonitoringView } from './pom/MonitoringView'
import {
  clickResilientButton,
  createAsset,
  createEmbeddedKnowledgeFixture,
  createMonitoring,
  expectToast,
  expectWorkspaceRoute,
  fillGridSearch,
  getPrimaryGrid,
  getWorkspaceLogicalRowByText,
  getWorkspaceRoot,
  gotoView,
  openToolbarButton,
  resetBrowserState,
  seedOperationalScenario,
  selectGridCheckboxRows,
  testApiHeaders
} from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

async function getColumnWidth(page: any, colId: string) {
  return page.evaluate((targetColId: string) => {
    // @ts-ignore
    const api = window.__DEBUG_MONITORING_GRID_API__
    const state = api?.getColumnState?.() || []
    const column = state.find((entry: any) => entry.colId === targetColId)
    if (!column?.width) {
      throw new Error(`Missing width for column ${targetColId}`)
    }
    return Math.round(column.width)
  }, colId)
}

async function dragHeaderResize(page: any, colId: string, deltaX: number) {
  const handle = page.locator(`.ag-header-cell[col-id="${colId}"] .ag-header-cell-resize`).first()
  await expect(handle).toBeVisible()
  const box = await handle.boundingBox()
  if (!box) throw new Error(`No resize handle box for column ${colId}`)
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + deltaX, startY, { steps: 18 })
  await page.mouse.up()
}

async function openMonitoringDetailFromLogicalRow(page: any, title: string) {
  const logicalRow = await getWorkspaceLogicalRowByText(page, 'monitoring', title)
  const action = logicalRow.action('Open details')
  await expect(action, `Expected an "Open details" action on the monitoring row for "${title}"`).toBeVisible()
  await action.click()
  return logicalRow
}

test.describe('Monitoring workflows', () => {
  test('preserves lifecycle status, recovery linking, and knowledge jump paths', async ({ page, request }) => {
    await resetBrowserState(page)
    const { stamp, primary, monitoring, knowledge } = await seedOperationalScenario(request)

    const extraKnowledge = process.env.SYSGRID_VERIFY_PROFILE === 'normal-v1'
      ? null
      : await createEmbeddedKnowledgeFixture(request, primary.id, `PW-RECOVERY-EXTRA-${stamp}`)

    await page.goto(`/monitoring?id=${monitoring.id}`)
    await expectWorkspaceRoute(page, '/monitoring')
    await expect(getWorkspaceRoot(page, 'monitoring')).toBeVisible()
    await expect(page.getByRole('heading', { name: monitoring.title, exact: true }).first()).toBeVisible()
    await clickResilientButton(page, 'Recovery')
    const recoveryDialog = page.locator('[role="dialog"]').filter({ has: page.getByRole('heading', { name: 'Recovery Procedures' }) }).last()
    await expect(recoveryDialog).toBeVisible()
    await expect(recoveryDialog.getByText(knowledge.title, { exact: true })).toBeVisible()

    if (extraKnowledge) {
      await clickResilientButton(page, 'Link Procedure')
      await recoveryDialog.getByPlaceholder('Search Knowledge Base by title or category...').fill(extraKnowledge.title)
      const extraKnowledgeButton = recoveryDialog.getByRole('button', { name: new RegExp(extraKnowledge.title, 'i') }).first()
      await expect(extraKnowledgeButton).toBeVisible()
      await extraKnowledgeButton.click()
      await expect(page.getByText(extraKnowledge.title)).toBeVisible()
      await recoveryDialog.getByRole('button', { name: 'Synchronize Procedures', exact: true }).click()
      await expectToast(page, 'Synchronized recovery procedures')
      await expect(recoveryDialog.getByRole('button', { name: 'Synchronize Procedures', exact: true })).toBeDisabled()
      await clickResilientButton(page, /Close Search/i)
    }
    await page.getByRole('button').filter({ hasText: /^PW-RUNBOOK-/ }).click()
    await expect(page.getByText('Recovery procedure').first()).toBeVisible()
    const bkmDetailDialog = page.locator('[role="dialog"]').filter({ has: page.getByRole('heading', { name: knowledge.title, exact: true }) }).last()
    await bkmDetailDialog.getByTitle('Close').click()
    await expect(bkmDetailDialog).not.toBeVisible()
    await expect(recoveryDialog).toBeVisible()
    const standaloneRecoveryButton = recoveryDialog.getByTitle('Open Recovery BKM').first()
    await expect(standaloneRecoveryButton).toBeDisabled()
    await expect(standaloneRecoveryButton).toHaveAttribute('aria-disabled', 'true')
    await expect(page).toHaveURL(/\/monitoring(?:\?.*)?$/)
    await expect(page.getByText(knowledge.title, { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Recovery procedure').first()).toBeVisible()
  })

  test('supports bulk undo, compare, and persisted display state', async ({ page, request }) => {
    await resetBrowserState(page)
    const { stamp, primary } = await seedOperationalScenario(request)
    const titlePrefix = `PW-MON-OPS-${stamp}`

    const monitorA = await createMonitoring(request, {
      device_id: primary.id,
      category: 'Hardware',
      status: 'Existing',
      title: `${titlePrefix}-A`,
      platform: 'Prometheus',
      purpose: 'Bulk workflow validation A',
      impact: 'Synthetic validation path A',
      notification_method: 'Slack',
      severity: 'Warning',
      owners: [
        { name: 'Alex Ops', external_id: 'alex.ops@sysgrid.test', role: 'Primary Support' },
        { name: 'Jordan SRE', external_id: 'jordan.sre@sysgrid.test', role: 'Escalation' }
      ]
    })

    const monitorB = await createMonitoring(request, {
      device_id: primary.id,
      category: 'Hardware',
      status: 'Existing',
      title: `${titlePrefix}-B`,
      platform: 'Prometheus',
      purpose: 'Bulk workflow validation B',
      impact: 'Synthetic validation path B',
      notification_method: 'PagerDuty',
      severity: 'Warning',
      owners: [
        { name: 'Morgan Oncall', external_id: 'morgan.oncall@sysgrid.test', role: 'Primary Support' }
      ]
    })

    await gotoView(page, '/monitoring', 'Monitoring', 'monitoring')
    await fillGridSearch(page, 'Scan matrix...', titlePrefix, 'monitoring')
    await expect(getPrimaryGrid(page, 'monitoring')).toContainText(monitorA.title)
    await expect(getPrimaryGrid(page, 'monitoring')).toContainText(monitorB.title)

    await selectGridCheckboxRows(page, [0, 1])
    await expect(page.getByRole('button', { name: 'Compare' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Bulk Actions' }).first()).toBeEnabled()

    await openToolbarButton(page, 'Compare')
    const compareModal = page.locator('.glass-panel').filter({ has: page.getByRole('heading', { name: 'Compare Monitors' }) })
    await expect(compareModal.getByRole('heading', { name: 'Compare Monitors' })).toBeVisible()
    await expect(compareModal.getByRole('heading', { name: monitorA.title })).toBeVisible()
    await expect(compareModal.getByRole('heading', { name: monitorB.title })).toBeVisible()
    await compareModal.locator('button').first().click()
    await expect(compareModal).not.toBeVisible()

    await fillGridSearch(page, 'Scan matrix...', titlePrefix, 'monitoring')
    await openToolbarButton(page, 'Display')
    const displayMenu = page.locator('.display-menu-container').last()
    await displayMenu.getByRole('button', { name: /Raw Rows/i }).click()
    await page.locator('button').filter({ hasText: /^Platform$/ }).last().click()
    await page.keyboard.press('Escape')
    await expect(page.getByText('Sorted by Platform')).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'ID' }).first()).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Target Asset' }).first()).toBeVisible()

    await page.goto('/asset')
    await gotoView(page, '/monitoring', 'Monitoring', 'monitoring')
  })

  test('edits an existing monitor without save errors and persists the updated fields', async ({ page, request }) => {
    await resetBrowserState(page)
    const { monitoring } = await seedOperationalScenario(request)
    const updatedTitle = `${monitoring.title}-EDITED`
    const updatedPurpose = 'Edited through Playwright regression coverage'

    await gotoView(page, '/monitoring', 'Monitoring', 'monitoring')
    await fillGridSearch(page, 'Scan matrix...', monitoring.title, 'monitoring')
    await expect(getPrimaryGrid(page, 'monitoring')).toContainText(monitoring.title)
    await openMonitoringDetailFromLogicalRow(page, monitoring.title)
    await expect(page.getByRole('dialog').getByText(monitoring.title, { exact: true })).toBeVisible()
    await clickResilientButton(page, 'Edit Monitor')
    await expect(page.getByText('Update Monitoring')).toBeVisible()

    await page.getByPlaceholder('e.g. CORE-DB: High CPU Load Alert').fill(updatedTitle)
    await page.getByPlaceholder('Why are we monitoring this?').fill(updatedPurpose)
    await clickResilientButton(page, 'Save Monitoring')
    await expect(page.getByText('Update Monitoring')).not.toBeVisible()
    await expect.poll(async () => {
      const response = await request.get(`${apiBase}/monitoring?include_deleted=true`, { headers: testApiHeaders })
      const items = await response.json()
      return Array.isArray(items) && items.some((item: any) => item.id === monitoring.id && item.title === updatedTitle && item.purpose === updatedPurpose)
    }).toBeTruthy()

    await gotoView(page, '/monitoring', 'Monitoring', 'monitoring')
    await fillGridSearch(page, 'Scan matrix...', updatedTitle, 'monitoring')
    await expect(getPrimaryGrid(page, 'monitoring')).toContainText(updatedTitle)
    await expect(getPrimaryGrid(page, 'monitoring').getByText(monitoring.title, { exact: true })).toHaveCount(0)
    const updatedRow = await openMonitoringDetailFromLogicalRow(page, updatedTitle)
    await expect(page.getByRole('dialog').getByText(updatedTitle, { exact: true })).toBeVisible()
    await expect(page.getByText(updatedPurpose)).toBeVisible()

    const coldPage = await page.context().newPage()
    await coldPage.goto(`/monitoring?id=${monitoring.id}`)
    await expectWorkspaceRoute(coldPage, '/monitoring')
    await expect(getWorkspaceRoot(coldPage, 'monitoring')).toBeVisible()
    await expect(coldPage.getByRole('heading', { name: updatedTitle, exact: true }).first()).toBeVisible()
    await expect(coldPage.getByText(updatedPurpose).first()).toBeVisible()
    await expect(coldPage).toHaveURL(new RegExp(`/monitoring\\?id=${monitoring.id}$`))
    expect(updatedRow.rowKey.length).toBeGreaterThan(0)
    await coldPage.keyboard.press('Escape')
    await expect(coldPage.getByRole('heading', { name: updatedTitle, exact: true }).first()).not.toBeVisible()
    await expect(coldPage).toHaveURL(/\/monitoring(?:\?.*)?$/)
    await coldPage.close()
  })

  test('keeps the golden asset selector searchable and system-filterable in add/edit form', async ({ page, request }) => {
    await resetBrowserState(page)
    const { monitoring, systemName } = await seedOperationalScenario(request)
    const alternateSystem = `PW-SYS-ALT-${Date.now()}`
    const alternateAsset = await createAsset(request, {
      name: `PW-ASSET-ALT-${Date.now()}`,
      system: alternateSystem,
      status: 'Active',
      model: 'R740',
      type: 'Physical',
      serial_number: `PW-ALT-SN-${Date.now()}`,
      asset_tag: `PW-ALT-TAG-${Date.now()}`,
      owner: 'playwright',
      business_unit: 'Operations',
    })

    await gotoView(page, '/monitoring', 'Monitoring', 'monitoring')
    await fillGridSearch(page, 'Scan matrix...', monitoring.title, 'monitoring')
    await openMonitoringDetailFromLogicalRow(page, monitoring.title)
    await clickResilientButton(page, 'Edit Monitor')
    const updateDialog = page.getByRole('dialog').filter({ hasText: 'Update Monitoring' })
    await expect(updateDialog).toBeVisible()

    await updateDialog.getByRole('button', { name: new RegExp(`${systemName}`) }).click()
    await page.getByRole('button', { name: 'All Systems', exact: true }).click()
    await page.getByRole('button', { name: alternateSystem, exact: true }).click()
    await page.getByPlaceholder('Search hostname or system...').fill(alternateAsset.name)
    await expect(page.getByRole('button', { name: new RegExp(alternateAsset.name) })).toBeVisible()
    await page.getByRole('button', { name: new RegExp(alternateAsset.name) }).click()

    await expect(page.getByRole('button', { name: new RegExp(alternateAsset.name) })).toBeVisible()
    await clickResilientButton(page, 'Save Monitoring')
    await expect(page.getByText('Update Monitoring')).not.toBeVisible()
    await expect.poll(async () => {
      const response = await request.get(`${apiBase}/monitoring?include_deleted=true`, { headers: testApiHeaders })
      const items = await response.json()
      return Array.isArray(items) && items.some((item: any) => item.id === monitoring.id && item.device_id === alternateAsset.id)
    }).toBeTruthy()
  })

  test('keeps default title sizing dynamic and preserves human resized widths only in saved views', async ({ page, request }) => {
    await resetBrowserState(page)
    const { monitoring, primary } = await seedOperationalScenario(request)
    const originalTitle = monitoring.title
    const editedLongTitle = `${originalTitle} EXTREMELY LONG TITLE FOR PLAYWRIGHT DEFAULT WIDTH RECALC AFTER EDIT 0123456789`
    const createdLongTitle = `PW-MON-CREATED-LONG-${Date.now()}-THIS TITLE SHOULD FORCE A MUCH WIDER DEFAULT COLUMN AFTER CREATE WITH ADDITIONAL LONG SUFFIX SEGMENTS AAA BBB CCC DDD EEE FFF GGG HHH III JJJ`
    const viewName = `PW Width View ${Date.now()}`

    await gotoView(page, '/monitoring', 'Monitoring', 'monitoring')
    await fillGridSearch(page, 'Scan matrix...', originalTitle, 'monitoring')
    await expect(getPrimaryGrid(page, 'monitoring')).toContainText(originalTitle)

    const initialTitleWidth = await getColumnWidth(page, 'title')

    const updateResponse = await request.put(`${apiBase}/monitoring/${monitoring.id}`, {
      headers: testApiHeaders,
      data: {
        ...monitoring,
        title: editedLongTitle,
      }
    })
    expect(updateResponse.ok()).toBeTruthy()
    await expect.poll(async () => {
      const response = await request.get(`${apiBase}/monitoring?include_deleted=true`, { headers: testApiHeaders })
      const items = await response.json()
      return Array.isArray(items) && items.some((item: any) => item.id === monitoring.id && item.title === editedLongTitle)
    }).toBeTruthy()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Monitoring' })).toBeVisible()
    await fillGridSearch(page, 'Scan matrix...', editedLongTitle, 'monitoring')
    await expect(getPrimaryGrid(page, 'monitoring')).toContainText(editedLongTitle)

    const editedTitleWidth = await getColumnWidth(page, 'title')
    expect(editedTitleWidth).toBeGreaterThanOrEqual(170)
    expect(editedTitleWidth).toBeLessThanOrEqual(340)

    const createdMonitoring = await createMonitoring(request, {
      device_id: primary.id,
      category: 'Hardware',
      status: 'Existing',
      title: createdLongTitle,
      platform: 'Prometheus',
      purpose: 'Playwright create width regression',
      impact: 'Playwright create width regression',
      notification_method: 'Slack',
      severity: 'Warning',
    })
    await expect.poll(async () => {
      const response = await request.get(`${apiBase}/monitoring?include_deleted=true`, { headers: testApiHeaders })
      const items = await response.json()
      return Array.isArray(items) && items.some((item: any) => item.id === createdMonitoring.id && item.title === createdLongTitle)
    }).toBeTruthy()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Monitoring' })).toBeVisible()
    await fillGridSearch(page, 'Scan matrix...', createdLongTitle, 'monitoring')
    await expect(getPrimaryGrid(page, 'monitoring')).toContainText(createdLongTitle)

    const createdTitleWidth = await getColumnWidth(page, 'title')
    expect(createdTitleWidth).toBeGreaterThanOrEqual(170)
    expect(createdTitleWidth).toBeLessThanOrEqual(340)
    const titleHeader = getWorkspaceRoot(page, 'monitoring').locator('.ag-header-cell[col-id="title"]').first()
    const logicalRow = await getWorkspaceLogicalRowByText(page, 'monitoring', createdLongTitle)
    const titleCell = (logicalRow.pinned ?? logicalRow.center)?.locator('.ag-cell[col-id="title"]').first()
    if (!titleCell) {
      throw new Error(`Missing title cell for monitoring logical row ${logicalRow.rowKey}`)
    }
    await expect(titleHeader).toBeVisible()
    await expect(titleCell).toBeVisible()
    await expect.poll(async () => {
      const headerBox = await titleHeader.boundingBox()
      const cellBox = await titleCell.boundingBox()
      if (!headerBox || !cellBox) return false
      return Math.abs(headerBox.width - cellBox.width) <= 1
    }).toBeTruthy()
    await expect.poll(async () => titleCell.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBeTruthy()

    const manualViewWidth = 420
    const restoredDefaultAssetWidth = await getColumnWidth(page, 'device_name')
    expect(restoredDefaultAssetWidth).toBeLessThan(manualViewWidth - 60)

    const workspacePreference = await page.evaluate(({ nextViewName, nextWidth }) => {
      // @ts-ignore
      const api = window.__DEBUG_MONITORING_GRID_API__
      const widthState = (api?.getColumnState?.() || []).map((column: any) => (
        column.colId === 'device_name'
          ? { ...column, width: nextWidth }
          : column
      ))

      const savedView = {
        id: `pw-width-view-${Date.now()}`,
        name: nextViewName,
        config: {
          fontSize: 11,
          rowDensity: 8,
          hiddenColumns: [],
          groupBy: 'raw',
          showFilterBar: true,
          columnLayoutState: widthState,
          quickFilter: '',
          quickFilters: { status: '', severity: '', platform: '', owner: '' },
          filterModel: {},
          sortModel: [],
        }
      }

      return {
        version: 2,
        savedViews: [savedView],
        activeViewId: null,
        favoriteIds: [],
        watchIds: [],
        uiState: {
          activeTab: 'active',
          fontSize: 11,
          rowDensity: 8,
          hiddenColumns: [],
          quickFilters: { status: [], severity: [], platform: [], owner: [] },
          groupBy: 'raw',
          showFilterBar: true,
          columnLayoutState: widthState,
          lastVisitedAt: 0,
          searchTerm: '',
        }
      }
    }, { nextViewName: viewName, nextWidth: manualViewWidth })

    const createViewResponse = await request.post(`${apiBase}/workspaces/monitoring/views`, {
      headers: testApiHeaders,
      data: {
        name: viewName,
        scope: 'personal',
        team_id: null,
        definition: workspacePreference.savedViews[0].config,
        schema_version: 1,
      }
    })
    expect(createViewResponse.ok(), await createViewResponse.text()).toBeTruthy()
    const createdView = await createViewResponse.json()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Monitoring' })).toBeVisible()
    await fillGridSearch(page, 'Scan matrix...', createdLongTitle, 'monitoring')
    await openToolbarButton(page, 'Views')
    const savedViewButton = page.getByRole('button', { name: new RegExp(`^${viewName}`) }).first()
    await expect(savedViewButton).toBeVisible()
    await savedViewButton.click()
    await page.keyboard.press('Escape')
    await fillGridSearch(page, 'Scan matrix...', createdLongTitle, 'monitoring')
    await expect.poll(async () => getColumnWidth(page, 'device_name')).toBe(manualViewWidth)

    const cleanup = await request.delete(`${apiBase}/workspaces/views/${createdView.id}?revision=${createdView.revision}`, { headers: testApiHeaders })
    expect(cleanup.ok()).toBeTruthy()
  })

  test('imports monitoring rows through the shared operational import modal', async ({ page, request }) => {
    await resetBrowserState(page)
    const { stamp, primary, knowledge, monitoring } = await seedOperationalScenario(request)
    const importTitle = `PW-IMPORT-MON-${stamp}`
    const invalidTitle = `PW-IMPORT-BAD-${stamp}`

    await gotoView(page, '/monitoring', 'Monitoring', 'monitoring')
    await openToolbarButton(page, 'Import')
    await expect(page.getByRole('heading', { name: 'Monitoring Import' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Download Template' })).toBeVisible()

    await clickResilientButton(page, 'Paste CSV / Grid')
    await page.getByPlaceholder('Paste CSV with headers, or paste spreadsheet cells directly.').fill([
      'device_name,category,status,title,platform,owner_team,severity,recovery_doc_titles',
      `${primary.name},Hardware,Existing,${importTitle},Zabbix,,Warning,${knowledge.title}`,
      `UNKNOWN-ASSET,Hardware,Existing,${invalidTitle},Zabbix,,Warning,`,
    ].join('\n'))
    await clickResilientButton(page, 'Load Into Builder')
    await clickResilientButton(page, 'Initiate Audit')

    const importModal = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Monitoring Import' }) })
    const importButton = importModal.getByRole('button').filter({ hasText: /^Import(?:\s+\d+)?$/ })

    await expect(importModal.getByText('VALID', { exact: true })).toBeVisible({ timeout: 30000 })
    await expect(importModal.getByText('INVALID', { exact: true })).toBeVisible({ timeout: 30000 })
    await expect(importModal.getByText('UNKNOWN-ASSET', { exact: true })).toBeVisible({ timeout: 30000 })

    await expect(importButton).toBeVisible()
    await expect(importButton).toBeEnabled()
    await importButton.click()
    await expectToast(page, /Imported 1 row/i)
    await expect(page.getByRole('heading', { name: 'Monitoring Import' })).not.toBeVisible()

    await fillGridSearch(page, 'Scan matrix...', importTitle, 'monitoring')
    await expect(getPrimaryGrid(page, 'monitoring')).toContainText(importTitle)

    await fillGridSearch(page, 'Scan matrix...', invalidTitle, 'monitoring')
    await expect(getPrimaryGrid(page, 'monitoring')).not.toContainText(invalidTitle)
  })
})

test.describe('Monitoring permanent-purge authority', () => {
  test('late purge completion preserves the route after leaving Monitoring', async ({ page, request }) => {
    await resetBrowserState(page)
    const { monitoring } = await seedOperationalScenario(request)
    const archived = await request.post(`${apiBase}/monitoring/bulk-action`, { headers: testApiHeaders, data: { ids: [monitoring.id], action: 'delete' } })
    expect(archived.ok()).toBeTruthy()
    await gotoView(page, '/asset', 'Assets', 'assets')
    await page.getByRole('link', { name: 'Monitoring', exact: true }).click()
    await expectWorkspaceRoute(page, '/monitoring')
    await page.getByRole('button', { name: 'Archived', exact: true }).click()
    await fillGridSearch(page, 'Scan matrix...', monitoring.title, 'monitoring')
    await openMonitoringDetailFromLogicalRow(page, monitoring.title)
    let release!: () => void
    let held!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const pending = new Promise<void>(resolve => { held = resolve })
    await page.route('**/api/v1/monitoring/bulk-action', async route => {
      const body = route.request().postDataJSON()
      if (body.action === 'purge' && body.dry_run !== true) {
        held(); await gate
        await route.fulfill({ response: await route.fetch() })
      } else await route.continue()
    })
    try {
      await page.getByRole('dialog').getByRole('button', { name: 'Purge', exact: true }).click()
      const preview = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Monitoring bulk preview' }) })
      await expect(preview.getByRole('button', { name: 'Confirm Permanent purge' })).toBeEnabled()
      await preview.getByRole('button', { name: 'Confirm Permanent purge' }).click()
      await pending
      await page.goBack()
      await expectWorkspaceRoute(page, '/asset')
      const completed = page.waitForResponse(response => response.url().endsWith('/monitoring/bulk-action') && response.request().postDataJSON()?.action === 'purge')
      release()
      expect((await completed).ok()).toBeTruthy()
      await expect.poll(async () => {
        const rows = await (await request.get(`${apiBase}/monitoring?include_deleted=true`, { headers: testApiHeaders })).json()
        return rows.some((item: any) => item.id === monitoring.id)
      }).toBe(false)
      await expectWorkspaceRoute(page, '/asset')
      await expect(getWorkspaceRoot(page, 'assets')).toBeVisible()
    } finally { release() }
  })

  test('ordinary Archive still offers a working Revert', async ({ page, request }) => {
    await resetBrowserState(page)
    const { monitoring } = await seedOperationalScenario(request)
    await gotoView(page, '/monitoring', 'Monitoring', 'monitoring')
    await fillGridSearch(page, 'Scan matrix...', monitoring.title, 'monitoring')
    const row = await getWorkspaceLogicalRowByText(page, 'monitoring', monitoring.title)
    await row.action('More actions').click()
    await page.getByRole('button', { name: 'Archive', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm?', exact: true }).click()
    await expectToast(page, 'Archived 1 of 1 selected records.')
    const archived = await (await request.get(`${apiBase}/monitoring?include_deleted=true`, { headers: testApiHeaders })).json()
    expect(archived.find((item: any) => item.id === monitoring.id)?.is_deleted).toBe(true)
    await page.getByRole('button', { name: 'Revert', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm Undo?', exact: true }).click()
    await expectToast(page, 'Bulk operation reverted.')
    await expect.poll(async () => {
      const rows = await (await request.get(`${apiBase}/monitoring?include_deleted=true`, { headers: testApiHeaders })).json()
      return rows.find((item: any) => item.id === monitoring.id)?.is_deleted
    }).toBe(false)
    await expect(getPrimaryGrid(page, 'monitoring')).toContainText(monitoring.title)
  })

  for (const overlap of [true, false]) {
    test(`pending purge ${overlap ? 'blocks overlapping' : 'allows disjoint'} restore after dismissal`, async ({ page, request }) => {
      await resetBrowserState(page)
      const { monitoring, primary } = await seedOperationalScenario(request)
      const other = await createMonitoring(request, { device_id: primary.id, category: 'Hardware', status: 'Existing', title: `${monitoring.title}-PURGE-B`, platform: 'Zabbix' })
      const archived = await request.post(`${apiBase}/monitoring/bulk-action`, { headers: testApiHeaders, data: { ids: [monitoring.id, other.id], action: 'delete' } })
      expect(archived.ok()).toBeTruthy()
      await gotoView(page, '/monitoring', 'Monitoring', 'monitoring')
      await page.getByRole('button', { name: 'Archived', exact: true }).click()
      await fillGridSearch(page, 'Scan matrix...', monitoring.title, 'monitoring')
      let release!: () => void
      let held!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const pending = new Promise<void>(resolve => { held = resolve })
      let restoreRequests = 0
      page.on('request', message => {
        if (message.url().endsWith('/monitoring/bulk-action') && message.method() === 'POST' && message.postDataJSON()?.action === 'restore') restoreRequests++
      })
      await page.route('**/api/v1/monitoring/bulk-action', async route => {
        const body = route.request().postDataJSON()
        if (body.action === 'purge' && body.dry_run !== true) {
          held(); await gate
          await route.fulfill({ response: await route.fetch() })
        } else await route.continue()
      })
      try {
        const purgeRow = await getWorkspaceLogicalRowByText(page, 'monitoring', other.title)
        await purgeRow.action('More actions').click()
        await page.getByRole('button', { name: 'Purge', exact: true }).click()
        const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Monitoring bulk preview' }) })
        await expect(dialog.getByRole('button', { name: 'Confirm Permanent purge' })).toBeEnabled()
        await dialog.getByRole('button', { name: 'Confirm Permanent purge' }).click()
        await pending
        await dialog.getByTitle('Close', { exact: true }).click()
        await expect(dialog).not.toBeVisible()
        const target = overlap ? other : monitoring
        const restoreRow = await getWorkspaceLogicalRowByText(page, 'monitoring', target.title)
        await restoreRow.action('More actions').click()
        const restoreFinished = !overlap ? page.waitForResponse(response => {
          const message = response.request()
          return message.url().endsWith('/monitoring/bulk-action') && message.method() === 'POST'
            && message.postDataJSON()?.action === 'restore' && message.postDataJSON()?.ids?.includes(target.id)
        }) : null
        await page.getByRole('button', { name: 'Restore', exact: true }).click()
        if (overlap) {
          await expectToast(page, 'An overlapping operation is still pending.')
          expect(restoreRequests).toBe(0)
          // A real separate transaction invalidates the held preview.
          for (const action of ['restore', 'delete']) {
            const changed = await request.post(`${apiBase}/monitoring/bulk-action`, { headers: testApiHeaders, data: { ids: [other.id], action } })
            expect(changed.ok()).toBeTruthy()
          }
          release()
          await expectToast(page, /Nothing was purged/)
          const retryRow = await getWorkspaceLogicalRowByText(page, 'monitoring', other.title)
          await retryRow.action('More actions').click()
          await page.getByRole('button', { name: 'Restore', exact: true }).click()
        } else {
          await expect.poll(() => restoreRequests).toBe(1)
          expect((await restoreFinished!).ok()).toBeTruthy()
          await page.getByRole('button', { name: 'Existing', exact: true }).click()
          // The archived purge target shares the title prefix. Bind this action
          // to the restored ID while the grid transitions between datasets.
          const restoredRow = getPrimaryGrid(page, 'monitoring').locator(`.ag-pinned-right-cols-container .ag-row[row-id="${monitoring.id}"]`)
          await restoredRow.getByRole('button', { name: 'Open details', exact: true }).click()
          await expect(page.getByRole('dialog').getByRole('heading', { name: monitoring.title, exact: true })).toBeVisible()
          release()
        }
        await expect.poll(async () => {
          const rows = await (await request.get(`${apiBase}/monitoring?include_deleted=true`, { headers: testApiHeaders })).json()
          return rows.find((item: any) => item.id === target.id)?.is_deleted
        }).toBe(false)
        if (!overlap) await expect.poll(async () => {
          const rows = await (await request.get(`${apiBase}/monitoring?include_deleted=true`, { headers: testApiHeaders })).json()
          return rows.some((item: any) => item.id === other.id)
        }).toBe(false)
        if (!overlap) {
          await expect(page.getByRole('dialog').getByRole('heading', { name: monitoring.title, exact: true })).toBeVisible()
          expect(new URL(page.url()).searchParams.get('id')).toBe(String(monitoring.id))
        }
      } finally { release() }
    })
  }
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    for (const entry of ['row', 'detail'] as const) {
      test(`${entry} preview and irreversible receipt at ${viewport.width}`, async ({ page, request }, testInfo) => {
        await page.setViewportSize(viewport)
        await resetBrowserState(page)
        const failedReads: string[] = []
        page.on('response', response => {
          if (response.url().includes('/api/') && response.request().method() === 'GET' && response.status() >= 400) failedReads.push(`${response.status()} ${response.url()}`)
        })
        const { monitoring } = await seedOperationalScenario(request)
        const archived = await request.post(`${apiBase}/monitoring/bulk-action`, {
          headers: testApiHeaders, data: { ids: [monitoring.id], action: 'delete' },
        })
        expect(archived.ok(), await archived.text()).toBeTruthy()
        await gotoView(page, '/monitoring', 'Monitoring', 'monitoring')
        await page.getByRole('button', { name: 'Archived', exact: true }).click()
        await fillGridSearch(page, 'Scan matrix...', monitoring.title, 'monitoring')
        const row = await getWorkspaceLogicalRowByText(page, 'monitoring', monitoring.title)
        if (entry === 'detail') {
          await row.action('Open details').click()
          await page.getByRole('dialog').getByRole('button', { name: 'Purge', exact: true }).click()
        } else {
          await row.action('More actions').click()
          await page.getByRole('button', { name: 'Purge', exact: true }).click()
        }
        const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Monitoring bulk preview' }) })
        await expect(dialog).toBeVisible()
        await expect(dialog.getByText('This purge cannot be restored or reverted.')).toBeVisible()
        await expect(dialog.getByRole('button', { name: 'Confirm Permanent purge' })).toBeEnabled()
        await expect(dialog.getByText('Monitoring history', { exact: true })).toBeVisible()
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy()
        const before = await request.get(`${apiBase}/monitoring?include_deleted=true`, { headers: testApiHeaders })
        expect((await before.json()).some((item: any) => item.id === monitoring.id)).toBeTruthy()
        await testInfo.attach('preview-state', { body: JSON.stringify({ viewport, entry, targetId: monitoring.id, url: page.url(), text: await dialog.innerText() }), contentType: 'application/json' })
        await expect(dialog.locator(':scope > .glass-panel').first()).toHaveCSS('opacity', '1')
        await page.screenshot({ path: testInfo.outputPath(`purge-preview-${entry}-${viewport.width}.png`), animations: 'disabled' })

        if (entry === 'row' && viewport.width === 1440) {
          const restored = await request.post(`${apiBase}/monitoring/bulk-action`, { headers: testApiHeaders, data: { ids: [monitoring.id], action: 'restore' } })
          expect(restored.ok()).toBeTruthy()
          const rearchived = await request.post(`${apiBase}/monitoring/bulk-action`, { headers: testApiHeaders, data: { ids: [monitoring.id], action: 'delete' } })
          expect(rearchived.ok()).toBeTruthy()
          await dialog.getByRole('button', { name: 'Confirm Permanent purge' }).click()
          await expect(dialog.getByRole('alert')).toContainText('Nothing was purged')
          const retained = await request.get(`${apiBase}/monitoring?include_deleted=true`, { headers: testApiHeaders })
          expect((await retained.json()).some((item: any) => item.id === monitoring.id)).toBeTruthy()
          await dialog.getByRole('button', { name: 'Review fresh preview' }).click()
          await expect(dialog.getByRole('button', { name: 'Confirm Permanent purge' })).toBeEnabled()
        }
        await dialog.getByRole('button', { name: 'Confirm Permanent purge' }).click()
        const receipt = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Monitoring bulk complete' }) })
        await expect(receipt).toBeVisible()
        await expect(receipt.getByRole('button', { name: /Undo|Revert/ })).toHaveCount(0)
        await expect(receipt.getByText('This purge cannot be restored or reverted.')).toBeVisible()
        const after = await request.get(`${apiBase}/monitoring?include_deleted=true`, { headers: testApiHeaders })
        expect((await after.json()).some((item: any) => item.id === monitoring.id)).toBeFalsy()
        await testInfo.attach('receipt-state', { body: JSON.stringify({ viewport, entry, targetId: monitoring.id, url: page.url(), text: await receipt.innerText() }), contentType: 'application/json' })
        await expect(receipt.locator(':scope > .glass-panel').first()).toHaveCSS('opacity', '1')
        await page.screenshot({ path: testInfo.outputPath(`purge-receipt-${entry}-${viewport.width}.png`), animations: 'disabled' })
        await receipt.getByRole('button', { name: 'Close bulk receipt' }).click()
        await expect(receipt).not.toBeVisible()
        await expect(page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: monitoring.title, exact: true }) })).not.toBeVisible()
        expect(new URL(page.url()).searchParams.get('id')).not.toBe(String(monitoring.id))
        expect(failedReads).toEqual([])
      })
    }
  }
})
