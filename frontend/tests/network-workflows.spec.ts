import {
  clickResilientButton,
  getColumnWidth,
  isColumnVisible,
  expectColumnRenderedWidth,
  expectHeaderBodyAligned,
  expectNoBrokenGridOverflow,
  expectMenuAnchoredNearTrigger,
  getGridHeaderBox,
  getGridCellBox,
  createAsset,
  createConnection,
  ensureSettingOption,
  resetBrowserState,
  getPrimaryGrid,
  waitForColumnRendered,
} from './helpers/sysgrid';
import { expect } from '@playwright/test';
import { test } from './helpers/sysgrid-test';

async function dragHeaderResize(page: any, colId: string, deltaX: number) {
  const handle = page.locator(`.ag-header-cell[col-id="${colId}"] .ag-header-cell-resize`).first()
  await expect(handle).toBeVisible()
  const box = await handle.boundingBox()
  if (!box) throw new Error(`No resize handle box for column ${colId}`)
  const startX = box.x + box.width / 2 - 3
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + deltaX, startY, { steps: 18 })
  await page.mouse.up()
}

test.describe('Network workflows', () => {
  test('supports deep-linked forensics, unit edits, and bulk sever from the grid', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    await page.setViewportSize({ width: 1920, height: 1080 })
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const farm = `PW-NET-${stamp}`
    await ensureSettingOption(request, 'NetworkFarm', farm)

    const source = await createAsset(request, {
      name: `PW-NET-SRC-${stamp}`,
      system: `PW-NET-SYS-${stamp}`,
      status: 'Active',
      model: 'R650',
      type: 'Physical',
      serial_number: `PW-NET-SRC-SN-${stamp}`,
      asset_tag: `PW-NET-SRC-AT-${stamp}`,
      owner: 'net-owner',
      business_unit: 'Operations'
    })
    const peerA = await createAsset(request, {
      name: `PW-NET-PEER-A-${stamp}`,
      system: `PW-NET-SYS-${stamp}`,
      status: 'Active',
      model: 'R650',
      type: 'Physical',
      serial_number: `PW-NET-PEER-A-SN-${stamp}`,
      asset_tag: `PW-NET-PEER-A-AT-${stamp}`,
      owner: 'net-owner',
      business_unit: 'Operations'
    })
    const peerB = await createAsset(request, {
      name: `PW-NET-PEER-B-${stamp}`,
      system: `PW-NET-SYS-${stamp}`,
      status: 'Active',
      model: 'R650',
      type: 'Physical',
      serial_number: `PW-NET-PEER-B-SN-${stamp}`,
      asset_tag: `PW-NET-PEER-B-AT-${stamp}`,
      owner: 'net-owner',
      business_unit: 'Operations'
    })

    const connA = await createConnection(request, {
      device_a_id: source.id,
      source_port: 'eth0',
      device_b_id: peerA.id,
      target_port: 'eth1',
      link_type: 'Data',
      speed_gbps: 10,
      unit: 'Gbps',
      status: 'Active',
      farm
    })
    await createConnection(request, {
      device_a_id: source.id,
      source_port: 'eth2',
      device_b_id: peerB.id,
      target_port: 'eth3',
      link_type: 'Management',
      speed_gbps: 1,
      unit: 'Gbps',
      status: 'Planned',
      farm
    })

    await page.goto(`/network?id=${connA.id}`)
    await expect(page.getByRole('heading', { name: 'Connection Forensics' })).toBeVisible()
    await expect(page.getByText(source.name).first()).toBeVisible()
    await clickResilientButton(page, 'Edit Connection')
    await expect(page.getByText('Edit Network Connection')).toBeVisible()
    const editModal = page.locator('.glass-panel').filter({ has: page.getByText('Edit Network Connection') })
    await editModal.locator('input[type="number"]').nth(2).fill('100')
    await editModal.getByRole('button', { name: 'Gbps' }).first().click()
    
    const mbpsButton = page.getByRole('button', { name: 'Mbps', exact: true })
    await expect(mbpsButton).toBeVisible({ timeout: 5000 })
    await mbpsButton.click()
    
    await clickResilientButton(page, 'Save Connection')
    await expect(page.getByText('Edit Network Connection')).not.toBeVisible()
    await page.goto(`/network?id=${connA.id}`)
    await expect(page.getByText('100.0 Mbps').first()).toBeVisible()
    await page.goto('/network')
    await expect(page.getByText('Scanning network matrix...')).not.toBeVisible({ timeout: 15000 })
    await page.getByPlaceholder('Scan matrix...').fill(farm)
    const rows = page.locator('.ag-center-cols-container .ag-row')
    await expect(rows).toHaveCount(2, { timeout: 15000 })
    const pinnedRows = page.locator('.ag-pinned-left-cols-container .ag-row')
    await pinnedRows.nth(0).locator('.ag-selection-checkbox').first().click()
    await expect(pinnedRows.nth(0)).toHaveClass(/ag-row-selected/)
    await pinnedRows.nth(1).locator('.ag-selection-checkbox').first().click()
    await expect(pinnedRows.nth(1)).toHaveClass(/ag-row-selected/)
    
    const bulkTrigger = page.getByRole('button', { name: /Bulk Actions/i })
    await bulkTrigger.click()
    const bulkMenu = page.locator('.bulk-menu-container')
    await expect(bulkMenu).toBeVisible({ timeout: 5000 })
    
    // Assert bulk menu anchoring geometry near its trigger with bottom constraint and viewport margin
    await expectMenuAnchoredNearTrigger(page, bulkTrigger, bulkMenu, { allowedSide: 'bottom', viewportMarginPx: 10 })

    const deactBtn = bulkMenu.getByText('De-activate Selection').first()
    await expect(deactBtn).toBeVisible({ timeout: 5000 })
    await deactBtn.click()

    const confirmBtn = page.getByRole('button', { name: 'Confirm De-activation?' }).first()
    await expect(confirmBtn).toBeVisible({ timeout: 5000 })
    await confirmBtn.click()
    await expect(page.locator('[role="treegrid"]')).not.toContainText(farm, { timeout: 30000 })
  })

  test('supports manual selection, modifiers, menu overlays, display configurations, and grouped grid parity', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    await page.setViewportSize({ width: 1920, height: 1080 })
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const farm = `PW-NET-MANUAL-${stamp}`
    await ensureSettingOption(request, 'NetworkFarm', farm)

    const source = await createAsset(request, {
      name: `PW-MAN-SRC-${stamp}`,
      system: `PW-MAN-SYS-${stamp}`,
      status: 'Active',
      model: 'R650',
      type: 'Physical',
      serial_number: `PW-MAN-SRC-SN-${stamp}`,
      asset_tag: `PW-MAN-SRC-AT-${stamp}`,
      owner: 'net-owner',
      business_unit: 'Operations'
    })
    const peerA = await createAsset(request, {
      name: `PW-MAN-PEER-A-${stamp}`,
      system: `PW-MAN-SYS-${stamp}`,
      status: 'Active',
      model: 'R650',
      type: 'Physical',
      serial_number: `PW-MAN-PEER-A-SN-${stamp}`,
      asset_tag: `PW-MAN-PEER-A-AT-${stamp}`,
      owner: 'net-owner',
      business_unit: 'Operations'
    })
    const peerB = await createAsset(request, {
      name: `PW-MAN-PEER-B-${stamp}`,
      system: `PW-MAN-SYS-${stamp}`,
      status: 'Active',
      model: 'R650',
      type: 'Physical',
      serial_number: `PW-MAN-PEER-B-SN-${stamp}`,
      asset_tag: `PW-MAN-PEER-B-AT-${stamp}`,
      owner: 'net-owner',
      business_unit: 'Operations'
    })

    const connA = await createConnection(request, {
      device_a_id: source.id,
      source_port: 'eth0',
      device_b_id: peerA.id,
      target_port: 'eth1',
      link_type: 'Data',
      speed_gbps: 10,
      unit: 'Gbps',
      status: 'Active',
      farm
    })
    const connB = await createConnection(request, {
      device_a_id: source.id,
      source_port: 'eth2',
      device_b_id: peerB.id,
      target_port: 'eth3',
      link_type: 'Management',
      speed_gbps: 1,
      unit: 'Gbps',
      status: 'Planned',
      farm
    })
    const connC = await createConnection(request, {
      device_a_id: source.id,
      source_port: 'eth4',
      device_b_id: peerB.id,
      target_port: 'eth5',
      link_type: 'Backup',
      speed_gbps: 5,
      unit: 'Gbps',
      status: 'Maintenance',
      farm
    })

    // 1. Verify Deep-linked route opens detail modal with visible dynamic identity
    await page.goto(`/network?id=${connA.id}`)
    await expect(page.getByRole('heading', { name: 'Connection Forensics' })).toBeVisible()
    const expectedTitle = `${source.name}:eth0 ↔ ${peerA.name}:eth1`
    await expect(page.getByRole('heading', { name: expectedTitle })).toBeVisible()
    
    // Close the detail modal via footer close button inside the modal dialog
    const forensicsDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Connection Forensics' }) })
    await forensicsDialog.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: 'Close' }).click()
    await expect(page.getByRole('heading', { name: 'Connection Forensics' })).not.toBeVisible()

    // 2. Load the network grid
    await page.goto('/network')
    await expect(page.getByText('Scanning network matrix...')).not.toBeVisible({ timeout: 15000 })
    await page.getByPlaceholder('Scan matrix...').fill(farm)

    const rows = page.locator('.ag-center-cols-container .ag-row')
    await expect(rows).toHaveCount(3, { timeout: 15000 })

    // 3. Prove manual normal row selection (single click)
    await rows.nth(0).locator('.ag-cell').first().click()
    await expect(rows.nth(0)).toHaveClass(/ag-row-selected/)
    await expect(rows.nth(1)).not.toHaveClass(/ag-row-selected/)
    await expect(rows.nth(2)).not.toHaveClass(/ag-row-selected/)

    // 4. Prove Ctrl/Cmd toggle selection
    const isMac = process.platform === 'darwin'
    const modifier = isMac ? 'Meta' : 'Control'
    await rows.nth(1).locator('.ag-cell').first().click({ modifiers: [modifier] })
    await expect(rows.nth(0)).toHaveClass(/ag-row-selected/)
    await expect(rows.nth(1)).toHaveClass(/ag-row-selected/)
    await expect(rows.nth(2)).not.toHaveClass(/ag-row-selected/)

    // 5. Prove Shift range selection
    // Single click on Row 0 first to clear other selections
    await rows.nth(0).locator('.ag-cell').first().click()
    await expect(rows.nth(0)).toHaveClass(/ag-row-selected/)
    await expect(rows.nth(1)).not.toHaveClass(/ag-row-selected/)
    await expect(rows.nth(2)).not.toHaveClass(/ag-row-selected/)

    // Shift-click Row 2
    await rows.nth(2).locator('.ag-cell').first().click({ modifiers: ['Shift'] })
    await expect(rows.nth(0)).toHaveClass(/ag-row-selected/)
    await expect(rows.nth(1)).toHaveClass(/ag-row-selected/)
    await expect(rows.nth(2)).toHaveClass(/ag-row-selected/)

    // 6. Prove bulk menu enables after selection
    const bulkTrigger = page.getByRole('button', { name: /Bulk Actions/i })
    await bulkTrigger.click()
    const bulkMenu = page.locator('.bulk-menu-container')
    await expect(bulkMenu).toBeVisible({ timeout: 5000 })
    
    // Assert bulk menu is anchored near its trigger with bottom constraint and viewport margin
    await expectMenuAnchoredNearTrigger(page, bulkTrigger, bulkMenu, { allowedSide: 'bottom', viewportMarginPx: 10 })

    // Close the bulk menu by pressing Escape to avoid pointer interception
    await page.keyboard.press('Escape')
    await expect(bulkMenu).not.toBeVisible()

    // 7. Prove row action menu opens from a row
    const rowActionTrigger = page.locator('.row-action-trigger').first()
    await rowActionTrigger.click()
    const rowActionMenu = page.locator('div.row-action-menu-container')
    await expect(rowActionMenu).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Row actions')).toBeVisible()

    // Assert row action menu is anchored near its trigger with bottom constraint and viewport margin
    await expectMenuAnchoredNearTrigger(page, rowActionTrigger, rowActionMenu, { allowedSide: 'bottom', viewportMarginPx: 10 })

    // Close row action menu via Escape
    await page.keyboard.press('Escape')
    await expect(rowActionMenu).not.toBeVisible()

    // 8. Prove display menu opens
    const displayTrigger = page.getByRole('button', { name: 'Display' })
    await displayTrigger.click()
    const displayMenu = page.locator('.display-menu-container').filter({ hasText: 'Display density' })
    await expect(displayMenu).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Display density')).toBeVisible()

    // Assert display menu is anchored near its trigger with bottom constraint and viewport margin
    await expectMenuAnchoredNearTrigger(page, displayTrigger, displayMenu, { allowedSide: 'bottom', viewportMarginPx: 10 })

    // 9. Prove Grouped grid renders and grouped selection works
    // Change Group By in Display menu to "Status"
    await displayMenu.getByRole('button', { name: 'Raw Rows' }).click()
    const groupOptionsPanel = page.locator('[data-workspace-panel="true"]').filter({ has: page.getByPlaceholder('Search options...') })
    await groupOptionsPanel.getByRole('button', { name: 'Status', exact: true }).click()
    
    // Toggle the display menu closed
    await displayTrigger.click()
    
    // The grid should now show grouped layout
    await expect(page.getByText('Grouped network matrix')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Active' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Planned' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Maintenance' })).toBeVisible()

    // Select a row inside "Active" group and see aggregation updates
    const activeSection = page.locator('section.glass-panel').filter({ has: page.getByRole('heading', { name: 'Active' }) })
    const activeRow = activeSection.locator('.ag-center-cols-container .ag-row').nth(0)
    await activeRow.locator('.ag-cell').first().click()
    await expect(activeRow).toHaveClass(/ag-row-selected/)
    await expect(activeSection.getByText('1 connections · 1 selected')).toBeVisible()

    // Cancel grouping
    const groupedHeader = page.getByText('Grouped network matrix', { exact: true }).locator('..').locator('..')
    await groupedHeader.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('Grouped network matrix')).not.toBeVisible()

    // Wait until raw rows are fully rendered and visible again
    await expect(rows).toHaveCount(3, { timeout: 15000 })

    // 10. Prove saved views menu opens
    const viewsTrigger = page.getByRole('button', { name: 'Views', exact: true })
    await viewsTrigger.click()
    const viewsMenu = page.locator('.views-menu-container').filter({ hasText: 'Saved views' })
    await expect(viewsMenu).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Saved views')).toBeVisible()

    // Assert saved views menu is anchored near its trigger with bottom constraint and viewport margin
    await expectMenuAnchoredNearTrigger(page, viewsTrigger, viewsMenu, { allowedSide: 'bottom', viewportMarginPx: 10 })

    // Dismiss views menu by pressing escape
    await page.keyboard.press('Escape')
    await expect(viewsMenu).not.toBeVisible()

    // 11. Prove column-width and grid geometry assertions
    // Verify initial column geometry (intelligence collapsed)
    const selectWidth = await getColumnWidth(page, 'select')
    const idWidth = await getColumnWidth(page, 'id')
    const favoriteWidth = await getColumnWidth(page, 'favorite')
    const actionWidth = await getColumnWidth(page, 'row_actions')

    const selectVisible = await isColumnVisible(page, 'select')
    const idVisible = await isColumnVisible(page, 'id')
    const favoriteVisible = await isColumnVisible(page, 'favorite')
    const watchVisible = await isColumnVisible(page, 'watch')
    const recentVisible = await isColumnVisible(page, 'recent_change')
    const actionVisible = await isColumnVisible(page, 'row_actions')

    expect(selectVisible).toBe(true)
    expect(selectWidth).toBe(64)
    
    expect(idVisible).toBe(true)
    expect(idWidth).toBe(90)
    
    expect(favoriteVisible).toBe(true)
    expect(favoriteWidth).toBe(80) // Favorite remains visible by default
    
    expect(watchVisible).toBe(false) // Watch is hidden/collapsed by default
    expect(recentVisible).toBe(false) // Recent Change is hidden/collapsed by default
    
    expect(actionVisible).toBe(true)
    expect(actionWidth).toBe(208)

    // Prove actual rendered DOM geometry and widths in collapsed state
    await expectColumnRenderedWidth(page, 'select', 64, 64)
    await expectColumnRenderedWidth(page, 'id', 90, 90)
    await expectColumnRenderedWidth(page, 'favorite', 80, 80)
    await expectColumnRenderedWidth(page, 'row_actions', 208, 208)

    // Scroll status into view using AG Grid API to ensure it is rendered and visible in DOM
    await page.evaluate(() => {
      // @ts-ignore
      const api = window.__DEBUG_NETWORK_GRID_API__
      if (api) api.ensureColumnVisible('status')
    })

    // Verify first main data column (status) is not collapsed and has substantial width
    const statusBox = await getGridHeaderBox(page, 'status')
    expect(statusBox.width).toBeGreaterThanOrEqual(100)

    // Prove header-body alignment for utility and status columns across multiple rows
    await expectHeaderBodyAligned(page, 'select', 2, 2)
    await expectHeaderBodyAligned(page, 'id', 2, 2)
    await expectHeaderBodyAligned(page, 'favorite', 2, 2)
    await expectHeaderBodyAligned(page, 'status', 2, 2)

    // Scroll farm into view using AG Grid API to handle virtualization
    await page.evaluate(() => {
      // @ts-ignore
      const api = window.__DEBUG_NETWORK_GRID_API__
      if (api) api.ensureColumnVisible('farm')
    })

    // Now 'farm' column is scrolled into view and rendered in the DOM with multi-row alignment proof
    const farmBox = await getGridHeaderBox(page, 'farm')
    expect(farmBox.width).toBeGreaterThanOrEqual(100)
    await expectHeaderBodyAligned(page, 'farm', 2, 2)

    // Scroll back status into view
    await page.evaluate(() => {
      // @ts-ignore
      const api = window.__DEBUG_NETWORK_GRID_API__
      if (api) api.ensureColumnVisible('status')
    })

    // Prove no broken grid overflow or clipping in the main grid shell
    await expectNoBrokenGridOverflow(page, getPrimaryGrid(page))

    // Expand intelligence columns
    await page.getByTitle('Show Activity Columns').click()

    // Wait until watch column is visible in DOM using custom helper
    await waitForColumnRendered(page, 'watch')

    // Verify expanded column geometry from state
    const watchVisibleExpanded = await isColumnVisible(page, 'watch')
    const recentVisibleExpanded = await isColumnVisible(page, 'recent_change')
    
    const watchWidthExpanded = await getColumnWidth(page, 'watch')
    const recentWidthExpanded = await getColumnWidth(page, 'recent_change')
    
    expect(watchVisibleExpanded).toBe(true)
    expect(watchWidthExpanded).toBe(85)
    
    expect(recentVisibleExpanded).toBe(true)
    expect(recentWidthExpanded).toBe(80)

    // Prove actual rendered DOM geometry and alignment for watch and recent_change in expanded state with multi-row proof
    await expectColumnRenderedWidth(page, 'watch', 85, 85)
    await expectColumnRenderedWidth(page, 'recent_change', 80, 80)
    await expectHeaderBodyAligned(page, 'watch', 2, 2)
    await expectHeaderBodyAligned(page, 'recent_change', 2, 2)

    // Collapse back
    await page.getByTitle('Hide Activity Columns').click()
    
    // AG Grid may retain a hidden header node in the DOM. Assert the
    // authoritative column state instead of treating DOM retention as visible.
    await expect.poll(() => isColumnVisible(page, 'watch')).toBe(false)
    
    expect(await isColumnVisible(page, 'watch')).toBe(false)
    expect(await isColumnVisible(page, 'recent_change')).toBe(false)
  })

  test('verifies golden column labels, domain order, pinning, resizability, bulk-edit dirty-close safety, context menu structure, and irreversible purge confirmation', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    await page.setViewportSize({ width: 1280, height: 800 })

    // Seed an old bad layout state (version 1) in localStorage to prove that the preference migration/reset guard automatically restores domain order on page load!
    await page.goto('/') // Navigate to landing first to mount localStorage context
    await page.evaluate(() => {
      window.localStorage.setItem('network_workspace_state_v1', JSON.stringify({
        version: 1, // Stale version!
        uiState: {
          columnLayoutState: [] // Empty layout triggers automatic sorting migration on mount
        }
      }))
    })

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const farm = `PW-GOLDEN-${stamp}`
    await ensureSettingOption(request, 'NetworkFarm', farm)

    const source = await createAsset(request, {
      name: `PW-G-SRC-${stamp}`,
      system: `PW-G-SYS-${stamp}`,
      status: 'Active',
      model: 'R650',
      type: 'Physical',
      serial_number: `PW-G-SRC-SN-${stamp}`,
      asset_tag: `PW-G-SRC-AT-${stamp}`,
      owner: 'net-owner',
      business_unit: 'Operations'
    })
    const peer = await createAsset(request, {
      name: `PW-G-PEER-${stamp}`,
      system: `PW-G-SYS-${stamp}`,
      status: 'Active',
      model: 'R650',
      type: 'Physical',
      serial_number: `PW-G-PEER-SN-${stamp}`,
      asset_tag: `PW-G-PEER-AT-${stamp}`,
      owner: 'net-owner',
      business_unit: 'Operations'
    })

    const conn = await createConnection(request, {
      device_a_id: source.id,
      source_port: 'eth0',
      device_b_id: peer.id,
      target_port: 'eth1',
      link_type: 'Data',
      speed_gbps: 10,
      unit: 'Gbps',
      status: 'Active',
      farm
    })

    await page.goto('/network')
    await expect(page.getByText('Scanning network matrix...')).not.toBeVisible({ timeout: 15000 })
    await page.getByPlaceholder('Scan matrix...').fill(farm)

    // Wait for the filtered rows to be fully rendered and stable
    const rows = page.locator('.ag-center-cols-container .ag-row')
    await expect(rows).toHaveCount(1, { timeout: 15000 })

    // Query full list of column headers from AG Grid API directly to verify exact wording
    // This is 100% immune to horizontal virtualization DOM clipping of offscreen columns
    const headerNames = await page.evaluate(() => {
      // @ts-ignore
      const api = window.__DEBUG_NETWORK_GRID_API__
      if (!api) return []
      return api.getColumns().map((col: any) => {
        const def = col.getColDef()
        return def.headerName || def.field || ''
      })
    })

    // 1. Verify exact visible headers
    const expectedHeaders = [
      'Source Node', 'Source Rack Slot', 'Source Port', 'Source IP',
      'Peer Node', 'Peer Rack Slot', 'Peer Port', 'Peer IP',
      'Type', 'Farm', 'Status', 'Speed', 'Direction', 'Purpose',
      'Created', 'Updated'
    ]
    for (const headerName of expectedHeaders) {
      expect(headerNames).toContain(headerName)
    }

    // Scroll Source Node and Source Rack Slot visible to ensure left columns are rendered in the DOM
    await page.evaluate(() => {
      // @ts-ignore
      const api = window.__DEBUG_NETWORK_GRID_API__
      if (api) {
        api.ensureColumnVisible('src_node')
        api.ensureColumnVisible('src_rack_slot')
      }
    })
    await page.waitForFunction(() => {
      const el = document.querySelector('.ag-header-cell[col-id="src_rack_slot"]')
      return el && el.getBoundingClientRect().width > 0
    })

    // 2. Verify complete default domain column sequence (proves stale layout was successfully migrated)
    const columnOrder = await page.evaluate(() => {
      // @ts-ignore
      const api = window.__DEBUG_NETWORK_GRID_API__
      if (!api) return []
      return api.getColumns().map((col: any) => col.getColId())
    })
    const domainColIds = [
      'src_node', 'src_rack_slot', 'src_port', 'src_ip',
      'peer_node', 'peer_rack_slot', 'peer_port', 'peer_ip',
      'type', 'farm', 'status', 'speed', 'direction', 'purpose',
      'created_at', 'updated_at'
    ]
    const filteredOrder = columnOrder.filter(id => domainColIds.includes(id))
    expect(filteredOrder).toEqual(domainColIds)

    // Verify relative positions of the first few visible columns across pinned and center headers in the DOM
    const colLabels = [
      { id: 'src_node', label: 'Source Node' },
      { id: 'src_rack_slot', label: 'Source Rack Slot' },
      { id: 'src_port', label: 'Source Port' },
      { id: 'src_ip', label: 'Source IP' }
    ]
    let lastX = -1
    for (const col of colLabels) {
      const box = await page.locator(`.ag-header-cell[col-id="${col.id}"]`).first().boundingBox()
      if (!box) throw new Error(`Header for ${col.id} not found in DOM`)
      expect(box.x).toBeGreaterThan(lastX)
      lastX = box.x
    }

    // 4. Verify column widths are sane & Status column is compact
    const statusWidth = await getColumnWidth(page, 'status')
    expect(statusWidth).toBeLessThan(180) // compact!

    // Verify no domain column is unconstrained/unreasonably stretched (all under 500px)
    for (const colId of domainColIds) {
      const w = await getColumnWidth(page, colId)
      expect(w).toBeLessThan(500)
    }

    // 5. Verify real mouse drag resize gesture works for Source Node and Status
    const initialSrcNodeWidth = await getColumnWidth(page, 'src_node')
    await dragHeaderResize(page, 'src_node', -40)

    // Wait dynamically until grid state reports updated column width
    await page.waitForFunction((initialW) => {
      // @ts-ignore
      const api = window.__DEBUG_NETWORK_GRID_API__
      if (!api) return false
      const col = api.getColumn('src_node')
      return col && col.getActualWidth() < initialW - 20
    }, initialSrcNodeWidth)

    const draggedSrcNodeWidth = await getColumnWidth(page, 'src_node')
    expect(draggedSrcNodeWidth).toBeLessThan(initialSrcNodeWidth)

    // Verify header-body alignment still holds after resize
    await expectHeaderBodyAligned(page, 'src_node', 1, 1)

    // Scroll status into view again to guarantee it is visible in the DOM
    await page.evaluate(() => {
      // @ts-ignore
      const api = window.__DEBUG_NETWORK_GRID_API__
      if (api) api.ensureColumnVisible('status')
    })

    const initialStatusWidth = await getColumnWidth(page, 'status')
    // Drag status smaller (negative deltaX) to prove resizability while safely avoiding status maxWidth limit
    await dragHeaderResize(page, 'status', -40)

    // Wait dynamically until grid state reports updated compact status width
    await page.waitForFunction((initialW) => {
      // @ts-ignore
      const api = window.__DEBUG_NETWORK_GRID_API__
      if (!api) return false
      const col = api.getColumn('status')
      return col && col.getActualWidth() < initialW - 20
    }, initialStatusWidth)

    const draggedStatusWidth = await getColumnWidth(page, 'status')
    expect(draggedStatusWidth).toBeLessThan(initialStatusWidth)

    await expectHeaderBodyAligned(page, 'status', 1, 1)

    // 3. Verify pinning of Source Node and stability during horizontal scroll (moves center columns but not pinned)
    // We execute this here because manual resizing has permanently bypassed auto-sizing and guaranteed massive horizontal scroll range!
    // Scroll all viewports to 0 first to guarantee we start at a completely stable left-scrolled baseline (scrollLeft = 0)
    await page.evaluate(() => {
      const targets = [
        document.querySelector('.ag-center-cols-viewport'),
        document.querySelector('.ag-body-horizontal-scroll-viewport'),
        document.querySelector('.ag-body-viewport')
      ]
      for (const el of targets) {
        if (el) {
          el.scrollLeft = 0
          el.dispatchEvent(new Event('scroll'))
        }
      }
    })
    await page.waitForFunction(() => {
      const el = document.querySelector('.ag-header-cell[col-id="src_ip"]')
      return el && el.getBoundingClientRect().width > 0
    })

    const srcNodeHeader = page.locator('.ag-pinned-left-header .ag-header-cell[col-id="src_node"]').first()
    await expect(srcNodeHeader).toBeVisible()
    const initialHeaderBox = await srcNodeHeader.boundingBox()
    if (!initialHeaderBox) throw new Error('No bounding box found for Source Node header')

    const srcIpHeader = page.locator('.ag-header-cell[col-id="src_ip"]').first()
    const srcIpBoxInit = await srcIpHeader.boundingBox()
    if (!srcIpBoxInit) throw new Error('No bounding box found for Source IP header')

    // Scroll horizontally natively with scroll event dispatch to prove freezing
    await page.evaluate(() => {
      const targets = [
        document.querySelector('.ag-center-cols-viewport'),
        document.querySelector('.ag-body-horizontal-scroll-viewport'),
        document.querySelector('.ag-body-viewport')
      ]
      for (const el of targets) {
        if (el) {
          el.scrollLeft = 150
          el.dispatchEvent(new Event('scroll'))
        }
      }
    })

    // Wait dynamically for scroll to complete by asserting Source IP header shifted left
    await page.waitForFunction((initialX) => {
      const cell = document.querySelector('.ag-header-cell[col-id="src_ip"]')
      if (!cell) return false
      const rect = cell.getBoundingClientRect()
      return rect.x < initialX - 30
    }, srcIpBoxInit.x)

    // Assert coordinates are completely stable (Source Node remains frozen on screen left while Source IP has shifted)
    const scrolledHeaderBox = await srcNodeHeader.boundingBox()
    if (!scrolledHeaderBox) throw new Error('No bounding box found for scrolled Source Node header')
    expect(scrolledHeaderBox.x).toEqual(initialHeaderBox.x)

    const scrolledSrcIpBox = await srcIpHeader.boundingBox()
    if (!scrolledSrcIpBox) throw new Error('No bounding box found for scrolled Source IP header')
    expect(scrolledSrcIpBox.x).toBeLessThan(srcIpBoxInit.x - 30)

    // Scroll back to center natively
    await page.evaluate(() => {
      const targets = [
        document.querySelector('.ag-center-cols-viewport'),
        document.querySelector('.ag-body-horizontal-scroll-viewport'),
        document.querySelector('.ag-body-viewport')
      ]
      for (const el of targets) {
        if (el) {
          el.scrollLeft = 0
          el.dispatchEvent(new Event('scroll'))
        }
      }
    })

    // Wait dynamically for scrollback to settle
    await page.waitForFunction((initialX) => {
      const cell = document.querySelector('.ag-header-cell[col-id="src_ip"]')
      if (!cell) return false
      const rect = cell.getBoundingClientRect()
      return Math.abs(rect.x - initialX) < 5
    }, srcIpBoxInit.x)

    // 6. Context Menu Right-click, Structure & Separators Check
    const firstCell = page.locator('.ag-center-cols-container .ag-row').nth(0).locator('.ag-cell').nth(0)
    await firstCell.click({ button: 'right' })
    
    const rowMenu = page.locator('div.row-action-menu-container')
    await expect(rowMenu).toBeVisible({ timeout: 5000 })
    
    // Check quick access items layout (single line icon and label) and proper title
    await expect(rowMenu.getByText('Details', { exact: true })).toBeVisible()
    await expect(rowMenu.getByText('Edit', { exact: true })).toBeVisible()
    await expect(rowMenu.getByText('Delete', { exact: true })).toBeVisible()

    // Assert separator line (exactly one line separating quick access and delete/purge)
    await expect(rowMenu.locator('.my-3.h-px.bg-slate-800')).toHaveCount(1)

    // Assert that action button has Golden Menu flex row structure (icon and label side-by-side)
    const deleteBtnContainer = rowMenu.locator('button:has-text("Delete")')
    await expect(deleteBtnContainer).toHaveClass(/flex-row items-center justify-center/)

    // Press escape to close
    await page.keyboard.press('Escape')
    await expect(rowMenu).not.toBeVisible()

    // 7. Bulk Edit & Multiple Dirty-Close Safety Routes Check
    const rowInCenter = page.locator('.ag-center-cols-container .ag-row').nth(0)
    await rowInCenter.locator('.ag-cell').first().click()
    await expect(rowInCenter).toHaveClass(/ag-row-selected/)
    
    await clickResilientButton(page, /Bulk Actions/i)
    await page.locator('.bulk-menu-container').getByText('Bulk Edit Table', { exact: true }).click()

    const bulkModal = page.locator('[role="dialog"]').filter({ hasText: 'Bulk Edit Network' })
    await expect(bulkModal).toBeVisible({ timeout: 5000 })

    // Verify there is exactly one visible Close button (the top-right red circle close dot, since hideFooterClose is true)
    const closeButtons = bulkModal.getByRole('button', { name: 'Close', exact: true })
    await expect(closeButtons).toHaveCount(1)

    // Verify clean close works directly
    await closeButtons.click()
    await expect(bulkModal).not.toBeVisible()

    // Open again to test dirty confirmations
    await clickResilientButton(page, /Bulk Actions/i)
    await page.locator('.bulk-menu-container').getByText('Bulk Edit Table', { exact: true }).click()
    await expect(bulkModal).toBeVisible({ timeout: 5000 })

    // Make an edit to make it dirty
    await bulkModal.locator('input[type="number"]').first().fill('50')

    const confirmDialog = page.locator('.absolute.inset-0').filter({ hasText: 'Discard Bulk Edits?' })

    // Route A: Backdrop/Overlay Click dirty safety trigger
    await bulkModal.click({ position: { x: 5, y: 5 } })
    await expect(confirmDialog).toBeVisible({ timeout: 5000 })
    // Click Close inside safety popup to return to editing
    await confirmDialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(confirmDialog).not.toBeVisible()
    await expect(bulkModal).toBeVisible()

    // Route B: Escape Key dirty safety trigger
    await page.keyboard.press('Escape')
    await expect(confirmDialog).toBeVisible({ timeout: 5000 })
    await confirmDialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(confirmDialog).not.toBeVisible()
    await expect(bulkModal).toBeVisible()

    // Route C: Canonical Close button dirty safety trigger
    await closeButtons.click()
    await expect(confirmDialog).toBeVisible({ timeout: 5000 })

    // Confirm and discard changes
    await confirmDialog.getByRole('button', { name: 'Discard Changes', exact: true }).click()
    await expect(confirmDialog).not.toBeVisible()
    await expect(bulkModal).not.toBeVisible()

    // 8. Test irreversible purge confirmation warning and fallback success toast
    // Soft delete the selected row using Bulk Actions
    // Open bulk actions menu
    await clickResilientButton(page, /Bulk Actions/i)
    const bulkMenuForDelete = page.locator('.bulk-menu-container')
    await expect(bulkMenuForDelete).toBeVisible({ timeout: 5000 })

    await bulkMenuForDelete.getByText('De-activate Selection', { exact: true }).click()
    const confirmDeactBtn = page.getByRole('button', { name: 'Confirm De-activation?' }).first()
    await expect(confirmDeactBtn).toBeVisible({ timeout: 5000 })
    await confirmDeactBtn.click()

    const networkPreview = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'Network bulk preview' }),
    })
    await expect(networkPreview).toBeVisible({ timeout: 5000 })
    const deleteResponsePromise = page.waitForResponse(response =>
      response.url().includes('/api/v1/networks/connections/bulk-delete') && response.status() === 200
    )
    await networkPreview.getByRole('button', { name: 'Confirm Archive selection' }).click()
    await deleteResponsePromise
    const deleteReceipt = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'Network bulk complete' }),
    })
    await expect(deleteReceipt).toBeVisible({ timeout: 15000 })
    await deleteReceipt.getByRole('button', { name: 'Close bulk receipt', exact: true }).click()
    
    // Switch to Deleted tab dynamically by waiting for row count in Active grid viewport to settle at 0
    await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(0, { timeout: 10000 })
    await clickResilientButton(page, 'Deleted')
    await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(1, { timeout: 10000 })

    // Try to purge connection via context menu
    const deletedCell = page.locator('.ag-center-cols-container .ag-row').nth(0).locator('.ag-cell').nth(0)
    await deletedCell.click({ button: 'right' })
    const deletedRowMenu = page.locator('div.row-action-menu-container')
    await deletedRowMenu.getByText('Purge', { exact: true }).click()

    // Verify ConfirmationModal warning appears
    const purgeConfirmModal = page.locator('[role="dialog"]').filter({ hasText: 'Confirm Permanent Purge?' })
    await expect(purgeConfirmModal).toBeVisible({ timeout: 5000 })
    await expect(purgeConfirmModal.getByText('WARNING: This action is completely irreversible')).toBeVisible()

    // Clicking Close in ConfirmationModal keeps it in the grid
    await purgeConfirmModal.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(purgeConfirmModal).not.toBeVisible()
    await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(1)

    // Trigger purge again and confirm
    await deletedCell.click({ button: 'right' })
    await deletedRowMenu.getByText('Purge', { exact: true }).click()
    await expect(purgeConfirmModal).toBeVisible({ timeout: 5000 })
    await purgeConfirmModal.getByRole('button', { name: 'Confirm Action', exact: true }).click()

    const purgePreview = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'Network bulk preview' }),
    })
    await expect(purgePreview).toBeVisible({ timeout: 5000 })
    await purgePreview.getByRole('button', { name: 'Confirm Purge selection' }).click()
    const purgeReceipt = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'Network bulk complete' }),
    })
    await expect(purgeReceipt).toBeVisible({ timeout: 15000 })
    await purgeReceipt.getByRole('button', { name: 'Close bulk receipt', exact: true }).click()

    // Verify it is purged from grid
    await expect(purgeConfirmModal).not.toBeVisible()
    await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(0, { timeout: 10000 })
  })
})
