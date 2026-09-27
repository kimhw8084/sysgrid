import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import ReactFlow, { 
  addEdge, Background, Controls, Panel, useNodesState, useEdgesState, Handle, Position, MarkerType, 
  Connection, ReactFlowProvider, useReactFlow, BaseEdge, EdgeLabelRenderer, getSmoothStepPath, 
  getBezierPath, MiniMap, Node, Edge, applyNodeChanges, applyEdgeChanges, reconnectEdge, 
  ConnectionMode, NodeChange, EdgeChange, useViewport
} from 'reactflow'
import 'reactflow/dist/style.css'
import { AgGridReact } from 'ag-grid-react'
import { 
  Save, Plus, Server, Search, Database, Globe, Layout, Edit3, Network, ChevronLeft, 
  Settings2, Table as TableIcon, Activity, AlertTriangle, CheckCircle2, Clock, 
  ExternalLink, Filter, ArrowRight, Zap, Info, Maximize2, Minimize2, X, Share2, 
  Cpu, Trash2, MousePointer2, Workflow, Target, Layers, ArrowDownUp, FileText,
  AlertOctagon, Compass, Box, Terminal, ListTodo, ChevronRight, ChevronDown,
  Diamond, StickyNote, GitMerge, MoreHorizontal, Settings, RefreshCw, HelpCircle,
  ShieldCheck, RotateCcw, RotateCw, Eye, EyeOff, Printer, History,
  Route, Link2
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import dagre from 'dagre'
import { apiFetch } from '../api/apiClient'
import { parseAppDate, formatAppDate } from '../utils/dateUtils'
import { StatusPill } from './shared/StatusPill'
import { StyledSelect } from './shared/StyledSelect'
import { ConfirmationModal } from './shared/ConfirmationModal'

// Suppress ResizeObserver loop errors which are common in ReactFlow/ForceGraph during layout shifts
if (typeof window !== 'undefined') {
  const resizeObserverErr = window.onerror;
  window.onerror = (message, source, lineno, colno, error) => {
    if (typeof message === 'string' && message.includes('ResizeObserver loop completed')) {
      return true;
    }
    if (resizeObserverErr) {
      return resizeObserverErr(message, source, lineno, colno, error);
    }
    return false;
  };
}

const PROTOCOLS = ['Https', 'Http', 'Ssh', 'Ftp', 'Sftp', 'Samba', 'NFS', 'gRPC', 'AMQP', 'MQTT', 'SQL', 'NoSQL', 'Custom']
const FLOW_TYPES = [
  { id: 'DATA', label: 'Data Flow', color: '#3b82f6', dash: false },
  { id: 'AUTH', label: 'Auth / Security', color: '#8b5cf6', dash: false },
  { id: 'SYNC', label: 'Replication', color: '#10b981', dash: [5, 5] },
  { id: 'MGMT', label: 'Control Plane', color: '#f59e0b', dash: [2, 2] },
  { id: 'CRITICAL', label: 'Heartbeat', color: '#ef4444', dash: false, weight: 4 },
]
const ARCH_STATUSES = ['Up to date', 'Deprecated', 'Planned', 'In Review']
const ARCH_CATEGORIES = ['System', 'Service', 'Application', 'Network', 'Security']
const ARCH_COLOR_SEMANTICS = {
  structure: '#38bdf8',
  risk: '#f43f5e',
  governance: '#f59e0b',
  external: '#818cf8',
  trace: '#facc15',
}

const DeviceNode = ({ data, selected }: any) => {
  const isImpacted = data.isImpacted && data.dependencyRiskEnabled;
  const services = data.logical_services || [];
  const visits = data.transactionVisits || [];
  const overlay = data.operationalStatus || {};
  const isDimmed = data.isDimmed;
  return (
    <div className={`glass-panel min-w-[320px] rounded-lg border transition-all duration-300 overflow-hidden relative shadow-[0_22px_60px_rgba(2,6,23,0.55)] ${selected ? 'border-sky-300 bg-sky-400/10 ring-1 ring-sky-300/35' : isImpacted ? 'border-rose-400/70 bg-rose-500/10 ring-1 ring-rose-400/20' : 'border-white/10 bg-slate-950/75'} ${isDimmed ? 'opacity-20 saturate-50 scale-[0.98]' : ''}`}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_42%),linear-gradient(180deg,rgba(15,23,42,0.18),rgba(2,6,23,0.78))]" />
      {visits.length > 0 && (
        <div className="absolute -top-3 -left-3 flex -space-x-1 z-50">
          {visits.map((v: number) => <div key={v} className="w-6 h-6 rounded-lg bg-amber-500 border-2 border-slate-950 flex items-center justify-center text-[10px] font-bold text-white shadow-xl animate-bounce" style={{ animationDelay: `${v * 0.1}s` }}>{v}</div>)}
        </div>
      )}
      {(overlay.incidentCount > 0 || overlay.maintenanceCount > 0 || overlay.monitorCount > 0) && (
        <div className="absolute -top-3 right-3 flex gap-1 z-50">
          {overlay.incidentCount > 0 && <div className="px-2 py-1 rounded-lg bg-rose-500 text-white text-[8px] font-bold uppercase shadow-xl">{overlay.incidentCount} Incident</div>}
          {overlay.maintenanceCount > 0 && <div className="px-2 py-1 rounded-lg bg-amber-500 text-slate-950 text-[8px] font-bold uppercase shadow-xl">{overlay.maintenanceCount} Maintenance</div>}
          {overlay.monitorCount > 0 && <div className="px-2 py-1 rounded-lg bg-blue-500 text-white text-[8px] font-bold uppercase shadow-xl">{overlay.monitorCount} Monitor</div>}
        </div>
      )}
      <div className={`relative px-5 py-4 border-b border-white/5 flex items-center justify-between ${isImpacted ? 'bg-rose-500/10' : 'bg-white/[0.04]'}`}>
         <div className="flex items-center space-x-3 min-w-0"><div className={`p-2.5 rounded-lg ${isImpacted ? 'bg-rose-500 text-white' : 'bg-sky-400/15 text-sky-300'} border border-current/20 shadow-inner`}>{data.type === 'Switch' ? <Network size={16}/> : <Server size={16}/>}</div><div className="min-w-0"><p className="text-[14px] font-black uppercase text-white tracking-[0.08em] leading-none truncate max-w-[190px]">{data.name}</p><p className="text-[8px] font-bold text-slate-400 uppercase mt-2 tracking-[0.35em]">{data.ip_address}</p></div></div>
         <div className="text-right">
           <p className="text-[7px] font-bold uppercase tracking-[0.35em] text-slate-500">Structure</p>
           <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-sky-300">{data.system || data.environment || 'Core'}</p>
         </div>
      </div>
      <div className="relative p-5 space-y-4">
         <div className="flex items-center justify-between">
            <p className="text-[8px] font-bold uppercase tracking-[0.35em] text-slate-500">Attached Surfaces</p>
            <p className="text-[8px] font-bold uppercase tracking-[0.25em] text-slate-400">{services.length} mapped</p>
         </div>
         <div className="space-y-2">
            <div className="relative flex items-center justify-between px-3 py-2.5 rounded-lg bg-white/[0.04] border border-dashed border-white/15 group hover:border-sky-400/40">
               <Handle type="target" position={Position.Left} id="unidentified-target" className="!left-[-15px] w-2 h-2 !bg-blue-400 border-none !opacity-0 group-hover:!opacity-100" />
               <div className="flex items-center space-x-2 truncate"><HelpCircle size={10} className="text-slate-400"/><span className="text-[9px] font-bold text-slate-300 uppercase tracking-[0.18em] truncate">Unidentified Interface</span></div>
               <Handle type="source" position={Position.Right} id="unidentified-source" className="!right-[-15px] w-2 h-2 !bg-blue-400 border-none !opacity-0 group-hover:!opacity-100" />
            </div>
            {services.map((s: any) => (
               <div key={s.id} className="relative flex items-center justify-between px-3 py-2.5 rounded-lg bg-emerald-500/[0.08] border border-emerald-400/15 group hover:border-emerald-400/35">
                  <Handle type="target" position={Position.Left} id={`svc-target-${s.id}`} className="!left-[-15px] w-2 h-2 !bg-emerald-500 border-none !opacity-0 group-hover:!opacity-100" />
                  <div className="flex items-center space-x-2 truncate"><Database size={10} className="text-emerald-300"/><span className="text-[9px] font-bold text-emerald-200 uppercase tracking-[0.18em] truncate">{s.name}</span></div>
                  <Handle type="source" position={Position.Right} id={`svc-source-${s.id}`} className="!right-[-15px] w-2 h-2 !bg-emerald-500 border-none !opacity-0 group-hover:!opacity-100" />
               </div>
            ))}
         </div>
      </div>
    </div>
  )
}

const ServiceNode = ({ data, selected }: any) => (<div className={`glass-panel px-5 py-4 rounded-lg border transition-all duration-300 flex items-center space-x-3 w-full shadow-[0_18px_45px_rgba(2,6,23,0.4)] ${selected ? 'border-emerald-300 bg-emerald-500/10 ring-1 ring-emerald-300/30' : 'border-emerald-400/15 bg-slate-950/70'} ${data.isDimmed ? 'opacity-20 saturate-50 scale-[0.98]' : ''}`}><div className="p-2.5 bg-emerald-400/15 rounded-lg text-emerald-300 border border-emerald-400/20"><Database size={16}/></div><div className="flex-1 min-w-0"><p className="text-[12px] font-black uppercase text-emerald-200 truncate tracking-[0.14em]">{data.name}</p><p className="text-[7px] font-bold uppercase tracking-[0.35em] text-emerald-400/80 mt-1">Service Surface</p></div><Handle type="target" position={Position.Left} className="w-2 h-2 bg-emerald-400 border-none !left-[-4px]" /><Handle type="source" position={Position.Right} className="w-2 h-2 bg-emerald-400 border-none !right-[-4px]" /></div>)
const ExternalNode = ({ data, selected }: any) => (<div className={`glass-panel min-w-[280px] rounded-lg border transition-all duration-300 p-6 border-dashed shadow-[0_18px_50px_rgba(49,46,129,0.22)] ${selected ? 'border-indigo-300 bg-indigo-500/12 ring-1 ring-indigo-300/30' : 'border-indigo-300/20 bg-slate-950/60'} ${data.isDimmed ? 'opacity-20 saturate-50 scale-[0.98]' : ''}`}><div className="absolute inset-0 rounded-lg bg-[radial-gradient(circle_at_top_left,rgba(129,140,248,0.14),transparent_40%)]" /><div className="relative flex items-center space-x-4"><div className="p-3 bg-indigo-400/15 rounded-lg text-indigo-300 border border-indigo-300/20"><Globe size={20}/></div><div className="min-w-0"><p className="text-[13px] font-black uppercase text-indigo-100 truncate tracking-[0.12em]">{data.name}</p>{data.environment && <p className="text-[8px] font-bold text-indigo-300/75 uppercase mt-2 tracking-[0.32em]">{data.environment}</p>}</div></div><Handle type="target" position={Position.Left} className="w-2 h-2 bg-indigo-400 border-none !left-[-4px]" /><Handle type="source" position={Position.Right} className="w-2 h-2 bg-indigo-400 border-none !right-[-4px]" /></div>)
const ConditionNode = ({ data, selected }: any) => (<div className={`w-24 h-24 rotate-45 border flex items-center justify-center transition-all shadow-[0_14px_30px_rgba(245,158,11,0.2)] ${selected ? 'border-amber-300 bg-amber-400/20 ring-1 ring-amber-300/25' : 'border-amber-400/40 bg-slate-950/75'}`}><div className="-rotate-45 flex flex-col items-center px-1"><Diamond size={16} className="text-amber-300 mb-2"/><span className="text-[8px] font-black uppercase tracking-[0.22em] text-white text-center">{data.label || 'IF'}</span></div><Handle type="target" position={Position.Left} className="w-2 h-2 bg-amber-400 border-none !left-[-1px]" /><Handle type="source" position={Position.Right} className="w-2 h-2 bg-amber-400 border-none !right-[-1px]" /></div>)
const NoteNode = ({ data, selected }: any) => (<div className={`glass-panel p-5 min-w-[220px] rounded-lg border transition-all duration-300 shadow-[0_14px_38px_rgba(30,41,59,0.35)] ${selected ? 'border-sky-300 bg-sky-500/10 ring-1 ring-sky-300/30' : 'border-white/10 bg-slate-950/70'}`}><div className="flex items-center gap-2 text-sky-300 mb-3"><StickyNote size={12}/><span className="text-[8px] font-bold uppercase tracking-[0.3em]">Operator Note</span></div><p className="text-[11px] text-slate-200 font-bold leading-relaxed">{data.label}</p></div>)

const LabeledEdge = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style = {}, markerEnd, data, selected, source, target }: any) => {
  const { getEdges } = useReactFlow();
  const allEdges = getEdges();
  const sameSourceTargetEdges = allEdges.filter(e => e.source === source && e.target === target);
  const edgeIndex = sameSourceTargetEdges.findIndex(e => e.id === id);
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 20, offset: 20 + (edgeIndex * 15) });
  const currentType = FLOW_TYPES.find(t => t.id === (data?.type || 'DATA')) || FLOW_TYPES[0];
  const isTraceActive = data?.isTraceActive;
  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={{ ...style, stroke: isTraceActive ? ARCH_COLOR_SEMANTICS.trace : (data?.isImpacted ? ARCH_COLOR_SEMANTICS.risk : (data?.color || currentType.color)), strokeWidth: selected || isTraceActive ? 4.5 : (data?.isImpacted ? 3.2 : 2.2), strokeDasharray: isTraceActive ? '6 6' : (Array.isArray(currentType.dash) ? currentType.dash.join(' ') : 'none'), opacity: data?.isDimmed ? 0.12 : (selected || data?.isImpacted || isTraceActive ? 1 : 0.72), filter: isTraceActive ? 'drop-shadow(0 0 10px rgba(250,204,21,0.35))' : 'drop-shadow(0 0 8px rgba(15,23,42,0.35))', transition: 'stroke 0.3s' }} />
      <EdgeLabelRenderer><div style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all', zIndex: 1002 }} className="nodrag nopan"><motion.button type="button" aria-label={`Select edge ${data?.label || currentType.label}`} onClick={(event) => { event.stopPropagation(); data?.onSelect?.(id) }} whileHover={{ scale: 1.05 }} className={`px-3 py-1.5 rounded-full border transition-all flex items-center space-x-2 shadow-xl ${selected ? 'bg-slate-900 border-white/80' : 'bg-slate-950/95 border-white/10'} ${isTraceActive ? 'border-amber-400 ring-1 ring-amber-400/20' : ''}`}><div className={`w-1.5 h-1.5 rounded-full ${isTraceActive ? 'bg-amber-400' : ''}`} style={{ backgroundColor: data?.color || currentType.color }}/><span className={`text-[8px] font-black uppercase tracking-[0.22em] ${isTraceActive ? 'text-amber-300' : 'text-white'}`}>{data?.label || currentType.label}</span></motion.button></div></EdgeLabelRenderer>
    </>
  );
};

const nodeTypes = { device: DeviceNode, external: ExternalNode, service: ServiceNode, condition: ConditionNode, note: NoteNode };
const edgeTypes = { labeled: LabeledEdge };

const getFlowMetadata = (flow: any) => flow?.metadata || {}
const getFlowMeta = (flow: any, key: string) => getFlowMetadata(flow)?.[key]
const parseMetaDate = (flow: any, key: string) => {
  const raw = getFlowMeta(flow, key)
  return parseAppDate(raw)
}
const buildArchitectureInsights = (flow: any) => {
  const metadata = getFlowMetadata(flow)
  const nodes = flow?.nodes || []
  const edges = flow?.edges || []
  const lastReviewedAt = parseMetaDate(flow, 'last_reviewed_at')
  const staleDays = lastReviewedAt ? Math.floor((Date.now() - lastReviewedAt.getTime()) / 86_400_000) : null
  const isStale = staleDays === null || staleDays > 90
  const warnings = [
    !metadata.owner_team ? 'Owner team missing' : null,
    !metadata.business_purpose ? 'Business purpose missing' : null,
    !metadata.runbook_url ? 'Runbook missing' : null,
    edges.length === 0 ? 'No dependency flows mapped' : null,
    isStale ? 'Review overdue' : null,
  ].filter(Boolean) as string[]
  return {
    metadata,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    staleDays,
    isStale,
    warnings,
  }
}

const normalizeIdList = (value: any) => Array.isArray(value) ? value.map((item) => Number(item)).filter((item) => Number.isFinite(item)) : []

const getFlowLinks = (flow: any) => {
  const metadata = getFlowMetadata(flow)
  return {
    knowledge_ids: normalizeIdList(metadata?.links?.knowledge_ids),
    monitoring_ids: normalizeIdList(metadata?.links?.monitoring_ids),
    far_ids: normalizeIdList(metadata?.links?.far_ids),
    vendor_ids: normalizeIdList(metadata?.links?.vendor_ids),
    project_ids: normalizeIdList(metadata?.links?.project_ids),
  }
}

const buildNodeOperationalStatus = (node: any, monitoringItems: any[], incidents: any[], maintenanceWindows: any[]) => {
  const deviceId = node?.type === 'device' ? Number(node?.data?.id) : null
  if (!deviceId) {
    return {
      monitorCount: 0,
      incidentCount: 0,
      maintenanceCount: 0,
      severity: null,
      hasAttention: false,
    }
  }
  const monitorCount = monitoringItems.filter((item: any) => item.device_id === deviceId).length
  const criticalMonitor = monitoringItems.some((item: any) => item.device_id === deviceId && String(item.severity || '').toLowerCase() === 'critical')
  const incidentCount = incidents.filter((item: any) => Array.isArray(item.impacted_device_ids) && item.impacted_device_ids.includes(deviceId) && !['Resolved', 'Prevented'].includes(item.status)).length
  const maintenanceCount = maintenanceWindows.filter((item: any) => item.device_id === deviceId && item.status !== 'Completed').length
  const hasAttention = incidentCount > 0 || maintenanceCount > 0 || criticalMonitor
  return {
    monitorCount,
    incidentCount,
    maintenanceCount,
    severity: incidentCount > 0 ? 'incident' : maintenanceCount > 0 ? 'maintenance' : criticalMonitor ? 'monitoring' : null,
    hasAttention,
  }
}

const buildPathAnalysis = (nodes: any[], edges: any[], selectedNodeId: string | null, selectedEdgeId: string | null) => {
  const upstreamNodeIds = new Set<string>()
  const downstreamNodeIds = new Set<string>()
  const pathEdgeIds = new Set<string>()
  const seedNodeId = selectedNodeId || edges.find((edge: any) => edge.id === selectedEdgeId)?.source || null
  if (!seedNodeId) {
    return { upstreamNodeIds, downstreamNodeIds, pathEdgeIds, focusNodeId: null }
  }

  const walk = (direction: 'upstream' | 'downstream', startId: string, targetNodes: Set<string>) => {
    const queue = [startId]
    const visited = new Set<string>([startId])
    while (queue.length > 0) {
      const currentId = queue.shift()!
      edges.forEach((edge: any) => {
        const nextId = direction === 'downstream'
          ? (edge.source === currentId ? edge.target : null)
          : (edge.target === currentId ? edge.source : null)
        if (!nextId) return
        pathEdgeIds.add(edge.id)
        if (!visited.has(nextId)) {
          visited.add(nextId)
          targetNodes.add(nextId)
          queue.push(nextId)
        }
      })
    }
  }

  walk('upstream', seedNodeId, upstreamNodeIds)
  walk('downstream', seedNodeId, downstreamNodeIds)
  upstreamNodeIds.delete(seedNodeId)
  downstreamNodeIds.delete(seedNodeId)
  return { upstreamNodeIds, downstreamNodeIds, pathEdgeIds, focusNodeId: seedNodeId }
}

const buildVersionDiff = (currentEntry: any, previousEntry?: any) => {
  const current = currentEntry?.snapshot || currentEntry || {}
  const previous = previousEntry?.snapshot || previousEntry || {}
  const currentNodes = current.nodes || []
  const previousNodes = previous.nodes || []
  const currentEdges = current.edges || []
  const previousEdges = previous.edges || []
  const currentMeta = current.metadata || {}
  const previousMeta = previous.metadata || {}
  const currentWarnings = buildArchitectureInsights(current).warnings
  return {
    nodeDelta: currentNodes.length - previousNodes.length,
    edgeDelta: currentEdges.length - previousEdges.length,
    metadataChanged: ['owner_team', 'criticality', 'dependency_tier', 'review_status', 'business_purpose', 'runbook_url']
      .filter((key) => (currentMeta[key] || '') !== (previousMeta[key] || '')),
    warningCount: currentWarnings.length,
  }
}

const CanvasDomainBackdrop = ({ presentationMode }: { presentationMode: boolean }) => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.08),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(129,140,248,0.1),transparent_28%),linear-gradient(180deg,rgba(15,23,42,0.15),rgba(2,6,23,0.82))]" />
    <div className={`absolute top-[16%] left-[14%] h-[72%] w-[19%] rounded-lg border ${presentationMode ? 'border-sky-300/22 bg-sky-400/8' : 'border-sky-400/12 bg-sky-400/[0.04]'} shadow-[0_0_80px_rgba(56,189,248,0.08)]`} />
    <div className={`absolute top-[12%] left-[38%] h-[76%] w-[22%] rounded-lg border ${presentationMode ? 'border-emerald-300/20 bg-emerald-400/8' : 'border-emerald-400/12 bg-emerald-400/[0.035]'} shadow-[0_0_80px_rgba(16,185,129,0.08)]`} />
    <div className={`absolute top-[14%] left-[64%] h-[70%] w-[22%] rounded-lg border ${presentationMode ? 'border-indigo-300/22 bg-indigo-400/8' : 'border-indigo-300/14 bg-indigo-400/[0.04]'} shadow-[0_0_80px_rgba(129,140,248,0.08)]`} />
    <div className="absolute left-[18%] top-[13%] text-[9px] font-black uppercase tracking-[0.42em] text-sky-200/45">Ingress</div>
    <div className="absolute left-[44%] top-[10%] text-[9px] font-black uppercase tracking-[0.42em] text-emerald-200/45">Core Services</div>
    <div className="absolute left-[71%] top-[12%] text-[9px] font-black uppercase tracking-[0.42em] text-indigo-200/45">External</div>
    <div className="absolute right-[7%] bottom-[10%] text-[8px] font-bold uppercase tracking-[0.35em] text-slate-400/35">Operations Overlay</div>
  </div>
)

const FocusEmptyState = ({ focusNodeId, focusEdgeId, presentationMode }: { focusNodeId: string | null, focusEdgeId: string | null, presentationMode: boolean }) => {
  if (focusNodeId || focusEdgeId) return null
  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
      <div className={`max-w-md rounded-lg border px-8 py-7 text-center shadow-[0_30px_80px_rgba(2,6,23,0.55)] ${presentationMode ? 'bg-slate-950/78 border-fuchsia-300/25' : 'bg-slate-950/68 border-white/10 backdrop-blur-xl'}`}>
        <p className="text-[9px] font-black uppercase tracking-[0.45em] text-sky-300/80">Mission Focus</p>
        <h3 className="mt-4 text-2xl font-black uppercase tracking-[0.08em] text-white">Select A Node Or Flow</h3>
        <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.18em] leading-relaxed text-slate-300">Trace blast radius, inspect governance, follow live operational overlays, or open the service-level swimlane builder from a selected path.</p>
      </div>
    </div>
  )
}

// --- Vertical Swimlane Flow Engine (Dynamic Participant Lanes) ---

const ParticipantLaneHeader = ({ lane, onRemove, isPrimary, onAddNode, onMoveLeft, onMoveRight }: any) => (
  <div className="flex flex-col gap-3 pointer-events-auto rounded-lg border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(15,23,42,0.68))] px-4 py-4 shadow-[0_18px_40px_rgba(2,6,23,0.28)]">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <div className="p-2.5 rounded-lg text-white shadow-lg border border-white/10" style={{ backgroundColor: lane.color }}>
          {lane.type === 'service' ? <Database size={14}/> : <Server size={14}/>}
        </div>
        <div>
          <h4 className="text-[13px] font-black uppercase tracking-[0.12em] text-white leading-tight break-words max-w-[180px]">{lane.label}</h4>
          <p className="text-[7px] font-bold text-slate-400 uppercase tracking-[0.35em] mt-1">{lane.subLabel}</p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {!isPrimary && (
          <>
            <button aria-label={`Move ${lane.label} lane left`} onClick={() => onMoveLeft(lane.id)} className="p-1 hover:bg-white/5 text-slate-500 hover:text-white transition-all rounded-lg">
              <ChevronLeft size={14}/>
            </button>
            <button aria-label={`Move ${lane.label} lane right`} onClick={() => onMoveRight(lane.id)} className="p-1 hover:bg-white/5 text-slate-500 hover:text-white transition-all rounded-lg">
              <ChevronRight size={14}/>
            </button>
            <button aria-label={`Remove ${lane.label} lane`} onClick={() => onRemove(lane.id)} className="p-1 hover:bg-rose-500/10 text-slate-700 hover:text-rose-500 transition-all rounded-lg">
              <X size={14}/>
            </button>
          </>
        )}
      </div>
    </div>
    
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label={`Add logic step to ${lane.label}`}
        onClick={(e) => { e.stopPropagation(); onAddNode(lane.id, 'process'); }}
        className="flex-1 py-2 bg-sky-400/10 hover:bg-sky-400/90 text-sky-200 hover:text-slate-950 border border-sky-300/15 rounded-lg text-[7px] font-bold uppercase tracking-[0.28em] transition-all flex items-center justify-center gap-1.5"
      >
        <Plus size={10}/> <span>Logic</span>
      </button>
      <button
        type="button"
        aria-label={`Add condition step to ${lane.label}`}
        onClick={(e) => { e.stopPropagation(); onAddNode(lane.id, 'diamond'); }}
        className="flex-1 py-2 bg-amber-400/10 hover:bg-amber-400/90 text-amber-200 hover:text-slate-950 border border-amber-300/15 rounded-lg text-[7px] font-bold uppercase tracking-[0.28em] transition-all flex items-center justify-center gap-1.5"
      >
        <Diamond size={10}/> <span>Cond</span>
      </button>
    </div>
  </div>
)

const ProcessNode = ({ id, data, selected }: any) => {
  const [isDeleting, setIsDeleting] = useState(false)
  const laneColor = data.laneColor || '#3b82f6'

  return (
    <div className={`glass-panel w-[280px] rounded-lg border transition-all duration-300 shadow-[0_20px_55px_rgba(2,6,23,0.42)] overflow-hidden ${selected ? 'ring-2 ring-sky-300/20 scale-[1.01]' : ''}`} style={{ borderColor: `${laneColor}45`, backgroundColor: '#0f172a' }}>
      <div className="flex items-center justify-between px-4 py-3 bg-white/[0.03] border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg text-white shadow-md border border-white/10" style={{ backgroundColor: laneColor }}>
            <Activity size={10}/>
          </div>
          <input 
            value={data.label || ''} 
            onChange={e => data.onChange(id, { label: e.target.value })}
            className="bg-transparent border-none text-[10px] font-black uppercase tracking-[0.14em] text-white outline-none w-36 nodrag"
            placeholder="PROCESS STEP"
          />
        </div>
        {selected && (
          <button 
            onClick={(e) => { 
              e.stopPropagation()
              if (isDeleting) { data.onDelete(id) } else { setIsDeleting(true); setTimeout(() => setIsDeleting(false), 3000) }
            }} 
            className={`p-1 rounded-lg transition-all nodrag ${isDeleting ? 'bg-rose-600 text-white' : 'hover:bg-rose-500/10 text-rose-500'}`}
          >
            <Trash2 size={10}/>
          </button>
        )}
      </div>
      <div className="p-4 space-y-3">
        <textarea 
          value={data.description || ''} 
          onChange={e => data.onChange(id, { description: e.target.value })} 
          className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-[9px] font-bold text-slate-300 uppercase tracking-[0.14em] outline-none focus:border-sky-300/40 resize-none min-h-[58px] transition-all nodrag" 
          placeholder="TECHNICAL EXECUTION..." 
        />
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5">
          <div className="space-y-1">
            <label className="text-[6px] font-bold text-slate-600 uppercase tracking-widest ml-1">Input</label>
            <input value={data.input || ''} onChange={e => data.onChange(id, { input: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-lg px-1.5 py-1 text-[8px] font-bold text-blue-400 outline-none focus:border-blue-500/30 nodrag" placeholder="INPUT"/>
          </div>
          <div className="space-y-1">
            <label className="text-[6px] font-bold text-slate-600 uppercase tracking-widest ml-1 text-right block mr-1">Output</label>
            <input value={data.output || ''} onChange={e => data.outputChange ? data.outputChange(id, e.target.value) : data.onChange(id, { output: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-lg px-1.5 py-1 text-[8px] font-bold text-emerald-400 outline-none focus:border-emerald-500/30 text-right nodrag" placeholder="OUTPUT"/>
          </div>
        </div>
      </div>
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-blue-600 !border-slate-950" />
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-blue-600 !border-slate-950" />
    </div>
  )
}

const DiamondNode = ({ id, data, selected }: any) => {
  const [isDeleting, setIsDeleting] = useState(false)
  const laneColor = data.laneColor || '#f59e0b'

  return (
    <div className="relative group p-4">
      <div className={`w-24 h-24 rotate-45 border-2 flex items-center justify-center transition-all duration-300 shadow-xl relative z-10 ${selected ? 'ring-2 ring-amber-500/20' : ''}`} style={{ borderColor: `${laneColor}60`, backgroundColor: '#0f172a' }}>
        <div className="-rotate-45 flex flex-col items-center px-1 text-center">
          <input 
            value={data.label || ''} 
            onChange={e => data.onChange(id, { label: e.target.value })} 
            className="bg-transparent border-none text-[8px] font-bold uppercase text-white text-center outline-none w-16 placeholder:text-slate-800 nodrag"
            placeholder="IF"
          />
        </div>
        <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-amber-500 !border-slate-950 !-rotate-45" style={{ top: -4, left: '50%' }} />
        <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-amber-500 !border-slate-950 !-rotate-45" style={{ bottom: -4, left: '50%' }} />
        <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-amber-500 !border-slate-950 !-rotate-45" style={{ left: -4, top: '50%' }} />
        <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-amber-500 !border-slate-950 !-rotate-45" style={{ right: -4, top: '50%' }} />
      </div>
      {selected && (
        <button 
          onClick={(e) => { 
            e.stopPropagation()
            if (isDeleting) { data.onDelete(id) } else { setIsDeleting(true); setTimeout(() => setIsDeleting(false), 3000) }
          }} 
          className={`absolute top-1 right-1 p-1 rounded-lg transition-all z-20 nodrag ${isDeleting ? 'bg-rose-600 text-white' : 'bg-slate-900/80 hover:bg-rose-500/10 text-rose-500'}`}
        >
          <Trash2 size={10}/>
        </button>
      )}
    </div>
  )
}

const LogicLinkEdge = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style = {}, markerEnd, data, selected }: any) => {
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={{ ...style, stroke: selected ? '#3b82f6' : '#334155', strokeWidth: selected ? 3 : 1.5 }} />
      <EdgeLabelRenderer>
        <div style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all' }} className="nodrag nopan">
          <input 
            value={data?.label || ''} 
            onChange={e => data.onLabelChange(id, e.target.value)} 
            className={`bg-[#0f172a] border border-white/10 rounded-lg px-2 py-0.5 text-[8px] font-bold text-white uppercase outline-none focus:border-blue-500 shadow-2xl transition-all nodrag ${selected ? 'scale-110 border-blue-500 bg-blue-600/10' : ''}`} 
            placeholder="FLOW" 
          />
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

const ServiceLevelFlowInner = ({ edge, sourceNode, targetNode, onClose, onSave }: any) => {
  const { setViewport, fitView, getViewport } = useReactFlow()
  if (!edge || !sourceNode || !targetNode) return null

  const logicManifest = useMemo(() => edge?.data?.logic_json || {}, [edge])
  const [internalNodes, setInternalNodes] = useNodesState([])
  const [internalEdges, setInternalEdges] = useEdgesState([])
  const [lanes, setLanes] = useState<any[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [showExitPrompt, setShowExitPrompt] = useState(false)
  const [historyStack, setHistoryStack] = useState<any[]>([])
  const historyIndexRef = useRef(-1)

  const recordSnapshot = useCallback((nextNodes: any[], nextEdges: any[], nextLanes: any[]) => {
    setHistoryStack((current) => {
      const base = current.slice(0, historyIndexRef.current + 1)
      const snapshot = {
        nodes: JSON.parse(JSON.stringify(nextNodes)),
        edges: JSON.parse(JSON.stringify(nextEdges)),
        lanes: JSON.parse(JSON.stringify(nextLanes)),
      }
      const updated = [...base, snapshot].slice(-40)
      historyIndexRef.current = updated.length - 1
      return updated
    })
  }, [])

  const restoreSnapshot = useCallback((snapshot: any) => {
    setInternalNodes((snapshot.nodes || []).map((n: any) => ({
      ...n,
      data: {
        ...n.data,
        onChange: (id: string, updates: any) => {
          setIsDirty(true)
          setInternalNodes((nds) => nds.map((node) => node.id === id ? { ...node, data: { ...node.data, ...updates } } : node))
        },
        onDelete: (id: string) => {
          setInternalNodes((nds) => nds.filter((node) => node.id !== id))
          setInternalEdges((eds) => eds.filter((currentEdge) => currentEdge.source !== id && currentEdge.target !== id))
          setIsDirty(true)
        },
      },
    })))
    setInternalEdges((snapshot.edges || []).map((e: any) => ({
      ...e,
      data: {
        ...e.data,
        onLabelChange: (id: string, label: string) => {
          setIsDirty(true)
          setInternalEdges((eds) => eds.map((currentEdge) => currentEdge.id === id ? { ...currentEdge, data: { ...currentEdge.data, label } } : currentEdge))
        },
      },
    })))
    setLanes(snapshot.lanes || [])
  }, [setInternalEdges, setInternalNodes])

  // Initialize Lanes from logicManifest or default to Source/Target
  useEffect(() => {
    if (logicManifest.lanes && logicManifest.lanes.length > 0) {
      setLanes(logicManifest.lanes)
    } else {
      const initialLanes = [
        { id: 'source-primary', label: sourceNode.data.name, subLabel: 'SOURCE ASSET', color: '#6366f1', type: 'asset', x: 0 },
        { id: 'target-primary', label: targetNode.data.name, subLabel: 'DESTINATION ASSET', color: '#f43f5e', type: 'asset', x: 350 },
      ]
      setLanes(initialLanes)
    }
  }, [logicManifest, sourceNode, targetNode])

  // Initialize Nodes/Edges
  useEffect(() => {
    const flowData = logicManifest.flow || { nodes: [], edges: [] }
    const hydratedNodes = (flowData.nodes || []).map((n: any) => ({
      ...n,
      data: {
        ...n.data,
        onChange: (id: string, updates: any) => {
          setIsDirty(true)
          setInternalNodes(nds => nds.map(node => node.id === id ? { ...node, data: { ...node.data, ...updates } } : node))
        },
        onDelete: (id: string) => { 
          setInternalNodes(nds => nds.filter(node => node.id !== id))
          setInternalEdges(eds => eds.filter(edge => edge.source !== id && edge.target !== id))
          setIsDirty(true)
        }
      }
    }))
    const hydratedEdges = (flowData.edges || []).map((e: any) => ({
      ...e,
      data: {
        ...e.data,
        onLabelChange: (id: string, label: string) => {
          setIsDirty(true)
          setInternalEdges(eds => eds.map(edge => edge.id === id ? { ...edge, data: { ...edge.data, label } } : edge))
        }
      }
    }))
    setInternalNodes(hydratedNodes)
    setInternalEdges(hydratedEdges)
    setIsDirty(false)
    historyIndexRef.current = -1
    recordSnapshot(hydratedNodes, hydratedEdges, logicManifest.lanes && logicManifest.lanes.length > 0 ? logicManifest.lanes : [
      { id: 'source-primary', label: sourceNode.data.name, subLabel: 'SOURCE ASSET', color: '#6366f1', type: 'asset', x: 0 },
      { id: 'target-primary', label: targetNode.data.name, subLabel: 'DESTINATION ASSET', color: '#f43f5e', type: 'asset', x: 350 },
    ])
  }, [logicManifest])

  useEffect(() => {
    const savedViewport = logicManifest.viewport
    const applyViewport = async () => {
      if (savedViewport && typeof savedViewport.zoom === 'number') {
        await setViewport(savedViewport, { duration: 0 })
        return
      }
      if (lanes.length > 0) {
        setTimeout(() => fitView({ duration: 0, padding: 0.2 }), 50)
      }
    }
    void applyViewport()
  }, [logicManifest.viewport, lanes.length, fitView, setViewport])

  const onNodesChangeInternal = useCallback((changes: NodeChange[]) => {
    if (changes.length > 0) setIsDirty(true)
    setInternalNodes((nds) => {
      const nextNodes = applyNodeChanges(changes, nds);
      return nextNodes.map(node => {
        const laneIdx = lanes.findIndex(l => l.id === node.data.laneId);
        if (laneIdx === -1) return node;
        const nodeWidth = node.type === 'logicProcess' ? 300 : 160; // 160 includes padding for Diamond
        const centerX = (laneIdx * 350) + 175 - (nodeWidth / 2);
        if (Math.abs(node.position.x - centerX) > 0.1) {
          return { ...node, position: { ...node.position, x: centerX } };
        }
        return node;
      });
    });
  }, [lanes, setInternalNodes]);

  const onEdgesChangeInternal = useCallback((changes: EdgeChange[]) => {
    if (changes.length > 0) setIsDirty(true)
    setInternalEdges((eds) => applyEdgeChanges(changes, eds));
  }, [setInternalEdges]);

  const onConnect = useCallback((params: Connection) => { 
    const newEdge = { 
      ...params, 
      id: `v-edge-${Date.now()}`, 
      type: 'logicLink', 
      data: { 
        label: '', 
        onLabelChange: (id: string, label: string) => {
          setIsDirty(true)
          setInternalEdges(eds => eds.map(e => e.id === id ? { ...e, data: { ...e.data, label } } : e))
        }
      } 
    } 
    const nextEdges = addEdge(newEdge, internalEdges)
    setInternalEdges(nextEdges) 
    recordSnapshot(internalNodes, nextEdges, lanes)
    setIsDirty(true)
  }, [internalEdges, internalNodes, lanes, recordSnapshot])

  const addNode = (laneId: string, type: 'process' | 'diamond') => {
    const laneIdx = lanes.findIndex(l => l.id === laneId)
    const lane = lanes[laneIdx]
    const nodeWidth = type === 'process' ? 300 : 160
    const centerX = (laneIdx * 350) + 175 - (nodeWidth / 2)
    const laneNodes = internalNodes.filter(n => n.data.laneId === laneId)
    const minY = 350 // Start below header
    const maxY = laneNodes.length > 0 ? Math.max(...laneNodes.map(n => n.position.y)) : minY - 200
    const y = maxY + 200

    const newNode = { 
      id: `v-step-${Date.now()}`, 
      type: type === 'process' ? 'logicProcess' : 'logicDiamond', 
      position: { x: centerX, y }, 
      data: { 
        label: type === 'process' ? 'NEW STEP' : 'IF', 
        laneId,
        laneColor: lane.color,
        description: '',
        input: '', 
        output: '', 
        onChange: (id: string, updates: any) => {
          setIsDirty(true)
          setInternalNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, ...updates } } : n))
        }, 
        onDelete: (id: string) => { 
          setInternalNodes(nds => nds.filter(n => n.id !== id))
          setInternalEdges(eds => eds.filter(e => e.source !== id && e.target !== id))
          setIsDirty(true)
        } 
      } 
    } 
    const nextNodes = [...internalNodes, newNode]
    setInternalNodes(nextNodes) 
    recordSnapshot(nextNodes, internalEdges, lanes)
    setIsDirty(true)
  }

  const addLane = (service: any) => {
    const newLane = {
      id: `lane-${service.id}`,
      label: service.name,
      subLabel: `INTERNAL SERVICE (${service.device_id === sourceNode.data.id ? 'SOURCE' : 'TARGET'})`,
      color: service.device_id === sourceNode.data.id ? '#10b981' : '#f59e0b',
      type: 'service',
      serviceId: service.id
    }
    if (lanes.some(l => l.id === newLane.id)) return
    const nextLanes = [...lanes, newLane]
    setLanes(nextLanes)
    recordSnapshot(internalNodes, internalEdges, nextLanes)
    setIsDirty(true)
  }

  const removeLane = (laneId: string) => {
    const nextLanes = lanes.filter(l => l.id !== laneId)
    const nextNodes = internalNodes.filter(n => n.data.laneId !== laneId)
    const nextEdges = internalEdges.filter(e => {
      const sourceManifestNode = internalNodes.find(n => n.id === e.source)
      const targetManifestNode = internalNodes.find(n => n.id === e.target)
      return sourceManifestNode?.data?.laneId !== laneId && targetManifestNode?.data?.laneId !== laneId
    })
    setLanes(nextLanes)
    setInternalNodes(nextNodes)
    setInternalEdges(nextEdges)
    recordSnapshot(nextNodes, nextEdges, nextLanes)
    setIsDirty(true)
  }

  const moveLane = (laneId: string, direction: 'left' | 'right') => {
    const index = lanes.findIndex((lane) => lane.id === laneId)
    if (index === -1) return
    const targetIndex = direction === 'left' ? index - 1 : index + 1
    if (targetIndex < 1 || targetIndex > lanes.length - 1) return
    const nextLanes = [...lanes]
    const [lane] = nextLanes.splice(index, 1)
    nextLanes.splice(targetIndex, 0, lane)
    const repositionedNodes = internalNodes.map((node: any) => {
      const laneIdx = nextLanes.findIndex((entry) => entry.id === node.data.laneId)
      if (laneIdx === -1) return node
      const nodeWidth = node.type === 'logicProcess' ? 300 : 160
      const centerX = (laneIdx * 350) + 175 - (nodeWidth / 2)
      return { ...node, position: { ...node.position, x: centerX } }
    })
    setLanes(nextLanes)
    setInternalNodes(repositionedNodes)
    recordSnapshot(repositionedNodes, internalEdges, nextLanes)
    setIsDirty(true)
  }

  const canUndo = historyIndexRef.current > 0
  const canRedo = historyIndexRef.current < historyStack.length - 1

  const undo = () => {
    if (!canUndo) return
    const nextIndex = historyIndexRef.current - 1
    historyIndexRef.current = nextIndex
    restoreSnapshot(historyStack[nextIndex])
    setIsDirty(true)
  }

  const redo = () => {
    if (!canRedo) return
    const nextIndex = historyIndexRef.current + 1
    historyIndexRef.current = nextIndex
    restoreSnapshot(historyStack[nextIndex])
    setIsDirty(true)
  }

  const validation = useMemo(() => {
    const incoming = new Map<string, number>()
    const outgoing = new Map<string, number>()
    internalEdges.forEach((currentEdge: any) => {
      outgoing.set(currentEdge.source, (outgoing.get(currentEdge.source) || 0) + 1)
      incoming.set(currentEdge.target, (incoming.get(currentEdge.target) || 0) + 1)
    })
    return {
      orphanSteps: internalNodes.filter((node: any) => (incoming.get(node.id) || 0) === 0 && (outgoing.get(node.id) || 0) === 0).length,
      deadEnds: internalNodes.filter((node: any) => node.type === 'logicProcess' && (outgoing.get(node.id) || 0) === 0).length,
      missingEdgeLabels: internalEdges.filter((currentEdge: any) => !String(currentEdge.data?.label || '').trim()).length,
      missingFailureBranch: internalNodes.filter((node: any) => node.type === 'logicDiamond' && (outgoing.get(node.id) || 0) < 2).length,
    }
  }, [internalEdges, internalNodes])

  const handleSaveFlow = () => {
    const manifest = {
      lanes,
      flow: { nodes: internalNodes, edges: internalEdges },
      viewport: getViewport(),
    }
    onSave(edge.id, { ...edge.data, logic_json: manifest })
    setIsDirty(false)
    toast.success("Workflow Manifest Synchronized")
  }

  const requestClose = () => {
    if (isDirty) {
      setShowExitPrompt(true)
      return
    }
    onClose()
  }

  const explorerNodeTypes = useMemo(() => ({ logicProcess: ProcessNode, logicDiamond: DiamondNode }), [])
  const explorerEdgeTypes = useMemo(() => ({ logicLink: LogicLinkEdge }), [])

  const availableServices = useMemo(() => {
    const sourceServices = sourceNode.data.all_available_services || []
    const targetServices = targetNode.data.all_available_services || []
    return [...sourceServices, ...targetServices].filter(s => !lanes.some(l => l.serviceId === s.id))
  }, [sourceNode, targetNode, lanes])

  const LanesLayer = () => {
    return (
      <Panel position="top-left" className="w-full h-full !pointer-events-auto !m-0 p-0">
        <div className="flex h-full pointer-events-none">
          {lanes.map((lane, idx) => (
            <div key={lane.id} className="relative border-r border-white/5 bg-white/[0.01] pointer-events-none" style={{ width: 350, minWidth: 350 }}>
               <div className="p-8 pt-12 pointer-events-auto">
                  <ParticipantLaneHeader 
                    lane={lane} 
                    isPrimary={lane.id === 'source-primary' || lane.id === 'target-primary'} 
                    onRemove={removeLane} 
                    onAddNode={addNode}
                    onMoveLeft={(id: string) => moveLane(id, 'left')}
                    onMoveRight={(id: string) => moveLane(id, 'right')}
                  />
               </div>
            </div>
          ))}
        </div>
      </Panel>
    )
  }

  return (
    <div className="fixed inset-0 z-[200] bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.15),transparent_28%),rgba(2,6,23,0.78)] backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} className="w-[95%] h-[92%] glass-panel flex overflow-hidden rounded-lg border border-white/10 shadow-[0_35px_120px_rgba(2,6,23,0.7)] bg-[#020617] relative">
        <div className="w-[320px] border-r border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.96))] flex flex-col z-30 shadow-2xl">
          <div className="p-7 border-b border-white/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))]">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-sky-400/15 rounded-lg text-sky-200 shadow-lg border border-sky-300/20"><Workflow size={16}/></div>
              <div>
                <h3 className="text-base font-black text-white uppercase tracking-[0.14em]">Service Logic</h3>
                <p className="text-[8px] font-bold text-sky-200/60 uppercase tracking-[0.42em] mt-1">Orchestrator</p>
              </div>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={undo} disabled={!canUndo} className={`py-2 rounded-lg border text-[9px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${canUndo ? 'bg-white/5 hover:bg-white/10 border-white/10 text-white' : 'bg-slate-900 border-white/5 text-slate-600 cursor-not-allowed'}`}>
                <RotateCcw size={12}/> Undo
              </button>
              <button onClick={redo} disabled={!canRedo} className={`py-2 rounded-lg border text-[9px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${canRedo ? 'bg-white/5 hover:bg-white/10 border-white/10 text-white' : 'bg-slate-900 border-white/5 text-slate-600 cursor-not-allowed'}`}>
                <RotateCw size={12}/> Redo
              </button>
            </div>
            <div className="rounded-lg border border-amber-400/10 bg-[linear-gradient(180deg,rgba(251,191,36,0.08),rgba(2,6,23,0.25))] p-4 space-y-2 shadow-[0_18px_40px_rgba(15,23,42,0.28)]">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-amber-400 uppercase tracking-widest">Validation</span>
                <span className="text-[7px] font-bold text-slate-500 uppercase">Production Safety</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[8px] font-bold uppercase">
                <div className="rounded-lg bg-white/5 px-2 py-2 text-slate-300">Orphan Steps: {validation.orphanSteps}</div>
                <div className="rounded-lg bg-white/5 px-2 py-2 text-slate-300">Dead Ends: {validation.deadEnds}</div>
                <div className="rounded-lg bg-white/5 px-2 py-2 text-slate-300">Unlabeled Flows: {validation.missingEdgeLabels}</div>
                <div className="rounded-lg bg-white/5 px-2 py-2 text-slate-300">Missing Failure Branch: {validation.missingFailureBranch}</div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-[9px] font-bold text-blue-500 uppercase tracking-widest">Available Participants</span>
                <span className="text-[7px] font-bold text-slate-600 uppercase">{availableServices.length}</span>
              </div>
              <div className="space-y-1.5">
                {availableServices.map((svc: any) => (
                  <button 
                    key={svc.id} 
                    onClick={() => addLane(svc)} 
                    className="w-full p-3.5 rounded-lg border border-white/8 bg-white/[0.04] hover:bg-white/[0.08] hover:border-sky-400/25 transition-all text-left group shadow-[0_12px_24px_rgba(2,6,23,0.25)]"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[11px] font-bold uppercase tracking-tight text-slate-400 group-hover:text-white transition-colors truncate">{svc.name}</p>
                      <Plus size={12} className="text-slate-600 group-hover:text-blue-500"/>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded-lg text-[6px] font-bold uppercase ${svc.device_id === sourceNode.data.id ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                        {svc.device_id === sourceNode.data.id ? 'SRC' : 'DST'}
                      </span>
                      <p className="text-[7px] font-bold uppercase tracking-widest text-slate-600 truncate">{svc.service_type || 'Generic'}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-5 border-t border-white/10 bg-[linear-gradient(180deg,rgba(2,6,23,0.25),rgba(2,6,23,0.55))] space-y-2">
            <button onClick={handleSaveFlow} disabled={!isDirty} className={`w-full py-3 text-[10px] font-bold uppercase tracking-widest rounded-lg shadow-lg transition-all active:scale-95 ${isDirty ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-50'}`}>Sync Workflow</button>
            <button onClick={requestClose} className="w-full py-3 bg-white/5 hover:bg-white/10 text-slate-500 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all">Exit</button>
          </div>
        </div>

        <div className="flex-1 flex flex-col bg-[#020617] relative">
          <div className="flex-1 relative overflow-hidden bg-[#020617]">
            <CanvasDomainBackdrop presentationMode={false} />
            <ReactFlow 
              nodes={internalNodes} 
              edges={internalEdges} 
              onNodesChange={onNodesChangeInternal} 
              onEdgesChange={onEdgesChangeInternal} 
              onConnect={onConnect} 
              nodeTypes={explorerNodeTypes} 
              edgeTypes={explorerEdgeTypes} 
              snapToGrid 
              snapGrid={[20, 20]}
              panOnDrag={true}
              zoomOnScroll={true}
              zoomOnPinch={true}
              zoomOnDoubleClick={true}
              preventScrolling={false}
              selectionOnDrag={true}
              nodesDraggable={true}
              nodesConnectable={true}
              elementsSelectable={true}
              minZoom={0.5}
              maxZoom={2}
              defaultViewport={{ x: 0, y: 0, zoom: 1 }}
              connectionMode={ConnectionMode.Loose}
            >
              <LanesLayer />
              <Background color="#334155" gap={40} size={1.2} className="opacity-25"/>
              <Controls showZoom={true} showInteractive={true} showFitView={true} className="bg-slate-950/90 border border-white/10 rounded-lg overflow-hidden p-1 shadow-2xl" />
            </ReactFlow>
          </div>
        </div>
        <ConfirmationModal
          isOpen={showExitPrompt}
          title="Unsaved Workflow"
          message="Exit the service-level swimlane builder and lose unsaved changes?"
          cancelText="Continue Editing"
          confirmText="Discard Workflow"
          variant="warning"
          onConfirm={() => {
            setShowExitPrompt(false)
            setIsDirty(false)
            onClose()
          }}
          onClose={() => setShowExitPrompt(false)}
        />
      </motion.div>
    </div>
  )
}

const ServiceLevelFlow = (props: any) => (
  <ReactFlowProvider>
    <ServiceLevelFlowInner {...props} />
  </ReactFlowProvider>
)

const defaultFlowMetadata = (flow?: any) => ({
  owner_team: getFlowMeta(flow, 'owner_team') || '',
  criticality: getFlowMeta(flow, 'criticality') || 'Medium',
  dependency_tier: getFlowMeta(flow, 'dependency_tier') || 'Tier 2',
  review_status: getFlowMeta(flow, 'review_status') || 'Needs Review',
  runbook_url: getFlowMeta(flow, 'runbook_url') || '',
  source_of_truth: getFlowMeta(flow, 'source_of_truth') || '',
  business_purpose: getFlowMeta(flow, 'business_purpose') || '',
  last_reviewed_at: getFlowMeta(flow, 'last_reviewed_at') || '',
  next_review_due: getFlowMeta(flow, 'next_review_due') || '',
  approved_at: getFlowMeta(flow, 'approved_at') || '',
  approved_by: getFlowMeta(flow, 'approved_by') || '',
  approval_notes: getFlowMeta(flow, 'approval_notes') || '',
  links: {
    knowledge_ids: normalizeIdList(getFlowMeta(flow, 'links')?.knowledge_ids),
    monitoring_ids: normalizeIdList(getFlowMeta(flow, 'links')?.monitoring_ids),
    far_ids: normalizeIdList(getFlowMeta(flow, 'links')?.far_ids),
    vendor_ids: normalizeIdList(getFlowMeta(flow, 'links')?.vendor_ids),
    project_ids: normalizeIdList(getFlowMeta(flow, 'links')?.project_ids),
  },
})


const ConfigModal = ({ flow, isOpen, onClose, onSave, isNew }: any) => {
  const parseLinkedIds = (value: string) => value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item))
  const [formData, setFormData] = useState({
    name: flow?.name || '',
    description: flow?.description || '',
    category: flow?.category || 'System',
    status: flow?.status || 'Up to date',
    metadata: defaultFlowMetadata(flow),
  });
  useEffect(() => {
    if (flow) {
      setFormData({
        name: flow.name || '',
        description: flow.description || '',
        category: flow.category || 'System',
        status: flow.status || 'Up to date',
        metadata: defaultFlowMetadata(flow),
      });
    }
  }, [flow]);
  if (!isOpen) return null;
  const handleSave = () => {
    if (!formData.name || !formData.description || !formData.category || !formData.status) {
      toast.error("All fields are required");
      return;
    }
    onSave({
      ...formData,
      metadata: {
        ...formData.metadata,
        links: {
          knowledge_ids: parseLinkedIds(String((formData.metadata as any).knowledge_ids_text || '')),
          monitoring_ids: parseLinkedIds(String((formData.metadata as any).monitoring_ids_text || '')),
          far_ids: parseLinkedIds(String((formData.metadata as any).far_ids_text || '')),
          vendor_ids: parseLinkedIds(String((formData.metadata as any).vendor_ids_text || '')),
          project_ids: parseLinkedIds(String((formData.metadata as any).project_ids_text || '')),
        },
      },
    });
  };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-6">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel min-w-0 w-full max-w-xl max-h-[94vh] sm:max-h-[90vh] overflow-y-auto custom-scrollbar p-3 sm:p-8 rounded-lg border border-white/10 bg-[#0f172a]/95">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-4 sm:pb-6">
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
            <div className="shrink-0 rounded-lg border border-blue-500/30 bg-blue-600/20 p-2 text-blue-400 sm:p-3">
              <Settings size={22} />
            </div>
            <div className="min-w-0">
              <h2 className="break-words text-base font-bold uppercase leading-tight tracking-tighter text-white sm:text-xl">{isNew ? 'New Architecture' : 'Manifest Settings'}</h2>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg text-slate-500 hover:text-white">
            <X size={20}/>
          </button>
        </div>
        <div className="mt-4 min-w-0 space-y-4 sm:mt-8 sm:space-y-6">
          <div className="space-y-2">
            <label className="text-[9px] font-bold uppercase text-slate-500 tracking-[0.2em] ml-1">Workflow Name (Required)</label>
            <input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-lg px-5 py-3.5 text-xs font-bold text-white outline-none focus:border-blue-500/50" placeholder="e.g. Core Payment Ingress" />
          </div>
          <div className="space-y-2">
            <label className="text-[9px] font-bold uppercase text-slate-500 tracking-[0.2em] ml-1">Strategic Purpose (Required)</label>
            <textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-lg px-5 py-3.5 text-xs font-bold text-slate-300 outline-none focus:border-blue-500/50 h-28 resize-none" placeholder="Describe the business and technical purpose..." />
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
            <div className="space-y-2">
              <label className="text-[9px] font-bold uppercase text-slate-500 tracking-[0.2em] ml-1">Category (Required)</label>
              <select value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-lg px-5 py-3.5 text-xs font-bold text-white outline-none focus:border-blue-500/50 appearance-none">
                {ARCH_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-bold uppercase text-slate-500 tracking-[0.2em] ml-1">Status (Required)</label>
              <select value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-lg px-5 py-3.5 text-xs font-bold text-white outline-none focus:border-blue-500/50 appearance-none">
                {ARCH_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="border-t border-white/5 pt-6 space-y-4">
            <h3 className="text-[9px] font-bold uppercase text-slate-500 tracking-[0.2em] ml-1">Operational Governance</h3>
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              {[
                ['owner_team', 'Owner Team', 'e.g. Core Platform'],
                ['criticality', 'Criticality', 'Critical / High / Medium / Low'],
                ['dependency_tier', 'Dependency Tier', 'Tier 1 / Tier 2 / Tier 3'],
                ['review_status', 'Review Status', 'Approved / Needs Review / Exception'],
                ['runbook_url', 'Runbook URL', 'https://wiki.example.com/runbook'],
                ['source_of_truth', 'Source Of Truth', 'CMDB / Architecture Board'],
                ['business_purpose', 'Business Purpose', 'Revenue path, auth chain, sync pipeline'],
                ['last_reviewed_at', 'Last Reviewed', '2026-06-01'],
                ['next_review_due', 'Next Review Due', '2026-09-01'],
                ['approved_by', 'Approved By', 'Architecture Board'],
                ['approval_notes', 'Approval Notes', 'Board-approved production topology'],
              ].map(([key, label, placeholder]) => (
                <div key={key} className={key === 'business_purpose' ? 'col-span-2' : ''}>
                  <label className="text-[8px] font-bold uppercase text-slate-600 tracking-[0.2em] ml-1">{label}</label>
                  <input
                    value={(formData.metadata as any)[key] || ''}
                    onChange={e => setFormData({ ...formData, metadata: { ...formData.metadata, [key]: e.target.value } })}
                    className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-5 py-3 text-xs font-bold text-white outline-none focus:border-blue-500/50"
                    placeholder={placeholder}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-white/5 pt-6 space-y-4">
            <h3 className="text-[9px] font-bold uppercase text-slate-500 tracking-[0.2em] ml-1">Cross-Module Links</h3>
            <div className="grid grid-cols-2 gap-4">
              {[
                ['knowledge_ids_text', 'Knowledge IDs', getFlowLinks(flow).knowledge_ids.join(', ')],
                ['monitoring_ids_text', 'Monitoring IDs', getFlowLinks(flow).monitoring_ids.join(', ')],
                ['far_ids_text', 'FAR IDs', getFlowLinks(flow).far_ids.join(', ')],
                ['vendor_ids_text', 'Vendor IDs', getFlowLinks(flow).vendor_ids.join(', ')],
                ['project_ids_text', 'Project IDs', getFlowLinks(flow).project_ids.join(', ')],
              ].map(([key, label, value]) => (
                <div key={key} className="min-w-0">
                  <label className="text-[8px] font-bold uppercase text-slate-600 tracking-[0.2em] ml-1">{label}</label>
                  <input
                    value={(formData.metadata as any)[key] ?? value}
                    onChange={e => setFormData({ ...formData, metadata: { ...formData.metadata, [key]: e.target.value } })}
                    className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-5 py-3 text-xs font-bold text-white outline-none focus:border-blue-500/50"
                    placeholder="1, 2, 3"
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-3 border-t border-white/5 pt-4 sm:flex-row sm:gap-4 sm:pt-6">
             <button onClick={onClose} className="min-h-11 min-w-0 w-full flex-1 whitespace-normal break-words rounded-lg bg-white/5 px-3 py-3 text-[11px] font-bold uppercase tracking-widest text-slate-400 transition-all hover:bg-white/10 sm:py-4">Cancel</button>
             <button onClick={handleSave} className="min-h-11 min-w-0 w-full flex-1 whitespace-normal break-words rounded-lg bg-blue-600 px-3 py-3 text-[11px] font-bold uppercase tracking-widest text-white transition-all shadow-2xl shadow-blue-500/20 hover:bg-blue-500 sm:py-4">{isNew ? 'Create Architecture' : 'Save Changes'}</button>
          </div>
        </div>
      </motion.div>
    </div>
  )
};

const ArchDashboard = ({ flows, onEdit, onAdd }: any) => {
  const [searchTerm, setSearchTerm] = useState(''); 
  const [statusFilter, setStatusFilter] = useState('All');
  const summary = useMemo(() => {
    const list = flows || []
    return {
      total: list.length,
      critical: list.filter((flow: any) => ['Critical', 'Tier 1'].includes(getFlowMeta(flow, 'criticality')) || getFlowMeta(flow, 'dependency_tier') === 'Tier 1').length,
      stale: list.filter((flow: any) => buildArchitectureInsights(flow).isStale).length,
      warnings: list.filter((flow: any) => buildArchitectureInsights(flow).warnings.length > 0).length,
    }
  }, [flows])
  const filtered = useMemo(() => (flows || []).filter((f: any) => { 
    const match = (f.name || '').toLowerCase().includes(searchTerm.toLowerCase()); 
    const matchStatus = statusFilter === 'All' || f.status === statusFilter; 
    return match && matchStatus; 
  }), [flows, searchTerm, statusFilter]);

  const columnDefs = useMemo(() => [
    { field: "id", headerName: "ID", width: 80, cellClass: 'text-center font-bold text-slate-500', headerClass: 'text-center' },
    { field: "name", headerName: "Architecture Identifier", flex: 1.5, cellClass: 'font-bold uppercase text-blue-400', filter: true },
    { field: "category", headerName: "Domain", width: 140, cellClass: 'text-center font-bold uppercase text-slate-400', headerClass: 'text-center' },
    { field: "metadata.owner_team", headerName: "Owner Team", width: 150, valueGetter: (p: any) => getFlowMeta(p.data, 'owner_team') || 'Unassigned', cellClass: 'text-center font-bold uppercase text-slate-300', headerClass: 'text-center' },
    { field: "metadata.review_status", headerName: "Review", width: 130, valueGetter: (p: any) => getFlowMeta(p.data, 'review_status') || 'Needs Review', cellClass: 'text-center font-bold uppercase text-amber-400', headerClass: 'text-center' },
    { field: "warnings", headerName: "Warnings", width: 100, valueGetter: (p: any) => buildArchitectureInsights(p.data).warnings.length, cellClass: 'text-center font-bold text-amber-400', headerClass: 'text-center' },
    { 
      field: "status", 
      headerName: "Governance State", 
      width: 160,
      cellRenderer: (p: any) => (
        <div className="flex items-center justify-center h-full">
          <div className={`px-3 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-widest ${
            p.value === 'Up to date' ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 
            p.value === 'Deprecated' ? 'bg-rose-500/10 border-rose-500/40 text-rose-400' : 
            'bg-blue-500/10 border-blue-500/40 text-blue-400'
          }`}>{p.value}</div>
        </div>
      )
    },
    { 
      headerName: "Operations", 
      width: 140,
      cellRenderer: (p: any) => (
        <div className="flex items-center justify-center h-full">
          <button onClick={() => onEdit(p.data)} className="flex items-center space-x-2 px-4 py-1.5 bg-blue-600/10 hover:bg-blue-600 text-blue-400 hover:text-white rounded-lg border border-blue-500/20 transition-all text-[10px] font-bold uppercase">
            <Edit3 size={12}/> <span>Initialize</span>
          </button>
        </div>
      )
    }
  ], [onEdit]);

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3 custom-scrollbar bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.07),transparent_22%),linear-gradient(180deg,rgba(2,6,23,0.4),rgba(2,6,23,0.7))] sm:p-8" data-architecture-legacy="true">
      <div className="mx-auto min-w-0 max-w-7xl space-y-6 sm:space-y-8">
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-4" data-architecture-legacy-header="true">
          <div className="space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <div className="shrink-0 rounded-lg border border-sky-300/20 bg-sky-400/15 p-2 text-sky-200 shadow-xl sm:p-3"><Workflow size={24}/></div>
              <h1 className="min-w-0 break-words text-2xl font-black uppercase leading-tight tracking-[0.08em] text-white sm:text-4xl">Architecture Matrix</h1>
            </div>
            <p className="mt-3 max-w-full break-words pl-1 text-[10px] font-bold uppercase tracking-[0.2em] text-sky-200/55 sm:tracking-[0.45em]">Core Registry &amp; Governance</p>
          </div>
          <button onClick={onAdd} data-architecture-legacy-create="true" className="flex w-full max-w-full items-center justify-center gap-3 whitespace-normal rounded-lg bg-sky-400 px-4 py-3 text-slate-950 shadow-[0_20px_50px_rgba(56,189,248,0.28)] transition-all hover:bg-sky-300 active:scale-95 sm:w-auto sm:px-8 sm:py-4">
            <Plus size={20}/><span className="text-sm font-bold uppercase tracking-widest">New Architecture</span>
          </button>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
          {[
            ['Registry Entries', summary.total, 'text-blue-400'],
            ['Tier 1 / Critical', summary.critical, 'text-rose-400'],
            ['Review Overdue', summary.stale, 'text-amber-400'],
            ['Needs Attention', summary.warnings, 'text-fuchsia-400'],
          ].map(([label, value, tone]) => (
            <div key={label} className="glass-panel rounded-lg border border-white/8 p-5 bg-[linear-gradient(180deg,rgba(15,23,42,0.68),rgba(15,23,42,0.32))] shadow-[0_18px_44px_rgba(2,6,23,0.24)]">
              <p className="text-[8px] font-black uppercase tracking-[0.35em] text-slate-500">{label}</p>
              <p className={`text-3xl font-black mt-3 ${tone}`}>{value}</p>
            </div>
          ))}
        </div>
        <div className="glass-panel flex h-[600px] min-w-0 flex-col overflow-hidden rounded-lg border border-white/8 bg-[#0f172a]/40 shadow-[0_28px_80px_rgba(2,6,23,0.4)] backdrop-blur-3xl" data-architecture-legacy-matrix="true">
          <div className="flex flex-col justify-between gap-4 border-b border-white/5 p-3 sm:p-6 md:flex-row md:items-center md:gap-6">
            <div className="relative min-w-0 w-full max-w-xl flex-1">
              <Search size={18} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-600"/>
              <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search architectures..." className="w-full bg-black/40 border border-white/10 rounded-lg pl-14 pr-6 py-3.5 text-xs font-bold text-white outline-none focus:border-blue-500/50 shadow-inner"/>
            </div>
            <div className="flex max-w-full flex-wrap bg-black/40 p-1 rounded-lg border border-white/5">
              {['All', ...ARCH_STATUSES].map(s => (
                <button key={s} onClick={() => setStatusFilter(s)} className={`max-w-full px-3 py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all sm:px-5 ${statusFilter === s ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-white'}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 min-w-0 flex-1 ag-theme-alpine-dark">
            <AgGridReact
              rowData={filtered}
              columnDefs={columnDefs}
              animateRows={true}
              headerHeight={48}
              rowHeight={56}
              enableCellTextSelection={true}
            />
          </div>
        </div>
      </div>
      <style>{`
        .ag-theme-alpine-dark {
          --ag-background-color: transparent;
          --ag-header-background-color: rgba(255, 255, 255, 0.02);
          --ag-border-color: rgba(255, 255, 255, 0.05);
          --ag-header-foreground-color: #3b82f6;
          --ag-foreground-color: #f1f5f9;
          --ag-font-family: 'Inter', sans-serif;
        }
        .ag-header-cell-label { font-weight: 700 !important; text-transform: uppercase !important; letter-spacing: 0.1em !important; }
        .ag-cell { font-weight: 700 !important; }
        .ag-row-hover { background-color: rgba(255, 255, 255, 0.05) !important; }
      `}</style>
    </div>
  );
};

const ArchitectureHistoryPanel = ({ flow, historyEntries, isOpen, onClose, onRestore, onApprove }: any) => {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-[180] bg-black/70 backdrop-blur-sm flex justify-end">
      <motion.div initial={{ x: 420 }} animate={{ x: 0 }} exit={{ x: 420 }} className="w-[420px] h-full bg-[#020617] border-l border-white/10 shadow-3xl flex flex-col">
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold uppercase text-white tracking-tight flex items-center gap-2"><History size={18} className="text-blue-400" /> Version History</h3>
            <p className="text-[8px] font-bold uppercase tracking-[0.3em] text-slate-500 mt-2">{flow?.name || 'Architecture'}</p>
          </div>
          <button aria-label="Close history" onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg text-slate-500 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-4 border-b border-white/5">
          <button onClick={onApprove} className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2">
            <ShieldCheck size={14} /> Approve Current Version
          </button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
          {(historyEntries || []).map((entry: any, index: number) => {
            const diff = buildVersionDiff(entry, historyEntries[index + 1])
            return (
              <div key={entry.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400">Version {entry.version}</p>
                    <p className="text-[9px] font-bold uppercase text-white mt-1">{entry.change_summary || 'Architecture change'}</p>
                    <p className="text-[8px] font-bold uppercase text-slate-500 mt-2">{entry.created_at ? formatAppDate(entry.created_at) : 'Unknown time'}</p>
                  </div>
                  <button onClick={() => onRestore(entry.id)} className="px-3 py-2 rounded-lg bg-white/5 hover:bg-blue-600 text-slate-300 hover:text-white border border-white/10 text-[8px] font-bold uppercase tracking-widest">
                    Restore
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[8px] font-bold uppercase">
                  <div className="rounded-lg bg-black/30 px-3 py-2 text-slate-300">Nodes: {entry.snapshot?.nodes?.length || 0} ({diff.nodeDelta >= 0 ? '+' : ''}{diff.nodeDelta})</div>
                  <div className="rounded-lg bg-black/30 px-3 py-2 text-slate-300">Flows: {entry.snapshot?.edges?.length || 0} ({diff.edgeDelta >= 0 ? '+' : ''}{diff.edgeDelta})</div>
                  <div className="rounded-lg bg-black/30 px-3 py-2 text-slate-300">Review: {entry.snapshot?.metadata?.review_status || 'Needs Review'}</div>
                  <div className="rounded-lg bg-black/30 px-3 py-2 text-slate-300">Warnings: {diff.warningCount}</div>
                </div>
                {diff.metadataChanged.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {diff.metadataChanged.map((field: string) => (
                      <span key={field} className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[7px] font-bold uppercase tracking-widest">{field.replaceAll('_', ' ')}</span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </motion.div>
    </div>
  )
}

const ArchitectureReportModal = ({ flow, nodes, edges, historyEntries, relatedLinks, isOpen, onClose }: any) => {
  if (!isOpen || !flow) return null
  const insights = buildArchitectureInsights({ ...flow, nodes, edges })
  const latestHistory = historyEntries?.[0]
  return (
    <div className="fixed inset-0 z-[170] bg-black/75 backdrop-blur-sm flex items-center justify-center p-6">
      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-4xl max-h-[90vh] overflow-y-auto custom-scrollbar rounded-lg border border-white/10 bg-[#020617] shadow-3xl">
        <div className="p-8 border-b border-white/5 flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold uppercase text-white tracking-tight flex items-center gap-3"><FileText size={24} className="text-blue-400" /> Architecture Report</h3>
            <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-slate-500 mt-3">{flow.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold uppercase tracking-widest flex items-center gap-2"><Printer size={14} /> Print</button>
            <button aria-label="Close report" onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg text-slate-500 hover:text-white"><X size={18} /></button>
          </div>
        </div>
        <div className="p-8 space-y-6">
          <div className="grid grid-cols-4 gap-4">
            {[
              ['Nodes', insights.nodeCount, 'text-blue-400'],
              ['Flows', insights.edgeCount, 'text-emerald-400'],
              ['Warnings', insights.warnings.length, 'text-amber-400'],
              ['Version', latestHistory?.version || flow.current_version || 1, 'text-fuchsia-400'],
            ].map(([label, value, tone]) => (
              <div key={label} className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
                <p className={`text-2xl font-bold mt-2 ${tone}`}>{value}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5 space-y-3">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-white">Governance</h4>
              <p className="text-[10px] font-bold uppercase text-slate-300">Owner Team: {getFlowMeta(flow, 'owner_team') || 'Unassigned'}</p>
              <p className="text-[10px] font-bold uppercase text-slate-300">Criticality: {getFlowMeta(flow, 'criticality') || 'Medium'}</p>
              <p className="text-[10px] font-bold uppercase text-slate-300">Review Status: {getFlowMeta(flow, 'review_status') || 'Needs Review'}</p>
              <p className="text-[10px] font-bold uppercase text-slate-300">Business Purpose: {getFlowMeta(flow, 'business_purpose') || 'Not documented'}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5 space-y-3">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-white">Linked Operations</h4>
              <p className="text-[10px] font-bold uppercase text-slate-300">Knowledge: {relatedLinks.knowledge.length}</p>
              <p className="text-[10px] font-bold uppercase text-slate-300">Monitoring: {relatedLinks.monitoring.length}</p>
              <p className="text-[10px] font-bold uppercase text-slate-300">FAR: {relatedLinks.far.length}</p>
              <p className="text-[10px] font-bold uppercase text-slate-300">Vendors: {relatedLinks.vendors.length}</p>
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5 space-y-3">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-white">Executive Attention</h4>
            {insights.warnings.length > 0 ? insights.warnings.map((warning: string) => (
              <div key={warning} className="px-3 py-2 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[10px] font-bold uppercase">{warning}</div>
            )) : <div className="px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] font-bold uppercase">No governance warnings</div>}
          </div>
        </div>
      </motion.div>
    </div>
  )
}

const MissionControl = ({ selectedNode, selectedEdge, impactedNodes, pathAnalysis, relatedLinks, nodeOperationalStatus, onBack, onUpdateNode, onUpdateEdge, onAddServiceToNode, availableServices, onDeleteNode, onDeleteEdge, setIsServiceFlowOpen }: any) => {
   const [edgeForm, setEdgeForm] = useState<any>(selectedEdge?.data || {}); const [nodeForm, setNodeForm] = useState<any>(selectedNode?.data || {});
   useEffect(() => { if (selectedEdge) setEdgeForm(selectedEdge.data || {}); }, [selectedEdge]); useEffect(() => { if (selectedNode) setNodeForm(selectedNode.data || {}); }, [selectedNode]);
   const handleEdgeChange = (f: string, v: any) => { const updated = { ...edgeForm, [f]: v }; setEdgeForm(updated); onUpdateEdge(selectedEdge.id, updated); };
   const handleNodeChange = (f: string, v: any) => { const updated = { ...nodeForm, [f]: v }; setNodeForm(updated); onUpdateNode(selectedNode.id, updated); };
   const nodeLinks = selectedNode?.type === 'device'
     ? [
         { label: 'Asset', href: `/asset?id=${selectedNode.data.id}` },
         ...(selectedNode.data.logical_services || []).map((service: any) => ({ label: service.name, href: `/services?id=${service.id}` })),
       ]
     : selectedNode?.type === 'EXTERNAL'
       ? [{ label: 'External Entity', href: `/external?id=${selectedNode.data.id}` }]
       : []
   return (
     <div className="w-[360px] glass-panel h-full border-l border-white/5 flex flex-col p-6 space-y-8 bg-[#0f172a]/95 backdrop-blur-3xl z-50 overflow-y-auto custom-scrollbar shadow-[-10px_0_40px_rgba(0,0,0,0.5)]">
       <div className="flex items-center justify-between border-b border-white/5 pb-4">
         <h2 className="text-sm font-bold uppercase text-white tracking-tight flex items-center gap-2"><Zap size={16} className="text-blue-500"/> Configuration</h2>
         <button onClick={onBack} className="p-1.5 hover:bg-white/5 rounded-lg text-slate-500 hover:text-white"><X size={18}/></button>
       </div>
       {selectedNode ? (
         <div className="space-y-6">
           <div className="p-5 bg-blue-600/5 rounded-lg border border-blue-600/20 space-y-3 relative overflow-hidden group">
             <p className="text-[8px] font-bold text-blue-500 uppercase tracking-widest">Primary Node Details</p>
             {['condition', 'note'].includes(selectedNode.type) ? (
               <div className="space-y-2 relative z-10"><input value={nodeForm.label || ''} onChange={e => handleNodeChange('label', e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-bold text-white outline-none focus:border-blue-500"/></div>
             ) : (
               <><h3 className="text-lg font-bold text-white tracking-tight leading-none relative z-10">{selectedNode.data.name}</h3><div className="flex items-center space-x-2.5 relative z-10"><StatusPill value={selectedNode.data.status} /><span className="text-[9px] font-bold text-slate-500 tracking-widest">{selectedNode.data.ip_address}</span></div></>
             )}
           </div>
           {selectedNode.type === 'device' && (
             <div className="space-y-3">
               <div className="flex items-center justify-between px-1"><h4 className="text-[9px] font-bold uppercase text-emerald-400 tracking-widest flex items-center gap-2"><Database size={12}/> Service Registry</h4><span className="text-[7px] font-bold text-slate-600 uppercase">{selectedNode.data.all_available_services?.length || 0}</span></div>
               <div className="grid grid-cols-2 gap-2">
                 {(selectedNode.data.all_available_services || []).map((s: any) => {
                   const isAdded = selectedNode.data.logical_services?.some((ls: any) => ls.id === s.id);
                   return (
                     <button 
                       key={s.id} 
                       disabled={isAdded}
                       onClick={() => onAddServiceToNode(selectedNode.id, s)} 
                       className={`p-2.5 border rounded-lg text-[9px] font-bold transition-all text-left uppercase truncate ${isAdded ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-black/40 hover:bg-emerald-500/10 border-white/5 text-slate-500 hover:text-emerald-400'}`}
                     >
                       <div className="flex flex-col">
                         <span>{s.name}</span>
                       </div>
                     </button>
                   );
                 })}
               </div>
             </div>
           )}
           <div className="space-y-3">
             <div className="rounded-lg border border-white/5 bg-black/30 p-4 space-y-3">
               <div className="flex items-center justify-between">
                 <h4 className="text-[9px] font-bold uppercase text-rose-400 tracking-widest flex items-center gap-2"><Route size={12}/> Blast Radius</h4>
                 <span className="text-[7px] font-bold text-slate-600 uppercase">{impactedNodes?.size || 0} impacted</span>
               </div>
               <div className="grid grid-cols-2 gap-2 text-[8px] font-bold uppercase">
                 <div className="rounded-lg bg-white/5 px-2 py-2 text-slate-300">Upstream: {pathAnalysis?.upstreamNodeIds?.size || 0}</div>
                 <div className="rounded-lg bg-white/5 px-2 py-2 text-slate-300">Downstream: {pathAnalysis?.downstreamNodeIds?.size || 0}</div>
               </div>
               {selectedNode?.type === 'device' && (
                 <div className="grid grid-cols-3 gap-2 text-[8px] font-bold uppercase">
                   <div className="rounded-lg bg-rose-500/10 px-2 py-2 text-rose-300">Incidents: {nodeOperationalStatus?.incidentCount || 0}</div>
                   <div className="rounded-lg bg-amber-500/10 px-2 py-2 text-amber-300">Maintenance: {nodeOperationalStatus?.maintenanceCount || 0}</div>
                   <div className="rounded-lg bg-blue-500/10 px-2 py-2 text-blue-300">Monitors: {nodeOperationalStatus?.monitorCount || 0}</div>
                 </div>
               )}
             </div>
             {nodeLinks.length > 0 && (
               <div className="space-y-3">
                 <div className="flex items-center justify-between px-1"><h4 className="text-[9px] font-bold uppercase text-indigo-400 tracking-widest flex items-center gap-2"><Link2 size={12}/> Linked Records</h4></div>
                 <div className="grid grid-cols-1 gap-2">
                   {nodeLinks.map((link: any) => (
                     <a key={link.href} href={link.href} className="px-3 py-2 rounded-lg bg-white/5 hover:bg-indigo-600/10 border border-white/5 text-[9px] font-bold uppercase text-slate-300 hover:text-white transition-all flex items-center justify-between">
                       <span>{link.label}</span>
                       <ExternalLink size={12} />
                     </a>
                   ))}
                 </div>
               </div>
             )}
             <div className="space-y-3">
               <div className="flex items-center justify-between px-1"><h4 className="text-[9px] font-bold uppercase text-fuchsia-400 tracking-widest flex items-center gap-2"><Compass size={12}/> Architecture Links</h4></div>
               <div className="grid grid-cols-2 gap-2 text-[8px] font-bold uppercase">
                 <a href="/knowledge" className="rounded-lg bg-white/5 px-3 py-2 text-slate-300 hover:text-white transition-all">Knowledge ({relatedLinks.knowledge.length})</a>
                 <a href="/monitoring" className="rounded-lg bg-white/5 px-3 py-2 text-slate-300 hover:text-white transition-all">Monitoring ({relatedLinks.monitoring.length})</a>
                 <a href="/far" className="rounded-lg bg-white/5 px-3 py-2 text-slate-300 hover:text-white transition-all">FAR ({relatedLinks.far.length})</a>
                 <a href="/vendors" className="rounded-lg bg-white/5 px-3 py-2 text-slate-300 hover:text-white transition-all">Vendors ({relatedLinks.vendors.length})</a>
               </div>
             </div>
             <button onClick={() => onDeleteNode(selectedNode.id)} className="w-full py-3 bg-rose-500/5 hover:bg-rose-500 text-rose-500 hover:text-white font-bold uppercase text-[9px] tracking-widest rounded-lg transition-all border border-rose-500/10 flex items-center justify-center gap-2"><Trash2 size={12}/> Decommission Node</button>
           </div>
         </div>
       ) : selectedEdge ? (
         <div className="space-y-6">
           <div className="p-5 bg-blue-600/5 rounded-lg border border-blue-600/20 space-y-4">
             <p className="text-[8px] font-bold text-blue-500 uppercase tracking-widest">Flow Dynamics</p>
             <div className="space-y-3">
               <div className="space-y-1.5"><label className="text-[7px] font-bold uppercase text-slate-600 tracking-widest ml-1">Flow Identifier</label><input value={edgeForm.label || ''} onChange={e => handleEdgeChange('label', e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-bold text-white outline-none focus:border-blue-500"/></div>
               <div className="space-y-1.5"><label className="text-[7px] font-bold uppercase text-slate-600 tracking-widest ml-1">Protocol</label><select value={edgeForm.protocol || 'HTTPS'} onChange={e => handleEdgeChange('protocol', e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-bold text-white outline-none focus:border-blue-500 appearance-none">{PROTOCOLS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
               <div className="space-y-1.5"><label className="text-[7px] font-bold uppercase text-slate-600 tracking-widest ml-1">Classification</label><div className="grid grid-cols-2 gap-1.5">{FLOW_TYPES.map(t => <button key={t.id} onClick={() => handleEdgeChange('type', t.id)} className={`p-2 rounded-lg border text-[8px] font-bold uppercase transition-all ${edgeForm.type === t.id ? 'bg-blue-600 border-blue-400 text-white shadow-md' : 'bg-black/40 border-white/5 text-slate-500 hover:text-slate-300'}`}>{t.label}</button>)}</div></div>
             </div>
           </div>
           <div className="space-y-3">
             <div className="rounded-lg border border-white/5 bg-black/30 p-4 space-y-3">
               <div className="flex items-center justify-between">
                 <h4 className="text-[9px] font-bold uppercase text-emerald-400 tracking-widest flex items-center gap-2"><Route size={12}/> Service Path</h4>
                 <span className="text-[7px] font-bold text-slate-600 uppercase">{pathAnalysis?.pathEdgeIds?.size || 0} linked flows</span>
               </div>
               <div className="grid grid-cols-2 gap-2 text-[8px] font-bold uppercase">
                 <div className="rounded-lg bg-white/5 px-2 py-2 text-slate-300">Upstream Nodes: {pathAnalysis?.upstreamNodeIds?.size || 0}</div>
                 <div className="rounded-lg bg-white/5 px-2 py-2 text-slate-300">Downstream Nodes: {pathAnalysis?.downstreamNodeIds?.size || 0}</div>
               </div>
             </div>
             <button onClick={() => setIsServiceFlowOpen(true)} className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold uppercase text-[10px] tracking-widest rounded-lg transition-all shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-2"><Workflow size={14}/> Service Logic Builder</button>
             <button onClick={() => onDeleteEdge(selectedEdge.id)} className="w-full py-2.5 bg-rose-500/5 hover:bg-rose-500 text-rose-500 hover:text-white font-bold uppercase text-[9px] tracking-widest rounded-lg transition-all border border-rose-500/10 flex items-center justify-center gap-2"><Trash2 size={12}/> Sever Connection</button>
           </div>
         </div>
       ) : (
         <div className="flex-1 flex flex-col items-center justify-center px-6">
           <div className="w-full rounded-lg border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.82),rgba(2,6,23,0.72))] p-8 text-center shadow-[0_24px_60px_rgba(2,6,23,0.4)]">
             <Layers size={52} className="text-sky-300/40 mx-auto" />
             <p className="mt-5 text-[8px] font-black uppercase text-sky-300/70 tracking-[0.42em]">Focus Console</p>
             <p className="mt-4 text-[11px] font-bold uppercase text-slate-200 tracking-[0.16em] leading-relaxed">Select a node, edge, or service path to inspect impact, governance, and linked operational context.</p>
           </div>
         </div>
       )}
     </div>
   )
}

function ArchDesignerInner() {
  const { fitView, setViewport, getViewport } = useReactFlow();
  const [view, setView] = useState<'dashboard' | 'editor'>('dashboard');
  const [nodes, setNodes, onNodesChange] = useNodesState([]); const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [activeFlow, setActiveFlow] = useState<any>(null); const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null); const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); const [isConfigSidebarOpen, setIsConfigSidebarOpen] = useState(true); const [isConfigModalOpen, setIsConfigModalOpen] = useState(false); const [isServiceFlowOpen, setIsServiceFlowOpen] = useState(false);
  const [activeTransactionId, setActiveTransactionId] = useState<string | null>(null); const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false); const [isConfirmExitOpen, setIsConfirmExitOpen] = useState(false); const [confirmExitIntent, setConfirmExitIntent] = useState<'dashboard' | null>(null); const [dependencyRiskEnabled, setDependencyRiskEnabled] = useState(false);
  const [inventorySearch, setInventorySearch] = useState(''); const [inventoryType, setInventoryType] = useState<'INTERNAL' | 'EXTERNAL'>('INTERNAL'); const [selectedSystem, setSelectedSystem] = useState<string | 'All'>('All');
  const [editorViewport, setEditorViewport] = useState<any>({ x: 0, y: 0, zoom: 1 })
  const [scenarioMode, setScenarioMode] = useState<'ALL' | 'CRITICAL_PATH' | 'PRODUCTION_ONLY' | 'ATTENTION_ONLY'>('ALL')
  const [isPresentationMode, setIsPresentationMode] = useState(false)
  const [showOperationalOverlay, setShowOperationalOverlay] = useState(true)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isReportOpen, setIsReportOpen] = useState(false)
  const queryClient = useQueryClient();
  const { data: savedFlows } = useQuery({ queryKey: ['data-flows'], queryFn: async () => (await (await apiFetch('/api/v1/data-flows/')).json()) });
  const { data: assets } = useQuery({ queryKey: ['devices'], queryFn: async () => (await (await apiFetch('/api/v1/devices/')).json()) });
  const { data: externalEntities } = useQuery({ queryKey: ['external-entities', { include_deleted: false }], queryFn: async () => (await (await apiFetch('/api/v1/intelligence/entities')).json()) });
  const { data: logicalServices } = useQuery({ queryKey: ['logical-services'], queryFn: async () => (await (await apiFetch('/api/v1/logical-services/')).json()) });
  const { data: monitoringItems } = useQuery({ queryKey: ['monitoring'], queryFn: async () => (await (await apiFetch('/api/v1/monitoring')).json()) });
  const { data: incidents } = useQuery({ queryKey: ['incidents'], queryFn: async () => (await (await apiFetch('/api/v1/incidents')).json()) });
  const { data: maintenanceWindows } = useQuery({ queryKey: ['maintenance'], queryFn: async () => (await (await apiFetch('/api/v1/maintenance')).json()) });
  const { data: knowledgeEntries } = useQuery({ queryKey: ['knowledge'], queryFn: async () => (await (await apiFetch('/api/v1/knowledge')).json()) });
  const { data: farModes } = useQuery({ queryKey: ['far-modes'], queryFn: async () => (await (await apiFetch('/api/v1/far/modes')).json()) });
  const { data: vendors } = useQuery({ queryKey: ['vendors'], queryFn: async () => (await (await apiFetch('/api/v1/vendors')).json()) });
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: async () => (await (await apiFetch('/api/v1/projects')).json()) });
  const { data: flowHistory } = useQuery({
    queryKey: ['data-flow-history', activeFlow?.id],
    enabled: !!activeFlow?.id,
    queryFn: async () => (await (await apiFetch(`/api/v1/data-flows/${activeFlow.id}/history`)).json()),
  });
  const transactions = useMemo(() => activeFlow?.traces || [], [activeFlow]);
  const activeTransaction = useMemo(() => transactions.find((t: any) => t.id === activeTransactionId), [transactions, activeTransactionId]);
  const systems = useMemo(() => { if (!assets) return []; const s = new Set<string>(); assets.forEach((a: any) => { if (a.system) s.add(a.system); }); return Array.from(s).sort(); }, [assets]);
  const filteredAssets = useMemo(() => (assets || []).filter((a: any) => { const matchSearch = (a.hostname || a.name || '').toLowerCase().includes(inventorySearch.toLowerCase()) || (a.ip_address || '').includes(inventorySearch); const matchSystem = selectedSystem === 'All' || a.system === selectedSystem; return matchSearch && matchSystem && !a.is_deleted; }), [assets, inventorySearch, selectedSystem]);
  const filteredExternal = useMemo(() => (externalEntities || []).filter((e: any) => e.name?.toLowerCase().includes(inventorySearch.toLowerCase())), [externalEntities, inventorySearch]);
  const saveMutation = useMutation({
    mutationFn: async (data: any) => { const isUpdate = !!data.id; const url = isUpdate ? `/api/v1/data-flows/${data.id}` : '/api/v1/data-flows'; const response = await apiFetch(url, { method: isUpdate ? 'PUT' : 'POST', body: JSON.stringify(data) }); return response.json(); },
    onSuccess: (savedFlow) => { setActiveFlow(savedFlow); setHasUnsavedChanges(false); queryClient.invalidateQueries({ queryKey: ['data-flows'] }); queryClient.invalidateQueries({ queryKey: ['data-flow-history', savedFlow.id] }); toast.success("Manifest Persistent in Core Registry"); if (view === 'dashboard') setView('editor'); },
    onError: () => toast.error("Failure Syncing Manifest to Core")
  });
  const approveMutation = useMutation({
    mutationFn: async () => {
      const response = await apiFetch(`/api/v1/data-flows/${activeFlow.id}/approve`, { method: 'POST', body: JSON.stringify({ approved_by: getFlowMeta(activeFlow, 'owner_team') || 'Architecture Board' }) })
      return response.json()
    },
    onSuccess: (savedFlow) => {
      setActiveFlow(savedFlow)
      queryClient.invalidateQueries({ queryKey: ['data-flows'] })
      queryClient.invalidateQueries({ queryKey: ['data-flow-history', savedFlow.id] })
      toast.success('Architecture Approved')
    },
  })
  const restoreMutation = useMutation({
    mutationFn: async (historyId: number) => {
      const response = await apiFetch(`/api/v1/data-flows/${activeFlow.id}/history/${historyId}/restore`, { method: 'POST' })
      return response.json()
    },
    onSuccess: (savedFlow) => {
      setActiveFlow(savedFlow)
      setNodes(savedFlow.nodes || [])
      setEdges(savedFlow.edges || [])
      setHasUnsavedChanges(false)
      queryClient.invalidateQueries({ queryKey: ['data-flows'] })
      queryClient.invalidateQueries({ queryKey: ['data-flow-history', savedFlow.id] })
      toast.success('Architecture Restored')
    },
  })
  const updateNodeData = (nodeId: string, updatedData: any) => { setNodes((nds) => nds.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, ...updatedData } } : node)); setHasUnsavedChanges(true); };
  const updateEdgeData = (edgeId: string, updatedData: any) => { setEdges((eds) => eds.map((edge) => edge.id === edgeId ? { ...edge, data: { ...edge.data, ...updatedData } } : edge)); setHasUnsavedChanges(true); };
  const addServiceToNode = (nodeId: string, service: any) => { setNodes((nds) => nds.map((node) => { if (node.id === nodeId) { const currentServices = node.data.logical_services || []; if (currentServices.find((s: any) => s.id === service.id)) return node; return { ...node, data: { ...node.data, logical_services: [...currentServices, service] } }; } return node; })); setHasUnsavedChanges(true); };
  const deleteNode = (nodeId: string) => { setNodes((nds) => nds.filter((node) => node.id !== nodeId)); setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)); setSelectedNodeId(null); setHasUnsavedChanges(true); };
  const deleteEdge = (edgeId: string) => { setEdges((eds) => eds.filter((edge) => edge.id !== edgeId)); setSelectedEdgeId(null); setHasUnsavedChanges(true); };
  const handleSave = () => { if (!activeFlow) return; saveMutation.mutate({ ...activeFlow, metadata: activeFlow.metadata || {}, nodes, edges, viewport: editorViewport || getViewport(), change_summary: 'Updated from architecture editor' }); };
  const pathAnalysis = useMemo(() => buildPathAnalysis(nodes, edges, selectedNodeId, selectedEdgeId), [nodes, edges, selectedNodeId, selectedEdgeId])
  const impactAnalysis = useMemo(() => {
    if (!pathAnalysis.focusNodeId) return { nodeIds: new Set<string>(), edgeIds: new Set<string>() }
    return {
      nodeIds: new Set<string>([pathAnalysis.focusNodeId, ...Array.from(pathAnalysis.upstreamNodeIds), ...Array.from(pathAnalysis.downstreamNodeIds)]),
      edgeIds: pathAnalysis.pathEdgeIds,
    }
  }, [pathAnalysis]);
  const impactedNodes = impactAnalysis.nodeIds;
  const architectureInsights = useMemo(() => buildArchitectureInsights({ ...activeFlow, nodes, edges }), [activeFlow, nodes, edges]);
  const relatedLinks = useMemo(() => {
    const links = getFlowLinks(activeFlow)
    return {
      knowledge: (knowledgeEntries || []).filter((entry: any) => links.knowledge_ids.includes(entry.id)),
      monitoring: (monitoringItems || []).filter((entry: any) => links.monitoring_ids.includes(entry.id)),
      far: (farModes || []).filter((entry: any) => links.far_ids.includes(entry.id)),
      vendors: (vendors || []).filter((entry: any) => links.vendor_ids.includes(entry.id)),
      projects: (projects || []).filter((entry: any) => links.project_ids.includes(entry.id)),
    }
  }, [activeFlow, knowledgeEntries, monitoringItems, farModes, vendors, projects])
  const nodeOperationalMap = useMemo(() => new Map((nodes || []).map((node: any) => [node.id, buildNodeOperationalStatus(node, monitoringItems || [], incidents || [], maintenanceWindows || [])])), [nodes, monitoringItems, incidents, maintenanceWindows])
  const displayNodes = useMemo(() => nodes.map((n: any) => {
    const operationalStatus = nodeOperationalMap.get(n.id) || { hasAttention: false }
    const isProduction = !n.data?.environment || n.data.environment === 'Production'
    const isInPath = !pathAnalysis.focusNodeId || impactAnalysis.nodeIds.has(n.id)
    const isAttention = operationalStatus.hasAttention
    const isDimmed = scenarioMode === 'PRODUCTION_ONLY' ? !isProduction
      : scenarioMode === 'ATTENTION_ONLY' ? !isAttention
      : scenarioMode === 'CRITICAL_PATH' ? !isInPath
      : false
    return { ...n, data: { ...n.data, isImpacted: impactAnalysis.nodeIds.has(n.id), dependencyRiskEnabled, activeTransactionId, operationalStatus: showOperationalOverlay ? operationalStatus : {}, isDimmed, transactionVisits: activeTransaction?.steps?.map((s: any, idx: number) => s.node_id === n.id ? idx + 1 : null).filter((v: any) => v !== null) || [] } }
  }), [nodes, impactAnalysis, dependencyRiskEnabled, activeTransaction, nodeOperationalMap, scenarioMode, pathAnalysis.focusNodeId, showOperationalOverlay]);
  const displayEdges = useMemo(() => edges.map((e: any) => {
    const sourceNode = nodes.find((node: any) => node.id === e.source)
    const targetNode = nodes.find((node: any) => node.id === e.target)
    const isDimmed = scenarioMode === 'CRITICAL_PATH' ? !impactAnalysis.edgeIds.has(e.id)
      : scenarioMode === 'PRODUCTION_ONLY' ? [sourceNode, targetNode].some((node: any) => node?.data?.environment && node.data.environment !== 'Production')
      : scenarioMode === 'ATTENTION_ONLY' ? [sourceNode, targetNode].every((node: any) => !(nodeOperationalMap.get(node?.id)?.hasAttention))
      : false
    return { ...e, data: { ...e.data, isImpacted: impactAnalysis.edgeIds.has(e.id) && dependencyRiskEnabled, isTraceActive: activeTransaction?.steps?.some((s: any) => s.edge_id === e.id), traceStep: activeTransaction?.steps?.findIndex((s: any) => s.edge_id === e.id) + 1 || null, isDimmed, onSelect: (edgeId: string) => { setSelectedEdgeId(edgeId); setSelectedNodeId(null); setIsConfigSidebarOpen(true) } } }
  }), [edges, nodes, impactAnalysis, dependencyRiskEnabled, activeTransaction, scenarioMode, nodeOperationalMap]);
  const onConnect = useCallback((params: Connection) => { setEdges((eds) => addEdge({ ...params, id: `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, type: 'labeled', data: { type: 'DATA', label: 'NEW_FLOW', protocol: 'HTTPS', step: eds.length + 1, logic_json: { lanes: [], flow: { nodes: [], edges: [] } } }, animated: true, markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' } }, eds)); setHasUnsavedChanges(true); toast.success("Connection Established"); }, [setEdges]);
  const handleAutoLayout = () => { const dagreGraph = new dagre.graphlib.Graph(); dagreGraph.setDefaultEdgeLabel(() => ({})); dagreGraph.setGraph({ rankdir: 'LR', nodesep: 80, ranksep: 150, marginx: 50, marginy: 50 }); nodes.forEach((node) => dagreGraph.setNode(node.id, { width: 320, height: 220 })); edges.forEach((edge) => dagreGraph.setEdge(edge.source, edge.target)); dagre.layout(dagreGraph); setNodes(nodes.map((node) => { const pos = dagreGraph.node(node.id); return { ...node, position: { x: pos.x - 160, y: pos.y - 110 } }; })); setHasUnsavedChanges(true); setTimeout(() => fitView({ duration: 800, padding: 40 }), 100); toast.success("Layout Optimized"); };
  const handleEdit = (flow: any) => {
    setActiveFlow(flow);
    setNodes(flow.nodes || []);
    setEdges(flow.edges || []);
    setEditorViewport(flow.viewport || { x: 0, y: 0, zoom: 1 });
    setView('editor');
    setHasUnsavedChanges(false);
    setTimeout(() => {
      if (flow.viewport && typeof flow.viewport.zoom === 'number') {
        setViewport(flow.viewport, { duration: 0 });
      } else {
        fitView({ padding: 40 });
      }
    }, 200);
  };
  const handleNewArchitecture = () => { setActiveFlow({ name: '', description: '', category: 'System', status: 'Planned', metadata: defaultFlowMetadata() }); setNodes([]); setEdges([]); setEditorViewport({ x: 0, y: 0, zoom: 1 }); setView('dashboard'); setIsConfigModalOpen(true); };
  const updateFlowMetadata = (updates: Record<string, any>) => {
    setActiveFlow((current: any) => current ? { ...current, metadata: { ...(current.metadata || {}), ...updates } } : current)
    setHasUnsavedChanges(true)
  }

  return (
    <div className="flex-1 relative flex h-full overflow-hidden bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.08),transparent_26%),linear-gradient(180deg,#020617,#020617)]">
       {view === 'dashboard' ? (
         <ArchDashboard flows={savedFlows} onEdit={handleEdit} onAdd={handleNewArchitecture} />
       ) : (
         <>
            {/* Standardized Centered Top Bar */}
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[100] pointer-events-none">
              <div className={`glass-panel p-2 rounded-lg border flex items-center space-x-2 shadow-[0_20px_60px_rgba(2,6,23,0.5)] pointer-events-auto ${isPresentationMode ? 'bg-slate-950/90 border-fuchsia-300/20 backdrop-blur-3xl' : 'bg-slate-900/82 border-white/10 backdrop-blur-2xl'}`}>
                <div className="flex flex-col min-w-[240px] px-5 py-1">
                  <span className={`${isPresentationMode ? 'text-xl' : 'text-sm'} font-black uppercase text-white tracking-[0.18em] truncate`}>{activeFlow?.name || 'Untitled Architecture'}</span>
                  <span className={`${isPresentationMode ? 'text-[9px]' : 'text-[7px]'} font-bold text-sky-300 uppercase tracking-[0.42em] mt-1`}>{activeFlow?.category || 'General'}</span>
                </div>
                <div className="h-8 w-px bg-white/10" />
                <div className="flex items-center space-x-1.5 p-1">
                  <button onClick={() => setIsConfigModalOpen(true)} className="px-4 py-2 bg-blue-600/10 hover:bg-blue-600 text-blue-400 hover:text-white rounded-lg border border-blue-500/20 transition-all flex items-center gap-2">
                    <Info size={14}/>
                    <span className="text-[9px] font-bold uppercase tracking-widest">Arch Info</span>
                  </button>
                  <button onClick={() => setIsHistoryOpen(true)} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded-lg border border-white/10 transition-all flex items-center gap-2">
                    <History size={14}/>
                    <span className="text-[9px] font-bold uppercase tracking-widest">History</span>
                  </button>
                  <button onClick={() => approveMutation.mutate()} disabled={!activeFlow?.id || approveMutation.isPending} className="px-4 py-2 bg-emerald-600/10 hover:bg-emerald-600 text-emerald-300 hover:text-white rounded-lg border border-emerald-500/20 transition-all flex items-center gap-2 disabled:opacity-50">
                    <ShieldCheck size={14}/>
                    <span className="text-[9px] font-bold uppercase tracking-widest">Approve</span>
                  </button>
                  <button onClick={handleAutoLayout} className="p-2.5 bg-white/5 hover:bg-emerald-500/10 rounded-lg text-slate-400 hover:text-emerald-400 transition-all border border-white/5" title="Auto Layout"><GitMerge size={16} className="rotate-90"/></button>
                  <button onClick={() => setDependencyRiskEnabled(!dependencyRiskEnabled)} className={`p-2.5 rounded-lg transition-all flex items-center gap-2 border ${dependencyRiskEnabled ? 'bg-rose-500 border-rose-400 text-white' : 'bg-white/5 border-white/5 text-slate-400'}`} title="Impact Mode"><AlertTriangle size={16}/></button>
                  <button onClick={() => setShowOperationalOverlay(!showOperationalOverlay)} className={`p-2.5 rounded-lg transition-all border ${showOperationalOverlay ? 'bg-blue-500/20 border-blue-400 text-blue-200' : 'bg-white/5 border-white/5 text-slate-400'}`} title="Operational Overlay">{showOperationalOverlay ? <Eye size={16}/> : <EyeOff size={16}/>}</button>
                  <select value={scenarioMode} onChange={e => setScenarioMode(e.target.value as any)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-slate-300 outline-none">
                    <option value="all">All</option>
                    <option value="CRITICAL_PATH">Critical Path</option>
                    <option value="PRODUCTION_ONLY">Production</option>
                    <option value="ATTENTION_ONLY">Attention</option>
                  </select>
                  <button onClick={() => setIsReportOpen(true)} className="p-2.5 bg-white/5 hover:bg-fuchsia-500/10 rounded-lg text-slate-400 hover:text-fuchsia-300 transition-all border border-white/5" title="Report Mode"><Printer size={16}/></button>
                  <button onClick={() => setIsPresentationMode((current) => !current)} className={`p-2.5 rounded-lg transition-all border ${isPresentationMode ? 'bg-fuchsia-500 border-fuchsia-400 text-white' : 'bg-white/5 border-white/5 text-slate-400'}`} title="Presentation Mode"><Layout size={16}/></button>
                  <div className="h-6 w-px bg-white/10 mx-1" />
                  <button onClick={() => setConfirmExitIntent('dashboard')} className="px-4 py-2 bg-white/5 hover:bg-rose-600/10 rounded-lg text-slate-400 hover:text-rose-500 transition-all flex items-center gap-2 border border-white/5">
                    <ChevronLeft size={14}/>
                    <span className="text-[9px] font-bold uppercase tracking-widest">Back</span>
                  </button>
                </div>
              </div>
            </div>
            <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[90] pointer-events-none">
              <div className={`glass-panel px-5 py-4 rounded-lg border shadow-xl flex items-center gap-5 ${isPresentationMode ? 'bg-slate-950/88 border-fuchsia-300/15 backdrop-blur-3xl' : 'bg-slate-900/78 border-white/10 backdrop-blur-2xl'}`}>
                <div>
                  <p className="text-[7px] font-bold uppercase tracking-[0.3em] text-slate-500">Owner</p>
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-white">{getFlowMeta(activeFlow, 'owner_team') || 'Unassigned'}</p>
                </div>
                <div>
                  <p className="text-[7px] font-bold uppercase tracking-[0.3em] text-slate-500">Criticality</p>
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-rose-300">{getFlowMeta(activeFlow, 'criticality') || 'Medium'}</p>
                </div>
                <div>
                  <p className="text-[7px] font-bold uppercase tracking-[0.3em] text-slate-500">Review</p>
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-300">{getFlowMeta(activeFlow, 'review_status') || 'Needs Review'}</p>
                </div>
                <div>
                  <p className="text-[7px] font-bold uppercase tracking-[0.3em] text-slate-500">Scenario</p>
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-fuchsia-300">{scenarioMode.replaceAll('_', ' ')}</p>
                </div>
                <div>
                  <p className="text-[7px] font-bold uppercase tracking-[0.3em] text-slate-500">Topology</p>
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-300">{architectureInsights.nodeCount} Nodes / {architectureInsights.edgeCount} Flows</p>
                </div>
                <div className="max-w-[280px]">
                  <p className="text-[7px] font-bold uppercase tracking-[0.3em] text-slate-500">Attention</p>
                  <p className={`text-[10px] font-black uppercase tracking-[0.14em] ${architectureInsights.warnings.length ? 'text-amber-300' : 'text-emerald-300'}`}>
                    {architectureInsights.warnings[0] || 'Governance healthy'}
                  </p>
                </div>
              </div>
            </div>
            {isPresentationMode && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[90] pointer-events-none">
                <div className="glass-panel px-6 py-4 rounded-lg border border-fuchsia-300/30 bg-slate-950/86 backdrop-blur-3xl shadow-[0_22px_60px_rgba(2,6,23,0.55)] pointer-events-auto">
                  <p className="text-[10px] font-black uppercase tracking-[0.42em] text-fuchsia-200">Presentation Mode Active</p>
                  <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-300">Boardroom-safe topology view with executive emphasis.</p>
                </div>
              </div>
            )}

            {!isPresentationMode && !isSidebarOpen && (
              <button onClick={() => setIsSidebarOpen(true)} className="absolute left-0 top-1/2 -translate-y-1/2 z-40 bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white px-1.5 py-8 rounded-lg-xl border border-l-0 border-blue-500/30 transition-all group flex flex-col items-center gap-4">
                <ChevronRight size={14} className="group-hover:scale-125 transition-transform"/>
                <span className="[writing-mode:vertical-lr] text-[8px] font-bold uppercase tracking-[0.3em]">Inventory</span>
              </button>
            )}
            <AnimatePresence>{!isPresentationMode && isSidebarOpen && (
              <motion.div initial={{ x: -400 }} animate={{ x: 0 }} exit={{ x: -400 }} className="w-[360px] border-r border-white/5 bg-[linear-gradient(180deg,rgba(15,23,42,0.97),rgba(2,6,23,0.95))] backdrop-blur-3xl flex flex-col z-50 shadow-[18px_0_70px_rgba(2,6,23,0.45)]">
                 <div className="p-6 border-b border-white/5 flex items-center justify-between"><h2 className="text-lg font-black uppercase text-white tracking-[0.12em] flex items-center gap-3"><Box size={20} className="text-sky-300"/> Inventory</h2><div className="flex items-center gap-1"><button onClick={() => { setInventorySearch(''); setSelectedSystem('All'); }} className="p-2 hover:bg-white/5 rounded-lg text-slate-500 hover:text-white"><RefreshCw size={16}/></button><button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-white/5 rounded-lg text-slate-500 hover:text-white"><X size={18}/></button></div></div>
                 <div className="p-5 border-b border-white/5 space-y-4"><div className="flex bg-black/40 p-1 rounded-lg border border-white/5"><button onClick={() => setInventoryType('INTERNAL')} className={`flex-1 py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all ${inventoryType === 'INTERNAL' ? 'bg-blue-600 text-white' : 'text-slate-500'}`}>Internal</button><button onClick={() => setInventoryType('EXTERNAL')} className={`flex-1 py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all ${inventoryType === 'EXTERNAL' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>External</button></div><div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" /><input value={inventorySearch} onChange={e => setInventorySearch(e.target.value)} placeholder="Search..." className="w-full bg-black/40 border border-white/10 rounded-lg pl-10 pr-4 py-2.5 text-[10px] font-bold text-white outline-none focus:border-blue-500/50" /></div>{inventoryType === 'INTERNAL' && (<select value={selectedSystem} onChange={e => setSelectedSystem(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-[10px] font-bold text-white outline-none focus:border-blue-500">{<option value="all">All Systems</option>}{systems.map(s => <option key={s} value={s}>{s}</option>)}</select>)}</div>
                 <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
                   {inventoryType === 'INTERNAL' ? (
                     <section className="space-y-3">
                       <div className="flex items-center justify-between px-1"><h3 className="text-[9px] font-bold uppercase text-blue-400 tracking-widest">Internal Assets</h3><span className="text-[8px] font-bold text-slate-600 uppercase bg-white/5 px-2 py-0.5 rounded-lg">{filteredAssets.length}</span></div>
                       <div className="grid grid-cols-1 gap-1.5">
                         {filteredAssets.slice(0, 50).map((a: any) => {
                           const isAdded = nodes.some(n => n.id === `device-${a.id}`);
                           const svcCount = a.logical_services?.length || 0;
                           return (
                             <button 
                               key={a.id} 
                               disabled={isAdded}
                               onClick={() => { 
                                 const nodeId = `device-${a.id}`;
                                 setNodes(nds => [...nds, { 
                                   id: nodeId, 
                                   type: 'device', 
                                   position: { x: 400 + (nodes.length * 20), y: 100 + (nodes.length * 20) }, 
                                   data: { ...a, name: a.name || a.hostname, logical_services: [], all_available_services: a.logical_services || [] } 
                                 }]); 
                                 setHasUnsavedChanges(true); 
                               }} 
                               className={`w-full flex items-center justify-between p-3 border rounded-lg group transition-all ${isAdded ? 'bg-emerald-500/5 border-emerald-500/20 opacity-60' : 'bg-white/5 hover:bg-blue-600/10 border-white/5'}`}
                             >
                               <div className="flex flex-col text-left truncate">
                                 <span className={`text-[10px] font-bold uppercase truncate ${isAdded ? 'text-emerald-400' : 'text-slate-300 group-hover:text-white'}`}>
                                   {a.hostname || a.name}
                                 </span>
                                 <div className="flex items-center gap-2 mt-1">
                                   <span className="px-1.5 py-0.5 rounded-lg bg-blue-500/10 text-blue-400 text-[7px] font-bold uppercase">
                                     {svcCount} {svcCount === 1 ? 'Service' : 'Services'}
                                   </span>
                                   {isAdded && <span className="text-[7px] font-bold text-emerald-500 uppercase">Added</span>}
                                 </div>
                               </div>
                               {isAdded ? <CheckCircle2 size={14} className="text-emerald-500 ml-2" /> : <Plus size={14} className="text-slate-600 group-hover:text-blue-500 ml-2" />}
                             </button>
                           );
                         })}
                       </div>
                     </section>
                   ) : (
                     <section className="space-y-3">
                       <div className="flex items-center justify-between px-1"><h3 className="text-[9px] font-bold uppercase text-indigo-400 tracking-widest">External Entities</h3><span className="text-[8px] font-bold text-slate-600 uppercase bg-white/5 px-2 py-0.5 rounded-lg">{filteredExternal.length}</span></div>
                       <div className="grid grid-cols-1 gap-1.5">
                         {filteredExternal.map((e: any) => {
                           const isAdded = nodes.some(n => n.id === `external-${e.id}`);
                           return (
                             <button 
                               key={e.id} 
                               disabled={isAdded}
                               onClick={() => { 
                                 const nodeId = `external-${e.id}`;
                                 setNodes(nds => [...nds, { 
                                   id: nodeId, 
                                   type: 'EXTERNAL', 
                                   position: { x: 400 + (nodes.length * 20), y: 100 + (nodes.length * 20) }, 
                                   data: { ...e, name: e.name } 
                                 }]); 
                                 setHasUnsavedChanges(true); 
                               }} 
                               className={`w-full flex items-center justify-between p-3 border rounded-lg group transition-all ${isAdded ? 'bg-emerald-500/5 border-emerald-500/20 opacity-60' : 'bg-white/5 hover:bg-indigo-600/10 border-white/5'}`}
                             >
                               <div className="flex flex-col text-left truncate">
                                 <span className={`text-[10px] font-bold uppercase truncate ${isAdded ? 'text-emerald-400' : 'text-slate-300 group-hover:text-white'}`}>
                                   {e.name}
                                 </span>
                                 {isAdded && <span className="text-[7px] font-bold text-emerald-500 uppercase mt-1">Added</span>}
                               </div>
                               {isAdded ? <CheckCircle2 size={14} className="text-emerald-500 ml-2" /> : <Plus size={14} className="text-slate-600 group-hover:text-indigo-500 ml-2" />}
                             </button>
                           );
                         })}
                       </div>
                     </section>
                   )}
                 </div>
                 <div className="p-6 border-t border-white/5 bg-black/20"><button onClick={handleSave} disabled={saveMutation.isPending || !hasUnsavedChanges} className={`w-full py-4 rounded-lg flex items-center justify-center space-x-3 shadow-xl transition-all font-bold uppercase text-xs tracking-widest ${hasUnsavedChanges ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-50'}`}>{saveMutation.isPending ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}<span>Commit Changes</span></button></div>
              </motion.div>
            )}</AnimatePresence>
            <div className="flex-1 relative h-full">
               <CanvasDomainBackdrop presentationMode={isPresentationMode} />
               <FocusEmptyState focusNodeId={selectedNodeId} focusEdgeId={selectedEdgeId} presentationMode={isPresentationMode} />
               <ReactFlow 
                nodes={displayNodes} 
                edges={displayEdges} 
                onNodesChange={onNodesChange} 
                onEdgesChange={onEdgesChange} 
                onConnect={onConnect} 
                onNodeClick={(_, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(null); setIsConfigSidebarOpen(true); }} 
                onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); setIsConfigSidebarOpen(true); }} 
                onMoveEnd={(_, viewport) => setEditorViewport(viewport)}
                nodeTypes={nodeTypes} 
                edgeTypes={edgeTypes} 
                fitView 
                maxZoom={1.2}
                snapToGrid 
                snapGrid={[20, 20]} 
                connectionMode={ConnectionMode.Loose}
              >
                 <Background color={isPresentationMode ? "#475569" : "#334155"} gap={20} size={1.15} className={`${isPresentationMode ? 'opacity-55' : 'opacity-40'}`} />
               </ReactFlow>
            </div>
            {!isPresentationMode && !isConfigSidebarOpen && (
              <button onClick={() => setIsConfigSidebarOpen(true)} className="absolute right-0 top-1/2 -translate-y-1/2 z-40 bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white px-1.5 py-8 rounded-lg-xl border border-r-0 border-blue-500/30 transition-all group flex flex-col items-center gap-4">
                <ChevronLeft size={14} className="group-hover:scale-125 transition-transform"/>
                <span className="[writing-mode:vertical-lr] text-[8px] font-bold uppercase tracking-[0.3em] rotate-180">Configuration</span>
              </button>
            )}
            <AnimatePresence>{!isPresentationMode && isConfigSidebarOpen && (<motion.div initial={{ x: 500 }} animate={{ x: 0 }} exit={{ x: 500 }} className="h-full z-50 shadow-3xl"><MissionControl selectedNode={nodes.find(n => n.id === selectedNodeId)} selectedEdge={edges.find(e => e.id === selectedEdgeId)} impactedNodes={impactedNodes} pathAnalysis={pathAnalysis} relatedLinks={relatedLinks} nodeOperationalStatus={nodeOperationalMap.get(selectedNodeId || '')} onBack={() => setIsConfigSidebarOpen(false)} onUpdateNode={updateNodeData} onUpdateEdge={updateEdgeData} onAddServiceToNode={addServiceToNode} onDeleteNode={deleteNode} onDeleteEdge={deleteEdge} availableServices={logicalServices} setIsServiceFlowOpen={setIsServiceFlowOpen}/></motion.div>)}</AnimatePresence>
         </>
       )}
       
       <ConfigModal isOpen={isConfigModalOpen} onClose={() => setIsConfigModalOpen(false)} flow={activeFlow} onSave={(data: any) => { if (!activeFlow?.id) { saveMutation.mutate({ ...data, nodes: [], edges: [] }); } else { setActiveFlow({ ...activeFlow, ...data }); setHasUnsavedChanges(true); } setIsConfigModalOpen(false); }} isNew={!activeFlow?.id} />
       <AnimatePresence>
         {isHistoryOpen && activeFlow && (
           <ArchitectureHistoryPanel
             flow={activeFlow}
             historyEntries={flowHistory || []}
             isOpen={isHistoryOpen}
             onClose={() => setIsHistoryOpen(false)}
             onRestore={(historyId: number) => restoreMutation.mutate(historyId)}
             onApprove={() => approveMutation.mutate()}
           />
         )}
       </AnimatePresence>
       <AnimatePresence>
         {isReportOpen && activeFlow && (
           <ArchitectureReportModal
             flow={activeFlow}
             nodes={nodes}
             edges={edges}
             historyEntries={flowHistory || []}
             relatedLinks={relatedLinks}
             isOpen={isReportOpen}
             onClose={() => setIsReportOpen(false)}
           />
         )}
       </AnimatePresence>
       <AnimatePresence>
         {isServiceFlowOpen && selectedEdgeId && edges.find(e => e.id === selectedEdgeId) && (
           <ServiceLevelFlow 
             edge={edges.find(e => e.id === selectedEdgeId)} 
             sourceNode={nodes.find(n => n.id === (edges.find(e => e.id === selectedEdgeId)?.source))}
             targetNode={nodes.find(n => n.id === (edges.find(e => e.id === selectedEdgeId)?.target))}
             onClose={() => setIsServiceFlowOpen(false)} 
             onSave={(edgeId: string, updatedData: any) => updateEdgeData(edgeId, updatedData)} 
           />
         )}
       </AnimatePresence>
       <ConfirmationModal isOpen={isConfirmExitOpen || !!confirmExitIntent} title="Unsaved Changes" message="Exit and lose modifications?" onConfirm={() => { setView('dashboard'); setHasUnsavedChanges(false); setIsConfirmExitOpen(false); setConfirmExitIntent(null); }} onClose={() => { setIsConfirmExitOpen(false); setConfirmExitIntent(null); }} />
    </div>
  )
}
export default function DataFlowDesigner() { return (<ReactFlowProvider><ArchDesignerInner /></ReactFlowProvider>); }
