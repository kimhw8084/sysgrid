import { useSearchParams } from 'react-router-dom'
import { usePageLeaveGuard } from './shared/workspaceDeparture'
import { WorkspaceShareHeader } from './shared/WorkspaceShareHeader'
import { useWorkspaceConfirmation } from './shared/useWorkspaceConfirmation'
import { useWorkspacePrompt } from './shared/useWorkspacePrompt'
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { WorkspaceEmptyState } from "./shared/OperationalWorkspacePrimitives";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Plus, Search, Trash2, Edit2, Info, 
  ListTodo, History, ShieldAlert, Globe, 
  Zap, Save, X, PlusCircle, User, MessageSquare,
  MoreVertical, RefreshCcw, TrendingUp, AlertTriangle,
  Lightbulb, ShieldCheck, Calendar, Activity, Database, Server,
  FileText, Clipboard, Terminal, ArrowRight, Shield, Download, Share2,
  Clock, CheckCircle2, ChevronRight, LayoutGrid, List, Sliders, Eye, Camera, Link as LinkIcon, Link2, Layers, Settings, Check, Target, ChevronDown,
  Workflow, ExternalLink, Briefcase, BarChart3, Users, DollarSign, Image as ImageIcon, HelpCircle, BookOpen, Filter,
  Maximize2, Minimize2, PanelLeft, PanelRight, MousePointer2, GitBranch, Binary, Cpu, Network, Activity as ActivityIcon, ScrollText, GripVertical, Layout,
  Projector, Tag
} from 'lucide-react'
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion'
import { apiFetch } from '../api/apiClient'
import { toast } from 'react-hot-toast'
import { ConfirmationModal } from './shared/ConfirmationModal'
import { StyledSelect } from './shared/StyledSelect'
import { StatusPill } from './shared/StatusPill'
import { ConfigRegistryModal } from './ConfigRegistry'
import { parseAppDate, formatAppDate } from '../utils/dateUtils'
import { format, differenceInDays, addDays, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, eachWeekOfInterval, eachMonthOfInterval } from 'date-fns'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import ReactFlow, { 
  Background, 
  Controls, 
  MiniMap, 
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,

  Connection,
  Edge,
  Node,
  MarkerType,
  Handle,
  Position
} from 'reactflow'
import 'reactflow/dist/style.css'

// --- Types & Constants ---

const PROJECT_TYPES = [
  { value: 'Strategic', label: 'Strategic' },
  { value: 'Tactical', label: 'Tactical' },
  { value: 'Operational', label: 'Operational' },
  { value: 'Research', label: 'Research' }
]

const PROJECT_STATUSES = [
  { value: 'Not Started', label: 'Not Started' },
  { value: 'Planning', label: 'Planning' },
  { value: 'In Progress', label: 'In Progress' },
  { value: 'Paused', label: 'Paused' },
  { value: 'Blocked', label: 'Blocked' },
  { value: 'Cancelled', label: 'Cancelled' },
  { value: 'Completed', label: 'Completed' }
]

const PROJECT_PRIORITIES = [
  { value: 'Low', label: 'Low' },
  { value: 'Medium', label: 'Medium' },
  { value: 'High', label: 'High' },
  { value: 'Highest', label: 'Highest' }
]

const DEFENSE_LINES = [
  { value: '0', label: 'LINE 0: BASE' },
  { value: '1', label: 'LINE 1: FORTIFIED' },
  { value: '2', label: 'LINE 2: RESILIENT' }
]

const ROI_TYPES = [
  { value: 'defense_line', label: 'Defense Line' },
  { value: 'man_hours', label: 'Man-Hours' },
  { value: 'stoploss', label: 'Stoploss' },
  { value: 'wpd', label: 'WPD' }
]

// --- Workspace Components ---

export const ProjectHUD = ({ 
  project, 
  isEditing, 
  isDirty, 
  onEdit, 
  onSave, 
  onCancel,
  onDelete,
  onSettings,
  isSaving
}: { 
  project: any, 
  isEditing: boolean, 
  isDirty: boolean, 
  onEdit: () => void, 
  onSave: () => void, 
  onCancel: () => void,
  onDelete: () => void,
  onSettings: () => void,
  isSaving?: boolean
}) => {
  if (!project) return (
    <div className="h-16 bg-[#0a0c14] border-b border-white/5 flex items-center px-6 gap-6">
       <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600/10 rounded-lg flex items-center justify-center border border-blue-500/20">
             <Briefcase size={20} className="text-blue-400" />
          </div>
          <div>
             <h1 className="text-lg font-bold tracking-tighter text-slate-500">Workshop Baseline</h1>
             <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Select a strategic stream to begin</p>
          </div>
       </div>
    </div>
  )

  return (
    <div className="h-16 bg-[#0a0c14] border-b border-white/10 flex items-center px-6 justify-between shrink-0 z-50 shadow-2xl">
       <div className="flex items-center gap-6 overflow-hidden">
          <div className="flex items-center gap-3 shrink-0">
             <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shadow-[0_0_20px_rgba(37,99,235,0.3)]">
                <Workflow size={20} className="text-white" />
             </div>
             <div>
                <div className="flex items-center gap-2">
                   <h1 className="text-lg font-bold tracking-tighter text-white leading-none truncate max-w-[300px]">{project.name}</h1>
                   <WorkspaceShareHeader id={String(project.id)} title={project.name} />
                </div>
                <div className="flex items-center gap-2 mt-1">
                   <span className="text-[9px] font-bold text-blue-400 uppercase tracking-widest">{project.type}</span>
                   <span className="text-slate-700 font-bold">•</span>
                   <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">{project.status}</span>
                   {isDirty && (
                     <>
                       <span className="text-slate-700 font-bold">•</span>
                       <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest animate-pulse">Unsaved Changes</span>
                     </>
                   )}
                </div>
             </div>
          </div>

          <div className="h-8 w-px bg-white/5 mx-2 shrink-0" />
       </div>

       <div className="flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-2 bg-white/5 p-1 rounded-lg border border-white/5">
             {isEditing ? (
               <>
                 <button 
                   onClick={onCancel}
                   className="px-4 py-2 text-[10px] font-bold text-slate-400 hover:text-white uppercase tracking-widest transition-all"
                 >
                   Discard
                 </button>
                 <button 
                   onClick={onSave}
                   disabled={isSaving || !isDirty}
                   className={`px-5 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 transition-all ${
                     isDirty 
                       ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' 
                       : 'bg-white/5 text-slate-600 cursor-not-allowed'
                   }`}
                 >
                   <Save size={14} /> {isSaving ? 'Syncing...' : 'Commit Changes'}
                 </button>
               </>
             ) : (
               <button 
                 onClick={onEdit}
                 className="px-6 py-2 bg-white/5 hover:bg-white/10 text-blue-400 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all border border-blue-500/20 flex items-center gap-2"
               >
                 <Edit2 size={14} /> Unlock Editor
               </button>
             )}
          </div>
          
          <div className="w-px h-8 bg-white/5 mx-2" />

          <div className="flex items-center gap-2">
             <button 
               onClick={onDelete}
               className="p-2 bg-rose-600/10 hover:bg-rose-600 text-rose-500 hover:text-white rounded-lg transition-all border border-rose-500/20"
               title="Decommission Project"
             >
                <Trash2 size={18} />
             </button>
             <button onClick={onSettings} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-slate-400 transition-all border border-white/5">
                <Settings size={18} />
             </button>
          </div>
       </div>
    </div>
  )
}

const ProjectRail = ({ 
  projects, 
  selectedId, 
  onSelect, 
  onNew, 
  onDelete,
  onReorder,
  width,
  onResize,
  isCollapsed,
  onToggleCollapse
}: any) => {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [priorityFilter, setPriorityFilter] = useState('ALL')
  const canReorder = search.trim() === '' && statusFilter === 'ALL' && priorityFilter === 'ALL'

  const sortedAndFiltered = useMemo(() => {
    const base = [...projects].sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    return base.filter((p:any) => {
      const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase())
      const matchesStatus = statusFilter === 'ALL' || p.status === statusFilter
      const matchesPriority = priorityFilter === 'ALL' || p.priority === priorityFilter
      return matchesSearch && matchesStatus && matchesPriority
    })
  }, [projects, search, statusFilter, priorityFilter])

  if (isCollapsed) {
    return (
      <div className="w-12 border-r border-white/5 flex flex-col items-center py-4 bg-[#0a0c14] shrink-0">
         <button onClick={onToggleCollapse} className="p-2 text-slate-500 hover:text-white transition-all mb-4">
            <PanelLeft size={18} />
         </button>
         <button onClick={onNew} aria-label="New Vector" className="p-2 bg-blue-600 text-white rounded-lg mb-4">
            <Plus size={18} />
         </button>
         <div className="flex-1 flex flex-col gap-2 overflow-y-auto custom-scrollbar no-scrollbar">
            {sortedAndFiltered.map((p:any) => (
               <button 
                 key={p.id} 
                 onClick={() => onSelect(p.id)}
                 className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all ${selectedId === p.id ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-500 hover:bg-white/10'}`}
                 title={p.name}
               >
                  {p.name[0]}
               </button>
            ))}
         </div>
      </div>
    )
  }

  return (
    <div className="relative border-r border-white/5 bg-[#0a0c14] shrink-0 flex flex-col group/rail" style={{ width }}>
       <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
             <button 
               onClick={onNew}
               aria-label="New Vector"
               className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-600/20 active:scale-95"
             >
                <Plus size={14} /> New Vector
             </button>
             <button onClick={onToggleCollapse} className="p-2 ml-2 text-slate-500 hover:text-white transition-all rounded-lg hover:bg-white/5">
                <PanelRight size={18} />
             </button>
          </div>

          <button 
            onClick={() => onSelect('HUDDLE')}
            className={`w-full h-11 rounded-lg flex items-center px-4 gap-3 transition-all border ${
              selectedId === 'HUDDLE' 
                ? 'bg-blue-600 border-blue-500 shadow-[0_0_20px_rgba(37,99,235,0.2)] text-white' 
                : 'bg-white/5 border-white/5 text-slate-500 hover:bg-white/10 hover:text-white'
            }`}
          >
             <Users size={16} />
             <span className="text-[10px] font-black uppercase tracking-widest">Tactical Huddle</span>
          </button>

          <div className="space-y-2 pt-2 border-t border-white/5">
             <div className="relative">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
                <input 
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full bg-white/5 border border-white/5 rounded-lg pl-9 pr-3 py-2 text-[10px] font-bold text-white outline-none focus:border-blue-500/50 uppercase tracking-widest transition-all"
                  placeholder="Filter vectors..."
                />
             </div>
             <div className="grid grid-cols-2 gap-2">
                <select 
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="bg-white/5 border border-white/5 rounded-lg px-2 py-1.5 text-[8px] font-bold text-slate-400 outline-none focus:border-blue-500/50 uppercase tracking-widest"
                >
                   <option value="ALL">ALL STATUS</option>
                   {PROJECT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <select 
                  value={priorityFilter}
                  onChange={e => setPriorityFilter(e.target.value)}
                  className="bg-white/5 border border-white/5 rounded-lg px-2 py-1.5 text-[8px] font-bold text-slate-400 outline-none focus:border-blue-500/50 uppercase tracking-widest"
                >
                   <option value="all">ALL PRIORITY</option>
                   {PROJECT_PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
             </div>
          </div>
       </div>

       <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-10">
          <Reorder.Group axis="y" values={sortedAndFiltered} onReorder={canReorder ? onReorder : undefined} className="space-y-2">
             {sortedAndFiltered.map((p: any) => (
                <Reorder.Item 
                  key={p.id} 
                  value={p}
                  drag={canReorder}
                  className="group"
                >
                   <button
                     onClick={() => onSelect(p.id)}
                     className={`w-full text-left p-4 rounded-lg transition-all border flex flex-col gap-3 ${canReorder ? 'cursor-grab active:cursor-grabbing' : ''} ${
                       selectedId === p.id 
                         ? 'bg-blue-600/10 border-blue-500/40 shadow-lg shadow-blue-500/5' 
                         : 'bg-white/[0.02] border-white/5 hover:bg-white/5 hover:border-white/10'
                     }`}
                   >
                      <div className="flex justify-between items-start gap-2">
                         <h3 className={`text-[13px] font-bold truncate transition-colors flex-1 leading-tight ${selectedId === p.id ? 'text-white' : 'text-slate-300 group-hover:text-blue-400'}`}>{p.name}</h3>
                         <div className="shrink-0">
                            <StatusPill value={p.status} />
                         </div>
                      </div>

                      <div className="flex items-center gap-2">
                         <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{p.type || 'N/A'}</span>
                         <span className="text-slate-800 text-[9px]">•</span>
                         <div className={`px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-tighter ${
                            p.priority === 'High' || p.priority === 'Highest' ? 'bg-rose-600/10 text-rose-500 border border-rose-500/20' :
                            p.priority === 'Medium' ? 'bg-amber-600/10 text-amber-500 border border-amber-500/20' :
                            'bg-slate-800 text-slate-500 border border-white/5'
                         }`}>
                            {p.priority}
                         </div>
                      </div>

                      <div className="mt-1 flex items-center justify-between gap-4">
                         <div className="flex-1 px-2 py-1 bg-white/5 rounded-lg text-[9px] font-bold text-blue-400/80 uppercase truncate border border-white/5">
                            {p.owners?.length > 0 ? p.owners.join(', ') : (p.owner || 'Unassigned')}
                         </div>
                         <div className="flex items-center gap-1.5 shrink-0 opacity-40">
                            <Clock size={10} className="text-slate-500" />
                            <span className="text-[8px] font-bold text-slate-500 uppercase">{p.updated_at ? format(parseAppDate(p.updated_at)!, 'MMM dd') : 'N/A'}</span>
                         </div>
                         <GripVertical size={12} className={`text-slate-800 transition-opacity shrink-0 ${canReorder ? 'opacity-0 group-hover:opacity-100' : 'opacity-20'}`} />
                      </div>
                   </button>
                </Reorder.Item>
             ))}
          </Reorder.Group>
          {!canReorder && (
            <div className="mt-4 px-3 py-2 rounded-lg border border-amber-500/10 bg-amber-500/5 text-[8px] font-bold uppercase tracking-widest text-amber-500/70">
              Clear search and filters to reorder projects safely
            </div>
          )}
       </div>

       {/* Resize Handle */}
       <div 
         className="absolute top-0 right-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-500/30 transition-colors z-50"
         onMouseDown={(e) => {
           const startX = e.clientX
           const startWidth = width
           const onMouseMove = (ev: MouseEvent) => {
             const newWidth = Math.max(160, Math.min(400, startWidth + (ev.clientX - startX)))
             onResize(newWidth)
           }
           const onMouseUp = () => {
             window.removeEventListener('mousemove', onMouseMove)
             window.removeEventListener('mouseup', onMouseUp)
           }
           window.addEventListener('mousemove', onMouseMove)
           window.addEventListener('mouseup', onMouseUp)
         }}
       />
    </div>
  )
}

const ProjectLedger = ({ 
  project, 
  width, 
  onResize, 
  isCollapsed, 
  onToggleCollapse,
  isEditing,
  onUpdate
}: any) => {
  if (!project) return null

  if (isCollapsed) {
    return (
      <div className="w-12 border-l border-white/5 flex flex-col items-center py-4 bg-[#0a0c14] shrink-0">
         <button onClick={onToggleCollapse} className="p-2 text-slate-500 hover:text-white transition-all mb-4">
            <PanelRight size={18} />
         </button>
         <div className="flex-1 flex flex-col gap-6 items-center">
            <BarChart3 size={18} className="text-blue-500 opacity-50" />
         </div>
      </div>
    )
  }

  const handleChange = (field: string, value: any) => {
    onUpdate({ ...project, [field]: value })
  }

  const activeROI = project.roi_types || []

  return (
    <div className="relative border-l border-white/5 bg-[#0a0c14] shrink-0 flex flex-col overflow-hidden" style={{ width }}>
       {/* Resize Handle */}
       <div 
         className="absolute top-0 left-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-500/30 transition-colors z-50"
         onMouseDown={(e) => {
           const startX = e.clientX
           const startWidth = width
           const onMouseMove = (ev: MouseEvent) => {
             const newWidth = Math.max(160, Math.min(500, startWidth - (ev.clientX - startX)))
             onResize(newWidth)
           }
           const onMouseUp = () => {
             window.removeEventListener('mousemove', onMouseMove)
             window.removeEventListener('mouseup', onMouseUp)
           }
           window.addEventListener('mousemove', onMouseMove)
           window.addEventListener('mouseup', onMouseUp)
         }}
       />

       <div className="p-4 border-b border-white/5 flex items-center justify-between bg-[#0d0f17]">
          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
             <BarChart3 size={14} /> ROI Metrics
          </h4>
          <button onClick={onToggleCollapse} className="p-1.5 text-slate-500 hover:text-white transition-all rounded-lg hover:bg-white/5">
             <PanelLeft size={18} />
          </button>
       </div>

       <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
          <section className="space-y-6">
             {isEditing && (
               <div className="space-y-3">
                  <h4 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest px-1">Select ROI Streams</h4>
                  <div className="grid grid-cols-1 gap-1">
                     {ROI_TYPES.map(t => (
                       <label key={t.value} className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all cursor-pointer ${activeROI.includes(t.value) ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-white/5 text-slate-600'}`}>
                          <input 
                            type="checkbox" 
                            checked={activeROI.includes(t.value)}
                            onChange={e => {
                              const updated = e.target.checked ? [...activeROI, t.value] : activeROI.filter((v:any) => v !== t.value)
                              handleChange('roi_types', updated)
                            }}
                            className="rounded-lg border-white/10 bg-black/40 text-blue-600"
                          />
                          <span className="text-[10px] font-bold uppercase tracking-tight">{t.label}</span>
                       </label>
                     ))}
                  </div>
               </div>
             )}

             <div className="space-y-6">
                {activeROI.includes('defense_line') && (
                  <div className={`p-4 bg-white/5 rounded-lg border space-y-3 transition-all ${isEditing ? 'border-blue-500/30' : 'border-white/5'}`}>
                     <div>
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Defense Line</p>
                        {isEditing ? (
                          <select 
                            value={project.roi_defense_line || 'DL0'}
                            onChange={e => handleChange('roi_defense_line', e.target.value)}
                            className="w-full bg-slate-900 text-xl font-bold text-white outline-none border border-white/10 rounded-lg p-1"
                          >
                            <option value="DL0">DL0: BASE</option>
                            <option value="DL1">DL1: FORTIFIED</option>
                            <option value="DL2">DL2: RESILIENT</option>
                          </select>
                        ) : (
                          <p className="text-xl font-bold text-white uppercase tracking-tighter">{project.roi_defense_line || 'DL0'}</p>
                        )}
                     </div>
                     <div className="space-y-1">
                        <p className="text-[8px] font-bold text-slate-600 uppercase tracking-widest px-1">Justification</p>
                        {isEditing ? (
                          <textarea 
                            value={project.roi_defense_line_desc || ''} 
                            onChange={e => handleChange('roi_defense_line_desc', e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-[10px] font-bold text-slate-400 outline-none h-16 resize-none"
                            placeholder="Why this DL level?"
                          />
                        ) : (
                          <p className="text-[10px] font-medium text-slate-500 leading-relaxed px-1">{project.roi_defense_line_desc || 'No justification provided.'}</p>
                        )}
                     </div>
                  </div>
                )}

                {activeROI.includes('man_hours') && (
                  <div className={`p-4 bg-white/5 rounded-lg border space-y-4 transition-all ${isEditing ? 'border-blue-500/30' : 'border-white/5'}`}>
                     <div>
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Man-Hours Optimization</p>
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xl font-bold text-blue-400">+</span>
                            <input 
                              type="number"
                              value={project.man_hours_saved || 0}
                              onChange={e => handleChange('man_hours_saved', parseFloat(e.target.value) || 0)}
                              className="w-full bg-transparent text-xl font-bold text-blue-400 outline-none"
                            />
                            <span className="text-[10px] font-bold text-blue-400 uppercase">hr/yr</span>
                          </div>
                        ) : (
                          <p className="text-xl font-bold text-blue-400 tracking-tighter">+{project.man_hours_saved || 0} <span className="text-xs">hr/yr</span></p>
                        )}
                     </div>
                     <div className="space-y-1 bg-black/40 p-2 rounded-lg border border-white/5">
                        <p className="text-[8px] font-bold text-blue-400/60 uppercase tracking-widest flex items-center gap-1"><Binary size={10} /> Math Builder</p>
                        {isEditing ? (
                          <textarea 
                            value={project.man_hours_saved_math || ''} 
                            onChange={e => handleChange('man_hours_saved_math', e.target.value)}
                            className="w-full bg-transparent border-none p-1 text-[10px] font-mono font-bold text-emerald-400/80 outline-none h-12 resize-none"
                            placeholder="(Tasks/Day * Hours/Task) * 250 Days..."
                          />
                        ) : (
                          <p className="text-[10px] font-mono font-bold text-emerald-500/60 px-1">{project.man_hours_saved_math || 'Calculation not documented.'}</p>
                        )}
                     </div>
                     <div className="space-y-1">
                        <p className="text-[8px] font-bold text-slate-600 uppercase tracking-widest px-1">Description</p>
                        {isEditing ? (
                          <textarea 
                            value={project.man_hours_saved_desc || ''} 
                            onChange={e => handleChange('man_hours_saved_desc', e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-[10px] font-bold text-slate-400 outline-none h-16 resize-none"
                            placeholder="Context for these hours..."
                          />
                        ) : (
                          <p className="text-[10px] font-medium text-slate-500 leading-relaxed px-1">{project.man_hours_saved_desc || 'No context provided.'}</p>
                        )}
                     </div>
                  </div>
                )}

                {activeROI.includes('stoploss') && (
                  <div className={`p-4 bg-white/5 rounded-lg border space-y-4 transition-all ${isEditing ? 'border-blue-500/30' : 'border-white/5'}`}>
                     <div>
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Stoploss Revenue</p>
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xl font-bold text-blue-400">+</span>
                            <input 
                              type="number"
                              value={project.stoploss_minutes_saved || 0}
                              onChange={e => handleChange('stoploss_minutes_saved', parseFloat(e.target.value) || 0)}
                              className="w-full bg-transparent text-xl font-bold text-blue-400 outline-none"
                            />
                            <span className="text-[10px] font-bold text-blue-400 uppercase">min/yr</span>
                          </div>
                        ) : (
                          <p className="text-xl font-bold text-blue-400 tracking-tighter">+{project.stoploss_minutes_saved || 0} <span className="text-xs">min/yr</span></p>
                        )}
                     </div>
                     <div className="space-y-1 bg-black/40 p-2 rounded-lg border border-white/5">
                        <p className="text-[8px] font-bold text-blue-400/60 uppercase tracking-widest flex items-center gap-1"><Binary size={10} /> Math Builder</p>
                        {isEditing ? (
                          <textarea 
                            value={project.stoploss_minutes_saved_math || ''} 
                            onChange={e => handleChange('stoploss_minutes_saved_math', e.target.value)}
                            className="w-full bg-transparent border-none p-1 text-[10px] font-mono font-bold text-emerald-400/80 outline-none h-12 resize-none"
                            placeholder="(Downtime Events/Year * Mean Time To Recover)..."
                          />
                        ) : (
                          <p className="text-[10px] font-mono font-bold text-emerald-500/60 px-1">{project.stoploss_minutes_saved_math || 'Calculation not documented.'}</p>
                        )}
                     </div>
                     <div className="space-y-1">
                        <p className="text-[8px] font-bold text-slate-600 uppercase tracking-widest px-1">Description</p>
                        {isEditing ? (
                          <textarea 
                            value={project.stoploss_minutes_saved_desc || ''} 
                            onChange={e => handleChange('stoploss_minutes_saved_desc', e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-[10px] font-bold text-slate-400 outline-none h-16 resize-none"
                            placeholder="Business impact context..."
                          />
                        ) : (
                          <p className="text-[10px] font-medium text-slate-500 leading-relaxed px-1">{project.stoploss_minutes_saved_desc || 'No context provided.'}</p>
                        )}
                     </div>
                  </div>
                )}

                {activeROI.includes('wpd') && (
                  <div className={`p-4 bg-white/5 rounded-lg border space-y-4 transition-all ${isEditing ? 'border-blue-500/30' : 'border-white/5'}`}>
                     <div>
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Wafer Yield Gained</p>
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xl font-bold text-blue-400">+</span>
                            <input 
                              type="number"
                              value={project.wafers_gained || 0}
                              onChange={e => handleChange('wafers_gained', parseFloat(e.target.value) || 0)}
                              className="w-full bg-transparent text-xl font-bold text-blue-400 outline-none"
                            />
                            <span className="text-[10px] font-bold text-blue-400 uppercase">WPD</span>
                          </div>
                        ) : (
                          <p className="text-xl font-bold text-blue-400 tracking-tighter">+{project.wafers_gained || 0} <span className="text-xs font-bold">WPD</span></p>
                        )}
                     </div>
                     <div className="space-y-1 bg-black/40 p-2 rounded-lg border border-white/5">
                        <p className="text-[8px] font-bold text-blue-400/60 uppercase tracking-widest flex items-center gap-1"><Binary size={10} /> Math Builder</p>
                        {isEditing ? (
                          <textarea 
                            value={project.wafers_gained_math || ''} 
                            onChange={e => handleChange('wafers_gained_math', e.target.value)}
                            className="w-full bg-transparent border-none p-1 text-[10px] font-mono font-bold text-emerald-400/80 outline-none h-12 resize-none"
                            placeholder="Yield % increase * Wafers/Day..."
                          />
                        ) : (
                          <p className="text-[10px] font-mono font-bold text-emerald-500/60 px-1">{project.wafers_gained_math || 'Calculation not documented.'}</p>
                        )}
                     </div>
                     <div className="space-y-1">
                        <p className="text-[8px] font-bold text-slate-600 uppercase tracking-widest px-1">Description</p>
                        {isEditing ? (
                          <textarea 
                            value={project.wafers_gained_desc || ''} 
                            onChange={e => handleChange('wafers_gained_desc', e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-[10px] font-bold text-slate-400 outline-none h-16 resize-none"
                            placeholder="Yield optimization details..."
                          />
                        ) : (
                          <p className="text-[10px] font-medium text-slate-500 leading-relaxed px-1">{project.wafers_gained_desc || 'No context provided.'}</p>
                        )}
                     </div>
                  </div>
                )}

                {activeROI.length === 0 && (
                  <div className="py-20 text-center opacity-20 flex flex-col items-center gap-4">
                     <BarChart3 size={32} />
                     <p className="text-[10px] font-bold uppercase tracking-widest">No ROI streams selected</p>
                  </div>
                )}
             </div>
          </section>
       </div>
    </div>
  )
}

const TaskRow = React.memo(({ 
  task, 
  rowIndex, 
  isPackingMode, 
  startDate, 
  zoomLevel, 
  selectedTaskIds, 
  handleTaskMove, 
  handleTaskResize, 
  setSelectedTaskId, 
  handleSelectTask,
  onDependencyStart,
  isSource,
  isCritical,
  diagram,
  ROW_HEIGHT,
  getDayOffset,
  getDayWidth
  }: any) => {
  const dragControls = useDragControls()
  const [showHologram, setShowHologram] = useState(false)
  const left = Math.floor(getDayOffset(task?.start_date) * zoomLevel)
  const width = Math.max(zoomLevel, Math.floor(getDayWidth(task?.start_date, task?.end_date) * zoomLevel))
  
  // Actual progress visualization
  const actualLeft = task.actual_start_date ? Math.floor(getDayOffset(task.actual_start_date) * zoomLevel) : null
  const actualWidth = (task.actual_start_date && task.actual_end_date) 
    ? Math.max(zoomLevel, Math.floor(getDayWidth(task.actual_start_date, task.actual_end_date) * zoomLevel)) 
    : (task.actual_start_date ? Math.max(zoomLevel, Math.floor(getDayWidth(task.actual_start_date, new Date().toISOString()) * zoomLevel)) : null)

  const taggedNodes = useMemo(() => {
    if (!task.metadata_json?.tagged_nodes?.length || !diagram?.nodes) return []
    return diagram.nodes.filter((n: any) => task.metadata_json.tagged_nodes.includes(n.id))
  }, [task.metadata_json?.tagged_nodes, diagram?.nodes])

  return (
    <div className="absolute w-full group/row" style={{ top: rowIndex * ROW_HEIGHT, height: ROW_HEIGHT, pointerEvents: 'none' }}>
       <div className="absolute inset-0 border-b border-white/5 group-hover/row:bg-white/[0.02] transition-all pointer-events-none" />
       
       {/* Actual Execution Bar (Overlapping) */}
       {actualLeft !== null && (
         <div 
           className="absolute h-1 top-[30px] bg-emerald-500/30 rounded-lg z-10 pointer-events-none border border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.2)]" 
           style={{ left: actualLeft, width: actualWidth || 0 }} 
         />
       )}

       <motion.div
         layout
         drag="x"
         dragControls={dragControls}
         dragListener={false}
         dragMomentum={false}
         dragElastic={0}
         onDrag={(e, info) => handleTaskMove(task.id, info.offset.x)}
         onDragEnd={(e, info) => {
            const daysMoved = Math.round(info.offset.x / zoomLevel)
            handleTaskMove(task.id, daysMoved * zoomLevel, true)
         }}
         onMouseEnter={() => setShowHologram(true)}
         onMouseLeave={() => setShowHologram(false)}
         onDoubleClick={() => setSelectedTaskId(task.id)}
         onClick={(e) => handleSelectTask(task.id, e.shiftKey)}
         className={`absolute h-5 top-2.5 rounded-lg flex items-center gap-2 border shadow-lg z-20 group/bar transition-shadow pointer-events-auto
           ${selectedTaskIds.has(task.id) ? 'shadow-[0_0_0_2px_rgba(59,130,246,0.5)] z-40 border-blue-400' : 'border-white/10'} 
           ${isCritical ? 'shadow-[0_0_15px_rgba(244,63,94,0.3)] border-rose-500/60' : ''}
           ${
           task.status === 'Completed' ? 'border-emerald-500/40 bg-emerald-500/10' : 
           task.status === 'Blocked' ? 'border-rose-600 bg-rose-950/40' : 
           task.status === 'In Progress' ? 'border-blue-500/50 bg-[#0d1425]' :
           task.status === 'Review' ? 'border-amber-500/50 bg-amber-950/20' :
           'border-slate-700 bg-slate-900/60'
         }`}
         style={{ left, width }}
       >
          {isCritical && <div className="absolute -inset-[1px] rounded-lg bg-rose-500/20 animate-pulse pointer-events-none" />}

          <div 
            onPointerDown={(e) => dragControls.start(e)}
            className="flex-1 h-full flex items-center px-1.5 gap-1.5 cursor-grab active:cursor-grabbing overflow-hidden"
          >
             <div className={`w-1 h-1 rounded-full shrink-0 ${task.status === 'Completed' ? 'bg-emerald-500' : task.status === 'Blocked' ? 'bg-rose-500 animate-pulse' : isCritical ? 'bg-rose-500' : 'bg-blue-500'}`} />
             {width > 120 && !isPackingMode ? (
               <span className={`text-[9px] font-black italic uppercase tracking-tight flex-1 truncate font-inter ${task.status === 'Completed' ? 'text-emerald-400' : task.status === 'Blocked' ? 'text-rose-400' : isCritical ? 'text-rose-400' : 'text-blue-300'}`}>{task.name}</span>
             ) : null}
          </div>

          {/* Always show label outside in packing mode or if bar is too small */}
          {(isPackingMode || width <= 120 || showHologram) && (
            <div className="absolute left-full ml-6 flex items-center h-full pointer-events-none whitespace-nowrap z-20">
               <div className="w-10 h-px bg-blue-500/30 -ml-6" />
               <span data-testid={`task-name-${task.id}`} className="text-[10px] font-black italic uppercase text-slate-400 tracking-[0.15em] font-inter ml-2 drop-shadow-lg shadow-black">
                  {task.name}
               </span>
            </div>
          )}

          <motion.div 
            drag="x" 
            dragMomentum={false} 
            onDrag={(e, info) => { e.stopPropagation(); handleTaskResize(task.id, info.offset.x, 'start'); }} 
            onDragEnd={(e, info) => { e.stopPropagation(); handleTaskResize(task.id, info.offset.x, 'start', true); }} 
            className="absolute -left-1 top-0 bottom-0 w-2 cursor-ew-resize z-50 rounded-lg hover:bg-white/10" 
          />
          <motion.div 
            drag="x" 
            dragMomentum={false} 
            onDrag={(e, info) => { e.stopPropagation(); handleTaskResize(task.id, info.offset.x, 'end'); }} 
            onDragEnd={(e, info) => { e.stopPropagation(); handleTaskResize(task.id, info.offset.x, 'end', true); }} 
            className="absolute -right-1 top-0 bottom-0 w-2 cursor-ew-resize z-50 rounded-lg hover:bg-white/10" 
          />

          <button 
            onClick={(e) => { e.stopPropagation(); setSelectedTaskId(task.id); }}
            className="opacity-0 group-hover:opacity-100 absolute -right-8 p-1 text-slate-600 hover:text-white transition-opacity"
          >
             <Info size={14} />
          </button>
          
          <button 
            onClick={(e) => { e.stopPropagation(); onDependencyStart(task.id); }}
            className={`opacity-0 group-hover:opacity-100 absolute -right-16 p-1 transition-all ${isSource ? 'text-blue-400 animate-pulse scale-125' : 'text-slate-600 hover:text-blue-400'}`}
          >
             <LinkIcon size={14} />
          </button>
       </motion.div>
    </div>
  )
})

const PrecisionGantt = ({ project, onUpdate }: any) => {
  const { confirm: confirmWorkspace, confirmation } = useWorkspaceConfirmation()
  const { ask, promptDialog } = useWorkspacePrompt()
  const [tasks, setTasks] = useState<any[]>(project?.tasks || [])
  const [taskComment, setTaskComment] = useState('')
  const [dragStartTasks, setDragStartTasks] = useState<any[] | null>(null)
  const [zoomLevel, setZoomLevel] = useState(30)
  const timelineRef = useRef<HTMLDivElement>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set())
  const [dependencySourceId, setDependencySourceId] = useState<number | null>(null)
  const [showExecutiveChart, setShowExecutiveChart] = useState(false)
  const [isPackingMode, setIsPackingMode] = useState(false)
  const [dayTasksPopup, setDayTasksPopup] = useState<{ date: Date, tasks: any[] } | null>(null)
  const [cursorDate, setCursorDate] = useState<{ date: string, x: number, y: number } | null>(null)
  const [dragStatus, setDragStatus] = useState<{ type: 'move' | 'resize-start' | 'resize-end', taskId: number, date: string } | null>(null)

  const ROW_HEIGHT = 44 // Increased from 32
  const HEADER_HEIGHT = 44

  const listRef = useRef<HTMLDivElement>(null)

  const handleScroll = (e: any) => {
    if (e.target === listRef.current && timelineRef.current) {
      timelineRef.current.scrollTop = e.target.scrollTop
    } else if (e.target === timelineRef.current && listRef.current) {
      listRef.current.scrollTop = e.target.scrollTop
    }
  }

  const handleTimelineMouseMove = (e: React.MouseEvent) => {
    if (!timelineRef.current) return
    const rect = timelineRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left + timelineRef.current.scrollLeft
    const y = e.clientY - rect.top
    const daysOffset = x / zoomLevel
    const date = addDays(startDate, daysOffset)
    setCursorDate({ date: format(date, 'MMM dd, yyyy'), x: e.clientX, y: e.clientY })
  }

  const scrollToTask = (taskId: number) => {
    const task = tasks.find(t => t.id === taskId)
    if (task && timelineRef.current) {
      const offset = getDayOffset(task.start_date) * zoomLevel
      timelineRef.current.scrollTo({ left: offset - 100, behavior: 'smooth' })
    }
  }

  // Kinetic Propagation Engine
  const isCircular = (taskId: number, depId: number, currentTasks: any[]): boolean => {
    const dep = currentTasks.find(t => t.id === depId)
    if (!dep) return false
    if (dep.dependencies_json?.includes(taskId)) return true
    return (dep.dependencies_json || []).some((d: number) => isCircular(taskId, d, currentTasks))
  }

  const propagateChanges = useCallback((taskId: number, newEnd: string, currentTasks: any[]): any[] => {
    let updated = [...currentTasks]
    const successors = updated.filter(t => t.dependencies_json?.includes(taskId))
    
    successors.forEach(succ => {
      const succStart = parseAppDate(succ.start_date)!
      const predEnd = parseAppDate(newEnd)!
      
      if (succStart < predEnd) {
        const duration = differenceInDays(parseAppDate(succ.end_date)!, succStart)
        const updatedSuccStart = predEnd.toISOString()
        const updatedSuccEnd = addDays(predEnd, duration).toISOString()
        
        updated = updated.map(t => t.id === succ.id ? { ...t, start_date: updatedSuccStart, end_date: updatedSuccEnd } : t)
        updated = propagateChanges(succ.id, updatedSuccEnd, updated)
      }
    })
    return updated
  }, [])

  // Predictive Analytics
  const criticalPath = useMemo(() => {
    if (!tasks.length) return new Set<number>()
    const sorted = [...tasks].filter(t => t.end_date).sort((a, b) => parseAppDate(a.end_date)!.getTime() - parseAppDate(b.end_date)!.getTime())
    if (!sorted.length) return new Set<number>()

    const lastTask = sorted[sorted.length - 1]
    const path = new Set<number>([lastTask.id])

    const findCritical = (taskId: number) => {
      const task = tasks.find(t => t.id === taskId)
      if (!task || !task.dependencies_json?.length) return

      const deps = task.dependencies_json.map((id: number) => tasks.find(t => t.id === id)).filter((d: any) => d && d.end_date)
      if (deps.length === 0) return
      const maxEnd = Math.max(...deps.map((d: any) => parseAppDate(d.end_date)!.getTime()))
      const critDeps = deps.filter((d: any) => parseAppDate(d.end_date)!.getTime() === maxEnd)

      critDeps.forEach((d: any) => {
        if (!path.has(d.id)) {
          path.add(d.id)
          findCritical(d.id)
        }
      })
    }

    findCritical(lastTask.id)
    return path
  }, [tasks])

  // Sync tasks from project when it updates, but not while editing
  useEffect(() => {
    if (!selectedTaskId && !dragStartTasks) {
      setTasks(project?.tasks || [])
    }
  }, [project?.tasks, selectedTaskId, dragStartTasks])

  useEffect(() => {
    setTaskComment('')
  }, [selectedTaskId])

  const handleSelectTask = useCallback((id: number, shift: boolean) => {
    if (dependencySourceId) {
      if (dependencySourceId === id) {
        setDependencySourceId(null)
        return
      }
      
      if (isCircular(dependencySourceId, id, tasks)) {
        toast.error('Circular Dependency Blocked')
        setDependencySourceId(null)
        return
      }

      const targetTask = tasks.find(t => t.id === id)
      if (targetTask) {
        const currentDeps = targetTask.dependencies_json || []
        if (!currentDeps.includes(dependencySourceId)) {
          handleTaskUpdate(id, { dependencies_json: [...currentDeps, dependencySourceId] })
          toast.success('Strategic Dependency Linked')
        }
      }
      setDependencySourceId(null)
      return
    }

    if (shift) {
      const newIds = new Set(selectedTaskIds)
      if (newIds.has(id)) newIds.delete(id)
      else newIds.add(id)
      setSelectedTaskIds(newIds)
    } else {
      setSelectedTaskIds(new Set([id]))
    }
  }, [dependencySourceId, tasks, selectedTaskIds])

  const handleTaskMove = useCallback((id: number, offset: number, isFinal = false) => {
    if (!isFinal) {
      const baseTasks = dragStartTasks || tasks
      if (!dragStartTasks) setDragStartTasks([...tasks])

      const daysMoved = Math.round(offset / zoomLevel)
      const idsToMove = selectedTaskIds.has(id) ? Array.from(selectedTaskIds) : [id]
      
      let updatedTasks = [...tasks]
      let newStartDateStr = ''
      updatedTasks = updatedTasks.map(t => {
        const startTask = baseTasks.find(bt => bt.id === t.id)
        if (startTask && idsToMove.includes(t.id)) {
          const newStart = addDays(parseAppDate(startTask.start_date)!, daysMoved).toISOString()
          const duration = differenceInDays(parseAppDate(startTask.end_date)!, parseAppDate(startTask.start_date)!)
          const newEnd = addDays(parseAppDate(newStart)!, duration).toISOString()
          if (t.id === id) newStartDateStr = format(parseAppDate(newStart)!, 'MMM dd, yyyy')
          return { ...t, start_date: newStart, end_date: newEnd }
        }
        return t
      })
      
      // Kinetic Propagation
      idsToMove.forEach(mid => {
        const moved = updatedTasks.find(t => t.id === mid)
        if (moved) updatedTasks = propagateChanges(mid, moved.end_date, updatedTasks)
      })
      
      setTasks(updatedTasks)
      setDragStatus({ type: 'move', taskId: id, date: newStartDateStr })
    } else {
      setDragStartTasks(null)
      setDragStatus(null)
      onUpdate({ ...project, tasks: tasks })
    }
  }, [tasks, dragStartTasks, zoomLevel, selectedTaskIds, project, onUpdate])

  const handleTaskResize = useCallback((id: number, offset: number, type: 'start' | 'end', isFinal = false) => {
    if (!isFinal) {
      const baseTasks = dragStartTasks || tasks
      if (!dragStartTasks) setDragStartTasks([...tasks])

      const daysMoved = Math.round(offset / zoomLevel)
      let updatedTasks = [...tasks]
      let newDateStr = ''
      
      updatedTasks = updatedTasks.map(t => {
        const startTask = baseTasks.find(bt => bt.id === t.id)
        if (startTask && t.id === id) {
          let updatedTask = { ...t }
          if (type === 'start') {
            const newStart = addDays(parseAppDate(startTask.start_date)!, daysMoved)
            if (newStart < parseAppDate(startTask.end_date)!) {
              updatedTask.start_date = newStart.toISOString()
              newDateStr = format(newStart, 'MMM dd, yyyy')
            }
          } else {
            const newEnd = addDays(parseAppDate(startTask.end_date)!, daysMoved)
            if (newEnd > parseAppDate(startTask.start_date)!) {
              updatedTask.end_date = newEnd.toISOString()
              newDateStr = format(newEnd, 'MMM dd, yyyy')
            }
          }
          return updatedTask
        }
        return t
      })

      // Kinetic Propagation
      if (type === 'end') {
        const resized = updatedTasks.find(t => t.id === id)
        if (resized) updatedTasks = propagateChanges(id, resized.end_date, updatedTasks)
      }

      setTasks(updatedTasks)
      setDragStatus({ type: type === 'start' ? 'resize-start' : 'resize-end', taskId: id, date: newDateStr })
    } else {
      setDragStartTasks(null)
      setDragStatus(null)
      onUpdate({ ...project, tasks: tasks })
    }
  }, [tasks, dragStartTasks, zoomLevel, project, onUpdate])

  const startDate = useMemo(() => {
    if (!tasks || tasks.length === 0) return startOfMonth(new Date())
    const times = tasks.map(t => parseAppDate(t.start_date)?.getTime() || NaN).filter(t => !isNaN(t))
    const min = times.length > 0 ? Math.min(...times) : new Date().getTime()
    return addDays(new Date(min), -14)
  }, [tasks])

  const endDate = useMemo(() => {
    if (!tasks || tasks.length === 0) return endOfMonth(addDays(new Date(), 90))
    const times = tasks.map(t => parseAppDate(t.end_date)?.getTime() || NaN).filter(t => !isNaN(t))
    const max = times.length > 0 ? Math.max(...times) : addDays(new Date(), 90).getTime()
    return endOfMonth(addDays(new Date(max), 60))
  }, [tasks])

  const [granularity, setGranularity] = useState<'D' | 'W' | 'M'>('D')

  const zoomLevels = {
    'D': 20,
    'W': 20,
    'M': 50
  }

  useEffect(() => {
    setZoomLevel(zoomLevels[granularity])
  }, [granularity])

  const days = useMemo(() => {
    try {
      let interval: Date[] = []
      if (granularity === 'D') {
        interval = eachDayOfInterval({ start: startDate, end: endDate })
      } else if (granularity === 'W') {
        interval = eachWeekOfInterval({ start: startDate, end: endDate })
      } else {
        interval = eachMonthOfInterval({ start: startDate, end: endDate })
      }
      return interval.length > 2000 ? interval.slice(0, 2000) : interval
    }
    catch (e) { return [new Date()] }
  }, [startDate, endDate, granularity])

  const getDayOffset = useCallback((date: string) => {
    const d = parseAppDate(date) || new Date()
    if (granularity === 'D') return differenceInDays(d, startDate)
    if (granularity === 'W') return differenceInDays(d, startDate) / 7
    return differenceInDays(d, startDate) / 30.44 // Average month length
  }, [startDate, granularity])

  const getDayWidth = useCallback((start: string, end: string) => {
    const s = parseAppDate(start) || new Date()
    const e = parseAppDate(end) || new Date()
    const diff = Math.max(1, differenceInDays(e, s))
    if (granularity === 'D') return diff
    if (granularity === 'W') return diff / 7
    return diff / 30.44
  }, [granularity])

  const packedTasks = useMemo(() => {
    if (!tasks || tasks.length === 0) return []
    if (!isPackingMode) return tasks.map((t, i) => ({ ...t, rowIndex: i }))
    
    const sorted = [...tasks].sort((a, b) => parseAppDate(a.start_date)!.getTime() - parseAppDate(b.start_date)!.getTime())
    const rows: any[][] = []
    
    sorted.forEach(task => {
      let assigned = false
      for (let i = 0; i < rows.length; i++) {
        const lastInRow = rows[i][rows[i].length - 1]
        if (parseAppDate(task.start_date)! >= parseAppDate(lastInRow.end_date)!) {
          rows[i].push(task)
          assigned = true
          break
        }
      }
      if (!assigned) rows.push([task])
    })
    
    return rows.flatMap((row, rowIndex) => row.map(task => ({ ...task, rowIndex })))
  }, [tasks, isPackingMode])

  const handleTaskUpdate = (id: number, updates: any) => {
    const task = tasks.find(t => t.id === id)
    if (!task) return
    
    const updatedTasks = tasks.map(t => t.id === id ? { ...t, ...updates } : t)
    setTasks(updatedTasks)
  }

  useEffect(() => {
    if (project?.tasks) setTasks(project.tasks)
  }, [project?.tasks])

  const maxRow = packedTasks.reduce((max, t) => Math.max(max, t.rowIndex), 0)

  const dependencyLines = useMemo(() => {
    const lines: any[] = []
    packedTasks.forEach((task) => {
      (task.dependencies_json || []).forEach((depId: number) => {
        const fromTask = packedTasks.find(t => t.id === depId)
        if (!fromTask) return
        
        const startX = Math.floor(getDayOffset(fromTask.end_date) * zoomLevel)
        const startY = fromTask.rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2
        const endX = Math.floor(getDayOffset(task.start_date) * zoomLevel)
        const endY = task.rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2
        
        const isCriticalLink = criticalPath.has(task.id) && criticalPath.has(fromTask.id)
        
        lines.push({
          key: `${fromTask.id}-${task.id}`,
          startX, startY, endX, endY,
          isCritical: isCriticalLink
        })
      })
    })
    return lines
  }, [packedTasks, getDayOffset, zoomLevel, criticalPath])

const GanttHeader = React.memo(({ days, zoomLevel, granularity, onDayClick }: any) => {
  const today = useMemo(() => new Date(), [])
  return (
    <div className="sticky top-0 z-30 flex bg-[#0a0c14]/95 backdrop-blur-md border-b border-white/10" style={{ width: days.length * zoomLevel }}>
      {days.map((day: Date, i: number) => {
        const isToday = isSameDay(day, today)
        return (
          <div 
            key={i} 
            onClick={() => onDayClick(day)}
            className={`shrink-0 border-r border-white/5 flex flex-col items-center justify-center h-11 transition-colors cursor-pointer hover:bg-white/5 ${isToday ? 'bg-blue-600/5' : ''}`} 
            style={{ width: zoomLevel }}
          >
             <span className={`text-[8px] font-bold uppercase tracking-tighter ${isToday ? 'text-blue-400' : 'text-slate-600'}`}>
                {granularity === 'D' ? format(day, 'MMM') : granularity === 'W' ? 'WEEK' : format(day, 'yyyy')}
             </span>
             <span className={`text-[11px] font-bold ${isToday ? 'text-blue-400' : 'text-slate-400'}`}>
                {granularity === 'D' ? format(day, 'd') : granularity === 'W' ? format(day, 'w') : format(day, 'MMM')}
             </span>
          </div>
        )
      })}
    </div>
  )
})

const DependencyLines = React.memo(({ lines }: any) => {
  return (
    <svg className="absolute inset-0 pointer-events-none w-full h-full overflow-visible">
      <defs>
        <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
          <polygon points="0 0, 6 3, 0 6" fill="#3b82f6" fillOpacity="0.4" />
        </marker>
        <marker id="arrowhead-crit" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
          <polygon points="0 0, 6 3, 0 6" fill="#f43f5e" fillOpacity="0.8" />
        </marker>
      </defs>
      {lines.map((line: any) => {
        const dx = line.endX - line.startX
        const dy = line.endY - line.startY
        const controlX = line.startX + dx * 0.5
        const d = `M ${line.startX} ${line.startY} C ${controlX} ${line.startY}, ${controlX} ${line.endY}, ${line.endX - 4} ${line.endY}`
        return (
          <path
            key={line.key}
            d={d}
            stroke={line.isCritical ? "#f43f5e" : "#3b82f6"}
            strokeWidth={line.isCritical ? "1.5" : "1"}
            fill="none"
            opacity={line.isCritical ? "0.6" : "0.3"}
            markerEnd={line.isCritical ? "url(#arrowhead-crit)" : "url(#arrowhead)"}
          />
        )
      })}
    </svg>
  )
})

  const todayX = getDayOffset(new Date().toISOString()) * zoomLevel

  return (
    <div className="h-full flex flex-col bg-[#0b0c14] overflow-hidden">
       {confirmation}{promptDialog}
       <div className="h-11 border-b border-white/10 flex items-center px-6 justify-between bg-[#0a0c14] z-40">
          <div className="flex items-center gap-6">
             <button onClick={() => setShowExecutiveChart(!showExecutiveChart)} className={`p-1.5 rounded-lg transition-all border ${showExecutiveChart ? 'bg-blue-600 border-blue-500 text-white' : 'bg-white/5 border-white/5 text-slate-500 hover:text-white'}`} title="Performance Graph"><BarChart3 size={16}/></button>
             
             <div className="flex items-center bg-white/5 p-1 rounded-lg border border-white/5">
                {(['D', 'W', 'M'] as const).map(g => (
                  <button
                    key={g}
                    onClick={() => setGranularity(g)}
                    className={`px-3 py-1 rounded-lg text-[9px] font-bold transition-all ${
                      granularity === g ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {g === 'D' ? 'DAYS' : g === 'W' ? 'WEEKS' : 'MONTHS'}
                  </button>
                ))}
             </div>

             <button onClick={() => setIsPackingMode(!isPackingMode)} className={`px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border transition-all ${isPackingMode ? 'bg-blue-600/10 border-blue-500/30 text-blue-400' : 'bg-white/5 border-white/10 text-slate-500 hover:text-white'}`} title="Optimize Row Packing">{isPackingMode ? 'Compact Mode' : 'Standard Mode'}</button>
             
             <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">
                <button onClick={() => setZoomLevel(Math.max(5, zoomLevel - (granularity === 'D' ? 5 : 1)))} className="text-slate-500 hover:text-white transition-all p-0.5"><Minimize2 size={14}/></button>
                <div className="w-px h-3 bg-white/10 mx-1" />
                <button onClick={() => setZoomLevel(Math.min(500, zoomLevel + (granularity === 'D' ? 10 : 2)))} className="text-slate-500 hover:text-white transition-all p-0.5"><Maximize2 size={14}/></button>
                <span className="text-[9px] font-bold text-blue-400 uppercase tracking-[0.2em] ml-2">{zoomLevel.toFixed(1)}PX</span>
             </div>
          </div>
          <div className="flex items-center gap-4">
             <button 
               onClick={async () => {
                 const name = await ask({ title: 'New task', label: 'Task identifier' })
                 if (!name) return
                 const newTask = { id: Date.now(), name: name, start_date: new Date().toISOString(), end_date: addDays(new Date(), 7).toISOString(), progress: 0, status: 'To Do', dependencies_json: [], metadata_json: {} }
                 const updated = [...tasks, newTask]
                 setTasks(updated)
                 onUpdate({ ...project, tasks: updated })
               }}
               className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2"
             ><Plus size={14}/> New Task</button>
          </div>
       </div>

       {showExecutiveChart && (
         <div className="h-[300px] border-b border-white/10 shrink-0">
            <ExecutiveChart tasks={tasks} />
         </div>
       )}

       <div className="flex-1 flex overflow-hidden relative">
          {!isPackingMode && (
            <div className="w-[240px] flex-none flex flex-col border-r border-white/10 bg-[#0d0f17] z-30 shadow-2xl">
               <div className="h-11 border-b border-white/10 flex items-center px-5 shrink-0 bg-[#0a0c14]/80">
                  <span className="text-[10px] font-bold text-slate-600 uppercase tracking-[0.3em]">Execution Vectors</span>
               </div>
               <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-y-auto no-scrollbar">
                  <Reorder.Group axis="y" values={tasks} onReorder={(newOrder) => { setTasks(newOrder); onUpdate({ ...project, tasks: newOrder }); }} className="w-full">
                     {tasks.map((task) => (
                       <Reorder.Item 
                         key={task.id} 
                         value={task}
                         onClick={() => { scrollToTask(task.id); handleSelectTask(task.id, false); }}
                         onDoubleClick={() => setSelectedTaskId(task.id)}
                         className={`h-[32px] flex items-center px-4 border-b border-white/5 cursor-grab active:cursor-grabbing transition-all group ${selectedTaskIds.has(task.id) ? 'bg-blue-600/10' : 'hover:bg-white/5'}`}
                       >
                          <div className={`w-1 h-1 rounded-full mr-3 shrink-0 ${
                            task.status === 'Completed' ? 'bg-emerald-500' : 
                            task.status === 'Blocked' ? 'bg-rose-500 animate-pulse' : 
                            criticalPath.has(task.id) ? 'bg-rose-500' : 'bg-blue-500'
                          }`} />
                          <p className={`text-[10px] font-bold truncate tracking-tight transition-all flex-1 ${selectedTaskIds.has(task.id) ? 'text-white' : 'text-slate-500 group-hover:text-blue-400'}`}>{task.name}</p>
                          <GripVertical size={12} className="text-slate-800 opacity-0 group-hover:opacity-100" />
                       </Reorder.Item>
                     ))}
                  </Reorder.Group>
               </div>
            </div>
          )}

          <div 
            ref={timelineRef} 
            onScroll={handleScroll} 
            onMouseMove={handleTimelineMouseMove}
            onMouseLeave={() => setCursorDate(null)}
            className="flex-1 overflow-auto custom-scrollbar relative bg-[#0b0c14]"
          >
             <GanttHeader 
               days={days} 
               zoomLevel={zoomLevel} 
               granularity={granularity} 
               onDayClick={(day: Date) => {
                 const tasksEnding = tasks.filter(t => isSameDay(parseAppDate(t.end_date)!, day))
                 setDayTasksPopup({ date: day, tasks: tasksEnding })
               }} 
             />
             <div className="relative pt-0 pb-24" style={{ width: days.length * zoomLevel, height: (maxRow + 1) * ROW_HEIGHT + 100 }}>
                {/* Today Line */}
                <div className="absolute top-0 bottom-0 w-px bg-blue-500/40 z-10 pointer-events-none" style={{ left: todayX }}>
                   <div className="absolute top-[-44px] left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[9px] font-black px-2 py-1 rounded-lg shadow-[0_0_20px_rgba(37,99,235,0.4)] uppercase tracking-widest z-[60] border border-blue-400/30">TODAY</div>
                   <div className="h-full w-full border-l border-dashed border-blue-500/40" />
                </div>

                <div 
                  className="absolute inset-0 pointer-events-none opacity-5" 
                  style={{ 
                    backgroundImage: `repeating-linear-gradient(to right, transparent, transparent ${zoomLevel - 1}px, rgba(255,255,255,0.1) ${zoomLevel - 1}px, rgba(255,255,255,0.1) ${zoomLevel}px)` 
                  }} 
                />
                
                <DependencyLines lines={dependencyLines} />
                
                {packedTasks.map((task) => (
                  <TaskRow 
                    key={task.id} 
                    task={task} 
                    rowIndex={task.rowIndex} 
                    isPackingMode={isPackingMode}
                    startDate={startDate}
                    zoomLevel={zoomLevel}
                    selectedTaskIds={selectedTaskIds}
                    handleTaskMove={handleTaskMove}
                    handleTaskResize={handleTaskResize}
                    setSelectedTaskId={setSelectedTaskId}
                    handleSelectTask={handleSelectTask}
                    onDependencyStart={setDependencySourceId}
                    isSource={dependencySourceId === task.id}
                    isCritical={criticalPath.has(task.id)}
                    diagram={project.metadata_json?.diagram}
                    ROW_HEIGHT={ROW_HEIGHT}
                    getDayOffset={getDayOffset}
                    getDayWidth={getDayWidth}
                  />
                ))}
             </div>
          </div>

          {dragStatus && cursorDate && (
            <div 
              className="fixed pointer-events-none z-[1000] bg-white text-black text-[10px] font-black px-3 py-1.5 rounded-lg shadow-2xl border border-white/20 whitespace-nowrap flex flex-col gap-1"
              style={{ left: cursorDate.x + 15, top: cursorDate.y + 15 }}
            >
              <span className="text-[8px] text-slate-500 uppercase tracking-widest">
                {dragStatus.type === 'move' ? 'Establishing Start' : dragStatus.type === 'resize-start' ? 'Adjusting Start' : 'Adjusting End'}
              </span>
              <span className="text-blue-600">{dragStatus.date}</span>
            </div>
          )}

       <AnimatePresence>
          {selectedTaskId && (
            <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 backdrop-blur-xl p-8">
               <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-[#0d0f17] w-[1000px] h-[85vh] border border-white/10 rounded-lg shadow-2xl flex flex-col overflow-hidden">
                  {(() => {
                    const task = tasks.find(t => t.id === selectedTaskId)
                    if (!task) return null

                    const subtasks = task.metadata_json?.subtasks || []
                    
                    // New Completion Logic
                    const calculateProgress = () => {
                      if (subtasks.length > 0) {
                        const completed = subtasks.filter((s: any) => s.completed).length
                        return Math.round((completed / subtasks.length) * 100)
                      }
                      
                      // Status-based defaults
                      switch(task.status) {
                        case 'Completed': return 100
                        case 'Review': return 90
                        case 'In Progress': return 50
                        case 'Blocked': return task.progress // Maintain existing if blocked
                        default: return 0
                      }
                    }

                    const autoProgress = calculateProgress()
                    const autoStatus = task.status === 'Blocked' ? 'Blocked' : (autoProgress === 100 ? 'Completed' : (autoProgress > 0 ? 'In Progress' : task.status))

                    const updateSubtask = (idx: number, updates: any) => {
                      const newSubtasks = [...subtasks]
                      newSubtasks[idx] = { ...newSubtasks[idx], ...updates }
                      handleTaskUpdate(task.id, { metadata_json: { ...task.metadata_json, subtasks: newSubtasks } })
                    }

                    const addSubtask = async () => {
                      const label = await ask({ title: 'Add subtask', label: 'Subtask description' })
                      if (!label) return
                      const newSubtasks = [...subtasks, { label, completed: false }]
                      handleTaskUpdate(task.id, { metadata_json: { ...task.metadata_json, subtasks: newSubtasks } })
                    }

                    const removeSubtask = (idx: number) => {
                      const newSubtasks = subtasks.filter((_: any, i: number) => i !== idx)
                      handleTaskUpdate(task.id, { metadata_json: { ...task.metadata_json, subtasks: newSubtasks } })
                    }

                    // Dependencies
                    const dependentFrom = tasks.filter(t => task.dependencies_json?.includes(t.id))
                    const dependentTo = tasks.filter(t => t.dependencies_json?.includes(task.id))

                    return (
                      <>
                        <div className="p-8 border-b border-white/10 bg-[#0a0c14]/50 flex items-center justify-between">
                           <div className="flex items-center gap-4">
                              <div className={`w-3 h-3 rounded-full ${task.status === 'Completed' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : task.status === 'Blocked' ? 'bg-rose-500 animate-pulse' : 'bg-blue-500'}`} />
                              <div>
                                 <h2 className="text-xl font-bold text-white tracking-tighter leading-none">{task.name}</h2>
                                 <div className="flex items-center gap-2 mt-1">
                                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Milestone Vector</p>
                                    <span className="text-slate-800">•</span>
                                    <span className="text-[9px] font-bold text-blue-400 uppercase tracking-widest">{autoProgress}% Execution Maturity</span>
                                 </div>
                              </div>
                           </div>
                           <div className="flex items-center gap-3">
                              <button 
                                onClick={async () => { if(await confirmWorkspace({ title: 'Decommission milestone?', message: 'Decommission this strategic milestone?', confirmText: 'Decommission', variant: 'danger' })) { const updated = tasks.filter(t => t.id !== task.id); setTasks(updated); onUpdate({ ...project, tasks: updated }); setSelectedTaskId(null); } }}
                                className="p-2 bg-rose-600/10 text-rose-500 hover:bg-rose-600 hover:text-white rounded-lg transition-all border border-rose-500/20"
                                title="Decommission Task"
                              >
                                 <Trash2 size={16}/>
                              </button>
                              <div className="w-px h-8 bg-white/10 mx-2" />
                              <button 
                                onClick={() => { 
                                  const finalTask = { ...task, progress: autoProgress, status: autoStatus }
                                  const updatedTasks = tasks.map(t => t.id === task.id ? finalTask : t)
                                  onUpdate({ ...project, tasks: updatedTasks })
                                  setSelectedTaskId(null)
                                }} 
                                disabled={project.isUpdating}
                                data-testid="project-commit-btn"
                                className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white shadow-lg shadow-blue-600/20 transition-all flex items-center gap-2 disabled:opacity-50"
                              >
                                 {project.isUpdating ? <Activity size={14} className="animate-spin" /> : <Save size={14}/>}
                                 <span className="text-[10px] font-bold uppercase tracking-widest">Commit Changes</span>
                              </button>
                              <button onClick={() => setSelectedTaskId(null)} className="p-2 text-slate-500 hover:text-white rounded-lg transition-all"><X size={20}/></button>
                           </div>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-10 grid grid-cols-12 gap-10">
                           <div className="col-span-7 space-y-10">
                              <section className="space-y-4">
                                 <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Task Description</h4>
                                 <textarea 
                                   value={task.description || ''} 
                                   onChange={e => handleTaskUpdate(task.id, { description: e.target.value })} 
                                   className="w-full h-32 bg-black/40 border border-white/10 rounded-lg p-5 text-sm font-bold text-slate-300 outline-none focus:border-blue-500/50 resize-none transition-all leading-relaxed" 
                                   placeholder="Define core objectives..." 
                                 />
                              </section>

                              <section className="space-y-6">
                                 <div className="flex items-center justify-between">
                                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Subtasks</h4>
                                    <button onClick={addSubtask} className="flex items-center gap-2 px-3 py-1 bg-white/5 border border-white/10 text-slate-400 hover:text-white rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all"><Plus size={12}/> Add</button>
                                 </div>
                                 <div className="space-y-2">
                                    {subtasks.map((s: any, idx: number) => (
                                      <div key={idx} className="group flex items-center gap-4 p-4 bg-white/[0.02] border border-white/5 rounded-lg hover:border-blue-500/30 transition-all">
                                         <input 
                                           type="checkbox" 
                                           checked={s.completed} 
                                           onChange={e => updateSubtask(idx, { completed: e.target.checked })}
                                           className="w-4 h-4 rounded-lg border-white/10 bg-black/40 text-blue-500 focus:ring-blue-500 cursor-pointer"
                                         />
                                         <input 
                                           value={s.label} 
                                           onChange={e => updateSubtask(idx, { label: e.target.value })}
                                           className={`flex-1 bg-transparent border-none outline-none text-xs font-bold transition-all ${s.completed ? 'text-slate-600 line-through' : 'text-slate-300'}`}
                                         />
                                         <button onClick={() => removeSubtask(idx)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-500 hover:text-rose-400 transition-all"><Trash2 size={14}/></button>
                                      </div>
                                    ))}
                                    {subtasks.length === 0 && (
                                      <div className="py-12 border border-dashed border-white/5 rounded-lg flex flex-col items-center justify-center opacity-20">
                                         <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">No subtasks defined</p>
                                      </div>
                                    )}
                                 </div>
                              </section>

                              {/* Comment Section */}
                              <section className="space-y-6 pt-10 border-t border-white/5">
                                 <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Comments</h4>
                                 <div className="space-y-4">
                                    {(task.metadata_json?.comments || []).map((c: any, i: number) => (
                                      <div key={i} className="p-4 bg-white/5 rounded-lg border border-white/5 space-y-2">
                                         <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-bold text-blue-400">{c.author}</span>
                                            <span className="text-[8px] font-bold text-slate-600 uppercase">{c.timestamp ? format(parseAppDate(c.timestamp)!, 'MMM dd, HH:mm') : 'N/A'}</span>
                                         </div>
                                         <p className="text-xs font-bold text-slate-300 leading-relaxed">{c.content}</p>
                                      </div>
                                    ))}
                                    <div className="flex gap-4">
                                       <textarea 
                                         value={taskComment}
                                         onChange={e => setTaskComment(e.target.value)}
                                         className="flex-1 bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-bold text-slate-300 outline-none focus:border-blue-500/50 resize-none h-20"
                                         placeholder="Add a comment..."
                                       />
                                       <button 
                                         onClick={() => {
                                           if (!taskComment.trim()) return
                                           const newComments = [...(task.metadata_json?.comments || []), { author: 'System', content: taskComment.trim(), timestamp: new Date().toISOString() }]
                                           handleTaskUpdate(task.id, { metadata_json: { ...task.metadata_json, comments: newComments } })
                                           setTaskComment('')
                                         }}
                                         className="px-6 bg-white/5 border border-white/10 text-slate-400 hover:text-white rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all"
                                       >
                                          Post
                                       </button>
                                    </div>
                                 </div>
                              </section>
                           </div>

                           <div className="col-span-5 space-y-10">
                              <section className="space-y-6">
                                 <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-1.5">
                                       <label className="text-[8px] font-bold text-slate-600 uppercase tracking-widest px-1">Current Status</label>
                                       <select 
                                         value={task.status} 
                                         onChange={e => handleTaskUpdate(task.id, { status: e.target.value })} 
                                         className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-bold text-white uppercase outline-none focus:border-blue-500 transition-all"
                                       >
                                          {['To Do', 'In Progress', 'Blocked', 'Review', 'Completed'].map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                                       </select>
                                    </div>
                                    <div className="space-y-1.5">
                                       <label className="text-[8px] font-bold text-slate-600 uppercase tracking-widest px-1">Priority</label>
                                       <select 
                                         value={task.priority || 'Medium'} 
                                         onChange={e => handleTaskUpdate(task.id, { priority: e.target.value })} 
                                         className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-bold text-white uppercase outline-none focus:border-blue-500 transition-all"
                                       >
                                          {['Low', 'Medium', 'High', 'Critical'].map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                                       </select>
                                    </div>
                                 </div>
                              </section>

                              <section className="space-y-6">
                                 <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Planned Timeline</h4>
                                 <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                       <label className="text-[8px] font-bold text-slate-600 uppercase px-1">Planned Start Date</label>
                                       <input type="date" value={format(parseAppDate(task.start_date)!, 'yyyy-MM-dd')} onChange={e => handleTaskUpdate(task.id, { start_date: new Date(e.target.value).toISOString() })} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-bold text-white outline-none focus:border-blue-500" />
                                    </div>
                                    <div className="space-y-1.5">
                                       <label className="text-[8px] font-bold text-slate-600 uppercase px-1">Planned End Date</label>
                                       <input type="date" value={format(parseAppDate(task.end_date)!, 'yyyy-MM-dd')} onChange={e => handleTaskUpdate(task.id, { end_date: new Date(e.target.value).toISOString() })} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-bold text-white outline-none focus:border-blue-500" />
                                    </div>
                                 </div>
                              </section>

                              <section className="space-y-6">
                                 <h4 className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Actual Execution</h4>
                                 <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                       <label className="text-[8px] font-bold text-slate-600 uppercase px-1">Actual Start Date</label>
                                       <input type="date" value={task.actual_start_date ? format(parseAppDate(task.actual_start_date)!, 'yyyy-MM-dd') : ''} onChange={e => handleTaskUpdate(task.id, { actual_start_date: e.target.value ? new Date(e.target.value).toISOString() : null })} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-bold text-white outline-none focus:border-blue-500" />
                                    </div>
                                    <div className="space-y-1.5">
                                       <label className="text-[8px] font-bold text-slate-600 uppercase px-1">Actual End Date</label>
                                       <input type="date" value={task.actual_end_date ? format(parseAppDate(task.actual_end_date)!, 'yyyy-MM-dd') : ''} onChange={e => handleTaskUpdate(task.id, { actual_end_date: e.target.value ? new Date(e.target.value).toISOString() : null })} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-bold text-white outline-none focus:border-blue-500" />
                                    </div>
                                 </div>
                              </section>

                              <section className="space-y-6">
                                 <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Strategic Dependencies</h4>
                                 <div className="space-y-4">
                                    <div className="space-y-2">
                                       <p className="text-[8px] font-bold text-slate-600 uppercase px-1">Dependent From (Blocks these tasks)</p>
                                       <div className="flex flex-wrap gap-2">
                                          {dependentTo.map(t => (
                                            <span key={t.id} className="px-2 py-1 bg-blue-600/10 border border-blue-500/20 rounded-lg text-[9px] font-bold text-blue-400 uppercase tracking-widest">{t.name}</span>
                                          ))}
                                          {dependentTo.length === 0 && <span className="text-[8px] font-bold text-slate-800 uppercase px-1">No downstream blocks</span>}
                                       </div>
                                    </div>
                                    <div className="space-y-2">
                                       <p className="text-[8px] font-bold text-slate-600 uppercase px-1">Dependent To (Blocked by these tasks)</p>
                                       <div className="flex flex-wrap gap-2">
                                          {dependentFrom.map(t => (
                                            <span key={t.id} className="px-2 py-1 bg-amber-600/10 border border-amber-500/20 rounded-lg text-[9px] font-bold text-amber-400 uppercase tracking-widest">{t.name}</span>
                                          ))}
                                          {dependentFrom.length === 0 && <span className="text-[8px] font-bold text-slate-800 uppercase px-1">No upstream blocks</span>}
                                       </div>
                                    </div>
                                 </div>
                              </section>

                              <section className="space-y-4 pt-10 border-t border-white/5">
                                 <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Audit Timestamps</h4>
                                 <div className="space-y-2">
                                    {(task.metadata_json?.history || []).slice(-5).reverse().map((h: any, i: number) => (
                                      <div key={i} className="text-[9px] font-bold text-slate-600 flex items-center justify-between">
                                         <span className="truncate flex-1">"{h.content}"</span>
                                         <span className="text-slate-800 shrink-0 ml-4 uppercase">{h.timestamp ? format(parseAppDate(h.timestamp)!, 'MMM dd, HH:mm') : 'N/A'}</span>
                                      </div>
                                    ))}
                                    {(!task.metadata_json?.history || task.metadata_json.history.length === 0) && <p className="text-[8px] font-bold text-slate-800 uppercase text-center py-4">No audit history</p>}
                                 </div>
                              </section>
                           </div>
                        </div>
                      </>
                    )
                  })()}
               </motion.div>
            </div>
            )}
            </AnimatePresence>
            </div>
            </div>
            )
            }
const ExecutiveChart = ({ tasks }: { tasks: any[] }) => {
  const [selectedPoint, setSelectedPoint] = useState<any>(null)

  const data = useMemo(() => {
    if (!tasks || tasks.length === 0) return []
    
    // Get time range from all tasks (planned and actual)
    const times = tasks.flatMap(t => [
      parseAppDate(t.start_date)?.getTime(), 
      parseAppDate(t.end_date)?.getTime(),
      t.actual_start_date ? parseAppDate(t.actual_start_date)?.getTime() : null,
      t.actual_end_date ? parseAppDate(t.actual_end_date)?.getTime() : null
    ]).filter((t): t is number => t !== null && t !== undefined && !isNaN(t))
    
    if (times.length === 0) return []
    
    const start = startOfMonth(new Date(Math.min(...times)))
    const end = endOfMonth(addDays(new Date(Math.max(...times)), 30))
    const interval = eachDayOfInterval({ start, end })

    const step = interval.length > 60 ? 7 : (interval.length > 30 ? 2 : 1)

    let cumulativeScheduled = 0
    let cumulativeActual = 0
    const totalTasks = tasks.length

    return interval.filter((_, i) => i % step === 0).map(date => {
      const scheduledOnDate = tasks.filter(t => isSameDay(parseAppDate(t.end_date)!, date))
      const actualOnDate = tasks.filter(t => t.actual_end_date && isSameDay(parseAppDate(t.actual_end_date)!, date))
      
      const scheduledCount = tasks.filter(t => parseAppDate(t.end_date)! <= date).length
      const actualCount = tasks.filter(t => t.actual_end_date && parseAppDate(t.actual_end_date)! <= date).length

      return {
        date: format(date, 'MMM d'),
        fullDate: date,
        scheduled: totalTasks > 0 ? Math.round((scheduledCount / totalTasks) * 100) : 0,
        actual: totalTasks > 0 ? Math.round((actualCount / totalTasks) * 100) : 0,
        plannedTasks: scheduledOnDate,
        actualTasks: actualOnDate
      }
    })
  }, [tasks])

  return (
    <div className="h-full w-full bg-[#0a0c14] p-8 flex flex-col gap-6 overflow-hidden">
       <div className="flex items-center justify-between shrink-0">
          <div>
             <h3 className="text-xl font-bold text-white uppercase tracking-tighter flex items-center gap-3">
                <TrendingUp className="text-blue-500" size={24} />
                Strategic Velocity Vector
             </h3>
             <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mt-1">Real-time execution momentum vs theoretical plan</p>
          </div>
          <div className="flex gap-8">
             <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" /><span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Target Velocity</span></div>
             <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" /><span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Actual Momentum</span></div>
          </div>
       </div>
       <div className="flex-1 min-h-0 relative">
          <ResponsiveContainer width="100%" height="100%">
             <AreaChart data={data} onClick={(e: any) => e?.activePayload && setSelectedPoint(e.activePayload[0].payload)}>
                <defs>
                   <linearGradient id="colorSched" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient>
                   <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} opacity={0.3} />
                <XAxis dataKey="date" stroke="#334155" fontSize={9} fontWeight="bold" tickLine={false} axisLine={false} />
                <YAxis stroke="#334155" fontSize={9} fontWeight="bold" tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                <RechartsTooltip 
                   contentStyle={{ background: '#0a0c14', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '9px', fontWeight: 'bold', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.5)' }} 
                   itemStyle={{ color: '#fff' }}
                   cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }}
                />
                <Area type="monotone" dataKey="scheduled" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorSched)" activeDot={{ r: 4, strokeWidth: 0 }} />
                <Area type="monotone" dataKey="actual" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorActual)" activeDot={{ r: 5, strokeWidth: 0 }} />
             </AreaChart>
          </ResponsiveContainer>

          <AnimatePresence>
            {selectedPoint && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="absolute top-0 right-0 w-72 bg-[#0d0f17] border border-white/10 rounded-lg shadow-2xl z-50 overflow-hidden flex flex-col max-h-full">
                <div className="p-4 border-b border-white/10 flex items-center justify-between bg-black/40">
                  <h4 className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">{selectedPoint.date} Report</h4>
                  <button onClick={() => setSelectedPoint(null)} className="text-slate-500 hover:text-white"><X size={14}/></button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
                  <div className="space-y-3">
                     <p className="text-[8px] font-bold text-blue-400/60 uppercase tracking-widest px-1">Planned Completions</p>
                     {selectedPoint.plannedTasks.length > 0 ? selectedPoint.plannedTasks.map((t: any) => (
                       <div key={t.id} className="p-2.5 bg-white/5 rounded-lg border border-white/5">
                         <p className="text-[10px] font-bold text-slate-300 truncate">{t.name}</p>
                         <p className="text-[8px] font-bold text-slate-600 mt-1 uppercase">Target: {format(parseAppDate(t.end_date)!, 'MMM dd')}</p>
                       </div>
                     )) : <p className="text-[9px] text-slate-700 font-bold uppercase py-2 px-1">None</p>}
                  </div>
                  <div className="space-y-3 border-t border-white/5 pt-4">
                     <p className="text-[8px] font-bold text-emerald-400/60 uppercase tracking-widest px-1">Actual Completions</p>
                     {selectedPoint.actualTasks.length > 0 ? selectedPoint.actualTasks.map((t: any) => (
                       <div key={t.id} className="p-2.5 bg-emerald-500/5 rounded-lg border border-emerald-500/20">
                         <p className="text-[10px] font-bold text-emerald-400 truncate">{t.name}</p>
                         <p className="text-[8px] font-bold text-emerald-600 mt-1 uppercase">Finalized: {format(parseAppDate(t.actual_end_date)!, 'MMM dd')}</p>
                       </div>
                     )) : <p className="text-[9px] text-slate-700 font-bold uppercase py-2 px-1">None</p>}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
       </div>
    </div>
  )
}

const ProcessNode = ({ id, data }: any) => {
  const { setNodes } = useReactFlow();
  return (
    <div className="px-6 py-3 shadow-2xl rounded-lg bg-[#0a0c14] border-2 border-blue-500/50 text-white min-w-[140px] flex items-center justify-center relative overflow-hidden group">
       <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
       <span className="text-[10px] font-black uppercase tracking-widest relative z-10">{data.label}</span>
       <button 
         onClick={(e) => { e.stopPropagation(); setNodes((nds) => nds.filter((n) => n.id !== id)); }}
         className="absolute -top-1 -right-1 w-5 h-5 bg-rose-600 text-white rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-[60] shadow-xl hover:bg-rose-500"
       >
         <X size={10} strokeWidth={3} />
       </button>
       <Handle type="target" position={Position.Top} className="w-2 h-2 bg-blue-500 border-none" />
       <Handle type="source" position={Position.Bottom} className="w-2 h-2 bg-blue-500 border-none" />
    </div>
  )
}

const DiamondNode = ({ id, data }: any) => {
  const { setNodes } = useReactFlow();
  return (
    <div className="w-24 h-24 rotate-45 bg-[#0a0c14] border-2 border-amber-500/50 flex items-center justify-center relative group overflow-hidden shadow-2xl">
       <div className="absolute inset-0 bg-amber-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
       <span className="-rotate-45 text-[9px] font-black uppercase tracking-tighter text-amber-400 text-center px-2">{data.label}</span>
       <button 
         onClick={(e) => { e.stopPropagation(); setNodes((nds) => nds.filter((n) => n.id !== id)); }}
         className="absolute top-2 right-2 w-5 h-5 -rotate-45 bg-rose-600 text-white rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-[60] shadow-xl hover:bg-rose-500"
       >
         <X size={10} strokeWidth={3} />
       </button>
       <Handle type="target" position={Position.Top} className="w-2 h-2 bg-amber-500 border-none !top-[-4px] !left-1/2 !-translate-x-1/2" />
       <Handle type="source" position={Position.Bottom} className="w-2 h-2 bg-amber-500 border-none !bottom-[-4px] !left-1/2 !-translate-x-1/2" />
       <Handle type="source" position={Position.Left} className="w-2 h-2 bg-amber-500 border-none !left-[-4px] !top-1/2 !-translate-y-1/2" />
       <Handle type="source" position={Position.Right} className="w-2 h-2 bg-amber-500 border-none !right-[-4px] !top-1/2 !-translate-y-1/2" />
    </div>
  )
}

const InfrastructureNode = ({ id, data, type }: any) => {
  const { setNodes } = useReactFlow();
  const Icon = type === 'db' ? Database : type === 'cloud' ? Globe : type === 'storage' ? Layers : Server
  const color = type === 'db' ? 'emerald' : type === 'cloud' ? 'sky' : type === 'storage' ? 'purple' : 'slate'
  
  return (
    <div className={`px-4 py-3 rounded-lg bg-[#0a0c14] border-2 border-${color}-500/40 text-white min-w-[120px] flex flex-col items-center gap-2 shadow-2xl group transition-all hover:border-${color}-500 relative`}>
       <div className={`w-10 h-10 bg-${color}-600/10 rounded-lg flex items-center justify-center border border-${color}-500/20 group-hover:scale-110 transition-transform`}>
          <Icon size={20} className={`text-${color}-400`} />
       </div>
       <span className="text-[9px] font-black uppercase tracking-widest text-slate-300">{data.label}</span>
       <button 
         onClick={(e) => { e.stopPropagation(); setNodes((nds) => nds.filter((n) => n.id !== id)); }}
         className="absolute -top-1 -right-1 w-5 h-5 bg-rose-600 text-white rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-[60] shadow-xl hover:bg-rose-500"
       >
         <X size={10} strokeWidth={3} />
       </button>
       <Handle type="target" position={Position.Top} className={`w-2 h-2 bg-${color}-500 border-none`} />
       <Handle type="source" position={Position.Bottom} className={`w-2 h-2 bg-${color}-500 border-none`} />
    </div>
  )
}

const nodeTypes = {
  process: ProcessNode,
  diamond: DiamondNode,
  server: (props: any) => <InfrastructureNode {...props} type="server" />,
  storage: (props: any) => <InfrastructureNode {...props} type="storage" />,
  db: (props: any) => <InfrastructureNode {...props} type="db" />,
  cloud: (props: any) => <InfrastructureNode {...props} type="cloud" />
}

const DiagramBuilder = ({ data, onChange, onSave }: any) => {
  const [nodes, setNodes, onNodesChange] = useNodesState(data?.nodes || [])
  const [edges, setEdges, onEdgesChange] = useEdgesState(data?.edges || [])

  const onConnect = (params: Connection) => setEdges(eds => addEdge({ ...params, markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' } }, eds))
  const addNode = (type: string, label: string) => setNodes(nds => [...nds, { id: Date.now().toString(), type, data: { label }, position: { x: 100, y: 100 } }])

  useEffect(() => { 
    if (nodes.length || edges.length) onChange({ nodes, edges }) 
  }, [nodes, edges])

  return (
    <div className="h-[650px] bg-[#0a0c14] border border-white/5 rounded-lg overflow-hidden relative shadow-inner">
       <ReactFlow 
         nodes={nodes} 
         edges={edges} 
         onNodesChange={onNodesChange} 
         onEdgesChange={onEdgesChange} 
         onConnect={onConnect} 
         nodeTypes={nodeTypes} 
         fitView
       >
          <Background color="#1e293b" gap={24} size={1} />
          <Controls />
       </ReactFlow>
       <div className="absolute top-6 left-6 flex flex-col gap-4 bg-black/60 p-2 rounded-lg border border-white/10 backdrop-blur-xl shadow-2xl">
          <button onClick={() => addNode('process', 'STEP')} className="p-3 text-blue-400 hover:bg-blue-600/20 rounded-lg transition-all"><Layout size={20}/></button>
          <button onClick={() => addNode('diamond', 'DECISION')} className="p-3 text-amber-400 hover:bg-amber-600/20 rounded-lg transition-all"><MousePointer2 size={20}/></button>
          <button onClick={() => addNode('server', 'SERVER')} className="p-3 text-slate-400 hover:bg-white/10 rounded-lg transition-all"><Server size={20}/></button>
       </div>
       {onSave && (
         <button 
           onClick={onSave} 
           className="absolute bottom-6 right-6 px-10 py-3 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest shadow-2xl hover:scale-105 active:scale-95 transition-all"
         >Baseline Design</button>
       )}
    </div>
  )
}

const WorkbenchView = ({ project, onUpdate, isEditing, devices, services, options, users }: any) => {
  const { confirm: confirmWorkspace, confirmation } = useWorkspaceConfirmation()
  const { ask, promptDialog } = useWorkspacePrompt()
  const [name, setName] = useState(project?.name || '')
  const [problemStatement, setProblemStatement] = useState(project?.problem_statement || '')
  const [objective, setObjective] = useState(project?.objective || '')
  const [focusedField, setFocusedField] = useState<'images' | 'references' | 'designs' | null>(null)
  const [isPasting, setIsPasting] = useState(false)
  const [newLinkLabel, setNewLinkLabel] = useState('')
  const [newLinkUrl, setNewLinkUrl] = useState('')
  const [activeDiagramIndex, setActiveDiagramIndex] = useState<number | null>(null)
  const [systemSearch, setSystemSearch] = useState('')
  const [assetSearch, setAssetSearch] = useState('')
  const [serviceSearch, setServiceSearch] = useState('')
  const [selectedImage, setSelectedImage] = useState<{ url: string, caption?: string, index: number } | null>(null)

  useEffect(() => {
    setName(project?.name || '')
    setProblemStatement(project?.problem_statement || '')
    setObjective(project?.objective || '')
  }, [project])

  const handleFieldChange = (field: string, value: any) => {
    if (project && project[field] !== value) onUpdate({ ...project, [field]: value })
  }

  // Cascading Logic & Option Prioritization
  const systemOptions = useMemo(() => options?.filter((o:any) => o.category === 'LogicalSystem') || [], [options])
  const typeOptions = useMemo(() => options?.filter((o:any) => o.category === 'ProjectType') || PROJECT_TYPES, [options])
  const userOptions = useMemo(() => users?.map((u:any) => ({ value: u.username, label: u.full_name || u.username })) || [], [users])

  const filteredSystems = useMemo(() => {
    const base = systemOptions.filter((o:any) => o.label.toLowerCase().includes(systemSearch.toLowerCase()))
    const selected = project?.target_systems || []
    return [...base].sort((a, b) => {
      const aSel = selected.includes(a.value)
      const bSel = selected.includes(b.value)
      if (aSel && !bSel) return -1
      if (!aSel && bSel) return 1
      return 0
    })
  }, [systemOptions, project?.target_systems, systemSearch])

  const filteredAssets = useMemo(() => {
    const base = (!project?.target_systems?.length ? devices : devices?.filter((d:any) => project.target_systems.includes(d.system))) || []
    const searched = base.filter((d:any) => d.name.toLowerCase().includes(assetSearch.toLowerCase()))
    const selected = project?.target_assets || []
    return [...searched].sort((a, b) => {
      const aSel = selected.includes(a.id)
      const bSel = selected.includes(b.id)
      if (aSel && !bSel) return -1
      if (!aSel && bSel) return 1
      return 0
    })
  }, [devices, project?.target_systems, project?.target_assets, assetSearch])

  const filteredServices = useMemo(() => {
    const base = (!project?.target_assets?.length ? services : services?.filter((s:any) => project.target_assets.includes(s.device_id))) || []
    const searched = base.filter((s:any) => s.name.toLowerCase().includes(serviceSearch.toLowerCase()))
    const selected = project?.target_services || []
    return [...searched].sort((a, b) => {
      const aSel = selected.includes(a.id)
      const bSel = selected.includes(b.id)
      if (aSel && !bSel) return -1
      if (!aSel && bSel) return 1
      return 0
    })
  }, [services, project?.target_assets, project?.target_services, serviceSearch])

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    if (focusedField !== 'images') return
    const items = e.clipboardData.items
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile()
        if (file) {
          const reader = new FileReader()
          reader.onload = (event) => {
            const base64 = event.target?.result as string
            const metadata = project?.metadata_json || {}
            const updatedImages = [...(metadata.images || []), { url: base64, caption: '', timestamp: new Date().toISOString() }]
            onUpdate({ ...project, metadata_json: { ...metadata, images: updatedImages } })
            toast.success('Artifact Captured')
          }
          reader.readAsDataURL(file)
        }
      }
    }
  }, [project, onUpdate, focusedField])

  useEffect(() => {
    const handleClickOutside = () => setFocusedField(null)
    window.addEventListener('click', handleClickOutside)
    return () => window.removeEventListener('click', handleClickOutside)
  }, [])

  if (!project) return (
    <div className="h-full flex flex-col items-center justify-center opacity-20">
       <Briefcase size={64} className="mb-4" />
       <h2 className="text-xl font-bold uppercase tracking-widest">Select Strategic Vector</h2>
    </div>
  )

  return (
    <div className="max-w-full mx-auto space-y-10 pb-20" onPaste={handlePaste}>
       {confirmation}{promptDialog}
       <section className="bg-white/5 rounded-lg border border-white/5 overflow-hidden shadow-2xl">
          <div className="p-8 border-b border-white/5 bg-[#0a0c14]/50">
             <div className="grid grid-cols-3 gap-8">
                <div className="col-span-1 space-y-2">
                   <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Project Title</label>
                   {isEditing ? (
                     <input 
                       value={name} 
                       onChange={e => setName(e.target.value)}
                       onBlur={() => handleFieldChange('name', name)}
                       className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs font-bold text-white outline-none focus:border-blue-500 transition-all"
                     />
                   ) : (
                     <p className="text-xl font-bold text-white tracking-tighter px-1">{project.name}</p>
                   )}
                </div>
                <div className="space-y-2">
                   {isEditing ? (
                     <StyledSelect 
                       label="Status"
                       value={project.status}
                       onChange={e => handleFieldChange('status', e.target.value)}
                       options={PROJECT_STATUSES}
                     />
                   ) : (
                     <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest px-1">Status</label>
                        <div className="flex items-center gap-2 px-1">
                           <StatusPill value={project.status} />
                        </div>
                     </div>
                   )}
                </div>
                <div className="space-y-2">
                   {isEditing ? (
                     <StyledSelect 
                       label="Priority"
                       value={project.priority}
                       onChange={e => handleFieldChange('priority', e.target.value)}
                       options={PROJECT_PRIORITIES}
                     />
                   ) : (
                     <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest px-1">Priority</label>
                        <p className="text-xs font-bold text-amber-500 uppercase tracking-widest px-1">{project.priority}</p>
                     </div>
                   )}
                </div>
             </div>
          </div>

          <div className="p-10 grid grid-cols-2 gap-12">
             <section className="space-y-4">
                <div className="flex items-center gap-3 px-1">
                   <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                   <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] font-inter italic">Problem Statement</h4>
                </div>
                <div className={`bg-black/40 p-8 rounded-lg border-2 transition-all min-h-[160px] shadow-inner ${isEditing ? 'border-blue-500/30' : 'border-white/5'}`}>
                   {isEditing ? (
                     <textarea value={problemStatement} onChange={e => setProblemStatement(e.target.value)} onBlur={() => handleFieldChange('problem_statement', problemStatement)} className="w-full h-full bg-transparent border-none outline-none text-sm font-bold text-slate-300 leading-relaxed resize-none italic" placeholder="Define strategic friction..." />
                   ) : (
                     <p className="text-sm font-bold text-slate-400 leading-relaxed whitespace-pre-wrap italic">"{project.problem_statement || 'No problem statement defined.'}"</p>
                   )}
                </div>
             </section>
             <section className="space-y-4">
                <div className="flex items-center gap-3 px-1">
                   <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                   <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] font-inter italic">Strategic Objective</h4>
                </div>
                <div className={`bg-black/40 p-8 rounded-lg border-2 transition-all min-h-[160px] shadow-inner ${isEditing ? 'border-white/20' : 'border-white/5'}`}>
                   {isEditing ? (
                     <textarea value={objective} onChange={e => setObjective(e.target.value)} onBlur={() => handleFieldChange('objective', objective)} className="w-full h-full bg-transparent border-none outline-none text-sm font-bold text-slate-300 leading-relaxed resize-none italic" placeholder="Define target end state..." />
                   ) : (
                     <p className="text-sm font-bold text-slate-400 leading-relaxed whitespace-pre-wrap italic">"{project.objective || 'No objective defined.'}"</p>
                   )}
                </div>
             </section>
          </div>

          <div className="p-10 grid grid-cols-12 gap-12 bg-black/20 border-t border-white/5">
             <div className="col-span-8 space-y-4">
                <div className="flex items-center gap-3 px-1">
                   <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] font-inter italic">Strategic Context & Boundaries</label>
                </div>
                <div className="grid grid-cols-3 gap-6">
                   {[
                     { label: 'Systems', key: 'target_systems', options: filteredSystems, search: systemSearch, setSearch: setSystemSearch },
                     { label: 'Assets', key: 'target_assets', options: filteredAssets, search: assetSearch, setSearch: setAssetSearch },
                     { label: 'Services', key: 'target_services', options: filteredServices, search: serviceSearch, setSearch: setServiceSearch }
                   ].map(group => (
                     <div key={group.key} className="space-y-3">
                        <div className="flex items-center justify-between px-2">
                           <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">{group.label}</span>
                           {isEditing && (
                             <input value={group.search} onChange={e => group.setSearch(e.target.value)} className="bg-transparent border-none outline-none text-[8px] font-bold text-blue-500 w-12 text-right" placeholder="FIND..." />
                           )}
                        </div>
                        <div className="space-y-1.5 max-h-56 overflow-y-auto custom-scrollbar bg-black/40 border border-white/10 rounded-lg p-3 shadow-inner">
                           {group.options
                             .filter((o:any) => isEditing || (project[group.key] || []).includes(o.value || o.id))
                             .map((o:any) => (
                              <label key={o.value || o.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all ${isEditing ? 'cursor-pointer' : ''} ${(project[group.key] || []).includes(o.value || o.id) ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-white/5 text-slate-600'}`}>
                                 {isEditing && (
                                   <input 
                                     type="checkbox" 
                                     checked={(project[group.key] || []).includes(o.value || o.id)} 
                                     onChange={e => {
                                        const current = project[group.key] || []
                                        const val = o.value || o.id
                                        const updated = e.target.checked ? [...current, val] : current.filter((x:any) => x !== val)
                                        handleFieldChange(group.key, updated)
                                     }}
                                     className="w-3.5 h-3.5 rounded-lg border-white/10 bg-black/40 text-blue-600 focus:ring-blue-600"
                                   />
                                 )}
                                 <span className="text-[9px] font-black uppercase tracking-tight truncate font-inter">{o.label || o.name}</span>
                              </label>
                           ))}
                        </div>
                     </div>
                   ))}
                </div>
             </div>
             <div className="col-span-4 space-y-6">
                <div className="space-y-4">
                   <div className="flex items-center gap-3 px-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] font-inter italic">Stakeholders</label>
                   </div>
                   <div className="space-y-2">
                      <input 
                         value={project.stakeholders || ''}
                         onChange={e => handleFieldChange('stakeholders', e.target.value)}
                         className="w-full bg-black/40 border border-white/10 rounded-lg px-6 py-4 text-xs font-bold text-white outline-none focus:border-white/20 transition-all shadow-inner italic"
                         placeholder="Enter team identifiers..."
                      />
                   </div>
                </div>
                <div className="space-y-4">
                   <div className="flex items-center gap-3 px-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] font-inter italic">Strategic Owners</label>
                   </div>
                   <div className="grid grid-cols-1 gap-1.5 max-h-40 overflow-y-auto custom-scrollbar bg-black/40 border border-white/10 rounded-lg p-3 shadow-inner">
                      {userOptions.map((o:any) => (
                        <label key={o.value} className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all cursor-pointer ${(project.owners || []).includes(o.value) ? 'bg-blue-600/20 text-blue-400 shadow-sm' : 'hover:bg-white/5 text-slate-600'}`}>
                           <input 
                             type="checkbox" 
                             checked={(project.owners || []).includes(o.value)} 
                             onChange={e => {
                                const current = project.owners || []
                                const updated = e.target.checked ? [...current, o.value] : current.filter((x:any) => x !== o.value)
                                handleFieldChange('owners', updated)
                             }}
                             className="w-3.5 h-3.5 rounded-lg border-white/10 bg-black/40 text-blue-600"
                           />
                           <span className="text-[9px] font-black uppercase tracking-tight font-inter">{o.label}</span>
                        </label>
                      ))}
                   </div>
                </div>
             </div>
          </div>
       </section>

       <div className="grid grid-cols-2 gap-10">
          <section className="space-y-4">
             <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Jira Links</h4>
             <div className="space-y-2">
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input 
                      value={newLinkLabel} 
                      onChange={e => setNewLinkLabel(e.target.value)} 
                      className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-bold text-white outline-none" 
                      placeholder="Label (e.g. PROJ-123)"
                    />
                    <input 
                      value={newLinkUrl} 
                      onChange={e => setNewLinkUrl(e.target.value)} 
                      className="flex-[2] bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-bold text-white outline-none" 
                      placeholder="Link URL"
                    />
                    <button 
                      onClick={() => {
                        if (!newLinkLabel || !newLinkUrl) return
                        const metadata = project?.metadata_json || {}
                        const links = [...(metadata.links || []), { label: newLinkLabel, url: newLinkUrl }]
                        handleFieldChange('metadata_json', { ...metadata, links })
                        setNewLinkLabel(''); setNewLinkUrl('')
                      }}
                      className="p-2 bg-white/5 border border-white/10 text-slate-400 hover:text-white rounded-lg transition-all"
                    ><Plus size={16}/></button>
                  </div>
                  <div className="space-y-1">
                    {(project.metadata_json?.links || []).map((link: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-white/5 rounded-lg border border-white/5 group">
                        <a href={link.url} target="_blank" rel="noreferrer" className="text-[9px] font-bold text-slate-400 uppercase hover:text-blue-400">{link.label}</a>
                        <button onClick={() => {
                          const metadata = project.metadata_json || {}
                          const links = metadata.links.filter((_:any, idx:number) => idx !== i)
                          handleFieldChange('metadata_json', { ...metadata, links })
                        }} className="text-slate-600 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={12}/></button>
                      </div>
                    ))}
                  </div>
                </div>
             </div>
          </section>

          <section className="space-y-4">
             <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Stakeholders</h4>
             <div className="space-y-2">
                <label className="text-[8px] font-bold text-slate-600 uppercase px-1">Comma-separated team names</label>
                <input 
                   value={project.stakeholders || ''}
                   onChange={e => handleFieldChange('stakeholders', e.target.value)}
                   className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-xs font-bold text-white outline-none focus:border-white/20 transition-all"
                   placeholder="Security, Infra, DevOps..."
                />
             </div>
          </section>
       </div>

       <div className="space-y-10">
          <div className="flex items-center justify-between px-2">
             <div className="flex items-center gap-4">
                <div className="w-8 h-8 bg-amber-600/10 rounded-lg flex items-center justify-center border border-amber-500/20">
                   <GitBranch size={16} className="text-amber-400" />
                </div>
                <h4 className="text-sm font-black text-white uppercase tracking-tighter italic font-inter">Strategic Designs</h4>
             </div>
             <button 
               onClick={() => {
                 const metadata = project?.metadata_json || {}
                 const newDiagrams = [...(metadata.diagrams || []), { id: Date.now(), name: `Design v${(metadata.diagrams || []).length + 1}`, nodes: [], edges: [] }]
                 handleFieldChange('metadata_json', { ...metadata, diagrams: newDiagrams })
                 setActiveDiagramIndex(newDiagrams.length - 1)
               }}
               className="px-6 py-2 bg-white/5 border border-white/10 text-slate-400 hover:text-white rounded-lg text-[9px] font-black uppercase tracking-[0.2em] transition-all hover:bg-white/10 italic"
             >+ New Design</button>
          </div>
          <div className="grid grid-cols-1 gap-6">
             {(project?.metadata_json?.diagrams || []).map((d: any, idx: number) => (
               <div key={d.id} className="border border-white/10 rounded-lg bg-black/20 overflow-hidden group/design shadow-2xl">
                  <div className="w-full flex items-center justify-between bg-white/[0.02] pr-6">
                     <button onClick={() => setActiveDiagramIndex(activeDiagramIndex === idx ? null : idx)} className="flex-1 px-8 py-5 flex items-center gap-4 hover:bg-white/5 transition-all">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-300 font-inter italic">{d.name}</span>
                        <ChevronRight size={16} className={`text-slate-600 transition-transform ${activeDiagramIndex === idx ? 'rotate-90' : ''}`} />
                     </button>
                     <button 
                       onClick={async () => {
                         if (await confirmWorkspace({ title: 'Decommission design?', message: 'Decommission this design?', confirmText: 'Decommission', variant: 'danger' })) {
                           const metadata = project.metadata_json || {}
                           const updated = metadata.diagrams.filter((_:any, i:number) => i !== idx)
                           handleFieldChange('metadata_json', { ...metadata, diagrams: updated })
                           if (activeDiagramIndex === idx) setActiveDiagramIndex(null)
                         }
                       }}
                       className="p-2 text-rose-500 hover:bg-rose-600 hover:text-white rounded-lg transition-all opacity-0 group-hover/design:opacity-100 shadow-xl"
                     ><Trash2 size={16} /></button>
                  </div>
                  <AnimatePresence>
                     {activeDiagramIndex === idx && (
                       <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                          <DiagramBuilder data={d} onChange={(updated: any) => {
                            const metadata = project?.metadata_json || {}
                            const newDiagrams = [...(metadata.diagrams || [])]
                            newDiagrams[idx] = { ...newDiagrams[idx], ...updated }
                            handleFieldChange('metadata_json', { ...metadata, diagrams: newDiagrams })
                          }} onSave={() => { setActiveDiagramIndex(null); toast.success('Vector Baseline Committed'); }} />
                       </motion.div>
                     )}
                  </AnimatePresence>
               </div>
             ))}
          </div>
       </div>

       <div className="grid grid-cols-12 gap-12">
          <section className="col-span-7 space-y-6">
             <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-4">
                   <div className="w-8 h-8 bg-blue-600/10 rounded-lg flex items-center justify-center border border-blue-500/20">
                      <ImageIcon size={16} className="text-blue-400" />
                   </div>
                   <h4 className="text-sm font-black text-white uppercase tracking-tighter italic font-inter">Artifacts & Evidence</h4>
                </div>
                {focusedField === 'images' && <span className="text-[8px] font-black text-blue-400 animate-pulse tracking-widest uppercase italic">Ready for paste...</span>}
             </div>
             <div 
               onClick={(e) => { e.stopPropagation(); setFocusedField('images'); }}
               className={`grid grid-cols-3 gap-6 p-8 rounded-lg border-2 transition-all min-h-[200px] shadow-inner cursor-pointer ${focusedField === 'images' ? 'border-blue-500 bg-blue-500/5' : 'border-dashed border-white/5 bg-black/20 hover:border-white/20'}`}
             >
                {(project?.metadata_json?.images || []).map((img: any, i: number) => {
                  const imageUrl = typeof img === 'string' ? img : img.url
                  const caption = typeof img === 'string' ? '' : img.caption
                  return (
                    <div key={i} className="group/img relative aspect-video bg-black/40 rounded-lg border border-white/10 overflow-hidden shadow-2xl hover:scale-[1.02] transition-transform cursor-zoom-in" onClick={() => setSelectedImage({ url: imageUrl, caption, index: i })}>
                       <img src={imageUrl} alt="Artifact" className="w-full h-full object-cover opacity-80 group-hover/img:opacity-100 transition-opacity" />
                       <button onClick={(e) => {
                          e.stopPropagation()
                          const metadata = project?.metadata_json || {}
                          const updated = (metadata.images || []).filter((_:any, idx:number) => idx !== i)
                          handleFieldChange('metadata_json', { ...metadata, images: updated })
                       }} className="absolute top-3 right-3 p-2 bg-rose-600 rounded-lg text-white opacity-0 group-hover/img:opacity-100 transition-all shadow-2xl"><Trash2 size={14}/></button>
                       <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover/img:opacity-100 transition-all">
                          <p className="text-[8px] font-bold text-white uppercase tracking-widest truncate">{caption || 'UNLABELED_ARTIFACT'}</p>
                       </div>
                    </div>
                  )
                })}
                <div className="flex flex-col items-center justify-center gap-4 py-12 text-slate-700 group">
                   <div className="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 group-hover:scale-110 transition-transform">
                      <Camera size={24} className="opacity-40" />
                   </div>
                   <p className="text-[9px] font-black uppercase tracking-[0.3em] text-center italic">{focusedField === 'images' ? 'CTRL+V TO ATTACH' : 'Select to attach evidence'}</p>
                </div>
             </div>
          </section>

          <section className="col-span-5 space-y-6">
             <div className="flex items-center gap-4 px-2 h-8">
                <div className="w-8 h-8 bg-emerald-600/10 rounded-lg flex items-center justify-center border border-emerald-500/20">
                   <Link2 size={16} className="text-emerald-400" />
                </div>
                <h4 className="text-sm font-black text-white uppercase tracking-tighter italic font-inter">Strategic References</h4>
             </div>
             <div className="space-y-4 bg-black/20 p-8 rounded-lg border border-white/5 shadow-inner min-h-[200px]">
                {(project?.metadata_json?.references || []).map((ref: any, i: number) => (
                  <div key={i} className="flex items-center gap-4 group/ref">
                     <a href={ref.url} target="_blank" rel="noreferrer" className="flex-1 p-5 bg-white/[0.03] rounded-lg border border-white/5 hover:bg-blue-600/10 hover:border-blue-500/30 transition-all flex justify-between items-center shadow-lg">
                        <div className="flex items-center gap-3">
                           <Globe size={14} className="text-slate-600" />
                           <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest italic font-inter">{ref.label}</span>
                        </div>
                        <ExternalLink size={14} className="text-slate-700 group-hover/ref:text-blue-400" />
                     </a>
                     <button onClick={() => {
                        const metadata = project?.metadata_json || {}
                        const updated = metadata.references.filter((_:any, idx:number) => idx !== i)
                        handleFieldChange('metadata_json', { ...metadata, references: updated })
                     }} className="p-3 bg-white/5 text-slate-600 hover:text-rose-500 rounded-lg opacity-0 group-hover/ref:opacity-100 transition-all shadow-xl"><Trash2 size={14} /></button>
                  </div>
                ))}
                <button 
                  onClick={async () => {
                    const label = await ask({ title: 'Add reference', label: 'Reference label' })
                    if (!label) return
                    const url = await ask({ title: 'Add reference', label: 'Reference URL', type: 'url' })
                    if (label && url) {
                      const metadata = project?.metadata_json || {}
                      const references = [...(metadata.references || []), { label, url }]
                      handleFieldChange('metadata_json', { ...metadata, references })
                    }
                  }}
                  className="w-full py-5 border-2 border-dashed border-white/5 rounded-lg text-[10px] font-black text-slate-700 uppercase tracking-[0.3em] hover:text-blue-500 hover:border-blue-500/40 transition-all italic font-inter"
                >Establish Reference Link</button>
             </div>
          </section>
       </div>

       <AnimatePresence>
          {selectedImage && (
            <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/95 backdrop-blur-xl p-12 overflow-y-auto" onClick={() => setSelectedImage(null)}>
               <motion.div 
                 initial={{ opacity: 0, scale: 0.9 }} 
                 animate={{ opacity: 1, scale: 1 }} 
                 exit={{ opacity: 0, scale: 0.9 }}
                 className="relative max-w-7xl w-full flex flex-col gap-6"
                 onClick={e => e.stopPropagation()}
               >
                  <img src={selectedImage.url} alt="Artifact Full" className="w-full h-auto rounded-lg shadow-2xl border border-white/10" />
                  <div className="bg-[#0a0c14] border border-white/10 rounded-lg p-8 space-y-4">
                     <div className="flex items-center justify-between">
                        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Artifact Caption</h4>
                        <button onClick={() => setSelectedImage(null)} className="text-slate-500 hover:text-white transition-all"><X size={24}/></button>
                     </div>
                     <textarea 
                       value={selectedImage.caption || ''} 
                       onChange={e => {
                          const newCaption = e.target.value
                          setSelectedImage({ ...selectedImage, caption: newCaption })
                          const metadata = project?.metadata_json || {}
                          const images = [...(metadata.images || [])]
                          const currentImg = images[selectedImage.index]
                          if (typeof currentImg === 'string') {
                             images[selectedImage.index] = { url: currentImg, caption: newCaption }
                          } else {
                             images[selectedImage.index] = { ...currentImg, caption: newCaption }
                          }
                          handleFieldChange('metadata_json', { ...metadata, images })
                       }}
                       className="w-full bg-black/40 border border-white/10 rounded-lg p-4 text-sm font-bold text-slate-300 outline-none focus:border-blue-500 transition-all h-24 resize-none leading-relaxed"
                       placeholder="Enter artifact context..."
                     />
                  </div>
               </motion.div>
            </div>
          )}
       </AnimatePresence>
    </div>
  )
}

const ProjectActivityStream = ({ project, allProjects = [] }: any) => {
  const [isFull, setIsFull] = useState(false)
  
  const activities = useMemo(() => {
    const list = project 
      ? [
          ...(project?.tasks || []).flatMap((t:any) => (t?.metadata_json?.history || []).map((h:any) => ({ ...h, type: 'TASK', taskName: t?.name, icon: <Target size={14}/> }))),
          ...(project?.tasks || []).flatMap((t:any) => (t?.metadata_json?.comments || []).map((c:any) => ({ ...c, type: 'COMMENT', taskName: t?.name, icon: <MessageSquare size={14}/> }))),
          ...(project?.metadata_json?.audit_log || []).map((a:any) => ({ ...a, type: 'PROJECT', icon: <Projector size={14}/> }))
        ]
      : allProjects.flatMap((p:any) => [
          ...(p?.tasks || []).flatMap((t:any) => (t?.metadata_json?.history || []).map((h:any) => ({ ...h, type: 'TASK', taskName: t?.name, projectName: p?.name, icon: <Target size={14}/> }))),
          ...(p?.tasks || []).flatMap((t:any) => (t?.metadata_json?.comments || []).map((c:any) => ({ ...c, type: 'COMMENT', taskName: t?.name, projectName: p?.name, icon: <MessageSquare size={14}/> }))),
          ...(p?.metadata_json?.audit_log || []).map((a:any) => ({ ...a, type: 'PROJECT', projectName: p?.name, icon: <Projector size={14}/> }))
        ])
    return list.sort((a:any, b:any) => (parseAppDate(b.timestamp || b.created_at)?.getTime() || 0) - (parseAppDate(a.timestamp || a.created_at)?.getTime() || 0))
  }, [project, allProjects])

  return (
    <div className={`flex flex-col bg-[#0d0f17] transition-all ${isFull ? 'fixed inset-0 z-[200] p-12' : 'h-full p-6'}`}>
       <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
             <div className="w-10 h-10 bg-blue-600/10 rounded-lg flex items-center justify-center border border-blue-500/20">
                <Activity size={20} className="text-blue-400" />
             </div>
             <div>
                <h3 className="text-xl font-bold text-white uppercase tracking-tighter">Strategic Evolution Stream</h3>
                <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mt-0.5">Unified ledger of tactical shifts and strategic commits</p>
             </div>
          </div>
          <button 
            onClick={() => setIsFull(!isFull)} 
            className="p-2.5 bg-white/5 border border-white/10 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition-all"
          >
             {isFull ? <Minimize2 size={18}/> : <Maximize2 size={18}/>}
          </button>
       </div>

       <div className="flex-1 overflow-y-auto custom-scrollbar pr-4 space-y-4">
          {activities.map((item:any, i:number) => (
            <div key={i} className="group relative flex gap-6 p-5 bg-[#0a0c14] border border-white/5 rounded-lg hover:border-blue-500/30 transition-all">
               <div className="flex flex-col items-center gap-2">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-all ${
                    item.type === 'COMMENT' ? 'bg-amber-600/10 border-amber-500/20 text-amber-500' : 
                    item.type === 'TASK' ? 'bg-blue-600/10 border-blue-500/20 text-blue-400' :
                    'bg-emerald-600/10 border-emerald-500/20 text-emerald-500'
                  }`}>
                     {item.icon}
                  </div>
                  <div className="w-px flex-1 bg-white/5" />
               </div>
               
               <div className="flex-1 space-y-3">
                  <div className="flex justify-between items-center">
                     <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">{item.author || 'SYSTEM'}</span>
                        <span className="text-slate-800">•</span>
                        <span className="text-[9px] font-bold text-blue-500/60 uppercase tracking-widest">{item.type}</span>
                        {item.projectName && (
                          <>
                             <span className="text-slate-800">/</span>
                             <span className="text-[9px] font-bold text-slate-500 uppercase">{item.projectName}</span>
                          </>
                        )}
                     </div>
                     <span className="text-[9px] font-bold text-slate-700 uppercase">{format(parseAppDate(item.timestamp || item.created_at)!, 'MMM dd, yyyy HH:mm:ss')}</span>
                  </div>
                  
                  <div className="bg-black/20 p-4 rounded-lg border border-white/5">
                     <p className="text-xs font-bold text-slate-300 leading-relaxed italic">"{item.content || item.message}"</p>
                  </div>

                  {item.taskName && (
                    <div className="flex items-center gap-2">
                       <Tag size={10} className="text-blue-500" />
                       <span className="text-[9px] font-bold text-blue-400/60 uppercase tracking-widest">{item.taskName}</span>
                    </div>
                  )}
               </div>
            </div>
          ))}
          
          {activities.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center py-40 opacity-20">
               <History size={64} className="text-slate-500 mb-6" />
               <p className="text-xs font-bold uppercase tracking-[0.4em] text-slate-500 text-center">No project evolutions captured in current context</p>
            </div>
          )}
       </div>
    </div>
  )
}

export const ProjectForm = ({ initialData, onSave, isSaving, onCancel, devices, services, options }: any) => {
  const [formData, setFormData] = useState({ 
    name: '', type: 'Strategic', status: 'Planning', priority: 'Medium', owner: '', 
    problem_statement: '', objective: '', description: '', start_date: new Date().toISOString(), end_date: addDays(new Date(), 90).toISOString(),
    man_hours_saved: 0, stoploss_minutes_saved: 0, wafers_gained: 0, roi_defense_line: 0, roi_types: [], jira_links: [], 
    target_systems: [], target_assets: [], target_services: [], ...initialData 
  })
  const [jiraInput, setJiraInput] = useState((formData.jira_links || []).join(', '))

  // Cascading Logic
  const systemOptions = options?.filter((o:any) => o.category === 'LogicalSystem') || []
  const filteredAssets = useMemo(() => {
    if (!formData.target_systems?.length) return devices || []
    return devices?.filter((d:any) => formData.target_systems.includes(d.system)) || []
  }, [devices, formData.target_systems])

  const filteredServices = useMemo(() => {
    if (!formData.target_assets?.length) return services || []
    return services?.filter((s:any) => formData.target_assets.includes(s.device_id)) || []
  }, [services, formData.target_assets])

  const years = Array.from({ length: 11 }, (_, i) => 2024 + i)
  const months = [
    { v: 0, l: 'JAN' }, { v: 1, l: 'FEB' }, { v: 2, l: 'MAR' }, { v: 3, l: 'APR' },
    { v: 4, l: 'MAY' }, { v: 5, l: 'JUN' }, { v: 6, l: 'JUL' }, { v: 7, l: 'AUG' },
    { v: 8, l: 'SEP' }, { v: 9, l: 'OCT' }, { v: 10, l: 'NOV' }, { v: 11, l: 'DEC' }
  ]

  const handleDateChange = (type: 'start' | 'end', part: 'month' | 'year', val: number) => {
    const d = parseAppDate(formData[`${type}_date`]) || new Date()
    d.setDate(1)
    if (part === 'month') d.setMonth(val)
    else d.setFullYear(val)
    setFormData({ ...formData, [`${type}_date`]: d.toISOString() })
  }

  useEffect(() => {
    if (initialData) {
      setFormData(prev => ({ ...prev, ...initialData }))
      setJiraInput((initialData.jira_links || []).join(', '))
    }
  }, [initialData])

  const startDate = parseAppDate(formData.start_date) || new Date()
  const endDate = parseAppDate(formData.end_date) || new Date()

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-8 bg-[#0a0c14]/50 rounded-lg border border-white/5 shadow-2xl mt-4">
       <div className="flex items-center gap-3"><div className="w-10 h-10 bg-blue-600/10 rounded-lg flex items-center justify-center border border-blue-500/20"><Briefcase size={20} className="text-blue-400" /></div><div><h3 className="text-lg font-bold uppercase text-white tracking-tighter">Strategic Matrix Configuration</h3></div></div>
       <div className="grid grid-cols-2 gap-8">
          <div className="space-y-5">
             <div><label className="text-[9px] font-bold text-slate-600 uppercase mb-1.5 block">Project Identifier</label><input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-xs font-bold text-white outline-none focus:border-blue-500" placeholder="Enter project name..."/></div>
             <div className="grid grid-cols-2 gap-4"><StyledSelect label="Type" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} options={PROJECT_TYPES} /><StyledSelect label="Priority" value={formData.priority} onChange={e => setFormData({...formData, priority: e.target.value})} options={PROJECT_PRIORITIES} /></div>
             <div className="grid grid-cols-2 gap-4"><StyledSelect label="Status" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} options={PROJECT_STATUSES} /><div><label className="text-[9px] font-bold text-slate-600 uppercase mb-1.5 block">Lead Owner</label><input value={formData.owner} onChange={e => setFormData({ ...formData, owner: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-xs font-bold text-white outline-none focus:border-blue-500"/></div></div>
             
             <div className="space-y-4 pt-4 border-t border-white/5">
                <label className="text-[10px] font-bold text-blue-400 uppercase tracking-widest flex items-center gap-2"><Calendar size={14} /> Timeline parameters</label>
                <div className="grid grid-cols-2 gap-6">
                   <div className="space-y-2">
                      <label className="text-[8px] font-bold text-slate-500 uppercase">Initialization</label>
                      <div className="flex gap-2">
                         <select value={startDate.getMonth()} onChange={e => handleDateChange('start', 'month', parseInt(e.target.value))} className="flex-1 bg-black/40 border border-white/10 rounded-lg px-2 py-2 text-[10px] font-bold text-white outline-none">{months.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}</select>
                         <select value={startDate.getFullYear()} onChange={e => handleDateChange('start', 'year', parseInt(e.target.value))} className="flex-1 bg-black/40 border border-white/10 rounded-lg px-2 py-2 text-[10px] font-bold text-white outline-none">{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
                      </div>
                   </div>
                   <div className="space-y-2">
                      <label className="text-[8px] font-bold text-slate-500 uppercase">Termination</label>
                      <div className="flex gap-2">
                         <select value={endDate.getMonth()} onChange={e => handleDateChange('end', 'month', parseInt(e.target.value))} className="flex-1 bg-black/40 border border-white/10 rounded-lg px-2 py-2 text-[10px] font-bold text-white outline-none">{months.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}</select>
                         <select value={endDate.getFullYear()} onChange={e => handleDateChange('end', 'year', parseInt(e.target.value))} className="flex-1 bg-black/40 border border-white/10 rounded-lg px-2 py-2 text-[10px] font-bold text-white outline-none">{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
                      </div>
                   </div>
                </div>
             </div>
          </div>

          <div className="space-y-5">
             <div className="bg-white/[0.02] p-5 rounded-lg border border-white/5 space-y-4">
                <h4 className="text-[9px] font-bold text-blue-400 uppercase mb-1 flex items-center gap-2"><BarChart3 size={12} /> Strategic Impact Metrics</h4>
                <div className="space-y-3 mb-4">
                   <h5 className="text-[8px] font-bold text-slate-500 uppercase tracking-widest px-1">Active ROI Streams</h5>
                   <div className="grid grid-cols-2 gap-2">
                      {ROI_TYPES.map(t => (
                        <label key={t.value} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${formData.roi_types?.includes(t.value) ? 'bg-blue-600/10 border-blue-500/30 text-blue-400' : 'bg-white/5 border-white/5 text-slate-600'}`}>
                           <input type="checkbox" checked={formData.roi_types?.includes(t.value)} onChange={e => {
                             const current = formData.roi_types || []
                             const updated = e.target.checked ? [...current, t.value] : current.filter((v:any) => v !== t.value)
                             setFormData({ ...formData, roi_types: updated })
                           }} className="rounded-lg border-white/10 bg-black/40 text-blue-600"/><span className="text-[9px] font-bold uppercase tracking-tight">{t.label}</span>
                        </label>
                      ))}
                   </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                   <StyledSelect label="Defense Line" value={formData.roi_defense_line} onChange={e => setFormData({...formData, roi_defense_line: parseInt(e.target.value)})} options={DEFENSE_LINES} />
                   <div><label className="text-[9px] font-bold text-slate-600 uppercase mb-1.5 block">Man-Hours Saved (hr/yr)</label><input type="number" value={formData.man_hours_saved} onChange={e => setFormData({...formData, man_hours_saved: parseFloat(e.target.value) || 0})} className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-1.5 text-xs font-bold text-white outline-none" /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                   <div><label className="text-[9px] font-bold text-slate-600 uppercase mb-1.5 block">Stoploss (min/yr)</label><input type="number" value={formData.stoploss_minutes_saved} onChange={e => setFormData({...formData, stoploss_minutes_saved: parseFloat(e.target.value) || 0})} className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-1.5 text-xs font-bold text-white outline-none" /></div>
                   <div><label className="text-[9px] font-bold text-slate-600 uppercase mb-1.5 block">Wafer Yield (WPD)</label><input type="number" value={formData.wafers_gained} onChange={e => setFormData({...formData, wafers_gained: parseFloat(e.target.value) || 0})} className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-1.5 text-xs font-bold text-white outline-none" /></div>
                </div>
                <div><label className="text-[9px] font-bold text-slate-600 uppercase mb-1.5 block">Jira References</label><input value={jiraInput} onChange={e => { setJiraInput(e.target.value); setFormData({ ...formData, jira_links: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }) }} className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-xs font-bold text-white outline-none" placeholder="e.g. PROJ-123, PROJ-456"/></div>
             </div>

             <div className="space-y-4 pt-4 border-t border-white/5">
                <label className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-2"><Sliders size={14} /> Context boundaries</label>
                <div className="grid grid-cols-3 gap-4">
                   <div className="space-y-2">
                      <label className="text-[8px] font-bold text-slate-500 uppercase">Systems</label>
                      <div className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar bg-black/40 border border-white/10 rounded-lg p-2">
                         {systemOptions.map((o:any) => (
                            <label key={o.value} className="flex items-center gap-2 group cursor-pointer">
                               <input type="checkbox" checked={formData.target_systems?.includes(o.value)} onChange={e => {
                                  const current = formData.target_systems || []
                                  const updated = e.target.checked ? [...current, o.value] : current.filter((x:any) => x !== o.value)
                                  
                                  // Prune assets that no longer belong to selected systems
                                  const validAssets = devices?.filter((d:any) => updated.includes(d.system)).map((d:any) => d.id) || []
                                  const prunedAssets = (formData.target_assets || []).filter((id:any) => validAssets.includes(id))
                                  
                                  // Prune services that no longer belong to valid assets
                                  const validServices = services?.filter((s:any) => prunedAssets.includes(s.device_id)).map((s:any) => s.id) || []
                                  const prunedServices = (formData.target_services || []).filter((id:any) => validServices.includes(id))

                                  setFormData({ ...formData, target_systems: updated, target_assets: prunedAssets, target_services: prunedServices })
                               }} className="rounded-lg border-white/10 bg-black/40 text-blue-600"/><span className="text-[9px] font-bold text-slate-400 group-hover:text-slate-200 uppercase">{o.label}</span>
                            </label>
                         ))}
                      </div>
                   </div>
                   <div className="space-y-2">
                      <label className="text-[8px] font-bold text-slate-500 uppercase">Assets</label>
                      <div className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar bg-black/40 border border-white/10 rounded-lg p-2">
                         {filteredAssets.map((d:any) => (
                            <label key={d.id} className="flex items-center gap-2 group cursor-pointer">
                               <input type="checkbox" checked={formData.target_assets?.includes(d.id)} onChange={e => {
                                  const current = formData.target_assets || []
                                  const updated = e.target.checked ? [...current, d.id] : current.filter((x:any) => x !== d.id)
                                  
                                  // Prune services that no longer belong to selected assets
                                  const validServices = services?.filter((s:any) => updated.includes(s.device_id)).map((s:any) => s.id) || []
                                  const prunedServices = (formData.target_services || []).filter((id:any) => validServices.includes(id))

                                  setFormData({ ...formData, target_assets: updated, target_services: prunedServices })
                               }} className="rounded-lg border-white/10 bg-black/40 text-blue-600"/><span className="text-[9px] font-bold text-slate-400 group-hover:text-slate-200 uppercase truncate">{d.name}</span>
                            </label>
                         ))}
                      </div>
                   </div>
                   <div className="space-y-2">
                      <label className="text-[8px] font-bold text-slate-500 uppercase">Services</label>
                      <div className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar bg-black/40 border border-white/10 rounded-lg p-2">
                         {filteredServices.map((s:any) => (
                            <label key={s.id} className="flex items-center gap-2 group cursor-pointer">
                               <input type="checkbox" checked={formData.target_services?.includes(s.id)} onChange={e => {
                                  const current = formData.target_services || []
                                  const updated = e.target.checked ? [...current, s.id] : current.filter((x:any) => x !== s.id)
                                  setFormData({ ...formData, target_services: updated })
                               }} className="rounded-lg border-white/10 bg-black/40 text-blue-600"/><span className="text-[9px] font-bold text-slate-400 group-hover:text-slate-200 uppercase truncate">{s.name}</span>
                            </label>
                         ))}
                      </div>
                   </div>
                </div>
             </div>
          </div>
       </div>
       <div className="flex gap-4 pt-4">
          <button onClick={onCancel} className="flex-1 py-3 bg-white/5 text-slate-600 rounded-lg text-[10px] font-bold uppercase tracking-[0.2em] transition-all">Abort</button>
          <button 
            disabled={isSaving || !formData.name || (parseAppDate(formData.start_date)?.getTime() || 0) >= (parseAppDate(formData.end_date)?.getTime() || 0)} 
            onClick={() => onSave(formData)} 
            className="flex-[2] py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[10px] font-bold uppercase tracking-[0.2em] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
             {isSaving ? 'Establishing Link...' : 'Commit Strategic Vector'}
          </button>
       </div>
    </div>
  )
}

const DailyHuddleView = ({ projects, users }: any) => {
  const huddleTasks = useMemo(() => {
    if (!projects) return []
    const tasks: any[] = []
    projects.forEach((p: any) => {
      (p.tasks || []).forEach((t: any) => {
        if (t.status !== 'Completed') {
          tasks.push({ ...t, projectName: p.name, projectId: p.id, projectPriority: p.priority })
        }
      })
    })
    return tasks.sort((a, b) => {
      // Prioritize Blocked tasks, then by date
      if (a.status === 'Blocked' && b.status !== 'Blocked') return -1
      if (a.status !== 'Blocked' && b.status === 'Blocked') return 1
      
      const dateA = parseAppDate(a.end_date)?.getTime() || 0
      const dateB = parseAppDate(b.end_date)?.getTime() || 0
      return dateA - dateB
    })
  }, [projects])

  const stats = useMemo(() => {
    return {
      total: huddleTasks.length,
      blocked: huddleTasks.filter(t => t.status === 'Blocked').length,
      approaching: huddleTasks.filter(t => {
        const dueDate = parseAppDate(t.end_date)
        return dueDate && differenceInDays(dueDate, new Date()) < 3
      }).length
    }
  }, [huddleTasks])

  return (
    <div className="h-full flex flex-col bg-[#0b0c14] overflow-hidden">
       <div className="h-20 border-b border-white/5 flex items-center px-8 justify-between bg-[#0a0c14]/80 backdrop-blur-xl">
          <div className="flex items-center gap-6">
             <div className="w-12 h-12 bg-blue-600/10 rounded-lg flex items-center justify-center border border-blue-500/20 shadow-[0_0_30px_rgba(37,99,235,0.1)]">
                <Users size={24} className="text-blue-400" />
             </div>
             <div>
                <h2 className="text-xl font-black text-white tracking-tighter uppercase">Tactical Huddle</h2>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mt-1">Aggregated live execution stream</p>
             </div>
          </div>
          <div className="flex items-center gap-12">
             <div className="text-center">
                <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest mb-1.5">Active Deck</p>
                <p className="text-2xl font-black text-white leading-none tracking-tighter">{stats.total}</p>
             </div>
             <div className="w-px h-10 bg-white/5" />
             <div className="text-center">
                <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest mb-1.5">Blocked</p>
                <p className="text-2xl font-black text-rose-500 leading-none tracking-tighter">{stats.blocked}</p>
             </div>
             <div className="w-px h-10 bg-white/5" />
             <div className="text-center">
                <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest mb-1.5">Critical (72H)</p>
                <p className="text-2xl font-black text-amber-500 leading-none tracking-tighter">{stats.approaching}</p>
             </div>
          </div>
       </div>

       <div className="flex-1 overflow-y-auto p-10 custom-scrollbar bg-[#0a0c14]/30">
          <div className="max-w-6xl mx-auto">
             {huddleTasks.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                   {huddleTasks.map((task) => (
                     <div 
                       key={task.id}
                       className={`group bg-[#0d0f17]/80 backdrop-blur-sm border rounded-lg p-6 transition-all hover:translate-y-[-4px] hover:shadow-[0_20px_40px_rgba(0,0,0,0.4)] ${
                         task.status === 'Blocked' ? 'border-rose-500/30 shadow-[0_0_25px_rgba(244,63,94,0.1)]' : 'border-white/5'
                       }`}
                     >
                        <div className="flex items-center justify-between mb-5">
                           <div className="flex flex-col gap-1">
                              <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest truncate max-w-[150px]">{task.projectName}</span>
                              <div className={`text-[7px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded-lg w-fit ${
                                 task.projectPriority === 'High' || task.projectPriority === 'Highest' ? 'bg-rose-600/20 text-rose-500' : 'bg-slate-800 text-slate-500'
                              }`}>
                                 {task.projectPriority} Priority
                              </div>
                           </div>
                           <StatusPill value={task.status} />
                        </div>
                        <h3 className="text-base font-bold text-white mb-3 leading-tight group-hover:text-blue-400 transition-colors line-clamp-2 min-h-[44px]">{task.name}</h3>
                        <div className="space-y-2 mb-6">
                           <div className="flex items-center justify-between text-[10px] font-bold">
                              <span className="text-slate-500 uppercase tracking-widest">Maturity</span>
                              <span className="text-blue-400">{task.progress}%</span>
                           </div>
                           <div className="h-1.5 bg-white/5 rounded-lg overflow-hidden border border-white/5">
                              <div 
                                className={`h-full transition-all duration-1000 ${task.status === 'Blocked' ? 'bg-rose-500' : 'bg-blue-600 shadow-[0_0_10px_rgba(37,99,235,0.5)]'}`} 
                                style={{ width: `${task.progress}%` }} 
                              />
                           </div>
                        </div>
                        <div className="flex items-center justify-between pt-5 border-t border-white/5">
                           <div className="flex items-center gap-2 text-slate-500">
                              <Calendar size={12} className={(() => {
                                 const d = parseAppDate(task.end_date);
                                 return d && differenceInDays(d, new Date()) < 3;
                              })() ? 'text-amber-500 animate-pulse' : ''} />
                              <span className={`text-[9px] font-black uppercase tracking-widest ${(() => {
                                 const d = parseAppDate(task.end_date);
                                 return d && differenceInDays(d, new Date()) < 3;
                              })() ? 'text-amber-500' : ''}`}>
                                 {format(parseAppDate(task.end_date)!, 'MMM dd')}
                              </span>
                           </div>
                           <div className="flex items-center gap-2">
                              <div className="px-2 py-1 bg-white/5 rounded-lg text-[8px] font-black text-slate-500 uppercase">
                                 {task.owner || 'Unassigned'}
                              </div>
                           </div>
                        </div>
                     </div>
                   ))}
                </div>
             ) : (
                <div className="py-60 text-center">
                   <div className="w-24 h-24 bg-blue-600/5 rounded-lg flex items-center justify-center mx-auto border border-blue-500/10 mb-8 relative">
                      <Target size={40} className="text-blue-500/10" />
                      <div className="absolute inset-0 border border-blue-500/20 rounded-lg animate-ping opacity-20" />
                   </div>
                   <h3 className="text-2xl font-black text-slate-400 uppercase tracking-tighter">Strategic Deck Clear</h3>
                   <p className="text-[11px] font-bold text-slate-600 uppercase tracking-[0.3em] mt-3">All tactical vectors have reached terminal state</p>
                </div>
             )}
          </div>
       </div>
    </div>
  )
}

const ProjectAdoptionView = ({ project, onUpdate, isEditing }: any) => {
  const [newLog, setNewLog] = useState('')
  const [newScore, setNewLogScore] = useState(5)

  const logs = useMemo(() => project?.metadata_json?.adoption_logs || [], [project])

  const handleAddLog = () => {
    if (!newLog.trim()) return
    const metadata = project?.metadata_json || {}
    const log = {
      id: Date.now(),
      content: newLog,
      score: newScore,
      author: 'Current User', // Placeholder
      timestamp: new Date().toISOString()
    }
    const updatedLogs = [log, ...logs]
    onUpdate({ ...project, metadata_json: { ...metadata, adoption_logs: updatedLogs } })
    setNewLog('')
  }

  const handleDeleteLog = (id: number) => {
    const metadata = project?.metadata_json || {}
    const updatedLogs = logs.filter((l: any) => l.id !== id)
    onUpdate({ ...project, metadata_json: { ...metadata, adoption_logs: updatedLogs } })
  }

  return (
    <div className="h-full flex flex-col p-8 space-y-10">
       <div className="flex items-center justify-between bg-emerald-600/5 p-6 rounded-lg border border-emerald-500/10">
          <div className="flex items-center gap-4">
             <div className="w-12 h-12 bg-emerald-600/10 rounded-lg flex items-center justify-center border border-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.1)]">
                <TrendingUp size={24} className="text-emerald-400" />
             </div>
             <div>
                <h2 className="text-xl font-black text-white tracking-tighter uppercase">Adoption & Utilization</h2>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mt-1">Measuring strategic reach and stakeholder impact</p>
             </div>
          </div>
          <div className="flex items-center gap-8">
             <div className="text-center">
                <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest mb-1.5">Mean Sentiment</p>
                <p className="text-2xl font-black text-emerald-500 leading-none tracking-tighter">
                   {(logs.reduce((acc: number, l: any) => acc + (l.score || 0), 0) / (logs.length || 1)).toFixed(1)}/10
                </p>
             </div>
             <div className="w-px h-10 bg-white/5" />
             <div className="text-center">
                <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest mb-1.5">Signal Count</p>
                <p className="text-2xl font-black text-white leading-none tracking-tighter">{logs.length}</p>
             </div>
          </div>
       </div>

       <div className="grid grid-cols-12 gap-10">
          <div className="col-span-4 space-y-6">
             <div className="bg-[#0d0f17] border border-white/5 rounded-lg p-6 space-y-6 shadow-2xl">
                <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-[0.3em] flex items-center gap-2">
                   <PlusCircle size={14} /> Log Adoption Signal
                </h4>
                <div className="space-y-4">
                   <div className="space-y-2">
                      <label className="text-[9px] font-bold text-slate-600 uppercase tracking-widest px-1">Engagement Level (1-10)</label>
                      <input 
                        type="range" min="1" max="10" step="1"
                        value={newScore}
                        onChange={e => setNewLogScore(parseInt(e.target.value))}
                        className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                      />
                      <div className="flex justify-between text-[9px] font-black text-slate-700">
                         <span>RESISTANT</span>
                         <span className="text-emerald-500">{newScore}</span>
                         <span>CHAMPION</span>
                      </div>
                   </div>
                   <div className="space-y-2">
                      <label className="text-[9px] font-bold text-slate-600 uppercase tracking-widest px-1">Evidence / Feedback</label>
                      <textarea 
                        value={newLog}
                        onChange={e => setNewLog(e.target.value)}
                        className="w-full h-32 bg-black/40 border border-white/10 rounded-lg p-4 text-xs font-bold text-slate-300 outline-none focus:border-emerald-500/50 resize-none transition-all leading-relaxed"
                        placeholder="Stakeholder mentioned X, system Y used for Z..."
                      />
                   </div>
                   <button 
                     onClick={handleAddLog}
                     className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-600/20"
                   >
                      Commit Adoption Signal
                   </button>
                </div>
             </div>
          </div>

          <div className="col-span-8 space-y-4">
             <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] px-1">Adoption History</h4>
             <div className="space-y-3">
                {logs.map((log: any) => (
                  <div key={log.id} className="group bg-[#0d0f17]/50 border border-white/5 rounded-lg p-5 hover:border-emerald-500/20 transition-all">
                     <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                           <div className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-tighter ${
                              log.score >= 8 ? 'bg-emerald-600/20 text-emerald-400' :
                              log.score >= 5 ? 'bg-blue-600/20 text-blue-400' : 'bg-rose-600/20 text-rose-400'
                           }`}>
                              SCORE {log.score}
                           </div>
                           <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">{log.author}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-[8px] font-bold text-slate-600 uppercase">{log.timestamp ? format(parseAppDate(log.timestamp)!, 'MMM dd, HH:mm') : 'N/A'}</span>
                          <button onClick={() => handleDeleteLog(log.id)} className="text-slate-800 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"><Trash2 size={14}/></button>
                        </div>
                     </div>
                     <p className="text-xs font-bold text-slate-300 leading-relaxed italic">"{log.content}"</p>
                  </div>
                ))}
                {logs.length === 0 && (
                  <div className="py-20 text-center border-2 border-dashed border-white/5 rounded-lg opacity-20">
                     <TrendingUp size={48} className="mx-auto mb-4" />
                     <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">No adoption metrics recorded</p>
                  </div>
                )}
             </div>
          </div>
       </div>
    </div>
  )
}

export default function Projects() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const idParam = searchParams.get('id')
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiFetch('/api/v1/projects').then(r => r.json()),
    placeholderData: (prev) => prev
  })
  
  const [selectedProjectId, setSelectedProjectId] = useState<number | 'HUDDLE' | null>(idParam ? parseInt(idParam) : 'HUDDLE')
  const hasAutoSelectedInitialProject = useRef(false)

  // Sync URL id param with selectedProjectId
  useEffect(() => {
    if (selectedProjectId && selectedProjectId !== 'HUDDLE') {
        if (searchParams.get('id') !== String(selectedProjectId)) {
            setSearchParams({ id: String(selectedProjectId) })
        }
    } else {
        if (searchParams.has('id')) setSearchParams({})
    }
  }, [selectedProjectId, setSearchParams, searchParams])


  const reorderMutation = useMutation({
    mutationFn: (newOrder: any[]) => apiFetch('/api/v1/projects/reorder', {
      method: 'POST',
      body: JSON.stringify(newOrder.map((p, i) => ({ id: p.id, order_index: i })))
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  const handleReorder = (newOrder: any[]) => {
    queryClient.setQueryData(['projects'], newOrder)
    reorderMutation.mutate(newOrder)
  }

  const sortedProjects = useMemo(() => {
    if (!projects) return []
    return [...projects].sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
  }, [projects])
  const { data: devices } = useQuery({ queryKey: ['devices'], queryFn: () => apiFetch('/api/v1/devices').then(r => r.json()) })
  const { data: services } = useQuery({ queryKey: ['logical-services'], queryFn: () => apiFetch('/api/v1/logical-services').then(r => r.json()) })
  const { data: options } = useQuery({ queryKey: ['settings-options'], queryFn: () => apiFetch('/api/v1/settings/options').then(r => r.json()) })
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => apiFetch('/api/v1/settings/operators').then(r => r.json()) })
  const [activeTab, setActiveTab] = useState<'WORKSPACE' | 'GANTT' | 'ACTIVITY' | 'ADOPTION'>('WORKSPACE')
  const [isGlobalEditing, setIsGlobalEditing] = useState(false)
  const [draftProject, setDraftProject] = useState<any>(null)
  const [pendingNav, setPendingNav] = useState<any>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isLedgerCollapsed, setIsLedgerCollapsed] = useState(false)
  const [railWidth, setRailWidth] = useState(320)
  const [ledgerWidth, setLedgerWidth] = useState(380)

  const syncSelectedProject = useCallback((id: number | 'HUDDLE' | null) => {
    setSelectedProjectId(id)
    const nextParams = new URLSearchParams(searchParams)
    if (typeof id === 'number') nextParams.set('id', String(id))
    else nextParams.delete('id')
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (idParam && projects) {
       const targetId = parseInt(idParam)
       if (projects.find((p: any) => p.id === targetId)) {
          setSelectedProjectId(targetId)
       }
    }
  }, [idParam, projects])

  useEffect(() => {
    if (!projects?.length || hasAutoSelectedInitialProject.current) return
    hasAutoSelectedInitialProject.current = true
    if (selectedProjectId === 'HUDDLE' && !idParam) {
      // Select the latest project once on first load, but preserve an operator's later Huddle selection.
      const latest = [...projects].sort((a, b) => (parseAppDate(b.created_at)?.getTime() || 0) - (parseAppDate(a.created_at)?.getTime() || 0))[0]
      if (latest) syncSelectedProject(latest.id)
    }
  }, [projects, idParam, selectedProjectId, syncSelectedProject])

  const selectedProject = useMemo(() => {
    if (selectedProjectId === 'HUDDLE') return null
    return projects?.find((p:any) => p.id === selectedProjectId)
  }, [projects, selectedProjectId])

  const isDirty = useMemo(() => {
    if (!isGlobalEditing || !draftProject || !selectedProject) return false
    return JSON.stringify(draftProject) !== JSON.stringify(selectedProject)
  }, [isGlobalEditing, draftProject, selectedProject])

  usePageLeaveGuard(isDirty)

  const mutation = useMutation({
    mutationFn: async ({ data, silent }: { data: any, silent?: boolean }) => {
      const isNew = !data.id
      const res = await apiFetch(isNew ? '/api/v1/projects' : `/api/v1/projects/${data.id}`, {
        method: isNew ? 'POST' : 'PUT',
        body: JSON.stringify(data)
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      if (!variables.silent) {
        setIsGlobalEditing(false)
        setDraftProject(null)
        toast.success('Strategic Matrix Synchronized')
      }
      if (!selectedProjectId) syncSelectedProject(data.id)
    },
    onError: (e: any) => toast.error(e.message)
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiFetch(`/api/v1/projects/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      return id
    },
    onSuccess: (deletedId) => {
      const currentProjects = (queryClient.getQueryData(['projects']) as any[]) || []
      const sorted = [...currentProjects].sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
      const currentIndex = sorted.findIndex(p => p.id === deletedId)
      const remainingProjects = currentProjects.filter((project: any) => project.id !== deletedId)
      
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      
      if (selectedProjectId === deletedId) {
        let nextToSelect: any = null
        if (sorted.length > 1) {
          if (currentIndex !== -1 && currentIndex < sorted.length - 1) {
            nextToSelect = sorted[currentIndex + 1]
          } else if (currentIndex > 0) {
            nextToSelect = sorted[currentIndex - 1]
          }
        }
        syncSelectedProject(nextToSelect?.id || remainingProjects[0]?.id || 'HUDDLE')
      }
      setPendingNav(null)
      toast.success('Project Decommissioned')
    },
    onError: (e: any) => toast.error(e.message)
  })

  const requestTabChange = (tab: any) => {
    if (isDirty) setPendingNav({ type: 'TAB', id: tab })
    else setActiveTab(tab)
  }

  const requestProjectChange = (id: number | 'HUDDLE') => {
    if (id === 'HUDDLE') hasAutoSelectedInitialProject.current = true
    if (isDirty) setPendingNav({ type: 'PROJECT', id })
    else {
      syncSelectedProject(id)
      setIsGlobalEditing(false)
      setDraftProject(null)
    }
  }

  const confirmNav = () => {
    if (!pendingNav) return
    if (pendingNav.type === 'TAB') {
      setActiveTab(pendingNav.id)
      setIsGlobalEditing(false)
      setDraftProject(null)
    } else if (pendingNav.type === 'PROJECT') {
      syncSelectedProject(pendingNav.id)
      setIsGlobalEditing(false)
      setDraftProject(null)
    } else if (pendingNav.type === 'DELETE') {
      deleteMutation.mutate(pendingNav.id)
    }
    setPendingNav(null)
  }

  const toggleFullScreen = () => {
    const next = !isFullScreen
    setIsFullScreen(next)
    setIsSidebarCollapsed(next)
    setIsLedgerCollapsed(next)
  }

  const handleUpdate = (updated: any) => {
    if (isGlobalEditing) {
      setDraftProject(updated)
    } else {
      mutation.mutate({ data: updated, silent: true })
    }
  }

  if (isLoading && !projects) return <div className="h-full flex items-center justify-center bg-[#0a0c14]"><div className="flex flex-col items-center gap-4"><div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"/><p className="text-[10px] font-bold text-blue-400 uppercase tracking-[0.3em]">Synchronizing Matrix...</p></div></div>

  return (
    <div className="h-full flex flex-col bg-[#0a0c14] overflow-hidden rounded-lg border border-white/5 shadow-2xl transition-all duration-500">
       <ProjectHUD 
         project={isGlobalEditing ? draftProject : selectedProject} 
         isEditing={isGlobalEditing}
         isDirty={isDirty}
         onEdit={() => { setDraftProject({ ...selectedProject }); setIsGlobalEditing(true); }}
         onSave={() => mutation.mutate({ data: draftProject })}
         onCancel={() => { setIsGlobalEditing(false); setDraftProject(null); }}
         onDelete={() => setPendingNav({ type: 'DELETE', id: selectedProjectId })}
         onSettings={() => setShowConfig(true)}
         isSaving={mutation.isPending}
       />

       <div className="h-12 border-b border-white/5 bg-[#0a0c14] flex items-center px-6 justify-between shrink-0">
          <div className="flex items-center h-full">
             {[
               { id: 'WORKSPACE', icon: Target, label: 'Workbench' }, 
               { id: 'GANTT', icon: Calendar, label: 'Precision Gantt' }, 
               { id: 'ACTIVITY', icon: History, label: 'Stream' },
               { id: 'ADOPTION', icon: TrendingUp, label: 'Adoption' }
             ].map(tab => (
               <button
                 key={tab.id}
                 onClick={() => requestTabChange(tab.id as any)}
                 aria-label={tab.id === 'ACTIVITY' ? 'Activity' : undefined}
                 className={`h-full px-6 flex items-center gap-2 border-b-2 transition-all ${activeTab === tab.id ? 'border-blue-600 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
               >
                  <tab.icon size={14} /><span className="text-[10px] font-bold uppercase tracking-widest">{tab.label}</span>
               </button>
             ))}
          </div>

          <div className="flex items-center gap-2">
             <button 
               onClick={() => setShowConfig(true)}
               className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-slate-500 transition-all border border-white/5"
               title="Project Configuration"
             >
                <Settings size={16} />
             </button>
             <button 
               onClick={toggleFullScreen}
               className={`p-1.5 rounded-lg transition-all border ${isFullScreen ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20' : 'bg-white/5 border-white/10 text-slate-500 hover:text-white hover:bg-white/10'}`}
               title={isFullScreen ? "Exit Full Screen" : "Full Screen View"}
             >
                <Maximize2 size={16} />
             </button>
             <div className="w-px h-4 bg-white/10 mx-1" />
             <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <span className="text-[8px] font-bold text-slate-600 uppercase tracking-widest">Operational</span>
             </div>
          </div>
       </div>

       <div className="flex-1 flex overflow-hidden">
          <ProjectRail 
            projects={projects || []} 
            selectedId={selectedProjectId} 
            onSelect={requestProjectChange} 
            onReorder={handleReorder}
            onNew={() => { syncSelectedProject(null); setIsGlobalEditing(true); setDraftProject({ name: 'New Strategic Vector', type: '', status: 'Planning', priority: 'Medium' }); }}
            onDelete={(id:number) => setPendingNav({ type: 'DELETE', id })}
            width={railWidth} onResize={setRailWidth} isCollapsed={isSidebarCollapsed} onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          />
          <div className="flex-1 flex flex-col min-w-0 bg-[#0f111a] shadow-[inset_0_0_100px_rgba(0,0,0,0.3)]">
             <div className="flex-1 overflow-hidden relative">
                <AnimatePresence mode="wait">
                   {selectedProjectId === 'HUDDLE' ? (
                     <motion.div key="huddle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
                        <DailyHuddleView projects={projects} users={users} />
                     </motion.div>
                   ) : (
                      <>
                        {selectedProjectId === null && isGlobalEditing ? (
                          <motion.div key="new-project" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full p-10 overflow-y-auto custom-scrollbar">
                             <ProjectForm 
                               initialData={draftProject}
                               onSave={(data: any) => mutation.mutate({ data })}
                               isSaving={mutation.isPending}
                               onCancel={() => { setIsGlobalEditing(false); setDraftProject(null); syncSelectedProject('HUDDLE'); }}
                               devices={devices}
                               services={services}
                               options={options}
                             />
                          </motion.div>
                        ) : !selectedProject ? (
                          <div className="h-full flex items-center justify-center">
                             <div className="text-center space-y-4">
                                <div className="w-16 h-16 bg-white/5 rounded-lg flex items-center justify-center mx-auto border border-white/10">
                                   <Search size={24} className="text-slate-700" />
                                </div>
                                <p className="text-[10px] font-black text-slate-700 uppercase tracking-[0.3em] italic font-inter">Select a strategic vector from the rail</p>
                             </div>
                          </div>
                        ) : (
                          <>
                            {activeTab === 'WORKSPACE' && (
                              <motion.div key={`workspace-${selectedProjectId}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full p-10 overflow-y-auto custom-scrollbar bg-[#0a0c14]/30 backdrop-blur-sm">
                                 <WorkbenchView 
                                   key={selectedProjectId}
                                   project={isGlobalEditing ? draftProject : selectedProject} 
                                   onUpdate={handleUpdate} 
                                   isEditing={isGlobalEditing}
                                   devices={devices || []}
                                   services={services || []}
                                   options={options || []}
                                   users={users || []}
                                 />
                              </motion.div>
                            )}
                            {activeTab === 'GANTT' && <motion.div key="gantt" className="h-full"><PrecisionGantt project={{...selectedProject, isUpdating: mutation.isPending}} onUpdate={(data: any) => mutation.mutate({ data, silent: true })} /></motion.div>}
                            {activeTab === 'ACTIVITY' && <motion.div key="activity" className="h-full"><ProjectActivityStream project={selectedProject} allProjects={projects || []} /></motion.div>}
                            {activeTab === 'ADOPTION' && (
                              <motion.div key={`adoption-${selectedProjectId}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-y-auto custom-scrollbar">
                                 <ProjectAdoptionView project={isGlobalEditing ? draftProject : selectedProject} onUpdate={handleUpdate} isEditing={isGlobalEditing} />
                              </motion.div>
                            )}
                          </>
                        )}
                      </>
                   )}
                </AnimatePresence>
             </div>
          </div>
          <ProjectLedger 
            project={isGlobalEditing ? draftProject : selectedProject} 
            width={ledgerWidth} 
            onResize={setLedgerWidth} 
            isCollapsed={isLedgerCollapsed} 
            onToggleCollapse={() => setIsLedgerCollapsed(!isLedgerCollapsed)}
            isEditing={isGlobalEditing}
            onUpdate={handleUpdate}
          />
       </div>

       {/* Confirmation Modals */}
       <AnimatePresence>
         {pendingNav && (
           <ConfirmationModal 
             isOpen={true} 
             title={pendingNav.type === 'DELETE' ? "Decommission Strategic Stream" : "Unsaved Strategic Data"} 
             message={pendingNav.type === 'DELETE' ? "Are you certain? This action permanently removes all milestones and ROI data." : "You have uncommitted changes in the strategic matrix. Leaving now will discard these updates."}
             onConfirm={confirmNav} 
             onClose={() => setPendingNav(null)} 
             variant={pendingNav.type === 'DELETE' ? "danger" : "info"}
             confirmText={pendingNav.type === 'DELETE' ? "Decommission" : "Discard Changes"}
           />
         )}
       </AnimatePresence>

       <ConfigRegistryModal
         isOpen={showConfig}
         onClose={() => setShowConfig(false)}
         title="Project Configuration"
         sections={[
             { title: "Project Types", category: "ProjectType", icon: Layers }
         ]}
       />

       <style>{`
         .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; } 
         .custom-scrollbar::-webkit-scrollbar-track { background: transparent; } 
         .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.05); border-radius: 10px; } 
         .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.1); }
       `}</style>
    </div>
  )
}
