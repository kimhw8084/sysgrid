import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

const html = readFileSync('index.html', 'utf8')
const bootstrap = new Function(html.match(/<script>([\s\S]*?)<\/script>/)![1])
afterEach(() => vi.restoreAllMocks())

describe('theme before the application starts', () => {
  it.each(['SecurityError', 'QuotaExceededError'])('uses the default theme when storage throws %s', name => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', name) })
    expect(() => bootstrap()).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('nordic-frost-v1')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('still applies the saved light theme before React starts', () => {
    localStorage.setItem('sysgrid-theme', 'pure-clarity')
    bootstrap()
    expect(document.documentElement.dataset.theme).toBe('pure-clarity')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('does not swallow an unexpected script error', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new TypeError('Unexpected bootstrap bug') })
    expect(() => bootstrap()).toThrow('Unexpected bootstrap bug')
  })
})
