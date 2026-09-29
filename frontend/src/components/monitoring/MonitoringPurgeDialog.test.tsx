import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MonitoringPurgeDialog } from './MonitoringPurgeDialog'
import { apiFetch } from '../../api/apiClient'

vi.mock('../../api/apiClient', () => ({ apiFetch: vi.fn() }))
vi.mock('../shared/WorkspaceToast', () => ({ showWorkspaceToast: vi.fn() }))
const fetchMock = vi.mocked(apiFetch)
const preview = (id: number) => ({ action: 'purge', selected_ids: [id], selected_count: 1, matched_count: 1,
  changed_count: 1, unchanged_count: 0, blocked_count: 0, missing_count: 0, changed_ids: [id],
  unchanged_ids: [], missing_ids: [], blockers: [], can_execute: true, precondition: 'a'.repeat(64),
  purge_impact: { permanent: true, recovery_supported: false, aggregate: { monitoring_count: 1,
    delete_count: 1, detach_count: 0, deletes: [{ table: 'monitoring_items', type: 'Monitoring records', count: 1, disposition: 'explicit_delete' }], detaches: [] } } })
const response = (body: unknown) => ({ json: async () => body }) as Response
const deferred = () => {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>(done => { resolve = done })
  return { promise, resolve }
}

describe('Monitoring permanent purge', () => {
  beforeEach(() => { vi.clearAllMocks(); fetchMock.mockReset() })

  it('requires a complete preview and sends its precondition; receipt has no Undo', async () => {
    fetchMock.mockResolvedValueOnce(response(preview(7))).mockResolvedValueOnce(response({ ...preview(7), status: 'success', can_revert: false }))
    const purged = vi.fn()
    const pending = { current: new Set<number>() }
    const router = createMemoryRouter([{ path: '/', element: <MonitoringPurgeDialog ids={[7]} pendingIds={pending} onClose={() => {}} onPurged={purged} /> }])
    render(<RouterProvider router={router} />)
    const confirm = screen.getByRole('button', { name: 'Confirm Permanent purge' })
    expect(confirm).toBeDisabled()
    await waitFor(() => expect(confirm).toBeEnabled())
    await waitFor(() => expect(screen.getByText('This purge cannot be restored or reverted.')).toBeVisible())
    fireEvent.click(confirm)
    await screen.findByRole('heading', { name: 'Monitoring bulk complete' })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ ids: [7], action: 'purge', precondition: 'a'.repeat(64) })
    expect(purged).toHaveBeenCalledWith([7])
    expect(screen.queryByRole('button', { name: /Undo|Revert/ })).toBeNull()
    expect(pending.current.size).toBe(0)
  })

  it('rejects an incomplete preview and an overlapping in-flight recovery', async () => {
    fetchMock.mockResolvedValueOnce(response({ ...preview(7), precondition: undefined })).mockResolvedValueOnce(response(preview(7)))
    const router = createMemoryRouter([{ path: '/', element: <MonitoringPurgeDialog ids={[7]} pendingIds={{ current: new Set([7]) }} onClose={() => {}} onPurged={() => {}} /> }])
    render(<RouterProvider router={router} />)
    await screen.findByText('The server did not return a complete permanent-purge preview.')
    expect(screen.getByRole('button', { name: 'Confirm Permanent purge' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Review fresh preview' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm Permanent purge' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Permanent purge' }))
    await screen.findByText(/Another operation on this monitor is still pending/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('ignores late A→B→A preview responses', async () => {
    const first = deferred(), second = deferred(), third = deferred()
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)
    let setIds!: (ids: number[]) => void
    const React = await import('react')
    function Host() {
      const [ids, update] = React.useState([1]); setIds = update
      return <MonitoringPurgeDialog ids={ids} pendingIds={React.useRef(new Set<number>())} onClose={() => {}} onPurged={() => {}} />
    }
    const router = createMemoryRouter([{ path: '/', element: <Host /> }])
    render(<RouterProvider router={router} />)
    act(() => setIds([2])); act(() => setIds([1]))
    await act(async () => third.resolve(response({ ...preview(1), precondition: 'c'.repeat(64) })))
    await act(async () => { first.resolve(response(preview(1))); second.resolve(response(preview(2))) })
    fetchMock.mockResolvedValueOnce(response({ ...preview(1), can_revert: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Permanent purge' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body)).precondition).toBe('c'.repeat(64))
  })

  it('uses the current workspace callback when a dismissed purge finishes after navigation', async () => {
    const held = deferred()
    fetchMock.mockResolvedValueOnce(response(preview(7))).mockReturnValueOnce(held.promise)
    const before = vi.fn(), after = vi.fn()
    let navigate!: () => void
    const React = await import('react')
    function Host() {
      const [moved, setMoved] = React.useState(false)
      navigate = () => setMoved(true)
      return <MonitoringPurgeDialog ids={moved ? null : [7]} pendingIds={React.useRef(new Set<number>())} onClose={() => {}} onPurged={moved ? after : before} />
    }
    const router = createMemoryRouter([{ path: '/', element: <Host /> }])
    render(<RouterProvider router={router} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm Permanent purge' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Permanent purge' }))
    act(() => navigate())
    await act(async () => held.resolve(response({ ...preview(7), can_revert: false })))
    expect(before).not.toHaveBeenCalled()
    expect(after).toHaveBeenCalledWith([7])
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
