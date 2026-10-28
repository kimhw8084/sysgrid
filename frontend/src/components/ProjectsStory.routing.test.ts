import { describe, expect, it } from 'vitest'
import { shouldUseProjectsStory } from './ProjectsStory'

describe('Projects route compatibility', () => {
  it('keeps canonical Portfolio and parent filters on the current story', () => {
    expect(shouldUseProjectsStory('/projects')).toEqual({ kind: 'portfolio' })
    expect(shouldUseProjectsStory('/projects', '?parent=project-1')).toEqual({ kind: 'portfolio' })
  })

  it('preserves legacy Portfolio, saved-view, and nested-section deep links', () => {
    for (const search of ['?id=42', '?view=overview', '?saved_view=sv-1', '?view=portfolio&section=roadmap']) {
      expect(shouldUseProjectsStory('/projects', search), search).toBeNull()
    }
  })
})
