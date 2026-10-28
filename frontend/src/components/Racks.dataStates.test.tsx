import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/apiClient'
import { makeJsonResponse } from '../test/response'
import { fetchRackArray, RackDataState } from './racksDataState'

vi.mock('../api/apiClient', () => ({ apiFetch: vi.fn() }))

afterEach(() => vi.clearAllMocks())

it('accepts a successful empty list as a confirmed empty result', async () => {
  vi.mocked(apiFetch).mockResolvedValue(makeJsonResponse([]))

  await expect(fetchRackArray('/api/v1/racks/')).resolves.toEqual([])
})

it('rejects a successful response with an invalid list shape', async () => {
  vi.mocked(apiFetch).mockResolvedValue(makeJsonResponse({ detail: 'unexpected shape' }))

  await expect(fetchRackArray('/api/v1/racks/')).rejects.toThrow('invalid list response')
})

it('rejects a non-success response even when it contains a list', async () => {
  vi.mocked(apiFetch).mockResolvedValue(makeJsonResponse([], { status: 503 }))

  await expect(fetchRackArray('/api/v1/racks/')).rejects.toThrow('status 503')
})

it('offers a retry and distinguishes unavailable records from an empty result', () => {
  const onRetry = vi.fn()
  render(<RackDataState label="Rack records" isError onRetry={onRetry} />)

  expect(screen.getByRole('alert')).toHaveTextContent('An empty result has not been confirmed')
  fireEvent.click(screen.getByRole('button', { name: 'Retry rack records' }))
  expect(onRetry).toHaveBeenCalledOnce()
})
