import React from 'react'
import { WorkspaceTooltip } from './WorkspaceTooltip'

export function OperationalDisabledActionTooltip({
  disabled,
  reason,
  children,
  className,
}: {
  disabled?: boolean
  reason?: string
  children: React.ReactNode
  className?: string
}) {

  if (!disabled || !reason) {
    return <>{children}</>
  }

  return (
    <WorkspaceTooltip
      className={className}
      focusable
      disabledReason
      content={reason}
    >
      {children}
    </WorkspaceTooltip>
  )
}
