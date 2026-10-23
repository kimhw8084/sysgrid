import { act, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AssetTopologyCanvas } from './AssetTopologyCanvas'

const captured = vi.hoisted(() => ({ current: null as any, fit: vi.fn() }))
vi.mock('react-force-graph-2d', async () => {
  const { createElement, forwardRef, useImperativeHandle } = await import('react')
  return { default: forwardRef((props: any, ref) => {
    captured.current = props
    useImperativeHandle(ref, () => ({ zoomToFit: captured.fit }), [])
    return createElement('canvas', { width: props.width, height: props.height })
  }) }
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); captured.fit.mockClear() })

it('refits a settled graph after the real canvas size arrives and preserves navigation during selection', () => {
  let resize = () => {}
  let canvasResize = () => {}
  let width = 320
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) {}
    observe(target: HTMLElement) { if (target.tagName === 'CANVAS') canvasResize = this.callback; else resize = this.callback }
    disconnect = disconnect
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height: 300 }) as DOMRect)
  const graph = { nodes: [{ id: 1, name: 'First', x: 0, y: 0 }, { id: 2, name: 'Peer', x: 40, y: 0 }], links: [] }
  const { rerender, unmount } = render(<AssetTopologyCanvas graph={graph} selectedId={1} />)
  act(() => captured.current.onEngineStop())
  expect(captured.fit).toHaveBeenCalledTimes(1)
  width = 832
  act(() => resize())
  expect(captured.current.width).toBe(832)
  expect(captured.fit).toHaveBeenCalledTimes(1)
  act(() => canvasResize())
  expect(captured.fit).toHaveBeenCalledTimes(2)
  rerender(<AssetTopologyCanvas graph={graph} selectedId={2} />)
  act(() => captured.current.onEngineStop())
  expect(captured.fit).toHaveBeenCalledTimes(2)
  width = 309
  act(() => resize())
  act(() => canvasResize())
  expect(captured.fit).toHaveBeenCalledTimes(3)
  unmount()
  expect(disconnect).toHaveBeenCalledTimes(2)
  act(() => canvasResize())
  expect(captured.fit).toHaveBeenCalledTimes(3)
})

it('keeps painted nodes, arrow clipping, and pointer geometry consistent for every selection', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const nodes = [{ id: 1, name: 'Selected', x: 0, y: 0 }, { id: 2, name: 'Peer', x: 40, y: 0 }]
  render(<AssetTopologyCanvas graph={{ nodes, links: [] }} selectedId={1} />)
  const props = captured.current
  const context = { beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillText: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn() } as any
  for (const node of nodes) {
    context.arc.mockClear()
    props.nodeCanvasObject(node, context, 1)
    expect(Math.sqrt(props.nodeVal(node)) * props.nodeRelSize).toBeCloseTo(context.arc.mock.calls[0][2])
    context.moveTo.mockClear()
    props.linkCanvasObject({ source: node, target: { x: node.x + 40, y: 0 }, category: 'network', direction: 'both' }, context)
    expect(context.moveTo.mock.calls[0][0] - node.x).toBe(context.arc.mock.calls[0][2] + 1)
  }
  expect(props.nodeLabel({ name: '<img src=x onerror=alert(1)>', type: 'Physical' })).toContain('&lt;img')
})
