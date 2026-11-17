import React from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const gridCapture = vi.hoisted(() => ({ props: null as any }))

vi.mock('ag-grid-react', () => ({
  AgGridReact: (props: any) => {
    gridCapture.props = props
    return <div data-testid="ag-grid" />
  },
}))

import { OperationalAgGrid } from './OperationalAgGrid'

describe('OperationalAgGrid width persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    gridCapture.props = null
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists and restores user drag widths even when a parent resize handler is present', () => {
    const onColumnResized = vi.fn()
    const columnDefs = [{ field: 'name' }, { field: 'type' }]
    const columnState = [
      { colId: 'name', width: 264 },
      { colId: 'type', width: 128 },
    ]

    const first = render(<OperationalAgGrid columnDefs={columnDefs} onColumnResized={onColumnResized} />)
    act(() => gridCapture.props.onColumnResized({
      finished: true,
      source: 'uiColumnDragged',
      api: { getColumnState: () => columnState },
    }))

    expect(onColumnResized).toHaveBeenCalledOnce()
    const storageKey = `sysgrid:operational-grid-widths:v1:${window.location.pathname}:name|type`
    expect(JSON.parse(localStorage.getItem(storageKey) || 'null')).toEqual({ version: 1, columns: columnState })
    first.unmount()

    const second = render(<OperationalAgGrid columnDefs={columnDefs} onColumnResized={vi.fn()} />)
    const applyColumnState = vi.fn()
    act(() => gridCapture.props.onGridReady({ api: { applyColumnState } }))
    expect(applyColumnState).toHaveBeenCalledWith({ state: columnState, applyOrder: false })
    second.unmount()
  })

  it('clamps a saved width against a newer explicit column minimum before restoring it', () => {
    const columnDefs = [{ field: 'environment', width: 92, minWidth: 92, operationalMinimumWidth: 92 }]
    const storageKey = `sysgrid:operational-grid-widths:v1:${window.location.pathname}:environment`
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, columns: [{ colId: 'environment', width: 52 }] }))

    render(<OperationalAgGrid columnDefs={columnDefs} onColumnResized={vi.fn()} />)
    const applyColumnState = vi.fn()
    const getColumn = vi.fn(() => ({ getColDef: () => ({ minWidth: 92 }) }))

    act(() => gridCapture.props.onGridReady({ api: { applyColumnState, getColumn } }))

    expect(getColumn).toHaveBeenCalledWith('environment')
    expect(applyColumnState).toHaveBeenCalledWith({
      state: [{ colId: 'environment', width: 92 }],
      applyOrder: false,
    })
  })

  it('does not persist programmatic autosize events', () => {
    const columnDefs = [{ field: 'name' }]
    render(<OperationalAgGrid columnDefs={columnDefs} onColumnResized={vi.fn()} />)

    act(() => gridCapture.props.onColumnResized({
      finished: true,
      source: 'autosizeColumns',
      api: { getColumnState: () => [{ colId: 'name', width: 300 }] },
    }))

    expect(localStorage.length).toBe(0)
  })
})
