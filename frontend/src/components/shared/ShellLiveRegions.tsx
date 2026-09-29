import React, { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clock, Globe } from 'lucide-react'
import { apiFetch, subscribeToLatency } from '../../api/apiClient'
import { ShellHeaderTools } from './ShellHeaderTools'

type ToolsProps = Pick<React.ComponentProps<typeof ShellHeaderTools>, 'pathname' | 'errors' | 'onOpenErrorConsole' | 'compact' | 'onOpenPatchNotes'>

/** Live telemetry owns its updates; routed work never subscribes to this state. */
export function LiveShellHeaderTools(props: ToolsProps) {
  const [latency, setLatency] = useState(0)
  useEffect(() => subscribeToLatency(setLatency), [])
  const { data, isLoading, isError } = useQuery({
    queryKey: ['health'],
    queryFn: async () => (await apiFetch('/api/v1/health')).json(),
    refetchInterval: 10000,
    retry: 2,
    staleTime: 5000,
  })
  return <ShellHeaderTools {...props} latency={latency} isOnline={Boolean(data) && !isError} isHealthLoading={isLoading} isHealthError={isError} />
}

/** A one-second clock must not update MainLayout or its routed descendants. */
export function ShellFooter({ version }: { version: string }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const format = (zone: string) => new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(now)
  return <footer className="flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-2 text-[10px] text-[var(--text-secondary)] sm:px-8">
    <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-1">
      <div className="flex items-center gap-2">
        <Globe size={10} aria-hidden="true" className="text-[var(--text-muted)]" />
        <span><span className="hidden sm:inline">YOUR TIME ({localZone}): </span><span className="sm:hidden" title={localZone}>Local: </span><span className="text-[var(--accent-primary)] tabular-nums">{format(localZone)}</span></span>
      </div>
      <div className="flex items-center gap-2 border-l border-[var(--border-subtle)] pl-3 sm:pl-6">
        <Clock size={10} aria-hidden="true" className="text-[var(--text-muted)]" />
        <span><span className="hidden sm:inline">SOUTH KOREA </span>(KST): <span className="text-[var(--text-primary)] tabular-nums">{format('Asia/Seoul')}</span></span>
      </div>
    </div>
    <span className="text-[var(--accent-primary)]">Version {version}</span>
  </footer>
}
