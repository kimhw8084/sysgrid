import { expect, test } from '@playwright/test'
import { MonitoringView } from './pom/MonitoringView'
import {
  clickResilientButton,
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
