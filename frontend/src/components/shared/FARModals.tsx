import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Save, Plus, Activity, Zap, ShieldCheck, Search, Monitor, Clipboard, Check } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../api/apiClient'
import { toast } from 'react-hot-toast'
import { StyledSelect } from './StyledSelect'
import { MonitoringForm } from '../monitoring/MonitoringForm'
import { ProjectForm } from '../Projects'
import { WorkspaceModal } from './WorkspaceModal'
import {
  buildFarCauseMutationRequest,
  buildFarContextMutationRequest,
} from '../FAR.causalIntegrity'
import { readFarMutationFailureMessage } from '../FAR.mutationIntegrity'
import {
  buildFarMitigationFormState,
  buildFarMitigationPayload,
  getFarMitigationStatusOptions,
  type FarMitigationFormState,
} from '../FAR.mitigationModel'

export function RootCauseFormModal({ isOpen, onClose, onSave, modeId, modeVersion, initialData = null }: any) {
  const [formData, setFormData] = useState({ cause_text: '', occurrence_level: 5, responsible_team: '' })
  const queryClient = useQueryClient()

  useEffect(() => {
    if (initialData) setFormData({ cause_text: initialData.cause_text, occurrence_level: initialData.occurrence_level, responsible_team: initialData.responsible_team })
    else setFormData({ cause_text: '', occurrence_level: 5, responsible_team: '' })
  }, [initialData, isOpen])

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const url = initialData?.id ? `/api/v1/far/causes/${initialData.id}` : '/api/v1/far/causes'
      const method = initialData?.id ? 'PUT' : 'POST'
      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(buildFarCauseMutationRequest(modeId, modeVersion, data))
      })
      if (!res.ok) throw new Error(await readFarMutationFailureMessage(res))
      return res.json()
    },
    onSuccess: (data) => {
      toast.success(initialData?.id ? 'Root Cause Updated' : 'Root Cause Logged');
      onSave(data);
      onClose();
      queryClient.invalidateQueries({ queryKey: ['far', 'modes'] })
      queryClient.invalidateQueries({ queryKey: ['far-failure-modes'] })
    },
    meta: { handlesErrorToast: true },
    onError: (error: any) => toast.error(error?.message || 'Root cause mutation failed')
  })

  return (
    <WorkspaceModal
      isOpen={isOpen}
      onClose={onClose}
      size="compact"
      title={initialData ? 'Update Attribution' : 'Log Root Cause'}
      subtitle="Causal Mapping Interface"
      icon={<Zap size={24} className="text-amber-500" />}
      footerRight={(
        <>
          <button 
            type="button"
            onClick={onClose} 
            className="rounded-lg border border-white/10 bg-black/20 px-4 py-2 text-[10px] font-black uppercase text-slate-300 transition-colors hover:text-white"
          >
            Cancel
          </button>
          <button 
            type="button"
            onClick={() => mutation.mutate(formData)} 
            disabled={!formData.cause_text || mutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-6 py-2 text-[10px] font-black uppercase text-white transition-colors hover:bg-amber-500 disabled:opacity-50 shadow-lg shadow-amber-600/20"
          >
            {mutation.isPending ? <Activity size={12} className="animate-spin" /> : <Save size={12} />}
            Commit Attribution
          </button>
        </>
      )}
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Cause Description (Forensic Narrative)</label>
          <textarea 
            value={formData.cause_text} 
            onChange={e => setFormData({...formData, cause_text: e.target.value})} 
            className="w-full bg-black/40 border border-white/10 rounded-lg p-4 text-sm font-bold text-white outline-none focus:border-amber-500 min-h-[100px] uppercase custom-scrollbar resize-y" 
            placeholder="DESCRIBE THE LOGICAL ORIGIN OF FAILURE..."
          />
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Occurrence Level</label>
            <StyledSelect 
              options={Array.from({length: 10}, (_, i) => ({ value: (i + 1).toString(), label: `Level ${i + 1}` }))} 
              value={formData.occurrence_level.toString()} 
              onChange={(e: any) => setFormData({...formData, occurrence_level: parseInt(e.target.value)})} 
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Responsible Team</label>
            <input 
              value={formData.responsible_team} 
              onChange={e => setFormData({...formData, responsible_team: e.target.value})} 
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm font-bold text-white outline-none focus:border-amber-500" 
              placeholder="e.g. SRE"
            />
          </div>
        </div>
      </div>
    </WorkspaceModal>
  )
}


export function MitigationFormModal({ isOpen, onClose, onSave, modeId, modeVersion, causeId, type, bkms, monitoring, initialData = null }: any) {
  const [formData, setFormData] = useState(() => buildFarMitigationFormState(type, initialData))
  const queryClient = useQueryClient()
  const isEditing = Boolean(initialData?.id)
  const isMonitoring = formData.mitigation_type === 'Monitoring'
  const isWorkaround = formData.mitigation_type === 'Workaround'

  useEffect(() => {
    if (isOpen) setFormData(buildFarMitigationFormState(type, initialData))
  }, [type, initialData, isOpen])

  const mutation = useMutation({
    mutationFn: async (data: FarMitigationFormState) => {
       const payload = buildFarMitigationPayload(data, modeId, causeId)
       const url = isEditing ? `/api/v1/far/mitigations/${initialData.id}` : '/api/v1/far/mitigations'
       const res = await apiFetch(url, {
         method: isEditing ? 'PUT' : 'POST',
         body: JSON.stringify(buildFarContextMutationRequest(modeId, modeVersion, payload)),
       })
       if (!res.ok) throw new Error(await readFarMutationFailureMessage(res))
       return res.json()
    },
    onSuccess: (data) => {
       toast.success(isEditing ? 'Mitigation Updated' : 'Mitigation Synchronized')
       onSave(data)
       onClose()
       queryClient.invalidateQueries({ queryKey: ['far', 'modes'] })
       queryClient.invalidateQueries({ queryKey: ['far-failure-modes'] })
    },
    meta: { handlesErrorToast: true },
    onError: (error: any) => toast.error(error?.message || 'Mitigation mutation failed')
  })

  const statusOptions = getFarMitigationStatusOptions(isEditing ? initialData?.status : undefined)
  const validBkms = (bkms || []).filter((b: any) => !b.is_deleted && b.status === 'Published')
  const validMonitoring = (monitoring || []).filter((m: any) => !m.is_deleted && ['Existing', 'Planned'].includes(m.status))

  return (
    <WorkspaceModal
      isOpen={isOpen}
      onClose={onClose}
      size="standard"
      title={isEditing ? `Edit ${formData.mitigation_type}` : `New ${isMonitoring ? 'Monitoring Shield' : 'Response Protocol'}`}
      subtitle="Defensive Strategy Deployment"
      icon={isMonitoring ? <Monitor size={24} className="text-blue-400" /> : <ShieldCheck size={24} className="text-blue-400" />}
      footerRight={(
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-black/20 px-4 py-2 text-[10px] font-black uppercase text-slate-300 transition-colors hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate(formData)}
            disabled={!formData.mitigation_steps.trim() || mutation.isPending}
            className={`inline-flex items-center gap-2 rounded-lg px-6 py-2 text-[10px] font-black uppercase text-white transition-colors disabled:opacity-50 shadow-lg ${isMonitoring ? 'bg-sky-600 hover:bg-sky-500 shadow-sky-600/20' : 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/20'}`}
          >
            {mutation.isPending ? <Activity size={12} className="animate-spin" /> : <Save size={12} />}
            {isEditing ? 'Save Strategic Action' : 'Commit Strategic Action'}
          </button>
        </>
      )}
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Deployment Narrative / Steps</label>
          <textarea
            value={formData.mitigation_steps}
            onChange={e => setFormData({...formData, mitigation_steps: e.target.value})}
            className="w-full bg-black/40 border border-white/10 rounded-lg p-4 text-sm font-bold text-white outline-none focus:border-blue-500 min-h-[120px] custom-scrollbar resize-y"
            placeholder="Describe the deployment protocol..."
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Owner Team</label>
            <input
              value={formData.responsible_team}
              onChange={e => setFormData({...formData, responsible_team: e.target.value})}
              placeholder="e.g. SRE"
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-[12px] font-bold text-white outline-none focus:border-white/20"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Status</label>
            <StyledSelect
              options={statusOptions.map(status => ({ value: status, label: status.toUpperCase() }))}
              value={formData.status}
              onChange={(e: any) => setFormData({...formData, status: e.target.value})}
            />
          </div>
        </div>

        {isWorkaround && (
          <div className="bg-black/20 p-6 rounded-lg border border-white/5 space-y-5 shadow-inner">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">BKM Alignment</label>
              <div className="flex bg-black/40 p-1 rounded-lg border border-white/5">
                <button
                  type="button"
                  onClick={() => setFormData({...formData, bkm_mode: 'input', bkm_id: ''})}
                  className={`px-4 py-1.5 rounded-lg text-[9px] font-bold uppercase transition-all ${formData.bkm_mode === 'input' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-600 hover:text-slate-400'}`}
                >
                  Paste Link
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({...formData, bkm_mode: 'link', external_bkm_url: ''})}
                  className={`px-4 py-1.5 rounded-lg text-[9px] font-bold uppercase transition-all ${formData.bkm_mode === 'link' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-600 hover:text-slate-400'}`}
                >
                  Direct Link
                </button>
              </div>
            </div>
            {formData.bkm_mode === 'input' ? (
              <input
                value={formData.external_bkm_url}
                onChange={e => setFormData({...formData, external_bkm_url: e.target.value})}
                placeholder="Paste external BKM link..."
                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-[11px] font-bold text-blue-400 outline-none focus:border-white/20"
              />
            ) : (
              <StyledSelect
                options={[
                  { value: '', label: 'SELECT BKM ARTIFACT...' },
                  ...validBkms.map((b: any) => ({ value: b.id.toString(), label: b.title }))
                ]}
                value={formData.bkm_id}
                onChange={(e: any) => setFormData({...formData, bkm_id: e.target.value})}
              />
            )}
          </div>
        )}

        {isMonitoring && (
          <div className="bg-black/20 p-6 rounded-lg border border-white/5 space-y-4 shadow-inner">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Active Monitor Linkage</label>
            <StyledSelect
              options={[
                { value: '', label: 'SELECT MONITOR...' },
                ...validMonitoring.map((m: any) => ({ value: m.id.toString(), label: m.title }))
              ]}
              value={formData.monitoring_item_id}
              onChange={(e: any) => setFormData({...formData, monitoring_item_id: e.target.value})}
            />
          </div>
        )}

        {formData.mitigation_type === 'Process Change' && (
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-4 py-3 text-[10px] font-bold text-violet-300">
            Process Change mitigations preserve their type and do not carry BKM or Monitoring provenance.
          </div>
        )}
      </div>
    </WorkspaceModal>
  )
}
export function PreventionFormModal({ isOpen, onClose, onSave, modeId, modeVersion, causeId }: any) {
  const queryClient = useQueryClient()

  const projectMutation = useMutation({
    mutationFn: async (data: any) => {
       const res = await apiFetch('/api/v1/far/prevention', {
         method: 'POST',
         body: JSON.stringify(buildFarContextMutationRequest(modeId, modeVersion, {
           cause_id: causeId,
           project: data,
         })),
       })
       if (!res.ok) throw new Error(await readFarMutationFailureMessage(res))
       return res.json()
    },
    onSuccess: (data) => {
       toast.success('Prevention Project Linked to FAR');
       onSave(data);
       onClose();
       queryClient.invalidateQueries({ queryKey: ['far', 'modes'] })
       queryClient.invalidateQueries({ queryKey: ['far-failure-modes'] })
       queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
    meta: { handlesErrorToast: true },
    onError: (error: any) => toast.error(error?.message || 'Prevention project mutation failed')
  })

  return (
    <WorkspaceModal
      isOpen={isOpen}
      onClose={onClose}
      size="wide"
      title="Initiate Prevention Project"
      subtitle="Architectural Hardening & Risk Elimination"
      icon={<ShieldCheck size={24} className="text-emerald-400" />}
      footerRight={(
        <button 
          type="button"
          onClick={onClose} 
          className="rounded-lg border border-white/10 bg-black/20 px-4 py-2 text-[10px] font-black uppercase text-slate-300 transition-colors hover:text-white"
        >
          Cancel
        </button>
      )}
    >
      <div className="-mx-2">
        <ProjectForm 
          initialData={{ name: `PREVENTION PROJECT`, description: '', status: 'Planning', priority: 'High' }}
          onSave={projectMutation.mutate}
          isSaving={projectMutation.isPending}
          onCancel={onClose}
        />
      </div>
    </WorkspaceModal>
  )
}

export function ResolutionManagerModal({ isOpen, onClose, cause, modeId, modeVersion, onSave }: any) {
  const [search, setSearch] = useState('')
  const [selectedBkm, setSelectedBkm] = useState<any>(null)
  const [guidanceNotes, setGuidanceNotes] = useState('')
  const queryClient = useQueryClient()

  const { data: bkms } = useQuery({ 
    queryKey: ['knowledge', 'bkms'], 
    queryFn: async () => (await apiFetch('/api/v1/knowledge/?category=BKM')).json() 
  })

  const filteredBkms = bkms?.filter((b: any) => 
    !search || b.title.toLowerCase().includes(search.toLowerCase())
  ).filter((b: any) => !cause?.resolutions?.some((r: any) => r.knowledge_id === b.id))

  const addMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiFetch('/api/v1/far/resolutions', {
        method: 'POST',
        body: JSON.stringify(buildFarContextMutationRequest(modeId, modeVersion, { ...data, cause_ids: [cause.id] }))
      })
      if (!res.ok) throw new Error(await readFarMutationFailureMessage(res))
      return res.json()
    },
    onSuccess: () => {
      toast.success('BKM Artifact Linked');
      setSelectedBkm(null);
      setGuidanceNotes('');
      queryClient.invalidateQueries({ queryKey: ['far', 'modes'] })
      if (onSave) onSave()
    },
    meta: { handlesErrorToast: true },
    onError: (err: any) => toast.error(`Linking Failed: ${err.message}`)
  })

  const deleteResolutionMutation = useMutation({
    mutationFn: async (resId: number) => {
      const res = await apiFetch(`/api/v1/far/resolutions/${resId}`, {
        method: 'DELETE',
        body: JSON.stringify(buildFarContextMutationRequest(modeId, modeVersion, { cause_id: Number(cause.id) })),
      })
      if (!res.ok) throw new Error(await readFarMutationFailureMessage(res))
      return res.json()
    },
    onSuccess: () => {
      toast.success('BKM Linkage Purged')
      queryClient.invalidateQueries({ queryKey: ['far', 'modes'] })
      if (onSave) onSave()
    },
    meta: { handlesErrorToast: true },
    onError: (error: any) => toast.error(error?.message || 'Resolution unlink failed')
  })

  return (
    <WorkspaceModal
      isOpen={isOpen}
      onClose={onClose}
      size="wide"
      title="Resolution Management Registry"
      subtitle={`Cause: ${cause?.cause_text}`}
      icon={<ShieldCheck size={24} className="text-emerald-400" />}
      footerRight={(
        <button 
          type="button"
          onClick={onClose} 
          className="rounded-lg border border-white/10 bg-black/20 px-4 py-2 text-[10px] font-black uppercase text-slate-300 transition-colors hover:text-white"
        >
          Dismiss
        </button>
      )}
    >
      <div className="grid grid-cols-12 gap-8 min-h-[500px]">
        {/* Active Resolutions */}
        <div className="col-span-7 flex flex-col space-y-4">
           <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Active Guidance Protocols</h3>
              <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">{(cause?.resolutions || []).length} Linked Artifacts</span>
           </div>
           
           <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3">
              {(cause?.resolutions || []).map((res: any) => (
                <div key={res.id} className="bg-white/5 border border-white/5 rounded-lg p-5 group hover:border-emerald-500/30 transition-all shadow-xl">
                   <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                         <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400 border border-emerald-500/20">
                            <Zap size={16}/>
                         </div>
                         <p className="text-[11px] font-black text-white uppercase tracking-tight">{res.knowledge_bkm?.title || 'UNNAMED_BKM'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                         <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tight">{formatAppDate(res.created_at)}</span>
                         <button 
                            onClick={() => deleteResolutionMutation.mutate(res.id)} 
                            disabled={deleteResolutionMutation.isPending}
                            className="p-1.5 text-slate-600 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                         >
                            {deleteResolutionMutation.isPending ? <Activity size={14} className="animate-spin" /> : <X size={14}/>}
                         </button>
                      </div>
                   </div>
                   <div className="bg-black/40 border border-white/5 rounded-lg p-3 text-[10px] font-bold text-slate-400 uppercase leading-relaxed tracking-tight shadow-inner">
                      {res.guidance_notes || res.preventive_follow_up || 'NO GUIDANCE NOTES PROVIDED.'}
                   </div>
                </div>
              ))}
              {(!cause?.resolutions || cause.resolutions.length === 0) && (
                <div className="h-full flex flex-col items-center justify-center opacity-20 space-y-4">
                   <ShieldCheck size={48} className="text-slate-500" />
                   <p className="text-[11px] font-black uppercase tracking-[0.2em]">No resolutions established</p>
                </div>
              )}
           </div>
        </div>

        {/* BKM Search & Link */}
        <div className="col-span-5 flex flex-col space-y-4 border-l border-white/5 pl-8">
           <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Add Guidance Artifact</h3>
              {selectedBkm && (
                <button onClick={() => setSelectedBkm(null)} className="text-[9px] font-black text-rose-500 uppercase tracking-widest hover:underline">Clear Selection</button>
              )}
           </div>

           {!selectedBkm ? (
             <div className="flex flex-col flex-1 space-y-4">
                <div className="relative">
                   <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" />
                   <input 
                     value={search} 
                     onChange={e => setSearch(e.target.value)} 
                     placeholder="SCAN BKM REGISTRY..." 
                     className="w-full bg-black/40 border border-white/10 rounded-lg pl-11 pr-4 py-3 text-[10px] font-black text-white outline-none focus:border-emerald-500" 
                   />
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
                   {filteredBkms?.map((b: any) => (
                     <button 
                       key={b.id} 
                       onClick={() => setSelectedBkm(b)}
                       className="w-full text-left p-4 rounded-lg bg-white/5 border border-white/5 hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all group"
                     >
                        <p className="text-[11px] font-black text-white uppercase tracking-tight">{b.title}</p>
                        <p className="text-[9px] text-slate-500 font-bold uppercase mt-1">Category: {b.category}</p>
                     </button>
                   ))}
                </div>
             </div>
           ) : (
             <div className="flex flex-col flex-1 space-y-6">
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-5 space-y-3 shadow-lg">
                   <p className="text-[9px] font-black text-emerald-500 uppercase tracking-widest leading-none">Selected Artifact</p>
                   <p className="text-[13px] font-black text-white uppercase tracking-tighter leading-tight">{selectedBkm.title}</p>
                </div>

                <div className="space-y-2">
                   <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest px-1">Operational Guidance Notes</label>
                   <textarea 
                     value={guidanceNotes} 
                     onChange={e => setGuidanceNotes(e.target.value)} 
                     placeholder="Provide specific instructions for this failure context..." 
                     className="w-full bg-black/40 border border-white/10 rounded-lg p-4 text-[11px] font-black text-white outline-none focus:border-emerald-500 min-h-[150px] uppercase custom-scrollbar shadow-inner" 
                   />
                </div>

                <button 
                  onClick={() => addMutation.mutate({ knowledge_id: selectedBkm.id, guidance_notes: guidanceNotes })}
                  disabled={addMutation.isPending}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-emerald-600/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                   {addMutation.isPending ? <Activity size={12} className="animate-spin" /> : <Save size={12} />}
                   Commit BKM Linkage
                </button>
             </div>
           )}
        </div>
      </div>
    </WorkspaceModal>
  )
}

function formatAppDate(dateStr: string) {
  if (!dateStr) return 'N/A'
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()
  } catch (e) {
    return 'INVALID DATE'
  }
}
