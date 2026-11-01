import React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { AssetGoldenFeatureSurfaces } from './AssetGoldenFeatureSurfaces'

// Mock OperationalDataGrid so we can inspect the props passed to it
vi.mock('../shared/OperationalDataGrid', () => ({
  OperationalDataGrid: vi.fn(({ suppressRowClickSelection, rows }: any) => (
    <div data-testid="mock-operational-grid" data-suppress={String(suppressRowClickSelection)}>
      Mock OperationalDataGrid with {rows?.length || 0} rows
    </div>
  )),
}))

describe('Asset Grid Selection Parity (Blocker C)', () => {
  const renderWithQueryClient = (ui: React.ReactElement) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
  }

  const getMockProps = () => ({
    gridRef: { current: null },
    allAssets: [
      { id: 1, name: 'asset-1', status: 'Active', system: 'Sys-A' },
      { id: 2, name: 'asset-2', status: 'Offline', system: 'Sys-B' },
    ],
    rows: [
      { id: 1, name: 'asset-1', status: 'Active', system: 'Sys-A' },
      { id: 2, name: 'asset-2', status: 'Offline', system: 'Sys-B' },
    ],
    columnDefs: [],
    contextMenu: {},
    dataState: { kind: 'ready' },
    fontSize: 11,
    getRowClass: vi.fn(),
    getRowId: vi.fn(),
    groupBy: 'raw', // 'raw' means ungrouped standard grid layout
    groupOptions: [{ value: 'raw', label: 'Plain Table' }],
    isIntelligenceExpanded: false,
    isRecentChange: vi.fn(),
    isSelected: vi.fn(),
    noRowsLabel: 'No data',
    onAddToCompare: vi.fn(),
    onCloseMenu: vi.fn(),
    onCopyAssetId: vi.fn(),
    onCopyRow: vi.fn(),
    onExportRow: vi.fn(),
    onOpenDetails: vi.fn(),
    onOpenEdit: vi.fn(),
    onOpenMap: vi.fn(),
    onOpenQuickLook: vi.fn(),
    onOpenReport: vi.fn(),
    onOpenReportSection: vi.fn(),
    onOpenRowActions: vi.fn(),
    onRequestConfirm: vi.fn(),
    onSelectionChanged: vi.fn(),
    onSetCollapsedGroups: vi.fn(),
    onToggleFavorite: vi.fn(),
    onToggleWatch: vi.fn(),
    rowDensity: 24,
    rowDeleteConfirmId: null,
    selectedCount: 0,
    selectionScopeKey: 'test-scope',
    setRowDeleteConfirmId: vi.fn(),
    viewMode: 'grid',
    watchIds: [],
    favoriteIds: [],
    collapsedGroups: {},
    runtime: {},
    rowInteractions: {},
  })

  it('proves standard grid instantiation passes suppressRowClickSelection={false} for rich click selection and range selections', () => {
    const props = getMockProps()
    renderWithQueryClient(<AssetGoldenFeatureSurfaces {...props as any} />)

    const grid = screen.getByTestId('mock-operational-grid')
    expect(grid).toBeInTheDocument()

    // Key assertion: Verify suppressRowClickSelection is set to false!
    // This allows clicking on rows, Ctrl/Cmd selection, and Shift range-selection to work exactly like the golden grid.
    expect(grid.getAttribute('data-suppress')).toBe('false')
  })

  it('proves grouped grid sections also render with suppressRowClickSelection={false}', () => {
    const props = getMockProps()
    props.groupBy = 'system'
    props.groupOptions = [{ value: 'system', label: 'System Grouping' }]
    props.collapsedGroups = { 'Sys-A': false }

    renderWithQueryClient(<AssetGoldenFeatureSurfaces {...props as any} />)

    const grids = screen.getAllByTestId('mock-operational-grid')
    expect(grids.length).toBeGreaterThan(0)

    // Key assertion for grouped rows
    expect(grids[0].getAttribute('data-suppress')).toBe('false')
  })
})
