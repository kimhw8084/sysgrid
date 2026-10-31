import type { ReactNode } from 'react'

export const OPERATIONAL_GRID_CLASSES = {
  utilityCell: 'operational-grid-utility-cell',
  utilityHeader: 'operational-grid-utility-header',
  selectCell: 'operational-grid-utility-cell operational-grid-select-cell',
  selectHeader: 'operational-grid-utility-header operational-grid-select-header',
  favoriteCell: 'operational-grid-utility-cell operational-grid-favorite-cell',
  favoriteHeader: 'operational-grid-utility-header operational-grid-favorite-header',
  watchCell: 'operational-grid-utility-cell operational-grid-watch-cell',
  watchHeader: 'operational-grid-utility-header operational-grid-watch-header',
  recentChangeCell: 'operational-grid-utility-cell operational-grid-overflow-visible operational-grid-recent-change-cell',
  recentChangeHeader: 'operational-grid-utility-header operational-grid-recent-change-header',
  utilityOverflowCell: 'operational-grid-utility-cell operational-grid-overflow-visible',
  centeredOverflowCell: 'operational-grid-centered-cell operational-grid-overflow-visible',
  idCell: 'operational-grid-utility-cell operational-grid-id-cell',
  idHeader: 'operational-grid-utility-header operational-grid-id-header',
  primaryCell: 'operational-grid-primary-cell',
  primaryHeader: 'operational-grid-primary-header',
  textCell: 'operational-grid-text-cell',
  textHeader: 'operational-grid-text-header',
  leftBodyCell: 'operational-grid-left-body-cell',
  leftBodyWrapCell: 'operational-grid-left-body-wrap-cell',
  centeredCell: 'operational-grid-centered-cell',
  centeredHeader: 'operational-grid-centered-header',
  activeDotCell: 'operational-grid-centered-cell operational-grid-overflow-visible operational-grid-active-dot-cell',
  activeDotHeader: 'operational-grid-centered-header operational-grid-active-dot-header',
  actionCell: 'operational-grid-action-cell',
  actionHeader: 'operational-grid-action-header',
} as const

export const OPERATIONAL_GRID_TEXT_CLASS = 'operational-grid-text'
export const OPERATIONAL_GRID_PLAIN_VALUE_CLASS = 'operational-grid-text operational-grid-plain-value'
export const OPERATIONAL_GRID_PRIMARY_TEXT_CLASS = 'operational-grid-text operational-grid-plain-value operational-grid-primary-text'
export const OPERATIONAL_GRID_PRIMARY_BUTTON_CLASS = 'operational-grid-text operational-grid-plain-value operational-grid-primary-button'
export const OPERATIONAL_GRID_ICON_VALUE_CLASS = 'operational-grid-icon-value'
export const OPERATIONAL_GRID_EMPTY_VALUE_CLASS = 'operational-grid-text operational-grid-empty-value'
export const OPERATIONAL_GRID_BADGE_CLASS = 'operational-grid-badge'
export const OPERATIONAL_GRID_BADGE_TEXT_CLASS = 'operational-grid-badge-text'
export const OPERATIONAL_GRID_ACTION_LINK_CLASS = 'operational-grid-action-link'
export const OPERATIONAL_GRID_ACTION_BUTTON_CLASS = 'operational-grid-action-button'

export const OPERATIONAL_GRID_WIDTHS = {
  utilityCheckbox: 64,
  utilityFavorite: 64,
  utilityWatch: 64,
  utilityRecentChange: 52,
  id: 90,
  identity: 220,
  plainMin: 96,
  proseCompactMin: 180,
  proseWrapMin: 220,
  actionLink: 130,
  date: 180,
  compactAction: 124,
  standardAction: 120,
  badge: 132,
  badgeMin: 120,
  dot: 56,
} as const

type OperationalColumnCommonConfig = {
  field: string
  headerName: string
  hide?: boolean
  width?: number
  minWidth?: number
  maxWidth?: number
  filter?: any
  lockWidth?: boolean
}

export type OperationalPlainColumnConfig = OperationalColumnCommonConfig & {
  kind: 'plain'
  emptyValue?: string
  formatValue?: (value: any, params: any) => ReactNode
  valueClassName?: string
}

export type OperationalIdentityColumnConfig = OperationalColumnCommonConfig & {
  kind: 'identity'
  onActivate?: (row: any) => void
  buttonTitle?: string
}

export type OperationalProseColumnConfig = OperationalColumnCommonConfig & {
  kind: 'prose'
  emptyValue?: string
  proseMode?: 'compact' | 'wrap'
}

export type OperationalDateColumnConfig = OperationalColumnCommonConfig & {
  kind: 'date'
}

export type OperationalBadgeColumnConfig = OperationalColumnCommonConfig & {
  kind: 'badge'
  fontSize: number
  emptyValue?: string
  knownValues?: string[]
}

export type OperationalMappedBadgeColumnConfig = OperationalColumnCommonConfig & {
  kind: 'mappedBadge'
  fontSize: number
  emptyValue?: string
  colorMap: Record<string, string>
  fallbackClass?: string
  knownValues?: string[]
}

export type OperationalMappedTextColumnConfig = OperationalColumnCommonConfig & {
  kind: 'mappedText'
  fontSize: number
  emptyValue?: string
  colorMap: Record<string, string>
  fallbackClass?: string
}

export type OperationalHoverSummaryColumnConfig = OperationalColumnCommonConfig & {
  kind: 'hoverSummary'
  fontSize: number
  tone?: 'blue' | 'default'
  emptyValue?: string
  getItems: (params: any) => any[]
  getSummary: (items: any[], params: any) => string
  getTooltip: (items: any[], params: any) => string
}

export type OperationalActiveDotColumnConfig = OperationalColumnCommonConfig & {
  kind: 'activeDot'
  getIsDeleted?: (params: any) => boolean
}

export type OperationalActionLinkColumnConfig = OperationalColumnCommonConfig & {
  kind: 'actionLink'
  fontSize: number
  emptyValue?: string
  onActivate: (params: any) => void
}

export type OperationalActionColumnConfig = {
  kind: 'action'
  width?: number
  renderActions: (row: any) => ReactNode
}

export type OperationalColumnConfig =
  | OperationalPlainColumnConfig
  | OperationalIdentityColumnConfig
  | OperationalProseColumnConfig
  | OperationalDateColumnConfig
  | OperationalBadgeColumnConfig
  | OperationalMappedBadgeColumnConfig
  | OperationalMappedTextColumnConfig
  | OperationalHoverSummaryColumnConfig
  | OperationalActiveDotColumnConfig
  | OperationalActionLinkColumnConfig
  | OperationalActionColumnConfig

export type OperationalUtilityColumnsConfig = {
  includeRecentChange?: boolean
  includeFavorite?: boolean
  includeWatch?: boolean
  isIntelligenceExpanded?: boolean
  hideRecentChange?: boolean
  hideFavorite?: boolean
  hideWatch?: boolean
  isRecentChange: (item: any) => boolean
  onToggleFavorite: (id: number) => void
  onToggleWatch: (id: number) => void
  itemLabel: string
}

export const applyOperationalIdentityColumn = <T extends Record<string, any>>(
  column: T,
  options?: { width?: number; minWidth?: number; maxWidth?: number }
): T => {
  // Source of truth: identity column pinning/sizing behavior.
  const width = options?.width ?? column.width ?? OPERATIONAL_GRID_WIDTHS.identity
  return {
    ...column,
    pinned: 'left',
    lockPinned: true,
    width,
    minWidth: options?.minWidth ?? column.minWidth ?? Math.min(width, 160),
    maxWidth: options?.maxWidth ?? column.maxWidth ?? 360,
    resizable: true,
    flex: undefined,
    initialFlex: undefined,
    operationalSkipAutoSize: true,
  }
}

export const applyOperationalActionColumn = <T extends Record<string, any>>(column: T, width: number = OPERATIONAL_GRID_WIDTHS.compactAction): T => ({
  // Source of truth: action column pinning/fixed sizing behavior.
  ...column,
  pinned: 'right',
  lockPinned: true,
  width,
  minWidth: width,
  maxWidth: width,
  resizable: false,
  suppressSizeToFit: true,
  operationalLockWidth: true,
  operationalSkipAutoSize: true,
})
