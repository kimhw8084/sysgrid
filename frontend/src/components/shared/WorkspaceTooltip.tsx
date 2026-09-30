import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { WORKSPACE_LAYER_Z } from './WorkspaceOverlay'

/** Escapes grid/scroll clipping and stays reachable at every desktop viewport edge. */
export function WorkspaceTooltip({ children, content, className = '', focusable = false, disabledReason = false }: {
  children: React.ReactNode
  content: React.ReactNode
  className?: string
  focusable?: boolean
  disabledReason?: boolean
}) {
  const id = useId()
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({})
  const enter = () => { clearTimeout(timer.current); setOpen(true) }
  const leave = () => { timer.current = setTimeout(() => setOpen(false), 120) }
  useEffect(() => () => clearTimeout(timer.current), [])
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      if (!anchor.current || !panel.current) return
      const rect = anchor.current.getBoundingClientRect()
      const width = Math.min(320, window.innerWidth - 24)
      const height = Math.min(panel.current.scrollHeight, window.innerHeight - 24)
      const above = rect.top - height - 8
      setStyle({
        position: 'fixed', zIndex: WORKSPACE_LAYER_Z.tooltip, width,
        left: Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(above >= 12 ? above : rect.bottom + 8, window.innerHeight - height - 12)),
        maxHeight: window.innerHeight - 24,
      })
    }
    const close = () => setOpen(false)
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) close() }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    if (panel.current) observer?.observe(panel.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', scroll, true)
    document.addEventListener('keydown', key)
    window.addEventListener('workspace:modal-open', close)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', scroll, true)
      document.removeEventListener('keydown', key)
      window.removeEventListener('workspace:modal-open', close)
    }
  }, [open])
  return <span ref={anchor} className={className} tabIndex={focusable ? 0 : undefined}
    data-disabled-tooltip-host={disabledReason ? 'true' : undefined}
    aria-describedby={id} onMouseEnter={enter} onMouseLeave={leave} onFocus={enter} onBlur={leave}>
    {children}
    {!open && <span className="sr-only" id={id}>{content}</span>}
    {open && createPortal(<div ref={panel} id={id} role="tooltip" style={style}
      onMouseEnter={enter} onMouseLeave={leave}
      className="workspace-tooltip overflow-y-auto overscroll-contain rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] p-3 text-xs leading-relaxed text-[var(--text-primary)] shadow-xl">{content}</div>, document.body)}
  </span>
}
