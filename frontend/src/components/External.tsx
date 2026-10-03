import { useWorkspaceConfirmation } from './shared/useWorkspaceConfirmation'
import { usePageLeaveGuard } from './shared/workspaceDeparture'
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Plus, Trash2, Globe, X, RefreshCcw, Search, Edit2, LayoutGrid, List, FileText, Clipboard, 
  Link as LinkIcon, Share2, ExternalLink, Shield, Server, Database, Cloud, Activity, 
  Sliders, Settings, User, Users, Mail, Phone, Tag, Info, AlertCircle, Briefcase, 
  Clock, DollarSign, Target, ChevronRight, Layers, Box, Cpu, Zap, FileJson, MoreVertical, Eye, EyeOff, Key, Upload, Check, Maximize2,
  Star, GitCompare, Minimize2, ChevronUp, ChevronDown, Bell, Undo2
} from 'lucide-react'
import { apiFetch } from "../api/apiClient"
import { parseAppDate, formatAppDate } from '../utils/dateUtils'
import {
  OperationalRowActionMenu,
  type OperationalRowActionSectionModel,
  type OperationalRowActionItem,
  type OperationalRowActionVariant,
  type OperationalRowActionTone
} from './shared/OperationalRowActionMenu'
import {
  HeaderScopeSwitch,
  ToolbarGroup, 
  ToolbarSearch, 
  ToolbarButton, 
  ToolbarIconButton, 
  ToolbarSegmented 
} from './shared/LayoutPrimitives'


import { AppDropdown } from './shared/AppDropdown'
import { StyledSelect } from "./shared/StyledSelect"
import { ConfigRegistryModal } from "./ConfigRegistry"
import { WorkspaceShareHeader } from './shared/WorkspaceShareHeader'
import { WorkspaceCompareShell } from './shared/WorkspaceModalShells'
import { WorkspaceFlyoutActionCard, WorkspaceFlyoutDropdownEditor } from './shared/WorkspaceFlyout'
import { showWorkspaceRevertToast, showWorkspaceToast } from './shared/WorkspaceToast'
import { mergeOperationalFieldErrors, parseOperationalApiValidationError } from './shared/OperationalFieldValidation'
import DiagnosticStatusPill, { DataDiagnosticModal, buildOperationalDiagnosticDetail } from './shared/OperationalDataStatus'
import { resolveOperationalDataState } from './shared/OperationalDataState'
import {
  OPERATIONAL_GRID_LAYOUT_POLICIES,
  useOperationalGridRuntime,
  usePersistentJsonState,
  useWorkspaceOverlayController,
  useOperationalDetailRoute,
} from './shared/OperationalWorkspaceHooks'
import { useWorkspaceAnchoredLayer, WorkspaceEmptyState, useEscapeDismiss, useBodyModalFlag, WorkspaceFloatingPanel, WorkspaceSplitView } from './shared/OperationalWorkspacePrimitives'
import { OperationalAnchoredPanel, OperationalDisplayPanel, OperationalGroupedGridSection, OperationalGroupedGridView, OperationalSavedViewsPanel, OperationalWorkspaceShell } from './shared/OperationalWorkspaceShells'
import { OperationalImportModal } from './shared/OperationalImportModal'
import { downloadOperationalImportFile } from './shared/OperationalImportExport'
// (Removed duplicate imports)
import { EXTERNAL_WORKSPACE_STANDARD } from './shared/OperationalWorkspace'
import { WorkspaceModal } from './shared/WorkspaceModal'
import { OperationalFormProps, useOperationalFormDirty } from './shared/OperationalFormContracts'
import { ConfirmationModal } from './shared/ConfirmationModal'
import { OperationalDataGrid } from './shared/OperationalDataGrid'
import { OPERATIONAL_ACTION_LABELS } from './shared/OperationalActionLabels'
import { OperationalDisabledActionTooltip } from './shared/OperationalDisabledActionTooltip'
import {
  buildLifecycleDependencyGuardResult,
  formatLifecycleDependencyTooltipReason,
} from './shared/OperationalDependencyGuard'
import {
  autoSizeOperationalColumns,
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
import {
  useOperationalRowInteractions,
  useOperationalContextMenu,
  useOperationalDismissController,
  useOperationalGroupedSelection,
} from './shared/OperationalGridInteractions'
import { useCollaborativeWorkspaceViews } from './shared/CollaborativeWorkspaceViews'

// --- Sub-components ---

const toTitle = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())

const parseMetadataObject = (value: any) => {
  if (!value) return {}
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value || '{}')
  } catch {
    return {}
  }
}

const getMetaValue = (entity: any, key: string) => parseMetadataObject(entity?.metadata_json)?.[key]
const getMetaText = (entity: any, key: string) => {
  const value = getMetaValue(entity, key)
  return typeof value === 'string' ? value.trim() : value
}

const ACCOUNTABLE_OWNER_OPTIONS = [
  { value: 'team', label: 'Team' },
  { value: 'individual', label: 'Individual' },
]

const CONTACT_ROLE_OPTIONS = ['Primary', 'Operational', 'Escalation', 'Security', 'Business']
const EXTERNAL_BULK_FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  environment: 'Environment',
  criticality: 'Criticality',
  risk_rating: 'Risk Rating',
}
const SECRET_TYPE_OPTIONS = ['VaultReference', 'SharedSecret', 'Token', 'KeyPair', 'Certificate']
const SECRET_STATUS_OPTIONS = ['Active', 'RotationDue', 'Disabled']
const VAULT_PROVIDER_OPTIONS = ['1Password', 'Bitwarden', 'HashiCorp Vault', 'AWS Secrets Manager', 'Azure Key Vault', 'Other']
const LINK_DIRECTION_OPTIONS = ['Inbound', 'Outbound', 'Bidirectional']
const LINK_PROTOCOL_OPTIONS = ['HTTPS', 'HTTP', 'TCP', 'UDP', 'SFTP', 'SSH', 'Database', 'Other']
const LINK_NETWORK_ZONE_OPTIONS = ['Internet', 'DMZ', 'Partner', 'Internal', 'Restricted']
const LINK_TRANSPORT_SECURITY_OPTIONS = ['TLS', 'mTLS', 'VPN', 'None', 'Other']

const EXTERNAL_LINK_DIRECTION_COLORS: Record<string, string> = {
  Inbound: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  Bidirectional: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  Outbound: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
}

const EXTERNAL_TYPE_COLORS: Record<string, string> = {
  Equipment: 'text-indigo-400',
  'Physical Server': 'text-blue-400',
  'Virtual Server': 'text-sky-400',
  Switch: 'text-rose-400',
  Storage: 'text-amber-400',
  DB: 'text-emerald-400',
  API: 'text-fuchsia-400',
  Script: 'text-orange-400',
}

const EXTERNAL_STATUS_COLORS: Record<string, string> = {
  Active: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/20',
  Maintenance: 'text-amber-400 border-amber-500/40 bg-amber-500/20',
  Decommissioned: 'text-rose-400 border-rose-500/40 bg-rose-500/20',
  Planned: 'text-blue-400 border-blue-500/40 bg-blue-500/20',
  Standby: 'text-sky-400 border-sky-500/40 bg-sky-500/20',
  Failed: 'text-rose-500 border-rose-600/40 bg-rose-600/20',
  Provisioning: 'text-indigo-400 border-indigo-500/40 bg-indigo-500/20',
  Reserved: 'text-purple-400 border-purple-500/40 bg-purple-500/20',
}

const extensionMetadataKeysByType: Record<string, string[]> = {
  Equipment: ['manufacturer', 'model', 'serial_number'],
  'Physical Server': ['rack_id', 'unit_position', 'os'],
  'Virtual Server': ['hypervisor', 'vcpu', 'vram', 'os'],
  Switch: ['management_url', 'ports', 'firmware'],
  DB: ['engine', 'instance_name'],
  API: ['version'],
  Script: ['runtime', 'path', 'schedule'],
}

const FALLBACK_EXTERNAL_TYPE_OPTIONS = Object.keys(extensionMetadataKeysByType).map((value) => ({
  value,
  label: value,
}))

const reservedMetadataKeys = new Set([
  'business_purpose',
])

const EXTERNAL_VIEW_STORAGE_KEY = 'sysgrid_external_views_v1'
const EXTERNAL_COLLABORATIVE_VIEW_MIGRATION_KEY = 'sysgrid_external_collaborative_views_v1_migrated'
const EXTERNAL_DEFAULT_VIEW_IDS = new Set<string>()
const EXTERNAL_ACTIVE_VIEW_KEY = 'sysgrid_external_active_view_v1'
const EXTERNAL_UI_STATE_KEY = 'sysgrid_external_ui_state_v1'
const EXTERNAL_FAVORITES_STORAGE_KEY = 'sysgrid_external_favorites_v1'
const EXTERNAL_WATCH_STORAGE_KEY = 'sysgrid_external_watch_v1'
const EXTERNAL_SUPPORTS_COMPARE = EXTERNAL_WORKSPACE_STANDARD.sharedCapabilities.includes('compare')
const EXTERNAL_DEFAULT_GROUP_OPTIONS = [
  { value: 'raw', label: 'Raw Registry' },
  { value: 'type', label: 'Type' },
  { value: 'status', label: 'Status' },
  { value: 'environment', label: 'Environment' },
  { value: 'criticality', label: 'Criticality' },
]
const EXTERNAL_ACTIVE_TABS = ['active', 'deleted', 'links'] as const
type ExternalActiveTab = (typeof EXTERNAL_ACTIVE_TABS)[number]
const EXTERNAL_PERSISTED_COLUMN_IDS = new Set([
  'select',
  'id',
  'recent_change',
  'favorite',
  'watch',
  'name',
  'external_entity_name',
  'direction',
  'device_name',
  'service_name',
  'purpose',
  'protocol',
  'port',
  'type',
  'internal_owner',
  'status',
  'environment',
  'link_count',
  'warning_count',
  'row_actions',
])

const normalizeExternalHiddenColumns = (value: any) =>
  Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && EXTERNAL_PERSISTED_COLUMN_IDS.has(entry))
    : []

export const normalizeExternalActiveTab = (value: unknown): ExternalActiveTab =>
  EXTERNAL_ACTIVE_TABS.includes(value as ExternalActiveTab) ? (value as ExternalActiveTab) : 'active'

const normalizeExternalQuickFilters = (value: any) => ({
  status: Array.isArray(value?.status) ? value.status.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [] as string[],
  type: Array.isArray(value?.type) ? value.type.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [] as string[],
  environment: Array.isArray(value?.environment) ? value.environment.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [] as string[],
  owner: Array.isArray(value?.owner) ? value.owner.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [] as string[],
  direction: Array.isArray(value?.direction) ? value.direction.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [] as string[],
  protocol: Array.isArray(value?.protocol) ? value.protocol.filter((entry: any) => typeof entry === 'string' && entry.trim()) : [] as string[],
})

export const sanitizeExternalViewConfig = (config: any) => {
  const safeConfig = config && typeof config === 'object' ? config : {}
  return {
    fontSize: Number.isFinite(safeConfig.fontSize) ? safeConfig.fontSize : 11,
    rowDensity: Number.isFinite(safeConfig.rowDensity) ? safeConfig.rowDensity : 8,
    hiddenColumns: normalizeExternalHiddenColumns(safeConfig.hiddenColumns),
    groupBy: typeof safeConfig.groupBy === 'string' ? safeConfig.groupBy : 'raw',
    activeTab: normalizeExternalActiveTab(safeConfig.activeTab),
    searchTerm: typeof safeConfig.searchTerm === 'string' ? safeConfig.searchTerm : '',
    showFilterBar: safeConfig.showFilterBar !== false,
    quickFilters: normalizeExternalQuickFilters(safeConfig.quickFilters),
    columnLayoutState: sanitizeOperationalColumnLayout(
      Array.isArray(safeConfig.columnLayoutState) ? safeConfig.columnLayoutState : [],
      EXTERNAL_PERSISTED_COLUMN_IDS,
      true
    ),
    filterModel: sanitizeOperationalFilterModel(safeConfig.filterModel, EXTERNAL_PERSISTED_COLUMN_IDS),
    sortModel: sanitizeOperationalSortModel(safeConfig.sortModel, EXTERNAL_PERSISTED_COLUMN_IDS),
  }
}

const normalizeExternalSavedViews = (value: any) =>
  (Array.isArray(value) ? value : []).filter((view: any) => (
    view &&
    typeof view === 'object' &&
    typeof view.id === 'string' &&
    typeof view.name === 'string'
  )).map((view: any) => ({
    ...view,
    config: sanitizeExternalViewConfig(view.config),
  }))

const normalizeExternalWorkspaceState = (value: any) => {
  const normalized = sanitizeExternalViewConfig(value)
  return {
    ...normalized,
  }
}

export const describeExternalSavedView = (view: any) => {
  const activeTab = normalizeExternalActiveTab(view?.config?.activeTab)
  const tabLabel = activeTab === 'deleted' ? 'Archive' : activeTab === 'links' ? 'Links' : 'Registry'
  const groupLabel = view?.config?.groupBy && view.config.groupBy !== 'raw'
    ? `Grouped by ${EXTERNAL_DEFAULT_GROUP_OPTIONS.find((option) => option.value === view.config.groupBy)?.label || view.config.groupBy}`
    : 'Raw Table'

  return `${tabLabel} · ${groupLabel} · ${view?.config?.searchTerm ? 'Scoped search' : 'Full workspace'}`
}

const normalizeLegacyContacts = (entity: any) => {
  if (Array.isArray(entity?.contacts_json) && entity.contacts_json.length) return entity.contacts_json
  if (!Array.isArray(entity?.poc_json)) return []
  return entity.poc_json.map((contact: any, index: number) => ({
    role: index === 0 ? 'Primary' : 'Operational',
    full_name: [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() || contact.id || 'Unspecified Contact',
    email: contact.email || '',
    phone: contact.phone || '',
    external_person_id: contact.id || '',
    is_primary: index === 0,
    is_escalation: false,
  }))
}

const getEntityInsights = (entity: any, links: any[] = []) => {
  const metadata = parseMetadataObject(entity?.metadata_json)
  const linked = links.filter((link: any) => link.external_entity_id === entity.id)
  const contacts = normalizeLegacyContacts(entity)
  const hasOwner = entity.ownership_mode === 'individual'
    ? Boolean(entity.internal_operator_id)
    : Boolean(entity.internal_team_id)
  const hasPoc = Boolean(contacts.length)
  const hasSecrets = Boolean(entity.secrets?.length)
  const extensionKeys = Object.keys(metadata || {})
  const warnings = [
    !hasOwner ? 'Owner coverage missing' : null,
    !hasPoc ? 'Contact roster missing' : null,
    !hasSecrets && ['API', 'DB', 'Script'].includes(entity.type) ? 'Credential reference missing' : null,
    linked.length === 0 ? 'No dependency mapping' : null,
    !entity.business_purpose ? 'Business purpose missing' : null,
    (entity.internet_exposed || entity.stores_pii) && !entity.third_party_assessment_status ? 'Assessment status missing' : null,
  ].filter(Boolean) as string[]

  return {
    metadata,
    contacts,
    linked,
    externalOwnerLabel: entity.owner_organization || entity.owner_team || 'Unassigned',
    internalOwnerLabel: entity.ownership_mode === 'individual'
      ? entity.internal_operator_name || entity.internal_operator_external_id || 'Unassigned'
      : entity.internal_team_name || 'Unassigned',
    hasOwner,
    hasPoc,
    hasSecrets,
    extensionKeys,
    warnings,
  }
}

const buildExternalMultiSelectPurgeReason = (entities: any[], links: any[] | undefined) => {
  const selectedEntities = entities.filter(Boolean)
  if (selectedEntities.length === 0) {
    return 'Purge is blocked because one or more selected external records are linked or credentialed. Detailed blocker names are not available from the current backend response.'
  }

  const blockerNames = new Set<string>()
  let linkCount = 0
  let credentialCount = 0
  let hasUnavailableDetail = false

  selectedEntities.forEach((entity) => {
    const guard = getExternalEntityPurgeGuard(entity, links)

    if (!guard.blockers.length) {
      hasUnavailableDetail = true
      return
    }

    guard.blockers.forEach((blocker) => {
      if (blocker.blockerEntity === 'external link') {
        linkCount += 1
      } else if (blocker.blockerEntity === 'credential') {
        credentialCount += 1
      }

      if (blocker.blockerName) {
        blockerNames.add(blocker.blockerName)
      } else {
        hasUnavailableDetail = true
      }
    })
  })

  if (linkCount === 0 && credentialCount === 0) {
    return 'Purge is blocked because one or more selected external records are linked or credentialed. Detailed blocker names are not available from the current backend response.'
  }

  const fragments = []
  if (linkCount > 0) {
    fragments.push(`${linkCount} external ${linkCount === 1 ? 'link' : 'links'}`)
  }
  if (credentialCount > 0) {
    fragments.push(`${credentialCount} ${credentialCount === 1 ? 'credential' : 'credentials'}`)
  }

  let message = `Linked to ${fragments.join(' and ')} across ${selectedEntities.length} selected records.`
  const blockerList = Array.from(blockerNames).slice(0, 4)
  if (blockerList.length > 0) {
    message += ` Blockers: ${blockerList.join(', ')}.`
  }
  if (hasUnavailableDetail) {
    message += ' Some blocker names are not available from the current backend response.'
  }

  return message
}

const getExternalEntityPurgeGuard = (entity: any, links: any[] | undefined) => {
  if (!entity || !Array.isArray(links) || !Array.isArray(entity.secrets)) {
    return buildLifecycleDependencyGuardResult({
      summaryReason: 'Purge is blocked because one or more selected external records are linked or credentialed. Detailed blocker names are not available from the current backend response.',
    })
  }
  const insights = getEntityInsights(entity, links)
  const blockers = [
    ...insights.linked.map((link: any, index: number) => ({
      blockerType: 'external_link',
      blockerEntity: 'external link',
      blockerId: link.id ?? `${entity.id}-link-${index}`,
      blockerName: link.service_name || link.device_name || link.purpose || link.external_entity_name || `Link ${index + 1}`,
      relationship: link.direction || 'linked',
      detailTarget: link.service_name || link.device_name || null,
    })),
    ...entity.secrets.map((secret: any, index: number) => ({
      blockerType: 'credential',
      blockerEntity: 'credential',
      blockerId: secret.id ?? `${entity.id}-secret-${index}`,
      blockerName: secret.name || secret.secret_name || secret.label || secret.vault_reference || secret.external_secret_id || secret.type || `Credential ${index + 1}`,
      relationship: secret.status || 'attached',
      detailTarget: secret.vault_provider || null,
    })),
  ]

  return buildLifecycleDependencyGuardResult({
    blockers,
    summaryReason: blockers.length
      ? undefined
      : 'Purge is blocked because one or more selected external records are linked or credentialed. Detailed blocker names are not available from the current backend response.',
  })
}

const MetadataEditor = ({
  value,
  onChange,
  onError,
  allowedKeys = [],
}: {
  value: any
  onChange: (v: any) => void
  onError?: (err: string | null) => void
  allowedKeys?: string[]
}) => {
  const [mode, setMode] = useState<'table' | 'json'>('table')
  const [tableRows, setTableRows] = useState(() => {
    const obj = parseMetadataObject(value)
    return Object.entries(obj).map(([k, v]) => ({ key: k, value: String(v) }))
  })
  const [jsonValue, setJsonValue] = useState(() => JSON.stringify(parseMetadataObject(value), null, 2))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const obj = parseMetadataObject(value)
    setTableRows(Object.entries(obj).map(([k, v]) => ({ key: k, value: String(v) })))
    setJsonValue(JSON.stringify(obj, null, 2))
  }, [value])

  const validateAndNotify = (rows: {key: string, value: string}[]) => {
    const obj: any = {}
    const keys = new Set()
    let hasDuplicate = false
    let invalidReservedKey: string | null = null
    let invalidTypeKey: string | null = null

    rows.forEach(r => {
      if (r.key) {
        if (keys.has(r.key)) hasDuplicate = true
        keys.add(r.key)
        if (reservedMetadataKeys.has(r.key)) invalidReservedKey = r.key
        if (allowedKeys.length > 0 && !allowedKeys.includes(r.key)) invalidTypeKey = r.key
        obj[r.key] = r.value
      }
    })

    if (hasDuplicate) {
        setError("Duplicate keys detected")
        onError?.("Duplicate keys detected")
        return false
    } else if (invalidReservedKey) {
        setError(`${invalidReservedKey} is now a structured field`)
        onError?.(`${invalidReservedKey} is now a structured field`)
        return false
    } else if (invalidTypeKey) {
        setError(`${invalidTypeKey} is not allowed for this external type`)
        onError?.(`${invalidTypeKey} is not allowed for this external type`)
        return false
    } else {
        setError(null)
        onError?.(null)
        setJsonValue(JSON.stringify(obj, null, 2))
        onChange(obj)
        return true
    }
  }

  const syncFromJSON = (json: string) => {
    try {
        const obj = JSON.parse(json)
        const keys = Object.keys(obj)
        const reservedKey = keys.find((key) => reservedMetadataKeys.has(key))
        if (reservedKey) {
          setError(`${reservedKey} is now a structured field`)
          onError?.(`${reservedKey} is now a structured field`)
          return false
        }
        const invalidTypeKey = allowedKeys.length > 0 ? keys.find((key) => !allowedKeys.includes(key)) : null
        if (invalidTypeKey) {
          setError(`${invalidTypeKey} is not allowed for this external type`)
          onError?.(`${invalidTypeKey} is not allowed for this external type`)
          return false
        }
        const rows = Object.entries(obj).map(([k, v]) => ({ key: k, value: String(v) }))
        setTableRows(rows)
        setError(null)
        onError?.(null)
        onChange(obj)
        return true
    } catch (e) {
        setError("Invalid JSON format")
        onError?.("Invalid JSON format")
        return false
    }
  }

  return (
    <div className="bg-slate-900/50 rounded-lg border border-white/5 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/5">
         <div className="flex items-center space-x-3">
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">External Entity Metadata</span>
            {error && <span className="text-[8px] font-bold text-rose-500 uppercase animate-pulse">!! {error}</span>}
         </div>
         <div className="flex bg-black/40 rounded-lg p-1">
            <button onClick={() => setMode('table')} className={`px-2 py-1 rounded-lg transition-all ${mode === 'table' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}><List size={12}/></button>
            <button onClick={() => setMode('json')} className={`px-2 py-1 rounded-lg transition-all ${mode === 'json' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}><FileJson size={12}/></button>
         </div>
      </div>
      <div className="p-4 min-h-[120px]">
        {mode === 'table' ? (
          <div className="space-y-2">
            {tableRows.map((row, i) => (
              <div key={i} className="flex items-center space-x-2">
                <input value={row.key} onChange={e => {
                  const n = [...tableRows]; n[i].key = e.target.value; 
                  setTableRows(n); validateAndNotify(n);
                }} placeholder="Key" className={`flex-1 bg-black/40 border ${error === 'Duplicate keys detected' ? 'border-rose-500/50' : 'border-white/5'} rounded-lg px-3 py-1.5 text-[11px] outline-none focus:border-blue-500`} />
                <input value={row.value} onChange={e => {
                  const n = [...tableRows]; n[i].value = e.target.value; 
                  setTableRows(n); validateAndNotify(n);
                }} placeholder="Values" className="flex-[2] bg-black/40 border border-white/5 rounded-lg px-3 py-1.5 text-[11px] outline-none" />
                <button onClick={() => {
                    const n = tableRows.filter((_, idx) => idx !== i);
                    setTableRows(n); validateAndNotify(n);
                }} className="text-slate-600 hover:text-rose-400 transition-colors"><X size={14}/></button>
              </div>
            ))}
            <button onClick={() => {
                const n = [...tableRows, { key: '', value: '' }];
                setTableRows(n);
            }} className="text-[9px] font-bold text-blue-400 uppercase tracking-widest mt-2 hover:text-blue-300 transition-colors">+ Add Attribute</button>
          </div>
        ) : (
          <textarea value={jsonValue} onChange={e => {
            setJsonValue(e.target.value);
            syncFromJSON(e.target.value);
          }} className={`w-full h-32 bg-black/40 border ${error === 'Invalid JSON format' ? 'border-rose-500/50' : 'border-white/5'} rounded-lg px-4 py-3 text-[11px] font-mono text-blue-300 outline-none`} />
        )}
      </div>
    </div>
  )
}

const MetadataViewer = ({ data }: { data: any }) => {
  let obj: any = {}
  try {
    obj = typeof data === 'string' ? JSON.parse(data || '{}') : (data || {})
  } catch {
    obj = {}
  }
  return (
    <div className="bg-slate-900/50 rounded-lg border border-white/5 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/5">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Metadata Inspection</span>
      </div>
      <table className="w-full text-[10px]">
        <thead className="bg-white/5 border-b border-white/5">
          <tr>
            <th className="px-4 py-2 text-left font-bold uppercase tracking-widest text-slate-500">Key</th>
            <th className="px-4 py-2 text-left font-bold uppercase tracking-widest text-slate-500">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {Object.entries(obj).map(([k, v]) => (
            <tr key={k} className="hover:bg-white/5 transition-colors">
              <td className="px-4 py-3 font-bold uppercase text-blue-400 tracking-tighter w-1/3">{k}</td>
              <td className="px-4 py-3 font-mono text-slate-300">{String(v)}</td>
            </tr>
          ))}
          {Object.keys(obj).length === 0 && (
            <tr><td colSpan={2} className="px-4 py-12 text-center text-slate-600 font-bold uppercase  tracking-widest">No metadata keys defined</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

const POCManager = ({ pocs, onChange }: { pocs: any[], onChange: (newPocs: any[]) => void }) => {
  const addPOC = () => {
    onChange([...pocs, { role: 'Operational', full_name: '', email: '', phone: '', external_person_id: '', is_primary: pocs.length === 0, is_escalation: false }])
  }

  const updatePOC = (index: number, field: string, value: any) => {
    const newPocs = [...pocs]
    newPocs[index] = { ...newPocs[index], [field]: value }
    onChange(newPocs)
  }

  const removePOC = (index: number) => {
    onChange(pocs.filter((_, i) => i !== index))
  }

  return (
    <div className="bg-slate-900/50 rounded-lg border border-white/5 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/5">
        <div className="flex items-center space-x-3">
          <User size={14} className="text-amber-400" />
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Authorized Points of Contact</span>
        </div>
        <button onClick={addPOC} className="px-3 py-1 bg-amber-600/20 hover:bg-amber-600/40 text-amber-400 border border-amber-600/30 rounded-lg text-[8px] font-bold uppercase tracking-widest transition-all">+ Add POC</button>
      </div>
      <div className="p-4 space-y-3">
        {pocs.length === 0 && (
          <div className="py-8 text-center border border-dashed border-white/5 rounded-lg">
            <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest ">No POCs registered</p>
          </div>
        )}
        {pocs.map((poc, idx) => (
          <div key={idx} className="bg-black/40 p-4 rounded-lg border border-white/5 space-y-3 relative group">
            <button onClick={() => removePOC(idx)} className="absolute top-2 right-2 text-slate-600 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"><X size={14}/></button>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[8px] font-bold text-slate-600 uppercase tracking-widest mb-1 block">Full Name</label>
                <input value={poc.full_name} onChange={e => updatePOC(idx, 'full_name', e.target.value)} className="w-full bg-slate-900 border border-white/5 rounded-lg px-3 py-1.5 text-[10px] font-bold text-white outline-none focus:border-amber-500/50" placeholder="Jane Doe" />
              </div>
              <div>
                <label className="text-[8px] font-bold text-slate-600 uppercase tracking-widest mb-1 block">Role</label>
                <StyledSelect
                  value={poc.role}
                  onChange={e => updatePOC(idx, 'role', e.target.value)}
                  options={CONTACT_ROLE_OPTIONS.map((role) => ({ value: role, label: role }))}
                />
              </div>
              <div>
                <label className="text-[8px] font-bold text-slate-600 uppercase tracking-widest mb-1 block">External Contact ID</label>
                <input value={poc.external_person_id} onChange={e => updatePOC(idx, 'external_person_id', e.target.value)} className="w-full bg-slate-900 border border-white/5 rounded-lg px-3 py-1.5 text-[10px] font-bold text-white outline-none focus:border-amber-500/50" placeholder="JD-1234" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="flex items-center space-x-2 bg-slate-900 px-3 py-1.5 rounded-lg border border-white/5">
                <Mail size={10} className="text-slate-500" />
                <input value={poc.email} onChange={e => updatePOC(idx, 'email', e.target.value)} className="flex-1 bg-transparent text-[10px] font-bold text-slate-300 outline-none" placeholder="jane.doe@org.com" />
              </div>
              <div className="flex items-center space-x-2 bg-slate-900 px-3 py-1.5 rounded-lg border border-white/5">
                <Phone size={10} className="text-slate-500" />
                <input value={poc.phone} onChange={e => updatePOC(idx, 'phone', e.target.value)} className="flex-1 bg-transparent text-[10px] font-bold text-slate-300 outline-none" placeholder="+1-555-0199" />
              </div>
            </div>
            <div className="flex items-center gap-4 pt-1">
              <label className="flex items-center gap-2 text-[8px] font-bold uppercase tracking-widest text-slate-500">
                <input type="checkbox" checked={!!poc.is_primary} onChange={e => onChange(pocs.map((entry, entryIndex) => ({ ...entry, is_primary: entryIndex === idx ? e.target.checked : false })))} />
                Primary Contact
              </label>
              <label className="flex items-center gap-2 text-[8px] font-bold uppercase tracking-widest text-slate-500">
                <input type="checkbox" checked={!!poc.is_escalation} onChange={e => updatePOC(idx, 'is_escalation', e.target.checked)} />
                Escalation Contact
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const ExternalSecretsTab = ({ entityId }: { entityId: number }) => {
  const queryClient = useQueryClient()
  const { data: entities } = useQuery({
    queryKey: ['external-entities', { include_deleted: true }],
    queryFn: async () => (await (await apiFetch('/api/v1/intelligence/entities?include_deleted=true')).json())
  })
  const entity = (entities as any[])?.find((e: any) => e.id === entityId)
  const [newSecret, setNewSecret] = useState({
    secret_label: '',
    secret_type: 'VaultReference',
    username: '',
    vault_provider: '',
    vault_path: '',
    note: '',
    credential_status: 'Active',
    rotation_frequency_days: '',
  })
  const [error, setError] = useState('')

  const addMutation = useMutation({
    mutationFn: async (data: any) => apiFetch(`/api/v1/intelligence/entities/${entityId}/secrets`, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ['external-entities'] })
      setNewSecret({ secret_label: '', secret_type: 'VaultReference', username: '', vault_provider: '', vault_path: '', note: '', credential_status: 'Active', rotation_frequency_days: '' })
      setError('')
      showWorkspaceToast('Credential Added')
    }
  })

  const deleteMutation = useMutation({
    mutationFn: async (secretId: number) => apiFetch(`/api/v1/intelligence/entities/${entityId}/secrets/${secretId}`, { method: 'DELETE' }),
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ['external-entities'] })
      showWorkspaceToast('Credential Revoked')
    }
  })

  return (
    <div className="space-y-6">
      <div className="bg-black/40 border border-white/5 rounded-lg p-6 space-y-4">
        <h3 className="text-[10px] font-bold uppercase text-blue-400 tracking-widest flex items-center gap-2">
          <Shield size={12}/> Register Credential Reference
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-[8px] font-bold text-slate-600 uppercase tracking-widest mb-1 block">Credential Label</label>
            <input value={newSecret.secret_label} onChange={e => setNewSecret({...newSecret, secret_label: e.target.value})} placeholder="Partner production token" className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs font-bold text-white outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="text-[8px] font-bold text-slate-600 uppercase tracking-widest mb-1 block">Credential Type</label>
            <StyledSelect value={newSecret.secret_type} onChange={e => setNewSecret({...newSecret, secret_type: e.target.value})} options={SECRET_TYPE_OPTIONS.map((value) => ({ value, label: value }))} />
          </div>
          <div>
            <label className="text-[8px] font-bold text-slate-600 uppercase tracking-widest mb-1 block">Status</label>
            <StyledSelect value={newSecret.credential_status} onChange={e => setNewSecret({...newSecret, credential_status: e.target.value})} options={SECRET_STATUS_OPTIONS.map((value) => ({ value, label: value }))} />
          </div>
          <div>
            <label className="text-[8px] font-bold text-slate-600 uppercase tracking-widest mb-1 block">Username / ID</label>
            <input value={newSecret.username} onChange={e => setNewSecret({...newSecret, username: e.target.value})} placeholder="E.G. ADMIN_SVC" className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs font-bold text-white outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="text-[8px] font-bold text-slate-600 uppercase tracking-widest mb-1 block">Vault Provider</label>
            <StyledSelect value={newSecret.vault_provider} onChange={e => setNewSecret({...newSecret, vault_provider: e.target.value})} options={VAULT_PROVIDER_OPTIONS.map((value) => ({ value, label: value }))} placeholder="Select provider" />
          </div>
          <div>
            <label className="text-[8px] font-bold text-slate-600 uppercase tracking-widest mb-1 block">Vault Path</label>
            <input value={newSecret.vault_path} onChange={e => setNewSecret({...newSecret, vault_path: e.target.value})} placeholder="vault://partner/prod/token" className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs font-bold text-white outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="text-[8px] font-bold text-slate-600 uppercase tracking-widest mb-1 block">Rotation Frequency (Days)</label>
            <input value={newSecret.rotation_frequency_days} onChange={e => setNewSecret({...newSecret, rotation_frequency_days: e.target.value})} placeholder="90" className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs font-bold text-white outline-none focus:border-blue-500" />
          </div>
          <div className="col-span-2">
            <label className="text-[8px] font-bold text-slate-600 uppercase tracking-widest mb-1 block">Purpose / Note</label>
            <input value={newSecret.note} onChange={e => setNewSecret({...newSecret, note: e.target.value})} placeholder="Readonly feed access" className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs font-bold text-white outline-none focus:border-blue-500" />
          </div>
        </div>
        {error && <p className="text-[9px] font-bold text-rose-400">{error}</p>}
        <button 
          disabled={!newSecret.secret_label || (newSecret.secret_type === 'VaultReference' && !newSecret.vault_path)}
          onClick={() => {
            if (!newSecret.secret_label.trim()) {
              setError('Credential label is required')
              return
            }
            if (newSecret.secret_type === 'VaultReference' && !newSecret.vault_path.trim()) {
              setError('Vault path is required for vault-referenced credentials')
              return
            }
            addMutation.mutate({
              ...newSecret,
              vault_provider: newSecret.vault_provider || null,
              vault_path: newSecret.vault_path || null,
              rotation_frequency_days: newSecret.rotation_frequency_days ? parseInt(newSecret.rotation_frequency_days, 10) : null,
            })
          }}
          className="w-full py-3 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all disabled:opacity-30 flex items-center justify-center gap-2"
        >
          {addMutation.isPending ? <RefreshCcw size={14} className="animate-spin" /> : <Plus size={14} />}
          Register Credential Reference
        </button>
      </div>

      <div className="bg-slate-900/50 rounded-lg border border-white/5 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/5">
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Authorized Credential Matrix</span>
          <span className="text-[8px] font-bold text-blue-500 uppercase bg-blue-500/10 px-2 py-0.5 rounded-lg">{entity?.secrets?.length || 0} Entries</span>
        </div>
        <table className="w-full text-left">
          <thead>
            <tr className="bg-white/5 border-b border-white/5">
              <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-500">Label</th>
              <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-500">Vault Path</th>
              <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-500">Status</th>
              <th className="px-4 py-3 text-right text-[9px] font-bold uppercase tracking-widest text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {entity?.secrets?.map((s: any) => (
              <tr key={s.id} className="hover:bg-white/5 transition-colors group">
                <td className="px-4 py-3 text-[10px] font-bold text-white">{s.secret_label}</td>
                <td className="px-4 py-3 font-mono text-[10px] text-blue-400/80">{s.vault_path || 'Legacy inline secret'}</td>
                <td className="px-4 py-3 text-[10px] text-slate-400 font-medium ">{s.credential_status || 'Active'}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => deleteMutation.mutate(s.id)} className="p-1.5 text-slate-600 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100">
                    <Trash2 size={14}/>
                  </button>
                </td>
              </tr>
            ))}
            {(!entity?.secrets || entity.secrets.length === 0) && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-slate-600 font-bold uppercase  tracking-widest text-[9px]">No credentials stored for this identity</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const ExternalForm = ({
  initialData,
  onSave,
  isSaving,
  options,
  teams,
  operators,
  backendFieldErrors = {},
  clearBackendFieldError,
  formId = 'external-entity-form',
  renderActions = true,
  ...formProps
}: {
  initialData: any
  onSave: (data: any) => void
  isSaving: boolean
  options: any
  teams: any
  operators: any
  backendFieldErrors?: Record<string, string>
  clearBackendFieldError?: (field: string) => void
  formId?: string
  renderActions?: boolean
} & OperationalFormProps) => {
  const { onDirtyChange } = formProps
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const fieldErrors = useMemo(
    () => mergeOperationalFieldErrors(backendFieldErrors || {}, errors),
    [backendFieldErrors, errors]
  )
  const initialFormState = useMemo(() => {
    const normalizedContacts = normalizeLegacyContacts(initialData || {})
    return {
      name: initialData?.name || '',
      aliases_json: initialData?.aliases_json || [],
      type: initialData?.type || 'API',
      owner_organization: initialData?.owner_organization || '',
      owner_team: initialData?.owner_team || '',
      ownership_mode: initialData?.ownership_mode || 'team',
      internal_team_id: initialData?.internal_team_id ? String(initialData.internal_team_id) : '',
      internal_operator_id: initialData?.internal_operator_id ? String(initialData.internal_operator_id) : '',
      status: initialData?.status || 'Planned',
      environment: initialData?.environment || 'Production',
      description: initialData?.description || '',
      notes: initialData?.notes || '',
      contacts_json: normalizedContacts,
      business_purpose: initialData?.business_purpose || '',
      metadata_json: parseMetadataObject(initialData?.metadata_json),
    }
  }, [initialData])

  const getOptions = (cat: string) => Array.isArray(options) ? options.filter((o: any) => o.category === cat) : []
  const ensureCurrentOption = (entries: Array<{ value: string; label: string }>, currentValue: string) => {
    if (!currentValue) return entries
    return entries.some((entry) => entry.value === currentValue)
      ? entries
      : [{ value: currentValue, label: currentValue }, ...entries]
  }
  const resolveAllowedMetadataKeys = useCallback((typeValue: string) => {
    const availableTypeOptions = getOptions('ExternalType')
    const resolvedTypeOptions = availableTypeOptions.length ? availableTypeOptions : FALLBACK_EXTERNAL_TYPE_OPTIONS
    const selectedOption = resolvedTypeOptions.find((type: any) => type.value === typeValue)
    return (selectedOption as any)?.metadata_keys || (extensionMetadataKeysByType as any)[typeValue] || []
  }, [options])

  const normalizeExternalFormSnapshot = useCallback((value: any) => {
    const allowedKeys = resolveAllowedMetadataKeys(value.type)
    return {
      ...value,
      metadata_json: Object.fromEntries(
        Object.entries(parseMetadataObject(value.metadata_json)).filter(([key]) => allowedKeys.length === 0 || allowedKeys.includes(key))
      ),
    }
  }, [resolveAllowedMetadataKeys])

  const {
    value: formData,
    patchValue,
    normalize,
  } = useOperationalFormDirty(initialFormState, normalizeExternalFormSnapshot, onDirtyChange)

  const externalTypeOptions = getOptions('ExternalType')
  const types = ensureCurrentOption(externalTypeOptions.length ? externalTypeOptions : FALLBACK_EXTERNAL_TYPE_OPTIONS, formData.type)
  const statusOptions = ensureCurrentOption(getOptions('Status'), formData.status)
  const envOptions = ensureCurrentOption(getOptions('Environment'), formData.environment)
  const selectedTypeOption = types.find((type: any) => type.value === formData.type)
  const allowedMetadataKeys = (selectedTypeOption as any)?.metadata_keys || (extensionMetadataKeysByType as any)[formData.type] || []

  useEffect(() => {
    if (!allowedMetadataKeys.length) return
    const nextMeta = { ...parseMetadataObject(formData.metadata_json) }
    let changed = false
    for (const key of allowedMetadataKeys) {
      if (!(key in nextMeta)) {
        nextMeta[key] = ''
        changed = true
      }
    }
    const filteredMeta = Object.fromEntries(Object.entries(nextMeta).filter(([key]) => allowedMetadataKeys.includes(key)))
    if (JSON.stringify(filteredMeta) !== JSON.stringify(formData.metadata_json)) changed = true
    if (changed) {
      normalize({ ...formData, metadata_json: filteredMeta })
    }
  }, [allowedMetadataKeys, formData, normalize])

  const updateField = (key: string, value: any) => {
    patchValue({ [key]: value } as Partial<typeof formData>)
    setErrors((prev) => ({ ...prev, [key]: '' }))
    clearBackendFieldError?.(key)
  }

  const inputClass = (field: string) => `w-full bg-slate-900 border ${fieldErrors[field] ? 'border-rose-500/50 bg-rose-500/5' : 'border-white/10'} rounded-lg px-4 py-2.5 text-xs font-bold text-white outline-none focus:border-blue-500 transition-all`

  const validate = () => {
    const nextErrors: Record<string, string> = {}
    if (!formData.name.trim()) nextErrors.name = 'Name is required'
    // Optional on frontend, backend guides final validation
    // if (formData.ownership_mode === 'team' && !formData.internal_team_id) nextErrors.internal_team_id = 'Accountable team is required'
    // if (formData.ownership_mode === 'individual' && !formData.internal_operator_id) nextErrors.internal_operator_id = 'Accountable operator is required'
    if (!formData.business_purpose.trim()) nextErrors.business_purpose = 'Business purpose is required'
    if (!formData.contacts_json.length) nextErrors.contacts_json = 'At least one contact is required'
    if (formData.contacts_json.filter((contact: any) => contact.is_primary).length > 1) nextErrors.contacts_json = 'Only one primary contact is allowed'
    if (metadataError) nextErrors.metadata_json = metadataError
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSubmit = () => {
    if (!validate()) return
    onSave({
      ...formData,
      id: initialData?.id || undefined,
      internal_team_id: formData.ownership_mode === 'team' && formData.internal_team_id ? parseInt(formData.internal_team_id, 10) : null,
      internal_operator_id: formData.ownership_mode === 'individual' && formData.internal_operator_id ? parseInt(formData.internal_operator_id, 10) : null,
    })
  }

  return (
    <form
      id={formId}
      className="space-y-8 py-6"
      onSubmit={(event) => {
        event.preventDefault()
        handleSubmit()
      }}
    >
      <div className="grid grid-cols-2 gap-8">
        <div className="space-y-4">
          <h3 className="text-[10px] font-bold uppercase text-slate-500 tracking-widest border-l-2 border-blue-600 pl-3">Identity & Classification</h3>
          <div>
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1 px-1">Entity Name *</label>
            <input value={formData.name} onChange={e => updateField('name', e.target.value)} className={inputClass('name')} placeholder="customer-feed-api" />
            {fieldErrors.name && <p className="mt-1 px-1 text-[9px] font-bold text-rose-400">{fieldErrors.name}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <StyledSelect label="Type" value={formData.type} onChange={e => updateField('type', e.target.value)} options={types} error={fieldErrors.type} />
            <StyledSelect label="Operational Status" value={formData.status} onChange={e => updateField('status', e.target.value)} options={statusOptions} error={fieldErrors.status} />
          </div>
          <StyledSelect label="Environment" value={formData.environment} onChange={e => updateField('environment', e.target.value)} options={envOptions} error={fieldErrors.environment} />
        </div>

        <div className="space-y-4">
          <h3 className="text-[10px] font-bold uppercase text-slate-500 tracking-widest border-l-2 border-emerald-600 pl-3">Ownership & Scope</h3>
          <div>
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1 px-1">External Organization</label>
            <input value={formData.owner_organization} onChange={e => updateField('owner_organization', e.target.value)} className={inputClass('owner_organization')} placeholder="PartnerCo" />
            {fieldErrors.owner_organization && <p className="mt-1 px-1 text-[9px] font-bold text-rose-400">{fieldErrors.owner_organization}</p>}
          </div>
          <div>
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1 px-1">External Team Label</label>
            <input value={formData.owner_team} onChange={e => updateField('owner_team', e.target.value)} className={inputClass('owner_team')} placeholder="B2B Platform" />
            {fieldErrors.owner_team && <p className="mt-1 px-1 text-[9px] font-bold text-rose-400">{fieldErrors.owner_team}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <StyledSelect label="Accountable Owner Mode" value={formData.ownership_mode} onChange={e => updateField('ownership_mode', e.target.value)} options={ACCOUNTABLE_OWNER_OPTIONS} error={fieldErrors.ownership_mode} />
            {formData.ownership_mode === 'team' ? (
              <StyledSelect
                label="Accountable Team"
                value={formData.internal_team_id}
                onChange={e => updateField('internal_team_id', e.target.value)}
                options={(teams || []).filter((team: any) => !team.is_archived).map((team: any) => ({ value: String(team.id), label: team.name }))}
                error={fieldErrors.internal_team_id}
                placeholder="Select team"
              />
            ) : (
              <StyledSelect
                label="Accountable Operator"
                value={formData.internal_operator_id}
                onChange={e => updateField('internal_operator_id', e.target.value)}
                options={(operators || []).map((operator: any) => ({ value: String(operator.id), label: operator.full_name || operator.username || operator.external_id }))}
                error={fieldErrors.internal_operator_id}
                placeholder="Select operator"
              />
            )}
          </div>
          <p className="px-1 text-[9px] text-slate-500 italic">Optional internal accountability mapping for SysGrid operations.</p>
          {(fieldErrors.internal_team_id || fieldErrors.internal_operator_id) && (
            <p className="px-1 text-[9px] font-bold text-rose-400">{fieldErrors.internal_team_id || fieldErrors.internal_operator_id}</p>
          )}
          <div>
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1 px-1">Business Purpose *</label>
            <textarea value={formData.business_purpose} onChange={e => updateField('business_purpose', e.target.value)} className={`${inputClass('business_purpose')} h-24 resize-none`} placeholder="What business capability depends on this external entity?" />
            {fieldErrors.business_purpose && <p className="mt-1 px-1 text-[9px] font-bold text-rose-400">{fieldErrors.business_purpose}</p>}
          </div>
          <div>
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1 px-1">Functional Description</label>
            <textarea value={formData.description} onChange={e => updateField('description', e.target.value)} className={`${inputClass('description')} h-24 resize-none`} placeholder="Operational context for this external dependency" />
            {fieldErrors.description && <p className="mt-1 px-1 text-[9px] font-bold text-rose-400">{fieldErrors.description}</p>}
          </div>
        </div>

        <div className="col-span-2">
          <POCManager pocs={formData.contacts_json || []} onChange={newPocs => updateField('contacts_json', newPocs)} />
          {(fieldErrors.contacts_json || metadataError) && <p className="mt-2 px-1 text-[9px] font-bold text-rose-400">{fieldErrors.contacts_json}</p>}
        </div>

        <div className="col-span-2">
          <MetadataEditor value={formData.metadata_json} onChange={v => updateField('metadata_json', v)} onError={setMetadataError} allowedKeys={allowedMetadataKeys} />
          {fieldErrors.metadata_json && <p className="mt-2 px-1 text-[9px] font-bold text-rose-400">{fieldErrors.metadata_json}</p>}
        </div>
      </div>

      {renderActions ? (
        <div className="flex space-x-4 pt-4 border-t border-white/5">
          <button
            type="submit"
            disabled={isSaving}
            className="flex-1 py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-[11px] font-bold uppercase tracking-[0.2em] shadow-xl shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center space-x-3"
          >
            {isSaving && <RefreshCcw size={18} className="animate-spin" />}
            <span>{initialData.id ? 'Synchronize Entity Manifest' : 'Authorize External Registry Admission'}</span>
          </button>
        </div>
      ) : null}
    </form>
  )
}

const ExternalDetailsView = ({
  entity,
  links,
}: {
  entity: any
  links: any[]
}) => {
  const insights = useMemo(() => getEntityInsights(entity, links), [entity, links])
  const summaryFacts = [
    ['Business purpose', entity.business_purpose || 'Not documented'],
    ['Type', entity.type || 'Unspecified'],
    ['Environment', entity.environment || 'Unspecified'],
    ['Accountable owner', insights.internalOwnerLabel],
  ]

  return (
    <WorkspaceSplitView
      className="gap-8"
      sidebar={
        <div className="space-y-8">
          <section className="space-y-3">
            <h3 className="px-1 text-[11px] font-black text-slate-500 uppercase tracking-widest">Target scope</h3>
            <div className="space-y-3">
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 shadow-inner">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest">External identity</p>
                  <Globe size={10} className="text-blue-500/50" />
                </div>
                <p className="text-[11px] font-black text-slate-100">{entity.name}</p>
                <p className="mt-1 text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                  {entity.external_key || 'No external key'} · {entity.status || 'Unknown'}
                </p>
              </div>

              <div className="bg-black/20 border border-white/5 rounded-lg p-4 shadow-inner space-y-3">
                <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Contacts</p>
                <div className="flex flex-wrap gap-1.5">
                  {insights.contacts.length > 0 ? (
                    insights.contacts.map((contact: any, index: number) => (
                      <span
                        key={`${contact.external_person_id || contact.full_name || index}`}
                        className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-300"
                      >
                        {contact.full_name}
                      </span>
                    ))
                  ) : (
                    <span className="text-[9px] font-bold text-slate-700 italic">No contacts defined</span>
                  )}
                </div>
              </div>

              <div className="bg-black/20 border border-white/5 rounded-lg p-4 shadow-inner space-y-3">
                <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Dependencies</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-white/5 bg-white/[0.03] p-3">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">Links</p>
                    <p className="mt-1 text-[12px] font-black text-blue-400">{insights.linked.length}</p>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-white/[0.03] p-3">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">Warnings</p>
                    <p className={`mt-1 text-[12px] font-black ${insights.warnings.length ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {insights.warnings.length}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => window.location.href = `/logs?target_table=external_entities&target_id=${entity.id}`}
                  className="w-full rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-indigo-300 transition-colors hover:bg-indigo-500/20"
                >
                  Open audit logs
                </button>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="px-1 text-[11px] font-black text-slate-500 uppercase tracking-widest">Credentials</h3>
            <div className="bg-black/20 border border-white/5 rounded-lg p-4 shadow-inner">
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Stored secrets</p>
                <span className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-emerald-300">
                  {entity.secrets?.length || 0}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {entity.secrets?.length ? (
                  entity.secrets.map((secret: any) => (
                    <div key={secret.id} className="rounded-lg border border-white/5 bg-white/[0.03] p-3">
                      <p className="text-[10px] font-bold text-slate-100">{secret.secret_label}</p>
                      <p className="mt-1 text-[8px] font-bold uppercase tracking-widest text-slate-500">
                        {secret.credential_status || 'Active'} · {secret.vault_provider || 'Inline'}
                      </p>
                    </div>
                  ))
                ) : (
                  <WorkspaceEmptyState compact title="No credentials stored" description="This external identity has no credential references yet." />
                )}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="px-1 text-[11px] font-black text-slate-500 uppercase tracking-widest">Operational meta</h3>
            <div className="bg-white/5 border border-white/5 rounded-lg overflow-hidden divide-y divide-white/5 shadow-inner">
              {[
                { label: 'Criticality', value: entity.criticality || 'Low', color: 'text-rose-400', icon: Bell },
                { label: 'Risk', value: entity.risk_rating || 'Low', color: 'text-amber-400', icon: Shield },
                { label: 'Tier', value: entity.dependency_tier || 'Tier 3', color: 'text-blue-400', icon: Layers },
              ].map((stat, index) => (
                <div key={`${stat.label}-${index}`} className="flex items-center justify-between p-3 transition-all hover:bg-white/5">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-black/40 p-1.5 text-slate-600">
                      <stat.icon size={12} />
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">{stat.label}</span>
                  </div>
                  <span className={`text-[10px] font-black ${stat.color}`}>{stat.value}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      }
      main={
        <div className="space-y-8">
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              { label: 'Linked dependencies', value: insights.linked.length, tone: 'text-blue-400' },
              { label: 'Stored credentials', value: entity.secrets?.length || 0, tone: 'text-emerald-400' },
              { label: 'Contacts', value: insights.contacts.length, tone: 'text-amber-400' },
              { label: 'Warnings', value: insights.warnings.length, tone: insights.warnings.length ? 'text-rose-400' : 'text-slate-400' },
            ].map((card) => (
              <div key={card.label} className="rounded-lg border border-white/5 bg-white/[0.03] p-5 shadow-inner">
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">{card.label}</p>
                <p className={`mt-2 text-3xl font-black ${card.tone}`}>{card.value}</p>
              </div>
            ))}
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-white/5 bg-white/[0.03] p-5 shadow-inner">
              <div className="flex items-center gap-3 mb-3">
                <div className="rounded-lg bg-blue-500/10 p-2 text-blue-400">
                  <Info size={14} />
                </div>
                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300">Mission Summary</h4>
              </div>
              <p className="pl-1 text-[12px] font-bold leading-relaxed text-slate-400">
                {entity.business_purpose || entity.description || 'Not documented'}
              </p>
            </div>

            <div className="rounded-lg border border-white/5 bg-white/[0.03] p-5 shadow-inner">
              <div className="flex items-center gap-3 mb-3">
                <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400">
                  <Briefcase size={14} />
                </div>
                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300">Ownership Context</h4>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {summaryFacts.map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-white/5 bg-black/30 p-3">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">{label}</p>
                    <p className="mt-1 break-words text-[10px] font-black text-white">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-slate-800 p-2 text-slate-400">
                  <Users size={16} />
                </div>
                <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-white">Contact Matrix</h3>
              </div>
            </div>
            <div className="rounded-lg border border-white/5 bg-black/20 overflow-hidden">
              <div className="divide-y divide-white/5">
                {insights.contacts.length ? insights.contacts.map((contact: any) => (
                  <div key={contact.external_person_id || contact.full_name} className="flex items-center justify-between gap-4 p-4 hover:bg-white/5">
                    <div className="min-w-0">
                      <p className="truncate text-[10px] font-black uppercase text-white">{contact.full_name}</p>
                      <p className="mt-1 text-[8px] font-black uppercase tracking-widest text-slate-500">
                        {contact.role}{contact.external_person_id ? ` · ${contact.external_person_id}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => contact.email && (window.location.href = `mailto:${contact.email}`)} className="text-slate-500 transition-colors hover:text-amber-400">
                        <Mail size={12} />
                      </button>
                      <button onClick={() => contact.phone && (window.location.href = `tel:${contact.phone}`)} className="text-slate-500 transition-colors hover:text-amber-400">
                        <Phone size={12} />
                      </button>
                    </div>
                  </div>
                )) : (
                  <WorkspaceEmptyState compact title="No contacts defined" description="Accountable contacts have not been registered." />
                )}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-3 px-1">
              <div className="rounded-lg bg-blue-600/10 p-2 text-blue-400">
                <Share2 size={16} />
              </div>
              <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-white">Dependency Matrix</h3>
            </div>
            <div className="rounded-lg border border-white/5 bg-black/20 overflow-hidden">
              <div className="divide-y divide-white/5">
                {insights.linked.length ? insights.linked.map((link: any) => (
                  <div key={link.id} className="flex items-center justify-between gap-4 p-4 hover:bg-white/5">
                    <div className="space-y-1">
                      <p className="text-[10px] font-black uppercase text-white">
                        {link.device_name || 'Unknown asset'}
                        {link.service_name ? ` // ${link.service_name}` : ''}
                      </p>
                      <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">
                        {link.direction} · {link.protocol || 'Unknown protocol'} · {link.port || 'No port'} · {link.purpose || 'No purpose documented'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => window.location.href = `/asset?id=${link.device_id}`}
                        className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-[8px] font-black uppercase tracking-widest text-blue-400"
                      >
                        Asset
                      </button>
                      {link.service_id && (
                        <button
                          onClick={() => window.location.href = `/services?id=${link.service_id}`}
                          className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[8px] font-black uppercase tracking-widest text-emerald-400"
                        >
                          Service
                        </button>
                      )}
                    </div>
                  </div>
                )) : (
                  <WorkspaceEmptyState compact title="No dependency links mapped yet" description="Use the map link action to register interconnects." />
                )}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-3 px-1">
              <div className="rounded-lg bg-slate-800 p-2 text-slate-400">
                <List size={16} />
              </div>
              <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-white">Metadata</h3>
            </div>
            <MetadataViewer data={entity.metadata_json} />
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-3 px-1">
              <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400">
                <Key size={16} />
              </div>
              <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-white">Credentials</h3>
            </div>
            <ExternalSecretsTab entityId={entity.id} />
          </section>
        </div>
      }
    />
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

function CompareExternalModal({ items, onClose }: { items: any[]; onClose: () => void }) {
  useEscapeDismiss(onClose)
  useBodyModalFlag()
  const [isMaximized, setIsMaximized] = useState(false)
  const fields = useMemo(() => [
    { label: 'Status', getValue: (item: any) => item.status || 'Unknown' },
    { label: 'Type', getValue: (item: any) => item.type || 'N/A' },
    { label: 'Subtype', getValue: (item: any) => item.subtype || 'N/A' },
    { label: 'Environment', getValue: (item: any) => item.environment || 'N/A' },
    { label: 'Criticality', getValue: (item: any) => item.criticality || 'N/A' },
    { label: 'Risk Rating', getValue: (item: any) => item.risk_rating || 'N/A' },
    { label: 'Dependency Tier', getValue: (item: any) => item.dependency_tier || 'N/A' },
    { label: 'Organization', getValue: (item: any) => item.owner_organization || 'N/A' },
    { label: 'Accountable Team', getValue: (item: any) => item.owner_team || 'N/A' },
    { label: 'Endpoint (Primary)', getValue: (item: any) => item.primary_endpoint_url || 'N/A' },
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
      title="Compare External Identities"
      subtitle={`Temporal Variance Analysis · Comparing ${items.length} external states for semantic drift`}
      icon={<GitCompare size={20} />}
    >
      <WorkspaceCompareShell
        body={
          <div className={`grid gap-4 ${gridCols}`}>
            {items.map((item: any) => (
              <div key={item.id} className="rounded-lg border border-white/5 bg-black/40 p-5 shadow-inner">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[9px] font-black text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/20">ID {item.id}</span>
                  <span className={`rounded-lg border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest ${
                    item.status === 'Active'
                      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                      : 'border-amber-500/20 bg-amber-500/10 text-amber-300'
                  }`}>
                    {item.status || 'Unknown'}
                  </span>
                </div>
                <h4 className="text-sm font-black text-white truncate mb-1">{item.name}</h4>
                <p className="text-[9px] font-bold text-slate-500 tracking-widest truncate">{item.owner_organization || 'No Organization'}</p>
                
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

const getFriendlyRestoreError = (msg: string): string => {
  let messageText = msg
  try {
    const parsed = JSON.parse(msg)
    if (parsed && typeof parsed === 'object') {
      messageText = parsed.detail || parsed.message || parsed.error || msg
    }
  } catch (e) {
    // Not JSON, use as-is
  }

  if (messageText.includes("cannot be restored without an accountable operator") || messageText.includes("accountable operator is missing")) {
    return "This archived entity cannot be restored because its accountable operator is missing. Please edit the entity first to assign an active operator."
  }
  if (messageText.includes("cannot be restored without an accountable team") || messageText.includes("accountable team is missing") || messageText.includes("without an accountable internal team")) {
    return "This archived entity cannot be restored because its accountable team is missing or archived. Please edit the entity first to assign an active team."
  }
  if (messageText.includes("Internal accountable team is required")) {
    return "An internal accountable team is required under Team ownership mode. Please assign a valid active team."
  }
  if (messageText.includes("Internal accountable operator is required")) {
    return "An internal accountable operator is required under Individual ownership mode. Please assign a valid active operator."
  }
  return messageText
}

export default function External() {
  const { confirm: confirmWorkspace, confirmation } = useWorkspaceConfirmation()
  const externalStorageNamespace = 'sysgrid_external'
  const externalViewStorageKey = `${externalStorageNamespace}_views_v1`
  const externalActiveViewKey = `${externalStorageNamespace}_active_view_v1`
  const externalUiStateKey = `${externalStorageNamespace}_ui_state_v1`
  const externalFavoritesKey = `${externalStorageNamespace}_favorites_v1`
  const externalWatchKey = `${externalStorageNamespace}_watch_v1`
  const externalLastVisitedKey = `${externalStorageNamespace}_last_visited_v1`
  const externalViewLabel = 'External'
  const externalRegistryLabel = 'External Registry'
  const queryClient = useQueryClient()
  const gridRef = useRef<any>(null)
  const [, setGridApi] = useState<any>(null)
  const [, setGridColumnApi] = useState<any>(null)
  const [savedViews, setSavedViews] = usePersistentJsonState(externalViewStorageKey, [] as any[])
  const [activeViewId, setActiveViewId] = usePersistentJsonState<string | null>(externalActiveViewKey, null)
  const [persistedUiState, setPersistedUiState] = usePersistentJsonState(externalUiStateKey, () => normalizeExternalWorkspaceState(null))
  const [fontSize, setFontSize] = useState(persistedUiState.fontSize)
  const [rowDensity, setRowDensity] = useState(persistedUiState.rowDensity)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showFilterBar, setShowFilterBar] = useState(persistedUiState.showFilterBar ?? true)
  const [isIntelligenceExpanded, setIsIntelligenceExpanded] = useState(false)
  const [lastVisitedAt] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem(externalLastVisitedKey)
      return raw ? Number(raw) : 0
    } catch { return 0 }
  })
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(persistedUiState.hiddenColumns ?? ['created_at', 'updated_at'])
  const [showConfig, setShowConfig] = useState(false)
  const [activeTab, setActiveTab] = useState<ExternalActiveTab>(normalizeExternalActiveTab(persistedUiState.activeTab))
  const [activeModal, setActiveModal] = useState<any>(null)
  const [isActiveModalDirty, setIsActiveModalDirty] = useState(false)
  const [activeModalBackendFieldErrors, setActiveModalBackendFieldErrors] = useState<Record<string, string>>({})
  const [activeDetails, setActiveDetails] = useState<any>(null)
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [showExternalDataDiagnostic, setShowExternalDataDiagnostic] = useState(false)
  const [linkSeedEntityId, setLinkSeedEntityId] = useState<number | null>(null)
  const [editingLink, setEditingLink] = useState<any>(null)
  const [isWorkspaceMaximized, setIsWorkspaceMaximized] = useState(false)
  const [searchTerm, setSearchTerm] = useState(persistedUiState.searchTerm)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  // Cloned states from Monitoring view
  const [groupBy, setGroupBy] = useState<string>(persistedUiState.groupBy || 'raw')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [favoriteIds, setFavoriteIds] = usePersistentJsonState<number[]>(externalFavoritesKey, [])
  const [watchIds, setWatchIds] = usePersistentJsonState<number[]>(externalWatchKey, [])
  const normalizedFavoriteIds = useMemo(() => favoriteIds.map(Number), [favoriteIds])
  const normalizedWatchIds = useMemo(() => watchIds.map(Number), [watchIds])
  const [compareOpen, setCompareOpen] = useState(false)
  const [isBulkStatusOpen, setIsBulkStatusOpen] = useState(false)
  const [isBulkEnvOpen, setIsBulkEnvOpen] = useState(false)
  const [isBulkCriticalityOpen, setIsBulkCriticalityOpen] = useState(false)
  const [isBulkRiskOpen, setIsBulkRiskOpen] = useState(false)
  const [bulkDraft, setBulkDraft] = useState({ status: '', environment: '', criticality: '', risk_rating: '' })
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
  const [expandedBulkSection, setExpandedBulkSection] = useState<'status' | 'environment' | 'criticality' | 'risk_rating' | null>(null)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [rowActionMenu, setRowActionMenu] = useState<{ item: any; point: { x: number; y: number } } | null>(null)
  const [rowDeleteConfirmId, setRowDeleteConfirmId] = useState<number | null>(null)
  const {
    activeOverlay,
    isOverlayOpen,
    openOverlay,
    toggleOverlay,
    dismissOverlays,
  } = useWorkspaceOverlayController()
  const showDisplayMenu = isOverlayOpen('display')
  const showViewsMenu = isOverlayOpen('views')
  const showBulkMenu = isOverlayOpen('bulk')
  const hasRowActionMenu = activeOverlay === 'rowAction' && !!rowActionMenu

  const [quickFilters, setQuickFilters] = useState(persistedUiState.quickFilters || {
    status: [] as string[],
    type: [] as string[],
    environment: [] as string[],
    owner: [] as string[],
    direction: [] as string[],
    protocol: [] as string[],
  })
  const [gridFilterModel, setGridFilterModel] = useState<Record<string, any>>(persistedUiState.filterModel || {})
  const [gridSortModel, setGridSortModel] = useState<Array<{ colId: string; sort: string }>>(persistedUiState.sortModel || [])
  const [newViewName, setNewViewName] = useState('')
  const [pendingGridRestore, setPendingGridRestore] = useState<any | null>(null)
  const pendingRestoreTimeoutRef = useRef<number | null>(null)
  const externalUndoRef = useRef<any>(null)

  const [isLinkFormDirty, setIsLinkFormDirty] = useState(false)
  const [isConfigDirty, setIsConfigDirty] = useState(false)

  const isWorkspaceDirty = useMemo(() => {
    return isActiveModalDirty || isLinkFormDirty || isConfigDirty || (showViewsMenu && newViewName.trim() !== '')
  }, [isActiveModalDirty, isLinkFormDirty, isConfigDirty, showViewsMenu, newViewName])

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean
    title: string
    message: string
    confirmText?: string
    onConfirm?: () => void
    onClose?: () => void
    variant?: 'danger' | 'info' | 'warning' | 'success'
  }>({ isOpen: false, title: '', message: '' })


  usePageLeaveGuard(isWorkspaceDirty)

  const { triggerRef: displayMenuButtonRef, panelRef: displayMenuPanelRef, panelStyle: displayMenuStyle } = useWorkspaceAnchoredLayer(showDisplayMenu, { minWidth: 320 })
  const { triggerRef: viewsMenuButtonRef, panelRef: viewsMenuPanelRef, panelStyle: viewsMenuStyle } = useWorkspaceAnchoredLayer(showViewsMenu, { minWidth: 420 })
  const { triggerRef: bulkMenuButtonRef, panelRef: bulkMenuPanelRef, panelStyle: bulkMenuStyle } = useWorkspaceAnchoredLayer(showBulkMenu, { minWidth: 340 })

  useEffect(() => {
    if (!activeModal) setIsActiveModalDirty(false)
  }, [activeModal])

  useEffect(() => {
    setActiveModalBackendFieldErrors({})
  }, [activeModal?.id])

  const {
    columnLayoutState,
    setColumnLayoutState,
    preserveExplicitColumnWidths,
    applyColumnLayoutState,
    syncColumnLayoutState,
    handleColumnResized,
    handleColumnMoved,
    handleDragStopped,
    handleColumnPinned,
    handleColumnVisible,
    handleGridReady,
    handleFilterChanged,
    handleSortChanged,
  } = useOperationalGridRuntime({
    initialColumnLayoutState: persistedUiState.columnLayoutState ?? [],
    hasSavedViewWidths: Boolean(activeViewId),
    pendingGridRestore,
    applyGridState: (config) => {
      const api = gridRef.current?.api
      if (!api) return
      applyColumnLayoutState(api, config.columnLayoutState, true)
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
    sanitizeFilterModel: (model) => sanitizeOperationalFilterModel(model, EXTERNAL_PERSISTED_COLUMN_IDS),
    sanitizeSortModel: (model) => sanitizeOperationalSortModel(model, EXTERNAL_PERSISTED_COLUMN_IDS),
    layoutPolicy: OPERATIONAL_GRID_LAYOUT_POLICIES.standard,
    onGridApiReady: (params) => {
      setGridApi(params.api)
      setGridColumnApi(params.columnApi)
    },
  })
  const { data: options } = useQuery({ 
    queryKey: ['settings-options'], 
    queryFn: async () => (await (await apiFetch('/api/v1/settings/options')).json()) 
  })
  const { data: teams } = useQuery({
    queryKey: ['teams'],
    queryFn: async () => (await (await apiFetch('/api/v1/settings/teams')).json())
  })
  const { data: operators } = useQuery({
    queryKey: ['operators'],
    queryFn: async () => (await (await apiFetch('/api/v1/settings/operators')).json())
  })

  const { data: allEntities, isLoading, isError: isEntityError, error: entityError } = useQuery({
    queryKey: ['external-entities', { include_deleted: true }],
    queryFn: async () => (await (await apiFetch('/api/v1/intelligence/entities?include_deleted=true')).json())
  })


  const detailRoute = useOperationalDetailRoute({
    allItems: allEntities,
    detailItem: activeDetails,
    setDetailItem: setActiveDetails,
    isEditOpen: !!activeModal,
    isHistoryOpen: false,
    isLinkOpen: showLinkModal,
    setActiveTab,
  })

  const closeDetails = () => {
    detailRoute.closeDetail()
  }


  const { data: links, isLoading: linkLoading, isError: isLinkError, error: linkError } = useQuery({ 
    queryKey: ['external-links'], 
    queryFn: async () => (await (await apiFetch('/api/v1/intelligence/links')).json()) 
  })

  const { data: devices } = useQuery({ 
    queryKey: ['devices'], 
    queryFn: async () => (await (await apiFetch('/api/v1/devices/')).json()) 
  })

  const findExternalEntityById = useCallback((id: number) => {
    return allEntities?.find((entity: any) => entity.id === id) || null
  }, [allEntities])

  const isExternalEntityPurgeable = useCallback((entity: any) => {
    return getExternalEntityPurgeGuard(entity, links).canPurge
  }, [links])

  const getExternalEntityPurgeReason = useCallback((entity: any) => {
    const result = getExternalEntityPurgeGuard(entity, links)
    return result.canPurge ? undefined : formatLifecycleDependencyTooltipReason(result)
  }, [links])

  const canPurgeSelectedDeletedEntities = useMemo(() => {
    if (activeTab !== 'deleted' || selectedIds.length === 0) return false
    return selectedIds.every((id) => isExternalEntityPurgeable(findExternalEntityById(id)))
  }, [activeTab, findExternalEntityById, isExternalEntityPurgeable, selectedIds])

  const dismissWorkspaceMenus = useCallback(() => {
    if (showViewsMenu && newViewName.trim() !== '') {
      setConfirmModal({
        isOpen: true,
        title: 'Unsaved View Name',
        message: 'You have typed a new view name. Discard it and close the menu?',
        confirmText: 'Discard & Close',
        variant: 'warning',
        onConfirm: () => {
          setNewViewName('')
          dismissOverlays()
        }
      })
      return
    }
    dismissOverlays()
  }, [dismissOverlays, showViewsMenu, newViewName])

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

  const { handleCellContextMenu, openRowActionMenuAtPoint } = useOperationalContextMenu({
    onOpenRowActionMenu: useCallback((item, point) => {
      setRowActionMenu({ item, point })
      openOverlay('rowAction')
    }, [openOverlay])
  })

  const entities = useMemo(() => {
    if (!allEntities) return []
    return allEntities
      .map((entity: any) => {
        const insights = getEntityInsights(entity, links || [])
        return {
          ...entity,
          internal_owner: insights.internalOwnerLabel,
          link_count: insights.linked.length,
          warning_count: insights.warnings.length,
        }
      })
      .filter((e: any) => activeTab === 'active' ? !e.is_deleted : e.is_deleted)
  }, [allEntities, activeTab, links])

  const sortedEntities = useMemo(() => {
    const sorted = [...entities].sort((a, b) => {
      // Pin favorites to top
      const aFav = normalizedFavoriteIds.includes(Number(a.id)) ? 1 : 0
      const bFav = normalizedFavoriteIds.includes(Number(b.id)) ? 1 : 0
      if (aFav !== bFav) return bFav - aFav
      
      // Secondary fallback
      return a.id - b.id
    })
    return sorted
  }, [entities, normalizedFavoriteIds])

  const registryCounts = useMemo(() => ({
    active: allEntities?.filter((entity: any) => !entity.is_deleted).length || 0,
    archived: allEntities?.filter((entity: any) => entity.is_deleted).length || 0,
    links: links?.length || 0,
  }), [allEntities, links])

  const toFilterOptions = (values: any[]) => Array.from(new Set(values.filter((value) => typeof value === 'string' && value.trim().length > 0)))
    .sort()
    .map((value) => ({ value, label: value }))

  const entityFilterOptions = useMemo(() => ({
    status: toFilterOptions(entities.map((entity: any) => entity.status)),
    type: toFilterOptions(entities.map((entity: any) => entity.type)),
    environment: toFilterOptions(entities.map((entity: any) => entity.environment)),
    owner: toFilterOptions(entities.map((entity: any) => entity.internal_owner)),
  }), [entities])

  const linkFilterOptions = useMemo(() => {
    if (!links) return { direction: [], protocol: [] }
    return {
      direction: toFilterOptions(links.map((l: any) => l.direction)),
      protocol: toFilterOptions(links.map((l: any) => l.protocol)),
    }
  }, [links])

  const filteredEntities = useMemo(() => sortedEntities.filter((entity: any) => {
    if (searchTerm.trim()) {
      const query = searchTerm.trim().toLowerCase()
      const metadata = parseMetadataObject(entity.metadata_json)
      const contacts = normalizeLegacyContacts(entity)
      const haystack = [
        String(entity.id || ''),
        entity.name,
        entity.vendor_name || entity.vendor,
        entity.type,
        entity.status,
        entity.environment,
        entity.internal_owner,
        entity.category,
        entity.primary_endpoint_url,
        entity.owner_organization,
        entity.owner_team,
        entity.criticality,
        entity.risk_rating,
        entity.business_purpose,
        entity.third_party_assessment_status,
        ...(Array.isArray(entity.tags) ? entity.tags : []),
        ...contacts.map((c: any) => `${c.full_name} ${c.email} ${c.phone}`),
        ...Object.entries(metadata).map(([k, v]) => `${k} ${v}`),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(query)) return false
    }
    if (quickFilters.status.length && !quickFilters.status.includes(entity.status)) return false
    if (quickFilters.type.length && !quickFilters.type.includes(entity.type)) return false
    if (quickFilters.environment.length && !quickFilters.environment.includes(entity.environment)) return false
    if (quickFilters.owner.length && !quickFilters.owner.includes(entity.internal_owner)) return false
    return true
  }), [sortedEntities, quickFilters, searchTerm])

  const filteredLinks = useMemo(() => {
    if (!links) return []
    return links.filter((link: any) => {
      if (searchTerm.trim()) {
        const query = searchTerm.trim().toLowerCase()
        const haystack = [
          String(link.id || ''),
          link.external_entity_name,
          link.device_name,
          link.service_name,
          link.direction,
          link.purpose,
          link.protocol,
          String(link.port || ''),
          link.host_or_fqdn,
          link.path_or_resource,
          link.network_zone,
          link.transport_security,
          link.link_status,
          link.credential_reference
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(query)) return false
      }
      if (quickFilters.direction?.length && !quickFilters.direction.includes(link.direction)) return false
      if (quickFilters.protocol?.length && !quickFilters.protocol.includes(link.protocol)) return false
      return true
    })
  }, [links, searchTerm, quickFilters])

  const getEntityGroupValue = (item: any, field: string) => {
    if (field === 'owner') return item.internal_owner || 'Unassigned'
    return item[field] || 'Unspecified'
  }

  const groupedSections = useMemo(() => {
    if (groupBy === 'raw') return []
    const items = activeTab === 'links' ? filteredLinks : filteredEntities
    const sections = items.reduce((acc: Array<{ key: string; label: string; items: any[] }>, item: any) => {
      const val = activeTab === 'links' 
        ? (groupBy === 'owner' ? 'Unassigned' : (item[groupBy] || 'Unspecified'))
        : getEntityGroupValue(item, groupBy)
      const label = String(val)
      const existing = acc.find((section) => section.key === label)
      if (existing) {
        existing.items.push(item)
      } else {
        acc.push({ key: label, label, items: [item] })
      }
      return acc
    }, [])
    return sections.sort((a, b) => a.label.localeCompare(b.label))
  }, [filteredEntities, filteredLinks, groupBy, activeTab])

  const selectionScopeKey = useMemo(() => {
    const visibleItems = activeTab === 'links' ? filteredLinks : filteredEntities
    const visibleIds = visibleItems.map((item: any) => item.id).join(',')
    return `${activeTab}:${groupBy}:${visibleIds}`
  }, [activeTab, filteredEntities, filteredLinks, groupBy])

  const { handleSelectionChanged } = useOperationalGroupedSelection({
    setSelectedIds,
    selectionScopeKey,
  })

  const externalDataState = useMemo(
    () => resolveOperationalDataState({
      loading: activeTab === 'links' ? linkLoading : isLoading,
      error: activeTab === 'links'
        ? (isLinkError ? linkError : null)
        : (isEntityError ? entityError : null),
      totalCount: activeTab === 'links'
        ? (Array.isArray(links) ? links.length : 0)
        : (Array.isArray(allEntities) ? allEntities.length : 0),
      tabCount: activeTab === 'links' ? (Array.isArray(links) ? links.length : 0) : entities.length,
      visibleCount: activeTab === 'links' ? filteredLinks.length : filteredEntities.length,
      emptyLabel: activeTab === 'links' ? 'No external links found' : 'No external registry data found',
      filteredLabel: activeTab === 'links' ? 'No external links match the current filters' : 'No external entities match the current filters',
      tabEmptyKind: activeTab === 'deleted' ? 'deleted-empty' : 'active-empty',
      tabEmptyLabel: activeTab === 'deleted' ? 'No archived external entities found' : 'No active external entities found',
      errorTitle: activeTab === 'links' ? 'External links could not be loaded' : 'External entities could not be loaded',
      errorDescription: activeTab === 'links' ? 'The external links request failed.' : 'The external entities request failed.',
    }),
    [
      activeTab,
      allEntities,
      entities.length,
      entityError,
      filteredEntities.length,
      filteredLinks.length,
      isEntityError,
      isLinkError,
      isLoading,
      linkError,
      linkLoading,
      links,
    ]
  )

  const activeExternalQueryError = activeTab === 'links'
    ? (isLinkError ? linkError : null)
    : (isEntityError ? entityError : null)

  const externalDiagnosticDetail = useMemo(() => buildOperationalDiagnosticDetail({
    endpoint: activeTab === 'links'
      ? '/api/v1/intelligence/links'
      : '/api/v1/intelligence/entities?include_deleted=true',
    error: activeExternalQueryError,
    fallbackMessage: activeTab === 'links'
      ? 'The external links request failed.'
      : 'The external entities request failed.',
  }), [activeExternalQueryError, activeTab])

  useEffect(() => {
    if (!activeExternalQueryError) {
      setShowExternalDataDiagnostic(false)
    }
  }, [activeExternalQueryError])

  const shouldRenderRawGrid = groupBy === 'raw' || externalDataState.kind !== 'ready'

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

  useEffect(() => {
    const intelligenceColumnIds = ['recent_change', 'watch']
    setHiddenColumns((current) => {
      if (isIntelligenceExpanded) {
        return current.filter((columnId) => !intelligenceColumnIds.includes(columnId))
      }
      const next = [...current]
      intelligenceColumnIds.forEach((columnId) => {
        if (!next.includes(columnId)) next.push(columnId)
      })
      return next
    })
  }, [isIntelligenceExpanded])

  const isRecentChange = useCallback((item: any) => {
    const changedAt = item?.updated_at || item?.created_at
    if (!changedAt || !lastVisitedAt) return false
    const time = parseAppDate(changedAt)?.getTime() || 0
    return time > lastVisitedAt
  }, [lastVisitedAt])

  // Persist last visited timestamp on unmount
  useEffect(() => {
    return () => {
      try { window.localStorage.setItem(externalLastVisitedKey, String(Date.now())) } catch {}
    }
  }, [externalLastVisitedKey])

  const normalizedSavedViews = useMemo(() => normalizeExternalSavedViews(savedViews), [savedViews])

  const currentWorkspaceConfig = useMemo(() => sanitizeExternalViewConfig({
    fontSize,
    rowDensity,
    hiddenColumns,
    groupBy,
    activeTab,
    searchTerm,
    showFilterBar,
    quickFilters,
    columnLayoutState,
    filterModel: gridFilterModel,
    sortModel: gridSortModel,
  }), [fontSize, rowDensity, hiddenColumns, groupBy, activeTab, searchTerm, showFilterBar, quickFilters, columnLayoutState, gridFilterModel, gridSortModel])

  const collaborativeViews = useCollaborativeWorkspaceViews({
    workspaceKey: 'external',
    migrationKey: EXTERNAL_COLLABORATIVE_VIEW_MIGRATION_KEY,
    systemViewIds: EXTERNAL_DEFAULT_VIEW_IDS,
    currentViews: normalizedSavedViews,
    setCurrentViews: setSavedViews,
    normalizeViews: normalizeExternalSavedViews,
    sanitizeDefinition: sanitizeExternalViewConfig,
    activeViewId,
    onActiveViewIdChange: setActiveViewId,
    currentDefinition: currentWorkspaceConfig,
  })

  usePageLeaveGuard(collaborativeViews.dirty)

  const allowViewSwitch = async (nextViewId: string | null) => {
    if (!collaborativeViews.dirty || nextViewId === activeViewId) return true
    return confirmWorkspace({ title: 'Discard view changes?', message: 'This workspace has unsaved view changes. Discard them and switch views?', confirmText: 'Discard changes', variant: 'warning' })
  }

  useEffect(() => {
    setPersistedUiState(currentWorkspaceConfig)
  }, [currentWorkspaceConfig, setPersistedUiState])

  const applyGridState = (config: any) => {
    const api = gridRef.current?.api
    if (!api) return
    applyColumnLayoutState(api, config.columnLayoutState, true)
    api.setFilterModel(config.filterModel || {})
    api.applyColumnState({
      state: (config.sortModel || []).map((entry: any) => ({ colId: entry.colId, sort: entry.sort as 'asc' | 'desc' })),
      defaultState: { sort: null },
      applyOrder: false,
    })
  }

  const applyWorkspaceConfig = (config: any, nextActiveViewId: string | null) => {
    const sanitized = sanitizeExternalViewConfig(config)
    setActiveViewId(nextActiveViewId)
    setFontSize(sanitized.fontSize)
    setRowDensity(sanitized.rowDensity)
    setHiddenColumns(sanitized.hiddenColumns)
    setActiveTab(sanitized.activeTab)
    setSearchTerm(sanitized.searchTerm)
    setQuickFilters(sanitized.quickFilters)
    setShowFilterBar(sanitized.showFilterBar)
    setGridFilterModel(sanitized.filterModel)
    setGridSortModel(sanitized.sortModel)
    setColumnLayoutState(sanitized.columnLayoutState)
    setGroupBy(sanitized.groupBy || 'raw')
    setPendingGridRestore(sanitized)
    setSelectedIds([])
  }

  const applySystemDefault = async () => {
    if (!await allowViewSwitch(null)) return
    applyWorkspaceConfig(normalizeExternalWorkspaceState(null), null)
    collaborativeViews.setViewLink(null)
    setGroupBy('raw')
    dismissOverlays()
  }

  const createViewFromCurrent = async () => {
    const trimmedName = newViewName.trim()
    if (!trimmedName) {
      showWorkspaceToast('Name the view before saving it', { type: 'error' })
      return
    }
    const result = await collaborativeViews.createView(trimmedName, currentWorkspaceConfig)
    if (!result.view) {
      showWorkspaceToast(result.error || 'Unable to save this view', { type: 'error' })
      return
    }
    if (result.view) {
      setActiveViewId(result.view.id)
      collaborativeViews.setViewLink(result.view.id)
      setNewViewName('')
    }
    showWorkspaceToast(result.persisted ? 'External personal view saved' : 'External view saved locally; server unavailable', { type: result.persisted ? 'success' : 'error', id: result.persisted ? collaborativeViews.successNoticeId : undefined })
  }

  const saveCurrentToView = async (viewId: string) => {
    const view = normalizedSavedViews.find((entry: any) => entry.id === viewId)
    if (!view) return
    const result = await collaborativeViews.updateView(viewId, view.name, currentWorkspaceConfig)
    if (result.conflict) {
      showWorkspaceToast('This view changed on the server. Resolve the conflict in Saved views.', { type: 'error' })
      return
    }
    if (!result.view) {
      showWorkspaceToast(result.error || 'Unable to update this view', { type: 'error' })
      return
    }
    if (result.view) setActiveViewId(result.view.id)
    showWorkspaceToast(result.persisted ? 'External personal view updated' : 'External view updated locally; server unavailable', { type: result.persisted ? 'success' : 'error', id: result.persisted ? collaborativeViews.successNoticeId : undefined })
  }

  const renameView = async (viewId: string, name: string): Promise<boolean> => {
    const view = normalizedSavedViews.find((entry: any) => entry.id === viewId)
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
    showWorkspaceToast(`Renamed view to ${name}`, { id: collaborativeViews.successNoticeId })
    return true
  }

  const deleteView = async (viewId: string) => {
    const view = normalizedSavedViews.find((entry: any) => entry.id === viewId)
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
    }
    dismissOverlays()
    showWorkspaceToast(result.persisted ? 'External personal view removed' : 'External local fallback removed', { id: collaborativeViews.successNoticeId })
  }

  const applySavedView = async (viewId: string) => {
    if (!await allowViewSwitch(viewId)) return
    const view = normalizedSavedViews.find((entry: any) => entry.id === viewId)
    if (!view) return
    applyWorkspaceConfig(view.config, view.id)
    collaborativeViews.setViewLink(view.id)
    dismissOverlays()
  }

  useEffect(() => {
    const requested = collaborativeViews.requestedViewId
    if (!requested || requested === activeViewId || !normalizedSavedViews.some((view: any) => view.id === requested)) return
    applySavedView(requested)
  }, [activeViewId, collaborativeViews.requestedViewId, normalizedSavedViews])

  useEffect(() => {
    if (!pendingGridRestore) return
    if (pendingRestoreTimeoutRef.current !== null) {
      window.clearTimeout(pendingRestoreTimeoutRef.current)
    }
    pendingRestoreTimeoutRef.current = window.setTimeout(() => {
      applyGridState(pendingGridRestore)
      setPendingGridRestore(null)
      pendingRestoreTimeoutRef.current = null
    }, 0)
    return () => {
      if (pendingRestoreTimeoutRef.current !== null) {
        window.clearTimeout(pendingRestoreTimeoutRef.current)
        pendingRestoreTimeoutRef.current = null
      }
    }
  }, [pendingGridRestore])

  const handleGridDataUpdated = useCallback(() => {
    if (!gridRef.current?.api || preserveExplicitColumnWidths) return
    autoSizeOperationalColumns({
      api: gridRef.current.api,
      onSized: () => {
        if (!gridRef.current?.api || preserveExplicitColumnWidths) return
        syncColumnLayoutState(gridRef.current.api, true)
      },
    })
  }, [preserveExplicitColumnWidths, syncColumnLayoutState])

  const externalGridRuntime = useMemo(() => ({
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

  const handleExportSnapshot = async () => {
    try {
      const download = await downloadOperationalImportFile({
        tableName: 'external_entities',
        kind: 'snapshot',
        expectedProfile: 'external_entities',
        requireSchemaHeaders: true,
        metadataContract: {
          manifestEndpoint: '/api/v1/import/snapshot/external_entities/manifest',
          expectedProfile: 'external_entities',
          expectedSchemaVersion: '2026-06-external-v1',
          expectedFilenamePattern: /^SysGrid_External_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv$/,
          expectedScope: 'active',
          expectedContentType: 'text/csv',
        },
      })
      showWorkspaceToast(
        `Exported ${download.fileName}. Includes active external entities only; archived rows, links, selection, filters, and hidden viewport columns are not part of this snapshot.`
      )
    } catch (error: any) {
      showWorkspaceToast(error.message || 'External export failed', { type: 'error' })
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
          .then(() => showWorkspaceToast('Data copied to secure clipboard'))
          .catch(() => showWorkspaceToast('Clipboard authorization failed', { type: 'error' }))
      }
    }
  }

  const exportSnapshotTitle = activeTab === 'active'
    ? 'Export round-trip external entity snapshot'
    : activeTab === 'deleted'
      ? 'Snapshot export is limited to active external entities. Archived rows are not included.'
      : 'Snapshot export is limited to active external entities. Link rows are not included.'

  const toggleFavorite = useCallback((entityId: number) => {
    const id = Number(entityId)
    setFavoriteIds((current) => {
      const currentNums = current.map(Number)
      return currentNums.includes(id) ? currentNums.filter((i) => i !== id) : [...currentNums, id]
    })
  }, [setFavoriteIds])

  const toggleWatch = useCallback((entityId: number) => {
    const id = Number(entityId)
    setWatchIds((current) => {
      const currentNums = current.map(Number)
      return currentNums.includes(id) ? currentNums.filter((i) => i !== id) : [...currentNums, id]
    })
  }, [setWatchIds])

  const openCompare = () => {
    if (selectedIds.length < 2 || selectedIds.length > 5) return
    setCompareOpen(true)
  }

  const togglePanel = (panel: 'display' | 'views' | 'bulk') => {
    toggleOverlay(panel)
  }

  // Backend currently uses PUT for entity updates; this helper sends required stable fields plus intended changed fields while avoiding unrelated legacy invalid enum values.
  const buildExternalSafeBulkPutPayload = (original: any, payload: any) => {
    const nextPayload: any = {
      name: original.name,
      type: original.type,
      business_purpose: original.business_purpose || '',
      contacts_json: original.contacts_json || [],
      ownership_mode: original.ownership_mode || 'team',
    }

    if (nextPayload.ownership_mode === 'team') {
      nextPayload.internal_team_id = original.internal_team_id
      nextPayload.internal_operator_id = null
    } else {
      nextPayload.internal_operator_id = original.internal_operator_id
      nextPayload.internal_team_id = null
    }

    Object.keys(payload).forEach((key) => {
      nextPayload[key] = payload[key]
    })

    return nextPayload
  }

  const bulkPreviewMutation = useMutation({
    mutationFn: async ({ action, payload = {}, ids: overrideIds }: any) => {
      const idsToUse = overrideIds ?? selectedIds
      const res = await apiFetch('/api/v1/intelligence/entities/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: idsToUse, action, payload, dry_run: true }),
      })
      if (!res.ok) throw new Error(await res.text())
      const preview = await res.json() as OperationalBulkPreview
      const fieldLabel = action === 'update' ? resolveBulkFieldLabel(payload, EXTERNAL_BULK_FIELD_LABELS) : undefined
      const actionLabel = action === 'delete'
        ? 'Archive selection'
        : action === 'restore'
          ? 'Restore selection'
          : action === 'purge'
            ? 'Purge selection'
            : `Apply ${fieldLabel || 'change'}`
      const nextValue = action === 'update'
        ? String(Object.values(payload).find((value) => value !== undefined) ?? '')
        : undefined
      return { action, payload, ids: idsToUse, actionLabel, fieldLabel, nextValue, preview }
    },
    onSuccess: (nextPreview) => {
      setBulkOperationPreview(nextPreview)
      dismissOverlays()
    },
    onError: (error: any) => showOperationalBulkErrorToast(error.message),
  })

  const requestBulkPreview = (variables: { action: string; payload?: Record<string, any>; ids?: number[] }) => {
    bulkPreviewMutation.mutate(variables)
  }

  const bulkMutation = useMutation({
    mutationFn: async ({ action, payload = {}, ids: overrideIds }: any) => {
      const idsToUse = overrideIds ?? selectedIds
      const previousSnapshots = (allEntities || [])
        .filter((entity: any) => idsToUse.includes(entity.id))
        .map((entity: any) => ({ ...entity }))
      const res = await apiFetch('/api/v1/intelligence/entities/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: idsToUse, action, payload }),
      })
      if (!res.ok) throw new Error(await res.text())
      const result = await res.json()
      return {
        action,
        idsToUse,
        payload,
        previousSnapshots,
        updated: Number(result?.changed_count || 0),
        skipped: Number(result?.unchanged_count || 0),
        failed: 0,
        errors: [],
      }
    },
    onSuccess: ({ action, idsToUse, payload, previousSnapshots, updated, skipped, failed, errors }) => {
      queryClient.invalidateQueries({ queryKey: ['external-entities'] })
      queryClient.invalidateQueries({ queryKey: ['external-links'] })
      const totalSelected = idsToUse.length
      const fieldLabel = resolveBulkFieldLabel(payload, EXTERNAL_BULK_FIELD_LABELS)

      const hasFailures = failed > 0
      if (!hasFailures) {
        setSelectedIds([])
        dismissOverlays()
        setBulkDraft({ status: '', environment: '', criticality: '', risk_rating: '' })
        setExpandedBulkSection(null)
      }

      const revertAction = async () => {
        const undo = externalUndoRef.current
        externalUndoRef.current = null
        if (!undo) return
        if (undo.mode === 'bulk') {
          await bulkMutation.mutateAsync({ action: undo.action, ids: undo.ids })
        } else if (undo.mode === 'restore_snapshots') {
          await Promise.all((undo.snapshots || []).map(async (snapshot: any) => {
            if (!snapshot?.id) return
            const restoreFields: any = {}
            Object.keys(undo.payload || {}).forEach((key) => {
              restoreFields[key] = snapshot[key]
            })
            const payloadToRestore = buildExternalSafeBulkPutPayload(snapshot, restoreFields)
            const res = await apiFetch(`/api/v1/intelligence/entities/${snapshot.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payloadToRestore),
            })
            if (!res.ok) throw new Error(await res.text())
          }))
          queryClient.invalidateQueries({ queryKey: ['external-entities'] })
          queryClient.invalidateQueries({ queryKey: ['external-links'] })
        }
      }

      if (failed > 0) {
        externalUndoRef.current = null
        showOperationalBulkErrorToast(`${failed} of ${totalSelected} selected records could not be processed. ${errors.join('; ')}`)
      } else {
        if (updated <= 0) {
          externalUndoRef.current = null
        } else if (action === 'delete') {
          externalUndoRef.current = { mode: 'bulk', ids: previousSnapshots.map(s => s.id), action: 'restore' }
        } else if (action === 'restore') {
          externalUndoRef.current = { mode: 'bulk', ids: previousSnapshots.map(s => s.id), action: 'delete' }
        } else if (action === 'update') {
          externalUndoRef.current = { mode: 'restore_snapshots', snapshots: previousSnapshots, payload }
        } else {
          externalUndoRef.current = null
        }

        const receiptRevert = externalUndoRef.current ? async () => {
          try {
            await revertAction()
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
            changed_count: updated,
            unchanged_count: skipped,
            can_revert: Boolean(receiptRevert),
          },
          onRevert: receiptRevert,
        } : null)

        showOperationalBulkResultToast({
          action: action === 'delete' ? 'archive' : action,
          totalSelected,
          changedCount: updated,
          unchangedCount: skipped,
          fieldLabel,
          onRevert: receiptRevert,
        })
      }
    },
    onError: (e: any) => {
      showOperationalBulkErrorToast(e.message)
    }
  })

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const url = data.id ? `/api/v1/intelligence/entities/${data.id}` : `/api/v1/intelligence/entities`
      const method = data.id ? 'PUT' : 'POST'
      const res = await apiFetch(url, { method, body: JSON.stringify(data) })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['external-entities'] })
      showWorkspaceToast('External Manifest Synchronized')
      setActiveModalBackendFieldErrors({})
      setIsActiveModalDirty(false)
      setActiveModal(null)
      detailRoute.finishTransition()
    },
    onError: (e: any) => {
      const { fieldErrors, generalError } = parseOperationalApiValidationError(e)
      setActiveModalBackendFieldErrors(fieldErrors)
      const message = generalError || e.message || 'Failed to save entity'
      showWorkspaceToast(message, { type: 'error' })
      detailRoute.finishTransition()
    }
  })

  const linkMutation = useMutation({
    mutationFn: async (data: any) => {
      const isEdit = Boolean(data.id)
      const url = isEdit ? `/api/v1/intelligence/links/${data.id}` : '/api/v1/intelligence/links/'
      const res = await apiFetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['external-links'] })
      queryClient.invalidateQueries({ queryKey: ['external-entities'] })
      setShowLinkModal(false)
      setLinkSeedEntityId(null)
      setEditingLink(null)
      detailRoute.finishTransition()
      showWorkspaceToast('Interconnect Established')
    },
    onError: (e: any) => {
      showWorkspaceToast(e.message || 'Interconnect establishment failed', { type: 'error' })
      detailRoute.finishTransition()
    }
  })

  const deleteMutation = useMutation({
    mutationFn: async ({ id, purge, type }: { id: number, purge: boolean, type: 'entity' | 'link' }) => {
      if (type === 'entity' && purge) {
        const entity = findExternalEntityById(id)
        const purgeReason = getExternalEntityPurgeReason(entity)
        if (purgeReason) {
          throw new Error(purgeReason)
        }
      }
      const url = type === 'entity' ? `/api/v1/intelligence/entities/${id}${purge ? '?purge=true' : ''}` : `/api/v1/intelligence/links/${id}`
      const res = await apiFetch(url, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (_, variables) => {
      if (variables.type === 'entity') {
         queryClient.invalidateQueries({ queryKey: ['external-entities'] })
         if (variables.purge) {
           showWorkspaceToast('Entity Purged from Global Registry')
         } else {
           showWorkspaceRevertToast('Entity Moved to Deleted Matrix', () => {
             restoreMutation.mutate(variables.id)
           })
         }
      } else {
         queryClient.invalidateQueries({ queryKey: ['external-links'] })
         showWorkspaceToast('Link Severed')
      }
    },
    onError: (e: any) => showWorkspaceToast(getFriendlyRestoreError(e.message || String(e)), { type: 'error' })
  })

  const restoreMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiFetch(`/api/v1/intelligence/entities/${id}/restore`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (_, restoredId) => {
      queryClient.invalidateQueries({ queryKey: ['external-entities'] })
      showWorkspaceRevertToast('Entity Restored to Active Registry', () => {
        deleteMutation.mutate({ id: restoredId, purge: false, type: 'entity' })
      })
    },
    onError: (e: any) => showWorkspaceToast(getFriendlyRestoreError(e.message || String(e)), { type: 'error' })
  })

  const externalContextMenu = useMemo(() => ({
    handleCellContextMenu,
  }), [handleCellContextMenu])

  const { handleRowClicked, handleRowDoubleClicked } = useOperationalRowInteractions({
    onRowDoubleClick: useCallback((item) => {
      if (activeTab === 'links') {
        const ent = allEntities?.find((e: any) => e.id === item.external_entity_id)
        if (ent) detailRoute.openDetail(ent)
      } else {
        detailRoute.openDetail(item)
      }
    }, [activeTab, allEntities, detailRoute]),
    selectionScopeKey,
  })

  const externalRowInteractions = useMemo(() => ({
    handleRowClicked,
    handleRowDoubleClicked,
  }), [handleRowClicked, handleRowDoubleClicked])

  const getRowClass = useCallback((params: any) => {
    return params.node.rowIndex % 2 === 0 ? 'operational-grid-row-even' : 'operational-grid-row-odd'
  }, [])

  const getExternalRowId = (params: any) => String(params.data?.id ?? '')

  const renderPrimaryRowActions = useCallback((item: any) => (
    renderOperationalActionButtons(
      <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          if (activeTab === 'links') {
            const ent = allEntities?.find((e: any) => e.id === item.external_entity_id)
            if (ent) detailRoute.openDetail(ent)
          } else {
            detailRoute.openDetail(item)
          }
        }}
        title="Open details"
        className="rounded-lg p-1 text-blue-400 transition-all hover:bg-blue-400/10 active:scale-90"
      >
        <Maximize2 size={13} />
      </button>
      {activeTab === 'active' && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setActiveModal(item)
          }}
          title="Edit configuration"
          className="rounded-lg p-1 text-emerald-400 transition-all hover:bg-emerald-400/10 active:scale-90"
        >
          <Edit2 size={13} />
        </button>
      )}
      {activeTab === 'links' && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setEditingLink(item)
            setShowLinkModal(true)
          }}
          title="Edit link"
          className="rounded-lg p-1 text-emerald-400 transition-all hover:bg-emerald-400/10 active:scale-90"
        >
          <Edit2 size={13} />
        </button>
      )}
      <button
        type="button"
        onClick={(event: any) => {
          event.stopPropagation()
          openRowActionMenuAtPoint(item, event.clientX, event.clientY)
        }}
        title="More actions"
        className="row-action-trigger row-action-menu-container rounded-lg p-1 text-slate-400 transition-all hover:bg-slate-400/10 hover:text-white active:scale-90"
      >
        <MoreVertical size={13} />
      </button>
      </>
    )
  ), [activeTab, allEntities])

  const columnDefs = useMemo(() => {
    const tabColumnConfigs: OperationalColumnConfig[] = activeTab === 'links'
      ? [
          {
            kind: 'mappedBadge',
            field: 'direction',
            headerName: 'Flow',
            fontSize,
            colorMap: EXTERNAL_LINK_DIRECTION_COLORS,
            knownValues: Object.keys(EXTERNAL_LINK_DIRECTION_COLORS),
            hide: hiddenColumns.includes('direction'),
          },
          {
            kind: 'plain',
            field: 'device_name',
            headerName: 'Internal Asset',
            width: 160,
            hide: hiddenColumns.includes('device_name'),
          },
          {
            kind: 'plain',
            field: 'service_name',
            headerName: 'Logical Service',
            width: 160,
            hide: hiddenColumns.includes('service_name'),
          },
          {
            kind: 'prose',
            field: 'purpose',
            headerName: 'Interconnect Purpose',
            width: 220,
            proseMode: 'compact',
            hide: hiddenColumns.includes('purpose'),
          },
          {
            kind: 'plain',
            field: 'protocol',
            headerName: 'Prot',
            width: 80,
            hide: hiddenColumns.includes('protocol'),
          },
          {
            kind: 'plain',
            field: 'port',
            headerName: 'Port',
            width: 80,
            hide: hiddenColumns.includes('port'),
          },
        ]
      : [
          {
            // External type remains mappedText: it is a taxonomy label, not a status/severity pill.
            kind: 'mappedText',
            field: 'type',
            headerName: 'Type',
            width: 140,
            fontSize,
            colorMap: EXTERNAL_TYPE_COLORS,
            hide: hiddenColumns.includes('type'),
          },
          {
            kind: 'plain',
            field: 'internal_owner',
            headerName: 'Owner',
            width: 140,
            hide: hiddenColumns.includes('internal_owner'),
          },
          {
            kind: 'mappedBadge',
            field: 'status',
            headerName: 'Status',
            fontSize,
            emptyValue: 'Planned',
            colorMap: EXTERNAL_STATUS_COLORS,
            knownValues: Object.keys(EXTERNAL_STATUS_COLORS),
            hide: hiddenColumns.includes('status'),
          },
          {
            kind: 'plain',
            field: 'environment',
            headerName: 'Env',
            width: 110,
            hide: hiddenColumns.includes('environment'),
          },
          {
            kind: 'prose',
            field: 'business_purpose',
            headerName: 'Business Purpose',
            width: 220,
            minWidth: 150,
            proseMode: 'compact',
            hide: hiddenColumns.includes('business_purpose'),
          },
          {
            kind: 'plain',
            field: 'link_count',
            headerName: 'Links',
            width: 85,
            valueClassName: 'text-center font-bold text-blue-400',
            hide: hiddenColumns.includes('link_count'),
          },
        ]

    const columnConfigs: OperationalColumnConfig[] = [
      {
        kind: 'identity',
        field: activeTab === 'links' ? 'external_entity_name' : 'name',
        headerName: activeTab === 'links' ? 'External Peer' : 'Name',
        hide: hiddenColumns.includes(activeTab === 'links' ? 'external_entity_name' : 'name'),
        width: activeTab === 'links' ? 220 : 210,
        minWidth: 150,
        maxWidth: 320,
      },
      ...tabColumnConfigs,
      {
        kind: 'action',
        width: OPERATIONAL_GRID_WIDTHS.compactAction,
        renderActions: renderPrimaryRowActions,
      },
    ]

    return buildOperationalGridColumnDefinitions({
      utilityColumnsConfig: {
        includeRecentChange: activeTab !== 'links',
        includeFavorite: activeTab !== 'links',
        includeWatch: activeTab !== 'links',
        isIntelligenceExpanded,
        isRecentChange,
        onToggleFavorite: toggleFavorite,
        onToggleWatch: toggleWatch,
        itemLabel: 'peer',
      },
      columnConfigs,
      columnLayoutState,
      preserveExplicitColumnWidths,
    })
  }, [
    activeTab,
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

  const gridContext = useMemo(() => ({ activeTab, favoriteIds: normalizedFavoriteIds, watchIds: normalizedWatchIds }), [activeTab, normalizedFavoriteIds, normalizedWatchIds])

  useEffect(() => {
    if (gridRef.current?.api) {
      gridRef.current.api.refreshCells({ columns: ['favorite', 'watch'], force: true })
    }
  }, [normalizedFavoriteIds, normalizedWatchIds])

  return (
    <OperationalWorkspaceShell
      archetype="table"
      header={{
        eyebrow: 'External Intelligence',
        title: (
          <div className="flex items-center gap-3">
            <Globe className="text-blue-500" />
            <span>{externalViewLabel}</span>
          </div>
        ),
        subtitle: `${externalRegistryLabel} and dependency intelligence`,
        actions: (
          <>
            <HeaderScopeSwitch
              label="Registry Scope"
              summary={`${registryCounts.active} active · ${registryCounts.archived} archived · ${registryCounts.links} links`}
              value={activeTab}
              onChange={(value) => {
                setActiveTab(value as 'active' | 'deleted' | 'links')
                setSelectedIds([])
              }}
              options={[
                { label: 'Active', value: 'active' },
                { label: 'Archived', value: 'deleted' },
                { label: 'Links', value: 'links' }
              ]}
            />
            {activeExternalQueryError && (
              <>
                <DiagnosticStatusPill
                  status="error"
                  errorDetail={{ status: (activeExternalQueryError as any)?.status }}
                  onClick={() => setShowExternalDataDiagnostic(true)}
                />
                <DataDiagnosticModal
                  isOpen={showExternalDataDiagnostic}
                  onClose={() => setShowExternalDataDiagnostic(false)}
                  errorDetail={externalDiagnosticDetail}
                />
              </>
            )}
          </>
        ),
      }}
      toolbarSearch={(
        <ToolbarSearch
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Scan registry..."
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
            <ToolbarIconButton
              onClick={handleExportSnapshot}
              title={exportSnapshotTitle}
              disabled={activeTab !== 'active'}
            >
              <FileText size={16} />
            </ToolbarIconButton>
            <ToolbarIconButton onClick={handleCopyToClipboard} title="Secure Copy">
              <Clipboard size={16} />
            </ToolbarIconButton>
            <ToolbarIconButton onClick={() => setShowConfig(true)} title="Registry Config">
              <Settings size={16} />
            </ToolbarIconButton>
          </ToolbarGroup>
          <ToolbarGroup>
            <ToolbarButton
              onClick={() => setShowImportModal(true)}
              title="Import external registry rows"
            >
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
              onClick={() => setIsIntelligenceExpanded((current) => !current)}
              title={isIntelligenceExpanded ? 'Collapse activity columns' : 'Expand activity columns'}
            >
              <span className="flex items-center gap-2">
                {isIntelligenceExpanded ? <Minimize2 size={14} /> : <Activity size={14} />}
                Activity
              </span>
            </ToolbarButton>
          </ToolbarGroup>
        </>
      )}
      secondaryToolbar={showFilterBar ? (
        <div className="grid w-full gap-3 md:grid-cols-4">
          {activeTab === 'links' ? (
            <>
              <AppDropdown
                multi
                value={quickFilters.direction || []}
                onChange={(value) => setQuickFilters((current) => ({ ...current, direction: value }))}
                options={linkFilterOptions.direction}
                label="Flow Direction"
                placeholder="All directions"
              />
              <AppDropdown
                multi
                value={quickFilters.protocol || []}
                onChange={(value) => setQuickFilters((current) => ({ ...current, protocol: value }))}
                options={linkFilterOptions.protocol}
                label="Protocol"
                placeholder="All protocols"
              />
            </>
          ) : (
            <>
              <AppDropdown
                multi
                value={quickFilters.status}
                onChange={(value) => setQuickFilters((current) => ({ ...current, status: value }))}
                options={entityFilterOptions.status}
                label="Status Filter"
                placeholder="All statuses"
              />
              <AppDropdown
                multi
                value={quickFilters.type}
                onChange={(value) => setQuickFilters((current) => ({ ...current, type: value }))}
                options={entityFilterOptions.type}
                label="Type Filter"
                placeholder="All types"
              />
              <AppDropdown
                multi
                value={quickFilters.environment}
                onChange={(value) => setQuickFilters((current) => ({ ...current, environment: value }))}
                options={entityFilterOptions.environment}
                label="Environment Filter"
                placeholder="All environments"
              />
              <AppDropdown
                multi
                value={quickFilters.owner}
                onChange={(value) => setQuickFilters((current) => ({ ...current, owner: value }))}
                options={entityFilterOptions.owner}
                label="Owner Filter"
                placeholder="All owners"
              />
            </>
          )}
        </div>
      ) : null}
      toolbarActions={(
        <>
          {EXTERNAL_SUPPORTS_COMPARE && (
            <ToolbarButton
              onClick={openCompare}
              disabled={selectedIds.length < 2 || selectedIds.length > 5}
              active={compareOpen}
              title="Compare selected peers"
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
            onClick={() => setActiveModal({})}
            variant="primary"
            className="px-6 py-2"
          >
            + Add {externalViewLabel}
          </ToolbarButton>
        </>
      )}
      filterChips={[
          ...(searchTerm ? [{
            id: 'search',
            label: `Search: ${searchTerm}`,
            onRemove: () => setSearchTerm(''),
          }] : []),
          ...Object.entries(
            activeTab === 'links'
              ? {
                  direction: quickFilters.direction || [],
                  protocol: quickFilters.protocol || [],
                }
              : {
                  status: quickFilters.status,
                  type: quickFilters.type,
                  environment: quickFilters.environment,
                  owner: quickFilters.owner,
                }
          ).flatMap(([key, values]) => values.map((value) => ({
            id: `${key}-${value}`,
            label: `${key}: ${value}`,
            onRemove: () => setQuickFilters((current) => ({
              ...current,
              [key]: (current as any)[key].filter((entry: string) => entry !== value),
            })),
          }))),
          ...(searchTerm || Object.values(quickFilters).some(v => v.length)
            ? [{
                id: 'clear-all',
                label: 'Clear All',
                onRemove: () => {
                  setSearchTerm('')
                  setGridFilterModel({})
                  setQuickFilters({
                    status: [],
                    type: [],
                    environment: [],
                    owner: [],
                    direction: [],
                    protocol: [],
                  })
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
            onClose={dismissOverlays}
            fontSize={fontSize}
            onFontSizeChange={setFontSize}
            rowDensity={rowDensity}
            onRowDensityChange={setRowDensity}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
            groupOptions={EXTERNAL_DEFAULT_GROUP_OPTIONS}
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
            entityLabel={externalViewLabel}
            onClose={dismissWorkspaceMenus}
            activeViewId={activeViewId}
            currentViewName={activeViewId ? normalizedSavedViews.find((view: any) => view.id === activeViewId)?.name || 'Unsaved working view' : 'Unsaved working view'}
            newViewName={newViewName}
            onNewViewNameChange={setNewViewName}
            onCreateView={createViewFromCurrent}
            onApplySystemDefault={applySystemDefault}
            savedViews={normalizedSavedViews}
            defaultViewIds={new Set<string>()}
            onApplyView={applySavedView}
            onOverwriteView={saveCurrentToView}
            onRenameView={renameView}
            onDeleteView={deleteView}
            describeView={describeExternalSavedView}
            syncStatus={collaborativeViews.status}
            syncMessage={collaborativeViews.lastError || (collaborativeViews.status === 'offline' ? 'Personal views are available locally and will migrate when the API returns.' : undefined)}
            onCopyViewLink={(viewId) => {
              void collaborativeViews.copyViewLink(viewId)
            }}
            isCopyingViewLink={collaborativeViews.copyingLink}
            conflictMessage={collaborativeViews.conflict?.message}
            onReloadConflict={collaborativeViews.reloadConflict}
            onSaveConflictCopy={() => { void collaborativeViews.saveConflictCopy() }}
          />

          <OperationalAnchoredPanel
            isOpen={showBulkMenu}
            panelKey="bulk-menu"
            style={bulkMenuStyle}
            className="bulk-menu-container"
            panelRef={bulkMenuPanelRef}
            yOffset={10}
          >
            <WorkspaceFloatingPanel kind="context" className="max-h-[560px] overflow-y-auto custom-scrollbar p-3">
                  <div className="mb-3 rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
                    <p className="text-[10px] font-semibold text-slate-400">Bulk actions</p>
                    <p className="pt-1 text-[12px] font-semibold text-slate-100">{selectedIds.length} peers selected</p>
                  </div>

                  {activeTab === 'deleted' ? (
                    <button
                      onClick={() => requestBulkPreview({ action: 'restore' })}
                      disabled={bulkMutation.isPending || bulkPreviewMutation.isPending}
                      className="w-full rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-left transition-all hover:bg-emerald-500/15 disabled:opacity-50"
                    >
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300">
                        {(bulkMutation.isPending || bulkPreviewMutation.isPending) ? <Activity size={10} className="inline animate-spin" /> : 'Restore Selection'}
                      </p>
                    </button>
                  ) : (
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
                          options={[
                            { value: 'Active', label: 'Active' },
                            { value: 'Maintenance', label: 'Maintenance' },
                            { value: 'Decommissioned', label: 'Decommissioned' },
                            { value: 'Planned', label: 'Planned' },
                            { value: 'Standby', label: 'Standby' },
                            { value: 'Failed', label: 'Failed' },
                            { value: 'Provisioning', label: 'Provisioning' },
                            { value: 'Reserved', label: 'Reserved' },
                          ]}
                          placeholder="Choose status"
                          actionLabel="Apply Status"
                          onApply={() => requestBulkPreview({ action: 'update', payload: { status: bulkDraft.status } })}
                          disabled={!bulkDraft.status || bulkMutation.isPending}
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
                          options={[
                            { value: 'Production', label: 'Production' },
                            { value: 'Staging', label: 'Staging' },
                            { value: 'Development', label: 'Development' },
                            { value: 'Test', label: 'Test' },
                            { value: 'Sandbox', label: 'Sandbox' },
                            { value: 'DR', label: 'DR' },
                            { value: 'Lab', label: 'Lab' },
                          ]}
                          placeholder="Choose environment"
                          actionLabel="Apply Environment"
                          onApply={() => requestBulkPreview({ action: 'update', payload: { environment: bulkDraft.environment } })}
                          disabled={!bulkDraft.environment || bulkMutation.isPending}
                        />
                      )}

                      <WorkspaceFlyoutActionCard
                        title="Set Criticality"
                        active={expandedBulkSection === 'criticality'}
                        onClick={() => setExpandedBulkSection(expandedBulkSection === 'criticality' ? null : 'criticality')}
                      />
                      {expandedBulkSection === 'criticality' && (
                        <WorkspaceFlyoutDropdownEditor
                          value={bulkDraft.criticality}
                          onChange={(value) => setBulkDraft((current) => ({ ...current, criticality: value }))}
                          options={[
                            { value: 'Low', label: 'Low' },
                            { value: 'Medium', label: 'Medium' },
                            { value: 'High', label: 'High' },
                            { value: 'Critical', label: 'Critical' },
                          ]}
                          placeholder="Choose criticality"
                          actionLabel="Apply Criticality"
                          onApply={() => requestBulkPreview({ action: 'update', payload: { criticality: bulkDraft.criticality } })}
                          disabled={!bulkDraft.criticality || bulkMutation.isPending}
                        />
                      )}

                      <WorkspaceFlyoutActionCard
                        title="Set Risk Rating"
                        active={expandedBulkSection === 'risk_rating'}
                        onClick={() => setExpandedBulkSection(expandedBulkSection === 'risk_rating' ? null : 'risk_rating')}
                      />
                      {expandedBulkSection === 'risk_rating' && (
                        <WorkspaceFlyoutDropdownEditor
                          value={bulkDraft.risk_rating}
                          onChange={(value) => setBulkDraft((current) => ({ ...current, risk_rating: value }))}
                          options={[
                            { value: 'Low', label: 'Low' },
                            { value: 'Medium', label: 'Medium' },
                            { value: 'High', label: 'High' },
                            { value: 'Critical', label: 'Critical' },
                          ]}
                          placeholder="Choose risk rating"
                          actionLabel="Apply Risk Rating"
                          onApply={() => requestBulkPreview({ action: 'update', payload: { risk_rating: bulkDraft.risk_rating } })}
                          disabled={!bulkDraft.risk_rating || bulkMutation.isPending}
                        />
                      )}
                    </div>
                  )}

                  <div className="mx-1 my-3 h-px bg-slate-800" />
                  {activeTab === 'deleted' && !canPurgeSelectedDeletedEntities ? (
                    <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                      <p className="text-[10px] font-semibold text-amber-200">
                        {selectedIds.length === 1
                          ? getExternalEntityPurgeReason(findExternalEntityById(selectedIds[0]))
                          : buildExternalMultiSelectPurgeReason(selectedIds.map((id) => findExternalEntityById(id)), links)}
                      </p>
                    </div>
                  ) : null}
                  <OperationalDisabledActionTooltip
                    disabled={false}
                    reason={undefined}
                    className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
                  >
                    <button
                      onClick={() => {
                        if (!bulkDeleteConfirm) {
                          setBulkDeleteConfirm(true)
                          return
                        }
                        requestBulkPreview({ action: activeTab === 'deleted' ? 'purge' : 'delete' })
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
                          activeTab === 'deleted' && !canPurgeSelectedDeletedEntities
                            ? OPERATIONAL_ACTION_LABELS.purge
                            : bulkDeleteConfirm
                            ? (activeTab === 'deleted' ? OPERATIONAL_ACTION_LABELS.purgeSelectionConfirm : OPERATIONAL_ACTION_LABELS.archiveSelectionConfirm)
                            : (activeTab === 'deleted' ? OPERATIONAL_ACTION_LABELS.purge : OPERATIONAL_ACTION_LABELS.archiveSelection)
                        )}
                      </p>
                    </button>
                  </OperationalDisabledActionTooltip>
            </WorkspaceFloatingPanel>
          </OperationalAnchoredPanel>

            {hasRowActionMenu && rowActionMenu && (() => {
              const item = rowActionMenu.item
              const deletedItemPurgeable = activeTab !== 'deleted' || isExternalEntityPurgeable(item)
              const deletedItemPurgeReason = activeTab === 'deleted' ? getExternalEntityPurgeReason(item) : undefined
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
                            onClick: () => {
                                if (activeTab === 'links') {
                                    const ent = allEntities?.find((e: any) => e.id === item.external_entity_id)
                                    if (ent) detailRoute.openDetail(ent)
                                } else {
                                    detailRoute.openDetail(item)
                                }
                                setRowActionMenu(null)
                            }
                        },
                        ...((activeTab === 'active' || activeTab === 'links') ? [{
                            id: 'edit',
                            label: 'Edit',
                            icon: Edit2,
                            tone: 'success' as OperationalRowActionTone,
                            onClick: () => {
                                if (activeTab === 'links') {
                                    setEditingLink(item)
                                    setShowLinkModal(true)
                                } else {
                                    setActiveModal(item)
                                }
                                setRowActionMenu(null)
                            }
                        }] : [])
                    ]
                },
                ...(activeTab !== 'links' ? [{
                    id: 'followOptions' as const,
                    columns: 2 as 2,
                    items: [
                        {
                            id: 'watch',
                            label: normalizedWatchIds.includes(Number(item.id)) ? 'Unwatch' : 'Watch',
                            icon: normalizedWatchIds.includes(Number(item.id)) ? EyeOff : Eye,
                            tone: 'neutral' as OperationalRowActionTone,
                            onClick: () => toggleWatch(item.id)
                        },
                        {
                            id: 'favorite',
                            label: normalizedFavoriteIds.includes(Number(item.id)) ? 'Unpin' : 'Pin',
                            icon: Star,
                            tone: 'warning' as OperationalRowActionTone,
                            onClick: () => toggleFavorite(item.id)
                        }
                    ]
                }] : []),
                {
                    id: 'archive',
                    columns: 1 as 1,
                    items: [
                        ...(activeTab === 'deleted' ? [{
                            id: 'restore',
                            label: 'Restore',
                            icon: Undo2,
                            tone: 'success' as OperationalRowActionTone,
                            variant: 'inline' as OperationalRowActionVariant,
                            onClick: () => {
                                restoreMutation.mutate(item.id)
                                setRowActionMenu(null)
                            }
                        }] : []),
                        {
                            id: 'archive',
                            label: activeTab === 'links'
                              ? (rowDeleteConfirmId === item.id ? 'Confirm Sever Link?' : 'Sever Link')
                              : (
                                  rowDeleteConfirmId === item.id
                                    ? (activeTab === 'active' ? OPERATIONAL_ACTION_LABELS.archiveConfirm : OPERATIONAL_ACTION_LABELS.purgeConfirm)
                                    : (activeTab === 'active' ? OPERATIONAL_ACTION_LABELS.archive : OPERATIONAL_ACTION_LABELS.purge)
                                ),
                            icon: Trash2,
                            tone: 'danger' as OperationalRowActionTone,
                            variant: 'inline' as OperationalRowActionVariant,
                            disabled: activeTab === 'deleted' && !deletedItemPurgeable,
                            disabledReason: activeTab === 'deleted' && !deletedItemPurgeable ? deletedItemPurgeReason : undefined,
                            confirming: rowDeleteConfirmId === item.id,
                            onClick: () => {
                                if (rowDeleteConfirmId !== item.id) {
                                    setRowDeleteConfirmId(item.id)
                                    return
                                }
                                if (activeTab === 'links') {
                                    deleteMutation.mutate({ id: item.id, purge: false, type: 'link' })
                                } else {
                                    deleteMutation.mutate({ id: item.id, purge: activeTab === 'deleted', type: 'entity' })
                                }
                                setRowActionMenu(null)
                                setRowDeleteConfirmId(null)
                            }
                        }
                    ]
                }
              ]

              return (
                <OperationalRowActionMenu
                  onClose={() => setRowActionMenu(null)}
                  meta={activeTab === 'links'
                    ? `ID ${item.id} · Link · ${item.protocol} Port ${item.port}`
                    : `ID ${item.id} · ${item.type || 'External Peer'}`}
                  title={activeTab === 'links' ? item.external_entity_name : item.name}
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
          rows={activeTab === 'links' ? filteredLinks : filteredEntities}
          columnDefs={columnDefs as any}
          runtime={externalGridRuntime}
          rowInteractions={externalRowInteractions}
          contextMenu={externalContextMenu}
          onSelectionChanged={(e) => handleSelectionChanged(e, 'raw')}
          onFirstDataRendered={handleGridDataUpdated}
          onRowDataUpdated={handleGridDataUpdated}
          context={gridContext}
          quickFilterText={searchTerm}
          selectionScopeKey={selectionScopeKey}
          getRowId={getExternalRowId}
          getRowClass={getRowClass}
          fontSize={fontSize}
          rowDensity={rowDensity}
          dataState={externalDataState}
          noRowsLabel={externalDataState.noRowsLabel}
          loading={activeTab === 'links' ? linkLoading : isLoading}
          loadingIcon={<RefreshCcw size={32} className="text-blue-400 animate-spin" />}
          loadingLabel={<p className="text-[10px] font-bold uppercase tracking-[0.3em] text-blue-400">Synchronizing Intelligence Matrix...</p>}
        />
      ) : (
        <OperationalGroupedGridView
          summary={
            <div>
              <p className="text-[10px] font-semibold text-slate-400">Grouped registry matrix</p>
              <p className="pt-1 text-[12px] font-semibold text-slate-100">Sorted by {EXTERNAL_DEFAULT_GROUP_OPTIONS.find((option) => option.value === groupBy)?.label || groupBy}</p>
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
            const selectedCount = section.items.filter((item: any) => selectedIds.includes(item.id)).length
            return (
              <OperationalGroupedGridSection
                key={section.key}
                labelMeta={<span className="text-[9px] font-semibold text-blue-400">{EXTERNAL_DEFAULT_GROUP_OPTIONS.find((option) => option.value === groupBy)?.label}</span>}
                label={section.label}
                count={section.items.length}
                countLabel="peers"
                selectedCount={selectedCount}
                collapsed={isCollapsed}
                onToggle={() => setCollapsedGroups((current) => ({ ...current, [section.key]: !current[section.key] }))}
              >
                {!isCollapsed && (
                  <OperationalDataGrid
                    rows={section.items}
                    columnDefs={columnDefs as any}
                    runtime={externalGridRuntime}
                    rowInteractions={externalRowInteractions}
                    contextMenu={externalContextMenu}
                    onSelectionChanged={(e) => handleSelectionChanged(e, section.key)}
                    onFirstDataRendered={handleGridDataUpdated}
                    onRowDataUpdated={handleGridDataUpdated}
                    context={gridContext}
                    selectionScopeKey={selectionScopeKey}
                    getRowId={getExternalRowId}
                    getRowClass={getRowClass}
                    fontSize={fontSize}
                    rowDensity={rowDensity}
                    noRowsLabel="No external registry data found"
                    className="w-full"
                    height={`${Math.min(600, section.items.length * (fontSize + rowDensity + 5) + 40)}px`}
                  />
                )}
              </OperationalGroupedGridSection>
            )
          })}
        />
      )}

      <WorkspaceModal
        isOpen={!!activeModal}
        onClose={() => {
          setActiveModal(null)
          detailRoute.finishTransition()
        }}
        isDirty={isActiveModalDirty}
        size="workspace"
        isMaximized={isWorkspaceMaximized}
        onMaximizeToggle={() => setIsWorkspaceMaximized((current) => !current)}
        title={activeModal?.id ? `Modify ${externalViewLabel} Identity` : `Add ${externalViewLabel} Identity`}
        subtitle={activeModal?.id ? `Updating ${activeModal.name || 'external registry record'}` : `Register ${externalViewLabel.toLowerCase()} entities, ownership, and dependency context.`}
        icon={activeModal?.id ? <Edit2 size={20} /> : <Plus size={20} />}
        status={activeModal?.id ? (
          <div className="flex items-center gap-2">
            <span className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-widest text-blue-300">
              {activeModal.type || externalViewLabel}
            </span>
            <span className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-widest text-slate-300">
              {activeModal.environment || 'Unspecified'}
            </span>
          </div>
        ) : undefined}
        footerRight={(
          <div className="flex items-center gap-3 shrink-0">
            <ToolbarButton
              onClick={() => (document.getElementById('external-entity-form') as HTMLFormElement | null)?.requestSubmit()}
              disabled={mutation.isPending}
              variant="primary"
              className="px-8 whitespace-nowrap inline-flex items-center"
            >
              {mutation.isPending ? <RefreshCcw className="animate-spin mr-2" size={14} /> : <Check className="mr-2" size={14} />}
              <span>{activeModal?.id ? `Save ${externalViewLabel}` : `Add ${externalViewLabel}`}</span>
            </ToolbarButton>
          </div>
        )}
      >
        <ExternalForm
          formId="external-entity-form"
          renderActions={false}
          initialData={activeModal}
          onSave={mutation.mutate}
          isSaving={mutation.isPending}
          options={options}
          teams={teams || []}
          operators={operators || []}
          backendFieldErrors={activeModalBackendFieldErrors}
          clearBackendFieldError={(field) => {
            setActiveModalBackendFieldErrors((current) => {
              if (!current[field]) return current
              const next = { ...current }
              delete next[field]
              return next
            })
          }}
          onDirtyChange={setIsActiveModalDirty}
          isDirty={isActiveModalDirty}
        />
      </WorkspaceModal>

      {showLinkModal && (
         <LinkForm 
            entities={allEntities?.filter((e: any) => !e.is_deleted)}
            devices={devices}
            onClose={() => {
              setShowLinkModal(false)
              setLinkSeedEntityId(null)
              setEditingLink(null)
              detailRoute.finishTransition()
            }}
            onSave={(data: any) => linkMutation.mutate(data)}
            isPending={linkMutation.isPending}
            initialExternalEntityId={linkSeedEntityId}
            initialData={editingLink}
            onDirtyChange={setIsLinkFormDirty}
         />
      )}

      {compareOpen && (
        <CompareExternalModal
          items={allEntities?.filter((e: any) => selectedIds.includes(e.id)) || []}
          onClose={() => setCompareOpen(false)}
        />
      )}

      <OperationalBulkPreviewModal
        isOpen={Boolean(bulkOperationPreview)}
        workspaceLabel="External"
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

      <WorkspaceModal
        isOpen={!!activeDetails}
        onClose={closeDetails}
        size="workspace"
        isMaximized={isWorkspaceMaximized}
        onMaximizeToggle={() => setIsWorkspaceMaximized((current) => !current)}
        title={
          <div className="flex items-center gap-3">
            <span>{activeDetails?.name || `${externalViewLabel} Details`}</span>
            {activeDetails && (
              <WorkspaceShareHeader id={String(activeDetails.id)} title={activeDetails.name} />
            )}
          </div>
        }
        subtitle={activeDetails ? `${activeDetails.type || externalViewLabel} · ${activeDetails.environment || 'Unspecified'} · ${activeDetails.owner_organization || 'Unassigned organization'}` : undefined}
        icon={<Eye size={20} />}
        forensicLineage={activeDetails ? { createdAt: activeDetails.created_at, updatedAt: activeDetails.updated_at } : undefined}
        status={activeDetails ? (
          <div className="flex items-center gap-2">
            <span className={`rounded-lg border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-widest ${
              activeDetails.status === 'Active'
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/20 bg-amber-500/10 text-amber-300'
            }`}>
              {activeDetails.status || 'Unknown'}
            </span>
            <button
              type="button"
              onClick={() => {
                detailRoute.openEditFromDetail(activeDetails, () => setActiveModal(activeDetails))
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-widest text-emerald-300 transition-colors hover:bg-emerald-500/20"
              title="Edit external identity"
            >
              <Edit2 size={12} />
              Edit
            </button>
          </div>
        ) : undefined}
        footerRight={activeDetails ? (
          <div className="flex items-center gap-3 shrink-0">
            {activeTab === 'deleted' && !isExternalEntityPurgeable(activeDetails) ? (
              <span className="max-w-[280px] text-[10px] font-semibold text-amber-200">
                {getExternalEntityPurgeReason(activeDetails)}
              </span>
            ) : null}
            <ToolbarButton
              onClick={() => {
                detailRoute.openEditFromDetail(activeDetails, () => setActiveModal(activeDetails))
              }}
            >
              Edit
            </ToolbarButton>
            <ToolbarButton
              onClick={() => {
                detailRoute.openLinkFromDetail(activeDetails, () => {
                  setLinkSeedEntityId(activeDetails.id)
                  setShowLinkModal(true)
                })
              }}
            >
              Map Link
            </ToolbarButton>
            <OperationalDisabledActionTooltip
              disabled={activeTab === 'deleted' && !isExternalEntityPurgeable(activeDetails)}
              reason={activeTab === 'deleted' ? getExternalEntityPurgeReason(activeDetails) : undefined}
              className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
            >
              <ToolbarButton
                variant="danger"
                disabled={activeTab === 'deleted' && !isExternalEntityPurgeable(activeDetails)}
                onClick={() => {
                  if (rowDeleteConfirmId === activeDetails.id) {
                    deleteMutation.mutate({ id: activeDetails.id, purge: activeTab === 'deleted', type: 'entity' })
                    detailRoute.closeDetail()
                    setRowDeleteConfirmId(null)
                  } else {
                    setRowDeleteConfirmId(activeDetails.id)
                  }
                }}
                className={rowDeleteConfirmId === activeDetails.id ? 'animate-pulse bg-rose-600 border-rose-500 text-white shadow-lg shadow-rose-500/20 whitespace-nowrap' : 'whitespace-nowrap'}
              >
                {rowDeleteConfirmId === activeDetails.id
                  ? (activeTab === 'active' ? OPERATIONAL_ACTION_LABELS.archiveConfirm : OPERATIONAL_ACTION_LABELS.purgeConfirm)
                  : (activeTab === 'active' ? OPERATIONAL_ACTION_LABELS.archive : OPERATIONAL_ACTION_LABELS.purge)}
              </ToolbarButton>
            </OperationalDisabledActionTooltip>
          </div>
        ) : undefined}
      >
        {activeDetails ? <ExternalDetailsView entity={activeDetails} links={links || []} /> : null}
      </WorkspaceModal>

      <ConfigRegistryModal
        isOpen={showConfig}
        onClose={() => setShowConfig(false)}
        title="External Intelligence Enumerations"
        sections={[
            { title: "Entity Types", category: "ExternalType", icon: Globe },
            { title: "Status Options", category: "Status", icon: RefreshCcw },
            { title: "Environments", category: "Environment", icon: Globe }
        ]}
        onDirtyChange={setIsConfigDirty}
      />
      <OperationalImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        tableName="external_entities"
        displayName={externalRegistryLabel}
      />

      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={() => {
          if (confirmModal.onClose) {
            confirmModal.onClose()
          } else {
            setConfirmModal(prev => ({ ...prev, isOpen: false }))
          }
        }}
        onConfirm={() => {
          if (confirmModal.onConfirm) confirmModal.onConfirm()
          setConfirmModal(prev => ({ ...prev, isOpen: false }))
        }}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
      />

      {confirmation}
    </OperationalWorkspaceShell>
  )
}

function LinkForm({ entities, devices, onClose, onSave, isPending, initialExternalEntityId, initialData, onDirtyChange }: any) {
  const [formData, setFormData] = useState(() => {
    if (initialData) {
      return {
        id: initialData.id,
        external_entity_id: String(initialData.external_entity_id || ''),
        device_id: String(initialData.device_id || ''),
        service_id: String(initialData.service_id || ''),
        direction: initialData.direction || 'Outbound',
        purpose: initialData.purpose || '',
        protocol: initialData.protocol || 'TCP',
        port: initialData.port ? String(initialData.port) : '',
        host_or_fqdn: initialData.host_or_fqdn || '',
        path_or_resource: initialData.path_or_resource || '',
        network_zone: initialData.network_zone || '',
        transport_security: initialData.transport_security || '',
        link_status: initialData.link_status || 'Active',
        credential_reference: initialData.credential_reference || '',
        credentials: initialData.credentials || { username: '', vault_path: '', note: '' }
      }
    }
    return {
      external_entity_id: initialExternalEntityId ? String(initialExternalEntityId) : '', device_id: '', service_id: '', direction: 'Outbound', purpose: '', protocol: 'TCP', port: '',
      host_or_fqdn: '', path_or_resource: '', network_zone: '', transport_security: '', link_status: 'Active', credential_reference: '',
      credentials: { username: '', vault_path: '', note: '' }
    }
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isMaximized, setIsMaximized] = useState(false)
  const initialDirtySnapshotRef = useRef(JSON.stringify(formData))

  const isDirty = JSON.stringify(formData) !== initialDirtySnapshotRef.current
  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  const { data: services } = useQuery({
    queryKey: ['device-services', formData.device_id],
    queryFn: async () => {
      if (!formData.device_id) return []
      return (await apiFetch(`/api/v1/logical-services/?device_id=${formData.device_id}`)).json()
    },
    enabled: !!formData.device_id
  })

  return (
    <WorkspaceModal
      isOpen={true}
      onClose={onClose}
      isDirty={isDirty}
      size="workspace"
      isMaximized={isMaximized}
      onMaximizeToggle={() => setIsMaximized((current) => !current)}
      title="Establish External Link"
      subtitle="Map topology and credentials between the external registry and internal assets."
      icon={<LinkIcon size={20} />}
      status={(
        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-widest text-indigo-300">
            Map Interconnect
          </span>
          <span className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-widest text-emerald-300">
            Data Flow
          </span>
        </div>
      )}
      footerRight={(
        <div className="flex items-center gap-3 shrink-0">
          <ToolbarButton 
            onClick={() => {
              const nextErrors: Record<string, string> = {}
              if (!formData.purpose.trim()) nextErrors.purpose = 'Interconnect purpose is required'
              if (formData.port && (Number(formData.port) < 1 || Number(formData.port) > 65535)) nextErrors.port = 'Port must be between 1 and 65535'
              setErrors(nextErrors)
              if (Object.keys(nextErrors).length) return
              onSave({
                ...formData,
                external_entity_id: parseInt(formData.external_entity_id),
                device_id: parseInt(formData.device_id),
                service_id: formData.service_id ? parseInt(formData.service_id) : null,
                port: formData.port ? parseInt(formData.port, 10) : null,
                network_zone: formData.network_zone || null,
                transport_security: formData.transport_security || null,
                credential_reference: formData.credential_reference || null,
              })
            }}
            disabled={!formData.external_entity_id || !formData.device_id || isPending}
            variant="primary"
            className="px-8 whitespace-nowrap inline-flex items-center"
          >
            {isPending ? <RefreshCcw className="animate-spin mr-2" size={14} /> : <Check className="mr-2" size={14} />}
            <span>Save Link</span>
          </ToolbarButton>
        </div>
      )}
    >
      <div className="space-y-10 pt-6">
           <div className="grid grid-cols-2 gap-10">
              <div className="p-8 bg-indigo-600/5 border border-indigo-500/10 rounded-lg space-y-6">
                 <h3 className="text-[10px] font-black uppercase text-indigo-500 tracking-[0.3em] flex items-center gap-2"><Globe size={14}/> External Peer</h3>
                 <StyledSelect 
                    label="Target External Entity"
                    value={formData.external_entity_id}
                    onChange={e => setFormData({...formData, external_entity_id: e.target.value})}
                    options={entities?.map((e: any) => ({
                      value: e.id,
                      label: `${e.name} [${e.type || 'Unknown Type'}${e.environment ? ` · ${e.environment}` : ''}]`
                    })) || []}
                    placeholder="Select Remote System..."
                 />
                 <StyledSelect 
                    label="Flow Direction"
                    value={formData.direction}
                    onChange={e => setFormData({...formData, direction: e.target.value})}
                    options={LINK_DIRECTION_OPTIONS.map((value) => ({ value, label: value }))}
                 />
              </div>

              <div className="p-8 bg-emerald-600/5 border border-emerald-500/10 rounded-lg space-y-6">
                 <h3 className="text-[10px] font-black uppercase text-emerald-500 tracking-[0.3em] flex items-center gap-2"><Cpu size={14}/> Internal Asset</h3>
                 <StyledSelect 
                    label="Internal Registry Asset"
                    value={formData.device_id}
                    onChange={e => setFormData({...formData, device_id: e.target.value, service_id: ''})}
                    options={devices?.map((d: any) => ({ value: d.id, label: d.name })) || []}
                    placeholder="Select Internal Asset..."
                 />
                 <StyledSelect 
                    label="Logical Service (Optional)"
                    value={formData.service_id}
                    onChange={e => setFormData({...formData, service_id: e.target.value})}
                    options={services?.map((s: any) => ({ value: s.id, label: s.name })) || []}
                    placeholder={formData.device_id ? "Select Service..." : "Select Asset First..."}
                 />
              </div>
           </div>

           <div className="grid grid-cols-2 gap-10 border-t border-white/5 pt-10">
              <div className="space-y-6">
                 <h3 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.3em]">Link Configuration</h3>
                 <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Interconnect Purpose</label>
                    <input 
                      value={formData.purpose} onChange={e => setFormData({...formData, purpose: e.target.value})}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-6 py-4 text-xs font-black text-white outline-none focus:border-indigo-500 transition-all"
                      placeholder="e.g., Daily DB Synchronization Feed"
                    />
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Protocol</label>
                       <StyledSelect value={formData.protocol} onChange={e => setFormData({...formData, protocol: e.target.value})} options={LINK_PROTOCOL_OPTIONS.map((value) => ({ value, label: value }))} />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Port</label>
                       <input 
                         value={formData.port} onChange={e => setFormData({...formData, port: e.target.value})}
                         className="w-full bg-black/40 border border-white/10 rounded-lg px-6 py-4 text-xs font-mono font-black text-indigo-300 outline-none focus:border-indigo-500 transition-all"
                         placeholder="443"
                       />
                    </div>
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                       <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Host / FQDN</label>
                       <input value={formData.host_or_fqdn} onChange={e => setFormData({...formData, host_or_fqdn: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-6 py-4 text-xs font-black text-white outline-none focus:border-indigo-500 transition-all" placeholder="partner.example.com" />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Path / Resource</label>
                       <input value={formData.path_or_resource} onChange={e => setFormData({...formData, path_or_resource: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-6 py-4 text-xs font-black text-white outline-none focus:border-indigo-500 transition-all" placeholder="/v1/ingest" />
                    </div>
                 </div>
                 <div className="grid grid-cols-3 gap-4">
                    <StyledSelect label="Network Zone" value={formData.network_zone} onChange={e => setFormData({...formData, network_zone: e.target.value})} options={LINK_NETWORK_ZONE_OPTIONS.map((value) => ({ value, label: value }))} placeholder="Select zone" />
                    <StyledSelect label="Transport Security" value={formData.transport_security} onChange={e => setFormData({...formData, transport_security: e.target.value})} options={LINK_TRANSPORT_SECURITY_OPTIONS.map((value) => ({ value, label: value }))} placeholder="Select security" />
                    <StyledSelect label="Link Status" value={formData.link_status} onChange={e => setFormData({...formData, link_status: e.target.value})} options={['Active', 'Planned', 'Disabled'].map((value) => ({ value, label: value }))} />
                 </div>
                 {errors.purpose && <p className="text-[9px] font-bold text-rose-400">{errors.purpose}</p>}
                 {errors.port && <p className="text-[9px] font-bold text-rose-400">{errors.port}</p>}
              </div>

              <div className="p-8 bg-indigo-600/5 border border-indigo-500/10 rounded-lg space-y-6">
                 <div className="flex items-center space-x-3 text-indigo-400 border-b border-indigo-500/10 pb-4">
                   <Key size={16} />
                   <h3 className="text-[10px] font-black uppercase tracking-widest">Connection Intelligence</h3>
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    <input 
                      value={formData.credentials.username} onChange={e => setFormData({...formData, credentials: {...formData.credentials, username: e.target.value}})}
                      className="w-full bg-black/60 border border-white/5 rounded-lg px-5 py-4 text-[11px] font-black text-white outline-none focus:border-indigo-500 transition-all"
                      placeholder="Username"
                    />
                    <input value={formData.credentials.vault_path} onChange={e => setFormData({...formData, credentials: {...formData.credentials, vault_path: e.target.value}})} className="w-full bg-black/60 border border-white/5 rounded-lg px-5 py-4 text-[11px] font-black text-white outline-none focus:border-indigo-500 transition-all" placeholder="Vault path" />
                    <textarea 
                      className="col-span-2 w-full bg-black/60 border border-white/5 rounded-lg px-5 py-4 text-[10px] font-bold text-slate-400 outline-none focus:border-indigo-500 transition-all h-24 resize-none"
                      placeholder="Security notes / credential reference..."
                      value={formData.credentials.note}
                      onChange={e => setFormData({...formData, credentials: {...formData.credentials, note: e.target.value}})}
                    />
                 </div>
              </div>
           </div>
      </div>
    </WorkspaceModal>
  )
}
