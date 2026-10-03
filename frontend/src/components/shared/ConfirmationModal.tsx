import React from 'react'
import { AlertTriangle, Check, Trash2, HelpCircle } from 'lucide-react'
import { WorkspaceDialogFrame } from './WorkspaceDialogFrame'
import { ToolbarButton } from './LayoutPrimitives'

interface ConfirmationModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'info' | 'warning' | 'success'
}

export const ConfirmationModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title, 
  message, 
  confirmText = 'Confirm Action',
  cancelText = 'Close',
  variant = 'info'
}: ConfirmationModalProps) => {
  if (!isOpen) return null
  const getVariantIcon = () => {
    switch (variant) {
      case 'danger': return <Trash2 size={24} className="text-[var(--state-danger)]" aria-hidden="true" />
      case 'warning': return <AlertTriangle size={24} className="text-[var(--state-warning)]" aria-hidden="true" />
      case 'success': return <Check size={24} className="text-[var(--state-success)]" aria-hidden="true" />
      default: return <HelpCircle size={24} className="text-[var(--action-ink)]" aria-hidden="true" />
    }
  }

  // A confirmation owns no draft. Registering WorkspaceModal's second route
  // blocker here can replace the dirty form's blocker while its question is open.
  return (
    <WorkspaceDialogFrame title={title} onClose={onClose}>
      <div className="max-h-[82vh] w-full max-w-lg space-y-5 overflow-auto rounded-lg border border-[var(--border-default)] bg-[var(--surface-base)] p-5 shadow-2xl sm:p-6">
        <div className="flex items-center gap-3">{getVariantIcon()}<h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2></div>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{message}</p>
        <div className="flex flex-wrap justify-end gap-3">
          <ToolbarButton onClick={onClose}>{cancelText}</ToolbarButton>
          <ToolbarButton onClick={onConfirm} variant={variant === 'danger' ? 'danger' : 'primary'}>{confirmText}</ToolbarButton>
        </div>
      </div>
    </WorkspaceDialogFrame>
  )
}
