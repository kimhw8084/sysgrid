import React from 'react'
import { AlertCircle, Edit2, Maximize2, MoreVertical, Terminal } from 'lucide-react'
import {
  type OperationalColumnConfig,
  OPERATIONAL_GRID_WIDTHS,
} from '../shared/OperationalGridContract'
import {
  buildOperationalGridColumnDefinitions,
  renderOperationalActionButtons,
} from '../shared/OperationalGridStandard'

export const ASSET_GOLDEN_COLUMN_FIELDS = [
  'name',
  'system',
  'type',
  'status',
  'environment',
  'owner',
  'manufacturer',
  'model',
  'os_name',
  'os_version',
  'primary_ip',
  'management_ip',
  'hardware_summary',
  'hardware_age',
  'open_incident_count',
  'site_name',
  'rack_name',
  'depth',
  'mount_orientation',
  'u_start',
  'size_u',
  'power_typical_w',
  'power_max_w',
  'is_deleted',
  'updated_at',
] as const

export const ASSET_GOLDEN_ALLOWED_COLUMN_FIELDS = new Set<string>(ASSET_GOLDEN_COLUMN_FIELDS)

const ASSET_STATUS_COLORS: Record<string, string> = {
  Active: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  Planned: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  Maintenance: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  Offline: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  Failed: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  Retired: 'bg-slate-500/20 text-slate-300 border-white/15',
  Deleted: 'bg-slate-800 text-slate-400 border-white/5',
}

const ASSET_TYPE_COLORS: Record<string, string> = {
  Physical: 'text-emerald-400',
  Virtual: 'text-blue-400',
  Storage: 'text-amber-400',
  Switch: 'text-rose-400',
  Firewall: 'text-orange-400',
  'Load Balancer': 'text-violet-400',
}

type BuildAssetGoldenColumnsArgs = {
  activeTab: 'inventory' | 'deleted'
  hiddenColumns: string[]
  fontSize: number
  isIntelligenceExpanded: boolean
  columnLayoutState?: any[]
  preserveExplicitColumnWidths?: boolean
  isRecentChange: (asset: any) => boolean
  onOpenQuickLook: (asset: any) => void
  onOpenDetails: (asset: any) => void
  onOpenEdit: (asset: any) => void
  getConsoleUrl: (asset: any) => string | null
  onOpenRowActions: (asset: any, event: React.MouseEvent<HTMLButtonElement>) => void
  onToggleFavorite: (id: number) => void
  onToggleWatch: (id: number) => void
}

export function buildAssetGoldenColumns({
  activeTab,
  hiddenColumns,
  fontSize,
  isIntelligenceExpanded,
  columnLayoutState = [],
  preserveExplicitColumnWidths = false,
  isRecentChange,
  onOpenQuickLook,
  onOpenDetails,
  onOpenEdit,
  getConsoleUrl,
  onOpenRowActions,
  onToggleFavorite,
  onToggleWatch,
}: BuildAssetGoldenColumnsArgs) {
  const columnConfigs: OperationalColumnConfig[] = [
    {
      kind: 'identity',
      field: 'name',
      headerName: 'Instance',
      width: 220,
      minWidth: 180,
      maxWidth: 320,
      hide: hiddenColumns.includes('name'),
    },
    {
      kind: 'plain',
      field: 'system',
      headerName: 'System',
      width: 110,
      hide: hiddenColumns.includes('system'),
      emptyValue: 'Unassigned',
    },
    {
      kind: 'mappedText',
      field: 'type',
      headerName: 'Type',
      width: 90,
      fontSize,
      colorMap: ASSET_TYPE_COLORS,
      hide: hiddenColumns.includes('type'),
      emptyValue: 'Unknown',
    },
    {
      kind: 'mappedBadge',
      field: 'status',
      headerName: 'Status',
      width: 110,
      fontSize,
      colorMap: ASSET_STATUS_COLORS,
      knownValues: Object.keys(ASSET_STATUS_COLORS),
      hide: hiddenColumns.includes('status'),
      emptyValue: 'Unknown',
    },
    {
      kind: 'plain',
      field: 'environment',
      headerName: 'Env',
      width: 80,
      hide: hiddenColumns.includes('environment'),
    },
    {
      kind: 'plain',
      field: 'owner',
      headerName: 'Owner',
      width: 100,
      hide: hiddenColumns.includes('owner'),
      emptyValue: 'Unowned',
    },
    {
      kind: 'plain',
      field: 'manufacturer',
      headerName: 'Make',
      width: 80,
      hide: hiddenColumns.includes('manufacturer'),
    },
    {
      kind: 'plain',
      field: 'model',
      headerName: 'Model',
      width: 90,
      hide: hiddenColumns.includes('model'),
    },
    {
      kind: 'plain',
      field: 'os_name',
      headerName: 'OS',
      width: 80,
      hide: hiddenColumns.includes('os_name'),
    },
    {
      kind: 'plain',
      field: 'os_version',
      headerName: 'Ver',
      width: 60,
      hide: hiddenColumns.includes('os_version'),
    },
    {
      kind: 'plain',
      field: 'primary_ip',
      headerName: 'Primary IP',
      width: 120,
      hide: hiddenColumns.includes('primary_ip'),
    },
    {
      kind: 'plain',
      field: 'management_ip',
      headerName: 'Mgmt IP',
      width: 120,
      hide: hiddenColumns.includes('management_ip'),
    },
    {
      kind: 'prose',
      field: 'hardware_summary',
      headerName: 'Resources',
      width: 150,
      proseMode: 'compact',
      hide: hiddenColumns.includes('hardware_summary'),
      emptyValue: 'No hardware summary',
    },
    {
      kind: 'plain',
      field: 'hardware_age',
      headerName: 'Age',
      width: 80,
      hide: hiddenColumns.includes('hardware_age'),
    },
    {
      kind: 'plain',
      field: 'open_incident_count',
      headerName: 'Health',
      width: 80,
      hide: hiddenColumns.includes('open_incident_count'),
      formatValue: (value: any) => {
        const val = Number(value || 0)
        return val > 0 ? (
          <span className="inline-flex items-center gap-1 rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-400 border border-rose-500/30">
            <AlertCircle size={10} className="animate-pulse" />
            <span className="font-bold text-[10px]">{val}</span>
          </span>
        ) : (
          <span className="text-emerald-500/40 font-bold text-[11px]">✔</span>
        )
      },
    },
    {
      kind: 'plain',
      field: 'site_name',
      headerName: 'Site',
      width: 100,
      hide: hiddenColumns.includes('site_name'),
    },
    {
      kind: 'plain',
      field: 'rack_name',
      headerName: 'Rack',
      width: 80,
      hide: hiddenColumns.includes('rack_name'),
    },
    {
      kind: 'plain',
      field: 'depth',
      headerName: 'Depth',
      width: 70,
      hide: hiddenColumns.includes('depth'),
      formatValue: (value: any) => value || 'Full',
    },
    {
      kind: 'plain',
      field: 'mount_orientation',
      headerName: 'Mount',
      width: 80,
      hide: hiddenColumns.includes('mount_orientation'),
      emptyValue: 'registry',
    },
    {
      kind: 'plain',
      field: 'u_start',
      headerName: 'U Pos',
      width: 60,
      hide: hiddenColumns.includes('u_start'),
      formatValue: (value) => value == null ? 'N/A' : String(value),
    },
    {
      kind: 'plain',
      field: 'size_u',
      headerName: 'Size',
      width: 60,
      hide: hiddenColumns.includes('size_u'),
      formatValue: (value) => value == null ? 'N/A' : `${value}U`,
    },
    {
      kind: 'plain',
      field: 'power_typical_w',
      headerName: 'Avg W',
      width: 70,
      hide: hiddenColumns.includes('power_typical_w'),
      formatValue: (value) => value == null ? 'N/A' : `${Number(value).toFixed(0)}W`,
    },
    {
      kind: 'plain',
      field: 'power_max_w',
      headerName: 'Max W',
      width: 70,
      hide: hiddenColumns.includes('power_max_w'),
      formatValue: (value) => value == null ? 'N/A' : `${Number(value).toFixed(0)}W`,
    },
    {
      kind: 'activeDot',
      field: 'is_deleted',
      headerName: activeTab === 'deleted' ? 'Archived' : 'Live',
      hide: hiddenColumns.includes('is_deleted'),
      getIsDeleted: (params) => Boolean(params.data?.is_deleted),
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
      width: 170,
      renderActions: (asset) => renderOperationalActionButtons(
        <>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onOpenDetails(asset)
            }}
            title="Open details"
            className="rounded-lg p-1 text-blue-400 transition-all hover:bg-blue-400/10 active:scale-90"
          >
            <Maximize2 size={13} />
          </button>
          {activeTab !== 'deleted' ? (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenEdit(asset)
                }}
                title="Edit asset"
                className="rounded-lg p-1 text-emerald-400 transition-all hover:bg-emerald-400/10 active:scale-90"
              >
                <Edit2 size={13} />
              </button>
              {getConsoleUrl(asset) ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    const consoleUrl = getConsoleUrl(asset)
                    if (!consoleUrl) return
                    window.open(consoleUrl, '_blank', 'noopener,noreferrer')
                  }}
                  title="Quick console"
                  className="rounded-lg p-1 text-indigo-400 transition-all hover:bg-indigo-400/10 active:scale-90"
                >
                  <Terminal size={13} />
                </button>
              ) : null}
            </>
          ) : null}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onOpenRowActions(asset, event)
            }}
            title="More actions"
            className="row-action-trigger row-action-menu-container rounded-lg p-1 text-slate-400 transition-all hover:bg-white/10 hover:text-white active:scale-90"
          >
            <MoreVertical size={13} />
          </button>
        </>
      ),
    },
  ]

  return buildOperationalGridColumnDefinitions({
    utilityColumnsConfig: {
      includeRecentChange: activeTab !== 'deleted',
      includeFavorite: activeTab !== 'deleted',
      includeWatch: activeTab !== 'deleted',
      isIntelligenceExpanded,
      isRecentChange,
      onToggleFavorite,
      onToggleWatch,
      itemLabel: 'asset',
    },
    columnConfigs,
    columnLayoutState,
    preserveExplicitColumnWidths,
  })
}
