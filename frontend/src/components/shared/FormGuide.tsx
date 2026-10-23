import React from 'react'
import { Check, ChevronRight } from 'lucide-react'

export type FormGuideStep = {
  id: string
  title: string
  hint: string
  tone?: 'blue' | 'teal' | 'violet' | 'amber'
  complete?: boolean
  onNavigate?: () => void
}

export function revealFormSection(id: string) {
  const element = document.getElementById(id)
  if (!element) return
  let parent = element.parentElement
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true
    parent = parent.parentElement
  }
  element.scrollIntoView?.({ block: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  element.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])')?.focus({ preventScroll: true })
}

export function focusFormIssue(root: HTMLElement | null) {
  const target = root?.querySelector<HTMLElement>('[aria-invalid="true"]')
  if (!target) return
  let parent = target.parentElement
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true
    parent = parent.parentElement
  }
  target.scrollIntoView?.({ block: 'nearest', behavior: 'auto' })
  target.focus({ preventScroll: true })
}

export function FormGuide({ steps, summary }: { steps: FormGuideStep[]; summary: React.ReactNode }) {
  const id = React.useId()
  return <div className="form-guide">
    <div className="form-guide-summary">{summary}</div>
    <nav aria-label="Form guide" className="form-guide-steps">
      {steps.map((step, index) => <button key={step.id} type="button" data-tone={step.tone || 'blue'}
        aria-label={`${step.title}${step.complete ? '. Complete' : ''}`}
        aria-describedby={`${id}-${index}-hint`}
        className="form-guide-step" onClick={() => {
          step.onNavigate?.()
          requestAnimationFrame(() => revealFormSection(step.id))
        }}>
        <span className="form-guide-number" aria-hidden="true">{step.complete ? <Check size={15} /> : index + 1}</span>
        <span><strong>{step.title}</strong><small id={`${id}-${index}-hint`}>{step.hint}</small></span>
        <ChevronRight size={14} aria-hidden="true" />
      </button>)}
    </nav>
  </div>
}
