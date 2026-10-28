import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState, testApiHeaders, waitForAppIdle } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const storageKey = 'sysgrid_projects_workbench_v1'
const currentUserId = testApiHeaders['X-User-Id']

test.use({ viewport: { width: 900, height: 900 } })

const installProjectState = async (page: any, state: Record<string, unknown>) => {
  await page.addInitScript(({ key, value }) => {
    const marker = '__sysgrid_projects_workbench_seeded__'
    if (window.sessionStorage.getItem(marker)) return
    window.localStorage.setItem(key, JSON.stringify(value))
    window.sessionStorage.setItem(marker, 'true')
  }, { key: storageKey, value: state })
}

const readProjectState = async (page: any) => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || '{}'), storageKey)
const openWorkspaceActions = async (page: any) => {
  const actions = page.locator("details.sg-workspace-actions")
  if (!(await actions.evaluate((element: HTMLDetailsElement) => element.open))) {
    await actions.locator("summary").click()
  }
}


const listProjectViews = async (page: any, scope: 'personal' | 'team' = 'personal', teamId?: number) => {
  const query = scope === 'team' ? `?scope=team&team_id=${teamId}` : ''
  const response = await page.request.get(`${apiBase}/workspaces/projects/views${query}`, { headers: testApiHeaders })
  expect(response.ok()).toBeTruthy()
  return response.json()
}

const findRemoteView = async (page: any, name: string, scope: 'personal' | 'team' = 'personal', teamId?: number) => {
  const payload = await listProjectViews(page, scope, teamId)
  return payload.views.find((view: any) => view.name === name)
}

const projectViewDefinition = (searchTerm: string, activeTab = 'overview', mode = 'order', section?: 'control' | 'roadmap' | 'owners' | 'review' | 'governance') => ({
  searchTerm,
  filters: { status: [], priority: [], watch: section ? [`sysgrid:project-section:${section}`] : [] },
  activeTab,
  mode,
})

const ensureCurrentUserTeam = async (page: any, name: string) => {
  const teamsResponse = await page.request.get(`${apiBase}/settings/teams`, { headers: testApiHeaders })
  expect(teamsResponse.ok()).toBeTruthy()
  const teams = await teamsResponse.json()
  let team = teams.find((row: any) => row.name === name)
  if (!team) {
    const createTeam = await page.request.post(`${apiBase}/settings/teams`, { headers: testApiHeaders, data: { name, description: 'Projects saved-view proof team' } })
    expect(createTeam.ok()).toBeTruthy()
    team = await createTeam.json()
  }

  const operatorsResponse = await page.request.get(`${apiBase}/settings/operators`, { headers: testApiHeaders })
  expect(operatorsResponse.ok()).toBeTruthy()
  const operators = await operatorsResponse.json()
  let operator = operators.find((row: any) => row.username === currentUserId)
  if (!operator) {
    const createOperator = await page.request.post(`${apiBase}/settings/operators`, {
      headers: testApiHeaders,
      data: { external_id: currentUserId, username: currentUserId, full_name: currentUserId, team_id: team.id },
    })
    expect(createOperator.ok()).toBeTruthy()
    operator = await createOperator.json()
  } else if (operator.team_id !== team.id) {
    const assign = await page.request.patch(`${apiBase}/settings/operators/${operator.id}`, { headers: testApiHeaders, data: { team_id: team.id } })
    expect(assign.ok()).toBeTruthy()
  }
  return team
}

test.describe('Projects shared saved views', () => {
  test('hydrates without applying, then applies a normalized personal remote view only after explicit selection', async ({ page }) => {
    await resetBrowserState(page)
    const create = await page.request.post(`${apiBase}/workspaces/projects/views`, {
      headers: testApiHeaders,
      data: { name: 'Daily Focus', scope: 'personal', definition: { searchTerm: 'remote needle', filters: { status: ['In Progress'], priority: ['High'], watch: ['watched'] }, activeTab: 'portfolio', mode: 'deadline' }, schema_version: 1 },
    })
    expect(create.ok()).toBeTruthy()
    await installProjectState(page, { search: 'active local', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, savedViews: [{ id: 'legacy-1', name: 'Daily Focus', search: 'legacy local', view: 'tasks' }], lastView: 'overview' })

    await page.goto('/projects?view=overview')
    await waitForAppIdle(page)
    await expect(page.getByPlaceholder('Find projects, objectives, owners…')).toHaveValue('active local')
    await openWorkspaceActions(page)
    await page.getByRole('button', { name: 'Saved views', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Daily Focus · Personal', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Daily Focus · Local', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Daily Focus · Personal', exact: true }).click()

    await expect(page).toHaveURL(/view=portfolio/)
    await expect(page.getByPlaceholder('Find projects, objectives, owners…')).toHaveValue('remote needle')
    await expect(page.locator('[data-project-saved-view-status="synced"]')).toBeVisible()
    await expect(page.locator('[data-project-saved-view-scope="personal"]')).toBeVisible()
  })

  test('restores the exact nested Portfolio section from a synced saved view', async ({ page }) => {
    await resetBrowserState(page)
    const viewName = `Iteration 6 Roadmap ${Date.now()}`
    const create = await page.request.post(`${apiBase}/workspaces/projects/views`, {
      headers: testApiHeaders,
      data: { name: viewName, scope: 'personal', definition: projectViewDefinition('roadmap lens', 'portfolio', 'health', 'roadmap'), schema_version: 1 },
    })
    expect(create.ok(), await create.text()).toBeTruthy()
    await installProjectState(page, { search: 'before roadmap', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, savedViews: [], lastView: 'overview' })

    await page.goto('/projects?view=overview')
    await waitForAppIdle(page)
    await openWorkspaceActions(page)
    await page.getByRole('button', { name: 'Saved views', exact: true }).click()
    await page.getByRole('button', { name: `${viewName} · Personal`, exact: true }).click()

    await expect(page).toHaveURL(/view=portfolio/)
    await expect(page).toHaveURL(/section=roadmap/)
    await expect(page.getByPlaceholder('Find projects, objectives, owners…')).toHaveValue('roadmap lens')
  })

  test('restores a locally saved nested Portfolio section after leaving the view', async ({ page }) => {
    await resetBrowserState(page)
    await installProjectState(page, { search: '', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, savedViews: [], lastView: 'portfolio' })

    await page.goto('/projects?view=portfolio&section=roadmap')
    await waitForAppIdle(page)
    await openWorkspaceActions(page)
    await page.getByRole('button', { name: 'Save view', exact: true }).click()
    await page.getByLabel('View name').fill('Iteration 6 Local Roadmap')
    await page.getByRole('button', { name: 'Save local', exact: true }).click()
    await expect.poll(async () => (await readProjectState(page)).savedViews?.some((view: any) => view.name === 'Iteration 6 Local Roadmap')).toBeTruthy()

    await page.goto('/projects?view=overview')
    await waitForAppIdle(page)
    await openWorkspaceActions(page)
    await page.getByRole('button', { name: 'Saved views', exact: true }).click()
    await page.getByRole('button', { name: 'Iteration 6 Local Roadmap · Local', exact: true }).click()

    await expect(page).toHaveURL(/view=portfolio/)
    await expect(page).toHaveURL(/section=roadmap/)
  })

  test('preserves a linked legacy Portfolio subsection instead of falling back to Control Tower', async ({ page }) => {
    await resetBrowserState(page)
    const viewName = `Iteration 6 Legacy Owners ${Date.now()}`
    const create = await page.request.post(`${apiBase}/workspaces/projects/views`, {
      headers: testApiHeaders,
      data: { name: viewName, scope: 'personal', definition: projectViewDefinition('owners link', 'portfolio', 'health'), schema_version: 1 },
    })
    expect(create.ok(), await create.text()).toBeTruthy()
    const linked = await create.json()
    await installProjectState(page, { search: 'before owners link', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, savedViews: [], lastView: 'portfolio' })

    await page.goto(`/projects?view=portfolio&section=owners&saved_view=${linked.id}`)
    await waitForAppIdle(page)

    await expect(page).toHaveURL(/view=portfolio/)
    await expect(page).toHaveURL(/section=owners/)
    await expect(page).toHaveURL(new RegExp(`saved_view=${linked.id}`))
    await expect(page.getByPlaceholder('Find projects, objectives, owners…')).toHaveValue('owners link')
  })

  test('saved-view URL identity follows explicit remote selection and local replacement', async ({ page }) => {
    await resetBrowserState(page)
    const viewName = `Iteration 7 Identity Selection ${Date.now()}`
    const create = await page.request.post(`${apiBase}/workspaces/projects/views`, {
      headers: testApiHeaders,
      data: { name: viewName, scope: 'personal', definition: projectViewDefinition('identity remote', 'portfolio', 'health', 'owners'), schema_version: 1 },
    })
    expect(create.ok(), await create.text()).toBeTruthy()
    const remote = await create.json()
    await installProjectState(page, { search: 'identity local baseline', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, savedViews: [{ id: 'identity-local', name: 'Identity Local', search: 'identity local', view: 'overview' }], lastView: 'portfolio' })

    await page.goto('/projects?view=portfolio&section=roadmap')
    await waitForAppIdle(page)
    await openWorkspaceActions(page)
    await page.getByRole('button', { name: 'Saved views', exact: true }).click()
    await page.getByRole('button', { name: `${viewName} · Personal`, exact: true }).click()

    await expect(page).toHaveURL(/view=portfolio/)
    await expect(page).toHaveURL(/section=owners/)
    await expect.poll(() => new URL(page.url()).searchParams.get('saved_view')).toBe(String(remote.id))
    await expect(page.getByPlaceholder('Find projects, objectives, owners…')).toHaveValue('identity remote')

    await page.getByRole('button', { name: `${viewName} · Personal`, exact: true }).click()
    await page.getByRole('button', { name: 'Identity Local · Local', exact: true }).click()
    await expect(page).toHaveURL(/view=overview/)
    await expect.poll(() => new URL(page.url()).searchParams.get('saved_view')).toBeNull()
    await expect(page.getByPlaceholder('Find projects, objectives, owners…')).toHaveValue('identity local')
  })

  test('saved-view URL identity follows synced creation and deletion', async ({ page }) => {
    await resetBrowserState(page)
    const viewName = `Iteration 7 Identity Lifecycle ${Date.now()}`
    await installProjectState(page, { search: 'identity create', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, savedViews: [], lastView: 'overview' })

    await page.goto('/projects?view=overview')
    await waitForAppIdle(page)
    await openWorkspaceActions(page)
    await page.getByRole('button', { name: 'Save view', exact: true }).click()
    await page.getByLabel('View name').fill(viewName)
    await page.getByRole('button', { name: 'Save personal', exact: true }).click()
    await expect(page.locator('[data-project-saved-view-status="synced"]')).toBeVisible()

    const remote = await findRemoteView(page, viewName)
    expect(remote?.id).toBeTruthy()
    await expect.poll(() => new URL(page.url()).searchParams.get('saved_view')).toBe(String(remote.id))
    await expect(page).toHaveURL(/view=overview/)

    await page.getByRole('button', { name: 'Delete synced', exact: true }).click()
    await page.getByRole('button', { name: 'Delete synced view', exact: true }).click()
    await expect(page.getByText('Synced Project view deleted', { exact: true })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Delete Synced Project View', exact: true })).toBeHidden()
    await expect.poll(() => new URL(page.url()).searchParams.get('saved_view')).toBeNull()
    await expect(page).toHaveURL(/view=overview/)
  })

  test('saved-view URL identity removes authoritative stale links but preserves them while hydration is offline', async ({ page }) => {
    await resetBrowserState(page)
    await installProjectState(page, { search: 'stale identity', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, savedViews: [], lastView: 'portfolio' })
    await page.goto('/projects?view=portfolio&section=owners&saved_view=999999')
    await waitForAppIdle(page)
    await expect.poll(() => new URL(page.url()).searchParams.get('saved_view')).toBeNull()
    await expect(page).toHaveURL(/view=portfolio/)
    await expect(page).toHaveURL(/section=owners/)

    await page.route('**/api/v1/workspaces/projects/views*', async (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'identity proof outage' }) })
      return route.continue()
    })
    await resetBrowserState(page)
    await installProjectState(page, { search: 'offline identity', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, savedViews: [], lastView: 'portfolio' })
    await page.goto('/projects?view=portfolio&section=roadmap&saved_view=888888')
    await waitForAppIdle(page)
    await expect.poll(() => new URL(page.url()).searchParams.get('saved_view')).toBe('888888')
    await expect(page).toHaveURL(/view=portfolio/)
    await expect(page).toHaveURL(/section=roadmap/)
  })

  test('preserves active state and local saved-view use when personal remote hydration fails', async ({ page }) => {
    await resetBrowserState(page)
    await installProjectState(page, { search: 'active fallback', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, savedViews: [{ id: 'local-7', name: 'Local Fallback', search: 'local saved search', statusFilter: 'Planning', priorityFilter: 'Medium', sortMode: 'health', watchedOnly: false, view: 'overview' }], lastView: 'overview' })
    await page.route('**/api/v1/workspaces/projects/views*', async (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'proof outage' }) }))

    await page.goto('/projects?view=overview')
    await waitForAppIdle(page)
    await expect(page.getByPlaceholder('Find projects, objectives, owners…')).toHaveValue('active fallback')
    await openWorkspaceActions(page)
    await page.getByRole('button', { name: 'Saved views', exact: true }).click()
    await page.getByRole('button', { name: 'Local Fallback · Local', exact: true }).click()
    await expect(page).toHaveURL(/view=overview/)
    await expect(page.getByPlaceholder('Find projects, objectives, owners…')).toHaveValue('local saved search')
  })

  test('creates and updates an explicit personal synced Project view, then reloads a stale-revision conflict without clobbering the client draft', async ({ page }) => {
    await resetBrowserState(page)
    await installProjectState(page, { search: 'initial lens', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, savedViews: [{ id: 'legacy-keep', name: 'Legacy Keep', search: 'local only', view: 'tasks' }], lastView: 'overview' })
    await page.goto('/projects?view=overview')
    await waitForAppIdle(page)
    await openWorkspaceActions(page)
    await page.getByRole('button', { name: 'Save view', exact: true }).click()
    await page.getByLabel('View name').fill('Writable Focus')
    await page.getByRole('button', { name: 'Save personal', exact: true }).click()
    await expect(page.locator('[data-project-saved-view-status="synced"]')).toBeVisible()

    let remote = await findRemoteView(page, 'Writable Focus')
    expect(remote.revision).toBe(1)
    await page.getByPlaceholder('Find projects, objectives, owners…').fill('updated lens')
    await page.getByRole('button', { name: 'Update synced', exact: true }).click()
    await expect(page.locator('[data-project-saved-view-status="synced"]')).toBeVisible()
    remote = await findRemoteView(page, 'Writable Focus')
    expect(remote.revision).toBe(2)

    const externalUpdate = await page.request.put(`${apiBase}/workspaces/views/${remote.id}`, { headers: testApiHeaders, data: { name: remote.name, scope: 'personal', team_id: null, definition: projectViewDefinition('server newer', 'overview', 'health'), schema_version: 1, revision: remote.revision } })
    expect(externalUpdate.ok()).toBeTruthy()
    await page.getByPlaceholder('Find projects, objectives, owners…').fill('client draft')
    await page.getByRole('button', { name: 'Update synced', exact: true }).click()
    await expect(page.getByText('Saved View Conflict', { exact: true })).toBeVisible()
    await expect(page.getByPlaceholder('Find projects, objectives, owners…')).toHaveValue('client draft')
    await page.getByRole('button', { name: 'Reload server copy', exact: true }).click()
    await expect(page.getByPlaceholder('Find projects, objectives, owners…')).toHaveValue('server newer')
    expect((await readProjectState(page)).savedViews).toEqual([{ id: 'legacy-keep', name: 'Legacy Keep', search: 'local only', view: 'tasks' }])
  })

  test('saves a stale personal client draft as a new synced copy and deletes that copy explicitly without touching legacy local views', async ({ page }) => {
    await resetBrowserState(page)
    const create = await page.request.post(`${apiBase}/workspaces/projects/views`, { headers: testApiHeaders, data: { name: 'Conflict Source', scope: 'personal', definition: projectViewDefinition('source lens'), schema_version: 1 } })
    expect(create.ok()).toBeTruthy()
    await installProjectState(page, { search: 'active local', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, savedViews: [{ id: 'legacy-keep', name: 'Legacy Keep', search: 'local only', view: 'tasks' }], lastView: 'overview' })
    await page.goto('/projects?view=overview')
    await waitForAppIdle(page)
    await openWorkspaceActions(page)
    await page.getByRole('button', { name: 'Saved views', exact: true }).click()
    await page.getByRole('button', { name: 'Conflict Source · Personal', exact: true }).click()
    await page.getByPlaceholder('Find projects, objectives, owners…').fill('copy draft')
    const source = await findRemoteView(page, 'Conflict Source')
    const externalUpdate = await page.request.put(`${apiBase}/workspaces/views/${source.id}`, { headers: testApiHeaders, data: { name: source.name, scope: 'personal', team_id: null, definition: projectViewDefinition('server branch'), schema_version: 1, revision: source.revision } })
    expect(externalUpdate.ok()).toBeTruthy()
    await page.getByRole('button', { name: 'Update synced', exact: true }).click()
    await page.getByRole('button', { name: 'Save as copy', exact: true }).click()
    await expect(page.locator('[data-project-saved-view-status="synced"]')).toBeVisible()
    const copied = await findRemoteView(page, 'Conflict Source copy')
    expect(copied.definition.searchTerm).toBe('copy draft')
    await page.getByRole('button', { name: 'Delete synced', exact: true }).click()
    await page.getByRole('button', { name: 'Delete synced view', exact: true }).click()
    await expect(page.getByText('Synced Project view deleted', { exact: true })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Delete Synced Project View', exact: true })).toBeHidden()
    expect((await readProjectState(page)).savedViews).toEqual([{ id: 'legacy-keep', name: 'Legacy Keep', search: 'local only', view: 'tasks' }])
  })

  test('reconciles personal, current-team and local views and runs an authorized team write/conflict/delete lifecycle', async ({ page }) => {
    await resetBrowserState(page)
    const team = await ensureCurrentUserTeam(page, 'Projects Shared Proof')
    const personalCreate = await page.request.post(`${apiBase}/workspaces/projects/views`, { headers: testApiHeaders, data: { name: 'Personal Peer', scope: 'personal', definition: projectViewDefinition('personal peer'), schema_version: 1 } })
    expect(personalCreate.ok()).toBeTruthy()
    await installProjectState(page, { search: 'team initial', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, savedViews: [{ id: 'legacy-team', name: 'Legacy Team Local', search: 'local team', view: 'tasks' }], lastView: 'overview' })

    await page.goto('/projects?view=overview')
    await waitForAppIdle(page)
    await openWorkspaceActions(page)
    await page.getByRole('button', { name: 'Save view', exact: true }).click()
    await page.getByLabel('View name').fill('Shared Focus')
    await expect(page.getByRole('button', { name: 'Save team', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Save team', exact: true }).click()
    await expect(page.locator('[data-project-saved-view-scope="team"]')).toBeVisible()

    let shared = await findRemoteView(page, 'Shared Focus', 'team', team.id)
    expect(shared.revision).toBe(1)
    await page.getByPlaceholder('Find projects, objectives, owners…').fill('team updated')
    await page.getByRole('button', { name: 'Update synced', exact: true }).click()
    shared = await findRemoteView(page, 'Shared Focus', 'team', team.id)
    expect(shared.revision).toBe(2)

    const externalUpdate = await page.request.put(`${apiBase}/workspaces/views/${shared.id}`, { headers: testApiHeaders, data: { name: shared.name, scope: 'team', team_id: team.id, definition: projectViewDefinition('team server branch'), schema_version: 1, revision: shared.revision } })
    expect(externalUpdate.ok()).toBeTruthy()
    await page.getByPlaceholder('Find projects, objectives, owners…').fill('team client draft')
    await page.getByRole('button', { name: 'Update synced', exact: true }).click()
    await expect(page.getByText('Saved View Conflict', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Save as copy', exact: true }).click()
    await expect(page.locator('[data-project-saved-view-status="synced"]')).toBeVisible()
    const copy = await findRemoteView(page, 'Shared Focus copy', 'team', team.id)
    expect(copy.definition.searchTerm).toBe('team client draft')

    await page.getByRole('button', { name: /Shared Focus(?: copy)? · Team(?: · (?:Default|Favorite))?$/ }).click()
    await expect(page.getByRole('button', { name: 'Personal Peer · Personal', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Shared Focus · Team', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Legacy Team Local · Local', exact: true })).toBeVisible()
    await page.locator('[data-workspace-panel="true"]').getByRole('button', { name: 'Shared Focus copy · Team', exact: true }).click()
    await page.getByRole('button', { name: 'Delete synced', exact: true }).click()
    await page.getByRole('button', { name: 'Delete synced view', exact: true }).click()
    await expect(page.getByText('Synced Project view deleted', { exact: true })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Delete Synced Project View', exact: true })).toBeHidden()
    expect((await listProjectViews(page, 'team', team.id)).views.some((row: any) => row.name === 'Shared Focus copy')).toBe(false)
    expect((await readProjectState(page)).savedViews).toEqual([{ id: 'legacy-team', name: 'Legacy Team Local', search: 'local team', view: 'tasks' }])
  })

  test('never fabricates a local team view when team persistence is offline', async ({ page }) => {
    await resetBrowserState(page)
    const team = await ensureCurrentUserTeam(page, 'Projects Shared Proof')
    await installProjectState(page, { search: 'offline team draft', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, savedViews: [{ id: 'legacy-offline', name: 'Offline Local', search: 'local only', view: 'tasks' }], lastView: 'overview' })
    await page.route(`**/api/v1/workspaces/projects/views?scope=team&team_id=${team.id}`, async (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'team proof outage' }) }))
    await page.route('**/api/v1/workspaces/projects/views', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        if (body?.scope === 'team') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'team proof outage' }) })
      }
      return route.continue()
    })

    await page.goto('/projects?view=overview')
    await waitForAppIdle(page)
    await openWorkspaceActions(page)
    await page.getByRole('button', { name: 'Save view', exact: true }).click()
    await page.getByLabel('View name').fill('Must Not Fake Share')
    await page.getByRole('button', { name: 'Save team', exact: true }).click()
    await expect(page.getByText('Save Project View', { exact: true })).toBeVisible()
    expect((await readProjectState(page)).savedViews).toEqual([{ id: 'legacy-offline', name: 'Offline Local', search: 'local only', view: 'tasks' }])
    const teamPayload = await listProjectViews(page, 'team', team.id).catch(() => ({ views: [] }))
    expect(teamPayload.views.some((row: any) => row.name === 'Must Not Fake Share')).toBe(false)
  })

  test('copies a collision-safe saved_view link and restores it exactly once without replacing the Projects view parameter', async ({ page, context }) => {
    await resetBrowserState(page)
    const create = await page.request.post(`${apiBase}/workspaces/projects/views`, { headers: testApiHeaders, data: { name: 'Linked Portfolio', scope: 'personal', definition: projectViewDefinition('linked lens', 'portfolio', 'health'), schema_version: 1 } })
    expect(create.ok()).toBeTruthy()
    const linked = await create.json()
    await installProjectState(page, { search: 'before link', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, savedViews: [], lastView: 'portfolio' })
    await page.goto('/projects?view=portfolio&section=owners')
    await waitForAppIdle(page)
    await openWorkspaceActions(page)
    await page.getByRole('button', { name: 'Saved views', exact: true }).click()
    await page.getByRole('button', { name: 'Linked Portfolio · Personal', exact: true }).click()
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByRole('button', { name: 'Copy view link', exact: true }).click()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    const copiedUrl = new URL(copied)
    expect(copiedUrl.searchParams.get('view')).toBe('portfolio')
    expect(copiedUrl.searchParams.get('saved_view')).toBe(String(linked.id))

    await resetBrowserState(page)
    await installProjectState(page, { search: 'link baseline', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, savedViews: [], lastView: 'overview' })
    await page.goto(copiedUrl.pathname + copiedUrl.search)
    await waitForAppIdle(page)
    await expect(page.getByPlaceholder('Find projects, objectives, owners…')).toHaveValue('linked lens')
    await expect(page).toHaveURL(new RegExp(`view=portfolio.*saved_view=${linked.id}|saved_view=${linked.id}.*view=portfolio`))
  })

  test('leaves inaccessible saved_view links inert and cancels delayed restoration after user interaction', async ({ page }) => {
    await resetBrowserState(page)
    await installProjectState(page, { search: 'inaccessible baseline', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, savedViews: [], lastView: 'overview' })
    await page.goto('/projects?view=overview&saved_view=999999')
    await waitForAppIdle(page)
    await expect(page.getByPlaceholder('Find projects, objectives, owners…')).toHaveValue('inaccessible baseline')
    await expect(page).toHaveURL(/view=overview/)

    const create = await page.request.post(`${apiBase}/workspaces/projects/views`, { headers: testApiHeaders, data: { name: 'Delayed Link', scope: 'personal', definition: projectViewDefinition('late server lens', 'tasks', 'health'), schema_version: 1 } })
    expect(create.ok()).toBeTruthy()
    const delayed = await create.json()
    let releaseHydration: (() => void) | null = null
    const hydrationGate = new Promise<void>((resolve) => { releaseHydration = resolve })
    await page.route('**/api/v1/workspaces/projects/views', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await hydrationGate
      return route.continue()
    })
    await resetBrowserState(page)
    await installProjectState(page, { search: 'delay baseline', statusFilter: 'ALL', priorityFilter: 'ALL', sortMode: 'order', watchedOnly: false, savedViews: [], lastView: 'overview' })
    await page.goto(`/projects?view=overview&saved_view=${delayed.id}`)
    const search = page.getByPlaceholder('Find projects, objectives, owners…')
    await expect(search).toBeVisible()
    await search.fill('user changed first')
    releaseHydration?.()
    await expect.poll(async () => search.inputValue()).toBe('user changed first')
    await expect(page).toHaveURL(/view=overview/)
  })
})
