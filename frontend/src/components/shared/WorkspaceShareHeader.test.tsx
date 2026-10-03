import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import toast from 'react-hot-toast'
import { WorkspaceShareHeader } from './WorkspaceShareHeader'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const originalUrl = location.href
afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
  history.replaceState(null, '', originalUrl)
  vi.clearAllMocks()
})

function clipboard(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText ? { writeText } : undefined })
}

describe('direct-link clipboard feedback', () => {
  it('waits for success, writes once, and keeps the existing URL context without submitting a form', async () => {
    let resolve!: () => void
    const write = vi.fn((_text: string) => new Promise<void>(done => { resolve = done }))
    clipboard(write)
    history.replaceState(null, '', '/network?view=saved&id=old#details')
    const submitted = vi.fn(event => event.preventDefault())
    render(<form onSubmit={submitted}><WorkspaceShareHeader id="27" title="Link A" /></form>)
    const button = screen.getByRole('button', { name: 'Share direct link' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(write).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(submitted).not.toHaveBeenCalled()
    expect(write.mock.calls[0][0]).toBe(`${location.origin}/network?view=saved&id=27#details`)
    expect(location.search).toBe('?view=saved&id=old')
    await act(async () => { resolve() })
    expect(button).toBeEnabled()
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('reports denied clipboard access without success and permits a later retry', async () => {
    const write = vi.fn().mockRejectedValueOnce(new DOMException('Private browser reason', 'NotAllowedError')).mockResolvedValueOnce(undefined)
    clipboard(write)
    render(<WorkspaceShareHeader id="0" title="Zero" />)
    const button = screen.getByRole('button', { name: 'Share direct link' })
    await act(async () => { fireEvent.click(button) })
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Could not copy the link. Check clipboard access and try again.', { id: expect.any(String) })
    expect(button).toBeEnabled()
    await act(async () => { fireEvent.click(button) })
    expect(write).toHaveBeenCalledTimes(2)
    expect(new URL(write.mock.calls[1][0]).searchParams.get('id')).toBe('0')
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('Direct link copied to clipboard', vi.mocked(toast.error).mock.calls[0][1])
  })

  it('handles an unavailable clipboard without a false success', async () => {
    clipboard()
    render(<WorkspaceShareHeader id="7" title="Unavailable" />)
    const button = screen.getByRole('button', { name: 'Share direct link' })
    await act(async () => { fireEvent.click(button) })
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(button).toBeEnabled()
  })

  it('handles synchronous browser errors without leaving the control busy', async () => {
    clipboard(() => { throw new Error('Clipboard unavailable') })
    render(<WorkspaceShareHeader id="7" title="Unavailable" />)
    const button = screen.getByRole('button', { name: 'Share direct link' })
    await act(async () => { fireEvent.click(button) })
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(button).toBeEnabled()
  })
})
