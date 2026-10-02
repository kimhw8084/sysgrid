import React, { CSSProperties, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, Check, Info } from 'lucide-react'
import { createPortal } from 'react-dom'
import { OPERATIONAL_WORKSPACE_VISUALS } from './OperationalWorkspace'
import { getWorkspaceAnchorLayer, WORKSPACE_LAYER_Z, useWorkspacePopupDismiss } from './WorkspaceOverlay'
export { WORKSPACE_LAYER_Z } from './WorkspaceOverlay'

export type WorkspaceModalSize = 'compact' | 'standard' | 'wide' | 'workspace' | 'fullscreen'

const join = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}


export type WorkspaceAnchoredPlacement = 'above' | 'below'

export function computeWorkspaceAnchoredPanelStyle({
  triggerRect,
  viewportWidth,
  viewportHeight,
  offset,
  minWidth,
  placement,
}: {
  triggerRect: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width'>
  viewportWidth: number
  viewportHeight: number
  offset: number
  minWidth: number
  placement: WorkspaceAnchoredPlacement | null
}): { placement: WorkspaceAnchoredPlacement; style: CSSProperties } {
  const padding = 12
  const maxWidth = Math.max(0, viewportWidth - padding * 2)
  const desiredWidth = Math.max(triggerRect.width, minWidth)
  const width = Math.min(desiredWidth, maxWidth)
  const left = clamp(triggerRect.left, padding, Math.max(padding, viewportWidth - width - padding))
  const availableBelow = Math.max(0, viewportHeight - triggerRect.bottom - offset - padding)
  const availableAbove = Math.max(0, triggerRect.top - offset - padding)
  // Retain a stable side while usable, but flip when scrolling/resizing removes its space.
  const preferred = placement ?? (availableBelow >= availableAbove ? 'below' : 'above')
  const preferredSpace = preferred === 'below' ? availableBelow : availableAbove
  const alternateSpace = preferred === 'below' ? availableAbove : availableBelow
  const resolvedPlacement = preferredSpace < 120 && alternateSpace > preferredSpace ? (preferred === 'below' ? 'above' : 'below') : preferred
  const availableHeight = resolvedPlacement === 'below' ? availableBelow : availableAbove

  return {
    placement: resolvedPlacement,
    style: {
      position: 'fixed',
      top: resolvedPlacement === 'below' ? clamp(triggerRect.bottom + offset, padding, viewportHeight - padding) : undefined,
      bottom: resolvedPlacement === 'above' ? clamp(viewportHeight - triggerRect.top + offset, padding, viewportHeight - padding) : undefined,
      left,
      width,
      maxHeight: Math.min(availableHeight, Math.max(0, viewportHeight - padding * 2)),
      overflowY: 'auto',
      overscrollBehavior: 'contain',
      scrollbarGutter: 'stable',
      zIndex: WORKSPACE_LAYER_Z.floatingPanel,
      visibility: 'visible',
      pointerEvents: 'auto',
    },
  }
}

export function shouldIgnoreWorkspaceAnchoredScroll(target: EventTarget | null, panel: HTMLElement | null): boolean {
  return target instanceof Node && Boolean(panel?.contains(target))
}

export function getWorkspaceModalFrameClass(size: WorkspaceModalSize) {
  if (size === 'compact') return 'p-4 sm:p-6'
  if (size === 'standard') return 'p-4 sm:p-6'
  if (size === 'wide') return 'p-4 sm:p-8'
  if (size === 'workspace') return 'p-6 sm:p-10'
  return 'p-4 sm:p-6'
}

export function getWorkspaceModalShellClass(size: WorkspaceModalSize) {
  if (size === 'compact') return 'w-full max-w-lg max-h-[82vh]'
  if (size === 'standard') return 'w-full max-w-3xl max-h-[86vh]'
  if (size === 'wide') return 'w-full max-w-5xl max-h-[88vh]'
  if (size === 'workspace') return 'w-full max-w-[1440px] h-full sm:h-auto sm:max-h-[92vh]'
  return 'fixed inset-0 w-screen h-screen max-w-none max-h-none'
}

export function WorkspaceFieldLabel({
  label,
  required = false,
  htmlFor,
}: {
  label: string
  required?: boolean
  htmlFor?: string
}) {
  return (
    <label htmlFor={htmlFor} className={`px-1 ${OPERATIONAL_WORKSPACE_VISUALS.fieldLabelText}`}>
      {label}
      {required && <span className="ml-1 text-rose-400">*</span>}
    </label>
  )
}

export function WorkspaceFieldError({ message, id }: { message?: string; id?: string }) {
  if (!message) return null
  return <p id={id} className={`px-1 ${OPERATIONAL_WORKSPACE_VISUALS.fieldErrorText}`}>{message}</p>
}

export function WorkspacePanelTitle({ children }: { children: React.ReactNode }) {
  return <h3 className={OPERATIONAL_WORKSPACE_VISUALS.titleText}>{children}</h3>
}

export function WorkspacePanelSubtitle({ children }: { children: React.ReactNode }) {
  return <p className={`mt-0.5 ${OPERATIONAL_WORKSPACE_VISUALS.subtitleText}`}>{children}</p>
}

export function WorkspacePanelHint({ children }: { children: React.ReactNode }) {
  return <p className={OPERATIONAL_WORKSPACE_VISUALS.hintText}>{children}</p>
}

export function getWorkspaceFloatingPanelClass(kind: 'menu' | 'context' | 'detail' = 'menu') {
  return join(
    `${OPERATIONAL_WORKSPACE_VISUALS.standardRadius} border border-[var(--border-default)] bg-[var(--surface-overlay)] text-[var(--text-primary)] shadow-[0_12px_36px_rgba(0,0,0,0.25)]`,
    kind === 'context' && 'workspace-context-panel',
  )
}

export function useWorkspaceAnchoredLayer(isOpen: boolean, options?: { offset?: number; minWidth?: number }) {
  const offset = options?.offset ?? 8
  const minWidth = options?.minWidth ?? 0
  const triggerRef = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const anchorId = useId()
  const placementRef = useRef<'above' | 'below' | null>(null)
  const frameRef = useRef<number | null>(null)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({
    position: 'fixed',
    top: -9999,
    left: -9999,
    visibility: 'hidden',
    pointerEvents: 'none',
  })

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger || typeof window === 'undefined') return

    const result = computeWorkspaceAnchoredPanelStyle({
      triggerRect: trigger.getBoundingClientRect(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      offset,
      minWidth,
      placement: placementRef.current,
    })
    placementRef.current = result.placement
    if (!trigger.id) trigger.id = anchorId
    if (panelRef.current) panelRef.current.dataset.workspaceAnchor = trigger.id
    const nextStyle = { ...result.style, zIndex: getWorkspaceAnchorLayer(trigger) }

    setPanelStyle((current) => {
      const keys = Object.keys(nextStyle) as Array<keyof CSSProperties>
      if (keys.every((key) => current[key] === nextStyle[key]) && Object.keys(current).length === keys.length) {
        return current
      }
      return nextStyle
    })
  }, [minWidth, offset, anchorId])

  const schedulePositionUpdate = useCallback(() => {
    if (typeof window === 'undefined') return
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      updatePosition()
    })
  }, [updatePosition])

  useLayoutEffect(() => {
    if (!isOpen) {
      placementRef.current = null
      setPanelStyle({
        position: 'fixed',
        top: -9999,
        left: -9999,
        visibility: 'hidden',
        pointerEvents: 'none',
      })
      return
    }

    const handleViewportChange = (event?: Event) => {
      if (shouldIgnoreWorkspaceAnchoredScroll(event?.target ?? null, panelRef.current)) return
      schedulePositionUpdate()
    }

    schedulePositionUpdate()
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)

    let observer: ResizeObserver | null = null
    let observerFrame: number | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => schedulePositionUpdate())
      observerFrame = window.requestAnimationFrame(() => {
        if (panelRef.current) observer?.observe(panelRef.current)
        if (triggerRef.current) observer?.observe(triggerRef.current)
      })
    }

    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
      observer?.disconnect()
      if (observerFrame !== null) window.cancelAnimationFrame(observerFrame)
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [isOpen, schedulePositionUpdate])

  return { triggerRef, panelRef, panelStyle, updatePosition }
}

export const useEscapeDismiss = (onClose: () => void, active: boolean = true) => {
  useEffect(() => {
    if (!active) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[data-workspace-modal-root]')) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, active])
}

export const useBodyModalFlag = () => {
  useEffect(() => {
    if (typeof document === 'undefined') return
    const body = document.body
    const currentCount = Number(body.dataset.sysgridModalCount || '0')
    const nextCount = currentCount + 1
    body.dataset.sysgridModalCount = String(nextCount)
    body.dataset.sysgridModalOpen = 'true'
    return () => {
      const updatedCount = Math.max(0, Number(body.dataset.sysgridModalCount || '1') - 1)
      if (updatedCount === 0) {
        delete body.dataset.sysgridModalCount
        delete body.dataset.sysgridModalOpen
      } else {
        body.dataset.sysgridModalCount = String(updatedCount)
        body.dataset.sysgridModalOpen = 'true'
      }
    }
  }, [])
}

export function WorkspaceFloatingPanel({
  children,
  className = '',
  kind = 'menu',
  style,
}: {
  children: React.ReactNode
  className?: string
  kind?: 'menu' | 'context' | 'detail'
  style?: React.CSSProperties
}) {
  return <div className={join(getWorkspaceFloatingPanelClass(kind), className)} style={style}>{children}</div>
}

export function WorkspaceSectionBadge({
  children,
  tone = 'default',
}: {
  children: React.ReactNode
  tone?: 'default' | 'blue' | 'emerald' | 'amber' | 'rose'
}) {
  const toneClass =
    tone === 'blue'
      ? 'border-blue-500/20 bg-blue-500/10 text-blue-300'
      : tone === 'emerald'
        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
        : tone === 'amber'
          ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
          : tone === 'rose'
            ? 'border-rose-500/20 bg-rose-500/10 text-rose-300'
            : 'border-white/10 bg-black/30 text-slate-400'

  return (
    <span className={join(`${OPERATIONAL_WORKSPACE_VISUALS.standardRadius} border px-2.5 py-1 text-[9px] font-semibold`, toneClass)}>
      {children}
    </span>
  )
}

export function WorkspaceEmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: React.ReactNode
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  compact?: boolean
}) {
  return (
    <div
      className={join(
        `flex flex-col items-center justify-center ${OPERATIONAL_WORKSPACE_VISUALS.standardRadius} border border-dashed border-[var(--border-default)] bg-[var(--surface-elevated)] text-center`,
        compact ? 'px-4 py-8 space-y-2' : 'px-6 py-12 space-y-4'
      )}
    >
      {icon ? (
        <div className="text-slate-700">{icon}</div>
      ) : !compact ? (
        <div className="text-slate-700/40"><Info size={20} /></div>
      ) : null}
      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-[var(--text-primary)]">{title}</p>
        {description && <p className="max-w-md text-[10px] font-semibold leading-relaxed text-[var(--text-secondary)]">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function WorkspaceCollapsibleHeader({
  title,
  subtitle,
  badge,
  action,
  collapsed,
  onToggle,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  badge?: React.ReactNode
  action?: React.ReactNode
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-start justify-between gap-4 ${OPERATIONAL_WORKSPACE_VISUALS.standardRadius} text-left transition-colors hover:text-white`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <WorkspacePanelTitle>{title}</WorkspacePanelTitle>
          {badge}
        </div>
        {subtitle && <WorkspacePanelSubtitle>{subtitle}</WorkspacePanelSubtitle>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        <span className={`${OPERATIONAL_WORKSPACE_VISUALS.standardRadius} border border-white/10 bg-black/20 px-2 py-1 text-[9px] font-semibold text-slate-400`}>
          {collapsed ? 'Show' : 'Hide'}
        </span>
      </div>
    </button>
  )
}

export function WorkspaceSplitView({
  sidebar,
  main,
  className = '',
  side = 'left',
}: {
  sidebar?: React.ReactNode
  main: React.ReactNode
  className?: string
  side?: 'left' | 'right'
}) {
  if (!sidebar) {
    return <div className={join('w-full', className)}>{main}</div>
  }

  return (
    <div
      className={join(
        'grid grid-cols-1 gap-6',
        side === 'left' ? 'xl:grid-cols-[320px_minmax(0,1fr)]' : 'xl:grid-cols-[minmax(0,1fr)_320px]',
        className,
      )}
    >
      {side === 'left' ? (
        <>
          <div className="min-h-0">{sidebar}</div>
          <div className="min-h-0">{main}</div>
        </>
      ) : (
        <>
          <div className="min-h-0">{main}</div>
          <div className="min-h-0">{sidebar}</div>
        </>
      )}
    </div>
  )
}

export function WorkspaceHoverPreview({
  summary,
  tooltip,
  tone = 'default',
  fontSize,
}: {
  summary: string
  tooltip: string
  tone?: 'default' | 'blue'
  fontSize?: number
}) {
  return (
    <span
      title={tooltip}
      style={fontSize ? { fontSize: `${fontSize}px` } : undefined}
      className={`inline-block max-w-full truncate whitespace-nowrap cursor-help border-b border-dashed ${tone === 'blue' ? 'border-blue-500/30 text-blue-300 hover:text-blue-200' : 'border-slate-700 text-slate-200 hover:text-white'} transition-colors`}
    >
      {summary}
    </span>
  )
}

export function WorkspaceInfoTooltip({
  label,
  content,
}: {
  label: React.ReactNode
  content: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const { triggerRef, panelRef, panelStyle } = useWorkspaceAnchoredLayer(isOpen, { minWidth: 240 })

  useWorkspacePopupDismiss(isOpen, triggerRef, panelRef, () => setIsOpen(false))

  return (
    <>
      <button
        type="button"
        ref={(node) => {
          triggerRef.current = node
        }}
        onClick={() => setIsOpen((current) => !current)}
        className={`${OPERATIONAL_WORKSPACE_VISUALS.standardRadius} border border-white/10 bg-black/20 px-2.5 py-1.5 text-[9px] font-semibold text-slate-300 transition-colors hover:border-blue-500/30 hover:text-white`}
      >
        {label}
      </button>
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div ref={panelRef} style={panelStyle} data-workspace-panel="true">
          <WorkspaceFloatingPanel kind="detail" className="p-3">
            <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-2 text-[10px] font-semibold text-slate-200">
              {content}
            </div>
          </WorkspaceFloatingPanel>
        </div>,
        document.body
      )}
    </>
  )
}

export function getWorkspaceInputClass(error?: string) {
  return `w-full ${OPERATIONAL_WORKSPACE_VISUALS.controlSurface} px-4 py-[clamp(8px,0.75vw,11px)] ${OPERATIONAL_WORKSPACE_VISUALS.bodyControlText} outline-none transition-all ${
    error
      ? 'border border-rose-500/60 bg-rose-500/10 shadow-[0_0_0_1px_rgba(244,63,94,0.18)] focus:border-rose-400'
      : 'focus:border-blue-500/40'
  }`
}

export function WorkspaceSelectField({
  label,
  required = false,
  value,
  options,
  onChange,
  placeholder,
  error,
  searchable = false,
  disabled = false,
  multi = false,
}: {
  label: string
  required?: boolean
  value: string | number | Array<string | number> | null
  options: Array<{ value: string | number; label: string; description?: string }>
  onChange: (value: any) => void
  placeholder?: string
  error?: string
  searchable?: boolean
  disabled?: boolean
  multi?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { triggerRef, panelRef, panelStyle } = useWorkspaceAnchoredLayer(isOpen, { minWidth: 220 })
  
  const isSelected = (optValue: string | number) => {
    if (multi && Array.isArray(value)) {
      return value.includes(String(optValue)) || value.includes(Number(optValue))
    }
    return String(value) === String(optValue)
  }

  const handleSelect = (optValue: string | number) => {
    if (multi) {
      const currentValues = Array.isArray(value) ? [...value] : []
      const stringValue = String(optValue)
      const nextValues = currentValues.includes(stringValue)
        ? currentValues.filter((v) => String(v) !== stringValue)
        : [...currentValues, stringValue]
      onChange(nextValues)
    } else {
      onChange(String(optValue))
      setIsOpen(false)
      setSearch('')
    }
  }

  const getLabel = () => {
    if (multi && Array.isArray(value)) {
      if (value.length === 0) return placeholder || 'Select option'
      if (value.length === 1) return options.find(o => String(o.value) === String(value[0]))?.label || value[0]
      return `${value.length} selected`
    }
    const selected = options.find((option) => String(option.value) === String(value))
    return selected?.label || placeholder || 'Select option'
  }

  const filteredOptions = searchable
    ? options.filter((option) => `${option.label} ${option.description || ''}`.toLowerCase().includes(search.toLowerCase()))
    : options

  useWorkspacePopupDismiss(isOpen, triggerRef, panelRef, () => setIsOpen(false))

  return (
    <div className="space-y-1.5">
      <WorkspaceFieldLabel label={label} required={required} />
      <div>
        <button
          type="button"
          disabled={disabled}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          onClick={() => setIsOpen((current) => !current)}
          ref={(node) => {
            triggerRef.current = node
          }}
          className={`flex w-full items-center justify-between ${OPERATIONAL_WORKSPACE_VISUALS.standardRadius} border px-3 py-2 text-left transition-all ${error ? 'border-rose-500/60 bg-rose-500/10 shadow-[0_0_0_1px_rgba(244,63,94,0.18)]' : 'border-white/10 bg-slate-950/70 hover:border-blue-500/30'} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          <span className={`text-[clamp(10px,0.85vw,12px)] font-black truncate pr-4 ${(value && (!Array.isArray(value) || value.length > 0)) ? 'text-slate-100' : 'text-slate-500'}`}>
            {getLabel()}
          </span>
          <ChevronDown size={12} className={`shrink-0 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen && !disabled && typeof document !== 'undefined' && createPortal(
          <div
            ref={panelRef}
            style={panelStyle}
            data-workspace-panel="true"
            onMouseDown={(e) => e.stopPropagation()}
            className={`${OPERATIONAL_WORKSPACE_VISUALS.standardRadius} border border-white/10 bg-[#020617] p-2 shadow-[0_24px_60px_rgba(2,6,23,0.48)] backdrop-blur-xl flex flex-col`}
          >
            {searchable && (
              <div className="mb-2">
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${label.toLowerCase()}...`}
                  className={`w-full ${OPERATIONAL_WORKSPACE_VISUALS.standardRadius} border border-white/10 bg-black/20 px-3 py-2 text-[10px] font-black text-slate-100 outline-none focus:border-blue-500/40`}
                />
              </div>
            )}
            <div className="max-h-52 overflow-y-auto custom-scrollbar space-y-1 pr-1">
              {filteredOptions.map((option) => {
                const active = isSelected(option.value)
                return (
                  <button
                    key={String(option.value)}
                    type="button"
                    onClick={() => handleSelect(option.value)}
                    className={`w-full ${OPERATIONAL_WORKSPACE_VISUALS.standardRadius} border px-3 py-2 text-left transition-all ${active ? 'border-blue-500/30 bg-blue-500/10' : 'border-white/5 bg-black/20 hover:border-white/10 hover:bg-white/[0.03]'}`}
                  >
                    <div className="flex items-center gap-2">
                      {multi && (
                        <div className={`w-3.5 h-3.5 ${OPERATIONAL_WORKSPACE_VISUALS.standardRadius} border flex items-center justify-center transition-colors ${active ? 'bg-blue-500 border-blue-500' : 'border-white/20 bg-black/20'}`}>
                          {active && <Check size={10} className="text-white" />}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className={`text-[9px] font-black ${active ? 'text-blue-300' : 'text-slate-200'}`}>{option.label}</p>
                        {option.description && <p className="mt-0.5 text-[8px] font-black text-slate-500 truncate">{option.description}</p>}
                      </div>
                      {!multi && active && <Check size={12} className="text-blue-400 shrink-0" />}
                    </div>
                  </button>
                )
              })}
              {filteredOptions.length === 0 && (
                <div className={`${OPERATIONAL_WORKSPACE_VISUALS.standardRadius} border border-white/5 bg-black/20 px-3 py-4 text-center text-[9px] font-black text-slate-500`}>
                  No matching options
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
      </div>
      <WorkspaceFieldError message={error} />
    </div>
  )
}

export function WorkspaceSectionCard({
  children,
  className = '',
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  children: React.ReactNode
  className?: string
}) {
  return <section {...props} className={`${OPERATIONAL_WORKSPACE_VISUALS.panelSurface} p-4 ${className}`}>{children}</section>
}

export function WorkspaceStickyIdentityBar({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`sticky top-0 z-20 -mx-6 mb-8 border-b border-white/10 bg-[#0b1222] px-6 py-6 shadow-2xl sm:-mx-8 sm:px-8 ${className}`}>
      {children}
    </div>
  )
}

export function WorkspaceTabStrip({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: Array<{ id: string; label: string; badgeCount?: number }>
  activeTab: string
  onChange: (id: string) => void
}) {
  return (
    <div className={`flex shrink-0 items-center gap-1 ${OPERATIONAL_WORKSPACE_VISUALS.standardRadius} border border-white/5 bg-white/5 p-1`}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`${OPERATIONAL_WORKSPACE_VISUALS.standardRadius} px-4 py-2 text-[10px] font-semibold transition-all ${activeTab === tab.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-500 hover:text-slate-300'}`}
        >
          <span className="flex items-center gap-2">
            <span>{tab.label}</span>
            {!!tab.badgeCount && (
              <span className="rounded-lg bg-rose-500/20 px-1.5 py-0.5 text-[8px] text-rose-300">{tab.badgeCount}</span>
            )}
          </span>
        </button>
      ))}
    </div>
  )
}

export function WorkspaceValidationBanner({ message }: { message?: string }) {
  if (!message) return null
  return (
    <div className={`mb-6 ${OPERATIONAL_WORKSPACE_VISUALS.standardRadius} border border-rose-500/20 bg-rose-500/10 px-4 py-3`}>
      <p className="text-[10px] font-semibold text-rose-300">{message}</p>
    </div>
  )
}

export function WorkspaceModalHeader({
  icon,
  title,
  subtitle,
  status,
  forensicLineage,
  closeControl,
  maximizeControl,
  tabs,
  activeTab,
  onTabChange,
}: {
  icon: React.ReactNode
  title: React.ReactNode
  subtitle: React.ReactNode
  status?: React.ReactNode
  forensicLineage?: { createdAt?: string | Date; updatedAt?: string | Date }
  closeControl: React.ReactNode
  maximizeControl?: React.ReactNode
  tabs?: Array<{ id: string; label: string; badgeCount?: number }>
  activeTab?: string
  onTabChange?: (id: string) => void
}) {
  const formatDate = (date: string | Date | undefined) => {
    if (!date) return 'Genesis'
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toLocaleString('en-US', { 
       month: 'short', 
       day: 'numeric', 
       year: 'numeric',
       hour: '2-digit',
       minute: '2-digit'
    })
  }

  return (
    <div data-workspace-modal-header className="z-30 shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-base)] px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 basis-full items-start gap-3">
          <div className={`hidden h-11 w-11 shrink-0 items-center justify-center sm:flex ${OPERATIONAL_WORKSPACE_VISUALS.standardRadius} border border-[var(--border-default)] bg-[var(--accent-glow)] text-[var(--accent-primary)]`}>
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-4">
               <div className="min-w-0 flex-1">
                  <h2 className="min-w-0 break-words text-lg font-semibold leading-snug tracking-tight text-[var(--text-primary)] [&>div]:min-w-0 [&>div]:flex-wrap">{title}</h2>
                  <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 [&>div]:min-w-0 [&>div]:flex-wrap">
                    <span className="min-w-0 break-words text-xs leading-relaxed text-[var(--text-secondary)]">{subtitle}</span>
                    {status && (
                      <>
                        <span className="hidden h-1 w-1 rounded-full bg-[var(--text-secondary)] sm:block" />
                        {status}
                      </>
                    )}
                  </div>
               </div>
               
               {forensicLineage && (
                  <div className="hidden xl:flex items-center gap-5 border-l border-[var(--border-default)] pl-5">
                     <div className="flex flex-col">
                        <span className="text-xs text-[var(--text-secondary)]">Created</span>
                        <span className="mt-1 text-xs font-medium text-[var(--text-primary)] whitespace-nowrap">{formatDate(forensicLineage.createdAt)}</span>
                     </div>
                     <div className="flex flex-col">
                        <span className="text-xs text-[var(--text-secondary)]">Last modified</span>
                        <span className="mt-1 text-xs font-medium text-[var(--text-primary)] whitespace-nowrap">{formatDate(forensicLineage.updatedAt)}</span>
                     </div>
                  </div>
               )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {maximizeControl}
            {closeControl}
          </div>
        </div>

        {tabs && activeTab && onTabChange && (
          <div className="min-w-0 max-w-full overflow-x-auto">
            <WorkspaceTabStrip tabs={tabs} activeTab={activeTab} onChange={onTabChange} />
          </div>
        )}
      </div>
    </div>
  )
}

export function WorkspaceModalFooter({
  left,
  right,
}: {
  left?: React.ReactNode
  right: React.ReactNode
}) {
  return (
    <div data-workspace-modal-footer className="shrink-0 border-t border-[var(--border-default)] bg-[var(--surface-base)] px-4 py-4 sm:px-6">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {left && <div className="flex min-w-0 flex-wrap items-center gap-2">{left}</div>}
        <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2 [&>div]:min-w-0 [&>div]:flex-wrap [&>div]:gap-2">{right}</div>
      </div>
    </div>
  )
}
