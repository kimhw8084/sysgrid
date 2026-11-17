import { describe, expect, it } from 'vitest'
import { normalizeTheme, shouldInitializeThemeFromServer } from './theme'

describe('SysGrid theme compatibility', () => {
  it('preserves V2 ids and maps persisted legacy aliases', () => {
    expect(normalizeTheme('nordic-frost-v1')).toBe('nordic-frost-v1')
    expect(normalizeTheme('pure-clarity')).toBe('pure-clarity')
    expect(normalizeTheme('dark')).toBe('nordic-frost-v1')
    expect(normalizeTheme('light')).toBe('pure-clarity')
    expect(normalizeTheme('unknown-theme')).toBe('nordic-frost-v1')
  })

  it('uses the server only once when this browser has no saved theme preference', () => {
    expect(shouldInitializeThemeFromServer(false, false)).toBe(true)
    expect(shouldInitializeThemeFromServer(true, false)).toBe(false)
    expect(shouldInitializeThemeFromServer(false, true)).toBe(false)
  })
})
