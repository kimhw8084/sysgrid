import { WorkspacePointPanel } from './shared/WorkspacePointPanel'
import { useWorkspaceConfirmation } from './shared/useWorkspaceConfirmation'
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { WorkspaceTooltip } from './shared/WorkspaceTooltip'
import { WorkspaceDialogFrame } from './shared/WorkspaceDialogFrame'
import { FormGuide } from './shared/FormGuide'
import { useWorkspaceDialogLayer, useWorkspacePopupDismiss, WORKSPACE_LAYER_Z } from './shared/WorkspaceOverlay'
import { getPointFloatingStyle } from './shared/OperationalGridInteractions'
import { OPERATIONAL_GRID_DEFAULT_COLUMN_DEF } from './shared/OperationalGridContract'
import { getOperationalGridHeaderHeight, getOperationalGridRowHeight } from './shared/OperationalGridSizing'
import { OperationalAgGrid } from './shared/OperationalAgGrid'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Zap, Trash2, Edit2, Search, MapPin, X, ArrowRightLeft, Server,
  Monitor, AlertTriangle, Check, MoreVertical, RefreshCcw,
  Package, BarChart3, ExternalLink, Settings,
  Network, HardDrive, TrendingUp, Layers, List, Upload, Tag, History, Clipboard, Eye, EyeOff, Activity, Terminal, Clock, ChevronLeft, ChevronRight
} from 'lucide-react'
import { motion, AnimatePresence, useMotionValue } from 'framer-motion'
import toast from 'react-hot-toast'
import { apiFetch } from '../api/apiClient'
import { 
  PageHeader, 
  PageToolbar, 
  ToolbarGroup, 
  ToolbarSearch, 
  ToolbarButton, 
  ToolbarIconButton, 
  ToolbarSegmented 
} from './shared/LayoutPrimitives'
import { WorkspaceModal } from './shared/WorkspaceModal'
import { WorkspaceTabStrip, WorkspaceEmptyState, useWorkspaceAnchoredLayer } from './shared/OperationalWorkspacePrimitives'
import { formatAppDate, parseAppDate } from '../utils/dateUtils'
import { BulkImportModal } from './shared/BulkImportModal'
import { ConfirmationModal } from './shared/ConfirmationModal'
import { StyledSelect } from './shared/StyledSelect'
import { ConnectionForensicsModal } from './shared/ConnectionForensicsModal'
import { ConnectionsListModal } from './shared/ConnectionsListModal'
import { ModulePolicyLink } from '../policy/ModulePolicy'
import { resolveOperationalAuditNavigation, resolveOperationalObjectReference } from './shared/OperationalObjectReference'
import { useSearchParams } from 'react-router-dom'
import { fetchRackArray, RackDataState } from './racksDataState'
import { getRackUnitStatusKey } from './rackVisualState'

// ─── Constants & Helpers ──────────────────────────────────────────────────────

const highlightAnimation = `
  @keyframes highlight-glow {
    0% { box-shadow: 0 0 0px #f59e0b; background-color: rgba(245, 158, 11, 0.2); }
    50% { box-shadow: 0 0 15px #f59e0b; background-color: rgba(245, 158, 11, 0.4); }
    100% { box-shadow: 0 0 0px #f59e0b; background-color: rgba(245, 158, 11, 0.2); }
  }
  .search-highlight {
    animation: highlight-glow 1.5s infinite;
    z-index: 10;
    border: 1px solid #f59e0b !important;
  }
`

const STATUS_CONFIG: Record<string, { color: string; dot: string; badge: string }> = {
  Active:        { color: 'text-[var(--rack-active-ink)]', dot: 'bg-[var(--rack-active-accent)]', badge: 'bg-[var(--rack-active-bg)] text-[var(--rack-active-ink)] border-[var(--rack-active-border)]' },
  Maintenance:   { color: 'text-[var(--rack-maintenance-ink)]', dot: 'bg-[var(--rack-maintenance-accent)]', badge: 'bg-[var(--rack-maintenance-bg)] text-[var(--rack-maintenance-ink)] border-[var(--rack-maintenance-border)]' },
  Decommissioned:{ color: 'text-[var(--rack-retired-ink)]', dot: 'bg-[var(--rack-retired-accent)]', badge: 'bg-[var(--rack-retired-bg)] text-[var(--rack-retired-ink)] border-[var(--rack-retired-border)]' },
  Offline:       { color: 'text-[var(--rack-offline-ink)]', dot: 'bg-[var(--rack-offline-accent)]', badge: 'bg-[var(--rack-offline-bg)] text-[var(--rack-offline-ink)] border-[var(--rack-offline-border)]' },
  Standby:       { color: 'text-[var(--rack-standby-ink)]', dot: 'bg-[var(--rack-standby-accent)]', badge: 'bg-[var(--rack-standby-bg)] text-[var(--rack-standby-ink)] border-[var(--rack-standby-border)]' },
  Reserved:      { color: 'text-[var(--rack-reserved-ink)]', dot: 'bg-[var(--rack-reserved-accent)]', badge: 'bg-[var(--rack-reserved-bg)] text-[var(--rack-reserved-ink)] border-[var(--rack-reserved-border)]' },
}

const TYPE_CONFIG: Record<string, { color: string; short: string; tone: string }> = {
  physical: { color: 'text-[var(--rack-type-physical)]', short: 'PHY', tone: 'physical' },
  virtual:  { color: 'text-[var(--rack-type-virtual)]', short: 'VM', tone: 'virtual' },
  storage:  { color: 'text-[var(--rack-type-storage)]', short: 'STO', tone: 'storage' },
  switch:   { color: 'text-[var(--rack-type-switch)]', short: 'NET', tone: 'switch' },
  server:   { color: 'text-[var(--rack-type-server)]', short: 'SRV', tone: 'server' },
}

const getStatusCfg = (s: string, isReservation?: boolean) => {
  if (isReservation) return STATUS_CONFIG['Reserved']
  return STATUS_CONFIG[s] ?? STATUS_CONFIG['Offline']
}
const getTypeCfg = (t: string) => TYPE_CONFIG[t?.toLowerCase()] ?? { color: 'text-[var(--text-secondary)]', short: t?.slice(0,3).toUpperCase() || 'UNK', tone: 'unknown' }
const RACK_CARD_GAP = 16
const RACK_GROUP_GAP = 32

const fillColor = (pct: number) => {
  if (pct >= 110) return 'bg-rose-600 shadow-[0_0_15px_rgba(225,29,72,0.8)]'
  if (pct >= 100) return 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]'
  if (pct >= 90) return 'bg-rose-500'
  if (pct >= 70) return 'bg-amber-500'
  if (pct >= 50) return 'bg-blue-500'
  return 'bg-emerald-500'
}

const powerColor = (pct: number) => {
  if (pct >= 110) return 'bg-rose-600 shadow-[0_0_15px_rgba(225,29,72,0.8)]'
  if (pct >= 100) return 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]'
  if (pct >= 90) return 'bg-rose-500'
  if (pct >= 75) return 'bg-amber-500'
  return 'bg-sky-400'
}

const getVirtualPlacementConflict = ({
  racks,
  rackId,
  deviceId,
  startUnit,
  sizeU,
  excludeDeviceId
}: {
  racks: any[]
  rackId: number
  deviceId?: number | string | null
  startUnit: number
  sizeU: number
  excludeDeviceId?: number | string | null
}) => {
  const targetRack = racks.find((rack: any) => rack.id === rackId)
  if (!targetRack) return 'Target rack not found in plan'

  const normalizedSize = Number(sizeU) || 1
  const normalizedStart = Number(startUnit) || 1
  const newEnd = normalizedStart + normalizedSize - 1

  if (newEnd > (targetRack.total_u || 42)) {
    return `RACK_OVERFLOW: Device exceeds max U height of ${targetRack.total_u || 42}`
  }

  const conflict = (targetRack.device_locations || []).find((loc: any) => {
    if (excludeDeviceId && String(loc.device_id) === String(excludeDeviceId)) return false
    if (deviceId && String(loc.device_id) === String(deviceId)) return false
    const locStart = Number(loc.start_unit ?? loc.u_start) || 1
    const locEnd = locStart + (Number(loc.size_u) || 1) - 1
    return !(newEnd < locStart || normalizedStart > locEnd)
  })

  if (conflict) {
    const conflictStart = Number(conflict.start_unit ?? conflict.u_start) || 1
    return `Collision with ${conflict.device?.name || 'existing device'} at U${conflictStart}`
  }

  return null
}

// ─── Status Breathing Bar ────────────────────────────────────────────────────

const RackStatusBar = ({ rack, siteColor }: { rack: any; siteColor?: string }) => {
  // Use siteColor if provided, otherwise default to emerald
  // Strict mandate: Site color only, no status indicators.
  const style = { backgroundColor: siteColor || '#10b981' }

  return (
    <div className="absolute top-0 inset-x-0 h-2 z-30 flex">
      <div 
        className="h-full w-full shadow-[0_0_10px_rgba(0,0,0,0.5)]" 
        style={style}
      />
    </div>
  )
}

// ─── Power / Fill Mini Bar ─────────────────────────────────────────────────────

const MiniBar = ({ value, max, colorFn, label, unit, overflowLabel = 'CAPACITY ALERT' }: { value: number; max: number; colorFn: (p: number) => string; label: string; unit: string; overflowLabel?: string }) => {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  const isOverflow = pct >= 100
  
  return (
    <div className="space-y-0.5 group/bar relative">
      <div className="flex justify-between items-center">
        <span className={`text-[11px] font-medium ${isOverflow ? 'text-[var(--state-danger)]' : 'text-[var(--text-secondary)]'}`}>
          {label} {isOverflow && <span className="text-[6px] font-black ml-1">[{overflowLabel}]</span>}
        </span>
        <span className={`text-[11px] font-semibold tabular-nums transition-colors ${isOverflow ? 'text-[var(--state-danger)]' : 'text-[var(--text-primary)]'}`}>
          {value.toFixed(1)}<span className="text-[var(--text-secondary)] font-normal">/{max}{unit}</span>
        </span>
      </div>
      <div className={`h-1.5 bg-[var(--grid-border)] rounded-lg overflow-hidden relative ${isOverflow ? 'ring-1 ring-rose-500/50' : ''}`}>
        <div
          className={`h-full rounded-lg transition-all duration-700 ease-out ${colorFn(pct)}`} 
          style={{ width: `${Math.min(pct, 100)}%` }} 
        />
      </div>
    </div>
  )
}

// ─── PDU Bar ───────────────────────────────────────────────────────────

const PduBar = ({ side, name, capacity, onClick }: { side: 'A' | 'B'; name?: string; capacity?: number; onClick?: () => void }) => {
  const hasPdu = !!name && name !== 'None'
  return (
    <WorkspaceTooltip
      className={`absolute ${side === 'A' ? 'left-1' : 'right-1'} top-1 bottom-1 w-2.5 rounded-lg bg-slate-900 border border-white/10 cursor-pointer hover:bg-slate-800 transition-all z-20 group/pdu ${!hasPdu ? 'opacity-30 grayscale' : ''}`}
      content={<><p className="font-semibold">{name || `PDU-${side}`}</p>
        <p className="mt-2">Configured capacity: {typeof capacity === 'number' ? `${capacity}kW` : 'Not set'}</p>
        <p className="mt-2 text-[var(--state-warning)]">Live PDU load telemetry unavailable</p>
        <p className="mt-1 text-[var(--text-secondary)]">Click to configure mapping</p></>}>
      <button type="button" onClick={onClick} aria-label={`Configure PDU ${side}`} className="flex h-full w-full flex-col items-center justify-around py-4">
        {Array.from({ length: 14 }).map((_, i) => <span key={i} className={`w-1.5 h-1 rounded-lg ${!hasPdu ? 'bg-slate-700' : 'bg-slate-500/70'}`} />)}
      </button>
    </WorkspaceTooltip>
  )
}

// ─── Device Options Menu ───────────────────────────────────────────────────────

const DeviceOptionsMenu = ({ x, y, onClose, onShowConnections, onEdit, onDelete, onPatch, deviceName }: any) => {
  const menuRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLElement | null>(document.activeElement as HTMLElement)
  const [position, setPosition] = React.useState<React.CSSProperties>({})
  useWorkspacePopupDismiss(true, triggerRef, menuRef, onClose)
  React.useLayoutEffect(() => {
    const place = () => setPosition(getPointFloatingStyle({
      x, y, width: 216, height: menuRef.current?.scrollHeight || 220, zIndex: WORKSPACE_LAYER_Z.rowActionMenu,
    }))
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [x, y])

  return createPortal(
    <>

      <motion.div
        ref={menuRef}
        initial={{ opacity: 0, scale: 0.95, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -10 }}
        style={position}
        data-workspace-panel="true"
        aria-label={`Asset actions for ${deviceName}`}
        className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] shadow-xl overflow-auto p-1.5"
      >
        <div className="px-3 py-2 border-b border-white/5 mb-1">
          <p className="text-[10px] font-black text-white uppercase tracking-tighter truncate">{deviceName}</p>
        </div>
        
        <button onClick={() => { onShowConnections(); onClose(); }} className="w-full text-left px-3 py-2.5 text-[9px] font-black uppercase text-blue-400 hover:bg-blue-500/10 hover:text-blue-300 rounded-lg flex items-center gap-3 transition-all group">
          <div className="p-1.5 rounded-lg bg-blue-500/10 group-hover:bg-blue-500/20 transition-colors">
            <Zap size={12} />
          </div>
          Show Connections
        </button>

        <button onClick={() => { onEdit(); onClose(); }} className="w-full text-left px-3 py-2.5 text-[9px] font-black uppercase text-slate-400 hover:bg-white/5 hover:text-white rounded-lg flex items-center gap-3 transition-all group">
          <div className="p-1.5 rounded-lg bg-white/5 group-hover:bg-white/10 transition-colors">
            <Edit2 size={12} />
          </div>
          Edit Asset
        </button>
        
        <div className="h-px bg-white/5 my-1" />
        
        <button onClick={() => { onDelete(); onClose(); }} className="w-full text-left px-3 py-2.5 text-[9px] font-black uppercase text-rose-500 hover:bg-rose-500/10 rounded-lg flex items-center gap-3 transition-all group">
          <div className="p-1.5 rounded-lg bg-rose-500/10 group-hover:bg-rose-500/20 transition-colors">
            <Trash2 size={12} />
          </div>
          Delete
        </button>
      </motion.div>
    </>, document.body
  )
}

// ─── Connection Lines Overlay ──────────────────────────────────────────────────

const ConnectionLines = ({ sourceDeviceId, targetDeviceIds, racks, connections, devices, onLineClick }: { sourceDeviceId: number; targetDeviceIds: number[]; racks: any[]; connections?: any[]; devices?: any[]; onLineClick?: (conn: any) => void }) => {
  const [lines, setLines] = React.useState<any[]>([])
  const [hoveredLine, setHoveredLine] = React.useState<any>(null)
  const hoverLeave = useRef<ReturnType<typeof setTimeout>>()
  const scheduleHoverClose = () => { hoverLeave.current = setTimeout(() => setHoveredLine(null), 120) }
  useEffect(() => () => clearTimeout(hoverLeave.current), [])
  const [containerStyle, setContainerStyle] = React.useState({ width: '100%', height: '100%' })
  const requestRef = React.useRef<number | null>(null)

  const updateLines = React.useCallback(() => {
    const gridEl = document.getElementById('racks-grid')
    if (!gridEl) {
      requestRef.current = requestAnimationFrame(updateLines)
      return
    }
    const gridRect = gridEl.getBoundingClientRect()
    
    if (gridEl.scrollWidth !== 0) {
      setContainerStyle({ width: `${gridEl.scrollWidth}px`, height: `${gridEl.scrollHeight}px` })
    }

    const getPoints = (deviceId: number) => {
      const elements = document.querySelectorAll(`[data-device-id="${deviceId}"]`)
      const points: any[] = []

      elements.forEach(el => {
        const htmlEl = el as HTMLElement
        const elRect = htmlEl.getBoundingClientRect()
        const x = elRect.left + elRect.width / 2 - gridRect.left + gridEl.scrollLeft
        const y = elRect.top + elRect.height / 2 - gridRect.top + gridEl.scrollTop
        let isScrolledOut = false
        const rackScrollEl = htmlEl.closest('.overflow-y-auto')
        if (rackScrollEl) {
          const scrollRect = rackScrollEl.getBoundingClientRect()
          if (elRect.bottom < (scrollRect.top + 2) || elRect.top > (scrollRect.bottom - 2)) isScrolledOut = true
        }
        points.push({ x, y, elRect, isScrolledOut })
      })
      return points
    }

    const sourcePoints = getPoints(sourceDeviceId)
    if (sourcePoints.length === 0) {
      if (lines.length > 0) setLines([])
      requestRef.current = requestAnimationFrame(updateLines)
      return
    }

    const newLines: any[] = []
    const processedPairs = new Set<string>()

    sourcePoints.forEach(sourcePoint => {
      targetDeviceIds.forEach((tid, index) => {
        const targetPoints = getPoints(tid)
        targetPoints.forEach(targetPoint => {
          // Avoid duplicate lines for the same pair of coordinates
          const pairKey = `${sourcePoint.x}-${sourcePoint.y}-${targetPoint.x}-${targetPoint.y}`
          if (processedPairs.has(pairKey)) return
          processedPairs.add(pairKey)

          const isSameRack = Math.abs(sourcePoint.x - targetPoint.x) < 30
          const conn = connections?.find((c: any) =>
            (c.source_device_id === sourceDeviceId && c.target_device_id === tid) ||
            (c.source_device_id === tid && c.target_device_id === sourceDeviceId)
          )

          if (isSameRack) {          // Internal rack connection: keep it inside the rack width
            // Reduce offset to keep lines within the rack body (px-6 padding gives us room)
            const offset = ((index % 2 === 0 ? 1 : -1) * (10 + Math.floor(index / 2) * 4))
            newLines.push({ 
              x1: sourcePoint.x, y1: sourcePoint.y, 
              x2: targetPoint.x, y2: targetPoint.y, 
              isInternal: true, 
              offset, 
              id: pairKey, 
              connection: conn, 
              isScrolledOut: sourcePoint.isScrolledOut || targetPoint.isScrolledOut 
            })
          } else {
            newLines.push({ 
              x1: sourcePoint.x, y1: sourcePoint.y, 
              x2: targetPoint.x, y2: targetPoint.y, 
              isInternal: false, 
              id: pairKey, 
              connection: conn, 
              isScrolledOut: sourcePoint.isScrolledOut || targetPoint.isScrolledOut 
            })
          }
        })
      })
    })
    setLines(newLines)
    requestRef.current = requestAnimationFrame(updateLines)
  }, [sourceDeviceId, targetDeviceIds, connections, racks, devices, lines.length])

  React.useEffect(() => {
    requestRef.current = requestAnimationFrame(updateLines)
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current) }
  }, [updateLines])

  return (
    <div className="absolute top-0 left-0 pointer-events-none z-[25]" style={containerStyle}>
      <svg className="w-full h-full">
        <defs>
          <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        {lines.map((l, i) => {
          const path = l.isInternal 
            ? `M ${l.x1} ${l.y1} L ${l.x1 + l.offset} ${l.y1} L ${l.x1 + l.offset} ${l.y2} L ${l.x2} ${l.y2}`
            : `M ${l.x1} ${l.y1} L ${l.x2} ${l.y2}`

            return (
            <g key={l.id || i} className={`pointer-events-auto cursor-pointer group ${(l.isScrolledOut && !l.isInternal) ? 'opacity-20' : 'opacity-100'}`} 
               onMouseEnter={(e) => { clearTimeout(hoverLeave.current); setHoveredLine({ ...l, mouseX: e.clientX, mouseY: e.clientY }) }}
               onMouseLeave={scheduleHoverClose}
               onClick={() => l.connection && onLineClick?.(l.connection)}>
              <path d={path} fill="none" stroke="#3b82f6" strokeWidth="8" strokeOpacity="0" />
              <path
                d={path} fill="none" stroke="#3b82f6" strokeWidth="2.5" filter="url(#lineGlow)"
                strokeLinecap="round" strokeLinejoin="round" 
                className={`group-hover:stroke-blue-400 group-hover:stroke-[4px] transition-all ${(l.isScrolledOut && !l.isInternal) ? 'stroke-dash-4' : ''}`}
                strokeDasharray={(l.isScrolledOut && !l.isInternal) ? "8 8" : "none"}
              />
              <path
                d={path} fill="none" stroke="#60a5fa" strokeWidth="1" strokeOpacity="0.8"
                strokeLinecap="round" strokeLinejoin="round"
              />
              {(!l.isScrolledOut || l.isInternal) && (
                <>
                  <circle cx={l.x1} cy={l.y1} r="4" fill="#ffffff" filter="url(#lineGlow)" />
                  <circle cx={l.x2} cy={l.y2} r="4" fill="#ffffff" filter="url(#lineGlow)" />
                </>
              )}
            </g>
          )
        })}
      </svg>

      <AnimatePresence>
        {hoveredLine && hoveredLine.connection && (
          <WorkspacePointPanel x={hoveredLine.mouseX} y={hoveredLine.mouseY} onMouseEnter={() => clearTimeout(hoverLeave.current)} onMouseLeave={scheduleHoverClose}>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 bg-blue-500/20 rounded-lg">
                <Network size={12} className="text-blue-400" />
              </div>
              <span className="text-[10px] font-black text-white uppercase tracking-tight">Connection Detail</span>
            </div>
            <div className="space-y-1.5">
              {(() => {
                const sDev = devices?.find(d => d.id === hoveredLine.connection.source_device_id)
                const tDev = devices?.find(d => d.id === hoveredLine.connection.target_device_id)
                return (
                  <div className="flex flex-col gap-1 border-b border-white/5 pb-1.5 mb-1.5">
                    <div className="flex justify-between items-center gap-2">
                      <div className="flex flex-col">
                        <span className="text-[8px] text-blue-400 font-bold uppercase truncate max-w-[90px]">{sDev?.name}</span>
                        <span className="text-[7px] text-slate-500 font-bold uppercase">R:{hoveredLine.connection.src_rack || 'N/A'} U:{hoveredLine.connection.src_slot || 'N/A'}</span>
                      </div>
                      <span className="text-[8px] text-slate-500 font-mono">{hoveredLine.connection.source_ip || 'No IP'}</span>
                    </div>
                    <div className="flex justify-between items-center gap-2 mt-1">
                      <div className="flex flex-col">
                        <span className="text-[8px] text-emerald-400 font-bold uppercase truncate max-w-[90px]">{tDev?.name}</span>
                        <span className="text-[7px] text-slate-500 font-bold uppercase">R:{hoveredLine.connection.peer_rack || 'N/A'} U:{hoveredLine.connection.peer_slot || 'N/A'}</span>
                      </div>
                      <span className="text-[8px] text-slate-500 font-mono">{hoveredLine.connection.target_ip || 'No IP'}</span>
                    </div>
                  </div>
                )
              })()}
              
              <div className="grid grid-cols-2 gap-2 mb-1.5">
                <div className="bg-white/5 rounded-lg px-2 py-1 border border-white/5">
                  <p className="text-[6px] text-slate-500 font-black uppercase mb-0.5">FARM</p>
                  <p className="text-[8px] text-indigo-400 font-bold truncate">{hoveredLine.connection.farm || 'N/A'}</p>
                </div>
                <div className="bg-white/5 rounded-lg px-2 py-1 border border-white/5">
                  <p className="text-[6px] text-slate-500 font-black uppercase mb-0.5">STATUS</p>
                  <p className="text-[8px] text-emerald-400 font-bold truncate">{hoveredLine.connection.status || 'Active'}</p>
                </div>
              </div>

              {hoveredLine.connection.purpose && (
                <div className="bg-black/20 rounded-lg px-2 py-1 border border-white/5 mb-1.5">
                  <p className="text-[7px] text-slate-500 font-black uppercase mb-0.5">PURPOSE</p>
                  <p className="text-[8px] text-slate-300 ">{hoveredLine.connection.purpose}</p>
                </div>
              )}
              
              <div className="flex justify-between items-center gap-4">
                <span className="text-[7px] text-slate-500 font-bold uppercase">Source Port</span>
                <span className="text-[9px] text-blue-300 font-mono">{hoveredLine.connection.source_port || 'Auto'}</span>
              </div>
              <div className="flex justify-between items-center gap-4">
                <span className="text-[7px] text-slate-500 font-bold uppercase">Target Port</span>
                <span className="text-[9px] text-blue-300 font-mono">{hoveredLine.connection.target_port || 'Auto'}</span>
              </div>
              <div className="flex justify-between items-center gap-4">
                <span className="text-[7px] text-slate-500 font-bold uppercase">Speed</span>
                <span className="text-[9px] text-emerald-400 font-bold">{hoveredLine.connection.speed_gbps || '10'} Gbps</span>
              </div>
              
              {hoveredLine.connection.request_link && (
                <div className="pt-1 border-t border-white/5 mt-1">
                  <span className="text-[7px] text-blue-400 font-bold uppercase italic underline">Request Linked</span>
                </div>
              )}
            </div>
          </WorkspacePointPanel>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Rack Unit Row ─────────────────────────────────────────────────────────────

interface RackUnitProps {
  uNumber: number
  loc?: any
  isTop?: boolean
  isBottom?: boolean
  highlight: boolean
  onSelect: () => void
  onManage: (device: any, loc: any, event: React.MouseEvent) => void
  isDeleted: boolean
  isFocused?: boolean
  isConnected?: boolean
  diffMode?: boolean
  liveLoc?: any
}

const RackUnit = ({ uNumber, loc, isTop, isBottom, highlight, onSelect, onManage, isDeleted, isFocused, isConnected, diffMode, liveLoc }: RackUnitProps) => {
  const device = loc?.device
  const isReservation = device?.is_reservation
  const statusCfg = device ? getStatusCfg(device.status, isReservation) : null
  const typeCfg = device ? getTypeCfg(device.type) : null

  const isDiff = diffMode && (
    (loc?.device_id !== liveLoc?.device_id) || 
    (loc?.orientation !== liveLoc?.orientation) ||
    (loc?.size_u !== liveLoc?.size_u)
  )

  const rackState = getRackUnitStatusKey(device)
  const liveDevice = liveLoc?.device
  const rackUnitTitle = device
    ? `${device.name} · ${isReservation ? 'Reserved' : device.status || 'Unknown'} · U${loc.start_unit}${loc.size_u > 1 ? `–U${loc.start_unit + loc.size_u - 1}` : ''} · ${loc.orientation || 'Front'}`
    : `Mount or reserve at U${uNumber}`

  return (
    <div
      className="rack-unit"
      data-device-id={device?.id}
      data-u={uNumber}
      data-rack-state={rackState}
      data-has-device={device ? 'true' : 'false'}
      data-rack-block-top={isTop ? 'true' : 'false'}
      data-rack-block-bottom={isBottom ? 'true' : 'false'}
      data-rack-selected={isFocused ? 'true' : 'false'}
      data-rack-connected={isConnected ? 'true' : 'false'}
      data-rack-diff={isDiff ? 'true' : 'false'}
      data-rack-match={highlight ? 'true' : 'false'}
    >
      <button
        type="button"
        disabled={isDeleted}
        aria-label={`Select rack unit U${uNumber}`}
        aria-pressed={Boolean(isFocused)}
        title={`Select U${uNumber}`}
        onClick={(event) => { event.stopPropagation(); onSelect() }}
        className="rack-unit-number"
      >
        {uNumber}
      </button>

      <button
        type="button"
        disabled={isDeleted}
        aria-label={device ? `Open ${device.name}, ${isReservation ? 'Reserved' : device.status || 'Unknown'}, U${loc.start_unit}${loc.size_u > 1 ? ` through U${loc.start_unit + loc.size_u - 1}` : ''}` : `Mount or reserve at U${uNumber}`}
        title={rackUnitTitle}
        onClick={(event) => {
          event.stopPropagation()
          if (device) onManage(device, loc, event)
          else onSelect()
        }}
        className="rack-unit-body"
      >
        {isBottom && device && (
          <span className="rack-unit-device">
            <span className="rack-unit-identity">
              <span aria-hidden="true" className={`rack-unit-status-dot ${statusCfg?.dot}`} />
              <span className="rack-unit-name-wrap">
                <span className="rack-unit-device-name">
                  {device.name}
                  {isDiff && <span className="rack-unit-diff-label">Changed</span>}
                </span>
                {isReservation && device.reservation_info?.poc && (
                  <span className="rack-unit-reservation">
                    RES: {device.reservation_info.poc} {device.reservation_info.est_date && `· ${device.reservation_info.est_date}`}
                  </span>
                )}
              </span>
            </span>
            <span className="rack-unit-meta">
              {loc?.size_u > 1 && (
                <span className="rack-unit-size">{loc.size_u}U</span>
              )}
              <span className="rack-unit-type-badge" data-rack-type={typeCfg?.tone}>
                {typeCfg?.short}
              </span>
              {loc.orientation === 'Back' && (
                <span className="rack-unit-rear">REAR</span>
              )}
            </span>
          </span>
        )}

        {!device && isDiff && liveLoc && (
          <span className="rack-unit-removed">Removed from live · {liveDevice?.name || `U${uNumber}`}</span>
        )}

        {!device && !isDiff && (
          <span className="rack-unit-empty-prompt"><Plus size={11} /> Add equipment</span>
        )}
      </button>
    </div>
  )
}

// ─── Forensic Control Center (Rack Evolution Logs) ───────────────────────────

const AuditLogModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const [selectedLog, setSelectedLog] = useState<any>(null)
  const [quickSearch, setQuickSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('All Vectors')
  const gridRef = React.useRef<any>(null)

  const auditQuery = useQuery({
    queryKey: ['rack-audit-logs'],
    queryFn: () => fetchRackArray('/api/v1/racks/audit-logs'),
    enabled: isOpen
  })
  const logs = auditQuery.data

  // Real-time Statistics
  const stats = useMemo(() => {
    if (!logs) return { total: 0, distinctAdmins: 0, mountOps: 0, migrations: 0 }
    return {
      total: logs.length,
      distinctAdmins: new Set(logs.map((l: any) => l.user_id)).size,
      mountOps: logs.filter((l: any) => l.action === 'MOUNT' || l.action === 'UNMOUNT').length,
      migrations: logs.filter((l: any) => l.action === 'MOVE' || l.action === 'BULK_RELOCATE').length
    }
  }, [logs])

  // Functional Filtering logic
  const filteredLogs = useMemo(() => {
    if (!logs) return []
    let result = logs
    
    if (activeCategory === 'Mount Ops') {
      result = logs.filter((l: any) => l.action === 'MOUNT' || l.action === 'UNMOUNT')
    } else if (activeCategory === 'Logical Migrations') {
      result = logs.filter((l: any) => l.action === 'MOVE' || l.action === 'BULK_RELOCATE' || l.action === 'REORDER')
    } else if (activeCategory === 'State Deletions') {
      result = logs.filter((l: any) => l.action === 'SOFT_DELETE' || l.action === 'BULK_DELETE' || l.action === 'BULK_PURGE')
    }

    return result
  }, [logs, activeCategory])

  const columnDefs = useMemo(() => [
    { 
      field: 'timestamp', 
      headerName: 'TX_TIME', 
      width: 160, 
      sortable: true, 
      filter: 'agDateColumnFilter',
      cellClass: 'text-center font-bold text-blue-400',
      cellRenderer: (p: any) => (
        <div className="flex items-center gap-2 justify-center">
          <Clock size={10} className="opacity-40" />
          <span>{formatAppDate(p.value)}</span>
        </div>
      )
    },
    { 
      field: 'action', 
      headerName: 'OP_CODE', 
      width: 100,
      cellClass: 'text-center',
      cellRenderer: (p: any) => (
        <div className={`px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-widest ${
          p.value === 'MOUNT' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
          p.value === 'UNMOUNT' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
          p.value === 'MOVE' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' :
          p.value === 'UPDATE' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
          'bg-slate-500/10 text-slate-400 border border-slate-500/20'
        }`}>
          {p.value}
        </div>
      )
    },
    { field: 'user_id', headerName: 'ADMIN', width: 110, cellClass: 'text-center font-black text-white uppercase tracking-tighter' },
    { field: 'description', headerName: 'TRANSACTION_DETAILS', flex: 1, cellClass: 'font-bold text-slate-300 px-4' },
  ], [])

  // Human Readable Diff Engine
  const DiffViewer = ({ changes }: { changes: any }) => {
    if (!changes || typeof changes !== 'object') return null
    
    // Filter out internal fields
    const keys = Object.keys(changes).filter(k => k !== 'id' && k !== 'timestamp')
    
    return (
      <div className="space-y-1.5">
        {keys.map(key => {
          const val = changes[key]
          const isObject = val && typeof val === 'object' && !Array.isArray(val)
          const isOldNew = isObject && 'old' in val && 'new' in val

          return (
            <div key={key} className="grid grid-cols-12 gap-2 text-[10px] items-center py-1 border-b border-white/[0.03]">
              <div className="col-span-3 font-black text-slate-500 uppercase tracking-widest truncate">{key}</div>
              <div className="col-span-9 flex items-center gap-2">
                {isOldNew ? (
                  <>
                    <span className="text-rose-400/80 line-through truncate max-w-[120px]">{String(val.old)}</span>
                    <ArrowRightLeft size={10} className="text-slate-600 shrink-0" />
                    <span className="text-emerald-400 font-black truncate">{String(val.new)}</span>
                  </>
                ) : (
                  <span className="text-blue-400 font-bold truncate">{JSON.stringify(val)}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <WorkspaceDialogFrame title="Rack audit log" onClose={onClose}>
          <motion.div 
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="glass-panel w-full max-w-6xl h-[85vh] rounded-lg border border-white/10 shadow-[0_50px_100px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col"
          >
            {/* Mission Control Bar */}
            <div className="h-20 bg-white/[0.02] border-b border-white/5 px-10 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-8">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-indigo-600 rounded-lg shadow-2xl shadow-indigo-600/20 flex items-center justify-center text-white">
                    <Activity size={24} />
                  </div>
                  <div>
                    <h1 className="text-2xl font-black uppercase tracking-tighter text-white leading-none">Forensic Control</h1>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-2 flex items-center gap-2">
                      <Zap size={10} className="text-blue-500" /> Rack Evolution Immutable Ledger v5.0
                    </p>
                  </div>
                </div>

                <div className="h-10 w-px bg-white/5 mx-2" />

                <div className="relative group">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors" size={16} />
                  <input 
                    type="text" 
                    value={quickSearch}
                    onChange={e => {
                      setQuickSearch(e.target.value)
                      gridRef.current?.api?.setQuickFilter(e.target.value)
                    }}
                    placeholder="SCAN TRANSACTION MATRIX..." 
                    className="bg-black/40 border border-white/5 rounded-lg pl-12 pr-6 py-3 text-[11px] font-black uppercase tracking-widest text-white outline-none focus:border-blue-500/30 focus:bg-white/[0.08] transition-all min-w-[350px]"
                  />
                </div>
              </div>

              <button onClick={onClose} className="p-3 hover:bg-rose-500/10 text-slate-500 hover:text-rose-500 rounded-lg transition-all">
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 flex min-h-0 bg-slate-950/40">
              {/* Sidebar: Analytics & Filters */}
              <div className="w-72 bg-black/20 border-r border-white/5 p-8 flex flex-col gap-10 overflow-y-auto custom-scrollbar shrink-0">
                <section>
                  <h3 className="text-[9px] font-black text-slate-500 uppercase tracking-[0.3em] mb-6">TX Stream Vectors</h3>
                  <div className="space-y-2">
                    {['All Vectors', 'Mount Ops', 'Logical Migrations', 'State Deletions'].map(f => (
                      <button 
                        key={f} 
                        onClick={() => setActiveCategory(f)}
                        className={`w-full text-left px-4 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all ${activeCategory === f ? 'bg-indigo-600 border-indigo-500 text-white shadow-xl shadow-indigo-600/20' : 'border-white/5 text-slate-500 hover:border-white/20 hover:bg-white/5'}`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </section>

                <section>
                  <h3 className="text-[9px] font-black text-slate-500 uppercase tracking-[0.3em] mb-6">Integrity Metrics</h3>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="p-4 bg-white/5 rounded-lg border border-white/5 group hover:border-blue-500/30 transition-all">
                      <div className="flex justify-between items-center mb-1">
                        <p className="text-[8px] font-black text-slate-500 uppercase">Total TX</p>
                        <Layers size={10} className="text-blue-500 opacity-50" />
                      </div>
                      <p className="text-2xl font-black text-white">{logs ? stats.total : '—'}</p>
                    </div>
                    <div className="p-4 bg-white/5 rounded-lg border border-white/5 group hover:border-emerald-500/30 transition-all">
                      <div className="flex justify-between items-center mb-1">
                        <p className="text-[8px] font-black text-slate-500 uppercase">Administrators</p>
                        <Zap size={10} className="text-emerald-500 opacity-50" />
                      </div>
                      <p className="text-2xl font-black text-white">{logs ? stats.distinctAdmins : '—'}</p>
                    </div>
                    <div className="p-4 bg-white/5 rounded-lg border border-white/5">
                      <div className="flex justify-between items-center mb-1">
                        <p className="text-[8px] font-black text-slate-500 uppercase">Mount / Unmount</p>
                      </div>
                      <p className="text-lg font-black text-indigo-400">{logs ? stats.mountOps : '—'}</p>
                    </div>
                  </div>
                </section>
                
                <div className="mt-auto pt-6 border-t border-white/5">
                   <p className="text-[8px] font-bold text-slate-600 uppercase tracking-widest text-center italic">
                      Data integrity verified via<br/>immutable SHA-256 ledger
                   </p>
                </div>
              </div>

              {/* Main Ledger Content */}
              <div className="flex-1 flex flex-col min-w-0 bg-black/20">
                <RackDataState
                  label="Rack audit history"
                  isError={auditQuery.isError && Boolean(logs)}
                  isFetching={auditQuery.isFetching}
                  hasData={Boolean(logs)}
                  onRetry={() => void auditQuery.refetch()}
                />
                <div className="flex-1 relative ag-theme-alpine-dark" style={{ '--operational-grid-font-size': '11px' } as React.CSSProperties}>
                  {!logs && (auditQuery.isLoading || auditQuery.isError) ? (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/80 p-8 backdrop-blur-sm">
                      <RackDataState
                        label="Rack audit history"
                        isLoading={auditQuery.isLoading}
                        isError={auditQuery.isError}
                        isFetching={auditQuery.isFetching}
                        onRetry={() => void auditQuery.refetch()}
                      />
                    </div>
                  ) : (
                    <OperationalAgGrid
                      ref={gridRef}
                      rowData={filteredLogs}
                      columnDefs={columnDefs}
                      onRowClicked={p => setSelectedLog(p.data)}
                      defaultColDef={OPERATIONAL_GRID_DEFAULT_COLUMN_DEF}
                      animateRows={true}
                      pagination={true}
                      paginationPageSize={100}
                      headerHeight={getOperationalGridHeaderHeight()}
                      rowHeight={getOperationalGridRowHeight()}
                    />
                  )}
                </div>

                {/* Bottom Discovery / Detail Pane */}
                <AnimatePresence>
                  {selectedLog && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }} 
                      animate={{ height: 320, opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="bg-slate-900 border-t border-indigo-500/30 flex flex-col shrink-0 relative shadow-[0_-20px_50px_rgba(0,0,0,0.5)]"
                    >
                      <button onClick={() => setSelectedLog(null)} className="absolute top-6 right-8 p-2 text-slate-500 hover:text-white z-10"><X size={20}/></button>
                      
                      <div className="flex-1 flex min-h-0">
                        {/* Transaction Metadata */}
                        <div className="w-1/3 p-8 border-r border-white/5 space-y-6 bg-white/[0.01]">
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                               <div className="w-2 h-2 rounded-full bg-emerald-500" />
                               <h4 className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Discovery Trace</h4>
                            </div>
                            <h2 className="text-xl font-black text-white uppercase leading-tight">{selectedLog.action} TRANSACTION</h2>
                            <p className="text-[10px] font-bold text-slate-500 uppercase mt-2">{formatAppDate(selectedLog.timestamp)}</p>
                          </div>
                          
                          <div className="space-y-3">
                             <div className="flex justify-between items-center bg-white/5 rounded-lg px-4 py-2 border border-white/5">
                                <span className="text-[8px] font-black text-slate-500 uppercase">Administrator</span>
                                <span className="text-[10px] font-black text-white uppercase">{selectedLog.user_id}</span>
                             </div>
                             <div className="flex justify-between items-center bg-white/5 rounded-lg px-4 py-2 border border-white/5">
                                <span className="text-[8px] font-black text-slate-500 uppercase">Registry Table</span>
                                <span className="text-[10px] font-black text-blue-400 uppercase">{selectedLog.target_table}</span>
                             </div>
                             <div className="flex justify-between items-center bg-white/5 rounded-lg px-4 py-2 border border-white/5">
                                <span className="text-[8px] font-black text-slate-500 uppercase">TX UUID</span>
                                <span className="text-[10px] font-mono text-slate-400">#{selectedLog.id}</span>
                             </div>
                          </div>
                        </div>

                        {/* Diff Logic Viewer */}
                        <div className="flex-1 p-8 flex flex-col min-h-0">
                          <h4 className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-4">Transformation Delta</h4>
                          <div className="flex-1 bg-black/40 rounded-lg border border-white/5 p-6 overflow-y-auto custom-scrollbar">
                            <DiffViewer changes={selectedLog.changes} />
                            {!selectedLog.changes && (
                              <p className="text-[10px] text-slate-600 italic font-bold uppercase tracking-widest text-center mt-10">No detailed change vectors recorded for this operation</p>
                            )}
                          </div>
                        </div>

                        {/* Visual Confirmation */}
                        <div className="w-64 p-8 flex flex-col items-center justify-center gap-4 bg-white/[0.02]">
                           <div className="w-24 h-24 rounded-lg border-4 border-emerald-500/20 flex items-center justify-center relative">
                              <div className="absolute inset-0 rounded-lg border-4 border-emerald-500 border-t-transparent opacity-40" />
                              <Check size={48} className="text-emerald-500" />
                           </div>
                           <div className="text-center">
                              <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Integrity Verified</p>
                              <p className="text-[8px] font-bold text-slate-600 uppercase mt-1">Status: COMMITTED</p>
                           </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

          </motion.div>
        </WorkspaceDialogFrame>
      )}
    </AnimatePresence>
  )
}


// ─── Rack Elevation Card ───────────────────────────────────────────────────────

const EMPTY_RACK_LOCATIONS: any[] = []
const noRackAction = (..._args: any[]) => undefined

const indexRackLocationsByUnit = (locations: any[], totalU: number) => {
  const locationsByUnit = new Map<number, any>()
  locations.forEach((location) => {
    const startUnit = Number(location?.start_unit)
    const sizeU = Number(location?.size_u)
    if (!Number.isInteger(startUnit) || !Number.isInteger(sizeU) || sizeU < 1) return

    const firstUnit = Math.max(1, startUnit)
    const lastUnit = Math.min(totalU, startUnit + sizeU - 1)
    for (let unit = firstUnit; unit <= lastUnit; unit += 1) {
      if (!locationsByUnit.has(unit)) locationsByUnit.set(unit, location)
    }
  })
  return locationsByUnit
}

interface RackElevationProps {
  rack: any
  onDelete: (rack: any) => void
  onEdit: (rack: any) => void
  onMove?: (dir: 'left' | 'right') => void
  onShowInfo?: (rack: any) => void
  searchTerm: string
  onMount: (rackId: number, u: number) => void
  onManageDevice: (device: any, loc: any, rack: any, event: React.MouseEvent) => void
  isSelected: boolean
  onToggleSelect: (id: number) => void
  onRestore?: (id: number) => void
  isDeleted: boolean
  focusedDeviceId?: number | null
  connectedDeviceIds?: number[]
  diffMode?: boolean
  liveRack?: any
  showCheckbox?: boolean
  className?: string
  }

  const RackElevation = React.memo(({
  rack, onDelete, onEdit, onMove, onShowInfo, searchTerm, onMount, onManageDevice,
  isSelected, onToggleSelect, onRestore, isDeleted,
  focusedDeviceId, connectedDeviceIds, diffMode, liveRack, showCheckbox = true,
  className = ''
  }: RackElevationProps) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const rackMenu = useWorkspaceAnchoredLayer(menuOpen, { minWidth: 180 })
  useWorkspacePopupDismiss(menuOpen, rackMenu.triggerRef, rackMenu.panelRef, () => setMenuOpen(false))
  const scrollRef = useRef<HTMLDivElement>(null)
  const totalU = rack.total_u || 42
  const locations = rack.device_locations || EMPTY_RACK_LOCATIONS
  const liveLocations = liveRack?.device_locations || EMPTY_RACK_LOCATIONS
  const units = useMemo(() => Array.from({ length: totalU }, (_, i) => totalU - i), [totalU])
  const locationsByUnit = useMemo(() => indexRackLocationsByUnit(locations, totalU), [locations, totalU])
  const liveLocationsByUnit = useMemo(
    () => liveLocations === locations ? locationsByUnit : indexRackLocationsByUnit(liveLocations, totalU),
    [liveLocations, locations, locationsByUnit, totalU]
  )

  // Auto-scroll to first diff if in diffMode
  useEffect(() => {
    if (diffMode && liveRack && scrollRef.current) {
      // Find first unit where there is a difference
      let firstDiffU = -1
      for (let u = 1; u <= totalU; u++) {
        const liveAtU = liveLocationsByUnit.get(u)
        const virtAtU = locationsByUnit.get(u)

        if (JSON.stringify(liveAtU) !== JSON.stringify(virtAtU)) {
          firstDiffU = u
          break
        }
      }

      if (firstDiffU !== -1) {
        const el = scrollRef.current.querySelector(`[data-u="${firstDiffU}"]`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
    }
  }, [diffMode, liveRack, liveLocationsByUnit, locationsByUnit, totalU])

  const occupiedU = useMemo(() =>
    locations.reduce((acc: number, l: any) => acc + (l.size_u || 1), 0),
  [locations])

  const serverCount = useMemo(() =>
    locations.filter((l: any) => l.device?.type?.toLowerCase() === 'server' || l.device?.type?.toLowerCase() === 'physical').length,
  [locations])

  const reservedCount = useMemo(() =>
    locations.filter((l: any) => l.device?.status?.toLowerCase() === 'reserved').length,
  [locations])

  const estimatedPowerKw = useMemo(() =>
    locations.reduce((acc: number, l: any) => acc + ((l.device?.power_typical_w || 0) / 1000), 0),
  [locations])

  const effectivePowerCapKw = useMemo(() => {
   const a = rack.pdu_a_cap_kw || 0
   const b = rack.pdu_b_cap_kw || 0
   if (a > 0 && b > 0) return Math.min(a, b)
   if (a > 0) return a
   if (b > 0) return b
   return rack.max_power_kw || 10
  }, [rack.pdu_a_cap_kw, rack.pdu_b_cap_kw, rack.max_power_kw])

  const isHighlighted = (device: any) =>
   !!searchTerm && device?.name?.toLowerCase().includes(searchTerm.toLowerCase())

  const isPlanningEstimateOver = estimatedPowerKw > effectivePowerCapKw
  const isFillOver = occupiedU >= totalU

  return (
   <div 
     data-rack-id={rack.id}
     data-rack-elevation-card="true"
     className={`glass-panel max-w-none flex-shrink-0 rounded-lg overflow-hidden flex flex-col border transition-all group relative
     ${isSelected ? 'border-blue-500/60 shadow-blue-500/15 shadow-2xl bg-blue-900/[0.07]' : 'border-[var(--grid-border)] hover:border-[var(--accent-primary)]'}
     ${isDeleted ? 'opacity-60 grayscale-[0.4]' : ''}
     ${isFillOver ? 'ring-1 ring-rose-500/50' : ''}
     h-full min-h-[360px] max-h-full ${className}
   `}>      
      <RackStatusBar rack={rack} siteColor={rack.site_color} />

      {/* Checkbox */}
      {showCheckbox && (
        <label className="absolute top-3 left-2 z-20 flex h-8 w-8 items-center justify-center cursor-pointer" onClick={e => e.stopPropagation()}>
          <input type="checkbox" aria-label={`Select rack ${rack.name}`} checked={isSelected} onChange={() => onToggleSelect(rack.id)} className="h-4 w-4 accent-[var(--action-primary)]" />
        </label>
      )}

      {/* Header - FIXED */}
      <div className="px-3 pt-4 pb-3 bg-[var(--grid-header-bg)] border-b border-[var(--grid-border)] space-y-2.5 shrink-0">
        <div className="flex items-start justify-between ml-6 gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm text-[var(--text-primary)] leading-5 [overflow-wrap:anywhere]">{rack.name}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <MapPin size={9} className="text-slate-600 shrink-0" />
              <span className="text-[11px] text-[var(--text-secondary)] truncate" title={rack.site_name || 'Unassigned'}>{rack.site_name || 'Unassigned'}</span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isDeleted ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onRestore?.(rack.id)}
                  className="px-2 py-1 bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 rounded-lg text-[7px] font-black uppercase tracking-widest hover:bg-emerald-500/25 transition-all flex items-center gap-1"
                >
                  <RefreshCcw size={9} /> Restore
                </button>
                <button
                  onClick={() => onDelete(rack)}
                  className="p-1 hover:bg-rose-500/10 rounded-lg text-rose-500 transition-colors"
                  title="Permanent Delete"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <button
                  ref={(node) => { rackMenu.triggerRef.current = node }}
                  onClick={() => setMenuOpen(v => !v)}
                  aria-label={`Rack actions for ${rack.name}`}
                  aria-expanded={menuOpen}
                  className="h-8 w-8 flex items-center justify-center hover:bg-[var(--surface-hover)] rounded-lg text-[var(--text-secondary)] transition-colors"
                >
                  <MoreVertical size={13} />
                </button>
                {createPortal(<AnimatePresence>
                  {menuOpen && (
                      <motion.div
                        ref={rackMenu.panelRef}
                        style={rackMenu.panelStyle}
                        data-workspace-panel="true"
                        aria-label={`Rack actions for ${rack.name}`}
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                        className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] text-[var(--text-primary)] shadow-xl overflow-auto p-1"
                      >
                        <button onClick={() => { onShowInfo?.(rack); setMenuOpen(false) }} className="w-full text-left px-3 py-2 text-[8px] font-black uppercase text-blue-400 hover:bg-blue-500/10 rounded-lg flex items-center gap-2 transition-colors">
                          <BarChart3 size={9} /> Detailed Info
                        </button>
                        <div className="h-px bg-white/5 my-1" />
                        {onMove && (<>
                          <button onClick={() => { onMove('left'); setMenuOpen(false) }} className="w-full text-left px-3 py-2 text-[8px] font-bold uppercase text-slate-400 hover:bg-white/5 hover:text-white rounded-lg flex items-center gap-2 transition-colors">
                            <ArrowRightLeft size={9} className="scale-x-[-1]" /> Move Left
                          </button>
                          <button onClick={() => { onMove('right'); setMenuOpen(false) }} className="w-full text-left px-3 py-2 text-[8px] font-bold uppercase text-slate-400 hover:bg-white/5 hover:text-white rounded-lg flex items-center gap-2 transition-colors">
                            <ArrowRightLeft size={9} /> Move Right
                          </button>
                          <div className="h-px bg-white/5 my-1" />
                        </>)}
                        <button onClick={() => { onEdit(rack); setMenuOpen(false) }} className="w-full text-left px-3 py-2 text-[8px] font-bold uppercase text-slate-400 hover:bg-blue-500/10 hover:text-blue-400 rounded-lg flex items-center gap-2 transition-colors">
                          <Edit2 size={9} /> Edit Rack
                        </button>
                        <div className="h-px bg-white/5 my-1" />
                        <button onClick={() => { onDelete(rack); setMenuOpen(false) }} className="w-full text-left px-3 py-2 text-[8px] font-bold uppercase text-rose-500 hover:bg-rose-500/10 rounded-lg flex items-center gap-2 transition-colors">
                          <Trash2 size={9} /> Decommission
                        </button>
                      </motion.div>
                  )}
                </AnimatePresence>, document.body)}
              </div>
            )}
          </div>
        </div>

        {/* Capacity bars */}
        <div className="space-y-2 px-0.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-0.5 px-0.5">
             <div className="flex gap-2">
                <span className="text-[10px] font-medium text-[var(--text-secondary)] flex items-center gap-1">
                   <Server size={8} /> {serverCount} SRV
                </span>
                <span className="text-[10px] font-medium text-[var(--text-secondary)] flex items-center gap-1">
                   <Package size={8} /> {reservedCount} RES
                </span>
             </div>
             <div className="flex flex-wrap gap-x-2 gap-y-1">
                <span className={`text-[10px] font-medium ${isFillOver ? 'text-[var(--state-danger)]' : 'text-[var(--text-secondary)]'}`}>{Math.round((occupiedU/totalU)*100)}% slot</span>
                <span className="text-[10px] font-medium text-[var(--text-secondary)]">Ceiling {effectivePowerCapKw.toFixed(1)}kW</span>
                <span className={`text-[10px] font-medium ${isPlanningEstimateOver ? 'text-[var(--state-danger)]' : 'text-[var(--text-secondary)]'}`}>Typ est {Math.round((estimatedPowerKw/effectivePowerCapKw)*100)}%</span>
             </div>
          </div>
          <MiniBar value={occupiedU} max={totalU} colorFn={fillColor} label="Fill" unit="U" />
          <MiniBar
            value={estimatedPowerKw}
            max={effectivePowerCapKw}
            colorFn={powerColor}
            label="Typical estimate"
            unit="kW"
            overflowLabel="PLANNING ESTIMATE > CONFIGURED CEILING"
          />
        </div>
      </div>

      {/* Elevation grid - SCROLLABLE CONTENT WITH FIXED EDGES */}
      <div className="flex-1 min-h-0 relative flex flex-col bg-[var(--grid-bg)]">
        {/* Fixed PDU Bar A */}
        <PduBar 
          side="A" 
          name={rack.pdu_a_name} 
          capacity={rack.pdu_a_cap_kw} 
          onClick={() => onEdit(rack)} 
        />
        
        {/* Fixed PDU Bar B */}
        <PduBar 
          side="B" 
          name={rack.pdu_b_name} 
          capacity={rack.pdu_b_cap_kw} 
          onClick={() => onEdit(rack)} 
        />

        {/* Scrollable interior grid */}
        <div ref={scrollRef} className="flex-1 min-h-[120px] overflow-y-auto custom-scrollbar px-5 py-2">
          <div className="bg-[var(--surface-base)] border border-[var(--grid-border)] rounded-lg overflow-hidden">
            {units.map(u => {
              const loc = locationsByUnit.get(u)
              const liveLoc = liveLocationsByUnit.get(u)
              
              return (
                <RackUnit
                  key={u}
                  uNumber={u}
                  loc={loc}
                  isTop={loc ? u === loc.start_unit + loc.size_u - 1 : false}
                  isBottom={loc ? u === loc.start_unit : false}
                  highlight={loc?.device ? isHighlighted(loc.device) : false}
                  onSelect={() => onMount(rack.id, u)}
                  onManage={(device, l, e) => onManageDevice(device, l, rack, e)}
                  isDeleted={isDeleted}
                  isFocused={loc?.device_id === focusedDeviceId}
                  isConnected={connectedDeviceIds?.includes(loc?.device_id)}
                  diffMode={diffMode}
                  liveLoc={liveLoc}
                />
              )
            })}
          </div>
        </div>
      </div>

      {/* Footer - FIXED */}
      <div className="px-3 py-2 bg-[var(--grid-header-bg)] border-t border-[var(--grid-border)] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-[var(--text-secondary)] font-medium">{locations.length} assets</span>
          <span className="text-[10px] text-[var(--text-secondary)] font-semibold">{totalU}U</span>
        </div>
        <span className="text-[10px] text-[var(--state-success)] font-semibold">{totalU - occupiedU}U free</span>
      </div>
    </div>
  )
})

// ─── Asset Legend ──────────────────────────────────────────────────────────────

const AssetLegend = () => (
  <div className="flex flex-wrap items-center gap-2 bg-[var(--surface-elevated)] px-3 py-2 rounded-lg border border-[var(--grid-border)]">
    <span className="text-[11px] font-medium text-[var(--text-secondary)] mr-1">Status:</span>
    {['Active', 'Standby', 'Maintenance', 'Decommissioned', 'Offline', 'Reserved'].map(label => (
      <div key={label} className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg border ${STATUS_CONFIG[label].badge}`}>
        <span className="text-[11px] font-medium">{label}</span>
      </div>
    ))}
  </div>
)

// ─── Site Capacity Summary Bar ─────────────────────────────────────────────────

const AssetImpactWindow = ({ deviceId, devices, connections, onClose, coords }: { deviceId: number, devices: any[], connections: any[], onClose: () => void, coords: { x: number, y: number } | null }) => {
  const dialogLayer = useWorkspaceDialogLayer(true, onClose)
  const x = useMotionValue(coords && coords.x > window.innerWidth / 2 ? 80 : Math.max(16, window.innerWidth - 470))
  const y = useMotionValue(Math.max(80, Math.min((coords?.y ?? 300) - 200, window.innerHeight - 550)))
  const [limits, setLimits] = useState({ left: 16, top: 16, right: Math.max(16, innerWidth - 466), bottom: 16 })
  useEffect(() => {
    const clamp = () => {
      const rect = dialogLayer.ref.current?.getBoundingClientRect()
      if (!rect) return
      const right = Math.max(16, innerWidth - rect.width - 16), bottom = Math.max(16, innerHeight - rect.height - 16)
      x.set(Math.min(right, Math.max(16, x.get()))); y.set(Math.min(bottom, Math.max(16, y.get())))
      setLimits({ left: 16, top: 16, right, bottom })
    }
    clamp()
    const observer = new ResizeObserver(clamp)
    if (dialogLayer.ref.current) observer.observe(dialogLayer.ref.current)
    window.addEventListener('resize', clamp)
    return () => { observer.disconnect(); window.removeEventListener('resize', clamp) }
  }, [x, y, dialogLayer.ref])
  const device = devices?.find(d => d.id === deviceId)
  const deviceConns = connections?.filter(c => c.source_device_id === deviceId || c.target_device_id === deviceId) || []
  
  const distribution = useMemo(() => {
    const stats: Record<string, Record<string, number>> = {
      type: {},
      status: {},
      environment: {},
      system: {}
    }
    deviceConns.forEach(c => {
      const isSrc = c.source_device_id === deviceId
      const peerId = isSrc ? c.target_device_id : c.source_device_id
      const peer = devices?.find(d => d.id === peerId)
      if (peer) {
        stats.type[peer.type || 'Unknown'] = (stats.type[peer.type || 'Unknown'] || 0) + 1
        stats.status[peer.status || 'Unknown'] = (stats.status[peer.status || 'Unknown'] || 0) + 1
        stats.environment[peer.environment || 'Unknown'] = (stats.environment[peer.environment || 'Unknown'] || 0) + 1
        stats.system[peer.system || 'Unknown'] = (stats.system[peer.system || 'Unknown'] || 0) + 1
      }
    })
    return stats
  }, [deviceConns, devices, deviceId])

  return createPortal(
    <motion.div
      {...dialogLayer}
      role="dialog" aria-modal="true" aria-label="Impact Analysis"
      style={{ ...dialogLayer.style, x, y, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100dvh - 32px)' }}
      dragConstraints={limits} dragElastic={0}
      drag
      dragMomentum={false}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed top-0 left-0 z-[300] w-[450px] bg-slate-900/95 backdrop-blur-xl border border-blue-500/30 rounded-lg shadow-[0_30px_100px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col cursor-move"
    >       <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/5">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-blue-600 rounded-lg shadow-lg shadow-blue-500/20 text-white">
                <Activity size={16} />
             </div>
             <div>
                <h3 className="text-xs font-black uppercase tracking-tight text-white leading-none">Impact Analysis</h3>
                <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mt-1.5 truncate max-w-[200px]">{device?.name}</p>
             </div>
          </div>
          <button aria-label="Close impact analysis" onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg text-slate-500 hover:text-white transition-colors cursor-pointer"><X size={16}/></button>
       </div>

       <div className="p-6 space-y-6 max-h-[500px] overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-2 gap-3">
             <div className="p-3 bg-black/40 rounded-lg border border-white/5">
                <p className="text-[7px] font-black text-slate-500 uppercase mb-1">Recorded Connections</p>
                <p className="text-xl font-black text-white leading-none">{deviceConns.length}</p>
             </div>
             <div className="p-3 bg-black/40 rounded-lg border border-white/5">
                <p className="text-[7px] font-black text-slate-500 uppercase mb-1">Connected Systems</p>
                <p className="text-xl font-black text-blue-400 leading-none">{Object.keys(distribution.system).length}</p>
             </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {Object.entries(distribution).map(([category, data]) => (
              <div key={category} className="space-y-2">
                <h4 className="text-[8px] font-black text-slate-400 uppercase tracking-widest px-1">{category} Distribution</h4>
                <div className="bg-black/20 rounded-lg border border-white/5 overflow-hidden">
                  {Object.entries(data).length === 0 ? (
                    <p className="p-3 text-[8px] text-slate-600 italic">None</p>
                  ) : (
                    Object.entries(data).sort((a,b) => b[1] - a[1]).map(([label, count]) => (
                      <div key={label} className="flex justify-between items-center px-3 py-1.5 border-b border-white/[0.03] last:border-0">
                        <span className="text-[9px] font-bold text-slate-300 uppercase truncate max-w-[100px]">{label}</span>
                        <span className="text-[9px] font-black text-white tabular-nums">{count}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
             <h4 className="text-[8px] font-black text-slate-400 uppercase tracking-widest px-1">Network Fabric Trace</h4>
             {deviceConns.length === 0 ? (
               <p className="text-[10px] text-slate-600 italic px-1">No active connections for this asset.</p>
             ) : (
               <div className="space-y-1">
                  {deviceConns.slice(0, 5).map((c: any) => {
                    const isSrc = c.source_device_id === deviceId
                    const peerId = isSrc ? c.target_device_id : c.source_device_id
                    const peer = devices?.find(d => d.id === peerId)
                    return (
                      <div key={c.id} className="p-2 bg-white/5 border border-white/5 rounded-lg flex items-center justify-between group hover:border-blue-500/20 transition-all">
                         <div className="flex flex-col">
                            <span className="text-[8px] font-black text-blue-400 uppercase leading-none">{peer?.name || 'Unknown Peer'}</span>
                            <span className="text-[6px] font-bold text-slate-500 uppercase mt-1">{isSrc ? c.source_port : c.target_port} → {isSrc ? c.target_port : c.source_port}</span>
                         </div>
                         <div className="text-right">
                            <span className="text-[8px] font-black text-slate-300 uppercase">{c.speed_gbps}G</span>
                         </div>
                      </div>
                    )
                  })}
                  {deviceConns.length > 5 && (
                    <p className="text-[8px] text-slate-500 text-center font-bold uppercase tracking-widest pt-1">+{deviceConns.length - 5} additional vectors</p>
                  )}
               </div>
             )}
          </div>
       </div>

       <div className="px-6 py-4 bg-black/40 border-t border-white/10 flex items-center gap-3">
          <AlertTriangle size={14} className="text-amber-500 shrink-0" />
          <p className="text-[8px] font-bold text-slate-400 leading-tight">
             Service impact is unknown. Recorded network links do not establish service dependencies or failure propagation.
          </p>
       </div>
    </motion.div>, document.body
  )
}

const LabelGeneratorModal = ({ racks, onClose, devices, connections }: { racks: any[], onClose: () => void, devices: any[], connections: any[] }) => {
  const [pattern, setPattern] = useState('[$src_name] $src_port >> $dest_port [$dest_name]')
  
  const deviceIdsInScope = useMemo(() => {
    const ids = new Set<number>()
    racks.forEach(r => {
      r.device_locations?.forEach((l: any) => {
        if (l.device_id) ids.add(l.device_id)
      })
    })
    return ids
  }, [racks])

  const allConnections = useMemo(() => {
    if (!connections || !devices) return []
    const seen = new Set<string>()
    
    return connections.filter(c => {
      const isSrcIn = deviceIdsInScope.has(c.source_device_id)
      const isDstIn = deviceIdsInScope.has(c.target_device_id)
      
      if (!isSrcIn && !isDstIn) return false
      
      // Smart Deduplication: Treat A->B and B->A as the same cable vector
      const pairKey = [c.source_device_id, c.target_device_id].sort().join('-')
      if (seen.has(pairKey)) return false
      seen.add(pairKey)
      return true
    }).map(c => {
      const src = devices.find(d => d.id === c.source_device_id)
      const dst = devices.find(d => d.id === c.target_device_id)
      return {
        ...c,
        src_name: src?.name || '?',
        dest_name: dst?.name || '?',
        src_port: c.source_port,
        dest_port: c.target_port,
        speed: `${c.speed_gbps}G`
      }
    })
  }, [deviceIdsInScope, devices, connections])

  const formatLabel = (conn: any) => {
    let result = pattern
    const vars: Record<string, string> = {
      '$src_name': conn.src_name,
      '$dest_name': conn.dest_name,
      '$src_port': conn.src_port,
      '$dest_port': conn.dest_port,
      '$vlan': conn.source_vlan || 'N/A',
      '$farm': conn.farm || 'STD',
      '$speed': conn.speed
    }
    
    // Replace all occurrences of each variable
    Object.entries(vars).forEach(([key, val]) => {
      result = result.split(key).join(val)
    })
    return result
  }

  return (
    <WorkspaceDialogFrame title="Cable labels" onClose={onClose}>
       <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-full max-w-4xl max-h-[85vh] flex flex-col p-10 rounded-lg border border-white/10 shadow-2xl">
          <div className="flex justify-between items-start mb-8">
             <div>
                <h2 className="text-2xl font-black uppercase tracking-tighter text-white">Physical Cable Label Automation</h2>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-2 flex items-center gap-2">
                   <Tag size={12} className="text-emerald-500" /> Sourcing from {allConnections.length} active links in {racks.length} selected racks
                </p>
             </div>
             <button onClick={onClose} className="p-3 hover:bg-white/10 rounded-lg text-slate-500 transition-colors"><X size={24}/></button>
          </div>

          <div className="space-y-3 mb-8 bg-white/5 p-6 rounded-lg border border-white/5">
             <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 flex items-center gap-2">
                <Terminal size={12} /> Label Pattern Engine
             </label>
             <input 
               value={pattern}
               onChange={e => setPattern(e.target.value)}
               className="w-full bg-slate-950 border border-white/10 rounded-lg px-5 py-4 text-sm text-emerald-400 font-mono outline-none focus:border-emerald-500/30 transition-all"
               placeholder="[$src_name] $src_port -> $dest_port [$dest_name]"
             />
             <div className="flex flex-wrap gap-2 pt-1 px-1">
                {['$src_name', '$dest_name', '$src_port', '$dest_port', '$vlan', '$farm', '$speed'].map(v => (
                  <button key={v} onClick={() => setPattern(prev => prev + ' ' + v)} className="text-[8px] font-black text-slate-500 hover:text-white uppercase tracking-widest px-2 py-1 bg-white/5 rounded-lg border border-white/5 transition-all">{v}</button>
                ))}
             </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar border border-white/5 rounded-lg bg-black/40">
             <table className="sg-data-table w-full text-left">
                <thead className="sticky top-0 bg-slate-900 z-10 shadow-lg">
                   <tr className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] border-b border-white/10">
                      <th className="p-5">Logical Source Vector</th>
                      <th className="p-5">Generated Physical Identity</th>
                      <th className="p-5 w-24 text-center">Action</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                   {allConnections.map(c => (
                     <tr key={c.id} className="hover:bg-white/[0.03] transition-colors group">
                        <td className="p-5 text-[10px] font-bold text-slate-500 uppercase">{c.src_name}:{c.src_port}</td>
                        <td className="p-5 text-[12px] font-black text-emerald-400 font-mono tracking-tight">{formatLabel(c)}</td>
                        <td className="p-5 text-center">
                           <button onClick={() => { navigator.clipboard.writeText(formatLabel(c)); toast.success("Label Copied") }} className="p-2 hover:bg-emerald-600 hover:text-white rounded-lg text-slate-600 transition-all"><Clipboard size={16}/></button>
                        </td>
                     </tr>
                   ))}
                   {allConnections.length === 0 && (
                     <tr><td colSpan={3} className="p-20 text-center text-slate-600 font-bold uppercase tracking-[0.3em]">No cable vectors identified in selected scope</td></tr>
                   )}
                </tbody>
             </table>
          </div>

          <div className="flex justify-end pt-8 gap-4">
             <button onClick={onClose} className="px-8 py-3 text-[10px] font-black uppercase text-slate-500 hover:text-white transition-colors">Discard</button>
             <button 
                onClick={() => { 
                   navigator.clipboard.writeText(allConnections.map(c => formatLabel(c)).join('\n')); 
                   toast.success(`Exported ${allConnections.length} Labels`);
                }} 
                className="px-10 py-3 bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-emerald-600/20 active:scale-95 transition-all"
             >
                Commit All to Clipboard
             </button>
          </div>
       </motion.div>
    </WorkspaceDialogFrame>
  )
}

const snapshots = [
  { id: 1, date: '2026-05-27', author: 'SYSTEM', changes: 4, type: 'Daily Routine', detail: 'Moved 2 assets in Rack A-01, Updated 1 Site Color' },
  { id: 2, date: '2026-05-26', author: 'SYSTEM', changes: 12, type: 'Daily Routine', detail: 'Bulk Ingested 10 New Physical Assets' },
  { id: 3, date: '2026-05-25', author: 'SYSTEM', changes: 0, type: 'Skipped (No Change)', detail: 'State identical to previous snapshot' },
]

const InfrastructureHistory = ({ onClose, onExecuteDiff }: { onClose: () => void, onExecuteDiff: (versions: number[]) => void }) => {
  const [selectedVersions, setSelectedVersions] = useState<number[]>([])
  
  const toggleVersion = (id: number) => {
    setSelectedVersions(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id].slice(-2)
    )
  }

  return (
    <WorkspaceDialogFrame title="Infrastructure History" onClose={onClose}>
       <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-full max-w-4xl max-h-[85vh] flex flex-col p-10 rounded-lg border border-white/10 shadow-2xl">
          <div className="flex justify-between items-start mb-8">
             <div>
                <h2 className="text-3xl font-black uppercase tracking-tighter text-white">Infrastructure Time Machine</h2>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-2 flex items-center gap-2">
                   <History size={14} className="text-blue-500" /> Delta Analysis & Historical Configuration Diffs
                </p>
             </div>
             <button onClick={onClose} className="p-3 hover:bg-white/10 rounded-lg text-slate-500 transition-colors"><X size={24}/></button>
          </div>

          <div className="grid grid-cols-1 gap-4 mb-8">
             {snapshots.map(s => {
               const isSelected = selectedVersions.includes(s.id)
               return (
                 <div 
                   key={s.id} 
                   onClick={() => toggleVersion(s.id)}
                   className={`group flex items-center justify-between p-6 rounded-lg border transition-all cursor-pointer ${isSelected ? 'bg-blue-600/10 border-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.1)]' : 'bg-white/5 border-white/5 hover:border-white/20'}`}
                 >
                    <div className="flex items-center gap-6">
                       <div className={`p-4 rounded-lg transition-all ${isSelected ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-900 text-slate-500'}`}>
                          <History size={20} />
                       </div>
                       <div>
                          <p className={`text-sm font-black transition-colors ${isSelected ? 'text-white' : 'text-slate-300'}`}>{s.date}</p>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">{s.type} • {s.author}</p>
                       </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                       {isSelected && (
                         <div className="px-3 py-1 bg-blue-600 text-white rounded-lg text-[8px] font-black uppercase tracking-widest animate-in fade-in zoom-in">
                            Selected for Diff
                         </div>
                       )}
                       <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${isSelected ? 'border-blue-500 bg-blue-500' : 'border-white/10 bg-black/20'}`}>
                          {isSelected && <Check size={14} className="text-white" />}
                       </div>
                    </div>
                 </div>
               )
             })}
          </div>

          <div className="flex justify-between items-center bg-white/5 p-8 rounded-lg border border-white/5">
             <div>
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Analysis Engine</p>
                <p className="text-xs text-slate-400 mt-1 italic">
                   {selectedVersions.length === 0 ? "Select a version to compare with Live State (Now)." :
                    selectedVersions.length === 1 ? "Comparing LIVE STATE with snapshot from " + snapshots.find(s => s.id === selectedVersions[0])?.date :
                    "Cross-diffing snapshot " + snapshots.find(s => s.id === selectedVersions[0])?.date + " vs " + snapshots.find(s => s.id === selectedVersions[1])?.date}
                </p>
             </div>
             <button 
               disabled={selectedVersions.length === 0}
               onClick={() => onExecuteDiff(selectedVersions)}
               className="px-10 py-4 bg-blue-600 disabled:opacity-30 text-white rounded-lg text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-blue-600/20 active:scale-95 transition-all"
             >
                Execute Visual Diff Analysis
             </button>
          </div>
       </motion.div>
    </WorkspaceDialogFrame>
  )
}

const PlanBanner = ({ onAbort, onSave, onProceed, selectedCount, isInitialized, showOnlySandbox, onToggleShowOnly, showDiff, onToggleDiff, planName, onNameChange }: { onAbort: () => void, onSave: () => void, onProceed: () => void, selectedCount: number, isInitialized: boolean, showOnlySandbox: boolean, onToggleShowOnly: (v: boolean) => void, showDiff: boolean, onToggleDiff: (v: boolean) => void, planName: string, onNameChange: (v: string) => void }) => (
  <motion.div 
    initial={{ y: -50, opacity: 0 }} 
    animate={{ y: 0, opacity: 1 }}
    className="fixed top-0 inset-x-0 z-[100] bg-violet-600/95 backdrop-blur-xl border-b border-violet-400/30 py-4 flex items-center justify-center gap-12 shadow-2xl"
  >
     <div className="flex items-center gap-4">
        <div className="p-2 bg-white/10 rounded-lg border border-white/20">
           <Eye size={20} className="text-white" />
        </div>
        <div>
           <h3 className="text-sm font-black uppercase tracking-tighter text-white leading-none">Ghost Planner <span className="text-violet-200">Sandbox</span></h3>
           <p className="text-[9px] font-bold text-violet-200 uppercase tracking-widest mt-1">
              {isInitialized ? 'Virtual Environment Active' : 'Initializing Project Workspace'}
           </p>
        </div>
     </div>

     <div className="flex items-center gap-4">
        {!isInitialized ? (
          <div className="flex items-center gap-4">
             <button 
               disabled={selectedCount === 0}
               onClick={onProceed} 
               className="px-6 py-2 bg-white text-violet-600 disabled:opacity-50 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-lg active:scale-95 transition-all"
             >
                Initialize Plan Matrix
             </button>
          </div>
        ) : (
          <div className="flex items-center gap-6">
             <input 
                value={planName}
                onChange={e => onNameChange(e.target.value)}
                className="bg-violet-700/50 border border-violet-400/30 rounded-lg px-4 py-2 text-[10px] font-black uppercase text-white outline-none w-64 placeholder:text-violet-300"
                placeholder="PLAN NAME (e.g. Migration Phase 1)"
             />
             <div className="flex items-center gap-6 bg-black/20 px-4 py-1.5 rounded-lg border border-white/10">
                <div className="flex items-center gap-2">
                   <span className="text-[9px] font-black text-violet-200 uppercase">Focus Sandbox</span>
                   <button 
                     onClick={() => onToggleShowOnly(!showOnlySandbox)}
                     className={`w-10 h-5 rounded-lg relative transition-colors ${showOnlySandbox ? 'bg-emerald-500' : 'bg-slate-700'}`}
                   >
                     <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${showOnlySandbox ? 'left-6' : 'left-1'}`} />
                   </button>
                </div>
                <div className="w-px h-4 bg-white/10" />
                <div className="flex items-center gap-2">
                   <span className="text-[9px] font-black text-violet-200 uppercase">Visual Diff</span>
                   <button 
                     onClick={() => onToggleDiff(!showDiff)}
                     className={`w-10 h-5 rounded-lg relative transition-colors ${showDiff ? 'bg-blue-500' : 'bg-slate-700'}`}
                   >
                     <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${showDiff ? 'left-6' : 'left-1'}`} />
                   </button>
                </div>
             </div>
             <button onClick={onSave} className="px-6 py-2 bg-emerald-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest shadow-lg active:scale-95 transition-all">
                Save Plan
             </button>
          </div>
        )}
        <button onClick={onAbort} className="px-6 py-2 bg-rose-500/20 text-white border border-rose-500/30 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-rose-500 transition-all">
           Exit Sandbox
        </button>
     </div>
  </motion.div>
)

const PlanListModal = ({ plans, isLoading, isError, isFetching, onRetry, onClose, onLoadPlan, onAddPlan, onDeletePlan }: { plans: any[], isLoading: boolean, isError: boolean, isFetching: boolean, onRetry: () => void, onClose: () => void, onLoadPlan: (p: any) => void, onAddPlan: (type: 'blank' | 'asis') => void, onDeletePlan: (id: number) => void }) => (
  <WorkspaceDialogFrame title="Infrastructure plans" onClose={onClose}>
     <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-[600px] p-10 rounded-lg border border-white/10 shadow-2xl space-y-8">
        <div className="flex justify-between items-start">
           <div className="flex items-center gap-4">
              <div className="p-3 bg-violet-600 rounded-lg shadow-lg shadow-violet-600/20 text-white">
                 <List size={24} />
              </div>
              <div>
                 <h2 className="text-2xl font-black uppercase tracking-tighter text-white">Infrastructure Plans</h2>
                 <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Stored sandbox configurations & matrix models</p>
              </div>
           </div>
           <button onClick={onClose} className="p-3 hover:bg-white/10 rounded-lg text-slate-500 transition-colors"><X size={24}/></button>
        </div>

        <div className="space-y-4">
           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center px-10 leading-relaxed">
              Create a new virtual sandbox environment. You will be asked to select racks to clear (Blank) or clone (As-Is) into your plan.
           </p>
           <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => onAddPlan('blank')}
                className="flex flex-col items-center justify-center p-6 rounded-lg bg-white/5 border border-white/5 hover:border-violet-500/50 hover:bg-violet-600/5 transition-all group"
              >
                 <div className="p-4 bg-slate-900 rounded-lg mb-4 group-hover:scale-110 transition-transform">
                    <Plus size={24} className="text-violet-400" />
                 </div>
                 <span className="text-[11px] font-black text-white uppercase tracking-widest">New Blank Plan</span>
                 <span className="text-[8px] text-slate-500 font-bold uppercase mt-2">Zero baseline for selection</span>
              </button>
              <button 
                onClick={() => onAddPlan('asis')}
                className="flex flex-col items-center justify-center p-6 rounded-lg bg-white/5 border border-white/5 hover:border-blue-500/50 hover:bg-blue-600/5 transition-all group"
              >
                 <div className="p-4 bg-slate-900 rounded-lg mb-4 group-hover:scale-110 transition-transform">
                    <Upload size={24} className="text-blue-400" />
                 </div>
                 <span className="text-[11px] font-black text-white uppercase tracking-widest">Import Live Site</span>
                 <span className="text-[8px] text-slate-500 font-bold uppercase mt-2">Clone active selection</span>
              </button>
           </div>
        </div>

        <div className="space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
           <div className="flex items-center gap-4 px-2 mb-4">
              <div className="h-px flex-1 bg-white/5" />
              <span className="text-[9px] font-black text-slate-600 uppercase tracking-[0.3em]">Historical Archives</span>
              <div className="h-px flex-1 bg-white/5" />
           </div>
           <RackDataState label="Infrastructure plans" isLoading={isLoading} isError={isError} isFetching={isFetching} hasData={plans.length > 0} onRetry={onRetry} />
           {isLoading || (isError && plans.length === 0) ? null : plans.length === 0 ? (
             <div className="p-10 text-center border-2 border-dashed border-white/5 rounded-lg text-slate-600 font-bold uppercase text-[10px] tracking-widest">No plans found</div>
           ) : (
             plans.map(p => (
               <div key={p.id} className="flex items-center justify-between p-5 bg-white/5 border border-white/5 rounded-lg hover:border-violet-500/30 transition-all group">
                  <div className="flex items-center gap-4">
                     <div className="p-3 bg-slate-950 rounded-lg text-slate-500 group-hover:text-violet-400 transition-colors">
                        <Package size={18} />
                     </div>
                     <div>
                        <p className="text-[13px] font-black text-white uppercase tracking-tight">{p.name}</p>
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">{p.racks.length} Racks • {p.date}</p>
                     </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => onLoadPlan(p)} className="px-6 py-2.5 bg-violet-600/10 text-violet-400 border border-violet-500/20 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-violet-600 hover:text-white transition-all">
                       Load Matrix
                    </button>
                    <button 
                      onClick={() => onDeletePlan(p.id)}
                      className="p-2 hover:bg-rose-500/10 rounded-lg text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                    >
                       <Trash2 size={16} />
                    </button>
                  </div>
               </div>
             ))
           )}
        </div>
     </motion.div>
  </WorkspaceDialogFrame>
)

const SiteCapacityBar = ({ racks }: { racks: any[] }) => {
  const totalU = racks.reduce((a: number, r: any) => a + (r.total_u || 42), 0)
  const usedU = racks.reduce((a: number, r: any) => a + (r.device_locations || []).reduce((b: number, l: any) => b + (l.size_u || 1), 0), 0)
  const totalDevices = racks.reduce((a: number, r: any) => a + (r.device_locations || []).length, 0)
  const fillPct = totalU > 0 ? Math.round((usedU / totalU) * 100) : 0
  const estimatedPowerKw = racks.reduce((a: number, r: any) =>
    a + (r.device_locations || []).reduce((b: number, l: any) => b + ((l.device?.power_typical_w || 0) / 1000), 0), 0)
  const totalPowerCapKw = racks.reduce((a: number, r: any) => a + (r.max_power_kw || 10), 0)

  const stats = [
    { label: 'Racks',     value: String(racks.length),                icon: <Server size={14}/>,      color: 'text-[var(--text-primary)]' },
    { label: 'Assets',    value: String(totalDevices),                 icon: <Package size={14}/>,     color: 'text-[var(--text-primary)]' },
    { label: 'Fill',      value: `${fillPct}%`,                        icon: <BarChart3 size={14}/>,   color: fillPct >= 90 ? 'text-[var(--state-danger)]' : fillPct >= 70 ? 'text-[var(--state-warning)]' : 'text-[var(--state-success)]' },
    { label: 'Typical Est.', value: `${estimatedPowerKw.toFixed(1)}kW`, icon: <Zap size={14}/>,        color: 'text-[var(--text-primary)]' },
    { label: 'Configured Ceiling', value: `${totalPowerCapKw.toFixed(0)}kW`, icon: <TrendingUp size={14}/>, color: 'text-[var(--text-primary)]' },
  ]

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 rounded-lg bg-[var(--surface-elevated)] border border-[var(--grid-border)]">
      {stats.map((s, i) => (
        <React.Fragment key={s.label}>
          {i > 0 && <div className="h-6 w-px bg-[var(--grid-border)]" />}
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-secondary)]">{s.icon}</span>
            <div>
              <div className={`text-sm font-semibold tabular-nums ${s.color}`}>{s.value}</div>
              <div className="text-[11px] text-[var(--text-secondary)] font-medium">{s.label}</div>
            </div>
          </div>
        </React.Fragment>
      ))}
    </div>
  )
}

// ─── Floating Bulk Toolbar ─────────────────────────────────────────────────────

const BulkToolbar = ({ count, onDelete, onRelocate, onCompare, onClear, isDeleted, onRestore, onGenerateLabels }:
  { count: number; onDelete: () => void; onRelocate: () => void; onCompare: () => void; onClear: () => void; isDeleted: boolean; onRestore: () => void; onGenerateLabels: () => void }) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: 16 }}
    className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-5 py-3 bg-slate-950/95 backdrop-blur-xl border border-white/15 rounded-lg shadow-2xl"
  >
    <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest mr-2">{count} selected</span>
    <div className="h-4 w-px bg-white/10" />
    {isDeleted ? (
      <>
        <button onClick={onRestore} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 rounded-lg text-[8px] font-black uppercase hover:bg-emerald-500/25 transition-all">
          <RefreshCcw size={11} /> Restore
        </button>
        <button onClick={onDelete} className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/15 text-rose-400 border border-rose-500/25 rounded-lg text-[8px] font-black uppercase hover:bg-rose-500/25 transition-all">
          <Trash2 size={11} /> Purge
        </button>
      </>
    ) : (<>
      <button onClick={onGenerateLabels} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 rounded-lg text-[8px] font-black uppercase hover:bg-emerald-500/25 transition-all">
        <Tag size={11} /> Labels
      </button>
      <button onClick={onRelocate} className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500/15 text-violet-400 border border-violet-500/25 rounded-lg text-[8px] font-black uppercase hover:bg-violet-500/25 transition-all">
        <ArrowRightLeft size={11} /> Relocate
      </button>
      <button onClick={onDelete} className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/15 text-rose-400 border border-rose-500/25 rounded-lg text-[8px] font-black uppercase hover:bg-rose-500/25 transition-all">
        <Trash2 size={11} /> Delete
      </button>
    </>)}
    <div className="h-4 w-px bg-white/10" />
    <button onClick={onClear} className="p-1.5 hover:bg-white/5 rounded-lg text-slate-500 hover:text-slate-300 transition-colors">
      <X size={13} />
    </button>
  </motion.div>
)

// ─── Device Detail Modal ───────────────────────────────────────────────────────

const DeviceDetailModal = ({ device, loc, rack, onClose, onUnmount, onUpdateMount, onUpdateDevice }:
  { device: any; loc: any; rack: any; onClose: () => void; onUnmount: (id: number) => void; onUpdateMount: (data: any) => void; onUpdateDevice?: (data: any) => void }) => {
  const [newSizeU, setNewSizeU] = useState(loc?.size_u || device?.size_u || 1)
  const [powerTypicalW, setPowerTypicalW] = useState(device?.power_typical_w || 0)
  const [powerMaxW, setPowerMaxW] = useState(device?.power_max_w || 0)
  const [orientation, setOrientation] = useState(loc?.orientation || 'Front')
  const [depth, setDepth] = useState(loc?.depth || device?.depth || 'Full')
  const [confirmUnmount, setConfirmUnmount] = useState(false)

  const statusCfg = getStatusCfg(device?.status, device?.is_reservation)
  const typeCfg = getTypeCfg(device?.type)
  const assetNavigation = resolveOperationalObjectReference('device', device.id)

  const infoRows = [
    { label: 'System',        value: device?.system },
    { label: 'Environment',   value: device?.environment },
    { label: 'Owner',         value: device?.owner },
    { label: 'Business Unit', value: device?.business_unit },
    { label: 'Manufacturer',  value: device?.manufacturer },
    { label: 'Model',         value: device?.model },
    { label: 'OS',            value: device?.os_name ? `${device.os_name} ${device.os_version || ''}`.trim() : null },
    { label: 'Mgmt IP',       value: device?.management_ip },
    { label: 'Serial',        value: device?.serial_number },
    { label: 'Asset Tag',     value: device?.asset_tag },
    { label: 'Rack',          value: rack?.name },
    { label: 'Position',      value: loc ? `U${loc.start_unit} – U${loc.start_unit + loc.size_u - 1}` : null },
    { label: 'Reserved By',   value: device?.is_reservation ? device?.reservation_info?.poc : null },
    { label: 'Est. Rack Date', value: device?.is_reservation ? device?.reservation_info?.est_date : null },
  ].filter(r => r.value)

  const warrantyDate = device?.warranty_end ? new Date(device.warranty_end) : null
  const warrantyExpired = warrantyDate && warrantyDate < new Date()
  const eolDate = device?.eol_date ? new Date(device.eol_date) : null
  const eolExpired = eolDate && eolDate < new Date()

  return (
    <WorkspaceDialogFrame title="Asset details" onClose={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.97 }}
        className="glass-panel w-full max-w-lg rounded-lg overflow-hidden border border-white/10 shadow-2xl"
      >
        {/* Header */}
        <div className="px-6 py-5 bg-white/[0.03] border-b border-white/[0.07] flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`p-2.5 rounded-lg bg-white/5 border border-white/10 ${typeCfg.color}`}>
              <Monitor size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-black uppercase tracking-tight text-white truncate">
                {device?.is_reservation && <span className="text-violet-400 mr-2">[RESERVE]</span>}
                {device?.name}
              </h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                <span className={`text-[9px] font-black uppercase tracking-widest ${statusCfg.color}`}>{device?.status}</span>
                <span className="text-slate-700">·</span>
                <span className={`text-[9px] font-bold uppercase ${typeCfg.color}`}>{device?.type}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-slate-500 hover:text-white transition-colors shrink-0 mt-0.5">
            <X size={16} />
          </button>
        </div>

        {/* Warranty / EOL alerts */}
        {(warrantyExpired || eolExpired) && (
          <div className="px-6 py-3 bg-amber-500/[0.07] border-b border-amber-500/20 flex items-center gap-2">
            <AlertTriangle size={13} className="text-amber-400 shrink-0" />
            <span className="text-[9px] font-black text-amber-400 uppercase tracking-wider">
              {warrantyExpired && 'Warranty Expired'}{warrantyExpired && eolExpired && ' · '}{eolExpired && 'End of Life Reached'}
            </span>
          </div>
        )}

        {/* Info grid */}
        <div className="px-6 py-4 grid grid-cols-2 gap-x-6 gap-y-3 max-h-56 overflow-y-auto custom-scrollbar">
          {infoRows.map(row => (
            <div key={row.label}>
              <p className="text-[7px] font-black text-slate-600 uppercase tracking-widest">{row.label}</p>
              <p className="text-[10px] font-bold text-slate-200 mt-0.5 truncate">{row.value}</p>
            </div>
          ))}
          {device?.management_url && (
            <div className="col-span-2">
              <p className="text-[7px] font-black text-slate-600 uppercase tracking-widest">Management URL</p>
              <a href={device.management_url} target="_blank" rel="noopener noreferrer"
                className="text-[10px] font-bold text-blue-400 hover:text-blue-300 mt-0.5 flex items-center gap-1 truncate transition-colors">
                {device.management_url} <ExternalLink size={9} className="shrink-0" />
              </a>
            </div>
          )}
        </div>

        {/* Physical Mounting (editable) */}
        <div className="px-6 py-4 bg-white/[0.02] border-t border-white/[0.06] space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[8px] font-black text-slate-600 uppercase block mb-1">Mount Side</label>
              <StyledSelect
                options={[
                  { label: 'FRONT', value: 'Front' },
                  { label: 'REAR (BACK)', value: 'Back' }
                ]}
                value={orientation}
                onChange={e => setOrientation(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[8px] font-black text-slate-600 uppercase block mb-1">Depth</label>
              <StyledSelect
                options={[
                  { label: 'FULL DEPTH', value: 'Full' },
                  { label: 'HALF DEPTH', value: 'Half' }
                ]}
                value={depth}
                onChange={e => setDepth(e.target.value)}
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[8px] font-black text-slate-600 uppercase block mb-1">Vertical Size (U)</label>
              <input
                type="number" min={1} max={rack?.total_u || 42}
                value={newSizeU}
                onChange={e => setNewSizeU(parseInt(e.target.value) || 1)}
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500/60 transition-colors font-mono"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={() => { if (rack && loc) onUpdateMount({ rackId: rack.id, device_id: device.id, start_u: loc.start_unit, size_u: newSizeU, orientation, depth }) }}
                className="w-full px-4 py-2 bg-blue-600/15 text-blue-400 border border-blue-500/25 rounded-lg text-[9px] font-black uppercase hover:bg-blue-600/25 transition-all flex items-center justify-center gap-1.5"
              >
                <Check size={11} /> Update Mount
              </button>
            </div>
          </div>
        </div>

        {/* Power planning fields (editable) */}
        <div className="px-6 py-4 bg-white/[0.02] border-t border-white/[0.06] space-y-3">
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Power Planning Fields (W)</span>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[8px] font-black text-slate-600 uppercase block mb-1">Avg (Typical)</label>
              <input
                type="number" min={0} step={0.1}
                value={powerTypicalW}
                onChange={e => setPowerTypicalW(parseFloat(e.target.value) || 0)}
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500/60 transition-colors font-mono"
              />
            </div>
            <div>
              <label className="text-[8px] font-black text-slate-600 uppercase block mb-1">Max Peak</label>
              <input
                type="number" min={0} step={0.1}
                value={powerMaxW}
                onChange={e => setPowerMaxW(parseFloat(e.target.value) || 0)}
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500/60 transition-colors font-mono"
              />
            </div>
          </div>
          {(powerTypicalW !== device?.power_typical_w || powerMaxW !== device?.power_max_w) && (
            <button
              onClick={() => {
                onUpdateDevice?.({ id: device.id, power_typical_w: powerTypicalW, power_max_w: powerMaxW })
              }}
              className="w-full px-3 py-2 bg-emerald-600/15 text-emerald-400 border border-emerald-500/25 rounded-lg text-[8px] font-black uppercase hover:bg-emerald-600/25 transition-all flex items-center justify-center gap-1.5"
            >
              <Check size={11} /> Save Power
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.06] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirmUnmount(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-lg text-[9px] font-black uppercase hover:bg-rose-500/20 transition-all"
            >
              <Trash2 size={11} /> {device?.is_reservation ? 'Cancel Reservation' : 'Unmount Asset'}
            </button>
            <ModulePolicyLink
              moduleId={assetNavigation?.moduleId || 'assets'}
              to={assetNavigation?.path || '/asset'}
              disabled={!assetNavigation}
              disabledReason="Asset route unavailable."
              aria-label="Open Asset"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg text-[9px] font-black uppercase hover:bg-blue-500/20 transition-all"
            >
              <ExternalLink size={11} /> Open Asset
            </ModulePolicyLink>
          </div>
          <button onClick={onClose} className="px-4 py-2.5 text-[9px] font-black uppercase text-slate-500 hover:text-slate-300 transition-colors">
            Close
          </button>
        </div>
      </motion.div>

      <ConfirmationModal
        isOpen={confirmUnmount}
        onClose={() => setConfirmUnmount(false)}
        onConfirm={() => { onUnmount(device.id); onClose() }}
        title={device?.is_reservation ? "Cancel Reservation" : "Unmount Asset"}
        message={device?.is_reservation 
          ? `Remove reservation "${device?.name}"?`
          : `Remove ${device?.name} from ${rack?.name}? The device will remain in the asset registry.`}
        variant="warning"
        confirmText={device?.is_reservation ? "Remove" : "Unmount"}
      />
    </WorkspaceDialogFrame>
  )
}

// ─── Relocate Modal ────────────────────────────────────────────────────────────

const RelocateModal = ({ selectedRacks, sites, onClose, onRelocate }:
  { selectedRacks: number[]; sites: any[]; onClose: () => void; onRelocate: (siteId: number) => void }) => {
  const [targetSiteId, setTargetSiteId] = useState('')
  return (
    <WorkspaceModal
      isOpen={true}
      onClose={onClose}
      size="compact"
      title="Relocate Racks"
      subtitle={`${selectedRacks.length} rack(s) selected`}
      icon={<ArrowRightLeft size={20} />}
      footerRight={
        <div className="flex gap-3">
          <ToolbarButton onClick={onClose}>Close</ToolbarButton>
          <ToolbarButton
            disabled={!targetSiteId}
            onClick={() => { if (targetSiteId) { onRelocate(parseInt(targetSiteId)); onClose() } }}
            variant="primary"
          >
            Relocate
          </ToolbarButton>
        </div>
      }
    >
      <div className="pt-6">
        <StyledSelect
          label="Destination Site"
          value={targetSiteId}
          onChange={e => setTargetSiteId(e.target.value)}
          options={sites?.map((s: any) => ({ value: String(s.id), label: s.name })) || []}
          placeholder="Select target site..."
        />
      </div>
    </WorkspaceModal>
  )
}

// ─── Rack Info Modal ───────────────────────────────────────────────────────────

const RackInfoModal = ({ rack, onClose }: { rack: any; onClose: () => void }) => {
  const [isMaximized, setIsMaximized] = useState(false)
  const totalU = rack.total_u || 42
  const occupiedU = (rack.device_locations || []).reduce((acc: number, l: any) => acc + (l.size_u || 1), 0)
  const freeU = totalU - occupiedU
  const fillPct = Math.round((occupiedU / totalU) * 100)
  
  const typicalPowerW = (rack.device_locations || []).reduce((acc: number, l: any) => acc + (l.device?.power_typical_w || 0), 0)
  const configuredRackCeilingKw = rack.max_power_kw || 10
  const typicalEstimatePct = Math.round((typicalPowerW / (configuredRackCeilingKw * 1000)) * 100)
  const auditNavigation = resolveOperationalAuditNavigation('rack', rack.id)

  const distribution = useMemo(() => {
    const stats: Record<string, Record<string, number>> = {
      status: {},
      type: {},
      environment: {},
      owner: {}
    }
    for (const l of rack.device_locations || []) {
      const d = l.device
      if (!d) continue
      stats.status[d.status] = (stats.status[d.status] || 0) + 1
      stats.type[d.type] = (stats.type[d.type] || 0) + 1
      stats.environment[d.environment] = (stats.environment[d.environment] || 0) + 1
      stats.owner[d.owner || 'Unassigned'] = (stats.owner[d.owner || 'Unassigned'] || 0) + 1
    }
    return stats
  }, [rack.device_locations])

  return (
    <WorkspaceModal
      isOpen={true}
      onClose={onClose}
      size="wide"
      isMaximized={isMaximized}
      onMaximizeToggle={() => setIsMaximized(!isMaximized)}
      title={`${rack.name} Summary`}
      subtitle={`${rack.site_name} · Deployment Unit Report`}
      icon={<BarChart3 size={20} />}
      footerRight={
        <div className="flex items-center gap-2">
          <ModulePolicyLink
            moduleId={auditNavigation?.moduleId || 'logs'}
            to={auditNavigation?.path || '/logs'}
            disabled={!auditNavigation}
            disabledReason="Audit route unavailable."
            aria-label="Open Audit Logs"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] transition-all hover:border-[var(--border-default)] hover:text-[var(--text-primary)]"
          >
            <Activity size={14} /> Open Audit Logs
          </ModulePolicyLink>
          <ToolbarButton onClick={onClose}>Close</ToolbarButton>
        </div>
      }
    >
      <div className="pt-8 space-y-8">
        {/* Capacity Gauges */}
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-black/40 rounded-lg p-6 border border-white/5 space-y-4">
            <div className="flex justify-between items-end">
              <div>
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Space Utilization</p>
                <p className="text-2xl font-black text-white">{fillPct}%</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold text-slate-600 uppercase mb-1">{occupiedU}U Used</p>
                <p className="text-[10px] font-bold text-emerald-400 uppercase">{freeU}U Available</p>
              </div>
            </div>
            <div className="h-1.5 bg-white/5 rounded-lg overflow-hidden">
              <div className={`h-full rounded-lg transition-all ${fillColor(fillPct)}`} style={{ width: `${fillPct}%` }} />
            </div>
          </div>

          <div className="bg-black/40 rounded-lg p-6 border border-white/5 space-y-4">
            <div className="flex justify-between items-end gap-4">
              <div>
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Typical Power Estimate</p>
                <p className="text-2xl font-black text-white">{(typicalPowerW / 1000).toFixed(2)} kW</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold text-slate-600 uppercase mb-1">Configured Rack Ceiling</p>
                <p className="text-[10px] font-bold text-blue-400 uppercase">{configuredRackCeilingKw} kW</p>
              </div>
            </div>
            <div className="h-1.5 bg-white/5 rounded-lg overflow-hidden">
              <div className={`h-full rounded-lg transition-all ${powerColor(typicalEstimatePct)}`} style={{ width: `${Math.min(typicalEstimatePct, 100)}%` }} />
            </div>
            <p className="text-[9px] leading-relaxed text-slate-500">
              Estimate uses mounted device typical-power fields. Live rack/PDU load telemetry unavailable.
            </p>
            {typicalEstimatePct > 100 && (
              <p className="text-[9px] font-bold uppercase tracking-wide text-amber-300">Planning estimate exceeds configured rack ceiling; this is not a measured-load alarm.</p>
            )}
          </div>
        </div>

          {/* Distribution Tables */}
          <div className="grid grid-cols-2 gap-x-12 gap-y-8">
            {Object.entries(distribution).map(([category, data]) => (
              <div key={category} className="space-y-3">
                <h3 className="text-[10px] font-black text-white uppercase tracking-[0.2em] border-l-2 border-blue-500 pl-3 leading-none">{category} Distribution</h3>
                <div className="space-y-1">
                  {Object.entries(data).length === 0 ? (
                    <p className="text-[10px] text-slate-600">No assets mounted</p>
                  ) : (
                    Object.entries(data).sort((a,b) => b[1] - a[1]).map(([label, count]) => (
                      <div key={label} className="flex justify-between items-center py-2 border-b border-white/[0.03]">
                        <span className="text-[11px] font-bold text-slate-400 uppercase">{label}</span>
                        <div className="flex items-center gap-3">
                          <div className="w-24 h-1 bg-white/5 rounded-lg overflow-hidden hidden sm:block">
                            <div className="h-full bg-blue-500/40" style={{ width: `${(count / (rack.device_locations?.length || 1)) * 100}%` }} />
                          </div>
                          <span className="text-[11px] font-black text-white w-6 text-right tabular-nums">{count}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
      </div>
    </WorkspaceModal>
  )
}

// ─── Spatial Map (Top View) ───────────────────────────────────────────────────

const SpatialMap = React.memo(({ racks, onRackClick, siteColor }: { racks: any[]; onRackClick: (rack: any) => void; siteColor?: string }) => {
  // Group racks by Site, then Aisle and Row
  const siteGroups = useMemo(() => {
    const data: Record<string, Record<string, Record<string, any[]>>> = {}
    racks.forEach(r => {
      const siteName = r.site_name || 'Unassigned Site'
      const aisle = r.aisle || 'General'
      const row = r.row || '0'
      if (!data[siteName]) data[siteName] = {}
      if (!data[siteName][aisle]) data[siteName][aisle] = {}
      if (!data[siteName][aisle][row]) data[siteName][aisle][row] = []
      data[siteName][aisle][row].push(r)
    })
    return data
  }, [racks])

  return (
    <div data-rack-spatial-canvas className="relative flex-1 overflow-auto rounded-lg border border-[var(--border-default)] bg-[var(--rack-spatial-canvas)] p-6 custom-scrollbar lg:p-8">
      <div className="flex flex-col gap-12">
        {Object.entries(siteGroups).sort().map(([siteName, aisles]) => (
          <div key={siteName} className="space-y-6">
             <div className="flex min-w-0 items-center gap-4">
                <span aria-hidden="true" className="h-7 w-1 shrink-0 rounded-full bg-[var(--rack-spatial-accent)]" />
                <h2 className="min-w-0 shrink truncate text-lg font-semibold text-[var(--text-primary)]">{siteName}</h2>
                <div aria-hidden="true" className="h-px min-w-8 flex-1 bg-[var(--border-default)]" />
             </div>
             
             <div className="flex flex-col gap-8 pl-5">
                {Object.entries(aisles).sort().map(([aisleName, rows]) => (
                  <div key={aisleName} className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-[var(--text-secondary)]">{aisleName !== 'General' ? `Aisle ${aisleName}` : siteName}</span>
                      <div aria-hidden="true" className="h-px flex-1 bg-[var(--border-subtle)]" />
                    </div>
                    <div className="flex flex-col gap-4">
                      {Object.entries(rows).sort((a,b) => parseInt(a[0]) - parseInt(b[0])).map(([rowNum, rackList]) => (
                        <div key={rowNum} className="flex flex-wrap justify-start gap-3">
                          {rackList.map(rack => {
                            const occupiedU = (rack.device_locations || []).reduce((a: number, l: any) => a + (l.size_u || 1), 0)
                            const totalU = rack.total_u || 42
                            const fillPct = Math.round((occupiedU / totalU) * 100)
                            const isOver = fillPct >= 95
                            const realDevices = (rack.device_locations || []).filter((l: any) => !l.device?.is_reservation).length
                            const reservations = (rack.device_locations || []).filter((l: any) => l.device?.is_reservation).length
                            const estPowerKw = (rack.device_locations || []).reduce((a: number, l: any) => a + ((l.device?.power_typical_w || 0) / 1000), 0)
                            const powerCapKw = rack.max_power_kw || 10
                            const typicalEstimatePct = Math.round((estPowerKw / powerCapKw) * 100)

                            return (
                              <button
                                type="button"
                                key={rack.id}
                                onClick={() => onRackClick(rack)}
                                data-spatial-rack-card
                                data-capacity-warning={isOver ? 'true' : undefined}
                                className={`group relative flex h-36 w-52 flex-col overflow-hidden rounded-lg border bg-[var(--rack-spatial-card)] p-3 text-left shadow-sm transition-[transform,border-color,background-color,box-shadow] duration-150 hover:-translate-y-0.5 hover:bg-[var(--rack-spatial-card-hover)] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] ${isOver ? 'border-[var(--rack-spatial-danger)]' : 'border-[var(--rack-spatial-border)] hover:border-[var(--rack-spatial-accent)]'}`}
                                aria-label={`${rack.name}, ${fillPct}% rack-unit capacity, ${typicalEstimatePct}% typical power estimate`}
                              >
                                <div aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${isOver ? 'bg-[var(--rack-spatial-danger)]' : 'bg-[var(--rack-spatial-accent)]'}`} style={!isOver && (rack.site_color || siteColor) ? { backgroundColor: rack.site_color || siteColor } : undefined} />
                                
                                <div className="mb-3 flex min-w-0 items-start justify-between gap-2 pl-1.5">
                                   <span className="min-w-0 truncate text-sm font-semibold text-[var(--rack-spatial-ink)]">{rack.name}</span>
                                   <div className="flex shrink-0 items-center gap-2 text-right">
                                      <div className="flex flex-col">
                                         <span className="text-xs font-bold leading-none tabular-nums text-[var(--rack-spatial-ink)]">{realDevices}</span>
                                         <span className="mt-1 text-[9px] font-medium leading-none text-[var(--rack-spatial-muted)]">Devices</span>
                                      </div>
                                      {reservations > 0 && <>
                                        <span aria-hidden="true" className="h-6 w-px bg-[var(--border-default)]" />
                                        <div className="flex flex-col">
                                          <span className="text-xs font-bold leading-none tabular-nums text-[var(--rack-spatial-accent)]">{reservations}</span>
                                          <span className="mt-1 text-[9px] font-medium leading-none text-[var(--rack-spatial-muted)]">Reserved</span>
                                        </div>
                                      </>}
                                      {rack.row != null && <span className="rounded-sm border border-[var(--border-default)] px-1.5 py-1 text-[9px] font-medium leading-none text-[var(--rack-spatial-muted)]">Row {rack.row}</span>}
                                   </div>
                                </div>

                                <div className="space-y-3 pl-1.5">
                                   <div className="space-y-1">
                                      <div className="flex items-center justify-between px-0.5">
                                         <span className="text-[10px] font-medium text-[var(--rack-spatial-muted)]">Rack capacity</span>
                                         <span className={`text-[11px] font-semibold tabular-nums ${isOver ? 'text-[var(--rack-spatial-danger)]' : 'text-[var(--rack-spatial-ink)]'}`}>{fillPct}%</span>
                                      </div>
                                      <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-[var(--rack-spatial-track)]">
                                        <div className={`h-full transition-[width,background-color] duration-300 ${isOver ? 'bg-[var(--rack-spatial-danger)]' : 'bg-[var(--rack-spatial-accent)]'}`} style={{ width: `${Math.min(fillPct, 100)}%` }} />
                                      </div>
                                   </div>

                                   <div className="space-y-1">
                                     <div className="flex items-center justify-between px-0.5">
                                       <span className="text-[10px] font-medium text-[var(--rack-spatial-muted)]">Typical power · {powerCapKw} kW cap</span>
                                       <span className={`text-[11px] font-semibold tabular-nums ${typicalEstimatePct >= 100 ? 'text-[var(--rack-spatial-danger)]' : 'text-[var(--rack-spatial-ink)]'}`}>{typicalEstimatePct}%</span>
                                     </div>
                                     <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-[var(--rack-spatial-track)]">
                                       <div className={`h-full transition-[width,background-color] duration-300 ${typicalEstimatePct >= 100 ? 'bg-[var(--rack-spatial-danger)]' : 'bg-[var(--rack-spatial-accent)]'}`} style={{ width: `${Math.min(typicalEstimatePct, 100)}%` }} />
                                     </div>
                                   </div>
                                </div>

                                <div aria-hidden="true" className="absolute bottom-3 right-3 text-[var(--rack-spatial-accent)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                   <ExternalLink size={13} />
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
             </div>
          </div>
        ))}
      </div>
    </div>
  )
})

// ─── Main Component ────────────────────────────────────────────────────────────

export default function Racks() {
  const [showImportModal, setShowImportModal] = useState(false)
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const devicesQuery = useQuery({ queryKey: ['devices'], queryFn: () => fetchRackArray('/api/v1/devices') })
  const sitesQuery = useQuery({ queryKey: ['sites'], queryFn: () => fetchRackArray('/api/v1/sites/') })
  const connectionsQuery = useQuery({ queryKey: ['connections'], queryFn: () => fetchRackArray('/api/v1/networks/connections') })
  const devices = devicesQuery.data
  const sites = sitesQuery.data
  const connections = connectionsQuery.data

  const [searchTerm, setSearchTerm] = useState('')
  const [activeSite, setActiveSite] = useState<number | null>(null)
  const [activeSiteMenu, setActiveSiteMenu] = useState<number | null>(null)
  const siteMenu = useWorkspaceAnchoredLayer(activeSiteMenu !== null, { minWidth: 180 })
  useWorkspacePopupDismiss(activeSiteMenu !== null, siteMenu.triggerRef, siteMenu.panelRef, () => setActiveSiteMenu(null))
  const [isAddingSite, setIsAddingSite] = useState(false)
  const [viewMode, setViewMode] = useState<'elevation' | 'spatial'>('elevation')
  const [isPlanMode, setIsPlanMode] = useState(false)
  const [isPlanInitialized, setIsPlanInitialized] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [activePlanId, setActivePlanId] = useState<number | null>(null)
  const [virtualRacks, setVirtualRacks] = useState<any[]>([])

  const addDeviceToPlan = (rackId: number, deviceId: number, startU: number, sizeU: number, orientation: string) => {
    const placementConflict = getVirtualPlacementConflict({
      racks: virtualRacks,
      rackId,
      deviceId,
      startUnit: startU,
      sizeU
    })
    if (placementConflict) {
      toast.error(placementConflict)
      return
    }

    const device = devices?.find((candidate: any) => candidate.id === deviceId)
    setVirtualRacks(prev => prev.map(r => {
      const existingLocations = (r.device_locations || []).filter(
        (location: any) => String(location.device_id) !== String(deviceId)
      )
      if (r.id !== rackId) return { ...r, device_locations: existingLocations }

      return {
        ...r,
        device_locations: [
          ...existingLocations,
          { device_id: deviceId, start_unit: startU, size_u: sizeU, orientation, device }
        ]
      }
    }))
    setHasUnsavedChanges(true)
  }

  const addReservationToPlan = (rackId: number, startU: number, sizeU: number, name: string, date: string, poc: string) => {
    const placementConflict = getVirtualPlacementConflict({
      racks: virtualRacks,
      rackId,
      startUnit: startU,
      sizeU
    })
    if (placementConflict) {
      toast.error(placementConflict)
      return
    }

    setVirtualRacks(prev => prev.map(r => {
      if (r.id !== rackId) return r

      return {
        ...r,
        device_locations: [
          ...(r.device_locations || []),
          { is_reservation: true, start_unit: startU, size_u: sizeU, temporary_name: name, est_racking_date: date, poc_name: poc }
        ]
      }
    }))
    setHasUnsavedChanges(true)
  }

  const [showDiff, setShowDiff] = useState(false)
  const [sandboxRackIds, setSandboxRackIds] = useState<number[]>([])
  const [showOnlySandbox, setShowOnlySandbox] = useState(false)
  const [showPlanList, setShowPlanList] = useState(false)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const addMenu = useWorkspaceAnchoredLayer(showAddMenu, { minWidth: 180 })
  useWorkspacePopupDismiss(showAddMenu, addMenu.triggerRef, addMenu.panelRef, () => setShowAddMenu(false))
  const [planDraftName, setPlanDraftName] = useState('')
  const [isCreatingPlan, setIsCreatingPlan] = useState<'blank' | 'asis' | null>(null)
  const plansQuery = useQuery({
    queryKey: ['infra-plans'], 
    queryFn: () => fetchRackArray('/api/v1/racks/plans')
  })
  const plansData = plansQuery.data
  const refetchPlans = plansQuery.refetch
  const plans = useMemo(() => {
    return (plansData || []).map((p: any) => ({
      ...p,
      racks: p.racks_config,
      racksData: typeof p.virtual_racks_data === 'string' ? JSON.parse(p.virtual_racks_data) : p.virtual_racks_data,
      date: formatAppDate(p.plan_date)
    }))
  }, [plansData])

  const savePlanMutation = useMutation({
    mutationFn: async (plan: any) => {
      const res = await apiFetch('/api/v1/racks/plans', {
        method: 'POST',
        body: JSON.stringify(plan)
      })
      return res.json()
    },
    onSuccess: () => {
      refetchPlans()
      toast.success("Plan saved to archive")
    }
  })

  const deletePlanMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiFetch(`/api/v1/racks/plans/${id}`, { method: 'DELETE' })
    },
    onSuccess: () => {
      refetchPlans()
      toast.success("Plan removed from archive")
    }
  })
  const [isComparing, setIsComparing] = useState(false)
  const [diffBaseVersion, setDiffBaseVersion] = useState<number | null>(null)
  const [diffTargetVersion, setDiffTargetVersion] = useState<number | null>(null)
  const [impactAssetId, setImpactAssetId] = useState<number | null>(null)
  const [impactCoords, setImpactCoords] = useState<{ x: number; y: number } | null>(null)
  const [showLabelGenerator, setShowLabelGenerator] = useState(false)
  const [newSite, setNewSite] = useState({ name: '', address: '', color: '#3b82f6' })
  const [isEditingSite, setIsEditingSite] = useState<any>(null)
  const [isAddingRack, setIsAddingRack] = useState(false)
  const [newRack, setNewRack] = useState({ 
    name: '', aisle: '', row: '', total_u: 42, max_power_kw: 10.0, site_id: '',
    pdu_a_name: 'PDU-A', pdu_b_name: 'PDU-B', pdu_a_cap_kw: 10.0, pdu_b_cap_kw: 10.0
  })
  const [isEditingRack, setIsEditingRack] = useState<any>(null)
  const { confirm: confirmEditorClose, confirmation: editorConfirmation } = useWorkspaceConfirmation()
  const editorBaseline = useRef({ site: '', rack: '' })
  useEffect(() => {
    if (isAddingSite || isEditingSite) editorBaseline.current.site = JSON.stringify(isEditingSite || newSite)
  }, [isAddingSite, isEditingSite?.id])
  useEffect(() => {
    if (isAddingRack || isEditingRack) editorBaseline.current.rack = JSON.stringify(isEditingRack || newRack)
  }, [isAddingRack, isEditingRack?.id])
  const closeSiteEditor = async () => {
    if (JSON.stringify(isEditingSite || newSite) !== editorBaseline.current.site
      && !await confirmEditorClose({ title: 'Discard site changes?', message: 'Your site changes have not been saved.', confirmText: 'Discard changes', cancelText: 'Keep editing', variant: 'warning' })) return
    setIsAddingSite(false); setIsEditingSite(null)
  }
  const closeRackEditor = async () => {
    if (JSON.stringify(isEditingRack || newRack) !== editorBaseline.current.rack
      && !await confirmEditorClose({ title: 'Discard rack changes?', message: 'Your rack changes have not been saved.', confirmText: 'Discard changes', cancelText: 'Keep editing', variant: 'warning' })) return
    setIsAddingRack(false); setIsEditingRack(null)
  }
  const [isProvisioning, setIsProvisioning] = useState<any>(null)
  const [provisionMode, setProvisionMode] = useState<'asset' | 'reserve'>('asset')
  const [reserveInfo, setReserveInfo] = useState({ temporary_name: '', est_date: '', poc: '' })

  const [managingDevice, setManagingDevice] = useState<{ device: any; loc: any; rack: any } | null>(null)
  const [showingRackInfo, setShowingRackInfo] = useState<any>(null)
  const [showCompareOnly, setShowCompareOnly] = useState(false)
  const [activeTab, setActiveTab] = useState<'active' | 'deleted'>('active')
  const [selectedRacks, setSelectedRacks] = useState<number[]>([])
  const [rackWidth, setRackWidth] = useState(208)
  const [visibleRackGroupRange, setVisibleRackGroupRange] = useState({ start: 0, end: 12 })
  const racksGridRef = useRef<HTMLDivElement>(null)
  const [rackScrollState, setRackScrollState] = useState({ canScrollLeft: false, canScrollRight: false })
  const [showRelocateModal, setShowRelocateModal] = useState(false)
  const [mountSearch, setMountSearch] = useState('')
  const [showAuditLogs, setShowAuditLogs] = useState(false)
  
  const [optionsMenu, setOptionsMenu] = useState<{ x: number; y: number; device: any; loc: any; rack: any } | null>(null)
  const [focusedConnection, setFocusedConnection] = useState<{ sourceId: number; targetIds: number[] } | null>(null)
  const [showConnectionsList, setShowConnectionsList] = useState(false)
  const [viewingConnection, setViewingConnection] = useState<any>(null)

  const [restoreWizard, setRestoreWizard] = useState<{
    step: 'site-select' | 'name-conflict' | 'asset-warning' | null
    ids: number[]
    targetSiteId?: number
    nameConflicts: Array<{ rackId: number; rackName: string; newName: string }>
    assetWarnings: Array<{ rackName: string; devices: string[] }>
    generalAssetWarning: boolean
  } | null>(null)
  const [confirmModal, setConfirmModal] = useState<any>({ isOpen: false, title: '', message: '', onConfirm: () => {}, variant: 'info' })

  const openConfirm = useCallback((title: string, message: string, onConfirm: () => void, variant: any = 'danger') => {
    setConfirmModal({ isOpen: true, title, message, onConfirm, variant })
  }, [])

  const racksQuery = useQuery({
    queryKey: ['racks-all'],
    queryFn: () => fetchRackArray('/api/v1/racks/?include_deleted=true')
  })
  const allRacks = racksQuery.data

  const openRackInfo = useCallback((rack: any) => {
    setShowingRackInfo(rack)
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set('id', String(rack.id))
    setSearchParams(nextSearchParams)
  }, [searchParams, setSearchParams])

  const closeRackInfo = useCallback(() => {
    setShowingRackInfo(null)
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('id')
    setSearchParams(nextSearchParams)
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (!allRacks) return
    const requestedRackId = searchParams.get('id')
    if (!requestedRackId) {
      if (showingRackInfo) setShowingRackInfo(null)
      return
    }

    const authoritativeRack = allRacks.find((rack: any) => String(rack.id) === requestedRackId)
    if (!authoritativeRack) {
      setShowingRackInfo(null)
      const nextSearchParams = new URLSearchParams(searchParams)
      nextSearchParams.delete('id')
      setSearchParams(nextSearchParams, { replace: true })
      return
    }

    setActiveTab(authoritativeRack.is_deleted ? 'deleted' : 'active')
    setActiveSite(authoritativeRack.site_id ?? null)
    setShowingRackInfo((current) => current === authoritativeRack ? current : authoritativeRack)
  }, [allRacks, searchParams, setSearchParams, showingRackInfo])

  const { activeRacks, deletedRacks } = useMemo(() => {
    if (!allRacks) return { activeRacks: [], deletedRacks: [] }
    return {
      activeRacks: allRacks.filter((r: any) => !r.is_deleted),
      deletedRacks: allRacks.filter((r: any) => r.is_deleted)
    }
  }, [allRacks])

  const racks = activeTab === 'active' ? activeRacks : deletedRacks

  const displayedRacks = useMemo(() => {
    let filtered = isPlanInitialized ? virtualRacks : racks
    
    // 1. Connection-specific filtering: If focusing a connection, only show involved racks
    if (focusedConnection) {
      const involvedIds = new Set([focusedConnection.sourceId, ...focusedConnection.targetIds].map(String))
      filtered = filtered.filter((r: any) => 
        r.device_locations?.some((l: any) => involvedIds.has(String(l.device_id)))
      )
    }

    if (activeSite && activeTab === 'active' && !showCompareOnly && !focusedConnection && !showOnlySandbox) {
      filtered = filtered.filter((r: any) => r.site_id === activeSite)
    }
    if (showCompareOnly && !focusedConnection) {
      filtered = filtered.filter((r: any) => selectedRacks.includes(r.id))
    }
    if (showOnlySandbox && !focusedConnection) {
      filtered = filtered.filter((r: any) => sandboxRackIds.includes(r.id))
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter((r: any) =>
        r.name.toLowerCase().includes(term) ||
        r.device_locations?.some((l: any) => l.device?.name?.toLowerCase().includes(term))
      )
    }
    return filtered
  }, [racks, virtualRacks, isPlanInitialized, activeSite, showCompareOnly, selectedRacks, searchTerm, activeTab, focusedConnection, showOnlySandbox, sandboxRackIds])

  const availableDevices = useMemo(() => {
    let list = devices?.filter((d: any) => !d.is_deleted && d.status !== 'Decommissioned')
    if (isPlanInitialized) {
       const mounted = new Set()
       virtualRacks.forEach(vr => vr.device_locations?.forEach((l: any) => mounted.add(String(l.device_id))))
       list = list?.filter((d: any) => !mounted.has(String(d.id)))
    }
    return list
  }, [devices, isPlanInitialized, virtualRacks])

  const renderedRacks = useMemo(() => {
    if (!isPlanInitialized) return displayedRacks
    return displayedRacks.filter((r: any) => sandboxRackIds.includes(r.id))
  }, [displayedRacks, isPlanInitialized, sandboxRackIds])
  const isRackDiffActive = showDiff || !!diffBaseVersion
  const isRackGroupedView = viewMode === 'elevation'
    && !searchTerm
    && !focusedConnection
    && !showCompareOnly
    && !isRackDiffActive
  const rackGroups = useMemo(() => {
    const grouped: Record<string, any[]> = {}
    renderedRacks.forEach((rack: any) => {
      const siteName = rack.site_name || 'UNASSIGNED SITE'
      const groupName = rack.aisle ? `${siteName} · AISLE ${rack.aisle}` : siteName
      if (!grouped[groupName]) grouped[groupName] = []
      grouped[groupName].push(rack)
    })

    let nextOffset = 0
    return Object.entries(grouped).sort().map(([groupName, groupRacks]) => {
      const width = groupRacks.length * rackWidth + Math.max(0, groupRacks.length - 1) * RACK_CARD_GAP
      const group = { groupName, groupRacks, offset: nextOffset, width }
      nextOffset += width + RACK_GROUP_GAP
      return group
    })
  }, [renderedRacks, rackWidth])
  const updateVisibleRackGroupRange = useCallback(() => {
    const rail = racksGridRef.current
    if (!rail || !isRackGroupedView || rackGroups.length === 0) return

    const overscan = Math.ceil(rail.clientWidth * 1.25)
    const visibleStart = Math.max(0, rail.scrollLeft - overscan)
    const visibleEnd = rail.scrollLeft + rail.clientWidth + overscan
    let start = rackGroups.findIndex(group => group.offset + group.width >= visibleStart)
    if (start < 0) start = rackGroups.length - 1
    let end = start
    while (end < rackGroups.length && rackGroups[end].offset <= visibleEnd) end += 1
    end = Math.max(start + 1, end)

    setVisibleRackGroupRange(current => current.start === start && current.end === end
      ? current
      : { start, end })
  }, [isRackGroupedView, rackGroups])
  const updateRackScrollControls = useCallback(() => {
    const rail = racksGridRef.current
    if (!rail) return
    const next = {
      canScrollLeft: rail.scrollLeft > 2,
      canScrollRight: rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 2,
    }
    setRackScrollState(current => current.canScrollLeft === next.canScrollLeft && current.canScrollRight === next.canScrollRight ? current : next)
  }, [])
  const updateRackViewport = useCallback(() => {
    updateRackScrollControls()
    updateVisibleRackGroupRange()
  }, [updateRackScrollControls, updateVisibleRackGroupRange])
  useEffect(() => {
    const rail = racksGridRef.current
    if (!rail) return
    updateRackViewport()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateRackViewport)
    observer?.observe(rail)
    return () => {
      observer?.disconnect()
    }
  }, [displayedRacks.length, rackWidth, viewMode, updateRackViewport])
  const scrollRackRail = (direction: number) => {
    const rail = racksGridRef.current
    if (!rail) return
    rail.scrollBy({ left: direction * Math.max(240, Math.floor(rail.clientWidth * 0.8)), behavior: 'smooth' })
  }

  const getPlanDeviceLocation = useCallback((deviceId: number) => {
    for (const r of virtualRacks) {
      const loc = r.device_locations?.find((l: any) => l.device_id === deviceId)
      if (loc) return { rackName: r.name, uStart: loc.start_unit }
    }
    return null
  }, [virtualRacks])

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const mountMutation = useMutation({
    mutationFn: async (data: any) => {
      const { rackId, ...rest } = data
      
      let finalDeviceId = rest.device_id
      let finalDevice = devices?.find((d: any) => String(d.id) === String(finalDeviceId))
      
      // If reserving a new slot
      if (provisionMode === 'reserve') {
        const resDev = await apiFetch('/api/v1/devices/', {
          method: 'POST',
          body: JSON.stringify({
            name: reserveInfo.temporary_name || `RESERVE-${Date.now().toString().slice(-4)}`,
            system: 'RESERVATION',
            type: 'Physical',
            status: 'Active',
            is_reservation: true,
            reservation_info: {
              poc: reserveInfo.poc,
              est_date: reserveInfo.est_date
            },
            serial_number: `RES-${Date.now()}`,
            asset_tag: `RES-${Date.now()}`
          })
        })
        const newDev = await resDev.json()
        finalDeviceId = newDev.id
        finalDevice = newDev
      }

      if (!finalDeviceId) throw new Error('DEVICE_REQUIRED')

      const payload = { 
        ...rest, 
        device_id: finalDeviceId,
        start_unit: rest.start_u, // Critical mapping for virtual state rendering
        size_u: rest.size_u || 1,
        orientation: rest.orientation || 'Front',
        depth: rest.depth || 'Full'
      }

      // If in sandbox mode, update virtual state instead of API
      if (isPlanInitialized) {
        const placementConflict = getVirtualPlacementConflict({
          racks: virtualRacks,
          rackId,
          deviceId: finalDeviceId,
          startUnit: payload.start_unit,
          sizeU: payload.size_u
        })
        if (placementConflict) throw new Error(placementConflict)

        setVirtualRacks(prev => prev.map(r => {
          // Remove from ALL racks first to prevent duplicates/multi-mounting
          const cleanedLocs = (r.device_locations || []).filter((l:any) => String(l.device_id) !== String(finalDeviceId))

          if (r.id !== rackId) return { ...r, device_locations: cleanedLocs }

          return { ...r, device_locations: [...cleanedLocs, { ...payload, device: finalDevice }] }
        }))
        return { message: 'VIRTUAL_SUCCESS' }
      }

      const res = await apiFetch(`/api/v1/racks/${rackId}/mount`, { method: 'POST', body: JSON.stringify(payload) })
      return res.json()
    },
    onSuccess: (data) => {
      if (data.message === 'VIRTUAL_SUCCESS') {
        toast.success(provisionMode === 'reserve' ? 'Virtual space reserved' : 'Virtual asset mounted')
      } else {
        queryClient.invalidateQueries({ queryKey: ['racks-all'] })
        queryClient.invalidateQueries({ queryKey: ['devices'] })
        toast.success(provisionMode === 'reserve' ? 'Space reserved successfully' : 'Asset mounted successfully')
      }
      setIsProvisioning(null)
      setReserveInfo({ temporary_name: '', est_date: '', poc: '' })
    },
    meta: { handlesErrorToast: true },
    onError: (e: any) => {
      if (e.data?.type === 'RELOCATION_CONFLICT') {
        const device = devices?.find((d: any) => String(d.id) === String(e.data.payload.device_id))
        const msg = `${device?.name || 'Asset'} is currently at ${e.data.detail}.\n\nDo you want to relocate it to this new position?`
        
        openConfirm(
          'Relocate Asset', 
          msg,
          () => mountMutation.mutate({ ...e.data.payload, relocate: true, rackId: e.data.rackId }), 
          'warning'
        )
      } else if (e.message === 'DEVICE_REQUIRED') toast.error('Select an asset first')
      else toast.error(e.message || 'Mounting failed')
    }
  })

  const siteMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = data.id
        ? await apiFetch(`/api/v1/sites/${data.id}`, { method: 'PUT', body: JSON.stringify(data) })
        : await apiFetch('/api/v1/sites/', { method: 'POST', body: JSON.stringify(data) })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] })
      queryClient.invalidateQueries({ queryKey: ['racks-all'] })
      setIsAddingSite(false)
      setIsEditingSite(null)
      setNewSite({ name: '', address: '', color: '#3b82f6' })
      toast.success('Site saved')
    },
    meta: { handlesErrorToast: true },
    onError: (e: any) => toast.error(e.message)
  })

  const deleteSiteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiFetch(`/api/v1/sites/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (_data, deletedSiteId) => {
      if (activeSite === deletedSiteId) {
        setActiveSite(null)
      }
      setActiveSiteMenu(null)
      queryClient.invalidateQueries({ queryKey: ['sites'] })
      queryClient.invalidateQueries({ queryKey: ['racks-all'] })
      toast.success('Site decommissioned')
    },
    meta: { handlesErrorToast: true },
    onError: (e: any) => toast.error(e.message)
  })

  const rackMutation = useMutation({
    mutationFn: async (data: any) => {
      const baseline = data.id ? JSON.parse(editorBaseline.current.rack || '{}') : {}
      const payload = data.id ? Object.fromEntries(Object.entries(data).filter(([key, value]) => !Object.is(value, baseline[key]))) : data
      const res = data.id
        ? await apiFetch(`/api/v1/racks/${data.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await apiFetch('/api/v1/racks/', { method: 'POST', body: JSON.stringify(payload) })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || 'Failed to save rack')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['racks-all'] })
      setIsAddingRack(false)
      setIsEditingRack(null)
      setNewRack({ 
        name: '', aisle: '', row: '', total_u: 42, max_power_kw: 10.0, site_id: '',
        pdu_a_name: 'PDU-A', pdu_b_name: 'PDU-B', pdu_a_cap_kw: 10.0, pdu_b_cap_kw: 10.0
      })
      toast.success('Rack saved')
    },
    meta: { handlesErrorToast: true },
    onError: (e: any) => toast.error(e.message)
  })

  const bulkActionMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiFetch('/api/v1/racks/bulk-action', { method: 'POST', body: JSON.stringify(data) })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['racks-all'] })
      setShowRelocateModal(false)
      setRestoreWizard(null)
      const conflictIds = Array.isArray(data?.conflicts) ? data.conflicts : []
      const hasPartialConflict = (variables.action === 'restore' || variables.action === 'relocate') && conflictIds.length > 0

      if (hasPartialConflict) {
        setSelectedRacks(conflictIds)
        toast.error(`Completed with follow-up required: ${conflictIds.length} rack(s) still need attention`)
        return
      }

      setSelectedRacks([])
      toast.success('Action completed')
    },
    meta: { handlesErrorToast: true },
    onError: (e: any) => toast.error(e.message)
  })

  const handleRackDelete = useCallback((rack: any) => {
    const action = activeTab === 'deleted' ? 'purge' : 'delete'
    const title = action === 'purge' ? 'Purge Rack' : 'Decommission Rack'
    const message = action === 'purge'
      ? `Permanently delete rack "${rack.name}"? This cannot be undone.`
      : `Mark rack "${rack.name}" as decommissioned?`
    openConfirm(title, message, () => bulkActionMutation.mutate({ action, ids: [rack.id] }))
  }, [activeTab, bulkActionMutation.mutate, openConfirm])

  const handleRackEdit = useCallback((rack: any) => {
    setIsEditingRack({ ...rack, total_u: rack.total_u })
  }, [])

  const handlePlanRackEdit = useCallback((rack: any) => {
    if (isPlanInitialized) setIsEditingRack({ ...rack, total_u: rack.total_u })
  }, [isPlanInitialized])

  const handleRackMount = useCallback((rackId: number, u: number) => {
    setIsProvisioning({ rackId, start_u: u, size_u: 1, orientation: 'Front', depth: 'Full' })
    setProvisionMode('asset')
  }, [])

  const handlePlanRackMount = useCallback((rackId: number, u: number) => {
    if (isPlanInitialized) setIsProvisioning({ rackId, start_u: u, size_u: 1, orientation: 'Front', depth: 'Full' })
  }, [isPlanInitialized])

  const handleRackDeviceManage = useCallback((device: any, loc: any, rack: any, event: React.MouseEvent) => {
    setOptionsMenu({ x: event.clientX, y: event.clientY, device, loc, rack })
    setImpactAssetId(device.id)
    setImpactCoords({ x: event.clientX, y: event.clientY })
  }, [])

  const handleRackSelectionToggle = useCallback((id: number) => {
    setSelectedRacks((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }, [])

  const handleRackRestore = useCallback((id: number) => {
    setRestoreWizard({ step: 'site-select', ids: [id], nameConflicts: [], assetWarnings: [], generalAssetWarning: false })
  }, [])

  const proceedRestoreWizard = (targetSiteId?: number) => {
    if (!restoreWizard) return
    const ids = restoreWizard.ids
    const activeRackNames = new Set(activeRacks.map((r: any) => r.name))
    const nameConflicts = deletedRacks
      .filter((r: any) => ids.includes(r.id) && activeRackNames.has(r.name))
      .map((r: any) => ({ rackId: r.id, rackName: r.name, newName: r.name }))
    const assetWarnings = deletedRacks
      .filter((r: any) => ids.includes(r.id) && r.device_locations?.length > 0)
      .map((r: any) => ({ rackName: r.name, devices: r.device_locations.map((l: any) => l.device?.name).filter(Boolean) }))

    if (nameConflicts.length > 0 && restoreWizard.step === 'site-select') {
      setRestoreWizard({ ...restoreWizard, step: 'name-conflict', targetSiteId, nameConflicts, assetWarnings, generalAssetWarning: assetWarnings.length > 0 })
    } else if (assetWarnings.length > 0 && restoreWizard.step !== 'asset-warning') {
      setRestoreWizard({ ...restoreWizard, step: 'asset-warning', targetSiteId, nameConflicts: restoreWizard.nameConflicts, assetWarnings, generalAssetWarning: true })
    } else {
      executeRestore(ids, targetSiteId)
    }
  }

  const executeRestore = (ids: number[], targetSiteId?: number) => {
    const renames: Record<string, string> = {}
    if (restoreWizard?.nameConflicts) {
      for (const nc of restoreWizard.nameConflicts) {
        if (nc.newName !== nc.rackName) renames[String(nc.rackId)] = nc.newName
      }
    }
    bulkActionMutation.mutate({
      action: 'restore',
      ids,
      payload: { new_site_id: targetSiteId, renames }
    })
  }

  const updateMountMutation = useMutation({
    mutationFn: async ({ rackId, device_id, start_u, size_u, orientation, depth }: any) => {
      if (isPlanInitialized) {
        const placementConflict = getVirtualPlacementConflict({
          racks: virtualRacks,
          rackId,
          deviceId: device_id,
          startUnit: start_u,
          sizeU: size_u,
          excludeDeviceId: device_id
        })
        if (placementConflict) throw new Error(placementConflict)

        setVirtualRacks(prev => prev.map(r => {
          if (r.id !== rackId) return r
          const loc = r.device_locations?.find((l: any) => l.device_id === device_id)
          if (!loc) return r
          const newLoc = { ...loc, start_unit: start_u, size_u, orientation, depth }
          return {
            ...r,
            device_locations: (r.device_locations || []).map((l: any) => l.device_id === device_id ? newLoc : l)
          }
        }))
        return { message: 'VIRTUAL_SUCCESS' }
      }
      const res = await apiFetch(`/api/v1/racks/${rackId}/mount`, {
        method: 'POST',
        body: JSON.stringify({ device_id, start_u, size_u, orientation, depth, relocate: true })
      })
      return res.json()
    },
    onSuccess: (data) => {
      if (data.message === 'VIRTUAL_SUCCESS') {
        toast.success('Virtual mount updated')
      } else {
        queryClient.invalidateQueries({ queryKey: ['racks-all'] })
        queryClient.invalidateQueries({ queryKey: ['devices'] })
        toast.success('Mount updated')
      }
      setManagingDevice(null)
    },
    meta: { handlesErrorToast: true },
    onError: (e: any) => toast.error(e.message)
  })

  const siteReorderMutation = useMutation({
    mutationFn: async (ids: number[]) => apiFetch('/api/v1/sites/reorder', { method: 'POST', body: JSON.stringify({ ids }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sites'] })
  })

  const rackReorderMutation = useMutation({
    mutationFn: async ({ siteId, ids }: { siteId: number; ids: number[] }) => 
      apiFetch(`/api/v1/sites/${siteId}/racks/reorder`, { method: 'POST', body: JSON.stringify({ ids }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['racks-all'] })
  })

  const moveSite = (id: number, direction: 'left' | 'right') => {
    if (!sites) return
    const index = sites.findIndex((s: any) => s.id === id)
    if (index === -1) return
    const arr = [...sites]
    const ni = direction === 'left' ? index - 1 : index + 1
    if (ni < 0 || ni >= arr.length) return
    ;[arr[index], arr[ni]] = [arr[ni], arr[index]]
    siteReorderMutation.mutate(arr.map((s: any) => s.id))
  }

  const moveRack = (id: number, direction: 'left' | 'right') => {
    const rack = activeRacks?.find((r: any) => r.id === id)
    if (!rack || !rack.site_id) return
    const siteRacks = activeRacks?.filter((r: any) => r.site_id === rack.site_id) || []
    const index = siteRacks.findIndex((r: any) => r.id === id)
    if (index === -1) return
    const arr = [...siteRacks]
    const ni = direction === 'left' ? index - 1 : index + 1
    if (ni < 0 || ni >= arr.length) return
    ;[arr[index], arr[ni]] = [arr[ni], arr[index]]
    rackReorderMutation.mutate({ siteId: rack.site_id, ids: arr.map((r: any) => r.id) })
  }

  const focusedDeviceConnections = useMemo(() => {
    if (!focusedConnection || !connections) return []
    return connections.filter((c: any) => 
      c.source_device_id === focusedConnection.sourceId || 
      c.target_device_id === focusedConnection.sourceId
    )
  }, [focusedConnection, connections])

  const focusedDeviceName = useMemo(() => {
    if (!focusedConnection || !devices) return ''
    return devices.find((d: any) => d.id === focusedConnection.sourceId)?.name || ''
  }, [focusedConnection, devices])

  const [patchSource, setPatchSource] = useState<{ deviceId: number; port: string; rackId: number; name: string } | null>(null)

  const bulkPatchMutation = useMutation({
    mutationFn: async (conns: any[]) => {
      const res = await apiFetch('/api/v1/racks/bulk-patch', { method: 'POST', body: JSON.stringify({ connections: conns }) })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] })
      toast.success('Patch cables created')
      setPatchSource(null)
    }
  })

  // ── Render ────────────────────────────────────────────────────────────────────

  const isMaskMode = isPlanInitialized || !!diffBaseVersion
  const handleSpatialRackClick = useCallback((rack: any) => {
    setActiveSite(rack.site_id)
    setViewMode('elevation')
    window.setTimeout(() => {
      document.querySelector(`[data-rack-id="${rack.id}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'center' })
    }, 100)
  }, [])
  const spatialSiteColor = useMemo(
    () => activeSite ? sites?.find((site: any) => site.id === activeSite)?.color : undefined,
    [activeSite, sites]
  )

  const supportQueries = [
    { label: 'Device choices', query: devicesQuery },
    { label: 'Sites', query: sitesQuery },
    { label: 'Network connections', query: connectionsQuery },
  ]
  const failedSupportQueries = supportQueries.filter(({ query }) => query.isError)
  const rackPageHeader = (
    <PageHeader
      eyebrow="Infrastructure"
      title="Racks"
      titleIcon={Server}
      subtitle="Physical capacity and spatial intelligence"
      className={isMaskMode ? 'opacity-40 grayscale pointer-events-none' : ''}
      actions={activeTab === 'active' && allRacks && !isMaskMode ? (
        <>
          <ToolbarIconButton disabled={!allRacks} title="Import Bulk" onClick={() => setShowImportModal(true)}>
            <Upload size={16} />
          </ToolbarIconButton>
          <ToolbarButton disabled={!allRacks} onClick={() => setShowAuditLogs(true)}>
            <BarChart3 size={14} className="mr-2 inline-block" /> Logs
          </ToolbarButton>
          <div className="relative shrink-0">
            <ToolbarButton ref={addMenu.triggerRef as any} disabled={!allRacks} variant="primary" aria-expanded={showAddMenu} onClick={() => setShowAddMenu(!showAddMenu)}>
              <Plus size={14} className="mr-2 inline-block" /> Add
            </ToolbarButton>
            {showAddMenu && allRacks && createPortal(
              <div ref={addMenu.panelRef} style={addMenu.panelStyle} data-workspace-panel="true">
                <div className="bg-slate-900 border border-white/10 rounded-lg shadow-2xl overflow-hidden p-1.5 min-w-[140px]">
                  <button
                    onClick={() => {
                      setNewRack({
                        name: '', aisle: '', row: '', total_u: 42, site_id: activeSite ? String(activeSite) : '', max_power_kw: 10.0,
                        pdu_a_name: 'PDU-A', pdu_b_name: 'PDU-B', pdu_a_cap_kw: 10.0, pdu_b_cap_kw: 10.0
                      })
                      setIsAddingRack(true)
                      setShowAddMenu(false)
                    }}
                    className="w-full text-left px-3 py-2.5 text-[9px] font-black uppercase text-blue-400 hover:bg-blue-500/10 rounded-lg flex items-center gap-3 transition-all"
                  >
                    <Server size={14} /> Add Rack
                  </button>
                  <button
                    onClick={() => { setNewSite({ name: '', address: '', color: '#3b82f6' }); setIsAddingSite(true); setShowAddMenu(false) }}
                    className="w-full text-left px-3 py-2.5 text-[9px] font-black uppercase text-emerald-400 hover:bg-emerald-500/10 rounded-lg flex items-center gap-3 transition-all"
                  >
                    <MapPin size={14} /> Add Site
                  </button>
                </div>
              </div>, document.body
            )}
          </div>
        </>
      ) : null}
    />
  )

  if (!allRacks) {
    return (
      <div data-golden-workspace="racks" className="h-auto min-h-full min-w-0 flex flex-col gap-4 overflow-visible md:h-full md:min-h-0 md:overflow-y-auto">
        {rackPageHeader}
        <div className="flex flex-1 items-center justify-center rounded-lg border border-[var(--grid-border)] bg-[var(--panel-item-bg)] p-8">
          <RackDataState
            label="Rack records"
            isLoading={!racksQuery.isError}
            isError={racksQuery.isError}
            isFetching={racksQuery.isFetching}
            onRetry={() => void racksQuery.refetch()}
          />
        </div>
      </div>
    )
  }

  return (
    <div data-golden-workspace="racks" className="h-auto min-h-full min-w-0 flex flex-col gap-4 overflow-visible md:h-full md:min-h-0 md:overflow-y-auto">
      {editorConfirmation}
      
      {isPlanMode && (
        <PlanBanner 
           onAbort={() => { 
             setIsPlanMode(false); 
             setIsPlanInitialized(false); 
             setSelectedRacks([]); 
             setSandboxRackIds([]); 
             setShowOnlySandbox(false);
             setVirtualRacks([]);
             setShowDiff(false);
             setActivePlanId(null);
             setPlanDraftName('');
           }}
           onSave={() => {
              const name = planDraftName || `Plan ${plans.length + 1} (${new Date().toLocaleDateString()})`
              savePlanMutation.mutate({
                id: activePlanId,
                name,
                racks: sandboxRackIds,
                racksData: virtualRacks
              })
           }}
           planName={planDraftName}
           onNameChange={setPlanDraftName}

           onProceed={() => {
              const siteRacks = activeSite ? (activeRacks || []).filter((r: any) => r.site_id === activeSite) : (activeRacks || [])

              const virtualized = siteRacks.map((r: any) => {
                if (selectedRacks.includes(r.id)) {
                  // Clone as-is
                  return JSON.parse(JSON.stringify(r))
                } else {
                  // Blank
                  return { ...r, device_locations: [] }
                }
              })

              setVirtualRacks(virtualized)
              setSandboxRackIds(siteRacks.map(r => r.id))
              setIsPlanInitialized(true)
              setSelectedRacks([])
              setShowOnlySandbox(false)
              setIsCreatingPlan(null)
              setPlanDraftName(`Strategic Plan ${new Date().toLocaleDateString()}`)
              toast.success(`Imported ${selectedRacks.length} Live Racks into Plan Matrix`)
           }}
           selectedCount={selectedRacks.length}
           isInitialized={isPlanInitialized}
           showOnlySandbox={showOnlySandbox}
           onToggleShowOnly={setShowOnlySandbox}
           showDiff={showDiff}
           onToggleDiff={setShowDiff}
        />
      )}

      {diffBaseVersion && (
        <motion.div 
          initial={{ y: -50, opacity: 0 }} 
          animate={{ y: 0, opacity: 1 }}
          className="fixed top-0 inset-x-0 z-[100] bg-blue-600/95 backdrop-blur-xl border-b border-blue-400/30 py-4 flex items-center justify-center gap-12 shadow-2xl"
        >
           <div className="flex items-center gap-4">
              <div className="p-2 bg-white/10 rounded-lg border border-white/20">
                 <History size={20} className="text-white" />
              </div>
              <div>
                 <h3 className="text-sm font-black uppercase tracking-tighter text-white leading-none">Infrastructure <span className="text-blue-200">Time Machine</span></h3>
                 <p className="text-[9px] font-bold text-blue-200 uppercase tracking-widest mt-1">
                    Temporal Configuration Analysis Active
                 </p>
              </div>
           </div>
           <button onClick={() => { setDiffBaseVersion(null); setDiffTargetVersion(null); }} className="px-8 py-2 bg-white text-blue-600 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-lg active:scale-95 transition-all">
              Exit Time Machine
           </button>
        </motion.div>
      )}

      {/* ── Page Header ── */}
      {rackPageHeader}

      {/* ── Page Toolbar ── */}
      <PageToolbar 
        wrapOnMobile
        className={`shrink-0 ${isMaskMode ? 'opacity-40 grayscale pointer-events-none' : ''}`}
        left={
          <>
            <ToolbarSegmented 
              options={[
                { label: 'Active', value: 'active' },
                { label: 'Purged', value: 'deleted' }
              ]}
              value={activeTab}
              onChange={(val: any) => { setActiveTab(val); setSelectedRacks([]) }}
            />
            
            <ToolbarSegmented 
              options={[
                { label: 'Elevation', value: 'elevation' },
                { label: 'Spatial', value: 'spatial' }
              ]}
              value={viewMode}
              onChange={(val: any) => setViewMode(val as any)}
            />

            {viewMode === 'elevation' && (
              <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg border border-white/[0.06]">
                <Layers size={11} className="text-slate-500" />
                <input 
                  type="range" aria-label="Rack width" min={160} max={400} value={rackWidth}
                  onChange={e => setRackWidth(parseInt(e.target.value))}
                  className="w-24 accent-blue-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
                <span className="w-10 tabular-nums text-[10px] font-semibold text-[var(--text-secondary)]">{rackWidth}px</span>
              </div>
            )}
          </>
        }
        right={
          <>
            <ToolbarSearch 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search racks & devices..."
              ariaLabel="Search racks and devices"
            />

            {viewMode === 'elevation' && (rackScrollState.canScrollLeft || rackScrollState.canScrollRight) && (
              <div data-rack-scroll-controls="true" role="group" aria-label="Rack navigation" className="flex shrink-0 items-center gap-1">
                {rackScrollState.canScrollLeft && (
                  <ToolbarIconButton title="Scroll to previous racks" ariaLabel="Scroll to previous racks" onClick={() => scrollRackRail(-1)}>
                    <ChevronLeft size={14} />
                  </ToolbarIconButton>
                )}
                {rackScrollState.canScrollRight && (
                  <ToolbarButton ariaLabel="Scroll to next racks" title="Scroll to next racks" onClick={() => scrollRackRail(1)} className="h-9 px-3 text-xs">
                    More racks <ChevronRight size={14} className="ml-1" aria-hidden="true" />
                  </ToolbarButton>
                )}
              </div>
            )}

            <ToolbarIconButton 
              title="Time Machine / Diff"
              onClick={() => setIsComparing(true)}
              active={isComparing}
            >
              <History size={14} />
            </ToolbarIconButton>

            <ToolbarIconButton 
              title="View Plans"
              onClick={() => setShowPlanList(true)}
            >
              <List size={14} />
            </ToolbarIconButton>

            {viewMode === 'elevation' && (
              <ToolbarSegmented 
                options={[
                  { label: 'All', value: 'all' },
                  { label: `Compare ${selectedRacks.length > 0 ? `(${selectedRacks.length})` : ''}`, value: 'compare' }
                ]}
                value={showCompareOnly ? 'compare' : 'all'}
                onChange={(val: any) => setShowCompareOnly(val === 'compare')}
              />
            )}

            {focusedConnection && (
              <>
                <div className="w-px h-6 bg-white/10 mx-1" />
                <ToolbarButton onClick={() => setShowConnectionsList(true)} variant="secondary" className="text-blue-400 border-blue-500/20 bg-blue-600/10 hover:bg-blue-600/20">
                  <List size={13} className="mr-2 inline-block" /> View List
                </ToolbarButton>
                <ToolbarButton onClick={() => setFocusedConnection(null)} variant="danger">
                  <X size={13} className="mr-2 inline-block" /> Clear
                </ToolbarButton>
              </>
            )}
          </>
        }
      />

      <RackDataState
        label="Rack records"
        isError={racksQuery.isError}
        isFetching={racksQuery.isFetching}
        hasData={Boolean(allRacks)}
        onRetry={() => void racksQuery.refetch()}
      />

      {failedSupportQueries.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--state-warning-border)] bg-[var(--state-warning-surface)] px-4 py-3 text-sm text-[var(--text-primary)]">
          <p>
            {failedSupportQueries.map(({ label }) => label).join(', ')} could not be refreshed. Previously loaded values remain visible where available; related choices may be incomplete.
          </p>
          <button
            type="button"
            disabled={failedSupportQueries.some(({ query }) => query.isFetching)}
            onClick={() => failedSupportQueries.forEach(({ query }) => { void query.refetch() })}
            className="min-h-9 rounded-md border border-[var(--state-warning-border)] px-3 text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--state-warning-surface)] disabled:cursor-wait disabled:opacity-60"
          >
            {failedSupportQueries.some(({ query }) => query.isFetching) ? 'Retrying linked data…' : 'Retry linked data'}
          </button>
        </div>
      )}

      {/* ── Capacity Summary Bar ── */}
      {activeRacks && activeRacks.length > 0 && !showCompareOnly && !isMaskMode && (
        <div className="shrink-0">
          <SiteCapacityBar racks={activeRacks} />
        </div>
      )}

      {/* ── Site Tabs ── */}
      {!showCompareOnly && activeTab !== 'deleted' && !isMaskMode && (
        <div className="flex flex-col items-stretch gap-3 shrink-0 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 custom-scrollbar items-center">
            <button
              onClick={() => setActiveSite(null)}
              className={`px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest border transition-all whitespace-nowrap flex items-center gap-1.5 ${!activeSite ? 'bg-blue-600 border-blue-500 text-white' : 'border-white/[0.07] text-slate-500 hover:border-white/20 hover:text-slate-300'}`}
            >
              All
              {activeRacks && <span className="opacity-60 font-mono">{activeRacks.length}</span>}
            </button>

            {sites?.map((s: any) => {
              const siteRacks = activeRacks?.filter((r: any) => r.site_id === s.id) || []
              const siteUsed = siteRacks.reduce((a: number, r: any) => a + (r.device_locations || []).reduce((b: number, l: any) => b + (l.size_u || 1), 0), 0)
              const siteTotal = siteRacks.reduce((a: number, r: any) => a + (r.total_u || 42), 0)
              const siteFill = siteTotal > 0 ? Math.round((siteUsed / siteTotal) * 100) : 0
              const isMenuOpen = activeSiteMenu === s.id
              const isActive = activeSite === s.id

              return (
                <div key={s.id} className="relative group/site shrink-0">
                  <button
                    onClick={() => setActiveSite(s.id)}
                    aria-label={`Open site ${s.name}`}
                    className={`pl-3 pr-9 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest border transition-all whitespace-nowrap flex items-center gap-2 ${isActive ? 'bg-[#034EA2] border-blue-500 text-white' : 'border-white/[0.07] text-slate-500 hover:border-white/20 hover:text-slate-300'}`}
                    style={isActive && s.color ? { backgroundColor: s.color, borderColor: 'rgba(255,255,255,0.1)' } : {}}
                  >
                    {s.name}
                    <span className={`text-[7px] font-black px-1 py-0.5 rounded-lg tabular-nums ${
                      siteFill >= 90 ? 'bg-rose-500/30 text-rose-300' :
                      siteFill >= 70 ? 'bg-amber-500/30 text-amber-300' :
                      isActive ? 'bg-white/20 text-white/70' : 'bg-white/5 text-slate-500'
                    }`}>{siteFill}%</span>
                  </button>

                  <button
                    aria-label={`Site actions for ${s.name}`}
                    aria-expanded={isMenuOpen}
                    onClick={e => {
                      e.stopPropagation();
                      if (!isMenuOpen) {
                        siteMenu.triggerRef.current = e.currentTarget
                        siteMenu.updatePosition()
                      }
                      setActiveSiteMenu(isMenuOpen ? null : s.id)
                    }}
                    className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors opacity-0 group-hover/site:opacity-100 ${isActive ? 'text-white/50 hover:text-white hover:bg-white/10' : 'text-slate-600 hover:text-slate-400'}`}
                  >
                    <MoreVertical size={12} />
                  </button>

                  {createPortal(<AnimatePresence>
                    {isMenuOpen && (
                        <motion.div
                          ref={siteMenu.panelRef}
                          data-workspace-panel="true"
                          aria-label={`Site actions for ${s.name}`}
                          initial={{ opacity: 0, y: 8, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.95 }}
                          className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] text-[var(--text-primary)] shadow-xl overflow-auto p-1"
                          style={siteMenu.panelStyle}
                        >
                          <button onClick={e => { e.stopPropagation(); setIsEditingSite(s); setActiveSiteMenu(null) }}
                            className="w-full text-left px-3 py-2 text-[8px] font-bold uppercase text-slate-400 hover:bg-blue-500/10 hover:text-blue-400 rounded-lg flex items-center gap-2 transition-colors">
                            <Edit2 size={9} /> Edit Site
                          </button>
                          <div className="h-px bg-white/5 my-1" />
                          <button onClick={e => { e.stopPropagation(); openConfirm('Decommission Site', `Remove site "${s.name}"? This cannot be undone. All racks will be unassigned but keep historical site name.`, () => deleteSiteMutation.mutate(s.id)); setActiveSiteMenu(null) }}
                            className="w-full text-left px-3 py-2 text-[8px] font-bold uppercase text-rose-500 hover:bg-rose-500/10 rounded-lg flex items-center gap-2 transition-colors">
                            <Trash2 size={9} /> Decommission
                          </button>
                        </motion.div>
                    )}
                  </AnimatePresence>, document.body)}
                </div>
              )
            })}
          </div>
          
          <AssetLegend />
        </div>
      )}

      {/* ── Rack Grid ── */}
      <div id="racks-grid" ref={racksGridRef} onScroll={updateRackViewport} style={{ '--rack-card-width': `${rackWidth}px` } as React.CSSProperties} className="h-[480px] flex-none md:h-full md:min-h-0 md:flex-1 flex gap-8 overflow-x-auto overflow-y-auto pb-4 custom-scrollbar px-1 min-h-0 relative">
        
        {viewMode === 'spatial' ? (
          <SpatialMap
            racks={displayedRacks}
            onRackClick={handleSpatialRackClick}
            siteColor={spatialSiteColor}
          />
        ) : (<>
          {/* Connection Lines overlay */}
          {focusedConnection && (
            <ConnectionLines
              sourceDeviceId={focusedConnection.sourceId}
              targetDeviceIds={focusedConnection.targetIds}
              racks={renderedRacks}
              connections={connections}
              devices={devices}
              onLineClick={(conn) => setViewingConnection(conn)}
            />
          )}
          {/* Render Racks Grouped by Aisle/Row if not searching */}
          {(() => {
            const racksToRender = renderedRacks

            if (searchTerm || focusedConnection || showCompareOnly || isRackDiffActive) {
              return (
                <div className={`flex gap-8 items-start h-full ${isRackDiffActive ? 'pb-10 pt-14' : ''}`}>
                  {racksToRender.map((r: any) => {
                    const liveRack = activeRacks.find((ar: any) => ar.id === r.id)
                    const historicalRack = diffBaseVersion 
                      ? { ...r, device_locations: (r.device_locations || []).slice(0, Math.max(0, (r.device_locations?.length || 0) - (diffBaseVersion % 3 + 1))) }
                      : null
                    const secondRack = diffTargetVersion
                      ? { ...r, device_locations: (r.device_locations || []).slice(0, Math.max(0, (r.device_locations?.length || 0) - (diffTargetVersion % 3 + 1))) }
                      : r
                    
                        if (isRackDiffActive) {
                          const snapshotInfoBase = snapshots.find(s => s.id === diffBaseVersion)
                          const snapshotInfoTarget = diffTargetVersion ? snapshots.find(s => s.id === diffTargetVersion) : null
                          
                          const baseLabel = diffTargetVersion ? (snapshotInfoBase?.date || 'V1') : 'CURRENT'
                          const targetLabel = diffTargetVersion ? (snapshotInfoTarget?.date || 'V2') : (snapshotInfoBase ? snapshotInfoBase.date : (isPlanInitialized ? planDraftName : 'PROPOSED'))

                          return (
                            <div key={`diff-${r.id}`} className="flex gap-4 p-4 bg-white/[0.02] border border-white/5 rounded-lg relative shrink-0 h-full">
                               <div className="absolute -top-7 left-1/2 -translate-x-1/2 flex items-center gap-4 z-30 scale-100 whitespace-nowrap">
                                  <div className="flex items-center">
                                    <span className="px-6 py-2.5 bg-slate-900 text-slate-400 border border-white/10 rounded-lg-full text-[10px] font-black uppercase tracking-[0.2em] shadow-2xl border-r-0">{baseLabel}</span>
                                    <div className="w-10 h-10 bg-[#034EA2] rounded-lg flex items-center justify-center border-4 border-slate-950 shadow-xl z-10 -mx-2">
                                       <ArrowRightLeft size={16} className="text-white" />
                                    </div>
                                    <span className="px-6 py-2.5 bg-[#034EA2] text-white border border-blue-400/30 rounded-lg-full text-[10px] font-black uppercase tracking-[0.2em] shadow-2xl border-l-0">
                                       {targetLabel}
                                    </span>
                                  </div>
                               </div>
                               
                               <div className="flex flex-col gap-3 h-full min-w-0 pt-4">
                                  <RackElevation
                                    rack={diffBaseVersion ? historicalRack : liveRack}
                                    searchTerm={searchTerm}
                                    isSelected={false}
                                    showCheckbox={false}
                                    onToggleSelect={noRackAction}
                                    onDelete={noRackAction}
                                    onEdit={noRackAction}
                                    onShowInfo={noRackAction}
                                    onMount={noRackAction}
                                    onManageDevice={noRackAction}
                                    isDeleted={false}
                                    className="flex-1 min-h-0"
                                  />
                                </div>
                               
                               <div className="flex flex-col gap-3 h-full min-w-0 pt-4">
                                  <RackElevation
                                    rack={diffTargetVersion ? secondRack : r}
                                    searchTerm={searchTerm}
                                    isSelected={false}
                                    showCheckbox={false}
                                    onToggleSelect={noRackAction}
                                    onDelete={noRackAction}
                                    onEdit={handlePlanRackEdit}
                                    onShowInfo={openRackInfo}
                                    onMount={handlePlanRackMount}
                                    onManageDevice={handleRackDeviceManage}
                                    isDeleted={false}
                                    diffMode={true}
                                    liveRack={diffBaseVersion ? historicalRack : liveRack}
                                    className="flex-1 min-h-0"
                                  />
                               </div>
                            </div>
                          )
                        }

                    return (
                      <RackElevation
                        key={r.id}
                        rack={r}
                        searchTerm={searchTerm}
                        isSelected={selectedRacks.includes(r.id)}
                        onToggleSelect={handleRackSelectionToggle}
                        onDelete={handleRackDelete}
                        onEdit={handleRackEdit}
                        onShowInfo={openRackInfo}
                        onMount={handleRackMount}
                        onManageDevice={handleRackDeviceManage}
                        isDeleted={activeTab === 'deleted'}
                        onRestore={handleRackRestore}
                        focusedDeviceId={focusedConnection?.sourceId ?? null}
                        connectedDeviceIds={focusedConnection?.targetIds}
                        showCheckbox={!isPlanInitialized}
                      />
                    )
                  })}
                </div>
              )
            }

            return rackGroups.map((group, groupIndex) => {
              const { groupName, groupRacks, width } = group
              if (groupIndex < visibleRackGroupRange.start || groupIndex >= visibleRackGroupRange.end) {
                return (
                  <div
                    key={groupName}
                    data-rack-virtual-spacer="true"
                    data-rack-group-index={groupIndex}
                    data-rack-group-offset={group.offset}
                    aria-hidden="true"
                    className="h-full max-w-none shrink-0"
                    style={{ width }}
                  />
                )
              }

              return (
                <div key={groupName} className="flex max-w-none flex-col gap-3 shrink-0 h-full" style={{ width }} data-rack-id={groupRacks[0]?.id} data-rack-group-index={groupIndex} data-rack-group-offset={group.offset}>
                  <div className="flex min-h-10 min-w-0 items-center px-1 shrink-0">
                    <span className="text-xs font-semibold leading-5 text-[var(--text-secondary)] [overflow-wrap:anywhere]">{groupName}</span>
                  </div>
                  <div className="flex gap-4 flex-1 min-h-0">
                    {groupRacks.map((r: any) => (
                      <RackElevation
                        key={r.id}
                        rack={r}
                        searchTerm={searchTerm}
                        isSelected={selectedRacks.includes(r.id)}
                        onToggleSelect={handleRackSelectionToggle}
                        onDelete={handleRackDelete}
                        onEdit={handleRackEdit}
                        onShowInfo={openRackInfo}
                        onMount={handleRackMount}
                        onManageDevice={handleRackDeviceManage}
                        isDeleted={activeTab === 'deleted'}
                        onRestore={handleRackRestore}
                        focusedDeviceId={focusedConnection?.sourceId ?? null}
                        connectedDeviceIds={focusedConnection?.targetIds}
                        showCheckbox={!isPlanInitialized}
                        diffMode={showDiff || !!diffBaseVersion}
                        liveRack={diffBaseVersion
                          ? { ...r, device_locations: (r.device_locations || []).slice(0, Math.max(0, (r.device_locations?.length || 0) - 1)) }
                          : activeRacks.find((ar: any) => ar.id === r.id)}
                      />
                    ))}
                  </div>
                </div>
              )
            })
          })()}
        </>)}

        {displayedRacks.length === 0 && (
          <div className="flex-1 flex items-center justify-center p-8">
            <WorkspaceEmptyState 
              icon={<Server size={32} />}
              title={activeTab === 'deleted' ? 'No Purged Records' : searchTerm ? `No results for "${searchTerm}"` : 'No Racks in Scope'}
              description="No physical assets found matching the current filters or site selection."
            />
          </div>
        )}
      </div>

      {/* Bulk Toolbar */}
      <AnimatePresence>
        {selectedRacks.length > 0 && !isMaskMode && (
          <BulkToolbar
            count={selectedRacks.length}            isDeleted={activeTab === 'deleted'}
            onClear={() => setSelectedRacks([])}
            onCompare={() => setIsComparing(true)}
            onRelocate={() => setShowRelocateModal(true)}

            onDelete={() => openConfirm(
              activeTab === 'deleted' ? 'Purge Racks' : 'Delete Racks',
              activeTab === 'deleted' ? `Permanently delete ${selectedRacks.length} rack(s)?` : `Soft-delete ${selectedRacks.length} rack(s)?`,
              () => bulkActionMutation.mutate({ action: activeTab === 'deleted' ? 'purge' : 'delete', ids: selectedRacks })
            )}
            onRestore={() => setRestoreWizard({ step: 'site-select', ids: selectedRacks, nameConflicts: [], assetWarnings: [], generalAssetWarning: false })}
            onGenerateLabels={() => setShowLabelGenerator(true)}
          />
        )}
      </AnimatePresence>

      {impactAssetId && (
        <AssetImpactWindow 
          deviceId={impactAssetId}
          devices={devices || []}
          connections={connections || []}
          onClose={() => { setImpactAssetId(null); setImpactCoords(null) }}
          coords={impactCoords}
        />
      )}

      {showLabelGenerator && (
        <LabelGeneratorModal 
           racks={activeRacks.filter((r:any) => selectedRacks.includes(r.id))}
           devices={devices || []}
           connections={connections || []}
           onClose={() => setShowLabelGenerator(false)}
        />
      )}

      {isComparing && (
        <InfrastructureHistory
          onClose={() => setIsComparing(false)}
          onExecuteDiff={(versions) => {
            setDiffBaseVersion(versions[0])
            setDiffTargetVersion(versions.length > 1 ? versions[1] : null)
            toast.success(`Visual Diff Engine Active: Comparing ${versions.length} versions`)
            setIsComparing(false)
          }}
        />
      )}
      {showPlanList && (
       <PlanListModal 
          plans={plans}
          isLoading={plansQuery.isLoading}
          isError={plansQuery.isError}
          isFetching={plansQuery.isFetching}
          onRetry={() => void plansQuery.refetch()}
          onClose={() => setShowPlanList(false)}
          onDeletePlan={(id) => deletePlanMutation.mutate(id)}
          onAddPlan={(type) => {
             const siteRacks = activeSite ? (activeRacks || []).filter((r: any) => r.site_id === activeSite) : (activeRacks || [])
             
             if (type === 'blank') {
                setVirtualRacks(siteRacks.map((r: any) => ({ ...r, device_locations: [] })))
                setSandboxRackIds(siteRacks.map((r: any) => r.id))
                setIsPlanInitialized(true)
                setIsPlanMode(true)
                setShowPlanList(false)
                setIsCreatingPlan(null)
                setShowOnlySandbox(false)
                toast.success(`Initialized Blank Site Plan (${siteRacks.length} Racks)`)
             } else {
                setIsCreatingPlan(type)
                setIsPlanMode(true)
                setIsPlanInitialized(false)
                setShowPlanList(false)
                setSelectedRacks([])
                toast("Select baseline racks for live import")
             }
          }}
          onLoadPlan={(p) => {
             setIsPlanMode(true)
             setIsPlanInitialized(true)
             setActivePlanId(p.id)
             setPlanDraftName(p.name)
             setSandboxRackIds(p.racks)
             setVirtualRacks(JSON.parse(JSON.stringify(p.racksData)))
             setShowOnlySandbox(true)
             setShowPlanList(false)
             toast.success(`Loaded Matrix: ${p.name}`)
          }}
       />
      )}
      <ConnectionForensicsModal
        isOpen={!!viewingConnection}
        onClose={() => setViewingConnection(null)}
        connection={viewingConnection}
      />

      <ConnectionsListModal
        isOpen={showConnectionsList}
        onClose={() => setShowConnectionsList(false)}
        connections={focusedDeviceConnections}
        devices={devices || []}
        deviceName={focusedDeviceName}
        onViewForensics={(conn) => {
          setShowConnectionsList(false)
          setViewingConnection(conn)
        }}
      />

      {/* Device Detail Modal */}
      {managingDevice && (
        <DeviceDetailModal
          device={managingDevice.device}
          loc={managingDevice.loc}
          rack={managingDevice.rack}
          onClose={() => setManagingDevice(null)}
          onUnmount={async (deviceId) => {
            if (isPlanInitialized) {
              setVirtualRacks(prev => prev.map(r => ({
                ...r,
                device_locations: (r.device_locations || []).filter((l: any) => String(l.device_id) !== String(deviceId))
              })))
              setManagingDevice(null)
              toast.success('Asset unmounted virtually')
              return
            }
            await apiFetch(`/api/v1/racks/mount/${deviceId}`, { method: 'DELETE' })
            queryClient.invalidateQueries({ queryKey: ['racks-all'] })
            queryClient.invalidateQueries({ queryKey: ['devices'] })
            setManagingDevice(null)
            toast.success('Unmounted')
          }}
          onUpdateMount={(data) => updateMountMutation.mutate(data)}
          onUpdateDevice={async (data) => {
            if (isPlanInitialized) {
              setVirtualRacks(prev => prev.map(r => ({
                ...r,
                device_locations: (r.device_locations || []).map((l: any) => 
                  l.device_id === data.id ? { ...l, device: { ...l.device, ...data } } : l
                )
              })))
              toast.success('Asset updated virtually')
              return
            }
            await apiFetch(`/api/v1/devices/${managingDevice.device.id}`, { method: 'PUT', body: JSON.stringify(data) })
            queryClient.invalidateQueries({ queryKey: ['devices'] })
            queryClient.invalidateQueries({ queryKey: ['racks-all'] })
            toast.success('Device updated')
          }}
        />
      )}

      {/* Options Context Menu */}
      {optionsMenu && (
        <DeviceOptionsMenu
          x={optionsMenu.x}
          y={optionsMenu.y}
          deviceName={optionsMenu.device?.name}
          onClose={() => setOptionsMenu(null)}
          onShowConnections={() => {
            if (!optionsMenu.device) return
            const conns = connections || []
            const targetIds = conns
              .filter((c: any) => c.source_device_id === optionsMenu.device.id || c.target_device_id === optionsMenu.device.id)
              .map((c: any) => c.source_device_id === optionsMenu.device.id ? c.target_device_id : c.source_device_id)
            setFocusedConnection({ sourceId: optionsMenu.device.id, targetIds })
            setOptionsMenu(null)
          }}
          onPatch={() => {
            if (!optionsMenu.device || !optionsMenu.rack) return
            setPatchSource({ 
              deviceId: optionsMenu.device.id, 
              port: 'Auto', 
              rackId: optionsMenu.rack.id,
              name: optionsMenu.device.name
            } as any)
            setOptionsMenu(null)
          }}
          onEdit={() => { 
            if (!optionsMenu.device) return
            setManagingDevice({ device: optionsMenu.device, loc: optionsMenu.loc, rack: optionsMenu.rack })
            setOptionsMenu(null) 
          }}
          onDelete={() => {
            if (!optionsMenu.device) return
            if (isPlanInitialized) {
              setVirtualRacks(prev => prev.map(vr => ({
                ...vr,
                device_locations: (vr.device_locations || []).filter((l: any) => String(l.device_id) !== String(optionsMenu.device.id))
              })))
              setOptionsMenu(null)
              toast.success('Asset removed from plan')
              return
            }
            openConfirm('Unmount Device', `Unmount ${optionsMenu.device.name}?`, async () => {
              await apiFetch(`/api/v1/racks/mount/${optionsMenu.device.id}`, { method: 'DELETE' })
              queryClient.invalidateQueries({ queryKey: ['racks-all'] })
              queryClient.invalidateQueries({ queryKey: ['devices'] })
              toast.success('Unmounted')
            })
            setOptionsMenu(null)
          }}
        />
      )}

      {/* Patch Toolbar */}
      <AnimatePresence>
        {patchSource && (
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-4 px-6 py-4 bg-indigo-950/95 backdrop-blur-xl border border-indigo-500/30 rounded-lg shadow-2xl"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/20 rounded-lg">
                <Network size={16} className="text-indigo-400" />
              </div>
              <div>
                <p className="text-[10px] font-black text-white uppercase tracking-widest">Cabling Mode</p>
                <p className="text-[9px] text-indigo-300 font-bold uppercase">Source: {patchSource.name}</p>
              </div>
            </div>
            <div className="h-6 w-px bg-white/10" />
            <p className="text-[10px] font-bold text-slate-400 uppercase ">Select target asset to patch...</p>
            <button 
              onClick={() => setPatchSource(null)}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white rounded-lg text-[9px] font-black uppercase transition-all"
            >Cancel</button>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmationModal
        isOpen={!!optionsMenu && !!patchSource && optionsMenu.device?.id && optionsMenu.device.id !== patchSource.deviceId}
        onClose={() => setOptionsMenu(null)}
        onConfirm={() => {
          bulkPatchMutation.mutate([{
            source_device_id: patchSource.deviceId,
            source_port: 'Auto',
            target_device_id: optionsMenu.device.id,
            target_port: 'Auto',
            purpose: 'Inter-Rack Data'
          }])
        }}
        title="Create Patch Connection"
        message={`Create a direct network connection between ${patchSource?.name} and ${optionsMenu?.device?.name}?`}
        variant="info"
        confirmText="Create Cable"
      />

      {/* Confirm Modal */}
      {confirmModal.isOpen && (
        <WorkspaceDialogFrame title={confirmModal.title} onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}>
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="bg-slate-900 border border-white/10 rounded-lg p-6 w-96 space-y-4 shadow-2xl">
            <h3 className="text-sm font-black uppercase text-white">{confirmModal.title}</h3>
            <p className="text-xs text-slate-400">{confirmModal.message}</p>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setConfirmModal({ ...confirmModal, isOpen: false })} className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-xs font-semibold transition-colors">Cancel</button>
              <button onClick={() => { confirmModal.onConfirm(); setConfirmModal({ ...confirmModal, isOpen: false }) }} className={`flex-1 px-4 py-2 rounded-lg text-xs font-black uppercase transition-colors ${confirmModal.variant === 'danger' ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>{confirmModal.title}</button>
            </div>
          </motion.div>
        </WorkspaceDialogFrame>
      )}

      {/* Provision Modal */}
      <WorkspaceModal
        isOpen={!!isProvisioning}
        onClose={() => { setIsProvisioning(null); setMountSearch('') }}
        size="standard"
        title={provisionMode === 'reserve' ? 'Reserve Space' : 'Mount Asset'}
        subtitle={`${allRacks?.find((r: any) => r.id === isProvisioning?.rackId)?.name} · U${isProvisioning?.start_u}`}
        icon={provisionMode === 'reserve' ? <Package size={20} /> : <Server size={20} />}
        footerRight={
          <div className="flex gap-3">
            <ToolbarButton onClick={() => { setIsProvisioning(null); setMountSearch('') }}>Close</ToolbarButton>
            <ToolbarButton
              disabled={provisionMode === 'asset' && !isProvisioning?.device_id}
              ariaLabel={provisionMode === 'reserve' ? 'Confirm Reservation' : 'Mount Asset'}
              onClick={() => {
                if (provisionMode === 'asset') {
                  if (isPlanInitialized) {
                    addDeviceToPlan(isProvisioning.rackId, parseInt(isProvisioning.device_id), isProvisioning.start_u, isProvisioning.size_u, isProvisioning.orientation)
                  } else {
                    mountMutation.mutate({
                      rack_id: isProvisioning.rackId,
                      device_id: parseInt(isProvisioning.device_id),
                      u_start: isProvisioning.start_u,
                      size_u: isProvisioning.size_u,
                      orientation: isProvisioning.orientation
                    })
                  }
                } else {
                  if (isPlanInitialized) {
                    addReservationToPlan(isProvisioning.rackId, isProvisioning.start_u, isProvisioning.size_u, reserveInfo.temporary_name, reserveInfo.est_date, reserveInfo.poc)
                  } else {
                    mountMutation.mutate({
                      rack_id: isProvisioning.rackId,
                      is_reservation: true,
                      u_start: isProvisioning.start_u,
                      size_u: isProvisioning.size_u,
                      temporary_name: reserveInfo.temporary_name,
                      est_racking_date: reserveInfo.est_date,
                      poc_name: reserveInfo.poc,
                      orientation: isProvisioning.orientation
                    })
                  }
                }
                setIsProvisioning(null)
              }}
              variant="primary"
            >
              {provisionMode === 'reserve' ? 'Confirm Reservation' : 'Commit Mount'}
            </ToolbarButton>
          </div>
        }
      >
        {isProvisioning && (
          <div className="space-y-6 pt-6">
                {/* Asset / Reserve Toggle */}
                <div className="flex bg-black/40 p-1 rounded-lg border border-white/5">
                  <button 
                    onClick={() => setProvisionMode('asset')}
                    className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${provisionMode === 'asset' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                  >Asset Registry</button>
                  <button 
                    onClick={() => setProvisionMode('reserve')}
                    className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${provisionMode === 'reserve' ? 'bg-violet-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                  >Temporary Reserve</button>
                </div>

                {provisionMode === 'asset' ? (
                  <div className="space-y-3">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Asset Search</label>
                    <div className="relative">
                      <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" />
                      <input 
                        autoFocus
                        value={mountSearch}
                        onChange={e => setMountSearch(e.target.value)}
                        placeholder="Filter by name, type, or system..."
                        className="w-full bg-black border border-white/10 rounded-lg pl-11 pr-4 py-3 text-[11px] font-bold text-white outline-none focus:border-blue-500/60 transition-all placeholder:text-slate-700"
                      />
                    </div>
                    
                    <div className="max-h-[180px] overflow-y-auto custom-scrollbar bg-black/40 border border-white/5 rounded-lg p-1.5 space-y-1">
                      {availableDevices?.filter((d: any) => {
                        const term = mountSearch.toLowerCase()
                        return (d.name || '').toLowerCase().includes(term) || (d.type || '').toLowerCase().includes(term) || d.system?.toLowerCase().includes(term)
                      }).map((d: any) => {
                        const isSelected = String(d.id) === String(isProvisioning.device_id)
                        const planLoc = isPlanInitialized ? getPlanDeviceLocation(d.id) : null
                        const realLoc = d.rack_id ? { rackName: d.rack_name, uStart: d.u_start } : null
                        
                        const locInfo = isPlanInitialized 
                          ? (planLoc ? `MOUNTED @ ${planLoc.rackName} U${planLoc.uStart}` : '') 
                          : (realLoc ? `MOUNTED @ ${realLoc.rackName} U${realLoc.uStart}` : '')
                        
                        const isMounted = isPlanInitialized ? !!planLoc : !!realLoc

                        return (
                          <button
                            key={d.id}
                            onClick={() => setIsProvisioning({ ...isProvisioning, device_id: String(d.id), size_u: d.size_u || 1 })}
                            className={`w-full text-left px-4 py-2.5 rounded-lg transition-all flex items-center justify-between group ${isSelected ? 'bg-[#034EA2] text-white shadow-lg' : isMounted ? 'bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-400/80 border border-emerald-500/10' : 'hover:bg-white/5 text-slate-400 hover:text-white'}`}
                          >
                            <div className="min-w-0">
                              <p className={`text-[10px] font-black uppercase tracking-tight truncate ${isSelected ? 'text-white' : isMounted ? 'text-emerald-400' : 'group-hover:text-blue-400'}`}>{d.name}</p>
                              <p className={`text-[8px] font-bold uppercase ${isSelected ? 'text-blue-100' : 'text-slate-600'}`}>
                                {d.type} · {d.system || 'N/A'}
                                {locInfo && <span className={`ml-2 px-1.5 py-0.5 rounded-lg bg-black/40 ${isSelected ? 'text-white' : 'text-emerald-500/80 border border-emerald-500/10'}`}>[{locInfo}]</span>}
                              </p>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 ml-4">
                              <span className={`text-[8px] font-mono ${isSelected ? 'text-blue-100' : 'text-slate-500'}`}>{d.size_u || 1}U</span>
                              {(isSelected || isMounted) && <Check size={12} strokeWidth={3} className={isSelected ? 'text-white' : 'text-emerald-500'} />}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="text-[8px] font-black text-slate-500 uppercase block mb-1.5 ml-1">Temporary Asset/Project Name</label>
                        <input 
                          value={reserveInfo.temporary_name}
                          onChange={e => setReserveInfo({ ...reserveInfo, temporary_name: e.target.value })}
                          placeholder="e.g. AI Node Cluster 01"
                          className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-xs outline-none focus:border-violet-500/60 transition-colors text-white" 
                        />
                      </div>
                      <div>
                        <label className="text-[8px] font-black text-slate-500 uppercase block mb-1.5 ml-1">Est. Racking Date</label>
                        <input 
                          type="date"
                          value={reserveInfo.est_date}
                          onChange={e => setReserveInfo({ ...reserveInfo, est_date: e.target.value })}
                          className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-xs outline-none focus:border-violet-500/60 transition-colors text-white" 
                        />
                      </div>
                      <div>
                        <label className="text-[8px] font-black text-slate-500 uppercase block mb-1.5 ml-1">POC Name</label>
                        <input 
                          value={reserveInfo.poc}
                          onChange={e => setReserveInfo({ ...reserveInfo, poc: e.target.value })}
                          placeholder="Engineer Name"
                          className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-xs outline-none focus:border-violet-500/60 transition-colors text-white" 
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Common Fields */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[8px] font-black text-slate-500 uppercase block mb-1.5 ml-1">Size (U)</label>
                    <input type="number" min={1} value={isProvisioning.size_u || 1}
                      onChange={e => setIsProvisioning({ ...isProvisioning, size_u: parseInt(e.target.value) || 1 })}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-xs outline-none focus:border-blue-500/60 transition-colors font-mono text-white" />
                  </div>
                  <div>
                    <label className="text-[8px] font-black text-slate-500 uppercase block mb-1.5 ml-1">Mount Side</label>
                    <StyledSelect
                      options={[{ label: 'FRONT', value: 'Front' }, { label: 'BACK', value: 'Back' }]}
                      value={isProvisioning.orientation || 'Front'}
                      onChange={e => setIsProvisioning({ ...isProvisioning, orientation: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-[8px] font-black text-slate-500 uppercase block mb-1.5 ml-1">Depth</label>
                    <StyledSelect
                      options={[{ label: 'FULL', value: 'Full' }, { label: 'HALF', value: 'Half' }]}
                      value={isProvisioning.depth || 'Full'}
                      onChange={e => setIsProvisioning({ ...isProvisioning, depth: e.target.value })}
                    />
                  </div>
                </div>

          </div>
        )}
      </WorkspaceModal>

      {(isAddingSite || isEditingSite) && (
          <WorkspaceDialogFrame title={isEditingSite ? "Edit Site" : "Establish New Site"} onClose={closeSiteEditor}>
            <motion.form onSubmit={event => { event.preventDefault(); if (!siteMutation.isPending) siteMutation.mutate(isEditingSite || newSite) }} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="guided-entry glass-panel w-full max-w-[420px] p-5 sm:p-8 rounded-lg space-y-6 border border-emerald-500/20 shadow-2xl">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-emerald-500/15 rounded-lg border border-emerald-500/20">
                  <MapPin size={22} className="text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-lg font-black uppercase tracking-tight text-white">
                    {isEditingSite ? 'Edit Site' : 'Establish New Site'}
                  </h2>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Physical Facility Management</p>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label htmlFor="site-form-name" className="text-[9px] font-black text-slate-500 uppercase block mb-1.5 ml-1">Site Name *</label>
                  <input id="site-form-name" required value={isEditingSite ? isEditingSite.name : newSite.name}
                    onChange={e => isEditingSite ? setIsEditingSite({ ...isEditingSite, name: e.target.value }) : setNewSite({ ...newSite, name: e.target.value })}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-sm outline-none focus:border-emerald-500/60 transition-colors text-white font-bold"
                    placeholder="e.g. DATA-CENTER-01" />
                </div>
                <div>
                  <label htmlFor="site-form-address" className="text-[9px] font-black text-slate-500 uppercase block mb-1.5 ml-1">Physical Address</label>
                  <input id="site-form-address" value={isEditingSite ? isEditingSite.address : newSite.address}
                    onChange={e => isEditingSite ? setIsEditingSite({ ...isEditingSite, address: e.target.value }) : setNewSite({ ...newSite, address: e.target.value })}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-sm outline-none focus:border-emerald-500/60 transition-colors text-slate-300"
                    placeholder="123 Silicon Valley Way..." />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-500 uppercase block mb-2 ml-1">Site Theme Color (for Rack Bars)</label>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'].map(c => (
                      <button 
                        type="button"
                        key={c}
                        onClick={() => isEditingSite ? setIsEditingSite({ ...isEditingSite, color: c }) : setNewSite({ ...newSite, color: c })}
                        className={`w-8 h-8 rounded-lg border-2 transition-all ${ (isEditingSite ? isEditingSite.color : newSite.color) === c ? 'border-white scale-110 shadow-lg' : 'border-transparent opacity-60 hover:opacity-100' }`}
                        style={{ backgroundColor: c }}
                        aria-label={`Site color ${c}`}
                        aria-pressed={(isEditingSite ? isEditingSite.color : newSite.color) === c}
                      />
                    ))}
                  </div>
                  <input 
                    aria-label="Site theme color" pattern="#[0-9a-fA-F]{6}" title="Six-digit hex color, e.g. #3b82f6"
                    type="text"
                    value={isEditingSite ? isEditingSite.color : newSite.color}
                    onChange={e => isEditingSite ? setIsEditingSite({ ...isEditingSite, color: e.target.value }) : setNewSite({ ...newSite, color: e.target.value })}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-xs outline-none focus:border-emerald-500/60 transition-colors text-slate-400 font-mono"
                    placeholder="#HEXCOLOR" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeSiteEditor} className="flex-1 py-3.5 text-[10px] font-black uppercase text-slate-500 hover:text-slate-300 transition-colors">Cancel</button>
                <button type="submit" disabled={siteMutation.isPending}
                  className="flex-1 py-3.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase shadow-lg shadow-emerald-500/20 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-wait">
                  {siteMutation.isPending ? 'Saving Site...' : isEditingSite ? 'Update Site' : 'Create Site'}
                </button>
              </div>
            </motion.form>
          </WorkspaceDialogFrame>
        )}

        {/* Rack Create / Edit */}
        {(isAddingRack || isEditingRack) && (
          <WorkspaceDialogFrame title={isEditingRack ? "Configure Rack" : "Deploy New Rack"} onClose={closeRackEditor}>
            <motion.form onSubmit={event => {
                event.preventDefault()
                if (rackMutation.isPending) return
                if (!isEditingRack && !newRack.site_id) { toast.error('Site is required'); return }
                rackMutation.mutate(isEditingRack || newRack)
              }} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="guided-entry glass-panel w-full max-w-[500px] p-5 sm:p-8 rounded-lg space-y-6 border border-blue-500/20 shadow-2xl my-auto">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500/15 rounded-lg border border-blue-500/20">
                  <Server size={22} className="text-blue-400" />
                </div>
                <div>
                  <h2 className="text-lg font-black uppercase tracking-tight text-white">
                    {isEditingRack ? 'Configure Rack' : 'Deploy New Rack'}
                  </h2>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Physical Slot & Power Configuration</p>
                </div>
              </div>
              <div className="space-y-4 relative z-10">
                <FormGuide summary={<><strong>Choose a site and name the rack.</strong> Match capacity to the physical rack; power values are configured limits, not live readings.</>}
                  steps={[
                    { id: 'rack-form-identity', title: 'Location', hint: 'Site, name, aisle and row' },
                    { id: 'rack-form-capacity', title: 'Capacity', hint: 'Rack units and power ceiling', tone: 'teal' },
                    { id: 'rack-form-pdu', title: 'PDU limits', hint: 'Primary and redundant capacity', tone: 'amber' },
                  ]} />
                {!isEditingRack && (
                  <StyledSelect
                    label="Target Site"
                    value={newRack.site_id}
                    onChange={e => setNewRack({ ...newRack, site_id: e.target.value })}
                    options={sites?.map((s: any) => ({ value: String(s.id), label: s.name })) || []}
                    placeholder="Select deployment site..."
                  />
                )}
                <div id="rack-form-identity" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="col-span-1">
                    <label htmlFor="rack-form-name" className="text-[9px] font-black text-slate-500 uppercase block mb-1.5 ml-1">Identifier *</label>
                    <input
                      id="rack-form-name" required aria-required="true"
                      value={isEditingRack ? isEditingRack.name : newRack.name}
                      onChange={e => isEditingRack ? setIsEditingRack({ ...isEditingRack, name: e.target.value }) : setNewRack({ ...newRack, name: e.target.value })}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-sm outline-none focus:border-blue-500/60 transition-colors text-white font-bold"
                      placeholder="e.g. A01" />
                  </div>
                  <div>
                    <label htmlFor="rack-form-aisle" className="text-[9px] font-black text-slate-500 uppercase block mb-1.5 ml-1">Aisle</label>
                    <input
                      id="rack-form-aisle"
                      value={isEditingRack ? (isEditingRack.aisle || '') : newRack.aisle}
                      onChange={e => isEditingRack ? setIsEditingRack({ ...isEditingRack, aisle: e.target.value }) : setNewRack({ ...newRack, aisle: e.target.value })}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-sm outline-none focus:border-blue-500/60 transition-colors text-slate-300"
                      placeholder="A1" />
                  </div>
                  <div>
                    <label htmlFor="rack-form-row" className="text-[9px] font-black text-slate-500 uppercase block mb-1.5 ml-1">Row</label>
                    <input
                      id="rack-form-row"
                      value={isEditingRack ? (isEditingRack.row || '') : newRack.row}
                      onChange={e => isEditingRack ? setIsEditingRack({ ...isEditingRack, row: e.target.value }) : setNewRack({ ...newRack, row: e.target.value })}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-sm outline-none focus:border-blue-500/60 transition-colors text-slate-300"
                      placeholder="10" />
                  </div>
                </div>

                <div id="rack-form-capacity" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="rack-form-units" className="text-[9px] font-black text-slate-500 uppercase block mb-1.5 ml-1">Total Capacity (U)</label>
                    <input id="rack-form-units" required type="number" min={1} max={100}
                      value={isEditingRack ? isEditingRack.total_u : newRack.total_u}
                      onChange={e => isEditingRack ? setIsEditingRack({ ...isEditingRack, total_u: parseInt(e.target.value) }) : setNewRack({ ...newRack, total_u: parseInt(e.target.value) })}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-sm outline-none focus:border-blue-500/60 transition-colors font-mono text-white" />
                  </div>
                  <div>
                    <label htmlFor="rack-form-ceiling" className="text-[9px] font-black text-slate-500 uppercase block mb-1.5 ml-1">Configured Rack Ceiling (kW)</label>
                    <input id="rack-form-ceiling" required type="number" min={0} max={1000} step="any"
                      value={isEditingRack ? (isEditingRack.max_power_kw ?? 10.0) : newRack.max_power_kw}
                      onChange={e => isEditingRack ? setIsEditingRack({ ...isEditingRack, max_power_kw: parseFloat(e.target.value) }) : setNewRack({ ...newRack, max_power_kw: parseFloat(e.target.value) })}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-sm outline-none focus:border-blue-500/60 transition-colors font-mono text-white" />
                  </div>
                </div>

                {/* PDU Configuration Section */}
                <div id="rack-form-pdu" className="pt-2 border-t border-white/5 space-y-4">
                  <h3 className="text-[10px] font-black text-blue-400 uppercase tracking-widest flex items-center gap-2">
                    <Zap size={12} /> PDU Configuration
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <p className="text-[8px] font-black text-slate-600 uppercase tracking-tighter">PDU-A (Primary)</p>
                      <input 
                        aria-label="PDU-A name"
                        value={isEditingRack ? (isEditingRack.pdu_a_name || '') : newRack.pdu_a_name}
                        onChange={e => isEditingRack ? setIsEditingRack({ ...isEditingRack, pdu_a_name: e.target.value }) : setNewRack({ ...newRack, pdu_a_name: e.target.value })}
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500/40 text-blue-300 font-bold"
                        placeholder="PDU-A Name"
                      />
                      <div className="flex items-center gap-2">
                         <input aria-label="PDU-A capacity in kW" type="number" min={0} step={0.1}
                          value={isEditingRack ? (isEditingRack.pdu_a_cap_kw ?? '') : newRack.pdu_a_cap_kw}
                          onChange={e => isEditingRack ? setIsEditingRack({ ...isEditingRack, pdu_a_cap_kw: e.target.value === '' ? null : parseFloat(e.target.value) }) : setNewRack({ ...newRack, pdu_a_cap_kw: e.target.value === '' ? null : parseFloat(e.target.value) })}
                          className="w-20 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] font-mono outline-none focus:border-blue-500/40 text-slate-300" 
                        />
                        <span className="text-[8px] font-black text-slate-600">kW CAP</span>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <p className="text-[8px] font-black text-slate-600 uppercase tracking-tighter">PDU-B (Redundant)</p>
                      <input 
                        aria-label="PDU-B name"
                        value={isEditingRack ? (isEditingRack.pdu_b_name || '') : newRack.pdu_b_name}
                        onChange={e => isEditingRack ? setIsEditingRack({ ...isEditingRack, pdu_b_name: e.target.value }) : setNewRack({ ...newRack, pdu_b_name: e.target.value })}
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500/40 text-blue-300 font-bold"
                        placeholder="PDU-B Name"
                      />
                      <div className="flex items-center gap-2">
                         <input aria-label="PDU-B capacity in kW" type="number" min={0} step={0.1}
                          value={isEditingRack ? (isEditingRack.pdu_b_cap_kw ?? '') : newRack.pdu_b_cap_kw}
                          onChange={e => isEditingRack ? setIsEditingRack({ ...isEditingRack, pdu_b_cap_kw: e.target.value === '' ? null : parseFloat(e.target.value) }) : setNewRack({ ...newRack, pdu_b_cap_kw: e.target.value === '' ? null : parseFloat(e.target.value) })}
                          className="w-20 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] font-mono outline-none focus:border-blue-500/40 text-slate-300" 
                        />
                        <span className="text-[8px] font-black text-slate-600">kW CAP</span>
                      </div>
                    </div>
                  </div>
                </div>

                {isEditingRack && (
                  <StyledSelect
                    label="Relocate to Site"
                    value={isEditingRack.new_site_id ? String(isEditingRack.new_site_id) : ''}
                    onChange={e => setIsEditingRack({ ...isEditingRack, new_site_id: e.target.value ? parseInt(e.target.value) : null })}
                    options={sites?.map((s: any) => ({ value: String(s.id), label: s.name })) || []}
                    placeholder="Keep current site..."
                  />
                )}
              </div>
              <div className="flex gap-3 pt-4 border-t border-white/5">
                <button type="button" onClick={closeRackEditor} className="flex-1 py-3.5 text-[10px] font-black uppercase text-slate-500 hover:text-slate-300 transition-colors">Cancel</button>
                <button
                  type="submit"
                  disabled={rackMutation.isPending}
                  className="flex-1 py-3.5 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase shadow-lg shadow-blue-500/20 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-wait">
                  {rackMutation.isPending ? 'Saving Rack...' : isEditingRack ? 'Update Config' : 'Deploy Rack'}
                </button>
              </div>
            </motion.form>
          </WorkspaceDialogFrame>
        )}

        {/* Bulk Relocate */}
        {showRelocateModal && (
          <RelocateModal
            selectedRacks={selectedRacks}
            sites={sites || []}
            onClose={() => setShowRelocateModal(false)}
            onRelocate={siteId => bulkActionMutation.mutate({ action: 'relocate', ids: selectedRacks, payload: { new_site_id: siteId } })}
          />
        )}

        {/* Restore Wizard */}
        {restoreWizard && sites && (
          <WorkspaceDialogFrame title="Restore racks" onClose={() => setRestoreWizard(null)}>
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-slate-900/95 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4 shadow-2xl space-y-4 max-h-[80vh] overflow-y-auto"
            >
              {/* Step 1: Site Selection */}
              {restoreWizard.step === 'site-select' && (
                <>
                  <h2 className="text-lg font-bold text-white">Select Target Site</h2>
                  <p className="text-sm text-slate-400">Choose where to restore these racks.</p>
                  <StyledSelect
                    options={[
                      { value: '', label: 'Standalone (No Site)' },
                      ...sites.map((s: any) => ({ value: String(s.id), label: s.name }))
                    ]}
                    value={String(restoreWizard.targetSiteId || '')}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setRestoreWizard({ ...restoreWizard, targetSiteId: e.target.value ? parseInt(e.target.value) : undefined })}
                    label="Target Site"
                  />
                  <div className="flex gap-2 pt-4">
                    <button onClick={() => setRestoreWizard(null)} className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-sm font-semibold transition-colors">Cancel</button>
                    <button onClick={() => proceedRestoreWizard(restoreWizard.targetSiteId)} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors">Next</button>
                  </div>
                </>
              )}

              {/* Step 2: Name Conflicts */}
              {restoreWizard.step === 'name-conflict' && (
                <>
                  <h2 className="text-lg font-bold text-white">Name Conflicts</h2>
                  <p className="text-sm text-slate-400">These racks have name conflicts. Rename or skip them.</p>
                  <div className="space-y-3">
                    {restoreWizard.nameConflicts.map(nc => (
                      <div key={nc.rackId} className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase">{nc.rackName}</label>
                        <input
                          type="text"
                          value={nc.newName}
                          onChange={e => {
                            const updated = restoreWizard.nameConflicts.map(c => c.rackId === nc.rackId ? { ...c, newName: e.target.value } : c)
                            setRestoreWizard({ ...restoreWizard, nameConflicts: updated })
                          }}
                          className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:border-blue-500 outline-none"
                          placeholder="New name..."
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-4">
                    <button onClick={() => setRestoreWizard(null)} className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-sm font-semibold transition-colors">Cancel</button>
                    <button onClick={() => proceedRestoreWizard(restoreWizard.targetSiteId)} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors">Next</button>
                  </div>
                </>
              )}

              {/* Step 3: Asset Warning */}
              {restoreWizard.step === 'asset-warning' && (
                <>
                  <h2 className="text-lg font-bold text-white">⚠️ Asset Status</h2>
                  {restoreWizard.generalAssetWarning && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                      <p className="text-xs text-amber-200">Previously mounted assets have been reassigned elsewhere and will not return to this rack when restored.</p>
                    </div>
                  )}
                  {restoreWizard.assetWarnings.length > 0 && (
                    <div className="space-y-2">
                      {restoreWizard.assetWarnings.map((w, i) => (
                        <div key={i} className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">
                          <p className="text-[9px] font-bold text-amber-300 mb-1">{w.rackName}</p>
                          <p className="text-[8px] text-amber-200">Currently active in other racks: {w.devices.join(', ')}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 pt-4">
                    <button onClick={() => setRestoreWizard(null)} className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-sm font-semibold transition-colors">Cancel</button>
                    <button onClick={() => executeRestore(restoreWizard.ids, restoreWizard.targetSiteId)} className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition-colors">Restore</button>
                  </div>
                </>
              )}
            </motion.div>
          </WorkspaceDialogFrame>
        )}

        {/* Rack Info Summary Modal */}
        {showingRackInfo && (
          <RackInfoModal
            rack={showingRackInfo}
            onClose={closeRackInfo}
          />
        )}

        <AuditLogModal
          isOpen={showAuditLogs}
          onClose={() => setShowAuditLogs(false)}
        />

        <BulkImportModal 
           isOpen={showImportModal} 
           onClose={() => setShowImportModal(false)} 
           tableName="racks" 
           displayName="Datacenter Racks" 
        />
    </div>
  )
}
