import React from 'react'
import { Menu } from '@base-ui/react/menu'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'

export function DropdownMenu({
  label,
  children,
  align = 'end',
  className,
  triggerClassName,
  ariaLabel,
  showChevron = true,
}: {
  label: React.ReactNode
  children?: React.ReactNode
  align?: 'start' | 'center' | 'end'
  className?: string
  triggerClassName?: string
  ariaLabel?: string
  showChevron?: boolean
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        data-slot="dropdown-trigger"
        aria-label={ariaLabel}
        className={cn('inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50', triggerClassName)}
      >
        {label}
        {showChevron && <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align={align} sideOffset={5} className="z-[100] outline-none">
          <Menu.Popup
            data-slot="dropdown-content"
            className={cn('min-w-44 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none data-[open]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:fade-in-0', className)}
          >
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

export function DropdownMenuItem({
  children,
  onSelect,
  label,
  disabled = false,
  destructive = false,
  selected = false,
  className,
}: {
  children?: React.ReactNode
  label: string
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
  selected?: boolean
  className?: string
}) {
  return (
    <Menu.Item
      disabled={disabled}
      onClick={onSelect}
      data-slot="dropdown-item"
      className={cn('flex min-h-8 w-full cursor-default select-none items-center gap-2 rounded-md px-2 text-left text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50', destructive && 'text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive', className)}
    >
      <span className="min-w-0 flex-1">{children ?? label}</span>
      {selected && <Check aria-hidden="true" className="size-3.5" />}
    </Menu.Item>
  )
}
