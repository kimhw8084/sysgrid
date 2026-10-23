import React, { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssetLegacyReportSurface } from './AssetLegacyReportSurface'

vi.mock('react-force-graph-2d', () => ({ default: () => null }))
vi.mock('../AssetGrid_Legacy', () => ({ AssetServicesTable: () => null, MetadataViewer: () => null, MiniMonitoringTable: () => null }))
vi.mock('./AssetDetailsView', () => ({ HWTable: () => null, RelationshipsTab: () => null, SecretsTable: () => null }))
const assets = [1, 2].map(id => ({ id, name: `Asset ${id}`, type: 'Physical', status: 'Active', environment: 'Production' }))
const props = { assets, allAssets: assets, options: [], connections: [], relationships: [], onEdit: vi.fn(), onViewServiceDetails: vi.fn(), onEditService: vi.fn() }

describe('Asset report selection ownership', () => {
  it('can filter valid creation choices and recorded legacy values without silently losing records', () => {
    const records = [
      { id: 1, name: 'Standby power', type: 'PDU', status: 'Standby', environment: 'Dev' },
      { id: 2, name: 'Planned recovery', type: 'UPS', status: 'Planned', environment: 'DR' },
      { id: 3, name: 'Historical appliance', type: 'Appliance', status: 'Retired state', environment: 'Legacy zone' },
    ]
    render(<AssetLegacyReportSurface {...props} assets={records} allAssets={records} />)
    for (const [label, values] of [
      ['Report asset type', ['PDU', 'UPS', 'Console-Server', 'Patch Panel', 'Appliance']],
      ['Report status', ['Planned', 'Standby', 'Decommissioned', 'Retired state']],
      ['Report environment', ['Dev', 'QA', 'DR', 'Sandbox', 'Legacy', 'Legacy zone']],
    ] as const) {
      const select = screen.getByRole('combobox', { name: label })
      for (const value of values) expect(within(select).getByRole('option', { name: value })).toHaveValue(value)
    }
    fireEvent.change(screen.getByRole('combobox', { name: 'Report environment' }), { target: { value: 'DR' } })
    expect(screen.getByRole('heading', { name: 'Planned recovery', level: 1 })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Standby power/ })).not.toBeInTheDocument()
  })

  it('selects another entry once without a parent/child feedback loop', () => {
    const changes = vi.fn()
    function Controlled() {
      const [id, setId] = useState(1)
      return <AssetLegacyReportSurface {...props} selectedAssetId={id} onSelectAsset={asset => {
        changes(asset.id)
        if (changes.mock.calls.length > 6) throw new Error('Report selection feedback loop')
        setId(asset.id)
      }} />
    }
    render(<Controlled />)
    changes.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /Asset 2/i }))
    expect(screen.getByRole('heading', { name: 'Asset 2', level: 1 })).toBeVisible()
    expect(changes.mock.calls.map(([id]) => id)).toEqual([2])
  })

  it('honors external selection changes without replaying them as user choices', () => {
    const onSelectAsset = vi.fn()
    const view = render(<AssetLegacyReportSurface {...props} selectedAssetId={1} onSelectAsset={onSelectAsset} />)
    onSelectAsset.mockClear()
    view.rerender(<AssetLegacyReportSurface {...props} selectedAssetId={2} onSelectAsset={onSelectAsset} />)
    expect(screen.getByRole('heading', { name: 'Asset 2', level: 1 })).toBeVisible()
    expect(onSelectAsset).not.toHaveBeenCalled()
  })
})
