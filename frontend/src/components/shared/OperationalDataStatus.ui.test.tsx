import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DataStatusPill, { DataDiagnosticModal } from './OperationalDataStatus'
import toast from 'react-hot-toast'
import { showWorkspaceToast, WorkspaceToaster } from './WorkspaceToast'

// These cases exercise the diagnostic content; real modal/keyboard behavior is
// covered by the production-build browser workflow.
vi.mock('./WorkspaceModal', () => ({ WorkspaceModal: ({ isOpen, title, children }: any) => isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null }))

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
afterEach(() => {
  toast.remove()
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
})
const detail = { endpoint: '/actual', status: 503, message: 'Unavailable', rawBody: 'Exact response', data: { id: '001' } }
function clipboard(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText ? { writeText } : undefined })
}
async function open(errorDetail: any = detail) {
  const view = render(<DataDiagnosticModal isOpen onClose={() => {}} errorDetail={errorDetail} />)
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Diagnostic Information' })).toBeVisible())
  return view
}

describe('operational diagnostic feedback', () => {
  it('consumes only the matching summary notice when the full report opens', async () => {
    showWorkspaceToast(detail.message, { type: 'error' })
    showWorkspaceToast('Unrelated error', { type: 'error' })
    const view = render(<><WorkspaceToaster /><DataDiagnosticModal isOpen={false} onClose={() => {}} errorDetail={detail} /></>)
    const notices = within(screen.getByRole('region', { name: 'Notifications' }))
    expect(notices.getByText(detail.message)).toBeVisible()
    view.rerender(<><WorkspaceToaster /><DataDiagnosticModal isOpen onClose={() => {}} errorDetail={detail} /></>)
    expect(notices.queryByText(detail.message)).not.toBeInTheDocument()
    expect(notices.getByText('Unrelated error')).toBeVisible()
  })

  it('writes the exact report once and reports success only when clipboard resolves', async () => {
    let resolve!: () => void
    const write = vi.fn((_text: string) => new Promise<void>(done => { resolve = done }))
    clipboard(write)
    await open()
    const button = screen.getByRole('button', { name: 'Copy Diagnostics' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(JSON.stringify(detail, null, 2))
    expect(button).toBeDisabled()
    expect(screen.queryByText('Diagnostics copied.')).not.toBeInTheDocument()
    await act(async () => { resolve() })
    expect(button).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('Diagnostics copied.')
  })

  it('contains denied access, exposes the exact manual report and replaces failure on retry', async () => {
    const write = vi.fn().mockRejectedValueOnce(new DOMException('private browser reason', 'NotAllowedError')).mockResolvedValueOnce(undefined)
    clipboard(write)
    await open()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy Diagnostics' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not copy diagnostics. Select the report below to copy it manually, or try again.')
    expect(screen.getByRole('textbox', { name: 'Diagnostics for manual copy' })).toHaveValue(JSON.stringify(detail, null, 2))
    expect(screen.queryByText('private browser reason')).not.toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy Diagnostics' })) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Diagnostics copied.')
  })

  it.each(['unavailable', 'synchronous'] as const)('handles %s clipboard access without a false success', async mode => {
    clipboard(mode === 'unavailable' ? undefined : () => { throw new Error('private failure') })
    await open()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy Diagnostics' })) })
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copy Diagnostics' })).toBeEnabled()
    expect(screen.queryByText('Diagnostics copied.')).not.toBeInTheDocument()
  })

  it('does not carry a late success into a reopened or changed report', async () => {
    let resolve!: () => void
    clipboard(() => new Promise<void>(done => { resolve = done }))
    const view = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Diagnostics' }))
    view.rerender(<DataDiagnosticModal isOpen={false} onClose={() => {}} errorDetail={detail} />)
    const next = { ...detail, endpoint: '/next' }
    view.rerender(<DataDiagnosticModal isOpen onClose={() => {}} errorDetail={next} />)
    await act(async () => { resolve() })
    expect(screen.queryByText('Diagnostics copied.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy Diagnostics' })).toBeEnabled()
  })

  it('labels missing diagnostic evidence explicitly instead of inventing endpoint or identities', async () => {
    await open({ message: 'Unknown source' })
    expect(screen.queryByText('/api/v1/monitoring?include_deleted=true')).not.toBeInTheDocument()
    expect(screen.queryByText('admin_root')).not.toBeInTheDocument()
    expect(screen.queryByText('1', { exact: true })).not.toBeInTheDocument()
    expect(screen.getAllByText('Not captured')).toHaveLength(2)
  })

  it('opens the diagnostic pill without submitting a containing form', () => {
    const submit = vi.fn(event => event.preventDefault())
    const click = vi.fn()
    render(<form onSubmit={submit}><DataStatusPill status="error" onClick={click} errorDetail={{ status: 503 }} /></form>)
    fireEvent.click(screen.getByRole('button', { name: 'Data error 503' }))
    expect(click).toHaveBeenCalledTimes(1)
    expect(submit).not.toHaveBeenCalled()
  })
})
