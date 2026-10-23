import { render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AssetTopologyCanvas } from './AssetTopologyCanvas'

const captured = vi.hoisted(() => ({ current: null as any }))
vi.mock('react-force-graph-2d', () => ({ default: (props: any) => { captured.current = props; return null } }))
afterEach(() => vi.unstubAllGlobals())

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
