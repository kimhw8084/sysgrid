import { expect, request, test } from '@playwright/test'

const apiOrigin = process.env.SYSGRID_P11_API_ORIGIN!
const userId = process.env.P11_USER_ID || 'p11.manager'
const tenantId = process.env.PW_TENANT_ID || '1'
const headers = { 'X-User-Id': userId, 'X-Tenant-Id': tenantId }

test('P11 Portfolio keeps migrated and native Projects in one canonical story projection', async ({ page }) => {
  const api = await request.newContext({ baseURL: apiOrigin, extraHTTPHeaders: headers })
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  try {
    const teamResponse = await api.post('/api/v1/settings/teams', { data: { name: 'P11 Portfolio Team', description: 'Isolated Portfolio regression fixture' } })
    expect(teamResponse.ok(), await teamResponse.text()).toBeTruthy()
    const team = await teamResponse.json()
    const commandId = globalThis.crypto.randomUUID()
    const nativeResponse = await api.post('/api/v2/projects', {
      headers: { 'Idempotency-Key': commandId },
      data: { name: 'P11 Native Portfolio Project', objective: 'Native and migrated Projects share one story contract.', phase: 'Draft', team_id: team.id },
    })
    expect(nativeResponse.ok(), await nativeResponse.text()).toBeTruthy()
    const native = (await nativeResponse.json()).project
    const legacyResponse = await api.post('/api/v1/projects', { data: { name: 'P11 Migrated Attention Project', objective: 'A past delivery commitment appears with a clear warning.', owner: userId, status: 'In Progress', priority: 'High', start_date: '2019-01-01T00:00:00', end_date: '2020-01-01T00:00:00' } })
    expect(legacyResponse.ok(), await legacyResponse.text()).toBeTruthy()

    await page.addInitScript(({ origin, actor, tenant }) => {
      localStorage.setItem('SYSGRID_OVERRIDE_API_URL', origin)
      localStorage.setItem('SYSGRID_USER_ID', actor)
      localStorage.setItem('SYSGRID_TENANT_ID', tenant)
      localStorage.setItem('sysgrid-theme', 'nordic-frost-v1')
    }, { origin: apiOrigin, actor: userId, tenant: tenantId })

    const portfolio = await api.get('/api/v2/projects?limit=200')
    expect(portfolio.ok(), await portfolio.text()).toBeTruthy()
    const payload = await portfolio.json()
    expect(payload.items.map((item: any) => item.name)).toContain('P11 Native Portfolio Project')
    const migrated = payload.items.find((item: any) => item.legacy_project_id)
    expect(migrated, 'fixture must contain a migrated legacy-backed project').toBeTruthy()
    expect(migrated.story).toBeTruthy()
    expect(migrated.story.governance).toEqual([])
    expect(native.id).toBeTruthy()

    await page.goto('/projects')
    await expect(page.locator('[data-p04-portfolio="true"]')).toBeVisible()
    await expect(page.getByText('P11 Migrated Attention Project', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('P11 Native Portfolio Project', { exact: true }).first()).toBeVisible()

    await page.getByLabel('Sort projects').selectOption('attention')
    const firstRow = page.locator('[aria-label="Portfolio projects"] tbody tr').first()
    await expect(firstRow).toContainText('P11 Migrated Attention Project')

    await page.getByLabel('Filter by health').selectOption('At risk')
    await expect(page.getByText('P11 Migrated Attention Project', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('P11 Native Portfolio Project', { exact: true })).toHaveCount(0)

    await page.getByRole('button', { name: 'Timeline' }).click()
    await expect(page.locator('[data-p04-portfolio-timeline="true"]')).toBeVisible()
    await expect(page.getByText('P11 Migrated Attention Project', { exact: true }).first()).toBeVisible()

    await page.goto(`/projects/${encodeURIComponent(String(migrated.id))}/home`)
    await expect(page.locator('[data-p04-project-home="true"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'P11 Migrated Attention Project', exact: true })).toBeVisible()

    await page.goto('/projects')
    await expect(page.locator('[data-p04-portfolio="true"]')).toBeVisible()
    await expect(page.getByText('P11 Native Portfolio Project', { exact: true }).first()).toBeVisible()

    await page.goto(`/projects?id=${encodeURIComponent(String(migrated.legacy_project_id))}&view=overview`)
    await expect(page).toHaveURL(new RegExp(`/projects/${migrated.id}/home$`))
    await expect(page.locator('[data-p04-project-home="true"]')).toBeVisible()
    await expect(page.locator('[data-p04-legacy-workspace]')).toHaveAttribute('data-p04-legacy-workspace', String(migrated.legacy_project_id))
    await expect(page.getByRole('link', { name: 'Open existing workspace' })).toHaveAttribute('href', `/projects?view=overview&id=${migrated.legacy_project_id}&legacy_workspace=1`)
    await page.getByRole('link', { name: 'Open existing workspace' }).click()
    await expect(page).toHaveURL(new RegExp(`/projects\\?view=overview&id=${migrated.legacy_project_id}&legacy_workspace=1$`))
    await expect(page.locator('[data-project-overview="true"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'P11 Migrated Attention Project', exact: true })).toBeVisible()
  } finally {
    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([])
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([])
    await api.dispose()
  }
})
