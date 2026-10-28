import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildProjectSavedViewIdentitySearch,
  buildProjectSavedViewMutationPayload,
  buildProjectSavedViewShareSearch,
  projectSavedViewConflictFromError,
  projectSavedViewLinkedRemoteId,
  projectSavedViewOptionFromRemoteRecord,
  projectSavedViewOptionLabel,
  projectSavedViewSectionFromSearch,
  projectSavedViewStateForSelection,
  projectSavedViewStatesEqual,
  reconcileProjectSavedViewOptions,
  removeProjectRemoteSavedViewPayload,
  resolveProjectCurrentOperator,
  resolveProjectCurrentTeamId,
  upsertProjectRemoteSavedViewPayload,
} from './ProjectsGolden.savedViews'

describe('Projects shared saved-view integration', () => {
  const flushIdentity = async (turns = 1) => {
    for (let turn = 0; turn < turns; turn += 1) await new Promise((resolve) => window.setTimeout(resolve, 0))
  }

  beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState({}, '', '/projects?view=overview')
    resolveProjectCurrentTeamId([], 'admin_root')
  })

  afterEach(async () => {
    await flushIdentity(3)
  })

  it('keeps personal hydration inert while preserving same-named legacy local views', () => {
    const local = [{ id: 'legacy-1', name: 'Daily Focus', search: 'local needle', view: 'tasks' }]
    const personal = { views: [{
      id: 41, workspace_key: 'projects', scope: 'personal', team_id: null, name: 'Daily Focus', schema_version: 1, revision: 3,
      definition: { searchTerm: 'remote needle', filters: { status: ['In Progress'], priority: ['High'], watch: ['watched'] }, activeTab: 'portfolio', mode: 'deadline' },
    }] }

    const options = reconcileProjectSavedViewOptions(local, personal)
    expect(options.map(projectSavedViewOptionLabel)).toEqual(['Daily Focus · Personal', 'Daily Focus · Local'])
    expect(local[0].search).toBe('local needle')
    expect(options[0].state.search).toBe('remote needle')
    expect(options[1].state.search).toBe('local needle')
  })

  it('reconciles only the authoritative current team and orders default/favorite metadata deterministically', () => {
    const personal = { views: [
      { id: 1, workspace_key: 'projects', scope: 'personal', team_id: null, name: 'Plain', schema_version: 1, revision: 1, definition: { activeTab: 'overview' } },
      { id: 2, workspace_key: 'projects', scope: 'personal', team_id: null, name: 'Favorite', is_favorite: true, schema_version: 1, revision: 1, definition: { activeTab: 'overview' } },
      { id: 3, workspace_key: 'projects', scope: 'personal', team_id: null, name: 'Default', is_default: true, schema_version: 1, revision: 1, definition: { activeTab: 'overview' } },
    ] }
    const team = { views: [
      { id: 10, workspace_key: 'projects', scope: 'team', team_id: 42, name: 'Team Lens', schema_version: 1, revision: 2, definition: { activeTab: 'reports' } },
      { id: 11, workspace_key: 'projects', scope: 'team', team_id: 99, name: 'Other Team', schema_version: 1, revision: 2, definition: { activeTab: 'tasks' } },
    ] }
    const options = reconcileProjectSavedViewOptions([{ id: 'l', name: 'Legacy', view: 'tasks' }], personal, team, 42)
    expect(options.map(projectSavedViewOptionLabel)).toEqual([
      'Default · Personal · Default',
      'Favorite · Personal · Favorite',
      'Plain · Personal',
      'Team Lens · Team',
      'Legacy · Local',
    ])
    expect(options.some((option) => option.name === 'Other Team')).toBe(false)
  })

  it('bounds malformed remote rows through the accepted Projects workspace adapter', () => {
    const options = reconcileProjectSavedViewOptions([], { views: [
      { id: 5, workspace_key: 'projects', scope: 'personal', team_id: null, name: '  Remote   Lens  ', schema_version: 1, revision: 2,
        definition: { searchTerm: '  needle  ', filters: { status: ['Blocked', 'Planning'], priority: ['Highest'], watch: ['watched', 'other'] }, activeTab: 'not-a-tab', mode: 'not-a-mode', unsupported: 'ignored' } },
      { id: 6, workspace_key: 'projects', scope: 'team', team_id: null, name: 'Bad team', schema_version: 1, revision: 1, definition: { activeTab: 'tasks' } },
    ] })
    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({ id: 'remote:5', name: 'Remote Lens', scope: 'personal', remoteId: 5, revision: 2 })
    expect(options[0].state).toEqual({ search: 'needle', statusFilter: 'Blocked', priorityFilter: 'Highest', sortMode: 'order', watchedOnly: true, view: 'overview' })
  })

  it('drops unusable remote rows and leaves local fallback selectable', () => {
    const options = reconcileProjectSavedViewOptions([{ id: 'local-7', name: 'Local Fallback', search: 'fallback', view: 'tasks' }], { views: [
      { id: 0, workspace_key: 'projects', name: 'Bad id', schema_version: 1, revision: 1, definition: { activeTab: 'board' } },
      { id: 8, workspace_key: 'projects', name: 'Bad schema', schema_version: 2, revision: 1, definition: { activeTab: 'board' } },
      { id: 9, workspace_key: 'projects', name: 'Bad definition', schema_version: 1, revision: 1, definition: [] },
      { id: 10, workspace_key: 'other', name: 'Wrong workspace', schema_version: 1, revision: 1, definition: { activeTab: 'board' } },
      { id: 11, workspace_key: 'projects', name: 'Missing revision', schema_version: 1, definition: { activeTab: 'board' } },
    ] })
    expect(options).toHaveLength(1)
    expect(options[0].source).toBe('local')
    expect(projectSavedViewStateForSelection(options, options[0].id)?.search).toBe('fallback')
  })

  it('builds normalized personal and team mutation payloads without changing scope on update', () => {
    const state = { search: '  needle  ', statusFilter: 'all', priorityFilter: 'Highest', sortMode: 'DEADLINE', watchedOnly: true, view: 'reports' }
    expect(buildProjectSavedViewMutationPayload('  Release   Lens  ', state, 7)).toMatchObject({ name: 'Release Lens', scope: 'personal', team_id: null, revision: 7 })
    expect(buildProjectSavedViewMutationPayload(' Team Lens ', state, 4, 'team', 42)).toMatchObject({ name: 'Team Lens', scope: 'team', team_id: 42, revision: 4 })
    expect((buildProjectSavedViewMutationPayload('Team Lens', state, undefined, 'team', 42) as any).definition).toEqual({
      searchTerm: 'needle', filters: { status: [], priority: ['Highest'], watch: ['watched'] }, activeTab: 'reports', mode: 'deadline',
    })
  })

  it('tracks dirty state only across normalized Project saved-view fields', () => {
    expect(projectSavedViewStatesEqual(
      { search: ' needle ', statusFilter: 'all', priorityFilter: 'ALL', sortMode: 'ORDER', watchedOnly: false, view: 'overview' },
      { search: 'needle', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, view: 'overview' },
    )).toBe(true)
    expect(projectSavedViewStatesEqual(
      { search: 'needle', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, view: 'overview' },
      { search: 'changed', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, view: 'overview' },
    )).toBe(false)
  })

  it('parses personal and team stale-revision conflicts without applying server state automatically', () => {
    const conflict = projectSavedViewConflictFromError({ status: 409, data: { detail: { message: 'Saved view changed on the server.', current: {
      id: 22, workspace_key: 'projects', scope: 'team', team_id: 42, name: 'Server Focus', schema_version: 1, revision: 4,
      definition: { searchTerm: ' server newer ', filters: { status: ['Blocked'], priority: [], watch: [] }, activeTab: 'tasks', mode: 'health' },
    } } } })
    expect(conflict?.message).toBe('Saved view changed on the server.')
    expect(conflict?.option).toMatchObject({ id: 'remote:22', name: 'Server Focus', scope: 'team', teamId: 42, revision: 4 })
    expect(conflict?.option.state.search).toBe('server newer')
  })

  it('resolves only the current operator primary team id', () => {
    expect(resolveProjectCurrentTeamId([{ username: 'admin_root', team_id: 42 }, { username: 'other', team_id: 99 }], 'admin_root')).toBe(42)
    expect(resolveProjectCurrentTeamId([{ username: 'admin_root', team_id: null }], 'admin_root')).toBeNull()
    expect(resolveProjectCurrentTeamId([{ username: 'other', team_id: 99 }], 'admin_root')).toBeNull()
  })

  it('resolves the authenticated operator by username or external identity', () => {
    const operators = [
      { external_id: 'company-user-42', username: 'haewon', team_id: 42 },
      { external_id: 'company-user-99', username: 'other', team_id: 99 },
    ]
    expect(resolveProjectCurrentOperator(operators, 'company-user-42')).toEqual(operators[0])
    expect(resolveProjectCurrentTeamId(operators, 'company-user-42')).toBe(42)
    expect(resolveProjectCurrentOperator(operators, 'missing')).toBeNull()
    expect(resolveProjectCurrentTeamId(operators, 'missing')).toBeNull()
  })

  it('builds collision-safe saved_view links while preserving Project route/deep-link params', () => {
    expect(projectSavedViewLinkedRemoteId('41')).toBe(41)
    expect(projectSavedViewLinkedRemoteId('nope')).toBeNull()
    const params = new URLSearchParams(buildProjectSavedViewShareSearch('view=reports&id=7&report=22&section=review', 41))
    expect(Object.fromEntries(params.entries())).toEqual({ view: 'reports', id: '7', report: '22', section: 'review', saved_view: '41' })
  })

  it('converges saved_view identity across remote selection, local replacement, synced creation and deletion without dropping route context', async () => {
    const remote = projectSavedViewOptionFromRemoteRecord({
      id: 41, workspace_key: 'projects', scope: 'personal', team_id: null, name: 'Remote report', schema_version: 1, revision: 1,
      definition: { searchTerm: 'remote report', filters: { status: [], priority: [], watch: [] }, activeTab: 'reports', mode: 'order' },
    })
    const local = { id: 'local:proof:0', name: 'Local report', source: 'local' as const, state: { search: 'local report', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order' as const, watchedOnly: false, view: 'reports' as const } }
    const options = remote ? [remote, local] : [local]

    window.history.replaceState({}, '', '/projects?view=reports&id=7&report=22&section=review&saved_view=9#proof')
    const identity = new URLSearchParams(buildProjectSavedViewIdentitySearch(window.location.search, 41))
    expect(Object.fromEntries(identity.entries())).toEqual({ view: 'reports', id: '7', report: '22', section: 'review', saved_view: '41' })

    expect(projectSavedViewStateForSelection(options, 'remote:41')?.search).toBe('remote report')
    await flushIdentity()
    expect(new URLSearchParams(window.location.search).get('saved_view')).toBe('41')
    expect(window.location.hash).toBe('#proof')
    expect(new URLSearchParams(window.location.search).get('report')).toBe('22')

    expect(projectSavedViewStateForSelection(options, 'local:proof:0')?.search).toBe('local report')
    await flushIdentity()
    expect(new URLSearchParams(window.location.search).has('saved_view')).toBe(false)
    expect(new URLSearchParams(window.location.search).get('id')).toBe('7')

    const inserted = { id: 52, workspace_key: 'projects', scope: 'personal', team_id: null, name: 'Created report', schema_version: 1, revision: 1, definition: { activeTab: 'reports' } }
    const payload = upsertProjectRemoteSavedViewPayload({ views: [] }, inserted) as any
    await flushIdentity()
    expect(payload.views[0].id).toBe(52)
    expect(new URLSearchParams(window.location.search).get('saved_view')).toBe('52')

    removeProjectRemoteSavedViewPayload(payload, 52)
    await flushIdentity()
    expect(new URLSearchParams(window.location.search).has('saved_view')).toBe(false)
    expect(new URLSearchParams(window.location.search).get('view')).toBe('reports')
    expect(new URLSearchParams(window.location.search).get('report')).toBe('22')
  })

  it('cleans a missing saved_view only after authoritative hydration and preserves the same link when hydration is unavailable', async () => {
    resolveProjectCurrentTeamId([{ username: 'admin_root', team_id: null }], 'admin_root')
    window.history.replaceState({}, '', '/projects?view=overview&saved_view=999999')
    reconcileProjectSavedViewOptions([], { views: [] }, undefined, null)
    await flushIdentity(3)
    expect(new URLSearchParams(window.location.search).has('saved_view')).toBe(false)
    expect(new URLSearchParams(window.location.search).get('view')).toBe('overview')

    window.history.replaceState({}, '', '/projects?view=overview&saved_view=888888')
    reconcileProjectSavedViewOptions([], undefined, undefined, null)
    await flushIdentity(3)
    expect(new URLSearchParams(window.location.search).get('saved_view')).toBe('888888')
  })

  it('resumes stale-link cleanup when operator hydration later resolves to no team without another saved-view reconcile', async () => {
    resolveProjectCurrentTeamId([], 'admin_root')
    window.history.replaceState({}, '', '/projects?view=portfolio&section=owners&saved_view=777777')
    reconcileProjectSavedViewOptions([], { views: [] }, undefined, null)
    await flushIdentity(2)
    expect(new URLSearchParams(window.location.search).get('saved_view')).toBe('777777')

    resolveProjectCurrentTeamId([{ username: 'admin_root', team_id: null }], 'admin_root')
    await new Promise((resolve) => window.setTimeout(resolve, 80))
    await flushIdentity(2)
    expect(new URLSearchParams(window.location.search).has('saved_view')).toBe(false)
    expect(new URLSearchParams(window.location.search).get('view')).toBe('portfolio')
    expect(new URLSearchParams(window.location.search).get('section')).toBe('owners')
  })

  it('updates remote caches deterministically without touching local saved-view storage', () => {
    const payload = { views: [{ id: 1, workspace_key: 'projects', scope: 'personal', team_id: null, name: 'Old', schema_version: 1, revision: 1, definition: { activeTab: 'overview' } }] }
    const replacement = { id: 1, workspace_key: 'projects', scope: 'personal', team_id: null, name: 'Updated', schema_version: 1, revision: 2, definition: { activeTab: 'tasks' } }
    const inserted = { id: 2, workspace_key: 'projects', scope: 'personal', team_id: null, name: 'New', schema_version: 1, revision: 1, definition: { activeTab: 'board' } }
    expect((upsertProjectRemoteSavedViewPayload(payload, replacement) as any).views.map((row: any) => [row.id, row.name])).toEqual([[1, 'Updated']])
    const withNew = upsertProjectRemoteSavedViewPayload(payload, inserted) as any
    expect(withNew.views.map((row: any) => row.id)).toEqual([2, 1])
    expect((removeProjectRemoteSavedViewPayload(withNew, 2) as any).views.map((row: any) => row.id)).toEqual([1])
  })

  it('persists and restores nested Portfolio and Insights sections without widening the workspace schema', () => {
    window.history.replaceState({}, '', '/projects?view=portfolio&section=roadmap')
    const portfolioPayload = buildProjectSavedViewMutationPayload('Roadmap lens', {
      search: '', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, view: 'portfolio',
    }) as any
    expect(portfolioPayload.definition).toMatchObject({ activeTab: 'portfolio', filters: { watch: ['sysgrid:project-section:roadmap'] } })
    expect(portfolioPayload.definition).not.toHaveProperty('section')

    const roadmap = projectSavedViewOptionFromRemoteRecord({
      id: 51, workspace_key: 'projects', scope: 'personal', team_id: null, name: 'Roadmap lens', schema_version: 1, revision: 1,
      definition: { searchTerm: '', filters: { status: [], priority: [], watch: ['sysgrid:project-section:roadmap'] }, activeTab: 'portfolio', mode: 'order' },
    })
    expect(roadmap?.state).toMatchObject({ view: 'roadmap', watchedOnly: false })

    window.history.replaceState({}, '', '/projects?view=insights&section=governance')
    const governancePayload = buildProjectSavedViewMutationPayload('Governance lens', {
      search: '', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, view: 'insights',
    }) as any
    expect(governancePayload.definition).toMatchObject({ activeTab: 'insights', filters: { watch: ['sysgrid:project-section:governance'] } })
    expect(governancePayload.definition).not.toHaveProperty('section')
    const governance = projectSavedViewOptionFromRemoteRecord({
      id: 52, workspace_key: 'projects', scope: 'team', team_id: 42, name: 'Governance lens', schema_version: 1, revision: 2,
      definition: { searchTerm: '', filters: { status: [], priority: [], watch: ['sysgrid:project-section:governance'] }, activeTab: 'insights', mode: 'order' },
    })
    expect(governance?.state.view).toBe('governance')
  })

  it('keeps legacy defaults but preserves an explicit nested section carried by a matching saved_view link', () => {
    const legacy = projectSavedViewOptionFromRemoteRecord({
      id: 61, workspace_key: 'projects', scope: 'personal', team_id: null, name: 'Legacy portfolio', schema_version: 1, revision: 1,
      definition: { activeTab: 'portfolio' },
    })
    expect(legacy?.state.view).toBe('portfolio')
    const options = legacy ? [legacy] : []

    window.history.replaceState({}, '', '/projects?view=portfolio&section=owners&saved_view=61')
    expect(projectSavedViewStateForSelection(options, 'remote:61')?.view).toBe('owners')

    window.history.replaceState({}, '', '/projects?view=portfolio&section=owners&saved_view=99')
    expect(projectSavedViewStateForSelection(options, 'remote:61')?.view).toBe('portfolio')
  })

  it('captures nested section metadata only for local rows not yet persisted, while legacy rows keep safe defaults', () => {
    window.localStorage.removeItem('sysgrid_projects_saved_view_sections_v1')
    const newId = String(Date.now())
    const fresh = { id: newId, name: 'Local roadmap', view: 'portfolio' }
    window.localStorage.setItem('sysgrid_projects_workbench_v1', JSON.stringify({ savedViews: [fresh] }))
    window.history.replaceState({}, '', '/projects?view=portfolio&section=roadmap')
    const localOptions = reconcileProjectSavedViewOptions([fresh], { views: [] })
    expect(localOptions[0].state.view).toBe('roadmap')
    expect(JSON.parse(window.localStorage.getItem('sysgrid_projects_saved_view_sections_v1') || '{}')).toMatchObject({ [newId]: 'roadmap' })
    expect(JSON.parse(window.localStorage.getItem('sysgrid_projects_workbench_v1') || '{}').savedViews[0]).toMatchObject({ id: newId, section: 'roadmap' })

    const legacy = { id: 'legacy-existing', name: 'Legacy local', view: 'portfolio' }
    window.localStorage.removeItem('sysgrid_projects_saved_view_sections_v1')
    window.localStorage.setItem('sysgrid_projects_workbench_v1', JSON.stringify({ savedViews: [legacy] }))
    window.history.replaceState({}, '', '/projects?view=portfolio&section=owners')
    const legacyOptions = reconcileProjectSavedViewOptions([legacy], { views: [] })
    expect(legacyOptions[0].state.view).toBe('portfolio')

    const replacement = { id: String(Date.now() + 1), name: 'Replace me', view: 'insights' }
    window.localStorage.setItem('sysgrid_projects_workbench_v1', JSON.stringify({ savedViews: [replacement] }))
    window.history.replaceState({}, '', '/projects?view=insights&section=governance')
    const replacementOptions = reconcileProjectSavedViewOptions([replacement], { views: [] })
    expect(replacementOptions[0].state.view).toBe('governance')
  })

  it('tracks nested section changes as saved-view dirty state and normalizes default sections', () => {
    const savedRoadmap = { search: '', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, view: 'roadmap' }
    const currentPortfolio = { search: '', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, view: 'portfolio' }
    window.history.replaceState({}, '', '/projects?view=portfolio&section=roadmap')
    expect(projectSavedViewStatesEqual(savedRoadmap, currentPortfolio)).toBe(true)
    window.history.replaceState({}, '', '/projects?view=portfolio&section=owners')
    expect(projectSavedViewStatesEqual(savedRoadmap, currentPortfolio)).toBe(false)

    window.history.replaceState({}, '', '/projects?view=portfolio&section=control')
    expect(projectSavedViewStatesEqual({ ...currentPortfolio, view: 'portfolio' }, currentPortfolio)).toBe(true)
    expect(projectSavedViewSectionFromSearch('?view=insights&section=governance')).toBe('governance')
    expect(projectSavedViewSectionFromSearch('?view=tasks&section=governance')).toBeNull()
  })

})
