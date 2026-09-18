
import React, { useState, useEffect, useMemo } from 'react'
import { Monitor, X, Plus, Search, BookOpen, Clock, Trash2, MessageSquare, ExternalLink } from 'lucide-react'
import { WorkspaceModal } from '../shared/WorkspaceModal'
import { 
  WorkspaceSplitView, 
  WorkspaceEmptyState,
  useBodyModalFlag 
} from '../shared/OperationalWorkspacePrimitives'
import { ToolbarButton } from '../shared/LayoutPrimitives'
import { StatusPill } from '../shared/StatusPill'
import { apiFetch } from '../../api/apiClient'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MonitoringRecoveryDoc } from '../MonitoringGrid'
import { showWorkspaceToast } from '../shared/WorkspaceToast'
import { formatAppDate } from '../../utils/dateUtils'


export function BkmListModal({
  docs,
  monitorId,
  onOpenBkm,
  onOpenKnowledge,
  onClose,
}: {
  docs: any[]
  monitorId: number
  onOpenBkm: (id: number) => void
  onOpenKnowledge: (id: number) => void
  onClose: () => void
}) {
  useBodyModalFlag()
  const [isMaximized, setIsMaximized] = useState(false)
  const queryClient = useQueryClient()
  const [recoverySearch, setRecoverySearch] = useState('')
  const [isAdding, setIsAdding] = useState(false)

  // Normalize incoming docs to rich format immediately
  const normalizedDocs = useMemo(() => {
    return (docs || []).map(d => {
      if (typeof d === 'number') return { id: d, note: '', added_at: new Date().toISOString() }
      if (typeof d === 'object' && d !== null) return { id: Number(d.id), note: d.note || '', added_at: d.added_at }
      return null
    }).filter(Boolean) as MonitoringRecoveryDoc[]
  }, [docs])

  const [linkedDocs, setLinkedDocs] = useState<MonitoringRecoveryDoc[]>(normalizedDocs)
  const [savedDocs, setSavedDocs] = useState<MonitoringRecoveryDoc[]>(normalizedDocs)

  useEffect(() => {
    setLinkedDocs(normalizedDocs)
    setSavedDocs(normalizedDocs)
  }, [normalizedDocs])

  const { data: knowledgeEntries } = useQuery({
    queryKey: ['knowledge-entries', 'monitoring', monitorId],
    queryFn: async () => (await apiFetch(`/api/v1/knowledge/?embedded_consumer=monitoring&monitoring_id=${monitorId}`)).json()
  })

  const filteredKnowledge = useMemo(() => {
    if (!knowledgeEntries) return []
    const linkedIds = linkedDocs.map(d => d.id)
    return knowledgeEntries.filter((e: any) => 
      (e.title.toLowerCase().includes(recoverySearch.toLowerCase()) ||
      e.category.toLowerCase().includes(recoverySearch.toLowerCase())) &&
      !linkedIds.includes(e.id)
    )
  }, [knowledgeEntries, recoverySearch, linkedDocs])

  const mutation = useMutation({
    mutationFn: async (nextDocs: MonitoringRecoveryDoc[]) => {
      const res = await apiFetch(`/api/v1/monitoring/${monitorId}`, {
        method: 'PUT',
        body: JSON.stringify({
          recovery_docs: nextDocs.map((doc) => ({ id: doc.id, note: doc.note || null }))
        })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || 'Failed to update recovery procedures')
      }
      return res.json()
    },
    onSuccess: (data: any) => {
      setSavedDocs(linkedDocs)
      queryClient.invalidateQueries({ queryKey: ['monitoring-items'] })
      queryClient.invalidateQueries({ queryKey: ['monitoring-history', monitorId] })
      showWorkspaceToast('Synchronized recovery procedures', { type: 'success' })
    },
    onError: (e: any) => showWorkspaceToast(e.message || 'Failed to update recovery procedures', { type: 'error' })
  })

  const isDirty = useMemo(() => {
    return JSON.stringify(linkedDocs) !== JSON.stringify(savedDocs)
  }, [linkedDocs, savedDocs])

  const toggleRecoveryDoc = (id: number) => {
    const isLinked = linkedDocs.some(d => d.id === id)
    const nextDocs = isLinked 
      ? linkedDocs.filter(d => d.id !== id) 
      : [...linkedDocs, { id, note: '', added_at: new Date().toISOString() }]
    setLinkedDocs(nextDocs)
  }

  const updateNote = (id: number, note: string) => {
    const nextDocs = linkedDocs.map(d => d.id === id ? { ...d, note } : d)
    setLinkedDocs(nextDocs)
  }

  const getTitle = (id: number) => {
    return (knowledgeEntries || []).find((e: any) => e.id === id)?.title || `KB-${id}`
  }

  return (
    <WorkspaceModal
      isOpen={true}
      onClose={onClose}
      isDirty={isDirty}
      size="wide"
      isMaximized={isMaximized}
      onMaximizeToggle={() => setIsMaximized(!isMaximized)}
      title="Recovery Procedures"
      subtitle="Knowledge-base linkage and operational guidance."
      icon={<BookOpen size={20} />}
      footerRight={
        <ToolbarButton 
          variant="primary" 
          disabled={!isDirty || mutation.isPending}
          onClick={() => mutation.mutate(linkedDocs)}
        >
           {mutation.isPending ? 'Synchronizing...' : 'Synchronize Procedures'}
        </ToolbarButton>
      }
    >
      <div className="space-y-8 pt-4 pb-4">
        <div className="flex items-center justify-between px-1">
           <div className="flex flex-col">
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest leading-none">Linked Procedures (BKM)</p>
              <p className="text-[8px] text-slate-600 font-bold uppercase mt-1">Guaranteed operational response protocol</p>
           </div>
           <button 
             onClick={() => setIsAdding(!isAdding)}
             className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all flex items-center space-x-1.5 ${isAdding ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 'bg-amber-500/10 text-amber-500 border border-amber-500/30 hover:bg-amber-500/20'}`}
           >
              {isAdding ? <X size={12}/> : <Plus size={12}/>}
              <span>{isAdding ? 'Close Search' : 'Link Procedure'}</span>
           </button>
        </div>

        <div className="flex-1 space-y-6">
          {isAdding && (
            <div className="space-y-4 mb-8 p-6 bg-amber-500/[0.03] border border-amber-500/10 rounded-lg animate-in fade-in slide-in-from-top-2 shadow-inner">
               <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input 
                    value={recoverySearch}
                    onChange={e => setRecoverySearch(e.target.value)}
                    placeholder="Search Knowledge Base by title or category..."
                    className="w-full bg-black/60 border border-white/10 rounded-lg pl-10 pr-4 py-2.5 text-[11px] font-bold text-white outline-none focus:border-amber-500/50 shadow-inner"
                  />
               </div>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-60 overflow-y-auto custom-scrollbar pr-2">
                  {filteredKnowledge.map((entry: any) => (
                    <button 
                      key={entry.id}
                      onClick={() => toggleRecoveryDoc(entry.id)}
                      className="text-left p-3 hover:bg-white/5 rounded-lg border border-white/5 flex items-center justify-between group transition-all"
                    >
                       <div className="min-w-0">
                          <span className="text-[10px] font-bold text-slate-300 group-hover:text-amber-400 block truncate">{entry.title}</span>
                          <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">{entry.category}</span>
                       </div>
                       <Plus size={12} className="text-slate-600 group-hover:text-amber-500 shrink-0 ml-4" />
                    </button>
                  ))}
                  {filteredKnowledge.length === 0 && (
                    <div className="col-span-2 py-8 text-center">
                       <p className="text-[9px] text-slate-700 font-black uppercase tracking-widest">No available procedures found in registry</p>
                    </div>
                  )}
               </div>
            </div>
          )}

          <div className="space-y-4 max-h-[600px] overflow-y-auto custom-scrollbar pr-2">
            {linkedDocs.map((doc: MonitoringRecoveryDoc, idx: number) => (
              <div 
                key={doc.id} 
                className="w-full bg-black/40 border border-white/5 p-5 rounded-lg space-y-4 group hover:border-amber-500/20 transition-all shadow-xl relative overflow-hidden"
              >
                <div className="absolute top-0 left-0 w-1 h-full bg-amber-500/20" />
                <div className="flex items-start justify-between relative z-10">
                   <div className="flex items-center space-x-4 flex-1 text-left min-w-0">
                      <div className="flex flex-col items-center">
                         <div className="w-8 h-8 rounded-lg bg-slate-900 border border-white/5 flex items-center justify-center text-[12px] font-black text-slate-600 mb-1">
                            {idx + 1}
                         </div>
                         <div className="w-px h-4 bg-white/5" />
                      </div>
                      <button onClick={() => onOpenBkm(doc.id)} className="min-w-0 group/link">
                         <span className="text-[12px] font-black text-slate-200 block truncate leading-tight group-hover/link:text-amber-400 transition-colors">{getTitle(doc.id)}</span>
                         <div className="flex items-center gap-3 mt-1.5">
                            <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">DOC ID: KB-{doc.id}</span>
                            <div className="h-2.5 w-px bg-white/10" />
                            <div className="flex items-center gap-1.5">
                               <Clock size={10} className="text-slate-600" />
                               <span className="text-[8px] text-slate-600 font-black uppercase tracking-widest">
                                  Linked: {doc.added_at ? formatAppDate(doc.added_at) : 'Genesis'}
                               </span>
                            </div>
                         </div>
                      </button>
                   </div>
                   <div className="flex items-center gap-2">
                      <button
                        onClick={() => onOpenKnowledge(doc.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/20 bg-blue-500/10 px-2.5 py-2 text-[9px] font-black uppercase tracking-widest text-blue-300 transition-all hover:bg-blue-500/20"
                        title="Open Recovery BKM"
                      >
                         <ExternalLink size={12} />
                         <span>Open Recovery BKM</span>
                      </button>
                      <button 
                        onClick={() => toggleRecoveryDoc(doc.id)}
                        className="p-2 text-slate-700 hover:text-rose-500 transition-colors bg-white/[0.02] border border-white/5 rounded-lg"
                        title="Unlink Procedure"
                      >
                         <Trash2 size={14} />
                      </button>
                   </div>
                </div>
                
                <div className="relative pl-12">
                   <textarea
                     value={doc.note || ''}
                     onChange={e => updateNote(doc.id, e.target.value)}
                     placeholder="Specify operational context for this procedure (e.g. check version first)..."
                     className="w-full bg-white/[0.03] border border-white/5 rounded-lg p-3 text-[11px] font-bold text-slate-300 outline-none focus:border-blue-500/30 transition-all min-h-[80px] resize-none leading-relaxed shadow-inner"
                   />
                   <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-30 group-focus-within:opacity-100 transition-opacity pointer-events-none">
                      <MessageSquare size={10} className="text-slate-500" />
                      <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Operator Guidance</span>
                   </div>
                </div>
              </div>
            ))}
            {linkedDocs.length === 0 && !isAdding && (
               <div className="py-20">
                  <WorkspaceEmptyState 
                    icon={<BookOpen size={32} className="text-slate-800" />} 
                    title="Recovery Protocol Missing" 
                    description="No knowledge-base procedures have been linked to this monitor yet." 
                  />
               </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceModal>
  )
}
