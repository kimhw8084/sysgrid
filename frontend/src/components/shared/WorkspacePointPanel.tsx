import { ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { WORKSPACE_LAYER_Z } from './WorkspaceOverlay'

/** A measured, portaled hover card for SVG/canvas points without a DOM anchor. */
export function WorkspacePointPanel({ x, y, children, onMouseEnter, onMouseLeave }: {
  x: number; y: number; children: ReactNode; onMouseEnter?: () => void; onMouseLeave?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 16, top: 16 })
  useLayoutEffect(() => {
    const place = () => {
      const bounds = ref.current?.getBoundingClientRect()
      if (!bounds) return
      setPosition({ left: Math.max(16, Math.min(x + 16, innerWidth - bounds.width - 16)),
        top: Math.max(16, Math.min(y - 40, innerHeight - bounds.height - 16)) })
    }
    place()
    const observer = new ResizeObserver(place)
    if (ref.current) observer.observe(ref.current)
    window.addEventListener('resize', place)
    return () => { observer.disconnect(); window.removeEventListener('resize', place) }
  }, [x, y])
  return createPortal(<div ref={ref} role="tooltip" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
    style={{ position: 'fixed', ...position, zIndex: WORKSPACE_LAYER_Z.tooltip, width: 260, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100dvh - 32px)' }}
    className="workspace-tooltip overflow-auto rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] p-3 text-[var(--text-primary)] shadow-xl">{children}</div>, document.body)
}
