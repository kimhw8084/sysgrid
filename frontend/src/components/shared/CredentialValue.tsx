import { useCallback, useEffect, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { apiFetch } from '../../api/apiClient'

export const credentialUpdatePayload = (draft: { secret_type: string; username: string; notes: string; encrypted_payload?: string }) => ({
  secret_type: draft.secret_type,
  username: draft.username,
  notes: draft.notes,
  ...(draft.encrypted_payload ? { encrypted_payload: draft.encrypted_payload } : {}),
})

export const CredentialValue = ({ deviceId, secretId, canReveal, hasPayload }: {
  deviceId: number; secretId: number; canReveal: boolean; hasPayload: boolean
}) => {
  const [value, setValue] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const request = useRef<AbortController | null>(null)
  const hide = useCallback(() => {
    request.current?.abort()
    request.current = null
    setValue(null)
    setPending(false)
    setFailed(false)
  }, [])

  useEffect(() => {
    hide()
    const hidden = () => { if (document.hidden) hide() }
    window.addEventListener('blur', hide)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      request.current?.abort()
      window.removeEventListener('blur', hide)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [deviceId, secretId, canReveal, hide])

  useEffect(() => {
    if (value === null) return
    const timeout = window.setTimeout(hide, 30_000)
    return () => window.clearTimeout(timeout)
  }, [value, hide])

  const reveal = async () => {
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setFailed(false)
    try {
      const response = await apiFetch(`/api/v1/devices/${deviceId}/secrets/${secretId}/reveal`, {
        method: 'POST', cache: 'no-store', signal: controller.signal,
      })
      if (!response.ok) throw new Error('Reveal failed')
      const body = await response.json()
      if (typeof body.value !== 'string') throw new Error('Invalid reveal response')
      if (!controller.signal.aborted) setValue(body.value)
    } catch {
      if (!controller.signal.aborted) setFailed(true)
    } finally {
      if (!controller.signal.aborted) setPending(false)
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="min-w-0 break-all text-[var(--text-secondary)]">{value ?? (hasPayload ? '••••••••••••' : 'No stored value')}</span>
        <button
          type="button"
          disabled={!canReveal || !hasPayload || pending}
          aria-label={value === null ? 'Reveal credential' : 'Hide credential'}
          title={!canReveal ? 'Secret management permission is required' : value === null ? 'Reveal for 30 seconds' : 'Hide credential'}
          onClick={value === null ? reveal : hide}
          className="shrink-0 rounded p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--action-primary)] disabled:opacity-40"
        >
          {value === null ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      </div>
      {pending && <span role="status">Revealing…</span>}
      {failed && <span role="alert" className="text-[var(--state-danger)]">Unable to reveal. Check your access and try again.</span>}
    </div>
  )
}
