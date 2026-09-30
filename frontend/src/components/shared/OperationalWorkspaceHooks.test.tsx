import React from 'react'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { Link, createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { useOperationalDetailRoute, useWorkspaceOverlayController } from './OperationalWorkspaceHooks'
import { WorkspaceModal } from './WorkspaceModal'

function DirtyModalHarness({ isDirty }: { isDirty: boolean }) {
  return (
    <div>
      <Link to="/other">Go other</Link>
      <WorkspaceModal
        isOpen={true}
        onClose={() => {}}
        title="Dirty Form"
        hideCloseButton
        hideFooterClose
        isDirty={isDirty}
        dirtyConfirmText="Discard Changes"
      >
        <div>Editing</div>
      </WorkspaceModal>
    </div>
  )
}

function OtherPage() {
  return <div>Other page</div>
}

function DetailRouteHarness() {
  const [detailItem, setDetailItem] = React.useState<any>(null)
  const items = React.useMemo(() => ([
    { id: 1, name: 'Service One', is_deleted: false },
    { id: 2, name: 'Service Two', is_deleted: false },
  ]), [])

  const detailRoute = useOperationalDetailRoute({
    allItems: items,
    detailItem,
    setDetailItem,
  })

  return (
    <div>
      <button type="button" onClick={() => detailRoute.openDetail(items[0], { replace: false })}>
        Open detail
      </button>
      <button type="button" onClick={() => detailRoute.closeDetail()}>
        Close detail
      </button>
      <div data-testid="detail-state">{detailItem ? String(detailItem.id) : 'none'}</div>
    </div>
  )
}

function AsyncDetailRouteHarness({
  fetchDetailItem,
}: {
  fetchDetailItem: (id: string) => Promise<any>
}) {
  const [detailItem, setDetailItem] = React.useState<any>({ id: 2, name: 'Stale detail' })
  const items = React.useMemo(() => ([
    { id: 1, name: 'Service One', is_deleted: false },
    { id: 2, name: 'Service Two', is_deleted: false },
  ]), [])

  useOperationalDetailRoute({
    allItems: items,
    detailItem,
    setDetailItem,
    fetchDetailItem,
  })

  return <div data-testid="async-detail-state">{detailItem ? detailItem.name : 'none'}</div>
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('useOperationalDirtyGuard navigation protection', () => {
  it('does not block untouched navigation', async () => {
    const router = createMemoryRouter([
      { path: '/', element: <DirtyModalHarness isDirty={false} /> },
      { path: '/other', element: <OtherPage /> },
    ], {
      initialEntries: ['/'],
    })

    render(<RouterProvider router={router} />)

    fireEvent.click(screen.getByRole('link', { name: 'Go other' }))

    expect(await screen.findByText('Other page')).toBeInTheDocument()
    expect(screen.queryByText('Unsaved Changes')).not.toBeInTheDocument()
  })

  it('blocks browser back when dirty and cancels cleanly', async () => {
    const router = createMemoryRouter([
      { path: '/prev', element: <OtherPage /> },
      { path: '/form', element: <DirtyModalHarness isDirty={true} /> },
    ], {
      initialEntries: ['/prev', '/form'],
      initialIndex: 1,
    })

    render(<RouterProvider router={router} />)

    await act(async () => {
      await router.navigate(-1)
    })

    expect(await screen.findByText('Unsaved Changes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/form')
    })
    expect(screen.queryByText('Other page')).not.toBeInTheDocument()
  })

  it('blocks browser back when dirty and proceeds after discard confirmation', async () => {
    const router = createMemoryRouter([
      { path: '/prev', element: <OtherPage /> },
      { path: '/form', element: <DirtyModalHarness isDirty={true} /> },
    ], {
      initialEntries: ['/prev', '/form'],
      initialIndex: 1,
    })

    render(<RouterProvider router={router} />)

    await act(async () => {
      await router.navigate(-1)
    })

    expect(await screen.findByText('Unsaved Changes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }))

    expect(await screen.findByText('Other page')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/prev')
  })
})

describe('useWorkspaceOverlayController', () => {
  it('keeps one top-level overlay active at a time and supports dismissing all', () => {
    const { result } = renderHook(() => useWorkspaceOverlayController())

    act(() => {
      result.current.toggleOverlay('display')
    })
    expect(result.current.activeOverlay).toBe('display')
    expect(result.current.isOverlayOpen('display')).toBe(true)

    act(() => {
      result.current.toggleOverlay('views')
    })
    expect(result.current.activeOverlay).toBe('views')
    expect(result.current.isOverlayOpen('display')).toBe(false)
    expect(result.current.isOverlayOpen('views')).toBe(true)

    act(() => {
      result.current.openOverlay('rowAction')
    })
    expect(result.current.activeOverlay).toBe('rowAction')
    expect(result.current.isOverlayOpen('rowAction')).toBe(true)

    act(() => {
      result.current.toggleOverlay('rowAction')
    })
    expect(result.current.activeOverlay).toBe(null)

    act(() => {
      result.current.openOverlay('bulk')
      result.current.dismissOverlays()
    })
    expect(result.current.activeOverlay).toBe(null)
  })

  it('opening Display then Views leaves only Views active', () => {
    const { result } = renderHook(() => useWorkspaceOverlayController())
    act(() => { result.current.openOverlay('display') })
    expect(result.current.isOverlayOpen('display')).toBe(true)
    act(() => { result.current.openOverlay('views') })
    expect(result.current.isOverlayOpen('display')).toBe(false)
    expect(result.current.isOverlayOpen('views')).toBe(true)
  })

  it('opening Views then Display leaves only Display active', () => {
    const { result } = renderHook(() => useWorkspaceOverlayController())
    act(() => { result.current.openOverlay('views') })
    expect(result.current.isOverlayOpen('views')).toBe(true)
    act(() => { result.current.openOverlay('display') })
    expect(result.current.isOverlayOpen('views')).toBe(false)
    expect(result.current.isOverlayOpen('display')).toBe(true)
  })

  it('opening Bulk closes Display and Views', () => {
    const { result } = renderHook(() => useWorkspaceOverlayController())
    act(() => { result.current.openOverlay('display') })
    act(() => { result.current.openOverlay('bulk') })
    expect(result.current.isOverlayOpen('display')).toBe(false)
    expect(result.current.isOverlayOpen('bulk')).toBe(true)
  })

  it('opening rowAction closes Display, Views, and Bulk', () => {
    const { result } = renderHook(() => useWorkspaceOverlayController())
    act(() => { result.current.openOverlay('bulk') })
    act(() => { result.current.openOverlay('rowAction') })
    expect(result.current.isOverlayOpen('bulk')).toBe(false)
    expect(result.current.isOverlayOpen('rowAction')).toBe(true)
  })

  it('dismiss clears active top-level overlay', () => {
    const { result } = renderHook(() => useWorkspaceOverlayController())
    act(() => { result.current.openOverlay('display') })
    act(() => { result.current.dismissOverlays() })
    expect(result.current.activeOverlay).toBeNull()
    expect(result.current.isOverlayOpen('display')).toBe(false)
  })
})

describe('useOperationalDetailRoute history sync', () => {
  it('keeps back/forward in sync with detail state without reopening loops', async () => {
    const router = createMemoryRouter([
      { path: '/services', element: <DetailRouteHarness /> },
    ], {
      initialEntries: ['/services'],
    })

    render(<RouterProvider router={router} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open detail' }))

    await waitFor(() => {
      expect(router.state.location.search).toBe('?id=1')
      expect(screen.getByTestId('detail-state').textContent).toBe('1')
    })

    await act(async () => {
      await router.navigate(-1)
    })

    await waitFor(() => {
      expect(router.state.location.search).toBe('')
      expect(screen.getByTestId('detail-state').textContent).toBe('none')
    })

    await act(async () => {
      await router.navigate(1)
    })

    await waitFor(() => {
      expect(router.state.location.search).toBe('?id=1')
      expect(screen.getByTestId('detail-state').textContent).toBe('1')
    })
  })

  it('clears stale detail while an unmatched route resolves and applies the authoritative response', async () => {
    const fetchDetailItem = vi.fn(async () => ({ id: 3, name: 'Authoritative detail', is_deleted: false }))
    const router = createMemoryRouter([
      { path: '/services', element: <AsyncDetailRouteHarness fetchDetailItem={fetchDetailItem} /> },
    ], {
      initialEntries: ['/services?id=3'],
    })

    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByTestId('async-detail-state').textContent).toBe('none')
    })

    await waitFor(() => {
      expect(screen.getByTestId('async-detail-state').textContent).toBe('Authoritative detail')
    })
    expect(fetchDetailItem).toHaveBeenCalledWith('3')
  })

  it('does not clear an incoming id route before detail state catches up', async () => {
    const router = createMemoryRouter([
      { path: '/services', element: <DetailRouteHarness /> },
    ], {
      initialEntries: ['/services?id=1'],
    })

    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(router.state.location.search).toBe('?id=1')
      expect(screen.getByTestId('detail-state').textContent).toBe('1')
    })
  })

  it('ignores a stale authoritative response after the route target changes', async () => {
    const requestA = deferred<any>()
    const requestB = deferred<any>()
    const unknownRequest = deferred<any>()
    const fetchDetailItem = vi.fn((id: string) => {
      if (id === '3') return requestA.promise
      if (id === '4') return requestB.promise
      return unknownRequest.promise
    })
    const router = createMemoryRouter([
      { path: '/services', element: <AsyncDetailRouteHarness fetchDetailItem={fetchDetailItem} /> },
    ], {
      initialEntries: ['/services?id=3'],
    })

    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByTestId('async-detail-state').textContent).toBe('none')
      expect(router.state.location.search).toBe('?id=3')
    })

    await act(async () => {
      await router.navigate('/services?id=4')
    })
    expect(screen.getByTestId('async-detail-state').textContent).toBe('none')
    expect(router.state.location.search).toBe('?id=4')

    await act(async () => {
      requestB.resolve({ id: 4, name: 'Current detail', is_deleted: false })
      await requestB.promise
    })
    await waitFor(() => {
      expect(screen.getByTestId('async-detail-state').textContent).toBe('Current detail')
      expect(router.state.location.search).toBe('?id=4')
    })

    await act(async () => {
      requestA.resolve({ id: 3, name: 'Stale detail A', is_deleted: false })
      await requestA.promise
    })
    expect(screen.getByTestId('async-detail-state').textContent).toBe('Current detail')
    expect(screen.queryByText('Stale detail A')).not.toBeInTheDocument()

    await act(async () => {
      await router.navigate('/services?id=5')
    })
    await waitFor(() => {
      expect(screen.getByTestId('async-detail-state').textContent).toBe('none')
      expect(router.state.location.search).toBe('?id=5')
    })

    await act(async () => {
      unknownRequest.resolve(null)
      await unknownRequest.promise
    })
    await waitFor(() => {
      expect(screen.getByTestId('async-detail-state').textContent).toBe('none')
      expect(router.state.location.search).toBe('')
    })
    expect(screen.queryByText('Stale detail A')).not.toBeInTheDocument()
  })
})
