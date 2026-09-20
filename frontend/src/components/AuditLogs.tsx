import React, { useMemo, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { useQuery } from '@tanstack/react-query'
import { Activity, Calendar, RefreshCcw, Zap, Layers, X, Search, Filter, Download, BarChart2, Clock } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '../api/apiClient'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader, PageToolbar, ToolbarButton, ToolbarGroup, ToolbarIconButton, ToolbarSearch } from './shared/LayoutPrimitives'
import { formatAppDate, formatAppTime, formatAppDay, parseAppDate } from '../utils/dateUtils'
import { ModulePolicyButton } from '../policy/ModulePolicy'
import {
  buildAuditQueryUrl,
  buildAuditExportFileName,
  createAuditQueryDescriptor,
  getAuditQueryKey,
  parseAuditResponse,
} from './audit/auditQuery'
import { resolveOperationalObjectReference } from './shared/OperationalObjectReference'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'

export default function AuditLogs() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const gridRef = React.useRef<any>(null)
  const [gridApi, setGridApi] = useState<any>(null)
  const [gridColumnApi, setGridColumnApi] = useState<any>(null)
  const [fontSize, setFontSize] = useState(11)
  const [rowDensity, setRowDensity] = useState(10)
  const [showStyleLab, setShowStyleLab] = useState(false)
  const [showCharts, setShowCharts] = useState(true)
  const [quickSearch, setQuickSearch] = useState('')
  const [activeLog, setActiveLog] = useState<any>(null)
  const targetTableParam = searchParams.get('target_table') || ''
  const targetIdParam = searchParams.get('target_id') || ''

  const [dateRange, setDateRange] = useState({ start: '', end: '' })
  const auditQuery = useMemo(() => createAuditQueryDescriptor({
    start_date: dateRange.start,
    end_date: dateRange.end,
    target_table: targetTableParam,
    target_id: targetIdParam,
    limit: 200,
    offset: 0,
  }), [dateRange.end, dateRange.start, targetIdParam, targetTableParam])

  const { data: auditResult, isLoading } = useQuery({
    queryKey: getAuditQueryKey(auditQuery),
    queryFn: async () => {
      const res = await apiFetch(buildAuditQueryUrl(auditQuery))
      return parseAuditResponse<any>(res, auditQuery)
    },
  })
  const logs = auditResult?.items || []
  const scope = auditResult?.scope
  const scopeText = scope?.complete
    ? 'Complete matching scope'
    : `Loaded ${logs.length} records${scope?.hasMore ? ' · more matching records' : ' · matching scope is bounded'}`

  // Prepare chart data
  const chartData = useMemo(() => {
    if (!Array.isArray(logs)) return []
    const dailyMap: Record<string, number> = {}
    logs.forEach(log => {
      const date = formatAppDay(log.timestamp)
      dailyMap[date] = (dailyMap[date] || 0) + 1
    })
    return Object.entries(dailyMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => (parseAppDate(a.name)?.getTime() || 0) - (parseAppDate(b.name)?.getTime() || 0))
      .slice(-14) // Last 14 days
  }, [logs])

  const opsData = useMemo(() => {
    if (!Array.isArray(logs)) return []
    const opsMap: Record<string, number> = {}
    logs.forEach(log => {
      opsMap[log.action] = (opsMap[log.action] || 0) + 1
    })
    return Object.entries(opsMap).map(([name, value]) => ({ name, value }))
  }, [logs])

  React.useEffect(() => {
    if (gridRef.current?.api) {
      setTimeout(() => gridRef.current.api.autoSizeAllColumns(), 100)
    }
  }, [fontSize, rowDensity, logs, showCharts])

  const handleExportCSV = () => {
    if (gridRef.current?.api) {
      gridRef.current.api.exportDataAsCsv({
        fileName: buildAuditExportFileName(),
        onlySelected: false,
      })
    }
  }

  const openTarget = (log: any) => {
    const target = resolveOperationalObjectReference(log?.target_table, log?.target_id)
    if (!target) return
    navigate(target.path)
  }

  const columnDefs = useMemo(() => [
    { 
      field: 'timestamp', 
      headerName: 'TRANSACTION TIME', 
      width: 180, 
      sortable: true, 
      filter: 'agDateColumnFilter', 
      pinned: 'left' as const,
      cellClass: 'text-center font-bold text-blue-400', 
      headerClass: 'text-center', 
      cellRenderer: (p: any) => p.value ? (
        <div className="flex items-center gap-2">
           <Clock size={12} className="opacity-40" />
           <span>{formatAppDate(p.value)}</span>
        </div>
      ) : <span className="text-slate-500 font-bold uppercase">N/A</span> 
    },
    { 
      field: 'action', 
      headerName: 'OPERATION', 
      width: 120,
      filter: true,
      cellClass: 'text-center',
      headerClass: 'text-center',
      cellRenderer: (params: any) => {
        const colors: Record<string, string> = { 
            CREATE: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', 
            UPDATE: 'bg-blue-500/10 text-blue-400 border-blue-500/20', 
            DELETE: 'bg-rose-500/10 text-rose-400 border-rose-500/20', 
            MOUNT: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20', 
            LINK: 'bg-amber-500/10 text-amber-400 border-amber-500/20' 
        }
        return (
          <div className={`px-2 py-1 rounded-lg border ${colors[params.value] || 'bg-slate-500/10 text-slate-400'} font-black text-[9px] uppercase tracking-widest`}>
             {params.value || 'N/A'}
          </div>
        )
      }
    },
    { 
        field: 'user_id', 
        headerName: 'ADMINISTRATOR', 
        width: 140, 
        filter: true, 
        cellClass: 'text-center font-bold text-white', 
        headerClass: 'text-center',
        cellRenderer: (p: any) => (
            <div className="flex items-center justify-center gap-2">
               <div className="w-5 h-5 rounded-lg bg-blue-600/20 border border-blue-500/20 flex items-center justify-center text-[8px]">{p.value?.slice(0,2).toUpperCase()}</div>
               <span className="truncate">{p.value || 'SYSTEM'}</span>
            </div>
        )
    },
    { 
        field: 'target_table', 
        headerName: 'REGISTRY', 
        width: 130, 
        filter: true, 
        cellClass: 'text-center font-bold text-slate-400 uppercase tracking-tighter', 
        headerClass: 'text-center'
    },
    { 
        field: 'target_id', 
        headerName: 'ENTITY ID', 
        width: 100, 
        filter: true, 
        cellClass: 'text-center font-mono font-bold text-slate-500', 
        headerClass: 'text-center' 
    },
    { 
        field: 'description', 
        headerName: 'TRANSACTION PAYLOAD & ARCHITECTURAL IMPACT', 
        flex: 1, 
        filter: true, 
        cellClass: 'text-left font-bold text-slate-300', 
        headerClass: 'text-left',
        cellRenderer: (p: any) => (
            <span className="truncate">{p.value}</span>
        )
    },
    {
        headerName: 'ACTIONS',
        width: 150,
        pinned: 'right' as const,
        cellRenderer: (params: any) => {
          const target = resolveOperationalObjectReference(params.data?.target_table, params.data?.target_id)
          return (
            <div className="flex items-center justify-center gap-1">
              <ModulePolicyButton
                moduleId={target?.moduleId || 'home'}
                disabled={!target}
                disabledReason={!target ? 'No target route recorded.' : undefined}
                onClick={() => openTarget(params.data)}
                className="p-1.5 hover:bg-white/10 rounded-lg text-slate-500 hover:text-blue-400 transition-all"
                aria-label="Open target record"
              >
                <Search size={14} />
              </ModulePolicyButton>
              <button onClick={() => setActiveLog(params.data)} className="p-1.5 hover:bg-white/10 rounded-lg text-slate-500 hover:text-amber-400 transition-all" title="View change payload">
                <Layers size={14} />
              </button>
            </div>
          )
        }
    }
  ], [navigate])

  return (
    <div className="h-full flex flex-col bg-[#020617]">
      <div className="space-y-4 border-b border-white/5 bg-slate-950/40 px-8 py-6 backdrop-blur-xl">
        <PageHeader
          eyebrow="Registry"
          title={
            <span className="flex items-center gap-3 uppercase">
              <Zap className="text-blue-500" fill="currentColor" /> Audit Ledger
            </span>
          }
          subtitle="Immutable record of system state changes and operator actions"
          meta={
            <div className="flex flex-wrap items-center gap-3 text-[9px] font-black uppercase tracking-[0.2em]">
              {(targetTableParam || targetIdParam) && (
                <span className="text-blue-400">
                  Scoped: {targetTableParam || 'Any Table'} {targetIdParam ? `// ${targetIdParam}` : ''}
                </span>
              )}
              <span className="text-slate-500">{scopeText}</span>
            </div>
          }
        />

        <PageToolbar
          left={
            <>
              <ToolbarSearch
                value={quickSearch}
                onChange={(e) => {
                  setQuickSearch(e.target.value)
                  gridRef.current?.api?.setQuickFilter(e.target.value)
                }}
                placeholder="Quick scan ledger..."
              />
              <ToolbarGroup>
                <ToolbarButton active={showCharts} onClick={() => setShowCharts(!showCharts)}>
                  <span className="flex items-center gap-2">
                    <BarChart2 size={16} />
                    Analytics
                  </span>
                </ToolbarButton>
                <ToolbarIconButton active={showStyleLab} onClick={() => setShowStyleLab(!showStyleLab)} title="Toggle density controls">
                  <Activity size={16} />
                </ToolbarIconButton>
              </ToolbarGroup>
            </>
          }
          right={
            <>
              <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 shadow-inner">
                <Calendar size={14} className="ml-1 text-blue-500" />
                <div className="flex flex-col">
                  <span className="text-[7px] font-black uppercase text-slate-600">Start</span>
                  <input type="date" value={dateRange.start} onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))} className="bg-transparent text-[10px] font-black text-white outline-none" />
                </div>
                <div className="mx-1 h-6 w-px bg-white/5" />
                <div className="flex flex-col">
                  <span className="text-[7px] font-black uppercase text-slate-600">End</span>
                  <input type="date" value={dateRange.end} onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))} className="bg-transparent text-[10px] font-black text-white outline-none" />
                </div>
              </div>
              <ToolbarButton onClick={handleExportCSV} variant="primary" className="px-5 py-3">
                <span className="flex items-center gap-2">
                  <Download size={14} /> Export loaded CSV
                </span>
              </ToolbarButton>
            </>
          }
        />
      </div>

      <AnimatePresence>
        {showCharts && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 180, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden bg-slate-950/60 border-b border-white/5 px-8 flex items-center gap-12"
          >
             <div className="flex-1 h-[140px] py-4">
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                   <Activity size={12} className="text-blue-500" /> Transaction Velocity (Loaded result/page)
                </p>
                <ResponsiveContainer width="100%" height="100%">
                   <AreaChart data={chartData}>
                      <defs>
                         <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                         </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                      <XAxis dataKey="name" hide />
                      <Tooltip 
                         contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '10px', fontWeight: '900', textTransform: 'uppercase' }}
                         itemStyle={{ color: '#3b82f6' }}
                      />
                      <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorCount)" />
                   </AreaChart>
                </ResponsiveContainer>
             </div>

             <div className="w-[300px] h-[140px] py-4">
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                   <Filter size={12} className="text-indigo-500" /> Operation Distribution (Loaded result/page)
                </p>
                <ResponsiveContainer width="100%" height="100%">
                   <BarChart data={opsData} layout="vertical">
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" hide />
                      <Tooltip 
                         contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '10px', fontWeight: '900' }}
                      />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                         {opsData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={['#10b981', '#3b82f6', '#f43f5e', '#6366f1', '#f59e0b'][index % 5]} />
                         ))}
                      </Bar>
                   </BarChart>
                </ResponsiveContainer>
             </div>
             
             <div className="w-[200px] h-[140px] flex flex-col justify-center border-l border-white/5 pl-12">
                <div className="space-y-4">
                   <div>
                      <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Loaded Logs</p>
                      <p className="text-2xl font-black text-white">{logs?.length || 0}</p>
                   </div>
                   <div>
                      <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Unique Admins</p>
                      <p className="text-2xl font-black text-blue-400">{new Set(logs?.map(l => l.user_id)).size || 0}</p>
                   </div>
                </div>
             </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showStyleLab && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden bg-indigo-600/10 border-b border-indigo-500/20"
          >
            <div className="px-8 py-4 flex items-center justify-between backdrop-blur-md">
               <div className="flex items-center space-x-12">
                  <div className="flex items-center space-x-3">
                     <Activity size={16} className="text-indigo-400" />
                     <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">View Density Laboratory</span>
                  </div>
                  
                  <div className="flex items-center space-x-6">
                     <div className="flex items-center space-x-4">
                        <span className="text-[9px] font-black text-slate-500 uppercase">Font Size</span>
                        <div className="flex items-center space-x-2">
                            <input 
                            type="range" min="8" max="14" step="1" 
                            value={fontSize} onChange={e => setFontSize(Number(e.target.value))}
                            className="w-32 accent-indigo-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                            />
                            <span className="text-[10px] text-white w-4 font-bold tabular-nums">{fontSize}px</span>
                        </div>
                     </div>

                     <div className="flex items-center space-x-4 border-l border-white/10 pl-6">
                        <span className="text-[9px] font-black text-slate-500 uppercase">Row Density</span>
                        <div className="flex items-center space-x-2">
                            <input 
                            type="range" min="0" max="24" step="2" 
                            value={rowDensity} onChange={e => setRowDensity(Number(e.target.value))}
                            className="w-32 accent-blue-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                            />
                            <span className="text-[10px] text-white w-4 font-bold tabular-nums">{rowDensity}px</span>
                        </div>
                     </div>
                  </div>
               </div>
               <button onClick={() => setShowStyleLab(false)} className="text-slate-500 hover:text-white transition-colors p-2 hover:bg-white/5 rounded-lg"><X size={16}/></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-hidden relative ag-theme-alpine-dark">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#020617]/80 backdrop-blur-sm space-y-4">
             <RefreshCcw size={32} className="text-blue-400 animate-spin" />
             <p className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-400">Synchronizing Ledger Matrix...</p>
          </div>
        )}
        <AgGridReact
          ref={gridRef}
          rowData={logs}
          columnDefs={columnDefs}
          defaultColDef={{ 
              resizable: true, 
              filter: true, 
              sortable: true,
              menuTabs: ['filterMenuTab', 'generalMenuTab']
          }}
          animateRows={true}
          enableCellTextSelection={true}
          rowSelection="multiple"
          headerHeight={fontSize + rowDensity + 14}
          rowHeight={fontSize + rowDensity + 16}
          pagination={true}
          paginationPageSize={50}
        />
      </div>

      <AnimatePresence>
        {activeLog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-md p-6"
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="w-full max-w-4xl overflow-hidden rounded-lg border border-white/10 bg-slate-950 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-white/5 p-5">
                <div>
                  <h3 className="text-lg font-black uppercase tracking-tight text-white">Audit Change Payload</h3>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                    {activeLog.target_table} / {activeLog.target_id || 'N/A'}
                  </p>
                </div>
                <button onClick={() => setActiveLog(null)} className="text-slate-500 transition-colors hover:text-white">
                  <X size={18} />
                </button>
              </div>

              <div className="grid gap-4 p-5 md:grid-cols-2">
                <div className="rounded-lg border border-white/5 bg-black/30 p-4">
                  <p className="mb-2 text-[9px] font-black uppercase tracking-[0.2em] text-blue-400">Description</p>
                  <p className="text-[11px] font-bold leading-relaxed text-slate-300">{activeLog.description || 'No description captured.'}</p>
                </div>
                <div className="rounded-lg border border-white/5 bg-black/30 p-4">
                  <p className="mb-2 text-[9px] font-black uppercase tracking-[0.2em] text-blue-400">Change JSON</p>
                  <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words text-[10px] text-slate-300 custom-scrollbar">
                    {JSON.stringify(activeLog.changes || {}, null, 2)}
                  </pre>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .ag-theme-alpine-dark {
          --ag-background-color: #020617;
          --ag-header-background-color: #0f172a;
          --ag-border-color: rgba(255, 255, 255, 0.05);
          --ag-foreground-color: #f1f5f9;
          --ag-header-foreground-color: #3b82f6;
          --ag-font-family: 'Inter', sans-serif;
          --ag-font-size: ${fontSize}px;
          --ag-grid-size: 4px;
          --ag-list-item-height: 24px;
        }
        .ag-root-wrapper { border: none !important; }
        .ag-header-cell-label { 
            font-weight: 900 !important; 
            text-transform: uppercase !important; 
            letter-spacing: 0.15em !important; 
            font-size: ${fontSize - 2}px !important; 
            justify-content: center !important; 
            color: #64748b !important;
        }
        .ag-header-cell-pinned::after {
            background-color: rgba(59, 130, 246, 0.2) !important;
        }
        .ag-cell { 
            display: flex; 
            align-items: center; 
            justify-content: center !important; 
            font-weight: 700 !important;
            font-size: ${fontSize}px !important;
            border-right: 1px solid rgba(255,255,255,0.02) !important;
        }
        .ag-cell-focus { border: 1px solid #3b82f6 !important; background-color: rgba(59, 130, 246, 0.05) !important; }
        .ag-row { border-bottom: 1px solid rgba(255,255,255,0.03) !important; }
        .ag-row-hover { background-color: rgba(59, 130, 246, 0.03) !important; }
        .ag-row-selected { background-color: rgba(59, 130, 246, 0.1) !important; }
        .ag-paging-panel {
            background-color: #0f172a !important;
            border-top: 1px solid rgba(255,255,255,0.05) !important;
            color: #64748b !important;
            font-size: 10px !important;
            font-weight: 900 !important;
            text-transform: uppercase !important;
            height: 40px !important;
        }
        .ag-icon { color: #3b82f6 !important; }
        
        /* Custom Scrollbar for Grid */
        .ag-body-viewport::-webkit-scrollbar { width: 10px; height: 10px; }
        .ag-body-viewport::-webkit-scrollbar-track { background: transparent; }
        .ag-body-viewport::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.05); border-radius: 10px; }
        .ag-body-viewport::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.1); }
      `}</style>
    </div>
  )
}
