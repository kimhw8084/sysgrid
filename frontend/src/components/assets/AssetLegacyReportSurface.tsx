import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Box, Calendar, Cpu as CpuIcon, Edit2, Eye, ExternalLink, Layers, Network, Search, Shield } from 'lucide-react'
import { formatAppDate, formatAppDay } from '../../utils/dateUtils'
import { buildAssetTopology } from './assetTopology'
import { AssetTopologyCanvas } from './AssetTopologyCanvas'
import { WorkspaceEmptyState } from '../shared/OperationalWorkspacePrimitives'
import { StatusPill } from '../shared/StatusPill'
import { ASSET_ENVIRONMENTS, ASSET_STATUSES, ASSET_TYPES, assetFilterOptions } from './assetRecordOptions'
import { AssetServicesTable, MetadataViewer, MiniMonitoringTable } from '../AssetGrid_Legacy'
import { HWTable, RelationshipsTab, SecretsTable } from './AssetDetailsView'
import { getAssetWorkSignal } from './assetWorkSignals'

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
  maintenanceWindows?: any[]
  operationalActions?: any[]
  workDataState?: { isLoading?: boolean; isError?: boolean; isFetching?: boolean; onRetry?: () => void }
  onOpenMaintenance?: (asset: any) => void
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
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'security', label: 'Secrets' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'components', label: 'Components' },
  { id: 'relationships', label: 'Relationships' },
] as const

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
  maintenanceWindows = [],
  operationalActions = [],
  workDataState,
  onOpenMaintenance,
  onViewServiceDetails,
  onEditService,
  getConsoleUrl,
}: AssetLegacyReportSurfaceProps) {
  const [localSelectedId, setLocalSelectedId] = useState<number | null>(assets[0]?.id ?? null)
  const controlled = selectedAssetId !== undefined
  const selectedId = controlled ? selectedAssetId : localSelectedId
  const [filter, setFilter] = useState({ name: '', system: '', type: '', status: '', env: '' })
  const reportSectionRefs = useRef<Record<string, HTMLElement | null>>({})

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
      scrollToSection(focusSection)
      onFocusSectionHandled?.()
    }
  }, [focusSection, onFocusSectionHandled, selectedAsset])

  const getOptions = (category: string) => Array.isArray(options) ? options.filter((item: any) => item.category === category) : []
  const filterOptions = (field: 'system' | 'type' | 'status' | 'environment', category: string, defaults: string[] = []) => (
    assetFilterOptions(defaults, getOptions(category), assets.map(asset => asset[field]))
  )
  const selectedConsoleUrl = selectedAsset ? getConsoleUrl?.(selectedAsset) || null : null
  const workSignal = useMemo(() => selectedAsset
    ? getAssetWorkSignal(selectedAsset.id, maintenanceWindows, operationalActions)
    : null, [maintenanceWindows, operationalActions, selectedAsset])
  const recentAssetActions = workSignal?.actions.slice().sort((left: any, right: any) =>
    Date.parse(String(right.requested_at || '')) - Date.parse(String(left.requested_at || '')),
  ) || []

  const scrollToSection = (sectionId: string) => {
    const section = reportSectionRefs.current[sectionId]
    if (!section) return
    const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    const pane = section.closest<HTMLElement>('.asset-report-content')
    if (pane && ['auto', 'scroll'].includes(getComputedStyle(pane).overflowY)) {
      const viewport = pane.closest<HTMLElement>('#sg-main-content')
      if (viewport) {
        const bounds = pane.getBoundingClientRect(), available = viewport.getBoundingClientRect()
        if (bounds.bottom > available.bottom) viewport.scrollTo({ top: viewport.scrollTop + bounds.bottom - available.bottom + 16, behavior: 'auto' })
      }
      const navigationHeight = pane.querySelector('nav')?.getBoundingClientRect().height || 0
      pane.scrollTo({ top: Math.max(0, pane.scrollTop + section.getBoundingClientRect().top - pane.getBoundingClientRect().top - navigationHeight - 16), behavior })
    } else section.scrollIntoView({ behavior, block: 'start' })
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
              {filterOptions('system', 'LogicalSystem').map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select aria-label="Report asset type" value={filter.type} onChange={(event) => setFilter((current) => ({ ...current, type: event.target.value }))} className="rounded-lg border border-white/5 bg-black/40 px-2 py-1.5 text-[9px] font-bold uppercase text-slate-400 outline-none">
              <option value="">All Types</option>
              {filterOptions('type', 'DeviceType', ASSET_TYPES).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select aria-label="Report status" value={filter.status} onChange={(event) => setFilter((current) => ({ ...current, status: event.target.value }))} className="rounded-lg border border-white/5 bg-black/40 px-2 py-1.5 text-[9px] font-bold uppercase text-slate-400 outline-none">
              <option value="">All Statuses</option>
              {filterOptions('status', 'Status', ASSET_STATUSES.filter(value => value !== 'Deleted')).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select aria-label="Report environment" value={filter.env} onChange={(event) => setFilter((current) => ({ ...current, env: event.target.value }))} className="rounded-lg border border-white/5 bg-black/40 px-2 py-1.5 text-[9px] font-bold uppercase text-slate-400 outline-none">
              <option value="">All Envs</option>
              {filterOptions('environment', 'Environment', ASSET_ENVIRONMENTS).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
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
              className={`group relative w-full overflow-hidden rounded-lg p-3 text-left ${selectedAsset?.id === asset.id ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-white/5'}`}
            >
              <div className="asset-report-rail-name">{asset.name}</div>
              <div className="asset-report-rail-meta">
                <span title={[asset.system, asset.type].filter(Boolean).join(' · ')}>{[asset.system, asset.type].filter(Boolean).join(' · ')}</span>
                <span data-report-status><StatusPill value={asset.status} fontSize={12} /></span>
              </div>
              {selectedAsset?.id === asset.id ? <span aria-hidden="true" className="absolute bottom-0 left-0 top-0 w-1 bg-white" /> : null}
            </button>
          ))}
          {!filteredAssets.length ? <WorkspaceEmptyState title="No matching assets" description="Adjust your filters or add new assets to the matrix." /> : null}
        </div>
      </div>

      <div className="asset-report-content custom-scrollbar min-w-0 flex-1 overflow-y-auto rounded-lg border border-white/5 bg-[#0a0c14]/40">
        {selectedAsset ? (
          <div className="asset-report-body space-y-6 p-4 lg:p-5">
            <nav aria-label="Report sections" className="asset-report-sections">
              {REPORT_SECTION_LINKS.map(section => <button key={section.id} type="button" onClick={() => scrollToSection(section.id)}>{section.label}</button>)}
            </nav>
            <section ref={(node) => { reportSectionRefs.current.overview = node }} data-report-section="overview" className="asset-report-overview">
              <header className="asset-report-record-header">
                <div className="asset-report-record-identity">
                  <span className="asset-report-record-icon"><Box size={22} aria-hidden="true" /></span>
                  <div>
                    <h1>{selectedAsset.name}</h1>
                    <p><strong>{selectedAsset.system || 'Unassigned system'}</strong><span>{selectedAsset.type} · {selectedAsset.environment} · {selectedAsset.owner || 'Unassigned owner'}</span></p>
                  </div>
                </div>
                <div className="asset-report-record-actions">
                  <button type="button" onClick={() => onEdit(selectedAsset)} className="asset-report-edit"><Edit2 size={15} aria-hidden="true" />Modify Config</button>
                  {onOpenDetails ? <ReportQuickAction label="Details" icon={<Box size={14} aria-hidden="true" />} onClick={() => onOpenDetails(selectedAsset)} /> : null}
                  {onOpenQuickLook ? <ReportQuickAction label="Quick Look" icon={<Eye size={14} aria-hidden="true" />} onClick={() => onOpenQuickLook(selectedAsset)} /> : null}
                  {selectedConsoleUrl ? <ReportQuickAction label="Quick Console" icon={<ExternalLink size={14} aria-hidden="true" />} href={selectedConsoleUrl} /> : null}
                </div>
              </header>
              <div className="asset-report-addresses grid gap-3 rounded-lg border border-white/5 bg-black/40 p-3">
                <div className="flex flex-col"><span className="mb-1 text-xs text-slate-500">Operational State</span><span data-report-status><StatusPill value={selectedAsset.status} fontSize={12} /></span></div>
                <div className="flex flex-col"><span className="mb-1 text-xs text-slate-500">Primary Network IP</span><span className="break-words font-semibold text-blue-400">{selectedAsset.primary_ip || 'Not recorded'}</span></div>
                <div className="flex flex-col"><span className="mb-1 text-xs text-slate-500">Management OOB IP</span><span className="break-words font-semibold text-indigo-400">{selectedAsset.management_ip || 'Not recorded'}</span></div>
              </div>
              <p className="asset-report-updated">Record updated <span>{selectedAsset.updated_at ? formatAppDate(selectedAsset.updated_at) : 'Not recorded'}</span></p>
            </section>
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

            <section ref={(node) => { reportSectionRefs.current.maintenance = node }} data-report-section="maintenance" className="space-y-6">
              <SectionTitle icon={<Activity size={16} className="text-amber-400" />} title="Maintenance & Operational Work" />
              {workDataState?.isLoading && <p role="status" className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] p-4 text-sm text-[var(--text-secondary)]">Loading maintenance windows and recorded actions…</p>}
              {workDataState?.isError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--state-warning-border)] bg-[var(--state-warning-surface)] p-4 text-sm"><span>Work history is incomplete. Missing records are not treated as an empty history.</span>{workDataState.onRetry && <button type="button" onClick={workDataState.onRetry} disabled={workDataState.isFetching} className="rounded-md border border-[var(--border-default)] px-3 py-2 font-semibold">{workDataState.isFetching ? 'Retrying…' : 'Retry work history'}</button>}</div>}
              <div className="asset-report-work-summary">
                <div><span>Current signal</span><strong data-work-signal={workDataState?.isError ? 'unavailable' : workSignal?.level}>{workDataState?.isError ? 'Unavailable' : workSignal?.label || 'No work recorded'}</strong></div>
                <div><span>Open maintenance windows</span><strong>{workDataState?.isError ? 'Unavailable' : workSignal?.scheduledWindows.length || 0}</strong></div>
                <div><span>Recorded actions</span><strong>{workDataState?.isError ? 'Unavailable' : workSignal?.actions.length || 0}</strong></div>
                {onOpenMaintenance && <button type="button" onClick={() => onOpenMaintenance(selectedAsset)} className="asset-report-maintenance-link">Open maintenance workspace <ExternalLink size={14} aria-hidden="true" /></button>}
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="asset-report-work-list">
                  <h4>Scheduled maintenance</h4>
                  {workDataState?.isError ? <p>Unavailable until work history loads.</p> : workSignal?.scheduledWindows.length ? workSignal.scheduledWindows.slice(0, 8).map((window: any) => <article key={window.id}><strong>{window.title || 'Untitled window'}</strong><span>{window.status || 'Status not recorded'} · {formatAppDate(window.start_time)} – {formatAppDate(window.end_time)}</span></article>) : <p>No open maintenance windows recorded.</p>}
                </div>
                <div className="asset-report-work-list">
                  <h4>Recent operational actions</h4>
                  {workDataState?.isError ? <p>Unavailable until work history loads.</p> : recentAssetActions.length ? recentAssetActions.slice(0, 8).map((action: any) => <article key={action.id}><strong>{String(action.action_key || 'Operational action').replaceAll('.', ' ')}</strong><span>{String(action.status || 'Status not recorded').replaceAll('_', ' ')} · {formatAppDate(action.requested_at)}</span>{action.progress_message && <p>{action.progress_message}</p>}</article>) : <p>No recorded operational actions for this asset.</p>}
                  {!workDataState?.isError && recentAssetActions.length > 8 && <p>Showing the latest 8 of {recentAssetActions.length} matching actions.</p>}
                </div>
              </div>
            </section>

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
  const className = 'asset-report-quick-action'

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
