import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Save, Plus, Activity, Zap, ShieldCheck, Search, Monitor, Clipboard, Check, PlusCircle, Edit2, Trash2, ChevronDown, Target } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../api/apiClient'
import { toast } from 'react-hot-toast'
import { RootCauseFormModal, MitigationFormModal, PreventionFormModal } from './FARModals'
import { ModernStatusPicker } from '../Research' // Assuming it's still there or I should move it too

// Move ImageThumbnail and other small components if needed, or import them
function ImageThumbnail({ src }: { src: string }) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <>
      <div onClick={() => setIsOpen(true)} className="relative w-24 h-24 shrink-0 rounded-lg border border-white/10 overflow-hidden cursor-pointer hover:border-blue-500/50 transition-all shadow-xl group">
        <img src={src} className="w-full h-full object-cover transition-transform group-hover:scale-110" />
        <div className="absolute inset-0 bg-blue-500/10 opacity-0 group-hover:opacity-100 transition-all" />
      </div>
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/95 p-10" onClick={() => setIsOpen(false)}>
            <motion.img initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} src={src} className="max-w-full max-h-full object-contain shadow-2xl" />
            <button className="absolute top-10 right-10 text-white/50 hover:text-white transition-colors"><X size={32} /></button>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}

const UnifiedCauseContainerMemo = React.memo(UnifiedCauseContainer);

export function InvestigationTab({ formData, setFormData, failureModes, setFocusedField, focusedField, options: settingsOptions, isEditing: isParentEditing, onSave, bkms, monitoring }: any) {
  const [selectedFailureId, setSelectedFailureId] = useState<number | null>(null)
  const [activeCauseModal, setActiveCauseModal] = useState<any>(null)
  const [activeMitigationModal, setActiveMitigationModal] = useState<any>(null)
  const [activePreventionModal, setActivePreventionModal] = useState<any>(null)
  const [expandedCauseIds, setExpandedCauseIds] = useState<number[]>([])
  const [editingStepId, setEditingStepId] = useState<number | null>(null)
  const [localStatuses, setLocalStatuses] = useState<any>({})

  const isEditing = true;

  const linkedFailures = useMemo(() => {
    const ids = formData.linked_failure_mode_ids || []
    return (failureModes || []).filter((fm: any) => ids.includes(fm.id))
  }, [formData.linked_failure_mode_ids, failureModes])

  const selectedFailure = useMemo(() => linkedFailures.find((f: any) => f.id === selectedFailureId), [linkedFailures, selectedFailureId])

  useEffect(() => {
    if (!selectedFailureId && linkedFailures.length > 0) {
      setSelectedFailureId(linkedFailures[0].id)
    }
  }, [linkedFailures, selectedFailureId])

  const addStep = useCallback((causeId: number, stepData: any) => {
    if (!stepData.text.trim()) return

    if (editingStepId !== null) {
      const updatedSteps = (formData.identification_steps_json || []).map((s: any) =>
        s.id === editingStepId ? { ...s, text: stepData.text, images: stepData.images, status: stepData.status, updated_at: new Date().toISOString() } : s
      )
      setFormData({ ...formData, identification_steps_json: updatedSteps })
      setEditingStepId(null)
    } else {
      const step = {
        ...stepData,
        id: Date.now(),
        failure_id: selectedFailureId,
        cause_id: causeId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
      setFormData({ ...formData, identification_steps_json: [...(formData.identification_steps_json || []), step] })
    }
  }, [editingStepId, formData, selectedFailureId, setFormData])

  const editStep = useCallback((step: any) => {
    setEditingStepId(step.id)
  }, [])

  const queryClient = useQueryClient()
  const syncMutation = useMutation({
    mutationFn: async ({ id, metadata }: any) => {
      const res = await apiFetch(`/api/v1/far/modes/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ metadata_json: metadata })
      })
      return res.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['far', 'modes'] })
      queryClient.invalidateQueries({ queryKey: ['far-failure-modes'] })
      queryClient.invalidateQueries({ queryKey: ['rca-records'] })
      toast.success('FAR Vector Synchronized')
      setLocalStatuses((prev: any) => {
        const next = { ...prev };
        delete next[`${variables.id}_${variables.type}`];
        return next;
      });
    }
  })

  const linkCauseToRca = useCallback((causeId: number) => {
    if (!selectedFailureId) return
    const currentMap = formData.metadata_json?.linked_causes_by_mode || {}
    const currentCauses = currentMap[selectedFailureId] || []
    if (currentCauses.includes(causeId)) return

    const newMap = { ...currentMap, [selectedFailureId]: [...currentCauses, causeId] }
    setFormData({ ...formData, metadata_json: { ...formData.metadata_json, linked_causes_by_mode: newMap } })
    toast.success('Root Cause Linked to Investigation')
  }, [formData, selectedFailureId, setFormData])

  const deleteCauseMutation = useMutation({
    mutationFn: async (id: number) => {
      const currentMap = formData.metadata_json?.linked_causes_by_mode || {}
      const currentCauses = currentMap[selectedFailureId!] || []
      const newCauses = currentCauses.filter((cid: number) => cid !== id)
      const newMap = { ...currentMap, [selectedFailureId!]: newCauses }
      setFormData({ ...formData, metadata_json: { ...formData.metadata_json, linked_causes_by_mode: newMap } })
    },
    onSuccess: () => {
      toast.success('Root Cause Unlinked')
    }
  })

  const [causeToDelete, setCauseCauseToDelete] = useState<any>(null)

  const updateFailureStatus = (fmId: number, field: string, status: string) => {
    setLocalStatuses((prev: any) => ({ ...prev, [`${fmId}_${field}`]: status }));
    const fm = (failureModes || []).find((f: any) => f.id === fmId)
    const currentMeta = fm?.metadata_json || {}
    const newMetadata = { ...currentMeta, [`status_${field}`]: status }
    syncMutation.mutate({ id: fmId, metadata: newMetadata, type: field })
  }

  const statusOptions = [
    { value: 'NOT_STARTED', label: 'NOT STARTED', color: 'text-slate-500' },
    { value: 'IN_PROGRESS', label: 'IN PROGRESS', color: 'text-blue-400' },
    { value: 'BLOCKED', label: 'BLOCKED', color: 'text-rose-500' },
    { value: 'COMPLETED', label: 'COMPLETED', color: 'text-emerald-400' }
  ]

  const toggleCauseExpand = (id: number) => {
    setExpandedCauseIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
  }

  const getCounts = (fm: any) => {
    const allMitigations = (fm.causes || []).flatMap((c: any) => c.mitigations || [])
    const allPreventions = (fm.causes || []).flatMap((c: any) => c.prevention_actions || [])
    
    const workarounds = allMitigations.filter((m: any) => m.mitigation_type === 'Workaround')
    const monitoringItems = allMitigations.filter((m: any) => m.mitigation_type === 'Monitoring')
    
    const compW = workarounds.filter((m: any) => m.status === 'Completed').length
    const compM = monitoringItems.filter((m: any) => m.status === 'Completed').length
    const compP = allPreventions.filter((p: any) => p.status === 'Completed').length
    
    return {
      w: `${compW}/${workarounds.length}`,
      m: `${compM}/${monitoringItems.length}`,
      p: `${compP}/${allPreventions.length}`
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6 gap-6">
       {/* 1. Failure Resolution Matrix (Header) */}
       <div className="shrink-0 bg-white/5 border border-white/10 rounded-lg overflow-visible shadow-2xl relative z-30">
          <div className="px-6 py-4 border-b border-white/5 bg-white/5 flex items-center justify-between">
             <div className="flex items-center gap-3">
                <Activity size={18} className="text-purple-400" />
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-white">Failure Resolution Matrix</h3>
             </div>
             <div className="flex items-center gap-4 text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                <span>{linkedFailures.length} Vectors Tracked</span>
             </div>
          </div>

          <div className="overflow-visible">
             <table className="sg-data-table w-full text-left border-collapse">
                <thead>
                   <tr className="border-b border-white/10 bg-black/40">
                      <th className="py-3 px-6 text-[9px] font-black uppercase tracking-widest text-slate-500">Linked Failure Mode</th>
                      <th className="py-3 px-6 text-[9px] font-black uppercase tracking-widest text-slate-500 text-center">Root Cause</th>
                      <th className="py-3 px-6 text-[9px] font-black uppercase tracking-widest text-slate-500 text-center whitespace-nowrap">Workaround [C/T]</th>
                      <th className="py-3 px-6 text-[9px] font-black uppercase tracking-widest text-slate-500 text-center whitespace-nowrap">Monitoring [C/T]</th>
                      <th className="py-3 px-6 text-[9px] font-black uppercase tracking-widest text-slate-500 text-center whitespace-nowrap">Prevention [C/T]</th>
                   </tr>
                </thead>
                <tbody className="overflow-visible">
                   {linkedFailures.map((fm: any) => {
                      const counts = getCounts(fm)
                      return (
                      <tr 
                        key={fm.id} 
                        onClick={() => setSelectedFailureId(fm.id)}
                        className={`border-b border-white/5 hover:bg-white/[0.05] transition-all cursor-pointer group ${selectedFailureId === fm.id ? 'bg-purple-500/10' : ''}`}
                      >
                         <td className="py-3 px-6">
                            <div className="flex items-center gap-3">
                               {selectedFailureId === fm.id && <div className="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)]" />}
                               <div className="flex flex-col">
                                  <span className={`text-[11px] font-black uppercase tracking-tight ${selectedFailureId === fm.id ? 'text-purple-400' : 'text-slate-300'}`}>{fm.title}</span>
                                  <span className="text-[8px] font-bold text-slate-600 uppercase">{fm.system_name || fm.system}</span>
                               </div>
                            </div>
                         </td>
                         <td className="py-3 px-6 text-center overflow-visible">
                               <ModernStatusPicker 
                                  value={localStatuses[`${fm.id}_cause`] || fm.metadata_json?.status_cause || 'NOT_STARTED'}
                                  onChange={(val: string) => updateFailureStatus(fm.id, 'cause', val)}
                                  options={statusOptions}
                               />
                         </td>
                         <td className="py-3 px-6 text-center overflow-visible">
                            <div className="flex flex-col items-center gap-1">
                               <span className="text-[9px] font-bold text-amber-500/80">{counts.w}</span>
                               <ModernStatusPicker 
                                  value={localStatuses[`${fm.id}_workaround`] || fm.metadata_json?.status_workaround || 'NOT_STARTED'}
                                  onChange={(val: string) => updateFailureStatus(fm.id, 'workaround', val)}
                                  options={statusOptions}
                               />
                            </div>
                         </td>
                         <td className="py-3 px-6 text-center overflow-visible">
                            <div className="flex flex-col items-center gap-1">
                               <span className="text-[9px] font-bold text-sky-400/80">{counts.m}</span>
                               <ModernStatusPicker 
                                  value={localStatuses[`${fm.id}_monitoring`] || fm.metadata_json?.status_monitoring || 'NOT_STARTED'}
                                  onChange={(val: string) => updateFailureStatus(fm.id, 'monitoring', val)}
                                  options={statusOptions}
                               />
                            </div>
                         </td>
                         <td className="py-3 px-6 text-center overflow-visible">
                            <div className="flex flex-col items-center gap-1">
                               <span className="text-[9px] font-bold text-emerald-400/80">{counts.p}</span>
                               <ModernStatusPicker 
                                  value={localStatuses[`${fm.id}_prevention`] || fm.metadata_json?.status_prevention || 'NOT_STARTED'}
                                  onChange={(val: string) => updateFailureStatus(fm.id, 'prevention', val)}
                                  options={statusOptions}
                               />
                            </div>
                         </td>
                      </tr>
                   )})}
                </tbody>
             </table>
          </div>
       </div>

       {/* 2. Unified Cause-Centric Investigation Area */}
       <div className="flex-1 flex flex-col gap-6 overflow-hidden">
          {selectedFailure ? (
             <div className="flex-1 flex flex-col gap-4 overflow-y-auto custom-scrollbar pr-2">
                <div className="flex items-center justify-between shrink-0 bg-white/5 p-4 rounded-lg border border-white/10">
                   <div className="flex items-center gap-6">
                      <div className="flex flex-col">
                         <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Active Vector</span>
                         <span className="text-[12px] font-black text-purple-400 uppercase tracking-tighter">{selectedFailure.title}</span>
                      </div>
                      <div className="flex items-center gap-4 pl-6 border-l border-white/10">
                         {(() => {
                            const counts = getCounts(selectedFailure)
                            return (
                               <>
                                  <div className="flex flex-col items-center">
                                     <span className="text-[7px] font-bold text-slate-500 uppercase">Workaround</span>
                                     <span className="text-[10px] font-black text-amber-500">{counts.w}</span>
                                  </div>
                                  <div className="flex flex-col items-center">
                                     <span className="text-[7px] font-bold text-slate-500 uppercase">Monitoring</span>
                                     <span className="text-[10px] font-black text-sky-400">{counts.m}</span>
                                  </div>
                                  <div className="flex flex-col items-center">
                                     <span className="text-[7px] font-bold text-slate-500 uppercase">Prevention</span>
                                     <span className="text-[10px] font-black text-emerald-400">{counts.p}</span>
                                  </div>
                               </>
                            )
                         })()}
                      </div>
                   </div>
                   <button 
                     onClick={() => setActiveCauseModal({ isOpen: true, modeId: selectedFailureId })}
                     className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest shadow-xl shadow-blue-600/20 active:scale-95 transition-all flex items-center gap-2"
                   >
                      <PlusCircle size={14} /> Add Root Cause
                   </button>
                </div>

                <div className="space-y-4">
                   {(selectedFailure.causes || []).map((cause: any) => (
                      <UnifiedCauseContainerMemo 
                        key={cause.id} 
                        cause={cause} 
                        isExpanded={expandedCauseIds.includes(cause.id)}
                        onToggle={() => toggleCauseExpand(cause.id)}
                        isEditing={true} 
                        onEdit={() => setActiveCauseModal({ isOpen: true, modeId: selectedFailureId, initialData: cause })}
                        onDelete={() => setCauseCauseToDelete(cause)}
                        formData={formData}
                        setFormData={setFormData}
                        addStep={addStep}
                        editStep={editStep}
                        editingStepId={editingStepId}
                        setEditingStepId={setEditingStepId}
                        focusedField={focusedField}
                        setFocusedField={setFocusedField}
                        selectedFailureId={selectedFailureId}
                        selectedFailure={selectedFailure}
                        queryClient={queryClient}
                        onAddMitigation={(type: string) => setActiveMitigationModal({ isOpen: true, modeId: selectedFailureId, causeId: cause.id, type })}
                        onAddPrevention={() => setActivePreventionModal({ isOpen: true, modeId: selectedFailureId, causeId: cause.id })}
                        bkms={bkms}
                        monitoring={monitoring}
                      />
                   ))}
                </div>

                <ConfirmationModal 
                  isOpen={!!causeToDelete}
                  title="Expunge Root Cause?"
                  message={`Are you sure you want to delete "${causeToDelete?.cause_text}"? This will also remove all linked mitigations and preventions.`}
                  onConfirm={() => { deleteCauseMutation.mutate(causeToDelete.id); setCauseCauseToDelete(null); }}
                  onClose={() => setCauseCauseToDelete(null)}
                />
             </div>
          ) : (
             <div className="flex-1 flex flex-col items-center justify-center opacity-20">
                <Target size={60} className="text-slate-600" />
                <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.5em] mt-4">Select Failure Vector</p>
             </div>
          )}
       </div>

       <RootCauseFormModal 
          isOpen={activeCauseModal?.isOpen} 
          onClose={() => setActiveCauseModal(null)} 
          modeId={activeCauseModal?.modeId}
          initialData={activeCauseModal?.initialData}
          onSave={(data: any) => !activeCauseModal?.initialData && linkCauseToRca(data.id)}
       />

       <MitigationFormModal 
          isOpen={activeMitigationModal?.isOpen}
          onClose={() => setActiveMitigationModal(null)}
          modeId={activeMitigationModal?.modeId}
          causeId={activeMitigationModal?.causeId}
          type={activeMitigationModal?.type}
          bkms={bkms}
          monitoring={monitoring}
          onSave={() => {}}
       />

       <PreventionFormModal 
          isOpen={activePreventionModal?.isOpen}
          onClose={() => setActivePreventionModal(null)}
          modeId={activePreventionModal?.modeId}
          causeId={activePreventionModal?.causeId}
          onSave={() => {}}
       />
    </div>
  )
}

function UnifiedCauseContainer({ cause, isExpanded, onToggle, isEditing, onDelete, formData, setFormData, addStep, editStep, editingStepId, setEditingStepId, focusedField, setFocusedField, selectedFailureId, selectedFailure, queryClient, onEdit, onAddMitigation, onAddPrevention, bkms, monitoring }: any) {
  const [activeSubView, setActiveSubView] = useState<'PROCEDURE' | 'ACTIONS'>('PROCEDURE')
  const [isAddingStepCollapsed, setIsAddingStepCollapsed] = useState(true)
  const [newStep, setNewStep] = useState({ text: '', images: [] as string[], status: 'DONE' })

  const identificationStatus = useMemo(() => {
    return formData.metadata_json?.cause_identification_statuses?.[cause.id] || 'NOT_STARTED'
  }, [formData.metadata_json, cause.id])

  const setIdentificationStatus = (status: string) => {
    const currentStatuses = formData.metadata_json?.cause_identification_statuses || {}
    const newMetadata = { 
      ...formData.metadata_json, 
      cause_identification_statuses: { ...currentStatuses, [cause.id]: status } 
    }
    setFormData({ ...formData, metadata_json: newMetadata })
    toast.success('Identification Status Updated')
  }

  const idStatusOptions = [
    { value: 'NOT_STARTED', label: 'NOT STARTED', color: 'text-slate-500' },
    { value: 'IN_PROGRESS', label: 'IN PROGRESS', color: 'text-blue-400' },
    { value: 'COMPLETED', label: 'COMPLETED', color: 'text-emerald-400' }
  ]

  useEffect(() => {
    const handlePasteEvent = (e: any) => {
      if (e.detail.causeId === cause.id) {
        setNewStep(prev => ({ ...prev, images: [...prev.images, e.detail.base64] }))
      }
    }
    window.addEventListener('investigation-paste', handlePasteEvent as any)
    return () => window.removeEventListener('investigation-paste', handlePasteEvent as any)
  }, [cause.id])

  useEffect(() => {
    if (editingStepId !== null) {
      const step = (formData.identification_steps_json || []).find((s: any) => s.id === editingStepId && s.cause_id === cause.id);
      if (step) {
        setNewStep({ text: step.text, images: step.images || [], status: step.status || 'PENDING' });
        // Removed: setIsAddingStepCollapsed(false); 
      }
    }
  }, [editingStepId, cause.id, formData.identification_steps_json])

  const handleCommitStep = () => {
    addStep(cause.id, newStep);
    setNewStep({ text: '', images: [], status: 'DONE' });
    setIsAddingStepCollapsed(true);
  }

  const handleMilestoneFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (let i = 0; i < files.length; i++) {
      const reader = new FileReader()
      reader.onload = (event: any) => {
        const base64 = event.target.result
        setNewStep((prev: any) => ({ ...prev, images: [...prev.images, base64] }))
      }
      reader.readAsDataURL(files[i])
    }
    toast.success('Figures Queued')
  }

  return (
    <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden hover:border-white/20 transition-all shadow-xl">
       <div 
         onClick={onToggle}
         className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-white/[0.02]"
       >
          <div className="flex items-center gap-4">
             <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400 border border-blue-500/20 shadow-inner">
                <Zap size={16} />
             </div>
             <div>
                <h5 className="text-[12px] font-black text-white uppercase tracking-tight">{cause.cause_text}</h5>
                <div className="flex items-center gap-3 mt-0.5">
                   <span className="text-[9px] font-bold text-slate-500 uppercase">{cause.responsible_team || 'SYSTEM_CORE'}</span>
                   <span className="w-1 h-1 rounded-full bg-white/10" />
                   <span className="text-[9px] font-bold text-blue-400 uppercase tracking-widest">Occur: LVL {cause.occurrence_level}</span>
                </div>
             </div>
          </div>
          <div className="flex items-center gap-4">
             <div className="flex items-center gap-6">
                <div className="flex items-center gap-4">
                   {(() => {
                      const workarounds = (cause.mitigations || []).filter((m: any) => m.mitigation_type === 'Workaround')
                      const monitoringItems = (cause.mitigations || []).filter((m: any) => m.mitigation_type === 'Monitoring')
                      const preventions = cause.prevention_actions || []
                      const compW = workarounds.filter((m: any) => m.status === 'Completed').length
                      const compM = monitoringItems.filter((m: any) => m.status === 'Completed').length
                      const compP = preventions.filter((p: any) => p.status === 'Completed').length
                      return (
                         <>
                            <div className="flex flex-col items-center">
                               <span className="text-[7px] font-bold text-slate-500 uppercase">W</span>
                               <span className="text-[9px] font-black text-amber-500">{compW}/{workarounds.length}</span>
                            </div>
                            <div className="flex flex-col items-center">
                               <span className="text-[7px] font-bold text-slate-500 uppercase">M</span>
                               <span className="text-[9px] font-black text-sky-400">{compM}/{monitoringItems.length}</span>
                            </div>
                            <div className="flex flex-col items-center">
                               <span className="text-[7px] font-bold text-slate-500 uppercase">P</span>
                               <span className="text-[9px] font-black text-emerald-400">{compP}/{preventions.length}</span>
                            </div>
                         </>
                      )
                   })()}
                </div>
                <div className="w-px h-6 bg-white/10 mx-1" />
                <div className="flex flex-col items-center">
                   <span className="text-[7px] font-bold text-slate-500 uppercase tracking-widest mb-1">Identification</span>
                   <ModernStatusPicker 
                      value={identificationStatus}
                      onChange={setIdentificationStatus}
                      options={idStatusOptions}
                   />
                </div>
             </div>
             {isEditing && (
                <div className="flex items-center gap-2 transition-all mr-4">
                   <button 
                     onClick={(e) => { e.stopPropagation(); onEdit(); }}
                     className="p-1.5 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-all"
                   >
                      <Edit2 size={14} />
                   </button>
                   <button 
                     onClick={(e) => { e.stopPropagation(); onDelete(); }}
                     className="p-1.5 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all"
                   >
                      <Trash2 size={14} />
                   </button>
                </div>
             )}
             <ChevronDown size={18} className={`text-slate-500 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
          </div>
       </div>

       <AnimatePresence>
          {isExpanded && (
             <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-visible bg-black/40 border-t border-white/5">
                <div className="p-1 flex gap-1 bg-white/2 border-b border-white/5">
                   {['PROCEDURE', 'ACTIONS'].map(view => (
                      <button 
                        key={view}
                        onClick={(e) => { e.stopPropagation(); setActiveSubView(view as any); }}
                        className={`flex-1 py-2 text-[9px] font-black uppercase tracking-widest transition-all rounded-lg ${activeSubView === view ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                         {view === 'PROCEDURE' ? 'Identification Procedure' : 'Strategic Actions'}
                      </button>
                   ))}
                </div>

                <div className="p-6">
                   {activeSubView === 'PROCEDURE' ? (
                      <div className="space-y-6 max-h-[600px] overflow-y-auto custom-scrollbar pr-2 pb-6">
                         <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden transition-all shadow-xl">
                            <button 
                               onClick={() => setIsAddingStepCollapsed(!isAddingStepCollapsed)}
                               className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-white/5 transition-all border-b border-white/5"
                            >
                               <div className="flex items-center gap-3">
                                  <Plus size={14} className="text-blue-400" />
                                  <span className="text-[10px] font-black uppercase tracking-widest text-white/70">{editingStepId ? 'Edit Milestone' : 'Record Discovery Milestone'}</span>
                               </div>
                               <ChevronDown size={14} className={`text-slate-500 transition-transform ${!isAddingStepCollapsed ? 'rotate-180' : ''}`} />
                            </button>
                            <AnimatePresence>
                               {!isAddingStepCollapsed && (
                                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden p-5 space-y-4">
                                     <div className="space-y-2">
                                        <div className="flex items-center justify-between px-1">
                                           <label className="text-[10px] font-black text-slate-500 tracking-widest uppercase">discovery step description</label>
                                        </div>
                                        <div className="relative group transition-all">
                                           <textarea 
                                              value={newStep.text}
                                              onChange={e => setNewStep({...newStep, text: e.target.value})}
                                              className="w-full bg-slate-950 border border-white/10 rounded-lg p-4 text-[12px] font-bold text-white outline-none min-h-[100px] placeholder:text-slate-700 leading-relaxed focus:border-blue-500/50"
                                              placeholder="Record discovery step..."
                                           />
                                        </div>
                                     </div>
                                     
                                     <div className="space-y-2">
                                        <div className="flex items-center justify-between px-1">
                                           <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Figures / Evidence</label>
                                        </div>
                                        <div 
                                          onClick={() => setFocusedField(`investigation_${cause.id}`)}
                                          className={`flex gap-2 overflow-x-auto pb-1 scrollbar-hide focus-trigger p-2 border-2 rounded-lg transition-all min-h-[80px] ${focusedField === `investigation_${cause.id}` ? 'border-blue-500/50 bg-blue-500/5 shadow-[0_0_20px_rgba(59,130,246,0.1)]' : 'border-white/5 bg-slate-950'}`}
                                        >
                                           {newStep.images.map((img: string, i: number) => (
                                              <div key={i} className="relative w-16 h-16 shrink-0 rounded-lg border border-white/10 overflow-hidden group">
                                                 <img src={img} className="w-full h-full object-cover" />
                                                 <button onClick={() => setNewStep({...newStep, images: newStep.images.filter((_, idx) => idx !== i)})} className="absolute top-1 right-1 bg-rose-600 text-white p-1 rounded-lg opacity-0 group-hover:opacity-100"><X size={10}/></button>
                                              </div>
                                           ))}
                                           {newStep.images.length === 0 && (
                                              <div className="w-full flex items-center justify-center text-[8px] font-black text-slate-700 uppercase tracking-widest">
                                                 CLICK HERE THEN CTRL+V TO PASTE FIGURES
                                              </div>
                                           )}
                                        </div>
                                     </div>

                                     <div className="flex gap-4">
                                        <button 
                                          onClick={() => { setIsAddingStepCollapsed(true); setEditingStepId(null); setNewStep({ text: '', images: [], status: 'DONE' }); }} 
                                          className="flex-1 py-3 text-[10px] font-black uppercase text-slate-500 hover:text-white transition-colors"
                                        >
                                          Cancel
                                        </button>
                                        <button 
                                          onClick={handleCommitStep} 
                                          className="flex-[2] py-3 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-500 transition-all shadow-lg flex items-center justify-center gap-2"
                                        >
                                           {editingStepId !== null ? <Save size={14} /> : <Plus size={14} />} 
                                           {editingStepId !== null ? 'Update Milestone' : 'Commit Milestone'}
                                        </button>
                                     </div>
                                  </motion.div>
                               )}
                            </AnimatePresence>
                         </div>

                         <div className="space-y-4">
                            {(formData.identification_steps_json || []).filter((s: any) => s.failure_id === selectedFailureId && s.cause_id === cause.id).map((step: any, idx: number) => (
                               <div key={step.id || idx} className="flex gap-6 group">
                                  <div className="flex flex-col items-center shrink-0">
                                     <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-[10px] border shadow-lg bg-blue-600/10 text-blue-400 border-blue-500/20">{idx + 1}</div>
                                     <div className="w-px flex-1 bg-white/5 my-2" />
                                  </div>
                                  <div className="flex-1 space-y-3 pt-1 pb-6">
                                     {editingStepId === step.id ? (
                                        <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-4">
                                           <textarea 
                                              value={newStep.text}
                                              onChange={e => setNewStep({...newStep, text: e.target.value})}
                                              className="w-full bg-slate-950 border border-white/10 rounded-lg p-3 text-[11px] font-bold text-white outline-none min-h-[80px]"
                                           />
                                           <div 
                                              onClick={() => setFocusedField(`investigation_${cause.id}`)}
                                              className={`flex gap-2 overflow-x-auto pb-1 scrollbar-hide focus-trigger p-2 border-2 rounded-lg transition-all min-h-[60px] ${focusedField === `investigation_${cause.id}` ? 'border-blue-500/50 bg-blue-500/5' : 'border-white/5 bg-slate-950'}`}
                                           >
                                              {newStep.images.map((img: string, i: number) => (
                                                 <div key={i} className="relative w-12 h-12 shrink-0 rounded-lg border border-white/10 overflow-hidden group">
                                                    <img src={img} className="w-full h-full object-cover" />
                                                    <button onClick={() => setNewStep({...newStep, images: newStep.images.filter((_, idx) => idx !== i)})} className="absolute top-0.5 right-0.5 bg-rose-600 text-white p-0.5 rounded-lg opacity-0 group-hover:opacity-100"><X size={8}/></button>
                                                 </div>
                                              ))}
                                              {newStep.images.length === 0 && <span className="text-[7px] font-black text-slate-700 uppercase m-auto">PASTE FIGURES (CTRL+V)</span>}
                                           </div>
                                           <div className="flex gap-2">
                                              <button onClick={handleCommitStep} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-[9px] font-black uppercase">Save</button>
                                              <button onClick={() => { setEditingStepId(null); setNewStep({text:'', images:[], status:'DONE'}); }} className="flex-1 py-2 bg-white/5 text-slate-400 rounded-lg text-[9px] font-black uppercase">Cancel</button>
                                           </div>
                                        </div>
                                     ) : (
                                        <>
                                           <div className="flex items-start justify-between">
                                              <div className="space-y-1">
                                                 <p className="text-[12px] font-black text-slate-200 leading-relaxed tracking-tight">{step.text}</p>
                                                 <div className="flex items-center gap-3">
                                                    <span className="text-[7px] font-bold text-slate-600 uppercase tracking-widest">{new Date(step.created_at).toLocaleString()}</span>
                                                 </div>
                                              </div>
                                              {isEditing && (
                                                 <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                    <button onClick={() => editStep(step)} className="p-1.5 text-blue-400 hover:bg-blue-500/10 rounded-lg"><Edit2 size={12}/></button>
                                                    <button onClick={() => setFormData({...formData, identification_steps_json: formData.identification_steps_json.filter((s: any) => s.id !== step.id)})} className="p-1.5 text-rose-500 hover:bg-rose-500/10 rounded-lg"><Trash2 size={12}/></button>
                                                 </div>
                                              )}
                                           </div>
                                           {step.images?.length > 0 && (
                                             <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                                                 {step.images.map((img: string, i: number) => <ImageThumbnail key={i} src={img} />)}
                                             </div>
                                           )}
                                        </>
                                     )}
                                  </div>
                               </div>
                            ))}
                         </div>
                      </div>
                   ) : (
                      <div className="space-y-8">
                         <ActionSection cause={cause} type="WORKAROUND" isEditing={isEditing} queryClient={queryClient} mode={selectedFailure} onAdd={() => onAddMitigation('WORKAROUND')} />
                         <ActionSection cause={cause} type="MONITORING" isEditing={isEditing} queryClient={queryClient} mode={selectedFailure} onAdd={() => onAddMitigation('MONITORING')} />
                         <ActionSection cause={cause} type="PREVENTION" isEditing={isEditing} queryClient={queryClient} mode={selectedFailure} onAdd={onAddPrevention} />
                      </div>
                   )}
                </div>
             </motion.div>
          )}
       </AnimatePresence>
    </div>
  )
}

function ActionSection({ cause, type, isEditing, queryClient, mode, onAdd }: any) {
  const actions = useMemo(() => {
    if (type === 'PREVENTION') return (cause.prevention_actions || []).filter((a: any) => a.failure_mode_id === mode?.id);
    return (cause.mitigations || []).filter((m: any) => 
      ((type === 'WORKAROUND' && m.mitigation_type === 'Workaround') ||
      (type === 'MONITORING' && m.mitigation_type === 'Monitoring'))
    )
  }, [cause, type, mode])

  return (
    <div className="space-y-4">
       <div className="flex items-center justify-between border-b border-white/5 pb-2">
          <div className="flex items-center gap-2">
             <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${
                type === 'WORKAROUND' ? 'text-amber-400' :
                type === 'MONITORING' ? 'text-sky-400' : 'text-emerald-400'
             }`}>{type}</span>
             <span className="px-2 py-0.5 rounded-lg bg-white/5 text-[8px] font-black text-slate-500">{actions.length}</span>
          </div>
          {isEditing && (
             <button onClick={onAdd} className="text-[9px] font-black text-blue-400 uppercase tracking-widest hover:text-white transition-colors">+ Add {type}</button>
          )}
       </div>

       <div className="space-y-3">
          {actions.map((a: any) => (
             <div key={a.id} className="bg-black/20 border border-white/5 rounded-lg px-6 py-4 flex items-center justify-between group hover:bg-white/[0.04] transition-all">
                <div className="flex items-center gap-6">
                   <div className={`w-2 h-2 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.2)] ${a.status === 'Completed' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                   <div className="space-y-1">
                      <p className="text-[12px] font-black text-slate-200 uppercase tracking-tight truncate max-w-xl">
                         {type === 'MONITORING' ? (a.monitoring_item?.title || 'ACTIVE MONITOR') : (type === 'PREVENTION' ? a.prevention_action : a.mitigation_steps)}
                      </p>
                      <div className="flex items-center gap-3">
                         <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">{a.status || 'PLANNED'}</span>
                         <span className="w-1 h-1 rounded-full bg-white/10" />
                         <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">ID: {a.id}</span>
                      </div>
                   </div>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                   <button className="p-1.5 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all"><Trash2 size={14}/></button>
                </div>
             </div>
          ))}
          {actions.length === 0 && (
             <div className="py-10 text-center opacity-20 font-black uppercase tracking-widest border border-dashed border-white/5 rounded-lg text-[9px]">
                No {type.toLowerCase()} actions established
             </div>
          )}
       </div>
    </div>
  )
}

function ConfirmationModal({ isOpen, title, message, onConfirm, onClose }: any) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-full max-w-md p-8 rounded-lg border border-rose-500/30 space-y-6">
        <h3 className="text-xl font-bold uppercase text-white tracking-tighter">{title}</h3>
        <p className="text-sm text-slate-400 font-bold leading-relaxed">{message}</p>
        <div className="flex gap-4">
          <button onClick={onClose} className="flex-1 py-3 bg-white/5 text-slate-400 rounded-lg text-[10px] font-black uppercase tracking-widest hover:text-white transition-all">Cancel</button>
          <button onClick={onConfirm} className="flex-1 py-3 bg-rose-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-rose-500 shadow-lg shadow-rose-600/20 transition-all">Expunge</button>
        </div>
      </motion.div>
    </div>
  )
}
