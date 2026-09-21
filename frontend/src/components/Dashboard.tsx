import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  ExternalLink,
  Fingerprint,
  Globe,
  History,
  Info,
  Layers,
  MapPin,
  Network,
  PieChart as PieIcon,
  Search,
  Server,
  ZapOff,
} from 'lucide-react'
import { motion } from 'framer-motion'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { apiFetch } from '../api/apiClient'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { formatAppDay, parseAppDate } from '../utils/dateUtils'
import {
  ModulePolicyLink,
  resolveModuleActionState,
  useModulePolicy,
} from '../policy/ModulePolicy'

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

export type DashboardTruth = {
  value: number | string | null
  kind: 'inventory' | 'configuration' | 'activity' | 'observed_health' | 'incident'
  source: string
  as_of: string
  observed_at?: string | null
  freshness: 'current' | 'stale' | 'not_applicable' | 'unavailable'
  available: boolean
  unavailable_reason?: string | null
  module_id?: string | null
  path?: string | null
}

export type DashboardSearchResult = {
  id: number
  type: string
  title: string
  subtitle: string
  tag: string
  path: string
  module_id: string
  module_label?: string
  module_stage?: string
}

export function dashboardTruthLabel(truth: DashboardTruth | undefined): string {
  if (!truth || !truth.available || truth.freshness === 'unavailable') return 'Unavailable'
  if (truth.freshness === 'stale') return 'Stale'
  return truth.kind === 'configuration' ? 'Configured' : 'Available'
}

export function dashboardTruthReason(truth: DashboardTruth | undefined): string {
  if (!truth) return 'Home truth is unavailable.'
  return truth.unavailable_reason || `Source: ${truth.source}`
}

export function buildDashboardSearchPath(result: DashboardSearchResult): string {
  const separator = result.path.includes('?') ? '&' : '?'
  return `${result.path}${separator}id=${encodeURIComponent(String(result.id))}`
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/90 p-3 shadow-2xl backdrop-blur-md">
      <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      {payload.map((entry: any, index: number) => (
        <div key={index} className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <p className="text-[11px] font-bold uppercase text-white">
            {entry.name}: <span className="tabular-nums">{entry.value}</span>
          </p>
        </div>
      ))}
    </div>
  )
}

const TruthValue = ({ label, truth }: { label: string; truth?: DashboardTruth }) => (
  <div className="flex min-w-[150px] flex-col gap-1 text-right">
    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
    <div className="flex items-center justify-end gap-2">
      <span className="text-xl font-black tracking-tight text-slate-200" data-home-truth-state={truth?.available ? 'available' : 'unavailable'}>
        {dashboardTruthLabel(truth)}
      </span>
      <Info size={16} className="text-slate-500" aria-hidden="true" />
    </div>
    <span className="text-[9px] font-bold uppercase tracking-wide text-slate-600">{dashboardTruthReason(truth)}</span>
  </div>
)

const StatCard = ({
  title,
  total,
  metrics,
  truth,
  icon: Icon,
  color,
  moduleId,
  path,
  delay = 0,
}: {
  title: string
  total: number | null
  metrics: Record<string, Record<string, number>>
  truth: DashboardTruth
  icon: any
  color: string
  moduleId: string
  path: string
  delay?: number
}) => (
  <ModulePolicyLink
    moduleId={moduleId}
    to={path}
    className="block h-full rounded-lg"
    aria-label={`Open ${title}`}
  >
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
      className="group relative h-full cursor-pointer overflow-hidden rounded-lg border border-white/5 bg-black/20 p-6 shadow-lg backdrop-blur-xl transition-all hover:border-blue-500/30 hover:bg-white/[0.03]"
    >
      <div className={`absolute -right-4 -top-4 h-24 w-24 bg-gradient-to-br ${color} opacity-[0.03] blur-2xl transition-opacity group-hover:opacity-[0.1]`} />
      <div className="relative z-10 flex items-start justify-between">
        <div className={`flex h-12 w-12 items-center justify-center rounded-lg border border-white/5 bg-gradient-to-br ${color} bg-opacity-10 shadow-inner transition-transform group-hover:rotate-3 group-hover:scale-110`}>
          <Icon size={24} className="text-white" aria-hidden="true" />
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</p>
          <h2 className="mt-1 text-3xl font-black tracking-tighter text-white tabular-nums">{truth.available ? total ?? 0 : 'Unavailable'}</h2>
        </div>
      </div>
      <div className="relative z-10 mt-8 space-y-4">
        {truth.available && Object.entries(metrics).slice(0, 2).map(([key, value]) => {
          const totalForType = Object.values(value).reduce((sum, count) => sum + count, 0)
          return (
            <div key={key} className="flex flex-col space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                <span className="truncate pr-2 text-slate-400">{key}</span>
                <span className="text-white">{totalForType}</span>
              </div>
              <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-white/5 p-0.5" aria-label={`${key} persisted counts`}>
                {Object.entries(value).map(([status, count]) => (
                  <div
                    key={status}
                    title={`${status}: ${count}`}
                    className={`h-full rounded-full transition-all duration-500 ${
                      status === 'Active' || status === 'Operational' || status === 'Existing' ? 'bg-emerald-500' :
                      status === 'Critical' || status === 'Down' ? 'bg-rose-500' :
                      status === 'Maintenance' || status === 'Warning' ? 'bg-amber-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${totalForType ? (count / totalForType) * 100 : 0}%` }}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-6 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
        <span className="text-[8px] font-black uppercase tracking-[0.2em] text-blue-400">Open released module</span>
        <ArrowUpRight size={12} className="text-blue-400" aria-hidden="true" />
      </div>
    </motion.div>
  </ModulePolicyLink>
)

const DashboardChart = ({ title, icon: Icon, children, delay }: any) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.98 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ delay, duration: 0.5 }}
    className="relative flex h-[300px] flex-col overflow-hidden rounded-lg border border-white/5 bg-black/20 p-6 shadow-xl backdrop-blur-xl transition-all hover:border-white/10"
  >
    <div className="relative z-10 mb-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="rounded-lg border border-blue-500/20 bg-blue-600/10 p-2 text-blue-400"><Icon size={16} aria-hidden="true" /></div>
        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-white">{title}</h3>
      </div>
    </div>
    <div className="relative z-10 min-h-0 flex-1">{children}</div>
  </motion.div>
)

const EmptyChartState = ({ text }: { text: string }) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-600">
    <ZapOff size={28} aria-hidden="true" />
    <span className="text-[10px] font-black uppercase tracking-widest">{text}</span>
  </div>
)

const SiteIdentity = ({ site, delay }: { site: { id: number; name: string }; delay: number }) => (
  <motion.div
    initial={{ opacity: 0, x: 20 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay }}
    className="relative flex items-center justify-between overflow-hidden rounded-lg border border-white/5 bg-white/[0.03] px-5 py-4 shadow-md transition-all hover:border-blue-500/20"
  >
    <div className="flex flex-col">
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">{site.name}</span>
      <span className="mt-1 text-[9px] font-bold uppercase tracking-tight text-slate-500">Persisted site record</span>
    </div>
    <MapPin size={16} className="text-slate-500" aria-hidden="true" />
  </motion.div>
)

const StatePanel = ({ title, detail }: { title: string; detail: string }) => (
  <div className="flex h-full min-h-[300px] w-full items-center justify-center bg-[var(--bg-primary)] p-8">
    <div className="max-w-xl rounded-lg border border-white/10 bg-black/20 p-8 text-center">
      <h1 className="text-2xl font-black uppercase tracking-tight text-white">{title}</h1>
      <p className="mt-3 text-sm text-slate-400">{detail}</p>
    </div>
  </div>
)

const releasedSurfaces = [
  { moduleId: 'assets', label: 'Assets', path: '/asset', detail: 'Persisted device inventory' },
  { moduleId: 'monitoring', label: 'Monitoring', path: '/monitoring', detail: 'Monitoring definitions and coverage' },
  { moduleId: 'services', label: 'Services', path: '/services', detail: 'Persisted logical services' },
  { moduleId: 'network', label: 'Network', path: '/network', detail: 'Persisted port connections' },
  { moduleId: 'racks', label: 'Racks', path: '/racks', detail: 'Sites, rooms, and racks' },
  { moduleId: 'logs', label: 'Audit Logs', path: '/logs', detail: 'Recent recorded activity' },
  { moduleId: 'settings', label: 'Settings / Access', path: '/settings', detail: 'Configuration and access' },
]

export default function Dashboard({ onNavigate: _onNavigate }: { onNavigate?: (tab: string) => void }) {
  const navigate = useNavigate()
  const [globalSearch, setGlobalSearch] = useState('')
  const [navigationNotice, setNavigationNotice] = useState('')
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'unavailable'>('idle')
  const modulePolicy = useModulePolicy()

  const { data: metrics, isLoading, isError } = useQuery({
    queryKey: ['dashboard-metrics'],
    queryFn: async () => (await apiFetch('/api/v1/dashboard/metrics')).json(),
    refetchInterval: 10000,
  })

  const { data: userProfile } = useQuery({
    queryKey: ['dashboard-user-profile'],
    queryFn: async () => (await apiFetch('/api/v1/settings/user/profile')).json(),
  })

  const assetDistributionData = useMemo(() => (
    Object.entries(metrics?.asset_overview?.breakdown || {}).map(([name, value]: [string, any]) => ({
      name,
      value: Object.values(value).reduce((sum: number, count: any) => sum + Number(count), 0),
    }))
  ), [metrics])

  const serviceStatusData = useMemo(() => (
    Object.entries(metrics?.service_overview?.breakdown || {}).flatMap(([serviceType, statuses]: [string, any]) => (
      Object.entries(statuses).map(([name, count]) => ({ name: `${serviceType}: ${name}`, count }))
    ))
  ), [metrics])

  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }, [])

  if (isLoading) return <StatePanel title="Loading Home data" detail="Reading persisted System Management records and release policy." />
  if (isError || !metrics) return <StatePanel title="Home data unavailable" detail="The Home projection could not be read. No operational status is inferred from missing data." />

  const handleGlobalSearch = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = globalSearch.trim()
    if (trimmed.length < 2) {
      setSearchState('unavailable')
      setNavigationNotice('Enter at least two characters to search released records.')
      return
    }
    setSearchState('loading')
    setNavigationNotice('')
    try {
      const response = await apiFetch(`/api/v1/dashboard/search?q=${encodeURIComponent(trimmed)}`)
      if (!response.ok) throw new Error('Home search unavailable')
      const payload = await response.json() as { results?: DashboardSearchResult[] }
      const result = payload.results?.[0]
      if (!result) {
        setSearchState('unavailable')
        setNavigationNotice('No released or authorized record matched that search.')
        return
      }
      const action = resolveModuleActionState(result.module_id, modulePolicy)
      if (action.disabled) {
        setSearchState('unavailable')
        setNavigationNotice(action.reason)
        return
      }
      setSearchState('idle')
      setNavigationNotice(result.module_stage === 'preview' ? `Opening ${result.module_label || result.type} preview.` : `Opening ${result.title}.`)
      navigate(buildDashboardSearchPath(result))
    } catch {
      setSearchState('unavailable')
      setNavigationNotice('Home search is unavailable. No destination was inferred.')
    }
  }

  return (
    <div className="flex h-full w-full flex-col space-y-8 overflow-hidden pr-2">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-6">
        <div className="flex items-center gap-6">
          <div className="relative hidden sm:block">
            <div className="absolute inset-0 rounded-full bg-blue-600/30 blur-2xl" />
            <div className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 to-black shadow-2xl">
              <Fingerprint size={32} className="text-blue-500" aria-hidden="true" />
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-500" />
            </div>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-blue-400">Operator session</span>
              <span className="text-[8px] font-black uppercase tracking-[0.3em] text-slate-600">System Management V1</span>
            </div>
            <h1 className="mt-1 text-4xl font-black leading-tight tracking-tighter text-white sm:text-5xl">
              {greeting}, <span className="text-blue-500">{userProfile?.full_name?.split(' ')[0] || userProfile?.username || 'Operator'}</span>
            </h1>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-tight text-slate-500">Persisted inventory, configuration, and recorded activity</p>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-8">
          <TruthValue label="Observed stability" truth={metrics.observed_health?.stability} />
          <div className="hidden h-16 w-px bg-white/5 sm:block" />
          <TruthValue label="Incident signal" truth={metrics.incident_summary} />
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="glass-panel relative overflow-hidden rounded-lg border-white/5 bg-black/40 p-8 shadow-2xl xl:col-span-8">
          <div className="absolute right-0 top-0 p-8 opacity-10"><Activity size={110} className="text-blue-500" aria-hidden="true" /></div>
          <div className="relative z-10 flex flex-wrap items-start justify-between gap-5">
            <div>
              <h2 className="text-[12px] font-black uppercase tracking-[0.3em] text-white">Observed health history (24h)</h2>
              <p className="mt-1 text-[10px] font-bold uppercase text-slate-500">Unavailable until an authoritative observation series exists</p>
            </div>
            <span className="rounded border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-amber-300">Unavailable</span>
          </div>
          <div className="relative z-10 mt-8 flex min-h-[148px] flex-col justify-center rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-6">
            <p className="text-sm font-bold text-slate-300">No chart is rendered from monitoring definitions.</p>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-slate-500">{dashboardTruthReason(metrics.observed_health?.history)}</p>
            <p className="mt-3 text-[9px] font-black uppercase tracking-widest text-slate-600">Request as of {metrics.observed_health?.history?.as_of || metrics.request_as_of}</p>
          </div>
        </div>

        <div className="flex flex-col gap-4 xl:col-span-4">
          <div className="glass-panel flex-1 rounded-lg border-white/5 bg-black/40 p-8 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="rounded-lg border border-slate-500/20 bg-slate-500/10 p-2 text-slate-400"><AlertCircle size={16} aria-hidden="true" /></div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-500">Operational observation boundary</p>
                <h2 className="mt-2 text-2xl font-black uppercase tracking-tight text-slate-200">Unknown</h2>
              </div>
            </div>
            <p className="mt-5 text-xs leading-relaxed text-slate-500">Home knows monitoring definitions and persisted status fields. It does not know live availability, latency, or incidents from those records.</p>
            <ModulePolicyLink moduleId="monitoring" to="/monitoring" className="mt-5 inline-flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-blue-400" aria-label="Open monitoring definitions">
              Review monitoring definitions <ChevronRight size={12} aria-hidden="true" />
            </ModulePolicyLink>
          </div>
          <form onSubmit={handleGlobalSearch} className="relative shadow-xl" aria-label="Search released Home records">
            <Search size={18} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
            <input
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Search released records..."
              aria-label="Search released Home records"
              className="w-full rounded-lg border border-white/10 bg-black/60 py-4 pl-14 pr-12 text-[12px] font-black uppercase tracking-wider text-white outline-none transition-all placeholder:text-slate-600 focus:border-blue-500/50"
            />
            {searchState === 'loading' ? <span className="absolute right-5 top-1/2 -translate-y-1/2 text-[9px] font-black uppercase tracking-widest text-blue-400">Searching</span> : null}
          </form>
          {navigationNotice ? <p role="status" className="text-[9px] font-bold uppercase tracking-widest text-amber-400">{navigationNotice}</p> : null}
        </div>
      </div>

      <div className="flex-1 space-y-8 overflow-y-auto pb-10 pr-2">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Infrastructure assets" total={metrics.asset_overview.total} metrics={metrics.asset_overview.breakdown} truth={metrics.asset_overview.truth} icon={Server} color="from-blue-600 to-blue-800" moduleId="assets" path="/asset" delay={0.1} />
          <StatCard title="Logical services" total={metrics.service_overview.total} metrics={metrics.service_overview.breakdown} truth={metrics.service_overview.truth} icon={Layers} color="from-indigo-600 to-indigo-800" moduleId="services" path="/services" delay={0.2} />
          <StatCard title="Network connections" total={metrics.network_overview.total} metrics={metrics.network_overview.breakdown} truth={metrics.network_overview.truth} icon={Network} color="from-emerald-600 to-emerald-800" moduleId="network" path="/network" delay={0.3} />
          <StatCard title="Monitoring definitions" total={metrics.monitoring_overview.total} metrics={metrics.monitoring_overview.breakdown} truth={metrics.monitoring_overview.truth} icon={Activity} color="from-rose-600 to-rose-800" moduleId="monitoring" path="/monitoring" delay={0.4} />
        </div>

        <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
          <DashboardChart title="Asset composition" icon={PieIcon} delay={0.5}>
            {metrics.asset_overview.truth.available && assetDistributionData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={assetDistributionData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
                    {assetDistributionData.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend layout="vertical" verticalAlign="middle" align="right" formatter={(value) => <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{value}</span>} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            ) : <EmptyChartState text={metrics.asset_overview.truth.available ? 'No persisted assets' : 'Assets unavailable'} />}
          </DashboardChart>

          <DashboardChart title="Service registry status" icon={BarChart3} delay={0.6}>
            {metrics.service_overview.truth.available && serviceStatusData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serviceStatusData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#475569', fontSize: 9, fontWeight: 900 }} />
                  <YAxis hide />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {serviceStatusData.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChartState text={metrics.service_overview.truth.available ? 'No persisted services' : 'Services unavailable'} />}
          </DashboardChart>

          <div className="glass-panel flex flex-col rounded-lg border-white/5 bg-black/20 p-6 shadow-xl">
            <div className="mb-6 flex items-center gap-3">
              <div className="rounded-lg border border-amber-500/20 bg-amber-600/10 p-2 text-amber-400"><Globe size={16} aria-hidden="true" /></div>
              <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-white">Persisted sites</h2>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto pr-2">
              {metrics.rack_overview.truth.total_sites.available && metrics.rack_overview.sites?.map((site: { id: number; name: string }, index: number) => <SiteIdentity key={site.id} site={site} delay={index * 0.1} />)}
              {!metrics.rack_overview.truth.total_sites.available ? <EmptyChartState text="Rack inventory unavailable" /> : null}
              {metrics.rack_overview.truth.total_sites.available && !metrics.rack_overview.sites?.length ? <EmptyChartState text="No persisted site records" /> : null}
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-white/5 pt-4 text-[9px] font-black uppercase tracking-widest text-slate-500">
              <span>{metrics.rack_overview.truth.total_racks.available ? `${metrics.rack_overview.total_racks ?? 0} racks` : 'Rack count unavailable'}</span>
              <ModulePolicyLink moduleId="racks" to="/racks" className="text-blue-400" aria-label="Open racks">Open Racks</ModulePolicyLink>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
          <div className="glass-panel flex h-[400px] flex-col rounded-lg border-white/5 bg-black/20 p-8 shadow-xl xl:col-span-4">
            <div className="mb-8 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="rounded-lg border border-blue-500/20 bg-blue-600/10 p-3 text-blue-400"><History size={18} aria-hidden="true" /></div>
                <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-white">Recent audit activity</h2>
              </div>
              <ModulePolicyLink moduleId="logs" to="/logs" className="rounded-lg p-2 text-slate-500 transition-all hover:bg-white/5 hover:text-white" aria-label="Open audit logs"><ExternalLink size={16} aria-hidden="true" /></ModulePolicyLink>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto pr-2">
              {metrics.recent.truth.available && metrics.recent.activity?.map((log: any) => (
                <div key={log.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="truncate text-[9px] font-black uppercase tracking-widest text-blue-400">{log.user || 'Recorded event'}</span>
                    <span className="text-[9px] font-bold uppercase tabular-nums text-slate-600">{log.timestamp ? formatDistanceToNow(parseAppDate(log.timestamp)!, { addSuffix: true }) : 'Time unavailable'}</span>
                  </div>
                  <p className="text-[11px] font-bold uppercase leading-tight tracking-tight text-slate-300">{log.description || `${log.action || 'Activity'} ${log.target || ''}`}</p>
                </div>
              ))}
              {!metrics.recent.truth.available ? <EmptyChartState text="Audit activity unavailable" /> : null}
              {metrics.recent.truth.available && !metrics.recent.activity?.length ? <EmptyChartState text="No audit activity recorded" /> : null}
            </div>
          </div>

          <div className="glass-panel rounded-lg border-white/5 bg-black/20 p-8 shadow-xl xl:col-span-8">
            <div className="mb-8 flex items-center gap-4">
              <div className="rounded-lg border border-indigo-500/20 bg-indigo-600/10 p-3 text-indigo-400"><Server size={18} aria-hidden="true" /></div>
              <div>
                <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-white">Released entry points</h2>
                <p className="mt-1 text-[10px] font-bold uppercase text-slate-500">Destinations are enabled by effective server policy</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {releasedSurfaces.map((surface) => (
                <ModulePolicyLink key={surface.moduleId} moduleId={surface.moduleId} to={surface.path} className="group flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] p-4 transition-all hover:border-blue-500/20 hover:bg-white/[0.05]" aria-label={`Open ${surface.label}`}>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-black uppercase tracking-tight text-slate-200 group-hover:text-blue-400">{surface.label}</p>
                    <p className="mt-1 truncate text-[9px] font-bold uppercase tracking-widest text-slate-600">{surface.detail}</p>
                  </div>
                  <ChevronRight size={14} className="shrink-0 text-slate-700 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </ModulePolicyLink>
              ))}
            </div>
            <div className="mt-8 flex items-center gap-3 border-t border-white/5 pt-5 text-[9px] font-bold uppercase tracking-widest text-slate-600">
              <Info size={13} aria-hidden="true" />
              <span>Preview and unreleased modules are not Home entry points.</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}
