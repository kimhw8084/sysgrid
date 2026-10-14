import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../../api/apiClient'
import { CredentialValue, credentialUpdatePayload } from './CredentialValue'

vi.mock('../../api/apiClient', () => ({ apiFetch: vi.fn() }))
const response = () => new Response(JSON.stringify({ value: 'synthetic-revealed-value' }), { status: 200 })
const props = { deviceId: 1, secretId: 2, canReveal: true, hasPayload: true }

beforeEach(() => vi.mocked(apiFetch).mockReset())
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('CredentialValue', () => {
  it('fetches only on explicit reveal and discards the value when hidden', async () => {
    vi.mocked(apiFetch).mockResolvedValue(response())
    render(<CredentialValue {...props} />)
    expect(apiFetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reveal credential' }))
    expect(await screen.findByText('synthetic-revealed-value')).toBeVisible()
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/devices/1/secrets/2/reveal', expect.objectContaining({ method: 'POST', cache: 'no-store' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide credential' }))
    expect(screen.queryByText('synthetic-revealed-value')).not.toBeInTheDocument()
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('discards values after thirty seconds and on focus loss', async () => {
    vi.useFakeTimers()
    vi.mocked(apiFetch).mockImplementation(async () => response())
    render(<CredentialValue {...props} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reveal credential' })) })
    expect(screen.getByText('synthetic-revealed-value')).toBeVisible()
    act(() => vi.advanceTimersByTime(30_000))
    expect(screen.queryByText('synthetic-revealed-value')).not.toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reveal credential' })) })
    fireEvent(window, new Event('blur'))
    expect(screen.queryByText('synthetic-revealed-value')).not.toBeInTheDocument()
  })

  it('aborts an old request when the asset changes and ignores its late result', async () => {
    let finish!: (value: Response) => void
    vi.mocked(apiFetch).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const { rerender } = render(<CredentialValue {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reveal credential' }))
    const signal = vi.mocked(apiFetch).mock.calls[0][1]?.signal as AbortSignal
    rerender(<CredentialValue {...props} deviceId={3} />)
    expect(signal.aborted).toBe(true)
    await act(async () => finish(response()))
    expect(screen.queryByText('synthetic-revealed-value')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reveal credential' })).toBeEnabled()
  })

  it('denies reveal in the UI when permission is absent', () => {
    render(<CredentialValue {...props} canReveal={false} />)
    const button = screen.getByRole('button', { name: 'Reveal credential' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('keeps failure visible and supports a new authorized attempt', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(response())
    render(<CredentialValue {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reveal credential' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to reveal')
    fireEvent.click(screen.getByRole('button', { name: 'Reveal credential' }))
    await waitFor(() => expect(screen.getByText('synthetic-revealed-value')).toBeVisible())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

it('omits an unedited value and record identity from metadata updates', () => {
  const draft = { id: 123, secret_type: 'SSH Key', username: 'owner', notes: 'note', encrypted_payload: '' }
  expect(credentialUpdatePayload(draft)).toEqual({ secret_type: 'SSH Key', username: 'owner', notes: 'note' })
  expect(credentialUpdatePayload({ ...draft, encrypted_payload: 'replacement' }).encrypted_payload).toBe('replacement')
})
