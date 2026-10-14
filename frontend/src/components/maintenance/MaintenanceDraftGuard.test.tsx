import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom'
import { afterEach, expect, it } from 'vitest'
import { DraftGuard } from './MaintenanceFields'

afterEach(cleanup)

it('keeps the dirty form usable after canceling departure and permits a later explicit discard', async () => {
  const router = createMemoryRouter([
    { path: '/form', element: <><DraftGuard dirty /><Link to="/other">Leave form</Link><input aria-label="Draft" defaultValue="Unsaved plan" /></> },
    { path: '/other', element: <p>Other workspace</p> },
  ], { initialEntries: ['/form'] })
  render(<RouterProvider router={router} />)
  fireEvent.click(screen.getByRole('link', { name: 'Leave form' }))
  expect(await screen.findByRole('dialog', { name: 'Leave maintenance changes?' })).toBeVisible()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Keep editing' })))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByLabelText('Draft')).toHaveValue('Unsaved plan')
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Still editable' } })
  fireEvent.click(screen.getByRole('link', { name: 'Leave form' }))
  await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Discard and leave' })))
  expect(await screen.findByText('Other workspace')).toBeVisible()
})
