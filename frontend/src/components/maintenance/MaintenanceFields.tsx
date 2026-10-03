import { useId, type ReactNode } from 'react'
import { ConfirmationModal } from '../shared/ConfirmationModal'
import { useOperationalDirtyGuard } from '../shared/OperationalWorkspaceHooks'

export const inputClass = 'min-h-10 w-full min-w-0 rounded-lg border border-[var(--border-default)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--action-primary)] disabled:opacity-60'

export function Field({ label, value, onChange, required = false, multiline = false, maxLength = 500, disabled = false }: {
  label: string; value: string; onChange: (value: string) => void; required?: boolean; multiline?: boolean; maxLength?: number; disabled?: boolean
}) {
  const id = useId()
  const props = { id, value, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value), required, maxLength, disabled, className: inputClass }
  return <div className="space-y-1.5"><label htmlFor={id} className="text-xs font-semibold text-[var(--text-secondary)]">{label}{required ? ' *' : ''}</label>
    {multiline ? <textarea {...props} rows={3} /> : <input {...props} />}</div>
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0 space-y-4 rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] p-4 sm:p-5"><h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>{children}</section>
}

export function DraftGuard({ dirty }: { dirty: boolean }) {
  const guard = useOperationalDirtyGuard({ active: true, isDirty: dirty, onDiscard: () => {} })
  return <ConfirmationModal isOpen={guard.isConfirmOpen} onClose={guard.cancelDiscard} onConfirm={guard.confirmDiscard}
    title="Leave maintenance changes?" message="Your unsaved maintenance notes will be discarded. Recorded actions and their history will remain."
    confirmText="Discard and leave" cancelText="Keep editing" variant="warning" />
}
