import React, { useMemo, useState, useEffect } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import ForceGraph2D from 'react-force-graph-2d'
import { Plus, Trash2, Cpu, Package, X, RefreshCcw, Search, Edit2, LayoutGrid, List, FileJson, Check, MoreVertical, Settings, Sliders, Globe, Eye, ArrowRightLeft, Tag, AlertCircle, Layers, Terminal, FileText, Filter, Calendar, Activity, Link as LinkIcon, Database, HardDrive, Cpu as CpuIcon, Box, Zap, Clipboard, Share2, ZoomIn, ZoomOut, Maximize2, Shield } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { apiFetch } from "../api/apiClient"
import { parseAppDate, formatAppDate, formatAppDay } from '../utils/dateUtils'
import { ConfigRegistryModal } from "./ConfigRegistry"
import { ConfirmationModal } from "./shared/ConfirmationModal"
import { StyledSelect } from "./shared/StyledSelect"
import { WorkspaceModal } from "./shared/WorkspaceModal"
import { PageHeader, PageToolbar, ToolbarGroup, ToolbarSearch, ToolbarButton } from "./shared/LayoutPrimitives"
import { WorkspaceEmptyState, WorkspaceSectionCard, WorkspaceSelectField, WorkspaceTabStrip } from "./shared/OperationalWorkspacePrimitives"
import { ServiceDetailsView, ServiceForm } from "./ServiceRegistry"
import { CredentialValue, credentialUpdatePayload } from './shared/CredentialValue'

const SharedServiceModals = ({ 
  activeDetails, 
  setActiveDetails, 
  activeEdit, 
  setActiveEdit, 
  options, 
  devices,
  onServiceUpdate
}: any) => {
  const queryClient = useQueryClient()
  const [isMaximized, setIsMaximized] = useState(false)
  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const url = `/api/v1/logical-services/${data.id}`
      const method = "PUT"
      const res = await apiFetch(url, { method, body: JSON.stringify(data) })
      return res.json()
    },
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ["logical-services"] })
      queryClient.invalidateQueries({ queryKey: ["device-services"] })
      toast.success("Service Registry Updated")
      setActiveEdit(null)
      onServiceUpdate?.()
    },
    onError: (e: any) => toast.error(e.message)
  })

  return (
    <>
      <WorkspaceModal
        isOpen={!!activeEdit}
        onClose={() => setActiveEdit(null)}
        size="workspace"
        isMaximized={isMaximized}
        onMaximizeToggle={() => setIsMaximized(!isMaximized)}
        title="Modify Service Configuration"
        subtitle="Logical Service Identity & Environment"
        icon={<Layers size={20}/>}
        footerRight={
          <ToolbarButton onClick={() => setActiveEdit(null)}>Close</ToolbarButton>
        }
      >
        <div className="pt-6">
          <ServiceForm initialData={activeEdit} onSave={mutation.mutate} options={options} devices={devices} />
        </div>
      </WorkspaceModal>

      <WorkspaceModal
        isOpen={!!activeDetails}
        onClose={() => setActiveDetails(null)}
        size="workspace"
        isMaximized={isMaximized}
        onMaximizeToggle={() => setIsMaximized(!isMaximized)}
        title={activeDetails?.name || 'Service Details'}
        subtitle={`${activeDetails?.service_type} // ${activeDetails?.environment}`}
        icon={<Eye size={20}/>}
        footerRight={
          <ToolbarButton onClick={() => setActiveDetails(null)}>Close</ToolbarButton>
        }
      >
        <div className="pt-6">
          <ServiceDetailsView service={activeDetails} options={options} devices={devices} />
        </div>
      </WorkspaceModal>
    </>
  )
}

export const AssetServicesTable = ({ deviceId, onViewDetails, onEdit }: { deviceId: number, onViewDetails: (s: any) => void, onEdit: (s: any) => void }) => {
  const { data: services, isLoading } = useQuery({
    queryKey: ['device-services', deviceId],
    queryFn: async () => (await (await apiFetch(`/api/v1/logical-services/?device_id=${deviceId}`)).json())
  })

  return (
    <div className="p-0 overflow-hidden">
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-12 text-slate-500">
          <RefreshCcw size={20} className="animate-spin mb-2" />
          <p className="text-[10px] font-bold uppercase">Loading services...</p>
        </div>
      )}
      {!isLoading && (<table className="w-full text-[11px]">
        <thead className="bg-white/5 border-b border-white/5">
          <tr>
            <th className="px-4 py-2 text-left font-bold uppercase tracking-widest text-slate-500">Service Name</th>
            <th className="px-4 py-2 text-left font-bold uppercase tracking-widest text-slate-500">Type</th>
            <th className="px-4 py-2 text-center font-bold uppercase tracking-widest text-slate-500">Status</th>
            <th className="px-4 py-2 text-center font-bold uppercase tracking-widest text-slate-500">Environment</th>
            <th className="px-4 py-2 text-center font-bold uppercase tracking-widest text-slate-500">Version</th>
            <th className="px-4 py-2 text-center font-bold uppercase tracking-widest text-slate-500">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {services?.map((s: any) => (
            <tr key={s.id} className="hover:bg-white/5 transition-colors">
              <td className="px-4 py-3 font-bold text-blue-400">{s.name}</td>
              <td className="px-4 py-3 text-slate-400 uppercase font-bold text-[11px]">{s.service_type}</td>
              <td className="px-4 py-3 text-center">
                 <span className={`px-2 py-0.5 rounded-lg text-[11px] font-bold uppercase border ${
                    s.status === 'Running' || s.status === 'Active' ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10' :
                    s.status === 'Stopped' ? 'text-slate-400 border-slate-500/20 bg-slate-500/10' :
                    s.status === 'Maintenance' ? 'text-amber-400 border-amber-500/20 bg-amber-500/10' :
                    'text-rose-400 border-rose-500/20 bg-rose-500/10'
                 }`}>{s.status}</span>
              </td>
              <td className="px-4 py-3 text-center text-slate-500 uppercase font-bold">{s.environment}</td>
              <td className="px-4 py-3 text-center font-mono text-slate-600">{s.version || 'N/A'}</td>
              <td className="px-4 py-3 text-center">
                 <div className="flex items-center justify-center space-x-1">
                   <button
                     onClick={() => onViewDetails(s)}
                     className="p-1.5 bg-blue-600/10 text-blue-400 border border-blue-500/20 rounded-lg hover:bg-blue-600/20 transition-all flex items-center justify-center space-x-1"
                     title="View Service Forensics"
                   >
                     <List size={14}/>
                   </button>
                   <button
                     onClick={() => onEdit(s)}
                     className="p-1.5 bg-emerald-600/10 text-emerald-400 border border-emerald-500/20 rounded-lg hover:bg-emerald-600/20 transition-all flex items-center justify-center"
                     title="Edit Service Instance"
                   >
                     <Edit2 size={14}/>
                   </button>
                 </div>
              </td>
            </tr>
          ))}
          {!services?.length && !isLoading && (
            <tr>
              <td colSpan={6} className="px-4 py-8">
                <WorkspaceEmptyState
                  compact
                  title="No logical services bound to this asset"
                  description="This device does not have any logical services mapped in the registry."
                  icon={<Layers size={20} className="text-slate-600" />}
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
      )}
    </div>
  )
}
const StatusBulkUpdateModal = ({ isOpen, onClose, onApply, options, count }: { isOpen: boolean, onClose: () => void, onApply: (status: string) => void, options: any[], count?: number }) => {
  const [selectedStatus, setSelectedStatus] = useState('')

  useEffect(() => {
    if (isOpen) setSelectedStatus('')
  }, [isOpen])

  return (
    <WorkspaceModal
      isOpen={isOpen}
      onClose={onClose}
      size="compact"
      title="Update Status"
      subtitle={count ? `Updating ${count} asset${count !== 1 ? 's' : ''}` : 'Select target operational state'}
      icon={<Tag size={20}/>}
      footerRight={
        <>
          <ToolbarButton onClick={onClose}>Cancel</ToolbarButton>
          <ToolbarButton 
            disabled={!selectedStatus}
            onClick={() => onApply(selectedStatus)}
            variant="primary"
          >
            Apply to Selection
          </ToolbarButton>
        </>
      }
    >
      <div className="pt-6">
        <StyledSelect
          label="Target Operational State"
          value={selectedStatus}
          onChange={e => setSelectedStatus(e.target.value)}
          options={STATUS_ITEMS}
          placeholder="Select Status..."
        />
      </div>
    </WorkspaceModal>
  )
}

const BulkEnvUpdateModal = ({ isOpen, onClose, onApply, options, count }: { isOpen: boolean, onClose: () => void, onApply: (env: string) => void, options: any[], count?: number }) => {
  const [selectedEnv, setSelectedEnv] = useState('')

  useEffect(() => {
    if (isOpen) setSelectedEnv('')
  }, [isOpen])

  return (
    <WorkspaceModal
      isOpen={isOpen}
      onClose={onClose}
      size="compact"
      title="Update Environment"
      subtitle={count ? `Updating ${count} asset${count !== 1 ? 's' : ''}` : 'Select target logical environment'}
      icon={<Globe size={20}/>}
      footerRight={
        <>
          <ToolbarButton onClick={onClose}>Cancel</ToolbarButton>
          <ToolbarButton 
            disabled={!selectedEnv}
            onClick={() => onApply(selectedEnv)}
            variant="primary"
          >
            Apply to Selection
          </ToolbarButton>
        </>
      }
    >
      <div className="pt-6">
        <StyledSelect
          label="Target Environment"
          value={selectedEnv}
          onChange={e => setSelectedEnv(e.target.value)}
          options={ENVIRONMENT_ITEMS}
          placeholder="Select Environment..."
        />
      </div>
    </WorkspaceModal>
  )
}

const MetadataEditor = ({ value, onChange, onError }: { value: any, onChange: (v: any) => void, onError?: (err: string | null) => void }) => {
  const [mode, setMode] = useState<'table' | 'json'>('table')
  const [tableRows, setTableRows] = useState<{key: string, value: string}[]>([])
  const [jsonValue, setJsonValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      const obj = typeof value === 'string' ? JSON.parse(value || '{}') : (value || {})
      setTableRows(Object.entries(obj).map(([k, v]) => ({ key: k, value: String(v) })))
      setJsonValue(JSON.stringify(obj, null, 2))
    } catch {
      setTableRows([])
      setJsonValue('')
      setError('Invalid metadata format')
      onError?.('Invalid metadata format')
    }
  }, [JSON.stringify(value), onError])

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
        const keys = Object.keys(obj)
        if (new Set(keys).size !== keys.length) {
            setError("Duplicate keys in JSON")
            onError?.("Duplicate keys in JSON")
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
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Service Metadata</span>
            {error && <div className="flex items-center space-x-1 text-rose-500"><AlertCircle size={12} className="animate-pulse" /><span className="text-[8px] font-bold uppercase tracking-tighter">{error}</span></div>}
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
                }} placeholder="Key" className={`flex-1 bg-black/40 border ${error?.includes('Duplicate') ? 'border-rose-500/50' : 'border-white/5'} rounded-lg px-3 py-1.5 text-[11px] outline-none focus:border-blue-500`} />
                <input value={row.value} onChange={e => {
                  const n = [...tableRows]; n[i].value = e.target.value; 
                  setTableRows(n); validateAndNotify(n);
                }} placeholder="Value" className="flex-[2] bg-black/40 border border-white/5 rounded-lg px-3 py-1.5 text-[11px] outline-none" />
                <button onClick={() => {
                    const n = tableRows.filter((_, idx) => idx !== i);
                    setTableRows(n); validateAndNotify(n);
                }} className="text-slate-600 hover:text-rose-400"><X size={14}/></button>
              </div>
            ))}
            <button onClick={() => {
                const n = [...tableRows, { key: '', value: '' }];
                setTableRows(n);
            }} className="text-[9px] font-bold text-blue-400 uppercase tracking-widest mt-2 hover:text-blue-300 transition-colors">+ Add Attribute Pair</button>
          </div>
        ) : (
          <textarea 
            value={jsonValue} 
            onChange={e => {
                setJsonValue(e.target.value);
                syncFromJSON(e.target.value);
            }} 
            className={`w-full h-32 bg-black/40 border ${error === 'Invalid JSON format' || error === 'Duplicate keys in JSON' ? 'border-rose-500/50' : 'border-white/5'} rounded-lg px-4 py-3 text-[11px] font-mono text-blue-300 outline-none`}
          />
        )}
      </div>
    </div>
  )
}

export const MetadataViewer = ({ data }: { data: any }) => {
  let obj: any = {}
  try {
    obj = typeof data === 'string' ? JSON.parse(data || '{}') : (data || {})
  } catch {
    obj = {}
  }
  return (
    <div className="p-6 space-y-4">
      <h3 className="text-[10px] font-bold uppercase text-blue-400 tracking-[0.2em]">Metadata Inspection</h3>
      <div className="bg-slate-900/50 rounded-lg border border-white/5 overflow-hidden">
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
                <td className="px-4 py-2 font-bold uppercase text-slate-400">{k}</td>
                <td className="px-4 py-2 text-slate-200">{String(v)}</td>
              </tr>
            ))}
            {Object.keys(obj).length === 0 && (
              <tr><td colSpan={2} className="px-4 py-8 text-center text-slate-600 font-bold uppercase">No additional payload data</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export const MiniMonitoringTable = ({ deviceId }: { deviceId: number }) => {
  const { data: monitors, isLoading } = useQuery({
    queryKey: ['device-monitors', deviceId],
    queryFn: async () => (await apiFetch(`/api/v1/monitoring/?device_id=${deviceId}`)).json()
  })

  if (isLoading) return <div className="p-12 text-center text-[10px] font-bold uppercase animate-pulse text-slate-500">Retrieving Telemetry...</div>

  return (
    <div className="overflow-hidden">
      <table className="w-full text-[11px]">
        <thead className="bg-white/5 border-b border-white/5">
          <tr>
            <th className="px-4 py-2 text-left font-bold uppercase tracking-widest text-slate-500">Category</th>
            <th className="px-4 py-2 text-left font-bold uppercase tracking-widest text-slate-500">Title</th>
            <th className="px-4 py-2 text-center font-bold uppercase tracking-widest text-slate-500">Status</th>
            <th className="px-4 py-2 text-center font-bold uppercase tracking-widest text-slate-500">Severity</th>
            <th className="px-4 py-2 text-center font-bold uppercase tracking-widest text-slate-500">Interval</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {monitors?.map((m: any) => (
            <tr key={m.id} className="hover:bg-white/5 transition-colors group">
              <td className="px-4 py-3 font-bold text-slate-400 uppercase">{m.category}</td>
              <td className="px-4 py-3 font-bold text-white group-hover:text-blue-400 transition-colors">{m.title}</td>
              <td className="px-4 py-3 text-center">
                 <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase border ${
                    m.status === 'Healthy' ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5' :
                    m.status === 'Degraded' ? 'text-amber-400 border-amber-500/20 bg-amber-500/5' :
                    'text-rose-400 border-rose-500/20 bg-rose-500/5'
                 }`}>{m.status}</span>
              </td>
              <td className="px-4 py-3 text-center">
                 <span className={`text-[10px] font-bold uppercase ${
                    m.severity === 'Critical' ? 'text-rose-500' :
                    m.severity === 'Warning' ? 'text-amber-500' :
                    'text-blue-400'
                 }`}>{m.severity}</span>
              </td>
              <td className="px-4 py-3 text-center font-mono text-slate-600">{m.check_interval}s</td>
            </tr>
          ))}
          {!monitors?.length && (
            <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-600 font-bold uppercase tracking-widest">No active monitoring nodes deployed</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

const ConnectionMap = ({ deviceId, type, devices }: { deviceId: number, type: 'dependency' | 'network', devices: any[] }) => {
  const { data: rels } = useQuery({ 
    queryKey: ['device-rel', deviceId], 
    queryFn: async () => (await apiFetch(`/api/v1/devices/${deviceId}/relationships`)).json(),
    enabled: type === 'dependency'
  })

  const { data: conns } = useQuery({ 
    queryKey: ['device-conns', deviceId], 
    queryFn: async () => (await apiFetch(`/api/v1/networks/connections?device_id=${deviceId}`)).json(),
    enabled: type === 'network'
  })

  const centerDevice = devices?.find(d => d.id === deviceId)
  
  const graphData = useMemo(() => {
    const nodes = [{ id: deviceId, name: centerDevice?.name, isCenter: true, type: centerDevice?.type }]
    const links: any[] = []

    if (type === 'dependency' && rels) {
      rels.forEach((r: any) => {
        const isSource = r.source_device_id === deviceId
        const peerId = isSource ? r.target_device_id : r.source_device_id
        const peer = devices?.find(d => d.id === peerId)
        if (peer) {
          nodes.push({ id: peerId, name: peer.name, isCenter: false, type: peer.type })
          links.push({ 
            source: isSource ? deviceId : peerId, 
            target: isSource ? peerId : deviceId, 
            label: r.relationship_type,
            role: isSource ? r.source_role : r.target_role,
            peerRole: isSource ? r.target_role : r.source_role
          })
        }
      })
    } else if (type === 'network' && conns) {
      conns.forEach((c: any) => {
        const isSource = c.src_device_id === deviceId
        const peerId = isSource ? c.dst_device_id : c.src_device_id
        const peer = devices?.find(d => d.id === peerId)
        if (peer) {
          nodes.push({ id: peerId, name: peer.name, isCenter: false, type: peer.type })
          links.push({ 
            source: isSource ? deviceId : peerId, 
            target: isSource ? peerId : deviceId, 
            label: c.connection_type,
            details: `${c.src_port ? `P:${c.src_port}` : ''} ${c.dst_port ? `-> P:${c.dst_port}` : ''} [${c.vlan ? `VLAN:${c.vlan}` : ''}]`
          })
        }
      })
    }

    return { nodes, links }
  }, [deviceId, rels, conns, devices, type, centerDevice])

  return (
    <div className="h-[300px] w-full relative bg-black/20 rounded-lg border border-white/5 overflow-hidden">
       {graphData.nodes.length <= 1 ? (
         <div className="h-full flex items-center justify-center text-[10px] font-bold uppercase text-slate-600 tracking-widest">
            No active {type} vectors identified
         </div>
       ) : (
         <ForceGraph2D
           graphData={graphData}
           height={300}
           width={500}
           nodeColor={n => n.isCenter ? '#3b82f6' : '#64748b'}
           nodeLabel={n => `${n.name} [${n.type}]`}
           linkColor={() => 'rgba(255, 255, 255, 0.15)'}
           linkDirectionalArrowLength={4}
           linkDirectionalArrowRelPos={1}
           linkCanvasObjectMode={() => 'after'}
           linkCanvasObject={(link: any, ctx, globalScale) => {
              const MAX_FONT_SIZE = 8;
              const LABEL_NODE_MARGIN = globalScale * 2;

              const start = link.source;
              const end = link.target;

              if (typeof start !== 'object' || typeof end !== 'object') return;

              const text = type === 'dependency' ? link.label : link.details || link.label;
              const fontSize = Math.min(MAX_FONT_SIZE, 10 / globalScale);
              ctx.font = `${fontSize}px Inter`;
              const textWidth = ctx.measureText(text).width;
              const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2) as [number, number];

              const relLink = { x: end.x - start.x, y: end.y - start.y };
              const maxRange = Math.sqrt(Math.pow(relLink.x, 2) + Math.pow(relLink.y, 2));
              const textPos = { x: start.x + relLink.x * 0.5, y: start.y + relLink.y * 0.5 };

              ctx.save();
              ctx.translate(textPos.x, textPos.y);
              ctx.rotate(Math.atan2(relLink.y, relLink.x));
              
              ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
              ctx.fillRect(-bckgDimensions[0] / 2, -bckgDimensions[1] / 2, bckgDimensions[0], bckgDimensions[1]);

              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillStyle = type === 'dependency' ? '#818cf8' : '#34d399';
              ctx.fillText(text, 0, 0);
              ctx.restore();
           }}
           nodeCanvasObject={(node: any, ctx, globalScale) => {
             const label = node.name;
             const fontSize = node.isCenter ? 12/globalScale : 10/globalScale;
             ctx.font = `${fontSize}px Inter`;
             const textWidth = ctx.measureText(label).width;
             const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2) as [number, number];

             ctx.fillStyle = node.isCenter ? '#3b82f6' : '#1e293b';
             ctx.beginPath(); ctx.arc(node.x, node.y, node.isCenter ? 6 : 4, 0, 2 * Math.PI, false); ctx.fill();

             ctx.textAlign = 'center';
             ctx.textBaseline = 'middle';
             ctx.fillStyle = node.isCenter ? '#fff' : '#94a3b8';
             ctx.fillText(label, node.x, node.y + (node.isCenter ? 12 : 10));
           }}
           cooldownTicks={100}
         />
       )}
    </div>
  )
}

const AssetReportView = ({ assets, selectedId, onSelect, options, onEdit, onViewServiceDetails, onEditService, devices }: any) => {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState({ name: '', system: '', type: '', status: '', env: '' })
  
  const filteredAssets = useMemo(() => {
    return assets?.filter((a: any) => {
      const matchName = a.name.toLowerCase().includes(filter.name.toLowerCase())
      const matchSystem = !filter.system || a.system === filter.system
      const matchType = !filter.type || a.type === filter.type
      const matchStatus = !filter.status || a.status === filter.status
      const matchEnv = !filter.env || a.environment === filter.env
      return matchName && matchSystem && matchType && matchStatus && matchEnv
    }) || []
  }, [assets, filter])

  const selectedAsset = useMemo(() => assets?.find((a: any) => a.id === selectedId), [assets, selectedId])

  useEffect(() => {
    if (!selectedId && filteredAssets.length > 0) {
      onSelect(filteredAssets[0].id)
    }
  }, [filteredAssets, selectedId, onSelect])

  const getOptions = (cat: string) => Array.isArray(options) ? options.filter((o: any) => o.category === cat) : []

  return (
    <div className="flex-1 flex overflow-hidden space-x-4">
      {/* Left Vertical List */}
      <div className="w-80 flex flex-col glass-panel rounded-lg overflow-hidden border-white/5">
        <div className="p-4 border-b border-white/5 space-y-3 bg-white/5">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input 
              value={filter.name} 
              onChange={e => setFilter({ ...filter, name: e.target.value })} 
              placeholder="Search Assets..." 
              className="w-full bg-black/40 border border-white/5 rounded-lg pl-9 pr-4 py-2 text-[10px] font-bold uppercase outline-none focus:border-blue-500/50 transition-all" 
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select value={filter.system} onChange={e => setFilter({ ...filter, system: e.target.value })} className="bg-black/40 border border-white/5 rounded-lg px-2 py-1.5 text-[9px] font-bold uppercase text-slate-400 outline-none">
              <option value="">All Systems</option>
              {getOptions('LogicalSystem').map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value })} className="bg-black/40 border border-white/5 rounded-lg px-2 py-1.5 text-[9px] font-bold uppercase text-slate-400 outline-none">
              <option value="">All Types</option>
              {ASSET_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })} className="bg-black/40 border border-white/5 rounded-lg px-2 py-1.5 text-[9px] font-bold uppercase text-slate-400 outline-none">
              <option value="">All Statuses</option>
              {STATUS_ITEMS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={filter.env} onChange={e => setFilter({ ...filter, env: e.target.value })} className="bg-black/40 border border-white/5 rounded-lg px-2 py-1.5 text-[9px] font-bold uppercase text-slate-400 outline-none">
              <option value="">All Envs</option>
              {ENVIRONMENT_ITEMS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {filteredAssets.map((a: any) => (
            <button
              key={a.id}
              onClick={() => onSelect(a.id)}
              className={`w-full flex flex-col p-3 rounded-lg transition-all text-left relative overflow-hidden group ${selectedId === a.id ? 'bg-blue-600 text-white shadow-lg' : 'hover:bg-white/5 text-slate-400'}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-[11px] uppercase tracking-tighter truncate pr-2">{a.name}</span>
                <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-lg border ${
                  a.status === 'Active' ? 'bg-emerald-500/20 border-emerald-500/20 text-emerald-400' :
                  a.status === 'Maintenance' ? 'bg-amber-500/20 border-amber-500/20 text-amber-400' :
                  a.status === 'Failed' ? 'bg-rose-500/20 border-rose-500/20 text-rose-400' :
                  a.status === 'Reserved' ? 'bg-blue-500/20 border-blue-500/20 text-blue-400' :
                  a.status === 'Provisioning' ? 'bg-indigo-500/20 border-indigo-500/20 text-indigo-400' :
                  'bg-slate-500/10 border-white/5 text-slate-500'
                } ${selectedId === a.id ? 'border-white/40 text-white' : ''}`}>
                  {a.status}
                </span>
              </div>
              <div className="flex items-center space-x-2 text-[11px] font-bold opacity-60">
                <span>{a.system}</span>
                <span className="w-1 h-1 rounded-full bg-current opacity-30" />
                <span>{a.type}</span>
              </div>
              {selectedId === a.id && <motion.div layoutId="active-indicator" className="absolute left-0 top-0 bottom-0 w-1 bg-white" />}
            </button>
          ))}
          {!filteredAssets.length && (
            <WorkspaceEmptyState title="No matching assets" description="Adjust your filters or add new assets to the matrix." />
          )}
        </div>
      </div>

      {/* Right Report Content */}
      <div className="flex-1 glass-panel rounded-lg overflow-y-auto custom-scrollbar border-white/5 bg-[#0a0c14]/40">
        {selectedAsset ? (
          <div className="p-12 space-y-12">
            {/* Report Header */}
            <div className="flex items-start justify-between">
              <div className="space-y-6">
                <div className="flex items-center space-x-6">
                   <div className="bg-blue-600 p-3 rounded-lg text-white shadow-xl shadow-blue-500/20 ring-4 ring-blue-500/10">
                      <Box size={48} />
                   </div>
                   <div>
                      <h1 className="text-5xl font-black uppercase tracking-tighter text-white">{selectedAsset.name}</h1>
                      <div className="flex items-center space-x-4 mt-2">
                        <span className="text-blue-400 font-bold uppercase tracking-[0.3em] text-[14px]">{selectedAsset.system}</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-white/10" />
                        <span className="text-slate-500 font-bold uppercase tracking-[0.1em] text-[10px]">{selectedAsset.type} // {selectedAsset.environment} // {selectedAsset.owner || 'NO OWNER'}</span>
                      </div>
                   </div>
                </div>

                <div className="flex items-center space-x-8 bg-black/40 p-6 rounded-lg border border-white/5">
                   <div className="flex flex-col">
                      <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Operational State</span>
                      <span className={`px-4 py-1 rounded-lg text-[11px] font-bold uppercase border w-fit ${
                        selectedAsset.status === 'Active' ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5' :
                        selectedAsset.status === 'Maintenance' ? 'text-amber-400 border-amber-500/20 bg-amber-500/5' :
                        'text-rose-400 border-rose-500/20 bg-rose-500/5'
                      }`}>{selectedAsset.status}</span>
                   </div>
                   <div className="w-px h-10 bg-white/5" />
                   <div className="flex flex-col">
                      <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Primary Network IP</span>
                      <span className="text-xl font-mono text-blue-400 font-bold">{selectedAsset.primary_ip || '---.---.---.---'}</span>
                   </div>
                   <div className="w-px h-10 bg-white/5" />
                   <div className="flex flex-col">
                      <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Management OOB IP</span>
                      <span className="text-xl font-mono text-indigo-400 font-bold">{selectedAsset.management_ip || '---.---.---.---'}</span>
                   </div>
                </div>
              </div>
              <div className="flex flex-col items-end space-y-3">
                 <button onClick={() => onEdit(selectedAsset)} className="flex items-center space-x-3 px-6 py-3 bg-blue-600 text-white rounded-lg text-[11px] font-bold uppercase tracking-widest hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20">
                    <Edit2 size={16}/> <span>Modify Config</span>
                 </button>
                 <div className="text-right">
                    <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Last Synced</p>
                    <p className="text-[10px] font-mono text-slate-400">{new Date().toLocaleString()}</p>
                 </div>
              </div>
            </div>

            {/* Quick Stats Banner */}
            <div className="grid grid-cols-6 gap-4 bg-white/5 p-6 rounded-lg border border-white/5">
               <div className="flex flex-col">
                  <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">Power Avg/Max</span>
                  <span className="text-xs font-mono text-white font-bold">{selectedAsset.power_typical_w}W / {selectedAsset.power_max_w}W</span>
               </div>
               <div className="flex flex-col">
                  <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">Site Location</span>
                  <span className="text-xs font-bold text-blue-400 uppercase">{selectedAsset.site_name || 'UNPLACED'}</span>
               </div>
               <div className="flex flex-col">
                  <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">Rack ID</span>
                  <span className="text-xs font-bold text-white uppercase">{selectedAsset.rack_name || 'N/A'}</span>
               </div>
               <div className="flex flex-col">
                  <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">U Position</span>
                  <span className="text-xs font-bold text-indigo-400 uppercase">{selectedAsset.u_start || '--'}U</span>
               </div>
               <div className="flex flex-col">
                  <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">Form Factor</span>
                  <span className="text-xs font-bold text-white uppercase">{selectedAsset.size_u || 1}U / {selectedAsset.depth || 'Full'}</span>
               </div>
               <div className="flex flex-col">
                  <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">Asset Tag</span>
                  <span className="text-xs font-mono text-amber-500 font-bold uppercase">{selectedAsset.asset_tag || 'NO TAG'}</span>
               </div>
            </div>

            <div className="grid grid-cols-2 gap-8 items-stretch">
               {/* Hardware & System */}
               <div className="space-y-6 flex flex-col h-full">
                  <div className="flex items-center space-x-3 border-b border-white/5 pb-2">
                     <CpuIcon size={16} className="text-amber-400" />
                     <h3 className="text-[11px] font-bold uppercase tracking-[0.3em] text-slate-400">Hardware & System Architecture</h3>
                  </div>
                  <div className="bg-black/20 p-8 rounded-lg border border-white/5 grid grid-cols-2 gap-y-8 gap-x-12 flex-1">
                     <div>
                        <p className="text-[8px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-1">Platform Identity</p>
                        <p className="text-sm font-bold text-white uppercase">{selectedAsset.manufacturer} {selectedAsset.model}</p>
                        <p className="text-[10px] font-mono text-slate-500 mt-1">SN: {selectedAsset.serial_number || 'UNKNOWN'}</p>
                     </div>
                     <div>
                        <p className="text-[8px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-1">Operating Environment</p>
                        <p className="text-sm font-bold text-blue-400 uppercase">{selectedAsset.os_name} {selectedAsset.os_version}</p>
                        <p className="text-[10px] font-bold text-slate-500 mt-1 uppercase">Registry Depth: {selectedAsset.depth || 'Full'}</p>
                     </div>
                     <div className="col-span-2">
                        <p className="text-[8px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-2">Resource Utilization Summary</p>
                        <div className="bg-black/40 p-4 rounded-lg border border-white/5">
                           <p className="text-xs font-bold text-slate-300 uppercase leading-relaxed">{selectedAsset.hardware_summary || 'No hardware details registered for this unit.'}</p>
                        </div>
                     </div>
                  </div>
               </div>

               {/* Lifecycle & Logistics */}
               <div className="space-y-6 flex flex-col h-full">
                  <div className="flex items-center space-x-3 border-b border-white/5 pb-2">
                     <Calendar size={16} className="text-rose-400" />
                     <h3 className="text-[11px] font-bold uppercase tracking-[0.3em] text-slate-400">Lifecycle & Logistics Registry</h3>
                  </div>
                  <div className="bg-black/20 p-8 rounded-lg border border-white/5 grid grid-cols-2 gap-8 flex-1">
                     <div className="space-y-8">
                        <div>
                           <p className="text-[8px] font-bold text-slate-500 uppercase mb-1">Deployment Phase</p>
                           <p className="text-sm font-bold text-white uppercase">{formatAppDay(selectedAsset.install_date)}</p>
                           <p className="text-[10px] font-bold text-blue-400 mt-1 uppercase">Total Uptime Age: {selectedAsset.hardware_age}</p>
                        </div>
                        <div>
                           <p className="text-[8px] font-bold text-slate-500 uppercase mb-1">Warranty Coverage</p>
                           <p className="text-sm font-bold text-white uppercase">{selectedAsset.warranty_end ? formatAppDay(selectedAsset.warranty_end) : 'EXPIRED / NO TERM'}</p>
                        </div>
                     </div>
                     <div className="space-y-8 text-right">
                        <div>
                           <p className="text-[8px] font-bold text-slate-500 uppercase mb-1">Acquisition Date</p>
                           <p className="text-sm font-bold text-white uppercase">{formatAppDay(selectedAsset.purchase_date)}</p>
                        </div>
                        <div>
                           <p className="text-[8px] font-bold text-slate-500 uppercase mb-1">Retirement EOL</p>
                           <p className="text-sm font-bold text-rose-400 uppercase">{selectedAsset.eol_date ? formatAppDay(selectedAsset.eol_date) : 'ACTIVE REIGN'}</p>
                        </div>
                     </div>
                  </div>
               </div>
            </div>

            {/* Connection Maps Section */}
            <div className="space-y-6">
               <div className="flex items-center space-x-3 border-b border-white/5 pb-2">
                  <Share2 size={16} className="text-indigo-400" />
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.3em] text-slate-400">Vector Topologies & Interconnects</h3>
               </div>
               <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-3">
                     <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest text-center">Dependency Vector Map</p>
                     <ConnectionMap deviceId={selectedAsset.id} type="dependency" devices={devices} />
                  </div>
                  <div className="space-y-3">
                     <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest text-center">Network Interconnect Map</p>
                     <ConnectionMap deviceId={selectedAsset.id} type="network" devices={devices} />
                  </div>
               </div>
            </div>

            {/* Logical Services & Telemetry */}
            <div className="grid grid-cols-2 gap-8">
               <div className="space-y-6">
                  <div className="flex items-center space-x-3 border-b border-white/5 pb-2">
                     <Layers size={16} className="text-blue-400" />
                     <h3 className="text-[11px] font-bold uppercase tracking-[0.3em] text-slate-400">Hosted Logical Services</h3>
                  </div>
                  <div className="glass-panel rounded-lg overflow-hidden border-white/5 bg-black/10">
                     <AssetServicesTable 
                       deviceId={selectedAsset.id} 
                       onViewDetails={onViewServiceDetails} 
                       onEdit={onEditService} 
                     />
                  </div>
               </div>

               <div className="space-y-6">
                  <div className="flex items-center space-x-3 border-b border-white/5 pb-2">
                     <Activity size={16} className="text-emerald-400" />
                     <h3 className="text-[11px] font-bold uppercase tracking-[0.3em] text-slate-400">Monitoring & Telemetry Nodes</h3>
                  </div>
                  <div className="glass-panel rounded-lg overflow-hidden border-white/5 bg-black/10">
                     <MiniMonitoringTable deviceId={selectedAsset.id} />
                  </div>
               </div>
            </div>

            {/* Security & Metadata */}
            <div className="grid grid-cols-2 gap-8">
               <div className="space-y-6">
                  <div className="flex items-center space-x-3 border-b border-white/5 pb-2">
                     <Shield size={16} className="text-amber-500" />
                     <h3 className="text-[11px] font-bold uppercase tracking-[0.3em] text-slate-400">Security Credentials & Secrets</h3>
                  </div>
                  <div className="glass-panel rounded-lg overflow-hidden border-white/5 bg-black/10">
                     <SecretsTable deviceId={selectedAsset.id} />
                  </div>
               </div>

               <div className="space-y-6">
                  <div className="flex items-center space-x-3 border-b border-white/5 pb-2">
                     <FileJson size={16} className="text-slate-400" />
                     <h3 className="text-[11px] font-bold uppercase tracking-[0.3em] text-slate-400">Registry Metadata Payload</h3>
                  </div>
                  <div className="glass-panel rounded-lg overflow-hidden border-white/5 bg-black/10 min-h-[150px]">
                     <MetadataViewer data={selectedAsset.metadata_json} />
                  </div>
               </div>
            </div>

            {/* Resources Registry (Bottom Full Width) */}
            <div className="space-y-6 pb-20">
               <div className="flex items-center space-x-3 border-b border-white/5 pb-2">
                  <HardDrive size={16} className="text-emerald-400" />
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.3em] text-slate-400">Physical Component Inventory</h3>
               </div>
               <div className="glass-panel rounded-lg overflow-hidden border-white/5 bg-black/10">
                  <HWTable deviceId={selectedAsset.id} />
               </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-4">
            <div className="p-6 bg-white/5 rounded-lg border border-white/10 opacity-20 animate-pulse">
               <FileText size={64} />
            </div>
            <p className="text-[10px] font-bold uppercase tracking-[0.5em]">Select Asset for Detailed Inspection</p>
          </div>
        )}
      </div>
    </div>
  )
}


export default function AssetGrid() {
  const queryClient = useQueryClient()
  const gridRef = React.useRef<any>(null)
  const [fontSize, setFontSize] = useState(11)
  const [rowDensity, setRowDensity] = useState(10)
  const [showStyleLab, setShowStyleLab] = useState(true)

  const [activeTab, setActiveTab] = useState<'inventory' | 'deleted'>('inventory')
  const [viewMode, setViewMode] = useState<'grid' | 'report' | 'map'>('grid')
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeModal, setActiveModal] = useState<any>(null)
  const [activeDetails, setActiveDetails] = useState<any>(null)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [showBulkMenu, setShowBulkMenu] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [isBulkStatusOpen, setIsBulkStatusOpen] = useState(false)
  const [isBulkEnvOpen, setIsBulkEnvOpen] = useState(false)
  const [confirmModal, setConfirmModal] = useState<any>({ isOpen: false, title: '', message: '', onConfirm: () => {}, variant: 'info' })

  // Shared Service Modal States (Moved from AssetDetailsView to top-level for screen-wide focus)
  const [activeServiceDetails, setActiveServiceDetails] = useState<any>(null)
  const [activeServiceEdit, setActiveServiceEdit] = useState<any>(null)

  const { data: devices } = useQuery({ 
    queryKey: ["devices-list-all"], 
    queryFn: async () => (await (await apiFetch("/api/v1/devices/")).json()) 
  })

  const openConfirm = (title: string, message: string, onConfirm: () => void, variant: any = 'danger') => {
    setConfirmModal({ isOpen: true, title, message, onConfirm, variant })
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (showBulkMenu && !target.closest('.bulk-menu-container')) {
        setShowBulkMenu(false)
      }
    }
    if (showBulkMenu) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [showBulkMenu])

  const { data: options } = useQuery({ queryKey: ['settings-options'], queryFn: async () => (await (await apiFetch('/api/v1/settings/options')).json()) })
  const { data: allAssets, isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: async () => (await (await apiFetch('/api/v1/devices/?include_deleted=true')).json())
  })

  const { inventoryAssets, deletedAssets } = useMemo(() => {
    if (!allAssets) return { inventoryAssets: [], deletedAssets: [] }
    return {
      inventoryAssets: allAssets.filter((a: any) => !a.is_deleted),
      deletedAssets: allAssets.filter((a: any) => a.is_deleted)
    }
  }, [allAssets])

  const assets = activeTab === 'inventory' ? inventoryAssets : deletedAssets

  useEffect(() => {
    if (gridRef.current?.api) {
      setTimeout(() => gridRef.current.api.autoSizeAllColumns(), 100)
    }
  }, [fontSize, rowDensity, assets])

  const mutation = useMutation({
    mutationFn: async ({ data }: any) => {
      const url = data.id ? `/api/v1/devices/${data.id}` : `/api/v1/devices/`
      const method = data.id ? 'PUT' : 'POST'
      try {
        const res = await apiFetch(url, { method, body: JSON.stringify(data) })
        return res.json()
      } catch (e: any) {
        if (e.message.includes('409') || e.message.includes('DUPLICATE')) {
          throw new Error('DUPLICATE_HOSTNAME')
        }
        throw e
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      queryClient.invalidateQueries({ queryKey: ['racks-all'] })
      toast.success('System Registry Updated')
      setActiveModal(null)
    },
    onError: (e: any) => {
      if (e.message === 'DUPLICATE_HOSTNAME') toast.error('ERROR: Hostname already exists in registry')
      else toast.error(e.message)
    }
  })

  const bulkMutation = useMutation({
    mutationFn: async ({ action, payload = {}, ids: overrideIds }: any) => {
      const idsToUse = overrideIds ?? selectedIds
      const res = await apiFetch('/api/v1/devices/bulk-action', {
        method: 'POST',
        body: JSON.stringify({ ids: idsToUse, action, payload })
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (data: any, variables: any) => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      queryClient.invalidateQueries({ queryKey: ['racks-all'] })
      setSelectedIds([])
      setShowBulkMenu(false)
      setIsBulkStatusOpen(false)
      if (variables.action === 'restore') {
        if (data.conflicts?.length > 0) {
            toast.error(`Restored ${data.restored.length} assets. ${data.conflicts.length} failed due to hostname conflict.`)
        } else {
            toast.success(`Restored ${data.restored.length} assets successfully.`)
        }
      } else {
        toast.success('Bulk Operation Complete')
      }
    },
    onError: (e: any) => toast.error(`Operation failed: ${e.message}`)
  })

  const columnDefs = useMemo(() => [
    { field: "id", headerName: "", width: 60, checkboxSelection: true, headerCheckboxSelection: true, pinned: 'left', cellClass: 'text-center pl-4', headerClass: 'text-center pl-4' },
    { 
      field: "name",
      headerName: "Instance",
      flex: 1.2,
      pinned: 'left',
      filter: true,
      cellStyle: { fontSize: `${fontSize}px` },
      cellClass: 'text-center font-bold text-blue-400',
      headerClass: 'text-center',
      cellRenderer: (p: any) => (
        <span className="font-bold text-blue-400">{p.value}</span>
      )
    },
    { field: "system", headerName: "System", width: 110, filter: true, cellStyle: { fontSize: `${fontSize}px` }, cellClass: 'text-center', headerClass: 'text-center' },
    { 
      field: "type", 
      headerName: "Type", 
      width: 90,
      filter: true,
      cellStyle: { fontSize: `${fontSize}px` },
      cellClass: 'text-center',
      headerClass: 'text-center',
      cellRenderer: (p: any) => {
        const colors: any = {
          Physical: 'text-emerald-400',
          Virtual: 'text-blue-400',
          Storage: 'text-amber-400',
          Switch: 'text-rose-400',
          Firewall: 'text-orange-400',
          'Load Balancer': 'text-purple-400'
        }
        return <span className={`font-bold ${colors[p.value] || 'text-slate-500'}`}>{p.value}</span>
      }
    },
    { 
      field: "status", 
      headerName: "Status", 
      width: 110,
      filter: true,
      cellClass: 'text-center',
      headerClass: 'text-center',
      cellRenderer: (p: any) => {
        const colors: any = {
          Active: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/20',
          Maintenance: 'text-amber-400 border-amber-500/40 bg-amber-500/20',
          Decommissioned: 'text-rose-400 border-rose-500/40 bg-rose-500/20',
          Planned: 'text-blue-400 border-blue-500/40 bg-blue-500/20',
          Standby: 'text-sky-400 border-sky-500/40 bg-sky-500/20',
          Offline: 'text-slate-400 border-white/20 bg-white/10'
        }
        return (
          <div className="flex items-center justify-center h-full">
            <div className={`flex items-center justify-center w-24 h-6 rounded-lg border shadow-sm ${colors[p.value] || 'text-slate-400 border-white/10 bg-white/5'}`}>
              <span className="font-bold tracking-tighter leading-none" style={{ fontSize: `${fontSize}px` }}>
                {p.value}
              </span>
            </div>
          </div>
        )
      }
    },

    { field: "environment", headerName: "Env", width: 80, filter: true, cellStyle: { fontSize: `${fontSize}px` }, cellClass: 'text-center font-bold text-slate-400', headerClass: 'text-center' },
    { field: "owner", headerName: "Owner", width: 100, filter: true, cellStyle: { fontSize: `${fontSize}px` }, cellClass: 'text-center font-bold', headerClass: 'text-center' },
    { field: "manufacturer", headerName: "Make", width: 80, filter: true, cellStyle: { fontSize: `${fontSize}px` }, cellClass: 'text-center font-bold', headerClass: 'text-center' },
    { field: "model", headerName: "Model", width: 90, filter: true, cellStyle: { fontSize: `${fontSize}px` }, cellClass: 'text-center font-bold', headerClass: 'text-center' },
    { field: "os_name", headerName: "OS", width: 80, filter: true, cellStyle: { fontSize: `${fontSize}px` }, cellClass: 'text-center font-bold', headerClass: 'text-center' },
    { field: "os_version", headerName: "Ver", width: 60, filter: true, cellStyle: { fontSize: `${fontSize}px` }, cellClass: 'text-center font-bold', headerClass: 'text-center' },
    { 
      field: "primary_ip", 
      headerName: "Primary IP", 
      width: 120, 
      filter: true,
      cellStyle: { fontSize: `${fontSize}px` },
      cellClass: 'text-center font-mono text-blue-400',
      headerClass: 'text-center'
    },
    { 
      field: "management_ip", 
      headerName: "Mgmt IP", 
      width: 120, 
      filter: true,
      cellStyle: { fontSize: `${fontSize}px` },
      cellClass: 'text-center font-mono text-indigo-400',
      headerClass: 'text-center'
    },
    { 
      field: "hardware_summary", 
      headerName: "Resources", 
      width: 150, 
      filter: true,
      cellStyle: { fontSize: `${fontSize}px` },
      cellClass: 'text-center font-bold text-slate-400',
      headerClass: 'text-center'
    },
    { 
      field: "hardware_age", 
      headerName: "Age", 
      width: 80, 
      filter: true,
      cellStyle: { fontSize: `${fontSize}px` },
      cellClass: 'text-center font-bold text-slate-500',
      headerClass: 'text-center'
    },
    { 
      field: "open_incident_count", 
      headerName: "Health", 
      width: 80, 
      filter: true,
      cellClass: 'text-center',
      headerClass: 'text-center',
      cellRenderer: (p: any) => p.value > 0 ? (
        <div className="flex items-center justify-center h-full">
           <div className="flex items-center space-x-1 bg-rose-500/10 border border-rose-500/30 px-2 py-0.5 rounded-lg text-rose-500">
              <AlertCircle size={10} className="animate-pulse" />
              <span className="font-bold" style={{ fontSize: `${fontSize}px` }}>{p.value}</span>
           </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-full text-emerald-500/30"><Check size={12}/></div>
      )
    },

    { field: "site_name", headerName: "Site", width: 100, filter: true, cellStyle: { fontSize: `${fontSize}px` }, cellClass: 'text-center font-bold', headerClass: 'text-center' },
    { field: "rack_name", headerName: "Rack", width: 80, filter: true, cellStyle: { fontSize: `${fontSize}px` }, cellClass: 'text-center font-bold', headerClass: 'text-center' },
    { 
      field: "depth", 
      headerName: "Depth", 
      width: 70,
      filter: true,
      cellClass: 'text-center',
      headerClass: 'text-center',
      cellRenderer: (p: any) => <span className="font-bold text-slate-500" style={{ fontSize: `${fontSize}px` }}>{p.value || 'Full'}</span>
    },
    { 
      field: "mount_orientation", 
      headerName: "Mount", 
      width: 80, 
      filter: true,
      cellClass: 'text-center', 
      headerClass: 'text-center', 
      cellRenderer: (p: any) => p.value ? <span className="font-bold text-indigo-400" style={{ fontSize: `${fontSize}px` }}>{p.value}</span> : <span className="text-slate-700 font-bold" style={{ fontSize: `${fontSize}px` }}>registry</span>
    },
    { field: "u_start", headerName: "U Pos", width: 60, filter: true, cellStyle: { fontSize: `${fontSize}px` }, cellClass: "font-mono text-center", headerClass: 'text-center' },
    { field: "size_u", headerName: "Size", width: 60, filter: true, cellStyle: { fontSize: `${fontSize}px` }, cellClass: "font-mono text-center", headerClass: 'text-center' },
    { field: "power_typical_w", headerName: "Avg W", width: 70, filter: true, cellStyle: { fontSize: `${fontSize}px` }, cellClass: "font-mono text-center", headerClass: 'text-center', cellRenderer: (p: any) => p.value ? `${p.value.toFixed(0)}W` : '–' },
    { field: "power_max_w", headerName: "Max W", width: 70, filter: true, cellStyle: { fontSize: `${fontSize}px` }, cellClass: "font-mono text-center", headerClass: 'text-center', cellRenderer: (p: any) => p.value ? `${p.value.toFixed(0)}W` : '–' },
    {
      headerName: "Ops",
      width: 140,
      pinned: 'right',
      cellClass: 'text-center',
      headerClass: 'text-center',
      cellRenderer: (p: any) => (
        <div className="flex items-center justify-center space-x-1 h-full">
           <div className="flex rounded-lg p-0.5 border border-white/5 bg-transparent">
               <button onClick={() => {
                 const ip = p.data.management_ip;
                 if (!ip) return toast.error("No Management IP configured");
                 window.open(`https://${ip}`, '_blank');
               }} title="Quick Console Access" className="p-1.5 text-indigo-400 hover:text-indigo-200 transition-all border-r border-white/5"><Terminal size={14}/></button>
               <button onClick={() => setActiveDetails(p.data)} title="View Details" className="p-1.5 text-blue-400 hover:text-blue-200 transition-all"><Eye size={14}/></button>
               <button onClick={() => setActiveModal(p.data)} title="Edit Configuration" className="p-1.5 text-emerald-400 hover:text-emerald-200 transition-all"><Edit2 size={14}/></button>
               {activeTab !== 'deleted' ? (
                 <button onClick={() => openConfirm('Soft Delete', 'Move this asset to deleted?', () => bulkMutation.mutate({ action: 'delete', ids: [p.data.id] }))} title="Soft Delete" className="p-1.5 text-rose-400 hover:text-rose-200 transition-all"><Trash2 size={14}/></button>
               ) : (
                 <button onClick={() => openConfirm('Purge Registry', 'PURGE PERMANENTLY?', () => bulkMutation.mutate({ action: 'purge', ids: [p.data.id] }))} title="Purge" className="p-1.5 text-rose-400 hover:text-rose-200 transition-all"><Trash2 size={14}/></button>
               )}
           </div>
        </div>
      )
    }
  ], [activeTab, fontSize]) as any

  const { data: allConnections } = useQuery({ queryKey: ['all-connections'], queryFn: async () => (await (await apiFetch('/api/v1/networks/connections')).json()) })
  const { data: allRelationships } = useQuery({ queryKey: ['all-relationships'], queryFn: async () => (await (await apiFetch('/api/v1/devices/relationships/all')).json()) })

  return (
    <div className="flex h-full flex-col gap-6">
      <PageHeader
        eyebrow="Infrastructure Asset Registry"
        title="Assets"
        subtitle="Manage logical and physical compute, storage, and networking resources."
        actions={
          <ToolbarGroup>
            <ToolbarButton onClick={() => setShowConfig(true)}>
              <div className="flex items-center gap-2"><Settings size={14} /> Registry Config</div>
            </ToolbarButton>
            <ToolbarButton 
              variant="primary" 
              onClick={() => setActiveModal({})} 
            >
              <div className="flex items-center gap-2"><Plus size={14} /> Register Asset</div>
            </ToolbarButton>
          </ToolbarGroup>
        }
      />

      <PageToolbar
        left={
          <>
            <ToolbarGroup>
              <ToolbarButton 
                active={viewMode === 'grid'} 
                onClick={() => { setViewMode('grid'); setShowStyleLab(true); }}
              >
                <div className="flex items-center gap-2">
                  <LayoutGrid size={14}/> <span>Table</span>
                </div>
              </ToolbarButton>
              <ToolbarButton 
                active={viewMode === 'report'} 
                onClick={() => { setViewMode('report'); setShowStyleLab(false); }}
              >
                <div className="flex items-center gap-2">
                  <FileText size={14}/> <span>List</span>
                </div>
              </ToolbarButton>
              <ToolbarButton 
                active={viewMode === 'map'} 
                onClick={() => { setViewMode('map'); setShowStyleLab(false); }}
              >
                <div className="flex items-center gap-2">
                  <Globe size={14}/> <span>Map</span>
                </div>
              </ToolbarButton>
            </ToolbarGroup>

            {viewMode !== 'map' && (
              <div className="h-6 w-px bg-white/10 mx-2" />
            )}

            {viewMode !== 'map' && (
              <ToolbarGroup>
                <ToolbarButton 
                  variant={activeTab === 'inventory' ? 'primary' : 'secondary'}
                  onClick={() => { setActiveTab('inventory'); setSelectedIds([]) }}
                >
                  Existing
                </ToolbarButton>
                <ToolbarButton 
                  variant={activeTab === 'deleted' ? 'primary' : 'secondary'}
                  onClick={() => { setActiveTab('deleted'); setSelectedIds([]) }}
                >
                  Purged
                </ToolbarButton>
              </ToolbarGroup>
            )}
          </>
        }
        right={
          viewMode !== 'map' ? (
            <ToolbarGroup>
              <ToolbarSearch 
                value={searchTerm} 
                onChange={e => setSearchTerm(e.target.value)} 
                placeholder="Search assets..." 
              />
              
              <div className="relative bulk-menu-container">
                <button 
                  onClick={() => setShowBulkMenu(!showBulkMenu)} 
                  disabled={selectedIds.length === 0} 
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-all ${selectedIds.length > 0 ? 'bg-blue-600/10 border-blue-500/30 text-blue-400' : 'bg-white/5 border-white/5 text-slate-700 cursor-not-allowed'}`}
                >
                  <MoreVertical size={18}/>
                  {selectedIds.length > 0 && <span className="text-[10px] font-black">{selectedIds.length}</span>}
                </button>
                <AnimatePresence>
                  {showBulkMenu && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute right-0 mt-2 w-56 bg-slate-900 border border-white/10 rounded-lg shadow-2xl z-50 p-2 space-y-1">
                      <p className="px-3 py-2 text-[8px] font-bold text-slate-500 uppercase tracking-widest border-b border-white/5 mb-1">{selectedIds.length} Assets Selected</p>
                      {activeTab === 'deleted' ? (
                        <button onClick={() => bulkMutation.mutate({ action: 'restore' })} className="w-full text-left px-4 py-2 text-[10px] font-bold uppercase hover:bg-white/5 rounded-lg text-emerald-400 transition-all">Restore Selected</button>
                      ) : (
                        <>
                            <button onClick={() => { setIsBulkStatusOpen(true); setShowBulkMenu(false); }} className="w-full text-left px-4 py-2 text-[10px] font-bold uppercase hover:bg-white/5 rounded-lg text-blue-400 transition-all">Set Status...</button>
                            <button onClick={() => { setIsBulkEnvOpen(true); setShowBulkMenu(false); }} className="w-full text-left px-4 py-2 text-[10px] font-bold uppercase hover:bg-white/5 rounded-lg text-slate-400 transition-all">Set Environment...</button>
                        </>
                      )}
                      <div className="h-px bg-white/5 mx-2 my-1" />
                      <button onClick={() => { 
                          const title = activeTab === 'deleted' ? 'Purge Assets' : 'Soft Delete'
                          const msg = activeTab === 'deleted' ? 'PURGE PERMANENTLY?' : 'Soft-delete assets?'
                          openConfirm(title, msg, () => bulkMutation.mutate({ action: activeTab === 'deleted' ? 'purge' : 'delete' }))
                        }} className="w-full text-left px-4 py-2 text-[10px] font-bold uppercase hover:bg-rose-500/20 rounded-lg text-rose-500 transition-all">{activeTab === 'deleted' ? 'Bulk Purge' : 'Bulk Delete'}</button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <ToolbarButton 
                active={showStyleLab} 
                onClick={() => setShowStyleLab(!showStyleLab)} 
              >
                <Activity size={16} />
              </ToolbarButton>
            </ToolbarGroup>
          ) : null
        }
      />

      <AnimatePresence>
        {showStyleLab && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-blue-600/10 border border-blue-500/20 rounded-lg p-4 flex items-center justify-between backdrop-blur-md">
               <div className="flex items-center space-x-12">
                  <div className="flex items-center space-x-3">
                     <Activity size={16} className="text-blue-400" />
                     <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400">View Density Laboratory</span>
                  </div>
                  
                  <div className="flex items-center space-x-6">
                     <div className="flex items-center space-x-4">
                        <span className="text-[9px] font-bold text-slate-500 uppercase">Font Size</span>
                        <div className="flex items-center space-x-2">
                            <input 
                            type="range" min="8" max="14" step="1" 
                            value={fontSize} onChange={e => setFontSize(Number(e.target.value))}
                            className="w-32 accent-blue-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                            />
                            <span className="text-[10px] text-white w-4 font-bold">{fontSize}px</span>
                        </div>
                     </div>

                     <div className="flex items-center space-x-4 border-l border-white/10 pl-6">
                        <span className="text-[9px] font-bold text-slate-500 uppercase">Row Density</span>
                        <div className="flex items-center space-x-2">
                            <input 
                            type="range" min="0" max="20" step="2" 
                            value={rowDensity} onChange={e => setRowDensity(Number(e.target.value))}
                            className="w-32 accent-indigo-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                            />
                            <span className="text-[10px] text-white w-4 font-bold">{rowDensity}px</span>
                        </div>
                     </div>
                  </div>
               </div>
               <button onClick={() => setShowStyleLab(false)} className="text-slate-500 hover:text-white transition-colors"><X size={16}/></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {viewMode === 'grid' && (
        <div className="flex-1 glass-panel rounded-lg overflow-hidden ag-theme-alpine-dark relative border-white/5">
          {isLoading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#020617]/80 backdrop-blur-sm space-y-4 text-blue-400">
               <RefreshCcw size={32} className="animate-spin" />
               <p className="text-[10px] font-bold uppercase tracking-[0.3em]">Syncing asset registry...</p>
            </div>
          )}
          <AgGridReact 
            ref={gridRef}
            rowData={assets || []} 
            columnDefs={columnDefs} 
            rowSelection="multiple"
            headerHeight={fontSize + rowDensity + 10}
            rowHeight={fontSize + rowDensity + 10}
            onSelectionChanged={e => setSelectedIds(e?.api?.getSelectedNodes().map((n: any) => n.data?.id).filter(Boolean) || [])}
            quickFilterText={searchTerm}
            animateRows={true}
            enableCellTextSelection={true}
          />
        </div>
      )}

      {viewMode === 'report' && (
        <div className="flex-1 overflow-y-auto custom-scrollbar">
           <AssetReportView 
             assets={inventoryAssets} 
             selectedId={selectedAssetId} 
             onSelect={setSelectedAssetId} 
             options={options}
             onEdit={(a: any) => setActiveModal(a)}
             onViewServiceDetails={(s: any) => setActiveServiceDetails(s)}
             onEditService={(s: any) => setActiveServiceEdit(s)}
             devices={devices}
          />
        </div>
      )}

      {viewMode === 'map' && (
        <div className="flex-1 glass-panel rounded-lg overflow-hidden relative border-white/5 bg-slate-950">
           <AssetMap 
             assets={allAssets || []} 
             connections={allConnections || []}
             relationships={allRelationships || []}
             systemsList={options?.filter((o:any)=>o.category==='LogicalSystem').map((o:any)=>o.value) || []}
           />
        </div>
      )}
      <StatusBulkUpdateModal
        isOpen={isBulkStatusOpen}
        onClose={() => setIsBulkStatusOpen(false)}
        onApply={(s) => bulkMutation.mutate({ action: 'update', payload: { status: s } })}
        options={options || []}
        count={selectedIds.length}
      />

      <BulkEnvUpdateModal
        isOpen={isBulkEnvOpen}
        onClose={() => setIsBulkEnvOpen(false)}
        onApply={(e) => bulkMutation.mutate({ action: 'update', payload: { environment: e } })}
        options={options || []}
        count={selectedIds.length}
      />

      <ConfirmationModal 
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
        onConfirm={() => { confirmModal.onConfirm?.(); setConfirmModal((prev: any) => ({ ...prev, isOpen: false })); }}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
      />

      <WorkspaceModal
        isOpen={!!activeModal}
        onClose={() => setActiveModal(null)}
        size="workspace"
        title={activeModal?.id ? 'MODIFY ASSET CONFIGURATION' : 'New Asset Registration'}
        subtitle={activeModal?.id ? `Instance ID: ${activeModal.id}` : 'Infrastructure Onboarding'}
        icon={<Package size={20}/>}
        footerRight={
          <ToolbarButton onClick={() => setActiveModal(null)}>Close</ToolbarButton>
        }
      >
        <div className="pt-6">
          <AssetForm initialData={activeModal} onSave={mutation.mutate} options={options} isSaving={mutation.isPending} />
        </div>
      </WorkspaceModal>

      <WorkspaceModal
        isOpen={!!activeDetails}
        onClose={() => setActiveDetails(null)}
        size="workspace"
        title={activeDetails?.name || 'Asset Details'}
        subtitle={`${activeDetails?.system} · ${activeDetails?.type} · ${activeDetails?.primary_ip || 'NO IP'}`}
        icon={<Eye size={20}/>}
        footerRight={
          <ToolbarButton onClick={() => setActiveDetails(null)}>Close</ToolbarButton>
        }
      >
        <div className="pt-6">
          <AssetDetailsView 
            device={activeDetails} 
            options={options} 
            onViewServiceDetails={(s:any) => setActiveServiceDetails(s)}
            onEditService={(s:any) => setActiveServiceEdit(s)}
          />
        </div>
      </WorkspaceModal>

               <SharedServiceModals 
               activeDetails={activeServiceDetails}
               setActiveDetails={setActiveServiceDetails}
               activeEdit={activeServiceEdit}
               setActiveEdit={setActiveServiceEdit}
               options={options}
               devices={devices}
               onServiceUpdate={() => {
               queryClient.invalidateQueries({ queryKey: ['device-services'] })
               }}
               />
      <ConfigRegistryModal
        isOpen={showConfig}
        onClose={() => setShowConfig(false)}
        title="Asset Registry Enumerations"
        sections={[
            { title: "Logical Systems", category: "LogicalSystem", icon: LayoutGrid },
            { title: "Business Units", category: "BusinessUnit", icon: Sliders },
        ]}
      />

      <style>{`
        .ag-theme-alpine-dark {
          --ag-background-color: #1a1b26;
          --ag-header-background-color: #24283b;
          --ag-border-color: rgba(255, 255, 255, 0.05);
          --ag-foreground-color: #f1f5f9;
          --ag-header-foreground-color: #3b82f6;
          --ag-font-family: 'Inter', sans-serif;
          --ag-font-size: ${fontSize}px;
        }
        .ag-root-wrapper { border: none !important; }
        .ag-header-cell-label { 
            font-weight: 900 !important; 
            text-transform: uppercase !important; 
            letter-spacing: 0.1em !important; 
            font-size: ${fontSize}px !important; 
            justify-content: center !important; 
            font-style: !important;
        }
        .ag-cell { 
            display: flex; 
            align-items: center; 
            justify-content: center !important; 
        }
        .ag-row-hover { background-color: rgba(255,255,255,0.05) !important; }
        .ag-row-selected { background-color: rgba(59, 130, 246, 0.2) !important; }
        
        /* Make filter popups non-transparent and on top */
        .ag-popup { z-index: 1000 !important; }
        .ag-filter-wrapper { background-color: #24283b !important; border: 1px solid rgba(255,255,255,0.1) !important; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4) !important; border-radius: 12px !important; opacity: 1 !important; }
        .ag-filter-body { background-color: #24283b !important; padding: 12px !important; }
      `}</style>
    </div>
  )
}

const MetadataTab = ({ device, onSave }: { device: any, onSave: (d: any) => void }) => {
    const [mode, setMode] = useState<'view' | 'edit'>('view')
    const [metadataError, setMetadataError] = useState<string | null>(null)
    const [localData, setLocalData] = useState({ ...device })

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between px-2">
                <div className="flex space-x-1 bg-black/40 p-1 rounded-lg w-fit">
                    <button onClick={() => setMode('view')} className={`px-4 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all ${mode === 'view' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Read-Only View</button>
                    <button onClick={() => setMode('edit')} className={`px-4 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all ${mode === 'edit' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Edit Metadata</button>
                </div>
                {mode === 'edit' && (
                    <button 
                        disabled={!!metadataError}
                        onClick={() => onSave(localData)} 
                        className="px-6 py-2 bg-emerald-600 text-white rounded-lg text-[10px] font-bold uppercase shadow-lg shadow-emerald-500/20 active:scale-95 transition-all"
                    >
                        Save Metadata
                    </button>
                )}
            </div>
            
            <div className="bg-black/20 rounded-lg p-2">
                {mode === 'view' ? (
                    <MetadataViewer data={localData.metadata_json} />
                ) : (
                    <MetadataEditor 
                        value={localData.metadata_json} 
                        onChange={v => setLocalData({...localData, metadata_json: v})} 
                        onError={setMetadataError}
                    />
                )}
            </div>
        </div>
    )
}

const AssetDetailsView = ({ device, options, onViewServiceDetails, onEditService }: { device: any, options: any, onViewServiceDetails: (s:any)=>void, onEditService: (s:any)=>void }) => {
    const [tab, setTab] = useState('hardware')
    const queryClient = useQueryClient()

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

    const detailTabs = [
      { id: 'hardware', label: 'Hardware' },
      { id: 'secrets', label: 'Secrets' },
      { id: 'relations', label: 'Relations' },
      { id: 'services', label: 'Services' },
      { id: 'metadata', label: 'Metadata' }
    ]

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <WorkspaceTabStrip
                  tabs={detailTabs}
                  activeTab={tab}
                  onChange={setTab}
                />
            </div>
            <div className="glass-panel rounded-lg border-white/5 overflow-hidden p-6">
                {tab === 'metadata' && (
                  <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <MetadataTab device={device} onSave={(d:any) => mutation.mutate(d)} />
                  </div>
                )}
                {tab === 'hardware' && <HWTab deviceId={device.id} />}
                {tab === 'secrets' && <SecretsTab deviceId={device.id} />}
                {tab === 'relations' && <RelationshipsTab deviceId={device.id} />}
                {tab === 'services' && (
                  <AssetServicesTable 
                    deviceId={device.id} 
                    onViewDetails={onViewServiceDetails}
                    onEdit={onEditService}
                  />
                )}
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

const HWTable = ({ deviceId }: { deviceId: number }) => {
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
      <table className="w-full text-[11px]">
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
                    <span className="font-bold uppercase text-blue-400">{h.category}</span>
                )}
              </td>
              <td className="px-4 py-2 font-bold text-slate-200 text-center">
                {editingId === h.id ? (
                    <input value={editData.name} onChange={e => setEditData({...editData, name: e.target.value})} className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] w-full outline-none focus:border-blue-500" />
                ) : h.name}
              </td>
              <td className="px-4 py-2 text-slate-500 text-center">
                {editingId === h.id ? (
                    <input value={editData.specs} onChange={e => setEditData({...editData, specs: e.target.value})} className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] w-full outline-none focus:border-blue-500" />
                ) : h.specs}
              </td>
              <td className="px-4 py-2 font-mono text-center text-slate-400">
                {editingId === h.id ? (
                    <input type="number" value={editData.count} onChange={e => setEditData({...editData, count: parseInt(e.target.value)})} className="bg-slate-900 border border-white/10 rounded-lg px-1 py-1.5 text-[11px] w-12 outline-none focus:border-blue-500" />
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

const SecretsTable = ({ deviceId }: { deviceId: number }) => {
  const queryClient = useQueryClient()
  const { data: secrets } = useQuery({ queryKey: ['device-secrets', deviceId], queryFn: async () => (await (await apiFetch(`/api/v1/devices/${deviceId}/secrets`)).json()) })
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editData, setEditData] = useState<any>(null)
  const [confirmModal, setConfirmModal] = useState<any>({ isOpen: false, title: '', message: '', onConfirm: () => {} })

  const delMutation = useMutation({
    mutationFn: async (id: number) => apiFetch(`/api/v1/devices/secrets/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['device-secrets', deviceId] }); toast.success('Credential removed') },
    onError: (e: any) => toast.error(e.message || 'Failed to delete credential')
  })

  const updateMutation = useMutation({
    mutationFn: async (data: any) => apiFetch(`/api/v1/devices/secrets/${data.id}`, {
        method: 'PUT', body: JSON.stringify(credentialUpdatePayload(data))
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
      <table className="w-full text-[11px]">
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
              <td className="px-4 py-2 font-bold uppercase text-[var(--text-secondary)]">
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
                    <input value={editData.username} onChange={e => setEditData({...editData, username: e.target.value})} className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] w-full outline-none focus:border-blue-500" />
                ) : s.username}
              </td>
              <td className="px-4 py-2 font-mono text-slate-400">
                {editingId === s.id ? (
                    <input type="password" autoComplete="new-password" aria-label="Replacement credential value" value={editData.encrypted_payload} onChange={e => setEditData({...editData, encrypted_payload: e.target.value})} className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] w-full outline-none focus:border-blue-500" placeholder="Leave blank to keep stored value" />
                ) : (
                    <CredentialValue deviceId={deviceId} secretId={s.id} canReveal={s.can_reveal} hasPayload={s.has_payload} />
                )}
              </td>
              <td className="px-4 py-2 text-slate-500">
                {editingId === s.id ? (
                    <input value={editData.notes} onChange={e => setEditData({...editData, notes: e.target.value})} className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] w-full outline-none focus:border-blue-500" />
                ) : s.notes}
              </td>
              <td className="px-4 py-2 text-center">
                {editingId === s.id ? (
                    <div className="flex items-center justify-center space-x-1">
                        <button aria-label="Save credential" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate(editData)} className="p-1.5 hover:bg-emerald-500/20 text-emerald-400 rounded-lg"><Check size={14}/></button>
                        <button aria-label="Cancel credential editing" disabled={updateMutation.isPending} onClick={() => setEditingId(null)} className="p-1.5 hover:bg-rose-500/20 text-rose-400 rounded-lg"><X size={14}/></button>
                    </div>
                ) : (
                    <div className="flex items-center justify-center space-x-1">
                        <button aria-label="Edit credential" disabled={!s.can_manage} onClick={() => { setEditingId(s.id); setEditData({...s, encrypted_payload: ''}); }} className="p-1.5 hover:bg-white/10 text-slate-500 hover:text-blue-400 rounded-lg transition-all"><Edit2 size={14}/></button>
                        <button aria-label="Delete credential" disabled={!s.can_manage || delMutation.isPending} onClick={() => setConfirmModal({ isOpen: true, title: 'Delete Credential', message: 'Remove this credential?', onConfirm: () => delMutation.mutate(s.id) })} className="p-1.5 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded-lg transition-all"><Trash2 size={14}/></button>
                    </div>
                )}
              </td>
            </tr>
          ))}
          {!secrets?.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-600 font-bold uppercase">No credentials stored</td></tr>}
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

const RelationshipsTab = ({ deviceId }: { deviceId: number }) => {
  const queryClient = useQueryClient()
  const { data: devices } = useQuery({ queryKey: ['devices'], queryFn: async () => (await (await apiFetch('/api/v1/devices/')).json()) })
  
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
  const { data: devices } = useQuery({ queryKey: ['devices'], queryFn: async () => (await (await apiFetch('/api/v1/devices/')).json()) })
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
      <table className="w-full text-[11px]">
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
                     <select value={isSource ? editData.source_role : editData.target_role} onChange={e => isSource ? setEditData({...editData, source_role: e.target.value}) : setEditData({...editData, target_role: e.target.value})} className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-[11px] w-full outline-none focus:border-blue-500">
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
                        <span className="font-bold text-white uppercase tracking-tight">{currentDevice?.name || 'Local'}</span>
                        <span className={`text-[11px] font-bold uppercase w-fit mt-1 ${isSource ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {localRole}
                        </span>
                     </div>
                   )}
                </td>
                <td className="px-4 py-3 text-center">
                  {editingId === r.id ? (
                    <select value={editData.relationship_type} onChange={e => setEditData({...editData, relationship_type: e.target.value})} className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-[11px] w-full outline-none focus:border-blue-500">
                      <option>Depends On</option>
                      <option>Hosts</option>
                      <option>Backs Up</option>
                      <option>Replicates to</option>
                      <option>Cluster Member</option>
                    </select>
                  ) : (
                    <div className="flex flex-col items-center">
                       <span className="font-bold text-slate-500 uppercase tracking-widest text-[11px] mb-1">{r.relationship_type}</span>
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
                      <select value={!isSource ? editData.source_role : editData.target_role} onChange={e => !isSource ? setEditData({...editData, source_role: e.target.value}) : setEditData({...editData, target_role: e.target.value})} className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-[11px] w-full outline-none focus:border-blue-500">
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
                         <span className="font-bold text-blue-400 uppercase tracking-tight">{peer?.name || 'Unknown Entity'}</span>
                         <span className={`text-[11px] font-bold uppercase w-fit mt-1 ${!isSource ? 'text-emerald-400' : 'text-slate-400'}`}>
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
          {!relationships?.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-600 font-bold uppercase">No relationships defined</td></tr>}
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
    { value: 'Maintenance', label: 'Maintenance' },
    { value: 'Standby', label: 'Standby' },
    { value: 'Failed', label: 'Failed' },
    { value: 'Decommissioned', label: 'Decommissioned' },
    { value: 'Provisioning', label: 'Provisioning' },
    { value: 'Reserved', label: 'Reserved' }
]

const ENVIRONMENT_ITEMS = [
    { value: 'Production', label: 'Production' },
    { value: 'Staging', label: 'Staging' },
    { value: 'QA', label: 'QA' },
    { value: 'Dev', label: 'Dev' },
    { value: 'DR', label: 'DR' },
    { value: 'Lab', label: 'Lab' },
    { value: 'Sandbox', label: 'Sandbox' },
    { value: 'Legacy', label: 'Legacy' }
]

const AssetForm = ({ initialData, onSave, options, isSaving }: any) => {
  const [activeSubTab, setActiveSubTab] = useState('config')
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '', system: '', type: 'Physical', status: 'Active', environment: 'Production',
    owner: '', business_unit: '', manufacturer: '', model: '', serial_number: '', asset_tag: '',
    os_name: '', os_version: '', primary_ip: '', management_ip: '', management_url: '',
    purchase_date: '', install_date: '', warranty_end: '', eol_date: '',
    power_typical_w: 0, power_max_w: 0,
    metadata_json: {}, ...initialData
  })

  // Sync form data when initialData changes
  React.useEffect(() => {
    setFormData({
      name: '', system: '', type: 'Physical', status: 'Active', environment: 'Production',
      owner: '', business_unit: '', manufacturer: '', model: '', serial_number: '', asset_tag: '',
      os_name: '', os_version: '', primary_ip: '', management_ip: '', management_url: '',
      purchase_date: '', install_date: '', warranty_end: '', eol_date: '',
      power_typical_w: 0, power_max_w: 0,
      metadata_json: {}, ...initialData
    })
  }, [JSON.stringify(initialData)])

  const getOptions = (cat: string) => Array.isArray(options) ? options.filter((o: any) => o.category === cat) : []

  return (
    <div className="space-y-6 py-6">
      <div className="flex space-x-1 bg-black/40 p-1 rounded-lg w-fit mb-4">
         {['config', 'hardware', 'secrets', 'relations', 'metadata'].map(t => {
           const isDisabled = !formData.id && ['hardware', 'secrets', 'relations'].includes(t)
           return (
           <button
             key={t}
             onClick={() => !isDisabled && setActiveSubTab(t)}
             disabled={isDisabled}
             title={isDisabled ? 'Save asset first' : ''}
             className={`px-6 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''} ${activeSubTab === t ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-500 hover:text-slate-300'}`}>
             {t === 'config' ? 'Base Config' : t === 'relations' ? 'Relationships' : t}
           </button>
         )
         })}
      </div>

      {activeSubTab === 'config' && (
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-1 space-y-4">
             <h3 className="text-[10px] font-bold uppercase text-slate-500 tracking-widest border-l-2 border-blue-600 pl-3">Identity</h3>
             <div>
                <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Hostname</label>
                <input 
                  value={formData.name} 
                  onChange={e => setFormData({...formData, name: e.target.value})} 
                  className={`w-full bg-slate-900 border ${!formData.name ? 'border-rose-500/50' : 'border-white/10'} rounded-lg px-4 py-2.5 text-xs outline-none focus:border-blue-500 transition-all`} 
                  placeholder="SRV-NAME-01" 
                />
             </div>
             <StyledSelect
                label="Logical System"
                value={formData.system}
                onChange={e => setFormData({...formData, system: e.target.value})}
                options={getOptions('LogicalSystem')}
                placeholder="Select System..."
                error={!formData.system}
             />
             <div className="grid grid-cols-2 gap-2">
                <div>
                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Owner</label>
                    <input value={formData.owner} onChange={e => setFormData({...formData, owner: e.target.value})} placeholder="Owner" className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500/50" />
                </div>
                <StyledSelect
                    label="Business Unit"
                    value={formData.business_unit}
                    onChange={e => setFormData({...formData, business_unit: e.target.value})}
                    options={getOptions('BusinessUnit')}
                    placeholder="Select BU..."
                />
             </div>
          </div>

          <div className="col-span-1 space-y-4">
             <h3 className="text-[10px] font-bold uppercase text-slate-500 tracking-widest border-l-2 border-emerald-600 pl-3">Classification</h3>
             <div className="grid grid-cols-2 gap-2">
                <StyledSelect
                    label="Asset Type"
                    value={formData.type}
                    onChange={e => setFormData({...formData, type: e.target.value})}
                    options={ASSET_TYPES}
                />
                <StyledSelect
                    label="Physical Depth"
                    value={formData.depth || 'Full'}
                    onChange={e => setFormData({...formData, depth: e.target.value})}
                    options={[
                        { value: 'Full', label: 'Full Depth' },
                        { value: 'Half', label: 'Half Depth' }
                    ]}
                />
             </div>
             <div className="grid grid-cols-2 gap-2">
                <div>
                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Height (U)</label>
                    <input type="number" value={formData.size_u || 1} onChange={e => setFormData({...formData, size_u: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs outline-none focus:border-blue-500" />
                </div>
                <div />
             </div>
             <StyledSelect
                label="Operational Status"
                value={formData.status}
                onChange={e => setFormData({...formData, status: e.target.value})}
                options={STATUS_ITEMS}
             />
             <StyledSelect
                label="Environment"
                value={formData.environment}
                onChange={e => setFormData({...formData, environment: e.target.value})}
                options={ENVIRONMENT_ITEMS}
             />
             <h3 className="text-[10px] font-bold uppercase text-slate-500 tracking-widest border-l-2 border-indigo-600 pl-3 mt-6">Management & Connectivity</h3>
             <div className="space-y-3">
                <div>
                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1 px-1">Primary IP Address</label>
                    <input value={formData.primary_ip || ""} onChange={e => setFormData({...formData, primary_ip: e.target.value})} placeholder="e.g. 10.0.0.100" className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs font-mono outline-none focus:border-blue-500" />
                </div>
                <div>
                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1 px-1">Management IP Address</label>
                    <input value={formData.management_ip || ""} onChange={e => setFormData({...formData, management_ip: e.target.value})} placeholder="e.g. 10.0.0.50" className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs font-mono outline-none focus:border-indigo-500" />
                </div>
                <div>
                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1 px-1">Management URL / Console</label>
                    <input value={formData.management_url || ""} onChange={e => setFormData({...formData, management_url: e.target.value})} placeholder="https://..." className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs outline-none focus:border-indigo-500" />
                </div>
             </div>

          </div>

          <div className="col-span-1 space-y-4">
             <h3 className="text-[10px] font-bold uppercase text-slate-500 tracking-widest border-l-2 border-amber-600 pl-3">Software & Hardware</h3>
             <div>
                <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Manufacturer & Model</label>
                <div className="flex space-x-2">
                   <input value={formData.manufacturer} onChange={e => setFormData({...formData, manufacturer: e.target.value})} placeholder="Dell" className="w-1/2 bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none" />
                   <input value={formData.model} onChange={e => setFormData({...formData, model: e.target.value})} placeholder="R740" className="w-1/2 bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none" />
                </div>
             </div>
             <div>
                <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Operating System & Version</label>
                <div className="flex space-x-2">
                   <input value={formData.os_name} onChange={e => setFormData({...formData, os_name: e.target.value})} placeholder="Ubuntu" className="w-1/2 bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none" />
                   <input value={formData.os_version} onChange={e => setFormData({...formData, os_version: e.target.value})} placeholder="24.04 LTS" className="w-1/2 bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none" />
                </div>
             </div>
             <div>
                <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Serial / Asset Tag</label>
                <div className="flex space-x-2">
                    <input value={formData.serial_number} onChange={e => setFormData({...formData, serial_number: e.target.value})} placeholder="Serial" className="w-1/2 bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none" />
                    <input value={formData.asset_tag} onChange={e => setFormData({...formData, asset_tag: e.target.value})} placeholder="Asset Tag" className="w-1/2 bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none" />
                </div>
             </div>
             <div>
                <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Power Consumption (Watts)</label>
                <div className="flex space-x-2">
                    <div className="w-1/2">
                      <input type="number" min={0} step={0.1} value={formData.power_typical_w || 0} onChange={e => setFormData({...formData, power_typical_w: parseFloat(e.target.value) || 0})} placeholder="0" className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none font-mono" />
                      <label className="text-[8px] text-slate-500 uppercase mt-0.5 block">Typical</label>
                    </div>
                    <div className="w-1/2">
                      <input type="number" min={0} step={0.1} value={formData.power_max_w || 0} onChange={e => setFormData({...formData, power_max_w: parseFloat(e.target.value) || 0})} placeholder="0" className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none font-mono" />
                      <label className="text-[8px] text-slate-500 uppercase mt-0.5 block">Peak</label>
                    </div>
                </div>
             </div>
             <h3 className="text-[10px] font-bold uppercase text-slate-500 tracking-widest border-l-2 border-emerald-500 pl-3 mt-6">Lifecycle & Logistics</h3>
             <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1 px-1">Purchase Date</label>
                    <input type="date" value={formData.purchase_date ? formData.purchase_date.split('T')[0] : ""} onChange={e => setFormData({...formData, purchase_date: e.target.value})} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-[10px] outline-none" />
                </div>
                <div>
                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1 px-1">Installation Date</label>
                    <input type="date" value={formData.install_date ? formData.install_date.split('T')[0] : ""} onChange={e => setFormData({...formData, install_date: e.target.value})} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-[10px] outline-none border-emerald-500/30" />
                </div>
             </div>
             <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1 px-1">Warranty End</label>
                    <input type="date" value={formData.warranty_end ? formData.warranty_end.split('T')[0] : ""} onChange={e => setFormData({...formData, warranty_end: e.target.value})} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-[10px] outline-none border-amber-500/30" />
                </div>
                <div>
                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1 px-1">EOL / Retirement</label>
                    <input type="date" value={formData.eol_date ? formData.eol_date.split('T')[0] : ""} onChange={e => setFormData({...formData, eol_date: e.target.value})} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-[10px] outline-none border-rose-500/30" />
                </div>
             </div>
          </div>
        </div>
      )}

      {activeSubTab === 'metadata' && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
           <MetadataEditor 
             value={formData.metadata_json} 
             onChange={v => setFormData({...formData, metadata_json: v})} 
             onError={setMetadataError}
           />
        </div>
      )}

      {activeSubTab === 'hardware' && (formData.id ? <HWTab deviceId={formData.id} /> : <div className="py-20 text-center text-slate-500 font-bold uppercase text-[10px]">Save the asset first to add hardware components</div>)}
      {activeSubTab === 'secrets' && (formData.id ? <SecretsTab deviceId={formData.id} /> : <div className="py-20 text-center text-slate-500 font-bold uppercase text-[10px]">Save the asset first to add credentials</div>)}
      {activeSubTab === 'relations' && (formData.id ? <RelationshipsTab deviceId={formData.id} /> : <div className="py-20 text-center text-slate-500 font-bold uppercase text-[10px]">Save the asset first to add relationships</div>)}

      <div className="flex space-x-4 pt-4 border-t border-white/5">
        <button
          disabled={!!metadataError || isSaving}
          onClick={() => {
            if(!formData.name || !formData.system) return toast.error("Hostname and Logical System are mandatory");
            onSave({ data: formData })
          }}
          className={`flex-1 py-4 ${metadataError || isSaving ? 'bg-slate-700 cursor-not-allowed' : 'bg-blue-600'} text-white rounded-lg text-[11px] font-bold uppercase tracking-[0.2em] shadow-xl shadow-blue-500/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center space-x-2`}
        >
          {isSaving && <RefreshCcw size={14} className="animate-spin" />}
          <span>Save Asset</span>
        </button>
      </div>
    </div>
  )
}

function AssetMap({ assets, connections, relationships, systemsList }: any) {
  const [selectedSystems, setSelectedSystems] = useState<string[]>([])
  const [selectedAssetIds, setSelectedAssetIds] = useState<number[]>([])
  const [depth, setDepth] = useState(1)
  const [selectedNode, setSelectedNode] = useState<any>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [showLegend, setShowLegend] = useState(true)
  const fgRef = React.useRef<any>()

  const hasFilter = selectedSystems.length > 0 || selectedAssetIds.length > 0 || searchTerm.length >= 2

  const graphData = useMemo(() => {
    if (!hasFilter) return { nodes: [], links: [] }

    const nodesMap = new Map<number, any>()
    const linksMap = new Map<string, any>()
    const processedNodes = new Set<number>()

    // 1. Identify Root Nodes
    let rootAssets = assets.filter((a: any) => 
      selectedSystems.includes(a.system) || 
      selectedAssetIds.includes(a.id) ||
      (searchTerm.length >= 2 && a.name.toLowerCase().includes(searchTerm.toLowerCase()))
    )

    const addNode = (asset: any) => {
      if (!nodesMap.has(asset.id)) {
        nodesMap.set(asset.id, { 
          ...asset, 
          id: asset.id, 
          label: asset.name,
          isHighlighted: searchTerm.length >= 2 && asset.name.toLowerCase().includes(searchTerm.toLowerCase())
        })
      }
    }

    const addLink = (source: number, target: number, type: string, category: 'network' | 'relationship', label: string) => {
      const key = `${Math.min(source, target)}-${Math.max(source, target)}-${type}`
      if (!linksMap.has(key)) {
        linksMap.set(key, { source, target, type, category, label })
      }
    }

    const traverse = (currentNodeIds: number[], currentDepth: number) => {
      if (currentDepth > depth) return
      
      const nextNodeIds: number[] = []
      
      // Process Connections (Network)
      connections?.forEach((conn: any) => {
        const srcId = conn.src_device_id
        const dstId = conn.dst_device_id
        
        if (currentNodeIds.includes(srcId) || currentNodeIds.includes(dstId)) {
          const src = assets.find((a: any) => a.id === srcId)
          const dst = assets.find((a: any) => a.id === dstId)
          
          if (src && dst) {
            addNode(src); addNode(dst)
            addLink(srcId, dstId, conn.connection_type, 'network', conn.connection_type)
            
            if (currentNodeIds.includes(srcId) && !processedNodes.has(dstId)) nextNodeIds.push(dstId)
            if (currentNodeIds.includes(dstId) && !processedNodes.has(srcId)) nextNodeIds.push(srcId)
          }
        }
      })

      // Process Relationships
      relationships?.forEach((rel: any) => {
        const srcId = rel.source_device_id
        const dstId = rel.target_device_id
        
        if (currentNodeIds.includes(srcId) || currentNodeIds.includes(dstId)) {
          const src = assets.find((a: any) => a.id === srcId)
          const dst = assets.find((a: any) => a.id === dstId)
          
          if (src && dst) {
            addNode(src); addNode(dst)
            addLink(srcId, dstId, rel.relationship_type, 'relationship', rel.relationship_type)
            
            if (currentNodeIds.includes(srcId) && !processedNodes.has(dstId)) nextNodeIds.push(dstId)
            if (currentNodeIds.includes(dstId) && !processedNodes.has(srcId)) nextNodeIds.push(srcId)
          }
        }
      })
      
      currentNodeIds.forEach(id => processedNodes.add(id))
      const uniqueNext = Array.from(new Set(nextNodeIds)).filter(id => !processedNodes.has(id))
      if (uniqueNext.length > 0) traverse(uniqueNext, currentDepth + 1)
    }

    rootAssets.forEach((a: any) => addNode(a))
    traverse(rootAssets.map((a: any) => a.id), 1)

    return {
      nodes: Array.from(nodesMap.values()),
      links: Array.from(linksMap.values())
    }
  }, [assets, connections, relationships, selectedSystems, selectedAssetIds, depth, searchTerm, hasFilter])

  const typeColors: any = {
    Physical: '#10b981', // emerald-500
    Virtual: '#3b82f6',  // blue-500
    Storage: '#f59e0b',  // amber-500
    Switch: '#f43f5e',   // rose-500
    Firewall: '#f97316', // orange-500
    'Load Balancer': '#8b5cf6' // violet-500
  }

  const [assetSearch, setAssetSearch] = useState('')

  const filteredAssetsForSelection = useMemo(() => {
    return assets.filter((a: any) => 
      !a.is_deleted && 
      (assetSearch.length === 0 || a.name.toLowerCase().includes(assetSearch.toLowerCase()))
    )
  }, [assets, assetSearch])

  return (
    <div className="h-full flex flex-col relative bg-[#020617]">
      {/* Controls Overlay */}
      <div className="absolute top-6 left-6 z-10 w-80 space-y-4 pointer-events-none">
         <div className="glass-panel p-6 rounded-lg border border-white/10 shadow-2xl pointer-events-auto space-y-6 bg-slate-950/80 backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-white/5 pb-4">
               <div className="flex items-center gap-3">
                  <Share2 size={18} className="text-blue-400" />
                  <h3 className="text-xs font-black uppercase tracking-widest text-white">Vector Intelligence</h3>
               </div>
               <div className="px-2 py-0.5 rounded-lg bg-blue-600/20 border border-blue-500/30 text-[8px] font-black text-blue-400 uppercase tracking-widest">
                 {hasFilter ? `${graphData.nodes.length} NODES` : 'NO FILTER'}
               </div>
            </div>

            <div className="space-y-5">
               <div className="relative">
                  <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
                  <input 
                    value={searchTerm} 
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="FOCUS HIGHLIGHT (NAME/IP)..." 
                    className="w-full bg-black/40 border border-white/5 rounded-lg pl-9 pr-4 py-2 text-[9px] font-black text-white outline-none focus:border-blue-500/50 uppercase tracking-widest transition-all" 
                  />
               </div>

               <div>
                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2">System Aggregation</label>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto custom-scrollbar pr-1">
                     {systemsList.map((sys: string) => (
                        <button
                           key={sys}
                           onClick={() => setSelectedSystems(prev => prev.includes(sys) ? prev.filter(s => s !== sys) : [...prev, sys])}
                           className={`px-2 py-1 rounded-lg text-[8px] font-bold uppercase transition-all border ${selectedSystems.includes(sys) ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20' : 'bg-white/5 border-white/5 text-slate-500 hover:border-white/20'}`}
                        >
                           {sys}
                        </button>
                     ))}
                  </div>
               </div>

               <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Asset Selection</label>
                    {selectedAssetIds.length > 0 && (
                      <button onClick={() => setSelectedAssetIds([])} className="text-[8px] font-black text-rose-500 uppercase hover:text-rose-400">Clear ({selectedAssetIds.length})</button>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="relative">
                      <Filter size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600" />
                      <input 
                        value={assetSearch} 
                        onChange={e => setAssetSearch(e.target.value)}
                        placeholder="FILTER ASSETS..." 
                        className="w-full bg-black/60 border border-white/5 rounded-lg pl-7 pr-3 py-1.5 text-[8px] font-bold text-slate-400 outline-none focus:border-blue-500/30 uppercase"
                      />
                    </div>
                    <div className="max-h-32 overflow-y-auto custom-scrollbar bg-black/40 border border-white/5 rounded-lg p-1.5 space-y-0.5">
                      {filteredAssetsForSelection.map((a: any) => (
                        <button
                          key={a.id}
                          onClick={() => setSelectedAssetIds(prev => prev.includes(a.id) ? prev.filter(id => id !== a.id) : [...prev, a.id])}
                          className={`w-full text-left px-2 py-1 rounded-lg text-[8px] font-bold uppercase transition-all ${selectedAssetIds.includes(a.id) ? 'bg-indigo-600/30 text-indigo-400 border border-indigo-500/30 shadow-lg shadow-indigo-500/10' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}
                        >
                          {a.name}
                        </button>
                      ))}
                      {filteredAssetsForSelection.length === 0 && (
                        <WorkspaceEmptyState title="No matching assets" description="Adjust your filters or add new assets to the matrix." />
                      )}
                    </div>
                  </div>
               </div>

               <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Propagation Depth</label>
                    <span className="text-[10px] font-black text-blue-400">{depth}x</span>
                  </div>
                  <input 
                    type="range" min="1" max="4" step="1" 
                    value={depth} onChange={e => setDepth(Number(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
               </div>
            </div>
         </div>

         {selectedNode && (
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="glass-panel p-6 rounded-lg border border-blue-500/30 shadow-2xl pointer-events-auto space-y-4 bg-slate-900/95 backdrop-blur-xl">
               <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                     <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                        <Box size={24} />
                     </div>
                     <div>
                        <p className="text-[8px] font-black text-blue-400 uppercase tracking-[0.2em] mb-0.5">{selectedNode.system}</p>
                        <h4 className="text-sm font-black text-white uppercase tracking-tight leading-none">{selectedNode.name}</h4>
                     </div>
                  </div>
                  <button onClick={() => setSelectedNode(null)} className="text-slate-500 hover:text-white"><X size={14}/></button>
               </div>
               <div className="grid grid-cols-2 gap-3">
                  <div className="p-2 rounded-lg bg-black/40 border border-white/5">
                     <p className="text-[7px] font-bold text-slate-500 uppercase mb-1">Status</p>
                     <p className="text-[9px] font-black text-emerald-400 uppercase">{selectedNode.status}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-black/40 border border-white/5">
                     <p className="text-[7px] font-bold text-slate-500 uppercase mb-1">Type</p>
                     <p className="text-[9px] font-black text-indigo-400 uppercase">{selectedNode.type}</p>
                  </div>
               </div>
               <div className="pt-2">
                  <button className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[9px] font-black uppercase tracking-widest transition-all shadow-lg shadow-blue-500/20">Vector Inspection</button>
               </div>
            </motion.div>
         )}
      </div>

      <div className="flex-1 w-full h-full relative">
         {!hasFilter ? (
           <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-700 bg-slate-950/50 backdrop-blur-sm z-0">
              <Globe size={64} className="mb-6 opacity-10 animate-pulse" />
              <p className="text-[11px] font-black uppercase tracking-[0.5em] opacity-40">Awaiting Intelligence Filter Deployment</p>
              <p className="text-[8px] font-bold uppercase tracking-widest mt-2 opacity-20">Select Systems or Assets to Begin Mapping</p>
           </div>
         ) : (
           <ForceGraph2D
             ref={fgRef}
             graphData={graphData}
             nodeLabel="label"
             nodeRelSize={5}
             nodeColor={n => typeColors[n.type] || '#64748b'}
             linkColor={l => l.category === 'network' ? 'rgba(52, 211, 153, 0.2)' : 'rgba(129, 140, 248, 0.2)'}
             linkWidth={l => l.category === 'network' ? 1.5 : 1}
             linkDirectionalArrowLength={4}
             linkDirectionalArrowRelPos={1}
             linkCurvature={0.2}
             linkDirectionalParticles={l => l.category === 'network' ? 4 : 0}
             linkDirectionalParticleSpeed={0.01}
             linkDirectionalParticleWidth={2}
             nodeCanvasObject={(node: any, ctx, globalScale) => {
               const label = node.label.toUpperCase()
               const fontSize = 11/globalScale
               ctx.font = `900 ${fontSize}px Inter, sans-serif`
               const textWidth = ctx.measureText(label).width
               const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.4) as [number, number]

               // Draw glow for highlighted
               if (node.isHighlighted) {
                 ctx.beginPath()
                 ctx.arc(node.x, node.y, 8, 0, 2 * Math.PI, false)
                 ctx.fillStyle = 'rgba(59, 130, 246, 0.3)'
                 ctx.fill()
                 ctx.shadowBlur = 15
                 ctx.shadowColor = '#3b82f6'
               }

               // Draw node point
               ctx.beginPath()
               ctx.arc(node.x, node.y, 4, 0, 2 * Math.PI, false)
               ctx.fillStyle = typeColors[node.type] || '#64748b'
               ctx.fill()
               ctx.shadowBlur = 0 // reset

               // Label background
               ctx.fillStyle = 'rgba(2, 6, 23, 0.9)'
               ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y + 8, bckgDimensions[0], bckgDimensions[1])

               // Label text
               ctx.textAlign = 'center'
               ctx.textBaseline = 'middle'
               ctx.fillStyle = node.isHighlighted ? '#60a5fa' : '#cbd5e1'
               ctx.fillText(label, node.x, node.y + 8 + bckgDimensions[1]/2)
             }}
             linkCanvasObjectMode={() => 'after'}
             linkCanvasObject={(link: any, ctx, globalScale) => {
                const MAX_FONT_SIZE = 6;
                const LABEL_NODE_MARGIN = globalScale * 2;
                const start = link.source;
                const end = link.target;
                if (typeof start !== 'object' || typeof end !== 'object') return;

                const text = link.label.toUpperCase();
                const fontSize = Math.min(MAX_FONT_SIZE, 8 / globalScale);
                ctx.font = `900 ${fontSize}px Inter, sans-serif`;
                const textWidth = ctx.measureText(text).width;
                const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2) as [number, number];

                const relLink = { x: end.x - start.x, y: end.y - start.y };
                const textPos = { x: start.x + relLink.x * 0.5, y: start.y + relLink.y * 0.5 };

                ctx.save();
                ctx.translate(textPos.x, textPos.y);
                ctx.rotate(Math.atan2(relLink.y, relLink.x));
                
                ctx.fillStyle = 'rgba(2, 6, 23, 0.8)';
                ctx.fillRect(-bckgDimensions[0] / 2, -bckgDimensions[1] / 2, bckgDimensions[0], bckgDimensions[1]);

                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = link.category === 'network' ? '#34d399' : '#818cf8';
                ctx.fillText(text, 0, 0);
                ctx.restore();
             }}
             onNodeClick={node => setSelectedNode(node)}
             backgroundColor="#020617"
             d3AlphaDecay={0.02}
             d3VelocityDecay={0.3}
           />
         )}
      </div>

      {/* Legend & Controls Overlay */}
      <div className="absolute bottom-6 left-6 z-10 space-y-2 pointer-events-none">
         <AnimatePresence>
           {showLegend && (
             <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="glass-panel p-4 rounded-lg border border-white/10 shadow-2xl pointer-events-auto bg-slate-950/80 backdrop-blur-xl space-y-4">
                <div className="flex items-center justify-between border-b border-white/5 pb-2 mb-2">
                   <span className="text-[9px] font-black text-white uppercase tracking-widest">Vector Legend</span>
                   <button onClick={() => setShowLegend(false)} className="text-slate-500 hover:text-white"><X size={10}/></button>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                   {Object.entries(typeColors).map(([type, color]: any) => (
                     <div key={type} className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                        <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{type}</span>
                     </div>
                   ))}
                </div>
                <div className="h-px bg-white/5" />
                <div className="flex flex-col gap-2">
                   <div className="flex items-center gap-2">
                      <div className="w-4 h-0.5 bg-emerald-500/40" />
                      <span className="text-[8px] font-bold text-emerald-400 uppercase tracking-widest">Network Fabric</span>
                   </div>
                   <div className="flex items-center gap-2">
                      <div className="w-4 h-0.5 bg-indigo-500/40" />
                      <span className="text-[8px] font-bold text-indigo-400 uppercase tracking-widest">Dependency Vector</span>
                   </div>
                </div>
             </motion.div>
           )}
         </AnimatePresence>
         {!showLegend && (
           <button onClick={() => setShowLegend(true)} className="glass-panel p-2 rounded-lg border border-white/10 shadow-2xl pointer-events-auto bg-slate-950/80 backdrop-blur-xl text-slate-500 hover:text-blue-400">
              <Layers size={16} />
           </button>
         )}
      </div>

      <div className="absolute bottom-6 right-6 flex flex-col gap-2 z-10 pointer-events-none">
         <div className="glass-panel p-2 rounded-lg border border-white/10 flex flex-col gap-1 pointer-events-auto bg-slate-950/80 backdrop-blur-xl">
            <button onClick={() => fgRef.current?.zoom(fgRef.current?.zoom() * 1.2, 400)} className="p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-lg transition-all" title="Zoom In"><ZoomIn size={16}/></button>
            <button onClick={() => fgRef.current?.zoom(fgRef.current?.zoom() / 1.2, 400)} className="p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-lg transition-all" title="Zoom Out"><ZoomOut size={16}/></button>
            <div className="h-px bg-white/5 mx-1" />
            <button onClick={() => fgRef.current?.zoomToFit(400, 50)} className="p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-lg transition-all" title="Reset View"><Maximize2 size={16}/></button>
         </div>
      </div>
    </div>
  )
}
