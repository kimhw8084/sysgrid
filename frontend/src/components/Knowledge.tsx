import React, { useState, useMemo, useEffect } from 'react'
import { WorkspaceEmptyState } from "./shared/OperationalWorkspacePrimitives";
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Plus, Search, Trash2, Edit2, Info, BookOpen, 
  Save, X, PlusCircle, MessageCircle, HelpCircle,
  FileText, ArrowRight, CheckCircle2, Tag, 
  Layers, Database, Server, RefreshCcw, Filter,
  ChevronDown, User, Calendar, ExternalLink, Clock,
  List, Shield, Target, Zap, Activity, Image as ImageIcon,
  ChevronRight, AlertCircle, PlayCircle, History, Link as LinkIcon, Lightbulb, Check,
  Workflow, Briefcase, TrendingUp, Users, Cpu, Box, Share2, Globe, Lock, Unlock,
  MessageSquare, Send, Reply, AlertTriangle, FileSearch, ShieldCheck, ZapOff, HardDrive
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '../api/apiClient'
import { toast } from 'react-hot-toast'
import { formatAppDate, parseAppDate } from '../utils/dateUtils'
import { ConfirmationModal } from './shared/ConfirmationModal'
import { StyledSelect } from './shared/StyledSelect'

// --- Types & Constants ---

const CATEGORIES = ['All', 'Q&A', 'BKM', 'Manual']
const KNOWLEDGE_LENSES = ['All', 'Suggested', 'Critical', 'Needs Review', 'Stale', 'Unowned', 'Incident Ready'] as const
const KNOWLEDGE_STATUSES = ['Draft', 'Published', 'Archived']
const VERIFICATION_STATES = ['Needs Review', 'Verified', 'Stale', 'Deprecated', 'Emergency Only']
const ENTRY_TYPES = ['Runbook', 'Recovery Procedure', 'Troubleshooting Guide', 'Architecture Note', 'Post-Incident Lesson', 'Vendor Note', 'Standard', 'FAQ']
const FEEDBACK_TYPES = ['Worked', 'Partly Worked', 'Outdated', 'Unsafe', 'Needs Update']
const CRITICALITY_LEVELS = ['Standard', 'Critical']

const TARGET_AUDIENCES = [
  { value: 'Internal', label: 'Internal Team' },
  { value: 'HQ', label: 'Headquarters' },
  { value: 'Department', label: 'Inter-Department' },
  { value: 'Vendor', label: 'External Vendor' },
  { value: 'Other', label: 'Other Stakeholders' }
]

const KPI_LIST = ['MTTR', 'MTBF', 'Uptime %', 'Throughput', 'Latency', 'Yield', 'ROI', 'Cost Savings']

const emptyKnowledgeMetadata = () => ({
  entry_type: 'Runbook',
  criticality: 'Standard',
  ownership: {
    owner: '',
    backup_owner: '',
    review_team: '',
    escalation_contact: ''
  },
  verification: {
    state: 'Needs Review',
    last_verified_at: '',
    next_review_at: '',
    verified_by: ''
  },
  links: {
    data_flow_ids: [] as number[],
    service_ids: [] as number[],
    monitoring_ids: [] as number[],
    far_ids: [] as number[],
    research_ids: [] as number[],
    vendor_ids: [] as number[],
    project_ids: [] as number[]
  },
  feedback: [] as any[],
  version_history: [] as any[],
  source_context: {}
})

const mergeDeep = (base: any, override: any): any => {
  if (Array.isArray(base)) return Array.isArray(override) ? override : base
  if (typeof base !== 'object' || base === null) return override ?? base
  const result: any = { ...base }
  Object.entries(override || {}).forEach(([key, value]) => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && typeof result[key] === 'object' && result[key] !== null && !Array.isArray(result[key])) {
      result[key] = mergeDeep(result[key], value)
    } else {
      result[key] = value
    }
  })
  return result
}

const normalizeKnowledgeMetadata = (metadata: any) => mergeDeep(emptyKnowledgeMetadata(), metadata || {})

const normalizeKnowledgeEntry = (entry: any) => ({
  ...entry,
  metadata_json: normalizeKnowledgeMetadata(entry?.metadata_json)
})

const toSearchBlob = (value: any): string => {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(toSearchBlob).join(' ')
  if (typeof value === 'object') return Object.values(value).map(toSearchBlob).join(' ')
  return String(value)
}

const isKnowledgeIncidentReady = (entry: any) => {
  const data = entry.content_json || {}
  const hasSteps = Array.isArray(data.steps) && data.steps.length > 0
  const hasRollback = !!data.rollback?.trim?.() || !!data.incident_mode?.rollback?.trim?.()
  const hasValidation = !!data.validation?.trim?.() || !!data.incident_mode?.validation?.trim?.()
  return hasSteps && hasRollback && hasValidation
}

const isKnowledgeStale = (entry: any) => {
  const nextReview = entry.metadata_json?.verification?.next_review_at
  if (!nextReview) return false
  return (parseAppDate(nextReview)?.getTime() || 0) < Date.now()
}

const getKnowledgeLinkCount = (entry: any) => {
  const links = entry.metadata_json?.links || {}
  return (entry.linked_device_ids?.length || 0)
    + (links.data_flow_ids?.length || 0)
    + (links.service_ids?.length || 0)
    + (links.monitoring_ids?.length || 0)
    + (links.far_ids?.length || 0)
    + (links.research_ids?.length || 0)
    + (links.vendor_ids?.length || 0)
    + (links.project_ids?.length || 0)
}

const getKnowledgeReadiness = (entry: any) => {
  const metadata = entry.metadata_json || {}
  let score = 0
  const max = entry.category === 'BKM' ? 5 : 4

  if (metadata.ownership?.owner?.trim?.()) score += 1
  if (metadata.ownership?.review_team?.trim?.()) score += 1
  if (metadata.verification?.next_review_at) score += 1
  if (getKnowledgeLinkCount(entry) > 0) score += 1
  if (entry.category === 'BKM' && isKnowledgeIncidentReady(entry)) score += 1

  const label = score >= max ? 'Production Ready' : score >= Math.max(2, max - 1) ? 'Operational' : 'Needs Hardening'
  return { score, max, label }
}

const buildKnowledgeBriefing = (entry: any, context: any) => {
  const metadata = normalizeKnowledgeMetadata(entry.metadata_json)
  const sections = [
    `TITLE: ${entry.title}`,
    `CATEGORY: ${entry.category}`,
    `ENTRY TYPE: ${metadata.entry_type}`,
    `CRITICALITY: ${metadata.criticality}`,
    `OWNER: ${metadata.ownership.owner || 'UNOWNED'}`,
    `REVIEW TEAM: ${metadata.ownership.review_team || 'UNSET'}`,
    `VERIFICATION: ${metadata.verification.state}`,
    `NEXT REVIEW: ${metadata.verification.next_review_at || 'UNSCHEDULED'}`,
    `READINESS: ${getKnowledgeReadiness(entry).label} (${getKnowledgeReadiness(entry).score}/${getKnowledgeReadiness(entry).max})`,
    `SUMMARY: ${entry.question_context || entry.content_json?.purpose || entry.content_json?.business_value?.business_problem || entry.content || 'N/A'}`
  ]

  const linkGroups = [
    { label: 'Assets', items: (entry.linked_device_ids || []).map((id: number) => context.devices?.find((item: any) => item.id === id)?.name).filter(Boolean) },
    { label: 'Architecture', items: (metadata.links.data_flow_ids || []).map((id: number) => context.dataFlows?.find((item: any) => item.id === id)?.name).filter(Boolean) },
    { label: 'Services', items: (metadata.links.service_ids || []).map((id: number) => context.services?.find((item: any) => item.id === id)?.name).filter(Boolean) },
    { label: 'Monitoring', items: (metadata.links.monitoring_ids || []).map((id: number) => context.monitoringItems?.find((item: any) => item.id === id)?.title).filter(Boolean) },
    { label: 'FAR', items: (metadata.links.far_ids || []).map((id: number) => context.farModes?.find((item: any) => item.id === id)?.title).filter(Boolean) },
    { label: 'Research', items: (metadata.links.research_ids || []).map((id: number) => context.investigations?.find((item: any) => item.id === id)?.title).filter(Boolean) },
    { label: 'Vendors', items: (metadata.links.vendor_ids || []).map((id: number) => context.vendors?.find((item: any) => item.id === id)?.name).filter(Boolean) },
    { label: 'Projects', items: (metadata.links.project_ids || []).map((id: number) => context.projects?.find((item: any) => item.id === id)?.name).filter(Boolean) }
  ].filter(group => group.items.length)

  if (linkGroups.length) {
    sections.push(`LINKED RECORDS:`)
    linkGroups.forEach(group => {
      sections.push(`- ${group.label}: ${group.items.join(', ')}`)
    })
  }

  return sections.join('\n')
}

const buildBkmTemplate = (overrides: any = {}) => ({
  category: 'BKM',
  title: '',
  content: '',
  tags: [],
  linked_device_ids: [],
  impacted_systems: [],
  status: 'Draft',
  metadata_json: emptyKnowledgeMetadata(),
  content_json: {
    purpose: '',
    symptoms: '',
    immediate_checks: '',
    rollback: '',
    validation: '',
    escalation: '',
    prerequisites: [],
    flowchart_data: null,
    steps: [],
    tips: [],
    troubleshooting: [],
    next_steps: '',
    incident_mode: {
      first_five_minutes: '',
      escalation: '',
      rollback: '',
      validation: ''
    }
  },
  ...overrides
})

// --- Components ---

const CategoryPill = ({ label, active, onClick, count }: any) => (
  <button 
    onClick={onClick}
    className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all border flex items-center gap-2 ${
      active ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-500/20' : 'bg-white/5 text-slate-500 border-white/5 hover:border-white/10 hover:text-slate-300'
    }`}
  >
    {label} {count !== undefined && <span className={`px-1.5 py-0.5 rounded-lg ${active ? 'bg-white/20 text-white' : 'bg-white/10 text-slate-500'}`}>{count}</span>}
  </button>
)

export default function Knowledge() {
  const navigate = useNavigate()

  const [searchParams, setSearchParams] = useSearchParams()
  const idParam = searchParams.get('id')
  const deviceParam = searchParams.get('device_id')
  const serviceParam = searchParams.get('service_id')
  const monitoringParam = searchParams.get('monitoring_id')
  const farParam = searchParams.get('far_id')
  const researchParam = searchParams.get('research_id')
  const vendorParam = searchParams.get('vendor_id')
  const projectParam = searchParams.get('project_id')
  const modeParam = searchParams.get('mode')
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  const [activeLens, setActiveLens] = useState<(typeof KNOWLEDGE_LENSES)[number]>('All')
  const [activeModal, setActiveModal] = useState<any>(null)
  const [activeEntry, setActiveEntry] = useState<any>(null)
  const [confirmModal, setConfirmModal] = useState<any>({ isOpen: false, id: null })
  const [viewMode, setViewMode] = useState<'Grid' | 'Timeline'>('Grid')

  const { data: entries, isLoading } = useQuery({ 
    queryKey: ['knowledge', { deviceParam, serviceParam, monitoringParam, farParam, researchParam, vendorParam, projectParam }], 
    queryFn: async () => {
      let url = '/api/v1/knowledge/'
      const params = new URLSearchParams()
      if (deviceParam) params.append('device_id', deviceParam)
      if (serviceParam) params.append('service_id', serviceParam)
      if (monitoringParam) params.append('monitoring_id', monitoringParam)
      if (farParam) params.append('far_id', farParam)
      if (researchParam) params.append('research_id', researchParam)
      if (vendorParam) params.append('vendor_id', vendorParam)
      if (projectParam) params.append('project_id', projectParam)
      if (params.toString()) url += `?${params.toString()}`
      const res = await apiFetch(url)
      return (await res.json()).map(normalizeKnowledgeEntry)
    }
  })

  // Fetch contextual data for Manuals
  const { data: devices } = useQuery({ queryKey: ['devices'], queryFn: async () => (await apiFetch('/api/v1/devices/')).json() })
  const { data: services } = useQuery({ queryKey: ['services'], queryFn: async () => (await apiFetch('/api/v1/logical-services/')).json() })
  const { data: dataFlows } = useQuery({ queryKey: ['data-flows'], queryFn: async () => (await apiFetch('/api/v1/data-flows/')).json() })
  const { data: farModes } = useQuery({ queryKey: ['far', 'modes'], queryFn: async () => (await apiFetch('/api/v1/far/modes')).json() })
  const { data: monitoringItems } = useQuery({ queryKey: ['monitoring'], queryFn: async () => (await apiFetch('/api/v1/monitoring')).json() })
  const { data: investigations } = useQuery({ queryKey: ['investigations'], queryFn: async () => (await apiFetch('/api/v1/investigations')).json() })
  const { data: vendors } = useQuery({ queryKey: ['vendors'], queryFn: async () => (await apiFetch('/api/v1/vendors')).json() })
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: async () => (await apiFetch('/api/v1/projects')).json() })

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const url = data.id ? `/api/v1/knowledge/${data.id}` : '/api/v1/knowledge/'
      const method = data.id ? 'PUT' : 'POST'
      const res = await apiFetch(url, { method, body: JSON.stringify(data) })
      return res.json()
    },
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ['knowledge'] })
      toast.success('Knowledge Matrix Synchronized')
      setActiveModal(null)
      setActiveEntry(null)
    }
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiFetch(`/api/v1/knowledge/${id}`, { method: 'DELETE' }),
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ['knowledge'] })
      toast.success('Intelligence Expunged')
      setConfirmModal({ isOpen: false, id: null })
      setActiveEntry(null)
    }
  })

  const quickUpdateMutation = useMutation({
    mutationFn: async ({ entry, patch }: any) => {
      const next = normalizeKnowledgeEntry({
        ...entry,
        ...patch,
        metadata_json: mergeDeep(entry.metadata_json || {}, patch.metadata_json || {})
      })
      const res = await apiFetch(`/api/v1/knowledge/${entry.id}`, {
        method: 'PUT',
        body: JSON.stringify(next)
      })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge'] })
      toast.success('Knowledge Node Updated')
    }
  })

  const entityMaps = useMemo(() => ({
    devices: new Map<number, any>((devices || []).map((item: any) => [item.id, item])),
    dataFlows: new Map<number, any>((dataFlows || []).map((item: any) => [item.id, item])),
    services: new Map<number, any>((services || []).map((item: any) => [item.id, item])),
    monitoring: new Map<number, any>((monitoringItems || []).map((item: any) => [item.id, item])),
    far: new Map<number, any>((farModes || []).map((item: any) => [item.id, item])),
    research: new Map<number, any>((investigations || []).map((item: any) => [item.id, item])),
    vendors: new Map<number, any>((vendors || []).map((item: any) => [item.id, item])),
    projects: new Map<number, any>((projects || []).map((item: any) => [item.id, item]))
  }), [devices, dataFlows, services, monitoringItems, farModes, investigations, vendors, projects])

  const contextIds = useMemo(() => ({
    device_id: deviceParam ? parseInt(deviceParam, 10) : null,
    service_id: serviceParam ? parseInt(serviceParam, 10) : null,
    monitoring_id: monitoringParam ? parseInt(monitoringParam, 10) : null,
    far_id: farParam ? parseInt(farParam, 10) : null,
    research_id: researchParam ? parseInt(researchParam, 10) : null,
    vendor_id: vendorParam ? parseInt(vendorParam, 10) : null,
    project_id: projectParam ? parseInt(projectParam, 10) : null
  }), [deviceParam, serviceParam, monitoringParam, farParam, researchParam, vendorParam, projectParam])

  const enhancedEntries = useMemo(() => {
    return (entries || []).map((entry: any) => {
      const metadata = normalizeKnowledgeMetadata(entry.metadata_json)
      const linkNames = [
        ...(entry.linked_device_ids || []).map((id: number) => entityMaps.devices.get(id)?.name || ''),
        ...(metadata.links.data_flow_ids || []).map((id: number) => entityMaps.dataFlows.get(id)?.name || ''),
        ...(metadata.links.service_ids || []).map((id: number) => entityMaps.services.get(id)?.name || ''),
        ...(metadata.links.monitoring_ids || []).map((id: number) => entityMaps.monitoring.get(id)?.title || ''),
        ...(metadata.links.far_ids || []).map((id: number) => entityMaps.far.get(id)?.title || ''),
        ...(metadata.links.research_ids || []).map((id: number) => entityMaps.research.get(id)?.title || ''),
        ...(metadata.links.vendor_ids || []).map((id: number) => entityMaps.vendors.get(id)?.name || ''),
        ...(metadata.links.project_ids || []).map((id: number) => entityMaps.projects.get(id)?.name || '')
      ].filter(Boolean)

      const searchBlob = [
        entry.title,
        entry.content,
        entry.question_context,
        toSearchBlob(entry.content_json),
        toSearchBlob(entry.tags),
        toSearchBlob(entry.impacted_systems),
        toSearchBlob(metadata),
        linkNames.join(' ')
      ].join(' ').toLowerCase()

      const suggestionScore =
        ((contextIds.device_id && (entry.linked_device_ids || []).includes(contextIds.device_id)) ? 4 : 0) +
        ((contextIds.service_id && (metadata.links.service_ids || []).includes(contextIds.service_id)) ? 3 : 0) +
        ((contextIds.monitoring_id && (metadata.links.monitoring_ids || []).includes(contextIds.monitoring_id)) ? 4 : 0) +
        ((contextIds.far_id && (metadata.links.far_ids || []).includes(contextIds.far_id)) ? 2 : 0) +
        ((contextIds.research_id && (metadata.links.research_ids || []).includes(contextIds.research_id)) ? 3 : 0) +
        ((contextIds.vendor_id && (metadata.links.vendor_ids || []).includes(contextIds.vendor_id)) ? 2 : 0) +
        ((contextIds.project_id && (metadata.links.project_ids || []).includes(contextIds.project_id)) ? 2 : 0)

      return {
        ...entry,
        metadata_json: metadata,
        __searchBlob: searchBlob,
        __suggestionScore: suggestionScore,
        __linkCount: getKnowledgeLinkCount({ ...entry, metadata_json: metadata }),
        __readiness: getKnowledgeReadiness({ ...entry, metadata_json: metadata })
      }
    })
  }, [entries, entityMaps, contextIds])

  const stats = useMemo(() => {
    if (!enhancedEntries) return {}
    return {
      'All': enhancedEntries.length,
      'Q&A': enhancedEntries.filter((e: any) => e.category === 'Q&A').length,
      'BKM': enhancedEntries.filter((e: any) => e.category === 'BKM').length,
      'Manual': enhancedEntries.filter((e: any) => e.category === 'Manual').length,
    }
  }, [enhancedEntries])

  const filteredEntries = useMemo(() => {
    return enhancedEntries
      .filter((entry: any) => activeCategory === 'All' || entry.category === activeCategory)
      .filter((entry: any) => !searchTerm || entry.__searchBlob.includes(searchTerm.toLowerCase()))
      .filter((entry: any) => {
        if (activeLens === 'All') return true
        if (activeLens === 'Suggested') return entry.__suggestionScore > 0
        if (activeLens === 'Critical') return entry.metadata_json?.criticality === 'Critical'
        if (activeLens === 'Needs Review') return ['Needs Review', 'Stale'].includes(entry.metadata_json?.verification?.state) || isKnowledgeStale(entry)
        if (activeLens === 'Stale') return isKnowledgeStale(entry)
        if (activeLens === 'Unowned') return !entry.metadata_json?.ownership?.owner?.trim?.()
        if (activeLens === 'Incident Ready') return isKnowledgeIncidentReady(entry)
        return true
      })
      .sort((a: any, b: any) => {
        if (activeLens === 'Suggested') return b.__suggestionScore - a.__suggestionScore
        return (parseAppDate(b.updated_at)?.getTime() || 0) - (parseAppDate(a.updated_at)?.getTime() || 0)
      })
  }, [enhancedEntries, activeCategory, activeLens, searchTerm])

  const suggestionEntries = useMemo(() => filteredEntries.filter((entry: any) => entry.__suggestionScore > 0).slice(0, 4), [filteredEntries])
  const summary = useMemo(() => {
    const source = enhancedEntries || []
    return {
      total: source.length,
      critical: source.filter((entry: any) => entry.metadata_json?.criticality === 'Critical').length,
      incidentReady: source.filter((entry: any) => entry.category === 'BKM' && isKnowledgeIncidentReady(entry)).length,
      reviewQueue: source.filter((entry: any) => ['Needs Review', 'Stale'].includes(entry.metadata_json?.verification?.state) || isKnowledgeStale(entry)).length,
      unowned: source.filter((entry: any) => !entry.metadata_json?.ownership?.owner?.trim?.()).length,
      architectureLinked: source.filter((entry: any) => (entry.metadata_json?.links?.data_flow_ids || []).length > 0).length,
      answered: source.filter((entry: any) => entry.category === 'Q&A' && (entry.qa_threads?.length || 0) > 0).length,
    }
  }, [enhancedEntries])
  const actionQueue = useMemo(() => {
    return (enhancedEntries || [])
      .filter((entry: any) => {
        const needsReview = ['Needs Review', 'Stale'].includes(entry.metadata_json?.verification?.state) || isKnowledgeStale(entry)
        const unowned = !entry.metadata_json?.ownership?.owner?.trim?.()
        const unlinked = entry.__linkCount === 0
        return needsReview || unowned || unlinked
      })
      .sort((a: any, b: any) => {
        const aScore = (a.metadata_json?.criticality === 'Critical' ? 3 : 0) + (isKnowledgeStale(a) ? 2 : 0) + (!a.metadata_json?.ownership?.owner?.trim?.() ? 1 : 0) + (a.__linkCount === 0 ? 1 : 0)
        const bScore = (b.metadata_json?.criticality === 'Critical' ? 3 : 0) + (isKnowledgeStale(b) ? 2 : 0) + (!b.metadata_json?.ownership?.owner?.trim?.() ? 1 : 0) + (b.__linkCount === 0 ? 1 : 0)
        return bScore - aScore
      })
      .slice(0, 4)
  }, [enhancedEntries])

  useEffect(() => {
    if (!idParam || !enhancedEntries) return
    const target = enhancedEntries.find((entry: any) => String(entry.id) === idParam)
    if (target) setActiveEntry(target)
  }, [idParam, enhancedEntries])

  useEffect(() => {
    if (modeParam === 'incident') {
      setActiveLens('Incident Ready')
    }
  }, [modeParam])

  const openEntry = (entry: any) => {
    setActiveEntry(entry)
    const next = new URLSearchParams(searchParams)
    next.set('id', String(entry.id))
    setSearchParams(next)
  }

  const closeEntry = () => {
    setActiveEntry(null)
    const next = new URLSearchParams(searchParams)
    next.delete('id')
    setSearchParams(next)
  }

  const buildConversionDraft = () => {
    if (researchParam) {
      const source = entityMaps.research.get(parseInt(researchParam, 10))
      if (source) {
        return buildBkmTemplate({
          title: `${source.title} // Lessons Learned`,
          tags: ['Research', ...(source.systems || [])],
          impacted_systems: source.systems || [],
          metadata_json: mergeDeep(emptyKnowledgeMetadata(), {
            entry_type: 'Post-Incident Lesson',
            source_context: { type: 'research', id: source.id, title: source.title }
          }),
          content_json: {
            ...buildBkmTemplate().content_json,
            purpose: source.summary || source.description || '',
            symptoms: source.hypothesis || '',
            immediate_checks: source.next_actions || '',
            validation: source.resolution || ''
          }
        })
      }
    }
    if (monitoringParam) {
      const source = entityMaps.monitoring.get(parseInt(monitoringParam, 10))
      if (source) {
        return buildBkmTemplate({
          title: `${source.title} // Recovery Procedure`,
          tags: ['Monitoring', source.category, source.platform].filter(Boolean),
          linked_device_ids: source.device_id ? [source.device_id] : [],
          metadata_json: mergeDeep(emptyKnowledgeMetadata(), {
            entry_type: 'Recovery Procedure',
            links: { monitoring_ids: [source.id] },
            source_context: { type: 'monitoring', id: source.id, title: source.title }
          }),
          content_json: {
            ...buildBkmTemplate().content_json,
            purpose: source.purpose || source.impact || '',
            symptoms: source.impact || '',
            immediate_checks: source.logic || '',
            escalation: source.notification_recipients || '',
            validation: `Confirm ${source.title} returns to expected state.`
          }
        })
      }
    }
    return buildBkmTemplate()
  }

  return (
    <div className="h-full min-h-0 min-w-0 flex flex-col space-y-4 overflow-y-auto custom-scrollbar sm:space-y-6" data-knowledge-workspace="true">
      {/* Header Section */}
      <div className="flex min-w-0 shrink-0 flex-col gap-4 rounded-lg border border-white/5 bg-slate-900/50 p-4 shadow-2xl backdrop-blur-xl sm:p-6 lg:flex-row lg:items-center lg:justify-between" data-knowledge-primary-tools="true">
        <div className="min-w-0 flex-1">
          <h1 className="flex min-w-0 flex-wrap items-center gap-3 text-2xl font-black uppercase tracking-tighter text-white sm:text-4xl sm:gap-4">
            <div className="shrink-0 rounded-lg bg-blue-600 p-2 shadow-lg shadow-blue-500/20 sm:p-3">
              <BookOpen size={24} className="text-white sm:h-8 sm:w-8" />
            </div>
            <span className="min-w-0 break-words">Collective Intelligence</span>
          </h1>
          <p className="mt-2 ml-1 flex min-w-0 flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 sm:tracking-[0.4em]">
            <Globe size={12} className="text-blue-500/50" /> Unified Knowledge Matrix // Zero-Loss Information Handoff
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-3 lg:max-w-[760px] lg:flex-1">
          <div className="group relative w-full min-w-0">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-500 transition-colors" />
            <input 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)} 
              placeholder="Query Matrix..." 
              aria-label="Search Knowledge"
              data-knowledge-search="true"
              className="w-full min-w-0 rounded-lg border border-white/10 bg-black/40 py-3 pl-12 pr-4 text-[11px] font-black uppercase outline-none transition-all placeholder:text-slate-700 focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 sm:pr-6"
            />
          </div>
          <div className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap" data-knowledge-primary-actions="true">
            {(researchParam || monitoringParam) && (
              <button
                onClick={() => setActiveModal(buildConversionDraft())}
                className="inline-flex w-full min-w-0 items-center justify-center gap-2 !whitespace-normal break-words rounded-lg bg-amber-700 px-3 py-3 text-center text-[9px] font-black uppercase tracking-widest text-white shadow-lg shadow-amber-500/20 transition-all hover:bg-amber-800 active:scale-95 sm:w-auto sm:flex-1 sm:px-5 sm:text-[10px]"
              >
                <FileText size={16} /> Convert Incident
              </button>
            )}
            <button 
              onClick={() => setActiveModal({ 
                category: 'Manual', title: '', tags: [], linked_device_ids: [], impacted_systems: [], status: 'Draft',
                metadata_json: mergeDeep(emptyKnowledgeMetadata(), { entry_type: 'Architecture Note' }),
                content_json: { 
                  business_value: { business_problem: '', kpis: [], roi_projection: '', beneficiaries: [] },
                  overview: { official_name: '', version: '', status: 'Active', asset_ids: [], service_ids: [], diagram_ids: [], interface_ids: [], source_config: '', licenses: [], data_stores: [] },
                  performance: { availability_target: '', latency_limits: '', throughput_capacity: '', monitoring_ids: [], capacity_methodology: '' },
                  operation: { owner_team: '', owner_individual: '', raci: [], cpm_workflow: '', far_ids: [], dr_strategy: { rto: '', rpo: '', plan: '' }, operational_logs: [] }
                } 
              })} 
              className="inline-flex w-full min-w-0 items-center justify-center gap-2 !whitespace-normal break-words rounded-lg bg-emerald-700 px-3 py-3 text-center text-[9px] font-black uppercase tracking-widest text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-800 active:scale-95 sm:w-auto sm:flex-1 sm:px-6 sm:text-[10px]"
            >
              <Workflow size={16} /> + System Manual
            </button>
            <button 
              onClick={() => setActiveModal(buildBkmTemplate())} 
              className="inline-flex w-full min-w-0 items-center justify-center gap-2 !whitespace-normal break-words rounded-lg bg-rose-600 px-3 py-3 text-center text-[9px] font-black uppercase tracking-widest text-white shadow-lg shadow-rose-500/20 transition-all hover:bg-rose-700 active:scale-95 sm:w-auto sm:flex-1 sm:px-6 sm:text-[10px]"
            >
              <ShieldCheck size={16} /> + New BKM
            </button>
            <button 
              onClick={() => setActiveModal({ category: 'Q&A', title: '', question_context: '', content: '', tags: [], linked_device_ids: [], impacted_systems: [], status: 'Draft', metadata_json: mergeDeep(emptyKnowledgeMetadata(), { entry_type: 'FAQ' }), qa_threads: [] })} 
              className="inline-flex w-full min-w-0 items-center justify-center gap-2 !whitespace-normal break-words rounded-lg bg-blue-600 px-3 py-3 text-center text-[9px] font-black uppercase tracking-widest text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-700 active:scale-95 sm:w-auto sm:flex-1 sm:px-6 sm:text-[10px]"
            >
              <HelpCircle size={16} /> + Ask Question
            </button>
          </div>
        </div>
      </div>

      {/* Navigation & Filters */}
      <div className="flex min-w-0 shrink-0 flex-col items-stretch gap-3 border-b border-white/5 px-2 pb-4">
         <div className="flex min-w-0 flex-wrap items-center gap-2">
            {CATEGORIES.map(c => (
              <CategoryPill 
                key={c} 
                label={c} 
                active={activeCategory === c} 
                onClick={() => setActiveCategory(c)} 
                count={(stats as any)[c]}
              />
            ))}
            <div className="w-px h-8 bg-white/10 mx-2" />
            {KNOWLEDGE_LENSES.map(lens => (
              <button
                key={lens}
                onClick={() => setActiveLens(lens)}
                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-all ${
                  activeLens === lens ? 'bg-amber-500/15 border-amber-400/30 text-amber-300' : 'bg-white/5 border-white/5 text-slate-500 hover:text-slate-300'
                }`}
              >
                {lens}
              </button>
            ))}
         </div>
         <div className="flex w-fit max-w-full bg-black/40 p-1 rounded-lg border border-white/5">
            {(['Grid', 'Timeline'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${
                  viewMode === mode ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {mode === 'Grid' ? <Layers size={14}/> : <History size={14}/>} {mode}
              </button>
            ))}
         </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KnowledgeSummaryCard
            label="Knowledge Coverage"
            value={summary.total}
            detail={`${summary.critical} critical nodes`}
            icon={<BookOpen size={18} className="text-blue-300" />}
            tone="blue"
          />
          <KnowledgeSummaryCard
            label="Incident Ready"
            value={summary.incidentReady}
            detail={`${summary.architectureLinked} linked to architecture`}
            icon={<ShieldCheck size={18} className="text-rose-300" />}
            tone="rose"
          />
          <KnowledgeSummaryCard
            label="Review Queue"
            value={summary.reviewQueue}
            detail={`${summary.unowned} missing owner`}
            icon={<AlertTriangle size={18} className="text-amber-300" />}
            tone="amber"
          />
          <KnowledgeSummaryCard
            label="Answered Q&A"
            value={summary.answered}
            detail={`${summary.total - summary.answered} pending collaboration`}
            icon={<MessageSquare size={18} className="text-emerald-300" />}
            tone="emerald"
          />
        </div>
        <KnowledgeQueuePanel entries={actionQueue} onOpenEntry={openEntry} />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
         {!!(deviceParam || serviceParam || monitoringParam || farParam || researchParam || vendorParam || projectParam) && (
           <div className="mb-6 rounded-lg border border-amber-500/15 bg-amber-500/[0.04] px-5 py-4 flex items-center justify-between gap-6">
             <div>
               <p className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-300">Suggested Knowledge Context</p>
               <p className="text-xs font-bold text-slate-300 mt-2">This workspace is scoped to the linked system context so operators land on the most relevant runbooks first.</p>
             </div>
             <button
               onClick={() => {
                 setSearchParams(idParam ? { id: idParam } : {})
                 setActiveLens('All')
               }}
               className="px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-[9px] font-black uppercase tracking-widest text-slate-300 hover:text-white"
             >
               Clear Context
             </button>
           </div>
         )}
         {suggestionEntries.length > 0 && (
           <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
             {suggestionEntries.map((entry: any) => (
               <button
                 key={`suggestion-${entry.id}`}
                 onClick={() => openEntry(entry)}
                 className="rounded-lg border border-blue-500/15 bg-blue-500/[0.04] p-4 text-left hover:bg-blue-500/[0.08] transition-all"
               >
                 <p className="text-[9px] font-black uppercase tracking-[0.26em] text-blue-300">Suggested Runbook</p>
                 <h3 className="mt-2 text-sm font-black uppercase tracking-tight text-white">{entry.title}</h3>
                 <p className="mt-2 text-[11px] text-slate-400 line-clamp-2">{entry.content_json?.purpose || entry.question_context || entry.content}</p>
               </button>
             ))}
           </div>
         )}
         {isLoading ? (
           <div className="h-full flex flex-col items-center justify-center space-y-4 text-blue-400">
              <div className="relative">
                <RefreshCcw size={48} className="animate-spin opacity-20" />
                <Database size={24} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
              </div>
              <p className="text-[11px] font-black uppercase tracking-[0.4em] animate-pulse">Traversing Intelligence Grid...</p>
           </div>
         ) : filteredEntries?.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center space-y-6 text-slate-700 opacity-50">
               <FileSearch size={64} strokeWidth={1} />
               <div className="text-center">
                 <WorkspaceEmptyState title="No Intelligence Found" description="The database query returned zero records." />
                 <p className="text-[10px] font-bold mt-2 uppercase">Adjust filters or initialize new knowledge node</p>
               </div>
            </div>
         ) : viewMode === 'Grid' ? (
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-10">
              {filteredEntries?.map((entry: any) => (
                <KnowledgeCard 
                  key={entry.id} 
                  entry={entry} 
                  onClick={() => openEntry(entry)} 
                />
              ))}
           </div>
         ) : (
           <div className="pb-10 max-w-4xl mx-auto">
              <KnowledgeTimeline entries={filteredEntries} onEntryClick={openEntry} />
           </div>
         )}
      </div>

      {/* Modals & Overlays */}
      <AnimatePresence>
         {activeModal && (
            <KnowledgeForm 
              item={activeModal} 
              onClose={() => setActiveModal(null)} 
              onSave={(d: any) => mutation.mutate(d)}
              isSaving={mutation.isPending}
              context={{ devices, services, dataFlows, farModes, monitoringItems, investigations, vendors, projects }}
            />
         )}
         {activeEntry && (
            <KnowledgeDetails 
              entry={activeEntry} 
              onClose={closeEntry}
              onEdit={() => { setActiveModal(activeEntry); setActiveEntry(null); }}
              onDelete={() => setConfirmModal({ isOpen: true, id: activeEntry.id })}
              onQuickUpdate={(patch: any) => quickUpdateMutation.mutate({ entry: activeEntry, patch })}
              context={{ devices, services, dataFlows, farModes, monitoringItems, investigations, vendors, projects, navigate }}
            />
         )}
      </AnimatePresence>

      <ConfirmationModal 
        isOpen={confirmModal.isOpen} 
        onClose={() => setConfirmModal({ isOpen: false, id: null })} 
        onConfirm={() => { deleteMutation.mutate(confirmModal.id); setConfirmModal({ isOpen: false, id: null }); }} 
        title="Expunge Intelligence" 
        message="Permanently remove this knowledge node from the collective matrix? This action is irreversible." 
      />
    </div>
  )
}

// --- Sub-Components ---

function KnowledgeSummaryCard({ label, value, detail, icon, tone }: any) {
  const toneClasses: Record<string, string> = {
    blue: 'from-blue-500/15 to-cyan-500/5 border-blue-500/15',
    rose: 'from-rose-500/15 to-orange-500/5 border-rose-500/15',
    amber: 'from-amber-500/15 to-yellow-500/5 border-amber-500/15',
    emerald: 'from-emerald-500/15 to-teal-500/5 border-emerald-500/15',
  }

  return (
    <div className={`rounded-lg border bg-gradient-to-br ${toneClasses[tone] || toneClasses.blue} p-5 shadow-2xl`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.28em] text-slate-400">{label}</p>
          <p className="mt-3 text-4xl font-black tracking-tighter text-white">{value}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          {icon}
        </div>
      </div>
      <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{detail}</p>
    </div>
  )
}

function KnowledgeQueuePanel({ entries, onOpenEntry }: any) {
  return (
    <div className="rounded-lg border border-white/5 bg-black/30 p-5 shadow-2xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-white">Knowledge Action Queue</p>
          <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Highest-value records to harden next</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-300">
          {entries.length} items
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {entries.length === 0 && (
          <div className="rounded-lg border border-emerald-500/10 bg-emerald-500/5 px-4 py-5 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">
            No urgent governance debt detected
          </div>
        )}
        {entries.map((entry: any) => {
          const reasons = [
            (!entry.metadata_json?.ownership?.owner?.trim?.() && 'Owner missing'),
            ((['Needs Review', 'Stale'].includes(entry.metadata_json?.verification?.state) || isKnowledgeStale(entry)) && 'Review due'),
            (entry.__linkCount === 0 && 'No linked systems'),
          ].filter(Boolean)

          return (
            <button
              key={`queue-${entry.id}`}
              onClick={() => onOpenEntry(entry)}
              className="w-full rounded-lg border border-white/5 bg-white/[0.03] px-4 py-4 text-left hover:border-blue-500/25 hover:bg-blue-500/[0.04] transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.24em] text-slate-500">{entry.category} // {entry.metadata_json?.entry_type}</p>
                  <p className="mt-2 text-sm font-black uppercase tracking-tight text-white">{entry.title}</p>
                </div>
                <span className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-slate-300">
                  {entry.__readiness.label}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {reasons.map((reason: string) => (
                  <span key={`${entry.id}-${reason}`} className="rounded-lg border border-amber-500/15 bg-amber-500/10 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-amber-300">
                    {reason}
                  </span>
                ))}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function KnowledgeCard({ entry, onClick }: any) {
  const isBKM = entry.category === 'BKM'
  const isQA = entry.category === 'Q&A'
  const isManual = entry.category === 'Manual'
  const verification = entry.metadata_json?.verification?.state || 'Needs Review'
  const owner = entry.metadata_json?.ownership?.owner || 'Unowned'
  const critical = entry.metadata_json?.criticality === 'Critical'
  const isStale = isKnowledgeStale(entry)
  const readiness = entry.__readiness || getKnowledgeReadiness(entry)

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      layoutId={`entry-${entry.id}`}
      onClick={onClick}
      className={`glass-panel border border-white/5 p-6 rounded-lg hover:border-blue-500/40 transition-all cursor-pointer group flex flex-col h-80 relative overflow-hidden ${
        isBKM ? 'bg-rose-500/[0.02] border-rose-500/10' : 
        isQA ? 'bg-amber-500/[0.02] border-amber-500/10' :
        isManual ? 'bg-emerald-500/[0.02] border-emerald-500/10' : ''
      }`}
    >
       {/* Background Accent */}
       <div className={`absolute top-0 right-0 w-32 h-32 -mr-16 -mt-16 rounded-lg blur-[60px] opacity-10 transition-all group-hover:opacity-20 ${
         isBKM ? 'bg-rose-500' : isQA ? 'bg-amber-500' : isManual ? 'bg-emerald-500' : 'bg-blue-500'
       }`} />

       <div className="flex items-start justify-between mb-6 relative z-10">
          <div className={`p-3 rounded-lg bg-white/5 border border-white/5 shadow-xl transition-transform group-hover:scale-110 ${
            isQA ? 'text-amber-400' :
            isManual ? 'text-emerald-400' :
            isBKM ? 'text-rose-500' : 'text-blue-400'
          }`}>
             {isQA ? <HelpCircle size={20} /> : isBKM ? <ShieldCheck size={20} /> : isManual ? <Workflow size={20} /> : <FileText size={20} />}
          </div>
          <div className="text-[9px] font-black text-slate-600 uppercase tracking-widest bg-black/20 px-2 py-1 rounded-lg border border-white/5">
            REV.{new Date(entry.updated_at).getFullYear()}.{new Date(entry.updated_at).getMonth() + 1}
          </div>
       </div>

       <div className="flex flex-wrap items-center gap-2 mb-4 relative z-10">
         <span className={`px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest border ${critical ? 'bg-rose-500/15 text-rose-300 border-rose-500/20' : 'bg-white/5 text-slate-400 border-white/5'}`}>
           {entry.metadata_json?.entry_type}
         </span>
         <span className="px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest border bg-blue-500/10 text-blue-300 border-blue-500/20">
           {verification}
         </span>
         {isStale && (
           <span className="px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest border bg-amber-500/10 text-amber-300 border-amber-500/20">
             Stale
           </span>
         )}
         {isBKM && isKnowledgeIncidentReady(entry) && (
           <span className="px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest border bg-emerald-500/10 text-emerald-300 border-emerald-500/20">
             Incident Ready
           </span>
         )}
       </div>

       <div className="flex-1 overflow-hidden relative z-10">
          <h3 className="text-base font-black text-white uppercase tracking-tight line-clamp-2 group-hover:text-blue-400 transition-colors leading-tight mb-2">
            {entry.title}
          </h3>
          <p className="text-[11px] text-slate-500 line-clamp-3 leading-relaxed font-medium">
            {entry.question_context || entry.content_json?.purpose || entry.content_json?.business_value?.business_problem || entry.content}
          </p>
       </div>

       <div className="pt-4 flex items-center justify-between border-t border-white/5 mt-4 relative z-10">
          <div className="flex flex-col gap-2">
             <div className="flex gap-1.5 flex-wrap">
             {entry.tags?.slice(0, 2).map((t: string) => (
               <span key={t} className="text-[8px] font-black bg-white/5 text-slate-400 border border-white/5 px-2 py-0.5 rounded-lg uppercase tracking-tighter">{t}</span>
             ))}
             {entry.qa_threads?.length > 0 && (
               <span className="text-[8px] font-black bg-blue-600/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-lg uppercase flex items-center gap-1">
                 <MessageSquare size={10} /> {entry.qa_threads.length}
               </span>
             )}
             </div>
             <div className="flex gap-3 text-[8px] font-black uppercase tracking-[0.18em] text-slate-500">
               <span>{entry.__linkCount || 0} links</span>
               <span>{readiness.score}/{readiness.max} readiness</span>
             </div>
          </div>
          <div className="flex flex-col items-end gap-1">
             <div className="text-[8px] font-black text-slate-600 uppercase tracking-widest">{owner}</div>
             <div className="flex items-center gap-2 text-[9px] font-black text-slate-600 uppercase tracking-widest group-hover:text-blue-400 transition-colors">
             ACCESS NODE <ArrowRight size={12} className="group-hover:translate-x-1 transition-transform" />
             </div>
          </div>
       </div>
    </motion.div>
  )
}

function KnowledgeTimeline({ entries, onEntryClick }: any) {
  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => (parseAppDate(b.created_at)?.getTime() || 0) - (parseAppDate(a.created_at)?.getTime() || 0))
  }, [entries])

  return (
    <div className="space-y-8 relative">
       {/* Central Line */}
       <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-blue-500/50 via-white/10 to-transparent" />

       {sortedEntries.map((entry: any, idx: number) => (
         <div key={entry.id} className="flex gap-10 items-start group">
            <div className="relative z-10">
               <div className={`w-12 h-12 rounded-lg bg-slate-900 border-2 flex items-center justify-center transition-all group-hover:scale-110 shadow-2xl ${
                 entry.category === 'BKM' ? 'border-rose-500/50 text-rose-500 group-hover:bg-rose-500 group-hover:text-white' :
                 entry.category === 'Q&A' ? 'border-amber-500/50 text-amber-500 group-hover:bg-amber-500 group-hover:text-white' :
                 'border-blue-500/50 text-blue-500 group-hover:bg-blue-500 group-hover:text-white'
               }`}>
                  {entry.category === 'BKM' ? <ShieldCheck size={20}/> : entry.category === 'Q&A' ? <HelpCircle size={20}/> : <FileText size={20}/>}
               </div>
               {idx !== sortedEntries.length - 1 && <div className="absolute top-12 left-1/2 -translate-x-1/2 w-4 h-4 rounded-lg bg-white/5 border border-white/10 mt-2" />}
            </div>
            <div 
              onClick={() => onEntryClick(entry)}
              className="flex-1 glass-panel p-6 rounded-lg border border-white/5 hover:border-blue-500/30 transition-all cursor-pointer group-hover:translate-x-2"
            >
               <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black text-white uppercase bg-blue-600 px-2 py-0.5 rounded-lg">NODE_{entry.id}</span>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{formatAppDate(entry.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {entry.tags?.map((t: string) => (
                      <span key={t} className="text-[8px] font-black text-slate-600 uppercase border border-white/5 px-2 py-0.5 rounded-lg">{t}</span>
                    ))}
                  </div>
               </div>
               <h3 className="text-lg font-black text-white uppercase tracking-tight mb-2 group-hover:text-blue-400 transition-colors">{entry.title}</h3>
               <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-2">
                 {entry.question_context || entry.content_json?.purpose || entry.content}
               </p>
               {entry.qa_threads?.length > 0 && (
                 <div className="mt-4 pt-4 border-t border-white/5 flex items-center gap-6">
                    <div className="flex items-center gap-2 text-[9px] font-black text-blue-400 uppercase">
                      <MessageSquare size={12} /> {entry.qa_threads.length} CONTRIBUTIONS
                    </div>
                    <div className="flex -space-x-2">
                      {[1,2,3].map(i => <div key={i} className="w-6 h-6 rounded-lg bg-slate-800 border border-white/10 flex items-center justify-center text-[8px] font-black text-slate-400 uppercase">UA</div>)}
                    </div>
                 </div>
               )}
            </div>
         </div>
       ))}
    </div>
  )
}

function KnowledgeForm({ item, onClose, onSave, isSaving, context }: any) {
  const [formData, setFormData] = useState(normalizeKnowledgeEntry({ ...item }))
  const [tagInput, setTagInput] = useState('')

  const addTag = () => {
    if (!tagInput || formData.tags.includes(tagInput)) return
    setFormData({ ...formData, tags: [...formData.tags, tagInput] })
    setTagInput('')
  }

  const category = formData.category
  const metadata = normalizeKnowledgeMetadata(formData.metadata_json)
  const updateMetadata = (patch: any) => setFormData({ ...formData, metadata_json: mergeDeep(metadata, patch) })
  const toggleLink = (key: string, id: number) => {
    const current = metadata.links[key] || []
    updateMetadata({ links: { [key]: current.includes(id) ? current.filter((value: number) => value !== id) : [...current, id] } })
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 backdrop-blur-md p-6">
       <motion.div 
         initial={{ scale: 0.95, opacity: 0 }} 
         animate={{ scale: 1, opacity: 1 }} 
         className={`glass-panel w-full ${category === 'Manual' ? 'max-w-7xl' : 'max-w-5xl'} max-h-[95vh] p-0 rounded-lg border border-white/10 overflow-hidden flex flex-col shadow-2xl relative`}
       >
          {/* Header */}
          <div className="p-8 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
             <div>
                <h2 className={`text-2xl font-black uppercase flex items-center gap-4 ${
                  category === 'BKM' ? 'text-rose-500' : 
                  category === 'Manual' ? 'text-emerald-500' : 'text-blue-400'
                }`}>
                   <div className={`p-2 rounded-lg ${
                     category === 'BKM' ? 'bg-rose-600/10' : 
                     category === 'Manual' ? 'bg-emerald-600/10' : 'bg-blue-600/10'
                   }`}>
                      {category === 'BKM' ? <ShieldCheck size={28} /> : 
                       category === 'Manual' ? <Workflow size={28} /> : <HelpCircle size={28} />}
                   </div>
                   {category === 'BKM' ? 'Draft Best Known Method' : 
                    category === 'Manual' ? 'Configure System Manual' : 'Host Knowledge Node'}
                </h2>
                <p className="text-[10px] text-slate-500 uppercase tracking-[0.3em] font-bold mt-2 ml-14">Collective Intelligence Synchronization Layer</p>
             </div>
             <button onClick={onClose} className="p-3 bg-white/5 hover:bg-white/10 rounded-lg text-slate-500 hover:text-white transition-all">
                <X size={24}/>
             </button>
          </div>

          {/* Form Content */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-10">
             <div className="grid grid-cols-2 gap-8 mb-12">
                <div className="space-y-3">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Classification Category</label>
                   <StyledSelect 
                     value={formData.category} 
                     onChange={e => setFormData({...formData, category: e.target.value})}
                     options={[
                       { value: 'Q&A', label: 'Q&A // COLLABORATIVE THREAD' },
                       { value: 'BKM', label: 'BKM // BEST KNOWN METHOD' },
                       { value: 'Manual', label: 'MANUAL // SYSTEM ARCHITECTURE' }
                     ]}
                   />
                </div>
                <div className="space-y-3">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Knowledge Title // Subject</label>
                   <input 
                     value={formData.title} 
                     onChange={e => setFormData({...formData, title: e.target.value})} 
                     className="w-full bg-white/5 border border-white/10 rounded-lg px-6 py-4 text-sm text-white font-black uppercase tracking-tight outline-none focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/5 transition-all" 
                     placeholder="e.g. MISSION_CRITICAL_RECOVERY_FLOW" 
                   />
                </div>
             </div>

             {category === 'BKM' ? (
               <BKMStudio data={formData.content_json} onChange={cj => setFormData({ ...formData, content_json: cj })} />
             ) : category === 'Manual' ? (
               <SystemManualBuilder data={formData.content_json} onChange={cj => setFormData({ ...formData, content_json: cj })} context={context} />
             ) : (
               <div className="space-y-8">
                 <div className="space-y-3">
                    <label className="text-[10px] font-black text-blue-400 uppercase tracking-widest block ml-1 flex items-center gap-2">
                       <MessageCircle size={14}/> Question Context // Problem Statement
                    </label>
                    <textarea 
                      value={formData.question_context} 
                      onChange={e => setFormData({...formData, question_context: e.target.value})} 
                      className="w-full bg-slate-900/50 border border-white/10 rounded-lg p-6 text-sm text-slate-300 min-h-[150px] outline-none focus:border-blue-500/50 leading-relaxed font-medium" 
                      placeholder="Describe the technical challenge or inquiry in detail..."
                    />
                 </div>
                 <div className="space-y-3">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block ml-1">Extended Content (Markdown)</label>
                    <textarea 
                      value={formData.content} 
                      onChange={e => setFormData({...formData, content: e.target.value})} 
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-6 text-[11px] text-slate-400 min-h-[200px] outline-none focus:border-blue-500/50 leading-relaxed font-mono" 
                      placeholder="Optional additional documentation..."
                    />
                 </div>
               </div>
             )}

             <div className="mt-12 pt-8 border-t border-white/5 grid grid-cols-2 gap-8">
                <div className="space-y-6">
                   <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-3">
                         <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Entry Type</label>
                         <StyledSelect
                           value={metadata.entry_type}
                           onChange={e => updateMetadata({ entry_type: e.target.value })}
                           options={ENTRY_TYPES.map(type => ({ value: type, label: type.toUpperCase() }))}
                         />
                      </div>
                      <div className="space-y-3">
                         <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Criticality</label>
                         <StyledSelect
                           value={metadata.criticality}
                           onChange={e => updateMetadata({ criticality: e.target.value })}
                           options={CRITICALITY_LEVELS.map(level => ({ value: level, label: level.toUpperCase() }))}
                         />
                      </div>
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                         <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Owner</label>
                         <input
                           value={metadata.ownership.owner}
                           onChange={e => updateMetadata({ ownership: { owner: e.target.value } })}
                           className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-[10px] text-white font-black uppercase tracking-widest"
                           placeholder="PRIMARY_DRI"
                         />
                      </div>
                      <div className="space-y-2">
                         <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Backup Owner</label>
                         <input
                           value={metadata.ownership.backup_owner}
                           onChange={e => updateMetadata({ ownership: { backup_owner: e.target.value } })}
                           className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-[10px] text-white font-black uppercase tracking-widest"
                           placeholder="SECONDARY_DRI"
                         />
                      </div>
                      <div className="space-y-2">
                         <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Review Team</label>
                         <input
                           value={metadata.ownership.review_team}
                           onChange={e => updateMetadata({ ownership: { review_team: e.target.value } })}
                           className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-[10px] text-white font-black uppercase tracking-widest"
                           placeholder="TEAM_SCOPE"
                         />
                      </div>
                      <div className="space-y-2">
                         <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Escalation Contact</label>
                         <input
                           value={metadata.ownership.escalation_contact}
                           onChange={e => updateMetadata({ ownership: { escalation_contact: e.target.value } })}
                           className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-[10px] text-white font-black uppercase tracking-widest"
                           placeholder="CONTACT_CHAIN"
                         />
                      </div>
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-3">
                         <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Verification State</label>
                         <StyledSelect
                           value={metadata.verification.state}
                           onChange={e => updateMetadata({ verification: { state: e.target.value } })}
                           options={VERIFICATION_STATES.map(state => ({ value: state, label: state.toUpperCase() }))}
                         />
                      </div>
                      <div className="space-y-2">
                         <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Verified By</label>
                         <input
                           value={metadata.verification.verified_by}
                           onChange={e => updateMetadata({ verification: { verified_by: e.target.value } })}
                           className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-[10px] text-white font-black uppercase tracking-widest"
                           placeholder="VERIFIER"
                         />
                      </div>
                      <div className="space-y-2">
                         <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Last Verified</label>
                         <input
                           type="date"
                           value={metadata.verification.last_verified_at?.slice?.(0, 10) || ''}
                           onChange={e => updateMetadata({ verification: { last_verified_at: e.target.value } })}
                           className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-[10px] text-white font-black uppercase tracking-widest"
                         />
                      </div>
                      <div className="space-y-2">
                         <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Next Review</label>
                         <input
                           type="date"
                           value={metadata.verification.next_review_at?.slice?.(0, 10) || ''}
                           onChange={e => updateMetadata({ verification: { next_review_at: e.target.value } })}
                           className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-[10px] text-white font-black uppercase tracking-widest"
                         />
                      </div>
                   </div>
                </div>
                <div>
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-4 ml-1">Intelligence Taxonomy (Tags)</label>
                   <div className="flex flex-wrap gap-2 mb-4">
                      {formData.tags?.map((t: string) => (
                        <span key={t} className="bg-blue-600/10 text-blue-400 border border-blue-500/20 text-[9px] font-black uppercase px-3 py-1 rounded-lg flex items-center gap-2">
                           {t} <X size={12} className="cursor-pointer hover:text-white" onClick={() => setFormData({...formData, tags: formData.tags.filter((x:any) => x !== t)})} />
                        </span>
                      ))}
                   </div>
                   <div className="flex gap-2">
                      <input 
                        value={tagInput} 
                        onChange={e => setTagInput(e.target.value)} 
                        onKeyDown={e => e.key === 'Enter' && addTag()}
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-[10px] text-white uppercase font-black tracking-widest outline-none focus:border-blue-500/50" 
                        placeholder="ADD_SYSTEM_TAG..." 
                      />
                      <button onClick={addTag} className="px-4 bg-white/5 border border-white/10 rounded-lg text-slate-500 hover:text-white transition-all"><Plus size={20}/></button>
                   </div>
                </div>
                <div className="space-y-3">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Node Status</label>
                   <StyledSelect 
                     value={formData.status} 
                     onChange={e => setFormData({...formData, status: e.target.value})}
                     options={KNOWLEDGE_STATUSES.map(status => ({ value: status, label: `${status.toUpperCase()} // NODE_STATE` }))}
                   />
                </div>
             </div>

             <div className="mt-10 grid grid-cols-2 gap-6">
               <KnowledgeLinkSelector title="Linked Assets" icon={<Server size={14} className="text-emerald-400" />} items={context.devices || []} selected={formData.linked_device_ids || []} labelKey="name" sublabelKey="type" onToggle={(id: number) => {
                 const current = formData.linked_device_ids || []
                 setFormData({ ...formData, linked_device_ids: current.includes(id) ? current.filter((value: number) => value !== id) : [...current, id] })
               }} />
               <KnowledgeLinkSelector title="Linked Architecture" icon={<Workflow size={14} className="text-emerald-400" />} items={context.dataFlows || []} selected={metadata.links.data_flow_ids || []} labelKey="name" sublabelKey="category" onToggle={(id: number) => toggleLink('data_flow_ids', id)} />
               <KnowledgeLinkSelector title="Linked Services" icon={<Cpu size={14} className="text-blue-400" />} items={context.services || []} selected={metadata.links.service_ids || []} labelKey="name" sublabelKey="service_type" onToggle={(id: number) => toggleLink('service_ids', id)} />
               <KnowledgeLinkSelector title="Linked Monitoring" icon={<Activity size={14} className="text-amber-400" />} items={context.monitoringItems || []} selected={metadata.links.monitoring_ids || []} labelKey="title" sublabelKey="category" onToggle={(id: number) => toggleLink('monitoring_ids', id)} />
               <KnowledgeLinkSelector title="Linked FAR" icon={<AlertTriangle size={14} className="text-rose-400" />} items={context.farModes || []} selected={metadata.links.far_ids || []} labelKey="title" sublabelKey="rpn" onToggle={(id: number) => toggleLink('far_ids', id)} formatSublabel={(item: any) => `RPN ${item.rpn}`} />
               <KnowledgeLinkSelector title="Linked Research" icon={<FileSearch size={14} className="text-violet-400" />} items={context.investigations || []} selected={metadata.links.research_ids || []} labelKey="title" sublabelKey="status" onToggle={(id: number) => toggleLink('research_ids', id)} />
               <KnowledgeLinkSelector title="Linked Vendors" icon={<Briefcase size={14} className="text-cyan-400" />} items={context.vendors || []} selected={metadata.links.vendor_ids || []} labelKey="name" sublabelKey="category" onToggle={(id: number) => toggleLink('vendor_ids', id)} />
               <KnowledgeLinkSelector title="Linked Projects" icon={<Layers size={14} className="text-fuchsia-400" />} items={context.projects || []} selected={metadata.links.project_ids || []} labelKey="name" sublabelKey="priority" onToggle={(id: number) => toggleLink('project_ids', id)} formatSublabel={(item: any) => item.summary || item.state || 'Project'} />
             </div>
          </div>

          {/* Action Bar */}
          <div className="p-8 bg-black/40 border-t border-white/5 flex items-center justify-between gap-6">
             <div className="flex items-center gap-4 text-slate-500">
                <Clock size={16}/>
                <span className="text-[10px] font-black uppercase tracking-[0.2em]">Auto-Saving Node State...</span>
             </div>
             <div className="flex gap-4">
               <button onClick={onClose} className="px-8 py-4 text-[11px] font-black uppercase text-slate-500 hover:text-white transition-colors">Discard Intelligence</button>
               <button 
                 onClick={() => onSave(formData)} 
                 disabled={isSaving}
                 className={`px-10 py-4 rounded-lg text-[11px] font-black uppercase shadow-xl active:scale-95 transition-all flex items-center gap-3 ${
                   category === 'BKM' ? 'bg-rose-600 text-white shadow-rose-500/20' : 
                   category === 'Manual' ? 'bg-emerald-600 text-white shadow-emerald-500/20' : 'bg-blue-600 text-white shadow-blue-500/20'
                 }`}
               >
                  {isSaving ? <RefreshCcw size={18} className="animate-spin" /> : <Save size={18} />} 
                  Commit To Intelligence Matrix
               </button>
             </div>
          </div>
       </motion.div>
    </div>
  )
}

function BKMStudio({ data, onChange }: any) {
  const update = (field: string, val: any) => onChange({ ...data, [field]: val })

  const addPrereq = () => update('prerequisites', [...(data.prerequisites || []), { description: '', link: '', criticality: 'High' }])
  const addStep = () => update('steps', [...(data.steps || []), { task: '', description: '', tool: '', image_url: '' }])
  const addTip = () => update('tips', [...(data.tips || []), ''])
  const addTrouble = () => update('troubleshooting', [...(data.troubleshooting || []), { symptom: '', cause: '', solution: '' }])

  return (
    <div className="space-y-12">
      <section className="bg-slate-900/50 p-8 rounded-lg border border-white/5 space-y-4 shadow-inner">
        <label className="text-[11px] font-black text-rose-500 uppercase tracking-[0.3em] flex items-center gap-3">
          <Target size={18} className="animate-pulse" /> 01 // Mission Objective & Purpose
        </label>
        <textarea 
          value={data.purpose} 
          onChange={e => update('purpose', e.target.value)} 
          className="w-full bg-transparent border-none outline-none text-base font-medium text-slate-200 min-h-[100px] leading-relaxed" 
          placeholder="Define the primary operational objective of this BKM node..." 
        />
      </section>

      <section className="grid grid-cols-2 gap-8">
        <div className="bg-amber-500/[0.03] p-8 rounded-lg border border-amber-500/10 space-y-4">
          <label className="text-[11px] font-black text-amber-400 uppercase tracking-[0.3em] flex items-center gap-3">
            <AlertCircle size={18}/> 01A // Incident Signature
          </label>
          <textarea
            value={data.symptoms || ''}
            onChange={e => update('symptoms', e.target.value)}
            className="w-full bg-transparent border-none outline-none text-sm font-medium text-slate-200 min-h-[110px] leading-relaxed"
            placeholder="List operator-visible symptoms and trigger conditions..."
          />
        </div>
        <div className="bg-blue-500/[0.03] p-8 rounded-lg border border-blue-500/10 space-y-4">
          <label className="text-[11px] font-black text-blue-400 uppercase tracking-[0.3em] flex items-center gap-3">
            <Zap size={18}/> 01B // First Five Minutes
          </label>
          <textarea
            value={data.incident_mode?.first_five_minutes || ''}
            onChange={e => update('incident_mode', { ...(data.incident_mode || {}), first_five_minutes: e.target.value })}
            className="w-full bg-transparent border-none outline-none text-sm font-medium text-slate-200 min-h-[110px] leading-relaxed"
            placeholder="What should an engineer do immediately during the first 5 minutes?"
          />
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex items-center justify-between px-2">
          <label className="text-[11px] font-black text-rose-500 uppercase tracking-[0.3em] flex items-center gap-3">
            <List size={18}/> 02 // Pre-Flight Conditions & Prerequisites
          </label>
          <button onClick={addPrereq} className="p-2 rounded-lg bg-rose-600/10 text-rose-500 hover:bg-rose-600 hover:text-white transition-all border border-rose-500/20">
            <Plus size={18}/>
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {data.prerequisites?.map((p: any, idx: number) => (
            <div key={idx} className="flex gap-4 items-center bg-white/[0.03] p-5 rounded-lg border border-white/5 group relative">
              <div className={`w-2 h-2 rounded-full ${p.criticality === 'High' ? 'bg-rose-500 shadow-lg shadow-rose-500/50' : 'bg-blue-500'}`} />
              <input 
                value={p.description} 
                onChange={e => {
                  const next = [...data.prerequisites]; next[idx].description = e.target.value; update('prerequisites', next)
                }} 
                className="flex-1 bg-transparent border-none outline-none text-xs font-bold text-white uppercase tracking-tight" 
                placeholder="Prerequisite Description..." 
              />
              <button onClick={() => update('prerequisites', data.prerequisites.filter((_:any, i:any) => i !== idx))} className="text-slate-700 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all">
                <Trash2 size={16}/>
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-8">
        <div className="flex items-center justify-between px-2">
          <label className="text-[11px] font-black text-rose-500 uppercase tracking-[0.3em] flex items-center gap-3">
            <PlayCircle size={18}/> 03 // Sequential Execution Workflow
          </label>
          <button onClick={addStep} className="p-2 rounded-lg bg-rose-600/10 text-rose-500 hover:bg-rose-600 hover:text-white transition-all border border-rose-500/20">
            <Plus size={18}/>
          </button>
        </div>
        <div className="space-y-6">
          {data.steps?.map((s: any, idx: number) => (
            <div key={idx} className="flex gap-8 p-8 bg-slate-900/30 border border-white/5 rounded-lg relative group hover:border-rose-500/30 transition-all shadow-xl">
              <div className="flex flex-col items-center gap-4">
                 <div className="w-14 h-14 rounded-lg bg-rose-600 flex items-center justify-center text-xl font-black text-white shadow-2xl shadow-rose-600/30">
                   {String(idx + 1).padStart(2, '0')}
                 </div>
                 <div className="flex-1 w-1 bg-gradient-to-b from-rose-600/50 to-transparent rounded-lg" />
              </div>
              <div className="flex-1 space-y-6">
                <input 
                  value={s.task} 
                  onChange={e => {
                    const next = [...data.steps]; next[idx].task = e.target.value; update('steps', next)
                  }} 
                  className="w-full bg-transparent border-none outline-none text-xl font-black text-white uppercase tracking-tighter" 
                  placeholder="Task Header..." 
                />
                <textarea 
                  value={s.description} 
                  onChange={e => {
                    const next = [...data.steps]; next[idx].description = e.target.value; update('steps', next)
                  }} 
                  className="w-full bg-black/40 border border-white/5 rounded-lg p-6 text-sm font-medium text-slate-300 min-h-[120px] leading-relaxed shadow-inner" 
                  placeholder="Detailed execution logic..." 
                />
                <div className="flex gap-4">
                   <div className="flex-1 bg-white/5 border border-white/5 rounded-lg px-4 py-3 flex items-center gap-3">
                      <Cpu size={14} className="text-rose-500" />
                      <input 
                        value={s.tool} 
                        onChange={e => {
                          const next = [...data.steps]; next[idx].tool = e.target.value; update('steps', next)
                        }} 
                        className="bg-transparent border-none outline-none text-[10px] font-black text-slate-400 uppercase tracking-widest w-full" 
                        placeholder="REQUIRED_TOOLING..." 
                      />
                   </div>
                   <div className="flex-1 bg-white/5 border border-white/5 rounded-lg px-4 py-3 flex items-center gap-3">
                      <LinkIcon size={14} className="text-blue-500" />
                      <input 
                        value={s.image_url} 
                        onChange={e => {
                          const next = [...data.steps]; next[idx].image_url = e.target.value; update('steps', next)
                        }} 
                        className="bg-transparent border-none outline-none text-[10px] font-black text-slate-400 uppercase tracking-widest w-full" 
                        placeholder="IMAGE_METADATA_URL..." 
                      />
                   </div>
                </div>
              </div>
              <button onClick={() => update('steps', data.steps.filter((_:any, i:any) => i !== idx))} className="absolute top-6 right-6 text-slate-700 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all">
                <Trash2 size={20}/>
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-6">
         <div className="flex items-center justify-between px-2">
            <label className="text-[11px] font-black text-amber-500 uppercase tracking-[0.3em] flex items-center gap-3">
              <AlertTriangle size={18}/> 04 // Troubleshooting & Failure Recovery
            </label>
            <button onClick={addTrouble} className="p-2 rounded-lg bg-amber-500/10 text-amber-500 hover:bg-amber-500 hover:text-white transition-all border border-amber-500/20">
              <Plus size={18}/>
            </button>
         </div>
         <div className="space-y-4">
            {data.troubleshooting?.map((t: any, idx: number) => (
              <div key={idx} className="grid grid-cols-3 gap-6 bg-white/[0.02] p-6 rounded-lg border border-white/5 group relative">
                 <div className="space-y-2">
                    <label className="text-[9px] font-black text-amber-500/50 uppercase tracking-widest">Symptom</label>
                    <input 
                      value={t.symptom} 
                      onChange={e => {
                        const next = [...data.troubleshooting]; next[idx].symptom = e.target.value; update('troubleshooting', next)
                      }} 
                      className="w-full bg-white/5 border border-white/5 rounded-lg px-4 py-3 text-[11px] font-black text-white uppercase outline-none focus:border-amber-500/30" 
                      placeholder="Identify symptom..." 
                    />
                 </div>
                 <div className="space-y-2">
                    <label className="text-[9px] font-black text-amber-500/50 uppercase tracking-widest">Root Cause</label>
                    <input 
                      value={t.cause} 
                      onChange={e => {
                        const next = [...data.troubleshooting]; next[idx].cause = e.target.value; update('troubleshooting', next)
                      }} 
                      className="w-full bg-white/5 border border-white/5 rounded-lg px-4 py-3 text-[11px] font-black text-white uppercase outline-none focus:border-amber-500/30" 
                      placeholder="Probable cause..." 
                    />
                 </div>
                 <div className="space-y-2">
                    <label className="text-[9px] font-black text-amber-500/50 uppercase tracking-widest">Resolution</label>
                    <input 
                      value={t.solution} 
                      onChange={e => {
                        const next = [...data.troubleshooting]; next[idx].solution = e.target.value; update('troubleshooting', next)
                      }} 
                      className="w-full bg-white/5 border border-white/5 rounded-lg px-4 py-3 text-[11px] font-black text-white uppercase outline-none focus:border-amber-500/30" 
                      placeholder="Corrective action..." 
                    />
                 </div>
                 <button onClick={() => update('troubleshooting', data.troubleshooting.filter((_:any, i:any) => i !== idx))} className="absolute -right-2 -top-2 w-8 h-8 rounded-lg bg-slate-900 border border-white/10 text-slate-700 hover:text-rose-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-xl">
                   <Trash2 size={14}/>
                 </button>
              </div>
            ))}
         </div>
      </section>

      <div className="grid grid-cols-2 gap-10">
        <section className="space-y-6">
          <div className="flex items-center justify-between px-2">
            <label className="text-[11px] font-black text-blue-400 uppercase tracking-[0.3em] flex items-center gap-3">
              <Lightbulb size={18}/> 05 // Pro-Tips & Insights
            </label>
            <button onClick={addTip} className="p-1.5 rounded-lg bg-blue-600/10 text-blue-400 hover:bg-blue-600 hover:text-white transition-all border border-blue-500/20">
              <Plus size={14}/>
            </button>
          </div>
          <div className="space-y-3">
            {data.tips?.map((t: string, idx: number) => (
              <div key={idx} className="flex gap-4 items-center bg-blue-600/5 p-4 rounded-lg border border-blue-500/10 group">
                <Zap size={16} className="text-blue-500 shrink-0" />
                <input 
                  value={t} 
                  onChange={e => {
                    const next = [...data.tips]; next[idx] = e.target.value; update('tips', next)
                  }} 
                  className="bg-transparent border-none outline-none text-[11px] font-bold text-slate-200 flex-1" 
                  placeholder="Tribal knowledge / Optimization shortcut..."
                />
                <button onClick={() => update('tips', data.tips.filter((_:any, i:any) => i !== idx))} className="text-slate-700 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all">
                  <Trash2 size={14}/>
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-6">
          <label className="text-[11px] font-black text-emerald-500 uppercase tracking-[0.3em] flex items-center gap-3 px-2">
            <RefreshCcw size={18}/> 06 // Next Steps & Verification
          </label>
          <div className="bg-emerald-600/5 p-6 rounded-lg border border-emerald-500/10 space-y-4">
             <textarea 
               value={data.next_steps} 
               onChange={e => update('next_steps', e.target.value)} 
               className="w-full bg-transparent border-none outline-none text-[11px] font-bold text-slate-300 min-h-[100px] leading-relaxed" 
               placeholder="Define post-execution verification steps or next BKM node in flow..." 
             />
          </div>
        </section>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="bg-rose-500/[0.03] p-6 rounded-lg border border-rose-500/10 space-y-3">
          <label className="text-[10px] font-black text-rose-400 uppercase tracking-[0.3em]">Escalation Path</label>
          <textarea
            value={data.escalation || data.incident_mode?.escalation || ''}
            onChange={e => onChange({ ...data, escalation: e.target.value, incident_mode: { ...(data.incident_mode || {}), escalation: e.target.value } })}
            className="w-full bg-transparent border-none outline-none text-[11px] font-medium text-slate-200 min-h-[110px] leading-relaxed"
            placeholder="Who to page, when to escalate, vendor chain, bridge expectations..."
          />
        </div>
        <div className="bg-sky-500/[0.03] p-6 rounded-lg border border-sky-500/10 space-y-3">
          <label className="text-[10px] font-black text-sky-400 uppercase tracking-[0.3em]">Rollback</label>
          <textarea
            value={data.rollback || data.incident_mode?.rollback || ''}
            onChange={e => onChange({ ...data, rollback: e.target.value, incident_mode: { ...(data.incident_mode || {}), rollback: e.target.value } })}
            className="w-full bg-transparent border-none outline-none text-[11px] font-medium text-slate-200 min-h-[110px] leading-relaxed"
            placeholder="Define how to safely back out the action if recovery worsens the incident..."
          />
        </div>
        <div className="bg-emerald-500/[0.03] p-6 rounded-lg border border-emerald-500/10 space-y-3">
          <label className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.3em]">Validation</label>
          <textarea
            value={data.validation || data.incident_mode?.validation || ''}
            onChange={e => onChange({ ...data, validation: e.target.value, incident_mode: { ...(data.incident_mode || {}), validation: e.target.value } })}
            className="w-full bg-transparent border-none outline-none text-[11px] font-medium text-slate-200 min-h-[110px] leading-relaxed"
            placeholder="How do we prove the system is healthy again after the runbook finishes?"
          />
        </div>
      </div>
    </div>
  )
}

function SystemManualBuilder({ data, onChange, context }: any) {
  const update = (section: string, field: string, val: any) => {
    const next = { ...data }
    if (!next[section]) next[section] = {}
    next[section][field] = val
    onChange(next)
  }

  const { devices, services, dataFlows, farModes } = context

  return (
    <div className="space-y-16">
       {/* 01. Business Value Section */}
       <section className="space-y-8">
          <div className="flex items-center gap-4 border-l-4 border-blue-500 pl-6">
             <Briefcase size={28} className="text-blue-500" />
             <div>
                <h3 className="text-2xl font-black uppercase tracking-tighter text-white">01 // Strategic Business Value</h3>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">ROI, KPIs & Primary Beneficiaries</p>
             </div>
          </div>
          <div className="grid grid-cols-2 gap-10 bg-white/[0.02] p-10 rounded-lg border border-white/5">
             <div className="space-y-6">
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Business Problem Being Solved</label>
                   <textarea 
                     value={data.business_value?.business_problem} 
                     onChange={e => update('business_value', 'business_problem', e.target.value)}
                     className="w-full bg-slate-900 border border-white/10 rounded-lg p-6 text-sm text-slate-300 min-h-[120px] outline-none focus:border-blue-500/50 leading-relaxed" 
                     placeholder="Define the critical business challenge this system addresses..."
                   />
                </div>
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">ROI / Payback Projection</label>
                   <input 
                     value={data.business_value?.roi_projection} 
                     onChange={e => update('business_value', 'roi_projection', e.target.value)}
                     className="w-full bg-slate-900 border border-white/10 rounded-lg px-6 py-4 text-sm text-white font-black uppercase outline-none focus:border-blue-500/50" 
                     placeholder="e.g. 18 Month Payback // $2.4M Annual Stop-Loss"
                   />
                </div>
             </div>
             <div className="space-y-6">
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Target KPIs</label>
                   <div className="flex flex-wrap gap-2 mb-3">
                      {data.business_value?.kpis?.map((k: string) => (
                        <span key={k} className="bg-blue-600/10 text-blue-400 border border-blue-500/20 text-[9px] font-black uppercase px-3 py-1.5 rounded-lg flex items-center gap-2">
                           {k} <X size={12} className="cursor-pointer hover:text-white" onClick={() => update('business_value', 'kpis', data.business_value.kpis.filter((x:any) => x !== k))} />
                        </span>
                      ))}
                   </div>
                   <StyledSelect 
                     value="" 
                     onChange={e => update('business_value', 'kpis', [...(data.business_value?.kpis || []), e.target.value])}
                     options={KPI_LIST.map(k => ({ value: k, label: k }))}
                   />
                </div>
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Primary Beneficiaries</label>
                   <div className="space-y-2">
                      {data.business_value?.beneficiaries?.map((b: any, idx: number) => (
                        <div key={idx} className="flex gap-4">
                           <input 
                             value={b.who} 
                             onChange={e => {
                               const next = [...data.business_value.beneficiaries]; next[idx].who = e.target.value; update('business_value', 'beneficiaries', next)
                             }}
                             className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-[10px] text-white font-black uppercase" 
                             placeholder="Stakeholder..." 
                           />
                           <input 
                             value={b.value} 
                             onChange={e => {
                               const next = [...data.business_value.beneficiaries]; next[idx].value = e.target.value; update('business_value', 'beneficiaries', next)
                             }}
                             className="flex-[2] bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-[10px] text-slate-400 font-bold uppercase" 
                             placeholder="Value Delivered..." 
                           />
                        </div>
                      ))}
                      <button 
                        onClick={() => update('business_value', 'beneficiaries', [...(data.business_value?.beneficiaries || []), { who: '', value: '' }])}
                        className="w-full py-2 bg-blue-600/10 text-blue-500 rounded-lg text-[9px] font-black uppercase hover:bg-blue-600/20 border border-blue-500/20 transition-all mt-2"
                      >
                         + Add Beneficiary Node
                      </button>
                   </div>
                </div>
             </div>
          </div>
       </section>

       {/* 02. System Overview Section */}
       <section className="space-y-8">
          <div className="flex items-center gap-4 border-l-4 border-emerald-500 pl-6">
             <Workflow size={28} className="text-emerald-500" />
             <div>
                <h3 className="text-2xl font-black uppercase tracking-tighter text-white">02 // Technical System Overview</h3>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Architecture, Assets & Interfaces</p>
             </div>
          </div>
          <div className="grid grid-cols-2 gap-10 bg-white/[0.02] p-10 rounded-lg border border-white/5">
             <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Official Name</label>
                      <input 
                        value={data.overview?.official_name} 
                        onChange={e => update('overview', 'official_name', e.target.value)}
                        className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-[11px] text-white font-black uppercase" 
                        placeholder="SYSTEM_ID_ALPHA" 
                      />
                   </div>
                   <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Current Release</label>
                      <input 
                        value={data.overview?.version} 
                        onChange={e => update('overview', 'version', e.target.value)}
                        className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-[11px] text-white font-black uppercase" 
                        placeholder="v2.4.0-GA" 
                      />
                   </div>
                </div>
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Core Modules & Purpose</label>
                   <div className="space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar pr-2">
                      {services?.map((s: any) => (
                        <div key={s.id} className={`flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer ${
                          data.overview?.service_ids?.includes(s.id) ? 'bg-emerald-600/20 border-emerald-500/50' : 'bg-white/5 border-white/5 opacity-50'
                        }`} onClick={() => {
                          const current = data.overview?.service_ids || []
                          update('overview', 'service_ids', current.includes(s.id) ? current.filter((id:any) => id !== s.id) : [...current, s.id])
                        }}>
                           <div className="flex items-center gap-3">
                              <Box size={14} className={data.overview?.service_ids?.includes(s.id) ? 'text-emerald-400' : 'text-slate-600'} />
                              <span className="text-[10px] font-black uppercase text-white">{s.name}</span>
                           </div>
                           <span className="text-[8px] font-bold text-slate-500 uppercase">{s.service_type}</span>
                        </div>
                      ))}
                   </div>
                </div>
             </div>
             <div className="space-y-6">
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Asset Composition (Hardware Nodes)</label>
                   <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                      {devices?.map((d: any) => (
                        <div key={d.id} className={`flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer ${
                          data.overview?.asset_ids?.includes(d.id) ? 'bg-emerald-600/20 border-emerald-500/50' : 'bg-white/5 border-white/5 opacity-50'
                        }`} onClick={() => {
                          const current = data.overview?.asset_ids || []
                          update('overview', 'asset_ids', current.includes(d.id) ? current.filter((id:any) => id !== d.id) : [...current, d.id])
                        }}>
                           <div className="flex items-center gap-3">
                              <Server size={14} className={data.overview?.asset_ids?.includes(d.id) ? 'text-emerald-400' : 'text-slate-600'} />
                              <span className="text-[10px] font-black uppercase text-white">{d.name}</span>
                           </div>
                           <span className="text-[8px] font-bold text-slate-500 uppercase">{d.type}</span>
                        </div>
                      ))}
                   </div>
                </div>
             </div>
          </div>
       </section>

       {/* 03. Performance & Capacity Section */}
       <section className="space-y-8">
          <div className="flex items-center gap-4 border-l-4 border-amber-500 pl-6">
             <TrendingUp size={28} className="text-amber-500" />
             <div>
                <h3 className="text-2xl font-black uppercase tracking-tighter text-white">03 // Performance, Capacity & SLOs</h3>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Availability Targets & Capacity Methods</p>
             </div>
          </div>
          <div className="grid grid-cols-2 gap-10 bg-white/[0.02] p-10 rounded-lg border border-white/5">
             <div className="space-y-6">
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Availability Target (%)</label>
                   <input 
                     value={data.performance?.availability_target} 
                     onChange={e => update('performance', 'availability_target', e.target.value)}
                     className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-[11px] text-white font-black uppercase" 
                     placeholder="e.g. 99.95% (Excluding Planned Maintenance)" 
                   />
                </div>
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Critical Latency Limits</label>
                   <input 
                     value={data.performance?.latency_limits} 
                     onChange={e => update('performance', 'latency_limits', e.target.value)}
                     className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-[11px] text-white font-black uppercase" 
                     placeholder="e.g. <50ms End-to-End // <10ms DB IO" 
                   />
                </div>
             </div>
             <div className="space-y-6">
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Throughput Capacity</label>
                   <input 
                     value={data.performance?.throughput_capacity} 
                     onChange={e => update('performance', 'throughput_capacity', e.target.value)}
                     className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-[11px] text-white font-black uppercase" 
                     placeholder="e.g. 1500 Requests/sec // 500 Wafers/hr" 
                   />
                </div>
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Capacity Planning Methodology</label>
                   <textarea 
                     value={data.performance?.capacity_methodology} 
                     onChange={e => update('performance', 'capacity_methodology', e.target.value)}
                     className="w-full bg-slate-900 border border-white/10 rounded-lg p-4 text-[11px] text-slate-400 min-h-[100px] outline-none focus:border-amber-500/30 font-medium" 
                     placeholder="Define how capacity is forecasted and scaled..." 
                   />
                </div>
             </div>
          </div>
       </section>

       {/* 04. Operation & Support Section */}
       <section className="space-y-8">
          <div className="flex items-center gap-4 border-l-4 border-rose-500 pl-6">
             <Users size={28} className="text-rose-500" />
             <div>
                <h3 className="text-2xl font-black uppercase tracking-tighter text-white">04 // Operational Support & Reliability</h3>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">RACI, Maintenance & Failure Modes</p>
             </div>
          </div>
          <div className="grid grid-cols-2 gap-10 bg-white/[0.02] p-10 rounded-lg border border-white/5">
             <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Owner Team</label>
                      <input 
                        value={data.operation?.owner_team} 
                        onChange={e => update('operation', 'owner_team', e.target.value)}
                        className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-[11px] text-white font-black uppercase" 
                        placeholder="FAB_AUTOMATION" 
                      />
                   </div>
                   <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Primary DRI</label>
                      <input 
                        value={data.operation?.owner_individual} 
                        onChange={e => update('operation', 'owner_individual', e.target.value)}
                        className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-[11px] text-white font-black uppercase" 
                        placeholder="NAME_OR_ID" 
                      />
                   </div>
                </div>
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Top Failure Modes (from FAR)</label>
                   <div className="space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar pr-2">
                      {farModes?.map((fm: any) => (
                        <div key={fm.id} className={`flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer ${
                          data.operation?.far_ids?.includes(fm.id) ? 'bg-rose-600/20 border-rose-500/50' : 'bg-white/5 border-white/5 opacity-50'
                        }`} onClick={() => {
                          const current = data.operation?.far_ids || []
                          update('operation', 'far_ids', current.includes(fm.id) ? current.filter((id:any) => id !== fm.id) : [...current, fm.id])
                        }}>
                           <div className="flex items-center gap-3">
                              <ZapOff size={14} className={data.operation?.far_ids?.includes(fm.id) ? 'text-rose-400' : 'text-slate-600'} />
                              <span className="text-[10px] font-black uppercase text-white line-clamp-1">{fm.title}</span>
                           </div>
                           <span className="text-[8px] font-black text-rose-500 uppercase">RPN_{fm.rpn}</span>
                        </div>
                      ))}
                   </div>
                </div>
             </div>
             <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">DR Target (RTO)</label>
                      <input 
                        value={data.operation?.dr_strategy?.rto} 
                        onChange={e => update('operation', 'dr_strategy', { ...data.operation?.dr_strategy, rto: e.target.value })}
                        className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-[11px] text-white font-black uppercase" 
                        placeholder="e.g. 4 Hours" 
                      />
                   </div>
                   <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">DR Target (RPO)</label>
                      <input 
                        value={data.operation?.dr_strategy?.rpo} 
                        onChange={e => update('operation', 'dr_strategy', { ...data.operation?.dr_strategy, rpo: e.target.value })}
                        className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-[11px] text-white font-black uppercase" 
                        placeholder="e.g. 15 Minutes" 
                      />
                   </div>
                </div>
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">RACI Table Node</label>
                   <div className="space-y-2">
                      {['Operations', 'Maintenance', 'Architecture', 'Security'].map(role => (
                        <div key={role} className="flex gap-4">
                           <div className="w-24 text-[9px] font-black text-slate-600 uppercase pt-3">{role}</div>
                           <input 
                             value={data.operation?.raci?.find((r:any) => r.role === role)?. DRI || ''} 
                             onChange={e => {
                               const next = [...(data.operation?.raci || [])]
                               const idx = next.findIndex((r:any) => r.role === role)
                               if (idx >= 0) next[idx].DRI = e.target.value
                               else next.push({ role, DRI: e.target.value })
                               update('operation', 'raci', next)
                             }}
                             className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-[10px] text-white font-black uppercase" 
                             placeholder="Responsible Team/DRI..." 
                           />
                        </div>
                      ))}
                   </div>
                </div>
             </div>
          </div>
       </section>
    </div>
  )
}

function KnowledgeDetails({ entry, onClose, onEdit, onDelete, onQuickUpdate, context }: any) {
  const isBKM = entry.category === 'BKM'
  const isQA = entry.category === 'Q&A'
  const isManual = entry.category === 'Manual'
  const [incidentMode, setIncidentMode] = useState(false)
  const [showBriefing, setShowBriefing] = useState(false)
  const metadata = normalizeKnowledgeMetadata(entry.metadata_json)
  const versionHistory = [...(metadata.version_history || [])].sort((a, b) => (b.version || 0) - (a.version || 0))
  const [selectedVersion, setSelectedVersion] = useState(versionHistory[0]?.version || null)
  const currentVersion = versionHistory.find((item: any) => item.version === selectedVersion) || versionHistory[0]
  const previousVersion = versionHistory.find((item: any) => item.version === (currentVersion?.version || 0) - 1)
  const readiness = getKnowledgeReadiness(entry)

  const linkGroups = [
    { label: 'Assets', items: (entry.linked_device_ids || []).map((id: number) => ({ id, title: context.devices?.find((item: any) => item.id === id)?.name, path: `/asset?id=${id}` })) },
    { label: 'Architecture', items: (metadata.links.data_flow_ids || []).map((id: number) => ({ id, title: context.dataFlows?.find((item: any) => item.id === id)?.name, path: '/architecture' })) },
    { label: 'Services', items: (metadata.links.service_ids || []).map((id: number) => ({ id, title: context.services?.find((item: any) => item.id === id)?.name, path: `/services?id=${id}` })) },
    { label: 'Monitoring', items: (metadata.links.monitoring_ids || []).map((id: number) => ({ id, title: context.monitoringItems?.find((item: any) => item.id === id)?.title, path: `/monitoring?id=${id}` })) },
    { label: 'FAR', items: (metadata.links.far_ids || []).map((id: number) => ({ id, title: context.farModes?.find((item: any) => item.id === id)?.title, path: `/far?id=${id}` })) },
    { label: 'Research', items: (metadata.links.research_ids || []).map((id: number) => ({ id, title: context.investigations?.find((item: any) => item.id === id)?.title, path: `/research?id=${id}` })) },
    { label: 'Vendors', items: (metadata.links.vendor_ids || []).map((id: number) => ({ id, title: context.vendors?.find((item: any) => item.id === id)?.name, path: `/vendors?id=${id}` })) },
    { label: 'Projects', items: (metadata.links.project_ids || []).map((id: number) => ({ id, title: context.projects?.find((item: any) => item.id === id)?.name, path: `/projects?id=${id}` })) }
  ]

  const feedbackMutation = (type: string) => {
    const feedback = [...(metadata.feedback || []), { type, at: new Date().toISOString() }]
    onQuickUpdate?.({ metadata_json: { feedback } })
  }

  const restoreVersion = (version: any) => {
    if (!version?.snapshot) return
    const snapshot = version.snapshot
    const restoredMetadata = mergeDeep(snapshot.metadata_json || {}, {
      version_history: metadata.version_history || []
    })
    onQuickUpdate?.({
      category: snapshot.category,
      title: snapshot.title,
      content: snapshot.content,
      content_json: snapshot.content_json,
      question_context: snapshot.question_context,
      tags: snapshot.tags,
      impacted_systems: snapshot.impacted_systems,
      linked_device_ids: snapshot.linked_device_ids,
      status: snapshot.status,
      metadata_json: restoredMetadata
    })
  }

  const openPath = (path: string) => {
    onClose?.()
    context.navigate?.(path)
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/95 backdrop-blur-3xl p-10">
       <motion.div 
         layoutId={`entry-${entry.id}`} 
         className="glass-panel w-full max-w-7xl h-[90vh] rounded-lg border border-white/10 flex flex-col overflow-hidden shadow-3xl relative"
       >
          {/* Detailed Header */}
          <div className={`p-10 border-b border-white/5 flex items-start justify-between relative overflow-hidden ${
            isBKM ? 'bg-rose-500/[0.03]' : 
            isQA ? 'bg-amber-500/[0.03]' :
            isManual ? 'bg-emerald-500/[0.03]' : 'bg-blue-500/[0.03]'
          }`}>
             <div className="space-y-6 relative z-10">
                <div className="flex items-center space-x-3">
                   <span className={`px-4 py-1 rounded-lg border text-[10px] font-black uppercase tracking-[0.2em] shadow-lg ${
                     isBKM ? 'bg-rose-600/20 border-rose-500/30 text-rose-500' : 
                     isQA ? 'bg-amber-600/20 border-amber-500/30 text-amber-500' :
                     isManual ? 'bg-emerald-600/20 border-emerald-500/30 text-emerald-500' :
                     'bg-blue-600/20 border-blue-500/30 text-blue-400'
                   }`}>
                      {entry.category} // INTEL_NODE_{entry.id}
                   </span>
                   <span className="text-slate-700 font-black tracking-widest">{" >> "}</span>
                   <span className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-2 tracking-widest">
                     <History size={14}/> LAST_SYNC: {formatAppDate(entry.updated_at)}
                   </span>
                </div>
                <h1 className="text-6xl font-black uppercase tracking-tighter text-white leading-[0.9] max-w-5xl">
                   {entry.title}
                </h1>
                <div className="flex flex-wrap gap-2">
                   <span className="px-3 py-1.5 rounded-lg border border-white/10 bg-black/20 text-[9px] font-black uppercase tracking-[0.2em] text-slate-300">
                     {readiness.label} // {readiness.score}/{readiness.max}
                   </span>
                   <span className="px-3 py-1.5 rounded-lg border border-white/10 bg-black/20 text-[9px] font-black uppercase tracking-[0.2em] text-slate-300">
                     {getKnowledgeLinkCount(entry)} linked records
                   </span>
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                   {entry.tags?.map((t: string) => (
                     <span key={t} className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[9px] font-black text-slate-400 uppercase flex items-center gap-2 hover:bg-white/10 transition-all cursor-default">
                        <Tag size={12} className="text-blue-500" /> {t}
                     </span>
                   ))}
                </div>
             </div>
             <div className="flex items-center space-x-3 relative z-10">
                {isBKM && (
                  <button onClick={() => setIncidentMode(!incidentMode)} className={`px-5 py-4 rounded-lg border text-[10px] font-black uppercase tracking-widest transition-all ${incidentMode ? 'bg-amber-500 text-slate-950 border-amber-300' : 'bg-white/5 border-white/10 text-amber-300 hover:bg-white/10'}`}>
                    Incident Mode
                  </button>
                )}
                <button onClick={() => setShowBriefing(true)} className="px-5 py-4 rounded-lg border border-white/10 bg-white/5 text-[10px] font-black uppercase tracking-widest text-slate-300 hover:text-white">
                  <Share2 size={16} className="inline mr-2" /> Export Briefing
                </button>
                <button onClick={onEdit} className="p-4 bg-white/5 border border-white/10 rounded-lg text-slate-500 hover:text-blue-400 hover:border-blue-500/30 transition-all shadow-xl group">
                   <Edit2 size={24} className="group-hover:rotate-12 transition-transform" />
                </button>
                <button onClick={onDelete} className="p-4 bg-white/5 border border-white/10 rounded-lg text-slate-500 hover:text-rose-500 hover:border-rose-500/30 transition-all shadow-xl group">
                   <Trash2 size={24} className="group-hover:scale-110 transition-transform" />
                </button>
                <div className="w-px h-12 bg-white/10 mx-3" />
                <button onClick={onClose} className="p-4 bg-white/5 border border-white/10 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition-all shadow-xl">
                   <X size={32}/>
                </button>
             </div>
          </div>

          {/* Main Body Content */}
          <div className="flex-1 overflow-y-auto custom-scrollbar flex">
             {isBKM ? (
               <div className="flex-1 flex">
                 <div className="flex-1">
                   {incidentMode && <IncidentModePanel entry={entry} />}
                   <BKMViewer data={entry.content_json} />
                 </div>
                 <KnowledgeOpsRail
                   entry={entry}
                   metadata={metadata}
                   versionHistory={versionHistory}
                   currentVersion={currentVersion}
                   previousVersion={previousVersion}
                   linkGroups={linkGroups}
                   onFeedback={feedbackMutation}
                   onOpenPath={openPath}
                   onQuickUpdate={onQuickUpdate}
                   onSelectVersion={setSelectedVersion}
                   onRestoreVersion={restoreVersion}
                 />
               </div>
             ) : isManual ? (
               <div className="flex-1 flex">
                 <div className="flex-1">
                   <SystemManualViewer data={entry.content_json} context={context} />
                 </div>
                 <KnowledgeOpsRail
                   entry={entry}
                   metadata={metadata}
                   versionHistory={versionHistory}
                   currentVersion={currentVersion}
                   previousVersion={previousVersion}
                   linkGroups={linkGroups}
                   onFeedback={feedbackMutation}
                   onOpenPath={openPath}
                   onQuickUpdate={onQuickUpdate}
                   onSelectVersion={setSelectedVersion}
                   onRestoreVersion={restoreVersion}
                 />
               </div>
             ) : (
               <div className="flex-1 flex">
                 <div className="flex-1 flex flex-col">
                   <QAViewer entry={entry} />
                 </div>
                 <KnowledgeOpsRail
                   entry={entry}
                   metadata={metadata}
                   versionHistory={versionHistory}
                   currentVersion={currentVersion}
                   previousVersion={previousVersion}
                   linkGroups={linkGroups}
                   onFeedback={feedbackMutation}
                   onOpenPath={openPath}
                   onQuickUpdate={onQuickUpdate}
                   onSelectVersion={setSelectedVersion}
                   onRestoreVersion={restoreVersion}
                 />
               </div>
             )}
          </div>
          <AnimatePresence>
            {showBriefing && (
              <KnowledgeBriefingModal
                entry={entry}
                context={context}
                onClose={() => setShowBriefing(false)}
              />
            )}
          </AnimatePresence>

          {/* Detailed Footer */}
          <div className="p-8 bg-black/60 border-t border-white/5 flex items-center justify-between">
             <div className="flex items-center space-x-12">
                <div className="flex items-center space-x-3">
                   <div className="w-10 h-10 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-500">
                      <User size={20}/>
                   </div>
                   <div>
                      <p className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Custodian</p>
                      <p className="text-[10px] font-black text-white uppercase tracking-tighter">{metadata.ownership.owner || 'UNOWNED'}</p>
                   </div>
                </div>
                <div className="flex items-center space-x-3">
                   <div className="w-10 h-10 rounded-lg bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500">
                      <ShieldCheck size={20}/>
                   </div>
                   <div>
                      <p className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Verification Status</p>
                      <p className="text-[10px] font-black text-emerald-500 uppercase tracking-tighter">{metadata.verification.state}</p>
                   </div>
                </div>
             </div>
             <div className="flex items-center gap-4">
                <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/knowledge?id=${entry.id}`)} className="flex items-center space-x-3 px-6 py-3 bg-blue-600/10 border border-blue-500/20 rounded-lg text-[10px] font-black text-blue-400 uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all shadow-lg group">
                   <LinkIcon size={16} className="group-hover:rotate-45 transition-transform" /> <span>Copy SysLink</span>
                </button>
                <button onClick={() => {
                  onQuickUpdate?.({ metadata_json: { verification: { state: 'Verified', verified_by: metadata.ownership.owner || entry.created_by_user_id || '', last_verified_at: new Date().toISOString().slice(0, 10) } } })
                }} className="flex items-center space-x-3 px-6 py-3 bg-emerald-600/10 border border-emerald-500/20 rounded-lg text-[10px] font-black text-emerald-400 uppercase tracking-widest hover:bg-emerald-600 hover:text-white transition-all shadow-lg group">
                   <CheckCircle2 size={16} className="group-hover:-translate-y-0.5 transition-transform" /> <span>Mark Verified</span>
                </button>
                <button className="flex items-center space-x-3 px-6 py-3 bg-rose-600/10 border border-rose-500/20 rounded-lg text-[10px] font-black text-rose-500 uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-all shadow-lg group">
                   <Share2 size={16} className="group-hover:-translate-y-0.5 transition-transform" /> <span>Distribute Node</span>
                </button>
             </div>
          </div>
       </motion.div>
    </div>
  )
}

function KnowledgeBriefingModal({ entry, context, onClose }: any) {
  const briefing = buildKnowledgeBriefing(entry, context)

  return (
    <div className="absolute inset-0 z-[130] flex items-center justify-center bg-black/85 backdrop-blur-2xl p-8">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-4xl rounded-lg border border-white/10 bg-slate-950/95 p-8 shadow-2xl">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h3 className="text-2xl font-black uppercase tracking-tighter text-white">Knowledge Briefing</h3>
            <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">Operator-ready handoff summary</p>
          </div>
          <button onClick={onClose} aria-label="Close briefing" className="rounded-lg border border-white/10 bg-white/5 p-3 text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <textarea
          readOnly
          value={briefing}
          className="mt-6 h-[420px] w-full rounded-lg border border-white/10 bg-black/40 p-6 text-sm font-medium leading-relaxed text-slate-200 outline-none"
        />
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={() => navigator.clipboard.writeText(briefing)}
            className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-blue-300"
          >
            Copy Briefing
          </button>
        </div>
      </motion.div>
    </div>
  )
}

function KnowledgeLinkSelector({ title, icon, items, selected, labelKey, sublabelKey, onToggle, formatSublabel }: any) {
  return (
    <div className="bg-white/[0.02] border border-white/5 rounded-lg p-5 space-y-4">
      <div className="flex items-center gap-3">
        {icon}
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-300">{title}</p>
      </div>
      <div className="max-h-52 overflow-y-auto custom-scrollbar space-y-2 pr-2">
        {items.map((item: any) => {
          const active = selected.includes(item.id)
          return (
            <button
              key={`${title}-${item.id}`}
              type="button"
              onClick={() => onToggle(item.id)}
              className={`w-full rounded-lg border px-3 py-3 text-left transition-all ${active ? 'bg-blue-600/15 border-blue-500/30' : 'bg-white/5 border-white/5 hover:bg-white/[0.08]'}`}
            >
              <p className="text-[10px] font-black uppercase tracking-tight text-white">{item[labelKey]}</p>
              {(formatSublabel ? formatSublabel(item) : item[sublabelKey]) && (
                <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">{formatSublabel ? formatSublabel(item) : item[sublabelKey]}</p>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function IncidentModePanel({ entry }: any) {
  const data = entry.content_json || {}
  return (
    <div className="mx-16 mt-12 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-8 grid grid-cols-2 gap-6">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.28em] text-amber-300">Symptoms</p>
        <p className="mt-3 text-sm font-medium text-slate-200 leading-relaxed">{data.symptoms || 'No incident signature documented.'}</p>
      </div>
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-300">First Five Minutes</p>
        <p className="mt-3 text-sm font-medium text-slate-200 leading-relaxed">{data.incident_mode?.first_five_minutes || 'No immediate triage guidance documented.'}</p>
      </div>
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.28em] text-rose-300">Escalation</p>
        <p className="mt-3 text-sm font-medium text-slate-200 leading-relaxed">{data.escalation || data.incident_mode?.escalation || 'No escalation path documented.'}</p>
      </div>
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.28em] text-emerald-300">Rollback + Validation</p>
        <p className="mt-3 text-sm font-medium text-slate-200 leading-relaxed">{data.rollback || data.incident_mode?.rollback || 'No rollback documented.'}</p>
        <p className="mt-3 text-sm font-medium text-emerald-300 leading-relaxed">{data.validation || data.incident_mode?.validation || 'No validation steps documented.'}</p>
      </div>
    </div>
  )
}

function VersionDiff({ currentVersion, previousVersion }: any) {
  if (!currentVersion) return null
  const currentSnapshot = currentVersion.snapshot || {}
  const previousSnapshot = previousVersion?.snapshot || {}
  const changedFields = ['title', 'content', 'question_context', 'status', 'content_json', 'metadata_json']
    .map(field => ({
      field,
      before: toSearchBlob(previousSnapshot[field]),
      after: toSearchBlob(currentSnapshot[field])
    }))
    .filter(change => change.before !== change.after)

  return (
    <div className="space-y-3">
      {!changedFields.length && <p className="text-[10px] font-bold uppercase text-slate-600">No previous delta available</p>}
      {changedFields.map(change => (
        <div key={change.field} className="rounded-lg border border-white/5 bg-black/20 p-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-blue-300">{change.field}</p>
          <p className="mt-2 text-[10px] font-bold text-slate-500 line-clamp-2">{change.before || 'empty'}</p>
          <p className="mt-1 text-[10px] font-bold text-white line-clamp-2">{change.after || 'empty'}</p>
        </div>
      ))}
    </div>
  )
}

function KnowledgeOpsRail({ entry, metadata, versionHistory, currentVersion, previousVersion, linkGroups, onFeedback, onOpenPath, onQuickUpdate, onSelectVersion, onRestoreVersion }: any) {
  const initialVersion = [...versionHistory].sort((a: any, b: any) => (a.version || 0) - (b.version || 0))[0]
  const readiness = getKnowledgeReadiness(entry)
  return (
    <aside className="w-[380px] shrink-0 border-l border-white/5 bg-black/30 p-6 overflow-y-auto custom-scrollbar space-y-6">
      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-5 space-y-4">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-300">Operational Readiness</p>
        <div className="rounded-lg border border-white/5 bg-black/20 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Status</span>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">{readiness.label}</span>
          </div>
          <div className="mt-4 h-2 rounded-lg bg-white/5">
            <div className="h-2 rounded-lg bg-gradient-to-r from-blue-500 via-emerald-500 to-emerald-300" style={{ width: `${(readiness.score / readiness.max) * 100}%` }} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-[9px] font-black uppercase tracking-[0.18em]">
            <span className="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-slate-400">{getKnowledgeLinkCount(entry)} links</span>
            <span className="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-slate-400">{versionHistory.length} versions</span>
            <span className="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-slate-400">{metadata.feedback?.length || 0} feedback</span>
            <span className="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-slate-400">{entry.category === 'BKM' && isKnowledgeIncidentReady(entry) ? 'incident-ready' : 'needs drill'}</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-5 space-y-4">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-300">Ownership & Review</p>
        <div className="space-y-2 text-[10px] font-bold uppercase">
          <div className="flex items-center justify-between"><span className="text-slate-500">Owner</span><span className="text-white">{metadata.ownership.owner || 'UNOWNED'}</span></div>
          <div className="flex items-center justify-between"><span className="text-slate-500">Backup</span><span className="text-white">{metadata.ownership.backup_owner || 'NONE'}</span></div>
          <div className="flex items-center justify-between"><span className="text-slate-500">Review Team</span><span className="text-white">{metadata.ownership.review_team || 'UNSET'}</span></div>
          <div className="flex items-center justify-between"><span className="text-slate-500">Next Review</span><span className="text-white">{metadata.verification.next_review_at || 'UNSCHEDULED'}</span></div>
        </div>
        <button
          onClick={() => onQuickUpdate?.({ metadata_json: { verification: { state: 'Needs Review' } } })}
          className="w-full rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-amber-300"
        >
          Flag For Review
        </button>
      </div>

      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-5 space-y-4">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-300">Feedback Loop</p>
        <div className="grid grid-cols-2 gap-2">
          {FEEDBACK_TYPES.map(type => (
            <button
              key={type}
              onClick={() => onFeedback(type)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-300 hover:text-white"
            >
              {type}
            </button>
          ))}
        </div>
        {(metadata.feedback || []).slice(-3).reverse().map((item: any, index: number) => (
          <div key={`${item.type}-${item.at}-${index}`} className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-white">{item.type}</p>
            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500 mt-1">{formatAppDate(item.at)}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-5 space-y-4">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-300">Deep Links</p>
        {linkGroups.map((group: any) => (
          <div key={group.label} className="space-y-2">
            <p className="text-[8px] font-black uppercase tracking-[0.24em] text-slate-500">{group.label}</p>
            {group.items.filter((item: any) => item.title).length ? group.items.filter((item: any) => item.title).map((item: any) => (
              <button key={`${group.label}-${item.id}`} onClick={() => onOpenPath(item.path)} className="w-full rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-left hover:bg-white/[0.08]">
                <p className="text-[10px] font-black uppercase tracking-tight text-white">{item.title}</p>
              </button>
            )) : <p className="text-[9px] font-bold uppercase text-slate-600">No linked records</p>}
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-5 space-y-4">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-300">Version History</p>
        <div className="space-y-2">
          {versionHistory.map((item: any) => (
            <button aria-label={`Version ${item.version}`} key={item.version} onClick={() => onSelectVersion(item.version)} className="w-full rounded-lg border border-white/5 bg-black/20 px-3 py-3 text-left hover:bg-white/[0.08]">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-white">v{item.version}</p>
                <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">{item.changed_by}</p>
              </div>
              <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">{item.summary}</p>
            </button>
          ))}
        </div>
        {!!currentVersion && (
          <div className="grid grid-cols-1 gap-2">
            {initialVersion && initialVersion.version !== currentVersion.version && (
              <button
                onClick={() => onRestoreVersion?.(initialVersion)}
                className="w-full rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-fuchsia-300"
              >
                Restore Initial Version
              </button>
            )}
            {previousVersion && (
              <button
                onClick={() => onRestoreVersion?.(previousVersion)}
                className="w-full rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-emerald-300"
              >
                Restore Previous Version
              </button>
            )}
            <button
              onClick={() => onRestoreVersion?.(currentVersion)}
              className="w-full rounded-lg border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-blue-300"
            >
              Restore Selected Version
            </button>
          </div>
        )}
        <VersionDiff currentVersion={currentVersion} previousVersion={previousVersion} />
      </div>
    </aside>
  )
}

function BKMViewer({ data }: any) {
  return (
    <div className="max-w-6xl mx-auto p-16 space-y-24">
       <section className="space-y-8 bg-slate-900/40 p-12 rounded-lg border border-white/5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-5 text-rose-500 group-hover:opacity-10 transition-all">
             <Target size={120} />
          </div>
          <h4 className="text-[12px] font-black text-rose-500 uppercase tracking-[0.5em] flex items-center gap-4">
             <Target size={20} className="animate-pulse" /> 01 // MISSION_OBJECTIVE
          </h4>
          <p className="text-3xl font-medium text-slate-200 leading-tight border-l-8 border-rose-600 pl-12 max-w-4xl relative z-10">
             {data.purpose}
          </p>
       </section>

       <section className="space-y-10 px-4">
          <h4 className="text-[12px] font-black text-rose-500 uppercase tracking-[0.5em] flex items-center gap-4">
             <List size={20}/> 02 // PRE_FLIGHT_STATE
          </h4>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
             {data.prerequisites?.map((p: any, i: number) => (
               <div key={i} className="bg-white/[0.02] border border-white/5 p-6 rounded-lg flex items-start gap-4 hover:border-rose-500/30 transition-all hover:bg-white/[0.04] group">
                  <div className={`w-3 h-3 rounded-full mt-1 shrink-0 ${p.criticality === 'High' ? 'bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.5)]' : 'bg-blue-500'}`} />
                  <div className="space-y-1">
                     <span className="text-[12px] font-black text-white uppercase leading-tight block group-hover:text-rose-500 transition-colors">{p.description}</span>
                     {p.link && <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest block mt-2">LINKED_RESOURCE: {p.link}</span>}
                  </div>
               </div>
             ))}
          </div>
       </section>

       <section className="space-y-12">
          <h4 className="text-[12px] font-black text-rose-500 uppercase tracking-[0.5em] flex items-center gap-4">
             <PlayCircle size={20}/> 03 // EXECUTION_FLOW
          </h4>
          <div className="space-y-10 relative">
             <div className="absolute left-8 top-10 bottom-10 w-1 bg-gradient-to-b from-rose-600/50 via-white/5 to-transparent rounded-lg" />
             {data.steps?.map((s: any, i: number) => (
               <div key={i} className="flex gap-12 group relative">
                  <div className="relative z-10 shrink-0">
                     <div className="w-16 h-16 rounded-lg bg-slate-900 border-2 border-rose-600/50 flex items-center justify-center text-2xl font-black text-rose-500 shadow-2xl group-hover:bg-rose-600 group-hover:text-white transition-all">
                        {String(i + 1).padStart(2, '0')}
                     </div>
                  </div>
                  <div className="flex-1 pb-16 space-y-6">
                     <div className="space-y-2">
                        <h5 className="text-3xl font-black text-white uppercase tracking-tighter group-hover:text-rose-400 transition-colors">{s.task}</h5>
                        {s.tool && <span className="text-[9px] font-black bg-rose-600/10 text-rose-500 border border-rose-500/20 px-3 py-1 rounded-lg uppercase tracking-widest">{s.tool}</span>}
                     </div>
                     <p className="text-base text-slate-400 leading-relaxed font-medium border-l-2 border-white/5 pl-6">{s.description}</p>
                     {s.image_url && (
                        <div className="aspect-video bg-black/40 rounded-lg border border-white/10 overflow-hidden shadow-2xl relative group/img">
                           <img src={s.image_url} className="w-full h-full object-cover opacity-60 group-hover/img:opacity-100 transition-opacity" alt={s.task} />
                           <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex items-end p-8">
                              <p className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-2">
                                 <ImageIcon size={14} className="text-rose-500" /> CAPTURED_EVIDENCE_SOURCE_{i+1}
                              </p>
                           </div>
                        </div>
                     )}
                  </div>
               </div>
             ))}
          </div>
       </section>

       <section className="space-y-10">
          <h4 className="text-[12px] font-black text-amber-500 uppercase tracking-[0.5em] flex items-center gap-4">
             <AlertTriangle size={20}/> 04 // FAILURE_RECOVERY_MODES
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
             {data.troubleshooting?.map((t: any, i: number) => (
               <div key={i} className="bg-amber-500/[0.03] border border-amber-500/10 p-8 rounded-lg space-y-6 hover:bg-amber-500/[0.06] transition-all group">
                  <div className="flex items-center gap-4 border-b border-amber-500/10 pb-4">
                     <div className="p-3 bg-amber-500/20 rounded-lg text-amber-500">
                        <AlertTriangle size={20} />
                     </div>
                     <h5 className="text-lg font-black text-white uppercase tracking-tight">{t.symptom}</h5>
                  </div>
                  <div className="space-y-4">
                     <div className="space-y-1">
                        <p className="text-[9px] font-black text-amber-500/50 uppercase tracking-widest">Probable Cause</p>
                        <p className="text-sm font-bold text-slate-300">{t.cause}</p>
                     </div>
                     <div className="space-y-1">
                        <p className="text-[9px] font-black text-emerald-500/50 uppercase tracking-widest">Correction Path</p>
                        <p className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                           <ArrowRight size={14}/> {t.solution}
                        </p>
                     </div>
                  </div>
               </div>
             ))}
          </div>
       </section>

       <div className="grid grid-cols-2 gap-20 pt-20 border-t border-white/10">
          <section className="space-y-8">
             <h4 className="text-[12px] font-black text-blue-400 uppercase tracking-[0.5em] flex items-center gap-4">
                <Lightbulb size={20}/> 05 // TACTICAL_INSIGHTS
             </h4>
             <div className="space-y-4">
                {data.tips?.map((t: string, i: number) => (
                  <div key={i} className="flex gap-6 p-6 bg-blue-600/5 border border-blue-500/10 rounded-lg items-start hover:bg-blue-600/10 transition-all">
                     <Zap size={20} className="text-blue-400 mt-1 shrink-0 animate-pulse" />
                     <p className="text-sm font-black text-blue-200 uppercase tracking-tight leading-relaxed">{t}</p>
                  </div>
                ))}
             </div>
          </section>

          <section className="space-y-8">
             <h4 className="text-[12px] font-black text-emerald-500 uppercase tracking-[0.5em] flex items-center gap-4">
                <RefreshCcw size={20}/> 06 // POST_SYNC_VERIFICATION
             </h4>
             <div className="bg-emerald-500/[0.03] border border-emerald-500/10 p-10 rounded-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5 text-emerald-500">
                   <ShieldCheck size={100} />
                </div>
                <p className="text-lg font-medium text-emerald-400 leading-relaxed relative z-10">
                   {data.next_steps}
                </p>
             </div>
          </section>
       </div>
    </div>
  )
}

function SystemManualViewer({ data, context }: any) {
  const { devices, services, farModes } = context
  
  const linkedAssets = useMemo(() => {
    return devices?.filter((d: any) => data.overview?.asset_ids?.includes(d.id)) || []
  }, [devices, data.overview?.asset_ids])

  const linkedServices = useMemo(() => {
    return services?.filter((s: any) => data.overview?.service_ids?.includes(s.id)) || []
  }, [services, data.overview?.service_ids])

  const linkedFar = useMemo(() => {
    return farModes?.filter((fm: any) => data.operation?.far_ids?.includes(fm.id)) || []
  }, [farModes, data.operation?.far_ids])

  return (
    <div className="max-w-7xl mx-auto p-16 space-y-24">
       {/* Section 01: Business Value */}
       <section className="space-y-10">
          <div className="flex items-center gap-6 border-l-8 border-blue-600 pl-10">
             <Briefcase size={40} className="text-blue-500" />
             <div>
                <h3 className="text-4xl font-black uppercase tracking-tighter text-white leading-none">01 // STRATEGIC_VALUE_MATRIX</h3>
                <p className="text-[12px] text-slate-500 uppercase tracking-[0.4em] font-bold mt-2">Economic Impact & Primary Goals</p>
             </div>
          </div>
          <div className="grid grid-cols-2 gap-12 bg-white/[0.02] p-12 rounded-lg border border-white/5 relative overflow-hidden">
             <div className="space-y-10">
                <div className="space-y-4">
                   <h5 className="text-[11px] font-black text-blue-500 uppercase tracking-[0.3em] flex items-center gap-3">
                      <Target size={16}/> Business Problem Analysis
                   </h5>
                   <p className="text-xl font-medium text-slate-200 leading-relaxed border-l-2 border-white/10 pl-8">
                      {data.business_value?.business_problem}
                   </p>
                </div>
                <div className="grid grid-cols-2 gap-8">
                   <div className="bg-slate-900/50 p-6 rounded-lg border border-white/5 shadow-inner">
                      <h6 className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-3">ROI_PROJECTION</h6>
                      <p className="text-lg font-black text-white uppercase tracking-tighter">{data.business_value?.roi_projection}</p>
                   </div>
                   <div className="bg-slate-900/50 p-6 rounded-lg border border-white/5 shadow-inner">
                      <h6 className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-3">KPI_ANCHORS</h6>
                      <div className="flex flex-wrap gap-2">
                        {data.business_value?.kpis?.map((k: string) => (
                          <span key={k} className="text-[10px] font-black text-blue-400 uppercase">#{k}</span>
                        ))}
                      </div>
                   </div>
                </div>
             </div>
             <div className="space-y-8">
                <h5 className="text-[11px] font-black text-blue-500 uppercase tracking-[0.3em] flex items-center gap-3">
                   <Users size={16}/> Primary Beneficiary Network
                </h5>
                <div className="space-y-4">
                   {data.business_value?.beneficiaries?.map((b: any, i: number) => (
                     <div key={i} className="flex items-center gap-6 p-5 bg-white/[0.03] rounded-lg border border-white/5 group hover:bg-blue-600/10 transition-all">
                        <div className="w-12 h-12 rounded-lg bg-slate-900 border border-white/10 flex items-center justify-center text-blue-500 group-hover:bg-blue-600 group-hover:text-white transition-all">
                           <User size={20} />
                        </div>
                        <div>
                           <p className="text-sm font-black text-white uppercase">{b.who}</p>
                           <p className="text-[10px] font-bold text-slate-500 uppercase mt-1 tracking-tight">{b.value}</p>
                        </div>
                     </div>
                   ))}
                </div>
             </div>
          </div>
       </section>

       {/* Section 02: Overview */}
       <section className="space-y-10">
          <div className="flex items-center gap-6 border-l-8 border-emerald-600 pl-10">
             <Workflow size={40} className="text-emerald-500" />
             <div>
                <h3 className="text-4xl font-black uppercase tracking-tighter text-white leading-none">02 // ARCHITECTURAL_BLUEPRINT</h3>
                <p className="text-[12px] text-slate-500 uppercase tracking-[0.4em] font-bold mt-2">Systems, Services & Physical Nodes</p>
             </div>
          </div>
          <div className="grid grid-cols-3 gap-10">
             <div className="col-span-1 space-y-8">
                <div className="bg-emerald-600/[0.03] p-10 rounded-lg border border-emerald-500/10 space-y-8 h-full">
                   <div className="space-y-2">
                      <p className="text-[10px] font-black text-emerald-500/50 uppercase tracking-widest">OFFICIAL_IDENTIFIER</p>
                      <h4 className="text-3xl font-black text-white uppercase tracking-tighter leading-none">{data.overview?.official_name}</h4>
                   </div>
                   <div className="space-y-2">
                      <p className="text-[10px] font-black text-emerald-500/50 uppercase tracking-widest">RELEASE_SPEC</p>
                      <p className="text-lg font-black text-emerald-400 uppercase tracking-tighter">{data.overview?.version}</p>
                   </div>
                   <div className="pt-8 border-t border-white/5 space-y-4">
                      <h6 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                         <Lock size={12}/> SOURCE_CODE_METADATA
                      </h6>
                      <p className="text-xs font-bold text-slate-400 leading-relaxed">{data.overview?.source_config}</p>
                   </div>
                </div>
             </div>
             <div className="col-span-2 space-y-10">
                <div className="grid grid-cols-2 gap-8">
                   <div className="space-y-6">
                      <h5 className="text-[11px] font-black text-emerald-500 uppercase tracking-[0.3em] flex items-center gap-3">
                         <Box size={16}/> Functional Modules
                      </h5>
                      <div className="space-y-3">
                         {linkedServices.map((s: any) => (
                           <div key={s.id} className="p-4 bg-white/[0.02] border border-white/5 rounded-lg flex items-center justify-between group hover:border-emerald-500/30 transition-all">
                              <div className="flex items-center gap-3">
                                 <div className="w-8 h-8 rounded-lg bg-emerald-600/10 flex items-center justify-center text-emerald-500 group-hover:bg-emerald-600 group-hover:text-white transition-all">
                                    <Cpu size={14} />
                                 </div>
                                 <span className="text-[10px] font-black text-white uppercase">{s.name}</span>
                              </div>
                              <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">{s.service_type}</span>
                           </div>
                         ))}
                      </div>
                   </div>
                   <div className="space-y-6">
                      <h5 className="text-[11px] font-black text-emerald-500 uppercase tracking-[0.3em] flex items-center gap-3">
                         <HardDrive size={16}/> Physical Compute Nodes
                      </h5>
                      <div className="space-y-3">
                         {linkedAssets.map((d: any) => (
                           <div key={d.id} className="p-4 bg-white/[0.02] border border-white/5 rounded-lg flex items-center justify-between group hover:border-emerald-500/30 transition-all">
                              <div className="flex items-center gap-3">
                                 <div className="w-8 h-8 rounded-lg bg-emerald-600/10 flex items-center justify-center text-emerald-500 group-hover:bg-emerald-600 group-hover:text-white transition-all">
                                    <Server size={14} />
                                 </div>
                                 <span className="text-[10px] font-black text-white uppercase">{d.name}</span>
                              </div>
                              <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">{d.status}</span>
                           </div>
                         ))}
                      </div>
                   </div>
                </div>
             </div>
          </div>
       </section>

       {/* Section 03: Performance */}
       <section className="space-y-10">
          <div className="flex items-center gap-6 border-l-8 border-amber-600 pl-10">
             <TrendingUp size={40} className="text-amber-500" />
             <div>
                <h3 className="text-4xl font-black uppercase tracking-tighter text-white leading-none">03 // PERFORMANCE_BOUNDARIES</h3>
                <p className="text-[12px] text-slate-500 uppercase tracking-[0.4em] font-bold mt-2">SLOs, Capacity & Latency Controls</p>
             </div>
          </div>
          <div className="grid grid-cols-4 gap-8">
             <div className="bg-slate-900/80 p-10 rounded-lg border border-white/5 space-y-4 shadow-2xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-6 opacity-5 text-amber-500 group-hover:scale-110 transition-transform">
                   <Shield size={60} />
                </div>
                <p className="text-[9px] font-black text-amber-500/50 uppercase tracking-widest">AVAILABILITY_TARGET</p>
                <p className="text-4xl font-black text-white tracking-tighter">{data.performance?.availability_target}</p>
             </div>
             <div className="bg-slate-900/80 p-10 rounded-lg border border-white/5 space-y-4 shadow-2xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-6 opacity-5 text-amber-500 group-hover:scale-110 transition-transform">
                   <Clock size={60} />
                </div>
                <p className="text-[9px] font-black text-amber-500/50 uppercase tracking-widest">LATENCY_UPPER_BOUND</p>
                <p className="text-4xl font-black text-white tracking-tighter">{data.performance?.latency_limits}</p>
             </div>
             <div className="bg-slate-900/80 p-10 rounded-lg border border-white/5 space-y-4 shadow-2xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-6 opacity-5 text-amber-500 group-hover:scale-110 transition-transform">
                   <Zap size={60} />
                </div>
                <p className="text-[9px] font-black text-amber-500/50 uppercase tracking-widest">MAX_THROUGHPUT_CAP</p>
                <p className="text-4xl font-black text-white tracking-tighter">{data.performance?.throughput_capacity}</p>
             </div>
             <div className="bg-slate-900/80 p-10 rounded-lg border border-white/5 space-y-4 shadow-2xl flex flex-col justify-center">
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">CAPACITY_STRATEGY</p>
                <p className="text-xs font-bold text-slate-400 leading-relaxed">{data.performance?.capacity_methodology}</p>
             </div>
          </div>
       </section>

       {/* Section 04: Operation */}
       <section className="space-y-10">
          <div className="flex items-center gap-6 border-l-8 border-rose-600 pl-10">
             <Users size={40} className="text-rose-500" />
             <div>
                <h3 className="text-4xl font-black uppercase tracking-tighter text-white leading-none">04 // OPERATIONAL_RELIAIBLITY</h3>
                <p className="text-[12px] text-slate-500 uppercase tracking-[0.4em] font-bold mt-2">RACI, Failure Handling & Recovery Plan</p>
             </div>
          </div>
          <div className="grid grid-cols-2 gap-12 bg-white/[0.02] p-12 rounded-lg border border-white/5 relative overflow-hidden">
             <div className="space-y-10">
                <div className="grid grid-cols-2 gap-8">
                   <div className="space-y-1">
                      <p className="text-[9px] font-black text-rose-500/50 uppercase tracking-widest">OWNER_ORGANIZATION</p>
                      <p className="text-xl font-black text-white uppercase tracking-tighter">{data.operation?.owner_team}</p>
                   </div>
                   <div className="space-y-1">
                      <p className="text-[9px] font-black text-rose-500/50 uppercase tracking-widest">TECHNICAL_DRI</p>
                      <p className="text-xl font-black text-white uppercase tracking-tighter">{data.operation?.owner_individual}</p>
                   </div>
                </div>
                <div className="space-y-6">
                   <h5 className="text-[11px] font-black text-rose-500 uppercase tracking-[0.3em] flex items-center gap-3">
                      <ZapOff size={16}/> Top Failure Vectors (FAR)
                   </h5>
                   <div className="space-y-3">
                      {linkedFar.map((fm: any) => (
                        <div key={fm.id} className="p-4 bg-white/[0.02] border border-white/5 rounded-lg flex items-center justify-between group hover:bg-rose-600/10 transition-all">
                           <div className="flex items-center gap-3">
                              <AlertTriangle size={14} className="text-rose-500" />
                              <span className="text-[10px] font-black text-white uppercase">{fm.title}</span>
                           </div>
                           <div className="flex items-center gap-4">
                              <span className="text-[8px] font-black text-slate-500 uppercase">SEV_{fm.severity}</span>
                              <span className="px-2 py-0.5 rounded-lg bg-rose-600 text-white text-[8px] font-black">RPN_{fm.rpn}</span>
                           </div>
                        </div>
                      ))}
                   </div>
                </div>
             </div>
             <div className="space-y-10">
                <h5 className="text-[11px] font-black text-emerald-500 uppercase tracking-[0.3em] flex items-center gap-3">
                   <RefreshCcw size={16}/> Disaster Recovery Parameters
                </h5>
                <div className="grid grid-cols-2 gap-8">
                   <div className="bg-emerald-600/5 p-8 rounded-lg border border-emerald-500/10 space-y-2 group hover:bg-emerald-600/10 transition-all">
                      <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">RECOVERY_TIME_OBJ (RTO)</p>
                      <p className="text-4xl font-black text-white tracking-tighter leading-none">{data.operation?.dr_strategy?.rto}</p>
                      <p className="text-[9px] font-bold text-slate-600 uppercase mt-4">MAX_ALLOWED_DOWNTIME</p>
                   </div>
                   <div className="bg-emerald-600/5 p-8 rounded-lg border border-emerald-500/10 space-y-2 group hover:bg-emerald-600/10 transition-all">
                      <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">RECOVERY_POINT_OBJ (RPO)</p>
                      <p className="text-4xl font-black text-white tracking-tighter leading-none">{data.operation?.dr_strategy?.rpo}</p>
                      <p className="text-[9px] font-bold text-slate-600 uppercase mt-4">MAX_ALLOWED_DATA_LOSS</p>
                   </div>
                </div>
                <div className="space-y-4 pt-6 border-t border-white/5">
                   <h6 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                      <List size={14}/> SYSTEM_RACI_MATRIX
                   </h6>
                   <div className="grid grid-cols-2 gap-4">
                      {data.operation?.raci?.map((r: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                           <span className="text-[9px] font-black text-slate-500 uppercase">{r.role}</span>
                           <span className="text-[10px] font-black text-white uppercase tracking-tighter">{r.DRI}</span>
                        </div>
                      ))}
                   </div>
                </div>
             </div>
          </div>
       </section>
    </div>
  )
}

function QAViewer({ entry }: any) {
  const queryClient = useQueryClient()
  const [replyText, setReplyText] = useState('')
  const [activeReplyTo, setActiveReplyTo] = useState<any>(null)
  const [replyMeta, setReplyMeta] = useState({
    author: '',
    author_team: '',
    target_audience: 'Internal',
    entry_type: 'Follow-up',
    is_answer: false,
    is_verified: false
  })

  const qaMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiFetch('/api/v1/knowledge/qa', { method: 'POST', body: JSON.stringify(data) })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge'] })
      setReplyText('')
      setActiveReplyTo(null)
      toast.success('Sync Successful')
    }
  })

  const qaUpdateMutation = useMutation({
    mutationFn: async ({ qaId, patch }: any) => {
      const res = await apiFetch(`/api/v1/knowledge/qa/${qaId}`, { method: 'PUT', body: JSON.stringify(patch) })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge'] })
      toast.success('Contribution Updated')
    }
  })

  const handleSubmit = (parentId: number | null = null) => {
    if (!replyText) return
    qaMutation.mutate({
      knowledge_id: entry.id,
      parent_qa_id: parentId,
      content: replyText,
      author: replyMeta.author,
      author_team: replyMeta.author_team,
      target_audience: replyMeta.target_audience,
      entry_type: parentId ? (replyMeta.is_answer ? 'Answer' : replyMeta.entry_type) : replyMeta.entry_type,
      is_answer: parentId ? replyMeta.is_answer : false,
      is_verified: replyMeta.is_verified
    })
  }

  return (
    <div className="flex-1 flex flex-col bg-slate-900/30">
       <div className="flex-1 overflow-y-auto custom-scrollbar p-12 space-y-12">
          {/* Main Question Context */}
          <div className="max-w-4xl mx-auto space-y-8">
             <div className="bg-blue-600/5 border border-blue-500/20 p-10 rounded-lg relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-8 opacity-5 text-blue-500 group-hover:scale-110 transition-transform">
                   <HelpCircle size={100} />
                </div>
                <h4 className="text-[12px] font-black text-blue-500 uppercase tracking-[0.5em] mb-6 flex items-center gap-4">
                   <Info size={20}/> 00 // ORIGIN_INQUIRY
                </h4>
                <p className="text-2xl font-medium text-slate-200 leading-relaxed border-l-8 border-blue-600 pl-10 relative z-10">
                   {entry.question_context}
                </p>
                {entry.content && (
                  <div className="mt-8 pt-8 border-t border-white/5 prose prose-invert max-w-none text-slate-400 text-sm font-mono relative z-10">
                     {entry.content}
                  </div>
                )}
             </div>

             {/* Thread Timeline */}
             <div className="space-y-10 relative mt-16">
                <div className="absolute left-8 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-600/50 via-white/5 to-transparent rounded-lg" />
                
                {entry.qa_threads?.filter((qa: any) => !qa.parent_qa_id).map((qa: any) => (
                  <QANode
                    key={qa.id}
                    qa={qa}
                    onReply={(targetQa: any) => setActiveReplyTo(targetQa)}
                    onVerify={(targetQa: any) => qaUpdateMutation.mutate({
                      qaId: targetQa.id,
                      patch: {
                        parent_qa_id: targetQa.parent_qa_id,
                        content: targetQa.content,
                        author: targetQa.author,
                        author_team: targetQa.author_team,
                        target_audience: targetQa.target_audience,
                        entry_type: targetQa.entry_type,
                        is_answer: true,
                        is_verified: true,
                        metadata_json: targetQa.metadata_json || {}
                      }
                    })}
                  />
                ))}

                {entry.qa_threads?.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-slate-700 opacity-50 space-y-4">
                     <MessageSquare size={48} strokeWidth={1} />
                     <p className="text-[10px] font-black uppercase tracking-[0.3em]">Awaiting Collaborative Input...</p>
                  </div>
                )}
             </div>
          </div>
       </div>

       {/* Reply Interface */}
       <div className="p-8 bg-black/60 border-t border-white/10 backdrop-blur-3xl">
          <div className="max-w-4xl mx-auto space-y-4">
             {activeReplyTo && (
               <div className="flex items-center justify-between bg-blue-600/10 px-6 py-2 rounded-lg border border-blue-500/20">
                  <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest flex items-center gap-2">
                    <Reply size={12}/> Replying to contribution by {activeReplyTo.author}
                  </span>
                  <button onClick={() => setActiveReplyTo(null)} className="text-slate-500 hover:text-white"><X size={14}/></button>
               </div>
             )}
             <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <input
                  value={replyMeta.author}
                  onChange={e => setReplyMeta(prev => ({ ...prev, author: e.target.value }))}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white outline-none"
                  placeholder="AUTHOR"
                />
                <input
                  value={replyMeta.author_team}
                  onChange={e => setReplyMeta(prev => ({ ...prev, author_team: e.target.value }))}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white outline-none"
                  placeholder="TEAM"
                />
                <StyledSelect
                  value={replyMeta.target_audience}
                  onChange={e => setReplyMeta(prev => ({ ...prev, target_audience: e.target.value }))}
                  options={TARGET_AUDIENCES}
                />
                <StyledSelect
                  value={replyMeta.entry_type}
                  onChange={e => setReplyMeta(prev => ({ ...prev, entry_type: e.target.value }))}
                  options={[
                    { value: 'Follow-up', label: 'Follow-up' },
                    { value: 'Observation', label: 'Observation' },
                    { value: 'Answer', label: 'Answer' }
                  ]}
                />
                <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                  <label className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-300">
                    <input type="checkbox" checked={replyMeta.is_answer} onChange={e => setReplyMeta(prev => ({ ...prev, is_answer: e.target.checked }))} />
                    Answer
                  </label>
                  <label className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-300">
                    <input type="checkbox" checked={replyMeta.is_verified} onChange={e => setReplyMeta(prev => ({ ...prev, is_verified: e.target.checked }))} />
                    Verified
                  </label>
                </div>
             </div>
             <div className="flex gap-4">
                <div className="flex-1 relative">
                   <textarea 
                     value={replyText} 
                     onChange={e => setReplyText(e.target.value)}
                     className="w-full bg-white/5 border border-white/10 rounded-lg px-6 py-4 text-sm text-white placeholder:text-slate-700 outline-none focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/5 transition-all min-h-[60px] max-h-[200px] font-medium"
                     placeholder={activeReplyTo ? "Synchronize reply..." : "Inject new collaborative node..."}
                   />
                </div>
                <button 
                  onClick={() => handleSubmit(activeReplyTo?.id)}
                  disabled={!replyText || qaMutation.isPending}
                  aria-label="Send knowledge reply"
                  className="bg-blue-600 hover:bg-blue-500 text-white w-16 h-16 rounded-lg flex items-center justify-center shadow-xl shadow-blue-500/20 active:scale-95 transition-all disabled:opacity-50 disabled:grayscale"
                >
                   {qaMutation.isPending ? <RefreshCcw size={24} className="animate-spin"/> : <Send size={24}/>}
                </button>
             </div>
          </div>
       </div>
    </div>
  )
}

function QANode({ qa, onReply, onVerify }: any) {
  return (
    <div className="space-y-6">
       <div className="flex gap-8 group">
          <div className="relative z-10 shrink-0">
             <div className={`w-16 h-16 rounded-lg bg-slate-900 border-2 flex items-center justify-center text-xl font-black shadow-2xl transition-all group-hover:scale-110 ${
               qa.entry_type === 'Answer' ? 'border-emerald-500/50 text-emerald-500 group-hover:bg-emerald-600 group-hover:text-white' : 
               'border-blue-500/50 text-blue-500 group-hover:bg-blue-600 group-hover:text-white'
             }`}>
                {qa.author.substring(0, 2).toUpperCase()}
             </div>
          </div>
          <div className="flex-1 space-y-3 pb-4">
             <div className="flex items-center justify-between bg-white/[0.02] px-6 py-2 rounded-lg border border-white/5">
                <div className="flex items-center gap-4">
                   <span className="text-[10px] font-black text-white uppercase tracking-tighter">{qa.author}</span>
                   <span className="text-[8px] font-black text-slate-600 uppercase tracking-[0.2em]">{qa.author_team}</span>
                   {qa.is_verified && <span className="text-[8px] font-black bg-emerald-600 text-white px-2 py-0.5 rounded-lg">VERIFIED_DRI</span>}
                </div>
                <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">{formatAppDate(qa.created_at)}</span>
             </div>
             <div className={`p-6 rounded-lg border border-white/5 shadow-xl relative group-hover:border-blue-500/30 transition-all ${
               qa.entry_type === 'Answer' ? 'bg-emerald-600/5' : 'bg-slate-900/50'
             }`}>
                <p className="text-sm font-medium text-slate-200 leading-relaxed">{qa.content}</p>
                <div className="absolute bottom-4 right-6 flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-all">
                  {!qa.is_verified && (
                    <button
                      onClick={() => onVerify(qa)}
                      className="text-[9px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2"
                    >
                      <CheckCircle2 size={12}/> Verify Answer
                    </button>
                  )}
                  <button 
                    onClick={() => onReply(qa)}
                    className="text-[9px] font-black text-slate-600 uppercase tracking-widest hover:text-blue-400 transition-all flex items-center gap-2"
                  >
                     <Reply size={12}/> Add Follow-up
                  </button>
                </div>
             </div>

             {/* Nested Replies */}
             {qa.replies?.length > 0 && (
               <div className="mt-6 ml-8 space-y-6 relative">
                  <div className="absolute -left-6 top-0 bottom-4 w-px bg-white/10" />
                  {qa.replies.map((reply: any) => (
                    <QANode key={reply.id} qa={reply} onReply={onReply} onVerify={onVerify} />
                  ))}
               </div>
             )}
          </div>
       </div>
    </div>
  )
}
