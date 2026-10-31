import React from 'react'
import { cn } from '../../lib/utils'

export function Card({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section data-slot="card" className={cn('rounded-xl border border-border bg-card text-card-foreground shadow-sm', className)} {...props} />
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <header data-slot="card-header" className={cn('flex flex-col gap-1.5 p-4', className)} {...props} />
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 data-slot="card-title" className={cn('text-sm font-semibold leading-tight tracking-tight', className)} {...props} />
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p data-slot="card-description" className={cn('text-sm leading-relaxed text-muted-foreground', className)} {...props} />
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-content" className={cn('px-4 pb-4', className)} {...props} />
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <footer data-slot="card-footer" className={cn('flex items-center gap-2 border-t border-border bg-muted/50 p-4', className)} {...props} />
}
