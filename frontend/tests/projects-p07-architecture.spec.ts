import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test'

const apiOrigin = () => process.env.SYSGRID_P07_API_ORIGIN || ''
const user = process.env.SYSGRID_P07_USER_ID || 'p07.architecture'

async function setupJourney() {
  const api = await request.newContext({ baseURL: apiOrigin(), extraHTTPHeaders: { 'X-User-Id': user, 'X-Tenant-Id': '1' } })
  const createModelId = crypto.randomUUID()
  const modelResponse = await api.post('/api/v2/architecture/models', { headers: { 'Idempotency-Key': createModelId }, data: { command_id: createModelId, name: 'P07 shared platform model' } })
  expect(modelResponse.ok(), await modelResponse.text()).toBeTruthy()
  const model = (await modelResponse.json()).model
  const objectId = `p07-service-${createModelId.slice(0, 8)}`
  const objectCommand = crypto.randomUUID()
  const objectResponse = await api.post(`/api/v2/architecture/models/${model.id}/commands`, { headers: { 'Idempotency-Key': objectCommand }, data: { command_id: objectCommand, type: 'object.create', expected: { model_revision: 1 }, payload: { id: objectId, kind: 'Application/Service', name: 'P07 Service' } } })
  expect(objectResponse.ok(), await objectResponse.text()).toBeTruthy()
  const projectCommand = crypto.randomUUID()
  const projectResponse = await api.post('/api/v2/projects', { headers: { 'Idempotency-Key': projectCommand }, data: { name: 'P07 shared host project', objective: 'Observe one Architecture identity in both hosts' } })
  expect(projectResponse.ok(), await projectResponse.text()).toBeTruthy()
  const project = (await projectResponse.json()).project
  const associateCommand = crypto.randomUUID()
  const association = await api.post(`/api/v2/architecture/projects/${project.id}/architecture/associate`, { headers: { 'Idempotency-Key': associateCommand }, data: { command_id: associateCommand, model_id: model.id, object_ids: [objectId], impact_tags: ['Changes'] } })
  expect(association.ok(), await association.text()).toBeTruthy()
  return { api, modelId: model.id, projectId: project.id }
}

async function open(page: Page, path: string) {
  await page.addInitScript((origin) => {
    localStorage.setItem('SYSGRID_OVERRIDE_API_URL', origin)
    localStorage.setItem('SYSGRID_USER_ID', user)
    localStorage.setItem('SYSGRID_TENANT_ID', '1')
  }, apiOrigin())
  await page.goto(path)
}

test.beforeEach(() => test.skip(!process.env.P07_REAL_BACKEND, 'requires isolated P07 backend proof runtime'))

test('one canonical object is visible in full Architecture and Project Plan hosts', async ({ page }) => {
  const journey = await setupJourney()
  try {
    await open(page, `/architecture?model=${journey.modelId}&mode=current`)
    await expect(page.locator('[data-pv1-architecture-workspace="true"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'P07 Service' })).toBeVisible()
    await expect(page.getByText(/revision 2/).first()).toBeVisible()
    await open(page, `/projects/${journey.projectId}/plan?section=architecture`)
    await expect(page.locator('[data-pv1-architecture-project="' + journey.projectId + '"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'P07 Service' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Impact' })).toHaveAttribute('aria-selected', 'true')
  } finally { await journey.api.dispose() }
})

test('Draft Proposed creates reserved identity without changing Current', async ({ page }) => {
  const journey = await setupJourney()
  try {
    await open(page, `/architecture?model=${journey.modelId}&mode=current`)
    const input = page.getByLabel('Proposed object name')
    await input.fill('P07 Proposed Datastore')
    await page.getByRole('button', { name: 'Create Draft proposal' }).click()
    await expect(page.getByText(/Draft change set created/)).toBeVisible()
    await expect(page.getByText('P07 Proposed Datastore').first()).toBeVisible()
    const current = await journey.api.get(`/api/v2/architecture/models/${journey.modelId}`, { params: { mode: 'current' } })
    expect((await current.json()).objects.map((item: any) => item.name)).not.toContain('P07 Proposed Datastore')
  } finally { await journey.api.dispose() }
})
