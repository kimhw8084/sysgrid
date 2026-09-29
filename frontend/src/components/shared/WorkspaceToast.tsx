import React, { useEffect, useState } from 'react'
import { toast, Toast } from 'react-hot-toast'
import { X, RotateCcw, AlertTriangle, Check } from 'lucide-react'

interface WorkspaceToastProps {
  t: Toast
  message: string
  onRevert?: () => void
  type?: 'success' | 'error' | 'loading'
}

type WorkspaceToastOptions = {
  onRevert?: () => void
  type?: 'success' | 'error' | 'loading'
}

export const WorkspaceToast = ({ t, message, onRevert, type = 'success' }: WorkspaceToastProps) => {
  const [isConfirmingRevert, setIsConfirmingRevert] = useState(false)
  const [progress, setProgress] = useState(100)
  const duration = t.duration || 2000
  
  useEffect(() => {
    if (!t.visible) return
    
    const startTime = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100)
      setProgress(remaining)
      if (remaining <= 0) {
        clearInterval(interval)
        toast.dismiss(t.id)
      }
    }, 50)

    return () => clearInterval(interval)
  }, [t.visible, duration, t.id])

  return (
    <div
      className={`${
        t.visible ? 'animate-enter' : 'animate-leave'
      } max-w-md w-full bg-[#0f172a]/95 backdrop-blur-xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] rounded-lg pointer-events-auto flex flex-col overflow-hidden transition-all duration-300`}
    >
      <div className="flex items-center p-4">
        <div className="flex-shrink-0 pt-0.5">
          {type === 'success' ? (
            <div className="h-8 w-8 rounded-lg bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
              <Check size={16} className="text-emerald-400" />
            </div>
          ) : type === 'error' ? (
            <div className="h-8 w-8 rounded-lg bg-rose-500/20 flex items-center justify-center border border-rose-500/30">
              <AlertTriangle size={16} className="text-rose-400" />
            </div>
          ) : (
            <div className="h-8 w-8 rounded-lg bg-blue-500/20 flex items-center justify-center border border-blue-500/30 animate-pulse">
              <div className="h-3 w-3 bg-blue-400 rounded-full" />
            </div>
          )}
        </div>
        <div className="ml-3 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-100">
            {type === 'success' ? 'Operation Success' : type === 'error' ? 'System Error' : 'Processing...'}
          </p>
          <p className="mt-1 text-[12px] font-bold text-slate-400 leading-snug">
            {message}
          </p>
        </div>
        <div className="ml-4 flex-shrink-0 flex gap-2">
          {onRevert && (
            <button
              onClick={() => {
                if (isConfirmingRevert) {
                  onRevert()
                  toast.dismiss(t.id)
                } else {
                  setIsConfirmingRevert(true)
                }
              }}
              onBlur={() => setIsConfirmingRevert(false)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-black uppercase tracking-tighter transition-all ${
                isConfirmingRevert 
                  ? 'bg-rose-500/20 border-rose-500/40 text-rose-300 hover:bg-rose-500/30' 
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <RotateCcw size={12} className={isConfirmingRevert ? 'animate-spin' : ''} />
              {isConfirmingRevert ? 'Confirm Undo?' : 'Revert'}
            </button>
          )}
          
          <button
            onClick={() => toast.dismiss(t.id)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white transition-all"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Progress Bar Gauge */}
      <div className="h-0.5 w-full bg-white/5 overflow-hidden">
        <div 
          className={`h-full transition-all duration-75 ease-linear ${type === 'success' ? 'bg-emerald-500' : type === 'error' ? 'bg-rose-500' : 'bg-blue-500'}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}

export const showWorkspaceToast = (message: string, options?: WorkspaceToastOptions) => {
  // Source of truth: operational workspace toast behavior.
  // Use message as ID to ensure uniqueness for this specific message
  toast.dismiss(message);
  
  toast.custom((t) => (
    <WorkspaceToast 
      t={t} 
      message={message} 
      onRevert={options?.onRevert} 
      type={options?.type} 
    />
  ), {
    duration: options?.onRevert ? 5000 : 2000,
    position: 'top-right',
    id: message 
  })
}

export const dismissWorkspaceToasts = () => toast.dismiss()

export const showWorkspaceRevertToast = (message: string, onRevert: () => void) => (
  showWorkspaceToast(message, { onRevert, type: 'success' })
)
