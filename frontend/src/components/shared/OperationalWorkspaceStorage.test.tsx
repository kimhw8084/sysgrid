import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useOperationalWorkspaceViewState,
  usePersistentJsonState,
  useWorkspaceSessionValue,
} from './OperationalWorkspaceHooks'

afterEach(() => vi.restoreAllMocks())

describe('optional workspace persistence failures', () => {
  it.each(['QuotaExceededError', 'SecurityError'])('keeps state usable when a preference write throws %s', name => {
    const key = `optional-workspace-${name}`
    localStorage.removeItem(key)
    const original = localStorage.setItem.bind(localStorage)
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key.startsWith('optional-workspace-')) throw new DOMException('Browser storage unavailable', name)
      return original(key, value)
    })
    const { result } = renderHook(() => usePersistentJsonState<number[]>(key, []))
    act(() => result.current[1]([7]))
    expect(result.current[0]).toEqual([7])
    expect(write).toHaveBeenCalledTimes(2)
    write.mockRestore()
    act(() => result.current[1]([7, 9]))
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual([7, 9])
  })

  it('uses first-load state when the optional session marker is blocked', () => {
    const original = sessionStorage.getItem.bind(sessionStorage)
    const read = vi.spyOn(sessionStorage, 'getItem').mockImplementation((key) => {
      if (key === 'optional-session') throw new DOMException('Blocked', 'SecurityError')
      return original(key)
    })
    const next = vi.fn(() => 'restored')
    const { result } = renderHook(() => useWorkspaceSessionValue('optional-session', 'initial', next))
    expect(result.current[0]).toBe('initial')
    expect(next).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledWith('optional-session')
    act(() => result.current[1]('changed'))
    expect(result.current[0]).toBe('changed')
  })

  it('preserves the existing first-load and subsequent-load behavior with working session storage', () => {
    sessionStorage.removeItem('working-session')
    const next = vi.fn(() => 'restored')
    const first = renderHook(() => useWorkspaceSessionValue('working-session', 'initial', next))
    expect(first.result.current[0]).toBe('initial')
    expect(next).not.toHaveBeenCalled()
    first.unmount()
    const second = renderHook(() => useWorkspaceSessionValue('working-session', 'initial', next))
    expect(second.result.current[0]).toBe('restored')
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('keeps view selection and reset usable when removing the cached selection is blocked', () => {
    const original = localStorage.removeItem.bind(localStorage)
    const remove = vi.spyOn(localStorage, 'removeItem').mockImplementation((key) => {
      if (key === 'optional-active-view') throw new DOMException('Blocked', 'SecurityError')
      return original(key)
    })
    const { result } = renderHook(() => useOperationalWorkspaceViewState({
      savedViewsStorageKey: 'optional-saved-views', activeViewStorageKey: 'optional-active-view',
      sessionKey: 'optional-view-session', workingStateStorageKey: 'optional-working-state',
      initialSavedViews: [], initialWorkingState: { search: '' },
    }))
    act(() => result.current.setActiveViewId('view-1'))
    expect(result.current.activeViewId).toBe('view-1')
    act(() => result.current.setActiveViewId(null))
    expect(result.current.activeViewId).toBeNull()
    expect(remove).toHaveBeenCalledWith('optional-active-view')
  })
})
