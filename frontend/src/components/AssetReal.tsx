import { BkmListModal, BkmDetailModal, MonitoringForm } from './monitoring/Modals'
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
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
  Download, Copy, ChevronDown, ChevronUp, Layers, RefreshCcw, Tag, Sliders, Clipboard, Lightbulb, Maximize2, Minimize2, Star, GitCompare, Undo2, List, LayoutGrid, Upload, Terminal, History as HistoryIcon, Edit2 as EditIcon
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { showWorkspaceToast } from './shared/WorkspaceToast'
import {
  computeFloatingPanelRect,
} from './shared/OperationalGridInteractions'
import { apiFetch } from '../api/apiClient'
import { buildMonitoringFormErrors, getMonitoringTabErrorCounts } from '../utils/monitoringValidation'
import { buildAssetScalarErrors } from '../utils/assetValidation'
import { formatAppDate, formatAppTime, formatAppDay, parseAppDate } from '../utils/dateUtils'
import { AppDropdown } from './shared/AppDropdown'
import { ConfigRegistryModal } from "./ConfigRegistry"
import { ConfirmationModal } from "./shared/ConfirmationModal"
import { MONITORING_WORKSPACE_STANDARD } from './shared/OperationalWorkspace'
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
  WorkspaceSelectField as MonitoringSelectField,
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
import { isDeepEqual, parseCommaSeparatedValues } from '../utils/dataParsers'
import { HeaderScopeSwitch, ToolbarButton, ToolbarGroup, ToolbarIconButton, ToolbarSearch } from './shared/LayoutPrimitives'
import { useOperationalGridLayout, usePersistentJsonState, useWorkspaceDismissHandlers, useWorkspaceSessionValue } from './shared/OperationalWorkspaceHooks'
import { WorkspaceCompareShell, WorkspaceDossierShell, WorkspaceHistoryShell } from './shared/WorkspaceModalShells'
import { WorkspaceShareHeader } from './shared/WorkspaceShareHeader'
import { OperationalImportModal } from './shared/OperationalImportModal'
import { OperationalGridMatrix } from './shared/OperationalGridMatrix'
import { OperationalDisplayPanel, OperationalGridSurface, OperationalSavedViewsPanel, OperationalWorkspaceFrame } from './shared/OperationalWorkspaceShells'
import { AssetDetailsView } from './assets/AssetDetailsView'
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

const MONITORING_VIEW_STORAGE_KEY = 'sysgrid_asset_real_views_v1'
const MONITORING_ACTIVE_VIEW_KEY = 'sysgrid_asset_real_active_view_v1'
const MONITORING_FAVORITES_STORAGE_KEY = 'sysgrid_asset_real_favorites_v1'
const MONITORING_UI_STATE_KEY = 'sysgrid_asset_real_ui_state_v1'
const MONITORING_WATCH_STORAGE_KEY = 'sysgrid_asset_real_watch_v1'
const MONITORING_WORKSPACE_PREFERENCE_KEY = 'asset_real_workspace_state_v1'
const MONITORING_WORKSPACE_PREFERENCE_VERSION = 2
const BULK_MENU_MAX_HEIGHT = 560
const MONITORING_FIXED_WIDTH_COLUMN_IDS = new Set([
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

export interface MonitoringLogicEntry {
  id: number
  type: string
  description: string
  logic_info: string
}

export interface MonitoringOwner {
  operator_id: number
  role: string
  name: string
  external_id: string
}

export type MonitoringFormErrors = Record<string, string>
export interface MonitoringTeamOption {
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

type AssetLifecycleOperation = Readonly<{
  ids: readonly number[]
  originalAction: 'delete' | 'restore'
  inverseAction: 'restore' | 'delete'
  targetLabels: readonly string[]
}>


const MONITORING_SEVERITIES = [
  { value: 'Critical', label: 'Critical', color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
  { value: 'Warning', label: 'Warning', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  { value: 'Info', label: 'Info', color: 'bg-sky-500/20 text-sky-400 border-sky-500/30' }
]

const MONITORING_OWNER_ROLES = [
  { value: 'Primary Support', label: 'Primary Support' },
  { value: 'Escalation', label: 'Escalation' },
  { value: 'Observer', label: 'Observer' }
]

const MONITORING_REQUIRED_FIELD_NAMES = new Set(['title', 'category', 'status', 'severity'])

const DEFAULT_MONITORING_VIEWS = []
const DEFAULT_MONITORING_VIEW_IDS = new Set(DEFAULT_MONITORING_VIEWS.map((view) => view.id))
const MONITORING_SUPPORTS_COMPARE = MONITORING_WORKSPACE_STANDARD.sharedCapabilities.includes('compare')
const MONITORING_VALID_GROUP_BY = new Set(['raw', 'status', 'system', 'type', 'owner'])
const MONITORING_PERSISTED_COLUMN_IDS = new Set([
  'select',
  'id',
  'recent_change',
  'favorite',
  'watch',
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
  'created_at',
  'updated_at',
  'row_actions',
])
const ASSET_DEFAULT_COLUMN_ORDER = [
  'select',
  'id',
  'recent_change',
  'favorite',
  'watch',
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
  'created_at',
  'updated_at',
  'row_actions',
]
const ASSET_DEFAULT_COLUMN_ORDER_MAP = new Map(ASSET_DEFAULT_COLUMN_ORDER.map((colId, index) => [colId, index]))
const NETWORK_DEFAULT_COLUMN_ORDER_MAP = ASSET_DEFAULT_COLUMN_ORDER_MAP

const readJsonStorage = <T,>(storageKey: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw == null ? fallback : JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const normalizeMonitoringIdList = (value: any): number[] => {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry) && entry > 0)
  ))
}

const normalizeMonitoringQuickFilters = (value: any) => ({
  status: Array.isArray(value?.status) ? value.status.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [],
  system: Array.isArray(value?.system) ? value.system.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [],
  type: Array.isArray(value?.type) ? value.type.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [],
  owner: Array.isArray(value?.owner) ? value.owner.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [],
})

const normalizeMonitoringSavedViews = (value: any) => {
  const parsed = Array.isArray(value) ? value : []
  const systemIds = new Set(DEFAULT_MONITORING_VIEWS.map((view) => view.id))
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
    ...DEFAULT_MONITORING_VIEWS.map((view) => parsed.find((entry: any) => entry?.id === view.id) || view),
    ...customViews.map((view: any) => ({
      ...view,
      config: sanitizeMonitoringViewConfig(view?.config),
    })),
  ]
}

const sanitizeMonitoringViewConfig = (config: any) => {
  const safeConfig = config && typeof config === 'object' ? config : {}
  const sanitizeNetworkLayout = (layout: any[], preserveWidths: boolean) => {
    const sanitized = sanitizeOperationalColumnLayout(layout, MONITORING_PERSISTED_COLUMN_IDS, preserveWidths)
    return [...sanitized].sort((a: any, b: any) => {
      const aIndex = NETWORK_DEFAULT_COLUMN_ORDER_MAP.get(a?.colId) ?? 1000
      const bIndex = NETWORK_DEFAULT_COLUMN_ORDER_MAP.get(b?.colId) ?? 1000
      return aIndex - bIndex
    })
  }
  return {
    fontSize: Number.isFinite(safeConfig.fontSize) ? safeConfig.fontSize : 11,
    rowDensity: Number.isFinite(safeConfig.rowDensity) ? safeConfig.rowDensity : 8,
    hiddenColumns: Array.isArray(safeConfig.hiddenColumns)
      ? safeConfig.hiddenColumns.filter((entry: any) => typeof entry === 'string' && MONITORING_PERSISTED_COLUMN_IDS.has(entry))
      : [],
    groupBy: typeof safeConfig.groupBy === 'string' && MONITORING_VALID_GROUP_BY.has(safeConfig.groupBy) ? safeConfig.groupBy : 'raw',
    showFilterBar: safeConfig.showFilterBar !== false,
    columnLayoutState: sanitizeNetworkLayout(Array.isArray(safeConfig.columnLayoutState) ? safeConfig.columnLayoutState : [], true),
    quickFilter: typeof safeConfig.quickFilter === 'string' ? safeConfig.quickFilter : '',
    quickFilters: normalizeMonitoringQuickFilters(safeConfig.quickFilters),
    filterModel: sanitizeOperationalFilterModel(safeConfig.filterModel, MONITORING_PERSISTED_COLUMN_IDS),
    sortModel: sanitizeOperationalSortModel(safeConfig.sortModel, MONITORING_PERSISTED_COLUMN_IDS),
  }
}

const normalizeMonitoringWorkspaceState = (value: any) => {
  if (!value || typeof value !== 'object') return null
  const uiState = value.uiState && typeof value.uiState === 'object' ? value.uiState : {}
  const normalized = {
    version: MONITORING_WORKSPACE_PREFERENCE_VERSION,
    savedViews: normalizeMonitoringSavedViews(value.savedViews),
    activeViewId: typeof value.activeViewId === 'string' && value.activeViewId.trim() ? value.activeViewId : null,
    favoriteIds: normalizeMonitoringIdList(value.favoriteIds),
    watchIds: normalizeMonitoringIdList(value.watchIds),
    uiState: {
      activeTab: uiState.activeTab === 'deleted' ? 'deleted' : 'active',
      fontSize: Number.isFinite(uiState.fontSize) ? uiState.fontSize : 11,
      rowDensity: Number.isFinite(uiState.rowDensity) ? uiState.rowDensity : 8,
      hiddenColumns: Array.isArray(uiState.hiddenColumns)
        ? uiState.hiddenColumns.filter((entry: any) => typeof entry === 'string' && MONITORING_PERSISTED_COLUMN_IDS.has(entry))
        : ['created_at', 'updated_at'],
      quickFilters: normalizeMonitoringQuickFilters(uiState.quickFilters),
      groupBy: typeof uiState.groupBy === 'string' && MONITORING_VALID_GROUP_BY.has(uiState.groupBy) ? uiState.groupBy : 'raw',
      showFilterBar: uiState.showFilterBar !== false,
      columnLayoutState: sanitizeMonitoringViewConfig({ columnLayoutState: Array.isArray(uiState.columnLayoutState) ? uiState.columnLayoutState : [] }).columnLayoutState,
      lastVisitedAt: Number.isFinite(uiState.lastVisitedAt) ? uiState.lastVisitedAt : 0,
      searchTerm: typeof uiState.searchTerm === 'string' ? uiState.searchTerm : '',
    }
  }
  return normalized
}

const readMonitoringWorkspaceStateFromLocalStorage = () => normalizeMonitoringWorkspaceState({
  savedViews: readJsonStorage<any[]>(MONITORING_VIEW_STORAGE_KEY, []),
  activeViewId: typeof window === 'undefined' ? null : window.localStorage.getItem(MONITORING_ACTIVE_VIEW_KEY),
  favoriteIds: readJsonStorage<number[]>(MONITORING_FAVORITES_STORAGE_KEY, []),
  watchIds: readJsonStorage<number[]>(MONITORING_WATCH_STORAGE_KEY, []),
  uiState: readJsonStorage(MONITORING_UI_STATE_KEY, null),
})

const slugifyViewId = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `view-${Date.now()}`

const FLOATING_PANEL_EDGE = 16

const getAnchoredFloatingStyle = ({
  rect,
  width,
  height,
  zIndex,
  offset = 4
}: {
  rect: DOMRect
  width: number
  height: number
  zIndex: number
  offset?: number
}) => {
  const vW = window.innerWidth
  const vH = window.innerHeight

  // Pivot logic: align right edge of menu to right edge of trigger
  let left = rect.right - width
  let top = rect.bottom + offset

  // Viewport containment and flipping
  if (left < FLOATING_PANEL_EDGE) left = rect.left
  if (top + height > vH - FLOATING_PANEL_EDGE) top = rect.top - height - offset

  left = Math.max(FLOATING_PANEL_EDGE, Math.min(left, vW - width - FLOATING_PANEL_EDGE))
  top = Math.max(FLOATING_PANEL_EDGE, Math.min(top, vH - height - FLOATING_PANEL_EDGE))

  return {
    position: 'fixed' as const,
    top: Math.floor(top),
    left: Math.floor(left),
    width,
    maxHeight: `calc(100vh - ${FLOATING_PANEL_EDGE * 2}px)`,
    zIndex
  }
}

const getPointFloatingStyle = ({
  x,
  y,
  width,
  height,
  zIndex,
}: {
  x: number
  y: number
  width: number
  height: number
  zIndex: number
}) => {
  const rect = computeFloatingPanelRect({
    x,
    y,
    preferredWidth: width,
    preferredHeight: height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  })

  return {
    position: 'fixed' as const,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    maxHeight: rect.maxHeight,
    zIndex,
  }
}

// Isolated component to prevent UI state changes (menus) from triggering AgGrid recalculations
const getMonitorGroupValue = (item: any, field: string) => {
  if (field === 'notification_method') return item.notification_method || 'No notification path'
  return item[field] || 'Unspecified'
}

const readMonitoringUiState = () => {
  return readMonitoringWorkspaceStateFromLocalStorage()?.uiState ?? null
}

export interface MonitoringRecoveryDoc {
  id: number
  note?: string
  added_at?: string
}

const sanitizeMonitoringPayload = (item: any) => {
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

const ASSET_STATUSES = ['Planned', 'Active', 'Maintenance', 'Standby', 'Failed', 'Decommissioned', 'Provisioning', 'Reserved', 'Deleted']
const ASSET_ENVIRONMENTS = ['Production', 'Staging', 'QA', 'Dev', 'DR', 'Lab', 'Sandbox', 'Legacy']
const ASSET_DEPTHS = ['Full', 'Half']
const ASSET_MOUNT_ORIENTATIONS = ['Front', 'Rear']
const getAssetTitle = (asset: any) => asset?.name || `Asset ${asset?.id ?? ''}`.trim()

const normalizeAssetRecord = (asset: any) => ({
  ...asset,
  name: asset?.name || 'Unnamed Asset',
  system: asset?.system || 'Unassigned',
  type: asset?.type || 'Physical',
  status: asset?.status || 'Active',
  environment: asset?.environment || 'Production',
  owner: asset?.owner || '',
  manufacturer: asset?.manufacturer || '',
  model: asset?.model || '',
  os_name: asset?.os_name || '',
  os_version: asset?.os_version || '',
  primary_ip: asset?.primary_ip || '',
  management_ip: asset?.management_ip || '',
  hardware_summary: asset?.hardware_summary || 'No Components',
  hardware_age: asset?.hardware_age || 'N/A',
  open_incident_count: Number(asset?.open_incident_count || 0),
  site_name: asset?.site_name || '',
  rack_name: asset?.rack_name || '',
  depth: asset?.depth || asset?.mount_depth || 'Full',
  mount_orientation: asset?.mount_orientation || 'Front',
  u_start: asset?.u_start ?? null,
  size_u: asset?.size_u ?? asset?.u_size ?? 1,
  power_typical_w: Number(asset?.power_typical_w || 0),
  power_max_w: Number(asset?.power_max_w || 0),
  created_at: asset?.created_at || asset?.updated_at || null,
  updated_at: asset?.updated_at || asset?.created_at || null,
  is_deleted: Boolean(asset?.is_deleted),
})

const sanitizeAssetPayload = (item: any) => ({
  name: String(item?.name || '').trim(),
  system: item?.system ? String(item.system).trim() : null,
  environment: item?.environment ? String(item.environment).trim() : 'Production',
  status: item?.status ? String(item.status).trim() : 'Active',
  type: item?.type ? String(item.type).trim() : 'Physical',
  manufacturer: item?.manufacturer ? String(item.manufacturer).trim() : null,
  model: item?.model ? String(item.model).trim() : null,
  serial_number: item?.serial_number ? String(item.serial_number).trim() : '',
  asset_tag: item?.asset_tag ? String(item.asset_tag).trim() : '',
  os_name: item?.os_name ? String(item.os_name).trim() : null,
  os_version: item?.os_version ? String(item.os_version).trim() : null,
  management_ip: item?.management_ip ? String(item.management_ip).trim() : null,
  primary_ip: item?.primary_ip ? String(item.primary_ip).trim() : null,
  management_url: item?.management_url ? String(item.management_url).trim() : null,
  owner: item?.owner ? String(item.owner).trim() : null,
  business_unit: item?.business_unit ? String(item.business_unit).trim() : null,
  role: item?.role ? String(item.role).trim() : null,
  purchase_date: item?.purchase_date || null,
  install_date: item?.install_date || null,
  warranty_end: item?.warranty_end || null,
  eol_date: item?.eol_date || null,
  power_typical_w: item?.power_typical_w === '' || item?.power_typical_w == null ? 0 : Number(item.power_typical_w),
  power_max_w: item?.power_max_w === '' || item?.power_max_w == null ? 0 : Number(item.power_max_w),
  depth: item?.depth ? String(item.depth).trim() : 'Full',
  size_u: item?.size_u === '' || item?.size_u == null ? 1 : Number(item.size_u),
  mount_orientation: item?.mount_orientation ? String(item.mount_orientation).trim() : 'Front',
  metadata_json: item?.metadata_json && typeof item.metadata_json === 'object' ? item.metadata_json : {},
})
const NETWORK_LINK_TYPES = ['Physical', 'Virtual', 'Storage', 'Switch', 'Firewall', 'Load Balancer', 'PDU', 'UPS', 'Console-Server', 'Patch Panel']
const NETWORK_DIRECTIONS = ['Primary', 'Secondary', 'Out-of-band']
const NETWORK_UNITS = ['W', 'U']
const NETWORK_STATUSES = ASSET_STATUSES
const getNetworkConnectionTitle = getAssetTitle
const sanitizeNetworkConnectionPayload = sanitizeAssetPayload

const ObservabilityHUD = ({ items }: any) => {
  const stats = useMemo(() => {
    if (!items?.length) return null
    const active = items.filter((i: any) => i.status === 'Active').length
    const critical = items.filter((i: any) => Number(i.open_incident_count || 0) > 0).length
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
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 group-hover:text-blue-400 transition-colors">Registry Pulse</p>
          <div className="flex items-center gap-4">
             <div className="w-12 h-12 bg-blue-600/10 rounded-lg flex items-center justify-center text-blue-400 border border-blue-500/20">
                <Activity size={24} className="animate-pulse" />
             </div>
             <div>
                <h4 className="text-2xl font-black text-white tracking-tighter">{stats.active} Active Assets</h4>
                <p className="text-[9px] font-bold text-slate-500 uppercase">Live Asset Registry</p>
             </div>
          </div>
       </div>
       <div className="bg-black/40 border border-white/5 p-6 rounded-lg backdrop-blur-xl shadow-xl group hover:border-rose-500/20 transition-all">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 group-hover:text-rose-400 transition-colors">Incident Flux</p>
          <div className="flex items-center gap-4">
             <div className="w-12 h-12 bg-rose-600/10 rounded-lg flex items-center justify-center text-rose-500 border border-rose-500/20">
                <Bell size={24} className={stats.critical > 0 ? 'animate-bounce' : ''} />
             </div>
             <div>
                <h4 className="text-2xl font-black text-white tracking-tighter">{stats.critical} At-Risk Assets</h4>
                <p className="text-[9px] font-bold text-slate-500 uppercase">Immediate Intervention Required</p>
             </div>
          </div>
       </div>
       <div className="bg-black/40 border border-white/5 p-6 rounded-lg backdrop-blur-xl shadow-xl group hover:border-emerald-500/20 transition-all">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 group-hover:text-emerald-400 transition-colors">Registry Momentum</p>
          <div className="flex items-center gap-4">
             <div className="w-12 h-12 bg-emerald-600/10 rounded-lg flex items-center justify-center text-emerald-400 border border-emerald-500/20">
                <Zap size={24} />
             </div>
             <div>
                <h4 className="text-2xl font-black text-white tracking-tighter">{stats.recent} Updated Assets</h4>
                <p className="text-[9px] font-bold text-slate-500 uppercase">Captured in current session</p>
             </div>
          </div>
       </div>
       <div className="bg-indigo-600/10 border border-indigo-500/20 p-6 rounded-lg backdrop-blur-xl shadow-xl flex items-center justify-between group hover:bg-indigo-600/20 transition-all">
          <div>
             <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-1">Registry Stability</p>
             <h4 className="text-2xl font-black text-white tracking-tighter">{stats.critical === 0 ? 'Optimal' : 'Degraded'}</h4>
          </div>
          <Shield size={28} className="text-indigo-500 opacity-20 group-hover:opacity-100 group-hover:scale-110 transition-all" />
       </div>
    </div>
  )
}

export default function AssetReal() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const idParam = searchParams.get('id')
  const queryClient = useQueryClient()
  const gridRef = React.useRef<any>(null)
  const { data: userSettings, isSuccess: hasUserSettings } = useQuery({
    queryKey: ['user-settings'],
    queryFn: async () => (await (await apiFetch('/api/v1/settings/user/settings')).json()),
  })
  const remoteWorkspaceState = useMemo(
    () => normalizeMonitoringWorkspaceState(userSettings?.[MONITORING_WORKSPACE_PREFERENCE_KEY]),
    [userSettings]
  )
  const localWorkspaceState = useMemo(() => readMonitoringWorkspaceStateFromLocalStorage(), [])
  const hasStoredFavoriteIds = useMemo(
    () => typeof window !== 'undefined' && window.localStorage.getItem(MONITORING_FAVORITES_STORAGE_KEY) !== null,
    []
  )
  const hasStoredWatchIds = useMemo(
    () => typeof window !== 'undefined' && window.localStorage.getItem(MONITORING_WATCH_STORAGE_KEY) !== null,
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
  const [showDisplayMenu, setShowDisplayMenu] = useState(false)
  const [showViewsMenu, setShowViewsMenu] = useState(false)
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
  const [recipientPopup, setRecipientPopup] = useState<{ recipients: string[], method: string } | null>(null)
  const [bkmPopup, setBkmPopup] = useState<{ docs: number[], ids: number[], titles: string[], monitorId?: number } | null>(null)
  const [activeBkm, setActiveBkm] = useState<any>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [showBulkEditModal, setShowBulkEditModal] = useState(false)

  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [showBulkMenu, setShowBulkMenu] = useState(false)
  const [isBulkStatusOpen, setIsBulkStatusOpen] = useState(false)
  const [isBulkSeverityOpen, setIsBulkSeverityOpen] = useState(false)
  const [isBulkNotifyOpen, setIsBulkNotifyOpen] = useState(false)
  const [confirmModal, setConfirmModal] = useState<any>({ isOpen: false, title: '', message: '', onConfirm: () => {}, variant: 'info' })
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [detailDeleteConfirm, setDetailDeleteConfirm] = useState(false)
  const [rowDeleteConfirmId, setRowDeleteConfirmId] = useState<number | null>(null)
  const [rowActionMenu, setRowActionMenu] = useState<{ item: any; point: { x: number; y: number } } | null>(null)
  const [isIntelligenceExpanded, setIsIntelligenceExpanded] = useState(false)
  const [gridFilterModel, setGridFilterModel] = useState<Record<string, any>>({})
  const [gridSortModel, setGridSortModel] = useState<any[]>([{ colId: 'favorite', sort: 'desc' }])
  const [savedViews, setSavedViews] = usePersistentJsonState<any[]>(MONITORING_VIEW_STORAGE_KEY, () => {
    return initialWorkspaceState?.savedViews ?? normalizeMonitoringSavedViews([])
  })
  const [activeViewId, setActiveViewId] = useWorkspaceSessionValue<string | null>(
    'sysgrid_asset_real_session_init',
    null,
    () => initialWorkspaceState?.activeViewId ?? (typeof window === 'undefined' ? null : window.localStorage.getItem(MONITORING_ACTIVE_VIEW_KEY))
  )
  const [favoriteIds, setFavoriteIds] = usePersistentJsonState<number[]>(MONITORING_FAVORITES_STORAGE_KEY, initialWorkspaceState?.favoriteIds ?? [])
  const [watchIds, setWatchIds] = usePersistentJsonState<number[]>(MONITORING_WATCH_STORAGE_KEY, initialWorkspaceState?.watchIds ?? [])
  const [quickFilters, setQuickFilters] = useState(persistedUiState?.quickFilters ?? { status: [] as string[], system: [] as string[], type: [] as string[], owner: [] as string[] })
  const [searchTerm, setSearchTerm] = useState(persistedUiState?.searchTerm ?? '')
  const [groupBy, setGroupBy] = useState<string>(persistedUiState?.groupBy ?? 'raw')
  const [bulkDraft, setBulkDraft] = useState({ status: '', link_type: '', direction: '' })
  const [expandedBulkSection, setExpandedBulkSection] = useState<'status' | 'link_type' | 'direction' | null>(null)
  const [lastVisitedAt] = useState<number>(() => persistedUiState?.lastVisitedAt ?? 0)
  const [pendingIds, setPendingIds] = useState<number[]>([])
  const [revertOperation, setRevertOperation] = useState<AssetLifecycleOperation | null>(null)
  const [isReverting, setIsReverting] = useState(false)
  const selectionAnchorRef = useRef<number | null>(null)
  const displayMenuButtonRef = useRef<HTMLButtonElement | null>(null)
  const viewsMenuButtonRef = useRef<HTMLButtonElement | null>(null)
  const bulkMenuButtonRef = useRef<HTMLButtonElement | null>(null)
  const [displayMenuStyle, setDisplayMenuStyle] = useState<React.CSSProperties>({})
  const [viewsMenuStyle, setViewsMenuStyle] = useState<React.CSSProperties>({})
  const [bulkMenuStyle, setBulkMenuStyle] = useState<React.CSSProperties>({})
  const [newViewName, setNewViewName] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const autoSizeFrameRef = useRef<number | null>(null)
  const autoSizeTimeoutRef = useRef<number | null>(null)
  const monitoringPreferenceHydratedRef = useRef(false)
  const monitoringPreferenceMigratedRef = useRef(false)
  const monitoringPreferenceSyncRef = useRef<string | null>(null)
  const monitoringPreferenceSyncTimeoutRef = useRef<number | null>(null)
  const preserveExplicitColumnWidthsRef = useRef(false)
  const {
    columnLayoutState,
    setColumnLayoutState,
    setTransientManualColumnWidths,
    preserveExplicitColumnWidths,
    syncColumnLayoutState,
    applyColumnLayoutState,
    handleColumnResized,
  } = useOperationalGridLayout(persistedUiState?.columnLayoutState ?? [], Boolean(activeViewId))

  const groupSelectionsRef = useRef<Record<string, number[]>>({})

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

  const buildMonitoringWorkspacePreferencePayload = useCallback(() => normalizeMonitoringWorkspaceState({
    version: MONITORING_WORKSPACE_PREFERENCE_VERSION,
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
    if (remoteWorkspaceState && !monitoringPreferenceHydratedRef.current) {
      monitoringPreferenceHydratedRef.current = true
      const payload = initialWorkspaceState ?? normalizeMonitoringWorkspaceState(remoteWorkspaceState)
      const serialized = JSON.stringify(payload)
      monitoringPreferenceSyncRef.current = serialized
      setSavedViews(payload?.savedViews ?? normalizeMonitoringSavedViews([]))
      setActiveViewId(payload?.activeViewId ?? null)
      setFavoriteIds(hasStoredFavoriteIds ? (localWorkspaceState?.favoriteIds ?? []) : (payload?.favoriteIds ?? []))
      setWatchIds(hasStoredWatchIds ? (localWorkspaceState?.watchIds ?? []) : (payload?.watchIds ?? []))
      setFontSize(payload?.uiState.fontSize ?? 11)
      setRowDensity(payload?.uiState.rowDensity ?? 8)
      setHiddenColumns(payload?.uiState.hiddenColumns ?? ['created_at', 'updated_at'])
      setActiveTab(payload?.uiState.activeTab === 'deleted' ? 'deleted' : 'active')
      setShowFilterBar(payload?.uiState.showFilterBar !== false)
      setQuickFilters(payload?.uiState.quickFilters ?? normalizeMonitoringQuickFilters(null))
      setGroupBy(payload?.uiState.groupBy ?? 'raw')
      setColumnLayoutState(payload?.uiState.columnLayoutState ?? [])
      setSearchTerm(payload?.uiState.searchTerm ?? '')
      return
    }

    if (hasUserSettings && !remoteWorkspaceState && !monitoringPreferenceMigratedRef.current) {
      monitoringPreferenceMigratedRef.current = true
      const localPayload = buildMonitoringWorkspacePreferencePayload()
      if (!localPayload) return
      const serialized = JSON.stringify(localPayload)
      monitoringPreferenceSyncRef.current = serialized
      apiFetch('/api/v1/settings/user/settings', {
        method: 'PATCH',
        body: JSON.stringify({ [MONITORING_WORKSPACE_PREFERENCE_KEY]: localPayload })
      }).catch(() => {})
    }
  }, [
    buildMonitoringWorkspacePreferencePayload,
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
    const payload = buildMonitoringWorkspacePreferencePayload()
    if (!payload) return
    const serialized = JSON.stringify(payload)
    if (monitoringPreferenceSyncRef.current === serialized) return
    if (monitoringPreferenceSyncTimeoutRef.current !== null) {
      window.clearTimeout(monitoringPreferenceSyncTimeoutRef.current)
    }
    monitoringPreferenceSyncTimeoutRef.current = window.setTimeout(() => {
      apiFetch('/api/v1/settings/user/settings', {
        method: 'PATCH',
        body: JSON.stringify({ [MONITORING_WORKSPACE_PREFERENCE_KEY]: payload })
      })
        .then(() => {
          monitoringPreferenceSyncRef.current = serialized
        })
        .catch(() => {})
    }, 500)
    return () => {
      if (monitoringPreferenceSyncTimeoutRef.current !== null) {
        window.clearTimeout(monitoringPreferenceSyncTimeoutRef.current)
        monitoringPreferenceSyncTimeoutRef.current = null
      }
    }
  }, [buildMonitoringWorkspacePreferencePayload, hasUserSettings])

  useEffect(() => {
    setSelectedIds([])
    groupSelectionsRef.current = {}
  }, [groupBy])

  const handleSelectionChanged = useCallback((e: any, groupKey: string = 'raw') => {
    const selectedNodes = e?.api?.getSelectedNodes?.() || []
    const ids = selectedNodes.map((n: any) => n.data?.id).filter(Boolean)

    groupSelectionsRef.current[groupKey] = ids

    // Aggregate all selections from all groups
    const allSelected = Array.from(new Set(Object.values(groupSelectionsRef.current).flat()))
    setSelectedIds(allSelected)
  }, [])

  const handleColumnMoved = useCallback((event: any) => {
    if (!event.source.includes('drag')) syncColumnLayoutState(event.api)
  }, [syncColumnLayoutState])

  const handleDragStopped = useCallback((event: any) => syncColumnLayoutState(event.api), [syncColumnLayoutState])
  const handleColumnPinned = useCallback((event: any) => syncColumnLayoutState(event.api), [syncColumnLayoutState])
  const handleColumnVisible = useCallback((event: any) => syncColumnLayoutState(event.api), [syncColumnLayoutState])
  const handleFilterChanged = useCallback((e: any) => setGridFilterModel(e.api.getFilterModel() || {}), [])
  const handleMonitoringColumnResized = useCallback((event: any) => {
    const source = event?.source || ''
    const isAutoResizeSource =
      source === 'autosizeColumns' ||
      source === 'sizeColumnsToFit' ||
      source === 'api' ||
      source === 'flex'

    if (!isAutoResizeSource) {
      clearPendingAutoSize()
      preserveExplicitColumnWidthsRef.current = true
      setTransientManualColumnWidths(true)
    }

    handleColumnResized(event)
  }, [clearPendingAutoSize, handleColumnResized, setTransientManualColumnWidths])

  const handleSortChanged = useCallback((e: any) => {
    const nextSortModel = e.api.getColumnState().filter((col: any) => col.sort).map((col: any) => ({ colId: col.colId, sort: col.sort }))
    setGridSortModel(nextSortModel)
  }, [])

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

  const openRowActionMenuAtPoint = useCallback((item: any, x: number, y: number) => {
    setRowActionMenu({
      item,
      point: { x, y }
    })
  }, [])

  const handleCellContextMenu = useCallback((e: any) => {
    if (!e?.data) return
    const mouseEvent = e.event as MouseEvent
    mouseEvent?.preventDefault?.()
    openRowActionMenuAtPoint(e.data, mouseEvent.clientX, mouseEvent.clientY)
  }, [openRowActionMenuAtPoint])

  const handleGridReady = useCallback((event: any) => {
    if (typeof window !== 'undefined') {
      ;(window as any).__DEBUG_NETWORK_GRID_API__ = event.api
    }
    // Immediately apply layout if we have it to prevent squish
    if (columnLayoutState.length > 0) {
      applyOperationalColumnState(event.api, columnLayoutState, preserveExplicitColumnWidths)
    }
  }, [columnLayoutState, preserveExplicitColumnWidths])

  const autoSizeMonitoringColumns = useCallback(() => {
    if (!gridRef.current?.api || preserveExplicitColumnWidthsRef.current) return
    clearPendingAutoSize()
    const run = () => {
      if (!gridRef.current?.api || preserveExplicitColumnWidthsRef.current) return
      autoSizeOperationalColumns({
        api: gridRef.current.api,
        skipColumnIds: Array.from(MONITORING_FIXED_WIDTH_COLUMN_IDS),
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
    autoSizeMonitoringColumns()
  }, [autoSizeMonitoringColumns])

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
  const severities = MONITORING_SEVERITIES
  const ownerRoles = MONITORING_OWNER_ROLES

  const openConfirm = (title: string, message: string, onConfirm: () => void, variant: any = 'danger') => {
    setConfirmModal({ isOpen: true, title, message, onConfirm, variant })
  }

  const openRowActionMenu = (event: React.MouseEvent, item: any) => {
    event.stopPropagation()
    openRowActionMenuAtPoint(item, event.clientX, event.clientY)
  }

  const positionUtilityWindow = (button: HTMLButtonElement | null, width: number, height: number, zIndex: number) => {
    if (!button) {
      return {
        position: 'fixed' as const,
        top: 120,
        left: Math.max(FLOATING_PANEL_EDGE, window.innerWidth - width - 40),
        width,
        maxHeight: `calc(100vh - ${FLOATING_PANEL_EDGE * 2}px)`,
        zIndex
      }
    }
    return getAnchoredFloatingStyle({ rect: button.getBoundingClientRect(), width, height, zIndex, offset: 12 })
  }

  const toggleBulkWindow = () => {
    setShowBulkMenu((current) => {
      if (current) return false
      setBulkMenuStyle(positionUtilityWindow(bulkMenuButtonRef.current, 340, BULK_MENU_MAX_HEIGHT, 1105))
      return true
    })
  }

  const toggleFavorite = useCallback((monitorId: number) => {
    const id = Number(monitorId)
    setFavoriteIds((current) => {
      const normalized = normalizeMonitoringIdList(current)
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

  const shouldIgnoreRowSelection = (target: EventTarget | null) => {
    const element = target as HTMLElement | null
    if (!element) return false
    return Boolean(
      element.closest('button, a, input, textarea, select, label') ||
      element.closest('.ag-selection-checkbox') ||
      element.closest('.ag-checkbox-input-wrapper') ||
      element.closest('.row-action-menu-container')
    )
  }

  const handleRowClicked = useCallback((event: any) => {
    if (!event?.node || shouldIgnoreRowSelection(event.event?.target)) return
    if (event.data && pendingIds.includes(event.data.id)) return
    const mouseEvent = event.event as MouseEvent | undefined
    const isToggleSelection = Boolean(mouseEvent?.metaKey || mouseEvent?.ctrlKey)
    const isRangeSelection = Boolean(mouseEvent?.shiftKey)

    if (isRangeSelection && selectionAnchorRef.current !== null) {
      const currentIndex = event.node.rowIndex
      if (currentIndex === null || currentIndex === undefined) return

      const start = Math.min(selectionAnchorRef.current, currentIndex)
      const end = Math.max(selectionAnchorRef.current, currentIndex)
      event.api.deselectAll()
      event.api.forEachNodeAfterFilterAndSort((node: any) => {
        if (node.rowIndex >= start && node.rowIndex <= end && !pendingIds.includes(node.data?.id)) {
          node.setSelected(true)
        }
      })
      return
    }

    if (isToggleSelection) {
      event.node.setSelected(!event.node.isSelected())
      selectionAnchorRef.current = event.node.rowIndex
      return
    }

    event.api.deselectAll()
    event.node.setSelected(true)
    selectionAnchorRef.current = event.node.rowIndex
  }, [pendingIds])

  const handleRowDoubleClicked = useCallback((event: any) => {
    if (!event?.data || shouldIgnoreRowSelection(event.event?.target)) return
    if (pendingIds.includes(event.data.id)) return
    openNetworkDetail(event.data)
  }, [openNetworkDetail, pendingIds])

  const openRecoveryDocuments = (item: any) => {
    const recoveryDocs = item.recovery_docs || []
    setBkmPopup({
      docs: recoveryDocs,
      ids: recoveryDocs,
      titles: item.recovery_doc_titles || [],
      monitorId: item.id
    })
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

  const handleExportCSV = () => {
    if (gridRef.current?.api) {
      gridRef.current.api.exportDataAsCsv({
        fileName: `SysGrid_AssetReal_${new Date().toISOString().split('T')[0]}.csv`,
        allColumns: false,
        onlySelected: false
      })
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
    sanitizeMonitoringViewConfig({
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
    const config = sanitizeMonitoringViewConfig(nextView.config)
    setFontSize(config.fontSize ?? 11)
    setRowDensity(config.rowDensity ?? 8)
    setHiddenColumns(config.hiddenColumns ?? [])
    setGroupBy(config.groupBy ?? 'raw')
    setShowFilterBar(config.showFilterBar ?? true)
    setColumnLayoutState(config.columnLayoutState ?? [])
    setTransientManualColumnWidths(false)
    setSearchTerm(config.quickFilter ?? '')
    setQuickFilters(config.quickFilters ?? { status: [] as string[], system: [] as string[], type: [] as string[], owner: [] as string[] })
    setGridFilterModel(config.filterModel ?? {})
    setGridSortModel((config.sortModel && config.sortModel.length > 0) ? config.sortModel : [{ colId: 'favorite', sort: 'desc' }])
    setActiveViewId(viewId)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(MONITORING_ACTIVE_VIEW_KEY, viewId)
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
      window.localStorage.setItem(MONITORING_VIEW_STORAGE_KEY, JSON.stringify(nextViews))
      window.localStorage.setItem(MONITORING_ACTIVE_VIEW_KEY, viewId)
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
      window.localStorage.setItem(MONITORING_VIEW_STORAGE_KEY, JSON.stringify(nextViews))
      window.localStorage.setItem(MONITORING_ACTIVE_VIEW_KEY, nextId)
    }
    showWorkspaceToast(`Saved new view ${trimmed}`)
  }

  const applySystemDefault = () => {
    setActiveViewId(null)
    setTransientManualColumnWidths(false)
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(MONITORING_ACTIVE_VIEW_KEY)
    }
    setFontSize(11)
    setRowDensity(8)
    setHiddenColumns([])
    setGroupBy('raw')
    setShowFilterBar(true)
    setColumnLayoutState([])
    setSearchTerm('')
    setQuickFilters({ status: [] as string[], system: [] as string[], type: [] as string[], owner: [] as string[] })
    setGridSortModel([{ colId: 'favorite', sort: 'desc' }])
    if (gridRef.current?.api) {
       gridRef.current.api.setFilterModel({})
       gridRef.current.api.applyColumnState({
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
             window.localStorage.removeItem(MONITORING_ACTIVE_VIEW_KEY)
          }
        }
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(MONITORING_VIEW_STORAGE_KEY, JSON.stringify(nextViews))
        }
        showWorkspaceToast(`Deleted view ${view.name}`)
      }
    )
  }

  const dismissWorkspaceMenus = useCallback(() => {
    setShowBulkMenu(false)
    setBulkDeleteConfirm(false)
    setShowDisplayMenu(false)
    setShowViewsMenu(false)
    setRowActionMenu(null)
    setRowDeleteConfirmId(null)
  }, [])

  useWorkspaceDismissHandlers({
    active: showBulkMenu || showDisplayMenu || showViewsMenu || !!rowActionMenu,
    onDismiss: dismissWorkspaceMenus,
    shouldDismiss: (target) => {
      if (target.closest('[data-workspace-panel]')) return false
      if (showBulkMenu && !target.closest('.bulk-menu-container') && !target.closest('.bulk-menu-trigger')) return true
      if (showDisplayMenu && !target.closest('.display-menu-container')) return true
      if (showViewsMenu && !target.closest('.views-menu-container')) return true
      if (rowActionMenu && !target.closest('.row-action-menu-container')) return true
      return false
    },
  })

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('.ag-root-wrapper') || target.closest('.row-action-menu-container')) {
        event.preventDefault()
      }
    }

    document.addEventListener('contextmenu', handleContextMenu)
    return () => document.removeEventListener('contextmenu', handleContextMenu)
  }, [])

  useEffect(() => {
    const updateMenuPositions = () => {
      if (showDisplayMenu && displayMenuButtonRef.current) {
        setDisplayMenuStyle(getAnchoredFloatingStyle({
          rect: displayMenuButtonRef.current.getBoundingClientRect(),
          width: 320,
          height: 420,
          zIndex: 1100,
          offset: 12
        }))
      }
      if (showViewsMenu && viewsMenuButtonRef.current) {
        setViewsMenuStyle(getAnchoredFloatingStyle({
          rect: viewsMenuButtonRef.current.getBoundingClientRect(),
          width: 380,
          height: 460,
          zIndex: 1100,
          offset: 12
        }))
      }
      if (showBulkMenu && bulkMenuButtonRef.current) {
        setBulkMenuStyle(positionUtilityWindow(bulkMenuButtonRef.current, 340, BULK_MENU_MAX_HEIGHT, 1105))
      }
    }

    updateMenuPositions()
    if (showDisplayMenu || showBulkMenu || showViewsMenu) {
      window.addEventListener('resize', updateMenuPositions)
      window.addEventListener('scroll', updateMenuPositions, true)
      return () => {
        window.removeEventListener('resize', updateMenuPositions)
        window.removeEventListener('scroll', updateMenuPositions, true)
      }
    }
  }, [showBulkMenu, showDisplayMenu, showViewsMenu])

  const { data: allItems, isLoading } = useQuery({
    queryKey: ['asset-real-devices'],
    queryFn: async () => (await apiFetch('/api/v1/devices?include_deleted=true')).json()
  })

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
      .map((asset: any) => normalizeAssetRecord(asset))
      .filter((item: any) => activeTab === 'active' ? !item.is_deleted : item.is_deleted)
  }, [allItems, activeTab])

  const canRevert = Boolean(!isReverting && revertOperation && revertOperation.ids.length > 0 && !revertOperation.ids.some((id) => pendingIds.includes(id)) && revertOperation.ids.every((id) => {
    const item = allItems?.find((candidate: any) => candidate.id === id)
    return revertOperation.inverseAction === 'restore' ? Boolean(item?.is_deleted) : !item?.is_deleted
  }))

  const platformOptions = useMemo(() => {
    const values = Array.from(new Set((items || []).map((item: any) => item.system).filter(Boolean)))
    return values.sort().map((value) => ({ value, label: value }))
  }, [items])

  const ownerOptions = useMemo(() => {
    const values = Array.from(new Set((items || []).map((item: any) => item.owner).filter(Boolean)))
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
    { value: 'system', label: 'System' },
    { value: 'type', label: 'Type' },
    { value: 'owner', label: 'Owner' }
  ]

  const displayedItems = useMemo(() => {
    const filtered = items.filter((item: any) => {
      if (searchTerm.trim()) {
        const query = searchTerm.trim().toLowerCase()
        const haystack = [
          String(item.id || ''),
          item.name,
          item.system,
          item.owner,
          item.manufacturer,
          item.model,
          item.status,
          item.type,
          item.environment,
          item.primary_ip,
          item.management_ip,
          item.site_name,
          item.rack_name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()

        if (!haystack.includes(query)) return false
      }
      if (quickFilters.status.length > 0 && !quickFilters.status.includes(item.status)) return false
      if (quickFilters.system.length > 0 && !quickFilters.system.includes(item.system)) return false
      if (quickFilters.type.length > 0 && !quickFilters.type.includes(item.type)) return false
      if (quickFilters.owner.length > 0 && !quickFilters.owner.includes(item.owner)) return false
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
      autoSizeMonitoringColumns()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [autoSizeMonitoringColumns, displayedItemsInOrder, fontSize, hiddenColumns, isIntelligenceExpanded])

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
    selectionAnchorRef.current = null
  }, [activeTab, items])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(MONITORING_UI_STATE_KEY, JSON.stringify({
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
      setShowBulkMenu(false)
    }
  }, [selectedIds.length])

  useEffect(() => {
    if (typeof window === 'undefined') return
    ;(window as any).__DEBUG_SET_ASSET_COLUMN_WIDTH__ = (colId: string, width: number) => {
      if (!gridRef.current?.api) return
      gridRef.current.api.applyColumnState({
        state: [{ colId, width }],
        applyOrder: false,
      })
      setTransientManualColumnWidths(true)
      syncColumnLayoutState(gridRef.current.api, true)
    }
    return () => {
      delete (window as any).__DEBUG_SET_ASSET_COLUMN_WIDTH__
    }
  }, [setTransientManualColumnWidths, syncColumnLayoutState])

  useEffect(() => {
    return () => {
      if (typeof window === 'undefined') return
      const current = readMonitoringUiState() || {}
      window.localStorage.setItem(MONITORING_UI_STATE_KEY, JSON.stringify({
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

  const runUndo = async (operation: AssetLifecycleOperation) => {
    const res = await apiFetch('/api/v1/devices/bulk-action', {
      method: 'POST',
      body: JSON.stringify({ ids: operation.ids, action: operation.inverseAction })
    })
    if (!res.ok) throw new Error(await res.text())
    await queryClient.invalidateQueries({ queryKey: ['asset-real-devices'] })
  }

  const executeRevert = async (operation: AssetLifecycleOperation) => {
    setIsReverting(true)
    try {
      await runUndo(operation)
      setRevertOperation(null)
      showWorkspaceToast('Reverted asset operation', { type: 'success' })
    } catch (error: any) {
      showWorkspaceToast(error.message || 'Undo failed', { type: 'error' })
    } finally {
      setIsReverting(false)
    }
  }

  const resolveEligibleBulkIds = (action: string, requestedIds: number[]) => {
    const requested = new Set(requestedIds)
    return (allItems || [])
      .filter((item: any) => {
        if (!requested.has(item.id)) return false
        if (action === 'delete') return !item.is_deleted
        if (action === 'restore') return Boolean(item.is_deleted)
        return true
      })
      .map((item: any) => item.id)
  }

  const bulkMutation = useMutation({
    onMutate: ({ action, ids: overrideIds }: any) => {
      const idsToUse = resolveEligibleBulkIds(action, overrideIds ?? selectedIds)
      setPendingIds(prev => [...new Set([...prev, ...idsToUse])])
    },
    onSettled: (data: any, error: any, variables: any) => {
      const idsToUse = resolveEligibleBulkIds(variables.action, variables.ids ?? selectedIds)
      setPendingIds(prev => prev.filter(id => !idsToUse.includes(id)))
    },
    mutationFn: async ({ action, payload = {}, ids: overrideIds }: any) => {
      const idsToUse = resolveEligibleBulkIds(action, overrideIds ?? selectedIds)
      if (idsToUse.length === 0) {
        return { result: { changed: 0, summary: 'No eligible assets selected' }, action, payload, idsToUse, previousSnapshots: [] }
      }
      const previousSnapshots = (allItems || []).filter((item: any) => idsToUse.includes(item.id)).map((item: any) => ({ ...item }))
      let res
      if (action === 'update') {
        const directPayload = {
          ...(payload.status ? { status: payload.status } : {}),
          ...(payload.environment ? { environment: payload.environment } : {}),
          ...(payload.system ? { system: payload.system } : {}),
          ...(payload.owner ? { owner: payload.owner } : {}),
        }
        if (Object.keys(directPayload).length === 0) {
          res = new Response(JSON.stringify({ changed: 0, summary: 'No asset fields selected' }), { status: 200 })
        } else {
          for (const id of idsToUse) {
            const putRes = await apiFetch(`/api/v1/devices/${id}`, {
              method: 'PUT',
              body: JSON.stringify(directPayload)
            })
            if (!putRes.ok) throw new Error(await putRes.text())
          }
          res = new Response(JSON.stringify({ changed: idsToUse.length, summary: `Updated ${idsToUse.length} assets` }), { status: 200 })
        }
      } else {
        res = await apiFetch('/api/v1/devices/bulk-action', {
          method: 'POST',
          body: JSON.stringify({ ids: idsToUse, action })
        })
      }
      if (!res.ok) throw new Error(await res.text())
      const result = await res.json()
      return { result, action, payload, idsToUse, previousSnapshots }
    },
    onSuccess: async ({ result, action, payload, idsToUse, previousSnapshots }: any) => {
      await queryClient.invalidateQueries({ queryKey: ['asset-real-devices'] })
      setShowBulkMenu(false)
      setExpandedBulkSection(null)
        setBulkDraft({ status: '', link_type: '', direction: '' })
      setIsBulkStatusOpen(false)
      setIsBulkSeverityOpen(false)
      setIsBulkNotifyOpen(false)

      const changedCount = Number(result?.changed ?? idsToUse.length)
      if (changedCount <= 0) {
        return
      }

      const operation: AssetLifecycleOperation | null = action === 'delete' || action === 'restore'
        ? {
            ids: Object.freeze([...idsToUse]),
            originalAction: action,
            inverseAction: action === 'delete' ? 'restore' : 'delete',
            targetLabels: Object.freeze(previousSnapshots.map((item: any) => String(item.name || item.id))),
          }
        : null
      setRevertOperation(operation)

      if (operation) {
        showWorkspaceToast(result?.summary || 'Updated assets', {
          onRevert: async () => {
            await executeRevert(operation)
          }
        })
      } else {
        showWorkspaceToast(result?.summary || 'Updated assets', { type: 'success' })
      }
    },
    onError: (e: any) => showWorkspaceToast(`Operation failed: ${e.message}`, { type: 'error' })
  })

  const columnDefs = useMemo(() => {
    const layoutById = new Map(columnLayoutState.map((column: any) => [column.colId, column]))
    const lockFixedUtilityWidth = (column: any, layout?: any) => {
      const colId = column.colId || column.field
      const lockedWidth = layout?.width ?? column.width ?? column.initialWidth
      if (!MONITORING_FIXED_WIDTH_COLUMN_IDS.has(colId) || lockedWidth == null) return column
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

    const defs = [
      {
        colId: 'select',
        headerName: '',
        width: 48,
        checkboxSelection: true,
        headerCheckboxSelection: true,
        pinned: 'left',
        cellClass: 'flex items-center justify-center border-r border-white/5',
        headerClass: 'flex items-center justify-center border-r border-white/5',
        suppressSizeToFit: true,
        sortable: false,
        filter: false,
        lockVisible: true,
      },
      {
        colId: 'id',
        field: 'id',
        headerName: 'ID',
        width: 90,
        pinned: 'left',
        cellClass: 'text-center font-bold text-slate-500 border-r border-white/5 flex items-center justify-center',
        headerClass: 'text-center border-r border-white/5',
        filter: 'agNumberColumnFilter',
        lockVisible: true,
      },
      {
        colId: 'recent_change',
        headerName: 'Chg',
        field: 'recent_change',
        width: 80,
        pinned: 'left',
        sortable: false,
        filter: false,
        lockVisible: true,
        cellClass: 'text-center border-r border-white/5 flex items-center justify-center !overflow-visible',
        headerClass: 'text-center border-r border-white/5',
        hide: !isIntelligenceExpanded,
        cellRenderer: (p: any) => {
          if (!p.data || !isRecentChange(p.data)) return null
          const dateStr = formatAppDate(p.data.updated_at || p.data.created_at)
          const author = p.data.created_by_user_id || 'System'
          return (
            <div className="group relative flex items-center justify-center h-full w-full">
              <div className="absolute h-10 w-10 rounded-lg bg-[radial-gradient(circle,_rgba(251,191,36,0.2)_0%,_transparent_70%)] blur-md animate-pulse" />
              <span className="relative z-[1] block h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]" />
              <div className="invisible group-hover:visible absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-[2000] w-52 p-3 rounded-lg border border-white/10 bg-slate-950/90 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl pointer-events-none transition-all duration-300 transform scale-95 group-hover:scale-100 opacity-0 group-hover:opacity-100">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-400">Recent Activity</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] text-slate-100 font-bold leading-tight">{dateStr}</p>
                  <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-white/5">
                    <User size={10} className="text-slate-500" />
                    <p className="text-[9px] text-slate-500 font-bold tracking-widest">@{author}</p>
                  </div>
                </div>
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-950/90" />
              </div>
            </div>
          )
        },
      },
      {
        colId: 'favorite',
        headerName: 'Fav',
        field: 'favorite',
        width: 80,
        pinned: 'left',
        cellClass: 'text-center border-r border-white/5 flex items-center justify-center',
        headerClass: 'text-center border-r border-white/5',
        sortable: true,
        filter: false,
        lockVisible: true,
        valueGetter: (p: any) => p.context?.favoriteIds?.includes(p.data?.id) ? 1 : 0,
        cellRenderer: (p: any) => {
          const isFavorite = p.context?.favoriteIds?.includes(p.data?.id)
          return (
            <div className="flex h-full w-full items-center justify-center">
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  toggleFavorite(p.data.id)
                }}
                title={isFavorite ? 'Unpin connection' : 'Pin connection'}
                className={`rounded-lg p-1 transition-all flex items-center justify-center ${isFavorite ? 'text-amber-300' : 'text-slate-600 hover:text-slate-300'}`}
              >
                <Star size={15} className={isFavorite ? 'fill-current' : ''} />
              </button>
            </div>
          )
        },
      },
      {
        colId: 'watch',
        headerName: 'Watch',
        field: 'watch',
        width: 85,
        pinned: 'left',
        cellClass: 'text-center border-r border-white/5 flex items-center justify-center',
        headerClass: 'text-center border-r border-white/5',
        sortable: false,
        filter: false,
        lockVisible: true,
        hide: !isIntelligenceExpanded,
        cellRenderer: (p: any) => {
          const isWatched = p.context?.watchIds?.includes(p.data?.id)
          return (
            <div className="flex h-full w-full items-center justify-center">
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  toggleWatch(p.data.id)
                }}
                title={isWatched ? 'Unfollow connection' : 'Follow connection'}
                className={`rounded-lg p-1 transition-all flex items-center justify-center ${isWatched ? 'text-sky-300' : 'text-slate-600 hover:text-slate-300'}`}
              >
                <Eye size={15} className={isWatched ? 'fill-current' : ''} />
              </button>
            </div>
          )
        },
      },
      {
        field: 'status',
        colId: 'status',
        headerName: 'Status',
        width: 120,
        filter: true,
        cellClass: 'text-center flex items-center justify-center',
        headerClass: 'text-center',
        cellRenderer: (p: any) => <StatusPill value={p.value || 'Active'} fontSize={fontSize} />,
      },
      {
        field: 'name',
        colId: 'name',
        headerName: 'Name',
        width: 190,
        filter: true,
        cellClass: 'text-left flex items-center justify-start',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-blue-300 font-semibold'),
      },
      {
        field: 'system',
        colId: 'system',
        headerName: 'System',
        width: 130,
        filter: true,
        cellClass: 'text-center flex items-center justify-center',
        headerClass: 'text-center',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'type',
        colId: 'type',
        headerName: 'Type',
        width: 120,
        filter: true,
        cellClass: 'text-center flex items-center justify-center',
        headerClass: 'text-center',
        cellRenderer: (p: any) => renderText(p.value, 'text-emerald-300'),
      },
      {
        field: 'environment',
        colId: 'environment',
        headerName: 'Env',
        width: 100,
        filter: true,
        cellClass: 'text-center flex items-center justify-center',
        headerClass: 'text-center',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'owner',
        colId: 'owner',
        headerName: 'Owner',
        width: 140,
        filter: true,
        cellClass: 'text-left flex items-center justify-start',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'manufacturer',
        colId: 'manufacturer',
        headerName: 'Make',
        width: 120,
        filter: true,
        cellClass: 'text-left flex items-center justify-start',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'model',
        colId: 'model',
        headerName: 'Model',
        width: 120,
        filter: true,
        cellClass: 'text-left flex items-center justify-start',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'os_name',
        colId: 'os_name',
        headerName: 'OS',
        width: 120,
        filter: true,
        cellClass: 'text-left flex items-center justify-start',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-blue-300'),
      },
      {
        field: 'os_version',
        colId: 'os_version',
        headerName: 'Ver',
        width: 100,
        filter: true,
        cellClass: 'text-left flex items-center justify-start',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'primary_ip',
        colId: 'primary_ip',
        headerName: 'Primary IP',
        width: 140,
        filter: true,
        cellClass: 'text-left flex items-center justify-start',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-blue-300'),
      },
      {
        field: 'management_ip',
        colId: 'management_ip',
        headerName: 'Mgmt IP',
        width: 140,
        filter: true,
        cellClass: 'text-left flex items-center justify-start',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-indigo-300'),
      },
      {
        field: 'hardware_summary',
        colId: 'hardware_summary',
        headerName: 'Resources',
        width: 180,
        filter: true,
        cellClass: 'text-left flex items-center justify-start',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'hardware_age',
        colId: 'hardware_age',
        headerName: 'Age',
        width: 90,
        filter: true,
        cellClass: 'text-center flex items-center justify-center',
        headerClass: 'text-center',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'open_incident_count',
        colId: 'open_incident_count',
        headerName: 'Health',
        width: 100,
        filter: true,
        cellClass: 'text-center flex items-center justify-center',
        headerClass: 'text-center',
        cellRenderer: (p: any) => Number(p.value || 0) > 0 ? renderText(`${p.value}`, 'text-rose-300 font-semibold') : renderText('OK', 'text-emerald-300 font-semibold'),
      },
      {
        field: 'site_name',
        colId: 'site_name',
        headerName: 'Site',
        width: 120,
        filter: true,
        cellClass: 'text-left flex items-center justify-start',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'rack_name',
        colId: 'rack_name',
        headerName: 'Rack',
        width: 120,
        filter: true,
        cellClass: 'text-left flex items-center justify-start',
        headerClass: 'text-left',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'depth',
        colId: 'depth',
        headerName: 'Depth',
        width: 90,
        filter: true,
        cellClass: 'text-center flex items-center justify-center',
        headerClass: 'text-center',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'mount_orientation',
        colId: 'mount_orientation',
        headerName: 'Mount',
        width: 90,
        filter: true,
        cellClass: 'text-center flex items-center justify-center',
        headerClass: 'text-center',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'u_start',
        colId: 'u_start',
        headerName: 'U Pos',
        width: 90,
        filter: true,
        cellClass: 'text-center flex items-center justify-center',
        headerClass: 'text-center',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'size_u',
        colId: 'size_u',
        headerName: 'Size',
        width: 80,
        filter: true,
        cellClass: 'text-center flex items-center justify-center',
        headerClass: 'text-center',
        cellRenderer: (p: any) => renderText(p.value, 'text-slate-300'),
      },
      {
        field: 'power_typical_w',
        colId: 'power_typical_w',
        headerName: 'Avg W',
        width: 90,
        filter: true,
        cellClass: 'text-center flex items-center justify-center',
        headerClass: 'text-center',
        cellRenderer: (p: any) => renderText(p.value ? `${p.value}W` : 'N/A', 'text-slate-300'),
      },
      {
        field: 'power_max_w',
        colId: 'power_max_w',
        headerName: 'Max W',
        width: 90,
        filter: true,
        cellClass: 'text-center flex items-center justify-center',
        headerClass: 'text-center',
        cellRenderer: (p: any) => renderText(p.value ? `${p.value}W` : 'N/A', 'text-slate-300'),
      },
      {
        field: 'created_at',
        colId: 'created_at',
        headerName: 'Created',
        width: 180,
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
        colId: 'row_actions',
        headerName: 'Action',
        width: 210,
        pinned: 'right',
        cellClass: 'text-right pr-3 flex items-center justify-end',
        headerClass: 'text-center',
        sortable: false,
        filter: false,
        cellRenderer: (p: any) => p.data ? renderPrimaryRowActions(p.data) : null,
        lockVisible: true,
      },
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
   <OperationalWorkspaceFrame
      archetype="table"
      workspace="assets"
      header={{
        eyebrow: "Infrastructure",
        title: (
          <div className="flex items-center gap-3">
            <Activity className="text-blue-500" />
            <span>Asset-Real</span>
          </div>
        ),
        subtitle: "Centralized asset registry and operational status",
        actions: (
          <HeaderScopeSwitch
            label="Asset Scope"
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
        ),
      }}
      commandBar={{
        left: (
          <>
            <ToolbarSearch
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Scan asset registry..."
            />
            <ToolbarGroup>
              <div className="views-menu-container">
                <ToolbarButton active={showViewsMenu} onClick={() => setShowViewsMenu(!showViewsMenu)} ref={viewsMenuButtonRef as any}>
                  <span className="flex items-center gap-2">
                    <LayoutGrid size={14} />
                    Views
                  </span>
                </ToolbarButton>
              </div>
              <div className="display-menu-container">
                <ToolbarButton active={showDisplayMenu} onClick={() => setShowDisplayMenu(!showDisplayMenu)} ref={displayMenuButtonRef as any}>
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
              <ToolbarButton onClick={() => setShowImportModal(true)} title="Import asset rows">
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
        ),
        secondary: showFilterBar ? (
          <div className="grid w-full gap-3 md:grid-cols-4">
            <AppDropdown
              multi
              value={quickFilters.status}
              onChange={(val) => setQuickFilters((current) => ({ ...current, status: val }))}
              options={ASSET_STATUSES.filter((status) => status !== 'Deleted').map((status) => ({ value: status, label: status }))}
              label="Status Filter"
              placeholder="All statuses"
            />
            <AppDropdown
              multi
              value={quickFilters.system}
              onChange={(val) => setQuickFilters((current) => ({ ...current, system: val }))}
              options={Array.from(new Set((items || []).map((item: any) => item.system).filter(Boolean))).sort().map((value) => ({ value, label: value }))}
              label="System Filter"
              placeholder="All systems"
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
              value={quickFilters.owner}
              onChange={(val) => setQuickFilters((current) => ({ ...current, owner: val }))}
              options={Array.from(new Set((items || []).map((item: any) => item.owner).filter(Boolean))).sort().map((value) => ({ value, label: value }))}
              label="Owner Filter"
              placeholder="All owners"
            />
          </div>
        ) : null,
        right: (
	          <>
              <ToolbarButton
                onClick={() => revertOperation && openConfirm('Revert asset operation', `Revert ${revertOperation.targetLabels.join(', ')}?`, () => { void executeRevert(revertOperation) }, 'warning')}
                disabled={!canRevert || isReverting}
                title={canRevert ? 'Revert the last completed lifecycle operation' : 'Revert is unavailable because its captured assets no longer match the expected lifecycle state'}
              >
                <span className="flex items-center gap-2">
                  <Undo2 size={14} className={isReverting ? 'animate-spin' : ''} />
                  Revert
                </span>
              </ToolbarButton>
              {MONITORING_SUPPORTS_COMPARE && (
                <ToolbarButton
                  onClick={openCompare}
                  disabled={selectedIds.length < 2 || selectedIds.length > 5}
                  active={compareOpen}
                  title="Compare selected assets"
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
                  + Add Asset
            </ToolbarButton>
          </>
        ),
        filterChips: [
          ...activeFilterChips,
          ...(activeFilterChips.length > 0
            ? [{
                id: 'clear-all',
                label: 'Clear All',
                onRemove: () => {
                  setSearchTerm('')
                  setGridFilterModel({})
            setQuickFilters({ status: [] as string[], system: [] as string[], type: [] as string[], owner: [] as string[] })
                  gridRef.current?.api?.setFilterModel({})
                }
              }]
            : []),
        ],
      }}
    >

      {typeof document !== 'undefined' && createPortal(
        <>
          <OperationalDisplayPanel
            isOpen={showDisplayMenu}
            panelStyle={displayMenuStyle}
            onClose={() => setShowDisplayMenu(false)}
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
            entityLabel="Asset-Real"
            onClose={() => setShowViewsMenu(false)}
            activeViewId={activeViewId}
            currentViewName={activeViewId ? savedViews.find((view) => view.id === activeViewId)?.name || 'Unsaved working view' : 'Unsaved working view'}
            newViewName={newViewName}
            onNewViewNameChange={setNewViewName}
            onCreateView={createViewFromCurrent}
            onApplySystemDefault={applySystemDefault}
            savedViews={savedViews}
            defaultViewIds={DEFAULT_MONITORING_VIEW_IDS}
            onApplyView={applySavedView}
            onOverwriteView={saveCurrentToView}
            onDeleteView={deleteView}
            describeView={(view) => view.config?.groupBy && view.config.groupBy !== 'raw'
              ? `Grouped by ${groupOptions.find((option) => option.value === view.config.groupBy)?.label || view.config.groupBy}`
              : 'Raw asset table'}
          />

	          <AnimatePresence>
		            {showBulkMenu && !!bulkMenuStyle.top && (
		            <motion.div
		            key="bulk-menu"
		            initial={{ opacity: 0, y: 10 }}
		            animate={{ opacity: 1, y: 0 }}
		            exit={{ opacity: 0, y: 10 }}
		            style={bulkMenuStyle}
                  className="bulk-menu-container"
                >
                  <WorkspaceFloatingPanel kind="context" className="max-h-[560px] overflow-y-auto custom-scrollbar p-3">
                  <div className="mb-3 rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
                    <p className="text-[10px] font-semibold text-slate-400">Bulk actions</p>
                    <p className="pt-1 text-[12px] font-semibold text-slate-100">{selectedIds.length} assets selected</p>
                  </div>

                  {activeTab === 'deleted' ? (
                      <button
                      onClick={() => bulkMutation.mutate({ action: 'restore' })}
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
                        <p className="pt-1 text-[10px] font-semibold text-slate-400">Edit selected assets row by row using safe columns only.</p>
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
                          onApply={() => bulkMutation.mutate({ action: 'update', payload: { status: bulkDraft.status } })}
                          disabled={!bulkDraft.status || bulkMutation.isPending}
                        />
                      )}

                      <WorkspaceFlyoutActionCard
                        title="Set System"
                        active={expandedBulkSection === 'link_type'}
                        onClick={() => setExpandedBulkSection(expandedBulkSection === 'link_type' ? null : 'link_type')}
                      />
                      {expandedBulkSection === 'link_type' && (
                        <WorkspaceFlyoutDropdownEditor
                          value={bulkDraft.link_type}
                          onChange={(value) => setBulkDraft((current) => ({ ...current, link_type: value }))}
                          options={Array.from(new Set((items || []).map((item: any) => item.system).filter(Boolean))).sort().map((value) => ({ value, label: value }))}
                          placeholder="Choose system"
                          actionLabel="Apply System"
                          onApply={() => bulkMutation.mutate({ action: 'update', payload: { system: bulkDraft.link_type } })}
                          disabled={!bulkDraft.link_type || bulkMutation.isPending}
                        />
                      )}

                      <WorkspaceFlyoutActionCard
                        title="Set Owner"
                        active={expandedBulkSection === 'direction'}
                        onClick={() => setExpandedBulkSection(expandedBulkSection === 'direction' ? null : 'direction')}
                      />
                      {expandedBulkSection === 'direction' && (
                        <WorkspaceFlyoutDropdownEditor
                          value={bulkDraft.direction}
                          onChange={(value) => setBulkDraft((current) => ({ ...current, direction: value }))}
                          options={Array.from(new Set((items || []).map((item: any) => item.owner).filter(Boolean))).sort().map((value) => ({ value, label: value }))}
                          placeholder="Choose owner"
                          actionLabel="Apply Owner"
                          onApply={() => bulkMutation.mutate({ action: 'update', payload: { owner: bulkDraft.direction } })}
                          disabled={!bulkDraft.direction || bulkMutation.isPending}
                        />
                      )}
                    </div>
                  )}

                  <div className="mx-1 my-3 h-px bg-slate-800" />
                  <button
                    onClick={() => {
                      if (!bulkDeleteConfirm) {
                        setBulkDeleteConfirm(true)
                        return
                      }
                      bulkMutation.mutate({ action: activeTab === 'deleted' ? 'purge' : 'delete' })
                    }}
                    onMouseLeave={() => setBulkDeleteConfirm(false)}
                    disabled={bulkMutation.isPending}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition-all ${
                      bulkDeleteConfirm
                        ? 'border-rose-500 bg-rose-600 animate-pulse'
                        : 'border-rose-900/70 bg-rose-950/70 hover:bg-rose-950'
                    } disabled:opacity-50`}
                  >
                    <p className={`text-[10px] font-semibold ${bulkDeleteConfirm ? 'text-white' : 'text-rose-300'}`}>
                      {bulkMutation.isPending ? <Activity size={10} className="inline animate-spin" /> : (
                        bulkDeleteConfirm
                          ? (activeTab === 'deleted' ? 'Confirm Permanent Purge?' : 'Confirm Archive?')
                          : (activeTab === 'deleted' ? OPERATIONAL_ACTION_LABELS.purge : 'Archive Selection')
                      )}
                    </p>
                  </button>
                  </WorkspaceFloatingPanel>
                </motion.div>
	            )}
	          </AnimatePresence>

	          <AnimatePresence>
            {rowActionMenu && (
              <motion.div
                key="row-action-menu"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="row-action-menu-container"
              >
                <WorkspaceFloatingPanel kind="context" className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-semibold text-slate-400">Row actions</p>
                    <p className="pt-1 text-[11px] font-semibold text-slate-100">ID {rowActionMenu.item.id} · {rowActionMenu.item.name || 'Unnamed asset'}</p>
                    <p className="truncate pt-1 text-[12px] text-slate-300">{rowActionMenu.item.system || 'No system'} · {rowActionMenu.item.type || 'No type'}</p>
                  </div>
                  <button
                    onClick={() => setRowActionMenu(null)}
                    className="ml-3 flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-slate-400 transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                    aria-label="Close row actions"
                  >
                    <X size={13} />
                  </button>
                </div>
                <div className="max-h-[calc(100vh-180px)] overflow-y-auto p-2.5 custom-scrollbar">
                  <div className="px-3 py-1">
                    <p className="text-[10px] font-semibold text-slate-400">Quick access</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 px-2 pb-3 border-b border-slate-800 mb-2">
                    <button
                      onClick={() => {
                        openNetworkDetail(rowActionMenu.item)
                        setRowActionMenu(null)
                      }}
                      className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 py-3 text-[9px] font-black uppercase tracking-[0.1em] text-blue-400 transition-all hover:border-blue-500/30 hover:bg-blue-600/10 active:scale-95"
                    >
                      <Maximize2 size={14} />
                      Details
                    </button>
                    <button
                      onClick={() => {
                        setEditingItem(rowActionMenu.item)
                        setIsFormOpen(true)
                        setRowActionMenu(null)
                      }}
                      className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 py-3 text-[9px] font-black uppercase tracking-[0.1em] text-emerald-400 transition-all hover:border-emerald-500/30 hover:bg-emerald-600/10 active:scale-95"
                    >
                      <Edit2 size={14} />
                      Edit
                    </button>
                  </div>

                  <div className="mx-2 my-2 h-px bg-slate-800" />
                {activeTab === 'deleted' && (
                  <button
                    onClick={() => {
                      bulkMutation.mutate({ action: 'restore', ids: [rowActionMenu.item.id] })
                      setRowActionMenu(null)
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300 transition-all hover:bg-emerald-950/80"
                  >
                    <Undo2 size={14} />
                    Restore Asset
                  </button>
                )}
                <button
                  onClick={() => {
                    const item = rowActionMenu.item
                    if (rowDeleteConfirmId !== item.id) {
                      setRowDeleteConfirmId(item.id)
                      return
                    }
                    bulkMutation.mutate({ action: activeTab === 'active' ? 'delete' : 'purge', ids: [item.id] })
                    setRowActionMenu(null)
                    setRowDeleteConfirmId(null)
                  }}
                  onMouseLeave={() => setRowDeleteConfirmId(null)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.16em] transition-all ${
                    rowDeleteConfirmId === rowActionMenu.item.id
                      ? 'bg-rose-600 text-white animate-pulse'
                      : 'text-rose-300 hover:bg-rose-950/80'
                  }`}
                >
                  <Trash2 size={14} />
                    {rowDeleteConfirmId === rowActionMenu.item.id
                    ? (activeTab === 'active' ? 'Confirm Delete?' : 'Confirm Purge?')
                    : (activeTab === 'active' ? 'Delete' : 'Purge')}
                </button>
                </div>
                </WorkspaceFloatingPanel>
              </motion.div>
            )}
          </AnimatePresence>
        </>,
        document.body
      )}

      {groupBy === 'raw' ? (
	        <OperationalGridSurface
            style={{
              '--ag-font-size': `${fontSize}px`,
              '--ag-font-family': "'Inter', sans-serif",
            } as React.CSSProperties}
            loading={isLoading}
            loadingIcon={<RefreshCcw size={32} className="text-blue-400 animate-spin" />}
            loadingLabel={<p className="text-[10px] font-semibold text-blue-400">Scanning asset registry...</p>}
          >
	          <OperationalGridMatrix
            gridRef={gridRef}
	            rowData={displayedItemsInOrder || []}
	            columnDefs={columnDefs}
            autoSizeStrategy={autoSizeStrategy}
            colResizeDefault="normal"
            fontSize={fontSize}
            rowDensity={rowDensity}
            context={gridContext}
            getRowId={handleRowId}
            onGridReady={handleGridReady}
	            onSelectionChanged={(e) => handleSelectionChanged(e, 'raw')}
            onColumnResized={handleMonitoringColumnResized}
            onColumnMoved={handleColumnMoved}
            onDragStopped={handleDragStopped}
            onColumnPinned={handleColumnPinned}
            onColumnVisible={handleColumnVisible}
            onFilterChanged={handleFilterChanged}
	            onSortChanged={handleSortChanged}
            onCellContextMenu={handleCellContextMenu}
	            onRowClicked={handleRowClicked}
            onRowDoubleClicked={handleRowDoubleClicked}
            getRowClass={getRowClass}
            onFirstDataRendered={handleGridDataUpdated}
            onRowDataUpdated={handleGridDataUpdated}
            noRowsLabel="No asset data found"
	          />

	        </OperationalGridSurface>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4 custom-scrollbar">
          <div className="rounded-lg border border-white/5 bg-black/20 px-6 py-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold text-slate-400">Grouped asset registry</p>
              <p className="pt-1 text-[12px] font-semibold text-slate-100">Sorted by {groupOptions.find((option) => option.value === groupBy)?.label || groupBy}</p>
            </div>
            <div className="flex items-center gap-3">
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
            </div>
          </div>
          {groupedSections.map((section) => {
            const isCollapsed = collapsedGroups[section.key]
            const selectedCount = section.items.filter((item: any) => selectedIds.includes(item.id)).length
            return (
              <section key={section.key} className="glass-panel overflow-hidden rounded-lg border border-white/5">
                <button
                  type="button"
                  onClick={() => setCollapsedGroups((current) => ({ ...current, [section.key]: !current[section.key] }))}
                  className="flex w-full items-center justify-between gap-4 border-b border-white/5 bg-white/[0.03] px-5 py-4 text-left transition-all hover:bg-white/[0.05]"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-[9px] font-semibold text-blue-400">{groupOptions.find((option) => option.value === groupBy)?.label}</span>
                      <h3 className="text-sm font-semibold text-slate-100">{section.label}</h3>
                    </div>
                    <p className="pt-1 text-[11px] text-slate-400">{section.items.length} assets{selectedCount ? ` · ${selectedCount} selected` : ''}</p>
                  </div>
                  <div className="flex items-center gap-3">
                  <span className="rounded-lg border border-white/5 bg-black/30 px-2.5 py-1 text-[9px] font-semibold text-slate-300">{section.items.length}</span>
                    {isCollapsed ? <ChevronDown size={16} className="text-slate-500" /> : <ChevronUp size={16} className="text-slate-500" />}
                  </div>
                </button>
                {!isCollapsed && (
                  <OperationalGridSurface
                    style={{
                      '--ag-font-size': `${fontSize}px`,
                      '--ag-font-family': "'Inter', sans-serif",
                      height: `${Math.min(600, section.items.length * (fontSize + rowDensity + 5) + 40)}px`
                    } as React.CSSProperties}
                  >
                    <OperationalGridMatrix
                      rowData={section.items}
                      columnDefs={columnDefs}
                      autoSizeStrategy={autoSizeStrategy}
                      colResizeDefault="normal"
                      fontSize={fontSize}
                      rowDensity={rowDensity}
                      context={gridContext}
                      getRowId={handleRowId}
                      onSelectionChanged={(e) => handleSelectionChanged(e, section.key)}
                      onColumnResized={handleMonitoringColumnResized}
                      onColumnMoved={handleColumnMoved}
                      onDragStopped={handleDragStopped}
                      onColumnPinned={handleColumnPinned}
                      onColumnVisible={handleColumnVisible}
                      onFilterChanged={handleFilterChanged}
                      onSortChanged={handleSortChanged}
                      onCellContextMenu={handleCellContextMenu}
                      onRowClicked={handleRowClicked}
                      onRowDoubleClicked={handleRowDoubleClicked}
                      getRowClass={getRowClass}
                      onFirstDataRendered={handleGridDataUpdated}
                      onRowDataUpdated={handleGridDataUpdated}
                      noRowsLabel="No asset data found"
                    />
                  </OperationalGridSurface>
                )}
              </section>
            )
          })}
        </div>
      )}

      <BulkActionModals
        isStatusOpen={isBulkStatusOpen}
        isSeverityOpen={isBulkSeverityOpen}
        isNotifyOpen={isBulkNotifyOpen}
        onClose={() => { setIsBulkStatusOpen(false); setIsBulkSeverityOpen(false); setIsBulkNotifyOpen(false); }}
        onApply={(action, val) => bulkMutation.mutate({ action: 'update', payload: { [action]: val } })}
        count={selectedIds.length}
        severities={severities}
        notificationMethods={notificationMethods}
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
          <AssetRecordFormModal
            key={`asset-form-${editingItem?.id || 'new'}`}
            item={editingItem}
            onClose={() => setIsFormOpen(false)}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['asset-real-devices'] })
              setIsFormOpen(false)
            }}
          />
        )}
        {detailItem && (
          <AssetRecordDetailModal
            key={`asset-detail-${detailItem.id}`}
            item={detailItem}
            onClose={() => closeNetworkDetail()}
            onEdit={(asset: any) => { closeNetworkDetail(); setEditingItem(asset); setIsFormOpen(true); }}
            onDelete={(asset: any) => {
              if (!detailDeleteConfirm) {
                setDetailDeleteConfirm(true)
                return
              }
              bulkMutation.mutate({ action: activeTab === 'active' ? 'delete' : 'purge', ids: [asset.id] })
              closeNetworkDetail()
            }}
          />
        )}
        {historyItem && <MonitoringHistoryModal key={`monitoring-history-${historyItem.id}`} item={historyItem} onClose={() => setHistoryItem(null)} />}
        {recipientPopup && <RecipientsModal key={`monitoring-recipients-${recipientPopup.method}-${recipientPopup.recipients.join('|')}`} recipients={recipientPopup.recipients} method={recipientPopup.method} onClose={() => setRecipientPopup(null)} />}
        {bkmPopup && (
          <BkmListModal
            key={`monitoring-bkm-list-${bkmPopup.monitorId ?? 'none'}-${bkmPopup.docs.join('-')}`}
            docs={bkmPopup.docs}
            monitorId={bkmPopup.monitorId}
            onOpenBkm={setActiveBkm}
            onOpenKnowledge={(knowledgeId) => {
              setBkmPopup(null)
              setActiveBkm(null)
              navigate(`/knowledge?id=${knowledgeId}`)
            }}
            onClose={() => setBkmPopup(null)}
          />
        )}
        {activeBkm && <BkmDetailModal key={`monitoring-bkm-detail-${activeBkm}`} bkmId={activeBkm} onClose={() => setActiveBkm(null)} />}
        {compareOpen && <CompareMonitorsModal key={`monitoring-compare-${compareItems.map((item) => item.id).join('-') || 'empty'}`} items={compareItems} onClose={() => setCompareOpen(false)} />}
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
              queryClient.invalidateQueries({ queryKey: ['asset-real-devices'] })
              setShowBulkEditModal(false)
            }}
          />
        )}
        <OperationalImportModal
          key="monitoring-import-modal"
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          tableName="devices"
          displayName="Asset-Real"
        />
        <ConfigRegistryModal
            key="monitoring-config-registry"
            isOpen={showRegistry}
            onClose={() => setShowRegistry(false)}
            title="Asset Registry Enumerations"
            sections={[
                { title: "Asset Types", category: "DeviceType", icon: Layers },
                { title: "Logical Systems", category: "LogicalSystem", icon: Globe },
                { title: "Business Units", category: "BusinessUnit", icon: Bell },
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
    </OperationalWorkspaceFrame>
  )
}

function CompareMonitorsModal({ items, onClose }: any) {
  useEscapeDismiss(onClose)
  useBodyModalFlag()
  const [isMaximized, setIsMaximized] = useState(false)

  const fields = useMemo(() => [
    { label: 'Status', getValue: (item: any) => item.status || 'Unknown' },
    { label: 'System', getValue: (item: any) => item.system || 'N/A' },
    { label: 'Type', getValue: (item: any) => item.type || 'N/A' },
    { label: 'Environment', getValue: (item: any) => item.environment || 'N/A' },
    { label: 'Owner', getValue: (item: any) => item.owner || 'N/A' },
    { label: 'Manufacturer', getValue: (item: any) => item.manufacturer || 'N/A' },
    { label: 'Model', getValue: (item: any) => item.model || 'N/A' },
    { label: 'Primary IP', getValue: (item: any) => item.primary_ip || 'N/A' },
    { label: 'Mgmt IP', getValue: (item: any) => item.management_ip || 'N/A' },
    { label: 'Rack', getValue: (item: any) => item.rack_name || 'N/A' },
    { label: 'Site', getValue: (item: any) => item.site_name || 'N/A' },
    { label: 'Resources', getValue: (item: any) => item.hardware_summary || 'N/A', multiline: true },
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
      title="Compare Assets"
      subtitle={`Temporal Variance Analysis · Comparing ${items.length} asset states for semantic drift`}
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
                  <StatusPill value={item.status} />
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
    title: item.name || `Asset ${item.id}`,
    status: item.status || '',
    link_type: item.system || '',
    direction: item.owner || '',
    farm: item.environment || '',
    purpose: item.role || '',
    speed_gbps: item.size_u ?? '',
    unit: item.primary_ip || '',
    cable_type: item.management_ip || '',
    request_link: item.management_url || '',
    is_active: item.is_active !== false,
  })))
  const [isMaximized, setIsMaximized] = useState(false)

  useEscapeDismiss(onClose)

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
          system: row.link_type || null,
          owner: row.direction || null,
          environment: row.farm || null,
          role: row.purpose || null,
          size_u: row.speed_gbps === '' ? null : Number(row.speed_gbps),
          primary_ip: row.unit || null,
          management_ip: row.cable_type || null,
          management_url: row.request_link || null,
        }
        const res = await apiFetch(`/api/v1/devices/${row.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        })
        await res.json()
      }
    },
    onSuccess: () => {
      showWorkspaceToast(`Updated ${rows.length} asset${rows.length === 1 ? '' : 's'}`)
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
      title="Bulk Edit Asset-Real"
      subtitle="Safe table-based edits for selected assets."
      icon={<Edit2 size={20} />}
      footerRight={
        <div className="flex items-center gap-3">
          <ToolbarButton onClick={onClose}>Close</ToolbarButton>
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
                <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Asset</th>
                <th className="min-w-[140px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Status</th>
                <th className="min-w-[160px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">System</th>
                <th className="min-w-[160px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Owner</th>
                <th className="min-w-[180px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Environment</th>
                <th className="min-w-[220px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Role</th>
                <th className="min-w-[120px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Size U</th>
                <th className="min-w-[160px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Primary IP</th>
                <th className="min-w-[160px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Mgmt IP</th>
                <th className="min-w-[220px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Mgmt URL</th>
                <th className="min-w-[120px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Control</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((row: any) => (
                <tr key={row.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3 text-[10px] font-bold text-slate-200">{row.title}</td>
                  <td className="px-2 py-2"><AppDropdown value={row.status} onChange={(value) => updateRow(row.id, 'status', value)} options={ASSET_STATUSES.filter((status) => status !== 'Deleted').map((status) => ({ value: status, label: status }))} placeholder="Status" /></td>
                  <td className="px-2 py-2"><input value={row.link_type} onChange={(event) => updateRow(row.id, 'link_type', event.target.value)} placeholder="System" className={`${monitoringInputClass()} h-[42px] px-3 py-2 text-[10px]`} /></td>
                  <td className="px-2 py-2"><input value={row.direction} onChange={(event) => updateRow(row.id, 'direction', event.target.value)} placeholder="Owner" className={`${monitoringInputClass()} h-[42px] px-3 py-2 text-[10px]`} /></td>
                  <td className="px-2 py-2"><AppDropdown value={row.farm} onChange={(value) => updateRow(row.id, 'farm', value)} options={ASSET_ENVIRONMENTS.map((value) => ({ value, label: value }))} placeholder="Environment" /></td>
                  <td className="px-2 py-2"><input value={row.purpose} onChange={(event) => updateRow(row.id, 'purpose', event.target.value)} placeholder="Role" className={`${monitoringInputClass()} h-[42px] px-3 py-2 text-[10px]`} /></td>
                  <td className="px-2 py-2"><input type="number" value={row.speed_gbps} onChange={(event) => updateRow(row.id, 'speed_gbps', event.target.value)} placeholder="Size U" className={`${monitoringInputClass()} h-[42px] px-3 py-2 text-[10px] [appearance:textfield]`} /></td>
                  <td className="px-2 py-2"><input value={row.unit} onChange={(event) => updateRow(row.id, 'unit', event.target.value)} placeholder="Primary IP" className={`${monitoringInputClass()} h-[42px] px-3 py-2 text-[10px]`} /></td>
                  <td className="px-2 py-2"><input value={row.cable_type} onChange={(event) => updateRow(row.id, 'cable_type', event.target.value)} placeholder="Mgmt IP" className={`${monitoringInputClass()} h-[42px] px-3 py-2 text-[10px]`} /></td>
                  <td className="px-2 py-2"><input value={row.request_link} onChange={(event) => updateRow(row.id, 'request_link', event.target.value)} placeholder="Mgmt URL" className={`${monitoringInputClass()} h-[42px] px-3 py-2 text-[10px]`} /></td>
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

function RecipientsModal({ recipients, method, onClose }: any) {
  useEscapeDismiss(onClose)
  useBodyModalFlag()
  return (
    <WorkspaceModal
      isOpen={true}
      onClose={onClose}
      size="compact"
      title="Recipient matrix"
      subtitle={`Method: ${method}`}
      icon={<Users size={20} />}
      footerRight={
        <ToolbarButton onClick={onClose}>Dismiss</ToolbarButton>
      }
    >
      <div className="space-y-2">
        {recipients.map((r: string, i: number) => (
          <div key={`${i}-${r}`} className="bg-white/5 border border-white/5 p-3 rounded-lg flex items-center space-x-3 group hover:border-emerald-500/30 transition-all shadow-inner">
            <Mail size={14} className="text-emerald-500" />
            <span className="text-[11px] font-bold text-slate-100">{r}</span>
          </div>
        ))}
        {recipients.length === 0 && (
          <WorkspaceEmptyState compact title="No recipients defined" description="No direct delivery targets found for this connection." />
        )}
      </div>
    </WorkspaceModal>
  )
}

// Extracted to BkmListModal.tsx

// Extracted to BkmDetailModal.tsx

function AssetRecordDetailModal({ item, onClose, onEdit, onDelete }: any) {
  useEscapeDismiss(onClose)
  useBodyModalFlag()
  const [isMaximized, setIsMaximized] = useState(false)
  const detailTitle = getAssetTitle(item)

  return (
    <WorkspaceModal
      isOpen={true}
      onClose={onClose}
      size="workspace"
      isMaximized={isMaximized}
      onMaximizeToggle={() => setIsMaximized(!isMaximized)}
      title={
        <div className="flex items-center gap-3">
          <span>{detailTitle}</span>
          <WorkspaceShareHeader id={String(item.id)} title={detailTitle} />
        </div>
      }
      subtitle={`${item.system || 'No system'} · ${item.type || 'No type'} · ${item.primary_ip || 'No IP'}`}
      icon={<Monitor size={20} />}
      forensicLineage={{ createdAt: item.created_at, updatedAt: item.updated_at }}
      status={
        <div className="flex items-center gap-2">
          <StatusPill value={item.status || 'Active'} />
          <StatusPill value={item.environment || 'Production'} />
        </div>
      }
      footerRight={
        <div className="flex items-center gap-3">
          <ToolbarButton onClick={() => onEdit?.(item)}>Edit Asset</ToolbarButton>
          <ToolbarButton variant="danger" onClick={() => onDelete?.(item)}>
            {item.is_deleted ? 'Purge' : 'Archive'}
          </ToolbarButton>
        </div>
      }
    >
      <WorkspaceDossierShell
        body={
          <div className="space-y-6">
            <section className="grid gap-4 md:grid-cols-4">
              {[
                ['Owner', item.owner || 'Unassigned'],
                ['Management IP', item.management_ip || 'N/A'],
                ['Rack', item.rack_name || 'Unplaced'],
                ['Hardware Age', item.hardware_age || 'N/A'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-white/5 bg-white/[0.03] p-4 shadow-inner">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
                  <p className="mt-2 text-[12px] font-bold text-slate-200">{value}</p>
                </div>
              ))}
            </section>
            <div className="rounded-lg border border-white/5 bg-white/[0.02] p-4 shadow-inner">
              <AssetDetailsView
                device={item}
                options={[]}
                onViewServiceDetails={() => {}}
                onEditService={() => {}}
                onEditLink={() => {}}
                onViewLink={() => {}}
              />
            </div>
          </div>
        }
      />
    </WorkspaceModal>
  )
}

type AssetRecordFieldProps = {
  label: string; value: string | number; onChange: (value: string) => void; error?: string;
  required?: boolean; disabled?: boolean; multiline?: boolean; type?: React.HTMLInputTypeAttribute;
  min?: number; max?: number; step?: string;
}

function AssetRecordField({ label, value, onChange, error, required, disabled, multiline, type = 'text', min, max, step }: AssetRecordFieldProps) {
  const id = React.useId()
  const inputProps = {
    id, value, required, disabled,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
    'aria-invalid': Boolean(error), 'aria-describedby': error ? `${id}-error` : undefined,
    className: monitoringInputClass(error),
  }
  return <div>
    <FieldLabel label={label} required={required} htmlFor={id} />
    {multiline ? <textarea {...inputProps} className={`${inputProps.className} min-h-[180px] font-mono text-[11px]`} />
      : <input {...inputProps} type={type} min={min} max={max} step={step} />}
    <FieldError id={`${id}-error`} message={error} />
  </div>
}

export function AssetRecordFormModal({ item, onClose, onSuccess }: any) {
  useBodyModalFlag()
  const queryClient = useQueryClient()
  const [isMaximized, setIsMaximized] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const initialMetadataJsonText = useMemo(() => JSON.stringify(item?.metadata_json || {}, null, 2), [item])
  const initialFormData = useMemo(() => ({
    name: item?.name || '',
    system: item?.system || '',
    type: item?.type || 'Physical',
    status: item?.status || 'Active',
    environment: item?.environment || 'Production',
    owner: item?.owner || '',
    business_unit: item?.business_unit || '',
    role: item?.role || '',
    manufacturer: item?.manufacturer || '',
    model: item?.model || '',
    serial_number: item?.serial_number || '',
    asset_tag: item?.asset_tag || '',
    os_name: item?.os_name || '',
    os_version: item?.os_version || '',
    primary_ip: item?.primary_ip || '',
    management_ip: item?.management_ip || '',
    management_url: item?.management_url || '',
    depth: item?.depth || 'Full',
    mount_orientation: item?.mount_orientation || 'Front',
    size_u: item?.size_u ?? 1,
    power_typical_w: item?.power_typical_w ?? 0,
    power_max_w: item?.power_max_w ?? 0,
    purchase_date: item?.purchase_date ? String(item.purchase_date).split('T')[0] : '',
    install_date: item?.install_date ? String(item.install_date).split('T')[0] : '',
    warranty_end: item?.warranty_end ? String(item.warranty_end).split('T')[0] : '',
    eol_date: item?.eol_date ? String(item.eol_date).split('T')[0] : '',
  }), [item])
  const [metadataJsonText, setMetadataJsonText] = useState(() => initialMetadataJsonText)
  const [formData, setFormData] = useState(() => initialFormData)
  const isDirty = useMemo(
    () => !isDeepEqual(formData, initialFormData) || metadataJsonText !== initialMetadataJsonText,
    [formData, initialFormData, initialMetadataJsonText, metadataJsonText]
  )

  const updateField = useCallback((field: string, value: any) => {
    if (isSaving) return
    setFormData((current) => ({ ...current, [field]: value }))
    setFormErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }, [isSaving])

  const validate = useCallback(() => {
    const nextErrors: Record<string, string> = buildAssetScalarErrors(formData)
    if (!String(formData.name || '').trim()) nextErrors.name = 'Hostname is required.'
    if (!String(formData.system || '').trim()) nextErrors.system = 'Logical system is required.'
    if (!String(formData.serial_number || '').trim()) nextErrors.serial_number = 'Serial number is required.'
    if (!String(formData.asset_tag || '').trim()) nextErrors.asset_tag = 'Asset tag is required.'
    try {
      JSON.parse(metadataJsonText || '{}')
    } catch {
      nextErrors.metadata_json = 'Metadata JSON must be valid.'
    }
    return nextErrors
  }, [formData, metadataJsonText])

  const mutation = useMutation({
    mutationFn: async () => {
      setIsSaving(true)
      const payload = {
        ...sanitizeAssetPayload({
          ...formData,
          metadata_json: JSON.parse(metadataJsonText || '{}'),
        }),
      }
      const url = item?.id ? `/api/v1/devices/${item.id}` : '/api/v1/devices'
      const method = item?.id ? 'PUT' : 'POST'
      const res = await apiFetch(url, { method, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['asset-real-devices'] })
      setIsSaving(false)
      onSuccess?.()
    },
    onError: (error: any) => {
      setIsSaving(false)
      showWorkspaceToast(error?.message || 'Failed to save asset', { type: 'error' })
    },
  })

  const handleSave = useCallback(() => {
    if (isSaving) return
    const nextErrors = validate()
    setFormErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      showWorkspaceToast('Fix the highlighted asset fields before saving.', { type: 'error' })
      return
    }
    mutation.mutate()
  }, [isSaving, mutation, validate])

  const handleClose = () => {
    if (isSaving) {
      showWorkspaceToast('Wait for the asset save to finish before closing.', { type: 'error' })
      return
    }
    onClose()
  }
  const renderField = (field: keyof typeof formData, label: string, props: Partial<AssetRecordFieldProps> = {}) => (
    <AssetRecordField label={label} value={formData[field]} onChange={value => updateField(field, value)}
      error={formErrors[field]} disabled={isSaving} {...props} />
  )
  const formTitle = item?.id ? getAssetTitle(item) : 'Create Asset'

  return (
    <WorkspaceModal
      isOpen={true}
      onClose={handleClose}
      size="workspace"
      isMaximized={isMaximized}
      onMaximizeToggle={() => setIsMaximized(!isMaximized)}
      title={
        <div className="flex items-center gap-3">
          <span>{item?.id ? 'Edit Asset' : 'Create Asset'}</span>
          {item?.id && <WorkspaceShareHeader id={String(item.id)} title={formTitle} />}
        </div>
      }
      subtitle={item?.id ? `Asset ID ${item.id}` : 'Create a new asset'}
      icon={<Activity size={20} />}
      isDirty={isDirty && !isSaving}
      dirtyConfirmTitle="Discard Asset Changes?"
      dirtyConfirmMessage="You have unsaved asset changes. Close this window and discard them?"
      status={
        <div className="flex items-center gap-2">
          {isSaving && <span role="status">Saving asset changes...</span>}
          <StatusPill value={formData.status || 'Active'} />
          <StatusPill value={formData.environment || 'Production'} />
        </div>
      }
      footerRight={
        <div className="flex items-center gap-3">
          <ToolbarButton onClick={handleSave} disabled={isSaving} variant="primary">
            {isSaving ? 'Saving...' : 'Save Asset'}
          </ToolbarButton>
        </div>
      }
    >
      <WorkspaceDossierShell
        body={
          <div className="space-y-6">
            <section className="grid gap-4 xl:grid-cols-3">
              <WorkspaceSectionCard title="Identity">
                <div className="space-y-4">
                  {renderField('name', 'Hostname', { required: true })}
                  {renderField('role', 'Role / Description')}
                  {renderField('system', 'Logical System', { required: true })}
                  {renderField('owner', 'Owner')}
                  {renderField('business_unit', 'Business Unit')}
                </div>
              </WorkspaceSectionCard>
              <WorkspaceSectionCard title="Classification">
                <div className="space-y-4">
                  <AppDropdown disabled={isSaving} label="Asset Type" value={formData.type} onChange={(value) => updateField('type', value)} options={['Physical', 'Virtual', 'Storage', 'Switch', 'Firewall', 'Load Balancer', 'PDU', 'UPS', 'Console-Server', 'Patch Panel'].map((value) => ({ value, label: value }))} />
                  <AppDropdown disabled={isSaving} label="Status" value={formData.status} onChange={(value) => updateField('status', value)} options={ASSET_STATUSES.filter((value) => value !== 'Deleted').map((value) => ({ value, label: value }))} />
                  <AppDropdown disabled={isSaving} label="Environment" value={formData.environment} onChange={(value) => updateField('environment', value)} options={ASSET_ENVIRONMENTS.map((value) => ({ value, label: value }))} />
                  <AppDropdown disabled={isSaving} label="Depth" value={formData.depth} onChange={(value) => updateField('depth', value)} options={ASSET_DEPTHS.map((value) => ({ value, label: value }))} />
                  <AppDropdown disabled={isSaving} label="Mount Orientation" value={formData.mount_orientation} onChange={(value) => updateField('mount_orientation', value)} options={ASSET_MOUNT_ORIENTATIONS.map((value) => ({ value, label: value }))} />
                  {renderField('size_u', 'Size (U)', { type: 'number', min: 1, max: Number.MAX_SAFE_INTEGER, step: '1' })}
                </div>
              </WorkspaceSectionCard>
              <WorkspaceSectionCard title="Management">
                <div className="space-y-4">
                  {renderField('primary_ip', 'Primary IP')}
                  {renderField('management_ip', 'Management IP')}
                  {renderField('management_url', 'Management URL')}
                  {renderField('os_name', 'OS Name')}
                  {renderField('os_version', 'OS Version')}
                </div>
              </WorkspaceSectionCard>
            </section>
            <section className="grid gap-4 xl:grid-cols-2">
              <WorkspaceSectionCard title="Hardware & Inventory">
                <div className="grid gap-4 sm:grid-cols-2">
                  {renderField('manufacturer', 'Manufacturer')}
                  {renderField('model', 'Model')}
                  {renderField('serial_number', 'Serial Number', { required: true })}
                  {renderField('asset_tag', 'Asset Tag', { required: true })}
                  {renderField('power_typical_w', 'Typical Power (W)', { type: 'number', min: 0, step: 'any' })}
                  {renderField('power_max_w', 'Max Power (W)', { type: 'number', min: 0, step: 'any' })}
                </div>
              </WorkspaceSectionCard>
              <WorkspaceSectionCard title="Lifecycle & Metadata">
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    {renderField('purchase_date', 'Purchase Date', { type: 'date' })}
                    {renderField('install_date', 'Install Date', { type: 'date' })}
                    {renderField('warranty_end', 'Warranty End', { type: 'date' })}
                    {renderField('eol_date', 'EOL Date', { type: 'date' })}
                  </div>
                  <AssetRecordField label="Metadata JSON" value={metadataJsonText} onChange={setMetadataJsonText}
                    error={formErrors.metadata_json} disabled={isSaving} multiline />
                </div>
              </WorkspaceSectionCard>
            </section>
          </div>
        }
      />
    </WorkspaceModal>
  )
}

function MonitoringDetailModal({ item, onClose, onEdit, onOpenHistory, onOpenBkm, onDelete, onOpenAsset, onOpenKnowledge, deleteConfirm }: any) {
  useEscapeDismiss(onClose)
  useBodyModalFlag()
  const [isMaximized, setIsMaximized] = useState(false)
  const [expandedLogic, setExpandedLogic] = useState<number | null>(item.logic_json?.[0]?.id || null)
  const [showLineNumbers, setShowLineNumbers] = useState(true)
  const [interventionDoc, setInterventionDoc] = useState<any>(null)
  const detailTitle = getNetworkConnectionTitle(item)

  const { data: suggestedKnowledge } = useQuery({
    queryKey: ['monitoring-knowledge-suggestions', item.id, item.device_id],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (item.device_id) params.append('device_id', String(item.device_id))
      params.append('monitoring_id', String(item.id))
      const response = await apiFetch(`/api/v1/knowledge?${params.toString()}`)
      const linked = await response.json()
      if (Array.isArray(linked) && linked.length > 0) return linked
      if (!item.device_id) return linked
      const fallback = await apiFetch(`/api/v1/knowledge?device_id=${item.device_id}`)
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
                  <ToolbarButton
                    variant="primary"
                    onClick={() => {
                       const id = interventionDoc.id;
                       setInterventionDoc(null);
                       onOpenKnowledge?.(id);
                    }}
                  >
                     Confirm & Open Procedure
                  </ToolbarButton>
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

// Shared monitoring form constants and types are declared at the top of this module.

const stringifyOwnerUserIds = (owners: MonitoringOwner[] = []) =>
  owners
    .map((owner) => owner.external_id || owner.name || String(owner.operator_id))
    .filter(Boolean)
    .join(', ')

const isMonitoringFieldRequired = (fieldName: string) => MONITORING_REQUIRED_FIELD_NAMES.has(fieldName)

/*
  const unsafeUrlPattern = /[<>"']|javascript:|data:|vbscript:/i // verified match

  if (isMonitoringFieldRequired('title') && !formData.title?.trim()) errors.title = 'Title is required.'
  if (isMonitoringFieldRequired('category') && !formData.category) errors.category = 'Category is required.'
  if (isMonitoringFieldRequired('status') && !formData.status) errors.status = 'Status is required.'
  if (isMonitoringFieldRequired('severity') && !formData.severity) errors.severity = 'Severity is required.'

  if (formData.monitoring_url) {
    try {
      const parsed = new URL(formData.monitoring_url)
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
        errors.monitoring_url = 'Request link must use http/https and include a host.'
      }
    } catch {
      errors.monitoring_url = 'Request link must be a valid http/https URL.'
    }
    if (unsafeUrlPattern.test(formData.monitoring_url)) {
      errors.monitoring_url = 'Request link contains unsafe content.'
    }
  }

  if (Number.isNaN(formData.check_interval) || formData.check_interval < CHECK_INTERVAL_MIN || formData.check_interval > CHECK_INTERVAL_MAX) {
    errors.check_interval = `Check interval must be between ${CHECK_INTERVAL_MIN} and ${CHECK_INTERVAL_MAX} seconds.`
  }
  if (Number.isNaN(formData.alert_duration) || formData.alert_duration < ALERT_DURATION_MIN || formData.alert_duration > ALERT_DURATION_MAX) {
    errors.alert_duration = `Alert duration must be between ${ALERT_DURATION_MIN} and ${ALERT_DURATION_MAX} seconds.`
  }
  if (Number.isNaN(formData.notification_throttle) || formData.notification_throttle < NOTIFICATION_THROTTLE_MIN || formData.notification_throttle > NOTIFICATION_THROTTLE_MAX) {
    errors.notification_throttle = `Notification throttle must be between ${NOTIFICATION_THROTTLE_MIN} and ${NOTIFICATION_THROTTLE_MAX} seconds.`
  }

  if (formData.severity === 'Critical' && !formData.recovery_docs?.length) {
    errors.recovery_docs = 'Critical connections require at least one linked reference.'
  }
*/


const monitoringInputClass = (error?: string) => getWorkspaceInputClass(error)

export function NetworkConnectionForm({ item, devices, onClose, onSuccess, linkPurposeOptions, farmOptions, cableTypeOptions }: any) {
  useEscapeDismiss(onClose)
  useBodyModalFlag()
  const queryClient = useQueryClient()
  const [isSaving, setIsSaving] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [formData, setFormData] = useState(() => ({
    source_device_id: item?.source_device_id ?? '',
    source_port: item?.source_port ?? '',
    source_ip: item?.source_ip ?? '',
    source_mac: item?.source_mac ?? '',
    source_vlan: item?.source_vlan ?? '',
    target_device_id: item?.target_device_id ?? '',
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
  }))

  const deviceOptions = useMemo(() => (devices || []).map((device: any) => ({ value: String(device.id), label: device.name })), [devices])
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

  const fieldClass = useCallback((field: string) => monitoringInputClass(formErrors[field]), [formErrors])
  const formTitle = item?.id ? getNetworkConnectionTitle(item) : 'Create Network Connection'

  return (
    <WorkspaceModal
      isOpen={true}
      onClose={onClose}
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
                  <AppDropdown
                    label="Source Device"
                    required
                    value={String(formData.source_device_id)}
                    onChange={(value) => updateField('source_device_id', value)}
                    options={deviceOptions}
                    placeholder="Select source device"
                  />
                  <FieldError message={formErrors.source_device_id} />
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
                  <AppDropdown
                    label="Peer Device"
                    required
                    value={String(formData.target_device_id)}
                    onChange={(value) => updateField('target_device_id', value)}
                    options={deviceOptions}
                    placeholder="Select peer device"
                  />
                  <FieldError message={formErrors.target_device_id} />
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

export function MonitoringAssetField({
  devices,
  deviceId,
  onChange,
  error,
}: {
  devices: any[]
  deviceId: number | null
  onChange: (deviceId: number | null) => void
  error?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [systemFilter, setSystemFilter] = useState('ALL')
  const { triggerRef, panelRef, panelStyle } = useWorkspaceAnchoredLayer(isOpen, { minWidth: 420 })
  const selectedDevice = devices?.find((device: any) => device.id === deviceId)
  const systems = Array.from(new Set((devices || []).map((device: any) => device.system).filter(Boolean))).sort()
  const filteredDevices = (devices || []).filter((device: any) => {
    const matchesSystem = systemFilter === 'ALL' || device.system === systemFilter
    const needle = `${device.name} ${device.system || ''}`.toLowerCase()
    const matchesSearch = !search || needle.includes(search.toLowerCase())
    return matchesSystem && matchesSearch
  })

  useEffect(() => {
    if (!isOpen) return
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setIsOpen(false)
    }
    window.addEventListener('mousedown', handleClick)

    return () => {
      window.removeEventListener('mousedown', handleClick)
    }
  }, [isOpen, panelRef, triggerRef])

  return (
    <div className="space-y-1.5">
      <FieldLabel label="Registry Asset" />
      <div>
        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          ref={(node) => {
            triggerRef.current = node
          }}
          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-all ${error ? 'border-rose-500/60 bg-rose-500/10' : 'border-white/10 bg-slate-950/70 hover:border-blue-500/30'}`}
        >
          <span className={`text-[clamp(10px,0.85vw,12px)] font-black truncate pr-4 ${selectedDevice ? 'text-slate-100' : 'text-slate-500'}`}>
            {selectedDevice ? `${selectedDevice.name} [${selectedDevice.system}]` : 'Select asset'}
          </span>
          <ChevronDown size={12} className={`shrink-0 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen && createPortal(
          <div ref={panelRef} style={panelStyle}>
            <WorkspaceFloatingPanel
              kind="menu"
              className="p-2"
            >
            <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-2">
              <MonitoringSelectField
                label="System Filter"
                value={systemFilter}
                onChange={(value) => setSystemFilter(value)}
                options={[{ value: 'all', label: 'All Systems' }, ...systems.map((system) => ({ value: system, label: system }))]}
                placeholder="All Systems"
                />
              <div className="space-y-1.5">
                <FieldLabel label="Search Asset" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search hostname or system..."
                  className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[10px] font-black text-slate-100 outline-none focus:border-blue-500/40"
                />
              </div>
            </div>
            <div className="mt-2 max-h-52 overflow-y-auto custom-scrollbar space-y-1 pr-1">
              <button
                type="button"
                onClick={() => {
                  onChange(null)
                  setIsOpen(false)
                }}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-all ${deviceId == null ? 'border-blue-500/30 bg-blue-500/10' : 'border-white/5 bg-black/20 hover:border-white/10'}`}
              >
                <p className="text-[9px] font-black text-slate-200">No linked asset</p>
              </button>
              {filteredDevices.map((device: any) => (
                <button
                  key={device.id}
                  type="button"
                  onClick={() => {
                    onChange(device.id)
                    setIsOpen(false)
                    setSearch('')
                  }}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-all ${device.id === deviceId ? 'border-blue-500/30 bg-blue-500/10' : 'border-white/5 bg-black/20 hover:border-white/10'}`}
                >
                  <p className={`text-[9px] font-black ${device.id === deviceId ? 'text-blue-300' : 'text-slate-200'}`}>{device.name}</p>
                  <p className="mt-0.5 text-[8px] font-black text-slate-500 truncate">{device.system || 'No system'}</p>
                </button>
              ))}
            </div>
            </WorkspaceFloatingPanel>
          </div>,
          document.body
        )}
      </div>
      <FieldError message={error} />
    </div>
  )
}

// Extracted to MonitoringForm.tsx

function MonitoringHistoryModal({ item, onClose }: any) {
  useEscapeDismiss(onClose)
  useBodyModalFlag()
  const [isMaximized, setIsMaximized] = useState(false)
  const queryClient = useQueryClient()
  const { data: history, isLoading } = useQuery({
    queryKey: ['monitoring-history', item.id],
    queryFn: async () => (await apiFetch(`/api/v1/monitoring/${item.id}/history`)).json()
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
                               toast.promise(apiFetch(`/api/v1/monitoring/${item.id}/restore/${h.id}`, { method: 'POST' }), {
                                   loading: 'Restoring state...',
                                   success: () => { queryClient.invalidateQueries({ queryKey: ['monitoring-items'] }); queryClient.invalidateQueries({ queryKey: ['monitoring-history', item.id] }); return "Restored successfully"; },
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
