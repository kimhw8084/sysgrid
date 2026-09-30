import React, { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspacePopupDismiss } from "./WorkspaceOverlay"
import { ChevronDown, Check } from 'lucide-react'
import { OPERATIONAL_WORKSPACE_VISUALS } from './OperationalWorkspace'
import { getWorkspaceFloatingPanelClass, useWorkspaceAnchoredLayer } from './OperationalWorkspacePrimitives'

const WorkspaceFieldError = ({ message }: { message: string }) => (
  <p className="px-1 pt-1 text-[9px] font-bold uppercase tracking-wider text-rose-400">
    {message}
  </p>
)

const WorkspaceFieldHint = ({ message }: { message: string }) => (
  <p className="px-1 pt-1 text-[9px] font-semibold text-slate-500">
    {message}
  </p>
)

interface Option {
  value: string | number
  label: string
}

interface AppDropdownProps {
  value: string | number | Array<string | number>
  onChange: (value: any) => void
  options: Option[]
  label?: string
  required?: boolean
  placeholder?: string
  className?: string
  disabled?: boolean
  multi?: boolean
  error?: string
  hint?: string
}

export const AppDropdown = ({
  value,
  onChange,
  options,
  label,
  required = false,
  placeholder,
  className = '',
  disabled = false,
  multi = false,
  error,
  hint,
}: AppDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const describedById = useId()
  const { triggerRef, panelRef, panelStyle } = useWorkspaceAnchoredLayer(isOpen, { minWidth: 200 })
  const uniqueOptions = options.filter((option, index, items) => (
    items.findIndex((candidate) => candidate.value === option.value) === index
  ))

  useWorkspacePopupDismiss(isOpen, triggerRef, panelRef, () => setIsOpen(false))

  useEffect(() => {
    if (isOpen) setSearchTerm('')
  }, [isOpen])

  const filteredOptions = uniqueOptions.filter(opt => 
    String(opt.label).toLowerCase().includes(searchTerm.toLowerCase()) ||
    String(opt.value).toLowerCase().includes(searchTerm.toLowerCase())
  )

  const isSelected = (optValue: string | number) => {
    if (multi && Array.isArray(value)) {
      return value.includes(optValue)
    }
    return value === optValue
  }

  const handleSelect = (optValue: string | number) => {
    if (multi) {
      const currentValues = Array.isArray(value) ? value : []
      const nextValues = currentValues.includes(optValue)
        ? currentValues.filter(v => v !== optValue)
        : [...currentValues, optValue]
      onChange(nextValues)
    } else {
      onChange(optValue)
      setIsOpen(false)
    }
  }

  const getLabel = () => {
    if (multi && Array.isArray(value)) {
      if (value.length === 0) return placeholder || 'Select...'
      if (value.length === 1) return uniqueOptions.find(o => o.value === value[0])?.label || value[0]
      return `${value.length} selected`
    }
    const selectedOption = uniqueOptions.find(opt => opt.value === value)
    return selectedOption ? selectedOption.label : placeholder || 'Select...'
  }

  const errorId = error ? `${describedById}-error` : undefined
  const hintId = hint && !error ? `${describedById}-hint` : undefined
  const describedBy = errorId || hintId

  return (
    <div className={`space-y-1 ${className} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}>
      {label && (
        <label className={`block px-1 ${OPERATIONAL_WORKSPACE_VISUALS.fieldLabelText}`}>
          <span className="inline-flex items-center gap-1">
            <span>{label}</span>
            {required && <span className="text-rose-400">*</span>}
          </span>
        </label>
      )}
      <div>
        <button
          ref={(node) => {
            triggerRef.current = node
          }}
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={`
            w-full flex items-center justify-between
            ${OPERATIONAL_WORKSPACE_VISUALS.controlSurface}
            min-h-10 px-3 py-2 text-sm outline-none focus:border-[var(--accent-primary)]
            transition-all ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'} 
            ${(!value || (Array.isArray(value) && value.length === 0)) ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}
            ${error ? 'border-rose-500/50 ring-1 ring-rose-500/20' : ''}
          `}
        >
          <span className="truncate">{getLabel()}</span>
          <ChevronDown size={14} className={`shrink-0 text-[var(--text-secondary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {error && <div id={errorId}><WorkspaceFieldError message={error} /></div>}
        {hint && !error && <div id={hintId}><WorkspaceFieldHint message={hint} /></div>}

        {isOpen && typeof document !== 'undefined' && createPortal(
          <div
            ref={panelRef}
            style={{ ...panelStyle, backgroundColor: 'var(--surface-base)' }}
            data-workspace-panel="true"
            onMouseDown={(e) => e.stopPropagation()}
            className={`${getWorkspaceFloatingPanelClass('menu')} overflow-hidden shadow-2xl flex flex-col`}
          >
            <div className="p-2 border-b border-white/5">
              <input
                autoFocus
                type="text"
                placeholder="Search options..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
              />
            </div>
            <div className="max-h-[300px] overflow-y-auto custom-scrollbar p-1">
              {filteredOptions.map((opt) => {
                const active = isSelected(opt.value)
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className={`
                      w-full flex min-h-10 items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors
                      ${active ? 'bg-[var(--action-primary)] text-white' : 'text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'}
                    `}
                  >
                    <div className="flex items-center gap-2 truncate">
                      {multi && (
                        <div className={`w-3.5 h-3.5 rounded-lg border flex items-center justify-center transition-colors ${active ? 'bg-white border-white' : 'border-white/20 bg-black/20'}`}>
                          {active && <Check size={10} className="text-blue-600" />}
                        </div>
                      )}
                      <span className="truncate">{opt.label}</span>
                    </div>
                    {!multi && active && <Check size={12} className="shrink-0 ml-2" />}
                  </button>
                )
              })}
              {filteredOptions.length === 0 && (
                <div className="px-3 py-4 text-center">
                  <p className="text-[10px] text-slate-500 italic">No matching options</p>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  )
}
