import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Knowledge from './Knowledge'
import { makeJsonResponse } from '../test/response'

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }))
vi.mock('../api/apiClient', () => ({
  apiFetch: apiFetchMock,
  getRequestScopeKey: () => 'knowledge-test',
}))

const modulePolicy = {
  modules: {
    knowledge: { actions: { write: true } },
  },
}

function renderKnowledge() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><MemoryRouter><Knowledge /></MemoryRouter></QueryClientProvider>)
  return queryClient
}

const knowledgeEntry = {
  id: 41,
  title: 'Recovery runbook',
  category: 'BKM',
  content: 'Restore the service after a failed deployment.',
  question_context: '',
  content_json: { purpose: 'Restore service', steps: [], rollback: '', validation: '' },
  metadata_json: {},
  tags: [],
  linked_device_ids: [],
  impacted_systems: [],
  qa_threads: [],
  status: 'Published',
  created_at: '2026-10-20T12:00:00Z',
  updated_at: '2026-10-20T12:00:00Z',
}

beforeEach(() => { apiFetchMock.mockReset() })

describe('Knowledge data-state handling', () => {
  it('shows a recoverable error instead of crashing or claiming an empty list', async () => {
    let listRequests = 0
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/policy/module-availability') return makeJsonResponse(modulePolicy)
      if (String(url).startsWith('/api/v1/knowledge/')) {
        listRequests += 1
        return listRequests === 1
          ? makeJsonResponse({ detail: 'unavailable' }, { status: 503 })
          : makeJsonResponse([])
      }
      return makeJsonResponse([])
    })

    renderKnowledge()

    expect(await screen.findByRole('alert')).toHaveTextContent('Knowledge records unavailable')
    expect(screen.queryByText('No Intelligence Found')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading records' }))
    expect(await screen.findByText('No Intelligence Found')).toBeInTheDocument()
  })

  it('shows a true empty state for a successful empty response', async () => {
    apiFetchMock.mockImplementation(async (url: string) => url === '/api/v1/policy/module-availability'
      ? makeJsonResponse(modulePolicy)
      : makeJsonResponse([]))

    renderKnowledge()

    expect(await screen.findByText('No Intelligence Found')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps loaded Knowledge visible when linked-record choices fail and can retry them', async () => {
    let vendorRequests = 0
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/policy/module-availability') return makeJsonResponse(modulePolicy)
      if (String(url).startsWith('/api/v1/knowledge/')) return makeJsonResponse([knowledgeEntry])
      if (url === '/api/v1/vendors') {
        vendorRequests += 1
        return vendorRequests === 1 ? makeJsonResponse({ detail: 'unavailable' }, { status: 503 }) : makeJsonResponse([])
      }
      return makeJsonResponse([])
    })

    renderKnowledge()

    expect(await screen.findByText(/Some linked record choices are unavailable/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open knowledge: Recovery runbook' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry linked data' }))
    await waitFor(() => expect(screen.queryByText(/Some linked record choices are unavailable/)).not.toBeInTheDocument())
    expect(vendorRequests).toBe(2)
  })
})
