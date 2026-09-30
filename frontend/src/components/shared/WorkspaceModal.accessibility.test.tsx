import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { WorkspaceModal } from './WorkspaceModal'


function renderInDataRouter(element: React.ReactNode) {
  const router = createMemoryRouter([
    {
      path: '/',
      element,
    },
  ], {
    initialEntries: ['/'],
  })

  return render(<RouterProvider router={router} />)
}

function ModalHarness({ dirty = false }: { dirty?: boolean }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open accessible modal</button>
      <WorkspaceModal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Accessible Project Modal"
        isDirty={dirty}
        hideCloseButton
        hideFooterClose
        footerRight={<button type="button" onClick={() => setOpen(false)}>Done</button>}
      >
        <label>
          Project name
          <input aria-label="Project name" />
        </label>
      </WorkspaceModal>
    </>
  )
}

describe('WorkspaceModal accessibility contract', () => {
  it('names the dialog, moves focus inside, traps Tab, and restores focus to its opener', () => {
    renderInDataRouter(<ModalHarness />)
    const opener = screen.getByRole('button', { name: 'Open accessible modal' })
    opener.focus()
    fireEvent.click(opener)

    const dialog = screen.getByRole('dialog', { name: 'Accessible Project Modal' })
    expect(screen.getAllByText('Accessible Project Modal')).toHaveLength(1)
    const input = within(dialog).getByRole('textbox', { name: 'Project name' })
    const done = within(dialog).getByRole('button', { name: 'Done' })

    expect(document.activeElement).toBe(input)

    done.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(input)

    input.focus()
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(done)

    fireEvent.click(done)
    expect(screen.queryByRole('dialog', { name: 'Accessible Project Modal' })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(opener)
  })

  it('moves focus into the dirty confirmation and returns it when cancellation resumes the modal', async () => {
    renderInDataRouter(<ModalHarness dirty />)
    const opener = screen.getByRole('button', { name: 'Open accessible modal' })
    fireEvent.click(opener)

    const input = screen.getByRole('textbox', { name: 'Project name' })
    input.focus()
    fireEvent.keyDown(window, { key: 'Escape' })

    const confirm = await screen.findByRole('alertdialog', { name: 'Unsaved Changes' })
    expect(confirm).toHaveAccessibleDescription('You have unsaved changes. Close this window and discard them?')
    expect(confirm).toContainElement(document.activeElement as HTMLElement)

    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog', { name: 'Unsaved Changes' })).not.toBeInTheDocument()
    })
    expect(document.activeElement).toBe(input)
  })

  it('keeps the existing Escape close path for a clean modal', () => {
    const onClose = vi.fn()
    renderInDataRouter(
      <WorkspaceModal isOpen onClose={onClose} title="Escape Modal">
        <button type="button">Body action</button>
      </WorkspaceModal>,
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
