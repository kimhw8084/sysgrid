import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WorkspaceModalHeader } from './OperationalWorkspacePrimitives'

function renderLineage(value?: string | Date) {
  return render(<WorkspaceModalHeader icon={null} title="Record" subtitle="Persisted record"
    closeControl={null} forensicLineage={{ createdAt: value, updatedAt: value }} />)
}

describe('shared modal forensic timestamps', () => {
  it.each([
    '2026-10-03T01:30:00',
    '2026-10-03T01:30:00Z',
    '2026-10-03T03:30:00+02:00',
    new Date('2026-10-03T01:30:00Z'),
  ])('renders the same instant with an explicit local zone for %s', value => {
    renderLineage(value)
    const expected = new Date('2026-10-03T01:30:00Z').toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    })
    expect(screen.getAllByText(expected)).toHaveLength(2)
  })

  it.each([undefined, 'not-a-date', new Date(Number.NaN)])('marks missing or invalid timestamps unavailable: %s', value => {
    renderLineage(value)
    expect(screen.getAllByText('Unavailable')).toHaveLength(2)
    expect(screen.queryByText('Genesis')).not.toBeInTheDocument()
    expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument()
  })
})
