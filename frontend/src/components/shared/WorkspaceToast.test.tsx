import { fireEvent, render, screen } from '@testing-library/react'
import type { Toast } from 'react-hot-toast'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceToast } from './WorkspaceToast'

vi.mock('react-hot-toast', () => ({ toast: { dismiss: vi.fn(), custom: vi.fn() }, useToasterStore: () => ({ pausedAt: undefined }) }))

describe('recovery toast confirmation', () => {
  it('keeps confirmation armed during pointer movement and completes exactly once', () => {
    const revert = vi.fn()
    render(<WorkspaceToast t={{ id: 'recovery', visible: true, duration: 5000 } as Toast} message="Archived record" onRevert={revert} />)
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    const confirm = screen.getByRole('button', { name: 'Confirm Undo?' })
    // A label-width change or pointer motion must not cancel the armed click.
    fireEvent.mouseLeave(confirm)
    expect(confirm).toHaveTextContent('Confirm Undo?')
    expect(revert).not.toHaveBeenCalled()
    fireEvent.click(confirm)
    expect(revert).toHaveBeenCalledTimes(1)
  })

  it('disarms confirmation when focus moves to another control', () => {
    const revert = vi.fn()
    render(<WorkspaceToast t={{ id: 'recovery', visible: true, duration: 5000 } as Toast} message="Archived record" onRevert={revert} />)
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    fireEvent.blur(screen.getByRole('button', { name: 'Confirm Undo?' }))
    expect(screen.getByRole('button', { name: 'Revert' })).toBeInTheDocument()
    expect(revert).not.toHaveBeenCalled()
  })
})
