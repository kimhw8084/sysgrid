import { describe, expect, it } from 'vitest'
import { buildProjectsDestinationPath, buildProjectsLegacyWorkspacePath, canonicalQueryKeys, parseProjectsLocation, projectRouteForLegacyView, shouldPreserveLegacyProjectsPortfolioLocation } from './ProjectsNavigation'

describe('PV1 Projects canonical navigation', () => {
  it('preserves explicit legacy Portfolio and saved-view state while canonical Portfolio stays clean', () => {
    expect(shouldPreserveLegacyProjectsPortfolioLocation('/projects', '?view=overview')).toBe(true)
    expect(shouldPreserveLegacyProjectsPortfolioLocation('/projects', '?view=portfolio&section=roadmap')).toBe(true)
    expect(shouldPreserveLegacyProjectsPortfolioLocation('/projects', '?saved_view=sv-1')).toBe(true)
    expect(shouldPreserveLegacyProjectsPortfolioLocation('/projects', '?view=portfolio&section=control')).toBe(false)
    expect(shouldPreserveLegacyProjectsPortfolioLocation('/projects', '?view=portfolio')).toBe(false)
    expect(shouldPreserveLegacyProjectsPortfolioLocation('/projects', '?parent=project-1')).toBe(false)
    expect(shouldPreserveLegacyProjectsPortfolioLocation('/projects', '?id=42&view=overview')).toBe(false)
    expect(shouldPreserveLegacyProjectsPortfolioLocation('/projects', '?id=42&view=overview&legacy_workspace=1')).toBe(true)
    expect(parseProjectsLocation('/projects', '?id=42&view=overview&legacy_workspace=1')).toMatchObject({ source: 'legacy', kind: 'home', projectId: '42' })
    expect(shouldPreserveLegacyProjectsPortfolioLocation('/projects', '?id=42&view=tasks&legacy_workspace=1')).toBe(true)
    expect(shouldPreserveLegacyProjectsPortfolioLocation('/projects', '?id=42&view=reports&legacy_workspace=1')).toBe(true)
    expect(shouldPreserveLegacyProjectsPortfolioLocation('/projects', '?id=42&saved_view=sv-1')).toBe(false)
    expect(shouldPreserveLegacyProjectsPortfolioLocation('/projects/42', '?view=overview')).toBe(false)
  })

  it('builds an explicit legacy workspace deep link without dropping its section', () => {
    expect(buildProjectsLegacyWorkspacePath(42, 'insights', 'governance')).toBe('/projects?view=insights&id=42&legacy_workspace=1&section=governance')
  })

  it('keeps migrated project tabs in the workspace with matching active destinations', () => {
    expect(parseProjectsLocation('/projects', '?id=42&view=insights&section=review&legacy_workspace=1')).toMatchObject({ source: 'legacy', kind: 'plan', section: 'review', legacyView: 'insights' })
    expect(parseProjectsLocation('/projects', '?id=42&view=insights&section=risks&legacy_workspace=1')).toMatchObject({ source: 'legacy', kind: 'plan', section: 'risks', legacyView: 'insights' })
    expect(parseProjectsLocation('/projects', '?id=42&view=insights&section=governance&legacy_workspace=1')).toMatchObject({ source: 'legacy', kind: 'outcomes', section: 'governance', legacyView: 'insights' })
    expect(parseProjectsLocation('/projects/42/plan', '?section=brief').legacyView).toBe('insights')
    expect(parseProjectsLocation('/projects/42/plan', '?section=milestones').legacyView).toBe('timeline')
    expect(parseProjectsLocation('/projects/42/plan', '?section=risks').legacyView).toBe('insights')
    expect(parseProjectsLocation('/projects/42/plan', '?section=resources').legacyView).toBe('files')
    expect(parseProjectsLocation('/projects/42/outcomes', '?section=summary').legacyView).toBe('insights')
  })

  it('keeps portfolio, My day, and new-project routes distinct', () => {
    expect(parseProjectsLocation('/projects').kind).toBe('portfolio')
    expect(parseProjectsLocation('/projects/my-day').kind).toBe('my-day')
    expect(parseProjectsLocation('/projects/new?template=qualification').kind).toBe('new')
  })

  it('normalizes invalid enums and ignores unknown query keys', () => {
    const route = parseProjectsLocation('/projects/42/work', '?layout=wat&unknown=drop&panel=task&entity=7')
    expect(route).toMatchObject({ source: 'canonical', kind: 'work', projectId: '42', layout: 'list', panel: 'task', entityId: '7' })
    expect(buildProjectsDestinationPath(42, 'work', { layout: 'board', panel: 'task', entityId: 7 })).toBe('/projects/42/work?layout=board&panel=task&entity=7')
    expect(canonicalQueryKeys(route)).toEqual(['layout', 'section', 'panel', 'entity', 'mode', 'changeset', 'task', 'report', 'showcase', 'saved_view'])
    expect(canonicalQueryKeys(parseProjectsLocation('/projects/new', '?template=qualification&draft=project-id'))).toEqual(['template', 'draft'])
  })

  it('maps the opening project path to Home and retains legacy links', () => {
    expect(parseProjectsLocation('/projects/42').redirectTo).toBe('/projects/42/home')
    expect(parseProjectsLocation('/projects', '?id=42&view=tasks').legacyView).toBe('tasks')
    expect(parseProjectsLocation('/projects', '?id=42&view=tasks&task=7&saved_view=sv-2').redirectTo).toBe('/projects/42/work?layout=list&panel=task&entity=7&saved_view=sv-2')
    expect(parseProjectsLocation('/projects', '?id=42&view=reports&report=rp-4').redirectTo).toBe('/projects/42/updates?section=reports&report=rp-4')
    expect(parseProjectsLocation('/projects', '?id=42&view=updates&section=activity').redirectTo).toBe('/projects/42/updates?section=activity')
    expect(parseProjectsLocation('/projects', '?view=roadmap').redirectTo).toBe('/projects?section=roadmap')
    expect(projectRouteForLegacyView(42, 'reports')).toBe('/projects/42/updates?section=reports')
    expect(projectRouteForLegacyView(42, 'updates', 'activity')).toBe('/projects/42/updates?section=activity')
    expect(projectRouteForLegacyView(42, 'insights', 'review')).toBe('/projects/42/plan?section=brief')
  })

  it('treats invalid project destinations as not found rather than switching projects', () => {
    expect(parseProjectsLocation('/projects/42/nope').source).toBe('not-found')
    expect(parseProjectsLocation('/projects/42/nope').projectId).toBe('42')
  })
})
