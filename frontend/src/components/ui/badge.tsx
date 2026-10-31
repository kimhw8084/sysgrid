import React from 'react'
import { cn } from '../../lib/utils'

export function Badge({
  className,
  variant = 'secondary',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: 'default' | 'secondary' | 'outline' | 'destructive' }) {
  const variantClass = {
    default: 'bg-primary text-primary-foreground',
    secondary: 'bg-secondary text-secondary-foreground',
    outline: 'border border-border text-foreground',
    destructive: 'bg-destructive/10 text-destructive',
  }[variant]
  return (
    <span
      data-slot="badge"
      className={cn('inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-medium leading-none', variantClass, className)}
      {...props}
    />
  )
}
