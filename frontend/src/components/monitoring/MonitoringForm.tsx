
import { WorkspaceModal } from '../shared/WorkspaceModal'
import { parseOperationalApiValidationError } from '../shared/OperationalFieldValidation'
import { 
  WorkspaceSplitView, 
  WorkspaceEmptyState,
  useBodyModalFlag,
  WorkspaceFieldLabel as FieldLabel,
  WorkspaceFieldError as FieldError,
  WorkspaceSectionCard,
  WorkspaceCollapsibleHeader,
  WorkspaceSectionBadge,
  WorkspacePanelTitle as PanelTitle,
  WorkspacePanelSubtitle as PanelSubtitle,
  WorkspaceValidationBanner,
  WorkspaceInfoTooltip,
  WorkspaceSelectField as MonitoringSelectField,
  getWorkspaceInputClass as monitoringInputClass
} from '../shared/OperationalWorkspacePrimitives'
import { StatusPill } from '../shared/StatusPill'
import { ToolbarButton } from '../shared/LayoutPrimitives'
import { useOperationalFormDirty } from '../shared/OperationalFormContracts'
import CodeMirror from '@uiw/react-codemirror'
import { OperationalAssetSelector } from '../shared/OperationalAssetSelector'
import { showWorkspaceToast } from '../shared/WorkspaceToast'
import {
  STATUSES,
  LOGIC_TYPES,
  LOGIC_SUGGESTIONS,
  getLogicExtensions,
  type MonitoringLogicEntry,
  type MonitoringOwner,
  type MonitoringFormErrors,
  type MonitoringTeamOption,
  type OperatorRecord,
} from './monitoringWorkspaceContract'
import {
  CHECK_INTERVAL_MIN,
  CHECK_INTERVAL_MAX,
  ALERT_DURATION_MIN,
  ALERT_DURATION_MAX,
  NOTIFICATION_THROTTLE_MIN,
  NOTIFICATION_THROTTLE_MAX,
} from '../../domain/monitoringContract'
import { isMonitoringFieldRequired } from '../../utils/monitoringValidation'

import { 
  Edit2, 
  Plus,
  Globe, 
  AlertCircle, 
  Clock, 
  Check, 
  X, 
  Activity, 
  Settings, 
  Trash2, 
  List, 
  FileText,
  Search
} from 'lucide-react'
import { apiFetch } from '../../api/apiClient'
import { useQuery, useMutation } from '@tanstack/react-query'
import { sanitizeMonitoringPayload } from '../../utils/monitoring'
import { parseCommaSeparatedValues } from '../../utils/dataParsers'

import { buildMonitoringFormErrors, getMonitoringTabErrorCounts } from '../../utils/monitoringValidation'
import * as React from 'react'
import { useState, useMemo, useEffect, useCallback } from 'react'

const normalizeMonitoringControlledFields = (value: any) => {
  const normalized = value || {}
  return {
    ...normalized,
    title: normalized.title ?? '',
    category: normalized.category ?? '',
    status: normalized.status ?? 'Planned',
    spec: normalized.spec ?? '',
    platform: normalized.platform ?? '',
    monitoring_url: normalized.monitoring_url ?? '',
    purpose: normalized.purpose ?? '',
    impact: normalized.impact ?? '',
    notification_method: normalized.notification_method ?? 'Email',
    notification_recipients: Array.isArray(normalized.notification_recipients) ? normalized.notification_recipients : [],
    logic: normalized.logic ?? '',
    device_id: normalized.device_id ?? null,
    monitored_services: Array.isArray(normalized.monitored_services) ? normalized.monitored_services : [],
    owner_team: normalized.owner_team ?? '',
    check_interval: normalized.check_interval ?? 60,
    alert_duration: normalized.alert_duration ?? 0,
    notification_throttle: normalized.notification_throttle ?? 3600,
    severity: normalized.severity ?? 'Warning',
    recovery_docs: Array.isArray(normalized.recovery_docs) ? normalized.recovery_docs : [],
    owners: Array.isArray(normalized.owners) ? normalized.owners : [],
    logic_json: Array.isArray(normalized.logic_json)
      ? normalized.logic_json.map((entry: any) => ({
          ...entry,
          type: entry?.type ?? LOGIC_TYPES[0] ?? 'Threshold',
          description: entry?.description ?? '',
          logic_info: entry?.logic_info ?? '',
        }))
      : [],
  }
}

export function MonitoringForm({ item, devices, categories, severities, platforms, teams, operators, notificationMethods, ownerRoles, onClose, onSuccess, onDirtyChange }: any) {
  useBodyModalFlag()
  const [activeTab, setActiveTab] = useState<'context' | 'logic' | 'alerting'>('context')
  const [recoverySearch, setRecoverySearch] = useState('')
  const [activeLogicId, setActiveLogicId] = useState<number | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const initialItemPayload = sanitizeMonitoringPayload(item)
  const { logic_json: initialLogicJson = [], ...initialItemFields } = initialItemPayload || {}

  const initialFormState = useMemo(() => normalizeMonitoringControlledFields({
    category: categories?.[0]?.value || '',
    status: 'Planned',
    title: '',
    spec: '',
    platform: platforms?.[0]?.value || '',
    monitoring_url: '',
    purpose: '',
    impact: '',
    notification_method: notificationMethods?.[0]?.value || 'Email',
    notification_recipients: [],
    logic: '',
    device_id: null,
    monitored_services: [],
    owner_team: '',
    check_interval: 60,
    alert_duration: 0,
    notification_throttle: 3600,
    severity: severities?.find((severity: any) => severity.value === 'Warning')?.value || severities?.[0]?.value || 'Warning',
    is_active: item ? true : false,
    recovery_docs: [],
    owners: [],
    ...initialItemFields,
    logic_json: initialLogicJson as MonitoringLogicEntry[]
  }), [categories, initialItemFields, initialLogicJson, item, notificationMethods, platforms, severities])

  const normalizeMonitoringFormState = useCallback((value: typeof initialFormState) => {
    const normalized = normalizeMonitoringControlledFields(sanitizeMonitoringPayload(value))
    if (!item) {
      normalized.is_active = normalized.status === 'Existing'
    }
    return normalized
  }, [item])

  const {
    value: formData,
    isDirty,
    setValue: setFormData,
    patchValue,
    updateValue,
    resetDirty,
  } = useOperationalFormDirty(initialFormState, normalizeMonitoringFormState, onDirtyChange)

  const updateFormData = useCallback((newData: any) => {
    setFormData(newData)
  }, [setFormData])

  const [ownershipMode, setOwnershipMode] = useState<'team' | 'individual'>(
    initialItemFields?.owner_team ? 'team' : (initialItemFields?.owners?.length ? 'individual' : 'team')
  )
  const [newOwner, setNewOwner] = useState<{ operator_id: string; role: string }>({ operator_id: '', role: ownerRoles?.[0]?.value || 'Primary Support' })
  const [recipientInput, setRecipientInput] = useState('')
  const [formErrors, setFormErrors] = useState<MonitoringFormErrors>({})
  const [generalError, setGeneralError] = useState('')
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    target: false,
    ownership: false,
    platform: false,
    context: false,
    logicEntries: false,
    logicEditor: false,
    executionPolicy: false,
    alerting: false,
    recipients: false,
    recovery: false,
  })

  const selectedTeams = useMemo(
    () => {
      const selectedTeamNames = new Set(parseCommaSeparatedValues(formData.owner_team))
      return (teams || []).filter((team: MonitoringTeamOption) => selectedTeamNames.has(team.name))
    },
    [teams, formData.owner_team]
  )

  const teamOperators = useMemo(() => {
    if (!selectedTeams.length) return operators as OperatorRecord[]
    const teamIds = new Set(selectedTeams.map((team) => team.id))
    return (operators as OperatorRecord[]).filter((operator) => operator.team_id != null && teamIds.has(operator.team_id))
  }, [operators, selectedTeams])

  const tabErrors = useMemo(() => getMonitoringTabErrorCounts(formErrors), [formErrors])

  const setOwnershipModeAndNormalize = (mode: 'team' | 'individual') => {
    setOwnershipMode(mode)
    setFormErrors((current) => {
      const next = { ...current }
      delete next.owner_team
      delete next.owners
      delete next.ownership
      return next
    })
  }

  const activeLogicErrors = activeLogicId == null
    ? { description: '', logic_info: '' }
    : {
        description: formErrors[`logic_${activeLogicId}_description`],
        logic_info: formErrors[`logic_${activeLogicId}_logic_info`]
      }

  const toggleSection = (key: string) => {
    setCollapsedSections((current) => ({ ...current, [key]: !current[key] }))
  }

  const addOwner = () => {
    const operatorId = Number(newOwner.operator_id)
    const selectedOperator = teamOperators.find((operator) => operator.id === operatorId) || (operators as OperatorRecord[]).find((operator) => operator.id === operatorId)
    if (selectedOperator && !formData.owners.some((owner) => owner.operator_id === operatorId)) {
       updateFormData({
         ...formData,
         owners: [
           ...formData.owners,
           {
             operator_id: operatorId,
             role: newOwner.role,
             name: selectedOperator.full_name || selectedOperator.username || selectedOperator.external_id,
             external_id: selectedOperator.external_id
           }
         ]
       })
       setFormErrors((current) => {
         const next = { ...current }
         delete next.owners
         delete next.ownership
         return next
       })
       setNewOwner({ operator_id: '', role: ownerRoles?.[0]?.value || 'Primary Support' })
    }
  }

  const removeOwner = (idx: number) => {
    const next = [...formData.owners]
    next.splice(idx, 1)
    updateFormData({ ...formData, owners: next })
  }

  // Initialize activeLogicId if entries exist
  useEffect(() => {
    if (formData.logic_json?.length > 0 && activeLogicId === null) {
      setActiveLogicId(formData.logic_json[0].id)
    }
  }, [formData.logic_json])

  useEffect(() => {
    if (Object.keys(formErrors).length === 0 && !generalError) return
    setFormErrors(buildMonitoringFormErrors(formData))
  }, [formData, ownershipMode])

  // Fetch services for selected device
  const { data: deviceServices } = useQuery({
    queryKey: ['device-services', formData.device_id],
    queryFn: async () => {
      if (!formData.device_id) return []
      return (await apiFetch(`/api/v1/logical-services/?device_id=${formData.device_id}`)).json()
    },
    enabled: !!formData.device_id
  })

  // Fetch knowledge entries for recovery docs
  const { data: knowledgeEntries } = useQuery({
    queryKey: ['knowledge-entries', 'monitoring', item?.id || 'new'],
    queryFn: async () => (await apiFetch(`/api/v1/knowledge/?embedded_consumer=monitoring&monitoring_id=${item!.id}`)).json(),
    // A new monitor has no embedded target yet. Do not issue an unscoped
    // preview projection request; the recovery picker is populated for an
    // existing monitor or after the saved monitor is reopened.
    enabled: Boolean(item?.id),
  })

  const filteredKnowledge = useMemo(() => {
    if (!knowledgeEntries) return []
    return knowledgeEntries.filter((e: any) => 
      e.title.toLowerCase().includes(recoverySearch.toLowerCase()) ||
      e.category.toLowerCase().includes(recoverySearch.toLowerCase())
    )
  }, [knowledgeEntries, recoverySearch])

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const url = item ? `/api/v1/monitoring/${item.id}` : '/api/v1/monitoring/'
      const method = item ? 'PUT' : 'POST'
      const res = await apiFetch(url, { method, body: JSON.stringify(sanitizeMonitoringPayload(data)) })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || 'Failed to save monitoring item')
      }
      return res.json()
    },
    onSuccess: (data: any) => {
      setGeneralError('')
      const action = item ? 'Synchronized' : 'Deployed';
      const detail = item ? 'Changes propagated' : 'New monitor live';
      resetDirty(data ? { ...formData, ...data } : formData)
      showWorkspaceToast(`${action} ${data.title || formData.title}`, {
        type: 'success'
      })
      onSuccess()
    },
    onError: (e: any) => {
      const { fieldErrors, generalError } = parseOperationalApiValidationError(e)
      setFormErrors(fieldErrors)
      const message = generalError || e.message || 'Failed to save monitoring item'
      setGeneralError(message)
      showWorkspaceToast(message, { type: 'error' })
      if (message.toLowerCase().includes('recovery')) setActiveTab('alerting')
      else if (message.toLowerCase().includes('owner') || message.toLowerCase().includes('team')) setActiveTab('context')
      else if (message.toLowerCase().includes('interval') || message.toLowerCase().includes('logic')) setActiveTab('logic')
    }
  })

  const toggleService = (id: number) => {
    const current = [...(formData.monitored_services || [])]
    const idx = current.indexOf(id)
    if (idx > -1) {
      current.splice(idx, 1)
    } else {
      current.push(id)
    }
    updateFormData({ ...formData, monitored_services: current })
  }

  const toggleRecoveryDoc = (id: number) => {
    const current = [...(formData.recovery_docs || [])]
    const idx = current.findIndex((d: any) => (typeof d === 'number' ? d === id : d.id === id))
    if (idx > -1) {
      current.splice(idx, 1)
    } else {
      current.push({ id, note: '' })
    }
    updateFormData({ ...formData, recovery_docs: current })
  }

  const addLogicEntry = () => {
    const id = Date.now()
    const newEntries: MonitoringLogicEntry[] = [...(formData.logic_json || []), { type: 'Threshold', description: '', logic_info: '', id }]
    updateFormData({ ...formData, logic_json: newEntries })
    setActiveLogicId(id)
  }

  const removeLogicEntry = (id: number) => {
    const filtered = formData.logic_json.filter((e: MonitoringLogicEntry) => e.id !== id)
    updateFormData({ ...formData, logic_json: filtered })
    if (activeLogicId === id) {
      setActiveLogicId(filtered.length > 0 ? filtered[0].id : null)
    }
  }

  const updateLogicEntry = (id: number, field: keyof MonitoringLogicEntry, value: string) => {
    const newEntries = formData.logic_json.map((e: MonitoringLogicEntry) => e.id === id ? { ...e, [field]: value } : e)
    updateFormData({ ...formData, logic_json: newEntries })
  }

  const activeLogicEntry = formData.logic_json?.find((e: MonitoringLogicEntry) => e.id === activeLogicId)
  const selectedDevice = useMemo(
    () => (devices || []).find((device: any) => device.id === formData.device_id),
    [devices, formData.device_id]
  )
  const linkedRecoveryDocs = useMemo(
    () => (knowledgeEntries || []).filter((entry: any) => formData.recovery_docs?.includes(entry.id)),
    [knowledgeEntries, formData.recovery_docs]
  )
  const ownershipSummary = [
    parseCommaSeparatedValues(formData.owner_team).length
      ? `${parseCommaSeparatedValues(formData.owner_team).length} team${parseCommaSeparatedValues(formData.owner_team).length === 1 ? '' : 's'}`
      : null,
    formData.owners?.length
      ? `${formData.owners.length} owner${formData.owners.length === 1 ? '' : 's'}`
      : null,
  ].filter(Boolean).join(' · ') || 'No owners assigned'
  const summaryIssues = useMemo(() => {
    const issues: Array<{ label: string; tab: 'context' | 'logic' | 'alerting'; anchor: string }> = []
    Object.keys(formErrors).forEach((key) => {
      if (['title', 'category', 'status', 'owner_team', 'owners', 'ownership', 'monitoring_url'].includes(key)) {
        issues.push({ label: formErrors[key] || 'Context issue', tab: 'context', anchor: 'monitoring-context-root' })
      } else if (['check_interval', 'alert_duration'].includes(key) || key.startsWith('logic_')) {
        issues.push({ label: formErrors[key] || 'Logic issue', tab: 'logic', anchor: 'monitoring-logic-root' })
      } else if (['severity', 'notification_method', 'notification_throttle', 'recovery_docs'].includes(key)) {
        issues.push({ label: formErrors[key] || 'Alerting issue', tab: 'alerting', anchor: 'monitoring-alerting-root' })
      }
    })
    return issues
  }, [formErrors])

  const addRecipient = () => {
    if (recipientInput && !formData.notification_recipients.includes(recipientInput)) {
      updateFormData({ ...formData, notification_recipients: [...formData.notification_recipients, recipientInput] })
      setRecipientInput('')
    }
  }

  const removeRecipient = (r: string) => {
    updateFormData({ ...formData, notification_recipients: formData.notification_recipients.filter((item: string) => item !== r) })
  }

  const handleSave = () => {
    const errors = buildMonitoringFormErrors(formData)
    setFormErrors(errors)
    setGeneralError('')
    if (Object.keys(errors).length > 0) {
      const counts = getMonitoringTabErrorCounts(errors)
      if (counts.context > 0) setActiveTab('context')
      else if (counts.logic > 0) setActiveTab('logic')
      else if (counts.alerting > 0) setActiveTab('alerting')
      showWorkspaceToast('Resolve the highlighted form errors before saving', { type: 'error' })
      return
    }
    mutation.mutate(formData)
  }

  const jumpToSection = (tab: 'context' | 'logic' | 'alerting', anchor: string) => {
    setActiveTab(tab)
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 80)
    })
  }

  return (
    <WorkspaceModal
      isOpen={true}
      onClose={onClose}
      isDirty={isDirty}
      size="workspace"
      isMaximized={isMaximized}
      onMaximizeToggle={() => setIsMaximized(prev => !prev)}
      title={item ? 'Update Monitoring' : 'Add Monitoring'}
      subtitle={item ? `Adjusting configuration for ${item.title}` : "Configure monitoring targets, logic, and alert routing."}
      icon={item ? <Edit2 size={20} /> : <Plus size={20} />}
      status={
        <div className="flex items-center gap-2">
          <StatusPill value={formData.status ?? 'Planned'} />
          <StatusPill value={formData.severity ?? 'Warning'} />
          {formData.platform && (
            <>
              <div className="h-3 w-px bg-white/10 mx-1" />
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest whitespace-nowrap">{formData.platform}</span>
            </>
          )}
        </div>
      }
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as 'context' | 'logic' | 'alerting')}
      tabs={[
        { id: 'context', label: 'Context', badgeCount: tabErrors.context },
        { id: 'logic', label: 'Logic', badgeCount: tabErrors.logic },
        { id: 'alerting', label: 'Alerting', badgeCount: tabErrors.alerting },
      ]}
      footerLeft={
          <button 
            onClick={() => {
              if (formData.status === 'Existing') {
                patchValue({ is_active: !formData.is_active })
              }
            }}
            disabled={formData.status !== 'Existing'}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg border transition-all ${
              formData.is_active 
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20' 
                : 'bg-slate-500/10 border-white/10 text-slate-500 hover:bg-white/5 hover:text-white'
            } ${formData.status !== 'Existing' ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <div className={`w-2 h-2 rounded-full ${formData.is_active ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
            <span className="text-[10px] font-black uppercase tracking-widest">{formData.is_active ? 'Monitor Active' : 'Monitor Paused'}</span>
          </button>
      }
      footerRight={
        <div className="flex items-center gap-3 flex-nowrap shrink-0">
          <ToolbarButton
            onClick={handleSave}
            disabled={mutation.isPending}
            variant="primary"
            className="px-8 whitespace-nowrap inline-flex items-center"
          >
            {mutation.isPending ? <Clock className="animate-spin mr-2" size={14} /> : <Check className="mr-2" size={14} />}
            <span className="whitespace-nowrap">{item ? 'Save Monitoring' : 'Add Monitoring'}</span>
          </ToolbarButton>
        </div>
      }
    >
      <div className="space-y-8 pt-6">
          <div className="space-y-4">
            <div className="grid grid-cols-12 gap-6">
              <div id="monitoring-header-title" className="col-span-12 lg:col-span-6 space-y-2">
                <FieldLabel label="Monitoring Item Title" required />
                <input
                  value={formData.title ?? ''}
                  onChange={e => updateFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g. CORE-DB: High CPU Load Alert"
                  className={monitoringInputClass(formErrors.title)}
                />
                <FieldError message={formErrors.title} />
              </div>
              <div className="col-span-12 sm:col-span-6 lg:col-span-3 space-y-2">
                <MonitoringSelectField
                  label="Status"
                  required={isMonitoringFieldRequired('status')}
                  value={formData.status ?? 'Planned'}
                  onChange={(value) => updateValue((current) => ({
                    ...current,
                    status: value,
                    ...(!item ? { is_active: value === 'Existing' } : {}),
                  }))}
                  options={STATUSES.map(s => ({ value: s.value, label: s.value }))}
                  error={formErrors.status}
                />
              </div>
              <div className="col-span-12 sm:col-span-6 lg:col-span-3 space-y-2">
                <MonitoringSelectField
                  label="Severity"
                  required={isMonitoringFieldRequired('severity')}
                  value={formData.severity ?? 'Warning'}
                  onChange={(value) => updateFormData({ ...formData, severity: value })}
                  options={severities.map((severity: any) => ({ value: severity.value, label: severity.label }))}
                  error={formErrors.severity}
                />
                </div>
                </div>

                <div className="grid grid-cols-12 gap-6">
                <div className="col-span-12 sm:col-span-6 lg:col-span-3 space-y-2">
                <MonitoringSelectField
                  label="Logic Category"
                  required={isMonitoringFieldRequired('category')}
                  value={formData.category ?? ''}
                  onChange={(value) => updateFormData({ ...formData, category: value })}
                  options={categories.map((c: any) => ({ value: c.value, label: c.label }))}
                  error={formErrors.category}
                />
                </div>
                <div className="col-span-12 sm:col-span-6 lg:col-span-3 space-y-2">
                <MonitoringSelectField
                  label="Target Platform"
                  value={formData.platform ?? ''}
                  onChange={(value) => updateFormData({ ...formData, platform: value })}
                  options={(platforms || []).map((platform: any) => ({ value: platform.value, label: platform.label }))}
                  placeholder="Select platform"
                  error={formErrors.platform}
                  searchable
                />
                </div>
            </div>
          </div>
          <WorkspaceValidationBanner message={generalError} />

          <WorkspaceSplitView
            main={
              <div className="min-w-0">
                {activeTab === 'context' ? (
                  <div id="monitoring-context-root" className="space-y-5 p-2">
                    <WorkspaceSectionCard id="monitoring-target-card">
                      <WorkspaceCollapsibleHeader
                        title="Target identity"
                        subtitle="Define scope, secure console access, and linked service coverage."
                        badge={<WorkspaceSectionBadge>Asset + scope</WorkspaceSectionBadge>}
                        collapsed={collapsedSections.target}
                        onToggle={() => toggleSection('target')}
                      />
                      {!collapsedSections.target && <div className="mt-4 space-y-4">
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                          <div className="space-y-4 rounded-lg border border-white/10 bg-black/20 p-4 shadow-inner">
                            <div className="flex items-center justify-between">
                              <div>
                                <PanelTitle>Registry asset and service scope</PanelTitle>
                                <PanelSubtitle>Link a registry asset and select the services covered by this monitor.</PanelSubtitle>
                              </div>
                              <span className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-[9px] font-black text-blue-300">
                                {formData.monitored_services?.length || 0} linked
                              </span>
                            </div>

                            <div className="space-y-4">
                              <OperationalAssetSelector
                                label="Registry Asset"
                                assets={devices || []}
                                value={formData.device_id ?? null}
                                onChange={(deviceId) => updateFormData({ ...formData, device_id: deviceId, monitored_services: [] })}
                              />

                              {formData.device_id ? (
                                <div className="space-y-2">
                                  <FieldLabel label="Service Coverage" />
                                  <div className="flex flex-wrap gap-1.5">
                                    {deviceServices?.map((svc: any) => (
                                      <button
                                        key={svc.id}
                                        type="button"
                                        onClick={() => {
                                            const current = [...(formData.monitored_services || [])]
                                            const idx = current.indexOf(svc.id)
                                            if (idx > -1) {
                                              current.splice(idx, 1)
                                            } else {
                                              current.push(svc.id)
                                            }
                                            updateFormData({ ...formData, monitored_services: current })
                                        }}
                                        className={`rounded-lg border px-2.5 py-1.5 text-[9px] font-black transition-all ${
                                          formData.monitored_services?.includes(svc.id)
                                            ? 'border-blue-500/40 bg-blue-500/12 text-blue-200'
                                            : 'border-white/10 bg-slate-950/60 text-slate-500 hover:border-white/20 hover:text-slate-200'
                                        }`}
                                      >
                                        {svc.name}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <WorkspaceEmptyState
                                  compact
                                  title="Choose an asset first"
                                  description="Asset-linked services appear here after a registry asset is selected."
                                />
                              )}
                            </div>
                          </div>

                          <div className="space-y-4">
                            <div className="space-y-1.5">
                              <FieldLabel label="Monitoring URL" />
                              <div className="relative group">
                                <Globe size={12} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors" />
                                <input
                                  value={formData.monitoring_url ?? ''}
                                  onChange={e => updateFormData({ ...formData, monitoring_url: e.target.value })}
                                  placeholder="https://console.internal/..."
                                  className={`${monitoringInputClass(formErrors.monitoring_url)} pl-9 text-blue-300`}
                                />
                              </div>
                              <FieldError message={formErrors.monitoring_url} />
                            </div>

                            <div className="rounded-lg border border-white/10 bg-black/20 p-4 shadow-inner">
                              <h4 className="text-[10px] font-black text-slate-500 mb-2 uppercase tracking-widest">Scope Summary</h4>
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-[9px] text-slate-600 uppercase font-black tracking-widest">Primary Asset</span>
                                  <span className="text-[11px] font-bold text-slate-100">{selectedDevice?.name || 'Unlinked'}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[9px] text-slate-600 uppercase font-black tracking-widest">System</span>
                                  <span className="text-[11px] font-bold text-slate-100">{selectedDevice?.system || 'Unlinked'}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>}
                    </WorkspaceSectionCard>

                    <WorkspaceSectionCard>
                      <WorkspaceCollapsibleHeader
                        title="Operational purpose"
                        subtitle="Document why the monitor exists and what the alert means."
                        collapsed={collapsedSections.context}
                        onToggle={() => toggleSection('context')}
                      />
                      {!collapsedSections.context && <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <div className="space-y-1.5">
                          <FieldLabel label="Purpose" />
                          <textarea
                            value={formData.purpose ?? ''}
                            onChange={e => updateFormData({ ...formData, purpose: e.target.value })}
                            placeholder="Why are we monitoring this?"
                            rows={5}
                            className={`${monitoringInputClass()} resize-none text-[11px] font-bold`}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <FieldLabel label="Impact" />
                          <textarea
                            value={formData.impact ?? ''}
                            onChange={e => updateFormData({ ...formData, impact: e.target.value })}
                            placeholder="What happens when this monitor triggers?"
                            rows={5}
                            className={`${monitoringInputClass()} resize-none text-[11px] font-bold`}
                          />
                        </div>
                      </div>}
                    </WorkspaceSectionCard>

                    <WorkspaceSectionCard id="monitoring-ownership-card">
                      <WorkspaceCollapsibleHeader
                        title="Ownership"
                        subtitle="Team and individual ownership are both optional and can coexist."
                        badge={<WorkspaceSectionBadge tone="blue">{ownershipMode === 'team' ? 'Team owner' : 'Individual owners'}</WorkspaceSectionBadge>}
                        collapsed={collapsedSections.ownership}
                        onToggle={() => toggleSection('ownership')}
                      />
                      {!collapsedSections.ownership && <>
                        <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-black/30 p-1">
                          {[
                            { id: 'team', label: 'Team owner' },
                            { id: 'individual', label: 'Individual owners' }
                          ].map((mode) => (
                            <button
                              key={mode.id}
                              type="button"
                              onClick={() => setOwnershipModeAndNormalize(mode.id as 'team' | 'individual')}
                              className={`rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
                                ownershipMode === mode.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-500 hover:text-slate-200'
                              }`}
                            >
                              {mode.label}
                            </button>
                          ))}
                        </div>
                        <FieldError message={formErrors.ownership} />
                        <div className="mt-4">
                          {ownershipMode === 'team' ? (
                            <div className="space-y-3">
                              <div className="space-y-1.5">
                                <FieldLabel label="Owner Team(s)" />
                                <input
                                  value={formData.owner_team ?? ''}
                                  onChange={(event) => updateFormData({ ...formData, owner_team: event.target.value })}
                                  placeholder="Comma-separated team names"
                                  className={monitoringInputClass(formErrors.owner_team)}
                                />
                              </div>
                              <FieldError message={formErrors.owner_team} />
                              <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">
                                Optional. Use comma-separated team names from the registered team list.
                              </p>
                              <WorkspaceInfoTooltip
                                label={<span>Allowed team names</span>}
                                content={
                                  (teams || []).length > 0
                                    ? (teams || []).map((team: MonitoringTeamOption) => (
                                        <div key={team.id} className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                                          <p className="text-[10px] font-semibold text-slate-100">{team.name}</p>
                                          <p className="mt-1 text-[9px] font-semibold text-slate-500">{team.operators?.length || 0} members</p>
                                        </div>
                                      ))
                                    : <p>No teams available.</p>
                                }
                              />
                              {selectedTeams.length > 0 && (
                                <div className="rounded-lg border border-white/10 bg-black/20 p-4 shadow-inner">
                                  <p className="text-[11px] font-bold text-slate-100 tracking-tight">{selectedTeams.map((team) => team.name).join(', ')}</p>
                                  <p className="mt-1 text-[9px] font-black text-slate-600 uppercase tracking-widest">
                                    {selectedTeams.length} selected team{selectedTeams.length === 1 ? '' : 's'}
                                  </p>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="grid grid-cols-12 gap-3 items-end">
                                <div className="col-span-12 md:col-span-5">
                                  <MonitoringSelectField
                                    label="Operator"
                                    value={newOwner.operator_id ?? ''}
                                    onChange={(value) => setNewOwner({ ...newOwner, operator_id: value })}
                                    options={(operators as OperatorRecord[]).map((operator) => ({
                                      value: String(operator.id),
                                      label: operator.full_name || operator.username || operator.external_id,
                                      description: `${operator.team || 'No team'}`
                                    }))}
                                    placeholder="Select operator"
                                    error={formErrors.owners}
                                    searchable
                                  />
                                </div>
                                <div className="col-span-12 md:col-span-5">
                                  <MonitoringSelectField
                                    label="Role"
                                    value={newOwner.role ?? ''}
                                    onChange={(value) => setNewOwner({ ...newOwner, role: value })}
                                    options={ownerRoles.map((r: any) => ({ value: r.value, label: r.label }))}
                                  />
                                </div>
                                <div className="col-span-12 md:col-span-2">
                                  <button
                                    type="button"
                                    onClick={addOwner}
                                    className="w-full rounded-lg border border-blue-500/30 bg-blue-600 px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-white transition-all hover:bg-blue-500 active:scale-95 shadow-lg shadow-blue-500/20"
                                  >
                                    Add
                                  </button>
                                </div>
                              </div>
                              <FieldError message={formErrors.owners} />
                              <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1 custom-scrollbar">
                                {formData.owners?.length ? formData.owners.map((o: any, idx: number) => (
                                  <div key={idx} className="flex items-center justify-between rounded-lg border border-white/5 bg-black/40 px-3 py-2 shadow-inner group hover:border-white/10 transition-all">
                                    <div className="min-w-0">
                                      <p className="truncate text-[10px] font-bold text-slate-100">{o.name}</p>
                                      <p className="mt-0.5 text-[8px] font-black text-slate-600 tracking-widest truncate">{o.role}</p>
                                    </div>
                                    <button type="button" onClick={() => removeOwner(idx)} className="rounded-lg p-1.5 text-slate-600 transition-all hover:text-rose-400 hover:bg-rose-500/10">
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                )) : (
                                  <WorkspaceEmptyState compact title="No owners assigned" description="Add one or more individual owners for this monitor." />
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </>}
                    </WorkspaceSectionCard>
                  </div>
                ) : activeTab === 'logic' ? (
                  <div id="monitoring-logic-root" className="grid grid-cols-12 gap-5 p-2 min-h-[560px]">
                    <div className="col-span-12 xl:col-span-4 space-y-5">
                      <WorkspaceSectionCard>
                        <WorkspaceCollapsibleHeader
                          title="Logic entries"
                          subtitle="Manage the checks that feed this monitor."
                          collapsed={collapsedSections.logicEntries}
                          onToggle={() => toggleSection('logicEntries')}
                          action={
                            <button
                              onClick={(e) => { e.stopPropagation(); addLogicEntry() }}
                              className="rounded-lg border border-emerald-500/30 bg-emerald-600/20 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-emerald-400 transition-all hover:bg-emerald-600/35 active:scale-95"
                            >
                              Add entry
                            </button>
                          }
                        />
                        {!collapsedSections.logicEntries && <div className="mt-4 space-y-2 max-h-[420px] overflow-y-auto custom-scrollbar pr-2">
                          {formData.logic_json?.map((entry: MonitoringLogicEntry) => (
                            <div
                              key={entry.id}
                              onClick={() => setActiveLogicId(entry.id)}
                              className={`rounded-lg border p-4 cursor-pointer transition-all relative group shadow-sm ${
                                activeLogicId === entry.id
                                  ? 'bg-blue-600/10 border-blue-500/40 shadow-blue-500/5'
                                  : 'bg-black/40 border-white/5 hover:border-white/20 shadow-inner'
                              }`}
                            >
                              <button
                                onClick={(e) => { e.stopPropagation(); removeLogicEntry(entry.id) }}
                                className="absolute right-2 top-2 rounded-lg p-1.5 text-slate-700 opacity-0 transition-all group-hover:opacity-100 hover:text-rose-400 hover:bg-rose-500/10"
                              >
                                <X size={10} />
                              </button>
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">{entry.type}</span>
                                <span className="text-[8px] font-black text-slate-700 uppercase tracking-widest">ID {entry.id.toString().slice(-4)}</span>
                              </div>
                              <p className="mt-2 truncate text-[11px] font-bold text-slate-200">{entry.description || 'No description provided'}</p>
                              <p className="mt-1 text-[9px] font-bold text-slate-600 truncate tracking-tight">{entry.logic_info || 'No definition yet'}</p>
                              {(formErrors[`logic_${entry.id}_description`] || formErrors[`logic_${entry.id}_logic_info`]) && (
                                <p className="mt-2 text-[8px] font-black uppercase tracking-widest text-rose-500">Validation error</p>
                              )}
                            </div>
                          ))}
                          {formData.logic_json?.length === 0 && (
                            <WorkspaceEmptyState compact icon={<Settings size={22} />} title="No logic entries defined" description="Add an entry to configure the first check." />
                          )}
                        </div>}
                      </WorkspaceSectionCard>
                    </div>

                    <div className="col-span-12 xl:col-span-8 flex flex-col space-y-5 min-h-0">
                      <WorkspaceSectionCard>
                        <WorkspaceCollapsibleHeader
                          title="Execution policy"
                          subtitle="Keep check cadence, delay, and alert throttle aligned as one operational rule set."
                          collapsed={collapsedSections.executionPolicy}
                          onToggle={() => toggleSection('executionPolicy')}
                        />
                        {!collapsedSections.executionPolicy && <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <FieldLabel label="Check interval" required />
                              <span className="text-[8px] font-black text-slate-700 uppercase tracking-widest">{CHECK_INTERVAL_MIN}-{CHECK_INTERVAL_MAX}s</span>
                            </div>
                            <div className="relative group">
                              <Clock size={12} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-blue-400 transition-colors" />
                              <input
                                type="number"
                                value={formData.check_interval ?? ''}
                                min={CHECK_INTERVAL_MIN}
                                max={CHECK_INTERVAL_MAX}
                                onChange={e => updateFormData({ ...formData, check_interval: Number(e.target.value) })}
                                className={`${monitoringInputClass(formErrors.check_interval)} pl-9 font-bold`}
                              />
                            </div>
                            <FieldError message={formErrors.check_interval} />
                          </div>
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <FieldLabel label="Alert duration" required />
                              <span className="text-[8px] font-black text-slate-700 uppercase tracking-widest">{ALERT_DURATION_MIN}-{ALERT_DURATION_MAX}s</span>
                            </div>
                            <div className="relative group">
                              <AlertCircle size={12} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-blue-400 transition-colors" />
                              <input
                                type="number"
                                value={formData.alert_duration ?? ''}
                                min={ALERT_DURATION_MIN}
                                max={ALERT_DURATION_MAX}
                                onChange={e => updateFormData({ ...formData, alert_duration: Number(e.target.value) })}
                                className={`${monitoringInputClass(formErrors.alert_duration)} pl-9 font-bold`}
                              />
                            </div>
                            <FieldError message={formErrors.alert_duration} />
                          </div>
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <FieldLabel label="Notification throttle" required />
                              <span className="text-[8px] font-black text-slate-700 uppercase tracking-widest">{NOTIFICATION_THROTTLE_MIN}-{NOTIFICATION_THROTTLE_MAX}s</span>
                            </div>
                            <input
                              type="number"
                              value={formData.notification_throttle ?? ''}
                              min={NOTIFICATION_THROTTLE_MIN}
                              max={NOTIFICATION_THROTTLE_MAX}
                              onChange={e => updateFormData({ ...formData, notification_throttle: Number(e.target.value) })}
                              className={`${monitoringInputClass(formErrors.notification_throttle)} font-bold`}
                            />
                            <FieldError message={formErrors.notification_throttle} />
                          </div>
                        </div>}
                      </WorkspaceSectionCard>

                      {activeLogicEntry ? (
                        <WorkspaceSectionCard className="flex h-full flex-col min-h-[420px]">
                          <WorkspaceCollapsibleHeader
                            title="Logic editor"
                            subtitle="Edit the active logic entry with the syntax-aware editor."
                            badge={<WorkspaceSectionBadge>{activeLogicEntry.type}</WorkspaceSectionBadge>}
                            collapsed={collapsedSections.logicEditor}
                            onToggle={() => toggleSection('logicEditor')}
                          />
                          {!collapsedSections.logicEditor && <>
                            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                              <MonitoringSelectField
                                label="Logic Type"
                                required
                                value={activeLogicEntry.type ?? LOGIC_TYPES[0] ?? 'Threshold'}
                                onChange={(value) => updateLogicEntry(activeLogicEntry.id, 'type', value)}
                                options={LOGIC_TYPES.map(t => ({ value: t, label: t }))}
                              />
                              <div className="space-y-1.5">
                                <FieldLabel label="Entry Description" required />
                                <input
                                  value={activeLogicEntry.description ?? ''}
                                  onChange={e => updateLogicEntry(activeLogicEntry.id, 'description', e.target.value)}
                                  placeholder="Verification logic purpose"
                                  className={`${monitoringInputClass(activeLogicErrors.description)} font-bold`}
                                />
                                <FieldError message={activeLogicErrors.description} />
                              </div>
                            </div>
                            <div className="mt-4 flex-1 flex flex-col space-y-2 min-h-0">
                              <div className="flex items-center justify-between px-1">
                                <FieldLabel label="Logic Information" required />
                                <span className="text-[8px] font-black text-slate-700 uppercase tracking-widest">Logic Engine</span>
                              </div>
                              <div className={`flex-1 overflow-hidden rounded-lg border shadow-inner min-h-[280px] ${
                                activeLogicErrors.logic_info ? 'border-rose-500/60 bg-rose-500/10' : 'border-white/10 bg-black/40'
                              }`}>
                                <CodeMirror
                                  value={activeLogicEntry.logic_info ?? ''}
                                  height="100%"
                                  minHeight="280px"
                                  extensions={getLogicExtensions(activeLogicEntry.type)}
                                  basicSetup={{ lineNumbers: true, foldGutter: true }}
                                  placeholder={LOGIC_SUGGESTIONS[activeLogicEntry.type] || 'Enter logic parameters...'}
                                  onChange={(value) => updateLogicEntry(activeLogicEntry.id, 'logic_info', value)}
                                  theme="dark"
                                />
                              </div>
                              <FieldError message={activeLogicErrors.logic_info} />
                            </div>
                          </>}
                        </WorkspaceSectionCard>
                      ) : (
                        <WorkspaceEmptyState icon={<Activity size={32} className="animate-pulse" />} title="Select a logic entry" description="Choose an entry from the left to edit its definition." />
                      )}
                    </div>
                  </div>
                ) : (
                  <div id="monitoring-alerting-root" className="grid grid-cols-12 gap-5 p-2">
                    <div className="col-span-12 xl:col-span-4 space-y-5">
                      <WorkspaceSectionCard>
                        <WorkspaceCollapsibleHeader
                          title="Severity and notification"
                          subtitle="Choose the delivery path and throttling behavior."
                          collapsed={collapsedSections.alerting}
                          onToggle={() => toggleSection('alerting')}
                        />
                        {!collapsedSections.alerting && <div className="mt-4 space-y-4">
                          <MonitoringSelectField
                            label="Notification Method"
                            value={formData.notification_method ?? 'Email'}
                            onChange={(value) => updateFormData({ ...formData, notification_method: value })}
                            options={notificationMethods.map((m:any) => ({ value: m.value, label: m.label }))}
                            error={formErrors.notification_method}
                          />
                          <div className="rounded-lg border border-white/5 bg-black/40 p-5 shadow-inner">
                            <p className="text-[9px] font-black text-slate-700 uppercase tracking-widest">Severity Context</p>
                            <p className="mt-2 text-[12px] font-bold text-slate-100">{formData.severity}</p>
                            <p className="mt-2 text-[9px] font-bold text-slate-600 uppercase tracking-widest">Pinned in the identity header for constant operational context.</p>
                          </div>
                        </div>}
                      </WorkspaceSectionCard>

                      <WorkspaceSectionCard>
                        <WorkspaceCollapsibleHeader
                          title="Recipients"
                          subtitle="Define who receives notifications from this monitor."
                          collapsed={collapsedSections.recipients}
                          onToggle={() => toggleSection('recipients')}
                        />
                        {!collapsedSections.recipients && <div className="mt-4 space-y-4">
                          <div className="flex space-x-2">
                            <input
                              value={recipientInput ?? ''}
                              onChange={e => setRecipientInput(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && addRecipient()}
                              placeholder="ID or Email..."
                              className={`${monitoringInputClass()} flex-1 py-2.5 text-[11px] font-bold`}
                            />
                            <button onClick={addRecipient} className="rounded-lg bg-blue-600 px-4 text-white transition-all hover:bg-blue-500 shadow-lg shadow-blue-500/20 active:scale-95 shrink-0"><Plus size={14} /></button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {formData.notification_recipients.map((r: string) => (
                              <div key={r} className="flex items-center space-x-3 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-1.5 shadow-sm group hover:border-blue-500/40 transition-all">
                                <span className="text-[10px] font-bold text-blue-300">{r}</span>
                                <button onClick={() => removeRecipient(r)} className="text-slate-600 transition-colors hover:text-rose-400"><X size={10} /></button>
                              </div>
                            ))}
                            {formData.notification_recipients.length === 0 && (
                              <WorkspaceEmptyState compact title="No recipients defined" description="Add one or more destinations for alert delivery." />
                            )}
                          </div>
                        </div>}
                      </WorkspaceSectionCard>
                    </div>

                    <div className="col-span-12 xl:col-span-8 space-y-5">
                      <WorkspaceSectionCard>
                        <WorkspaceCollapsibleHeader
                          title="Recovery procedures"
                          subtitle="Linked recovery guidance is shown to the on-call engineer."
                          badge={formData.severity === 'Critical' ? <WorkspaceSectionBadge tone="rose">Required for Critical</WorkspaceSectionBadge> : undefined}
                          collapsed={collapsedSections.recovery}
                          onToggle={() => toggleSection('recovery')}
                        />
                        {!collapsedSections.recovery && <div className="mt-4 space-y-4">
                          <div className={`space-y-4 rounded-lg border-2 p-6 shadow-inner ${formErrors.recovery_docs ? 'border-rose-500/40 bg-rose-500/10' : 'border-dashed border-white/5 bg-black/40'}`}>
                            <div className="flex items-center justify-between">
                              <div className="space-y-0.5">
                                <PanelTitle>Link recovery documents (BKM)</PanelTitle>
                                <PanelSubtitle>Linked protocols are presented to the on-call engineer.</PanelSubtitle>
                              </div>
                              <div className="flex items-center space-x-2 rounded-lg border border-blue-600/20 bg-blue-600/10 px-3 py-1.5 shrink-0">
                                <List size={10} className="text-blue-400" />
                                <span className="text-[10px] font-black text-blue-300 uppercase">{formData.recovery_docs?.length || 0} linked</span>
                              </div>
                            </div>
                            <div className="relative group">
                              <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors" />
                              <input
                                value={recoverySearch ?? ''}
                                onChange={e => setRecoverySearch(e.target.value)}
                                placeholder="Search Knowledge Base..."
                                className={`${monitoringInputClass()} pl-11 py-3 text-[11px] font-bold`}
                              />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[320px] overflow-y-auto custom-scrollbar pr-2">
                              {filteredKnowledge?.map((entry: any) => {
                                 const isLinked = formData.recovery_docs?.some((d: any) => (typeof d === 'number' ? d === entry.id : d.id === entry.id));
                                 return (
                                  <button
                                    key={`rec-${entry.id}`}
                                    type="button"
                                    onClick={() => toggleRecoveryDoc(entry.id)}
                                    className={`p-4 rounded-lg border text-left transition-all relative overflow-hidden group ${
                                      isLinked
                                        ? 'bg-blue-600/15 border-blue-500/50 shadow-lg shadow-blue-500/5'
                                        : 'bg-black/40 border-white/5 hover:border-white/20'
                                    }`}
                                  >
                                    {isLinked && (
                                      <div className="absolute top-0 right-0 w-7 h-7 bg-blue-600 flex items-center justify-center rounded-lg shadow-lg">
                                        <Check size={12} className="text-white" strokeWidth={4} />
                                      </div>
                                    )}
                                    <div className="flex items-center space-x-2 mb-2">
                                      <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 bg-slate-800 text-slate-400 rounded-lg border border-white/5 truncate">{entry.category}</span>
                                      <span className="text-[8px] font-black text-slate-700 uppercase tracking-widest shrink-0">#{entry.id}</span>
                                    </div>
                                    <p className={`text-[11px] font-bold leading-tight ${isLinked ? 'text-blue-100' : 'text-slate-300'} line-clamp-2`}>
                                      {entry.title}
                                    </p>
                                  </button>
                                 )
                              })}
                              {filteredKnowledge?.length === 0 && (
                                <div className="col-span-2 py-10 text-center flex flex-col items-center justify-center space-y-3 opacity-30">
                                   <Search size={32} className="text-slate-700" />
                                   <p className="text-[10px] font-black uppercase tracking-widest text-slate-700">No knowledge entries detected</p>
                                </div>
                              )}
                            </div>

                            <div className="space-y-4 border-t border-white/5 pt-6">
                               <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest px-1">Configure guidance notes</p>
                               <div className="grid grid-cols-1 gap-4">
                                  {formData.recovery_docs?.map((doc: any, idx: number) => {
                                     const did = typeof doc === 'number' ? doc : doc.id;
                                     const note = typeof doc === 'number' ? '' : doc.note;
                                     const entry = (knowledgeEntries || []).find((e: any) => e.id === did);
                                     return (
                                        <div key={idx} className="bg-black/40 border border-white/5 rounded-lg p-4 space-y-3 group hover:border-blue-500/20 transition-all shadow-inner">
                                           <div className="flex items-center justify-between">
                                              <div className="flex items-center gap-3">
                                                 <div className="p-1.5 bg-blue-500/10 text-blue-400 rounded-lg"><FileText size={12}/></div>
                                                 <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest truncate max-w-[240px]">{entry?.title || `KB-${did}`}</span>
                                              </div>
                                              <button type="button" onClick={() => toggleRecoveryDoc(did)} className="text-slate-600 hover:text-rose-500 transition-colors">
                                                 <Trash2 size={14} />
                                              </button>
                                           </div>
                                           <textarea
                                              value={note || ''}
                                              onChange={e => {
                                                 const next = [...formData.recovery_docs];
                                                 next[idx] = { id: did, note: e.target.value };
                                                 updateFormData({ ...formData, recovery_docs: next });
                                              }}
                                              placeholder="Operational guidance note shown to operator before BKM access..."
                                              className="w-full bg-white/5 border border-white/5 rounded-lg p-3 text-[10px] font-bold text-slate-200 outline-none focus:border-blue-500/40 transition-all min-h-[60px] resize-none leading-relaxed"
                                           />
                                        </div>
                                     )
                                  })}
                                  {formData.recovery_docs?.length === 0 && (
                                     <p className="text-[9px] font-bold text-slate-700 italic px-1 py-4 text-center border border-dashed border-white/5 rounded-lg">No procedures linked for configuration.</p>
                                  )}
                               </div>
                            </div>
                            <FieldError message={formErrors.recovery_docs} />
                          </div>
                        </div>}
                      </WorkspaceSectionCard>
                    </div>
                  </div>
                )}
              </div>
            }
          />
      </div>
    </WorkspaceModal>
  )
}
