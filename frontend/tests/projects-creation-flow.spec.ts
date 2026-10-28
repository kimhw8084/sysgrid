import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { clickResilientButton } from './helpers/sysgrid'

const apiOrigin = process.env.SYSGRID_P04_API_ORIGIN || 'http://127.0.0.1:8000'
const userId = process.env.USER_ID || 'haewon.kim'
const tenantId = process.env.PW_TENANT_ID || '1'
const headers = { 'X-User-Id': userId, 'X-Tenant-Id': tenantId }

test.describe('Projects guided creation workflow', () => {
  test('creates, restores, and discards a server-backed project draft', async ({ page, request }) => {
    const teamResponse = await request.post(`${apiOrigin}/api/v1/settings/teams`, {
      headers,
      data: {
        name: `PW-PROJECT-FLOW-${globalThis.crypto.randomUUID()}`,
        description: 'Isolated guided-creation workflow fixture',
      },
    })
    expect(teamResponse.ok(), await teamResponse.text()).toBeTruthy()
    const team = await teamResponse.json()

    const projectName = `PW-GUIDED-PROJECT-${globalThis.crypto.randomUUID()}`
    const objective = 'Reduce review time while keeping decisions traceable.'
    const problem = 'Manual reviews delay decisions and lose context between teams.'

    await page.addInitScript(({ backend, actor, tenant }) => {
      localStorage.setItem('SYSGRID_OVERRIDE_API_URL', backend)
      localStorage.setItem('SYSGRID_USER_ID', actor)
      localStorage.setItem('SYSGRID_TENANT_ID', tenant)
      localStorage.setItem('sysgrid-theme', 'nordic-frost-v1')
      localStorage.removeItem('sysgrid_projects_creation_recovery_v1')
    }, { backend: apiOrigin, actor: userId, tenant: tenantId })

    await page.goto('/projects')
    await expect(page.locator('[data-p04-portfolio="true"]')).toBeVisible()
    await page.getByRole('link', { name: 'New project', exact: true }).first().click()
    await expect(page).toHaveURL(/\/projects\/new$/)

    const purpose = page.locator('[data-p04-step="purpose"]')
    await purpose.getByLabel('Team').selectOption(String(team.id))
    await purpose.getByLabel(/Project name/).fill(projectName)
    await purpose.getByLabel(/Objective/).fill(objective)
    await purpose.getByLabel('Problem/context').fill(problem)
    await purpose.getByRole('button', { name: /Automation/ }).click()
    await clickResilientButton(page, /Next/)

    await expect(page).toHaveURL(/\/projects\/new\?draft=/)
    await expect(page.locator('[data-p04-step="success"]')).toBeVisible()
    const draftId = new URL(page.url()).searchParams.get('draft')
    expect(draftId).toBeTruthy()

    const draftResponse = await request.get(`${apiOrigin}/api/v2/projects/${draftId}`, { headers })
    expect(draftResponse.ok(), await draftResponse.text()).toBeTruthy()
    const draft = await draftResponse.json()
    expect(draft).toMatchObject({ id: draftId, name: projectName, objective, team_id: team.id })

    await page.reload()
    await expect(page.locator('[data-p04-step="success"]')).toBeVisible()
    await clickResilientButton(page, 'Back')
    await expect(purpose.getByLabel(/Project name/)).toHaveValue(projectName)
    await expect(purpose.getByLabel(/Objective/)).toHaveValue(objective)

    await clickResilientButton(page, 'Discard')
    const confirmation = page.getByRole('dialog')
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: 'Discard draft', exact: true }).click()
    await expect(page).toHaveURL(/\/projects$/)

    const discardedResponse = await request.get(`${apiOrigin}/api/v2/projects/${draftId}`, { headers })
    expect(discardedResponse.ok(), await discardedResponse.text()).toBeTruthy()
    expect((await discardedResponse.json()).archived_at).toBeTruthy()
  })
})
