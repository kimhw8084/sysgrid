import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceModal } from './WorkspaceModal'
import { AppDropdown } from './AppDropdown'
import { useWorkspaceConfirmation } from './useWorkspaceConfirmation'

function mount(children: React.ReactNode) {
  return render(<RouterProvider router={createMemoryRouter([{ path: '/', element: children }])} />)
}

describe('nested workspace overlays', () => {
  it('closes only the top dialog and returns focus to its opener', async () => {
    function Harness() {
      const [inner, setInner] = React.useState(false)
      return <WorkspaceModal isOpen onClose={() => { throw Error('Parent must stay open') }} title="Parent dialog">
        <button onClick={() => setInner(true)}>Open child</button>
        {inner && <WorkspaceModal isOpen onClose={() => setInner(false)} title="Child dialog"><input aria-label="Child field" /></WorkspaceModal>}
      </WorkspaceModal>
    }
    mount(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open child' })
    opener.focus()
    fireEvent.click(opener)
    const parent = screen.getByRole('dialog', { name: 'Parent dialog' })
    const child = screen.getByRole('dialog', { name: 'Child dialog' })
    expect(Number(child.style.zIndex)).toBeGreaterThan(Number(parent.style.zIndex))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Child dialog' })).not.toBeInTheDocument())
    expect(parent).toBeVisible()
    expect(document.activeElement).toBe(opener)
  })

  it('Escape dismisses a selector before the enclosing modal', async () => {
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 100, y: 100, top: 100, left: 100, right: 300, bottom: 140, width: 200, height: 40, toJSON: () => ({}) })
    const close = vi.fn()
    mount(<WorkspaceModal isOpen onClose={close} title="Form">
      <AppDropdown value="one" onChange={() => {}} options={[{ value: 'one', label: 'First' }, { value: 'two', label: 'Second' }]} />
    </WorkspaceModal>)
    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    const second = await screen.findByRole('button', { name: 'Second' })
    second.focus()
    fireEvent.keyDown(second, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Second' })).not.toBeInTheDocument())
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus()
    bounds.mockRestore()
  })

  it('cancels confirmation on Escape and requires explicit acceptance for mutation', async () => {
    const mutation = vi.fn()
    function Harness() {
      const { confirm, confirmation } = useWorkspaceConfirmation()
      return <>{confirmation}<button onClick={async () => {
        if (await confirm({ title: 'Delete record?', message: 'This removes the selected record.', confirmText: 'Delete' })) mutation()
      }}>Request deletion</button></>
    }
    mount(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Request deletion' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mutation).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Request deletion' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(1))
  })
})
