
import React, { useState } from 'react'
import { Monitor, Share, FileText, MessageSquare, Globe, Clock, Zap, ExternalLink, Info, Zap as ZapIcon, Code, ChevronUp, ChevronDown, Users, Briefcase, UserCheck, AlertCircle, Shield, BookOpen, User } from 'lucide-react'
import { WorkspaceModal } from '../shared/WorkspaceModal'
import { 
  WorkspaceSplitView, 
  WorkspaceEmptyState,
  useEscapeDismiss, 
  useBodyModalFlag 
} from '../shared/OperationalWorkspacePrimitives'
import { StatusPill } from '../shared/StatusPill'
import { apiFetch } from '../../api/apiClient'
import { useQuery } from '@tanstack/react-query'


export function BkmDetailModal({ bkmId, monitorId, onClose }: any) {
  useEscapeDismiss(onClose)
  useBodyModalFlag()
  const [isMaximized, setIsMaximized] = useState(false)
  const { data: bkm, isLoading } = useQuery({
    queryKey: ['knowledge-entry', bkmId, 'monitoring', monitorId],
    queryFn: async () => (await apiFetch(`/api/v1/knowledge/${bkmId}?embedded_consumer=monitoring&monitoring_id=${monitorId}`)).json(),
    enabled: !!bkmId
  })

  return (
    <WorkspaceModal
      isOpen={true}
      onClose={onClose}
      size="workspace"
      isMaximized={isMaximized}
      onMaximizeToggle={() => setIsMaximized(!isMaximized)}
      title={bkm?.title || 'Loading Document...'}
      subtitle={`BKM ID: KB-${bkmId}`}
      icon={<BookOpen size={20} />}
    >
      <div className="space-y-6">
        {isLoading ? (
          <div className="py-40 flex flex-col items-center justify-center space-y-4">
             <Clock size={32} className="text-amber-500 animate-spin" />
             <span className="text-[10px] font-black uppercase text-amber-500 tracking-widest animate-pulse">Retrieving Knowledge...</span>
          </div>
        ) : (
          <>
             <div className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-8 shadow-inner">
                <h4 className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-3 flex items-center space-x-2">
                   <Zap size={12}/> <span>Executive Summary</span>
                </h4>
                <p className="text-[13px] font-bold text-slate-200 leading-[1.8] whitespace-pre-wrap">{bkm?.content || 'No content provided.'}</p>
             </div>

             {bkm?.content_json?.steps?.length > 0 && (
               <div className="space-y-4">
                  <h4 className="text-[11px] font-black text-white uppercase tracking-[0.2em] border-l-2 border-amber-500 pl-4">Resolution Workflow</h4>
                  <div className="space-y-4 pl-4">
                     {bkm.content_json.steps.map((step: any, i: number) => (
                        <div key={`${i}-${bkmId}`} className="flex space-x-6 relative">
                           {i < bkm.content_json.steps.length - 1 && <div className="absolute left-5 top-10 bottom-0 w-0.5 bg-white/5" />}
                           <div className="w-10 h-10 rounded-lg bg-slate-800 border border-white/10 flex items-center justify-center flex-shrink-0 z-10 text-[12px] font-black text-amber-500 shadow-lg">
                              {i + 1}
                           </div>
                           <div className="bg-black/20 border border-white/5 rounded-lg p-5 flex-1 hover:border-amber-500/20 transition-all">
                              <h5 className="text-[11px] font-black uppercase text-slate-200 mb-1">{step.title}</h5>
                              <p className="text-[12px] text-slate-400 font-bold leading-relaxed">{step.description}</p>
                           </div>
                        </div>
                     ))}
                  </div>
               </div>
             )}
             
             <div className="flex items-center justify-between px-1 border-t border-white/5 pt-6 mt-6">
                <div className="flex items-center space-x-3">
                   <div className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center text-slate-500 border border-white/5">
                      <User size={16}/>
                   </div>
                   <div>
                      <p className="text-[10px] font-black text-white">Operational Kernel</p>
                      <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Knowledge Custodian</p>
                   </div>
                </div>
                <div className="text-right">
                   <p className="text-[9px] font-black text-slate-600 uppercase tracking-[0.2em]">Validated Protocol</p>
                   <p className="text-[8px] font-bold text-slate-700 mt-1">Trace: KNOWLEDGE-SYS-772</p>
                </div>
             </div>
          </>
        )}
      </div>
    </WorkspaceModal>
  )
}
