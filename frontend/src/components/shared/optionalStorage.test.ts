import { afterEach, describe, expect, it, vi } from 'vitest'
import { readOptionalStorage, removeOptionalStorage, writeOptionalStorage } from './optionalStorage'
import { showWorkspaceToast } from './WorkspaceToast'

vi.mock('./WorkspaceToast', () => ({ showWorkspaceToast: vi.fn() }))
afterEach(() => vi.restoreAllMocks())

describe('optional browser cache access', () => {
  it('round-trips empty values and removes only the requested key in each storage area', () => {
    for (const area of ['localStorage', 'sessionStorage'] as const) {
      expect(readOptionalStorage('optional-absent', area)).toBeNull()
      expect(writeOptionalStorage('optional-value', '', area)).toBe(true)
      expect(readOptionalStorage('optional-value', area)).toBe('')
      window[area].setItem('untouched', 'keep')
      expect(removeOptionalStorage('optional-value', area)).toBe(true)
      expect(readOptionalStorage('optional-value', area)).toBeNull()
      expect(window[area].getItem('untouched')).toBe('keep')
    }
  })

  it('coalesces failed writes and removals into one deferred notice without disclosing keys or values', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('Private value', 'QuotaExceededError') })
    vi.spyOn(sessionStorage, 'removeItem').mockImplementation(() => { throw new DOMException('Private key', 'SecurityError') })
    expect(writeOptionalStorage('private-key', 'private-value')).toBe(false)
    expect(writeOptionalStorage('other-key', 'other-value')).toBe(false)
    expect(removeOptionalStorage('private-key', 'sessionStorage')).toBe(false)
    expect(showWorkspaceToast).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(showWorkspaceToast).toHaveBeenCalledExactlyOnceWith(
      'Browser storage is unavailable. Local preferences may be lost when you reload.',
      { id: 'workspace-storage-unavailable', type: 'error' },
    )
  })

  it('handles a denied storage property getter as well as a denied read', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')!
    try {
      Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new DOMException('Blocked', 'SecurityError') } })
      expect(readOptionalStorage('optional-value')).toBeNull()
      expect(writeOptionalStorage('optional-value', 'next')).toBe(false)
      expect(removeOptionalStorage('optional-value')).toBe(false)
    } finally { Object.defineProperty(window, 'localStorage', descriptor) }
  })

  it('does not hide programming errors or alter the behavior of unrelated identity storage', () => {
    const original = localStorage.getItem.bind(localStorage)
    vi.spyOn(localStorage, 'getItem').mockImplementation(key => {
      if (key === 'identity') throw new DOMException('Identity unavailable', 'SecurityError')
      throw new TypeError('Unexpected read bug')
    })
    expect(() => readOptionalStorage('optional-value')).toThrow('Unexpected read bug')
    expect(() => localStorage.getItem('identity')).toThrow('Identity unavailable')
    expect(original('optional-absent')).toBeNull()
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new TypeError('Unexpected write bug') })
    expect(() => writeOptionalStorage('optional-value', 'next')).toThrow('Unexpected write bug')
  })

  it('leaves JSON serialization errors visible to the caller', () => {
    const circular: { self?: unknown } = {}
    circular.self = circular
    expect(() => writeOptionalStorage('optional-value', JSON.stringify(circular))).toThrow(TypeError)
  })
})
