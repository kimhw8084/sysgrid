import React, { forwardRef, useImperativeHandle } from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OperationalGridMatrix } from './OperationalGridMatrix'

const captured = vi.hoisted(() => ({ props: {} as any }))
vi.mock('ag-grid-react', () => ({
  AgGridReact: forwardRef((props, ref) => {
    captured.props = props
    useImperativeHandle(ref, () => ({ api: {} }))
    return null
  }),
}))
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('defers automatic unpinning outside resize delivery and coalesces the latest decision', () => {
  render(<OperationalGridMatrix />)
  const api = { isDestroyed: () => false, setColumnsPinned: vi.fn() }
  expect(captured.props.processUnpinnedColumns({ columns: ['old'], api })).toEqual([])
  expect(captured.props.processUnpinnedColumns({ columns: ['latest'], api })).toEqual([])
  expect(api.setColumnsPinned).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(16))
  expect(api.setColumnsPinned).toHaveBeenCalledExactlyOnceWith(['latest'], null)
})

it('cancels pending work on unmount and never changes a destroyed grid', () => {
  const { unmount } = render(<OperationalGridMatrix />)
  const api = { isDestroyed: () => true, setColumnsPinned: vi.fn() }
  captured.props.processUnpinnedColumns({ columns: ['column'], api })
  act(() => vi.advanceTimersByTime(16))
  expect(api.setColumnsPinned).not.toHaveBeenCalled()
  captured.props.processUnpinnedColumns({ columns: ['column'], api })
  unmount()
  act(() => vi.advanceTimersByTime(16))
  expect(api.setColumnsPinned).not.toHaveBeenCalled()
})

it('releases wide identity columns before row commands on a narrow viewport', () => {
  render(<OperationalGridMatrix />)
  const column = (id: string, width: number) => ({ getColId: () => id, getActualWidth: () => width })
  const select = column('select', 48), title = column('title', 240), commands = column('row_actions', 96)
  const api = { isDestroyed: () => false, setColumnsPinned: vi.fn(),
    getDisplayedLeftColumns: () => [select, title], getDisplayedRightColumns: () => [commands] }
  captured.props.processUnpinnedColumns({ columns: [commands], api, viewportWidth: 344 })
  act(() => vi.advanceTimersByTime(16))
  expect(api.setColumnsPinned).toHaveBeenCalledExactlyOnceWith([title], null)
})

it('still releases commands if even they cannot fit with the minimum center viewport', () => {
  render(<OperationalGridMatrix />)
  const commands = { getColId: () => 'row_actions', getActualWidth: () => 96 }
  const api = { isDestroyed: () => false, setColumnsPinned: vi.fn(),
    getDisplayedLeftColumns: () => [], getDisplayedRightColumns: () => [commands] }
  captured.props.processUnpinnedColumns({ columns: [commands], api, viewportWidth: 120 })
  act(() => vi.advanceTimersByTime(16))
  expect(api.setColumnsPinned).toHaveBeenCalledExactlyOnceWith([commands], null)
})

it('opens the same row menu from the keyboard context-menu shortcut', () => {
  const onCellContextMenu = vi.fn()
  render(<OperationalGridMatrix onCellContextMenu={onCellContextMenu} />)
  const preventDefault = vi.fn()
  const target = { getBoundingClientRect: () => ({ left: 20, width: 80, bottom: 140 }) }
  captured.props.onCellKeyDown({
    data: { id: 7 },
    event: { key: 'F10', shiftKey: true, target, preventDefault },
  })
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(onCellContextMenu).toHaveBeenCalledOnce()
  expect(onCellContextMenu.mock.calls[0][0].data).toEqual({ id: 7 })
  expect(onCellContextMenu.mock.calls[0][0].event.clientX).toBe(44)
  expect(onCellContextMenu.mock.calls[0][0].event.clientY).toBe(140)
})

it('does not replace ordinary keyboard navigation with a row menu', () => {
  const onCellContextMenu = vi.fn()
  render(<OperationalGridMatrix onCellContextMenu={onCellContextMenu} />)
  const preventDefault = vi.fn()
  captured.props.onCellKeyDown({ event: { key: 'ArrowDown', shiftKey: false, preventDefault } })
  expect(preventDefault).not.toHaveBeenCalled()
  expect(onCellContextMenu).not.toHaveBeenCalled()
})

it('gives phone identities and commands room and restores the configured desktop density', () => {
  let changed: (() => void) | undefined
  const media = { matches: true, addEventListener: vi.fn((_event, listener) => { changed = listener }), removeEventListener: vi.fn() }
  const match = vi.spyOn(window, 'matchMedia').mockReturnValue(media as any)
  const { unmount, rerender } = render(<OperationalGridMatrix fontSize={11} rowDensity={8} />)
  try {
    expect(captured.props.rowHeight).toBe(52)
    media.matches = false
    act(() => changed?.())
    expect(captured.props.rowHeight).toBe(40)
    rerender(<OperationalGridMatrix fontSize={20} rowDensity={8} />)
    expect(captured.props.rowHeight).toBe(40)
    media.matches = true
    act(() => changed?.())
    expect(captured.props.rowHeight).toBe(52)
    unmount()
    expect(media.removeEventListener).toHaveBeenCalledWith('change', changed)
  } finally { match.mockRestore() }
})
