import { useCallback, useEffect, useRef, useState } from 'react'
import { WorkspaceDialogFrame } from './WorkspaceDialogFrame'

type PromptRequest = { title: string; label: string; optional?: boolean; type?: 'text' | 'date' | 'url' }

/** Themed replacement for blocking browser input prompts. */
export function useWorkspacePrompt() {
  const [request, setRequest] = useState<PromptRequest | null>(null)
  const [value, setValue] = useState('')
  const pending = useRef<((value: string | null) => void) | null>(null)
  const settle = useCallback((answer: string | null) => {
    const resolve = pending.current
    pending.current = null
    setRequest(null)
    resolve?.(answer)
  }, [])
  useEffect(() => () => { pending.current?.(null); pending.current = null }, [])
  const ask = useCallback((next: PromptRequest) => {
    if (pending.current) return Promise.resolve(null)
    setValue('')
    setRequest(next)
    return new Promise<string | null>((resolve) => { pending.current = resolve })
  }, [])
  return {
    ask,
    promptDialog: request ? <WorkspaceDialogFrame title={request.title} onClose={() => settle(null)}>
      <form className="w-[440px] space-y-5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-6 text-[var(--text-primary)] shadow-xl"
        onSubmit={(event) => { event.preventDefault(); if (request.optional || value.trim()) settle(value.trim()) }}>
        <h2 className="text-base font-semibold">{request.title}</h2>
        <label className="block space-y-2 text-sm"><span>{request.label}</span>
          <input autoFocus type={request.type || 'text'} required={!request.optional} value={value} onChange={(event) => setValue(event.target.value)}
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-base)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-[var(--text-secondary)]" />
        </label>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => settle(null)} className="rounded-md border border-[var(--border-default)] px-4 py-2 text-sm hover:bg-[var(--surface-hover)]">Cancel</button>
          <button type="submit" disabled={!request.optional && !value.trim()} className="rounded-md bg-[var(--action-primary)] px-4 py-2 text-sm text-white disabled:opacity-50">Continue</button>
        </div>
      </form>
    </WorkspaceDialogFrame> : null,
  }
}
