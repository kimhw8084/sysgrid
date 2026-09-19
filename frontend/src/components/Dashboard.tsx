import React, { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { 
  LayoutDashboard, Server, Network, Activity, 
  ArrowUpRight, Globe, Zap, Shield,
  Cpu, Box, Terminal, ListTree, HardDrive,
  AlertCircle, CheckCircle2, Clock, Info, ExternalLink,
  Workflow, History, TrendingUp, Search, AlertTriangle, BookOpen,
  Briefcase, ChevronRight, Share2, Layers, MapPin, ZapOff, Grid3X3, Target,
  MousePointer2, Fingerprint, BarChart3, PieChart as PieIcon, LineChart as LineIcon
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend
} from 'recharts'
import { apiFetch } from '../api/apiClient'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { formatAppDate, formatAppTime, formatAppDay, parseAppDate } from '../utils/dateUtils'
import { ModulePolicyLink, useModuleActionPolicy } from '../policy/ModulePolicy'

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-900/90 border border-white/10 p-3 rounded-lg backdrop-blur-md shadow-2xl">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <p className="text-[11px] font-bold text-white uppercase">
              {entry.name}: <span className="tabular-nums">{entry.value}</span>
            </p>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

    const StatCard = ({ title, total, metrics, icon: Icon, color, onClick, delay = 0 }: any) => {
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();

    const handleExpand = () => {
        // Standardizing URL update
        setSearchParams({ tab: title.toLowerCase() });
        if (onClick) {
            onClick();
        }
    };

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay, duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
        className="group relative h-full cursor-pointer overflow-hidden rounded-lg border border-white/5 bg-black/20 p-6 backdrop-blur-xl transition-all hover:border-blue-500/30 hover:bg-white/[0.03] shadow-lg"
        onClick={handleExpand}
        >
        <div className={`absolute -right-4 -top-4 h-24 w-24 bg-gradient-to-br ${color} opacity-[0.03] blur-2xl group-hover:opacity-[0.1] transition-opacity`} />
      
      <div className="flex items-start justify-between relative z-10">
        <div className={`flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br ${color} bg-opacity-10 border border-white/5 shadow-inner transition-transform group-hover:scale-110 group-hover:rotate-3`}>
          <Icon size={24} className="text-white" />
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</p>
          <h2 className="text-4xl font-black text-white tracking-tighter tabular-nums mt-1">{total}</h2>
        </div>
      </div>

      <div className="mt-8 space-y-4 relative z-10">
        {metrics && Object.entries(metrics).slice(0, 2).map(([key, value]: any) => {
          const totalForType = Object.values(value).reduce((a: number, b: any) => a + (typeof b === 'number' ? b : 0), 0);
          return (
            <div key={key} className="flex flex-col space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                <span className="text-slate-400 truncate pr-2">{key}</span>
                <span className="text-white">{(totalForType as number)}</span>
              </div>
              <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-white/5 p-0.5">
                 {Object.entries(value).map(([status, count]: any) => (
                    <div 
                      key={status} 
                      title={`${status}: ${count}`}
                      className={`h-full transition-all duration-500 cursor-pointer hover:brightness-125 rounded-full ${
                        status === 'Active' || status === 'Operational' || status === 'Existing' ? 'bg-emerald-500' :
                        status === 'Critical' || status === 'Down' ? 'bg-rose-500' :
                        status === 'Maintenance' || status === 'Warning' ? 'bg-amber-500' :
                        'bg-blue-500'
                      }`}
                      style={{ width: `${((count as number) / (totalForType as number)) * 100}%` }}
                    />
                 ))}
              </div>
            </div>
          )
        })}
      </div>
      
      <div className="mt-6 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
         <span className="text-[8px] font-black uppercase tracking-[0.2em] text-blue-400">Expand Module</span>
         <ArrowUpRight size={12} className="text-blue-400" />
      </div>
    </motion.div>
  )
}

const SiteClock = ({ site, delay }: any) => {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      className="px-5 py-4 bg-white/[0.03] border border-white/5 rounded-lg flex items-center justify-between group hover:border-blue-500/20 transition-all shadow-md relative overflow-hidden"
    >
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="flex flex-col">
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{site.name}</span>
        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">Regional Synchronizer</span>
      </div>
      <div className="text-right">
        <span className="text-xl font-black text-white tabular-nums group-hover:text-blue-400 transition-colors">
          {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
        </span>
      </div>
    </motion.div>
  )
}

const DashboardChart = ({ title, icon: Icon, children, delay }: any) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.98 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ delay, duration: 0.5 }}
    className="flex flex-col h-[300px] rounded-lg border border-white/5 bg-black/20 p-6 backdrop-blur-xl hover:border-white/10 transition-all shadow-xl relative overflow-hidden"
  >
    <div className="flex items-center justify-between mb-6 relative z-10">
       <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-600/10 text-blue-400 border border-blue-500/20">
             <Icon size={16} />
          </div>
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-white">{title}</h3>
       </div>
       <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
    </div>
    <div className="flex-1 min-h-0 relative z-10">
       {children}
    </div>
  </motion.div>
)

export default function Dashboard({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [globalSearch, setGlobalSearch] = useState('');
  const [navigationNotice, setNavigationNotice] = useState('');
  const farAction = useModuleActionPolicy('far');
  const projectsAction = useModuleActionPolicy('projects');

  const handleNavigate = (tab: string) => {
    setSearchParams({ tab: tab.toLowerCase() });
    onNavigate(tab);
  };
  
  const { data: metrics, isLoading } = useQuery({ 
    queryKey: ['dashboard-metrics'], 
    queryFn: async () => (await apiFetch('/api/v1/dashboard/metrics')).json(),
    refetchInterval: 10000
  })

  const { data: userProfile } = useQuery({
    queryKey: ['dashboard-user-profile'],
    queryFn: async () => (await apiFetch('/api/v1/settings/user/profile')).json()
  })

  // Simulated Pulse Data
  const pulseData = useMemo(() => {
    return Array.from({ length: 24 }).map((_, i) => ({
      time: `${i}:00`,
      stability: 90 + Math.random() * 10,
      latency: 20 + Math.random() * 40
    }));
  }, []);

  const assetDistributionData = useMemo(() => {
    if (!metrics?.asset_overview?.breakdown) return [];
    const types = metrics.asset_overview.breakdown['By Type'] || {};
    return Object.entries(types).map(([name, value]) => ({
      name,
      value: Object.values(value as any).reduce((a: any, b: any) => a + b, 0)
    }));
  }, [metrics]);

  const serviceStatusData = useMemo(() => {
    if (!metrics?.service_overview?.breakdown) return [];
    const statuses = metrics.service_overview.breakdown['By Status'] || {};
    return Object.entries(statuses).map(([name, value]) => ({
      name,
      count: value
    }));
  }, [metrics]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  if (isLoading) return (
    <div className="h-full w-full flex items-center justify-center bg-[var(--bg-primary)]">
       <div className="relative">
          <div className="absolute inset-0 bg-blue-500/20 blur-[100px] animate-pulse rounded-lg" />
          <div className="flex flex-col items-center gap-6 relative z-10">
             <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin shadow-[0_0_30px_rgba(37,99,235,0.3)]" />
             <div className="flex flex-col items-center">
                <h1 className="text-2xl font-black uppercase tracking-tighter text-white animate-pulse">Initializing Matrix</h1>
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.5em] mt-2">Sector-01 Data Orchestrator</p>
             </div>
          </div>
       </div>
    </div>
  )

  const handleGlobalSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!globalSearch) return;
    const term = globalSearch.toUpperCase();
    const action = term.startsWith('FAR') ? farAction : term.startsWith('PROJ') ? projectsAction : null;
    if (action?.disabled) {
      setNavigationNotice(action.reason);
      return;
    }
    setNavigationNotice('');
    if (term.startsWith('FAR')) navigate(`/far?id=${term.replace('FAR-', '')}`);
    else if (term.startsWith('PROJ')) navigate(`/projects?search=${term}`);
    else navigate(`/asset?search=${term}`);
  };

  return (
    <div className="h-full w-full flex flex-col space-y-8 overflow-hidden pr-2">
      {/* Top Section: Identity & Stability */}
      <div className="flex items-start justify-between shrink-0">
        <div className="flex items-center gap-8">
           <div className="relative group">
              <div className="absolute inset-0 bg-blue-600/30 blur-2xl rounded-full group-hover:bg-blue-600/50 transition-colors" />
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-slate-900 to-black flex items-center justify-center border border-white/10 shadow-2xl relative z-10 overflow-hidden group">
                 <div className="absolute inset-0 bg-blue-600 opacity-0 group-hover:opacity-10 transition-opacity" />
                 <Fingerprint size={40} className="text-blue-500 transition-transform group-hover:scale-110" />
                 <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-500 shadow-[0_0_10px_#3b82f6]" />
              </div>
           </div>
           <div>
              <div className="flex items-center gap-3">
                 <span className="px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-[8px] font-black text-blue-400 uppercase tracking-widest">Operator Session</span>
                 <span className="text-[8px] font-black text-slate-600 uppercase tracking-[0.3em]">SEC-LVL: ALPHA-01</span>
              </div>
              <h1 className="text-5xl font-black tracking-tighter text-white leading-tight mt-1">
                {greeting}, <span className="text-blue-500">{userProfile?.full_name?.split(' ')[0] || userProfile?.username || 'Operator'}</span>
              </h1>
              <p className="text-[11px] text-slate-500 font-bold tracking-tight uppercase mt-1">
                Current mandate: <span className="text-slate-300">Infrastructure Resilience & High-Fidelity Observability</span>
              </p>
           </div>
        </div>

        <div className="flex items-center gap-10">
           <div className="text-right">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Stability Index</p>
              <div className="flex items-baseline gap-2">
                 <span className="text-5xl font-black text-white tracking-tighter tabular-nums">{metrics?.stability_score}%</span>
                 <TrendingUp size={20} className="text-emerald-500" />
              </div>
           </div>
           <div className="h-16 w-px bg-white/5" />
           <div className="text-right">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Active Incidents</p>
              <div className="flex items-baseline gap-2">
                 <span className="text-5xl font-black text-rose-500 tracking-tighter tabular-nums">{metrics?.critical_alerts?.length || 0}</span>
                 <AlertCircle size={20} className="text-rose-500 animate-pulse" />
              </div>
           </div>
        </div>
      </div>

      {/* Stability Pulse Area */}
      <div className="grid grid-cols-12 gap-8 shrink-0">
         <div className="col-span-8 glass-panel rounded-lg border-white/5 bg-black/40 p-8 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10">
               <Activity size={120} className="text-blue-500" />
            </div>
            <div className="flex items-center justify-between mb-8 relative z-10">
               <div>
                  <h3 className="text-[12px] font-black uppercase tracking-[0.3em] text-white">Stability Pulse (24H)</h3>
                  <p className="text-[10px] text-slate-500 font-bold uppercase mt-1">Real-time aggregate reliability metrics</p>
               </div>
               <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                     <div className="w-2 h-2 rounded-full bg-blue-500" />
                     <span className="text-[9px] font-black text-slate-400 uppercase">Availability</span>
                  </div>
                  <div className="flex items-center gap-2">
                     <div className="w-2 h-2 rounded-full bg-emerald-500" />
                     <span className="text-[9px] font-black text-slate-400 uppercase">Latency</span>
                  </div>
               </div>
            </div>
            <div className="h-[180px] w-full relative z-10">
               <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={pulseData}>
                     <defs>
                        <linearGradient id="colorStab" x1="0" y1="0" x2="0" y2="1">
                           <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                           <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorLat" x1="0" y1="0" x2="0" y2="1">
                           <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                           <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                     </defs>
                     <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                     <XAxis 
                        dataKey="time" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#475569', fontSize: 9, fontWeight: 900 }} 
                        interval={3}
                     />
                     <YAxis hide />
                     <Tooltip content={<CustomTooltip />} />
                     <Area type="monotone" dataKey="stability" name="Availability" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorStab)" />
                     <Area type="monotone" dataKey="latency" name="Latency" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorLat)" />
                  </AreaChart>
               </ResponsiveContainer>
            </div>
         </div>

         <div className="col-span-4 flex flex-col gap-4">
            <div className="flex-1 glass-panel rounded-lg border-white/5 bg-black/40 p-8 flex flex-col justify-center relative overflow-hidden group hover:border-blue-500/20 transition-all cursor-pointer shadow-xl" onClick={() => onNavigate('monitoring')}>
               <div className="absolute top-4 right-4 text-slate-800 group-hover:text-blue-500/20 transition-colors">
                  <Shield size={64} />
               </div>
               <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-500 mb-2">Defense Status</p>
               <h3 className="text-4xl font-black text-white uppercase tracking-tighter">Hardened</h3>
               <div className="flex items-center gap-3 mt-6">
                  <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase tracking-widest flex items-center gap-2">
                     <CheckCircle2 size={12} /> Sentinel Active
                  </div>
                  <div className="px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[9px] font-black uppercase tracking-widest">
                     V-SCAN: 100%
                  </div>
               </div>
            </div>
            
            <form onSubmit={handleGlobalSearch} className="relative group shadow-xl">
               <div className="absolute inset-0 bg-blue-600/5 blur-xl group-focus-within:bg-blue-600/10 transition-colors" />
               <Search size={20} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-blue-500 transition-colors" />
               <input 
                 value={globalSearch}
                 onChange={e => setGlobalSearch(e.target.value)}
                 placeholder="Search Matrix Context..."
                 className="w-full bg-black/60 border border-white/10 rounded-lg pl-14 pr-6 py-5 text-[12px] font-black text-white outline-none focus:border-blue-500/50 focus:bg-white/[0.03] transition-all shadow-inner uppercase tracking-wider"
               />
               <div className="absolute right-5 top-1/2 -translate-y-1/2 opacity-20 group-focus-within:opacity-100 transition-opacity">
                  <MousePointer2 size={16} className="text-blue-500" />
               </div>
            </form>
            {navigationNotice ? <p role="status" className="text-[9px] font-bold uppercase tracking-widest text-amber-400">{navigationNotice}</p> : null}
         </div>
      </div>

      {/* Scrollable Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar pb-10 space-y-8 pr-2">
        
        {/* Module Breakdown Grid */}
        <div className="grid grid-cols-4 gap-6">
           <StatCard 
              title="Infrastructure Assets" 
              total={metrics?.asset_overview.total} 
              metrics={metrics?.asset_overview.breakdown}
              icon={Server} 
              color="from-blue-600 to-blue-800"
              onClick={() => onNavigate('asset')}
              delay={0.1}
           />
           <StatCard 
              title="Logical Services" 
              total={metrics?.service_overview.total} 
              metrics={metrics?.service_overview.breakdown}
              icon={Layers} 
              color="from-indigo-600 to-indigo-800"
              onClick={() => onNavigate('services')}
              delay={0.2}
           />
           <StatCard 
              title="Global Network" 
              total={metrics?.network_overview.total} 
              metrics={metrics?.network_overview.breakdown}
              icon={Network} 
              color="from-emerald-600 to-emerald-800"
              onClick={() => onNavigate('network')}
              delay={0.3}
           />
           <StatCard 
              title="Critical Monitors" 
              total={metrics?.monitoring_overview.total} 
              metrics={metrics?.monitoring_overview.breakdown}
              icon={Activity} 
              color="from-rose-600 to-rose-800"
              onClick={() => onNavigate('monitoring')}
              delay={0.4}
           />
        </div>

        {/* Visualization Area */}
        <div className="grid grid-cols-3 gap-8">
           <DashboardChart title="Asset Composition" icon={PieIcon} delay={0.5}>
              <ResponsiveContainer width="100%" height="100%">
                 <PieChart>
                    <Pie
                       data={assetDistributionData}
                       cx="50%"
                       cy="50%"
                       innerRadius={60}
                       outerRadius={80}
                       paddingAngle={5}
                       dataKey="value"
                       stroke="none"
                    >
                       {assetDistributionData.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                       ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend 
                       layout="vertical" 
                       verticalAlign="middle" 
                       align="right"
                       formatter={(value) => <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">{value}</span>}
                       iconType="circle"
                    />
                 </PieChart>
              </ResponsiveContainer>
           </DashboardChart>

           <DashboardChart title="Service Health Matrix" icon={BarChart3} delay={0.6}>
              <ResponsiveContainer width="100%" height="100%">
                 <BarChart data={serviceStatusData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                    <XAxis 
                       dataKey="name" 
                       axisLine={false} 
                       tickLine={false} 
                       tick={{ fill: '#475569', fontSize: 9, fontWeight: 900 }} 
                    />
                    <YAxis hide />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                       {serviceStatusData.map((entry: any, index: number) => (
                          <Cell 
                             key={`cell-${index}`} 
                             fill={
                                entry.name === 'Active' ? '#10b981' : 
                                entry.name === 'Critical' ? '#ef4444' : 
                                entry.name === 'Maintenance' ? '#f59e0b' : '#3b82f6'
                             } 
                          />
                       ))}
                    </Bar>
                 </BarChart>
              </ResponsiveContainer>
           </DashboardChart>

           <div className="glass-panel p-6 rounded-lg border-white/5 bg-black/20 flex flex-col shadow-xl">
              <div className="flex items-center gap-3 mb-6">
                 <div className="p-2 rounded-lg bg-amber-600/10 text-amber-400 border border-amber-500/20">
                    <Globe size={16} />
                 </div>
                 <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-white">Global Chronos</h3>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto custom-scrollbar pr-2">
                 {metrics?.rack_overview.sites?.map((site: any, i: number) => (
                    <SiteClock key={site.id} site={site} delay={i * 0.1} />
                 ))}
                 {(!metrics?.rack_overview.sites || metrics?.rack_overview.sites.length === 0) && (
                    <div className="flex flex-col items-center justify-center h-full opacity-20">
                       <MapPin size={24} />
                       <span className="text-[10px] font-black uppercase tracking-widest mt-2">Regional Gap</span>
                    </div>
                 )}
              </div>
           </div>
        </div>

        {/* Bottom Level: Detailed Feeds */}
        <div className="grid grid-cols-12 gap-8">
           <div className="col-span-4 glass-panel rounded-lg border-white/5 bg-black/20 p-8 shadow-xl flex flex-col h-[400px]">
              <div className="flex items-center justify-between mb-8">
                 <div className="flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-blue-600/10 text-blue-400 border border-blue-500/20">
                       <History size={18} />
                    </div>
                    <h3 className="text-[12px] font-black uppercase tracking-[0.2em] text-white">Execution Stream</h3>
                 </div>
                 <Link to="/logs" className="p-2 rounded-lg hover:bg-white/5 text-slate-500 hover:text-white transition-all"><ExternalLink size={16}/></Link>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto custom-scrollbar pr-2">
                 {metrics?.recent.activity?.map((log: any) => (
                    <div key={log.id} className="p-4 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] transition-all group/log relative overflow-hidden">
                       <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-500 opacity-0 group-hover/log:opacity-100 transition-opacity" />
                       <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">{log.user}</span>
                          <span className="text-[9px] font-bold text-slate-600 uppercase tabular-nums">
                            {formatDistanceToNow(parseAppDate(log.timestamp)!, { addSuffix: true })}
                          </span>
                       </div>
                       <p className="text-[11px] font-bold text-slate-300 leading-tight uppercase tracking-tight group-hover/log:text-white transition-colors">{log.description || `${log.action} ${log.target}`}</p>
                    </div>
                 ))}
              </div>
           </div>

           <div className="col-span-8 grid grid-cols-3 gap-6">
              {[
                { moduleId: 'far', title: 'Failure Forensics', items: metrics?.recent?.far, icon: AlertTriangle, color: 'text-rose-400', path: '/far' },
                { moduleId: 'projects', title: 'Strategic Pipeline', items: metrics?.recent?.projects?.in_progress, icon: Briefcase, color: 'text-blue-400', path: '/projects' },
                { moduleId: 'knowledge', title: 'Intel Knowledge', items: metrics?.recent?.knowledge, icon: BookOpen, color: 'text-amber-400', path: '/knowledge' }
              ].map((feed, i) => (
                <div key={i} className="glass-panel rounded-lg border-white/5 bg-black/20 p-8 shadow-xl flex flex-col h-[400px]">
                   <div className="flex items-center justify-between mb-8">
                      <div className="flex items-center gap-4">
                         <div className={`p-3 rounded-lg bg-white/[0.03] ${feed.color} border border-white/5`}>
                            <feed.icon size={18} />
                         </div>
                         <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-white leading-none">{feed.title}</h3>
                      </div>
                   </div>
                   <div className="flex-1 space-y-3 overflow-y-auto custom-scrollbar pr-1">
                      {feed.items?.map((item: any, idx: number) => (
                        <ModulePolicyLink
                          key={item.id || idx} 
                          moduleId={feed.moduleId}
                          to={`${feed.path}?id=${item.id}`}
                          className="flex items-center justify-between p-4 rounded-lg bg-white/[0.02] border border-white/5 hover:border-blue-500/20 hover:bg-white/[0.05] transition-all group/item shadow-sm"
                        >
                          <div className="flex flex-col min-w-0">
                            <span className="text-[11px] font-black text-slate-200 tracking-tight truncate group-hover/item:text-blue-400 transition-colors uppercase">{item.title}</span>
                            <span className="text-[8px] font-black text-slate-600 uppercase mt-1 tracking-widest">{formatAppDay(item.created_at || item.updated_at)}</span>
                          </div>
                          <ChevronRight size={12} className="text-slate-700 group-hover/item:translate-x-1 transition-transform" />
                        </ModulePolicyLink>
                      ))}
                      {(!feed.items || feed.items.length === 0) && (
                         <div className="flex flex-col items-center justify-center h-full opacity-10">
                            <ZapOff size={32} />
                            <span className="text-[10px] font-black uppercase tracking-widest mt-4">Zero Signal</span>
                         </div>
                      )}
                   </div>
                </div>
              ))}
           </div>
        </div>

      </div>
    </div>
  )
}
