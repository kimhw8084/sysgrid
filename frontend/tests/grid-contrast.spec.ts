import { test, expect } from '@playwright/test'
import { expectReadableGridText } from './helpers/grid-contrast'

for (const color of ['rgb(0, 0, 0)', 'color(srgb 0 0 0)', 'oklab(0 0 0)', 'oklch(0 0 0)', 'color(display-p3 0 0 0)']) {
  test(`contrast measures black on white using ${color}`, async ({ page }, testInfo) => {
    await page.setContent(`<p style="background: white; color: ${color}">Measured text</p>`)
    await expectReadableGridText(page, testInfo, 'black-on-white', 'p')
    const attachment = testInfo.attachments.find(item => item.name === 'black-on-white-grid-contrast')!
    const [sample] = JSON.parse(attachment.body!.toString())
    expect(sample.ratio).toBeCloseTo(21, 3)
  })
}

test('contrast measures the captured relationship transition color', async ({ page }, testInfo) => {
  await page.setContent('<p style="background: white; color: oklab(0.431429 0.0000196317 0.00000867539)">Transition text</p>')
  await expectReadableGridText(page, testInfo, 'captured-transition', 'p')
  const attachment = testInfo.attachments.find(item => item.name === 'captured-transition-grid-contrast')!
  const [sample] = JSON.parse(attachment.body!.toString())
  // For a neutral OKLab color, relative luminance is L cubed. Allow only
  // the rounding introduced by the browser's eight-bit sRGB rasterization.
  expect(Math.abs(sample.ratio - 1.05 / (0.431429 ** 3 + 0.05))).toBeLessThan(0.05)
})

for (const style of [
  'background: white; color: rgb(136, 136, 136)',
  'background: white; color: color(srgb 0.8 0.8 0.8)',
  'background: white; color: oklab(0.8 0 0)',
  'background: white; color: oklch(0.8 0 0)',
  'background: white; color: color(display-p3 0.8 0.8 0.8)',
  'background: white; color: oklab(0 0 0 / 0.25)',
  'background: oklab(0 0 0 / 0.5); color: white',
]) {
  test(`contrast still rejects unreadable text using ${style}`, async ({ page }, testInfo) => {
    await page.setContent(`<p style="${style}">Unreadable text</p>`)
    await expect(expectReadableGridText(page, testInfo, 'negative-control', 'p')).rejects.toThrow('grid text contrast')
  })
}
