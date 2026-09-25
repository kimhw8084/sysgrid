import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { clickResilientButton, expectWorkspaceLogicalRowSelected, fillGridSearch, getWorkspaceLogicalRowByText, getWorkspaceRoot, resetBrowserState, seedOperationalScenario, selectWorkspaceLogicalRow } from './helpers/sysgrid'

test.describe('Assets Revert lifecycle', () => {
  test('reverts the immutable completed row operation after selection changes', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const { primary, secondary, systemName } = await seedOperationalScenario(request)

    await page.goto('/asset')
    await expect(getWorkspaceRoot(page, 'assets')).toBeVisible()
    await page.getByPlaceholder('Scan asset matrix...').fill(systemName)
    await expect((await getWorkspaceLogicalRowByText(page, 'assets', secondary.name)).center!).toBeVisible()

    const secondaryRow = await getWorkspaceLogicalRowByText(page, 'assets', secondary.name)
    await secondaryRow.action('More actions').click()
    await clickResilientButton(page, /^Archive$/)
    const archivePreviewResponse = page.waitForResponse((entry) => entry.url().includes('/api/v1/devices/bulk-action') && entry.status() === 200)
    await clickResilientButton(page, /^Confirm Archive\?$/)
    await archivePreviewResponse
    const archivePreview = page.getByRole('dialog', { name: 'Assets bulk preview' })
    const archiveRequest = page.waitForRequest((entry) => {
      if (!entry.url().includes('/api/v1/devices/bulk-action')) return false
      const body = entry.postDataJSON() as { dry_run?: boolean } | null
      return body?.dry_run !== true
    })
    const archiveResponse = page.waitForResponse((entry) => entry.url().includes('/api/v1/devices/bulk-action') && entry.status() === 200)
    await archivePreview.getByRole('button', { name: 'Confirm Archive selection' }).click()
    expect((await archiveRequest).postDataJSON()).toMatchObject({ ids: [secondary.id], action: 'delete' })
    await archiveResponse
    await page.getByRole('dialog', { name: 'Assets bulk complete' }).getByRole('button', { name: 'Close bulk receipt' }).click()

    // The archive response refreshes the grid asynchronously. Restore the broader
    // search scope and reacquire the row only after the refreshed grid renders it.
    await fillGridSearch(page, 'Scan asset matrix...', systemName, 'assets')
    await expect(getWorkspaceRoot(page, 'assets').getByRole('treegrid')).toContainText(primary.name, { timeout: 15_000 })

    const primaryRow = await getWorkspaceLogicalRowByText(page, 'assets', primary.name)
    await selectWorkspaceLogicalRow(primaryRow)
    await expectWorkspaceLogicalRowSelected(primaryRow)

    const revert = getWorkspaceRoot(page, 'assets').getByRole('button', { name: 'Revert last completed asset lifecycle operation' })
    await expect(revert).toBeVisible()
    const restoreRequest = page.waitForRequest((entry) => entry.url().includes('/api/v1/devices/bulk-action'))
    const restoreResponse = page.waitForResponse((entry) => entry.url().includes('/api/v1/devices/bulk-action') && entry.status() === 200)
    await revert.click()
    const revertConfirm = page.getByRole('dialog').filter({ has: page.getByText('Revert asset operation', { exact: true }) })
    await expect(revertConfirm).toContainText('completed archive operation')
    await revertConfirm.getByRole('button', { name: 'Confirm Action', exact: true }).click()
    expect((await restoreRequest).postDataJSON()).toMatchObject({ ids: [secondary.id], action: 'restore' })
    await restoreResponse
    await expect((await getWorkspaceLogicalRowByText(page, 'assets', secondary.name)).center!).toBeVisible()
    const refreshedPrimaryRow = await getWorkspaceLogicalRowByText(page, 'assets', primary.name)
    await expectWorkspaceLogicalRowSelected(refreshedPrimaryRow)
  })
})
