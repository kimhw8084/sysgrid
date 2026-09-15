import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LayoutDashboard } from 'lucide-react'
import { ShellNavGroup, ShellNavItem, isShellRouteActive } from './ShellNavigation'

describe('shell navigation', () => {
  it('matches nested routes without matching sibling paths', () => {
    expect(isShellRouteActive('/projects/42/timeline', '/projects')).toBe(true)
    expect(isShellRouteActive('/project-status', '/projects')).toBe(false)
    expect(isShellRouteActive('/network-real', '/network', ['/network-real'])).toBe(true)
  })

  it('exposes the active state and an accessible name when collapsed', () => {
    render(
      <MemoryRouter initialEntries={['/projects/42/timeline']}>
        <ShellNavItem icon={LayoutDashboard} label="Projects" path="/projects" active isOpen={false} />
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: 'Projects' })
    expect(link).toHaveAttribute('aria-current', 'page')
    expect(link).toHaveAttribute('title', 'Projects')
    expect(screen.getByText('Projects')).toHaveClass('sr-only')
  })

  it('keeps groups keyboard reachable with an explicit expanded state', () => {
    render(
      <MemoryRouter>
        <ShellNavGroup label="Operations" isSidebarOpen defaultExpanded>
          <ShellNavItem icon={LayoutDashboard} label="Home" path="/" active isOpen />
        </ShellNavGroup>
      </MemoryRouter>,
    )

    const groupToggle = screen.getByText('Operations').closest('summary')
    expect(groupToggle).not.toBeNull()
    expect(groupToggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(groupToggle)
    expect(groupToggle).toHaveAttribute('aria-expanded', 'false')
  })
})
