import { expect, type Page, type TestInfo } from '@playwright/test'

// Inspect the rendered foreground against the composited row/cell backgrounds,
// including translucent status badges. Hidden/disabled content is not actionable.
export async function expectReadableGridText(page: Page, testInfo: TestInfo, name: string, selector = ':is(.operational-grid-shell, .monitoring-grid-shell) .ag-cell') {
  const samples = await page.locator(selector).evaluateAll(cells => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
    const converted = new Map<string, number[]>()
    const rgba = (value: string) => {
      const channels = value.match(/[\d.]+/g)?.map(Number) || []
      if (value.startsWith('color(srgb ')) return [...channels.slice(0, 3).map(channel => channel * 255), channels[3] ?? 1]
      if (value.startsWith('rgb')) return [channels[0] || 0, channels[1] || 0, channels[2] || 0, channels[3] ?? 1]
      if (!context || !CSS.supports('color', value)) throw new Error(`Unmeasured CSS color: ${value}`)
      if (!converted.has(value)) {
        // Let the rendering engine convert modern colors, including OKLab
        // transition values, into the same sRGB space used by the oracle.
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = value
        context.fillRect(0, 0, 1, 1)
        const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1, { colorSpace: 'srgb' }).data
        converted.set(value, [red, green, blue, alpha / 255])
      }
      return converted.get(value)!
    }
    const over = (front: number[], back: number[]) => front.slice(0, 3).map((channel, index) => channel * front[3] + back[index] * (1 - front[3]))
    const luminance = (color: number[]) => color.map(channel => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0)
    return cells.flatMap(cell => {
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
      const result = []
      const contents: Array<{ element: Element; text: string }> = []
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const element = node.parentElement!
        const text = node.textContent?.trim()
        if (text) contents.push({ element, text })
      }
      const controls = cell.matches('input, textarea, select') ? [cell] : Array.from(cell.querySelectorAll('input, textarea, select'))
      for (const control of controls) {
        if ((control as HTMLInputElement).value && !control.matches('[type="hidden"], [type="color"], [type="checkbox"], [type="radio"]')) {
          contents.push({ element: control, text: control.getAttribute('aria-label') || control.getAttribute('placeholder') || 'Form control value' })
        }
      }
      for (const { element, text } of contents) {
        if (!text || element.closest('[disabled], [aria-disabled="true"], [aria-hidden="true"]')) continue
        const bounds = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        if (!bounds.width || !bounds.height || bounds.right <= 0 || bounds.left >= innerWidth || bounds.bottom <= 0 || bounds.top >= innerHeight || style.visibility === 'hidden') continue
        const ancestors: Element[] = []
        for (let parent: Element | null = element; parent; parent = parent.parentElement) ancestors.unshift(parent)
        let background = [255, 255, 255]
        for (const ancestor of ancestors) background = over(rgba(getComputedStyle(ancestor).backgroundColor), background)
        const foreground = over(rgba(style.color), background)
        const light = luminance(foreground)
        const dark = luminance(background)
        const ratio = (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05)
        const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight, 10) >= 700)
        result.push({ text, column: cell.getAttribute('col-id'), foreground, background, ratio, minimum: large ? 3 : 4.5 })
      }
      return result
    })
  })
  await testInfo.attach(`${name}-grid-contrast`, { body: JSON.stringify(samples, null, 2), contentType: 'application/json' })
  expect(samples.length, `${name} must exercise populated grid text`).toBeGreaterThan(0)
  expect(samples.filter(sample => sample.ratio < sample.minimum), `${name} grid text contrast`).toEqual([])
}
