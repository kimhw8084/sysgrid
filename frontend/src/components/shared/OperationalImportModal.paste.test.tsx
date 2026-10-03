import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../../api/apiClient'
import { OperationalImportModal } from './OperationalImportModal'
import { showWorkspaceToast } from './WorkspaceToast'

vi.mock('../../api/apiClient', () => ({ apiFetch: vi.fn() }))
vi.mock('./WorkspaceToast', () => ({ showWorkspaceToast: vi.fn() }))

const fields = ['name', 'system', 'owner', 'metadata_json']
const response = (value: unknown) => ({ json: async () => value }) as Response
const mount = async () => {
  vi.mocked(apiFetch).mockImplementation(async path => {
    if (String(path).includes('/schema/')) return response({
      fields: fields.map(name => ({ name, label: name, required: true, aliases: [], options: [], input_control: 'text', supported_in_builder: true })),
      required_fields: fields, example_records: [],
    })
    if (String(path).includes('/preview-rows')) return response({ total_rows: 1, valid_rows: 1, invalid_rows: 0, results: [] })
    throw new Error(`Unexpected test request: ${path}`)
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const router = createMemoryRouter([{ path: '/', element: <OperationalImportModal isOpen onClose={() => {}} tableName="devices" displayName="Assets" /> }])
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  await screen.findByRole('button', { name: 'Paste CSV / Grid' })
}
const paste = async (text: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'Paste CSV / Grid' }))
  fireEvent.change(screen.getByPlaceholderText('Paste CSV with headers, or paste spreadsheet cells directly...'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Load Into Builder' }))
}

describe('import paste preserves logical records and rejects ambiguous input', () => {
  beforeEach(() => vi.clearAllMocks())

  for (const separator of ['\n', '\r\n']) it(`keeps quoted multiline values in one editable row with ${JSON.stringify(separator)}`, async () => {
    await mount()
    await paste(`name,system,owner,metadata_json${separator}"Host, quoted",Proof,"First${separator}Second","{""kept"":true}"`)
    const owner = screen.getByRole('textbox', { name: 'owner, row 1' })
    expect(owner).toHaveValue('First\nSecond')
    expect(screen.queryByRole('textbox', { name: 'name, row 2' })).not.toBeInTheDocument()
    fireEvent.change(owner, { target: { value: 'Edited\nSecond' } })
    fireEvent.click(screen.getByRole('button', { name: 'Initiate Audit' }))
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/api/v1/import/preview-rows?table_name=devices', expect.anything()))
    const call = vi.mocked(apiFetch).mock.calls.find(([path]) => String(path).includes('/preview-rows'))!
    expect(JSON.parse(String(call[1]?.body)).rows).toEqual([{ name: 'Host, quoted', system: 'Proof', owner: 'Edited\nSecond', metadata_json: '{"kept":true}' }])
  })

  it('detects separators outside quoted cells and preserves escaped quotes', async () => {
    await mount()
    await paste('"Host\twith tab",Proof,"Owner ""Q""",{}')
    expect(screen.getByRole('textbox', { name: 'name, row 1' })).toHaveValue('Host\twith tab')
    expect(screen.getByRole('textbox', { name: 'system, row 1' })).toHaveValue('Proof')
    expect(screen.getByRole('textbox', { name: 'owner, row 1' })).toHaveValue('Owner "Q"')
  })

  it('keeps a trailing empty spreadsheet cell so pasting clears that value', async () => {
    await mount()
    await paste('name,system,owner,metadata_json\nOriginal,Proof,Owner,retained')
    fireEvent.paste(screen.getByRole('textbox', { name: 'name, row 1' }), {
      clipboardData: { getData: () => 'Edited\tChanged system\tChanged owner\t' },
    })
    expect(screen.getByRole('textbox', { name: 'name, row 1' })).toHaveValue('Edited')
    expect(screen.getByRole('textbox', { name: 'metadata_json, row 1' })).toHaveValue('')
  })

  for (const text of ['"Unclosed,Proof,Owner,{}', '"Host"suffix,Proof,Owner,{}', 'Ho"st,Proof,Owner,{}']) {
    it(`rejects malformed quoting without replacing the existing builder: ${text}`, async () => {
      await mount()
      await paste('name,system,owner,metadata_json\nRetained,Proof,Owner,{}')
      await paste(text)
      expect(screen.getByPlaceholderText('Paste CSV with headers, or paste spreadsheet cells directly...')).toHaveValue(text)
      expect(showWorkspaceToast).toHaveBeenLastCalledWith(expect.stringMatching(/quote/i), { type: 'error' })
      fireEvent.click(screen.getByRole('button', { name: 'Build Rows' }))
      expect(screen.getByRole('textbox', { name: 'name, row 1' })).toHaveValue('Retained')
      expect(vi.mocked(apiFetch).mock.calls.every(([path]) => String(path).includes('/schema/'))).toBe(true)
    })
  }

  it('rejects a malformed cell paste without changing existing cells', async () => {
    await mount()
    await paste('name,system,owner,metadata_json\nRetained,Proof,Owner,{}')
    fireEvent.paste(screen.getByRole('textbox', { name: 'name, row 1' }), { clipboardData: { getData: () => '"Unclosed\tvalue' } })
    expect(screen.getByRole('textbox', { name: 'name, row 1' })).toHaveValue('Retained')
    expect(showWorkspaceToast).toHaveBeenLastCalledWith(expect.stringMatching(/quote/i), { type: 'error' })
  })
})
