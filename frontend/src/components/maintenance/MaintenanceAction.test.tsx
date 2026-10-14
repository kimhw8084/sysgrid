import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../../api/apiClient'
import { MaintenanceAction } from './MaintenanceAction'
import { type OperationalAction } from './maintenanceContract'

vi.mock('../../api/apiClient', () => ({ apiFetch: vi.fn(), getRequestScopeKey: () => 'tenant-test' }))
const base = {
  id: 'action-1', actor_id: 'owner', action_key: 'telemetry.snapshot', adapter_id: 'simulation.recording.v1', status: 'CONFIRMED', risk_tier: 'ROUTINE',
  requested_at: '2026-10-02T00:00:00Z', preview_token: 'a'.repeat(64), preview_expires_at: '2099-01-01T00:00:00Z',
  progress_percent: 0, progress_message: '', maintenance_window_id: null, normalized_parameters: {}, change_context: { title: 'Owned action' },
  risk_facts: {}, precondition_snapshot: {}, rollback_plan: { available: true }, execution_result: {}, rollback_outcome: {},
  verification_summary: null, approval_facts: {}, recovery_facts: {}, targets: [], history: [], evidence: [], attempts: [],
} satisfies OperationalAction
const reply = (data: unknown) => new Response(JSON.stringify(data), { status: 200 })
function mount(action: OperationalAction, actorId = 'owner', canWrite = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  client.setQueryData(['maintenance-action', 'tenant-test', action.id], action)
  const router = createMemoryRouter([{ path: '*', element: <QueryClientProvider client={client}><MaintenanceAction id={action.id} actorId={actorId} canWrite={canWrite} /></QueryClientProvider> }])
  render(<RouterProvider router={router} />)
  return client
}
beforeEach(() => vi.mocked(apiFetch).mockReset())
afterEach(() => cleanup())

describe('maintenance action trust and recovery', () => {
  it.each([['another-actor', true], ['owner', false]])('does not expose execution to actor %s with write=%s', (actor, write) => {
    mount(base, actor as string, write as boolean)
    expect(screen.queryByRole('button', { name: 'Execute simulation' })).not.toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('cancels execution without sending a write', async () => {
    mount(base)
    fireEvent.click(screen.getByRole('button', { name: 'Execute simulation' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('requires a server refresh after an uncertain execution and never automatically retries it', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(Object.assign(new Error('Connection interrupted'), { status: 0 })).mockResolvedValueOnce(reply({ ...base, status: 'SUCCEEDED' }))
    mount(base)
    fireEvent.click(screen.getByRole('button', { name: 'Execute simulation' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh the recorded state')
    expect(screen.getByRole('button', { name: 'Execute simulation' })).toBeDisabled()
    expect(apiFetch).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh recorded state' }))
    expect(await screen.findByRole('button', { name: 'Record verification' })).toBeVisible()
    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(vi.mocked(apiFetch).mock.calls[1][1]?.method).toBeUndefined()
  })

  it('reconciles an interrupted attempt by its durable identity without executing again', async () => {
    const interrupted: OperationalAction = { ...base, status: 'EXECUTING', attempts: [{ id: 'attempt-existing', phase: 'EXECUTION', status: 'CLAIMED', progress_percent: 10, progress_message: 'Intent recorded', result: {} }] }
    vi.mocked(apiFetch).mockResolvedValue(reply({ ...interrupted, status: 'RECOVERY_REQUIRED', attempts: [{ ...interrupted.attempts[0], status: 'OUTCOME_UNKNOWN' }] }))
    mount(interrupted)
    expect(screen.queryByRole('button', { name: 'Execute simulation' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reconcile execution' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('recovery required'))
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toBe('/api/v1/operational-actions/action-1/reconcile')
    expect(JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body))).toMatchObject({ attempt_id: 'attempt-existing', phase: 'EXECUTION' })
  })

  it('does not retain a canceled rollback reason for a later attempt', async () => {
    vi.mocked(apiFetch).mockResolvedValue(reply({ ...base, status: 'ROLLED_BACK' }))
    mount({ ...base, status: 'SUCCEEDED' })
    fireEvent.change(screen.getByLabelText('Outcome summary / rollback reason *'), { target: { value: 'Canceled reason' } })
    fireEvent.click(screen.getByRole('button', { name: 'Roll back simulation' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })) })
    fireEvent.change(screen.getByLabelText('Outcome summary / rollback reason *'), { target: { value: 'Reviewed final reason' } })
    fireEvent.click(screen.getByRole('button', { name: 'Roll back simulation' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body)).reason).toBe('Reviewed final reason')
  })
})
