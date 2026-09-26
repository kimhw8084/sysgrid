import React, { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { 
  Globe, Shield, Cpu, Sliders, Box, Network, Lock, Key, Activity, Package,
  Save, RefreshCcw, RefreshCw, Layout, Database, Palette, Bell, Server, Star,
  Sun, Moon, Check, Terminal, FolderTree, HardDrive, Link, Users, UserPlus, ShieldCheck, Fingerprint, X, ChevronRight, History as HistoryIcon, 
  Settings as SettingsIcon, Zap, AlertTriangle, Edit2, Edit2 as EditIcon, Clock, RotateCcw, ChevronDown, ChevronUp, FileCode, Search, Filter, ShieldAlert, MoreHorizontal, Eye, Plus, Trash2, Tag, Book, Microscope
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { toast } from 'react-hot-toast'
import { showWorkspaceToast } from './shared/WorkspaceToast'
import { apiFetch, setApiOverride, getApiBaseUrl } from "../api/apiClient"
import { formatAppDate, parseAppDate } from "../utils/dateUtils"
import { 
  PageHeader, 
  PageToolbar, 
  ToolbarGroup, 
  ToolbarSearch,
  ToolbarSegmented,
  ToolbarButton,
  ToolbarIconButton
} from "./shared/LayoutPrimitives"
import { WorkspaceEmptyState, WorkspaceFloatingPanel, WorkspaceSelectField, useWorkspaceAnchoredLayer } from "./shared/OperationalWorkspacePrimitives"
import { WorkspaceFlyoutActionCard, WorkspaceFlyoutDropdownEditor } from "./shared/WorkspaceFlyout"
import { WorkspaceModal } from "./shared/WorkspaceModal"
import { WorkspaceHistoryShell } from "./shared/WorkspaceModalShells"
import { SystemDiagnosticsPanel } from "./settings/SystemDiagnosticsPanel"
import { useModulePolicy } from "../policy/ModulePolicy"
import {
  canViewSettingsTab,
  isSettingsTab,
  resolveSettingsPrivilegePolicy,
  type SettingsTab,
} from "./settings/settingsPrivilegePolicy"
import { normalizeTheme } from './shared/theme'

const PERMISSION_COMMIT_DEBOUNCE_MS = 900

const SettingField = ({ label, description, children, icon: Icon, onHistory, isEditable, onEdit, isPending, absPath, isModified, paramName }: any) => {
  return (
    <div className={`flex min-h-[244px] flex-col space-y-3 p-5 bg-[var(--panel-item-bg)] rounded-lg border transition-all group relative overflow-hidden ${isEditable ? 'border-blue-500/50 bg-blue-500/5' : 'border-[var(--glass-border)] hover:border-blue-500/30'}`}>
      <div className="flex min-h-[72px] items-start justify-between">
        <div className="flex items-start gap-4">
          {Icon && <div className={`p-2.5 rounded-lg transition-transform group-hover:scale-110 ${isEditable ? 'bg-blue-600 text-white' : 'bg-blue-500/10 text-blue-400'}`}><Icon size={16} /></div>}
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-primary)] leading-none">{label}</label>
              {isModified ? (
                <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[7px] font-black text-amber-500 uppercase animate-pulse">
                   Modified
                </span>
              ) : (
                <span className="px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-[7px] font-black text-emerald-500 uppercase">
                  Loaded
                </span>
              )}
            </div>
            <p className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest mt-1 leading-relaxed">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onEdit && (
            <button 
              onClick={onEdit}
              className={`p-1.5 transition-colors rounded-lg ${isEditable ? 'bg-rose-600 text-white' : 'text-[var(--text-muted)] hover:text-blue-400 hover:bg-blue-500/10'}`}
              title={isEditable ? "Lock & Discard Changes" : "Edit Field"}
            >
              {isEditable ? <Lock size={14} /> : <Edit2 size={14} />}
            </button>
          )}
          {onHistory && (
            <button 
              onClick={onHistory}
              className="p-1.5 text-[var(--text-muted)] hover:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors"
              title="View Change History"
            >
              <HistoryIcon size={14} />
            </button>
          )}
        </div>
      </div>
      
      <div className="flex min-h-[38px] flex-col gap-1.5 px-0.5">
          {paramName && (
              <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-blue-500/80 tracking-tighter">
                  <Terminal size={10} /> PARAM: {paramName}
              </div>
          )}
          {absPath && (
              <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-500 tracking-tighter">
                  <FolderTree size={10} /> FILE: {absPath}
              </div>
          )}
      </div>

      <div className="mt-auto flex items-center gap-3">
        <div className="flex-1 relative">
            {children}
        </div>
        {isModified && isEditable && (
            <motion.button 
                initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                onClick={() => onEdit('save')}
                className="p-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-lg shadow-blue-500/20 transition-all active:scale-95"
            >
                <Save size={16} />
            </motion.button>
        )}
      </div>
    </div>
  )
}

const ToggleSwitch = ({ checked, onChange, disabled, activeColor = 'bg-blue-600' }: any) => (
    <label className={`relative inline-flex items-center cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <input type="checkbox" className="sr-only peer" checked={checked} onChange={onChange} disabled={disabled} />
        <div className={`relative w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all ${checked ? activeColor : ''}`}></div>
    </label>
)

const ViewPermissionIcon = ({ level, onClick, isGlobalAdmin }: any) => {
    const colors = [
        "bg-slate-800 text-slate-500 border-slate-700/50",
        "bg-blue-500/10 text-blue-400 border-blue-500/20",
        "bg-amber-500/10 text-amber-400 border-amber-500/20",
        "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
    ];
    
    let numericLevel = 0;
    if (typeof level === 'number') numericLevel = level;
    else if (level === 'read') numericLevel = 1;
    else if (level === 'add') numericLevel = 2;
    else if (level === 'edit' || level === 'manage') numericLevel = 3;
    
    numericLevel = Math.min(3, Math.max(0, Math.floor(numericLevel || 0)));
    const colorClass = colors[numericLevel];
    
    const labels = ["NONE", "READ", "WRITE", isGlobalAdmin ? "ADMIN" : "FULL"];
    const label = labels[numericLevel];

    return (
        <button 
            onClick={onClick}
            className={`px-2 py-1 rounded-lg border text-[9px] font-black tracking-widest transition-all hover:brightness-125 w-14 text-center ${colorClass}`}
            title={label}
        >
            {label}
        </button>
    )
}

const SameButtonConfirm = ({ onConfirm, icon: Icon, label, danger = false }: any) => {
    const [isConfirming, setIsConfirming] = useState(false)
    const [timer, setTimer] = useState<any>(null)

    const handleClick = (e: any) => {
        e.stopPropagation()
        if (isConfirming) {
            onConfirm()
            setIsConfirming(false)
            if (timer) clearTimeout(timer)
        } else {
            setIsConfirming(true)
            const t = setTimeout(() => setIsConfirming(false), 3000)
            setTimer(t)
        }
    }

    return (
        <button
            onClick={handleClick}
            className={`p-2 w-9 h-9 shrink-0 rounded-lg transition-all border flex items-center justify-center ${
                isConfirming
                    ? 'bg-rose-600 border-rose-500 text-white'
                    : danger
                        ? 'text-rose-500/50 hover:text-rose-400 hover:bg-rose-500/10 border-transparent hover:border-rose-500/20'
                        : 'text-slate-500 hover:text-white hover:bg-white/5 border-transparent'
            }`}
            title={isConfirming ? "Click again to confirm" : label}
        >
            <Icon size={16} className={isConfirming ? "animate-pulse" : ""} />
        </button>
    )
}

const SettingsSubviewHeader = ({
  icon: Icon,
  title,
  subtitle,
  meta,
  actions
}: {
  icon: any
  title: string
  subtitle: string
  meta?: React.ReactNode
  actions?: React.ReactNode
}) => (
  <PageHeader
    eyebrow="Settings"
    title={
      <div className="flex items-center gap-3">
        <Icon size={18} className="text-blue-500" />
        <span>{title}</span>
      </div>
    }
    subtitle={subtitle}
    meta={meta}
    actions={actions}
  />
)

const SettingsMetaBadge = ({
  children,
  tone = 'default'
}: {
  children: React.ReactNode
  tone?: 'default' | 'blue' | 'emerald' | 'amber' | 'rose'
}) => {
  const toneClass =
    tone === 'blue'
      ? 'border-blue-500/20 bg-blue-500/10 text-blue-300'
      : tone === 'emerald'
        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
        : tone === 'amber'
          ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
          : tone === 'rose'
            ? 'border-rose-500/20 bg-rose-500/10 text-rose-300'
            : 'border-white/5 bg-white/5 text-slate-300'

  return (
    <span className={`rounded-lg border px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.18em] ${toneClass}`}>
      {children}
    </span>
  )
}

import { SettingsStandards } from "./SettingsStandards"

const PERMISSION_LEVEL_LABELS = ["None", "Read", "Write", "Full"] as const

const normalizePermissionLevel = (level: any) => {
  if (typeof level === 'number') return Math.min(3, Math.max(0, Math.floor(level)))
  if (level === 'read') return 1
  if (level === 'add' || level === 'write') return 2
  if (level === 'edit' || level === 'manage' || level === 'full' || level === 'admin') return 3
  return 0
}

const getPermissionLevelLabel = (level: any, isGlobalAdmin = false) => {
  const normalized = normalizePermissionLevel(level)
  if (isGlobalAdmin && normalized === 3) return 'Admin'
  return PERMISSION_LEVEL_LABELS[normalized]
}

const getPermissionLevelTone = (level: any, isGlobalAdmin = false) => {
  const normalized = normalizePermissionLevel(level)
  if (isGlobalAdmin && normalized === 3) return 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300'
  if (normalized === 3) return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
  if (normalized === 2) return 'border-amber-500/20 bg-amber-500/10 text-amber-300'
  if (normalized === 1) return 'border-blue-500/20 bg-blue-500/10 text-blue-300'
  return 'border-white/10 bg-black/20 text-slate-500'
}

const getOperatorPermissionLevel = (operator: any, view: string) => {
  if (!operator) return 0
  if (operator.is_admin) return 3
  return normalizePermissionLevel(operator.custom_permissions?.[view] ?? 0)
}

const toSortedStringList = (value: any) =>
  Array.isArray(value)
    ? value.map((entry) => String(entry)).filter(Boolean).sort((a, b) => a.localeCompare(b))
    : []

const getOperatorSnapshotKey = (operator: any) =>
  String(operator?.external_id ?? operator?.id ?? operator?.username ?? '')

const buildPermissionHistoryRows = (newer: any, older: any, allViews: string[]) => {
  const newerRows = Array.isArray(newer?.snapshot_data) ? newer.snapshot_data : []
  const olderRows = Array.isArray(older?.snapshot_data) ? older.snapshot_data : []
  const newerMap = new Map(newerRows.map((operator: any) => [getOperatorSnapshotKey(operator), operator]))
  const olderMap = new Map(olderRows.map((operator: any) => [getOperatorSnapshotKey(operator), operator]))
  const keys = Array.from(new Set([...newerMap.keys(), ...olderMap.keys()])).filter(Boolean)

  const isEquivalent = (a: any, b: any) => {
    if (!a && !b) return true
    const valA = String(a || '').trim()
    const valB = String(b || '').trim()
    return valA === valB
  }

  const rows = keys.map((key) => {
    const before = olderMap.get(key) || null
    const after = newerMap.get(key) || null

    if (!before && after) {
      return {
        key,
        changeKind: 'added' as const,
        before,
        after,
        fieldChanges: {},
        permissionChanges: allViews
          .map((view) => ({ view, old: 0, new: getOperatorPermissionLevel(after, view) }))
          .filter((entry) => entry.new !== entry.old),
      }
    }

    if (before && !after) {
      return {
        key,
        changeKind: 'deleted' as const,
        before,
        after,
        fieldChanges: {},
        permissionChanges: allViews
          .map((view) => ({ view, old: getOperatorPermissionLevel(before, view), new: 0 }))
          .filter((entry) => entry.new !== entry.old),
      }
    }

    const permissionChanges = allViews
      .map((view) => ({
        view,
        old: getOperatorPermissionLevel(before, view),
        new: getOperatorPermissionLevel(after, view),
      }))
      .filter((entry) => entry.old !== entry.new)

    const fieldChanges: Record<string, { old: any, new: any }> = {}
    const fieldsToTrack = [
      { key: 'full_name', label: 'Full Name' },
      { key: 'username', label: 'Username' },
      { key: 'role_name', label: 'Role' },
      { key: 'department', label: 'Department' },
      { key: 'team', label: 'Primary Team' },
      { key: 'email', label: 'Email' },
      { key: 'registration_status', label: 'Registration Status' }
    ]

    fieldsToTrack.forEach(({ key }) => {
      if (!isEquivalent(before?.[key], after?.[key])) {
        fieldChanges[key] = { old: before?.[key], new: after?.[key] }
      }
    })

    const beforeAny = before as any
    const afterAny = after as any

    const beforeTeams = JSON.stringify(toSortedStringList(beforeAny?.teams))
    const afterTeams = JSON.stringify(toSortedStringList(afterAny?.teams))
    if (beforeTeams !== afterTeams) {
      fieldChanges['groups'] = { old: toSortedStringList(beforeAny?.teams), new: toSortedStringList(afterAny?.teams) }
    }

    if (Boolean(beforeAny?.is_admin) !== Boolean(afterAny?.is_admin)) {
      fieldChanges['is_admin'] = { old: Boolean(beforeAny?.is_admin), new: Boolean(afterAny?.is_admin) }
    }

    if (Object.keys(fieldChanges).length === 0 && permissionChanges.length === 0) {
      return null
    }

    return {
      key,
      changeKind: 'changed' as const,
      before,
      after,
      fieldChanges,
      permissionChanges,
    }
  }).filter(Boolean) as Array<any>

  const order = { changed: 0, added: 1, deleted: 2 } as const
  return rows.sort((a, b) => {
    const rankDiff = order[a.changeKind] - order[b.changeKind]
    if (rankDiff !== 0) return rankDiff
    const nameA = (a.after?.full_name || a.before?.full_name || '').toLowerCase()
    const nameB = (b.after?.full_name || b.before?.full_name || '').toLowerCase()
    return nameA.localeCompare(nameB)
  })
}

function PermissionHistoryModal({ versions, allViews, onClose }: { versions: any[], allViews: string[], onClose: () => void }) {
  const [isMaximized, setIsMaximized] = useState(false)
  const [selectedIndices, setSelectedIndices] = useState<number[]>([0])
  const queryClient = useQueryClient()

  const toggleSelection = (idx: number) => {
    if (selectedIndices.includes(idx)) {
       if (selectedIndices.length > 1) {
          setSelectedIndices(selectedIndices.filter(i => i !== idx))
       }
    } else {
       if (selectedIndices.length === 2) {
          setSelectedIndices([selectedIndices[1], idx])
       } else {
          setSelectedIndices([...selectedIndices, idx].sort((a, b) => a - b))
       }
    }
  }

  const indexedVersions = (versions || []).map((v, i) => ({
    ...v,
    v_num: versions.length - i,
    label: formatAppDate(v.created_at)
  }))

  const newer = indexedVersions?.[Math.min(...selectedIndices)]
  const older = selectedIndices.length > 1 
    ? indexedVersions?.[Math.max(...selectedIndices)] 
    : (selectedIndices[0] + 1 < indexedVersions.length ? indexedVersions[selectedIndices[0] + 1] : null)

  const historyRows = React.useMemo(
    () => buildPermissionHistoryRows(newer, older, allViews),
    [allViews, newer, older]
  )
  const addedCount = historyRows.filter((row) => row.changeKind === 'added').length
  const changedCount = historyRows.filter((row) => row.changeKind === 'changed').length
  const deletedCount = historyRows.filter((row) => row.changeKind === 'deleted').length

  return (
    <WorkspaceModal
      isOpen={true}
      onClose={onClose}
      size="workspace"
      isMaximized={isMaximized}
      onMaximizeToggle={() => setIsMaximized(!isMaximized)}
      title="Permission Registry History"
      subtitle="Complete temporal lineage of operator access and identity synchronization"
      icon={<HistoryIcon size={20} />}
      footerRight={
        <ToolbarButton onClick={onClose}>Dismiss</ToolbarButton>
      }
    >
      <WorkspaceHistoryShell
          header={null}
          sidebar={
           <div className="flex h-full flex-col min-h-0">
              <div className="mb-4 flex items-center justify-between px-1">
                 <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Revision Timeline</h3>
                 <span className="text-[9px] font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/20">{indexedVersions.length} states</span>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                {indexedVersions.map((h: any, idx: number) => {
                  const isSelected = selectedIndices.includes(idx);
                  const isNewest = idx === Math.min(...selectedIndices);
                  return (
                    <button 
                      key={h.id}
                      onClick={() => toggleSelection(idx)}
                      className={`w-full p-4 rounded-lg border text-left transition-all relative group overflow-hidden ${
                        isSelected 
                          ? isNewest ? 'bg-blue-600/20 border-blue-500/40 shadow-lg shadow-blue-500/5' : 'bg-slate-800 border-slate-600' 
                          : 'bg-white/5 border-white/5 hover:border-white/10'
                      }`}
                    >
                      {isSelected && (
                        <div className={`absolute top-0 right-0 px-2 py-0.5 text-[8px] font-black uppercase rounded-lg ${isNewest ? 'bg-blue-400 text-blue-950' : 'bg-slate-500 text-slate-200'}`}>
                           {isNewest ? 'Primary' : 'Ref'}
                        </div>
                      )}
                      <div className="flex items-center justify-between mb-2">
                         <span className={`text-[11px] font-black tracking-tighter ${isSelected ? 'text-white' : 'text-blue-400'}`}>v{h.v_num}</span>
                         <span className={`text-[9px] font-bold ${isSelected ? 'text-white/60' : 'text-slate-500'}`}>
                            {h.is_active ? 'Active' : 'Archived'}
                         </span>
                      </div>
                      <p className={`text-[10px] font-bold leading-tight line-clamp-2 ${isSelected ? 'text-white/90' : 'text-slate-300'}`}>
                         By: {h.created_by || 'System'}
                      </p>
                      <div className="mt-2 flex items-center space-x-2 justify-between">
                         <div className="flex items-center space-x-2">
                           <Clock size={10} className={isSelected ? 'text-white/40' : 'text-slate-600'} />
                           <span className={`text-[8px] font-semibold ${isSelected ? 'text-white/40' : 'text-slate-600'}`}>
                              {h.label}
                           </span>
                         </div>
                         {!h.is_active && (
                           <button 
                             onClick={(e) => {
                               e.stopPropagation();
                               toast.promise(apiFetch(`/api/v1/settings/user-pool/restore/${h.id}`, { method: 'POST' }), {
                                   loading: 'Restoring state...',
                                   success: () => { queryClient.invalidateQueries({ queryKey: ['operators'] }); queryClient.invalidateQueries({ queryKey: ['teams'] }); queryClient.invalidateQueries({ queryKey: ['user-pool-versions'] }); return "Restored successfully"; },
                                   error: "Restore failed"
                               })
                             }}
                             className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-lg ${isSelected ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/40' : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'}`}
                           >
                             Restore
                           </button>
                         )}
                      </div>
                    </button>
                  )
                })}
              </div>
           </div>
          }
          content={
           <>
              <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/5 backdrop-blur-md sticky top-0 z-10">
                 <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                       <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 text-[12px] font-black">v{newer?.v_num}</div>
                       {older && (
                         <>
                           <div className="w-4 h-px bg-slate-700" />
                           <div className="w-8 h-8 rounded-lg bg-slate-800 border border-white/10 flex items-center justify-center text-slate-500 text-[12px] font-black">v{older.v_num}</div>
                         </>
                       )}
                    </div>
                    <div>
                       <h3 className="text-[11px] font-black text-slate-300 uppercase tracking-widest">
                          {selectedIndices.length > 1 ? 'Comparison Mode' : 'Latest Revision Delta'}
                       </h3>
                       <p className="text-[9px] font-bold text-slate-600">
                          {historyRows.length} identity rows changed {selectedIndices.length > 1 ? 'between the selected versions' : 'in this revision'}
                       </p>
                    </div>
                 </div>
                 <div className="flex items-center gap-4">
                   {selectedIndices.length > 1 && (
                     <button 
                       onClick={() => setSelectedIndices([0])}
                       className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/10 border border-rose-500/20 rounded-lg text-[9px] font-black text-rose-400 uppercase tracking-widest hover:bg-rose-500/20 transition-all"
                     >
                       <X size={12} />
                       Exit Comparison
                     </button>
                   )}
                   <div className="flex flex-wrap items-center gap-2">
                     <span className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-300">{addedCount} added</span>
                     <span className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-amber-300">{changedCount} changed</span>
                     <span className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-rose-300">{deletedCount} deleted</span>
                   </div>
                 </div>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
                 {historyRows.length > 0 ? (
                    <div className="space-y-6">
                       <div className="overflow-hidden rounded-lg border border-white/5 bg-black/20">
                          <table className="w-full text-left border-collapse">
                             <thead>
                                <tr className="bg-white/5 text-[9px] font-black uppercase text-slate-500 tracking-widest">
                                   <th className="p-4 min-w-[120px]">Change</th>
                                   <th className="p-4 min-w-[240px]">Identity</th>
                                   <th className="p-4 min-w-[140px]">Department</th>
                                   <th className="p-4 min-w-[140px]">Primary Team</th>
                                   <th className="p-4 min-w-[180px]">Groups</th>
                                   <th className="p-4 min-w-[140px] text-center">Admin State</th>
                                   <th className="p-4 min-w-[260px]">Permission Delta</th>
                                </tr>
                             </thead>
                             <tbody className="divide-y divide-white/5">
                                {historyRows.map((row: any) => {
                                   const current = row.after || row.before
                                   const rowTone =
                                     row.changeKind === 'added'
                                       ? 'bg-emerald-500/[0.04]'
                                       : row.changeKind === 'deleted'
                                         ? 'bg-rose-500/[0.04]'
                                         : 'bg-amber-500/[0.03]'

                                   return (
                                   <tr key={row.key} className={`${rowTone} hover:bg-white/[0.02] transition-colors align-top`}>
                                      <td className="p-4 align-top">
                                         <span className={`inline-flex rounded-lg border px-2.5 py-1 text-[8px] font-black uppercase tracking-[0.14em] ${
                                           row.changeKind === 'added'
                                             ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                                             : row.changeKind === 'deleted'
                                               ? 'border-rose-500/20 bg-rose-500/10 text-rose-300'
                                               : 'border-amber-500/20 bg-amber-500/10 text-amber-300'
                                         }`}>
                                           {row.changeKind}
                                         </span>
                                      </td>
                                      <td className="p-4 align-top">
                                         <div className="space-y-1.5">
                                           <div className="text-[11px] font-bold text-white">{current?.full_name || current?.username || 'Unknown identity'}</div>
                                           <div className="text-[9px] font-semibold text-slate-500">{current?.username || 'No username'}</div>
                                             {row.fieldChanges?.full_name && (
                                               <div className="text-[8px] font-semibold text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 mt-1">
                                                NAME: {row.fieldChanges.full_name.old || 'Empty'} {'->'} {row.fieldChanges.full_name.new || 'Empty'}
                                               </div>
                                             )}
                                           {row.fieldChanges?.email && (
                                               <div className="text-[8px] font-semibold text-amber-300 mt-1">
                                                EMAIL: {row.fieldChanges.email.old || 'Empty'} {'->'} {row.fieldChanges.email.new || 'Empty'}
                                               </div>
                                             )}
                                             {row.fieldChanges?.role_name && (
                                               <div className="text-[8px] font-semibold text-amber-300 mt-1">
                                                ROLE: {row.fieldChanges.role_name.old || 'Unassigned'} {'->'} {row.fieldChanges.role_name.new || 'Unassigned'}
                                               </div>
                                             )}
                                         </div>
                                      </td>
                                      <td className="p-4 align-top">
                                         {row.fieldChanges?.department ? (
                                           <div className="space-y-1">
                                             <div className="text-[9px] font-semibold text-slate-500 line-through">{row.fieldChanges.department.old || '—'}</div>
                                             <div className="text-[10px] font-bold text-amber-300">{row.fieldChanges.department.new || '—'}</div>
                                           </div>
                                         ) : (
                                           <span className="text-[10px] font-bold text-slate-300">{current?.department || '—'}</span>
                                         )}
                                      </td>
                                      <td className="p-4 align-top">
                                         {row.fieldChanges?.team ? (
                                           <div className="space-y-1">
                                             <div className="text-[9px] font-semibold text-slate-500 line-through">{row.fieldChanges.team.old || 'Unassigned'}</div>
                                             <div className="text-[10px] font-bold text-amber-300">{row.fieldChanges.team.new || 'Unassigned'}</div>
                                           </div>
                                         ) : (
                                           <span className="text-[10px] font-bold text-slate-300">{current?.team || 'Unassigned'}</span>
                                         )}
                                      </td>
                                      <td className="p-4 align-top">
                                         {row.fieldChanges?.groups ? (
                                           <div className="space-y-1">
                                             <div className="text-[9px] font-semibold text-slate-500 line-through">{(row.fieldChanges.groups.old || []).join(', ') || 'No groups'}</div>
                                             <div className="text-[10px] font-bold text-amber-300">{(row.fieldChanges.groups.new || []).join(', ') || 'No groups'}</div>
                                           </div>
                                         ) : (
                                           <span className="text-[10px] font-bold text-slate-300">{(toSortedStringList(current?.teams)).join(', ') || 'No groups'}</span>
                                         )}
                                      </td>
                                      <td className="p-4 align-top text-center">
                                         {row.fieldChanges?.is_admin ? (
                                           <div className="flex flex-col items-center gap-1">
                                             <span className={`inline-flex rounded-lg border px-2 py-1 text-[8px] font-black uppercase tracking-[0.14em] ${getPermissionLevelTone(row.fieldChanges.is_admin.old ? 3 : 0, row.fieldChanges.is_admin.old)}`}>
                                               {row.fieldChanges.is_admin.old ? 'Admin' : 'Standard'}
                                             </span>
                                             <ChevronDown size={8} className="text-slate-700" />
                                             <span className={`inline-flex rounded-lg border px-2 py-1 text-[8px] font-black uppercase tracking-[0.14em] ${getPermissionLevelTone(row.fieldChanges.is_admin.new ? 3 : 0, row.fieldChanges.is_admin.new)}`}>
                                               {row.fieldChanges.is_admin.new ? 'Admin' : 'Standard'}
                                             </span>
                                           </div>
                                         ) : (
                                           <span className={`inline-flex rounded-lg border px-2 py-1 text-[8px] font-black uppercase tracking-[0.14em] ${getPermissionLevelTone(Boolean(current?.is_admin) ? 3 : 0, Boolean(current?.is_admin))}`}>
                                             {Boolean(current?.is_admin) ? 'Admin' : 'Standard'}
                                           </span>
                                         )}
                                      </td>
                                      <td className="p-4 align-top">
                                         {row.permissionChanges.length > 0 ? (
                                           <div className="flex flex-wrap gap-2">
                                             {row.permissionChanges.map((change: any) => (
                                               <div key={`${row.key}-${change.view}`} className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
                                                 <div className="text-[8px] font-black uppercase tracking-[0.14em] text-slate-500">{change.view}</div>
                                                 <div className="mt-1 flex items-center gap-1.5">
                                                   <span className={`rounded-lg border px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] ${getPermissionLevelTone(change.old, Boolean(row.before?.is_admin))}`}>
                                                     {getPermissionLevelLabel(change.old, Boolean(row.before?.is_admin))}
                                                   </span>
                                                   <ChevronRight size={12} className="text-slate-600" />
                                                   <span className={`rounded-lg border px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] ${getPermissionLevelTone(change.new, Boolean(row.after?.is_admin))}`}>
                                                     {getPermissionLevelLabel(change.new, Boolean(row.after?.is_admin))}
                                                   </span>
                                                 </div>
                                               </div>
                                             ))}
                                           </div>
                                         ) : (
                                           <span className="text-[9px] font-bold text-slate-600 italic">No permission delta</span>
                                         )}
                                      </td>
                                   </tr>
                                )})}
                             </tbody>
                          </table>
                       </div>
                    </div>
                 ) : (
                    <WorkspaceEmptyState icon={<HistoryIcon size={32} />} title="No Diff Data" description="Select two versions to compare or pick a version to see changes from its predecessor." />
                 )}
              </div>
           </>
          }
      />
    </WorkspaceModal>
  )
}

import { ConfigSection } from "./ConfigRegistry"

export default function SettingsPage() {
  const [topTab, setTopTab] = useState<SettingsTab>('environments')
  const [requestedTab] = useState<SettingsTab | null>(() => {
    if (typeof window === 'undefined') return null
    const tab = new URLSearchParams(window.location.search).get('tab')
    return isSettingsTab(tab) ? tab : null
  })
  const queryClient = useQueryClient()
  const modulePolicyQuery = useModulePolicy()
  const settingsPrivileges = resolveSettingsPrivilegePolicy(modulePolicyQuery.data, modulePolicyQuery)
  const { policyReady, settingsManage, globalConfigManage, diagnosticsRead, controlPlaneAdmin } = settingsPrivileges

  useEffect(() => {
    if (!policyReady) return
    const nextTab = requestedTab && canViewSettingsTab(requestedTab, settingsPrivileges)
      ? requestedTab
      : 'environments'
    setTopTab(nextTab)

    if (requestedTab && nextTab !== requestedTab && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      params.set('tab', nextTab)
      const query = params.toString()
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
    }
  }, [policyReady, requestedTab, settingsManage, globalConfigManage, diagnosticsRead, controlPlaneAdmin])

  const { data: options } = useQuery({ 
      queryKey: ["settings-options"], 
      queryFn: async () => (await (await apiFetch("/api/v1/settings/options")).json()) 
  })

  const [showPoolLogic, setShowPoolLogic] = useState(false)
  const [isSyncEditable, setIsSyncEditable] = useState(false)
  const [historyField, setHistoryField] = useState<string | null>(null)
  const [showPermissionHistory, setShowPermissionHistory] = useState(false)
  const [viewVersionData, setViewVersionData] = useState<any>(null)
  const [viewVersionScript, setViewVersionScript] = useState<string | null>(null)
  const [editableFields, setEditableFields] = useState<Record<string, boolean>>({})
  const [emergencyUrl, setEmergencyUrl] = useState(getApiBaseUrl())
  const [showEmergencyPanel, setShowEmergencyPanel] = useState(false)
  const [newTenantName, setNewTenantName] = useState("")
  const [newTenantDbName, setNewTenantDbName] = useState("")
  const [newTenantParentFolder, setNewTenantParentFolder] = useState("")
  const [hasCustomTenantDbName, setHasCustomTenantDbName] = useState(false)
  const [tenantFolderCheck, setTenantFolderCheck] = useState<any>(null)
  const [attachName, setAttachName] = useState("")
  const [attachPath, setAttachPath] = useState("")
  const [attachMode, setAttachMode] = useState<'path' | 'url'>('path')
  const [preflightResult, setPreflightResult] = useState<any>(null)
  const [operatorFilter, setOperatorFilter] = useState("")
  const [teamFilterOpen, setTeamFilterOpen] = useState(false)
  const [selectedTeamFilters, setSelectedTeamFilters] = useState<string[]>([])
  const [operatorSort, setOperatorSort] = useState<'name' | 'team' | 'admin'>('name')
  const [selectedOperatorIds, setSelectedOperatorIds] = useState<number[]>([])
  const [bulkGroupTargetId, setBulkGroupTargetId] = useState<string>("")
  const [showPermissionBulkMenu, setShowPermissionBulkMenu] = useState(false)
  const [expandedPermissionBulkSection, setExpandedPermissionBulkSection] = useState<'assign-group' | 'remove-group' | null>(null)
  const [permissionBulkDeleteConfirm, setPermissionBulkDeleteConfirm] = useState(false)
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)
  const [teamSearch, setTeamSearch] = useState("")
  const [newTeamName, setNewTeamName] = useState("")
  const [newTeamDescription, setNewTeamDescription] = useState("")
  const [teamEditName, setTeamEditName] = useState("")
  const [teamEditDescription, setTeamEditDescription] = useState("")
  const [teamMemberPick, setTeamMemberPick] = useState("")
  const [savedTeamFilters, setSavedTeamFilters] = useState<Array<{ id: string, label: string, teams: string[] }>>([])
  const [envSearch, setEnvSearch] = useState("")
  const [envImpactFilter, setEnvImpactFilter] = useState<'ALL' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL')

  const toTenantDbFilename = React.useCallback((value: string) => {
    const normalized = (value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_-]/g, "")
      .replace(/^[_-]+|[_-]+$/g, "")
    return normalized ? `${normalized}.db` : ""
  }, [])

  const getTenantDbDisplayName = React.useCallback((dbUrl?: string | null) => {
    if (!dbUrl) return "Unresolved target"
    const normalized = dbUrl.replace(/^sqlite\+aiosqlite:\/\//, "")
    const trimmed = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized
    const parts = trimmed.split("/").filter(Boolean)
    return parts[parts.length - 1] || dbUrl
  }, [])
  const permissionSelectionAnchorRef = React.useRef<number | null>(null)
  const permissionCommitBufferRef = React.useRef<Record<number, { timeoutId: ReturnType<typeof setTimeout>, payload: any }>>({})
  const {
    triggerRef: permissionBulkTriggerRef,
    panelRef: permissionBulkPanelRef,
    panelStyle: permissionBulkPanelStyle,
  } = useWorkspaceAnchoredLayer(showPermissionBulkMenu, { minWidth: 360 })

  useEffect(() => {
    return () => {
      Object.values(permissionCommitBufferRef.current).forEach((entry) => clearTimeout(entry.timeoutId))
      permissionCommitBufferRef.current = {}
    }
  }, [])
  
  const preflightMutation = useMutation({
    mutationFn: async (target: string) => {
      const res = await apiFetch("/api/v1/tenants/admin/preflight", {
        method: "POST",
        body: JSON.stringify(attachMode === 'url' ? { db_url: target } : { db_path: target })
      })
      return res.json()
    },
    onSuccess: (data) => {
      setPreflightResult(data);
      if (data.is_valid) showWorkspaceToast("Preflight check passed");
      else showWorkspaceToast(`Preflight check failed: ${data.message}`, { type: 'error' });
    }
  })

  const attachMutation = useMutation({
    mutationFn: async (data: { name: string, db_path?: string, db_url?: string }) => {
      const res = await apiFetch("/api/v1/tenants/admin/attach", {
        method: "POST",
        body: JSON.stringify(data)
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tenants'] })
      queryClient.invalidateQueries({ queryKey: ['my-tenants'] })
      setAttachName("");
      setAttachPath("");
      setPreflightResult(null);
      showWorkspaceToast("Existing database attached to registry")
    }
  })

  const tenantFolderCheckMutation = useMutation({
    mutationFn: async (path: string) => {
      const res = await apiFetch(`/api/v1/tenants/admin/storage-explorer?path=${encodeURIComponent(path)}`)
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.detail || "Folder access test failed")
      return payload
    },
    onSuccess: (payload) => {
      setTenantFolderCheck({
        ok: Boolean(payload?.current_access?.readable && payload?.current_access?.writable),
        path: payload?.current_path,
        readable: payload?.current_access?.readable,
        writable: payload?.current_access?.writable,
      })
      showWorkspaceToast("Folder access verified")
    },
    onError: (error: any) => {
      setTenantFolderCheck({ ok: false, message: error.message })
      showWorkspaceToast(error.message || "Folder access test failed", { type: 'error' })
    }
  })
  
  const toggleEdit = (field: string, action?: 'save') => {
    if (action === 'save') {
        envMutation.mutate({ [field]: localEnv[field] });
        return;
    }
    if (editableFields[field]) {
        setLocalEnv((prev: any) => ({ ...prev, [field]: envSettings?.[field] }));
    }
    setEditableFields(prev => ({ ...prev, [field]: !prev[field] }))
  }

  const { data: userSettings } = useQuery({
    queryKey: ['user-settings'],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/settings/user/settings");
      return res.json();
    }
  });

  const currentTheme = normalizeTheme(userSettings?.theme || localStorage.getItem('sysgrid-theme'));

  const userSettingsMutation = useMutation({
    mutationFn: async (settings: any) => {
      await apiFetch("/api/v1/settings/user/settings", {
        method: "POST",
        body: JSON.stringify(settings)
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-settings'] })
    }
  })

  const changeTheme = (themeId: string) => {
    const normalizedTheme = normalizeTheme(themeId)
    localStorage.setItem('sysgrid-theme', normalizedTheme)
    document.documentElement.setAttribute('data-theme', normalizedTheme)
    const isLight = normalizedTheme === 'pure-clarity'
    if (isLight) document.documentElement.classList.remove('dark')
    else document.documentElement.classList.add('dark')
    
    userSettingsMutation.mutate({ theme: normalizedTheme })
    showWorkspaceToast(`Theme switched to ${normalizedTheme === 'nordic-frost-v1' ? 'Dark Mode' : 'Light Mode'}`)
  }

  const { data: envSettings, isLoading: isEnvLoading, isError: isEnvError } = useQuery({
    queryKey: ['env-settings'],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/settings/global")
      const data = await res.json()
      // Persist to local storage for bootstrap fallback
      Object.entries(data).forEach(([k, v]) => {
        localStorage.setItem(`SYSGRID_CONFIG_${k}`, String(v));
      });
      return data
    },
    retry: 1,
    enabled: globalConfigManage && (topTab === 'environments' || topTab === 'system'),
  })

  const [localEnv, setLocalEnv] = useState<any>({})

  const isDisconnected = globalConfigManage && isEnvError && !isEnvLoading;

  const handleApplyOverride = () => {
    setApiOverride(emergencyUrl);
    queryClient.invalidateQueries();
    showWorkspaceToast("API Override applied. Attempting reconnection...");
  }

  const handleClearOverride = () => {
    setApiOverride(null);
    setEmergencyUrl(getApiBaseUrl());
    queryClient.invalidateQueries();
    showWorkspaceToast("API Override cleared. Resetting to defaults.");
  }

  const isDirty = (field?: string) => {
      if (!envSettings) return false;
      if (field) return String(localEnv[field]) !== String(envSettings[field]);
      return Object.keys(localEnv).some(k => String(localEnv[k]) !== String(envSettings[k]));
  }

  const getImpactTone = (impact?: string) => {
    switch (impact) {
      case 'CRITICAL':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20'
      case 'HIGH':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      case 'MEDIUM':
        return 'bg-sky-500/10 text-sky-400 border-sky-500/20'
      default:
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
    }
  }

  const getPersistableEnvSettings = () =>
    Object.fromEntries(
      Object.entries(localEnv || {}).filter(([key]) => !key.startsWith('_'))
    )

  const [userPoolScript, setUserPoolScript] = useState(`# Provide real identity-source records to the backend refresh endpoint.
# Expected record fields:
# external_id, username, full_name, email, department, team, registration_status`)

  useEffect(() => {
    if (envSettings) {
        setLocalEnv(envSettings);
    }
  }, [envSettings])

  useEffect(() => {
    if (!hasCustomTenantDbName) {
      setNewTenantDbName(toTenantDbFilename(newTenantName))
    }
  }, [hasCustomTenantDbName, newTenantName, toTenantDbFilename])

  const envMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiFetch("/api/v1/settings/global", {
        method: "POST",
        body: JSON.stringify(data)
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (data, variables) => {
      if (variables.VITE_API_BASE_URL) {
        setApiOverride(variables.VITE_API_BASE_URL);
        showWorkspaceToast("UI Gateway updated & persisted locally");
      }
      queryClient.invalidateQueries({ queryKey: ['env-settings'] })
      queryClient.invalidateQueries({ queryKey: ['env-history'] })
      setEditableFields({})
      showWorkspaceToast("Global Configuration synchronized to Database")
    }
  })

  const [syncPreviewData, setSyncPreviewData] = useState<any>(null)
  const [isSyncPreviewOpen, setIsSyncPreviewOpen] = useState(false)

  const poolMutation = useMutation({
    mutationFn: async ({ script, preview = false }: { script: string, preview?: boolean }) => {
      const res = await apiFetch("/api/v1/settings/user-pool/refresh", {
        method: "POST",
        body: JSON.stringify({ script, preview })
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (data, variables) => {
      if (variables.preview) {
        setSyncPreviewData(data);
        setIsSyncPreviewOpen(true);
      } else {
        queryClient.invalidateQueries({ queryKey: ['operators'] })
        queryClient.invalidateQueries({ queryKey: ['user-pool-versions'] })
        setIsSyncEditable(false);
        setIsSyncPreviewOpen(false);
        setSyncPreviewData(null);
        showWorkspaceToast("User Pool synchronized via Python logic")
      }
    }
  })

  const { data: operators } = useQuery({
    queryKey: ['operators'],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/settings/operators")
      return res.json()
    }
  })

  const { data: teams } = useQuery({
    queryKey: ['teams'],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/settings/teams")
      return res.json()
    }
  })

  const { data: selectedTeamAudit } = useQuery({
    queryKey: ['team-audit', selectedTeamId],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/settings/teams/${selectedTeamId}/audit`)
      return res.json()
    },
    enabled: settingsManage && topTab === 'groups' && !!selectedTeamId
  })

  const { data: poolVersions } = useQuery({
    queryKey: ['user-pool-versions'],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/settings/user-pool/versions")
      return res.json()
    },
    enabled: settingsManage && topTab === 'permissions',
  })

  const { data: envHistory } = useQuery({
    queryKey: ['env-history', historyField],
    queryFn: async () => {
      if (!historyField) return null;
      const res = await apiFetch(`/api/v1/settings/env/history?field=${historyField}`)
      return res.json()
    },
    enabled: globalConfigManage && !!historyField
  })

  const backupTenantMutation = useMutation({
    mutationFn: async (tenantId: number) => {
      const res = await apiFetch(`/api/v1/tenants/admin/backup/${tenantId}`, { method: "POST" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tenants'] })
      showWorkspaceToast("Database backup initiated and saved to storage")
    }
  })

  const { data: allTenants } = useQuery({
    queryKey: ['admin-tenants'],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/tenants/admin/all")
      return res.json()
    },
    enabled: controlPlaneAdmin && topTab === 'tenants'
  })

  const { data: tenantAdminSettings } = useQuery({
    queryKey: ['tenant-admin-settings'],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/tenants/admin/settings")
      return res.json()
    },
    enabled: controlPlaneAdmin && topTab === 'tenants'
  })

  useEffect(() => {
    const storageRoot = tenantAdminSettings?.find((item: any) => item.key === 'tenant_storage_root')?.value || ""
    if (storageRoot && !newTenantParentFolder) {
      setNewTenantParentFolder(storageRoot)
    }
  }, [tenantAdminSettings, newTenantParentFolder])

  const createTenantMutation = useMutation({
    mutationFn: async (data: { name: string, db_name?: string, parent_folder?: string }) => {
      const res = await apiFetch("/api/v1/tenants/admin/create", {
        method: "POST",
        body: JSON.stringify(data)
      })
      if (!res.ok) {
        const payload = await res.json().catch(async () => ({ detail: await res.text() }))
        throw new Error(payload?.detail || "Failed to create tenant")
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tenants'] })
      queryClient.invalidateQueries({ queryKey: ['my-tenants'] })
      setNewTenantName("")
      setNewTenantDbName("")
      setNewTenantParentFolder("")
      setHasCustomTenantDbName(false)
      setTenantFolderCheck(null)
      showWorkspaceToast("New tenant database created and initialized")
    },
    onError: (error: any) => {
      showWorkspaceToast(error.message || "Failed to create tenant", { type: 'error' })
    },
  })

  const envHelp: any = {
    API_ENDPOINT: { details: "Core service URL for backend connectivity.", impact: "HIGH" },
    DATABASE_URL: { details: "Primary storage location for the system database.", impact: "CRITICAL" },
    STORAGE_ROOT: { details: "Base directory for all persistent system data.", impact: "MEDIUM" },
    IMAGE_PATH: { details: "Sub-path for milestone captures and forensics.", impact: "LOW" },
    LOG_LEVEL: { details: "Verbosity of backend engine tracing.", impact: "LOW" },
    VITE_UI_TIMEOUT: { details: "Frontend API request timeout in milliseconds.", impact: "LOW" },
    VITE_UI_DEBUG_LOGGING: { details: "Enable detailed logging in the browser console.", impact: "LOW" },
    HOT_RELOAD_ENABLED: { details: "Toggle whether environment changes trigger immediate engine restart.", impact: "MEDIUM" },
    MAX_UPLOAD_SIZE: { details: "Maximum allowed file size for imports (MB).", impact: "MEDIUM" },
    WORKER_COUNT: { details: "Number of concurrent processing threads for the engine.", impact: "HIGH" },
    CACHE_TTL: { details: "Duration to keep volatile data in memory (seconds).", impact: "MEDIUM" },
    SMTP_HOST: { details: "Mail server for system-wide alerts.", impact: "LOW" },
    SMTP_PORT: { details: "Port used for SMTP communications.", impact: "LOW" },
    ALERT_EMAIL: { details: "Primary destination for critical alerts.", impact: "LOW" },
    ENABLE_AUDIT_LOGS: { details: "Toggle persistent recording of all operator actions.", impact: "MEDIUM" },
    DB_BACKUP_SCHEDULE: { details: "Crontab-style expression for automated backups.", impact: "HIGH" },
    TOKEN_ALGORITHM: { details: "Security algorithm for JWT signing.", impact: "CRITICAL" },
    REQUEST_TIMEOUT: { details: "Internal backend-to-backend request deadline.", impact: "MEDIUM" },
    VITE_API_BASE_URL: { details: "URL browser uses to talk to backend. If empty, defaults to origin proxy.", impact: "HIGH" },
    PORT: { details: "The primary port for the backend engine services.", impact: "HIGH" },
    VITE_APP_TITLE: { details: "Display name in browser tab and splash screen.", impact: "LOW" },
    VITE_POLLING_INTERVAL: { details: "Frequency of background dashboard synchronization (ms).", impact: "MEDIUM" },
    VITE_ENABLE_ANALYTICS: { details: "Toggle anonymized UI usage telemetry.", impact: "LOW" },
    VITE_MAX_GRID_ROWS: { details: "Pagination limit for high-density data grids.", impact: "MEDIUM" },
    VITE_THEME_DEFAULT: { details: "Default visual profile for new operator sessions.", impact: "LOW" },
    VITE_MAINTENANCE_MODE: { details: "Activate read-only mode for all operators.", impact: "HIGH" },
    VITE_SUPPORT_URL: { details: "Link to the operational support portal.", impact: "LOW" },
    VITE_AUTO_LOGOUT_IDLE: { details: "Seconds of inactivity before session termination.", impact: "MEDIUM" },
    VITE_TOAST_DURATION: { details: "Visibility duration for UI notifications (ms).", impact: "LOW" },
    VITE_ENABLE_WEBSOCKETS: { details: "Toggle real-time engine-to-ui updates.", impact: "HIGH" },
    VITE_BACKEND_PORT: { details: "The port used by the UI proxy to reach the engine.", impact: "HIGH" }
  }

  const { data: userProfile } = useQuery({
    queryKey: ['user-profile'],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/settings/user/profile");
      return res.json();
    }
  });

  const operatorMutation = useMutation({
    mutationFn: async (op: any) => {
      const isUpdate = !!op.id;
      const url = isUpdate ? `/api/v1/settings/operators/${op.id}` : "/api/v1/settings/operators";
      const res = await apiFetch(url, {
        method: isUpdate ? "PATCH" : "POST",
        body: JSON.stringify(op)
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['operators'] })
      queryClient.invalidateQueries({ queryKey: ['user-pool-versions'] })
      // If updating current user, refresh their profile to reflect permission changes immediately
      if (variables.username === userProfile?.username) {
        queryClient.invalidateQueries({ queryKey: ['user-profile'] })
      }
      showWorkspaceToast("Security profile synchronized")
    }
  })

  const applyOptimisticOperatorPatch = (operatorId: number, patch: any) => {
    queryClient.setQueryData(['operators'], (current: any) => {
      if (!Array.isArray(current)) return current
      return current.map((operator: any) => (
        operator.id === operatorId
          ? {
              ...operator,
              ...patch,
              custom_permissions: patch.custom_permissions ?? operator.custom_permissions,
            }
          : operator
      ))
    })

    if (patch.username === userProfile?.username) {
      queryClient.setQueryData(['user-profile'], (current: any) => (
        current
          ? {
              ...current,
              permissions: {
                ...(current.permissions || {}),
                ...(patch.custom_permissions || {}),
              },
            }
          : current
      ))
    }
  }

  const queuePermissionCommit = (op: any, payload: any) => {
    const existing = permissionCommitBufferRef.current[op.id]
    if (existing) clearTimeout(existing.timeoutId)

    applyOptimisticOperatorPatch(op.id, payload)

    const timeoutId = setTimeout(() => {
      const queued = permissionCommitBufferRef.current[op.id]
      if (!queued) return
      delete permissionCommitBufferRef.current[op.id]
      operatorMutation.mutate(queued.payload, {
        onError: () => {
          queryClient.invalidateQueries({ queryKey: ['operators'] })
          queryClient.invalidateQueries({ queryKey: ['user-pool-versions'] })
          if (queued.payload.username === userProfile?.username) {
            queryClient.invalidateQueries({ queryKey: ['user-profile'] })
          }
        }
      })
    }, PERMISSION_COMMIT_DEBOUNCE_MS)

    permissionCommitBufferRef.current[op.id] = { timeoutId, payload }
  }

  const deleteOperatorMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiFetch(`/api/v1/settings/operators/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error(await res.text())
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators'] })
      queryClient.invalidateQueries({ queryKey: ['user-pool-versions'] })
    }
  })

  const bulkOperatorPatchMutation = useMutation({
    mutationFn: async ({ updates }: { updates: Array<{ id: number, payload: any }> }) => {
      const res = await apiFetch(`/api/v1/settings/operators/bulk-update`, {
        method: "POST",
        body: JSON.stringify({ updates })
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators'] })
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['user-pool-versions'] })
      if (selectedTeamId) queryClient.invalidateQueries({ queryKey: ['team-audit', selectedTeamId] })
      setSelectedOperatorIds([])
      showWorkspaceToast("Identity updates applied")
    }
  })

  const bulkOperatorDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await apiFetch(`/api/v1/settings/operators/bulk-delete`, {
        method: "POST",
        body: JSON.stringify({ ids })
      })
      if (!res.ok) throw new Error(await res.text())
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators'] })
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['user-pool-versions'] })
      setSelectedOperatorIds([])
      showWorkspaceToast("Selected identities removed")
    }
  })

  const teamMutation = useMutation({
    mutationFn: async (payload: any) => {
      const isUpdate = !!payload.id
      const url = isUpdate ? `/api/v1/settings/teams/${payload.id}` : "/api/v1/settings/teams"
      const res = await apiFetch(url, {
        method: isUpdate ? "PATCH" : "POST",
        body: JSON.stringify(payload)
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (team) => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['user-pool-versions'] })
      if (team?.id) {
        queryClient.invalidateQueries({ queryKey: ['team-audit', team.id] })
        setSelectedTeamId(team.id)
      }
      setNewTeamName("")
      setNewTeamDescription("")
      showWorkspaceToast("Team registry synchronized")
    }
  })

  const deleteTeamMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiFetch(`/api/v1/settings/teams/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error(await res.text())
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['operators'] })
      queryClient.invalidateQueries({ queryKey: ['user-pool-versions'] })
      setSelectedTeamId(null)
      showWorkspaceToast("Team removed")
    }
  })

  const bulkTeamMutation = useMutation({
    mutationFn: async ({ ids, teamId, teamName, teams, teamSource }: { ids: number[], teamId?: number | null, teamName?: string | null, teams?: string[], teamSource?: string }) => {
      const updates = ids.map(async (id) => {
        const res = await apiFetch(`/api/v1/settings/operators/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ 
            team_id: teamId ?? null, 
            team: teamName ?? null, 
            teams: teams || [],
            team_source: teamSource || (teamId ? 'manual_override' : 'manual') 
          })
        })
        if (!res.ok) throw new Error(await res.text())
        return res.json()
      })
      return Promise.all(updates)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators'] })
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      if (selectedTeamId) queryClient.invalidateQueries({ queryKey: ['team-audit', selectedTeamId] })
      setSelectedOperatorIds([])
      setTeamMemberPick("")
    }
  })

  const [newOpId, setNewOpId] = useState("")

  const filteredTeams = (teams || []).filter((team: any) => {
    const query = teamSearch.trim().toLowerCase()
    if (!query) return true
    return [team.name, team.description, team.source]
      .filter(Boolean)
      .some((value: string) => value.toLowerCase().includes(query))
  })

  const filteredOperators = [...(operators || [])]
    .filter((op: any) => {
      const query = operatorFilter.trim().toLowerCase()
      const matchesQuery = !query || [
        op.full_name,
        op.username,
        op.external_id,
        op.department,
        op.team,
        op.email
      ]
        .filter(Boolean)
        .some((value: string) => value.toLowerCase().includes(query))
      const matchesTeam = selectedTeamFilters.length === 0 || selectedTeamFilters.includes(op.team || 'Unassigned')
      return matchesQuery && matchesTeam
    })
    .sort((a: any, b: any) => {
      if (operatorSort === 'admin') return Number(b.is_admin) - Number(a.is_admin) || (a.full_name || '').localeCompare(b.full_name || '')
      if (operatorSort === 'name') return (a.full_name || '').localeCompare(b.full_name || '')
      return (a.team || 'Unassigned').localeCompare(b.team || 'Unassigned') || (a.full_name || '').localeCompare(b.full_name || '')
    })

  const selectedTeam = (teams || []).find((team: any) => team.id === selectedTeamId) || null
  const bulkGroupTarget = (teams || []).find((team: any) => String(team.id) === String(bulkGroupTargetId)) || null
  const selectedTeamMembers = (operators || []).filter((op: any) => op.team_id === selectedTeamId)
  const availableTeamCandidates = (operators || []).filter((op: any) => op.team_id !== selectedTeamId)
  const allTeamNames = Array.from(new Set((teams || []).map((team: any) => team.name))).sort() as string[]
  const selectedOperators = (operators || []).filter((op: any) => selectedOperatorIds.includes(op.id))

  useEffect(() => {
    if (selectedTeam) {
      setBulkGroupTargetId(String(selectedTeam.id))
    }
  }, [selectedTeam?.id])

  useEffect(() => {
    if (!showPermissionBulkMenu) return
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        permissionBulkTriggerRef.current?.contains(target as HTMLElement) ||
        permissionBulkPanelRef.current?.contains(target) ||
        (target instanceof HTMLElement && target.closest('[data-workspace-panel]'))
      ) return
      setShowPermissionBulkMenu(false)
      setExpandedPermissionBulkSection(null)
      setPermissionBulkDeleteConfirm(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [permissionBulkPanelRef, permissionBulkTriggerRef, showPermissionBulkMenu])

  useEffect(() => {
    if (selectedOperatorIds.length > 0) return
    setShowPermissionBulkMenu(false)
    setExpandedPermissionBulkSection(null)
    setPermissionBulkDeleteConfirm(false)
  }, [selectedOperatorIds.length])

  const handleAddOperator = () => {
    if (!newOpId) return;
    operatorMutation.mutate({ 
      external_id: newOpId, 
      username: newOpId.toLowerCase(), 
      full_name: newOpId,
      department: "Sector-01",
      registration_status: "Verified",
      is_admin: false,
      custom_permissions: {}
    });
    setNewOpId("");
  }

  const handleOperatorSelection = (id: number, event?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    const visibleIds = filteredOperators.map((op: any) => op.id)
    const anchorId = permissionSelectionAnchorRef.current ?? id
    const isRangeSelection = Boolean(event?.shiftKey)
    const isToggleSelection = Boolean(event?.metaKey || event?.ctrlKey)

    if (isRangeSelection) {
      const startIndex = visibleIds.indexOf(anchorId)
      const endIndex = visibleIds.indexOf(id)
      if (startIndex !== -1 && endIndex !== -1) {
        const rangeIds = visibleIds.slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1)
        setSelectedOperatorIds((current) => isToggleSelection ? Array.from(new Set([...current, ...rangeIds])) : rangeIds)
        return
      }
    }

    permissionSelectionAnchorRef.current = id
    if (isToggleSelection) {
      setSelectedOperatorIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
      return
    }
    setSelectedOperatorIds([id])
  }

  const togglePermissionBulkMenu = () => {
    if (selectedOperatorIds.length === 0) return
    setShowPermissionBulkMenu((current) => !current)
    setPermissionBulkDeleteConfirm(false)
  }

  const assignSelectedOperatorsToFocusedGroup = () => {
    if (!bulkGroupTarget || selectedOperators.length === 0) return
    bulkOperatorPatchMutation.mutate({
      updates: selectedOperators.map((op: any) => ({
        id: op.id,
        payload: {
          teams: Array.from(new Set([...(op.teams || []), bulkGroupTarget.name])),
          team_source: 'manual_override'
        }
      }))
    })
  }

  const removeSelectedOperatorsFromFocusedGroup = () => {
    if (!bulkGroupTarget || selectedOperators.length === 0) return
    bulkOperatorPatchMutation.mutate({
      updates: selectedOperators.map((op: any) => ({
        id: op.id,
        payload: {
          teams: (op.teams || []).filter((teamName: string) => teamName !== bulkGroupTarget.name),
          team_source: 'manual_override'
        }
      }))
    })
  }

  const bulkSetAdminState = (isAdmin: boolean) => {
    if (selectedOperators.length === 0) return
    bulkOperatorPatchMutation.mutate({
      updates: selectedOperators.map((op: any) => ({
        id: op.id,
        payload: { is_admin: isAdmin }
      }))
    })
  }

  const bulkDeleteSelectedOperators = () => {
    const deletableIds = selectedOperators
      .filter((op: any) => op.username !== userProfile?.username)
      .map((op: any) => op.id)
    if (deletableIds.length === 0) {
      showWorkspaceToast("Protected identities cannot be removed", { type: 'error' })
      return
    }
    if (!window.confirm(`Delete ${deletableIds.length} selected identities?`)) return
    bulkOperatorDeleteMutation.mutate(deletableIds)
  }

  const toggleTeamFilter = (teamName: string) => {
    setSelectedTeamFilters((current) => current.includes(teamName) ? current.filter((value) => value !== teamName) : [...current, teamName])
  }

  const saveCurrentTeamFilter = () => {
    if (selectedTeamFilters.length === 0) {
      toast.error("Select at least one team filter before saving")
      return
    }
    const label = selectedTeamFilters.join(" + ")
    setSavedTeamFilters((current) => [...current, { id: `${Date.now()}`, label, teams: selectedTeamFilters }])
    showWorkspaceToast("Saved team filter preset")
  }

  const allViews = [
    "projects", "racks", "assets", "services", "external", "network", 
    "architecture", "research", "far", "monitoring", "vendors", 
    "knowledge", "logs", "settings"
  ];

  const envEntries = Object.entries(localEnv || {}).filter(([key]) => !key.startsWith('_'))
  const totalEnvParams = envEntries.length
  const dirtyEnvCount = envEntries.filter(([key]) => isDirty(key)).length
  const criticalEnvCount = envEntries.filter(([key]) => envHelp[key]?.impact === 'CRITICAL').length
  const filteredEnvEntries = envEntries.filter(([key, value]) => {
    const metadata = localEnv._metadata?.[key]
    const details = envHelp[key]
    const query = envSearch.trim().toLowerCase()
    const matchesQuery = !query || [
      key,
      value == null ? '' : String(value),
      metadata?.category,
      metadata?.file,
      metadata?.param,
      details?.details,
      details?.impact
    ]
      .filter(Boolean)
      .some((part) => String(part).toLowerCase().includes(query))

    const matchesImpact = envImpactFilter === 'ALL' || details?.impact === envImpactFilter
    return matchesQuery && matchesImpact
  })
  const visibleCategories = Array.from(
    new Set(filteredEnvEntries.map(([key]) => localEnv._metadata?.[key]?.category).filter(Boolean))
  )
  const metadataViewBindings = {
    MonitoringPlatform: [{ label: 'Monitoring', path: '/monitoring' }],
    MonitoringCategory: [{ label: 'Monitoring', path: '/monitoring' }],
    MonitoringTeam: [{ label: 'Monitoring', path: '/monitoring' }, { label: 'Groups', path: '/settings?tab=groups' }],
    Status: [{ label: 'Assets', path: '/asset' }, { label: 'Services', path: '/services' }, { label: 'External', path: '/external' }],
    Environment: [{ label: 'Assets', path: '/asset' }, { label: 'Services', path: '/services' }, { label: 'External', path: '/external' }],
    DeviceType: [{ label: 'Assets', path: '/asset' }],
    LogicalSystem: [{ label: 'Assets', path: '/asset' }, { label: 'Vendors', path: '/vendors' }],
    ServiceType: [{ label: 'Services', path: '/services' }],
    ExternalType: [{ label: 'External', path: '/external' }],
    LinkPurpose: [{ label: 'Network', path: '/network' }],
    NetworkFarm: [{ label: 'Network', path: '/network' }],
    NetworkCableType: [{ label: 'Network', path: '/network' }],
    VendorCountry: [{ label: 'Vendors', path: '/vendors' }],
    VendorDeviceType: [{ label: 'Vendors', path: '/vendors' }],
  } as const
  const themeOptions = [
    {
      id: 'pure-clarity',
      label: 'Light',
      helper: 'Readable operator mode',
      swatch: 'from-amber-100 via-white to-sky-100'
    },
    {
      id: 'nordic-frost-v1',
      label: 'Dark',
      helper: 'High-density analyst mode',
      swatch: 'from-slate-900 via-slate-800 to-cyan-900'
    }
  ]

  useEffect(() => {
    try {
      const raw = localStorage.getItem('sysgrid-permission-team-filters-v1')
      if (raw) setSavedTeamFilters(JSON.parse(raw))
    } catch {
      setSavedTeamFilters([])
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('sysgrid-permission-team-filters-v1', JSON.stringify(savedTeamFilters))
  }, [savedTeamFilters])

  useEffect(() => {
    if (!selectedTeamId && teams?.length) {
      setSelectedTeamId(teams[0].id)
    }
  }, [teams, selectedTeamId])

  useEffect(() => {
    const team = (teams || []).find((entry: any) => entry.id === selectedTeamId)
    if (team) {
      setTeamEditName(team.name || "")
      setTeamEditDescription(team.description || "")
    }
  }, [teams, selectedTeamId])

  const getPermLevel = (op: any, view: string) => {
    const perms = { ...(op.role?.permissions || {}), ...(op.custom_permissions || {}) };
    const val = perms?.[view] ?? perms?.['all'] ?? 0;
    if (typeof val === 'number') return val;
    if (val === 'read') return 1;
    if (val === 'add') return 2;
    if (val === 'edit' || val === 'manage') return 3;
    return 0;
  }

  const togglePermission = (op: any, view: string) => {
    const queuedPayload = permissionCommitBufferRef.current[op.id]?.payload
    const workingOperator = queuedPayload
      ? {
          ...op,
          ...queuedPayload,
          custom_permissions: queuedPayload.custom_permissions ?? op.custom_permissions,
        }
      : op

    // Admin Lock-out Protection
    if (workingOperator.username === userProfile?.username && view === 'settings') {
        const current = getPermLevel(workingOperator, view);
        if (current === 3 && !confirm("WARNING: Reducing your own 'Settings' permission may lock you out of this console. Proceed?")) {
            return;
        }
    }

    const current = getPermLevel(workingOperator, view);
    const next = (current + 1) % 4;
    
    // Always persist as numeric for simplicity in this update
    const newPerms = { ...(workingOperator.custom_permissions || {}), [view]: next };
    queuePermissionCommit(workingOperator, { ...workingOperator, custom_permissions: newPerms });
  }

  return (
    <div className="h-full min-h-0 min-w-0 flex flex-col space-y-4 w-full mx-auto px-0 sm:px-4 overflow-hidden relative" data-settings-workspace="true">
      <AnimatePresence>
        {isDisconnected && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="shrink-0 bg-rose-600/10 border border-rose-500/30 rounded-lg p-4 flex flex-col gap-3 backdrop-blur-md"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-rose-600 text-white rounded-lg animate-pulse"><ShieldAlert size={18} /></div>
                <div>
                  <h3 className="text-[11px] font-black uppercase text-rose-500 tracking-widest leading-none">Connectivity Failure</h3>
                  <p className="text-[9px] font-bold text-rose-400/70 uppercase mt-1 tracking-tighter">Backend engine unreachable via {getApiBaseUrl() || 'Relative Proxy'}</p>
                </div>
              </div>
              <button 
                onClick={() => setShowEmergencyPanel(!showEmergencyPanel)}
                className="px-4 py-2 bg-rose-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-rose-500 transition-all shadow-lg shadow-rose-500/20"
              >
                {showEmergencyPanel ? 'Hide Rescue Tools' : 'Emergency Override'}
              </button>
            </div>

            {showEmergencyPanel && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-4 pt-2 border-t border-rose-500/20">
                <div className="flex-1 relative">
                  <Terminal className="absolute left-3 top-1/2 -translate-y-1/2 text-rose-500/50" size={14} />
                  <input
                    value={emergencyUrl} onChange={e => setEmergencyUrl(e.target.value)}
                    placeholder="e.g. http://10.0.0.1:8000"
                    className="w-full bg-black/40 border border-rose-500/30 rounded-lg pl-10 pr-4 py-2.5 text-[10px] font-mono text-rose-400 outline-none focus:border-rose-500"
                  />                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={handleApplyOverride}
                    className="px-6 py-2.5 bg-emerald-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-emerald-500 transition-all"
                  >
                    Apply Override
                  </button>
                  <button 
                    onClick={handleClearOverride}
                    className="px-6 py-2.5 bg-slate-700 text-white rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-slate-600 transition-all"
                  >
                    Reset Defaults
                  </button>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <PageHeader 
        title={
          <div className="flex items-center gap-3">
            <SettingsIcon className="text-blue-500" size={18} />
            <span>Settings</span>
          </div>
        } 
        subtitle="System Configuration & Golden Template"
        actions={
          <div className="flex items-center gap-2 pr-2">
            {topTab !== 'standards' && (
              <ToolbarButton
                  onClick={() => setTopTab('standards')}
                  variant="secondary"
                  className="bg-blue-600/10 border-blue-500/30 text-blue-400 hover:bg-blue-600/20"
              >
                  <Layout size={14} className="mr-2 inline-block" />
                  <span>Golden Template</span>
              </ToolbarButton>
            )}
            {topTab === 'environments' && globalConfigManage && (
              <ToolbarButton
                  onClick={() => envMutation.mutate(getPersistableEnvSettings())}
                  variant="secondary"
                  className={isDirty() ? 'bg-amber-600/10 border-amber-500/30 text-amber-500 animate-pulse' : 'bg-emerald-600/10 border-emerald-500/30 text-emerald-500 hover:bg-emerald-600/20'}
              >
                  <Zap size={14} className={`mr-2 inline-block ${envMutation.isPending ? 'animate-pulse' : ''}`} />
                  <span>Force Hot Reload</span>
              </ToolbarButton>
            )}
          </div>
        }
      />

      <ToolbarSegmented 
        options={[
          { label: 'Parameters', value: 'environments' },
          ...(settingsManage ? [
            { label: 'Permissions', value: 'permissions' as const },
            { label: 'Groups', value: 'groups' as const },
            { label: 'Metadata', value: 'metadata' as const },
            ...(globalConfigManage ? [{ label: 'Analysis', value: 'system' as const }] : []),
          ] : []),
          ...(diagnosticsRead ? [{ label: 'System Diagnostics', value: 'diagnostics' as const }] : []),
          ...(controlPlaneAdmin ? [{ label: 'Tenants', value: 'tenants' as const }] : []),
          { label: 'Standards', value: 'standards' }
        ]}
        value={topTab}
        onChange={(val: any) => {
          const nextTab = val as SettingsTab
          setTopTab(canViewSettingsTab(nextTab, settingsPrivileges) ? nextTab : 'environments')
        }}
      />

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto custom-scrollbar pr-2 pb-20">
        <AnimatePresence mode="wait">
          {topTab === 'metadata' && settingsManage && (
             <motion.div key="metadata" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="min-w-0 space-y-4 pt-2" data-settings-tab-content="metadata">
                <PageToolbar wrapOnMobile
                  left={
                    <ToolbarGroup>
                      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Metadata Registry</span>
                    </ToolbarGroup>
                  }
                />

                <div className="flex items-center gap-4 px-1">
                   <div className="h-px flex-1 bg-white/5" />
                   <p className="text-[8px] font-bold text-slate-600 uppercase tracking-[0.3em]">Forensic Lineage & Global Parameters</p>
                   <div className="h-px flex-1 bg-white/5" />
                </div>

                <div className="grid grid-cols-1 gap-4">
                   <ConfigSection 
                      title="Monitoring Platforms" 
                      category="MonitoringPlatform" 
                      icon={Globe} 
                      description="Drives platform selectors and validation in Monitoring."
                      usageTargets={metadataViewBindings.MonitoringPlatform}
                      options={(options || []).filter((o:any) => o.category === "MonitoringPlatform")} 
                   />
                   <ConfigSection 
                      title="Monitoring Categories" 
                      category="MonitoringCategory" 
                      icon={Tag} 
                      description="Feeds monitor category selectors, imports, and grid metadata."
                      usageTargets={metadataViewBindings.MonitoringCategory}
                      options={(options || []).filter((o:any) => o.category === "MonitoringCategory")} 
                   />
                   <ConfigSection 
                      title="Monitoring Ownership" 
                      category="MonitoringTeam" 
                      icon={Users} 
                      description="Defines monitoring ownership groups exposed in Monitoring and Settings."
                      usageTargets={metadataViewBindings.MonitoringTeam}
                      options={teams || []}
                   />
                   <div className="h-px bg-white/5 my-4" />
                   <ConfigSection 
                      title="Asset Statuses" 
                      category="Status" 
                      icon={Activity} 
                      description="Used in asset and service lifecycle selectors."
                      usageTargets={metadataViewBindings.Status}
                      options={(options || []).filter((o:any) => o.category === "Status")} 
                   />
                   <ConfigSection 
                      title="Deployment Environments" 
                      category="Environment" 
                      icon={Box} 
                      description="Shared environment taxonomy across assets and services."
                      usageTargets={metadataViewBindings.Environment}
                      options={(options || []).filter((o:any) => o.category === "Environment")} 
                   />
                   <ConfigSection 
                      title="Device Roles" 
                      category="DeviceType" 
                      icon={Cpu} 
                      description="Controls asset-type classification in the asset registry."
                      usageTargets={metadataViewBindings.DeviceType}
                      options={(options || []).filter((o:any) => o.category === "DeviceType")} 
                   />
                   <div className="h-px bg-white/5 my-4" />
                   <ConfigSection 
                      title="Logical Systems" 
                      category="LogicalSystem" 
                      icon={Database} 
                      description="Logical system taxonomy used for assets and vendor coverage."
                      usageTargets={metadataViewBindings.LogicalSystem}
                      options={(options || []).filter((o:any) => o.category === "LogicalSystem")} 
                   />
                   <ConfigSection 
                      title="Service Templates" 
                      category="ServiceType" 
                      icon={Layout} 
                      description="Template schema for service records and service-specific metadata keys."
                      usageTargets={metadataViewBindings.ServiceType}
                      options={(options || []).filter((o:any) => o.category === "ServiceType")} 
                   />
                   <ConfigSection 
                      title="External Link Types" 
                      category="ExternalType" 
                      icon={Link} 
                      description="Shared external integration and dependency type taxonomy."
                      usageTargets={metadataViewBindings.ExternalType}
                      options={(options || []).filter((o:any) => o.category === "ExternalType")} 
                   />
                   <ConfigSection 
                      title="Network Link Purposes" 
                      category="LinkPurpose" 
                      icon={Network}
                      description="Connection purpose taxonomy used by the network registry."
                      usageTargets={metadataViewBindings.LinkPurpose}
                      options={(options || []).filter((o:any) => o.category === "LinkPurpose")} 
                   />
                   <ConfigSection 
                      title="Network Farms" 
                      category="NetworkFarm" 
                      icon={Globe}
                      description="Network operating farm taxonomy used by the network registry."
                      usageTargets={metadataViewBindings.NetworkFarm}
                      options={(options || []).filter((o:any) => o.category === "NetworkFarm")} 
                   />
                   <ConfigSection 
                      title="Network Cable Types" 
                      category="NetworkCableType" 
                      icon={Network}
                      description="Cable type taxonomy used by the network registry."
                      usageTargets={metadataViewBindings.NetworkCableType}
                      options={(options || []).filter((o:any) => o.category === "NetworkCableType")} 
                   />
                   <div className="h-px bg-white/5 my-4" />
                   <ConfigSection 
                      title="Vendor Regions" 
                      category="VendorCountry" 
                      icon={Globe} 
                      description="Region and country enumerations used in vendor records."
                      usageTargets={metadataViewBindings.VendorCountry}
                      options={(options || []).filter((o:any) => o.category === "VendorCountry")} 
                   />
                   <ConfigSection 
                      title="Inventory Classes" 
                      category="VendorDeviceType" 
                      icon={Package} 
                      description="Inventory and hardware class labels used in vendor personnel records."
                      usageTargets={metadataViewBindings.VendorDeviceType}
                      options={(options || []).filter((o:any) => o.category === "VendorDeviceType")} 
                   />
                </div>
             </motion.div>
          )}
          {topTab === 'environments' && (
            <motion.div key="environments" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4 pt-2" data-settings-tab-content="environments">
               <div className="rounded-lg border border-white/5 bg-black/20 p-4" data-settings-personal-preferences="true">
                 <div className="flex flex-wrap items-center justify-between gap-3">
                   <div>
                     <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-300">Personal Preferences</p>
                     <p className="mt-1 text-[9px] font-semibold text-slate-500">Choose the visual mode for your operator session.</p>
                   </div>
                   <div className="flex items-center gap-2">
                     {themeOptions.map((theme) => (
                       <button
                         key={theme.id}
                         type="button"
                         aria-pressed={currentTheme === theme.id}
                         onClick={() => changeTheme(theme.id)}
                         className={`rounded-lg border px-3 py-2 text-[9px] font-black uppercase tracking-widest transition-all ${currentTheme === theme.id ? 'border-blue-500/40 bg-blue-500/15 text-blue-300' : 'border-white/10 bg-black/20 text-slate-400 hover:border-white/20 hover:text-white'}`}
                       >
                         {theme.label}
                       </button>
                     ))}
                   </div>
                 </div>
               </div>

               {globalConfigManage ? (<>
               {/* Unified Parameter Toolbar */}
               <PageToolbar wrapOnMobile
                  left={
                   <>
                     <ToolbarSearch
                       value={envSearch}
                       onChange={(e) => setEnvSearch(e.target.value)}
                       placeholder="Search parameter, path, category, or impact..."
                       className="max-w-2xl"
                     />
                     <ToolbarGroup>
                       <div className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3">
                          <Filter size={14} className="text-slate-500" />
                          <select
                            value={envImpactFilter}
                            onChange={(e) => setEnvImpactFilter(e.target.value as any)}
                            className="bg-transparent text-[10px] font-black uppercase tracking-widest text-slate-400 outline-none cursor-pointer focus:text-blue-400"
                          >
                            <option value="ALL">All Impact</option>
                            <option value="CRITICAL">Critical Only</option>
                            <option value="HIGH">High Impact</option>
                            <option value="MEDIUM">Medium Impact</option>
                            <option value="LOW">Low Impact</option>
                          </select>
                       </div>
                     </ToolbarGroup>
                   </>
                 }
                 right={
                   <ToolbarGroup>
                     <ToolbarButton onClick={() => setHistoryField('GLOBAL_CONFIG')}>
                       <span className="flex items-center gap-2">
                         <HistoryIcon size={14} />
                         Global History
                       </span>
                     </ToolbarButton>
                     <ToolbarButton
                        onClick={() => envMutation.mutate(getPersistableEnvSettings())}
                        variant={isDirty() ? "primary" : "secondary"}
                        disabled={!isDirty() && !envMutation.isPending}
                     >
                        <span className="flex items-center gap-2">
                          <Zap size={14} className={envMutation.isPending ? 'animate-pulse' : ''} />
                          {isDirty() ? 'Apply Changes' : 'Force Hot Reload'}
                        </span>
                     </ToolbarButton>
                   </ToolbarGroup>
                 }
               />

               <div className="space-y-8">
                  {visibleCategories.map((cat: any) => (
                      <div key={cat} className="space-y-4">
                          <div className="flex items-center justify-between gap-4 px-1">
                            <h3 className="text-[10px] font-black text-blue-500 uppercase tracking-[0.3em] flex items-center gap-2">
                               {cat === 'Infrastructure' ? <Cpu size={12} /> : cat === 'UI' ? <Layout size={12} /> : <Box size={12} />} 
                               {cat} Domain
                            </h3>
                            <div className="text-[8px] font-black uppercase tracking-widest text-slate-600 bg-white/5 px-2 py-0.5 rounded-lg border border-white/5">
                              {filteredEnvEntries.filter(([key]) => localEnv._metadata?.[key]?.category === cat).length} parameters
                            </div>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                              {filteredEnvEntries.filter(([key]) => localEnv._metadata?.[key]?.category === cat).map(([key, value]: any) => (
                                  <SettingField 
                                      key={key}
                                      icon={envHelp[key]?.details?.includes('URL') ? Link : envHelp[key]?.details?.includes('Path') ? FolderTree : Activity} 
                                      label={key.replace(/_/g, ' ')} 
                                      description={envHelp[key]?.details || "System level variable"} 
                                      onHistory={() => setHistoryField(key)}
                                      onEdit={(a: any) => toggleEdit(key, a)} isEditable={editableFields[key]}
                                      isModified={isDirty(key)} 
                                      absPath={localEnv._metadata?.[key]?.file}
                                      paramName={localEnv._metadata?.[key]?.param}
                                  >
                                      <div className="space-y-3">
                                        <div className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-[7px] font-black uppercase tracking-widest ${getImpactTone(envHelp[key]?.impact)}`}>
                                          {envHelp[key]?.impact || 'LOW'} Impact
                                        </div>
                                        {typeof value === 'boolean' ? (
                                            <div className="flex items-center gap-4 py-1">
                                                <ToggleSwitch 
                                                    checked={!!value} disabled={!editableFields[key]}
                                                    onChange={(e: any) => setLocalEnv({...localEnv, [key]: e.target.checked})}
                                                    activeColor="bg-emerald-600"
                                                />
                                                <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">{value ? 'Enabled' : 'Disabled'}</span>
                                            </div>
                                        ) : (
                                            <input 
                                                disabled={!editableFields[key]} value={value || ''} 
                                                onChange={e => setLocalEnv({...localEnv, [key]: e.target.value})} 
                                                className="w-full bg-black/40 border border-white/5 rounded-lg px-3 py-2 text-[11px] font-bold font-mono text-emerald-400 outline-none focus:border-blue-500/50 transition-all disabled:opacity-50 h-9" 
                                            />
                                        )}
                                      </div>
                                  </SettingField>
                              ))}
                          </div>
                      </div>
                  ))}
                  {visibleCategories.length === 0 && (
                    <div className="py-10">
                      <WorkspaceEmptyState 
                        icon={<Search size={32} />}
                        title="No Parameters Match"
                        description="Adjust the search or impact filter to expose additional configuration fields."
                      />
                    </div>
                  )}
               </div>
               </>) : (
                 <div className="rounded-lg border border-dashed border-white/10 bg-black/10 px-4 py-8 text-center" data-settings-privilege-state="global-config-unavailable">
                   <Lock size={20} className="mx-auto mb-3 text-slate-600" />
                   <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Global configuration unavailable</p>
                   <p className="mt-2 text-[9px] font-semibold text-slate-600">Tenant administrator and Settings management authority are required for environment parameters.</p>
                 </div>
               )}
            </motion.div>
          )}

          {topTab === 'permissions' && settingsManage && (
            <motion.div key="permissions" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4 pt-2" data-settings-tab-content="permissions">
               {/* Identity Sync Pipeline - Collapsed by default */}
               <div className="rounded-lg border border-white/5 bg-black/20 overflow-hidden">
                  <button 
                    onClick={() => setShowPoolLogic(!showPoolLogic)}
                    className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors group"
                  >
                    <div className="flex items-center space-x-3">
                       <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all ${showPoolLogic ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.1)]' : 'bg-slate-800 text-slate-500 border border-white/5'}`}>
                          <SettingsIcon size={18} className={showPoolLogic ? 'animate-pulse' : ''} />
                       </div>
                       <div className="text-left">
                          <h3 className="text-[11px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-2">
                             Identity Sync Pipeline
                             <div className="px-1.5 py-0.5 bg-indigo-500/10 text-indigo-400 rounded-lg border border-indigo-500/20 text-[7px] font-black tracking-normal">PYTHON-DRIVEN</div>
                          </h3>
                          <p className="text-[9px] font-bold text-slate-500 mt-0.5">Automated synchronization of operators, departments, and teams from LDAP/AD providers</p>
                       </div>
                    </div>
                    <div className="flex items-center gap-4">
                       <div className="h-4 w-px bg-white/5" />
                       {showPoolLogic ? <ChevronUp size={16} className="text-slate-600" /> : <ChevronDown size={16} className="text-slate-600" />}
                    </div>
                  </button>

                  <AnimatePresence>
                    {showPoolLogic && (
                       <motion.div 
                         initial={{ height: 0, opacity: 0 }} 
                         animate={{ height: "auto", opacity: 1 }} 
                         exit={{ height: 0, opacity: 0 }}
                         className="overflow-hidden border-t border-white/5"
                       >
                          <div className="p-6 bg-slate-900/40 space-y-6">
                             <div className="flex items-stretch justify-between gap-6">
                                <div className="flex-1 flex flex-col space-y-4">
                                   <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-3">
                                         <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                                            <Terminal size={14} />
                                         </div>
                                         <h4 className="text-[10px] font-black text-white uppercase tracking-widest">Synchronization Logic</h4>
                                      </div>
                                      <div className="flex items-center gap-2">
                                         <ToolbarButton 
                                            onClick={() => setIsSyncEditable(!isSyncEditable)}
                                            variant={isSyncEditable ? "danger" : "secondary"}
                                            className="h-8"
                                         >
                                            <div className="flex items-center gap-2">{isSyncEditable ? <Lock size={12} /> : <EditIcon size={12} />} {isSyncEditable ? "Lock Logic" : "Modify Logic"}</div>
                                         </ToolbarButton>
                                         <ToolbarButton 
                                            onClick={() => poolMutation.mutate({ script: userPoolScript, preview: true })}
                                            variant="primary"
                                            className="h-8"
                                         >
                                            <div className="flex items-center gap-2"><RefreshCcw size={12} className={poolMutation.isPending ? 'animate-spin' : ''} /> Dry Run Preview</div>
                                         </ToolbarButton>
                                      </div>
                                   </div>
                                   <div className="relative group flex-1">
                                      <textarea 
                                        readOnly={!isSyncEditable}
                                        value={userPoolScript} 
                                        onChange={e => setUserPoolScript(e.target.value)}
                                        className={`w-full h-full min-h-[300px] bg-black/60 border ${isSyncEditable ? 'border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.05)]' : 'border-white/5'} rounded-lg p-6 font-mono text-[11px] text-emerald-400 outline-none transition-all custom-scrollbar leading-relaxed`}
                                      />
                                      {!isSyncEditable && (
                                         <div className="absolute inset-0 bg-black/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                            <div className="bg-slate-900/90 border border-white/10 rounded-lg px-4 py-2 flex items-center gap-2 shadow-2xl">
                                               <Lock size={12} className="text-slate-500" />
                                               <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Logic Encrypted/Locked</span>
                                            </div>
                                         </div>
                                      )}
                                   </div>
                                </div>

                                <div className="w-80 flex flex-col space-y-4">
                                   <div className="bg-white/5 border border-white/5 rounded-lg p-4 flex-1">
                                      <div className="flex items-center gap-2 mb-3 border-b border-white/5 pb-2">
                                         <Activity size={12} className="text-blue-400" />
                                         <p className="text-[10px] font-black uppercase text-white tracking-widest">Schema Requirements</p>
                                      </div>
                                      <p className="text-[9px] text-slate-400 font-bold leading-relaxed mb-4">
                                         Pipeline output must be a sequence of dictionaries containing exactly these mapped keys:
                                      </p>
                                      <div className="grid grid-cols-1 gap-2">
                                         {[
                                            { key: 'id', desc: 'Unique LDAP/External Key' },
                                            { key: 'username', desc: 'System Identity ID' },
                                            { key: 'full_name', desc: 'Natural Case Display Name' },
                                            { key: 'email', desc: 'Verified Contact Address' },
                                            { key: 'department', desc: 'LDAP Department Mapping' },
                                            { key: 'team', desc: 'LDAP Team Mapping' }
                                         ].map(f => (
                                            <div key={f.key} className="flex items-center justify-between p-2 bg-black/20 rounded-lg border border-white/5">
                                               <code className="text-[9px] font-black text-blue-400">.{f.key}</code>
                                               <span className="text-[8px] font-bold text-slate-500 uppercase">{f.desc}</span>
                                            </div>
                                         ))}
                                      </div>
                                   </div>
                                </div>
                             </div>
                          </div>
                       </motion.div>
                    )}
                  </AnimatePresence>
               </div>

               {/* Registry Toolbar */}
               <PageToolbar wrapOnMobile
                 left={
                   <>
                     <ToolbarSearch
                       value={operatorFilter}
                       onChange={(e) => setOperatorFilter(e.target.value)}
                       placeholder="Search identity, department, or team..."
                       className="max-w-xl"
                     />
                     <ToolbarGroup>
                       <div className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3">
                         <span className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">Sort</span>
                         <select
                           value={operatorSort}
                           onChange={(e) => setOperatorSort(e.target.value as any)}
                           className="bg-transparent text-[10px] font-black uppercase tracking-widest text-slate-300 outline-none"
                         >
                           <option value="name">Identity</option>
                           <option value="team">Primary Team</option>
                           <option value="admin">Admin First</option>
                         </select>
                       </div>
                     </ToolbarGroup>
                   </>
                 }
                 right={
                   <ToolbarGroup>
                     <ToolbarButton onClick={() => setShowPermissionHistory(true)}>
                       <span className="flex items-center gap-2">
                         <HistoryIcon size={14} />
                         Revision History
                       </span>
                     </ToolbarButton>
                     <ToolbarButton
                       onClick={togglePermissionBulkMenu}
                       disabled={selectedOperatorIds.length === 0}
                       active={showPermissionBulkMenu}
                       ref={permissionBulkTriggerRef as any}
                     >
                       <span className="flex items-center gap-2">
                         <Zap size={14} />
                         Bulk Actions
                       </span>
                     </ToolbarButton>
                   </ToolbarGroup>
                 }
               />

               {typeof document !== 'undefined' && createPortal(
                 <AnimatePresence>
                   {showPermissionBulkMenu && !!permissionBulkPanelStyle.top && (
                     <motion.div
                       initial={{ opacity: 0, y: 10 }}
                       animate={{ opacity: 1, y: 0 }}
                       exit={{ opacity: 0, y: 10 }}
                       style={permissionBulkPanelStyle}
                       data-workspace-panel="true"
                     >
                       <div ref={permissionBulkPanelRef}>
                         <WorkspaceFloatingPanel kind="context" className="max-h-[560px] overflow-y-auto custom-scrollbar p-3">
                           <div className="mb-3 rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
                             <p className="text-[10px] font-semibold text-slate-400">Bulk actions</p>
                             <p className="pt-1 text-[12px] font-semibold text-slate-100">{selectedOperatorIds.length} identities selected</p>
                           </div>

                           <div className="space-y-2">
                             <WorkspaceFlyoutActionCard
                               title="Assign Group"
                               active={expandedPermissionBulkSection === 'assign-group'}
                               onClick={() => setExpandedPermissionBulkSection((current) => current === 'assign-group' ? null : 'assign-group')}
                             />
                             {expandedPermissionBulkSection === 'assign-group' && (
                               <WorkspaceFlyoutDropdownEditor
                                 value={bulkGroupTargetId}
                                 onChange={setBulkGroupTargetId}
                                 options={(teams || []).map((team: any) => ({ value: team.id, label: team.name }))}
                                 placeholder="Choose group"
                                 actionLabel="Apply Group Assignment"
                                 onApply={assignSelectedOperatorsToFocusedGroup}
                                 disabled={!bulkGroupTarget || bulkOperatorPatchMutation.isPending}
                               />
                             )}

                             <WorkspaceFlyoutActionCard
                               title="Remove Group"
                               active={expandedPermissionBulkSection === 'remove-group'}
                               onClick={() => setExpandedPermissionBulkSection((current) => current === 'remove-group' ? null : 'remove-group')}
                             />
                             {expandedPermissionBulkSection === 'remove-group' && (
                               <WorkspaceFlyoutDropdownEditor
                                 value={bulkGroupTargetId}
                                 onChange={setBulkGroupTargetId}
                                 options={(teams || []).map((team: any) => ({ value: team.id, label: team.name }))}
                                 placeholder="Choose group"
                                 actionLabel="Remove Group Membership"
                                 onApply={removeSelectedOperatorsFromFocusedGroup}
                                 disabled={!bulkGroupTarget || bulkOperatorPatchMutation.isPending}
                               />
                             )}
                           </div>

                           <div className="mx-1 my-3 h-px bg-slate-800" />
                           <div className="grid gap-2">
                             <button
                               onClick={() => bulkSetAdminState(true)}
                               disabled={bulkOperatorPatchMutation.isPending}
                               className="w-full rounded-lg border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-left transition-all hover:bg-blue-500/15 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-950 disabled:text-slate-600"
                             >
                               <p className="text-[10px] font-black uppercase tracking-[0.16em] text-blue-300">Set Admin</p>
                             </button>
                             <button
                               onClick={() => bulkSetAdminState(false)}
                               disabled={bulkOperatorPatchMutation.isPending}
                               className="w-full rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-left transition-all hover:bg-white/5 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-950 disabled:text-slate-600"
                             >
                               <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-300">Unset Admin</p>
                             </button>
                             <button
                               onClick={() => setSelectedOperatorIds([])}
                               className="w-full rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-left transition-all hover:bg-white/5"
                             >
                               <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-300">Clear Selection</p>
                             </button>
                           </div>

                           <div className="mx-1 my-3 h-px bg-slate-800" />
                           <button
                             onClick={() => {
                               if (!permissionBulkDeleteConfirm) {
                                 setPermissionBulkDeleteConfirm(true)
                                 return
                               }
                               bulkDeleteSelectedOperators()
                             }}
                             onMouseLeave={() => setPermissionBulkDeleteConfirm(false)}
                             disabled={bulkOperatorDeleteMutation.isPending}
                             className={`w-full rounded-lg border px-4 py-3 text-left transition-all ${
                               permissionBulkDeleteConfirm
                                 ? 'border-rose-500 bg-rose-600 animate-pulse'
                                 : 'border-rose-900/70 bg-rose-950/70 hover:bg-rose-950'
                             }`}
                           >
                             <p className={`text-[10px] font-semibold ${permissionBulkDeleteConfirm ? 'text-white' : 'text-rose-300'}`}>
                               {permissionBulkDeleteConfirm ? 'Confirm Identity Deletion?' : 'Delete Selection'}
                             </p>
                           </button>
                         </WorkspaceFloatingPanel>
                       </div>
                     </motion.div>
                   )}
                 </AnimatePresence>,
                 document.body
               )}

               <AnimatePresence>
                 {isSyncPreviewOpen && syncPreviewData && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mb-6">
                        <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 shadow-2xl overflow-hidden">
                            <div className="p-4 border-b border-indigo-500/20 bg-indigo-500/10 flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="p-2 bg-indigo-600/20 text-indigo-400 rounded-lg"><RefreshCcw size={16} /></div>
                                    <div>
                                        <h3 className="text-[12px] font-black text-white tracking-widest">Sync Preview: {syncPreviewData.version_label}</h3>
                                        <div className="flex items-center gap-3 mt-0.5">
                                            <span className="text-[8px] font-black uppercase text-emerald-500">+{syncPreviewData.summary.added} New</span>
                                            <span className="text-[8px] font-black uppercase text-amber-500">~{syncPreviewData.summary.changed} Changed</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <ToolbarButton 
                                        onClick={() => setIsSyncPreviewOpen(false)}
                                        className="h-8"
                                    >
                                        Abort
                                    </ToolbarButton>
                                    <ToolbarButton 
                                        onClick={() => poolMutation.mutate({ script: userPoolScript, preview: false })}
                                        variant="primary"
                                        className="h-8 shadow-lg shadow-indigo-500/20"
                                    >
                                        Confirm & Execute Sync
                                    </ToolbarButton>
                                </div>
                            </div>
                            <div className="max-h-[400px] overflow-auto custom-scrollbar">
                                <table className="w-full text-left border-collapse text-[10px]">
                                    <thead>
                                        <tr className="bg-black/40">
                                            <th className="p-3 font-bold uppercase text-slate-500 tracking-widest border-b border-white/5">Identity</th>
                                            <th className="p-3 font-bold uppercase text-slate-500 tracking-widest border-b border-white/5">Username</th>
                                            <th className="p-3 font-bold uppercase text-slate-500 tracking-widest border-b border-white/5 text-center">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {syncPreviewData.preview.map((item: any, i: number) => (
                                            <tr key={i} className={`hover:bg-white/5 border-b border-white/5 transition-colors ${item.status === 'new' ? 'bg-emerald-500/5' : item.status === 'changed' ? 'bg-amber-500/5' : ''}`}>
                                                <td className="p-3">
                                                    <div className="flex items-center gap-2">
                                                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-[9px] ${item.status === 'new' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                                                            {item.username?.slice(0,2).toUpperCase()}
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <span className="font-bold text-white">{item.full_name}</span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="p-3 font-mono text-blue-400">{item.username}</td>
                                                <td className="p-3 text-center">
                                                    <span className={`px-2 py-0.5 rounded-lg text-[7px] font-black uppercase tracking-widest ${
                                                        item.status === 'new' ? 'bg-emerald-500 text-white' : 
                                                        item.status === 'changed' ? 'bg-amber-500 text-black' : 
                                                        'bg-slate-700 text-slate-400'
                                                    }`}>
                                                        {item.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </motion.div>
                 )}
               </AnimatePresence>

               <div className="rounded-lg border border-[var(--glass-border)] bg-black/20 shadow-2xl overflow-hidden backdrop-blur-sm">
                  <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-white/5">
                          <th className="p-4 text-[10px] font-bold text-slate-500 border-b border-white/5 sticky left-0 bg-[#0c121e] z-20 min-w-[84px] uppercase tracking-widest">Select</th>
                          <th className="p-4 text-[10px] font-bold text-slate-500 border-b border-white/5 sticky left-[84px] bg-[#0c121e] z-10 min-w-[280px] uppercase tracking-widest">Identity</th>
                          <th className="p-4 text-[10px] font-bold text-slate-500 border-b border-white/5 min-w-[140px] uppercase tracking-widest">Department</th>
                          <th className="p-4 text-[10px] font-bold text-slate-500 border-b border-white/5 min-w-[140px] uppercase tracking-widest">Team</th>
                          <th className="p-4 text-[10px] font-bold text-slate-500 border-b border-white/5 min-w-[200px] uppercase tracking-widest">Group(s)</th>
                          <th className="p-4 text-[10px] font-bold text-slate-500 border-b border-white/5 text-center uppercase tracking-widest">Admin Status</th>
                          {allViews.map(view => (
                            <th key={view} className="p-2 text-[8px] font-bold text-slate-600 border-b border-white/5 text-center min-w-[60px] hover:text-blue-400 transition-colors uppercase tracking-tighter">
                              {view}
                            </th>
                          ))}
                          <th className="p-4 text-[10px] font-bold text-slate-500 border-b border-white/5 text-center uppercase tracking-widest">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOperators?.map((op: any) => {
                          const assignedGroups = teams?.filter((t: any) => (op.teams || []).includes(t.name)) || []
                          const firstName = assignedGroups[0]?.name || 'No Groups'
                          const remainingCount = assignedGroups.length > 1 ? assignedGroups.length - 1 : 0
                          const isSelected = selectedOperatorIds.includes(op.id)

                          return (
                          <tr key={op.id} className={`transition-colors border-b border-white/5 last:border-0 group ${isSelected ? 'bg-blue-500/[0.08]' : op.username === userProfile?.username ? 'bg-blue-600/[0.03]' : 'hover:bg-white/5'}`}>
                            <td className="p-4 sticky left-0 bg-[#0c121e]/95 backdrop-blur-sm z-20 border-r border-white/5 align-middle">
                              <div className="flex items-center justify-center min-h-[40px]">
                                <input
                                  type="checkbox"
                                  readOnly
                                  checked={isSelected}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    handleOperatorSelection(op.id, event)
                                  }}
                                  className="h-4 w-4 rounded border-white/10 bg-black/20 accent-blue-500"
                                />
                              </div>
                            </td>
                            <td className="p-4 sticky left-[84px] bg-[#0c121e]/95 backdrop-blur-sm z-10 border-r border-white/5 align-middle">
                              <button
                                type="button"
                                onClick={(event) => handleOperatorSelection(op.id, event)}
                                className="flex w-full items-center gap-3 text-left"
                              >
                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-[11px] shadow-lg transition-all ${op.is_admin ? 'bg-blue-600 text-white shadow-blue-500/20' : 'bg-slate-800 text-slate-400 border border-white/5'}`}>
                                  {op.username?.slice(0,2).toUpperCase()}
                                </div>
                                <div className="flex flex-col min-w-0">
                                  <p className="text-[11px] font-bold text-white leading-none truncate flex items-center gap-1.5">
                                    {op.full_name}
                                    {op.username === userProfile?.username && <span className="text-[7px] bg-blue-500 text-white px-1.5 py-0.5 rounded-lg font-black uppercase tracking-normal">You</span>}
                                  </p>
                                  <p className="text-[8px] font-bold text-slate-500 mt-1 tracking-tighter truncate opacity-60">{op.username}</p>
                                </div>
                              </button>
                            </td>
                            <td className="p-4 align-middle">
                              <span className="text-[10px] font-bold text-slate-300">{op.department || '—'}</span>
                            </td>
                            <td className="p-4 align-middle">
                              <span className="text-[10px] font-bold text-slate-300">{op.team || '—'}</span>
                            </td>
                            <td className="p-4 align-middle">
                               <div className="group/tooltip relative inline-block">
                                  <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 border border-white/5 rounded-lg hover:border-white/10 transition-colors">
                                    <span className="text-[10px] font-bold text-slate-300">{firstName}</span>
                                    {remainingCount > 0 && (
                                      <div className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded-lg text-[8px] font-black text-blue-400">
                                        <Plus size={8} /> {remainingCount}
                                      </div>
                                    )}
                                  </div>
                                  {assignedGroups.length > 0 && (
                                    <div className="absolute top-full mt-2 left-0 p-3 bg-[#0f172a] border border-slate-700 rounded-lg shadow-2xl opacity-0 group-hover/tooltip:opacity-100 transition-all z-[100] pointer-events-none min-w-[140px] scale-95 group-hover/tooltip:scale-100 origin-top-left backdrop-blur-xl">
                                      <div className="flex items-center gap-2 mb-2 border-b border-white/5 pb-1.5">
                                         <Users size={10} className="text-blue-400" />
                                         <p className="text-[8px] font-black uppercase text-slate-400 tracking-widest">Active Membership</p>
                                      </div>
                                      <div className="space-y-1.5">
                                        {assignedGroups.map((g: any) => (
                                          <div key={g.id} className="flex items-center gap-2">
                                             <div className="w-1 h-1 rounded-full bg-blue-500" />
                                             <p className="text-[9px] font-bold text-slate-300 truncate">{g.name}</p>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                               </div>
                            </td>
                            <td className="p-4 text-center align-middle">
                              <div className="flex items-center justify-center min-h-[40px]" onClick={(e) => e.stopPropagation()}>
                                <ToggleSwitch 
                                  checked={op.is_admin} 
                                  onChange={(e: any) => {
                                    if (op.username === userProfile?.username && !e.target.checked && !confirm("CRITICAL: Disabling your own Admin status will lock you out of this console. Proceed?")) return;
                                    operatorMutation.mutate({ ...op, is_admin: e.target.checked });
                                  }} 
                                  activeColor="bg-emerald-600"
                                />
                              </div>
                            </td>
                            {allViews.map(view => (
                              <td key={view} className="p-1 text-center border-x border-white/[0.02] align-middle">
                                <div className="flex items-center justify-center min-h-[40px]" onClick={(e) => e.stopPropagation()}>
                                  <ViewPermissionIcon 
                                    level={op.is_admin ? 3 : getPermLevel(op, view)}
                                    onClick={() => !op.is_admin && togglePermission(op, view)}
                                    isGlobalAdmin={op.is_admin}
                                  />
                                </div>
                              </td>
                            ))}
                            <td className="p-4 text-center align-middle">
                              {op.username !== userProfile?.username ? (
                                <SameButtonConfirm 
                                  danger
                                  onConfirm={() => {
                                    const { id, ...backup } = op;
                                    deleteOperatorMutation.mutate(op.id);
                                    showWorkspaceToast(`Access revoked for ${op.full_name}`, { 
                                      onRevert: () => operatorMutation.mutate(backup) 
                                    });
                                  }}
                                  icon={Trash2}
                                  label="Revoke Access"
                                />
                              ) : (
                                <div className="p-2 text-slate-700 flex justify-center cursor-not-allowed" title="Protected Identity">
                                  <Lock size={16} />
                                </div>
                              )}
                            </td>
                          </tr>
                        )})}
                        {filteredOperators.length === 0 && (
                          <tr>
                            <td colSpan={allViews.length + 6} className="p-8 text-center text-[10px] font-bold uppercase tracking-widest text-slate-500">
                              No operators match the current filter
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
               </div>
            </motion.div>
          )}

          {topTab === 'tenants' && controlPlaneAdmin && (
             <motion.div key="tenants" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4 pt-2">
               <PageToolbar wrapOnMobile
                  left={
                    <ToolbarGroup>
                      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Tenant Registry</span>
                    </ToolbarGroup>
                  }
                 right={
                   <ToolbarGroup>
                     <ToolbarButton
                       onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-tenants'] })}
                     >
                       <span className="flex items-center gap-2">
                         <RefreshCw size={14} />
                         Refresh Registry
                       </span>
                     </ToolbarButton>
                   </ToolbarGroup>
                 }
               />

               <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="overflow-hidden rounded-lg border border-[var(--glass-border)] bg-[var(--panel-item-bg)] shadow-xl">
                     <div className="flex items-center justify-between border-b border-[var(--glass-border)] bg-white/[0.02] px-4 py-3">
                        <div>
                           <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-300">Infrastructure Registry</h3>
                           <p className="mt-1 text-[10px] font-semibold text-slate-500">
                              Connected tenant databases and recovery checkpoints.
                           </p>
                        </div>
                        <div className="flex items-center gap-2">
                           <span className="rounded-lg border border-white/10 bg-black/20 px-3 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">
                              {allTenants?.length || 0} tenants
                           </span>
                           <ToolbarIconButton
                             onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-tenants'] })}
                             title="Refresh registry"
                           >
                             <RefreshCw size={14} />
                           </ToolbarIconButton>
                        </div>
                     </div>
                     <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-left">
                           <thead>
                              <tr className="bg-black/20 text-[8px] font-black uppercase tracking-[0.16em] text-slate-500">
                                 <th className="border-b border-white/5 p-4">Tenant</th>
                                 <th className="border-b border-white/5 p-4">Database Target</th>
                                 <th className="border-b border-white/5 p-4">Last Backup</th>
                                 <th className="border-b border-white/5 p-4">Status</th>
                                 <th className="border-b border-white/5 p-4 text-right">Actions</th>
                              </tr>
                           </thead>
                           <tbody>
                              {allTenants?.map((tenant: any) => (
                                <tr key={tenant.id} className="border-b border-white/5 transition-colors hover:bg-white/[0.03] last:border-0">
                                  <td className="p-4 align-middle">
                                    <div className="flex items-center gap-3">
                                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                                        <Database size={15} />
                                      </div>
                                      <div className="min-w-0">
                                        <div className="truncate text-[11px] font-bold text-white">{tenant.name}</div>
                                        <div className="mt-1 text-[9px] font-semibold text-slate-500">
                                          {getTenantDbDisplayName(tenant.db_url)}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="p-4 align-middle">
                                    <div className="max-w-[340px] overflow-x-auto custom-scrollbar-mini">
                                      <code className="inline-block whitespace-nowrap rounded-lg border border-white/5 bg-black/30 px-2 py-1 text-[9px] font-mono text-slate-400">
                                        {tenant.db_url}
                                      </code>
                                    </div>
                                  </td>
                                  <td className="p-4 align-middle">
                                    <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-400">
                                      <Clock size={12} className="text-slate-600" />
                                      <span>{tenant.last_backup ? formatAppDate(tenant.last_backup) : 'No backup yet'}</span>
                                    </div>
                                  </td>
                                  <td className="p-4 align-middle">
                                    <span className={`inline-flex items-center rounded-lg border px-2 py-1 text-[8px] font-black uppercase tracking-[0.12em] ${tenant.is_online ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : 'border-rose-500/20 bg-rose-500/10 text-rose-400'}`}>
                                      {tenant.is_online ? 'Online' : 'Offline'}
                                    </span>
                                  </td>
                                  <td className="p-4 text-right align-middle">
                                    <ToolbarButton
                                      onClick={() => backupTenantMutation.mutate(tenant.id)}
                                      disabled={backupTenantMutation.isPending && backupTenantMutation.variables === tenant.id}
                                    >
                                      {backupTenantMutation.isPending && backupTenantMutation.variables === tenant.id ? 'Snapshotting...' : 'Snapshot'}
                                    </ToolbarButton>
                                  </td>
                                </tr>
                              ))}
                              {allTenants?.length === 0 && (
                                <tr>
                                  <td colSpan={5} className="p-8 text-center text-[10px] font-bold text-slate-500">
                                    No tenants are registered yet.
                                  </td>
                                </tr>
                              )}
                           </tbody>
                        </table>
                     </div>
                  </div>

                  <div className="space-y-4">
                     <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-5 shadow-xl">
                        <div className="mb-4 flex items-center gap-3">
                           <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white shadow-lg shadow-blue-500/20">
                             <Plus size={15} />
                           </div>
                           <div>
                              <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-white">Provision Tenant</h3>
                              <p className="mt-1 text-[10px] font-semibold text-slate-500">Create a fresh tenant database and register it immediately.</p>
                           </div>
                        </div>
                        <div className="space-y-3">
                           <input
                             value={newTenantName}
                             onChange={e => {
                               setNewTenantName(e.target.value)
                               setTenantFolderCheck(null)
                             }}
                             placeholder="Tenant name"
                             className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-[11px] font-semibold text-blue-300 outline-none placeholder:text-slate-500 focus:border-blue-500"
                           />
                           <input
                             value={newTenantDbName}
                             onChange={e => {
                               setHasCustomTenantDbName(true)
                               setNewTenantDbName(e.target.value)
                               setTenantFolderCheck(null)
                             }}
                             placeholder="Database file name"
                             className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-[11px] font-mono text-slate-200 outline-none placeholder:text-slate-500 focus:border-blue-500"
                           />
                           <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
                             <div className="flex items-center justify-between gap-3">
                               <div>
                                 <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-300">Parent Folder</p>
                                 <p className="mt-1 text-[10px] font-semibold text-slate-500">
                                   Choose where the tenant database file will be created.
                                 </p>
                               </div>
                               <ToolbarButton
                                 onClick={() => tenantFolderCheckMutation.mutate(newTenantParentFolder)}
                                 disabled={tenantFolderCheckMutation.isPending || !newTenantParentFolder.trim()}
                               >
                                 {tenantFolderCheckMutation.isPending ? "Testing..." : "Test Folder"}
                               </ToolbarButton>
                             </div>
                             <input
                               value={newTenantParentFolder}
                               onChange={e => {
                                 setNewTenantParentFolder(e.target.value)
                                 setTenantFolderCheck(null)
                               }}
                               placeholder="Parent folder path"
                               className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-[10px] font-mono text-slate-200 outline-none placeholder:text-slate-500 focus:border-blue-500"
                             />
                             {tenantFolderCheck && (
                               <div className={`rounded-lg border px-3 py-2 text-[10px] font-semibold ${tenantFolderCheck.ok ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/20 bg-rose-500/10 text-rose-300'}`}>
                                 {tenantFolderCheck.ok ? (
                                   <div className="flex items-center justify-between gap-3">
                                     <span>
                                       Folder ready: {tenantFolderCheck.path}
                                     </span>
                                     <span className="text-[8px] font-black uppercase tracking-[0.14em] text-emerald-400">
                                       Read/Write OK
                                     </span>
                                   </div>
                                 ) : (
                                   <span>{tenantFolderCheck.message || "Folder access failed"}</span>
                                 )}
                               </div>
                             )}
                           </div>
                           <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-[10px] font-semibold text-slate-400">
                             Target file:{" "}
                             <span className="font-mono text-slate-200">
                               {newTenantParentFolder || "…"}
                               {newTenantParentFolder ? "/" : ""}
                               {newTenantDbName || "tenant.db"}
                             </span>
                           </div>
                           <ToolbarButton
                             onClick={() => {
                               if (!newTenantName.trim() || !newTenantDbName.trim()) return
                               createTenantMutation.mutate({
                                 name: newTenantName,
                                 db_name: newTenantDbName,
                                 parent_folder: newTenantParentFolder,
                               })
                             }}
                             disabled={createTenantMutation.isPending || !newTenantName.trim() || !newTenantDbName.trim()}
                             variant="primary"
                             className="w-full"
                           >
                             {createTenantMutation.isPending ? 'Provisioning...' : 'Create Tenant'}
                           </ToolbarButton>
                        </div>
                     </div>

                     <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-5 shadow-xl">
                        <div className="mb-4 flex items-center gap-3">
                           <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-lg shadow-emerald-500/20">
                             <Link size={15} />
                           </div>
                           <div>
                              <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-white">Attach Existing Tenant</h3>
                              <p className="mt-1 text-[10px] font-semibold text-slate-500">Preflight a database path or URI before adding it to the registry.</p>
                           </div>
                        </div>
                        <div className="space-y-3">
                           <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-black/20 p-1">
                              <button onClick={() => { setAttachMode('path'); setAttachPath(""); setPreflightResult(null) }} className={`flex-1 rounded-lg px-3 py-1.5 text-[8px] font-black uppercase tracking-widest transition-all ${attachMode === 'path' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-white'}`}>FS Path</button>
                              <button onClick={() => { setAttachMode('url'); setAttachPath(""); setPreflightResult(null) }} className={`flex-1 rounded-lg px-3 py-1.5 text-[8px] font-black uppercase tracking-widest transition-all ${attachMode === 'url' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-white'}`}>URI</button>
                           </div>
                           <input
                             value={attachName}
                             onChange={e => setAttachName(e.target.value)}
                             placeholder="Tenant label"
                             className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-[11px] font-semibold text-emerald-300 outline-none placeholder:text-slate-500 focus:border-emerald-500"
                           />
                           <div className="relative">
                              <input
                                value={attachPath}
                                onChange={e => { setAttachPath(e.target.value); setPreflightResult(null); }}
                                placeholder={attachMode === 'url' ? 'postgresql+asyncpg://...' : '/registry/db.sqlite'}
                                className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 pr-10 text-[9px] font-mono text-slate-400 outline-none focus:border-emerald-500"
                              />
                              <button onClick={() => preflightMutation.mutate(attachPath)} disabled={preflightMutation.isPending || !attachPath} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-white/5 p-1.5 text-emerald-500 transition-all hover:bg-white/10 disabled:opacity-30"><Microscope size={12} /></button>
                           </div>
                           <AnimatePresence>
                              {preflightResult && (
                                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                                  <div className={`space-y-3 rounded-lg border p-4 ${preflightResult.is_valid ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-rose-500/20 bg-rose-500/10'}`}>
                                    <div className="flex items-center justify-between gap-3">
                                      <span className={`text-[9px] font-black uppercase tracking-[0.14em] ${preflightResult.is_valid ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {preflightResult.status}
                                      </span>
                                      <span className="text-[8px] font-black uppercase tracking-[0.14em] text-slate-500">
                                        {preflightResult.table_count} tables
                                      </span>
                                    </div>
                                    {preflightResult.is_valid && (
                                      <ToolbarButton
                                        onClick={() => attachMutation.mutate(attachMode === 'url' ? { name: attachName, db_url: attachPath } : { name: attachName, db_path: attachPath })}
                                        variant="primary"
                                        className="w-full"
                                      >
                                        Attach Tenant
                                      </ToolbarButton>
                                    )}
                                  </div>
                                </motion.div>
                              )}
                           </AnimatePresence>
                        </div>
                     </div>
                  </div>
               </div>
            </motion.div>
          )}

          {topTab === 'groups' && settingsManage && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 pt-2" data-settings-tab-content="groups">
              <PageToolbar wrapOnMobile
                left={
                  <ToolbarSearch
                    value={teamSearch}
                    onChange={(e) => setTeamSearch(e.target.value)}
                    placeholder="Search group name, description, or source..."
                    className="max-w-xl"
                  />
                }
                right={
                  <div className="flex h-9 items-center overflow-hidden rounded-lg border border-white/10 bg-black/20">
                    <input
                      value={newTeamName}
                      onChange={e => setNewTeamName(e.target.value)}
                      placeholder="New group name..."
                      className="h-full w-56 bg-transparent px-4 text-[11px] font-bold text-white outline-none placeholder:text-slate-600"
                      onKeyDown={e => e.key === 'Enter' && teamMutation.mutate({ name: newTeamName, source: 'manual' })}
                    />
                    <button
                      onClick={() => teamMutation.mutate({ name: newTeamName, source: 'manual' })}
                      className="h-full border-l border-white/10 px-5 text-[10px] font-black uppercase tracking-widest text-blue-400 transition-all hover:bg-blue-600/20"
                    >
                      Initialize
                    </button>
                  </div>
                }
              />

              <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
                 <div className="space-y-4">
                    <div className="flex items-center justify-between px-1">
                       <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Groups</p>
                       <span className="text-[8px] font-bold text-slate-600">{filteredTeams.length} visible</span>
                    </div>
                    <div className="max-h-[720px] space-y-2 overflow-y-auto pr-2 custom-scrollbar">
                       {filteredTeams.map((team: any) => {
                         const memberCount = (operators || []).filter((op: any) => (op.teams || []).includes(team.name)).length
                         return (
                           <button
                             key={team.id}
                             onClick={() => setSelectedTeamId(team.id)}
                             className={`w-full rounded-lg border p-4 text-left transition-all ${
                               selectedTeamId === team.id
                                 ? 'border-blue-500/40 bg-blue-500/10 shadow-[0_0_18px_rgba(59,130,246,0.08)]'
                                 : 'border-white/5 bg-black/20 hover:border-white/10 hover:bg-white/[0.03]'
                             }`}
                           >
                             <div className="flex items-center justify-between gap-3">
                               <div className="min-w-0">
                                 <div className="truncate text-[11px] font-bold text-white">{team.name}</div>
                                 <div className="mt-1 text-[9px] font-semibold text-slate-500">{team.description || team.source || 'Manual group'}</div>
                               </div>
                               <ChevronRight size={14} className={selectedTeamId === team.id ? 'text-blue-400' : 'text-slate-700'} />
                             </div>
                             <div className="mt-3 flex items-center gap-2">
                               <span className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[8px] font-black uppercase tracking-[0.14em] text-slate-400">
                                 {memberCount} members
                               </span>
                               <span className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[8px] font-black uppercase tracking-[0.14em] text-slate-500">
                                 {team.source || 'Manual'}
                               </span>
                             </div>
                           </button>
                         )
                       })}
                       {filteredTeams.length === 0 && (
                         <div className="rounded-lg border border-dashed border-white/10 bg-black/10 px-4 py-6 text-center text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">
                           No groups match the current search
                         </div>
                       )}
                    </div>
                 </div>

                 <div>
                    <AnimatePresence mode="wait">
                       {selectedTeamId && selectedTeam ? (
                         <motion.div key={selectedTeamId} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                           <div className="rounded-lg border border-white/5 bg-black/30 p-5 shadow-2xl">
                             <div className="flex items-start justify-between gap-4">
                               <div className="flex items-center gap-4">
                                 <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-400">
                                   <Users size={20} />
                                 </div>
                                 <div>
                                   <h3 className="text-[18px] font-black tracking-tight text-white">{selectedTeam.name}</h3>
                                   <p className="mt-1 text-[10px] font-semibold text-slate-500">{selectedTeam.description || 'No description added yet.'}</p>
                                 </div>
                               </div>
                               <SameButtonConfirm
                                 danger
                                 onConfirm={() => deleteTeamMutation.mutate(selectedTeamId)}
                                 icon={Trash2}
                                 label="Delete group"
                               />
                             </div>
                             <div className="mt-4 flex flex-wrap gap-2">
                               <span className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-blue-400">
                                 {(operators || []).filter((op: any) => (op.teams || []).includes(selectedTeam.name)).length} members
                               </span>
                               <span className="rounded-lg border border-white/10 bg-black/20 px-3 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">
                                 source: {selectedTeam.source || 'manual'}
                               </span>
                             </div>
                           </div>

                           <div className="grid gap-4 lg:grid-cols-2">
                             <div className="rounded-lg border border-white/5 bg-black/30 p-5 shadow-xl">
                               <div className="mb-4 flex items-center justify-between">
                                 <div>
                                   <h4 className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-300">Membership</h4>
                                   <p className="mt-1 text-[10px] font-semibold text-slate-500">Toggle membership directly from the roster.</p>
                                 </div>
                                 <span className="text-[8px] font-black uppercase tracking-[0.16em] text-slate-500">app native toggle</span>
                               </div>
                               <div className="max-h-[460px] space-y-2 overflow-y-auto pr-2 custom-scrollbar">
                                 {operators?.map((op: any) => {
                                   const isMember = (op.teams || []).includes(selectedTeam.name)
                                   return (
                                     <button
                                       key={op.id}
                                       onClick={() => {
                                         const currentTeams = op.teams || []
                                         const updatedTeams = isMember
                                           ? currentTeams.filter((teamName: string) => teamName !== selectedTeam.name)
                                           : Array.from(new Set([...currentTeams, selectedTeam.name]))
                                         bulkTeamMutation.mutate({
                                           ids: [op.id],
                                           teams: updatedTeams,
                                           teamSource: 'manual_override'
                                         })
                                       }}
                                       className={`flex h-14 w-full items-center justify-between rounded-lg border px-3 transition-all ${
                                         isMember
                                           ? 'border-blue-500/30 bg-blue-500/10'
                                           : 'border-white/5 bg-black/20 hover:border-white/10 hover:bg-white/[0.03]'
                                       }`}
                                     >
                                       <div className="flex min-w-0 items-center gap-3">
                                         <div className={`flex h-9 w-9 items-center justify-center rounded-lg text-[10px] font-black ${isMember ? 'bg-blue-600 text-white' : 'border border-white/5 bg-slate-800 text-slate-500'}`}>
                                           {op.username?.slice(0, 2).toUpperCase()}
                                         </div>
                                         <div className="min-w-0 text-left">
                                           <div className={`truncate text-[10px] font-bold ${isMember ? 'text-white' : 'text-slate-300'}`}>{op.full_name}</div>
                                           <div className="mt-1 truncate text-[8px] font-semibold text-slate-500">{op.username}</div>
                                         </div>
                                       </div>
                                       {isMember ? <ShieldCheck size={14} className="text-emerald-400" /> : <Plus size={14} className="text-slate-600" />}
                                     </button>
                                   )
                                 })}
                               </div>
                             </div>

                             <div className="rounded-lg border border-white/5 bg-black/30 p-5 shadow-xl">
                               <div className="mb-4">
                                 <h4 className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-300">Configuration</h4>
                                 <p className="mt-1 text-[10px] font-semibold text-slate-500">Rename or document the group without leaving the detail view.</p>
                               </div>
                               <div className="space-y-4">
                                 <div className="space-y-2">
                                   <label className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">Display Name</label>
                                   <input
                                     value={teamEditName}
                                     onChange={e => setTeamEditName(e.target.value)}
                                     className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-[11px] font-bold text-white outline-none focus:border-blue-500/40"
                                   />
                                 </div>
                                 <div className="space-y-2">
                                   <label className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">Description</label>
                                   <textarea
                                     value={teamEditDescription}
                                     onChange={e => setTeamEditDescription(e.target.value)}
                                     className="h-32 w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-[11px] font-semibold text-slate-300 outline-none focus:border-blue-500/40 custom-scrollbar"
                                   />
                                 </div>
                                 <ToolbarButton
                                   onClick={() => teamMutation.mutate({ id: selectedTeamId, name: teamEditName, description: teamEditDescription })}
                                   variant="primary"
                                   className="w-full"
                                 >
                                   Save Group
                                 </ToolbarButton>
                               </div>
                             </div>
                           </div>
                         </motion.div>
                       ) : (
                         <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-white/10 bg-black/10">
                           <Users size={40} className="mb-4 text-slate-800" />
                           <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-slate-600">Select a group to manage</p>
                         </div>
                       )}
                    </AnimatePresence>
                 </div>
              </div>
            </motion.div>
          )}

          {topTab === 'system' && globalConfigManage && (
             <motion.div key="system" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4 pt-2" data-settings-tab-content="system">
                <PageToolbar wrapOnMobile
                  left={
                    <ToolbarGroup>
                      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Runtime Analysis</span>
                    </ToolbarGroup>
                  }
                />

                <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                  <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--panel-item-bg)] p-5 shadow-2xl">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="rounded-lg border border-blue-500/20 bg-blue-600/10 p-2 text-blue-400"><Server size={18} /></div>
                      <div>
                        <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--text-primary)]">Deployment Runtime</h3>
                        <p className="mt-1 text-[10px] font-semibold text-[var(--text-muted)]">Resolved backend paths, defaults, and admin bootstrap policy.</p>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {Object.entries(localEnv._deployment || {}).map(([key, value]: any) => (
                        <div key={key} className="rounded-lg border border-white/5 bg-black/20 p-4">
                          <div className="text-[8px] font-black uppercase tracking-[0.18em] text-slate-500">{key.replace(/_/g, ' ')}</div>
                          <div className="mt-2 break-all text-[10px] font-mono text-blue-300">
                            {Array.isArray(value) ? value.join(", ") : String(value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-white/5 bg-black/30 p-5 shadow-2xl">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-300">Runtime Surface</h3>
                        <p className="mt-1 text-[10px] font-semibold text-slate-500">Quick comparison of resolved backend and frontend configuration inventories.</p>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border border-white/5 bg-black/20 p-4">
                        <div className="text-[8px] font-black uppercase tracking-[0.16em] text-amber-400">Backend Variables</div>
                        <div className="mt-2 text-2xl font-black text-white">{Object.keys(localEnv._raw_env?.backend || {}).length}</div>
                      </div>
                      <div className="rounded-lg border border-white/5 bg-black/20 p-4">
                        <div className="text-[8px] font-black uppercase tracking-[0.16em] text-indigo-400">Frontend Variables</div>
                        <div className="mt-2 text-2xl font-black text-white">{Object.keys(localEnv._raw_env?.frontend || {}).length}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="overflow-hidden rounded-lg border border-white/5 bg-black/30 shadow-2xl">
                    <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
                      <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-amber-400"><Server size={12} /> Backend .env Raw</h3>
                      <span className="text-[8px] font-black uppercase tracking-[0.16em] text-slate-500">{Object.keys(localEnv._raw_env?.backend || {}).length} entries</span>
                    </div>
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="bg-white/5">
                          <th className="border-b border-white/5 p-3 text-[8px] font-black uppercase tracking-[0.16em] text-slate-500">Parameter</th>
                          <th className="border-b border-white/5 p-3 text-[8px] font-black uppercase tracking-[0.16em] text-slate-500">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {localEnv._raw_env?.backend && Object.entries(localEnv._raw_env.backend).map(([key, data]: any) => (
                          <tr key={key} className="border-b border-white/5 hover:bg-white/[0.03] last:border-0">
                            <td className="p-3 align-top">
                              <div className="flex flex-col gap-1">
                                <span className="text-[9px] font-mono font-bold text-blue-400">{key}</span>
                                <span className="truncate text-[7px] font-black uppercase tracking-[0.14em] text-slate-600">{data.file}</span>
                              </div>
                            </td>
                            <td className="p-3 align-top">
                              <div className="max-h-20 overflow-y-auto rounded-lg border border-white/5 bg-black/20 p-2 text-[9px] font-mono text-slate-300 custom-scrollbar">
                                {String(data.value)}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-white/5 bg-black/30 shadow-2xl">
                    <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
                      <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-indigo-400"><Layout size={12} /> Frontend .env Raw</h3>
                      <span className="text-[8px] font-black uppercase tracking-[0.16em] text-slate-500">{Object.keys(localEnv._raw_env?.frontend || {}).length} entries</span>
                    </div>
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="bg-white/5">
                          <th className="border-b border-white/5 p-3 text-[8px] font-black uppercase tracking-[0.16em] text-slate-500">Parameter</th>
                          <th className="border-b border-white/5 p-3 text-[8px] font-black uppercase tracking-[0.16em] text-slate-500">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {localEnv._raw_env?.frontend && Object.entries(localEnv._raw_env.frontend).map(([key, data]: any) => (
                          <tr key={key} className="border-b border-white/5 hover:bg-white/[0.03] last:border-0">
                            <td className="p-3 align-top">
                              <div className="flex flex-col gap-1">
                                <span className="text-[9px] font-mono font-bold text-indigo-400">{key}</span>
                                <span className="truncate text-[7px] font-black uppercase tracking-[0.14em] text-slate-600">{data.file}</span>
                              </div>
                            </td>
                            <td className="p-3 align-top">
                              <div className="max-h-20 overflow-y-auto rounded-lg border border-white/5 bg-black/20 p-2 text-[9px] font-mono text-slate-300 custom-scrollbar">
                                {String(data.value)}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
             </motion.div>
          )}

          {topTab === 'diagnostics' && diagnosticsRead && (
            <motion.div key="diagnostics" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <SystemDiagnosticsPanel />
            </motion.div>
          )}

          {topTab === 'standards' && (
            <SettingsStandards />
          )}
        </AnimatePresence>
      </div>

      {/* History Modal for Parameters */}
      {globalConfigManage && historyField && (
        <ConfigHistoryModal 
          field={historyField} 
          versions={envHistory || []} 
          onClose={() => setHistoryField(null)} 
          onRevert={(val: string) => {
            setLocalEnv({...localEnv, [historyField]: val});
            setHistoryField(null);
            showWorkspaceToast("Parameter staged for revert. Apply changes to persist.");
          }}
        />
      )}

      {/* Permission Registry History */}
      {settingsManage && showPermissionHistory && (
         <PermissionHistoryModal versions={poolVersions || []} allViews={allViews} onClose={() => setShowPermissionHistory(false)} />
      )}

      {/* Snapshot Data Modal */}
      <AnimatePresence>
        {settingsManage && viewVersionData && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setViewVersionData(null)} className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200]" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] h-[80vh] bg-[#0c121e] border border-white/10 rounded-lg shadow-2xl z-[201] flex flex-col overflow-hidden">
                <div className="p-6 border-b border-white/5 flex items-center justify-between">
                    <div>
                        <h3 className="text-xl font-black uppercase text-white tracking-widest italic">Snapshot Trace</h3>
                        <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mt-1">Inspection of synchronized identity records</p>
                    </div>
                    <button onClick={() => setViewVersionData(null)} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-all"><X size={20} /></button>
                </div>
                <div className="flex-1 overflow-auto custom-scrollbar p-6 bg-black/20">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-white/5">
                                {viewVersionData[0] && Object.keys(viewVersionData[0]).map(key => (
                                    <th key={key} className="p-4 text-[9px] font-black uppercase text-blue-400 tracking-widest border-b border-white/5">{key}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {viewVersionData.map((row: any, i: number) => (
                                <tr key={i} className="hover:bg-white/5 border-b border-white/5 transition-colors">
                                    {Object.values(row).map((val: any, j: number) => (
                                        <td key={j} className="p-4 text-[10px] font-bold text-slate-300">
                                            {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Script History Modal */}
      <AnimatePresence>
        {settingsManage && viewVersionScript && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setViewVersionScript(null)} className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200]" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] bg-[#0c121e] border border-white/10 rounded-lg shadow-2xl z-[201] flex flex-col overflow-hidden">
                <div className="p-6 border-b border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <FileCode className="text-amber-500" size={24} />
                        <div>
                            <h3 className="text-xl font-black uppercase text-white tracking-widest italic">Historical Logic</h3>
                            <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mt-1">Verification of previous pipeline instructions</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <ToolbarButton 
                            onClick={() => { setUserPoolScript(viewVersionScript); setViewVersionScript(null); setShowPoolLogic(true); showWorkspaceToast("Script restored to editor"); }}
                            variant="primary"
                            className="h-9"
                        >
                            Restore to Editor
                        </ToolbarButton>
                        <button onClick={() => setViewVersionScript(null)} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-all"><X size={20} /></button>
                    </div>
                </div>
                <div className="flex-1 p-6 bg-black/40 font-mono text-[11px] text-emerald-400 overflow-auto custom-scrollbar leading-relaxed">
                    {viewVersionScript}
                </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

    </div>
  )
}

function ConfigHistoryModal({ field, versions, onClose, onRevert }: { field: string, versions: any[], onClose: () => void, onRevert: (val: string) => void }) {
  const [isMaximized, setIsMaximized] = useState(false)
  const [selectedIndices, setSelectedIndices] = useState<number[]>([0])

  const toggleSelection = (idx: number) => {
    if (selectedIndices.includes(idx)) {
       if (selectedIndices.length > 1) {
          setSelectedIndices(selectedIndices.filter(i => i !== idx))
       }
    } else {
       if (selectedIndices.length === 2) {
          setSelectedIndices([selectedIndices[1], idx])
       } else {
          setSelectedIndices([...selectedIndices, idx].sort((a, b) => a - b))
       }
    }
  }

  const indexedVersions = (versions || []).map((v, i) => ({
    ...v,
    v_num: versions.length - i,
    label: v.timestamp
  }))

  const newer = indexedVersions?.[Math.min(...selectedIndices)]
  const older = selectedIndices.length > 1 
    ? indexedVersions?.[Math.max(...selectedIndices)] 
    : (selectedIndices[0] + 1 < indexedVersions.length ? indexedVersions[selectedIndices[0] + 1] : null)

  return (
    <WorkspaceModal
      isOpen={true}
      onClose={onClose}
      size="workspace"
      isMaximized={isMaximized}
      onMaximizeToggle={() => setIsMaximized(!isMaximized)}
      title="Parameter Revision History"
      subtitle={`Auditing state vectors for ${field}`}
      icon={<HistoryIcon size={20} />}
      footerRight={
        <ToolbarButton onClick={onClose}>Dismiss</ToolbarButton>
      }
    >
      <WorkspaceHistoryShell
          header={null}
          sidebar={
           <div className="flex h-full flex-col min-h-0">
              <div className="mb-4 flex items-center justify-between px-1">
                 <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Revision Timeline</h3>
                 <span className="text-[9px] font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/20">{indexedVersions.length} states</span>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                {indexedVersions.map((h: any, idx: number) => {
                  const isSelected = selectedIndices.includes(idx);
                  return (
                    <button 
                      key={idx}
                      onClick={() => toggleSelection(idx)}
                      className={`w-full p-4 rounded-lg border text-left transition-all relative group overflow-hidden ${
                        isSelected 
                          ? 'bg-blue-600/20 border-blue-500/40 shadow-lg shadow-blue-500/5' 
                          : 'bg-white/5 border-white/5 hover:border-white/10'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                         <span className={`text-[11px] font-black tracking-tighter ${isSelected ? 'text-white' : 'text-blue-400'}`}>v{h.v_num}</span>
                         <span className={`text-[8px] font-black uppercase ${isSelected ? 'text-blue-400' : 'text-slate-500'}`}>
                            {h.timestamp?.split(' ')[1]}
                         </span>
                      </div>
                      <p className={`text-[10px] font-bold leading-tight line-clamp-2 ${isSelected ? 'text-white/90' : 'text-slate-300'}`}>
                         By: {h.user || 'System'}
                      </p>
                      <div className="mt-3 flex items-center justify-between">
                         <div className="flex items-center gap-1.5">
                            <Clock size={10} className="text-slate-600" />
                            <span className="text-[8px] font-bold text-slate-600">{h.timestamp?.split(' ')[0]}</span>
                         </div>
                         <button 
                            onClick={(e) => { e.stopPropagation(); onRevert(h.new_value); }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-[8px] font-black uppercase text-amber-500 hover:text-amber-400"
                         >
                            Restore Vector
                         </button>
                      </div>
                    </button>
                  )
                })}
              </div>
           </div>
          }
          content={
           <>
              <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/5 backdrop-blur-md sticky top-0 z-10">
                 <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                       <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 text-[12px] font-black">v{newer?.v_num}</div>
                       <div className="w-4 h-px bg-slate-700" />
                       <div className="w-8 h-8 rounded-lg bg-slate-800 border border-white/10 flex items-center justify-center text-slate-500 text-[12px] font-black">{older ? `v${older.v_num}` : 'Ø'}</div>
                    </div>
                    <div>
                       <h3 className="text-[11px] font-black text-slate-300 uppercase tracking-widest">Semantic Delta</h3>
                       <p className="text-[9px] font-bold text-slate-600">Comparison of property states for {field}</p>
                    </div>
                 </div>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
                <div className="overflow-hidden rounded-lg border border-white/5 bg-black/20">
                  <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-white/5 text-[9px] font-black uppercase text-slate-500 tracking-widest">
                            <th className="p-4 w-1/2 text-rose-500/70">Previous (v{older?.v_num || 'Ø'})</th>
                            <th className="p-4 w-1/2 text-emerald-500/70">Current (v{newer?.v_num})</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        <tr>
                            <td className="p-4 align-top">
                                <div className="bg-rose-500/5 border border-rose-500/10 rounded-lg p-4">
                                  <pre className="text-[11px] text-slate-500 line-through whitespace-pre-wrap font-mono leading-relaxed break-all">
                                      {older ? String(older.new_value || '(empty)') : '(genesis)'}
                                  </pre>
                                </div>
                            </td>
                            <td className="p-4 align-top">
                                <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-4">
                                  <pre className="text-[11px] text-emerald-400 whitespace-pre-wrap font-mono font-bold leading-relaxed break-all">
                                      {newer ? String(newer.new_value || '(empty)') : '(empty)'}
                                  </pre>
                                </div>
                            </td>
                        </tr>
                      </tbody>
                  </table>
                </div>
              </div>
           </>
          }
      />
    </WorkspaceModal>
  )
}
