import { expect, type Locator } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { createAsset, createRack, createSite, mountRackDevice, resetBrowserState } from './helpers/sysgrid'

async function textContrast(locator: Locator) {
  return locator.evaluate(node => {
    const rgba = (value: string) => {
      const values = value.match(/[\d.]+/g)!.map(Number)
      return [values[0], values[1], values[2], values[3] ?? 1]
    }
    const layers: number[][] = []
    for (let current: Element | null = node; current; current = current.parentElement) {
      layers.unshift(rgba(getComputedStyle(current).backgroundColor))
    }
    let background = [255, 255, 255]
    for (const layer of layers) background = background.map((value, index) => layer[index] * layer[3] + value * (1 - layer[3]))
    const foreground = rgba(getComputedStyle(node).color)
    const luminance = (color: number[]) => color.slice(0, 3).map(value => {
      const channel = value / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    const a = luminance(foreground), b = luminance(background)
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  })
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  test(`rack reference ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    await resetBrowserState(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    const preference = await request.patch(`${process.env.PW_API_BASE}/settings/user/settings`, { data: { theme } })
    expect(preference.ok()).toBeTruthy()
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    const longSite = await createSite(request, { name: `A · Regional operations and disaster recovery hall ${theme}`, color: '#2563eb' })
    const coreSite = await createSite(request, { name: `B · Core hall ${theme}`, color: '#059669' })
    const racks: Array<{ id: number; name: string; deviceNames: string[] }> = []
    for (let index = 0; index < 4; index++) {
      const rack = await createRack(request, { site_id: index === 0 ? longSite.id : coreSite.id, name: ['Recovery R01', 'Compute A01', 'Storage A02', 'Network A03'][index], aisle: 'A', row: '1', total_u: 12, max_power_kw: 10 })
      const deviceNames: string[] = []
      for (const [position, start, size] of [[0, 11, 1], [1, 7, 2], [2, 1, 2]]) {
        const name = `${['edge', 'compute', 'storage'][position]}-${index + 1}-${theme === 'pure-clarity' ? 'L' : 'D'}`
        const asset = await createAsset(request, { name, system: `RACK-REF-${theme}-${index}`, type: 'Physical', status: 'Active', power_typical_w: 300, serial_number: `${theme}-${index}-${position}` })
        await mountRackDevice(request, rack.id, { device_id: asset.id, start_u: start, size_u: size, orientation: 'Front', depth: 'Full' })
        deviceNames.push(name)
      }
      racks.push({ ...rack, deviceNames })
    }
    await testInfo.attach('populated-rack-fixture', { body: JSON.stringify({ longSite, coreSite, racks }), contentType: 'application/json' })
    await page.goto('/racks')
    await expect(page.getByRole('heading', { name: 'Racks', exact: true })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const card = (id: number) => page.locator(`.glass-panel[data-rack-id="${id}"]`)
    for (const rack of racks) await expect(card(rack.id).getByRole('heading', { name: rack.name, exact: true })).toBeVisible()
    const bounds = await page.locator('#racks-grid .glass-panel[data-rack-id]').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()).sort((a, b) => a.x - b.x))
    expect(bounds.length).toBeGreaterThanOrEqual(racks.length)
    const gaps = bounds.slice(1).map((box, index) => box.x - bounds[index].x - bounds[index].width)
    const contrast = await textContrast(card(racks[0].id).getByRole('heading', { name: racks[0].name, exact: true }))
    const legend = page.getByText('Status:', { exact: true }).locator('..')
    const summary = page.getByText('Configured Ceiling', { exact: true }).locator('../../..')
    const readability: Array<{ label: string; contrast: number; fontSize: number }> = []
    for (const label of ['Active', 'Standby', 'Maintenance', 'Decommissioned', 'Offline', 'Reserved']) {
      const text = legend.getByText(label, { exact: true })
      readability.push({ label: `Status ${label}`, contrast: await textContrast(text), fontSize: await text.evaluate(node => parseFloat(getComputedStyle(node).fontSize)) })
    }
    for (const label of ['Racks', 'Assets', 'Fill', 'Typical Est.', 'Configured Ceiling']) {
      const text = summary.getByText(label, { exact: true })
      readability.push({ label, contrast: await textContrast(text), fontSize: await text.evaluate(node => parseFloat(getComputedStyle(node).fontSize)) })
      const value = text.locator('..').locator('div').first()
      readability.push({ label: `${label} value`, contrast: await textContrast(value), fontSize: await value.evaluate(node => parseFloat(getComputedStyle(node).fontSize)) })
    }
    await testInfo.attach('rack-status-readability', { body: JSON.stringify(readability), contentType: 'application/json' })
    for (const measurement of readability) {
      expect.soft(measurement.contrast, `${measurement.label} contrast`).toBeGreaterThanOrEqual(4.5)
      expect.soft(measurement.fontSize, `${measurement.label} font size`).toBeGreaterThanOrEqual(measurement.label.endsWith(' value') ? 14 : 11)
    }
    await testInfo.attach('rack-layout', { body: JSON.stringify({ bounds, gaps, headingContrast: contrast }), contentType: 'application/json' })
    await page.screenshot({ path: testInfo.outputPath('racks-populated-desktop.png'), animations: 'disabled' })
    for (const gap of gaps) {
      expect.soft(gap).toBeGreaterThanOrEqual(15)
      expect.soft(gap).toBeLessThanOrEqual(33)
    }
    expect.soft(contrast).toBeGreaterThanOrEqual(4.5)
    // Show actual mounted equipment, including the lower units in a tall rack.
    await card(racks[0].id).getByText(racks[0].deviceNames[2], { exact: true }).scrollIntoViewIfNeeded()
    await expect(card(racks[0].id).getByText(racks[0].deviceNames[2], { exact: true })).toBeInViewport()
    await expect(card(racks[0].id).getByRole('img', { name: 'Status: Active', exact: true }).first()).toHaveAttribute('title', 'Status: Active')
    await page.screenshot({ path: testInfo.outputPath('racks-mounted-units.png'), animations: 'disabled' })

    await page.getByRole('button', { name: `Open site ${coreSite.name}`, exact: true }).click()
    await page.getByRole('button', { name: 'Spatial', exact: true }).click()
    await page.getByText(racks[2].name, { exact: true }).click()
    await expect(card(racks[2].id)).toBeVisible()
    await card(racks[2].id).locator('button').first().click()
    await page.getByRole('button', { name: 'Detailed Info', exact: true }).click()
    await expect(page.getByText(`${racks[2].name} Summary`, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).last().click()

    if (process.env.SYSGRID_DESKTOP_ONLY === '1') return
    await page.setViewportSize({ width: 390, height: 844 })
    const search = page.getByPlaceholder('Search racks & devices...')
    await search.scrollIntoViewIfNeeded()
    await expect(search).toBeInViewport({ ratio: 0.9 })
    await search.fill(racks[1].name)
    await expect(page.locator('#racks-grid .glass-panel[data-rack-id]')).toHaveCount(1)
    const mounted = card(racks[1].id).getByText(racks[1].deviceNames[0], { exact: true })
    await mounted.scrollIntoViewIfNeeded()
    await expect(mounted).toBeInViewport({ ratio: 0.9 })
    await page.screenshot({ path: testInfo.outputPath('racks-populated-phone.png'), animations: 'disabled' })
    expect.soft(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2)
  })
}
