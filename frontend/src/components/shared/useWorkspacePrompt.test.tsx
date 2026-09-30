import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspacePrompt } from './useWorkspacePrompt'

describe('workspace input prompt', () => {
  it('requires an answer, submits once, and cancels without returning a value', async () => {
    const result = vi.fn()
    function Harness() {
      const { ask, promptDialog } = useWorkspacePrompt()
      return <><button onClick={async () => result(await ask({ title: 'New task', label: 'Task name' }))}>Open</button>{promptDialog}</>
    }
    render(<Harness />)
    fireEvent.click(screen.getByText('Open'))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Task name'), { target: { value: '  Maintenance  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await Promise.resolve()
    expect(result).toHaveBeenCalledExactlyOnceWith('Maintenance')
    fireEvent.click(screen.getByText('Open'))
    fireEvent.keyDown(window, { key: 'Escape' })
    await Promise.resolve()
    expect(result).toHaveBeenLastCalledWith(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('distinguishes an optional blank answer from cancellation', async () => {
    const result = vi.fn()
    function Harness() {
      const { ask, promptDialog } = useWorkspacePrompt()
      return <><button onClick={async () => result(await ask({ title: 'Review date', label: 'Date', type: 'date', optional: true }))}>Open</button>{promptDialog}</>
    }
    render(<Harness />)
    fireEvent.click(screen.getByText('Open'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await Promise.resolve()
    expect(result).toHaveBeenCalledExactlyOnceWith('')
  })
})
