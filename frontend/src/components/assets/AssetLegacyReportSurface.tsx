import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Box, Calendar, Cpu as CpuIcon, Edit2, Eye, ExternalLink, Layers, Network, Search, Shield } from 'lucide-react'
import { motion } from 'framer-motion'
import { formatAppDate, formatAppDay } from '../../utils/dateUtils'
import { buildAssetTopology } from './assetTopology'
import { AssetTopologyCanvas } from './AssetTopologyCanvas'
import { WorkspaceEmptyState } from '../shared/OperationalWorkspacePrimitives'
import { AssetServicesTable, MetadataViewer, MiniMonitoringTable } from '../AssetGrid_Legacy'
import { HWTable, RelationshipsTab, SecretsTable } from './AssetDetailsView'

type AssetLegacyReportSurfaceProps = {
  assets: any[]
  options: any[]
  allAssets: any[]
  connections: any[]
  relationships: any[]
  selectedAssetId?: number | null
  focusSection?: string | null
  onFocusSectionHandled?: () => void
  onSelectAsset?: (asset: any) => void
  onEdit: (asset: any) => void
  onOpenDetails?: (asset: any) => void
  onOpenQuickLook?: (asset: any) => void
  onViewServiceDetails: (service: any) => void
  onEditService: (service: any) => void
  getConsoleUrl?: (asset: any) => string | null
}

const REPORT_SECTION_LINKS = [
  { id: 'overview', label: 'Overview' },
  { id: 'hardware-summary', label: 'Hardware' },
  { id: 'lifecycle', label: 'Lifecycle' },
  { id: 'services', label: 'Services' },
  { id: 'monitoring', label: 'Monitoring' },
  { id: 'security', label: 'Secrets' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'components', label: 'Components' },
  { id: 'relationships', label: 'Relationships' },
] as const

const STATUS_ITEMS = [
  { value: 'Active', label: 'Active' },
  { value: 'Maintenance', label: 'Maintenance' },
  { value: 'Failed', label: 'Failed' },
  { value: 'Provisioning', label: 'Provisioning' },
  { value: 'Reserved', label: 'Reserved' },
  { value: 'Offline', label: 'Offline' },
]

const ENVIRONMENT_ITEMS = [
  { value: 'Production', label: 'Production' },
  { value: 'Staging', label: 'Staging' },
  { value: 'Development', label: 'Development' },
  { value: 'Lab', label: 'Lab' },
]

const ASSET_TYPES = [
  { value: 'Physical', label: 'Physical' },
  { value: 'Virtual', label: 'Virtual' },
  { value: 'Storage', label: 'Storage' },
  { value: 'Switch', label: 'Switch' },
  { value: 'Firewall', label: 'Firewall' },
  { value: 'Load Balancer', label: 'Load Balancer' },
]

function ConnectionMap({ deviceId, type, devices, relationships, connections }: {
  deviceId: number; type: 'dependency' | 'network'; devices: any[]; relationships: any[]; connections: any[]
}) {
  const graph = useMemo(() => buildAssetTopology({ assets: devices, rootIds: [Number(deviceId)],
    relationships: type === 'dependency' ? relationships : [], connections: type === 'network' ? connections : [], depth: 1
  }), [connections, deviceId, devices, relationships, type])
  return graph.links.length ? <AssetTopologyCanvas graph={graph} selectedId={Number(deviceId)} controls={false} />
    : <div className="report-map-empty">No registered {type === 'dependency' ? 'dependency' : 'network'} links.</div>
}

export function AssetLegacyReportSurface({
  assets,
  options,
  allAssets,
  connections,
  relationships,
  selectedAssetId,
  focusSection,
  onFocusSectionHandled,
  onSelectAsset,
  onEdit,
  onOpenDetails,
  onOpenQuickLook,
  onViewServiceDetails,
  onEditService,
  getConsoleUrl,
}: AssetLegacyReportSurfaceProps) {
  const [localSelectedId, setLocalSelectedId] = useState<number | null>(assets[0]?.id ?? null)
  const controlled = selectedAssetId !== undefined
  const selectedId = controlled ? selectedAssetId : localSelectedId
  const [filter, setFilter] = useState({ name: '', system: '', type: '', status: '', env: '' })
  const reportSectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const filteredAssets = useMemo(() => {
    return assets.filter((asset: any) => {
      const matchName = String(asset.name || '').toLowerCase().includes(filter.name.toLowerCase())
      const matchSystem = !filter.system || asset.system === filter.system
      const matchType = !filter.type || asset.type === filter.type
      const matchStatus = !filter.status || asset.status === filter.status
      const matchEnv = !filter.env || asset.environment === filter.env
      return matchName && matchSystem && matchType && matchStatus && matchEnv
    })
  }, [assets, filter])

  const selectedAsset = useMemo(
    () => filteredAssets.find((asset: any) => asset.id === selectedId) || filteredAssets[0] || null,
    [filteredAssets, selectedId]
  )

  useEffect(() => {
    if (!selectedAsset || selectedAsset.id === selectedId) return
    if (controlled) onSelectAsset?.(selectedAsset)
    else setLocalSelectedId(selectedAsset.id)
  }, [controlled, onSelectAsset, selectedAsset, selectedId])

  useEffect(() => {
    if (!focusSection) return
    const sectionNode = reportSectionRefs.current[focusSection]
    if (sectionNode) {
      sectionNode.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
      onFocusSectionHandled?.()
    }
  }, [focusSection, onFocusSectionHandled, selectedAsset])

  const getOptions = (category: string) => Array.isArray(options) ? options.filter((item: any) => item.category === category) : []
  const selectedConsoleUrl = selectedAsset ? getConsoleUrl?.(selectedAsset) || null : null

  const scrollToSection = (sectionId: string) => {
    reportSectionRefs.current[sectionId]?.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <div data-asset-report className="asset-report flex min-h-0 flex-1 flex-col gap-4 overflow-hidden md:flex-row">
      <div className="asset-report-sidebar flex max-h-[22rem] w-full flex-col overflow-hidden rounded-lg border border-white/5 bg-black/20 md:max-h-none md:w-72 md:min-w-72 xl:w-80 xl:min-w-80">
        <div className="space-y-3 border-b border-white/5 bg-white/5 p-4">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={filter.name}
              aria-label="Search report assets"
              onChange={(event) => setFilter((current) => ({ ...current, name: event.target.value }))}
              placeholder="Search Assets..."
              className="w-full rounded-lg border border-white/5 bg-black/40 py-2 pl-9 pr-4 text-[10px] font-bold uppercase outline-none transition-all focus:border-blue-500/50"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select aria-label="Report system" value={filter.system} onChange={(event) => setFilter((current) => ({ ...current, system: event.target.value }))} className="rounded-lg border border-white/5 bg-black/40 px-2 py-1.5 text-[9px] font-bold uppercase text-slate-400 outline-none">
              <option value="">All Systems</option>
              {getOptions('LogicalSystem').map((item: any) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select aria-label="Report asset type" value={filter.type} onChange={(event) => setFilter((current) => ({ ...current, type: event.target.value }))} className="rounded-lg border border-white/5 bg-black/40 px-2 py-1.5 text-[9px] font-bold uppercase text-slate-400 outline-none">
              <option value="">All Types</option>
              {ASSET_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select aria-label="Report status" value={filter.status} onChange={(event) => setFilter((current) => ({ ...current, status: event.target.value }))} className="rounded-lg border border-white/5 bg-black/40 px-2 py-1.5 text-[9px] font-bold uppercase text-slate-400 outline-none">
              <option value="">All Statuses</option>
              {STATUS_ITEMS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select aria-label="Report environment" value={filter.env} onChange={(event) => setFilter((current) => ({ ...current, env: event.target.value }))} className="rounded-lg border border-white/5 bg-black/40 px-2 py-1.5 text-[9px] font-bold uppercase text-slate-400 outline-none">
              <option value="">All Envs</option>
              {ENVIRONMENT_ITEMS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
        </div>

        <div className="custom-scrollbar flex-1 space-y-1 overflow-y-auto p-2">
          {filteredAssets.map((asset: any) => (
            <button
              key={asset.id}
              type="button"
              aria-pressed={selectedAsset?.id === asset.id}
              onClick={() => {
                if (controlled) onSelectAsset?.(asset)
                else {
                  setLocalSelectedId(asset.id)
                  onSelectAsset?.(asset)
                }
              }}
              className={`group relative w-full overflow-hidden rounded-lg p-3 text-left transition-all ${selectedAsset?.id === asset.id ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-white/5'}`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="truncate pr-2 text-[11px] font-bold uppercase tracking-tighter">{asset.name}</span>
                <span className={`rounded-lg border px-1.5 py-0.5 text-[11px] font-bold ${
                  asset.status === 'Active' ? 'border-emerald-500/20 bg-emerald-500/20 text-emerald-400' :
                  asset.status === 'Maintenance' ? 'border-amber-500/20 bg-amber-500/20 text-amber-400' :
                  asset.status === 'Failed' ? 'border-rose-500/20 bg-rose-500/20 text-rose-400' :
                  'border-white/10 bg-white/5 text-slate-400'
                } ${selectedAsset?.id === asset.id ? 'border-white/40 text-white' : ''}`}>
                  {asset.status}
                </span>
              </div>
              <div className="flex items-center space-x-2 text-[11px] font-bold opacity-60">
                <span>{asset.system}</span>
                <span className="h-1 w-1 rounded-full bg-current opacity-30" />
                <span>{asset.type}</span>
              </div>
              {selectedAsset?.id === asset.id ? <motion.div layoutId="asset-report-active-indicator" className="absolute bottom-0 left-0 top-0 w-1 bg-white" /> : null}
            </button>
          ))}
          {!filteredAssets.length ? <WorkspaceEmptyState title="No matching assets" description="Adjust your filters or add new assets to the matrix." /> : null}
        </div>
      </div>

      <div className="asset-report-content custom-scrollbar min-w-0 flex-1 overflow-y-auto rounded-lg border border-white/5 bg-[#0a0c14]/40">
        {selectedAsset ? (
          <div className="space-y-8 p-6 lg:p-8 xl:p-10">
            <div className="sticky top-0 z-20 -mx-6 border-b border-white/5 bg-[#0a0c14]/95 px-6 py-4 backdrop-blur-xl lg:hidden">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[8px] font-black uppercase tracking-[0.24em] text-blue-400">{selectedAsset.system}</p>
                  <h2 className="truncate text-sm font-black uppercase tracking-[0.08em] text-white">{selectedAsset.name}</h2>
                </div>
                <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[9px] font-bold uppercase text-slate-300">
                  {selectedAsset.status}
                </span>
              </div>
              <div className="custom-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
                <ReportQuickAction label="Modify Config" icon={<Edit2 size={14} />} onClick={() => onEdit(selectedAsset)} />
                {onOpenDetails ? <ReportQuickAction label="Details" icon={<Box size={14} />} onClick={() => onOpenDetails(selectedAsset)} /> : null}
                {onOpenQuickLook ? <ReportQuickAction label="Quick Look" icon={<Eye size={14} />} onClick={() => onOpenQuickLook(selectedAsset)} /> : null}
                {selectedConsoleUrl ? <ReportQuickAction label="Quick Console" icon={<ExternalLink size={14} />} href={selectedConsoleUrl} /> : null}
              </div>
              <div className="custom-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
                {REPORT_SECTION_LINKS.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => scrollToSection(section.id)}
                    className="shrink-0 rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-300 transition-all hover:border-blue-500/30 hover:text-white"
                  >
                    {section.label}
                  </button>
                ))}
              </div>
            </div>

            <div ref={(node) => { reportSectionRefs.current.overview = node }} data-report-section="overview" className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1 space-y-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-6">
                  <div className="w-fit rounded-lg bg-blue-600 p-3 text-white shadow-xl shadow-blue-500/20 ring-4 ring-blue-500/10">
                    <Box size={28} />
                  </div>
                  <div className="min-w-0">
                    <h1 className="break-words text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl">{selectedAsset.name}</h1>
                    <div className="mt-2 flex flex-wrap items-center gap-3 md:gap-4">
                      <span className="text-[14px] font-bold uppercase tracking-[0.3em] text-blue-400">{selectedAsset.system}</span>
                      <span className="h-1.5 w-1.5 rounded-full bg-white/10" />
                      <span className="break-words text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">{selectedAsset.type} // {selectedAsset.environment} // {selectedAsset.owner || 'NO OWNER'}</span>
                    </div>
                  </div>
                </div>

                <div className="asset-report-addresses grid gap-4 rounded-lg border border-white/5 bg-black/40 p-5">
                  <div className="flex flex-col">
                    <span className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Operational State</span>
                    <span className={`w-fit rounded-lg border px-4 py-1 text-[11px] font-bold uppercase ${
                      selectedAsset.status === 'Active' ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400' :
                      selectedAsset.status === 'Maintenance' ? 'border-amber-500/20 bg-amber-500/5 text-amber-400' :
                      'border-rose-500/20 bg-rose-500/5 text-rose-400'
                    }`}>{selectedAsset.status}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Primary Network IP</span>
                    <span className="break-words text-base font-bold text-blue-400">{selectedAsset.primary_ip || 'Not recorded'}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Management OOB IP</span>
                    <span className="break-words text-base font-bold text-indigo-400">{selectedAsset.management_ip || 'Not recorded'}</span>
                  </div>
                </div>
              </div>

              <div className="flex w-full shrink-0 flex-col gap-3 xl:w-auto xl:items-end">
                <button type="button" onClick={() => onEdit(selectedAsset)} className="flex w-full items-center justify-center space-x-3 rounded-lg bg-blue-600 px-6 py-3 text-[11px] font-bold uppercase tracking-widest text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-500 xl:w-auto">
                  <Edit2 size={16} />
                  <span>Modify Config</span>
                </button>
                <div className="hidden flex-wrap items-center justify-end gap-2 lg:flex">
                  {onOpenQuickLook ? (
                    <button type="button" onClick={() => onOpenQuickLook(selectedAsset)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-300 transition-all hover:border-white/20 hover:text-white">
                      Quick Look
                    </button>
                  ) : null}
                  {onOpenDetails ? (
                    <button type="button" onClick={() => onOpenDetails(selectedAsset)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-300 transition-all hover:border-white/20 hover:text-white">
                      Details
                    </button>
                  ) : null}
                  {selectedConsoleUrl ? (
                    <a href={selectedConsoleUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-300 transition-all hover:border-white/20 hover:text-white">
                      Quick Console
                    </a>
                  ) : null}
                </div>
                <div className="text-left xl:text-right">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Record updated</p>
                  <p className="text-[10px] font-mono text-slate-400">{selectedAsset.updated_at ? formatAppDate(selectedAsset.updated_at) : 'Not recorded'}</p>
                </div>
              </div>
            </div>

            <nav aria-label="Report sections" className="hidden flex-wrap gap-2 lg:flex">
              {REPORT_SECTION_LINKS.map(section => <button key={section.id} type="button" onClick={() => scrollToSection(section.id)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300">{section.label}</button>)}
            </nav>
            <div className="grid gap-4 rounded-lg border border-white/5 bg-white/5 p-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
              <Metric label="Power Avg/Max" value={`${selectedAsset.power_typical_w || 0}W / ${selectedAsset.power_max_w || 0}W`} />
              <Metric label="Site Location" value={selectedAsset.site_name || 'UNPLACED'} tone="text-blue-400" />
              <Metric label="Rack ID" value={selectedAsset.rack_name || 'N/A'} />
              <Metric label="U Position" value={`${selectedAsset.u_start || '--'}U`} tone="text-indigo-400" />
              <Metric label="Form Factor" value={`${selectedAsset.size_u || 1}U / ${selectedAsset.depth || 'Full'}`} />
              <Metric label="Asset Tag" value={selectedAsset.asset_tag || 'NO TAG'} tone="text-amber-500" />
            </div>

            <div className="grid items-stretch gap-8 2xl:grid-cols-2">
              <div ref={(node) => { reportSectionRefs.current['hardware-summary'] = node }} data-report-section="hardware-summary" className="flex h-full flex-col space-y-6">
                <SectionTitle icon={<CpuIcon size={16} className="text-amber-400" />} title="Hardware & System Architecture" />
                <div className="grid flex-1 gap-x-12 gap-y-8 rounded-lg border border-white/5 bg-black/20 p-6 lg:grid-cols-2 xl:p-8">
                  <div>
                    <p className="mb-1 text-[8px] font-bold uppercase tracking-[0.2em] text-slate-500">Platform Identity</p>
                    <p className="text-sm font-bold text-[var(--text-primary)]">{[selectedAsset.manufacturer, selectedAsset.model].filter(Boolean).join(' ') || 'Not recorded'}</p>
                    <p className="mt-1 text-[10px] font-mono text-slate-500">SN: {selectedAsset.serial_number || 'UNKNOWN'}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-[8px] font-bold uppercase tracking-[0.2em] text-slate-500">Operating Environment</p>
                    <p className="text-sm font-bold uppercase text-blue-400">{selectedAsset.os_name} {selectedAsset.os_version}</p>
                    <p className="mt-1 text-[10px] font-bold uppercase text-slate-500">Registry Depth: {selectedAsset.depth || 'Full'}</p>
                  </div>
                  <div className="lg:col-span-2">
                    <p className="mb-2 text-[8px] font-bold uppercase tracking-[0.2em] text-slate-500">Hardware summary</p>
                    <div className="rounded-lg border border-white/5 bg-black/40 p-4">
                      <p className="text-xs font-bold uppercase leading-relaxed text-slate-300">{selectedAsset.hardware_summary || 'No hardware details registered for this unit.'}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div ref={(node) => { reportSectionRefs.current.lifecycle = node }} data-report-section="lifecycle" className="flex h-full flex-col space-y-6">
                <SectionTitle icon={<Calendar size={16} className="text-rose-400" />} title="Lifecycle & Logistics Registry" />
                <div className="grid flex-1 gap-8 rounded-lg border border-white/5 bg-black/20 p-6 lg:grid-cols-2 xl:p-8">
                  <div className="space-y-8">
                    <MetricBlock label="Deployment date" value={formatAppDay(selectedAsset.install_date)} meta={`Asset age: ${selectedAsset.hardware_age || 'Not recorded'}`} />
                    <MetricBlock label="Warranty Coverage" value={selectedAsset.warranty_end ? formatAppDay(selectedAsset.warranty_end) : 'Not recorded'} />
                  </div>
                  <div className="space-y-8 lg:text-right">
                    <MetricBlock label="Acquisition Date" value={formatAppDay(selectedAsset.purchase_date)} />
                    <MetricBlock label="Retirement EOL" value={selectedAsset.eol_date ? formatAppDay(selectedAsset.eol_date) : 'No retirement date'} tone="text-rose-400" />
                  </div>
                </div>
              </div>
            </div>

            <div ref={(node) => { reportSectionRefs.current.services = node }} data-report-section="services" className="space-y-6">
              <SectionTitle icon={<Layers size={16} className="text-blue-400" />} title="Hosted Logical Services" />
              <div className="overflow-hidden rounded-lg border border-white/5 bg-black/10">
                <AssetServicesTable deviceId={selectedAsset.id} onViewDetails={onViewServiceDetails} onEdit={onEditService} />
              </div>
            </div>

            <div ref={(node) => { reportSectionRefs.current.monitoring = node }} data-report-section="monitoring" className="space-y-6">
              <SectionTitle icon={<Activity size={16} className="text-emerald-400" />} title="Monitoring & Telemetry Nodes" />
              <div className="overflow-hidden rounded-lg border border-white/5 bg-black/10">
                <MiniMonitoringTable deviceId={selectedAsset.id} />
              </div>
            </div>

            <div ref={(node) => { reportSectionRefs.current.security = node }} data-report-section="security" className="space-y-6">
              <SectionTitle icon={<Shield size={16} className="text-amber-500" />} title="Security Credentials & Secrets" />
              <div className="overflow-hidden rounded-lg border border-white/5 bg-black/10">
                <SecretsTable deviceId={selectedAsset.id} />
              </div>
            </div>

            <div ref={(node) => { reportSectionRefs.current.metadata = node }} data-report-section="metadata" className="space-y-6">
              <SectionTitle icon={<Box size={16} className="text-violet-400" />} title="Registry Metadata Payload" />
              <div className="rounded-lg border border-white/5 bg-black/20 p-8">
                <MetadataViewer data={selectedAsset.metadata_json || {}} />
              </div>
            </div>

            <div ref={(node) => { reportSectionRefs.current.components = node }} data-report-section="components" className="space-y-6">
              <SectionTitle icon={<CpuIcon size={16} className="text-cyan-400" />} title="Physical Component Inventory" />
              <div className="overflow-hidden rounded-lg border border-white/5 bg-black/10">
                <HWTable deviceId={selectedAsset.id} />
              </div>
            </div>

            <div ref={(node) => { reportSectionRefs.current.relationships = node }} data-report-section="relationships" className="space-y-6">
              <SectionTitle icon={<Network size={16} className="text-indigo-400" />} title="Relationship, Dependency & Network Context" />
              <div className="grid gap-8 xl:grid-cols-2">
                <div className="overflow-hidden rounded-lg border border-white/5 bg-black/10">
                  <RelationshipsTab deviceId={selectedAsset.id} />
                </div>
                <div className="space-y-6 rounded-lg border border-white/5 bg-black/10 p-6">
                  <div className="space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Registry Context</p>
                    <div className="grid grid-cols-2 gap-4">
                      <MetricBlock label="Owner" value={selectedAsset.owner || 'Unowned'} />
                      <MetricBlock label="Exposure" value={selectedAsset.management_ip || selectedAsset.primary_ip || 'No address recorded'} />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Dependency Vector Map</p>
                    <ConnectionMap deviceId={selectedAsset.id} type="dependency" devices={allAssets} relationships={relationships} connections={connections} />
                  </div>
                  <div className="space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Network Interconnect Map</p>
                    <ConnectionMap deviceId={selectedAsset.id} type="network" devices={allAssets} relationships={relationships} connections={connections} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-12">
            <WorkspaceEmptyState title="No asset selected" description="Choose an asset from the report rail or clear narrowing filters to load the dossier." />
          </div>
        )}
      </div>
    </div>
  )
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center space-x-3 border-b border-white/5 pb-2">
      {icon}
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
    </div>
  )
}

function Metric({ label, value, tone = 'text-[var(--text-primary)]' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col">
      <span className="mb-1 text-[8px] font-bold uppercase tracking-widest text-slate-500">{label}</span>
      <span className={`text-xs font-bold uppercase ${tone}`}>{value}</span>
    </div>
  )
}

function MetricBlock({ label, value, meta, tone = 'text-[var(--text-primary)]' }: { label: string; value: string; meta?: string; tone?: string }) {
  return (
    <div>
      <p className="mb-1 text-[8px] font-bold uppercase text-slate-500">{label}</p>
      <p className={`text-sm font-bold uppercase ${tone}`}>{value}</p>
      {meta ? <p className="mt-1 text-[10px] font-bold uppercase text-blue-400">{meta}</p> : null}
    </div>
  )
}

function ReportQuickAction({
  label,
  icon,
  onClick,
  href,
}: {
  label: string
  icon: React.ReactNode
  onClick?: () => void
  href?: string
}) {
  const className = 'inline-flex shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-200 transition-all hover:border-blue-500/30 hover:bg-white/10 hover:text-white'

  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {icon}
        <span>{label}</span>
      </a>
    )
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {icon}
      <span>{label}</span>
    </button>
  )
}
