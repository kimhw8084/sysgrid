import { clickResilientButton, createAsset, expectWorkspaceLogicalRowSelected, fillGridSearch, getWorkspaceLogicalRowByText, getWorkspaceRoot, openToolbarButton, resetBrowserState, seedOperationalScenario, selectWorkspaceLogicalRow, verifyGridRowRobust } from './helpers/sysgrid';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { test } from './helpers/sysgrid-test';
import fs from 'fs';

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

async function attachEvidence(testInfo: TestInfo, name: string, body: Buffer | string, contentType: string) {
  const path = testInfo.outputPath(name)
  fs.writeFileSync(path, body)
  await testInfo.attach(name, { path, contentType })
}

const isBulkExecutionResponse = (response: any) => {
  if (!response.url().includes('/api/v1/devices/bulk-action') || response.request().method() !== 'POST') return false
  try {
    return (response.request().postDataJSON() as { dry_run?: boolean } | null)?.dry_run !== true
  } catch {
    return false
  }
}

async function runAssetRowLifecycleAction(page: Page, action: 'delete' | 'purge', assetName: string) {
  if (action === 'purge') await openToolbarButton(page, /^Archived/)
  else await openToolbarButton(page, /^Existing/)
  await fillGridSearch(page, 'Scan asset matrix...', assetName)
  const row = await getWorkspaceLogicalRowByText(page, 'assets', assetName)
  await row.action('More actions').click()
  await page.getByRole('button', { name: action === 'delete' ? 'Archive' : 'Purge', exact: true }).click()

  const previewResponsePromise = page.waitForResponse(response => (
    response.url().includes('/api/v1/devices/bulk-action')
    && response.request().method() === 'POST'
    && response.status() === 200
    && (response.request().postDataJSON() as { dry_run?: boolean } | null)?.dry_run === true
  ))
  await page.getByRole('button', { name: action === 'delete' ? 'Confirm Archive?' : 'Confirm Purge?', exact: true }).click()
  const previewResponse = await previewResponsePromise
  const preview = await previewResponse.json()
  const previewDialog = page.getByRole('dialog', { name: 'Assets bulk preview' })
  await expect(previewDialog).toBeVisible()

  const executionResponsePromise = page.waitForResponse(isBulkExecutionResponse)
  await previewDialog.getByRole('button', {
    name: action === 'delete' ? 'Confirm Archive selection' : 'Confirm Purge selection',
  }).click()
  const executionResponse = await executionResponsePromise
  const receipt = executionResponse.ok() ? await executionResponse.json() : null
  if (executionResponse.ok()) {
    await expect(page.getByRole('dialog', { name: 'Assets bulk complete' })).toBeVisible()
  }
  return { preview, executionResponse, receipt }
}

async function createRecoveryAsset(request: any, name: string, system: string) {
  return createAsset(request, {
    name,
    system,
    status: 'Active',
    type: 'Physical',
    environment: 'Production',
    serial_number: `${name}-SN`,
    asset_tag: `${name}-TAG`,
  })
}

async function getDeviceFromBackend(request: any, id: number) {
  const response = await request.get(`${apiBase}/devices?include_deleted=true`)
  expect(response.ok(), `GET devices failed (${response.status()}): ${await response.text()}`).toBeTruthy()
  const devices = await response.json()
  return devices.find((device: any) => Number(device.id) === Number(id))
}

async function archiveSelectedAssets(page: Page, assetNames: string[], systemName: string) {
  await openToolbarButton(page, /^Existing/)
  await fillGridSearch(page, 'Scan asset matrix...', systemName)
  for (const [index, assetName] of assetNames.entries()) {
    const row = await getWorkspaceLogicalRowByText(page, 'assets', assetName)
    await selectWorkspaceLogicalRow(row, { additive: index > 0 })
  }
  await page.getByRole('button', { name: /Bulk Actions/i }).first().click()
  await page.getByText('Archive Selection', { exact: true }).click()
  const previewResponsePromise = page.waitForResponse(response => (
    response.url().includes('/api/v1/devices/bulk-action')
    && response.request().method() === 'POST'
    && response.status() === 200
    && (response.request().postDataJSON() as { dry_run?: boolean } | null)?.dry_run === true
  ))
  await page.getByRole('button', { name: 'Preview Archive' }).click()
  const preview = await (await previewResponsePromise).json()
  const previewDialog = page.getByRole('dialog', { name: 'Assets bulk preview' })
  await expect(previewDialog).toBeVisible()
  const executionResponsePromise = page.waitForResponse(isBulkExecutionResponse)
  await previewDialog.getByRole('button', { name: 'Confirm Archive selection' }).click()
  const executionResponse = await executionResponsePromise
  expect(executionResponse.ok()).toBeTruthy()
  const receipt = await executionResponse.json()
  await expect(page.getByRole('dialog', { name: 'Assets bulk complete' })).toBeVisible()
  return { preview, receipt }
}

test.describe('Assets workflows', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('simulates the changed Assets workflows end-to-end', async ({ page, sysApi: request }, testInfo) => {
    test.setTimeout(120_000)
    await resetBrowserState(page)
    const { stamp, systemName, primary, secondary, tertiary, monitoring } = await seedOperationalScenario(request)
    const purgeImpactSeed = await request.post(`${apiBase}/devices/${secondary.id}/hardware`, {
      data: { category: 'CPU', name: `PW-PURGE-IMPACT-${stamp}`, count: 1 },
    })
    expect(purgeImpactSeed.ok()).toBeTruthy()

    // Keep Archived populated so the target-name search exercises the filtered-empty state.
    const purgedScopeKeeperResponse = await request.post(`${apiBase}/devices`, {
      data: {
        name: `PW-ASSET-PURGED-SCOPE-${stamp}`,
        system: systemName,
        status: 'Active',
        type: 'Physical',
        environment: 'Production',
        serial_number: `PW-SN-PURGED-SCOPE-${stamp}`,
        asset_tag: `PW-TAG-PURGED-SCOPE-${stamp}`,
      },
    })
    expect(purgedScopeKeeperResponse.ok()).toBeTruthy()
    const purgedScopeKeeper = await purgedScopeKeeperResponse.json()
    const archiveScopeKeeperResponse = await request.post(`${apiBase}/devices/bulk-action`, {
      data: { ids: [purgedScopeKeeper.id], action: 'delete' },
    })
    expect(archiveScopeKeeperResponse.ok()).toBeTruthy()
    expect((await archiveScopeKeeperResponse.json()).changed_count).toBe(1)

    await page.goto('/asset')
    await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible()
    await expect(page.getByText('Syncing asset registry...')).not.toBeVisible()

    await page.getByPlaceholder('Scan asset matrix...').fill(systemName)
    await page.keyboard.press('Enter')
    await expect(page.locator('[role="treegrid"]')).toContainText(primary.name, { timeout: 15_000 })
    await expect(page.locator('[role="treegrid"]')).toContainText(secondary.name, { timeout: 15_000 })
    await expect(page.locator('[role="treegrid"]')).toContainText(tertiary.name, { timeout: 15_000 })

    // Required Browser/E2E Scenario 15: Right-click selects/focuses the clicked row and opens context menu at the pointer
    const plainCell = page.locator('.ag-cell').filter({ hasText: systemName }).first()
    await plainCell.click({ button: 'right' })
    await expect(page.getByRole('button', { name: 'View Details' })).toBeVisible()
    await page.keyboard.press('Escape') // Dismiss row action menu

    // Required Browser/E2E Scenario 10: Expand Table changes utility columns visibility (star/eye)
    // Required Browser/E2E Scenario 11: Favorite/watch toggles update icon state in grid without page refresh
    const toggleIntelligenceButton = page.locator('button[title="Show Intelligence Columns"], button[title="Hide Intelligence Columns"]').first()
    await expect(toggleIntelligenceButton).not.toHaveAttribute('aria-pressed')
    await toggleIntelligenceButton.click()
    await expect(toggleIntelligenceButton).toHaveAttribute('aria-pressed', 'true')

    // Toggle Pin/Watch while columns are visible
    const pinBtn = page.getByTitle('Pin asset').first()
    await expect(pinBtn).toBeVisible()
    await pinBtn.click()
    const unpinBtn = page.getByTitle('Unpin asset').first()
    await expect(unpinBtn).toBeVisible()
    await unpinBtn.click()

    // Toggle back to collapsed state
    await toggleIntelligenceButton.click()
    await expect(toggleIntelligenceButton).not.toHaveAttribute('aria-pressed')

    const assetRowActions = page.getByTitle('More actions')
    const viewDetailsButtons = page.getByRole('button', { name: 'View Details', exact: true })
    const openKnowledgeButton = page.locator('button[data-module-action="knowledge"]').first()
    const farRisksButton = page.locator('button[data-module-action="far"]').first()
    const auditButton = page.getByRole('button', { name: 'Audit', exact: true })
    const bulkActionsButton = page.getByRole('button', { name: /Bulk Actions/i })
    const compareVisibleButton = page.getByTitle('Compare selected assets')

    const primaryDetailsRow = await getWorkspaceLogicalRowByText(page, 'assets', primary.name)
    await primaryDetailsRow.action('More actions').click()
    await viewDetailsButtons.filter({ visible: true }).click()
    await expect(page.getByText(primary.name).first()).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('Suggested Runbooks Now')).toBeVisible()
    await expect(farRisksButton).toBeVisible()
    await expect(farRisksButton).toBeDisabled()
    await expect(auditButton).toBeVisible()
    await expect(page.getByText(`PW-MON-${stamp}`)).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(`PW-RUNBOOK-${stamp}`, 'i') }).first()).toBeVisible()
    await expect(page.getByText(`PW-MAINT-${stamp}`)).toBeVisible()
    if (process.env.SYSGRID_VERIFY_PROFILE === 'root-preview') {
      await expect(openKnowledgeButton).toBeEnabled()
      await expect(openKnowledgeButton).not.toHaveAttribute('aria-disabled', 'true')
    } else {
      await expect(openKnowledgeButton).toBeDisabled()
      await expect(openKnowledgeButton).toHaveAttribute('aria-disabled', 'true')
    }
    await expect(page).toHaveURL(/\/asset/)

    await page.goto('/asset')
    await page.getByPlaceholder('Scan asset matrix...').fill(primary.name)
    await page.keyboard.press('Enter')
    await expect(page.locator('[role="treegrid"]')).toContainText(primary.name, { timeout: 15_000 })
    await primaryDetailsRow.action('More actions').click()
    await viewDetailsButtons.filter({ visible: true }).click()

    await expect(farRisksButton).toBeDisabled()
    await expect(farRisksButton).toHaveAttribute('data-module-action', 'far')

    await page.goto('/asset')
    await page.getByPlaceholder('Scan asset matrix...').fill(primary.name)
    await page.keyboard.press('Enter')
    await expect(page.locator('[role="treegrid"]')).toContainText(primary.name, { timeout: 15_000 })
    await primaryDetailsRow.action('More actions').click()
    await viewDetailsButtons.filter({ visible: true }).click()
    await auditButton.click()
    await expect(page).toHaveURL(new RegExp(`/logs\\?target_table=devices&target_id=${primary.id}`))
    await expect(page.getByText(`Scoped: devices // ${primary.id}`)).toBeVisible()

    await page.goto('/asset')
    await page.getByPlaceholder('Scan asset matrix...').fill(systemName)
    const rows = page.locator('.ag-center-cols-container .ag-row')
    await expect(rows).toHaveCount(3, { timeout: 15_000 })
    // Target 1 Proof: Plain row-click selects a row (facilitated by suppressRowClickSelection={false})
    const cell0 = rows.nth(0).locator('.ag-cell').nth(1)
    await cell0.click()
    await expect(rows.nth(0)).toHaveClass(/ag-row-selected/)
    // Target B.2: Name/Instance click no-panel behavior proof
    await expect(page.getByText('Suggested Runbooks Now')).not.toBeVisible()

    // Deselect the selected row through the shared toggle-selection contract.
    const multiSelectModifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await cell0.click({ modifiers: [multiSelectModifier] })
    await expect(rows.nth(0)).not.toHaveClass(/ag-row-selected/)

    const primaryCompareRow = await getWorkspaceLogicalRowByText(page, 'assets', primary.name)
    await selectWorkspaceLogicalRow(primaryCompareRow)
    const secondaryCompareRow = await getWorkspaceLogicalRowByText(page, 'assets', secondary.name)
    await selectWorkspaceLogicalRow(secondaryCompareRow, { additive: true })
    await expectWorkspaceLogicalRowSelected(primaryCompareRow)
    await expectWorkspaceLogicalRowSelected(secondaryCompareRow)

    // Explicit Details button click DOES open details
    await primaryCompareRow.action('More actions').click()
    await viewDetailsButtons.filter({ visible: true }).click()
    await expect(page.getByText('Suggested Runbooks Now')).toBeVisible()

    // Re-goto assets to reset UI state
    await page.goto('/asset')
    await page.getByPlaceholder('Scan asset matrix...').fill(systemName)
    await page.keyboard.press('Enter')
    await expect(page.locator('[role="treegrid"]')).toContainText(primary.name, { timeout: 15_000 })

    // Select the intended assets by row identity, not by viewport order.
    const primaryBulkRow = await getWorkspaceLogicalRowByText(page, 'assets', primary.name)
    await selectWorkspaceLogicalRow(primaryBulkRow)
    const secondaryBulkRow = await getWorkspaceLogicalRowByText(page, 'assets', secondary.name)
    await selectWorkspaceLogicalRow(secondaryBulkRow, { additive: true })
    await expectWorkspaceLogicalRowSelected(primaryBulkRow)
    await expectWorkspaceLogicalRowSelected(secondaryBulkRow)

    // Target B.1: Bulk action expandable inline panel grammar proof
    await bulkActionsButton.click()
    // Destructive confirm buttons must not be stacked outside cards
    await expect(page.getByRole('button', { name: 'Confirm Archive?' })).not.toBeVisible()

    // Expand Archive Selection card
    const archiveCard = page.getByText('Archive Selection')
    await expect(archiveCard).toBeVisible()
    await archiveCard.click()

    // Preview button inside expanded action card; the current golden workflow
    // opens a backend-authoritative preview before any destructive confirmation.
    const archiveActionBtn = page.getByRole('button', { name: 'Preview Archive' })
    await expect(archiveActionBtn).toBeVisible()
    await archiveActionBtn.click()
    const bulkPreviewDialog = page.getByRole('dialog', { name: 'Assets bulk preview' })
    await expect(bulkPreviewDialog).toBeVisible()
    await expect(bulkPreviewDialog.getByRole('button', { name: 'Confirm Archive selection' })).toBeVisible()
    await bulkPreviewDialog.getByRole('button', { name: 'Cancel' }).click()

    // Launch Compare Modal (proves shared Compare modal behavior and Escape dismissal)
    // The two rows are already semantically selected from above, unlocking the Compare action
    await expect(compareVisibleButton).toBeEnabled()

    // Open and verify Compare Modal opens correctly for selected rows
    await compareVisibleButton.click()
    const compareDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Compare Assets' }) })
    await expect(compareDialog.getByText('Temporal Variance Analysis')).toBeVisible()
    await expect(compareDialog.getByText('Show Differences Only')).toBeVisible()
    await expect(compareDialog.getByRole('heading', { name: primary.name, exact: true })).toBeVisible()
    await expect(compareDialog.getByRole('heading', { name: secondary.name, exact: true })).toBeVisible()

    await page.keyboard.press('Escape')

    await page.goto('/asset')
    await fillGridSearch(page, 'Scan asset matrix...', secondary.name)
    await verifyGridRowRobust(page, secondary.name)

    // A. Toolbar / Export / Template Enabled state check when rows exist
    await page.getByTitle('Export asset data').click()
    await expect(page.getByRole('button', { name: /^Export CSV/ })).toBeEnabled()
    await expect(page.getByRole('button', { name: /^Snapshot/ })).toBeEnabled()
    await expect(page.getByRole('button', { name: /^Export Template/ })).toBeEnabled()

    // Capture the client-side CSV download
    const downloadPromise = page.waitForEvent('download')
    await clickResilientButton(page, /^Export CSV/)
    const download = await downloadPromise

    // Verify downloaded filename structure
    expect(download.suggestedFilename()).toContain('SysGrid_Assets_')
    expect(download.suggestedFilename().endsWith('.csv')).toBe(true)

    // Read download content via local file system
    const downloadPath = await download.path()
    const csvContent = fs.readFileSync(downloadPath, 'utf8')
    // Verify column headers exist inside exported CSV (e.g. Instance, System, Type or Status headers)
    expect(csvContent).toContain('Instance')
    expect(csvContent).toContain('System')
    expect(csvContent).toContain('Type')
    expect(csvContent).toContain('Status')
    expect(csvContent).toContain(secondary.name)

    // Settle layouts

    // Target B.5: Import shared modal paste parsing and load to builder proof
    await page.getByRole('button', { name: 'Import asset rows' }).click()
    await expect(page.getByText('Assets Import')).toBeVisible()
    const importDialog = page.getByRole('dialog').filter({ has: page.getByText('Assets Import', { exact: true }) })

    // Switch to Paste tab
    await clickResilientButton(page, 'Paste CSV / Grid')

    // Paste asset spreadsheet data
    const pasteArea = page.getByPlaceholder('Paste CSV with headers, or paste spreadsheet cells directly...')
    await expect(pasteArea).toBeVisible()
    await pasteArea.fill(`name,system,type,status,model\nPW-IMPORTED-ASSET-01,${systemName},Physical,Active,R740`)

    // Click "Load Into Builder" to process spreadsheet parsing
    await clickResilientButton(page, 'Load Into Builder')

    // Verify parser parsed cells and transitioned to builder layout
    await expect(page.getByText('Manual Data Builder')).toBeVisible()
    await expect(page.locator('tbody tr input').first()).toHaveValue('PW-IMPORTED-ASSET-01')

    // Close import modal cleanly (handling dirty state guard)
    await importDialog.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: 'Close' }).click()
    const importDirtyGuard = page.getByRole('alertdialog', { name: 'Unsaved Changes' })
    await expect(importDirtyGuard).toBeVisible({ timeout: 15_000 })
    await expect(importDirtyGuard).toHaveAccessibleDescription('You have unsaved changes. Close this window and discard them?')
    await importDirtyGuard.getByRole('button', { name: 'Discard Changes', exact: true }).click()
    await expect(page.getByText('Assets Import')).not.toBeVisible()

    // Settle layout before action click

    // E2E Verification of Soft-Delete and Scope-Switch lifecycle by semantic row identity.
    const secondaryLifecycleRow = await getWorkspaceLogicalRowByText(page, 'assets', secondary.name)
    await secondaryLifecycleRow.action('More actions').click()
    const archiveRowAction = page.getByRole('button', { name: 'Archive', exact: true })
    await archiveRowAction.click()

    const deletePreviewResponsePromise = page.waitForResponse(response =>
      response.url().includes('/api/v1/devices/bulk-action') && response.status() === 200
    )
    const confirmArchiveAction = page.getByRole('button', { name: 'Confirm Archive?', exact: true })
    await confirmArchiveAction.click()
    await deletePreviewResponsePromise
    const deletePreviewDialog = page.getByRole('dialog', { name: 'Assets bulk preview' })
    await expect(deletePreviewDialog).toBeVisible()
    const deleteRequestPromise = page.waitForRequest(request => {
      if (!request.url().includes('/api/v1/devices/bulk-action')) return false
      const body = request.postDataJSON() as { dry_run?: boolean } | null
      return body?.dry_run !== true
    })
    const deleteResponsePromise = page.waitForResponse(response =>
      response.url().includes('/api/v1/devices/bulk-action') && response.status() === 200
    )
    await deletePreviewDialog.getByRole('button', { name: 'Confirm Archive selection' }).click()
    const deleteRequest = await deleteRequestPromise
    await deleteResponsePromise
    expect(deleteRequest.postDataJSON()).toMatchObject({ ids: [secondary.id], action: 'delete' })
    await page.getByRole('dialog', { name: 'Assets bulk complete' }).getByRole('button', { name: 'Close bulk receipt' }).click()

    // Restore the broader system scope before selecting a different asset.
    await fillGridSearch(page, 'Scan asset matrix...', systemName)
    await expect(page.locator('[role="treegrid"]')).toContainText(primary.name, { timeout: 15_000 })

    // Change selection to another asset: Revert remains bound to the captured operation, not selection.
    const primaryLifecycleRow = await getWorkspaceLogicalRowByText(page, 'assets', primary.name)
    await selectWorkspaceLogicalRow(primaryLifecycleRow)
    await expectWorkspaceLogicalRowSelected(primaryLifecycleRow)

    const revertAction = getWorkspaceRoot(page, 'assets').getByRole('button', { name: 'Revert last completed asset lifecycle operation' })
    await expect(revertAction).toBeVisible()
    await expect(revertAction).toBeEnabled()
    await revertAction.click()
    const revertConfirm = page.getByRole('dialog').filter({ has: page.getByText('Revert asset operation', { exact: true }) })
    await expect(revertConfirm).toBeVisible()
    await expect(revertConfirm).toContainText('completed archive operation')
    const restoreRequestPromise = page.waitForRequest(request => request.url().includes('/api/v1/devices/bulk-action'))
    const restoreResponsePromise = page.waitForResponse(response =>
      response.url().includes('/api/v1/devices/bulk-action') && response.status() === 200
    )
    await revertConfirm.getByRole('button', { name: 'Confirm Action', exact: true }).click()
    const restoreRequest = await restoreRequestPromise
    await restoreResponsePromise
    expect(restoreRequest.postDataJSON()).toMatchObject({ ids: [secondary.id], action: 'restore' })
    await expect((await getWorkspaceLogicalRowByText(page, 'assets', secondary.name)).center!).toBeVisible()
    const refreshedPrimaryLifecycleRow = await getWorkspaceLogicalRowByText(page, 'assets', primary.name)
    await expectWorkspaceLogicalRowSelected(refreshedPrimaryLifecycleRow)

    // Archive again so the existing purged-scope proof continues with the same row identity.
    await (await getWorkspaceLogicalRowByText(page, 'assets', secondary.name)).action('More actions').click()
    await clickResilientButton(page, /^Archive$/)
    const secondDeletePreviewResponsePromise = page.waitForResponse(response =>
      response.url().includes('/api/v1/devices/bulk-action') && response.status() === 200
    )
    await clickResilientButton(page, /^Confirm Archive\?$/)
    await secondDeletePreviewResponsePromise
    const secondDeletePreviewDialog = page.getByRole('dialog', { name: 'Assets bulk preview' })
    const secondDeleteResponsePromise = page.waitForResponse(response =>
      response.url().includes('/api/v1/devices/bulk-action') && response.status() === 200
    )
    await secondDeletePreviewDialog.getByRole('button', { name: 'Confirm Archive selection' }).click()
    const secondArchiveResponse = await secondDeleteResponsePromise
    const secondArchiveReceipt = await secondArchiveResponse.json()
    expect(secondArchiveReceipt.changed_ids).toEqual([secondary.id])
    await page.getByRole('dialog', { name: 'Assets bulk complete' }).getByRole('button', { name: 'Close bulk receipt' }).click()

    const recoveryBeforePurge = getWorkspaceRoot(page, 'assets').getByRole('button', { name: 'Revert last completed asset lifecycle operation' })
    await expect(recoveryBeforePurge).toBeVisible()
    await recoveryBeforePurge.click()
    const recoveryBeforePurgeDialog = page.getByRole('dialog').filter({ has: page.getByText('Revert asset operation', { exact: true }) })
    await expect(recoveryBeforePurgeDialog).toContainText(`completed archive operation for ${secondary.name}?`)
    const recoveryBeforePurgeConfirmation = await recoveryBeforePurgeDialog.innerText()
    await recoveryBeforePurgeDialog.getByRole('button', { name: 'Close', exact: true }).click()

    // Settle React state before tab switch

    // Switch to Archived Tab and verify row is present in the reversible archive scope.
    await openToolbarButton(page, /Archived/)
    await fillGridSearch(page, 'Scan asset matrix...', secondary.name)
    await verifyGridRowRobust(page, secondary.name)

    // Target B.3: Archived scope suppression proof
    const purgedRowActions = page.getByTitle('More actions').filter({ visible: true }).first()
    await purgedRowActions.click()
    // Assert active-only actions are completely suppressed/not visible in the row menu
    await expect(page.getByRole('button', { name: 'Pin' })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Unpin' })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Watch' })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Unwatch' })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit Configuration' })).not.toBeVisible()
    await page.keyboard.press('Escape') // Dismiss row action menu

    // Settle layout before action click

    // Perform permanent Purge lifecycle path on the archived row.
    await page.setViewportSize({ width: 1440, height: 900 })
    const purgeActionBtn = page.getByTitle('More actions').filter({ visible: true })
    await purgeActionBtn.waitFor({ state: 'visible' })
    await purgeActionBtn.click()
    const purgeRowAction = page.getByRole('button', { name: 'Purge', exact: true })
    await purgeRowAction.click()

    const purgePreviewResponsePromise = page.waitForResponse(response =>
      response.url().includes('/api/v1/devices/bulk-action') && response.status() === 200
    )
    const confirmPurgeAction = page.getByRole('button', { name: 'Confirm Purge?', exact: true })
    await confirmPurgeAction.click()
    const purgePreviewResponse = await purgePreviewResponsePromise
    const purgePreviewDialog = page.getByRole('dialog', { name: 'Assets bulk preview' })
    const purgePreviewBody = await purgePreviewResponse.json()
    const archivedScopeLabel = await page.getByRole('button', { name: /Archived/ }).first().innerText()
    expect(archivedScopeLabel).toMatch(/^Archived\b/)
    expect(purgePreviewBody.purge_impact.aggregate.deletes).toContainEqual(expect.objectContaining({ table: 'hardware_components', count: 1 }))
    await expect(purgePreviewDialog.getByText('Permanent removal', { exact: true })).toBeVisible()
    await expect(purgePreviewDialog.getByText('This purge cannot be restored or reverted.')).toBeVisible()
    await expect(purgePreviewDialog.getByText('Records deleted', { exact: true })).toBeVisible()
    await expect(purgePreviewDialog.getByText('Hardware components', { exact: true })).toBeVisible()
    await expect(purgePreviewDialog.getByRole('button', { name: 'Confirm Purge selection' })).toBeEnabled()
    const previewMetadata = {
      route: '/asset',
      profile: process.env.SYSGRID_VERIFY_PROFILE || 'normal-v1',
      viewport: { width: 1440, height: 900 },
      scrollY: await page.evaluate(() => window.scrollY),
      archivedScopeLabel,
      readiness: 'Assets purge preview settled; backend response and rendered dependency impact agree.',
      purgeImpact: purgePreviewBody.purge_impact,
    }
    await expect(page.getByRole('button', { name: 'Revert', exact: true })).toHaveCount(0)
    await attachEvidence(testInfo, 'asset-purge-preview-1440x900.json', JSON.stringify(previewMetadata, null, 2), 'application/json')
    await attachEvidence(testInfo, 'asset-purge-preview-1440x900.png', await page.screenshot(), 'image/png')

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(purgePreviewDialog.getByText('This purge cannot be restored or reverted.')).toBeVisible()
    await expect(purgePreviewDialog.getByText('Hardware components', { exact: true })).toBeVisible()
    await expect(purgePreviewDialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
    const mobileConfirm = purgePreviewDialog.getByRole('button', { name: 'Confirm Purge selection' })
    await expect(mobileConfirm).toBeVisible()
    const mobileConfirmBox = await mobileConfirm.boundingBox()
    expect(mobileConfirmBox).not.toBeNull()
    expect(mobileConfirmBox!.x).toBeGreaterThanOrEqual(0)
    expect(mobileConfirmBox!.y).toBeGreaterThanOrEqual(0)
    expect(mobileConfirmBox!.x + mobileConfirmBox!.width).toBeLessThanOrEqual(390)
    expect(mobileConfirmBox!.y + mobileConfirmBox!.height).toBeLessThanOrEqual(844)
    await attachEvidence(
      testInfo,
      'asset-purge-preview-390x844.json',
      JSON.stringify({ ...previewMetadata, viewport: { width: 390, height: 844 }, scrollY: await page.evaluate(() => window.scrollY) }, null, 2),
      'application/json',
    )
    await attachEvidence(testInfo, 'asset-purge-preview-390x844.png', await page.screenshot(), 'image/png')

    const purgeResponsePromise = page.waitForResponse(response =>
      response.url().includes('/api/v1/devices/bulk-action') && response.status() === 200
    )
    await mobileConfirm.click()
    const purgeResponse = await purgeResponsePromise
    const purgeReceipt = await purgeResponse.json()
    expect(purgeReceipt.changed_ids).toEqual([secondary.id])
    expect(purgeReceipt.purge_impact_applied).toEqual(purgeReceipt.purge_impact)
    const purgeReceiptDialog = page.getByRole('dialog', { name: 'Assets bulk complete' })
    await expect(purgeReceiptDialog.getByTestId('operational-purge-impact')).toBeVisible()
    await expect(purgeReceiptDialog.getByText('This purge cannot be restored or reverted.')).toBeVisible()
    await expect(purgeReceiptDialog.getByRole('button', { name: 'Undo bulk changes' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Revert', exact: true })).toHaveCount(0)
    await attachEvidence(testInfo, 'asset-purge-receipt-390x844.json', JSON.stringify({
        route: '/asset',
        profile: process.env.SYSGRID_VERIFY_PROFILE || 'normal-v1',
        viewport: { width: 390, height: 844 },
        scrollY: await page.evaluate(() => window.scrollY),
        readiness: 'Permanent purge receipt settled; actual impact came from the execution response; generic undo is absent.',
        receipt: purgeReceipt,
      }, null, 2), 'application/json')
    await attachEvidence(testInfo, 'asset-purge-receipt-390x844.png', await page.screenshot(), 'image/png')
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(purgeReceiptDialog.getByTestId('operational-purge-impact')).toBeVisible()
    await expect(purgeReceiptDialog.getByRole('button', { name: 'Undo bulk changes' })).toHaveCount(0)
    await attachEvidence(testInfo, 'asset-purge-receipt-1440x900.json', JSON.stringify({
        route: '/asset',
        profile: process.env.SYSGRID_VERIFY_PROFILE || 'normal-v1',
        viewport: { width: 1440, height: 900 },
        scrollY: await page.evaluate(() => window.scrollY),
        readiness: 'Permanent purge receipt settled; execution impact is shown and generic undo is absent.',
        receipt: purgeReceipt,
      }, null, 2), 'application/json')
    await attachEvidence(testInfo, 'asset-purge-receipt-1440x900.png', await page.screenshot(), 'image/png')
    await purgeReceiptDialog.getByRole('button', { name: 'Close bulk receipt' }).click()

    const purgedDeviceAfterReceipt = await getDeviceFromBackend(request, secondary.id)
    expect(purgedDeviceAfterReceipt).toBeUndefined()
    await expect(getWorkspaceRoot(page, 'assets').getByRole('button', { name: 'Revert last completed asset lifecycle operation' })).toHaveCount(0)
    const archivedScopeAfterPurge = await page.getByRole('button', { name: /Archived/ }).first().innerText()
    expect(archivedScopeAfterPurge).toMatch(/^Archived\b/)
    const desktopClosedReceiptMetrics = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }))
    expect(desktopClosedReceiptMetrics.documentWidth).toBeLessThanOrEqual(1440)
    await attachEvidence(testInfo, 'asset-purge-closed-desktop-1440x900.json', JSON.stringify({
      route: '/asset',
      profile: process.env.SYSGRID_VERIFY_PROFILE || 'normal-v1',
      viewport: { width: 1440, height: 900 },
      target: { id: secondary.id, name: secondary.name },
      priorRecovery: { ids: secondArchiveReceipt.changed_ids, labels: [secondary.name], confirmationText: recoveryBeforePurgeConfirmation },
      purgeChangedIds: purgeReceipt.changed_ids,
      receiptUndoVisible: false,
      receiptRevertVisible: false,
      archivedScope: archivedScopeAfterPurge,
      receiptVocabulary: 'This purge cannot be restored or reverted.',
      persistentRevertVisible: false,
      backendDevicePresent: false,
      documentWidth: desktopClosedReceiptMetrics.documentWidth,
      bodyWidth: desktopClosedReceiptMetrics.bodyWidth,
    }, null, 2), 'application/json')
    await attachEvidence(testInfo, 'asset-purge-closed-desktop-1440x900.png', await page.screenshot(), 'image/png')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Collapse application navigation' }).click()
    const applicationSidebar = page.locator('[data-sg-app-sidebar]')
    await expect.poll(async () => (await applicationSidebar.boundingBox())?.width ?? Infinity).toBeLessThanOrEqual(80)
    await expect(getWorkspaceRoot(page, 'assets').getByRole('button', { name: 'Revert last completed asset lifecycle operation' })).toHaveCount(0)
    const mobileArchivedScope = page.getByRole('button', { name: /Archived/ }).first()
    await expect(mobileArchivedScope).toBeVisible()
    await mobileArchivedScope.scrollIntoViewIfNeeded()
    const mobileArchivedScopeBox = await mobileArchivedScope.boundingBox()
    expect(mobileArchivedScopeBox).not.toBeNull()
    expect(mobileArchivedScopeBox!.x).toBeGreaterThanOrEqual(0)
    expect(mobileArchivedScopeBox!.x + mobileArchivedScopeBox!.width).toBeLessThanOrEqual(390)
    const mobileClosedReceiptMetrics = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }))
    expect(mobileClosedReceiptMetrics.documentWidth).toBeLessThanOrEqual(390)
    await attachEvidence(testInfo, 'asset-purge-closed-mobile-390x844.json', JSON.stringify({
      route: '/asset',
      profile: process.env.SYSGRID_VERIFY_PROFILE || 'normal-v1',
      viewport: { width: 390, height: 844 },
      target: { id: secondary.id, name: secondary.name },
      priorRecovery: { ids: secondArchiveReceipt.changed_ids, labels: [secondary.name], confirmationText: recoveryBeforePurgeConfirmation },
      purgeChangedIds: purgeReceipt.changed_ids,
      receiptUndoVisible: false,
      receiptRevertVisible: false,
      archivedScope: archivedScopeAfterPurge,
      receiptVocabulary: 'This purge cannot be restored or reverted.',
      persistentRevertVisible: false,
      backendDevicePresent: false,
      archivedScopeWithinViewport: true,
      documentWidth: mobileClosedReceiptMetrics.documentWidth,
      bodyWidth: mobileClosedReceiptMetrics.bodyWidth,
    }, null, 2), 'application/json')
    await attachEvidence(testInfo, 'asset-purge-closed-mobile-390x844.png', await page.screenshot(), 'image/png')

    // Verify row has disappeared completely from Archived scope by reloading the page
    await page.goto('/asset')
    await openToolbarButton(page, /Archived/)
    await fillGridSearch(page, 'Scan asset matrix...', secondary.name)
    await expect(page.getByText('No assets match the current working view')).toBeVisible()
    await expect(getWorkspaceRoot(page, 'assets').getByRole('treegrid').getByText(secondary.name, { exact: true })).not.toBeVisible()

    // Verify row has not returned to Existing scope either on clean reload
    await openToolbarButton(page, /Existing/)
    await fillGridSearch(page, 'Scan asset matrix...', secondary.name)
    await expect(page.getByText('No assets match the current working view')).toBeVisible()
    await expect(getWorkspaceRoot(page, 'assets').getByRole('treegrid').getByText(secondary.name, { exact: true })).not.toBeVisible()

    // B. Toolbar / Export / Template Disabled state check when the registry is empty or filtered-empty
    await page.getByTitle('Export asset data').click()
    await expect(page.getByRole('button', { name: /^Export CSV/ })).toBeDisabled()
    await expect(page.getByRole('button', { name: /^Snapshot/ })).toBeDisabled()
    await expect(page.getByRole('button', { name: /^Export Template/ })).toBeEnabled()
    // Dismiss export flyout by clicking outside
    await page.mouse.click(10, 10)

    // Open and close import modal cleanly
    await page.getByRole('button', { name: 'Import asset rows' }).click()
    await expect(page.getByText('Assets Import')).toBeVisible()
    await importDialog.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: 'Close' }).click()
    await expect(page.getByText('Assets Import')).not.toBeVisible()

    await page.goto(`/monitoring?id=${monitoring.id}`)
    await expect(page).toHaveURL(new RegExp(`/monitoring\\?id=${monitoring.id}$`))
    await expect(page.getByRole('heading', { name: 'Monitoring' })).toBeVisible()
    await expect(page.getByRole('heading', { name: monitoring.title, exact: true }).first()).toBeVisible()
  })

  test('preserves unrelated recovery and filters only purged IDs from partial recovery', async ({ page, sysApi: request }, testInfo) => {
    test.setTimeout(180_000)
    await resetBrowserState(page)
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const unrelatedSystem = `PW-RECOVERY-UNRELATED-${stamp}`
    const partialSystem = `PW-RECOVERY-PARTIAL-${stamp}`
    const unrelatedA = await createRecoveryAsset(request, `PW-RECOVERY-A-${stamp}`, unrelatedSystem)
    const unrelatedB = await createRecoveryAsset(request, `PW-RECOVERY-B-${stamp}`, unrelatedSystem)
    const partialA = await createRecoveryAsset(request, `PW-RECOVERY-C-${stamp}`, partialSystem)
    const partialB = await createRecoveryAsset(request, `PW-RECOVERY-D-${stamp}`, partialSystem)

    const archiveUnrelatedBResponse = await request.post(`${apiBase}/devices/bulk-action`, {
      data: { ids: [unrelatedB.id], action: 'delete' },
    })
    expect(archiveUnrelatedBResponse.ok()).toBeTruthy()
    expect((await archiveUnrelatedBResponse.json()).changed_ids).toEqual([unrelatedB.id])

    await page.goto('/asset')
    await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible()
    const archiveAResult = await runAssetRowLifecycleAction(page, 'delete', unrelatedA.name)
    expect(archiveAResult.executionResponse.ok()).toBeTruthy()
    await page.getByRole('dialog', { name: 'Assets bulk complete' }).getByRole('button', { name: 'Close bulk receipt' }).click()

    const purgeBResult = await runAssetRowLifecycleAction(page, 'purge', unrelatedB.name)
    expect(purgeBResult.executionResponse.ok()).toBeTruthy()
    expect(purgeBResult.receipt.changed_ids).toEqual([unrelatedB.id])
    await page.getByRole('dialog', { name: 'Assets bulk complete' }).getByRole('button', { name: 'Close bulk receipt' }).click()

    const unrelatedRevert = getWorkspaceRoot(page, 'assets').getByRole('button', { name: 'Revert last completed asset lifecycle operation' })
    await expect(unrelatedRevert).toBeVisible()
    await unrelatedRevert.click()
    const unrelatedConfirm = page.getByRole('dialog').filter({ has: page.getByText('Revert asset operation', { exact: true }) })
    await expect(unrelatedConfirm).toContainText(`for ${unrelatedA.name}?`)
    await expect(unrelatedConfirm).not.toContainText(unrelatedB.name)
    await attachEvidence(testInfo, 'asset-unrelated-recovery-control.json', JSON.stringify({
      scenario: 'purge B while A remains the tracked recovery',
      purgeChangedIds: purgeBResult.receipt.changed_ids,
      visibleControl: 'Revert last completed asset lifecycle operation',
      confirmationText: await unrelatedConfirm.innerText(),
      operationIdsBoundToA: [unrelatedA.id],
      operationLabelsBoundToA: [unrelatedA.name],
      purgedIds: [unrelatedB.id],
      unrelatedRecoveryVisible: true,
    }, null, 2), 'application/json')
    await attachEvidence(testInfo, 'asset-unrelated-recovery-control.png', await page.screenshot(), 'image/png')
    const restoreAResponsePromise = page.waitForResponse(response => (
      isBulkExecutionResponse(response)
      && response.request().postDataJSON().action === 'restore'
    ))
    const restoreARequestPromise = page.waitForRequest(request => (
      request.url().includes('/api/v1/devices/bulk-action')
      && request.postDataJSON()?.action === 'restore'
    ))
    await unrelatedConfirm.getByRole('button', { name: 'Confirm Action', exact: true }).click()
    const restoreARequest = await restoreARequestPromise
    const restoreAResponse = await restoreAResponsePromise
    expect(restoreARequest.postDataJSON()).toMatchObject({ action: 'restore', ids: [unrelatedA.id] })
    expect(restoreAResponse.ok()).toBeTruthy()
    expect((await getDeviceFromBackend(request, unrelatedA.id)).is_deleted).toBe(false)
    expect(await getDeviceFromBackend(request, unrelatedB.id)).toBeUndefined()

    const partialArchive = await archiveSelectedAssets(page, [partialA.name, partialB.name], partialSystem)
    expect(partialArchive.receipt.changed_ids).toEqual(expect.arrayContaining([partialA.id, partialB.id]))
    await page.getByRole('dialog', { name: 'Assets bulk complete' }).getByRole('button', { name: 'Close bulk receipt' }).click()

    const partialPurge = await runAssetRowLifecycleAction(page, 'purge', partialB.name)
    expect(partialPurge.executionResponse.ok()).toBeTruthy()
    expect(partialPurge.receipt.changed_ids).toEqual([partialB.id])
    await page.getByRole('dialog', { name: 'Assets bulk complete' }).getByRole('button', { name: 'Close bulk receipt' }).click()

    const partialRevert = getWorkspaceRoot(page, 'assets').getByRole('button', { name: 'Revert last completed asset lifecycle operation' })
    await expect(partialRevert).toBeVisible()
    await partialRevert.click()
    const partialConfirm = page.getByRole('dialog').filter({ has: page.getByText('Revert asset operation', { exact: true }) })
    await expect(partialConfirm).toContainText(`for ${partialA.name}?`)
    await expect(partialConfirm).not.toContainText(partialB.name)
    const partialConfirmationText = await partialConfirm.innerText()
    const restorePartialResponsePromise = page.waitForResponse(response => (
      isBulkExecutionResponse(response)
      && response.request().postDataJSON().action === 'restore'
    ))
    const restorePartialRequestPromise = page.waitForRequest(request => (
      request.url().includes('/api/v1/devices/bulk-action')
      && request.postDataJSON()?.action === 'restore'
    ))
    await partialConfirm.getByRole('button', { name: 'Confirm Action', exact: true }).click()
    const restorePartialRequest = await restorePartialRequestPromise
    const restorePartialResponse = await restorePartialResponsePromise
    expect(restorePartialRequest.postDataJSON()).toMatchObject({ action: 'restore', ids: [partialA.id] })
    expect(restorePartialResponse.ok()).toBeTruthy()
    expect((await getDeviceFromBackend(request, partialA.id)).is_deleted).toBe(false)
    expect(await getDeviceFromBackend(request, partialB.id)).toBeUndefined()
    await attachEvidence(testInfo, 'asset-partial-recovery-result.json', JSON.stringify({
      scenario: 'archive A+B, purge only B, then revert A only',
      archiveChangedIds: partialArchive.receipt.changed_ids,
      purgeChangedIds: partialPurge.receipt.changed_ids,
      visibleConfirmationText: partialConfirmationText,
      operationIdsAfterPurge: [partialA.id],
      operationLabelsAfterPurge: [partialA.name],
      restoreRequest: restorePartialRequest.postDataJSON(),
      assetADeletedAfterRestore: (await getDeviceFromBackend(request, partialA.id)).is_deleted,
      assetBPhysicallyPresent: await getDeviceFromBackend(request, partialB.id) !== undefined,
    }, null, 2), 'application/json')
  })

  test('preserves recovery after a mixed existing/missing-ID purge is rejected with 409', async ({ page, sysApi: request }, testInfo) => {
    test.setTimeout(120_000)
    await resetBrowserState(page)
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const target = await createRecoveryAsset(request, `PW-RECOVERY-BLOCKED-${stamp}`, `PW-RECOVERY-BLOCKED-SYS-${stamp}`)

    await page.goto('/asset')
    await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible()
    const archiveResult = await runAssetRowLifecycleAction(page, 'delete', target.name)
    expect(archiveResult.executionResponse.ok()).toBeTruthy()
    await page.getByRole('dialog', { name: 'Assets bulk complete' }).getByRole('button', { name: 'Close bulk receipt' }).click()

    const missingId = 2_000_000_000
    const purgePreviewResponse = await request.post(`${apiBase}/devices/bulk-action`, {
      data: { ids: [target.id, missingId], action: 'purge', dry_run: true },
    })
    expect(purgePreviewResponse.ok()).toBeTruthy()
    const purgePreview = await purgePreviewResponse.json()
    expect(purgePreview.can_execute).toBe(false)
    expect(purgePreview.missing_ids).toContain(missingId)
    const failedPurgeResponse = await request.post(`${apiBase}/devices/bulk-action`, {
      data: { ids: [target.id, missingId], action: 'purge' },
    })
    expect(failedPurgeResponse.status()).toBe(409)
    const failedPurgeBody = await failedPurgeResponse.json()

    const recoveryControl = getWorkspaceRoot(page, 'assets').getByRole('button', { name: 'Revert last completed asset lifecycle operation' })
    await expect(recoveryControl).toBeVisible()
    await recoveryControl.click()
    const revertConfirm = page.getByRole('dialog').filter({ has: page.getByText('Revert asset operation', { exact: true }) })
    await expect(revertConfirm).toContainText(`for ${target.name}?`)
    const restoreResponsePromise = page.waitForResponse(response => (
      isBulkExecutionResponse(response)
      && response.request().postDataJSON().action === 'restore'
    ))
    const restoreRequestPromise = page.waitForRequest(request => (
      request.url().includes('/api/v1/devices/bulk-action')
      && request.postDataJSON()?.action === 'restore'
    ))
    await revertConfirm.getByRole('button', { name: 'Confirm Action', exact: true }).click()
    const restoreRequest = await restoreRequestPromise
    const restoreResponse = await restoreResponsePromise
    expect(restoreRequest.postDataJSON()).toMatchObject({ action: 'restore', ids: [target.id] })
    expect(restoreResponse.ok()).toBeTruthy()
    expect((await getDeviceFromBackend(request, target.id)).is_deleted).toBe(false)
    await attachEvidence(testInfo, 'asset-blocked-purge-preserved-recovery.json', JSON.stringify({
      scenario: 'mixed existing/missing-ID purge failed with 409',
      target: { id: target.id, name: target.name },
      archiveChangedIds: archiveResult.receipt.changed_ids,
      purgePreviewCanExecute: purgePreview.can_execute,
      purgePreviewMissingIds: purgePreview.missing_ids,
      failedPurgeRequest: { action: 'purge', ids: [target.id, missingId] },
      failedPurgeStatus: failedPurgeResponse.status(),
      failedPurgeDetail: failedPurgeBody,
      recoveryVisibleAfterFailure: true,
      restoreRequest: restoreRequest.postDataJSON(),
      deviceRestored: true,
    }, null, 2), 'application/json')
  })

  test('proves a pending purge serializes later Asset lifecycle execution', async ({ page, sysApi: request }, testInfo) => {
    test.setTimeout(120_000)
    await resetBrowserState(page)
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const system = `PW-RECOVERY-GENERATION-${stamp}`
    const purgeTarget = await createRecoveryAsset(request, `PW-RECOVERY-PURGE-P1-${stamp}`, system)
    const newerRecoveryTarget = await createRecoveryAsset(request, `PW-RECOVERY-NEWER-${stamp}`, system)

    await page.goto('/asset')
    await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible()
    const archiveP1 = await runAssetRowLifecycleAction(page, 'delete', purgeTarget.name)
    expect(archiveP1.executionResponse.ok()).toBeTruthy()
    await page.getByRole('dialog', { name: 'Assets bulk complete' }).getByRole('button', { name: 'Close bulk receipt' }).click()

    let releasePurgeRequest = () => undefined
    let signalPurgeIntercepted = () => undefined
    const purgeHold = new Promise<void>(resolve => { releasePurgeRequest = resolve })
    const purgeIntercepted = new Promise<void>(resolve => { signalPurgeIntercepted = resolve })
    await page.route('**/api/v1/devices/bulk-action', async route => {
      const body = route.request().postDataJSON() as { action?: string; dry_run?: boolean } | null
      if (body?.action === 'purge' && body.dry_run !== true) {
        signalPurgeIntercepted()
        await purgeHold
      }
      await route.continue()
    })

    try {
      await openToolbarButton(page, /^Archived/)
      await fillGridSearch(page, 'Scan asset matrix...', purgeTarget.name)
      const purgeRow = await getWorkspaceLogicalRowByText(page, 'assets', purgeTarget.name)
      await purgeRow.action('More actions').click()
      await page.getByRole('button', { name: 'Purge', exact: true }).click()
      const previewResponsePromise = page.waitForResponse(response => (
        response.url().includes('/api/v1/devices/bulk-action')
        && response.request().method() === 'POST'
        && response.status() === 200
        && (response.request().postDataJSON() as { dry_run?: boolean } | null)?.dry_run === true
      ))
      await page.getByRole('button', { name: 'Confirm Purge?', exact: true }).click()
      const purgePreview = await (await previewResponsePromise).json()
      expect(purgePreview.can_execute).toBe(true)
      const purgeDialog = page.getByRole('dialog', { name: 'Assets bulk preview' })
      const purgeExecutionResponsePromise = page.waitForResponse(isBulkExecutionResponse)
      await purgeDialog.getByRole('button', { name: 'Confirm Purge selection' }).click()
      await purgeIntercepted

      // The receipt preview can close during an in-flight request, but the workspace mutation stays pending.
      await page.keyboard.press('Escape')
      await expect(purgeDialog).not.toBeVisible()
      await openToolbarButton(page, /^Existing/)
      await fillGridSearch(page, 'Scan asset matrix...', newerRecoveryTarget.name)
      const newerRow = await getWorkspaceLogicalRowByText(page, 'assets', newerRecoveryTarget.name)
      await newerRow.action('More actions').click()
      await page.getByRole('button', { name: 'Archive', exact: true }).click()
      const newerPreviewResponsePromise = page.waitForResponse(response => (
        response.url().includes('/api/v1/devices/bulk-action')
        && response.request().method() === 'POST'
        && response.status() === 200
        && (response.request().postDataJSON() as { dry_run?: boolean } | null)?.dry_run === true
      ))
      await page.getByRole('button', { name: 'Confirm Archive?', exact: true }).click()
      const newerPreview = await (await newerPreviewResponsePromise).json()
      expect(newerPreview.can_execute).toBe(true)
      const newerPreviewDialog = page.getByRole('dialog', { name: 'Assets bulk preview' })
      const newerConfirm = newerPreviewDialog.getByRole('button', { name: 'Confirm Archive selection' })
      await expect(newerConfirm).toBeDisabled()
      await expect(newerConfirm).toHaveText('Applying…')
      await attachEvidence(testInfo, 'asset-pending-purge-serialization.json', JSON.stringify({
        scenario: 'P1 purge execution is pending while the user opens a later Archive preview',
        p1PurgeIds: [purgeTarget.id],
        laterArchiveIds: [newerRecoveryTarget.id],
        laterPreviewCanExecute: newerPreview.can_execute,
        laterArchiveConfirmDisabled: await newerConfirm.isDisabled(),
        laterArchiveConfirmText: await newerConfirm.innerText(),
        newerLifecycleExecutionStarted: false,
      }, null, 2), 'application/json')
      await attachEvidence(testInfo, 'asset-pending-purge-serialization.png', await page.screenshot(), 'image/png')
      await page.keyboard.press('Escape')
      await expect(newerPreviewDialog).not.toBeVisible()

      releasePurgeRequest()
      const purgeExecutionResponse = await purgeExecutionResponsePromise
      expect(purgeExecutionResponse.ok()).toBeTruthy()
      const purgeReceipt = await purgeExecutionResponse.json()
      expect(purgeReceipt.changed_ids).toEqual([purgeTarget.id])
      await expect(getWorkspaceRoot(page, 'assets').getByRole('button', { name: 'Revert last completed asset lifecycle operation' })).toHaveCount(0)
      expect(await getDeviceFromBackend(request, purgeTarget.id)).toBeUndefined()
      expect((await getDeviceFromBackend(request, newerRecoveryTarget.id)).is_deleted).toBe(false)
      await attachEvidence(testInfo, 'asset-pending-purge-serialization-result.json', JSON.stringify({
        scenario: 'the UI prevents a newer lifecycle execution until P1 settles',
        p1PurgeIds: purgeReceipt.changed_ids,
        laterArchiveIds: [newerRecoveryTarget.id],
        laterArchiveExecutionStarted: false,
        laterArchiveConfirmDisabled: true,
        p1SettledSuccessfully: true,
        purgeTargetPhysicallyAbsent: true,
        newerRecoveryCreated: false,
      }, null, 2), 'application/json')
    } finally {
      releasePurgeRequest()
      if (!page.isClosed()) await page.unroute('**/api/v1/devices/bulk-action')
    }
  })
})
