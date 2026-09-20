import { BkmListModal, BkmDetailModal, MonitoringForm } from './monitoring/Modals'
import DiagnosticStatusPill, { DataDiagnosticModal, buildOperationalDiagnosticDetail, classifyDataStatus, normalizeOperationalListResponse } from './shared/OperationalDataStatus'
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
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
  BookOpen, Eye, EyeOff, FileText, User, Users, Mail, MessageSquare, Monitor, MoreVertical,
  Download, Copy, ChevronDown, ChevronUp, Layers, RefreshCcw, Tag, Sliders, Clipboard, Lightbulb, Maximize2, Minimize2, Star, GitCompare, Undo2, List, LayoutGrid, Upload, Terminal, History as HistoryIcon, Edit2 as EditIcon
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { showWorkspaceRevertToast, showWorkspaceToast } from './shared/WorkspaceToast'
import { apiFetch } from '../api/apiClient'
import { buildMonitoringFormErrors, getMonitoringTabErrorCounts } from '../utils/monitoringValidation'
import {
  ALERT_DURATION_MAX,
  ALERT_DURATION_MIN,
  CHECK_INTERVAL_MAX,
  CHECK_INTERVAL_MIN,
  NOTIFICATION_THROTTLE_MAX,
  NOTIFICATION_THROTTLE_MIN,
} from '../domain/monitoringContract'
import { STATUSES, type MonitoringOwner, type OperatorRecord } from './monitoring/monitoringWorkspaceContract'
import { monitoringSupportsRestorePurged } from '../utils/monitoringPurgeRevertCapability'
import { formatAppDate, formatAppTime, formatAppDay, parseAppDate } from '../utils/dateUtils'
import { AppDropdown } from './shared/AppDropdown'
import { ConfigRegistryModal } from "./ConfigRegistry"
import { ConfirmationModal } from "./shared/ConfirmationModal"
import { MONITORING_WORKSPACE_STANDARD } from './shared/OperationalWorkspace'
import { WorkspaceModal } from './shared/WorkspaceModal'
import { WorkspaceShareHeader } from './shared/WorkspaceShareHeader'
import {
  WorkspaceCollapsibleHeader,
  WorkspaceEmptyState,
  WorkspaceFloatingPanel,
  WorkspaceInfoTooltip,
  WorkspaceSectionBadge,
  WorkspaceModalFooter,
  WorkspaceModalHeader,
  WorkspacePanelHint as PanelHint,
  WorkspacePanelSubtitle as PanelSubtitle,
  WorkspacePanelTitle as PanelTitle,
  WorkspaceSectionCard,
  WorkspaceSplitView,
  WorkspaceValidationBanner,
  getWorkspaceModalFrameClass,
  getWorkspaceModalShellClass,
  getWorkspaceInputClass,
  useWorkspaceAnchoredLayer,
  useEscapeDismiss,
  useBodyModalFlag,
} from './shared/OperationalWorkspacePrimitives'
import {
  useOperationalRowInteractions,
  useOperationalContextMenu,
  useOperationalDismissController,
  useOperationalGroupedSelection,
} from './shared/OperationalGridInteractions'
import { WorkspaceFlyoutActionCard, WorkspaceFlyoutDropdownEditor } from './shared/WorkspaceFlyout'
import { StatusPill } from './shared/StatusPill'
import { parseCommaSeparatedValues } from '../utils/dataParsers'
import { HeaderScopeSwitch, ToolbarButton, ToolbarGroup, ToolbarIconButton, ToolbarSearch } from './shared/LayoutPrimitives'
import {
  OPERATIONAL_GRID_LAYOUT_POLICIES,
  useOperationalGridRuntime,
  useOperationalWorkspaceController,
  usePersistentJsonState,
  useWorkspaceOverlayController,
  useWorkspaceSessionValue,
  useOperationalDetailRoute,
  useOperationalSelection,
} from './shared/OperationalWorkspaceHooks'
import { WorkspaceCompareShell, WorkspaceDossierShell, WorkspaceHistoryShell } from './shared/WorkspaceModalShells'
import { OperationalImportModal } from './shared/OperationalImportModal'
import { OperationalDataGrid } from './shared/OperationalDataGrid'
import { resolveOperationalDataState } from './shared/OperationalDataState'
import { OPERATIONAL_ACTION_LABELS } from './shared/OperationalActionLabels'
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
  OperationalWorkspaceShell
} from './shared/OperationalWorkspaceShells'
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
import { buildOperationalLifecycleToastMessage } from './shared/OperationalLifecycleToasts'
import { useCollaborativeWorkspaceViews } from './shared/CollaborativeWorkspaceViews'
import { ModulePolicyButton, useModuleActionPolicy } from '../policy/ModulePolicy'

const MONITORING_VIEW_STORAGE_KEY = 'sysgrid_monitoring_views_v1'
const MONITORING_ACTIVE_VIEW_KEY = 'sysgrid_monitoring_active_view_v1'
const MONITORING_FAVORITES_STORAGE_KEY = 'sysgrid_monitoring_favorites_v1'
const MONITORING_UI_STATE_KEY = 'sysgrid_monitoring_ui_state_v1'
const MONITORING_WATCH_STORAGE_KEY = 'sysgrid_monitoring_watch_v1'
const MONITORING_WORKSPACE_PREFERENCE_KEY = 'monitoring_workspace_state_v2'
const MONITORING_WORKSPACE_PREFERENCE_VERSION = 2
const MONITORING_COLLABORATIVE_VIEW_MIGRATION_KEY = 'sysgrid_monitoring_collaborative_views_v1_migrated'
const MONITORING_DETAIL_CACHE_KEY = 'sysgrid_monitoring_detail_cache_v1'
const BULK_MENU_MAX_HEIGHT = 560
const MONITORING_BULK_FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  severity: 'Severity',
  notification_method: 'Notification Method',
}

const MONITORING_STATUS_COLORS: Record<string, string> = Object.fromEntries(
  STATUSES.map((status) => [status.label, status.color])
)


const MONITORING_SEVERITIES = [
  { value: 'Critical', label: 'Critical', color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
  { value: 'Warning', label: 'Warning', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  { value: 'Info', label: 'Info', color: 'bg-sky-500/20 text-sky-400 border-sky-500/30' }
]

const MONITORING_SEVERITY_COLORS: Record<string, string> = Object.fromEntries(
  MONITORING_SEVERITIES.map((severity) => [severity.label, severity.color])
)

const MONITORING_OWNER_ROLES = [
  { value: 'Primary Support', label: 'Primary Support' },
  { value: 'Escalation', label: 'Escalation' },
  { value: 'Observer', label: 'Observer' }
]

const MONITORING_CATEGORY_COLORS: Record<string, string> = {
  Hardware: 'text-amber-500',
  Network: 'text-blue-500',
  OS: 'text-purple-500',
  Application: 'text-emerald-500',
  Database: 'text-rose-500',
}

const MONITORING_REQUIRED_FIELD_NAMES = new Set(['title', 'category', 'status', 'severity'])

const DEFAULT_MONITORING_VIEWS = []
const DEFAULT_MONITORING_VIEW_IDS = new Set(DEFAULT_MONITORING_VIEWS.map((view) => view.id))
const MONITORING_SUPPORTS_COMPARE = MONITORING_WORKSPACE_STANDARD.sharedCapabilities.includes('compare')
const MONITORING_VALID_GROUP_BY = new Set(['raw', 'category', 'platform', 'status', 'severity', 'notification_method'])
const MONITORING_PERSISTED_COLUMN_IDS = new Set([
  'select',
  'id',
  'recent_change',
  'favorite',
  'watch',
  'device_name',
  'title',
  'status',
  'owners',
  'category',
  'is_active',
  'monitored_service_names',
  'platform',
  'severity',
  'check_interval',
  'notification_method',
  'purpose',
  'created_at',
  'updated_at',
  'row_actions',
])

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
  severity: Array.isArray(value?.severity) ? value.severity.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [],
  platform: Array.isArray(value?.platform) ? value.platform.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [],
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
  return {
    fontSize: Number.isFinite(safeConfig.fontSize) ? safeConfig.fontSize : 11,
    rowDensity: Number.isFinite(safeConfig.rowDensity) ? safeConfig.rowDensity : 8,
    hiddenColumns: Array.isArray(safeConfig.hiddenColumns)
      ? safeConfig.hiddenColumns.filter((entry: any) => typeof entry === 'string' && MONITORING_PERSISTED_COLUMN_IDS.has(entry))
      : [],
    groupBy: typeof safeConfig.groupBy === 'string' && MONITORING_VALID_GROUP_BY.has(safeConfig.groupBy) ? safeConfig.groupBy : 'raw',
    showFilterBar: safeConfig.showFilterBar !== false,
    columnLayoutState: sanitizeOperationalColumnLayout(
      Array.isArray(safeConfig.columnLayoutState) ? safeConfig.columnLayoutState : [],
      MONITORING_PERSISTED_COLUMN_IDS,
      true
    ),
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
      columnLayoutState: sanitizeOperationalColumnLayout(Array.isArray(uiState.columnLayoutState) ? uiState.columnLayoutState : [], MONITORING_PERSISTED_COLUMN_IDS, false),
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

  // Removed stale positioning helpers.

const getMonitorGroupValue = (item: any, field: string) => {
  if (field === 'notification_method') return item.notification_method || 'No notification path'
  return item[field] || 'Unspecified'
}

const readMonitoringUiState = () => {
  return readMonitoringWorkspaceStateFromLocalStorage()?.uiState ?? null
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
                <p className="text-[9px] font-bold text-slate-500 uppercase">Live Infrastructure Monitoring</p>
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

export default function MonitoringGrid() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const knowledgeAction = useModuleActionPolicy('knowledge')
  const gridRef = React.useRef<any>(null)
  const [showMonitoringDataDiagnostic, setShowMonitoringDataDiagnostic] = useState(false)
  const { data: userSettings, isSuccess: hasUserSettings } = useQuery({
    queryKey: ['user-settings'],
    queryFn: async () => (await (await apiFetch('/api/v1/settings/user/settings')).json()),
  })
  const remoteWorkspaceState = useMemo(
    () => normalizeMonitoringWorkspaceState(userSettings?.[MONITORING_WORKSPACE_PREFERENCE_KEY]),
    [userSettings]
  )
  const initialWorkspaceState = remoteWorkspaceState ?? readMonitoringWorkspaceStateFromLocalStorage()
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
  const [recipientPopup, setRecipientPopup] = useState<{ recipients: string[], method: string } | null>(null)
  const [bkmPopup, setBkmPopup] = useState<{ docs: number[], ids: number[], titles: string[], monitorId?: number } | null>(null)
  const [activeBkm, setActiveBkm] = useState<any>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [showBulkEditModal, setShowBulkEditModal] = useState(false)
  const [isFormDirty, setIsFormDirty] = useState(false)
  const [isBulkEditDirty, setIsBulkEditDirty] = useState(false)
  const [isConfigDirty, setIsConfigDirty] = useState(false)
  
  const {
    selectedIds,
    setSelectedIds,
    clearSelection,
    isSelected,
    hasSelection,
    selectedCount,
  } = useOperationalSelection([])
  const [expandedBulkSection, setExpandedBulkSection] = useState<'status' | 'severity' | 'notification' | null>(null)
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
  const {
    filterModel: gridFilterModel,
    setFilterModel: setGridFilterModel,
    quickFilters,
    setQuickFilters,
  } = useOperationalWorkspaceController({
    initialFilterModel: {},
    initialQuickFilters: persistedUiState?.quickFilters ?? { status: [] as string[], severity: [] as string[], platform: [] as string[], owner: [] as string[] },
  })
  const [gridSortModel, setGridSortModel] = useState<any[]>([{ colId: 'favorite', sort: 'desc' }])
  const [savedViews, setSavedViews] = usePersistentJsonState<any[]>(MONITORING_VIEW_STORAGE_KEY, () => {
    return readMonitoringWorkspaceStateFromLocalStorage()?.savedViews ?? normalizeMonitoringSavedViews([])
  })
  const [activeViewId, setActiveViewId] = useWorkspaceSessionValue<string | null>(
    'sysgrid_monitoring_session_init',
    null,
    () => initialWorkspaceState?.activeViewId ?? (typeof window === 'undefined' ? null : window.localStorage.getItem(MONITORING_ACTIVE_VIEW_KEY))
  )
  const [favoriteIds, setFavoriteIds] = usePersistentJsonState<number[]>(MONITORING_FAVORITES_STORAGE_KEY, initialWorkspaceState?.favoriteIds ?? [])
  const [watchIds, setWatchIds] = usePersistentJsonState<number[]>(MONITORING_WATCH_STORAGE_KEY, initialWorkspaceState?.watchIds ?? [])
  const [searchTerm, setSearchTerm] = useState(persistedUiState?.searchTerm ?? '')
  const [groupBy, setGroupBy] = useState<string>(persistedUiState?.groupBy ?? 'raw')
  const [bulkDraft, setBulkDraft] = useState({ status: '', severity: '', notification_method: '' })
  const [lastVisitedAt] = useState<number>(() => persistedUiState?.lastVisitedAt ?? 0)
  const [pendingIds, setPendingIds] = useState<number[]>([])

  const { data: allItems, isLoading, isError, error } = useQuery({
    queryKey: ['monitoring-items'],
    queryFn: async () => (await apiFetch('/api/v1/monitoring?include_deleted=true')).json()
  })

  const fetchMonitoringDetail = useCallback(async (id: string) => {
    const response = await apiFetch('/api/v1/monitoring?include_deleted=true')
    const items = await response.json()
    return Array.isArray(items) ? items.find((item: any) => String(item.id) === id) : null
  }, [])

  useEffect(() => {
    if (isError) {
        const err = error as any;
        (window as any).__SYSGRID_DATA_DIAGNOSTICS__ = {
            ...((window as any).__SYSGRID_DATA_DIAGNOSTICS__ || {}),
            monitoring: {
                classification: 'http_error',
                status: err.status,
                endpoint: '/api/v1/monitoring?include_deleted=true',
                rawBodyExcerpt: err.rawBody,
                userId: localStorage.getItem('SYSGRID_USER_ID') || 'admin_root',
                tenantId: localStorage.getItem('SYSGRID_TENANT_ID') || '1'
            }
        };
    }
  }, [isError, error]);


  const detailRoute = useOperationalDetailRoute({
    allItems,
    detailItem,
    setDetailItem,
    isEditOpen: isFormOpen,
    isHistoryOpen: !!historyItem,
    isLinkOpen: false,
    setActiveTab,
    fetchDetailItem: fetchMonitoringDetail,
  })

  // allItems query and detailRoute hook moved to top of component to be in scope for callbacks
  const { triggerRef: displayMenuButtonRef, panelRef: displayMenuPanelRef, panelStyle: displayMenuStyle } = useWorkspaceAnchoredLayer(showDisplayMenu, { minWidth: 320 })
  const { triggerRef: viewsMenuButtonRef, panelRef: viewsMenuPanelRef, panelStyle: viewsMenuStyle } = useWorkspaceAnchoredLayer(showViewsMenu, { minWidth: 420 })
  const { triggerRef: bulkMenuButtonRef, panelRef: bulkMenuPanelRef, panelStyle: bulkMenuStyle } = useWorkspaceAnchoredLayer(showBulkMenu, { minWidth: 340 })
  const lastUndoRef = useRef<any>(null)
  const purgeRestoreCapabilityRef = useRef<{ supported: boolean; reason: string } | null>(null)
  const [newViewName, setNewViewName] = useState('')

  const isWorkspaceDirty = useMemo(() => {
    return isFormDirty || isBulkEditDirty || isConfigDirty || (showViewsMenu && newViewName.trim() !== '')
  }, [isFormDirty, isBulkEditDirty, isConfigDirty, showViewsMenu, newViewName])



  useEffect(() => {
    if (!isWorkspaceDirty) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isWorkspaceDirty])

  useEffect(() => {
    if (!isFormOpen) setIsFormDirty(false)
  }, [isFormOpen])

  useEffect(() => {
    if (!showBulkEditModal) setIsBulkEditDirty(false)
  }, [showBulkEditModal])

  useEffect(() => {
    if (!showRegistry) setIsConfigDirty(false)
  }, [showRegistry])
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const autoSizeFrameRef = useRef<number | null>(null)
  const autoSizeTimeoutRef = useRef<number | null>(null)
  const monitoringPreferenceHydratedRef = useRef(false)
  const monitoringPreferenceMigratedRef = useRef(false)
  const monitoringPreferenceSyncRef = useRef<string | null>(null)
  const monitoringPreferenceSyncTimeoutRef = useRef<number | null>(null)
  const preserveExplicitColumnWidthsRef = useRef(false)
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

  const {
    columnLayoutState,
    setColumnLayoutState,
    setTransientManualColumnWidths,
    preserveExplicitColumnWidths,
    syncColumnLayoutState,
    applyColumnLayoutState,
    handleColumnResized: handleMonitoringColumnResized,
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
        ;(window as any).__DEBUG_MONITORING_GRID_API__ = event.api
      }
    },
  })

  useEffect(() => {
    preserveExplicitColumnWidthsRef.current = preserveExplicitColumnWidths
  }, [preserveExplicitColumnWidths])

  const buildMonitoringWorkspacePreferencePayload = useCallback(() => normalizeMonitoringWorkspaceState({
    version: MONITORING_WORKSPACE_PREFERENCE_VERSION,
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
    if (remoteWorkspaceState && !monitoringPreferenceHydratedRef.current) {
      monitoringPreferenceHydratedRef.current = true
      const payload = normalizeMonitoringWorkspaceState(remoteWorkspaceState)
      const serialized = JSON.stringify(payload)
      monitoringPreferenceSyncRef.current = serialized
      setActiveViewId(payload?.activeViewId ?? null)
      setFavoriteIds(payload?.favoriteIds ?? [])
      setWatchIds(payload?.watchIds ?? [])
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
    hasUserSettings,
    remoteWorkspaceState,
    setActiveViewId,
    setColumnLayoutState,
    setFavoriteIds,
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

  const handleRowId = useCallback((params: any) => String(params.data.id), [])

  const { handleCellContextMenu, openRowActionMenuAtPoint } = useOperationalContextMenu({
    onOpenRowActionMenu: useCallback((item, point) => {
      setRowActionMenu({ item, point })
      openOverlay('rowAction')
    }, [openOverlay])
  })

  const autoSizeMonitoringColumns = useCallback(() => {
    if (!gridRef.current?.api || preserveExplicitColumnWidthsRef.current) return
    clearPendingAutoSize()
    const run = () => {
      if (!gridRef.current?.api || preserveExplicitColumnWidthsRef.current) return
      autoSizeOperationalColumns({
        api: gridRef.current.api,
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

  const monitoringGridRuntime = useMemo(() => ({
    preserveExplicitColumnWidths,
    handleGridReady,
    handleColumnResized: handleMonitoringColumnResized,
    handleColumnMoved,
    handleDragStopped,
    handleColumnPinned,
    handleColumnVisible,
    handleFilterChanged,
    handleSortChanged,
  }), [
    preserveExplicitColumnWidths,
    handleGridReady,
    handleMonitoringColumnResized,
    handleColumnMoved,
    handleDragStopped,
    handleColumnPinned,
    handleColumnVisible,
    handleFilterChanged,
    handleSortChanged,
  ])

  const getRowClass = useCallback((params: any) => {
    let classes = params.node.rowIndex % 2 === 0 ? 'operational-grid-row-even' : 'operational-grid-row-odd'
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

  const categories = useMemo(() => Array.isArray(settingsOptions) ? settingsOptions.filter((o:any) => o.category === "MonitoringCategory") : [], [settingsOptions])
  const platforms = useMemo(() => Array.isArray(settingsOptions) ? settingsOptions.filter((o:any) => o.category === "MonitoringPlatform") : [], [settingsOptions])
  const notificationMethods = useMemo(() => Array.isArray(settingsOptions) ? settingsOptions.filter((o:any) => o.category === "NotificationMethod") : [], [settingsOptions])
  const severities = MONITORING_SEVERITIES
  const ownerRoles = MONITORING_OWNER_ROLES

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
    setFavoriteIds((current) => current.includes(id) ? current.filter((i) => i !== id) : [...current, id])
  }, [])

  const toggleWatch = useCallback((monitorId: number) => {
    const id = Number(monitorId)
    setWatchIds((current) => current.includes(id) ? current.filter((i) => i !== id) : [...current, id])
  }, [])

  const openCompare = () => {
    if (selectedCount < 2 || selectedCount > 5) return
    setCompareOpen(true)
  }

  const monitoringContextMenu = useMemo(() => ({
    handleCellContextMenu,
  }), [handleCellContextMenu])

  const openRecoveryDocuments = useCallback((item: any) => {
    const recoveryDocs = item.recovery_docs || []
    setBkmPopup({
      docs: recoveryDocs,
      ids: recoveryDocs,
      titles: item.recovery_doc_titles || [],
      monitorId: item.id
    })
  }, [])

  const renderPrimaryRowActions = useCallback((item: any) => {
    const isPending = pendingIds.includes(item.id)
    return (
      <div className={isPending ? 'opacity-20 grayscale pointer-events-none' : ''}>
        {renderOperationalActionButtons(
          <>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            detailRoute.openDetail(item)
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
          onClick={(event) => {
            event.stopPropagation()
            setHistoryItem(item)
          }}
          title="View history"
          className="rounded-lg p-1 text-amber-400 transition-all hover:bg-amber-400/10 active:scale-90"
        >
          <Clock size={13} />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            openRecoveryDocuments(item)
          }}
          title="Knowledge documents"
          className="rounded-lg p-1 text-purple-400 transition-all hover:bg-purple-400/10 active:scale-90"
        >
          <BookOpen size={13} />
        </button>
        <button
          type="button"
          onClick={(event: any) => openRowActionMenu(event, item)}
          title="More actions"
          className="row-action-trigger row-action-menu-container rounded-lg p-1 text-slate-400 transition-all hover:bg-slate-400/10 hover:text-white active:scale-90"
        >
          <MoreVertical size={13} />
        </button>
          </>
        )}
      </div>
    )
  }, [openRecoveryDocuments, pendingIds])

  const handleExportCSV = () => {
    if (gridRef.current?.api) {
      gridRef.current.api.exportDataAsCsv({
        fileName: `SysGrid_Monitoring_${new Date().toISOString().split('T')[0]}.csv`,
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

  const setCollaborativeActiveViewId = useCallback((id: string | null) => {
    setActiveViewId(id)
    if (typeof window !== 'undefined') {
      if (id) window.localStorage.setItem(MONITORING_ACTIVE_VIEW_KEY, id)
      else window.localStorage.removeItem(MONITORING_ACTIVE_VIEW_KEY)
    }
  }, [])

  const collaborativeViews = useCollaborativeWorkspaceViews({
    workspaceKey: 'monitoring',
    migrationKey: MONITORING_COLLABORATIVE_VIEW_MIGRATION_KEY,
    systemViewIds: DEFAULT_MONITORING_VIEW_IDS,
    currentViews: savedViews,
    setCurrentViews: setSavedViews,
    normalizeViews: normalizeMonitoringSavedViews,
    sanitizeDefinition: sanitizeMonitoringViewConfig,
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

  const allowViewSwitch = (nextViewId: string | null) => {
    if (!collaborativeViews.dirty || nextViewId === activeViewId) return true
    return window.confirm('This workspace has unsaved view changes. Discard them and switch views?')
  }

  const applySavedView = (viewId: string) => {
    if (!allowViewSwitch(viewId)) return
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
    setQuickFilters(config.quickFilters ?? { status: [] as string[], severity: [] as string[], platform: [] as string[], owner: [] as string[] })
    setGridFilterModel(config.filterModel ?? {})
    setGridSortModel((config.sortModel && config.sortModel.length > 0) ? config.sortModel : [{ colId: 'favorite', sort: 'desc' }])
    setActiveViewId(viewId)
    collaborativeViews.setViewLink(viewId)
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
      if (typeof window !== 'undefined') window.localStorage.setItem(MONITORING_ACTIVE_VIEW_KEY, result.view.id)
    }
    showWorkspaceToast(result.persisted ? `Saved personal view ${trimmed}` : `Saved ${trimmed} locally; server unavailable`, { type: result.persisted ? 'success' : 'error' })
  }

  const applySystemDefault = () => {
    if (!allowViewSwitch(null)) return
    setActiveViewId(null)
    collaborativeViews.setViewLink(null)
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
    setQuickFilters({ status: [] as string[], severity: [] as string[], platform: [] as string[], owner: [] as string[] })
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
      if (typeof window !== 'undefined') window.localStorage.removeItem(MONITORING_ACTIVE_VIEW_KEY)
    }
    showWorkspaceToast(result.persisted ? `Deleted ${view.name}` : `Removed local fallback ${view.name}`)
  }

  const dismissWorkspaceMenus = useCallback(() => {
    dismissOverlays()
    setExpandedBulkSection(null)
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
       try {
         window.sessionStorage.setItem(MONITORING_DETAIL_CACHE_KEY, JSON.stringify(allItems))
         window.localStorage.setItem(MONITORING_DETAIL_CACHE_KEY, JSON.stringify(allItems))
       } catch {
         // Session storage is an optimization for deep-link recovery only.
       }
    }
  }, [allItems])

  const items = useMemo(() => {
    if (!allItems || !Array.isArray(allItems)) return []
    return allItems.filter((i: any) => activeTab === 'active' ? !i.is_deleted : i.is_deleted)
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
    { value: 'category', label: 'Category' },
    { value: 'platform', label: 'Platform' },
    { value: 'status', label: 'Status' },
    { value: 'severity', label: 'Severity' },
    { value: 'notification_method', label: 'Notification Path' }
  ]

  const displayedItems = useMemo(() => {
    const filtered = items.filter((item: any) => {
      if (searchTerm.trim()) {
        const query = searchTerm.trim().toLowerCase()
        const haystack = [
          String(item.id || ''),
          item.device_name,
          item.category,
          item.status,
          item.severity,
          item.title,
          item.platform,
          item.notification_method,
          item.purpose,
          ...(item.owners || []).map((owner: any) => owner.name)
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        
        if (!haystack.includes(query)) return false
      }
      if (quickFilters.status.length > 0 && !quickFilters.status.includes(item.status)) return false
      if (quickFilters.severity.length > 0 && !quickFilters.severity.includes(item.severity)) return false
      if (quickFilters.platform.length > 0 && !quickFilters.platform.includes(item.platform)) return false
      if (quickFilters.owner.length > 0 && !quickFilters.owner.some(o => (item.owners || []).some((owner: any) => owner.name === o))) return false
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

  const monitoringDataState = useMemo(
    () => resolveOperationalDataState({
      loading: isLoading,
      error: isError ? error : null,
      totalCount: Array.isArray(allItems) ? allItems.length : 0,
      tabCount: items.length,
      visibleCount: displayedItemsInOrder.length,
      emptyLabel: 'No monitoring data found',
      filteredLabel: 'No monitoring results match the current filters',
      tabEmptyKind: activeTab === 'deleted' ? 'deleted-empty' : 'active-empty',
      tabEmptyLabel: activeTab === 'deleted' ? 'No archived monitoring items found' : 'No active monitoring items found',
      errorTitle: 'Monitoring data could not be loaded',
      errorDescription: 'The monitoring registry request failed.',
    }),
    [activeTab, allItems, displayedItemsInOrder.length, error, isError, isLoading, items.length]
  )

  const shouldRenderRawGrid = groupBy === 'raw' || monitoringDataState.kind !== 'ready'

  const { handleRowClicked, handleRowDoubleClicked } = useOperationalRowInteractions({
    onRowDoubleClick: useCallback((item) => {
      detailRoute.openDetail(item)
    }, [detailRoute]),
    pendingIds,
    selectionScopeKey,
  })

  const monitoringRowInteractions = useMemo(() => ({
    handleRowClicked,
    handleRowDoubleClicked,
  }), [handleRowClicked, handleRowDoubleClicked])

  useEffect(() => {
    if (!displayedItemsInOrder.length) return
    const timer = window.setTimeout(() => {
      autoSizeMonitoringColumns()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [autoSizeMonitoringColumns, displayedItemsInOrder, fontSize, hiddenColumns, isIntelligenceExpanded])

  const selectedItems = useMemo(
    () => displayedItems.filter((item: any) => isSelected(item.id)),
    [displayedItems, selectedIds, isSelected]
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
    const field = expandedBulkSection === 'notification' ? 'notification_method' : expandedBulkSection
    if (!field) return null
    const nextValue = expandedBulkSection === 'notification' ? bulkDraft.notification_method : bulkDraft[expandedBulkSection]
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
      lastVisitedAt,
      searchTerm
    }))
  }, [activeTab, columnLayoutState, fontSize, groupBy, hiddenColumns, lastVisitedAt, quickFilters, rowDensity, searchTerm, selectedIds, showFilterBar])

  useEffect(() => {
    if (!activeViewId || !gridRef.current?.api) return
    applySavedView(activeViewId)
  }, [activeViewId, items.length])

  useEffect(() => {
    if (!gridRef.current?.api || !hasSelection()) return
    gridRef.current.api.forEachNode((node: any) => {
      node.setSelected(isSelected(node.data?.id))
    })
  }, [displayedItems, selectedIds, isSelected])

  useEffect(() => {
    if (!hasSelection()) {
      closeOverlay('bulk')
      setExpandedBulkSection(null)
    }
  }, [closeOverlay, hasSelection])

  useEffect(() => {
    if (typeof window === 'undefined') return
    ;(window as any).__DEBUG_SET_MONITORING_COLUMN_WIDTH__ = (colId: string, width: number) => {
      if (!gridRef.current?.api) return
      gridRef.current.api.applyColumnState({
        state: [{ colId, width }],
        applyOrder: false,
      })
      setTransientManualColumnWidths(true)
      syncColumnLayoutState(gridRef.current.api, true)
    }
    return () => {
      delete (window as any).__DEBUG_SET_MONITORING_COLUMN_WIDTH__
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

  const runUndo = async () => {
    const undo = lastUndoRef.current
    if (!undo) return
    if (undo.mode === 'bulk') {
      const res = await apiFetch('/api/v1/monitoring/bulk-action', {
        method: 'POST',
        body: JSON.stringify({ ids: undo.ids, action: undo.action, payload: undo.payload || {} })
      })
      if (!res.ok) throw new Error(await res.text())
    } else if (undo.mode === 'restore_purged') {
      const res = await apiFetch('/api/v1/monitoring/bulk-action', {
        method: 'POST',
        body: JSON.stringify({
          ids: undo.snapshots.map((snapshot: any) => snapshot.id),
          action: 'restore_purged',
          payload: { snapshots: undo.snapshots },
        })
      })
      if (!res.ok) throw new Error(await res.text())
    } else if (undo.mode === 'restore_snapshots') {
      for (const snapshot of undo.snapshots) {
        const res = await apiFetch(`/api/v1/monitoring/${snapshot.id}`, {
          method: 'PUT',
          body: JSON.stringify(sanitizeMonitoringPayload(snapshot))
        })
        if (!res.ok) throw new Error(await res.text())
      }
    }
    lastUndoRef.current = null
    queryClient.invalidateQueries({ queryKey: ['monitoring-items'] })
  }

  const ensurePurgeRestoreCapability = useCallback(async () => {
    if (purgeRestoreCapabilityRef.current !== null) return purgeRestoreCapabilityRef.current
    try {
      await apiFetch('/api/v1/monitoring/bulk-action', {
        method: 'POST',
        body: JSON.stringify({ ids: [0], action: 'restore_purged', payload: {} })
      })
      purgeRestoreCapabilityRef.current = {
        supported: true,
        reason: 'restore_purged probe request succeeded.',
      }
    } catch (error: any) {
      const detail = (
        typeof error?.data?.detail === 'string' && error.data.detail.trim()
          ? error.data.detail.trim()
          : error instanceof Error && error.message.trim()
            ? error.message.trim()
            : 'Unknown restore_purged probe failure'
      )
      const status = Number.isFinite(Number(error?.status)) ? Number(error.status) : null
      const supported = monitoringSupportsRestorePurged(error)
      const detailPrefix = status ? `${status} ` : ''
      purgeRestoreCapabilityRef.current = supported
        ? {
            supported: true,
            reason: `restore_purged probe returned ${detailPrefix}${detail}; treating backend support as present.`,
          }
        : {
            supported: false,
            reason: `Revert unavailable: restore_purged probe returned ${detailPrefix}${detail}.`,
          }
    }
    return purgeRestoreCapabilityRef.current ?? {
      supported: false,
      reason: 'Revert unavailable: restore_purged capability probe produced no result.',
    }
  }, [])

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
      // Capture the full pre-purge rows here; truthful restore_purged depends on real snapshots, not ids alone.
      const previousSnapshots = (allItems || []).filter((item: any) => idsToUse.includes(item.id)).map((item: any) => ({ ...item }))
      const res = await apiFetch('/api/v1/monitoring/bulk-action', {
        method: 'POST',
        body: JSON.stringify({ ids: idsToUse, action, payload })
      })
      if (!res.ok) throw new Error(await res.text())
      const result = await res.json()
      return { result, action, payload, idsToUse, previousSnapshots }
    },
    onSuccess: async ({ result, action, payload, idsToUse, previousSnapshots }: any) => {
      queryClient.invalidateQueries({ queryKey: ['monitoring-items'] })
      idsToUse.forEach((id: number) => {
        queryClient.invalidateQueries({ queryKey: ['monitoring-history', id] })
      })
      closeOverlay('bulk')
      setExpandedBulkSection(null)
      setBulkDraft({ status: '', severity: '', notification_method: '' })
      const totalSelected = idsToUse.length
      const parsedChangedCount = Number(result?.changed)
      const changedCount = Number.isFinite(parsedChangedCount)
        ? parsedChangedCount
        : action === 'update'
          ? countSemanticBulkChanges(previousSnapshots, payload)
          : action === 'delete'
            ? previousSnapshots.filter((snapshot: any) => !snapshot?.is_deleted).length
            : action === 'restore'
              ? previousSnapshots.filter((snapshot: any) => !!snapshot?.is_deleted).length
              : totalSelected
      const unchangedCount = Math.max(0, totalSelected - changedCount)
      const fieldLabel = resolveBulkFieldLabel(payload, MONITORING_BULK_FIELD_LABELS)
      const actionId = action === 'delete' ? 'archive' : action
      const availableSnapshots = Array.isArray(previousSnapshots) ? previousSnapshots.filter(Boolean) : []
      const shouldEvaluatePurgeRevert = action === 'purge' && changedCount > 0
      let purgeSuppressionReason: string | null = null
      let purgeRestoreCapability = null as null | { supported: boolean; reason: string }

      if (shouldEvaluatePurgeRevert) {
        if (availableSnapshots.length === 0) {
          purgeSuppressionReason = 'Revert unavailable: missing restore snapshots before purge.'
        } else {
          purgeRestoreCapability = await ensurePurgeRestoreCapability()
          if (!purgeRestoreCapability.supported) {
            purgeSuppressionReason = purgeRestoreCapability.reason
          }
        }
      }

      if (changedCount <= 0) lastUndoRef.current = null
      else if (action === 'delete') lastUndoRef.current = { mode: 'bulk', ids: idsToUse, action: 'restore' }
      else if (action === 'restore') lastUndoRef.current = { mode: 'bulk', ids: idsToUse, action: 'delete' }
      else if (action === 'purge' && availableSnapshots.length > 0 && purgeRestoreCapability?.supported) {
        lastUndoRef.current = { mode: 'restore_purged', snapshots: availableSnapshots }
      }
      else if (action === 'update') lastUndoRef.current = { mode: 'restore_snapshots', snapshots: previousSnapshots, payload }
      else lastUndoRef.current = null

      // When purge cannot expose Revert, emit the exact suppression cause in the success toast instead of hiding it silently.
      if (action === 'purge' && changedCount > 0 && purgeSuppressionReason) {
        showWorkspaceToast(
          `${buildOperationalLifecycleToastMessage({
            action: actionId,
            totalSelected,
            changedCount,
            unchangedCount,
            fieldLabel,
          })} ${purgeSuppressionReason}`,
          { type: 'success' }
        )
        return
      }

      showOperationalBulkResultToast({
        action: actionId,
        totalSelected,
        changedCount,
        unchangedCount,
        fieldLabel,
        onRevert: lastUndoRef.current ? async () => {
          try {
            await runUndo()
            lastUndoRef.current = null
            showOperationalBulkRevertedToast()
          } catch (error: any) {
            showOperationalBulkRevertErrorToast(error.message || 'Bulk revert failed')
          }
        } : undefined,
      })
    },
    onError: (e: any) => showOperationalBulkErrorToast(e.message)
  })

  const columnDefs = useMemo(() => {
  const columnConfigs: OperationalColumnConfig[] = [
    {
      kind: 'identity',
      field: 'title',
      headerName: 'Title',
      hide: hiddenColumns.includes('title'),
      width: 240,
      minWidth: 170,
      maxWidth: 340,
    },
    {
      kind: 'plain',
      field: 'device_name',
      headerName: 'Target Asset',
      width: 160,
      hide: hiddenColumns.includes('device_name'),
    },
    {
      kind: 'mappedBadge',
      field: 'status',
      headerName: 'Status',
      fontSize,
      emptyValue: 'Unknown',
      colorMap: MONITORING_STATUS_COLORS,
      knownValues: STATUSES.map((entry) => entry.label),
      hide: hiddenColumns.includes('status'),
    },
    {
      kind: 'hoverSummary',
      field: 'owners',
      headerName: 'Owners',
      width: 140,
      fontSize,
      getItems: (p) => p.value || [],
      getSummary: (owners: any[]) => owners.length > 1 ? `${owners[0].name} +${owners.length - 1}` : owners[0].name,
      getTooltip: (owners: any[]) => owners
        .map((owner: any) => `${owner.name}${owner.role ? ` (${owner.role})` : ''}${owner.external_id ? ` - ${owner.external_id}` : ''}`)
        .join('\n'),
      hide: hiddenColumns.includes('owners'),
    },
    {
      kind: 'mappedText',
      field: 'category',
      headerName: 'Category',
      width: 140,
      fontSize,
      colorMap: MONITORING_CATEGORY_COLORS,
      hide: hiddenColumns.includes('category'),
    },
    {
      kind: 'activeDot',
      field: 'is_active',
      headerName: 'Existing',
      getIsDeleted: (p) => p.data?.is_deleted || p.data?.status === 'Deleted',
      hide: hiddenColumns.includes('is_active'),
    },
    {
      kind: 'hoverSummary',
      field: 'monitored_service_names',
      headerName: 'Services',
      width: 110,
      fontSize,
      tone: 'blue',
      getItems: (p) => p.value || [],
      getSummary: (names: any[]) => names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0],
      getTooltip: (names: any[]) => names.join('\n'),
      hide: hiddenColumns.includes('monitored_service_names'),
    },
    {
      kind: 'plain',
      field: 'platform',
      headerName: 'Platform',
      hide: hiddenColumns.includes('platform'),
    },
    {
      kind: 'mappedBadge',
      field: 'severity',
      headerName: 'Severity',
      fontSize,
      colorMap: MONITORING_SEVERITY_COLORS,
      knownValues: MONITORING_SEVERITIES.map((entry) => entry.label),
      hide: hiddenColumns.includes('severity'),
    },
    {
      kind: 'plain',
      field: 'check_interval',
      headerName: 'Freq',
      width: 80,
      formatValue: (value) => value ? `${value}s` : null,
      hide: hiddenColumns.includes('check_interval'),
    },
    {
      kind: 'actionLink',
      field: 'notification_method',
      headerName: 'Notify',
      width: 130,
      fontSize,
      onActivate: (p) => setRecipientPopup({ recipients: p.data.notification_recipients || [], method: p.value }),
      hide: hiddenColumns.includes('notification_method'),
    },
    {
      kind: 'prose',
      field: 'purpose',
      headerName: 'Purpose',
      width: 220,
      proseMode: 'compact',
      hide: hiddenColumns.includes('purpose'),
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
      onToggleFavorite: toggleFavorite,
      onToggleWatch: toggleWatch,
      itemLabel: 'monitor',
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
  return (
   <OperationalWorkspaceShell
      archetype="table"
      workspace="monitoring"
      header={{
        eyebrow: "Observability",
        title: (
          <div className="flex items-center gap-3">
            <Activity className="text-blue-500" />
            <span>Monitoring</span>
          </div>
        ),
        subtitle: "Centralized monitoring configuration and operational status",
        actions: (
          <>
            <HeaderScopeSwitch
              label="Registry Scope"
              summary={`${lifecycleCounts.existing} existing · ${lifecycleCounts.archived} archived`}
              value={activeTab}
              onChange={(next) => {
                setActiveTab(next as 'active' | 'deleted')
                clearSelection()
              }}
              options={[
                { label: 'Existing', value: 'active' },
                { label: 'Archived', value: 'deleted' }
              ]}
            />
            {isError && (
              <>
                <DiagnosticStatusPill 
                    status="error" 
                    errorDetail={{ status: (error as any)?.status }} 
                    onClick={() => setShowMonitoringDataDiagnostic(true)} 
                />
                <DataDiagnosticModal 
                    isOpen={showMonitoringDataDiagnostic} 
                    onClose={() => setShowMonitoringDataDiagnostic(false)} 
                    errorDetail={buildOperationalDiagnosticDetail({
                        endpoint: '/api/v1/monitoring?include_deleted=true',
                        error,
                        fallbackMessage: 'The monitoring registry request failed.',
                    })} 
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
            <ToolbarButton onClick={() => setShowImportModal(true)} title="Import monitoring rows">
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
            value={quickFilters.severity}
            onChange={(val) => setQuickFilters((current) => ({ ...current, severity: val }))}
            options={severities.map((severity: any) => ({ value: severity.value, label: severity.label }))}
            label="Severity Filter"
            placeholder="All severities"
          />
          <AppDropdown
            multi
            value={quickFilters.platform}
            onChange={(val) => setQuickFilters((current) => ({ ...current, platform: val }))}
            options={platformOptions}
            label="Platform Filter"
            placeholder="All platforms"
          />
          <AppDropdown
            multi
            value={quickFilters.owner}
            onChange={(val) => setQuickFilters((current) => ({ ...current, owner: val }))}
            options={ownerOptions}
            label="Owner Filter"
            placeholder="All owners"
          />
        </div>
      ) : null}
      toolbarActions={(
        <>
          {MONITORING_SUPPORTS_COMPARE && (
            <ToolbarButton
              onClick={openCompare}
              disabled={selectedCount < 2 || selectedCount > 5}
              active={compareOpen}
              title="Compare selected monitors"
            >
              <span className="flex items-center gap-2">
                <GitCompare size={14} />
                Compare
              </span>
            </ToolbarButton>
          )}
          <ToolbarButton
            onClick={() => togglePanel('bulk')}
            disabled={!hasSelection()}
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
            ariaLabel="Add Monitoring"
          >
            + Add Monitoring
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
                  setQuickFilters({ status: [] as string[], severity: [] as string[], platform: [] as string[], owner: [] as string[] })
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
            entityLabel="Monitoring"
            onClose={dismissWorkspaceMenus}
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
            onRenameView={renameView}
            onDeleteView={deleteView}
            describeView={(view) => view.config?.groupBy && view.config.groupBy !== 'raw'
              ? `Grouped by ${groupOptions.find((option) => option.value === view.config.groupBy)?.label || view.config.groupBy}`
              : 'Raw monitoring table'}
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
                <p className="pt-1 text-[12px] font-semibold text-slate-100">{selectedIds.length} monitors selected</p>
              </div>
              <div className="space-y-2">
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
                  title="Set Severity"
                  active={expandedBulkSection === 'severity'}
                  onClick={() => setExpandedBulkSection(expandedBulkSection === 'severity' ? null : 'severity')}
                />
                {expandedBulkSection === 'severity' && (
                  <WorkspaceFlyoutDropdownEditor
                    value={bulkDraft.severity}
                    onChange={(value) => setBulkDraft((current) => ({ ...current, severity: value }))}
                    options={severities.map((severity: any) => ({ value: severity.value, label: severity.label }))}
                    placeholder="Choose severity"
                    actionLabel="Apply Severity"
                    onApply={() => bulkMutation.mutate({ action: 'update', payload: { severity: bulkDraft.severity } })}
                    disabled={!bulkDraft.severity || bulkMutation.isPending}
                  />
                )}
                <WorkspaceFlyoutActionCard
                  title="Set Notification Method"
                  active={expandedBulkSection === 'notification'}
                  onClick={() => setExpandedBulkSection(expandedBulkSection === 'notification' ? null : 'notification')}
                />
                {expandedBulkSection === 'notification' && (
                  <WorkspaceFlyoutDropdownEditor
                    value={bulkDraft.notification_method}
                    onChange={(value) => setBulkDraft((current) => ({ ...current, notification_method: value }))}
                    options={notificationMethods.map((method: any) => ({ value: method.value, label: method.label }))}
                    placeholder="Choose notification method"
                    actionLabel="Apply Method"
                    onApply={() => bulkMutation.mutate({ action: 'update', payload: { notification_method: bulkDraft.notification_method } })}
                    disabled={!bulkDraft.notification_method || bulkMutation.isPending}
                  />
                )}
              </div>
            </WorkspaceFloatingPanel>
          </OperationalAnchoredPanel>

{hasRowActionMenu && rowActionMenu && (() => {
              const item = rowActionMenu.item
              const sections: OperationalRowActionSectionModel[] = [
                {
                    id: 'quickAccess',
                    columns: 5 as 5,
                    items: [
                        { id: 'details', label: 'Details', icon: Maximize2, tone: 'info' as OperationalRowActionTone, onClick: () => { detailRoute.openDetail(item); setRowActionMenu(null); } },
                        { id: 'edit', label: 'Edit', icon: Edit2, tone: 'success' as OperationalRowActionTone, onClick: () => { setEditingItem(item); setIsFormOpen(true); setRowActionMenu(null); } },
                        { id: 'history', label: 'History', icon: Clock, tone: 'warning' as OperationalRowActionTone, onClick: () => { setHistoryItem(item); setRowActionMenu(null); } },
                        { id: 'asset', label: 'Asset', icon: Monitor, tone: 'info' as OperationalRowActionTone, onClick: () => { if (item.device_id) navigate(`/asset?id=${item.device_id}`); setRowActionMenu(null); } },
                        { id: 'knowledge', label: 'Knowledge', icon: BookOpen, tone: 'success' as OperationalRowActionTone, onClick: () => { const firstDoc = item.recovery_docs?.[0]; const docId = typeof firstDoc === 'object' ? firstDoc?.id : firstDoc; if (docId && knowledgeAction.available) navigate(`/knowledge?id=${docId}`); setRowActionMenu(null); }, disabled: !item.recovery_docs?.[0] || knowledgeAction.disabled, disabledReason: !item.recovery_docs?.[0] ? 'No recovery procedure linked.' : knowledgeAction.reason }

                    ]
                },
                {
                    id: 'followOptions',
                    columns: 2 as 2,
                    items: [
                        { id: 'watch', label: watchIds.includes(item.id) ? 'Unwatch' : 'Watch', icon: watchIds.includes(item.id) ? EyeOff : Eye, tone: 'neutral', onClick: () => toggleWatch(item.id) },
                        { id: 'favorite', label: favoriteIds.includes(item.id) ? 'Unpin' : 'Pin', icon: Star, tone: 'warning', onClick: () => toggleFavorite(item.id) }
                    ]
                },
                {
                    id: 'archive',
                    columns: 1 as 1,
                    items: [
                        ...(activeTab === 'deleted' ? [{ id: 'restore', label: 'Restore', icon: Undo2, tone: 'success' as OperationalRowActionTone, variant: 'inline' as OperationalRowActionVariant, onClick: () => { bulkMutation.mutate({ action: 'restore', ids: [item.id] }); setRowActionMenu(null); } }] : []),
                        {
                            id: 'archive',
                            label: rowDeleteConfirmId === item.id ? (activeTab === 'active' ? OPERATIONAL_ACTION_LABELS.archiveConfirm : OPERATIONAL_ACTION_LABELS.purgeConfirm) : (activeTab === 'active' ? OPERATIONAL_ACTION_LABELS.archive : OPERATIONAL_ACTION_LABELS.purge),
                            icon: Trash2,
                            tone: 'danger' as OperationalRowActionTone,
                            variant: 'inline' as OperationalRowActionVariant,
                            confirming: rowDeleteConfirmId === item.id,
                            onClick: () => {
                                if (rowDeleteConfirmId !== item.id) { setRowDeleteConfirmId(item.id); return }
                                bulkMutation.mutate({ action: activeTab === 'active' ? 'delete' : 'purge', ids: [item.id] });
                                setRowActionMenu(null); setRowDeleteConfirmId(null);
                            }
                        }
                    ]
                }
              ]
              return (
                <OperationalRowActionMenu
                  onClose={() => setRowActionMenu(null)}
                  meta={`ID ${item.id} · ${item.device_name || 'No target asset linked'}`}
                  title={item.title}
                  sections={sections}
                  cursorX={rowActionMenu.point.x}
                  cursorY={rowActionMenu.point.y}
                />
              )
            })()}
        </>
      }
    >

      {shouldRenderRawGrid ? (
        <OperationalDataGrid
          gridRef={gridRef}
          rows={displayedItemsInOrder || []}
          columnDefs={columnDefs}
          runtime={monitoringGridRuntime}
          rowInteractions={monitoringRowInteractions}
          contextMenu={monitoringContextMenu}
          onSelectionChanged={(e) => handleSelectionChanged(e, 'raw')}
          onFirstDataRendered={handleGridDataUpdated}
          onRowDataUpdated={handleGridDataUpdated}
          context={gridContext}
          selectionScopeKey={selectionScopeKey}
          quickFilterText={searchTerm}
          getRowId={handleRowId}
          getRowClass={getRowClass}
          fontSize={fontSize}
          rowDensity={rowDensity}
          dataState={monitoringDataState}
          noRowsLabel={monitoringDataState.noRowsLabel}
          loading={isLoading}
          loadingIcon={<RefreshCcw size={32} className="text-blue-400 animate-spin" />}
          loadingLabel={<p className="text-[10px] font-semibold text-blue-400">Scanning monitoring matrix...</p>}
        />
      ) : (
        <OperationalGroupedGridView
          summary={
            <div>
              <p className="text-[10px] font-semibold text-slate-400">Grouped monitoring matrix</p>
              <p className="pt-1 text-[12px] font-semibold text-slate-100">Sorted by {groupOptions.find((option) => option.value === groupBy)?.label || groupBy}</p>
            </div>
          }
          actions={
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
          }
          sections={groupedSections.map((section) => {
            const isCollapsed = collapsedGroups[section.key]
            const selectedCount = section.items.filter((item: any) => isSelected(item.id)).length
            return (
              <OperationalGroupedGridSection
                key={section.key}
                labelMeta={<span className="text-[9px] font-semibold text-blue-400">{groupOptions.find((option) => option.value === groupBy)?.label}</span>}
                label={section.label}
                count={section.items.length}
                countLabel="monitors"
                selectedCount={selectedCount}
                collapsed={isCollapsed}
                onToggle={() => setCollapsedGroups((current) => ({ ...current, [section.key]: !current[section.key] }))}
              >
                {!isCollapsed && (
                  <OperationalDataGrid
                    rows={section.items}
                    columnDefs={columnDefs}
                    runtime={monitoringGridRuntime}
                    rowInteractions={monitoringRowInteractions}
                    contextMenu={monitoringContextMenu}
                    onSelectionChanged={(e) => handleSelectionChanged(e, section.key)}
                    onFirstDataRendered={handleGridDataUpdated}
                    onRowDataUpdated={handleGridDataUpdated}
                    context={gridContext}
                    selectionScopeKey={selectionScopeKey}
                    quickFilterText={searchTerm}
                    getRowId={handleRowId}
                    getRowClass={getRowClass}
                    fontSize={fontSize}
                    rowDensity={rowDensity}
                    noRowsLabel="No monitoring data found"
                    className="w-full"
                    height={`${Math.min(600, section.items.length * (fontSize + rowDensity + 5) + 40)}px`}
                  />
                )}
              </OperationalGroupedGridSection>
            )
          })}
        />
      )}

      <ConfirmationModal 
        isOpen={confirmModal.isOpen}
        onClose={() => {
          if (confirmModal.onClose) {
            confirmModal.onClose()
          } else {
            setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
          }
        }}
        onConfirm={() => {
          if (confirmModal.onConfirm) confirmModal.onConfirm()
          setConfirmModal((prev: any) => ({ ...prev, isOpen: false }))
        }}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
      />

      <AnimatePresence>
        {isFormOpen && (
          <MonitoringForm 
            key={`monitoring-form-${editingItem?.id || 'new'}`}
            item={editingItem} 
            devices={devices}
            categories={categories}
            severities={severities}
            platforms={platforms}
            teams={teams}
            operators={operators || []}
            notificationMethods={notificationMethods}
            ownerRoles={ownerRoles}
            onClose={() => {
              setIsFormOpen(false)
              detailRoute.finishTransition()
            }} 
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['monitoring-items'] })
              if (editingItem?.id) {
                queryClient.invalidateQueries({ queryKey: ['monitoring-history', editingItem.id] })
              }
              setIsFormOpen(false)
              detailRoute.finishTransition()
            }}
            onDirtyChange={setIsFormDirty}
          />
        )}
        {detailItem && (
          <MonitoringDetailModal
            key={`monitoring-detail-${detailItem.id}`}
            item={detailItem}
            onClose={() => { detailRoute.closeDetail(); setDetailDeleteConfirm(false); }}
            onEdit={(monitor: any) => {
              detailRoute.openEditFromDetail(monitor, () => {
                setEditingItem(monitor);
                setIsFormOpen(true);
                setDetailDeleteConfirm(false);
              })
            }}
            onOpenHistory={(monitor: any) => {
              detailRoute.openHistoryFromDetail(monitor, () => {
                setHistoryItem(monitor);
                setDetailDeleteConfirm(false);
              })
            }}
            onOpenBkm={(monitor: any) => {
              const recoveryDocs = monitor.recovery_docs || []
              detailRoute.openEditFromDetail(monitor, () => {
                setBkmPopup({ docs: recoveryDocs, ids: recoveryDocs, titles: monitor.recovery_doc_titles || [], monitorId: monitor.id })
                setDetailDeleteConfirm(false)
              })
            }}
            onDelete={(monitor: any) => {
              if (!detailDeleteConfirm) {
                setDetailDeleteConfirm(true)
                return
              }
              bulkMutation.mutate({ action: activeTab === 'active' ? 'delete' : 'purge', ids: [monitor.id] })
              detailRoute.closeDetail()
              setDetailDeleteConfirm(false)
            }}
            onOpenAsset={(deviceId: number) => navigate(`/asset?id=${deviceId}`)}
            onOpenKnowledge={(knowledgeId: number) => { if (knowledgeAction.available) navigate(`/knowledge?id=${knowledgeId}`) }}
            deleteConfirm={detailDeleteConfirm}
          />
        )}
        {historyItem && <MonitoringHistoryModal key={`monitoring-history-${historyItem.id}`} item={historyItem} onClose={() => { setHistoryItem(null); detailRoute.finishTransition(); }} />}
        {recipientPopup && <RecipientsModal key={`monitoring-recipients-${recipientPopup.method}-${recipientPopup.recipients.join('|')}`} recipients={recipientPopup.recipients} method={recipientPopup.method} onClose={() => setRecipientPopup(null)} />}
        {bkmPopup && (
          <BkmListModal 
            key={`monitoring-bkm-list-${bkmPopup.monitorId ?? 'none'}-${bkmPopup.docs.join('-')}`}
            docs={bkmPopup.docs} 
            monitorId={bkmPopup.monitorId}
            onOpenBkm={(knowledgeId) => setActiveBkm({ id: knowledgeId, monitorId: bkmPopup.monitorId })}
            onOpenKnowledge={(knowledgeId) => {
              if (!knowledgeAction.available) return
              setBkmPopup(null)
              setActiveBkm(null)
              detailRoute.finishTransition()
              navigate(`/knowledge?id=${knowledgeId}`)
            }}
            onClose={() => { setBkmPopup(null); detailRoute.finishTransition(); }} 
          />
        )}
        {activeBkm && <BkmDetailModal key={`monitoring-bkm-detail-${activeBkm.id}`} bkmId={activeBkm.id} monitorId={activeBkm.monitorId} onClose={() => { setActiveBkm(null); detailRoute.finishTransition(); }} />}
        {compareOpen && <CompareMonitorsModal key={`monitoring-compare-${compareItems.map((item) => item.id).join('-') || 'empty'}`} items={compareItems} onClose={() => setCompareOpen(false)} />}
        {showBulkEditModal && (
          <BulkEditTableModal
            key={`monitoring-bulk-edit-${selectedItems.map((item) => item.id).join('-') || 'empty'}`}
            items={selectedItems}
            teams={teams || []}
            operators={operators || []}
            severities={severities}
            notificationMethods={notificationMethods}
            onClose={() => setShowBulkEditModal(false)}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['monitoring-items'] })
              setShowBulkEditModal(false)
            }}
            onDirtyChange={setIsBulkEditDirty}
          />
        )}
        <OperationalImportModal
          key="monitoring-import-modal"
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          tableName="monitoring_items"
          displayName="Monitoring"
        />
        <ConfigRegistryModal
            key="monitoring-config-registry"
            isOpen={showRegistry}
            onClose={() => setShowRegistry(false)}
            title="Monitoring Matrix Enumerations"
            sections={[
                { title: "Categories", category: "MonitoringCategory", icon: Layers },
                { title: "Platforms", category: "MonitoringPlatform", icon: Globe },
                { title: "Notification Methods", category: "NotificationMethod", icon: Bell },
            ]}
            onDirtyChange={setIsConfigDirty}
        />
      </AnimatePresence>

    </OperationalWorkspaceShell>
  )
}

function CompareMonitorsModal({ items, onClose }: any) {
  useEscapeDismiss(onClose)
  useBodyModalFlag()
  const [isMaximized, setIsMaximized] = useState(false)

  const fields = useMemo(() => [
    { label: 'Status', getValue: (item: any) => item.status || 'Unknown' },
    { label: 'Severity', getValue: (item: any) => item.severity || 'N/A' },
    { label: 'Platform', getValue: (item: any) => item.platform || 'N/A' },
    { label: 'Notify', getValue: (item: any) => item.notification_method || 'None' },
    { label: 'Owners', getValue: (item: any) => (item.owners || []).map((owner: any) => owner.name).join(', ') || 'None' },
    { label: 'Recovery', getValue: (item: any) => item.recovery_doc_titles?.join(', ') || 'None linked' },
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
      title="Compare Monitors"
      subtitle={`Temporal Variance Analysis · Comparing ${items.length} monitoring states for semantic drift`}
      icon={<GitCompare size={20} />}
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


function BulkEditTableModal({ items, teams, operators, severities, notificationMethods, onClose, onSuccess, onDirtyChange }: any) {
  const [rows, setRows] = useState(() => items.map((item: any) => ({
    id: item.id,
    title: item.title,
    status: item.status || '',
    severity: item.severity || '',
    notification_method: item.notification_method || '',
    owner_team: item.owner_team || '',
    owner_user_ids: stringifyOwnerUserIds(item.owners || []),
    check_interval: item.check_interval ?? '',
    alert_duration: item.alert_duration ?? '',
    notification_throttle: item.notification_throttle ?? '',
    is_active: item.is_active !== false,
  })))
  const [isMaximized, setIsMaximized] = useState(false)

  const initialDirtySnapshot = useMemo(() => JSON.stringify(items.map((item: any) => ({
    id: item.id,
    title: item.title,
    status: item.status || '',
    severity: item.severity || '',
    notification_method: item.notification_method || '',
    owner_team: item.owner_team || '',
    owner_user_ids: stringifyOwnerUserIds(item.owners || []),
    check_interval: item.check_interval ?? '',
    alert_duration: item.alert_duration ?? '',
    notification_throttle: item.notification_throttle ?? '',
    is_active: item.is_active !== false,
  }))), [items])

  const isDirty = useMemo(() => JSON.stringify(rows) !== initialDirtySnapshot, [rows, initialDirtySnapshot])

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  const updateRow = (rowId: number, field: string, value: any) => {
    setRows((current: any[]) => current.map((row: any) => row.id === rowId ? { ...row, [field]: value } : row))
  }

  const mutation = useMutation({
    mutationFn: async () => {
      for (const row of rows) {
        const payload = {
          status: row.status,
          severity: row.severity || null,
          notification_method: row.notification_method || null,
          owner_team: row.owner_team || null,
          owners: parseCommaSeparatedValues(row.owner_user_ids).map((externalId) => ({
            external_id: externalId,
            role: 'Primary Support',
          })),
          check_interval: row.check_interval === '' ? null : Number(row.check_interval),
          alert_duration: row.alert_duration === '' ? null : Number(row.alert_duration),
          notification_throttle: row.notification_throttle === '' ? null : Number(row.notification_throttle),
          is_active: Boolean(row.is_active),
        }
        const res = await apiFetch(`/api/v1/monitoring/${row.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        })
        await res.json()
      }
    },
    onSuccess: () => {
      showWorkspaceToast(`Updated ${rows.length} monitor${rows.length === 1 ? '' : 's'}`)
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
      title="Bulk Edit Monitoring"
      subtitle="Safe table-based edits for selected monitors."
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
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <WorkspaceInfoTooltip
              label={<span>Allowed team names</span>}
              content={
                (teams || []).length > 0
                  ? (teams || []).map((team: any) => (
                      <div key={team.id} className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                        <p className="text-[10px] font-semibold text-slate-100">{team.name}</p>
                        <p className="mt-1 text-[9px] font-semibold text-slate-500">{team.operators?.length || 0} members</p>
                      </div>
                    ))
                  : <p>No teams available.</p>
              }
            />
            <WorkspaceInfoTooltip
              label={<span>Allowed owner user IDs</span>}
              content={
                (operators || []).length > 0
                  ? (operators as OperatorRecord[]).map((operator) => (
                      <div key={operator.id} className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                        <p className="text-[10px] font-semibold text-slate-100">{operator.external_id || operator.username || String(operator.id)}</p>
                        <p className="mt-1 text-[9px] font-semibold text-slate-500">{operator.full_name || operator.team || 'No team'}</p>
                      </div>
                    ))
                  : <p>No operators available.</p>
              }
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-white/10 bg-black/20 custom-scrollbar">
          <table className="min-w-full divide-y divide-white/10">
            <thead className="bg-slate-950/90 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Title</th>
                <th className="min-w-[160px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Status</th>
                <th className="min-w-[160px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Severity</th>
                <th className="min-w-[180px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Notification</th>
                <th className="min-w-[220px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Owner Team(s)</th>
                <th className="min-w-[240px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Owner User ID(s)</th>
                <th className="min-w-[130px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Freq (s)</th>
                <th className="min-w-[130px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Delay (s)</th>
                <th className="min-w-[150px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Throttle (s)</th>
                <th className="min-w-[120px] px-4 py-3 text-left text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Control</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((row: any) => (
                <tr key={row.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3 text-[10px] font-bold text-slate-200">{row.title}</td>
                  <td className="px-2 py-2"><AppDropdown value={row.status} onChange={(value) => updateRow(row.id, 'status', value)} options={STATUSES.filter((status) => status.value !== 'Deleted').map((status) => ({ value: status.value, label: status.label }))} placeholder="Status" /></td>
                  <td className="px-2 py-2"><AppDropdown value={row.severity} onChange={(value) => updateRow(row.id, 'severity', value)} options={severities.map((severity: any) => ({ value: severity.value, label: severity.label }))} placeholder="Severity" /></td>
                  <td className="px-2 py-2"><AppDropdown value={row.notification_method} onChange={(value) => updateRow(row.id, 'notification_method', value)} options={notificationMethods.map((method: any) => ({ value: method.value, label: method.label }))} placeholder="Notification" /></td>
                  <td className="px-2 py-2"><input value={row.owner_team} onChange={(event) => updateRow(row.id, 'owner_team', event.target.value)} placeholder="Team names..." className={`${monitoringInputClass()} h-[42px] px-3 py-2 text-[10px]`} /></td>
                  <td className="px-2 py-2"><input value={row.owner_user_ids} onChange={(event) => updateRow(row.id, 'owner_user_ids', event.target.value)} placeholder="User IDs..." className={`${monitoringInputClass()} h-[42px] px-3 py-2 text-[10px]`} /></td>
                  <td className="px-2 py-2"><input type="number" value={row.check_interval} min={CHECK_INTERVAL_MIN} max={CHECK_INTERVAL_MAX} onChange={(event) => updateRow(row.id, 'check_interval', event.target.value)} className={`${monitoringInputClass()} h-[42px] px-3 py-2 text-[10px] [appearance:textfield]`} /></td>
                  <td className="px-2 py-2"><input type="number" value={row.alert_duration} min={ALERT_DURATION_MIN} max={ALERT_DURATION_MAX} onChange={(event) => updateRow(row.id, 'alert_duration', event.target.value)} className={`${monitoringInputClass()} h-[42px] px-3 py-2 text-[10px] [appearance:textfield]`} /></td>
                  <td className="px-2 py-2"><input type="number" value={row.notification_throttle} min={NOTIFICATION_THROTTLE_MIN} max={NOTIFICATION_THROTTLE_MAX} onChange={(event) => updateRow(row.id, 'notification_throttle', event.target.value)} className={`${monitoringInputClass()} h-[42px] px-3 py-2 text-[10px] [appearance:textfield]`} /></td>
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
    >
      <div className="space-y-2">
        {recipients.map((r: string, i: number) => (
          <div key={`${i}-${r}`} className="bg-white/5 border border-white/5 p-3 rounded-lg flex items-center space-x-3 group hover:border-emerald-500/30 transition-all shadow-inner">
            <Mail size={14} className="text-emerald-500" />
            <span className="text-[11px] font-bold text-slate-100">{r}</span>
          </div>
        ))}
        {recipients.length === 0 && (
          <WorkspaceEmptyState compact title="No recipients defined" description="No direct delivery targets found for this monitoring item." />
        )}
      </div>
    </WorkspaceModal>
  )
}

// Extracted to BkmListModal.tsx

// Extracted to BkmDetailModal.tsx

function MonitoringDetailModal({ item, onClose, onEdit, onOpenHistory, onOpenBkm, onDelete, onOpenAsset, onOpenKnowledge, deleteConfirm }: any) {
  useEscapeDismiss(onClose)
  useBodyModalFlag()
  const knowledgeAction = useModuleActionPolicy('knowledge')
  const [isMaximized, setIsMaximized] = useState(false)
  const [expandedLogic, setExpandedLogic] = useState<number | null>(item.logic_json?.[0]?.id || null)
  const [showLineNumbers, setShowLineNumbers] = useState(true)
  const [interventionDoc, setInterventionDoc] = useState<any>(null)

  const { data: suggestedKnowledge } = useQuery({
    queryKey: ['monitoring-knowledge-suggestions', item.id, item.device_id],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.append('monitoring_id', String(item.id))
      params.append('embedded_consumer', 'monitoring')
      const response = await apiFetch(`/api/v1/knowledge?${params.toString()}`)
      const linked = await response.json()
      if (Array.isArray(linked) && linked.length > 0) return linked
      return linked
    }
  })

  const recoveryDocContent = (doc: any, index: number) => (
    <>
      <div className="p-1.5 bg-black/40 rounded-lg text-amber-500 group-hover:bg-amber-500 group-hover:text-white transition-all"><FileText size={14}/></div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold text-slate-300 tracking-tight leading-tight group-hover:text-white truncate">{doc.title}</p>
        <div className="flex items-center justify-between mt-0.5">
          <p className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Procedure {index + 1}</p>
          {doc.note && (
            <div className="flex items-center gap-1 text-blue-500/60">
              <MessageSquare size={8} />
              <span className="text-[8px] font-black uppercase tracking-widest">Note attached</span>
            </div>
          )}
        </div>
      </div>
    </>
  )

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
          <span>{item.title}</span>
          <WorkspaceShareHeader id={String(item.id)} title={item.title} />
        </div>
      }
      subtitle={`Monitor ID: ${item.id} · ${item.device_name || 'No Target Asset'}`}
      icon={<Monitor size={20} />}
      forensicLineage={{ createdAt: item.created_at, updatedAt: item.updated_at }}
      status={
        <div className="flex items-center gap-2">
          <StatusPill value={item.status} />
          <StatusPill value={item.severity} />
          <div className="h-3 w-px bg-white/10 mx-1" />
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest whitespace-nowrap">
            {item.platform || 'No platform'} · {item.check_interval ? `${item.check_interval}s checks` : 'No frequency'}
          </span>
        </div>
      }
      footerRight={
        <div className="flex items-center gap-3">
            <ToolbarButton onClick={() => onEdit?.(item)}>Edit Monitor</ToolbarButton>
            <ToolbarButton onClick={() => onOpenHistory?.(item)}>History</ToolbarButton>
            <ToolbarButton onClick={() => onOpenBkm?.(item)}>Recovery</ToolbarButton>
            <ToolbarButton 
              variant="danger" 
              onClick={() => {
                if (deleteConfirm) {
                  const action = item.is_deleted ? 'Purged' : 'Archived';
                  onDelete?.(item);
                  showWorkspaceToast(`${action} ${item.title} from matrix`, {
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
           <WorkspaceSplitView
             className="gap-8"
             sidebar={<div className="space-y-8">
                 <section className="space-y-3">
                    <h3 className="px-1 text-[11px] font-black text-slate-500 uppercase tracking-widest">Target scope</h3>
                    <div className="space-y-3">
                       <button
                         disabled={!item.device_id}
                         onClick={() => item.device_id && onOpenAsset?.(item.device_id)}
                         className="w-full rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 text-left transition-all hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-30 shadow-inner group"
                       >
                         <div className="flex items-center justify-between mb-2">
                            <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest">Registry asset</p>
                            <ArrowRightLeft size={10} className="text-blue-500/50 group-hover:translate-x-1 transition-transform" />
                         </div>
                         <p className="text-[11px] font-black text-slate-100">{item.device_name || 'No linked asset'}</p>
                       </button>
                       
                       <div className="bg-black/20 border border-white/5 rounded-lg p-4 shadow-inner space-y-3">
                          <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Monitored services</p>
                          <div className="flex flex-wrap gap-1.5">
                             {item.monitored_service_names?.map((name: string, i: number) => (
                               <span key={`${i}-${item.id}`} className="bg-blue-600/10 border border-blue-500/20 text-blue-300 px-2 py-0.5 rounded-lg text-[9px] font-bold">
                                  {name}
                               </span>
                             ))}
                             {(!item.monitored_service_names || item.monitored_service_names.length === 0) && (
                               <span key="no-services" className="text-[9px] font-bold text-slate-700 italic">No services mapped</span>
                             )}
                          </div>
                       </div>
                    </div>
                 </section>

                 <section className="space-y-3">
                    <h3 className="px-1 text-[11px] font-black text-slate-500 uppercase tracking-widest">Recovery protocol</h3>
                    <div className="space-y-2">
                       {item.recovery_doc_details?.map((doc: any, i: number) => doc.note ? (
                         <button
                           key={`${i}-${item.id}`}
                           type="button"
                           onClick={() => setInterventionDoc(doc)}
                           className="w-full bg-slate-900/60 border border-white/5 rounded-lg p-3 flex items-center space-x-3 hover:border-amber-500/30 transition-all cursor-pointer group text-left shadow-inner"
                         >
                           {recoveryDocContent(doc, i)}
                         </button>
                       ) : (
                         <ModulePolicyButton
                           key={`${i}-${item.id}`}
                           moduleId="knowledge"
                           onClick={() => onOpenKnowledge?.(doc.id)}
                           className="w-full bg-slate-900/60 border border-white/5 rounded-lg p-3 flex items-center space-x-3 hover:border-amber-500/30 transition-all cursor-pointer group text-left shadow-inner"
                         >
                           {recoveryDocContent(doc, i)}
                         </ModulePolicyButton>
                       ))}
                       {(!item.recovery_doc_details || item.recovery_doc_details.length === 0) && (
                         <WorkspaceEmptyState compact icon={<AlertCircle size={18} />} title="No procedures linked" description="Guaranteed operational response protocol missing." />
                       )}
                    </div>
                 </section>

                 <section className="space-y-3">
                    <h3 className="px-1 text-[11px] font-black text-slate-500 uppercase tracking-widest">Operational meta</h3>
                    <div className="bg-white/5 border border-white/5 rounded-lg overflow-hidden divide-y divide-white/5 shadow-inner">
                       {[
                          { label: 'Platform', value: item.platform, color: 'text-blue-400', icon: Globe },
                          { label: 'Frequency', value: `${item.check_interval}s`, color: 'text-slate-300', icon: Clock },
                          { label: 'Throttle', value: `${item.notification_throttle}s`, color: 'text-amber-400', icon: Zap }
                       ].map((stat, i) => (
                          <div key={`${i}-${item.id}-meta`} className="p-3 flex items-center justify-between hover:bg-white/5 transition-all">
                             <div className="flex items-center gap-3">
                                <div className="p-1.5 bg-black/40 rounded-lg text-slate-600">
                                   <stat.icon size={12} />
                                </div>
                                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{stat.label}</span>
                             </div>
                             <span className={`text-[10px] font-black ${stat.color}`}>{stat.value}</span>
                          </div>
                       ))}
                    </div>
                 </section>

                 {item.monitoring_url && (
                    <button 
                       onClick={() => window.open(item.monitoring_url, '_blank')}
                       className="w-full bg-blue-600 hover:bg-blue-500 text-white p-4 rounded-lg font-black uppercase tracking-widest text-[10px] transition-all shadow-xl shadow-blue-500/20 flex items-center justify-center space-x-3"
                    >
                       <ExternalLink size={14} />
                       <span>Open platform console</span>
                    </button>
                 )}
             </div>}
             main={<div className="space-y-8">
                 <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-white/[0.03] border border-white/5 rounded-lg p-5 group hover:border-white/10 transition-all shadow-inner">
                       <div className="flex items-center gap-3 mb-3">
                          <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg"><Info size={14}/></div>
                          <h4 className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Operational Purpose</h4>
                       </div>
                       <p className="text-[12px] font-bold text-slate-400 leading-relaxed pl-1">
                          {item.purpose || 'No purpose defined.'}
                       </p>
                    </div>
                    <div className="bg-white/[0.03] border border-white/5 rounded-lg p-5 group hover:border-white/10 transition-all shadow-inner">
                       <div className="flex items-center gap-3 mb-3">
                          <div className="p-2 bg-rose-500/10 text-rose-400 rounded-lg"><Zap size={14}/></div>
                          <h4 className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Failure Impact</h4>
                       </div>
                       <p className="text-[12px] font-bold text-slate-400 leading-relaxed pl-1">
                          {item.impact || 'No impact analysis defined.'}
                       </p>
                    </div>
                 </section>

                 <section className="space-y-4">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-3">
                         <div className="p-2 bg-slate-800 text-slate-400 rounded-lg"><Code size={16} /></div>
                         <h3 className="text-[11px] font-black text-white uppercase tracking-[0.2em]">Logic Specification</h3>
                      </div>
                      <button 
                         onClick={() => setShowLineNumbers(!showLineNumbers)}
                         className={`text-[8px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border transition-all ${showLineNumbers ? 'bg-blue-600/20 border-blue-500/50 text-blue-400' : 'bg-slate-800 border-white/5 text-slate-500'}`}
                      >
                         {showLineNumbers ? 'Line Numbers: ON' : 'Line Numbers: OFF'}
                      </button>
                    </div>
                    <div className="space-y-3">
                       {item.logic_json?.map((log: any) => (
                         <div key={log.id} className="bg-[#0f172a] border border-white/5 rounded-lg overflow-hidden transition-all hover:border-white/10 shadow-lg">
                            <button 
                               onClick={() => setExpandedLogic(expandedLogic === log.id ? null : log.id)}
                               className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-all group"
                            >
                               <div className="flex items-center space-x-4">
                                  <span className="text-[8px] font-black text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/20 uppercase tracking-widest">{log.type}</span>
                                  <span className="text-slate-300 font-bold text-[11px] tracking-tight group-hover:text-white transition-colors">{log.description}</span>
                               </div>
                               {expandedLogic === log.id ? <ChevronUp size={16} className="text-slate-600" /> : <ChevronDown size={16} className="text-slate-600" />}
                            </button>
                            <AnimatePresence>
                               {expandedLogic === log.id && (
                                 <motion.div 
                                    key={`logic-${log.id}`}
                                    initial={{ height: 0, opacity: 0 }} 
                                    animate={{ height: 'auto', opacity: 1 }} 
                                    exit={{ height: 0, opacity: 0 }} 
                                    className="overflow-hidden bg-black/40 border-t border-white/5"
                                 >
                                    <div className="flex font-mono text-[11px] leading-relaxed overflow-x-auto custom-scrollbar">
                                       {showLineNumbers && (
                                          <div className="bg-white/5 border-r border-white/10 px-3 py-5 text-slate-700 text-right select-none whitespace-pre min-w-[40px]">
                                             {log.logic_info.split('\n').map((_: any, i: number) => i + 1).join('\n')}
                                          </div>
                                       )}
                                       <pre className="p-5 text-emerald-400 flex-1 selection:bg-emerald-500/20">
                                          {log.logic_info}
                                       </pre>
                                    </div>
                                 </motion.div>
                               )}
                            </AnimatePresence>
                         </div>
                       ))}
                       {(!item.logic_json || item.logic_json.length === 0) && (
                         <WorkspaceEmptyState icon={<Terminal size={32} />} title="No logic specification found" description="This monitor has no active logic entries defined." />
                       )}
                    </div>
                 </section>

                 <section className="space-y-4">
                    <div className="flex items-center gap-3 px-1">
                       <div className="p-2 bg-blue-600/10 text-blue-400 rounded-lg"><Users size={16} /></div>
                       <h3 className="text-[11px] font-black text-white uppercase tracking-[0.2em]">Ownership Matrix</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                       <div className="bg-white/[0.03] border border-white/5 rounded-lg p-5 shadow-inner">
                          <h4 className="text-[10px] font-black text-slate-500 mb-3 uppercase tracking-widest">Primary Team Mapping</h4>
                          <div className="flex items-center gap-3">
                             <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                                <Briefcase size={14} />
                             </div>
                             <p className="text-[12px] font-black text-slate-200">{item.owner_team || 'Unassigned'}</p>
                          </div>
                       </div>
                       <div className="bg-white/[0.03] border border-white/5 rounded-lg p-5 shadow-inner">
                          <h4 className="text-[10px] font-black text-slate-500 mb-3 uppercase tracking-widest">Assigned Personnel</h4>
                          <div className="flex flex-wrap gap-2">
                             {item.owners?.map((o: any, i: number) => (
                               <div key={`${i}-${o.operator_id}`} className="bg-blue-600/10 border border-blue-500/20 text-blue-300 px-3 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-2">
                                  <UserCheck size={10} className="text-blue-500" />
                                  <span>{o.name} <span className="text-slate-500 font-normal ml-1">[{o.role}]</span></span>
                               </div>
                             ))}
                             {(!item.owners || item.owners.length === 0) && (
                               <div className="flex items-center gap-2 text-slate-600 py-1">
                                  <AlertCircle size={12} />
                                  <span className="text-[10px] font-black uppercase tracking-widest">No individual owners assigned</span>
                               </div>
                             )}
                          </div>
                       </div>
                    </div>
                 </section>
             </div>}
           />
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
                  <ModulePolicyButton
                    moduleId="knowledge"
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
        errors.monitoring_url = 'Monitoring URL must use http/https and include a host.'
      }
    } catch {
      errors.monitoring_url = 'Monitoring URL must be a valid http/https URL.'
    }
    if (unsafeUrlPattern.test(formData.monitoring_url)) {
      errors.monitoring_url = 'Monitoring URL contains unsafe content.'
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
    errors.recovery_docs = 'Critical monitors require at least one linked recovery procedure.'
  }
*/


const monitoringInputClass = (error?: string) => getWorkspaceInputClass(error)

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
      title="Revision History"
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
    >
      <WorkspaceHistoryShell
          header={null}
          sidebar={
           <div className="flex h-full flex-col min-h-0">
              <div className="mb-4 flex items-center justify-between px-1">
                 <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Revision Timeline</h3>
                 <span className="text-[9px] font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/20">{indexedVersions.length} states</span>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                {isLoading ? (
                   <div className="flex flex-col items-center justify-center py-20 space-y-4">
                      <RefreshCcw size={24} className="animate-spin text-blue-500" />
                      <span className="text-[10px] font-black text-blue-500 animate-pulse uppercase tracking-widest">Syncing timeline...</span>
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
                           {h.change_summary || 'Configuration Modification'}
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
                             onClick={async (e) => {
                               e.stopPropagation()
                               showWorkspaceToast('Restoring state...', { type: 'loading' })
                               try {
                                 const response: any = await apiFetch(`/api/v1/monitoring/${item.id}/restore/${h.id}`, { method: 'POST' })
                                 if (response?.ok === false) throw new Error(await response.text())
                                 queryClient.invalidateQueries({ queryKey: ['monitoring-items'] })
                                 queryClient.invalidateQueries({ queryKey: ['monitoring-history', item.id] })
                                 showWorkspaceToast('Restored successfully', { type: 'success' })
                               } catch {
                                 showWorkspaceToast('Restore failed', { type: 'error' })
                               }
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
                    <WorkspaceEmptyState icon={<HistoryIcon size={32} />} title="No Diff Data" description="Select two versions to compare or pick a version to see changes from its predecessor." />
                 ) : null}
              </div>
           </>
          }
      />
    </WorkspaceModal>
  )
}
