import { clickResilientButton } from './helpers/sysgrid';
import { expect } from '@playwright/test';
import { test } from './helpers/sysgrid-test';
import { resetBrowserState, seedRackScenario } from './helpers/sysgrid'

test.describe('Racks workflows', () => {
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
    await rackCard.locator(`[data-device-id="${devicePrimary.id}"]`).first().locator('div').nth(1).click()
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

    await page.getByTitle('View Plans').click()
    await clickResilientButton(page, /New Blank Plan/i)
    await expect(page.getByText('Ghost Planner')).toBeVisible()

    await rackCard(rackA1.id).locator('[data-u="1"] > div').first().click()
    await expect(page.getByRole('heading', { name: 'Mount Asset' })).toBeVisible()
    await page.getByPlaceholder('Filter by name, type, or system...').fill(devicePrimary.name)
    await page.getByText(devicePrimary.name, { exact: true }).click()
    await clickResilientButton(page, 'Mount Asset')
    await expect(page.getByText('Ghost Planner')).toBeVisible()

    await rackCard(rackA1.id).locator('[data-u="1"] > div').first().click()
    await page.getByPlaceholder('Filter by name, type, or system...').fill(deviceSecondary.name)
    await page.getByText(deviceSecondary.name, { exact: true }).click()
    await clickResilientButton(page, 'Mount Asset')
    await expect(page.getByText(/Collision with/i)).toBeVisible()
    await expect(rackCard(rackA1.id)).toContainText(devicePrimary.name)
    await expect(rackCard(rackA1.id)).not.toContainText(deviceSecondary.name)
  })
})
