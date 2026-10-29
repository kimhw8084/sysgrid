import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test'

const apiOrigin = () => process.env.SYSGRID_P09_API_ORIGIN || ''
const user = process.env.SYSGRID_P09_USER_ID || 'p09.outcomes'

async function command(api: APIRequestContext, projectId: string, type: string, expectedRevision: number, payload: Record<string, unknown>) {
  const commandId = crypto.randomUUID()
  const response = await api.post(`/api/v2/projects/${projectId}/commands`, {
    headers: { 'Idempotency-Key': commandId },
    data: { command_id: commandId, type, expected: { project_revision: expectedRevision }, payload },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

async function setupJourney() {
  const api = await request.newContext({ baseURL: apiOrigin(), extraHTTPHeaders: { 'X-User-Id': user, 'X-Tenant-Id': '1' } })
  const createId = crypto.randomUUID()
  const createdResponse = await api.post('/api/v2/projects', { headers: { 'Idempotency-Key': createId }, data: { name: 'P09 Outcomes proof', objective: 'Verify delivery and outcome remain independent.' } })
  expect(createdResponse.ok(), await createdResponse.text()).toBeTruthy()
  const project = (await createdResponse.json()).project
  await command(api, project.id, 'project.set_access', 1, { members: [{ user_id: user, role: 'Owner', capabilities: { 'financial.view': true, 'financial.edit': true } }] })
  const metric = await command(api, project.id, 'metric.define', 2, { name: 'Adoption', kind: 'Adoption', unit: '%', direction: 'Increase', steward_id: user, measurement_method: 'Verified usage export', target_spec: { type: 'number', operator: '>=', value: '75' }, required_for_success: true })
  const metricId = metric.changed_entities[0].id
  await command(api, project.id, 'measurement.record', 2, { metric_id: metricId, definition_revision: 1, period_start: '2026-08-01', period_end: '2026-09-01', numerator: 64, denominator: 80, unit: '%', source: 'approved usage export', quality: 'Verified', evidence: [{ id: 'usage-proof' }] })
  await command(api, project.id, 'value.record', 2, { classification: 'Cash saving', amount: '12000', currency_or_unit: 'USD', period_start: '2026-08-01', period_end: '2026-09-01', attribution_key: 'p09-benefit', fraction: '1', source: 'verified ledger', quality: 'Verified', evidence: [{ id: 'ledger-benefit' }] })
  await command(api, project.id, 'value.record', 2, { classification: 'Cost', amount: '10000', currency_or_unit: 'USD', period_start: '2026-08-01', period_end: '2026-09-01', attribution_key: 'p09-cost', fraction: '1', source: 'verified ledger', quality: 'Verified', evidence: [{ id: 'ledger-cost' }] })
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

test.beforeEach(() => test.skip(!process.env.P09_REAL_BACKEND, 'requires isolated P09 backend proof runtime'))

test('Outcomes route presents independent delivery, adoption evidence and exact ROI', async ({ page }, testInfo) => {
  const journey = await setupJourney()
  try {
    await open(page, `/projects/${journey.projectId}/outcomes`)
    await expect(page.locator('[data-p09-outcomes="true"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Outcomes', exact: true })).toBeVisible()
    await expect(page.getByText('Delivery acceptance', { exact: true })).toBeVisible()
    await expect(page.getByText('Not accepted', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Adoption', exact: true })).toBeVisible()
    await expect(page.getByText('Task progress is not used as an outcome result.', { exact: false })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('p09-outcomes-summary.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('link', { name: 'Value', exact: true }).click()
    await expect(page.locator('[data-p09-section="value"]')).toBeVisible()
    await expect(page.locator('[data-p09-panel="value"]')).toBeVisible()
    await expect(page.getByText('ROI 20%', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('p09-outcomes-value.png'), fullPage: true, animations: 'disabled' })
  } finally { await journey.api.dispose() }
})
