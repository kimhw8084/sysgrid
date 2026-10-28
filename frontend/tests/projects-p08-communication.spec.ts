import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test'

const apiOrigin = () => process.env.SYSGRID_P08_API_ORIGIN || ''
const user = process.env.SYSGRID_P08_USER_ID || 'p08.communication'

async function setupJourney() {
  const api = await request.newContext({ baseURL: apiOrigin(), extraHTTPHeaders: { 'X-User-Id': user, 'X-Tenant-Id': '1' } })
  const createId = crypto.randomUUID()
  const createdResponse = await api.post('/api/v2/projects', { headers: { 'Idempotency-Key': createId }, data: { name: 'P08 communication project', objective: 'Use evidence-linked communication without AI' } })
  expect(createdResponse.ok(), await createdResponse.text()).toBeTruthy()
  const project = (await createdResponse.json()).project
  const resourceId = crypto.randomUUID()
  const resourceResponse = await api.post(`/api/v2/projects/${project.id}/commands`, { headers: { 'Idempotency-Key': resourceId }, data: { command_id: resourceId, type: 'resource.save', expected: { project_revision: 1 }, payload: { id: `resource-${resourceId.slice(0, 8)}`, title: 'P08 Runbook', resource_kind: 'Runbook', content: '# Safe runbook' } } })
  expect(resourceResponse.ok(), await resourceResponse.text()).toBeTruthy()
  const draftCommand = crypto.randomUUID()
  const draftResponse = await api.post(`/api/v2/projects/${project.id}/updates/draft`, { headers: { 'Idempotency-Key': draftCommand }, data: { period_start: '2026-01-01', period_end: '2026-12-31' } })
  expect(draftResponse.ok(), await draftResponse.text()).toBeTruthy()
  const draft = await draftResponse.json()
  const updateId = draft.changed_entities[0].id
  const publishCommand = crypto.randomUUID()
  const publishResponse = await api.post(`/api/v2/projects/${project.id}/commands`, { headers: { 'Idempotency-Key': publishCommand }, data: { command_id: publishCommand, type: 'update.publish', expected: { project_revision: draft.revisions.project_revision }, payload: { update_id: updateId } } })
  expect(publishResponse.ok(), await publishResponse.text()).toBeTruthy()
  const reportCommand = crypto.randomUUID()
  const reportResponse = await api.post(`/api/v2/projects/${project.id}/reports/capture`, { headers: { 'Idempotency-Key': reportCommand }, data: { report_type: 'Stakeholder summary', period_start: '2026-01-01', period_end: '2026-12-31' } })
  expect(reportResponse.ok(), await reportResponse.text()).toBeTruthy()
  return { api, projectId: project.id }
}

async function open(page: Page, path: string) {
  await page.addInitScript((origin) => {
    localStorage.setItem('SYSGRID_OVERRIDE_API_URL', origin)
    localStorage.setItem('SYSGRID_USER_ID', user)
    localStorage.setItem('SYSGRID_TENANT_ID', '1')
  }, apiOrigin())
  await page.goto(path)
}

test.beforeEach(() => test.skip(!process.env.P08_REAL_BACKEND, 'requires isolated P08 backend proof runtime'))

test('AI-off updates, resources, reports and activity are reachable from canonical routes', async ({ page }) => {
  const journey = await setupJourney()
  try {
    await open(page, `/projects/${journey.projectId}/updates`)
    await expect(page.locator('[data-p08-communication="true"]')).toBeVisible()
    await expect(page.getByText('AI disabled by default')).toBeVisible()
    await expect(page.getByText('Published updates')).toBeVisible()
    await expect(page.getByText('Activity')).toBeVisible()
    await open(page, `/projects/${journey.projectId}/resources`)
    await expect(page.getByText('P08 Runbook')).toBeVisible()
    await expect(page.getByRole('link', { name: 'CSV' })).toBeVisible()
    await open(page, `/projects/${journey.projectId}/reports`)
    await expect(page.getByText('Stakeholder summary', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'PDF' })).toBeVisible()
  } finally { await journey.api.dispose() }
})
