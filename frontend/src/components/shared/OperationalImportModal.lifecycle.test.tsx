import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../../api/apiClient'
import { OperationalImportModal } from './OperationalImportModal'

vi.mock('../../api/apiClient', () => ({ apiFetch: vi.fn() }))
vi.mock('./WorkspaceToast', () => ({ showWorkspaceToast: vi.fn() }))

const schema = {
  fields: ['name', 'system'].map(name => ({ name, label: name, required: true, aliases: [], options: [], input_control: 'text', supported_in_builder: true })),
  required_fields: ['name', 'system'], example_records: [],
}
const preview = { total_rows: 1, valid_rows: 1, invalid_rows: 0, results: [
  { row: 1, source: { name: 'Original draft', system: 'Proof' }, normalized: { name: 'Original draft', system: 'Proof' }, status: 'VALID', errors: [] },
] }
const response = (value: unknown) => ({ json: async () => value }) as Response
const load = async (name: string) => {
  fireEvent.click(await screen.findByRole('button', { name: 'Paste CSV / Grid' }))
  fireEvent.change(screen.getByPlaceholderText('Paste CSV with headers, or paste spreadsheet cells directly...'), { target: { value: `name,system\n${name},Proof` } })
  fireEvent.click(screen.getByRole('button', { name: 'Load Into Builder' }))
  await screen.findByDisplayValue(name)
}

describe('shared import request lifetime', () => {
  beforeEach(() => vi.clearAllMocks())

  for (const operation of ['preview', 'execute']) it(`ignores an old ${operation} result after a parent closes and reopens the dialog`, async () => {
    let release!: (value: Response) => void
    const held = new Promise<Response>(resolve => { release = resolve })
    vi.mocked(apiFetch).mockImplementation(async path => {
      if (String(path).includes('/schema/')) return response(schema)
      if (String(path).includes('/preview-rows')) return operation === 'preview' ? held : response(preview)
      if (String(path).includes('/execute')) return held
      throw new Error(`Unexpected test request: ${path}`)
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const onClose = vi.fn()
    let setOpen!: (value: boolean) => void
    const Harness = () => {
      const [isOpen, update] = React.useState(true)
      setOpen = update
      return <OperationalImportModal isOpen={isOpen} onClose={onClose} tableName="devices" displayName="Assets" />
    }
    const router = createMemoryRouter([{ path: '/', element: <Harness /> }])
    const mounted = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
    await load('Original draft')
    fireEvent.click(screen.getByRole('button', { name: 'Initiate Audit' }))
    if (operation === 'execute') fireEvent.click(await screen.findByRole('button', { name: 'Import 1' }))
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining(operation === 'preview' ? '/preview-rows' : '/execute'), expect.anything()))
    act(() => setOpen(false))
    act(() => setOpen(true))
    await act(async () => { release(response(operation === 'preview' ? preview : { status: 'success', count: 1 })); await held })
    await waitFor(() => expect(screen.queryByText(operation === 'preview' ? 'Auditing...' : 'Importing...')).not.toBeInTheDocument())
    expect(screen.queryByText('Ready to import: 1')).not.toBeInTheDocument()
    await load('Replacement draft')
    expect(screen.getByDisplayValue('Replacement draft')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    if (operation === 'execute') expect(invalidate).toHaveBeenCalledTimes(1)
    mounted.unmount()
    client.clear()
  })
})
