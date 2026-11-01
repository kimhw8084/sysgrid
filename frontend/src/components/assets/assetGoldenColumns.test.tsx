import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildAssetGoldenColumns } from './assetGoldenColumns'

describe('AssetGoldenColumns Hardening', () => {
  const getMockArgs = () => {
    return {
      activeTab: 'inventory' as const,
      hiddenColumns: [],
      fontSize: 11,
      isIntelligenceExpanded: false,
      isRecentChange: vi.fn().mockReturnValue(false),
      onOpenQuickLook: vi.fn(),
      onOpenDetails: vi.fn(),
      onOpenEdit: vi.fn(),
      getConsoleUrl: vi.fn().mockReturnValue('http://test-console-url'),
      onOpenRowActions: vi.fn(),
      onToggleFavorite: vi.fn(),
      onToggleWatch: vi.fn(),
    }
  }

  it('starts the status column at a readable width while allowing the shared minimum and unlimited growth', () => {
    const statusColumn = buildAssetGoldenColumns(getMockArgs()).find((column: any) => column.field === 'status')
    expect(statusColumn?.initialWidth).toBe(132)
    expect(statusColumn?.minWidth).toBe(40)
    expect(statusColumn).not.toHaveProperty('maxWidth')
    expect(statusColumn?.resizable).toBe(true)
  })

  it('keeps the first six Asset columns within the initial desktop viewport budget without fixing their widths', () => {
    const columns = buildAssetGoldenColumns(getMockArgs())
    const coreFields = ['name', 'system', 'type', 'status', 'environment', 'owner']
    const totalInitialWidth = coreFields.reduce((total, field) => {
      const column = columns.find((candidate: any) => candidate.field === field) as any
      return total + Number(column?.initialWidth ?? column?.width ?? 0)
    }, 0)
    expect(totalInitialWidth).toBeLessThanOrEqual(794)
  })

  it('renders a theme-aware, accessible health indicator when there are no open incidents', () => {
    const healthColumn = buildAssetGoldenColumns(getMockArgs()).find((column: any) => column.field === 'open_incident_count')
    const { cellRenderer } = healthColumn as any
    render(<>{cellRenderer({ value: 0, data: { id: 42 } })}</>)

    const indicator = screen.getByRole('img', { name: 'No open incidents' })
    expect(indicator).toHaveTextContent('✔')
    expect(indicator).toHaveClass('text-[var(--state-success)]')
    expect(indicator).not.toHaveClass('text-emerald-500/40')
  })

  it('proves name/Instance identity column renders a non-button plain text element and does not call details trigger on click', () => {
    const args = getMockArgs()
    const columns = buildAssetGoldenColumns(args)

    // 1. Find the identity column (Instance / name)
    const identityCol = columns.find((col: any) => col.field === 'name')
    expect(identityCol).toBeDefined()
    expect(identityCol?.headerName).toBe('Instance')

    // 2. Render its cell renderer output
    const value = 'db-primary-01'
    const mockData = { id: 42, name: value }
    const cellElement = identityCol?.cellRenderer({ value, data: mockData })
    
    const { container } = render(<>{cellElement}</>)

    // Verify it rendered a plain span, NOT a button
    const span = container.querySelector('span')
    expect(span).toBeInTheDocument()
    expect(span).toHaveTextContent('db-primary-01')
    
    const button = container.querySelector('button')
    expect(button).toBeNull()

    // 3. Proves clicking it does NOT call onOpenDetails
    if (span) {
      fireEvent.click(span)
    }
    expect(args.onOpenDetails).not.toHaveBeenCalled()
  })

  it('proves the action column contains an explicit open details button that fires onOpenDetails when clicked', () => {
    const args = getMockArgs()
    const columns = buildAssetGoldenColumns(args)

    // 1. Find the action column
    const actionCol = columns.find((col: any) => col.colId === 'row_actions')
    expect(actionCol).toBeDefined()

    // 2. Render its action buttons
    const mockData = { id: 42, name: 'db-primary-01' }
    const actionsElement = actionCol?.cellRenderer({ data: mockData })
    render(<>{actionsElement}</>)

    // 3. Verify Open details action button exists and is clickable
    const openDetailsButton = screen.getByTitle('Open details')
    expect(openDetailsButton).toBeInTheDocument()

    // 4. Click the button and prove it invokes onOpenDetails with the correct asset data
    fireEvent.click(openDetailsButton)
    expect(args.onOpenDetails).toHaveBeenCalledWith(mockData)
  })

  it('proves intelligence expanded/collapsed mode changes actual utility/column output in a meaningful way', () => {
    const argsCollapsed = getMockArgs()
    argsCollapsed.isIntelligenceExpanded = false
    const columnsCollapsed = buildAssetGoldenColumns(argsCollapsed)

    const argsExpanded = getMockArgs()
    argsExpanded.isIntelligenceExpanded = true
    const columnsExpanded = buildAssetGoldenColumns(argsExpanded)

    // Utility columns expected to toggle hide state
    const utilityFields = ['recent_change', 'favorite', 'watch']

    utilityFields.forEach((field) => {
      const colCollapsed = columnsCollapsed.find((col: any) => col.colId === field)
      const colExpanded = columnsExpanded.find((col: any) => col.colId === field)

      expect(colCollapsed).toBeDefined()
      expect(colExpanded).toBeDefined()

      // When collapsed, hide should be true
      expect(colCollapsed?.hide).toBe(true)

      // When expanded, hide should be false
      expect(colExpanded?.hide).toBe(false)
    })
  })
})
