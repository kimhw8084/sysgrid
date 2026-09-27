import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssetBulkActionsPanel } from './AssetBulkActionsPanel'
import { OPERATIONAL_ACTION_LABELS } from '../shared/OperationalActionLabels'

// Mock framer-motion to simplify rendering in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, style, className, ...props }: any) => (
      <div style={style} className={className} {...props}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

describe('AssetBulkActionsPanel', () => {
  const defaultProps = {
    activeTab: 'inventory' as const,
    isOpen: true,
    panelRef: { current: null } as React.RefObject<HTMLDivElement | null>,
    panelStyle: {},
    selectedCount: 5,
    selectedLabels: ['asset-1', 'asset-2', 'asset-3', 'asset-4'],
    onClose: vi.fn(),
    onApply: vi.fn(),
  }

  it('renders status summary with correct count and previews first 3 labels with suffix', () => {
    render(<AssetBulkActionsPanel {...defaultProps} />)

    expect(screen.getByText('5 assets selected')).toBeInTheDocument()
    expect(screen.getByText('asset-1, asset-2, asset-3 +2 more')).toBeInTheDocument()
  })

  it('inventory state renders top-level cards for Set Status, Set Environment, and Archive Selection', () => {
    render(<AssetBulkActionsPanel {...defaultProps} />)

    expect(screen.getByText('Set Status')).toBeInTheDocument()
    expect(screen.getByText('Set Environment')).toBeInTheDocument()
    expect(screen.getByText(OPERATIONAL_ACTION_LABELS.archiveSelection)).toBeInTheDocument()
  })

  it('clicking Archive Selection expands the preview-first action and submits preview once', () => {
    render(<AssetBulkActionsPanel {...defaultProps} />)

    expect(screen.queryByText('Archive moves these assets out of the active list while keeping them available to restore.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText(OPERATIONAL_ACTION_LABELS.archiveSelection))

    expect(screen.getByText('Archive moves these assets out of the active list while keeping them available to restore.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Preview Archive' }))
    expect(defaultProps.onApply).toHaveBeenCalledWith('delete')
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('deleted state renders Restore and Purge cards', () => {
    render(<AssetBulkActionsPanel {...defaultProps} activeTab="deleted" />)

    expect(screen.getByText(OPERATIONAL_ACTION_LABELS.restore)).toBeInTheDocument()
    expect(screen.getByText(OPERATIONAL_ACTION_LABELS.purgeSelection)).toBeInTheDocument()
  })

  it('Restore expands a preview-first action and submits preview once', () => {
    const onApplyMock = vi.fn()
    const onCloseMock = vi.fn()
    render(
      <AssetBulkActionsPanel
        {...defaultProps}
        activeTab="deleted"
        onApply={onApplyMock}
        onClose={onCloseMock}
      />
    )

    fireEvent.click(screen.getByText(OPERATIONAL_ACTION_LABELS.restore))
    expect(screen.getByText('Preview the exact records that can return to the Existing registry scope.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Preview Restore' }))
    expect(onApplyMock).toHaveBeenCalledWith('restore')
    expect(onCloseMock).toHaveBeenCalled()
  })

  it('Purge expands an irreversible preview-first action and submits preview once', () => {
    const onApplyMock = vi.fn()
    const onCloseMock = vi.fn()
    render(
      <AssetBulkActionsPanel
        {...defaultProps}
        activeTab="deleted"
        onApply={onApplyMock}
        onClose={onCloseMock}
      />
    )

    fireEvent.click(screen.getByText(OPERATIONAL_ACTION_LABELS.purgeSelection))
    expect(screen.getByText('Preview permanent removal and its exact record impact. This action cannot be undone.'))
      .toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Preview Permanent Purge' }))
    expect(onApplyMock).toHaveBeenCalledWith('purge')
    expect(onCloseMock).toHaveBeenCalled()
  })

  it('expanding one destructive section replaces the prior preview action', () => {
    render(<AssetBulkActionsPanel {...defaultProps} activeTab="deleted" />)

    fireEvent.click(screen.getByText(OPERATIONAL_ACTION_LABELS.restore))
    expect(screen.getByRole('button', { name: 'Preview Restore' })).toBeInTheDocument()

    fireEvent.click(screen.getByText(OPERATIONAL_ACTION_LABELS.purgeSelection))

    expect(screen.queryByRole('button', { name: 'Preview Restore' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview Permanent Purge' })).toBeInTheDocument()
  })
})
