import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { ProjectVisualShowcase } from './ProjectsVisualShowcase'

function Harness() {
  const [preset, setPreset] = useState<'executive' | 'team'>('executive')
  const project = {
    id: 255,
    name: 'Shared segmented control consumer',
    objective: 'Keep the active showcase preset reachable.',
    status: 'Planning',
    start_date: '2026-09-01',
    end_date: '2026-09-30',
    tasks: [],
    metadata_json: {},
  }
  const report = {
    name: project.name,
    objective: project.objective,
    status: project.status,
    progress: 0,
    health: { level: 'unknown' },
    evidence: { evidencePercent: 0 },
    blockers: [],
    nextActions: [],
    latestUpdates: [],
  }

  return <ProjectVisualShowcase project={project} report={report} snapshot={null} preset={preset} onPresetChange={setPreset} onClose={() => undefined} />
}

describe('Project showcase segmented-control consumer', () => {
  it('keeps the preset selection semantic and operable through the shared responsive control', () => {
    render(<Harness />)
    const group = screen.getByRole('group', { name: 'View selection' })
    expect(group.parentElement).toHaveAttribute('data-golden-segmented-scroll', 'true')
    expect(screen.getByRole('button', { name: 'Executive' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Team review' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Team review' }))

    expect(screen.getByRole('button', { name: 'Team review' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Executive' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('region', { name: /Shared segmented control consumer project showcase/i })).toBeInTheDocument()
  })
})
