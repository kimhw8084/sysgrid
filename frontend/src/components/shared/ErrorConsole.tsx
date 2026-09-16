import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Terminal, AlertTriangle, Bug, Clock, Search, Trash2, ChevronRight, ChevronDown, Copy, ExternalLink, ShieldAlert, TerminalSquare, Filter, Database, Cpu, CheckCircle2, History as HistoryIcon, Activity, Globe } from 'lucide-react'
import { useErrors, SysError } from '../../stores/errorStore'
import { formatAppDate, formatAppTime } from '../../utils/dateUtils'
import { toast } from 'react-hot-toast'
import { redactText } from '../../api/bootstrapDiagnostics'

export function ErrorConsole() {
  const { errors, isOpen, setOpen, clearErrors, acknowledgeError, acknowledgeAll } = useErrors()
  const [selectedErrorId, setSelectedErrorId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'frontend' | 'backend'>('all')
  const [showAcknowledged, setShowAcknowledged] = useState(true)

  const filteredErrors = useMemo(() => {
    return errors.filter(e => {
      const matchesSearch = e.message.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            e.url?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            e.stack?.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesType = filterType === 'all' || e.type.toLowerCase() === filterType
      const matchesAck = showAcknowledged || !e.acknowledged
      return matchesSearch && matchesType && matchesAck
    })
  }, [errors, searchTerm, filterType, showAcknowledged])

  const selectedError = useMemo(() => errors.find(e => e.id === selectedErrorId), [errors, selectedErrorId])

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Technical details copied')
  }

  const buganizerUrl = (
    localStorage.getItem('SYSGRID_BUGANIZER_URL') ||
    localStorage.getItem('SYSGRID_CONFIG_VITE_BUGANIZER_URL') ||
    String(import.meta.env.VITE_BUGANIZER_URL || '')
  ).trim()

  const buildSelectedErrorReport = (error: SysError) => redactText([
    'SysGrid runtime error',
    `Message: ${error.message}`,
    `Timestamp: ${error.timestamp}`,
    `Severity: ${error.severity}`,
    `Type: ${error.type}`,
    `View: ${error.view || '<unknown>'}`,
    `Method: ${error.method || '<unknown>'}`,
    `URL: ${error.finalUrl || error.url || '<unknown>'}`,
    `HTTP status: ${error.status || '<none>'} ${error.statusText || ''}`.trim(),
    `Content type: ${error.contentType || '<missing>'}`,
    `Redirected: ${error.redirected ? 'yes' : 'no'}`,
    `Request ID: ${error.requestId || '<missing>'}`,
    `Browser origin: ${error.browserOrigin || window.location.origin}`,
    `Configured API base: ${error.configuredApiBase || '<blank>'}`,
    `Browser online: ${error.browserOnline == null ? '<unknown>' : (error.browserOnline ? 'yes' : 'no')}`,
    '',
    'Response excerpt:',
    error.rawBody || JSON.stringify(error.data || {}, null, 2),
    '',
    'Stack:',
    error.stack || '<none>',
  ].join('\n'))

  const copyBugReport = async (error: SysError) => {
    await navigator.clipboard.writeText(buildSelectedErrorReport(error))
    toast.success('Sanitized error report copied')
  }

  const openBuganizer = async (error: SysError) => {
    await copyBugReport(error)
    if (/^https?:\/\//i.test(buganizerUrl)) {
      window.open(buganizerUrl, '_blank', 'noopener,noreferrer')
    }
  }

  if (!isOpen) return null

  return (
    <div className="sg-error-console fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 backdrop-blur-md p-6" role="dialog" aria-modal="true" aria-labelledby="sysgrid-error-console-title">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }} 
        animate={{ scale: 1, opacity: 1 }} 
        exit={{ scale: 0.95, opacity: 0 }}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-[85vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-lg border border-[var(--state-danger-border)] bg-[var(--surface-base)] shadow-2xl"
      >
        {/* Header */}
        <div className="px-8 py-5 border-b border-white/10 bg-white/5 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
               <div className="p-2 bg-rose-500/10 rounded-lg text-rose-500 border border-rose-500/20">
                  <Bug size={20} />
               </div>
               <div>
                  <h2 id="sysgrid-error-console-title" className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">Error console</h2>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">Frontend and API diagnostics</p>
               </div>
            </div>
            <div className="h-8 w-px bg-white/10" />
            <div className="flex items-center gap-4">
               <div className="flex flex-col">
                  <span className="text-[8px] font-bold uppercase text-slate-600">Total errors</span>
                  <span className="text-[12px] font-black text-rose-500">{errors.length}</span>
               </div>
               <div className="flex flex-col">
                  <span className="text-[8px] font-bold text-slate-600 uppercase">Pending</span>
                  <span className="text-[12px] font-black text-amber-500">{errors.filter(e => !e.acknowledged).length}</span>
               </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
             <button 
               onClick={() => acknowledgeAll()}
               className="px-4 py-2 bg-emerald-600/10 text-emerald-500 border border-emerald-500/20 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600/20 transition-all flex items-center gap-2"
             >
                <CheckCircle2 size={14} /> Acknowledge All
             </button>
             <div className="flex bg-black/40 rounded-lg p-1 border border-white/5 gap-1">
                {['all', 'frontend', 'backend'].map(type => (
                   <button 
                     key={type}
                     onClick={() => setFilterType(type as any)}
                     aria-pressed={filterType === type}
                     className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${filterType === type ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                   >
                      {type}
                   </button>
                ))}
             </div>
             <button 
               onClick={clearErrors}
               className="px-4 py-2 bg-rose-600/10 text-rose-500 border border-rose-500/20 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-rose-600/20 transition-all flex items-center gap-2"
             >
                <Trash2 size={14} /> Clear console
             </button>
             <button 
               onClick={() => setOpen(false)}
               aria-label="Close error console"
               className="p-2 text-slate-500 hover:text-white transition-all"
             >
               <X size={24} aria-hidden="true" />
             </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="px-8 py-4 border-b border-white/5 bg-black/40 flex items-center gap-4">
           <div className="relative flex-1">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
              <input 
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search error messages, stack traces, or endpoints..."
                className="w-full bg-black/40 border border-white/10 rounded-lg pl-12 pr-4 py-3 text-xs font-bold text-white uppercase outline-none focus:border-rose-500/40 transition-all placeholder:text-slate-600"
              />
           </div>
           <button 
             onClick={() => setShowAcknowledged(!showAcknowledged)}
             className={`flex items-center gap-2 px-4 py-3 rounded-lg border text-[10px] font-black uppercase tracking-widest transition-all ${showAcknowledged ? 'bg-blue-600/10 border-blue-500/20 text-blue-400' : 'bg-white/5 border-white/5 text-slate-500'}`}
           >
              <HistoryIcon size={14} /> {showAcknowledged ? 'Showing All' : 'Active Only'}
           </button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Error List */}
          <div className="w-[450px] border-r border-white/10 flex flex-col bg-black/20">
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {filteredErrors.map(error => (
                <div 
                  key={error.id}
                  onClick={() => setSelectedErrorId(error.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedErrorId(error.id)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Inspect error: ${error.message}`}
                  className={`px-6 py-4 border-b border-white/5 cursor-pointer transition-all hover:bg-white/[0.03] group relative ${selectedErrorId === error.id ? 'bg-rose-500/5 border-l-4 border-l-rose-500' : ''} ${error.acknowledged ? 'opacity-50 grayscale' : ''}`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                       <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-lg ${error.type.toLowerCase() === 'backend' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                         {error.type}
                       </span>
                       <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-lg ${error.severity === 'critical' ? 'bg-rose-600 text-white' : 'bg-rose-500/20 text-rose-400'}`}>
                          {error.severity}
                       </span>
                       {error.acknowledged && (
                         <span className="text-[8px] font-black px-1.5 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-400 uppercase">ACKNOWLEDGED</span>
                       )}
                    </div>
                    <span className="text-[9px] font-bold text-slate-600 tabular-nums">
                       {new Date(error.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-[11px] font-black text-slate-200 line-clamp-2 leading-snug group-hover:text-white transition-colors">
                    {error.message}
                  </p>
                  {error.url && (
                    <div className="mt-2 flex items-center gap-1.5 text-[8px] font-bold text-slate-500 uppercase tracking-tight">
                       <Globe size={10} />
                       <span className="truncate">{error.url}</span>
                    </div>
                  )}
                </div>
              ))}
              {filteredErrors.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center p-12 text-center">
                   <CheckCircle2 size={48} className="text-emerald-500/20 mb-4" />
                   <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">No errors found</h3>
                   <p className="text-[10px] text-slate-600 mt-2">No matching errors in the current view</p>
                </div>
              )}
            </div>
          </div>

          {/* Error Detail */}
          <div className="flex-1 bg-black/40 flex flex-col min-w-0">
             {selectedError ? (
               <div className="flex-1 overflow-y-auto custom-scrollbar p-10 space-y-8">
                  <div className="space-y-4">
                     <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                           <div className={`w-3 h-3 rounded-full ${selectedError.severity === 'critical' ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]' : 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]'}`} />
                           <h3 className="text-2xl font-black text-white tracking-tighter uppercase">{selectedError.message}</h3>
                        </div>
                        <div className="flex items-center gap-2">
                           <button 
                             onClick={() => acknowledgeError(selectedError.id)}
                             disabled={selectedError.acknowledged}
                             className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${selectedError.acknowledged ? 'bg-emerald-500/20 text-emerald-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-500 active:scale-95'}`}
                           >
                              {selectedError.acknowledged ? 'Acknowledged' : 'Acknowledge error'}
                           </button>
                           <button 
                             onClick={() => copyBugReport(selectedError)}
                             className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-slate-400 transition-all hover:bg-white/10 hover:text-white"
                           >
                              <Copy size={14} /> Copy Bug Report
                           </button>
                           <button
                             onClick={() => openBuganizer(selectedError)}
                             className="flex items-center gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-rose-300 transition-all hover:bg-rose-500/20"
                           >
                              <ExternalLink size={14} /> {buganizerUrl ? 'Open Buganizer' : 'Copy Only'}
                           </button>
                        </div>
                     </div>

                     <div className="grid grid-cols-4 gap-4">
                        {[
                           { label: 'Time of Failure', val: formatAppDate(selectedError.timestamp), icon: Clock },
                           { label: 'Fault Domain', val: selectedError.type, icon: Database },
                           { label: 'Severity Level', val: selectedError.severity, icon: ShieldAlert },
                           { label: 'Execution Path', val: selectedError.view || '/', icon: TerminalSquare }
                        ].map(m => (
                          <div key={m.label} className="bg-white/[0.03] border border-white/5 rounded-lg p-4">
                             <div className="flex items-center gap-2 text-slate-500 mb-1">
                                <m.icon size={12} />
                                <span className="text-[9px] font-bold uppercase tracking-widest">{m.label}</span>
                             </div>
                             <p className="text-[11px] font-black text-slate-200">{m.val}</p>
                          </div>
                        ))}
                     </div>
                  </div>

                  {selectedError.url && (
                    <div className="space-y-3">
                       <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                          <Globe size={14} /> Request Context
                       </h4>
                       <div className="bg-slate-950 border border-white/5 rounded-lg p-6 font-mono text-[11px] space-y-2">
                          <div className="flex gap-4"><span className="text-blue-400 w-16">ENDPOINT</span> <span className="text-slate-300">{selectedError.url}</span></div>
                          <div className="flex gap-4"><span className="text-blue-400 w-16">METHOD</span> <span className="text-emerald-400">{selectedError.method || 'GET'}</span></div>
                          <div className="flex gap-4"><span className="text-blue-400 w-16">STATUS</span> <span className="text-amber-400">{selectedError.status || 'N/A'} {selectedError.statusText || ''}</span></div>
                          <div className="flex gap-4"><span className="text-blue-400 w-16">TYPE</span> <span className="text-slate-300">{selectedError.contentType || 'N/A'}</span></div>
                          <div className="flex gap-4"><span className="text-blue-400 w-16">FINAL</span> <span className="break-all text-slate-300">{selectedError.finalUrl || selectedError.url}</span></div>
                          <div className="flex gap-4"><span className="text-blue-400 w-16">REQ ID</span> <span className="text-slate-300">{selectedError.requestId || 'N/A'}</span></div>
                       </div>
                    </div>
                  )}

                  {selectedError.stack && (
                    <div className="space-y-3">
                       <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                          <Terminal size={14} /> Technical details
                       </h4>
                       <div className="bg-[#020617] border border-rose-500/20 rounded-lg p-6 font-mono text-[11px] leading-relaxed relative group shadow-2xl">
                          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                             <button type="button" onClick={() => copyToClipboard(selectedError.stack || '')} aria-label="Copy technical details" className="text-slate-600 hover:text-white"><Copy size={16} aria-hidden="true" /></button>
                          </div>
                          <pre className="text-rose-400/80 whitespace-pre-wrap overflow-x-auto custom-scrollbar max-h-[400px]">
                             {selectedError.stack}
                          </pre>
                       </div>
                    </div>
                  )}

                  {selectedError.data && (
                    <div className="space-y-3">
                       <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                          <Database size={14} /> Payload Inspection
                       </h4>
                       <div className="bg-slate-950 border border-white/5 rounded-lg p-6 font-mono text-[11px]">
                          <pre className="text-emerald-400/80 overflow-x-auto custom-scrollbar">
                             {JSON.stringify(selectedError.data, null, 2)}
                          </pre>
                       </div>
                    </div>
                  )}
               </div>
             ) : (
               <div className="flex-1 flex flex-col items-center justify-center p-20 text-center space-y-6">
                  <div className="w-24 h-24 rounded-lg border-4 border-dashed border-white/10 flex items-center justify-center text-slate-700 animate-[spin_10s_linear_infinite]">
                     <TerminalSquare size={48} />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-400 uppercase tracking-tighter">Select an error</h3>
                    <p className="text-[10px] text-slate-600 max-w-xs mt-2 mx-auto leading-relaxed uppercase font-bold">
                       Select an error from the list to inspect its request context and captured details.
                    </p>
                  </div>
               </div>
             )}

             <div className="px-8 py-4 border-t border-white/5 bg-black/20 shrink-0 flex items-center justify-between">
                <div className="flex items-center gap-6 text-[8px] font-black text-slate-500 uppercase tracking-widest">
                   <div className="flex items-center gap-2">
                      <Cpu size={12} className="text-slate-600" />
                      <span>ERROR RETENTION: 100 RECORDS</span>
                   </div>
                   <div className="flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-slate-800" />
                      <span>LOCAL DIAGNOSTICS</span>
                   </div>
                   <div className="flex items-center gap-2">
                      <span className="text-rose-500">SYSGRID BUGANIZER</span>
                      <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                   </div>
                </div>
             </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
