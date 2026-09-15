import React, { ReactNode } from 'react'
import { Maximize2, Minimize2, Search } from 'lucide-react'
import { isGoldenActivityColumnsTitle } from './OperationalGoldenToolbarContract'

const join = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

export const GOLDEN_PAGE_HEADER_CLASS = 'flex flex-wrap items-start justify-between gap-6'
export const GOLDEN_PAGE_TOOLBAR_CLASS = 'flex items-center gap-3 overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-base)] px-4 py-3 backdrop-blur-xl lg:flex-wrap lg:justify-between lg:overflow-visible'
export const GOLDEN_TOOLBAR_LEFT_CLASS = 'flex min-w-max flex-nowrap items-center gap-3 lg:min-w-0 lg:flex-1 lg:flex-wrap'
export const GOLDEN_TOOLBAR_RIGHT_CLASS = 'flex min-w-max flex-nowrap items-center justify-end gap-3 lg:flex-wrap'
const TOOLBAR_CONTROL_HEIGHT = 'h-9'

export const ShellHeader = ({
  left,
  right
}: {
  left: ReactNode
  right?: ReactNode
}) => (
  <header className="shrink-0 border-b border-[var(--border-default)] bg-[var(--bg-header)] px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8" data-sg-shell-header="true">
    <div className="flex min-h-[40px] flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">{left}</div>
      {right && <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2 sm:gap-3">{right}</div>}
    </div>
  </header>
)

export const PageHeader = ({
  eyebrow,
  title,
  subtitle,
  meta,
  actions,
  className = ''
}: {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  className?: string
}) => (
  <section className={join(GOLDEN_PAGE_HEADER_CLASS, className)} data-golden-page-header="true">
    <div className="min-w-[200px] flex-1 space-y-1">
      {eyebrow && <div className="text-[8px] font-black uppercase tracking-[0.18em] text-[var(--accent-primary)]">{eyebrow}</div>}
      <div className="space-y-0.5">
        <h1 className="text-xl font-black tracking-tighter text-[var(--text-primary)]">{title}</h1>
        {subtitle && (
          <p className="max-w-3xl text-[10px] font-bold tracking-[0.04em] text-[var(--text-secondary)]">
            {subtitle}
          </p>
        )}
      </div>
      {meta && <div className="flex flex-wrap items-center gap-3">{meta}</div>}
    </div>
    {actions && <div className="flex shrink-0 items-start gap-3">{actions}</div>}
  </section>
)

export const PageToolbar = ({
  left,
  right,
  className = ''
}: {
  left?: ReactNode
  right?: ReactNode
  className?: string
}) => (
  <section
    className={join(
      GOLDEN_PAGE_TOOLBAR_CLASS,
      className
    )}
    data-golden-page-toolbar="true"
  >
    {left ? <div className={GOLDEN_TOOLBAR_LEFT_CLASS} data-golden-toolbar-left="true">{left}</div> : <div />}
    {right && <div className={GOLDEN_TOOLBAR_RIGHT_CLASS} data-golden-toolbar-right="true">{right}</div>}
  </section>
)

export const ToolbarGroup = ({
  children,
  className = ''
}: {
  children: ReactNode
  className?: string
}) => (
  <div className={join('flex flex-wrap items-center gap-2', className)}>
    {children}
  </div>
)

export const ToolbarSearch = ({
  value,
  onChange,
  placeholder,
  className = ''
}: {
  value: string
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  placeholder: string
  className?: string
}) => (
  <div className={join('relative min-w-[240px] flex-1 max-w-md', className)}>
    <Search
      size={14}
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] transition-colors group-focus-within:text-[var(--accent-primary)]"
    />
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={`${TOOLBAR_CONTROL_HEIGHT} w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] pl-10 pr-4 py-0 text-[10px] font-medium tracking-[0.04em] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--action-primary)] focus:bg-[var(--surface-hover)]`}
    />
  </div>
)

export const ToolbarButton = React.forwardRef<HTMLButtonElement, {
  children: ReactNode
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'
  className?: string
  title?: string
  ariaLabel?: string
}>(({
  children,
  onClick,
  active = false,
  disabled = false,
  variant = 'secondary',
  className = '',
  title,
  ariaLabel
}, ref) => {
  const variantClass =
    variant === 'primary'
      ? 'border border-[var(--action-primary)] bg-[var(--action-primary)] text-white shadow-lg shadow-blue-500/20 hover:bg-[var(--action-primary-hover)]'
      : variant === 'danger'
        ? 'bg-[var(--state-danger-surface)] text-[var(--state-danger)] border border-[var(--state-danger-border)] hover:bg-[var(--state-danger-surface-strong)]'
        : variant === 'quiet'
          ? 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
          : active
            ? 'bg-[var(--action-primary-muted)] text-[var(--action-primary)] border border-[var(--action-primary)]'
            : 'bg-[var(--surface-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]'
  const activityColumnsToggle = isGoldenActivityColumnsTitle(title)
  const resolvedChildren = activityColumnsToggle ? (
    <>
      {active ? <Minimize2 size={14} /> : <Maximize2 size={14} />} Activity
    </>
  ) : children

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel || title}
      aria-pressed={active || undefined}
      className={join(
        `${TOOLBAR_CONTROL_HEIGHT} inline-flex items-center justify-center gap-2 rounded-lg px-3 py-0 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap shrink-0 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40`,
        variantClass,
        className
      )}
    >
      {resolvedChildren}
    </button>
  )
})
ToolbarButton.displayName = 'ToolbarButton'

export const ToolbarIconButton = React.forwardRef<HTMLButtonElement, {
  children: ReactNode
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  title?: string
  ariaLabel?: string
  tone?: 'default' | 'danger'
}>(({ 
  children,
  onClick,
  active = false,
  disabled = false,
  title,
  ariaLabel,
  tone = 'default'
}, ref) => (
  <button
    ref={ref}
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={ariaLabel || title}
    aria-pressed={active || undefined}
    className={join(
      `${TOOLBAR_CONTROL_HEIGHT} rounded-lg px-2.5 py-0 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40`,
      tone === 'danger'
        ? 'border border-[var(--state-danger-border)] bg-[var(--state-danger-surface)] text-[var(--state-danger)] hover:bg-[var(--state-danger-surface-strong)]'
        : active
          ? 'border border-[var(--action-primary)] bg-[var(--action-primary-muted)] text-[var(--action-primary)]'
          : 'border border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
    )}
  >
    {children}
  </button>
))
ToolbarIconButton.displayName = 'ToolbarIconButton'

export const ToolbarSegmented = ({
  options,
  value,
  onChange
}: {
  options: Array<{ label: ReactNode; value: string }>
  value: string
  onChange: (value: string) => void
}) => (
  <div className="flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-1" role="group">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        onClick={() => onChange(option.value)}
        className={join(
          `${TOOLBAR_CONTROL_HEIGHT} rounded-lg px-4 py-0 text-[10px] font-bold tracking-widest transition-all`,
          value === option.value
            ? 'bg-[var(--action-primary)] text-white shadow-lg shadow-blue-500/20'
            : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
        )}
        aria-pressed={value === option.value}
      >
        {option.label}
      </button>
    ))}
  </div>
)

export const HeaderScopeSwitch = ({
  label,
  summary,
  options,
  value,
  onChange,
}: {
  label: ReactNode
  summary?: ReactNode
  options: Array<{ label: ReactNode; value: string }>
  value: string
  onChange: (value: string) => void
}) => (
  <div className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-1.5">
    <div className="px-2">
      <p className="text-[8px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">{label}</p>
      {summary ? <p className="pt-0.5 text-[10px] font-semibold text-[var(--text-primary)]">{summary}</p> : null}
    </div>
    <ToolbarSegmented options={options} value={value} onChange={onChange} />
  </div>
)
