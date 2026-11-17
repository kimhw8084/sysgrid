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

it('uses the active theme color for links and both arrow directions', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const root = document.documentElement
  root.style.setProperty('--topology-network', '#087f8c')
  root.style.setProperty('--topology-dependency', '#6d28d9')
  try {
    render(<AssetTopologyCanvas graph={{ nodes: [], links: [] }} />)
    const props = captured.current
    expect(props.linkColor({ category: 'network' })).toBe('#087f8c')
    expect(props.linkColor({ category: 'relationship' })).toBe('#6d28d9')
    const context = { beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), fillStyle: '' } as any
    props.linkCanvasObject({ source: { x: 0, y: 0 }, target: { x: 40, y: 0 }, direction: 'reverse', category: 'network' }, context)
    expect(context.fillStyle).toBe('#087f8c')
  } finally {
    root.style.removeProperty('--topology-network')
    root.style.removeProperty('--topology-dependency')
  }
})

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
  const context = { beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillText: vi.fn(), measureText: (value: string) => ({ width: value.length * 7 }), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn() } as any
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

it('places selected work-signal labels below the node marker', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const selected = { id: 1, name: 'Selected service', x: 40, y: 50, workSignal: { level: 'scheduled' } }
  const peer = { id: 2, name: 'Connected peer', x: 180, y: 50, workSignal: { level: 'none' } }
  render(<AssetTopologyCanvas graph={{ nodes: [selected, peer], links: [] }} selectedId={selected.id} />)
  const props = captured.current
  const layoutContext = { save: vi.fn(), restore: vi.fn(), measureText: (value: string) => ({ width: value.length * 6 }), font: '' } as any
  props.onRenderFramePre(layoutContext, 1)
  const paintContext = {
    beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
    measureText: (value: string) => ({ width: value.length * 6 }),
    fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '', font: '',
  } as any
  props.nodeCanvasObject(selected, paintContext, 1)
  expect(paintContext.fillRect).toHaveBeenCalledOnce()
  expect(paintContext.fillRect.mock.calls[0][1]).toBeGreaterThanOrEqual(selected.y + 12)
})

it('keeps topology labels clear of every node marker', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 320, height: 300 } as DOMRect)
  const selected = { id: 1, name: 'Selected', x: 40, y: 50 }
  const nearby = { id: 2, name: 'Nearby', x: 55, y: 65 }
  render(<AssetTopologyCanvas graph={{ nodes: [selected, nearby], links: [] }} selectedId={selected.id} />)
  const props = captured.current
  const context = { save: vi.fn(), restore: vi.fn(), measureText: (value: string) => ({ width: value.length * 6 }), font: '' } as any
  props.onRenderFramePre(context, 1)
  const paintContext = {
    beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
    measureText: (value: string) => ({ width: value.length * 6 }),
    fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '', font: '',
  } as any
  props.nodeCanvasObject(selected, paintContext, 1)
  expect(paintContext.fillText).not.toHaveBeenCalled()
  props.nodeCanvasObject(nearby, paintContext, 1)
  expect(paintContext.fillText).toHaveBeenCalledOnce()
  expect(paintContext.fillText.mock.calls[0][0]).toBe('Nearby')
})
