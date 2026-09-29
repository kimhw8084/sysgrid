import { expect, type Locator } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState } from './helpers/sysgrid'

async function textAppearance(locator: Locator) {
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
    const style = getComputedStyle(node)
    const ink = rgba(style.color)
    const alpha = ink[3] * Number(style.opacity)
    const foreground = background.map((value, index) => ink[index] * alpha + value * (1 - alpha))
    const luminance = (color: number[]) => color.slice(0, 3).map(value => {
      const channel = value / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    const a = luminance(foreground), b = luminance(background)
    return { contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), fontSize: parseFloat(style.fontSize) }
  })
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const width of [1440, 390]) {
    test(`settings reference ${theme} ${width}`, async ({ page, sysApi: request }, testInfo) => {
      await resetBrowserState(page)
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 })
      const preference = await request.patch(`${process.env.PW_API_BASE}/settings/user/settings`, { data: { theme } })
      expect(preference.ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      const settingsBefore = await request.get(`${process.env.PW_API_BASE}/settings/global`)
      expect(settingsBefore.ok()).toBeTruthy()
      const before = await settingsBefore.json()
      await page.goto('/settings?tab=environments')
      const parameters = page.locator('[data-settings-tab-content="environments"]')
      const preferences = parameters.locator('[data-settings-personal-preferences]')
      await expect(preferences.getByText('Personal Preferences', { exact: true })).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: testInfo.outputPath('settings-overview.png'), animations: 'disabled' })
      const prefAppearance = await textAppearance(preferences.getByText('Personal Preferences', { exact: true }))
      expect.soft(prefAppearance.contrast).toBeGreaterThanOrEqual(4.5)

      const editButtons = parameters.locator('button[title="Edit Field"]')
      await expect(editButtons.first()).toBeVisible()
      let index = -1
      for (let i = 0; i < await editButtons.count(); i++) {
        if (await editButtons.nth(i).locator('xpath=../../..').locator('input:not([type="checkbox"])').count()) {
          index = i
          break
        }
      }
      expect(index).toBeGreaterThanOrEqual(0)
      const controls = parameters.locator('button[title="Edit Field"], button[title="Lock & Discard Changes"]')
      const control = controls.nth(index)
      const card = control.locator('xpath=../../..')
      const input = card.locator('input:not([type="checkbox"])').first()
      await input.scrollIntoViewIfNeeded()
      const original = await input.inputValue()
      expect(original.length).toBeGreaterThan(0)
      const appearance = await textAppearance(input)
      const state = await input.evaluate(node => ({ disabled: (node as HTMLInputElement).disabled, readOnly: (node as HTMLInputElement).readOnly }))
      await testInfo.attach('settings-readability', { body: JSON.stringify({ theme, width, prefAppearance, appearance, state, original }), contentType: 'application/json' })
      expect.soft(appearance.contrast).toBeGreaterThanOrEqual(4.5)
      expect.soft(appearance.fontSize).toBeGreaterThanOrEqual(12)
      expect.soft(state).toEqual({ disabled: false, readOnly: true })
      if (!state.disabled) {
        await input.focus()
        await expect(input).toBeFocused()
        await input.press('ControlOrMeta+a')
        expect(await input.evaluate(node => (node as HTMLInputElement).selectionEnd! - (node as HTMLInputElement).selectionStart!)).toBe(original.length)
        await input.press('End')
        await input.press('x')
        await expect(input).toHaveValue(original)
      }
      await input.scrollIntoViewIfNeeded()
      await expect(input).toBeInViewport({ ratio: 0.9 })
      await page.screenshot({ path: testInfo.outputPath('settings-readable-value.png'), animations: 'disabled' })
      await control.click()
      await input.fill('Unsaved readability verification')
      await expect(card.getByText('Modified', { exact: true })).toBeVisible()
      await expect(input).toHaveValue('Unsaved readability verification')
      await control.click()
      await expect(input).toHaveValue(original)
      await expect(card.getByText('Loaded', { exact: true })).toBeVisible()
      const afterResponse = await request.get(`${process.env.PW_API_BASE}/settings/global`)
      expect(afterResponse.ok()).toBeTruthy()
      expect(await afterResponse.json()).toEqual(before)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2)
    })
  }
}
