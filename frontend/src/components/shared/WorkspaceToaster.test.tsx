import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import toast from 'react-hot-toast'
import { WorkspaceToaster, showWorkspaceToast } from './WorkspaceToast'

beforeEach(() => { vi.useFakeTimers(); act(() => toast.remove()) })
afterEach(() => { act(() => toast.remove()); vi.useRealTimers() })
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const visible = () => document.querySelectorAll('[data-workspace-toast][data-visible="true"]')

describe('unified notifications', () => {
  it('continues delivering and dismissing messages after earlier cards unmount', () => {
    render(<WorkspaceToaster />)
    act(() => { toast.success('First notice'); showWorkspaceToast('Second notice', { onRevert: vi.fn() }) })
    advance(4100)
    advance(1100)
    expect(screen.queryByText('First notice')).not.toBeInTheDocument()
    act(() => toast.error('New error after unmount'))
    expect(screen.getByText('New error after unmount')).toBeInTheDocument()
    act(() => toast.dismiss())
    expect(visible()).toHaveLength(0)
    advance(1100)
    expect(screen.queryByRole('button', { name: 'Revert' })).not.toBeInTheDocument()
  })
  it('uses the same gauge and accessible dismiss for ordinary and custom messages', () => {
    render(<WorkspaceToaster />)
    act(() => { toast.success('Saved'); toast.error('Unavailable'); toast('Copied'); showWorkspaceToast('Restorable', { onRevert: vi.fn() }) })
    expect(visible()).toHaveLength(4)
    expect(document.querySelectorAll('[data-toast-gauge]')).toHaveLength(4)
    expect(screen.getAllByRole('button', { name: 'Dismiss notification' })).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Revert' })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss notification' })[0])
    expect(visible()).toHaveLength(3)
  })

  it('pauses both the expiry and gauge while hovered or focused, without double-counting pause time', () => {
    render(<WorkspaceToaster />)
    act(() => toast.success('Pause me'))
    advance(1000)
    const gauge = document.querySelector('[data-toast-gauge] > div') as HTMLElement
    expect(parseFloat(gauge.style.width)).toBe(75)
    const stack = screen.getByRole('region', { name: 'Notifications' })
    fireEvent.mouseEnter(stack)
    advance(500)
    fireEvent.focus(screen.getByRole('button', { name: 'Dismiss notification' }))
    advance(10000)
    fireEvent.mouseLeave(stack)
    expect(visible()).toHaveLength(1)
    expect(parseFloat(gauge.style.width)).toBe(75)
    fireEvent.blur(screen.getByRole('button', { name: 'Dismiss notification' }), { relatedTarget: document.body })
    advance(2900)
    expect(visible()).toHaveLength(1)
    advance(200)
    expect(visible()).toHaveLength(0)
  })

  it('keeps a promise loading until resolution and restarts the completed gauge', async () => {
    render(<WorkspaceToaster />)
    let resolve!: () => void
    const pending = new Promise<void>((done) => { resolve = done })
    act(() => { toast.promise(pending, { loading: 'Saving', success: 'Saved', error: 'Failed' }) })
    advance(12000)
    expect(document.querySelector('[data-workspace-toast="loading"]')).toHaveAttribute('data-visible', 'true')
    await act(async () => resolve())
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(document.querySelector('[data-toast-gauge] > div')).toHaveStyle({ width: '100%' })
  })

  it('prevents duplicate reverts, retains failed recovery, then dismisses only after success', async () => {
    render(<WorkspaceToaster />)
    let reject!: (error: Error) => void
    const revert = vi.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail })).mockResolvedValueOnce(undefined)
    act(() => showWorkspaceToast('Archived', { onRevert: revert }))
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Undo?' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reverting…' }))
    advance(12000)
    expect(revert).toHaveBeenCalledTimes(1)
    expect(visible()).toHaveLength(1)
    await act(async () => reject(new Error('Connection lost. Retry.')))
    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost. Retry.')
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm Undo?' })))
    expect(revert).toHaveBeenCalledTimes(2)
    expect(visible()).toHaveLength(0)
  })
})
