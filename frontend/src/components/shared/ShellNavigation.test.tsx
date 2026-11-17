import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LayoutDashboard } from 'lucide-react'
import { ShellNavGroup, ShellNavItem, isShellRouteActive } from './ShellNavigation'

describe('shell navigation', () => {
  const withQueryClient = (children: ReactNode) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  )

  it('matches nested routes without matching sibling paths', () => {
    expect(isShellRouteActive('/services/42/details', '/services')).toBe(true)
    expect(isShellRouteActive('/service-status', '/services')).toBe(false)
    expect(isShellRouteActive('/network-real', '/network', ['/network-real'])).toBe(true)
  })

  it('exposes the active state and an accessible name when collapsed', () => {
    render(
      withQueryClient(
        <MemoryRouter initialEntries={['/services/42/details']}>
          <ShellNavItem icon={LayoutDashboard} label="Services" path="/services" active isOpen={false} />
        </MemoryRouter>,
      ),
    )

    const link = screen.getByRole('link', { name: 'Services' })
    expect(link).toHaveAttribute('aria-current', 'page')
    expect(link).toHaveAttribute('title', 'Services')
    expect(screen.getByText('Services')).toHaveClass('sr-only')
  })

  it('keeps groups keyboard reachable with an explicit expanded state', () => {
    render(
      withQueryClient(
        <MemoryRouter>
          <ShellNavGroup label="Operations" isSidebarOpen defaultExpanded>
            <ShellNavItem icon={LayoutDashboard} label="Home" path="/" active isOpen />
          </ShellNavGroup>
        </MemoryRouter>,
      ),
    )

    const groupToggle = screen.getByText('Operations').closest('summary')
    expect(groupToggle).not.toBeNull()
    expect(groupToggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(groupToggle)
    expect(groupToggle).toHaveAttribute('aria-expanded', 'false')
  })
})
