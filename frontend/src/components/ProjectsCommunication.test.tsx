import { describe, expect, it } from 'vitest'
import { shouldUseProjectsCommunication } from './ProjectsCommunication'

describe('P08 project communication routes', () => {
  it('keeps canonical project deep links for updates, resources, and reports', () => {
    expect(shouldUseProjectsCommunication('/projects/p08/updates')).toEqual({ projectId: 'p08', route: 'updates' })
    expect(shouldUseProjectsCommunication('/projects/p08/updates', '?section=activity')).toEqual({ projectId: 'p08', route: 'activity' })
    expect(shouldUseProjectsCommunication('/projects/p08/resources/')).toEqual({ projectId: 'p08', route: 'resources' })
    expect(shouldUseProjectsCommunication('/projects/p08/reports')).toEqual({ projectId: 'p08', route: 'reports' })
    expect(shouldUseProjectsCommunication('/projects/p08/updates', '?section=reports')).toEqual({ projectId: 'p08', route: 'reports' })
  })

  it('does not capture unrelated project routes', () => {
    expect(shouldUseProjectsCommunication('/projects/p08/home')).toBeNull()
    expect(shouldUseProjectsCommunication('/projects/p08/plan')).toBeNull()
  })
})
