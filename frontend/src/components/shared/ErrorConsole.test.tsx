import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ErrorConsole } from './ErrorConsole'
import { errorManager } from '../../stores/errorStore'

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('react-hot-toast', () => ({ toast: feedback }))

beforeEach(() => {
  localStorage.clear()
  errorManager.clearErrors()
  errorManager.setOpen(true)
  feedback.success.mockClear()
  feedback.error.mockClear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })))
})
afterEach(() => { errorManager.setOpen(false); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('keeps clipboard rejection inside the console for every copy action', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('Clipboard denied'))
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  localStorage.setItem('SYSGRID_BUGANIZER_URL', 'https://issues.example.test')
  errorManager.addError({ message: 'Copy failure fixture', stack: 'Synthetic stack', type: 'frontend', severity: 'error' })
  render(<ErrorConsole />)
  fireEvent.click(screen.getByRole('button', { name: 'Inspect error: Copy failure fixture' }))
  for (const name of ['Copy Bug Report', 'Open Buganizer', 'Copy technical details']) {
    fireEvent.click(screen.getByRole('button', { name }))
  }
  await waitFor(() => expect(feedback.error).toHaveBeenCalledTimes(3))
  expect(feedback.success).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
  expect(screen.getByRole('heading', { name: 'Copy failure fixture' })).toBeVisible()
})

it('removes a filtered selection and keeps acknowledgement and clear actions truthful', async () => {
  errorManager.addError({ message: 'API unavailable', type: 'backend', severity: 'error' })
  errorManager.addError({ message: 'Client unavailable', type: 'frontend', severity: 'warning' })
  render(<ErrorConsole />)
  fireEvent.click(screen.getByRole('button', { name: 'Inspect error: Client unavailable' }))
  fireEvent.click(screen.getByRole('button', { name: 'backend' }))
  expect(screen.queryByRole('heading', { name: 'Client unavailable' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'all' }))
  expect(screen.queryByRole('heading', { name: 'Client unavailable' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Inspect error: API unavailable' }))
  fireEvent.click(screen.getByRole('button', { name: 'Showing All' }))
  fireEvent.click(screen.getByRole('button', { name: 'Acknowledge error' }))
  expect(screen.queryByRole('heading', { name: 'API unavailable' })).not.toBeInTheDocument()
  expect(errorManager.getErrors().find(error => error.message === 'API unavailable')?.acknowledged).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Clear console' }))
  expect(errorManager.getErrors()).toEqual([])
  expect(screen.getByText('No matching errors in the current view.')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Clear console' })).toBeDisabled()
})
