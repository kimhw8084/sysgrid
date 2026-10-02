import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Plus, Search, Trash2, Edit2, Info, 
  ListTodo, History, ShieldAlert, Globe, 
  Zap, Save, X, PlusCircle, User, MessageSquare,
  MoreVertical, RefreshCcw, TrendingUp, AlertTriangle,
  Lightbulb, ShieldCheck, Calendar, Activity, Database, Server,
  FileText, Clipboard, Terminal, ArrowRight, Shield, Download, Share2,
  Clock, CheckCircle2, ChevronRight, LayoutGrid, List, Sliders, Eye, EyeOff, Camera, Link as LinkIcon, Link2, Layers, Settings, Check, Target, ChevronDown, PlusCircle as PlusIcon,
  Workflow, ExternalLink
} from 'lucide-react'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import { apiFetch } from '../api/apiClient'
import { toast } from 'react-hot-toast'
import { formatAppDate } from '../utils/dateUtils'
import { ConfirmationModal } from './shared/ConfirmationModal'
import { StyledSelect } from './shared/StyledSelect'
import { StatusPill } from './shared/StatusPill'
import { ConfigRegistryModal } from './ConfigRegistry'
import { GaugeSelector } from './FAR'
import { RootCauseFormModal, MitigationFormModal, PreventionFormModal } from './shared/FARModals'
import { InvestigationTab } from './shared/InvestigationTab'
import { OperationalWorkspaceShell } from './shared/OperationalWorkspaceShells'
import { OperationalDataGrid } from './shared/OperationalDataGrid'
import { ToolbarButton, ToolbarGroup, ToolbarIconButton, ToolbarSearch } from './shared/LayoutPrimitives'

async function fetchResearchList(path: string) {
  const response = await apiFetch(path)
  if (!response.ok) throw new Error(await response.text())
  const payload = await response.json()
  if (!Array.isArray(payload)) throw new Error(`Expected a list response from ${path}`)
  return payload
}

// --- Components ---

export const getPriorityInfo = (p: any) => {
  const val = typeof p === 'string' ? p.toUpperCase() : (p >= 10 ? 'HIGHEST' : p >= 7 ? 'HIGH' : p >= 4 ? 'MEDIUM' : 'LOW')
  const colors: any = {
    'HIGHEST': 'text-rose-400 border-rose-500/40 bg-rose-500/20',
    'HIGH': 'text-amber-400 border-amber-500/40 bg-amber-500/20',
    'MEDIUM': 'text-blue-400 border-blue-500/40 bg-blue-500/20',
    'LOW': 'text-emerald-400 border-emerald-500/40 bg-emerald-500/20'
  }
  return { label: val, color: colors[val] || 'text-slate-400 border-white/10 bg-white/5' }
}

export const PriorityGauge = ({ value, onChange, disabled, type }: { value: string | number, onChange: (v: string | number) => void, disabled?: boolean, type: 'RCA' | 'RESEARCH' }) => {
  const priorities = [
    { 
      id: 'LOW', 
      val: 1,
      label: 'LOW', 
      color: 'bg-emerald-500', 
      border: 'border-emerald-500/30', 
      text: 'text-emerald-400',
      hint: 'MINOR ANOMALY / NO PRODUCTION IMPACT'
    },
    { 
      id: 'MEDIUM', 
      val: 4,
      label: 'MEDIUM', 
      color: 'bg-blue-500', 
      border: 'border-blue-500/30', 
      text: 'text-blue-400',
      hint: 'MODERATE IMPACT / WORKAROUND EXISTS'
    },
    { 
      id: 'HIGH', 
      val: 7,
      label: 'HIGH', 
      color: 'bg-amber-500', 
      border: 'border-amber-500/30', 
      text: 'text-amber-400',
      hint: 'MAJOR IMPACT / SIGNIFICANT DEGRADATION'
    },
    { 
      id: 'HIGHEST', 
      val: 10,
      label: 'HIGHEST', 
      color: 'bg-rose-500', 
      border: 'border-rose-500/30', 
      text: 'text-rose-400',
      hint: 'CRITICAL FAILURE / PRODUCTION LINE HALTED'
    }
  ]

  const currentLabel = getPriorityInfo(value).label
  const activeIdx = priorities.findIndex(p => p.id === currentLabel)

  return (
    <div className={`space-y-3 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <div className="flex items-center justify-between px-1">
         <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Priority Spectrum</label>
         <div className={`text-[10px] font-bold uppercase tracking-tighter ${priorities[activeIdx]?.text}`}>
            {priorities[activeIdx]?.hint}
         </div>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {priorities.map((p, idx) => (
          <button
            key={p.id}
            onClick={() => onChange(typeof value === 'number' ? p.val : p.id)}
            className={`p-2 rounded-lg transition-all border-2 flex flex-col items-center gap-1 group ${idx === activeIdx ? p.border + ' bg-white/10 shadow-[0_0_30px_rgba(255,255,255,0.05)]' : 'border-white/5 bg-white/5 hover:border-white/10'}`}
          >
            <div className={`w-6 h-0.5 rounded-lg ${idx === activeIdx ? p.color : 'bg-slate-800'}`} />
            <span className={`text-[9px] font-bold uppercase tracking-widest transition-all ${idx === activeIdx ? p.text : 'text-slate-500 group-hover:text-slate-400'}`}>
              {p.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export const safeUpper = (val: any) => (val?.toString() || '').toUpperCase()

export const CompactSummary = ({ label, value, icon: Icon, color }: any) => (
  <div className="bg-white/5 border border-white/5 p-4 rounded-lg flex items-center justify-between shadow-inner w-64">
    <div>
      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-0.5">{label}</p>
      <p className="text-2xl font-bold text-white tracking-tighter">{value}</p>
    </div>
    <div className={`p-2 rounded-lg bg-white/5 ${color}`}><Icon size={18} /></div>
  </div>
)

export const SectionCard = ({ icon: Icon, title, color, children, className = "" }: any) => (
  <div className={`bg-white/5 border border-white/5 rounded-lg p-4 space-y-3 ${className}`}>
    <div className="flex items-center gap-2 border-b border-white/5 pb-2 mb-1">
      <Icon size={14} className={color} />
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-white/70">{title}</h3>
    </div>
    {children}
  </div>
)

export const SummaryCard = ({ icon: Icon, label, value, color }: any) => (
  <div className="flex items-center gap-4 group">
     <div className={`p-2.5 rounded-lg bg-white/5 border border-white/10 group-hover:border-white/20 transition-all ${color}`}>
        <Icon size={18} />
     </div>
     <div className="flex flex-col">
        <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">{label}</span>
        <span className="text-[10px] font-bold text-slate-200 uppercase tracking-tight">{value}</span>
     </div>
  </div>
)

const getResearchStatusKey = (status: any) => safeUpper(status)
const getResearchDisplayStatus = (status: any) => {
  const key = getResearchStatusKey(status)
  const labels: Record<string, string> = {
    ANALYZING: 'Analyzing',
    OPEN: 'Open',
    INVESTIGATION: 'Investigation',
    RESOLVED: 'Resolved',
    CLOSED: 'Closed',
    ESCALATED: 'Escalated',
    MONITORING: 'Monitoring'
  }
  return labels[key] || status || 'Unknown'
}

const getResearchStatusColor = (status: any) => {
  const colors: Record<string, string> = {
    ANALYZING: 'text-blue-400 border-blue-500/40 bg-blue-500/20',
    OPEN: 'text-amber-400 border-amber-500/40 bg-amber-500/20',
    INVESTIGATION: 'text-purple-400 border-purple-500/40 bg-purple-500/20',
    RESOLVED: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/20',
    CLOSED: 'text-slate-400 border-white/20 bg-white/10',
    ESCALATED: 'text-rose-400 border-rose-500/40 bg-rose-500/20',
    MONITORING: 'text-indigo-400 border-indigo-500/40 bg-indigo-500/20'
  }
  return colors[getResearchStatusKey(status)] || 'text-slate-400 border-white/10 bg-white/5'
}

const getResearchRecordDate = (item: any) =>
  item?.type === 'RCA'
    ? (item.incident_at || item.occurrence_at || item.created_at)
    : (item.initiation_at || item.created_at)

export default function Research() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const gridRef = React.useRef<any>(null)
  const typeParam = searchParams.get('type')
  const idParam = searchParams.get('id')
  const [fontSize, setFontSize] = useState(11)
  const [rowDensity, setRowDensity] = useState(10)
  const [showStyleLab, setShowStyleLab] = useState(false)
  const [showYearFilters, setShowYearFilters] = useState(false)
  const [showInsights, setShowInsights] = useState(false)
  const [showColumnPicker, setShowColumnPicker] = useState(false)
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([])
  const [showConfig, setShowConfig] = useState(false)

  const [searchTerm, setSearchTerm] = useState('')
  const [activeModal, _setActiveModal] = useState<any>(null)
  const [activeDetails, _setActiveDetails] = useState<any>(null)

  const setActiveModal = (val: any) => {
    if (val) _setActiveDetails(null)
    _setActiveModal(val)
  }
  const setActiveDetails = (val: any) => {
    if (val) _setActiveModal(null)
    _setActiveDetails(val)
  }
  const [confirmModal, setConfirmModal] = useState<any>({ isOpen: false, title: '', message: '', onConfirm: () => {} })
  const [selectedRecordKeys, setSelectedRecordKeys] = useState<string[]>([])
  const [selectedYear, setSelectedYear] = useState<string>('ALL')

  const { data: investigations, isLoading, isError: investigationsError } = useQuery({ 
    queryKey: ['investigations'], 
    queryFn: () => fetchResearchList('/api/v1/investigations')
  })

  const { data: rcaRecords, isLoading: rcaLoading, isError: rcaError } = useQuery({ 
    queryKey: ['rca-records'], 
    queryFn: () => fetchResearchList('/api/v1/rca')
  })
  
  const { data: devices } = useQuery({ 
    queryKey: ['devices'], 
    queryFn: async () => (await apiFetch('/api/v1/devices/')).json() 
  })
  
  const { data: options } = useQuery({ 
    queryKey: ['settings-options'], 
    queryFn: async () => (await apiFetch('/api/v1/settings/options')).json() 
  })

  const { data: failureModes } = useQuery({
    queryKey: ['far-failure-modes'],
    queryFn: async () => (await apiFetch('/api/v1/far/modes')).json()
  })

  const handleExportCSV = () => {
    if (gridRef.current?.api) {
      gridRef.current.api.exportDataAsCsv({
        fileName: `SysGrid_Research_${new Date().toISOString().split('T')[0]}.csv`,
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
          .then(() => toast.success("Table data copied to clipboard"))
          .catch(() => toast.error("Failed to copy data"))
      }
    }
  }

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const isRca = data.type === 'RCA'
      const url = data.id ? `/api/v1/${isRca ? 'rca' : 'investigations'}/${data.id}` : `/api/v1/${isRca ? 'rca' : 'investigations'}/`
      const method = data.id ? 'PUT' : 'POST'
      const res = await apiFetch(url, { method, body: JSON.stringify(data) })
      return res.json()
    },
    onSuccess: (_, variables) => { 
      queryClient.invalidateQueries({ queryKey: [variables.type === 'RCA' ? 'rca-records' : 'investigations'] })
      // Use a unique ID to prevent multiple toasts if called rapidly
      toast.success('System Intelligence Synchronized', { id: `sync-${variables.id || 'new'}` })
      setActiveModal(null)
    },
    onError: (error: any) => {
      toast.error(`Synchronization Failure: ${error.message || 'Unknown Error'}`, { id: 'sync-error' })
    }
  })

  const deleteMutation = useMutation({
    mutationFn: async (item: any) => {
      const url = item.type === 'RCA' ? `/api/v1/rca/${item.id}` : `/api/v1/investigations/${item.id}`
      return apiFetch(url, { method: 'DELETE' })
    },
    onSuccess: (_, variables) => { 
      queryClient.invalidateQueries({ queryKey: [variables.type === 'RCA' ? 'rca-records' : 'investigations'] })
      toast.success(variables.type === 'RCA' ? 'RCA archived' : 'Research archived')
    }
  })

  const combinedData = useMemo(() => {
    const invs = (investigations || []).map((i: any) => ({ ...i, type: 'Research' }))
    const rcas = (rcaRecords || []).map((r: any) => ({ ...r, type: 'RCA', category: 'RCA' }))
    return [...invs, ...rcas].sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
  }, [investigations, rcaRecords])

  const availableYears = useMemo(() => {
    const years = new Set<string>()
    combinedData.forEach((item: any) => {
      const date = getResearchRecordDate(item)
      if (date) {
        years.add(new Date(date).getFullYear().toString())
      }
    })
    return ['ALL', ...Array.from(years).sort((a, b) => b.localeCompare(a))]
  }, [combinedData])

  const filteredData = useMemo(() => {
    if (selectedYear === 'ALL') return combinedData
    return combinedData.filter((item: any) => {
      const date = getResearchRecordDate(item)
      return date && new Date(date).getFullYear().toString() === selectedYear
    })
  }, [combinedData, selectedYear])

  useEffect(() => {
    if (activeDetails) {
       const fresh = combinedData.find((d: any) => d.id === activeDetails.id && d.type === activeDetails.type)
       if (fresh) setActiveDetails(fresh)
    }
  }, [combinedData])

  const stats = useMemo(() => {
    return {
      total: filteredData.length,
      analyzing: filteredData.filter((i: any) => ['ANALYZING', 'OPEN', 'INVESTIGATION'].includes(getResearchStatusKey(i.status))).length,
      rca: filteredData.filter((i: any) => i.type === 'RCA').length,
      highest: filteredData.filter((i: any) => i.priority === 'HIGHEST' || i.priority >= 8).length
    }
  }, [filteredData])

  const combinedLoading = combinedData.length === 0 && (isLoading || rcaLoading)
  const combinedUnavailable = combinedData.length === 0 && (investigationsError || rcaError)
  const combinedEmpty = !combinedLoading && !combinedUnavailable && filteredData.length === 0
  const partialSourceError = !combinedUnavailable && (investigationsError || rcaError)
  const researchGridRuntime = useMemo(() => ({}), [])

  const getResearchRecordKey = (item: any) => `${item?.type === 'RCA' ? 'rca' : 'research'}:${Number(item?.id)}`

  const openResearchDetails = (item: any) => {
    setActiveDetails(item)
    const next = new URLSearchParams(searchParams)
    next.set('type', item?.type === 'RCA' ? 'rca' : 'research')
    next.set('id', String(item?.id))
    navigate({ search: `?${next.toString()}` }, { replace: true })
  }

  const closeResearchDetails = () => {
    setActiveDetails(null)
    const next = new URLSearchParams(searchParams)
    next.delete('type')
    next.delete('id')
    navigate({ search: next.toString() ? `?${next.toString()}` : '' }, { replace: true })
  }

  useEffect(() => {
    if (!typeParam || !idParam || combinedLoading) return
    const normalizedType = typeParam.toLowerCase() === 'rca'
      ? 'RCA'
      : typeParam.toLowerCase() === 'research'
        ? 'Research'
        : null
    const targetId = Number(idParam)
    const target = normalizedType && Number.isFinite(targetId)
      ? combinedData.find((item: any) => item.type === normalizedType && Number(item.id) === targetId)
      : null
    if (target) {
      _setActiveModal(null)
      _setActiveDetails(target)
      return
    }
    _setActiveDetails(null)
    const next = new URLSearchParams(searchParams)
    next.delete('type')
    next.delete('id')
    navigate({ search: next.toString() ? `?${next.toString()}` : '' }, { replace: true })
  }, [combinedData, combinedLoading, idParam, navigate, searchParams, typeParam])

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
    { 
      field: "id", 
      headerName: "ID", 
      width: 90,
      minWidth: 90,
      pinned: 'left',
      cellClass: 'text-center font-bold text-slate-500',
      headerClass: 'text-center',
      filter: 'agNumberColumnFilter',
      valueGetter: (p: any) => p.data.type === 'RCA' ? `RCA-${p.data.id}` : `RES-${p.data.id}`
    },
    { 
      field: "involved_systems", 
      headerName: "Involved System", 
      width: 140, 
      minWidth: 140,
      maxWidth: 240,
      filter: true, 
      cellClass: "font-bold text-center", 
      headerClass: 'text-center',
      valueGetter: (p: any) => {
        const sys = p.data.type === 'RCA' ? (p.data.target_systems || []) : (p.data.systems || [])
        return sys
      },
      cellRenderer: (p: any) => {
        const sys = p.value || []
        if (sys.length === 0) return <span className="text-slate-600">N/A</span>
        const display = sys.length > 1 ? `${sys[0]} +${sys.length - 1}` : sys[0]
        return (
          <div className="group relative cursor-help w-full h-full flex items-center justify-center">
            <span className="truncate" title={sys.join(', ')} style={{ fontSize: `${fontSize}px` }}>{display}</span>
            {sys.length > 1 && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-[9999] pointer-events-none">
                <div className="bg-slate-900 border border-white/20 rounded-lg p-2 shadow-[0_10px_30px_rgba(0,0,0,0.5)] whitespace-nowrap">
                  {sys.map((s: string, i: number) => (
                    <div key={i} className="text-[10px] font-bold uppercase text-blue-400 px-2 py-0.5 border-b border-white/5 last:border-0">{s}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      },
      hide: hiddenColumns.includes("involved_systems")
    },
    { 
      field: "title", 
      headerName: "Title", 
      minWidth: 200,
      flex: 1.5, 
      filter: true, 
      cellClass: 'text-left font-bold uppercase tracking-tight truncate',
      headerClass: 'text-left',
      cellRenderer: (p: any) => <span style={{ fontSize: `${fontSize}px` }}>{p.value}</span>,
      hide: hiddenColumns.includes("title")
    },
    { 
      field: "type", 
      headerName: "Type", 
      width: 90, 
      filter: true, 
      cellClass: 'text-center',
      headerClass: 'text-center',
      cellRenderer: (p: any) => (
        <span style={{ fontSize: `${fontSize}px` }} className={`font-bold uppercase tracking-widest ${p.value === 'RCA' ? 'text-purple-400' : 'text-blue-400'}`}>
          {p.value}
        </span>
      ),
      hide: hiddenColumns.includes("type")
    },
    { 
      field: "priority", 
      headerName: "Priority", 
      width: 110, 
      filter: true, 
      cellClass: 'text-center',
      headerClass: 'text-center',
      cellRenderer: (p: any) => {
        const pInfo = getPriorityInfo(p.value)
        return (
          <div className="flex items-center justify-center h-full w-full">
            <div className={`flex items-center justify-center w-24 h-5 rounded-lg border shadow-sm ${pInfo.color}`}>
              <span style={{ fontSize: `${fontSize + 1}px` }} className="font-bold uppercase tracking-tighter leading-none">{pInfo.label}</span>
            </div>
          </div>
        )
      },
      hide: hiddenColumns.includes("priority")
    },
    { 
      field: "status", 
      headerName: "Status", 
      width: 110, 
      filter: true, 
      cellClass: 'text-center',
      headerClass: 'text-center',
      cellRenderer: (p: any) => {
        return (
          <div className="flex items-center justify-center h-full w-full">
            <div className={`flex items-center justify-center w-24 h-5 rounded-lg border shadow-sm ${getResearchStatusColor(p.value)}`}>
              <span style={{ fontSize: `${fontSize + 1}px` }} className="font-bold uppercase tracking-tighter leading-none">
                {getResearchDisplayStatus(p.value)}
              </span>
            </div>
          </div>
        )
      },
      hide: hiddenColumns.includes("status")
    },
    { 
      field: "initiation", 
      headerName: "Initiation", 
      width: 140, 
      filter: true, 
      cellClass: 'text-center font-bold text-slate-400 uppercase', 
      headerClass: 'text-center',
      valueGetter: (p: any) => p.data.type === 'RCA' ? p.data.occurrence_at : p.data.initiation_at,
      cellRenderer: (p: any) => p.value ? <span style={{ fontSize: `${fontSize}px` }}>{formatAppDate(p.value)}</span> : <span style={{ fontSize: `${fontSize}px` }} className="text-slate-500 font-bold uppercase">N/A</span>,
      hide: hiddenColumns.includes("initiation")
    },
    { 
      field: "created_at", 
      headerName: "Created", 
      width: 140, 
      filter: true, 
      cellClass: 'text-center font-bold text-slate-500 uppercase', 
      headerClass: 'text-center',
      cellRenderer: (p: any) => p.value ? <span style={{ fontSize: `${fontSize}px` }}>{formatAppDate(p.value)}</span> : <span style={{ fontSize: `${fontSize}px` }}>N/A</span>,
      hide: hiddenColumns.includes("created_at")
    },
    { 
      field: "updated_at", 
      headerName: "Last Updated", 
      width: 140, 
      filter: true, 
      cellClass: 'text-center font-bold text-slate-300 uppercase', 
      headerClass: 'text-center',
      cellRenderer: (p: any) => p.value ? <span style={{ fontSize: `${fontSize}px` }}>{formatAppDate(p.value)}</span> : <span style={{ fontSize: `${fontSize}px` }}>N/A</span>,
      hide: hiddenColumns.includes("updated_at")
    },
    { 
      field: "owner_display", 
      headerName: "Owner", 
      width: 140, 
      filter: true, 
      cellClass: 'text-center font-bold uppercase text-blue-400', 
      headerClass: 'text-center',
      valueGetter: (p: any) => {
        if (p.data.type === 'RCA') {
           const owners = p.data.owners || []
           if (owners.length === 0) return p.data.owner || 'N/A'
           return owners.length > 1 ? `${owners[0]} +${owners.length - 1}` : owners[0]
        }
        return p.data.assigned_team || 'N/A'
      },
      cellRenderer: (p: any) => <span style={{ fontSize: `${fontSize}px` }}>{p.value}</span>,
      hide: hiddenColumns.includes("owner_display")
    },
    { 
      field: "problem_statement", 
      headerName: "Problem Statement", 
      width: 200, 
      filter: true, 
      cellClass: 'text-left font-bold text-slate-500 truncate px-4',
      headerClass: 'text-left',
      cellRenderer: (p: any) => <span style={{ fontSize: `${fontSize}px` }}>{p.value}</span>,
      hide: hiddenColumns.includes("problem_statement")
    },
    { 
      field: "incident_type", 
      headerName: "Incident Type", 
      width: 130, 
      filter: true, 
      cellClass: 'text-center font-bold text-slate-400 uppercase', 
      headerClass: 'text-center',
      cellRenderer: (p: any) => <span style={{ fontSize: `${fontSize}px` }}>{p.value || 'N/A'}</span>,
      hide: hiddenColumns.includes("incident_type")
    },
    { 
      field: "created_by_user_id", 
      headerName: "Created By", 
      width: 130, 
      filter: true, 
      cellClass: 'text-center font-bold text-blue-400 uppercase', 
      headerClass: 'text-center',
      cellRenderer: (p: any) => <span style={{ fontSize: `${fontSize}px` }}>{p.value || 'SYSTEM'}</span>,
      hide: hiddenColumns.includes("created_by_user_id")
    },
    { 
      field: "owner", 
      headerName: "Edited By", 
      width: 130, 
      filter: true, 
      cellClass: 'text-center font-bold text-purple-400 uppercase', 
      headerClass: 'text-center',
      cellRenderer: (p: any) => <span style={{ fontSize: `${fontSize}px` }}>{p.value || 'N/A'}</span>,
      hide: hiddenColumns.includes("owner")
    },
    {
      field: "actions",
      headerName: "Action",
      width: 100,
      minWidth: 100,
      pinned: 'right',
      cellClass: 'text-center',
      headerClass: 'text-center',
      resizable: false,
      cellRenderer: (p: any) => (
        <div className="flex items-center justify-center space-x-1 h-full">
           <div className="flex rounded-lg p-0.5 border border-white/5 bg-transparent">
               <button onClick={() => openResearchDetails(p.data)} title="Inspect Record" className="p-1.5 text-blue-400 hover:text-blue-200 transition-all border-r border-white/5"><Eye size={14}/></button>
               <button onClick={() => setConfirmModal({ 
                 isOpen: true, 
                 title: p.data.type === 'RCA' ? 'Archive RCA' : 'Archive Research',
                 message: `Archive this ${p.data.type === 'RCA' ? 'RCA' : 'Research'} record? It will be removed from the active matrix without permanent deletion.`,
                 onConfirm: () => deleteMutation.mutate(p.data) 
               })} title={p.data.type === 'RCA' ? 'Archive RCA' : 'Archive Research'} className="p-1.5 text-rose-400 hover:text-rose-200 transition-all"><Trash2 size={14}/></button>
           </div>
        </div>
      ),
      lockVisible: true
    }
  ], [deleteMutation, fontSize, hiddenColumns, openResearchDetails]) as any

  return (
    <OperationalWorkspaceShell
      archetype="analytical"
      workspace="research"
      className="overflow-hidden"
      header={{
        eyebrow: 'Analysis',
        title: (
          <div className="flex items-center gap-3">
            <Shield size={22} className="text-blue-500" />
            <span>Research Matrix</span>
          </div>
        ),
        subtitle: 'Unified System Intelligence & RCA Engine',
      }}
      toolbarSearch={(
        <ToolbarSearch value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Scan research..." />
      )}
      toolbarControls={(
        <ToolbarGroup>
          <ToolbarButton active={showStyleLab} onClick={() => setShowStyleLab((current) => !current)} title="Display density controls">
            <Sliders size={14} /> Display
          </ToolbarButton>
          <ToolbarButton active={showYearFilters} onClick={() => setShowYearFilters((current) => !current)} title="Record-year filters">
            {showYearFilters ? <EyeOff size={14} /> : <Eye size={14} />} Filters
          </ToolbarButton>
          <ToolbarButton active={showInsights} onClick={() => setShowInsights((current) => !current)} title="Research insights">
            <Activity size={14} /> Insights
          </ToolbarButton>
          <ToolbarIconButton onClick={() => setShowColumnPicker(!showColumnPicker)} active={showColumnPicker} title="Column Picker"><LayoutGrid size={16} /></ToolbarIconButton>
          <ToolbarIconButton onClick={() => setShowConfig(true)} title="Research Config"><Settings size={16} /></ToolbarIconButton>
        </ToolbarGroup>
      )}
      toolbarActions={(
        <ToolbarGroup>
          <ToolbarIconButton onClick={handleExportCSV} title="Export CSV"><FileText size={16} /></ToolbarIconButton>
          <ToolbarIconButton onClick={handleCopyToClipboard} disabled={selectedRecordKeys.length === 0} title="Copy to Clipboard"><Clipboard size={16} /></ToolbarIconButton>
          <ToolbarButton variant="primary" onClick={() => setActiveModal({ title: '', status: 'Open', priority: 'Low', type: null, problem_statement: '', systems: [], target_systems: [] })}>
            <PlusCircle size={14}/> Add Research
          </ToolbarButton>
        </ToolbarGroup>
      )}
      secondaryToolbar={showYearFilters ? (
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <span className="mr-2 shrink-0 text-[9px] font-bold uppercase tracking-widest text-slate-500">Record year</span>
          {availableYears.map(year => (
            <button
              key={year}
              onClick={() => setSelectedYear(year)}
              className={`px-4 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${selectedYear === year ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {year}
            </button>
          ))}
        </div>
      ) : null}
    >
      <AnimatePresence>
        {showStyleLab && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="shrink-0 overflow-hidden">
            <div className="bg-blue-600/10 border border-blue-500/20 rounded-lg p-4 flex items-center justify-between backdrop-blur-md">
               <div className="flex items-center space-x-12">
                  <div className="flex items-center space-x-3 text-blue-400">
                     <Activity size={16} />
                     <span className="text-[10px] font-bold uppercase tracking-widest">Display Density</span>
                  </div>
                  <div className="flex items-center space-x-6">
                     <div className="flex items-center space-x-4">
                        <span className="text-[9px] font-bold text-slate-500 uppercase">Font Size</span>
                        <input type="range" min="8" max="14" step="1" value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="w-32 accent-blue-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
                        <span className="text-[10px] text-white w-4 font-bold">{fontSize}px</span>
                     </div>
                     <div className="flex items-center space-x-4 border-l border-white/10 pl-6">
                        <span className="text-[9px] font-bold text-slate-500 uppercase">Row Density</span>
                        <input type="range" min="4" max="24" step="2" value={rowDensity} onChange={e => setRowDensity(Number(e.target.value))} className="w-32 accent-indigo-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
                        <span className="text-[10px] text-white w-4 font-bold">{rowDensity}px</span>
                     </div>
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
            <div className="flex flex-wrap justify-center gap-3 rounded-lg border border-white/5 bg-black/20 p-4">
              <CompactSummary label="Total Intelligence" value={stats.total} icon={Activity} color="text-blue-400" />
              <CompactSummary label="Under Analysis" value={stats.analyzing} icon={Terminal} color="text-indigo-400" />
              <CompactSummary label="Root Cause Records" value={stats.rca} icon={ShieldAlert} color="text-purple-400" />
              <CompactSummary label="Highest Priority" value={stats.highest} icon={AlertTriangle} color="text-rose-500" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col flex-1 min-h-0 relative">
        <OperationalDataGrid
          gridRef={gridRef}
          rows={filteredData}
          columnDefs={columnDefs as any}
          runtime={researchGridRuntime}
          quickFilterText={searchTerm}
          fontSize={fontSize}
          rowDensity={rowDensity}
          getRowId={(params) => getResearchRecordKey(params.data)}
          onSelectionChanged={(event) => setSelectedRecordKeys(event?.api?.getSelectedNodes().map((node: any) => getResearchRecordKey(node.data)).filter(Boolean) || [])}
          noRowsLabel="No Research or RCA records in scope"
          loading={combinedLoading}
          loadingIcon={<RefreshCcw size={28} className="animate-spin text-blue-400" />}
          loadingLabel={<p className="text-[10px] font-semibold text-blue-300">Syncing intelligence matrix...</p>}
          dataState={combinedUnavailable ? {
            kind: 'query-error',
            noRowsLabel: 'No Research or RCA records in scope',
            title: 'Research intelligence unavailable',
            description: 'One or more Research sources could not be loaded. Retry from the workspace navigation.',
          } : (combinedEmpty ? {
            kind: 'filtered-empty',
            noRowsLabel: 'No Research or RCA records in scope',
            title: 'No Research or RCA records in scope',
            description: 'Adjust the record year or create a Research or RCA record.',
          } : {
            kind: 'ready',
            noRowsLabel: 'No Research or RCA records in scope',
            notice: partialSourceError ? {
              tone: 'warning',
              title: 'Partial research source unavailable',
              description: 'Available Research records are shown; one source could not be loaded.',
            } : undefined,
          })}
          suppressRowClickSelection={false}
        />
        <AnimatePresence>
          {showColumnPicker && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="absolute top-0 right-0 bottom-0 w-64 bg-slate-950/90 backdrop-blur-xl border-l border-white/10 z-[60] flex flex-col shadow-2xl">
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-widest text-blue-400 flex items-center space-x-2"><Sliders size={14} /> <span>Toggle Columns</span></h3>
                <button onClick={() => setShowColumnPicker(false)} className="text-slate-500 hover:text-white"><X size={18}/></button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-1">
                {columnDefs.filter((c: any) => c.field && !c.lockVisible).map((col: any) => (
                  <label key={col.field} className="flex items-center space-x-3 p-2 rounded-lg hover:bg-white/5 cursor-pointer group transition-all">
                    <input type="checkbox" checked={!hiddenColumns.includes(col.field)} onChange={() => setHiddenColumns(hiddenColumns.includes(col.field) ? hiddenColumns.filter(f => f !== col.field) : [...hiddenColumns, col.field])} className="sr-only" />
                    <div className={`w-4 h-4 rounded-lg border transition-all ${!hiddenColumns.includes(col.field) ? 'bg-blue-600 border-blue-500 shadow-lg shadow-blue-500/20' : 'border-white/10 bg-black/40 group-hover:border-white/20'}`}>
                       {!hiddenColumns.includes(col.field) && <Check size={12} className="text-white mx-auto" />}
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${!hiddenColumns.includes(col.field) ? 'text-slate-200' : 'text-slate-500'}`}>{col.headerName || col.field}</span>
                  </label>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {activeModal && (
          <UnifiedResearchForm 
            item={activeModal} 
            options={options} 
            devices={devices} 
            onClose={() => setActiveModal(null)} 
            onSave={(d: any) => mutation.mutateAsync(d)}
            isSaving={mutation.isPending}
          />
        )}
        {activeDetails && (
          activeDetails.type === 'RCA' ? (
            <EnhancedRcaDetails 
              item={activeDetails} 
              devices={devices}
              options={options}
              failureModes={failureModes}
              onClose={closeResearchDetails}
              onSave={(d: any) => mutation.mutateAsync(d)}
              fontSize={fontSize}
              rowDensity={rowDensity}
            />
          ) : (
            <ResearchDetails 
              item={activeDetails} 
              onClose={closeResearchDetails}
              onSave={(d: any) => mutation.mutateAsync(d)}
              setConfirmModal={setConfirmModal}
              fontSize={fontSize}
              rowDensity={rowDensity}
            />
          )
        )}
      </AnimatePresence>

      <ConfirmationModal isOpen={confirmModal.isOpen} onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })} onConfirm={() => { confirmModal.onConfirm?.(); setConfirmModal((prev: any) => ({ ...prev, isOpen: false })); }} title={confirmModal.title} message={confirmModal.message} />
      
      <ConfigRegistryModal 
        isOpen={showConfig} 
        onClose={() => setShowConfig(false)} 
        title="Research Configuration Matrix"
        sections={[
          { title: 'System Hierarchy', category: 'LogicalSystem', icon: Database },
          { title: 'Research Domains', category: 'ResearchCategory', icon: LayoutGrid },
          { title: 'Failure Domains', category: 'FailureCategory', icon: ShieldAlert },
          { title: 'Incident Types', category: 'IncidentType', icon: AlertTriangle },
          { title: 'Detection Types', category: 'DetectionType', icon: Search },
          { title: 'Impact Types', category: 'ImpactType', icon: ShieldAlert },
          { title: 'Event Types', category: 'EventType', icon: Activity }
        ]}
      />

    </OperationalWorkspaceShell>
  )
}

export function SearchableMultiSelect({ label, selected = [], onChange, options = [], placeholder, allowCustom = true }: any) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredOptions = useMemo(() => {
    const term = search.toLowerCase().trim()
    let filtered = options.filter((opt: any) => 
      (typeof opt === 'string' ? opt : opt.label).toLowerCase().includes(term)
    )
    
    if (allowCustom && term && !filtered.some((opt:any) => (typeof opt === 'string' ? opt : opt.label).toLowerCase() === term)) {
        filtered = [{ value: term, label: `Add "${term}"...`, isNew: true }, ...filtered]
    }
    return filtered
  }, [options, search, allowCustom])

  const toggleOption = (opt: any) => {
    const val = typeof opt === 'string' ? opt : opt.value
    const next = selected.includes(val)
      ? selected.filter((s: string) => s !== val)
      : [...selected, val]
    onChange(next)
    if (typeof opt !== 'string' && opt.isNew) setSearch('')
  }

  return (
    <div className="space-y-1 relative" ref={containerRef}>
      {label && <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block px-1">{label}</label>}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-slate-950 border border-white/10 rounded-lg px-4 py-2.5 text-[11px] font-bold text-slate-300 cursor-pointer flex items-center justify-between hover:border-white/20 transition-all min-h-[40px] relative z-10"
      >
        <div className="flex flex-wrap gap-1">
          {selected.length > 0 ? (
            selected.map((s: any) => {
              const val = typeof s === 'string' ? s : (s.value || s)
              const lbl = typeof s === 'string' ? s : (s.label || s)
              return (
                <span key={val} className="bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase border border-blue-500/30 flex items-center gap-1 group/badge">
                  {lbl}
                  <button onClick={(e) => { e.stopPropagation(); toggleOption(s); }} className="hover:text-rose-400 transition-colors">
                    <X size={10} />
                  </button>
                </span>
              )
            })
          ) : (
            <span className="text-slate-500 uppercase">{placeholder}</span>
          )}
        </div>
        <ChevronDown size={14} className={`text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }} 
            animate={{ opacity: 1, y: 0 }} 
            exit={{ opacity: 0, y: -10 }}
            className="absolute z-[1000] w-full mt-2 bg-slate-900 border border-white/10 rounded-lg shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden backdrop-blur-xl"
            style={{ top: '100%' }}
          >
            <div className="p-2 border-b border-white/5 bg-white/5">
              <div className="relative">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input 
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Filter or add new..."
                  className="w-full bg-black/40 border border-white/5 rounded-lg pl-9 pr-3 py-2 text-[10px] font-bold text-white outline-none focus:border-blue-500/50 uppercase"
                />
              </div>
            </div>
            <div className="max-h-60 overflow-y-auto custom-scrollbar p-1">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((opt: any) => {
                  const val = typeof opt === 'string' ? opt : opt.value
                  const lbl = typeof opt === 'string' ? opt : opt.label
                  const isSelected = selected.includes(val)
                  const isNew = typeof opt !== 'string' && opt.isNew
                  return (
                    <div 
                      key={val}
                      onClick={() => toggleOption(opt)}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-all group ${isSelected ? 'bg-blue-500/10 text-blue-400' : 'hover:bg-white/5 text-slate-400'}`}
                    >
                      <span className={`text-[10px] font-bold uppercase tracking-tight ${isNew ? 'text-blue-400' : ''}`}>{lbl}</span>
                      <div className={`w-3.5 h-3.5 rounded-lg border flex items-center justify-center transition-all ${isSelected ? 'bg-blue-600 border-blue-500' : 'border-white/10 bg-black/40'}`}>
                        {isSelected && <Check size={10} className="text-white" />}
                        {isNew && !isSelected && <Plus size={10} className="text-blue-400" />}
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="py-8 text-center text-[9px] font-bold text-slate-600 uppercase tracking-widest">No results found</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function UnifiedResearchForm({ item, options, devices, onClose, onSave, isSaving }: any) {
  const [formData, setFormData] = useState({ ...item })
  const [step, setStep] = useState(item.type ? 1 : 0)
  
  const systems = useMemo(() => Array.from(new Set(devices?.map((d: any) => d.system) || [])).filter(Boolean), [devices])
  const enumOptions = (cat: string) => (options || []).filter((o: any) => o.category === cat).map((o: any) => ({ value: o.value.toUpperCase(), label: o.label.toUpperCase() }))

  const handleFinish = () => {
    if (!formData.title || !formData.type) {
      toast.error("Title and Type are required")
      return
    }
    
    if (formData.type === 'RCA' && (!formData.target_systems || formData.target_systems.length === 0)) {
      toast.error("Target System Context is required for RCA")
      return
    }
    
    const finalData = {
      ...formData,
      type: safeUpper(formData.type),
      priority: safeUpper(formData.priority),
      status: safeUpper(formData.status || 'ANALYZING')
    }
    onSave(finalData)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-full max-w-xl p-8 rounded-lg border border-blue-500/30 space-y-6">
        {step === 0 ? (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold uppercase text-white tracking-tighter">Initialize Research Flow</h2>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Select the nature of this investigation</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <TypeCard 
                icon={ShieldAlert} 
                title="RCA (Root Cause)" 
                desc="Formal investigation for system failures, outages, or incidents requiring permanent resolution." 
                active={formData.type === 'RCA'}
                color="border-purple-500/50 text-purple-400"
                onClick={() => { setFormData({...formData, type: 'RCA'}); setStep(1); }}
              />
              <TypeCard 
                icon={Search} 
                title="General Research" 
                desc="Investigations regarding system behavior, optimization, or external intel. Not strictly failure-based." 
                active={formData.type === 'RESEARCH'}
                color="border-blue-500/50 text-blue-400"
                onClick={() => { setFormData({...formData, type: 'RESEARCH'}); setStep(1); }}
              />
            </div>
            <button onClick={onClose} className="w-full py-3 text-[10px] font-bold uppercase text-slate-500 hover:text-white transition-all">Abort Initialization</button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-white/5 pb-4">
              <h2 className={`text-xl font-bold uppercase flex items-center gap-3 tracking-tighter ${formData.type === 'RCA' ? 'text-purple-400' : 'text-blue-400'}`}>
                {formData.type === 'RCA' ? <ShieldAlert size={20}/> : <Search size={20}/>} 
                Initialize {formData.type}
              </h2>
              <div className="flex items-center gap-4">
                <button onClick={() => setStep(0)} className="text-[9px] font-bold uppercase text-slate-500 hover:text-white underline tracking-widest">Change Type</button>
                <button onClick={onClose} className="text-[9px] font-bold uppercase text-rose-500 hover:text-rose-400 underline tracking-widest">Abort</button>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5 px-1">Intel Title</label>
                <input 
                  value={formData.title} 
                  onChange={e => setFormData({...formData, title: e.target.value})} 
                  className="w-full bg-slate-950 border border-white/10 rounded-lg px-4 py-3 text-[12px] outline-none focus:border-blue-500 text-white font-bold" 
                  placeholder={formData.type === 'RCA' ? "e.g. Fab-2 line blockage" : "e.g. Cluster latency optimization"} 
                />
              </div>

              <div className="grid grid-cols-2 gap-4 overflow-visible">
                 <SearchableMultiSelect 
                    label="Target System Context"
                    selected={formData.type === 'RCA' ? (formData.target_systems || []) : (formData.systems || [])}
                    onChange={(next: string[]) => setFormData({...formData, [formData.type === 'RCA' ? 'target_systems' : 'systems']: next})}
                    options={systems}
                    placeholder="Identify core systems..."
                    allowCustom={false}
                 />
                 <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase block tracking-widest px-1 mb-1">{formData.type === 'RCA' ? 'Incident Date/Time' : 'Initiation Date/Time'}</label>
                    <input 
                      type="datetime-local" 
                      value={formData.type === 'RCA' ? (formData.occurrence_at?.slice(0, 16) || '') : (formData.initiation_at?.slice(0, 16) || '')} 
                      onChange={e => setFormData({...formData, [formData.type === 'RCA' ? 'occurrence_at' : 'initiation_at']: e.target.value})}
                      className="w-full bg-slate-950 border border-white/10 rounded-lg px-4 py-2.5 text-[11px] outline-none focus:border-blue-500 text-slate-300 font-bold [color-scheme:dark]" 
                    />
                 </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <StyledSelect 
                   label="Incident Type" 
                   value={safeUpper(formData.incident_type)} 
                   onChange={(e: any) => setFormData({...formData, incident_type: e.target.value})} 
                   options={enumOptions('IncidentType')} 
                />
                <PriorityGauge 
                   value={formData.priority} 
                   onChange={(v) => setFormData({...formData, priority: v})} 
                   type={formData.type === 'RCA' ? 'RCA' : 'RESEARCH'}
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5 px-1">Problem Statement / Narrative Goal</label>
                <textarea 
                  value={formData.problem_statement} 
                  onChange={e => setFormData({...formData, problem_statement: e.target.value})} 
                  className="w-full bg-slate-950 border border-white/10 rounded-lg px-4 py-3 text-[11px] outline-none focus:border-blue-500 text-slate-300 min-h-[100px] leading-relaxed font-bold" 
                  placeholder="Describe the context or the problem in detail for easy recall..." 
                />
              </div>
            </div>

            <div className="flex space-x-4 pt-2">
              <button onClick={onClose} className="flex-1 py-3.5 text-[10px] font-bold uppercase text-slate-500 hover:text-white transition-all">Cancel</button>
              <button onClick={handleFinish} className={`flex-[2] py-3.5 ${formData.type === 'RCA' ? 'bg-purple-600 shadow-purple-500/20' : 'bg-blue-600 shadow-blue-500/20'} text-white rounded-lg text-[10px] font-bold uppercase shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 tracking-[0.2em]`}>
                {isSaving ? <RefreshCcw size={16} className="animate-spin" /> : <Zap size={16} />} 
                Launch {formData.type} Flow
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  )
}

function TypeCard({ icon: Icon, title, desc, active, color, onClick }: any) {
  return (
    <button onClick={onClick} className={`p-6 rounded-lg border-2 transition-all text-left flex flex-col gap-4 group ${active ? color + ' bg-white/5 shadow-xl' : 'border-white/5 bg-transparent hover:border-white/10 hover:bg-white/5'}`}>
      <div className={`p-3 rounded-lg bg-white/5 w-fit ${active ? color : 'text-slate-500'}`}><Icon size={24} /></div>
      <div>
        <h3 className={`text-sm font-bold uppercase tracking-tighter mb-1 ${active ? color : 'text-slate-300'}`}>{title}</h3>
        <p className="text-[10px] text-slate-500 font-bold leading-relaxed">{desc}</p>
      </div>
    </button>
  )
}

export function EnhancedRcaDetails({ item, devices, options, failureModes, onClose, onSave, fontSize, rowDensity }: any) {
  // Shared data for sub-components to prevent redundant fetching and lag
  const { data: bkms } = useQuery({ 
    queryKey: ['knowledge', 'bkms'], 
    queryFn: async () => (await apiFetch('/api/v1/knowledge/?category=BKM')).json() 
  })
  const { data: monitoring } = useQuery({ 
    queryKey: ['monitoring-items'], 
    queryFn: async () => (await apiFetch('/api/v1/monitoring/')).json() 
  })

  // Robust normalization for comparison to prevent infinite save loops
  const normalizeForComparison = (data: any) => {
    if (!data) return "";
    const p_map: any = { "LOW": 1, "MEDIUM": 4, "HIGH": 7, "HIGHEST": 10 };
    
    const clean = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) {
        return obj.map(clean).filter(v => v !== undefined);
      }
      const newObj: any = {};
      Object.keys(obj).sort().forEach(key => {
        if (['updated_at', 'created_at', 'id', 'rca_id', 'is_deleted', 'created_by_user_id'].includes(key)) return;
        let val = obj[key];
        
        // Normalize priority
        if (key === 'priority' && typeof val === 'string') val = p_map[val.toUpperCase()] || 1;
        
        // Normalize linked failure modes to IDs only for comparison
        if (key === 'linked_failure_modes' && Array.isArray(val)) {
          newObj['linked_failure_mode_ids'] = val.map((m: any) => typeof m === 'object' ? m.id : m).sort();
          return;
        }
        if (key === 'linked_failure_mode_ids' && Array.isArray(val)) {
          newObj['linked_failure_mode_ids'] = [...val].sort();
          return;
        }

        // Normalize empty values
        if (val === null || val === undefined) return;
        if (Array.isArray(val) && val.length === 0) return;
        
        newObj[key] = clean(val);
      });
      return newObj;
    };
    return JSON.stringify(clean(data));
  };

  const [formData, setFormData] = useState(() => ({
    ...item,
    identification_steps_json: item.identification_steps_json || [],
    rca_steps_json: item.rca_steps_json || [],
    mitigation_logs_json: item.mitigation_logs_json || [],
    linked_failure_mode_ids: item.linked_failure_modes?.map((fm: any) => fm.id) || item.linked_failure_mode_ids || []
  }));

  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState('Timeline')
  const [isFailureModesOpen, setIsFailureModesOpen] = useState(true)
  const [isSystemContextOpen, setIsSystemContextOpen] = useState(false)
  const [isAddingTimelineCollapsed, setIsAddingTimelineCollapsed] = useState(true)
  const [focusedField, setFocusedField] = useState<'evidence' | 'timeline' | 'investigation' | null>(null)
  const [showFailureWizard, setShowFailureWizard] = useState(false)

  // Track server-side changes to prevent redundant syncs
  const prevItemNormalized = useRef(normalizeForComparison(item));
  // Track the state we last successfully saved or received to drive auto-save
  const lastAcknowledgedData = useRef(normalizeForComparison(formData)); // Initial state

  useEffect(() => {
    const incomingNormalized = normalizeForComparison(item);

    // If the server record actually changed, we pull it
    if (incomingNormalized !== prevItemNormalized.current) {
      if (!isEditing) {
        setFormData({ 
          ...item,
          identification_steps_json: item.identification_steps_json || [],
          rca_steps_json: item.rca_steps_json || [],
          mitigation_logs_json: item.mitigation_logs_json || [],
          linked_failure_mode_ids: item.linked_failure_modes?.map((fm: any) => fm.id) || item.linked_failure_mode_ids || []
        });
        // Also update lastAcknowledgedData so we don't immediately auto-save the same data back
        lastAcknowledgedData.current = incomingNormalized;
      }
      prevItemNormalized.current = incomingNormalized;
    }
  }, [item, isEditing]);

  const [editingTimelineId, setEditingTimelineId] = useState<number | null>(null)
  const [editTimelineData, setEditTimelineData] = useState<any>(null)
  const [newTimeline, setNewTimeline] = useState({ 
    event_type: 'OBSERVATION', 
    description: '', 
    event_time: new Date().toISOString().slice(0, 16), 
    owner: '', 
    owner_team: '', 
    images: [], 
    created_at: new Date().toISOString(), 
    updated_at: new Date().toISOString() 
  })
  
  // Click-away logic for focus fields
  useEffect(() => {
    const handleClickAway = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.focus-trigger')) {
        setFocusedField(null)
      }
    }
    document.addEventListener('mousedown', handleClickAway)
    return () => document.removeEventListener('mousedown', handleClickAway)
  }, [])

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const file = items[i].getAsFile()
        if (file) {
          const reader = new FileReader()
          reader.onload = (event: any) => {
            const base64 = event.target.result
            if (focusedField === 'evidence') {
              setFormData((prev: any) => ({ ...prev, evidence_json: [...(prev.evidence_json || []), { type: "image", content: base64, timestamp: new Date().toISOString() }] }));
              toast.success('Evidence Captured')
            } else if (focusedField === 'timeline') {
              setNewTimeline((prev: any) => ({ ...prev, images: [...(prev.images || []), base64] }))
              toast.success('Figure Captured')
            } else if (focusedField === 'investigation' || (focusedField && String(focusedField).startsWith('investigation_'))) {
              const causeId = String(focusedField).startsWith('investigation_') ? parseInt(String(focusedField).split('_')[1]) : null
              window.dispatchEvent(new CustomEvent('investigation-paste', { detail: { base64, causeId } }))
              toast.success('Investigation Figure Captured')
            } else {
              toast.error('Select the Figures/Evidence field to paste images')
            }
          }
          reader.readAsDataURL(file)
        }
      }
    }
  }

  const handleTimelineFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (let i = 0; i < files.length; i++) {
      const reader = new FileReader()
      reader.onload = (event: any) => {
        const base64 = event.target.result
        setNewTimeline((prev: any) => ({ ...prev, images: [...(prev.images || []), base64] }))
      }
      reader.readAsDataURL(files[i])
    }
    toast.success('Figures Queued')
  }

  const handleAddTimeline = () => {
    if (!newTimeline.description.trim()) {
      toast.error("Description required")
      return
    }
    const now = new Date().toISOString()
    const timeline = [...(formData.timeline || []), { 
      ...newTimeline, 
      id: Date.now(), 
      description: newTimeline.description,
      owner: newTimeline.owner,
      owner_team: newTimeline.owner_team,
      event_type: newTimeline.event_type.toUpperCase(),
      created_at: now, 
      updated_at: now 
    }]
    const updated = { ...formData, timeline }
    setFormData(updated)
    setNewTimeline({ 
      event_type: 'OBSERVATION', 
      description: '', 
      event_time: new Date().toISOString().slice(0, 16), 
      owner: '', 
      owner_team: '', 
      images: [], 
      created_at: now, 
      updated_at: now 
    })
    toast.success('Event Synchronized')
  }

  const handleDeleteTimeline = (id: number) => {
    const updated = { ...formData, timeline: (formData.timeline || []).filter((t: any) => t.id !== id) }
    setFormData(updated)
    toast.success('Event Purged')
  }

  const startEditingTimeline = (event: any) => {
    setEditingTimelineId(event.id)
    setEditTimelineData({ ...event })
  }

  const saveTimelineUpdate = () => {
    const timeline = (formData.timeline || []).map((t: any) => 
      t.id === editingTimelineId ? { ...editTimelineData, updated_at: new Date().toISOString() } : t
    )
    const updated = { ...formData, timeline }
    setFormData(updated)
    setEditingTimelineId(null)
    setEditTimelineData(null)
    toast.success('Event Updated')
  }

  const systemsList = useMemo(() => Array.from(new Set(devices?.map((d: any) => d.system) || [])), [devices])
  const filteredAssets = useMemo(() => {
    const activeSystems = formData.target_systems || []
    return devices?.filter((d: any) => activeSystems.includes(d.system)) || []
  }, [devices, formData.target_systems])
  
  const filteredServices = useMemo(() => {
    const assetIds = formData.impacted_asset_ids || []
    return devices?.filter((d: any) => assetIds.includes(d.id)).flatMap((d: any) => d.logical_services || []) || []
  }, [devices, formData.impacted_asset_ids])

  const filteredFailureModes = useMemo(() => {
    if (!failureModes) return []
    const activeSystems = formData.target_systems || []
    const activeAssetIds = formData.impacted_asset_ids || []
    
    return failureModes.filter((fm: any) => {
      const fmSystem = fm.system_name || fm.system
      const fmAssetIds = fm.affected_assets?.map((a: any) => a.id) || []
      
      if (activeAssetIds.length > 0) {
        return activeAssetIds.some(id => fmAssetIds.includes(id))
      }
      if (activeSystems.length > 0) {
        return activeSystems.includes(fmSystem)
      }
      return true
    })
  }, [failureModes, formData.target_systems, formData.impacted_asset_ids])

  const handleTargetSystemsChange = (nextSystems: string[]) => {
    // Dependency Guard: Check if removing a system that has linked failure modes
    const removedSystems = (formData.target_systems || []).filter(s => !nextSystems.includes(s))
    if (removedSystems.length > 0) {
      const activeFMs = (failureModes || []).filter((fm: any) => (formData.linked_failure_mode_ids || []).includes(fm.id))
      const problematicSystems = removedSystems.filter(sys => 
        activeFMs.some((fm: any) => (fm.system_name || fm.system) === sys)
      )
      
      if (problematicSystems.length > 0) {
        const fmNames = activeFMs
          .filter((fm: any) => problematicSystems.includes(fm.system_name || fm.system))
          .map((fm: any) => fm.title)
          .join(', ')
        toast.error(`DEPENDENCY BLOCK: Cannot remove ${problematicSystems.join(', ')}. Linked Failure Modes: ${fmNames}`, { duration: 5000, id: 'dep-guard' })
        return
      }
    }
    
    setFormData({
      ...formData, 
      target_systems: nextSystems, 
      impacted_asset_ids: [], 
      impacted_service_ids: [], 
      linked_failure_mode_ids: []
    })
  }

  // Analytics Calculation
  const timelineStats = useMemo(() => {
    const events = [...(formData.timeline || [])].sort((a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime())
    if (events.length === 0) return null
    const start = new Date(events[0].event_time)
    const end = new Date(events[events.length - 1].event_time)
    const diff = end.getTime() - start.getTime()
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    
    return {
      start: start.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      end: end.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      duration: `${days}D ${hours}H ${minutes}M`
    }
  }, [formData.timeline])

  // Auto-save logic with debounce/stability
  const saveTimeout = useRef<any>(null);
  useEffect(() => {
    if (isEditing) return;
    
    const currentNormalized = normalizeForComparison(formData);
    if (currentNormalized !== lastAcknowledgedData.current) {
        if (saveTimeout.current) clearTimeout(saveTimeout.current);
        saveTimeout.current = setTimeout(() => {
           onSave({ 
             ...formData, 
             linked_failure_modes: (formData.linked_failure_mode_ids || []).map((id: number) => ({ id })) 
           });
           lastAcknowledgedData.current = currentNormalized;
        }, 1000);
    }
    return () => { if (saveTimeout.current) clearTimeout(saveTimeout.current); }
  }, [isEditing, formData, onSave]);

  const pInfo = getPriorityInfo(formData.priority)
  const enumOptions = (cat: string) => (options || []).filter((o: any) => o.category === cat).map((o: any) => ({ value: o.value.toUpperCase(), label: o.label.toUpperCase() }))

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/95 backdrop-blur-xl p-4" onPaste={handlePaste}>
      <motion.div initial={{ scale: 0.98, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-full max-w-[1750px] h-full rounded-lg border border-purple-500/20 overflow-hidden flex flex-col shadow-[0_0_100px_rgba(168,85,247,0.1)]">
        
        {/* Header Block */}
        <div className="px-8 py-4 border-b border-white/5 bg-white/5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 bg-purple-600/20 rounded-lg flex items-center justify-center text-purple-400 border border-purple-500/30 shadow-inner text-xl font-bold tracking-tighter">RCA</div>
            <div>
              <div className="flex items-center space-x-4 mb-1.5">
                <div className="flex items-center gap-2">
                   <div className={`px-3 py-1 rounded-lg border text-[10px] font-bold uppercase ${pInfo.color}`}>{safeUpper(formData.status)}</div>
                   <div className={`px-3 py-1 rounded-lg border text-[10px] font-bold uppercase ${pInfo.color}`}>PRIORITY: {pInfo.label}</div>
                   <div className="flex items-center gap-4 ml-4 pl-4 border-l border-white/10">
                      <div className="flex flex-col">
                         <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Record Created</span>
                         <span className="text-[10px] font-bold text-blue-400">{formData.created_at ? formatAppDate(formData.created_at) : 'N/A'}</span>
                      </div>
                      <div className="flex flex-col">
                         <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Last Synchronized</span>
                         <span className="text-[10px] font-bold text-emerald-400">{formData.updated_at ? formatAppDate(formData.updated_at) : 'N/A'}</span>
                      </div>
                   </div>
                </div>
              </div>
              <h1 className="text-3xl font-bold uppercase tracking-tighter text-white leading-none">{formData.title}</h1>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => {
                if (isEditing) {
                  const currentNormalized = normalizeForComparison(formData);
                  onSave({ ...formData, linked_failure_modes: (formData.linked_failure_mode_ids || []).map((id: number) => ({ id })) })
                  lastAcknowledgedData.current = currentNormalized;
                }
                setIsEditing(!isEditing)
              }}
              className={`h-12 px-8 rounded-lg text-[11px] font-bold uppercase tracking-[0.2em] transition-all flex items-center gap-2 ${isEditing ? 'bg-amber-600 text-white shadow-lg shadow-amber-500/30 border-amber-400' : 'bg-white/5 text-slate-400 border border-white/10 hover:text-white hover:border-white/20'}`}
            >
              {isEditing ? <Check size={14}/> : <Edit2 size={14}/>} {isEditing ? 'Confirm Changes' : 'Enter Edit Mode'}
            </button>
            <button 
              onClick={onClose} 
              className="w-12 h-12 flex items-center justify-center bg-white/5 border border-white/10 rounded-lg text-slate-500 hover:text-white transition-all"
            >
              <X size={24}/>
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Analytical Pane (Left) */}
          <div className="w-[500px] border-r border-white/5 bg-black/20 overflow-y-auto custom-scrollbar overscroll-contain p-6 space-y-4 relative z-20">
             
             {/* 1. Overview Section */}
             <SectionCard icon={Info} title="Overview" color="text-blue-400">
                <div className="space-y-4">
                   <div className={!isEditing ? 'pointer-events-none opacity-80' : ''}>
                      <SearchableMultiSelect 
                         label="Owners" 
                         selected={formData.owners || []} 
                         onChange={(next: string[]) => setFormData({...formData, owners: next})} 
                         options={['Infrastructure Team', 'SRE', 'DevOps', 'App Support']} 
                         placeholder="Add Owners..." 
                         allowCustom={true}
                      />
                   </div>
                   
                   <div className="grid grid-cols-2 gap-4">
                      <StyledSelect 
                         label="Incident Type" 
                         value={safeUpper(formData.incident_type)} 
                         onChange={(e: any) => setFormData({...formData, incident_type: e.target.value})} 
                         options={enumOptions('IncidentType')} 
                         disabled={!isEditing}
                      />
                      <div>
                         <label className="text-[9px] font-bold text-slate-500 uppercase block tracking-widest px-1 mb-1">Incident Datetime</label>
                         <input 
                           type="datetime-local" 
                           readOnly={!isEditing}
                           value={formData.occurrence_at?.slice(0, 16) || ''} 
                           onChange={e => setFormData({...formData, occurrence_at: e.target.value})}
                           className="w-full bg-slate-950 border border-white/10 rounded-lg px-4 py-2 text-[11px] outline-none focus:border-blue-500 text-slate-300 font-bold [color-scheme:dark]" 
                         />
                      </div>
                   </div>

                   <div className="grid grid-cols-2 gap-4">
                      <StyledSelect 
                         label="Detection Type" 
                         value={safeUpper(formData.detection_type)} 
                         onChange={(e: any) => setFormData({...formData, detection_type: e.target.value})} 
                         options={enumOptions('DetectionType')} 
                         disabled={!isEditing}
                      />
                      <div>
                         <label className="text-[9px] font-bold text-slate-500 uppercase block tracking-widest px-1 mb-1">Detection Datetime</label>
                         <input 
                           type="datetime-local" 
                           readOnly={!isEditing}
                           value={formData.detection_at?.slice(0, 16) || ''} 
                           onChange={e => setFormData({...formData, detection_at: e.target.value})}
                           className="w-full bg-slate-950 border border-white/10 rounded-lg px-4 py-2 text-[11px] outline-none focus:border-blue-500 text-slate-300 font-bold [color-scheme:dark]" 
                         />
                      </div>
                   </div>

                   <div className="space-y-4">
                      <PriorityGauge 
                        value={formData.priority} 
                        onChange={(v) => setFormData({...formData, priority: v})} 
                        disabled={!isEditing} 
                        type="RCA"
                      />
                      <StyledSelect 
                        label="Status"
                        value={safeUpper(formData.status)} 
                        onChange={(e: any) => setFormData({...formData, status: e.target.value})} 
                        options={['ANALYZING', 'OPEN', 'INVESTIGATION', 'RESOLVED', 'CLOSED', 'ESCALATED'].map(s => ({value: s, label: s}))} 
                        disabled={!isEditing}
                      />
                   </div>                </div>
             </SectionCard>

             {/* 2. System Context (Swapped with Problem Statement) */}
             <div className="bg-white/5 border border-white/5 rounded-lg overflow-visible transition-all">
                <button 
                   onClick={() => setIsSystemContextOpen(!isSystemContextOpen)}
                   className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-all border-b border-white/5"
                >
                   <div className="flex items-center gap-2">
                      <Database size={14} className="text-amber-400" />
                      <h3 className="text-[11px] font-bold uppercase tracking-widest text-white/70">System Context</h3>
                   </div>
                   <div className="flex items-center gap-4">
                      {!isSystemContextOpen && (formData.target_systems || []).length > 0 && (
                         <div className="flex gap-1 overflow-hidden max-w-[150px]">
                            {(formData.target_systems || []).map((s: string) => (
                               <span key={s} className="text-[8px] font-bold text-amber-500/60 uppercase whitespace-nowrap">{s}</span>
                            ))}
                         </div>
                      )}
                      <ChevronDown size={14} className={`text-slate-500 transition-transform ${isSystemContextOpen ? 'rotate-180' : ''}`} />
                   </div>
                </button>
                <AnimatePresence>
                   {isSystemContextOpen && (
                      <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-visible bg-black/20 p-4 space-y-4">
                         <div className={!isEditing ? 'pointer-events-none opacity-80' : ''}>
                           <SearchableMultiSelect 
                              label="Target System(s)" 
                              selected={formData.target_systems || []} 
                              onChange={handleTargetSystemsChange} 
                              options={systemsList} 
                              placeholder="Select Systems..." 
                              allowCustom={false}
                           />
                         </div>
                         <div className="space-y-4">
                            <div>
                               <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Impacted Assets</label>
                               <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto custom-scrollbar pr-1">
                                  {filteredAssets.map((a: any) => (
                                    <label key={a.id} className={`flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/5 transition-all text-[10px] font-bold uppercase ${formData.impacted_asset_ids?.includes(a.id) ? 'text-amber-400' : 'text-slate-500'}`}>
                                       <input type="checkbox" disabled={!isEditing} checked={formData.impacted_asset_ids?.includes(a.id)} onChange={e => {
                                         const ids = formData.impacted_asset_ids || []
                                         setFormData({...formData, impacted_asset_ids: e.target.checked ? [...ids, a.id] : ids.filter((i:any)=>i!==a.id), linked_failure_mode_ids: []})
                                       }} className="sr-only" />
                                       <div className={`w-2 h-2 rounded-full border ${formData.impacted_asset_ids?.includes(a.id) ? 'bg-amber-500 border-amber-500' : 'border-white/20'}`} />
                                       <span className="truncate">{a.name}</span>
                                    </label>
                                  ))}
                               </div>
                            </div>
                            <div>
                               <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Impacted Services</label>
                               <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto custom-scrollbar pr-1">
                                  {filteredServices.map((s: any) => (
                                    <label key={s.id} className={`flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/5 transition-all text-[10px] font-bold uppercase ${formData.impacted_service_ids?.includes(s.id) ? 'text-indigo-400' : 'text-slate-500'}`}>
                                       <input type="checkbox" disabled={!isEditing} checked={formData.impacted_service_ids?.includes(s.id)} onChange={e => {
                                         const ids = formData.impacted_service_ids || []
                                         setFormData({...formData, impacted_service_ids: e.target.checked ? [...ids, s.id] : ids.filter((i:any)=>i!==s.id)})
                                       }} className="sr-only" />
                                       <div className={`w-2 h-2 rounded-full border ${formData.impacted_service_ids?.includes(s.id) ? 'bg-indigo-500 border-indigo-500' : 'border-white/20'}`} />
                                       <span className="truncate">{s.name}</span>
                                    </label>
                                  ))}
                               </div>
                            </div>
                         </div>
                      </motion.div>
                   )}
                </AnimatePresence>
             </div>

             {/* 3. Problem Statement */}
             <SectionCard icon={FileText} title="Problem Statement" color="text-slate-400">
                <div className="space-y-4">
                   <textarea 
                     readOnly={!isEditing}
                     value={formData.problem_statement} 
                     onChange={e => setFormData({...formData, problem_statement: e.target.value})} 
                     className={`w-full bg-slate-950 border border-white/5 rounded-lg p-4 text-xs font-bold text-slate-300 outline-none min-h-[100px] resize-none ${!isEditing && 'cursor-default opacity-80'}`} 
                     placeholder="Describe the problem..."
                   />
                   
                   <div className="bg-white/5 border border-white/5 rounded-lg overflow-visible transition-all shadow-inner">
                      <button 
                         onClick={() => setIsFailureModesOpen(!isFailureModesOpen)}
                         className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-white/5 transition-all border-b border-white/5"
                      >
                         <div className="flex items-center gap-2">
                            <Layers size={14} className="text-purple-400" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-white/70">Linked Failure Modes (FAR)</span>
                         </div>
                         <div className="flex items-center gap-3">
                            <div className="px-2 py-0.5 rounded-lg bg-purple-500/20 border border-purple-500/30 text-[9px] font-bold text-purple-400">{(formData.linked_failure_mode_ids || []).length} VECTORS</div>
                            <ChevronDown size={14} className={`text-slate-500 transition-transform ${isFailureModesOpen ? 'rotate-180' : ''}`} />
                         </div>
                      </button>
                      <AnimatePresence>
                         {isFailureModesOpen && (
                            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-visible bg-black/40 p-5 space-y-4">
                               {isEditing && (
                                  <div className="flex flex-col gap-3">
                                     <button 
                                        onClick={() => setShowFailureWizard(true)}
                                        className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-[10px] font-bold uppercase tracking-[0.2em] shadow-lg shadow-purple-600/20 active:scale-95 transition-all flex items-center justify-center gap-2 border border-purple-400/30"
                                     >
                                        <PlusCircle size={14} /> Link New Failure Mode Vector
                                     </button>
                                     <div className="flex items-center gap-2 px-1">
                                        <div className="h-px flex-1 bg-white/5" />
                                        <span className="text-[8px] font-bold text-slate-600 uppercase">Or Select Existing</span>
                                        <div className="h-px flex-1 bg-white/5" />
                                     </div>
                                     <SearchableMultiSelect 
                                        selected={formData.linked_failure_mode_ids || []} 
                                        onChange={(next: number[]) => setFormData({...formData, linked_failure_mode_ids: next})} 
                                        options={filteredFailureModes.map((fm: any) => ({ value: fm.id, label: `${fm.title} [${fm.system_name || fm.system}]` }))} 
                                        placeholder="Search failure modes..." 
                                        allowCustom={false}
                                     />
                                  </div>
                               )}
                               <div className="overflow-visible">
                                  <table className="w-full text-left border-collapse">
                                     <thead>
                                        <tr className="border-b border-white/10">
                                           <th className="text-[8px] font-bold uppercase text-slate-500 py-2 px-2">Failure Mode</th>
                                           <th className="text-[8px] font-bold uppercase text-slate-500 py-2 px-2">System</th>
                                           <th className="text-[8px] font-bold uppercase text-slate-500 py-2 px-2">Server</th>
                                           <th className="text-[8px] font-bold uppercase text-slate-500 py-2 px-2 text-right">Delete</th>
                                        </tr>
                                     </thead>
                                     <tbody>
                                        {(failureModes || []).filter((fm: any) => (formData.linked_failure_mode_ids || []).includes(fm.id)).map((fm: any) => (
                                           <tr key={fm.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                              <td className="py-2 px-2">
                                                 <div className="text-[9px] font-bold uppercase text-purple-400 truncate max-w-[150px]">{fm.title}</div>
                                              </td>
                                              <td className="py-2 px-2">
                                                 <div className="text-[9px] font-bold uppercase text-slate-400">{fm.system_name || fm.system}</div>
                                              </td>
                                              <td className="py-2 px-2">
                                                 <div className="group relative cursor-help inline-block">
                                                    <div className="text-[9px] font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-lg border border-amber-500/20">{(fm.affected_assets || []).length}</div>
                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-[10000] pointer-events-none">
                                                       <div className="bg-slate-900 border border-white/20 rounded-lg p-3 shadow-2xl min-w-[250px] max-w-[400px]">
                                                          <p className="text-[9px] font-bold uppercase text-slate-500 mb-2 border-b border-white/5 pb-1">Impacted Assets</p>
                                                          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                                             {(fm.affected_assets || []).map((a: any) => (
                                                                <div key={a.id} className="text-[8px] font-bold text-slate-300 uppercase py-0.5 truncate">• {a.name}</div>
                                                             ))}
                                                          </div>
                                                          {(fm.affected_assets || []).length === 0 && <div className="text-[8px] font-bold text-slate-600">No assets linked</div>}
                                                       </div>
                                                    </div>
                                                 </div>
                                              </td>
                                              <td className="py-2 px-2 text-right">
                                                 {isEditing && (
                                                    <button 
                                                      onClick={() => {
                                                        const m = fm.metadata_json || {}
                                                        const hasWork = (m.status_cause && m.status_cause !== 'NOT_STARTED') || 
                                                                        (m.status_workaround && m.status_workaround !== 'NOT_STARTED') || 
                                                                        (m.status_monitoring && m.status_monitoring !== 'NOT_STARTED') || 
                                                                        (m.status_prevention && m.status_prevention !== 'NOT_STARTED');
                                                        if (hasWork) {
                                                           toast.error("DATA LOSS PREVENTION: Resolution work detected. Purge resolution entries in FAR module before unlinking.", { duration: 4000 });
                                                           return;
                                                        }
                                                        setFormData({...formData, linked_failure_mode_ids: formData.linked_failure_mode_ids.filter((id:number)=>id!==fm.id)})
                                                      }} 
                                                      className="text-rose-500 hover:text-rose-300 transition-all p-1 hover:bg-rose-500/10 rounded-lg"
                                                    >
                                                       <Trash2 size={12}/>
                                                    </button>
                                                 )}
                                              </td>
                                           </tr>
                                        ))}
                                        {(formData.linked_failure_mode_ids || []).length === 0 && (
                                           <tr>
                                              <td colSpan={4} className="py-8 text-center text-[9px] font-bold uppercase text-slate-600">No linked failure modes</td>
                                           </tr>
                                        )}
                                     </tbody>
                                  </table>
                               </div>
                            </motion.div>
                         )}
                      </AnimatePresence>
                   </div>
                </div>
             </SectionCard>

             {/* 4. Operational Impact */}
             <SectionCard icon={ShieldAlert} title="Operational Impact" color="text-rose-400">
                <div className="space-y-4">
                   <StyledSelect 
                      label="Impact Type" 
                      value={safeUpper(formData.impact_type)} 
                      onChange={(e: any) => setFormData({...formData, impact_type: e.target.value})} 
                      options={enumOptions('ImpactType')} 
                      disabled={!isEditing}
                   />
                   <div>
                      <label className="text-[9px] font-bold text-slate-500 uppercase block tracking-widest px-1 mb-1">Impact Narrative</label>
                      <textarea 
                        readOnly={!isEditing}
                        value={formData.impact_description} 
                        onChange={e => setFormData({...formData, impact_description: e.target.value})} 
                        className="w-full bg-slate-950 border border-white/5 rounded-lg p-4 text-xs font-bold text-slate-300 outline-none min-h-[100px] resize-none" 
                        placeholder="Describe the operational impact..." 
                      />
                   </div>
                </div>
             </SectionCard>

             {/* 5. Evidence Section */}
             <SectionCard icon={Camera} title="Evidence" color="text-blue-400">
                <div 
                   onClick={(e) => { e.stopPropagation(); setFocusedField('evidence'); }}
                   className={`grid grid-cols-3 gap-2 max-h-64 overflow-y-auto custom-scrollbar pr-1 p-2 rounded-lg transition-all border-2 focus-trigger ${focusedField === 'evidence' ? 'border-blue-500/50 bg-blue-500/5 shadow-[0_0_20px_rgba(59,130,246,0.1)]' : 'border-transparent'}`}
                >
                   {(formData.evidence_json || []).map((ev: any, i: number) => (
                      <div key={i} className="relative aspect-square bg-slate-950 border border-white/10 rounded-lg overflow-hidden group shadow-xl">
                         <img src={ev.content} className="w-full h-full object-cover" />
                         <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                            <button onClick={(e) => { 
                               e.stopPropagation(); 
                               const nextEvidence = formData.evidence_json.filter((_:any,idx:number)=>idx!==i);
                               setFormData({...formData, evidence_json: nextEvidence});
                            }} className="p-1.5 bg-rose-600 text-white rounded-lg hover:bg-rose-500 transition-colors shadow-lg"><Trash2 size={12}/></button>
                         </div>
                      </div>
                   ))}
                   {(formData.evidence_json || []).length === 0 && (
                      <div className="col-span-3 aspect-video bg-white/5 border border-dashed border-white/10 rounded-lg flex items-center justify-center text-slate-600 transition-all relative">
                         <div className="text-[8px] font-black uppercase tracking-widest text-center">
                            SELECT THIS SECTION<br/>THEN CTRL+V TO PASTE EVIDENCE
                         </div>
                      </div>
                   )}
                </div>
                {focusedField === 'evidence' && <p className="text-[8px] font-bold uppercase text-blue-400 text-center animate-pulse mt-2">Ready to paste evidence...</p>}
             </SectionCard>
          </div>

          {/* Right Pane with Tabs */}
          <div className="flex-1 flex flex-col bg-[#020617]/30 overflow-visible">
             {/* Navigation Tabs */}
             <div className="flex bg-white/5 border-b border-white/5 p-1 gap-1 shrink-0">
                {['Timeline', 'Investigation'].map(tab => (
                   <button
                     key={tab}
                     onClick={() => setActiveTab(tab)}
                     className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-[0.2em] transition-all rounded-lg ${activeTab === tab ? 'bg-purple-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                   >
                      {tab === 'Timeline' && <History size={14} className="inline mr-2" />}
                      {tab === 'Investigation' && <Search size={14} className="inline mr-2" />}
                      {tab}
                   </button>
                ))}
             </div>

             <div className="flex-1 overflow-hidden flex flex-col">
                {activeTab === 'Timeline' && (
                  <div className="flex-1 flex flex-col overflow-hidden p-6 gap-6">
                    <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden shrink-0 shadow-xl">
                      <button 
                        onClick={() => setIsAddingTimelineCollapsed(!isAddingTimelineCollapsed)}
                        className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/5 transition-all border-b border-white/5"
                      >
                         <div className="flex items-center gap-3">
                            <Plus size={16} className="text-purple-400" />
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-white">Capture Forensic Milestone</h3>
                         </div>
                         <ChevronDown size={16} className={`text-slate-500 transition-transform ${!isAddingTimelineCollapsed ? 'rotate-180' : ''}`} />
                      </button>
                      <AnimatePresence>
                         {!isAddingTimelineCollapsed && (
                            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden p-6 space-y-4">
                               <div className="grid grid-cols-2 gap-4">
                                  <div className="space-y-1">
                                     <label className="text-[9px] font-bold text-slate-500 uppercase">Occurrence At</label>
                                     <input type="datetime-local" value={newTimeline.event_time} onChange={e => setNewTimeline({...newTimeline, event_time: e.target.value})} className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] font-bold text-white outline-none focus:border-purple-500/50" />
                                  </div>
                                  <div className="space-y-1">
                                     <label className="text-[9px] font-bold text-slate-500 uppercase">Event Type</label>
                                     <StyledSelect options={[{value:'DETECTION',label:'DETECTION'},{value:'MITIGATION',label:'MITIGATION'},{value:'OBSERVATION',label:'OBSERVATION'},{value:'RESOLUTION',label:'RESOLUTION'}]} value={newTimeline.event_type} onChange={(e:any) => setNewTimeline({...newTimeline, event_type: e.target.value})} />
                                  </div>
                               </div>
                               <div className="grid grid-cols-2 gap-4">
                                  <div className="space-y-1">
                                     <label className="text-[9px] font-bold text-slate-500 uppercase">Owner / Reporter</label>
                                     <input value={newTimeline.owner} onChange={e => setNewTimeline({...newTimeline, owner: e.target.value})} placeholder="e.g. J. Doe" className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] font-bold text-white outline-none focus:border-purple-500/50" />
                                  </div>
                                  <div className="space-y-1">
                                     <label className="text-[9px] font-bold text-slate-500 uppercase">Responsible Team</label>
                                     <input value={newTimeline.owner_team} onChange={e => setNewTimeline({...newTimeline, owner_team: e.target.value})} placeholder="e.g. SRE" className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] font-bold text-white outline-none focus:border-purple-500/50" />
                                  </div>
                               </div>
                               <div className="space-y-1">
                                  <label className="text-[9px] font-bold text-slate-500 uppercase">description</label>
                                  <textarea 
                                    value={newTimeline.description} 
                                    onChange={e => setNewTimeline({...newTimeline, description: e.target.value})} 
                                    className="w-full bg-slate-950 border border-white/10 rounded-lg p-4 text-[12px] font-bold text-white outline-none focus:border-purple-500/50 min-h-[80px]" 
                                    placeholder="Event description..." 
                                  />
                               </div>

                               <div className="space-y-2">
                                  <div className="flex items-center justify-between px-1">
                                     <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Figures / Evidence</label>
                                  </div>
                                  <div 
                                     onClick={(e) => { e.stopPropagation(); setFocusedField('timeline'); }}
                                     className={`flex gap-2 overflow-x-auto pb-1 scrollbar-hide focus-trigger p-2 border-2 rounded-lg transition-all min-h-[80px] ${focusedField === 'timeline' ? 'border-purple-500/50 bg-purple-500/5 shadow-[0_0_20px_rgba(168,85,247,0.1)]' : 'border-white/5 bg-slate-950'}`}
                                  >
                                     {(newTimeline.images || []).map((img: string, i: number) => (
                                        <div key={i} className="relative w-16 h-16 shrink-0 rounded-lg border border-white/10 overflow-hidden group">
                                           <img src={img} className="w-full h-full object-cover" />
                                           <button onClick={() => setNewTimeline({...newTimeline, images: newTimeline.images.filter((_, idx) => idx !== i)})} className="absolute top-1 right-1 bg-rose-600 text-white p-1 rounded-lg opacity-0 group-hover:opacity-100"><X size={10}/></button>
                                        </div>
                                     ))}
                                     {(newTimeline.images || []).length === 0 && (
                                        <div className="w-full flex items-center justify-center text-[8px] font-black text-slate-700 uppercase tracking-widest">
                                           SELECT THIS CONTAINER THEN CTRL+V TO PASTE FIGURES
                                        </div>
                                     )}
                                  </div>
                               </div>

                               <button onClick={handleAddTimeline} className="h-12 w-full bg-purple-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all">Commit Milestone</button>
                            </motion.div>
                         )}
                      </AnimatePresence>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6 pr-2 pb-10 relative">
                       {/* Vertical Line */}
                       <div className="absolute left-[87px] top-6 bottom-10 w-px bg-gradient-to-b from-purple-500/50 via-white/10 to-transparent" />

                       {(formData.timeline || []).sort((a: any, b: any) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime()).map((item: any, idx: number) => (
                          <div key={item.id || idx} className="relative flex gap-8 group">
                             {/* Timeline Node */}
                             <div className="flex flex-col items-center shrink-0 w-20 relative">
                                <div className="text-[10px] font-black text-white">{new Date(item.event_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                <div className="text-[8px] font-bold text-slate-500 uppercase mt-0.5">{new Date(item.event_time).toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>
                                
                                {/* The Dot */}
                                <div className={`absolute left-[80px] top-1.5 w-4 h-4 rounded-lg border-2 border-[#020617] z-10 shadow-lg ${
                                    item.event_type === 'RESOLUTION' ? 'bg-emerald-500 shadow-emerald-500/20' :
                                    item.event_type === 'MITIGATION' ? 'bg-amber-500 shadow-amber-500/20' :
                                    'bg-purple-500 shadow-purple-500/20'
                                }`} />
                             </div>

                             <div className="flex-1 bg-white/5 border border-white/10 rounded-lg p-5 flex flex-col gap-4 group hover:bg-white/[0.08] transition-all shadow-xl">
                                {editingTimelineId === item.id ? (
                                   <div className="space-y-4">
                                      <div className="grid grid-cols-2 gap-4">
                                         <input type="datetime-local" value={editTimelineData.event_time} onChange={e => setEditTimelineData({...editTimelineData, event_time: e.target.value})} className="bg-slate-950 border border-white/10 rounded-lg px-2 py-1 text-[10px] font-bold text-white outline-none" />
                                         <StyledSelect options={[{value:'DETECTION',label:'DETECTION'},{value:'MITIGATION',label:'MITIGATION'},{value:'OBSERVATION',label:'OBSERVATION'},{value:'RESOLUTION',label:'RESOLUTION'}]} value={editTimelineData.event_type} onChange={(e:any) => setEditTimelineData({...editTimelineData, event_type: e.target.value})} />
                                      </div>
                                      <textarea value={editTimelineData.description} onChange={e => setEditTimelineData({...editTimelineData, description: e.target.value})} className="w-full bg-slate-950 border border-white/10 rounded-lg p-2 text-[11px] font-bold text-white outline-none min-h-[60px]" />
                                      <div className="flex gap-2">
                                         <button onClick={saveTimelineUpdate} className="flex-1 py-2 bg-purple-600 text-white rounded-lg text-[9px] font-bold uppercase">Save</button>
                                         <button onClick={() => setEditingTimelineId(null)} className="flex-1 py-2 bg-white/5 text-slate-400 rounded-lg text-[9px] font-bold uppercase">Cancel</button>
                                      </div>
                                   </div>
                                ) : (
                                   <>
                                      <div className="flex items-start justify-between">
                                         <div className="space-y-2">
                                            <div className="flex items-center gap-2 flex-wrap">
                                               <p className="text-[12px] font-black text-slate-200 uppercase leading-relaxed tracking-tight">{item.description}</p>
                                               {item.owner && <span className="text-[9px] font-black text-purple-400/60 uppercase">@ {item.owner}</span>}
                                            </div>
                                            <div className="flex items-center gap-2">
                                               <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-lg border ${
                                                  item.event_type === 'RESOLUTION' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' :
                                                  item.event_type === 'MITIGATION' ? 'text-amber-400 border-amber-500/30 bg-amber-500/10' :
                                                  'text-blue-400 border-blue-500/30 bg-blue-500/10'
                                               }`}>{item.event_type}</span>
                                               {item.owner_team && <span className="text-[8px] font-bold text-slate-600 uppercase tracking-widest">[{item.owner_team}]</span>}
                                            </div>
                                         </div>
                                         <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                            <button onClick={() => startEditingTimeline(item)} className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-all"><Edit2 size={14}/></button>
                                            <button onClick={() => handleDeleteTimeline(item.id)} className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all"><Trash2 size={14}/></button>
                                         </div>
                                      </div>
                                      {item.images?.length > 0 && (
                                         <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                                            {item.images.map((img: string, i: number) => <ImageThumbnail key={i} src={img} />)}
                                         </div>
                                      )}
                                   </>
                                )}
                             </div>
                          </div>
                       ))}
                    </div>
                  </div>
                )}

                                   {activeTab === 'Investigation' && (
                                      <InvestigationTab 
                                         formData={formData} 
                                         setFormData={setFormData} 
                                         failureModes={failureModes} 
                                         setFocusedField={setFocusedField} 
                                         focusedField={focusedField} 
                                         options={options} 
                                         isEditing={true} // FORCE AUTO-EDIT
                                         onSave={onSave} 
                                         bkms={bkms}
                                         monitoring={monitoring}
                                      />
                                   )}

                                   {activeTab === 'Mitigation' && (
                                      <MitigationTab formData={formData} setFormData={setFormData} isEditing={true} />
                                   )}
                                         </div>          </div>
                                         </div>

                                         <AnimatePresence>
                                         {showFailureWizard && (
                                         <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/90 backdrop-blur-xl p-10">
                                         <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="glass-panel w-full max-w-6xl h-[85vh] flex flex-col rounded-lg border border-rose-500/20 overflow-hidden shadow-2xl">
                                         <div className="px-8 py-6 border-b border-white/5 bg-white/5 flex items-start justify-between shrink-0">
                                         <div>
                                         <h1 className="text-3xl font-bold uppercase tracking-tighter text-white">Direct Risk Entry</h1>
                                         <p className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.3em]">Synched to RCA Context // Logical Discrepancy Guard Active</p>
                                         </div>
                                         <button onClick={() => setShowFailureWizard(false)} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-slate-500 hover:text-white transition-all"><X size={20}/></button>
                                         </div>
                                         <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
                                         <SimplifiedFailureWizard 
                                         restrictedSystems={formData.target_systems || []}
                                         onComplete={(newFM: any) => {
                                         setShowFailureWizard(false);
                                         // Auto-link the new failure mode
                                         setFormData((prev: any) => ({
                                         ...prev,
                                         linked_failure_mode_ids: [...(prev.linked_failure_mode_ids || []), newFM.id]
                                         }));
                                         toast.success(`Vector ${newFM.title} Linked to RCA`);
                                         onSave({ ...formData, linked_failure_mode_ids: [...(formData.linked_failure_mode_ids || []), newFM.id] });
                                         }} 
                                         />
                                         </div>
                                         </motion.div>
                                         </div>
                                         )}
                                         </AnimatePresence>
                                         </motion.div>
                                         </div>
                                         )
                                         }

                                         function SimplifiedFailureWizard({ restrictedSystems, onComplete }: any) {
                                         const [formData, setFormData] = useState<any>({ 
                                         system_name: restrictedSystems[0] || '', 
                                         failure_type: 'Software',
                                         title: '', 
                                         effect: '', 
                                         severity: 1, 
                                         occurrence: 1, 
                                         detection: 1, 
                                         affected_assets: []
                                         })

                                         const queryClient = useQueryClient()
                                         const { data: devices } = useQuery({ queryKey: ['devices', formData.system_name], enabled: !!formData.system_name, queryFn: async () => (await apiFetch(`/api/v1/devices/?system=${encodeURIComponent(formData.system_name)}`)).json() })

                                         const mutation = useMutation({ 
                                         mutationFn: async (data: any) => {
                                         const res = await apiFetch('/api/v1/far/modes', { method: 'POST', body: JSON.stringify(data) })
                                         return res.json()
                                         }, 
                                         onSuccess: (newFM) => { 
                                         queryClient.invalidateQueries({ queryKey: ['far-failure-modes'] });
                                         onComplete(newFM); 
                                         } 
                                         })

                                         const rpn = formData.severity * formData.occurrence * formData.detection

                                         return (
                                         <div className="grid grid-cols-12 gap-6 font-bold uppercase tracking-tight">
                                         <div className="col-span-6 space-y-4">
                                         <div className="grid grid-cols-2 gap-4">
                                         <div className="space-y-1">
                                         <label className="text-[9px] font-bold text-slate-500 ">Restricted System Context *</label>
                                         <StyledSelect 
                                         options={restrictedSystems.map((s: string) => ({ label: s, value: s }))} 
                                         value={formData.system_name} 
                                         onChange={e => setFormData({ ...formData, system_name: e.target.value })} 
                                         />
                                         </div>
                                         <div className="space-y-1">
                                         <label className="text-[9px] font-bold text-slate-500 ">Failure Type *</label>
                                         <StyledSelect 
                                         options={[
                                         { value: 'Software', label: 'Software' },
                                         { value: 'Hardware', label: 'Hardware' },
                                         { value: 'Network', label: 'Network' },
                                         { value: 'Process', label: 'Process' }
                                         ]} 
                                         value={formData.failure_type} 
                                         onChange={e => setFormData({ ...formData, failure_type: e.target.value })} 
                                         />
                                         </div>
                                         </div>
                                         <div className="space-y-1">
                                         <label className="text-[9px] font-bold text-slate-500 ">Failure Mode Identity *</label>
                                         <input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} placeholder="e.g. DB connection pool exhausted" className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-xs font-bold text-white outline-none focus:border-rose-500" />
                                         </div>
                                         <div className="space-y-1">
                                         <label className="text-[9px] font-bold text-slate-500 ">Effect Description</label>
                                         <textarea value={formData.effect} onChange={e => setFormData({ ...formData, effect: e.target.value })} placeholder="Systemic consequences..." className="w-full bg-black/40 border border-white/10 rounded-lg p-4 text-xs font-bold text-white min-h-[60px] outline-none focus:border-rose-500" />
                                         </div>
                                         </div>

                                         <div className="col-span-6 space-y-4">
                                         <div className="bg-white/[0.02] p-5 rounded-lg border border-white/5 space-y-6">
                                         <div className="grid grid-cols-3 gap-4">
                                         <div className="space-y-2">
                                         <label className="text-[10px] text-slate-500 text-center block">S</label>
                                         <input type="number" min="1" max="10" value={formData.severity} onChange={e => setFormData({...formData, severity: parseInt(e.target.value)})} className="w-full bg-slate-950 border border-white/10 rounded-lg text-center py-2 text-rose-500 font-bold" />
                                         </div>
                                         <div className="space-y-2">
                                         <label className="text-[10px] text-slate-500 text-center block">O</label>
                                         <input type="number" min="1" max="10" value={formData.occurrence} onChange={e => setFormData({...formData, occurrence: parseInt(e.target.value)})} className="w-full bg-slate-950 border border-white/10 rounded-lg text-center py-2 text-amber-500 font-bold" />
                                         </div>
                                         <div className="space-y-2">
                                         <label className="text-[10px] text-slate-500 text-center block">D</label>
                                         <input type="number" min="1" max="10" value={formData.detection} onChange={e => setFormData({...formData, detection: parseInt(e.target.value)})} className="w-full bg-slate-950 border border-white/10 rounded-lg text-center py-2 text-sky-400 font-bold" />
                                         </div>
                                         </div>
                                         <div className="flex items-center justify-between px-4 py-3 bg-black/40 border border-white/5 rounded-lg">
                                         <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">RPN Index:</span>
                                         <span className="text-2xl font-bold text-white">{rpn}</span>
                                         </div>
                                         </div>
                                         <button 
                                         disabled={!formData.title || mutation.isPending} 
                                         onClick={() => mutation.mutate(formData)} 
                                         className="w-full bg-rose-600 hover:bg-rose-500 text-white py-4 rounded-lg text-[10px] font-bold uppercase tracking-widest shadow-xl active:scale-95 transition-all"
                                         >
                                         Commit Failure & Link to RCA
                                         </button>
                                         </div>
                                         </div>
                                         )
                                         }

function ResearchDetails({ item, onClose, onSave, setConfirmModal, fontSize, rowDensity }: any) {
  const queryClient = useQueryClient()
  const normalizeForComparison = (data: any) => {
    if (!data) return "";
    const clean = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(clean).filter(v => v !== undefined);
      const newObj: any = {};
      Object.keys(obj).sort().forEach(key => {
        if (['updated_at', 'created_at', 'id', 'created_by_user_id'].includes(key)) return;
        let val = obj[key];
        if (val === null || val === undefined) return;
        if (Array.isArray(val) && val.length === 0) return;
        newObj[key] = clean(val);
      });
      return newObj;
    };
    return JSON.stringify(clean(data));
  };

  const [formData, setFormData] = useState(() => ({ 
    ...item,
    systems: item.systems || [],
    impacted_device_ids: item.impacted_device_ids || [],
    mitigation_items: item.mitigation_items || [],
    monitoring_items: item.monitoring_items || []
  }))
  const [isEditing, setIsEditing] = useState(false)
  const [activeTab, setActiveTab] = useState<'CONTEXT' | 'INTELLIGENCE'>('CONTEXT')
  const [newLog, setNewLog] = useState({ entry_text: '', entry_type: 'DIAGNOSIS', poc: '', timestamp: new Date().toISOString() })
  
  const prevItemNormalized = useRef(normalizeForComparison(item));
  const lastAcknowledgedData = useRef(normalizeForComparison(formData));

  // Sync formData with item prop when it changes
  useEffect(() => {
    const incomingNormalized = normalizeForComparison(item);
    if (incomingNormalized !== prevItemNormalized.current) {
      if (!isEditing) {
        setFormData({ 
          ...item,
          systems: item.systems || [],
          impacted_device_ids: item.impacted_device_ids || [],
          mitigation_items: item.mitigation_items || [],
          monitoring_items: item.monitoring_items || []
        })
        lastAcknowledgedData.current = incomingNormalized;
      }
      prevItemNormalized.current = incomingNormalized;
    }
  }, [item, isEditing])

  // Auto-save logic
  useEffect(() => {
    if (isEditing) return;
    const currentNormalized = normalizeForComparison(formData);
    if (currentNormalized !== lastAcknowledgedData.current) {
        onSave({ 
          ...formData,
          status: safeUpper(formData.status),
          priority: safeUpper(formData.priority)
        }).then(() => {
          lastAcknowledgedData.current = currentNormalized;
        }).catch(() => {
          // Keep the dirty snapshot so the effect can retry on the next change.
        });
    }
  }, [isEditing, formData, onSave]);

  const logMutation = useMutation({
    mutationFn: async (log: any) => {
      if (!log.entry_text?.trim()) {
        throw new Error('Intelligence pulse text is required')
      }
      const formattedLog = { ...log, entry_type: safeUpper(log.entry_type), poc: safeUpper(log.poc) }
      const res = await apiFetch(`/api/v1/investigations/${item.id}/logs`, {
        method: 'POST',
        body: JSON.stringify(formattedLog)
      })
      return res.json()
    },
    onSuccess: (data) => {
      setFormData(prev => ({ ...prev, progress_logs: [...(prev.progress_logs || []), data] }))
      queryClient.invalidateQueries({ queryKey: ['investigations'] })
      setNewLog({ entry_text: '', entry_type: 'DIAGNOSIS', poc: '', timestamp: new Date().toISOString() })
      toast.success('Intelligence Pulse Captured')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to capture intelligence pulse')
    }
  })

  const sortedLogs = useMemo(() => {
     return [...(formData.progress_logs || [])].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  }, [formData.progress_logs])

  const pInfo = getPriorityInfo(formData.priority)

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/95 backdrop-blur-xl p-4">
      <motion.div initial={{ scale: 0.98, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-full max-w-[1600px] h-full rounded-lg border border-white/10 overflow-hidden flex flex-col shadow-[0_0_100px_rgba(0,0,0,0.5)] bg-[#020617]">
        
        {/* Header Block */}
        <div className="px-8 py-6 border-b border-white/5 bg-white/2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 bg-blue-600/20 rounded-lg flex items-center justify-center text-blue-400 border border-blue-500/30 shadow-inner text-xl font-black tracking-tighter">INV</div>
            <div>
              <div className="flex items-center space-x-4 mb-2">
                <div className="flex items-center gap-2">
                   <div className="px-3 py-1 rounded-lg bg-blue-500/10 border border-blue-500/30 text-[9px] font-black text-blue-400 uppercase tracking-widest">RESEARCH_{item.id}</div>
                   <div className={`px-3 py-1 rounded-lg border text-[9px] font-black uppercase tracking-widest ${pInfo.color}`}>PRIORITY: {pInfo.label}</div>
                </div>
                <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Pulse: {formatAppDate(formData.updated_at || formData.created_at)}</span>
              </div>
              <h1 className="text-3xl font-black uppercase tracking-tighter text-white leading-none">{formData.title}</h1>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <button 
              onClick={async () => {
                if (isEditing) {
                  const finalData = { ...formData, status: safeUpper(formData.status), priority: safeUpper(formData.priority) }
                  try {
                    await onSave(finalData)
                    lastAcknowledgedData.current = normalizeForComparison(finalData);
                    setIsEditing(false)
                    return
                  } catch {
                    return
                  }
                }
                setIsEditing(true)
              }} 
              className={`h-12 px-8 rounded-lg text-[11px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 ${isEditing ? 'bg-amber-600 text-white shadow-lg border-amber-400' : 'bg-white/5 text-slate-400 border border-white/10 hover:text-white hover:border-white/20'}`}
            >
              {isEditing ? <Check size={14}/> : <Edit2 size={14}/>} {isEditing ? 'Confirm Analysis' : 'Enter Research Mode'}
            </button>
            <button onClick={onClose} className="w-12 h-12 flex items-center justify-center bg-white/5 border border-white/10 rounded-lg text-slate-500 hover:text-white transition-all">
              <X size={24}/>
            </button>
          </div>
        </div>

        {/* Summary Banner (Sticky) */}
        <div className="px-8 py-4 bg-black/40 border-b border-white/5 flex items-center gap-8 shrink-0">
           <SummaryCard icon={Activity} label="Current Status" value={safeUpper(formData.status)} color={pInfo.color} />
           <SummaryCard icon={User} label="Primary POC" value={formData.poc || 'SYSTEM_AUTO'} color="text-indigo-400" />
           <SummaryCard icon={Database} label="Impacted Systems" value={formData.systems?.length || 0} color="text-purple-400" />
           <SummaryCard icon={ShieldAlert} label="Intelligence Density" value={formData.progress_logs?.length || 0} color="text-emerald-400" />
        </div>

        {/* Navigation Tabs */}
        <div className="px-8 bg-black/20 border-b border-white/5 flex items-center gap-8 shrink-0">
           {[
              { id: 'CONTEXT', label: 'System Context', icon: LayoutGrid },
              { id: 'INTELLIGENCE', label: 'Intelligence Stream', icon: History }
           ].map(tab => (
              <button 
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-4 text-[11px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 border-b-2 ${activeTab === tab.id ? 'text-blue-400 border-blue-500' : 'text-slate-500 border-transparent hover:text-slate-300'}`}
              >
                <tab.icon size={14} /> {tab.label}
              </button>
           ))}
        </div>

        <div className="flex-1 overflow-visible p-8">
           {activeTab === 'CONTEXT' && (
              <div className="h-full flex gap-8 overflow-visible">
                 {/* Analytical Fields */}
                 <div className="w-[500px] flex flex-col gap-6 overflow-y-auto custom-scrollbar pr-4">
                    <PriorityGauge value={formData.priority} onChange={(v) => setFormData({...formData, priority: v})} disabled={!isEditing} type="RESEARCH" />
                    
                    <SectionCard icon={Info} title="Logical Definition" color="text-indigo-400">
                       <div className="grid grid-cols-2 gap-4">
                          <StyledSelect 
                            label="Lifecycle Status"
                            value={safeUpper(formData.status)} 
                            onChange={(e: any) => setFormData({...formData, status: e.target.value})} 
                            options={['ANALYZING', 'OPEN', 'INVESTIGATION', 'RESOLVED', 'CLOSED', 'ESCALATED', 'MONITORING'].map(s => ({value: s, label: s}))} 
                            disabled={!isEditing}
                          />
                          <div>
                             <label className="text-[9px] font-black text-slate-500 uppercase block tracking-widest px-1 mb-2">Assigned Team</label>
                             <input 
                               readOnly={!isEditing}
                               value={formData.assigned_team} 
                               onChange={e => setFormData({...formData, assigned_team: e.target.value})} 
                               className="w-full bg-slate-950 border border-white/10 rounded-lg px-4 py-2 text-[11px] outline-none focus:border-blue-500 text-slate-300 font-bold" 
                             />
                          </div>
                       </div>
                    </SectionCard>

                    <SectionCard icon={FileText} title="Problem Statement" color="text-blue-400">
                       <textarea 
                         readOnly={!isEditing}
                         value={formData.problem_statement} 
                         onChange={e => setFormData({...formData, problem_statement: e.target.value})} 
                         className={`w-full bg-slate-950 border border-white/5 rounded-lg p-4 text-xs font-bold text-slate-300 outline-none min-h-[140px] resize-none uppercase ${!isEditing && 'cursor-default opacity-80'}`} 
                       />
                    </SectionCard>
                    <SectionCard icon={Zap} title="Investigation Triggers" color="text-amber-400">
                       <textarea 
                         readOnly={!isEditing}
                         value={formData.trigger_event} 
                         onChange={e => setFormData({...formData, trigger_event: e.target.value})} 
                         className={`w-full bg-slate-950 border border-white/5 rounded-lg p-4 text-xs font-bold text-slate-300 outline-none min-h-[100px] resize-none uppercase ${!isEditing && 'cursor-default opacity-80'}`} 
                       />
                    </SectionCard>
                 </div>

                 {/* Discovery Matrix */}
                 <div className="flex-1 flex flex-col gap-6 overflow-y-auto custom-scrollbar pr-2">
                    <SectionCard icon={Search} title="Discovery & Analysis Findings" color="text-indigo-400">
                       <textarea 
                         readOnly={!isEditing}
                         value={formData.root_cause} 
                         onChange={e => setFormData({...formData, root_cause: e.target.value})} 
                         className={`w-full bg-slate-950 border border-white/5 rounded-lg p-6 text-xs font-bold text-slate-300 outline-none min-h-[250px] resize-none uppercase ${!isEditing && 'cursor-default opacity-80'}`} 
                         placeholder="RECORD CRITICAL SYSTEM DISCOVERIES AND LOGICAL OBSERVATIONS..."
                       />
                    </SectionCard>
                    <SectionCard icon={ShieldCheck} title="Proposed Mitigation Architecture" color="text-emerald-400">
                       <textarea 
                         readOnly={!isEditing}
                         value={formData.resolution_steps} 
                         onChange={e => setFormData({...formData, resolution_steps: e.target.value})} 
                         className={`w-full bg-slate-950 border border-white/5 rounded-lg p-6 text-xs font-bold text-emerald-400 outline-none min-h-[250px] resize-none uppercase ${!isEditing && 'cursor-default opacity-80'}`} 
                         placeholder="DEFINE RESOLUTION STRATEGY AND ARCHITECTURAL SAFEGUARDS..."
                       />
                    </SectionCard>
                 </div>
              </div>
           )}

           {activeTab === 'INTELLIGENCE' && (
              <div className="h-full flex flex-col gap-6 overflow-hidden">
                 <IntelligenceInput newLog={newLog} setNewLog={setNewLog} logMutation={logMutation} />
                 <IntelligenceStream logs={sortedLogs} />
              </div>
           )}
        </div>
      </motion.div>
    </div>
  )
}

function IntelligenceInput({ newLog, setNewLog, logMutation, compact = false }: any) {
  return (
    <div className={`bg-white/5 border border-white/10 rounded-lg p-6 space-y-4 shadow-xl ${compact ? 'p-4' : 'p-6'}`}>
       <div className="flex items-center justify-between border-b border-white/5 pb-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-blue-400 flex items-center gap-2"><Plus size={14}/> Capture Intelligence Pulse</h3>
          <div className="flex gap-2">
             <StyledSelect label="Log Type" value={newLog.entry_type} onChange={(e:any) => setNewLog({...newLog, entry_type: e.target.value})} options={['DIAGNOSIS', 'HYPOTHESIS', 'OBSERVATION', 'ACTION', 'RESULT'].map(t => ({value: t, label: t}))} />
             <input value={newLog.poc} onChange={e => setNewLog({...newLog, poc: e.target.value})} placeholder="POC..." className="w-32 bg-slate-950 border border-white/10 rounded-lg px-3 text-[10px] font-bold text-white outline-none focus:border-blue-500" />
          </div>
       </div>
       <textarea value={newLog.entry_text} onChange={e => setNewLog({...newLog, entry_text: e.target.value})} className="w-full bg-slate-950 border border-white/10 rounded-lg p-4 text-[11px] font-bold text-white outline-none focus:border-blue-500/50 min-h-[100px] placeholder:text-slate-700" placeholder="Capture logical system findings..." />
       <button onClick={() => logMutation.mutate(newLog)} className="h-12 w-full bg-blue-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"><Activity size={16}/> Record Intelligence</button>
    </div>
  )
}

function IntelligenceStream({ logs, compact = false }: any) {
  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4">
       {logs.length > 0 ? logs.map((log: any, idx: number) => (
          <div key={log.id || idx} className="flex gap-6 group">
             <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-[10px] border ${log.entry_type === 'ACTION' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-blue-500/20 text-blue-400 border-blue-500/30'}`}>{log.entry_type[0]}</div>
                <div className="w-px flex-1 bg-white/5 my-2" />
             </div>
             <div className="flex-1 pb-6">
                <div className="flex items-center gap-3 mb-2">
                   <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">{log.entry_type}</span>
                   <span className="text-[9px] font-bold text-slate-600 uppercase">{formatAppDate(log.timestamp)}</span>
                   <span className="text-[9px] font-bold text-blue-400/70 uppercase">BY: {log.poc || 'SYSTEM'}</span>
                </div>
                <div className="bg-white/5 border border-white/5 rounded-lg p-4 group-hover:bg-white/[0.08] transition-all">
                   <p className="text-[11px] font-bold text-slate-300 leading-relaxed uppercase">{log.entry_text}</p>
                </div>
             </div>
          </div>
       )) : (
          <div className="flex-1 flex flex-col items-center justify-center py-20 opacity-20">
             <Activity size={40} className="text-slate-500" />
             <p className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.3em]">Intelligence Stream Awaiting Initial Pulse</p>
          </div>
       )}
    </div>
  )
}
export const ModernStatusPicker = ({ value, onChange, options }: any) => {
  const current = options.find((o: any) => o.value === value) || options[0]
  const [isOpen, setIsOpen] = useState(false)
  
  return (
    <div className="relative flex justify-center">
      <button 
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
        className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase transition-all border ${current.color.replace('text-', 'border-').replace('text-', 'bg-')}/10 ${current.color} hover:scale-105 active:scale-95`}
      >
        {current.label}
      </button>
      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-[1000]" onClick={() => setIsOpen(false)} />
            <motion.div 
              initial={{ opacity: 0, y: 5 }} 
              animate={{ opacity: 1, y: 0 }} 
              exit={{ opacity: 0, y: 5 }}
              className="absolute top-full mt-1 z-[1100] bg-slate-900 border border-white/10 rounded-lg shadow-2xl overflow-hidden min-w-[120px]"
            >
              {options.map((opt: any) => (
                <button
                  key={opt.value}
                  onClick={(e) => { e.stopPropagation(); onChange(opt.value); setIsOpen(false); }}
                  className={`w-full px-4 py-2 text-[9px] font-black uppercase text-left hover:bg-white/5 transition-all ${opt.value === value ? opt.color : 'text-slate-400'}`}
                >
                  {opt.label}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}


// Moved to shared/FARModals.tsx


function MitigationTab({ formData, setFormData, isEditing }: any) {
  const [newLog, setNewLog] = useState({ type: 'Workaround', description: '', status: 'Planned' })

  const addLog = () => {
    if (!newLog.description.trim()) return
    const log = { ...newLog, id: Date.now(), timestamp: new Date().toISOString() }
    setFormData({ ...formData, mitigation_logs_json: [...(formData.mitigation_logs_json || []), log] })
    setNewLog({ type: 'Workaround', description: '', status: 'Planned' })
  }

  const types = ['Workaround', 'Monitoring', 'Mitigation', 'Prevention']
  const statuses = ['Planned', 'In Progress', 'Verified', 'Completed']

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6 space-y-6">
       {isEditing && (
          <div className="bg-white/5 border border-white/10 rounded-lg p-6 space-y-4 shadow-xl">
             <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-400 flex items-center gap-2"><Plus size={14}/> Add Mitigation Log</h3>
             <div className="grid grid-cols-2 gap-4">
                <StyledSelect label="Log Type" value={newLog.type} onChange={(e:any) => setNewLog({...newLog, type: e.target.value})} options={types.map(t => ({value: t, label: t}))} />
                <StyledSelect label="Status" value={newLog.status} onChange={(e:any) => setNewLog({...newLog, status: e.target.value})} options={statuses.map(s => ({value: s, label: s}))} />
             </div>
             <textarea value={newLog.description} onChange={e => setNewLog({...newLog, description: e.target.value})} className="w-full bg-slate-950 border border-white/10 rounded-lg p-4 text-[11px] font-bold text-white outline-none focus:border-emerald-500/50 min-h-[80px]" placeholder="Strategy details..." />
             <button onClick={addLog} className="h-12 w-full bg-emerald-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all">Capture Log</button>
          </div>
       )}

       <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3">
          {(formData.mitigation_logs_json || []).map((log: any, idx: number) => (
             <div key={log.id || idx} className="bg-white/5 border border-white/10 rounded-lg p-5 flex items-center justify-between group hover:bg-white/[0.08] transition-all">
                <div className="flex items-center gap-6">
                   <div className="w-32 text-center">
                      <span className={`text-[8px] font-bold uppercase px-2 py-0.5 rounded-lg border ${log.type === 'Prevention' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-blue-400 border-blue-500/30 bg-blue-500/10'}`}>{log.type}</span>
                      <p className={`text-[8px] font-bold uppercase mt-1.5 ${log.status === 'Completed' ? 'text-emerald-400' : 'text-amber-400'}`}>{log.status}</p>
                   </div>
                   <div className="space-y-1">
                     <p className="text-xs font-black text-slate-200">{log.description}</p>                      <p className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">{formatAppDate(log.timestamp)}</p>
                   </div>
                </div>
                {isEditing && (
                   <button onClick={() => setFormData({...formData, mitigation_logs_json: formData.mitigation_logs_json.filter((_:any, i:number) => i !== idx)})} className="opacity-0 group-hover:opacity-100 p-2 text-rose-500 hover:bg-rose-500 hover:text-white rounded-lg transition-all"><Trash2 size={14}/></button>
                )}
             </div>
          ))}
       </div>
    </div>
  )
}

export function ImageThumbnail({ src }: { src: string }) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <>
      <div onClick={() => setIsOpen(true)} className="relative w-16 h-16 shrink-0 border border-white/10 rounded-lg overflow-hidden shadow-lg cursor-zoom-in hover:border-blue-500/50 transition-all group">
         <img src={src} className="w-full h-full object-cover transition-transform group-hover:scale-110" />
      </div>
      <AnimatePresence>
         {isOpen && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-10" onClick={() => setIsOpen(false)}>
               <motion.img initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} src={src} className="max-w-full max-h-full rounded-lg shadow-2xl border border-white/10" />
               <button className="absolute top-10 right-10 text-white/50 hover:text-white"><X size={40}/></button>
            </div>
         )}
      </AnimatePresence>
    </>
  )
}
