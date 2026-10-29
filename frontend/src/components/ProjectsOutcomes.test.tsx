import { describe, expect, it } from 'vitest'
import { formatOutcomeCurrency, formatOutcomePercent, formatOutcomeValue, shouldUseProjectsOutcomes } from './ProjectsOutcomes'

describe('Projects Outcomes route and display helpers', () => {
  it('recognizes canonical and encoded project outcome routes', () => {
    expect(shouldUseProjectsOutcomes('/projects/project-9/outcomes')).toEqual({ projectId: 'project-9' })
    expect(shouldUseProjectsOutcomes('/projects/project%209/outcomes/')).toEqual({ projectId: 'project 9' })
    expect(shouldUseProjectsOutcomes('/projects/project-9/home')).toBeNull()
  })

  it('does not invent missing outcome values', () => {
    expect(formatOutcomeValue(null, '%')).toBe('Not recorded')
    expect(formatOutcomeValue('80', '%')).toBe('80 %')
  })

  it('formats amounts and rates for human review', () => {
    expect(formatOutcomeCurrency('12000.00000000', 'USD')).toBe('$12,000')
    expect(formatOutcomeCurrency('12500.5', 'USD')).toBe('$12,500.5')
    expect(formatOutcomeCurrency('4.250000', 'hours')).toBe('4.250000 hours')
    expect(formatOutcomePercent('12.34567')).toBe('12.35%')
  })
})
