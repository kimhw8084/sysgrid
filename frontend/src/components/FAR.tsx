import React, { useState, useMemo, useEffect } from 'react'
import {
  WorkspaceCollapsibleHeader,
  WorkspaceEmptyState,
  WorkspaceFieldError,
  WorkspaceFieldLabel,
  WorkspaceSectionBadge,
  WorkspaceSectionCard,
  WorkspaceSelectField,
  WorkspaceStickyIdentityBar,
  WorkspaceValidationBanner,
  getWorkspaceInputClass,
} from './shared/OperationalWorkspacePrimitives'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Plus, Search, Trash2, Edit2, Info, 
  ShieldAlert, Zap, Save, X, PlusCircle, User,
  RefreshCcw, AlertTriangle, Lightbulb, ShieldCheck, 
  Activity, Server, FileText, Clipboard, ArrowRight, Shield, 
  CheckCircle2, ChevronRight, LayoutGrid, List, Sliders, Eye,
  Target, AlertCircle, Settings, Layers, Box, Link2, ExternalLink,
  ChevronLeft, Book, Download, Copy, Terminal, Check, HelpCircle, EyeOff, MoreVertical, Monitor, Upload, Clock, Undo2
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '../api/apiClient'
import { toast } from 'react-hot-toast'
import { formatAppDate } from '../utils/dateUtils'
import { OperationalImportModal } from './shared/OperationalImportModal'
import { downloadOperationalImportFile } from './shared/OperationalImportExport'
import { StatusPill } from './shared/StatusPill'
import { ConfigRegistryModal } from './ConfigRegistry'
import { MonitoringForm } from './monitoring/MonitoringForm'
import { ProjectForm } from './Projects'
import { RootCauseFormModal, MitigationFormModal, PreventionFormModal, ResolutionManagerModal } from './shared/FARModals'
import { EnhancedRcaDetails } from './Research'
import { OperationalWorkspaceShell } from './shared/OperationalWorkspaceShells'
import { FARFilterBar, FAROperationalGridView } from './FARGoldenWorkspaceInteraction'
import {
  buildFarDelimitedText,
  createDefaultFarQuickFilters,
  filterFarModes,
  type FarGroupBy,
  type FarQuickFilters,
} from './FAR.workspaceModel'
import { OperationalBulkPreviewModal } from './shared/OperationalBulkPreviewModal'
import { useOperationalBulkWorkflow } from './shared/useOperationalBulkWorkflow'
import { HeaderScopeSwitch, ToolbarButton, ToolbarGroup, ToolbarIconButton, ToolbarSearch } from './shared/LayoutPrimitives'
import { FARVersionHistory } from './FARVersionHistory'
import { useFARGoldenWorkspaceControls } from './FARGoldenWorkspaceControls'
import type { FarLifecycleScope } from './FAR.workspaceState'
import { buildFarLifecycleWorkspaceTransition } from './FAR.lifecycleWorkspace'
import type { FarRestorationDossierContext } from './FAR.restoration'
import { OPERATIONAL_GRID_WIDTHS } from './shared/OperationalGridContract'
import {
  createOperationalActionColumnDefinition,
  createOperationalUtilityColumns,
  renderOperationalActionButtons,
} from './shared/OperationalGridStandard'
import {
  createOperationalGoldenTextColumn,
  createOperationalMetricBadgeColumn,
  getOperationalContentAwareWidth,
} from './shared/OperationalGoldenColumns'
import { useFarOperatorIntelligence } from './FAR.operatorIntelligence'
import { WorkspaceModal } from './shared/WorkspaceModal'
import { useOperationalFormDirty } from './shared/OperationalFormContracts'
import { parseOperationalApiValidationError } from './shared/OperationalFieldValidation'
import {
  buildFarAuthoringDraft,
  buildFarAuthoringErrors,
  changeFarAuthoringSystem,
  getFarAuthoringFirstErrorTab,
  getFarAuthoringTabErrorCounts,
  sanitizeFarAuthoringPayload,
  type FarAuthoringTab,
} from './FAR.authoringModel'
import { buildFarDossierSearchParams, getFarDeepLinkNotice, getFarGridDataState, parseFarDossierTab, resolveFarDeepLink } from './FAR.deepLink'
import DataStatusPill, { DataDiagnosticModal } from './shared/OperationalDataStatus'
import { buildFarRegistryDiagnosticDetail } from './FAR.diagnostics'
import {
  buildFarOperatorLoopReceipt,
  buildFarOperatorLoopSnapshot,
  shouldDismissFarOperatorLoop,
  startFarOperatorLoop,
  type FarOperatorSurface,
  type FarOperatorLoopSession,
} from './FAR.operatorLoop'
import { FARDossierShell } from './FAR.dossier'
import {
  buildFarLifecycleRequest,
  buildFarLifecycleRevertPayload,
  getFarLifecycleEndpoint,
  getFarLifecycleRevertAction,
  isFarLifecycleAction,
} from './FAR.lifecycleVocabulary'
import {
  buildFarBulkScorePreview,
  buildFarBulkScoreRequest,
  buildFarBulkScoreRevertPayload,
  type FarBulkScoreField,
} from './FAR.bulkScore'
import {
  FAR_MATURITY_LEVELS,
  createFarAnalyticalColumns,
  getFarMaturityLevel,
} from './FAR.gridColumns'
import {
  FAR_CONTEXT_DETAIL_TABS,
  type FarDossierTab,
} from './FAR.rowActions'
import {
  readFarMutationFailureMessage,
  withFarExpectedVersion,
} from './FAR.mutationIntegrity'
import { buildFarContextMutationRequest } from './FAR.causalIntegrity'

import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'

const FAR_IMPORT_PROFILE = 'far_records'
const FAR_IMPORT_SCHEMA_VERSION = '2026-08-far-v1'
const FAR_SNAPSHOT_FILENAME_PATTERN = /^SYSGRID_far_records_Snapshot\.csv$/

// --- Types ---
interface FailureMode {
  id: number
  system_name: string
  failure_type: string
  title: string
  effect: string
  severity: number
  occurrence: number
  detection: number
  rpn: number
  status: string
  affected_assets: any[]
  causes: any[]
  mitigations: any[]
  prevention_actions: any[]
}

const FAILURE_TYPES = [
  { value: 'Design', label: 'Design' },
  { value: 'Process', label: 'Process' },
  { value: 'Hardware', label: 'Hardware' },
  { value: 'Software', label: 'Software' },
  { value: 'Network', label: 'Network' },
  { value: 'Human', label: 'Human' },
  { value: 'Environment', label: 'Environment' },
]

// --- Constants for Guided Scoring ---
const SEVERITY_LEVELS = [
  { value: 10, label: 'HAZARDOUS (NO WARNING)', desc: 'Safety issue or total compliance failure. Extreme risk to the enterprise.' },
  { value: 9, label: 'HAZARDOUS (WITH WARNING)', desc: 'Potential safety issue or major compliance risk. High probability of legal impact.' },
  { value: 8, label: 'VERY HIGH', desc: 'System total failure, major data loss, no workaround exists. Business critical.' },
  { value: 7, label: 'HIGH', desc: 'System operational but major performance impact. High user dissatisfaction.' },
  { value: 6, label: 'MODERATE', desc: 'Significant impact on primary function, but workaround exists. Noticeable degradation.' },
  { value: 5, label: 'LOW', desc: 'Minor impact on performance or usability. Minimal business disruption.' },
  { value: 4, label: 'VERY LOW', desc: 'Noticeable impact but system remains functional. Easily manageable.' },
  { value: 3, label: 'MINOR', desc: 'Slight annoyance to users. No functional impairment.' },
  { value: 2, label: 'VERY MINOR', desc: 'Hardly noticeable impact. Cosmetic or trace-level issue.' },
  { value: 1, label: 'NONE', desc: 'No discernible effect on system or user experience.' },
]

const OCCURRENCE_LEVELS = [
  { value: 10, label: 'CERTAIN', desc: 'Inevitable. Occurs multiple times per day. Constant risk exposure.' },
  { value: 9, label: 'VERY HIGH', desc: 'Likely to occur daily. High-frequency failure profile.' },
  { value: 8, label: 'HIGH', desc: 'Likely to occur weekly. Recurring operational disruption.' },
  { value: 7, label: 'MODERATELY HIGH', desc: 'Occurs once or twice per month. Periodic impact.' },
  { value: 6, label: 'MODERATE', desc: 'Occurs once every few months. Occasional risk.' },
  { value: 5, label: 'LOW', desc: 'Occurs once or twice per year. Infrequent failure mode.' },
  { value: 4, label: 'VERY LOW', desc: 'Occurs once every few years. Rare occurrence.' },
  { value: 3, label: 'REMOTE', desc: 'Unlikely but possible. Minimal historical evidence.' },
  { value: 2, label: 'VERY REMOTE', desc: 'Extremely unlikely. Speculative failure mode.' },
  { value: 1, label: 'NEARLY IMPOSSIBLE', desc: 'Never expected to occur. Theoretical risk only.' },
]

const DETECTION_LEVELS = [
  { value: 10, label: 'IMPOSSIBLE', desc: 'Zero monitoring. Discovered only via total system blackout or user report.' },
  { value: 9, label: 'VERY REMOTE', desc: 'Visible only after catastrophic failure has completed. Post-mortem discovery.' },
  { value: 8, label: 'REMOTE', desc: 'Requires manual log inspection or audit. High latency in visibility.' },
  { value: 7, label: 'VERY LOW', desc: 'Alerts exist but are buried in noise. Easily missed by NOC/SOC.' },
  { value: 6, label: 'LOW', desc: 'Standard monitoring, but delayed or inconsistent. Unreliable visibility.' },
  { value: 5, label: 'MODERATE', desc: 'Reliable alerts exist but require human triage for verification.' },
  { value: 4, label: 'MODERATELY HIGH', desc: 'Proactive alerts with clear root cause identification.' },
  { value: 3, label: 'HIGH', desc: 'Real-time dashboarding and active, automated health checks.' },
  { value: 2, label: 'VERY HIGH', desc: 'Automated self-healing or failsafe systems. Immediate notification.' },
  { value: 1, label: 'ALMOST CERTAIN', desc: 'Predictive analytics prevents failure before it manifests.' },
]

async function fetchFarList(path: string) {
  const response = await apiFetch(path)
  if (!response.ok) throw new Error(await response.text())
  const payload = await response.json()
  if (!Array.isArray(payload)) throw new Error(`Expected a list response from ${path}`)
  return payload
}

const METRIC_DEFINITIONS: any = {
  SRI: {
    title: "System Reliability Index (SRI)",
    formula: "SRI = 100 × [1 - (RPN_avg / 500)]",
    description: "Represents the aggregate health of the infrastructure's risk profile. A score of 100 signifies zero documented risk exposure, while lower scores indicate high-criticality failure modes with frequent occurrence or visibility gaps."
  },
  RiskDensity: {
    title: "Risk Density Profile",
    formula: "D_risk = Σ RPN / Σ Assets_affected",
    description: "Measures risk concentration across assets. High density indicates that a small number of physical or logical assets are bearing a disproportionate amount of system-wide failure risk."
  },
  MitigationRatio: {
    title: "Global Mitigation Coverage",
    formula: "M_cov = (N_mitigated / N_total) × 100",
    description: "Evaluates the breadth of the defense-in-depth strategy. Measures the percentage of failure modes that have at least one verified Monitoring or temporary Workaround protocol established."
  },
  AvgSeverity: {
    title: "Mean Failure Criticality",
    formula: "RPN_avg = (1 / N) Σ RPN_i",
    description: "The average Risk Priority Number across the entire registry. Used to monitor long-term trends in the inherent severity of documented risks, independent of the number of entries."
  }
}

function MetricHelpModal({ metric, onClose }: { metric: string | null, onClose: () => void }) {
  if (!metric || !METRIC_DEFINITIONS[metric]) return null;
  const def = METRIC_DEFINITIONS[metric];
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-md p-10">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-full max-w-md p-10 rounded-lg border border-blue-500/30 space-y-6">
        <div className="flex items-center justify-between border-b border-white/5 pb-4">
          <h2 className="text-xl font-bold uppercase tracking-tighter text-blue-400  flex items-center space-x-3">
             <Info size={24}/> <span>{def.title}</span>
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><X size={20}/></button>
        </div>
        <div className="space-y-4">
          <div>
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-1">Mathematical Derivation</p>
            <div className="bg-black/40 border border-white/5 rounded-lg p-6 font-serif text-lg text-blue-300 text-center shadow-inner">
               {def.formula}
            </div>
          </div>
          <div>
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-1">Functional Definition</p>
            <p className="text-[13px] text-slate-300 leading-relaxed font-bold tracking-tight ">
              {def.description}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="w-full py-3 bg-blue-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest active:scale-95 transition-all shadow-lg shadow-blue-500/20">Acknowledge</button>
      </motion.div>
    </div>
  )
}

export default function FAR() {
  const [operatorLoopSession, setOperatorLoopSession] = useState<FarOperatorLoopSession | null>(null)
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const gridRef = React.useRef<any>(null)
  const lastDeepLinkedModeIdRef = React.useRef<number | null>(null)
  
  const idParam = searchParams.get('id')
  const tabParam = searchParams.get('tab')
  const requestedDossierTab = useMemo(() => parseFarDossierTab(tabParam), [tabParam])

  const [showWizard, setShowWizard] = useState(false)
  const [selectedModeId, setSelectedModeId] = useState<number | null>(null)
  const [selectedDetailTab, setSelectedDetailTab] = useState<FarDossierTab>(FAR_CONTEXT_DETAIL_TABS.detail)
  const [searchTerm, setSearchTerm] = useState('')
  const [groupBy, setGroupBy] = useState<FarGroupBy>('raw')
  const [quickFilters, setQuickFilters] = useState<FarQuickFilters>(() => createDefaultFarQuickFilters())
  const [showMaturityHelp, setShowMaturityHelp] = useState(false)
  const [showRpnHelp, setShowRpnHelp] = useState(false)
  const [activeMetricHelp, setActiveMetricHelp] = useState<string | null>(null)

  const [incidentListModal, setIncidentListModal] = useState<{show: boolean, rcas: any[]}>({ show: false, rcas: [] })
  const [selectedRcaDetail, setSelectedRcaDetail] = useState<any>(null)
  const [resolutionManagerModal, setResolutionManagerModal] = useState<{show: boolean, cause: any}>({ show: false, cause: null })

  // Column Picker & Style Lab State (Mirrored from Assets)
  const [fontSize, setFontSize] = useState(11)
  const [rowDensity, setRowDensity] = useState(8)
  const [showStyleLab, setShowStyleLab] = useState(false)
  const [showFilterBar, setShowFilterBar] = useState(true)
  const [showInsights, setShowInsights] = useState(false)
  const [showColumnPicker, setShowColumnPicker] = useState(false)
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([])
  const [showConfig, setShowConfig] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [lifecycleScope, setLifecycleScope] = useState<'active' | 'archived'>('active')
  const operatorLoopSnapshotRef = React.useRef<ReturnType<typeof buildFarOperatorLoopSnapshot> | null>(null)
  const lastOperatorLoopReceiptRef = React.useRef<ReturnType<typeof buildFarOperatorLoopReceipt> | null>(null)
  
  const [bkmGuidanceModal, setBkmGuidanceModal] = useState<{show: boolean, cause: any}>({ show: false, cause: null })

  const operatorLoopSnapshot = useMemo(() => buildFarOperatorLoopSnapshot({
    lifecycleScope,
    groupBy,
    searchTerm,
    quickFilters,
    selectedIds,
    selectedModeId,
    selectedDetailTab,
    hiddenColumns,
    fontSize,
    rowDensity,
    routeQuery: searchParams.toString(),
  }), [
    lifecycleScope,
    groupBy,
    searchTerm,
    quickFilters,
    selectedIds,
    selectedModeId,
    selectedDetailTab,
    hiddenColumns,
    fontSize,
    rowDensity,
    searchParams,
  ])
  operatorLoopSnapshotRef.current = operatorLoopSnapshot

  const beginFarOperatorSurface = React.useCallback((surface: FarOperatorSurface) => {
    const session = startFarOperatorLoop(surface, operatorLoopSnapshotRef.current || operatorLoopSnapshot)
    setOperatorLoopSession(session)
    return session
  }, [operatorLoopSnapshot])

  const openFarOperatorSurface = React.useCallback((surface: Exclude<FarOperatorSurface, 'round_trip_export'>) => {
    beginFarOperatorSurface(surface)
  }, [beginFarOperatorSurface])

  const closeFarOperatorSurface = React.useCallback((surface: FarOperatorSurface) => {
    setOperatorLoopSession((current) => {
      if (!current || current.surface !== surface) return current
      const latest = operatorLoopSnapshotRef.current || current.snapshot
      lastOperatorLoopReceiptRef.current = buildFarOperatorLoopReceipt(current, latest)
      return null
    })
  }, [])

  useEffect(() => {
    setOperatorLoopSession((current) => {
      if (!current || !shouldDismissFarOperatorLoop(current, operatorLoopSnapshot)) return current
      lastOperatorLoopReceiptRef.current = buildFarOperatorLoopReceipt(current, operatorLoopSnapshot)
      return null
    })
  }, [operatorLoopSnapshot])

  const syncFarDossierLink = React.useCallback((
    targetId: number | null,
    tab: FarDossierTab = FAR_CONTEXT_DETAIL_TABS.detail,
    replace = false,
  ) => {
    setSearchParams(buildFarDossierSearchParams(searchParams, targetId, tab), { replace })
  }, [searchParams, setSearchParams])

  const openFarDossier = React.useCallback((
    targetId: number,
    tab: FarDossierTab = FAR_CONTEXT_DETAIL_TABS.detail,
  ) => {
    setSelectedDetailTab(tab)
    setSelectedModeId(targetId)
    syncFarDossierLink(targetId, tab)
  }, [syncFarDossierLink])

  const closeFarDossier = React.useCallback((replace = false) => {
    lastDeepLinkedModeIdRef.current = null
    setSelectedModeId(null)
    setSelectedDetailTab(FAR_CONTEXT_DETAIL_TABS.detail)
    syncFarDossierLink(null, FAR_CONTEXT_DETAIL_TABS.detail, replace)
  }, [syncFarDossierLink])

  const transitionFarLifecycleScope = React.useCallback((
    nextScope: FarLifecycleScope,
    preserveExplicitDossierLink = false,
  ) => {
    const transition = buildFarLifecycleWorkspaceTransition(nextScope, preserveExplicitDossierLink)
    if (transition.applyLifecycleScope) setLifecycleScope(transition.lifecycleScope)
    if (transition.clearSelection) {
      setSelectedIds([])
      gridRef.current?.api?.deselectAll?.()
    }
    if (transition.clearDossier) closeFarDossier(true)
  }, [closeFarDossier])

  const restoreFarLifecycleScope = React.useCallback((nextScope: FarLifecycleScope) => {
    transitionFarLifecycleScope(nextScope, Boolean(idParam))
  }, [idParam, transitionFarLifecycleScope])

  // Queries
  const { data: modes, isLoading: modesLoading, isError: modesError, error: modesQueryError } = useQuery({
    queryKey: ['far', 'modes'], 
    queryFn: () => fetchFarList('/api/v1/far/modes?include_deleted=true')
  })
  const activeModes = useMemo(
    () => (modes || []).filter((mode: any) => !mode.is_deleted),
    [modes],
  )
  const lifecycleModes = useMemo(
    () => (modes || []).filter((mode: any) => lifecycleScope === 'archived' ? Boolean(mode.is_deleted) : !mode.is_deleted),
    [lifecycleScope, modes],
  )
  const lifecycleCounts = useMemo(() => ({
    active: (modes || []).filter((mode: any) => !mode.is_deleted).length,
    archived: (modes || []).filter((mode: any) => Boolean(mode.is_deleted)).length,
  }), [modes])
  const deepLinkResolution = useMemo(() => resolveFarDeepLink(idParam, modes), [idParam, modes])
  const deepLinkNotice = useMemo(() => getFarDeepLinkNotice(deepLinkResolution), [deepLinkResolution])
  const restorationDossier = useMemo<FarRestorationDossierContext | null>(() => {
    if (deepLinkResolution.kind !== 'resolved') return null
    return {
      targetId: deepLinkResolution.targetId,
      lifecycleScope: deepLinkResolution.lifecycleScope,
      title: String(deepLinkResolution.mode.title || ''),
      tab: requestedDossierTab,
    }
  }, [deepLinkResolution, requestedDossierTab])
  const farRegistryDiagnosticDetail = useMemo(
    () => buildFarRegistryDiagnosticDetail(modesQueryError),
    [modesQueryError],
  )

  useEffect(() => {
    if (operatorLoopSession?.surface !== 'diagnostics' || modesError) return
    closeFarOperatorSurface('diagnostics')
  }, [closeFarOperatorSurface, modesError, operatorLoopSession?.surface])

  useEffect(() => {
    if (deepLinkResolution.kind !== 'resolved') {
      if (deepLinkResolution.kind === 'invalid' || deepLinkResolution.kind === 'unavailable') {
        lastDeepLinkedModeIdRef.current = null
        setSelectedModeId(null)
        setSelectedDetailTab(FAR_CONTEXT_DETAIL_TABS.detail)
      } else if (deepLinkResolution.kind === 'absent' && lastDeepLinkedModeIdRef.current !== null) {
        const previousDeepLinkId = lastDeepLinkedModeIdRef.current
        lastDeepLinkedModeIdRef.current = null
        setSelectedModeId((current) => current === previousDeepLinkId ? null : current)
        setSelectedDetailTab(FAR_CONTEXT_DETAIL_TABS.detail)
      }
      return
    }
    const { targetId, lifecycleScope: targetLifecycleScope } = deepLinkResolution

    lastDeepLinkedModeIdRef.current = targetId
    setLifecycleScope(targetLifecycleScope)
    setSelectedDetailTab(requestedDossierTab)
    setSelectedModeId(targetId)
  }, [deepLinkResolution, requestedDossierTab])

  const { data: options } = useQuery({ queryKey: ['settings-options'], queryFn: async () => (await apiFetch('/api/v1/settings/options')).json() })
  const availableSystems = useMemo(() => Array.from(new Set([
    ...(options?.filter((o: any) => o.category === 'LogicalSystem').map((s: any) => String(s.value || '')).filter(Boolean) || []),
    ...lifecycleModes.map((mode: any) => String(mode.system_name || '')).filter(Boolean),
  ])).sort(), [lifecycleModes, options])
  const availableFailureTypes = useMemo(() => Array.from(new Set([
    ...FAILURE_TYPES.map((type) => type.value),
    ...lifecycleModes.map((mode: any) => String(mode.failure_type || '')).filter(Boolean),
  ])).sort(), [lifecycleModes])
  const availableStatuses = useMemo(() => Array.from(new Set(
    lifecycleModes.map((mode: any) => String(mode.status || '')).filter(Boolean)
  )).sort(), [lifecycleModes])

  const farDefaultWidthsRef = React.useRef<{
    system_name: number
    failure_type: number
    title: number
    created_by_user_id: number
  } | null>(null)
  if (!farDefaultWidthsRef.current && modes !== undefined) {
    const loadedModes = activeModes
    farDefaultWidthsRef.current = {
      system_name: getOperationalContentAwareWidth({
        headerName: 'System', values: loadedModes.map((mode: any) => mode.system_name), minWidth: 120, fallbackWidth: 132, maxDefaultWidth: 220,
      }),
      failure_type: getOperationalContentAwareWidth({
        headerName: 'Type', values: loadedModes.map((mode: any) => mode.failure_type), minWidth: 96, fallbackWidth: 108, maxDefaultWidth: 160,
      }),
      title: getOperationalContentAwareWidth({
        headerName: 'Failure Mode', values: loadedModes.map((mode: any) => mode.title), minWidth: 200, fallbackWidth: 260, maxDefaultWidth: 360,
      }),
      created_by_user_id: getOperationalContentAwareWidth({
        headerName: 'Created By', values: loadedModes.map((mode: any) => mode.created_by_user_id || 'SYSTEM'), minWidth: 128, fallbackWidth: 136, maxDefaultWidth: 220,
      }),
    }
  }
  const farDefaultWidths = farDefaultWidthsRef.current || {
    system_name: 132,
    failure_type: 108,
    title: 260,
    created_by_user_id: 136,
  }

  const filteredModes = useMemo(
    () => filterFarModes(lifecycleModes, searchTerm, quickFilters),
    [lifecycleModes, quickFilters, searchTerm]
  )
  const operatorIntelligence = useFarOperatorIntelligence({
    rows: filteredModes,
    groupBy,
    searchTerm,
    quickFilters,
    onOpenDetail: (mode) => {
      if (!mode?.id) return
      openFarDossier(Number(mode.id))
    },
    gridRef,
  })
  const displayedModes = operatorIntelligence.rows
  const selectionScopeKey = operatorIntelligence.selectionScopeKey

  const selectedMode = useMemo(() => modes?.find((m: any) => m.id === selectedModeId), [modes, selectedModeId])

  const handleExportCSV = () => {
    if (groupBy === 'raw' && gridRef.current?.api) {
      gridRef.current.api.exportDataAsCsv({
        fileName: `SysGrid_FAR_${new Date().toISOString().split('T')[0]}.csv`,
        allColumns: false,
        onlySelected: false,
      })
      return
    }
    const blob = new Blob([buildFarDelimitedText(filteredModes, ',')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `SysGrid_FAR_${new Date().toISOString().split('T')[0]}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleExportRoundTrip = async () => {
    const exportSession = beginFarOperatorSurface('round_trip_export')
    try {
      const result = await downloadOperationalImportFile({
        tableName: FAR_IMPORT_PROFILE,
        kind: 'snapshot',
        expectedProfile: FAR_IMPORT_PROFILE,
        requireSchemaHeaders: true,
        fallbackFileName: 'SYSGRID_far_records_Snapshot.csv',
        metadataContract: {
          manifestEndpoint: `/api/v1/import/snapshot/${FAR_IMPORT_PROFILE}/manifest`,
          expectedProfile: FAR_IMPORT_PROFILE,
          expectedSchemaVersion: FAR_IMPORT_SCHEMA_VERSION,
          expectedFilenamePattern: FAR_SNAPSHOT_FILENAME_PATTERN,
          expectedContentType: 'text/csv',
        },
      })
      toast.success(`FAR round-trip snapshot exported (${result.schemaVersion || FAR_IMPORT_SCHEMA_VERSION})`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to export FAR round-trip snapshot')
    } finally {
      const latest = operatorLoopSnapshotRef.current || exportSession.snapshot
      lastOperatorLoopReceiptRef.current = buildFarOperatorLoopReceipt(exportSession, latest)
      setOperatorLoopSession((current) => current === exportSession ? null : current)
    }
  }

  const handleCopyToClipboard = () => {
    let csvData = ''
    if (groupBy === 'raw' && gridRef.current?.api) {
      csvData = gridRef.current.api.getDataAsCsv?.({
        allColumns: false,
        onlySelected: true,
        suppressQuotes: true,
      }) || ''
    } else {
      const selected = new Set(selectedIds.map(Number))
      csvData = buildFarDelimitedText(
        (modes || []).filter((mode: any) => selected.has(Number(mode.id))),
        '\t',
      )
    }
    if (!csvData || selectedIds.length === 0) return
    navigator.clipboard.writeText(csvData)
      .then(() => toast.success('Selected failure vectors copied to clipboard'))
      .catch(() => toast.error('Failed to copy selected failure vectors'))
  }

  const {
    bulkMutation,
    bulkOperationPreview,
    requestBulkPreview,
    setBulkOperationPreview,
  } = useOperationalBulkWorkflow<any>({
    selectedIds,
    fieldLabels: {
      severity: 'Severity',
      occurrence: 'Occurrence',
      detection: 'Detection',
    },
    selectionErrorMessage: 'Select at least one failure vector.',
    previewErrorMessage: 'Unable to prepare the FAR bulk preview.',
    executionErrorMessage: 'Unable to update the selected failure vectors.',
    revertErrorMessage: 'Unable to revert the FAR bulk change.',
    getSnapshots: (ids) => (modes || []).filter((mode: any) => ids.includes(Number(mode.id))),
    previewRequest: async ({ action, ids, payload }) => {
      if (action === 'update') {
        return buildFarBulkScorePreview(ids, modes || [], payload)
      }
      if (!isFarLifecycleAction(action)) throw new Error('Unsupported FAR lifecycle action.')
      const current = new Map((modes || []).map((mode: any) => [Number(mode.id), mode]))
      const changedIds = ids.filter((id) => {
        const mode = current.get(id)
        if (!mode) return false
        return action === 'restore' ? Boolean(mode.is_deleted) : !mode.is_deleted
      })
      const changed = new Set(changedIds)
      const unchangedIds = ids.filter((id) => current.has(id) && !changed.has(id))
      const missingIds = ids.filter((id) => !current.has(id))
      return {
        action,
        selected_count: ids.length,
        matched_count: changedIds.length + unchangedIds.length,
        changed_count: changedIds.length,
        unchanged_count: unchangedIds.length,
        blocked_count: 0,
        missing_count: missingIds.length,
        changed_ids: changedIds,
        unchanged_ids: unchangedIds,
        missing_ids: missingIds,
        blockers: [],
        can_execute: changedIds.length > 0 && missingIds.length === 0,
      }
    },
    executeRequest: async ({ action, ids, payload }) => {
      operatorIntelligence.beginPending(ids)
      try {
        if (action === 'update') {
          const request = buildFarBulkScoreRequest(ids, modes || [], payload)
          const res = await apiFetch('/api/v1/far/modes/bulk-score', {
            method: 'POST',
            body: JSON.stringify(request),
          })
          if (!res.ok) throw new Error(await res.text())
          const result = await res.json()
          return {
            ...result,
            changed_count: Number(result?.changed_count || 0),
            unchanged_count: Number(result?.unchanged_count || 0),
            changed_ids: Array.isArray(result?.changed_ids) ? result.changed_ids.map(Number) : [],
          }
        }

        if (!isFarLifecycleAction(action)) throw new Error('Unsupported FAR lifecycle action.')
        const endpoint = getFarLifecycleEndpoint(action)
        const request = buildFarLifecycleRequest(ids, modes || [], payload?.expected_versions)
        const res = await apiFetch(endpoint, {
          method: 'POST',
          body: JSON.stringify(request),
        })
        if (!res.ok) throw new Error(await readFarMutationFailureMessage(res))
        const result = await res.json()
        const changedCount = Number(result?.changed_count ?? result?.count ?? 0)
        return {
          ...result,
          changed_count: changedCount,
          unchanged_count: Math.max(0, ids.length - changedCount),
          changed_ids: Array.isArray(result?.changed_ids) ? result.changed_ids.map(Number) : [],
        }
      } finally {
        operatorIntelligence.endPending(ids)
      }
    },
    refresh: () => queryClient.invalidateQueries({ queryKey: ['far', 'modes'] }),
    buildRevertRequest: ({ action, changedIds, changedSnapshots, payload, result }) => {
      if (action === 'update') {
        const revertPayload = buildFarBulkScoreRevertPayload(changedSnapshots, payload, result?.versions)
        return revertPayload ? { action: 'update', ids: changedIds, payload: revertPayload } : null
      }
      if (action === 'archive' || action === 'restore') {
        const revertPayload = buildFarLifecycleRevertPayload(changedIds, result?.versions)
        return revertPayload
          ? { action: getFarLifecycleRevertAction(action), ids: changedIds, payload: revertPayload }
          : null
      }
      return null
    },
    onExecutionSuccess: () => {
      setSelectedIds([])
      gridRef.current?.api?.deselectAll?.()
    },
  })

  // AgGrid Defs (High Density)
  const columnDefs = useMemo(() => [
    ...createOperationalUtilityColumns(operatorIntelligence.utilityColumnsConfig),
    createOperationalGoldenTextColumn({
      field: 'system_name',
      headerName: 'System',
      width: farDefaultWidths.system_name,
      minWidth: 120,
      filter: 'agTextColumnFilter',
      tooltipField: 'system_name',
      valueClassName: 'operational-grid-text font-bold text-rose-400 uppercase',
      hide: hiddenColumns.includes('system_name'),
    }),
    createOperationalGoldenTextColumn({
      field: 'failure_type',
      headerName: 'Type',
      width: farDefaultWidths.failure_type,
      minWidth: 96,
      filter: 'agTextColumnFilter',
      tooltipField: 'failure_type',
      valueClassName: 'operational-grid-text font-bold text-slate-400 uppercase',
      hide: hiddenColumns.includes('failure_type'),
    }),
    createOperationalGoldenTextColumn({
      field: 'title',
      headerName: 'Failure Mode',
      width: farDefaultWidths.title,
      minWidth: 200,
      filter: 'agTextColumnFilter',
      tooltipField: 'title',
      valueClassName: 'operational-grid-text font-bold uppercase text-[var(--text-primary)]',
      alignment: 'left',
      hide: hiddenColumns.includes('title'),
    }),
    createOperationalMetricBadgeColumn({
      field: 'severity', headerName: 'S', width: 72, minWidth: 68, fontSize,
      resolveTone: (value) => value >= 8 ? 'critical' : value >= 5 ? 'warning' : 'healthy',
      onActivate: () => setShowRpnHelp(true),
      title: 'RPN Definition Matrix',
      hide: hiddenColumns.includes('severity'),
    }),
    createOperationalMetricBadgeColumn({
      field: 'occurrence', headerName: 'O', width: 72, minWidth: 68, fontSize,
      resolveTone: (value) => value >= 7 ? 'critical' : value >= 4 ? 'warning' : 'healthy',
      onActivate: () => setShowRpnHelp(true),
      title: 'RPN Definition Matrix',
      hide: hiddenColumns.includes('occurrence'),
    }),
    createOperationalMetricBadgeColumn({
      field: 'detection', headerName: 'D', width: 72, minWidth: 68, fontSize,
      resolveTone: (value) => value >= 7 ? 'critical' : value >= 4 ? 'warning' : 'healthy',
      onActivate: () => setShowRpnHelp(true),
      title: 'RPN Definition Matrix',
      hide: hiddenColumns.includes('detection'),
    }),
    createOperationalMetricBadgeColumn({
      field: 'rpn', headerName: 'RPN', width: 84, minWidth: 80, fontSize,
      resolveTone: (value) => value >= 150 ? 'critical' : value >= 80 ? 'warning' : 'healthy',
      onActivate: () => setShowRpnHelp(true),
      title: 'RPN Definition Matrix',
      hide: hiddenColumns.includes('rpn'),
    }),
    ...createFarAnalyticalColumns({
      fontSize,
      hiddenColumns,
      onOpenMaturity: () => setShowMaturityHelp(true),
      onOpenIncidents: (rcas) => setIncidentListModal({ show: true, rcas }),
    }),
    createOperationalGoldenTextColumn({
      field: 'created_by_user_id',
      headerName: 'Created By',
      width: farDefaultWidths.created_by_user_id,
      minWidth: 128,
      filter: true,
      emptyValue: 'SYSTEM',
      tooltipValueGetter: (value) => String(value || 'SYSTEM'),
      valueClassName: 'operational-grid-text font-bold text-blue-400 uppercase',
      hide: hiddenColumns.includes('created_by_user_id'),
    }),
    createOperationalActionColumnDefinition({
      width: OPERATIONAL_GRID_WIDTHS.standardAction,
      renderActions: (row: any) => renderOperationalActionButtons([
        <button key="detail" onClick={() => { if (!row?.id) return; openFarDossier(Number(row.id)) }} title="Matrix Detail" className="text-blue-400 hover:text-blue-200 transition-all"><Eye size={14}/></button>,
        ...(row?.is_deleted ? [
          <button
            key="restore"
            onClick={() => row?.id && requestBulkPreview({ action: 'restore', ids: [row.id] })}
            title="Restore failure vector"
            className="text-emerald-400 hover:text-emerald-200 transition-all"
          ><Undo2 size={14}/></button>,
        ] : [
          <button
            key="edit"
            onClick={() => { if (!row?.id) return; setSelectedModeId(row.id); setShowWizard(true) }}
            title="Edit Matrix"
            className="text-amber-400 hover:text-amber-200 transition-all"
          ><Edit2 size={14}/></button>,
          <button
            key="retire"
            onClick={() => row?.id && requestBulkPreview({ action: 'archive', ids: [row.id] })}
            title="Retire failure vector"
            className="text-rose-400 hover:text-rose-200 transition-all"
          ><Trash2 size={14}/></button>,
        ]),
      ]),
    })
  ], [farDefaultWidths, fontSize, hiddenColumns, openFarDossier, operatorIntelligence.utilityColumnsConfig, requestBulkPreview]) as any

  // Advanced Metrics Calculation
  const metrics = useMemo(() => {
    const activeModes = filteredModes || []
    const totalRPN = activeModes.reduce((acc: number, m: any) => acc + (m.rpn || 0), 0)
    const avgRPN = activeModes.length ? totalRPN / activeModes.length : 0
    const sri = Math.max(0, Math.round(100 * (1 - avgRPN / 500))) 
    
    const maturityDist = activeModes.reduce((acc: any, mode: any) => {
      const lv = getFarMaturityLevel(mode);
      acc[lv] = (acc[lv] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    const mitigated = activeModes.filter((m: any) => (m.mitigations?.length || 0) > 0).length
    const mitRatio = activeModes.length ? Math.round((mitigated / activeModes.length) * 100) : 0
    const totalAssets = activeModes.reduce((acc: number, m: any) => acc + (m.affected_assets?.length || 0), 0)
    const riskDensity = totalAssets ? (totalRPN / totalAssets).toFixed(1) : '0.0'
    return { sri, mitRatio, riskDensity, avgRPN: Math.round(avgRPN), maturityDist }
  }, [filteredModes])

  const goldenWorkspace = useFARGoldenWorkspaceControls({
    gridRef,
    modes: lifecycleModes,
    selectedIds: lifecycleScope === 'active' ? selectedIds : [],
    readOnly: lifecycleScope === 'archived',
    lifecycleScope,
    restorationDossier,
    onLifecycleScopeChange: restoreFarLifecycleScope,
    fontSize,
    setFontSize,
    rowDensity,
    setRowDensity,
    hiddenColumns,
    setHiddenColumns,
    searchTerm,
    setSearchTerm,
    groupBy,
    setGroupBy,
    quickFilters,
    setQuickFilters,
    showFilterBar,
    setShowFilterBar,
    showInsights,
    setShowInsights,
    columnDefs,
    onExport: handleExportCSV,
    onRoundTripExport: handleExportRoundTrip,
    onCopySelected: handleCopyToClipboard,
    onImport: () => openFarOperatorSurface('import'),
    onRetireSelected: (ids) => requestBulkPreview(ids?.length ? { action: 'archive', ids } : { action: 'archive' }),
    onBulkScoreSelected: (field: FarBulkScoreField, value: number) => requestBulkPreview({
      action: 'update',
      payload: { [field]: value },
    }),
    onAdd: () => { setSelectedModeId(null); setShowWizard(true) },
    onSettings: () => setShowConfig(true),
    onRpnHelp: () => setShowRpnHelp(true),
    onOpenDetailTab: (id, tab) => openFarDossier(id, tab),
    onOpenIncidents: (rcas) => setIncidentListModal({ show: true, rcas }),
    onEdit: (id) => { setSelectedModeId(id); setShowWizard(true) },
  })

  useEffect(() => {
    if (!goldenWorkspace.workingStateReady || deepLinkResolution.kind !== 'resolved' || !gridRef.current?.api) return
    const targetId = deepLinkResolution.targetId
    requestAnimationFrame(() => {
      gridRef.current?.api?.forEachNode?.((node: any) => {
        if (Number(node?.data?.id) !== targetId) return
        node.setSelected?.(true)
        gridRef.current?.api?.ensureNodeVisible?.(node, 'middle')
      })
    })
  }, [deepLinkResolution, goldenWorkspace.workingStateReady])

  return (
    <OperationalWorkspaceShell
      archetype="analytical"
      workspace="far"
      floatingPanels={goldenWorkspace.floatingPanels}
      header={{
        eyebrow: 'Analysis',
        title: (
          <div className="flex items-center gap-3">
            <Target size={22} className="text-rose-500" />
            <span>Failure Matrix</span>
          </div>
        ),
        subtitle: 'Reliability Knowledge Engine // FMEA Studio',
        actions: (
          <div className="flex items-center gap-2">
            {modesError && (
              <DataStatusPill
                status="error"
                errorDetail={farRegistryDiagnosticDetail}
                onClick={() => openFarOperatorSurface('diagnostics')}
              />
            )}
            <HeaderScopeSwitch
              label="Registry Scope"
              summary={`${lifecycleCounts.active} active · ${lifecycleCounts.archived} archived`}
              value={lifecycleScope}
              onChange={(next) => transitionFarLifecycleScope(next as FarLifecycleScope)}
              options={[
                { label: 'Active', value: 'active' },
                { label: 'Archived', value: 'archived' },
              ]}
            />
          </div>
        ),
      }}
      toolbarSearch={(
        <ToolbarSearch value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Scan risk vectors..." />
      )}
      toolbarControls={(
        <>
          {goldenWorkspace.toolbarControls}
          {lifecycleScope === 'archived' && selectedIds.length > 0 && (
            <ToolbarGroup>
              <ToolbarButton
                onClick={() => requestBulkPreview({ action: 'restore' })}
                title="Restore selected archived failure vectors"
              >
                <Undo2 size={14} /> Restore ({selectedIds.length})
              </ToolbarButton>
            </ToolbarGroup>
          )}
          <ToolbarGroup>
            <ToolbarButton
              active={operatorIntelligence.isIntelligenceExpanded}
              onClick={() => operatorIntelligence.setIsIntelligenceExpanded((current) => !current)}
              title={operatorIntelligence.isIntelligenceExpanded ? 'Hide activity columns' : 'Show activity columns'}
            >
              <Activity size={14} /> Signals
            </ToolbarButton>
          </ToolbarGroup>
        </>
      )}
      toolbarActions={(
        goldenWorkspace.toolbarActions
      )}
      filterChips={goldenWorkspace.filterChips}
      secondaryToolbar={showFilterBar ? (
        <FARFilterBar
          quickFilters={quickFilters}
          setQuickFilters={setQuickFilters}
          systems={availableSystems}
          failureTypes={availableFailureTypes}
          statuses={availableStatuses}
        />
      ) : null}
    >
      <AnimatePresence>
        {showStyleLab && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="shrink-0 overflow-hidden">
            <div className="bg-rose-600/10 border border-rose-500/20 rounded-lg p-4 flex items-center justify-between backdrop-blur-md">
               <div className="flex items-center space-x-12">
                  <div className="flex items-center space-x-3">
                     <Activity size={16} className="text-rose-400" />
                     <span className="text-[10px] font-bold uppercase tracking-widest text-rose-400">Display Density</span>
                  </div>
                  <div className="flex items-center space-x-6">
                     <div className="flex items-center space-x-4"><span className="text-[9px] font-bold text-slate-500 uppercase">Font Size</span><div className="flex items-center space-x-2"><input type="range" min="8" max="14" step="1" value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="w-32 accent-rose-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"/><span className="text-[10px] text-white w-4 font-bold">{fontSize}px</span></div></div>
                     <div className="flex items-center space-x-4 border-l border-white/10 pl-6"><span className="text-[9px] font-bold text-slate-500 uppercase">Row Density</span><div className="flex items-center space-x-2"><input type="range" min="4" max="24" step="2" value={rowDensity} onChange={e => setRowDensity(Number(e.target.value))} className="w-32 accent-rose-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"/><span className="text-[10px] text-white w-4 font-bold">{rowDensity}px</span></div></div>
                  </div>
               </div>
               <button onClick={() => setShowStyleLab(false)} className="text-slate-500 hover:text-white transition-colors"><X size={16}/></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showInsights && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="shrink-0 overflow-hidden">
            <div className="glass-panel rounded-lg border border-white/5 bg-[#0a0c14]/40 p-4 space-y-4">
              <div className="flex flex-wrap justify-center gap-4">
                <StatCard id="SRI" label="Reliability Index" value={metrics.sri} suffix="/100" color={metrics.sri > 70 ? "emerald" : "rose"} onHelp={() => setActiveMetricHelp("SRI")} />
                <StatCard id="RiskDensity" label="Risk Density" value={metrics.riskDensity} suffix="RPN/ASSET" color="amber" onHelp={() => setActiveMetricHelp("RiskDensity")} />
                <StatCard id="MitigationRatio" label="Mitigation Ratio" value={metrics.mitRatio} suffix="%" color="sky" onHelp={() => setActiveMetricHelp("MitigationRatio")} />
                <StatCard id="AvgSeverity" label="Avg Severity" value={metrics.avgRPN} suffix="AVG RPN" color="rose" onHelp={() => setActiveMetricHelp("AvgSeverity")} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-4 py-2">
                <div className="flex items-center gap-2">
                  <ShieldAlert size={14} className="text-rose-500" />
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-white">Failure Inventory Maturity Profile</h3>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-end gap-1 h-8">
                    {FAR_MATURITY_LEVELS.slice().reverse().map((ml: any) => {
                      const count = (metrics as any).maturityDist[ml.lv] || 0
                      const pct = filteredModes?.length ? (count / filteredModes.length) * 100 : 0
                      return (
                        <div key={ml.lv} className="w-4 h-full relative group cursor-help">
                          <div className={`w-full rounded-lg transition-all ${ml.color} ${count === 0 ? 'opacity-5' : 'opacity-40 group-hover:opacity-100'}`} style={{ height: `${Math.max(10, pct)}%` }} />
                          <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-[100] whitespace-nowrap bg-black border border-white/10 px-2 py-1 rounded-lg text-[8px] font-bold uppercase tracking-widest">
                            {ml.label}: {count}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="w-px h-4 bg-white/10 mx-2" />
                  <button onClick={() => setShowMaturityHelp(true)} className="p-1 text-slate-500 hover:text-white transition-colors" title="Maturity Level Definitions"><HelpCircle size={14} /></button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {goldenWorkspace.activityPanel}
      {goldenWorkspace.compareModal}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <FAROperationalGridView
          gridRef={gridRef}
          rows={displayedModes}
          groupBy={groupBy}
          selectionScopeKey={selectionScopeKey}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          columnDefs={columnDefs as any}
          runtime={goldenWorkspace.gridRuntime}
          rowInteractions={operatorIntelligence.rowInteractions}
          contextMenu={lifecycleScope === 'active' ? goldenWorkspace.contextMenu : undefined}
          gridContext={operatorIntelligence.gridContext}
          getRowClass={operatorIntelligence.getRowClass}
          fontSize={fontSize}
          rowDensity={rowDensity}
          loading={modesLoading || !goldenWorkspace.workingStateReady}
          loadingIcon={<RefreshCcw size={28} className="animate-spin text-rose-400" />}
          loadingLabel={<p className="text-[10px] font-semibold text-rose-300">Loading failure analysis registry...</p>}
          dataState={getFarGridDataState({
            modesError,
            modesLoading,
            filteredModeCount: filteredModes.length,
            lifecycleScope,
            deepLinkNotice,
          })}
        />
        <AnimatePresence>
          {showColumnPicker && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="absolute top-0 right-0 bottom-0 w-64 bg-slate-950/90 backdrop-blur-xl border-l border-white/10 z-[60] flex flex-col shadow-2xl">
              <div className="p-6 border-b border-white/5 flex items-center justify-between"><h3 className="text-xs font-bold uppercase tracking-widest text-rose-400 flex items-center space-x-2"><Sliders size={14} /> <span>Columns</span></h3><button onClick={() => setShowColumnPicker(false)} className="text-slate-500 hover:text-white"><X size={18}/></button></div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-1">
                {columnDefs.filter((c: any) => (c.field || c.colId) && !c.lockVisible).map((col: any) => (
                  <label key={col.field || col.colId} className="flex items-center space-x-3 p-2 rounded-lg hover:bg-white/5 cursor-pointer group transition-all">
                    <input type="checkbox" checked={!hiddenColumns.includes(col.field || col.colId)} onChange={() => setHiddenColumns(prev => prev.includes(col.field || col.colId) ? prev.filter(f => f !== (col.field || col.colId)) : [...prev, col.field || col.colId])} className="sr-only" />
                    <div className={`w-4 h-4 rounded-lg border transition-all ${!hiddenColumns.includes(col.field || col.colId) ? 'bg-rose-600 border-rose-500 shadow-lg shadow-rose-500/20' : 'border-white/10 bg-black/40 group-hover:border-white/20'}`}>{!hiddenColumns.includes(col.field || col.colId) && <Check size={12} className="text-white mx-auto" />}</div>
                    <span className={`text-[10px] font-bold uppercase tracking-widest ${!hiddenColumns.includes(col.field || col.colId) ? 'text-slate-200' : 'text-slate-500'}`}>{col.headerName || col.field || col.colId}</span>
                  </label>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
          {selectedModeId && selectedMode && (
            <FailureDetailView
              mode={selectedMode}
              initialTab={selectedDetailTab}
              onTabChange={(tab) => {
                setSelectedDetailTab(tab)
                syncFarDossierLink(Number(selectedMode.id), tab)
              }}
              onClose={() => closeFarDossier()}
              onUpdate={(type: string) => {
                if (type === 'edit') {
                  setShowWizard(true);
                } else {
                  queryClient.invalidateQueries({ queryKey: ['far', 'modes'] });
                }
              }}
              onRestore={() => {
                closeFarDossier(true)
                requestBulkPreview({ action: 'restore', ids: [Number(selectedMode.id)] })
              }}
              setBkmGuidanceModal={setBkmGuidanceModal}
              setResolutionManagerModal={setResolutionManagerModal}
            />
          )}
      </AnimatePresence>

      <AnimatePresence>
        {incidentListModal.show && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-md p-10">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-full max-w-4xl p-8 rounded-lg border border-purple-500/30 space-y-6 flex flex-col max-h-[90vh]">
              <div className="flex items-center justify-between border-b border-white/5 pb-4">
                <h2 className="text-xl font-bold uppercase tracking-tighter text-purple-400 flex items-center space-x-3">
                   <ShieldAlert size={24}/> <span>Linked Incident Forensic Registry</span>
                </h2>
                <button onClick={() => setIncidentListModal({ show: false, rcas: [] })} className="text-slate-500 hover:text-white transition-colors"><X size={24}/></button>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                <table className="w-full text-left border-collapse">
                   <thead className="sticky top-0 bg-slate-900 border-b border-white/10 z-10">
                      <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                         <th className="py-3 px-4 w-12 text-center text-blue-400">#</th>
                         <th className="py-3 px-4 w-16">ID</th>
                         <th className="py-3 px-4">Incident Title</th>
                         <th className="py-3 px-4 w-40">Occurrence Datetime</th>
                         <th className="py-3 px-4 w-32">Lead Owner</th>
                         <th className="py-3 px-4 w-24 text-center">Status</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-white/5">
                      {incidentListModal.rcas.map((r: any, idx: number) => (
                        <tr 
                          key={r.id}
                          onClick={() => {
                            setSelectedRcaDetail(r);
                            setIncidentListModal({ show: false, rcas: [] });
                          }}
                          className="group cursor-pointer hover:bg-purple-500/5 transition-colors"
                        >
                          <td className="py-4 px-4 text-center text-[10px] font-bold text-slate-600 group-hover:text-blue-400">{idx + 1}</td>
                          <td className="py-4 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-tighter">RCA-{r.id}</td>
                          <td className="py-4 px-4">
                             <div className="text-[11px] font-bold text-slate-200 uppercase group-hover:text-white transition-colors leading-tight">{r.title}</div>
                          </td>
                          <td className="py-4 px-4 text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                             {r.occurrence_at ? formatAppDate(r.occurrence_at, {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : 'N/A'}
                          </td>
                          <td className="py-4 px-4">
                             <div className="text-[10px] font-bold text-blue-400/70 group-hover:text-blue-400 uppercase tracking-widest truncate max-w-[120px]">
                                {r.owners?.[0] || r.owner || 'N/A'}
                             </div>
                          </td>
                          <td className="py-4 px-4">
                             <div className="flex justify-center">
                                <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-lg border ${
                                   r.status === 'RESOLVED' || r.status === 'CLOSED' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-purple-400 border-purple-500/30 bg-purple-500/10'
                                }`}>{r.status}</span>
                             </div>
                          </td>
                        </tr>
                      ))}
                   </tbody>
                </table>
              </div>
              <button onClick={() => setIncidentListModal({ show: false, rcas: [] })} className="w-full py-3.5 bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg text-[10px] font-bold uppercase tracking-[0.2em] transition-all">Dismiss Registry View</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedRcaDetail && (
          <EnhancedRcaDetails 
            item={selectedRcaDetail} 
            devices={[]} // We can pass an empty array or fetch devices if needed
            options={options}
            failureModes={modes}
            onClose={() => setSelectedRcaDetail(null)} 
            onSave={() => {
              setSelectedRcaDetail(null);
              queryClient.invalidateQueries({ queryKey: ['far', 'modes'] });
            }}
            fontSize={fontSize}
            rowDensity={rowDensity}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showMaturityHelp && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md p-10">
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-full max-w-2xl rounded-lg border border-white/10 bg-slate-900 overflow-hidden shadow-2xl">
                <div className="p-8 border-b border-white/5 flex items-center justify-between">
                   <h2 className="text-xl font-bold uppercase tracking-widest text-white ">Maturity Matrix Glossary</h2>
                   <button onClick={() => setShowMaturityHelp(false)} className="text-slate-500 hover:text-white transition-colors"><X size={24}/></button>
                </div>
                <div className="p-4 space-y-2 max-h-[70vh] overflow-y-auto custom-scrollbar">
                   <table className="w-full text-xs">
                      <thead className="bg-white/5 border-b border-white/5">
                         <tr>
                            <th className="px-4 py-2 text-center font-bold uppercase tracking-widest text-slate-500">Lv</th>
                            <th className="px-4 py-2 text-left font-bold uppercase tracking-widest text-slate-500">Status Title</th>
                            <th className="px-4 py-2 text-left font-bold uppercase tracking-widest text-slate-500">Architecture Definition</th>
                         </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                         {[...FAR_MATURITY_LEVELS].reverse().map(ml => (
                           <tr key={ml.lv} className="hover:bg-white/5 transition-colors">
                              <td className="px-4 py-3 text-center"><span className={`px-2 py-1 rounded-lg font-bold text-white shadow-lg ${ml.color}`}>{ml.lv}</span></td>
                              <td className="px-4 py-3 font-bold text-white uppercase ">{ml.label}</td>
                              <td className="px-4 py-3 text-slate-400 font-bold tracking-tight">{ml.tooltip}</td>
                           </tr>
                         ))}
                      </tbody>
                   </table>
                </div>
             </motion.div>
          </div>
        )}

        {showRpnHelp && (
          <RpnDefinitionModal onClose={() => setShowRpnHelp(false)} />
        )}
      </AnimatePresence>

      <MetricHelpModal metric={activeMetricHelp} onClose={() => setActiveMetricHelp(null)} />

      <DataDiagnosticModal
        isOpen={operatorLoopSession?.surface === 'diagnostics'}
        onClose={() => closeFarOperatorSurface('diagnostics')}
        errorDetail={farRegistryDiagnosticDetail}
      />

      <ConfigRegistryModal isOpen={showConfig} onClose={() => setShowConfig(false)} title="Reliability Matrix Registry" sections={[{ title: "Systems", category: "LogicalSystem", icon: LayoutGrid }, { title: "Risk Cats", category: "RiskCategory", icon: Target }, { title: "Teams", category: "BusinessUnit", icon: User }]} />
      <OperationalImportModal
        isOpen={operatorLoopSession?.surface === 'import'}
        onClose={() => closeFarOperatorSurface('import')}
        tableName={FAR_IMPORT_PROFILE}
        displayName="Failure Modes & Risk Matrix"
      />

      <FARAuthoringModal
        isOpen={showWizard}
        initialData={selectedMode}
        onClose={() => setShowWizard(false)}
        onComplete={() => {
          setShowWizard(false)
          queryClient.invalidateQueries({ queryKey: ['far', 'modes'] })
        }}
      />

      <OperationalBulkPreviewModal
        isOpen={Boolean(bulkOperationPreview)}
        workspaceLabel="FAR"
        actionLabel={
          bulkOperationPreview?.action === 'update'
            ? bulkOperationPreview.actionLabel
            : bulkOperationPreview?.action === 'restore'
              ? 'Restore failure vectors'
              : 'Retire failure vectors'
        }
        preview={bulkOperationPreview?.preview || null}
        previewBasis="workspace-snapshot"
        result={bulkOperationPreview?.result || null}
        isExecuting={bulkMutation.isPending}
        onClose={() => setBulkOperationPreview(null)}
        onConfirm={() => bulkOperationPreview && bulkMutation.mutate({
          action: bulkOperationPreview.action,
          ids: bulkOperationPreview.ids,
          payload: bulkOperationPreview.payload,
        })}
      />

      <AnimatePresence>
        {bkmGuidanceModal.show && bkmGuidanceModal.cause && (
          <BkmGuidanceModal 
            cause={bkmGuidanceModal.cause} 
            onClose={() => setBkmGuidanceModal({ show: false, cause: null })} 
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {resolutionManagerModal.show && resolutionManagerModal.cause && (
          <ResolutionManagerModal 
            isOpen={resolutionManagerModal.show}
            cause={resolutionManagerModal.cause}
            modeId={selectedModeId}
            modeVersion={selectedMode?.version}
            onClose={() => setResolutionManagerModal({ show: false, cause: null })}
            onSave={() => queryClient.invalidateQueries({ queryKey: ['far', 'modes'] })}
          />
        )}
      </AnimatePresence>
    </OperationalWorkspaceShell>
  )
}

function BkmGuidanceModal({ cause, onClose }: { cause: any, onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-full max-w-4xl p-8 rounded-lg border border-emerald-500/30 space-y-6 flex flex-col max-h-[85vh] shadow-[0_0_50px_rgba(16,185,129,0.1)]">
        <div className="flex items-center justify-between border-b border-white/5 pb-6">
          <div className="flex items-center gap-4">
             <div className="p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20 text-emerald-400">
                <ShieldCheck size={28}/>
             </div>
             <div>
                <h2 className="text-2xl font-black uppercase tracking-tighter text-emerald-400 flex items-center space-x-3">
                   <span>Operational Guidance Registry</span>
                </h2>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mt-1">Forensic Lineage // {cause.cause_text}</p>
             </div>
          </div>
          <button onClick={onClose} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-slate-500 hover:text-white transition-all"><X size={24}/></button>
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
          <div className="space-y-4">
            {(cause.resolutions || []).map((res: any, idx: number) => (
              <div key={res.id} className="bg-white/5 border border-white/5 rounded-lg overflow-hidden group hover:border-emerald-500/30 transition-all shadow-xl">
                 <div className="px-6 py-4 bg-white/[0.02] border-b border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                       <span className="text-xl font-black text-slate-700">{idx + 1}</span>
                       <div>
                          <p className="text-[11px] font-black text-emerald-400 uppercase tracking-widest leading-none">
                             {res.knowledge_bkm?.title || 'UNNAMED_BKM_ARTIFACT'}
                          </p>
                          <div className="flex items-center gap-3 mt-1.5">
                             <div className="flex items-center gap-1.5">
                                <Clock size={10} className="text-slate-500" />
                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tight">
                                   Logged {formatAppDate(res.created_at)}
                                </span>
                             </div>
                             <div className="w-px h-2 bg-white/10" />
                             <div className="flex items-center gap-1.5">
                                <User size={10} className="text-slate-500" />
                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tight">
                                   {res.responsible_team || 'SYSTEM_OPS'}
                                </span>
                             </div>
                          </div>
                       </div>
                    </div>
                    <button 
                      onClick={() => navigate(`/knowledge?id=${res.knowledge_id}`)}
                      className="flex items-center gap-2 px-4 py-2 bg-emerald-600/10 border border-emerald-500/20 rounded-lg text-[10px] font-black text-emerald-400 uppercase tracking-widest hover:bg-emerald-600 hover:text-white transition-all shadow-lg group-hover:scale-105"
                    >
                       <Zap size={12} />
                       Jump to BKM
                    </button>
                 </div>
                 <div className="p-6 space-y-4">
                    <div className="space-y-2">
                       <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest leading-none">Operational Context & Guidance</p>
                       <div className="bg-black/40 border border-white/5 rounded-lg p-4 text-[13px] text-slate-300 font-bold uppercase leading-relaxed tracking-tight shadow-inner">
                          {res.guidance_notes || res.preventive_follow_up || 'NO OPERATIONAL GUIDANCE PROVIDED FOR THIS RESOLUTION VECTOR.'}
                       </div>
                    </div>
                 </div>
              </div>
            ))}
            {(!cause.resolutions || cause.resolutions.length === 0) && (
              <div className="py-20 flex flex-col items-center justify-center opacity-20 space-y-4">
                 <Shield size={48} className="text-slate-500" />
                 <WorkspaceEmptyState title="No guidance protocols found" description="No standard operating procedures are linked." />
              </div>
            )}
          </div>
        </div>

        <div className="pt-4">
           <button onClick={onClose} className="w-full py-4 bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg text-[10px] font-black uppercase tracking-[0.2em] transition-all">Dismiss Guidance Registry</button>
        </div>
      </motion.div>
    </div>
  )
}

function StatCard({ id, label, value, suffix, color, onHelp }: any) {
  const bgColors: any = { emerald: 'bg-emerald-500/5', rose: 'bg-rose-500/5', amber: 'bg-amber-500/5', sky: 'bg-sky-500/5' }
  const textColors: any = { emerald: 'text-emerald-400', rose: 'text-rose-400', amber: 'text-amber-400', sky: 'text-sky-400' }
  return (
    <div className={`glass-panel p-4 rounded-lg border-white/5 ${bgColors[color]} flex flex-col justify-between group overflow-hidden relative min-h-[90px] w-64`}>
      <div className="flex items-center justify-between relative z-10">
         <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{label}</p>
         <button onClick={onHelp} className="p-1 text-slate-600 hover:text-white transition-colors"><HelpCircle size={12}/></button>
      </div>
      <div className="flex items-baseline gap-1 relative z-10 leading-none mt-2">
         <h4 className={`text-2xl font-bold tracking-tighter  ${textColors[color]}`}>{value}</h4>
         <span className="text-[9px] font-bold text-slate-600 uppercase  tracking-tighter">{suffix}</span>
      </div>
    </div>
  )
}

function FailureDetailView({ mode, initialTab, onTabChange, onClose, onUpdate, onRestore, setBkmGuidanceModal, setResolutionManagerModal }: { mode: any, initialTab: FarDossierTab, onTabChange: (tab: FarDossierTab) => void, onClose: () => void, onUpdate: (type: string) => void, onRestore: () => void, setBkmGuidanceModal: any, setResolutionManagerModal: any }) {
  const [activeTab, setActiveTab] = useState<FarDossierTab>(initialTab)
  const [showAllAssets, setShowAllAssets] = useState(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab, mode.id])
  
  const { data: allModes } = useQuery({ 
    queryKey: ['far', 'modes'], 
    queryFn: async () => (await apiFetch('/api/v1/far/modes?include_deleted=true')).json()
  })

  const systemRank = useMemo(() => {
    if (!allModes) return 0;
    const sameSystem = allModes
      .filter((m: any) => m.system_name === mode.system_name && Boolean(m.is_deleted) === Boolean(mode.is_deleted))
      .sort((a: any, b: any) => b.rpn - a.rpn);
    return sameSystem.findIndex((m: any) => m.id === mode.id) + 1;
  }, [allModes, mode.id, mode.system_name]);

  const humanSummary = useMemo(() => {
    if (mode.rpn > 150) return "This is a high-criticality risk with significant operational exposure. Immediate mitigation is prioritized.";
    if (mode.rpn > 80) return "This failure mode represents a moderate operational risk. Standard monitoring is recommended.";
    return "This is a low-impact failure mode with established containment vectors.";
  }, [mode.rpn]);

  return (
    <FARDossierShell
      mode={mode}
      systemRank={systemRank}
      humanSummary={humanSummary}
      onClose={onClose}
      onEdit={() => onUpdate('edit')}
      onRestore={onRestore}
    >
         {/* HEADER SECTION */}
         <div className="px-8 py-6 border-b border-white/5 bg-white/[0.02] flex flex-col shrink-0 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-96 h-96 bg-rose-600/5 blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />
            
            <div className="flex items-start justify-between relative z-10">
              <div className="space-y-3 flex-1">
                  <div className="flex items-center gap-3">
                      <div className="px-2 py-0.5 rounded-lg bg-rose-600/10 border border-rose-500/20 text-[9px] font-bold text-rose-500  uppercase">VECTOR_{mode.id}</div>
                      <div className="px-2 py-0.5 rounded-lg bg-white/5 border border-white/10 text-[9px] font-bold text-slate-400  uppercase tracking-widest">{mode.system_name}</div>
                      <div className="px-2 py-0.5 rounded-lg bg-blue-600/10 border border-blue-500/20 text-[9px] font-bold text-blue-400  uppercase tracking-widest">RANK #{systemRank}</div>
                      {mode.is_deleted && <div className="px-2 py-0.5 rounded-lg bg-slate-700/40 border border-white/10 text-[9px] font-bold text-slate-300 uppercase tracking-widest">Archived</div>}
                  </div>
                  <h2 className="text-3xl font-bold text-white  tracking-tighter leading-none uppercase">{mode.title}</h2>
                  <p className="text-xs text-rose-400 italic font-medium lowercase tracking-normal mt-1">"{humanSummary}"</p>
              </div>

              <div className="flex items-center gap-4">
                  <div className="flex gap-1.5 bg-black/40 p-1.5 rounded-lg border border-white/5 shadow-xl">
                      <HeaderScore label="S" value={mode.severity} color="rose" />
                      <HeaderScore label="O" value={mode.occurrence} color="amber" />
                      <HeaderScore label="D" value={mode.detection} color="sky" />
                  </div>
                  
                  <div className="text-right flex flex-col items-end">
                      <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 ">Risk Priority</p>
                      <div className="flex items-baseline gap-1 leading-none">
                         <p className={`text-4xl font-bold tracking-tighter ${mode.rpn > 150 ? 'text-rose-500 drop-shadow-[0_0_10px_rgba(244,63,94,0.3)]' : 'text-white'}`}>{mode.rpn}</p>
                         <p className="text-[8px] font-bold text-slate-500  uppercase">RPN</p>
                      </div>
                  </div>
              </div>
            </div>

            {/* EFFECT & IMPACTS ON OWN ROW */}
            <div className="mt-4 flex flex-col space-y-3 relative z-10">
               <div className="bg-rose-500/5 border border-rose-500/10 rounded-lg px-4 py-2 flex items-center gap-3">
                  <p className="text-[9px] text-rose-500 font-bold uppercase tracking-widest shrink-0">Effect Forensics:</p>
                  <p className="text-[11px] text-slate-200 font-bold uppercase  tracking-tight leading-none truncate">{mode.effect || 'NULL_EFFECT_STATEMENT'}</p>
               </div>

               <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[9px] text-slate-500 font-bold mr-2 uppercase tracking-widest">Affected Infrastructure:</span>
                  {mode.affected_assets?.slice(0, showAllAssets ? undefined : 3).map((a: any) => (
                    <div key={a.id} className="flex items-center gap-2 px-2 py-0.5 bg-white/5 border border-white/10 rounded-lg text-[9px] font-bold text-slate-400 ">
                       <Server size={10} className="text-rose-500" /> {a.name}
                    </div>
                  ))}
                  {mode.affected_assets?.length > 3 && (
                    <button onClick={() => setShowAllAssets(!showAllAssets)} className="px-2 py-0.5 bg-rose-600/10 border border-rose-500/20 rounded-lg text-[9px] font-bold text-rose-500  hover:bg-rose-600/20 transition-all">
                       {showAllAssets ? 'SHOW LESS' : `+ ${mode.affected_assets.length - 3} MORE ENTITIES`}
                    </button>
                  )}
                  {(!mode.affected_assets || mode.affected_assets.length === 0) && <span className="text-[9px] text-slate-700  font-bold uppercase tracking-widest">No infrastructure mappings established</span>}
               </div>
            </div>

            {/* TABS ON OWN ROW */}
            <div className="mt-6 flex items-center relative z-10">
               <div className="flex space-x-1 bg-black/60 p-0.5 rounded-lg border border-white/5">
                 {([
                   { id: 'causal', label: 'Causal Forensics', icon: Zap },
                   { id: 'roadmap', label: 'Strategic Roadmap', icon: ShieldCheck },
                   { id: 'versions', label: 'Version History', icon: Clock },
                   { id: 'history', label: 'Research History', icon: Activity },
                 ] as const).map((tab) => (
                   <button key={tab.id} onClick={() => { setActiveTab(tab.id); onTabChange(tab.id) }} className={`px-6 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all flex items-center gap-2 ${activeTab === tab.id ? 'bg-rose-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}><tab.icon size={12} /> {tab.label}</button>
                 ))}
               </div>
            </div>
         </div>

         <div className="flex-1 overflow-hidden flex flex-col p-6">
            <AnimatePresence mode="wait">
               {activeTab === 'causal' && <CausalTab mode={mode} readOnly={Boolean(mode.is_deleted)} onUpdate={onUpdate} setBkmGuidanceModal={setBkmGuidanceModal} setResolutionManagerModal={setResolutionManagerModal} />}
               {activeTab === 'roadmap' && <RoadmapTab mode={mode} readOnly={Boolean(mode.is_deleted)} onUpdate={onUpdate} />}
               {activeTab === 'versions' && <FARVersionHistory mode={mode} onUpdate={onUpdate} />}
               {activeTab === 'history' && <HistoryTab mode={mode} readOnly={Boolean(mode.is_deleted)} onUpdate={onUpdate} />}
            </AnimatePresence>
         </div>

         <div className="px-8 py-2 bg-black/80 border-t border-white/5 flex items-center justify-between shrink-0">
            <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">System Integrity Vector Analysis // {mode.title}</p>
            <div className="flex items-center gap-3 text-[9px] font-bold text-slate-500 uppercase tracking-widest">
               <span>S: {mode.severity}</span>
               <span className="w-1 h-1 rounded-full bg-slate-800" />
               <span>O: {mode.occurrence}</span>
               <span className="w-1 h-1 rounded-full bg-slate-800" />
               <span>D: {mode.detection}</span>
            </div>
         </div>
    </FARDossierShell>
  )
}

function HeaderScore({ label, value, color }: any) {
  const textColors: any = { rose: 'text-rose-500', amber: 'text-amber-500', sky: 'text-sky-400' }
  const bgColors: any = { rose: 'bg-rose-500/10', amber: 'bg-amber-500/10', sky: 'bg-sky-500/10' }
  const borderColors: any = { rose: 'border-rose-500/20', amber: 'border-amber-500/20', sky: 'border-sky-500/20' }
  return (
    <div className={`w-11 h-11 rounded-lg ${bgColors[color]} border ${borderColors[color]} flex flex-col items-center justify-center`}>
       <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest leading-none mb-1">{label}</p>
       <p className={`text-xl font-bold leading-none ${textColors[color]}`}>{value}</p>
    </div>
  )
}

export function GaugeSelector({ label, value, onChange, levels, color, accent }: any) {
  const current = levels.find((l: any) => l.value === value)
  return (
    <div className="space-y-3">
       <div className="flex items-center justify-between">
          <label className="text-[11px] font-bold text-slate-400  tracking-widest uppercase">{label}</label>
          <div className="flex items-center gap-2">
             <span className={`text-2xl font-bold ${color}`}>{value}</span>
             <span className="text-slate-700 text-[10px] font-bold">/ 10</span>
          </div>
       </div>
       <div className="relative h-2 bg-black/40 rounded-lg border border-white/5">
          <div className={`absolute left-0 top-0 h-full rounded-lg ${accent} transition-all duration-300`} style={{ width: `${(value / 10) * 100}%` }} />
          <input 
            type="range" min="1" max="10" step="1" 
            value={value} 
            onChange={e => onChange(Number(e.target.value))}
            onClick={e => e.stopPropagation()}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
       </div>
       <div className="bg-black/20 border border-white/5 rounded-lg p-3 min-h-[50px]">
          <p className={`text-[11px] font-bold uppercase  ${color} leading-none mb-1.5`}>{current?.label}</p>
          <p className="text-[10px] text-slate-500 font-bold leading-tight lowercase">{current?.desc}</p>
       </div>
    </div>
  )
}

function FARAuthoringModal({ isOpen, initialData, onClose, onComplete }: any) {
  const [activeTab, setActiveTab] = useState<FarAuthoringTab>('definition')
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [generalError, setGeneralError] = useState('')
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    identity: false,
    context: false,
    risk: false,
    assets: false,
  })

  const initialDraft = useMemo(() => buildFarAuthoringDraft(initialData), [initialData])
  const {
    value: formData,
    isDirty,
    updateValue: updateFormData,
    resetDirty,
    resolveIsDirty,
  } = useOperationalFormDirty(initialDraft, sanitizeFarAuthoringPayload)

  useEffect(() => {
    if (!isOpen) return
    setActiveTab('definition')
    setFormErrors({})
    setGeneralError('')
    setSubmitAttempted(false)
    setCollapsedSections({ identity: false, context: false, risk: false, assets: false })
  }, [initialData?.id, isOpen])

  useEffect(() => {
    if (!submitAttempted) return
    setFormErrors(buildFarAuthoringErrors(formData))
  }, [formData, submitAttempted])

  const { data: options } = useQuery({
    queryKey: ['settings-options'],
    enabled: isOpen,
    queryFn: async () => (await apiFetch('/api/v1/settings/options')).json(),
  })
  const systems = options?.filter((option: any) => option.category === 'LogicalSystem') || []
  const { data: devices } = useQuery({
    queryKey: ['devices-far', formData.system_name],
    enabled: isOpen && Boolean(formData.system_name),
    queryFn: async () => (await apiFetch(`/api/v1/devices?system=${encodeURIComponent(formData.system_name)}`)).json(),
  })

  const isArchived = Boolean(initialData?.is_deleted)
  const rpn = Number(formData.severity || 0) * Number(formData.occurrence || 0) * Number(formData.detection || 0)
  const tabErrors = useMemo(() => getFarAuthoringTabErrorCounts(formErrors), [formErrors])
  const totalErrors = Object.keys(formErrors).length
  const tabs = useMemo(() => [
    { id: 'definition', label: 'Definition', badgeCount: tabErrors.definition },
    { id: 'risk', label: 'Risk', badgeCount: tabErrors.risk },
    { id: 'impact', label: 'Impact', badgeCount: tabErrors.impact },
  ], [tabErrors])

  const patchFormData = (patch: Record<string, any>) => {
    setGeneralError('')
    updateFormData((current: any) => ({ ...current, ...patch }))
  }

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      if (isArchived) throw new Error('Archived failure vectors are read-only. Restore the vector before editing it.')
      const url = data.id ? `/api/v1/far/modes/${data.id}` : '/api/v1/far/modes'
      const res = await apiFetch(url, {
        method: data.id ? 'PUT' : 'POST',
        body: JSON.stringify(sanitizeFarAuthoringPayload(data)),
      })
      if (!res.ok) throw new Error(await readFarMutationFailureMessage(res))
      return res.json()
    },
    onSuccess: (data: any) => {
      setGeneralError('')
      resetDirty(buildFarAuthoringDraft(data ? { ...formData, ...data } : formData))
      toast.success('Registry Synchronized')
      onComplete()
    },
    onError: (error: any) => {
      const parsed = parseOperationalApiValidationError(error)
      const nextErrors = { ...buildFarAuthoringErrors(formData), ...parsed.fieldErrors }
      setFormErrors(nextErrors)
      setGeneralError(parsed.generalError || error?.message || 'Unable to save the failure vector.')
      if (Object.keys(nextErrors).length) setActiveTab(getFarAuthoringFirstErrorTab(nextErrors))
    },
  })

  const handleSubmit = () => {
    if (mutation.isPending) return
    setSubmitAttempted(true)
    if (isArchived) {
      setGeneralError('Archived failure vectors are read-only. Restore the vector before editing it.')
      return
    }
    const errors = buildFarAuthoringErrors(formData)
    setFormErrors(errors)
    if (Object.keys(errors).length) {
      setGeneralError(`Resolve ${Object.keys(errors).length} validation issue${Object.keys(errors).length === 1 ? '' : 's'} before committing.`)
      setActiveTab(getFarAuthoringFirstErrorTab(errors))
      return
    }
    setGeneralError('')
    mutation.mutate(formData)
  }

  const toggleSection = (key: string) => {
    setCollapsedSections((current) => ({ ...current, [key]: !current[key] }))
  }

  const handleClose = () => {
    resetDirty(initialDraft)
    setFormErrors({})
    setGeneralError('')
    setSubmitAttempted(false)
    setActiveTab('definition')
    onClose()
  }

  return (
    <WorkspaceModal
      isOpen={isOpen}
      onClose={handleClose}
      size="workspace"
      title={initialData ? 'Edit Failure Mode' : 'New Failure Mode'}
      subtitle="Reliability Engineering Risk Documentation Studio"
      icon={<Target size={22} />}
      status={isArchived
        ? <WorkspaceSectionBadge tone="amber">Archived · read-only</WorkspaceSectionBadge>
        : <WorkspaceSectionBadge tone={isDirty ? 'amber' : 'emerald'}>{isDirty ? 'Unsaved changes' : 'Draft synchronized'}</WorkspaceSectionBadge>}
      forensicLineage={initialData ? { createdAt: initialData.created_at, updatedAt: initialData.updated_at } : undefined}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(tab) => setActiveTab(tab as FarAuthoringTab)}
      isDirty={isDirty && !isArchived}
      resolveIsDirty={resolveIsDirty}
      dirtyConfirmTitle="Discard FAR changes?"
      dirtyConfirmMessage="This failure vector has unsaved authoring changes. Close and discard them?"
      dirtyConfirmText="Discard changes"
      footerLeft={(
        <div className="flex flex-wrap items-center gap-2 text-[9px] font-semibold text-slate-500">
          <span>RPN {rpn}</span>
          <span className="h-1 w-1 rounded-full bg-slate-700" />
          <span>{isDirty ? 'Unsaved authoring state' : 'No pending changes'}</span>
        </div>
      )}
      footerRight={(
        <ToolbarButton
          variant="primary"
          onClick={handleSubmit}
          disabled={mutation.isPending || isArchived}
          className="min-w-32 justify-center"
        >
          {mutation.isPending ? <RefreshCcw size={14} className="animate-spin" /> : <Save size={14} />}
          {mutation.isPending ? 'Committing…' : 'Commit'}
        </ToolbarButton>
      )}
    >
      <WorkspaceStickyIdentityBar>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <WorkspaceSectionBadge tone="rose">{formData.id ? `VECTOR_${formData.id}` : 'NEW_VECTOR'}</WorkspaceSectionBadge>
              <WorkspaceSectionBadge>{formData.system_name || 'Domain not selected'}</WorkspaceSectionBadge>
              <WorkspaceSectionBadge>{formData.failure_type || 'Classification not selected'}</WorkspaceSectionBadge>
            </div>
            <p className="mt-2 truncate text-sm font-black text-white">{formData.title || 'Untitled failure vector'}</p>
          </div>
          <div className="text-right">
            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-600">Risk priority</p>
            <p className={`text-2xl font-black ${rpn > 150 ? 'text-rose-400' : rpn >= 80 ? 'text-amber-400' : 'text-emerald-400'}`}>{rpn}</p>
          </div>
        </div>
      </WorkspaceStickyIdentityBar>

      <WorkspaceValidationBanner
        message={generalError || (submitAttempted && totalErrors ? `Review ${totalErrors} highlighted validation issue${totalErrors === 1 ? '' : 's'}.` : undefined)}
      />

      {activeTab === 'definition' && (
        <div id="far-authoring-definition" className="space-y-5">
          <WorkspaceSectionCard>
            <WorkspaceCollapsibleHeader
              title="Failure identity"
              subtitle="Define the operational domain, classification, and incidence signature."
              badge={<WorkspaceSectionBadge tone={tabErrors.definition ? 'rose' : 'blue'}>{tabErrors.definition ? `${tabErrors.definition} issue${tabErrors.definition === 1 ? '' : 's'}` : 'Required identity'}</WorkspaceSectionBadge>}
              collapsed={collapsedSections.identity}
              onToggle={() => toggleSection('identity')}
            />
            {!collapsedSections.identity && (
              <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
                <WorkspaceSelectField
                  label="Operational Domain"
                  required
                  searchable
                  disabled={isArchived}
                  value={formData.system_name}
                  options={systems.map((system: any) => ({ value: system.value, label: system.label, description: system.description }))}
                  placeholder="Select operational domain"
                  error={formErrors.system_name}
                  onChange={(next) => {
                    setGeneralError('')
                    updateFormData((current: any) => changeFarAuthoringSystem(current, String(next)))
                  }}
                />
                <WorkspaceSelectField
                  label="Root Classification"
                  required
                  disabled={isArchived}
                  value={formData.failure_type}
                  options={FAILURE_TYPES}
                  placeholder="Select failure classification"
                  error={formErrors.failure_type}
                  onChange={(next) => patchFormData({ failure_type: String(next) })}
                />
                <div className="space-y-1.5 lg:col-span-2">
                  <WorkspaceFieldLabel label="Incidence Signature" required />
                  <input
                    value={formData.title}
                    disabled={isArchived}
                    aria-invalid={Boolean(formErrors.title)}
                    aria-describedby={formErrors.title ? 'far-title-error' : undefined}
                    onChange={(event) => patchFormData({ title: event.target.value })}
                    placeholder="E.G., DATABASE_CONNECTION_TIMEOUT"
                    className={getWorkspaceInputClass(formErrors.title)}
                  />
                  <div id="far-title-error"><WorkspaceFieldError message={formErrors.title} /></div>
                </div>
              </div>
            )}
          </WorkspaceSectionCard>

          <WorkspaceSectionCard>
            <WorkspaceCollapsibleHeader
              title="Consequence context"
              subtitle="Record the operator-visible effect without changing the FAR risk model."
              badge={<WorkspaceSectionBadge>Optional context</WorkspaceSectionBadge>}
              collapsed={collapsedSections.context}
              onToggle={() => toggleSection('context')}
            />
            {!collapsedSections.context && (
              <div className="mt-5 space-y-1.5">
                <WorkspaceFieldLabel label="Consequence Assessment (Effect)" />
                <textarea
                  value={formData.effect}
                  disabled={isArchived}
                  onChange={(event) => patchFormData({ effect: event.target.value })}
                  placeholder="Describe the systemic consequences..."
                  className={`${getWorkspaceInputClass(formErrors.effect)} min-h-36 resize-y`}
                />
                <WorkspaceFieldError message={formErrors.effect} />
              </div>
            )}
          </WorkspaceSectionCard>
        </div>
      )}

      {activeTab === 'risk' && (
        <div id="far-authoring-risk">
          <WorkspaceSectionCard>
            <WorkspaceCollapsibleHeader
              title="Risk scoring"
              subtitle="Apply the existing FAR severity × occurrence × detection model."
              badge={<WorkspaceSectionBadge tone={tabErrors.risk ? 'rose' : 'amber'}>{tabErrors.risk ? `${tabErrors.risk} issue${tabErrors.risk === 1 ? '' : 's'}` : `RPN ${rpn}`}</WorkspaceSectionBadge>}
              collapsed={collapsedSections.risk}
              onToggle={() => toggleSection('risk')}
            />
            {!collapsedSections.risk && (
              <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div>
                  <GaugeSelector label="Severity" value={formData.severity} onChange={(value: number) => patchFormData({ severity: value })} levels={SEVERITY_LEVELS} color="text-rose-500" accent="bg-rose-500" />
                  <WorkspaceFieldError message={formErrors.severity} />
                </div>
                <div>
                  <GaugeSelector label="Occurrence" value={formData.occurrence} onChange={(value: number) => patchFormData({ occurrence: value })} levels={OCCURRENCE_LEVELS} color="text-amber-500" accent="bg-amber-500" />
                  <WorkspaceFieldError message={formErrors.occurrence} />
                </div>
                <div>
                  <GaugeSelector label="Detection" value={formData.detection} onChange={(value: number) => patchFormData({ detection: value })} levels={DETECTION_LEVELS} color="text-sky-400" accent="bg-sky-400" />
                  <WorkspaceFieldError message={formErrors.detection} />
                </div>
              </div>
            )}
          </WorkspaceSectionCard>
        </div>
      )}

      {activeTab === 'impact' && (
        <div id="far-authoring-impact">
          <WorkspaceSectionCard>
            <WorkspaceCollapsibleHeader
              title="Blast radius"
              subtitle="Search and map the infrastructure entities affected by this failure vector."
              badge={<WorkspaceSectionBadge tone="blue">{formData.affected_assets.length} mapped</WorkspaceSectionBadge>}
              collapsed={collapsedSections.assets}
              onToggle={() => toggleSection('assets')}
            />
            {!collapsedSections.assets && (
              <div className="mt-5">
                <WorkspaceSelectField
                  label="Affected Infrastructure"
                  searchable
                  multi
                  disabled={isArchived || !formData.system_name}
                  value={formData.affected_assets.map((value: any) => String(value))}
                  options={(devices || []).map((device: any) => ({ value: String(device.id), label: device.name, description: device.model }))}
                  placeholder={formData.system_name ? 'Select affected infrastructure' : 'Select an operational domain first'}
                  error={formErrors.affected_assets}
                  onChange={(values) => patchFormData({
                    affected_assets: (Array.isArray(values) ? values : [])
                      .map((value: any) => Number(value))
                      .filter((value: number) => Number.isFinite(value)),
                  })}
                />
                {formData.system_name && !devices?.length ? (
                  <p className="mt-3 text-[9px] font-semibold text-slate-500">No infrastructure entities are available for the selected operational domain.</p>
                ) : null}
              </div>
            )}
          </WorkspaceSectionCard>
        </div>
      )}
    </WorkspaceModal>
  )
}

function CausalTab({ mode, readOnly, onUpdate, setBkmGuidanceModal, setResolutionManagerModal }: any) {
  const [activeModal, setActiveModal] = useState<any>(null)
  const queryClient = useQueryClient()
  const deleteCauseMutation = useMutation({
    mutationFn: async (causeId: number) => {
      const res = await apiFetch(`/api/v1/far/causes/${causeId}`, {
        method: 'DELETE',
        body: JSON.stringify(buildFarContextMutationRequest(mode.id, mode.version)),
      })
      if (!res.ok) throw new Error(await readFarMutationFailureMessage(res))
      return res.json()
    },
    onSuccess: () => {
      toast.success('Root cause removed')
      queryClient.invalidateQueries({ queryKey: ['far', 'modes'] })
      onUpdate()
    },
    onError: (error: any) => toast.error(error.message || 'Failed to delete root cause')
  })

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="flex-1 flex flex-col space-y-6">
       <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
             <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-amber-500 ">Root Cause Attribution Matrix</h3>
             {mode.linked_rcas?.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-1 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                   <Activity size={12} className="text-purple-400" />
                   <span className="text-[9px] font-black text-purple-400 uppercase tracking-widest">{mode.linked_rcas.length} Research Cases Linked</span>
                </div>
             )}
          </div>
          <button onClick={() => setActiveModal({ isOpen: true, modeId: mode.id })} disabled={readOnly} className="px-6 py-2 bg-amber-600/20 border border-amber-500/30 text-amber-500 rounded-lg text-[10px] font-bold uppercase  hover:bg-amber-600 hover:text-white transition-all disabled:cursor-not-allowed disabled:opacity-30">+ Add Root Cause</button>
       </div>
       
       <div className="flex-1 bg-black/40 border border-white/5 rounded-lg overflow-hidden flex flex-col shadow-2xl">
          <table className="w-full text-left border-collapse">
             <thead className="bg-white/[0.03] border-b border-white/10">
                <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ">
                   <th className="px-8 py-4">Root Cause Description (Logical Origin)</th>
                   <th className="px-8 py-4 text-center">Occur Lv</th>
                   <th className="px-8 py-4">Responsible Unit</th>
                   <th className="px-8 py-4">Linked Incidents</th>
                   <th className="px-8 py-4 text-center">BKMs</th>
                   <th className="px-8 py-4 text-right">Ops</th>
                </tr>
             </thead>
             <tbody className="divide-y divide-white/5 font-bold uppercase  text-[11px]">
                {mode.causes?.map((c: any) => (
                  <tr key={c.id} className="hover:bg-white/[0.02] transition-colors group">
                     <td className="px-8 py-5 text-white normal-case leading-relaxed">{c.cause_text}</td>
                     <td className="px-8 py-5 text-center">
                        <div className="flex items-center justify-center gap-2">
                           <div className="w-12 h-1.5 bg-white/5 rounded-lg overflow-hidden border border-white/5">
                              <div className="h-full bg-amber-500" style={{ width: `${c.occurrence_level * 10}%` }} />
                           </div>
                           <span className="text-amber-500 w-4 font-black">{c.occurrence_level}</span>
                        </div>
                     </td>
                     <td className="px-8 py-5 text-slate-400 font-black">{c.responsible_team || 'UNASSIGNED'}</td>
                     <td className="px-8 py-5">
                        <div className="flex flex-col gap-1">
                           {(mode.linked_rcas || []).map((r: any) => (
                              <div key={r.id} className="flex items-center gap-1.5 text-[8px] text-purple-400">
                                 <Activity size={8} />
                                 <span className="truncate max-w-[120px]">{r.title}</span>
                              </div>
                           ))}
                           {(!mode.linked_rcas || mode.linked_rcas.length === 0) && <span className="text-slate-700 text-[8px]">NONE</span>}
                        </div>
                     </td>
                     <td className="px-8 py-5 text-center">
                        <button 
                          onClick={() => c.resolutions?.length > 0 && setBkmGuidanceModal({ show: true, cause: c })}
                          className={`px-3 py-1 rounded-lg text-[9px] font-black transition-all ${
                            c.resolutions?.length > 0 
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 hover:scale-105 active:scale-95 cursor-pointer' 
                              : 'bg-rose-500/10 text-rose-500 border border-rose-500/20 opacity-50 cursor-not-allowed'
                          }`}
                        >
                           {c.resolutions?.length || 0} BKMS
                        </button>
                     </td>
                     <td className="px-8 py-5 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="flex items-center justify-end gap-2">
                           <button 
                             onClick={() => setResolutionManagerModal({ show: true, cause: c })}
                             disabled={readOnly}
                             className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-all disabled:cursor-not-allowed disabled:opacity-30"
                             title="Manage BKM Guidance"
                           >
                              <Book size={14}/>
                           </button>
                           <button 
                             onClick={() => setActiveModal({ isOpen: true, modeId: mode.id, initialData: c })}
                             disabled={readOnly}
                             className="p-1.5 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-all disabled:cursor-not-allowed disabled:opacity-30"
                             title="Edit Attribution"
                           >
                              <Edit2 size={14}/>
                           </button>
                           <button
                             onClick={() => deleteCauseMutation.mutate(c.id)}
                             disabled={readOnly || (deleteCauseMutation.isPending && deleteCauseMutation.variables === c.id)}
                             className="p-1.5 text-slate-600 hover:text-rose-500 transition-all rounded-lg"
                             title="Purge Attribution"
                           >
                             <Trash2 size={14}/>
                           </button>
                        </div>
                     </td>
                  </tr>
                ))}
                {(!mode.causes?.length) && (
                  <tr><td colSpan={6} className="py-32 text-center opacity-20 font-bold uppercase tracking-[0.3em]">No attribution traces linked to this vector</td></tr>
                )}
             </tbody>
          </table>
       </div>

       <RootCauseFormModal 
          isOpen={!readOnly && activeModal?.isOpen}
          onClose={() => setActiveModal(null)}
          modeId={activeModal?.modeId}
          modeVersion={mode.version}
          initialData={activeModal?.initialData}
          onSave={onUpdate}
       />
    </motion.div>
  )
}

       function RpnDefinitionModal({ onClose }: { onClose: () => void }) {
       return (
       <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/90 backdrop-blur-md p-10">
       <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-full max-w-4xl p-12 rounded-lg border border-amber-500/30 shadow-2xl relative">
       <button onClick={onClose} className="absolute top-8 right-8 text-slate-500 hover:text-white transition-colors"><X size={32}/></button>

       <div className="flex items-center gap-6 mb-12 border-b border-white/5 pb-8">
         <div className="w-20 h-20 rounded-lg bg-amber-600 flex items-center justify-center text-white shadow-xl shadow-amber-600/20">
            <Target size={40}/>
         </div>
         <div>
            <h2 className="text-4xl font-black uppercase tracking-tighter text-white">Risk Priority Number</h2>
            <p className="text-xs font-bold text-amber-500 uppercase tracking-[0.3em]">Criticality Scoring Matrix (S × O × D)</p>
         </div>
       </div>

       <div className="grid grid-cols-3 gap-8">
         <div className="space-y-4">
            <div className="flex items-center gap-3 text-rose-500">
               <Shield size={20}/>
               <h3 className="text-sm font-black uppercase tracking-widest">Severity (S)</h3>
            </div>
            <p className="text-[11px] font-bold text-slate-400 uppercase leading-relaxed">Impact of the failure on the system or safety. (1 = No impact, 10 = Systemic destruction / Safety risk).</p>
         </div>
         <div className="space-y-4">
            <div className="flex items-center gap-3 text-amber-500">
               <Activity size={20}/>
               <h3 className="text-sm font-black uppercase tracking-widest">Occurrence (O)</h3>
            </div>
            <p className="text-[11px] font-bold text-slate-400 uppercase leading-relaxed">Likelihood of the failure mode happening. (1 = Remote, 10 = Constant/Inevitable).</p>
         </div>
         <div className="space-y-4">
            <div className="flex items-center gap-3 text-sky-500">
               <Search size={20}/>
               <h3 className="text-sm font-black uppercase tracking-widest">Detection (D)</h3>
            </div>
            <p className="text-[11px] font-bold text-slate-400 uppercase leading-relaxed">Ability to detect the failure before it impacts. (1 = Certain detection, 10 = Undetectable).</p>
         </div>
       </div>

       <div className="mt-12 p-8 bg-black/40 rounded-lg border border-white/5">
         <div className="flex items-center justify-between mb-6">
            <span className="text-xs font-black uppercase tracking-widest text-slate-500">Threshold Logic</span>
            <div className="flex gap-4">
               <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500" /> <span className="text-[10px] font-bold text-emerald-500 uppercase">Nominal (&lt;80)</span></div>
               <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-amber-500" /> <span className="text-[10px] font-bold text-amber-500 uppercase">Moderate (80-150)</span></div>
               <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-rose-500" /> <span className="text-[10px] font-bold text-rose-500 uppercase">Critical (&gt;150)</span></div>
            </div>
         </div>
         <div className="text-6xl font-black text-center text-white tracking-tighter">RPN = S <span className="text-slate-700">×</span> O <span className="text-slate-700">×</span> D</div>
       </div>
       </motion.div>
       </div>
       )
       }

       function MaturityDefinitionModal({ onClose }: { onClose: () => void }) {
       return (
       <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/90 backdrop-blur-md p-10">
       <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-full max-w-4xl p-12 rounded-lg border border-blue-500/30 shadow-2xl relative">
       <button onClick={onClose} className="absolute top-8 right-8 text-slate-500 hover:text-white transition-colors"><X size={32}/></button>

       <div className="flex items-center gap-6 mb-12 border-b border-white/5 pb-8">
         <div className="w-20 h-20 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-xl shadow-blue-600/20">
            <Zap size={40}/>
         </div>
         <div>
            <h2 className="text-4xl font-black uppercase tracking-tighter text-white">Maturity Spectrum</h2>
            <p className="text-xs font-bold text-blue-400 uppercase tracking-[0.3em]">Risk Mitigation Lifecycle (Lv0 - Lv8)</p>
         </div>
       </div>

       <div className="grid grid-cols-2 gap-x-12 gap-y-4">
         {FAR_MATURITY_LEVELS.map((ml) => (
            <div key={ml.lv} className="flex items-center gap-4 p-4 bg-white/5 rounded-lg border border-white/5">
               <div className="w-12 h-12 rounded-lg bg-blue-600/20 flex items-center justify-center text-blue-400 font-black border border-blue-500/20 shadow-inner">Lv{ml.lv}</div>
               <div>
                  <h4 className="text-[11px] font-black uppercase text-white tracking-widest">{ml.label}</h4>
                  <p className="text-[9px] font-bold text-slate-500 uppercase mt-1 leading-tight">{ml.desc}</p>
               </div>
            </div>
         ))}
       </div>
       </motion.div>
       </div>
       )
       }
function RoadmapTab({ mode, readOnly, onUpdate }: any) {
  const [activeMitigationModal, setActiveMitigationModal] = useState<any>(null)
  const [activePreventionModal, setActivePreventionModal] = useState<any>(null)
  const [selectedCauseId, setSelectedCauseId] = useState<number | null>(null)
  const [deletingMitigationId, setDeletingMitigationId] = useState<number | null>(null)
  const deletingMitigationIdRef = React.useRef<number | null>(null)
  
  const queryClient = useQueryClient()
  const { data: bkms } = useQuery({ queryKey: ['knowledge', 'bkms'], queryFn: async () => (await apiFetch('/api/v1/knowledge/?category=BKM')).json() })
  const { data: monitoring } = useQuery({ queryKey: ['monitoring-items'], queryFn: async () => (await apiFetch('/api/v1/monitoring/')).json() })
  const bkmById = useMemo(() => new Map((bkms || []).map((item: any) => [Number(item.id), item])), [bkms])
  const monitoringById = useMemo(() => new Map((monitoring || []).map((item: any) => [Number(item.id), item])), [monitoring])
  const deleteMitigationMutation = useMutation({
    mutationFn: async (mitigationId: number) => {
      const res = await apiFetch(`/api/v1/far/mitigations/${mitigationId}`, {
        method: 'DELETE',
        body: JSON.stringify(buildFarContextMutationRequest(mode.id, mode.version)),
      })
      if (!res.ok) throw new Error(await readFarMutationFailureMessage(res))
      return res.json()
    },
    onSuccess: () => {
      toast.success('Mitigation removed')
      queryClient.invalidateQueries({ queryKey: ['far', 'modes'] })
      onUpdate()
    },
    onError: (error: any) => {
      setDeletingMitigationId(null)
      toast.error(error.message || 'Failed to delete mitigation')
    },
    onSettled: () => {
      deletingMitigationIdRef.current = null
    }
  })

  const updatePreventionMutation = useMutation({
    mutationFn: async ({ preventionId, status }: { preventionId: number, status: string }) => {
      const res = await apiFetch(`/api/v1/far/prevention/${preventionId}`, {
        method: 'PUT',
        body: JSON.stringify(buildFarContextMutationRequest(mode.id, mode.version, { status })),
      })
      if (!res.ok) throw new Error(await readFarMutationFailureMessage(res))
      return res.json()
    },
    onSuccess: () => {
      toast.success('Prevention status synchronized')
      queryClient.invalidateQueries({ queryKey: ['far', 'modes'] })
      onUpdate()
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to update prevention status'),
  })

  useEffect(() => {
    if (!selectedCauseId && mode.causes?.length > 0) {
      setSelectedCauseId(mode.causes[0].id)
    }
  }, [mode.causes, selectedCauseId])

  useEffect(() => {
    if (deletingMitigationId !== null && !mode.mitigations?.some((mitigation: any) => mitigation.id === deletingMitigationId)) {
      setDeletingMitigationId(null)
    }
  }, [deletingMitigationId, mode.mitigations])

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="flex-1 flex flex-col space-y-6">
       <div className="flex items-center gap-4 shrink-0 overflow-x-auto pb-2 scrollbar-hide">
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest shrink-0">Select Root Cause:</span>
          {(mode.causes || []).map((cause: any) => (
             <button 
                key={cause.id}
                onClick={() => setSelectedCauseId(cause.id)}
                className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-tight border transition-all whitespace-nowrap ${selectedCauseId === cause.id ? 'bg-rose-600/10 border-rose-500 text-rose-500' : 'bg-white/5 border-white/5 text-slate-500 hover:text-slate-300'}`}
             >
                {cause.cause_text}
             </button>
          ))}
          {mode.causes?.length === 0 && <span className="text-[10px] font-black text-slate-700 uppercase">No causes attributed to this vector</span>}
       </div>

       <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-sky-400 ">Strategic Mitigation Roadmap</h3>
          <div className="flex flex-nowrap gap-2">
             <button onClick={() => setActiveMitigationModal({ isOpen: true, type: 'WORKAROUND' })} disabled={readOnly || !selectedCauseId} className="px-6 py-2 whitespace-nowrap bg-amber-600/20 border border-amber-500/30 text-amber-500 rounded-lg text-[10px] font-bold uppercase  hover:bg-amber-600 hover:text-white transition-all disabled:opacity-20">+ Add Workaround</button>
             <button onClick={() => setActiveMitigationModal({ isOpen: true, type: 'MONITORING' })} disabled={readOnly || !selectedCauseId} className="px-6 py-2 whitespace-nowrap bg-sky-600/20 border border-sky-500/30 text-sky-400 rounded-lg text-[10px] font-bold uppercase  hover:bg-sky-600 hover:text-white transition-all disabled:opacity-20">+ Add Monitoring</button>
             <button onClick={() => setActivePreventionModal({ isOpen: true })} disabled={readOnly || !selectedCauseId} className="px-6 py-2 whitespace-nowrap bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 rounded-lg text-[10px] font-bold uppercase  hover:bg-emerald-600 hover:text-white transition-all disabled:opacity-20">+ Add Prevention</button>
          </div>
       </div>

       <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-4">
          <div className="bg-black/40 border border-white/5 rounded-lg overflow-hidden shadow-2xl">
             <table className="w-full text-left border-collapse">
                <thead className="bg-white/[0.03] border-b border-white/10">
                   <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ">
                      <th className="px-8 py-4">Shield Type</th>
                      <th className="px-8 py-4">Deployment Protocol / Plan</th>
                      <th className="px-8 py-4 text-center">Cause Context</th>
                      <th className="px-8 py-4 text-center">Status</th>
                      <th className="px-8 py-4 text-right">Ops</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-bold uppercase  text-[11px]">
                   {mode.mitigations?.filter((m: any) => m.cause_id === selectedCauseId).map((m: any) => {
                     const linkedBkm = bkmById.get(Number(m.knowledge_bkm_id)) as any
                     const linkedMonitor = monitoringById.get(Number(m.monitoring_item_id)) as any
                     const completed = m.status === 'Completed'
                     return (
                     <tr key={m.id} className="hover:bg-white/[0.02] transition-colors group">
                        <td className="px-8 py-5">
                           <span className={`px-3 py-1 rounded-lg text-[9px] font-black ${m.mitigation_type === 'Monitoring' ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30' : m.mitigation_type === 'Process Change' ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}`}>{m.mitigation_type}</span>
                        </td>
                        <td className="px-8 py-5 text-white max-w-xl">
                           <div className="space-y-2">
                              {m.mitigation_steps?.split('\n').map((line: string, i: number) => (
                                <div key={i} className="flex gap-3">
                                   <span className="text-slate-600 text-[9px] font-black">{i + 1}.</span>
                                   <span className="normal-case font-medium text-slate-300 uppercase">{line}</span>
                                </div>
                              ))}
                              {m.responsible_team && (
                                <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-wide text-slate-500">
                                  <User size={12} className="text-slate-600" /> Owner: {m.responsible_team}
                                </div>
                              )}
                              {linkedBkm && (
                                 <div className="flex items-center gap-3 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg mt-2">
                                    <Book size={14} className="text-emerald-400" />
                                    <span className="text-emerald-400 tracking-tight normal-case font-black uppercase">Linked BKM: {linkedBkm.title}</span>
                                 </div>
                              )}
                              {m.external_bkm_url && (
                                 <a
                                   href={m.external_bkm_url}
                                   target="_blank"
                                   rel="noreferrer noopener"
                                   className="flex items-center gap-3 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg mt-2 text-blue-400 hover:bg-blue-500/10 transition-all"
                                 >
                                    <ExternalLink size={14} />
                                    <span className="tracking-tight normal-case font-black uppercase truncate">External BKM: {m.external_bkm_url}</span>
                                 </a>
                              )}
                              {linkedMonitor && (
                                 <div className="flex items-center gap-3 p-3 bg-sky-500/5 border border-sky-500/20 rounded-lg mt-2 group/item hover:bg-sky-500/10 transition-all">
                                    <Monitor size={14} className="text-sky-400" />
                                    <span className="text-sky-400 tracking-tight normal-case font-black uppercase">Linked Monitor: {linkedMonitor.title}</span>
                                 </div>
                              )}
                           </div>
                        </td>
                        <td className="px-8 py-5 text-center">
                           <div className="flex flex-col items-center gap-1">
                              <span className="text-[9px] font-black text-rose-400/70 truncate max-w-[150px]">{mode.causes?.find((c:any)=>c.id === m.cause_id)?.cause_text || 'GLOBAL_VECTOR'}</span>
                           </div>
                        </td>
                        <td className="px-8 py-5 text-center">
                           <span className={`px-3 py-1 rounded-lg text-[9px] font-black border ${completed ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-800 text-slate-400 border-white/10'}`}>
                              {m.status?.toUpperCase() || 'NOT STARTED'}
                           </span>
                        </td>
                        <td className="px-8 py-5 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                           <div className="flex items-center justify-end gap-1">
                             <button
                               onClick={() => {
                                 setSelectedCauseId(Number(m.cause_id))
                                 setActiveMitigationModal({ isOpen: true, type: m.mitigation_type, initialData: m })
                               }}
                               disabled={readOnly}
                               className="p-2 text-slate-600 hover:text-blue-400 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                               title="Edit mitigation"
                             >
                               <Edit2 size={16}/>
                             </button>
                             <button
                               onClick={() => {
                                 if (deletingMitigationIdRef.current !== null) return
                                 deletingMitigationIdRef.current = m.id
                                 setDeletingMitigationId(m.id)
                                 deleteMitigationMutation.mutate(m.id)
                               }}
                               disabled={readOnly || completed || deletingMitigationId !== null}
                               className="p-2 text-slate-600 hover:text-rose-500 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                               title={completed ? 'Completed mitigations cannot be deleted' : 'Delete Mitigation'}
                             >
                               <Trash2 size={16}/>
                             </button>
                           </div>
                        </td>
                     </tr>
                     )
                   })}
                   {mode.mitigations?.filter((m: any) => m.cause_id === selectedCauseId).length === 0 && (
                      <tr><td colSpan={5} className="py-20 text-center opacity-20 font-bold uppercase tracking-[0.3em]">No mitigation shields active for this cause</td></tr>
                   )}
                </tbody>
             </table>
          </div>

          <div className="bg-black/40 border border-emerald-500/10 rounded-lg overflow-hidden shadow-2xl">
             <div className="flex items-center justify-between border-b border-white/10 bg-emerald-500/[0.03] px-8 py-4">
                <div>
                   <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">Prevention Execution</h4>
                   <p className="mt-1 text-[9px] font-bold uppercase text-slate-600">Verified or completed prevention advances this failure vector to maturity Lv8.</p>
                </div>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                  {(mode.prevention_actions || []).filter((p: any) => p.cause_id === selectedCauseId).length} linked
                </span>
             </div>
             <table className="w-full text-left border-collapse">
                <thead className="border-b border-white/10 bg-white/[0.02]">
                   <tr className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
                      <th className="px-8 py-3">Prevention Action / Project Objective</th>
                      <th className="px-8 py-3">Owner</th>
                      <th className="px-8 py-3">Target</th>
                      <th className="px-8 py-3 text-right">FAR Status</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                   {(mode.prevention_actions || []).filter((p: any) => p.cause_id === selectedCauseId).map((p: any) => (
                     <tr key={p.id} className="hover:bg-emerald-500/[0.03] transition-colors">
                        <td className="px-8 py-4 text-[11px] font-bold text-slate-200">{p.prevention_action}</td>
                        <td className="px-8 py-4 text-[10px] font-bold uppercase text-slate-500">{p.responsible_team || 'UNASSIGNED'}</td>
                        <td className="px-8 py-4 text-[10px] font-bold uppercase text-slate-500">{p.target_date ? formatAppDate(p.target_date) : 'NO TARGET'}</td>
                        <td className="px-8 py-4 text-right">
                           <select
                             value={p.status || 'Open'}
                             disabled={readOnly || updatePreventionMutation.isPending}
                             onChange={(event) => updatePreventionMutation.mutate({ preventionId: Number(p.id), status: event.target.value })}
                             className="rounded-lg border border-emerald-500/20 bg-slate-950 px-3 py-1.5 text-[9px] font-black uppercase text-emerald-400 outline-none disabled:opacity-40"
                           >
                             <option value="Open">Open</option>
                             <option value="In Progress">In Progress</option>
                             <option value="Verified">Verified</option>
                             <option value="Completed">Completed</option>
                           </select>
                        </td>
                     </tr>
                   ))}
                   {(mode.prevention_actions || []).filter((p: any) => p.cause_id === selectedCauseId).length === 0 && (
                     <tr><td colSpan={4} className="py-12 text-center text-[9px] font-bold uppercase tracking-[0.25em] text-slate-700">No prevention execution linked to this cause</td></tr>
                   )}
                </tbody>
             </table>
          </div>
       </div>

       <MitigationFormModal 
          key={activeMitigationModal?.initialData?.id ? `edit-${activeMitigationModal.initialData.id}` : `new-${activeMitigationModal?.type || 'mitigation'}`}
          isOpen={!readOnly && activeMitigationModal?.isOpen}
          onClose={() => setActiveMitigationModal(null)}
          modeId={mode.id}
          modeVersion={mode.version}
          causeId={activeMitigationModal?.initialData?.cause_id ?? selectedCauseId}
          type={activeMitigationModal?.type}
          initialData={activeMitigationModal?.initialData}
          bkms={bkms}
          monitoring={monitoring}
          onSave={onUpdate}
       />

       <PreventionFormModal 
          isOpen={!readOnly && activePreventionModal?.isOpen}
          onClose={() => setActivePreventionModal(null)}
          modeId={mode.id}
          modeVersion={mode.version}
          causeId={selectedCauseId}
          onSave={onUpdate}
       />
    </motion.div>
  )
}
  function HistoryTab({ mode, readOnly, onUpdate }: any) {
    const [isLinking, setIsLinking] = useState(false)
    const [search, setSearch] = useState('')
    const queryClient = useQueryClient()
    const navigate = useNavigate()

    const { data: research } = useQuery({ 
      queryKey: ['research-items'], 
      queryFn: async () => (await apiFetch('/api/v1/investigations')).json() 
    })

    const filteredResearch = useMemo(() => {
      if (!research) return []
      return research.filter((r: any) => 
        !search || r.title.toLowerCase().includes(search.toLowerCase()) || r.summary?.toLowerCase().includes(search.toLowerCase())
      )
    }, [research, search])

    const linkMutation = useMutation({
      mutationFn: async (researchId: number) => {
        const currentLinks = mode.metadata_json?.linked_research_ids || []
        if (currentLinks.includes(researchId)) {
          toast.error('Research artifact already linked')
          return
        }
        const updatedMetadata = { ...mode.metadata_json, linked_research_ids: [...currentLinks, researchId] }
        const res = await apiFetch(`/api/v1/far/modes/${mode.id}`, {
          method: 'PUT',
          body: JSON.stringify(withFarExpectedVersion(mode.version, { metadata_json: updatedMetadata }))
        })
        if (!res.ok) throw new Error(await readFarMutationFailureMessage(res))
        return res.json()
      },
      onSuccess: () => {
        toast.success('Research Artifact Linked to Vector')
        setIsLinking(false)
        onUpdate()
        queryClient.invalidateQueries({ queryKey: ['far', 'modes'] })
      },
      onError: (err: any) => {
        toast.error(`Linking Failed: ${err.message}`)
      }
    })
    const unlinkMutation = useMutation({
      mutationFn: async (researchId: number) => {
        const currentLinks = mode.metadata_json?.linked_research_ids || []
        const updatedMetadata = {
          ...mode.metadata_json,
          linked_research_ids: currentLinks.filter((id: number) => id !== researchId)
        }
        const res = await apiFetch(`/api/v1/far/modes/${mode.id}`, {
          method: 'PUT',
          body: JSON.stringify(withFarExpectedVersion(mode.version, { metadata_json: updatedMetadata }))
        })
        if (!res.ok) throw new Error(await readFarMutationFailureMessage(res))
        return res.json()
      },
      onSuccess: () => {
        toast.success('Research artifact unlinked')
        onUpdate()
        queryClient.invalidateQueries({ queryKey: ['far', 'modes'] })
      },
      onError: (err: any) => {
        toast.error(`Unlink Failed: ${err.message}`)
      }
    })

    const linkedResearch = useMemo(() => {
      if (!research || !mode.metadata_json?.linked_research_ids) return []
      return research.filter((r: any) => mode.metadata_json.linked_research_ids.includes(r.id))
    }, [research, mode.metadata_json])
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="flex-1 flex flex-col space-y-6">
         <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-500 ">Analytical Research History</h3>
            <button onClick={() => setIsLinking(true)} disabled={readOnly} className="px-6 py-2 bg-slate-800/50 border border-white/10 text-slate-400 rounded-lg text-[10px] font-bold uppercase  hover:bg-slate-700 hover:text-white transition-all disabled:cursor-not-allowed disabled:opacity-30">+ Link Research Artifact</button>
         </div>

         <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-4">
            {linkedResearch.map((r: any) => (
               <div key={r.id} className="bg-white/5 border border-white/5 rounded-lg p-6 flex items-center justify-between group hover:bg-white/10 transition-all">
                  <div className="flex items-center gap-6">
                     <div className="p-4 bg-blue-500/10 rounded-lg text-blue-400 border border-blue-500/20"><Activity size={24}/></div>
                     <div>
                        <h4 className="text-sm font-bold text-white uppercase tracking-tight">{r.title}</h4>
                        <div className="flex items-center gap-3 mt-1">
                           <span className="text-[9px] font-bold text-slate-500 uppercase">Status: {r.status}</span>
                           <span className="text-[9px] font-bold text-slate-500 uppercase">ID: {r.id}</span>
                        </div>
                     </div>
                  </div>
                  <div className="flex gap-3">
                     <button onClick={() => navigate(`/research?type=research&id=${r.id}`)} className="p-2.5 bg-white/5 rounded-lg text-slate-500 hover:text-blue-400 transition-all opacity-0 group-hover:opacity-100"><Eye size={18}/></button>
                     <button onClick={() => unlinkMutation.mutate(r.id)} disabled={readOnly} className="p-2.5 bg-white/5 rounded-lg text-slate-500 hover:text-rose-500 transition-all opacity-0 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-20"><Trash2 size={18}/></button>
                  </div>
               </div>
            ))}
            {linkedResearch.length === 0 && (
               <div className="flex-1 flex flex-col items-center justify-center py-20 space-y-4 opacity-20 ">
                  <Activity size={48} className="text-slate-500" />
                  <p className="text-[12px] font-bold uppercase tracking-[0.3em] text-center max-w-md">No historical research artifacts currently mapped to this failure vector</p>
                  <button onClick={() => navigate('/research')} className="text-[10px] font-bold uppercase underline tracking-widest text-rose-500">Initiate New Research Case</button>
               </div>
            )}
         </div>
         <AnimatePresence>
            {!readOnly && isLinking && (
               <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
                  <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-full max-w-lg p-10 rounded-lg border border-white/10 space-y-6">
                     <div className="flex items-center justify-between border-b border-white/5 pb-4">
                        <h3 className="text-xl font-bold uppercase text-white tracking-tighter">Link Research</h3>
                        <button onClick={() => setIsLinking(false)} className="text-slate-500 hover:text-white transition-colors"><X size={24}/></button>
                     </div>
                     <div className="relative">
                        <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" />
                        <input 
                          value={search} 
                          onChange={e => setSearch(e.target.value)} 
                          placeholder="Search research artifacts..." 
                          className="w-full bg-black/40 border border-white/10 rounded-lg pl-11 pr-4 py-3 text-xs font-bold text-white outline-none focus:border-rose-500" 
                        />
                     </div>
                     <div className="max-h-[300px] overflow-y-auto custom-scrollbar pr-2 space-y-2">
                        {filteredResearch?.map((r: any) => (
                          <button 
                            key={r.id} 
                            onClick={() => linkMutation.mutate(r.id)}
                            className="w-full text-left p-4 rounded-lg bg-white/5 border border-white/5 hover:border-rose-500/30 hover:bg-rose-500/5 transition-all group"
                          >
                             <p className="text-[11px] font-bold text-white uppercase">{r.title}</p>
                             <p className="text-[9px] text-slate-500 font-bold uppercase mt-1">Status: {r.status}</p>
                          </button>
                        ))}
                     </div>
                  </motion.div>
               </div>
            )}
         </AnimatePresence>
      </motion.div>
    )
  }
