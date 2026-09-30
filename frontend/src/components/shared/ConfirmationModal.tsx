import React from 'react'
import { AlertTriangle, Check, Trash2, HelpCircle } from 'lucide-react'
import { WorkspaceModal } from './WorkspaceModal'

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
  const getVariantIcon = () => {
    switch (variant) {
      case 'danger': return <Trash2 size={24} className="text-rose-500" />
      case 'warning': return <AlertTriangle size={24} className="text-amber-500" />
      case 'success': return <Check size={24} className="text-emerald-500" />
      default: return <HelpCircle size={24} className="text-blue-500" />
    }
  }

  const getVariantColor = () => {
    switch (variant) {
      case 'danger': return 'bg-rose-700 hover:bg-rose-800 shadow-rose-500/20'
      case 'warning': return 'bg-amber-800 hover:bg-amber-900 shadow-amber-500/20'
      case 'success': return 'bg-emerald-700 hover:bg-emerald-800 shadow-emerald-500/20'
      default: return 'bg-[var(--action-primary)] hover:bg-[var(--action-primary-hover)]'
    }
  }

  return (
    <WorkspaceModal
      isOpen={isOpen}
      onClose={onClose}
      size="compact"
      title={title}
      icon={getVariantIcon()}
      hideCloseButton={true}
      hideFooterClose={true}
      footerRight={(
        <>
          <button 
            type="button"
            onClick={onClose} 
            className="rounded-lg border border-white/10 bg-black/20 px-4 py-2 text-[10px] font-black uppercase text-slate-500 transition-all hover:text-white"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-lg px-6 py-2 ${getVariantColor()} text-[10px] font-black uppercase text-white shadow-lg transition-all active:scale-95`}
          >
            {confirmText}
          </button>
        </>
      )}
    >
      <div className="py-4">
        <p className="text-[11px] font-bold leading-relaxed text-slate-400">
          {message}
        </p>
      </div>
    </WorkspaceModal>
  )
}
