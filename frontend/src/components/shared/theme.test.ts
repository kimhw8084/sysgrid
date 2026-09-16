import { describe, expect, it } from 'vitest'
import { normalizeTheme } from './theme'

describe('SysGrid theme compatibility', () => {
  it('preserves V2 ids and maps persisted legacy aliases', () => {
    expect(normalizeTheme('nordic-frost-v1')).toBe('nordic-frost-v1')
    expect(normalizeTheme('pure-clarity')).toBe('pure-clarity')
    expect(normalizeTheme('dark')).toBe('nordic-frost-v1')
    expect(normalizeTheme('light')).toBe('pure-clarity')
    expect(normalizeTheme('unknown-theme')).toBe('nordic-frost-v1')
  })
})
