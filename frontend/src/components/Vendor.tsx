import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Plus, Search, Trash2, Edit2, Info, Globe, 
  Save, X, PlusCircle, User, MessageSquare,
  MoreVertical, RefreshCcw, Shield, Eye,
  FileText, Briefcase, Calendar, LayoutGrid, List, Mail,
  Terminal, Monitor, Key, Clock, ShieldCheck, Check, ArrowRight, Server, Phone, Flag, ExternalLink, Trash, Zap, Layers, Activity, Settings, Sliders, Clipboard
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '../api/apiClient'
import { parseAppDate, formatAppDate, formatAppDay } from '../utils/dateUtils'
import { AgGridReact } from 'ag-grid-react'
import { toast } from 'react-hot-toast'
import { ConfirmationModal } from './shared/ConfirmationModal'
import { OPERATIONAL_GRID_AUTO_SIZE_STRATEGY } from './shared/OperationalGridSizing'
import { StyledSelect } from './shared/StyledSelect'
import { ConfigRegistryModal } from './ConfigRegistry'

// --- Components ---

const SectionHeader = ({ icon: Icon, title, color = "text-blue-400" }: any) => (
  <div className="flex items-center space-x-3 border-b border-white/5 pb-2 mb-4">
    <Icon size={16} className={color} />
    <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</h3>
  </div>
)

const InfoCard = ({ label, value, icon: Icon }: any) => (
  <div className="bg-white/5 border border-white/5 p-4 rounded-lg space-y-1">
    <div className="flex items-center space-x-2 text-slate-500">
      <Icon size={12} />
      <span className="text-[8px] font-bold uppercase tracking-widest">{label}</span>
    </div>
    <p className="text-xs font-bold text-white uppercase tracking-tight">{value || '---'}</p>
  </div>
)

export default function Vendor() {
  const queryClient = useQueryClient()
  const gridRef = React.useRef<any>(null)
  const [fontSize, setFontSize] = useState(11)
  const [rowDensity, setRowDensity] = useState(10)
  const [showStyleLab, setShowStyleLab] = useState(true)
  const [showColumnPicker, setShowColumnPicker] = useState(false)
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([])
  const [showConfig, setShowConfig] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [activeModal, setActiveModal] = useState<any>(null)
  const [activeDetails, setActiveDetails] = useState<any>(null)
  const [confirmModal, setConfirmModal] = useState<any>({ isOpen: false, title: '', message: '', onConfirm: () => {} })

  const { data: vendors, isLoading } = useQuery({ 
    queryKey: ['vendors'], 
    queryFn: async () => (await apiFetch('/api/v1/vendors/')).json() 
  })

  // Sync activeDetails if vendors data changes
  React.useEffect(() => {
    if (activeDetails && vendors) {
      const updated = vendors.find((v: any) => v.id === activeDetails.id)
      if (updated) setActiveDetails(updated)
    }
  }, [vendors, activeDetails?.id])

  React.useEffect(() => {
    const api = gridRef.current?.api
    if (!api) return
    const timer = window.setTimeout(() => {
      if (gridRef.current?.api === api && !api.isDestroyed()) api.autoSizeAllColumns()
    }, 100)
    return () => window.clearTimeout(timer)
  }, [fontSize, rowDensity, vendors])

  const handleExportCSV = () => {
    if (gridRef.current?.api) {
      gridRef.current.api.exportDataAsCsv({
        fileName: `SysGrid_Vendors_${new Date().toISOString().split('T')[0]}.csv`,
        allColumns: false,
        onlySelected: false
      })
    }
  }

  const handleCopyToClipboard = () => {
    if (gridRef.current?.api) {
      const csvData = gridRef.current.api.getDataAsCsv({
        allColumns: false,
        onlySelected: true,
        suppressQuotes: true
      })
      if (csvData) {
        navigator.clipboard.writeText(csvData)
          .then(() => toast.success("Table data copied to clipboard"))
          .catch(() => toast.error("Failed to copy data"))
      }
    }
  }

  const { data: devices } = useQuery({ 
    queryKey: ['devices'], 
    queryFn: async () => (await apiFetch('/api/v1/devices/')).json() 
  })

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const url = data.id ? `/api/v1/vendors/${data.id}` : '/api/v1/vendors/'
      const method = data.id ? 'PUT' : 'POST'
      const res = await apiFetch(url, { method, body: JSON.stringify(data) })
      return res.json()
    },
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      toast.success('Vendor Matrix Updated')
      setActiveModal(null)
    }
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiFetch(`/api/v1/vendors/${id}`, { method: 'DELETE' }),
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      toast.success('Vendor Entry Removed')
    }
  })

  const columnDefs = useMemo(() => [
    { 
      headerName: "", 
      width: 50,
      minWidth: 50,
      maxWidth: 50,
      checkboxSelection: true, 
      headerCheckboxSelection: true, 
      pinned: 'left', 
      cellClass: 'flex items-center justify-center border-r border-white/5 pl-2', 
      headerClass: 'flex items-center justify-center border-r border-white/5 pl-2', 
      suppressSizeToFit: true,
      resizable: false,
      sortable: false,
      filter: false,
      lockVisible: true
    },
    { 
      field: "name", 
      headerName: "Vendor Name", 
      flex: 1, 
      minWidth: 150,
      pinned: 'left', 
      filter: true, 
      cellClass: 'font-bold uppercase tracking-tight',
      headerClass: 'text-left',
      cellRenderer: (p: any) => <span style={{ fontSize: `${fontSize}px` }}>{p.value}</span>,
      hide: hiddenColumns.includes("name")
    },
    { 
      field: "country", 
      headerName: "Country", 
      width: 120, 
      filter: true, 
      cellClass: 'text-center font-bold',
      headerClass: 'text-center',
      cellRenderer: (p: any) => p.value ? <span style={{ fontSize: `${fontSize}px` }}>{p.value}</span> : <span style={{ fontSize: `${fontSize}px` }} className="text-slate-500 font-bold uppercase">N/A</span>,
      hide: hiddenColumns.includes("country")
    },
    { 
      field: "primary_personnel_name", 
      headerName: "Primary Personnel", 
      width: 180, 
      filter: true, 
      cellClass: 'text-center',
      headerClass: 'text-center',
      cellRenderer: (p: any) => p.value || '---',
      hide: hiddenColumns.includes("primary_personnel_name")
    },
    { 
      field: "primary_personnel_email", 
      headerName: "Email (Primary)", 
      width: 180, 
      filter: true, 
      cellClass: 'font-mono text-blue-400',
      headerClass: 'text-center',
      cellRenderer: (p: any) => p.value || '---',
      hide: hiddenColumns.includes("primary_personnel_email")
    },
    { 
      field: "primary_personnel_phone", 
      headerName: "Phone (Primary)", 
      width: 150, 
      filter: true, 
      headerClass: 'text-center',
      cellRenderer: (p: any) => p.value || '---',
      hide: hiddenColumns.includes("primary_personnel_phone")
    },
    { 
      field: "active_contract_count", 
      headerName: "Active Contracts", 
      width: 140, 
      filter: true, 
      cellClass: 'text-center font-bold text-emerald-400',
      headerClass: 'text-center',
      hide: hiddenColumns.includes("active_contract_count")
    },
    { 
      field: "contract_count", 
      headerName: "Total Contracts", 
      width: 130, 
      filter: true, 
      cellClass: 'text-center font-bold',
      headerClass: 'text-center',
      hide: hiddenColumns.includes("contract_count")
    },
    { 
      field: "first_contract_date", 
      headerName: "First Contract", 
      width: 130, 
      filter: true, 
      cellClass: 'text-center',
      headerClass: 'text-center',
      cellRenderer: (p: any) => formatAppDay(p.value),
      hide: hiddenColumns.includes("first_contract_date")
    },
    { 
      field: "earliest_expiry_date", 
      headerName: "Earliest Expiry", 
      width: 130, 
      filter: true, 
      cellClass: 'text-center',
      headerClass: 'text-center',
      cellRenderer: (p: any) => {
        if (!p.value) return '---';
        const date = parseAppDate(p.value);
        const isExpired = date && date < new Date();
        return <span className={isExpired ? 'text-rose-500' : 'text-emerald-500'}>{formatAppDay(p.value)}</span>;
      },
      hide: hiddenColumns.includes("earliest_expiry_date")
    },
    { 
      field: "personnel_count", 
      headerName: "Total Personnel", 
      width: 130, 
      filter: true, 
      cellClass: 'text-center font-bold',
      headerClass: 'text-center',
      hide: hiddenColumns.includes("personnel_count")
    },
    {
      field: "actions",
      headerName: "Action",
      width: 100,
      minWidth: 100,
      pinned: 'right',
      cellClass: 'text-center',
      headerClass: 'text-center',
      resizable: false,
      cellRenderer: (p: any) => (
        <div className="flex items-center justify-center space-x-1 h-full">
           <div className="flex rounded-lg p-0.5 border border-white/5 bg-transparent">
               <button onClick={() => setActiveDetails(p.data)} title="View Details" className="p-1.5 text-blue-400 hover:text-blue-200 transition-all border-r border-white/5"><Eye size={14}/></button>
               <button onClick={() => setConfirmModal({ isOpen: true, title: 'Purge Vendor', message: 'Erase vendor record?', onConfirm: () => deleteMutation.mutate(p.data.id) })} title="Purge" className="p-1.5 text-rose-400 hover:text-rose-200 transition-all"><Trash2 size={14}/></button>
           </div>
        </div>
      ),
      lockVisible: true
    }
  ], [setActiveDetails, deleteMutation, fontSize, hiddenColumns]) as any

  const processedVendors = useMemo(() => {
    if (!vendors) return [];
    return vendors.map((v: any) => {
      const contracts = v.contracts || [];
      const personnel = v.personnel || [];
      const primary = personnel.find((p: any) => p.id === v.primary_personnel_id);
      const now = new Date();
      const activeContracts = contracts.filter((c: any) => {
        const start = parseAppDate(c.effective_date);
        const end = parseAppDate(c.expiry_date);
        const isDateValid = (!start || start <= now) && (!end || end >= now);
        return isDateValid && c.status === 'Completed';
      });
      
      const startDates = contracts.map((c: any) => c.effective_date).map((d: any) => parseAppDate(d)).filter(Boolean).map((d: any) => d!.getTime());
      const expiryDates = contracts.map((c: any) => c.expiry_date).map((d: any) => parseAppDate(d)).filter(Boolean).map((d: any) => d!.getTime());
      
      return {
        ...v,
        primary_personnel_name: primary?.name || null,
        primary_personnel_email: primary?.company_email || null,
        primary_personnel_phone: primary?.phone || null,
        active_contract_count: activeContracts.length,
        contract_count: contracts.length,
        first_contract_date: startDates.length > 0 ? new Date(Math.min(...startDates)).toISOString() : null,
        earliest_expiry_date: expiryDates.length > 0 ? new Date(Math.min(...expiryDates)).toISOString() : null,
        personnel_count: personnel.length
      };
    });
  }, [vendors]);

  const autoSizeStrategy = OPERATIONAL_GRID_AUTO_SIZE_STRATEGY

  return (
    <div className="h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-6">
           <div>
              <h1 className="text-2xl font-bold uppercase tracking-tight  text-white">Vendors</h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold ml-1">Vendor Capability & Contract Intelligence</p>
           </div>
        </div>
        
        <div className="flex items-center space-x-3">
          <div className="relative">
             <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
             <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Filter registry..." className="bg-white/5 border border-white/5 rounded-lg pl-10 pr-4 py-2 text-[10px] font-bold outline-none focus:border-blue-500/50 w-64 transition-all" />
          </div>

          <div className="flex bg-white/5 rounded-lg p-0.5 border border-white/5 space-x-1">
             <button 
                onClick={() => setShowStyleLab(!showStyleLab)} 
                className={`p-1.5 hover:bg-white/10 ${showStyleLab ? 'text-blue-400 bg-white/10' : 'text-slate-500'} rounded-lg transition-all`}
                title="Toggle Style Lab"
             >
                <Activity size={16} />
             </button>
             <button onClick={() => setShowColumnPicker(!showColumnPicker)} className={`p-1.5 hover:bg-white/10 ${showColumnPicker ? 'text-blue-400 bg-white/10' : 'text-slate-500'} rounded-lg transition-all`} title="Column Picker">
                <Sliders size={16} />
             </button>
             <button onClick={handleExportCSV} className="p-1.5 hover:bg-white/10 text-slate-500 hover:text-emerald-400 rounded-lg transition-all" title="Export CSV">
                <FileText size={16} />
             </button>
             <button onClick={handleCopyToClipboard} className="p-1.5 hover:bg-white/10 text-slate-500 hover:text-blue-400 rounded-lg transition-all" title="Copy to Clipboard">
                <Clipboard size={16} />
             </button>
             <button onClick={() => setShowConfig(true)} className="p-1.5 hover:bg-white/10 text-slate-500 hover:text-blue-400 rounded-lg transition-all" title="Registry Config">
                <Settings size={16} />
             </button>
          </div>

          <button 
            onClick={() => setActiveModal({ name: '', country: 'South Korea' })}
            className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
          >
            + Add Vendor
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showStyleLab && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }} 
            animate={{ height: 'auto', opacity: 1 }} 
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-blue-600/10 border border-blue-500/20 rounded-lg p-4 flex items-center justify-between backdrop-blur-md">
               <div className="flex items-center space-x-12">
                  <div className="flex items-center space-x-3">
                     <Activity size={16} className="text-blue-400" />
                     <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400">View Density Laboratory</span>
                  </div>
                  
                  <div className="flex items-center space-x-6">
                     <div className="flex items-center space-x-4">
                        <span className="text-[9px] font-bold text-slate-500 uppercase">Font Size</span>
                        <div className="flex items-center space-x-2">
                            <input 
                            type="range" min="8" max="14" step="1" 
                            value={fontSize} onChange={e => setFontSize(Number(e.target.value))}
                            className="w-32 accent-blue-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                            />
                            <span className="text-[10px] text-white w-4 font-bold">{fontSize}px</span>
                        </div>
                     </div>

                     <div className="flex items-center space-x-4 border-l border-white/10 pl-6">
                        <span className="text-[9px] font-bold text-slate-500 uppercase">Row Density</span>
                        <div className="flex items-center space-x-2">
                            <input 
                            type="range" min="4" max="24" step="2" 
                            value={rowDensity} onChange={e => setRowDensity(Number(e.target.value))}
                            className="w-32 accent-indigo-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                            />
                            <span className="text-[10px] text-white w-4 font-bold">{rowDensity}px</span>
                        </div>
                     </div>
                  </div>
               </div>
               <button onClick={() => setShowStyleLab(false)} className="text-slate-500 hover:text-white transition-colors"><X size={16}/></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 glass-panel rounded-lg overflow-hidden ag-theme-alpine-dark relative border-white/5">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#020617]/80 backdrop-blur-sm space-y-4 text-blue-400">
             <RefreshCcw size={32} className="animate-spin" />
             <p className="text-[10px] font-bold uppercase tracking-[0.3em]">Syncing partner data...</p>
          </div>
        )}
        <AgGridReact 
          ref={gridRef}
          rowData={processedVendors || []} 
          columnDefs={columnDefs} 
          headerHeight={Math.max(42, fontSize + rowDensity + 10)}
          rowHeight={Math.max(40, fontSize + rowDensity + 10)}
          quickFilterText={searchTerm}
          animateRows={true}
          enableCellTextSelection={true}
          autoSizeStrategy={autoSizeStrategy}
          rowSelection="multiple"
          onSelectionChanged={(e) => setSelectedIds(e?.api?.getSelectedNodes().map((n: any) => n.data?.id).filter(Boolean) || [])}
        />

        <AnimatePresence>
          {showColumnPicker && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="absolute top-0 right-0 bottom-0 w-64 bg-slate-950/90 backdrop-blur-xl border-l border-white/10 z-[60] flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-widest text-blue-400 flex items-center space-x-2">
                  <Sliders size={14} /> <span>Toggle Columns</span>
                </h3>
                <button onClick={() => setShowColumnPicker(false)} className="text-slate-500 hover:text-white"><X size={18}/></button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-1">
                {columnDefs.filter((c: any) => c.field && !c.lockVisible).map((col: any) => (
                  <label key={col.field} className="flex items-center space-x-3 p-2 rounded-lg hover:bg-white/5 cursor-pointer group transition-all">
                    <div className="relative flex items-center">
                      <input
                        type="checkbox"
                        checked={!hiddenColumns.includes(col.field)}
                        onChange={() => {
                          if (hiddenColumns.includes(col.field)) {
                            setHiddenColumns(hiddenColumns.filter(f => f !== col.field))
                          } else {
                            setHiddenColumns([...hiddenColumns, col.field])
                          }
                        }}
                        className="sr-only"
                      />
                      <div className={`w-4 h-4 rounded-lg border transition-all ${!hiddenColumns.includes(col.field) ? 'bg-blue-600 border-blue-500 shadow-lg shadow-blue-500/20' : 'border-white/10 bg-black/40 group-hover:border-white/20'}`}>
                         {!hiddenColumns.includes(col.field) && <Check size={12} className="text-white mx-auto" />}
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${!hiddenColumns.includes(col.field) ? 'text-slate-200' : 'text-slate-500'}`}>{col.headerName || col.field}</span>
                  </label>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ConfigRegistryModal 
        isOpen={showConfig} 
        onClose={() => setShowConfig(false)} 
        title="Vendor Matrix Config"
        sections={[
            { title: "Country List", category: "VendorCountry", icon: Flag },
            { title: "Device Type", category: "VendorDeviceType", icon: Monitor }
        ]}
      />

      <AnimatePresence>
        {activeModal && (
          <VendorForm 
            item={activeModal} 
            onClose={() => setActiveModal(null)} 
            onSave={(d: any) => mutation.mutate(d)}
            isSaving={mutation.isPending}
          />
        )}
        {activeDetails && (
          <VendorDetails 
            vendor={activeDetails} 
            devices={devices}
            onClose={() => setActiveDetails(null)} 
          />
        )}
        {confirmModal.isOpen && (
          <ConfirmationModal 
            isOpen={confirmModal.isOpen}
            title={confirmModal.title}
            message={confirmModal.message}
            onConfirm={() => {
              confirmModal.onConfirm();
              setConfirmModal({ ...confirmModal, isOpen: false });
            }}
            onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
          />
        )}
      </AnimatePresence>

      <style>{`
        .ag-theme-alpine-dark {
          --ag-background-color: #1a1b26;
          --ag-header-background-color: #24283b;
          --ag-border-color: rgba(255, 255, 255, 0.05);
          --ag-foreground-color: #f1f5f9;
          --ag-header-foreground-color: #3b82f6;
          --ag-font-family: 'Geist Variable', sans-serif;
          --ag-font-size: ${fontSize}px;
        }
        .ag-root-wrapper { border: none !important; }
        .ag-header-cell-label { 
            font-weight: 700 !important; 
            text-transform: uppercase !important; 
            letter-spacing: 0.1em !important; 
            font-size: ${fontSize}px !important; 
            justify-content: center !important; 
        }
        .ag-cell { 
            display: flex; 
            align-items: center; 
            justify-content: center !important; 
            font-weight: 700 !important;
            font-size: ${fontSize}px !important;
        }

        }
        .ag-row-hover { background-color: rgba(255,255,255,0.05) !important; }
        .ag-row-selected { background-color: rgba(59, 130, 246, 0.2) !important; }
      `}</style>
    </div>
  )
}

function VendorForm({ item, onClose, onSave, isSaving }: any) {
  const [formData, setFormData] = useState({ ...item })
  const { data: countries } = useQuery({ 
    queryKey: ['settings', 'VendorCountry'], 
    queryFn: async () => (await apiFetch('/api/v1/settings/options?category=VendorCountry')).json() 
  })

  const countryOptions = useMemo(() => {
    if (countries && countries.length > 0) return countries;
    return [
      { label: 'South Korea', value: 'South Korea' },
      { label: 'USA', value: 'USA' }
    ]
  }, [countries])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-10">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-[500px] p-10 rounded-lg border border-blue-500/30 flex flex-col">
        <div className="flex items-center justify-between border-b border-white/5 pb-6">
          <h2 className="text-2xl font-bold uppercase text-blue-400 flex items-center gap-3">
            <Briefcase size={24} /> Vendor Entry
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><X size={24}/></button>
        </div>

        <div className="space-y-6 mt-6">
            <SectionHeader icon={User} title="Basic Information" />
            <div className="space-y-4">
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Vendor Name</label>
                <input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Country</label>
                <select 
                  value={formData.country || 'South Korea'} 
                  onChange={e => setFormData({...formData, country: e.target.value})} 
                  className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs text-white [color-scheme:dark]"
                >
                  {countryOptions.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
        </div>

        <div className="flex space-x-3 pt-10 mt-auto">
          <button onClick={onClose} className="flex-1 py-4 text-[11px] font-bold uppercase text-slate-500 hover:text-white transition-colors">Abort</button>
          <button onClick={() => onSave(formData)} className="flex-[2] py-4 bg-blue-600 text-white rounded-lg text-[11px] font-bold uppercase shadow-lg shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center gap-2">
            {isSaving ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16} />} 
            Save Vendor
          </button>
        </div>
      </motion.div>
    </div>
  )
}

function VendorDetails({ vendor, devices, onClose }: any) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('Overview')
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({ ...vendor })
  const [hasChanges, setHasChanges] = useState(false)
  const [showPersonnelModal, setShowPersonnelModal] = useState<any>(null)
  const [showContractModal, setShowContractModal] = useState<any>(null)
  const [activeContractDetails, setActiveContractDetails] = useState<any>(null)
  const [confirmingContractId, setConfirmingContractId] = useState<number | null>(null)
  const [confirmingPersonnelId, setConfirmingPersonnelId] = useState<number | null>(null)

  // Sync formData when vendor prop changes externally
  React.useEffect(() => {
    if (!isEditing) {
      setFormData({ ...vendor })
      setHasChanges(false)
    }
  }, [vendor, isEditing])

  const updateField = (field: string, value: any) => {
    setFormData({ ...formData, [field]: value })
    setHasChanges(true)
  }

  const { data: systems } = useQuery({ 
    queryKey: ['settings', 'LogicalSystem'], 
    queryFn: async () => (await apiFetch('/api/v1/settings/options?category=LogicalSystem')).json() 
  })

  const { data: countries } = useQuery({ 
    queryKey: ['settings', 'VendorCountry'], 
    queryFn: async () => (await apiFetch('/api/v1/settings/options?category=VendorCountry')).json() 
  })

  const countryOptions = useMemo(() => {
    if (countries && countries.length > 0) return countries;
    return [
      { label: 'South Korea', value: 'South Korea' },
      { label: 'USA', value: 'USA' }
    ]
  }, [countries])

  const vendorMutation = useMutation({
    mutationFn: async (data: any) => {
      return (await apiFetch(`/api/v1/vendors/${vendor.id}`, { method: 'PUT', body: JSON.stringify(data) })).json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      setIsEditing(false)
      setHasChanges(false)
      toast.success('Vendor Profile Updated')
    }
  })

  const personnelMutation = useMutation({
    mutationFn: async (data: any) => {
      const url = data.id ? `/api/v1/vendors/personnel/${data.id}` : `/api/v1/vendors/${vendor.id}/personnel`
      const method = data.id ? 'PUT' : 'POST'
      return (await apiFetch(url, { method, body: JSON.stringify(data) })).json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      setShowPersonnelModal(null)
      toast.success('Personnel Updated')
    }
  })

  const deletePersonnelMutation = useMutation({
    mutationFn: async (id: number) => apiFetch(`/api/v1/vendors/personnel/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      toast.success('Personnel Removed')
    }
  })

  const contractMutation = useMutation({
    mutationFn: async (data: any) => {
      const payload = { ...data, vendor_id: vendor.id }
      const url = payload.id ? `/api/v1/vendors/contracts/${payload.id}` : `/api/v1/vendors/contracts/`
      const method = payload.id ? 'PUT' : 'POST'
      return (await apiFetch(url, { method, body: JSON.stringify(payload) })).json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      setShowContractModal(null)
      setActiveContractDetails(null)
      toast.success('Contract Synchronized')
    }
  })

  const deleteContractMutation = useMutation({
    mutationFn: async (id: number) => apiFetch(`/api/v1/vendors/bulk-action`, { 
      method: 'POST', 
      body: JSON.stringify({ ids: [id], action: 'delete', target: 'contract' }) 
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      toast.success('Contract Terminated')
    }
  })

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 backdrop-blur-xl p-10">
      <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="glass-panel w-full max-w-7xl h-[90vh] rounded-lg border border-blue-500/20 overflow-hidden flex flex-col shadow-2xl">
        
        {/* Header Section */}
        <div className="p-10 border-b border-white/5 bg-white/5 flex items-start justify-between shrink-0">
          <div className="space-y-4">
             <div className="flex items-center space-x-3">
                <div className="px-3 py-1 rounded-lg bg-blue-600/20 border border-blue-500/30 text-[9px] font-bold text-blue-400 uppercase tracking-widest">PARTNER_CODE: {vendor.id}</div>
                <div className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-[9px] font-bold text-slate-400 uppercase tracking-widest">{vendor.country}</div>
             </div>
             <h1 className="text-5xl font-bold uppercase  tracking-tighter text-white">{vendor.name}</h1>
          </div>
          <button onClick={onClose} className="p-3 bg-white/5 border border-white/10 rounded-lg text-slate-500 hover:text-white transition-all"><X size={24}/></button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar Nav */}
          <div className="w-64 border-r border-white/5 bg-black/20 p-6 space-y-1">
             {['Overview', 'Contracts', 'Personnel'].map(tab => (
               <button key={tab} onClick={() => setActiveTab(tab)} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all ${activeTab === tab ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-500 hover:bg-white/5'}`}>
                 {tab === 'Overview' && <LayoutGrid size={16} />}
                 {tab === 'Contracts' && <FileText size={16} />}
                 {tab === 'Personnel' && <User size={16} />}
                 <span className="text-[10px] font-bold uppercase tracking-widest">{tab}</span>
               </button>
             ))}
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-10 bg-[#020617]/40">
            {activeTab === 'Overview' && (
              <div className="space-y-8 max-w-4xl">
                <div className="flex items-center justify-between">
                   <SectionHeader icon={Info} title="Vendor Profile Overview" />
                   {!isEditing ? (
                     <button onClick={() => setIsEditing(true)} className="px-4 py-1.5 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all">Edit Profile</button>
                   ) : (
                     <div className="flex items-center space-x-2">
                        <button onClick={() => { setFormData({...vendor}); setIsEditing(false); setHasChanges(false); }} className="px-4 py-1.5 bg-white/5 text-slate-400 border border-white/10 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:text-white transition-all">Cancel</button>
                        {hasChanges && (
                          <button onClick={() => vendorMutation.mutate(formData)} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2">
                            <Save size={12} /> Save Changes
                          </button>
                        )}
                     </div>
                   )}
                </div>

                <div className="grid grid-cols-2 gap-8">
                   <div className="space-y-6">
                      <div>
                         <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Vendor Name</label>
                         {isEditing ? (
                           <input value={formData.name} onChange={e => updateField('name', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs text-white" />
                         ) : (
                           <p className="text-sm font-bold text-white uppercase">{vendor.name}</p>
                         )}
                      </div>
                      <div>
                         <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Country</label>
                         {isEditing ? (
                           <select 
                            value={formData.country || 'South Korea'} 
                            onChange={e => updateField('country', e.target.value)} 
                            className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs text-white [color-scheme:dark]"
                           >
                            {countryOptions.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
                           </select>
                         ) : (
                           <p className="text-sm font-bold text-white uppercase">{vendor.country}</p>
                         )}
                      </div>
                      <div>
                         <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Primary Personnel</label>
                         {isEditing ? (
                           <select 
                            value={formData.primary_personnel_id || ''} 
                            onChange={e => updateField('primary_personnel_id', e.target.value ? Number(e.target.value) : null)} 
                            className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs text-white [color-scheme:dark]"
                           >
                            <option value="">Select Personnel...</option>
                            {vendor.personnel?.map((p: any) => (
                              <option key={p.id} value={p.id}>{p.name} ({p.position})</option>
                            ))}
                           </select>
                         ) : (
                           <div className="flex items-center space-x-3">
                              <div className="p-2 bg-blue-600/10 rounded-lg text-blue-400 border border-blue-500/20 shadow-lg shadow-blue-500/10">
                                <User size={16}/>
                              </div>
                              <div>
                                 <p className="text-sm font-bold text-white uppercase tracking-tight">
                                  {vendor.personnel?.find((p:any) => p.id === vendor.primary_personnel_id)?.name || 'UNASSIGNED'}
                                 </p>
                                 <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                                  {vendor.personnel?.find((p:any) => p.id === vendor.primary_personnel_id)?.position || '---'}
                                 </p>
                              </div>
                           </div>
                         )}
                      </div>
                   </div>
                   <div className="space-y-6">
                      <div className="pt-2">
                         <InfoCard label="Direct Email" icon={Mail} value={vendor.personnel?.find((p:any) => p.id === vendor.primary_personnel_id)?.company_email} />
                      </div>
                      <div>
                         <InfoCard label="Contact Phone" icon={Phone} value={vendor.personnel?.find((p:any) => p.id === vendor.primary_personnel_id)?.phone} />
                      </div>
                   </div>
                </div>

                <div className="pt-10 mt-10 border-t border-white/5">
                   <SectionHeader icon={LayoutGrid} title="Entity Summary Dashboard" />
                   <div className="grid grid-cols-4 gap-4">
                      <div className="bg-white/5 border border-white/5 p-6 rounded-lg space-y-2">
                        <div className="flex items-center gap-3 text-blue-400">
                          <User size={20} />
                          <span className="text-[10px] font-bold uppercase tracking-widest">Personnel</span>
                        </div>
                        <p className="text-3xl font-bold text-white">{vendor.personnel?.length || 0}</p>
                        <p className="text-[8px] font-bold text-slate-500 uppercase">Assigned Members</p>
                      </div>
                      <div className="bg-white/5 border border-white/5 p-6 rounded-lg space-y-2">
                        <div className="flex items-center gap-3 text-amber-400">
                          <FileText size={20} />
                          <span className="text-[10px] font-bold uppercase tracking-widest">Contracts</span>
                        </div>
                        <p className="text-3xl font-bold text-white">{vendor.contracts?.length || 0}</p>
                        <p className="text-[8px] font-bold text-slate-500 uppercase">Total SLAs</p>
                      </div>
                      <div className="bg-white/5 border border-white/5 p-6 rounded-lg space-y-2">
                        <div className="flex items-center gap-3 text-emerald-400">
                          <Check size={20} />
                          <span className="text-[10px] font-bold uppercase tracking-widest">Active</span>
                        </div>
                        <p className="text-3xl font-bold text-white">
                          {vendor.contracts?.filter((c:any) => {
                            const now = new Date();
                            const start = parseAppDate(c.effective_date);
                            const end = parseAppDate(c.expiry_date);
                            const isDateValid = (!start || start <= now) && (!end || end >= now);
                            return isDateValid && c.status === 'Completed';
                          }).length || 0}
                        </p>
                        <p className="text-[8px] font-bold text-slate-500 uppercase">Valid Contracts</p>
                      </div>
                      <div className="bg-white/5 border border-white/5 p-6 rounded-lg space-y-2 text-slate-500 opacity-50">
                        <div className="flex items-center gap-3">
                          <Activity size={20} />
                          <span className="text-[10px] font-bold uppercase tracking-widest">Insights</span>
                        </div>
                        <p className="text-3xl font-bold">---</p>
                        <p className="text-[8px] font-bold uppercase tracking-tighter">Future Metrics</p>
                      </div>
                   </div>
                </div>
              </div>
            )}

            {activeTab === 'Contracts' && (
              <div className="space-y-6">
                 <div className="flex items-center justify-between">
                    <SectionHeader icon={FileText} title="Service Level Agreements" />
                    <button onClick={() => setShowContractModal({ title: '', contract_id: '', covered_systems: [], covered_assets: [], scope_of_work: [], schedule: {}, document_link: '', previous_contract_changes: '' })} className="px-6 py-2 bg-blue-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-blue-500/20 active:scale-95 transition-all flex items-center gap-2">
                       <Plus size={14} /> Register New Contract
                    </button>
                 </div>
                 
                 <div className="grid grid-cols-1 gap-4">
                    {vendor.contracts?.map((c: any) => (
                       <div key={c.id} className="bg-white/5 border border-white/5 rounded-lg p-6 group hover:bg-white/10 transition-all cursor-pointer" onClick={() => setActiveContractDetails(c)}>
                          <div className="flex items-center justify-between">
                             <div className="flex items-center space-x-6">
                                <div className="w-12 h-12 bg-black/40 rounded-lg flex items-center justify-center text-blue-400 border border-white/5 group-hover:border-blue-500/30 transition-all shrink-0">
                                   <FileText size={20} />
                                </div>
                                <div className="space-y-2">
                                   <div className="flex items-center gap-3">
                                      <h4 className="text-sm font-bold text-white uppercase tracking-tight">{c.title}</h4>
                                      <span className={`px-2 py-0.5 rounded-lg text-[8px] font-bold uppercase ${
                                        c.status === 'Completed' ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' : 
                                        c.status === 'In Review' ? 'bg-amber-600/20 text-amber-400 border border-amber-500/30' : 
                                        'bg-slate-800 text-slate-500 border border-white/5'
                                      }`}>
                                        {c.status || 'Drafted'}
                                      </span>
                                   </div>
                                   
                                   <div className="flex items-center space-x-6">
                                      <div className="flex items-center gap-4 text-[9px] font-bold uppercase tracking-widest">
                                         <div className="flex flex-col">
                                            <span className="text-slate-500 mb-1">Effective</span>
                                            <span className="text-white">{formatAppDay(c.effective_date)}</span>
                                         </div>
                                         <div className="flex flex-col border-l border-white/10 pl-4">
                                            <span className="text-slate-500 mb-1">Expiring</span>
                                            <span className={(() => {
                                              const d = parseAppDate(c.expiry_date);
                                              return d && d < new Date() ? 'text-rose-500' : 'text-emerald-500';
                                            })()}>
                                              {c.expiry_date ? formatAppDay(c.expiry_date) : 'OPEN-ENDED'}
                                            </span>
                                         </div>
                                      </div>

                                      <div className="flex items-center gap-4 text-[9px] font-bold uppercase tracking-widest border-l border-white/10 pl-6">
                                         <div className="flex flex-col">
                                            <span className="text-slate-500 mb-1">Systems</span>
                                            <div className="flex items-center gap-1.5">
                                               {c.covered_systems?.slice(0, 1).map((s: string) => (
                                                 <span key={s} className="text-indigo-400">{s}</span>
                                               ))}
                                               {c.covered_systems?.length > 1 && (
                                                 <div className="relative group/tip">
                                                    <span className="text-slate-500 cursor-help hover:text-white transition-colors">+{c.covered_systems.length - 1}</span>
                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-slate-900 border border-white/10 p-2 rounded-lg shadow-2xl opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible transition-all z-50">
                                                       <div className="flex flex-wrap gap-1">
                                                          {c.covered_systems.slice(1).map((s: string) => (
                                                            <span key={s} className="px-1.5 py-0.5 bg-white/5 rounded-lg text-[8px] text-indigo-400 border border-white/5">{s}</span>
                                                          ))}
                                                       </div>
                                                       <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-900"></div>
                                                    </div>
                                                 </div>
                                               )}
                                               {(!c.covered_systems || c.covered_systems.length === 0) && <span className="text-slate-700">None</span>}
                                            </div>
                                         </div>
                                         <div className="flex flex-col border-l border-white/10 pl-4">
                                            <span className="text-slate-500 mb-1">Assets</span>
                                            <div className="flex items-center gap-1.5">
                                               <span className="text-amber-400">{c.covered_assets?.length || 0}</span>
                                               {c.covered_assets?.length > 0 && (
                                                 <div className="relative group/tip">
                                                    <Plus size={10} className="text-slate-500 cursor-help hover:text-white transition-colors" />
                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-slate-900 border border-white/10 p-2 rounded-lg shadow-2xl opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible transition-all z-50">
                                                       <div className="flex flex-col gap-1">
                                                          {c.covered_assets.map((assetId: number) => {
                                                            const asset = devices?.find((d: any) => d.id === assetId);
                                                            return (
                                                              <div key={assetId} className="flex items-center justify-between text-[8px] font-bold uppercase tracking-tight border-b border-white/5 pb-1">
                                                                <span className="text-white truncate max-w-[100px]">{asset?.name || `ID: ${assetId}`}</span>
                                                                <span className="text-slate-500 text-[7px]">{asset?.system}</span>
                                                              </div>
                                                            );
                                                          })}
                                                       </div>
                                                       <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-900"></div>
                                                    </div>
                                                 </div>
                                               )}
                                            </div>
                                         </div>
                                      </div>
                                   </div>
                                </div>
                             </div>
                             <div className="flex items-center space-x-2">
                                {confirmingContractId === c.id ? (
                                  <button 
                                    onClick={(e) => { 
                                      e.stopPropagation(); 
                                      deleteContractMutation.mutate(c.id); 
                                      setConfirmingContractId(null);
                                    }} 
                                    className="px-3 py-1 bg-rose-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest animate-pulse"
                                  >
                                    Confirm?
                                  </button>
                                ) : (
                                  <button 
                                    onClick={(e) => { 
                                      e.stopPropagation(); 
                                      setConfirmingContractId(c.id); 
                                      setTimeout(() => setConfirmingContractId(null), 3000);
                                    }} 
                                    className="p-2 text-slate-600 hover:text-rose-400 transition-all"
                                  >
                                    <Trash2 size={16}/>
                                  </button>
                                )}
                                <ArrowRight size={16} className="text-slate-600 group-hover:text-blue-400 transition-all" />
                             </div>
                          </div>
                       </div>
                    ))}
                    {(!vendor.contracts || vendor.contracts.length === 0) && (
                       <div className="py-20 text-center text-slate-600  text-[10px] font-bold uppercase tracking-widest bg-black/20 rounded-lg border border-dashed border-white/5">No active service contracts found</div>
                    )}
                 </div>
              </div>
            )}

            {activeTab === 'Personnel' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <SectionHeader icon={User} title="Assigned Personnel" />
                  <button onClick={() => setShowPersonnelModal({ name: '', name_original: '', position: '', team: '', company_email: '', internal_email: '', phone: '', accounts: [], pcs: [] })} className="px-6 py-2 bg-blue-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-blue-500/20 active:scale-95 transition-all flex items-center gap-2">
                    <Plus size={14} /> Add Member
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {vendor.personnel?.map((p: any) => (
                    <div key={p.id} className="bg-white/5 border border-white/5 rounded-lg p-6 group hover:bg-white/10 transition-all">
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center space-x-4">
                          <div className="w-12 h-12 bg-blue-600/20 rounded-lg flex items-center justify-center text-blue-400 border border-blue-500/20">
                            <User size={20} />
                          </div>
                          <div>
                            <div className="flex items-center space-x-2">
                               <h4 className="text-sm font-bold text-white uppercase tracking-tight">{p.name}</h4>
                               {p.name_original && <span className="text-[10px] text-slate-500 font-bold">({p.name_original})</span>}
                            </div>
                            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">{p.position} // {p.team}</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <button onClick={() => setShowPersonnelModal(p)} className="p-2 text-slate-500 hover:text-blue-400 transition-all"><Edit2 size={16}/></button>
                          {confirmingPersonnelId === p.id ? (
                            <button 
                              onClick={() => { 
                                deletePersonnelMutation.mutate(p.id); 
                                setConfirmingPersonnelId(null);
                              }} 
                              className="px-3 py-1 bg-rose-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest animate-pulse"
                            >
                              Confirm?
                            </button>
                          ) : (
                            <button 
                              onClick={() => { 
                                setConfirmingPersonnelId(p.id); 
                                setTimeout(() => setConfirmingPersonnelId(null), 3000);
                              }} 
                              className="p-2 text-slate-500 hover:text-rose-400 transition-all"
                            >
                              <Trash2 size={16}/>
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-8">
                        <div className="space-y-4">
                          <p className="text-[8px] font-bold text-slate-600 uppercase border-b border-white/5 pb-1">Communications</p>
                          <div className="space-y-2">
                             <div className="flex items-center space-x-2 text-[10px] text-slate-300 font-mono"><Mail size={12} className="text-blue-500" /> <span>{p.company_email}</span></div>
                             {p.internal_email && <div className="flex items-center space-x-2 text-[10px] text-slate-400 font-mono"><ShieldCheck size={12} className="text-emerald-500" /> <span>{p.internal_email}</span></div>}
                             <div className="flex items-center space-x-2 text-[10px] text-slate-300 font-mono"><Phone size={12} className="text-amber-500" /> <span>{p.phone}</span></div>
                          </div>
                        </div>
                        <div className="space-y-4">
                          <p className="text-[8px] font-bold text-slate-600 uppercase border-b border-white/5 pb-1">System Accounts ({p.accounts?.length || 0})</p>
                          <div className="space-y-1">
                            {p.accounts?.map((acc: any, i: number) => (
                              <div key={i} className="flex items-center justify-between text-[9px] font-bold text-slate-400">
                                <span className="text-emerald-400">{acc.type}</span>
                                <span className="text-white">{acc.username}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-4">
                          <p className="text-[8px] font-bold text-slate-600 uppercase border-b border-white/5 pb-1">Managed Assets ({p.pcs?.length || 0})</p>
                          <div className="space-y-1">
                            {p.pcs?.map((pc: any, i: number) => (
                              <div key={i} className="flex items-center justify-between text-[9px] font-bold text-slate-400">
                                <span className="text-indigo-400">{pc.type}</span>
                                <span className="text-white">{pc.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {(!vendor.personnel || vendor.personnel.length === 0) && (
                    <div className="py-20 text-center text-slate-600  text-[10px] font-bold uppercase tracking-widest bg-black/20 rounded-lg border border-dashed border-white/5">No personnel records identified</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {showPersonnelModal && (
          <PersonnelForm 
            item={showPersonnelModal} 
            onClose={() => setShowPersonnelModal(null)} 
            onSave={(d: any) => personnelMutation.mutate(d)}
            isSaving={personnelMutation.isPending}
          />
        )}
        {showContractModal && (
          <ContractRegistrationForm 
            item={showContractModal} 
            onClose={() => setShowContractModal(null)} 
            onSave={(d: any) => contractMutation.mutate(d)}
            isSaving={contractMutation.isPending}
          />
        )}
        {activeContractDetails && (
          <ContractDetailsForm 
            item={activeContractDetails} 
            devices={devices}
            systems={systems}
            onClose={() => setActiveContractDetails(null)} 
            onSave={(d: any) => contractMutation.mutate(d)}
            isSaving={contractMutation.isPending}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function PersonnelForm({ item, onClose, onSave, isSaving }: any) {
  const [formData, setFormData] = useState({ ...item })
  const [isEditing, setIsEditing] = useState(!item.id) // Default to edit if new
  const [selectedAccIndex, setSelectedAccIndex] = useState<number | null>(null)
  const [isEditingAcc, setIsEditingAcc] = useState(false)
  const [selectedPcIndex, setSelectedPcIndex] = useState<number | null>(null)
  const [isEditingPc, setIsEditingPc] = useState(false)
  
  const isNew = !item.id;

  const updateField = (field: string, value: any) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }))
  }

  const { data: deviceTypes } = useQuery({ 
    queryKey: ['settings', 'VendorDeviceType'], 
    queryFn: async () => (await apiFetch('/api/v1/settings/options?category=VendorDeviceType')).json() 
  })

  const deviceTypeOptions = useMemo(() => {
    if (deviceTypes && deviceTypes.length > 0) return deviceTypes;
    return [
      { label: 'PC', value: 'PC' },
      { label: 'VDI', value: 'VDI' },
      { label: 'Laptop', value: 'Laptop' },
      { label: 'Workstation', value: 'Workstation' }
    ]
  }, [deviceTypes])
  
  const addAccount = () => {
    const newAcc = { type: 'LDAP', username: '', purpose_description: '' };
    const accs = [...(formData.accounts || []), newAcc]
    setFormData({ ...formData, accounts: accs })
    setSelectedAccIndex(accs.length - 1)
    setIsEditingAcc(true)
  }
  
  const addPC = () => {
    const newPc = { name: '', type: 'PC', purpose_description: '' };
    const pcs = [...(formData.pcs || []), newPc]
    setFormData({ ...formData, pcs: pcs })
    setSelectedPcIndex(pcs.length - 1)
    setIsEditingPc(true)
  }

  const handleSave = () => {
    onSave(formData)
    setIsEditing(false)
  }

  const updateAccItem = (index: number, field: string, value: any) => {
    const newAccs = [...formData.accounts];
    newAccs[index] = { ...newAccs[index], [field]: value };
    setFormData({ ...formData, accounts: newAccs });
  }

  const updatePcItem = (index: number, field: string, value: any) => {
    const newPcs = [...formData.pcs];
    newPcs[index] = { ...newPcs[index], [field]: value };
    setFormData({ ...formData, pcs: newPcs });
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/95 backdrop-blur-md p-10">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-[1200px] max-h-[90vh] p-10 rounded-lg border border-blue-500/30 overflow-y-auto custom-scrollbar flex flex-col">
        <div className="flex items-center justify-between border-b border-white/5 pb-6">
          <div className="flex items-center gap-6">
            <h2 className="text-2xl font-bold uppercase text-blue-400 flex items-center gap-3"><User size={24} /> Personnel Info</h2>
            {!isEditing && !isNew ? (
               <button onClick={() => setIsEditing(true)} className="px-4 py-1.5 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all">Edit Personnel</button>
            ) : (
               <div className="flex items-center gap-2">
                 <button onClick={onClose} className="px-4 py-1.5 bg-white/5 text-slate-400 border border-white/10 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:text-white transition-all">Cancel</button>
                 <button onClick={handleSave} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2">
                    {isSaving ? <RefreshCcw size={12} className="animate-spin" /> : <Save size={12} />} 
                    Save Changes
                 </button>
               </div>
            )}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><X size={24}/></button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar mt-8 pr-4">
          <div className="space-y-10">
          {/* Identity Info - Full Row */}
          <section className="space-y-6">
            <SectionHeader icon={User} title="Identity Info" />
            <div className="grid grid-cols-4 gap-6">
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1 tracking-widest">Name (English)</label>
                {isEditing ? (
                  <input value={formData.name} onChange={e => updateField('name', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs text-white outline-none focus:border-blue-500/50 transition-all" />
                ) : (
                  <p className="text-sm font-bold text-white uppercase py-2 tracking-tight">{formData.name || '---'}</p>
                )}
              </div>
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1 tracking-widest">Name (Original)</label>
                {isEditing ? (
                  <input value={formData.name_original} onChange={e => updateField('name_original', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs text-white outline-none focus:border-blue-500/50 transition-all" />
                ) : (
                  <p className="text-sm font-bold text-white uppercase py-2 tracking-tight">{formData.name_original || '---'}</p>
                )}
              </div>
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1 tracking-widest">Position</label>
                {isEditing ? (
                  <input value={formData.position} onChange={e => updateField('position', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs text-white outline-none focus:border-blue-500/50 transition-all" />
                ) : (
                  <p className="text-sm font-bold text-white uppercase py-2 tracking-tight">{formData.position || '---'}</p>
                )}
              </div>
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1 tracking-widest">Team</label>
                {isEditing ? (
                  <input value={formData.team} onChange={e => updateField('team', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs text-white outline-none focus:border-blue-500/50 transition-all" />
                ) : (
                  <p className="text-sm font-bold text-white uppercase py-2 tracking-tight">{formData.team || '---'}</p>
                )}
              </div>
              <div className="col-span-2">
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1 tracking-widest">Email (Company)</label>
                {isEditing ? (
                  <input value={formData.company_email} onChange={e => updateField('company_email', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs text-white font-mono outline-none focus:border-blue-500/50 transition-all" />
                ) : (
                  <p className="text-sm font-bold text-blue-400 font-mono py-2 tracking-tight">{formData.company_email || '---'}</p>
                )}
              </div>
              <div className="col-span-1">
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1 tracking-widest">Email (Internal)</label>
                {isEditing ? (
                  <input value={formData.internal_email} onChange={e => updateField('internal_email', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs text-white font-mono outline-none focus:border-blue-500/50 transition-all" />
                ) : (
                  <p className="text-sm font-bold text-emerald-400 font-mono py-2 tracking-tight">{formData.internal_email || '---'}</p>
                )}
              </div>
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1 tracking-widest">Phone</label>
                {isEditing ? (
                  <input value={formData.phone} onChange={e => updateField('phone', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs text-white outline-none focus:border-blue-500/50 transition-all" />
                ) : (
                  <p className="text-sm font-bold text-white py-2 tracking-tight">{formData.phone || '---'}</p>
                )}
              </div>

            </div>
          </section>

          {/* Accounts & Assets Side-by-Side */}
          <div className="grid grid-cols-2 gap-10">
            <section className="space-y-6">
              <div className="flex items-center justify-between">
                <SectionHeader icon={Key} title="System Accounts" color="text-emerald-400" />
                {isEditing && (
                  <button onClick={addAccount} className="p-1.5 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white rounded-lg transition-all active:scale-95 shadow-lg shadow-emerald-500/10">
                    <Plus size={14} />
                  </button>
                )}
              </div>
              
              <div className="grid grid-cols-12 gap-4">
                 <div className="col-span-4">
                    <div className="bg-black/40 rounded-lg border border-white/5 h-[300px] overflow-y-auto custom-scrollbar">
                       {formData.accounts?.map((acc: any, i: number) => (
                          <button 
                             key={i} 
                             onClick={() => { setSelectedAccIndex(i); setIsEditingAcc(false); }}
                             className={`w-full text-left p-3 border-b border-white/5 transition-all hover:bg-white/5 ${selectedAccIndex === i ? 'bg-emerald-600/10 border-l-2 border-l-emerald-500' : ''}`}
                          >
                             <div className="flex flex-col">
                                <span className={`text-[10px] font-bold uppercase truncate ${selectedAccIndex === i ? 'text-white' : 'text-slate-400'}`}>{acc.username || 'NEW_ACCOUNT'}</span>
                                <span className="text-[8px] font-bold text-slate-600 uppercase tracking-widest">{acc.type}</span>
                             </div>
                          </button>
                       ))}
                    </div>
                 </div>
                 <div className="col-span-8">
                    <AnimatePresence mode="wait">
                       {selectedAccIndex !== null ? (
                          <motion.div key={selectedAccIndex} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="bg-white/5 border border-white/5 rounded-lg p-6 relative h-full">
                             {isEditing && (
                                <div className="absolute top-4 right-4 flex items-center space-x-2">
                                   {!isEditingAcc ? (
                                      <button onClick={() => setIsEditingAcc(true)} className="p-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white rounded-lg transition-all"><Edit2 size={12}/></button>
                                   ) : (
                                      <button onClick={() => setIsEditingAcc(false)} className="p-1.5 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white rounded-lg transition-all"><Check size={12}/></button>
                                   )}
                                   <button onClick={() => { setFormData({...formData, accounts: formData.accounts.filter((_:any, idx:number) => idx !== selectedAccIndex)}); setSelectedAccIndex(null); }} className="p-1.5 bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white rounded-lg transition-all"><Trash2 size={12}/></button>
                                </div>
                             )}
                             <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                   <div>
                                      <label className="text-[8px] font-bold text-slate-600 uppercase mb-1 block">Account Type</label>
                                      {isEditingAcc ? (
                                         <input value={formData.accounts[selectedAccIndex].type} onChange={e => updateAccItem(selectedAccIndex, 'type', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white" />
                                      ) : (
                                         <p className="text-[10px] font-bold text-emerald-400 uppercase">{formData.accounts[selectedAccIndex].type || '---'}</p>
                                      )}
                                   </div>
                                   <div>
                                      <label className="text-[8px] font-bold text-slate-600 uppercase mb-1 block">Username</label>
                                      {isEditingAcc ? (
                                         <input value={formData.accounts[selectedAccIndex].username} onChange={e => updateAccItem(selectedAccIndex, 'username', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono" />
                                      ) : (
                                         <p className="text-[10px] font-bold text-white font-mono">{formData.accounts[selectedAccIndex].username || '---'}</p>
                                      )}
                                   </div>
                                </div>
                                <div>
                                   <label className="text-[8px] font-bold text-slate-600 uppercase mb-1 block">Purpose Description</label>
                                   {isEditingAcc ? (
                                      <textarea value={formData.accounts[selectedAccIndex].purpose_description} onChange={e => updateAccItem(selectedAccIndex, 'purpose_description', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white min-h-[80px]" />
                                   ) : (
                                      <p className="text-[10px] font-bold text-slate-400 uppercase leading-relaxed">{formData.accounts[selectedAccIndex].purpose_description || 'No description provided'}</p>
                                   )}
                                </div>
                             </div>
                          </motion.div>
                       ) : (
                          <div className="h-full bg-white/5 border border-dashed border-white/5 rounded-lg flex items-center justify-center text-slate-600 text-[9px] font-bold uppercase tracking-widest">Select Account</div>
                       )}
                    </AnimatePresence>
                 </div>
              </div>
            </section>

            <section className="space-y-6">
              <div className="flex items-center justify-between">
                <SectionHeader icon={Monitor} title="PC / VDI Assets" color="text-indigo-400" />
                {isEditing && (
                  <button onClick={addPC} className="p-1.5 bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600 hover:text-white rounded-lg transition-all active:scale-95 shadow-lg shadow-indigo-500/10">
                    <Plus size={14} />
                  </button>
                )}
              </div>
              
              <div className="grid grid-cols-12 gap-4">
                 <div className="col-span-4">
                    <div className="bg-black/40 rounded-lg border border-white/5 h-[300px] overflow-y-auto custom-scrollbar">
                       {formData.pcs?.map((pc: any, i: number) => (
                          <button 
                             key={i} 
                             onClick={() => { setSelectedPcIndex(i); setIsEditingPc(false); }}
                             className={`w-full text-left p-3 border-b border-white/5 transition-all hover:bg-white/5 ${selectedPcIndex === i ? 'bg-indigo-600/10 border-l-2 border-l-indigo-500' : ''}`}
                          >
                             <div className="flex flex-col">
                                <span className={`text-[10px] font-bold uppercase truncate ${selectedPcIndex === i ? 'text-white' : 'text-slate-400'}`}>{pc.name || 'NEW_ASSET'}</span>
                                <span className="text-[8px] font-bold text-slate-600 uppercase tracking-widest">{pc.type}</span>
                             </div>
                          </button>
                       ))}
                    </div>
                 </div>
                 <div className="col-span-8">
                    <AnimatePresence mode="wait">
                       {selectedPcIndex !== null ? (
                          <motion.div key={selectedPcIndex} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="bg-white/5 border border-white/5 rounded-lg p-6 relative h-full">
                             {isEditing && (
                                <div className="absolute top-4 right-4 flex items-center space-x-2">
                                   {!isEditingPc ? (
                                      <button onClick={() => setIsEditingPc(true)} className="p-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white rounded-lg transition-all"><Edit2 size={12}/></button>
                                   ) : (
                                      <button onClick={() => setIsEditingPc(false)} className="p-1.5 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white rounded-lg transition-all"><Check size={12}/></button>
                                   )}
                                   <button onClick={() => { setFormData({...formData, pcs: formData.pcs.filter((_:any, idx:number) => idx !== selectedPcIndex)}); setSelectedPcIndex(null); }} className="p-1.5 bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white rounded-lg transition-all"><Trash2 size={12}/></button>
                                </div>
                             )}
                             <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                   <div>
                                      <label className="text-[8px] font-bold text-slate-600 uppercase mb-1 block">Asset Name</label>
                                      {isEditingPc ? (
                                         <input value={formData.pcs[selectedPcIndex].name} onChange={e => updatePcItem(selectedPcIndex, 'name', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white" />
                                      ) : (
                                         <p className="text-[10px] font-bold text-white uppercase">{formData.pcs[selectedPcIndex].name || '---'}</p>
                                      )}
                                   </div>
                                   <div>
                                      <label className="text-[8px] font-bold text-slate-600 uppercase mb-1 block">Device Type</label>
                                      {isEditingPc ? (
                                         <select 
                                            value={formData.pcs[selectedPcIndex].type} 
                                            onChange={e => updatePcItem(selectedPcIndex, 'type', e.target.value)} 
                                            className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white [color-scheme:dark]"
                                         >
                                            {deviceTypeOptions.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                         </select>
                                      ) : (
                                         <p className="text-[10px] font-bold text-indigo-400 uppercase">{formData.pcs[selectedPcIndex].type || '---'}</p>
                                      )}
                                   </div>
                                </div>
                                <div>
                                   <label className="text-[8px] font-bold text-slate-600 uppercase mb-1 block">Purpose Description</label>
                                   {isEditingPc ? (
                                      <textarea value={formData.pcs[selectedPcIndex].purpose_description} onChange={e => updatePcItem(selectedPcIndex, 'purpose_description', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white min-h-[80px]" />
                                   ) : (
                                      <p className="text-[10px] font-bold text-slate-400 uppercase leading-relaxed">{formData.pcs[selectedPcIndex].purpose_description || 'No description provided'}</p>
                                   )}
                                </div>
                             </div>
                          </motion.div>
                       ) : (
                          <div className="h-full bg-white/5 border border-dashed border-white/5 rounded-lg flex items-center justify-center text-slate-600 text-[9px] font-bold uppercase tracking-widest">Select Asset</div>
                       )}
                    </AnimatePresence>
                 </div>
              </div>
            </section>
          </div>
        </div>

        </div>
      </motion.div>
    </div>
  )
}

function ContractRegistrationForm({ item, onClose, onSave, isSaving }: any) {
  const [formData, setFormData] = useState({ ...item, status: item.status || 'Drafted' })

  const statusOptions = ['Drafted', 'In Review', 'Completed', 'Cancelled', 'Expired']

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/95 backdrop-blur-md p-10">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-[500px] p-10 rounded-lg border border-blue-500/30 flex flex-col">
        <div className="flex items-center justify-between border-b border-white/5 pb-6">
          <h2 className="text-2xl font-bold uppercase text-blue-400 flex items-center gap-3"><FileText size={24} /> New Contract</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><X size={24}/></button>
        </div>

        <div className="space-y-4 mt-8">
           <div>
             <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Contract Title</label>
             <input value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs text-white" placeholder="e.g. 2026 Global Support" />
           </div>
           <div>
             <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Contract ID</label>
             <input value={formData.contract_id} onChange={e => setFormData({...formData, contract_id: e.target.value})} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs text-white" />
           </div>
           <div>
             <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Status</label>
             <select 
                value={formData.status} 
                onChange={e => setFormData({...formData, status: e.target.value})} 
                className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs text-white [color-scheme:dark]"
             >
                {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
             </select>
           </div>
           <div>
             <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Doc Link</label>
             <input value={formData.document_link} onChange={e => setFormData({...formData, document_link: e.target.value})} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs text-white font-mono" />
           </div>
           <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Effective Date</label>
                <input type="date" value={formData.effective_date?.split('T')[0]} onChange={e => setFormData({...formData, effective_date: e.target.value})} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs text-white [color-scheme:dark]" />
              </div>
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Expiry Date</label>
                <input type="date" value={formData.expiry_date?.split('T')[0]} onChange={e => setFormData({...formData, expiry_date: e.target.value})} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs text-white [color-scheme:dark]" />
              </div>
           </div>
        </div>

        <div className="flex space-x-3 pt-10 mt-auto">
          <button onClick={onClose} className="flex-1 py-4 text-[11px] font-bold uppercase text-slate-500 hover:text-white transition-colors">Discard</button>
          <button onClick={() => onSave(formData)} className="flex-[2] py-4 bg-blue-600 text-white rounded-lg text-[11px] font-bold uppercase shadow-lg shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center gap-2">
            {isSaving ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16} />} 
            Initialize Contract
          </button>
        </div>
      </motion.div>
    </div>
  )
}

function ContractDetailsForm({ item, devices, systems, onClose, onSave, isSaving }: any) {
  const [formData, setFormData] = useState({ ...item })
  const [isEditing, setIsEditing] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [isInfraCollapsed, setIsInfraCollapsed] = useState(true)
  const [selectedSowIndex, setSelectedSowIndex] = useState<number | null>(null)
  const [isEditingSow, setIsEditingSow] = useState(false)

  const statusOptions = ['Drafted', 'In Review', 'Completed', 'Cancelled', 'Expired']

  // Filter systems to only those present in devices
  const usedSystems = useMemo(() => {
    const assetSystems = new Set(devices?.map((d: any) => d.system).filter(Boolean));
    return systems?.filter((s: any) => assetSystems.has(s.value)) || [];
  }, [devices, systems]);

  const addSOW = () => {
    const newSowItem = { work_description: 'NEW SCOPE ITEM', frequency: 'Monthly', response: 'NBD', objective_description: '', importance: 'Medium' };
    const sow = [...(formData.scope_of_work || []), newSowItem]
    setFormData({ ...formData, scope_of_work: sow })
    setHasChanges(true)
    setSelectedSowIndex(sow.length - 1)
    setIsEditingSow(true)
  }

  const filteredAssets = useMemo(() => {
    if (!formData.covered_systems || formData.covered_systems.length === 0) return [];
    return devices?.filter((d: any) => formData.covered_systems.includes(d.system)) || [];
  }, [devices, formData.covered_systems])

  const toggleSystem = (sys: string) => {
    const syss = [...(formData.covered_systems || [])]
    let newSyss;
    if (syss.includes(sys)) {
      newSyss = syss.filter(s => s !== sys)
    } else {
      newSyss = [...syss, sys]
    }
    setFormData({...formData, covered_systems: newSyss})
    setHasChanges(true)
  }

  const toggleAsset = (assetId: number) => {
    const assets = [...(formData.covered_assets || [])]
    let newAssets;
    if (assets.includes(assetId)) {
      newAssets = assets.filter(id => id !== assetId)
    } else {
      newAssets = [...assets, assetId]
    }
    setFormData({...formData, covered_assets: newAssets})
    setHasChanges(true)
  }

  const handleSave = () => {
    onSave(formData)
    setIsEditing(false)
    setHasChanges(false)
  }

  const updateField = (field: string, value: any) => {
    setFormData({ ...formData, [field]: value })
    setHasChanges(true)
  }

  const updateSchedule = (field: string, value: any) => {
    setFormData({ ...formData, schedule: { ...formData.schedule, [field]: value } })
    setHasChanges(true)
  }

  const updateSowItem = (index: number, field: string, value: any) => {
    const newSow = [...formData.scope_of_work];
    newSow[index] = { ...newSow[index], [field]: value };
    setFormData({ ...formData, scope_of_work: newSow });
    setHasChanges(true);
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/95 backdrop-blur-md p-10">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel w-[1200px] max-h-[95vh] p-10 rounded-lg border border-blue-500/30 overflow-y-auto custom-scrollbar flex flex-col">
        <div className="flex items-center justify-between border-b border-white/5 pb-6">
          <div className="flex items-center gap-6">
             <h2 className="text-2xl font-bold uppercase text-blue-400 flex items-center gap-3"><FileText size={24} /> Contract Details</h2>
             {!isEditing ? (
               <button onClick={() => setIsEditing(true)} className="px-4 py-1.5 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all">Enable Edit Mode</button>
             ) : (
               <div className="flex items-center gap-2">
                 <button onClick={() => { setFormData({...item}); setIsEditing(false); setHasChanges(false); setIsEditingSow(false); }} className="px-4 py-1.5 bg-white/5 text-slate-400 border border-white/10 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:text-white transition-all">Cancel</button>
                 {hasChanges && (
                    <button onClick={handleSave} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2">
                        {isSaving ? <RefreshCcw size={12} className="animate-spin" /> : <Save size={12} />} 
                        Save Changes
                    </button>
                 )}
               </div>
             )}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><X size={24}/></button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar mt-8 pr-4">
          <div className="space-y-10">
           {/* Row 1: Admin & Policy */}
           <div className="grid grid-cols-2 gap-10">
              <section className="space-y-6">
                 <SectionHeader icon={Info} title="Administrative Info" />
                 <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                       <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1 tracking-widest">Contract Title</label>
                       {isEditing ? (
                         <input value={formData.title} onChange={e => updateField('title', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs text-white outline-none focus:border-blue-500/50 transition-all" />
                       ) : (
                         <p className="text-sm font-bold text-white uppercase py-2 tracking-tight">{formData.title || '---'}</p>
                       )}
                    </div>
                    <div>
                       <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1 tracking-widest">Contract ID</label>
                       {isEditing ? (
                         <input value={formData.contract_id} onChange={e => updateField('contract_id', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs text-white outline-none focus:border-blue-500/50 transition-all" />
                       ) : (
                         <p className="text-sm font-bold text-white uppercase py-2 tracking-tight">{formData.contract_id || '---'}</p>
                       )}
                    </div>
                    <div>
                       <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1 tracking-widest">Status</label>
                       {isEditing ? (
                         <select 
                            value={formData.status || 'Drafted'} 
                            onChange={e => updateField('status', e.target.value)} 
                            className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs text-white [color-scheme:dark] outline-none focus:border-blue-500/50 transition-all"
                         >
                            {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                         </select>
                       ) : (
                         <p className="text-sm font-bold text-white uppercase py-2 tracking-tight">{formData.status || 'Drafted'}</p>
                       )}
                    </div>
                    <div>
                       <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1 tracking-widest">Doc Link</label>
                       {isEditing ? (
                         <input value={formData.document_link} onChange={e => updateField('document_link', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs text-white font-mono outline-none focus:border-blue-500/50 transition-all" />
                       ) : (
                         formData.document_link ? (
                           <a href={formData.document_link} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-blue-400 py-2 tracking-tight hover:underline flex items-center gap-2">
                             <ExternalLink size={12} /> View Document
                           </a>
                         ) : <p className="text-sm font-bold text-slate-500 py-2 tracking-tight">No link provided</p>
                       )}
                    </div>
                    <div>
                       <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1 tracking-widest">Effective Date</label>
                       {isEditing ? (
                         <input type="date" value={formData.effective_date?.split('T')[0]} onChange={e => updateField('effective_date', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs text-white [color-scheme:dark] outline-none focus:border-blue-500/50 transition-all" />
                       ) : (
                         <p className="text-sm font-bold text-white py-2 tracking-tight">{formatAppDay(formData.effective_date)}</p>
                       )}
                    </div>
                    <div>
                       <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1 tracking-widest">Expiry Date</label>
                       {isEditing ? (
                         <input type="date" value={formData.expiry_date?.split('T')[0]} onChange={e => updateField('expiry_date', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-xs text-white [color-scheme:dark] outline-none focus:border-blue-500/50 transition-all" />
                       ) : (
                         <p className="text-sm font-bold text-white py-2 tracking-tight">{formatAppDay(formData.expiry_date)}</p>
                       )}
                    </div>
                 </div>
              </section>

              <section className="space-y-6">
                 <SectionHeader icon={Clock} title="Availability & Policy" color="text-emerald-400" />
                 <div className="grid grid-cols-2 gap-4">
                    <div>
                       <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1 tracking-widest">Work Schedule</label>
                       {isEditing ? (
                         <input value={formData.schedule?.work_schedule} onChange={e => updateSchedule('work_schedule', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs text-white outline-none focus:border-emerald-500/30 transition-all" />
                       ) : (
                         <p className="text-sm font-bold text-white uppercase py-2 tracking-tight">{formData.schedule?.work_schedule || '---'}</p>
                       )}
                    </div>
                    <div>
                       <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1 tracking-widest">On-Call Method</label>
                       {isEditing ? (
                         <input value={formData.schedule?.oncall_method} onChange={e => updateSchedule('oncall_method', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs text-white outline-none focus:border-emerald-500/30 transition-all" />
                       ) : (
                         <p className="text-sm font-bold text-white uppercase py-2 tracking-tight">{formData.schedule?.oncall_method || '---'}</p>
                       )}
                    </div>
                    <div className="col-span-2">
                       <label className="text-[9px] font-bold text-slate-500 uppercase block mb-1 tracking-widest">Holiday Policy</label>
                       {isEditing ? (
                         <textarea value={formData.schedule?.holiday_policy} onChange={e => updateSchedule('holiday_policy', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs text-white min-h-[60px] outline-none focus:border-emerald-500/30 transition-all" />
                       ) : (
                         <p className="text-sm font-bold text-white uppercase py-2 tracking-tight leading-relaxed">{formData.schedule?.holiday_policy || '---'}</p>
                       )}
                    </div>
                 </div>
              </section>
           </div>

           {/* Row 2: Infrastructure Coverage (Collapsible) */}
           <section className="bg-white/5 border border-white/5 rounded-lg overflow-hidden">
              <button 
                onClick={() => setIsInfraCollapsed(!isInfraCollapsed)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/5 transition-all"
              >
                 <div className="flex items-center space-x-3">
                    <Layers size={16} className="text-indigo-400" />
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Infrastructure Coverage</h3>
                    {isInfraCollapsed && formData.covered_systems?.length > 0 && (
                      <div className="flex items-center space-x-2 ml-4">
                         <span className="px-2 py-0.5 rounded-lg bg-indigo-600/20 text-indigo-400 text-[8px] font-bold uppercase">{formData.covered_systems[0]}</span>
                         {formData.covered_systems.length > 1 && (
                           <span className="text-[8px] font-bold text-slate-600">+{formData.covered_systems.length - 1} MORE</span>
                         )}
                      </div>
                    )}
                 </div>
                 {isInfraCollapsed ? <Plus size={14} className="text-slate-500"/> : <X size={14} className="text-slate-500"/>}
              </button>

              <AnimatePresence>
                {!isInfraCollapsed && (
                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                    <div className="p-6 border-t border-white/5 grid grid-cols-2 gap-10">
                       <div className="space-y-2">
                          <label className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Covered Systems</label>
                          <div className="bg-black/20 rounded-lg border border-white/5 p-3 h-48 overflow-y-auto custom-scrollbar space-y-1.5">
                             {usedSystems.length === 0 && <p className="text-[8px] text-slate-600 text-center py-16 uppercase font-bold">No active systems found in assets</p>}
                             {usedSystems.map((s: any) => (
                                <label key={s.value} className={`flex items-center space-x-3 p-2 rounded-lg transition-all ${isEditing ? 'hover:bg-white/5 cursor-pointer' : ''}`}>
                                   <input disabled={!isEditing} type="checkbox" checked={formData.covered_systems?.includes(s.value)} onChange={() => toggleSystem(s.value)} className="w-4 h-4 rounded-lg border-white/10 bg-slate-900 text-blue-600 focus:ring-blue-500/20" />
                                   <span className={`text-[10px] font-bold uppercase tracking-tight ${formData.covered_systems?.includes(s.value) ? 'text-white' : 'text-slate-500'}`}>{s.label}</span>
                                </label>
                             ))}
                          </div>
                       </div>
                       <div className="space-y-2">
                          <label className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Propagated Assets</label>
                          <div className="bg-black/20 rounded-lg border border-white/5 p-3 h-48 overflow-y-auto custom-scrollbar space-y-1.5">
                             {filteredAssets.length === 0 && (
                               <div className="flex flex-col items-center justify-center h-full space-y-2 text-slate-600">
                                  <Server size={20} className="opacity-20" />
                                  <p className="text-[8px] uppercase font-bold text-center">Select systems to list assets</p>
                               </div>
                             )}
                             {filteredAssets.map((a: any) => (
                                <label key={a.id} className={`flex items-center space-x-3 p-2 rounded-lg transition-all ${isEditing ? 'hover:bg-white/5 cursor-pointer' : ''}`}>
                                   <input disabled={!isEditing} type="checkbox" checked={formData.covered_assets?.includes(a.id)} onChange={() => toggleAsset(a.id)} className="w-4 h-4 rounded-lg border-white/10 bg-slate-900 text-indigo-600 focus:ring-indigo-500/20" />
                                   <div className="flex flex-col min-w-0">
                                      <span className={`text-[10px] font-bold uppercase tracking-tight truncate ${formData.covered_assets?.includes(a.id) ? 'text-white' : 'text-slate-500'}`}>{a.name}</span>
                                      <span className="text-[8px] text-slate-600 font-bold uppercase tracking-tighter">{a.system}</span>
                                   </div>
                                </label>
                             ))}
                          </div>
                       </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
           </section>

           {/* Row 3: Scope of Work Matrix */}
           <section className="space-y-6">
              <div className="flex items-center justify-between">
                 <SectionHeader icon={Terminal} title="Scope of Work Matrix" color="text-amber-400" />
                 {isEditing && (
                   <button onClick={addSOW} className="p-1.5 bg-amber-600/20 text-amber-400 hover:bg-amber-600 hover:text-white rounded-lg transition-all active:scale-95 shadow-lg shadow-amber-500/10">
                     <Plus size={14} />
                   </button>
                 )}
              </div>
              
              <div className="grid grid-cols-12 gap-8">
                 <div className="col-span-4 space-y-2">
                    <div className="bg-black/40 rounded-lg border border-white/5 h-[400px] overflow-y-auto custom-scrollbar">
                       {formData.scope_of_work?.map((s: any, i: number) => (
                          <button 
                             key={i} 
                             onClick={() => { setSelectedSowIndex(i); setIsEditingSow(false); }}
                             className={`w-full text-left p-4 border-b border-white/5 transition-all hover:bg-white/5 ${selectedSowIndex === i ? 'bg-amber-600/10 border-l-2 border-l-amber-500' : ''}`}
                          >
                             <div className="flex items-center justify-between">
                                <span className={`text-[10px] font-bold uppercase tracking-tight truncate flex-1 ${selectedSowIndex === i ? 'text-white' : 'text-slate-400'}`}>{s.work_description || 'Untitled Work'}</span>
                                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-lg ml-2 ${
                                   s.importance === 'Critical' ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-800 text-slate-500'
                                }`}>{s.importance}</span>
                             </div>
                          </button>
                       ))}
                       {(!formData.scope_of_work || formData.scope_of_work.length === 0) && (
                          <div className="p-10 text-center text-slate-600 text-[9px] font-bold uppercase tracking-widest">No scope items</div>
                       )}
                    </div>
                 </div>

                 <div className="col-span-8">
                    <AnimatePresence mode="wait">
                       {selectedSowIndex !== null ? (
                          <motion.div key={selectedSowIndex} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="bg-white/5 border border-white/5 rounded-lg p-8 relative h-full">
                             {isEditing && (
                               <div className="absolute top-4 right-4 flex items-center space-x-2">
                                  {!isEditingSow ? (
                                    <button onClick={() => setIsEditingSow(true)} className="p-2 bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white rounded-lg transition-all"><Edit2 size={14}/></button>
                                  ) : (
                                    <button onClick={() => setIsEditingSow(false)} className="p-2 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white rounded-lg transition-all"><Check size={14}/></button>
                                  )}
                                  <button onClick={() => { setFormData({...formData, scope_of_work: formData.scope_of_work.filter((_:any, idx:number) => idx !== selectedSowIndex)}); setHasChanges(true); setSelectedSowIndex(null); }} className="p-2 bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white rounded-lg transition-all"><Trash2 size={14}/></button>
                               </div>
                             )}
                             
                             <div className="space-y-6">
                                <div>
                                   <label className="text-[8px] font-bold text-slate-600 uppercase mb-2 block">Work Description</label>
                                   {isEditingSow ? (
                                     <input value={formData.scope_of_work[selectedSowIndex].work_description} onChange={e => updateSowItem(selectedSowIndex, 'work_description', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs text-white outline-none focus:border-amber-500/30 transition-all" />
                                   ) : (
                                     <p className="text-sm font-bold text-white uppercase tracking-tight">{formData.scope_of_work[selectedSowIndex].work_description || '---'}</p>
                                   )}
                                </div>

                                <div className="grid grid-cols-2 gap-6">
                                   <div>
                                      <label className="text-[8px] font-bold text-slate-600 uppercase mb-2 block">Frequency</label>
                                      {isEditingSow ? (
                                        <input value={formData.scope_of_work[selectedSowIndex].frequency} onChange={e => updateSowItem(selectedSowIndex, 'frequency', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs text-white outline-none focus:border-amber-500/30 transition-all" />
                                      ) : (
                                        <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">{formData.scope_of_work[selectedSowIndex].frequency || '---'}</p>
                                      )}
                                   </div>
                                   <div>
                                      <label className="text-[8px] font-bold text-slate-600 uppercase mb-2 block">Response Time</label>
                                      {isEditingSow ? (
                                        <input value={formData.scope_of_work[selectedSowIndex].response} onChange={e => updateSowItem(selectedSowIndex, 'response', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs text-white outline-none focus:border-amber-500/30 transition-all" />
                                      ) : (
                                        <p className="text-xs font-bold text-white uppercase tracking-widest font-mono">{formData.scope_of_work[selectedSowIndex].response || '---'}</p>
                                      )}
                                   </div>
                                </div>

                                <div>
                                   <label className="text-[8px] font-bold text-slate-600 uppercase mb-2 block">Objective & Criticality</label>
                                   <div className="flex gap-4">
                                      {isEditingSow ? (
                                        <>
                                          <input placeholder="Purpose of this task..." value={formData.scope_of_work[selectedSowIndex].objective_description} onChange={e => updateSowItem(selectedSowIndex, 'objective_description', e.target.value)} className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs text-white outline-none focus:border-amber-500/30 transition-all" />
                                          <select value={formData.scope_of_work[selectedSowIndex].importance} onChange={e => updateSowItem(selectedSowIndex, 'importance', e.target.value)} className="w-32 bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-xs text-white outline-none focus:border-amber-500/30 transition-all">
                                            <option value="Critical">Critical</option>
                                            <option value="High">High</option>
                                            <option value="Medium">Medium</option>
                                            <option value="Low">Low</option>
                                          </select>
                                        </>
                                      ) : (
                                        <div className="flex items-center justify-between w-full p-4 bg-black/20 rounded-lg border border-white/5">
                                          <p className="text-xs font-bold text-slate-400 uppercase tracking-tight">{formData.scope_of_work[selectedSowIndex].objective_description || 'No objective defined'}</p>
                                          <span className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${
                                            formData.scope_of_work[selectedSowIndex].importance === 'Critical' ? 'bg-rose-600 text-white' : 
                                            formData.scope_of_work[selectedSowIndex].importance === 'High' ? 'bg-amber-600 text-white' : 
                                            'bg-slate-700 text-slate-300'
                                          }`}>{formData.scope_of_work[selectedSowIndex].importance}</span>
                                        </div>
                                      )}
                                   </div>
                                </div>
                             </div>
                          </motion.div>
                       ) : (
                          <div className="h-full bg-white/5 border border-dashed border-white/5 rounded-lg flex flex-col items-center justify-center text-slate-600 space-y-4">
                             <Terminal size={48} className="opacity-10" />
                             <p className="text-[10px] font-bold uppercase tracking-[0.2em]">Select an entry to view details</p>
                          </div>
                       )}
                    </AnimatePresence>
                 </div>
              </div>
           </section>

           {/* Row 4: Evolution & Changes */}
           <section className="space-y-6">
              <SectionHeader icon={RefreshCcw} title="Evolution & Changes" color="text-blue-400" />
              <div className="bg-white/5 border border-white/5 rounded-lg p-6">
                 <label className="text-[9px] font-bold text-slate-500 uppercase block mb-3 tracking-widest">Key modifications from previous version</label>
                 {isEditing ? (
                   <textarea value={formData.previous_contract_changes} onChange={e => updateField('previous_contract_changes', e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-xs text-white min-h-[120px] outline-none focus:border-blue-500/30 transition-all" placeholder="Document commercial or technical deviations..." />
                 ) : (
                   <p className="text-sm font-bold text-white uppercase py-2 tracking-tight leading-relaxed min-h-[100px] whitespace-pre-wrap">{formData.previous_contract_changes || 'Initial version - no previous changes recorded'}</p>
                 )}
              </div>
           </section>
        </div>

        </div>
      </motion.div>
    </div>
  )
}
