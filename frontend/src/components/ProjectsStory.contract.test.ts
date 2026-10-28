import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.resolve(__dirname, 'ProjectsStory.tsx'), 'utf8')
const api = fs.readFileSync(path.resolve(__dirname, 'ProjectsStory.api.ts'), 'utf8')
const css = fs.readFileSync(path.resolve(__dirname, 'ProjectsStory.css'), 'utf8')
const scheduling = fs.readFileSync(path.resolve(__dirname, 'ProjectsSchedulingCompletion.tsx'), 'utf8')

describe('P04 creation, Portfolio, and Home ownership', () => {
  it('routes only the P04 story surfaces to v2 and preserves retained workspace ownership elsewhere', () => {
    for (const route of ["pathname === '/projects'", "pathname === '/projects/new'", '/projects\\/([^/]+)\\/home']) expect(source).toContain(route)
    expect(source).toContain("params.has('id') || params.has('view') || params.has('saved_view') || params.has('section')")
    expect(scheduling).toContain('if (shouldUseProjectsStory(location.pathname, location.search)) return <ProjectsStory />')
    expect(scheduling).toContain('if (shouldUseProjectsWorkPlan(location.pathname, location.search)) return <ProjectsWorkPlan />')
    expect(scheduling).toContain('const timeline = shouldUseProjectsTimeline(location.pathname)')
    expect(api).toContain("/api/v2/projects")
    expect(scheduling).toContain("apiFetch('/api/v1/projects')")
  })

  it('implements the fixed four-step creation grammar and honest server save states', () => {
    for (const label of ['Purpose', 'Success', 'Delivery plan', 'Review']) expect(source).toContain(label)
    for (const marker of ['data-p04-new-project', 'project.save_creation_draft', 'Save failed', 'Create project', 'Discard', 'Draft saved']) expect(source + api).toContain(marker)
    for (const prompt of ['What problem are we solving?', 'What will change?', 'What will be true when delivery is done?', 'How will we know it helped?']) expect(source).toContain(prompt)
    expect(source).toContain('Your entries are retained; no success was recorded.')
    expect(api).not.toContain('timezone: string')
  })

  it('renders management Portfolio fields, exclusive summary labels, timeline, and actionable attention', () => {
    for (const label of ['Planned', 'Active', 'Delivered', 'Paused', 'Cancelled', 'Needs attention', 'Measuring', 'Realized', 'Closed below target']) expect(source).toContain(label)
    for (const label of ['Project', 'Owner', 'Phase', 'Health', 'Delivery', 'Next milestone', 'Target', 'Outcomes']) expect(source).toContain(label)
    for (const marker of ['data-p04-portfolio', 'data-p04-portfolio-timeline', 'data-p04-attention']) expect(source).toContain(marker)
  })

  it('keeps the Home first viewport management-readable and ordinary surfaces on semantic tokens', () => {
    for (const label of ['Owner', 'Phase', 'Health', 'Priority', 'Start → Target', 'Next milestone', 'Primary metric', 'Open Outcomes', 'Forecast unavailable — schedule required work', 'View activity']) expect(source).toContain(label)
    for (const label of ['Project brief', 'Latest published update', 'Key resources', 'Architecture impact', 'Risks & decisions']) expect(source).toContain(label)
    expect(source).toContain('data-p04-project-home')
    expect(source).toContain('data-p04-legacy-workspace')
    expect(source).toContain('Open existing workspace')
    expect(css).not.toContain('background:#000')
    expect(css).not.toContain('background:rgb(0 0 0')
    expect(css).toContain('font-size:28px')
    expect(css).toContain('@media (max-width:767px)')
  })
})
