import { useWorkspaceConfirmation } from './shared/useWorkspaceConfirmation'
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { javascript } from '@codemirror/lang-javascript'
import {
  Activity, Plus, Search, Filter, ExternalLink,
  Trash2, Edit2, Shield, Cpu, Database, Network, 
  Globe, Bell, Info, ChevronRight, X, Check, Save,
  AlertCircle, Clock, Zap, Settings, ArrowRightLeft, Briefcase, UserCheck, Code,
  BookOpen, Eye, EyeOff, FileText, Users, Mail, MessageSquare, Monitor, MoreVertical,
  Download, Copy, ChevronDown, ChevronUp, Layers, RefreshCcw, Tag, Sliders, Clipboard, Lightbulb, Maximize2, Minimize2, GitCompare, Undo2, List, LayoutGrid, Upload, Terminal, History as HistoryIcon, Edit2 as EditIcon, Star
} from 'lucide-react'
import { parseOperationalApiValidationError } from './shared/OperationalFieldValidation'
import { AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { showWorkspaceRevertToast, showWorkspaceToast } from './shared/WorkspaceToast'
import { apiFetch } from '../api/apiClient'
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
  getWorkspaceModalFrameClass,
  getWorkspaceModalShellClass,
  getWorkspaceInputClass,
  useEscapeDismiss,
  useBodyModalFlag,
  useWorkspaceAnchoredLayer,
} from './shared/OperationalWorkspacePrimitives'
import { WorkspaceFlyoutActionCard, WorkspaceFlyoutDropdownEditor } from './shared/WorkspaceFlyout'
import { StatusPill } from './shared/StatusPill'
import { parseCommaSeparatedValues } from '../utils/dataParsers'
import { HeaderScopeSwitch, ToolbarButton, ToolbarGroup, ToolbarIconButton, ToolbarSearch } from './shared/LayoutPrimitives'
import { useOperationalDetailRoute, useOperationalGridRuntime, usePersistentJsonState, useWorkspaceOverlayController, useWorkspaceSessionValue } from './shared/OperationalWorkspaceHooks'
import {
  useOperationalRowInteractions,
  useOperationalContextMenu,
  useOperationalDismissController,
  useOperationalGroupedSelection,
} from './shared/OperationalGridInteractions'
import { WorkspaceCompareShell, WorkspaceDossierShell } from './shared/WorkspaceModalShells'
import { WorkspaceShareHeader } from './shared/WorkspaceShareHeader'
import { OperationalImportModal } from './shared/OperationalImportModal'
import { downloadOperationalImportFile } from './shared/OperationalImportExport'
import { OperationalDataGrid } from './shared/OperationalDataGrid'
import { resolveOperationalDataState } from './shared/OperationalDataState'
import DiagnosticStatusPill, { DataDiagnosticModal, buildOperationalDiagnosticDetail } from './shared/OperationalDataStatus'
import { OPERATIONAL_ACTION_LABELS } from './shared/OperationalActionLabels'
import { OperationalDisabledActionTooltip } from './shared/OperationalDisabledActionTooltip'
import {
  OperationalRowActionMenu,
  type OperationalRowActionSectionModel,
  type OperationalRowActionItem,
  type OperationalRowActionSectionId,
  type OperationalRowActionTone,
  type OperationalRowActionVariant
} from './shared/OperationalRowActionMenu'
import {
  OperationalAnchoredPanel,
  OperationalDisplayPanel,
  OperationalGroupedGridSection,
  OperationalGroupedGridView,
  OperationalSavedViewsPanel,
  OperationalWorkspaceShell,
} from './shared/OperationalWorkspaceShells'
import {
  canonicalizeServiceStatus,
  ServiceDetailsView,
  ServiceForm,
  SERVICE_STATUS_DEFINITIONS as STATUSES,
} from './ServiceRegistry'
import {
  applyOperationalColumnState,
  autoSizeOperationalColumns,
  getOperationalColumnLayoutSnapshot,
  normalizeOperationalColumnLayout,
  sanitizeOperationalColumnLayout,
  sanitizeOperationalFilterModel,
  sanitizeOperationalSortModel,
} from './shared/OperationalGridSizing'
import {
  type OperationalColumnConfig,
  OPERATIONAL_GRID_WIDTHS,
} from './shared/OperationalGridContract'
import {
  buildOperationalGridColumnDefinitions,
  renderOperationalActionButtons,
} from './shared/OperationalGridStandard'
import {
  countSemanticBulkChanges,
  resolveBulkFieldLabel,
  showOperationalBulkErrorToast,
  showOperationalBulkRevertErrorToast,
  showOperationalBulkResultToast,
  showOperationalBulkRevertedToast,
} from './shared/OperationalBulkContract'
import {
  OperationalBulkPreviewModal,
  type OperationalBulkPreview,
  type OperationalBulkResult,
} from './shared/OperationalBulkPreviewModal'
import { useCollaborativeWorkspaceViews } from './shared/CollaborativeWorkspaceViews'

const SERVICE_VIEW_STORAGE_KEY = 'sysgrid_services_views_v1'
const SERVICE_ACTIVE_VIEW_KEY = 'sysgrid_services_active_view_v1'
const SERVICE_FAVORITES_STORAGE_KEY = 'sysgrid_services_favorites_v1'
const SERVICE_UI_STATE_KEY = 'sysgrid_services_ui_state_v1'
const SERVICE_WATCH_STORAGE_KEY = 'sysgrid_services_watch_v1'
const SERVICE_COLLABORATIVE_VIEW_MIGRATION_KEY = 'sysgrid_services_collaborative_views_v1_migrated'
const SERVICE_WORKSPACE_PREFERENCE_KEY = 'services_workspace_state_v1'
const SERVICE_WORKSPACE_PREFERENCE_VERSION = 2
const BULK_MENU_MAX_HEIGHT = 560
const SERVICES_BULK_FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  service_type: 'Service Type',
  environment: 'Environment',
}
const SERVICES_PURGE_BLOCKED_REASON = 'Purge is unavailable because logical-services backend does not support truthful purge/revert yet.'
const SERVICE_FIXED_WIDTH_COLUMN_IDS = new Set([
  'select',
  'id',
  'recent_change',
  'favorite',
  'watch',
  'row_actions',
])

const sanitizeServiceColumnLayout = (layout: any[], preserveWidths: boolean) => {
  const sanitized = sanitizeOperationalColumnLayout(layout, SERVICE_PERSISTED_COLUMN_IDS, preserveWidths).map((column: any) => (
    preserveWidths && SERVICE_FIXED_WIDTH_COLUMN_IDS.has(column?.colId)
      ? {
          ...column,
          width: undefined,
          flex: undefined,
        }
      : column
  ))

  return [...sanitized].sort((a: any, b: any) => {
    const aIndex = SERVICE_DEFAULT_COLUMN_ORDER_MAP.get(a?.colId) ?? 1000
    const bIndex = SERVICE_DEFAULT_COLUMN_ORDER_MAP.get(b?.colId) ?? 1000
    return aIndex - bIndex
  })
}

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

export interface OperatorRecord {
  id: number
  username: string
  full_name: string
  external_id: string
  team_id?: number
  team?: string
}

const DEFAULT_SERVICE_VIEWS = []
const DEFAULT_SERVICE_VIEW_IDS = new Set(DEFAULT_SERVICE_VIEWS.map((view) => view.id))
const SERVICE_SUPPORTS_COMPARE = true
const SERVICE_VALID_GROUP_BY = new Set(['raw', 'status', 'environment', 'service_type', 'device_name'])
const SERVICE_PERSISTED_COLUMN_IDS = new Set([
  'select',
  'id',
  'recent_change',
  'favorite',
  'watch',
  'device_name',
  'name',
  'service_type',
  'environment',
  'version',
  'status',
  'purpose',
  'manufacturer',
  'supplier',
  'purchase_type',
  'cost',
  'currency',
  'installation_date',
  'secret_count',
  'created_at',
  'updated_at',
  'row_actions',
])
const SERVICE_DEFAULT_COLUMN_ORDER = [
  'select',
  'id',
  'recent_change',
  'favorite',
  'watch',
  'device_name',
  'name',
  'service_type',
  'environment',
  'version',
  'status',
  'purpose',
  'manufacturer',
  'supplier',
  'purchase_type',
  'cost',
  'installation_date',
  'created_at',
  'updated_at',
  'row_actions',
]
const SERVICE_DEFAULT_COLUMN_ORDER_MAP = new Map(SERVICE_DEFAULT_COLUMN_ORDER.map((colId, index) => [colId, index]))

const readJsonStorage = <T,>(storageKey: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw == null ? fallback : JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const normalizeServiceIdList = (value: any): number[] => {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry) && entry > 0)
  ))
}

const normalizeServiceQuickFilters = (value: any) => ({
  status: Array.isArray(value?.status) ? value.status.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [],
  environment: Array.isArray(value?.environment) ? value.environment.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [],
  service_type: Array.isArray(value?.service_type) ? value.service_type.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [],
  device_name: Array.isArray(value?.device_name) ? value.device_name.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [],
})

const normalizeServiceSavedViews = (value: any) => {
  const parsed = Array.isArray(value) ? value : []
  const systemIds = new Set(DEFAULT_SERVICE_VIEWS.map((view) => view.id))
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
    ...DEFAULT_SERVICE_VIEWS.map((view) => parsed.find((entry: any) => entry?.id === view.id) || view),
    ...customViews.map((view: any) => ({
      ...view,
      config: sanitizeServiceViewConfig(view?.config),
    })),
  ]
}

const sanitizeServiceViewConfig = (config: any) => {
  const safeConfig = config && typeof config === 'object' ? config : {}
  return {
    fontSize: Number.isFinite(safeConfig.fontSize) ? safeConfig.fontSize : 11,
    rowDensity: Number.isFinite(safeConfig.rowDensity) ? safeConfig.rowDensity : 8,
    hiddenColumns: Array.isArray(safeConfig.hiddenColumns)
      ? safeConfig.hiddenColumns.filter((entry: any) => typeof entry === 'string' && SERVICE_PERSISTED_COLUMN_IDS.has(entry))
      : [],
    groupBy: typeof safeConfig.groupBy === 'string' && SERVICE_VALID_GROUP_BY.has(safeConfig.groupBy) ? safeConfig.groupBy : 'raw',
    showFilterBar: safeConfig.showFilterBar !== false,
    columnLayoutState: sanitizeServiceColumnLayout(Array.isArray(safeConfig.columnLayoutState) ? safeConfig.columnLayoutState : [], true),
    quickFilter: typeof safeConfig.quickFilter === 'string' ? safeConfig.quickFilter : '',
    quickFilters: normalizeServiceQuickFilters(safeConfig.quickFilters),
    filterModel: sanitizeOperationalFilterModel(safeConfig.filterModel, SERVICE_PERSISTED_COLUMN_IDS),
    sortModel: sanitizeOperationalSortModel(safeConfig.sortModel, SERVICE_PERSISTED_COLUMN_IDS),
  }
}

const normalizeServiceWorkspaceState = (value: any) => {
  if (!value || typeof value !== 'object') return null
  const uiState = value.uiState && typeof value.uiState === 'object' ? value.uiState : {}
  const normalized = {
    version: SERVICE_WORKSPACE_PREFERENCE_VERSION,
    savedViews: normalizeServiceSavedViews(value.savedViews),
    activeViewId: typeof value.activeViewId === 'string' && value.activeViewId.trim() ? value.activeViewId : null,
    favoriteIds: normalizeServiceIdList(value.favoriteIds),
    watchIds: normalizeServiceIdList(value.watchIds),
    uiState: {
      activeTab: uiState.activeTab === 'deleted' ? 'deleted' : 'active',
      fontSize: Number.isFinite(uiState.fontSize) ? uiState.fontSize : 11,
      rowDensity: Number.isFinite(uiState.rowDensity) ? uiState.rowDensity : 8,
      hiddenColumns: Array.isArray(uiState.hiddenColumns)
        ? uiState.hiddenColumns.filter((entry: any) => typeof entry === 'string' && SERVICE_PERSISTED_COLUMN_IDS.has(entry))
        : ['created_at', 'updated_at'],
      quickFilters: normalizeServiceQuickFilters(uiState.quickFilters),
      groupBy: typeof uiState.groupBy === 'string' && SERVICE_VALID_GROUP_BY.has(uiState.groupBy) ? uiState.groupBy : 'raw',
      showFilterBar: uiState.showFilterBar !== false,
      columnLayoutState: sanitizeServiceColumnLayout(Array.isArray(uiState.columnLayoutState) ? uiState.columnLayoutState : [], false),
      lastVisitedAt: Number.isFinite(uiState.lastVisitedAt) ? uiState.lastVisitedAt : 0,
      searchTerm: typeof uiState.searchTerm === 'string' ? uiState.searchTerm : '',
    }
  }
  return normalized
}

const readServiceWorkspaceStateFromLocalStorage = () => normalizeServiceWorkspaceState({
  savedViews: readJsonStorage<any[]>(SERVICE_VIEW_STORAGE_KEY, []),
  activeViewId: typeof window === 'undefined' ? null : window.localStorage.getItem(SERVICE_ACTIVE_VIEW_KEY),
  favoriteIds: readJsonStorage<number[]>(SERVICE_FAVORITES_STORAGE_KEY, []),
  watchIds: readJsonStorage<number[]>(SERVICE_WATCH_STORAGE_KEY, []),
  uiState: readJsonStorage(SERVICE_UI_STATE_KEY, null),
})

const slugifyViewId = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `view-${Date.now()}`

// Removed stale floating panel positioning helpers.

// Isolated component to prevent UI state changes (menus) from triggering AgGrid recalculations
const getServiceGroupValue = (item: any, field: string) => {
  return item[field] || 'Unspecified'
}

const readServiceUiState = () => {
  return readServiceWorkspaceStateFromLocalStorage()?.uiState ?? null
}

const SERVICE_PURCHASE_TYPES = ['One-time', 'Subscription', 'OEM', 'Free']
const SERVICE_CURRENCY_OPTIONS = ['USD', 'EUR', 'KRW', 'JPY', 'GBP']
const getServiceTitle = (service: any) => service?.name || `Service ${service?.id ?? 'Unknown'}`

const normalizeServiceRecord = (service: any) => {
  const status = canonicalizeServiceStatus(service?.status)
  const serviceType = service?.service_type || 'Service'
  const environment = service?.environment || 'Production'
  const hostName = service?.device_name || 'Floating'

  return {
    ...service,
    status,
    service_type: serviceType,
    environment,
    device_name: hostName,
    is_active: !service?.is_deleted,
    is_deleted: Boolean(service?.is_deleted),
    secret_count: Number(service?.secret_count || service?.secrets?.length || 0),
  }
}

const sanitizeServicePayload = (item: any) => ({
  name: String(item?.name || item?.title || '').trim(),
  service_type: String(item?.service_type || item?.type || item?.category || 'Service').trim(),
  status: canonicalizeServiceStatus(item?.status),
  version: item?.version ? String(item.version).trim() : null,
  environment: item?.environment ? String(item.environment).trim() : 'Production',
  device_id: item?.device_id === '' || item?.device_id == null ? null : Number(item.device_id),
  config_json: item?.config_json && typeof item.config_json === 'object' ? item.config_json : {},
  custom_attributes: item?.custom_attributes && typeof item.custom_attributes === 'object' ? item.custom_attributes : {},
  logic_json: Array.isArray(item?.logic_json) ? item.logic_json : [],
  purchase_type: item?.purchase_type ? String(item.purchase_type).trim() : 'One-time',
  license_key: item?.license_key ? String(item.license_key).trim() : null,
  purchase_date: item?.purchase_date ? String(item.purchase_date).trim() : null,
  expiry_date: item?.expiry_date ? String(item.expiry_date).trim() : null,
  installation_date: item?.installation_date ? String(item.installation_date).trim() : null,
  purpose: item?.purpose ? String(item.purpose).trim() : null,
  documentation_link: item?.documentation_link ? String(item.documentation_link).trim() : null,
  manufacturer: item?.manufacturer ? String(item.manufacturer).trim() : null,
  supplier: item?.supplier ? String(item.supplier).trim() : null,
  cost: item?.cost === '' || item?.cost == null ? 0 : Number(item.cost),
  currency: item?.currency ? String(item.currency).trim() : 'USD',
})
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
                <p className="text-[9px] font-bold text-slate-500 uppercase">Live Service Registry</p>
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

export default function ServicesReal() {
  const { confirm: confirmWorkspaceAction, confirmation } = useWorkspaceConfirmation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const gridRef = React.useRef<any>(null)
  const { data: userSettings, isSuccess: hasUserSettings } = useQuery({
    queryKey: ['user-settings'],
    queryFn: async () => (await (await apiFetch('/api/v1/settings/user/settings')).json()),
  })
  const remoteWorkspaceState = useMemo(
    () => normalizeServiceWorkspaceState(userSettings?.[SERVICE_WORKSPACE_PREFERENCE_KEY]),
    [userSettings]
  )
  const localWorkspaceState = useMemo(() => readServiceWorkspaceStateFromLocalStorage(), [])
  const hasStoredFavoriteIds = useMemo(
    () => typeof window !== 'undefined' && window.localStorage.getItem(SERVICE_FAVORITES_STORAGE_KEY) !== null,
    []
  )
  const hasStoredWatchIds = useMemo(
    () => typeof window !== 'undefined' && window.localStorage.getItem(SERVICE_WATCH_STORAGE_KEY) !== null,
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
  const [showImportModal, setShowImportModal] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [showBulkEditModal, setShowBulkEditModal] = useState(false)
  const [showServicesDataDiagnostic, setShowServicesDataDiagnostic] = useState(false)
  
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [isBulkStatusOpen, setIsBulkStatusOpen] = useState(false)
  const [isBulkSeverityOpen, setIsBulkSeverityOpen] = useState(false)
  const [isBulkNotifyOpen, setIsBulkNotifyOpen] = useState(false)
  const [confirmModal, setConfirmModal] = useState<any>({ isOpen: false, title: '', message: '', onConfirm: () => {}, variant: 'info' })
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [detailDeleteConfirm, setDetailDeleteConfirm] = useState(false)
  const [rowDeleteConfirmId, setRowDeleteConfirmId] = useState<number | null>(null)
  const [rowActionMenu, setRowActionMenu] = useState<{ item: any; point: { x: number; y: number } } | null>(null)
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
  const hasRowActionMenu = activeOverlay === 'rowAction' && !!rowActionMenu
  const [isIntelligenceExpanded, setIsIntelligenceExpanded] = useState(false)
  const [gridFilterModel, setGridFilterModel] = useState<Record<string, any>>({})
  const [gridSortModel, setGridSortModel] = useState<any[]>([{ colId: 'favorite', sort: 'desc' }])
  const [savedViews, setSavedViews] = usePersistentJsonState<any[]>(SERVICE_VIEW_STORAGE_KEY, () => {
    return initialWorkspaceState?.savedViews ?? normalizeServiceSavedViews([])
  })
  const [activeViewId, setActiveViewId] = useWorkspaceSessionValue<string | null>(
    'sysgrid_services_session_init',
    null,
    () => initialWorkspaceState?.activeViewId ?? (typeof window === 'undefined' ? null : window.localStorage.getItem(SERVICE_ACTIVE_VIEW_KEY))
  )
  const [favoriteIds, setFavoriteIds] = usePersistentJsonState<number[]>(SERVICE_FAVORITES_STORAGE_KEY, initialWorkspaceState?.favoriteIds ?? [])
  const [watchIds, setWatchIds] = usePersistentJsonState<number[]>(SERVICE_WATCH_STORAGE_KEY, initialWorkspaceState?.watchIds ?? [])
  const [quickFilters, setQuickFilters] = useState(persistedUiState?.quickFilters ?? { status: [] as string[], environment: [] as string[], service_type: [] as string[], device_name: [] as string[] })
  const [searchTerm, setSearchTerm] = useState(persistedUiState?.searchTerm ?? '')
  const [groupBy, setGroupBy] = useState<string>(persistedUiState?.groupBy ?? 'raw')
  const [bulkDraft, setBulkDraft] = useState({ status: '', service_type: '', environment: '' })
  const [bulkOperationPreview, setBulkOperationPreview] = useState<{
    action: string
    payload: Record<string, any>
    ids: number[]
    actionLabel: string
    fieldLabel?: string
    nextValue?: string
    preview: OperationalBulkPreview
    result?: OperationalBulkResult
    onRevert?: () => Promise<void>
  } | null>(null)
  const [isBulkReverting, setIsBulkReverting] = useState(false)
  const [expandedBulkSection, setExpandedBulkSection] = useState<'status' | 'service_type' | 'environment' | null>(null)
  const [lastVisitedAt] = useState<number>(() => persistedUiState?.lastVisitedAt ?? 0)
  const [pendingIds, setPendingIds] = useState<number[]>([])
  // Removed redundant refs and styles. Anchoring is now handled by useWorkspaceAnchoredLayer.
  const { triggerRef: displayMenuButtonRef, panelRef: displayMenuPanelRef, panelStyle: displayMenuStyle } = useWorkspaceAnchoredLayer(showDisplayMenu, { minWidth: 320 })
  const { triggerRef: viewsMenuButtonRef, panelRef: viewsMenuPanelRef, panelStyle: viewsMenuStyle } = useWorkspaceAnchoredLayer(showViewsMenu, { minWidth: 420 })
  const { triggerRef: bulkMenuButtonRef, panelRef: bulkMenuPanelRef, panelStyle: bulkMenuStyle } = useWorkspaceAnchoredLayer(showBulkMenu, { minWidth: 340 })
  const lastUndoRef = useRef<any>(null)
  const [newViewName, setNewViewName] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const autoSizeFrameRef = useRef<number | null>(null)
  const autoSizeTimeoutRef = useRef<number | null>(null)
  const servicePreferenceHydratedRef = useRef(false)
  const servicePreferenceMigratedRef = useRef(false)
  const servicePreferenceSyncRef = useRef<string | null>(null)
  const servicePreferenceSyncTimeoutRef = useRef<number | null>(null)
  const preserveExplicitColumnWidthsRef = useRef(false)
  const {
    columnLayoutState,
    setColumnLayoutState,
    setTransientManualColumnWidths,
    preserveExplicitColumnWidths,
    syncColumnLayoutState,
    applyColumnLayoutState,
    handleColumnResized: handleBaseColumnResized,
    handleColumnMoved,
    handleDragStopped,
    handleColumnPinned,
    handleColumnVisible,
    handleGridReady: handleBaseGridReady,
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
    onGridApiReady: (params) => {
      if (typeof window !== 'undefined') {
        ;(window as any).__DEBUG_SERVICES_GRID_API__ = params.api
      }
      if (columnLayoutState.length > 0) {
        applyOperationalColumnState(params.api, columnLayoutState, preserveExplicitColumnWidths)
      }
    },
    onBeforeManualResize: (event) => {
      clearPendingAutoSize()
      preserveExplicitColumnWidthsRef.current = true
      setTransientManualColumnWidths(true)
    },
  })

  const handleColumnResized = useCallback((event: any) => {
    const source = event?.source || ''
    const isAutoResizeSource =
      source === 'autosizeColumns' ||
      source === 'sizeColumnsToFit' ||
      source === 'api' ||
      source === 'flex'

    if (!isAutoResizeSource) {
      // Logic handled by onBeforeManualResize in useOperationalGridRuntime
    }

    handleBaseColumnResized(event)
  }, [handleBaseColumnResized])

  const handleGridReady = handleBaseGridReady;

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

  const buildServiceWorkspacePreferencePayload = useCallback(() => normalizeServiceWorkspaceState({
    version: SERVICE_WORKSPACE_PREFERENCE_VERSION,
    savedViews: [],
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
    searchTerm,
    showFilterBar,
    watchIds,
  ])

  useEffect(() => clearPendingAutoSize, [clearPendingAutoSize])

  useEffect(() => {
    if (remoteWorkspaceState && !servicePreferenceHydratedRef.current) {
      servicePreferenceHydratedRef.current = true
      const payload = initialWorkspaceState ?? normalizeServiceWorkspaceState(remoteWorkspaceState)
      const serialized = JSON.stringify(payload)
      servicePreferenceSyncRef.current = serialized
      setActiveViewId(payload?.activeViewId ?? null)
      setFavoriteIds(hasStoredFavoriteIds ? (localWorkspaceState?.favoriteIds ?? []) : (payload?.favoriteIds ?? []))
      setWatchIds(hasStoredWatchIds ? (localWorkspaceState?.watchIds ?? []) : (payload?.watchIds ?? []))
      setFontSize(payload?.uiState.fontSize ?? 11)
      setRowDensity(payload?.uiState.rowDensity ?? 8)
      setHiddenColumns(payload?.uiState.hiddenColumns ?? ['created_at', 'updated_at'])
      setActiveTab(payload?.uiState.activeTab === 'deleted' ? 'deleted' : 'active')
      setShowFilterBar(payload?.uiState.showFilterBar !== false)
      setQuickFilters(payload?.uiState.quickFilters ?? normalizeServiceQuickFilters(null))
      setGroupBy(payload?.uiState.groupBy ?? 'raw')
      setColumnLayoutState(payload?.uiState.columnLayoutState ?? [])
      setSearchTerm(payload?.uiState.searchTerm ?? '')
      return
    }

    if (hasUserSettings && !remoteWorkspaceState && !servicePreferenceMigratedRef.current) {
      servicePreferenceMigratedRef.current = true
      const localPayload = buildServiceWorkspacePreferencePayload()
      if (!localPayload) return
      const serialized = JSON.stringify(localPayload)
      servicePreferenceSyncRef.current = serialized
      apiFetch('/api/v1/settings/user/settings', {
        method: 'PATCH',
        body: JSON.stringify({ [SERVICE_WORKSPACE_PREFERENCE_KEY]: localPayload })
      }).catch(() => {})
    }
  }, [
    buildServiceWorkspacePreferencePayload,
    hasStoredFavoriteIds,
    hasStoredWatchIds,
    hasUserSettings,
    initialWorkspaceState,
    localWorkspaceState,
    remoteWorkspaceState,
    setActiveViewId,
    setColumnLayoutState,
    setFavoriteIds,
    setWatchIds,
  ])

  useEffect(() => {
    if (!hasUserSettings) return
    const payload = buildServiceWorkspacePreferencePayload()
    if (!payload) return
    const serialized = JSON.stringify(payload)
    if (servicePreferenceSyncRef.current === serialized) return
    if (servicePreferenceSyncTimeoutRef.current !== null) {
      window.clearTimeout(servicePreferenceSyncTimeoutRef.current)
    }
    servicePreferenceSyncTimeoutRef.current = window.setTimeout(() => {
      apiFetch('/api/v1/settings/user/settings', {
        method: 'PATCH',
        body: JSON.stringify({ [SERVICE_WORKSPACE_PREFERENCE_KEY]: payload })
      })
        .then(() => {
          servicePreferenceSyncRef.current = serialized
        })
        .catch(() => {})
    }, 500)
    return () => {
      if (servicePreferenceSyncTimeoutRef.current !== null) {
        window.clearTimeout(servicePreferenceSyncTimeoutRef.current)
        servicePreferenceSyncTimeoutRef.current = null
      }
    }
  }, [buildServiceWorkspacePreferencePayload, hasUserSettings])

  const handleRowId = useCallback((params: any) => {
    if (params?.data?.id != null) return String(params.data.id)
    return String(params?.node?.id ?? 'unknown-row')
  }, [])
  const { handleCellContextMenu, openRowActionMenuAtPoint } = useOperationalContextMenu({
    onOpenRowActionMenu: useCallback((item, point) => {
      setRowActionMenu({ item, point })
      openOverlay('rowAction')
    }, [openOverlay])
  })

  const autoSizeServiceColumns = useCallback(() => {
    if (!gridRef.current?.api || preserveExplicitColumnWidthsRef.current) return
    clearPendingAutoSize()
    const run = () => {
      if (!gridRef.current?.api || preserveExplicitColumnWidthsRef.current) return
      autoSizeOperationalColumns({
        api: gridRef.current.api,
        skipColumnIds: Array.from(SERVICE_FIXED_WIDTH_COLUMN_IDS),
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
    autoSizeServiceColumns()
  }, [autoSizeServiceColumns])

  const getRowClass = useCallback((params: any) => {
    const rowIndex = typeof params?.node?.rowIndex === 'number' ? params.node.rowIndex : 0
    let classes = rowIndex % 2 === 0 ? 'operational-grid-row-even' : 'operational-grid-row-odd'
    if (params?.data && pendingIds.includes(params.data.id)) {
      classes += ' row-ghost opacity-40 grayscale pointer-events-none'
    }
    return classes
  }, [pendingIds])

  const { data: settingsOptions } = useQuery({ 
    queryKey: ['settings-options'], 
    queryFn: async () => (await (await apiFetch('/api/v1/settings/options')).json()) 
  })
  const serviceTypeOptions = useMemo(() => {
    const options = Array.isArray(settingsOptions) ? settingsOptions.filter((o:any) => o.category === 'ServiceType') : []
    return options.length > 0
      ? options.map((option: any) => ({ value: option.value, label: option.label }))
      : ['Database', 'Application', 'OS', 'Middleware', 'API'].map((value) => ({ value, label: value }))
  }, [settingsOptions])
  const environmentOptions = useMemo(() => {
    const options = Array.isArray(settingsOptions) ? settingsOptions.filter((o:any) => o.category === 'Environment') : []
    return options.length > 0
      ? options.map((option: any) => ({ value: option.value, label: option.label }))
      : ['Production', 'Stage', 'Development', 'Lab'].map((value) => ({ value, label: value }))
  }, [settingsOptions])
  const purchaseTypeOptions = useMemo(() => SERVICE_PURCHASE_TYPES.map((value) => ({ value, label: value })), [])

  const openConfirm = (title: string, message: string, onConfirm: () => void, variant: any = 'danger') => {
    setConfirmModal({ isOpen: true, title, message, onConfirm, variant })
  }

  const openRowActionMenu = (event: React.MouseEvent, item: any) => {
    event.stopPropagation()
    openRowActionMenuAtPoint(item, event.clientX, event.clientY)
  }

  const togglePanel = (panel: 'display' | 'views' | 'bulk') => {
    toggleOverlay(panel)
  }

  const toggleFavorite = useCallback((monitorId: number) => {
    const id = Number(monitorId)
    setFavoriteIds((current) => {
      const normalized = normalizeServiceIdList(current)
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
    if (!item?.id) return null
    const isPending = pendingIds.includes(item.id)
    return (
      <div className={isPending ? 'opacity-20 grayscale pointer-events-none' : ''}>
        {renderOperationalActionButtons(
          <>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                detailRoute.openDetail(item, { replace: false })
              }}
              title="Open details"
              className="text-blue-400 hover:bg-blue-400/10"
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
              className="text-emerald-400 hover:bg-emerald-400/10"
            >
              <Edit2 size={13} />
            </button>
            <button
              type="button"
              onClick={(event: any) => openRowActionMenu(event, item)}
              title="More actions"
              className="row-action-trigger row-action-menu-container text-slate-400 hover:bg-slate-400/10 hover:text-white"
            >
              <MoreVertical size={13} />
            </button>
          </>
        )}
      </div>
    )
  }

  const handleExportCSV = async () => {
    const exportDate = new Date().toISOString().split('T')[0]
    try {
      const download = await downloadOperationalImportFile({
        tableName: 'logical_services',
        kind: 'snapshot',
        preferredFileName: `SysGrid_Services_${exportDate}.csv`,
      })
      showWorkspaceToast(
        `Exported ${download.fileName}. Includes active services only; archived rows, selection, filters, and hidden viewport columns are not part of this snapshot.`
      )
    } catch (error: any) {
      showWorkspaceToast(error.message || 'Services export failed', { type: 'error' })
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
    sanitizeServiceViewConfig({
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

  const setCollaborativeActiveViewId = useCallback((id: string | null) => {
    setActiveViewId(id)
    if (typeof window !== 'undefined') {
      if (id) window.localStorage.setItem(SERVICE_ACTIVE_VIEW_KEY, id)
      else window.localStorage.removeItem(SERVICE_ACTIVE_VIEW_KEY)
    }
  }, [])

  const collaborativeViews = useCollaborativeWorkspaceViews({
    workspaceKey: 'services',
    migrationKey: SERVICE_COLLABORATIVE_VIEW_MIGRATION_KEY,
    systemViewIds: DEFAULT_SERVICE_VIEW_IDS,
    currentViews: savedViews,
    setCurrentViews: setSavedViews,
    normalizeViews: normalizeServiceSavedViews,
    sanitizeDefinition: sanitizeServiceViewConfig,
    activeViewId,
    onActiveViewIdChange: setCollaborativeActiveViewId,
    currentDefinition: buildCurrentViewConfig(),
  })

  useEffect(() => {
    if (!collaborativeViews.dirty) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [collaborativeViews.dirty])

  const allowViewSwitch = async (nextViewId: string | null) => {
    if (!collaborativeViews.dirty || nextViewId === activeViewId) return true
    return confirmWorkspaceAction({ title: 'Discard view changes?', message: 'This workspace has unsaved view changes. Discard them and switch views?', confirmText: 'Discard and switch', variant: 'warning' })
  }

  const applySavedView = async (viewId: string) => {
    if (!await allowViewSwitch(viewId)) return
    const nextView = savedViews.find((view) => view.id === viewId)
    if (!nextView) return
    const config = sanitizeServiceViewConfig(nextView.config)
    setFontSize(config.fontSize ?? 11)
    setRowDensity(config.rowDensity ?? 8)
    setHiddenColumns(config.hiddenColumns ?? [])
    setGroupBy(config.groupBy ?? 'raw')
    setShowFilterBar(config.showFilterBar ?? true)
    setColumnLayoutState(config.columnLayoutState ?? [])
    setTransientManualColumnWidths(false)
    setSearchTerm(config.quickFilter ?? '')
    setQuickFilters(config.quickFilters ?? { status: [] as string[], environment: [] as string[], service_type: [] as string[], device_name: [] as string[] })
    setGridFilterModel(config.filterModel ?? {})
    setGridSortModel((config.sortModel && config.sortModel.length > 0) ? config.sortModel : [{ colId: 'favorite', sort: 'desc' }])
    setActiveViewId(viewId)
    collaborativeViews.setViewLink(viewId)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SERVICE_ACTIVE_VIEW_KEY, viewId)
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

  useEffect(() => {
    const requested = collaborativeViews.requestedViewId
    if (!requested || requested === activeViewId || !savedViews.some((view) => view.id === requested)) return
    applySavedView(requested)
  }, [activeViewId, collaborativeViews.requestedViewId, savedViews])

  const saveCurrentToView = async (viewId: string) => {
    const view = savedViews.find((entry) => entry.id === viewId)
    if (!view) return
    const result = await collaborativeViews.updateView(viewId, view.name, buildCurrentViewConfig())
    if (result.conflict) {
      showWorkspaceToast('This view changed on the server. Resolve the conflict in Saved views.', { type: 'error' })
      return
    }
    if (!result.view) {
      showWorkspaceToast(result.error || 'Unable to update this view', { type: 'error' })
      return
    }
    if (result.view) setActiveViewId(result.view.id)
    showWorkspaceToast(result.persisted ? `Saved ${view.name}` : `Saved ${view.name} locally; server unavailable`, { type: result.persisted ? 'success' : 'error' })
  }

  const createViewFromCurrent = async () => {
    const trimmed = newViewName.trim()
    if (!trimmed) {
      showWorkspaceToast('Enter a name for the new view', { type: 'error' })
      return
    }
    const result = await collaborativeViews.createView(trimmed, buildCurrentViewConfig())
    if (!result.view) {
      showWorkspaceToast(result.error || 'Unable to save this view', { type: 'error' })
      return
    }
    if (result.view) {
      setActiveViewId(result.view.id)
      collaborativeViews.setViewLink(result.view.id)
      setNewViewName('')
      if (typeof window !== 'undefined') window.localStorage.setItem(SERVICE_ACTIVE_VIEW_KEY, result.view.id)
    }
    showWorkspaceToast(result.persisted ? `Saved personal view ${trimmed}` : `Saved ${trimmed} locally; server unavailable`, { type: result.persisted ? 'success' : 'error' })
  }

  const applySystemDefault = async () => {
    if (!await allowViewSwitch(null)) return
    setActiveViewId(null)
    collaborativeViews.setViewLink(null)
    setTransientManualColumnWidths(false)
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(SERVICE_ACTIVE_VIEW_KEY)
    }
    setFontSize(11)
    setRowDensity(8)
    setHiddenColumns([])
    setGroupBy('raw')
    setShowFilterBar(true)
    setColumnLayoutState([])
    setSearchTerm('')
    setQuickFilters({ status: [] as string[], environment: [] as string[], service_type: [] as string[], device_name: [] as string[] })
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

  const renameView = async (viewId: string, name: string): Promise<boolean> => {
    const view = savedViews.find((entry: any) => entry.id === viewId)
    if (!view) return false
    const result = await collaborativeViews.updateView(viewId, name, view.config)
    if (result.conflict) {
      showWorkspaceToast('This view changed on the server. Resolve the conflict before renaming.', { type: 'error' })
      return false
    }
    if (!result.view || !result.persisted) {
      showWorkspaceToast(result.error || 'Unable to rename this view', { type: 'error' })
      return false
    }
    showWorkspaceToast(`Renamed view to ${name}`)
    return true
  }

  const deleteView = async (viewId: string) => {
    const view = savedViews.find((entry) => entry.id === viewId)
    if (!view) return
    const result = await collaborativeViews.deleteView(viewId)
    if (result.conflict) {
      showWorkspaceToast('This view changed on the server. Resolve the conflict before deleting.', { type: 'error' })
      return
    }
    if (result.error && !result.persisted) {
      showWorkspaceToast(result.error, { type: 'error' })
      return
    }
    if (activeViewId === viewId) {
      setActiveViewId(null)
      collaborativeViews.setViewLink(null)
      if (typeof window !== 'undefined') window.localStorage.removeItem(SERVICE_ACTIVE_VIEW_KEY)
    }
    showWorkspaceToast(result.persisted ? `Deleted ${view.name}` : `Removed local fallback ${view.name}`)
  }

  const dismissWorkspaceMenus = useCallback(() => {
    dismissOverlays()
    setBulkDeleteConfirm(false)
    setRowDeleteConfirmId(null)
  }, [dismissOverlays])

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
    hasRowActionMenu
  })

  // Removed manual menu position updates as they are now handled by useWorkspaceAnchoredLayer.

  const { data: allItems, isLoading, isError, error } = useQuery({
    queryKey: ['logical-services'],
    queryFn: async () => (await apiFetch('/api/v1/logical-services/?include_deleted=true')).json()
  })


  const detailRouteItems = useMemo(
    () => Array.isArray(allItems) ? allItems.map((item: any) => normalizeServiceRecord(item)) : undefined,
    [allItems]
  )

  const detailRoute = useOperationalDetailRoute({
    allItems: detailRouteItems,
    detailItem,
    setDetailItem,
    isEditOpen: isFormOpen,
    setActiveTab,
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
      .map((service: any) => normalizeServiceRecord(service))
      .filter((item: any) => activeTab === 'active' ? !item.is_deleted : item.is_deleted)
  }, [allItems, activeTab])

  useEffect(() => {
    if (gridRef.current?.api) {
      gridRef.current.api.refreshCells({ columns: ['favorite', 'watch'], force: true })
    }
  }, [favoriteIds, watchIds])

  const groupOptions = [
    { value: 'raw', label: 'Raw Rows' },
    { value: 'status', label: 'Status' },
    { value: 'environment', label: 'Environment' },
    { value: 'service_type', label: 'Type' },
    { value: 'device_name', label: 'Host' }
  ]

  const displayedItems = useMemo(() => {
    const filtered = items.filter((item: any) => {
      if (searchTerm.trim()) {
        const query = searchTerm.trim().toLowerCase()
        const haystack = [
          String(item.id || ''),
          item.name,
          item.service_type,
          item.device_name,
          item.environment,
          item.version,
          item.status,
          item.purchase_type,
          item.installation_date,
          item.manufacturer,
          item.supplier,
          item.purpose,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        
        if (!haystack.includes(query)) return false
      }
      if (quickFilters.status.length > 0 && !quickFilters.status.includes(item.status)) return false
      if (quickFilters.environment.length > 0 && !quickFilters.environment.includes(item.environment)) return false
      if (quickFilters.service_type.length > 0 && !quickFilters.service_type.includes(item.service_type)) return false
      if (quickFilters.device_name.length > 0 && !quickFilters.device_name.includes(item.device_name)) return false
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

  const selectionScopeKey = useMemo(() => {
    const visibleIds = displayedItemsInOrder.map((item: any) => item.id).join(',')
    return `${activeTab}:${groupBy}:${visibleIds}`
  }, [activeTab, displayedItemsInOrder, groupBy])

  const { handleSelectionChanged } = useOperationalGroupedSelection({
    setSelectedIds,
    selectionScopeKey,
  })

  const servicesDataState = useMemo(
    () => resolveOperationalDataState({
      loading: isLoading,
      error: isError ? error : null,
      totalCount: Array.isArray(allItems) ? allItems.length : 0,
      tabCount: items.length,
      visibleCount: displayedItemsInOrder.length,
      emptyLabel: 'No service data found',
      filteredLabel: 'No services match the current filters',
      tabEmptyKind: activeTab === 'deleted' ? 'deleted-empty' : 'active-empty',
      tabEmptyLabel: activeTab === 'deleted' ? 'No archived services found' : 'No active services found',
      errorTitle: 'Services data could not be loaded',
      errorDescription: 'The services registry request failed.',
    }),
    [activeTab, allItems, displayedItemsInOrder.length, error, isError, isLoading, items.length]
  )

  const activeServicesQueryError = isError ? error : null

  const servicesDiagnosticDetail = useMemo(() => buildOperationalDiagnosticDetail({
    endpoint: '/api/v1/logical-services/?include_deleted=true',
    error: activeServicesQueryError,
    fallbackMessage: 'The services registry request failed.',
  }), [activeServicesQueryError])

  useEffect(() => {
    if (!activeServicesQueryError) {
      setShowServicesDataDiagnostic(false)
    }
  }, [activeServicesQueryError])

  const shouldRenderRawGrid = groupBy === 'raw' || servicesDataState.kind !== 'ready'

  const { handleRowClicked, handleRowDoubleClicked } = useOperationalRowInteractions({
    onRowDoubleClick: (item: any) => detailRoute.openDetail(item, { replace: false }),
    pendingIds,
    selectionScopeKey,
  })

  useEffect(() => {
    if (!displayedItemsInOrder.length) return
    const timer = window.setTimeout(() => {
      autoSizeServiceColumns()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [autoSizeServiceColumns, displayedItemsInOrder, fontSize, hiddenColumns, isIntelligenceExpanded])

  const selectedItems = useMemo(
    () => displayedItems.filter((item: any) => selectedIds.includes(item.id)),
    [displayedItems, selectedIds]
  )

  const compareItems = useMemo(() => selectedItems.slice(0, 5), [selectedItems])

  const groupedSections = useMemo(() => {
    if (groupBy === 'raw') return []
    const sections = sortedItemsForGrouped.reduce((acc: Array<{ key: string; label: string; items: any[] }>, item: any) => {
      const label = String(getServiceGroupValue(item, groupBy))
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
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SERVICE_UI_STATE_KEY, JSON.stringify({
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
  }, [closeOverlay, selectedIds.length])

  useEffect(() => {
    if (typeof window === 'undefined') return
    ;(window as any).__DEBUG_SET_SERVICES_COLUMN_WIDTH__ = (colId: string, width: number) => {
      if (!gridRef.current?.api) return
      gridRef.current.api.applyColumnState({
        state: [{ colId, width }],
        applyOrder: false,
      })
      setTransientManualColumnWidths(true)
      syncColumnLayoutState(gridRef.current.api, true)
    }
    return () => {
      delete (window as any).__DEBUG_SET_SERVICES_COLUMN_WIDTH__
    }
  }, [setTransientManualColumnWidths, syncColumnLayoutState])

  useEffect(() => {
    return () => {
      if (typeof window === 'undefined') return
      const current = readServiceUiState() || {}
      window.localStorage.setItem(SERVICE_UI_STATE_KEY, JSON.stringify({
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

  const runUndo = async () => {
    const undo = lastUndoRef.current
    if (!undo) return
    if (undo.mode === 'bulk') {
      const res = await apiFetch('/api/v1/logical-services/bulk-action', {
        method: 'POST',
        body: JSON.stringify({
          ids: undo.ids,
          action: undo.action === 'restore' ? 'restore' : 'delete',
        })
      })
      if (!res.ok) throw new Error(await res.text())
    } else if (undo.mode === 'restore_snapshots') {
      for (const snapshot of undo.snapshots || []) {
        if (!snapshot?.id) continue
        const restorePayload: Record<string, any> = {}
        Object.keys(undo.payload || {}).forEach((key) => {
          restorePayload[key] = snapshot[key]
        })
        const res = await apiFetch(`/api/v1/logical-services/${snapshot.id}`, {
          method: 'PUT',
          body: JSON.stringify(restorePayload)
        })
        if (!res.ok) throw new Error(await res.text())
      }
    }
    lastUndoRef.current = null
    queryClient.invalidateQueries({ queryKey: ['logical-services'] })
  }

  const bulkPreviewMutation = useMutation({
    mutationFn: async ({ action, payload = {}, ids: overrideIds }: any) => {
      const idsToUse = overrideIds ?? selectedIds
      const res = await apiFetch('/api/v1/logical-services/bulk-action', {
        method: 'POST',
        body: JSON.stringify({ ids: idsToUse, action, payload, dry_run: true }),
      })
      if (!res.ok) throw new Error(await res.text())
      const preview = await res.json() as OperationalBulkPreview
      const fieldLabel = action === 'update' ? resolveBulkFieldLabel(payload, SERVICES_BULK_FIELD_LABELS) : undefined
      const actionLabel = action === 'delete'
        ? 'Archive selection'
        : action === 'restore'
          ? 'Restore selection'
          : `Apply ${fieldLabel || 'change'}`
      const nextValue = action === 'update'
        ? String(Object.values(payload).find((value) => value !== undefined) ?? '')
        : undefined
      return { action, payload, ids: idsToUse, actionLabel, fieldLabel, nextValue, preview }
    },
    onSuccess: (nextPreview) => {
      setBulkOperationPreview(nextPreview)
      closeOverlay('bulk')
    },
    onError: (error: any) => showOperationalBulkErrorToast(error.message),
  })

  const requestBulkPreview = (variables: { action: string; payload?: Record<string, any>; ids?: number[] }) => {
    bulkPreviewMutation.mutate(variables)
  }

  const bulkMutation = useMutation({
    onMutate: ({ action, ids: overrideIds }: any) => {
      const idsToUse = overrideIds ?? selectedIds
      setPendingIds(prev => [...new Set([...prev, ...idsToUse])])
    },
    onSettled: (data: any, error: any, variables: any) => {
      const idsToUse = variables.ids ?? selectedIds
      setPendingIds(prev => prev.filter(id => !idsToUse.includes(id)))
    },
    mutationFn: async ({ action, payload = {}, ids: overrideIds }: any) => {
      const idsToUse = overrideIds ?? selectedIds
      const previousSnapshots = (allItems || []).filter((item: any) => idsToUse.includes(item.id)).map((item: any) => ({ ...item }))
      let effectivePayload = payload
      let res
      if (action === 'update') {
        const directPayload = {
          ...(payload.status ? { status: payload.status } : {}),
          ...(payload.service_type ? { service_type: payload.service_type } : {}),
          ...(payload.environment ? { environment: payload.environment } : {}),
        }
        effectivePayload = directPayload
        res = await apiFetch('/api/v1/logical-services/bulk-action', {
          method: 'POST',
          body: JSON.stringify({ ids: idsToUse, action: 'update', payload: directPayload })
        })
      } else if (action === 'restore') {
        res = await apiFetch('/api/v1/logical-services/bulk-action', {
          method: 'POST',
          body: JSON.stringify({ ids: idsToUse, action: 'restore' })
        })
      } else {
        res = await apiFetch('/api/v1/logical-services/bulk-action', {
          method: 'POST',
          body: JSON.stringify({ ids: idsToUse, action: 'delete' })
        })
      }
      if (!res.ok) throw new Error(await res.text())
      const result = await res.json()
      return { result, action, payload: effectivePayload, idsToUse, previousSnapshots }
    },
    onSuccess: ({ result, action, payload, idsToUse, previousSnapshots }: any) => {
      queryClient.invalidateQueries({ queryKey: ['logical-services'] })
      closeOverlay('bulk')
      setExpandedBulkSection(null)
      setBulkDraft({ status: '', service_type: '', environment: '' })
      setSelectedIds([])
      setIsBulkStatusOpen(false)
      setIsBulkSeverityOpen(false)
      setIsBulkNotifyOpen(false)
      const totalSelected = idsToUse.length
      const parsedChangedCount = Number(result?.changed_count ?? result?.changed)
      const changedCount = Number.isFinite(parsedChangedCount)
        ? parsedChangedCount
        : action === 'update'
          ? countSemanticBulkChanges(previousSnapshots, payload)
          : action === 'delete'
            ? previousSnapshots.filter((snapshot: any) => !snapshot?.is_deleted).length
            : action === 'restore'
              ? previousSnapshots.filter((snapshot: any) => !!snapshot?.is_deleted).length
              : totalSelected
      const parsedUnchangedCount = Number(result?.unchanged_count)
      const unchangedCount = Number.isFinite(parsedUnchangedCount)
        ? parsedUnchangedCount
        : Math.max(0, totalSelected - changedCount)
      const fieldLabel = resolveBulkFieldLabel(payload, SERVICES_BULK_FIELD_LABELS)

      if (changedCount <= 0) lastUndoRef.current = null
      else if (action === 'delete') lastUndoRef.current = { mode: 'bulk', ids: idsToUse, action: 'restore' }
      else if (action === 'restore') lastUndoRef.current = { mode: 'bulk', ids: idsToUse, action: 'delete' }
      else if (action === 'update') lastUndoRef.current = { mode: 'restore_snapshots', snapshots: previousSnapshots, payload }
      else lastUndoRef.current = null

      const receiptRevert = lastUndoRef.current ? async () => {
        try {
          await runUndo()
          showOperationalBulkRevertedToast()
          setBulkOperationPreview(null)
        } catch (error: any) {
          showOperationalBulkRevertErrorToast(error.message || 'Bulk revert failed')
          throw error
        }
      } : undefined

      setBulkOperationPreview((current) => current ? {
        ...current,
        result: {
          selected_count: totalSelected,
          changed_count: changedCount,
          unchanged_count: unchangedCount,
          can_revert: Boolean(receiptRevert),
        },
        onRevert: receiptRevert,
      } : null)

      showOperationalBulkResultToast({
        action: action === 'delete' ? 'archive' : action,
        totalSelected,
        changedCount,
        unchangedCount,
        fieldLabel,
        onRevert: receiptRevert,
      })
    },
    onError: (e: any) => showOperationalBulkErrorToast(e.message)
  })

  const columnDefs = useMemo(() => {
    const columnConfigs: OperationalColumnConfig[] = [
      {
        kind: 'plain',
        field: 'device_name',
        headerName: 'Host',
        width: 180,
        hide: hiddenColumns.includes('device_name'),
      },
      {
        kind: 'identity',
        field: 'name',
        headerName: 'Name',
        width: 220,
        hide: hiddenColumns.includes('name'),
      },
      {
        kind: 'plain',
        field: 'service_type',
        headerName: 'Type',
        width: 140,
        hide: hiddenColumns.includes('service_type'),
      },
      {
        kind: 'plain',
        field: 'environment',
        headerName: 'Environment',
        width: 140,
        hide: hiddenColumns.includes('environment'),
      },
      {
        kind: 'plain',
        field: 'version',
        headerName: 'Version',
        width: 120,
        hide: hiddenColumns.includes('version'),
      },
      {
        kind: 'mappedBadge',
        field: 'status',
        headerName: 'Status',
        width: 120,
        fontSize,
        hide: hiddenColumns.includes('status'),
        knownValues: STATUSES.map((status) => status.label),
        colorMap: Object.fromEntries(STATUSES.map((status) => [status.label, status.color])),
      },
      {
        kind: 'prose',
        field: 'purpose',
        headerName: 'Purpose',
        width: 240,
        proseMode: 'compact',
        hide: hiddenColumns.includes('purpose'),
      },
      {
        kind: 'plain',
        field: 'manufacturer',
        headerName: 'Manufacturer',
        width: 160,
        hide: hiddenColumns.includes('manufacturer'),
      },
      {
        kind: 'plain',
        field: 'supplier',
        headerName: 'Supplier',
        width: 160,
        hide: hiddenColumns.includes('supplier'),
      },
      {
        kind: 'plain',
        field: 'purchase_type',
        headerName: 'License Type',
        width: 150,
        hide: hiddenColumns.includes('purchase_type'),
      },
      {
        kind: 'plain',
        field: 'cost',
        headerName: 'Cost',
        width: 120,
        formatValue: (value, params) => value != null ? `${params.data?.currency || 'USD'} ${value}` : 'N/A',
        hide: hiddenColumns.includes('cost'),
      },
      {
        kind: 'plain',
        field: 'secret_count',
        headerName: 'Secrets',
        width: 100,
        formatValue: (value) => String(value ?? 0),
        hide: hiddenColumns.includes('secret_count'),
      },
      {
        kind: 'date',
        field: 'installation_date',
        headerName: 'Deployed',
        width: 160,
        hide: hiddenColumns.includes('installation_date'),
      },
      {
        kind: 'date',
        field: 'created_at',
        headerName: 'Created',
        width: OPERATIONAL_GRID_WIDTHS.date,
        hide: hiddenColumns.includes('created_at'),
      },
      {
        kind: 'date',
        field: 'updated_at',
        headerName: 'Updated',
        width: OPERATIONAL_GRID_WIDTHS.date,
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
        onToggleFavorite: toggleFavorite,
        onToggleWatch: toggleWatch,
        itemLabel: 'service',
      },
      columnConfigs,
      columnLayoutState,
      preserveExplicitColumnWidths,
    })
  }, [
    columnLayoutState,
    fontSize,
    hiddenColumns,
    isIntelligenceExpanded,
    isRecentChange,
    preserveExplicitColumnWidths,
    renderPrimaryRowActions,
    toggleFavorite,
    toggleWatch,
  ]) as any

  const gridContext = useMemo(() => ({ favoriteIds, watchIds }), [favoriteIds, watchIds])
  const serviceGridRuntime = useMemo(() => ({
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
  const serviceRowInteractions = useMemo(() => ({
    handleRowClicked,
    handleRowDoubleClicked,
  }), [handleRowClicked, handleRowDoubleClicked])
  const serviceContextMenu = useMemo(() => ({
    handleCellContextMenu,
  }), [handleCellContextMenu])
  const rowMenuItem = rowActionMenu?.item ?? null

  return (
   <>{confirmation}<OperationalWorkspaceShell
      archetype="table"
      className="overflow-hidden"
      header={{
        eyebrow: "Services",
        title: (
          <div className="flex items-center gap-3">
            <Activity className="text-blue-500" />
            <span>Services</span>
          </div>
        ),
        subtitle: "Centralized logical service registry and operational ownership view",
        actions: (
          <>
            <HeaderScopeSwitch
              label="Service Scope"
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
            {activeServicesQueryError && (
              <>
                <DiagnosticStatusPill
                  status="error"
                  errorDetail={{ status: (activeServicesQueryError as any)?.status }}
                  onClick={() => setShowServicesDataDiagnostic(true)}
                />
                <DataDiagnosticModal
                  isOpen={showServicesDataDiagnostic}
                  onClose={() => setShowServicesDataDiagnostic(false)}
                  errorDetail={servicesDiagnosticDetail}
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
          placeholder="Search services, hosts, or metadata..."
        />
      )}
      toolbarControls={(
        <>
          <ToolbarGroup>
            <div className="views-menu-container">
              <ToolbarButton active={showViewsMenu} onClick={() => togglePanel('views')} ref={viewsMenuButtonRef as any}>
                <span className="flex items-center gap-2">
                  <LayoutGrid size={14} />
                  Views
                </span>
              </ToolbarButton>
            </div>
            <div className="display-menu-container">
              <ToolbarButton active={showDisplayMenu} onClick={() => togglePanel('display')} ref={displayMenuButtonRef as any}>
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
            <ToolbarButton onClick={() => setShowImportModal(true)} title="Import service rows">
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
            value={quickFilters.environment}
            onChange={(val) => setQuickFilters((current) => ({ ...current, environment: val }))}
            options={Array.from(new Set((items || []).map((item: any) => item.environment).filter(Boolean))).sort().map((value) => ({ value, label: value }))}
            label="Environment Filter"
            placeholder="All environments"
          />
          <AppDropdown
            multi
            value={quickFilters.service_type}
            onChange={(val) => setQuickFilters((current) => ({ ...current, service_type: val }))}
            options={Array.from(new Set((items || []).map((item: any) => item.service_type).filter(Boolean))).sort().map((value) => ({ value, label: value }))}
            label="Type Filter"
            placeholder="All types"
          />
          <AppDropdown
            multi
            value={quickFilters.device_name}
            onChange={(val) => setQuickFilters((current) => ({ ...current, device_name: val }))}
            options={Array.from(new Set((items || []).map((item: any) => item.device_name).filter(Boolean))).sort().map((value) => ({ value, label: value }))}
            label="Host Filter"
            placeholder="All hosts"
          />
        </div>
      ) : null}
      toolbarActions={(
        <>
          {SERVICE_SUPPORTS_COMPARE && (
            <ToolbarButton
              onClick={openCompare}
              disabled={selectedIds.length < 2 || selectedIds.length > 5}
              active={compareOpen}
              title="Compare selected services"
            >
              <span className="flex items-center gap-2">
                <GitCompare size={14} />
                Compare
              </span>
            </ToolbarButton>
          )}
          <ToolbarButton
            onClick={() => togglePanel('bulk')}
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
            + Add Service
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
                setQuickFilters({ status: [] as string[], environment: [] as string[], service_type: [] as string[], device_name: [] as string[] })
                gridRef.current?.api?.setFilterModel({})
              }
            }]
          : []),
      ]}
      floatingPanels={
        <>
          <OperationalDisplayPanel
            isOpen={showDisplayMenu}
            panelRef={displayMenuPanelRef}
            panelStyle={displayMenuStyle}
            onClose={dismissWorkspaceMenus}
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
            panelRef={viewsMenuPanelRef}
            panelStyle={viewsMenuStyle}
            entityLabel="Services"
            onClose={dismissWorkspaceMenus}
            activeViewId={activeViewId}
            currentViewName={activeViewId ? savedViews.find((view) => view.id === activeViewId)?.name || 'Unsaved working view' : 'Unsaved working view'}
            newViewName={newViewName}
            onNewViewNameChange={setNewViewName}
            onCreateView={createViewFromCurrent}
            onApplySystemDefault={applySystemDefault}
            savedViews={savedViews}
            defaultViewIds={DEFAULT_SERVICE_VIEW_IDS}
            onApplyView={applySavedView}
            onOverwriteView={saveCurrentToView}
            onRenameView={renameView}
            onDeleteView={deleteView}
            describeView={(view) => view.config?.groupBy && view.config.groupBy !== 'raw'
              ? `Grouped by ${groupOptions.find((option) => option.value === view.config.groupBy)?.label || view.config.groupBy}`
              : 'Raw service table'}
            syncStatus={collaborativeViews.status}
            syncMessage={collaborativeViews.lastError || (collaborativeViews.status === 'offline' ? 'Personal views are available locally and will migrate when the API returns.' : undefined)}
            onCopyViewLink={(viewId) => {
              void collaborativeViews.copyViewLink(viewId).then(() => showWorkspaceToast('View link copied'))
            }}
            conflictMessage={collaborativeViews.conflict?.message}
            onReloadConflict={collaborativeViews.reloadConflict}
            onSaveConflictCopy={() => { void collaborativeViews.saveConflictCopy() }}
          />

          <OperationalAnchoredPanel
            isOpen={showBulkMenu}
            panelRef={bulkMenuPanelRef}
            style={bulkMenuStyle}
            panelKey="bulk-menu"
            className="bulk-menu-container"
            yOffset={10}
          >
            <WorkspaceFloatingPanel kind="context" className="max-h-[560px] overflow-y-auto custom-scrollbar p-3">
              <div className="mb-3 rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
                <p className="text-[10px] font-semibold text-slate-400">Bulk actions</p>
                <p className="pt-1 text-[12px] font-semibold text-slate-100">{selectedIds.length} services selected</p>
              </div>

              {activeTab === 'deleted' ? (
                <div className="space-y-2">
                  <button
                    onClick={() => requestBulkPreview({ action: 'restore' })}
                    disabled={bulkMutation.isPending || bulkPreviewMutation.isPending}
                    className="w-full rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-left transition-all hover:bg-emerald-500/15 disabled:opacity-50"
                  >
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300">
                      {(bulkMutation.isPending || bulkPreviewMutation.isPending) ? <Activity size={10} className="inline animate-spin" /> : 'Restore Selection'}
                    </p>
                  </button>
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                    <p className="text-[10px] font-semibold text-amber-200">{SERVICES_PURGE_BLOCKED_REASON}</p>
                  </div>
                  <OperationalDisabledActionTooltip
                    disabled
                    reason={SERVICES_PURGE_BLOCKED_REASON}
                    className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
                  >
                    <button
                      disabled
                      className="w-full rounded-lg border border-rose-900/70 bg-rose-950/70 px-4 py-3 text-left transition-all disabled:opacity-50"
                    >
                      <p className="text-[10px] font-semibold text-rose-300">{OPERATIONAL_ACTION_LABELS.purge}</p>
                    </button>
                  </OperationalDisabledActionTooltip>
                </div>
              ) : (
                <div className="space-y-2">
                  <button
                    onClick={() => setShowBulkEditModal(true)}
                    className="w-full rounded-lg border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-left transition-all hover:bg-blue-500/15"
                  >
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-blue-300">Bulk Edit Table</p>
                    <p className="pt-1 text-[10px] font-semibold text-slate-400">Edit selected services row by row using safe columns only.</p>
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
                    active={expandedBulkSection === 'service_type'}
                    onClick={() => setExpandedBulkSection(expandedBulkSection === 'service_type' ? null : 'service_type')}
                  />
                  {expandedBulkSection === 'service_type' && (
                    <WorkspaceFlyoutDropdownEditor
                      value={bulkDraft.service_type}
                      onChange={(value) => setBulkDraft((current) => ({ ...current, service_type: value }))}
                      options={serviceTypeOptions}
                      placeholder="Choose type"
                      actionLabel="Apply Type"
                      onApply={() => requestBulkPreview({ action: 'update', payload: { service_type: bulkDraft.service_type } })}
                      disabled={!bulkDraft.service_type || bulkMutation.isPending}
                    />
                  )}

                  <WorkspaceFlyoutActionCard
                    title="Set Environment"
                    active={expandedBulkSection === 'environment'}
                    onClick={() => setExpandedBulkSection(expandedBulkSection === 'environment' ? null : 'environment')}
                  />
                  {expandedBulkSection === 'environment' && (
                    <WorkspaceFlyoutDropdownEditor
                      value={bulkDraft.environment}
                      onChange={(value) => setBulkDraft((current) => ({ ...current, environment: value }))}
                      options={environmentOptions}
                      placeholder="Choose environment"
                      actionLabel="Apply Environment"
                      onApply={() => requestBulkPreview({ action: 'update', payload: { environment: bulkDraft.environment } })}
                      disabled={!bulkDraft.environment || bulkMutation.isPending}
                    />
                  )}
                </div>
              )}

              {activeTab === 'active' && (
                <>
                  <div className="mx-1 my-3 h-px bg-slate-800" />
                  <button
                    onClick={() => {
                      if (!bulkDeleteConfirm) {
                        setBulkDeleteConfirm(true)
                        return
                      }
                      requestBulkPreview({ action: 'delete' })
                    }}
                    onMouseLeave={() => setBulkDeleteConfirm(false)}
                    disabled={bulkMutation.isPending || bulkPreviewMutation.isPending}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition-all ${
                      bulkDeleteConfirm
                        ? 'border-rose-500 bg-rose-600 animate-pulse'
                        : 'border-rose-900/70 bg-rose-950/70 hover:bg-rose-950'
                    } disabled:opacity-50`}
                  >
                    <p className={`text-[10px] font-semibold ${bulkDeleteConfirm ? 'text-white' : 'text-rose-300'}`}>
                      {(bulkMutation.isPending || bulkPreviewMutation.isPending) ? <Activity size={10} className="inline animate-spin" /> : (
                        bulkDeleteConfirm
                          ? OPERATIONAL_ACTION_LABELS.archiveSelectionConfirm
                          : OPERATIONAL_ACTION_LABELS.archiveSelection
                      )}
                    </p>
                  </button>
                </>
              )}
            </WorkspaceFloatingPanel>
          </OperationalAnchoredPanel>

          {hasRowActionMenu && rowActionMenu && (
            <OperationalRowActionMenu
              cursorX={rowActionMenu.point.x}
              cursorY={rowActionMenu.point.y}
              onClose={() => setRowActionMenu(null)}
              meta={`ID ${rowActionMenu.item.id} · ${rowActionMenu.item.service_type || 'Service'}`}
              title={rowActionMenu.item.name}
              sections={[
                {
                    id: 'quickAccess',
                    columns: 2 as 2,
                    items: [
                        { id: 'details', label: 'Details', icon: Maximize2, tone: 'info' as OperationalRowActionTone, onClick: () => { detailRoute.openDetail(rowActionMenu.item, { replace: false }); setRowActionMenu(null); } },
                        { id: 'edit', label: 'Edit', icon: Edit2, tone: 'success' as OperationalRowActionTone, onClick: () => { setEditingItem(rowActionMenu.item); setIsFormOpen(true); setRowActionMenu(null); } }
                    ]
                },
                {
                    id: 'followOptions',
                    columns: 2 as 2,
                    items: [
                        { id: 'watch', label: watchIds.includes(rowActionMenu.item.id) ? 'Unwatch' : 'Watch', icon: watchIds.includes(rowActionMenu.item.id) ? EyeOff : Eye, tone: 'neutral', onClick: () => { toggleWatch(rowActionMenu.item.id); } },
                        { id: 'favorite', label: favoriteIds.includes(rowActionMenu.item.id) ? 'Unpin' : 'Pin', icon: Star, tone: 'warning', onClick: () => { toggleFavorite(rowActionMenu.item.id); } }
                    ]
                },
                {
                    id: 'archive',
                    columns: 1 as 1,
                    items: [
                        ...(activeTab === 'deleted' ? [{ id: 'restore', label: 'Restore', icon: Undo2, tone: 'success' as OperationalRowActionTone, variant: 'inline' as OperationalRowActionVariant, onClick: () => { bulkMutation.mutate({ action: 'restore', ids: [rowActionMenu.item.id] }); setRowActionMenu(null); } }] : []),
                        ...(activeTab === 'deleted' ? [{
                            id: 'purge',
                            label: OPERATIONAL_ACTION_LABELS.purge,
                            icon: Trash2,
                            tone: 'danger' as OperationalRowActionTone,
                            variant: 'inline' as OperationalRowActionVariant,
                            disabled: true,
                            disabledReason: SERVICES_PURGE_BLOCKED_REASON,
                            onClick: () => {},
                        }] : []),
                        ...(activeTab === 'active' ? [{
                            id: 'archive',
                            label: rowDeleteConfirmId === rowActionMenu.item.id ? OPERATIONAL_ACTION_LABELS.archiveConfirm : OPERATIONAL_ACTION_LABELS.archive,
                            icon: Trash2,
                            tone: 'danger' as OperationalRowActionTone,
                            variant: 'inline' as OperationalRowActionVariant,
                            confirming: rowDeleteConfirmId === rowActionMenu.item.id,
                            onClick: () => {
                                if (rowDeleteConfirmId !== rowActionMenu.item.id) { setRowDeleteConfirmId(rowActionMenu.item.id); return }
                                bulkMutation.mutate({ action: 'delete', ids: [rowActionMenu.item.id] });
                                setRowActionMenu(null); setRowDeleteConfirmId(null);
                            }
                        }] : [])
                    ]
                }
              ]}
            />
          )}
        </>
      }
    >

      {shouldRenderRawGrid ? (
	        <OperationalDataGrid
            gridRef={gridRef}
            rows={displayedItemsInOrder || []}
            columnDefs={columnDefs}
            runtime={serviceGridRuntime}
            rowInteractions={serviceRowInteractions}
            contextMenu={serviceContextMenu}
            fontSize={fontSize}
            rowDensity={rowDensity}
            context={gridContext}
            selectionScopeKey={selectionScopeKey}
            getRowId={handleRowId}
            onSelectionChanged={(e) => handleSelectionChanged(e, 'raw')}
            getRowClass={getRowClass}
            onFirstDataRendered={handleGridDataUpdated}
            onRowDataUpdated={handleGridDataUpdated}
            dataState={servicesDataState}
            noRowsLabel={servicesDataState.noRowsLabel}
            loading={isLoading}
            loadingIcon={<RefreshCcw size={32} className="text-blue-400 animate-spin" />}
            loadingLabel={<p className="text-[10px] font-semibold text-blue-400">Scanning service registry...</p>}
          />
      ) : (
        <OperationalGroupedGridView
          summary={(
            <div>
              <p className="text-[10px] font-semibold text-slate-400">Grouped service registry</p>
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
          sections={(
            <>
          {groupedSections.map((section) => {
            const isCollapsed = collapsedGroups[section.key]
            const selectedCount = section.items.filter((item: any) => selectedIds.includes(item.id)).length
            return (
              <OperationalGroupedGridSection
                key={section.key}
                labelMeta={<span className="text-[9px] font-semibold text-blue-400">{groupOptions.find((option) => option.value === groupBy)?.label}</span>}
                label={section.label}
                count={section.items.length}
                countLabel="services"
                selectedCount={selectedCount}
                collapsed={isCollapsed}
                onToggle={() => setCollapsedGroups((current) => ({ ...current, [section.key]: !current[section.key] }))}
              >
                {!isCollapsed ? (
                  <OperationalDataGrid
                      rows={section.items}
                      columnDefs={columnDefs}
                      runtime={serviceGridRuntime}
                      rowInteractions={serviceRowInteractions}
                      contextMenu={serviceContextMenu}
                      fontSize={fontSize}
                      rowDensity={rowDensity}
                      context={gridContext}
                      selectionScopeKey={selectionScopeKey}
                      getRowId={handleRowId}
                      onSelectionChanged={(e) => handleSelectionChanged(e, section.key)}
                      getRowClass={getRowClass}
                      onFirstDataRendered={handleGridDataUpdated}
                      onRowDataUpdated={handleGridDataUpdated}
                      noRowsLabel="No service data found"
                      height={`${Math.min(600, section.items.length * (fontSize + rowDensity + 5) + 40)}px`}
                    />
                ) : null}
              </OperationalGroupedGridSection>
            )
          })}
            </>
          )}
        />
      )}

      <OperationalBulkPreviewModal
        isOpen={Boolean(bulkOperationPreview)}
        workspaceLabel="Services"
        actionLabel={bulkOperationPreview?.actionLabel || 'Apply change'}
        fieldLabel={bulkOperationPreview?.fieldLabel}
        nextValue={bulkOperationPreview?.nextValue}
        preview={bulkOperationPreview?.preview || null}
        result={bulkOperationPreview?.result || null}
        isExecuting={bulkMutation.isPending}
        isReverting={isBulkReverting}
        onClose={() => setBulkOperationPreview(null)}
        onRevert={bulkOperationPreview?.onRevert ? async () => {
          setIsBulkReverting(true)
          try {
            await bulkOperationPreview.onRevert?.()
          } finally {
            setIsBulkReverting(false)
          }
        } : undefined}
        onConfirm={() => {
          if (!bulkOperationPreview) return
          bulkMutation.mutate({
            action: bulkOperationPreview.action,
            payload: bulkOperationPreview.payload,
            ids: bulkOperationPreview.ids,
          })
        }}
      />

      <BulkActionModals
        isStatusOpen={isBulkStatusOpen}
        isSeverityOpen={isBulkSeverityOpen}
        isNotifyOpen={isBulkNotifyOpen}
        onClose={() => { setIsBulkStatusOpen(false); setIsBulkSeverityOpen(false); setIsBulkNotifyOpen(false); }}
        onApply={(action, val) => requestBulkPreview({ action: 'update', payload: { [action]: val } })}
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
          <ServiceRecordForm
            key={`service-form-${editingItem?.id || 'new'}`}
            item={editingItem}
            devices={devices}
            options={settingsOptions || []}
            onClose={() => {
              setIsFormOpen(false)
              detailRoute.finishTransition()
            }}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['logical-services'] })
              setIsFormOpen(false)
              detailRoute.finishTransition()
            }}
          />
        )}
        {detailItem && (
          <ServiceRecordDetailModal
            key={`service-detail-${detailItem.id}`}
            item={detailItem}
            onClose={() => { detailRoute.closeDetail(); setDetailDeleteConfirm(false); }}
            onEdit={(monitor: any) => {
              detailRoute.openEditFromDetail(monitor, () => {
                setEditingItem(monitor)
                setIsFormOpen(true)
                setDetailDeleteConfirm(false)
              })
            }}
            onDelete={(monitor: any) => {
              if (!detailDeleteConfirm) {
                setDetailDeleteConfirm(true)
                return
              }
              bulkMutation.mutate({ action: 'delete', ids: [monitor.id] })
              detailRoute.closeDetail()
            }}
            onOpenAsset={(deviceId: number) => navigate(`/asset?id=${deviceId}`)}
            deleteConfirm={detailDeleteConfirm}
            options={settingsOptions || []}
            devices={devices || []}
          />
        )}
        {compareOpen && <CompareServicesModal key={`services-compare-${compareItems.filter(Boolean).map((item) => item.id).join('-') || 'empty'}`} items={compareItems} onClose={() => setCompareOpen(false)} />}
        {showBulkEditModal && (
          <BulkEditTableModal
            key={`services-bulk-edit-${selectedItems.filter(Boolean).map((item) => item.id).join('-') || 'empty'}`}
            items={selectedItems}
            serviceTypeOptions={serviceTypeOptions}
            environmentOptions={environmentOptions}
            purchaseTypeOptions={purchaseTypeOptions}
            onClose={() => setShowBulkEditModal(false)}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['logical-services'] })
              setShowBulkEditModal(false)
            }}
          />
        )}
        <OperationalImportModal
          key="services-import-modal"
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          tableName="logical_services"
          displayName="Services"
        />
        <ConfigRegistryModal
            key="services-config-registry"
            isOpen={showRegistry}
            onClose={() => setShowRegistry(false)}
            title="Service Enumerations"
            sections={[
                { title: "Service Types", category: "ServiceType", icon: Layers },
                { title: "Environments", category: "Environment", icon: Globe },
                { title: "Statuses", category: "Status", icon: Bell },
            ]}
        />
      </AnimatePresence>
    </OperationalWorkspaceShell></>
  )
}

function CompareServicesModal({ items, onClose }: any) {
  useEscapeDismiss(onClose)
  useBodyModalFlag()
  const [isMaximized, setIsMaximized] = useState(false)

  const fields = useMemo(() => [
    { label: 'Status', getValue: (item: any) => item.status || 'Unknown' },
    { label: 'Host', getValue: (item: any) => item.device_name || 'Floating' },
    { label: 'Type', getValue: (item: any) => item.service_type || 'N/A' },
    { label: 'Environment', getValue: (item: any) => item.environment || 'N/A' },
    { label: 'Version', getValue: (item: any) => item.version || 'N/A' },
    { label: 'Manufacturer', getValue: (item: any) => item.manufacturer || 'N/A' },
    { label: 'Supplier', getValue: (item: any) => item.supplier || 'N/A' },
    { label: 'Vault Entries', getValue: (item: any) => String(item.secret_count ?? 0) },
    { label: 'Cost', getValue: (item: any) => item.cost != null ? `${item.currency || 'USD'} ${item.cost}` : 'N/A' },
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
      title="Compare Services"
      subtitle={`Temporal Variance Analysis · Comparing ${items.length} service records for semantic drift`}
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
                <h4 className="text-sm font-black text-white truncate mb-1">{getServiceTitle(item)}</h4>
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

function BulkActionModals({ isStatusOpen, isSeverityOpen, isNotifyOpen, onClose, onApply }: any) {
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
	            subtitle="Apply a service type change to selection."
	            icon={<Shield size={20} />}
            footerRight={
              <div className="flex items-center gap-3">
                <ToolbarButton onClick={onClose}>Cancel</ToolbarButton>
	                <ToolbarButton 
	                  disabled={!val} 
	                  onClick={() => onApply('service_type', val)} 
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
	                options={['Database', 'Application', 'OS', 'Middleware', 'API'].map((value) => ({ value, label: value }))}
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
	            title="Update Environment"
	            subtitle="Apply an environment change to selection."
	            icon={<Bell size={20} />}
            footerRight={
              <div className="flex items-center gap-3">
                <ToolbarButton onClick={onClose}>Cancel</ToolbarButton>
	                <ToolbarButton 
	                  disabled={!val} 
	                  onClick={() => onApply('environment', val)} 
	                  variant="primary"
	                >
	                  Apply Environment
	                </ToolbarButton>
              </div>
            }
          >
            <div className="p-2">
	              <AppDropdown
	                value={val}
	                onChange={v => setVal(v)}
	                options={['Production', 'Stage', 'Development', 'Lab'].map((value) => ({ value, label: value }))}
	                placeholder="Select Environment..."
	                label="Target Environment"
	              />
            </div>
          </WorkspaceModal>
        )
    }

    return null;
}

function BulkEditTableModal({ items, serviceTypeOptions, environmentOptions, purchaseTypeOptions, onClose, onSuccess }: any) {
  const [rows, setRows] = useState(() => items.map((item: any) => ({
    id: item.id,
    name: item.name || `Service ${item.id}`,
    status: item.status || '',
    service_type: item.service_type || '',
    environment: item.environment || '',
    device_name: item.device_name || '',
    purpose: item.purpose || '',
    cost: item.cost ?? '',
    currency: item.currency || 'USD',
    purchase_type: item.purchase_type || '',
    installation_date: item.installation_date ? String(item.installation_date).split('T')[0] : '',
  })))
  const [isMaximized, setIsMaximized] = useState(false)
  const initialDirtySnapshot = useMemo(() => JSON.stringify(rows), [])
  const isDirty = useMemo(() => JSON.stringify(rows) !== initialDirtySnapshot, [rows, initialDirtySnapshot])

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
          service_type: row.service_type || 'Database',
          environment: row.environment || 'Production',
          purpose: row.purpose || null,
          cost: row.cost === '' ? 0 : Number(row.cost),
          currency: row.currency || 'USD',
          purchase_type: row.purchase_type || 'One-time',
          installation_date: row.installation_date || null,
        }
        const res = await apiFetch(`/api/v1/logical-services/${row.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        })
        await res.json()
      }
    },
    onSuccess: () => {
      showWorkspaceToast(`Updated ${rows.length} service${rows.length === 1 ? '' : 's'}`)
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
      isDirty={isDirty}
      dirtyConfirmTitle="Discard Bulk Service Changes?"
      dirtyConfirmMessage="You have unsaved bulk service changes. Close this window and discard them?"
      title="Bulk Edit Services"
      subtitle="Safe table-based edits for selected services."
      icon={<Edit2 size={20} />}
      footerRight={
        <div className="flex items-center gap-3">
          <ToolbarButton 
            onClick={() => mutation.mutate()} 
            disabled={mutation.isPending} 
            variant="primary"
          >
            {mutation.isPending ? <Clock className="animate-spin" size={14} /> : <Check size={14} />}
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
                <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Service</th>
                <th className="min-w-[140px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Status</th>
                <th className="min-w-[160px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Type</th>
                <th className="min-w-[160px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Environment</th>
                <th className="min-w-[180px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Host</th>
                <th className="min-w-[220px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Purpose</th>
                <th className="min-w-[120px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Cost</th>
                <th className="min-w-[110px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Currency</th>
                <th className="min-w-[160px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">License Type</th>
                <th className="min-w-[220px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Deployed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((row: any) => (
                <tr key={row.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3 text-[10px] font-bold text-slate-200">{row.name}</td>
                  <td className="px-2 py-2"><AppDropdown value={row.status} onChange={(value) => updateRow(row.id, 'status', value)} options={STATUSES.filter((status) => status.value !== 'Deleted').map((status) => ({ value: status.value, label: status.label }))} placeholder="Status" /></td>
                  <td className="px-2 py-2"><AppDropdown value={row.service_type} onChange={(value) => updateRow(row.id, 'service_type', value)} options={mergeOptionsWithCurrentValue(serviceTypeOptions, row.service_type)} placeholder="Type" /></td>
                  <td className="px-2 py-2"><AppDropdown value={row.environment} onChange={(value) => updateRow(row.id, 'environment', value)} options={mergeOptionsWithCurrentValue(environmentOptions, row.environment)} placeholder="Environment" /></td>
                  <td className="px-4 py-3 text-[10px] font-bold text-slate-200">{row.device_name || 'Unassigned'}</td>
                  <td className="px-2 py-2"><input value={row.purpose} onChange={(event) => updateRow(row.id, 'purpose', event.target.value)} placeholder="Purpose" className={`${serviceInputClass()} h-[42px] px-3 py-2 text-[10px]`} /></td>
                  <td className="px-2 py-2"><input type="number" value={row.cost} onChange={(event) => updateRow(row.id, 'cost', event.target.value)} placeholder="Cost" className={`${serviceInputClass()} h-[42px] px-3 py-2 text-[10px] [appearance:textfield]`} /></td>
                  <td className="px-2 py-2"><AppDropdown value={row.currency} onChange={(value) => updateRow(row.id, 'currency', value)} options={SERVICE_CURRENCY_OPTIONS.map((value) => ({ value, label: value }))} placeholder="Currency" /></td>
                  <td className="px-2 py-2"><AppDropdown value={row.purchase_type} onChange={(value) => updateRow(row.id, 'purchase_type', value)} options={mergeOptionsWithCurrentValue(purchaseTypeOptions, row.purchase_type)} placeholder="License type" /></td>
                  <td className="px-2 py-2"><input type="date" value={row.installation_date} onChange={(event) => updateRow(row.id, 'installation_date', event.target.value)} placeholder="Deployment date" className={`${serviceInputClass()} h-[42px] px-3 py-2 text-[10px]`} /></td>
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

function ServiceRecordDetailModal({ item, onClose, onEdit, onDelete, onOpenAsset, deleteConfirm, options, devices }: any) {
  useBodyModalFlag()
  const [isMaximized, setIsMaximized] = useState(false)
  if (!item) return null
  const detailTitle = getServiceTitle(item)

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
      subtitle={`Service ID: ${item.id} · ${item.device_name || 'Floating host'}`}
      icon={<Database size={20} />}
      forensicLineage={{ createdAt: item.created_at, updatedAt: item.updated_at }}
      status={
        <div className="flex items-center gap-2">
          <StatusPill value={canonicalizeServiceStatus(item?.status)} />
          <StatusPill value={item.service_type || 'Service'} />
          <StatusPill value={item.environment || 'Production'} />
        </div>
      }
      footerRight={
        <>
          {item.is_deleted ? (
            <span className="max-w-[280px] text-[10px] font-semibold text-amber-200">
              {SERVICES_PURGE_BLOCKED_REASON}
            </span>
          ) : null}
          {item.device_id ? <ToolbarButton onClick={() => onOpenAsset?.(item.device_id)}>Open Host</ToolbarButton> : null}
          <ToolbarButton onClick={() => onEdit?.(item)}>Edit Service</ToolbarButton>
          {!item.is_deleted && (
            <ToolbarButton variant="danger" onClick={() => onDelete?.(item)} className={deleteConfirm ? 'animate-pulse bg-rose-600 border-rose-500 text-white shadow-lg shadow-rose-500/20' : ''}>
              {deleteConfirm ? 'Confirm Archive?' : 'Archive'}
            </ToolbarButton>
          )}
          {item.is_deleted && (
            <OperationalDisabledActionTooltip
              disabled
              reason={SERVICES_PURGE_BLOCKED_REASON}
              className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
            >
              <ToolbarButton variant="danger" disabled>
                {OPERATIONAL_ACTION_LABELS.purge}
              </ToolbarButton>
            </OperationalDisabledActionTooltip>
          )}
        </>
      }
    >
      <WorkspaceDossierShell body={<ServiceDetailsView service={item} options={options} devices={devices} />} />
    </WorkspaceModal>
  )
}

const serviceInputClass = (error?: string) => getWorkspaceInputClass(error)
function ServiceRecordForm({ item, devices, options, onClose, onSuccess }: any) {
  useBodyModalFlag()
  const queryClient = useQueryClient()
  const [isMaximized, setIsMaximized] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [backendFieldErrors, setBackendFieldErrors] = useState<Record<string, string>>({})
  const [backendGeneralError, setBackendGeneralError] = useState('')

  useEffect(() => {
    setBackendFieldErrors({})
    setBackendGeneralError('')
    setIsDirty(false)
  }, [item?.id])

  const mutation = useMutation({
    mutationFn: async (payload: any) => {
      const sanitized = sanitizeServicePayload(payload)
      const url = item?.id ? `/api/v1/logical-services/${item.id}` : '/api/v1/logical-services/'
      const method = item?.id ? 'PUT' : 'POST'
      const res = await apiFetch(url, { method, body: JSON.stringify(sanitized) })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['logical-services'] })
      setBackendFieldErrors({})
      setBackendGeneralError('')
      onSuccess?.()
    },
    onError: (e: any) => {
      const { fieldErrors, generalError } = parseOperationalApiValidationError(e)
      setBackendFieldErrors(fieldErrors)
      const message = generalError || e.message || 'Failed to save service record'
      setBackendGeneralError(message)
      showWorkspaceToast(message, { type: 'error' })
    },
  })
  const formTitle = item?.id ? getServiceTitle(item) : 'Create Service'

  return (
    <WorkspaceModal
      isOpen={true}
      onClose={onClose}
      size="workspace"
      isMaximized={isMaximized}
      onMaximizeToggle={() => setIsMaximized(!isMaximized)}
      isDirty={isDirty}
      dirtyConfirmTitle="Discard Service Changes?"
      dirtyConfirmMessage="You have unsaved service changes. Close this window and discard them?"
      title={
        <div className="flex items-center gap-3">
          <span>{item?.id ? 'Edit Service' : 'Create Service'}</span>
          {item?.id ? <WorkspaceShareHeader id={String(item.id)} title={formTitle} /> : null}
        </div>
      }
      subtitle={item?.id ? `Service ID ${item.id}` : 'Create a new logical service'}
      icon={<Database size={20} />}
      status={
        <div className="flex items-center gap-2">
          <StatusPill value={canonicalizeServiceStatus(item?.status)} />
          <StatusPill value={item?.service_type || 'Service'} />
          <StatusPill value={item?.environment || 'Production'} />
        </div>
      }
      footerRight={
        <ToolbarButton
          onClick={() => (document.getElementById('service-record-form') as HTMLFormElement | null)?.requestSubmit()}
          disabled={mutation.isPending}
          variant="primary"
          className="px-8 whitespace-nowrap inline-flex items-center"
        >
          {mutation.isPending ? <RefreshCcw className="animate-spin mr-2" size={14} /> : <Check className="mr-2" size={14} />}
          <span>{item?.id ? 'Save Service' : 'Add Service'}</span>
        </ToolbarButton>
      }
    >
      <WorkspaceDossierShell
        body={
          <ServiceForm
            formId="service-record-form"
            initialData={item || {}}
            onSave={(payload: any) => mutation.mutate(payload)}
            isPending={mutation.isPending}
            options={options}
            devices={devices}
            backendFieldErrors={backendFieldErrors}
            backendGeneralError={backendGeneralError}
            clearBackendFieldError={(field: string) => {
              setBackendFieldErrors((current) => {
                if (!current[field]) return current
                const next = { ...current }
                delete next[field]
                return next
              })
              setBackendGeneralError('')
            }}
            onDirtyChange={setIsDirty}
            renderActions={false}
          />
        }
      />
    </WorkspaceModal>
  )
}
