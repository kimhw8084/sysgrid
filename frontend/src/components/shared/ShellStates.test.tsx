import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { FatalErrorState, PermissionDeniedState } from './ShellStates'

describe('shell state presentation', () => {
  it('keeps fatal technical details behind an explicit disclosure', () => {
    const onReload = vi.fn()
    render(<FatalErrorState error={new Error('captured stack detail')} onReload={onReload} />)

    const details = screen.getByText('Show technical details').closest('details')
    expect(details).not.toHaveAttribute('open')
    expect(screen.getByRole('button', { name: 'Reload application' })).toBeVisible()

    fireEvent.click(screen.getByText('Show technical details'))
    expect(details).toHaveAttribute('open')
    expect(screen.getByText(/captured stack detail/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Reload application' }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('describes the unavailable capability and gives a safe navigation action', () => {
    render(
      <MemoryRouter>
        <PermissionDeniedState area="Monitoring" />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Access unavailable' })).toBeVisible()
    expect(screen.getByText(/Monitoring/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Return to Home' })).toHaveAttribute('href', '/')
  })
})
