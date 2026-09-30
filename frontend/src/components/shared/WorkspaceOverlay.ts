import { ReactNode, RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export function WorkspacePortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}

export const WORKSPACE_LAYER_Z = {
  floatingBackdrop: 3380,
  floatingPanel: 3400,
  rowActionMenu: 3410,
  modal: 3500,
  fullscreen: 3500,
  tooltip: 9000,
  toast: 10000,
} as const

export function getWorkspaceAnchorLayer(trigger: HTMLElement | null, fallback: number = WORKSPACE_LAYER_Z.floatingPanel): number {
  let layer: number = fallback
  for (let parent = trigger; parent; parent = parent.parentElement) {
    const z = Number.parseInt(getComputedStyle(parent).zIndex)
    if (Number.isFinite(z)) layer = Math.max(layer, z + 10)
  }
  return layer
}

export function isTopWorkspaceDialog(dialog: HTMLElement | null) {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[data-workspace-modal-root]'))
  const top = dialogs.sort((a, b) => Number(getComputedStyle(a).zIndex) - Number(getComputedStyle(b).zIndex)).at(-1)
  return !top || top === dialog
}

/** Shared keyboard/layer contract for older dialogs while preserving their interior layout. */
export function useWorkspaceDialogLayer(active: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [zIndex, setZIndex] = useState<number>(WORKSPACE_LAYER_Z.modal)
  useLayoutEffect(() => {
    if (!active || !dialogRef.current) return
    const dialog = dialogRef.current
    const previous = document.activeElement as HTMLElement | null
    const others = Array.from(document.querySelectorAll<HTMLElement>('[data-workspace-modal-root]')).filter((el) => el !== dialog)
    setZIndex(Math.max(WORKSPACE_LAYER_Z.modal, ...others.map((el) => Number(getComputedStyle(el).zIndex) + 100)))
    window.dispatchEvent(new Event('workspace:modal-open'))
    const controls = () => Array.from(document.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled]), a[href], select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'))
      .filter((el) => el.getClientRects().length > 0 && isWorkspacePopupDescendant(el, dialog))
    const focusFrame = requestAnimationFrame(() => (controls()[0] || dialog).focus())
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isTopWorkspaceDialog(dialog)) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const items = controls(), first = items[0], last = items.at(-1)
      if (!first || !last) { event.preventDefault(); dialog.focus(); return }
      const inside = document.activeElement && isWorkspacePopupDescendant(document.activeElement, dialog)
      if (event.shiftKey && (document.activeElement === first || !inside)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !inside)) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', key)
    return () => {
      cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', key)
      if (previous?.isConnected) previous.focus()
    }
  }, [active])
  return { ref: dialogRef, style: { zIndex }, tabIndex: -1, 'data-workspace-modal-root': true }
}

// Portal ownership follows the triggering control, including selectors inside selectors.
export function isWorkspacePopupDescendant(target: Node, panel: HTMLElement | null): boolean {
  if (panel?.contains(target)) return true
  let popup = target instanceof Element ? target.closest<HTMLElement>('[data-workspace-anchor]') : null
  const seen = new Set<string>()
  while (popup?.dataset.workspaceAnchor && !seen.has(popup.dataset.workspaceAnchor)) {
    const id = popup.dataset.workspaceAnchor
    seen.add(id)
    const anchor = document.getElementById(id)
    if (anchor && panel?.contains(anchor)) return true
    popup = anchor?.closest<HTMLElement>('[data-workspace-anchor]') || null
  }
  return false
}

export function useWorkspacePopupDismiss(
  active: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!active) return
    const close = () => closeRef.current()
    const outside = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node) || triggerRef.current?.contains(target) || isWorkspacePopupDescendant(target, panelRef.current)) return
      close()
    }
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const panel = panelRef.current
      const target = event.target as Node
      if (!panel || !(target instanceof Node)) return
      const direct = panel.contains(target) || triggerRef.current?.contains(target)
      // The inner portal consumes Escape first; the containing dialog stays open.
      if (!direct) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        close()
        triggerRef.current?.focus()
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        if (target instanceof HTMLInputElement && !['ArrowDown', 'ArrowUp'].includes(event.key)) return
        const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), [role="option"]:not([aria-disabled="true"])'))
          .filter((el) => el.getClientRects().length > 0)
        if (!controls.length) return
        event.preventDefault()
        const index = controls.indexOf(document.activeElement as HTMLElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length
        controls[next]?.focus()
      }
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', key)
    const focusFrame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])')?.focus())
    window.addEventListener('workspace:modal-open', close)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', key)
      cancelAnimationFrame(focusFrame)
      window.removeEventListener('workspace:modal-open', close)
    }
  }, [active, triggerRef, panelRef])
}
