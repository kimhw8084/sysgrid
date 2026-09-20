import React, { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Layers, X, Search, Edit2, Trash2, RefreshCcw, AlertCircle, Plus, LayoutGrid, Monitor, Database, Globe, Box, Settings, MoreVertical, FileJson, List, Sliders, Tag, Check, ExternalLink, Shield, Package, Workflow, Cpu, Activity, Zap, Clipboard, FileText, Eye, Upload } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { AgGridReact } from "ag-grid-react"
import toast from "react-hot-toast"
import { apiFetch } from "../api/apiClient"
import { WorkspaceModal } from "./shared/WorkspaceModal"
import { ToolbarButton } from "./shared/LayoutPrimitives"
import { BulkImportModal } from "./shared/BulkImportModal"
import { ConfigRegistryModal } from "./ConfigRegistry"
import { ConfirmationModal } from "./shared/ConfirmationModal"
import { WorkspaceValidationBanner } from "./shared/OperationalWorkspacePrimitives"
import { OPERATIONAL_GRID_AUTO_SIZE_STRATEGY } from './shared/OperationalGridSizing'
import { StyledSelect } from "./shared/StyledSelect"
import { AppDropdown } from "./shared/AppDropdown"
import { OperationalAssetSelector } from './shared/OperationalAssetSelector'
import { mergeOperationalFieldErrors } from './shared/OperationalFieldValidation'
import { useOperationalFormDirty } from './shared/OperationalFormContracts'

const SERVICE_LICENSE_OPTIONS = ["One-time", "Subscription", "OEM", "Free"]
const SERVICE_CURRENCY_OPTIONS = ["USD", "EUR", "KRW", "JPY", "GBP"]
export const SERVICE_STATUS_DEFINITIONS = [
  { value: "Existing", label: "Existing", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  { value: "Planned", label: "Planned", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  { value: "Cancelled", label: "Cancelled", color: "bg-rose-500/20 text-rose-400 border-rose-500/30" },
  { value: "Decommissioned", label: "Decommissioned", color: "bg-slate-500/20 text-slate-400 border-white/20" },
  { value: "Deleted", label: "Deleted", color: "bg-slate-800 text-slate-500 border-white/5" },
  { value: "Inactive", label: "Inactive", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  { value: "Deprecated", label: "Deprecated", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  { value: "Maintenance", label: "Maintenance", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
]
export const SERVICE_STATUS_OPTIONS = SERVICE_STATUS_DEFINITIONS
  .filter((status) => status.value !== "Deleted")
  .map((status) => status.value)
const SERVICE_ENVIRONMENT_FALLBACKS = ["Production", "Stage", "Development", "Lab"]

export const canonicalizeServiceStatus = (value: any) => {
  const normalized = String(value || "").trim()
  if (!normalized) return "Existing"
  if (normalized.toLowerCase() === "active") return "Existing"
  return normalized
}

const serviceFieldClass = (invalid?: boolean | string) =>
  `w-full rounded-lg border px-3 py-2 text-[10px] font-bold outline-none transition-all ${
    invalid
      ? "border-rose-500/60 bg-rose-500/10 text-white focus:border-rose-400"
      : "border-white/10 bg-slate-950/80 text-slate-100 focus:border-blue-500"
  }`

const MetadataEditor = ({ value, onChange, onError }: { value: any, onChange: (v: any) => void, onError?: (err: string | null) => void }) => {
  const parseMetadataValue = (input: any) => {
    if (typeof input !== 'string') return input || {}
    try {
      return JSON.parse(input || '{}')
    } catch {
      return {}
    }
  }
  const [mode, setMode] = useState<'table' | 'json'>('table')
  const [tableRows, setTableRows] = useState(() => {
    const obj = parseMetadataValue(value)
    return Object.entries(obj).map(([k, v]) => ({ key: k, value: String(v) }))
  })
  const [jsonValue, setJsonValue] = useState(() => JSON.stringify(parseMetadataValue(value), null, 2))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const obj = parseMetadataValue(value)
    setTableRows(Object.entries(obj).map(([k, v]) => ({ key: k, value: String(v) })))
    setJsonValue(JSON.stringify(obj, null, 2))
  }, [value])

  const validateAndNotify = (rows: {key: string, value: string}[]) => {
    const obj: any = {}
    const keys = new Set()
    let hasDuplicate = false
    rows.forEach(r => {
      if (r.key) {
        if (keys.has(r.key)) hasDuplicate = true
        keys.add(r.key)
        obj[r.key] = r.value
      }
    })
    if (hasDuplicate) {
        setError("Duplicate keys detected")
        onError?.("Duplicate keys detected")
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
    <div className="bg-black/20 rounded-lg border border-white/5 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/5">
         <div className="flex items-center space-x-3">
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 ">Configuration Metadata</span>
            {error && <span className="text-[8px] font-bold text-rose-500 uppercase animate-pulse ">!! {error}</span>}
         </div>
         <div className="flex bg-black/40 rounded-lg p-0.5">
            <button onClick={() => setMode('table')} className={`p-1.5 rounded-lg transition-all ${mode === 'table' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}><List size={10}/></button>
            <button onClick={() => setMode('json')} className={`p-1.5 rounded-lg transition-all ${mode === 'json' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}><FileJson size={10}/></button>
         </div>
      </div>
      <div className="p-3 min-h-[100px]">
        {mode === 'table' ? (
          <div className="space-y-1">
            {tableRows.map((row, i) => (
              <div key={i} className="flex items-center space-x-2">
                <input value={row.key} onChange={e => {
                  const n = [...tableRows]; n[i].key = e.target.value; 
                  setTableRows(n); validateAndNotify(n);
                }} placeholder="Key" className={`flex-1 bg-black/40 border ${error === 'Duplicate keys detected' ? 'border-rose-500/50' : 'border-white/5'} rounded-lg px-2 py-1 text-[10px] outline-none focus:border-blue-500 font-bold`} />
                <input value={row.value} onChange={e => {
                  const n = [...tableRows]; n[i].value = e.target.value; 
                  setTableRows(n); validateAndNotify(n);
                }} placeholder="Value" className="flex-[2] bg-black/40 border border-white/5 rounded-lg px-2 py-1 text-[10px] outline-none font-bold text-slate-300" />
                <button onClick={() => {
                    const n = tableRows.filter((_, idx) => idx !== i);
                    setTableRows(n); validateAndNotify(n);
                }} className="text-slate-600 hover:text-rose-400"><X size={12}/></button>
              </div>
            ))}
            <button onClick={() => {
                const n = [...tableRows, { key: '', value: '' }];
                setTableRows(n);
            }} className="text-[8px] font-bold text-blue-400 uppercase tracking-widest mt-1 hover:text-blue-300 transition-colors ">+ Append Attribute</button>
          </div>
        ) : (
          <textarea value={jsonValue} onChange={e => {
            setJsonValue(e.target.value);
            syncFromJSON(e.target.value);
          }} className={`w-full h-24 bg-black/40 border ${error === 'Invalid JSON format' ? 'border-rose-500/50' : 'border-white/5'} rounded-lg px-3 py-2 text-[10px] font-mono text-blue-300 outline-none`} />
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
    <div className="bg-black/20 rounded-lg border border-white/5 overflow-hidden">
      <div className="px-3 py-1.5 bg-white/5 border-b border-white/5">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 ">Configuration Metadata</span>
      </div>
      <table className="w-full text-[10px]">
        <thead className="bg-white/5 border-b border-white/5">
          <tr>
            <th className="px-4 py-1.5 text-left font-bold uppercase tracking-widest text-slate-500 ">Key</th>
            <th className="px-4 py-1.5 text-left font-bold uppercase tracking-widest text-slate-500 ">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {Object.entries(obj).map(([k, v]) => (
            <tr key={k} className="hover:bg-white/5 transition-colors">
              <td className="px-4 py-2 font-bold uppercase text-blue-400  w-1/3">{k}</td>
              <td className="px-4 py-2 font-bold text-slate-300 truncate max-w-[200px]">{String(v)}</td>
            </tr>
          ))}
          {Object.keys(obj).length === 0 && (
            <tr><td colSpan={2} className="px-4 py-8 text-center text-slate-600 font-bold uppercase  tracking-widest">No metadata keys documented</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

const ServiceSecretsTab = ({ serviceId }: { serviceId: number }) => {
  const queryClient = useQueryClient()
  const { data: services } = useQuery({ queryKey: ['logical-services'] })
  const service = (services as any[])?.find((s: any) => s.id === serviceId)
  const [newSecret, setNewSecret] = useState({ username: '', password: '', note: '' })

  const addMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiFetch(`/api/v1/logical-services/${serviceId}/secrets`, { method: 'POST', body: JSON.stringify(data) })
      return res.json()
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['logical-services'] }); setNewSecret({ username: '', password: '', note: '' }); toast.success('Credential Added') },
    onError: (e: any) => toast.error(e.message || 'Failed to add credential')
  })

  const deleteMutation = useMutation({
    mutationFn: async (secretId: number) => {
      const res = await apiFetch(`/api/v1/logical-services/${serviceId}/secrets/${secretId}`, { method: 'DELETE' })
      return res.json()
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['logical-services'] }); toast.success('Credential Revoked') },
    onError: (e: any) => toast.error(e.message || 'Failed to revoke credential')
  })

  return (
    <div className="space-y-4">
      <div className="bg-black/40 border border-white/5 rounded-lg p-4 space-y-3">
        <h3 className="text-[9px] font-bold uppercase text-blue-400 tracking-widest ">Identity Registry</h3>
        <div className="grid grid-cols-3 gap-2">
          <input value={newSecret.username} onChange={e => setNewSecret({...newSecret, username: e.target.value})} placeholder="Username / ID" className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-bold outline-none focus:border-blue-500 " />
          <input type="password" value={newSecret.password} onChange={e => setNewSecret({...newSecret, password: e.target.value})} placeholder="Access Password" className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-bold outline-none focus:border-blue-500" />
          <input value={newSecret.note} onChange={e => setNewSecret({...newSecret, note: e.target.value})} placeholder="Purpose / Note" className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-bold outline-none focus:border-blue-500 " />
        </div>
        <button 
          disabled={!newSecret.username || !newSecret.password}
          onClick={() => addMutation.mutate(newSecret)}
          className="w-full py-2 bg-blue-600/10 text-blue-400 border border-blue-500/30 rounded-lg text-[9px] font-bold uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all disabled:opacity-30"
        >
          Inject Secret into Vault
        </button>
      </div>

      <div className="space-y-1">
        {service?.secrets?.map((s: any) => (
          <div key={s.id} className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-lg group transition-all hover:border-white/20">
            <div className="flex items-center space-x-4">
              <div className="bg-blue-600/10 p-1.5 rounded-lg text-blue-400"><Tag size={14}/></div>
              <div className="min-w-[100px]">
                <p className="text-[10px] font-bold text-white">{s.username}</p>
                <p className="text-[9px] font-mono text-slate-600">••••••••</p>
              </div>
              <div className="border-l border-white/10 pl-4 max-w-[300px] truncate">
                <p className="text-[8px] font-bold text-slate-600 uppercase mb-0.5 ">Note</p>
                <p className="text-[10px] text-slate-400 font-bold truncate tracking-tighter">{s.note || '---'}</p>
              </div>
            </div>
            <button onClick={() => deleteMutation.mutate(s.id)} className="p-1.5 text-slate-600 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={14}/></button>
          </div>
        ))}
        {!service?.secrets?.length && <div className="py-10 text-center text-slate-700  text-[9px] font-bold uppercase tracking-widest">No vault entries documented</div>}
      </div>
    </div>
  )
}

export const ServiceDetailsView = ({ service, options, devices }: { service: any, options: any, devices: any }) => {
    const [tab, setTab] = useState<'metadata' | 'secrets'>('metadata')
    const fundamentals = [
      { label: 'Name', value: service.name || 'N/A' },
      { label: 'Host', value: service.device_name || 'Unassigned' },
      { label: 'Type', value: service.service_type || 'N/A' },
      { label: 'Environment', value: service.environment || 'N/A' },
      { label: 'Version', value: service.version || 'N/A' },
      { label: 'Status', value: canonicalizeServiceStatus(service.status) || 'N/A' },
      { label: 'Deployment Date', value: service.installation_date ? String(service.installation_date).split('T')[0] : 'N/A' },
      { label: 'Manufacturer', value: service.manufacturer || 'N/A' },
      { label: 'Supplier', value: service.supplier || 'N/A' },
      { label: 'License Type', value: service.purchase_type || 'N/A' },
      { label: 'Expiry Date', value: service.expiry_date ? String(service.expiry_date).split('T')[0] : 'N/A' },
      { label: 'Cost', value: service.cost != null ? `${service.currency || 'USD'} ${service.cost}` : 'N/A' },
    ]

    return (
      <div className="space-y-6">
        <section className="rounded-xl border border-white/8 bg-gradient-to-br from-slate-950/95 via-slate-900/95 to-blue-950/60 p-5 shadow-inner">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="space-y-4">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.22em] text-blue-400">Fundamental Data</p>
                <h3 className="mt-2 text-lg font-black tracking-tight text-white">{service.name || 'Unnamed Service'}</h3>
                <p className="mt-2 text-[11px] font-bold leading-relaxed text-slate-300">
                  {service.purpose || 'No service purpose documented.'}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {fundamentals.map((entry) => (
                  <div key={entry.label} className="rounded-lg border border-white/8 bg-black/20 px-3 py-3">
                    <p className="text-[8px] font-black uppercase tracking-[0.18em] text-slate-500">{entry.label}</p>
                    <p className="mt-1 truncate text-[11px] font-bold text-slate-100">{entry.value}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-white/8 bg-black/20 p-4">
              <p className="text-[9px] font-black uppercase tracking-[0.22em] text-emerald-400">Service Snapshot</p>
              <div className="mt-3 space-y-3">
                <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-3">
                  <p className="text-[8px] font-black uppercase tracking-[0.18em] text-slate-500">Metadata Keys</p>
                  <p className="mt-1 text-[12px] font-black text-white">{Object.keys(service.config_json || {}).length}</p>
                </div>
                <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-3">
                  <p className="text-[8px] font-black uppercase tracking-[0.18em] text-slate-500">Secrets</p>
                  <p className="mt-1 text-[12px] font-black text-white">{service.secret_count ?? service.secrets?.length ?? 0}</p>
                </div>
                <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-3">
                  <p className="text-[8px] font-black uppercase tracking-[0.18em] text-slate-500">License</p>
                  <p className="mt-1 text-[11px] font-bold text-slate-100">{service.purchase_type || 'N/A'}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="flex items-center justify-between">
          <div className="flex space-x-0.5 rounded-lg border border-white/5 bg-black/40 p-0.5">
            {[
              { id: 'metadata', label: 'Metadata', icon: List },
              { id: 'secrets', label: 'Secrets', icon: Tag },
            ].map((entry) => (
              <button
                key={entry.id}
                onClick={() => setTab(entry.id as 'metadata' | 'secrets')}
                className={`flex items-center space-x-2 rounded-lg px-4 py-1.5 text-[9px] font-bold uppercase tracking-widest transition-all ${
                  tab === entry.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <entry.icon size={12} />
                <span>{entry.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="glass-panel rounded-lg border-white/5 overflow-hidden p-6 bg-black/20">
          {tab === 'metadata' && <MetadataViewer data={service.config_json} />}
          {tab === 'secrets' && <ServiceSecretsTab serviceId={service.id} />}
        </div>
      </div>
    )
}

export const ServiceForm = ({
  initialData,
  onSave,
  isPending,
  options,
  devices,
  formId,
  onDirtyChange,
  backendFieldErrors = {},
  backendGeneralError = '',
  clearBackendFieldError,
  renderActions = true,
}: any) => {
  const buildInitialFormData = useCallback((initialData: any = {}) => {
    const nextData = {
      name: "",
      service_type: "Database",
      status: "Existing",
      environment: "Production",
      version: "",
      device_id: null,
      config_json: {},
      custom_attributes: {},
      logic_json: [],
      license_key: "",
      purchase_type: "One-time",
      purchase_date: "",
      expiry_date: "",
      installation_date: "",
      purpose: "",
      documentation_link: "",
      cost: 0,
      currency: "USD",
      manufacturer: "",
      supplier: "",
      ...initialData,
    }
    nextData.status = canonicalizeServiceStatus(nextData.status)
    return nextData
  }, [])
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [generalError, setGeneralError] = useState('')
  const initialDataNormalized = useMemo(() => buildInitialFormData(initialData), [buildInitialFormData, initialData])
  const {
    value: formData,
    isDirty,
    patchValue,
    normalize,
  } = useOperationalFormDirty(initialDataNormalized, buildInitialFormData, onDirtyChange)
  const fieldErrors = useMemo(
    () => mergeOperationalFieldErrors(backendFieldErrors || {}, validationErrors),
    [backendFieldErrors, validationErrors]
  )
  const bannerMessage = backendGeneralError || generalError || metadataError || ''

  const getOptions = (category: string) => Array.isArray(options) ? options.filter((entry: any) => entry.category === category) : []
  const ensureCurrentOption = (entries: Array<{ value: string; label: string }>, currentValue: string) => {
    if (!currentValue) return entries
    return entries.some((entry) => entry.value === currentValue) ? entries : [{ value: currentValue, label: currentValue }, ...entries]
  }
  const statusOptions = ensureCurrentOption(
    SERVICE_STATUS_OPTIONS.map((value) => ({ value, label: value })),
    formData.status
  )
  const resolvedStatusOptions = statusOptions
  const environmentOptions = ensureCurrentOption(
    (getOptions('Environment').map((entry: any) => ({ value: entry.value, label: entry.label })) || []),
    formData.environment
  )
  const resolvedEnvironmentOptions = environmentOptions.length > 0 ? environmentOptions : SERVICE_ENVIRONMENT_FALLBACKS.map((value) => ({ value, label: value }))
  const serviceTypeOptions = ensureCurrentOption(
    (getOptions('ServiceType').map((entry: any) => ({ value: entry.value, label: entry.label })) || []),
    formData.service_type
  )
  const resolvedServiceTypeOptions = serviceTypeOptions.length > 0 ? serviceTypeOptions : ['Database', 'Application', 'OS', 'Middleware', 'API'].map((value) => ({ value, label: value }))
  const resolvedCurrencyOptions = SERVICE_CURRENCY_OPTIONS.map((value) => ({ value, label: value }))
  const resolvedLicenseOptions = SERVICE_LICENSE_OPTIONS.map((value) => ({ value, label: value }))
  useEffect(() => {
    if (initialData.id) return
    const selectedType = getOptions('ServiceType').find((entry: any) => entry.value === formData.service_type)
    const metadataKeys = Array.isArray(selectedType?.metadata_keys) ? selectedType.metadata_keys : []
    const nextConfig: Record<string, string> = {}
    metadataKeys.forEach((key: string) => {
      nextConfig[key] = typeof formData.config_json?.[key] === 'string' ? formData.config_json[key] : ''
    })
    normalize({ ...formData, config_json: nextConfig })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.service_type, initialData.id, options])

  const updateField = (field: string, value: any) => {
    patchValue({ [field]: value })
    setValidationErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
    setGeneralError('')
    clearBackendFieldError?.(field)
  }

  const validate = () => {
    const nextErrors: Record<string, string> = {}
    const trimmedName = String(formData.name || '').trim()
    const deviceId = Number(formData.device_id)
    const costValue = formData.cost === '' || formData.cost == null ? 0 : Number(formData.cost)
    const licenseType = String(formData.purchase_type || '')
    const expiryRequired = licenseType === 'Subscription' || licenseType === 'OEM'

    if (!trimmedName) nextErrors.name = 'Name is required.'
    if (!Number.isFinite(deviceId) || deviceId <= 0) nextErrors.device_id = 'Host is required.'
    if (!String(formData.service_type || '').trim()) nextErrors.service_type = 'Type is required.'
    if (!String(formData.status || '').trim()) nextErrors.status = 'Status is required.'
    if (!String(formData.environment || '').trim()) nextErrors.environment = 'Environment is required.'
    if (!metadataError && (formData.config_json == null || typeof formData.config_json !== 'object' || Array.isArray(formData.config_json))) nextErrors.config_json = 'Metadata must remain a key/value object.'
    if (!Number.isFinite(costValue) || costValue < 0) nextErrors.cost = 'Cost must be zero or greater.'
    if (expiryRequired && !String(formData.expiry_date || '').trim()) nextErrors.expiry_date = 'Expiry date is required for this license type.'

    setValidationErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSave = () => {
    if (metadataError) {
      setGeneralError('Fix metadata errors before saving')
      toast.error('Fix metadata errors before saving')
      return
    }
    if (!validate()) {
      setGeneralError('Fix the highlighted service fields before saving')
      toast.error('Fix the highlighted service fields before saving')
      return
    }
    setGeneralError('')
    onSave({
      ...formData,
      name: String(formData.name || '').trim(),
      service_type: String(formData.service_type || '').trim(),
      status: canonicalizeServiceStatus(formData.status),
      environment: String(formData.environment || '').trim(),
      version: formData.version ? String(formData.version).trim() : '',
      purpose: formData.purpose ? String(formData.purpose).trim() : '',
      manufacturer: formData.manufacturer ? String(formData.manufacturer).trim() : '',
      supplier: formData.supplier ? String(formData.supplier).trim() : '',
      purchase_type: formData.purchase_type ? String(formData.purchase_type).trim() : 'One-time',
      currency: formData.currency ? String(formData.currency).trim() : 'USD',
      cost: formData.cost === '' || formData.cost == null ? 0 : Number(formData.cost),
      config_json: formData.config_json && typeof formData.config_json === 'object' ? formData.config_json : {},
      custom_attributes: formData.custom_attributes && typeof formData.custom_attributes === 'object' ? formData.custom_attributes : {},
      logic_json: Array.isArray(formData.logic_json) ? formData.logic_json : [],
    })
  }
  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault()
        handleSave()
      }}
      className="space-y-6 py-2"
    >
      <WorkspaceValidationBanner message={bannerMessage} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <section className="space-y-4 rounded-xl border border-blue-500/20 bg-blue-500/[0.05] p-5 shadow-inner">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-blue-400">Core Service Identity</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1.5">
              <label className="block px-1 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Name <span className="text-rose-400">*</span></label>
              <input value={formData.name || ''} onChange={(e) => updateField('name', e.target.value)} className={serviceFieldClass(fieldErrors.name)} placeholder="e.g. ERP DB Prod 01" />
              {fieldErrors.name && <p className="px-1 text-[9px] font-bold text-rose-400">{fieldErrors.name}</p>}
            </div>
            <div className="space-y-1.5">
              <OperationalAssetSelector
                label="Host"
                required
                value={formData.device_id ? Number(formData.device_id) : null}
                onChange={(deviceId) => updateField('device_id', deviceId)}
                assets={devices || []}
                placeholder="Select host node"
                error={fieldErrors.device_id}
                selectedAssetLabel={(device) => `${device.name} [${device.type || device.system || 'Asset'}]`}
              />
            </div>
            <div className="space-y-1.5">
              <AppDropdown
                label="Type"
                required
                value={formData.service_type || ''}
                onChange={(value) => updateField('service_type', String(value))}
                options={resolvedServiceTypeOptions}
                placeholder="Select service type"
                error={fieldErrors.service_type}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block px-1 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Deployment Date</label>
              <input type="date" value={formData.installation_date ? String(formData.installation_date).split('T')[0] : ''} onChange={(e) => updateField('installation_date', e.target.value)} className={serviceFieldClass(fieldErrors.installation_date)} />
              {fieldErrors.installation_date && <p className="px-1 text-[9px] font-bold text-rose-400">{fieldErrors.installation_date}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="block px-1 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Version</label>
              <input value={formData.version || ''} onChange={(e) => updateField('version', e.target.value)} className={serviceFieldClass(fieldErrors.version)} placeholder="v1.0.0" />
              {fieldErrors.version && <p className="px-1 text-[9px] font-bold text-rose-400">{fieldErrors.version}</p>}
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <label className="block px-1 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Purpose</label>
              <textarea value={formData.purpose || ''} onChange={(e) => updateField('purpose', e.target.value)} className={`${serviceFieldClass(fieldErrors.purpose)} min-h-[110px] resize-none`} placeholder="Primary transactional store..." />
              {fieldErrors.purpose && <p className="px-1 text-[9px] font-bold text-rose-400">{fieldErrors.purpose}</p>}
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-5 shadow-inner">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-emerald-400">Runtime & Licensing</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <AppDropdown
                label="Status"
                required
                value={formData.status || ''}
                onChange={(value) => updateField('status', String(value))}
                options={resolvedStatusOptions}
                placeholder="Select status"
                error={fieldErrors.status}
              />
            </div>
            <div className="space-y-1.5">
              <AppDropdown
                label="Environment"
                required
                value={formData.environment || ''}
                onChange={(value) => updateField('environment', String(value))}
                options={resolvedEnvironmentOptions}
                placeholder="Select environment"
                error={fieldErrors.environment}
              />
            </div>
            <div className="space-y-1.5">
              <AppDropdown
                label="License Type"
                value={formData.purchase_type || 'One-time'}
                onChange={(value) => updateField('purchase_type', String(value))}
                options={resolvedLicenseOptions}
                placeholder="Select license type"
                error={fieldErrors.purchase_type}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block px-1 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Expiry Date</label>
              <input type="date" value={formData.expiry_date ? String(formData.expiry_date).split('T')[0] : ''} onChange={(e) => updateField('expiry_date', e.target.value)} className={serviceFieldClass(fieldErrors.expiry_date)} />
              {fieldErrors.expiry_date && <p className="px-1 text-[9px] font-bold text-rose-400">{fieldErrors.expiry_date}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="block px-1 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Manufacturer</label>
              <input value={formData.manufacturer || ''} onChange={(e) => updateField('manufacturer', e.target.value)} className={serviceFieldClass(fieldErrors.manufacturer)} placeholder="Vendor / publisher" />
              {fieldErrors.manufacturer && <p className="px-1 text-[9px] font-bold text-rose-400">{fieldErrors.manufacturer}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="block px-1 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Supplier</label>
              <input value={formData.supplier || ''} onChange={(e) => updateField('supplier', e.target.value)} className={serviceFieldClass(fieldErrors.supplier)} placeholder="Reseller / supplier" />
              {fieldErrors.supplier && <p className="px-1 text-[9px] font-bold text-rose-400">{fieldErrors.supplier}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="block px-1 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Cost</label>
              <input type="number" min="0" step="0.01" value={formData.cost ?? 0} onChange={(e) => updateField('cost', e.target.value)} className={serviceFieldClass(fieldErrors.cost)} placeholder="0.00" />
              {fieldErrors.cost && <p className="px-1 text-[9px] font-bold text-rose-400">{fieldErrors.cost}</p>}
            </div>
            <div className="space-y-1.5">
              <AppDropdown
                label="Currency"
                value={formData.currency || 'USD'}
                onChange={(value) => updateField('currency', String(value))}
                options={resolvedCurrencyOptions}
                placeholder="Select currency"
                error={fieldErrors.currency}
              />
            </div>
          </div>
        </section>
      </div>

      <section className="space-y-4 rounded-xl border border-white/8 bg-white/[0.03] p-5 shadow-inner">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">Metadata</p>
          <p className="mt-1 text-[10px] font-bold text-slate-500">Configuration metadata keys follow the selected service type when definitions exist.</p>
        </div>
        <MetadataEditor value={formData.config_json} onChange={(value) => updateField('config_json', value)} onError={setMetadataError} />
        {fieldErrors.config_json && <p className="px-1 text-[9px] font-bold text-rose-400">{fieldErrors.config_json}</p>}
      </section>

      {renderActions ? (
        <button
          type="submit"
          disabled={!!metadataError || isPending}
          data-testid="service-commit-btn"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-4 text-[11px] font-bold uppercase tracking-[0.3em] text-white shadow-xl shadow-blue-500/20 transition-all active:scale-95 disabled:opacity-30"
        >
          {isPending ? <Activity size={14} className="animate-spin" /> : 'Save Service'}
        </button>
      ) : null}
    </form>
  )
}

export default function ServiceRegistry() {
  const [searchParams, setSearchParams] = useSearchParams()
  const idParam = searchParams.get('id')
  const [showImportModal, setShowImportModal] = useState(false)
  const queryClient = useQueryClient()
  const gridRef = React.useRef<any>(null)
  const [, setGridApi] = useState<any>(null)
  const [, setGridColumnApi] = useState<any>(null)
  const [fontSize, setFontSize] = useState(11)
  const [rowDensity, setRowDensity] = useState(10)
  const [showStyleLab, setShowStyleLab] = useState(true)
  const [showColumnPicker, setShowColumnPicker] = useState(false)
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([])

  const [activeModal, setActiveModal] = useState<any>(null)
  const [activeDetails, setActiveDetails] = useState<any>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [showBulkMenu, setShowBulkMenu] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [activeTab, setActiveTab] = useState<'active' | 'purged'>('active')
  const [isBulkStatusOpen, setIsBulkStatusOpen] = useState(false)
  const [isBulkEnvOpen, setIsBulkEnvOpen] = useState(false)
  const [isBulkHostOpen, setIsBulkHostOpen] = useState(false)
  const [confirmModal, setConfirmModal] = useState<any>({ isOpen: false, title: '', message: '', onConfirm: () => {}, variant: 'info' })

  const openConfirm = (title: string, message: string, onConfirm: () => void, variant: any = 'danger') => {
    setConfirmModal({ isOpen: true, title, message, onConfirm, variant })
  }

  const { data: options } = useQuery({ queryKey: ['settings-options'], queryFn: async () => (await (await apiFetch('/api/v1/settings/options')).json()) })
  const { data: allServices, isLoading } = useQuery({ queryKey: ["logical-services"], queryFn: async () => (await (await apiFetch("/api/v1/logical-services/?include_deleted=true")).json()) })
  const services = useMemo(() => {
    if (!allServices) return []
    return activeTab === 'active' ? allServices.filter((s: any) => !s.is_deleted) : allServices.filter((s: any) => s.is_deleted)
  }, [allServices, activeTab])

  useEffect(() => {
    if (!idParam || !allServices) return
    const target = allServices.find((service: any) => String(service.id) === idParam)
    if (!target) {
      setActiveDetails(null)
      return
    }
    setActiveTab(target.is_deleted ? 'purged' : 'active')
    setActiveDetails(target)
  }, [idParam, allServices])

  const clearServiceRoute = () => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('id')
    setSearchParams(nextParams, { replace: true })
  }

  useEffect(() => { if (gridRef.current?.api) setTimeout(() => gridRef.current.api.autoSizeAllColumns(), 100); }, [fontSize, rowDensity, services]);
  const { data: devices } = useQuery({ queryKey: ["devices"], queryFn: async () => (await (await apiFetch("/api/v1/devices/")).json()) })

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const url = data.id ? `/api/v1/logical-services/${data.id}` : "/api/v1/logical-services/"
      const res = await apiFetch(url, { method: data.id ? "PUT" : "POST", body: JSON.stringify(data) })
      return res.json()
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["logical-services"] }); toast.success("Registry Updated"); setActiveModal(null); },
    onError: (e: any) => toast.error(e.message || 'Failed to update registry')
  })

  const bulkMutation = useMutation({
    mutationFn: async ({ action, payload = {}, ids = selectedIds }: any) => {
      const res = await apiFetch('/api/v1/logical-services/bulk-action', { method: 'POST', body: JSON.stringify({ ids, action, payload }) })
      return res.json()
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["logical-services"] }); setSelectedIds([]); setShowBulkMenu(false); setIsBulkStatusOpen(false); setIsBulkEnvOpen(false); setIsBulkHostOpen(false); toast.success('Operation Complete') },
    onError: (e: any) => toast.error(e.message || 'Bulk operation failed')
  })

  const columnDefs = useMemo(() => [
    { 
      headerName: "", 
      width: 50,
      minWidth: 50,
      maxWidth: 50,
      checkboxSelection: true, 
      headerCheckboxSelection: true, 
      pinned: 'left', 
      cellClass: 'flex items-center justify-center border-r border-white/5 pl-2', 
      headerClass: 'flex items-center justify-center border-r border-white/5 pl-2', 
      suppressSizeToFit: true,
      resizable: false,
      sortable: false,
      filter: false,
      lockVisible: true
    },
    { field: "id", headerName: "ID", width: 80, cellClass: 'text-center font-bold text-slate-500', headerClass: 'text-center', filter: 'agNumberColumnFilter' },
    { field: "name", headerName: "Instance Identifier", pinned: 'left', flex: 1.2, filter: true, cellClass: 'text-left font-bold uppercase text-blue-400', headerClass: 'text-left', hide: hiddenColumns.includes("name") },
    { 
    field: "service_type", 
    headerName: "Matrix Type", 
    width: 120, filter: true, cellClass: 'text-center', headerClass: 'text-center',
    cellRenderer: (p: any) => p.data ? <span className={`font-bold uppercase ${p.value === 'Database' ? 'text-amber-400' : p.value === 'OS' ? 'text-rose-400' : 'text-blue-400'}`}>{p.value || 'N/A'}</span> : null,
    hide: hiddenColumns.includes("service_type")
    },
    { 
    field: "status", 
    headerName: "Runtime State", 
    width: 130, filter: true, cellClass: 'text-center', headerClass: 'text-center',
    cellRenderer: (p: any) => p.data ? <div className="flex items-center justify-center h-full"><div className={`flex items-center justify-center w-24 h-6 rounded-lg border shadow-sm font-bold uppercase tracking-tighter ${p.value === 'Active' ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/20' : 'text-slate-400 border-white/20 bg-white/10'}`}>{p.value || 'Unknown'}</div></div> : null,
    hide: hiddenColumns.includes("status")
    },
    { field: "device_name", headerName: "Host Node", width: 140, filter: true, cellClass: "font-bold text-center uppercase text-indigo-400", headerClass: 'text-center', hide: hiddenColumns.includes("device_name") },
    { field: "environment", headerName: "Env", width: 90, filter: true, cellClass: 'text-center font-bold uppercase text-slate-500', headerClass: 'text-center', hide: hiddenColumns.includes("environment") },
    { field: "version", headerName: "Version", width: 80, filter: true, cellClass: "font-bold text-center text-slate-400", headerClass: 'text-center', hide: hiddenColumns.includes("version") },
    { field: "cost", headerName: "Procurement", width: 110, filter: true, cellClass: 'text-center font-bold text-white', headerClass: 'text-center', cellRenderer: (p: any) => p.data && p.value ? `${p.data.currency === 'KRW' ? '₩' : '$'}${p.value.toLocaleString()}` : <span className="text-slate-700">---</span>, hide: hiddenColumns.includes("cost") },
    {
    headerName: "Ops", width: 140, pinned: 'right', cellClass: 'text-center', headerClass: 'text-center',
    cellRenderer: (p: any) => p.data ? (
      <div className="flex items-center justify-center space-x-1 h-full">
         <div className="flex rounded-lg p-0.5 border border-white/5 bg-transparent">
             <button onClick={() => {
               const nextParams = new URLSearchParams(searchParams)
               nextParams.set('id', String(p.data.id))
               setSearchParams(nextParams, { replace: true })
               setActiveDetails(p.data)
             }} title="View Detail Matrix" className="p-1.5 text-blue-400 hover:text-blue-200 transition-all border-r border-white/5"><Eye size={14}/></button>
             <button onClick={() => setActiveModal(p.data)} title="Modify Config" className="p-1.5 text-emerald-400 hover:text-emerald-200 transition-all border-r border-white/5"><Edit2 size={14}/></button>
             <button onClick={() => openConfirm(
               activeTab === 'active' ? 'Purge Registry' : 'Purge Marker',
               activeTab === 'active' ? 'Terminate this service instance?' : 'This service is already purged. No additional purge action is available.',
               () => activeTab === 'active' ? bulkMutation.mutate({ action: 'delete', ids: [p.data.id] }) : setConfirmModal((prev: any) => ({ ...prev, isOpen: false })),
               activeTab === 'active' ? 'danger' : 'info'
             )} title="Terminate" className="p-1.5 text-rose-400 hover:text-rose-200 transition-all"><Trash2 size={14}/></button>
         </div>
      </div>
    ) : null
    }
  ], [selectedIds, activeTab, fontSize, hiddenColumns]) as any

  const autoSizeStrategy = OPERATIONAL_GRID_AUTO_SIZE_STRATEGY

  return (
    <div className="h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-6">
           <div><h1 className="text-2xl font-bold uppercase tracking-tight ">Services</h1><p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold ml-1 ">Logical Service Registry & Logic Matrix</p></div>
           <div className="flex bg-white/5 p-1 rounded-lg border border-white/5 ml-2">
              <button onClick={() => { setActiveTab('active'); setSelectedIds([]) }} className={`px-6 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'active' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-500 hover:text-slate-300'}`}>Existing</button>
              <button onClick={() => { setActiveTab('purged'); setSelectedIds([]) }} className={`px-6 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'purged' ? 'bg-rose-600 text-white shadow-lg shadow-rose-500/20' : 'text-slate-500 hover:text-slate-300'}`}>Purged</button>
           </div>
        </div>
        
        <div className="flex items-center space-x-3">
          <div className="relative group"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" /><input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Scan logic..." className="bg-white/5 border border-white/5 rounded-lg pl-10 pr-4 py-2 text-[10px] font-bold outline-none focus:border-blue-500/50 w-64 transition-all" /></div>
          <div className="flex bg-white/5 rounded-lg p-0.5 border border-white/5 space-x-1">
             <button onClick={() => setShowStyleLab(!showStyleLab)} className={`p-1.5 rounded-lg transition-all ${showStyleLab ? 'bg-blue-500/20 text-blue-400' : 'hover:bg-white/10 text-slate-500'}`} title="Style Lab"><Activity size={16} /></button>
             <button onClick={() => setShowColumnPicker(!showColumnPicker)} className={`p-1.5 rounded-lg transition-all ${showColumnPicker ? 'bg-blue-500/20 text-blue-400' : 'hover:bg-white/10 text-slate-500'}`} title="Column Configuration"><Sliders size={16} /></button>
             <button onClick={() => setShowImportModal(true)} className="p-1.5 hover:bg-white/10 text-slate-500 hover:text-blue-400 rounded-lg transition-all" title="Import Bulk Data">
                <Upload size={16} />
             </button>
             <button onClick={() => setShowConfig(true)} className="p-1.5 hover:bg-white/10 text-slate-500 hover:text-blue-400 rounded-lg transition-all" title="Registry Enums"><Settings size={16} /></button>
          </div>
          <div className="relative bulk-menu-container">
            <button onClick={() => setShowBulkMenu(!showBulkMenu)} disabled={selectedIds.length === 0} className={`p-1.5 rounded-lg border transition-all ${selectedIds.length > 0 ? 'bg-blue-600/10 border-blue-500/30 text-blue-400' : 'bg-white/5 border-white/5 text-slate-700 cursor-not-allowed'}`}><MoreVertical size={18}/></button>
            <AnimatePresence>{showBulkMenu && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="absolute right-0 mt-2 w-56 bg-slate-900 border border-white/10 rounded-lg shadow-2xl z-50 p-2 space-y-1"><p className="px-3 py-2 text-[8px] font-bold text-slate-500 uppercase tracking-widest border-b border-white/5 mb-1 ">{selectedIds.length} Services Selected</p>
                   {activeTab === 'active' ? (<><button onClick={() => { setIsBulkStatusOpen(true); setShowBulkMenu(false); }} className="w-full text-left px-4 py-2 text-[10px] font-bold uppercase hover:bg-white/5 rounded-lg text-blue-400 ">Set Status...</button><button onClick={() => { setIsBulkEnvOpen(true); setShowBulkMenu(false); }} className="w-full text-left px-4 py-2 text-[10px] font-bold uppercase hover:bg-white/5 rounded-lg text-emerald-400 ">Set Env...</button><button onClick={() => { setIsBulkHostOpen(true); setShowBulkMenu(false); }} className="w-full text-left px-4 py-2 text-[10px] font-bold uppercase hover:bg-white/5 rounded-lg text-amber-400 ">Set Host...</button><div className="h-px bg-white/5 mx-2 my-1" /><button onClick={() => openConfirm('Bulk Terminate', `Terminate ${selectedIds.length} instances?`, () => bulkMutation.mutate({ action: 'delete' }))} className="w-full text-left px-4 py-2 text-[10px] font-bold uppercase hover:bg-rose-500/20 rounded-lg text-rose-500 ">Bulk Purge</button></>) : (<button onClick={() => bulkMutation.mutate({ action: 'restore' })} className="w-full text-left px-4 py-2 text-[10px] font-bold uppercase hover:bg-white/5 rounded-lg text-emerald-400 ">Restore Selected</button>)}
                </motion.div>
            )}</AnimatePresence>
          </div>
          <button onClick={() => setActiveModal({})} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-blue-500/20 active:scale-95 transition-all ">+ Register Service</button>
        </div>
      </div>

      <AnimatePresence>{showStyleLab && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="bg-blue-600/10 border border-blue-500/20 rounded-lg p-4 flex items-center justify-between backdrop-blur-md">
               <div className="flex items-center space-x-12">
                  <div className="flex items-center space-x-3"><Activity size={16} className="text-blue-400" /><span className="text-[10px] font-bold uppercase tracking-widest text-blue-400 ">View Density Laboratory</span></div>
                  <div className="flex items-center space-x-6">
                     <div className="flex items-center space-x-4"><span className="text-[9px] font-bold text-slate-500 uppercase ">Font Size</span><div className="flex items-center space-x-2"><input type="range" min="8" max="14" step="1" value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="w-32 accent-blue-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"/><span className="text-[10px] text-white w-4 font-bold">{fontSize}px</span></div></div>
                     <div className="flex items-center space-x-4 border-l border-white/10 pl-6"><span className="text-[9px] font-bold text-slate-500 uppercase ">Row Density</span><div className="flex items-center space-x-2"><input type="range" min="4" max="24" step="2" value={rowDensity} onChange={e => setRowDensity(Number(e.target.value))} className="w-32 accent-indigo-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"/><span className="text-[10px] text-white w-4 font-bold">{rowDensity}px</span></div></div>
                  </div>
               </div>
               <button onClick={() => setShowStyleLab(false)} className="text-slate-500 hover:text-white transition-colors"><X size={16}/></button>
            </div>
          </motion.div>
      )}</AnimatePresence>

      <div className="flex-1 glass-panel rounded-lg overflow-hidden ag-theme-alpine-dark relative">
        {isLoading && <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#020617]/80 backdrop-blur-sm space-y-4 text-blue-400"><RefreshCcw size={32} className="animate-spin" /><p className="text-[10px] font-bold uppercase tracking-[0.3em] ">Scanning Logic Matrix...</p></div>}
        <AgGridReact 
            ref={gridRef} 
            rowData={services || []} 
            columnDefs={columnDefs} 
            rowSelection="multiple" 
            headerHeight={fontSize + rowDensity + 10} 
            rowHeight={fontSize + rowDensity + 10} 
            onGridReady={(params) => {
              setGridApi(params.api)
              setGridColumnApi(params.columnApi)
            }}
            onSelectionChanged={e => setSelectedIds(e?.api?.getSelectedNodes().map((n: any) => n.data?.id).filter(Boolean) || [])} 
            quickFilterText={searchTerm} 
            animateRows={true} 
            enableCellTextSelection={true} 
            autoSizeStrategy={autoSizeStrategy} 
        />
      </div>

      <WorkspaceModal
        isOpen={!!activeModal}
        onClose={() => setActiveModal(null)}
        size="workspace"
        isMaximized={isMaximized}
        onMaximizeToggle={() => setIsMaximized(!isMaximized)}
        title={activeModal?.id ? 'Modify Logic Matrix' : 'Register Service Instance'}
        subtitle="Logical Service Identity, Environment & Ownership"
        icon={<Layers size={20}/>}
        footerRight={
          <ToolbarButton onClick={() => setActiveModal(null)}>Close</ToolbarButton>
        }
      >
        <div className="pt-6">
          <ServiceForm initialData={activeModal} onSave={mutation.mutate} isPending={mutation.isPending} options={options} devices={devices} />
        </div>
      </WorkspaceModal>

      <WorkspaceModal
        isOpen={!!activeDetails}
        onClose={() => { setActiveDetails(null); clearServiceRoute(); }}
        size="workspace"
        isMaximized={isMaximized}
        onMaximizeToggle={() => setIsMaximized(!isMaximized)}
        title={activeDetails?.name || 'Service Details'}
        subtitle={`${activeDetails?.service_type} · ${activeDetails?.environment} · ${activeDetails?.device_name || 'FLOATING'}`}
        icon={<Eye size={20}/>}
        footerRight={
          <ToolbarButton onClick={() => { setActiveDetails(null); clearServiceRoute(); }}>Close</ToolbarButton>
        }
      >
        <div className="pt-6">
          <ServiceDetailsView service={activeDetails} options={options} devices={devices} />
        </div>
      </WorkspaceModal>

      <ConfigRegistryModal isOpen={showConfig} onClose={() => setShowConfig(false)} title="Service Matrix Registry" sections={[{ title: "Service Types", category: "ServiceType", icon: Database }, { title: "Status Options", category: "Status", icon: RefreshCcw }, { title: "Environments", category: "Environment", icon: Globe }]} />
      <BulkImportModal 
         isOpen={showImportModal} 
         onClose={() => setShowImportModal(false)} 
         tableName="logical_services" 
         displayName="Service Registry" 
      />
      <style>{`
        .ag-theme-alpine-dark { --ag-background-color: #1a1b26; --ag-header-background-color: #24283b; --ag-border-color: rgba(255, 255, 255, 0.05); --ag-foreground-color: #f1f5f9; --ag-header-foreground-color: #3b82f6; --ag-font-family: 'Inter', sans-serif; --ag-font-size: ${fontSize}px; }
        .ag-root-wrapper { border: none !important; }
        .ag-header-cell-label { font-size: ${fontSize}px !important; font-weight: 700 !important; text-transform: uppercase !important; letter-spacing: 0.1em !important; justify-content: center !important; }
        .ag-cell { display: flex; align-items: center; justify-content: center !important; font-weight: 700 !important; font-size: ${fontSize}px !important; }
        .ag-row-hover { background-color: rgba(255, 255, 255, 0.05) !important; }
        .ag-row-selected { background-color: rgba(59, 130, 246, 0.2) !important; }

      `}</style>
    </div>
  )
}
