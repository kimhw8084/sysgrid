import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { p04ManagerFixture } from './fixtures/projects-p04'
import { clickResilientButton } from './helpers/sysgrid'

const apiOrigin = process.env.SYSGRID_P04_API_ORIGIN || 'http://127.0.0.1:8000'
const userId = process.env.USER_ID || 'haewon.kim'
const tenantId = process.env.PW_TENANT_ID || '1'
const headers = { 'X-User-Id': userId, 'X-Tenant-Id': tenantId }

async function bootstrapBrowser(page: Page) {
  await page.addInitScript(({ backend, actor, tenant }) => {
    localStorage.setItem('SYSGRID_OVERRIDE_API_URL', backend)
    localStorage.setItem('SYSGRID_USER_ID', actor)
    localStorage.setItem('SYSGRID_TENANT_ID', tenant)
    localStorage.setItem('sysgrid-theme', 'nordic-frost-v1')
    localStorage.removeItem('sysgrid_projects_creation_recovery_v1')
  }, { backend: apiOrigin, actor: userId, tenant: tenantId })
}

async function assertInsideViewport(page: Page, text: string | RegExp) {
  const locator = page.locator('[data-p04-project-home="true"]').getByText(text, { exact: typeof text === 'string' }).first()
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  expect(box, `Missing geometry for ${String(text)}`).not.toBeNull()
  expect(box!.y + box!.height, `${String(text)} must be in the initial viewport`).toBeLessThanOrEqual(viewport!.height)
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

test('real backend creation survives one failed save and reload without duplicate Projects', async ({ page, request }, testInfo) => {
  const teamResponse = await request.post(`${apiOrigin}/api/v1/settings/teams`, { headers, data: { name: 'P04 Automation Engineering', description: 'Isolated P04 browser fixture' } })
  expect(teamResponse.ok(), await teamResponse.text()).toBeTruthy()
  const team = await teamResponse.json()
  await bootstrapBrowser(page)
  await page.goto('/projects/new')
  await expect(page.locator('[data-p04-new-project="true"]')).toBeVisible()
  await expect(page.locator('[data-p04-step="purpose"]')).toBeVisible()
  await attachScreenshot(page, testInfo, 'new-project-purpose')

  const purpose = page.locator('[data-p04-step="purpose"]')
  await purpose.getByLabel('Team').selectOption(String(team.id))
  await purpose.getByLabel(/Project name/).fill(p04ManagerFixture.project.name)
  await purpose.getByLabel(/Objective/).fill(p04ManagerFixture.project.objective)
  await purpose.getByLabel('Problem/context').fill(p04ManagerFixture.project.problem)
  await purpose.getByRole('button', { name: /Automation/ }).click()
  await clickResilientButton(page, /Next/)
  await expect(page).toHaveURL(/\/projects\/new\?draft=/)
  await expect(page.locator('[data-p04-step="success"]')).toBeVisible()
  const draftId = new URL(page.url()).searchParams.get('draft')
  expect(draftId).toBeTruthy()

  await page.reload()
  await expect(page.locator('[data-p04-step="success"]')).toBeVisible()
  await clickResilientButton(page, 'Close')
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByText('Draft saved', { exact: true })).toBeVisible()
  await page.goto(`/projects/new?draft=${draftId}`)
  await expect(page.locator('[data-p04-step="success"]')).toBeVisible()
  const success = page.locator('[data-p04-step="success"]')
  await expect(success.getByLabel('Primary metric')).toHaveValue('Eligible workflows adopted; hours recovered')

  let continueDraftRead!: () => void
  let draftReadStarted!: () => void
  const draftReadCanContinue = new Promise<void>((resolve) => { continueDraftRead = resolve })
  const draftReadHasStarted = new Promise<void>((resolve) => { draftReadStarted = resolve })
  const delayDraftRead = async (route: any) => {
    draftReadStarted()
    await draftReadCanContinue
    await route.continue()
  }
  await page.route(`**/api/v2/projects/${draftId}`, delayDraftRead)
  await page.reload()
  await expect(page.locator('[data-p04-step="success"]')).toBeVisible()
  await draftReadHasStarted
  await success.getByLabel('Delivery acceptance checklist').fill('Review evidence remains traceable')
  await success.getByLabel('Measurement definition').fill('Count eligible workflows using approved automation; steward verifies the source every two weeks.')
  const draftReadResponse = page.waitForResponse((response) => response.url().endsWith(`/api/v2/projects/${draftId}`) && response.request().method() === 'GET')
  continueDraftRead()
  await draftReadResponse
  await expect(success.getByLabel('Delivery acceptance checklist')).toHaveValue('Review evidence remains traceable')
  await page.unroute(`**/api/v2/projects/${draftId}`, delayDraftRead)

  let failedOnce = false
  const failOneSave = async (route: any) => {
    if (!failedOnce && route.request().method() === 'POST') { failedOnce = true; await route.abort('failed'); return }
    await route.continue()
  }
  await page.route('**/api/v2/projects/*/commands', failOneSave)
  await clickResilientButton(page, /Next/)
  await expect(page.getByRole('alert')).toContainText('entries are retained')
  await expect(success.getByLabel('Delivery acceptance checklist')).toHaveValue('Review evidence remains traceable')
  await page.unroute('**/api/v2/projects/*/commands', failOneSave)
  await clickResilientButton(page, /Next/)

  const delivery = page.locator('[data-p04-step="delivery"]')
  await expect(delivery).toBeVisible()
  await delivery.getByLabel('Target date').fill('2026-10-30')
  await delivery.getByLabel('Architecture impact').selectOption('Yes')
  await delivery.getByLabel('In scope').fill('Qualification evidence review and approval workflow')
  await delivery.getByLabel('Out of scope').fill('Replacing source qualification systems')
  await clickResilientButton(page, /Next/)
  await expect(page.locator('[data-p04-step="review"]')).toBeVisible()
  await clickResilientButton(page, 'Create project')

  await expect(page).toHaveURL(new RegExp(`/projects/${draftId}/home`))
  await expect(page.locator('[data-p04-project-home="true"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: p04ManagerFixture.project.name, exact: true })).toBeVisible()
  await expect(page.locator('.p04-cover-row p').filter({ hasText: p04ManagerFixture.project.objective })).toBeVisible()
  await expect(page.locator('[data-p04-project-home] table')).toHaveCount(0)

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport)
    await assertInsideViewport(page, p04ManagerFixture.project.name)
    for (const label of ['Owner', 'Phase', 'Health', 'Start → Target', 'Next milestone']) await assertInsideViewport(page, label)
    await attachScreenshot(page, testInfo, `project-home-${viewport.width}x${viewport.height}`)
  }

  const projectsResponse = await request.get(`${apiOrigin}/api/v2/projects?limit=200`, { headers })
  expect(projectsResponse.ok(), await projectsResponse.text()).toBeTruthy()
  const projects = await projectsResponse.json()
  const matching = projects.items.filter((item: any) => item.name === p04ManagerFixture.project.name)
  expect(matching).toHaveLength(1)
  expect(matching[0].id).toBe(draftId)
  expect(matching[0].phase).toBe('Proposed')
  expect(matching[0].outcome_phase).toBe('Planned')
  expect(matching[0].template_key).toBe('automation')
  expect(matching[0].template_version).toBe('1.0.0')
  expect(matching[0].story.acceptance_criteria).toHaveLength(1)
  expect(matching[0].story.milestones.map((item: any) => item.title)).toEqual(['Baseline measured', 'Prototype', 'Validation'])

  await page.goto('/projects')
  await expect(page.locator('[data-p04-portfolio="true"]')).toBeVisible()
  await expect(page.getByText(p04ManagerFixture.project.name, { exact: true })).toBeVisible()
  await expect(page.locator('[aria-label="Portfolio projects"]').getByText('Proposed', { exact: true })).toBeVisible()
  await attachScreenshot(page, testInfo, 'portfolio-manager-story')

  await page.goto('/projects/new')
  const discardPurpose = page.locator('[data-p04-step="purpose"]')
  await discardPurpose.getByLabel('Team').selectOption(String(team.id))
  await discardPurpose.getByLabel(/Project name/).fill('Discarded P04 browser Draft')
  await clickResilientButton(page, /Next/)
  await expect(page).toHaveURL(/\/projects\/new\?draft=/)
  const discardedDraftId = new URL(page.url()).searchParams.get('draft')
  expect(discardedDraftId).toBeTruthy()
  await clickResilientButton(page, 'Discard')
  const discardConfirmation = page.getByRole('dialog')
  await expect(discardConfirmation).toBeVisible()
  await expect(discardConfirmation).toContainText('Discard draft?')
  await discardConfirmation.getByRole('button', { name: 'Discard draft', exact: true }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByText('Discarded P04 browser Draft', { exact: true })).toHaveCount(0)
  const discarded = await request.get(`${apiOrigin}/api/v2/projects/${discardedDraftId}`, { headers })
  expect(discarded.ok(), await discarded.text()).toBeTruthy()
  expect((await discarded.json()).archived_at).toBeTruthy()
})
