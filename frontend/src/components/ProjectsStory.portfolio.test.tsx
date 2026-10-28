import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ProjectsStory from './ProjectsStory'

vi.mock('../policy/ModulePolicy', () => ({ useModulePolicy: () => ({ data: { identity: { user_id: 'portfolio-test-user' } }, isLoading: false, isError: false, refetch: async () => ({}) }) }))

vi.mock('./ProjectsStory.api', async () => {
  const actual = await vi.importActual<typeof import('./ProjectsStory.api')>('./ProjectsStory.api')
  return {
    ...actual,
    readPV1Portfolio: vi.fn().mockRejectedValue(new actual.PortfolioProjectionError({
      endpoint: '/api/v2/projects?limit=200',
      itemIndex: 0,
      projectId: 'legacy-42',
      displayKey: 'PRJ-000042',
      missing: ['story', 'story.governance'],
    })),
    readCreationOperators: vi.fn().mockResolvedValue([]),
    readCreationTeams: vi.fn().mockResolvedValue([]),
  }
})

describe('Portfolio invalid projection state', () => {
  it('renders a controlled unavailable state instead of entering Portfolio sorting', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const router = createMemoryRouter([{ path: '/projects', element: <QueryClientProvider client={queryClient}><ProjectsStory /></QueryClientProvider> }], { initialEntries: ['/projects'] })
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('heading', { name: 'Portfolio unavailable' })).toBeVisible()
    expect(screen.getByText(/Invalid project projection/)).toBeVisible()
    expect(screen.getByText(/PRJ-000042/)).toBeVisible()
    expect(screen.queryByText(/Cannot read properties of undefined/)).not.toBeInTheDocument()
  })
})
