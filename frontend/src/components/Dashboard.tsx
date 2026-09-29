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
import { formatAppDate, parseAppDate } from '../utils/dateUtils'
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
  if (!truth) return 'Source information is unavailable.'
  const reasons: Record<string, string> = {
    NO_AUTHORITATIVE_OBSERVATION_SOURCE: 'No observation source is connected.',
    NO_CANONICAL_STABILITY_SOURCE: 'No stability measurements are available.',
    NO_AUTHORITATIVE_INCIDENT_SOURCE: 'No incident source is connected.',
    MODULE_UNAVAILABLE: 'This workspace is unavailable for your current access.',
  }
  if (truth.unavailable_reason) return reasons[truth.unavailable_reason] || truth.unavailable_reason
  return `Source: ${truth.source}`
}

export function buildDashboardSearchPath(result: DashboardSearchResult): string {
  const separator = result.path.includes('?') ? '&' : '?'
  return `${result.path}${separator}id=${encodeURIComponent(String(result.id))}`
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-base)] p-3 shadow-xl">
      <p className="mb-2 text-xs font-medium text-[var(--text-secondary)]">{label}</p>
      {payload.map((entry: any, index: number) => (
        <div key={index} className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <p className="text-sm text-[var(--text-primary)]">
            {entry.name}: <span className="tabular-nums">{entry.value}</span>
          </p>
        </div>
      ))}
    </div>
  )
}

const TruthValue = ({ label, truth }: { label: string; truth?: DashboardTruth }) => (
  <div className="flex min-w-0 flex-col gap-1">
    <p className="text-xs text-[var(--text-secondary)]">{label}</p>
    <div className="flex items-center gap-2">
      <span className="text-sm font-semibold text-[var(--text-primary)]" data-home-truth-state={truth?.available ? 'available' : 'unavailable'}>
        {dashboardTruthLabel(truth)}
      </span>
      <Info size={16} className="shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
    </div>
    <span className="text-xs text-[var(--text-secondary)]">{dashboardTruthReason(truth)}</span>
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
      className="group relative h-full cursor-pointer overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] p-4 transition-colors hover:border-[var(--accent-primary)] sm:p-5"
    >
      <div className={`absolute -right-4 -top-4 h-24 w-24 bg-gradient-to-br ${color} opacity-[0.03] blur-2xl transition-opacity group-hover:opacity-[0.1]`} />
      <div className="relative z-10 flex flex-col items-start justify-between gap-3 sm:flex-row">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${color}`}>
          <Icon size={18} className="text-white" aria-hidden="true" />
        </div>
        <div className="min-w-0 text-left sm:text-right">
          <p className="text-xs font-medium leading-snug text-[var(--text-secondary)]">{title}</p>
          <h2 className={`mt-2 font-semibold tracking-tight text-[var(--text-primary)] tabular-nums ${truth.available ? 'text-2xl' : 'text-sm'}`}>{truth.available ? total ?? 0 : 'Unavailable'}</h2>
        </div>
      </div>
      <div className="relative z-10 mt-5 space-y-3">
        {truth.available && Object.entries(metrics).slice(0, 2).map(([key, value]) => {
          const totalForType = Object.values(value).reduce((sum, count) => sum + count, 0)
          return (
            <div key={key} className="flex flex-col space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-[var(--text-secondary)]">{key}</span>
                <span className="font-medium text-[var(--text-primary)]">{totalForType}</span>
              </div>
              <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-[var(--surface-hover)] p-0.5" aria-label={`${key} persisted counts`}>
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
      <div className="mt-5 flex items-center gap-2 text-[var(--accent-primary)]">
        <span className="text-xs font-medium">Open workspace</span>
        <ArrowUpRight size={14} className="shrink-0" aria-hidden="true" />
      </div>
    </motion.div>
  </ModulePolicyLink>
)

const DashboardChart = ({ title, icon: Icon, children, delay }: any) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.98 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ delay, duration: 0.5 }}
    className="relative flex h-[320px] min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] p-5 [&_.recharts-wrapper]:max-w-none"
  >
    <div className="relative z-10 mb-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--action-primary-muted)] p-2 text-[var(--accent-primary)]"><Icon size={16} aria-hidden="true" /></div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      </div>
    </div>
    <div className="relative z-10 min-h-0 flex-1">{children}</div>
  </motion.div>
)

const EmptyChartState = ({ text }: { text: string }) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-[var(--text-secondary)]">
    <ZapOff size={28} aria-hidden="true" />
    <span className="text-sm">{text}</span>
  </div>
)

const SiteIdentity = ({ site, delay }: { site: { id: number; name: string }; delay: number }) => (
  <motion.div
    initial={{ opacity: 0, x: 20 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay }}
    className="relative flex min-w-0 items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-base)] p-4"
  >
    <div className="flex min-w-0 flex-col">
      <span className="break-words text-sm font-medium text-[var(--text-primary)]">{site.name}</span>
      <span className="mt-1 text-xs text-[var(--text-secondary)]">Persisted site record</span>
    </div>
    <MapPin size={16} className="shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
  </motion.div>
)

const StatePanel = ({ title, detail }: { title: string; detail: string }) => (
  <div className="flex h-full min-h-[300px] w-full items-center justify-center bg-[var(--bg-primary)] p-8">
    <div className="max-w-xl rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">{title}</h1>
      <p className="mt-3 text-sm text-[var(--text-secondary)]">{detail}</p>
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
    <div data-home-workspace className="flex min-h-0 w-full flex-1 flex-col gap-6 overflow-y-auto pb-6 pr-1">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className="relative hidden sm:block">
            <div className="absolute inset-0 rounded-full bg-blue-600/30 blur-2xl" />
            <div className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)]">
              <Fingerprint size={24} className="text-[var(--accent-primary)]" aria-hidden="true" />
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-500" />
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-medium text-[var(--accent-primary)]">Operator session</span>
              <span className="text-xs text-[var(--text-secondary)]">System Management V1</span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold leading-tight tracking-tight text-[var(--text-primary)] sm:text-3xl">
              {greeting}, <span className="text-[var(--accent-primary)]">{userProfile?.full_name?.split(' ')[0] || userProfile?.username || 'Operator'}</span>
            </h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">Persisted inventory, configuration, and recorded activity</p>
          </div>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4 sm:gap-4">
        <StatCard title="Infrastructure assets" total={metrics.asset_overview.total} metrics={metrics.asset_overview.breakdown} truth={metrics.asset_overview.truth} icon={Server} color="from-blue-600 to-blue-800" moduleId="assets" path="/asset" />
        <StatCard title="Logical services" total={metrics.service_overview.total} metrics={metrics.service_overview.breakdown} truth={metrics.service_overview.truth} icon={Layers} color="from-indigo-600 to-indigo-800" moduleId="services" path="/services" />
        <StatCard title="Network connections" total={metrics.network_overview.total} metrics={metrics.network_overview.breakdown} truth={metrics.network_overview.truth} icon={Network} color="from-emerald-600 to-emerald-800" moduleId="network" path="/network" />
        <StatCard title="Monitoring definitions" total={metrics.monitoring_overview.total} metrics={metrics.monitoring_overview.breakdown} truth={metrics.monitoring_overview.truth} icon={Activity} color="from-rose-600 to-rose-800" moduleId="monitoring" path="/monitoring" />
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="relative overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] p-5 xl:col-span-7">
          <div className="absolute right-0 top-0 p-8 opacity-10"><Activity size={110} className="text-blue-500" aria-hidden="true" /></div>
          <div className="relative z-10 flex flex-wrap items-start justify-between gap-5">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Observed health history (24h)</h2>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">Unavailable until an authoritative observation series exists</p>
            </div>
            <span className="rounded-md border border-[var(--state-warning-border)] bg-[var(--state-warning-surface)] px-2 py-1 text-xs font-medium text-[var(--state-warning)]">Unavailable</span>
          </div>
          <div className="relative z-10 mt-4 border-t border-[var(--border-default)] pt-4">
            <p className="text-sm text-[var(--text-secondary)]">No chart is rendered from monitoring definitions.</p>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[var(--text-secondary)]">{dashboardTruthReason(metrics.observed_health?.history)}</p>
            <p className="mt-2 text-xs text-[var(--text-secondary)]">Request as of <time dateTime={metrics.observed_health?.history?.as_of || metrics.request_as_of}>{formatAppDate(metrics.observed_health?.history?.as_of || metrics.request_as_of, { month: 'short', second: undefined, timeZoneName: 'short' })}</time></p>
            <div className="mt-4 grid gap-4 border-t border-[var(--border-default)] pt-4 sm:grid-cols-2">
              <TruthValue label="Observed stability" truth={metrics.observed_health?.stability} />
              <TruthValue label="Incident signal" truth={metrics.incident_summary} />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 xl:col-span-5">
          <div className="flex-1 rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg border border-slate-500/20 bg-slate-500/10 p-2 text-slate-400"><AlertCircle size={16} aria-hidden="true" /></div>
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">Operational observation boundary</p>
                <h2 className="mt-1 text-sm font-medium text-[var(--text-secondary)]">Unknown</h2>
              </div>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">Home knows monitoring definitions and persisted status fields. It does not know live availability, latency, or incidents from those records.</p>
            <ModulePolicyLink moduleId="monitoring" to="/monitoring" className="mt-4 inline-flex min-h-10 items-center gap-2 text-sm font-medium text-[var(--accent-primary)]" aria-label="Open monitoring definitions">
              Review monitoring definitions <ChevronRight size={12} aria-hidden="true" />
            </ModulePolicyLink>
          </div>
          <form onSubmit={handleGlobalSearch} className="relative" aria-label="Search released Home records">
            <Search size={18} className="absolute left-5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" aria-hidden="true" />
            <input
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Search released records..."
              aria-label="Search released Home records"
              className={`w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-base)] py-3 pl-14 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-primary)] ${searchState === 'loading' ? 'pr-24' : 'pr-4'}`}
            />
            {searchState === 'loading' ? <span role="status" className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-[var(--accent-primary)]">Searching</span> : null}
          </form>
          {navigationNotice ? <p role="status" className="text-sm text-[var(--text-secondary)]">{navigationNotice}</p> : null}
        </div>
      </div>

      <div className="shrink-0 space-y-6">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <DashboardChart title="Asset composition" icon={PieIcon} delay={0.5}>
            {metrics.asset_overview.truth.available && assetDistributionData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={assetDistributionData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none" isAnimationActive={false}>
                    {assetDistributionData.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend layout="horizontal" verticalAlign="bottom" formatter={(value) => <span className="text-xs text-[var(--text-secondary)]">{value}</span>} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            ) : <EmptyChartState text={metrics.asset_overview.truth.available ? 'No persisted assets' : 'Assets unavailable'} />}
          </DashboardChart>

          <DashboardChart title="Service registry status" icon={BarChart3} delay={0.6}>
            {metrics.service_overview.truth.available && serviceStatusData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serviceStatusData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                  <YAxis hide />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {serviceStatusData.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChartState text={metrics.service_overview.truth.available ? 'No persisted services' : 'Services unavailable'} />}
          </DashboardChart>

          <div className="flex h-[320px] min-w-0 flex-col rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] p-5">
            <div className="mb-6 flex items-center gap-3">
              <div className="rounded-lg border border-amber-500/20 bg-amber-600/10 p-2 text-amber-400"><Globe size={16} aria-hidden="true" /></div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Persisted sites</h2>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
              {metrics.rack_overview.truth.total_sites.available && metrics.rack_overview.sites?.map((site: { id: number; name: string }, index: number) => <SiteIdentity key={site.id} site={site} delay={index * 0.1} />)}
              {!metrics.rack_overview.truth.total_sites.available ? <EmptyChartState text="Rack inventory unavailable" /> : null}
              {metrics.rack_overview.truth.total_sites.available && !metrics.rack_overview.sites?.length ? <EmptyChartState text="No persisted site records" /> : null}
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-4 text-xs text-[var(--text-secondary)]">
              <span>{metrics.rack_overview.truth.total_racks.available ? `${metrics.rack_overview.total_racks ?? 0} racks` : 'Rack count unavailable'}</span>
              <ModulePolicyLink moduleId="racks" to="/racks" className="inline-flex min-h-10 items-center text-[var(--accent-primary)]" aria-label="Open racks">Open Racks</ModulePolicyLink>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="flex h-[400px] min-w-0 flex-col rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] p-5 xl:col-span-4">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-4">
                <div className="rounded-lg border border-blue-500/20 bg-blue-600/10 p-3 text-blue-400"><History size={18} aria-hidden="true" /></div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Recent audit activity</h2>
              </div>
              <ModulePolicyLink moduleId="logs" to="/logs" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]" aria-label="Open audit logs"><ExternalLink size={16} aria-hidden="true" /></ModulePolicyLink>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
              {metrics.recent.truth.available && metrics.recent.activity?.map((log: any) => (
                <div key={log.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-base)] p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="break-words text-xs font-medium text-[var(--accent-primary)]">{log.user || 'Recorded event'}</span>
                    <span className="text-xs tabular-nums text-[var(--text-secondary)]">{log.timestamp ? formatDistanceToNow(parseAppDate(log.timestamp)!, { addSuffix: true }) : 'Time unavailable'}</span>
                  </div>
                  <p className="break-words text-sm leading-relaxed text-[var(--text-primary)]">{log.description || `${log.action || 'Activity'} ${log.target || ''}`}</p>
                </div>
              ))}
              {!metrics.recent.truth.available ? <EmptyChartState text="Audit activity unavailable" /> : null}
              {metrics.recent.truth.available && !metrics.recent.activity?.length ? <EmptyChartState text="No audit activity recorded" /> : null}
            </div>
          </div>

          <div className="min-w-0 rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] p-5 xl:col-span-8">
            <div className="mb-5 flex items-center gap-4">
              <div className="rounded-lg border border-indigo-500/20 bg-indigo-600/10 p-3 text-indigo-400"><Server size={18} aria-hidden="true" /></div>
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Released entry points</h2>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Destinations are enabled by effective server policy</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {releasedSurfaces.map((surface) => (
                <ModulePolicyLink key={surface.moduleId} moduleId={surface.moduleId} to={surface.path} className="group flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-base)] p-4 transition-colors hover:border-[var(--accent-primary)] hover:bg-[var(--surface-hover)]" aria-label={`Open ${surface.label}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-primary)]">{surface.label}</p>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{surface.detail}</p>
                  </div>
                  <ChevronRight size={16} className="shrink-0 text-[var(--text-secondary)] transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </ModulePolicyLink>
              ))}
            </div>
            <div className="mt-5 flex items-start gap-3 border-t border-[var(--border-subtle)] pt-5 text-xs leading-relaxed text-[var(--text-secondary)]">
              <Info size={16} className="shrink-0" aria-hidden="true" />
              <span>Preview and unreleased modules are not Home entry points.</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}
