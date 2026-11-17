export type DashboardStatusDistributionProps = {
  category: string
  values: Record<string, number>
  total: number
}

function statusColor(status: string): string {
  if (status === 'Active' || status === 'Operational' || status === 'Existing') return 'bg-emerald-500'
  if (status === 'Critical' || status === 'Down') return 'bg-rose-500'
  if (status === 'Maintenance' || status === 'Warning') return 'bg-amber-500'
  return 'bg-blue-500'
}

export function DashboardStatusDistribution({ category, values, total }: DashboardStatusDistributionProps) {
  const entries = Object.entries(values)
  return (
    <div
      role="group"
      aria-label={`${category} status distribution`}
      data-dashboard-status-distribution={category}
    >
      <div aria-hidden="true" className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-[var(--surface-hover)] p-0.5">
        {entries.map(([status, count]) => (
          <div
            key={status}
            className={`h-full rounded-full transition-all duration-500 ${statusColor(status)}`}
            style={{ width: `${total ? (count / total) * 100 : 0}%` }}
          />
        ))}
      </div>
      <ul className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-xs leading-4 text-[var(--text-secondary)]">
        {entries.length > 0
          ? entries.map(([status, count]) => (
            <li key={status} className="inline-flex max-w-full min-w-0 items-baseline gap-1">
              <span aria-hidden="true" className={`mt-1 h-2 w-2 shrink-0 rounded-full ${statusColor(status)}`} />
              <span className="min-w-0 break-words">{status}</span>
              <span className="shrink-0 font-medium tabular-nums text-[var(--text-primary)]">{count}</span>
            </li>
          ))
          : <li>Status breakdown unavailable</li>}
      </ul>
    </div>
  )
}
