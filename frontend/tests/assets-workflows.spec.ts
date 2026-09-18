import { clickResilientButton, fillGridSearch, getWorkspaceLogicalRowByText, getWorkspaceRoot, openToolbarButton, resetBrowserState, seedOperationalScenario, verifyGridRowRobust } from './helpers/sysgrid';
import { expect } from '@playwright/test';
import { test } from './helpers/sysgrid-test';
import fs from 'fs';

test.describe('Assets workflows', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('simulates the changed Assets workflows end-to-end', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const { stamp, systemName, primary, secondary, tertiary, monitoring, far } = await seedOperationalScenario(request)

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
    const toggleIntelligenceButton = page.getByRole('button', { name: 'Toggle Intelligence' })
    await expect(toggleIntelligenceButton).not.toHaveClass(/text-blue-400/)
    await toggleIntelligenceButton.click()
    await expect(toggleIntelligenceButton).toHaveClass(/text-blue-400/)

    // Toggle Pin/Watch while columns are visible
    const pinBtn = page.getByTitle('Pin asset').first()
    await expect(pinBtn).toBeVisible()
    await pinBtn.click()
    const unpinBtn = page.getByTitle('Unpin asset').first()
    await expect(unpinBtn).toBeVisible()
    await unpinBtn.click()

    // Toggle back to collapsed state
    await toggleIntelligenceButton.click()
    await expect(toggleIntelligenceButton).not.toHaveClass(/text-blue-400/)

    const assetRowActions = page.getByTitle('More actions')
    const viewDetailsButtons = page.getByRole('button', { name: 'View Details', exact: true })
    const openKnowledgeButton = page.getByRole('button', { name: 'Open Knowledge', exact: true })
    const farRisksButton = page.getByRole('button', { name: 'FAR Risks', exact: true })
    const auditButton = page.getByRole('button', { name: 'Audit', exact: true })
    const bulkActionsButton = page.getByRole('button', { name: /Bulk Actions/i })
    const compareVisibleButton = page.getByRole('button', { name: 'Compare', exact: true })

    const primaryDetailsRow = await getWorkspaceLogicalRowByText(page, 'assets', primary.name)
    await primaryDetailsRow.action('More actions').click()
    await viewDetailsButtons.filter({ visible: true }).click()
    await expect(page.getByText(primary.name).first()).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('Suggested Runbooks Now')).toBeVisible()
    await expect(farRisksButton).toBeVisible()
    await expect(farRisksButton).toBeEnabled()
    await expect(auditButton).toBeVisible()
    await expect(page.getByText(`PW-MON-${stamp}`)).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(`PW-RUNBOOK-${stamp}`, 'i') }).first()).toBeVisible()
    await expect(page.getByText(`PW-MAINT-${stamp}`)).toBeVisible()
    await openKnowledgeButton.click()
    await expect(page).toHaveURL(new RegExp(`/knowledge\\?device_id=${primary.id}`))

    await page.goto('/asset')
    await page.getByPlaceholder('Scan asset matrix...').fill(primary.name)
    await page.keyboard.press('Enter')
    await expect(page.locator('[role="treegrid"]')).toContainText(primary.name, { timeout: 15_000 })
    await primaryDetailsRow.action('More actions').click()
    await viewDetailsButtons.filter({ visible: true }).click()

    await expect(farRisksButton).toBeEnabled()
    await farRisksButton.click()
    await expect(page).toHaveURL(new RegExp(`/far\\?id=${far.id}`))

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

    // Deselect the selected row through the shared toggle-selection contract.
    const multiSelectModifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await cell0.click({ modifiers: [multiSelectModifier] })
    await expect(rows.nth(0)).not.toHaveClass(/ag-row-selected/)

    const primaryCompareRow = await getWorkspaceLogicalRowByText(page, 'assets', primary.name)
    const secondaryCompareRow = await getWorkspaceLogicalRowByText(page, 'assets', secondary.name)
    await (await primaryCompareRow.cell('name')).click()
    await (await secondaryCompareRow.cell('name')).click({ modifiers: [multiSelectModifier] })
    await expect(primaryCompareRow.center!).toHaveClass(/ag-row-selected/)
    await expect(secondaryCompareRow.center!).toHaveClass(/ag-row-selected/)
    // Target B.2: Name/Instance click no-panel behavior proof
    const nameCell = rows.nth(0).locator('.ag-cell').nth(1)
    await nameCell.click()
    // Verify name-cell click does NOT trigger details side panel/modal opening
    await expect(page.getByText('Suggested Runbooks Now')).not.toBeVisible()

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
    const secondaryBulkRow = await getWorkspaceLogicalRowByText(page, 'assets', secondary.name)
    await (await primaryBulkRow.cell('name')).click()
    await (await secondaryBulkRow.cell('name')).click({ modifiers: [multiSelectModifier] })
    await expect(primaryBulkRow.center!).toHaveClass(/ag-row-selected/)
    await expect(secondaryBulkRow.center!).toHaveClass(/ag-row-selected/)

    // Target B.1: Bulk action expandable inline panel grammar proof
    await bulkActionsButton.click()
    // Destructive confirm buttons must not be stacked outside cards
    await expect(page.getByRole('button', { name: 'Confirm Archive?' })).not.toBeVisible()

    // Expand Archive Selection card
    const archiveCard = page.getByText('Archive Selection')
    await expect(archiveCard).toBeVisible()
    await archiveCard.click()

    // Confirm button inside expanded action card
    const archiveActionBtn = page.getByRole('button', { name: 'Archive selected assets' })
    await expect(archiveActionBtn).toBeVisible()
    await archiveActionBtn.click()
    await expect(page.getByRole('button', { name: 'Confirm Archive?' })).toBeVisible()

    // Close bulk actions panel
    await bulkActionsButton.click()

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
    await clickResilientButton(page, 'Import')
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
    await clickResilientButton(page, 'Discard Changes')
    await expect(page.getByText('Assets Import')).not.toBeVisible()

    // Settle layout before action click

    // E2E Verification of Soft-Delete and Scope-Switch lifecycle by semantic row identity.
    const secondaryLifecycleRow = await getWorkspaceLogicalRowByText(page, 'assets', secondary.name)
    await secondaryLifecycleRow.action('More actions').click()
    const archiveRowAction = page.getByRole('button', { name: 'Archive', exact: true })
    await archiveRowAction.click()

    const deleteRequestPromise = page.waitForRequest(request => request.url().includes('/api/v1/devices/bulk-action'))
    const deleteResponsePromise = page.waitForResponse(response =>
      response.url().includes('/api/v1/devices/bulk-action') && response.status() === 200
    )
    const confirmArchiveAction = page.getByRole('button', { name: 'Confirm Archive?', exact: true })
    await confirmArchiveAction.click()
    const deleteRequest = await deleteRequestPromise
    await deleteResponsePromise
    expect(deleteRequest.postDataJSON()).toMatchObject({ ids: [secondary.id], action: 'delete' })

    // Restore the broader system scope before selecting a different asset.
    await fillGridSearch(page, 'Scan asset matrix...', systemName)
    await expect(page.locator('[role="treegrid"]')).toContainText(primary.name, { timeout: 15_000 })

    // Change selection to another asset: Revert remains bound to the captured operation, not selection.
    const primaryLifecycleRow = await getWorkspaceLogicalRowByText(page, 'assets', primary.name)
    await (await primaryLifecycleRow.cell('name')).click()
    await expect(primaryLifecycleRow.center!).toHaveClass(/ag-row-selected/)

    const revertAction = getWorkspaceRoot(page, 'assets').getByRole('button', { name: 'Revert', exact: true })
    await expect(revertAction).toBeVisible()
    await expect(revertAction).toBeEnabled()
    await revertAction.click()
    const revertConfirm = page.getByRole('dialog').filter({ has: page.getByText('Revert asset operation', { exact: true }) })
    await expect(revertConfirm).toBeVisible()
    await expect(revertConfirm).toContainText(secondary.name)
    const restoreRequestPromise = page.waitForRequest(request => request.url().includes('/api/v1/devices/bulk-action'))
    const restoreResponsePromise = page.waitForResponse(response =>
      response.url().includes('/api/v1/devices/bulk-action') && response.status() === 200
    )
    await revertConfirm.getByRole('button', { name: 'Confirm Action', exact: true }).click()
    const restoreRequest = await restoreRequestPromise
    await restoreResponsePromise
    expect(restoreRequest.postDataJSON()).toMatchObject({ ids: [secondary.id], action: 'restore' })
    await expect((await getWorkspaceLogicalRowByText(page, 'assets', secondary.name)).center!).toBeVisible()
    await expect(primaryLifecycleRow.center!).toHaveClass(/ag-row-selected/)

    // Archive again so the existing purged-scope proof continues with the same row identity.
    await (await getWorkspaceLogicalRowByText(page, 'assets', secondary.name)).action('More actions').click()
    await clickResilientButton(page, /^Archive$/)
    const secondDeleteResponsePromise = page.waitForResponse(response =>
      response.url().includes('/api/v1/devices/bulk-action') && response.status() === 200
    )
    await clickResilientButton(page, /^Confirm Archive\?$/)
    await secondDeleteResponsePromise

    // Settle React state before tab switch

    // Switch to Purged Tab and verify row is present in Deleted scope
    await openToolbarButton(page, /Purged/)
    await fillGridSearch(page, 'Scan asset matrix...', secondary.name)
    await verifyGridRowRobust(page, secondary.name)

    // Target B.3: Deleted/purged scope suppression proof
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

    // Perform permanent Purge lifecycle path on the deleted row
    const purgeActionBtn = page.getByTitle('More actions').filter({ visible: true })
    await purgeActionBtn.waitFor({ state: 'visible' })
    await purgeActionBtn.click()
    const purgeRowAction = page.getByRole('button', { name: 'Purge', exact: true })
    await purgeRowAction.click()

    const purgeResponsePromise = page.waitForResponse(response =>
      response.url().includes('/api/v1/devices/bulk-action') && response.status() === 200
    )
    const confirmPurgeAction = page.getByRole('button', { name: 'Confirm Purge?', exact: true })
    await confirmPurgeAction.click()
    await purgeResponsePromise

    // Verify row has disappeared completely from Purged scope by reloading the page
    await page.goto('/asset')
    await openToolbarButton(page, /Purged/)
    await fillGridSearch(page, 'Scan asset matrix...', secondary.name)
    await expect(page.getByText('No assets match the current working view')).toBeVisible()

    // Verify row has not returned to Existing scope either on clean reload
    await openToolbarButton(page, /Existing/)
    await fillGridSearch(page, 'Scan asset matrix...', secondary.name)
    await expect(page.getByText('No assets match the current working view')).toBeVisible()

    // B. Toolbar / Export / Template Disabled state check when the registry is empty or filtered-empty
    await page.getByTitle('Export asset data').click()
    await expect(page.getByRole('button', { name: /^Export CSV/ })).toBeDisabled()
    await expect(page.getByRole('button', { name: /^Snapshot/ })).toBeDisabled()
    await expect(page.getByRole('button', { name: /^Export Template/ })).toBeEnabled()
    // Dismiss export flyout by clicking outside
    await page.mouse.click(10, 10)

    // Open and close import modal cleanly
    await clickResilientButton(page, 'Import')
    await expect(page.getByText('Assets Import')).toBeVisible()
    await importDialog.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: 'Close' }).click()
    await expect(page.getByText('Assets Import')).not.toBeVisible()

    await page.goto(`/monitoring?id=${monitoring.id}`)
    await expect(page).toHaveURL(new RegExp(`/monitoring\\?id=${monitoring.id}$`))
    await expect(page.getByRole('heading', { name: 'Monitoring' })).toBeVisible()
    await expect(page.getByRole('heading', { name: monitoring.title, exact: true }).first()).toBeVisible()
  })
})
