import React, { useState, useMemo } from 'react'
import { ArrowRightLeft, Check, X, Edit2, Trash2, Box, Zap, Clock, Globe, Info, Search, Plus, Terminal, Activity, AlertTriangle, RefreshCw, Book, Settings, Eye, EyeOff } from 'lucide-react'
import { ConfirmationModal } from '../shared/ConfirmationModal'
import { apiFetch } from '../../api/apiClient'
import toast from 'react-hot-toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { StyledSelect } from '../shared/StyledSelect'
import { useNavigate } from 'react-router-dom'
import { WorkspaceEmptyState } from '../shared/OperationalWorkspacePrimitives'
import { AssetServicesTable, MetadataViewer, MiniMonitoringTable } from '../AssetGrid_Legacy'

const getAssetConsoleUrl = (asset: any) => {
  if (asset?.management_url) {
    const trimmed = String(asset.management_url).trim()
    if (!trimmed) return null
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  }
  if (asset?.management_ip) return `https://${asset.management_ip}`
  return null
}

const MonitoringTab = ({ deviceId }: { deviceId: number }) => <MiniMonitoringTable deviceId={deviceId} />

const DevicePortGrid = ({ device, connections, onEditLink, onViewLink }: { device: any, connections: any[], onEditLink: (l: any) => void, onViewLink: (l: any) => void }) => {
  const [hoveredPort, setHoveredPort] = useState<any | null>(null)

  const ports = useMemo(() => {
    const deviceType = device?.type || ''
    const typeLower = deviceType.toLowerCase()

    if (typeLower.includes('switch') || typeLower.includes('router') || typeLower.includes('fabric')) {
      const list = []
      for (let i = 1; i <= 24; i++) {
        list.push({ id: `eth${i}`, label: `eth${i}`, type: 'RJ45' })
      }
      for (let i = 1; i <= 4; i++) {
        list.push({ id: `sfp${i}`, label: `sfp${i}`, type: 'SFP+' })
      }
      return list
    } else if (typeLower.includes('server') || typeLower.includes('compute') || typeLower.includes('node')) {
      return [
        { id: 'eth0', label: 'eth0 (LOM)', type: 'RJ45' },
        { id: 'eth1', label: 'eth1 (LOM)', type: 'RJ45' },
        { id: 'eth2', label: 'eth2', type: 'RJ45' },
        { id: 'eth3', label: 'eth3', type: 'RJ45' },
        { id: 'sfp0', label: 'sfp0', type: 'SFP+' },
        { id: 'sfp1', label: 'sfp1', type: 'SFP+' },
      ]
    } else {
      const list = []
      for (let i = 1; i <= 8; i++) {
        list.push({ id: `eth${i}`, label: `eth${i}`, type: 'RJ45' })
      }
      list.push({ id: 'sfp1', label: 'sfp1', type: 'SFP+' })
      list.push({ id: 'sfp2', label: 'sfp2', type: 'SFP+' })
      return list
    }
  }, [device])

  const portsWithConnections = useMemo(() => {
    return ports.map((port) => {
      const activeLink = connections?.find((link: any) => {
        const isSource = Number(link.source_device_id) === Number(device.id)
        const isTarget = Number(link.target_device_id) === Number(device.id)
        const localPort = isSource ? link.source_port : isTarget ? link.target_port : null
        if (!localPort) return false

        const normLocal = String(localPort).toLowerCase().replace(/[^a-z0-9]/g, '')
        const normPortId = String(port.id).toLowerCase().replace(/[^a-z0-9]/g, '')
        const normPortLabel = String(port.label).toLowerCase().replace(/[^a-z0-9]/g, '')

        return normLocal === normPortId || normLocal === normPortLabel || normLocal.includes(normPortId) || normPortId.includes(normLocal)
      })

      return {
        ...port,
        link: activeLink,
      }
    })
  }, [ports, connections, device])

  return (
    <div className="bg-slate-950/60 border border-white/5 rounded-lg p-4 space-y-4">
      {/* 1U CHASSIS FACEPLATE */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 shadow-2xl relative select-none flex flex-col md:flex-row gap-4 items-center justify-between">
        
        {/* CHASSIS IDENT/LEFT SCREW RACK-EAR */}
        <div className="hidden md:flex flex-col gap-1 items-center border-r border-slate-800 pr-4">
          <div className="w-3 h-3 rounded-full bg-slate-950 border border-slate-800 shadow-inner flex items-center justify-center">
            <div className="w-1.5 h-0.5 bg-slate-600 rotate-45" />
          </div>
          <span className="text-[7px] font-black text-slate-600 uppercase tracking-widest leading-none">1U UNIT</span>
          <div className="w-3 h-3 rounded-full bg-slate-950 border border-slate-800 shadow-inner flex items-center justify-center">
            <div className="w-1.5 h-0.5 bg-slate-600 -rotate-45" />
          </div>
        </div>

        {/* PORTS GRID DISPLAY AREA */}
        <div className="flex-1 w-full">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse" />
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Physical Interface Matrix</span>
            </div>
            <span className="text-[8px] font-mono text-slate-500 uppercase">{device?.type || 'Switch'} // {device?.model || 'Generic Model'}</span>
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-2.5 bg-slate-950/80 p-3 rounded-md border border-slate-800 shadow-inner">
            {portsWithConnections.map((port) => {
              const isActive = !!port.link
              return (
                <div
                  key={port.id}
                  className="flex flex-col items-center"
                  onMouseEnter={() => setHoveredPort(port)}
                  onMouseLeave={() => setHoveredPort(null)}
                >
                  {/* LINK LED */}
                  <div className={`w-1.5 h-1.5 rounded-full mb-1 transition-all ${
                    isActive ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,1)] animate-pulse' : 'bg-slate-800'
                  }`} />

                  {/* PORT SOCKET */}
                  {port.type === 'RJ45' ? (
                    <div className={`relative w-9 h-9 border rounded flex flex-col items-center justify-center transition-all duration-200 cursor-pointer ${
                      isActive 
                        ? 'border-emerald-500/50 bg-gradient-to-t from-emerald-950/30 to-slate-900 shadow-[inset_0_0_8px_rgba(16,185,129,0.2)] hover:border-emerald-400 hover:shadow-[0_0_12px_rgba(16,185,129,0.4)]' 
                        : 'border-slate-800 bg-slate-950 hover:bg-slate-900/60'
                    }`}>
                      <div className="absolute top-1 flex gap-[2px] justify-center w-5 h-1 opacity-30">
                        {[...Array(8)].map((_, idx) => (
                          <div key={idx} className="w-[1px] h-full bg-amber-400" />
                        ))}
                      </div>
                      <span className="text-[7px] font-mono font-bold text-slate-500 mt-1">{port.id}</span>
                      <div className="absolute bottom-0.5 w-3 h-1 bg-slate-950 border-t border-slate-800 rounded-t-sm" />
                    </div>
                  ) : (
                    <div className={`relative w-11 h-9 border rounded flex flex-col items-center justify-center transition-all duration-200 cursor-pointer ${
                      isActive 
                        ? 'border-cyan-500/50 bg-gradient-to-t from-cyan-950/30 to-slate-900 shadow-[inset_0_0_8px_rgba(6,182,212,0.2)] hover:border-cyan-400 hover:shadow-[0_0_12px_rgba(6,182,212,0.4)]' 
                        : 'border-slate-800 bg-slate-950 hover:bg-slate-900/60'
                    }`}>
                      <div className="absolute inset-1 border border-slate-700/20 rounded-sm pointer-events-none" />
                      <span className="text-[7px] font-mono font-black text-cyan-400/80">{port.id}</span>
                      {isActive && <div className="absolute top-1 right-1 w-1 h-1 rounded-full bg-cyan-400 animate-ping" />}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* LCD TELEMETRY CONSOLE ON RIGHT */}
        <div className="w-full md:w-56 h-[92px] bg-emerald-950/20 border border-emerald-500/10 rounded-md p-2.5 font-mono flex flex-col justify-between text-left">
          {hoveredPort ? (
            <div className="animate-in fade-in duration-200 h-full flex flex-col justify-between text-[10px]">
              <div>
                <div className="flex justify-between border-b border-emerald-500/10 pb-1 mb-1 text-[8px]">
                  <span className="text-emerald-400 font-bold uppercase tracking-wider">{hoveredPort.label} ({hoveredPort.type})</span>
                  <span className={hoveredPort.link ? "text-emerald-400 font-bold animate-pulse" : "text-slate-500"}>
                    {hoveredPort.link ? "CONNECTED" : "VACANT"}
                  </span>
                </div>
                {hoveredPort.link ? (
                  <div className="space-y-0.5 text-[8px] text-slate-300">
                    <p className="truncate"><span className="text-emerald-500 font-bold">PEER:</span> {hoveredPort.link.target_device_name || hoveredPort.link.source_device_name || 'N/A'}</p>
                    <p className="truncate"><span className="text-emerald-500 font-bold">PORT:</span> {hoveredPort.link.source_port} → {hoveredPort.link.target_port}</p>
                    <p><span className="text-emerald-500 font-bold">MEDIA:</span> {hoveredPort.type === 'RJ45' ? '1G BASE-T COPPER' : '10G SFP+ FIBER'}</p>
                  </div>
                ) : (
                  <p className="text-[8px] text-slate-500 italic pt-1">No active cable linked.</p>
                )}
              </div>
              {hoveredPort.link && (
                <div className="flex gap-2 text-[8px] justify-end border-t border-emerald-500/10 pt-1">
                  <button onClick={() => onViewLink(hoveredPort.link)} title="View link detail" className="text-blue-400 hover:text-blue-300 font-bold uppercase">View</button>
                  <button onClick={() => onEditLink(hoveredPort.link)} title="Edit link configuration" className="text-emerald-400 hover:text-emerald-300 font-bold uppercase">Edit</button>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col justify-between text-[8px] text-slate-400">
              <div className="flex justify-between border-b border-emerald-500/10 pb-1 mb-1">
                <span className="text-emerald-500/60 font-bold uppercase">INTERFACE SYS_MON</span>
                <span className="text-emerald-500/40 font-bold">OK_STB</span>
              </div>
              <div className="space-y-0.5 text-slate-400 italic">
                <p>SYSGRID RACK TELEMETRY V2</p>
                <p>HOVER ANY PHYSICAL PORT FOR</p>
                <p>LINK-STATE INTERFACE CONSOLE</p>
              </div>
              <div className="text-[8px] text-slate-500 text-right">SYSTEM ONLINE</div>
            </div>
          )}
        </div>

        {/* RIGHT SCREW RACK-EAR */}
        <div className="hidden md:flex flex-col gap-1 items-center border-l border-slate-800 pl-4">
          <div className="w-3 h-3 rounded-full bg-slate-950 border border-slate-800 shadow-inner flex items-center justify-center">
            <div className="w-1.5 h-0.5 bg-slate-600 rotate-45" />
          </div>
          <span className="text-[7px] font-black text-slate-600 uppercase tracking-widest leading-none">SYSGRID</span>
          <div className="w-3 h-3 rounded-full bg-slate-950 border border-slate-800 shadow-inner flex items-center justify-center">
            <div className="w-1.5 h-0.5 bg-slate-600 -rotate-45" />
          </div>
        </div>

      </div>
    </div>
  )
}

const NetworkingTab = ({ device, onEditLink, onViewLink }: { device: any, onEditLink: (l: any) => void, onViewLink: (l: any) => void }) => {
  const deviceId = device.id
  const { data: connections, isLoading } = useQuery({
    queryKey: ['asset-detail-network', deviceId],
    queryFn: async () => (await apiFetch(`/api/v1/networks/connections?device_id=${deviceId}`)).json(),
    enabled: !!deviceId,
  })

  if (isLoading) {
    return <div className="p-8 text-center text-[10px] font-bold uppercase text-slate-500">Loading connectivity...</div>
  }

  const hasConnections = connections && connections.length > 0

  return (
    <div className="p-4 space-y-6">
      {/* Port Grid Visualization */}
      <DevicePortGrid device={device} connections={connections || []} onEditLink={onEditLink} onViewLink={onViewLink} />

      {!hasConnections ? (
        <WorkspaceEmptyState compact title="No connections mapped" description="No network links are currently recorded for this asset." />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Structured Connection Ledger</span>
          </div>
          <div className="border border-white/5 rounded-lg overflow-hidden">
            <table className="w-full text-[10px]">
              <thead className="bg-white/5 border-b border-white/5 animate-fade-in">
                <tr>
                  <th className="px-4 py-2 text-left font-bold uppercase tracking-widest text-slate-500">Peer</th>
                  <th className="px-4 py-2 text-left font-bold uppercase tracking-widest text-slate-500">Ports</th>
                  <th className="px-4 py-2 text-center font-bold uppercase tracking-widest text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-slate-950/20">
                {connections.map((link: any) => (
                  <tr key={link.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 font-bold text-slate-200">{link.target_device_name || link.source_device_name || 'Peer'}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono">{`${link.source_port || 'n/a'} -> ${link.target_port || 'n/a'}`}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => onViewLink(link)} className="p-1.5 text-blue-400 hover:bg-blue-500/10 rounded-lg"><Eye size={14} /></button>
                        <button onClick={() => onEditLink(link)} className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded-lg"><Edit2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

const SecurityTab = ({ device }: { device: any }) => (
  <div className="p-6 grid grid-cols-2 gap-4">
    <div className="rounded-lg border border-white/5 bg-white/[0.03] p-4">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Ownership</p>
      <p className="mt-2 text-sm font-bold text-white">{device.owner || 'Unowned'}</p>
    </div>
    <div className="rounded-lg border border-white/5 bg-white/[0.03] p-4">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Exposure</p>
      <p className="mt-2 text-sm font-bold text-white">{device.management_ip || device.primary_ip || 'No address recorded'}</p>
    </div>
    <div className="col-span-2 rounded-lg border border-white/5 bg-white/[0.03] p-4">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Security posture notes</p>
      <p className="mt-2 text-sm font-bold text-slate-300">{device.notes || device.purpose || 'No security notes captured for this asset.'}</p>
    </div>
  </div>
)

export const AssetDetailsView = ({ device, options, onViewServiceDetails, onEditService, onEditLink, onViewLink }: { device: any, options: any, onViewServiceDetails: (s:any)=>void, onEditService: (s:any)=>void, onEditLink: (l:any)=>void, onViewLink: (l:any)=>void }) => {
    const navigate = useNavigate()
    const [tab, setTab] = useState('hardware')
    const queryClient = useQueryClient()

    // --- FETCH RELATED CONTEXT ---
    const { data: farModes } = useQuery({
      queryKey: ['far-modes-system', device.system],
      queryFn: async () => (await (await apiFetch(`/api/v1/far/modes?system=${encodeURIComponent(device.system)}&embedded_consumer=assets`)).json()),
      enabled: !!device.system
    })

    const { data: hostedServices } = useQuery({
      queryKey: ['logical-services', 'asset-workspace', device.id],
      queryFn: async () => (await (await apiFetch(`/api/v1/logical-services?device_id=${device.id}`)).json()),
      enabled: !!device.id
    })

    const { data: monitoringItems } = useQuery({
      queryKey: ['monitoring-items', 'asset-workspace', device.id],
      queryFn: async () => (await apiFetch(`/api/v1/monitoring?device_id=${device.id}`)).json(),
      enabled: !!device.id
    })

    const { data: deviceConnections } = useQuery({
      queryKey: ['asset-connections', 'workspace', device.id],
      queryFn: async () => (await (await apiFetch(`/api/v1/networks/connections?device_id=${device.id}`)).json()),
      enabled: !!device.id
    })

    const { data: relatedKnowledge } = useQuery({
      queryKey: ['asset-knowledge', device.id],
      queryFn: async () => (await apiFetch(`/api/v1/knowledge?device_id=${device.id}&embedded_consumer=assets`)).json(),
      enabled: !!device.id
    })

    const primaryMonitoringId = Array.isArray(monitoringItems) && monitoringItems[0]?.id ? monitoringItems[0].id : null
    const { data: suggestedKnowledge } = useQuery({
      queryKey: ['asset-knowledge-suggestions', device.id, primaryMonitoringId],
      queryFn: async () => {
        const params = new URLSearchParams()
        params.append('device_id', String(device.id))
        if (primaryMonitoringId) params.append('monitoring_id', String(primaryMonitoringId))
        params.append('embedded_consumer', 'assets')
        return (await apiFetch(`/api/v1/knowledge?${params.toString()}`)).json()
      },
      enabled: !!device.id
    })

    const { data: maintenanceWindows } = useQuery({
      queryKey: ['asset-maintenance', device.id],
      queryFn: async () => (await apiFetch(`/api/v1/maintenance?device_id=${device.id}`)).json(),
      enabled: !!device.id
    })

    const { data: recentAuditLogs } = useQuery({
      queryKey: ['asset-audit', device.id],
      queryFn: async () => (await apiFetch(`/api/v1/audit?target_table=devices&target_id=${device.id}`)).json(),
      enabled: !!device.id
    })

    const consoleUrl = getAssetConsoleUrl(device)
    const monitoringCount = Array.isArray(monitoringItems) ? monitoringItems.length : 0
    const serviceCount = Array.isArray(hostedServices) ? hostedServices.length : 0
    const farCount = Array.isArray(farModes) ? farModes.length : 0
    const connectionCount = Array.isArray(deviceConnections) ? deviceConnections.length : 0
    const runbookCount = Array.isArray(relatedKnowledge) ? relatedKnowledge.length : 0
    const maintenanceCount = Array.isArray(maintenanceWindows) ? maintenanceWindows.length : 0

    const mutation = useMutation({
        mutationFn: async (data: any) => {
            const res = await apiFetch(`/api/v1/devices/${device.id}`, {
                method: 'PUT', body: JSON.stringify(data)
            })
            if (!res.ok) throw new Error(await res.text())
            return res.json()
        },
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['devices'] }); queryClient.invalidateQueries({ queryKey: ['racks-all'] }); toast.success('Asset synchronized') },
        onError: (e: any) => toast.error(e.message || 'Failed to update asset')
    })

    return (
        <div className="flex gap-6 items-start">
            {/* MAIN CONTENT AREA */}
            <div className="flex-1 space-y-6">
                <div className="rounded-lg border border-blue-500/20 bg-gradient-to-r from-blue-600/10 to-transparent p-5">
                    <div className="flex items-start justify-between gap-6">
                        <div className="flex items-center space-x-6">
                           <div className="bg-blue-600 p-2.5 rounded-lg text-white shadow-xl shadow-blue-500/20 ring-4 ring-blue-500/10 shrink-0">
                              <Box size={32} />
                           </div>
                           <div className="grid grid-cols-3 gap-6">
                               <div className="flex flex-col">
                                  <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">Operational State</span>
                                  <span className={`px-3 py-0.5 rounded-lg text-[10px] font-bold uppercase border w-fit ${
                                    device.status === 'Active' ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5' :
                                    device.status === 'Maintenance' ? 'text-amber-400 border-amber-500/20 bg-amber-500/5' :
                                    'text-rose-400 border-rose-500/20 bg-rose-500/5'
                                  }`}>{device.status}</span>
                               </div>
                               <div className="flex flex-col">
                                  <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">Network IP</span>
                                  <span className="text-lg font-mono text-blue-400 font-bold">{device.primary_ip || '---.---.---.---'}</span>
                               </div>
                               <div className="flex flex-col">
                                  <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">Management IP</span>
                                  <span className="text-lg font-mono text-indigo-400 font-bold">{device.management_ip || '---.---.---.---'}</span>
                               </div>
                           </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            {[
                              { label: 'Services', value: serviceCount, tone: 'text-blue-400' },
                              { label: 'Monitors', value: monitoringCount, tone: 'text-emerald-400' },
                              { label: 'FAR Risks', value: farCount, tone: 'text-rose-400' }
                            ].map((item) => (
                              <div key={item.label} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-center min-w-[70px]">
                                  <p className="text-[7px] font-black uppercase tracking-[0.2em] text-slate-500">{item.label}</p>
                                  <p className={`mt-0.5 text-lg font-black tabular-nums ${item.tone}`}>{item.value}</p>
                              </div>
                            ))}
                        </div>
                    </div>

                    <div className="mt-4 rounded-lg border border-amber-500/15 bg-amber-500/[0.05] p-4">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <p className="text-[9px] font-black uppercase tracking-[0.24em] text-amber-300">Suggested Runbooks Now</p>
                                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Procedures matched to this asset and active monitoring context.</p>
                            </div>
                            <button
                              onClick={() => navigate(`/knowledge?device_id=${device.id}${primaryMonitoringId ? `&monitoring_id=${primaryMonitoringId}` : ''}&mode=incident`)}
                              className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-amber-300 transition-all hover:bg-amber-500/20"
                            >
                              Open Knowledge
                            </button>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                            {Array.isArray(suggestedKnowledge) && suggestedKnowledge.slice(0, 2).map((entry: any) => (
                              <button key={entry.id} onClick={() => navigate(`/knowledge?id=${entry.id}`)} className="rounded-lg border border-white/5 bg-black/20 px-3 py-3 text-left hover:bg-white/[0.06] transition-all">
                                <p className="text-[10px] font-black uppercase tracking-tight text-white truncate">{entry.title}</p>
                                <p className="mt-1 text-[8px] font-black uppercase tracking-widest text-slate-500">
                                  {entry.metadata_json?.entry_type || entry.category} // {entry.metadata_json?.verification?.state || entry.status}
                                </p>
                              </button>
                            ))}
                            {!suggestedKnowledge?.length && <p className="col-span-2 text-[10px] font-bold uppercase text-slate-600 italic">No suggested runbooks identified</p>}
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex space-x-1 bg-black/40 p-1 rounded-lg w-fit">
                            {['hardware', 'secrets', 'relations', 'services', 'network', 'security', 'monitoring', 'metadata'].map(t => (
                                <button key={t} onClick={() => setTab(t)} className={`px-6 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${tab === t ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>
                                    {t}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="glass-panel border-white/5 rounded-lg overflow-hidden min-h-[400px]">
                        {tab === 'hardware' && <HWTab deviceId={device.id} />}
                        {tab === 'secrets' && <SecretsTab deviceId={device.id} />}
                        {tab === 'monitoring' && <MonitoringTab deviceId={device.id} />}
                        {tab === 'services' && (
                            <AssetServicesTable
                              deviceId={device.id}
                              onViewDetails={onViewServiceDetails}
                              onEdit={onEditService}
                            />
                        )}
                        {tab === 'network' && <NetworkingTab device={device} onEditLink={onEditLink} onViewLink={onViewLink} />}
                        {tab === 'relations' && <RelationshipsTab deviceId={device.id} />}
                        {tab === 'security' && <SecurityTab device={device} />}
                        {tab === 'metadata' && (
                           <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 p-2 h-full flex flex-col">
                               <MetadataViewer data={device.metadata_json} />
                           </div>
                        )}
                    </div>
                </div>
            </div>

            {/* SIDEBAR JUMP & META COLUMN */}
            <div className="w-80 shrink-0 space-y-6 sticky top-0">
                {/* PRIMARY JUMP ACTIONS */}
                <div className="glass-panel p-5 rounded-lg border-white/5 bg-white/5 space-y-3">
                   <p className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Jump Actions</p>
                   <div className="grid grid-cols-2 gap-2">
                        <button
                          disabled={!consoleUrl}
                          onClick={() => consoleUrl && window.open(consoleUrl, '_blank')}
                          className="flex flex-col items-center justify-center p-3 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] transition-all disabled:opacity-30 group"
                        >
                          <Terminal size={16} className="text-slate-500 group-hover:text-white mb-2" />
                          <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">Console</span>
                        </button>
                        <button
                          onClick={() => navigate(`/logs?target_table=devices&target_id=${device.id}`)}
                          className="flex flex-col items-center justify-center p-3 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] transition-all group"
                        >
                          <Activity size={16} className="text-slate-500 group-hover:text-blue-400 mb-2" />
                          <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">Audit</span>
                        </button>
                        <button
                          disabled={!farModes?.[0]?.id}
                          onClick={() => farModes?.[0]?.id && navigate(`/far?id=${farModes[0].id}`)}
                          className="flex flex-col items-center justify-center p-3 rounded-lg border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 transition-all group disabled:opacity-30"
                        >
                          <AlertTriangle size={16} className="text-rose-500 mb-2" />
                          <span className="text-[8px] font-black uppercase tracking-widest text-rose-400">FAR Risks</span>
                        </button>
                        <button 
                          onClick={() => mutation.mutate(device)}
                          className="flex flex-col items-center justify-center p-3 rounded-lg border border-blue-500/20 bg-blue-500/10 hover:bg-blue-500/20 transition-all group"
                        >
                          <RefreshCw size={16} className="text-blue-400 mb-2" />
                          <span className="text-[8px] font-black uppercase tracking-widest text-blue-400">Sync</span>
                        </button>
                   </div>
                </div>

                {/* INCIDENT FLOW */}
                <div className="rounded-lg border border-white/10 bg-black/40 p-5 space-y-4 shadow-xl">
                    <p className="text-[9px] font-black uppercase tracking-[0.22em] text-emerald-400 flex items-center justify-between">
                       <span>Incident Flow</span>
                       <Activity size={12} />
                    </p>
                    <div className="space-y-2">
                        {Array.isArray(monitoringItems) && monitoringItems.slice(0, 3).map((item: any) => (
                          <button key={item.id} onClick={() => navigate(`/monitoring?id=${item.id}`)} className="w-full rounded-lg border border-white/5 bg-white/[0.03] px-3 py-3 text-left hover:bg-white/[0.06] transition-all group">
                            <p className="text-[10px] font-bold uppercase text-slate-200 group-hover:text-emerald-400">{item.title}</p>
                            <p className="mt-1 text-[8px] font-black uppercase tracking-widest text-slate-500">{item.severity} // {item.status}</p>
                          </button>
                        ))}
                        {!monitoringCount && <p className="text-[10px] font-bold uppercase text-slate-600 italic">No linked monitors</p>}
                    </div>
                </div>

                {/* RUNBOOKS */}
                <div className="rounded-lg border border-white/10 bg-black/40 p-5 space-y-4 shadow-xl">
                    <p className="text-[9px] font-black uppercase tracking-[0.22em] text-amber-400 flex items-center justify-between">
                       <span>Runbooks & Knowledge</span>
                       <Book size={12} />
                    </p>
                    <div className="space-y-2">
                        {Array.isArray(relatedKnowledge) && relatedKnowledge.slice(0, 3).map((entry: any) => (
                          <button key={entry.id} onClick={() => navigate(`/knowledge?id=${entry.id}`)} className="w-full rounded-lg border border-white/5 bg-white/[0.03] px-3 py-3 text-left hover:bg-white/[0.06] transition-all group">
                            <p className="text-[10px] font-bold uppercase text-slate-200 group-hover:text-amber-400">{entry.title}</p>
                            <p className="mt-1 text-[8px] font-black uppercase tracking-widest text-slate-500">{entry.category} // {entry.status}</p>
                          </button>
                        ))}
                        {!runbookCount && <p className="text-[10px] font-bold uppercase text-slate-600 italic">No linked knowledge</p>}
                    </div>
                </div>

                {/* CHANGE & CARE */}
                <div className="rounded-lg border border-white/10 bg-black/40 p-5 space-y-4 shadow-xl">
                    <p className="text-[9px] font-black uppercase tracking-[0.22em] text-fuchsia-400 flex items-center justify-between">
                       <span>Change & Maintenance</span>
                       <Settings size={12} />
                    </p>
                    <div className="space-y-2">
                        {Array.isArray(maintenanceWindows) && maintenanceWindows.slice(0, 2).map((window: any) => (
                          <div key={window.id} className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-3">
                            <p className="text-[10px] font-bold uppercase text-slate-200">{window.title}</p>
                            <p className="mt-1 text-[8px] font-black uppercase tracking-widest text-slate-500">
                              {window.status} // {window.start_time ? new Date(window.start_time).toLocaleDateString() : 'No date'}
                            </p>
                          </div>
                        ))}
                        {Array.isArray(recentAuditLogs) && recentAuditLogs.slice(0, 2).map((log: any) => (
                          <div key={log.id} className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-3">
                            <p className="text-[10px] font-bold uppercase text-slate-200">{log.action} // {log.user_id || 'system'}</p>
                            <p className="mt-1 text-[8px] font-black uppercase tracking-widest text-slate-500 truncate">{log.description || 'No description'}</p>
                          </div>
                        ))}
                        {!maintenanceCount && !(recentAuditLogs?.length > 0) && <p className="text-[10px] font-bold uppercase text-slate-600 italic">No recent care events</p>}
                    </div>
                    <button 
                      onClick={() => navigate(`/logs?target_table=devices&target_id=${device.id}`)}
                      className="w-full py-2 bg-white/5 border border-white/10 text-[8px] font-black uppercase tracking-widest text-slate-500 hover:text-white transition-all rounded-lg"
                    >
                       View Full Audit Trail
                    </button>
                </div>
            </div>
        </div>
    )
}

const HWTab = ({ deviceId }: { deviceId: number }) => {
  const queryClient = useQueryClient()
  const [newComp, setNewComp] = useState({ category: 'CPU', name: '', manufacturer: '', specs: '', count: 1 })

  const mutation = useMutation({
    mutationFn: async (d: any) => {
      const res = await apiFetch(`/api/v1/devices/${deviceId}/hardware`, { method: 'POST', body: JSON.stringify(d) })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['device-hw', deviceId] }); setNewComp({ category: 'CPU', name: '', manufacturer: '', specs: '', count: 1 }) }
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-6 gap-2 bg-white/5 p-3 rounded-lg border border-white/5">
         <select value={newComp.category} onChange={e => setNewComp({...newComp, category: e.target.value})} className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] outline-none">
            <option>CPU</option><option>Memory</option><option>Card</option><option>Disk</option><option>NIC</option><option>PSU</option>
         </select>
         <input value={newComp.name} onChange={e => setNewComp({...newComp, name: e.target.value})} placeholder="Component Name" className="bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] outline-none" />
         <input value={newComp.manufacturer} onChange={e => setNewComp({...newComp, manufacturer: e.target.value})} placeholder="Manufacturer" className="bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] outline-none" />
         <input value={newComp.specs} onChange={e => setNewComp({...newComp, specs: e.target.value})} placeholder="Specifications" className="bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] outline-none" />
         <input type="number" value={newComp.count} onChange={e => setNewComp({...newComp, count: parseInt(e.target.value)})} className="bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] outline-none" />
         <button onClick={() => { if(!newComp.name) return toast.error("Name required"); mutation.mutate(newComp) }} className="bg-blue-600 text-white rounded-lg text-[9px] font-bold uppercase">Add</button>
      </div>
      <HWTable deviceId={deviceId} />
    </div>
  )
}

export const HWTable = ({ deviceId }: { deviceId: number }) => {
  const queryClient = useQueryClient()
  const { data: hardware } = useQuery({ queryKey: ['device-hw', deviceId], queryFn: async () => (await (await apiFetch(`/api/v1/devices/${deviceId}/hardware`)).json()) })
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editData, setEditData] = useState<any>(null)
  const [confirmModal, setConfirmModal] = useState<any>({ isOpen: false, title: '', message: '', onConfirm: () => {} })
  
  const delMutation = useMutation({
    mutationFn: async (id: number) => apiFetch(`/api/v1/devices/hardware/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['device-hw', deviceId] }); toast.success('Component removed') },
    onError: (e: any) => toast.error(e.message || 'Failed to delete component')
  })

  const updateMutation = useMutation({
    mutationFn: async (data: any) => apiFetch(`/api/v1/devices/hardware/${data.id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }),
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['device-hw', deviceId] })
        setEditingId(null)
        toast.success('Component Updated')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to update component')
  })

  const catOptions = [
    { value: 'CPU', label: 'CPU' },
    { value: 'Memory', label: 'Memory' },
    { value: 'Card', label: 'Card' },
    { value: 'Disk', label: 'Disk' },
    { value: 'NIC', label: 'NIC' },
    { value: 'PSU', label: 'PSU' }
  ]

  return (
    <div className="p-0">
      <table className="w-full text-[10px]">
        <thead className="bg-white/5 border-b border-white/5">
          <tr>
            <th className="px-4 py-2 text-center font-bold uppercase tracking-widest text-slate-500">Category</th>
            <th className="px-4 py-2 text-center font-bold uppercase tracking-widest text-slate-500">Component</th>
            <th className="px-4 py-2 text-center font-bold uppercase tracking-widest text-slate-500">Specs</th>
            <th className="px-4 py-2 text-center font-bold uppercase tracking-widest text-slate-500">Qty</th>
            <th className="px-4 py-2 text-center font-bold uppercase tracking-widest text-slate-500">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {hardware?.map((h: any) => (
            <tr key={h.id} className="hover:bg-white/5 transition-colors">
              <td className="px-4 py-2 text-center">
                {editingId === h.id ? (
                    <StyledSelect
                        value={editData.category}
                        onChange={e => setEditData({...editData, category: e.target.value})}
                        options={catOptions}
                        className="w-24 mx-auto"
                    />
                ) : (
                    <span className="text-[10px] font-bold uppercase text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-lg">{h.category}</span>
                )}
              </td>
              <td className="px-4 py-2 font-bold text-slate-200 text-center text-[10px]">
                {editingId === h.id ? (
                    <input value={editData.name} onChange={e => setEditData({...editData, name: e.target.value})} className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] w-full outline-none focus:border-blue-500" />
                ) : h.name}
              </td>
              <td className="px-4 py-2 text-slate-500 text-center font-bold text-[10px]">
                {editingId === h.id ? (
                    <input value={editData.specs} onChange={e => setEditData({...editData, specs: e.target.value})} className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] w-full outline-none focus:border-blue-500" />
                ) : h.specs}
              </td>
              <td className="px-4 py-2 text-center text-slate-400 font-bold text-[10px]">
                {editingId === h.id ? (
                    <input type="number" value={editData.count} onChange={e => setEditData({...editData, count: parseInt(e.target.value)})} className="bg-slate-900 border border-white/10 rounded-lg px-1 py-1.5 text-[10px] w-12 outline-none focus:border-blue-500" />
                ) : `x${h.count}`}
              </td>
              <td className="px-4 py-2 text-center">
                {editingId === h.id ? (
                    <div className="flex items-center justify-center space-x-1">
                        <button onClick={() => updateMutation.mutate(editData)} className="p-1.5 hover:bg-emerald-500/20 text-emerald-400 rounded-lg"><Check size={14}/></button>
                        <button onClick={() => setEditingId(null)} className="p-1.5 hover:bg-rose-500/20 text-rose-400 rounded-lg"><X size={14}/></button>
                    </div>
                ) : (
                    <div className="flex items-center justify-center space-x-1">
                        <button onClick={() => { setEditingId(h.id); setEditData({...h}); }} className="p-1.5 hover:bg-white/10 text-slate-500 hover:text-blue-400 rounded-lg transition-all"><Edit2 size={14}/></button>
                        <button onClick={() => setConfirmModal({ isOpen: true, title: 'Purge Component', message: 'Purge this hardware component?', onConfirm: () => delMutation.mutate(h.id) })} className="p-1.5 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded-lg transition-all"><Trash2 size={14}/></button>
                    </div>
                )}
              </td>
            </tr>
          ))}
          {!hardware?.length && <tr><td colSpan={8}><WorkspaceEmptyState compact title="No hardware mappings found" /></td></tr>}
        </tbody>
      </table>
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({...confirmModal, isOpen: false})}
        onConfirm={() => { confirmModal.onConfirm?.(); setConfirmModal((prev: any) => ({ ...prev, isOpen: false })); }}
        title={confirmModal.title}
        message={confirmModal.message}
        variant="danger"
      />
    </div>
  )
}

const SecretsTab = ({ deviceId }: { deviceId: number }) => {
  const queryClient = useQueryClient()
  const [newSec, setNewSec] = useState({ secret_type: 'Root Password', username: '', encrypted_payload: '', notes: '' })

  const mutation = useMutation({
    mutationFn: async (d: any) => {
      const res = await apiFetch(`/api/v1/devices/${deviceId}/secrets`, { method: 'POST', body: JSON.stringify(d) })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['device-secrets', deviceId] }); setNewSec({ secret_type: 'Root Password', username: '', encrypted_payload: '', notes: '' }); toast.success('Credential added') }
  })

  const secOptions = [
    { value: 'Root Password', label: 'Root Password' },
    { value: 'Admin API Key', label: 'Admin API Key' },
    { value: 'Service Account', label: 'Service Account' },
    { value: 'SSH Key', label: 'SSH Key' },
    { value: 'ILO/IDRAC', label: 'ILO/IDRAC' }
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-2 bg-white/5 p-3 rounded-lg border border-white/5 items-end">
         <div className="col-span-1">
           <StyledSelect
              value={newSec.secret_type}
              onChange={e => setNewSec({...newSec, secret_type: e.target.value})}
              options={secOptions}
              label="Secret Type"
           />
         </div>
         <div className="col-span-1">
            <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1 px-1">Identity</label>
            <input value={newSec.username} onChange={e => setNewSec({...newSec, username: e.target.value})} placeholder="Identity / Username" className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs outline-none focus:border-blue-500" />
         </div>
         <div className="col-span-1">
            <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1 px-1">Sensitive Value</label>
            <input type="password" value={newSec.encrypted_payload} onChange={e => setNewSec({...newSec, encrypted_payload: e.target.value})} placeholder="Value" className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs outline-none focus:border-blue-500" />
         </div>
         <div className="col-span-1">
            <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1 px-1">Notes</label>
            <input value={newSec.notes} onChange={e => setNewSec({...newSec, notes: e.target.value})} placeholder="Purpose / Note" className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs outline-none focus:border-blue-500" />
         </div>
         <button onClick={() => { if(!newSec.username || !newSec.encrypted_payload) return toast.error("Identity/Value required"); mutation.mutate(newSec) }} className="h-[38px] bg-emerald-600 text-white rounded-lg text-[9px] font-bold uppercase tracking-widest shadow-lg shadow-emerald-500/20 active:scale-95 transition-all">Add</button>
      </div>
      <SecretsTable deviceId={deviceId} />
    </div>
  )
}

export const SecretsTable = ({ deviceId }: { deviceId: number }) => {
  const queryClient = useQueryClient()
  const { data: secrets } = useQuery({ queryKey: ['device-secrets', deviceId], queryFn: async () => (await (await apiFetch(`/api/v1/devices/${deviceId}/secrets`)).json()) })
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editData, setEditData] = useState<any>(null)
  const [visibleIds, setVisibleIds] = useState<number[]>([])
  const [confirmModal, setConfirmModal] = useState<any>({ isOpen: false, title: '', message: '', onConfirm: () => {} })

  const toggleVisibility = (id: number) => {
    setVisibleIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const delMutation = useMutation({
    mutationFn: async (id: number) => apiFetch(`/api/v1/devices/secrets/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['device-secrets', deviceId] }); toast.success('Credential removed') },
    onError: (e: any) => toast.error(e.message || 'Failed to delete credential')
  })

  const updateMutation = useMutation({
    mutationFn: async (data: any) => apiFetch(`/api/v1/devices/secrets/${data.id}`, {
        method: 'PUT', body: JSON.stringify(data)
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['device-secrets', deviceId] }); setEditingId(null); toast.success('Credential updated') },
    onError: (e: any) => toast.error(e.message || 'Failed to update credential')
  })

  const secOptions = [
    { value: 'Root Password', label: 'Root Password' },
    { value: 'Admin API Key', label: 'Admin API Key' },
    { value: 'Service Account', label: 'Service Account' },
    { value: 'SSH Key', label: 'SSH Key' },
    { value: 'ILO/IDRAC', label: 'ILO/IDRAC' }
  ]

  return (
    <div className="p-0">
      <table className="w-full text-[10px]">
        <thead className="bg-white/5 border-b border-white/5">
          <tr>
            <th className="px-4 py-2 text-left font-bold uppercase tracking-widest text-slate-500">Type</th>
            <th className="px-4 py-2 text-left font-bold uppercase tracking-widest text-slate-500">Identity</th>
            <th className="px-4 py-2 text-left font-bold uppercase tracking-widest text-slate-500">Payload</th>
            <th className="px-4 py-2 text-left font-bold uppercase tracking-widest text-slate-500">Notes</th>
            <th className="px-4 py-2 text-center font-bold uppercase tracking-widest text-slate-500">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {secrets?.map((s: any) => (
            <tr key={s.id} className="hover:bg-white/5 transition-colors">
              <td className="px-4 py-2 font-bold uppercase text-amber-500/80">
                {editingId === s.id ? (
                    <StyledSelect
                        value={editData.secret_type}
                        onChange={e => setEditData({...editData, secret_type: e.target.value})}
                        options={secOptions}
                        className="w-32"
                    />
                ) : s.secret_type}
              </td>
              <td className="px-4 py-2 font-bold text-slate-200">
                {editingId === s.id ? (
                    <input value={editData.username} onChange={e => setEditData({...editData, username: e.target.value})} className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] w-full outline-none focus:border-blue-500" />
                ) : s.username}
              </td>
              <td className="px-4 py-2 text-slate-400">
                {editingId === s.id ? (
                    <input type="password" value={editData.encrypted_payload} onChange={e => setEditData({...editData, encrypted_payload: e.target.value})} className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] w-full outline-none focus:border-blue-500" placeholder="Update secret..." />
                ) : (
                    <div className="flex items-center space-x-3 group">
                       <span className={visibleIds.includes(s.id) ? 'text-blue-300' : 'text-slate-700'}>{visibleIds.includes(s.id) ? s.encrypted_payload : '••••••••••••'}</span>
                       <button onClick={() => toggleVisibility(s.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-blue-400">
                          {visibleIds.includes(s.id) ? <EyeOff size={14}/> : <Eye size={14}/>}
                       </button>
                    </div>
                )}
              </td>
              <td className="px-4 py-2 text-slate-500">
                {editingId === s.id ? (
                    <input value={editData.notes} onChange={e => setEditData({...editData, notes: e.target.value})} className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] w-full outline-none focus:border-blue-500" />
                ) : s.notes}
              </td>
              <td className="px-4 py-2 text-center">
                {editingId === s.id ? (
                    <div className="flex items-center justify-center space-x-1">
                        <button onClick={() => updateMutation.mutate(editData)} className="p-1.5 hover:bg-emerald-500/20 text-emerald-400 rounded-lg"><Check size={14}/></button>
                        <button onClick={() => setEditingId(null)} className="p-1.5 hover:bg-rose-500/20 text-rose-400 rounded-lg"><X size={14}/></button>
                    </div>
                ) : (
                    <div className="flex items-center justify-center space-x-1">
                        <button onClick={() => { setEditingId(s.id); setEditData({...s}); }} className="p-1.5 hover:bg-white/10 text-slate-500 hover:text-blue-400 rounded-lg transition-all"><Edit2 size={14}/></button>
                        <button onClick={() => setConfirmModal({ isOpen: true, title: 'Delete Credential', message: 'Remove this credential?', onConfirm: () => delMutation.mutate(s.id) })} className="p-1.5 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded-lg transition-all"><Trash2 size={14}/></button>
                    </div>
                )}
              </td>
            </tr>
          ))}
          {!secrets?.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-600 font-bold uppercase ">No credentials stored</td></tr>}
        </tbody>
      </table>
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({...confirmModal, isOpen: false})}
        onConfirm={() => { confirmModal.onConfirm?.(); setConfirmModal((prev: any) => ({ ...prev, isOpen: false })); }}
        title={confirmModal.title}
        message={confirmModal.message}
        variant="danger"
      />
    </div>
  )
}

export const RelationshipsTab = ({ deviceId }: { deviceId: number }) => {
  const queryClient = useQueryClient()
  const { data: devices } = useQuery({ queryKey: ['devices'], queryFn: async () => (await (await apiFetch('/api/v1/devices')).json()) })
  
  const types = useMemo(() => [
    { label: 'Depends On', s: 'Consumer', t: 'Provider' },
    { label: 'Hosts', s: 'Hypervisor', t: 'Guest' },
    { label: 'Backs Up', s: 'Source', t: 'Target' },
    { label: 'Replicates to', s: 'Primary', t: 'Replica' },
    { label: 'Cluster Member', s: 'Node', t: 'Peer' }
  ], [])

  const currentDevice = useMemo(() => devices?.find((d: any) => d.id === deviceId), [devices, deviceId]);

  const [newRel, setNewRel] = useState({ 
    target_device_id: '', 
    relationship_type: 'Depends On', 
    source_role: 'Consumer', 
    target_role: 'Provider' 
  })

  const mutation = useMutation({
    mutationFn: async (d: any) => {
      const res = await apiFetch(`/api/v1/devices/${deviceId}/relationships`, {
        method: 'POST',
        body: JSON.stringify(d)
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['device-rel', deviceId] });
        toast.success('Relationship added')
    }
  })

  const syncRoles = (role: string, isSource: boolean) => {
    const pair = types.find(t => t.s === role || t.t === role);
    if (pair) {
        if (isSource) {
            const targetRole = role === pair.s ? pair.t : pair.s;
            setNewRel(prev => ({ ...prev, source_role: role, target_role: targetRole, relationship_type: pair.label }));
        } else {
            const sourceRole = role === pair.s ? pair.t : pair.s;
            setNewRel(prev => ({ ...prev, target_role: role, source_role: sourceRole, relationship_type: pair.label }));
        }
    }
  }

  const swapRoles = () => {
    setNewRel(prev => ({
        ...prev,
        source_role: prev.target_role,
        target_role: prev.source_role
    }));
  }

  const allRoles = useMemo(() => {
    const roles = new Set<string>();
    types.forEach(t => { roles.add(t.s); roles.add(t.t); });
    return Array.from(roles).map(r => ({ value: r, label: r }));
  }, [types]);

  return (
    <div className="space-y-6">
      <div className="bg-white/5 p-6 rounded-lg border border-white/5 space-y-6">
         <div className="grid grid-cols-11 gap-4 items-end">
            <div className="col-span-3">
               <label className="text-[9px] font-bold text-slate-500 uppercase block mb-2 px-1">Local Asset (A)</label>
               <div className="w-full bg-blue-600/10 border border-blue-500/20 rounded-lg px-4 py-2.5 text-xs text-blue-400 font-bold uppercase truncate">
                  {currentDevice?.name || 'Local'}
               </div>
            </div>

            <div className="col-span-2">
               <StyledSelect
                  label="Role (A)"
                  value={newRel.source_role}
                  onChange={e => syncRoles(e.target.value, true)}
                  options={allRoles}
               />
            </div>

            <div className="col-span-1 flex justify-center pb-2">
               <button 
                 onClick={swapRoles}
                 className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-slate-400 hover:text-white transition-all group"
                 title="Swap Roles"
               >
                  <ArrowRightLeft size={16} className="group-active:rotate-180 transition-transform duration-300" />
               </button>
            </div>

            <div className="col-span-2">
               <StyledSelect
                  label="Role (B)"
                  value={newRel.target_role}
                  onChange={e => syncRoles(e.target.value, false)}
                  options={allRoles}
               />
            </div>

            <div className="col-span-3">
               <StyledSelect
                  value={newRel.target_device_id}
                  onChange={e => setNewRel({...newRel, target_device_id: e.target.value})}
                  options={devices?.filter((d:any)=> d.id !== deviceId).map((d:any)=>({ value: String(d.id), label: `${d.name} [${d.type}]` })) || []}
                  label="Peer Asset (B)"
                  placeholder="Select Peer..."
               />
            </div>
         </div>

         <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <div className="flex items-center space-x-2">
               <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Vector Classification:</span>
               <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest bg-indigo-500/10 px-2 py-0.5 rounded-lg border border-indigo-500/20">{newRel.relationship_type}</span>
            </div>
            <button 
              onClick={() => { if(!newRel.target_device_id) return toast.error("Select peer asset"); mutation.mutate(newRel) }} 
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-[9px] font-bold uppercase tracking-widest shadow-lg shadow-indigo-500/20 active:scale-95 transition-all flex items-center space-x-2"
            >
               <Plus size={14} /> <span>Establish Vector</span>
            </button>
         </div>
      </div>
      <RelationsTable deviceId={deviceId} />
    </div>
  )
}

const RelationsTable = ({ deviceId }: { deviceId: number }) => {
  const queryClient = useQueryClient()
  const { data: relationships } = useQuery({ queryKey: ['device-rel', deviceId], queryFn: async () => (await (await apiFetch(`/api/v1/devices/${deviceId}/relationships`)).json()) })
  const { data: devices } = useQuery({ queryKey: ['devices'], queryFn: async () => (await (await apiFetch('/api/v1/devices')).json()) })
  const [confirmModal, setConfirmModal] = useState<any>({ isOpen: false, title: '', message: '', onConfirm: () => {} })
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editData, setEditData] = useState<any>(null)

  const currentDevice = useMemo(() => devices?.find((d: any) => d.id === deviceId), [devices, deviceId]);

  const delMutation = useMutation({
    mutationFn: async (id: number) => apiFetch(`/api/v1/devices/relationships/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['device-rel', deviceId] }); toast.success('Relationship removed') },
    onError: (e: any) => toast.error(e.message || 'Failed to delete relationship')
  })

  const updateMutation = useMutation({
    mutationFn: async (data: any) => apiFetch(`/api/v1/devices/relationships/${data.id}`, {
        method: 'PUT', body: JSON.stringify(data)
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['device-rel', deviceId] }); setEditingId(null); toast.success('Relationship updated') },
    onError: (e: any) => toast.error(e.message || 'Failed to update relationship')
  })

  return (
    <div className="p-0">
      <table className="w-full text-[10px]">
        <thead className="bg-white/5 border-b border-white/5">
          <tr>
            <th className="px-4 py-2 text-left font-bold uppercase tracking-widest text-slate-500">Local Identity</th>
            <th className="px-4 py-2 text-center font-bold uppercase tracking-widest text-slate-500">Relationship Type</th>
            <th className="px-4 py-2 text-left font-bold uppercase tracking-widest text-slate-500">Peer Entity</th>
            <th className="px-4 py-2 text-center font-bold uppercase tracking-widest text-slate-500">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {relationships?.map((r: any) => {
            const isSource = r.source_device_id === deviceId;
            const peerId = isSource ? r.target_device_id : r.source_device_id;
            const peer = devices?.find((d:any) => d.id === peerId);
            const localRole = isSource ? r.source_role : r.target_role;
            const peerRole = isSource ? r.target_role : r.source_role;

            return (
              <tr key={r.id} className="hover:bg-white/5 transition-colors">
                <td className="px-4 py-3">
                   {editingId === r.id ? (
                     <select value={isSource ? editData.source_role : editData.target_role} onChange={e => isSource ? setEditData({...editData, source_role: e.target.value}) : setEditData({...editData, target_role: e.target.value})} className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-[10px] w-full outline-none focus:border-blue-500">
                       <option>Consumer</option>
                       <option>Provider</option>
                       <option>Hypervisor</option>
                       <option>Guest</option>
                       <option>Source</option>
                       <option>Target</option>
                       <option>Primary</option>
                       <option>Replica</option>
                       <option>Node</option>
                       <option>Peer</option>
                     </select>
                   ) : (
                     <div className="flex flex-col">
                        <span className="font-bold text-white uppercase tracking-tight text-[10px]">{currentDevice?.name || 'Local'}</span>
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-lg w-fit mt-1 ${isSource ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'}`}>
                          {localRole}
                        </span>
                     </div>
                   )}
                </td>
                <td className="px-4 py-3 text-center">
                  {editingId === r.id ? (
                    <select value={editData.relationship_type} onChange={e => setEditData({...editData, relationship_type: e.target.value})} className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-[10px] w-full outline-none focus:border-blue-500">
                      <option>Depends On</option>
                      <option>Hosts</option>
                      <option>Backs Up</option>
                      <option>Replicates to</option>
                      <option>Cluster Member</option>
                    </select>
                  ) : (
                    <div className="flex flex-col items-center">
                       <span className="font-bold text-slate-500 uppercase tracking-widest text-[10px] mb-1">{r.relationship_type}</span>
                       <div className="flex items-center space-x-2 text-slate-600">
                          <div className="h-px w-8 bg-white/10" />
                          <ArrowRightLeft size={10} className={isSource ? "" : "rotate-180"} />
                          <div className="h-px w-8 bg-white/10" />
                       </div>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                    {editingId === r.id ? (
                      <select value={!isSource ? editData.source_role : editData.target_role} onChange={e => !isSource ? setEditData({...editData, source_role: e.target.value}) : setEditData({...editData, target_role: e.target.value})} className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-[10px] w-full outline-none focus:border-blue-500">
                        <option>Consumer</option>
                        <option>Provider</option>
                        <option>Hypervisor</option>
                        <option>Guest</option>
                        <option>Source</option>
                        <option>Target</option>
                        <option>Primary</option>
                        <option>Replica</option>
                        <option>Node</option>
                        <option>Peer</option>
                      </select>
                    ) : (
                      <div className="flex flex-col">
                         <span className="font-bold text-blue-400 uppercase tracking-tight text-[10px]">{peer?.name || 'Unknown Entity'}</span>
                         <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-lg w-fit mt-1 ${!isSource ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'}`}>
                           {peerRole}
                         </span>
                      </div>
                    )}
                </td>
                <td className="px-4 py-3 text-center">
                  {editingId === r.id ? (
                    <div className="flex items-center justify-center space-x-1">
                      <button onClick={() => updateMutation.mutate(editData)} className="p-1.5 hover:bg-emerald-500/20 text-emerald-400 rounded-lg transition-all"><Check size={14}/></button>
                      <button onClick={() => setEditingId(null)} className="p-1.5 hover:bg-slate-500/20 text-slate-500 rounded-lg transition-all"><X size={14}/></button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center space-x-1">
                      <button onClick={() => { setEditingId(r.id); setEditData({...r}) }} className="p-1.5 hover:bg-blue-500/20 text-slate-500 hover:text-blue-400 rounded-lg transition-all"><Edit2 size={14}/></button>
                      <button onClick={() => setConfirmModal({ isOpen: true, title: 'Delete Relationship', message: 'Remove this relationship?', onConfirm: () => delMutation.mutate(r.id) })} className="p-1.5 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded-lg transition-all"><Trash2 size={14}/></button>
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
          {!relationships?.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-600 font-bold uppercase ">No relationships defined</td></tr>}
        </tbody>
      </table>
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({...confirmModal, isOpen: false})}
        onConfirm={() => { confirmModal.onConfirm?.(); setConfirmModal((prev: any) => ({ ...prev, isOpen: false })); }}
        title={confirmModal.title}
        message={confirmModal.message}
        variant="danger"
      />
    </div>
  )
}

const ASSET_TYPES = [
    { value: 'Physical', label: 'Physical' },
    { value: 'Virtual', label: 'Virtual' },
    { value: 'Storage', label: 'Storage' },
    { value: 'Switch', label: 'Switch' },
    { value: 'Firewall', label: 'Firewall' },
    { value: 'Load Balancer', label: 'Load Balancer' },
    { value: 'PDU', label: 'PDU' },
    { value: 'UPS', label: 'UPS' },
    { value: 'Console-Server', label: 'Console Server' },
    { value: 'Patch Panel', label: 'Patch Panel' }
]

const STATUS_ITEMS = [
    { value: 'Planned', label: 'Planned' },
    { value: 'Active', label: 'Active' },
]
