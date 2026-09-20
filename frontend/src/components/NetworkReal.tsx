import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { javascript } from '@codemirror/lang-javascript'
import {
  Activity, Plus, Search, Filter, ExternalLink,
  Trash2, Edit2, Shield, Cpu, Database, Network, 
  Globe, Bell, Info, ChevronRight, X, Check, Save,
  AlertCircle, Clock, Zap, Settings, ArrowRightLeft, Briefcase, UserCheck, Code,
  BookOpen, Eye, EyeOff, FileText, User, Users, Mail, MessageSquare, Monitor, MoreVertical,
  Download, Copy, ChevronUp, Layers, RefreshCcw, Tag, Sliders, Clipboard, Lightbulb, Maximize2, Minimize2, Star, GitCompare, Undo2, List, LayoutGrid, Upload, Terminal, History as HistoryIcon, Edit2 as EditIcon
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { showWorkspaceToast } from './shared/WorkspaceToast'
import {
  useOperationalRowInteractions,
  useOperationalGroupedSelection,
  useOperationalContextMenu,
  getPointFloatingStyle,
  useOperationalDismissController,
} from './shared/OperationalGridInteractions'
import {
  OperationalRowActionMenu,
  OperationalRowActionSectionModel,
  OperationalRowActionTone,
  OperationalRowActionVariant,
} from './shared/OperationalRowActionMenu'
import {
  createOperationalUtilityColumns,
} from './shared/OperationalGridStandard'
import {
  applyOperationalActionColumn,
  OPERATIONAL_GRID_WIDTHS,
} from './shared/OperationalGridContract'
import { OperationalDataGrid } from './shared/OperationalDataGrid'
import { apiFetch } from '../api/apiClient'
import { ModulePolicyButton, useModuleActionPolicy } from '../policy/ModulePolicy'
import { formatAppDate, formatAppTime, formatAppDay, parseAppDate } from '../utils/dateUtils'
import { AppDropdown } from './shared/AppDropdown'
import { ConfigRegistryModal } from "./ConfigRegistry"
import { ConfirmationModal } from "./shared/ConfirmationModal"
import { WorkspaceModal } from './shared/WorkspaceModal'
import {
  WorkspaceCollapsibleHeader,
  WorkspaceEmptyState,
  WorkspaceFieldError as FieldError,
  WorkspaceFieldLabel as FieldLabel,
  WorkspaceFloatingPanel,
  WorkspaceHoverPreview as HoverPreview,
  WorkspaceInfoTooltip,
  WorkspaceSectionBadge,
  WorkspaceModalFooter,
  WorkspaceModalHeader,
  WorkspacePanelHint as PanelHint,
  WorkspacePanelSubtitle as PanelSubtitle,
  WorkspacePanelTitle as PanelTitle,
  WorkspaceSectionCard,
  WorkspaceValidationBanner,
  getWorkspaceModalFrameClass,
  getWorkspaceModalShellClass,
  getWorkspaceInputClass,
  useWorkspaceAnchoredLayer,
  useEscapeDismiss,
  useBodyModalFlag,
} from './shared/OperationalWorkspacePrimitives'
import { WorkspaceFlyoutActionCard, WorkspaceFlyoutDropdownEditor } from './shared/WorkspaceFlyout'
import { StatusPill } from './shared/StatusPill'
import { parseCommaSeparatedValues } from '../utils/dataParsers'
import { HeaderScopeSwitch, ToolbarButton, ToolbarGroup, ToolbarIconButton, ToolbarSearch } from './shared/LayoutPrimitives'
import {
  OPERATIONAL_GRID_LAYOUT_POLICIES,
  useOperationalGridRuntime,
  useOperationalSelection,
  usePersistentJsonState,
  useWorkspaceSessionValue,
  useWorkspaceOverlayController,
  useOperationalWorkspaceController,
} from './shared/OperationalWorkspaceHooks'
import { WorkspaceCompareShell, WorkspaceDossierShell, WorkspaceHistoryShell } from './shared/WorkspaceModalShells'
import { WorkspaceShareHeader } from './shared/WorkspaceShareHeader'
import { OperationalImportModal } from './shared/OperationalImportModal'
import { downloadOperationalImportFile } from './shared/OperationalImportExport'
import {
  OperationalAnchoredPanel,
  OperationalDisplayPanel,
  OperationalGroupedGridSection,
  OperationalGroupedGridView,
  OperationalSavedViewsPanel,
  OperationalWorkspaceShell
} from './shared/OperationalWorkspaceShells'
import {
  applyOperationalColumnSizing,
  applyOperationalColumnState,
  autoSizeOperationalColumns,
  getOperationalColumnLayoutSnapshot,
  normalizeOperationalColumnLayout,
  OPERATIONAL_GRID_AUTO_SIZE_STRATEGY,
  sanitizeOperationalColumnLayout,
  sanitizeOperationalFilterModel,
  sanitizeOperationalSortModel,
} from './shared/OperationalGridSizing'
import { OPERATIONAL_ACTION_LABELS } from './shared/OperationalActionLabels'
import DiagnosticStatusPill, { DataDiagnosticModal, buildOperationalDiagnosticDetail } from './shared/OperationalDataStatus'
import { OperationalBulkPreviewModal } from './shared/OperationalBulkPreviewModal'
import { useOperationalBulkWorkflow } from './shared/useOperationalBulkWorkflow'
import { OperationalAssetSelector, type OperationalAssetRecord } from './shared/OperationalAssetSelector'
import { resolveOperationalObjectReference } from './shared/OperationalObjectReference'

const NETWORK_VIEW_STORAGE_KEY = 'sysgrid_network_views_v1'
const NETWORK_ACTIVE_VIEW_KEY = 'sysgrid_network_active_view_v1'
const NETWORK_FAVORITES_STORAGE_KEY = 'sysgrid_network_favorites_v1'
const NETWORK_UI_STATE_KEY = 'sysgrid_network_ui_state_v1'
const NETWORK_WATCH_STORAGE_KEY = 'sysgrid_network_watch_v1'
const NETWORK_WORKSPACE_PREFERENCE_KEY = 'network_workspace_state_v1'
const NETWORK_WORKSPACE_PREFERENCE_VERSION = 3
const NETWORK_FIXED_WIDTH_COLUMN_IDS = new Set([
  'select',
  'id',
  'recent_change',
  'favorite',
  'watch',
  'row_actions',
])

export const STATUSES = [
  { value: 'Existing', label: 'Existing', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  { value: 'Planned', label: 'Planned', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  { value: 'Cancelled', label: 'Cancelled', color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
  { value: 'Decommissioned', label: 'Decommissioned', color: 'bg-slate-500/20 text-slate-400 border-white/20' },
  { value: 'Deleted', label: 'Deleted', color: 'bg-slate-800 text-slate-500 border-white/5' }
]

export const LOGIC_TYPES = ['Threshold', 'Anomaly', 'Availability']
export const CHECK_INTERVAL_MIN = 30
export const CHECK_INTERVAL_MAX = 86400
export const ALERT_DURATION_MIN = 0
export const ALERT_DURATION_MAX = 3600
export const NOTIFICATION_THROTTLE_MIN = 60
export const NOTIFICATION_THROTTLE_MAX = 86400

export const LOGIC_SUGGESTIONS: Record<string, string> = {
  Threshold: 'CPU > 90%',
  Anomaly: 'Trend analysis',
  Availability: 'HTTP 200 check'
}

export const getLogicExtensions = (logicType?: string) => []

export interface NetworkLogicEntry {
  id: number
  type: string
  description: string
  logic_info: string
}

export interface NetworkOwner {
  operator_id: number
  role: string
  name: string
  external_id: string
}

export type NetworkFormErrors = Record<string, string>
export interface NetworkTeamOption {
  id: number
  name: string
  operators: any[]
}
export interface OperatorRecord {
  id: number
  username: string
  full_name: string
  external_id: string
  team_id?: number
  team?: string
}


const NETWORK_SEVERITIES = [
  { value: 'Critical', label: 'Critical', color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
  { value: 'Warning', label: 'Warning', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  { value: 'Info', label: 'Info', color: 'bg-sky-500/20 text-sky-400 border-sky-500/30' }
]

const NETWORK_OWNER_ROLES = [
  { value: 'Primary Support', label: 'Primary Support' },
  { value: 'Escalation', label: 'Escalation' },
  { value: 'Observer', label: 'Observer' }
]

const NETWORK_REQUIRED_FIELD_NAMES = new Set(['title', 'category', 'status', 'severity'])

const DEFAULT_NETWORK_VIEWS = []
const DEFAULT_NETWORK_VIEW_IDS = new Set(DEFAULT_NETWORK_VIEWS.map((view) => view.id))
const NETWORK_SUPPORTS_COMPARE = true
const NETWORK_VALID_GROUP_BY = new Set(['raw', 'status', 'farm', 'type', 'direction'])
const NETWORK_PERSISTED_COLUMN_IDS = new Set([
  'select',
  'id',
  'recent_change',
  'favorite',
  'watch',
  'src_node',
  'src_rack_slot',
  'src_port',
  'src_ip',
  'peer_node',
  'peer_rack_slot',
  'peer_port',
  'peer_ip',
  'type',
  'farm',
  'status',
  'speed',
  'direction',
  'purpose',
  'created_at',
  'updated_at',
  'row_actions',
])
const NETWORK_DEFAULT_COLUMN_ORDER = [
  'select',
  'id',
  'recent_change',
  'favorite',
  'watch',
  'src_node',
  'src_rack_slot',
  'src_port',
  'src_ip',
  'peer_node',
  'peer_rack_slot',
  'peer_port',
  'peer_ip',
  'type',
  'farm',
  'status',
  'speed',
  'direction',
  'purpose',
  'created_at',
  'updated_at',
  'row_actions',
]
const NETWORK_DEFAULT_COLUMN_ORDER_MAP = new Map(NETWORK_DEFAULT_COLUMN_ORDER.map((colId, index) => [colId, index]))

const readJsonStorage = <T,>(storageKey: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw == null ? fallback : JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const normalizeNetworkIdList = (value: any): number[] => {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry) && entry > 0)
  ))
}

const normalizeNetworkQuickFilters = (value: any) => ({
  status: Array.isArray(value?.status) ? value.status.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [],
  farm: Array.isArray(value?.farm) ? value.farm.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [],
  type: Array.isArray(value?.type) ? value.type.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [],
  direction: Array.isArray(value?.direction) ? value.direction.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [],
})

const normalizeNetworkSavedViews = (value: any, forceReorder = false) => {
  const parsed = Array.isArray(value) ? value : []
  const systemIds = new Set(DEFAULT_NETWORK_VIEWS.map((view) => view.id))
  const legacyIds = new Set(['ops', 'incident', 'recovery'])
  const customViews = parsed.filter((view: any) => (
    view &&
    typeof view === 'object' &&
    typeof view.id === 'string' &&
    typeof view.name === 'string' &&
    !systemIds.has(view.id) &&
    !legacyIds.has(view.id)
  ))
  return [
    ...DEFAULT_NETWORK_VIEWS.map((view) => parsed.find((entry: any) => entry?.id === view.id) || view),
    ...customViews.map((view: any) => ({
      ...view,
      config: sanitizeNetworkViewConfig(view?.config, forceReorder),
    })),
  ]
}

const sanitizeNetworkViewConfig = (config: any, forceReorder = false) => {
  const safeConfig = config && typeof config === 'object' ? config : {}
  const sanitizeNetworkLayout = (layout: any[], preserveWidths: boolean) => {
    const sanitized = sanitizeOperationalColumnLayout(layout, NETWORK_PERSISTED_COLUMN_IDS, preserveWidths)
    if (forceReorder || sanitized.length === 0) {
      return [...sanitized].sort((a: any, b: any) => {
        const aIndex = NETWORK_DEFAULT_COLUMN_ORDER_MAP.get(a?.colId) ?? 1000
        const bIndex = NETWORK_DEFAULT_COLUMN_ORDER_MAP.get(b?.colId) ?? 1000
        return aIndex - bIndex
      })
    }
    return sanitized
  }
  return {
    fontSize: Number.isFinite(safeConfig.fontSize) ? safeConfig.fontSize : 11,
    rowDensity: Number.isFinite(safeConfig.rowDensity) ? safeConfig.rowDensity : 8,
    hiddenColumns: Array.isArray(safeConfig.hiddenColumns)
      ? safeConfig.hiddenColumns.filter((entry: any) => typeof entry === 'string' && NETWORK_PERSISTED_COLUMN_IDS.has(entry))
      : [],
    groupBy: typeof safeConfig.groupBy === 'string' && NETWORK_VALID_GROUP_BY.has(safeConfig.groupBy) ? safeConfig.groupBy : 'raw',
    showFilterBar: safeConfig.showFilterBar !== false,
    columnLayoutState: sanitizeNetworkLayout(Array.isArray(safeConfig.columnLayoutState) ? safeConfig.columnLayoutState : [], true),
    quickFilter: typeof safeConfig.quickFilter === 'string' ? safeConfig.quickFilter : '',
    quickFilters: normalizeNetworkQuickFilters(safeConfig.quickFilters),
    filterModel: sanitizeOperationalFilterModel(safeConfig.filterModel, NETWORK_PERSISTED_COLUMN_IDS),
    sortModel: sanitizeOperationalSortModel(safeConfig.sortModel, NETWORK_PERSISTED_COLUMN_IDS),
  }
}

const normalizeNetworkWorkspaceState = (value: any) => {
  if (!value || typeof value !== 'object') return null
  const incomingVersion = Number(value.version) || 0
  const isOldVersion = incomingVersion < NETWORK_WORKSPACE_PREFERENCE_VERSION
  const uiState = value.uiState && typeof value.uiState === 'object' ? value.uiState : {}
  const normalized = {
    version: NETWORK_WORKSPACE_PREFERENCE_VERSION,
    savedViews: normalizeNetworkSavedViews(value.savedViews, isOldVersion),
    activeViewId: typeof value.activeViewId === 'string' && value.activeViewId.trim() ? value.activeViewId : null,
    favoriteIds: normalizeNetworkIdList(value.favoriteIds),
    watchIds: normalizeNetworkIdList(value.watchIds),
    uiState: {
      activeTab: uiState.activeTab === 'deleted' ? 'deleted' : 'active',
      fontSize: Number.isFinite(uiState.fontSize) ? uiState.fontSize : 11,
      rowDensity: Number.isFinite(uiState.rowDensity) ? uiState.rowDensity : 8,
      hiddenColumns: Array.isArray(uiState.hiddenColumns)
        ? uiState.hiddenColumns.filter((entry: any) => typeof entry === 'string' && NETWORK_PERSISTED_COLUMN_IDS.has(entry))
        : ['created_at', 'updated_at'],
      quickFilters: normalizeNetworkQuickFilters(uiState.quickFilters),
      groupBy: typeof uiState.groupBy === 'string' && NETWORK_VALID_GROUP_BY.has(uiState.groupBy) ? uiState.groupBy : 'raw',
      showFilterBar: uiState.showFilterBar !== false,
      columnLayoutState: sanitizeNetworkViewConfig({ columnLayoutState: Array.isArray(uiState.columnLayoutState) ? uiState.columnLayoutState : [] }, isOldVersion).columnLayoutState,
      lastVisitedAt: Number.isFinite(uiState.lastVisitedAt) ? uiState.lastVisitedAt : 0,
      searchTerm: typeof uiState.searchTerm === 'string' ? uiState.searchTerm : '',
    }
  }
  return normalized
}

const readNetworkWorkspaceStateFromLocalStorage = () => normalizeNetworkWorkspaceState({
  savedViews: readJsonStorage<any[]>(NETWORK_VIEW_STORAGE_KEY, []),
  activeViewId: typeof window === 'undefined' ? null : window.localStorage.getItem(NETWORK_ACTIVE_VIEW_KEY),
  favoriteIds: readJsonStorage<number[]>(NETWORK_FAVORITES_STORAGE_KEY, []),
  watchIds: readJsonStorage<number[]>(NETWORK_WATCH_STORAGE_KEY, []),
  uiState: readJsonStorage(NETWORK_UI_STATE_KEY, null),
})

const slugifyViewId = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `view-${Date.now()}`

// 

// Isolated component to prevent UI state changes (menus) from triggering AgGrid recalculations
const getMonitorGroupValue = (item: any, field: string) => {
  if (field === 'notification_method') return item.notification_method || 'No notification path'
  return item[field] || 'Unspecified'
}

const readNetworkUiState = () => {
  return readNetworkWorkspaceStateFromLocalStorage()?.uiState ?? null
}

export interface NetworkRecoveryDoc {
  id: number
  note?: string
  added_at?: string
}

const sanitizeNetworkPayload = (item: any) => {
  if (!item) return item
  const next = { ...item }
  delete next.created_at
  delete next.updated_at
  delete next.version
  delete next.is_deleted
  delete next.device_name
  delete next.recovery_doc_titles
  delete next.recovery_doc_details
  delete next.monitored_service_names

  // Deep sanitize logic_json
  if (Array.isArray(next.logic_json)) {
    next.logic_json = next.logic_json.map((entry: any) => ({
      ...entry,
      id: typeof entry.id === 'string' ? parseInt(entry.id.replace(/\D/g, '') || '0', 10) : Number(entry.id)
    }))
  }

  // Deep sanitize owners
  if (Array.isArray(next.owners)) {
    next.owners = next.owners
      .filter((o: any) => o.operator_id !== null && o.operator_id !== undefined)
      .map((o: any) => ({
        ...o,
        operator_id: Number(o.operator_id)
      }))
  }

  // Deep sanitize recovery_docs
  if (Array.isArray(next.recovery_docs)) {
    next.recovery_docs = next.recovery_docs.map((d: any) => {
      if (typeof d === 'number') return { id: d }
      return { 
        id: Number(d.id), 
        note: d.note || '',
        added_at: d.added_at || null
      }
    })
  }

  return next
}

const NETWORK_STATUSES = ['Active', 'Maintenance', 'Down', 'Planned', 'Requested', 'Standby', 'Offline', 'Deleted']
const NETWORK_LINK_TYPES = ['Data', 'Management', 'Storage', 'Backup', 'Control', 'Voice']
const NETWORK_DIRECTIONS = ['Bidirectional', 'Unidirectional', 'Source to Target', 'Target to Source']
const NETWORK_UNITS = ['Gbps', 'Mbps', 'Kbps']
const getNetworkConnectionTitle = (connection: any) => {
  const source = connection?.src_node || connection?.server_a || connection?.source_name || 'Unknown'
  const target = connection?.peer_node || connection?.server_b || connection?.target_name || 'Unknown'
  const sourcePort = connection?.src_port || connection?.source_port || connection?.port_a || 'N/A'
  const targetPort = connection?.peer_port || connection?.target_port || connection?.port_b || 'N/A'
  return `${source}:${sourcePort} ↔ ${target}:${targetPort}`
}

const normalizeNetworkConnection = (connection: any) => {
  const status = connection?.status || 'Active'
  const source = connection?.server_a || 'Unknown'
  const target = connection?.server_b || 'Unknown'
  const sourcePort = connection?.source_port || connection?.port_a || 'N/A'
  const targetPort = connection?.target_port || connection?.port_b || 'N/A'
  const sourceRackSlot = [connection?.src_rack, connection?.src_slot].filter(Boolean).join(' / ') || 'N/A'
  const targetRackSlot = [connection?.peer_rack, connection?.peer_slot].filter(Boolean).join(' / ') || 'N/A'
  const title = getNetworkConnectionTitle({
    ...connection,
    src_node: source,
    peer_node: target,
    src_port: sourcePort,
    peer_port: targetPort,
  })
  const linkType = connection?.link_type || connection?.connection_type || 'Data'
  const direction = connection?.direction || 'Bidirectional'
  const unit = connection?.unit || 'Gbps'
  const speed = connection?.speed_gbps != null ? `${connection.speed_gbps} ${unit}` : 'Unknown'
  const requestLink = connection?.request_link || ''
  const endpoints = [
    {
      operator_id: connection?.source_device_id || 0,
      role: 'Source',
      name: source,
      external_id: sourcePort,
    },
    {
      operator_id: connection?.target_device_id || 0,
      role: 'Target',
      name: target,
      external_id: targetPort,
    },
  ]

  return {
    ...connection,
    device_name: `${source} ↔ ${target}`,
    src_node: source,
    peer_node: target,
    src_rack_slot: sourceRackSlot,
    peer_rack_slot: targetRackSlot,
    src_port: sourcePort,
    peer_port: targetPort,
    src_ip: connection?.source_ip || 'N/A',
    peer_ip: connection?.target_ip || 'N/A',
    title,
    category: linkType,
    status,
    severity: linkType,
    platform: connection?.farm || direction || unit,
    type: linkType,
    purpose: connection?.purpose || '',
    impact: connection?.cable_type || '',
    notification_method: direction,
    notification_recipients: [],
    logic: `${sourcePort} -> ${targetPort}`,
    logic_json: [
      { id: 1, type: 'Threshold', description: 'Source endpoint', logic_info: String(sourcePort) },
      { id: 2, type: 'Threshold', description: 'Target endpoint', logic_info: String(targetPort) },
      { id: 3, type: 'Custom', description: 'Connection summary', logic_info: `${source} (${sourcePort}) <-> ${target} (${targetPort})` },
    ],
    monitored_services: [String(sourcePort), String(targetPort)],
    monitored_service_names: [sourcePort, targetPort].filter(Boolean),
    owner_team: connection?.farm || '',
    owners: endpoints,
    check_interval: connection?.speed_gbps || 0,
    alert_duration: 0,
    notification_throttle: 3600,
    is_active: status !== 'Deleted',
    is_deleted: status === 'Deleted',
    recovery_docs: [],
    recovery_doc_titles: requestLink ? [requestLink] : [],
    recovery_doc_details: [],
    created_at: connection?.created_at || connection?.updated_at || null,
    updated_at: connection?.updated_at || connection?.created_at || null,
    speed,
  }
}

const sanitizeNetworkConnectionPayload = (item: any) => ({
  device_a_id: item?.source_device_id ? Number(item.source_device_id) : (item?.device_a_id ? Number(item.device_a_id) : (item?.src_device_id ? Number(item.src_device_id) : null)),
  source_port: item?.source_port ?? item?.port_a ?? '',
  source_ip: item?.source_ip ? String(item.source_ip).trim() : null,
  source_mac: item?.source_mac ? String(item.source_mac).trim() : null,
  source_vlan: item?.source_vlan === '' || item?.source_vlan == null ? null : Number(item.source_vlan),
  device_b_id: item?.target_device_id ? Number(item.target_device_id) : (item?.device_b_id ? Number(item.device_b_id) : (item?.dst_device_id ? Number(item.dst_device_id) : null)),
  target_port: item?.target_port ?? item?.port_b ?? '',
  target_ip: item?.target_ip ? String(item.target_ip).trim() : null,
  target_mac: item?.target_mac ? String(item.target_mac).trim() : null,
  target_vlan: item?.target_vlan === '' || item?.target_vlan == null ? null : Number(item.target_vlan),
  link_type: item?.link_type || item?.category || 'Data',
  purpose: item?.purpose ? String(item.purpose).trim() : null,
  speed_gbps: item?.speed_gbps === '' || item?.speed_gbps == null ? null : Number(item.speed_gbps),
  unit: item?.unit || 'Gbps',
  direction: item?.direction || 'Bidirectional',
  cable_type: item?.cable_type ? String(item.cable_type).trim() : null,
  status: item?.status || 'Active',
  farm: item?.farm ? String(item.farm).trim() : null,
  request_link: item?.request_link ? String(item.request_link).trim() : (item?.monitoring_url ? String(item.monitoring_url).trim() : null),
})

const normalizeNetworkDeviceId = (value: any): number | null => {
  if (value == null || value === '') return null
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : null
}

const ObservabilityHUD = ({ items }: any) => {
  const stats = useMemo(() => {
    if (!items?.length) return null
    const active = items.filter((i: any) => i.status === 'Existing').length
    const critical = items.filter((i: any) => i.severity === 'Critical' || i.severity === 'S1').length
    const recent = items.filter((i: any) => {
      const updated = parseAppDate(i.updated_at)
      return updated ? (new Date().getTime() - updated.getTime() < 3600000) : false // 1 hour
    }).length
    return { active, critical, recent }
  }, [items])

  if (!stats) return null

  return (
    <div className="grid grid-cols-4 gap-6 mb-8 animate-in fade-in slide-in-from-top-4 duration-700">
       <div className="bg-black/40 border border-white/5 p-6 rounded-lg backdrop-blur-xl shadow-xl group hover:border-blue-500/20 transition-all">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 group-hover:text-blue-400 transition-colors">Global Pulse</p>
          <div className="flex items-center gap-4">
             <div className="w-12 h-12 bg-blue-600/10 rounded-lg flex items-center justify-center text-blue-400 border border-blue-500/20">
                <Activity size={24} className="animate-pulse" />
             </div>
             <div>
                <h4 className="text-2xl font-black text-white tracking-tighter">{stats.active} Active Traces</h4>
                <p className="text-[9px] font-bold text-slate-500 uppercase">Live Network Registry</p>
             </div>
          </div>
       </div>
       <div className="bg-black/40 border border-white/5 p-6 rounded-lg backdrop-blur-xl shadow-xl group hover:border-rose-500/20 transition-all">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 group-hover:text-rose-400 transition-colors">Alert Flux</p>
          <div className="flex items-center gap-4">
             <div className="w-12 h-12 bg-rose-600/10 rounded-lg flex items-center justify-center text-rose-500 border border-rose-500/20">
                <Bell size={24} className={stats.critical > 0 ? 'animate-bounce' : ''} />
             </div>
             <div>
                <h4 className="text-2xl font-black text-white tracking-tighter">{stats.critical} Critical Events</h4>
                <p className="text-[9px] font-bold text-slate-500 uppercase">Immediate Intervention Required</p>
             </div>
          </div>
       </div>
       <div className="bg-black/40 border border-white/5 p-6 rounded-lg backdrop-blur-xl shadow-xl group hover:border-emerald-500/20 transition-all">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 group-hover:text-emerald-400 transition-colors">Discovery Momentum</p>
          <div className="flex items-center gap-4">
             <div className="w-12 h-12 bg-emerald-600/10 rounded-lg flex items-center justify-center text-emerald-400 border border-emerald-500/20">
                <Zap size={24} />
             </div>
             <div>
                <h4 className="text-2xl font-black text-white tracking-tighter">{stats.recent} New Signals</h4>
                <p className="text-[9px] font-bold text-slate-500 uppercase">Captured in current session</p>
             </div>
          </div>
       </div>
       <div className="bg-indigo-600/10 border border-indigo-500/20 p-6 rounded-lg backdrop-blur-xl shadow-xl flex items-center justify-between group hover:bg-indigo-600/20 transition-all">
          <div>
             <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-1">Health Stability</p>
             <h4 className="text-2xl font-black text-white tracking-tighter">{stats.critical === 0 ? 'Optimal' : 'Degraded'}</h4>
          </div>
          <Shield size={28} className="text-indigo-500 opacity-20 group-hover:opacity-100 group-hover:scale-110 transition-all" />
       </div>
    </div>
  )
}

export default function NetworkReal() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const knowledgeAction = useModuleActionPolicy('knowledge')
  const idParam = searchParams.get('id')
  const queryClient = useQueryClient()
  const gridRef = React.useRef<any>(null)
  const { data: userSettings, isSuccess: hasUserSettings } = useQuery({
    queryKey: ['user-settings'],
    queryFn: async () => (await (await apiFetch('/api/v1/settings/user/settings')).json()),
  })
  const remoteWorkspaceState = useMemo(
    () => normalizeNetworkWorkspaceState(userSettings?.[NETWORK_WORKSPACE_PREFERENCE_KEY]),
    [userSettings]
  )
  const localWorkspaceState = useMemo(() => readNetworkWorkspaceStateFromLocalStorage(), [])
  const hasStoredFavoriteIds = useMemo(
    () => typeof window !== 'undefined' && window.localStorage.getItem(NETWORK_FAVORITES_STORAGE_KEY) !== null,
    []
  )
  const hasStoredWatchIds = useMemo(
    () => typeof window !== 'undefined' && window.localStorage.getItem(NETWORK_WATCH_STORAGE_KEY) !== null,
    []
  )
  const initialWorkspaceState = useMemo(() => {
    if (!remoteWorkspaceState) return localWorkspaceState
    if (!localWorkspaceState) return remoteWorkspaceState
    return {
      ...remoteWorkspaceState,
      savedViews: localWorkspaceState.savedViews?.length ? localWorkspaceState.savedViews : remoteWorkspaceState.savedViews,
      activeViewId: localWorkspaceState.activeViewId ?? remoteWorkspaceState.activeViewId,
      favoriteIds: hasStoredFavoriteIds ? (localWorkspaceState.favoriteIds ?? []) : remoteWorkspaceState.favoriteIds,
      watchIds: hasStoredWatchIds ? (localWorkspaceState.watchIds ?? []) : remoteWorkspaceState.watchIds,
      uiState: {
        ...remoteWorkspaceState.uiState,
        ...localWorkspaceState.uiState,
      },
    }
  }, [hasStoredFavoriteIds, hasStoredWatchIds, localWorkspaceState, remoteWorkspaceState])
  const persistedUiState = initialWorkspaceState?.uiState ?? null
  
  // --- STYLE LABORATORY STATE ---
  const [fontSize, setFontSize] = useState(persistedUiState?.fontSize ?? 11)
  const [rowDensity, setRowDensity] = useState(persistedUiState?.rowDensity ?? 8)
  const [showRegistry, setShowRegistry] = useState(false)
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(persistedUiState?.hiddenColumns ?? ['created_at', 'updated_at'])
  const [activeTab, setActiveTab] = useState<'active' | 'deleted'>(persistedUiState?.activeTab === 'deleted' ? 'deleted' : 'active')
  const [showFilterBar, setShowFilterBar] = useState<boolean>(persistedUiState?.showFilterBar ?? true)

  // Modals state
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<any>(null)
  const [detailItem, setDetailItem] = useState<any>(null)
  const [historyItem, setHistoryItem] = useState<any>(null)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showNetworkDataDiagnostic, setShowNetworkDataDiagnostic] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [showBulkEditModal, setShowBulkEditModal] = useState(false)
  
  const {
    selectedIds,
    setSelectedIds,
    clearSelection,
    isSelected,
    hasSelection,
    selectedCount,
  } = useOperationalSelection([])

  const {
    activeOverlay,
    isOverlayOpen,
    openOverlay,
    toggleOverlay,
    closeOverlay,
    dismissOverlays,
  } = useWorkspaceOverlayController()

  const showDisplayMenu = isOverlayOpen('display')
  const showViewsMenu = isOverlayOpen('views')
  const showBulkMenu = isOverlayOpen('bulk')
  const [isBulkStatusOpen, setIsBulkStatusOpen] = useState(false)
  const [isBulkSeverityOpen, setIsBulkSeverityOpen] = useState(false)
  const [isBulkNotifyOpen, setIsBulkNotifyOpen] = useState(false)
  const [confirmModal, setConfirmModal] = useState<any>({ isOpen: false, title: '', message: '', onConfirm: () => {}, variant: 'info' })
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [detailDeleteConfirm, setDetailDeleteConfirm] = useState(false)
  const [rowDeleteConfirmId, setRowDeleteConfirmId] = useState<number | null>(null)
  const [rowActionMenu, setRowActionMenu] = useState<{ item: any; point: { x: number; y: number } } | null>(null)
  const hasRowActionMenu = activeOverlay === 'rowAction' && Boolean(rowActionMenu)
  const [isIntelligenceExpanded, setIsIntelligenceExpanded] = useState(false)
  const {
    filterModel: gridFilterModel,
    setFilterModel: setGridFilterModel,
    quickFilters,
    setQuickFilters,
  } = useOperationalWorkspaceController({
    initialFilterModel: {},
    initialQuickFilters: persistedUiState?.quickFilters ?? { status: [] as string[], farm: [] as string[], type: [] as string[], direction: [] as string[] },
  })
  const [gridSortModel, setGridSortModel] = useState<any[]>([{ colId: 'favorite', sort: 'desc' }])
  const [savedViews, setSavedViews] = usePersistentJsonState<any[]>(NETWORK_VIEW_STORAGE_KEY, () => {
    return initialWorkspaceState?.savedViews ?? normalizeNetworkSavedViews([])
  })
  const [activeViewId, setActiveViewId] = useWorkspaceSessionValue<string | null>(
    'sysgrid_network_session_init',
    null,
    () => initialWorkspaceState?.activeViewId ?? (typeof window === 'undefined' ? null : window.localStorage.getItem(NETWORK_ACTIVE_VIEW_KEY))
  )
  const [favoriteIds, setFavoriteIds] = usePersistentJsonState<number[]>(NETWORK_FAVORITES_STORAGE_KEY, initialWorkspaceState?.favoriteIds ?? [])
  const [watchIds, setWatchIds] = usePersistentJsonState<number[]>(NETWORK_WATCH_STORAGE_KEY, initialWorkspaceState?.watchIds ?? [])
  const [searchTerm, setSearchTerm] = useState(persistedUiState?.searchTerm ?? '')
  const [groupBy, setGroupBy] = useState<string>(persistedUiState?.groupBy ?? 'raw')
  const [bulkDraft, setBulkDraft] = useState({ status: '', link_type: '', direction: '' })
  const [expandedBulkSection, setExpandedBulkSection] = useState<'status' | 'link_type' | 'direction' | null>(null)
  const [lastVisitedAt] = useState<number>(() => persistedUiState?.lastVisitedAt ?? 0)
  const [pendingIds, setPendingIds] = useState<number[]>([])
  const { triggerRef: displayMenuButtonRef, panelRef: displayMenuPanelRef, panelStyle: displayMenuStyle } = useWorkspaceAnchoredLayer(showDisplayMenu, { minWidth: 320 })
  const { triggerRef: viewsMenuButtonRef, panelRef: viewsMenuPanelRef, panelStyle: viewsMenuStyle } = useWorkspaceAnchoredLayer(showViewsMenu, { minWidth: 420 })
  const { triggerRef: bulkMenuButtonRef, panelRef: bulkMenuPanelRef, panelStyle: bulkMenuStyle } = useWorkspaceAnchoredLayer(showBulkMenu, { minWidth: 340 })
  const [newViewName, setNewViewName] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const autoSizeFrameRef = useRef<number | null>(null)
  const autoSizeTimeoutRef = useRef<number | null>(null)
  const networkPreferenceHydratedRef = useRef(false)
  const networkPreferenceMigratedRef = useRef(false)
  const networkPreferenceSyncRef = useRef<string | null>(null)
  const networkPreferenceSyncTimeoutRef = useRef<number | null>(null)
  const preserveExplicitColumnWidthsRef = useRef(false)
  const {
    columnLayoutState,
    setColumnLayoutState,
    setTransientManualColumnWidths,
    preserveExplicitColumnWidths,
    syncColumnLayoutState,
    applyColumnLayoutState,
    handleColumnResized,
    handleColumnMoved,
    handleDragStopped,
    handleColumnPinned,
    handleColumnVisible,
    handleGridReady,
    handleFilterChanged,
    handleSortChanged,
  } = useOperationalGridRuntime({
    initialColumnLayoutState: persistedUiState?.columnLayoutState ?? [],
    hasSavedViewWidths: Boolean(activeViewId),
    applyGridState: (config) => {
      const api = gridRef.current?.api
      if (!api) return
      applyOperationalColumnState(api, config.columnLayoutState, preserveExplicitColumnWidths)
      api.setFilterModel(config.filterModel || {})
      api.applyColumnState({
        state: (config.sortModel || []).map((entry: any) => ({ colId: entry.colId, sort: entry.sort as 'asc' | 'desc' })),
        defaultState: { sort: null },
        applyOrder: false,
      })
    },
    initialFilterModel: gridFilterModel,
    initialSortModel: gridSortModel,
    setGridFilterModel,
    setGridSortModel,
    layoutPolicy: OPERATIONAL_GRID_LAYOUT_POLICIES.standard,
    onBeforeManualResize: () => {
      clearPendingAutoSize()
      setTransientManualColumnWidths(true)
    },
    onGridApiReady: (event) => {
      if (typeof window !== 'undefined') {
        ;(window as any).__DEBUG_NETWORK_GRID_API__ = event.api
      }
    },
  })

  useEffect(() => {
    preserveExplicitColumnWidthsRef.current = preserveExplicitColumnWidths
  }, [preserveExplicitColumnWidths])

  const clearPendingAutoSize = useCallback(() => {
    if (autoSizeFrameRef.current !== null) {
      window.cancelAnimationFrame(autoSizeFrameRef.current)
      autoSizeFrameRef.current = null
    }
    if (autoSizeTimeoutRef.current !== null) {
      window.clearTimeout(autoSizeTimeoutRef.current)
      autoSizeTimeoutRef.current = null
    }
  }, [])

  const buildNetworkWorkspacePreferencePayload = useCallback(() => normalizeNetworkWorkspaceState({
    version: NETWORK_WORKSPACE_PREFERENCE_VERSION,
    savedViews,
    activeViewId,
    favoriteIds,
    watchIds,
    uiState: {
      activeTab,
      fontSize,
      rowDensity,
      hiddenColumns,
      quickFilters,
      groupBy,
      showFilterBar,
      columnLayoutState: normalizeOperationalColumnLayout(columnLayoutState, false),
      lastVisitedAt,
      searchTerm,
    }
  }), [
    activeTab,
    activeViewId,
    columnLayoutState,
    favoriteIds,
    fontSize,
    groupBy,
    hiddenColumns,
    lastVisitedAt,
    quickFilters,
    rowDensity,
    savedViews,
    searchTerm,
    showFilterBar,
    watchIds,
  ])

  useEffect(() => clearPendingAutoSize, [clearPendingAutoSize])

  useEffect(() => {
    if (remoteWorkspaceState && !networkPreferenceHydratedRef.current) {
      networkPreferenceHydratedRef.current = true
      const payload = initialWorkspaceState ?? normalizeNetworkWorkspaceState(remoteWorkspaceState)
      const serialized = JSON.stringify(payload)
      networkPreferenceSyncRef.current = serialized
      setSavedViews(payload?.savedViews ?? normalizeNetworkSavedViews([]))
      setActiveViewId(payload?.activeViewId ?? null)
      setFavoriteIds(hasStoredFavoriteIds ? (localWorkspaceState?.favoriteIds ?? []) : (payload?.favoriteIds ?? []))
      setWatchIds(hasStoredWatchIds ? (localWorkspaceState?.watchIds ?? []) : (payload?.watchIds ?? []))
      setFontSize(payload?.uiState.fontSize ?? 11)
      setRowDensity(payload?.uiState.rowDensity ?? 8)
      setHiddenColumns(payload?.uiState.hiddenColumns ?? ['created_at', 'updated_at'])
      setActiveTab(payload?.uiState.activeTab === 'deleted' ? 'deleted' : 'active')
      setShowFilterBar(payload?.uiState.showFilterBar !== false)
      setQuickFilters(payload?.uiState.quickFilters ?? normalizeNetworkQuickFilters(null))
      setGroupBy(payload?.uiState.groupBy ?? 'raw')
      setColumnLayoutState(payload?.uiState.columnLayoutState ?? [])
      setSearchTerm(payload?.uiState.searchTerm ?? '')
      return
    }

    if (hasUserSettings && !remoteWorkspaceState && !networkPreferenceMigratedRef.current) {
      networkPreferenceMigratedRef.current = true
      const localPayload = buildNetworkWorkspacePreferencePayload()
      if (!localPayload) return
      const serialized = JSON.stringify(localPayload)
      networkPreferenceSyncRef.current = serialized
      apiFetch('/api/v1/settings/user/settings', {
        method: 'PATCH',
        body: JSON.stringify({ [NETWORK_WORKSPACE_PREFERENCE_KEY]: localPayload })
      }).catch(() => {})
    }
  }, [
    buildNetworkWorkspacePreferencePayload,
    hasStoredFavoriteIds,
    hasStoredWatchIds,
    hasUserSettings,
    initialWorkspaceState,
    localWorkspaceState,
    remoteWorkspaceState,
    setActiveViewId,
    setColumnLayoutState,
    setFavoriteIds,
    setSavedViews,
    setWatchIds,
  ])

  useEffect(() => {
    if (!hasUserSettings) return
    const payload = buildNetworkWorkspacePreferencePayload()
    if (!payload) return
    const serialized = JSON.stringify(payload)
    if (networkPreferenceSyncRef.current === serialized) return
    if (networkPreferenceSyncTimeoutRef.current !== null) {
      window.clearTimeout(networkPreferenceSyncTimeoutRef.current)
    }
    networkPreferenceSyncTimeoutRef.current = window.setTimeout(() => {
      apiFetch('/api/v1/settings/user/settings', {
        method: 'PATCH',
        body: JSON.stringify({ [NETWORK_WORKSPACE_PREFERENCE_KEY]: payload })
      })
        .then(() => {
          networkPreferenceSyncRef.current = serialized
        })
        .catch(() => {})
    }, 500)
    return () => {
      if (networkPreferenceSyncTimeoutRef.current !== null) {
        window.clearTimeout(networkPreferenceSyncTimeoutRef.current)
        networkPreferenceSyncTimeoutRef.current = null
      }
    }
  }, [buildNetworkWorkspacePreferencePayload, hasUserSettings])

  const handleRowId = useCallback((params: any) => String(params.data.id), [])
  const openNetworkDetail = useCallback((item: any, replace: boolean = false) => {
    if (!item?.id) return
    setDetailItem(item)
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('id', String(item.id))
    navigate({ search: `?${nextParams.toString()}` }, { replace })
  }, [navigate, searchParams])
  const closeNetworkDetail = useCallback((replace: boolean = true) => {
    setDetailItem(null)
    setDetailDeleteConfirm(false)
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('id')
    navigate({ search: nextParams.toString() ? `?${nextParams.toString()}` : '' }, { replace })
  }, [navigate, searchParams])

  const { handleCellContextMenu, openRowActionMenuAtPoint } = useOperationalContextMenu({
    onOpenRowActionMenu: useCallback((item, point) => {
      setRowActionMenu({ item, point })
      openOverlay('rowAction')
    }, [openOverlay]),
  })

  const autoSizeNetworkColumns = useCallback(() => {
    if (!gridRef.current?.api || preserveExplicitColumnWidthsRef.current) return
    clearPendingAutoSize()
    const run = () => {
      if (!gridRef.current?.api || preserveExplicitColumnWidthsRef.current) return
      autoSizeOperationalColumns({
        api: gridRef.current.api,
        skipColumnIds: Array.from(NETWORK_FIXED_WIDTH_COLUMN_IDS),
        onSized: () => {
          if (!gridRef.current?.api || preserveExplicitColumnWidthsRef.current) return
          syncColumnLayoutState(gridRef.current.api, false)
        }
      })
    }
    autoSizeFrameRef.current = window.requestAnimationFrame(() => {
      autoSizeFrameRef.current = null
      run()
    })
    autoSizeTimeoutRef.current = window.setTimeout(() => {
      autoSizeTimeoutRef.current = null
      run()
    }, 48)
  }, [clearPendingAutoSize, syncColumnLayoutState])

  const handleGridDataUpdated = useCallback(() => {
    autoSizeNetworkColumns()
  }, [autoSizeNetworkColumns])

  const getRowClass = useCallback((params: any) => {
    let classes = params.node.rowIndex % 2 === 0 ? 'monitoring-grid-row-even' : 'monitoring-grid-row-odd'
    if (params.data && pendingIds.includes(params.data.id)) {
      classes += ' row-ghost opacity-40 grayscale pointer-events-none'
    }
    return classes
  }, [pendingIds])

  const { data: settingsOptions } = useQuery({ 
    queryKey: ['settings-options'], 
    queryFn: async () => (await (await apiFetch('/api/v1/settings/options')).json()) 
  })
  const { data: operators } = useQuery({
    queryKey: ['operators'],
    queryFn: async () => (await (await apiFetch('/api/v1/settings/operators')).json())
  })
  const { data: teams } = useQuery({
    queryKey: ['teams'],
    queryFn: async () => (await (await apiFetch('/api/v1/settings/teams')).json())
  })

  const linkPurposeOptions = useMemo(() => {
    const options = Array.isArray(settingsOptions) ? settingsOptions.filter((o:any) => o.category === "LinkPurpose") : []
    return options.length > 0
      ? options.map((option: any) => ({ value: option.value, label: option.label }))
      : NETWORK_LINK_TYPES.map((value) => ({ value, label: value }))
  }, [settingsOptions])
  const farmOptions = useMemo(() => {
    const options = Array.isArray(settingsOptions) ? settingsOptions.filter((o:any) => o.category === "NetworkFarm") : []
    return options.length > 0
      ? options.map((option: any) => ({ value: option.value, label: option.label }))
      : ['Prod', 'Stage', 'Lab'].map((value) => ({ value, label: value }))
  }, [settingsOptions])
  const cableTypeOptions = useMemo(() => {
    const options = Array.isArray(settingsOptions) ? settingsOptions.filter((o:any) => o.category === "NetworkCableType") : []
    return options.length > 0
      ? options.map((option: any) => ({ value: option.value, label: option.label }))
      : ['Fiber', 'Copper', 'DAC', 'AOC'].map((value) => ({ value, label: value }))
  }, [settingsOptions])
  const notificationMethods = useMemo(() => NETWORK_DIRECTIONS.map((value) => ({ value, label: value })), [])
  const severities = NETWORK_SEVERITIES
  const ownerRoles = NETWORK_OWNER_ROLES

  const openConfirm = (title: string, message: string, onConfirm: () => void, variant: any = 'danger') => {
    setConfirmModal({ isOpen: true, title, message, onConfirm, variant })
  }

  const openRowActionMenu = (event: React.MouseEvent, item: any) => {
    event.stopPropagation()
    openRowActionMenuAtPoint(item, event.clientX, event.clientY)
  }

  const toggleBulkWindow = () => {
    toggleOverlay('bulk')
  }

  const toggleFavorite = useCallback((monitorId: number) => {
    const id = Number(monitorId)
    setFavoriteIds((current) => {
      const normalized = normalizeNetworkIdList(current)
      return normalized.includes(id) ? normalized.filter((i) => i !== id) : [...normalized, id]
    })
  }, [])

  const toggleWatch = useCallback((monitorId: number) => {
    const id = Number(monitorId)
    setWatchIds((current) => current.includes(id) ? current.filter((i) => i !== id) : [...current, id])
  }, [])

  const openCompare = () => {
    if (selectedIds.length < 2 || selectedIds.length > 5) return
    setCompareOpen(true)
  }

  const renderPrimaryRowActions = (item: any) => {
    const isPending = pendingIds.includes(item.id)
    return (
      <div className={`flex items-center justify-end gap-1.5 pr-2 ${isPending ? 'opacity-20 grayscale pointer-events-none' : ''}`}>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            openNetworkDetail(item)
          }}
          title="Open details"
          className="rounded-lg p-1 text-blue-400 transition-all hover:bg-blue-400/10 active:scale-90"
        >
          <Maximize2 size={13} />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setEditingItem(item)
            setIsFormOpen(true)
          }}
          title="Edit configuration"
          className="rounded-lg p-1 text-emerald-400 transition-all hover:bg-emerald-400/10 active:scale-90"
        >
          <Edit2 size={13} />
        </button>
        <button
          type="button"
          onClick={(event: any) => openRowActionMenu(event, item)}
          title="More actions"
          className="row-action-trigger row-action-menu-container rounded-lg p-1 text-slate-400 transition-all hover:bg-slate-400/10 hover:text-white active:scale-90"
        >
          <MoreVertical size={13} />
        </button>
      </div>
    )
  }

  const handleExportCSV = async () => {
    const exportDate = new Date().toISOString().split('T')[0]
    try {
      const download = await downloadOperationalImportFile({
        tableName: 'port_connections',
        kind: 'snapshot',
        preferredFileName: `SysGrid_Network_${exportDate}.csv`,
      })
      showWorkspaceToast(
        `Exported ${download.fileName}. Includes active network connections only; deleted rows, selection, filters, and hidden viewport columns are not part of this snapshot.`
      )
    } catch (error: any) {
      showWorkspaceToast(error.message || 'Network export failed', { type: 'error' })
    }
  }

  const handleCopyToClipboard = () => {
    if (gridRef.current?.api) {
      const csvData = gridRef.current.api.getDataAsCsv({
        allColumns: false,
        onlySelected: true,
        suppressQuotes: true
      })
      if (csvData) {
        navigator.clipboard.writeText(csvData)
          .then(() => showWorkspaceToast("Table data copied to clipboard"))
          .catch(() => showWorkspaceToast("Failed to copy data", { type: 'error' }))
      }
    }
  }

  const buildCurrentViewConfig = () =>
    sanitizeNetworkViewConfig({
      fontSize,
      rowDensity,
      hiddenColumns,
      groupBy,
      showFilterBar,
      columnLayoutState: getOperationalColumnLayoutSnapshot(gridRef.current?.api, true) || columnLayoutState,
      quickFilter: searchTerm,
      quickFilters,
      filterModel: gridRef.current?.api?.getFilterModel?.() || gridFilterModel,
      sortModel: gridRef.current?.api?.getColumnState?.()
        ?.filter((col: any) => col.sort)
        .map((col: any) => ({ colId: col.colId, sort: col.sort })) || gridSortModel
    })

  const applySavedView = (viewId: string) => {
    const nextView = savedViews.find((view) => view.id === viewId)
    if (!nextView) return
    const config = sanitizeNetworkViewConfig(nextView.config)
    setFontSize(config.fontSize ?? 11)
    setRowDensity(config.rowDensity ?? 8)
    setHiddenColumns(config.hiddenColumns ?? [])
    setGroupBy(config.groupBy ?? 'raw')
    setShowFilterBar(config.showFilterBar ?? true)
    setColumnLayoutState(config.columnLayoutState ?? [])
    setTransientManualColumnWidths(false)
    setSearchTerm(config.quickFilter ?? '')
    setQuickFilters(config.quickFilters ?? { status: [] as string[], farm: [] as string[], type: [] as string[], direction: [] as string[] })
    setGridFilterModel(config.filterModel ?? {})
    setGridSortModel((config.sortModel && config.sortModel.length > 0) ? config.sortModel : [{ colId: 'favorite', sort: 'desc' }])
    setActiveViewId(viewId)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(NETWORK_ACTIVE_VIEW_KEY, viewId)
    }
    requestAnimationFrame(() => {
      if (gridRef.current?.api) {
        if (Array.isArray(config.columnLayoutState) && config.columnLayoutState.length) {
          applyOperationalColumnState(gridRef.current.api, config.columnLayoutState, true)
        } else {
          applyColumnLayoutState(gridRef.current.api)
        }
        gridRef.current.api.setFilterModel(config.filterModel ?? {})
      }
    })
  }

  const saveCurrentToView = (viewId: string) => {
    const nextViews = savedViews.map((view) => (
      view.id === viewId
        ? { ...view, config: buildCurrentViewConfig() }
        : view
    ))
    setSavedViews(nextViews)
    setActiveViewId(viewId)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(NETWORK_VIEW_STORAGE_KEY, JSON.stringify(nextViews))
      window.localStorage.setItem(NETWORK_ACTIVE_VIEW_KEY, viewId)
    }
    showWorkspaceToast(`Saved current table to ${nextViews.find((view) => view.id === viewId)?.name}`)
  }

  const createViewFromCurrent = () => {
    const trimmed = newViewName.trim()
    if (!trimmed) {
      showWorkspaceToast('Enter a name for the new view', { type: 'error' })
      return
    }
    const nextIdBase = slugifyViewId(trimmed)
    let nextId = nextIdBase
    let suffix = 2
    while (savedViews.some((view) => view.id === nextId)) {
      nextId = `${nextIdBase}-${suffix++}`
    }
    const nextView = {
      id: nextId,
      name: trimmed,
      config: buildCurrentViewConfig()
    }
    const nextViews = [...savedViews, nextView]
    setSavedViews(nextViews)
    setActiveViewId(nextId)
    setNewViewName('')
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(NETWORK_VIEW_STORAGE_KEY, JSON.stringify(nextViews))
      window.localStorage.setItem(NETWORK_ACTIVE_VIEW_KEY, nextId)
    }
    showWorkspaceToast(`Saved new view ${trimmed}`)
  }

  const applySystemDefault = () => {
    setActiveViewId(null)
    setTransientManualColumnWidths(false)
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(NETWORK_ACTIVE_VIEW_KEY)
    }
    setFontSize(11)
    setRowDensity(8)
    setHiddenColumns([])
    setGroupBy('raw')
    setShowFilterBar(true)
    setColumnLayoutState([])
    setSearchTerm('')
    setQuickFilters({ status: [] as string[], farm: [] as string[], type: [] as string[], direction: [] as string[] })
    setGridSortModel([{ colId: 'favorite', sort: 'desc' }])
    if (gridRef.current?.api) {
       gridRef.current.api.setFilterModel({})
       gridRef.current.api.applyColumnState({
         state: NETWORK_DEFAULT_COLUMN_ORDER.map(colId => ({ colId, pinned: colId === 'src_node' ? 'left' : null })),
         defaultState: { sort: null, pinned: null, hide: false },
         applyOrder: true
       })
    }
    showWorkspaceToast('Restored system default view')
  }

  const deleteView = (viewId: string) => {
    const view = savedViews.find((v) => v.id === viewId)
    if (!view) return
    openConfirm(
      `Delete View: ${view.name}?`,
      "Are you sure you want to permanently remove this saved layout?",
      () => {
        const nextViews = savedViews.filter((v) => v.id !== viewId)
        setSavedViews(nextViews)
        if (activeViewId === viewId) {
          setActiveViewId(null)
          if (typeof window !== 'undefined') {
             window.localStorage.removeItem(NETWORK_ACTIVE_VIEW_KEY)
          }
        }
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(NETWORK_VIEW_STORAGE_KEY, JSON.stringify(nextViews))
        }
        showWorkspaceToast(`Deleted view ${view.name}`)
      }
    )
  }

  const dismissWorkspaceMenus = useCallback(() => {
    dismissOverlays()
    setExpandedBulkSection(null)
    setBulkDeleteConfirm(false)
    setRowDeleteConfirmId(null)
  }, [dismissOverlays])

  useOperationalDismissController({
    active: showBulkMenu || showDisplayMenu || showViewsMenu || hasRowActionMenu,
    onDismiss: dismissWorkspaceMenus,
    allTriggerRefs: [bulkMenuButtonRef, displayMenuButtonRef, viewsMenuButtonRef],
    bulkMenuButtonRef,
    bulkMenuPanelRef,
    displayMenuButtonRef,
    displayMenuPanelRef,
    viewsMenuButtonRef,
    viewsMenuPanelRef,
    showBulkMenu,
    showDisplayMenu,
    showViewsMenu,
    hasRowActionMenu,
  })

  useEffect(() => {
    if (activeOverlay !== 'rowAction' && rowActionMenu) {
      setRowActionMenu(null)
    }
  }, [activeOverlay, rowActionMenu])

  useEffect(() => {
    if (activeOverlay === 'rowAction' && !rowActionMenu) {
      dismissOverlays()
    }
  }, [activeOverlay, dismissOverlays, rowActionMenu])

  const { data: allItems, isLoading, isError, error } = useQuery({
    queryKey: ['network-connections'],
    queryFn: async () => (await apiFetch('/api/v1/networks/connections?include_deleted=true')).json()
  })

  const activeNetworkQueryError = isError ? error : null

  const networkDiagnosticDetail = useMemo(() => buildOperationalDiagnosticDetail({
    endpoint: '/api/v1/networks/connections?include_deleted=true',
    error: activeNetworkQueryError,
    fallbackMessage: 'The network registry request failed.',
  }), [activeNetworkQueryError])

  useEffect(() => {
    if (!activeNetworkQueryError) {
      setShowNetworkDataDiagnostic(false)
    }
  }, [activeNetworkQueryError])

  const lifecycleCounts = useMemo(() => {
    if (!Array.isArray(allItems)) return { existing: 0, archived: 0 }
    return {
      existing: allItems.filter((item: any) => !item.is_deleted).length,
      archived: allItems.filter((item: any) => item.is_deleted).length,
    }
  }, [allItems])

  useEffect(() => {
    if (allItems) {
       // @ts-ignore
       window.__DEBUG_ALL_ITEMS__ = allItems
    }
  }, [allItems])

  const items = useMemo(() => {
    if (!allItems || !Array.isArray(allItems)) return []
    return allItems
      .map((connection: any) => normalizeNetworkConnection(connection))
      .filter((item: any) => activeTab === 'active' ? !item.is_deleted : item.is_deleted)
  }, [allItems, activeTab])

  const platformOptions = useMemo(() => {
    const values = Array.from(new Set((items || []).map((item: any) => item.platform).filter(Boolean)))
    return values.sort().map((value) => ({ value, label: value }))
  }, [items])

  const ownerOptions = useMemo(() => {
    const values = Array.from(new Set((items || []).flatMap((item: any) => (item.owners || []).map((owner: any) => owner.name)).filter(Boolean)))
    return values.sort().map((value) => ({ value, label: value }))
  }, [items])

  useEffect(() => {
    if (gridRef.current?.api) {
      gridRef.current.api.refreshCells({ columns: ['favorite', 'watch'], force: true })
    }
  }, [favoriteIds, watchIds])

  const groupOptions = [
    { value: 'raw', label: 'Raw Rows' },
    { value: 'status', label: 'Status' },
    { value: 'farm', label: 'Farm' },
    { value: 'type', label: 'Type' },
    { value: 'direction', label: 'Direction' }
  ]

  const displayedItems = useMemo(() => {
    const filtered = items.filter((item: any) => {
      if (searchTerm.trim()) {
        const query = searchTerm.trim().toLowerCase()
        const haystack = [
          String(item.id || ''),
          item.src_node,
          item.peer_node,
          item.src_rack_slot,
          item.peer_rack_slot,
          item.src_port,
          item.peer_port,
          item.src_ip,
          item.peer_ip,
          item.status,
          item.farm,
          item.type,
          item.direction,
          item.purpose,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        
        if (!haystack.includes(query)) return false
      }
      if (quickFilters.status.length > 0 && !quickFilters.status.includes(item.status)) return false
      if (quickFilters.farm.length > 0 && !quickFilters.farm.includes(item.farm)) return false
      if (quickFilters.type.length > 0 && !quickFilters.type.includes(item.type)) return false
      if (quickFilters.direction.length > 0 && !quickFilters.direction.includes(item.direction)) return false
      return true
    })
    return filtered
  }, [items, quickFilters, searchTerm])

  const sortedItemsForGrouped = useMemo(() => {
    const sorted = [...displayedItems].sort((a: any, b: any) => {
      const aFavorite = favoriteIds.includes(a.id) ? 1 : 0
      const bFavorite = favoriteIds.includes(b.id) ? 1 : 0
      if (aFavorite !== bFavorite) return bFavorite - aFavorite
      
      // If no favorite difference, check grid sort model
      if (gridSortModel.length) {
        for (const sort of gridSortModel) {
          const direction = sort.sort === 'desc' ? -1 : 1
          const aValue = sort.colId === 'owners'
            ? (a.owners || []).map((owner: any) => owner.name).join(', ')
            : a[sort.colId]
          const bValue = sort.colId === 'owners'
            ? (b.owners || []).map((owner: any) => owner.name).join(', ')
            : b[sort.colId]
          const aComparable = aValue == null ? '' : String(aValue).toLowerCase()
          const bComparable = bValue == null ? '' : String(bValue).toLowerCase()
          if (aComparable < bComparable) return -1 * direction
          if (aComparable > bComparable) return 1 * direction
        }
      }
      return a.id - b.id
    })
    return sorted
  }, [displayedItems, favoriteIds, gridSortModel])

  const displayedItemsInOrder = useMemo(() => {
    if (groupBy !== 'raw') return sortedItemsForGrouped
    // Even for raw, we want favorites pinned to top if there's no manual sort overriding it
    // or we can just always use sortedItemsForGrouped for the rowData to keep it consistent.
    return sortedItemsForGrouped
  }, [sortedItemsForGrouped, groupBy])

  useEffect(() => {
    if (!displayedItemsInOrder.length) return
    const timer = window.setTimeout(() => {
      autoSizeNetworkColumns()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [autoSizeNetworkColumns, displayedItemsInOrder, fontSize, hiddenColumns, isIntelligenceExpanded])

  const selectionScopeKey = useMemo(() => {
    const visibleIds = displayedItemsInOrder.map((item: any) => item.id).join(',')
    return `${activeTab}:${groupBy}:${visibleIds}`
  }, [activeTab, displayedItemsInOrder, groupBy])

  const { handleSelectionChanged } = useOperationalGroupedSelection({
    setSelectedIds,
    selectionScopeKey,
  })

  const { handleRowClicked, handleRowDoubleClicked } = useOperationalRowInteractions({
    onRowDoubleClick: openNetworkDetail,
    pendingIds,
    selectionScopeKey,
  })

  const networkGridRuntime = useMemo(() => ({
    preserveExplicitColumnWidths,
    handleGridReady,
    handleColumnResized,
    handleColumnMoved,
    handleDragStopped,
    handleColumnPinned,
    handleColumnVisible,
    handleFilterChanged,
    handleSortChanged,
  }), [
    preserveExplicitColumnWidths,
    handleGridReady,
    handleColumnResized,
    handleColumnMoved,
    handleDragStopped,
    handleColumnPinned,
    handleColumnVisible,
    handleFilterChanged,
    handleSortChanged,
  ])

  const networkRowInteractions = useMemo(() => ({
    handleRowClicked,
    handleRowDoubleClicked,
  }), [handleRowClicked, handleRowDoubleClicked])

  const networkContextMenu = useMemo(() => ({
    handleCellContextMenu,
  }), [handleCellContextMenu])

  const selectedItems = useMemo(
    () => displayedItems.filter((item: any) => selectedIds.includes(item.id)),
    [displayedItems, selectedIds]
  )

  const compareItems = useMemo(() => selectedItems.slice(0, 5), [selectedItems])

  const groupedSections = useMemo(() => {
    if (groupBy === 'raw') return []
    const sections = sortedItemsForGrouped.reduce((acc: Array<{ key: string; label: string; items: any[] }>, item: any) => {
      const label = String(getMonitorGroupValue(item, groupBy))
      const existing = acc.find((section) => section.key === label)
      if (existing) {
        existing.items.push(item)
      } else {
        acc.push({ key: label, label, items: [item] })
      }
      return acc
    }, [])
    return sections.sort((a, b) => a.label.localeCompare(b.label))
  }, [sortedItemsForGrouped, groupBy])

  useEffect(() => {
    if (groupBy === 'raw') return
    setCollapsedGroups((current) => {
      const next = { ...current }
      groupedSections.forEach((section) => {
        if (!(section.key in next)) next[section.key] = false
      })
      Object.keys(next).forEach((key) => {
        if (!groupedSections.some((section) => section.key === key)) delete next[key]
      })
      return next
    })
  }, [groupBy, groupedSections])

  const isRecentChange = useCallback((item: any) => {
    const changedAt = item?.updated_at || item?.created_at
    if (!changedAt || !lastVisitedAt) return false
    const time = parseAppDate(changedAt)?.getTime() || 0
    return time > lastVisitedAt
  }, [lastVisitedAt])

  const bulkPreview = useMemo(() => {
    const field = expandedBulkSection
    if (!field) return null
    const nextValue = bulkDraft[field]
    const currentCounts = selectedItems.reduce((acc: Record<string, number>, item: any) => {
      const key = item[field] || 'Unspecified'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
    return {
      field,
      nextValue,
      currentCounts: Object.entries(currentCounts)
    }
  }, [bulkDraft, expandedBulkSection, selectedItems])

  useEffect(() => {
    if (!idParam || !Array.isArray(allItems)) return
    const target = allItems.find((item: any) => String(item.id) === idParam)
    if (!target) {
      setDetailItem((current: any) => (current && String(current.id) === idParam ? null : current))
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('id')
      navigate({ search: nextParams.toString() ? `?${nextParams.toString()}` : '' }, { replace: true })
      return
    }
    setActiveTab(target.is_deleted ? 'deleted' : 'active')
    setDetailItem(target)
  }, [allItems, idParam, navigate, searchParams])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(NETWORK_UI_STATE_KEY, JSON.stringify({
      activeTab,
      fontSize,
      rowDensity,
      hiddenColumns,
      quickFilters,
      groupBy,
      showFilterBar,
      columnLayoutState: normalizeOperationalColumnLayout(columnLayoutState, false),
      selectedIds,
      expandedBulkSection,
      lastVisitedAt,
      searchTerm
    }))
  }, [activeTab, columnLayoutState, expandedBulkSection, fontSize, groupBy, hiddenColumns, lastVisitedAt, quickFilters, rowDensity, searchTerm, selectedIds, showFilterBar])

  useEffect(() => {
    if (!activeViewId || !gridRef.current?.api) return
    applySavedView(activeViewId)
  }, [activeViewId, items.length])

  useEffect(() => {
    if (!gridRef.current?.api || !selectedIds.length) return
    gridRef.current.api.forEachNode((node: any) => {
      node.setSelected(selectedIds.includes(node.data?.id))
    })
  }, [displayedItems, selectedIds])

  useEffect(() => {
    if (selectedIds.length === 0) {
      closeOverlay('bulk')
    }
  }, [selectedIds.length, closeOverlay])

  useEffect(() => {
    if (typeof window === 'undefined') return
    ;(window as any).__DEBUG_SET_NETWORK_COLUMN_WIDTH__ = (colId: string, width: number) => {
      if (!gridRef.current?.api) return
      gridRef.current.api.applyColumnState({
        state: [{ colId, width }],
        applyOrder: false,
      })
      setTransientManualColumnWidths(true)
      syncColumnLayoutState(gridRef.current.api, true)
    }
    return () => {
      delete (window as any).__DEBUG_SET_NETWORK_COLUMN_WIDTH__
    }
  }, [setTransientManualColumnWidths, syncColumnLayoutState])

  useEffect(() => {
    return () => {
      if (typeof window === 'undefined') return
      const current = readNetworkUiState() || {}
      window.localStorage.setItem(NETWORK_UI_STATE_KEY, JSON.stringify({
        ...current,
        lastVisitedAt: Date.now()
      }))
    }
  }, [])

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ id: string; label: string; onRemove: () => void }> = []
    if (searchTerm.trim()) {
      chips.push({
        id: 'search',
        label: `Search: ${searchTerm.trim()}`,
        onRemove: () => setSearchTerm('')
      })
    }
    Object.entries(gridFilterModel || {}).forEach(([field, model]) => {
      if (!model) return
      const labelValue = Array.isArray((model as any).values)
        ? (model as any).values.join(', ')
        : (model as any).filter || (model as any).filterTo || (model as any).type || 'Active'
      chips.push({
        id: `filter-${field}`,
        label: `${field}: ${labelValue}`,
        onRemove: () => {
          if (gridRef.current?.api) {
            const nextModel = { ...(gridRef.current.api.getFilterModel() || {}) }
            delete nextModel[field]
            gridRef.current.api.setFilterModel(nextModel)
            setGridFilterModel(nextModel)
          }
        }
      })
    })
    Object.entries(quickFilters).forEach(([field, value]) => {
      if (!value || (Array.isArray(value) && value.length === 0)) return
      const labelValue = Array.isArray(value) ? value.join(', ') : value
      chips.push({
        id: `quick-${field}`,
        label: `${field}: ${labelValue}`,
        onRemove: () => setQuickFilters((current) => ({ ...current, [field]: Array.isArray(value) ? [] : '' }))
      })
    })
    return chips
  }, [gridFilterModel, quickFilters, searchTerm])

  const { data: devices } = useQuery({
    queryKey: ['devices'],
    queryFn: async () => (await apiFetch('/api/v1/devices/')).json()
  })

  const refreshNetworkConnections = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['network-connections'] }),
    [queryClient],
  )

  const {
    bulkMutation,
    bulkPreviewMutation,
    bulkOperationPreview,
    isBulkReverting,
    requestBulkPreview,
    runBulkReceiptRevert,
    setBulkOperationPreview,
  } = useOperationalBulkWorkflow<any>({
    selectedIds,
    fieldLabels: {
      status: 'Status',
      link_type: 'Link type',
      direction: 'Direction',
      farm: 'Farm',
      speed_gbps: 'Speed',
      unit: 'Unit',
      purpose: 'Purpose',
      cable_type: 'Cable type',
      request_link: 'Request link',
    },
    selectionErrorMessage: 'Select at least one network connection first',
    previewErrorMessage: 'Network preview failed',
    executionErrorMessage: 'Network operation failed',
    revertErrorMessage: 'Network bulk undo failed',
    getSnapshots: (ids) => (allItems || [])
      .filter((item: any) => ids.includes(Number(item.id)))
      .map((item: any) => ({ ...item })),
    previewRequest: async ({ action, ids, payload }) => {
      const byId = new Map((allItems || []).map((item: any) => [Number(item.id), item]))
      const matched = ids.map((id) => byId.get(id)).filter(Boolean) as any[]
      const missingIds = ids.filter((id) => !byId.has(id))
      const blockers: Array<{ id: number; name?: string; reason: string }> = []
      const changedIds = matched.filter((item: any) => {
        if (action === 'update') {
          return Object.entries(payload).some(([key, value]) => item?.[key] !== value)
        }
        if (action === 'delete') return item.status !== 'Deleted'
        if (action === 'restore') {
          if (item.status === 'Deleted') return true
          blockers.push({ id: Number(item.id), name: item.title, reason: 'Only deleted connections can be restored.' })
          return false
        }
        if (action === 'purge') {
          if (item.status === 'Deleted') return true
          blockers.push({ id: Number(item.id), name: item.title, reason: 'Only deleted connections can be permanently purged.' })
          return false
        }
        return false
      }).map((item: any) => Number(item.id))
      const changedSet = new Set(changedIds)
      const unchangedIds = matched.map((item: any) => Number(item.id)).filter((id: number) => !changedSet.has(id) && !blockers.some((blocker) => blocker.id === id))
      return {
        action,
        selected_count: ids.length,
        matched_count: matched.length,
        changed_count: changedIds.length,
        unchanged_count: unchangedIds.length,
        blocked_count: blockers.length,
        missing_count: missingIds.length,
        changed_ids: changedIds,
        unchanged_ids: unchangedIds,
        missing_ids: missingIds,
        blockers,
        can_execute: changedIds.length > 0 && blockers.length === 0 && missingIds.length === 0,
      }
    },
    executeRequest: async ({ action, ids, payload }) => {
      const byId = new Map((allItems || []).map((item: any) => [Number(item.id), item]))
      const effectiveIds = ids.filter((id) => {
        const item: any = byId.get(id)
        if (!item) return false
        if (action === 'update') return Object.entries(payload).some(([key, value]) => item?.[key] !== value)
        if (action === 'delete') return item.status !== 'Deleted'
        if (action === 'restore' || action === 'purge') return item.status === 'Deleted'
        return false
      })
      if (!effectiveIds.length) return { changed: 0, changed_count: 0, unchanged_count: ids.length, changed_ids: [] }

      let response: Response
      if (action === 'update') {
        const directPayload = {
          ...(payload.status ? { status: payload.status } : {}),
          ...(payload.link_type ? { link_type: payload.link_type } : {}),
          ...(payload.direction ? { direction: payload.direction } : {}),
          ...(payload.farm ? { farm: payload.farm } : {}),
          ...(payload.speed_gbps ?? payload.speed ? { speed_gbps: payload.speed_gbps ?? payload.speed } : {}),
          ...(payload.unit ? { unit: payload.unit } : {}),
          ...(payload.purpose ? { purpose: payload.purpose } : {}),
          ...(payload.cable_type ? { cable_type: payload.cable_type } : {}),
          ...(payload.request_link ? { request_link: payload.request_link } : {}),
        }
        const onlyStatus = Object.keys(directPayload).length === 1 && Object.prototype.hasOwnProperty.call(directPayload, 'status')
        if (onlyStatus) {
          response = await apiFetch('/api/v1/networks/connections/bulk-status', {
            method: 'POST',
            body: JSON.stringify({ ids: effectiveIds, status: (directPayload as any).status || 'Active' }),
          })
        } else {
          for (const id of effectiveIds) {
            const putResponse = await apiFetch(`/api/v1/networks/connections/${id}`, {
              method: 'PUT',
              body: JSON.stringify(directPayload),
            })
            if (!putResponse.ok) throw new Error(await putResponse.text())
          }
          return {
            changed: effectiveIds.length,
            changed_count: effectiveIds.length,
            unchanged_count: ids.length - effectiveIds.length,
            changed_ids: effectiveIds,
            summary: `Updated ${effectiveIds.length} connections`,
          }
        }
      } else if (action === 'restore') {
        response = await apiFetch('/api/v1/networks/connections/bulk-restore', {
          method: 'POST',
          body: JSON.stringify({ ids: effectiveIds }),
        })
      } else if (action === 'purge') {
        response = await apiFetch('/api/v1/networks/connections/bulk-purge', {
          method: 'POST',
          body: JSON.stringify({ ids: effectiveIds }),
        })
      } else {
        response = await apiFetch('/api/v1/networks/connections/bulk-delete', {
          method: 'POST',
          body: JSON.stringify({ ids: effectiveIds }),
        })
      }
      if (!response.ok) throw new Error(await response.text())
      const result = await response.json()
      const responseIds = Array.isArray(result?.deleted_ids) ? result.deleted_ids.map(Number) : effectiveIds
      return {
        ...result,
        changed_count: Number(result?.changed ?? responseIds.length),
        unchanged_count: ids.length - responseIds.length,
        changed_ids: responseIds,
      }
    },
    refresh: refreshNetworkConnections,
    buildRevertRequest: ({ action, payload, changedIds, changedSnapshots }) => {
      if (action === 'delete' || action === 'restore') {
        return { action: action === 'delete' ? 'restore' : 'delete', ids: changedIds }
      }
      const keys = Object.keys(payload)
      if (action !== 'update' || keys.length !== 1) return null
      const key = keys[0]
      const previousValues = Array.from(new Set(changedSnapshots.map((snapshot: any) => snapshot[key])))
      if (previousValues.length !== 1 || previousValues[0] === null || previousValues[0] === undefined) return null
      return { action: 'update', ids: changedIds, payload: { [key]: previousValues[0] } }
    },
    onPreviewAccepted: () => closeOverlay('bulk'),
    onExecutionStart: (ids) => setPendingIds((current) => [...new Set([...current, ...ids])]),
    onExecutionSettled: (ids) => setPendingIds((current) => current.filter((id) => !ids.includes(id))),
    onExecutionSuccess: () => {
      setExpandedBulkSection(null)
      setBulkDraft({ status: '', link_type: '', direction: '' })
      setIsBulkStatusOpen(false)
      setIsBulkSeverityOpen(false)
      setIsBulkNotifyOpen(false)
      clearSelection()
    },
  })

  const columnDefs = useMemo(() => {
    const layoutById = new Map(columnLayoutState.map((column: any) => [column.colId, column]))
    const lockFixedUtilityWidth = (column: any, layout?: any) => {
      const colId = column.colId || column.field
      const lockedWidth = layout?.width ?? column.width ?? column.initialWidth
      if (!NETWORK_FIXED_WIDTH_COLUMN_IDS.has(colId) || lockedWidth == null) return column
      return {
        ...column,
        width: lockedWidth,
        initialWidth: lockedWidth,
        minWidth: lockedWidth,
        maxWidth: lockedWidth,
        flex: undefined,
        initialFlex: undefined,
      }
    }
    
    const renderText = (value: any, className = '') => (
      <span
        title={value == null ? '' : String(value)}
        style={{ fontSize: `${fontSize}px` }}
        className={`block w-full min-w-0 truncate whitespace-nowrap overflow-hidden text-ellipsis ${className}`}
      >
        {value ?? 'N/A'}
      </span>
    )

    const utilityColumns = createOperationalUtilityColumns({
      includeRecentChange: true,
      includeFavorite: true,
      includeWatch: true,
      isIntelligenceExpanded,
      hideRecentChange: !isIntelligenceExpanded,
      hideFavorite: false,
      hideWatch: !isIntelligenceExpanded,
      isRecentChange,
      onToggleFavorite: toggleFavorite,
      onToggleWatch: toggleWatch,
      itemLabel: 'connection',
    })

    const defs = [
      ...utilityColumns,
      {
        field: 'src_node',
        colId: 'src_node',
        headerName: 'Source Node',
        width: 170,
        minWidth: 120,
        maxWidth: 280,
        pinned: 'left',
        resizable: true,
        filter: true,
        cellClass: 'text-left flex items-center justify-start font-bold',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-200 font-bold'),
      },
      {
        field: 'src_rack_slot',
        colId: 'src_rack_slot',
        headerName: 'Source Rack Slot',
        width: 150,
        minWidth: 100,
        maxWidth: 220,
        resizable: true,
        filter: true,
        cellClass: 'text-left flex items-center justify-start',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'src_port',
        colId: 'src_port',
        headerName: 'Source Port',
        width: 130,
        minWidth: 80,
        maxWidth: 180,
        resizable: true,
        filter: true,
        cellClass: 'text-left flex items-center justify-start',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'src_ip',
        colId: 'src_ip',
        headerName: 'Source IP',
        width: 150,
        minWidth: 100,
        maxWidth: 220,
        resizable: true,
        filter: true,
        cellClass: 'text-left flex items-center justify-start',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'peer_node',
        colId: 'peer_node',
        headerName: 'Peer Node',
        width: 170,
        minWidth: 120,
        maxWidth: 280,
        resizable: true,
        filter: true,
        cellClass: 'text-left flex items-center justify-start',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-200'),
      },
      {
        field: 'peer_rack_slot',
        colId: 'peer_rack_slot',
        headerName: 'Peer Rack Slot',
        width: 150,
        minWidth: 100,
        maxWidth: 220,
        resizable: true,
        filter: true,
        cellClass: 'text-left flex items-center justify-start',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'peer_port',
        colId: 'peer_port',
        headerName: 'Peer Port',
        width: 130,
        minWidth: 80,
        maxWidth: 180,
        resizable: true,
        filter: true,
        cellClass: 'text-left flex items-center justify-start',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'peer_ip',
        colId: 'peer_ip',
        headerName: 'Peer IP',
        width: 150,
        minWidth: 100,
        maxWidth: 220,
        resizable: true,
        filter: true,
        cellClass: 'text-left flex items-center justify-start',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'type',
        colId: 'type',
        headerName: 'Type',
        width: 120,
        minWidth: 80,
        maxWidth: 160,
        resizable: true,
        filter: true,
        cellClass: 'text-center flex items-center justify-center',
        headerClass: 'text-center',
        cellRenderer: (p: any) => renderText(p.value, 'text-blue-300 font-semibold'),
      },
      {
        field: 'farm',
        colId: 'farm',
        headerName: 'Farm',
        width: 120,
        minWidth: 80,
        maxWidth: 180,
        resizable: true,
        filter: true,
        cellClass: 'text-center flex items-center justify-center',
        headerClass: 'text-center',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'status',
        colId: 'status',
        headerName: 'Status',
        width: 120,
        minWidth: 80,
        maxWidth: 160,
        resizable: true,
        filter: true,
        cellClass: 'text-center flex items-center justify-center',
        headerClass: 'text-center',
        cellRenderer: (p: any) => <StatusPill value={p.value || 'Active'} fontSize={fontSize} />,
      },
      {
        field: 'speed',
        colId: 'speed',
        headerName: 'Speed',
        width: 110,
        minWidth: 80,
        maxWidth: 150,
        resizable: true,
        filter: true,
        cellClass: 'text-center flex items-center justify-center',
        headerClass: 'text-center',
        cellRenderer: (p: any) => renderText(p.value || (p.data?.speed_gbps != null ? `${p.data.speed_gbps} ${p.data.unit || 'Gbps'}` : 'N/A'), 'text-slate-300'),
      },
      {
        field: 'direction',
        colId: 'direction',
        headerName: 'Direction',
        width: 130,
        minWidth: 90,
        maxWidth: 180,
        resizable: true,
        filter: true,
        cellClass: 'text-center flex items-center justify-center',
        headerClass: 'text-center',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'purpose',
        colId: 'purpose',
        headerName: 'Purpose',
        width: 240,
        minWidth: 150,
        maxWidth: 400,
        resizable: true,
        filter: true,
        cellClass: 'text-left flex items-center justify-start',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'created_at',
        colId: 'created_at',
        headerName: 'Created',
        width: 180,
        minWidth: 130,
        maxWidth: 220,
        resizable: true,
        filter: 'agDateColumnFilter',
        cellClass: 'text-center flex items-center justify-center',
        headerClass: 'text-center',
        cellRenderer: (p: any) => p.value ? (
          <div className="flex min-w-0 items-center gap-2">
            <Clock size={12} className="opacity-40" />
            <span style={{ fontSize: `${fontSize}px` }} className="block min-w-0 truncate whitespace-nowrap overflow-hidden text-ellipsis">{formatAppDate(p.value)}</span>
          </div>
        ) : renderText('N/A'),
      },
      {
        field: 'updated_at',
        colId: 'updated_at',
        headerName: 'Updated',
        width: 180,
        minWidth: 130,
        maxWidth: 220,
        resizable: true,
        filter: 'agDateColumnFilter',
        cellClass: 'text-center flex items-center justify-center',
        headerClass: 'text-center',
        cellRenderer: (p: any) => p.value ? (
          <div className="flex min-w-0 items-center gap-2">
            <Clock size={12} className="opacity-40" />
            <span style={{ fontSize: `${fontSize}px` }} className="block min-w-0 truncate whitespace-nowrap overflow-hidden text-ellipsis">{formatAppDate(p.value)}</span>
          </div>
        ) : renderText('N/A'),
      },
      applyOperationalActionColumn({
        colId: 'row_actions',
        headerName: 'Action',
        cellClass: 'text-right pr-3 flex items-center justify-end',
        headerClass: 'text-center',
        sortable: false,
        filter: false,
        cellRenderer: (p: any) => p.data ? renderPrimaryRowActions(p.data) : null,
        lockVisible: true,
      }, OPERATIONAL_GRID_WIDTHS.standardAction),
    ]
  
  // Inject saved layout state (widths, pinned, sort) into definitions before first render
  const mergedDefs = defs.map((col: any) => {
    if (col.children) {
      return {
        ...col,
        children: col.children.map((child: any) => {
          const colId = child.colId || child.field
          const layout = layoutById.get(colId)
          return lockFixedUtilityWidth(applyOperationalColumnSizing(child, layout, preserveExplicitColumnWidths), layout)
        })
      }
    }
    const colId = col.colId || col.field
    const layout = layoutById.get(colId)
    const sizedColumn = lockFixedUtilityWidth(applyOperationalColumnSizing(col, layout, preserveExplicitColumnWidths), layout)
    if (sizedColumn.lockVisible) return sizedColumn
    return {
      ...sizedColumn,
      hide: hiddenColumns.includes(colId),
    }
  })

  // Ensure column order is maintained from state to prevent "jumping" during re-renders
  if (columnLayoutState.length > 0) {
    const orderMap = new Map(columnLayoutState.map((col: any, index: number) => [col.colId, index]))
    return [...mergedDefs].sort((a: any, b: any) => {
      const aId = a.colId || a.field
      const bId = b.colId || b.field
      return (orderMap.get(aId) ?? 1000) - (orderMap.get(bId) ?? 1000)
    })
  }

  return mergedDefs
}, [fontSize, hiddenColumns, columnLayoutState, isIntelligenceExpanded, preserveExplicitColumnWidths]) as any

  const gridContext = useMemo(() => ({ favoriteIds, watchIds }), [favoriteIds, watchIds])
  const autoSizeStrategy = useMemo(
    () => (preserveExplicitColumnWidths ? undefined : OPERATIONAL_GRID_AUTO_SIZE_STRATEGY),
    [preserveExplicitColumnWidths]
  )

  return (
   <OperationalWorkspaceShell
      archetype="hybrid"
      workspace="network"
      className="overflow-hidden"
      header={{
        eyebrow: "Connectivity",
        title: (
          <div className="flex items-center gap-3">
            <Activity className="text-blue-500" />
            <span>Network</span>
          </div>
        ),
        subtitle: "Centralized network connection registry and operational status",
        actions: (
          <>
            <HeaderScopeSwitch
              label="Connection Scope"
              summary={`${lifecycleCounts.existing} active · ${lifecycleCounts.archived} deleted`}
              value={activeTab}
              onChange={(next) => {
                setActiveTab(next as 'active' | 'deleted')
                setSelectedIds([])
              }}
              options={[
                { label: 'Active', value: 'active' },
                { label: 'Deleted', value: 'deleted' }
              ]}
            />
            {activeNetworkQueryError && (
              <>
                <DiagnosticStatusPill
                  status="error"
                  errorDetail={{ status: (activeNetworkQueryError as any)?.status }}
                  onClick={() => setShowNetworkDataDiagnostic(true)}
                />
                <DataDiagnosticModal
                  isOpen={showNetworkDataDiagnostic}
                  onClose={() => setShowNetworkDataDiagnostic(false)}
                  errorDetail={networkDiagnosticDetail}
                />
              </>
            )}
          </>
        ),
      }}
      toolbarSearch={(
        <ToolbarSearch
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Scan matrix..."
        />
      )}
      toolbarControls={(
        <>
          <ToolbarGroup>
            <div className="views-menu-container">
              <ToolbarButton active={showViewsMenu} onClick={() => toggleOverlay('views')} ref={viewsMenuButtonRef as any}>
                <span className="flex items-center gap-2">
                  <LayoutGrid size={14} />
                  Views
                </span>
              </ToolbarButton>
            </div>
            <div className="display-menu-container">
              <ToolbarButton active={showDisplayMenu} onClick={() => toggleOverlay('display')} ref={displayMenuButtonRef as any}>
                <span className="flex items-center gap-2">
                  <Sliders size={14} />
                  Display
                </span>
              </ToolbarButton>
            </div>
            <ToolbarIconButton onClick={handleExportCSV} title="Export CSV">
              <FileText size={16} />
            </ToolbarIconButton>
            <ToolbarIconButton onClick={handleCopyToClipboard} title="Copy to clipboard">
              <Clipboard size={16} />
            </ToolbarIconButton>
            <ToolbarIconButton onClick={() => setShowRegistry(true)} title="Registry configuration">
             <Settings size={16} />
            </ToolbarIconButton>
          </ToolbarGroup>
          <ToolbarGroup>
            <ToolbarButton onClick={() => setShowImportModal(true)} title="Import network rows">
              <span className="flex items-center gap-2">
                <Upload size={14} />
                Import
              </span>
            </ToolbarButton>
            <ToolbarButton
              active={showFilterBar}
              onClick={() => setShowFilterBar((current) => !current)}
              title={showFilterBar ? 'Hide filters' : 'Show filters'}
            >
              <span className="flex items-center gap-2">
                {showFilterBar ? <EyeOff size={14} /> : <Eye size={14} />}
                Filters
              </span>
            </ToolbarButton>
            <ToolbarButton
             active={isIntelligenceExpanded}
             onClick={() => setIsIntelligenceExpanded(!isIntelligenceExpanded)}
             title={isIntelligenceExpanded ? 'Hide Activity Columns' : 'Show Activity Columns'}
            >
             <span className="flex items-center gap-2">
               {isIntelligenceExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
               Activity
             </span>
            </ToolbarButton>
          </ToolbarGroup>
        </>
      )}
      secondaryToolbar={showFilterBar ? (
        <div className="grid w-full gap-3 md:grid-cols-4">
          <AppDropdown
            multi
            value={quickFilters.status}
            onChange={(val) => setQuickFilters((current) => ({ ...current, status: val }))}
            options={STATUSES.filter((status) => status.value !== 'Deleted').map((status) => ({ value: status.value, label: status.label }))}
            label="Status Filter"
            placeholder="All statuses"
          />
          <AppDropdown
            multi
            value={quickFilters.farm}
            onChange={(val) => setQuickFilters((current) => ({ ...current, farm: val }))}
            options={Array.from(new Set((items || []).map((item: any) => item.farm).filter(Boolean))).sort().map((value) => ({ value, label: value }))}
            label="Farm Filter"
            placeholder="All farms"
          />
          <AppDropdown
            multi
            value={quickFilters.type}
            onChange={(val) => setQuickFilters((current) => ({ ...current, type: val }))}
            options={Array.from(new Set((items || []).map((item: any) => item.type).filter(Boolean))).sort().map((value) => ({ value, label: value }))}
            label="Type Filter"
            placeholder="All types"
          />
          <AppDropdown
            multi
            value={quickFilters.direction}
            onChange={(val) => setQuickFilters((current) => ({ ...current, direction: val }))}
            options={Array.from(new Set((items || []).map((item: any) => item.direction).filter(Boolean))).sort().map((value) => ({ value, label: value }))}
            label="Direction Filter"
            placeholder="All directions"
          />
        </div>
      ) : null}
      toolbarActions={(
        <>
          {NETWORK_SUPPORTS_COMPARE && (
            <ToolbarButton
              onClick={openCompare}
              disabled={selectedIds.length < 2 || selectedIds.length > 5}
              active={compareOpen}
              title="Compare selected connections"
            >
              <span className="flex items-center gap-2">
                <GitCompare size={14} />
                Compare
              </span>
            </ToolbarButton>
          )}
          <ToolbarButton
            onClick={toggleBulkWindow}
            disabled={selectedIds.length === 0}
            active={showBulkMenu}
            title="Bulk actions"
            className="bulk-menu-trigger"
            ref={bulkMenuButtonRef as any}
          >
            <span className="flex items-center gap-2">
              <Zap size={14} />
              Bulk Actions
            </span>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => { setEditingItem(null); setIsFormOpen(true); }}
            variant="primary"
            className="px-6 py-2"
          >
            + Add Connection
          </ToolbarButton>
        </>
      )}
      filterChips={[
        ...activeFilterChips,
        ...(activeFilterChips.length > 0
          ? [{
              id: 'clear-all',
              label: 'Clear All',
              onRemove: () => {
                setSearchTerm('')
                setGridFilterModel({})
                setQuickFilters({ status: [] as string[], farm: [] as string[], type: [] as string[], direction: [] as string[] })
                gridRef.current?.api?.setFilterModel({})
              }
            }]
          : []),
      ]}
      floatingPanels={
        <>
          <OperationalDisplayPanel
            isOpen={showDisplayMenu}
            panelStyle={displayMenuStyle}
            panelRef={displayMenuPanelRef}
            onClose={() => closeOverlay('display')}
            fontSize={fontSize}
            onFontSizeChange={setFontSize}
            rowDensity={rowDensity}
            onRowDensityChange={setRowDensity}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
            groupOptions={groupOptions}
            columns={columnDefs}
            hiddenColumns={hiddenColumns}
            onToggleColumn={(field) => {
              if (hiddenColumns.includes(field)) {
                setHiddenColumns(hiddenColumns.filter((entry) => entry !== field))
              } else {
                setHiddenColumns([...hiddenColumns, field])
              }
            }}
          />

          <OperationalSavedViewsPanel
            isOpen={showViewsMenu}
            panelStyle={viewsMenuStyle}
            panelRef={viewsMenuPanelRef}
            entityLabel="Network"
            onClose={() => closeOverlay('views')}
            activeViewId={activeViewId}
            currentViewName={activeViewId ? savedViews.find((view) => view.id === activeViewId)?.name || 'Unsaved working view' : 'Unsaved working view'}
            newViewName={newViewName}
            onNewViewNameChange={setNewViewName}
            onCreateView={createViewFromCurrent}
            onApplySystemDefault={applySystemDefault}
            savedViews={savedViews}
            defaultViewIds={DEFAULT_NETWORK_VIEW_IDS}
            onApplyView={applySavedView}
            onOverwriteView={saveCurrentToView}
            onDeleteView={deleteView}
            describeView={(view) => view.config?.groupBy && view.config.groupBy !== 'raw'
              ? `Grouped by ${groupOptions.find((option) => option.value === view.config.groupBy)?.label || view.config.groupBy}`
              : 'Raw network table'}
          />

          <OperationalAnchoredPanel
            isOpen={showBulkMenu}
            panelKey="bulk-menu"
            style={bulkMenuStyle}
            panelRef={bulkMenuPanelRef}
            className="bulk-menu-container"
            yOffset={10}
          >
            <WorkspaceFloatingPanel kind="context" className="max-h-[560px] overflow-y-auto custom-scrollbar p-3">
                  <div className="mb-3 rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
                    <p className="text-[10px] font-semibold text-slate-400">Bulk actions</p>
                    <p className="pt-1 text-[12px] font-semibold text-slate-100">{selectedIds.length} connections selected</p>
                  </div>

                  {activeTab === 'deleted' ? (
                      <button
                      onClick={() => requestBulkPreview({ action: 'restore' })}
                      disabled={bulkMutation.isPending}
                      className="w-full rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-left transition-all hover:bg-emerald-500/15 disabled:opacity-50"
                    >
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300">
                        {bulkMutation.isPending ? <Activity size={10} className="inline animate-spin" /> : 'Restore Selection'}
                      </p>
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <button
                        onClick={() => setShowBulkEditModal(true)}
                        className="w-full rounded-lg border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-left transition-all hover:bg-blue-500/15"
                      >
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-blue-300">Bulk Edit Table</p>
                        <p className="pt-1 text-[10px] font-semibold text-slate-400">Edit selected connections row by row using safe columns only.</p>
                      </button>

                      <WorkspaceFlyoutActionCard
                        title="Set Status"
                        active={expandedBulkSection === 'status'}
                        onClick={() => setExpandedBulkSection(expandedBulkSection === 'status' ? null : 'status')}
                      />
                      {expandedBulkSection === 'status' && (
                        <WorkspaceFlyoutDropdownEditor
                          value={bulkDraft.status}
                          onChange={(value) => setBulkDraft((current) => ({ ...current, status: value }))}
                          options={STATUSES.filter((status) => status.value !== 'Deleted').map((status) => ({ value: status.value, label: status.label }))}
                          placeholder="Choose status"
                          actionLabel="Apply Status"
                          onApply={() => requestBulkPreview({ action: 'update', payload: { status: bulkDraft.status } })}
                          disabled={!bulkDraft.status || bulkMutation.isPending}
                        />
                      )}

                      <WorkspaceFlyoutActionCard
                        title="Set Type"
                        active={expandedBulkSection === 'link_type'}
                        onClick={() => setExpandedBulkSection(expandedBulkSection === 'link_type' ? null : 'link_type')}
                      />
                      {expandedBulkSection === 'link_type' && (
                        <WorkspaceFlyoutDropdownEditor
                          value={bulkDraft.link_type}
                          onChange={(value) => setBulkDraft((current) => ({ ...current, link_type: value }))}
                          options={NETWORK_LINK_TYPES.map((value) => ({ value, label: value }))}
                          placeholder="Choose type"
                          actionLabel="Apply Type"
                          onApply={() => requestBulkPreview({ action: 'update', payload: { link_type: bulkDraft.link_type } })}
                          disabled={!bulkDraft.link_type || bulkMutation.isPending}
                        />
                      )}

                      <WorkspaceFlyoutActionCard
                        title="Set Direction"
                        active={expandedBulkSection === 'direction'}
                        onClick={() => setExpandedBulkSection(expandedBulkSection === 'direction' ? null : 'direction')}
                      />
                      {expandedBulkSection === 'direction' && (
                        <WorkspaceFlyoutDropdownEditor
                          value={bulkDraft.direction}
                          onChange={(value) => setBulkDraft((current) => ({ ...current, direction: value }))}
                          options={NETWORK_DIRECTIONS.map((value) => ({ value, label: value }))}
                          placeholder="Choose direction"
                          actionLabel="Apply Direction"
                          onApply={() => requestBulkPreview({ action: 'update', payload: { direction: bulkDraft.direction } })}
                          disabled={!bulkDraft.direction || bulkMutation.isPending}
                        />
                      )}
                    </div>
                  )}

                  <div className="mx-1 my-3 h-px bg-slate-800" />
                  <button
                    onClick={() => {
                      if (activeTab === 'deleted') {
                        openConfirm(
                          "Confirm Permanent Purge?",
                          "WARNING: This action is completely irreversible. This will permanently destroy the selected connection(s) from the physical database. This action CANNOT be undone. Are you sure you want to proceed?",
                          () => {
                            requestBulkPreview({ action: 'purge' })
                          },
                          'danger'
                        )
                      } else {
                        if (!bulkDeleteConfirm) {
                          setBulkDeleteConfirm(true)
                          return
                        }
                        requestBulkPreview({ action: 'delete' })
                      }
                    }}
                    onMouseLeave={() => {
                      if (activeTab !== 'deleted') {
                        setBulkDeleteConfirm(false)
                      }
                    }}
                    disabled={bulkMutation.isPending}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition-all ${
                      (bulkDeleteConfirm && activeTab !== 'deleted')
                        ? 'border-rose-500 bg-rose-600 animate-pulse' 
                        : 'border-rose-900/70 bg-rose-950/70 hover:bg-rose-950'
                    } disabled:opacity-50`}
                  >
                    <p className={`text-[10px] font-semibold ${(bulkDeleteConfirm && activeTab !== 'deleted') ? 'text-white' : 'text-rose-300'}`}>
                      {bulkMutation.isPending ? <Activity size={10} className="inline animate-spin" /> : (
                        activeTab === 'deleted'
                          ? OPERATIONAL_ACTION_LABELS.purge
                          : (bulkDeleteConfirm ? 'Confirm De-activation?' : 'De-activate Selection')
                      )}
                    </p>
                  </button>
            </WorkspaceFloatingPanel>
          </OperationalAnchoredPanel>

        {hasRowActionMenu && rowActionMenu && (() => {
          const item = rowActionMenu.item
          const detailTitle = item.title || `${item.src_node || item.server_a || 'Unknown'} ↔ ${item.peer_node || item.server_b || 'Unknown'}`
          const sections: OperationalRowActionSectionModel[] = [
            {
              id: 'quickAccess',
              columns: 2 as 2,
              items: [
                { 
                  id: 'details', 
                  label: 'Details', 
                  icon: Maximize2, 
                  tone: 'info' as OperationalRowActionTone, 
                  onClick: () => { openNetworkDetail(item); setRowActionMenu(null); } 
                },
                { 
                  id: 'edit', 
                  label: 'Edit', 
                  icon: Edit2, 
                  tone: 'success' as OperationalRowActionTone, 
                  onClick: () => { setEditingItem(item); setIsFormOpen(true); setRowActionMenu(null); } 
                },
              ]
            },
            {
              id: 'archive',
              columns: 1 as 1,
              items: [
                ...(activeTab === 'deleted' ? [
                  { 
                    id: 'restore', 
                    label: 'Restore', 
                    icon: Undo2, 
                    tone: 'success' as OperationalRowActionTone, 
                    variant: 'inline' as OperationalRowActionVariant, 
                    onClick: () => { requestBulkPreview({ action: 'restore', ids: [item.id] }); setRowActionMenu(null); } 
                  }
                ] : []),
                {
                  id: 'archive',
                  label: rowDeleteConfirmId === item.id 
                    ? (activeTab === 'active' ? 'Confirm Delete?' : 'Confirm Purge?') 
                    : (activeTab === 'active' ? 'Delete' : 'Purge'),
                  icon: Trash2,
                  tone: 'danger' as OperationalRowActionTone,
                  variant: 'inline' as OperationalRowActionVariant,
                  confirming: rowDeleteConfirmId === item.id,
                  onClick: () => {
                    if (activeTab === 'deleted') {
                      setRowActionMenu(null);
                      openConfirm(
                        "Confirm Permanent Purge?",
                        "WARNING: This action is completely irreversible. This will permanently destroy this connection from the physical database. This action CANNOT be undone. Are you sure you want to proceed?",
                        () => {
                          requestBulkPreview({ action: 'purge', ids: [item.id] })
                        },
                        'danger'
                      )
                    } else {
                      if (rowDeleteConfirmId !== item.id) { setRowDeleteConfirmId(item.id); return }
                      requestBulkPreview({ action: 'delete', ids: [item.id] });
                      setRowActionMenu(null); setRowDeleteConfirmId(null);
                    }
                  }
                }
              ]
            }
          ]
          return (
            <OperationalRowActionMenu
              onClose={() => setRowActionMenu(null)}
              meta={`ID ${item.id} · ${item.device_name || 'No target asset linked'}`}
              title={detailTitle}
              cursorX={rowActionMenu.point.x}
              cursorY={rowActionMenu.point.y}
              sections={sections}
            />
          )
        })()}
        </>
      }>

      {groupBy === 'raw' ? (
        <OperationalDataGrid
          gridRef={gridRef}
          rows={displayedItemsInOrder}
          columnDefs={columnDefs}
          runtime={networkGridRuntime}
          rowInteractions={networkRowInteractions}
          contextMenu={networkContextMenu}
          onSelectionChanged={(e) => handleSelectionChanged(e, 'raw')}
          getRowId={handleRowId}
          getRowClass={getRowClass}
          selectionScopeKey={selectionScopeKey}
          context={gridContext}
          fontSize={fontSize}
          rowDensity={rowDensity}
          noRowsLabel="No network data found"
          loading={isLoading}
          loadingIcon={<RefreshCcw size={32} className="text-blue-400 animate-spin" />}
          loadingLabel={<p className="text-[10px] font-semibold text-blue-400">Scanning network matrix...</p>}
          onFirstDataRendered={handleGridDataUpdated}
          onRowDataUpdated={handleGridDataUpdated}
          suppressRowClickSelection={false}
        />
      ) : (
        <OperationalGroupedGridView
          summary={(
            <div>
              <p className="text-[10px] font-semibold text-slate-400">Grouped network matrix</p>
              <p className="pt-1 text-[12px] font-semibold text-slate-100">Sorted by {groupOptions.find((option) => option.value === groupBy)?.label || groupBy}</p>
            </div>
          )}
          actions={(
            <>
              <button 
                onClick={() => setCollapsedGroups(groupedSections.reduce((acc: any, s: any) => ({ ...acc, [s.key]: false }), {}))}
                className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-[9px] font-semibold text-slate-400 hover:bg-white/10 hover:text-white transition-all"
              >
                Expand All
              </button>
              <button 
                onClick={() => setCollapsedGroups(groupedSections.reduce((acc: any, s: any) => ({ ...acc, [s.key]: true }), {}))}
                className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-[9px] font-semibold text-slate-400 hover:bg-white/10 hover:text-white transition-all"
              >
                Collapse All
              </button>
              <div className="w-px h-6 bg-white/10 mx-1" />
              <button 
                onClick={() => setGroupBy('raw')}
                className="px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-[9px] font-semibold text-rose-400 hover:bg-rose-500/20 transition-all flex items-center gap-2"
              >
                <X size={12} />
                <span>Cancel</span>
              </button>
            </>
          )}
          sections={groupedSections.map((section) => {
            const isCollapsed = collapsedGroups[section.key]
            const selectedCount = section.items.filter((item: any) => selectedIds.includes(item.id)).length
            return (
              <OperationalGroupedGridSection
                key={section.key}
                labelMeta={<span className="text-[9px] font-semibold text-blue-400">{groupOptions.find((option) => option.value === groupBy)?.label}</span>}
                label={section.label}
                count={section.items.length}
                countLabel="connections"
                selectedCount={selectedCount}
                collapsed={isCollapsed}
                onToggle={() => setCollapsedGroups((current) => ({ ...current, [section.key]: !current[section.key] }))}
              >
                {!isCollapsed && (
                  <OperationalDataGrid
                    rows={section.items}
                    columnDefs={columnDefs}
                    runtime={networkGridRuntime}
                    rowInteractions={networkRowInteractions}
                    contextMenu={networkContextMenu}
                    onSelectionChanged={(e) => handleSelectionChanged(e, section.key)}
                    getRowId={handleRowId}
                    getRowClass={getRowClass}
                    selectionScopeKey={selectionScopeKey}
                    context={gridContext}
                    fontSize={fontSize}
                    rowDensity={rowDensity}
                    noRowsLabel="No network data found"
                    height={`${Math.min(600, section.items.length * (fontSize + rowDensity + 5) + 40)}px`}
                    onFirstDataRendered={handleGridDataUpdated}
                    onRowDataUpdated={handleGridDataUpdated}
                    suppressRowClickSelection={false}
                  />
                )}
              </OperationalGroupedGridSection>
            )
          })}
        />
      )}

      <BulkActionModals
        isStatusOpen={isBulkStatusOpen}
        isSeverityOpen={isBulkSeverityOpen}
        isNotifyOpen={isBulkNotifyOpen}
        onClose={() => { setIsBulkStatusOpen(false); setIsBulkSeverityOpen(false); setIsBulkNotifyOpen(false); }}
        onApply={(action, val) => requestBulkPreview({ action: 'update', payload: { [action]: val } })}
        count={selectedIds.length}
        severities={severities}
        notificationMethods={notificationMethods}
      />

      <OperationalBulkPreviewModal
        isOpen={Boolean(bulkOperationPreview)}
        workspaceLabel="Network"
        actionLabel={bulkOperationPreview?.actionLabel || 'Apply change'}
        fieldLabel={bulkOperationPreview?.fieldLabel}
        nextValue={bulkOperationPreview?.nextValue}
        preview={bulkOperationPreview?.preview || null}
        previewBasis="workspace-snapshot"
        result={bulkOperationPreview?.result || null}
        isExecuting={bulkMutation.isPending}
        isReverting={isBulkReverting}
        onClose={() => setBulkOperationPreview(null)}
        onRevert={bulkOperationPreview?.onRevert ? runBulkReceiptRevert : undefined}
        onConfirm={() => {
          if (!bulkOperationPreview) return
          bulkMutation.mutate({
            action: bulkOperationPreview.action,
            ids: bulkOperationPreview.ids,
            payload: bulkOperationPreview.payload,
          })
        }}
      />

      <ConfirmationModal 
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
        onConfirm={() => { confirmModal.onConfirm?.(); setConfirmModal((prev: any) => ({ ...prev, isOpen: false })); }}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
      />

      <AnimatePresence>
        {isFormOpen && (
          <NetworkConnectionForm
            key={`network-form-${editingItem?.id || 'new'}`}
            item={editingItem}
            devices={devices}
            linkPurposeOptions={linkPurposeOptions}
            farmOptions={farmOptions}
            cableTypeOptions={cableTypeOptions}
            onClose={() => setIsFormOpen(false)}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['network-connections'] })
              setIsFormOpen(false)
            }}
          />
        )}
        {detailItem && (
          <NetworkDetailModal
            key={`network-detail-${detailItem.id}`}
            item={detailItem}
            onClose={() => closeNetworkDetail()}
            onEdit={(connection: any) => { closeNetworkDetail(); setEditingItem(connection); setIsFormOpen(true); }}
            onOpenHistory={() => {}}
            onOpenBkm={() => {}}
            onDelete={(connection: any) => {
              if (activeTab === 'deleted') {
                openConfirm(
                  "Confirm Permanent Purge?",
                  "WARNING: This action is completely irreversible. This will permanently destroy this connection from the physical database. This action CANNOT be undone. Are you sure you want to proceed?",
                  () => {
                    requestBulkPreview({ action: 'purge', ids: [connection.id] })
                    closeNetworkDetail()
                  },
                  'danger'
                )
              } else {
                if (!detailDeleteConfirm) {
                  setDetailDeleteConfirm(true)
                  return
                }
                requestBulkPreview({ action: 'delete', ids: [connection.id] })
                closeNetworkDetail()
              }
            }}
            onOpenAsset={(deviceId: number) => {
              const target = resolveOperationalObjectReference('device', deviceId)
              if (target) navigate(target.path)
            }}
            onOpenKnowledge={(knowledgeId: number) => {
              if (!knowledgeAction.available) return
              navigate(`/knowledge?id=${knowledgeId}`)
            }}
            deleteConfirm={detailDeleteConfirm}
          />
        )}
        {historyItem && <NetworkHistoryModal key={`network-history-${historyItem.id}`} item={historyItem} onClose={() => setHistoryItem(null)} />}
        {compareOpen && <CompareConnectionsModal key={`network-compare-${compareItems.map((item) => item.id).join('-') || 'empty'}`} items={compareItems} onClose={() => setCompareOpen(false)} />}
        {showBulkEditModal && (
          <BulkEditTableModal
            key={`network-bulk-edit-${selectedItems.map((item) => item.id).join('-') || 'empty'}`}
            items={selectedItems}
            teams={teams || []}
            operators={operators || []}
            linkPurposeOptions={linkPurposeOptions}
            farmOptions={farmOptions}
            cableTypeOptions={cableTypeOptions}
            severities={severities}
            notificationMethods={notificationMethods}
            onClose={() => setShowBulkEditModal(false)}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['network-connections'] })
              setShowBulkEditModal(false)
            }}
          />
        )}
        <OperationalImportModal
          key="network-import-modal"
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          tableName="port_connections"
          displayName="Network"
        />
        <ConfigRegistryModal
            key="network-config-registry"
            isOpen={showRegistry}
            onClose={() => setShowRegistry(false)}
            title="Network Connection Enumerations"
            sections={[
                { title: "Link Purposes", category: "LinkPurpose", icon: Layers },
                { title: "Farms", category: "NetworkFarm", icon: Globe },
                { title: "Cable Types", category: "NetworkCableType", icon: Bell },
            ]}
        />
      </AnimatePresence>

      <style>{`
        .ag-theme-alpine-dark {
          --ag-background-color: #1a1b26;
          --ag-header-background-color: #24283b;
          --ag-border-color: rgba(255, 255, 255, 0.05);
          --ag-foreground-color: #f1f5f9;
          --ag-header-foreground-color: #3b82f6;
        }
        .ag-root-wrapper { border: none !important; }
	        .ag-row-hover { background-color: rgba(255,255,255,0.05) !important; }
	        .ag-row-selected { background-color: rgba(59, 130, 246, 0.2) !important; }
          .row-action-trigger { opacity: 1; }
	        .ag-side-bar { background-color: #24283b !important; border-left: 1px solid rgba(255,255,255,0.05) !important; }
	      `}</style>
    </OperationalWorkspaceShell>
  )
}

function CompareConnectionsModal({ items, onClose }: any) {
  useEscapeDismiss(onClose)
  useBodyModalFlag()
  const [isMaximized, setIsMaximized] = useState(false)

  const fields = useMemo(() => [
    { label: 'Status', getValue: (item: any) => item.status || 'Unknown' },
    { label: 'Farm', getValue: (item: any) => item.farm || 'N/A' },
    { label: 'Source Node', getValue: (item: any) => item.src_node || item.server_a || 'N/A' },
    { label: 'Source Rack Slot', getValue: (item: any) => item.src_rack_slot || 'N/A' },
    { label: 'Source Port', getValue: (item: any) => item.src_port || 'N/A' },
    { label: 'Peer Node', getValue: (item: any) => item.peer_node || item.server_b || 'N/A' },
    { label: 'Peer Rack Slot', getValue: (item: any) => item.peer_rack_slot || 'N/A' },
    { label: 'Peer Port', getValue: (item: any) => item.peer_port || 'N/A' },
    { label: 'Type', getValue: (item: any) => item.type || item.link_type || 'N/A' },
    { label: 'Direction', getValue: (item: any) => item.direction || 'N/A' },
    { label: 'Speed', getValue: (item: any) => item.speed || (item.speed_gbps != null ? `${item.speed_gbps} ${item.unit || 'Gbps'}` : 'N/A') },
    { label: 'Purpose', getValue: (item: any) => item.purpose || 'No purpose documented', multiline: true },
    { label: 'Created', getValue: (item: any) => formatAppDate(item.created_at) },
    { label: 'Updated', getValue: (item: any) => formatAppDate(item.updated_at) },
  ], [])

  const diffMap = useMemo(() => {
    const map: Record<string, any[]> = {}
    fields.forEach(f => {
      const vals = items.map(f.getValue)
      const unique = Array.from(new Set(vals))
      if (unique.length > 1) {
        map[f.label] = unique
      }
    })
    return map
  }, [items, fields])

  const gridCols = items.length === 2 ? 'md:grid-cols-2' : items.length === 3 ? 'md:grid-cols-3' : items.length === 4 ? 'md:grid-cols-4' : 'md:grid-cols-5'

  return (
    <WorkspaceModal
      isOpen={true}
      onClose={onClose}
      size="workspace"
      isMaximized={isMaximized}
      onMaximizeToggle={() => setIsMaximized(!isMaximized)}
      title="Compare Connections"
      subtitle={`Temporal Variance Analysis · Comparing ${items.length} connection states for semantic drift`}
      icon={<GitCompare size={20} />}
      footerRight={
        <ToolbarButton onClick={onClose}>Dismiss</ToolbarButton>
      }
    >
      <WorkspaceCompareShell
        body={
          <div className={`grid gap-4 ${gridCols}`}>
            {items.map((item: any) => (
              <div key={item.id} className="rounded-lg border border-white/5 bg-black/40 p-5 shadow-inner">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[9px] font-black text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/20">ID {item.id}</span>
                  <StatusPill value={item.severity} />
                </div>
                <h4 className="text-sm font-black text-white truncate mb-1">{item.title}</h4>
                <p className="text-[9px] font-bold text-slate-500 tracking-widest truncate">{item.device_name || 'No Target Asset'}</p>
                
                <div className="mt-6 space-y-2.5">
                  {fields.map(f => {
                    const val = f.getValue(item)
                    const diffSet = diffMap[f.label]
                    const colorIndex = diffSet ? diffSet.indexOf(val) : -1
                    return (
                      <CompareRow 
                        key={f.label} 
                        label={f.label} 
                        value={val} 
                        multiline={f.multiline} 
                        colorIndex={colorIndex}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        }
      />
    </WorkspaceModal>
  )
}

function CompareRow({ label, value, multiline = false, colorIndex = -1 }: { label: string; value: string; multiline?: boolean; colorIndex?: number }) {
  const isDiff = colorIndex !== -1
  
  const diffStyles = [
    { border: 'border-amber-500/30', bg: 'bg-amber-500/5', text: 'text-amber-400', val: 'text-amber-200' },
    { border: 'border-sky-500/30', bg: 'bg-sky-500/5', text: 'text-sky-400', val: 'text-sky-200' },
    { border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', text: 'text-emerald-400', val: 'text-emerald-200' },
    { border: 'border-rose-500/30', bg: 'bg-rose-500/5', text: 'text-rose-400', val: 'text-rose-200' },
    { border: 'border-purple-500/30', bg: 'bg-purple-500/5', text: 'text-purple-400', val: 'text-purple-200' },
  ]

  const style = isDiff ? diffStyles[colorIndex % diffStyles.length] : { border: 'border-white/5', bg: 'bg-black/20', text: 'text-slate-500', val: 'text-slate-300' }

  return (
    <div className={`rounded-lg border px-3 py-2.5 transition-all ${style.border} ${style.bg} ${isDiff ? 'shadow-lg' : ''} ${multiline ? '' : 'flex items-center justify-between gap-3'}`}>
      <div className="flex items-center gap-2">
        <p className={`text-[8px] font-black uppercase tracking-widest ${style.text}`}>{label}</p>
        {isDiff && <div className={`w-1 h-1 rounded-full ${style.text.replace('text-', 'bg-')} animate-pulse`} />}
      </div>
      <p className={`pt-0.5 font-bold ${style.val} ${multiline ? 'leading-relaxed text-[11px] mt-1' : 'text-right text-[10px]'}`}>{value}</p>
    </div>
  )
}

function BulkActionModals({ isStatusOpen, isSeverityOpen, isNotifyOpen, onClose, onApply, severities, notificationMethods }: any) {
    const [val, setVal] = useState('')
    
    useEffect(() => { setVal(''); }, [isStatusOpen, isSeverityOpen, isNotifyOpen]);
    useEscapeDismiss(onClose)
    useBodyModalFlag()

    if (isStatusOpen) {
        return (
          <WorkspaceModal
            isOpen={true}
            onClose={onClose}
            size="compact"
            title="Update Status"
            subtitle="Apply a global status change to selection."
            icon={<Tag size={20} />}
            footerRight={
              <div className="flex items-center gap-3">
                <ToolbarButton onClick={onClose}>Cancel</ToolbarButton>
                <ToolbarButton 
                  disabled={!val} 
                  onClick={() => onApply('status', val)} 
                  variant="primary"
                >
                  Apply Status
                </ToolbarButton>
              </div>
            }
          >
            <div className="p-2">
              <AppDropdown
                value={val}
                onChange={v => setVal(v)}
                options={STATUSES}
                placeholder="Select Target Status..."
                label="New Status"
              />
            </div>
          </WorkspaceModal>
        )
    }

    if (isSeverityOpen) {
        return (
          <WorkspaceModal
            isOpen={true}
            onClose={onClose}
            size="compact"
            title="Update Type"
            subtitle="Recalibrate the connection type for selection."
            icon={<Shield size={20} />}
            footerRight={
              <div className="flex items-center gap-3">
                <ToolbarButton onClick={onClose}>Cancel</ToolbarButton>
                <ToolbarButton 
                  disabled={!val} 
                  onClick={() => onApply('link_type', val)} 
                  variant="danger"
                >
                  Apply Type
                </ToolbarButton>
              </div>
            }
          >
            <div className="p-2">
              <AppDropdown
                value={val}
                onChange={v => setVal(v)}
                options={NETWORK_LINK_TYPES.map((value) => ({ value, label: value }))}
                placeholder="Select Type..."
                label="Target Type"
              />
            </div>
          </WorkspaceModal>
        )
    }

    if (isNotifyOpen) {
        return (
          <WorkspaceModal
            isOpen={true}
            onClose={onClose}
            size="compact"
            title="Update Direction"
            subtitle="Reroute the connection direction for selection."
            icon={<Bell size={20} />}
            footerRight={
              <div className="flex items-center gap-3">
                <ToolbarButton onClick={onClose}>Cancel</ToolbarButton>
                <ToolbarButton 
                  disabled={!val} 
                  onClick={() => onApply('direction', val)} 
                  variant="primary"
                >
                  Apply Direction
                </ToolbarButton>
              </div>
            }
          >
            <div className="p-2">
              <AppDropdown
                value={val}
                onChange={v => setVal(v)}
                options={NETWORK_DIRECTIONS.map((value) => ({ value, label: value }))}
                placeholder="Select Direction..."
                label="Target Direction"
              />
            </div>
          </WorkspaceModal>
        )
    }

    return null;
}

function BulkEditTableModal({ items, teams, operators, linkPurposeOptions, farmOptions, cableTypeOptions, severities, notificationMethods, onClose, onSuccess }: any) {
  const [rows, setRows] = useState(() => items.map((item: any) => ({
    id: item.id,
    title: item.title || `${item.src_node || item.server_a || 'Unknown'} ↔ ${item.peer_node || item.server_b || 'Unknown'}`,
    status: item.status || '',
    link_type: item.link_type || item.category || '',
    direction: item.direction || '',
    farm: item.farm || '',
    purpose: item.purpose || '',
    speed_gbps: item.speed_gbps ?? '',
    unit: item.unit || 'Gbps',
    cable_type: item.cable_type || '',
    request_link: item.request_link || '',
    is_active: item.is_active !== false,
  })))
  const [isMaximized, setIsMaximized] = useState(false)

  const isDirty = useMemo(() => {
    return rows.some((row: any) => {
      const original = items.find((item: any) => item.id === row.id)
      if (!original) return false
      
      const origStatus = original.status || ''
      const origLinkType = original.link_type || original.category || ''
      const origDirection = original.direction || ''
      const origFarm = original.farm || ''
      const origPurpose = original.purpose || ''
      const origSpeedGbps = original.speed_gbps ?? ''
      const origUnit = original.unit || 'Gbps'
      const origCableType = original.cable_type || ''
      const origRequestLink = original.request_link || ''
      const origIsActive = original.is_active !== false

      return (
        row.status !== origStatus ||
        row.link_type !== origLinkType ||
        row.direction !== origDirection ||
        row.farm !== origFarm ||
        row.purpose !== origPurpose ||
        row.speed_gbps !== origSpeedGbps ||
        row.unit !== origUnit ||
        row.cable_type !== origCableType ||
        row.request_link !== origRequestLink ||
        row.is_active !== origIsActive
      )
    })
  }, [rows, items])

  const mergeOptionsWithCurrentValue = useCallback((options: Array<{ value: string; label: string }>, value: string) => {
    const current = value ? [{ value, label: value }] : []
    return Array.from(new Map([...(options || []), ...current].map((option: any) => [option.value, option])).values())
  }, [])

  const updateRow = (rowId: number, field: string, value: any) => {
    setRows((current: any[]) => current.map((row: any) => row.id === rowId ? { ...row, [field]: value } : row))
  }

  const mutation = useMutation({
    mutationFn: async () => {
      for (const row of rows) {
        const payload = {
          status: row.status,
          link_type: row.link_type || 'Data',
          direction: row.direction || 'Bidirectional',
          farm: row.farm || null,
          speed_gbps: row.speed_gbps === '' ? null : Number(row.speed_gbps),
          unit: row.unit || 'Gbps',
          purpose: row.purpose || null,
          cable_type: row.cable_type || null,
          request_link: row.request_link || null,
        }
        const res = await apiFetch(`/api/v1/networks/connections/${row.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        })
        await res.json()
      }
    },
    onSuccess: () => {
      showWorkspaceToast(`Updated ${rows.length} connection${rows.length === 1 ? '' : 's'}`)
      onSuccess()
    },
    onError: (error: any) => showWorkspaceToast(error.message || 'Bulk edit failed', { type: 'error' }),
  })

  return (
    <WorkspaceModal
      isOpen={true}
      onClose={onClose}
      size="workspace"
      isMaximized={isMaximized}
      onMaximizeToggle={() => setIsMaximized(!isMaximized)}
      title="Bulk Edit Network"
      subtitle="Safe table-based edits for selected connections."
      icon={<Edit2 size={20} />}
      isDirty={isDirty}
      hideFooterClose={true}
      dirtyConfirmTitle="Discard Bulk Edits?"
      dirtyConfirmMessage="You have unsaved bulk edits. Close this window and discard them?"
      footerRight={
        <div className="flex items-center gap-3">
          <ToolbarButton 
            onClick={() => mutation.mutate()} 
            disabled={mutation.isPending} 
            variant="primary"
            className="px-8 whitespace-nowrap"
          >
            {mutation.isPending ? <Clock className="animate-spin mr-2" size={14} /> : <Check className="mr-2" size={14} />}
            <span>Save Bulk Edit</span>
          </ToolbarButton>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="rounded-lg border border-white/10 bg-black/20 px-5 py-4">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Active Selection</p>
          <p className="mt-1 text-[12px] font-bold text-slate-200">{rows.length} rows staged for modification</p>
        </div>

        <div className="overflow-x-auto rounded-lg border border-white/10 bg-black/20 custom-scrollbar">
          <table className="min-w-full divide-y divide-white/10">
            <thead className="bg-slate-950/90 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Connection</th>
                <th className="min-w-[140px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Status</th>
                <th className="min-w-[160px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Type</th>
                <th className="min-w-[160px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Direction</th>
                <th className="min-w-[180px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Farm</th>
                <th className="min-w-[220px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Purpose</th>
                <th className="min-w-[120px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Speed</th>
                <th className="min-w-[110px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Unit</th>
                <th className="min-w-[160px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Cable Type</th>
                <th className="min-w-[220px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Request Link</th>
                <th className="min-w-[120px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Control</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((row: any) => (
                <tr key={row.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3 text-[10px] font-bold text-slate-200">{row.title}</td>
                  <td className="px-2 py-2"><AppDropdown value={row.status} onChange={(value) => updateRow(row.id, 'status', value)} options={STATUSES.filter((status) => status.value !== 'Deleted').map((status) => ({ value: status.value, label: status.label }))} placeholder="Status" /></td>
                  <td className="px-2 py-2"><AppDropdown value={row.link_type} onChange={(value) => updateRow(row.id, 'link_type', value)} options={mergeOptionsWithCurrentValue(linkPurposeOptions, row.link_type)} placeholder="Type" /></td>
                  <td className="px-2 py-2"><AppDropdown value={row.direction} onChange={(value) => updateRow(row.id, 'direction', value)} options={NETWORK_DIRECTIONS.map((value) => ({ value, label: value }))} placeholder="Direction" /></td>
                  <td className="px-2 py-2"><AppDropdown value={row.farm} onChange={(value) => updateRow(row.id, 'farm', value)} options={mergeOptionsWithCurrentValue(farmOptions, row.farm)} placeholder="Farm" /></td>
                  <td className="px-2 py-2"><input value={row.purpose} onChange={(event) => updateRow(row.id, 'purpose', event.target.value)} placeholder="Purpose" className={`${networkInputClass()} h-[42px] px-3 py-2 text-[10px]`} /></td>
                  <td className="px-2 py-2"><input type="number" value={row.speed_gbps} onChange={(event) => updateRow(row.id, 'speed_gbps', event.target.value)} placeholder="Speed" className={`${networkInputClass()} h-[42px] px-3 py-2 text-[10px] [appearance:textfield]`} /></td>
                  <td className="px-2 py-2"><AppDropdown value={row.unit} onChange={(value) => updateRow(row.id, 'unit', value)} options={NETWORK_UNITS.map((value) => ({ value, label: value }))} placeholder="Unit" /></td>
                  <td className="px-2 py-2"><AppDropdown value={row.cable_type} onChange={(value) => updateRow(row.id, 'cable_type', value)} options={mergeOptionsWithCurrentValue(cableTypeOptions, row.cable_type)} placeholder="Cable type" /></td>
                  <td className="px-2 py-2"><input value={row.request_link} onChange={(event) => updateRow(row.id, 'request_link', event.target.value)} placeholder="Request link" className={`${networkInputClass()} h-[42px] px-3 py-2 text-[10px]`} /></td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => updateRow(row.id, 'is_active', !row.is_active)}
                      className={`w-full rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${row.is_active ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : 'border-white/10 bg-black/20 text-slate-500'}`}
                    >
                      {row.is_active ? 'Active' : 'Paused'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </WorkspaceModal>
  )
}

function NetworkDetailModal({ item, onClose, onEdit, onDelete, onOpenAsset, onOpenKnowledge, deleteConfirm }: any) {
  useEscapeDismiss(onClose)
  useBodyModalFlag()
  const [isMaximized, setIsMaximized] = useState(false)
  const [expandedLogic, setExpandedLogic] = useState<number | null>(item.logic_json?.[0]?.id || null)
  const [showLineNumbers, setShowLineNumbers] = useState(true)
  const [interventionDoc, setInterventionDoc] = useState<any>(null)
  const detailTitle = getNetworkConnectionTitle(item)

  const { data: suggestedKnowledge } = useQuery({
    queryKey: ['network-knowledge-suggestions', item.id, item.source_device_id],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (item.source_device_id) params.append('device_id', String(item.source_device_id))
      params.append('embedded_consumer', 'network')
      const response = await apiFetch(`/api/v1/knowledge?${params.toString()}`)
      const linked = await response.json()
      if (Array.isArray(linked) && linked.length > 0) return linked
      if (!item.source_device_id) return linked
      const fallback = await apiFetch(`/api/v1/knowledge?device_id=${item.source_device_id}&embedded_consumer=network`)
      return fallback.json()
    }
  })

  return (
    <>
    <WorkspaceModal
      isOpen={true}
      onClose={onClose}
      size="workspace"
      isMaximized={isMaximized}
      onMaximizeToggle={() => setIsMaximized(!isMaximized)}
      title={
        <div className="flex items-center gap-3">
          <span className="sr-only">Connection Forensics</span>
          <span className="text-slate-400 font-normal">Connection Forensics:</span>
          <span>{detailTitle}</span>
          <WorkspaceShareHeader id={String(item.id)} title={detailTitle} />
        </div>
      }
      subtitle={`Connection ID: ${item.id} · ${item.device_name || detailTitle}`}
      icon={<Monitor size={20} />}
      forensicLineage={{ createdAt: item.created_at, updatedAt: item.updated_at }}
      status={
        <div className="flex items-center gap-2">
          <StatusPill value={item.status} />
          <StatusPill value={item.severity} />
          <div className="h-3 w-px bg-white/10 mx-1" />
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest whitespace-nowrap">
            {item.farm || 'No farm'} · {item.type || item.link_type || 'No type'} · {item.speed || (item.speed_gbps != null ? `${item.speed_gbps} ${item.unit || 'Gbps'}` : 'No speed')}
          </span>
        </div>
      }
      footerRight={
        <div className="flex items-center gap-3">
            <ToolbarButton onClick={() => onEdit?.(item)}>Edit Connection</ToolbarButton>
            <ToolbarButton 
              variant="danger" 
              onClick={() => {
                if (deleteConfirm) {
                  const action = item.is_deleted ? 'Purged' : 'Archived';
                  onDelete?.(item);
                  showWorkspaceToast(`${action} ${detailTitle} from registry`, {
                    type: 'success'
                  });
                } else {
                  onDelete?.(item);
                }
              }}
              className={deleteConfirm ? 'animate-pulse bg-rose-600 border-rose-500 text-white shadow-lg shadow-rose-500/20' : ''}
            >
              {deleteConfirm 
                ? (item.is_deleted ? 'Confirm Purge?' : 'Confirm Archive?') 
                : (item.is_deleted ? 'Purge' : 'Archive')}
            </ToolbarButton>
        </div>
      }
    >
      <WorkspaceDossierShell
        body={
          <div className="space-y-6">
            <section className="grid gap-4 xl:grid-cols-2">
              <article className="rounded-lg border border-blue-500/20 bg-blue-500/[0.06] p-5 shadow-inner">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-[0.22em] text-blue-400">Source endpoint</p>
                    <h4 className="mt-2 truncate text-sm font-black text-slate-100">{item.src_node || item.server_a || 'Unknown'}</h4>
                    <p className="mt-1 text-[10px] font-semibold text-slate-500">{item.src_rack_slot || 'No rack slot'}</p>
                  </div>
                  <button
                    type="button"
                    disabled={!item.source_device_id}
                    onClick={() => item.source_device_id && onOpenAsset?.(item.source_device_id)}
                    className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-[0.18em] text-blue-300 transition-all hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Open asset
                  </button>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Port</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-200">{item.src_port || 'N/A'}</p>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">IP</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-200">{item.src_ip || 'N/A'}</p>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">MAC</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-200">{item.source_mac || 'N/A'}</p>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">VLAN</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-200">{item.source_vlan ?? 'N/A'}</p>
                  </div>
                </div>
              </article>

              <article className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-5 shadow-inner">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-[0.22em] text-emerald-400">Peer endpoint</p>
                    <h4 className="mt-2 truncate text-sm font-black text-slate-100">{item.peer_node || item.server_b || 'Unknown'}</h4>
                    <p className="mt-1 text-[10px] font-semibold text-slate-500">{item.peer_rack_slot || 'No rack slot'}</p>
                  </div>
                  <button
                    type="button"
                    disabled={!item.target_device_id}
                    onClick={() => item.target_device_id && onOpenAsset?.(item.target_device_id)}
                    className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-[0.18em] text-emerald-300 transition-all hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Open asset
                  </button>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Port</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-200">{item.peer_port || 'N/A'}</p>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">IP</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-200">{item.peer_ip || 'N/A'}</p>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">MAC</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-200">{item.target_mac || 'N/A'}</p>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">VLAN</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-200">{item.target_vlan ?? 'N/A'}</p>
                  </div>
                </div>
              </article>
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.9fr)]">
              <div className="rounded-lg border border-white/5 bg-white/[0.03] p-5 shadow-inner">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-2 text-blue-400">
                    <Info size={14} />
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-500">Purpose and routing</p>
                    <p className="mt-1 text-[12px] font-bold text-slate-300">
                      {item.purpose || 'No purpose defined.'}
                    </p>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Connection type</p>
                    <p className="mt-1 text-[11px] font-bold text-blue-300">{item.type || item.link_type || 'N/A'}</p>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Direction</p>
                    <p className="mt-1 text-[11px] font-bold text-emerald-300">{item.direction || 'N/A'}</p>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Farm</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-200">{item.farm || 'N/A'}</p>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Cable</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-200">{item.cable_type || 'N/A'}</p>
                  </div>
                </div>
                {item.request_link && (
                  <button
                    type="button"
                    onClick={() => window.open(item.request_link, '_blank')}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-600/10 px-3 py-2 text-[9px] font-black uppercase tracking-[0.18em] text-blue-300 transition-all hover:bg-blue-600/20"
                  >
                    <ExternalLink size={13} />
                    Open request link
                  </button>
                )}
              </div>

              <div className="rounded-lg border border-white/5 bg-[#0f172a] p-5 shadow-inner">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg border border-slate-700 bg-slate-800/80 p-2 text-slate-300">
                    <Layers size={14} />
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-500">Capacity and audit</p>
                    <p className="mt-1 text-[12px] font-bold text-slate-300">
                      {item.speed || (item.speed_gbps != null ? `${item.speed_gbps} ${item.unit || 'Gbps'}` : 'N/A')}
                    </p>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Created</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-200">{formatAppDate(item.created_at)}</p>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Updated</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-200">{formatAppDate(item.updated_at)}</p>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Status</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-200">{item.status || 'N/A'}</p>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Link speed</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-200">{item.speed || (item.speed_gbps != null ? `${item.speed_gbps} ${item.unit || 'Gbps'}` : 'N/A')}</p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        }
      />
    </WorkspaceModal>

    <AnimatePresence>
       {interventionDoc && (
          <WorkspaceModal
            key={`intervention-${interventionDoc.id}`}
            isOpen={true}
            onClose={() => setInterventionDoc(null)}
            size="compact"
            title="Operational Guidance"
            subtitle={`Pre-recovery briefing for: ${interventionDoc.title}`}
            icon={<Shield size={20} className="text-amber-500" />}
            footerRight={
               <div className="flex items-center gap-3">
                  <ToolbarButton onClick={() => setInterventionDoc(null)}>Cancel</ToolbarButton>
                  <ModulePolicyButton
                    moduleId="knowledge"
                    disabledReason="Standalone Knowledge is available only for an authorized release profile."
                    className="h-9 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-0 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap shrink-0 transition-all active:scale-95 border border-[var(--action-primary)] bg-[var(--action-primary)] text-white shadow-lg shadow-blue-500/20 hover:bg-[var(--action-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => {
                       const id = interventionDoc.id;
                       setInterventionDoc(null);
                       onOpenKnowledge?.(id);
                    }}
                  >
                     Confirm & Open Procedure
                  </ModulePolicyButton>
               </div>
            }
          >
             <div className="space-y-6 pt-2">
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-5 shadow-inner">
                   <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-black/40 rounded-lg text-amber-500"><MessageSquare size={16} /></div>
                      <h4 className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Operator Note</h4>
                   </div>
                   <p className="text-[12px] font-bold text-slate-200 leading-relaxed italic">
                      "{interventionDoc.note}"
                   </p>
                </div>
                
                <div className="flex items-start gap-4 px-1">
                   <div className="mt-1 p-1.5 bg-blue-500/10 rounded-full text-blue-400"><Info size={12} /></div>
                   <div className="flex-1">
                      <p className="text-[10px] font-bold text-slate-400 leading-relaxed">
                         The following procedure contains verified restoration steps. Please ensure you have read the guidance note above carefully before initiating recovery.
                      </p>
                   </div>
                </div>
             </div>
          </WorkspaceModal>
       )}
    </AnimatePresence>
    </>
  )
}

const stringifyOwnerUserIds = (owners: NetworkOwner[] = []) =>
  owners
    .map((owner) => owner.external_id || owner.name || String(owner.operator_id))
    .filter(Boolean)
    .join(', ')

const isNetworkFieldRequired = (fieldName: string) => NETWORK_REQUIRED_FIELD_NAMES.has(fieldName)

const networkInputClass = (error?: string) => getWorkspaceInputClass(error)

function NetworkConnectionForm({ item, devices, onClose, onSuccess, linkPurposeOptions, farmOptions, cableTypeOptions }: any) {
  useBodyModalFlag()
  const queryClient = useQueryClient()
  const [isSaving, setIsSaving] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const initialFormState = useMemo(() => ({
    source_device_id: normalizeNetworkDeviceId(item?.source_device_id),
    source_port: item?.source_port ?? '',
    source_ip: item?.source_ip ?? '',
    source_mac: item?.source_mac ?? '',
    source_vlan: item?.source_vlan ?? '',
    target_device_id: normalizeNetworkDeviceId(item?.target_device_id),
    target_port: item?.target_port ?? '',
    target_ip: item?.target_ip ?? '',
    target_mac: item?.target_mac ?? '',
    target_vlan: item?.target_vlan ?? '',
    link_type: item?.link_type || 'Data',
    purpose: item?.purpose || '',
    speed_gbps: item?.speed_gbps ?? 10,
    unit: item?.unit || 'Gbps',
    direction: item?.direction || 'Bidirectional',
    cable_type: item?.cable_type || '',
    status: item?.status || 'Active',
    farm: item?.farm || '',
    request_link: item?.request_link || '',
  }), [item])
  const [formData, setFormData] = useState(initialFormState)
  const initialDirtySnapshotRef = useRef(JSON.stringify(sanitizeNetworkConnectionPayload(initialFormState)))

  const isDirty = useMemo(() => (
    JSON.stringify(sanitizeNetworkConnectionPayload(formData)) !== initialDirtySnapshotRef.current
  ), [formData])

  const assetOptions = useMemo<OperationalAssetRecord[]>(() => (devices || [])
    .map((device: any) => ({
      id: Number(device.id),
      name: String(device.name || device.hostname || `Asset ${device.id}`),
      system: device.system || null,
      type: device.type || null,
    }))
    .filter((device) => Number.isFinite(device.id) && device.id > 0), [devices])
  const mergedLinkPurposeOptions = useMemo(() => {
    const current = item?.link_type ? [{ value: item.link_type, label: item.link_type }] : []
    return Array.from(new Map([...(linkPurposeOptions || []), ...current].map((option: any) => [option.value, option])).values())
  }, [item?.link_type, linkPurposeOptions])
  const mergedFarmOptions = useMemo(() => {
    const current = item?.farm ? [{ value: item.farm, label: item.farm }] : []
    return Array.from(new Map([...(farmOptions || []), ...current].map((option: any) => [option.value, option])).values())
  }, [farmOptions, item?.farm])
  const mergedCableTypeOptions = useMemo(() => {
    const current = item?.cable_type ? [{ value: item.cable_type, label: item.cable_type }] : []
    return Array.from(new Map([...(cableTypeOptions || []), ...current].map((option: any) => [option.value, option])).values())
  }, [cableTypeOptions, item?.cable_type])

  const clearFieldError = useCallback((field: string) => {
    setFormErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }, [])

  const updateField = useCallback((field: string, value: any) => {
    setFormData((current) => ({ ...current, [field]: value }))
    clearFieldError(field)
  }, [clearFieldError])

  const validateForm = useCallback((draft = formData) => {
    const nextErrors: Record<string, string> = {}
    const sourceDeviceId = Number(draft.source_device_id)
    const targetDeviceId = Number(draft.target_device_id)
    const sourcePort = String(draft.source_port || '').trim()
    const targetPort = String(draft.target_port || '').trim()
    const sourceIp = String(draft.source_ip || '').trim()
    const targetIp = String(draft.target_ip || '').trim()
    const requestLink = String(draft.request_link || '').trim()
    const speed = draft.speed_gbps === '' || draft.speed_gbps == null ? null : Number(draft.speed_gbps)
    const sourceVlan = draft.source_vlan === '' || draft.source_vlan == null ? null : Number(draft.source_vlan)
    const targetVlan = draft.target_vlan === '' || draft.target_vlan == null ? null : Number(draft.target_vlan)

    const isValidIp = (value: string) => {
      if (!value) return true
      if (/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) {
        return value.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255)
      }
      return /^[0-9a-fA-F:]+$/.test(value) && value.includes(':')
    }

    const isValidUrl = (value: string) => {
      if (!value) return true
      try {
        const parsed = new URL(value)
        return ['http:', 'https:'].includes(parsed.protocol) && Boolean(parsed.hostname)
      } catch {
        return false
      }
    }

    if (!Number.isFinite(sourceDeviceId) || sourceDeviceId <= 0) nextErrors.source_device_id = 'Source device is required.'
    if (!Number.isFinite(targetDeviceId) || targetDeviceId <= 0) nextErrors.target_device_id = 'Peer device is required.'
    if (!sourcePort) nextErrors.source_port = 'Source port is required.'
    if (!targetPort) nextErrors.target_port = 'Peer port is required.'
    if (!draft.link_type) nextErrors.link_type = 'Connection type is required.'
    if (!draft.status) nextErrors.status = 'Status is required.'
    if (!draft.direction) nextErrors.direction = 'Direction is required.'
    if (!draft.unit) nextErrors.unit = 'Unit is required.'
    if (sourceDeviceId === targetDeviceId && sourceDeviceId > 0) nextErrors.target_device_id = 'Peer device must be different from source.'
    if (sourceIp && !isValidIp(sourceIp)) nextErrors.source_ip = 'Source IP must be a valid IPv4 or IPv6 address.'
    if (targetIp && !isValidIp(targetIp)) nextErrors.target_ip = 'Peer IP must be a valid IPv4 or IPv6 address.'
    if (requestLink && !isValidUrl(requestLink)) nextErrors.request_link = 'Request link must be a valid http/https URL.'
    if (speed != null && (!Number.isFinite(speed) || speed <= 0)) nextErrors.speed_gbps = 'Speed must be greater than zero.'
    if (sourceVlan != null && (!Number.isInteger(sourceVlan) || sourceVlan < 0 || sourceVlan > 4094)) nextErrors.source_vlan = 'Source VLAN must be between 0 and 4094.'
    if (targetVlan != null && (!Number.isInteger(targetVlan) || targetVlan < 0 || targetVlan > 4094)) nextErrors.target_vlan = 'Peer VLAN must be between 0 and 4094.'
    if (draft.farm && mergedFarmOptions.length > 0 && !mergedFarmOptions.some((option: any) => option.value === draft.farm)) nextErrors.farm = 'Select a valid farm.'
    if (draft.cable_type && mergedCableTypeOptions.length > 0 && !mergedCableTypeOptions.some((option: any) => option.value === draft.cable_type)) nextErrors.cable_type = 'Select a valid cable type.'
    if (draft.link_type && mergedLinkPurposeOptions.length > 0 && !mergedLinkPurposeOptions.some((option: any) => option.value === draft.link_type)) nextErrors.link_type = 'Select a valid connection type.'

    return nextErrors
  }, [formData, mergedCableTypeOptions, mergedFarmOptions, mergedLinkPurposeOptions])

  const mutation = useMutation({
    mutationFn: async () => {
      setIsSaving(true)
      const payload = sanitizeNetworkConnectionPayload(formData)
      const url = item?.id ? `/api/v1/networks/connections/${item.id}` : '/api/v1/networks/connections'
      const method = item?.id ? 'PUT' : 'POST'
      const res = await apiFetch(url, { method, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['network-connections'] })
      setIsSaving(false)
      onSuccess?.()
    },
    onError: (error: any) => {
      setIsSaving(false)
      showWorkspaceToast(error?.message || 'Failed to save network connection', { type: 'error' })
    },
  })

  const handleSave = useCallback(() => {
    const nextErrors = validateForm()
    setFormErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      showWorkspaceToast('Fix the highlighted network fields before saving.', { type: 'error' })
      return
    }
    mutation.mutate()
  }, [mutation, validateForm])

  const fieldClass = useCallback((field: string) => networkInputClass(formErrors[field]), [formErrors])
  const formTitle = item?.id ? getNetworkConnectionTitle(item) : 'Create Network Connection'

  return (
    <WorkspaceModal
      isOpen={true}
      onClose={onClose}
      isDirty={isDirty}
      size="workspace"
      isMaximized={isMaximized}
      onMaximizeToggle={() => setIsMaximized(!isMaximized)}
      title={
        <div className="flex items-center gap-3">
          <span>{item?.id ? 'Edit Network Connection' : 'Create Network Connection'}</span>
          {item?.id && <WorkspaceShareHeader id={String(item.id)} title={formTitle} />}
        </div>
      }
      subtitle={item?.id ? `Connection ID ${item.id}` : 'Create a new network connection'}
      icon={<Network size={20} />}
      status={
        <div className="flex items-center gap-2">
          <StatusPill value={formData.status} />
          <StatusPill value={formData.link_type || 'N/A'} />
          <StatusPill value={formData.direction || 'N/A'} />
        </div>
      }
      footerRight={
        <div className="flex items-center gap-3">
          <ToolbarButton onClick={onClose}>Cancel</ToolbarButton>
          <ToolbarButton onClick={handleSave} disabled={isSaving} variant="primary">
            {isSaving ? 'Saving...' : 'Save Connection'}
          </ToolbarButton>
        </div>
      }
    >
      <WorkspaceDossierShell
        body={
          <div className="space-y-6">
            <section className="grid gap-4 xl:grid-cols-2">
              <WorkspaceSectionCard title="Source Endpoint">
                <div className="space-y-4">
                  <OperationalAssetSelector
                    label="Source Device"
                    required
                    assets={assetOptions}
                    value={formData.source_device_id}
                    onChange={(value) => updateField('source_device_id', value)}
                    error={formErrors.source_device_id}
                    placeholder="Select source device"
                    selectedAssetLabel={(asset) => `${asset.name} [${asset.type || asset.system || 'Asset'}]`}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <FieldLabel label="Source Port" required />
                      <input value={formData.source_port} onChange={(e) => updateField('source_port', e.target.value)} placeholder="Source port" className={fieldClass('source_port')} />
                      <FieldError message={formErrors.source_port} />
                    </div>
                    <div>
                      <FieldLabel label="Source VLAN" />
                      <input type="number" min="0" max="4094" step="1" value={formData.source_vlan} onChange={(e) => updateField('source_vlan', e.target.value)} placeholder="0-4094" className={fieldClass('source_vlan')} />
                      <FieldError message={formErrors.source_vlan} />
                    </div>
                    <div>
                      <FieldLabel label="Source IP" />
                      <input value={formData.source_ip} onChange={(e) => updateField('source_ip', e.target.value)} placeholder="192.168.1.10" className={fieldClass('source_ip')} />
                      <FieldError message={formErrors.source_ip} />
                    </div>
                    <div>
                      <FieldLabel label="Source MAC" />
                      <input value={formData.source_mac} onChange={(e) => updateField('source_mac', e.target.value)} placeholder="00:11:22:33:44:55" className={fieldClass('source_mac')} />
                    </div>
                  </div>
                </div>
              </WorkspaceSectionCard>

              <WorkspaceSectionCard title="Peer Endpoint">
                <div className="space-y-4">
                  <OperationalAssetSelector
                    label="Peer Device"
                    required
                    assets={assetOptions}
                    value={formData.target_device_id}
                    onChange={(value) => updateField('target_device_id', value)}
                    error={formErrors.target_device_id}
                    placeholder="Select peer device"
                    selectedAssetLabel={(asset) => `${asset.name} [${asset.type || asset.system || 'Asset'}]`}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <FieldLabel label="Peer Port" required />
                      <input value={formData.target_port} onChange={(e) => updateField('target_port', e.target.value)} placeholder="Peer port" className={fieldClass('target_port')} />
                      <FieldError message={formErrors.target_port} />
                    </div>
                    <div>
                      <FieldLabel label="Peer VLAN" />
                      <input type="number" min="0" max="4094" step="1" value={formData.target_vlan} onChange={(e) => updateField('target_vlan', e.target.value)} placeholder="0-4094" className={fieldClass('target_vlan')} />
                      <FieldError message={formErrors.target_vlan} />
                    </div>
                    <div>
                      <FieldLabel label="Peer IP" />
                      <input value={formData.target_ip} onChange={(e) => updateField('target_ip', e.target.value)} placeholder="192.168.1.11" className={fieldClass('target_ip')} />
                      <FieldError message={formErrors.target_ip} />
                    </div>
                    <div>
                      <FieldLabel label="Peer MAC" />
                      <input value={formData.target_mac} onChange={(e) => updateField('target_mac', e.target.value)} placeholder="00:11:22:33:44:66" className={fieldClass('target_mac')} />
                    </div>
                  </div>
                </div>
              </WorkspaceSectionCard>
            </section>

            <section className="grid gap-4">
              <WorkspaceSectionCard title="Connection Metadata">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <AppDropdown
                      label="Connection Type"
                      value={formData.link_type}
                      onChange={(value) => updateField('link_type', value)}
                      options={mergedLinkPurposeOptions}
                      placeholder="Select connection type"
                    />
                    <FieldError message={formErrors.link_type} />
                  </div>
                  <div>
                    <AppDropdown
                      label="Status"
                      value={formData.status}
                      onChange={(value) => updateField('status', value)}
                      options={NETWORK_STATUSES.map((value) => ({ value, label: value }))}
                      placeholder="Select status"
                    />
                    <FieldError message={formErrors.status} />
                  </div>
                  <div>
                    <FieldLabel label="Speed" />
                    <input type="number" step="0.1" min="0" value={formData.speed_gbps} onChange={(e) => updateField('speed_gbps', e.target.value)} placeholder="10" className={fieldClass('speed_gbps')} />
                    <FieldError message={formErrors.speed_gbps} />
                  </div>
                  <div>
                    <AppDropdown
                      label="Unit"
                      value={formData.unit}
                      onChange={(value) => updateField('unit', value)}
                      options={NETWORK_UNITS.map((value) => ({ value, label: value }))}
                      placeholder="Select unit"
                    />
                    <FieldError message={formErrors.unit} />
                  </div>
                  <div>
                    <AppDropdown
                      label="Direction"
                      value={formData.direction}
                      onChange={(value) => updateField('direction', value)}
                      options={NETWORK_DIRECTIONS.map((value) => ({ value, label: value }))}
                      placeholder="Select direction"
                    />
                    <FieldError message={formErrors.direction} />
                  </div>
                  <div>
                    <AppDropdown
                      label="Farm"
                      value={formData.farm}
                      onChange={(value) => updateField('farm', value)}
                      options={mergedFarmOptions}
                      placeholder="Select farm"
                    />
                    <FieldError message={formErrors.farm} />
                  </div>
                  <div>
                    <AppDropdown
                      label="Cable Type"
                      value={formData.cable_type}
                      onChange={(value) => updateField('cable_type', value)}
                      options={mergedCableTypeOptions}
                      placeholder="Select cable type"
                    />
                    <FieldError message={formErrors.cable_type} />
                  </div>
                  <div className="sm:col-span-2">
                    <FieldLabel label="Request Link" />
                    <input type="url" value={formData.request_link} onChange={(e) => updateField('request_link', e.target.value)} placeholder="https://..." className={fieldClass('request_link')} />
                    <FieldError message={formErrors.request_link} />
                  </div>
                  <div className="sm:col-span-2">
                    <FieldLabel label="Purpose" />
                    <textarea value={formData.purpose} onChange={(e) => updateField('purpose', e.target.value)} placeholder="Why this connection exists" className={`${fieldClass('purpose')} min-h-[110px]`} />
                    <FieldError message={formErrors.purpose} />
                  </div>
                </div>
              </WorkspaceSectionCard>
            </section>
          </div>
        }
      />
    </WorkspaceModal>
  )
}

function NetworkHistoryModal({ item, onClose }: any) {
  useEscapeDismiss(onClose)
  useBodyModalFlag()
  const [isMaximized, setIsMaximized] = useState(false)
  const queryClient = useQueryClient()
  const { data: history, isLoading } = useQuery({
    queryKey: ['network-history', item.id],
    queryFn: async () => (await apiFetch(`/api/v1/networks/connections/${item.id}/history`)).json()
  })

  const [selectedIndices, setSelectedIndices] = useState<number[]>([0])

  const toggleSelection = (idx: number) => {
    if (selectedIndices.includes(idx)) {
       if (selectedIndices.length > 1) {
          setSelectedIndices(selectedIndices.filter(i => i !== idx))
       }
    } else {
       if (selectedIndices.length === 2) {
          setSelectedIndices([selectedIndices[1], idx])
       } else {
          setSelectedIndices([...selectedIndices, idx].sort((a, b) => a - b))
       }
    }
  }

  const indexedVersions = (history || []).map((h: any, i: number) => ({
    ...h,
    v_num: h.version,
    label: formatAppDate(h.created_at)
  }))

  const newer = indexedVersions?.[Math.min(...selectedIndices)]
  const older = selectedIndices.length > 1 
    ? indexedVersions?.[Math.max(...selectedIndices)] 
    : (selectedIndices[0] + 1 < indexedVersions.length ? indexedVersions[selectedIndices[0] + 1] : null)

  const getDiff = (curr: any, prev: any) => {
    if (!curr) return []
    const isImmediatePrevious = !prev || curr.previous_version === prev.version
    if (isImmediatePrevious && Array.isArray(curr.delta)) {
      return curr.delta.map((entry: any) => ({
        field: entry.field,
        label: entry.label || String(entry.field || '').replace(/_/g, ' '),
        old: entry.before,
        new: entry.after,
        changeType: entry.change_type || 'changed',
      }))
    }

    const s1 = curr.snapshot || {}
    const s2 = prev?.snapshot || {}
    const keys = Array.from(new Set([...Object.keys(s1), ...Object.keys(s2)]))
    return keys.filter(k => {
      if (['updated_at', 'created_at', 'id', 'version', 'is_deleted', 'monitored_service_names', 'recovery_doc_titles', 'device_name'].includes(k)) return false
      return JSON.stringify(s1[k]) !== JSON.stringify(s2[k])
    }).map(k => ({
      field: k,
      label: k.replace(/_/g, ' '),
      old: s2[k],
      new: s1[k],
      changeType: s2[k] == null ? 'added' : s1[k] == null ? 'removed' : 'changed',
    }))
  }

  const diffs = getDiff(newer, older)

  return (
    <WorkspaceModal
      isOpen={true}
      onClose={onClose}
      size="workspace"
      isMaximized={isMaximized}
      onMaximizeToggle={() => setIsMaximized(!isMaximized)}
      title="Change History"
      subtitle={`Temporal lineage for ${item.title}`}
      icon={<HistoryIcon size={20} />}
      status={
        <div className="flex items-center gap-4">
          <StatusPill value={item?.status} />
          <div className="h-4 w-px bg-white/10" />
          <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest italic whitespace-nowrap">
            {indexedVersions?.length || 0} Snapshot(s)
          </p>
        </div>
      }
      footerRight={
        <ToolbarButton onClick={onClose}>Dismiss</ToolbarButton>
      }
    >
      <WorkspaceHistoryShell
          header={null}
          sidebar={
           <div className="flex h-full flex-col min-h-0">
              <div className="mb-4 flex items-center justify-between px-1">
                 <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Change Timeline</h3>
                 <span className="text-[9px] font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/20">{indexedVersions.length} revisions</span>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                {isLoading ? (
                   <div className="flex flex-col items-center justify-center py-20 space-y-4">
                      <RefreshCcw size={24} className="animate-spin text-blue-500" />
                      <span className="text-[10px] font-black text-blue-500 animate-pulse uppercase tracking-widest">Syncing revisions...</span>
                   </div>
                ) : (
                  indexedVersions.map((h: any, idx: number) => {
                    const isSelected = selectedIndices.includes(idx);
                    const isNewest = idx === Math.min(...selectedIndices);
                    return (
                      <button 
                        key={h.id}
                        onClick={() => toggleSelection(idx)}
                        className={`w-full p-4 rounded-lg border text-left transition-all relative group overflow-hidden ${
                          isSelected 
                            ? isNewest ? 'bg-blue-600/20 border-blue-500/40 shadow-lg shadow-blue-500/5' : 'bg-slate-800 border-slate-600' 
                            : 'bg-white/5 border-white/5 hover:border-white/10'
                        }`}
                      >
                        {isSelected && (
                          <div className={`absolute top-0 right-0 px-2 py-0.5 text-[8px] font-black uppercase rounded-lg ${isNewest ? 'bg-blue-400 text-blue-950' : 'bg-slate-500 text-slate-200'}`}>
                             {isNewest ? 'Primary' : 'Ref'}
                          </div>
                        )}
                        <div className="flex items-center justify-between mb-2">
                           <span className={`text-[11px] font-black tracking-tighter ${isSelected ? 'text-white' : 'text-blue-400'}`}>v{h.v_num}</span>
                           <span className={`text-[9px] font-bold ${isSelected ? 'text-white/60' : 'text-slate-500'}`}>
                              {formatAppDay(h.created_at)}
                           </span>
                        </div>
                        <p className={`text-[10px] font-bold leading-tight line-clamp-2 ${isSelected ? 'text-white/90' : 'text-slate-300'}`}>
                           {h.change_summary || 'Connection Modification'}
                        </p>
                        {Array.isArray(h.changed_labels) && h.changed_labels.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {h.changed_labels.slice(0, 3).map((label: string) => (
                              <span key={label} className="rounded-lg border border-white/10 bg-white/5 px-1.5 py-0.5 text-[8px] font-bold text-slate-400">
                                {label}
                              </span>
                            ))}
                            {h.changed_labels.length > 3 && (
                              <span className="rounded-lg border border-white/10 bg-white/5 px-1.5 py-0.5 text-[8px] font-bold text-slate-500">
                                +{h.changed_labels.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                        <div className="mt-2 flex items-center space-x-2 justify-between">
                           <div className="flex items-center space-x-2">
                             <Clock size={10} className={isSelected ? 'text-white/40' : 'text-slate-600'} />
                             <span className={`text-[8px] font-semibold ${isSelected ? 'text-white/40' : 'text-slate-600'}`}>
                                {formatAppTime(h.created_at)}
                             </span>
                           </div>
                           <button 
                             onClick={(e) => {
                               e.stopPropagation();
                               toast.promise(apiFetch(`/api/v1/networks/connections/${item.id}/restore/${h.id}`, { method: 'POST' }), {
                                   loading: 'Restoring state...',
                                   success: () => { queryClient.invalidateQueries({ queryKey: ['network-connections'] }); queryClient.invalidateQueries({ queryKey: ['network-history', item.id] }); return "Restored successfully"; },
                                   error: "Restore failed"
                               })
                             }}
                             className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-lg ${isSelected ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/40' : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'}`}
                           >
                             Restore
                           </button>
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
           </div>
          }
          content={
           <>
              <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/5 backdrop-blur-md sticky top-0 z-10">
                 <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                       <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 text-[12px] font-black">v{newer?.v_num}</div>
                       <div className="w-4 h-px bg-slate-700" />
                       <div className="w-8 h-8 rounded-lg bg-slate-800 border border-white/10 flex items-center justify-center text-slate-500 text-[12px] font-black">{older ? `v${older.v_num}` : 'Ø'}</div>
                    </div>
                    <div>
                       <h3 className="text-[11px] font-black text-slate-300 uppercase tracking-widest">Semantic Delta</h3>
                       <p className="text-[9px] font-bold text-slate-600">{diffs.length} modification vectors detected</p>
                    </div>
                 </div>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
                 {diffs.length > 0 ? (
                    <div className="space-y-6">
                       <div className="overflow-hidden rounded-lg border border-white/5 bg-black/20">
                          <table className="w-full text-left border-collapse">
                             <thead>
                                <tr className="bg-white/5 text-[9px] font-black uppercase text-slate-500 tracking-widest">
                                   <th className="p-4 w-1/4">Property</th>
                                   <th className="p-4 w-3/8 text-rose-500/70">Previous (v{older?.v_num || 'Ø'})</th>
                                   <th className="p-4 w-3/8 text-emerald-500/70">Current (v{newer?.v_num})</th>
                                </tr>
                             </thead>
                             <tbody className="divide-y divide-white/5">
                                {diffs.map((d: any, i: number) => (
                                   <tr key={`${i}-row`} className="hover:bg-white/[0.02] transition-colors">
                                      <td className="p-4 align-top">
                                         <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{d.label || d.field}</span>
                                      </td>
                                      <td className="p-4 align-top">
                                         <div className={`rounded-lg p-3 overflow-hidden ${d.changeType === 'added' ? 'bg-slate-500/5 border border-slate-500/10' : 'bg-rose-500/5 border border-rose-500/10'}`}>
                                            <pre className={`text-[10px] whitespace-pre-wrap font-mono leading-relaxed break-all ${d.changeType === 'added' ? 'text-slate-600' : 'text-slate-500 line-through'}`}>
                                               {typeof d.old === 'object' ? JSON.stringify(d.old, null, 2) : String(d.old ?? '(empty)')}
                                            </pre>
                                         </div>
                                      </td>
                                      <td className="p-4 align-top">
                                         <div className={`rounded-lg p-3 overflow-hidden ${d.changeType === 'removed' ? 'bg-slate-500/5 border border-slate-500/10' : 'bg-emerald-500/5 border border-emerald-500/10'}`}>
                                            <pre className={`text-[10px] whitespace-pre-wrap font-mono font-bold leading-relaxed break-all ${d.changeType === 'removed' ? 'text-slate-500' : 'text-emerald-400'}`}>
                                               {typeof d.new === 'object' ? JSON.stringify(d.new, null, 2) : String(d.new ?? '(empty)')}
                                            </pre>
                                         </div>
                                      </td>
                                   </tr>
                                ))}
                             </tbody>
                          </table>
                       </div>
                    </div>
                 ) : !isLoading ? (
                    <WorkspaceEmptyState icon={<HistoryIcon size={32} />} title="No Diff Data" description="Select two revisions to compare or pick a revision to see changes from its predecessor." />
                 ) : null}
              </div>
           </>
          }
      />
    </WorkspaceModal>
  )
}
