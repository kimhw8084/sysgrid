import React from 'react'
import { WorkspaceStickyIdentityBar } from './OperationalWorkspacePrimitives'

export function WorkspaceDetailSection({ title, description, children }: {
  title: string
  description?: React.ReactNode
  children?: React.ReactNode
}) {
  const headingId = React.useId()
  return (
    <section aria-labelledby={headingId} className="min-w-0 rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] p-4 sm:p-5">
      <h3 id={headingId} className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">{title}</h3>
      {description && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-secondary)]">{description}</p>}
      {children && <div className="mt-4 min-w-0">{children}</div>}
    </section>
  )
}

export function WorkspaceDetailFields({ fields, columns = 3 }: {
  fields: { label: string; value: React.ReactNode }[]
  columns?: 1 | 2 | 3
}) {
  const layout = columns === 1 ? 'grid-cols-1' : columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3'
  return (
    <dl className={`grid min-w-0 gap-x-6 gap-y-4 ${layout}`}>
      {fields.map(({ label, value }) => (
        <div key={label} className="min-w-0 border-t border-[var(--border-subtle)] pt-3">
          <dt className="text-xs font-medium text-[var(--text-secondary)]">{label}</dt>
          <dd className="mt-1 break-words text-sm font-medium leading-relaxed text-[var(--text-primary)]">{value ?? 'Not recorded'}</dd>
        </div>
      ))}
    </dl>
  )
}

export function WorkspaceDossierShell({
  header,
  actions,
  body,
}: {
  header?: React.ReactNode
  actions?: React.ReactNode
  body: React.ReactNode
}) {
  return (
    <div className="flex flex-col">
      {(header || actions) && (
        <WorkspaceStickyIdentityBar className="!mb-6">
          <div className="flex items-start justify-between gap-4">{header}</div>
          {actions && <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div>}
        </WorkspaceStickyIdentityBar>
      )}
      <div className={`flex-1 ${(!header && !actions) ? 'pt-6' : ''}`}>{body}</div>
    </div>
  )
}

export function WorkspaceHistoryShell({
  header,
  sidebar,
  content,
}: {
  header?: React.ReactNode
  sidebar: React.ReactNode
  content: React.ReactNode
}) {
  return (
    <div data-workspace-history className="flex min-w-0 flex-col gap-5">
      {header && <div className="flex flex-wrap items-center justify-between gap-3">{header}</div>}
      <div className={`grid min-w-0 gap-5 lg:grid-cols-[16rem_minmax(0,1fr)] ${!header ? 'pt-6' : ''}`}>
        <div data-workspace-history-versions className="flex max-h-72 min-h-0 min-w-0 flex-col overflow-y-auto lg:max-h-[60vh]">{sidebar}</div>
        <div data-workspace-history-content className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-black/40 shadow-inner">
          {content}
        </div>
      </div>
    </div>
  )
}

export function WorkspaceCompareShell({
  header,
  body,
}: {
  header?: React.ReactNode
  body: React.ReactNode
}) {
  return (
    <div className="flex flex-col h-full">
      {header && <div className="mb-4 flex items-center justify-between">{header}</div>}
      <div className={`flex-1 ${!header ? 'pt-6' : ''}`}>
        {body}
      </div>
    </div>
  )
}
