import React from 'react'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { GlobalSearch } from './GlobalSearch'

vi.mock('../../policy/ModulePolicy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../policy/ModulePolicy')>()
  return {
    ...actual,
    useModulePolicy: () => ({ data: { modules: {} }, isLoading: false, isError: false }),
  }
})

describe('GlobalSearch accessibility', () => {
  it('gives the modal dialog a programmatic name', () => {
    const router = createMemoryRouter([{ path: '/', element: <GlobalSearch isOpen onClose={vi.fn()} /> }])
    render(<RouterProvider router={router} />)

    expect(screen.getByRole('dialog', { name: 'Global search' })).toBeInTheDocument()
  })
})
