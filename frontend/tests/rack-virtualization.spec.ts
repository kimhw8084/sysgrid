import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createRack, createSite, resetBrowserState } from './helpers/sysgrid'

test('keeps virtual aisle spacers aligned through far-right rack navigation', async ({ page, sysApi: request }, testInfo) => {
  await resetBrowserState(page)
  await page.setViewportSize({ width: 1440, height: 900 })

  const site = await createSite(request, { name: `PW-RACK-VIRTUAL-1793498710850`, color: '#2563eb' })
  const aisleCount = 8
  const racksPerAisle = 8
  const totalRacks = aisleCount * racksPerAisle
  let tailRackId = 0

  for (let aisleIndex = 0; aisleIndex < aisleCount; aisleIndex += 1) {
    const aisle = `A${String(aisleIndex).padStart(2, '0')}`
    for (let rackIndex = 0; rackIndex < racksPerAisle; rackIndex += 1) {
      const rack = await createRack(request, {
        site_id: site.id,
        name: `PW-VIRTUAL-${aisle}-${rackIndex + 1}`,
        aisle,
        row: '1',
        total_u: 12,
        max_power_kw: 10
      })
      if (aisleIndex === aisleCount - 1 && rackIndex === racksPerAisle - 1) tailRackId = rack.id
    }
  }

  await page.goto('/racks')
  await expect(page.getByRole('button', { name: `Open site ${site.name}`, exact: true })).toBeVisible()
  await page.getByRole('button', { name: `Open site ${site.name}`, exact: true }).click()

  const rail = page.locator('#racks-grid')
  const cards = rail.locator('.glass-panel[data-rack-id]')
  await expect.poll(() => cards.count()).toBeGreaterThan(0)
  await expect.poll(() => cards.count()).toBeLessThan(totalRacks)

  await rail.evaluate(element => { element.scrollLeft = element.scrollWidth })
  const tailCard = rail.locator(`.glass-panel[data-rack-id="${tailRackId}"]`)
  await expect(tailCard).toHaveCount(1)
  await expect.poll(() => tailCard.evaluate(element => {
    const scrollRail = element.closest('#racks-grid')
    if (!scrollRail) return false
    const cardBounds = element.getBoundingClientRect()
    const railBounds = scrollRail.getBoundingClientRect()
    return cardBounds.right > railBounds.left && cardBounds.left < railBounds.right
  }).catch(() => false)).toBe(true)

  await page.screenshot({ path: testInfo.outputPath('rack-virtualization-far-right.png'), animations: 'disabled' })
})
