import React, { useLayoutEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import AssetGoldenOperationalWorkspace from './AssetGoldenOperationalWorkspace'

const fixture = vi.hoisted(() => ({
  selected: new Set<number>(),
  pendingClick: false,
  props: null as any,
  api: null as any,
  rows: [{ id: 1, name: 'First', system: 'Selection', status: 'Active', type: 'Physical' }, { id: 2, name: 'Second', system: 'Selection', status: 'Active', type: 'Physical' }],
}))

vi.mock('../../api/apiClient', () => ({ apiFetch: vi.fn(async (path: string) => ({ ok: true, json: async () => path.includes('include_deleted=true') ? fixture.rows : [] })) }))
vi.mock('./AssetGoldenShellScaffold', () => ({ default: ({ children }: any) => children }))
vi.mock('./AssetGoldenDialogs', () => ({ AssetGoldenDialogs: () => null }))
vi.mock('../shared/OperationalBulkPreviewModal', () => ({ OperationalBulkPreviewModal: () => null }))
vi.mock('./AssetCompareModal', () => ({ AssetCompareModal: () => null }))
vi.mock('./assetGoldenColumns', () => ({ buildAssetGoldenColumns: () => [] }))
vi.mock('../shared/WorkspaceToast', () => ({ dismissWorkspaceToasts: vi.fn(), showWorkspaceToast: vi.fn() }))
vi.mock('./AssetGoldenFeatureSurfaces', () => ({
  AssetGoldenFeatureSurfaces: (props: any) => {
    fixture.props = props
    props.gridRef.current = { api: fixture.api }
    useLayoutEffect(() => {
      if (fixture.pendingClick) {
        // The grid has accepted a second click. Its asynchronous
        // selectionChanged callback has not reached the parent yet.
        fixture.selected.add(2)
        fixture.pendingClick = false
      }
    }, [props.rows])
    return null
  },
}))

it('does not overwrite a newer grid selection with React state from before a row refresh', async () => {
  localStorage.clear()
  fixture.selected.clear()
  fixture.props = null
  fixture.pendingClick = false
  const nodes = fixture.rows.map(data => ({ data, setSelected: (selected: boolean) => selected ? fixture.selected.add(data.id) : fixture.selected.delete(data.id) }))
  fixture.api = {
    deselectAll: () => fixture.selected.clear(),
    forEachNode: (visit: (node: any) => void) => nodes.forEach(visit),
    getSelectedNodes: () => nodes.filter(node => fixture.selected.has(node.data.id)),
    refreshCells: vi.fn(), onSortChanged: vi.fn(),
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(<MemoryRouter><QueryClientProvider client={client}><AssetGoldenOperationalWorkspace /></QueryClientProvider></MemoryRouter>)
  try {
    await waitFor(() => expect(fixture.props.rows).toHaveLength(2))
    act(() => {
      fixture.selected.add(1)
      fixture.props.onSelectionChanged({ api: fixture.api })
    })
    expect(fixture.props.isSelected(1)).toBe(true)
    fixture.pendingClick = true
    act(() => client.setQueryData(['asset-golden-devices'], fixture.rows.map(row => ({ ...row, description: 'Refreshed data' }))))
    await waitFor(() => expect(fixture.pendingClick).toBe(false))
    expect([...fixture.selected]).toEqual([1, 2])
    act(() => fixture.props.onSelectionChanged({ api: fixture.api }))
    expect(fixture.props.isSelected(1)).toBe(true)
    expect(fixture.props.isSelected(2)).toBe(true)
  } finally { view.unmount(); client.clear() }
})
