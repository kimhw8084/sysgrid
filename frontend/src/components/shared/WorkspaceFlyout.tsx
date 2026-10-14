import React from 'react'
import { ChevronRight } from 'lucide-react'
import { AppDropdown } from './AppDropdown'

export function WorkspaceFlyoutActionCard({
  title,
  active,
  onClick,
}: {
  title: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full min-h-10 rounded-lg border px-4 py-3 text-left transition-colors ${
        active ? 'border-[var(--accent-primary)] bg-[var(--action-primary-muted)]' : 'border-[var(--border-default)] bg-[var(--input-bg)] hover:bg-[var(--surface-hover)]'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-[var(--text-primary)]">{title}</p>
        <ChevronRight size={14} className={active ? 'text-[var(--action-ink)]' : 'text-[var(--text-secondary)]'} />
      </div>
    </button>
  )
}

export function WorkspaceFlyoutDropdownEditor({
  value,
  onChange,
  options,
  quickSelectOptions,
  placeholder,
  actionLabel,
  onApply,
  disabled,
}: {
  value: string | number
  onChange: (value: string) => void
  options: Array<{ value: string | number; label: string }>
  quickSelectOptions?: Array<{ value: string | number; label: string }>
  placeholder: string
  actionLabel: string
  onApply: () => void
  disabled?: boolean
}) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] p-3">
      <div className="grid gap-3">
        <AppDropdown
          value={String(value)}
          onChange={(next) => onChange(String(next))}
          options={options.map(option => ({ ...option, value: String(option.value) }))}
          placeholder={placeholder}
        />
        {quickSelectOptions?.length ? (
          <div className="flex flex-wrap gap-2">
            {quickSelectOptions.map((option) => {
              const isActive = String(value) === String(option.value)
              return (
                <button
                  key={String(option.value)}
                  type="button"
                  onClick={() => onChange(String(option.value))}
                  className={`min-h-8 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    isActive
                      ? 'border-[var(--accent-primary)] bg-[var(--action-primary-muted)] text-[var(--action-ink)]'
                      : 'border-[var(--border-default)] bg-[var(--input-bg)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                  }`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        ) : null}
        <button
          onClick={onApply}
          disabled={disabled}
          className="min-h-10 rounded-lg border border-[var(--border-default)] bg-[var(--action-primary-muted)] px-4 py-2.5 text-xs font-semibold text-[var(--action-ink)] transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:bg-[var(--input-bg)] disabled:text-[var(--text-disabled)]"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  )
}
