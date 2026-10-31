import React from 'react'
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import { cn } from '../../lib/utils'

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <BaseTooltip.Provider delay={500} closeDelay={80}>{children}</BaseTooltip.Provider>
}

export function Tooltip({
  children,
  content,
  side = 'top',
  align = 'center',
  className,
}: {
  children: React.ReactElement
  content: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  className?: string
}) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} align={align} sideOffset={6} className="z-[9000]">
          <BaseTooltip.Popup
            data-slot="tooltip-content"
            className={cn('max-w-72 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs font-medium leading-4 text-popover-foreground shadow-md', className)}
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}
