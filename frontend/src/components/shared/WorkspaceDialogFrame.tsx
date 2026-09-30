import React from 'react'
import { useWorkspaceDialogLayer, WorkspacePortal } from './WorkspaceOverlay'

/** Preserve an established dialog's interior while sharing portal, layering and keyboard behavior. */
export function WorkspaceDialogFrame({ children, onClose, title, className = '' }: {
  children: React.ReactNode
  onClose: () => void
  title: string
  className?: string
}) {
  const dialogProps = useWorkspaceDialogLayer(true, onClose)
  return <WorkspacePortal><div {...dialogProps} role="dialog" aria-modal="true" aria-label={title}
    className={`workspace-dialog-frame fixed inset-0 flex items-center justify-center bg-[var(--overlay-scrim)] p-4 ${className}`}>
    {children}
  </div></WorkspacePortal>
}
