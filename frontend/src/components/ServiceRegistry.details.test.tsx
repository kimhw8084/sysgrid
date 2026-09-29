import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { ServiceDetailsView } from './ServiceRegistry'

describe('service detail information', () => {
  it('preserves nested metadata, false, zero and complete long values', () => {
    const endpoint = `https://internal.example.test/${'long-service-route/'.repeat(15)}`
    render(<ServiceDetailsView service={{ id: 1, name: 'Core database', config_json: JSON.stringify({ endpoint, replicas: 0, enabled: false, health: { state: 'ready' }, labels: ['core', 'production'] }) }} options={{}} devices={[]} />)
    expect(screen.getByText(endpoint)).toBeInTheDocument()
    expect(screen.getByText('0', { selector: 'dd' })).toBeInTheDocument()
    expect(screen.getByText('false')).toBeInTheDocument()
    expect(screen.getByText(/"state": "ready"/)).toBeInTheDocument()
    expect(screen.getByText(/"core", "production"/)).toBeInTheDocument()
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
  })

  it('distinguishes malformed metadata from a genuinely empty object', () => {
    const { rerender } = render(<ServiceDetailsView service={{ id: 1, config_json: '{invalid' }} options={{}} devices={[]} />)
    expect(screen.getByRole('status')).toHaveTextContent('Configuration metadata could not be read.')
    expect(screen.queryByText('No metadata keys documented')).not.toBeInTheDocument()
    rerender(<ServiceDetailsView service={{ id: 1, config_json: {} }} options={{}} devices={[]} />)
    expect(screen.getByText('No metadata keys documented')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('returns to metadata when the selected service changes', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    const first = { id: 1, name: 'First service', config_json: { record: 'First' }, secrets: [] }
    const second = { id: 2, name: 'Second service', config_json: { record: 'Second' }, secrets: [] }
    client.setQueryData(['logical-services'], [first, second])
    const view = (service: typeof first) => <QueryClientProvider client={client}><ServiceDetailsView service={service} options={{}} devices={[]} /></QueryClientProvider>
    const { rerender } = render(view(first))
    fireEvent.click(screen.getByRole('button', { name: /Secrets/ }))
    expect(screen.getByText('Identity Registry')).toBeInTheDocument()
    rerender(view(second))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Metadata' })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByText('Second')).toBeInTheDocument()
    expect(screen.queryByText('Identity Registry')).not.toBeInTheDocument()
    client.clear()
  })
})
