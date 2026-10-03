import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmationModal } from './ConfirmationModal'

type Request = { title: string; message: string; confirmText?: string; cancelText?: string; variant?: 'danger' | 'warning' | 'info' }

/** In-app confirmation with cancellation on unmount; never leaves a pending action behind. */
export function useWorkspaceConfirmation() {
  const [request, setRequest] = useState<Request | null>(null)
  const pending = useRef<((accepted: boolean) => void) | null>(null)
  const settle = useCallback((accepted: boolean) => {
    const resolve = pending.current
    pending.current = null
    setRequest(null)
    resolve?.(accepted)
  }, [])
  useEffect(() => () => { pending.current?.(false); pending.current = null }, [])
  const confirm = useCallback((next: Request) => {
    // Keep the active question and reject a second trigger until it is answered.
    if (pending.current) return Promise.resolve(false)
    setRequest(next)
    return new Promise<boolean>((resolve) => { pending.current = resolve })
  }, [])
  return {
    confirm,
    confirmation: request ? <ConfirmationModal isOpen title={request.title} message={request.message}
      confirmText={request.confirmText} variant={request.variant} cancelText={request.cancelText || 'Cancel'}
      onClose={() => settle(false)} onConfirm={() => settle(true)} /> : null,
  }
}
