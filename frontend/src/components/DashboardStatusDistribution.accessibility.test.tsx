import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DashboardStatusDistribution } from './DashboardStatusDistribution'

describe('Dashboard status distribution', () => {
  it('exposes exact status names and counts as readable, accessible text', () => {
    render(<DashboardStatusDistribution category="Assets" values={{ Active: 4, Maintenance: 2 }} total={6} />)

    const distribution = screen.getByRole('group', {
      name: 'Assets status distribution',
    })
    const items = within(distribution).getAllByRole('listitem')
    expect(items.map((item) => item.textContent?.trim())).toEqual(['Active4', 'Maintenance2'])
    expect(distribution.querySelectorAll('button, a, input, select, textarea, [tabindex]')).toHaveLength(0)
    expect(distribution.querySelector('[aria-hidden="true"]')?.className).toContain('h-2')
    expect(distribution.querySelectorAll('[aria-hidden="true"] > div')).toHaveLength(2)
    expect(distribution.querySelector('ul')?.className).toContain('flex-wrap')
    expect(distribution.querySelector('ul')?.className).toContain('min-w-0')
  })

  it('does not infer an empty inventory from an absent status breakdown', () => {
    render(<DashboardStatusDistribution category="Racks" values={{}} total={0} />)

    const distribution = screen.getByRole('group', { name: 'Racks status distribution' })
    expect(within(distribution).getByText('Status breakdown unavailable')).toBeTruthy()
  })

  it('marks a missing breakdown unavailable instead of implying a zero count', () => {
    render(<DashboardStatusDistribution category="Racks" values={{}} total={3} />)

    const distribution = screen.getByRole('group', { name: 'Racks status distribution' })
    expect(within(distribution).getByText('Status breakdown unavailable')).toBeTruthy()
  })

  it('shows explicit zero counts when the API supplies status categories', () => {
    render(<DashboardStatusDistribution category="Racks" values={{ Operational: 0, Down: 0 }} total={0} />)

    const distribution = screen.getByRole('group', { name: 'Racks status distribution' })
    const items = within(distribution).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('Operational0')
    expect(items[1].textContent).toContain('Down0')
  })

  it('keeps long status labels in a wrapping text alternative instead of truncating them', () => {
    render(<DashboardStatusDistribution category="Assets" values={{ 'Awaiting Maintenance Review': 1 }} total={1} />)

    const distribution = screen.getByRole('group', { name: 'Assets status distribution' })
    const label = within(distribution).getByText('Awaiting Maintenance Review')
    expect(label.className).toContain('break-words')
    expect(distribution.querySelector('ul')?.className).toContain('flex-wrap')
  })
})
