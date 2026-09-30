import React, { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { ServiceForm } from '../ServiceRegistry'
import { WorkspaceModal } from './WorkspaceModal'

function DirtyHarness({
  initialData = {},
}: {
  initialData?: Record<string, any>
}) {
  const [isOpen, setIsOpen] = useState(true)
  const [isDirty, setIsDirty] = useState(false)
  const [reopenKey, setReopenKey] = useState(0)
  const [onClose] = useState(() => vi.fn(() => setIsOpen(false)))

  return (
    <div>
      <div data-testid="services-dirty-state">{String(isDirty)}</div>
      <div data-testid="services-close-count">{String(onClose.mock.calls.length)}</div>
      <button type="button" onClick={() => { setIsDirty(false); setIsOpen(true); setReopenKey((current) => current + 1) }}>
        Reopen
      </button>
      <WorkspaceModal
        isOpen={isOpen}
        onClose={onClose}
        title="Services Recovery Harness"
        isDirty={isDirty}
        dirtyConfirmTitle="Discard Service Changes?"
        dirtyConfirmMessage="You have unsaved service changes. Close this window and discard them?"
      >
        <ServiceForm
          key={`service-form-${reopenKey}`}
          initialData={initialData}
          onSave={vi.fn()}
          isPending={false}
          options={[]}
          devices={[]}
          formId="service-record-form"
          onDirtyChange={setIsDirty}
          renderActions={false}
        />
      </WorkspaceModal>
    </div>
  )
}

function renderHarness(initialData?: Record<string, any>) {
  const router = createMemoryRouter([
    {
      path: '/',
      element: <DirtyHarness initialData={initialData} />,
    },
  ], {
    initialEntries: ['/'],
  })

  render(<RouterProvider router={router} />)
}

function getDiscardDialog() {
  const title = screen.getByText('Discard Service Changes?')
  const dialogContainer = title.parentElement?.parentElement
  expect(dialogContainer).not.toBeNull()
  return within(dialogContainer as HTMLElement)
}

describe('Services dirty guard recovery', () => {
  it('marks Services dirty after a representative field edit and protects close attempts', async () => {
    renderHarness()

    const nameInput = screen.getByPlaceholderText('e.g. ERP DB Prod 01')
    fireEvent.change(nameInput, { target: { value: 'ERP DB Prod 01' } })

    expect(screen.getByTestId('services-dirty-state')).toHaveTextContent('true')

    fireEvent.click(screen.getByTitle('Close'))

    expect(screen.getByTestId('services-close-count')).toHaveTextContent('0')
    expect(await screen.findByText('Discard Service Changes?')).toBeInTheDocument()

    const discardDialog = getDiscardDialog()
    fireEvent.click(discardDialog.getByRole('button', { name: 'Keep editing' }))

    expect(screen.getByPlaceholderText('e.g. ERP DB Prod 01')).toHaveValue('ERP DB Prod 01')
    expect(screen.getByTestId('services-close-count')).toHaveTextContent('0')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(await screen.findByText('Discard Service Changes?')).toBeInTheDocument()

    fireEvent.click(getDiscardDialog().getByRole('button', { name: 'Discard Changes' }))

    expect(screen.getByTestId('services-close-count')).toHaveTextContent('1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))

    expect(screen.getByTestId('services-dirty-state')).toHaveTextContent('false')
    expect(screen.getByPlaceholderText('e.g. ERP DB Prod 01')).toHaveValue('')
  })

  it('keeps clean close clean', () => {
    renderHarness({ name: 'Existing Service' })

    fireEvent.click(screen.getByTitle('Close'))

    expect(screen.getByTestId('services-close-count')).toHaveTextContent('1')
    expect(screen.queryByText('Discard Service Changes?')).not.toBeInTheDocument()
  })
})
