import React, { ReactNode, useState } from 'react'
import { Activity, AlertTriangle, BookOpen, Briefcase, ChevronDown, FileText, Globe, Layers, LayoutDashboard, Network, Package, Search, Server, Share2, Workflow, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

export type ShellNavigationItem = {
  label: string
  path: string
  permission?: string
  aliases?: string[]
  icon: LucideIcon
}

export type ShellNavigationGroup = {
  label: string
  items: ShellNavigationItem[]
  defaultExpanded?: boolean
}

export const SHELL_NAV_GROUPS: ShellNavigationGroup[] = [
  {
    label: 'Operations',
    items: [
      { label: 'Home', path: '/', icon: LayoutDashboard },
      { label: 'Projects', path: '/projects', permission: 'projects', icon: Briefcase },
      { label: 'Monitoring', path: '/monitoring', permission: 'monitoring', icon: Activity },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { label: 'Assets', path: '/asset', permission: 'assets', aliases: ['/asset-real'], icon: Server },
      { label: 'Racks', path: '/racks', permission: 'racks', icon: Package },
      { label: 'Services', path: '/services', permission: 'services', icon: Layers },
      { label: 'External', path: '/external', permission: 'external', icon: Share2 },
    ],
  },
  {
    label: 'Connectivity',
    items: [
      { label: 'Network', path: '/network', permission: 'network', aliases: ['/network-real'], icon: Network },
      { label: 'Architecture', path: '/architecture', permission: 'architecture', icon: Workflow },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { label: 'FAR', path: '/far', permission: 'far', icon: AlertTriangle },
      { label: 'Research', path: '/research', permission: 'research', icon: Search },
    ],
  },
  {
    label: 'Resources',
    items: [
      { label: 'Vendors', path: '/vendors', permission: 'vendors', aliases: ['/vendors-real'], icon: Globe },
      { label: 'Knowledge', path: '/knowledge', permission: 'knowledge', icon: BookOpen },
      { label: 'Audit logs', path: '/logs', permission: 'logs', icon: FileText },
    ],
  },
]

const normalizePath = (path: string) => {
  const normalized = path.replace(/\/+$/, '')
  return normalized || '/'
}

/** Match a primary route and its legitimate deep links without matching sibling routes. */
export const isShellRouteActive = (pathname: string, path: string, aliases: string[] = []) => {
  const current = normalizePath(pathname)
  return [path, ...aliases].some((candidate) => {
    const normalizedCandidate = normalizePath(candidate)
    return normalizedCandidate === '/'
      ? current === '/'
      : current === normalizedCandidate || current.startsWith(`${normalizedCandidate}/`)
  })
}

const groupId = (label: string) => `shell-nav-group-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

export function ShellNavItem({
  icon: Icon,
  label,
  path,
  active,
  isOpen,
  disabled = false,
}: {
  icon: LucideIcon
  label: string
  path: string
  active: boolean
  isOpen: boolean
  disabled?: boolean
}) {
  const itemClassName = [
    'group relative flex min-h-10 w-full items-center rounded-md px-3 py-2.5',
    'text-sm transition-colors duration-150',
    isOpen ? 'justify-start gap-3' : 'justify-center',
    disabled
      ? 'cursor-not-allowed text-[var(--text-disabled)] opacity-60'
      : active
        ? 'bg-[var(--nav-active-bg)] text-[var(--nav-active-text)]'
        : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]',
  ].join(' ')

  const content = (
    <span className={itemClassName}>
      <Icon size={18} aria-hidden="true" className="shrink-0" />
      <span className={isOpen ? 'min-w-0 truncate' : 'sr-only'}>{label}</span>
      {active && isOpen ? <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" /> : null}
      {active && !isOpen ? <span className="absolute right-1.5 h-1.5 w-1.5 rounded-full bg-[var(--accent-primary)]" aria-hidden="true" /> : null}
    </span>
  )

  if (disabled) {
    return (
      <div
        className={itemClassName}
        role="link"
        aria-disabled="true"
        aria-label={`${label} unavailable`}
        title={`${label} is unavailable for the current account`}
      >
        <Icon size={18} aria-hidden="true" className="shrink-0" />
        <span className={isOpen ? 'min-w-0 truncate' : 'sr-only'}>{label}</span>
      </div>
    )
  }

  return (
    <Link
      to={path}
      className="block rounded-md focus-visible:outline-none"
      aria-current={active ? 'page' : undefined}
      aria-label={isOpen ? undefined : label}
      title={!isOpen ? label : undefined}
    >
      {content}
    </Link>
  )
}

export function ShellNavGroup({
  label,
  children,
  isSidebarOpen,
  defaultExpanded = true,
}: {
  label: string
  children: ReactNode
  isSidebarOpen: boolean
  defaultExpanded?: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  if (!isSidebarOpen) {
    return <div className="border-b border-[var(--border-subtle)] py-2 last:border-0">{children}</div>
  }

  const id = groupId(label)
  return (
    <details
      className="mb-3"
      open={isExpanded}
      data-sg-nav-group={label.toLowerCase()}
    >
      <summary
        className="flex min-h-9 cursor-pointer list-none items-center justify-between rounded-md px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none"
        aria-controls={id}
        aria-expanded={isExpanded}
        onClick={(event) => {
          event.preventDefault()
          setIsExpanded((current) => !current)
        }}
      >
        <span>{label}</span>
        <ChevronDown size={14} aria-hidden="true" className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </summary>
      <div id={id} className="mt-1 space-y-1 border-l border-[var(--border-subtle)] pl-2">
        {children}
      </div>
    </details>
  )
}
