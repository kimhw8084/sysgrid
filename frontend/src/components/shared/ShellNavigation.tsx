import React, { ReactNode, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, AlertTriangle, ChevronDown, FileText, Globe, Layers, LayoutDashboard, Network, Package, Server, Share2, type LucideIcon } from 'lucide-react'
import { MODULE_CATALOG } from '../../policy/moduleCatalog'
import { ModulePolicyLink, useModuleActionPolicy } from '../../policy/ModulePolicy'

export type ShellNavigationItem = {
  moduleId: string
  label: string
  path: string
  aliases?: string[]
  icon: LucideIcon
}

export type ShellNavigationGroup = {
  label: string
  items: ShellNavigationItem[]
  defaultExpanded?: boolean
}

const MODULE_ICONS: Record<string, LucideIcon> = {
  home: LayoutDashboard,
  monitoring: Activity,
  assets: Server,
  racks: Package,
  services: Layers,
  external: Share2,
  network: Network,
  far: AlertTriangle,
  vendors: Globe,
  logs: FileText,
  settings: FileText,
}

const RETIRED_SYSGRID_MODULE_IDS = new Set(['projects', 'research', 'knowledge', 'architecture'])

export const SHELL_NAV_GROUPS: ShellNavigationGroup[] = Array.from(
  MODULE_CATALOG.modules.reduce((groups, module) => {
    if (RETIRED_SYSGRID_MODULE_IDS.has(module.id)) return groups
    const group = groups.get(module.navigation_group) || []
    group.push({
      moduleId: module.id,
      label: module.label,
      path: module.canonical_route,
      aliases: module.aliases,
      icon: MODULE_ICONS[module.id] || FileText,
    })
    groups.set(module.navigation_group, group)
    return groups
  }, new Map<string, ShellNavigationItem[]>()),
).filter(([, items]) => items.length > 0).map(([label, items]) => ({ label, items }))

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
  moduleId,
  label,
  path,
  active,
  isOpen,
  disabled,
  unavailableReason,
}: {
  icon: LucideIcon
  moduleId?: string
  label: string
  path: string
  active: boolean
  isOpen: boolean
  disabled?: boolean
  unavailableReason?: string | null
}) {
  const effectiveModuleId = moduleId || 'home'
  const action = useModuleActionPolicy(effectiveModuleId)
  const isDisabled = disabled ?? action.disabled
  const reason = unavailableReason || action.reason
  const displayLabel = isDisabled && (unavailableReason === 'SYSTEM_ROOT_REQUIRED' || action.blockedReason === 'SYSTEM_ROOT_REQUIRED')
    ? `${label} (Preview)`
    : isDisabled ? `${label} (Unavailable)` : label
  const itemClassName = [
    'group relative flex min-h-8 w-full items-center rounded-lg px-2.5 py-1.5',
    'text-sm transition-colors duration-150',
    isOpen ? 'justify-start gap-2.5' : 'justify-center',
    isDisabled
      ? 'cursor-not-allowed text-[var(--text-disabled)] opacity-60'
      : active
        ? 'bg-[var(--nav-active-bg)] text-[var(--nav-active-text)]'
        : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]',
  ].join(' ')

  const content = (
    <span className={itemClassName}>
      <Icon size={18} aria-hidden="true" className="shrink-0" />
      <span className={[isOpen ? 'min-w-0 truncate' : 'sr-only', isOpen ? (active ? 'font-bold' : 'font-semibold') : ''].filter(Boolean).join(' ')}>{displayLabel}</span>
      {active && isOpen ? <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" /> : null}
      {active && !isOpen ? <span className="absolute right-1.5 h-1.5 w-1.5 rounded-full bg-[var(--accent-primary)]" aria-hidden="true" /> : null}
    </span>
  )

  if (!moduleId) {
    return (
      <Link
        to={path}
        className="block rounded-md focus-visible:outline-none"
        aria-current={active ? 'page' : undefined}
        aria-label={isOpen ? undefined : displayLabel}
        title={!isOpen ? label : undefined}
      >
        {content}
      </Link>
    )
  }

  return (
    <ModulePolicyLink
      moduleId={effectiveModuleId}
      to={path}
      disabled={isDisabled}
      disabledReason={reason}
      className="block rounded-md focus-visible:outline-none"
      aria-current={active ? 'page' : undefined}
      aria-label={isOpen ? undefined : displayLabel}
      title={!isOpen ? label : undefined}
    >
      {content}
    </ModulePolicyLink>
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
      className="mb-2"
      open={isExpanded}
      data-sg-nav-group={label.toLowerCase()}
    >
      <summary
        className="flex min-h-8 cursor-pointer list-none items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none"
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
