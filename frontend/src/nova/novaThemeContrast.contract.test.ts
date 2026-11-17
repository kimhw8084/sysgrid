import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/nova/nova.css'), 'utf8')

function declarationBlock(selector: string): string {
  const selectorStart = css.indexOf(selector)
  const open = css.indexOf('{', selectorStart)
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}' && --depth === 0) return css.slice(open + 1, index)
  }
  throw new Error(`Could not read CSS block for ${selector}`)
}

function declaration(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}:\\s*([^;]+);`))
  if (!match) throw new Error(`Missing CSS property ${name}`)
  return match[1].trim()
}

function linear(value: number): number {
  const channel = Math.max(0, Math.min(1, value))
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function rgb(color: string): [number, number, number] {
  if (/^#[\da-f]{6}$/i.test(color)) {
    return [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255) as [number, number, number]
  }
  const match = color.match(/^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/i)
  if (!match) throw new Error(`Unsupported test color syntax: ${color}`)
  const [, lightness, chroma, hue] = match.map(Number)
  const radians = hue * Math.PI / 180
  const a = chroma * Math.cos(radians)
  const b = chroma * Math.sin(radians)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const gamma = (value: number) => value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
  return [
    gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

function contrast(foreground: string, background: string): number {
  const luminance = (color: string) => rgb(color).map(linear).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
  const [lower, upper] = [luminance(foreground), luminance(background)].sort((left, right) => left - right)
  return (upper + 0.05) / (lower + 0.05)
}

describe('Nova theme accent contrast contract', () => {
  it('keeps dark and light accent text at or above 4.5:1 on their card and page surfaces', () => {
    const dark = declarationBlock(':root,\n.nova-app-shell')
    const light = declarationBlock(':root[data-theme="pure-clarity"]')
    const darkAccent = declaration(dark, '--brand-blue')
    const lightAccent = declaration(light, '--brand-blue')
    const darkCard = declaration(dark, '--card')
    const darkBackground = declaration(dark, '--background')
    const lightCard = declaration(light, '--card')

    expect(contrast(darkAccent, darkCard)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(darkAccent, darkBackground)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(lightAccent, lightCard)).toBeGreaterThanOrEqual(4.5)
  })
})
