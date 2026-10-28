import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssetMapSurface } from './AssetMapSurface'

vi.mock('./AssetTopologyCanvas', () => ({ AssetTopologyCanvas: ({ graph }: any) => <div role="img" aria-label={`${graph.nodes.length} drawn assets`} /> }))
const assets = [{ id: 1, name: 'Primary', system: 'ERP', type: 'Physical', status: 'Active' }, { id: 2, name: 'Peer', system: 'ERP', type: 'Switch' }]
const props = { assets, visibleAssets: assets, connections: [{ id: 1, source_device_id: 1, target_device_id: 2 }], relationships: [], systemsList: ['ERP'] }

describe('Asset map interactions', () => {
  it('clears external selection without immediately reseeding it on a parent render', () => {
    const view = render(<AssetMapSurface {...props} selectedAssetId={1} />)
    expect(screen.getByRole('img', { name: '2 drawn assets' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear selections' }))
    view.rerender(<AssetMapSurface {...props} visibleAssets={[...assets]} selectedAssetId={1} />)
    expect(screen.getByText('Choose where to start')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    view.rerender(<AssetMapSurface {...props} selectedAssetId={2} />)
    expect(screen.getByRole('img', { name: '2 drawn assets' })).toBeInTheDocument()
  })

  it('clears the focused asset when the last starting asset is deselected', () => {
    render(<AssetMapSurface {...props} selectedAssetId={1} />)
    const filters = screen.getByRole('complementary', { name: 'Map filters' })
    const primary = within(filters).getByRole('button', { name: 'Primary' })
    expect(primary).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: 'Selected asset' })).toBeInTheDocument()

    fireEvent.click(primary)

    expect(primary).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('region', { name: 'Selected asset' })).not.toBeInTheDocument()
    expect(screen.getByText('Choose where to start')).toBeInTheDocument()
  })

  it('keeps another selected start focused when the current start is removed', () => {
    render(<AssetMapSurface {...props} selectedAssetId={1} />)
    const filters = screen.getByRole('complementary', { name: 'Map filters' })
    const startSection = within(filters).getByText('Starting assets').closest('details')
    expect(startSection).not.toBeNull()
    fireEvent.click(startSection!.querySelector('summary')!)
    const primary = within(filters).getByRole('button', { name: 'Primary' })
    const peer = within(filters).getByRole('button', { name: 'Peer' })

    fireEvent.click(peer)
    expect(peer).toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByRole('region', { name: 'Selected asset' })).getByRole('heading', { name: 'Peer' })).toBeVisible()

    fireEvent.click(peer)
    expect(peer).toHaveAttribute('aria-pressed', 'false')
    expect(primary).toHaveAttribute('aria-pressed', 'true')
    expect(startSection).toHaveTextContent('1 selected')
    expect(within(screen.getByRole('region', { name: 'Selected asset' })).getByRole('heading', { name: 'Primary' })).toBeVisible()
  })

  it('opens and edits the exact selected connected asset using keyboard-accessible controls', () => {
    const onOpenDetails = vi.fn(), onEdit = vi.fn()
    render(<AssetMapSurface {...props} selectedAssetId={1} onOpenDetails={onOpenDetails} onEdit={onEdit} />)
    fireEvent.click(within(screen.getByRole('region', { name: 'Connected assets' })).getByRole('button', { name: 'Peer' }))
    expect(within(screen.getByRole('region', { name: 'Selected asset' })).getByRole('heading', { name: 'Peer' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Open asset details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit asset' }))
    expect(onOpenDetails).toHaveBeenCalledWith(assets[1])
    expect(onEdit).toHaveBeenCalledWith(assets[1])
  })
})
