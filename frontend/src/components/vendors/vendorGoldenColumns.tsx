import type { ReactNode } from 'react'
import type { OperationalColumnConfig } from '../shared/OperationalGridContract'
import { OPERATIONAL_GRID_WIDTHS } from '../shared/OperationalGridContract'
import { buildOperationalGridColumnDefinitions } from '../shared/OperationalGridStandard'
import type { VendorTableRow } from './vendorGoldenTypes'
import { applyOperationalHeaderWidthBounds } from '../shared/operationalHeaderWidthBounds'

type VendorGoldenColumnOptions = {
  fontSize: number
  hiddenColumns: string[]
  columnLayoutState: any[]
  preserveExplicitColumnWidths: boolean
  isIntelligenceExpanded: boolean
  isRecentChange: (vendor: VendorTableRow) => boolean
  onToggleFavorite: (id: number) => void
  onToggleWatch: (id: number) => void
  renderPrimaryRowActions: (vendor: VendorTableRow) => ReactNode
}

/**
 * The single Vendor table contract used by raw and grouped modes.
 * It intentionally uses the same operational column factory as Monitoring/Services.
 */
export function buildVendorGoldenColumns({
  fontSize,
  hiddenColumns,
  columnLayoutState,
  preserveExplicitColumnWidths,
  isIntelligenceExpanded,
  isRecentChange,
  onToggleFavorite,
  onToggleWatch,
  renderPrimaryRowActions,
}: VendorGoldenColumnOptions) {
  const columnConfigs: OperationalColumnConfig[] = [
    {
      kind: 'identity',
      field: 'name',
      headerName: 'Vendor Name',
      width: 220,
      minWidth: 180,
      maxWidth: 220,
      hide: hiddenColumns.includes('name'),
    },
    {
      kind: 'plain',
      field: 'country',
      headerName: 'Country',
      width: 136,
      minWidth: 136,
      maxWidth: 136,
      emptyValue: 'Unspecified',
      hide: hiddenColumns.includes('country'),
    },
    {
      kind: 'plain',
      field: 'primary_personnel_name',
      headerName: 'Primary Contact',
      width: 180,
      minWidth: 180,
      maxWidth: 200,
      emptyValue: 'Unassigned',
      hide: hiddenColumns.includes('primary_personnel_name'),
    },
    {
      kind: 'actionLink',
      field: 'primary_personnel_email',
      headerName: 'Contact Email',
      width: 190,
      minWidth: 190,
      maxWidth: 200,
      fontSize,
      emptyValue: 'No email',
      onActivate: (params) => {
        const value = String(params.value || '').trim()
        if (value && typeof window !== 'undefined') window.location.href = `mailto:${value}`
      },
      hide: hiddenColumns.includes('primary_personnel_email'),
    },
    {
      kind: 'plain',
      field: 'active_contract_count',
      headerName: 'Active Contracts',
      width: 210,
      minWidth: 210,
      filter: 'agNumberColumnFilter',
      emptyValue: '0',
      formatValue: (value) => String(value ?? 0),
      valueClassName: 'font-semibold text-emerald-300',
      hide: hiddenColumns.includes('active_contract_count'),
    },
    {
      kind: 'plain',
      field: 'contract_count',
      headerName: 'Total Contracts',
      width: 210,
      minWidth: 210,
      filter: 'agNumberColumnFilter',
      emptyValue: '0',
      formatValue: (value) => String(value ?? 0),
      hide: hiddenColumns.includes('contract_count'),
    },
    {
      kind: 'date',
      field: 'earliest_expiry_date',
      headerName: 'Earliest Expiry',
      width: 180,
      hide: hiddenColumns.includes('earliest_expiry_date'),
    },
    {
      kind: 'plain',
      field: 'personnel_count',
      headerName: 'Personnel',
      width: 120,
      filter: 'agNumberColumnFilter',
      emptyValue: '0',
      formatValue: (value) => String(value ?? 0),
      hide: hiddenColumns.includes('personnel_count'),
    },
    {
      kind: 'date',
      field: 'created_at',
      headerName: 'Created',
      width: 180,
      hide: hiddenColumns.includes('created_at'),
    },
    {
      kind: 'date',
      field: 'updated_at',
      headerName: 'Updated',
      width: 180,
      hide: hiddenColumns.includes('updated_at'),
    },
    {
      kind: 'action',
      width: OPERATIONAL_GRID_WIDTHS.standardAction,
      renderActions: renderPrimaryRowActions,
    },
  ]

  return buildOperationalGridColumnDefinitions({
    utilityColumnsConfig: {
      includeRecentChange: true,
      includeFavorite: true,
      includeWatch: true,
      isIntelligenceExpanded,
      isRecentChange,
      onToggleFavorite,
      onToggleWatch,
      itemLabel: 'vendor',
    },
    // Reserve the header controls' space for the measured Vendor labels.
    columnConfigs: applyOperationalHeaderWidthBounds(columnConfigs, {
      country: { minWidth: 136, maxWidth: 136 },
      primary_personnel_name: { minWidth: 192 },
      personnel_count: { minWidth: 144 },
    }),
    columnLayoutState,
    preserveExplicitColumnWidths,
  })
}
