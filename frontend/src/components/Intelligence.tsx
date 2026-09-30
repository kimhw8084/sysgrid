import React, { useState } from 'react'
import { Upload, FileText, CheckCircle2, Clipboard, Download, AlertCircle, RefreshCcw, Save } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '../api/apiClient'
import { showWorkspaceToast } from './shared/WorkspaceToast'

export default function Intelligence() {
  const [dragActive, setDragActive] = useState(false)
  const [pasteData, setPasteData] = useState('')
  const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
  const queryClient = useQueryClient()

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      setStatus('uploading')
      const formData = new FormData()
      formData.append('file', file)
      const res = await apiFetch('/api/v1/import/csv', { method: 'POST', body: formData })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      setStatus('success')
      setTimeout(() => setStatus('idle'), 3000)
    },
    onError: (err: any) => {
      showWorkspaceToast(`Ingestion Error: ${err.message}`, { type: 'error' })
      setStatus('error')
    }
  })

  const handleDownloadTemplate = () => {
    // Force direct download from API
    const link = document.createElement('a')
    link.href = '/api/v1/import/template'
    link.setAttribute('download', 'SYSGRID_Blueprint.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handlePasteImport = () => {
    if (!pasteData.trim()) return
    const blob = new Blob([pasteData], { type: 'text/csv' })
    const file = new File([blob], 'clipboard_registry.csv')
    importMutation.mutate(file)
  }

  return (
    <div className="h-full flex flex-col space-y-8 max-w-5xl mx-auto overflow-y-auto custom-scrollbar pr-4">
      <div className="text-center space-y-2 mt-8">
        <h1 className="text-3xl font-black tracking-tighter uppercase">Intelligent Registry Provisioning</h1>
        <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em]">Automated multi-relational infrastructure ingestion engine</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Upload Sector */}
        <div 
          onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => { e.preventDefault(); setDragActive(false); if(e.dataTransfer.files[0]) importMutation.mutate(e.dataTransfer.files[0]) }}
          className={`glass-panel p-12 rounded-lg border-2 border-dashed transition-all flex flex-col items-center justify-center text-center space-y-6 relative overflow-hidden ${
            status === 'uploading' ? 'border-blue-500 bg-blue-500/5' : 
            status === 'success' ? 'border-emerald-500 bg-emerald-500/5' :
            dragActive ? 'border-blue-400 bg-blue-500/10' : 'border-white/10 bg-slate-900/20'
          }`}
        >
          <AnimatePresence mode="wait">
            {status === 'uploading' ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center space-y-4">
                <RefreshCcw size={48} className="text-blue-400 animate-spin" />
                <p className="text-[10px] font-black uppercase text-blue-400 tracking-widest">Normalizing Schema Relations...</p>
              </motion.div>
            ) : status === 'success' ? (
              <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center space-y-4">
                <div className="w-16 h-16 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                  <CheckCircle2 size={32} className="text-emerald-400" />
                </div>
                <p className="text-[10px] font-black uppercase text-emerald-400 tracking-widest">Entities Provisioned</p>
              </motion.div>
            ) : (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center space-y-6">
                <div className="w-20 h-20 bg-blue-500/10 rounded-lg flex items-center justify-center">
                  <Upload size={40} className="text-blue-500" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold uppercase tracking-tighter">Asset Registry Dropzone</h3>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed">
                    Drag CSV or <label className="text-blue-400 cursor-pointer hover:underline">browse files<input type="file" className="hidden" onChange={(e) => e.target.files && importMutation.mutate(e.target.files[0])} accept=".csv"/></label>
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Clipboard Sector */}
        <div className="glass-panel p-8 rounded-lg bg-slate-900/20 border border-white/5 flex flex-col space-y-4">
           <div className="flex items-center space-x-3">
              <Clipboard size={18} className="text-amber-400" />
              <h3 className="font-bold text-sm uppercase tracking-widest">Registry Clipboard</h3>
           </div>
           <textarea 
             value={pasteData}
             onChange={(e) => setPasteData(e.target.value)}
             className="flex-1 min-h-[140px] bg-slate-950/50 border border-white/5 rounded-lg p-4 text-[10px] font-mono outline-none focus:border-amber-500/30 text-slate-300 custom-scrollbar" 
             placeholder="hostname,system_name,model,serial_number...&#10;SRV-PRD-01,ERP-CORE,R740,SN12345..."
           />
           <button 
             onClick={handlePasteImport}
             disabled={status === 'uploading' || !pasteData.trim()}
             className="w-full py-4 bg-amber-600/10 text-amber-400 border border-amber-600/20 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-amber-600/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
           >
             <Save size={14}/>
             <span>Commit Raw Registry Data</span>
           </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-panel p-6 rounded-lg border-l-4 border-l-blue-500 bg-slate-900/40">
           <div className="flex items-center justify-between mb-4">
              <h4 className="font-black text-[10px] uppercase tracking-widest text-slate-400">1. Blueprint Download</h4>
              <button onClick={handleDownloadTemplate} className="p-2 bg-blue-500/10 rounded-lg hover:bg-blue-500/20 text-blue-400 transition-all"><Download size={16}/></button>
           </div>
           <p className="text-[10px] text-slate-500 leading-relaxed uppercase font-bold">Standardized CSV blueprint supporting recursive HW/SW sub-relations.</p>
        </div>

        <div className="glass-panel p-6 rounded-lg border-l-4 border-l-emerald-500 bg-slate-900/40">
           <div className="flex items-center space-x-3 mb-4">
              <CheckCircle2 size={18} className="text-emerald-400" />
              <h4 className="font-black text-[10px] uppercase tracking-widest text-slate-400">2. Relational Logic</h4>
           </div>
           <p className="text-[10px] text-slate-500 leading-relaxed uppercase font-bold">Automatically establishes 1:N (HW/SW) and N:1 (Logical System) entity groupings.</p>
        </div>

        <div className="glass-panel p-6 rounded-lg border-l-4 border-l-amber-500 bg-slate-900/40">
           <div className="flex items-center space-x-3 mb-4">
              <AlertCircle size={18} className="text-amber-400" />
              <h4 className="font-black text-[10px] uppercase tracking-widest text-slate-400">3. Registry Deduplication</h4>
           </div>
           <p className="text-[10px] text-slate-500 leading-relaxed uppercase font-bold">Atomic ingestion prevents corruption. Serial Numbers and Asset Tags are strictly validated.</p>
        </div>
      </div>
    </div>
  )
}
