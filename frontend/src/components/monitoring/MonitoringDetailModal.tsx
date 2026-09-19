import React, { useState, useEffect, useMemo } from 'react'
import { Monitor, ArrowRightLeft, FileText, MessageSquare, Globe, Clock, Zap, ExternalLink, Info, Zap as ZapIcon, Code, ChevronUp, ChevronDown, Users, Briefcase, UserCheck, AlertCircle, Shield, Terminal } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { apiFetch } from '../../api/apiClient'
import { WorkspaceSplitView, WorkspaceEmptyState, useEscapeDismiss, useBodyModalFlag } from '../shared/OperationalWorkspacePrimitives'
import { WorkspaceModal } from '../shared/WorkspaceModal'
import { WorkspaceDossierShell } from '../shared/WorkspaceModalShells'
import { ToolbarButton } from '../shared/LayoutPrimitives'
import { StatusPill } from '../shared/StatusPill'
import { WorkspaceShareHeader } from '../shared/WorkspaceShareHeader'

interface MonitoringLogicEntry {
  id: number
  type: 'Threshold' | 'Regex' | 'Query' | 'Health Check' | 'Log Pattern' | 'Synthetic' | 'Custom'
  description: string
  logic_info: string
}

export function MonitoringDetailModal({ item, onClose, onEdit, onOpenHistory, onOpenBkm, onDelete, onOpenAsset, onOpenKnowledge, deleteConfirm }: any) {
  useEscapeDismiss(onClose)
  useBodyModalFlag()
  const [isMaximized, setIsMaximized] = useState(false)
  const [expandedLogic, setExpandedLogic] = useState<number | null>(item.logic_json?.[0]?.id || null)
  const [showLineNumbers, setShowLineNumbers] = useState(true)
  const [interventionDoc, setInterventionDoc] = useState<any>(null)

  const { data: suggestedKnowledge } = useQuery({
    queryKey: ['monitoring-knowledge-suggestions', item.id, item.device_id],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.append('monitoring_id', String(item.id))
      params.append('embedded_consumer', 'monitoring')
      const response = await apiFetch(`/api/v1/knowledge?${params.toString()}`)
      const linked = await response.json()
      if (Array.isArray(linked) && linked.length > 0) return linked
      return linked
    }
  })

  return (
    <>
    <WorkspaceModal
      isOpen={true}
      onClose={onClose}
      size="workspace"
      isMaximized={isMaximized}
      onMaximizeToggle={() => setIsMaximized(!isMaximized)}
      title={
        <div className="flex items-center gap-3">
          <span>{item.title}</span>
          <WorkspaceShareHeader id={String(item.id)} title={item.title} />
        </div>
      }
      subtitle={`Monitor ID: ${item.id} · ${item.device_name || 'No Target Asset'}`}
      icon={<Monitor size={20} />}
      forensicLineage={{ createdAt: item.created_at, updatedAt: item.updated_at }}
      status={
        <div className="flex items-center gap-2">
          <StatusPill value={item.status} />
          <StatusPill value={item.severity} />
          <div className="h-3 w-px bg-white/10 mx-1" />
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest whitespace-nowrap">
            {item.platform || 'No platform'} · {item.check_interval ? `${item.check_interval}s checks` : 'No frequency'}
          </span>
        </div>
      }
      footerRight={
        <div className="flex items-center gap-3">
            <ToolbarButton onClick={() => onEdit?.(item)}>Edit Monitor</ToolbarButton>
            <ToolbarButton onClick={() => onOpenHistory?.(item)}>History</ToolbarButton>
            <ToolbarButton onClick={() => onOpenBkm?.(item)}>Recovery</ToolbarButton>
            <ToolbarButton 
              variant="danger" 
              onClick={() => {
                if (deleteConfirm) {
                  onDelete?.(item);
                } else {
                  onDelete?.(item);
                }
              }}
              className={`${deleteConfirm ? 'animate-pulse bg-rose-600 border-rose-500 text-white shadow-lg shadow-rose-500/20' : ''} whitespace-nowrap`}
            >
              {deleteConfirm 
                ? (item.is_deleted ? 'Confirm Purge?' : 'Confirm Archive?') 
                : (item.is_deleted ? 'Purge' : 'Archive')}
            </ToolbarButton>
        </div>
      }
    >
      <WorkspaceDossierShell
          body={
           <WorkspaceSplitView
             className="gap-8"
             sidebar={<div className="space-y-8">
                 <section className="space-y-3">
                    <h3 className="px-1 text-[11px] font-black text-slate-500 uppercase tracking-widest">Target scope</h3>
                    <div className="space-y-3">
                       <button
                         disabled={!item.device_id}
                         onClick={() => item.device_id && onOpenAsset?.(item.device_id)}
                         className="w-full rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 text-left transition-all hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-30 shadow-inner group"
                       >
                         <div className="flex items-center justify-between mb-2">
                            <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest">Registry asset</p>
                            <ArrowRightLeft size={10} className="text-blue-500/50 group-hover:translate-x-1 transition-transform" />
                         </div>
                         <p className="text-[11px] font-black text-slate-100">{item.device_name || 'No linked asset'}</p>
                       </button>
                       
                       <div className="bg-black/20 border border-white/5 rounded-lg p-4 shadow-inner space-y-3">
                          <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Monitored services</p>
                          <div className="flex flex-wrap gap-1.5">
                             {item.monitored_service_names?.map((name: string, i: number) => (
                               <span key={`${i}-${item.id}`} className="bg-blue-600/10 border border-blue-500/20 text-blue-300 px-2 py-0.5 rounded-lg text-[9px] font-bold">
                                  {name}
                               </span>
                             ))}
                             {(!item.monitored_service_names || item.monitored_service_names.length === 0) && (
                               <span className="text-[9px] font-bold text-slate-700 italic">No services mapped</span>
                             )}
                          </div>
                       </div>
                    </div>
                 </section>

                 <section className="space-y-3">
                    <h3 className="px-1 text-[11px] font-black text-slate-500 uppercase tracking-widest">Recovery protocol</h3>
                    <div className="space-y-2">
                       {item.recovery_doc_details?.map((doc: any, i: number) => (
                         <button
                           key={`${i}-${item.id}`}
                           type="button"
                           onClick={() => doc.note ? setInterventionDoc(doc) : onOpenKnowledge?.(doc.id)}
                           className="w-full bg-slate-900/60 border border-white/5 rounded-lg p-3 flex items-center space-x-3 hover:border-amber-500/30 transition-all cursor-pointer group text-left shadow-inner"
                         >
                            <div className="p-1.5 bg-black/40 rounded-lg text-amber-500 group-hover:bg-amber-500 group-hover:text-white transition-all"><FileText size={14}/></div>
                            <div className="min-w-0 flex-1">
                               <p className="text-[11px] font-bold text-slate-300 tracking-tight leading-tight group-hover:text-white truncate">{doc.title}</p>
                               <div className="flex items-center justify-between mt-0.5">
                                  <p className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Procedure {i+1}</p>
                                  {doc.note && (
                                     <div className="flex items-center gap-1 text-blue-500/60">
                                        <MessageSquare size={8} />
                                        <span className="text-[8px] font-black uppercase tracking-widest">Note attached</span>
                                     </div>
                                  )}
                               </div>
                            </div>
                         </button>
                       ))}
                       {(!item.recovery_doc_details || item.recovery_doc_details.length === 0) && (
                         <WorkspaceEmptyState compact icon={<AlertCircle size={18} />} title="No procedures linked" description="Guaranteed operational response protocol missing." />
                       )}
                    </div>
                 </section>

                 <section className="space-y-3">
                    <h3 className="px-1 text-[11px] font-black text-slate-500 uppercase tracking-widest">Operational meta</h3>
                    <div className="bg-white/5 border border-white/5 rounded-lg overflow-hidden divide-y divide-white/5 shadow-inner">
                       {[
                          { label: 'Platform', value: item.platform, color: 'text-blue-400', icon: Globe },
                          { label: 'Frequency', value: `${item.check_interval}s`, color: 'text-slate-300', icon: Clock },
                          { label: 'Throttle', value: `${item.notification_throttle}s`, color: 'text-amber-400', icon: Zap }
                       ].map((stat, i) => (
                          <div key={`${i}-${item.id}`} className="p-3 flex items-center justify-between hover:bg-white/5 transition-all">
                             <div className="flex items-center gap-3">
                                <div className="p-1.5 bg-black/40 rounded-lg text-slate-600">
                                   <stat.icon size={12} />
                                </div>
                                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{stat.label}</span>
                             </div>
                             <span className={`text-[10px] font-black ${stat.color}`}>{stat.value}</span>
                          </div>
                       ))}
                    </div>
                 </section>

                 {item.monitoring_url && (
                    <button 
                       onClick={() => window.open(item.monitoring_url, '_blank')}
                       className="w-full bg-blue-600 hover:bg-blue-500 text-white p-4 rounded-lg font-black uppercase tracking-widest text-[10px] transition-all shadow-xl shadow-blue-500/20 flex items-center justify-center space-x-3"
                    >
                       <ExternalLink size={14} />
                       <span>Open platform console</span>
                    </button>
                 )}
             </div>}
             main={<div className="space-y-8">
                 <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-white/[0.03] border border-white/5 rounded-lg p-5 group hover:border-white/10 transition-all shadow-inner">
                       <div className="flex items-center gap-3 mb-3">
                          <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg"><Info size={14}/></div>
                          <h4 className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Operational Purpose</h4>
                       </div>
                       <p className="text-[12px] font-bold text-slate-400 leading-relaxed pl-1">
                          {item.purpose || 'No purpose defined.'}
                       </p>
                    </div>
                    <div className="bg-white/[0.03] border border-white/5 rounded-lg p-5 group hover:border-white/10 transition-all shadow-inner">
                       <div className="flex items-center gap-3 mb-3">
                          <div className="p-2 bg-rose-500/10 text-rose-400 rounded-lg"><ZapIcon size={14}/></div>
                          <h4 className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Failure Impact</h4>
                       </div>
                       <p className="text-[12px] font-bold text-slate-400 leading-relaxed pl-1">
                          {item.impact || 'No impact analysis defined.'}
                       </p>
                    </div>
                 </section>

                 <section className="space-y-4">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-3">
                         <div className="p-2 bg-slate-800 text-slate-400 rounded-lg"><Code size={16} /></div>
                         <h3 className="text-[11px] font-black text-white uppercase tracking-[0.2em]">Logic Specification</h3>
                      </div>
                      <button 
                         onClick={() => setShowLineNumbers(!showLineNumbers)}
                         className={`text-[8px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border transition-all ${showLineNumbers ? 'bg-blue-600/20 border-blue-500/50 text-blue-400' : 'bg-slate-800 border-white/5 text-slate-500'}`}
                      >
                         {showLineNumbers ? 'Line Numbers: ON' : 'Line Numbers: OFF'}
                      </button>
                    </div>
                    <div className="space-y-3">
                       {item.logic_json?.map((log: any) => (
                         <div key={`${log.id}-${item.id}`} className="bg-[#0f172a] border border-white/5 rounded-lg overflow-hidden transition-all hover:border-white/10 shadow-lg">
                            <button 
                               onClick={() => setExpandedLogic(expandedLogic === log.id ? null : log.id)}
                               className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-all group"
                            >
                               <div className="flex items-center space-x-4">
                                  <span className="text-[8px] font-black text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/20 uppercase tracking-widest">{log.type}</span>
                                  <span className="text-slate-300 font-bold text-[11px] tracking-tight group-hover:text-white transition-colors">{log.description}</span>
                               </div>
                               {expandedLogic === log.id ? <ChevronUp size={16} className="text-slate-600" /> : <ChevronDown size={16} className="text-slate-600" />}
                            </button>
                            <AnimatePresence>
                               {expandedLogic === log.id && (
                                 <motion.div 
                                    initial={{ height: 0, opacity: 0 }} 
                                    animate={{ height: 'auto', opacity: 1 }} 
                                    exit={{ height: 0, opacity: 0 }} 
                                    className="overflow-hidden bg-black/40 border-t border-white/5"
                                 >
                                    <div className="flex font-mono text-[11px] leading-relaxed overflow-x-auto custom-scrollbar">
                                       {showLineNumbers && (
                                          <div className="bg-white/5 border-r border-white/10 px-3 py-5 text-slate-700 text-right select-none whitespace-pre min-w-[40px]">
                                             {log.logic_info.split('\n').map((_: any, i: number) => i + 1).join('\n')}
                                          </div>
                                       )}
                                       <pre className="p-5 text-emerald-400 flex-1 selection:bg-emerald-500/20">
                                          {log.logic_info}
                                       </pre>
                                    </div>
                                 </motion.div>
                               )}
                            </AnimatePresence>
                         </div>
                       ))}
                       {(!item.logic_json || item.logic_json.length === 0) && (
                         <WorkspaceEmptyState icon={<Terminal size={32} />} title="No logic specification found" description="This monitor has no active logic entries defined." />
                       )}
                    </div>
                 </section>

                 <section className="space-y-4">
                    <div className="flex items-center gap-3 px-1">
                       <div className="p-2 bg-blue-600/10 text-blue-400 rounded-lg"><Users size={16} /></div>
                       <h3 className="text-[11px] font-black text-white uppercase tracking-[0.2em]">Ownership Matrix</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                       <div className="bg-white/[0.03] border border-white/5 rounded-lg p-5 shadow-inner">
                          <h4 className="text-[10px] font-black text-slate-500 mb-3 uppercase tracking-widest">Primary Team Mapping</h4>
                          <div className="flex items-center gap-3">
                             <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                                <Briefcase size={14} />
                             </div>
                             <p className="text-[12px] font-black text-slate-200">{item.owner_team || 'Unassigned'}</p>
                          </div>
                       </div>
                       <div className="bg-white/[0.03] border border-white/5 rounded-lg p-5 shadow-inner">
                          <h4 className="text-[10px] font-black text-slate-500 mb-3 uppercase tracking-widest">Assigned Personnel</h4>
                          <div className="flex flex-wrap gap-2">
                             {item.owners?.map((o: any, i: number) => (
                               <div key={`${i}-${o.operator_id}`} className="bg-blue-600/10 border border-blue-500/20 text-blue-300 px-3 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-2">
                                  <UserCheck size={10} className="text-blue-500" />
                                  <span>{o.name} <span className="text-slate-500 font-normal ml-1">[{o.role}]</span></span>
                               </div>
                             ))}
                             {(!item.owners || item.owners.length === 0) && (
                               <div className="flex items-center gap-2 text-slate-600 py-1">
                                  <AlertCircle size={12} />
                                  <span className="text-[10px] font-black uppercase tracking-widest">No individual owners assigned</span>
                               </div>
                             )}
                          </div>
                       </div>
                    </div>
                 </section>
             </div>}
           />
        }
      />
    </WorkspaceModal>

    <AnimatePresence>
       {interventionDoc && (
          <WorkspaceModal
            isOpen={true}
            onClose={() => setInterventionDoc(null)}
            size="compact"
            title="Operational Guidance"
            subtitle={`Pre-recovery briefing for: ${interventionDoc.title}`}
            icon={<Shield size={20} className="text-amber-500" />}
            footerRight={
               <div className="flex items-center gap-3">
                  <ToolbarButton onClick={() => setInterventionDoc(null)}>Cancel</ToolbarButton>
                  <ToolbarButton 
                    variant="primary" 
                    onClick={() => {
                       const id = interventionDoc.id;
                       setInterventionDoc(null);
                       onOpenKnowledge?.(id);
                    }}
                  >
                     Confirm & Open Procedure
                  </ToolbarButton>
               </div>
            }
          >
             <div className="space-y-6 pt-2">
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-5 shadow-inner">
                   <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-black/40 rounded-lg text-amber-500"><MessageSquare size={16} /></div>
                      <h4 className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Operator Note</h4>
                   </div>
                   <p className="text-[12px] font-bold text-slate-200 leading-relaxed italic">
                      "{interventionDoc.note}"
                   </p>
                </div>
                
                <div className="flex items-start gap-4 px-1">
                   <div className="mt-1 p-1.5 bg-blue-500/10 rounded-full text-blue-400"><Info size={12} /></div>
                   <div className="flex-1">
                      <p className="text-[10px] font-bold text-slate-400 leading-relaxed">
                         The following procedure contains verified restoration steps. Please ensure you have read the guidance note above carefully before initiating recovery.
                      </p>
                   </div>
                </div>
             </div>
          </WorkspaceModal>
       )}
    </AnimatePresence>
    </>
  )
}
