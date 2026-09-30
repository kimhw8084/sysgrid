import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { resolveValue, toast, Toast, useToaster, useToasterStore } from 'react-hot-toast'
import { X, RotateCcw, AlertTriangle, Check, Info, LoaderCircle } from 'lucide-react'

type ToastTone = 'success' | 'error' | 'loading' | 'info'
type RevertAction = () => void | Promise<void>
interface WorkspaceToastProps {
  t: Toast
  message: React.ReactNode
  onRevert?: RevertAction
  type?: ToastTone
}
type WorkspaceToastOptions = { onRevert?: RevertAction; type?: ToastTone }

const toastTitles = { success: 'Completed', error: 'Action needed', loading: 'In progress', info: 'Notice' }
const toastIcons = { success: Check, error: AlertTriangle, loading: LoaderCircle, info: Info }
const ToastPauseContext = createContext<number | undefined>(undefined)

export const WorkspaceToast = ({ t, message, onRevert, type = 'success' }: WorkspaceToastProps) => {
  const pausedAt = useContext(ToastPauseContext)
  const [now, setNow] = useState(Date.now)
  const [isConfirmingRevert, setIsConfirmingRevert] = useState(false)
  const [isReverting, setIsReverting] = useState(false)
  const [revertError, setRevertError] = useState('')
  const inFlight = useRef(false)
  const duration = t.duration ?? 4000
  const persistent = !Number.isFinite(duration)
  // The library owns dismissal. The gauge reads the same clock, including hover/focus pauses.
  const elapsed = Math.max(0, (pausedAt || now) - (t.createdAt || now) - (t.pauseDuration || 0))
  const progress = persistent ? 100 : Math.max(0, 100 * (1 - elapsed / duration))
  const Icon = toastIcons[isReverting ? 'loading' : type]

  useEffect(() => {
    setNow(Date.now())
    if (!t.visible || pausedAt || persistent) return
    const timer = setInterval(() => setNow(Date.now()), 50)
    return () => clearInterval(timer)
  }, [t.visible, t.createdAt, pausedAt, persistent])

  const revert = async () => {
    if (!onRevert || inFlight.current) return
    if (!isConfirmingRevert) { setIsConfirmingRevert(true); return }
    inFlight.current = true
    setIsReverting(true)
    setRevertError('')
    // A slow request must not expire, and a failed revert must remain available to retry.
    toast.custom(t.message, { id: t.id, duration: Infinity })
    try {
      await onRevert()
      toast.dismiss(t.id)
    } catch (error) {
      setRevertError(error instanceof Error ? error.message : 'Could not revert. Try again.')
      setIsConfirmingRevert(false)
    } finally {
      inFlight.current = false
      setIsReverting(false)
    }
  }

  return (
    <div data-workspace-toast={type} data-visible={t.visible} className="workspace-toast" style={{ '--toast-tone': `var(--state-${type === 'error' ? 'danger' : type === 'loading' ? 'info' : type})` } as React.CSSProperties}>
      <div className="flex items-start gap-3 p-4">
        <div className="workspace-toast-icon"><Icon size={18} aria-hidden="true" className={isReverting || type === 'loading' ? 'animate-spin' : ''} /></div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-[var(--text-primary)]">{isReverting ? 'Reverting change' : toastTitles[type]}</p>
          <div {...(t.ariaProps || { role: 'status', 'aria-live': 'polite' })} className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{message}</div>
          {revertError && <p role="alert" className="mt-2 text-xs text-[var(--state-danger)]">{revertError}</p>}
          {onRevert && <button type="button" onClick={revert} onBlur={() => setIsConfirmingRevert(false)} disabled={isReverting}
            className="mt-3 inline-flex min-h-8 items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--surface-hover)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--action-primary-muted)] disabled:opacity-60">
            <RotateCcw size={13} aria-hidden="true" />{isReverting ? 'Reverting…' : isConfirmingRevert ? 'Confirm Undo?' : 'Revert'}
          </button>}
        </div>
        <button type="button" onClick={() => toast.dismiss(t.id)} disabled={isReverting} aria-label="Dismiss notification"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"><X size={16} aria-hidden="true" /></button>
      </div>
      <div data-toast-gauge className="workspace-toast-gauge" aria-hidden="true"><div style={{ width: `${progress}%` }} /></div>
    </div>
  )
}

// One renderer covers existing success/error/blank/promise calls as well as reversible custom notices.
export function WorkspaceToaster() {
  const { toasts, handlers } = useToaster({ duration: 4000, loading: { duration: Infinity }, error: { duration: 6000 } })
  // Keep subscriptions at the persistent stack. A toast unmount must never
  // unsubscribe the renderer (react-hot-toast groups subscriptions by toaster ID).
  const { pausedAt } = useToasterStore()
  const hovered = useRef(false)
  const focused = useRef(false)
  const paused = useRef(false)
  const syncPause = () => {
    const next = hovered.current || focused.current
    if (next === paused.current) return
    paused.current = next
    if (next) handlers.startPause()
    else handlers.endPause()
  }
  useEffect(() => {
    if (toasts.some((t) => t.visible)) return
    hovered.current = false
    focused.current = false
    if (paused.current) { paused.current = false; handlers.endPause() }
  }, [toasts, handlers.endPause])
  return createPortal(
    <ToastPauseContext.Provider value={pausedAt}><section aria-label="Notifications" data-workspace-toaster className="workspace-toaster"
      onMouseEnter={() => { hovered.current = true; syncPause() }} onMouseLeave={() => { hovered.current = false; syncPause() }}
      onFocusCapture={() => { focused.current = true; syncPause() }} onBlurCapture={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        focused.current = false; syncPause()
      }}>
      {toasts.map((t) => <React.Fragment key={t.id}>{t.type === 'custom' ? resolveValue(t.message, t) :
        <WorkspaceToast t={t} type={t.type === 'blank' ? 'info' : t.type} message={resolveValue(t.message, t)} />}</React.Fragment>)}
    </section></ToastPauseContext.Provider>, document.body)
}

export const showWorkspaceToast = (message: string, options?: WorkspaceToastOptions) => (
  toast.custom((t) => <WorkspaceToast t={t} message={message} onRevert={options?.onRevert} type={options?.type} />, {
    duration: options?.type === 'loading' ? Infinity : options?.onRevert ? 10000 : options?.type === 'error' ? 6000 : 4000,
    position: 'top-right', id: message,
  })
)
export const dismissWorkspaceToasts = () => toast.dismiss()
export const showWorkspaceRevertToast = (message: string, onRevert: RevertAction) => showWorkspaceToast(message, { onRevert, type: 'success' })
