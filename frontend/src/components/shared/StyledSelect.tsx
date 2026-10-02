import React, { useId } from 'react'
import { ChevronDown } from 'lucide-react'

interface Option {
  id?: number | string
  value: string
  label: string
}

interface StyledSelectProps {
  value: string | number
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  options: Option[]
  label?: string
  placeholder?: string
  className?: string
  error?: boolean | string
  hint?: string
  disabled?: boolean
}

export const StyledSelect = ({ 
  value, 
  onChange, 
  options, 
  label, 
  placeholder, 
  className = '',
  error = false,
  hint,
  disabled = false
}: StyledSelectProps) => {
  const describedById = useId()
  const controlId = `${describedById}-control`
  const errorMessage = typeof error === 'string' ? error : undefined
  const hasError = Boolean(error)
  const errorId = errorMessage ? `${describedById}-error` : undefined
  const hintId = hint && !errorMessage ? `${describedById}-hint` : undefined
  const describedBy = errorId || hintId

  return (
    <div className={`space-y-1 ${className} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}>
      {label && (
        <label htmlFor={controlId} className="text-[9px] font-black text-slate-500 uppercase block tracking-widest px-1">
          {label}
        </label>
      )}
      <div className="relative group">
        <select 
          id={controlId}
          value={value} 
          onChange={onChange}
          disabled={disabled}
          aria-invalid={hasError}
          aria-describedby={describedBy}
          className={`
            w-full appearance-none bg-slate-900 border 
            ${hasError ? 'border-rose-500/50 bg-rose-500/5' : 'border-white/10 group-hover:border-white/20'} 
            rounded-lg pl-4 pr-10 py-2.5 text-xs outline-none focus:border-blue-500
            transition-all ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'} 
            ${!value ? 'text-slate-500' : 'text-slate-200'}
          `}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((opt) => (
            <option key={opt.id || opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500 group-hover:text-slate-300 transition-colors">
          <ChevronDown size={14} />
        </div>
      </div>
      {errorMessage ? (
        <p id={errorId} className="px-1 pt-1 text-[9px] font-bold uppercase tracking-wider text-rose-400">
          {errorMessage}
        </p>
      ) : null}
      {hint && !errorMessage ? (
        <p id={hintId} className="px-1 pt-1 text-[9px] font-semibold text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
