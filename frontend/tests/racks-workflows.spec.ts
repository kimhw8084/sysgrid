import { clickResilientButton } from './helpers/sysgrid';
import { expect, type Page } from '@playwright/test';
import { test } from './helpers/sysgrid-test';
import { createAsset, resetBrowserState, seedRackScenario } from './helpers/sysgrid'

async function scrollRackIntoRailView(page: Page, rackId: number) {
  const rackCard = page.locator(`.glass-panel[data-rack-id="${rackId}"]`)
  const rail = page.locator('#racks-grid')
  const nextRacks = page.getByRole('button', { name: 'Scroll to next racks' })
  const isInRailView = () => rackCard.evaluate(element => {
    const railElement = element.closest('#racks-grid')
    if (!railElement) return false
    const cardBounds = element.getBoundingClientRect()
    const railBounds = railElement.getBoundingClientRect()
    return cardBounds.right > railBounds.left && cardBounds.left < railBounds.right
  }).catch(() => false)

  await rail.evaluate(element => { element.scrollLeft = 0 })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await rackCard.count()) {
      await rackCard.scrollIntoViewIfNeeded()
      if (await isInRailView()) return
    }
    if (!(await nextRacks.count())) break
    if (!(await nextRacks.isEnabled())) break
    await nextRacks.evaluate(button => (button as HTMLButtonElement).click())
    await page.waitForTimeout(100)
  }
  await expect.poll(isInRailView, { timeout: 5000 }).toBe(true)
}

test.describe('Racks workflows', () => {
  test('keeps rack data unavailable distinct from an empty rack list and recovers on retry', async ({ page }, testInfo) => {
    await resetBrowserState(page)
    await page.setViewportSize({ width: 1440, height: 900 })

    let allowRecovery = false
    let failedAttempts = 0
    let recoveredAttempts = 0
    await page.route(/\/api\/v1\/racks\/?\?include_deleted=true$/, async route => {
      if (!allowRecovery) {
        failedAttempts += 1
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Temporary rack service outage.' }) })
        return
      }
      recoveredAttempts += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/racks')
    const failure = page.getByRole('alert').filter({ hasText: 'Rack records could not be loaded' })
    await expect(failure).toContainText('Rack records could not be loaded')
    await expect(failure).toContainText('An empty result has not been confirmed')
    await expect(page.getByText('No Racks in Scope', { exact: true })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Add', exact: true })).not.toBeVisible()
    expect(failedAttempts).toBeGreaterThan(0)
    await page.screenshot({ path: testInfo.outputPath('rack-data-unavailable.png'), animations: 'disabled' })

    allowRecovery = true
    await page.getByRole('button', { name: 'Retry rack records', exact: true }).click()
    await expect(page.getByText('No Racks in Scope', { exact: true })).toBeVisible()
    expect(recoveredAttempts).toBe(1)
    await page.screenshot({ path: testInfo.outputPath('rack-empty-confirmed-after-retry.png'), animations: 'disabled' })
  })

  test('opens authoritative rack deep links and keeps query/history state coherent', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const { rackA1 } = await seedRackScenario(request)

    await page.goto(`/racks?id=${encodeURIComponent(rackA1.id)}&view=elevation`)
    await expect(page.getByText(`${rackA1.name} Summary`, { exact: true })).toBeVisible()
    await expect(page.getByText('Typical Power Estimate', { exact: true })).toBeVisible()
    await expect(page.getByText('Configured Rack Ceiling', { exact: true })).toBeVisible()
    await expect(page.getByText('Estimate uses mounted device typical-power fields. Live rack/PDU load telemetry unavailable.', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Close', exact: true }).last().click()
    await expect(page).toHaveURL(/\/racks\?view=elevation$/)

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/racks\\?id=${rackA1.id}&view=elevation$`))
    await expect(page.getByText(`${rackA1.name} Summary`, { exact: true })).toBeVisible()

    await page.goForward()
    await expect(page).toHaveURL(/\/racks\?view=elevation$/)
    await expect(page.getByText(`${rackA1.name} Summary`, { exact: true })).not.toBeVisible()
    await page.locator('[class*="group/pdu"]').first().hover()
    await expect(page.getByText('Live PDU load telemetry unavailable', { exact: true }).first()).toBeVisible()
  })

  test('opens a contained asset through the typed relationship and returns to Rack context', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const { siteA, rackA1, devicePrimary } = await seedRackScenario(request)

    await page.goto('/racks')
    await page.getByRole('button', { name: `Open site ${siteA.name}`, exact: true }).click()
    const rackCard = page.locator(`.glass-panel[data-rack-id="${rackA1.id}"]`)
    await expect(rackCard).toBeVisible()
    await rackCard.locator(`[data-device-id="${devicePrimary.id}"]`).first().getByRole('button', { name: new RegExp(`^Open ${devicePrimary.name},`) }).click()
    await page.getByRole('button', { name: 'Edit Asset', exact: true }).click()
    await expect(page.getByRole('heading', { name: devicePrimary.name, exact: true })).toBeVisible()

    await page.getByRole('link', { name: 'Open Asset', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/asset\\?id=${devicePrimary.id}$`))
    await page.goBack()
    await expect(page).toHaveURL(/\/racks$/)
    await expect(rackCard).toBeVisible()
  })

  test('handles spatial navigation, site decommission fallback, and sandbox collision safety', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    // Nullable optional fields are legitimate in ordinary/imported asset rows.
    // A non-matching asset must not crash the full candidate-list filter.
    await createAsset(request, { name: `Nullable rack candidate ${Date.now()}`, system: 'Import compatibility', type: null })
    const { siteA, rackA1, rackA2, devicePrimary, deviceSecondary } = await seedRackScenario(request)
    const rackCard = (id: number) => page.locator(`.glass-panel[data-rack-id="${id}"]`)

    await page.goto('/racks')
    await expect(page.getByRole('heading', { name: 'Racks' })).toBeVisible()

    const siteButton = page.getByRole('button', { name: `Open site ${siteA.name}`, exact: true })
    await expect(siteButton).toBeVisible({ timeout: 20000 })
    await siteButton.click()
    await expect(rackCard(rackA1.id)).toBeVisible()

    await clickResilientButton(page, 'Spatial')
    await page.getByText(rackA2.name, { exact: true }).click()
    await expect(rackCard(rackA2.id)).toBeVisible()

    const siteChip = page.locator('div.group\\/site').filter({ hasText: siteA.name }).first()
    await siteChip.getByRole('button').nth(1).click({ force: true })
    await clickResilientButton(page, /Decommission/i)
    await clickResilientButton(page, 'Decommission Site')
    await expect(rackCard(rackA1.id)).toBeVisible()

    await page.getByRole('button', { name: 'View Plans', exact: true }).click()
    await clickResilientButton(page, /New Blank Plan/i)
    await expect(page.getByText('Ghost Planner')).toBeVisible()

    await scrollRackIntoRailView(page, rackA1.id)
    await rackCard(rackA1.id).locator('[data-u="1"]').getByRole('button', { name: 'Mount or reserve at U1', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Mount Asset' })).toBeVisible()
    await page.getByPlaceholder('Filter by name, type, or system...').fill(devicePrimary.name)
    await page.getByText(devicePrimary.name, { exact: true }).click()
    await clickResilientButton(page, 'Mount Asset')
    await expect(page.getByText('Ghost Planner')).toBeVisible()

    await rackCard(rackA1.id).locator('[data-u="1"]').getByRole('button', { name: 'Select rack unit U1', exact: true }).click()
    await page.getByPlaceholder('Filter by name, type, or system...').fill(deviceSecondary.name)
    await page.getByText(deviceSecondary.name, { exact: true }).click()
    await clickResilientButton(page, 'Mount Asset')
    await expect(page.getByText(/Collision with/i)).toBeVisible()
    await expect(rackCard(rackA1.id)).toContainText(devicePrimary.name)
    await expect(rackCard(rackA1.id)).not.toContainText(deviceSecondary.name)
  })
})
