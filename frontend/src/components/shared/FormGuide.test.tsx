import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FormGuide, focusFormIssue } from './FormGuide'

describe('Entry guidance', () => {
  it('reveals and focuses the first invalid field even inside optional details', () => {
    const view = render(<div><input aria-label="Valid" /><details><summary>Optional</summary><input aria-label="Invalid" aria-invalid="true" /></details></div>)
    focusFormIssue(view.container)
    expect(view.container.querySelector('details')).toHaveAttribute('open')
    expect(screen.getByLabelText('Invalid')).toHaveFocus()
  })

  it('navigates to optional sections without submitting or discarding the draft', () => {
    const onNavigate = vi.fn()
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(0); return 1 })
    try {
      const view = render(<form><FormGuide summary="Start here" steps={[{ id: 'optional-section', title: 'Details', hint: 'Optional fields', onNavigate }]} /><details><summary>Advanced</summary><section id="optional-section" /></details></form>)
      fireEvent.click(screen.getByRole('button', { name: /Details/ }))
      expect(onNavigate).toHaveBeenCalledOnce()
      expect(view.container.querySelector('details')).toHaveAttribute('open')
      expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
    } finally { frame.mockRestore() }
  })
})
