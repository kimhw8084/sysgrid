import { useEffect, useState } from 'react'
import { getLogicExtensions } from './monitoringWorkspaceContract'

type CodeEditor = typeof import('@uiw/react-codemirror')['default']
interface LogicEditorProps {
  value: string
  logicType: string
  placeholder: string
  onChange: (value: string) => void
}

export function MonitoringLogicEditor({ value, logicType, placeholder, onChange }: LogicEditorProps) {
  const [Editor, setEditor] = useState<CodeEditor | null>(null)
  const [failed, setFailed] = useState(false)
  const [plain, setPlain] = useState(false)
  useEffect(() => {
    let mounted = true
    import('@uiw/react-codemirror').then(module => {
      if (mounted) setEditor(() => module.default)
    }, () => { if (mounted) setFailed(true) })
    return () => { mounted = false }
  }, [])

  if (Editor && !plain) return <Editor value={value} height="100%" minHeight="280px"
    extensions={getLogicExtensions(logicType)} basicSetup={{ lineNumbers: true, foldGutter: true }}
    placeholder={placeholder} onChange={onChange} theme="dark"
    onCreateEditor={view => view.contentDOM.setAttribute('aria-label', 'Logic Information')} />
  if (!failed && !plain) return <div className="min-h-[280px] space-y-3 bg-[var(--surface-base)] p-4 text-sm text-[var(--text-secondary)]">
    <p role="status">Loading logic editor…</p>
    <button type="button" onClick={() => setPlain(true)} className="min-h-11 rounded-md border border-[var(--border-default)] bg-[var(--surface-base)] px-3 text-[var(--text-primary)]">Use plain text editor</button>
  </div>
  return <div className="space-y-3 bg-[var(--surface-base)] p-3">
    <p role={failed ? 'alert' : 'status'} className="text-sm text-[var(--text-secondary)]">
      {failed ? 'Enhanced editor unavailable. You can continue with plain text.' : 'Using plain text editor.'}
    </p>
    {Editor && <button type="button" onClick={() => setPlain(false)} className="min-h-11 rounded-md border border-[var(--border-default)] bg-[var(--surface-base)] px-3 text-[var(--text-primary)]">Use enhanced editor</button>}
    <textarea aria-label="Logic Information" value={value} placeholder={placeholder} onChange={event => onChange(event.currentTarget.value)}
      className="min-h-[280px] w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-base)] p-3 font-mono text-sm text-[var(--text-primary)]" />
  </div>
}
